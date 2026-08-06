//! Upcaster seam (doc 02).
//!
//! A small pipeline sits between the raw store row and the domain: raw row →
//! version upcast → current typed event. Old events are forever valid; replay
//! code must handle every version ever written, so upcasters are kept
//! indefinitely (doc 02 schema-evolution rules).
//!
//! Every loaded row passes through [`upcast`]; that is the contract. Register
//! `(kind, version)` branches here when a payload shape is superseded — domain
//! fold code only ever sees the current shape. The synthetic `UpcastExample`
//! 1→2 mapping is the registry proof (doc 10).

use crate::StoredEvent;

/// Upcast a single stored event to the current in-memory shape.
///
/// Branch on `(ev.kind.as_str(), ev.version)` and rewrite `ev.payload` /
/// `ev.version` to the current shape before returning. Unknown pairs are
/// identity.
pub fn upcast(ev: StoredEvent) -> StoredEvent {
    match (ev.kind.as_str(), ev.version) {
        // Synthetic kind used only to exercise the registry. v1 payloads may
        // omit `note`; v2 always carries it (empty string when missing).
        ("UpcastExample", 1) => {
            let mut ev = ev;
            if let Some(obj) = ev.payload.as_object_mut() {
                if !obj.contains_key("note") {
                    obj.insert("note".into(), serde_json::json!(""));
                }
            }
            ev.version = 2;
            ev
        }
        _ => ev,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ActorId;
    use serde_json::json;
    use uuid::Uuid;

    fn sample(kind: &str, version: i16, payload: serde_json::Value) -> StoredEvent {
        StoredEvent {
            seq: 1,
            stream_id: Uuid::nil(),
            stream_seq: 1,
            kind: kind.into(),
            version,
            payload,
            actor: ActorId::System,
            occurred_at: 0,
            causation_id: None,
            meta: json!({}),
        }
    }

    #[test]
    fn upcast_example_v1_missing_note_gets_empty_note_and_version_2() {
        let input = sample("UpcastExample", 1, json!({ "label": "x" }));
        let out = upcast(input);
        assert_eq!(out.kind, "UpcastExample");
        assert_eq!(out.version, 2);
        assert_eq!(out.payload, json!({ "label": "x", "note": "" }));
    }

    #[test]
    fn upcast_example_v1_with_note_preserves_note_and_sets_version_2() {
        let input = sample("UpcastExample", 1, json!({ "note": "kept" }));
        let out = upcast(input);
        assert_eq!(out.version, 2);
        assert_eq!(out.payload, json!({ "note": "kept" }));
    }

    #[test]
    fn other_kind_is_identity() {
        let input = sample("VoteSubmitted", 1, json!({ "slot": "A", "target": "B" }));
        let expected = input.clone();
        let out = upcast(input);
        assert_eq!(out, expected);
    }

    #[test]
    fn upcast_example_v2_is_identity() {
        let input = sample("UpcastExample", 2, json!({ "note": "already" }));
        let expected = input.clone();
        let out = upcast(input);
        assert_eq!(out, expected);
    }
}
