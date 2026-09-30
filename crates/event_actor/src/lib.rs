//! Context actor values and their sealed journal representation. The journal
//! transports the encoded value without importing identity or game concepts.
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

/// Existing contexts distinguish credential authority from pseudonymous
/// privacy subjects and game-local authors. No variant can substitute for one
/// of the others during context admission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "id", deny_unknown_fields)]
pub enum ActorId {
    Slot(String),
    Host,
    System,
    Principal(PrincipalId),
    PrivacySubject(Uuid),
}

impl ActorId {
    pub fn decode(encoded: &Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(encoded.clone())
    }
}

impl From<ActorId> for Value {
    fn from(actor: ActorId) -> Self {
        match actor {
            ActorId::Slot(slot) => json!({"type":"Slot","id":slot}),
            ActorId::Host => json!({"type":"Host"}),
            ActorId::System => json!({"type":"System"}),
            ActorId::Principal(principal) => {
                json!({"type":"Principal","id":principal.as_uuid().to_string()})
            }
            ActorId::PrivacySubject(subject) => {
                json!({"type":"PrivacySubject","id":subject.to_string()})
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_encoding_preserves_distinct_authorities() {
        for actor in [
            ActorId::Slot("slot_1".to_string()),
            ActorId::Host,
            ActorId::System,
            ActorId::Principal(PrincipalId::from_uuid(Uuid::from_u128(1))),
            ActorId::PrivacySubject(Uuid::from_u128(1)),
        ] {
            let encoded: Value = actor.clone().into();
            assert_eq!(encoded, serde_json::to_value(&actor).unwrap());
            assert_eq!(ActorId::decode(&encoded).unwrap(), actor);
        }
        assert_ne!(
            Value::from(ActorId::Principal(PrincipalId::from_uuid(Uuid::from_u128(
                1
            )))),
            Value::from(ActorId::PrivacySubject(Uuid::from_u128(1)))
        );
    }

    #[test]
    fn malformed_or_unknown_actors_are_rejected() {
        for actor in [
            json!({"type":"User","id":"someone"}),
            json!({"type":"Principal","id":"not-a-uuid"}),
            json!({"type":"Principal"}),
            json!({"type":"Host","unexpected":true}),
            Value::Null,
        ] {
            assert!(ActorId::decode(&actor).is_err());
        }
    }
}
