//! Operational DayEvent scheduler.
//!
//! The event stream lock and idempotent schedule evidence are the correctness
//! boundary. Database leases only bound duplicate work across server replicas;
//! an expired lease may cause a harmless second observation.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sqlx::{postgres::PgPool, Row};
use uuid::Uuid;

use crate::{advance_day_event_automation_as_scheduler, Reject};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayEventSchedulerConfig {
    pub poll_interval: Duration,
    pub batch_size: i64,
    pub lease_seconds: i64,
    pub retry_base_seconds: i64,
    pub retry_max_seconds: i64,
}

impl Default for DayEventSchedulerConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(1),
            batch_size: 16,
            lease_seconds: 30,
            retry_base_seconds: 1,
            retry_max_seconds: 60,
        }
    }
}

impl DayEventSchedulerConfig {
    pub fn validate(&self) -> Result<(), SchedulerError> {
        if self.poll_interval.is_zero() {
            return Err(SchedulerError::InvalidConfig(
                "poll interval must be positive".to_string(),
            ));
        }
        if !(1..=128).contains(&self.batch_size) {
            return Err(SchedulerError::InvalidConfig(
                "batch size must be between 1 and 128".to_string(),
            ));
        }
        if self.lease_seconds <= 0 {
            return Err(SchedulerError::InvalidConfig(
                "lease duration must be positive".to_string(),
            ));
        }
        if self.retry_base_seconds <= 0 || self.retry_max_seconds < self.retry_base_seconds {
            return Err(SchedulerError::InvalidConfig(
                "retry bounds must be positive and ordered".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SchedulerError {
    #[error("invalid DayEvent scheduler configuration: {0}")]
    InvalidConfig(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("system clock is before the Unix epoch")]
    InvalidClock,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ClaimedGame {
    game_id: Uuid,
    wake_seq: i64,
    next_due_at: Option<i64>,
    consecutive_failures: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayEventSchedulerTickReport {
    pub worker_id: Uuid,
    pub observed_at: i64,
    pub claimed_games: usize,
    pub succeeded_games: usize,
    pub failed_games: usize,
    pub appended_events: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayEventSchedulerStatus {
    pub game_id: Uuid,
    pub next_due_at: Option<i64>,
    pub auto_resolve_pending: bool,
    pub wake_seq: i64,
    pub updated_seq: i64,
    pub last_observed_wake_seq: i64,
    pub lease_owner: Option<Uuid>,
    pub lease_until: Option<i64>,
    pub retry_not_before: Option<i64>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_failure_at: Option<i64>,
    pub consecutive_failures: i32,
    pub total_attempts: i64,
    pub total_successes: i64,
    pub last_error: Option<String>,
    pub pending: bool,
}

pub fn spawn_day_event_scheduler(
    pool: PgPool,
    config: DayEventSchedulerConfig,
) -> Result<tokio::task::JoinHandle<()>, SchedulerError> {
    config.validate()?;
    Ok(tokio::spawn(async move {
        let worker_id = Uuid::new_v4();
        let mut interval = tokio::time::interval(config.poll_interval);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let observed_at = match unix_seconds_now() {
                Ok(observed_at) => observed_at,
                Err(error) => {
                    tracing::error!(worker_id = %worker_id, error = %error, "DayEvent scheduler clock failed");
                    continue;
                }
            };
            match run_day_event_scheduler_once(&pool, &config, worker_id, observed_at).await {
                Ok(report) if report.claimed_games > 0 => {
                    tracing::info!(
                        worker_id = %worker_id,
                        observed_at,
                        claimed_games = report.claimed_games,
                        succeeded_games = report.succeeded_games,
                        failed_games = report.failed_games,
                        appended_events = report.appended_events,
                        "DayEvent scheduler tick completed"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(worker_id = %worker_id, observed_at, error = %error, "DayEvent scheduler tick failed");
                }
            }
        }
    }))
}

pub async fn run_day_event_scheduler_once(
    pool: &PgPool,
    config: &DayEventSchedulerConfig,
    worker_id: Uuid,
    observed_at: i64,
) -> Result<DayEventSchedulerTickReport, SchedulerError> {
    config.validate()?;
    let claims = claim_due_games(pool, config, worker_id, observed_at).await?;
    let mut report = DayEventSchedulerTickReport {
        worker_id,
        observed_at,
        claimed_games: claims.len(),
        succeeded_games: 0,
        failed_games: 0,
        appended_events: 0,
    };
    for claim in claims {
        match advance_day_event_automation_as_scheduler(
            pool,
            claim.game_id,
            observed_at,
            fresh_seed_root(),
        )
        .await
        {
            Ok(ack) => {
                finish_success(pool, worker_id, &claim, observed_at).await?;
                report.succeeded_games += 1;
                report.appended_events += ack.stream_seqs.len();
            }
            Err(Reject::GameAlreadyCompleted) => {
                finish_success(pool, worker_id, &claim, observed_at).await?;
                report.succeeded_games += 1;
            }
            Err(error) => {
                finish_failure(
                    pool,
                    config,
                    worker_id,
                    &claim,
                    observed_at,
                    &error.to_string(),
                )
                .await?;
                report.failed_games += 1;
            }
        }
    }
    Ok(report)
}

pub async fn day_event_scheduler_status(
    pool: &PgPool,
    game_id: Uuid,
    observed_at: i64,
) -> Result<Option<DayEventSchedulerStatus>, SchedulerError> {
    let row = sqlx::query(
        "SELECT w.game_id, w.next_due_at, w.auto_resolve_pending, w.wake_seq, w.updated_seq, \
                s.last_observed_wake_seq, s.lease_owner, s.lease_until, \
                s.retry_not_before, s.last_attempt_at, s.last_success_at, \
                s.last_failure_at, s.consecutive_failures, s.total_attempts, \
                s.total_successes, s.last_error \
         FROM day_event_schedule_work w \
         JOIN day_event_scheduler_state s ON s.game_id = w.game_id \
         WHERE w.game_id = $1",
    )
    .bind(game_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| {
        let next_due_at: Option<i64> = row.get("next_due_at");
        let wake_seq: i64 = row.get("wake_seq");
        let last_observed_wake_seq: i64 = row.get("last_observed_wake_seq");
        DayEventSchedulerStatus {
            game_id: row.get("game_id"),
            next_due_at,
            auto_resolve_pending: row.get("auto_resolve_pending"),
            wake_seq,
            updated_seq: row.get("updated_seq"),
            last_observed_wake_seq,
            lease_owner: row.get("lease_owner"),
            lease_until: row.get("lease_until"),
            retry_not_before: row.get("retry_not_before"),
            last_attempt_at: row.get("last_attempt_at"),
            last_success_at: row.get("last_success_at"),
            last_failure_at: row.get("last_failure_at"),
            consecutive_failures: row.get("consecutive_failures"),
            total_attempts: row.get("total_attempts"),
            total_successes: row.get("total_successes"),
            last_error: row.get("last_error"),
            pending: next_due_at.is_some_and(|due_at| due_at <= observed_at)
                || wake_seq > last_observed_wake_seq
                || row.get("auto_resolve_pending"),
        }
    }))
}

async fn claim_due_games(
    pool: &PgPool,
    config: &DayEventSchedulerConfig,
    worker_id: Uuid,
    observed_at: i64,
) -> Result<Vec<ClaimedGame>, SchedulerError> {
    let lease_until = observed_at
        .checked_add(config.lease_seconds)
        .ok_or_else(|| SchedulerError::InvalidConfig("lease timestamp overflow".to_string()))?;
    let rows = sqlx::query(
        "WITH candidates AS ( \
           SELECT s.game_id, w.wake_seq, w.next_due_at, s.consecutive_failures \
           FROM day_event_scheduler_state s \
           JOIN day_event_schedule_work w ON w.game_id = s.game_id \
           JOIN game_index g ON g.game_id = s.game_id AND g.status = 'active' \
           WHERE (w.next_due_at <= $1 OR w.wake_seq > s.last_observed_wake_seq \
                  OR w.auto_resolve_pending) \
             AND (s.lease_until IS NULL OR s.lease_until <= $1) \
             AND (s.retry_not_before IS NULL OR s.retry_not_before <= $1) \
           ORDER BY w.next_due_at ASC NULLS LAST, w.wake_seq ASC, s.game_id ASC \
           FOR UPDATE OF s SKIP LOCKED \
           LIMIT $2 \
         ), claimed AS ( \
           UPDATE day_event_scheduler_state s SET \
             lease_owner = $3, lease_until = $4, last_attempt_at = $1, \
             total_attempts = total_attempts + 1 \
           FROM candidates c WHERE s.game_id = c.game_id \
           RETURNING s.game_id, c.wake_seq, c.next_due_at, c.consecutive_failures \
         ) \
         SELECT game_id, wake_seq, next_due_at, consecutive_failures FROM claimed \
         ORDER BY next_due_at ASC NULLS LAST, wake_seq ASC, game_id ASC",
    )
    .bind(observed_at)
    .bind(config.batch_size)
    .bind(worker_id)
    .bind(lease_until)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| ClaimedGame {
            game_id: row.get("game_id"),
            wake_seq: row.get("wake_seq"),
            next_due_at: row.get("next_due_at"),
            consecutive_failures: row.get("consecutive_failures"),
        })
        .collect())
}

async fn finish_success(
    pool: &PgPool,
    worker_id: Uuid,
    claim: &ClaimedGame,
    observed_at: i64,
) -> Result<(), SchedulerError> {
    sqlx::query(
        "UPDATE day_event_scheduler_state SET \
           last_observed_wake_seq = GREATEST(last_observed_wake_seq, $3), \
           lease_owner = NULL, lease_until = NULL, retry_not_before = NULL, \
           last_success_at = $4, consecutive_failures = 0, \
           total_successes = total_successes + 1, last_error = NULL \
         WHERE game_id = $1 AND lease_owner = $2",
    )
    .bind(claim.game_id)
    .bind(worker_id)
    .bind(claim.wake_seq)
    .bind(observed_at)
    .execute(pool)
    .await?;
    Ok(())
}

async fn finish_failure(
    pool: &PgPool,
    config: &DayEventSchedulerConfig,
    worker_id: Uuid,
    claim: &ClaimedGame,
    observed_at: i64,
    error: &str,
) -> Result<(), SchedulerError> {
    let failures = claim.consecutive_failures.saturating_add(1);
    let retry_not_before = observed_at
        .checked_add(retry_delay_seconds(config, failures))
        .ok_or_else(|| SchedulerError::InvalidConfig("retry timestamp overflow".to_string()))?;
    let bounded_error: String = error.chars().take(1_000).collect();
    sqlx::query(
        "UPDATE day_event_scheduler_state SET \
           lease_owner = NULL, lease_until = NULL, retry_not_before = $3, \
           last_failure_at = $4, consecutive_failures = $5, last_error = $6 \
         WHERE game_id = $1 AND lease_owner = $2",
    )
    .bind(claim.game_id)
    .bind(worker_id)
    .bind(retry_not_before)
    .bind(observed_at)
    .bind(failures)
    .bind(bounded_error)
    .execute(pool)
    .await?;
    Ok(())
}

fn retry_delay_seconds(config: &DayEventSchedulerConfig, failures: i32) -> i64 {
    let exponent = failures.saturating_sub(1).min(30) as u32;
    config
        .retry_base_seconds
        .saturating_mul(1_i64.checked_shl(exponent).unwrap_or(i64::MAX))
        .min(config.retry_max_seconds)
}

fn unix_seconds_now() -> Result<i64, SchedulerError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SchedulerError::InvalidClock)?
        .as_secs();
    i64::try_from(seconds).map_err(|_| SchedulerError::InvalidClock)
}

fn fresh_seed_root() -> u64 {
    let bytes = Uuid::new_v4().into_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("UUID prefix is eight bytes")) & i64::MAX as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_is_bounded_and_configuration_is_fail_closed() {
        let config = DayEventSchedulerConfig {
            retry_base_seconds: 2,
            retry_max_seconds: 10,
            ..DayEventSchedulerConfig::default()
        };
        assert_eq!(retry_delay_seconds(&config, 1), 2);
        assert_eq!(retry_delay_seconds(&config, 2), 4);
        assert_eq!(retry_delay_seconds(&config, 3), 8);
        assert_eq!(retry_delay_seconds(&config, 4), 10);

        let invalid = DayEventSchedulerConfig {
            batch_size: 0,
            ..DayEventSchedulerConfig::default()
        };
        assert!(invalid.validate().is_err());
    }
}
