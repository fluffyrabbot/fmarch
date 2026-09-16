//! Allocate event sequences and commit transactions in opposite orders. The
//! gate is deliberately after the owning source stream lock; reconciliation
//! must use event order while remaining correct for either commit order.
use super::*;
use eventstore::{ActorId, EventInput};

struct Fixture {
    host: PrincipalId,
    watcher: PrincipalId,
    topic: Uuid,
    game: Uuid,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let host = PrincipalId::from_uuid(Uuid::new_v4());
    let watcher = PrincipalId::from_uuid(Uuid::new_v4());
    for principal in [host, watcher] {
        let mut connection = pool.acquire().await.unwrap();
        identity::methods::ensure_principal(&mut connection, &principal, &[], 1)
            .await
            .unwrap();
    }
    let handle = format!("origin_{}", &Uuid::new_v4().simple().to_string()[..8]);
    let profile = profile_application::create_profile(
        pool,
        host,
        social::ProfilePresentation::new(
            social::ProfileHandle::new(&handle).unwrap(),
            social::ProfileDisplayName::new("Origin Host").unwrap(),
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
    let game = Uuid::new_v4();
    crate::append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({"slug":handle.replace('_', "-"),"title":"Origins","description":""}),
            ActorId::Principal(host),
            2,
        )],
    )
    .await
    .unwrap();
    crate::append_discussion_and_project(
        pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({"area_id":area,"title":"Signup","author_profile_id":profile}),
                ActorId::Principal(host),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({"body":"Signup","author_profile_id":profile}),
                ActorId::Principal(host),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let artifact = content_registry::select_pack_artifact("mafiascum").unwrap();
    crate::append_and_project(pool, game, &[EventInput::new("GameCreated", 1,
        serde_json::json!({"host_principal_id":host,"pack_ref":artifact.pack_ref,"pack_artifact":artifact,"origin":{"surface_id":topic,"source_seq":0}}),
        ActorId::Principal(host), 5)]).await.unwrap();
    Fixture {
        host,
        watcher,
        topic,
        game,
    }
}

fn start() -> EventInput {
    EventInput::new(
        "GameStarted",
        1,
        serde_json::json!({"phase_id":"D01"}),
        ActorId::Host,
        10,
    )
}

async fn prepare_watch(pool: &PgPool, fixture: &Fixture, enable: bool) -> Uuid {
    if enable {
        Uuid::new_v4()
    } else {
        crate::subscribe_to_public_target(
            pool,
            attention::WatchTarget {
                surface_id: fixture.topic,
            },
            fixture.watcher,
            6,
        )
        .await
        .unwrap();
        sqlx::query_scalar(
            "SELECT subscription_id FROM public_watch WHERE principal_id = $1 AND surface_id = $2",
        )
        .bind(fixture.watcher.as_uuid())
        .bind(fixture.topic)
        .fetch_one(pool)
        .await
        .unwrap()
    }
}

fn watch_event(fixture: &Fixture, enable: bool) -> EventInput {
    EventInput::new(
        if enable {
            attention::SUBSCRIPTION_ENABLED
        } else {
            attention::SUBSCRIPTION_DISABLED
        },
        1,
        if enable {
            serde_json::json!({"target":{"surface_id":fixture.topic},"initial_read_through_seq":0})
        } else {
            serde_json::json!({})
        },
        ActorId::Principal(fixture.watcher),
        9,
    )
}

async fn assert_delivery_and_independent_rebuilds(
    pool: &PgPool,
    fixture: &Fixture,
    subscription: Uuid,
    expected: usize,
) {
    let before = crate::public_inbox(pool, fixture.watcher, None, 20)
        .await
        .unwrap();
    assert_eq!(before.items.len(), expected);
    if let Some(item) = before.items.first() {
        assert_eq!(item.reason, "game_spawned_from_watched_topic");
        assert_eq!(item.href, format!("/games/{}", fixture.game));
    }
    crate::rebuild(pool, fixture.game).await.unwrap();
    assert_eq!(
        crate::public_inbox(pool, fixture.watcher, None, 20)
            .await
            .unwrap(),
        before
    );
    crate::rebuild_discussion_stream(pool, fixture.topic)
        .await
        .unwrap();
    assert_eq!(
        crate::public_inbox(pool, fixture.watcher, None, 20)
            .await
            .unwrap(),
        before
    );
    crate::rebuild_subscription_stream(pool, subscription)
        .await
        .unwrap();
    assert_eq!(
        crate::public_inbox(pool, fixture.watcher, None, 20)
            .await
            .unwrap(),
        before
    );
    assert!(crate::audit_rebuild(pool, fixture.game).await.unwrap().ok);
    // The host is excluded regardless of which event source commits last.
    assert!(crate::public_inbox(pool, fixture.host, None, 20)
        .await
        .unwrap()
        .items
        .is_empty());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn watch_before_start_converges_in_both_commit_orders(pool: PgPool) {
    for enable in [true, false] {
        for watch_commits_first in [true, false] {
            let fixture = fixture(&pool).await;
            let subscription = prepare_watch(&pool, &fixture, enable).await;
            let mut watch_tx = pool.begin().await.unwrap();
            let watch = eventstore::append_in_tx(
                &mut watch_tx,
                subscription,
                &[watch_event(&fixture, enable)],
            )
            .await
            .unwrap();
            if watch_commits_first {
                crate::fold_subscription_event(&mut watch_tx, subscription, &watch[0])
                    .await
                    .unwrap();
                let game = fixture.game;
                let task_pool = pool.clone();
                let mut starting = tokio::spawn(async move {
                    crate::append_and_project(&task_pool, game, &[start()]).await
                });
                assert!(
                    tokio::time::timeout(std::time::Duration::from_millis(50), &mut starting)
                        .await
                        .is_err(),
                    "start waits behind the watch transaction's adapter gate"
                );
                watch_tx.commit().await.unwrap();
                let started = starting.await.unwrap().unwrap();
                assert!(watch[0].seq < started[0].seq);
            } else {
                // Start commits while the lower-sequence watch event is still
                // uncommitted. Its eventual fold must insert OR retract a row.
                let started = crate::append_and_project(&pool, fixture.game, &[start()])
                    .await
                    .unwrap();
                assert!(watch[0].seq < started[0].seq);
                crate::fold_subscription_event(&mut watch_tx, subscription, &watch[0])
                    .await
                    .unwrap();
                watch_tx.commit().await.unwrap();
            }
            assert_delivery_and_independent_rebuilds(
                &pool,
                &fixture,
                subscription,
                usize::from(enable),
            )
            .await;
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn start_before_watch_keeps_event_time_membership_when_watch_waits_on_commit(pool: PgPool) {
    for enable in [true, false] {
        let fixture = fixture(&pool).await;
        let subscription = prepare_watch(&pool, &fixture, enable).await;
        let mut starting = pool.begin().await.unwrap();
        let started = crate::append_and_project_in_tx(&mut starting, fixture.game, &[start()])
            .await
            .unwrap();
        let mut watch_tx = pool.begin().await.unwrap();
        let watch = eventstore::append_in_tx(
            &mut watch_tx,
            subscription,
            &[watch_event(&fixture, enable)],
        )
        .await
        .unwrap();
        assert!(started[0].seq < watch[0].seq);
        let mut watching = tokio::spawn(async move {
            crate::fold_subscription_event(&mut watch_tx, subscription, &watch[0])
                .await
                .unwrap();
            watch_tx.commit().await.unwrap();
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut watching)
                .await
                .is_err(),
            "watch waits behind the start transaction's adapter gate"
        );
        starting.commit().await.unwrap();
        watching.await.unwrap();
        assert_delivery_and_independent_rebuilds(
            &pool,
            &fixture,
            subscription,
            usize::from(!enable),
        )
        .await;
    }
}
