pub mod data_lifecycle;
pub mod error;
pub mod member_lifecycle;
pub mod methods;
pub mod password;
pub mod session;
pub mod subject_privacy;
pub mod token;
pub mod workos;

pub use data_lifecycle::{
    apply_lifecycle_events, decide_member_lifecycle, disposition, DataClass,
    MemberLifecycleCommand, MemberLifecycleEvent, MemberLifecycleReject, MemberLifecycleState,
    MemberLifecycleStatus, RetentionDisposition, MEMBER_AUTHORSHIP_PSEUDONYMIZED,
    MEMBER_CREDENTIALS_ERASED, MEMBER_DEACTIVATED, MEMBER_ERASURE_REQUESTED,
    MEMBER_PERSONAL_EXPORT_RECORDED,
};

pub use error::IdentityFlowError;
pub use member_lifecycle::{
    apply_member_lifecycle, create_personal_export, erase_member, load_personal_export,
    rebuild_member_lifecycle, request_member_erasure, request_member_erasure_with_store,
    MemberLifecycleSnapshot, PersonalExport,
};
pub use session::{
    AuthorizationContext, CompletedWorkosLogout, IssuedSession, LogoutSessionState, RotatedSession,
    SessionPolicy, SessionSpec,
};
pub use subject_privacy::{
    active_subject_key_store, bootstrap_subject_key_authority_from_environment,
    configured_subject_key_authority, configured_subject_key_store, install_subject_key_store,
    open_subject_claim, prepare_subject_authority_for_service, process_pending_subject_erasures,
    process_pending_subject_erasures_with_store, random_tombstone_alias,
    reconcile_subject_revocations, reconcile_subject_revocations_with_store, seal_subject_claim,
    verify_active_subject_keys, verify_or_bind_database_authority, ClaimId,
    ConfiguredSubjectKeyAuthority, FilesystemSubjectKeyStore, ObjectSubjectKeyStore,
    ObjectSubjectKeyStoreConfig, SubjectAuthorityManifest, SubjectClaimEnvelope, SubjectId,
    SubjectKeyStore, SubjectPrivacyError, SubjectRevocationRecord,
};
pub use workos::{
    AccessTokenVerifier, IdentityError, StaticAccessTokenVerifier, VerifiedIdentity,
    WorkosAccessTokenVerifier, WorkosSessionId,
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
