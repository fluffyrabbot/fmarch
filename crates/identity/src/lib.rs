use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;

pub mod error;
pub mod methods;
pub mod password;
pub mod session;
pub mod token;

pub use error::IdentityFlowError;
pub use session::{IssuedSession, SessionPolicy, SessionSpec};

/// The two first-class sign-in methods. Wire and storage strings are the
/// kind column values in authentication_method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MethodKind {
    ClassicPassword,
    Workos,
}

impl MethodKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            MethodKind::ClassicPassword => "classic_password",
            MethodKind::Workos => "workos",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "classic_password" => Some(MethodKind::ClassicPassword),
            "workos" => Some(MethodKind::Workos),
            _ => None,
        }
    }
}

/// How a session was authenticated. Dev sessions and admin session grants have
/// no authentication method; their assurance records what stood in for one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assurance {
    Password,
    ExternalSso,
    Dev,
    AdminGrant,
}

impl Assurance {
    pub fn as_str(&self) -> &'static str {
        match self {
            Assurance::Password => "password",
            Assurance::ExternalSso => "external_sso",
            Assurance::Dev => "dev",
            Assurance::AdminGrant => "admin_grant",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "password" => Some(Assurance::Password),
            "external_sso" => Some(Assurance::ExternalSso),
            "dev" => Some(Assurance::Dev),
            "admin_grant" => Some(Assurance::AdminGrant),
            _ => None,
        }
    }
}

/// Produced by any successful authentication; consumed only by session
/// issuance. Both classic and WorkOS verification end here.
#[derive(Debug, Clone)]
pub struct AuthenticationGrant {
    pub principal_user_id: String,
    pub method_id: uuid::Uuid,
    pub method_kind: MethodKind,
    pub authenticated_at: i64,
    pub assurance: Assurance,
}

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
    issuer: Arc<str>,
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
