use super::*;
use commands::{Command as DomainCommand, Reject};
use content_reference::PublicContentRef;
use eventstore::{ActorId, EventInput};

async fn origin_fixture(pool: &sqlx::PgPool) -> (caps::Principal, Uuid, Uuid) {
    let host_id = PrincipalId::fixture("signup_host");
    {
        let mut connection = pool.acquire().await.unwrap();
        identity::methods::ensure_principal(&mut connection, &host_id, &[], 1)
            .await
            .unwrap();
    }
    let profile = profile_application::create_profile(
        pool,
        host_id,
        social::ProfilePresentation::new(
            social::ProfileHandle::new("signup_host").unwrap(),
            social::ProfileDisplayName::new("Signup Host").unwrap(),
            social::ProfileBio::new("Signup origin proof").unwrap(),
            social::ProfileVisibility::Public,
        ),
        1,
    )
    .await
    .unwrap()
    .as_uuid();
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    projections::append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({"slug":"signup", "title":"Signup", "description":"Signup proofs"}),
            ActorId::Principal(host_id),
            2,
        )],
    )
    .await
    .unwrap();
    projections::append_discussion_and_project(pool, topic, &[
        EventInput::new("DiscussionTopicCreated", 1, serde_json::json!({"area_id":area,"title":"Signup topic","author_profile_id":profile}), ActorId::Principal(host_id), 3),
        EventInput::new("DiscussionPostSubmitted", 1, serde_json::json!({"body":"Join us","author_profile_id":profile}), ActorId::Principal(host_id), 4),
    ]).await.unwrap();
    (caps::Principal::authenticated(host_id), profile, topic)
}

fn create(game: Uuid, origin: PublicContentRef) -> DomainCommand {
    DomainCommand::CreateGame {
        game,
        pack: "mafiascum".into(),
        cohost_denied: vec![],
        origin: Some(origin),
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn signup_origin_accepts_only_own_visible_topic_and_is_immutable(pool: sqlx::PgPool) {
    let (host, profile, topic) = origin_fixture(&pool).await;
    for origin in [
        PublicContentRef::new(topic, 1),
        PublicContentRef::new(profile, 0),
        PublicContentRef::new(Uuid::new_v4(), 0),
    ] {
        let game = Uuid::new_v4();
        assert_eq!(
            commands::handle(&pool, &host, create(game, origin))
                .await
                .unwrap_err(),
            Reject::InvalidTarget
        );
        assert!(eventstore::load_stream(&pool, game)
            .await
            .unwrap()
            .is_empty());
    }
    let other = caps::Principal::authenticated(PrincipalId::fixture("other_host"));
    assert_eq!(
        commands::handle(
            &pool,
            &other,
            create(Uuid::new_v4(), PublicContentRef::new(topic, 0))
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget
    );
    assert_eq!(
        commands::handle(&pool, &host, create(topic, PublicContentRef::new(topic, 0)))
            .await
            .unwrap_err(),
        Reject::InvalidTarget
    );
    let game = Uuid::new_v4();
    let command_id = Uuid::new_v4();
    let ack = commands::handle_idempotent(
        &pool,
        &host,
        command_id,
        create(game, PublicContentRef::new(topic, 0)),
    )
    .await
    .unwrap();
    let original = eventstore::load_stream(&pool, game).await.unwrap();
    assert_eq!(
        original[0].payload["origin"],
        serde_json::json!({"surface_id":topic,"source_seq":0})
    );
    assert!(commands::handle(
        &pool,
        &host,
        create(game, PublicContentRef::new(Uuid::new_v4(), 0))
    )
    .await
    .is_err());
    assert_eq!(
        eventstore::load_stream(&pool, game).await.unwrap().len(),
        original.len()
    );
    projections::append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionTopicVisibilityChanged",
            1,
            serde_json::json!({"visibility":"hidden"}),
            ActorId::Principal(host.id()),
            5,
        )],
    )
    .await
    .unwrap();
    assert_eq!(
        commands::handle(
            &pool,
            &host,
            create(Uuid::new_v4(), PublicContentRef::new(topic, 0))
        )
        .await
        .unwrap_err(),
        Reject::InvalidTarget
    );
    assert!(projections::game_origin_topic_options(&pool, host.id())
        .await
        .unwrap()
        .is_empty());
    let replay = commands::handle_idempotent(
        &pool,
        &host,
        command_id,
        create(game, PublicContentRef::new(topic, 0)),
    )
    .await
    .unwrap();
    assert_eq!(
        replay.stream_seqs, ack.stream_seqs,
        "receipt replay must not revalidate the now-hidden origin"
    );
    // Hiding the forum cannot rewrite already-recorded game provenance.
    projections::rebuild(&pool, game).await.unwrap();
    let origin: Uuid =
        sqlx::query_scalar("SELECT origin_topic_id FROM game_index WHERE game_id=$1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(origin, topic);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn signup_admission_serializes_with_topic_hiding_and_rejects_empty_lock_cycles(
    pool: sqlx::PgPool,
) {
    let (host, _, topic) = origin_fixture(&pool).await;
    let mut hiding = pool.begin().await.unwrap();
    projections::append_discussion_and_project_in_tx(
        &mut hiding,
        topic,
        &[EventInput::new(
            "DiscussionTopicVisibilityChanged",
            1,
            serde_json::json!({"visibility":"hidden"}),
            ActorId::Principal(host.id()),
            5,
        )],
    )
    .await
    .unwrap();
    let game = Uuid::new_v4();
    let task_pool = pool.clone();
    let task_host = host;
    let mut admission = tokio::spawn(async move {
        commands::handle(
            &task_pool,
            &task_host,
            create(game, PublicContentRef::new(topic, 0)),
        )
        .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut admission)
            .await
            .is_err(),
        "admission waits for the source stream before accepting stale visibility"
    );
    hiding.commit().await.unwrap();
    assert_eq!(admission.await.unwrap().unwrap_err(), Reject::InvalidTarget);
    assert!(eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .is_empty());
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let results = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(
            commands::handle(&pool, &host, create(a, PublicContentRef::new(b, 0))),
            commands::handle(&pool, &host, create(b, PublicContentRef::new(a, 0)))
        )
    })
    .await
    .expect("caller-selected empty ids must not form a lock cycle");
    assert_eq!(results.0.unwrap_err(), Reject::InvalidTarget);
    assert_eq!(results.1.unwrap_err(), Reject::InvalidTarget);
}
