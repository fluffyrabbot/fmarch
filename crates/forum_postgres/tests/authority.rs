//! Real session authority and deliberately corrupted disposable query rows.
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use content_reference::{ContentReferenceReject, PostKind, PostRef, Quotation};
use eventstore::journal::{self, StreamId};
use forum::{ForumReject, PostingState, TopicVisibility};
use forum_application::{
    execute, ForumApplicationError, ForumCommand, ForumCommit, ForumStore, ForumTransaction,
    PostingAction,
};
use forum_journal::{ForumIntegrationCodec, PublicationEffect};
use forum_postgres::{ForumPostgresError, PgForumStore};
use identity::{AuthorizationContext, LocalProofSessionAuthority, SessionPolicy};
use principal::PrincipalId;
use projections::{PostingAdmission, PostingBudgetPolicy};
use social::{
    ProfileBio, ProfileDisplayName, ProfileEdit, ProfileHandle, ProfileId, ProfilePresentation,
    ProfileRevision, ProfileVisibility,
};
use sqlx::PgPool;
use uuid::Uuid;

type ApplicationError = ForumApplicationError<ForumPostgresError>;

struct Member {
    principal: PrincipalId,
    profile: Uuid,
    authorization: AuthorizationContext,
    policy: SessionPolicy,
}

impl Member {
    fn store(&self, pool: &PgPool, now: i64) -> PgForumStore {
        PgForumStore::new(
            pool.clone(),
            PostingAdmission::Enforced(PostingBudgetPolicy::default()),
            self.authorization.clone(),
            self.policy.clone(),
            now,
        )
    }

    async fn execute(
        &self,
        pool: &PgPool,
        command: ForumCommand,
        now: i64,
    ) -> Result<ForumCommit, ApplicationError> {
        execute(&self.store(pool, now), command, self.principal, now).await
    }
}

async fn member(pool: &PgPool, handle: &str, moderator: bool, now: i64) -> Member {
    let principal = PrincipalId::from_uuid(Uuid::new_v4());
    let secret = "31".repeat(32);
    let authority = LocalProofSessionAuthority::from_secret(&secret).unwrap();
    let policy =
        SessionPolicy::default().with_local_proof_instance(authority.instance_id().clone());
    let grant = authority
        .authorize(
            &secret,
            if moderator {
                vec!["GlobalMod".into()]
            } else {
                vec![]
            },
        )
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let pending = identity::issue_local_proof_session(
        &mut tx,
        &principal,
        grant,
        now + 3_600,
        &policy,
        now - 30,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let session = pending.activate().unwrap();
    let authorization =
        identity::session::validate_session(pool, &session.session_token, &policy, now)
            .await
            .unwrap()
            .authorization()
            .clone();
    membership_application::ensure_founder_membership(pool, principal, now - 25)
        .await
        .unwrap();
    let presentation = ProfilePresentation::new(
        ProfileHandle::new(handle).unwrap(),
        ProfileDisplayName::new(handle).unwrap(),
        ProfileBio::new("Forum proof profile.").unwrap(),
        ProfileVisibility::Public,
    );
    let profile = profile_application::create_profile(pool, principal, presentation, now - 20)
        .await
        .unwrap()
        .as_uuid();
    Member {
        principal,
        profile,
        authorization,
        policy,
    }
}

struct Fixture {
    moderator: Member,
    author: Member,
    topic: Uuid,
    post: i64,
    now: i64,
}

async fn fixture(pool: &PgPool, post_age: i64) -> Fixture {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let moderator = member(pool, "forum_moderator", true, now).await;
    let author = member(pool, "forum_author", false, now).await;
    let area = Uuid::new_v4();
    moderator
        .execute(
            pool,
            ForumCommand::CreateArea {
                area_id: area,
                slug: "general".into(),
                title: "General".into(),
                description: "Public discussion".into(),
            },
            now - 10,
        )
        .await
        .unwrap();
    let topic = Uuid::new_v4();
    let receipt = author
        .execute(
            pool,
            ForumCommand::CreateTopic {
                topic_id: topic,
                area_slug: "general".into(),
                title: "Canonical topic".into(),
                body: "Canonical original body".into(),
            },
            now - post_age,
        )
        .await
        .unwrap();
    Fixture {
        moderator,
        author,
        topic,
        post: receipt.last_source_seq,
        now,
    }
}

fn submit(topic: Uuid) -> ForumCommand {
    ForumCommand::SubmitPost {
        topic_id: topic,
        body: "A new canonical reply".into(),
        quotations: vec![],
        mentions: vec![],
    }
}

fn edit(topic: Uuid, post: i64, revision: i64) -> ForumCommand {
    ForumCommand::EditPost {
        topic_id: topic,
        source_seq: post,
        body: "Changed by the real author".into(),
        mentions: vec![],
        expected_revision: revision,
    }
}

async fn snapshot(pool: &PgPool, fixture: &Fixture) -> serde_json::Value {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'events', (SELECT COUNT(*) FROM events WHERE stream_id = $1),
          'outbox', (SELECT COUNT(*) FROM event_integration_outbox AS fact JOIN events AS event ON event.seq = fact.source_seq WHERE event.stream_id = $1),
          'posts', (SELECT COUNT(*) FROM discussion_post WHERE topic_id = $1),
          'publications', (SELECT COUNT(*) FROM public_publication WHERE surface_id = $1),
          'topic', (SELECT to_jsonb(topic) FROM discussion_topic AS topic WHERE topic_id = $1),
          'budget', (SELECT COALESCE(jsonb_agg(to_jsonb(budget) ORDER BY budget.budget), '[]'::jsonb) FROM posting_budget_window AS budget WHERE principal_id = $2)
        )"#,
    ).bind(fixture.topic).bind(fixture.author.principal.as_uuid()).fetch_one(pool).await.unwrap()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn forged_query_topic_cannot_reopen_locked_or_hidden_canonical_policy(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    f.moderator
        .execute(
            &pool,
            ForumCommand::SetPostingState {
                topic_id: f.topic,
                posting_state: PostingState::Locked,
            },
            f.now,
        )
        .await
        .unwrap();
    sqlx::query("UPDATE discussion_topic SET posting_state = 'open', visibility = 'visible', version = 1 WHERE topic_id = $1").bind(f.topic).execute(&pool).await.unwrap();
    let before = snapshot(&pool, &f).await;
    assert!(matches!(
        f.author.execute(&pool, submit(f.topic), f.now).await,
        Err(ApplicationError::Decision(ForumReject::TopicLocked))
    ));
    assert_eq!(snapshot(&pool, &f).await, before);

    f.moderator
        .execute(
            &pool,
            ForumCommand::SetPostingState {
                topic_id: f.topic,
                posting_state: PostingState::Open,
            },
            f.now,
        )
        .await
        .unwrap();
    f.moderator
        .execute(
            &pool,
            ForumCommand::SetVisibility {
                topic_id: f.topic,
                visibility: TopicVisibility::Hidden,
            },
            f.now,
        )
        .await
        .unwrap();
    sqlx::query(
        "UPDATE discussion_topic SET visibility = 'visible', version = 1 WHERE topic_id = $1",
    )
    .bind(f.topic)
    .execute(&pool)
    .await
    .unwrap();
    let before = snapshot(&pool, &f).await;
    assert!(matches!(
        f.author.execute(&pool, submit(f.topic), f.now).await,
        Err(ApplicationError::Decision(ForumReject::TopicHidden))
    ));
    assert_eq!(snapshot(&pool, &f).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn forged_post_author_revision_clock_and_body_cannot_grant_authority(pool: PgPool) {
    let f = fixture(&pool, forum::FORUM_EDIT_WINDOW_SECONDS + 10).await;
    let attacker = member(&pool, "other_author", false, f.now).await;
    sqlx::query("UPDATE discussion_post SET author_profile_id = $2, revision = 91, edited_at = $3, created_at = $3, body = 'fabricated projection excerpt' WHERE source_seq = $1")
        .bind(f.post).bind(attacker.profile).bind(f.now).execute(&pool).await.unwrap();
    let before = snapshot(&pool, &f).await;
    assert!(matches!(
        attacker
            .execute(&pool, edit(f.topic, f.post, 91), f.now)
            .await,
        Err(ApplicationError::Decision(ForumReject::NotAuthor))
    ));
    assert!(matches!(
        f.author
            .execute(&pool, edit(f.topic, f.post, 91), f.now)
            .await,
        Err(ApplicationError::Decision(ForumReject::StaleRevision))
    ));
    assert!(matches!(
        f.author
            .execute(&pool, edit(f.topic, f.post, 0), f.now)
            .await,
        Err(ApplicationError::Decision(ForumReject::EditWindowElapsed))
    ));
    let forged_quote = ForumCommand::SubmitPost {
        topic_id: f.topic,
        body: "Reply".into(),
        quotations: vec![Quotation {
            target: PostRef {
                kind: PostKind::DiscussionPost,
                scope_id: f.topic,
                source_seq: f.post,
            },
            excerpt: "fabricated projection excerpt".into(),
        }],
        mentions: vec![],
    };
    assert!(matches!(
        f.author.execute(&pool, forged_quote, f.now).await,
        Err(ApplicationError::Decision(ForumReject::ContentReference(
            ContentReferenceReject::InvalidQuotationExcerpt
        )))
    ));
    assert_eq!(snapshot(&pool, &f).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn curation_uses_live_session_authority_and_canonical_current_state(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    sqlx::query("UPDATE discussion_topic SET title = 'forged title', pinned = TRUE, version = 999 WHERE topic_id = $1").bind(f.topic).execute(&pool).await.unwrap();
    let before = snapshot(&pool, &f).await;
    assert!(matches!(
        f.author
            .execute(
                &pool,
                ForumCommand::RenameTopic {
                    topic_id: f.topic,
                    title: "Another title".into()
                },
                f.now
            )
            .await,
        Err(ApplicationError::ModeratorRequired)
    ));
    assert!(matches!(
        f.moderator
            .execute(
                &pool,
                ForumCommand::RenameTopic {
                    topic_id: f.topic,
                    title: "Canonical topic".into()
                },
                f.now
            )
            .await,
        Err(ApplicationError::Decision(ForumReject::NoStateChange))
    ));
    assert_eq!(snapshot(&pool, &f).await, before);
    sqlx::query("UPDATE auth_session SET revoked_at = $2 WHERE token_hash = $1")
        .bind(f.moderator.authorization.session_reference())
        .bind(f.now)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        f.moderator
            .execute(
                &pool,
                ForumCommand::SetPinned {
                    topic_id: f.topic,
                    pinned: true
                },
                f.now
            )
            .await,
        Err(ApplicationError::Port(ForumPostgresError::Identity(
            identity::IdentityFlowError::Unauthorized
        )))
    ));
    assert_eq!(snapshot(&pool, &f).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn projector_and_outbox_failures_roll_back_events_facts_budget_and_query_rows(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    sqlx::query("CREATE FUNCTION fail_forum_proof_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected forum write failure'; END $$")
        .execute(&pool).await.unwrap();
    for fail_outbox in [false, true] {
        let create = if fail_outbox {
            "CREATE TRIGGER fail_forum_write BEFORE INSERT ON event_integration_outbox FOR EACH ROW EXECUTE FUNCTION fail_forum_proof_write()"
        } else {
            "CREATE TRIGGER fail_forum_write BEFORE INSERT ON discussion_post FOR EACH ROW EXECUTE FUNCTION fail_forum_proof_write()"
        };
        sqlx::query(create).execute(&pool).await.unwrap();
        let before = snapshot(&pool, &f).await;
        assert!(f
            .author
            .execute(&pool, submit(f.topic), f.now)
            .await
            .is_err());
        assert_eq!(snapshot(&pool, &f).await, before, "a failed downstream write must undo journal, encrypted integration fact, and earlier budget increments");
        let drop = if fail_outbox {
            "DROP TRIGGER fail_forum_write ON event_integration_outbox"
        } else {
            "DROP TRIGGER fail_forum_write ON discussion_post"
        };
        sqlx::query(drop).execute(&pool).await.unwrap();
    }
    let receipt = f
        .author
        .execute(&pool, submit(f.topic), f.now)
        .await
        .unwrap();
    assert_eq!(receipt.stream_version, 3);
    let mut tx = pool.begin().await.unwrap();
    let facts =
        journal::load_outbox_in_tx::<ForumIntegrationCodec>(&mut tx, StreamId::new(f.topic))
            .await
            .unwrap();
    assert_eq!(facts.len(), 2);
    assert_eq!(facts[0].source_seq, f.post);
    assert_eq!(facts[1].source_seq, receipt.last_source_seq);
    assert!(facts
        .iter()
        .all(|fact| fact.fact.effect == PublicationEffect::Published));
    tx.rollback().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn missing_integration_fact_fails_readiness_instead_of_silently_passing_decode(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    forum_postgres::audit_decode(&pool).await.unwrap();
    let mut corrupt = pool.begin().await.unwrap();
    sqlx::query(
        "ALTER TABLE event_integration_outbox DISABLE TRIGGER event_integration_outbox_no_mutation",
    )
    .execute(&mut *corrupt)
    .await
    .unwrap();
    sqlx::query("DELETE FROM event_integration_outbox WHERE source_seq = $1")
        .bind(f.post)
        .execute(&mut *corrupt)
        .await
        .unwrap();
    sqlx::query(
        "ALTER TABLE event_integration_outbox ENABLE TRIGGER event_integration_outbox_no_mutation",
    )
    .execute(&mut *corrupt)
    .await
    .unwrap();
    corrupt.commit().await.unwrap();
    assert!(forum_postgres::audit_decode(&pool).await.is_err());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn forged_public_profile_cannot_admit_a_canonically_private_author(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    let public_row: serde_json::Value = sqlx::query_scalar(
        "SELECT to_jsonb(profile) FROM public_profile AS profile WHERE profile_id = $1",
    )
    .bind(f.author.profile)
    .fetch_one(&pool)
    .await
    .unwrap();
    profile_application::update_profile(
        &pool,
        ProfileId::from_uuid(f.author.profile),
        f.author.principal,
        ProfileRevision::new(1),
        ProfileEdit::new(
            ProfileDisplayName::new("forum_author").unwrap(),
            ProfileBio::new("Forum proof profile.").unwrap(),
            ProfileVisibility::Private,
        ),
        f.now,
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public_profile SELECT * FROM jsonb_populate_record(NULL::public_profile, $1)",
    )
    .bind(public_row)
    .execute(&pool)
    .await
    .unwrap();
    let before = snapshot(&pool, &f).await;
    assert!(matches!(
        f.author.execute(&pool, submit(f.topic), f.now).await,
        Err(ApplicationError::AuthorRequired)
    ));
    assert_eq!(snapshot(&pool, &f).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn profile_admission_shares_identity_locks_without_waiting_on_profile_rows(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    let mut first = pool.begin().await.unwrap();
    let mut second = pool.begin().await.unwrap();
    for tx in [&mut first, &mut second] {
        identity::session::lock_live_delivery_cutoff_gates(tx, &f.author.principal)
            .await
            .unwrap();
        identity::session::validate_session_reference_for_delivery(
            tx,
            f.author.authorization.session_reference(),
            &f.author.policy,
            f.now,
        )
        .await
        .unwrap();
    }
    // An owner edit takes this dependent row before opening its claim. Neither
    // reader may wait on it while holding shared principal/subject authority.
    let mut writer = pool.begin().await.unwrap();
    let subject: Uuid = sqlx::query_scalar(
        "SELECT subject_id FROM member_profile WHERE profile_id = $1 FOR UPDATE",
    )
    .bind(f.author.profile)
    .fetch_one(&mut *writer)
    .await
    .unwrap();
    for tx in [&mut first, &mut second] {
        let profile = tokio::time::timeout(
            Duration::from_secs(2),
            profile_application::public_posting_profile_in_tx(tx, f.author.principal),
        )
        .await
        .expect(
            "a profile reader must not upgrade the shared principal lock or lock the profile row",
        )
        .unwrap();
        assert_eq!(profile, Some(ProfileId::from_uuid(f.author.profile)));
    }
    sqlx::query("SET LOCAL lock_timeout = '100ms'")
        .execute(&mut *writer)
        .await
        .unwrap();
    let private = ProfilePresentation::new(
        ProfileHandle::new("forum_author").unwrap(),
        ProfileDisplayName::new("forum_author").unwrap(),
        ProfileBio::new("Forum proof profile.").unwrap(),
        ProfileVisibility::Private,
    );
    let error = identity::insert_subject_claim(
        &mut writer,
        identity::SubjectId::from_uuid(subject),
        "profile",
        f.author.profile,
        None,
        f.now,
        &private,
    )
    .await
    .unwrap_err();
    assert!(
        matches!(error, identity::PrivateClaimError::Database(sqlx::Error::Database(ref db)) if db.code().as_deref() == Some("55P03")),
        "claim mutation must wait for the shared admission transactions: {error}"
    );
    writer.rollback().await.unwrap();
    first.commit().await.unwrap();
    second.commit().await.unwrap();

    // Once both admissions finish, the real owner mutation can publish its
    // new pointer, and the next admission must observe the private claim.
    profile_application::update_profile(
        &pool,
        ProfileId::from_uuid(f.author.profile),
        f.author.principal,
        ProfileRevision::new(1),
        ProfileEdit::new(private.display_name, private.bio, private.visibility),
        f.now,
    )
    .await
    .unwrap();
    let mut next = pool.begin().await.unwrap();
    assert_eq!(
        profile_application::public_posting_profile_in_tx(&mut next, f.author.principal)
            .await
            .unwrap(),
        None
    );
    next.rollback().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn forum_commit_completes_while_profile_writer_waits_on_shared_authority(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    // Separate one-connection pools identify the exact competing backends.
    let forum_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let writer_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let forum_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&forum_pool)
        .await
        .unwrap();
    let writer_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&writer_pool)
        .await
        .unwrap();
    sqlx::query("SET lock_timeout = '10s'")
        .execute(&writer_pool)
        .await
        .unwrap();

    // Stage the actual application ports through author admission. The forum
    // keeps its exact session, principal, and subject read gates until commit.
    let store = f.author.store(&forum_pool, f.now);
    let mut forum_tx = store.begin().await.unwrap();
    let source = forum_tx.load_forum_stream(f.topic).await.unwrap();
    let aggregate = forum::TopicAggregate::replay(f.topic, &source).unwrap();
    assert_eq!(
        forum_tx.author_profile(f.author.principal).await.unwrap(),
        Some(f.author.profile)
    );
    let content = forum::PostContent::new(
        &aggregate.quotation_thread().unwrap(),
        forum::PostBody::new("Post committed before the author becomes private").unwrap(),
        &[],
        &[],
    )
    .unwrap();
    let events: Vec<_> = forum::decide_topic(
        aggregate.state(),
        forum::TopicCommand::SubmitPost {
            content,
            author_profile_id: f.author.profile,
        },
    )
    .unwrap()
    .into_iter()
    .map(forum::DecodedForumEvent::from)
    .collect();
    forum_tx
        .charge_posting(f.author.principal, PostingAction::SubmitPost, 0, f.now)
        .await
        .unwrap();

    let profile = ProfileId::from_uuid(f.author.profile);
    let principal = f.author.principal;
    let now = f.now;
    let mut writer = tokio::spawn(async move {
        let result = profile_application::update_profile(
            &writer_pool,
            profile,
            principal,
            ProfileRevision::new(1),
            ProfileEdit::new(
                ProfileDisplayName::new("forum_author").unwrap(),
                ProfileBio::new("Forum proof profile.").unwrap(),
                ProfileVisibility::Private,
            ),
            now,
        )
        .await;
        writer_pool.close().await;
        result
    });
    let observed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let blocked: bool = sqlx::query_scalar(
                "SELECT $1 = ANY(pg_blocking_pids($2)) AND EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$2 AND query LIKE '%FROM platform_principal%FOR UPDATE%')",
            ).bind(forum_pid).bind(writer_pid).fetch_one(&pool).await.unwrap();
            if blocked { break; }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }).await;
    if observed.is_err() {
        writer.abort();
        let _ = writer.await;
        forum_tx.rollback().await.unwrap();
        panic!("profile writer must reach its principal gate while holding its profile row lock");
    }

    // INSERT/UPDATE foreign keys are initially deferred. This includes the
    // real commit check, where FOR UPDATE on member_profile previously formed
    // the cycle: forum -> profile writer -> forum's shared principal gate.
    let commit = tokio::time::timeout(Duration::from_secs(3), async {
        let receipt = forum_tx
            .append_and_project(
                f.topic,
                aggregate.version(),
                &events,
                f.author.principal,
                f.now,
            )
            .await?;
        forum_tx.commit().await?;
        Ok::<_, ForumPostgresError>(receipt)
    })
    .await;
    if !matches!(&commit, Ok(Ok(_))) {
        writer.abort();
        let _ = writer.await;
        panic!("forum append and deferred foreign-key commit must pass the waiting profile writer: {commit:?}");
    }
    let receipt = commit.unwrap().unwrap();
    let updated = match tokio::time::timeout(Duration::from_secs(5), &mut writer).await {
        Ok(result) => result.unwrap().unwrap(),
        Err(_) => {
            writer.abort();
            let _ = writer.await;
            panic!("profile writer must proceed after forum commit releases shared authority");
        }
    };
    assert_eq!(updated, profile);
    assert_eq!(
        projections::discussion_topic_by_id(&pool, f.topic)
            .await
            .unwrap()
            .unwrap()
            .version,
        receipt.stream_version
    );
    let mut next = pool.begin().await.unwrap();
    assert_eq!(
        profile_application::public_posting_profile_in_tx(&mut next, principal)
            .await
            .unwrap(),
        None
    );
    next.rollback().await.unwrap();
    forum_pool.close().await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn orphaned_area_reservation_fails_readiness_without_any_source_events(pool: PgPool) {
    let _valid = fixture(&pool, 1).await;
    forum_postgres::audit_decode(&pool).await.unwrap();
    let orphan = Uuid::new_v4();
    // Deliberate adapter corruption: the reservation is committed without
    // its canonical creation fact, so discovery must include reservation IDs.
    sqlx::query("INSERT INTO forum_area_reservation(area_id, slug) VALUES ($1, 'orphaned-area')")
        .bind(orphan)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        forum_postgres::audit_decode(&pool).await,
        Err(ForumPostgresError::InvalidAreaReservation)
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn area_reservation_bound_to_a_topic_fails_readiness(pool: PgPool) {
    let f = fixture(&pool, 1).await;
    forum_postgres::audit_decode(&pool).await.unwrap();
    // This source has valid typed facts and a complete integration outbox.
    // It must still be rejected as an area because its root fact is a topic.
    sqlx::query("INSERT INTO forum_area_reservation(area_id, slug) VALUES ($1, 'topic-as-area')")
        .bind(f.topic)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        forum_postgres::audit_decode(&pool).await,
        Err(ForumPostgresError::InvalidAreaReservation)
    ));
}
