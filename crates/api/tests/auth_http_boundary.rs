use std::path::PathBuf;

#[test]
fn auth_http_has_one_typed_owner_without_transport_or_persistence_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let auth_http = std::fs::read_to_string(source_root.join("auth_http.rs")).unwrap();
    let authentication = std::fs::read_to_string(source_root.join("authentication.rs")).unwrap();
    let identity_delivery =
        std::fs::read_to_string(source_root.join("identity_delivery.rs")).unwrap();

    assert!(composition_root.contains("mod auth_http;"));
    assert!(composition_root.contains("auth: AuthHttpState"));
    assert!(composition_root.contains("let auth_routes = auth_http::routes(&state);"));
    assert!(auth_http.contains("struct AuthHttpState"));
    assert!(auth_http.contains("fn routes(state: &ApiState) -> Router<ApiState>"));
    assert!(auth_http.contains("\"/auth/local-proof/sessions\""));
    assert!(!auth_http.contains("\"/auth/session-grants\""));
    assert!(!auth_http.contains("\"/auth/dev-session\""));
    assert!(!auth_http.contains("CreateAuthSessionGrant"));
    assert!(!auth_http.contains("create_auth_session_grant"));
    assert!(!auth_http.contains("std::env::var(\"FMARCH_DEV_AUTH\")"));
    assert!(!auth_http.contains("std::env::var(\"FMARCH_LOCAL_PROOF_SECRET\")"));
    let local_proof_route = auth_http
        .split("// Arbitrary-principal session minting is a local-proof capability")
        .nth(1)
        .and_then(|source| source.split("router.with_state").next())
        .expect("local-proof session route boundary");
    assert!(local_proof_route.contains("#[cfg(debug_assertions)]"));
    assert!(local_proof_route.contains("post(create_local_proof_auth_session)"));

    for owned_symbol in [
        "use identity::AuthorizationContext",
        "struct AuthSessionResponse",
        "async fn create_auth_session(",
        "async fn register_auth_account(",
        "async fn login_auth_account(",
        "async fn rotate_auth_session(",
        "async fn logout_auth_session(",
        "async fn create_game_invitation(",
        "async fn retry_auth_delivery_intent(",
    ] {
        assert!(
            auth_http.contains(owned_symbol),
            "missing auth owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns auth HTTP symbol: {owned_symbol}"
        );
    }

    assert!(authentication.contains("enforce_auth_attempt_limit"));
    assert!(authentication.contains("deliver_auth_credential"));
    assert!(identity_delivery.contains("trait IdentityDeliveryGateway"));
    assert!(identity_delivery.contains("process_identity_delivery_intent"));
    assert!(!auth_http.contains("authenticate_legacy_token"));
    assert!(!auth_http.contains("allow_jwt_bearer"));
    assert!(!auth_http.contains("issue_debug_session"));
    assert!(!auth_http.contains("requested_debug_token"));
    assert!(auth_http.contains("struct RotateAuthSession {}"));
    let authorization_context = auth_http
        .split("pub(super) async fn authorization_context(")
        .nth(1)
        .and_then(|source| source.split("fn identity_api_error(").next())
        .expect("authorization_context boundary");
    assert!(authorization_context.contains("identity::session::validate_session("));
    assert!(!authorization_context.contains("validate_session_reference"));
    assert!(!authorization_context.contains("hash_session_token"));
    for issuance_request in [
        "CreateLocalProofAuthSession",
        "RegisterAuthAccount",
        "LoginAuthAccount",
        "RecoverAuthAccount",
        "RedeemAuthInvite",
        "AddClassicMethod",
    ] {
        assert!(
            auth_http.contains(
                format!("#[serde(deny_unknown_fields)]\nstruct {issuance_request}").as_str()
            ),
            "session issuance request {issuance_request} must reject client-selected credentials",
        );
    }
    let local_proof_handler = auth_http
        .split("async fn create_local_proof_auth_session(")
        .nth(1)
        .and_then(|source| source.split("async fn create_auth_account(").next())
        .expect("local-proof session handler boundary");
    assert!(local_proof_handler.contains("LOCAL_PROOF_AUTH_HEADER"));
    assert!(local_proof_handler.contains("verifier.verifies(secret)"));
    assert!(local_proof_handler.contains("verifier.instance_id().clone()"));
    assert!(local_proof_handler.contains("StatusCode::NOT_FOUND"));
    assert!(!local_proof_handler.contains("dev_auth_enabled"));
    assert!(!local_proof_handler.contains("Assurance::AdminGrant"));

    let live_delivery = std::fs::read_to_string(source_root.join("live_delivery.rs")).unwrap();
    assert!(live_delivery.contains("async fn create_websocket_ticket("));
    assert!(live_delivery.contains("async fn ws_session("));
    assert!(!live_delivery.contains("AdminGrant"));
    assert!(!live_delivery.contains("admin_grant"));
    assert!(!live_delivery.contains("auth_kind"));
    assert!(!live_delivery.contains("authorization_kind"));

    let crates_root = source_root.parent().unwrap().parent().unwrap();
    let identity = std::fs::read_to_string(crates_root.join("identity/src/lib.rs")).unwrap();
    let identity_session =
        std::fs::read_to_string(crates_root.join("identity/src/session.rs")).unwrap();
    let identity_methods =
        std::fs::read_to_string(crates_root.join("identity/src/methods.rs")).unwrap();
    let member_lifecycle =
        std::fs::read_to_string(crates_root.join("identity/src/member_lifecycle.rs")).unwrap();
    let subject_privacy =
        std::fs::read_to_string(crates_root.join("identity/src/subject_privacy.rs")).unwrap();
    assert!(identity.contains("#[cfg(debug_assertions)]\n    Dev,"));
    assert!(!identity.contains("AdminGrant"));
    assert!(identity_session.contains("#[cfg(not(debug_assertions))]"));
    assert!(identity_session.contains("pub struct LocalProofInstanceId(Arc<LocalProofProcess>)"));
    assert!(identity_session.contains("session_authorizations: Mutex<HashMap"));
    assert!(identity_session.contains("expected.session_capabilities(session_reference, now)?"));
    assert!(!identity_session.contains("session.global_capabilities AS snapshot_globals"));
    assert!(identity_session.contains("workos_signing_key_id"));
    assert!(!identity_methods.contains("auth_websocket_ticket"));
    for source in [&member_lifecycle, &subject_privacy] {
        assert!(source.contains("ticket.session_reference = session.token_hash"));
        assert!(!source.contains("auth_websocket_ticket WHERE principal_id"));
        assert!(!source.contains("ticket.principal_id"));
    }
    for authenticated_lifecycle_boundary in [
        "create_personal_export_authenticated(",
        "load_personal_export_authenticated(",
        "apply_member_lifecycle_authenticated(",
        "request_member_erasure_authenticated(",
    ] {
        assert!(
            auth_http.contains(authenticated_lifecycle_boundary),
            "authenticated lifecycle route lost its commit-bound session fence: {authenticated_lifecycle_boundary}",
        );
    }
    let erasure_commit = member_lifecycle
        .split("async fn request_member_erasure_with_store_and_authority(")
        .nth(1)
        .and_then(|source| source.split("type AuthorityBinding").next())
        .expect("authenticated erasure commit boundary");
    let owner_lock = erasure_commit
        .find("lock_identity_mutation(")
        .expect("erasure owner lock");
    let session_fence = erasure_commit
        .find("require_initiating_authority(&mut tx, &owner")
        .expect("erasure initiating-session fence");
    let durable_write = erasure_commit
        .find("append_and_project(")
        .expect("erasure durable write");
    assert!(
        owner_lock < session_fence && session_fence < durable_write,
        "erasure must lock its owner, revalidate the initiating session, then persist"
    );
    assert!(composition_root.contains("with_local_proof_instance(verifier.instance_id().clone())"));
    assert!(!composition_root.contains("async fn create_websocket_ticket("));
    assert!(!composition_root.contains("async fn ws_session("));
    assert!(!auth_http.contains("async fn create_websocket_ticket("));
    assert!(!auth_http.contains("async fn ws_session("));
    assert!(
        !auth_http.contains("use super::*")
            && !auth_http.contains("#[expect")
            && !auth_http.contains("#[allow(clippy"),
        "the auth HTTP boundary must not hide ownership or lint debt"
    );
}
