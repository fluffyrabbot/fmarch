use api::{ApiState, WebsocketTicketResponse};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use identity::{StaticAccessTokenVerifier, VerifiedIdentity};
use media::{MediaLimits, MediaStore};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{ClientEnvelope, ClientMsg, Command, CommandMsg, ServerEnvelope, ServerMsg};

fn test_state(pool: sqlx::PgPool, root: &TempDir) -> ApiState {
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    ApiState::new(pool, store)
        .with_websocket_audience("transport-proof")
        .with_websocket_poll_interval(Duration::from_millis(20))
}

fn token_hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn insert_account_session(
    pool: &sqlx::PgPool,
    principal: &str,
    token: &str,
    expires_at: i64,
    revoked_at: Option<i64>,
    disabled_at: Option<i64>,
) {
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, disabled_at, global_capabilities) VALUES ($1, $2, 'test-only', 1, $3, ARRAY['GlobalAdmin'])",
    )
    .bind(format!("{principal}@example.test"))
    .bind(principal)
    .bind(disabled_at)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_session (token_hash, principal_user_id, created_at, expires_at, revoked_at, global_capabilities) VALUES ($1, $2, 1, $3, $4, ARRAY['GlobalAdmin'])",
    )
    .bind(token_hash(token))
    .bind(principal)
    .bind(expires_at)
    .bind(revoked_at)
    .execute(pool)
    .await
    .unwrap();
}

fn command_body(id: u64, command: Command) -> Vec<u8> {
    serde_json::to_vec(&ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id: Uuid::from_u128(id as u128),
            command,
        }),
    ))
    .unwrap()
}

async fn post_command(
    app: &axum::Router,
    id: u64,
    token: Option<&str>,
    command: Command,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("POST")
        .uri("/commands")
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    app.clone()
        .oneshot(request.body(Body::from(command_body(id, command))).unwrap())
        .await
        .unwrap()
}

async fn issue_ticket(
    app: &axum::Router,
    token: &str,
    game: Uuid,
    after_seq: i64,
) -> (StatusCode, Option<WebsocketTicketResponse>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/websocket-tickets")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "audience": "transport-proof",
                        "game": game,
                        "channel": "main",
                        "after_seq": after_seq
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let ticket = status
        .is_success()
        .then(|| serde_json::from_slice(body.as_ref()).unwrap());
    (status, ticket)
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn command_boundary_derives_identity_and_rejects_every_stale_session_without_rows(
    pool: sqlx::PgPool,
) {
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    insert_account_session(&pool, "active", "active-token", 4_102_444_800, None, None).await;
    insert_account_session(&pool, "expired", "expired-token", 1, None, None).await;
    insert_account_session(
        &pool,
        "revoked",
        "revoked-token",
        4_102_444_800,
        Some(2),
        None,
    )
    .await;
    insert_account_session(
        &pool,
        "disabled",
        "disabled-token",
        4_102_444_800,
        None,
        Some(2),
    )
    .await;
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, disabled_at, global_capabilities) VALUES ('member@example.test', 'member', 'test-only', 1, NULL, ARRAY[]::TEXT[])",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_session (token_hash, principal_user_id, created_at, expires_at, revoked_at, global_capabilities) VALUES ($1, 'member', 1, 4102444800, NULL, ARRAY[]::TEXT[])",
    )
    .bind(token_hash("member-token"))
    .execute(&pool)
    .await
    .unwrap();

    for (id, token) in [
        (1, None),
        (2, Some("forged-token")),
        (3, Some("expired-token")),
        (4, Some("revoked-token")),
        (5, Some("disabled-token")),
    ] {
        let response = post_command(
            &app,
            id,
            token,
            Command::CreateGame {
                game: Uuid::new_v4(),
                pack: "mafiascum".into(),
            },
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM command_receipt")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let response = post_command(
        &app,
        6,
        Some("member-token"),
        Command::CreateGame {
            game: Uuid::new_v4(),
            pack: "mafiascum".into(),
        },
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let forged_identity = serde_json::json!({
        "v": 1,
        "id": 7,
        "body": {
            "kind": "Command",
            "body": {
                "command_id": Uuid::new_v4(),
                "principal_user_id": "someone-else",
                "command": { "CreateGame": { "game": Uuid::new_v4(), "pack": "mafiascum" } }
            }
        }
    });
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("authorization", "Bearer active-token")
                .header("content-type", "application/json")
                .body(Body::from(forged_identity.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let game = Uuid::new_v4();
    let response = post_command(
        &app,
        8,
        Some("active-token"),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
        },
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let envelope: ServerEnvelope =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(matches!(envelope.body, ServerMsg::Ack(_)));

    let private_response = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/games/{game}/host-console-state?principal_user_id=active"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(private_response.status(), StatusCode::UNAUTHORIZED);
    let bytes = to_bytes(private_response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("host-console"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_ticket_is_short_lived_one_time_and_session_bound(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let game = Uuid::new_v4();
    insert_account_session(&pool, "host", "host-token", 4_102_444_800, None, None).await;
    let response = post_command(
        &app,
        1,
        Some("host-token"),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
        },
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let client = reqwest::Client::new();
    for token in [None, Some("forged-token")] {
        let mut request = client
            .post(format!("http://{addr}/auth/websocket-tickets"))
            .json(&serde_json::json!({
                "audience": "transport-proof",
                "game": game,
                "channel": "main"
            }));
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        assert_eq!(
            request.send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    let ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth("host-token")
        .json(&serde_json::json!({
            "audience": "transport-proof",
            "game": game,
            "channel": "main"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let url = format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        ticket.ticket
    );
    let wrong_audience = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=other-service",
        ticket.ticket
    ))
    .await
    .unwrap_err();
    assert!(matches!(
        wrong_audience,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));
    let (mut socket, _) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .unwrap();
    let first = socket.next().await.unwrap().unwrap();
    assert!(matches!(first, Message::Text(_)));
    drop(socket);

    let replay = tokio_tungstenite::connect_async(url.as_str())
        .await
        .unwrap_err();
    assert!(matches!(
        replay,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));

    let expired_ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth("host-token")
        .json(&serde_json::json!({
            "audience": "transport-proof",
            "game": game,
            "channel": "main"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    sqlx::query(
        "UPDATE auth_websocket_ticket SET issued_at = 0, expires_at = 1 WHERE token_hash = $1",
    )
    .bind(token_hash(expired_ticket.ticket.as_str()))
    .execute(&pool)
    .await
    .unwrap();
    let expired = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        expired_ticket.ticket
    ))
    .await
    .unwrap_err();
    assert!(matches!(
        expired,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));

    let disabled_ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth("host-token")
        .json(&serde_json::json!({
            "audience": "transport-proof",
            "game": game,
            "channel": "main"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    sqlx::query("UPDATE auth_account SET disabled_at = 2 WHERE principal_user_id = 'host'")
        .execute(&pool)
        .await
        .unwrap();
    let disabled = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        disabled_ticket.ticket
    ))
    .await
    .unwrap_err();
    assert!(matches!(
        disabled,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));
    sqlx::query("UPDATE auth_account SET disabled_at = NULL WHERE principal_user_id = 'host'")
        .execute(&pool)
        .await
        .unwrap();

    let ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth("host-token")
        .json(&serde_json::json!({
            "audience": "transport-proof",
            "game": game,
            "channel": "main"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    sqlx::query("UPDATE auth_session SET revoked_at = 2 WHERE token_hash = $1")
        .bind(token_hash("host-token"))
        .execute(&pool)
        .await
        .unwrap();
    let revoked = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        ticket.ticket
    ))
    .await
    .unwrap_err();
    assert!(matches!(
        revoked,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));
    server.abort();
    let _ = server.await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn open_socket_rechecks_revoked_session_before_delayed_private_delivery(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_websocket_poll_interval(Duration::from_secs(5))
        .with_live_projection_delivery_delay(Duration::from_millis(300));
    let app = api::router_with_state(state);
    let game = Uuid::new_v4();
    insert_account_session(&pool, "host", "host-token", 4_102_444_800, None, None).await;
    assert_eq!(
        post_command(
            &app,
            1,
            Some("host-token"),
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await
        .status(),
        StatusCode::OK
    );
    let (_, ticket) = issue_ticket(&app, "host-token", game, 0).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move { axum::serve(listener, server_app).await.unwrap() });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        ticket.unwrap().ticket
    ))
    .await
    .unwrap();
    assert!(matches!(
        socket.next().await.unwrap().unwrap(),
        Message::Text(_)
    ));
    loop {
        match tokio::time::timeout(Duration::from_millis(50), socket.next()).await {
            Ok(Some(_)) => continue,
            Ok(None) | Err(_) => break,
        }
    }

    assert_eq!(
        post_command(
            &app,
            2,
            Some("host-token"),
            Command::AddSlot {
                game,
                slot: "slot_after_revocation".into(),
            },
        )
        .await
        .status(),
        StatusCode::OK
    );
    sqlx::query("UPDATE auth_session SET revoked_at = 2 WHERE token_hash = $1")
        .bind(token_hash("host-token"))
        .execute(&pool)
        .await
        .unwrap();

    let leaked = tokio::time::timeout(Duration::from_millis(700), async {
        while let Some(frame) = socket.next().await {
            if let Ok(Message::Text(text)) = frame {
                if text.contains("slot_after_revocation") {
                    return true;
                }
            }
        }
        false
    })
    .await
    .unwrap_or(false);
    assert!(
        !leaked,
        "a revoked session received a delayed private delta"
    );

    server.abort();
    let _ = server.await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn external_identity_ticket_is_bound_to_the_enabled_platform_principal(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let verifier = StaticAccessTokenVerifier::new([(
        "workos-token".to_string(),
        VerifiedIdentity {
            subject: "workos-user".to_string(),
            session_id: "workos-session".to_string(),
            expires_at: 4_102_444_800,
            email: Some("host@example.test".to_string()),
        },
    )]);
    let state = test_state(pool.clone(), &root).with_access_token_verifier(Arc::new(verifier));
    let app = api::router_with_state(state);
    let game = Uuid::new_v4();
    let (_, valid_ticket) = issue_ticket(&app, "workos-token", game, 0).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let valid_ticket = valid_ticket.unwrap();
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        valid_ticket.ticket
    ))
    .await
    .unwrap();
    assert!(matches!(
        socket.next().await.unwrap().unwrap(),
        Message::Text(_)
    ));
    drop(socket);

    let client = reqwest::Client::new();
    let disabled_ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth("workos-token")
        .json(&serde_json::json!({
            "audience": "transport-proof",
            "game": game,
            "channel": "main"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    sqlx::query(
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_user_id = (SELECT principal_user_id FROM external_identity WHERE provider = 'workos' AND subject = 'workos-user')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let disabled = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        disabled_ticket.ticket
    ))
    .await
    .unwrap_err();
    assert!(matches!(
        disabled,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));
    server.abort();
    let _ = server.await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn command_on_instance_a_wakes_socket_b_and_reconnect_hydrates_durable_state(
    pool: sqlx::PgPool,
) {
    let root_a = tempfile::tempdir().unwrap();
    let root_b = tempfile::tempdir().unwrap();
    let app_a = api::router_with_state(test_state(pool.clone(), &root_a));
    let app_b = api::router_with_state(test_state(pool.clone(), &root_b));
    let game = Uuid::new_v4();
    insert_account_session(&pool, "host", "host-token", 4_102_444_800, None, None).await;
    assert_eq!(
        post_command(
            &app_a,
            1,
            Some("host-token"),
            Command::CreateGame {
                game,
                pack: "mafiascum".into()
            }
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post_command(
            &app_a,
            2,
            Some("host-token"),
            Command::AddSlot {
                game,
                slot: "slot_1".into()
            }
        )
        .await
        .status(),
        StatusCode::OK
    );
    let before_seq = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(seq), 0) FROM events WHERE stream_id = $1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (_, ticket) = issue_ticket(&app_b, "host-token", game, before_seq).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app_b).await.unwrap() });
    let ticket = ticket.unwrap();
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        ticket.ticket
    ))
    .await
    .unwrap();
    let _ = socket.next().await;

    assert_eq!(
        post_command(
            &app_a,
            3,
            Some("host-token"),
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "player_a".into()
            }
        )
        .await
        .status(),
        StatusCode::OK
    );

    let received = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let message = socket.next().await.unwrap().unwrap();
            let Message::Text(text) = message else {
                continue;
            };
            let envelope: ServerEnvelope = serde_json::from_str(&text).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(wire::ProjectionDelta::HostConsoleStateChanged(ref delta))
                    if delta.slots.iter().any(|slot| slot.occupant_user_id == "player_a")
            ) {
                break envelope;
            }
        }
    })
    .await;
    assert!(
        received.is_ok(),
        "instance B did not observe instance A's durable command"
    );
    drop(socket);

    let (_, reconnect_ticket) = issue_ticket(&app_a, "host-token", game, before_seq).await;
    let (mut reconnected, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        reconnect_ticket.unwrap().ticket
    ))
    .await
    .unwrap();
    let caught_up = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let message = reconnected.next().await.unwrap().unwrap();
            let Message::Text(text) = message else {
                continue;
            };
            let envelope: ServerEnvelope = serde_json::from_str(&text).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(wire::ProjectionDelta::HostConsoleStateChanged(ref delta))
                    if delta.slots.iter().any(|slot| slot.occupant_user_id == "player_a")
            ) {
                break;
            }
        }
    })
    .await;
    assert!(
        caught_up.is_ok(),
        "reconnect did not hydrate durable sequence state"
    );
    drop(reconnected);
    server.abort();
    let _ = server.await;
}
