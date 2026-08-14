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
use sqlx::PgConnection;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::methods;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub session_id: String,
    pub expires_at: i64,
    pub email: Option<String>,
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
        let session_id =
            required(token.claims.sid, "session id").map_err(|_| IdentityError::InvalidToken)?;
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
    pub principal_user_id: String,
    pub global_capabilities: Vec<String>,
    pub method_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiscoveredWorkosIdentity {
    principal_user_id: String,
    method_id: Option<Uuid>,
}

async fn discover_subject(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<Option<DiscoveredWorkosIdentity>, IdentityFlowError> {
    Ok(sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT principal_user_id, method_id FROM external_identity WHERE provider = 'workos' AND subject = $1",
    )
    .bind(subject)
    .fetch_optional(&mut *conn)
    .await?
    .map(|(principal_user_id, method_id)| DiscoveredWorkosIdentity {
        principal_user_id,
        method_id,
    }))
}

async fn lock_method(
    conn: &mut PgConnection,
    method_id: Uuid,
    principal_user_id: &str,
) -> Result<String, IdentityFlowError> {
    let (linked_principal, kind, status) = sqlx::query_as::<_, (String, String, String)>(
        "SELECT principal_user_id, kind, status FROM authentication_method WHERE method_id = $1 FOR UPDATE",
    )
    .bind(method_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| {
        IdentityFlowError::Internal(
            "WorkOS identity references a missing authentication method".to_string(),
        )
    })?;
    if linked_principal != principal_user_id || kind != crate::MethodKind::Workos.as_str() {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(status)
}

async fn lock_subject_binding(
    conn: &mut PgConnection,
    subject: &str,
) -> Result<Option<DiscoveredWorkosIdentity>, IdentityFlowError> {
    Ok(sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT principal_user_id, method_id FROM external_identity WHERE provider = 'workos' AND subject = $1 FOR UPDATE",
    )
    .bind(subject)
    .fetch_optional(&mut *conn)
    .await?
    .map(|(principal_user_id, method_id)| DiscoveredWorkosIdentity {
        principal_user_id,
        method_id,
    }))
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
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("workos:{}", verified.subject))
        .execute(&mut *conn)
        .await?;
    // Discovery must never take the provider-detail lock. The owner gives us
    // the canonical principal -> privacy-subject lock root; the binding is
    // re-read under lock only after its authentication method is locked.
    let discovered = discover_subject(conn, verified.subject.as_str()).await?;
    let principal_user_id = discovered
        .as_ref()
        .map(|identity| identity.principal_user_id.clone())
        .unwrap_or_else(|| format!("principal-{}", Uuid::new_v4()));
    methods::ensure_principal(conn, principal_user_id.as_str(), &[], now).await?;
    let owner = methods::lock_identity_mutation(
        conn,
        principal_user_id.as_str(),
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let global_capabilities = owner.global_capabilities;

    let method_id = if let Some(method_id) = discovered.as_ref().and_then(|row| row.method_id) {
        if lock_method(conn, method_id, principal_user_id.as_str()).await? != "active" {
            return Err(IdentityFlowError::Unauthorized);
        }
        method_id
    } else {
        methods::create_method(
            conn,
            principal_user_id.as_str(),
            crate::MethodKind::Workos,
            now,
        )
        .await?
    };

    let locked_binding = lock_subject_binding(conn, verified.subject.as_str()).await?;
    if locked_binding != discovered {
        return Err(IdentityFlowError::Unauthorized);
    }
    methods::touch_method(conn, method_id, now).await?;
    if discovered.is_some() {
        let updated = sqlx::query(
            "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label), method_id = $3 WHERE provider = 'workos' AND subject = $4 AND principal_user_id = $5",
        )
        .bind(now)
        .bind(verified.email.as_deref())
        .bind(method_id)
        .bind(verified.subject.as_str())
        .bind(principal_user_id.as_str())
        .execute(&mut *conn)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(IdentityFlowError::Unauthorized);
        }
    } else {
        sqlx::query(
            "INSERT INTO external_identity (provider, subject, principal_user_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, $4, $4, $5)",
        )
        .bind(verified.subject.as_str())
        .bind(principal_user_id.as_str())
        .bind(verified.email.as_deref())
        .bind(now)
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO identity_lifecycle_audit (
                event_at, event_kind, actor_user_id, principal_user_id,
                token_hash, related_token_hash, metadata
            )
            VALUES ($1, 'external_identity_bound', NULL, $2, NULL, NULL, $3::JSONB)
            "#,
        )
        .bind(now)
        .bind(principal_user_id.as_str())
        .bind(serde_json::json!({ "provider": "workos" }).to_string())
        .execute(&mut *conn)
        .await?;
    }
    Ok(WorkosResolution {
        principal_user_id,
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
    principal_user_id: &str,
    now: i64,
) -> Result<WorkosResolution, IdentityFlowError> {
    if verified.expires_at <= now {
        return Err(IdentityFlowError::Unauthorized);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("workos:{}", verified.subject))
        .execute(&mut *conn)
        .await?;
    let discovered = discover_subject(conn, verified.subject.as_str()).await?;
    methods::lock_active_principal_and_subject(conn, principal_user_id, now).await?;
    let owner = methods::lock_identity_mutation(
        conn,
        principal_user_id,
        methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let global_capabilities = owner.global_capabilities;
    if let Some(identity) = &discovered {
        if identity.principal_user_id != principal_user_id {
            return Err(IdentityFlowError::AlreadyExists(
                "this WorkOS identity is linked to another principal",
            ));
        }
    }

    let (method_id, method_status) = if let Some(method_id) =
        discovered.as_ref().and_then(|row| row.method_id)
    {
        let status = lock_method(conn, method_id, principal_user_id).await?;
        (method_id, Some(status))
    } else {
        (
            methods::create_method(conn, principal_user_id, crate::MethodKind::Workos, now).await?,
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
            "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label), method_id = $3 WHERE provider = 'workos' AND subject = $4 AND principal_user_id = $5",
        )
        .bind(now)
        .bind(verified.email.as_deref())
        .bind(method_id)
        .bind(verified.subject.as_str())
        .bind(principal_user_id)
        .execute(&mut *conn)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(IdentityFlowError::Unauthorized);
        }
    } else {
        sqlx::query(
            "INSERT INTO external_identity (provider, subject, principal_user_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, $4, $4, $5)",
        )
        .bind(verified.subject.as_str())
        .bind(principal_user_id)
        .bind(verified.email.as_deref())
        .bind(now)
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(WorkosResolution {
        principal_user_id: principal_user_id.to_string(),
        global_capabilities,
        method_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        AccessTokenVerifier, StaticAccessTokenVerifier, VerifiedIdentity, WorkosAccessTokenVerifier,
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
            session_id: "session_01".to_string(),
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
}
