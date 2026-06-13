use api::router;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use commands::{Command, VoteTarget};
use futures_util::StreamExt;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{ClientMsg, CommandMsg, Envelope, ProjectionDelta, ServerMsg, PROTOCOL_VERSION};

fn command_envelope(id: u64, principal_user_id: &str, command: Command) -> Envelope<ClientMsg> {
    Envelope::new(
        id,
        ClientMsg::Command(CommandMsg {
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
) -> Envelope<ServerMsg> {
    let body = serde_json::to_vec(&command_envelope(id, principal_user_id, command)).unwrap();
    let response = app
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

fn expect_ack(envelope: Envelope<ServerMsg>) {
    match envelope.body {
        ServerMsg::Ack(ack) => assert!(!ack.stream_seqs.is_empty()),
        other => panic!("expected Ack, got {other:?}"),
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_command_boundary_updates_votecount(pool: sqlx::PgPool) {
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
            5,
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
            6,
            "user_a",
            Command::SubmitVote {
                game,
                actor_slot: "slot_1".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await,
    );

    let response = app
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
    let envelope: Envelope<ServerMsg> = serde_json::from_str(&text).unwrap();

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
