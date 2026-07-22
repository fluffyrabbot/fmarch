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
        required(client_id.into(), "client id")?;
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
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT principal_user_id FROM external_identity WHERE provider = 'workos' AND subject = $1",
    )
    .bind(verified.subject.as_str())
    .fetch_optional(&mut *conn)
    .await?;
    let principal_user_id = match existing {
        Some(principal_user_id) => principal_user_id,
        None => {
            let principal_user_id = format!("principal-{}", Uuid::new_v4());
            sqlx::query(
                "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at, disabled_at) VALUES ($1, 'active', '{}'::TEXT[], $2, NULL)",
            )
            .bind(principal_user_id.as_str())
            .bind(now)
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "INSERT INTO external_identity (provider, subject, principal_user_id, display_label, created_at, last_seen_at) VALUES ('workos', $1, $2, $3, $4, $4)",
            )
            .bind(verified.subject.as_str())
            .bind(principal_user_id.as_str())
            .bind(verified.email.as_deref())
            .bind(now)
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
            principal_user_id
        }
    };
    sqlx::query(
        "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label) WHERE provider = 'workos' AND subject = $3",
    )
    .bind(now)
    .bind(verified.email.as_deref())
    .bind(verified.subject.as_str())
    .execute(&mut *conn)
    .await?;
    let method_id = methods::link_workos_method(
        &mut *conn,
        verified.subject.as_str(),
        principal_user_id.as_str(),
        now,
    )
    .await?;
    let principal = sqlx::query_as::<_, (String, Vec<String>)>(
        "SELECT status, global_capabilities FROM platform_principal WHERE principal_user_id = $1",
    )
    .bind(principal_user_id.as_str())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    if principal.0 != "active" {
        return Err(IdentityFlowError::Unauthorized);
    }
    Ok(WorkosResolution {
        principal_user_id,
        global_capabilities: principal.1,
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
    let principal = sqlx::query_as::<_, (String, Vec<String>)>(
        "SELECT status, global_capabilities FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(principal_user_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    if principal.0 != "active" {
        return Err(IdentityFlowError::Unauthorized);
    }

    let existing = sqlx::query_as::<_, (String, Option<Uuid>, Option<String>)>(
        r#"
        SELECT identity.principal_user_id, identity.method_id, method.status
        FROM external_identity AS identity
        LEFT JOIN authentication_method AS method ON method.method_id = identity.method_id
        WHERE identity.provider = 'workos' AND identity.subject = $1
        FOR UPDATE OF identity
        "#,
    )
    .bind(verified.subject.as_str())
    .fetch_optional(&mut *conn)
    .await?;

    let method_id = match existing {
        Some((linked_principal, _, _)) if linked_principal != principal_user_id => {
            return Err(IdentityFlowError::AlreadyExists(
                "this WorkOS identity is linked to another principal",
            ));
        }
        Some((_, Some(method_id), Some(status))) => {
            if status == "active" {
                return Err(IdentityFlowError::AlreadyExists(
                    "a WorkOS authentication method for this principal",
                ));
            }
            sqlx::query(
                "UPDATE authentication_method SET status = 'active', disabled_at = NULL, last_authenticated_at = $2 WHERE method_id = $1",
            )
            .bind(method_id)
            .bind(now)
            .execute(&mut *conn)
            .await?;
            method_id
        }
        Some((_, None, _)) => {
            let method_id =
                methods::create_method(conn, principal_user_id, crate::MethodKind::Workos, now)
                    .await?;
            sqlx::query(
                "UPDATE external_identity SET method_id = $2 WHERE provider = 'workos' AND subject = $1",
            )
            .bind(verified.subject.as_str())
            .bind(method_id)
            .execute(&mut *conn)
            .await?;
            method_id
        }
        Some((_, Some(_), None)) => {
            return Err(IdentityFlowError::Internal(
                "WorkOS identity references a missing authentication method".to_string(),
            ));
        }
        None => {
            let method_id =
                methods::create_method(conn, principal_user_id, crate::MethodKind::Workos, now)
                    .await?;
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
            method_id
        }
    };
    sqlx::query(
        "UPDATE external_identity SET last_seen_at = $1, display_label = COALESCE($2, display_label) WHERE provider = 'workos' AND subject = $3",
    )
    .bind(now)
    .bind(verified.email.as_deref())
    .bind(verified.subject.as_str())
    .execute(&mut *conn)
    .await?;
    methods::touch_method(conn, method_id, now).await?;
    Ok(WorkosResolution {
        principal_user_id: principal_user_id.to_string(),
        global_capabilities: principal.1,
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
