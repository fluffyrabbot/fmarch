use caps::PrincipalId;
use sqlx::PgPool;
use std::process::Command;

async fn insert_active_global_admin(pool: &PgPool) -> PrincipalId {
    let principal_id = PrincipalId::random();
    sqlx::query(
        r#"
        INSERT INTO platform_principal
            (principal_id, status, global_capabilities, created_at, disabled_at)
        VALUES ($1, 'active', ARRAY['GlobalAdmin'], 1, NULL)
        "#,
    )
    .bind(principal_id.as_uuid())
    .execute(pool)
    .await
    .expect("insert authentication-boundary fixture admin");
    principal_id
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn reconciler_uses_commands_and_is_idempotent(pool: PgPool) {
    insert_active_global_admin(&pool).await;

    let first = server::staging_search_corpus::reconcile(&pool)
        .await
        .expect("install staging search corpus");
    assert!(first.created);
    assert!(first.started);
    assert!(first.projected_public_game);
    assert!(first.projected_search_match);

    let second = server::staging_search_corpus::reconcile(&pool)
        .await
        .expect("reconcile existing staging search corpus");
    assert!(!second.created);
    assert!(!second.started);
    assert!(second.projected_search_match);

    let event_count: i64 = sqlx::query_scalar("SELECT count(*) FROM events WHERE stream_id = $1")
        .bind(server::staging_search_corpus::CORPUS_GAME_ID)
        .fetch_one(&pool)
        .await
        .expect("count corpus source events");
    assert_eq!(
        event_count, 2,
        "reconciliation must not append duplicate facts"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn reconciler_requires_an_active_global_admin(pool: PgPool) {
    let error = server::staging_search_corpus::reconcile(&pool)
        .await
        .expect_err("missing source-of-truth owner must fail closed");
    assert!(error.contains("requires one active global admin"));
}

#[test]
fn deployed_reconciler_refuses_non_staging_environments_before_database_access() {
    let output = Command::new(env!("CARGO_BIN_EXE_fmarch-staging-search-corpus"))
        .env_clear()
        .arg("reconcile")
        .env("RAILWAY_ENVIRONMENT_NAME", "production")
        .output()
        .expect("run deployed staging corpus reconciler");
    assert!(!output.status.success());
    let error = String::from_utf8(output.stderr).expect("reconciler error is UTF-8");
    assert!(error.contains("staging-only; refusing environment production"));
    assert!(!error.contains("DATABASE_URL is required"));
}
