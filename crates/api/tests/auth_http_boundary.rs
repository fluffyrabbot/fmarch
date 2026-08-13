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

    for owned_symbol in [
        "use identity::AuthorizationContext",
        "struct AuthSessionResponse",
        "async fn create_auth_session(",
        "async fn register_auth_account(",
        "async fn login_auth_account(",
        "async fn rotate_auth_session(",
        "async fn logout_auth_session(",
        "async fn create_auth_invite(",
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
        "CreateDevAuthSession",
        "CreateAuthSessionGrant",
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

    let live_delivery = std::fs::read_to_string(source_root.join("live_delivery.rs")).unwrap();
    assert!(live_delivery.contains("async fn create_websocket_ticket("));
    assert!(live_delivery.contains("async fn ws_session("));
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
