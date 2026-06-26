//! Mixed-key private payload replay proof against REAL Postgres.
//!
//! This sits outside the eventstore crate on purpose: eventstore already proves
//! stored-kid lookup at `load_stream`; this file proves the projection replay
//! boundary can rebuild from old and new encrypted envelopes in the same stream.

use eventstore::{ActorId, EventInput};
use projections::{
    append_and_project, audit_rebuild, rebuild, slot_state, thread_view_for_channel,
};
use sqlx::Row;
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

static ENCRYPTION_ENV_LOCK: Mutex<()> = Mutex::new(());

struct EncryptionEnvGuard {
    prior_key: Option<String>,
    prior_kid: Option<String>,
    prior_keys: Option<String>,
    _lock: MutexGuard<'static, ()>,
}

impl EncryptionEnvGuard {
    fn new() -> Self {
        let lock = ENCRYPTION_ENV_LOCK.lock().unwrap();
        let guard = Self {
            prior_key: std::env::var("FMARCH_EVENT_ENCRYPTION_KEY").ok(),
            prior_kid: std::env::var("FMARCH_EVENT_ENCRYPTION_KID").ok(),
            prior_keys: std::env::var("FMARCH_EVENT_ENCRYPTION_KEYS").ok(),
            _lock: lock,
        };
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEY");
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KID");
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEYS");
        guard
    }

    fn set_active(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_ENCRYPTION_KID", kid);
        std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEY", key);
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEYS");
    }

    fn trust_prior_key(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEYS", format!("{kid}={key}"));
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        match &self.prior_key {
            Some(value) => std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEY", value),
            None => std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEY"),
        }
        match &self.prior_kid {
            Some(value) => std::env::set_var("FMARCH_EVENT_ENCRYPTION_KID", value),
            None => std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KID"),
        }
        match &self.prior_keys {
            Some(value) => std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEYS", value),
            None => std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEYS"),
        }
    }
}

fn role_assigned(slot: &str, role_key: &str, alignment: &str) -> EventInput {
    EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({
            "slot_id": slot,
            "role_key": role_key,
            "alignment": alignment,
            "role_effects": ["private-chat-member"],
        }),
        ActorId::Host,
        10,
    )
}

fn private_post(channel: &str, slot: &str, body: &str) -> EventInput {
    EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": channel,
            "slot_or_user": { "slot": slot },
            "body": body,
            "phase_id": "D01",
        }),
        ActorId::Slot(slot.into()),
        11,
    )
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn mixed_kid_private_payloads_survive_projection_replay_audit_and_rebuild(
    pool: sqlx::PgPool,
) {
    let env = EncryptionEnvGuard::new();
    let game = Uuid::new_v4();

    env.set_active("old-kid", "old private event encryption key");
    append_and_project(
        &pool,
        game,
        &[role_assigned("slot_1", "godfather", "mafia")],
    )
    .await
    .expect("append old-key role assignment through projection boundary");

    env.set_active("new-kid", "new private event encryption key");
    append_and_project(
        &pool,
        game,
        &[private_post(
            "private:mafia_day_chat",
            "slot_1",
            "coordinate with the new key",
        )],
    )
    .await
    .expect("append new-key private post through projection boundary");

    let raw_rows =
        sqlx::query("SELECT kind, payload FROM events WHERE stream_id = $1 ORDER BY stream_seq")
            .bind(game)
            .fetch_all(&pool)
            .await
            .expect("raw encrypted event rows");
    assert_eq!(raw_rows.len(), 2);

    let raw_role: serde_json::Value = raw_rows[0].get("payload");
    assert_eq!(raw_rows[0].get::<String, _>("kind"), "RoleAssigned");
    assert_eq!(raw_role["slot_id"], "slot_1");
    assert!(raw_role.get("role_key").is_none());
    assert_eq!(raw_role["private"]["kid"], "old-kid");
    assert!(raw_role["private"]["ciphertext"].is_string());

    let raw_post: serde_json::Value = raw_rows[1].get("payload");
    assert_eq!(raw_rows[1].get::<String, _>("kind"), "PostSubmitted");
    assert_eq!(raw_post["channel_id"], "private:mafia_day_chat");
    assert!(raw_post.get("body").is_none());
    assert_eq!(raw_post["body_private"]["kid"], "new-kid");
    assert!(raw_post["body_private"]["ciphertext"].is_string());

    let missing_old = audit_rebuild(&pool, game)
        .await
        .expect_err("projection replay must not decrypt old envelopes without their kid");
    assert!(
        missing_old.to_string().contains("old-kid"),
        "missing-key replay error should name old-kid, got {missing_old}"
    );

    env.trust_prior_key("old-kid", "old private event encryption key");
    let audit = audit_rebuild(&pool, game)
        .await
        .expect("rollback replay audit should decrypt both envelope kids");
    assert!(audit.ok, "mixed-kid rollback replay drifted: {audit:?}");
    for table in ["slot_state", "thread_view"] {
        let table_audit = audit
            .tables
            .iter()
            .find(|entry| entry.table == table)
            .unwrap_or_else(|| panic!("{table} audit table"));
        assert_eq!(table_audit.before_rows, 1, "{table} before row count");
        assert_eq!(table_audit.rebuilt_rows, 1, "{table} rebuilt row count");
    }

    rebuild(&pool, game)
        .await
        .expect("destructive projection rebuild should decrypt both envelope kids");
    let slot = slot_state(&pool, game)
        .await
        .expect("slot projection after rebuild")
        .into_iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("slot_1 projection");
    assert_eq!(slot.role_key.as_deref(), Some("godfather"));
    assert_eq!(slot.alignment.as_deref(), Some("mafia"));

    let thread = thread_view_for_channel(&pool, game, "private:mafia_day_chat", None, 10)
        .await
        .expect("private thread cold-load after rebuild");
    assert_eq!(thread.posts.len(), 1);
    assert_eq!(thread.posts[0].body, "coordinate with the new key");
}
