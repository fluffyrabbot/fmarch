use api::{ApiState, MediaUploadResponse, WebsocketTicketResponse};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use identity::{StaticAccessTokenVerifier, VerifiedIdentity, WorkosSessionId};
use media::{MediaLimits, MediaRepository, MediaStore};
use principal::PrincipalId;
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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

async fn low_lock_timeout_pool(owner: &sqlx::PgPool) -> sqlx::PgPool {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(owner)
        .await
        .unwrap();
    let base_url = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx test owner");
    let options = PgConnectOptions::from_str(&base_url)
        .unwrap()
        .database(&database);
    PgPoolOptions::new()
        .max_connections(5)
        .after_connect(|connection, _metadata| {
            Box::pin(async move {
                sqlx::query("SET lock_timeout = '100ms'")
                    .execute(&mut *connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await
        .unwrap()
}

async fn community_invitation_for(pool: &sqlx::PgPool, account_id: &str) -> String {
    let founder = PrincipalId::random();
    let now = 1_700_000_000;
    let mut tx = pool.begin().await.unwrap();
    identity::methods::ensure_principal(&mut tx, &founder, &[], now)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    membership_application::ensure_founder_membership(pool, founder, now)
        .await
        .unwrap();
    membership_application::issue_invitation(
        pool,
        &membership_application::InvitationTargetIndex::from_env_or_local().unwrap(),
        founder,
        account_id,
        4_102_444_800,
        now,
    )
    .await
    .unwrap()
    .credential
}

fn token_hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn wait_for_session_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%FROM auth_session%'
              AND query LIKE '%FOR UPDATE%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} session-lock waiter(s)");
}

async fn wait_for_owner_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%FROM platform_principal%'
              AND query LIKE '%FOR UPDATE%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} owner-lock waiter(s)");
}

async fn wait_for_identity_cutoff_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%fmarch.identity-cutoff:%'
              AND query LIKE '%pg_advisory_xact_lock(%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} identity-cutoff lock waiter(s)");
}

async fn wait_until_session_is_write_locked(pool: &sqlx::PgPool, token: &str) {
    for _ in 0..200 {
        match sqlx::query(
            "SELECT token_hash FROM auth_session WHERE token_hash = $1 FOR UPDATE NOWAIT",
        )
        .bind(token_hash(token))
        .execute(pool)
        .await
        {
            Err(error)
                if error
                    .as_database_error()
                    .and_then(|error| error.code())
                    .as_deref()
                    == Some("55P03") =>
            {
                return;
            }
            Ok(_) => {}
            Err(error) => panic!("probe exact session write lock: {error}"),
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("command never acquired its exact session write lock");
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
        "INSERT INTO auth_account (account_id, principal_id, method_id, password_hash, created_at, disabled_at) VALUES ($1, $2, $3, 'test-only', 1, $4)",
    )
    .bind(format!("{principal_label}@example.test"))
    .bind(principal_id.as_uuid())
    .bind(method_id)
    .bind(disabled_at)
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_session (token_hash, principal_id, created_at, expires_at, revoked_at, authenticated_via_method_id, idle_expires_at, assurance, authenticated_at) VALUES ($1, $2, 1, $3, $4, $5, $3, 'password', 1)",
    )
    .bind(token_hash(token))
    .bind(principal_id.as_uuid())
    .bind(expires_at)
    .bind(revoked_at)
    .bind(method_id)
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
async fn logout_waits_out_the_bounded_delivery_fence_despite_the_general_lock_timeout(
    pool: sqlx::PgPool,
) {
    insert_account_session(
        &pool,
        "cutoff-waiter",
        ACTIVE_TOKEN,
        4_102_444_800,
        None,
        None,
        &[],
    )
    .await;

    // Model the exact shared session lock held by SessionDeliveryGuard while a
    // frame is accepted. The HTTP pool deliberately has a much shorter
    // general lock timeout; the authority-transaction constructor must replace
    // it locally so the cutoff waits for this bounded predecessor.
    let principal_id = PrincipalId::fixture("cutoff-waiter");
    let session_reference = token_hash(ACTIVE_TOKEN);
    let mut delivery_guards = Vec::new();
    for _ in 0..4 {
        let mut guard = pool.begin().await.unwrap();
        identity::session::lock_live_delivery_cutoff_gates(&mut guard, &principal_id)
            .await
            .unwrap();
        identity::session::validate_session_reference_for_delivery(
            &mut guard,
            session_reference.as_str(),
            &identity::SessionPolicy::from_env(),
            1,
        )
        .await
        .unwrap();
        delivery_guards.push(guard);
    }

    let cutoff_pool = low_lock_timeout_pool(&pool).await;
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(cutoff_pool.clone(), &root));
    let logout = tokio::spawn(async move {
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-logout")
                .header("authorization", format!("Bearer {ACTIVE_TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
    });

    wait_for_identity_cutoff_lock_waiters(&pool, 1).await;
    let fresh_pool = pool.clone();
    let fresh_gate = tokio::spawn(async move {
        let mut guard = fresh_pool.begin().await.unwrap();
        let entered =
            if identity::session::lock_live_delivery_cutoff_gates(&mut guard, &principal_id)
                .await
                .is_ok()
            {
                identity::session::validate_session_reference_for_delivery(
                    &mut guard,
                    session_reference.as_str(),
                    &identity::SessionPolicy::from_env(),
                    1,
                )
                .await
                .is_ok()
            } else {
                false
            };
        guard.rollback().await.unwrap();
        entered
    });
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(
        !logout.is_finished(),
        "the cutoff must remain a waiter beyond the pool's 100ms general lock timeout"
    );
    assert!(
        !fresh_gate.is_finished(),
        "a fresh delivery gate must not overtake the queued cutoff writer"
    );
    for guard in delivery_guards {
        guard.rollback().await.unwrap();
    }

    let response = tokio::time::timeout(Duration::from_secs(2), logout)
        .await
        .expect("logout did not complete after delivery released its fence")
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT revoked_at FROM auth_session WHERE token_hash = $1",
    )
    .bind(token_hash(ACTIVE_TOKEN))
    .fetch_one(&pool)
    .await
    .unwrap()
    .is_some());
    assert!(
        !tokio::time::timeout(Duration::from_secs(2), fresh_gate)
            .await
            .expect("fresh delivery gate stayed queued after cutoff commit")
            .unwrap(),
        "a delivery that queued behind logout must revalidate the revoked session"
    );
    cutoff_pool.close().await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn command_authority_lease_cannot_starve_workos_key_retirement(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let signing_key_id = "retirement-fence-key";
    let verifier = StaticAccessTokenVerifier::new([(
        "workos-fence-assertion".to_string(),
        VerifiedIdentity {
            subject: "workos-fence-user".to_string(),
            session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0C").unwrap(),
            issued_at: 1,
            expires_at: 4_102_444_800,
            signing_key_id: signing_key_id.to_string(),
            email: Some("workos-fence@example.test".to_string()),
        },
    )]);
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(verifier))
        .with_command_lock_timeout(Duration::from_secs(30));
    let app = api::router_with_state(state);
    let invitation = community_invitation_for(&pool, "workos-fence@example.test").await;
    let exchange = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-fence-assertion")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "method": "workos",
                        "invitation_credential": invitation
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(exchange.status(), StatusCode::OK);
    let exchange_json: serde_json::Value =
        serde_json::from_slice(&to_bytes(exchange.into_body(), usize::MAX).await.unwrap()).unwrap();
    let session_token = exchange_json["session_token"].as_str().unwrap().to_string();
    let principal_id = PrincipalId::from_uuid(
        sqlx::query_scalar::<_, Uuid>(
            "SELECT principal_id FROM external_identity WHERE provider = 'workos' AND subject = 'workos-fence-user'",
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
    );
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalAdmin'] WHERE principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    insert_account_session(
        &pool,
        "retirement-admin",
        HOST_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    sqlx::query(
        "UPDATE auth_session SET created_at = $2, authenticated_at = $2 WHERE token_hash = $1",
    )
    .bind(token_hash(HOST_TOKEN))
    .bind(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    )
    .execute(&pool)
    .await
    .unwrap();

    // An uncommitted duplicate receipt deterministically blocks command work
    // only after the HTTP boundary has locked the actor owner and exact session.
    // The command must abandon that wait, close its transaction connection, and
    // let the later signing-key cutoff commit inside its seven-second budget.
    let command_id = Uuid::from_u128(98);
    let blocked_game = Uuid::new_v4();
    let mut receipt_fence = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO command_receipt \
         (principal_id, command_id, stream_id, stream_seqs, command_fingerprint) \
         VALUES ($1, $2, $3, ARRAY[]::BIGINT[], $4)",
    )
    .bind(principal_id.as_uuid())
    .bind(command_id)
    .bind(blocked_game)
    .bind(vec![0_u8; 32])
    .execute(&mut *receipt_fence)
    .await
    .unwrap();

    let command_app = app.clone();
    let command_token = session_token.clone();
    let command = tokio::spawn(async move {
        post_command(
            &command_app,
            98,
            Some(command_token.as_str()),
            Command::CreateGame {
                game: blocked_game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await
    });
    wait_until_session_is_write_locked(&pool, session_token.as_str()).await;

    let retirement_app = app.clone();
    let retirement = tokio::spawn(async move {
        retirement_app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/workos-signing-key-retirements")
                    .header("authorization", format!("Bearer {HOST_TOKEN}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "signing_key_id": signing_key_id,
                            "reason": "incident cutoff proof"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
    });
    wait_for_session_lock_waiters(&pool, 1).await;

    let retirement = tokio::time::timeout(Duration::from_secs(8), retirement)
        .await
        .expect("signing-key retirement exceeded its cutoff-safe wait budget")
        .unwrap();
    assert_eq!(retirement.status(), StatusCode::OK);
    let command = tokio::time::timeout(Duration::from_secs(2), command)
        .await
        .expect("leased command did not terminate before the cutoff completed")
        .unwrap();
    assert_eq!(command.status(), StatusCode::SERVICE_UNAVAILABLE);
    let envelope: ServerEnvelope =
        serde_json::from_slice(&to_bytes(command.into_body(), usize::MAX).await.unwrap()).unwrap();
    let ServerMsg::Reject(reject) = envelope.body else {
        panic!("expired command authority lease must return a typed rejection");
    };
    assert_eq!(reject.error, wire::RejectCode::Internal);
    assert!(reject.retryable);
    assert!(reject.message.contains("retry the exact same command_id"));

    receipt_fence.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM game_index WHERE game_id = $1")
            .bind(blocked_game)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM command_receipt WHERE principal_id = $1 AND command_id = $2",
        )
        .bind(principal_id.as_uuid())
        .bind(command_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    assert_eq!(
        post_command(
            &app,
            98,
            Some(session_token.as_str()),
            Command::CreateGame {
                game: blocked_game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM game_index WHERE game_id = $1")
            .bind(blocked_game)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn authority_grant_revalidates_target_after_waiting_for_its_owner(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    insert_account_session(
        &pool,
        "grant-host",
        HOST_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    insert_account_session(
        &pool,
        "grant-target",
        MEMBER_TOKEN,
        4_102_444_800,
        None,
        None,
        &[],
    )
    .await;
    let target = PrincipalId::fixture("grant-target");
    let game = Uuid::new_v4();
    assert_eq!(
        post_command(
            &app,
            110,
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
    let missing_target = post_command(
        &app,
        111,
        Some(HOST_TOKEN),
        Command::AddCohost {
            game,
            principal_id: PrincipalId::fixture("missing-grant-target"),
        },
    )
    .await;
    assert_eq!(missing_target.status(), StatusCode::OK);
    let envelope: ServerEnvelope = serde_json::from_slice(
        &to_bytes(missing_target.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let ServerMsg::Reject(reject) = envelope.body else {
        panic!("missing cohost target must return a typed rejection");
    };
    assert_eq!(reject.error, wire::RejectCode::InvalidTarget);
    assert!(!reject.retryable);
    assert!(!eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|event| event.kind == "CohostAdded"));

    let mut target_fence = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(target.as_uuid())
        .execute(&mut *target_fence)
        .await
        .unwrap();
    let command_app = app.clone();
    let raced_grant = tokio::spawn(async move {
        post_command(
            &command_app,
            112,
            Some(HOST_TOKEN),
            Command::AddCohost {
                game,
                principal_id: target,
            },
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 1).await;
    sqlx::query(
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_id = $1",
    )
    .bind(target.as_uuid())
    .execute(&mut *target_fence)
    .await
    .unwrap();
    target_fence.commit().await.unwrap();

    let raced_grant = tokio::time::timeout(Duration::from_secs(5), raced_grant)
        .await
        .expect("target-state command did not leave its owner wait")
        .unwrap();
    assert_eq!(raced_grant.status(), StatusCode::CONFLICT);
    assert!(!eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|event| event.kind == "CohostAdded"));

    sqlx::query(
        "UPDATE platform_principal SET status = 'active', disabled_at = NULL WHERE principal_id = $1",
    )
    .bind(target.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        post_command(
            &app,
            113,
            Some(HOST_TOKEN),
            Command::AddCohost {
                game,
                principal_id: target,
            },
        )
        .await
        .status(),
        StatusCode::OK
    );
    sqlx::query(
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 3 WHERE principal_id = $1",
    )
    .bind(target.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    assert!(eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|event| event.kind == "CohostAdded"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn busy_command_stream_is_a_retryable_http_conflict_without_side_effects(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    insert_account_session(
        &pool,
        "busy-host",
        HOST_TOKEN,
        4_102_444_800,
        None,
        None,
        &["GlobalAdmin"],
    )
    .await;
    let game = Uuid::new_v4();
    assert_eq!(
        post_command(
            &app,
            120,
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
    let mut stream_fence = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(game)
        .execute(&mut *stream_fence)
        .await
        .unwrap();
    let response = post_command(
        &app,
        121,
        Some(HOST_TOKEN),
        Command::AddSlot {
            game,
            slot: "must_not_exist".into(),
        },
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let envelope: ServerEnvelope =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    let ServerMsg::Reject(reject) = envelope.body else {
        panic!("busy stream must return a typed rejection");
    };
    assert_eq!(reject.error, wire::RejectCode::StreamConflict);
    assert!(reject.retryable);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM command_receipt WHERE principal_id = $1 AND command_id = $2",
        )
        .bind(PrincipalId::fixture("busy-host").as_uuid())
        .bind(Uuid::from_u128(121))
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert!(!eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|event| event.kind == "SlotAdded" && event.payload["slot"] == "must_not_exist"));
    stream_fence.rollback().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_ticket_mint_prunes_stale_rows_in_bounded_batches(pool: sqlx::PgPool) {
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
    let session_reference = token_hash(HOST_TOKEN);

    sqlx::query(
        r#"
        INSERT INTO auth_websocket_ticket (
            token_hash, session_reference, access_expires_at,
            audience, game_id, channel_id, after_seq, issued_at, expires_at
        )
        SELECT lpad(to_hex(candidate), 64, '0'), $1, 3,
               'transport-proof', $2, 'main', 0, 1, 2
        FROM generate_series(1, 300) AS series(candidate)
        "#,
    )
    .bind(&session_reference)
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();

    let mint = || {
        Request::builder()
            .method("POST")
            .uri("/auth/websocket-tickets")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {HOST_TOKEN}"))
            .body(Body::from(
                serde_json::json!({
                    "audience": "transport-proof",
                    "game": game,
                    "channel": "main"
                })
                .to_string(),
            ))
            .unwrap()
    };

    assert_eq!(
        app.clone().oneshot(mint()).await.unwrap().status(),
        StatusCode::OK
    );
    let expired_after_one = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM auth_websocket_ticket WHERE expires_at = 2",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        expired_after_one, 44,
        "one request must delete at most 256 rows"
    );

    assert_eq!(app.oneshot(mint()).await.unwrap().status(), StatusCode::OK);
    let expired_after_two = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM auth_websocket_ticket WHERE expires_at = 2",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(expired_after_two, 0);
}

async fn prove_capacity_rejection_preserves_websocket_ticket(pool: sqlx::PgPool, state: ApiState) {
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
    let app = api::router_with_state(state);
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

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move { axum::serve(listener, server_app).await.unwrap() });
    let client = reqwest::Client::new();
    let mint = || async {
        client
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
            .error_for_status()
            .unwrap()
            .json::<WebsocketTicketResponse>()
            .await
            .unwrap()
    };
    let first_ticket = mint().await;
    let retry_ticket = mint().await;
    let first_url = format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        first_ticket.ticket
    );
    let retry_url = format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        retry_ticket.ticket
    );
    let (mut first_socket, _) = tokio_tungstenite::connect_async(first_url).await.unwrap();
    assert!(matches!(
        first_socket.next().await.unwrap().unwrap(),
        Message::Binary(_)
    ));

    let rejected = tokio_tungstenite::connect_async(retry_url.as_str())
        .await
        .unwrap_err();
    assert!(matches!(
        rejected,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::SERVICE_UNAVAILABLE
    ));

    // A quiet connection must release admission on peer close; no game event
    // should be required to make the server discover the dead socket.
    drop(first_socket);

    let mut recovered = None;
    for _ in 0..40 {
        match tokio_tungstenite::connect_async(retry_url.as_str()).await {
            Ok(connection) => {
                recovered = Some(connection);
                break;
            }
            Err(tokio_tungstenite::tungstenite::Error::Http(response))
                if response.status() == StatusCode::SERVICE_UNAVAILABLE =>
            {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            Err(error) => panic!("retryable ticket was consumed after capacity rejection: {error}"),
        }
    }
    let (mut recovered_socket, _) = recovered.expect("connection capacity was not released");
    assert!(matches!(
        recovered_socket.next().await.unwrap().unwrap(),
        Message::Binary(_)
    ));
    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn global_websocket_capacity_rejection_preserves_ticket(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_live_connection_limit(1)
        .with_live_principal_connection_limit(8);
    prove_capacity_rejection_preserves_websocket_ticket(pool, state).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn principal_websocket_capacity_rejection_preserves_ticket(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_live_connection_limit(8)
        .with_live_principal_connection_limit(1);
    prove_capacity_rejection_preserves_websocket_ticket(pool, state).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_ticket_cannot_outwait_its_expiry_behind_the_session_lock(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
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
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_websocket_ticket_ttl(Duration::from_secs(2)),
    );
    assert_eq!(
        post_command(
            &app,
            20,
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
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move { axum::serve(listener, server_app).await.unwrap() });
    let client = reqwest::Client::new();
    let ticket = client
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
        .error_for_status()
        .unwrap()
        .json::<WebsocketTicketResponse>()
        .await
        .unwrap();
    let expired_ticket_hash = token_hash(ticket.ticket.as_str());

    let mut session_fence = pool.begin().await.unwrap();
    sqlx::query("SELECT token_hash FROM auth_session WHERE token_hash = $1 FOR UPDATE")
        .bind(token_hash(HOST_TOKEN))
        .execute(&mut *session_fence)
        .await
        .unwrap();
    let ticket_url = format!(
        "ws://{addr}/ws?ticket={}&audience=transport-proof",
        ticket.ticket
    );
    let redemption =
        tokio::spawn(async move { tokio_tungstenite::connect_async(ticket_url).await });
    wait_for_session_lock_waiters(&pool, 1).await;
    let database_now: i64 = sqlx::query_scalar(
        "SELECT floor(extract(epoch FROM pg_catalog.clock_timestamp()))::bigint",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_secs(
        ticket.expires_at.saturating_sub(database_now).max(0) as u64 + 1,
    ))
    .await;
    session_fence.commit().await.unwrap();
    let rejected = tokio::time::timeout(Duration::from_secs(5), redemption)
        .await
        .expect("ticket redemption stayed blocked after the session lock released")
        .unwrap()
        .unwrap_err();
    assert!(matches!(
        rejected,
        tokio_tungstenite::tungstenite::Error::Http(response)
            if response.status() == StatusCode::UNAUTHORIZED
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM auth_websocket_ticket WHERE token_hash = $1",
        )
        .bind(expired_ticket_hash.as_str())
        .fetch_one(&pool)
        .await
        .unwrap(),
        1,
        "failed redemption must leave the ticket for bounded cleanup"
    );

    assert_eq!(
        client
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
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM auth_websocket_ticket WHERE token_hash = $1",
        )
        .bind(expired_ticket_hash)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    server.abort();
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
            issued_at: 1,
            expires_at: 4_102_444_800,
            signing_key_id: "test-workos-key".to_string(),
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
    let invitation = community_invitation_for(&pool, "host@example.test").await;
    let exchange = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "method": "workos",
                        "invitation_credential": invitation
                    })
                    .to_string(),
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
