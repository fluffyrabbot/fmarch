//! Protected one-shot maintenance for the profile handle blind index.
//!
//! This binary deliberately uses only the application database credential plus
//! the profile and subject-key authorities. It is not a Railway service and is
//! meant for a short-lived operator shell after every API replica has been
//! drained. Key material is read only from environment variables and is never
//! accepted as an argument or emitted in a report.

use std::{env, fmt, process, str::FromStr};

use profile_handle_index::{
    replacement_profile_handle_index_configuration, require_profile_handle_index_configuration,
    ProfileHandleIndexError,
};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, Connection, PgConnection};

const DEFAULT_DRAIN_TIMEOUT_MS: u64 = 30_000;
const MIN_DRAIN_TIMEOUT_MS: u64 = 1_000;
const MAX_DRAIN_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_STATEMENT_TIMEOUT_MS: u64 = 300_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Command {
    Plan,
    Reindex,
}

impl FromStr for Command {
    type Err = AdminError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "plan" => Ok(Self::Plan),
            "reindex" => Ok(Self::Reindex),
            _ => Err(AdminError(format!(
                "unknown profile handle-index command `{value}`; expected plan or reindex"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Cli {
    command: Command,
    expect_current_kid: String,
    replacement_kid: String,
    drain_timeout_ms: u64,
    writers_drained: bool,
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
        if namespace != "profile-handle-index" {
            return Err(AdminError(format!(
                "unknown admin namespace `{namespace}`; expected `profile-handle-index`"
            )));
        }
        let command: Command = args.next().ok_or_else(usage_error)?.parse()?;
        let mut expect_current_kid = None;
        let mut replacement_kid = None;
        let mut drain_timeout_ms = DEFAULT_DRAIN_TIMEOUT_MS;
        let mut writers_drained = false;
        let mut execute = false;
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--expect-current-kid" => {
                    expect_current_kid =
                        Some(required_flag_value(&mut args, "--expect-current-kid")?);
                }
                "--replacement-kid" => {
                    replacement_kid = Some(required_flag_value(&mut args, "--replacement-kid")?);
                }
                "--drain-timeout-ms" => {
                    let raw = required_flag_value(&mut args, "--drain-timeout-ms")?;
                    drain_timeout_ms = raw.parse().map_err(|_| {
                        AdminError(format!(
                            "invalid --drain-timeout-ms `{raw}`; expected an integer"
                        ))
                    })?;
                }
                "--writers-drained" => writers_drained = true,
                "--execute" => execute = true,
                unknown => return Err(AdminError(format!("unknown argument `{unknown}`"))),
            }
        }
        let expect_current_kid = expect_current_kid
            .ok_or_else(|| AdminError("missing required --expect-current-kid".to_string()))?;
        let replacement_kid = replacement_kid
            .ok_or_else(|| AdminError("missing required --replacement-kid".to_string()))?;
        validate_kid(&expect_current_kid, "--expect-current-kid")?;
        validate_kid(&replacement_kid, "--replacement-kid")?;
        if expect_current_kid == replacement_kid {
            return Err(AdminError(
                "replacement KID must differ from the expected current KID".to_string(),
            ));
        }
        if !(MIN_DRAIN_TIMEOUT_MS..=MAX_DRAIN_TIMEOUT_MS).contains(&drain_timeout_ms) {
            return Err(AdminError(format!(
                "--drain-timeout-ms must be {MIN_DRAIN_TIMEOUT_MS}..={MAX_DRAIN_TIMEOUT_MS}"
            )));
        }
        match command {
            Command::Plan if execute || writers_drained => {
                return Err(AdminError(
                    "profile-handle-index plan is read-only; it does not accept --execute or --writers-drained"
                        .to_string(),
                ));
            }
            Command::Reindex if !execute || !writers_drained => {
                return Err(AdminError(
                    "profile-handle-index reindex requires both --writers-drained and --execute"
                        .to_string(),
                ));
            }
            _ => {}
        }
        Ok(Self {
            command,
            expect_current_kid,
            replacement_kid,
            drain_timeout_ms,
            writers_drained,
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
        || !kid
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(AdminError(format!(
            "{flag} must be a non-empty trimmed identifier using only ASCII letters, digits, dots, underscores, or hyphens (1..=128 bytes)"
        )));
    }
    Ok(())
}

fn usage_error() -> AdminError {
    AdminError(
        "usage: fmarch-profile-index-admin profile-handle-index plan|reindex \\
         --expect-current-kid OLD --replacement-kid NEW [--drain-timeout-ms 30000] \\
         [--writers-drained --execute]"
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

impl From<server::DatabaseAuthorityError> for AdminError {
    fn from(error: server::DatabaseAuthorityError) -> Self {
        Self(error.to_string())
    }
}

impl From<identity::SubjectPrivacyError> for AdminError {
    fn from(error: identity::SubjectPrivacyError) -> Self {
        Self(error.to_string())
    }
}

impl From<ProfileHandleIndexError> for AdminError {
    fn from(error: ProfileHandleIndexError) -> Self {
        Self(error.to_string())
    }
}

impl From<profile_application::ProfileApplicationError> for AdminError {
    fn from(error: profile_application::ProfileApplicationError) -> Self {
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
    reject_unneeded_authority()?;
    server::reject_ambient_postgres_environment("fmarch-profile-index-admin", "DATABASE_URL")
        .map_err(AdminError)?;
    let database_url =
        env::var("DATABASE_URL").map_err(|_| AdminError("DATABASE_URL is required".to_string()))?;
    server::validate_database_transport(&database_url, "DATABASE_URL").map_err(AdminError)?;

    let current = require_profile_handle_index_configuration()?;
    if current.kid() != cli.expect_current_kid {
        return Err(AdminError(format!(
            "active profile handle-index KID `{}` does not match --expect-current-kid",
            current.kid()
        )));
    }
    let replacement = replacement_profile_handle_index_configuration(&cli.replacement_kid)?;
    if !current.differs_from(&replacement) {
        return Err(AdminError(
            "replacement profile handle-index key and KID must both differ from the active configuration"
                .to_string(),
        ));
    }

    let subject_authority = identity::configured_subject_key_authority().await?;
    identity::install_subject_key_store(subject_authority.key_store.clone())?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await?;
    server::ensure_schema_ready(&pool).await?;
    server::verify_database_principal(&pool, server::DatabasePrincipal::Application).await?;
    // Do not call the normal service-preparation routine here: it may bind a
    // fresh authority or reconcile erasures. This maintenance interface must
    // stay narrow, and `plan` must remain genuinely read-only. The audit and
    // reindex each open every active profile claim through the configured store
    // and therefore fail closed for the authority needed by this operation.

    match cli.command {
        Command::Plan => {
            let audit =
                profile_application::verify_profile_handle_index_consistency_with_configuration(
                    &pool, &current,
                )
                .await?;
            Ok(json!({
                "status": "planned",
                "read_only": true,
                "current_kid": current.kid(),
                "replacement_kid": replacement.kid(),
                "active_profile_count": audit.active_profile_count,
                "requires_writer_drain": true,
            }))
        }
        Command::Reindex => {
            let mut connection = PgConnection::connect(&database_url).await?;
            set_maintenance_timeouts(&mut connection, cli.drain_timeout_ms).await?;
            let report = profile_application::reindex_profile_handle_index(
                &mut connection,
                &current,
                &replacement,
            )
            .await?;
            connection.close().await?;
            Ok(json!({
                "status": "reindexed",
                "read_only": false,
                "current_kid": report.current_kid,
                "replacement_kid": report.replacement_kid,
                "active_profile_count": report.active_profile_count,
                "writers_drained": cli.writers_drained,
                "executed": cli.execute,
            }))
        }
    }
}

fn reject_unneeded_authority() -> Result<(), AdminError> {
    for name in [
        "DATABASE_MIGRATION_URL",
        "DATABASE_KEY_ADMIN_URL",
        "FMARCH_DATABASE_APPLICATION_PASSWORD",
        "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
        "FMARCH_AUTH_SOURCE_SIGNING_KEY",
        "FMARCH_EVENT_WRAP_KEY",
        "FMARCH_EVENT_WRAP_KID",
        "FMARCH_EVENT_WRAP_KEYS",
        "FMARCH_EVENT_ARCHIVE_KEY",
        "FMARCH_EVENT_ARCHIVE_KID",
        "FMARCH_EVENT_ARCHIVE_KEYS",
        "AWS_ENDPOINT_URL",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_S3_BUCKET_NAME",
    ] {
        if env::var_os(name).is_some() {
            return Err(AdminError(format!(
                "fmarch-profile-index-admin does not accept unneeded authority {name}"
            )));
        }
    }
    Ok(())
}

async fn set_maintenance_timeouts(
    connection: &mut PgConnection,
    drain_timeout_ms: u64,
) -> Result<(), AdminError> {
    for (name, value) in [
        ("lock_timeout", format!("{drain_timeout_ms}ms")),
        (
            "statement_timeout",
            format!("{DEFAULT_STATEMENT_TIMEOUT_MS}ms"),
        ),
        (
            "idle_in_transaction_session_timeout",
            format!("{DEFAULT_STATEMENT_TIMEOUT_MS}ms"),
        ),
    ] {
        sqlx::query("SELECT set_config($1, $2, false)")
            .bind(name)
            .bind(value)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Cli, Command};

    fn base(command: &str) -> Vec<&str> {
        vec![
            "profile-handle-index",
            command,
            "--expect-current-kid",
            "profile-index-v1",
            "--replacement-kid",
            "profile-index-v2",
        ]
    }

    #[test]
    fn plan_is_the_read_only_default() {
        let parsed = Cli::parse(base("plan")).unwrap();
        assert_eq!(parsed.command, Command::Plan);
        assert!(!parsed.execute);
        assert!(!parsed.writers_drained);
    }

    #[test]
    fn reindex_requires_explicit_writer_drain_and_execution_acknowledgement() {
        let error = Cli::parse(base("reindex")).unwrap_err();
        assert!(error
            .to_string()
            .contains("--writers-drained and --execute"));
        let mut args = base("reindex");
        args.extend(["--writers-drained", "--execute"]);
        let parsed = Cli::parse(args).unwrap();
        assert!(parsed.writers_drained);
        assert!(parsed.execute);
    }

    #[test]
    fn key_material_is_never_an_argument() {
        let mut args = base("plan");
        args.extend(["--replacement-key", "secret-value"]);
        let error = Cli::parse(args).unwrap_err();
        assert_eq!(error.to_string(), "unknown argument `--replacement-key`");
        assert!(!error.to_string().contains("secret-value"));
    }
}
