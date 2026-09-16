use axum::body::{to_bytes, Body};
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use principal::PrincipalId;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{RejectCode, RejectMsg};

const LOCAL_PROOF_SECRET: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn local_proof_authority() -> &'static identity::LocalProofSessionAuthority {
    static AUTHORITY: OnceLock<identity::LocalProofSessionAuthority> = OnceLock::new();
    AUTHORITY.get_or_init(|| {
        identity::LocalProofSessionAuthority::from_secret(LOCAL_PROOF_SECRET)
            .expect("operator fixture local-proof secret is canonical")
    })
}

fn local_proof_session_policy() -> identity::SessionPolicy {
    identity::SessionPolicy::default()
        .with_local_proof_instance(local_proof_authority().instance_id().clone())
}

fn app(pool: sqlx::PgPool) -> axum::Router {
    operator_api::router_with_state(operator_api::OperatorApiState::new(
        pool,
        local_proof_session_policy(),
    ))
}

fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn create_session(pool: &sqlx::PgPool, user: &str, globals: &[&str]) -> String {
    let principal_id = PrincipalId::fixture(user);
    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) \
         VALUES ($1, 'active', $2, 0) ON CONFLICT (principal_id) DO UPDATE SET global_capabilities = EXCLUDED.global_capabilities",
    )
    .bind(principal_id.as_uuid())
    .bind(globals)
    .execute(pool)
    .await
    .expect("insert operator principal");
    let policy = local_proof_session_policy();
    let grant = local_proof_authority()
        .authorize(LOCAL_PROOF_SECRET, Vec::new())
        .expect("authorize operator fixture local-proof session");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("operator fixture clock is after the Unix epoch")
        .as_secs() as i64;
    let mut tx = identity::session::begin_authority_transaction(pool)
        .await
        .expect("begin operator fixture authority transaction");
    let pending = identity::issue_local_proof_session(
        &mut tx,
        &principal_id,
        grant,
        4_102_444_800,
        &policy,
        now,
    )
    .await
    .expect("issue operator fixture local-proof session");
    tx.commit()
        .await
        .expect("commit operator fixture local-proof session");
    pending
        .activate()
        .expect("activate operator fixture local-proof session")
        .session_token
}

async fn grant_game_authority(pool: &sqlx::PgPool, game: Uuid, user: &str, role: &str) {
    sqlx::query("INSERT INTO game_authority (game_id, principal_id, role) VALUES ($1, $2, $3)")
        .bind(game)
        .bind(PrincipalId::fixture(user).as_uuid())
        .bind(role)
        .execute(pool)
        .await
        .expect("insert game authority");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn http_cannot_execute_replay_even_for_a_host_while_a_writer_owns_the_stream(
    pool: sqlx::PgPool,
) {
    let game = Uuid::new_v4();
    grant_game_authority(&pool, game, "host_h", "host").await;
    let token = create_session(&pool, "host_h", &[]).await;
    let app = app(pool.clone());
    let mut writer = pool.begin().await.unwrap();
    eventstore::lock_stream_in_tx(&mut writer, game)
        .await
        .unwrap();

    // Previously the projection GET waited on this writer, then deleted and
    // replayed live rows while holding the same lock. HTTP cannot initiate
    // diagnostic replay of an existing game. Completed-game import separately
    // verifies projections for a newly imported stream inside its transaction.
    for path in [
        "projection-audit",
        "projection-audit/view",
        "resolution-audit",
        "resolution-audit/view",
    ] {
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            app.clone().oneshot(
                Request::builder()
                    .uri(format!("/games/{game}/{path}"))
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            ),
        )
        .await
        .expect("an absent replay route must not wait for a game writer")
        .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
    writer.commit().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn default_operator_composition_rejects_methodless_local_proof_sessions(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let admin_token = create_session(&pool, "admin", &["GlobalAdmin"]).await;
    let response = operator_api::router(pool.clone(), identity::SessionPolicy::default())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator"))
                .header(AUTHORIZATION, format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // Simulate a corrupted/restored pre-0004 row to prove the runtime policy
    // does not confuse two absent instance ids for a successful match.
    sqlx::query(
        "ALTER TABLE auth_session DROP CONSTRAINT auth_session_local_proof_instance_shape_check",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE auth_session SET local_proof_instance_id = NULL WHERE token_hash = $1")
        .bind(token_hash(&admin_token))
        .execute(&pool)
        .await
        .unwrap();
    let corrupt_response = operator_api::router(pool, identity::SessionPolicy::default())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator"))
                .header(AUTHORIZATION, format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(corrupt_response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn operator_routes_are_host_audit_only(pool: sqlx::PgPool) {
    let app = app(pool.clone());
    let game = Uuid::new_v4();
    grant_game_authority(&pool, game, "host_h", "host").await;
    grant_game_authority(&pool, game, "cohost_c", "cohost").await;
    let host_token = create_session(&pool, "host_h", &[]).await;
    let cohost_token = create_session(&pool, "cohost_c", &[]).await;
    let outsider_token = create_session(&pool, "outsider", &[]).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator?principal_id={}",
                    PrincipalId::fixture("outsider")
                ))
                .header(AUTHORIZATION, format!("Bearer {host_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Operator Index"));
    assert!(html.contains(&format!("/games/{game}/operator/proof-runs")));
    assert!(!html.contains("principal_id="));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_id={}",
                    PrincipalId::fixture("host_h")
                ))
                .header(AUTHORIZATION, format!("Bearer {cohost_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let mut protected_paths = vec![
        format!("/games/{game}/operator"),
        format!("/games/{game}/operator/proof-runs"),
        format!("/games/{game}/operator/proof-runs/status"),
    ];
    // Saved evidence remains host-authorized after diagnostic execution routes
    // disappear. Check every artifact family in both representations so removing
    // a replay endpoint cannot silently remove artifact disclosure coverage.
    for artifact in [
        "status-audit",
        "go-no-go",
        "retention",
        "projection-rebuild",
        "resolution-diff",
        "trace-inspection",
        "large-action-graph-performance",
        "determinism-fuzz",
    ] {
        protected_paths.push(format!("/games/{game}/operator/proof-runs/{artifact}"));
        protected_paths.push(format!("/games/{game}/operator/proof-runs/{artifact}/view"));
    }
    for path in protected_paths {
        for (token, status) in [
            (Some(outsider_token.as_str()), StatusCode::FORBIDDEN),
            (None, StatusCode::UNAUTHORIZED),
        ] {
            let mut request = Request::builder().method("GET").uri(format!(
                "{path}?principal_id={}",
                PrincipalId::fixture("host_h")
            ));
            if let Some(token) = token {
                request = request.header(AUTHORIZATION, format!("Bearer {token}"));
            }
            let response = app
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), status, "{path}");
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(reject.error, RejectCode::NotAuthorized, "{path}");
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn active_global_operator_session_can_read_status_without_dev_auth(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let admin_token = create_session(&pool, "admin_a", &["GlobalAdmin"]).await;

    let operator = app(pool);
    let response = operator
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_id={}",
                    PrincipalId::fixture("outsider")
                ))
                .header(AUTHORIZATION, format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = operator
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_id={}",
                    PrincipalId::fixture("admin_a")
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
