//! PostgreSQL implementation of the forum application's transaction ports.
//! Source locks precede authority/attention locks. Only the application commits.

use event_actor::ActorId;
use eventstore::journal::{self, EventToAppend, ExpectedVersion, StreamId};
use forum_application::{ForumCommit, ForumStore, ForumTransaction, MentionProfile, PostingAction};
use forum_journal::ForumCodec;
use principal::PrincipalId;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ForumPostgresError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Journal(#[from] journal::JournalError),
    #[error(transparent)]
    Projection(#[from] projections::ProjectionError),
    #[error(transparent)]
    Identity(#[from] identity::IdentityFlowError),
    #[error(transparent)]
    Membership(#[from] membership_application::MembershipApplicationError),
    #[error(transparent)]
    Profile(#[from] profile_application::ProfileApplicationError),
    #[error(transparent)]
    Replay(#[from] forum::ForumReplayError),
    #[error("forum writing requires active community membership")]
    MembershipRequired,
    #[error("the canonical source is a game stream, not a forum topic")]
    NotForumStream,
    #[error("forum area reservation disagrees with its canonical stream")]
    InvalidAreaReservation,
}

pub struct PgForumStore {
    pool: PgPool,
    posting: projections::PostingAdmission,
    authorization: identity::AuthorizationContext,
    policy: identity::SessionPolicy,
    now: i64,
}

impl PgForumStore {
    pub fn new(
        pool: PgPool,
        posting: projections::PostingAdmission,
        authorization: identity::AuthorizationContext,
        policy: identity::SessionPolicy,
        now: i64,
    ) -> Self {
        Self {
            pool,
            posting,
            authorization,
            policy,
            now,
        }
    }
}

pub struct PgForumTransaction {
    tx: Transaction<'static, Postgres>,
    posting: projections::PostingAdmission,
    authorization: identity::AuthorizationContext,
    policy: identity::SessionPolicy,
    now: i64,
    authority_locked: bool,
}

impl ForumStore for PgForumStore {
    type Error = ForumPostgresError;
    type Transaction = PgForumTransaction;
    async fn begin(&self) -> Result<Self::Transaction, Self::Error> {
        Ok(PgForumTransaction {
            tx: self.pool.begin().await?,
            posting: self.posting.clone(),
            authorization: self.authorization.clone(),
            policy: self.policy.clone(),
            now: self.now,
            authority_locked: false,
        })
    }
}

impl PgForumTransaction {
    async fn lock_authority(&mut self, principal: PrincipalId) -> Result<(), ForumPostgresError> {
        if self.authorization.principal_id() != principal {
            return Err(identity::IdentityFlowError::Unauthorized.into());
        }
        if !self.authority_locked {
            identity::session::lock_live_delivery_cutoff_gates(&mut self.tx, &principal).await?;
            self.authorization = identity::session::validate_session_reference_for_delivery(
                &mut self.tx,
                self.authorization.session_reference(),
                &self.policy,
                self.now,
            )
            .await?;
            self.authority_locked = true;
        }
        Ok(())
    }
}

impl ForumTransaction for PgForumTransaction {
    type Error = ForumPostgresError;

    async fn load_forum_stream(
        &mut self,
        stream: Uuid,
    ) -> Result<Vec<forum::ForumEventRecord>, Self::Error> {
        journal::lock_stream_in_tx(&mut self.tx, StreamId::new(stream)).await?;
        let source = eventstore::load_stream_in_tx(&mut self.tx, stream)
            .await
            .map_err(journal::JournalError::Store)?;
        if source.first().is_some_and(|event| {
            event.stream_seq == 1
                && event.kind == "GameCreated"
                && event.meta.get(journal::CONTEXT_META_KEY).is_none()
        }) {
            return Err(ForumPostgresError::NotForumStream);
        }
        source
            .iter()
            .map(|event| {
                journal::decode::<ForumCodec>(event)
                    .map(forum_journal::replay_record)
                    .map_err(ForumPostgresError::Journal)
            })
            .collect()
    }

    async fn author_profile(
        &mut self,
        principal: PrincipalId,
    ) -> Result<Option<Uuid>, Self::Error> {
        self.lock_authority(principal).await?;
        if membership_application::active_membership_in_tx(&mut self.tx, principal)
            .await?
            .is_none()
        {
            return Err(ForumPostgresError::MembershipRequired);
        }
        Ok(
            profile_application::public_posting_profile_in_tx(&mut self.tx, principal)
                .await?
                .map(|profile| profile.as_uuid()),
        )
    }

    async fn is_global_moderator(&mut self, principal: PrincipalId) -> Result<bool, Self::Error> {
        self.lock_authority(principal).await?;
        Ok(self
            .authorization
            .global_capabilities()
            .iter()
            .any(|capability| matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod")))
    }

    async fn area_by_slug(&mut self, slug: &str) -> Result<Option<Uuid>, Self::Error> {
        let area = sqlx::query_scalar::<_, Uuid>(
            "SELECT area_id FROM forum_area_reservation WHERE slug = $1",
        )
        .bind(slug)
        .fetch_optional(&mut *self.tx)
        .await?;
        let Some(area) = area else {
            return Ok(None);
        };
        // Areas are immutable. Do not acquire a second source lock after the
        // topic lock: validated immutable facts need no mutable write fence.
        let events: Vec<_> = journal::load_in_tx::<ForumCodec>(&mut self.tx, StreamId::new(area))
            .await?
            .into_iter()
            .map(forum_journal::replay_record)
            .collect();
        let aggregate = forum::AreaAggregate::replay(area, &events)?;
        if aggregate.state().is_none_or(|state| state.slug != slug) {
            return Err(ForumPostgresError::InvalidAreaReservation);
        }
        Ok(Some(area))
    }

    async fn reserve_area_slug(&mut self, area: Uuid, slug: &str) -> Result<bool, Self::Error> {
        Ok(sqlx::query("INSERT INTO forum_area_reservation(area_id, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(area).bind(slug).execute(&mut *self.tx).await?.rows_affected() == 1)
    }

    async fn public_mention_profile(
        &mut self,
        handle: &str,
    ) -> Result<Option<MentionProfile>, Self::Error> {
        Ok(
            profile_application::public_mention_profile_in_tx(&mut self.tx, handle)
                .await?
                .map(|profile| MentionProfile {
                    profile_id: profile.profile_id.as_uuid(),
                    handle: profile.handle.as_str().to_owned(),
                }),
        )
    }

    async fn quotation_thread(
        &mut self,
        topic: Uuid,
        viewer: PrincipalId,
    ) -> Result<content_reference::QuotationThreadState, Self::Error> {
        Ok(
            projections::quotation_thread_for_discussion(&mut *self.tx, topic, Some(viewer))
                .await?,
        )
    }

    async fn charge_posting(
        &mut self,
        principal: PrincipalId,
        action: PostingAction,
        new_mention_targets: u32,
        now: i64,
    ) -> Result<(), Self::Error> {
        let global_moderator = self.is_global_moderator(principal).await?;
        let surface = match action {
            PostingAction::CreateTopic => projections::PostingSurface::DiscussionTopic,
            PostingAction::SubmitPost => projections::PostingSurface::DiscussionPost,
            PostingAction::EditPost => projections::PostingSurface::DiscussionEdit,
        };
        projections::charge_posting_budget_in_tx(
            &mut self.tx,
            &self.posting,
            &projections::PostingCharge {
                principal_id: principal,
                surface,
                new_mention_targets,
                standing: projections::PostingStanding {
                    hosts_this_game: false,
                    global_moderator,
                },
            },
            now,
        )
        .await?;
        Ok(())
    }

    async fn append_and_project(
        &mut self,
        stream: Uuid,
        expected_version: i64,
        events: &[forum::DecodedForumEvent],
        actor: PrincipalId,
        occurred_at: i64,
    ) -> Result<ForumCommit, Self::Error> {
        let batch: Vec<_> = events
            .iter()
            .cloned()
            .map(|event| {
                EventToAppend::<ForumCodec>::new(event, ActorId::Principal(actor), occurred_at)
            })
            .collect();
        let stored =
            append_and_project_in_tx(&mut self.tx, stream, expected_version, &batch).await?;
        let last = stored
            .last()
            .ok_or_else(|| journal::JournalError::InvalidEnvelope("empty forum commit".into()))?;
        Ok(ForumCommit {
            stream_id: stream,
            stream_version: last.stream_seq,
            last_source_seq: last.seq,
        })
    }

    async fn commit(self) -> Result<(), Self::Error> {
        Ok(self.tx.commit().await?)
    }
    async fn rollback(self) -> Result<(), Self::Error> {
        Ok(self.tx.rollback().await?)
    }
}

async fn append_and_project_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: Uuid,
    expected: i64,
    events: &[EventToAppend<ForumCodec>],
) -> Result<Vec<eventstore::StoredEvent>, ForumPostgresError> {
    // The outer savepoint extends journal/outbox atomicity to the projector.
    // A failed fold cannot leak an append even if the caller commits other work.
    let mut batch = sqlx::Acquire::begin(&mut *tx).await?;
    let result = async {
        let stored = journal::append_expected_in_tx::<ForumCodec>(
            &mut batch,
            StreamId::new(stream),
            ExpectedVersion::new(expected)?,
            events,
        )
        .await?;
        let mut projected = Vec::with_capacity(stored.len());
        for event in &stored {
            let record = forum_journal::projection_record(event);
            projections::project_discussion_event(&mut batch, stream, &record).await?;
            projected.push(record);
        }
        Ok::<_, ForumPostgresError>(projected)
    }
    .await;
    match result {
        Ok(stored) => {
            batch.commit().await?;
            Ok(stored)
        }
        Err(error) => {
            batch.rollback().await?;
            Err(error)
        }
    }
}

/// Audit all reachable forum envelopes before readiness. A raw historical
/// stream without the new sealed context is rejected, never silently upcast.
pub async fn audit_decode(pool: &PgPool) -> Result<(), ForumPostgresError> {
    let streams = sqlx::query_scalar::<_, Uuid>(
        "SELECT DISTINCT stream_id FROM events WHERE kind LIKE 'Discussion%' UNION SELECT area_id FROM forum_area_reservation",
    ).fetch_all(pool).await?;
    for stream in streams {
        // Each source has its own transaction and fence. Concurrent audits
        // cannot accumulate stream locks in incompatible orders.
        let mut tx = pool.begin().await?;
        let stream_id = StreamId::new(stream);
        journal::lock_stream_in_tx(&mut tx, stream_id).await?;
        let events = journal::load_in_tx::<ForumCodec>(&mut tx, stream_id).await?;
        journal::audit_outbox_in_tx::<forum_journal::ForumIntegrationCodec>(&mut tx, stream_id)
            .await?;
        journal::audit_source_outbox_in_tx::<ForumCodec>(&mut tx, stream_id).await?;
        let records: Vec<_> = events
            .into_iter()
            .map(forum_journal::replay_record)
            .collect();
        let reserved_slug = sqlx::query_scalar::<_, String>(
            "SELECT slug FROM forum_area_reservation WHERE area_id = $1",
        )
        .bind(stream)
        .fetch_optional(&mut *tx)
        .await?;
        if matches!(
            records.first().map(|record| &record.event),
            Some(forum::DecodedForumEvent::AreaCreated { .. })
        ) {
            let area = forum::AreaAggregate::replay(stream, &records)?;
            if area.state().map(|area| area.slug.as_str()) != reserved_slug.as_deref() {
                return Err(ForumPostgresError::InvalidAreaReservation);
            }
        } else {
            if reserved_slug.is_some() {
                return Err(ForumPostgresError::InvalidAreaReservation);
            }
            forum::TopicAggregate::replay(stream, &records)?;
        }
        tx.commit().await?;
    }
    Ok(())
}
