//! Per-principal posting budgets.
//!
//! A write that publishes member content is admitted only while its author has
//! budget left on every window the surface draws from. The charge runs inside
//! the caller's write transaction, so a rejected or rolled-back write never
//! consumes budget and concurrent writers serialize on the budget row. An
//! over-budget write is a retryable rejection, not a moderation sanction: it
//! records no event and leaves no durable trace beyond the window counter.

use principal::PrincipalId;
use sqlx::{Postgres, Transaction};

use crate::ProjectionError;

/// Rows idle longer than the widest window are garbage; cleanup is
/// opportunistic and bounded per charge.
const RETENTION_SECONDS: i64 = 60 * 60;
const CLEANUP_BATCH: i64 = 256;

/// Configured maximum count per budget window. Windows are fixed by the
/// budget's identity; only the counts are runtime configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PostingBudgetPolicy {
    pub posts_per_minute: u32,
    pub posts_per_hour: u32,
    pub topics_per_hour: u32,
    pub edits_per_ten_minutes: u32,
    pub reports_per_hour: u32,
    pub mention_targets_per_ten_minutes: u32,
}

impl Default for PostingBudgetPolicy {
    fn default() -> Self {
        Self {
            posts_per_minute: 10,
            posts_per_hour: 120,
            topics_per_hour: 5,
            edits_per_ten_minutes: 20,
            reports_per_hour: 10,
            mention_targets_per_ten_minutes: 20,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid posting budget: {0}")]
pub struct PostingBudgetPolicyError(pub String);

impl PostingBudgetPolicy {
    pub fn validate(&self) -> Result<(), PostingBudgetPolicyError> {
        for budget in PostingBudget::ALL {
            if self.max(budget) == 0 {
                return Err(PostingBudgetPolicyError(format!(
                    "{} must be positive",
                    budget.as_str()
                )));
            }
        }
        if self.posts_per_hour < self.posts_per_minute {
            return Err(PostingBudgetPolicyError(
                "hourly post budget must not be below the per-minute budget".to_string(),
            ));
        }
        // A single post may carry this many mentions; a smaller window budget
        // would reject a legal post forever instead of asking it to wait.
        if (self.mention_targets_per_ten_minutes as usize) < content_reference::MAX_MENTIONS_PER_POST
        {
            return Err(PostingBudgetPolicyError(format!(
                "mention budget must admit one full post ({} mentions)",
                content_reference::MAX_MENTIONS_PER_POST
            )));
        }
        Ok(())
    }

    fn max(&self, budget: PostingBudget) -> u32 {
        match budget {
            PostingBudget::PostMinute => self.posts_per_minute,
            PostingBudget::PostHour => self.posts_per_hour,
            PostingBudget::TopicHour => self.topics_per_hour,
            PostingBudget::EditTenMinutes => self.edits_per_ten_minutes,
            PostingBudget::ReportHour => self.reports_per_hour,
            PostingBudget::MentionTenMinutes => self.mention_targets_per_ten_minutes,
        }
    }
}

/// One fixed window. The discriminant order is the row-lock order, so two
/// charges touching overlapping budgets cannot deadlock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PostingBudget {
    MentionTenMinutes,
    PostHour,
    PostMinute,
    ReportHour,
    EditTenMinutes,
    TopicHour,
}

impl PostingBudget {
    const ALL: [PostingBudget; 6] = [
        PostingBudget::MentionTenMinutes,
        PostingBudget::PostHour,
        PostingBudget::PostMinute,
        PostingBudget::ReportHour,
        PostingBudget::EditTenMinutes,
        PostingBudget::TopicHour,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            PostingBudget::PostMinute => "post_minute",
            PostingBudget::PostHour => "post_hour",
            PostingBudget::TopicHour => "topic_hour",
            PostingBudget::EditTenMinutes => "edit_ten_minutes",
            PostingBudget::ReportHour => "report_hour",
            PostingBudget::MentionTenMinutes => "mention_ten_minutes",
        }
    }

    pub fn window_seconds(self) -> i64 {
        match self {
            PostingBudget::PostMinute => 60,
            PostingBudget::EditTenMinutes | PostingBudget::MentionTenMinutes => 600,
            PostingBudget::PostHour | PostingBudget::TopicHour | PostingBudget::ReportHour => {
                3_600
            }
        }
    }
}

/// The member-content write being admitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostingSurface {
    /// A new discussion topic, which also carries its opening post.
    DiscussionTopic,
    DiscussionPost,
    DiscussionEdit,
    GameThreadPost,
    ModerationReport,
}

/// Facts about the author that the exemption policy reads. Callers establish
/// them from their own authority checks; the policy lives here, once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PostingStanding {
    /// Host or cohost of the game whose thread is being written.
    pub hosts_this_game: bool,
    pub global_moderator: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PostingCharge {
    pub principal_id: PrincipalId,
    pub surface: PostingSurface,
    /// Distinct profiles or slots this write newly notifies. An edit counts
    /// only targets its previous revision did not already mention.
    pub new_mention_targets: u32,
    pub standing: PostingStanding,
}

/// Whether a write is budgeted, and against what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostingAdmission {
    /// Production: every surface draws from the configured budget.
    Enforced(PostingBudgetPolicy),
    /// In-process fixtures and seeders that are not member traffic.
    Unenforced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("posting budget {} is exhausted; retry in {retry_after_seconds}s", .budget.as_str())]
pub struct PostingBudgetExceeded {
    pub budget: PostingBudget,
    pub retry_after_seconds: i64,
}

/// The budget draws of one charge after the exemption policy, as
/// `(budget, units)`, in row-lock order.
///
/// Hosts and cohosts write their own game's thread without limit. Global
/// moderators are exempt from the edit and report budgets they use for
/// moderation work, but not from posting or mention budgets.
pub fn posting_draws(charge: &PostingCharge) -> Vec<(PostingBudget, u32)> {
    let standing = charge.standing;
    let mut draws: Vec<(PostingBudget, u32)> = match charge.surface {
        PostingSurface::GameThreadPost if standing.hosts_this_game => return Vec::new(),
        PostingSurface::DiscussionTopic => vec![
            (PostingBudget::TopicHour, 1),
            (PostingBudget::PostMinute, 1),
            (PostingBudget::PostHour, 1),
        ],
        PostingSurface::DiscussionPost | PostingSurface::GameThreadPost => {
            vec![(PostingBudget::PostMinute, 1), (PostingBudget::PostHour, 1)]
        }
        PostingSurface::DiscussionEdit if standing.global_moderator => Vec::new(),
        PostingSurface::DiscussionEdit => vec![(PostingBudget::EditTenMinutes, 1)],
        PostingSurface::ModerationReport if standing.global_moderator => return Vec::new(),
        PostingSurface::ModerationReport => return vec![(PostingBudget::ReportHour, 1)],
    };
    if charge.new_mention_targets > 0 {
        draws.push((PostingBudget::MentionTenMinutes, charge.new_mention_targets));
    }
    draws.sort_by_key(|(budget, _)| *budget);
    draws
}

/// Charge one write against its budgets inside the caller's transaction.
///
/// Every draw is applied before the verdict, and the caller must roll back on
/// `Err`: that undoes the partial charge and keeps the check and the increment
/// one atomic decision under the budget row locks.
pub async fn charge_posting_budget_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    admission: &PostingAdmission,
    charge: &PostingCharge,
    now: i64,
) -> Result<(), ProjectionError> {
    let PostingAdmission::Enforced(policy) = admission else {
        return Ok(());
    };
    let draws = posting_draws(charge);
    if draws.is_empty() {
        return Ok(());
    }
    let mut exceeded: Option<PostingBudgetExceeded> = None;
    for (budget, units) in draws {
        let (window_started_at, used) = sqlx::query_as::<_, (i64, i32)>(
            r#"
            INSERT INTO posting_budget_window (
                principal_id, budget, window_started_at, used, updated_at
            )
            VALUES ($1, $2, $3, $4, $3)
            ON CONFLICT (principal_id, budget) DO UPDATE
            SET window_started_at = CASE
                    WHEN posting_budget_window.window_started_at + $5 <= $3 THEN $3
                    ELSE posting_budget_window.window_started_at
                END,
                used = CASE
                    WHEN posting_budget_window.window_started_at + $5 <= $3 THEN $4
                    ELSE posting_budget_window.used + $4
                END,
                updated_at = GREATEST(posting_budget_window.updated_at, $3)
            RETURNING window_started_at, used
            "#,
        )
        .bind(charge.principal_id.as_uuid())
        .bind(budget.as_str())
        .bind(now)
        .bind(units as i32)
        .bind(budget.window_seconds())
        .fetch_one(&mut **tx)
        .await?;
        if used as i64 > policy.max(budget) as i64 {
            let retry_after_seconds =
                (window_started_at + budget.window_seconds() - now).max(1);
            if exceeded.is_none_or(|current| retry_after_seconds > current.retry_after_seconds) {
                exceeded = Some(PostingBudgetExceeded {
                    budget,
                    retry_after_seconds,
                });
            }
        }
    }
    if let Some(exceeded) = exceeded {
        return Err(ProjectionError::PostingBudgetExceeded(exceeded));
    }
    // Other principals' idle rows only; this charge's rows are fresh.
    sqlx::query(
        r#"
        WITH stale AS (
            SELECT principal_id, budget
            FROM posting_budget_window
            WHERE updated_at < $1
            ORDER BY updated_at
            FOR UPDATE SKIP LOCKED
            LIMIT $2
        )
        DELETE FROM posting_budget_window AS row
        USING stale
        WHERE row.principal_id = stale.principal_id AND row.budget = stale.budget
        "#,
    )
    .bind(now - RETENTION_SECONDS)
    .bind(CLEANUP_BATCH)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn charge(surface: PostingSurface, mentions: u32, standing: PostingStanding) -> PostingCharge {
        PostingCharge {
            principal_id: PrincipalId::from_uuid(uuid::Uuid::nil()),
            surface,
            new_mention_targets: mentions,
            standing,
        }
    }

    #[test]
    fn default_policy_is_the_owner_ratified_moderate_budget() {
        let policy = PostingBudgetPolicy::default();
        policy.validate().unwrap();
        assert_eq!(
            policy,
            PostingBudgetPolicy {
                posts_per_minute: 10,
                posts_per_hour: 120,
                topics_per_hour: 5,
                edits_per_ten_minutes: 20,
                reports_per_hour: 10,
                mention_targets_per_ten_minutes: 20,
            }
        );
    }

    #[test]
    fn validation_rejects_zero_inverted_and_unsatisfiable_budgets() {
        for mutate in [
            |p: &mut PostingBudgetPolicy| p.reports_per_hour = 0,
            |p: &mut PostingBudgetPolicy| p.posts_per_hour = p.posts_per_minute - 1,
            |p: &mut PostingBudgetPolicy| {
                p.mention_targets_per_ten_minutes =
                    content_reference::MAX_MENTIONS_PER_POST as u32 - 1
            },
        ] {
            let mut policy = PostingBudgetPolicy::default();
            mutate(&mut policy);
            assert!(policy.validate().is_err(), "{policy:?}");
        }
    }

    #[test]
    fn each_surface_draws_its_declared_budgets_in_lock_order() {
        let member = PostingStanding::default();
        assert_eq!(
            posting_draws(&charge(PostingSurface::DiscussionTopic, 2, member)),
            vec![
                (PostingBudget::MentionTenMinutes, 2),
                (PostingBudget::PostHour, 1),
                (PostingBudget::PostMinute, 1),
                (PostingBudget::TopicHour, 1),
            ]
        );
        for surface in [PostingSurface::DiscussionPost, PostingSurface::GameThreadPost] {
            assert_eq!(
                posting_draws(&charge(surface, 0, member)),
                vec![(PostingBudget::PostHour, 1), (PostingBudget::PostMinute, 1)]
            );
        }
        assert_eq!(
            posting_draws(&charge(PostingSurface::DiscussionEdit, 1, member)),
            vec![
                (PostingBudget::MentionTenMinutes, 1),
                (PostingBudget::EditTenMinutes, 1),
            ]
        );
        assert_eq!(
            posting_draws(&charge(PostingSurface::ModerationReport, 3, member)),
            vec![(PostingBudget::ReportHour, 1)]
        );
    }

    #[test]
    fn hosts_are_exempt_only_in_their_own_game_thread() {
        let host = PostingStanding {
            hosts_this_game: true,
            global_moderator: false,
        };
        assert!(posting_draws(&charge(PostingSurface::GameThreadPost, 4, host)).is_empty());
        // Host standing is game-scoped; it grants nothing on discussion surfaces.
        assert_eq!(
            posting_draws(&charge(PostingSurface::DiscussionPost, 0, host)).len(),
            2
        );
    }

    #[test]
    fn global_moderators_are_exempt_from_edit_and_report_budgets_only() {
        let moderator = PostingStanding {
            hosts_this_game: false,
            global_moderator: true,
        };
        assert!(posting_draws(&charge(PostingSurface::ModerationReport, 0, moderator)).is_empty());
        assert_eq!(
            posting_draws(&charge(PostingSurface::DiscussionEdit, 2, moderator)),
            vec![(PostingBudget::MentionTenMinutes, 2)]
        );
        assert_eq!(
            posting_draws(&charge(PostingSurface::GameThreadPost, 0, moderator)).len(),
            2
        );
    }
}
