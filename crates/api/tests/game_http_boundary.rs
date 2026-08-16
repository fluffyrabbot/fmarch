use std::path::PathBuf;

#[test]
fn game_http_has_one_typed_owner_with_narrow_live_and_media_adapters() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let game_http = std::fs::read_to_string(source_root.join("game_http.rs")).unwrap();
    let command_http = std::fs::read_to_string(source_root.join("command_http.rs")).unwrap();
    let media_http = std::fs::read_to_string(source_root.join("media_http.rs")).unwrap();
    let live_delivery = std::fs::read_to_string(source_root.join("live_delivery.rs")).unwrap();

    assert!(composition_root.contains("mod game_http;"));
    assert!(composition_root.contains("let game_routes = game_http::routes(&state);"));
    assert!(composition_root.contains(".merge(game_routes)"));
    assert!(game_http.contains("struct GameHttpState"));
    assert!(game_http.contains("fn routes(state: &ApiState) -> Router<ApiState>"));
    assert!(game_http.contains(".with_state(GameHttpState::new("));
    assert!(!game_http.contains("State<ApiState>"));

    for owned_symbol in [
        "async fn game_index(",
        "async fn public_game_thread(",
        "async fn public_game_post_citations(",
        "async fn completed_game_export(",
        "async fn channel_thread_view(",
        "async fn channel_post_citations(",
        "async fn player_notifications(",
        "async fn player_command_state(",
        "async fn host_phase_controls(",
        "async fn host_console_state(",
        "async fn host_setup_state(",
        "struct PlayerCommandStateResponse",
        "struct HostConsoleStateResponse",
        "struct HostSetupStateResponse",
    ] {
        assert!(
            game_http.contains(owned_symbol),
            "missing game HTTP owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns game HTTP symbol: {owned_symbol}"
        );
    }

    for shared_adapter in [
        "pub(super) async fn current_votecount_deltas(",
        "pub(super) async fn current_thread_posts_delta(",
        "pub(super) async fn current_thread_posts_after_delta(",
        "pub(super) async fn current_post_citations_deltas(",
        "pub(super) async fn require_channel_thread_access(",
        "pub(super) async fn player_notifications_for_principal(",
        "pub(super) async fn player_investigation_results_for_principal(",
        "pub(super) async fn resolve_host_console_authority(",
        "pub(super) async fn load_host_console_state(",
        "pub(super) async fn require_host_audit_access(",
    ] {
        assert!(
            game_http.contains(shared_adapter),
            "missing narrow game-read adapter: {shared_adapter}"
        );
    }
    assert!(live_delivery.contains("game_http::current_votecount_deltas(&state.pool"));
    assert!(live_delivery.contains("game_http::load_host_console_state(&state.pool"));
    assert!(media_http.contains("use super::game_http::require_channel_thread_access;"));

    for command_owned in [
        "async fn command(",
        "async fn import_completed_game_export(",
    ] {
        assert!(command_http.contains(command_owned));
        assert!(!composition_root.contains(command_owned));
        assert!(
            !game_http.contains(command_owned),
            "write transport drifted into game HTTP: {command_owned}"
        );
    }
    for live_owned in ["async fn create_websocket_ticket(", "async fn ws_session("] {
        assert!(live_delivery.contains(live_owned));
        assert!(!composition_root.contains(live_owned));
        assert!(
            !game_http.contains(live_owned),
            "live transport drifted into game HTTP: {live_owned}"
        );
    }

    assert!(
        !game_http.contains("#[expect") && !game_http.contains("#[allow(clippy"),
        "the game HTTP boundary must not hide lint debt"
    );
}
