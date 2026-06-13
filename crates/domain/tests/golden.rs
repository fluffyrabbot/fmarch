//! Golden scenario harness. Loads the mafiascum pack + each golden, runs
//! `resolve`, and asserts the produced inner events equal `expected_events`
//! semantically: the event *sequence* is order-sensitive, but field order
//! within each payload is irrelevant (compared as `serde_json::Value`).
//!
//! Hermetic: repo files are located relative to `CARGO_MANIFEST_DIR`.

use std::path::PathBuf;

use domain::pack::Pack;
use domain::resolver::{resolve, ResolutionInput};
use domain::state::{StateSnapshot, Submission};
use serde::Deserialize;
use serde_json::Value;

fn repo_root() -> PathBuf {
    // crates/domain -> repo root is two parents up.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn load_pack() -> Pack {
    let p = repo_root().join("packs/mafiascum/pack.json");
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("deserialize pack.json: {e}"))
}

fn load_golden(name: &str) -> Value {
    let p = repo_root().join("packs/mafiascum/golden").join(name);
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("deserialize {name}: {e}"))
}

/// The `input` block of a golden, minus `pack` (a name string the harness
/// resolves itself) and `game_id`.
#[derive(Deserialize)]
struct GoldenInput {
    phase_id: String,
    state: StateSnapshot,
    submissions: Vec<Submission>,
    seed: u64,
    #[serde(default)]
    game_id: String,
}

/// Run a golden's input against the pack and return the produced inner events as
/// indexed `{ index, kind, payload }` JSON values, matching the goldens' shape.
fn run(input_json: &Value, pack: Pack) -> Vec<Value> {
    let gi: GoldenInput =
        serde_json::from_value(input_json.clone()).expect("deserialize golden input");
    let ri = ResolutionInput {
        game_id: gi.game_id,
        phase_id: gi.phase_id,
        state: gi.state,
        submissions: gi.submissions,
        pack,
        seed: gi.seed,
    };
    let events = resolve(ri);
    events
        .into_iter()
        .enumerate()
        .map(|(i, ev)| {
            let mut v = serde_json::to_value(&ev).expect("serialize event");
            v.as_object_mut()
                .unwrap()
                .insert("index".to_string(), Value::from(i));
            v
        })
        .collect()
}

/// `DayVoteOutcome.reason` is optional, non-canonical human-readable prose (doc
/// 10): the platform may rewrite/localize it, so it is NOT part of the asserted
/// contract. Strip it before comparison so equality ignores it.
fn strip_noncanonical(v: &Value) -> Value {
    let mut v = v.clone();
    if v.get("kind").and_then(Value::as_str) == Some("DayVoteOutcome") {
        if let Some(payload) = v.get_mut("payload").and_then(Value::as_object_mut) {
            payload.remove("reason");
        }
    }
    v
}

/// Assert two event sequences are equal: order-sensitive across events,
/// field-order-insensitive within each (serde_json::Value equality already
/// ignores object key order). `DayVoteOutcome.reason` is ignored (non-canonical).
fn assert_events_eq(got: &[Value], expected: &[Value], scenario: &str) {
    assert_eq!(
        got.len(),
        expected.len(),
        "{scenario}: event count mismatch\n got: {got:#?}\n exp: {expected:#?}"
    );
    for (i, (g, e)) in got.iter().zip(expected.iter()).enumerate() {
        let g = strip_noncanonical(g);
        let e = strip_noncanonical(e);
        assert_eq!(
            g, e,
            "{scenario}: event[{i}] mismatch\n got: {g:#?}\n exp: {e:#?}"
        );
    }
}

fn expected_events(golden: &Value) -> Vec<Value> {
    golden["expected_events"]
        .as_array()
        .expect("expected_events array")
        .clone()
}

#[test]
fn pack_deserializes() {
    let pack = load_pack();
    assert_eq!(pack.name, "mafiascum");
    assert_eq!(pack.ir_version, 1);
    assert!(pack.roles.contains_key("cop"));
    // Round-trip: investigation_overrides with an enum map key must survive.
    let v = serde_json::to_value(&pack).expect("serialize pack");
    assert_eq!(
        v["investigation_overrides"]["godfather"]["Parity"],
        Value::from("town")
    );
}

#[test]
fn golden_kill_vs_doctor_base() {
    let golden = load_golden("kill_vs_doctor.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "kill_vs_doctor base");
}

#[test]
fn golden_kill_vs_doctor_strongman_variant() {
    // Swap slot_1's role to `strongman` so factional_kill carries Strongman;
    // protect_beats_kill fires its unless_modifiers and the kill goes through.
    let golden = load_golden("kill_vs_doctor.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_1" {
            slot["role_key"] = Value::from("strongman");
        }
    }
    let got = run(&input, load_pack());
    let expected = golden["variant_note"]["expected_events"]
        .as_array()
        .expect("variant expected_events")
        .clone();
    assert_events_eq(&got, &expected, "kill_vs_doctor strongman variant");
}

#[test]
fn golden_busdriver_redirect() {
    let golden = load_golden("busdriver_redirect.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "busdriver_redirect");
}

#[test]
fn golden_roleblock_stops_action() {
    let golden = load_golden("roleblock_stops_action.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "roleblock_stops_action");
}

#[test]
fn golden_day_vote_tiebreak() {
    let golden = load_golden("day_vote_tiebreak.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_vote_tiebreak");
}

#[test]
fn resolve_is_deterministic() {
    // Same input twice -> byte-identical event JSON.
    let golden = load_golden("day_vote_tiebreak.json");
    let a = run(&golden["input"], load_pack());
    let b = run(&golden["input"], load_pack());
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}
