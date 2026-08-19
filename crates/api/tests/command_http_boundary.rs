use std::path::PathBuf;

#[test]
fn command_http_has_one_typed_owner_without_decision_or_publication_drift() {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let source_root = crate_root.join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let command_http = std::fs::read_to_string(source_root.join("command_http.rs")).unwrap();
    let game_http = std::fs::read_to_string(source_root.join("game_http.rs")).unwrap();
    let live_delivery = std::fs::read_to_string(source_root.join("live_delivery.rs")).unwrap();
    let live_projection = std::fs::read_to_string(source_root.join("live_projection.rs")).unwrap();
    let commands = std::fs::read_to_string(crate_root.join("../commands/src/lib.rs")).unwrap();

    assert!(composition_root.contains("mod command_http;"));
    assert!(composition_root.contains("let command_routes = command_http::routes(&state);"));
    assert!(composition_root.contains(".merge(command_routes)"));
    assert!(command_http.contains("struct CommandHttpState"));
    assert!(command_http.contains("fn routes(state: &ApiState) -> Router<ApiState>"));
    assert!(command_http.contains(".with_state(CommandHttpState::new(state))"));
    assert!(command_http.contains("State<CommandHttpState>"));
    assert!(!command_http.contains("State<ApiState>"));

    for route in [
        ".route(\"/commands\", post(command))",
        ".route(\"/games/import\", post(import_completed_game_export))",
    ] {
        assert!(
            command_http.contains(route),
            "missing command route: {route}"
        );
        assert!(
            !composition_root.contains(route),
            "composition root still owns command route: {route}"
        );
    }

    for owned_symbol in [
        "enum PostMediaPreparationError",
        "async fn prepare_wire_command(",
        "async fn prepare_command_media(",
        "async fn prepare_command_embed(",
        "async fn command(",
        "fn command_api_error_response(",
        "async fn import_completed_game_export(",
        "async fn authenticated_transport_principal(",
        "fn command_game(",
        "fn command_affects_host_console(",
        "fn command_affects_thread(",
        "fn command_affects_host_prompts(",
        "fn command_affects_player_private(",
        "fn command_affects_player_command_state(",
        "fn command_affects_votecount(",
        "fn protocol_reject(",
        "pub(super) fn command_reject_api_error(",
    ] {
        assert!(
            command_http.contains(owned_symbol),
            "missing command HTTP owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns command HTTP symbol: {owned_symbol}"
        );
    }

    for contract in [
        "commands::handle_idempotent(",
        "program_library::load_checked_in_program_library()",
        ".lookup_variant_set(",
        "crate::embed_http::resolve_youtube_snapshot(",
        "require_global_admin(&state.auth, token, \"game creation\")",
        "require_global_admin(&state.auth, token, \"completed-game import\")",
        "LiveProjectionChangeSet {",
        ".live_projection",
        ".publish(",
    ] {
        assert!(
            command_http.contains(contract),
            "missing preserved command boundary contract: {contract}"
        );
    }

    assert!(commands.contains("pub async fn handle_idempotent("));
    assert!(live_projection.contains("struct LiveProjectionPublisher"));
    assert!(live_projection.contains("fn assemble_update("));
    assert!(game_http.contains("use super::command_http::command_reject_api_error;"));
    assert!(!game_http.contains("async fn command("));
    assert!(!live_delivery.contains("async fn command("));

    assert!(
        !command_http.contains("sqlx::query")
            && !command_http.contains("use super::*")
            && !command_http.contains("#[expect")
            && !command_http.contains("#[allow(clippy"),
        "the command HTTP boundary must not own persistence or hide ownership/lint debt"
    );
}
