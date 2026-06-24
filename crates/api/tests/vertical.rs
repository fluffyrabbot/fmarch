use api::ApiState;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{
    ClientEnvelope, ClientMsg, Command, CommandMsg, PlayerInvestigationResult, PlayerNotification,
    ProjectionDelta, RejectCode, RejectMsg, ServerEnvelope, ServerMsg, SlotLifecycle, ThreadPage,
    VoteTarget, PROTOCOL_VERSION,
};

fn router(pool: sqlx::PgPool) -> axum::Router {
    api::router(pool)
}

fn router_with_dev_auth(pool: sqlx::PgPool) -> axum::Router {
    api::router_with_state(ApiState::new(pool).with_dev_auth(true))
}

fn stable_command_id(id: u64) -> Uuid {
    Uuid::from_u128(id as u128)
}

fn command_envelope_with_command_id(
    id: u64,
    command_id: Uuid,
    principal_user_id: &str,
    command: Command,
) -> ClientEnvelope {
    ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id,
            principal_user_id: principal_user_id.to_string(),
            command,
        }),
    )
}

async fn post_command(
    app: axum::Router,
    id: u64,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    post_command_with_command_id(app, id, stable_command_id(id), principal_user_id, command).await
}

async fn post_command_with_command_id(
    app: axum::Router,
    id: u64,
    command_id: Uuid,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    let body = serde_json::to_vec(&command_envelope_with_command_id(
        id,
        command_id,
        principal_user_id,
        command,
    ))
    .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn expect_ack(envelope: ServerEnvelope) -> Vec<i64> {
    match envelope.body {
        ServerMsg::Ack(ack) => {
            assert!(!ack.stream_seqs.is_empty());
            ack.stream_seqs
        }
        other => panic!("expected Ack, got {other:?}"),
    }
}

fn expect_reject(envelope: ServerEnvelope, expected: RejectCode) {
    match envelope.body {
        ServerMsg::Reject(reject) => assert_eq!(reject.error, expected),
        other => panic!("expected Reject({expected:?}), got {other:?}"),
    }
}

async fn seed_single_vote_game(app: axum::Router, game: Uuid) {
    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_2".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_3".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            6,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            7,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_2".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            8,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_3".into(),
                user: "user_b".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            9,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_3".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            10,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app,
            11,
            "user_a",
            Command::SubmitVote {
                game,
                actor_slot: "slot_1".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await,
    );
}

async fn seed_beloved_princess_ready_to_resolve(app: axum::Router, game: Uuid) {
    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (base, slot, user_id, role) in [
        (10, "slot_1", "user_1", "beloved_princess"),
        (20, "slot_2", "user_2", "vanilla_townie"),
        (30, "slot_3", "user_3", "vanilla_townie"),
        (40, "slot_4", "user_4", "mafia_goon"),
        (50, "slot_5", "user_5", "mafia_goon"),
        (60, "slot_6", "user_6", "vanilla_townie"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                base,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                base + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user_id.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                base + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            80,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    for (id, user, actor_slot) in [
        (81, "user_2", "slot_2"),
        (82, "user_3", "slot_3"),
        (83, "user_4", "slot_4"),
        (84, "user_5", "slot_5"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::Slot("slot_1".into()),
                },
            )
            .await,
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_command_boundary_updates_votecount(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/votecount"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let deltas: Vec<ProjectionDelta> = serde_json::from_slice(&bytes).unwrap();

    assert!(deltas.iter().any(|delta| matches!(
        delta,
        ProjectionDelta::VoteCountChanged(v)
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 1
    )));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_can_publish_projection_derived_votecount_to_thread(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    expect_reject(
        post_command(
            app.clone(),
            12,
            "user_a",
            Command::PublishVotecount { game },
        )
        .await,
        RejectCode::NotHost,
    );
    expect_ack(
        post_command(
            app.clone(),
            13,
            "host_h",
            Command::PublishVotecount { game },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    let official = page
        .posts
        .iter()
        .find(|post| post.body.starts_with("Official votecount for D01"))
        .expect("official votecount post");

    assert_eq!(official.author_user.as_deref(), Some("host"));
    assert_eq!(official.author_slot, None);
    assert!(official.body.contains("- slot_2: 1"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_sends_initial_votecount_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_a"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let delta = socket.next().await.unwrap().unwrap();
    let delta: ServerEnvelope = serde_json::from_str(&delta.into_text().unwrap()).unwrap();
    assert_eq!(delta.id, 1);
    assert!(matches!(
        delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 1
    ));

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_streams_command_following_votecount_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_b"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_delta = socket.next().await.unwrap().unwrap();
    let initial_delta: ServerEnvelope =
        serde_json::from_str(&initial_delta.into_text().unwrap()).unwrap();
    assert!(matches!(
        initial_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game && v.candidate_slot == "slot_2" && v.count == 1
    ));
    let initial_thread = socket.next().await.unwrap().unwrap();
    let initial_thread: ServerEnvelope =
        serde_json::from_str(&initial_thread.into_text().unwrap()).unwrap();
    assert_eq!(initial_thread.id, 2);
    assert!(matches!(
        initial_thread.body,
        ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(t))
            if t.game == game
    ));

    expect_ack(
        post_command(
            app,
            12,
            "user_b",
            Command::SubmitVote {
                game,
                actor_slot: "slot_3".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await,
    );

    let live_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::VoteCountChanged(ref v))
                    if v.game == game
                        && v.phase_id == "D01"
                        && v.candidate_slot == "slot_2"
                        && v.count == 2
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("game websocket should receive command-following votecount delta");
    assert!(live_delta.id >= 3);
    assert!(matches!(
        live_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 2
    ));

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_streams_votecount_clear_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_a"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_delta = socket.next().await.unwrap().unwrap();
    let initial_delta: ServerEnvelope =
        serde_json::from_str(&initial_delta.into_text().unwrap()).unwrap();
    assert!(matches!(
        initial_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game && v.candidate_slot == "slot_2" && v.count == 1
    ));
    let initial_thread = socket.next().await.unwrap().unwrap();
    let initial_thread: ServerEnvelope =
        serde_json::from_str(&initial_thread.into_text().unwrap()).unwrap();
    assert_eq!(initial_thread.id, 2);
    assert!(matches!(
        initial_thread.body,
        ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(t))
            if t.game == game
    ));

    expect_ack(
        post_command(
            app,
            12,
            "user_a",
            Command::WithdrawVote {
                game,
                actor_slot: "slot_1".into(),
            },
        )
        .await,
    );

    let live_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::VoteCountCleared(ref v))
                    if v.game == game
                        && v.phase_id == "D01"
                        && v.candidate_slot == "slot_2"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("game websocket should receive command-following votecount clear delta");
    assert!(live_delta.id >= 3);
    assert!(matches!(
        live_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountCleared(v))
            if v.game == game && v.phase_id == "D01" && v.candidate_slot == "slot_2"
    ));

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_streams_thread_delta_after_official_votecount(
    pool: sqlx::PgPool,
) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_a"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_thread = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive initial thread projection");
    assert!(
        matches!(
            &initial_thread.body,
            ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                if delta.posts.iter().all(|post| !post.body.starts_with("Official votecount"))
        ),
        "seeded game should not already contain an official count post"
    );

    expect_ack(post_command(app, 13, "host_h", Command::PublishVotecount { game }).await);

    let thread_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.iter().any(|post|
                            post.author_user.as_deref() == Some("host")
                                && post.body.starts_with("Official votecount for D01")
                                && post.body.contains("- slot_2: 1")
                        )
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host-published official count should stream as a thread delta");
    assert!(thread_delta.id > initial_thread.id);

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_host_connection_streams_command_following_host_prompts_delta(
    pool: sqlx::PgPool,
) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_beloved_princess_ready_to_resolve(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=host_h"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_empty_prompts = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(ref delta))
                    if delta.game == game && delta.prompts.is_empty()
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host websocket should receive the initial empty prompt projection");
    assert!(
        initial_empty_prompts.id > 0,
        "initial prompt delta should be a server projection frame"
    );

    expect_ack(
        post_command(
            app,
            90,
            "host_h",
            Command::ResolvePhase { game, seed: 7421 },
        )
        .await,
    );

    let prompt_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(ref delta))
                    if delta.game == game
                        && delta.prompts.iter().any(|prompt|
                            prompt.prompt_id == "D01:skip_next_day:slot_1"
                                && prompt.kind == "skip_next_day"
                                && prompt.status == "pending"
                                && prompt.reason == "beloved_princess_death"
                        )
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host websocket should receive command-following host prompt projection");
    assert!(
        prompt_delta.id > initial_empty_prompts.id,
        "command-following prompt delta should follow the initial projection"
    );

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_player_connection_streams_scoped_private_notification_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "chinese_structured".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cupid"),
        (5, "slot_2", "user_2", "villager"),
        (8, "slot_3", "user_3", "prophet"),
        (11, "slot_4", "user_4", "wolf"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            20,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            21,
            "user_1",
            Command::SubmitAction {
                game,
                action_id: "link_lovers_n01".into(),
                actor_slot: "slot_1".into(),
                template_id: "link_lovers".into(),
                targets: vec!["slot_2".into(), "slot_3".into()],
                grant_id: None,
            },
        )
        .await,
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_2"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_private = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::PlayerNotificationsChanged(ref delta))
                    if delta.game == game && delta.notifications.is_empty()
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive initial scoped notification projection");

    let initial_investigations = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::PlayerInvestigationResultsChanged(ref delta))
                    if delta.game == game && delta.results.is_empty()
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive initial scoped investigation projection");
    assert!(initial_investigations.id > initial_private.id);

    expect_ack(
        post_command(
            app,
            22,
            "host_h",
            Command::ResolvePhase { game, seed: 930601 },
        )
        .await,
    );

    let notification_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::PlayerNotificationsChanged(ref delta))
                    if delta.game == game
                        && delta.notifications.iter().any(|notice|
                            notice.audience_slot == "slot_2"
                                && notice.effect == "lovers_link"
                                && notice.status == "link_lovers_n01"
                        )
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive command-following scoped notification projection");
    assert!(notification_delta.id > initial_private.id);

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_day_vote_outcomes_returns_canonical_engine_result(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            11,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (idx, slot, user_id, role) in [
        (12, "slot_1", "user_1", "vanilla_townie"),
        (16, "slot_2", "user_2", "vanilla_townie"),
        (20, "slot_3", "user_3", "mafia_goon"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                idx,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                idx + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user_id.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                idx + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            24,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    for (idx, user_id, actor_slot) in [(25, "user_1", "slot_1"), (26, "user_2", "slot_2")] {
        expect_ack(
            post_command(
                app.clone(),
                idx,
                user_id,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::NoLynch,
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            27,
            "host_h",
            Command::ResolvePhase { game, seed: 606 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/day-vote-outcomes"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let deltas: Vec<ProjectionDelta> = serde_json::from_slice(&bytes).unwrap();

    assert!(deltas.iter().any(|delta| matches!(
        delta,
        ProjectionDelta::DayVoteOutcomeApplied(outcome)
            if outcome.game == game
                && outcome.phase_id == "D01"
                && outcome.status == "NoLynch"
                && outcome.winner_slot.is_none()
                && outcome.tallies["no_lynch"] == serde_json::json!(2.0)
    )));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_thread_cold_load_returns_paginated_posts(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    for (id, body) in [(6, "one"), (7, "two"), (8, "three")] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "user_a",
                Command::SubmitPost {
                    game,
                    channel_id: "main".into(),
                    actor_slot: "slot_1".into(),
                    body: body.into(),
                },
            )
            .await,
        );
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread?limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        page.posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["two", "three"]
    );
    assert_eq!(page.posts[0].author_slot.as_deref(), Some("slot_1"));
    let before = page.next_before_seq.expect("older page cursor");

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread?before_seq={before}&limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let older: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(older.posts.len(), 1);
    assert_eq!(older.posts[0].body, "one");
    assert_eq!(older.next_before_seq, None);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_channel_thread_cold_load_is_channel_scoped_and_authorized(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO slot_occupancy (game_id, slot_id, occupant_user_id) VALUES ($1, 'slot_1', 'user_a')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO private_channel_member \
         (game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source) \
         VALUES ($1, 'role-pm', 'role_pm', 'slot_1', 'vanilla_townie', 'never', 'test')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    for (source_seq, channel_id, body) in [
        (10_i64, "main", "main thread post"),
        (11_i64, "role-pm", "private role note"),
    ] {
        sqlx::query(
            "INSERT INTO thread_view \
             (game_id, source_seq, stream_seq, channel_id, author_slot, author_user, phase_id, body, occurred_at) \
             VALUES ($1, $2, $2, $3, 'slot_1', NULL, 'D01', $4, 1781928000)",
        )
        .bind(game)
        .bind(source_seq)
        .bind(channel_id)
        .bind(body)
        .execute(&pool)
        .await
        .unwrap();
    }

    let app = router(pool);
    let main = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/channels/main/thread?limit=10"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(main.status(), StatusCode::OK);
    let bytes = to_bytes(main.into_body(), usize::MAX).await.unwrap();
    let main_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        main_page
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["main thread post"]
    );

    let private = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/role-pm/thread?principal_user_id=user_a&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(private.status(), StatusCode::OK);
    let bytes = to_bytes(private.into_body(), usize::MAX).await.unwrap();
    let private_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        private_page
            .posts
            .iter()
            .map(|post| (post.channel_id.as_str(), post.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("role-pm", "private role note")]
    );

    let denied = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/role-pm/thread?principal_user_id=user_b"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_private_channel_submit_post_requires_channel_membership(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    for (id, principal, command) in [
        (
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        ),
        (
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        ),
        (
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        ),
        (
            4,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            5,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }
    sqlx::query(
        "INSERT INTO private_channel_member \
         (game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source) \
         VALUES ($1, 'role-pm', 'role_pm', 'slot_1', 'vanilla_townie', 'never', 'test')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();

    expect_ack(
        post_command(
            app.clone(),
            6,
            "user_a",
            Command::SubmitPost {
                game,
                channel_id: "role-pm".into(),
                actor_slot: "slot_1".into(),
                body: "private role confirmation".into(),
            },
        )
        .await,
    );
    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' ORDER BY seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(payload["channel_id"], "role-pm");
    assert_eq!(payload["slot_or_user"]["slot"], "slot_1");
    assert_eq!(payload["phase_id"], "D01");
    assert!(payload.get("body").is_none());
    assert!(payload["body_private"]["ciphertext"].is_string());

    let private_thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/role-pm/thread?principal_user_id=user_a&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(private_thread.status(), StatusCode::OK);
    let bytes = to_bytes(private_thread.into_body(), usize::MAX)
        .await
        .unwrap();
    let private_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(private_page.posts[0].body, "private role confirmation");

    let denied = post_command(
        app,
        7,
        "user_a",
        Command::SubmitPost {
            game,
            channel_id: "scum-chat".into(),
            actor_slot: "slot_1".into(),
            body: "not a member".into(),
        },
    )
    .await;
    expect_reject(denied, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_faction_day_chat_is_command_declared_and_channel_scoped(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "encryptor_user", "encryptor"),
        (5, "slot_2", "goon_user", "mafia_goon"),
        (8, "slot_3", "traitor_user", "traitor"),
        (11, "slot_4", "town_user", "vanilla_townie"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            14,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    let members = projections::private_channel_members(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|member| member.channel_id == "private:mafia_day_chat")
        .map(|member| (member.slot_id, member.role_key, member.kind))
        .collect::<Vec<_>>();
    assert_eq!(
        members,
        vec![
            (
                "slot_1".to_string(),
                "encryptor".to_string(),
                "FactionDayChat".to_string()
            ),
            (
                "slot_2".to_string(),
                "mafia_goon".to_string(),
                "FactionDayChat".to_string()
            ),
        ],
        "StartGame should declare only eligible mafia faction-day-chat members",
    );

    expect_ack(
        post_command(
            app.clone(),
            15,
            "encryptor_user",
            Command::SubmitPost {
                game,
                channel_id: "private:mafia_day_chat".into(),
                actor_slot: "slot_1".into(),
                body: "day chat is live".into(),
            },
        )
        .await,
    );

    let allowed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:mafia_day_chat/thread?principal_user_id=goon_user&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
    let bytes = to_bytes(allowed.into_body(), usize::MAX).await.unwrap();
    let allowed_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        allowed_page
            .posts
            .iter()
            .map(|post| (post.channel_id.as_str(), post.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("private:mafia_day_chat", "day chat is live")]
    );

    let denied_read = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:mafia_day_chat/thread?principal_user_id=traitor_user&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied_read.status(), StatusCode::FORBIDDEN);

    let denied_post = post_command(
        app,
        16,
        "traitor_user",
        Command::SubmitPost {
            game,
            channel_id: "private:mafia_day_chat".into(),
            actor_slot: "slot_3".into(),
            body: "traitor should not enter".into(),
        },
    )
    .await;
    expect_reject(denied_post, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_action_commands_are_capability_gated_and_projected(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_7", "player_mira", "vanilla_townie"),
        (5, "slot_target", "player_target", "vanilla_townie"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            8,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            9,
            "player_mira",
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: "slot_7".into(),
                body: "Slot 7 check-in before replacement".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            10,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );

    expect_reject(
        post_command(
            app.clone(),
            11,
            "player_mira",
            Command::ExtendDeadline {
                game,
                phase: "D01".into(),
                at: 1_781_928_000,
            },
        )
        .await,
        RejectCode::NotHost,
    );
    expect_ack(
        post_command(
            app.clone(),
            12,
            "cohost_c",
            Command::ExtendDeadline {
                game,
                phase: "D01".into(),
                at: 1_781_928_000,
            },
        )
        .await,
    );

    expect_reject(
        post_command(
            app.clone(),
            13,
            "cohost_c",
            Command::ProcessReplacement {
                game,
                slot: "slot_7".into(),
                outgoing_user: "player_mira".into(),
                incoming_user: "player_rowan".into(),
            },
        )
        .await,
        RejectCode::NotHost,
    );
    expect_ack(
        post_command(
            app.clone(),
            14,
            "host_h",
            Command::ProcessReplacement {
                game,
                slot: "slot_7".into(),
                outgoing_user: "player_mira".into(),
                incoming_user: "player_rowan".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            15,
            "host_h",
            Command::SetSlotStatus {
                game,
                slot: "slot_7".into(),
                status: SlotLifecycle::Modkilled,
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-console-state?principal_user_id=host_h&slot_id=slot_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["phase"]["phase_id"], "D01");
    assert_eq!(state["phase"]["deadline"], 1_781_928_000);
    assert_eq!(state["slots"][0]["slot_id"], "slot_7");
    assert_eq!(state["slots"][0]["occupant_user_id"], "player_rowan");
    assert_eq!(state["slots"][0]["alive"], false);
    assert_eq!(state["slots"][0]["status"], "modkilled");
    assert_eq!(state["thread_posts"][0]["author_slot"], "slot_7");
    assert_eq!(
        state["thread_posts"][0]["body"],
        "Slot 7 check-in before replacement"
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-console-state?principal_user_id=player_mira&slot_id=slot_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn opaque_auth_session_resolves_committed_host_capabilities(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );

    let disabled_app = router(pool.clone());
    let disabled_response = disabled_app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "dev-token",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(disabled_response.status(), StatusCode::NOT_FOUND);

    let missing_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "opaque-host-session-token",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer opaque-host-session-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "host_h");
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dev_global_admin_session_round_trips_global_capability(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "opaque-admin-session-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "admin_a");
    assert_eq!(session["capabilities"][0]["kind"], "GlobalAdmin");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer opaque-admin-session-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["capabilities"][0]["kind"], "GlobalAdmin");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn global_admin_can_issue_scoped_operator_session_grants(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "grant-admin-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-grants")
                .header("content-type", "application/json")
                .header("authorization", "Bearer grant-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "token": "granted-global-mod-token",
                        "principal_user_id": "mod_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalMod"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "mod_a");
    assert_eq!(session["capabilities"][0]["kind"], "GlobalMod");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer granted-global-mod-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "mod_a");
    assert_eq!(session["capabilities"][0]["kind"], "GlobalMod");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-grants")
                .header("content-type", "application/json")
                .header("authorization", "Bearer granted-global-mod-token")
                .body(Body::from(
                    serde_json::json!({
                        "token": "forbidden-admin-token",
                        "principal_user_id": "other_admin",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn duplicate_command_id_returns_original_ack_without_duplicate_post(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    let command_id = Uuid::new_v4();
    let command = Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
        body: "commit happened; ack vanished".into(),
    };

    let first_ack = expect_ack(
        post_command_with_command_id(app.clone(), 5, command_id, "user_a", command.clone()).await,
    );
    let retry_ack =
        expect_ack(post_command_with_command_id(app, 6, command_id, "user_a", command).await);
    assert_eq!(retry_ack, first_ack);

    let post_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(post_count, 1, "retry must not append a duplicate post");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_notifications_are_capability_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "chinese_structured".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cupid"),
        (5, "slot_2", "user_2", "villager"),
        (8, "slot_3", "user_3", "prophet"),
        (11, "slot_4", "user_4", "wolf"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            20,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    expect_ack(
        post_command(
            app.clone(),
            21,
            "user_1",
            Command::SubmitAction {
                game,
                action_id: "link_lovers_n01".into(),
                actor_slot: "slot_1".into(),
                template_id: "link_lovers".into(),
                targets: vec!["slot_2".into(), "slot_3".into()],
                grant_id: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            22,
            "host_h",
            Command::ResolvePhase { game, seed: 930601 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=user_2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_two: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_two.len(), 1);
    assert_eq!(user_two[0].audience_slot, "slot_2");
    assert_eq!(user_two[0].effect, "lovers_link");
    assert_eq!(user_two[0].status, "link_lovers_n01");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=user_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_four: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_four.is_empty(),
        "unaddressed occupants see no private notice"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 2);
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_2"));
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_3"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_investigation_results_are_capability_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cop"),
        (5, "slot_2", "user_2", "framer"),
        (8, "slot_3", "user_3", "vanilla_townie"),
        (11, "slot_4", "user_4", "godfather"),
        (14, "slot_5", "user_5", "miller"),
        (17, "slot_6", "user_6", "cop"),
        (20, "slot_7", "user_7", "cop"),
        (23, "slot_8", "user_8", "vanilla_townie"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            30,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    for (id, user, actor_slot, action_id, template_id, target) in [
        (31, "user_2", "slot_2", "frame_n01", "frame", "slot_3"),
        (
            32,
            "user_1",
            "slot_1",
            "cop_godfather_n01",
            "cop_investigate",
            "slot_4",
        ),
        (
            33,
            "user_6",
            "slot_6",
            "cop_miller_n01",
            "cop_investigate",
            "slot_5",
        ),
        (
            34,
            "user_7",
            "slot_7",
            "cop_framed_n01",
            "cop_investigate",
            "slot_3",
        ),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitAction {
                    game,
                    action_id: action_id.into(),
                    actor_slot: actor_slot.into(),
                    template_id: template_id.into(),
                    targets: vec![target.into()],
                    grant_id: None,
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            40,
            "host_h",
            Command::ResolvePhase { game, seed: 930801 },
        )
        .await,
    );
    projections::rebuild(&pool, game)
        .await
        .expect("investigation-result projection rebuild");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_one: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_one.len(), 1);
    assert_eq!(user_one[0].audience_slot, "slot_1");
    assert_eq!(user_one[0].mode, "Parity");
    assert_eq!(user_one[0].target_slot, "slot_4");
    assert_eq!(user_one[0].result, serde_json::json!("town"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_6"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_six: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_six.len(), 1);
    assert_eq!(user_six[0].audience_slot, "slot_6");
    assert_eq!(user_six[0].target_slot, "slot_5");
    assert_eq!(user_six[0].result, serde_json::json!("scum"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_seven: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_seven.len(), 1);
    assert_eq!(user_seven[0].audience_slot, "slot_7");
    assert_eq!(user_seven[0].target_slot, "slot_3");
    assert_eq!(user_seven[0].result, serde_json::json!("scum"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_8"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_eight: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_eight.is_empty(),
        "unaddressed occupants see no private investigation results"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 3);
    assert!(host.iter().any(|result| result.audience_slot == "slot_1"
        && result.target_slot == "slot_4"
        && result.result == serde_json::json!("town")));
    assert!(host.iter().any(|result| result.audience_slot == "slot_6"
        && result.target_slot == "slot_5"
        && result.result == serde_json::json!("scum")));
    assert!(host.iter().any(|result| result.audience_slot == "slot_7"
        && result.target_slot == "slot_3"
        && result.result == serde_json::json!("scum")));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_hello_announces_protocol(pool: sqlx::PgPool) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(pool)).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
        .await
        .unwrap();
    let msg = socket.next().await.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    let envelope: ServerEnvelope = serde_json::from_str(&text).unwrap();

    assert_eq!(envelope.v, PROTOCOL_VERSION);
    assert_eq!(envelope.id, 0);
    match envelope.body {
        ServerMsg::Hello(hello) => {
            assert_eq!(hello.protocol_v, PROTOCOL_VERSION);
            assert_eq!(hello.server, "fmarch-dev");
            assert!(hello.caps.is_empty());
        }
        other => panic!("expected Hello, got {other:?}"),
    }

    server.abort();
}
