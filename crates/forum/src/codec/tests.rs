use super::*;
use crate::{AreaCreated, TopicEvent};
use content_reference::{MentionSpan, PostKind, PostRef};
use serde_json::json;

fn current_events() -> Vec<(TopicEvent, DecodedForumEvent)> {
    let area_id = Uuid::from_u128(1);
    let profile = Uuid::from_u128(2);
    let quotations = vec![Quotation {
        target: PostRef {
            kind: PostKind::DiscussionPost,
            scope_id: Uuid::from_u128(3),
            source_seq: 4,
        },
        excerpt: "recorded excerpt".into(),
    }];
    let mentions = vec![ProfileMention {
        profile_id: profile,
        span: MentionSpan { offset: 0, len: 8 },
    }];
    vec![
        (
            TopicEvent::Created {
                area_id,
                title: "Topic".into(),
                author_profile_id: profile,
            },
            DecodedForumEvent::TopicCreated {
                area_id,
                title: "Topic".into(),
                author_profile_id: Some(profile),
            },
        ),
        (
            TopicEvent::PostSubmitted {
                body: "@profile hello".into(),
                author_profile_id: profile,
                quotations: quotations.clone(),
                mentions: mentions.clone(),
            },
            DecodedForumEvent::PostSubmitted {
                body: "@profile hello".into(),
                author_profile_id: Some(profile),
                quotations,
                mentions: mentions.clone(),
            },
        ),
        (
            TopicEvent::PostEdited {
                source_seq: 4,
                body: "@profile edit".into(),
                mentions: mentions.clone(),
                revision: 1,
            },
            DecodedForumEvent::PostEdited {
                source_seq: 4,
                body: "@profile edit".into(),
                mentions,
                revision: 1,
            },
        ),
        (
            TopicEvent::PostRetracted { source_seq: 4 },
            DecodedForumEvent::PostRetracted { source_seq: 4 },
        ),
        (
            TopicEvent::PostingStateChanged {
                posting_state: PostingState::Locked,
            },
            DecodedForumEvent::PostingStateChanged {
                posting_state: PostingState::Locked,
            },
        ),
        (
            TopicEvent::VisibilityChanged {
                visibility: TopicVisibility::Hidden,
            },
            DecodedForumEvent::VisibilityChanged {
                visibility: TopicVisibility::Hidden,
            },
        ),
        (
            TopicEvent::Renamed {
                title: "Renamed".into(),
            },
            DecodedForumEvent::TopicRenamed {
                title: "Renamed".into(),
            },
        ),
        (
            TopicEvent::Moved { area_id },
            DecodedForumEvent::TopicMoved { area_id },
        ),
        (
            TopicEvent::PinnedChanged { pinned: true },
            DecodedForumEvent::PinnedChanged { pinned: true },
        ),
    ]
}

#[test]
fn every_current_producer_decodes_without_changing_payloads() {
    let area = AreaCreated {
        slug: "general".into(),
        title: "General".into(),
        description: "Discussion".into(),
    };
    assert_eq!(
        decode_event(area.kind(), 1, &area.payload()).unwrap(),
        DecodedForumEvent::AreaCreated {
            slug: area.slug,
            title: area.title,
            description: area.description
        },
    );
    let events = current_events();
    assert_eq!(events.len(), 9);
    for (event, expected) in events {
        assert_eq!(
            decode_event(event.kind(), 1, &event.payload()).unwrap(),
            expected
        );
    }
}

#[test]
fn retained_v1_additions_are_explicit_and_preserve_historical_text() {
    let area_id = Uuid::from_u128(1);
    let title = format!("  {}  ", "a".repeat(181));
    assert_eq!(
        decode_event(
            crate::TOPIC_CREATED,
            1,
            &json!({ "area_id": area_id, "title": title })
        )
        .unwrap(),
        DecodedForumEvent::TopicCreated {
            area_id,
            title,
            author_profile_id: None
        },
    );
    let body = format!("  {}  ", "a".repeat(10_001));
    for references in [
        json!({}),
        json!({ "quotations": null, "mentions": null }),
        json!({ "quotations": [], "mentions": [] }),
    ] {
        let mut payload = references;
        payload["body"] = json!(body);
        assert_eq!(
            decode_event(crate::POST_SUBMITTED, 1, &payload).unwrap(),
            DecodedForumEvent::PostSubmitted {
                body: body.clone(),
                author_profile_id: None,
                quotations: vec![],
                mentions: vec![]
            },
        );
    }
    for mentions in [
        json!({}),
        json!({ "mentions": null }),
        json!({ "mentions": [] }),
    ] {
        let mut payload = mentions;
        payload["source_seq"] = json!(4);
        payload["revision"] = json!(1);
        payload["body"] = json!("");
        assert_eq!(
            decode_event(crate::POST_EDITED, 1, &payload).unwrap(),
            DecodedForumEvent::PostEdited {
                source_seq: 4,
                revision: 1,
                body: "".into(),
                mentions: vec![]
            },
        );
    }
}

#[test]
fn kind_and_version_are_a_closed_contract() {
    assert!(matches!(
        decode_event("DiscussionPostFutureFact", 1, &json!({})),
        Err(ForumDecodeError::UnknownKind { .. }),
    ));
    let mut kinds = current_events()
        .into_iter()
        .map(|(event, _)| event.kind())
        .collect::<Vec<_>>();
    kinds.push(crate::AREA_CREATED);
    for kind in kinds {
        for version in [i16::MIN, -1, 0, 2, i16::MAX] {
            assert!(matches!(
                decode_event(kind, version, &json!({})),
                Err(ForumDecodeError::UnsupportedVersion { version: rejected, .. }) if rejected == version,
            ));
        }
    }
}

fn assert_malformed(kind: &str, payload: &Value) {
    assert!(
        matches!(
            decode_event(kind, 1, payload),
            Err(ForumDecodeError::Payload { .. })
        ),
        "{kind} accepted {payload}"
    );
}

#[test]
fn required_fields_cannot_default_or_disappear() {
    let area = AreaCreated {
        slug: "general".into(),
        title: "General".into(),
        description: "Discussion".into(),
    };
    let mut fixtures = current_events()
        .into_iter()
        .map(|(event, _)| (event.kind(), event.payload()))
        .collect::<Vec<_>>();
    fixtures.push((area.kind(), area.payload()));
    for (kind, payload) in fixtures {
        for key in payload.as_object().unwrap().keys() {
            if matches!(
                key.as_str(),
                "author_profile_id" | "quotations" | "mentions"
            ) {
                continue;
            }
            let mut missing = payload.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert_malformed(kind, &missing);
            let mut null = payload.clone();
            null[key] = Value::Null;
            assert_malformed(kind, &null);
        }
        let mut extra = payload.clone();
        extra["unversioned_future_field"] = json!(true);
        assert_malformed(kind, &extra);
        assert_malformed(kind, &json!([]));
        assert_malformed(kind, &Value::Null);
    }
}

#[test]
fn present_attribution_must_be_a_uuid() {
    for kind in [crate::TOPIC_CREATED, crate::POST_SUBMITTED] {
        for author in [Value::Null, json!(12), json!("bad-uuid")] {
            let mut payload = if kind == crate::TOPIC_CREATED {
                json!({ "area_id": Uuid::from_u128(1), "title": "Topic" })
            } else {
                json!({ "body": "Post" })
            };
            payload["author_profile_id"] = author;
            assert_malformed(kind, &payload);
        }
    }
}

#[test]
fn persisted_integers_booleans_and_states_are_never_coerced() {
    for value in [json!(1.5), json!("1"), json!(u64::MAX), Value::Null] {
        for key in ["source_seq", "revision"] {
            let mut payload = json!({ "source_seq": 4, "revision": 1, "body": "Edit" });
            payload[key] = value.clone();
            assert_malformed(crate::POST_EDITED, &payload);
        }
    }
    for value in [json!("true"), json!(1), Value::Null] {
        assert_malformed(crate::TOPIC_PINNED_CHANGED, &json!({ "pinned": value }));
    }
    for value in [" open ", "unknown", "LOCKED"] {
        assert_malformed(
            crate::POSTING_STATE_CHANGED,
            &json!({ "posting_state": value }),
        );
    }
    for value in [" visible ", "unknown", "HIDDEN"] {
        assert_malformed(crate::VISIBILITY_CHANGED, &json!({ "visibility": value }));
    }
    assert_malformed(crate::TOPIC_MOVED, &json!({ "area_id": "invalid" }));
}

#[test]
fn malformed_reference_lists_or_items_never_drop_edges() {
    let good_quotation = json!({ "target": { "kind": "discussion_post", "scope_id": Uuid::from_u128(1), "source_seq": 4 }, "excerpt": "words" });
    let good_mention =
        json!({ "profile_id": Uuid::from_u128(2), "span": { "offset": 0, "len": 4 } });
    for (field, good, malformed) in [
        (
            "quotations",
            good_quotation,
            json!({ "target": { "kind": "future_kind", "scope_id": Uuid::from_u128(1), "source_seq": 4 }, "excerpt": "words" }),
        ),
        (
            "mentions",
            good_mention,
            json!({ "profile_id": Uuid::from_u128(2), "span": { "offset": -1, "len": 4 } }),
        ),
    ] {
        for value in [
            json!("not a list"),
            json!({}),
            json!([good.clone(), malformed.clone()]),
            json!([malformed, good]),
        ] {
            let mut payload = json!({ "body": "Post" });
            payload[field] = value;
            assert_malformed(crate::POST_SUBMITTED, &payload);
        }
    }
}
