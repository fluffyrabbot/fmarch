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
        "struct CommandAdmission",
        "struct CommandAuthorityConnection",
        "struct AuthorizedCommandCommit",
        "enum AuthorizedCommandExecuteError",
        "async fn command(",
        "fn command_api_error_response(",
        "fn command_authority_lease_expired_response(",
        "fn command_commit_outcome_unknown_response(",
        "async fn import_completed_game_export(",
        "async fn authenticated_transport_authorization(",
        "struct CommandClassification",
        "struct DirtySurfaces",
        "fn classify_command(",
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
        "commands::handle_idempotent_in_tx(",
        "commands::try_lock_command_stream_in_tx(",
        "commands::set_command_lock_timeout_in_tx(",
        "commands::command_identity_targets(",
        "commands::CommandIdentityTargetPolicy::Active",
        "identity::methods::IdentityMutationExtent::Owner",
        "identity::session::validate_session_for_update(",
        "program_library::load_checked_in_program_library()",
        ".lookup_variant_set(",
        "crate::embed_http::resolve_youtube_snapshot(",
        "require_global_admin_context(&authorization, \"game creation\")",
        "require_global_admin(&state.auth, &request.bearer, \"completed-game import\")",
        "command authority lease expired before commit; retry the exact same command_id",
        "command commit outcome is unknown; retry the exact same command_id",
        "connection.close_on_drop();",
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
    assert!(commands.contains("pub async fn handle_idempotent_in_tx("));
    assert!(commands.contains("pub async fn lock_command_stream_in_tx("));
    assert!(commands.contains("pub async fn try_lock_command_stream_in_tx("));
    assert!(commands.contains("pub fn command_identity_targets("));
    let stream_lock = command_http
        .find("commands::try_lock_command_stream_in_tx(")
        .unwrap();
    let identity_lock = command_http
        .find("identity::methods::lock_identity_mutation(")
        .unwrap();
    let session_fence = command_http
        .find("identity::session::validate_session_for_update(")
        .unwrap();
    let persistence = command_http
        .find("commands::handle_idempotent_in_tx(")
        .unwrap();
    let authority_deadline = command_http
        .find("let deadline = Instant::now() + COMMAND_AUTHORITY_LEASE_TIMEOUT;")
        .unwrap();
    let pool_checkout = command_http.find("self.state.pool.acquire()").unwrap();
    let authorized_operation = command_http
        .find("let operation = apply_authorized_command_in_tx(")
        .unwrap();
    let commit = command_http.find("tx.commit()").unwrap();
    assert!(
        stream_lock < identity_lock && identity_lock < session_fence && session_fence < persistence
    );
    assert!(
        authority_deadline < pool_checkout
            && pool_checkout < authorized_operation
            && authorized_operation < commit,
        "one deadline must cover pool checkout, every durable authority lock, persistence, and commit"
    );
    assert!(command_http.contains(
        "COMMAND_AUTHORITY_LEASE_TIMEOUT.as_millis() + COMMAND_AUTHORITY_CLEANUP_TIMEOUT.as_millis()"
    ));
    assert!(command_http.contains("< identity::session::AUTHORITY_CUTOFF_LOCK_TIMEOUT.as_millis()"));
    assert!(command_http.contains(".close(command_id, \"authority_lease_expired\")"));
    let expired_transaction_drop = command_http.find("drop(tx);").unwrap();
    let expired_connection_close = command_http
        .find(".close(command_id, \"authority_lease_expired\")")
        .unwrap();
    assert!(
        expired_transaction_drop < expired_connection_close,
        "lease expiry must drop the borrowing transaction before closing its owned connection"
    );
    assert!(
        !command_http.contains("set_command_lock_timeout_in_tx(&mut tx, None)"),
        "command persistence must not restore an unbounded database lock wait"
    );
    assert!(command_http.contains("authority_transaction_slots"));
    assert!(live_projection.contains("struct LiveProjectionPublisher"));
    assert!(live_projection.contains("fn assemble_update("));
    assert!(
        !command_http.contains("fn command_game(") && !command_http.contains("command_affects_"),
        "wire command classification must stay in the single classify_command table"
    );
    assert!(
        !live_projection.contains("inflight_guard(None")
            && !live_projection.contains("game: Option<Uuid>"),
        "every wire command carries a game; the inflight guard must not regress to Option"
    );
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
