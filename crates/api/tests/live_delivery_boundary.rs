use std::path::PathBuf;

#[test]
fn live_delivery_has_one_typed_owner_without_composition_root_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let live_delivery = std::fs::read_to_string(source_root.join("live_delivery.rs")).unwrap();
    let live_projection = std::fs::read_to_string(source_root.join("live_projection.rs")).unwrap();

    assert!(composition_root.contains("mod live_delivery;"));
    assert!(composition_root.contains("let live_delivery_routes = live_delivery::routes(&state);"));
    assert!(composition_root.contains(".merge(live_delivery_routes)"));
    assert!(composition_root.contains("pub use live_delivery::WebsocketTicketResponse;"));
    assert!(live_delivery.contains("struct LiveDeliveryState"));
    assert!(live_delivery.contains("fn routes(state: &ApiState) -> Router<ApiState>"));
    assert!(live_delivery.contains(".with_state(LiveDeliveryState::new(state))"));
    assert!(live_delivery.contains("trait EventWake"));
    assert!(live_delivery.contains("struct PollEventWake"));
    assert!(live_delivery.contains("struct NotifyEventWake"));
    assert!(live_delivery.contains("struct GameEventWakeHub"));
    assert!(live_delivery.contains("event_wake.wait()"));
    assert!(live_delivery.contains("live_projection::receive"));
    assert!(live_delivery.contains("live_projection::try_receive"));
    assert!(live_delivery.contains("projections::LIVE_EVENT_NOTIFY_CHANNEL"));
    assert!(!live_delivery.contains("durable_poll.tick()"));
    assert!(!live_delivery.contains("PollEventWake::new(state.websocket_poll_interval)"));

    for owned_symbol in [
        "struct CreateWebsocketTicket",
        "struct WebsocketTicketResponse",
        "struct WebsocketTicketClaim",
        "async fn create_websocket_ticket(",
        "async fn redeem_websocket_ticket(",
        "async fn websocket_session_active(",
        "async fn websocket_authorization_context(",
        "async fn ws(",
        "async fn ws_session(",
        "async fn current_game_event_seq(",
        "async fn current_hidden_thread_post_deltas(",
        "async fn send_current_projection_snapshot(",
        "async fn thread_posts_delta_for_ws(",
        "async fn thread_posts_after_delta_for_ws(",
        "async fn socket_has_host_console_interest(",
        "async fn post_citations_deltas_for_ws(",
        "async fn host_console_deltas_for_ws(",
        "async fn host_prompts_delta_for_ws(",
        "async fn player_private_deltas_for_ws(",
        "async fn send_projection_deltas(",
        "fn server_envelope_frame(",
        "async fn hello_for(",
    ] {
        assert!(
            live_delivery.contains(owned_symbol),
            "missing live delivery owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns live delivery symbol: {owned_symbol}"
        );
    }

    for shared_adapter in [
        "game_http::current_votecount_deltas(&state.pool",
        "game_http::current_thread_posts_delta(&state.pool",
        "game_http::current_thread_posts_after_delta(",
        "game_http::current_post_citations_deltas(",
        "game_http::require_channel_thread_access(",
        "game_http::resolve_host_console_authority(",
        "game_http::load_host_console_state(",
        "game_http::require_host_audit_access(",
        "game_http::player_notifications_for_principal(&state.pool",
        "game_http::player_investigation_results_for_principal(&state.pool",
    ] {
        assert!(
            live_delivery.contains(shared_adapter),
            "missing narrow game-read adapter consumption: {shared_adapter}"
        );
    }

    assert!(!live_delivery.contains("fn publish("));
    assert!(!live_delivery.contains("fn assemble_update("));
    assert!(live_projection.contains("struct LiveProjectionPublisher"));
    assert!(live_projection.contains("fn assemble_update("));
    assert!(
        !live_delivery.contains("use super::*")
            && !live_delivery.contains("#[expect")
            && !live_delivery.contains("#[allow(clippy"),
        "the live delivery boundary must not hide ownership or lint debt"
    );
}
