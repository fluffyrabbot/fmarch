use sqlx::PgPool;
use std::process::Command;

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn reconciler_uses_commands_and_is_idempotent(pool: PgPool) {
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
async fn reconciler_uses_a_non_login_machine_principal(pool: PgPool) {
    server::staging_search_corpus::reconcile(&pool)
        .await
        .expect("install staging search corpus");

    let host: uuid::Uuid = sqlx::query_scalar(
        "SELECT principal_id FROM game_authority WHERE game_id = $1 AND role = 'host'",
    )
    .bind(server::staging_search_corpus::CORPUS_GAME_ID)
    .fetch_one(&pool)
    .await
    .expect("read corpus host authority");
    assert_eq!(
        host,
        server::staging_search_corpus::CORPUS_HOST_PRINCIPAL_ID
    );

    let identity_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM platform_principal WHERE principal_id = $1)",
    )
    .bind(host)
    .fetch_one(&pool)
    .await
    .expect("inspect corpus host identity boundary");
    assert!(
        !identity_exists,
        "machine corpus ownership must not mint a login principal or global capability"
    );
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
