//! Explicit test-only access to lifecycle setup operations that bypass bearer
//! and initiating-session authority.
//!
//! Production consumers must use the authenticated lifecycle entry points.
//! This module exists only in a debug build when the non-default
//! `test-support` feature is deliberately enabled by an integration-test
//! target. Enabling it in a non-debug build is a compile-time error.

use crate::subject_privacy::SubjectErasureWork;
use crate::{
    member_lifecycle, IdentityError, IdentityFlowError, MemberLifecycleCommand,
    MemberLifecycleSnapshot, MemberLifecycleStatus, PersonalExport, PrincipalId, SubjectKeyStore,
    VerifiedIdentity, WorkosSessionId,
};
use sqlx::PgPool;
use uuid::Uuid;

pub use crate::workos::StaticAccessTokenVerifier;

pub fn verified_workos_identity(
    subject: impl Into<String>,
    session_id: WorkosSessionId,
    issued_at: i64,
    expires_at: i64,
    signing_key_id: impl Into<String>,
    email: Option<String>,
) -> Result<VerifiedIdentity, IdentityError> {
    VerifiedIdentity::for_test(
        subject,
        session_id,
        issued_at,
        expires_at,
        signing_key_id,
        email,
    )
}

pub async fn apply_member_lifecycle(
    pool: &PgPool,
    principal_id: &PrincipalId,
    command: MemberLifecycleCommand,
    now: i64,
) -> Result<MemberLifecycleStatus, IdentityFlowError> {
    member_lifecycle::apply_member_lifecycle(pool, principal_id, command, now).await
}

pub async fn erase_member(
    pool: &PgPool,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    member_lifecycle::erase_member(pool, principal_id, now).await
}

pub async fn request_member_erasure(
    pool: &PgPool,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    member_lifecycle::request_member_erasure(pool, principal_id, now).await
}

pub async fn request_member_erasure_with_store(
    pool: &PgPool,
    key_store: &dyn SubjectKeyStore,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<(MemberLifecycleSnapshot, SubjectErasureWork), IdentityFlowError> {
    member_lifecycle::request_member_erasure_with_store(pool, key_store, principal_id, now).await
}

pub async fn create_personal_export(
    pool: &PgPool,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<PersonalExport, IdentityFlowError> {
    member_lifecycle::create_personal_export(pool, principal_id, now).await
}

pub async fn load_personal_export(
    pool: &PgPool,
    principal_id: &PrincipalId,
    export_id: Uuid,
    now: i64,
) -> Result<Option<PersonalExport>, IdentityFlowError> {
    member_lifecycle::load_personal_export(pool, principal_id, export_id, now).await
}

pub async fn rebuild_member_lifecycle(
    pool: &PgPool,
    principal_id: &PrincipalId,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    member_lifecycle::rebuild_member_lifecycle(pool, principal_id).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn authority_free_lifecycle_surface_remains_feature_gated() {
        let library = include_str!("lib.rs");
        let lifecycle = include_str!("member_lifecycle.rs");
        let production_exports = library
            .split("pub use member_lifecycle::{")
            .nth(1)
            .and_then(|source| source.split("};").next())
            .expect("member lifecycle production exports");
        let production_exports = production_exports
            .split(',')
            .map(str::trim)
            .collect::<Vec<_>>();

        assert!(library.contains(
            "#[cfg(all(feature = \"test-support\", debug_assertions))]\npub mod test_support;"
        ));
        for function in [
            "apply_member_lifecycle",
            "erase_member",
            "request_member_erasure",
            "request_member_erasure_with_store",
            "create_personal_export",
            "load_personal_export",
            "rebuild_member_lifecycle",
        ] {
            assert!(
                lifecycle.contains(&format!("pub(crate) async fn {function}(")),
                "authority-free lifecycle function escaped crate visibility: {function}",
            );
            assert!(
                !production_exports.contains(&function),
                "authority-free lifecycle function gained a production re-export: {function}",
            );
        }
    }

    #[test]
    fn test_support_refuses_release_and_normal_dependency_edges() {
        let library = include_str!("lib.rs");
        let manifest = include_str!("../Cargo.toml");
        assert!(manifest.contains("default = []\ntest-support = []"));
        assert!(library.contains(
            "#[cfg(all(feature = \"test-support\", not(debug_assertions)))]\ncompile_error!(\"identity test-support must not be enabled in a non-debug build\");"
        ));

        let crates_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace crates directory");
        for entry in std::fs::read_dir(crates_dir).expect("read workspace crates") {
            let path = entry
                .expect("read workspace crate entry")
                .path()
                .join("Cargo.toml");
            if !path.is_file() {
                continue;
            }
            let manifest = std::fs::read_to_string(&path).expect("read workspace manifest");
            let mut dependency_table = "";
            for line in manifest.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('[') && trimmed.ends_with(']') {
                    dependency_table = trimmed;
                }
                if trimmed.contains("test-support") {
                    assert!(
                        dependency_table.contains("dev-dependencies")
                            || path
                                == std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                                    .join("Cargo.toml"),
                        "identity test-support escaped a dev dependency in {} ({dependency_table})",
                        path.display(),
                    );
                }
            }
        }
    }

    #[test]
    fn session_issuance_surface_is_ceremony_bound() {
        let session = include_str!("session.rs");
        let library = include_str!("lib.rs");
        let workos = include_str!("workos.rs");
        let membership_application = include_str!("../../membership_application/src/lib.rs");

        assert!(!session.contains("pub struct SessionSpec"));
        assert!(!session.contains("pub async fn issue_session("));
        assert!(session.contains("async fn issue_session_raw("));
        assert!(!library.contains("SessionSpec"));
        assert!(!library.contains("AuthenticationGrant"));
        assert!(!membership_application.contains("SessionSpec"));
        assert!(!membership_application.contains("session::issue_session"));
        assert!(membership_application.contains("issue_community_admission_session"));

        let raw_issuance = session
            .split("async fn issue_session_raw(")
            .nth(1)
            .and_then(|source| source.split("pub struct AuthorizationContext").next())
            .expect("private raw session issuance boundary");
        let key_revalidation = raw_issuance
            .find("require_active_workos_signing_key(conn, key_id).await?")
            .expect("raw issuance revalidates WorkOS signing-key authority");
        let token_generation = raw_issuance
            .find("let session_token = generate_session_token()")
            .expect("raw issuance token generation");
        let session_insert = raw_issuance
            .find("INSERT INTO auth_session")
            .expect("raw issuance session insert");
        assert!(
            key_revalidation < token_generation && token_generation < session_insert,
            "a retained WorkOS grant must revalidate its signing key immediately before issuance",
        );

        for ceremony in [
            "issue_classic_password_session",
            "authorize_workos_session",
            "issue_workos_session",
            "issue_local_proof_session",
            "issue_session_after_classic_method_added",
            "redeem_recovery_credential_and_issue_session",
            "redeem_game_invitation_and_issue_session",
            "issue_community_admission_session",
        ] {
            assert!(
                session.contains(&format!("pub async fn {ceremony}(")),
                "missing ceremony-bound issuance entry point: {ceremony}",
            );
        }

        for opaque in [
            "ClassicPasswordProof",
            "WorkosSessionGrant",
            "LocalProofSessionGrant",
            "InitiatingSession",
        ] {
            let body = session
                .split(&format!("pub struct {opaque} {{"))
                .nth(1)
                .and_then(|source| source.split('}').next())
                .expect("opaque evidence type");
            assert!(
                body.lines()
                    .all(|line| !line.trim_start().starts_with("pub ")),
                "opaque session evidence exposes a public field: {opaque}",
            );
        }

        let verified_identity = workos
            .split("pub struct VerifiedIdentity {")
            .nth(1)
            .and_then(|source| source.split('}').next())
            .expect("verified WorkOS identity");
        assert!(verified_identity
            .lines()
            .all(|line| !line.trim_start().starts_with("pub ")));
        let workos_resolution = workos
            .split("pub struct WorkosResolution {")
            .nth(1)
            .and_then(|source| source.split('}').next())
            .expect("WorkOS resolution");
        assert!(workos_resolution
            .lines()
            .all(|line| !line.trim_start().starts_with("pub ")));
        assert!(workos.contains(
            "#[cfg(all(feature = \"test-support\", debug_assertions))]\n#[derive(Clone, Default)]\npub struct StaticAccessTokenVerifier"
        ));
        assert!(!library.contains("StaticAccessTokenVerifier"));
    }
}
