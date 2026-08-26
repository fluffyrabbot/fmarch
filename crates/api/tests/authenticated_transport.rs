use api::{ApiState, MediaUploadResponse, WebsocketTicketResponse};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use identity::{StaticAccessTokenVerifier, VerifiedIdentity, WorkosSessionId};
use media::{MediaLimits, MediaRepository, MediaStore};
use principal::PrincipalId;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{
    ClientEnvelope, ClientMsg, Command, CommandMsg, PublicGameThreadPage, ServerEnvelope,
    ServerMsg, SubmitPostMedia,
};

const ACTIVE_TOKEN: &str = "fmss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXPIRED_TOKEN: &str = "fmss_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REVOKED_TOKEN: &str = "fmss_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DISABLED_TOKEN: &str =
    "fmss_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const MEMBER_TOKEN: &str = "fmss_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const HOST_TOKEN: &str = "fmss_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

fn decode_server_envelope(message: Message) -> ServerEnvelope {
    let Message::Binary(bytes) = message else {
        panic!("expected binary CBOR websocket frame");
    };
    ciborium::from_reader(bytes.as_ref()).expect("decode server CBOR envelope")
}

fn host_console_slot_assigned(body: &ServerMsg, principal_id: PrincipalId) -> bool {
    match body {
        ServerMsg::Delta(wire::ProjectionDelta::HostConsoleStateChanged(delta)) => delta
            .slots
            .iter()
            .any(|slot| slot.assigned_principal_id == principal_id),
        ServerMsg::Delta(wire::ProjectionDelta::HostConsoleSlotsChanged(delta)) => delta
            .slots
            .iter()
            .any(|slot| slot.assigned_principal_id == principal_id),
        _ => false,
    }
}

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
    principal_label: &str,
    token: &str,
    expires_at: i64,
    revoked_at: Option<i64>,
    disabled_at: Option<i64>,
    global_capabilities: &[&str],
) {
    let principal_id = PrincipalId::fixture(principal_label);
    let global_capabilities = global_capabilities
        .iter()
        .map(|capability| (*capability).to_string())
        .collect::<Vec<_>>();
    let mut transaction = pool.begin().await.unwrap();
    identity::methods::ensure_principal(&mut transaction, &principal_id, &global_capabilities, 1)
        .await
        .unwrap();
    let method_id = identity::methods::create_method(
        &mut transaction,
        &principal_id,
        identity::MethodKind::ClassicPassword,
        1,
    )
    .await
    .unwrap();
    if let Some(disabled_at) = disabled_at {
        sqlx::query(
            "UPDATE platform_principal SET status = 'disabled', disabled_at = $2 WHERE principal_id = $1",
        )
        .bind(principal_id.as_uuid())
        .bind(disabled_at)
        .execute(&mut *transaction)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE authentication_method SET status = 'disabled', disabled_at = $2 WHERE method_id = $1",
        )
        .bind(method_id)
        .bind(disabled_at)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_id, method_id, password_hash, created_at, disabled_at, global_capabilities) VALUES ($1, $2, $3, 'test-only', 1, $4, $5)",
    )
    .bind(format!("{principal_label}@example.test"))
    .bind(principal_id.as_uuid())
    .bind(method_id)
    .bind(disabled_at)
    .bind(&global_capabilities)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_session (token_hash, principal_id, created_at, expires_at, revoked_at, global_capabilities, idle_expires_at, assurance, authenticated_at) VALUES ($1, $2, 1, $3, $4, $5, $3, 'admin_grant', 1)",
    )
    .bind(token_hash(token))
    .bind(principal_id.as_uuid())
    .bind(expires_at)
    .bind(revoked_at)
    .bind(&global_capabilities)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();
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

async fn upload_media(app: &axum::Router, token: &str) -> MediaUploadResponse {
    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, 3, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer
            .write_image_data(&[
                10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 90, 80, 70, 255, 60, 50, 40,
                255, 30, 20, 10, 255,
            ])
            .unwrap();
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/media/uploads")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "image/png")
                .body(Body::from(encoded))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        status,
        StatusCode::CREATED,
        "media upload failed: {}",
        String::from_utf8_lossy(&body)
    );
    serde_json::from_slice(&body).unwrap()
}

async fn create_classic_account_session(
    app: &axum::Router,
    admin_token: &str,
    account_id: &str,
    password: &str,
    principal_label: &str,
    global_capabilities: &[&str],
) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts")
                .header("authorization", format!("Bearer {admin_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": account_id,
                        "password": password,
                        "principal_id": PrincipalId::fixture(principal_label),
                        "global_capabilities": global_capabilities,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "classic account creation failed: {}",
        String::from_utf8_lossy(&body)
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": account_id,
                        "password": password,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "classic account login failed: {}",
        String::from_utf8_lossy(&body)
    );
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let session_token = response["session_token"]
        .as_str()
        .expect("classic login returns its backend-issued session token")
        .to_string();
    assert!(identity::token::is_app_session_token(&session_token));
    session_token
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn command_boundary_derives_identity_and_rejects_every_stale_session_without_rows(
    pool: sqlx::PgPool,
) {
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    insert_account_session(
        &pool,
        "active",
        ACTIVE_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    insert_account_session(
        &pool,
        "expired",
        EXPIRED_TOKEN,
        2,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    insert_account_session(
        &pool,
        "revoked",
        REVOKED_TOKEN,
        4_102_444_800,
        Some(2),
        None,
        &["GlobalAdmin"],
    )
    .await;
    insert_account_session(
        &pool,
        "disabled",
        DISABLED_TOKEN,
        4_102_444_800,
        None,
        Some(2),
        &["GlobalAdmin"],
    )
    .await;
    insert_account_session(
        &pool,
        "member",
        MEMBER_TOKEN,
        4_102_444_800,
        None,
        None,
        &[],
    )
    .await;

    for (id, token) in [
        (1, None),
        (2, Some("forged-token")),
        (3, Some(EXPIRED_TOKEN)),
        (4, Some(REVOKED_TOKEN)),
        (5, Some(DISABLED_TOKEN)),
    ] {
        let response = post_command(
            &app,
            id,
            token,
            Command::CreateGame {
                game: Uuid::new_v4(),
                pack: "mafiascum".into(),
                cohost_denied: vec![],
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
        Some(MEMBER_TOKEN),
        Command::CreateGame {
            game: Uuid::new_v4(),
            pack: "mafiascum".into(),
            cohost_denied: vec![],
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
        "v": 2,
        "id": 7,
        "body": {
            "kind": "Command",
            "body": {
                "command_id": Uuid::new_v4(),
                "principal_id": "someone-else",
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
                .header("authorization", format!("Bearer {ACTIVE_TOKEN}"))
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
        Some(ACTIVE_TOKEN),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
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
                    "/games/{game}/host-console-state?principal_id={}",
                    PrincipalId::fixture("active")
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_ticket_is_short_lived_one_time_and_session_bound(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let game = Uuid::new_v4();
    insert_account_session(
        &pool,
        "host",
        HOST_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    let response = post_command(
        &app,
        1,
        Some(HOST_TOKEN),
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
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
        .bearer_auth(HOST_TOKEN)
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
    assert!(matches!(first, Message::Binary(_)));
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
        .bearer_auth(HOST_TOKEN)
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
        .bearer_auth(HOST_TOKEN)
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
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_id = $1",
    )
        .bind(PrincipalId::fixture("host").as_uuid())
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
    sqlx::query(
        "UPDATE platform_principal SET status = 'active', disabled_at = NULL WHERE principal_id = $1",
    )
        .bind(PrincipalId::fixture("host").as_uuid())
        .execute(&pool)
        .await
        .unwrap();

    let ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth(HOST_TOKEN)
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
        .bind(token_hash(HOST_TOKEN))
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn open_socket_rechecks_revoked_session_before_delayed_private_delivery(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_websocket_poll_interval(Duration::from_secs(5))
        .with_live_projection_delivery_delay(Duration::from_millis(300));
    let app = api::router_with_state(state);
    let game = Uuid::new_v4();
    insert_account_session(
        &pool,
        "host",
        HOST_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    assert_eq!(
        post_command(
            &app,
            1,
            Some(HOST_TOKEN),
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await
        .status(),
        StatusCode::OK
    );
    let (_, ticket) = issue_ticket(&app, HOST_TOKEN, game, 0).await;

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
        Message::Binary(_)
    ));
    while let Ok(Some(_)) = tokio::time::timeout(Duration::from_millis(50), socket.next()).await {}

    assert_eq!(
        post_command(
            &app,
            2,
            Some(HOST_TOKEN),
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
        .bind(token_hash(HOST_TOKEN))
        .execute(&pool)
        .await
        .unwrap();

    let leaked = tokio::time::timeout(Duration::from_millis(700), async {
        while let Some(frame) = socket.next().await {
            if let Ok(Message::Binary(bytes)) = frame {
                let envelope: ServerEnvelope =
                    ciborium::from_reader(bytes.as_ref()).expect("decode server CBOR envelope");
                if serde_json::to_string(&envelope)
                    .expect("render test envelope")
                    .contains("slot_after_revocation")
                {
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn external_identity_ticket_is_bound_to_the_enabled_platform_principal(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let verifier = StaticAccessTokenVerifier::new([(
        "workos-token".to_string(),
        VerifiedIdentity {
            subject: "workos-user".to_string(),
            session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
            expires_at: 4_102_444_800,
            email: Some("host@example.test".to_string()),
        },
    )]);
    let state = test_state(pool.clone(), &root).with_access_token_verifier(Arc::new(verifier));
    let app = api::router_with_state(state);
    let game = Uuid::new_v4();

    // The provider JWT is never a general bearer: it must be exchanged once
    // for a backend-owned app session.
    let (rejected, _) = issue_ticket(&app, "workos-token", game, 0).await;
    assert_eq!(rejected, StatusCode::UNAUTHORIZED);
    let exchange = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "method": "workos" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(exchange.status(), StatusCode::OK);
    let exchange_body = to_bytes(exchange.into_body(), usize::MAX).await.unwrap();
    let exchange_json: serde_json::Value = serde_json::from_slice(&exchange_body).unwrap();
    let session_token = exchange_json["session_token"].as_str().unwrap().to_string();
    assert!(session_token.starts_with("fmss_"));

    let (_, valid_ticket) = issue_ticket(&app, session_token.as_str(), game, 0).await;

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
        Message::Binary(_)
    ));
    drop(socket);

    let client = reqwest::Client::new();
    let disabled_ticket: WebsocketTicketResponse = client
        .post(format!("http://{addr}/auth/websocket-tickets"))
        .bearer_auth(session_token.as_str())
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
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_id = (SELECT principal_id FROM external_identity WHERE provider = 'workos' AND subject = 'workos-user')",
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn command_on_instance_a_wakes_socket_b_and_reconnect_hydrates_durable_state(
    pool: sqlx::PgPool,
) {
    let media = MediaRepository::in_memory(MediaLimits::default()).unwrap();
    let app_a = api::router_with_state(
        ApiState::new(pool.clone(), media.clone())
            .with_websocket_audience("transport-proof")
            .with_websocket_poll_interval(Duration::from_secs(5)),
    );
    let app_b = api::router_with_state(
        ApiState::new(pool.clone(), media)
            .with_websocket_audience("transport-proof")
            .with_websocket_poll_interval(Duration::from_secs(5)),
    );
    let game = Uuid::new_v4();
    insert_account_session(
        &pool,
        "transport_setup_admin",
        HOST_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    let host_token = create_classic_account_session(
        &app_a,
        HOST_TOKEN,
        "transport-host@example.test",
        "correct horse battery",
        "host",
        &["GlobalAdmin"],
    )
    .await;
    let _player_token = create_classic_account_session(
        &app_a,
        host_token.as_str(),
        "transport-player@example.test",
        "correct horse battery player",
        "player_a",
        &[],
    )
    .await;
    assert_eq!(
        post_command(
            &app_a,
            1,
            Some(host_token.as_str()),
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
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
            Some(host_token.as_str()),
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
    let (_, ticket) = issue_ticket(&app_b, host_token.as_str(), game, before_seq).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app_b_server = app_b.clone();
    let server = tokio::spawn(async move { axum::serve(listener, app_b_server).await.unwrap() });
    let ticket = ticket.unwrap();
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        ticket.ticket
    ))
    .await
    .unwrap();
    let _ = socket.next().await;

    let seat_response = post_command(
        &app_a,
        3,
        Some(host_token.as_str()),
        wire::seat_persona! {
            game,
            slot: "slot_1".into(),
            user: "player_a"
        },
    )
    .await;
    assert_eq!(seat_response.status(), StatusCode::OK);
    let seat_body = to_bytes(seat_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let seat_envelope: ServerEnvelope = serde_json::from_slice(&seat_body).unwrap();
    assert!(matches!(seat_envelope.body, ServerMsg::Ack(_)));

    let received = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let message = socket.next().await.unwrap().unwrap();
            let envelope = decode_server_envelope(message);
            if host_console_slot_assigned(&envelope.body, PrincipalId::fixture("player_a")) {
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

    let (_, reconnect_ticket) = issue_ticket(&app_a, host_token.as_str(), game, before_seq).await;
    let (mut reconnected, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        reconnect_ticket.unwrap().ticket
    ))
    .await
    .unwrap();
    let caught_up = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let message = reconnected.next().await.unwrap().unwrap();
            let envelope = decode_server_envelope(message);
            if matches!(
                envelope.body,
                ServerMsg::Delta(wire::ProjectionDelta::HostConsoleStateChanged(ref delta))
                    if delta
                        .slots
                        .iter()
                        .any(|slot| {
                            slot.assigned_principal_id == PrincipalId::fixture("player_a")
                        })
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

    let upload = upload_media(&app_a, host_token.as_str()).await;
    for (id, command) in [
        (
            4,
            Command::AddSlot {
                game,
                slot: "slot_2".into(),
            },
        ),
        (
            5,
            wire::seat_persona! {
                game,
                slot: "slot_2".into(),
                user: "host",
            },
        ),
        (
            6,
            Command::StartGame {
                game,
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        ),
        (
            7,
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: "slot_2".into(),
                body: "cross-replica object media".into(),
                media: Some(vec![SubmitPostMedia {
                    content_id: upload.content_id.clone(),
                    alt: "Cross-replica proof".into(),
                }]),
                quotations: None,
                embed: None,
            },
        ),
    ] {
        assert_eq!(
            post_command(&app_a, id, Some(host_token.as_str()), command)
                .await
                .status(),
            StatusCode::OK
        );
    }
    let page = app_b
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
    let page: PublicGameThreadPage =
        serde_json::from_slice(&to_bytes(page.into_body(), usize::MAX).await.unwrap()).unwrap();
    let media = &page.posts.last().unwrap().media[0];
    assert_eq!(media.content_id, upload.content_id);
    let served = app_b
        .clone()
        .oneshot(
            Request::builder()
                .uri(&media.variants["tablet"].webp_url)
                .header("authorization", format!("Bearer {host_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(served.headers()["content-type"], "image/webp");
    assert!(!to_bytes(served.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());
    server.abort();
    let _ = server.await;
}
