use super::*;
use crate::{decide_post, decode_event, ForumReject, PostBody, PostCommand, PostDecisionContext};

fn record(stream_seq: i64, event: DecodedForumEvent) -> ForumEventRecord {
    ForumEventRecord {
        source_seq: stream_seq * 10,
        stream_seq,
        occurred_at: 100 + stream_seq,
        event,
    }
}

fn history(author: Option<Uuid>) -> Vec<ForumEventRecord> {
    vec![
        record(
            1,
            DecodedForumEvent::TopicCreated {
                area_id: Uuid::from_u128(1),
                title: "Original".into(),
                author_profile_id: author,
            },
        ),
        record(
            2,
            DecodedForumEvent::PostSubmitted {
                body: "Original post".into(),
                author_profile_id: author,
                quotations: vec![],
                mentions: vec![],
            },
        ),
    ]
}

#[test]
fn replay_carries_post_authorship_revisions_and_every_topic_policy() {
    let topic = Uuid::from_u128(2);
    let author = Uuid::from_u128(3);
    let mut records = history(Some(author));
    records.extend([
        record(
            3,
            DecodedForumEvent::PostEdited {
                source_seq: 20,
                body: "Edited".into(),
                mentions: vec![],
                revision: 1,
            },
        ),
        record(
            4,
            DecodedForumEvent::TopicRenamed {
                title: "Renamed".into(),
            },
        ),
        record(
            5,
            DecodedForumEvent::TopicMoved {
                area_id: Uuid::from_u128(4),
            },
        ),
        record(6, DecodedForumEvent::PinnedChanged { pinned: true }),
        record(
            7,
            DecodedForumEvent::PostingStateChanged {
                posting_state: PostingState::Locked,
            },
        ),
        record(
            8,
            DecodedForumEvent::VisibilityChanged {
                visibility: TopicVisibility::Hidden,
            },
        ),
    ]);
    let aggregate = TopicAggregate::replay(topic, &records).unwrap();
    let state = aggregate.state().unwrap();
    assert_eq!(state.title, "Renamed");
    assert_eq!(state.area_id, Uuid::from_u128(4));
    assert!(state.pinned);
    assert_eq!(state.version, 8);
    assert_eq!(state.posting_state, PostingState::Locked);
    assert_eq!(state.visibility, TopicVisibility::Hidden);
    let post = aggregate.post(20).unwrap();
    assert_eq!(post.author_profile_id, Some(author));
    assert_eq!(post.created_at, 102);
    assert_eq!(post.revision, 1);
    assert_eq!(post.body, "Edited");
    assert_eq!(
        decide_post(
            PostDecisionContext::new(state, post).unwrap(),
            PostCommand::Retract {
                author_profile_id: author
            }
        ),
        Err(ForumReject::TopicHidden)
    );
}

#[test]
fn malformed_sequences_foreign_stream_facts_and_invalid_post_transitions_fail_closed() {
    let author = Uuid::from_u128(3);
    let mut variants = Vec::new();
    let mut gap = history(Some(author));
    gap[1].stream_seq = 3;
    variants.push(gap);
    let mut reversed = history(Some(author));
    reversed[1].source_seq = 1;
    variants.push(reversed);
    let mut duplicate = history(Some(author));
    duplicate.push(record(3, duplicate[0].event.clone()));
    variants.push(duplicate);
    let mut foreign = history(Some(author));
    foreign.push(record(
        3,
        DecodedForumEvent::AreaCreated {
            slug: "other".into(),
            title: "Other".into(),
            description: "Foreign".into(),
        },
    ));
    variants.push(foreign);
    for (source_seq, revision) in [(999, 1), (20, 0), (20, 2)] {
        let mut records = history(Some(author));
        records.push(record(
            3,
            DecodedForumEvent::PostEdited {
                source_seq,
                body: "Corrupt".into(),
                mentions: vec![],
                revision,
            },
        ));
        variants.push(records);
    }
    let mut retracted = history(Some(author));
    retracted.push(record(
        3,
        DecodedForumEvent::PostRetracted { source_seq: 20 },
    ));
    retracted.push(record(
        4,
        DecodedForumEvent::PostEdited {
            source_seq: 20,
            body: "Corrupt".into(),
            mentions: vec![],
            revision: 1,
        },
    ));
    variants.push(retracted);
    for records in variants {
        assert!(TopicAggregate::replay(Uuid::from_u128(2), &records).is_err());
    }
}

#[test]
fn absent_historical_author_cannot_become_an_editable_owned_post() {
    let aggregate = TopicAggregate::replay(Uuid::from_u128(2), &history(None)).unwrap();
    let context =
        PostDecisionContext::new(aggregate.state().unwrap(), aggregate.post(20).unwrap()).unwrap();
    assert_eq!(
        decide_post(
            context,
            PostCommand::Edit {
                body: PostBody::new("Edited").unwrap(),
                mentions: vec![],
                author_profile_id: Uuid::from_u128(3),
                expected_revision: 0,
                now: 110
            }
        ),
        Err(ForumReject::NotAuthor)
    );
}

#[test]
fn current_and_historical_typed_facts_round_trip_without_null_authorship() {
    let mut facts: Vec<_> = history(None)
        .into_iter()
        .map(|record| record.event)
        .collect();
    facts.extend([
        DecodedForumEvent::AreaCreated {
            slug: "area".into(),
            title: "Area".into(),
            description: "Description".into(),
        },
        DecodedForumEvent::PostEdited {
            source_seq: 20,
            body: "Edited".into(),
            mentions: vec![],
            revision: 1,
        },
        DecodedForumEvent::PostRetracted { source_seq: 20 },
        DecodedForumEvent::PostingStateChanged {
            posting_state: PostingState::Locked,
        },
        DecodedForumEvent::VisibilityChanged {
            visibility: TopicVisibility::Hidden,
        },
        DecodedForumEvent::TopicRenamed {
            title: "Renamed".into(),
        },
        DecodedForumEvent::TopicMoved {
            area_id: Uuid::from_u128(4),
        },
        DecodedForumEvent::PinnedChanged { pinned: true },
    ]);
    for fact in facts {
        assert_eq!(decode_event(fact.kind(), 1, &fact.payload()).unwrap(), fact);
        assert!(decode_event(fact.kind(), 2, &fact.payload()).is_err());
        assert!(!fact
            .payload()
            .get("author_profile_id")
            .is_some_and(serde_json::Value::is_null));
    }
}

#[test]
fn area_authority_contains_only_its_one_creation_fact() {
    let area = Uuid::from_u128(1);
    let record = record(
        1,
        DecodedForumEvent::AreaCreated {
            slug: "area".into(),
            title: "Area".into(),
            description: "Description".into(),
        },
    );
    assert_eq!(
        AreaAggregate::replay(area, std::slice::from_ref(&record))
            .unwrap()
            .state()
            .unwrap()
            .slug,
        "area"
    );
    assert!(AreaAggregate::replay(area, &[record.clone(), record]).is_err());
    assert!(AreaAggregate::replay(area, &history(None)).is_err());
}
