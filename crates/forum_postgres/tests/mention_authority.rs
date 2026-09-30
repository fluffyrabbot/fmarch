//! Mention discovery is public; admission verifies sealed profile authority.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use content_reference::ContentReferenceReject;
use forum::ForumReject;
use forum_application::{execute, ForumApplicationError, ForumCommand, ForumCommit, MentionInput};
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
    async fn execute(
        &self,
        pool: &PgPool,
        command: ForumCommand,
        now: i64,
    ) -> Result<ForumCommit, ApplicationError> {
        let store = PgForumStore::new(
            pool.clone(),
            PostingAdmission::Enforced(PostingBudgetPolicy::default()),
            self.authorization.clone(),
            self.policy.clone(),
            now,
        );
        execute(&store, command, self.principal, now).await
    }
}

async fn member(pool: &PgPool, handle: &str, moderator: bool, now: i64) -> Member {
    let principal = PrincipalId::from_uuid(Uuid::new_v4());
    let secret = "41".repeat(32);
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
    author: Member,
    target: Member,
    topic: Uuid,
    now: i64,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let moderator = member(pool, "mention_moderator", true, now).await;
    let author = member(pool, "mention_author", false, now).await;
    let target = member(pool, "mention_target", false, now).await;
    moderator
        .execute(
            pool,
            ForumCommand::CreateArea {
                area_id: Uuid::new_v4(),
                slug: "general".into(),
                title: "General".into(),
                description: "Public discussion".into(),
            },
            now - 10,
        )
        .await
        .unwrap();
    let topic = Uuid::new_v4();
    author
        .execute(
            pool,
            ForumCommand::CreateTopic {
                topic_id: topic,
                area_slug: "general".into(),
                title: "Mention authority".into(),
                body: "Opening post".into(),
            },
            now - 1,
        )
        .await
        .unwrap();
    Fixture {
        author,
        target,
        topic,
        now,
    }
}

fn mention(topic: Uuid, handle: &str) -> ForumCommand {
    ForumCommand::SubmitPost {
        topic_id: topic,
        body: format!("@{handle} a public reply"),
        quotations: vec![],
        mentions: vec![MentionInput {
            handle: handle.into(),
            offset: 0,
            len: handle.len() + 1,
        }],
    }
}

async fn snapshot(pool: &PgPool, f: &Fixture) -> serde_json::Value {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'events', (SELECT COUNT(*) FROM events WHERE stream_id = $1),
          'outbox', (SELECT COUNT(*) FROM event_integration_outbox AS fact JOIN events AS event ON event.seq = fact.source_seq WHERE event.stream_id = $1),
          'posts', (SELECT COUNT(*) FROM discussion_post WHERE topic_id = $1),
          'mentions', (SELECT COUNT(*) FROM member_inbox_item WHERE surface_id = $1 AND reason = 'mention'),
          'budget', (SELECT COALESCE(jsonb_agg(to_jsonb(budget) ORDER BY budget.budget), '[]'::jsonb) FROM posting_budget_window AS budget WHERE principal_id = $2)
        )"#,
    )
    .bind(f.topic)
    .bind(f.author.principal.as_uuid())
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn public_row(pool: &PgPool, profile: Uuid) -> serde_json::Value {
    sqlx::query_scalar(
        "SELECT to_jsonb(profile) FROM public_profile AS profile WHERE profile_id = $1",
    )
    .bind(profile)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn restore_public_row(pool: &PgPool, row: serde_json::Value) {
    sqlx::query(
        "INSERT INTO public_profile SELECT * FROM jsonb_populate_record(NULL::public_profile, $1)",
    )
    .bind(row)
    .execute(pool)
    .await
    .unwrap();
}

fn assert_unknown(result: Result<ForumCommit, ApplicationError>) {
    assert!(matches!(
        result,
        Err(ApplicationError::Decision(ForumReject::ContentReference(
            ContentReferenceReject::UnknownMentionTarget
        )))
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn canonical_mentions_reject_forged_private_profile_and_handle(pool: PgPool) {
    let f = fixture(&pool).await;
    let row = public_row(&pool, f.target.profile).await;
    profile_application::update_profile(
        &pool,
        ProfileId::from_uuid(f.target.profile),
        f.target.principal,
        ProfileRevision::new(1),
        ProfileEdit::new(
            ProfileDisplayName::new("mention_target").unwrap(),
            ProfileBio::new("Forum proof profile.").unwrap(),
            ProfileVisibility::Private,
        ),
        f.now,
    )
    .await
    .unwrap();
    restore_public_row(&pool, row).await;
    let before = snapshot(&pool, &f).await;
    assert_unknown(
        f.author
            .execute(&pool, mention(f.topic, "mention_target"), f.now)
            .await,
    );
    assert_eq!(snapshot(&pool, &f).await, before);

    let other = member(&pool, "real_target", false, f.now).await;
    sqlx::query("UPDATE public_profile SET handle = 'forged_target' WHERE profile_id = $1")
        .bind(other.profile)
        .execute(&pool)
        .await
        .unwrap();
    assert_unknown(
        f.author
            .execute(&pool, mention(f.topic, "forged_target"), f.now)
            .await,
    );
    assert_eq!(snapshot(&pool, &f).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_mentions_require_existing_discovery_and_canonical_handle(pool: PgPool) {
    let f = fixture(&pool).await;
    let row = public_row(&pool, f.target.profile).await;
    sqlx::query("DELETE FROM public_profile WHERE profile_id = $1")
        .bind(f.target.profile)
        .execute(&pool)
        .await
        .unwrap();
    let before = snapshot(&pool, &f).await;
    // A still-public canonical claim does not broaden the public discovery
    // corpus through the private blinded handle index.
    assert_unknown(
        f.author
            .execute(&pool, mention(f.topic, "mention_target"), f.now)
            .await,
    );
    assert_eq!(snapshot(&pool, &f).await, before);
    restore_public_row(&pool, row).await;
    let receipt = f
        .author
        .execute(&pool, mention(f.topic, "mention_target"), f.now)
        .await
        .unwrap();
    let mentions: serde_json::Value =
        sqlx::query_scalar("SELECT mentions FROM discussion_post WHERE source_seq = $1")
            .bind(receipt.last_source_seq)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(mentions[0]["profile_id"], f.target.profile.to_string());
    let delivery: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM member_inbox_item WHERE principal_id = $1 AND source_seq = $2 AND reason = 'mention')",
    )
    .bind(f.target.principal.as_uuid())
    .bind(receipt.last_source_seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(delivery);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn mention_target_contention_rejects_without_waiting_or_partial_writes(pool: PgPool) {
    let f = fixture(&pool).await;
    let before = snapshot(&pool, &f).await;
    for gate in ["cutoff", "principal", "subject"] {
        let mut owner = pool.begin().await.unwrap();
        let statement = match gate {
            "cutoff" => "SELECT pg_advisory_xact_lock(hashtextextended('fmarch.identity-cutoff:' || $1::text, 0))",
            "principal" => "SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE",
            "subject" => "SELECT subject_id FROM privacy_subject WHERE principal_id = $1 FOR UPDATE",
            _ => unreachable!(),
        };
        sqlx::query(statement)
            .bind(f.target.principal.as_uuid())
            .execute(&mut *owner)
            .await
            .unwrap();
        let error = tokio::time::timeout(
            Duration::from_secs(2),
            f.author
                .execute(&pool, mention(f.topic, "mention_target"), f.now),
        )
        .await
        .expect("target authority must never wait while the author's locks are held")
        .unwrap_err();
        let ApplicationError::Port(ForumPostgresError::Profile(
            profile_application::ProfileApplicationError::PrivateClaim(error),
        )) = error
        else {
            panic!("expected target authority contention, got {error}");
        };
        match error {
            identity::PrivateClaimError::ReadContended => assert_eq!(gate, "cutoff"),
            identity::PrivateClaimError::Database(sqlx::Error::Database(db))
            | identity::PrivateClaimError::Identity(identity::IdentityFlowError::Db(
                sqlx::Error::Database(db),
            )) => assert_eq!(db.code().as_deref(), Some("55P03")),
            other => panic!("unexpected target authority error: {other}"),
        }
        assert_eq!(snapshot(&pool, &f).await, before);
        owner.rollback().await.unwrap();
    }
    f.author
        .execute(&pool, mention(f.topic, "mention_target"), f.now)
        .await
        .unwrap();
}
