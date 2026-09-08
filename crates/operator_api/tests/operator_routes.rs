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
    operator_api::router_with_state(
        operator_api::OperatorApiState::new(pool, local_proof_session_policy(), 1).unwrap(),
    )
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
async fn default_operator_composition_rejects_methodless_local_proof_sessions(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let admin_token = create_session(&pool, "admin", &["GlobalAdmin"]).await;
    let response = operator_api::router(pool.clone(), identity::SessionPolicy::default(), 1)
        .unwrap()
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
    let corrupt_response = operator_api::router(pool, identity::SessionPolicy::default(), 1)
        .unwrap()
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

    for path in [
        format!("/games/{game}/operator"),
        format!("/games/{game}/operator/proof-runs/status"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .header(AUTHORIZATION, format!("Bearer {outsider_token}"))
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
