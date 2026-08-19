//! Pure write model for public community discussions.
//!
//! HTTP, persistence, and projection concerns stay outside this crate. Callers
//! load a topic state, ask the aggregate to decide a typed command, then append
//! the returned typed events against the state's expected version.

mod embed;

pub use embed::{
    attach_embed_snapshot, decide_post_embed, embed_from_payload, embed_payload,
    parse_youtube_embed, snapshot_from_oembed, validate_embed_snapshot, youtube_oembed_query,
    EmbedPoster, EmbedProvider, EmbedSnapshot, PostEmbed, YoutubeOembedQuery, YOUTUBE_EMBED_ORIGIN,
    YOUTUBE_OEMBED_ORIGIN, YOUTUBE_OEMBED_PATH,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const AREA_CREATED: &str = "DiscussionAreaCreated";
pub const TOPIC_CREATED: &str = "DiscussionTopicCreated";
pub const POST_SUBMITTED: &str = "DiscussionPostSubmitted";
pub const POSTING_STATE_CHANGED: &str = "DiscussionTopicPostingStateChanged";
pub const VISIBILITY_CHANGED: &str = "DiscussionTopicVisibilityChanged";
pub const MODERATION_CASE_OPENED: &str = "ModerationCaseOpened";
pub const MODERATION_REPORT_SUBMITTED: &str = "ModerationReportSubmitted";
pub const MODERATION_CONTENT_HIDDEN: &str = "ModerationContentHidden";
pub const MODERATION_CASE_DISMISSED: &str = "ModerationCaseDismissed";
pub const MODERATION_CONTENT_RESTORED: &str = "ModerationContentRestored";
pub const SUBSCRIPTION_ENABLED: &str = "CommunitySubscriptionEnabled";
pub const SUBSCRIPTION_DISABLED: &str = "CommunitySubscriptionDisabled";
pub const SUBSCRIPTION_READ_ADVANCED: &str = "CommunitySubscriptionReadAdvanced";
pub const MEMBER_MUTED: &str = "CommunityMemberMuted";
pub const MEMBER_UNMUTED: &str = "CommunityMemberUnmuted";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberMuteState {
    pub relationship_id: Uuid,
    pub principal_user_id: String,
    pub target_profile_id: Uuid,
    pub active: bool,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberMuteCommand {
    Mute { target_profile_id: Uuid },
    Unmute,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberMuteEvent {
    Muted { target_profile_id: Uuid },
    Unmuted,
}

impl MemberMuteEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Muted { .. } => MEMBER_MUTED,
            Self::Unmuted => MEMBER_UNMUTED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Muted { target_profile_id } => {
                serde_json::json!({ "target_profile_id": target_profile_id })
            }
            Self::Unmuted => serde_json::json!({}),
        }
    }
}

pub fn decide_member_mute(
    state: Option<&MemberMuteState>,
    command: MemberMuteCommand,
) -> Result<Vec<MemberMuteEvent>, CommunityReject> {
    match (state, command) {
        (None, MemberMuteCommand::Mute { target_profile_id }) => {
            Ok(vec![MemberMuteEvent::Muted { target_profile_id }])
        }
        (Some(state), MemberMuteCommand::Mute { target_profile_id }) => {
            if state.target_profile_id != target_profile_id {
                return Err(CommunityReject::InvalidMuteTarget);
            }
            if state.active {
                return Err(CommunityReject::AlreadyMuted);
            }
            Ok(vec![MemberMuteEvent::Muted { target_profile_id }])
        }
        (None, MemberMuteCommand::Unmute) => Err(CommunityReject::MuteNotFound),
        (Some(state), MemberMuteCommand::Unmute) => {
            if !state.active {
                return Err(CommunityReject::NotMuted);
            }
            Ok(vec![MemberMuteEvent::Unmuted])
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionTargetKind {
    DiscussionTopic,
    GameThread,
}

impl SubscriptionTargetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DiscussionTopic => "discussion_topic",
            Self::GameThread => "game_thread",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "discussion_topic" => Ok(Self::DiscussionTopic),
            "game_thread" => Ok(Self::GameThread),
            _ => Err(CommunityReject::InvalidSubscriptionTarget),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscriptionTarget {
    pub kind: SubscriptionTargetKind,
    pub scope_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionState {
    pub subscription_id: Uuid,
    pub principal_user_id: String,
    pub target: SubscriptionTarget,
    pub active: bool,
    pub read_through_seq: i64,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubscriptionCommand {
    Subscribe {
        target: SubscriptionTarget,
        initial_read_through_seq: i64,
    },
    Unsubscribe,
    AdvanceRead {
        read_through_seq: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubscriptionEvent {
    Enabled {
        target: SubscriptionTarget,
        initial_read_through_seq: i64,
    },
    Disabled,
    ReadAdvanced {
        read_through_seq: i64,
    },
}

impl SubscriptionEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Enabled { .. } => SUBSCRIPTION_ENABLED,
            Self::Disabled => SUBSCRIPTION_DISABLED,
            Self::ReadAdvanced { .. } => SUBSCRIPTION_READ_ADVANCED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Enabled {
                target,
                initial_read_through_seq,
            } => serde_json::json!({
                "target": target,
                "initial_read_through_seq": initial_read_through_seq,
            }),
            Self::Disabled => serde_json::json!({}),
            Self::ReadAdvanced { read_through_seq } => {
                serde_json::json!({ "read_through_seq": read_through_seq })
            }
        }
    }
}

pub fn decide_subscription(
    state: Option<&SubscriptionState>,
    command: SubscriptionCommand,
) -> Result<Vec<SubscriptionEvent>, CommunityReject> {
    match (state, command) {
        (
            None,
            SubscriptionCommand::Subscribe {
                target,
                initial_read_through_seq,
            },
        ) => Ok(vec![SubscriptionEvent::Enabled {
            target,
            initial_read_through_seq,
        }]),
        (
            Some(state),
            SubscriptionCommand::Subscribe {
                target,
                initial_read_through_seq,
            },
        ) => {
            if state.active {
                return Err(CommunityReject::AlreadySubscribed);
            }
            if state.target != target {
                return Err(CommunityReject::InvalidSubscriptionTarget);
            }
            Ok(vec![SubscriptionEvent::Enabled {
                target,
                initial_read_through_seq: initial_read_through_seq.max(state.read_through_seq),
            }])
        }
        (None, _) => Err(CommunityReject::SubscriptionNotFound),
        (Some(state), SubscriptionCommand::Unsubscribe) => {
            if !state.active {
                return Err(CommunityReject::NotSubscribed);
            }
            Ok(vec![SubscriptionEvent::Disabled])
        }
        (Some(state), SubscriptionCommand::AdvanceRead { read_through_seq }) => {
            if !state.active {
                return Err(CommunityReject::NotSubscribed);
            }
            if read_through_seq <= state.read_through_seq {
                return Err(CommunityReject::ReadCursorMustAdvance);
            }
            Ok(vec![SubscriptionEvent::ReadAdvanced { read_through_seq }])
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationTargetKind {
    DiscussionPost,
    GamePost,
}

impl ModerationTargetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DiscussionPost => "discussion_post",
            Self::GamePost => "game_post",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "discussion_post" => Ok(Self::DiscussionPost),
            "game_post" => Ok(Self::GamePost),
            _ => Err(CommunityReject::InvalidModerationTarget),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModerationTarget {
    pub kind: ModerationTargetKind,
    pub scope_id: Uuid,
    pub source_seq: i64,
}

/// Public post identity. Same triple as [`ModerationTarget`].
pub type PostKind = ModerationTargetKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostRef {
    pub kind: PostKind,
    pub scope_id: Uuid,
    pub source_seq: i64,
}

impl PostRef {
    pub fn thread(kind: PostKind, scope_id: Uuid) -> Self {
        Self {
            kind,
            scope_id,
            source_seq: 0,
        }
    }

    pub fn same_thread_as(&self, thread: &PostRef) -> bool {
        self.kind == thread.kind && self.scope_id == thread.scope_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quotation {
    pub target: PostRef,
    pub excerpt: String,
}

/// One already-committed post in the thread being posted to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotationPostState {
    pub source_seq: i64,
    pub body: String,
    pub visible: bool,
    pub outgoing: Vec<PostRef>,
}

/// Loaded same-thread posts used to decide quotations. Adapters populate this
/// from the projection; [`decide_quotations`] stays pure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotationThreadState {
    pub thread: PostRef,
    pub posts: Vec<QuotationPostState>,
}

pub const MAX_QUOTATIONS_PER_POST: usize = 8;
pub const MAX_QUOTATION_CHAIN_DEPTH: usize = 8;
pub const MAX_QUOTATION_EXCERPT_BYTES: usize = 1_000;
pub const DEFAULT_POST_CITATION_LIMIT: i64 = 5;
pub const MAX_POST_CITATION_LIMIT: i64 = 20;

/// Decide the quotations a new post may carry. Missing, hidden, muted, and
/// foreign-thread targets all collapse to [`CommunityReject::QuotationNotFound`]
/// so the write model does not leak existence.
pub fn decide_quotations(
    thread: &QuotationThreadState,
    quotations: &[Quotation],
) -> Result<Vec<Quotation>, CommunityReject> {
    if quotations.is_empty() {
        return Ok(Vec::new());
    }
    if quotations.len() > MAX_QUOTATIONS_PER_POST {
        return Err(CommunityReject::TooManyQuotations);
    }
    let mut seen = Vec::with_capacity(quotations.len());
    let mut decided = Vec::with_capacity(quotations.len());
    for quotation in quotations {
        if !quotation.target.same_thread_as(&thread.thread) {
            return Err(CommunityReject::InvalidQuotationTarget);
        }
        if seen
            .iter()
            .any(|target: &PostRef| target == &quotation.target)
        {
            return Err(CommunityReject::DuplicateQuotation);
        }
        seen.push(quotation.target.clone());
        let post = thread
            .posts
            .iter()
            .find(|post| post.source_seq == quotation.target.source_seq && post.visible)
            .ok_or(CommunityReject::QuotationNotFound)?;
        validate_quotation_excerpt(quotation.excerpt.as_str(), post.body.as_str())?;
        if quotation_chain_depth(quotation.target.source_seq, thread) + 1
            > MAX_QUOTATION_CHAIN_DEPTH
        {
            return Err(CommunityReject::QuotationChainTooDeep);
        }
        decided.push(Quotation {
            target: quotation.target.clone(),
            excerpt: quotation.excerpt.clone(),
        });
    }
    Ok(decided)
}

fn validate_quotation_excerpt(excerpt: &str, body: &str) -> Result<(), CommunityReject> {
    if excerpt.is_empty()
        || excerpt.len() > MAX_QUOTATION_EXCERPT_BYTES
        || excerpt.chars().all(char::is_whitespace)
        || !body.contains(excerpt)
    {
        return Err(CommunityReject::InvalidQuotationExcerpt);
    }
    Ok(())
}

fn quotation_chain_depth(source_seq: i64, thread: &QuotationThreadState) -> usize {
    fn depth_from(
        source_seq: i64,
        thread: &QuotationThreadState,
        visiting: &mut Vec<i64>,
    ) -> usize {
        if visiting.contains(&source_seq) {
            return 0;
        }
        let Some(post) = thread
            .posts
            .iter()
            .find(|post| post.source_seq == source_seq)
        else {
            return 0;
        };
        if post.outgoing.is_empty() {
            return 0;
        }
        visiting.push(source_seq);
        let child = post
            .outgoing
            .iter()
            .filter(|target| target.same_thread_as(&thread.thread))
            .map(|target| depth_from(target.source_seq, thread, visiting))
            .max()
            .unwrap_or(0);
        visiting.pop();
        1 + child
    }
    depth_from(source_seq, thread, &mut Vec::new())
}

/// Parse the additive `quotations` field. Absent, null, or `[]` is none.
pub fn quotations_from_payload(
    payload: &serde_json::Value,
) -> Result<Vec<Quotation>, serde_json::Error> {
    match payload.get("quotations") {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()),
    }
}

pub fn quotations_payload(quotations: &[Quotation]) -> Option<serde_json::Value> {
    if quotations.is_empty() {
        None
    } else {
        Some(serde_json::to_value(quotations).expect("quotations serialize"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportReasonFamily {
    Spam,
    Harassment,
    Hate,
    SexualContent,
    SelfHarm,
    Other,
}

impl ReportReasonFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Spam => "spam",
            Self::Harassment => "harassment",
            Self::Hate => "hate",
            Self::SexualContent => "sexual_content",
            Self::SelfHarm => "self_harm",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "spam" => Ok(Self::Spam),
            "harassment" => Ok(Self::Harassment),
            "hate" => Ok(Self::Hate),
            "sexual_content" => Ok(Self::SexualContent),
            "self_harm" => Ok(Self::SelfHarm),
            "other" => Ok(Self::Other),
            _ => Err(CommunityReject::InvalidReportReason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationCaseStatus {
    Open,
    Hidden,
    Dismissed,
    Restored,
}

impl ModerationCaseStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Hidden => "hidden",
            Self::Dismissed => "dismissed",
            Self::Restored => "restored",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value {
            "open" => Ok(Self::Open),
            "hidden" => Ok(Self::Hidden),
            "dismissed" => Ok(Self::Dismissed),
            "restored" => Ok(Self::Restored),
            _ => Err(CommunityReject::InvalidModerationCaseStatus),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerationCaseState {
    pub case_id: Uuid,
    pub target: ModerationTarget,
    pub status: ModerationCaseStatus,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationCommand {
    OpenReport {
        target: ModerationTarget,
        report_id: Uuid,
        reason: ReportReasonFamily,
        details: String,
    },
    SubmitReport {
        report_id: Uuid,
        reason: ReportReasonFamily,
        details: String,
    },
    Hide {
        reason: String,
    },
    Dismiss {
        reason: String,
    },
    Restore {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationEvent {
    CaseOpened {
        target: ModerationTarget,
    },
    ReportSubmitted {
        report_id: Uuid,
        reason: ReportReasonFamily,
        details: String,
    },
    ContentHidden {
        reason: String,
    },
    CaseDismissed {
        reason: String,
    },
    ContentRestored {
        reason: String,
    },
}

impl ModerationEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::CaseOpened { .. } => MODERATION_CASE_OPENED,
            Self::ReportSubmitted { .. } => MODERATION_REPORT_SUBMITTED,
            Self::ContentHidden { .. } => MODERATION_CONTENT_HIDDEN,
            Self::CaseDismissed { .. } => MODERATION_CASE_DISMISSED,
            Self::ContentRestored { .. } => MODERATION_CONTENT_RESTORED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::CaseOpened { target } => serde_json::json!({ "target": target }),
            Self::ReportSubmitted {
                report_id,
                reason,
                details,
            } => serde_json::json!({
                "report_id": report_id,
                "reason": reason.as_str(),
                "details": details,
            }),
            Self::ContentHidden { reason }
            | Self::CaseDismissed { reason }
            | Self::ContentRestored { reason } => serde_json::json!({ "reason": reason }),
        }
    }
}

pub fn decide_moderation(
    state: Option<&ModerationCaseState>,
    command: ModerationCommand,
) -> Result<Vec<ModerationEvent>, CommunityReject> {
    match (state, command) {
        (
            None,
            ModerationCommand::OpenReport {
                target,
                report_id,
                reason,
                details,
            },
        ) => Ok(vec![
            ModerationEvent::CaseOpened { target },
            ModerationEvent::ReportSubmitted {
                report_id,
                reason,
                details,
            },
        ]),
        (Some(_), ModerationCommand::OpenReport { .. }) => {
            Err(CommunityReject::ModerationCaseAlreadyExists)
        }
        (None, _) => Err(CommunityReject::ModerationCaseNotFound),
        (
            Some(state),
            ModerationCommand::SubmitReport {
                report_id,
                reason,
                details,
            },
        ) => {
            if state.status == ModerationCaseStatus::Hidden {
                return Err(CommunityReject::ModerationTargetHidden);
            }
            Ok(vec![ModerationEvent::ReportSubmitted {
                report_id,
                reason,
                details,
            }])
        }
        (Some(state), ModerationCommand::Hide { reason }) => {
            if state.status != ModerationCaseStatus::Open {
                return Err(CommunityReject::InvalidModerationTransition);
            }
            Ok(vec![ModerationEvent::ContentHidden { reason }])
        }
        (Some(state), ModerationCommand::Dismiss { reason }) => {
            if state.status != ModerationCaseStatus::Open {
                return Err(CommunityReject::InvalidModerationTransition);
            }
            Ok(vec![ModerationEvent::CaseDismissed { reason }])
        }
        (Some(state), ModerationCommand::Restore { reason }) => {
            if state.status != ModerationCaseStatus::Hidden {
                return Err(CommunityReject::InvalidModerationTransition);
            }
            Ok(vec![ModerationEvent::ContentRestored { reason }])
        }
    }
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
        serde_json::json!({
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
        })
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

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "open" => Ok(Self::Open),
            "locked" => Ok(Self::Locked),
            _ => Err(CommunityReject::InvalidPostingState),
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

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "visible" => Ok(Self::Visible),
            "hidden" => Ok(Self::Hidden),
            _ => Err(CommunityReject::InvalidVisibility),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicState {
    pub topic_id: Uuid,
    pub area_id: Uuid,
    pub posting_state: PostingState,
    pub visibility: TopicVisibility,
    pub version: i64,
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
            } => serde_json::json!({
                "area_id": area_id,
                "title": title,
                "author_profile_id": author_profile_id,
            }),
            Self::PostSubmitted {
                body,
                author_profile_id,
                quotations,
            } => {
                let mut payload = serde_json::json!({
                    "body": body,
                    "author_profile_id": author_profile_id,
                });
                if let Some(quotations) = quotations_payload(quotations) {
                    payload["quotations"] = quotations;
                }
                payload
            }
            Self::PostingStateChanged { posting_state } => {
                serde_json::json!({ "posting_state": posting_state.as_str() })
            }
            Self::VisibilityChanged { visibility } => {
                serde_json::json!({ "visibility": visibility.as_str() })
            }
        }
    }
}

pub fn decide_topic(
    state: Option<&TopicState>,
    command: TopicCommand,
) -> Result<Vec<TopicEvent>, CommunityReject> {
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
            },
        ]),
        (Some(_), TopicCommand::Create { .. }) => Err(CommunityReject::TopicAlreadyExists),
        (None, _) => Err(CommunityReject::TopicNotFound),
        (
            Some(state),
            TopicCommand::SubmitPost {
                body,
                author_profile_id,
                quotations,
            },
        ) => {
            if state.visibility != TopicVisibility::Visible {
                return Err(CommunityReject::TopicHidden);
            }
            if state.posting_state != PostingState::Open {
                return Err(CommunityReject::TopicLocked);
            }
            Ok(vec![TopicEvent::PostSubmitted {
                body,
                author_profile_id,
                quotations,
            }])
        }
        (Some(state), TopicCommand::SetPostingState { posting_state }) => {
            if state.posting_state == posting_state {
                return Err(CommunityReject::NoStateChange);
            }
            Ok(vec![TopicEvent::PostingStateChanged { posting_state }])
        }
        (Some(state), TopicCommand::SetVisibility { visibility }) => {
            if state.visibility == visibility {
                return Err(CommunityReject::NoStateChange);
            }
            Ok(vec![TopicEvent::VisibilityChanged { visibility }])
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommunityReject {
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
    #[error("moderation target must be a public discussion_post or game_post")]
    InvalidModerationTarget,
    #[error("report reason family is invalid")]
    InvalidReportReason,
    #[error("moderation case status is invalid")]
    InvalidModerationCaseStatus,
    #[error("moderation case already exists")]
    ModerationCaseAlreadyExists,
    #[error("moderation case was not found")]
    ModerationCaseNotFound,
    #[error("moderation target is already hidden")]
    ModerationTargetHidden,
    #[error("moderation action is invalid for the current case status")]
    InvalidModerationTransition,
    #[error("subscription target must be a public discussion_topic or game_thread")]
    InvalidSubscriptionTarget,
    #[error("subscription was not found")]
    SubscriptionNotFound,
    #[error("member is already subscribed")]
    AlreadySubscribed,
    #[error("member is not subscribed")]
    NotSubscribed,
    #[error("subscription read cursor must advance monotonically")]
    ReadCursorMustAdvance,
    #[error("mute target is invalid")]
    InvalidMuteTarget,
    #[error("member is already muted")]
    AlreadyMuted,
    #[error("mute relationship was not found")]
    MuteNotFound,
    #[error("member is not muted")]
    NotMuted,
    #[error("quotation target is not in this thread")]
    InvalidQuotationTarget,
    #[error("quoted post was not found")]
    QuotationNotFound,
    #[error("quotation excerpt is invalid")]
    InvalidQuotationExcerpt,
    #[error("post carries too many quotations")]
    TooManyQuotations,
    #[error("quotation chain exceeds the depth cap")]
    QuotationChainTooDeep,
    #[error("post quotes the same target more than once")]
    DuplicateQuotation,
    #[error("post embed is not a main-thread YouTube URL")]
    InvalidEmbed,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> TopicState {
        TopicState {
            topic_id: Uuid::from_u128(1),
            area_id: Uuid::from_u128(2),
            posting_state: PostingState::Open,
            visibility: TopicVisibility::Visible,
            version: 2,
        }
    }

    #[test]
    fn locked_and_hidden_topics_reject_posts() {
        let profile = Uuid::from_u128(3);
        let mut locked = state();
        locked.posting_state = PostingState::Locked;
        assert_eq!(
            decide_topic(
                Some(&locked),
                TopicCommand::SubmitPost {
                    body: "late".into(),
                    author_profile_id: profile,
                    quotations: Vec::new(),
                },
            ),
            Err(CommunityReject::TopicLocked)
        );
        let mut hidden = state();
        hidden.visibility = TopicVisibility::Hidden;
        assert_eq!(
            decide_topic(
                Some(&hidden),
                TopicCommand::SubmitPost {
                    body: "late".into(),
                    author_profile_id: profile,
                    quotations: Vec::new(),
                },
            ),
            Err(CommunityReject::TopicHidden)
        );
    }

    #[test]
    fn moderation_axes_are_independent() {
        let state = state();
        assert!(matches!(
            decide_topic(
                Some(&state),
                TopicCommand::SetPostingState {
                    posting_state: PostingState::Locked
                }
            )
            .unwrap()
            .as_slice(),
            [TopicEvent::PostingStateChanged { .. }]
        ));
        assert!(matches!(
            decide_topic(
                Some(&state),
                TopicCommand::SetVisibility {
                    visibility: TopicVisibility::Hidden
                }
            )
            .unwrap()
            .as_slice(),
            [TopicEvent::VisibilityChanged { .. }]
        ));
    }

    #[test]
    fn moderation_case_transitions_are_explicit_and_restorable() {
        let target = ModerationTarget {
            kind: ModerationTargetKind::DiscussionPost,
            scope_id: Uuid::from_u128(20),
            source_seq: 9,
        };
        let opened = decide_moderation(
            None,
            ModerationCommand::OpenReport {
                target: target.clone(),
                report_id: Uuid::from_u128(22),
                reason: ReportReasonFamily::Spam,
                details: "repeated links".into(),
            },
        )
        .unwrap();
        assert!(matches!(
            opened.as_slice(),
            [
                ModerationEvent::CaseOpened { .. },
                ModerationEvent::ReportSubmitted { .. }
            ]
        ));

        let mut state = ModerationCaseState {
            case_id: Uuid::from_u128(21),
            target,
            status: ModerationCaseStatus::Open,
            version: 2,
        };
        assert!(matches!(
            decide_moderation(Some(&state), ModerationCommand::Hide { reason: "spam".into() }),
            Ok(events) if matches!(events.as_slice(), [ModerationEvent::ContentHidden { .. }])
        ));
        state.status = ModerationCaseStatus::Hidden;
        assert!(matches!(
            decide_moderation(Some(&state), ModerationCommand::Restore { reason: "appeal accepted".into() }),
            Ok(events) if matches!(events.as_slice(), [ModerationEvent::ContentRestored { .. }])
        ));
        assert_eq!(
            decide_moderation(
                Some(&state),
                ModerationCommand::Dismiss {
                    reason: "no violation".into()
                }
            ),
            Err(CommunityReject::InvalidModerationTransition)
        );
    }

    #[test]
    fn subscription_membership_and_read_cursor_are_explicit() {
        let target = SubscriptionTarget {
            kind: SubscriptionTargetKind::DiscussionTopic,
            scope_id: Uuid::from_u128(31),
        };
        assert!(matches!(
            decide_subscription(
                None,
                SubscriptionCommand::Subscribe {
                    target: target.clone(),
                    initial_read_through_seq: 8,
                },
            ),
            Ok(events) if matches!(events.as_slice(), [SubscriptionEvent::Enabled { initial_read_through_seq: 8, .. }])
        ));

        let mut state = SubscriptionState {
            subscription_id: Uuid::from_u128(32),
            principal_user_id: "member-a".into(),
            target: target.clone(),
            active: true,
            read_through_seq: 8,
            version: 1,
        };
        assert!(matches!(
            decide_subscription(
                Some(&state),
                SubscriptionCommand::AdvanceRead {
                    read_through_seq: 11,
                },
            ),
            Ok(events) if matches!(events.as_slice(), [SubscriptionEvent::ReadAdvanced { read_through_seq: 11 }])
        ));
        assert_eq!(
            decide_subscription(
                Some(&state),
                SubscriptionCommand::AdvanceRead {
                    read_through_seq: 8
                },
            ),
            Err(CommunityReject::ReadCursorMustAdvance)
        );
        assert!(matches!(
            decide_subscription(Some(&state), SubscriptionCommand::Unsubscribe),
            Ok(events) if matches!(events.as_slice(), [SubscriptionEvent::Disabled])
        ));

        state.active = false;
        assert!(matches!(
            decide_subscription(
                Some(&state),
                SubscriptionCommand::Subscribe {
                    target,
                    initial_read_through_seq: 14,
                },
            ),
            Ok(events) if matches!(events.as_slice(), [SubscriptionEvent::Enabled { initial_read_through_seq: 14, .. }])
        ));
    }

    #[test]
    fn member_mutes_are_private_reversible_relationships() {
        let target_profile_id = Uuid::from_u128(41);
        assert_eq!(
            decide_member_mute(None, MemberMuteCommand::Mute { target_profile_id },),
            Ok(vec![MemberMuteEvent::Muted { target_profile_id }])
        );

        let mut state = MemberMuteState {
            relationship_id: Uuid::from_u128(42),
            principal_user_id: "member-a".into(),
            target_profile_id,
            active: true,
            version: 1,
        };
        assert_eq!(
            decide_member_mute(Some(&state), MemberMuteCommand::Mute { target_profile_id }),
            Err(CommunityReject::AlreadyMuted)
        );
        assert_eq!(
            decide_member_mute(Some(&state), MemberMuteCommand::Unmute),
            Ok(vec![MemberMuteEvent::Unmuted])
        );

        state.active = false;
        assert_eq!(
            decide_member_mute(Some(&state), MemberMuteCommand::Unmute),
            Err(CommunityReject::NotMuted)
        );
        assert_eq!(
            decide_member_mute(Some(&state), MemberMuteCommand::Mute { target_profile_id }),
            Ok(vec![MemberMuteEvent::Muted { target_profile_id }])
        );
    }

    fn topic_id() -> Uuid {
        Uuid::from_u128(40)
    }

    fn thread_state(posts: Vec<QuotationPostState>) -> QuotationThreadState {
        QuotationThreadState {
            thread: PostRef::thread(PostKind::DiscussionPost, topic_id()),
            posts,
        }
    }

    fn visible_post(source_seq: i64, body: &str, outgoing: Vec<i64>) -> QuotationPostState {
        QuotationPostState {
            source_seq,
            body: body.into(),
            visible: true,
            outgoing: outgoing
                .into_iter()
                .map(|source_seq| PostRef {
                    kind: PostKind::DiscussionPost,
                    scope_id: topic_id(),
                    source_seq,
                })
                .collect(),
        }
    }

    fn quote(source_seq: i64, excerpt: &str) -> Quotation {
        Quotation {
            target: PostRef {
                kind: PostKind::DiscussionPost,
                scope_id: topic_id(),
                source_seq,
            },
            excerpt: excerpt.into(),
        }
    }

    #[test]
    fn quotations_are_optional_and_same_thread_excerpts_are_accepted() {
        let thread = thread_state(vec![visible_post(4, "Alpha signal analysis", vec![])]);
        assert_eq!(decide_quotations(&thread, &[]), Ok(Vec::new()));
        assert_eq!(
            decide_quotations(&thread, &[quote(4, "Alpha signal")]),
            Ok(vec![quote(4, "Alpha signal")])
        );
    }

    #[test]
    fn quotation_reject_matrix_does_not_leak_hidden_or_foreign_posts() {
        let mut hidden = visible_post(5, "secret claim", vec![]);
        hidden.visible = false;
        let thread = thread_state(vec![
            visible_post(4, "Alpha signal analysis", vec![]),
            hidden,
        ]);

        assert_eq!(
            decide_quotations(
                &thread,
                &[Quotation {
                    target: PostRef {
                        kind: PostKind::GamePost,
                        scope_id: topic_id(),
                        source_seq: 4,
                    },
                    excerpt: "Alpha".into(),
                }]
            ),
            Err(CommunityReject::InvalidQuotationTarget)
        );
        assert_eq!(
            decide_quotations(&thread, &[quote(99, "missing")]),
            Err(CommunityReject::QuotationNotFound)
        );
        assert_eq!(
            decide_quotations(&thread, &[quote(5, "secret")]),
            Err(CommunityReject::QuotationNotFound)
        );
        assert_eq!(
            decide_quotations(&thread, &[quote(4, ""), quote(4, "Alpha")]),
            Err(CommunityReject::InvalidQuotationExcerpt)
        );
        assert_eq!(
            decide_quotations(&thread, &[quote(4, "not in the body")]),
            Err(CommunityReject::InvalidQuotationExcerpt)
        );
        assert_eq!(
            decide_quotations(&thread, &[quote(4, "Alpha"), quote(4, "signal")]),
            Err(CommunityReject::DuplicateQuotation)
        );
        let too_many: Vec<_> = (0..MAX_QUOTATIONS_PER_POST + 1)
            .map(|_| quote(4, "Alpha"))
            .collect();
        assert_eq!(
            decide_quotations(&thread, &too_many),
            Err(CommunityReject::TooManyQuotations)
        );
    }

    #[test]
    fn quotation_chain_depth_counts_the_new_edge() {
        let mut posts = vec![visible_post(1, "root claim", vec![])];
        for seq in 2..=8 {
            posts.push(visible_post(seq, "link", vec![seq - 1]));
        }
        posts.push(visible_post(9, "too deep", vec![8]));
        let thread = thread_state(posts);
        assert_eq!(
            decide_quotations(&thread, &[quote(8, "link")]),
            Ok(vec![quote(8, "link")])
        );
        assert_eq!(
            decide_quotations(&thread, &[quote(9, "too")]),
            Err(CommunityReject::QuotationChainTooDeep)
        );
    }

    #[test]
    fn missing_quotations_payload_upcasts_to_empty() {
        assert_eq!(
            quotations_from_payload(&serde_json::json!({ "body": "hello" })).unwrap(),
            Vec::<Quotation>::new()
        );
        assert_eq!(
            quotations_from_payload(&serde_json::json!({ "quotations": null })).unwrap(),
            Vec::<Quotation>::new()
        );
    }
}
