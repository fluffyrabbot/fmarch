use std::{str::FromStr, time::Duration};

use database_schema::{
    reconcile_database_authority, verify_database_principal, DatabasePrincipal,
    APPLICATION_DATABASE_ROLE, KEY_ADMIN_DATABASE_ROLE,
};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    Executor, PgPool,
};
use uuid::Uuid;

const APPLICATION_PASSWORD: &str = "application:'\\/?#[]@ whitespace % proof";
const KEY_ADMIN_PASSWORD: &str = "key-admin:'\\/?#[]@ different % proof";
const LOCAL_APPLICATION_PASSWORD: &str = "fmarch-local-application-password";
const LOCAL_KEY_ADMIN_PASSWORD: &str = "fmarch-local-key-admin-password";

#[sqlx::test(migrations = "./migrations")]
async fn database_roles_are_exact_non_owner_authorities(owner: PgPool) {
    reconcile_database_authority(&owner, APPLICATION_PASSWORD, KEY_ADMIN_PASSWORD)
        .await
        .expect("reconcile exact database roles and ACLs");
    let application = role_pool(&owner, APPLICATION_DATABASE_ROLE, APPLICATION_PASSWORD).await;
    let key_admin = role_pool(&owner, KEY_ADMIN_DATABASE_ROLE, KEY_ADMIN_PASSWORD).await;
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect("application authority should match exact manifest");
    verify_database_principal(&key_admin, DatabasePrincipal::KeyAdmin)
        .await
        .expect("key-admin authority should match exact manifest");

    let identity: (String, String) = sqlx::query_as("SELECT current_user, session_user")
        .fetch_one(&application)
        .await
        .unwrap();
    assert_eq!(identity.0, APPLICATION_DATABASE_ROLE);
    assert_eq!(identity.1, APPLICATION_DATABASE_ROLE);

    sqlx::query("INSERT INTO platform_principal (principal_id, created_at) VALUES ($1, 1)")
        .bind(Uuid::new_v4())
        .execute(&application)
        .await
        .expect("ordinary application insert");
    for sequence in [
        "events_seq_seq",
        "game_thread_visibility_change_id_seq",
        "identity_lifecycle_audit_id_seq",
    ] {
        sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
            "SELECT nextval('public.{sequence}')"
        )))
        .fetch_one(&application)
        .await
        .unwrap_or_else(|error| panic!("application should use {sequence}: {error}"));
    }
    sqlx::query(
        r#"
        INSERT INTO event_direct_key_sentinel (
            kid, sentinel_version, sentinel_nonce, sentinel_ciphertext
        ) VALUES ('authority-proof', 1, $1, $2)
        "#,
    )
    .bind(vec![7_u8; 24])
    .bind(vec![9_u8; 56])
    .execute(&application)
    .await
    .expect("application may install only the canonical writable sentinel shape");
    sqlx::query(
        "SELECT kid FROM event_direct_key_sentinel WHERE kid = 'authority-proof' FOR SHARE",
    )
    .fetch_one(&application)
    .await
    .expect("application row-lock privilege is intentionally narrow");

    for statement in [
        "CREATE TEMP TABLE authority_escape (id bigint)",
        "CREATE TABLE public.authority_escape (id bigint)",
        "ALTER TABLE public.events DISABLE TRIGGER ALL",
        "TRUNCATE TABLE public.events",
        "UPDATE public.events SET kind = kind",
        "DELETE FROM public.events",
        "UPDATE public.event_direct_key_sentinel SET lifecycle = 'retiring' WHERE kid = 'authority-proof'",
        "SET session_replication_role = replica",
    ] {
        assert_denied(&application, statement).await;
    }
    // PostgreSQL reports a no-op GRANT without grant option as a warning rather
    // than SQLSTATE 42501. Prove the attempted delegation leaves no effective
    // PUBLIC privilege instead of expecting an error that PostgreSQL does not
    // promise.
    application
        .execute("GRANT SELECT ON public.events TO PUBLIC")
        .await
        .expect("unauthorized GRANT is a successful no-op");
    let public_events_select: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            CROSS JOIN LATERAL aclexplode(
                COALESCE(relation.relacl, acldefault('r', relation.relowner))
            ) acl
            WHERE namespace.nspname = 'public'
              AND relation.relname = 'events'
              AND acl.grantee = 0
              AND acl.privilege_type = 'SELECT'
        )
        "#,
    )
    .fetch_one(&application)
    .await
    .unwrap();
    assert!(!public_events_select);
    assert_denied(&application, &format!("SET ROLE {KEY_ADMIN_DATABASE_ROLE}")).await;
    for statement in [
        "CREATE TEMP TABLE authority_escape (id bigint)",
        "CREATE TABLE public.authority_escape (id bigint)",
        "INSERT INTO public.events (stream_id, stream_seq, kind, version, occurred_at, sealed_version, stream_key_epoch, sealed_nonce, sealed_body) VALUES ('00000000-0000-0000-0000-000000000001', 1, 'proof', 1, 1, 3, 1, decode(repeat('00', 24), 'hex'), decode(repeat('00', 16), 'hex'))",
        "DELETE FROM public.auth_delivery_intent",
        "TRUNCATE TABLE public.event_stream_keys",
        "UPDATE public.auth_delivery_intent SET status = status",
        "UPDATE public.event_direct_key_sentinel SET kid = kid WHERE kid = 'authority-proof'",
    ] {
        assert_denied(&key_admin, statement).await;
    }
    assert_denied(&key_admin, &format!("SET ROLE {APPLICATION_DATABASE_ROLE}")).await;

    for grantee in [APPLICATION_DATABASE_ROLE, "PUBLIC"] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "GRANT SET ON PARAMETER session_replication_role TO {grantee}"
        )))
        .execute(&owner)
        .await
        .expect("owner can stage the parameter-ACL counterexample");
        verify_database_principal(&application, DatabasePrincipal::Application)
            .await
            .expect_err("parameter authority must fail application admission");
        reconcile_database_authority(&owner, APPLICATION_PASSWORD, KEY_ADMIN_PASSWORD)
            .await
            .expect("reconcile must revoke stale parameter authority");
        assert_denied(&application, "SET session_replication_role = replica").await;
    }

    // Exact ACL audit catches an accidental extra privilege and the reconciler
    // repairs the same catalog after a restore that discarded all ACLs.
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "GRANT UPDATE (lifecycle) ON event_direct_key_sentinel TO {APPLICATION_DATABASE_ROLE}"
    )))
    .execute(&owner)
    .await
    .unwrap();
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect_err("extra lifecycle grant must fail application admission");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APPLICATION_DATABASE_ROLE}, {KEY_ADMIN_DATABASE_ROLE}"
    )))
    .execute(&owner)
    .await
    .unwrap();
    database_schema::ensure_schema_ready(&owner)
        .await
        .expect("SQLx history alone still looks current after --no-acl restore");
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect_err("authority gate must reject a current schema with missing ACLs");
    reconcile_database_authority(&owner, APPLICATION_PASSWORD, KEY_ADMIN_PASSWORD)
        .await
        .expect("post-restore ACL reconciliation");
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect("application ACL repaired");
    verify_database_principal(&key_admin, DatabasePrincipal::KeyAdmin)
        .await
        .expect("key-admin ACL repaired");

    sqlx::query("DROP TRIGGER events_no_update ON public.events")
        .execute(&owner)
        .await
        .unwrap();
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect_err("missing write guard must fail application admission");
    sqlx::query(
        "CREATE TRIGGER events_no_update BEFORE DELETE OR UPDATE OR TRUNCATE ON public.events FOR EACH STATEMENT EXECUTE FUNCTION public.events_forbid_mutation()",
    )
    .execute(&owner)
    .await
    .unwrap();
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect("restored exact write guard");

    sqlx::query(
        r#"CREATE OR REPLACE FUNCTION public.events_forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN OLD;
END;
$$"#,
    )
    .execute(&owner)
    .await
    .unwrap();
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect_err("forged no-op write-guard body must fail application admission");
    sqlx::query(
        r#"CREATE OR REPLACE FUNCTION public.events_forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only: % is forbidden', TG_OP;
END;
$$"#,
    )
    .execute(&owner)
    .await
    .unwrap();
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect("restored exact write-guard body");

    sqlx::query(sqlx::AssertSqlSafe(format!(
        "ALTER SCHEMA public OWNER TO {KEY_ADMIN_DATABASE_ROLE}"
    )))
    .execute(&owner)
    .await
    .unwrap();
    verify_database_principal(&application, DatabasePrincipal::Application)
        .await
        .expect_err("untrusted public schema owner must fail application admission");
    let migration_owner: String = sqlx::query_scalar("SELECT quote_ident(current_user)")
        .fetch_one(&owner)
        .await
        .unwrap();
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "ALTER SCHEMA public OWNER TO {migration_owner}"
    )))
    .execute(&owner)
    .await
    .unwrap();

    sqlx::query("CREATE FUNCTION public.authority_trigger_canary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$")
        .execute(&owner)
        .await
        .unwrap();
    let public_execute: bool = sqlx::query_scalar(
        r#"
        SELECT COALESCE(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), FALSE)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE n.nspname = 'public' AND p.proname = 'authority_trigger_canary'
        "#,
    )
    .fetch_one(&owner)
    .await
    .unwrap();
    assert!(
        !public_execute,
        "owner default ACL must not regrant PUBLIC EXECUTE"
    );
    sqlx::query("DROP FUNCTION public.authority_trigger_canary()")
        .execute(&owner)
        .await
        .unwrap();
    reconcile_database_authority(&owner, LOCAL_APPLICATION_PASSWORD, LOCAL_KEY_ADMIN_PASSWORD)
        .await
        .expect("leave cluster-global proof roles at deterministic local credentials");
}

async fn role_pool(owner: &PgPool, role: &str, password: &str) -> PgPool {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(owner)
        .await
        .unwrap();
    let base_url = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx test owner");
    let options = PgConnectOptions::from_str(&base_url)
        .unwrap()
        .database(&database)
        .username(role)
        .password(password);
    PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await
        .unwrap_or_else(|error| panic!("connect {role}: {error}"))
}

async fn assert_denied(pool: &PgPool, statement: &str) {
    let error = match pool.execute(sqlx::AssertSqlSafe(statement)).await {
        Ok(_) => panic!("expected `{statement}` to be denied"),
        Err(error) => error,
    };
    let code = error
        .as_database_error()
        .and_then(|error| error.code())
        .map(|code| code.into_owned());
    assert_eq!(
        code.as_deref(),
        Some("42501"),
        "expected insufficient_privilege for `{statement}`, got {error}"
    );
}
