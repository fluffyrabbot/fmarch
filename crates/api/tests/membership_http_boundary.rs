use std::path::PathBuf;

#[test]
fn membership_mutations_commit_under_the_initiating_session_fence() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let http = std::fs::read_to_string(source_root.join("membership_http.rs")).unwrap();
    let authority = std::fs::read_to_string(source_root.join("authority.rs")).unwrap();
    let crates_root = source_root.parent().unwrap().parent().unwrap();
    let application =
        std::fs::read_to_string(crates_root.join("membership_application/src/lib.rs")).unwrap();

    for contract in [
        "AuthorizedUnitOfWork::begin",
        "issue_invitation_in_tx",
        "revoke_invitation_for_sponsor_in_tx",
        "steward_membership_in_tx",
        "steward_revoke_invitation_in_tx",
    ] {
        assert!(
            http.contains(contract),
            "membership HTTP lost its commit-bound authority contract: {contract}"
        );
    }
    for authority_contract in [
        "identity::session::begin_authority_transaction",
        "identity::session::validate_session_for_update",
        "request.context.principal_id",
        "self.transaction.commit()",
    ] {
        assert!(
            authority.contains(authority_contract),
            "authorized unit of work lost contract: {authority_contract}"
        );
    }
    for application_boundary in [
        "pub async fn revoke_invitation_for_sponsor_in_tx(",
        "pub async fn steward_membership_in_tx(",
        "pub async fn steward_revoke_invitation_in_tx(",
    ] {
        assert!(
            application.contains(application_boundary),
            "membership application lost caller-owned transaction boundary: {application_boundary}"
        );
    }
    assert!(
        !http.contains("membership_application::steward_membership(\n")
            && !http.contains("membership_application::steward_revoke_invitation(\n")
            && !http.contains("membership_application::revoke_invitation(\n"),
        "HTTP mutations must not escape into a second unfenced transaction"
    );
}
