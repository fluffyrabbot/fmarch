//! Game-persona command application boundary.
//!
//! This crate is the only place a credential principal is turned into a
//! game-persona subject binding. It seals presentation before producing a
//! canonical event, so projections only ever fold UUID subject and claim
//! references. A persona's public name and a principal identifier must never
//! appear in the durable game event payload.

use eventstore::{ActorId, EventInput};
use game_platform::{GamePersonaId, PrincipalId};
use identity::{
    ensure_active_subject, insert_subject_claim, ClaimId, PrivateClaimError, SubjectId,
};
use sqlx::Row;
use uuid::Uuid;

pub use game_platform::GamePersonaPresentation;

/// The sealed-claim discriminator for a current game-persona presentation.
pub const GAME_PERSONA_PRESENTATION_CLAIM_KIND: &str = "game_persona_presentation";

/// Errors from preparing canonical game-persona events.
#[derive(Debug, thiserror::Error)]
pub enum GamePersonaApplicationError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    PrivateClaim(#[from] PrivateClaimError),
    #[error("game persona is already registered")]
    PersonaAlreadyRegistered,
    #[error("this privacy subject already has a game persona")]
    SubjectAlreadyBound,
    #[error("game persona was not found")]
    PersonaNotFound,
    #[error("game persona is not active")]
    PersonaUnavailable,
    #[error("game persona binding is invalid: {0}")]
    InvalidBinding(String),
}

/// Seal an initial presentation and prepare the canonical registration event.
///
/// `principal_id` is authority input at this boundary only. It is resolved to
/// a live privacy subject before the event is formed; the canonical event has
/// exactly `persona_id`, `subject_id`, and `claim_id` in its payload. The
/// caller deliberately supplies the event actor so host/cohost audit history
/// remains intact instead of being replaced by the target persona's subject.
pub async fn register(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    persona_id: GamePersonaId,
    principal_id: &PrincipalId,
    presentation: GamePersonaPresentation,
    actor: ActorId,
    occurred_at: i64,
) -> Result<EventInput, GamePersonaApplicationError> {
    if load_persona_binding_for_update(tx, game_id, persona_id)
        .await?
        .is_some()
    {
        return Err(GamePersonaApplicationError::PersonaAlreadyRegistered);
    }

    // Persona lock first, then the subject lock inside `ensure_active_subject`.
    // Rename follows that same order, so a duplicate registration cannot
    // deadlock an in-flight rename of the same persona.
    let subject_id = ensure_active_subject(tx, principal_id.as_str(), occurred_at).await?;
    if load_subject_binding_for_update(tx, game_id, subject_id)
        .await?
        .is_some()
    {
        return Err(GamePersonaApplicationError::SubjectAlreadyBound);
    }

    let claim_id = issue_presentation_claim(
        tx,
        game_id,
        persona_id,
        subject_id,
        occurred_at,
        &presentation,
    )
    .await?;
    Ok(canonical_persona_event(
        "GamePersonaRegistered",
        persona_id,
        subject_id,
        claim_id,
        actor,
        occurred_at,
    ))
}

/// Seal a replacement presentation and prepare the canonical rename event.
///
/// The existing binding is locked and remains the source of ownership. A
/// rename cannot take a principal input, which prevents a presentation update
/// from quietly changing game-persona authority.
pub async fn rename(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    persona_id: GamePersonaId,
    presentation: GamePersonaPresentation,
    actor: ActorId,
    occurred_at: i64,
) -> Result<EventInput, GamePersonaApplicationError> {
    let binding = load_persona_binding_for_update(tx, game_id, persona_id)
        .await?
        .ok_or(GamePersonaApplicationError::PersonaNotFound)?;
    if binding.lifecycle != "active" {
        return Err(GamePersonaApplicationError::PersonaUnavailable);
    }
    if binding.current_claim_id.is_none() {
        return Err(GamePersonaApplicationError::InvalidBinding(
            "an active persona has no current private claim".to_string(),
        ));
    }

    let claim_id = issue_presentation_claim(
        tx,
        game_id,
        persona_id,
        binding.subject_id,
        occurred_at,
        &presentation,
    )
    .await?;
    Ok(canonical_persona_event(
        "GamePersonaRenamed",
        persona_id,
        binding.subject_id,
        claim_id,
        actor,
        occurred_at,
    ))
}

/// Return the private-claim scope key for one persona in one game.
///
/// A persona UUID is opaque but the binding itself is game scoped, so the
/// game UUID is the claim's scope id and the persona UUID is its scope key.
/// Projection replay must use this same pair when opening the claim.
pub fn presentation_scope_key(persona_id: GamePersonaId) -> String {
    persona_id.as_uuid().to_string()
}

async fn issue_presentation_claim(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    persona_id: GamePersonaId,
    subject_id: SubjectId,
    occurred_at: i64,
    presentation: &GamePersonaPresentation,
) -> Result<ClaimId, GamePersonaApplicationError> {
    let scope_key = presentation_scope_key(persona_id);
    Ok(insert_subject_claim(
        tx,
        subject_id,
        GAME_PERSONA_PRESENTATION_CLAIM_KIND,
        game_id,
        Some(&scope_key),
        occurred_at,
        presentation,
    )
    .await?)
}

fn canonical_persona_event(
    kind: &'static str,
    persona_id: GamePersonaId,
    subject_id: SubjectId,
    claim_id: ClaimId,
    actor: ActorId,
    occurred_at: i64,
) -> EventInput {
    EventInput::new(
        kind,
        1,
        serde_json::json!({
            "persona_id": persona_id.as_uuid(),
            "subject_id": subject_id.as_uuid(),
            "claim_id": claim_id.as_uuid(),
        }),
        actor,
        occurred_at,
    )
}

#[derive(Debug)]
struct PersonaBinding {
    subject_id: SubjectId,
    current_claim_id: Option<ClaimId>,
    lifecycle: String,
}

/// Lock one composite binding before either observing or creating it.
///
/// The projection's unique key remains authoritative. This advisory lock
/// avoids issuing a private claim for a duplicate registration when two
/// writers race to allocate the same caller-provided persona UUID.
async fn load_persona_binding_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    persona_id: GamePersonaId,
) -> Result<Option<PersonaBinding>, GamePersonaApplicationError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "game-persona-binding:{game_id}:{}",
            persona_id.as_uuid()
        ))
        .execute(&mut **tx)
        .await?;
    let row = sqlx::query(
        r#"
        SELECT subject_id, current_claim_id, lifecycle
        FROM game_persona_subject_binding
        WHERE game_id = $1 AND persona_id = $2
        FOR UPDATE
        "#,
    )
    .bind(game_id)
    .bind(persona_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(PersonaBinding {
        subject_id: SubjectId::from_uuid(row.try_get("subject_id")?),
        current_claim_id: row
            .try_get::<Option<Uuid>, _>("current_claim_id")?
            .map(ClaimId::from_uuid),
        lifecycle: row.try_get("lifecycle")?,
    }))
}

/// Lock the one-per-game subject key before registration. The database unique
/// index is the final authority; this avoids creating a sealed claim only to
/// discover that a concurrent registration already owns the subject.
async fn load_subject_binding_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    subject_id: SubjectId,
) -> Result<Option<GamePersonaId>, GamePersonaApplicationError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "game-persona-subject-binding:{game_id}:{}",
            subject_id.as_uuid()
        ))
        .execute(&mut **tx)
        .await?;
    sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT persona_id
        FROM game_persona_subject_binding
        WHERE game_id = $1 AND subject_id = $2
        FOR UPDATE
        "#,
    )
    .bind(game_id)
    .bind(subject_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await
    .map(|persona_id| persona_id.map(GamePersonaId::from_uuid))
    .map_err(GamePersonaApplicationError::from)
}

#[cfg(test)]
mod tests {
    use super::{canonical_persona_event, presentation_scope_key};
    use eventstore::ActorId;
    use game_platform::GamePersonaId;
    use identity::{ClaimId, SubjectId};
    use uuid::Uuid;

    #[test]
    fn canonical_persona_event_contains_only_identity_references() {
        let persona_id = GamePersonaId::from_uuid(Uuid::from_u128(1));
        let subject_id = SubjectId::from_uuid(Uuid::from_u128(2));
        let claim_id = ClaimId::from_uuid(Uuid::from_u128(3));
        let event = canonical_persona_event(
            "GamePersonaRegistered",
            persona_id,
            subject_id,
            claim_id,
            ActorId::Host,
            42,
        );

        assert_eq!(event.kind, "GamePersonaRegistered");
        assert_eq!(event.actor, ActorId::Host);
        assert_eq!(
            event.payload["persona_id"],
            persona_id.as_uuid().to_string()
        );
        assert_eq!(
            event.payload["subject_id"],
            subject_id.as_uuid().to_string()
        );
        assert_eq!(event.payload["claim_id"], claim_id.as_uuid().to_string());
        assert_eq!(event.payload.as_object().unwrap().len(), 3);
        assert!(event.payload.get("principal_id").is_none());
        assert!(event.payload.get("principal_user_id").is_none());
        assert!(event.payload.get("public_name").is_none());
    }

    #[test]
    fn claim_scope_is_stable_per_persona_uuid() {
        let persona_id = GamePersonaId::from_uuid(Uuid::from_u128(99));
        assert_eq!(
            presentation_scope_key(persona_id),
            persona_id.as_uuid().to_string()
        );
    }
}
