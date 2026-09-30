//! Forum command orchestration over explicit transactional context ports.
//!
//! HTTP supplies intent and authenticated principal identity. This application
//! resolves authority, replays canonical forum facts, decides, charges, appends,
//! projects, and commits. Query rows never become the forum write aggregate.

use std::{error::Error, future::Future};

use content_reference::{MentionCandidate, Quotation, QuotationThreadState};
use forum::{DecodedForumEvent, ForumEventRecord, PostingState, TopicVisibility};
use principal::PrincipalId;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionInput {
    pub handle: String,
    pub offset: usize,
    pub len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionProfile {
    pub profile_id: Uuid,
    pub handle: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForumCommand {
    CreateArea {
        area_id: Uuid,
        slug: String,
        title: String,
        description: String,
    },
    CreateTopic {
        topic_id: Uuid,
        area_slug: String,
        title: String,
        body: String,
    },
    SubmitPost {
        topic_id: Uuid,
        body: String,
        quotations: Vec<Quotation>,
        mentions: Vec<MentionInput>,
    },
    EditPost {
        topic_id: Uuid,
        source_seq: i64,
        body: String,
        mentions: Vec<MentionInput>,
        expected_revision: i64,
    },
    RetractPost {
        topic_id: Uuid,
        source_seq: i64,
    },
    SetPostingState {
        topic_id: Uuid,
        posting_state: PostingState,
    },
    SetVisibility {
        topic_id: Uuid,
        visibility: TopicVisibility,
    },
    RenameTopic {
        topic_id: Uuid,
        title: String,
    },
    MoveTopic {
        topic_id: Uuid,
        area_slug: String,
    },
    SetPinned {
        topic_id: Uuid,
        pinned: bool,
    },
}

impl ForumCommand {
    pub fn stream_id(&self) -> Uuid {
        match self {
            Self::CreateArea { area_id, .. } => *area_id,
            Self::CreateTopic { topic_id, .. }
            | Self::SubmitPost { topic_id, .. }
            | Self::EditPost { topic_id, .. }
            | Self::RetractPost { topic_id, .. }
            | Self::SetPostingState { topic_id, .. }
            | Self::SetVisibility { topic_id, .. }
            | Self::RenameTopic { topic_id, .. }
            | Self::MoveTopic { topic_id, .. }
            | Self::SetPinned { topic_id, .. } => *topic_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostingAction {
    CreateTopic,
    SubmitPost,
    EditPost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ForumCommit {
    pub stream_id: Uuid,
    pub stream_version: i64,
    pub last_source_seq: i64,
}

pub trait ForumStore: Sync {
    type Error: Error + Send + Sync + 'static;
    type Transaction: ForumTransaction<Error = Self::Error>;
    fn begin(&self) -> impl Future<Output = Result<Self::Transaction, Self::Error>> + Send;
}

/// Every operation uses the same transaction. Implementations must retain
/// source/authority locks until commit or rollback and fail closed on malformed
/// journal input. Authority ports consult their owning contexts, never HTTP
/// supplied capability flags. Projection work cannot append additional facts.
pub trait ForumTransaction: Send {
    type Error: Error + Send + Sync + 'static;
    /// Acquire the source stream lock before any identity/projection row locks.
    fn load_forum_stream(
        &mut self,
        stream: Uuid,
    ) -> impl Future<Output = Result<Vec<ForumEventRecord>, Self::Error>> + Send;
    /// Resolve an admitted active member's current owned posting profile.
    fn author_profile(
        &mut self,
        principal: PrincipalId,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Error>> + Send;
    fn is_global_moderator(
        &mut self,
        principal: PrincipalId,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;
    /// Resolve an immutable area reservation and validate its canonical stream.
    fn area_by_slug(
        &mut self,
        slug: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Error>> + Send;
    /// Serialize slug uniqueness in an authoritative guard, in this transaction.
    fn reserve_area_slug(
        &mut self,
        area: Uuid,
        slug: &str,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;
    fn public_mention_profile(
        &mut self,
        handle: &str,
    ) -> impl Future<Output = Result<Option<MentionProfile>, Self::Error>> + Send;
    fn quotation_thread(
        &mut self,
        topic: Uuid,
        viewer: PrincipalId,
    ) -> impl Future<Output = Result<QuotationThreadState, Self::Error>> + Send;
    /// The adapter resolves current exemptions itself; no transport-provided standing.
    fn charge_posting(
        &mut self,
        principal: PrincipalId,
        action: PostingAction,
        new_mention_targets: u32,
        now: i64,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
    /// Typed codec append and synchronous projection share this transaction.
    fn append_and_project(
        &mut self,
        stream: Uuid,
        expected_version: i64,
        events: &[DecodedForumEvent],
        actor: PrincipalId,
        occurred_at: i64,
    ) -> impl Future<Output = Result<ForumCommit, Self::Error>> + Send;
    fn commit(self) -> impl Future<Output = Result<(), Self::Error>> + Send;
    fn rollback(self) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

#[derive(Debug, thiserror::Error)]
pub enum ForumApplicationError<E: Error + Send + Sync + 'static> {
    #[error("forum adapter failed: {0}")]
    Port(#[source] E),
    #[error(transparent)]
    Decision(#[from] forum::ForumReject),
    #[error(transparent)]
    Replay(#[from] forum::ForumReplayError),
    #[error("forum posting requires an admitted member with an active owned profile")]
    AuthorRequired,
    #[error("forum administration requires GlobalMod")]
    ModeratorRequired,
    #[error("discussion area was not found")]
    AreaNotFound,
    #[error("discussion area slug is already in use")]
    AreaSlugTaken,
    #[error("discussion area already exists")]
    AreaAlreadyExists,
    #[error("discussion area slug must be 2 to 48 lowercase letters, digits, or hyphens")]
    InvalidAreaSlug,
    #[error("discussion area title must contain 1 to 160 bytes")]
    InvalidAreaTitle,
    #[error("discussion area description must contain 1 to 500 bytes")]
    InvalidAreaDescription,
    #[error("forum append returned an invalid commit identity")]
    InvalidCommit,
}

pub async fn execute<S: ForumStore>(
    store: &S,
    command: ForumCommand,
    principal: PrincipalId,
    now: i64,
) -> Result<ForumCommit, ForumApplicationError<S::Error>> {
    let mut tx = store.begin().await.map_err(ForumApplicationError::Port)?;
    let result = execute_in_transaction(&mut tx, command, principal, now).await;
    match result {
        Ok(receipt) => {
            tx.commit().await.map_err(ForumApplicationError::Port)?;
            Ok(receipt)
        }
        Err(error) => {
            // Await rollback before reporting rejection, including a failure
            // after a partial budget charge or journal/projector write.
            tx.rollback().await.map_err(ForumApplicationError::Port)?;
            Err(error)
        }
    }
}

async fn execute_in_transaction<T: ForumTransaction>(
    tx: &mut T,
    command: ForumCommand,
    principal: PrincipalId,
    now: i64,
) -> Result<ForumCommit, ForumApplicationError<T::Error>> {
    use forum::{
        decide_post, decide_topic, PostBody, PostCommand, PostContent, PostDecisionContext,
        TopicAggregate, TopicCommand, TopicTitle,
    };
    let stream = command.stream_id();
    let records = tx
        .load_forum_stream(stream)
        .await
        .map_err(ForumApplicationError::Port)?;
    if let ForumCommand::CreateArea {
        area_id,
        slug,
        title,
        description,
    } = command
    {
        require_moderator(tx, principal).await?;
        if forum::AreaAggregate::replay(area_id, &records)?
            .state()
            .is_some()
        {
            return Err(ForumApplicationError::AreaAlreadyExists);
        }
        let slug = normalize_area_slug(&slug)?;
        let title = title.trim().to_owned();
        let description = description.trim().to_owned();
        if title.is_empty() || title.len() > 160 {
            return Err(ForumApplicationError::InvalidAreaTitle);
        }
        if description.is_empty() || description.len() > 500 {
            return Err(ForumApplicationError::InvalidAreaDescription);
        }
        if !tx
            .reserve_area_slug(area_id, &slug)
            .await
            .map_err(ForumApplicationError::Port)?
        {
            return Err(ForumApplicationError::AreaSlugTaken);
        }
        return append(
            tx,
            stream,
            0,
            vec![forum::AreaCreated {
                slug,
                title,
                description,
            }
            .into()],
            principal,
            now,
        )
        .await;
    }

    let aggregate = TopicAggregate::replay(stream, &records)?;
    let (events, charge) = match command {
        ForumCommand::CreateTopic {
            topic_id,
            area_slug,
            title,
            body,
        } => {
            let author_profile_id = require_author(tx, principal).await?;
            let area_id = resolve_area(tx, &area_slug).await?;
            let events = decide_topic(
                aggregate.state(),
                TopicCommand::Create {
                    topic_id,
                    area_id,
                    title: TopicTitle::new(&title)?,
                    opening_body: PostBody::new(&body)?,
                    author_profile_id,
                },
            )?;
            (events, Some((PostingAction::CreateTopic, 0)))
        }
        ForumCommand::SubmitPost {
            topic_id,
            body,
            quotations,
            mentions,
        } => {
            let author_profile_id = require_author(tx, principal).await?;
            let candidates = resolve_mentions(tx, &mentions).await?;
            let mut thread = aggregate
                .quotation_thread()
                .ok_or(forum::ForumReject::TopicNotFound)?;
            let visibility = tx
                .quotation_thread(topic_id, principal)
                .await
                .map_err(ForumApplicationError::Port)?;
            let same_thread = visibility.thread == thread.thread;
            let visible_sources: std::collections::BTreeSet<_> = visibility
                .posts
                .iter()
                .filter(|post| post.visible)
                .map(|post| post.source_seq)
                .collect();
            // External publication policy may suppress a canonical post. It
            // cannot supply a fabricated body, edge, or post to quote.
            for post in &mut thread.posts {
                post.visible &= same_thread && visible_sources.contains(&post.source_seq);
            }
            let content =
                PostContent::new(&thread, PostBody::new(&body)?, &quotations, &candidates)?;
            let events = decide_topic(
                aggregate.state(),
                TopicCommand::SubmitPost {
                    content,
                    author_profile_id,
                },
            )?;
            (
                events,
                Some((
                    PostingAction::SubmitPost,
                    new_mention_targets(&candidates, &[]),
                )),
            )
        }
        ForumCommand::EditPost {
            source_seq,
            body,
            mentions,
            expected_revision,
            ..
        } => {
            let author_profile_id = require_author(tx, principal).await?;
            let topic = aggregate.state().ok_or(forum::ForumReject::TopicNotFound)?;
            let post = aggregate
                .post(source_seq)
                .ok_or(forum::ForumReject::PostNotFound)?;
            let candidates = resolve_mentions(tx, &mentions).await?;
            let new_targets = new_mention_targets(&candidates, &post.mentions);
            let events = decide_post(
                PostDecisionContext::new(topic, post)?,
                PostCommand::Edit {
                    body: PostBody::new(&body)?,
                    mentions: candidates,
                    author_profile_id,
                    expected_revision,
                    now,
                },
            )?;
            (events, Some((PostingAction::EditPost, new_targets)))
        }
        ForumCommand::RetractPost { source_seq, .. } => {
            let author_profile_id = require_author(tx, principal).await?;
            let topic = aggregate.state().ok_or(forum::ForumReject::TopicNotFound)?;
            let post = aggregate
                .post(source_seq)
                .ok_or(forum::ForumReject::PostNotFound)?;
            (
                decide_post(
                    PostDecisionContext::new(topic, post)?,
                    PostCommand::Retract { author_profile_id },
                )?,
                None,
            )
        }
        ForumCommand::SetPostingState { posting_state, .. } => {
            require_moderator(tx, principal).await?;
            (
                decide_topic(
                    aggregate.state(),
                    TopicCommand::SetPostingState { posting_state },
                )?,
                None,
            )
        }
        ForumCommand::SetVisibility { visibility, .. } => {
            require_moderator(tx, principal).await?;
            (
                decide_topic(
                    aggregate.state(),
                    TopicCommand::SetVisibility { visibility },
                )?,
                None,
            )
        }
        ForumCommand::RenameTopic { title, .. } => {
            require_moderator(tx, principal).await?;
            (
                decide_topic(
                    aggregate.state(),
                    TopicCommand::Rename {
                        title: TopicTitle::new(&title)?,
                    },
                )?,
                None,
            )
        }
        ForumCommand::MoveTopic { area_slug, .. } => {
            require_moderator(tx, principal).await?;
            let area_id = resolve_area(tx, &area_slug).await?;
            (
                decide_topic(aggregate.state(), TopicCommand::Move { area_id })?,
                None,
            )
        }
        ForumCommand::SetPinned { pinned, .. } => {
            require_moderator(tx, principal).await?;
            (
                decide_topic(aggregate.state(), TopicCommand::SetPinned { pinned })?,
                None,
            )
        }
        ForumCommand::CreateArea { .. } => unreachable!("area commands returned above"),
    };
    if let Some((action, new_targets)) = charge {
        tx.charge_posting(principal, action, new_targets, now)
            .await
            .map_err(ForumApplicationError::Port)?;
    }
    append(
        tx,
        stream,
        aggregate.version(),
        events.into_iter().map(Into::into).collect(),
        principal,
        now,
    )
    .await
}

async fn append<T: ForumTransaction>(
    tx: &mut T,
    stream: Uuid,
    version: i64,
    events: Vec<DecodedForumEvent>,
    principal: PrincipalId,
    now: i64,
) -> Result<ForumCommit, ForumApplicationError<T::Error>> {
    let receipt = tx
        .append_and_project(stream, version, &events, principal, now)
        .await
        .map_err(ForumApplicationError::Port)?;
    let count = i64::try_from(events.len()).map_err(|_| ForumApplicationError::InvalidCommit)?;
    if events.is_empty()
        || receipt.stream_id != stream
        || version.checked_add(count) != Some(receipt.stream_version)
        || receipt.last_source_seq <= 0
    {
        return Err(ForumApplicationError::InvalidCommit);
    }
    Ok(receipt)
}

async fn require_author<T: ForumTransaction>(
    tx: &mut T,
    principal: PrincipalId,
) -> Result<Uuid, ForumApplicationError<T::Error>> {
    tx.author_profile(principal)
        .await
        .map_err(ForumApplicationError::Port)?
        .ok_or(ForumApplicationError::AuthorRequired)
}

async fn require_moderator<T: ForumTransaction>(
    tx: &mut T,
    principal: PrincipalId,
) -> Result<(), ForumApplicationError<T::Error>> {
    if !tx
        .is_global_moderator(principal)
        .await
        .map_err(ForumApplicationError::Port)?
    {
        return Err(ForumApplicationError::ModeratorRequired);
    }
    Ok(())
}

fn normalize_area_slug<E: Error + Send + Sync + 'static>(
    slug: &str,
) -> Result<String, ForumApplicationError<E>> {
    let slug = slug.trim().to_ascii_lowercase();
    if !(2..=48).contains(&slug.len())
        || slug.starts_with('-')
        || slug.ends_with('-')
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(ForumApplicationError::InvalidAreaSlug);
    }
    Ok(slug)
}

async fn resolve_area<T: ForumTransaction>(
    tx: &mut T,
    slug: &str,
) -> Result<Uuid, ForumApplicationError<T::Error>> {
    let slug = normalize_area_slug(slug)?;
    tx.area_by_slug(&slug)
        .await
        .map_err(ForumApplicationError::Port)?
        .ok_or(ForumApplicationError::AreaNotFound)
}

async fn resolve_mentions<T: ForumTransaction>(
    tx: &mut T,
    mentions: &[MentionInput],
) -> Result<Vec<MentionCandidate>, ForumApplicationError<T::Error>> {
    use content_reference::ContentReferenceReject;
    if mentions.len() > content_reference::MAX_MENTIONS_PER_POST {
        return Err(forum::ForumReject::from(ContentReferenceReject::TooManyMentions).into());
    }
    let mut resolved = Vec::with_capacity(mentions.len());
    for mention in mentions {
        let handle = mention.handle.trim().to_ascii_lowercase();
        let profile = tx
            .public_mention_profile(&handle)
            .await
            .map_err(ForumApplicationError::Port)?
            .ok_or(forum::ForumReject::from(
                ContentReferenceReject::UnknownMentionTarget,
            ))?;
        resolved.push(MentionCandidate {
            profile_id: profile.profile_id,
            handle: profile.handle,
            offset: mention.offset,
            len: mention.len,
        });
    }
    Ok(resolved)
}

fn new_mention_targets(
    mentions: &[MentionCandidate],
    previous: &[content_reference::ProfileMention],
) -> u32 {
    let previous: std::collections::BTreeSet<_> =
        previous.iter().map(|mention| mention.profile_id).collect();
    mentions
        .iter()
        .map(|mention| mention.profile_id)
        .filter(|profile| !previous.contains(profile))
        .collect::<std::collections::BTreeSet<_>>()
        .len() as u32
}

#[cfg(test)]
mod tests;
