use super::*;
use serde_json::json;

fn applied_payload(version: u16) -> Value {
    json!({
        "phase_id":"D01", "run_id":"resolution:test:D01:1", "result_version":version,
        "seed":7, "counts":{"events":1,"kills":0,"saves":0},
        "events":[{
            "index":0, "kind":"PhaseAnnouncement",
            "payload":{"phase_id":"D01","deaths":[]}
        }],
        "started_at":1,"finished_at":1
    })
}

fn trace_payload() -> Value {
    json!({
        "phase_id":"D01", "run_id":"resolution:test:D01:1", "trace_version":domain::TRACE_VERSION,
        "edges":[], "generated":[], "effect_changes":[], "visibility":[], "decisions":[], "notes":[]
    })
}

fn stored(kind: &str, version: i16, payload: Value) -> StoredEvent {
    StoredEvent {
        seq: 11,
        stream_id: Uuid::nil(),
        stream_seq: 3,
        kind: kind.into(),
        version,
        payload,
        actor: ActorId::System.into(),
        occurred_at: 42,
        causation_id: None,
        meta: json!({}),
    }
}

#[test]
fn retained_resolver_versions_normalize_through_the_game_codec() {
    let current = current_result_header().unwrap();
    for version in [19, 20, domain::RESULT_VERSION] {
        for header in [1, i16::try_from(version).unwrap()] {
            let source = stored("ResolutionApplied", header, applied_payload(version));
            let normalized = normalize(source).unwrap();
            assert_eq!(normalized.version, current);
            assert_eq!(normalized.payload["result_version"], domain::RESULT_VERSION);
            assert_eq!(normalized.seq, 11);
            assert_eq!(normalized.stream_seq, 3);
            let repeated = normalize(normalized.clone()).unwrap();
            assert_eq!(repeated.payload, normalized.payload);
            assert_eq!(repeated.version, normalized.version);
            assert_eq!(
                decode_applied(&repeated).unwrap().result_version,
                domain::RESULT_VERSION
            );
        }
    }
}

#[test]
fn resolver_headers_and_payloads_fail_closed() {
    let current = applied_payload(domain::RESULT_VERSION);
    for header in [-1, 0, 2, 19, i16::MAX] {
        assert!(ResolverCodec::decode("ResolutionApplied", header, &current).is_err());
    }
    for version in [0, 1, 18, domain::RESULT_VERSION + 1] {
        assert!(ResolverCodec::decode("ResolutionApplied", 1, &applied_payload(version)).is_err());
    }
    for payload in [
        json!({}),
        json!({"result_version":"21"}),
        json!({"result_version":domain::RESULT_VERSION}),
    ] {
        assert!(ResolverCodec::decode("ResolutionApplied", 1, &payload).is_err());
    }
    let mut unknown_field = current.clone();
    unknown_field["unexpected"] = json!(true);
    assert!(ResolverCodec::decode(
        "ResolutionApplied",
        current_result_header().unwrap(),
        &unknown_field
    )
    .is_err());
    assert!(ResolverCodec::decode("UnknownResolverEvent", 1, &current).is_err());
    let mut actor = stored("ResolutionApplied", 1, current);
    actor.actor = json!({"type":"Unknown"});
    assert!(normalize(actor).is_err());
}

#[test]
fn typed_resolver_writes_validate_both_contract_and_actor() {
    let applied = decode_applied_payload(1, &applied_payload(domain::RESULT_VERSION)).unwrap();
    let encoded = resolution_applied(&applied, ActorId::System, 42).unwrap();
    assert_eq!(encoded.version, current_result_header().unwrap());
    assert_eq!(encoded.payload, applied_payload(domain::RESULT_VERSION));
    assert!(resolution_applied(&applied, json!({"type":"Unknown"}), 42).is_err());
    let trace = domain::validate_trace_json(&trace_payload(), domain::TRACE_VERSION).unwrap();
    let encoded = resolution_trace(&trace, ActorId::System, 42).unwrap();
    assert_eq!(encoded.version, current_trace_header().unwrap());
    assert_eq!(encoded.payload, trace_payload());
    assert!(ResolverCodec::decode("ResolutionTrace", 2, &trace_payload()).is_err());
    assert!(ResolverCodec::decode("ResolutionTrace", 1, &json!({})).is_err());
    let mut invalid = trace;
    invalid.trace_version = domain::TRACE_VERSION + 1;
    assert!(resolution_trace(&invalid, ActorId::System, 42).is_err());
}

#[test]
fn unrelated_game_events_remain_explicitly_outside_the_resolver_codec() {
    let source = stored("GameCreated", 99, json!({"untyped":"retained"}));
    let normalized = normalize(source.clone()).unwrap();
    assert_eq!(normalized.kind, source.kind);
    assert_eq!(normalized.version, source.version);
    assert_eq!(normalized.payload, source.payload);
    assert!(ResolverCodec::decode(&source.kind, source.version, &source.payload).is_err());
}
