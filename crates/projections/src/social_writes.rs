//! Social application service for private profile-mute overlays.

use eventstore::EventInput;
use social::{self, MemberMuteCommand, MemberMuteEvent};
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::{fold_member_mute_event, member_mute_state, MemberMuteStateRow, ProjectionError};

pub async fn mute_public_profile(
    pool: &PgPool,
    principal_user_id: &str,
    target_handle: &str,
    occurred_at: i64,
) -> Result<MemberMuteStateRow, ProjectionError> {
    change_public_profile_mute(pool, principal_user_id, target_handle, true, occurred_at).await
}

pub async fn unmute_public_profile(
    pool: &PgPool,
    principal_user_id: &str,
    target_handle: &str,
    occurred_at: i64,
) -> Result<MemberMuteStateRow, ProjectionError> {
    change_public_profile_mute(pool, principal_user_id, target_handle, false, occurred_at).await
}

async fn change_public_profile_mute(
    pool: &PgPool,
    principal_user_id: &str,
    target_handle: &str,
    mute: bool,
    occurred_at: i64,
) -> Result<MemberMuteStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    let target = sqlx::query(
        r#"
        SELECT profile.profile_id, owner.active_principal_id AS owner_principal_id
        FROM public_profile AS profile
        JOIN member_profile AS owner ON owner.profile_id = profile.profile_id
        WHERE profile.handle = $1
          AND owner.lifecycle = 'active'
        "#,
    )
    .bind(target_handle)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ProjectionError::MuteTargetNotPublic)?;
    let target_profile_id: Uuid = target.get("profile_id");
    if target.get::<String, _>("owner_principal_id") == principal_user_id {
        return Err(ProjectionError::CannotMuteSelf);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "profile-mute:{principal_user_id}:{target_profile_id}"
        ))
        .execute(&mut *tx)
        .await?;
    let existing = member_mute_domain_state(&mut tx, principal_user_id, target_profile_id).await?;
    let relationship_id = existing
        .as_ref()
        .map_or_else(Uuid::new_v4, |state| state.relationship_id);
    let command = if mute {
        MemberMuteCommand::Mute { target_profile_id }
    } else {
        MemberMuteCommand::Unmute
    };
    let events =
        social::decide_member_mute(existing.as_ref(), command).map_err(member_mute_domain_error)?;
    append_member_mute_events(
        &mut tx,
        relationship_id,
        existing.as_ref().map_or(0, |state| state.version),
        events,
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    member_mute_state(pool, principal_user_id, target_handle).await
}

async fn member_mute_domain_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_user_id: &str,
    target_profile_id: Uuid,
) -> Result<Option<social::MemberMuteState>, ProjectionError> {
    let row = sqlx::query(
        "SELECT relationship_id, active, version FROM profile_mute WHERE principal_user_id = $1 AND target_profile_id = $2",
    )
    .bind(principal_user_id)
    .bind(target_profile_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.map(|row| social::MemberMuteState {
        relationship_id: row.get("relationship_id"),
        principal_user_id: principal_user_id.to_string(),
        target_profile_id,
        active: row.get("active"),
        version: row.get("version"),
    }))
}

fn member_mute_domain_error(reject: social::SocialReject) -> ProjectionError {
    match reject {
        social::SocialReject::AlreadyMuted => ProjectionError::AlreadyMuted,
        social::SocialReject::NotMuted | social::SocialReject::MuteNotFound => {
            ProjectionError::NotMuted
        }
    }
}

async fn append_member_mute_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    relationship_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<MemberMuteEvent>,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::Principal(principal_user_id.to_string()),
                occurred_at,
            )
        })
        .collect();
    let stored =
        eventstore::append_expected_in_tx(tx, relationship_id, expected_stream_seq, &inputs)
            .await?;
    for event in &stored {
        fold_member_mute_event(tx, relationship_id, event).await?;
    }
    Ok(())
}
