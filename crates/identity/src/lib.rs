pub mod data_lifecycle;
pub mod error;
pub mod member_lifecycle;
pub mod methods;
pub mod password;
pub mod private_claims;
pub mod session;
pub mod subject_privacy;
pub mod token;
pub mod workos;

pub use principal::PrincipalId;

pub use data_lifecycle::{
    apply_lifecycle_events, decide_member_lifecycle, disposition, DataClass,
    MemberLifecycleCommand, MemberLifecycleEvent, MemberLifecycleReject, MemberLifecycleState,
    MemberLifecycleStatus, RetentionDisposition, MEMBER_AUTHORSHIP_PSEUDONYMIZED,
    MEMBER_CREDENTIALS_ERASED, MEMBER_DEACTIVATED, MEMBER_ERASURE_REQUESTED,
    MEMBER_PERSONAL_EXPORT_RECORDED,
};

pub use error::IdentityFlowError;
pub use member_lifecycle::{
    apply_member_lifecycle, apply_member_lifecycle_authenticated, create_personal_export,
    create_personal_export_authenticated, erase_member, load_personal_export,
    load_personal_export_authenticated, rebuild_member_lifecycle, request_member_erasure,
    request_member_erasure_authenticated, request_member_erasure_with_store,
    MemberLifecycleSnapshot, PersonalExport,
};
pub use private_claims::{
    ensure_active_subject, insert_subject_claim, open_active_subject_claim, PrivateClaimError,
};
#[cfg(debug_assertions)]
pub use session::{activate_local_proof_authorization, LocalProofAuthorization};
pub use session::{
    require_active_workos_signing_key, retire_workos_signing_key,
    revalidate_initiating_session_after_owner_lock, revoke_local_proof_sessions_for_startup,
    validate_session_reference_for_update, AuthorizationContext, CompletedWorkosLogout,
    InitiatingSession, IssuedSession, LocalProofInstanceId, LocalProofStartupRevocation,
    LogoutSessionState, RotatedSession, SessionPolicy, SessionSpec, WorkosSigningKeyId,
    WorkosSigningKeyRetirement,
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

/// How a session was authenticated. Debug-only local-proof sessions have no
/// authentication method; their assurance records that exceptional origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assurance {
    Password,
    ExternalSso,
    #[cfg(debug_assertions)]
    Dev,
}

impl Assurance {
    pub fn as_str(&self) -> &'static str {
        match self {
            Assurance::Password => "password",
            Assurance::ExternalSso => "external_sso",
            #[cfg(debug_assertions)]
            Assurance::Dev => "dev",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "password" => Some(Assurance::Password),
            "external_sso" => Some(Assurance::ExternalSso),
            #[cfg(debug_assertions)]
            "dev" => Some(Assurance::Dev),
            _ => None,
        }
    }
}

/// Produced by any successful authentication; consumed only by session
/// issuance. Both classic and WorkOS verification end here.
#[derive(Debug, Clone)]
pub struct AuthenticationGrant {
    pub principal_id: PrincipalId,
    pub method_id: uuid::Uuid,
    pub method_kind: MethodKind,
    pub authenticated_at: i64,
    pub assurance: Assurance,
}
