//! Identity resolution only for an authorized game's setup host.
use crate::ProjectionError;
use principal::PrincipalId;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Debug, serde::Serialize)]
pub struct SetupCandidate {
    pub principal_id: PrincipalId,
    pub handle: String,
    pub display_name: String,
    pub already_seated: bool,
}

/// With a handle, resolve exactly one public profile. Otherwise return the
/// visible origin topic's distinct authors. The HTTP boundary requires HostOf.
pub async fn setup_candidates(
    pool: &PgPool,
    game: Uuid,
    host: PrincipalId,
    handle: Option<&str>,
) -> Result<Vec<SetupCandidate>, ProjectionError> {
    let rows = sqlx::query(r#"
        SELECT owner.active_principal_id AS principal_id, profile.handle, profile.display_name,
          EXISTS(SELECT 1 FROM slot_occupancy_epoch AS occupied
            JOIN game_persona_subject_binding AS binding ON binding.game_id = occupied.game_id
              AND binding.persona_id = occupied.persona_id AND binding.lifecycle = 'active'
            JOIN privacy_subject AS occupant ON occupant.subject_id = binding.subject_id
            WHERE occupied.game_id = $1 AND occupied.ended_seq IS NULL
              AND occupant.principal_id = owner.active_principal_id) AS already_seated
        FROM public_profile AS profile
        JOIN member_profile AS owner ON owner.profile_id = profile.profile_id AND owner.lifecycle = 'active'
        JOIN platform_principal AS principal ON principal.principal_id = owner.active_principal_id
          AND principal.status = 'active' AND principal.disabled_at IS NULL
        JOIN privacy_subject AS subject ON subject.subject_id = owner.subject_id
          AND subject.principal_id = principal.principal_id AND subject.lifecycle_state = 'active'
        WHERE owner.active_principal_id <> $2
          AND NOT EXISTS(SELECT 1 FROM member_lifecycle_projection AS lifecycle
            WHERE lifecycle.principal_id = principal.principal_id AND lifecycle.status <> 'active')
          AND (($3::text IS NOT NULL AND profile.handle = $3) OR ($3 IS NULL AND EXISTS(
            SELECT 1 FROM game_index AS game
            JOIN discussion_topic AS topic ON topic.topic_id = game.origin_topic_id
            JOIN publication_surface AS surface ON surface.surface_id = topic.topic_id
            WHERE game.game_id = $1 AND topic.visibility = 'visible' AND surface.visible
              AND (topic.author_profile_id = profile.profile_id OR EXISTS(
                SELECT 1 FROM discussion_post AS post WHERE post.topic_id = topic.topic_id
                  AND post.author_profile_id = profile.profile_id AND post.retracted_at IS NULL)))))
        ORDER BY profile.handle
    "#).bind(game).bind(host.as_uuid()).bind(handle).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| SetupCandidate {
            principal_id: PrincipalId::from_uuid(row.get("principal_id")),
            handle: row.get("handle"),
            display_name: row.get("display_name"),
            already_seated: row.get("already_seated"),
        })
        .collect())
}
