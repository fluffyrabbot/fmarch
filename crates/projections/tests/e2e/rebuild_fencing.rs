//! Observe actual PostgreSQL lock waits rather than guessing task ordering.
use super::*;
use std::time::Duration;

async fn replay_pool(pool: &PgPool) -> (PgPool, i32) {
    let replay = PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&replay)
        .await
        .unwrap();
    (replay, pid)
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
    .expect("replay must wait for the identified transaction");
}

fn role(role_key: &str) -> EventInput {
    EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({"slot_id": "slot_1", "role_key": role_key, "alignment": "town"}),
        ActorId::Host,
        1,
    )
}

async fn game_writer_wins(pool: &PgPool, audit: bool) {
    let game = Uuid::new_v4();
    append_and_project(pool, game, &[role("original")])
        .await
        .unwrap();
    let mut writer = pool.begin().await.unwrap();
    eventstore::lock_stream_in_tx(&mut writer, game)
        .await
        .unwrap();
    let writer_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(pool).await;
    let task = tokio::spawn(async move {
        if audit {
            assert!(audit_rebuild(&replay, game).await.unwrap().ok);
        } else {
            rebuild(&replay, game).await.unwrap();
        }
        replay.close().await;
    });
    wait_for_blocker(pool, replay_pid, writer_pid).await;
    // This event did not exist when replay started waiting. Both the replay
    // input and an audit's baseline must be read after this transaction commits.
    projections::append_and_project_in_tx(&mut writer, game, &[role("replacement")])
        .await
        .unwrap();
    writer.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    let rows = slot_state(pool, game).await.unwrap();
    assert_eq!(rows[0].role_key.as_deref(), Some("replacement"));
    assert_eq!(eventstore::load_stream(pool, game).await.unwrap().len(), 2);
    assert!(audit_rebuild(pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_rebuild_reads_after_concurrent_writer_commit(pool: PgPool) {
    game_writer_wins(&pool, false).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_audit_fences_its_baseline_before_concurrent_writer_commit(pool: PgPool) {
    game_writer_wins(&pool, true).await;
}

fn post(body: &str) -> EventInput {
    EventInput::new(
        forum::POST_SUBMITTED,
        1,
        serde_json::json!({"body": body}),
        ActorId::Principal(auxiliary_principal(9001)),
        3,
    )
}

async fn topic_fixture(pool: &PgPool) -> Uuid {
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({"slug": "replay", "title": "Replay", "description": "Fencing"}),
            ActorId::Principal(auxiliary_principal(9001)),
            1,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        pool,
        topic,
        &[
            EventInput::new(
                forum::TOPIC_CREATED,
                1,
                serde_json::json!({"area_id": area, "title": "Concurrent replay"}),
                ActorId::Principal(auxiliary_principal(9001)),
                2,
            ),
            post("original"),
        ],
    )
    .await
    .unwrap();
    topic
}

async fn assert_both_posts(pool: &PgPool, topic: Uuid) {
    let bodies: Vec<String> = sqlx::query_scalar(
        "SELECT body FROM discussion_post WHERE topic_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(bodies, ["original", "concurrent"]);
    assert_eq!(
        discussion_topic_by_id(pool, topic)
            .await
            .unwrap()
            .unwrap()
            .post_count,
        2
    );
    assert_eq!(eventstore::load_stream(pool, topic).await.unwrap().len(), 3);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_rebuild_preserves_post_committed_while_waiting(pool: PgPool) {
    let topic = topic_fixture(&pool).await;
    let mut writer = pool.begin().await.unwrap();
    eventstore::lock_stream_in_tx(&mut writer, topic)
        .await
        .unwrap();
    let writer_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(&pool).await;
    let task = tokio::spawn(async move {
        rebuild_discussion_stream(&replay, topic).await.unwrap();
        replay.close().await;
    });
    wait_for_blocker(&pool, replay_pid, writer_pid).await;
    projections::append_discussion_and_project_in_tx(&mut writer, topic, &[post("concurrent")])
        .await
        .unwrap();
    writer.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_both_posts(&pool, topic).await;
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_both_posts(&pool, topic).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_rebuild_holds_stream_fence_during_projection_replacement(pool: PgPool) {
    let topic = topic_fixture(&pool).await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT topic_id FROM discussion_topic WHERE topic_id = $1 FOR UPDATE")
        .bind(topic)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let blocker_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(&pool).await;
    let task = tokio::spawn(async move {
        rebuild_discussion_stream(&replay, topic).await.unwrap();
        replay.close().await;
    });
    wait_for_blocker(&pool, replay_pid, blocker_pid).await;
    let mut writer = pool.begin().await.unwrap();
    assert!(
        !eventstore::try_lock_stream_in_tx(&mut writer, topic)
            .await
            .unwrap(),
        "a writer must not enter while replay is replacing projections"
    );
    writer.rollback().await.unwrap();
    blocker.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    append_discussion_and_project(&pool, topic, &[post("concurrent")])
        .await
        .unwrap();
    assert_both_posts(&pool, topic).await;
}

#[derive(Clone, Copy)]
enum CommunityFamily {
    Moderation,
    Subscription,
    Mute,
    InboxCursor,
}

#[derive(Clone, Copy)]
struct CommunityFixture {
    family: CommunityFamily,
    stream: Uuid,
    principal: PrincipalId,
    surface: Uuid,
    read_through: i64,
}

impl CommunityFixture {
    async fn create(pool: &PgPool, family: CommunityFamily) -> Self {
        let principal = auxiliary_principal(9100);
        ensure_auxiliary_principal(pool, principal).await;
        let mut fixture = Self {
            family,
            stream: Uuid::nil(),
            principal,
            surface: Uuid::nil(),
            read_through: 9,
        };
        match family {
            CommunityFamily::Moderation => {
                fixture.surface = topic_fixture(pool).await;
                let source_seq: i64 = sqlx::query_scalar(
                    "SELECT source_seq FROM discussion_post WHERE topic_id = $1",
                )
                .bind(fixture.surface)
                .fetch_one(pool)
                .await
                .unwrap();
                projections::submit_moderation_report(
                    pool,
                    ModerationTarget {
                        public: PublicContentRef::new(fixture.surface, source_seq),
                    },
                    Uuid::new_v4(),
                    principal,
                    ReportReasonFamily::Harassment,
                    "concurrent moderation".into(),
                    10,
                )
                .await
                .unwrap();
                fixture.stream =
                    sqlx::query_scalar("SELECT case_id FROM moderation_case WHERE surface_id = $1")
                        .bind(fixture.surface)
                        .fetch_one(pool)
                        .await
                        .unwrap();
            }
            CommunityFamily::Subscription => {
                fixture.surface = topic_fixture(pool).await;
                projections::subscribe_to_public_target(
                    pool,
                    WatchTarget {
                        surface_id: fixture.surface,
                    },
                    principal,
                    10,
                )
                .await
                .unwrap();
                fixture.stream = sqlx::query_scalar(
                    "SELECT subscription_id FROM public_watch WHERE principal_id = $1",
                )
                .bind(principal.as_uuid())
                .fetch_one(pool)
                .await
                .unwrap();
                let stored = append_discussion_and_project(
                    pool,
                    fixture.surface,
                    &[post("new unread post")],
                )
                .await
                .unwrap();
                fixture.read_through = stored[0].seq;
            }
            CommunityFamily::Mute => {
                let author = auxiliary_principal(9101);
                ensure_auxiliary_principal(pool, author).await;
                fixture.surface = create_auxiliary_profile(
                    pool,
                    author,
                    "replay_target",
                    "Replay Target",
                    "Profile used by the concurrent mute proof",
                    ProfileVisibility::Public,
                    1,
                )
                .await;
                projections::mute_public_profile(pool, principal, "replay_target", 10)
                    .await
                    .unwrap();
                fixture.stream = sqlx::query_scalar(
                    "SELECT relationship_id FROM profile_mute WHERE principal_id = $1",
                )
                .bind(principal.as_uuid())
                .fetch_one(pool)
                .await
                .unwrap();
            }
            CommunityFamily::InboxCursor => {
                fixture.stream = attention::inbox_cursor_stream_id(principal);
                projections::advance_member_inbox_read_cursor(pool, principal, 4, 10)
                    .await
                    .unwrap();
            }
        }
        fixture
    }

    async fn rebuild(self, pool: &PgPool) {
        match self.family {
            CommunityFamily::Moderation => {
                projections::rebuild_moderation_stream(pool, self.stream).await
            }
            CommunityFamily::Subscription => {
                projections::rebuild_subscription_stream(pool, self.stream).await
            }
            CommunityFamily::Mute => {
                projections::rebuild_member_mute_stream(pool, self.stream).await
            }
            CommunityFamily::InboxCursor => {
                projections::rebuild_member_inbox_cursor_stream(pool, self.stream).await
            }
        }
        .unwrap();
    }

    // Exercise the ordinary application write paths, including their domain
    // decisions, expected-version appends and synchronous projection folds.
    async fn mutate(self, pool: &PgPool) {
        match self.family {
            CommunityFamily::Moderation => {
                let state = projections::moderation_case_state(pool, self.stream)
                    .await
                    .unwrap()
                    .unwrap();
                let events = trust_safety::decide_moderation(
                    Some(&state),
                    ModerationCommand::Hide {
                        reason: "confirmed".into(),
                    },
                )
                .unwrap();
                projections::append_moderation_and_project_expected(
                    pool,
                    self.stream,
                    state.version,
                    events,
                    self.principal,
                    11,
                )
                .await
                .unwrap();
            }
            CommunityFamily::Subscription => {
                projections::advance_subscription_read_cursor(
                    pool,
                    WatchTarget {
                        surface_id: self.surface,
                    },
                    self.principal,
                    self.read_through,
                    11,
                )
                .await
                .unwrap();
            }
            CommunityFamily::Mute => {
                projections::unmute_public_profile(pool, self.principal, "replay_target", 11)
                    .await
                    .unwrap();
            }
            CommunityFamily::InboxCursor => {
                projections::advance_member_inbox_read_cursor(
                    pool,
                    self.principal,
                    self.read_through,
                    11,
                )
                .await
                .unwrap();
            }
        }
    }

    fn projection_lock(self) -> (&'static str, Uuid) {
        match self.family {
            CommunityFamily::Moderation => (
                "SELECT case_id FROM moderation_case WHERE case_id = $1 FOR UPDATE",
                self.stream,
            ),
            CommunityFamily::Subscription => (
                "SELECT subscription_id FROM public_watch WHERE subscription_id = $1 FOR UPDATE",
                self.stream,
            ),
            CommunityFamily::Mute => (
                "SELECT relationship_id FROM profile_mute WHERE relationship_id = $1 FOR UPDATE",
                self.stream,
            ),
            CommunityFamily::InboxCursor => (
                "SELECT principal_id FROM member_inbox_cursor WHERE principal_id = $1 FOR UPDATE",
                self.principal.as_uuid(),
            ),
        }
    }

    async fn assert_current(self, pool: &PgPool) {
        let events = eventstore::load_stream(pool, self.stream).await.unwrap();
        let last = events.last().unwrap();
        let (sql, id, expected_value, expected_events) = match self.family {
            CommunityFamily::Moderation => (
                "SELECT status, updated_seq, version FROM moderation_case WHERE case_id = $1",
                self.stream, "hidden".to_string(), 3,
            ),
            CommunityFamily::Subscription => (
                "SELECT read_through_seq::text, updated_seq, version FROM public_watch WHERE subscription_id = $1",
                self.stream, self.read_through.to_string(), 2,
            ),
            CommunityFamily::Mute => (
                "SELECT active::text, updated_seq, version FROM profile_mute WHERE relationship_id = $1",
                self.stream, "false".to_string(), 2,
            ),
            CommunityFamily::InboxCursor => (
                "SELECT read_through_seq::text, updated_seq, version FROM member_inbox_cursor WHERE principal_id = $1",
                self.principal.as_uuid(), self.read_through.to_string(), 2,
            ),
        };
        assert_eq!(events.len(), expected_events);
        let row: (String, i64, i64) = sqlx::query_as(sql).bind(id).fetch_one(pool).await.unwrap();
        assert_eq!(row, (expected_value, last.seq, last.stream_seq));
        if matches!(self.family, CommunityFamily::Moderation) {
            let visible: bool =
                sqlx::query_scalar("SELECT visible FROM public_publication WHERE surface_id = $1")
                    .bind(self.surface)
                    .fetch_one(pool)
                    .await
                    .unwrap();
            assert!(!visible, "committed moderation must remain enforced");
            let visibility: String = sqlx::query_scalar(
                "SELECT visibility FROM moderation_target_state WHERE surface_id = $1",
            )
            .bind(self.surface)
            .fetch_one(pool)
            .await
            .unwrap();
            assert_eq!(visibility, "hidden");
        }
    }
}

async fn community_writer_first(pool: &PgPool, family: CommunityFamily) {
    let fixture = CommunityFixture::create(pool, family).await;
    let mut barrier = pool.begin().await.unwrap();
    eventstore::lock_stream_in_tx(&mut barrier, fixture.stream)
        .await
        .unwrap();
    let barrier_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *barrier)
        .await
        .unwrap();
    let (writer, writer_pid) = replay_pool(pool).await;
    let write = tokio::spawn(async move {
        fixture.mutate(&writer).await;
        writer.close().await;
    });
    wait_for_blocker(pool, writer_pid, barrier_pid).await;
    let (replay, replay_pid) = replay_pool(pool).await;
    let rebuild = tokio::spawn(async move {
        fixture.rebuild(&replay).await;
        replay.close().await;
    });
    // PostgreSQL reports the earlier queued writer as a soft blocker. Replay
    // must queue behind it before reading any events, not just before DELETE.
    wait_for_blocker(pool, replay_pid, writer_pid).await;
    barrier.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        write.await.unwrap();
        rebuild.await.unwrap();
    })
    .await
    .unwrap();
    fixture.assert_current(pool).await;
    fixture.rebuild(pool).await;
    fixture.assert_current(pool).await;
}

async fn community_rebuild_first(pool: &PgPool, family: CommunityFamily) {
    let fixture = CommunityFixture::create(pool, family).await;
    let mut barrier = pool.begin().await.unwrap();
    let (sql, id) = fixture.projection_lock();
    sqlx::query(sql)
        .bind(id)
        .fetch_one(&mut *barrier)
        .await
        .unwrap();
    let barrier_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *barrier)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(pool).await;
    let rebuild = tokio::spawn(async move {
        fixture.rebuild(&replay).await;
        replay.close().await;
    });
    wait_for_blocker(pool, replay_pid, barrier_pid).await;
    // Probe before starting the writer so only replay can own this fence.
    // A writer blocked later on projection rows must not satisfy this assertion.
    let mut probe = pool.begin().await.unwrap();
    assert!(
        !eventstore::try_lock_stream_in_tx(&mut probe, fixture.stream)
            .await
            .unwrap()
    );
    probe.rollback().await.unwrap();
    let (writer, writer_pid) = replay_pool(pool).await;
    let write = tokio::spawn(async move {
        fixture.mutate(&writer).await;
        writer.close().await;
    });
    wait_for_blocker(pool, writer_pid, replay_pid).await;
    barrier.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        rebuild.await.unwrap();
        write.await.unwrap();
    })
    .await
    .unwrap();
    fixture.assert_current(pool).await;
    fixture.rebuild(pool).await;
    fixture.assert_current(pool).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn moderation_rebuild_reads_after_writer_commit(pool: PgPool) {
    community_writer_first(&pool, CommunityFamily::Moderation).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn moderation_rebuild_holds_fence_through_replacement(pool: PgPool) {
    community_rebuild_first(&pool, CommunityFamily::Moderation).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn subscription_rebuild_reads_after_writer_commit(pool: PgPool) {
    community_writer_first(&pool, CommunityFamily::Subscription).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn subscription_rebuild_holds_fence_through_replacement(pool: PgPool) {
    community_rebuild_first(&pool, CommunityFamily::Subscription).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn mute_rebuild_reads_after_writer_commit(pool: PgPool) {
    community_writer_first(&pool, CommunityFamily::Mute).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn mute_rebuild_holds_fence_through_replacement(pool: PgPool) {
    community_rebuild_first(&pool, CommunityFamily::Mute).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn inbox_cursor_rebuild_reads_after_writer_commit(pool: PgPool) {
    community_writer_first(&pool, CommunityFamily::InboxCursor).await;
}
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn inbox_cursor_rebuild_holds_fence_through_replacement(pool: PgPool) {
    community_rebuild_first(&pool, CommunityFamily::InboxCursor).await;
}
