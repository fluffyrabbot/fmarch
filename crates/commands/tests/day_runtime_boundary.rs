use std::path::PathBuf;

#[test]
fn day_event_resolution_application_has_one_immutable_request_boundary() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/day_runtime.rs");
    let source = std::fs::read_to_string(source_path).unwrap();

    for request_contract in [
        "struct DayEventResolutionRequest {",
        "game: Uuid",
        "event: projections::DayEventRow",
        "decision: game_platform::DayEventDecision",
        "winner_slots: Vec<game_platform::SlotId>",
        "participant_slots: Vec<game_platform::SlotId>",
        "evidence: game_platform::DayEventResolutionEvidence",
        "actor: ActorId",
    ] {
        assert!(
            source.contains(request_contract),
            "missing DayEvent resolution request contract: {request_contract}"
        );
    }
    assert!(!source.contains("pub struct DayEventResolutionRequest"));

    let host_start = source
        .find("pub(crate) async fn resolve_day_event(")
        .expect("host DayEvent resolution caller");
    let auto_start = source[host_start..]
        .find("async fn resolve_auto_day_event_in_tx(")
        .map(|offset| host_start + offset)
        .expect("automatic DayEvent resolution caller");
    let apply_start = source[auto_start..]
        .find("async fn apply_day_event_resolution_in_tx(")
        .map(|offset| auto_start + offset)
        .expect("DayEvent resolution application boundary");
    let boundary_end = source[apply_start..]
        .find("fn fresh_auto_seed_root(")
        .map(|offset| apply_start + offset)
        .expect("DayEvent resolution boundary end");

    let host = &source[host_start..auto_start];
    for host_contract in [
        "require_day_event_state(&event, \"locked\")?",
        "automatic DayEvents cannot be host-resolved; cancel and use fiat instead",
        "SelectMapping requires the multi-reward decision slice",
        "use CancelDayEvent instead of resolving with cancellation",
        "SelectWinners requires a non-empty unique slot list",
        "every selected winner must be a current participant",
        "let evidence = game_platform::DayEventResolutionEvidence::HostDecision {",
        "let request = DayEventResolutionRequest {",
        "participant_slots: participant_slot_ids",
        "actor: ActorId::Host",
        "apply_day_event_resolution_in_tx(tx, request).await",
    ] {
        assert!(
            host.contains(host_contract),
            "host resolution lost contract: {host_contract}"
        );
    }
    assert!(!host.contains("let mut request"));

    let automatic = &source[auto_start..apply_start];
    for automatic_contract in [
        "return Err(day_event_reject(\"DayEvent is not automatic\"))",
        "participant_slots.sort()",
        "game_platform::day_auto_resolution::select_winners(",
        "event.auto_seed",
        "let evidence = game_platform::DayEventResolutionEvidence::Auto {",
        "seed: event.auto_seed.map(game_platform::DayEventAuditSeed::new)",
        "let request = DayEventResolutionRequest {",
        "actor: ActorId::System",
        "apply_day_event_resolution_in_tx(tx, request).await",
    ] {
        assert!(
            automatic.contains(automatic_contract),
            "automatic resolution lost contract: {automatic_contract}"
        );
    }
    assert!(!automatic.contains("let mut request"));

    let application = &source[apply_start..boundary_end];
    assert!(application.starts_with(
        "async fn apply_day_event_resolution_in_tx(\n    tx: &mut Transaction<'_, Postgres>,\n    request: DayEventResolutionRequest,\n)"
    ));
    assert!(application.contains("let DayEventResolutionRequest {"));
    assert!(application.contains("} = request;"));

    let ordered_contracts = [
        "COMMAND_AUDIT_CONTEXT",
        "let bindings = game_platform::RecipientBindings {",
        "for reward in &event.definition.rewards",
        ".compile_plan(",
        "let application = EffectApplication::DayEvent {",
        "plan_effect_events(",
        "\"DayEventResolved\"",
        "resolved.meta = serde_json::json!({",
        "events.push(resolved)",
        "persist(tx, game, &events).await",
    ];
    let mut previous = 0;
    for (index, contract) in ordered_contracts.into_iter().enumerate() {
        let position = application
            .find(contract)
            .unwrap_or_else(|| panic!("resolution application lost contract: {contract}"));
        if index > 0 {
            assert!(
                position > previous,
                "resolution application ordering changed at {contract}"
            );
        }
        previous = position;
    }

    assert_eq!(
        source
            .matches("let request = DayEventResolutionRequest {")
            .count(),
        2,
        "host and automatic callers must construct the request directly"
    );
    assert!(!source.contains("#[allow(clippy::too_many_arguments)]"));
    assert!(!source.contains("#[expect(clippy::too_many_arguments"));
}
