use eventstore::StoredEvent;
use serde::{Deserialize, Serialize};
use sqlx::postgres::{PgPool, PgRow};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    ensure_slot, optional_phase_materialization_from_stored_id, phase_materialization,
    upsert_player_notification, ProjectionError,
};
use domain::phase::PhaseId;

pub(super) const TABLE: &str = "slot_effect";
pub(super) const AUDIT_ORDER_BY: &str = "slot_id, effect";

/// A persistent engine effect tag carried by a slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotEffectRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub effect: String,
    pub source_slot: String,
    pub source_action: Option<String>,
    pub phase_id: Option<PhaseId>,
    pub phase_kind: Option<String>,
    pub phase_number: Option<i32>,
    pub duration: String,
    pub visibility: String,
}

struct EffectProjection<'a> {
    slot_id: &'a str,
    effect: &'a str,
    source_slot: &'a str,
    source_action: Option<&'a str>,
    phase_id: Option<&'a PhaseId>,
    duration: &'a str,
    visibility: &'a str,
}

pub(super) async fn project_role_effects(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    role_effects: &[String],
) -> Result<(), ProjectionError> {
    for effect in role_effects {
        upsert_effect(
            tx,
            game_id,
            EffectProjection {
                slot_id,
                effect,
                source_slot: slot_id,
                source_action: Some("role-assignment"),
                phase_id: None,
                duration: "Persistent",
                visibility: "Hidden",
            },
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn project_stored_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    event: &StoredEvent,
) -> Result<(), ProjectionError> {
    let inner: domain::InnerEvent = serde_json::from_value(serde_json::json!({
        "kind": event.kind.clone(),
        "payload": event.payload.clone(),
    }))
    .map_err(|source| ProjectionError::Payload {
        kind: event.kind.clone(),
        source,
    })?;
    let envelope_phase_id = match event.kind.as_str() {
        "EffectNotification" => Some(phase_id_field(&event.payload, "phase_id", &event.kind)?),
        _ => optional_phase_id_field(&event.payload, "phase_id", &event.kind)?,
    };
    let event_index = if event.kind == "EffectNotification" {
        i32::try_from(event.stream_seq)
            .ok()
            .and_then(i32::checked_neg)
            .ok_or_else(|| ProjectionError::Payload {
                kind: event.kind.clone(),
                source: serde::de::Error::custom(
                    "stream_seq cannot form a top-level notification index",
                ),
            })?
    } else {
        event.stream_seq as i32
    };
    project_inner_event(tx, game_id, envelope_phase_id.as_ref(), event_index, &inner).await
}

pub(super) async fn project_inner_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    envelope_phase_id: Option<&PhaseId>,
    event_index: i32,
    event: &domain::InnerEvent,
) -> Result<(), ProjectionError> {
    match event {
        domain::InnerEvent::EffectsMarked {
            effect,
            target,
            actor,
            source_action,
            phase_id,
            duration: domain::EffectDuration::Persistent,
            visibility,
        } => {
            ensure_slot(tx, game_id, target).await?;
            let visibility = format!("{visibility:?}");
            upsert_effect(
                tx,
                game_id,
                EffectProjection {
                    slot_id: target,
                    effect,
                    source_slot: actor,
                    source_action: source_action.as_deref(),
                    phase_id: phase_id.as_ref(),
                    duration: "Persistent",
                    visibility: &visibility,
                },
            )
            .await?;
        }
        domain::InnerEvent::EffectsMarked { .. } => {}
        domain::InnerEvent::EffectsCleared {
            effect, targets, ..
        } => {
            for target in targets {
                delete_effect(tx, game_id, target, effect).await?;
            }
        }
        domain::InnerEvent::EffectNotification {
            effect,
            status,
            audience,
            ..
        } => {
            let envelope_phase_id = envelope_phase_id.ok_or_else(|| ProjectionError::Payload {
                kind: "EffectNotification".to_string(),
                source: serde::de::Error::custom("missing canonical phase_id"),
            })?;
            for audience_slot in audience {
                upsert_player_notification(
                    tx,
                    game_id,
                    envelope_phase_id,
                    event_index,
                    audience_slot,
                    effect,
                    status,
                )
                .await?;
            }
        }
        _ => unreachable!("effect projector called for a non-effect event"),
    }
    Ok(())
}

/// Persistent engine effects for one slot. Command admission uses this instead
/// of reconstructing a full `StateSnapshot` from the sealed stream.
pub async fn slot_effects_for_slot<'e, E>(
    executor: E,
    game_id: Uuid,
    slot_id: &str,
) -> Result<Vec<SlotEffectRow>, ProjectionError>
where
    E: sqlx::PgExecutor<'e>,
{
    let rows = sqlx::query(
        "SELECT game_id, slot_id, effect, source_slot, source_action, phase_id, duration, visibility FROM slot_effect \
         WHERE game_id = $1 AND slot_id = $2 ORDER BY effect",
    )
    .bind(game_id)
    .bind(slot_id)
    .fetch_all(executor)
    .await?;
    rows.into_iter().map(slot_effect_row).collect()
}

/// Read persistent engine effects, ordered deterministically.
pub async fn slot_effects(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotEffectRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, effect, source_slot, source_action, phase_id, duration, visibility FROM slot_effect \
         WHERE game_id = $1 ORDER BY slot_id, effect",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(slot_effect_row).collect()
}

fn slot_effect_row(row: PgRow) -> Result<SlotEffectRow, ProjectionError> {
    let phase = optional_phase_materialization_from_stored_id(row.get("phase_id"), "slot_effect")?;
    Ok(SlotEffectRow {
        game_id: row.get("game_id"),
        slot_id: row.get("slot_id"),
        effect: row.get("effect"),
        source_slot: row.get("source_slot"),
        source_action: row.get("source_action"),
        phase_id: phase.phase_id,
        phase_kind: phase.phase_kind.map(str::to_owned),
        phase_number: phase.phase_number,
        duration: row.get("duration"),
        visibility: row.get("visibility"),
    })
}

async fn upsert_effect(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    projection: EffectProjection<'_>,
) -> Result<(), ProjectionError> {
    let (phase_kind, phase_number) = projection
        .phase_id
        .map(|phase_id| phase_materialization(phase_id, "slot_effect"))
        .transpose()?
        .map_or((None, None), |(kind, number)| (Some(kind), Some(number)));
    sqlx::query(
        "INSERT INTO slot_effect \
         (game_id, slot_id, effect, source_slot, source_action, phase_id, phase_kind, \
          phase_number, duration, visibility) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
         ON CONFLICT (game_id, slot_id, effect) DO UPDATE SET \
         source_slot = EXCLUDED.source_slot, \
         source_action = EXCLUDED.source_action, \
         phase_id = EXCLUDED.phase_id, \
         phase_kind = EXCLUDED.phase_kind, \
         phase_number = EXCLUDED.phase_number, \
         duration = EXCLUDED.duration, \
         visibility = EXCLUDED.visibility",
    )
    .bind(game_id)
    .bind(projection.slot_id)
    .bind(projection.effect)
    .bind(projection.source_slot)
    .bind(projection.source_action)
    .bind(projection.phase_id.map(PhaseId::as_str))
    .bind(phase_kind)
    .bind(phase_number)
    .bind(projection.duration)
    .bind(projection.visibility)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_effect(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    effect: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM slot_effect WHERE game_id = $1 AND slot_id = $2 AND effect = $3")
        .bind(game_id)
        .bind(slot_id)
        .bind(effect)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn phase_id_field(
    payload: &serde_json::Value,
    field: &str,
    kind: &str,
) -> Result<PhaseId, ProjectionError> {
    let value = payload
        .get(field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_owned(),
            source: serde::de::Error::custom(format!("missing string field `{field}`")),
        })?;
    PhaseId::parse(value).map_err(|source| ProjectionError::Payload {
        kind: kind.to_owned(),
        source: serde::de::Error::custom(source.to_string()),
    })
}

fn optional_phase_id_field(
    payload: &serde_json::Value,
    field: &str,
    kind: &str,
) -> Result<Option<PhaseId>, ProjectionError> {
    match payload.get(field) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(value)) => {
            PhaseId::parse(value)
                .map(Some)
                .map_err(|source| ProjectionError::Payload {
                    kind: kind.to_owned(),
                    source: serde::de::Error::custom(source.to_string()),
                })
        }
        Some(_) => Err(ProjectionError::Payload {
            kind: kind.to_owned(),
            source: serde::de::Error::custom(format!("field `{field}` must be a string")),
        }),
    }
}
