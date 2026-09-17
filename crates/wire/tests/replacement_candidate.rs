use serde_json::json;
use uuid::Uuid;
use wire::HostReplacementCandidate;

#[test]
fn replacement_candidate_wire_requires_exact_identity_fields() {
    let value = json!({
        "slot_id":"slot-7", "outgoing_persona_id":Uuid::new_v4(),
        "principal_id":wire::fixture_principal_id("rowan"), "handle":"rowan", "display_name":"Rowan",
    });
    let candidate: HostReplacementCandidate = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(candidate).unwrap(), value);
    for field in [
        "slot_id",
        "outgoing_persona_id",
        "principal_id",
        "handle",
        "display_name",
    ] {
        let mut missing = value.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(
            serde_json::from_value::<HostReplacementCandidate>(missing).is_err(),
            "{field}"
        );
        let mut null = value.clone();
        null[field] = serde_json::Value::Null;
        assert!(
            serde_json::from_value::<HostReplacementCandidate>(null).is_err(),
            "{field}"
        );
    }
    let mut extra = value.clone();
    extra["email"] = json!("private@example.test");
    assert!(serde_json::from_value::<HostReplacementCandidate>(extra).is_err());
    for field in ["principal_id", "outgoing_persona_id"] {
        let mut alias = value.clone();
        alias[field] = json!("rowan");
        assert!(serde_json::from_value::<HostReplacementCandidate>(alias).is_err());
    }
}
