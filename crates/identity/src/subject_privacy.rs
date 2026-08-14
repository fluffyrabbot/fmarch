//! Subject-scoped private claims and externally destructible key material.
//!
//! Canonical streams carry only opaque [`SubjectId`] and [`ClaimId`] values.
//! Presentation data and owner bindings are sealed with an independently
//! generated key for that subject. Deleting the key makes every retained claim
//! cryptographically unrecoverable without rewriting event history.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use bytes::Bytes;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use futures_util::{StreamExt, TryStreamExt};
use hmac::{Hmac, Mac};
use object_store::aws::AmazonS3Builder;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt, PutMode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use url::Url;
use uuid::Uuid;

const SUBJECT_KEY_DIR_ENV: &str = "FMARCH_SUBJECT_KEY_DIR";
const SUBJECT_AUTHORITY_REVISION_ENV: &str = "FMARCH_SUBJECT_KEY_AUTHORITY_REVISION";
const SUBJECT_AUTHORITY_ENDPOINT_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_ENDPOINT";
const SUBJECT_AUTHORITY_REGION_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_REGION";
const SUBJECT_AUTHORITY_BUCKET_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_BUCKET";
const SUBJECT_AUTHORITY_ACCESS_KEY_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID";
const SUBJECT_AUTHORITY_SECRET_KEY_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY";
const SUBJECT_AUTHORITY_URL_STYLE_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_URL_STYLE";
const SUBJECT_AUTHORITY_ALLOW_HTTP_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_ALLOW_HTTP";
const SUBJECT_AUTHORITY_ID_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_ID";
const SUBJECT_AUTHORITY_WRAP_KID_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_WRAP_KID";
const SUBJECT_AUTHORITY_WRAP_KEY_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY";
const SUBJECT_AUTHORITY_JOURNAL_KID_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID";
const SUBJECT_AUTHORITY_JOURNAL_KEY_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY";
const SUBJECT_AUTHORITY_MARKER: &str = "authority-revision";
const SUBJECT_AUTHORITY_PREFIX: &str = "fmarch-subject-authority/v1";
const SUBJECT_AUTHORITY_MANIFEST_SCHEME: &str = "fmarch-subject-authority-v1";
const SUBJECT_KEY_OBJECT_SCHEME: &str = "fmarch-subject-key-v1";
const SUBJECT_REVOCATION_OBJECT_SCHEME: &str = "fmarch-subject-revocation-v1";
const SUBJECT_KEY_OBJECT_MAX_BYTES: usize = 4 * 1024;
const SUBJECT_REVOCATION_OBJECT_MAX_BYTES: usize = 16 * 1024;
const SUBJECT_AUTHORITY_MANIFEST_MAX_BYTES: usize = 4 * 1024;
const SUBJECT_AUTHORITY_IO_CONCURRENCY: usize = 16;
const SUBJECT_ENVELOPE_SCHEME: &str = "fmarch-subject-claim-v1";
const SUBJECT_ENVELOPE_ALG: &str = "XChaCha20Poly1305";

static ACTIVE_SUBJECT_KEY_STORE: OnceLock<Arc<dyn SubjectKeyStore>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubjectId(Uuid);

impl SubjectId {
    /// Production subject identifiers are random and carry no principal-derived
    /// material, so public aliases and canonical facts cannot be correlated by
    /// hashing an account identifier.
    pub fn random() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for SubjectId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ClaimId(Uuid);

impl ClaimId {
    pub fn random() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for ClaimId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubjectClaimEnvelope {
    pub scheme: String,
    pub alg: String,
    pub nonce: String,
    pub ciphertext: String,
}

/// Non-secret, append-only evidence kept beside (but not inside) database
/// backups. Restore reconciliation reapplies this record before serving reads,
/// so a backup captured before erasure cannot resurrect subject data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubjectRevocationRecord {
    pub subject_id: SubjectId,
    pub replacement_alias: String,
    pub destroyed_at: i64,
    pub key_fingerprint_sha256: String,
    pub receipt_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum SubjectPrivacyError {
    #[error("subject key storage is not configured: {0}")]
    Configuration(String),
    #[error("subject key {subject_id} is missing")]
    MissingKey { subject_id: SubjectId },
    #[error("subject key storage failed: {0}")]
    Storage(String),
    #[error("subject claim envelope is invalid: {0}")]
    InvalidEnvelope(String),
    #[error("subject claim encryption failed")]
    Encryption,
    #[error("subject claim authentication failed")]
    Authentication,
    #[error("subject claim serialization failed: {0}")]
    Serialization(String),
}

/// A deliberately narrow key authority. Database backups contain claim
/// envelopes and tombstones, never the keys needed to open active claims.
#[async_trait::async_trait]
pub trait SubjectKeyStore: Send + Sync {
    async fn check_readiness(&self) -> Result<(), SubjectPrivacyError>;
    async fn create(&self, subject_id: SubjectId) -> Result<(), SubjectPrivacyError>;
    async fn load(&self, subject_id: SubjectId) -> Result<[u8; 32], SubjectPrivacyError>;
    async fn destroy(&self, subject_id: SubjectId) -> Result<bool, SubjectPrivacyError>;
    async fn record_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<(), SubjectPrivacyError>;
    async fn revocations(&self) -> Result<Vec<SubjectRevocationRecord>, SubjectPrivacyError>;
    async fn fingerprint(&self, subject_id: SubjectId) -> Result<String, SubjectPrivacyError> {
        let key = self.load(subject_id).await?;
        Ok(format!("{:x}", Sha256::digest(key)))
    }
}

#[derive(Clone)]
pub struct ObjectSubjectKeyStoreConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub virtual_hosted_style: bool,
    pub allow_http: bool,
    pub authority_revision: String,
    pub authority_id: Uuid,
    pub wrap_kid: String,
    pub wrap_key: [u8; 32],
    pub journal_kid: String,
    pub journal_key: [u8; 32],
}

impl std::fmt::Debug for ObjectSubjectKeyStoreConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ObjectSubjectKeyStoreConfig")
            .field("endpoint", &self.endpoint)
            .field("region", &self.region)
            .field("bucket", &self.bucket)
            .field("access_key_id", &"<redacted>")
            .field("secret_access_key", &"<redacted>")
            .field("virtual_hosted_style", &self.virtual_hosted_style)
            .field("allow_http", &self.allow_http)
            .field("authority_revision", &self.authority_revision)
            .field("authority_id", &self.authority_id)
            .field("wrap_kid", &self.wrap_kid)
            .field("wrap_key", &"<redacted>")
            .field("journal_kid", &self.journal_kid)
            .field("journal_key", &"<redacted>")
            .finish()
    }
}

impl ObjectSubjectKeyStoreConfig {
    pub fn from_environment() -> Result<Self, SubjectPrivacyError> {
        let endpoint = required_authority_env(SUBJECT_AUTHORITY_ENDPOINT_ENV)?;
        let url_style =
            std::env::var(SUBJECT_AUTHORITY_URL_STYLE_ENV).unwrap_or_else(|_| "path".to_string());
        let virtual_hosted_style = match url_style.as_str() {
            "path" => false,
            "virtual-host" | "virtual-hosted" => true,
            _ => {
                return Err(SubjectPrivacyError::Configuration(format!(
                "{SUBJECT_AUTHORITY_URL_STYLE_ENV} must be path, virtual-host, or virtual-hosted"
            )))
            }
        };
        let allow_http = std::env::var(SUBJECT_AUTHORITY_ALLOW_HTTP_ENV)
            .ok()
            .as_deref()
            == Some("1");
        if endpoint.starts_with("http://") && !allow_http {
            return Err(SubjectPrivacyError::Configuration(format!(
                "HTTP subject authority requires explicit {SUBJECT_AUTHORITY_ALLOW_HTTP_ENV}=1"
            )));
        }
        Ok(Self {
            endpoint,
            region: required_authority_env(SUBJECT_AUTHORITY_REGION_ENV)?,
            bucket: required_authority_env(SUBJECT_AUTHORITY_BUCKET_ENV)?,
            access_key_id: required_authority_env(SUBJECT_AUTHORITY_ACCESS_KEY_ENV)?,
            secret_access_key: required_authority_env(SUBJECT_AUTHORITY_SECRET_KEY_ENV)?,
            virtual_hosted_style,
            allow_http,
            authority_revision: required_authority_env(SUBJECT_AUTHORITY_REVISION_ENV)?,
            authority_id: required_authority_env(SUBJECT_AUTHORITY_ID_ENV)?
                .parse()
                .map_err(|error| {
                    SubjectPrivacyError::Configuration(format!(
                        "{SUBJECT_AUTHORITY_ID_ENV} must be a UUID: {error}"
                    ))
                })?,
            wrap_kid: required_authority_env(SUBJECT_AUTHORITY_WRAP_KID_ENV)?,
            wrap_key: decode_authority_key(SUBJECT_AUTHORITY_WRAP_KEY_ENV)?,
            journal_kid: required_authority_env(SUBJECT_AUTHORITY_JOURNAL_KID_ENV)?,
            journal_key: decode_authority_key(SUBJECT_AUTHORITY_JOURNAL_KEY_ENV)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubjectAuthorityManifest {
    pub scheme: String,
    pub authority_id: Uuid,
    pub revision: String,
    pub key_wrap_kid: String,
    pub revocation_journal_kid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubjectKeyObject {
    scheme: String,
    alg: String,
    kid: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubjectRevocationObject {
    scheme: String,
    alg: String,
    kid: String,
    record: SubjectRevocationRecord,
    mac: String,
}

#[derive(Clone)]
pub struct ObjectSubjectKeyStore {
    store: Arc<dyn ObjectStore>,
    authority_revision: String,
    authority_id: Uuid,
    wrap_kid: String,
    wrap_key: [u8; 32],
    journal_kid: String,
    journal_key: [u8; 32],
}

impl std::fmt::Debug for ObjectSubjectKeyStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ObjectSubjectKeyStore")
            .field("store", &"object-store")
            .field("authority_revision", &self.authority_revision)
            .field("authority_id", &self.authority_id)
            .field("wrap_kid", &self.wrap_kid)
            .field("journal_kid", &self.journal_kid)
            .finish()
    }
}

impl ObjectSubjectKeyStore {
    pub fn s3(config: ObjectSubjectKeyStoreConfig) -> Result<Self, SubjectPrivacyError> {
        let endpoint = subject_authority_bucket_endpoint(&config)?;
        let store = AmazonS3Builder::new()
            .with_endpoint(endpoint)
            .with_region(config.region)
            .with_bucket_name(config.bucket)
            .with_access_key_id(config.access_key_id)
            .with_secret_access_key(config.secret_access_key)
            .with_virtual_hosted_style_request(config.virtual_hosted_style)
            .with_allow_http(config.allow_http)
            .build()
            .map_err(|error| object_storage_error("configure", error))?;
        Ok(Self::new(
            Arc::new(store),
            config.authority_revision,
            config.authority_id,
            config.wrap_kid,
            config.wrap_key,
            config.journal_kid,
            config.journal_key,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<dyn ObjectStore>,
        authority_revision: impl Into<String>,
        authority_id: Uuid,
        wrap_kid: impl Into<String>,
        wrap_key: [u8; 32],
        journal_kid: impl Into<String>,
        journal_key: [u8; 32],
    ) -> Self {
        Self {
            store,
            authority_revision: authority_revision.into(),
            authority_id,
            wrap_kid: wrap_kid.into(),
            wrap_key,
            journal_kid: journal_kid.into(),
            journal_key,
        }
    }

    pub async fn bootstrap(&self) -> Result<SubjectAuthorityManifest, SubjectPrivacyError> {
        let manifest = SubjectAuthorityManifest {
            scheme: SUBJECT_AUTHORITY_MANIFEST_SCHEME.to_string(),
            authority_id: self.authority_id,
            revision: self.authority_revision.clone(),
            key_wrap_kid: self.wrap_kid.clone(),
            revocation_journal_kid: self.journal_kid.clone(),
        };
        let bytes = serde_json::to_vec(&manifest)
            .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        let path = authority_manifest_path();
        match self
            .store
            .put_opts(&path, Bytes::copy_from_slice(&bytes).into(), PutMode::Create.into())
            .await
        {
            Ok(_) => {}
            Err(object_store::Error::AlreadyExists { .. }) => {
                return Err(SubjectPrivacyError::Configuration(
                    "subject authority is already bootstrapped; bootstrap never overwrites its manifest"
                        .to_string(),
                ))
            }
            Err(error) => return Err(object_storage_error("bootstrap-manifest", error)),
        }
        self.verify_exact_object(&path, &bytes, "verify-bootstrap-manifest")
            .await?;
        Ok(manifest)
    }

    pub async fn require_manifest(&self) -> Result<SubjectAuthorityManifest, SubjectPrivacyError> {
        let path = authority_manifest_path();
        let bytes = self
            .read_object_bounded(
                &path,
                SUBJECT_AUTHORITY_MANIFEST_MAX_BYTES,
                "read-authority-manifest",
            )
            .await?
            .ok_or_else(|| {
                SubjectPrivacyError::Configuration(
                    "subject authority manifest is missing; run server --bootstrap-subject-authority once"
                        .to_string(),
                )
            })?;
        let manifest: SubjectAuthorityManifest =
            serde_json::from_slice(&bytes).map_err(|error| {
                SubjectPrivacyError::Configuration(format!(
                    "subject authority manifest is invalid: {error}"
                ))
            })?;
        if manifest.scheme != SUBJECT_AUTHORITY_MANIFEST_SCHEME {
            return Err(SubjectPrivacyError::Configuration(format!(
                "unsupported subject authority scheme `{}`",
                manifest.scheme
            )));
        }
        if manifest.revision != self.authority_revision {
            return Err(SubjectPrivacyError::Configuration(format!(
                "subject authority revision mismatch: expected `{}`, found `{}`",
                self.authority_revision, manifest.revision
            )));
        }
        if manifest.authority_id != self.authority_id {
            return Err(SubjectPrivacyError::Configuration(format!(
                "subject authority genesis mismatch: expected `{}`, found `{}`",
                self.authority_id, manifest.authority_id
            )));
        }
        if manifest.key_wrap_kid != self.wrap_kid
            || manifest.revocation_journal_kid != self.journal_kid
        {
            return Err(SubjectPrivacyError::Configuration(
                "subject authority cryptographic key ids do not match its immutable manifest"
                    .to_string(),
            ));
        }
        Ok(manifest)
    }

    async fn read_object_bounded(
        &self,
        path: &ObjectPath,
        max_bytes: usize,
        operation: &'static str,
    ) -> Result<Option<Bytes>, SubjectPrivacyError> {
        match self.store.get(path).await {
            Ok(result) => {
                if result.meta.size > max_bytes as u64 {
                    return Err(SubjectPrivacyError::Storage(format!(
                        "{operation}: object {path} exceeds {max_bytes} bytes"
                    )));
                }
                let mut bytes = Vec::with_capacity(result.meta.size as usize);
                let mut stream = result.into_stream();
                while let Some(chunk) = stream
                    .try_next()
                    .await
                    .map_err(|error| object_storage_error(operation, error))?
                {
                    if bytes.len().saturating_add(chunk.len()) > max_bytes {
                        return Err(SubjectPrivacyError::Storage(format!(
                            "{operation}: object {path} exceeds {max_bytes} bytes"
                        )));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(Some(Bytes::from(bytes)))
            }
            Err(object_store::Error::NotFound { .. }) => Ok(None),
            Err(error) => Err(object_storage_error(operation, error)),
        }
    }

    async fn exists(&self, path: &ObjectPath) -> Result<bool, SubjectPrivacyError> {
        match self.store.head(path).await {
            Ok(_) => Ok(true),
            Err(object_store::Error::NotFound { .. }) => Ok(false),
            Err(error) => Err(object_storage_error("head", error)),
        }
    }

    async fn verify_exact_object(
        &self,
        path: &ObjectPath,
        expected: &[u8],
        operation: &'static str,
    ) -> Result<(), SubjectPrivacyError> {
        let actual = self
            .read_object_bounded(path, expected.len().saturating_add(1), operation)
            .await?
            .ok_or_else(|| {
                SubjectPrivacyError::Storage(format!(
                    "{operation}: object {path} vanished after a successful create"
                ))
            })?;
        if actual.as_ref() != expected {
            return Err(SubjectPrivacyError::Storage(format!(
                "{operation}: immutable object {path} differs from written bytes"
            )));
        }
        Ok(())
    }

    fn wrap_subject_key(
        &self,
        subject_id: SubjectId,
        key: &[u8; 32],
    ) -> Result<SubjectKeyObject, SubjectPrivacyError> {
        let cipher = XChaCha20Poly1305::new((&self.wrap_key).into());
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let aad = format!(
            "fmarch:subject-key:v1:{}:{subject_id}:{}",
            self.authority_id, self.wrap_kid
        );
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: key,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| SubjectPrivacyError::Encryption)?;
        Ok(SubjectKeyObject {
            scheme: SUBJECT_KEY_OBJECT_SCHEME.to_string(),
            alg: SUBJECT_ENVELOPE_ALG.to_string(),
            kid: self.wrap_kid.clone(),
            nonce: STANDARD.encode(nonce),
            ciphertext: STANDARD.encode(ciphertext),
        })
    }

    fn unwrap_subject_key(
        &self,
        subject_id: SubjectId,
        object: &SubjectKeyObject,
    ) -> Result<[u8; 32], SubjectPrivacyError> {
        if object.scheme != SUBJECT_KEY_OBJECT_SCHEME
            || object.alg != SUBJECT_ENVELOPE_ALG
            || object.kid != self.wrap_kid
        {
            return Err(SubjectPrivacyError::InvalidEnvelope(format!(
                "subject key object {subject_id} has an unknown scheme, algorithm, or key id"
            )));
        }
        let nonce = STANDARD
            .decode(&object.nonce)
            .map_err(|error| SubjectPrivacyError::InvalidEnvelope(error.to_string()))?;
        if nonce.len() != 24 {
            return Err(SubjectPrivacyError::InvalidEnvelope(
                "subject key object nonce must be 24 bytes".to_string(),
            ));
        }
        let ciphertext = STANDARD
            .decode(&object.ciphertext)
            .map_err(|error| SubjectPrivacyError::InvalidEnvelope(error.to_string()))?;
        let cipher = XChaCha20Poly1305::new((&self.wrap_key).into());
        let aad = format!(
            "fmarch:subject-key:v1:{}:{subject_id}:{}",
            self.authority_id, self.wrap_kid
        );
        let plaintext = cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| SubjectPrivacyError::Authentication)?;
        plaintext.as_slice().try_into().map_err(|_| {
            SubjectPrivacyError::InvalidEnvelope(format!(
                "subject key {subject_id} plaintext must be 32 bytes"
            ))
        })
    }

    fn sign_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<SubjectRevocationObject, SubjectPrivacyError> {
        let record_bytes = serde_json::to_vec(record)
            .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.journal_key)
            .map_err(|error| SubjectPrivacyError::Configuration(error.to_string()))?;
        mac.update(
            format!(
                "fmarch:subject-revocation:v1:{}:{}:",
                self.authority_id, self.journal_kid
            )
            .as_bytes(),
        );
        mac.update(&record_bytes);
        Ok(SubjectRevocationObject {
            scheme: SUBJECT_REVOCATION_OBJECT_SCHEME.to_string(),
            alg: "HMAC-SHA256".to_string(),
            kid: self.journal_kid.clone(),
            record: record.clone(),
            mac: STANDARD.encode(mac.finalize().into_bytes()),
        })
    }

    fn verify_revocation(
        &self,
        object: &SubjectRevocationObject,
    ) -> Result<SubjectRevocationRecord, SubjectPrivacyError> {
        if object.scheme != SUBJECT_REVOCATION_OBJECT_SCHEME
            || object.alg != "HMAC-SHA256"
            || object.kid != self.journal_kid
        {
            return Err(SubjectPrivacyError::Authentication);
        }
        let record_bytes = serde_json::to_vec(&object.record)
            .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        let tag = STANDARD
            .decode(&object.mac)
            .map_err(|_| SubjectPrivacyError::Authentication)?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.journal_key)
            .map_err(|error| SubjectPrivacyError::Configuration(error.to_string()))?;
        mac.update(
            format!(
                "fmarch:subject-revocation:v1:{}:{}:",
                self.authority_id, self.journal_kid
            )
            .as_bytes(),
        );
        mac.update(&record_bytes);
        mac.verify_slice(&tag)
            .map_err(|_| SubjectPrivacyError::Authentication)?;
        Ok(object.record.clone())
    }
}

#[async_trait::async_trait]
impl SubjectKeyStore for ObjectSubjectKeyStore {
    async fn check_readiness(&self) -> Result<(), SubjectPrivacyError> {
        self.require_manifest().await.map(|_| ())
    }

    async fn create(&self, subject_id: SubjectId) -> Result<(), SubjectPrivacyError> {
        if self.exists(&revocation_object_path(subject_id)).await? {
            return Err(SubjectPrivacyError::MissingKey { subject_id });
        }
        let path = key_object_path(subject_id);
        let mut key = [0_u8; 32];
        rand::RngCore::fill_bytes(&mut OsRng, &mut key);
        let object = self.wrap_subject_key(subject_id, &key)?;
        let bytes = serde_json::to_vec(&object)
            .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        match self
            .store
            .put_opts(
                &path,
                Bytes::copy_from_slice(&bytes).into(),
                PutMode::Create.into(),
            )
            .await
        {
            Ok(_) => {
                self.verify_exact_object(&path, &bytes, "verify-key-create")
                    .await?
            }
            Err(object_store::Error::AlreadyExists { .. }) => {
                let _ = self.load(subject_id).await?;
            }
            Err(error) => return Err(object_storage_error("create-key", error)),
        }
        if self.exists(&revocation_object_path(subject_id)).await? {
            let _ = self.destroy(subject_id).await?;
            return Err(SubjectPrivacyError::MissingKey { subject_id });
        }
        Ok(())
    }

    async fn load(&self, subject_id: SubjectId) -> Result<[u8; 32], SubjectPrivacyError> {
        let revocation = revocation_object_path(subject_id);
        if self.exists(&revocation).await? {
            return Err(SubjectPrivacyError::MissingKey { subject_id });
        }
        let bytes = self
            .read_object_bounded(
                &key_object_path(subject_id),
                SUBJECT_KEY_OBJECT_MAX_BYTES,
                "load-key",
            )
            .await?
            .ok_or(SubjectPrivacyError::MissingKey { subject_id })?;
        if self.exists(&revocation).await? {
            return Err(SubjectPrivacyError::MissingKey { subject_id });
        }
        let object: SubjectKeyObject = serde_json::from_slice(&bytes).map_err(|error| {
            SubjectPrivacyError::Storage(format!(
                "subject key object {subject_id} is invalid: {error}"
            ))
        })?;
        self.unwrap_subject_key(subject_id, &object)
    }

    async fn destroy(&self, subject_id: SubjectId) -> Result<bool, SubjectPrivacyError> {
        let path = key_object_path(subject_id);
        let was_present = self.exists(&path).await?;
        match self.store.delete(&path).await {
            Ok(()) | Err(object_store::Error::NotFound { .. }) => {}
            Err(error) => return Err(object_storage_error("destroy-key", error)),
        }
        if self.exists(&path).await? {
            return Err(SubjectPrivacyError::Storage(format!(
                "destroy-key: key object {path} is still visible after deletion"
            )));
        }
        Ok(was_present)
    }

    async fn record_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<(), SubjectPrivacyError> {
        let path = revocation_object_path(record.subject_id);
        let object = self.sign_revocation(record)?;
        let bytes = serde_json::to_vec(&object)
            .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        match self
            .store
            .put_opts(
                &path,
                Bytes::copy_from_slice(&bytes).into(),
                PutMode::Create.into(),
            )
            .await
        {
            Ok(_) => {
                self.verify_exact_object(&path, &bytes, "verify-revocation-create")
                    .await
            }
            Err(object_store::Error::AlreadyExists { .. }) => self
                .verify_exact_object(&path, &bytes, "verify-existing-revocation")
                .await
                .map_err(|_| {
                    SubjectPrivacyError::Storage(format!(
                        "conflicting revocation record for subject {}",
                        record.subject_id
                    ))
                }),
            Err(error) => Err(object_storage_error("create-revocation", error)),
        }
    }

    async fn revocations(&self) -> Result<Vec<SubjectRevocationRecord>, SubjectPrivacyError> {
        let prefix = revocations_object_prefix();
        let objects = self
            .store
            .list(Some(&prefix))
            .try_collect::<Vec<_>>()
            .await
            .map_err(|error| object_storage_error("list-revocations", error))?;
        let mut records = futures_util::stream::iter(objects)
            .map(|object| async move {
                let bytes = self
                    .read_object_bounded(
                        &object.location,
                        SUBJECT_REVOCATION_OBJECT_MAX_BYTES,
                        "read-revocation",
                    )
                    .await?
                    .ok_or_else(|| {
                        SubjectPrivacyError::Storage(format!(
                            "revocation {} vanished during authority listing",
                            object.location
                        ))
                    })?;
                let envelope: SubjectRevocationObject = serde_json::from_slice(&bytes)
                    .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
                let record = self.verify_revocation(&envelope)?;
                if object.location != revocation_object_path(record.subject_id) {
                    return Err(SubjectPrivacyError::Storage(format!(
                        "revocation object {} does not match subject {}",
                        object.location, record.subject_id
                    )));
                }
                Ok(record)
            })
            .buffer_unordered(SUBJECT_AUTHORITY_IO_CONCURRENCY)
            .try_collect::<Vec<_>>()
            .await?;
        records.sort_by_key(|record| (record.destroyed_at, record.subject_id.as_uuid()));
        Ok(records)
    }
}

#[derive(Clone)]
pub struct ConfiguredSubjectKeyAuthority {
    pub key_store: Arc<dyn SubjectKeyStore>,
    pub manifest: Option<SubjectAuthorityManifest>,
}

impl std::fmt::Debug for ConfiguredSubjectKeyAuthority {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConfiguredSubjectKeyAuthority")
            .field("key_store", &"subject-key-store")
            .field("manifest", &self.manifest)
            .finish()
    }
}

/// Build the normal process authority and prove that its immutable manifest is
/// present before returning it. Object storage is mandatory in release builds;
/// the filesystem path exists only to keep debug and test runs hermetic.
pub async fn configured_subject_key_authority(
) -> Result<ConfiguredSubjectKeyAuthority, SubjectPrivacyError> {
    let object_variables = [
        SUBJECT_AUTHORITY_ENDPOINT_ENV,
        SUBJECT_AUTHORITY_REGION_ENV,
        SUBJECT_AUTHORITY_BUCKET_ENV,
        SUBJECT_AUTHORITY_ACCESS_KEY_ENV,
        SUBJECT_AUTHORITY_SECRET_KEY_ENV,
        SUBJECT_AUTHORITY_URL_STYLE_ENV,
        SUBJECT_AUTHORITY_ALLOW_HTTP_ENV,
        SUBJECT_AUTHORITY_ID_ENV,
        SUBJECT_AUTHORITY_WRAP_KID_ENV,
        SUBJECT_AUTHORITY_WRAP_KEY_ENV,
        SUBJECT_AUTHORITY_JOURNAL_KID_ENV,
        SUBJECT_AUTHORITY_JOURNAL_KEY_ENV,
    ];
    let object_configured = object_variables
        .iter()
        .any(|name| std::env::var_os(name).is_some());
    let filesystem_configured = std::env::var_os(SUBJECT_KEY_DIR_ENV).is_some();
    if object_configured && filesystem_configured {
        return Err(SubjectPrivacyError::Configuration(format!(
            "{SUBJECT_KEY_DIR_ENV} cannot be combined with the shared object subject authority"
        )));
    }
    if object_configured || !cfg!(debug_assertions) {
        let store = ObjectSubjectKeyStore::s3(ObjectSubjectKeyStoreConfig::from_environment()?)?;
        let manifest = store.require_manifest().await?;
        return Ok(ConfiguredSubjectKeyAuthority {
            key_store: Arc::new(store),
            manifest: Some(manifest),
        });
    }
    Ok(ConfiguredSubjectKeyAuthority {
        key_store: Arc::new(FilesystemSubjectKeyStore::from_environment()?),
        manifest: None,
    })
}

pub async fn configured_subject_key_store() -> Result<Arc<dyn SubjectKeyStore>, SubjectPrivacyError>
{
    Ok(configured_subject_key_authority().await?.key_store)
}

/// Return the process-wide authority installed by the composition root. Debug
/// tests that do not run the server may use the hermetic filesystem adapter.
pub async fn active_subject_key_store() -> Result<Arc<dyn SubjectKeyStore>, SubjectPrivacyError> {
    if let Some(store) = ACTIVE_SUBJECT_KEY_STORE.get() {
        return Ok(Arc::clone(store));
    }
    configured_subject_key_store().await
}

pub fn install_subject_key_store(
    store: Arc<dyn SubjectKeyStore>,
) -> Result<(), SubjectPrivacyError> {
    ACTIVE_SUBJECT_KEY_STORE.set(store).map_err(|_| {
        SubjectPrivacyError::Configuration(
            "the process subject key authority has already been installed".to_string(),
        )
    })
}

/// Explicit one-time initialization for a new empty shared authority. Normal
/// startup never calls this and therefore cannot bless an empty or wrong bucket.
pub async fn bootstrap_subject_key_authority_from_environment(
) -> Result<SubjectAuthorityManifest, SubjectPrivacyError> {
    if std::env::var_os(SUBJECT_AUTHORITY_ENDPOINT_ENV).is_none() {
        return Err(SubjectPrivacyError::Configuration(format!(
            "{SUBJECT_AUTHORITY_ENDPOINT_ENV} is required for authority bootstrap"
        )));
    }
    let store = ObjectSubjectKeyStore::s3(ObjectSubjectKeyStoreConfig::from_environment()?)?;
    store.bootstrap().await
}

fn required_authority_env(name: &str) -> Result<String, SubjectPrivacyError> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            SubjectPrivacyError::Configuration(format!("{name} is required and must not be blank"))
        })
}

fn decode_authority_key(name: &str) -> Result<[u8; 32], SubjectPrivacyError> {
    let encoded = required_authority_env(name)?;
    let decoded = STANDARD.decode(encoded).map_err(|error| {
        SubjectPrivacyError::Configuration(format!("{name} must be base64: {error}"))
    })?;
    decoded.try_into().map_err(|decoded: Vec<u8>| {
        SubjectPrivacyError::Configuration(format!(
            "{name} must decode to 32 bytes, found {}",
            decoded.len()
        ))
    })
}

fn subject_authority_bucket_endpoint(
    config: &ObjectSubjectKeyStoreConfig,
) -> Result<String, SubjectPrivacyError> {
    let mut endpoint = Url::parse(&config.endpoint).map_err(|error| {
        SubjectPrivacyError::Configuration(format!(
            "{SUBJECT_AUTHORITY_ENDPOINT_ENV} is invalid: {error}"
        ))
    })?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(SubjectPrivacyError::Configuration(format!(
            "{SUBJECT_AUTHORITY_ENDPOINT_ENV} must be an HTTP(S) base URL without credentials, query, or fragment"
        )));
    }
    if config.virtual_hosted_style {
        let host = endpoint.host_str().ok_or_else(|| {
            SubjectPrivacyError::Configuration(
                "virtual-hosted subject authority endpoint must have a DNS host".to_string(),
            )
        })?;
        let bucket_prefix = format!("{}.", config.bucket);
        if host != config.bucket && !host.starts_with(&bucket_prefix) {
            let bucket_host = format!("{}.{}", config.bucket, host);
            endpoint.set_host(Some(&bucket_host)).map_err(|_| {
                SubjectPrivacyError::Configuration(
                    "subject authority bucket and endpoint do not form a valid virtual-hosted URL"
                        .to_string(),
                )
            })?;
        }
    }
    Ok(endpoint.as_str().trim_end_matches('/').to_string())
}

fn authority_manifest_path() -> ObjectPath {
    ObjectPath::from(format!("{SUBJECT_AUTHORITY_PREFIX}/authority.json"))
}

fn key_object_path(subject_id: SubjectId) -> ObjectPath {
    ObjectPath::from(format!("{SUBJECT_AUTHORITY_PREFIX}/keys/{subject_id}.key"))
}

fn revocations_object_prefix() -> ObjectPath {
    ObjectPath::from(format!("{SUBJECT_AUTHORITY_PREFIX}/revocations"))
}

fn revocation_object_path(subject_id: SubjectId) -> ObjectPath {
    ObjectPath::from(format!(
        "{SUBJECT_AUTHORITY_PREFIX}/revocations/{subject_id}.json"
    ))
}

fn object_storage_error(
    operation: &'static str,
    error: object_store::Error,
) -> SubjectPrivacyError {
    SubjectPrivacyError::Storage(format!("{operation}: {error}"))
}

#[derive(Debug, Clone)]
pub struct FilesystemSubjectKeyStore {
    root: PathBuf,
    revision: Option<String>,
}

impl FilesystemSubjectKeyStore {
    pub fn from_environment() -> Result<Self, SubjectPrivacyError> {
        if !cfg!(debug_assertions) {
            return Err(SubjectPrivacyError::Configuration(
                "filesystem subject key storage is a debug/test adapter; release builds require the shared object authority"
                    .to_string(),
            ));
        }
        let revision = std::env::var(SUBJECT_AUTHORITY_REVISION_ENV)
            .ok()
            .map(|revision| revision.trim().to_string())
            .filter(|revision| !revision.is_empty());
        if let Ok(configured) = std::env::var(SUBJECT_KEY_DIR_ENV) {
            let configured = configured.trim();
            if configured.is_empty() {
                return Err(SubjectPrivacyError::Configuration(format!(
                    "{SUBJECT_KEY_DIR_ENV} must not be blank"
                )));
            }
            return Self::new_with_revision(configured, revision);
        }

        if cfg!(debug_assertions) {
            let root = std::env::var_os("CARGO_TARGET_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("target"))
                .join("subject-keys");
            return Self::new_with_revision(root, revision);
        }

        Err(SubjectPrivacyError::Configuration(format!(
            "{SUBJECT_KEY_DIR_ENV} is required in release builds"
        )))
    }

    pub fn new(root: impl Into<PathBuf>) -> Result<Self, SubjectPrivacyError> {
        if !cfg!(debug_assertions) {
            return Err(SubjectPrivacyError::Configuration(
                "filesystem subject key storage is unavailable in release builds".to_string(),
            ));
        }
        Self::new_with_revision(root, None)
    }

    fn new_with_revision(
        root: impl Into<PathBuf>,
        revision: Option<String>,
    ) -> Result<Self, SubjectPrivacyError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(storage_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(storage_error)?;
        }
        let store = Self { root, revision };
        store.validate_revision_marker()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn path(&self, subject_id: SubjectId) -> PathBuf {
        self.root.join(format!("{subject_id}.key"))
    }

    fn revocation_root(&self) -> PathBuf {
        self.root.join("revocations")
    }

    fn revocation_path(&self, subject_id: SubjectId) -> PathBuf {
        self.revocation_root().join(format!("{subject_id}.json"))
    }

    fn validate_revision_marker(&self) -> Result<(), SubjectPrivacyError> {
        let Some(revision) = self.revision.as_deref() else {
            return Ok(());
        };
        let marker = self.root.join(SUBJECT_AUTHORITY_MARKER);
        match fs::read_to_string(&marker) {
            Ok(existing) if existing.trim() == revision => Ok(()),
            Ok(existing) => Err(SubjectPrivacyError::Configuration(format!(
                "subject key authority revision mismatch: expected `{revision}`, found `{}`",
                existing.trim()
            ))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let has_authority_state = fs::read_dir(&self.root)
                    .map_err(storage_error)?
                    .next()
                    .transpose()
                    .map_err(storage_error)?
                    .is_some();
                if has_authority_state {
                    return Err(SubjectPrivacyError::Configuration(
                        "non-empty subject key authority is missing its revision marker"
                            .to_string(),
                    ));
                }
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options.open(marker).map_err(storage_error)?;
                file.write_all(revision.as_bytes()).map_err(storage_error)?;
                file.sync_all().map_err(storage_error)?;
                sync_directory(&self.root)
            }
            Err(error) => Err(storage_error(error)),
        }
    }
}

#[async_trait::async_trait]
impl SubjectKeyStore for FilesystemSubjectKeyStore {
    async fn check_readiness(&self) -> Result<(), SubjectPrivacyError> {
        Ok(())
    }

    async fn create(&self, subject_id: SubjectId) -> Result<(), SubjectPrivacyError> {
        let path = self.path(subject_id);
        let mut key = [0_u8; 32];
        rand::RngCore::fill_bytes(&mut OsRng, &mut key);

        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
            Err(error) => return Err(storage_error(error)),
        };
        file.write_all(&key).map_err(storage_error)?;
        file.sync_all().map_err(storage_error)?;
        sync_directory(&self.root)?;
        Ok(())
    }

    async fn load(&self, subject_id: SubjectId) -> Result<[u8; 32], SubjectPrivacyError> {
        if self.revocation_path(subject_id).exists() {
            return Err(SubjectPrivacyError::MissingKey { subject_id });
        }
        let path = self.path(subject_id);
        let mut file = match OpenOptions::new().read(true).open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(SubjectPrivacyError::MissingKey { subject_id })
            }
            Err(error) => return Err(storage_error(error)),
        };
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(storage_error)?;
        bytes.try_into().map_err(|bytes: Vec<u8>| {
            SubjectPrivacyError::Storage(format!(
                "subject key {subject_id} must be 32 bytes, found {}",
                bytes.len()
            ))
        })
    }

    async fn destroy(&self, subject_id: SubjectId) -> Result<bool, SubjectPrivacyError> {
        match fs::remove_file(self.path(subject_id)) {
            Ok(()) => {
                sync_directory(&self.root)?;
                Ok(true)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(storage_error(error)),
        }
    }

    async fn record_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<(), SubjectPrivacyError> {
        let directory = self.revocation_root();
        fs::create_dir_all(&directory).map_err(storage_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .map_err(storage_error)?;
        }
        let destination = self.revocation_path(record.subject_id);
        let serialized = serde_json::to_vec(record)
            .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        if destination.exists() {
            let existing = fs::read(&destination).map_err(storage_error)?;
            if existing == serialized {
                return Ok(());
            }
            return Err(SubjectPrivacyError::Storage(format!(
                "conflicting revocation record for subject {}",
                record.subject_id
            )));
        }

        let temporary = directory.join(format!(
            ".{}.{}.tmp",
            record.subject_id,
            Uuid::new_v4().simple()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(storage_error)?;
        file.write_all(&serialized).map_err(storage_error)?;
        file.sync_all().map_err(storage_error)?;
        match fs::hard_link(&temporary, &destination) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let existing = fs::read(&destination).map_err(storage_error)?;
                if existing != serialized {
                    let _ = fs::remove_file(&temporary);
                    return Err(SubjectPrivacyError::Storage(format!(
                        "conflicting revocation record for subject {}",
                        record.subject_id
                    )));
                }
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(storage_error(error));
            }
        }
        fs::remove_file(temporary).map_err(storage_error)?;
        sync_directory(&directory)?;
        Ok(())
    }

    async fn revocations(&self) -> Result<Vec<SubjectRevocationRecord>, SubjectPrivacyError> {
        let directory = self.revocation_root();
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut records: Vec<SubjectRevocationRecord> = Vec::new();
        for entry in fs::read_dir(directory).map_err(storage_error)? {
            let entry = entry.map_err(storage_error)?;
            if entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                != Some("json")
            {
                continue;
            }
            let bytes = fs::read(entry.path()).map_err(storage_error)?;
            records.push(
                serde_json::from_slice(&bytes)
                    .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?,
            );
        }
        records.sort_by_key(|record| (record.destroyed_at, record.subject_id.as_uuid()));
        Ok(records)
    }
}

pub async fn seal_subject_claim<T: Serialize>(
    key_store: &dyn SubjectKeyStore,
    subject_id: SubjectId,
    claim_id: ClaimId,
    claim_kind: &str,
    scope: &str,
    value: &T,
) -> Result<SubjectClaimEnvelope, SubjectPrivacyError> {
    let key = key_store.load(subject_id).await?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let plaintext = serde_json::to_vec(value)
        .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
    let aad = claim_aad(subject_id, claim_id, claim_kind, scope);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| SubjectPrivacyError::Encryption)?;
    Ok(SubjectClaimEnvelope {
        scheme: SUBJECT_ENVELOPE_SCHEME.to_string(),
        alg: SUBJECT_ENVELOPE_ALG.to_string(),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

pub async fn open_subject_claim<T: for<'de> Deserialize<'de>>(
    key_store: &dyn SubjectKeyStore,
    subject_id: SubjectId,
    claim_id: ClaimId,
    claim_kind: &str,
    scope: &str,
    envelope: &SubjectClaimEnvelope,
) -> Result<T, SubjectPrivacyError> {
    if envelope.scheme != SUBJECT_ENVELOPE_SCHEME || envelope.alg != SUBJECT_ENVELOPE_ALG {
        return Err(SubjectPrivacyError::InvalidEnvelope(
            "unknown scheme or algorithm".to_string(),
        ));
    }
    let nonce = STANDARD
        .decode(&envelope.nonce)
        .map_err(|error| SubjectPrivacyError::InvalidEnvelope(error.to_string()))?;
    if nonce.len() != 24 {
        return Err(SubjectPrivacyError::InvalidEnvelope(
            "nonce must be 24 bytes".to_string(),
        ));
    }
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|error| SubjectPrivacyError::InvalidEnvelope(error.to_string()))?;
    let key = key_store.load(subject_id).await?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let aad = claim_aad(subject_id, claim_id, claim_kind, scope);
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| SubjectPrivacyError::Authentication)?;
    serde_json::from_slice(&plaintext)
        .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))
}

pub fn random_tombstone_alias() -> String {
    let random = Uuid::new_v4().simple().to_string();
    format!("Former member {random}")
}

/// Reapply the external revocation authority after any database restore.
///
/// This must run before the server accepts traffic. It is intentionally
/// idempotent and only moves identity state toward the erased condition.
pub async fn reconcile_subject_revocations(
    pool: &sqlx::PgPool,
) -> Result<usize, SubjectPrivacyError> {
    let key_store = active_subject_key_store().await?;
    reconcile_subject_revocations_with_store(pool, key_store.as_ref()).await
}

pub async fn reconcile_subject_revocations_with_store(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
) -> Result<usize, SubjectPrivacyError> {
    let records = key_store.revocations().await?;
    let pending = unreconciled_subject_revocations(pool, &records)
        .await?
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    let reconciled = pending.len();
    futures_util::stream::iter(pending)
        .map(|record| async move { reconcile_subject_revocation(pool, key_store, &record).await })
        .buffer_unordered(SUBJECT_AUTHORITY_IO_CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await?;
    let journaled = records
        .iter()
        .map(|record| record.subject_id.as_uuid())
        .collect::<std::collections::BTreeSet<_>>();
    let database_tombstones =
        sqlx::query_scalar::<_, Uuid>("SELECT subject_id FROM subject_tombstone")
            .fetch_all(pool)
            .await
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if let Some(unbacked) = database_tombstones
        .into_iter()
        .find(|subject_id| !journaled.contains(subject_id))
    {
        return Err(SubjectPrivacyError::Storage(format!(
            "database tombstone {unbacked} has no external revocation record"
        )));
    }
    Ok(reconciled)
}

async fn discover_revoked_subject_owner(
    pool: &sqlx::PgPool,
    subject_id: SubjectId,
) -> Result<String, SubjectPrivacyError> {
    let owner = sqlx::query_scalar::<_, Option<String>>(
        "SELECT principal_user_id FROM privacy_subject WHERE subject_id = $1",
    )
    .bind(subject_id.as_uuid())
    .fetch_optional(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?
    .flatten()
    .ok_or_else(|| {
        SubjectPrivacyError::Storage(format!(
            "revoked subject {subject_id} has no canonical principal owner; explicit recovery is required"
        ))
    })?;
    let legacy_owners = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT principal_user_id FROM member_lifecycle_event WHERE subject_id = $1 ORDER BY principal_user_id",
    )
    .bind(subject_id.as_uuid())
    .fetch_all(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if legacy_owners.iter().any(|legacy| legacy != &owner) {
        return Err(SubjectPrivacyError::Storage(format!(
            "revoked subject {subject_id} has conflicting canonical and legacy owners; explicit recovery is required"
        )));
    }
    Ok(owner)
}

async fn reconcile_subject_revocation(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
    record: &SubjectRevocationRecord,
) -> Result<(), SubjectPrivacyError> {
    use sqlx::Row;

    // Owner discovery takes no row lock. The transaction then follows the one
    // canonical identity order used by claim issuance and erasure: principal
    // first, subject second. Revalidating the subject after both locks closes
    // the discovery-to-lock race without ever taking subject -> principal.
    let principal = discover_revoked_subject_owner(pool, record.subject_id).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let principal_exists = sqlx::query_scalar::<_, String>(
        "SELECT status FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(&principal)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?
    .is_some();
    if !principal_exists {
        return Err(SubjectPrivacyError::Storage(format!(
            "revoked subject {} owner `{principal}` is missing; explicit recovery is required",
            record.subject_id
        )));
    }
    let subject = sqlx::query(
        "SELECT principal_user_id, lifecycle_state FROM privacy_subject WHERE subject_id = $1 FOR UPDATE",
    )
    .bind(record.subject_id.as_uuid())
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?
    .ok_or_else(|| {
        SubjectPrivacyError::Storage(format!(
            "revoked subject {} disappeared after owner discovery; explicit recovery is required",
            record.subject_id
        ))
    })?;
    let locked_owner: Option<String> = subject.try_get("principal_user_id").map_err(|error| {
        SubjectPrivacyError::Storage(format!(
            "revoked subject {} owner is invalid: {error}",
            record.subject_id
        ))
    })?;
    if locked_owner.as_deref() != Some(principal.as_str()) {
        return Err(SubjectPrivacyError::Storage(format!(
            "revoked subject {} changed owners during reconciliation; explicit recovery is required",
            record.subject_id
        )));
    }

    // Keep both database locks across irreversible key deletion. A claim that
    // already owns them commits first and is scrubbed below; a later claim
    // waits, observes the erased subject, and rejects.
    let key_was_present = key_store.destroy(record.subject_id).await?;
    sqlx::query("UPDATE privacy_subject SET lifecycle_state = 'erased' WHERE subject_id = $1")
        .bind(record.subject_id.as_uuid())
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query(
        "INSERT INTO subject_tombstone (subject_id, replacement_alias, destroyed_at) VALUES ($1,$2,$3) ON CONFLICT (subject_id) DO NOTHING",
    )
    .bind(record.subject_id.as_uuid())
    .bind(&record.replacement_alias)
    .bind(record.destroyed_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query(
        "INSERT INTO subject_key_destruction_receipt (receipt_id, subject_id, key_fingerprint_sha256, key_was_present, destroyed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subject_id) DO NOTHING",
    )
    .bind(record.receipt_id)
    .bind(record.subject_id.as_uuid())
    .bind(&record.key_fingerprint_sha256)
    .bind(key_was_present)
    .bind(record.destroyed_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;

    let evidence = sqlx::query(
        r#"
        SELECT tombstone.replacement_alias,
               tombstone.destroyed_at AS tombstone_destroyed_at,
               receipt.receipt_id,
               receipt.key_fingerprint_sha256,
               receipt.destroyed_at AS receipt_destroyed_at
        FROM subject_tombstone AS tombstone
        JOIN subject_key_destruction_receipt AS receipt USING (subject_id)
        WHERE tombstone.subject_id = $1
        "#,
    )
    .bind(record.subject_id.as_uuid())
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if evidence.get::<String, _>("replacement_alias") != record.replacement_alias
        || evidence.get::<i64, _>("tombstone_destroyed_at") != record.destroyed_at
        || evidence.get::<Uuid, _>("receipt_id") != record.receipt_id
        || evidence.get::<String, _>("key_fingerprint_sha256") != record.key_fingerprint_sha256
        || evidence.get::<i64, _>("receipt_destroyed_at") != record.destroyed_at
    {
        return Err(SubjectPrivacyError::Storage(format!(
            "database erasure evidence conflicts with external revocation for subject {}",
            record.subject_id
        )));
    }

    // Remove every sealed presentation/owner claim. Canonical events retain
    // only opaque ids and rebuild through the tombstone branch.
    sqlx::query("DELETE FROM subject_private_claim WHERE subject_id = $1")
        .bind(record.subject_id.as_uuid())
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    scrub_subject_projections(
        &mut tx,
        record.subject_id,
        &record.replacement_alias,
        Some(&principal),
        record.destroyed_at,
    )
    .await?;
    reconcile_member_lifecycle(&mut tx, record, &principal).await?;
    sqlx::query("DELETE FROM member_personal_export WHERE principal_user_id = $1")
        .bind(&principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM workos_session_exchange WHERE subject IN (SELECT subject FROM external_identity WHERE principal_user_id = $1)")
        .bind(&principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM external_identity WHERE principal_user_id = $1")
        .bind(&principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE authentication_method SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2) WHERE principal_user_id = $1")
        .bind(&principal).bind(record.destroyed_at).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE auth_session SET revoked_at = COALESCE(revoked_at, $2) WHERE principal_user_id = $1")
        .bind(&principal).bind(record.destroyed_at).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_websocket_ticket WHERE principal_user_id = $1")
        .bind(&principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_invite WHERE principal_user_id = $1 OR account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(&principal).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_delivery_intent WHERE principal_user_id = $1 OR account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(&principal).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_account_recovery_credential WHERE account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(&principal).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let erased_account_id = format!("erased_{}", record.receipt_id.simple());
    sqlx::query("UPDATE auth_account SET account_id = $2, disabled_at = COALESCE(disabled_at, $3), password_hash = $4, global_capabilities = '{}'::text[] WHERE principal_user_id = $1")
        .bind(&principal).bind(erased_account_id).bind(record.destroyed_at).bind(format!("erased:{}", record.receipt_id)).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE identity_lifecycle_audit SET actor_user_id = CASE WHEN actor_user_id = $1 THEN $2 ELSE actor_user_id END, principal_user_id = $2, metadata = '{}'::jsonb WHERE principal_user_id = $1 OR actor_user_id = $1")
        .bind(&principal).bind(&record.replacement_alias).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE platform_principal SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2), global_capabilities = '{}'::text[] WHERE principal_user_id = $1")
        .bind(&principal).bind(record.destroyed_at).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    tx.commit()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))
}

/// Identify journal records whose complete database-side erasure transaction
/// has not committed yet. A matching destruction receipt, tombstone, and
/// irreversible subject state are the transaction's durable completion marker.
///
/// The external journal is still fully listed and authenticated on every
/// startup. This filter only avoids repeating key deletion and the large
/// database scrub transaction for records already proven complete.
async fn unreconciled_subject_revocations<'a>(
    pool: &sqlx::PgPool,
    records: &'a [SubjectRevocationRecord],
) -> Result<Vec<&'a SubjectRevocationRecord>, SubjectPrivacyError> {
    use sqlx::Row;
    use std::collections::HashMap;

    if records.is_empty() {
        return Ok(Vec::new());
    }
    let subject_ids = records
        .iter()
        .map(|record| record.subject_id.as_uuid())
        .collect::<Vec<_>>();
    let rows = sqlx::query(
        r#"
        SELECT receipt.subject_id,
               receipt.receipt_id,
               receipt.key_fingerprint_sha256,
               receipt.destroyed_at AS receipt_destroyed_at,
               tombstone.replacement_alias,
               tombstone.destroyed_at AS tombstone_destroyed_at,
               subject.lifecycle_state
        FROM subject_key_destruction_receipt AS receipt
        JOIN subject_tombstone AS tombstone USING (subject_id)
        JOIN privacy_subject AS subject USING (subject_id)
        WHERE receipt.subject_id = ANY($1)
        "#,
    )
    .bind(&subject_ids)
    .fetch_all(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let committed = rows
        .into_iter()
        .map(|row| (row.get::<Uuid, _>("subject_id"), row))
        .collect::<HashMap<_, _>>();

    let mut pending = Vec::new();
    for record in records {
        let Some(row) = committed.get(&record.subject_id.as_uuid()) else {
            pending.push(record);
            continue;
        };
        let receipt_matches = row.get::<Uuid, _>("receipt_id") == record.receipt_id
            && row.get::<String, _>("key_fingerprint_sha256") == record.key_fingerprint_sha256
            && row.get::<i64, _>("receipt_destroyed_at") == record.destroyed_at;
        let tombstone_matches = row.get::<String, _>("replacement_alias")
            == record.replacement_alias
            && row.get::<i64, _>("tombstone_destroyed_at") == record.destroyed_at;
        if !receipt_matches || !tombstone_matches {
            return Err(SubjectPrivacyError::Storage(format!(
                "database erasure evidence conflicts with external revocation for subject {}",
                record.subject_id
            )));
        }
        if row.get::<String, _>("lifecycle_state") != "erased" {
            pending.push(record);
        }
    }
    Ok(pending)
}

/// Bind an empty database to one immutable authority genesis, reconcile its
/// append-only revocation journal, then prove every active subject key can be
/// authenticated and unwrapped. The server calls this before spawning any
/// listener or background worker.
pub async fn prepare_subject_authority_for_service(
    pool: &sqlx::PgPool,
    authority: &ConfiguredSubjectKeyAuthority,
) -> Result<usize, SubjectPrivacyError> {
    if let Some(manifest) = authority.manifest.as_ref() {
        verify_or_bind_database_authority(pool, manifest).await?;
    } else if !cfg!(debug_assertions) {
        return Err(SubjectPrivacyError::Configuration(
            "release startup requires a manifest-backed shared subject authority".to_string(),
        ));
    }
    let reconciled =
        reconcile_subject_revocations_with_store(pool, authority.key_store.as_ref()).await?;
    verify_active_subject_keys(pool, authority.key_store.as_ref()).await?;
    Ok(reconciled)
}

pub async fn verify_or_bind_database_authority(
    pool: &sqlx::PgPool,
    manifest: &SubjectAuthorityManifest,
) -> Result<(), SubjectPrivacyError> {
    use sqlx::Row;

    let manifest_bytes = serde_json::to_vec(manifest)
        .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
    let manifest_sha256 = format!("{:x}", Sha256::digest(manifest_bytes));
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('fmarch:subject-authority-binding', 0))",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let existing = sqlx::query(
        "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE FOR UPDATE",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if let Some(existing) = existing {
        let authority_id: Uuid = existing.get("authority_id");
        let revision: String = existing.get("authority_revision");
        let digest: String = existing.get("manifest_sha256");
        if authority_id != manifest.authority_id
            || revision != manifest.revision
            || digest != manifest_sha256
        {
            return Err(SubjectPrivacyError::Configuration(format!(
                "database is bound to subject authority {authority_id}/{revision}, not {}/{}",
                manifest.authority_id, manifest.revision
            )));
        }
    } else {
        let database_has_identity_or_event_data: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM privacy_subject
                UNION ALL SELECT 1 FROM platform_principal
                UNION ALL SELECT 1 FROM member_lifecycle_event
                UNION ALL SELECT 1 FROM profile_editor
                UNION ALL SELECT 1 FROM game_persona_private
                UNION ALL SELECT 1 FROM events
            )
            "#,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
        if database_has_identity_or_event_data {
            return Err(SubjectPrivacyError::Configuration(
                "a non-empty database has no subject authority binding; explicit recovery is required"
                    .to_string(),
            ));
        }
        let bound_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?
            .as_secs() as i64;
        sqlx::query(
            "INSERT INTO subject_authority_binding (singleton, authority_id, authority_revision, manifest_sha256, bound_at) VALUES (TRUE, $1, $2, $3, $4)",
        )
        .bind(manifest.authority_id)
        .bind(&manifest.revision)
        .bind(&manifest_sha256)
        .bind(bound_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
        let (bound_id, bound_revision, bound_digest): (Uuid, String, String) = sqlx::query_as(
            "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
        if bound_id != manifest.authority_id
            || bound_revision != manifest.revision
            || bound_digest != manifest_sha256
        {
            return Err(SubjectPrivacyError::Configuration(format!(
                "database was bound to a different subject authority {bound_id}/{bound_revision}"
            )));
        }
    }
    tx.commit()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))
}

pub async fn verify_active_subject_keys(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
) -> Result<(), SubjectPrivacyError> {
    use sqlx::Row;

    let subjects = sqlx::query(
        r#"
        SELECT subject.subject_id,
               subject.lifecycle_state,
               tombstone.subject_id IS NOT NULL AS tombstoned
        FROM privacy_subject AS subject
        LEFT JOIN subject_tombstone AS tombstone USING (subject_id)
        ORDER BY subject.subject_id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let mut active = Vec::new();
    for subject in subjects {
        let subject_id = SubjectId::from_uuid(subject.get("subject_id"));
        let lifecycle_state: String = subject.get("lifecycle_state");
        let tombstoned: bool = subject.get("tombstoned");
        match (lifecycle_state.as_str(), tombstoned) {
            ("active", false) => active.push(subject_id),
            ("erased", true) => {}
            _ => {
                return Err(SubjectPrivacyError::Storage(format!(
                    "subject {subject_id} has inconsistent lifecycle state `{lifecycle_state}` and tombstone={tombstoned}"
                )))
            }
        }
    }
    futures_util::stream::iter(active)
        .map(|subject_id| async move {
            key_store
                .load(subject_id)
                .await
                .map(|_| ())
                .map_err(|error| {
                    SubjectPrivacyError::Storage(format!(
                        "active subject {subject_id} has no valid authority key: {error}"
                    ))
                })
        })
        .buffer_unordered(SUBJECT_AUTHORITY_IO_CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await?;
    Ok(())
}

async fn reconcile_member_lifecycle(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    record: &SubjectRevocationRecord,
    principal: &str,
) -> Result<(), SubjectPrivacyError> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT seq, kind FROM member_lifecycle_event WHERE principal_user_id = $1 ORDER BY seq",
    )
    .bind(principal)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let mut next_seq = rows.last().map(|row| row.get::<i64, _>("seq")).unwrap_or(0);
    let existing = rows
        .iter()
        .map(|row| row.get::<String, _>("kind"))
        .collect::<std::collections::BTreeSet<_>>();
    for (kind, payload) in [
        (
            "MemberDeactivated",
            serde_json::json!({"reason": "external_revocation_reconciliation"}),
        ),
        ("MemberErasureRequested", serde_json::json!({})),
        ("MemberCredentialsErased", serde_json::json!({})),
        ("MemberAuthorshipPseudonymized", serde_json::json!({})),
    ] {
        if existing.contains(kind) {
            continue;
        }
        next_seq += 1;
        sqlx::query("INSERT INTO member_lifecycle_event (principal_user_id, seq, kind, payload, occurred_at, subject_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6)")
            .bind(principal)
            .bind(next_seq)
            .bind(kind)
            .bind(payload.to_string())
            .bind(record.destroyed_at)
            .bind(record.subject_id.as_uuid())
            .execute(&mut **tx)
            .await
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    }
    sqlx::query(
        r#"
        INSERT INTO member_lifecycle_projection
            (principal_user_id, status, last_seq, deactivated_at,
             erasure_requested_at, credentials_erased_at,
             authorship_pseudonymized_at, pseudonym, subject_id)
        VALUES ($1, 'erased', $2, $3, $3, $3, $3, $4, $5)
        ON CONFLICT (principal_user_id) DO UPDATE SET
            status = 'erased',
            last_seq = EXCLUDED.last_seq,
            deactivated_at = COALESCE(member_lifecycle_projection.deactivated_at, EXCLUDED.deactivated_at),
            erasure_requested_at = COALESCE(member_lifecycle_projection.erasure_requested_at, EXCLUDED.erasure_requested_at),
            credentials_erased_at = COALESCE(member_lifecycle_projection.credentials_erased_at, EXCLUDED.credentials_erased_at),
            authorship_pseudonymized_at = COALESCE(member_lifecycle_projection.authorship_pseudonymized_at, EXCLUDED.authorship_pseudonymized_at),
            pseudonym = EXCLUDED.pseudonym,
            subject_id = EXCLUDED.subject_id
        "#,
    )
    .bind(principal)
    .bind(next_seq)
    .bind(record.destroyed_at)
    .bind(&record.replacement_alias)
    .bind(record.subject_id.as_uuid())
    .execute(&mut **tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    Ok(())
}

async fn scrub_subject_projections(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subject_id: SubjectId,
    alias: &str,
    principal: Option<&str>,
    destroyed_at: i64,
) -> Result<(), SubjectPrivacyError> {
    let database_error = |error: sqlx::Error| SubjectPrivacyError::Storage(error.to_string());
    sqlx::query("UPDATE profile_public AS public SET handle = CONCAT('former-member-', REPLACE(public.profile_id::text, '-', '')), display_name = $2, bio = '', visibility = 'public' FROM profile_editor AS editor WHERE editor.profile_id = public.profile_id AND editor.subject_id = $1")
        .bind(subject_id.as_uuid()).bind(alias).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("UPDATE profile_editor SET principal_user_id = $2, current_claim_id = NULL WHERE subject_id = $1")
        .bind(subject_id.as_uuid()).bind(alias).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("DELETE FROM public_search_document WHERE scope_kind = 'profile' AND scope_id IN (SELECT profile_id FROM profile_editor WHERE subject_id = $1)")
        .bind(subject_id.as_uuid()).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("DELETE FROM game_persona_name_claim WHERE (game_id, persona_id) IN (SELECT game_id, persona_id FROM game_persona_private WHERE subject_id = $1)")
        .bind(subject_id.as_uuid()).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("UPDATE game_persona_name_history AS history SET public_name = $2 FROM game_persona_private AS private WHERE private.subject_id = $1 AND history.game_id = private.game_id AND history.persona_id = private.persona_id")
        .bind(subject_id.as_uuid()).bind(alias).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("UPDATE game_persona_public AS public SET current_public_name = $2, renamed_seq = COALESCE(public.renamed_seq, public.registered_seq) FROM game_persona_private AS private WHERE private.subject_id = $1 AND public.game_id = private.game_id AND public.persona_id = private.persona_id")
        .bind(subject_id.as_uuid()).bind(alias).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("INSERT INTO game_persona_redaction (game_id, persona_id, replacement_public_name, redacted_at) SELECT game_id, persona_id, $2, $3 FROM game_persona_private WHERE subject_id = $1 ON CONFLICT (game_id, persona_id) DO UPDATE SET replacement_public_name = EXCLUDED.replacement_public_name")
        .bind(subject_id.as_uuid()).bind(alias).bind(destroyed_at).execute(&mut **tx).await.map_err(database_error)?;
    sqlx::query("UPDATE game_persona_private SET principal_user_id = $2, current_claim_id = NULL WHERE subject_id = $1")
        .bind(subject_id.as_uuid()).bind(alias).execute(&mut **tx).await.map_err(database_error)?;
    if let Some(principal) = principal {
        sqlx::query("UPDATE thread_view SET author_user = $2 WHERE author_user = $1")
            .bind(principal)
            .bind(alias)
            .execute(&mut **tx)
            .await
            .map_err(database_error)?;
    }
    Ok(())
}

fn claim_aad(subject_id: SubjectId, claim_id: ClaimId, claim_kind: &str, scope: &str) -> String {
    format!("fmarch:subject-claim:v1:{subject_id}:{claim_id}:{claim_kind}:{scope}")
}

fn storage_error(error: std::io::Error) -> SubjectPrivacyError {
    SubjectPrivacyError::Storage(error.to_string())
}

fn sync_directory(path: &Path) -> Result<(), SubjectPrivacyError> {
    OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(storage_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, FilesystemSubjectKeyStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = FilesystemSubjectKeyStore::new(directory.path()).unwrap();
        (directory, store)
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_build_rejects_filesystem_authority() {
        let directory = tempfile::tempdir().unwrap();
        assert!(matches!(
            FilesystemSubjectKeyStore::new(directory.path()),
            Err(SubjectPrivacyError::Configuration(message))
                if message.contains("unavailable in release builds")
        ));
    }

    #[tokio::test]
    async fn envelope_authenticates_subject_claim_and_scope() {
        let (_directory, store) = store();
        let subject = SubjectId::random();
        let other_subject = SubjectId::random();
        let claim = ClaimId::random();
        store.create(subject).await.unwrap();
        store.create(other_subject).await.unwrap();
        let envelope = seal_subject_claim(
            &store,
            subject,
            claim,
            "profile",
            "profile-a",
            &serde_json::json!({"principal_user_id": "member-a", "display_name": "A"}),
        )
        .await
        .unwrap();

        let opened: serde_json::Value =
            open_subject_claim(&store, subject, claim, "profile", "profile-a", &envelope)
                .await
                .unwrap();
        assert_eq!(opened["display_name"], "A");
        assert!(matches!(
            open_subject_claim::<serde_json::Value>(
                &store,
                other_subject,
                claim,
                "profile",
                "profile-a",
                &envelope
            )
            .await,
            Err(SubjectPrivacyError::Authentication)
        ));
        assert!(matches!(
            open_subject_claim::<serde_json::Value>(
                &store,
                subject,
                claim,
                "profile",
                "profile-b",
                &envelope
            )
            .await,
            Err(SubjectPrivacyError::Authentication)
        ));
    }

    #[tokio::test]
    async fn destroying_one_subject_does_not_touch_another_subject() {
        let (_directory, store) = store();
        let first = SubjectId::random();
        let second = SubjectId::random();
        store.create(first).await.unwrap();
        store.create(second).await.unwrap();
        let first_fingerprint = store.fingerprint(first).await.unwrap();
        let second_fingerprint = store.fingerprint(second).await.unwrap();
        assert_ne!(first_fingerprint, second_fingerprint);

        assert!(store.destroy(first).await.unwrap());
        assert!(matches!(
            store.load(first).await,
            Err(SubjectPrivacyError::MissingKey { .. })
        ));
        assert_eq!(store.fingerprint(second).await.unwrap(), second_fingerprint);
    }

    #[tokio::test]
    async fn revocation_journal_is_monotonic_and_portable() {
        let (_directory, store) = store();
        let record = SubjectRevocationRecord {
            subject_id: SubjectId::random(),
            replacement_alias: random_tombstone_alias(),
            destroyed_at: 41,
            key_fingerprint_sha256: "ab".repeat(32),
            receipt_id: Uuid::new_v4(),
        };
        store.create(record.subject_id).await.unwrap();
        store.record_revocation(&record).await.unwrap();
        store.record_revocation(&record).await.unwrap();
        assert_eq!(store.revocations().await.unwrap(), vec![record.clone()]);
        assert!(matches!(
            store.load(record.subject_id).await,
            Err(SubjectPrivacyError::MissingKey { .. })
        ));

        let mut conflicting = record;
        conflicting.replacement_alias = random_tombstone_alias();
        assert!(matches!(
            store.record_revocation(&conflicting).await,
            Err(SubjectPrivacyError::Storage(_))
        ));
    }

    fn object_authority(store: Arc<dyn ObjectStore>, authority_id: Uuid) -> ObjectSubjectKeyStore {
        ObjectSubjectKeyStore::new(
            store,
            "test-revision",
            authority_id,
            "wrap-test-v1",
            [7_u8; 32],
            "journal-test-v1",
            [9_u8; 32],
        )
    }

    #[tokio::test]
    async fn object_authority_requires_genesis_and_wraps_keys() {
        let backing: Arc<dyn ObjectStore> = Arc::new(object_store::memory::InMemory::new());
        let authority_id = Uuid::new_v4();
        let store = object_authority(Arc::clone(&backing), authority_id);
        assert!(matches!(
            store.require_manifest().await,
            Err(SubjectPrivacyError::Configuration(_))
        ));
        let manifest = store.bootstrap().await.unwrap();
        assert_eq!(manifest.authority_id, authority_id);
        assert_eq!(store.require_manifest().await.unwrap(), manifest);
        assert!(matches!(
            store.bootstrap().await,
            Err(SubjectPrivacyError::Configuration(_))
        ));

        let subject_id = SubjectId::random();
        store.create(subject_id).await.unwrap();
        let plaintext_key = store.load(subject_id).await.unwrap();
        let raw = backing
            .get(&key_object_path(subject_id))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let object: SubjectKeyObject = serde_json::from_slice(&raw).unwrap();
        assert_eq!(object.scheme, SUBJECT_KEY_OBJECT_SCHEME);
        assert!(!String::from_utf8_lossy(&raw).contains(&STANDARD.encode(plaintext_key)));

        let wrong_genesis = object_authority(Arc::clone(&backing), Uuid::new_v4());
        assert!(matches!(
            wrong_genesis.require_manifest().await,
            Err(SubjectPrivacyError::Configuration(_))
        ));
        let wrong_bucket = object_authority(
            Arc::new(object_store::memory::InMemory::new()),
            authority_id,
        );
        assert!(matches!(
            wrong_bucket.require_manifest().await,
            Err(SubjectPrivacyError::Configuration(_))
        ));
    }

    #[tokio::test]
    async fn object_revocations_are_authenticated_create_only_and_destroy_keys() {
        let backing: Arc<dyn ObjectStore> = Arc::new(object_store::memory::InMemory::new());
        let store = object_authority(Arc::clone(&backing), Uuid::new_v4());
        store.bootstrap().await.unwrap();
        let subject_id = SubjectId::random();
        store.create(subject_id).await.unwrap();
        let record = SubjectRevocationRecord {
            subject_id,
            replacement_alias: random_tombstone_alias(),
            destroyed_at: 42,
            key_fingerprint_sha256: store.fingerprint(subject_id).await.unwrap(),
            receipt_id: Uuid::new_v4(),
        };
        store.record_revocation(&record).await.unwrap();
        store.record_revocation(&record).await.unwrap();
        assert_eq!(store.revocations().await.unwrap(), vec![record.clone()]);
        assert!(matches!(
            store.load(subject_id).await,
            Err(SubjectPrivacyError::MissingKey { .. })
        ));
        assert!(store.destroy(subject_id).await.unwrap());
        assert!(matches!(
            backing.head(&key_object_path(subject_id)).await,
            Err(object_store::Error::NotFound { .. })
        ));

        let mut envelope: SubjectRevocationObject = serde_json::from_slice(
            &backing
                .get(&revocation_object_path(subject_id))
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        )
        .unwrap();
        envelope.record.replacement_alias = random_tombstone_alias();
        backing
            .put(
                &revocation_object_path(subject_id),
                Bytes::from(serde_json::to_vec(&envelope).unwrap()).into(),
            )
            .await
            .unwrap();
        assert!(matches!(
            store.revocations().await,
            Err(SubjectPrivacyError::Authentication)
        ));
    }

    #[test]
    fn authority_revision_rejects_wrong_or_unmarked_nonempty_roots() {
        let directory = tempfile::tempdir().unwrap();
        FilesystemSubjectKeyStore::new_with_revision(
            directory.path(),
            Some("revision-a".to_string()),
        )
        .unwrap();
        assert!(matches!(
            FilesystemSubjectKeyStore::new_with_revision(
                directory.path(),
                Some("revision-b".to_string())
            ),
            Err(SubjectPrivacyError::Configuration(_))
        ));

        let unmarked = tempfile::tempdir().unwrap();
        fs::write(unmarked.path().join("unexpected"), b"state").unwrap();
        assert!(matches!(
            FilesystemSubjectKeyStore::new_with_revision(
                unmarked.path(),
                Some("revision-a".to_string())
            ),
            Err(SubjectPrivacyError::Configuration(_))
        ));
    }
}
