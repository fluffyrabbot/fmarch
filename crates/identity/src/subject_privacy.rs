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
const SUBJECT_ERASURE_LEASE_SECONDS: i64 = 60;
// A complete erasure finalization performs a long owner-locked transaction.
// Keep at least half of the default ten-connection pool available to HTTP and
// other background work; journal authentication retains its separate 16-way
// object-I/O cap above.
const SUBJECT_ERASURE_JOB_CONCURRENCY: usize = 4;
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

/// Immutable database work payload committed before the external authority is
/// touched. The mutable lease lives in `subject_erasure`; this value is safe to
/// carry across the no-database-lock object-store phase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubjectErasureWork {
    pub erasure_id: Uuid,
    pub principal_user_id: String,
    pub record: SubjectRevocationRecord,
    pub authority_id: Option<Uuid>,
    pub authority_revision: Option<String>,
    pub authority_manifest_sha256: Option<String>,
    pub requested_at: i64,
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
        let config = Self {
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
        };
        config.validate_key_separation()?;
        Ok(config)
    }

    fn validate_key_separation(&self) -> Result<(), SubjectPrivacyError> {
        if self.wrap_kid == self.journal_kid {
            return Err(SubjectPrivacyError::Configuration(format!(
                "{SUBJECT_AUTHORITY_WRAP_KID_ENV} and {SUBJECT_AUTHORITY_JOURNAL_KID_ENV} must identify distinct keys"
            )));
        }
        if self.wrap_key == self.journal_key {
            return Err(SubjectPrivacyError::Configuration(format!(
                "{SUBJECT_AUTHORITY_WRAP_KEY_ENV} and {SUBJECT_AUTHORITY_JOURNAL_KEY_ENV} must decode to distinct key material"
            )));
        }
        Ok(())
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
        config.validate_key_separation()?;
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
    reconcile_subject_revocations_with_store_inner(pool, key_store)
        .await
        .map(|(completed, _)| completed)
}

/// Test/diagnostic surface for proving the journal preflight remains batched.
/// The count covers only database round trips used to classify authenticated
/// journal subjects before any necessary per-subject recovery/finalization.
#[doc(hidden)]
pub async fn reconcile_subject_revocations_with_store_and_preflight_query_count(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
) -> Result<(usize, usize), SubjectPrivacyError> {
    reconcile_subject_revocations_with_store_inner(pool, key_store).await
}

async fn reconcile_subject_revocations_with_store_inner(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
) -> Result<(usize, usize), SubjectPrivacyError> {
    // Authenticate the complete journal before using any record as destruction
    // evidence. A restored database may predate its durable outbox; recreate
    // that pending intent under the canonical owner locks before finalization.
    let records = key_store.revocations().await?;
    let subject_ids = records
        .iter()
        .map(|record| record.subject_id)
        .collect::<Vec<_>>();
    let mut preflight_query_count = 0;
    let work_by_subject = if subject_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        preflight_query_count += 1;
        load_subject_erasure_work_by_subjects(pool, &subject_ids).await?
    };
    let missing_subject_ids = subject_ids
        .iter()
        .copied()
        .filter(|subject_id| !work_by_subject.contains_key(subject_id))
        .collect::<Vec<_>>();
    let presence_by_subject = if missing_subject_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        preflight_query_count += 1;
        subject_database_presence_batch(pool, &missing_subject_ids).await?
    };
    for record in &records {
        let work = match work_by_subject.get(&record.subject_id).cloned() {
            Some(work) => work,
            None => {
                let (has_subject, has_dependent_reference) = presence_by_subject
                    .get(&record.subject_id)
                    .copied()
                    .ok_or_else(|| {
                        SubjectPrivacyError::Storage(format!(
                            "journal subject {} was omitted from batched database classification",
                            record.subject_id
                        ))
                    })?;
                if !has_subject && !has_dependent_reference {
                    // The database snapshot predates this subject's entire
                    // lifetime. The authenticated external revocation is
                    // historical evidence, not an orphaned local principal to
                    // reconstruct in an older backup.
                    continue;
                }
                if !has_subject {
                    return Err(SubjectPrivacyError::Storage(format!(
                        "revoked subject {} has dependent database references but no canonical privacy subject; explicit recovery is required",
                        record.subject_id
                    )));
                }
                crate::member_lifecycle::recover_member_erasure_from_revocation(pool, record)
                    .await
                    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?
            }
        };
        verify_work_record(&work, record)?;
    }

    let worker_id = format!("startup-{}", Uuid::new_v4().simple());
    let now = unix_now_seconds()?;
    let authenticated_by_subject = records
        .iter()
        .map(|record| (record.subject_id, record))
        .collect::<std::collections::HashMap<_, _>>();
    let mut completed_records = Vec::new();
    loop {
        let claims = claim_pending_subject_erasure_batch(pool, &worker_id, now).await?;
        if claims.is_empty() {
            break;
        }
        let batch = futures_util::stream::iter(claims)
            .map(|claim| {
                let authenticated = authenticated_by_subject
                    .get(&claim.work.record.subject_id)
                    .copied();
                async move {
                    process_claimed_subject_erasure(pool, key_store, &claim, authenticated, now)
                        .await
                }
            })
            .buffer_unordered(SUBJECT_ERASURE_JOB_CONCURRENCY)
            .try_collect::<Vec<_>>()
            .await?;
        completed_records.extend(batch);
    }
    let completed = completed_records.len();

    // Capture the database terminal set first, then authenticate a fresh
    // journal snapshot. A replica may have published its create-only external
    // receipt and committed the tombstone after our initial journal LIST; the
    // second LIST prevents that valid interleaving from becoming a false
    // readiness failure while still requiring exact external evidence.
    let database_evidence =
        sqlx::query_as::<_, (Uuid, String, i64, Option<Uuid>, Option<String>, Option<i64>)>(
            r#"
        SELECT tombstone.subject_id,
               tombstone.replacement_alias,
               tombstone.destroyed_at,
               receipt.receipt_id,
               receipt.key_fingerprint_sha256,
               receipt.destroyed_at
        FROM subject_tombstone AS tombstone
        LEFT JOIN subject_key_destruction_receipt AS receipt USING (subject_id)
        ORDER BY tombstone.subject_id
        "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let final_records = key_store.revocations().await?;
    let final_by_subject = final_records
        .iter()
        .map(|record| (record.subject_id, record))
        .collect::<std::collections::HashMap<_, _>>();
    for (subject_id, alias, destroyed_at, receipt_id, fingerprint, receipt_destroyed_at) in
        database_evidence
    {
        let subject_id = SubjectId::from_uuid(subject_id);
        let external = final_by_subject.get(&subject_id).copied().ok_or_else(|| {
            SubjectPrivacyError::Storage(format!(
                "database tombstone {subject_id} has no external revocation record"
            ))
        })?;
        if external.replacement_alias != alias
            || external.destroyed_at != destroyed_at
            || receipt_id != Some(external.receipt_id)
            || fingerprint.as_deref() != Some(external.key_fingerprint_sha256.as_str())
            || receipt_destroyed_at != Some(external.destroyed_at)
        {
            return Err(SubjectPrivacyError::Storage(format!(
                "database tombstone {subject_id} conflicts with its external revocation evidence"
            )));
        }
    }
    Ok((completed, preflight_query_count))
}

fn unix_now_seconds() -> Result<i64, SubjectPrivacyError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))
}

fn subject_erasure_work_from_row(
    row: &sqlx::postgres::PgRow,
) -> Result<SubjectErasureWork, SubjectPrivacyError> {
    use sqlx::Row;

    Ok(SubjectErasureWork {
        erasure_id: row
            .try_get("erasure_id")
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
        principal_user_id: row
            .try_get("principal_user_id")
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
        record: SubjectRevocationRecord {
            subject_id: SubjectId::from_uuid(
                row.try_get("subject_id")
                    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
            ),
            replacement_alias: row
                .try_get("replacement_alias")
                .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
            destroyed_at: row
                .try_get("requested_at")
                .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
            key_fingerprint_sha256: row
                .try_get("key_fingerprint_sha256")
                .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
            receipt_id: row
                .try_get("receipt_id")
                .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
        },
        authority_id: row
            .try_get("authority_id")
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
        authority_revision: row
            .try_get("authority_revision")
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
        authority_manifest_sha256: row
            .try_get("authority_manifest_sha256")
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
        requested_at: row
            .try_get("requested_at")
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?,
    })
}

const SUBJECT_ERASURE_WORK_SELECT: &str = r#"
    SELECT outbox.erasure_id,
           outbox.subject_id,
           outbox.principal_user_id,
           outbox.receipt_id,
           outbox.replacement_alias,
           outbox.key_fingerprint_sha256,
           outbox.requested_at,
           outbox.authority_id,
           outbox.authority_revision,
           outbox.authority_manifest_sha256
    FROM subject_erasure_outbox AS outbox
"#;

pub(crate) async fn load_subject_erasure_work_by_principal(
    pool: &sqlx::PgPool,
    principal_user_id: &str,
) -> Result<Option<SubjectErasureWork>, SubjectPrivacyError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{SUBJECT_ERASURE_WORK_SELECT} WHERE outbox.principal_user_id = $1"
    )))
    .bind(principal_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    row.as_ref().map(subject_erasure_work_from_row).transpose()
}

async fn load_subject_erasure_work_by_subjects(
    pool: &sqlx::PgPool,
    subject_ids: &[SubjectId],
) -> Result<std::collections::HashMap<SubjectId, SubjectErasureWork>, SubjectPrivacyError> {
    let subject_ids = subject_ids
        .iter()
        .map(|subject_id| subject_id.as_uuid())
        .collect::<Vec<_>>();
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{SUBJECT_ERASURE_WORK_SELECT} WHERE outbox.subject_id = ANY($1)"
    )))
    .bind(&subject_ids)
    .fetch_all(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    rows.iter()
        .map(|row| {
            let work = subject_erasure_work_from_row(row)?;
            Ok((work.record.subject_id, work))
        })
        .collect()
}

async fn subject_database_presence_batch(
    pool: &sqlx::PgPool,
    subject_ids: &[SubjectId],
) -> Result<std::collections::HashMap<SubjectId, (bool, bool)>, SubjectPrivacyError> {
    let subject_ids = subject_ids
        .iter()
        .map(|subject_id| subject_id.as_uuid())
        .collect::<Vec<_>>();
    let rows = sqlx::query_as::<_, (Uuid, bool, bool)>(
        r#"
        SELECT
            journal.subject_id,
            subject.subject_id IS NOT NULL,
            EXISTS(
                SELECT 1 FROM subject_erasure_outbox WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM subject_private_claim WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM subject_tombstone WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM subject_key_destruction_receipt WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM member_lifecycle_event WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM member_lifecycle_projection WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM member_personal_export WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM profile_editor WHERE subject_id = journal.subject_id
                UNION ALL SELECT 1 FROM game_persona_private WHERE subject_id = journal.subject_id
            )
        FROM UNNEST($1::uuid[]) AS journal(subject_id)
        LEFT JOIN privacy_subject AS subject USING (subject_id)
        "#,
    )
    .bind(&subject_ids)
    .fetch_all(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|(subject_id, has_subject, has_reference)| {
            (
                SubjectId::from_uuid(subject_id),
                (has_subject, has_reference),
            )
        })
        .collect())
}

#[derive(Debug, Clone)]
struct ClaimedSubjectErasure {
    work: SubjectErasureWork,
    claim_token: Uuid,
    claim_owner: String,
}

async fn load_subject_erasure_work_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    erasure_id: Uuid,
) -> Result<SubjectErasureWork, SubjectPrivacyError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{SUBJECT_ERASURE_WORK_SELECT} WHERE outbox.erasure_id = $1"
    )))
    .bind(erasure_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    subject_erasure_work_from_row(&row)
}

async fn claim_subject_erasure(
    pool: &sqlx::PgPool,
    erasure_id: Uuid,
    worker_id: &str,
    now: i64,
) -> Result<Option<ClaimedSubjectErasure>, SubjectPrivacyError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let claim_token = Uuid::new_v4();
    let claim_expires_at = now.saturating_add(SUBJECT_ERASURE_LEASE_SECONDS);
    let claimed = sqlx::query_scalar::<_, Uuid>(
        "UPDATE subject_erasure SET claim_token = $2, claim_owner = $3, claim_expires_at = $4, attempt_count = attempt_count + 1, last_attempt_at = $5 WHERE erasure_id = $1 AND state = 'pending' AND (claim_token IS NULL OR claim_expires_at <= $5) RETURNING erasure_id",
    )
        .bind(erasure_id)
        .bind(claim_token)
        .bind(worker_id)
        .bind(claim_expires_at)
        .bind(now)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if claimed.is_none() {
        tx.commit()
            .await
            .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
        return Ok(None);
    }
    let work = load_subject_erasure_work_in_tx(&mut tx, erasure_id).await?;
    tx.commit()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    Ok(Some(ClaimedSubjectErasure {
        work,
        claim_token,
        claim_owner: worker_id.to_string(),
    }))
}

/// Atomically reserve a bounded batch. `SKIP LOCKED` lets replicas divide the
/// queue without first reading every pending id and opening one futile claim
/// transaction per row. Live leases are never stolen; only unclaimed or
/// expired rows are eligible.
async fn claim_pending_subject_erasure_batch(
    pool: &sqlx::PgPool,
    worker_id: &str,
    now: i64,
) -> Result<Vec<ClaimedSubjectErasure>, SubjectPrivacyError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let erasure_ids = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT erasure_id
        FROM subject_erasure
        WHERE state = 'pending'
          AND (claim_token IS NULL OR claim_expires_at <= $1)
        ORDER BY claim_expires_at NULLS FIRST, erasure_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
        "#,
    )
    .bind(now)
    .bind(SUBJECT_ERASURE_JOB_CONCURRENCY as i64)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let mut claims = Vec::with_capacity(erasure_ids.len());
    for erasure_id in erasure_ids {
        let claim_token = Uuid::new_v4();
        let claim_expires_at = now.saturating_add(SUBJECT_ERASURE_LEASE_SECONDS);
        let updated = sqlx::query(
            "UPDATE subject_erasure SET claim_token = $2, claim_owner = $3, claim_expires_at = $4, attempt_count = attempt_count + 1, last_attempt_at = $5 WHERE erasure_id = $1 AND state = 'pending' AND (claim_token IS NULL OR claim_expires_at <= $5)",
        )
        .bind(erasure_id)
        .bind(claim_token)
        .bind(worker_id)
        .bind(claim_expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
        if updated.rows_affected() != 1 {
            return Err(SubjectPrivacyError::Storage(format!(
                "locked erasure {erasure_id} could not be claimed"
            )));
        }
        claims.push(ClaimedSubjectErasure {
            work: load_subject_erasure_work_in_tx(&mut tx, erasure_id).await?,
            claim_token,
            claim_owner: worker_id.to_string(),
        });
    }
    tx.commit()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    Ok(claims)
}

fn verify_work_record(
    work: &SubjectErasureWork,
    record: &SubjectRevocationRecord,
) -> Result<(), SubjectPrivacyError> {
    if &work.record != record {
        return Err(SubjectPrivacyError::Storage(format!(
            "external revocation conflicts with erasure outbox {}",
            work.erasure_id
        )));
    }
    Ok(())
}

async fn process_claimed_subject_erasure(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
    claim: &ClaimedSubjectErasure,
    authenticated_record: Option<&SubjectRevocationRecord>,
    completed_at: i64,
) -> Result<SubjectRevocationRecord, SubjectPrivacyError> {
    let work = &claim.work;
    // The claim transaction has committed. No database transaction or row lock
    // exists across these authority operations.
    let authenticated = match authenticated_record {
        Some(record) => {
            verify_work_record(work, record)?;
            record.clone()
        }
        None => {
            // Each adapter's create-only write verifies the exact immutable
            // subject object (including its authenticated contents) before it
            // returns. Re-listing the complete journal here would turn a batch
            // of N new erasures into N full LIST+GET sweeps.
            key_store.record_revocation(&work.record).await?;
            work.record.clone()
        }
    };
    verify_work_record(work, &authenticated)?;
    let key_was_present = key_store.destroy(work.record.subject_id).await?;
    match key_store.load(work.record.subject_id).await {
        Err(SubjectPrivacyError::MissingKey { .. }) => {}
        Ok(_) => {
            return Err(SubjectPrivacyError::Storage(format!(
                "subject key {} remained readable after destruction",
                work.record.subject_id
            )))
        }
        Err(error) => return Err(error),
    }
    finalize_subject_erasure(pool, claim, &authenticated, key_was_present, completed_at).await?;
    Ok(authenticated)
}

async fn process_subject_erasure_id_with_store(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
    erasure_id: Uuid,
    worker_id: &str,
    now: i64,
) -> Result<bool, SubjectPrivacyError> {
    let Some(claim) = claim_subject_erasure(pool, erasure_id, worker_id, now).await? else {
        return Ok(false);
    };
    process_claimed_subject_erasure(pool, key_store, &claim, None, now).await?;
    Ok(true)
}

pub async fn process_pending_subject_erasures_with_store(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
    worker_id: &str,
    now: i64,
) -> Result<usize, SubjectPrivacyError> {
    let mut completed = 0;
    loop {
        let claims = claim_pending_subject_erasure_batch(pool, worker_id, now).await?;
        if claims.is_empty() {
            return Ok(completed);
        }
        completed += futures_util::stream::iter(claims)
            .map(|claim| async move {
                process_claimed_subject_erasure(pool, key_store, &claim, None, now).await
            })
            .buffer_unordered(SUBJECT_ERASURE_JOB_CONCURRENCY)
            .try_collect::<Vec<_>>()
            .await?
            .len();
    }
}

pub async fn process_pending_subject_erasures(
    pool: &sqlx::PgPool,
    worker_id: &str,
    now: i64,
) -> Result<usize, SubjectPrivacyError> {
    let key_store = active_subject_key_store().await?;
    process_pending_subject_erasures_with_store(pool, key_store.as_ref(), worker_id, now).await
}

pub(crate) async fn process_subject_erasure_with_store(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
    erasure_id: Uuid,
    worker_id: &str,
    now: i64,
) -> Result<bool, SubjectPrivacyError> {
    process_subject_erasure_id_with_store(pool, key_store, erasure_id, worker_id, now).await
}

pub(crate) async fn discover_revoked_subject_owner(
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

async fn finalize_subject_erasure(
    pool: &sqlx::PgPool,
    claim: &ClaimedSubjectErasure,
    authenticated_record: &SubjectRevocationRecord,
    key_was_present: bool,
    completed_at: i64,
) -> Result<(), SubjectPrivacyError> {
    use sqlx::Row;

    let work = &claim.work;
    verify_work_record(work, authenticated_record)?;
    let record = authenticated_record;
    let principal = &work.principal_user_id;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let owner = crate::methods::lock_identity_mutation(
        &mut tx,
        principal,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if owner.subject_id != record.subject_id.as_uuid()
        || owner.principal_user_id != *principal
        || !matches!(
            owner.subject_lifecycle_state.as_str(),
            "erasure_pending" | "erased"
        )
    {
        return Err(SubjectPrivacyError::Storage(format!(
            "erasure outbox {} no longer matches its locked owner",
            work.erasure_id
        )));
    }

    let (state, claim_token, claim_owner): (String, Option<Uuid>, Option<String>) =
        sqlx::query_as(
            "SELECT state, claim_token, claim_owner FROM subject_erasure WHERE erasure_id = $1 FOR UPDATE",
        )
        .bind(work.erasure_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?
        .ok_or_else(|| {
            SubjectPrivacyError::Storage(format!(
                "erasure outbox {} has no durable state row",
                work.erasure_id
            ))
        })?;
    if state != "pending"
        || claim_token != Some(claim.claim_token)
        || claim_owner.as_deref() != Some(claim.claim_owner.as_str())
    {
        return Err(SubjectPrivacyError::Storage(format!(
            "erasure worker {} lost fenced claim {} for {}",
            claim.claim_owner, claim.claim_token, work.erasure_id
        )));
    }

    let binding = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let expected_binding = work.authority_id.map(|authority_id| {
        (
            authority_id,
            work.authority_revision.clone().unwrap_or_default(),
            work.authority_manifest_sha256.clone().unwrap_or_default(),
        )
    });
    if binding != expected_binding {
        return Err(SubjectPrivacyError::Storage(format!(
            "erasure outbox {} authority binding changed before finalization",
            work.erasure_id
        )));
    }

    let locked_work = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{SUBJECT_ERASURE_WORK_SELECT} WHERE outbox.erasure_id = $1"
    )))
    .bind(work.erasure_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let locked_work = subject_erasure_work_from_row(&locked_work)?;
    if locked_work != *work {
        return Err(SubjectPrivacyError::Storage(format!(
            "erasure outbox {} changed after worker verification",
            work.erasure_id
        )));
    }

    if owner.subject_lifecycle_state == "erased" {
        return Err(SubjectPrivacyError::Storage(format!(
            "subject {} is terminally erased without completed erasure state",
            record.subject_id
        )));
    }
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
        "INSERT INTO subject_key_destruction_receipt (receipt_id, subject_id, key_fingerprint_sha256, key_was_present, destroyed_at, erasure_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (subject_id) DO NOTHING",
    )
    .bind(record.receipt_id)
    .bind(record.subject_id.as_uuid())
    .bind(&record.key_fingerprint_sha256)
    .bind(key_was_present)
    .bind(record.destroyed_at)
    .bind(work.erasure_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;

    let evidence = sqlx::query(
        r#"
        SELECT tombstone.replacement_alias,
               tombstone.destroyed_at AS tombstone_destroyed_at,
               receipt.receipt_id,
               receipt.erasure_id,
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
        || evidence.get::<Uuid, _>("erasure_id") != work.erasure_id
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
        Some(principal),
        record.destroyed_at,
    )
    .await?;
    reconcile_member_lifecycle(&mut tx, record, principal).await?;
    sqlx::query("DELETE FROM member_personal_export WHERE principal_user_id = $1")
        .bind(principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query(
        r#"
        INSERT INTO workos_subject_tombstone (
            provider_subject_hash,
            tombstoned_at,
            reason
        )
        SELECT encode(sha256(convert_to(subject, 'UTF8')), 'hex'),
               $2,
               'subject_erasure'
        FROM external_identity
        WHERE principal_user_id = $1
          AND provider = 'workos'
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(principal)
    .bind(record.destroyed_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query(
        r#"
        INSERT INTO workos_provider_session_tombstone (
            provider_session_hash,
            tombstoned_at,
            reason
        )
        SELECT encode(
                   sha256(convert_to(provider_session_id, 'UTF8')),
                   'hex'
               ),
               $2,
               'subject_erasure'
        FROM workos_provider_session
        WHERE principal_user_id = $1
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(principal)
    .bind(record.destroyed_at)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM workos_session_exchange WHERE provider_session_id IN (SELECT provider_session_id FROM workos_provider_session WHERE principal_user_id = $1)")
        .bind(principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query(
        "DELETE FROM auth_session WHERE principal_user_id = $1 AND workos_session_id IS NOT NULL",
    )
    .bind(principal)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM workos_provider_session WHERE principal_user_id = $1")
        .bind(principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM external_identity WHERE principal_user_id = $1")
        .bind(principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE authentication_method SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2) WHERE principal_user_id = $1")
        .bind(principal).bind(record.destroyed_at).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE auth_session SET revoked_at = COALESCE(revoked_at, $2) WHERE principal_user_id = $1")
        .bind(principal).bind(record.destroyed_at).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_websocket_ticket WHERE principal_user_id = $1")
        .bind(principal)
        .execute(&mut *tx)
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_invite WHERE principal_user_id = $1 OR account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(principal).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_delivery_intent WHERE principal_user_id = $1 OR account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(principal).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("DELETE FROM auth_account_recovery_credential WHERE account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(principal).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let erased_account_id = format!("erased_{}", record.receipt_id.simple());
    sqlx::query("UPDATE auth_account SET account_id = $2, disabled_at = COALESCE(disabled_at, $3), password_hash = $4, global_capabilities = '{}'::text[] WHERE principal_user_id = $1")
        .bind(principal).bind(erased_account_id).bind(record.destroyed_at).bind(format!("erased:{}", record.receipt_id)).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE identity_lifecycle_audit SET actor_user_id = CASE WHEN actor_user_id = $1 THEN $2 ELSE actor_user_id END, principal_user_id = $2, metadata = '{}'::jsonb WHERE principal_user_id = $1 OR actor_user_id = $1")
        .bind(principal).bind(&record.replacement_alias).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    sqlx::query("UPDATE platform_principal SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2), global_capabilities = '{}'::text[] WHERE principal_user_id = $1")
        .bind(principal).bind(record.destroyed_at).execute(&mut *tx).await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    let completed = sqlx::query(
        "UPDATE subject_erasure SET state = 'complete', claim_token = NULL, claim_owner = NULL, claim_expires_at = NULL, completed_at = $2 WHERE erasure_id = $1 AND state = 'pending' AND claim_token = $3 AND claim_owner = $4",
    )
    .bind(work.erasure_id)
    .bind(completed_at)
    .bind(claim.claim_token)
    .bind(&claim.claim_owner)
    .execute(&mut *tx)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    if completed.rows_affected() != 1 {
        return Err(SubjectPrivacyError::Storage(format!(
            "erasure worker {} lost fenced claim {} while completing {}",
            claim.claim_owner, claim.claim_token, work.erasure_id
        )));
    }
    tx.commit()
        .await
        .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))
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
        "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE",
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
               tombstone.subject_id IS NOT NULL AS tombstoned,
               outbox.erasure_id IS NOT NULL AS has_erasure_intent,
               erasure.state AS erasure_state
        FROM privacy_subject AS subject
        LEFT JOIN subject_tombstone AS tombstone USING (subject_id)
        LEFT JOIN subject_erasure_outbox AS outbox USING (subject_id)
        LEFT JOIN subject_erasure AS erasure USING (erasure_id)
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
        let has_erasure_intent: bool = subject.get("has_erasure_intent");
        let erasure_state: Option<String> = subject.get("erasure_state");
        match (
            lifecycle_state.as_str(),
            tombstoned,
            has_erasure_intent,
            erasure_state.as_deref(),
        ) {
            ("active", false, false, None) => active.push(subject_id),
            ("erasure_pending", false, true, Some("pending")) => {}
            ("erased", true, true, Some("complete")) => {}
            _ => {
                return Err(SubjectPrivacyError::Storage(format!(
                    "subject {subject_id} has inconsistent lifecycle state `{lifecycle_state}`, tombstone={tombstoned}, erasure_intent={has_erasure_intent}, erasure_state={erasure_state:?}"
                )))
            }
        }
    }
    futures_util::stream::iter(active)
        .map(|subject_id| async move {
            match key_store.load(subject_id).await {
                Ok(_) => Ok(()),
                Err(SubjectPrivacyError::MissingKey { .. })
                    if subject_transitioned_to_erasure(pool, subject_id).await? =>
                {
                    Ok(())
                }
                Err(error) => Err(SubjectPrivacyError::Storage(format!(
                    "active subject {subject_id} has no valid authority key: {error}"
                ))),
            }
        })
        .buffer_unordered(SUBJECT_AUTHORITY_IO_CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await?;
    Ok(())
}

async fn subject_transitioned_to_erasure(
    pool: &sqlx::PgPool,
    subject_id: SubjectId,
) -> Result<bool, SubjectPrivacyError> {
    let state = sqlx::query_as::<_, (String, bool, bool, Option<String>)>(
        r#"
        SELECT subject.lifecycle_state,
               outbox.erasure_id IS NOT NULL,
               tombstone.subject_id IS NOT NULL,
               erasure.state
        FROM privacy_subject AS subject
        LEFT JOIN subject_erasure_outbox AS outbox USING (subject_id)
        LEFT JOIN subject_erasure AS erasure USING (erasure_id)
        LEFT JOIN subject_tombstone AS tombstone USING (subject_id)
        WHERE subject.subject_id = $1
        "#,
    )
    .bind(subject_id.as_uuid())
    .fetch_optional(pool)
    .await
    .map_err(|error| SubjectPrivacyError::Storage(error.to_string()))?;
    Ok(match state {
        Some((lifecycle, true, false, Some(erasure_state)))
            if lifecycle == "erasure_pending" && erasure_state == "pending" =>
        {
            true
        }
        Some((lifecycle, true, true, Some(erasure_state)))
            if lifecycle == "erased" && erasure_state == "complete" =>
        {
            true
        }
        _ => false,
    })
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
    sqlx::query("DELETE FROM publication_surface WHERE surface_id IN (SELECT profile_id FROM profile_editor WHERE subject_id = $1)")
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
    use std::ffi::OsString;
    use std::sync::{Mutex, MutexGuard};

    const SUBJECT_AUTHORITY_ENV_NAMES: [&str; 13] = [
        SUBJECT_AUTHORITY_REVISION_ENV,
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
    static SUBJECT_AUTHORITY_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct SubjectAuthorityEnvGuard {
        prior: Vec<(&'static str, Option<OsString>)>,
        _lock: MutexGuard<'static, ()>,
    }

    impl SubjectAuthorityEnvGuard {
        fn isolated() -> Self {
            let lock = SUBJECT_AUTHORITY_ENV_LOCK
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let prior = SUBJECT_AUTHORITY_ENV_NAMES
                .into_iter()
                .map(|name| (name, std::env::var_os(name)))
                .collect();
            for name in SUBJECT_AUTHORITY_ENV_NAMES {
                std::env::remove_var(name);
            }
            Self { prior, _lock: lock }
        }

        fn configure(
            &self,
            wrap_kid: &str,
            wrap_key: [u8; 32],
            journal_kid: &str,
            journal_key: [u8; 32],
        ) {
            std::env::set_var(SUBJECT_AUTHORITY_REVISION_ENV, "test-revision");
            std::env::set_var(
                SUBJECT_AUTHORITY_ENDPOINT_ENV,
                "https://objects.example.invalid",
            );
            std::env::set_var(SUBJECT_AUTHORITY_REGION_ENV, "test-region");
            std::env::set_var(SUBJECT_AUTHORITY_BUCKET_ENV, "subject-keys");
            std::env::set_var(SUBJECT_AUTHORITY_ACCESS_KEY_ENV, "test-access-key");
            std::env::set_var(SUBJECT_AUTHORITY_SECRET_KEY_ENV, "test-secret-key");
            std::env::set_var(SUBJECT_AUTHORITY_ID_ENV, Uuid::new_v4().to_string());
            std::env::set_var(SUBJECT_AUTHORITY_WRAP_KID_ENV, wrap_kid);
            std::env::set_var(SUBJECT_AUTHORITY_WRAP_KEY_ENV, STANDARD.encode(wrap_key));
            std::env::set_var(SUBJECT_AUTHORITY_JOURNAL_KID_ENV, journal_kid);
            std::env::set_var(
                SUBJECT_AUTHORITY_JOURNAL_KEY_ENV,
                STANDARD.encode(journal_key),
            );
        }
    }

    impl Drop for SubjectAuthorityEnvGuard {
        fn drop(&mut self) {
            for (name, value) in &self.prior {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }

    fn object_authority_config(
        wrap_kid: &str,
        wrap_key: [u8; 32],
        journal_kid: &str,
        journal_key: [u8; 32],
    ) -> ObjectSubjectKeyStoreConfig {
        ObjectSubjectKeyStoreConfig {
            endpoint: "https://objects.example.invalid".to_string(),
            region: "test-region".to_string(),
            bucket: "subject-keys".to_string(),
            access_key_id: "test-access-key".to_string(),
            secret_access_key: "test-secret-key".to_string(),
            virtual_hosted_style: false,
            allow_http: false,
            authority_revision: "test-revision".to_string(),
            authority_id: Uuid::new_v4(),
            wrap_kid: wrap_kid.to_string(),
            wrap_key,
            journal_kid: journal_kid.to_string(),
            journal_key,
        }
    }

    fn assert_configuration_error<T>(result: Result<T, SubjectPrivacyError>, expected: &str) {
        match result {
            Err(SubjectPrivacyError::Configuration(message)) => assert_eq!(message, expected),
            Err(error) => panic!("expected configuration error, found {error}"),
            Ok(_) => panic!("expected configuration error"),
        }
    }

    #[test]
    fn environment_config_requires_purpose_separated_authority_keys() {
        let environment = SubjectAuthorityEnvGuard::isolated();
        environment.configure("shared-v1", [7_u8; 32], "shared-v1", [9_u8; 32]);
        assert_configuration_error(
            ObjectSubjectKeyStoreConfig::from_environment(),
            &format!(
                "{SUBJECT_AUTHORITY_WRAP_KID_ENV} and {SUBJECT_AUTHORITY_JOURNAL_KID_ENV} must identify distinct keys"
            ),
        );

        environment.configure("wrap-v1", [7_u8; 32], "journal-v1", [7_u8; 32]);
        assert_configuration_error(
            ObjectSubjectKeyStoreConfig::from_environment(),
            &format!(
                "{SUBJECT_AUTHORITY_WRAP_KEY_ENV} and {SUBJECT_AUTHORITY_JOURNAL_KEY_ENV} must decode to distinct key material"
            ),
        );
    }

    #[test]
    fn s3_constructor_requires_purpose_separated_authority_keys() {
        assert_configuration_error(
            ObjectSubjectKeyStore::s3(object_authority_config(
                "shared-v1",
                [7_u8; 32],
                "shared-v1",
                [9_u8; 32],
            )),
            &format!(
                "{SUBJECT_AUTHORITY_WRAP_KID_ENV} and {SUBJECT_AUTHORITY_JOURNAL_KID_ENV} must identify distinct keys"
            ),
        );
        assert_configuration_error(
            ObjectSubjectKeyStore::s3(object_authority_config(
                "wrap-v1",
                [7_u8; 32],
                "journal-v1",
                [7_u8; 32],
            )),
            &format!(
                "{SUBJECT_AUTHORITY_WRAP_KEY_ENV} and {SUBJECT_AUTHORITY_JOURNAL_KEY_ENV} must decode to distinct key material"
            ),
        );
    }

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
