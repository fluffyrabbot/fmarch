//! Public forum area/topic lifecycle and profile-authored posting policy.

use content_reference::{mentions_payload, quotations_payload, ProfileMention, Quotation};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const AREA_CREATED: &str = "DiscussionAreaCreated";
pub const TOPIC_CREATED: &str = "DiscussionTopicCreated";
pub const POST_SUBMITTED: &str = "DiscussionPostSubmitted";
pub const POST_EDITED: &str = "DiscussionPostEdited";
pub const POST_RETRACTED: &str = "DiscussionPostRetracted";
pub const POSTING_STATE_CHANGED: &str = "DiscussionTopicPostingStateChanged";
pub const VISIBILITY_CHANGED: &str = "DiscussionTopicVisibilityChanged";

/// How long after submission a forum post stays editable by its author,
/// measured from the original submission rather than the last edit so a
/// chain of edits cannot extend the window. Editability is a policy owned by
/// each thread source: this constant is the forum's, and game channels have
/// no counterpart because their posts are slot-authored evidence.
pub const FORUM_EDIT_WINDOW_SECONDS: i64 = 30 * 60;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ForumReject {
    #[error("discussion topic already exists")]
    TopicAlreadyExists,
    #[error("discussion topic was not found")]
    TopicNotFound,
    #[error("discussion topic is locked")]
    TopicLocked,
    #[error("discussion topic is hidden")]
    TopicHidden,
    #[error("discussion command does not change topic state")]
    NoStateChange,
    #[error("discussion posting state must be open or locked")]
    InvalidPostingState,
    #[error("discussion visibility must be visible or hidden")]
    InvalidVisibility,
    #[error("discussion post was not found")]
    PostNotFound,
    #[error("only the post author may change this post")]
    NotAuthor,
    #[error("discussion post edit window has elapsed")]
    EditWindowElapsed,
    #[error("discussion post was retracted by its author")]
    PostRetracted,
    #[error("discussion post changed since it was read; refresh and try again")]
    StaleRevision,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AreaCreated {
    pub slug: String,
    pub title: String,
    pub description: String,
}
impl AreaCreated {
    pub fn kind(&self) -> &'static str {
        AREA_CREATED
    }
    pub fn payload(&self) -> serde_json::Value {
        serde_json::json!({"slug": self.slug, "title": self.title, "description": self.description})
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostingState {
    Open,
    Locked,
}
impl PostingState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Locked => "locked",
        }
    }
    pub fn parse(value: &str) -> Result<Self, ForumReject> {
        match value.trim() {
            "open" => Ok(Self::Open),
            "locked" => Ok(Self::Locked),
            _ => Err(ForumReject::InvalidPostingState),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TopicVisibility {
    Visible,
    Hidden,
}
impl TopicVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::Hidden => "hidden",
        }
    }
    pub fn parse(value: &str) -> Result<Self, ForumReject> {
        match value.trim() {
            "visible" => Ok(Self::Visible),
            "hidden" => Ok(Self::Hidden),
            _ => Err(ForumReject::InvalidVisibility),
        }
    }
}

/// The slice of one post the write model needs to decide an edit or a
/// retraction. The adapter loads only the addressed post; every other post in
/// the topic is irrelevant to the decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostState {
    pub source_seq: i64,
    pub author_profile_id: Option<Uuid>,
    pub body: String,
    pub mentions: Vec<ProfileMention>,
    /// Quotations are fixed at submission; an edit only needs to know whether
    /// they exist so an emptied body still leaves something to read.
    pub has_quotations: bool,
    pub created_at: i64,
    pub revision: i64,
    pub retracted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicState {
    pub topic_id: Uuid,
    pub area_id: Uuid,
    pub posting_state: PostingState,
    pub visibility: TopicVisibility,
    pub version: i64,
    /// Posts loaded for post-addressed commands. Empty for topic-level commands.
    pub posts: Vec<PostState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopicCommand {
    Create {
        topic_id: Uuid,
        area_id: Uuid,
        title: String,
        opening_body: String,
        author_profile_id: Uuid,
    },
    SubmitPost {
        body: String,
        author_profile_id: Uuid,
        quotations: Vec<Quotation>,
        mentions: Vec<ProfileMention>,
    },
    /// Replace the body and mentions of the author's own post inside the edit
    /// window. Quotations are fixed at submission and are not part of an edit.
    /// `now` is the adapter's clock reading so the window decision stays pure.
    EditPost {
        source_seq: i64,
        body: String,
        mentions: Vec<ProfileMention>,
        author_profile_id: Uuid,
        expected_revision: i64,
        now: i64,
    },
    /// Withdraw the author's own post. The row and its history survive; readers
    /// see a retracted placeholder and cited excerpts keep their snapshots.
    RetractPost {
        source_seq: i64,
        author_profile_id: Uuid,
    },
    SetPostingState {
        posting_state: PostingState,
    },
    SetVisibility {
        visibility: TopicVisibility,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopicEvent {
    Created {
        area_id: Uuid,
        title: String,
        author_profile_id: Uuid,
    },
    PostSubmitted {
        body: String,
        author_profile_id: Uuid,
        quotations: Vec<Quotation>,
        mentions: Vec<ProfileMention>,
    },
    PostEdited {
        source_seq: i64,
        body: String,
        mentions: Vec<ProfileMention>,
        revision: i64,
    },
    PostRetracted {
        source_seq: i64,
    },
    PostingStateChanged {
        posting_state: PostingState,
    },
    VisibilityChanged {
        visibility: TopicVisibility,
    },
}
impl TopicEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Created { .. } => TOPIC_CREATED,
            Self::PostSubmitted { .. } => POST_SUBMITTED,
            Self::PostEdited { .. } => POST_EDITED,
            Self::PostRetracted { .. } => POST_RETRACTED,
            Self::PostingStateChanged { .. } => POSTING_STATE_CHANGED,
            Self::VisibilityChanged { .. } => VISIBILITY_CHANGED,
        }
    }
    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Created {
                area_id,
                title,
                author_profile_id,
            } => {
                serde_json::json!({"area_id": area_id, "title": title, "author_profile_id": author_profile_id})
            }
            Self::PostSubmitted {
                body,
                author_profile_id,
                quotations,
                mentions,
            } => {
                let mut payload =
                    serde_json::json!({"body": body, "author_profile_id": author_profile_id});
                if let Some(quotations) = quotations_payload(quotations) {
                    payload["quotations"] = quotations;
                }
                if let Some(mentions) = mentions_payload(mentions) {
                    payload["mentions"] = mentions;
                }
                payload
            }
            Self::PostEdited {
                source_seq,
                body,
                mentions,
                revision,
            } => {
                let mut payload = serde_json::json!({
                    "source_seq": source_seq,
                    "body": body,
                    "revision": revision,
                });
                if let Some(mentions) = mentions_payload(mentions) {
                    payload["mentions"] = mentions;
                }
                payload
            }
            Self::PostRetracted { source_seq } => {
                serde_json::json!({"source_seq": source_seq})
            }
            Self::PostingStateChanged { posting_state } => {
                serde_json::json!({"posting_state": posting_state.as_str()})
            }
            Self::VisibilityChanged { visibility } => {
                serde_json::json!({"visibility": visibility.as_str()})
            }
        }
    }
}

pub fn decide_topic(
    state: Option<&TopicState>,
    command: TopicCommand,
) -> Result<Vec<TopicEvent>, ForumReject> {
    match (state, command) {
        (
            None,
            TopicCommand::Create {
                area_id,
                title,
                opening_body,
                author_profile_id,
                ..
            },
        ) => Ok(vec![
            TopicEvent::Created {
                area_id,
                title,
                author_profile_id,
            },
            TopicEvent::PostSubmitted {
                body: opening_body,
                author_profile_id,
                quotations: Vec::new(),
                mentions: Vec::new(),
            },
        ]),
        (Some(_), TopicCommand::Create { .. }) => Err(ForumReject::TopicAlreadyExists),
        (None, _) => Err(ForumReject::TopicNotFound),
        (
            Some(state),
            TopicCommand::SubmitPost {
                body,
                author_profile_id,
                quotations,
                mentions,
            },
        ) => {
            if state.visibility != TopicVisibility::Visible {
                return Err(ForumReject::TopicHidden);
            }
            if state.posting_state != PostingState::Open {
                return Err(ForumReject::TopicLocked);
            }
            Ok(vec![TopicEvent::PostSubmitted {
                body,
                author_profile_id,
                quotations,
                mentions,
            }])
        }
        (
            Some(state),
            TopicCommand::EditPost {
                source_seq,
                body,
                mentions,
                author_profile_id,
                expected_revision,
                now,
            },
        ) => {
            let post = own_open_post(state, source_seq, author_profile_id)?;
            if post.revision != expected_revision {
                return Err(ForumReject::StaleRevision);
            }
            if now - post.created_at > FORUM_EDIT_WINDOW_SECONDS {
                return Err(ForumReject::EditWindowElapsed);
            }
            if post.body == body && post.mentions == mentions {
                return Err(ForumReject::NoStateChange);
            }
            Ok(vec![TopicEvent::PostEdited {
                source_seq,
                body,
                mentions,
                revision: post.revision + 1,
            }])
        }
        (
            Some(state),
            TopicCommand::RetractPost {
                source_seq,
                author_profile_id,
            },
        ) => {
            own_open_post(state, source_seq, author_profile_id)?;
            Ok(vec![TopicEvent::PostRetracted { source_seq }])
        }
        (Some(state), TopicCommand::SetPostingState { posting_state })
            if state.posting_state != posting_state =>
        {
            Ok(vec![TopicEvent::PostingStateChanged { posting_state }])
        }
        (Some(state), TopicCommand::SetVisibility { visibility })
            if state.visibility != visibility =>
        {
            Ok(vec![TopicEvent::VisibilityChanged { visibility }])
        }
        _ => Err(ForumReject::NoStateChange),
    }
}

/// Shared admission for post-addressed author commands: the topic must be
/// visible and open, the post must be loaded, authored by the caller, and not
/// already retracted. Locked means frozen for authors too; a moderator who
/// locks a thread freezes its record, not just its tail.
fn own_open_post(
    state: &TopicState,
    source_seq: i64,
    author_profile_id: Uuid,
) -> Result<&PostState, ForumReject> {
    if state.visibility != TopicVisibility::Visible {
        return Err(ForumReject::TopicHidden);
    }
    if state.posting_state != PostingState::Open {
        return Err(ForumReject::TopicLocked);
    }
    let post = state
        .posts
        .iter()
        .find(|post| post.source_seq == source_seq)
        .ok_or(ForumReject::PostNotFound)?;
    if post.author_profile_id != Some(author_profile_id) {
        return Err(ForumReject::NotAuthor);
    }
    if post.retracted {
        return Err(ForumReject::PostRetracted);
    }
    Ok(post)
}

/// Every reject in the edit and retraction admission matrix, alongside the
/// events the happy paths emit, so the HTTP boundary can map rejects without
/// re-deriving policy.
#[cfg(test)]
mod tests {
    use super::*;
    use content_reference::MentionSpan;

    const SUBMITTED_AT: i64 = 1_000_000;
    const POST_SEQ: i64 = 42;

    fn author() -> Uuid {
        Uuid::from_u128(0xA0)
    }

    fn stranger() -> Uuid {
        Uuid::from_u128(0xB0)
    }

    fn mention(profile: u128, offset: usize, len: usize) -> ProfileMention {
        ProfileMention {
            profile_id: Uuid::from_u128(profile),
            span: MentionSpan { offset, len },
        }
    }

    fn post() -> PostState {
        PostState {
            source_seq: POST_SEQ,
            author_profile_id: Some(author()),
            body: "original body".to_string(),
            mentions: Vec::new(),
            has_quotations: false,
            created_at: SUBMITTED_AT,
            revision: 0,
            retracted: false,
        }
    }

    fn topic(posts: Vec<PostState>) -> TopicState {
        TopicState {
            topic_id: Uuid::from_u128(0x70),
            area_id: Uuid::from_u128(0x71),
            posting_state: PostingState::Open,
            visibility: TopicVisibility::Visible,
            version: 3,
            posts,
        }
    }

    fn edit(by: Uuid, body: &str, expected_revision: i64, now: i64) -> TopicCommand {
        TopicCommand::EditPost {
            source_seq: POST_SEQ,
            body: body.to_string(),
            mentions: Vec::new(),
            author_profile_id: by,
            expected_revision,
            now,
        }
    }

    fn retract(by: Uuid) -> TopicCommand {
        TopicCommand::RetractPost {
            source_seq: POST_SEQ,
            author_profile_id: by,
        }
    }

    #[test]
    fn author_edit_inside_window_emits_post_edited_with_next_revision() {
        let state = topic(vec![post()]);
        let events = decide_topic(Some(&state), edit(author(), "fixed body", 0, SUBMITTED_AT + 60))
            .expect("author edit inside the window is admitted");
        assert_eq!(
            events,
            vec![TopicEvent::PostEdited {
                source_seq: POST_SEQ,
                body: "fixed body".to_string(),
                mentions: Vec::new(),
                revision: 1,
            }]
        );
        assert_eq!(events[0].kind(), POST_EDITED);
        let payload = events[0].payload();
        assert_eq!(payload["source_seq"], POST_SEQ);
        assert_eq!(payload["body"], "fixed body");
        assert_eq!(payload["revision"], 1);
        assert!(
            payload.get("mentions").is_none(),
            "an empty mention list is omitted from the payload like PostSubmitted"
        );
        assert!(
            payload.get("quotations").is_none(),
            "quotations are fixed at submission and never travel on an edit"
        );
    }

    #[test]
    fn edit_at_the_window_boundary_is_admitted_and_one_second_later_is_not() {
        let state = topic(vec![post()]);
        let at_boundary = SUBMITTED_AT + FORUM_EDIT_WINDOW_SECONDS;
        assert!(decide_topic(Some(&state), edit(author(), "fixed", 0, at_boundary)).is_ok());
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "fixed", 0, at_boundary + 1)),
            Err(ForumReject::EditWindowElapsed)
        );
    }

    #[test]
    fn window_is_measured_from_submission_not_from_the_last_edit() {
        let mut edited = post();
        edited.revision = 2;
        let state = topic(vec![edited]);
        assert_eq!(
            decide_topic(
                Some(&state),
                edit(author(), "again", 2, SUBMITTED_AT + FORUM_EDIT_WINDOW_SECONDS + 1)
            ),
            Err(ForumReject::EditWindowElapsed)
        );
    }

    #[test]
    fn edit_carries_new_mentions_and_reports_revision_from_state() {
        let mut edited = post();
        edited.revision = 4;
        let state = topic(vec![edited]);
        let mentions = vec![mention(0xC0, 0, 6)];
        let events = decide_topic(
            Some(&state),
            TopicCommand::EditPost {
                source_seq: POST_SEQ,
                body: "@carol hi".to_string(),
                mentions: mentions.clone(),
                author_profile_id: author(),
                expected_revision: 4,
                now: SUBMITTED_AT + 1,
            },
        )
        .unwrap();
        assert_eq!(
            events,
            vec![TopicEvent::PostEdited {
                source_seq: POST_SEQ,
                body: "@carol hi".to_string(),
                mentions,
                revision: 5,
            }]
        );
        assert!(events[0].payload()["mentions"].is_array());
    }

    #[test]
    fn non_author_edit_is_rejected() {
        let state = topic(vec![post()]);
        assert_eq!(
            decide_topic(Some(&state), edit(stranger(), "hijack", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::NotAuthor)
        );
    }

    #[test]
    fn post_without_author_cannot_be_claimed() {
        let mut orphan = post();
        orphan.author_profile_id = None;
        let state = topic(vec![orphan]);
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "claim", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::NotAuthor)
        );
    }

    #[test]
    fn stale_expected_revision_is_rejected() {
        let mut edited = post();
        edited.revision = 1;
        let state = topic(vec![edited]);
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "late", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::StaleRevision)
        );
    }

    #[test]
    fn unchanged_edit_is_rejected_as_no_state_change() {
        let state = topic(vec![post()]);
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "original body", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::NoStateChange)
        );
    }

    #[test]
    fn edit_and_retract_of_a_retracted_post_are_rejected() {
        let mut retracted = post();
        retracted.retracted = true;
        let state = topic(vec![retracted]);
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "revive", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::PostRetracted)
        );
        assert_eq!(
            decide_topic(Some(&state), retract(author())),
            Err(ForumReject::PostRetracted)
        );
    }

    #[test]
    fn edit_and_retract_on_a_locked_topic_are_rejected() {
        let mut state = topic(vec![post()]);
        state.posting_state = PostingState::Locked;
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "fixed", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::TopicLocked)
        );
        assert_eq!(
            decide_topic(Some(&state), retract(author())),
            Err(ForumReject::TopicLocked)
        );
    }

    #[test]
    fn edit_and_retract_on_a_hidden_topic_are_rejected() {
        let mut state = topic(vec![post()]);
        state.visibility = TopicVisibility::Hidden;
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "fixed", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::TopicHidden)
        );
        assert_eq!(
            decide_topic(Some(&state), retract(author())),
            Err(ForumReject::TopicHidden)
        );
    }

    #[test]
    fn unloaded_post_is_not_found_and_missing_topic_is_not_found() {
        let state = topic(Vec::new());
        assert_eq!(
            decide_topic(Some(&state), edit(author(), "fixed", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::PostNotFound)
        );
        assert_eq!(
            decide_topic(Some(&state), retract(author())),
            Err(ForumReject::PostNotFound)
        );
        assert_eq!(
            decide_topic(None, edit(author(), "fixed", 0, SUBMITTED_AT + 1)),
            Err(ForumReject::TopicNotFound)
        );
        assert_eq!(
            decide_topic(None, retract(author())),
            Err(ForumReject::TopicNotFound)
        );
    }

    #[test]
    fn author_retraction_emits_post_retracted_regardless_of_window() {
        let state = topic(vec![post()]);
        let events = decide_topic(Some(&state), retract(author())).unwrap();
        assert_eq!(
            events,
            vec![TopicEvent::PostRetracted {
                source_seq: POST_SEQ
            }]
        );
        assert_eq!(events[0].kind(), POST_RETRACTED);
        assert_eq!(events[0].payload(), serde_json::json!({ "source_seq": POST_SEQ }));
    }

    #[test]
    fn non_author_retraction_is_rejected() {
        let state = topic(vec![post()]);
        assert_eq!(
            decide_topic(Some(&state), retract(stranger())),
            Err(ForumReject::NotAuthor)
        );
    }
}
