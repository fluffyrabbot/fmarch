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
    assert!(live_delivery.contains("websocket_heartbeat_interval"));
    assert!(live_delivery.contains("heartbeat.tick()"));
    assert!(composition_root.contains("FMARCH_WS_HEARTBEAT_INTERVAL_MS"));
    assert!(composition_root.contains("with_websocket_heartbeat_interval"));
    assert!(live_delivery.contains("live_projection::receive"));
    assert!(live_delivery.contains("live_projection::try_receive"));
    assert!(live_delivery.contains("inbound = socket.recv()"));
    assert!(live_delivery.contains("projections::LIVE_EVENT_NOTIFY_CHANNEL"));
    assert!(!live_delivery.contains("durable_poll.tick()"));
    assert!(!live_delivery.contains("PollEventWake::new(state.websocket_poll_interval)"));
    for admission_contract in [
        "validate_session_reference_for_update(",
        "pg_try_advisory_xact_lock(",
        "identity::session::WEBSOCKET_TICKET_LOCK_NAMESPACE",
        "identity::session::lock_websocket_ticket_mutation(",
        "try_acquire_owned()",
        "tx.commit().await?",
        "authority_transaction_slots",
        "timeout_at(guard.deadline()",
        "identity::session::lock_live_delivery_cutoff_gates(",
        "bounded_control_send(&mut socket, Message::Pong(payload))",
        "control_budget.admit_at(",
        "caps::resolve_live_delivery_in_tx(",
        "delivery_claim_authorized(",
        "LiveDeliveryPlan::from_capabilities(",
        "send_generation_heartbeat(",
        "send_resync_required(",
        "wire::next_live_data_envelope_id(",
    ] {
        assert!(
            live_delivery.contains(admission_contract),
            "missing transactional live-admission contract: {admission_contract}"
        );
    }

    for owned_symbol in [
        "struct CreateWebsocketTicket",
        "struct WebsocketTicketResponse",
        "struct WebsocketTicketClaim",
        "struct SessionDeliveryGuard",
        "enum GuardedSendOutcome",
        "async fn create_websocket_ticket(",
        "async fn redeem_websocket_ticket(",
        "async fn websocket_authorization_context(",
        "async fn ws(",
        "async fn ws_session(",
        "async fn current_game_event_seq(",
        "async fn thread_posts_delta_for_ws(",
        "async fn thread_posts_after_delta_for_ws(",
        "fn socket_has_host_console_interest(",
        "async fn post_citations_deltas_for_ws(",
        "async fn host_console_deltas_for_ws(",
        "async fn host_prompts_delta_for_ws(",
        "async fn player_private_deltas_for_ws(",
        "fn delivery_claim_authorized(",
        "fn live_projection_delta_for_plan(",
        "async fn send_projection_deltas(",
        "async fn send_resync_required(",
        "async fn send_prepared_generation_frames(",
        "async fn send_generation_heartbeat(",
        "async fn close_guarded_delivery(",
        "fn server_envelope_frame(",
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
    assert!(!live_delivery.contains("send_current_projection_snapshot("));
    assert!(!live_delivery.contains("current_hidden_thread_post_deltas("));
    assert!(!live_delivery.contains("full_snapshot"));
    assert!(!live_delivery.contains("ProjectionDelta::ResyncRequired"));
    assert!(!live_delivery.contains("next_envelope_id += 1"));
    assert!(live_delivery.contains("let mut batch = update.deltas;"));
    assert!(live_delivery.contains("last_envelope_id = send_deltas_or_break!(batch);"));
    assert!(live_delivery.contains("live_generation_assembly_failed"));
    assert!(!live_delivery.contains("continue;\n        };\n        if !guarded_application_send"));
    assert!(live_projection.contains("struct LiveProjectionPublisher"));
    assert!(live_projection.contains("fn assemble_update("));
    assert!(
        !live_delivery.contains("use super::*")
            && !live_delivery.contains("#[expect")
            && !live_delivery.contains("#[allow(clippy"),
        "the live delivery boundary must not hide ownership or lint debt"
    );
    assert!(live_delivery.contains("GuardedSendOutcome::Close(last_envelope_id)"));
    assert!(live_delivery.contains("live generation authority changed"));
    assert!(live_delivery.contains("if inner.strong_count() == 0"));
    assert!(live_delivery.contains("inner: &std::sync::Weak<GameEventWakeInner>"));
    assert!(!live_delivery.contains("listen_live_events(&pool, &hub)"));
    assert!(composition_root.contains("let authority_transaction_ceiling = pool_capacity - 3;"));
    assert!(composition_root.contains("authority_transaction_limit.saturating_sub(1)"));

    let delivery_guard_start = live_delivery
        .find("impl SessionDeliveryGuard")
        .expect("delivery guard implementation");
    let delivery_guard_end = live_delivery[delivery_guard_start..]
        .find("async fn websocket_authorization_context(")
        .map(|offset| delivery_guard_start + offset)
        .expect("delivery guard boundary");
    let delivery_guard = &live_delivery[delivery_guard_start..delivery_guard_end];
    let lease_deadline = delivery_guard
        .find("let lease_deadline = live_delivery_deadline(claim.access_expires_at)")
        .or_else(|| delivery_guard.find("let Some(lease_deadline) = live_delivery_deadline("))
        .expect("complete live-delivery lease deadline");
    assert!(
        lease_deadline < delivery_guard.find(".acquire_owned()").unwrap()
            && lease_deadline < delivery_guard.find("state.pool.begin()").unwrap(),
        "the complete delivery lease must start before semaphore and pool waits"
    );
    for bounded_operation in [
        "timeout_at(\n            lease_deadline,\n            state",
        "timeout_at(lease_deadline, state.pool.begin())",
        "timeout_at(deadline, self.tx.commit())",
        "timeout_at(deadline, self.tx.rollback())",
    ] {
        assert!(
            delivery_guard.contains(bounded_operation),
            "unbounded live-delivery guard operation: {bounded_operation}"
        );
    }
    assert!(
        delivery_guard
            .find("lock_live_delivery_cutoff_gates(")
            .unwrap()
            < delivery_guard
                .find("validate_session_reference_for_delivery(")
                .unwrap()
            && delivery_guard
                .find("validate_session_reference_for_delivery(")
                .unwrap()
                < delivery_guard
                    .find("caps::resolve_live_delivery_in_tx(")
                    .unwrap(),
        "delivery lock order must remain global cutoff -> owner -> session -> game projection"
    );

    let redemption_start = live_delivery
        .find("async fn redeem_websocket_ticket(")
        .unwrap();
    let redemption_end = live_delivery[redemption_start..]
        .find("struct SessionDeliveryGuard")
        .map(|offset| redemption_start + offset)
        .unwrap();
    let redemption = &live_delivery[redemption_start..redemption_end];
    assert!(
        redemption.find("try_acquire_owned()").unwrap()
            < redemption.find("let mut tx = state.pool.begin()").unwrap(),
        "per-principal admission must precede the durable redemption transaction"
    );
    assert!(
        redemption
            .find("let locked_now = unix_now_seconds();")
            .unwrap()
            < redemption
                .find("DELETE FROM auth_websocket_ticket")
                .unwrap(),
        "ticket expiry must be sampled again after the session/ticket locks"
    );

    let ticket_start = live_delivery
        .find("async fn create_websocket_ticket(")
        .unwrap();
    let ticket_end = live_delivery[ticket_start..]
        .find("async fn redeem_websocket_ticket(")
        .map(|offset| ticket_start + offset)
        .unwrap();
    let ticket = &live_delivery[ticket_start..ticket_end];
    assert!(ticket.contains("Capability::SlotOccupant(held) if held == slot_id"));
    assert!(
        !ticket.contains("capabilities.grants(&Capability::SlotOccupant"),
        "global or host authority must not mint a player-slot claim"
    );
}

#[test]
fn identity_cutoff_routes_use_the_cutoff_safe_transaction_constructor() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let auth_http = std::fs::read_to_string(source_root.join("auth_http.rs")).unwrap();

    for function in [
        "async fn disable_account_method(",
        "async fn rotate_auth_account_password(",
        "async fn recover_auth_account(",
        "async fn disable_auth_account(",
        "async fn logout_auth_session(",
        "async fn revoke_auth_session(",
        "async fn retire_workos_signing_key(",
    ] {
        let start = auth_http
            .find(function)
            .unwrap_or_else(|| panic!("missing identity cutoff route: {function}"));
        let remainder = &auth_http[start + function.len()..];
        let end = remainder.find("\nasync fn ").unwrap_or(remainder.len());
        let body = &remainder[..end];
        assert!(
            body.contains("identity::session::begin_authority_transaction(&state.pool)"),
            "identity cutoff route bypasses its lock-wait budget: {function}"
        );
        assert!(
            !body.contains("state.pool.begin()"),
            "identity cutoff route inherited the general pool lock timeout: {function}"
        );
    }
}
