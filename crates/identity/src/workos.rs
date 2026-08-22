//! The WorkOS adapter: JWT verification against the provider JWKS, and
//! resolution of a verified (provider, subject) assertion onto a platform
//! principal with a workos authentication method. WorkOS assertions are
//! exchanged once for a backend-owned app session; they are never the
//! per-request bearer.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::PgConnection;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::methods;
use crate::PrincipalId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub session_id: WorkosSessionId,
    pub expires_at: i64,
    pub email: Option<String>,
}

/// A canonical WorkOS session identifier from the signed `sid` access-token
/// claim. Keeping the representation validated prevents database corruption or
/// caller input from becoming a provider logout redirect parameter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkosSessionId(String);

impl WorkosSessionId {
    pub fn parse(value: impl Into<String>) -> Result<Self, IdentityError> {
        let value = value.into();
        let suffix = value
            .strip_prefix("session_")
            .ok_or(IdentityError::InvalidToken)?;
        if suffix.len() != 26
            || !suffix.bytes().all(|byte| {
                byte.is_ascii_digit()
                    || matches!(byte, b'A'..=b'H' | b'J'..=b'K' | b'M'..=b'N' | b'P'..=b'T' | b'V'..=b'Z')
            })
        {
            return Err(IdentityError::InvalidToken);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    /// One-way identifier used by permanent replay/logout tombstones after
    /// subject-linked provider-session data has been erased.
    pub fn fingerprint(&self) -> String {
        format!("{:x}", Sha256::digest(self.0.as_bytes()))
    }
}

/// One-way identifier retained after erasure so an access token from an
/// unobserved WorkOS session cannot recreate the erased external identity.
pub fn subject_fingerprint(subject: &str) -> String {
    format!("{:x}", Sha256::digest(subject.as_bytes()))
}

/// Construct the browser navigation target that ends the persisted WorkOS
/// session. No `return_to` is accepted here: WorkOS applies the application's
/// configured logout redirect, so callers cannot turn logout into an open
/// redirect.
pub fn logout_url(session_id: &WorkosSessionId) -> String {
    let mut url = reqwest::Url::parse("https://api.workos.com/user_management/sessions/logout")
        .expect("the fixed WorkOS logout endpoint must be a valid URL");
    url.query_pairs_mut()
        .append_pair("session_id", session_id.as_str());
    url.into()
}

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("access token is malformed or unsupported")]
    InvalidToken,
    #[error("access token is missing a signing key id")]
    MissingKeyId,
    #[error("access token signing key is unavailable")]
    UnknownKey,
    #[error("identity provider is unavailable: {0}")]
    ProviderUnavailable(String),
    #[error("identity configuration is invalid: {0}")]
    InvalidConfiguration(String),
}

#[async_trait]
pub trait AccessTokenVerifier: Send + Sync {
    async fn verify(&self, token: &str) -> Result<VerifiedIdentity, IdentityError>;
}

#[derive(Clone)]
pub struct WorkosAccessTokenVerifier {
    client_id: Arc<str>,
    pub(crate) issuer: Arc<str>,
    jwks_url: Arc<str>,
    http: reqwest::Client,
    jwks: Arc<RwLock<Option<JwkSet>>>,
}

impl WorkosAccessTokenVerifier {
    pub fn new(
        client_id: impl Into<String>,
        issuer: impl Into<String>,
        jwks_url: impl Into<String>,
    ) -> Result<Self, IdentityError> {
        let client_id = required(client_id.into(), "client id")?;
        let issuer = required(issuer.into(), "issuer")?;
        let jwks_url = required(jwks_url.into(), "JWKS URL")?;
        reqwest::Url::parse(jwks_url.as_str()).map_err(|error| {
            IdentityError::InvalidConfiguration(format!("invalid JWKS URL: {error}"))
        })?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|error| {
                IdentityError::InvalidConfiguration(format!("HTTP client setup failed: {error}"))
            })?;
        Ok(Self {
            client_id: client_id.into(),
            issuer: issuer.into(),
            jwks_url: jwks_url.into(),
            http,
            jwks: Arc::new(RwLock::new(None)),
        })
    }

    pub fn from_env() -> Result<Option<Self>, IdentityError> {
        let client_id = std::env::var("WORKOS_CLIENT_ID").ok();
        let issuer = std::env::var("WORKOS_ISSUER").ok();
        let jwks_url = std::env::var("WORKOS_JWKS_URL").ok();
        match (client_id, issuer, jwks_url) {
            (None, None, None) => Ok(None),
            (Some(client_id), Some(issuer), Some(jwks_url)) => {
                Self::new(client_id, issuer, jwks_url).map(Some)
            }
            _ => Err(IdentityError::InvalidConfiguration(
                "WORKOS_CLIENT_ID, WORKOS_ISSUER, and WORKOS_JWKS_URL must be set together"
                    .to_string(),
            )),
        }
    }

    async fn jwks(&self, refresh: bool) -> Result<JwkSet, IdentityError> {
        if !refresh {
            if let Some(jwks) = self.jwks.read().await.clone() {
                return Ok(jwks);
            }
        }
        let response = self
            .http
            .get(self.jwks_url.as_ref())
            .send()
            .await
            .map_err(|error| IdentityError::ProviderUnavailable(error.to_string()))?
            .error_for_status()
            .map_err(|error| IdentityError::ProviderUnavailable(error.to_string()))?;
        let jwks = response
            .json::<JwkSet>()
            .await
            .map_err(|error| IdentityError::ProviderUnavailable(error.to_string()))?;
        *self.jwks.write().await = Some(jwks.clone());
        Ok(jwks)
    }

    fn decode_with_jwks(
        &self,
        token: &str,
        jwks: &JwkSet,
    ) -> Result<VerifiedIdentity, IdentityError> {
        let header = decode_header(token).map_err(|_| IdentityError::InvalidToken)?;
        if header.alg != Algorithm::RS256 {
            return Err(IdentityError::InvalidToken);
        }
        let kid = header.kid.ok_or(IdentityError::MissingKeyId)?;
        let jwk = jwks.find(kid.as_str()).ok_or(IdentityError::UnknownKey)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| IdentityError::InvalidToken)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[self.issuer.as_ref()]);
        validation.set_required_spec_claims(&["exp", "iss", "sub"]);
        let token =
            decode::<Claims>(token, &key, &validation).map_err(|_| IdentityError::InvalidToken)?;
        let subject =
            required(token.claims.sub, "subject").map_err(|_| IdentityError::InvalidToken)?;
        let session_id = WorkosSessionId::parse(token.claims.sid)?;
        if token.claims.client_id.as_deref() != Some(self.client_id.as_ref()) {
            return Err(IdentityError::InvalidToken);
        }
        let expires_at =
            i64::try_from(token.claims.exp).map_err(|_| IdentityError::InvalidToken)?;
        Ok(VerifiedIdentity {
            subject,
            session_id,
            expires_at,
            email: token.claims.email.filter(|email| !email.trim().is_empty()),
        })
    }
}

#[async_trait]
impl AccessTokenVerifier for WorkosAccessTokenVerifier {
    async fn verify(&self, token: &str) -> Result<VerifiedIdentity, IdentityError> {
        let jwks = self.jwks(false).await?;
        match self.decode_with_jwks(token, &jwks) {
            Err(IdentityError::UnknownKey) => {
                let refreshed = self.jwks(true).await?;
                self.decode_with_jwks(token, &refreshed)
            }
            result => result,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    sid: String,
    exp: u64,
    client_id: Option<String>,
    email: Option<String>,
}

fn required(value: String, label: &str) -> Result<String, IdentityError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(IdentityError::InvalidConfiguration(format!(
            "{label} must not be empty"
        )));
    }
    Ok(value.to_string())
}

#[derive(Clone, Default)]
pub struct StaticAccessTokenVerifier {
    identities: Arc<HashMap<String, VerifiedIdentity>>,
}

impl StaticAccessTokenVerifier {
    pub fn new(entries: impl IntoIterator<Item = (String, VerifiedIdentity)>) -> Self {
        Self {
            identities: Arc::new(entries.into_iter().collect()),
        }
    }
}

#[async_trait]
impl AccessTokenVerifier for StaticAccessTokenVerifier {
    async fn verify(&self, token: &str) -> Result<VerifiedIdentity, IdentityError> {
        self.identities
            .get(token)
            .cloned()
            .ok_or(IdentityError::InvalidToken)
    }
}

#[derive(Debug, Clone)]
pub struct WorkosResolution {
    pub principal_id: PrincipalId,
    pub global_capabilities: Vec<String>,
    pub method_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiscoveredWorkosIdentity {
    principal_id: PrincipalId,
    method_id: Uuid,
}

async fn discover_subject(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<Option<DiscoveredWorkosIdentity>, IdentityFlowError> {
    Ok(sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT principal_id, method_id FROM external_identity WHERE provider = 'workos' AND subject = $1",
    )
    .bind(subject)
    .fetch_optional(&mut *conn)
    .await?
    .map(|(principal_id, method_id)| DiscoveredWorkosIdentity {
        principal_id: PrincipalId::from_uuid(principal_id),
        method_id,
    }))
}

async fn lock_method(
    conn: &mut PgConnection,
    method_id: Uuid,
    principal_id: &PrincipalId,
) -> Result<String, IdentityFlowError> {
    let (linked_principal, kind, status) = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT principal_id, kind, status FROM authentication_method WHERE method_id = $1 FOR UPDATE",
    )
    .bind(method_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| {
        IdentityFlowError::Internal(
            "WorkOS identity references a missing authentication method".to_string(),
        )
    })?;
    if linked_principal != principal_id.as_uuid() || kind != crate::MethodKind::Workos.as_str() {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(status)
}

async fn lock_subject_binding(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<Option<DiscoveredWorkosIdentity>, IdentityFlowError> {
    Ok(sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT principal_id, method_id FROM external_identity WHERE provider = 'workos' AND subject = $1 FOR UPDATE",
    )
    .bind(subject)
    .fetch_optional(&mut *conn)
    .await?
    .map(|(principal_id, method_id)| DiscoveredWorkosIdentity {
        principal_id: PrincipalId::from_uuid(principal_id),
        method_id,
    }))
}

/// Acquire the canonical transaction-scoped WorkOS-subject lock.
///
/// Identity mutations that combine a WorkOS assertion with an existing local
/// session must take this lock before locking the local principal. This keeps
/// their order identical to first-sight WorkOS resolution:
/// provider subject -> principal -> authentication details.
pub async fn lock_subject_advisory(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<(), IdentityFlowError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("workos:{subject}"))
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn reject_tombstoned_identity(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
) -> Result<(), IdentityFlowError> {
    let tombstoned: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
                   SELECT 1
                   FROM workos_provider_session_tombstone
                   WHERE provider_session_hash = $1
               )
            OR EXISTS (
                   SELECT 1
                   FROM workos_subject_tombstone
                   WHERE provider_subject_hash = $2
               )
        "#,
    )
    .bind(verified.session_id.fingerprint())
    .bind(subject_fingerprint(verified.subject.as_str()))
    .fetch_one(&mut *conn)
    .await?;
    if tombstoned {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(())
}

/// Resolve a verified WorkOS assertion onto a platform principal, provisioning
/// principal, method, and external-identity rows on first sight. The email
/// claim only ever becomes a display label; identities match by
/// (provider, subject) alone. Runs in the caller's transaction; an advisory
/// lock serializes concurrent first-sight provisioning per subject.
pub async fn resolve_subject(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    if verified.expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    lock_subject_advisory(conn, verified.subject.as_str()).await?;
    // This read is authoritative for the provider-subject lock. The earlier
    // API precheck prevents known erased identities from reaching provisioning
    // side effects; this one closes a concurrent erasure race.
    reject_tombstoned_identity(conn, verified).await?;
    // Discovery must never take the provider-detail lock. The owner gives us
    // the canonical principal -> privacy-subject lock root; the binding is
    // re-read under lock only after its authentication method is locked.
    let discovered = discover_subject(conn, verified.subject.as_str()).await?;
    let principal_id = discovered
        .as_ref()
        .map(|identity| identity.principal_id)
        .unwrap_or_else(PrincipalId::random);
    methods::ensure_principal(conn, &principal_id, &[], now).await?;
    let owner = methods::lock_identity_mutation(
        conn,
        &principal_id,
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let global_capabilities = owner.global_capabilities;

    let method_id = if let Some(identity) = discovered.as_ref() {
        if lock_method(conn, identity.method_id, &principal_id).await? != "active" {
            return Err(IdentityFlowError::Unauthorized);
        }
        identity.method_id
    } else {
        methods::create_method(conn, &principal_id, crate::MethodKind::Workos, now).await?
    };

    let locked_binding = lock_subject_binding(conn, verified.subject.as_str()).await?;
    if locked_binding != discovered {
        return Err(IdentityFlowError::Unauthorized);
    }
    methods::touch_method(conn, method_id, now).await?;
    if discovered.is_some() {
        let updated = sqlx::query(
            "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label) WHERE provider = 'workos' AND subject = $3 AND principal_id = $4",
        )
        .bind(now)
        .bind(verified.email.as_deref())
        .bind(verified.subject.as_str())
        .bind(principal_id.as_uuid())
        .execute(&mut *conn)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(IdentityFlowError::Unauthorized);
        }
    } else {
        sqlx::query(
            "INSERT INTO external_identity (provider, subject, principal_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, $4, $4, $5)",
        )
        .bind(verified.subject.as_str())
        .bind(principal_id.as_uuid())
        .bind(verified.email.as_deref())
        .bind(now)
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO identity_lifecycle_audit (
                event_at, event_kind, actor_principal_id, principal_id,
                token_hash, related_token_hash, metadata
            )
            VALUES ($1, 'external_identity_bound', NULL, $2, NULL, NULL, $3::JSONB)
            "#,
        )
        .bind(now)
        .bind(principal_id.as_uuid())
        .bind(serde_json::json!({ "provider": "workos" }).to_string())
        .execute(&mut *conn)
        .await?;
    }
    Ok(WorkosResolution {
        principal_id,
        global_capabilities,
        method_id,
    })
}

/// Attach or reactivate a verified WorkOS identity on an already-authenticated
/// principal. Unlike first-sight sign-in this never provisions a new
/// principal and never moves an identity between principals.
pub async fn attach_subject(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    lock_subject_advisory(conn, verified.subject.as_str()).await?;
    attach_subject_under_advisory_lock(conn, verified, principal_id, now).await
}

/// Attach a WorkOS subject after the caller acquired
/// [`lock_subject_advisory`]. This split lets account-linking acquire the
/// provider lock before it revalidates and locks the caller's local session,
/// preserving the global provider-subject -> principal lock order.
pub async fn attach_subject_under_advisory_lock(
    conn: &mut PgConnection,
    verified: &VerifiedIdentity,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    if verified.expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    reject_tombstoned_identity(conn, verified).await?;
    let discovered = discover_subject(conn, verified.subject.as_str()).await?;
    methods::lock_active_principal_and_subject(conn, principal_id, now).await?;
    let owner = methods::lock_identity_mutation(
        conn,
        principal_id,
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let global_capabilities = owner.global_capabilities;
    if let Some(identity) = &discovered {
        if identity.principal_id != *principal_id {
            return Err(IdentityFlowError::AlreadyExists(
                "this WorkOS identity is linked to another principal",
            ));
        }
    }

    let (method_id, method_status) = if let Some(identity) = discovered.as_ref() {
        let status = lock_method(conn, identity.method_id, principal_id).await?;
        (identity.method_id, Some(status))
    } else {
        (
            methods::create_method(conn, principal_id, crate::MethodKind::Workos, now).await?,
            None,
        )
    };

    let locked_binding = lock_subject_binding(conn, verified.subject.as_str()).await?;
    if locked_binding != discovered {
        return Err(IdentityFlowError::Unauthorized);
    }
    if method_status.as_deref() == Some("active") {
        return Err(IdentityFlowError::AlreadyExists(
            "a WorkOS authentication method for this principal",
        ));
    }
    if let Some(status) = method_status.as_deref() {
        if status != "disabled" {
            return Err(IdentityFlowError::Unauthorized);
        }
        sqlx::query(
            "UPDATE authentication_method SET status = 'active', disabled_at = NULL WHERE method_id = $1",
        )
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
    }
    methods::touch_method(conn, method_id, now).await?;
    if discovered.is_some() {
        let updated = sqlx::query(
            "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label) WHERE provider = 'workos' AND subject = $3 AND principal_id = $4",
        )
        .bind(now)
        .bind(verified.email.as_deref())
        .bind(verified.subject.as_str())
        .bind(principal_id.as_uuid())
        .execute(&mut *conn)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(IdentityFlowError::Unauthorized);
        }
    } else {
        sqlx::query(
            "INSERT INTO external_identity (provider, subject, principal_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, $4, $4, $5)",
        )
        .bind(verified.subject.as_str())
        .bind(principal_id.as_uuid())
        .bind(verified.email.as_deref())
        .bind(now)
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(WorkosResolution {
        principal_id: *principal_id,
        global_capabilities,
        method_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        logout_url, subject_fingerprint, AccessTokenVerifier, StaticAccessTokenVerifier,
        VerifiedIdentity, WorkosAccessTokenVerifier, WorkosSessionId,
    };

    #[test]
    fn workos_configuration_is_all_or_nothing() {
        let verifier = WorkosAccessTokenVerifier::new(
            "client_123",
            "https://api.workos.com/",
            "https://api.workos.com/sso/jwks/client_123",
        )
        .unwrap();
        assert_eq!(verifier.client_id.as_ref(), "client_123");
        assert_eq!(verifier.issuer.as_ref(), "https://api.workos.com/");
        assert!(WorkosAccessTokenVerifier::new("", "issuer", "https://example.test/jwks").is_err());
    }

    #[tokio::test]
    async fn static_verifier_is_a_deterministic_local_proof_boundary() {
        let expected = VerifiedIdentity {
            subject: "user_01".to_string(),
            session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
            expires_at: 4_102_444_800,
            email: Some("player@example.test".to_string()),
        };
        let verifier =
            StaticAccessTokenVerifier::new([("signed-test-token".to_string(), expected.clone())]);
        assert_eq!(
            verifier.verify("signed-test-token").await.unwrap(),
            expected
        );
        assert!(verifier.verify("wrong-token").await.is_err());
    }

    #[test]
    fn workos_session_ids_and_logout_urls_are_closed_over_canonical_provider_ids() {
        let session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
        assert_eq!(
            logout_url(&session_id),
            "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
        );
        assert_eq!(
            session_id.fingerprint(),
            "12809d16e8a0869e08f32b449c05398bb6052a3905ea1d5d2506abe8ceb8755e"
        );
        assert_eq!(
            subject_fingerprint("user_01"),
            "91f494a9228102f44ffa1067a2a9194a7c003b5ef61502e0ee6e5d8fdcdf39f0"
        );

        for invalid in [
            "session_01HQAG1HENBZMAZD82YRXDFC0I",
            "session_01hqag1henbzmazd82yrxdfc0b",
            "session_short",
            "session_01HQAG1HENBZMAZD82YRXDFC0B&return_to=https://evil.test",
            "https://evil.test/",
        ] {
            assert!(WorkosSessionId::parse(invalid).is_err(), "{invalid}");
        }
    }
}
