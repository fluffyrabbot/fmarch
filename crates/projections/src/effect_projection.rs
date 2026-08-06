use eventstore::StoredEvent;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::{ensure_slot, upsert_player_notification, ProjectionError};

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
    pub phase_id: Option<String>,
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
    phase_id: Option<&'a str>,
    phase_kind: Option<&'a str>,
    phase_number: Option<i32>,
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
                phase_kind: None,
                phase_number: None,
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
    let phase_id = if event.kind == "EffectNotification" {
        required_string(&event.payload, "phase_id", &event.kind)?
    } else {
        event.payload["phase_id"].as_str().unwrap_or("").to_string()
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
    project_inner_event(tx, game_id, &phase_id, event_index, &inner).await
}

pub(super) async fn project_inner_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    envelope_phase_id: &str,
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
            phase_kind,
            phase_number,
            duration: domain::EffectDuration::Persistent,
            visibility,
        } => {
            ensure_slot(tx, game_id, target).await?;
            let phase_kind = phase_kind.map(|kind| format!("{kind:?}"));
            let visibility = format!("{visibility:?}");
            upsert_effect(
                tx,
                game_id,
                EffectProjection {
                    slot_id: target,
                    effect,
                    source_slot: actor,
                    source_action: source_action.as_deref(),
                    phase_id: phase_id.as_deref(),
                    phase_kind: phase_kind.as_deref(),
                    phase_number: phase_number.map(|number| number as i32),
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

/// Read persistent engine effects, ordered deterministically.
pub async fn slot_effects(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotEffectRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, effect, source_slot, source_action, phase_id, phase_kind, \
         phase_number, duration, visibility FROM slot_effect \
         WHERE game_id = $1 ORDER BY slot_id, effect",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| SlotEffectRow {
            game_id: row.get("game_id"),
            slot_id: row.get("slot_id"),
            effect: row.get("effect"),
            source_slot: row.get("source_slot"),
            source_action: row.get("source_action"),
            phase_id: row.get("phase_id"),
            phase_kind: row.get("phase_kind"),
            phase_number: row.get("phase_number"),
            duration: row.get("duration"),
            visibility: row.get("visibility"),
        })
        .collect())
}

async fn upsert_effect(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    projection: EffectProjection<'_>,
) -> Result<(), ProjectionError> {
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
    .bind(projection.phase_id)
    .bind(projection.phase_kind)
    .bind(projection.phase_number)
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

fn required_string(
    payload: &serde_json::Value,
    field: &str,
    kind: &str,
) -> Result<String, ProjectionError> {
    payload
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_owned(),
            source: serde::de::Error::custom(format!("missing string field `{field}`")),
        })
}
