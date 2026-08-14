use eventstore::StoredEvent;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    ensure_slot, open_private_projection, required_private_string, seal_private_projection,
    ProjectionError,
};

pub(super) const TABLE: &str = "private_channel_member";
pub(super) const AUDIT_ORDER_BY: &str = "channel_id, slot_id";

/// Private channel membership derived from setup metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivateChannelMemberRow {
    pub game_id: Uuid,
    pub channel_id: String,
    pub kind: String,
    pub slot_id: String,
    pub role_key: String,
    pub reveals_alignment: String,
    pub source: String,
}

struct PrivateChannelMemberProjection<'a> {
    channel_id: &'a str,
    kind: &'a str,
    slot_id: &'a str,
    role_key: &'a str,
    reveals_alignment: &'a str,
    source: &'a str,
}

struct PrivateChannelMemberPayload {
    slot_id: String,
    role_key: String,
}

pub(super) async fn project_stored_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    event: &StoredEvent,
) -> Result<(), ProjectionError> {
    let payload = &event.payload;
    match event.kind.as_str() {
        "PrivateChannelDeclared" => {
            let channel_id = string_field(payload, "channel_id", &event.kind)?;
            let kind = string_field(payload, "kind", &event.kind)?;
            let reveals_alignment = string_field(payload, "reveals_alignment", &event.kind)?;
            let source = string_field(payload, "source", &event.kind)?;
            for member in members_field(payload, &event.kind)? {
                ensure_slot(tx, game_id, &member.slot_id).await?;
                insert_member(
                    tx,
                    game_id,
                    PrivateChannelMemberProjection {
                        channel_id: &channel_id,
                        kind: &kind,
                        slot_id: &member.slot_id,
                        role_key: &member.role_key,
                        reveals_alignment: &reveals_alignment,
                        source: &source,
                    },
                )
                .await?;
            }
        }
        "PrivateChannelMemberGranted" => {
            let channel_id = string_field(payload, "channel_id", &event.kind)?;
            let kind = string_field(payload, "kind", &event.kind)?;
            let slot_id = string_field(payload, "slot_id", &event.kind)?;
            let role_key = string_field(payload, "role_key", &event.kind)?;
            let reveals_alignment = string_field(payload, "reveals_alignment", &event.kind)?;
            let source = string_field(payload, "source", &event.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            insert_member(
                tx,
                game_id,
                PrivateChannelMemberProjection {
                    channel_id: &channel_id,
                    kind: &kind,
                    slot_id: &slot_id,
                    role_key: &role_key,
                    reveals_alignment: &reveals_alignment,
                    source: &source,
                },
            )
            .await?;
        }
        "PrivateChannelMemberRevoked" => {
            let channel_id = string_field(payload, "channel_id", &event.kind)?;
            let slot_id = string_field(payload, "slot_id", &event.kind)?;
            delete_member(tx, game_id, &channel_id, &slot_id).await?;
        }
        "PrivateChannelRevoked" => {
            let channel_id = string_field(payload, "channel_id", &event.kind)?;
            delete_channel(tx, game_id, &channel_id).await?;
        }
        _ => unreachable!("private-channel projector called for an unrelated event"),
    }
    Ok(())
}

pub async fn private_channel_members(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<PrivateChannelMemberRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, channel_id, kind, slot_id, private, source \
         FROM private_channel_member WHERE game_id = $1 ORDER BY channel_id, slot_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            let row_game_id: Uuid = row.get("game_id");
            let channel_id: String = row.get("channel_id");
            let slot_id: String = row.get("slot_id");
            let envelope: serde_json::Value = row.get("private");
            let game = row_game_id.to_string();
            let private = open_private_projection(
                TABLE,
                &[game.as_str(), channel_id.as_str(), slot_id.as_str()],
                &envelope,
            )?;
            Ok(PrivateChannelMemberRow {
                game_id: row_game_id,
                channel_id,
                kind: row.get("kind"),
                slot_id,
                role_key: required_private_string(&private, "role_key")?,
                reveals_alignment: required_private_string(&private, "reveals_alignment")?,
                source: row.get("source"),
            })
        })
        .collect()
}

pub(super) fn snapshot_identity(
    row: &serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<String>, ProjectionError> {
    Ok(vec![
        snapshot_string(row, "game_id")?,
        snapshot_string(row, "channel_id")?,
        snapshot_string(row, "slot_id")?,
    ])
}

pub(super) fn redact_snapshot(row: &mut serde_json::Map<String, serde_json::Value>) {
    row.insert("role_key".to_string(), serde_json::json!("<private>"));
    row.insert(
        "reveals_alignment".to_string(),
        serde_json::json!("<private>"),
    );
}

async fn insert_member(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    member: PrivateChannelMemberProjection<'_>,
) -> Result<(), ProjectionError> {
    let game = game_id.to_string();
    let private = seal_private_projection(
        tx,
        TABLE,
        &[game.as_str(), member.channel_id, member.slot_id],
        serde_json::json!({
            "role_key": member.role_key,
            "reveals_alignment": member.reveals_alignment,
        }),
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO private_channel_member (
            game_id, channel_id, kind, slot_id, private, source
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (game_id, channel_id, slot_id)
        DO UPDATE SET
            kind = EXCLUDED.kind,
            private = EXCLUDED.private,
            source = EXCLUDED.source
        "#,
    )
    .bind(game_id)
    .bind(member.channel_id)
    .bind(member.kind)
    .bind(member.slot_id)
    .bind(private)
    .bind(member.source)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_channel(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    channel_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM private_channel_member WHERE game_id = $1 AND channel_id = $2")
        .bind(game_id)
        .bind(channel_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn delete_member(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    channel_id: &str,
    slot_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "DELETE FROM private_channel_member \
         WHERE game_id = $1 AND channel_id = $2 AND slot_id = $3",
    )
    .bind(game_id)
    .bind(channel_id)
    .bind(slot_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn members_field(
    payload: &serde_json::Value,
    kind: &str,
) -> Result<Vec<PrivateChannelMemberPayload>, ProjectionError> {
    let members = payload
        .get("members")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_owned(),
            source: serde::de::Error::custom("missing array field `members`"),
        })?;
    if members.is_empty() {
        return Err(ProjectionError::Payload {
            kind: kind.to_owned(),
            source: serde::de::Error::custom("field `members` must not be empty"),
        });
    }
    members
        .iter()
        .map(|member| {
            Ok(PrivateChannelMemberPayload {
                slot_id: string_field(member, "slot_id", kind)?,
                role_key: string_field(member, "role_key", kind)?,
            })
        })
        .collect()
}

fn string_field(
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

fn snapshot_string(
    row: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<String, ProjectionError> {
    row.get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            ProjectionError::Store(eventstore::StoreError::Crypto(format!(
                "projection audit row missing string `{field}`"
            )))
        })
}
