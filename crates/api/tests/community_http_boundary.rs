use std::path::PathBuf;

#[test]
fn community_http_has_one_typed_owner_without_transport_or_persistence_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let community_http = std::fs::read_to_string(source_root.join("community_http.rs")).unwrap();

    assert!(composition_root.contains("mod community_http;"));
    assert!(composition_root.contains("let community_routes = community_http::routes(&state);"));
    assert!(composition_root.contains(".merge(community_routes)"));
    assert!(community_http.contains("struct CommunityHttpState"));
    assert!(community_http.contains("fn routes(state: &ApiState) -> Router<ApiState>"));
    assert!(community_http.contains(".with_state(CommunityHttpState::new("));

    for owned_symbol in [
        "struct PublicSearchQuery",
        "async fn public_search(",
        "async fn community_inbox(",
        "async fn member_mutes(",
        "async fn subscription_target_state(",
        "async fn discussion_areas(",
        "async fn submit_moderation_report(",
        "async fn moderation_cases(",
        "async fn public_profile(",
        "async fn create_profile(",
    ] {
        assert!(
            community_http.contains(owned_symbol),
            "missing community HTTP owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns community HTTP symbol: {owned_symbol}"
        );
    }

    for excluded_symbol in [
        "async fn public_game_thread(",
        "async fn command(",
        "async fn create_websocket_ticket(",
        "async fn ws_session(",
    ] {
        assert!(composition_root.contains(excluded_symbol));
        assert!(
            !community_http.contains(excluded_symbol),
            "unrelated transport drifted into community HTTP: {excluded_symbol}"
        );
    }
    assert!(!community_http.contains("async fn create_auth_session("));

    assert!(
        !community_http.contains("sqlx::query")
            && !community_http.contains("use super::*")
            && !community_http.contains("#[expect")
            && !community_http.contains("#[allow(clippy"),
        "the community HTTP boundary must not own persistence or hide ownership/lint debt"
    );
}
