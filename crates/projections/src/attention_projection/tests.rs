//! Public attention is derived from event-time membership, independent of
//! transaction commit order and the source chosen for a later rebuild.
use attention::WatchTarget;
use eventstore::{ActorId, EventInput};
use principal::PrincipalId;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;
use uuid::Uuid;

struct Fixture {
    author: PrincipalId,
    author_profile: Uuid,
    watcher: PrincipalId,
    watcher_profile: Uuid,
    topic: Uuid,
}

async fn create_profile(pool: &PgPool, principal: PrincipalId) -> Uuid {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal, &[], 1)
        .await
        .unwrap();
    drop(connection);
    let handle = format!("attention_{}", &Uuid::new_v4().simple().to_string()[..8]);
    profile_application::create_profile(
        pool,
        principal,
        social::ProfilePresentation::new(
            social::ProfileHandle::new(&handle).unwrap(),
            social::ProfileDisplayName::new("Attention member").unwrap(),
            social::ProfileBio::new("Attention convergence proof").unwrap(),
            social::ProfileVisibility::Public,
        ),
        1,
    )
    .await
    .unwrap()
    .as_uuid()
}

async fn fixture(pool: &PgPool) -> Fixture {
    let author = PrincipalId::from_uuid(Uuid::new_v4());
    let watcher = PrincipalId::from_uuid(Uuid::new_v4());
    let author_profile = create_profile(pool, author).await;
    let watcher_profile = create_profile(pool, watcher).await;
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    crate::append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({"slug":format!("attention-{}", area.simple()),"title":"Attention","description":""}),
            ActorId::Principal(author),
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
                forum::TOPIC_CREATED,
                1,
                serde_json::json!({"area_id":area,"title":"Watched discussion","author_profile_id":author_profile}),
                ActorId::Principal(author),
                3,
            ),
            EventInput::new(
                forum::POST_SUBMITTED,
                1,
                serde_json::json!({"body":"Opening post","author_profile_id":author_profile}),
                ActorId::Principal(author),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    Fixture {
        author,
        author_profile,
        watcher,
        watcher_profile,
        topic,
    }
}

async fn subscribe(pool: &PgPool, principal: PrincipalId, surface: Uuid) -> Uuid {
    crate::subscribe_to_public_target(
        pool,
        WatchTarget {
            surface_id: surface,
        },
        principal,
        5,
    )
    .await
    .unwrap();
    sqlx::query_scalar(
        "SELECT subscription_id FROM public_watch WHERE principal_id = $1 AND surface_id = $2",
    )
    .bind(principal.as_uuid())
    .bind(surface)
    .fetch_one(pool)
    .await
    .unwrap()
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
        6,
    )
}

fn post_event(fixture: &Fixture) -> EventInput {
    EventInput::new(
        forum::POST_SUBMITTED,
        1,
        serde_json::json!({"body":"Concurrent reply","author_profile_id":fixture.author_profile}),
        ActorId::Principal(fixture.author),
        7,
    )
}

async fn wait_for_blocker(pool: &PgPool, waiter: i32, blocker: i32) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let blocked: bool = sqlx::query_scalar("SELECT $1 = ANY(pg_blocking_pids($2))")
                .bind(blocker)
                .bind(waiter)
                .fetch_one(pool)
                .await
                .unwrap();
            if blocked {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the second fold must wait for the identified attention transaction");
}

async fn inbox(pool: &PgPool, principal: PrincipalId) -> crate::PublicInboxPage {
    crate::public_inbox(pool, principal, None, 50)
        .await
        .unwrap()
}

async fn reasons(pool: &PgPool, principal: PrincipalId) -> Vec<(Uuid, i64, i64, String)> {
    sqlx::query_as(
        "SELECT surface_id, source_seq, delivery_seq, reason FROM member_inbox_item WHERE principal_id = $1 ORDER BY surface_id, source_seq, reason",
    )
    .bind(principal.as_uuid())
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn assert_independent_rebuilds(pool: &PgPool, fixture: &Fixture, subscription: Uuid) {
    let expected = inbox(pool, fixture.watcher).await;
    let expected_reasons = reasons(pool, fixture.watcher).await;
    // Exercise both ownership orders, checking the intermediate result too.
    for topic_first in [true, false] {
        for rebuild_topic in [topic_first, !topic_first] {
            if rebuild_topic {
                crate::rebuild_discussion_stream(pool, fixture.topic)
                    .await
                    .unwrap();
            } else {
                crate::rebuild_subscription_stream(pool, subscription)
                    .await
                    .unwrap();
            }
            assert_eq!(inbox(pool, fixture.watcher).await, expected);
            assert_eq!(reasons(pool, fixture.watcher).await, expected_reasons);
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn watch_and_post_converge_in_every_event_and_commit_order(pool: PgPool) {
    for enable in [true, false] {
        for watch_event_first in [true, false] {
            for watch_commits_first in [true, false] {
                let fixture = fixture(&pool).await;
                let subscription = if enable {
                    Uuid::new_v4()
                } else {
                    subscribe(&pool, fixture.watcher, fixture.topic).await
                };
                let mut watch_tx = pool.begin().await.unwrap();
                let mut post_tx = pool.begin().await.unwrap();
                let watch_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
                    .fetch_one(&mut *watch_tx)
                    .await
                    .unwrap();
                let post_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
                    .fetch_one(&mut *post_tx)
                    .await
                    .unwrap();
                let watch_input = watch_event(&fixture, enable);
                let post_input = post_event(&fixture);
                // Allocate both global positions before either projection fold.
                // Stream locks remain independent; only the adapter gate orders
                // the ensuing folds and commits.
                let (watch, post) = if watch_event_first {
                    let watch =
                        eventstore::append_in_tx(&mut watch_tx, subscription, &[watch_input])
                            .await
                            .unwrap()
                            .remove(0);
                    let post = eventstore::append_in_tx(&mut post_tx, fixture.topic, &[post_input])
                        .await
                        .unwrap()
                        .remove(0);
                    (watch, post)
                } else {
                    let post = eventstore::append_in_tx(&mut post_tx, fixture.topic, &[post_input])
                        .await
                        .unwrap()
                        .remove(0);
                    let watch =
                        eventstore::append_in_tx(&mut watch_tx, subscription, &[watch_input])
                            .await
                            .unwrap()
                            .remove(0);
                    (watch, post)
                };
                assert_eq!(watch.seq < post.seq, watch_event_first);
                let post_seq = post.seq;
                let topic = fixture.topic;
                if watch_commits_first {
                    crate::fold_subscription_event(&mut watch_tx, subscription, &watch)
                        .await
                        .unwrap();
                    let posting = tokio::spawn(async move {
                        crate::fold_discussion_event(&mut post_tx, topic, &post)
                            .await
                            .unwrap();
                        post_tx.commit().await.unwrap();
                    });
                    wait_for_blocker(&pool, post_pid, watch_pid).await;
                    watch_tx.commit().await.unwrap();
                    tokio::time::timeout(Duration::from_secs(5), posting)
                        .await
                        .expect("post fold completes after the gate is released")
                        .unwrap();
                } else {
                    crate::fold_discussion_event(&mut post_tx, topic, &post)
                        .await
                        .unwrap();
                    let watching = tokio::spawn(async move {
                        crate::fold_subscription_event(&mut watch_tx, subscription, &watch)
                            .await
                            .unwrap();
                        watch_tx.commit().await.unwrap();
                    });
                    wait_for_blocker(&pool, watch_pid, post_pid).await;
                    post_tx.commit().await.unwrap();
                    tokio::time::timeout(Duration::from_secs(5), watching)
                        .await
                        .expect("watch fold completes after the gate is released")
                        .unwrap();
                }
                let delivered = enable == watch_event_first;
                let result = inbox(&pool, fixture.watcher).await;
                assert_eq!(
                    result.items.len(),
                    usize::from(delivered),
                    "enable={enable}, watch_event_first={watch_event_first}, watch_commits_first={watch_commits_first}"
                );
                assert_eq!(result.unread_count, i64::from(delivered));
                if let Some(item) = result.items.first() {
                    assert_eq!(item.source_seq, post_seq);
                    assert_eq!(item.delivery_seq, post_seq);
                    assert_eq!(item.reason, "watch");
                    assert_eq!(item.subscribed, enable);
                }
                assert_independent_rebuilds(&pool, &fixture, subscription).await;
            }
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn historical_forum_actor_suppresses_self_delivery_without_profile_attribution(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let author_watch = subscribe(&pool, fixture.author, fixture.topic).await;
    let reader_watch = subscribe(&pool, fixture.watcher, fixture.topic).await;
    crate::append_discussion_and_project(
        &pool,
        fixture.topic,
        &[EventInput::new(
            forum::POST_SUBMITTED,
            1,
            serde_json::json!({"body":"Historical post without profile attribution"}),
            ActorId::Principal(fixture.author),
            6,
        )],
    )
    .await
    .unwrap();
    assert!(inbox(&pool, fixture.author).await.items.is_empty());
    assert_eq!(inbox(&pool, fixture.watcher).await.items.len(), 1);
    assert_independent_rebuilds(&pool, &fixture, reader_watch).await;
    for topic_first in [true, false] {
        for rebuild_topic in [topic_first, !topic_first] {
            if rebuild_topic {
                crate::rebuild_discussion_stream(&pool, fixture.topic)
                    .await
                    .unwrap();
            } else {
                crate::rebuild_subscription_stream(&pool, author_watch)
                    .await
                    .unwrap();
            }
            assert!(inbox(&pool, fixture.author).await.items.is_empty());
            assert!(reasons(&pool, fixture.author).await.is_empty());
            assert_eq!(inbox(&pool, fixture.watcher).await.items.len(), 1);
        }
    }
}

async fn start_game(pool: &PgPool, fixture: &Fixture, origin: bool) -> Uuid {
    let game = Uuid::new_v4();
    let artifact = content_registry::select_pack_artifact("mafiascum").unwrap();
    let mut payload = serde_json::json!({"host_principal_id":fixture.author,"pack_ref":artifact.pack_ref,"pack_artifact":artifact});
    if origin {
        payload["origin"] = serde_json::json!({"surface_id":fixture.topic,"source_seq":0});
    }
    crate::append_and_project(
        pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                payload,
                ActorId::Principal(fixture.author),
                8,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({"phase_id":"D01"}),
                ActorId::Host,
                9,
            ),
        ],
    )
    .await
    .unwrap();
    game
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_watch_rebuild_never_manufactures_public_post_delivery(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let game = start_game(&pool, &fixture, false).await;
    let subscription = subscribe(&pool, fixture.watcher, game).await;
    crate::append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({"channel_id":"main","author":{"kind":"host_narrator"},"body":"Public game post","phase_id":"D01"}),
            ActorId::Host,
            10,
        )],
    )
    .await
    .unwrap();
    let expected = inbox(&pool, fixture.watcher).await;
    assert!(expected.items.is_empty());
    assert!(reasons(&pool, fixture.watcher).await.is_empty());
    for game_first in [true, false] {
        for rebuild_game in [game_first, !game_first] {
            if rebuild_game {
                crate::rebuild(&pool, game).await.unwrap();
            } else {
                crate::rebuild_subscription_stream(&pool, subscription)
                    .await
                    .unwrap();
            }
            assert_eq!(inbox(&pool, fixture.watcher).await, expected);
            assert!(reasons(&pool, fixture.watcher).await.is_empty());
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn watch_reconciliation_preserves_mentions_and_origin_delivery(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let subscription = subscribe(&pool, fixture.watcher, fixture.topic).await;
    let game = start_game(&pool, &fixture, true).await;
    crate::append_discussion_and_project(
        &pool,
        fixture.topic,
        &[EventInput::new(
            forum::POST_SUBMITTED,
            1,
            serde_json::json!({"body":"@watcher reply","author_profile_id":fixture.author_profile,"mentions":[{"profile_id":fixture.watcher_profile,"span":{"offset":0,"len":8}}]}),
            ActorId::Principal(fixture.author),
            10,
        )],
    )
    .await
    .unwrap();
    let before_reasons = reasons(&pool, fixture.watcher).await;
    assert_eq!(before_reasons.len(), 3);
    for reason in ["watch", "mention", "game_spawned_from_watched_topic"] {
        assert!(before_reasons.iter().any(|row| row.3 == reason));
    }
    let before = inbox(&pool, fixture.watcher).await;
    assert_eq!(
        before.items.len(),
        2,
        "watch and mention share one inbox item"
    );
    assert_independent_rebuilds(&pool, &fixture, subscription).await;
    crate::unsubscribe_from_public_target(
        &pool,
        WatchTarget {
            surface_id: fixture.topic,
        },
        fixture.watcher,
        11,
    )
    .await
    .unwrap();
    assert_eq!(reasons(&pool, fixture.watcher).await, before_reasons);
    assert_independent_rebuilds(&pool, &fixture, subscription).await;
    let after_unsubscribe = inbox(&pool, fixture.watcher).await;
    crate::rebuild(&pool, game).await.unwrap();
    assert_eq!(inbox(&pool, fixture.watcher).await, after_unsubscribe);
    assert_eq!(reasons(&pool, fixture.watcher).await, before_reasons);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn topic_rebuild_waits_for_attention_before_destructive_projection_writes(pool: PgPool) {
    let fixture = fixture(&pool).await;
    let subscription = subscribe(&pool, fixture.watcher, fixture.topic).await;
    crate::append_discussion_and_project(&pool, fixture.topic, &[post_event(&fixture)])
        .await
        .unwrap();
    let mut watch_tx = pool.begin().await.unwrap();
    let blocker: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *watch_tx)
        .await
        .unwrap();
    let watch =
        eventstore::append_in_tx(&mut watch_tx, subscription, &[watch_event(&fixture, false)])
            .await
            .unwrap();
    crate::fold_subscription_event(&mut watch_tx, subscription, &watch[0])
        .await
        .unwrap();
    let replay_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let waiter: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&replay_pool)
        .await
        .unwrap();
    let topic = fixture.topic;
    let replay = tokio::spawn(async move {
        crate::rebuild_discussion_stream(&replay_pool, topic)
            .await
            .unwrap();
        replay_pool.close().await;
    });
    wait_for_blocker(&pool, waiter, blocker).await;
    let wrote_projection: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid = $1 AND granted AND mode = 'RowExclusiveLock' AND relation IN ('discussion_topic'::regclass, 'discussion_post'::regclass, 'publication_surface'::regclass, 'member_inbox_item'::regclass))",
    )
    .bind(waiter)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !wrote_projection,
        "rebuild must acquire the attention gate before deleting a projection"
    );
    watch_tx.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), replay)
        .await
        .expect("topic rebuild completes after the gate is released")
        .unwrap();
    assert_eq!(inbox(&pool, fixture.watcher).await.items.len(), 1);
    assert_independent_rebuilds(&pool, &fixture, subscription).await;
}
