//! Forum-owned encoding and integration contracts over the neutral journal.

use event_actor::ActorId;
use eventstore::journal::{
    EventCodec, EventEncoding, IntegrationCodec, IntegrationFact, LoadedEvent,
};
use forum::DecodedForumEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct ForumCodec;

impl EventCodec for ForumCodec {
    const CONTEXT: &'static str = "forum";
    type Event = DecodedForumEvent;
    type Actor = ActorId;
    type Error = forum::ForumDecodeError;

    fn encode(event: &Self::Event) -> Result<EventEncoding, Self::Error> {
        let payload = event.payload();
        forum::decode_event(event.kind(), 1, &payload)?;
        Ok(EventEncoding::new(event.kind(), 1, payload))
    }

    fn decode(kind: &str, version: i16, payload: &Value) -> Result<Self::Event, Self::Error> {
        forum::decode_event(kind, version, payload)
    }

    fn integration_facts(event: &Self::Event) -> Result<Vec<IntegrationFact>, Self::Error> {
        let effect = match event {
            DecodedForumEvent::PostSubmitted { .. } => PublicationEffect::Published,
            DecodedForumEvent::PostEdited { .. } => PublicationEffect::Edited,
            DecodedForumEvent::PostRetracted { .. } => PublicationEffect::Retracted,
            DecodedForumEvent::VisibilityChanged { .. } => PublicationEffect::VisibilityChanged,
            _ => return Ok(Vec::new()),
        };
        // Consumers use the journal source position to fetch authorized source
        // state. This contract carries no private event body or author data.
        Ok(vec![IntegrationFact::new(
            ForumIntegrationCodec::CONTEXT,
            "ForumPublicationChanged",
            1,
            serde_json::json!({ "effect": effect }),
        )])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationEffect {
    Published,
    Edited,
    Retracted,
    VisibilityChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicationChanged {
    pub effect: PublicationEffect,
}

#[derive(Debug, thiserror::Error)]
pub enum IntegrationDecodeError {
    #[error("unsupported forum integration event {kind} version {version}")]
    Unsupported { kind: String, version: i16 },
    #[error(transparent)]
    Payload(#[from] serde_json::Error),
}

pub struct ForumIntegrationCodec;
impl IntegrationCodec for ForumIntegrationCodec {
    const CONTEXT: &'static str = "forum.publication";
    type Fact = PublicationChanged;
    type Error = IntegrationDecodeError;
    fn decode(kind: &str, version: i16, payload: &Value) -> Result<Self::Fact, Self::Error> {
        if kind != "ForumPublicationChanged" || version != 1 {
            return Err(IntegrationDecodeError::Unsupported {
                kind: kind.into(),
                version,
            });
        }
        Ok(serde_json::from_value(payload.clone())?)
    }
}

pub fn replay_record(event: LoadedEvent<ForumCodec>) -> forum::ForumEventRecord {
    forum::ForumEventRecord {
        source_seq: event.seq,
        stream_seq: event.stream_seq.get(),
        occurred_at: event.occurred_at,
        event: event.event,
    }
}

/// Projector input preserves the journal-assigned positions and sealed metadata.
pub fn projection_record(event: &LoadedEvent<ForumCodec>) -> eventstore::StoredEvent {
    eventstore::StoredEvent {
        seq: event.seq,
        stream_id: event.stream_id.as_uuid(),
        stream_seq: event.stream_seq.get(),
        kind: event.event.kind().into(),
        version: 1,
        payload: event.event.payload(),
        actor: event.actor.clone().into(),
        occurred_at: event.occurred_at,
        causation_id: event.causation_id,
        meta: event.meta.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_forum_variant_round_trips_through_its_owned_encoding() {
        let area = "00000000-0000-0000-0000-000000000001";
        let cases = [
            (
                forum::AREA_CREATED,
                json!({"slug":"general","title":"General","description":"Discussion"}),
            ),
            (
                forum::TOPIC_CREATED,
                json!({"area_id":area,"title":"Topic"}),
            ),
            (
                forum::POST_SUBMITTED,
                json!({"body":"Hello","quotations":[],"mentions":[]}),
            ),
            (
                forum::POST_EDITED,
                json!({"source_seq":1,"body":"Edited","mentions":[],"revision":1}),
            ),
            (forum::POST_RETRACTED, json!({"source_seq":1})),
            (
                forum::POSTING_STATE_CHANGED,
                json!({"posting_state":"locked"}),
            ),
            (forum::VISIBILITY_CHANGED, json!({"visibility":"hidden"})),
            (forum::TOPIC_RENAMED, json!({"title":"New title"})),
            (forum::TOPIC_MOVED, json!({"area_id":area})),
            (forum::TOPIC_PINNED_CHANGED, json!({"pinned":true})),
        ];
        for (kind, payload) in cases {
            let event = ForumCodec::decode(kind, 1, &payload).unwrap();
            let encoded = ForumCodec::encode(&event).unwrap();
            let decoded =
                ForumCodec::decode(&encoded.kind, encoded.version, &encoded.payload).unwrap();
            assert_eq!(event, decoded);
            assert!(ForumCodec::decode(kind, 2, &payload).is_err());
            assert!(ForumCodec::decode(kind, 1, &Value::Null).is_err());
        }
        assert!(ForumCodec::decode("FutureForumFact", 1, &json!({})).is_err());
    }

    #[test]
    fn publication_facts_are_source_derived_and_do_not_copy_post_content() {
        let event = ForumCodec::decode(
            forum::POST_SUBMITTED,
            1,
            &json!({"body":"secret source body"}),
        )
        .unwrap();
        let facts = ForumCodec::integration_facts(&event).unwrap();
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].context, ForumIntegrationCodec::CONTEXT);
        assert_eq!(facts[0].payload, json!({"effect":"published"}));
        let fact =
            ForumIntegrationCodec::decode(&facts[0].kind, facts[0].version, &facts[0].payload)
                .unwrap();
        assert_eq!(fact.effect, PublicationEffect::Published);
        let rename =
            ForumCodec::decode(forum::TOPIC_RENAMED, 1, &json!({"title":"New title"})).unwrap();
        assert!(ForumCodec::integration_facts(&rename).unwrap().is_empty());
    }

    #[test]
    fn integration_reader_rejects_unknown_or_ambiguous_contracts() {
        assert!(
            ForumIntegrationCodec::decode("Unknown", 1, &json!({"effect":"published"})).is_err()
        );
        assert!(ForumIntegrationCodec::decode(
            "ForumPublicationChanged",
            2,
            &json!({"effect":"published"})
        )
        .is_err());
        assert!(ForumIntegrationCodec::decode(
            "ForumPublicationChanged",
            1,
            &json!({"effect":"future"})
        )
        .is_err());
        assert!(ForumIntegrationCodec::decode(
            "ForumPublicationChanged",
            1,
            &json!({"effect":"published","body":"unowned"})
        )
        .is_err());
    }
}
