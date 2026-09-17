//! Private, host-authorized replacement selection. This is an exact public
//! handle lookup, not a directory or a reservation of future command authority.

use crate::ProjectionError;
use principal::PrincipalId;
use social::ProfileHandle;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostReplacementCandidateRow {
    pub slot_id: String,
    pub outgoing_persona_id: Uuid,
    pub principal_id: PrincipalId,
    pub handle: String,
    pub display_name: String,
}

/// Replacement admission uses the same owner/subject activity as identity
/// authority and also excludes a member's explicit deactivation. A missing
/// member lifecycle projection is the initial Active state.
pub async fn replacement_principal_is_active<'e, E>(
    executor: E,
    principal_id: PrincipalId,
) -> Result<bool, ProjectionError>
where
    E: sqlx::PgExecutor<'e>,
{
    Ok(sqlx::query_scalar(
        r#"
        SELECT EXISTS (
          SELECT 1 FROM platform_principal AS principal
          JOIN privacy_subject AS subject ON subject.principal_id = principal.principal_id
            AND subject.lifecycle_state = 'active'
          WHERE principal.principal_id = $1 AND principal.status = 'active'
            AND principal.disabled_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM member_lifecycle_projection AS lifecycle
              WHERE lifecycle.principal_id = principal.principal_id AND lifecycle.status <> 'active'
            )
        )
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_one(executor)
    .await?)
}

/// Callers must authorize Replacement permission before this lookup. One
/// statement binds the public candidate and the selected seat's current persona
/// to the same snapshot. ProcessReplacement rechecks identity and occupancy
/// under its command locks; this read grants no authority to commit later.
pub async fn host_replacement_candidate(
    pool: &PgPool,
    game: Uuid,
    slot_id: &str,
    handle: &ProfileHandle,
) -> Result<Option<HostReplacementCandidateRow>, ProjectionError> {
    let row = sqlx::query(
        r#"
        SELECT outgoing.slot_id, outgoing.persona_id AS outgoing_persona_id,
               owner.active_principal_id AS principal_id, profile.handle, profile.display_name
        FROM slot_occupancy_epoch AS outgoing
        JOIN public_profile AS profile ON profile.handle = $3
        JOIN member_profile AS owner ON owner.profile_id = profile.profile_id
          AND owner.lifecycle = 'active'
        JOIN platform_principal AS principal ON principal.principal_id = owner.active_principal_id
          AND principal.status = 'active' AND principal.disabled_at IS NULL
        JOIN privacy_subject AS subject ON subject.subject_id = owner.subject_id
          AND subject.principal_id = principal.principal_id AND subject.lifecycle_state = 'active'
        WHERE outgoing.game_id = $1 AND outgoing.slot_id = $2 AND outgoing.ended_seq IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM member_lifecycle_projection AS lifecycle
            WHERE lifecycle.principal_id = principal.principal_id AND lifecycle.status <> 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM slot_occupancy_epoch AS occupied
            JOIN game_persona_subject_binding AS binding
              ON binding.game_id = occupied.game_id AND binding.persona_id = occupied.persona_id
              AND binding.lifecycle = 'active'
            JOIN privacy_subject AS occupant ON occupant.subject_id = binding.subject_id
            WHERE occupied.game_id = $1 AND occupied.ended_seq IS NULL
              AND occupant.principal_id = principal.principal_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM spectator_membership AS spectator
            WHERE spectator.game_id = $1 AND spectator.principal_id = principal.principal_id
          )
        "#,
    )
    .bind(game)
    .bind(slot_id)
    .bind(handle.as_str())
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| HostReplacementCandidateRow {
        slot_id: row.get("slot_id"),
        outgoing_persona_id: row.get("outgoing_persona_id"),
        principal_id: PrincipalId::from_uuid(row.get("principal_id")),
        handle: row.get("handle"),
        display_name: row.get("display_name"),
    }))
}
