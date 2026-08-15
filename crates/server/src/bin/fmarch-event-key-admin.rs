use std::{env, fmt, process, str::FromStr, time::Duration};

use eventstore::{RuntimeKekLifecycle, RuntimeKekRetirementEvidence};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};

const DEFAULT_BATCH_SIZE: u32 = 256;
const MAX_BATCH_SIZE: u32 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Command {
    Plan,
    Migrate,
    Rehearse,
    Retire,
}

impl Command {
    fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Migrate => "migrate",
            Self::Rehearse => "rehearse",
            Self::Retire => "retire",
        }
    }
}

impl FromStr for Command {
    type Err = AdminError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "plan" => Ok(Self::Plan),
            "migrate" => Ok(Self::Migrate),
            "rehearse" => Ok(Self::Rehearse),
            "retire" => Ok(Self::Retire),
            _ => Err(AdminError(format!(
                "unknown runtime-kek command `{value}`; expected plan, migrate, rehearse, or retire"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Cli {
    command: Command,
    retiring_kid: String,
    expect_active_kid: String,
    batch_size: u32,
    execute: bool,
}

impl Cli {
    fn parse<I, S>(args: I) -> Result<Self, AdminError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut args = args.into_iter().map(Into::into);
        let namespace = args.next().ok_or_else(usage_error)?;
        if namespace != "runtime-kek" {
            return Err(AdminError(format!(
                "unknown admin namespace `{namespace}`; expected `runtime-kek`"
            )));
        }
        let command: Command = args.next().ok_or_else(usage_error)?.parse()?;
        let mut retiring_kid = None;
        let mut expect_active_kid = None;
        let mut batch_size = DEFAULT_BATCH_SIZE;
        let mut execute = false;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--retiring-kid" => {
                    retiring_kid = Some(required_flag_value(&mut args, "--retiring-kid")?);
                }
                "--expect-active-kid" => {
                    expect_active_kid =
                        Some(required_flag_value(&mut args, "--expect-active-kid")?);
                }
                "--batch-size" => {
                    let raw = required_flag_value(&mut args, "--batch-size")?;
                    batch_size = raw.parse().map_err(|_| {
                        AdminError(format!("invalid --batch-size `{raw}`; expected an integer"))
                    })?;
                }
                "--execute" => execute = true,
                unknown => return Err(AdminError(format!("unknown argument `{unknown}`"))),
            }
        }
        let retiring_kid = retiring_kid
            .ok_or_else(|| AdminError("missing required --retiring-kid".to_string()))?;
        let expect_active_kid = expect_active_kid
            .ok_or_else(|| AdminError("missing required --expect-active-kid".to_string()))?;
        validate_kid(&retiring_kid, "--retiring-kid")?;
        validate_kid(&expect_active_kid, "--expect-active-kid")?;
        if retiring_kid == expect_active_kid {
            return Err(AdminError(
                "retiring KID must differ from the expected active KID".to_string(),
            ));
        }
        if !(1..=MAX_BATCH_SIZE).contains(&batch_size) {
            return Err(AdminError(format!(
                "--batch-size must be 1..={MAX_BATCH_SIZE}"
            )));
        }
        if command == Command::Plan && execute {
            return Err(AdminError(
                "runtime-kek plan is always read-only and does not accept --execute".to_string(),
            ));
        }
        if command != Command::Plan && !execute {
            return Err(AdminError(format!(
                "runtime-kek {} requires --execute; use runtime-kek plan for a read-only preview",
                command.as_str()
            )));
        }
        Ok(Self {
            command,
            retiring_kid,
            expect_active_kid,
            batch_size,
            execute,
        })
    }
}

fn required_flag_value(
    args: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<String, AdminError> {
    let value = args
        .next()
        .ok_or_else(|| AdminError(format!("{flag} requires a value")))?;
    if value.starts_with("--") {
        return Err(AdminError(format!("{flag} requires a value")));
    }
    Ok(value)
}

fn validate_kid(kid: &str, flag: &str) -> Result<(), AdminError> {
    if kid.is_empty()
        || kid.len() > 128
        || !kid.as_bytes()[0].is_ascii_alphanumeric()
        || !kid
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(AdminError(format!(
            "{flag} must start with an ASCII letter or digit and contain only ASCII letters, digits, dots, underscores, colons, or hyphens (1..=128 bytes)"
        )));
    }
    Ok(())
}

fn usage_error() -> AdminError {
    AdminError(
        "usage: fmarch-event-key-admin runtime-kek plan|migrate|rehearse|retire \
         --retiring-kid OLD --expect-active-kid NEW [--batch-size 256] [--execute]"
            .to_string(),
    )
}

#[derive(Debug)]
struct AdminError(String);

impl fmt::Display for AdminError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AdminError {}

impl From<sqlx::Error> for AdminError {
    fn from(error: sqlx::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<eventstore::StoreError> for AdminError {
    fn from(error: eventstore::StoreError) -> Self {
        Self(error.to_string())
    }
}

impl From<projections::ProjectionError> for AdminError {
    fn from(error: projections::ProjectionError) -> Self {
        Self(error.to_string())
    }
}

impl From<server::DatabaseAuthorityError> for AdminError {
    fn from(error: server::DatabaseAuthorityError) -> Self {
        Self(error.to_string())
    }
}

impl From<api::identity_delivery::IdentityDeliveryError> for AdminError {
    fn from(error: api::identity_delivery::IdentityDeliveryError) -> Self {
        Self(error.to_string())
    }
}

#[tokio::main]
async fn main() {
    match run().await {
        Ok(report) => println!("{report}"),
        Err(error) => {
            eprintln!("{}", json!({"status": "error", "error": error.to_string()}));
            process::exit(1);
        }
    }
}

async fn run() -> Result<Value, AdminError> {
    let cli = Cli::parse(env::args().skip(1))?;
    verify_expected_active_kid(&cli)?;
    eventstore::require_secure_event_encryption_configuration()?;
    if env::var_os("DATABASE_URL").is_some()
        || env::var_os("DATABASE_MIGRATION_URL").is_some()
        || env::var_os("FMARCH_DATABASE_APPLICATION_PASSWORD").is_some()
        || env::var_os("FMARCH_DATABASE_KEY_ADMIN_PASSWORD").is_some()
    {
        return Err(AdminError(
            "fmarch-event-key-admin accepts only DATABASE_KEY_ADMIN_URL; application and migration credentials must not enter its environment"
                .to_string(),
        ));
    }
    server::reject_ambient_postgres_environment("fmarch-event-key-admin", "DATABASE_KEY_ADMIN_URL")
        .map_err(AdminError)?;
    let database_url = env::var("DATABASE_KEY_ADMIN_URL")
        .map_err(|_| AdminError("DATABASE_KEY_ADMIN_URL is required".to_string()))?;
    server::validate_database_transport(&database_url, "DATABASE_KEY_ADMIN_URL")
        .map_err(AdminError)?;
    let acquire_timeout = bounded_env_ms("FMARCH_DB_ACQUIRE_TIMEOUT_MS", 250, 1, 60_000)?;
    let statement_timeout = format!(
        "{}ms",
        bounded_env_ms("FMARCH_DB_STATEMENT_TIMEOUT_MS", 5_000, 10, 300_000)?
    );
    let lock_timeout = format!(
        "{}ms",
        bounded_env_ms("FMARCH_DB_LOCK_TIMEOUT_MS", 1_000, 1, 300_000)?
    );
    let idle_transaction_timeout = format!(
        "{}ms",
        bounded_env_ms("FMARCH_DB_IDLE_TRANSACTION_TIMEOUT_MS", 10_000, 10, 300_000,)?
    );
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_millis(acquire_timeout))
        .after_connect(move |connection, _metadata| {
            let statement_timeout = statement_timeout.clone();
            let lock_timeout = lock_timeout.clone();
            let idle_transaction_timeout = idle_transaction_timeout.clone();
            Box::pin(async move {
                sqlx::query("SELECT set_config('statement_timeout', $1, false)")
                    .bind(statement_timeout)
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SELECT set_config('lock_timeout', $1, false)")
                    .bind(lock_timeout)
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SELECT set_config('idle_in_transaction_session_timeout', $1, false)")
                    .bind(idle_transaction_timeout)
                    .execute(&mut *connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await?;
    server::ensure_schema_ready(&pool).await?;
    server::verify_database_principal(&pool, server::DatabasePrincipal::KeyAdmin).await?;
    if matches!(cli.command, Command::Plan | Command::Migrate) {
        eventstore::audit_event_encryption_key_coverage(&pool).await?;
    }
    match cli.command {
        Command::Plan => plan(&pool, &cli).await,
        Command::Migrate => migrate(&pool, &cli).await,
        Command::Rehearse => rehearse(&pool, &cli).await,
        Command::Retire => retire(&pool, &cli).await,
    }
}

fn bounded_env_ms(name: &str, default: u64, minimum: u64, maximum: u64) -> Result<u64, AdminError> {
    let raw = env::var(name).ok();
    parse_bounded_ms(name, raw.as_deref(), default, minimum, maximum)
}

fn parse_bounded_ms(
    name: &str,
    raw: Option<&str>,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> Result<u64, AdminError> {
    let value = match raw {
        Some(raw) => raw.parse::<u64>().map_err(|_| {
            AdminError(format!(
                "{name} must be an integer between {minimum} and {maximum}"
            ))
        })?,
        None => default,
    };
    if !(minimum..=maximum).contains(&value) {
        return Err(AdminError(format!(
            "{name} must be between {minimum} and {maximum}"
        )));
    }
    Ok(value)
}

fn verify_expected_active_kid(cli: &Cli) -> Result<(), AdminError> {
    let configured = env::var("FMARCH_EVENT_WRAP_KID")
        .map_err(|_| AdminError("FMARCH_EVENT_WRAP_KID is required".to_string()))?;
    if configured != cli.expect_active_kid {
        return Err(AdminError(format!(
            "expected active runtime KID `{}` but the configured active KID is `{configured}`",
            cli.expect_active_kid
        )));
    }
    Ok(())
}

async fn direct_reference_count(pool: &PgPool, kid: &str) -> Result<u64, AdminError> {
    let projections = projections::count_private_projection_envelopes_by_kid(pool, kid).await?;
    let deliveries =
        api::identity_delivery::count_delivery_credential_envelopes_by_kid(pool, kid).await?;
    projections
        .checked_add(deliveries)
        .ok_or_else(|| AdminError("direct-envelope reference count overflowed u64".to_string()))
}

async fn plan(pool: &PgPool, cli: &Cli) -> Result<Value, AdminError> {
    let projection_references =
        projections::count_private_projection_envelopes_by_kid(pool, &cli.retiring_kid).await?;
    let delivery_references =
        api::identity_delivery::count_delivery_credential_envelopes_by_kid(pool, &cli.retiring_kid)
            .await?;
    let direct_references = projection_references
        .checked_add(delivery_references)
        .ok_or_else(|| AdminError("direct-envelope reference count overflowed u64".to_string()))?;
    let references = eventstore::runtime_kek_reference_report(pool, &cli.retiring_kid).await?;
    require_exact_direct_registry(&references, direct_references)?;
    Ok(json!({
        "status": "ok",
        "operation": "plan",
        "read_only": true,
        "retiring_kid": cli.retiring_kid,
        "expected_active_kid": cli.expect_active_kid,
        "batch_size": cli.batch_size,
        "lifecycle": references.status.as_ref().map(public_runtime_kek_status),
        "references": {
            "stream_keys": references.stream_key_references,
            "private_projections": projection_references,
            "delivery_credentials": delivery_references,
            "direct_total": direct_references,
            "total": references.stream_key_references.checked_add(direct_references)
                .ok_or_else(|| AdminError("runtime KEK reference count overflowed u64".to_string()))?,
        }
    }))
}

async fn migrate(pool: &PgPool, cli: &Cli) -> Result<Value, AdminError> {
    if let Some(status) = eventstore::runtime_kek_status(pool, &cli.retiring_kid).await? {
        validate_status_target_if_started(&status, cli)?;
        if status.lifecycle == RuntimeKekLifecycle::Retired || status.rehearsal_token.is_some() {
            require_zero_references(pool, cli).await?;
            return Ok(json!({
                "status": "ok",
                "operation": "migrate",
                "executed": true,
                "retiring_kid": cli.retiring_kid,
                "target_kid": cli.expect_active_kid,
                "lifecycle": public_runtime_kek_status(&status),
                "already_rehearsed": status.rehearsal_token.is_some(),
                "already_retired": status.lifecycle == RuntimeKekLifecycle::Retired,
                "migrated": {
                    "stream_keys": 0,
                    "private_projections": 0,
                    "delivery_credentials": 0,
                },
                "remaining_references": 0,
            }));
        }
    }
    let lifecycle =
        eventstore::begin_runtime_kek_retirement(pool, &cli.retiring_kid, &cli.expect_active_kid)
            .await?;
    let mut stream_rewrapped = 0_u64;
    loop {
        let batch = eventstore::rewrap_stream_data_keys_by_kid_batch(
            pool,
            &cli.retiring_kid,
            cli.batch_size,
        )
        .await?;
        stream_rewrapped = checked_add(stream_rewrapped, batch.rewrapped, "stream rewrap")?;
        if !batch.batch_full {
            break;
        }
        ensure_progress(batch.rewrapped, "stream rewrap")?;
    }

    let mut projections_resealed = 0_u64;
    loop {
        let batch =
            projections::reseal_private_projection_batch(pool, &cli.retiring_kid, cli.batch_size)
                .await?;
        projections_resealed = checked_add(
            projections_resealed,
            batch.resealed,
            "private projection reseal",
        )?;
        if !batch.batch_full {
            break;
        }
        ensure_progress(batch.resealed, "private projection reseal")?;
    }

    let mut deliveries_resealed = 0_u64;
    loop {
        let batch = api::identity_delivery::reseal_identity_delivery_credentials_batch(
            pool,
            &cli.retiring_kid,
            i64::from(cli.batch_size),
        )
        .await?;
        deliveries_resealed = checked_add(
            deliveries_resealed,
            batch.resealed,
            "delivery credential reseal",
        )?;
        if !batch.batch_full {
            break;
        }
        ensure_progress(batch.resealed, "delivery credential reseal")?;
    }

    let direct_references = direct_reference_count(pool, &cli.retiring_kid).await?;
    let references = eventstore::runtime_kek_reference_report(pool, &cli.retiring_kid).await?;
    require_exact_direct_registry(&references, direct_references)?;
    if references.stream_key_references != 0 || references.direct_reference_count != 0 {
        return Err(AdminError(
            "runtime KEK migration ended with live references".to_string(),
        ));
    }
    Ok(json!({
        "status": "ok",
        "operation": "migrate",
        "executed": true,
        "retiring_kid": cli.retiring_kid,
        "target_kid": cli.expect_active_kid,
        "lifecycle": public_runtime_kek_status(&lifecycle),
        "already_rehearsed": false,
        "already_retired": false,
        "migrated": {
            "stream_keys": stream_rewrapped,
            "private_projections": projections_resealed,
            "delivery_credentials": deliveries_resealed,
        },
        "remaining_references": 0,
    }))
}

async fn rehearse(pool: &PgPool, cli: &Cli) -> Result<Value, AdminError> {
    ensure_retiring_kid_absent_from_environment(&cli.retiring_kid)?;
    let direct_references = direct_reference_count(pool, &cli.retiring_kid).await?;
    let status = eventstore::runtime_kek_status(pool, &cli.retiring_kid)
        .await?
        .ok_or_else(|| {
            AdminError(format!(
                "runtime KEK `{}` is not registered",
                cli.retiring_kid
            ))
        })?;
    validate_status_target(&status, cli)?;
    require_zero_references(pool, cli).await?;
    let evidence_recorded = if status.lifecycle == RuntimeKekLifecycle::Retired {
        false
    } else if status.rehearsal_token.is_some() {
        true
    } else {
        eventstore::rehearse_runtime_kek_retirement(
            pool,
            &cli.retiring_kid,
            &cli.expect_active_kid,
        )
        .await?;
        true
    };
    Ok(json!({
        "status": "ok",
        "operation": "rehearse",
        "executed": true,
        "retiring_kid": cli.retiring_kid,
        "target_kid": cli.expect_active_kid,
        "already_retired": status.lifecycle == RuntimeKekLifecycle::Retired,
        "evidence_recorded": evidence_recorded,
        "verified_direct_references": direct_references,
    }))
}

async fn retire(pool: &PgPool, cli: &Cli) -> Result<Value, AdminError> {
    ensure_retiring_kid_absent_from_environment(&cli.retiring_kid)?;
    let direct_references = direct_reference_count(pool, &cli.retiring_kid).await?;
    let status = eventstore::runtime_kek_status(pool, &cli.retiring_kid)
        .await?
        .ok_or_else(|| {
            AdminError(format!(
                "runtime KEK `{}` is not registered",
                cli.retiring_kid
            ))
        })?;
    validate_status_target(&status, cli)?;
    require_zero_references(pool, cli).await?;
    if status.lifecycle == RuntimeKekLifecycle::Retired {
        return Ok(json!({
            "status": "ok",
            "operation": "retire",
            "executed": true,
            "retiring_kid": cli.retiring_kid,
            "target_kid": cli.expect_active_kid,
            "already_retired": true,
            "lifecycle": public_runtime_kek_status(&status),
            "verified_direct_references": direct_references,
        }));
    }
    let evidence = persisted_retirement_evidence(&status, cli)?;
    let lifecycle = eventstore::finalize_runtime_kek_retirement(pool, &evidence).await?;
    Ok(json!({
        "status": "ok",
        "operation": "retire",
        "executed": true,
        "retiring_kid": cli.retiring_kid,
        "target_kid": cli.expect_active_kid,
        "already_retired": false,
        "lifecycle": public_runtime_kek_status(&lifecycle),
        "verified_direct_references": direct_references,
    }))
}

fn persisted_retirement_evidence(
    status: &eventstore::RuntimeKekStatus,
    cli: &Cli,
) -> Result<RuntimeKekRetirementEvidence, AdminError> {
    let token = status.rehearsal_token.ok_or_else(|| {
        AdminError(format!(
            "runtime KEK `{}` has no durable removal rehearsal; run `runtime-kek rehearse --retiring-kid {} --expect-active-kid {} --execute` first",
            cli.retiring_kid, cli.retiring_kid, cli.expect_active_kid
        ))
    })?;
    Ok(RuntimeKekRetirementEvidence {
        retiring_kid: cli.retiring_kid.clone(),
        target_kid: cli.expect_active_kid.clone(),
        token,
    })
}

fn ensure_retiring_kid_absent_from_environment(retiring_kid: &str) -> Result<(), AdminError> {
    let configured = env::var("FMARCH_EVENT_WRAP_KEYS").unwrap_or_default();
    let present = configured.split(',').any(|entry| {
        entry
            .split_once('=')
            .map(|(kid, _)| kid.trim() == retiring_kid)
            .unwrap_or(false)
    });
    if present {
        return Err(AdminError(format!(
            "retiring runtime KID `{retiring_kid}` must be absent from FMARCH_EVENT_WRAP_KEYS"
        )));
    }
    Ok(())
}

fn validate_status_target(
    status: &eventstore::RuntimeKekStatus,
    cli: &Cli,
) -> Result<(), AdminError> {
    if status.retirement_target_kid.as_deref() != Some(cli.expect_active_kid.as_str()) {
        return Err(AdminError(format!(
            "runtime KEK `{}` is not bound to expected retirement target `{}`",
            cli.retiring_kid, cli.expect_active_kid
        )));
    }
    Ok(())
}

fn validate_status_target_if_started(
    status: &eventstore::RuntimeKekStatus,
    cli: &Cli,
) -> Result<(), AdminError> {
    if status.lifecycle == RuntimeKekLifecycle::Writable {
        return Ok(());
    }
    validate_status_target(status, cli)
}

fn public_runtime_kek_status(status: &eventstore::RuntimeKekStatus) -> Value {
    json!({
        "kid": status.kid,
        "lifecycle": status.lifecycle,
        "retirement_target_kid": status.retirement_target_kid,
        "rehearsed": status.rehearsal_token.is_some(),
    })
}

async fn require_zero_references(pool: &PgPool, cli: &Cli) -> Result<(), AdminError> {
    let direct_references = direct_reference_count(pool, &cli.retiring_kid).await?;
    let references = eventstore::runtime_kek_reference_report(pool, &cli.retiring_kid).await?;
    require_exact_direct_registry(&references, direct_references)?;
    if references.stream_key_references != 0 || references.direct_reference_count != 0 {
        return Err(AdminError(format!(
            "runtime KEK `{}` still has {} stream-key and {} direct-envelope references",
            cli.retiring_kid, references.stream_key_references, references.direct_reference_count,
        )));
    }
    Ok(())
}

fn require_exact_direct_registry(
    references: &eventstore::RuntimeKekReferenceReport,
    component_count: u64,
) -> Result<(), AdminError> {
    if references.direct_reference_count != component_count {
        return Err(AdminError(format!(
            "runtime KEK direct-reference registry mismatch: authoritative={} component_count={component_count}",
            references.direct_reference_count
        )));
    }
    Ok(())
}

fn checked_add(total: u64, value: u64, operation: &str) -> Result<u64, AdminError> {
    total
        .checked_add(value)
        .ok_or_else(|| AdminError(format!("{operation} count overflowed u64")))
}

fn ensure_progress(processed: u64, operation: &str) -> Result<(), AdminError> {
    if processed == 0 {
        return Err(AdminError(format!("{operation} made no progress")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(command: &str) -> Vec<&str> {
        vec![
            "runtime-kek",
            command,
            "--retiring-kid",
            "old-v1",
            "--expect-active-kid",
            "new-v2",
        ]
    }

    #[test]
    fn plan_is_the_read_only_default() {
        let parsed = Cli::parse(base("plan")).unwrap();
        assert_eq!(parsed.command, Command::Plan);
        assert!(!parsed.execute);
        assert_eq!(parsed.batch_size, DEFAULT_BATCH_SIZE);
    }

    #[test]
    fn mutations_require_execute() {
        let error = Cli::parse(base("migrate")).unwrap_err();
        assert!(error.to_string().contains("requires --execute"));
    }

    #[test]
    fn source_cannot_be_active_target() {
        let error = Cli::parse([
            "runtime-kek",
            "plan",
            "--retiring-kid",
            "same-v1",
            "--expect-active-kid",
            "same-v1",
        ])
        .unwrap_err();
        assert!(error.to_string().contains("must differ"));
    }

    #[test]
    fn kids_must_be_representable_in_the_historical_keyring() {
        for invalid in [
            "old=v1", "old,v1", "old v1", "old/v1", "-old", ".old", "_old", ":old",
        ] {
            let error = Cli::parse([
                "runtime-kek",
                "plan",
                "--retiring-kid",
                invalid,
                "--expect-active-kid",
                "new-v2",
            ])
            .unwrap_err();
            assert!(error
                .to_string()
                .contains("must start with an ASCII letter"));
        }
        assert!(validate_kid("--old", "--retiring-kid").is_err());
    }

    #[test]
    fn database_timeouts_are_bounded() {
        assert_eq!(
            parse_bounded_ms("LOCK", None, 1_000, 1, 5_000).unwrap(),
            1_000
        );
        assert_eq!(
            parse_bounded_ms("LOCK", Some("250"), 1_000, 1, 5_000).unwrap(),
            250
        );
        assert!(parse_bounded_ms("LOCK", Some("0"), 1_000, 1, 5_000).is_err());
        assert!(parse_bounded_ms("LOCK", Some("forever"), 1_000, 1, 5_000).is_err());
    }

    #[test]
    fn unknown_arguments_fail_closed() {
        let mut args = base("plan");
        args.push("--key-material");
        args.push("secret-value");
        let error = Cli::parse(args).unwrap_err();
        assert_eq!(error.to_string(), "unknown argument `--key-material`");
        assert!(!error.to_string().contains("secret-value"));
    }

    #[test]
    fn reports_have_no_key_material_field() {
        let report = json!({
            "status": "ok",
            "retiring_kid": "old-v1",
            "expected_active_kid": "new-v2",
            "references": {"total": 0},
        })
        .to_string();
        assert!(!report.contains("FMARCH_EVENT_WRAP_KEY"));
        assert!(!report.contains("secret-value"));
    }

    #[test]
    fn public_status_never_serializes_rehearsal_tokens() {
        let status = eventstore::RuntimeKekStatus {
            kid: "old-v1".to_string(),
            lifecycle: RuntimeKekLifecycle::Retiring,
            retirement_target_kid: Some("new-v2".to_string()),
            rehearsal_token: Some(
                uuid::Uuid::parse_str("e87820fa-8cd9-4aa0-94ae-ee209b63db0b").unwrap(),
            ),
        };
        let report = public_runtime_kek_status(&status).to_string();
        assert!(!report.contains("e87820fa"));
        assert!(!report.contains("rehearsal_token"));
        assert!(report.contains("\"rehearsed\":true"));
    }

    #[test]
    fn retire_requires_a_distinct_durable_rehearsal() {
        let mut args = base("retire");
        args.push("--execute");
        let cli = Cli::parse(args).unwrap();
        let status = eventstore::RuntimeKekStatus {
            kid: "old-v1".to_string(),
            lifecycle: RuntimeKekLifecycle::Retiring,
            retirement_target_kid: Some("new-v2".to_string()),
            rehearsal_token: None,
        };
        let error = persisted_retirement_evidence(&status, &cli).unwrap_err();
        assert!(error.to_string().contains("no durable removal rehearsal"));
        assert!(error.to_string().contains("runtime-kek rehearse"));
    }
}
