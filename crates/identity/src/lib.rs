pub mod error;
pub mod methods;
pub mod password;
pub mod session;
pub mod token;
pub mod workos;

pub use error::IdentityFlowError;
pub use session::{IssuedSession, SessionPolicy, SessionSpec};
pub use workos::{
    AccessTokenVerifier, IdentityError, StaticAccessTokenVerifier, VerifiedIdentity,
    WorkosAccessTokenVerifier,
};

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
