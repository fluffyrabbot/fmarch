use super::*;
use content_reference::{
    ContentReferenceReject, MentionCandidate, MentionSpan, PostKind, PostRef, QuotationPostState,
    QuotationThreadState, MAX_QUOTATIONS_PER_POST,
};

const SUBMITTED_AT: i64 = 1_000_000;
const POST_SEQ: i64 = 42;

fn author() -> Uuid {
    Uuid::from_u128(0xA0)
}
fn stranger() -> Uuid {
    Uuid::from_u128(0xB0)
}

fn topic() -> TopicState {
    TopicState {
        topic_id: Uuid::from_u128(0x70),
        area_id: Uuid::from_u128(0x71),
        title: "Revisable claims".to_owned(),
        pinned: false,
        posting_state: PostingState::Open,
        visibility: TopicVisibility::Visible,
        version: 3,
    }
}

fn post() -> PostState {
    PostState {
        topic_id: topic().topic_id,
        source_seq: POST_SEQ,
        author_profile_id: Some(author()),
        body: "original body".to_owned(),
        mentions: Vec::new(),
        has_quotations: false,
        created_at: SUBMITTED_AT,
        revision: 0,
        retracted: false,
    }
}

fn edit(by: Uuid, body: &str, expected_revision: i64, now: i64) -> PostCommand {
    PostCommand::Edit {
        body: PostBody::new(body).unwrap(),
        mentions: Vec::new(),
        author_profile_id: by,
        expected_revision,
        now,
    }
}

fn decide(
    state: &TopicState,
    post: &PostState,
    command: PostCommand,
) -> Result<Vec<TopicEvent>, ForumReject> {
    decide_post(PostDecisionContext::new(state, post)?, command)
}

fn quotation_thread() -> QuotationThreadState {
    QuotationThreadState {
        thread: PostRef::thread(PostKind::DiscussionPost, topic().topic_id),
        posts: vec![QuotationPostState {
            source_seq: POST_SEQ,
            body: "An original claim".to_owned(),
            visible: true,
            outgoing: Vec::new(),
        }],
    }
}

fn quotation() -> Quotation {
    Quotation {
        target: PostRef {
            kind: PostKind::DiscussionPost,
            scope_id: topic().topic_id,
            source_seq: POST_SEQ,
        },
        excerpt: "original claim".to_owned(),
    }
}

#[test]
fn titles_and_bodies_enforce_trimmed_utf8_byte_limits_without_http() {
    assert_eq!(TopicTitle::new("  Title\n").unwrap().as_str(), "Title");
    for invalid in [
        "".to_owned(),
        " \n ".to_owned(),
        "x".repeat(181),
        "é".repeat(91),
    ] {
        assert_eq!(TopicTitle::new(&invalid), Err(ForumReject::InvalidTitle));
    }
    assert!(TopicTitle::new(&"é".repeat(90)).is_ok());
    assert_eq!(PostBody::new("\n reply \t").unwrap().as_str(), "reply");
    assert_eq!(PostBody::new("\n \t").unwrap().as_str(), "");
    assert!(PostBody::new(&"é".repeat(5_000)).is_ok());
    assert_eq!(
        PostBody::new(&"é".repeat(5_001)),
        Err(ForumReject::BodyTooLong)
    );
    assert_eq!(
        PostBody::new(&"x".repeat(10_001)),
        Err(ForumReject::BodyTooLong)
    );
}

#[test]
fn creation_requires_nonempty_opening_text_and_emits_normalized_values() {
    let create = |body| TopicCommand::Create {
        topic_id: topic().topic_id,
        area_id: topic().area_id,
        title: TopicTitle::new("  A new topic  ").unwrap(),
        opening_body: PostBody::new(body).unwrap(),
        author_profile_id: author(),
    };
    assert_eq!(
        decide_topic(None, create("  ")),
        Err(ForumReject::EmptyPost)
    );
    let events = decide_topic(None, create("  Opening\n")).unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].payload()["title"], "A new topic");
    assert_eq!(events[1].payload()["body"], "Opening");
    assert_eq!(
        decide_topic(Some(&topic()), create("Opening")),
        Err(ForumReject::TopicAlreadyExists)
    );
}

#[test]
fn quote_only_content_requires_a_decided_visible_same_topic_quotation() {
    let body = PostBody::new(" ").unwrap();
    let thread = quotation_thread();
    assert_eq!(
        PostContent::new(&thread, body.clone(), &[], &[]),
        Err(ForumReject::EmptyPost)
    );
    let content = PostContent::new(&thread, body.clone(), &[quotation()], &[]).unwrap();
    let events = decide_topic(
        Some(&topic()),
        TopicCommand::SubmitPost {
            content: content.clone(),
            author_profile_id: author(),
        },
    )
    .unwrap();
    assert_eq!(events[0].payload()["body"], "");
    assert_eq!(
        events[0].payload()["quotations"][0]["excerpt"],
        "original claim"
    );
    let mut other_topic = topic();
    other_topic.topic_id = Uuid::from_u128(0x99);
    assert_eq!(
        decide_topic(
            Some(&other_topic),
            TopicCommand::SubmitPost {
                content,
                author_profile_id: author()
            }
        ),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::InvalidQuotationTarget
        ))
    );

    let mut hidden = thread.clone();
    hidden.posts[0].visible = false;
    assert_eq!(
        PostContent::new(&hidden, body.clone(), &[quotation()], &[]),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::QuotationNotFound
        ))
    );
    let mut foreign = quotation();
    foreign.target.scope_id = other_topic.topic_id;
    assert_eq!(
        PostContent::new(&thread, body.clone(), &[foreign], &[]),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::InvalidQuotationTarget
        ))
    );
    let mut forged = quotation();
    forged.excerpt = "invented evidence".to_owned();
    assert_eq!(
        PostContent::new(&thread, body.clone(), &[forged], &[]),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::InvalidQuotationExcerpt
        ))
    );
    assert_eq!(
        PostContent::new(&thread, body.clone(), &[quotation(), quotation()], &[]),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::DuplicateQuotation
        ))
    );
    assert_eq!(
        PostContent::new(
            &thread,
            body.clone(),
            &vec![quotation(); MAX_QUOTATIONS_PER_POST + 1],
            &[]
        ),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::TooManyQuotations
        ))
    );
    let mut game_thread = thread;
    game_thread.thread.kind = PostKind::GamePost;
    assert_eq!(
        PostContent::new(&game_thread, body, &[], &[]),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::InvalidQuotationTarget
        ))
    );
}

#[test]
fn submission_decides_mentions_against_normalized_body_and_respects_topic_policy() {
    let candidates = vec![MentionCandidate {
        profile_id: stranger(),
        handle: "carol".into(),
        offset: 0,
        len: 6,
    }];
    let body = PostBody::new("  @carol hi  ").unwrap();
    let content = PostContent::new(&quotation_thread(), body, &[], &candidates).unwrap();
    let command = || TopicCommand::SubmitPost {
        content: content.clone(),
        author_profile_id: author(),
    };
    let events = decide_topic(Some(&topic()), command()).unwrap();
    assert_eq!(events[0].payload()["body"], "@carol hi");
    assert_eq!(
        events[0].payload()["mentions"][0]["profile_id"],
        serde_json::json!(stranger())
    );
    let mut state = topic();
    state.posting_state = PostingState::Locked;
    assert_eq!(
        decide_topic(Some(&state), command()),
        Err(ForumReject::TopicLocked)
    );
    state.posting_state = PostingState::Open;
    state.visibility = TopicVisibility::Hidden;
    assert_eq!(
        decide_topic(Some(&state), command()),
        Err(ForumReject::TopicHidden)
    );
    assert_eq!(
        decide_topic(None, command()),
        Err(ForumReject::TopicNotFound)
    );
    assert_eq!(
        PostContent::new(
            &quotation_thread(),
            PostBody::new("wrong text").unwrap(),
            &[],
            &candidates
        ),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::InvalidMentionSpan
        ))
    );
}

#[test]
fn edit_has_one_addressed_context_and_foreign_or_invalid_post_is_refused() {
    let state = topic();
    let mut foreign = post();
    foreign.topic_id = Uuid::from_u128(0x99);
    assert!(matches!(
        PostDecisionContext::new(&state, &foreign),
        Err(ForumReject::PostNotFound)
    ));
    foreign.topic_id = state.topic_id;
    foreign.source_seq = 0;
    assert!(matches!(
        PostDecisionContext::new(&state, &foreign),
        Err(ForumReject::PostNotFound)
    ));
}

#[test]
fn author_edit_emits_next_revision_and_never_changes_fixed_quotations() {
    let events = decide(
        &topic(),
        &post(),
        edit(author(), "  fixed body  ", 0, SUBMITTED_AT + 60),
    )
    .unwrap();
    assert_eq!(
        events,
        vec![TopicEvent::PostEdited {
            source_seq: POST_SEQ,
            body: "fixed body".into(),
            mentions: Vec::new(),
            revision: 1
        }]
    );
    assert_eq!(events[0].kind(), POST_EDITED);
    let payload = events[0].payload();
    assert_eq!(payload["source_seq"], POST_SEQ);
    assert!(payload.get("mentions").is_none());
    assert!(payload.get("quotations").is_none());
    assert_eq!(
        decide(
            &topic(),
            &post(),
            edit(author(), "\n ", 0, SUBMITTED_AT + 1)
        ),
        Err(ForumReject::EmptyPost)
    );
    let mut quoted = post();
    quoted.has_quotations = true;
    assert_eq!(
        decide(
            &topic(),
            &quoted,
            edit(author(), "\n ", 0, SUBMITTED_AT + 1)
        )
        .unwrap()[0]
            .payload()["body"],
        ""
    );
}

#[test]
fn edit_validates_new_mentions_and_advances_existing_revision() {
    let mut existing = post();
    existing.revision = 4;
    let command = |text| PostCommand::Edit {
        body: PostBody::new(text).unwrap(),
        mentions: vec![MentionCandidate {
            profile_id: stranger(),
            handle: "carol".into(),
            offset: 0,
            len: 6,
        }],
        author_profile_id: author(),
        expected_revision: 4,
        now: SUBMITTED_AT + 1,
    };
    let events = decide(&topic(), &existing, command("@carol hi")).unwrap();
    assert_eq!(
        events,
        vec![TopicEvent::PostEdited {
            source_seq: POST_SEQ,
            body: "@carol hi".into(),
            mentions: vec![ProfileMention {
                profile_id: stranger(),
                span: MentionSpan { offset: 0, len: 6 }
            }],
            revision: 5
        }]
    );
    assert_eq!(
        decide(&topic(), &existing, command("forged mention")),
        Err(ForumReject::ContentReference(
            ContentReferenceReject::InvalidMentionSpan
        ))
    );
}

#[test]
fn edit_window_uses_original_submission_and_refuses_invalid_clocks() {
    let mut existing = post();
    existing.revision = 2;
    let boundary = SUBMITTED_AT + FORUM_EDIT_WINDOW_SECONDS;
    assert!(decide(&topic(), &existing, edit(author(), "fixed", 2, boundary)).is_ok());
    for now in [boundary + 1, SUBMITTED_AT - 1, i64::MIN, i64::MAX] {
        assert_eq!(
            decide(&topic(), &existing, edit(author(), "fixed", 2, now)),
            Err(ForumReject::EditWindowElapsed)
        );
    }
}

#[test]
fn edit_revision_is_nonnegative_checked_and_compared_before_noop() {
    let mut existing = post();
    existing.revision = 1;
    assert_eq!(
        decide(
            &topic(),
            &existing,
            edit(author(), "original body", 0, SUBMITTED_AT)
        ),
        Err(ForumReject::StaleRevision)
    );
    assert_eq!(
        decide(
            &topic(),
            &existing,
            edit(author(), "original body", 1, SUBMITTED_AT)
        ),
        Err(ForumReject::NoStateChange)
    );
    assert_eq!(
        decide(
            &topic(),
            &existing,
            edit(author(), "changed", -1, SUBMITTED_AT)
        ),
        Err(ForumReject::InvalidRevision)
    );
    existing.revision = -1;
    assert_eq!(
        decide(
            &topic(),
            &existing,
            edit(author(), "changed", -1, SUBMITTED_AT)
        ),
        Err(ForumReject::InvalidRevision)
    );
    existing.revision = i64::MAX;
    assert_eq!(
        decide(
            &topic(),
            &existing,
            edit(author(), "changed", i64::MAX, SUBMITTED_AT)
        ),
        Err(ForumReject::InvalidRevision)
    );
}

#[test]
fn edit_and_retraction_share_exact_author_topic_and_retraction_admission() {
    let check = |state: &TopicState, existing: &PostState, by: Uuid, reject: ForumReject| {
        for command in [
            edit(by, "fixed", 0, SUBMITTED_AT),
            PostCommand::Retract {
                author_profile_id: by,
            },
        ] {
            assert_eq!(decide(state, existing, command), Err(reject.clone()));
        }
    };
    check(&topic(), &post(), stranger(), ForumReject::NotAuthor);
    let mut existing = post();
    existing.author_profile_id = None;
    check(&topic(), &existing, author(), ForumReject::NotAuthor);
    existing = post();
    existing.retracted = true;
    check(&topic(), &existing, author(), ForumReject::PostRetracted);
    let mut state = topic();
    state.posting_state = PostingState::Locked;
    check(&state, &post(), author(), ForumReject::TopicLocked);
    state.posting_state = PostingState::Open;
    state.visibility = TopicVisibility::Hidden;
    check(&state, &post(), author(), ForumReject::TopicHidden);
}

#[test]
fn retraction_ignores_edit_window_and_keeps_canonical_target() {
    let mut existing = post();
    existing.created_at = 0;
    let events = decide(
        &topic(),
        &existing,
        PostCommand::Retract {
            author_profile_id: author(),
        },
    )
    .unwrap();
    assert_eq!(
        events,
        vec![TopicEvent::PostRetracted {
            source_seq: POST_SEQ
        }]
    );
    assert_eq!(events[0].kind(), POST_RETRACTED);
    assert_eq!(
        events[0].payload(),
        serde_json::json!({ "source_seq": POST_SEQ })
    );
}

#[test]
fn curation_uses_validated_titles_ignores_posting_state_and_refuses_noops() {
    let mut state = topic();
    state.posting_state = PostingState::Locked;
    let events = decide_topic(
        Some(&state),
        TopicCommand::Rename {
            title: TopicTitle::new(" Filed claims ").unwrap(),
        },
    )
    .unwrap();
    assert_eq!(
        events,
        vec![TopicEvent::Renamed {
            title: "Filed claims".into()
        }]
    );
    assert_eq!(events[0].kind(), TOPIC_RENAMED);
    assert_eq!(
        events[0].payload(),
        serde_json::json!({ "title": "Filed claims" })
    );
    let other_area = Uuid::from_u128(0x72);
    let moved = decide_topic(
        Some(&state),
        TopicCommand::Move {
            area_id: other_area,
        },
    )
    .unwrap();
    assert_eq!(
        moved,
        vec![TopicEvent::Moved {
            area_id: other_area
        }]
    );
    assert_eq!(moved[0].kind(), TOPIC_MOVED);
    assert_eq!(
        moved[0].payload(),
        serde_json::json!({ "area_id": other_area })
    );
    let pinned = decide_topic(Some(&state), TopicCommand::SetPinned { pinned: true }).unwrap();
    assert_eq!(pinned, vec![TopicEvent::PinnedChanged { pinned: true }]);
    assert_eq!(pinned[0].kind(), TOPIC_PINNED_CHANGED);
    assert_eq!(pinned[0].payload(), serde_json::json!({ "pinned": true }));
    for command in [
        TopicCommand::Rename {
            title: TopicTitle::new(&state.title).unwrap(),
        },
        TopicCommand::Move {
            area_id: state.area_id,
        },
        TopicCommand::SetPinned { pinned: false },
    ] {
        assert_eq!(
            decide_topic(Some(&state), command),
            Err(ForumReject::NoStateChange)
        );
    }
    assert_eq!(
        decide_topic(None, TopicCommand::SetPinned { pinned: true }),
        Err(ForumReject::TopicNotFound)
    );
}
