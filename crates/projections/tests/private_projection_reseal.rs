use projections::{count_private_projection_envelopes_by_kid, reseal_private_projection_batch};
use sqlx::{PgPool, Postgres, Row, Transaction};
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
        let lock = ENCRYPTION_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let guard = Self {
            prior_key: std::env::var("FMARCH_EVENT_WRAP_KEY").ok(),
            prior_kid: std::env::var("FMARCH_EVENT_WRAP_KID").ok(),
            prior_keys: std::env::var("FMARCH_EVENT_WRAP_KEYS").ok(),
            _lock: lock,
        };
        std::env::remove_var("FMARCH_EVENT_WRAP_KEY");
        std::env::remove_var("FMARCH_EVENT_WRAP_KID");
        std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
        guard
    }

    fn set_active(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_WRAP_KID", kid);
        std::env::set_var("FMARCH_EVENT_WRAP_KEY", key);
    }

    fn trust_prior_key(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_WRAP_KEYS", format!("{kid}={key}"));
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        restore_env("FMARCH_EVENT_WRAP_KEY", &self.prior_key);
        restore_env("FMARCH_EVENT_WRAP_KID", &self.prior_kid);
        restore_env("FMARCH_EVENT_WRAP_KEYS", &self.prior_keys);
    }
}

fn restore_env(name: &str, value: &Option<String>) {
    match value {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

fn context(table: &str, identity: &[&str]) -> String {
    format!("fmarch-projection-v1:{table}:{}", identity.join(":"))
}

async fn seal(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    identity: &[&str],
    value: serde_json::Value,
) -> serde_json::Value {
    eventstore::encrypt_private_projection(tx, value, &context(table, identity))
        .await
        .unwrap()
}

async fn seed_every_surface(pool: &PgPool, game: Uuid) {
    let mut tx = pool.begin().await.unwrap();
    let game_text = game.to_string();

    let private_member = seal(
        &mut tx,
        "private_channel_member",
        &[game_text.as_str(), "private:mafia", "slot_1"],
        serde_json::json!({"role_key": "mafia", "reveals_alignment": "mafia"}),
    )
    .await;
    sqlx::query(
        "INSERT INTO private_channel_member \
         (game_id, channel_id, kind, slot_id, private, source) \
         VALUES ($1, 'private:mafia', 'alignment', 'slot_1', $2, 'test')",
    )
    .bind(game)
    .bind(private_member)
    .execute(&mut *tx)
    .await
    .unwrap();

    for slot in ["slot_1", "slot_2"] {
        let private = seal(
            &mut tx,
            "slot_state",
            &[game_text.as_str(), slot],
            serde_json::json!({"role_key": format!("role_{slot}"), "alignment": "town"}),
        )
        .await;
        sqlx::query("INSERT INTO slot_state (game_id, slot_id, private) VALUES ($1, $2, $3)")
            .bind(game)
            .bind(slot)
            .bind(private)
            .execute(&mut *tx)
            .await
            .unwrap();
    }

    let thread = seal(
        &mut tx,
        "thread_view",
        &[game_text.as_str(), "101", "private:mafia"],
        serde_json::json!({"body": "secret post", "quotations": []}),
    )
    .await;
    sqlx::query(
        "INSERT INTO thread_view \
         (game_id, source_seq, stream_seq, channel_id, author_slot, phase_id, body, body_private, occurred_at) \
         VALUES ($1, 101, 1, 'private:mafia', 'slot_1', 'D01', NULL, $2, 1000)",
    )
    .bind(game)
    .bind(thread)
    .execute(&mut *tx)
    .await
    .unwrap();

    let investigation = seal(
        &mut tx,
        "player_investigation_result",
        &[game_text.as_str(), "D01", "1", "slot_1"],
        serde_json::json!({"result": {"alignment": "mafia"}}),
    )
    .await;
    sqlx::query(
        "INSERT INTO player_investigation_result \
         (game_id, phase_id, event_index, audience_slot, mode, target_slot, result_private) \
         VALUES ($1, 'D01', 1, 'slot_1', 'Alignment', 'slot_2', $2)",
    )
    .bind(game)
    .bind(investigation)
    .execute(&mut *tx)
    .await
    .unwrap();

    let info = seal(
        &mut tx,
        "player_info_result",
        &[game_text.as_str(), "D01", "2", "slot_1"],
        serde_json::json!({"result": {"visits": ["slot_2"]}}),
    )
    .await;
    sqlx::query(
        "INSERT INTO player_info_result \
         (game_id, phase_id, event_index, audience_slot, kind, actor_slot, target_slot, source_action, template_id, result_private) \
         VALUES ($1, 'D01', 2, 'slot_1', 'Visits', 'slot_1', 'slot_2', 'watch', 'watcher', $2)",
    )
    .bind(game)
    .bind(info)
    .execute(&mut *tx)
    .await
    .unwrap();

    let memory = seal(
        &mut tx,
        "investigation_memory",
        &[game_text.as_str(), "slot_1", "slot_2", "Alignment"],
        serde_json::json!({"result": {"alignment": "mafia"}}),
    )
    .await;
    sqlx::query(
        "INSERT INTO investigation_memory \
         (game_id, investigator_slot, target_slot, mode, result_private, source_action, template_id, phase_id, phase_kind, phase_number) \
         VALUES ($1, 'slot_1', 'slot_2', 'Alignment', $2, 'investigate', 'cop', 'D01', 'Day', 1)",
    )
    .bind(game)
    .bind(memory)
    .execute(&mut *tx)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO day_event \
         (game_id, event_id, definition, state, scheduled_seq, updated_seq) \
         VALUES ($1, 'event_1', '{}', 'scheduled', 1, 1)",
    )
    .bind(game)
    .execute(&mut *tx)
    .await
    .unwrap();
    let template = seal(
        &mut tx,
        "day_event_narrative",
        &[game_text.as_str(), "event_1", "opened", "template"],
        serde_json::json!({"body": "private template"}),
    )
    .await;
    let rendered = seal(
        &mut tx,
        "day_event_narrative",
        &[game_text.as_str(), "event_1", "opened", "rendered"],
        serde_json::json!({"body": "private rendered body"}),
    )
    .await;
    sqlx::query(
        "INSERT INTO day_event_narrative \
         (game_id, event_id, lifecycle, template_key, template_hash, channel_id, \
          body_template, body_template_private, source_seq, rendered_body, rendered_body_private, status) \
         VALUES ($1, 'event_1', 'opened', 'template_1', $2, 'private:event:_test', \
                 NULL, $3, 102, NULL, $4, 'pending')",
    )
    .bind(game)
    .bind("0".repeat(64))
    .bind(template)
    .bind(rendered)
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.commit().await.unwrap();
}

async fn open_all(pool: &PgPool, game: Uuid) -> Vec<serde_json::Value> {
    let game_text = game.to_string();
    let mut values = Vec::new();

    let member: serde_json::Value =
        sqlx::query_scalar("SELECT private FROM private_channel_member WHERE game_id = $1")
            .bind(game)
            .fetch_one(pool)
            .await
            .unwrap();
    values.push(
        eventstore::decrypt_private_projection(
            &member,
            &context(
                "private_channel_member",
                &[game_text.as_str(), "private:mafia", "slot_1"],
            ),
        )
        .unwrap(),
    );

    let slots =
        sqlx::query("SELECT slot_id, private FROM slot_state WHERE game_id = $1 ORDER BY slot_id")
            .bind(game)
            .fetch_all(pool)
            .await
            .unwrap();
    for row in slots {
        let slot: String = row.get("slot_id");
        let envelope: serde_json::Value = row.get("private");
        values.push(
            eventstore::decrypt_private_projection(
                &envelope,
                &context("slot_state", &[game_text.as_str(), slot.as_str()]),
            )
            .unwrap(),
        );
    }

    for (query, table, identity) in [
        (
            "SELECT body_private FROM thread_view WHERE game_id = $1",
            "thread_view",
            vec![game_text.as_str(), "101", "private:mafia"],
        ),
        (
            "SELECT result_private FROM player_investigation_result WHERE game_id = $1",
            "player_investigation_result",
            vec![game_text.as_str(), "D01", "1", "slot_1"],
        ),
        (
            "SELECT result_private FROM player_info_result WHERE game_id = $1",
            "player_info_result",
            vec![game_text.as_str(), "D01", "2", "slot_1"],
        ),
        (
            "SELECT result_private FROM investigation_memory WHERE game_id = $1",
            "investigation_memory",
            vec![game_text.as_str(), "slot_1", "slot_2", "Alignment"],
        ),
    ] {
        let envelope: serde_json::Value = sqlx::query_scalar(query)
            .bind(game)
            .fetch_one(pool)
            .await
            .unwrap();
        values.push(
            eventstore::decrypt_private_projection(&envelope, &context(table, &identity)).unwrap(),
        );
    }

    let narrative = sqlx::query(
        "SELECT body_template_private, rendered_body_private \
         FROM day_event_narrative WHERE game_id = $1",
    )
    .bind(game)
    .fetch_one(pool)
    .await
    .unwrap();
    for (column, suffix) in [
        ("body_template_private", "template"),
        ("rendered_body_private", "rendered"),
    ] {
        let envelope: serde_json::Value = narrative.get(column);
        values.push(
            eventstore::decrypt_private_projection(
                &envelope,
                &context(
                    "day_event_narrative",
                    &[game_text.as_str(), "event_1", "opened", suffix],
                ),
            )
            .unwrap(),
        );
    }
    values
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn direct_projection_reseal_is_resumable_concurrent_and_identity_preserving(pool: PgPool) {
    let env = EncryptionEnvGuard::new();
    let game = Uuid::new_v4();
    env.set_active("old-kid", "old projection reseal key");
    seed_every_surface(&pool, game).await;

    let before = open_all(&pool, game).await;
    assert_eq!(before.len(), 9);
    assert_eq!(
        count_private_projection_envelopes_by_kid(&pool, "old-kid")
            .await
            .unwrap(),
        9
    );

    env.set_active("new-kid", "new projection reseal key");
    env.trust_prior_key("old-kid", "old projection reseal key");
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();
    eventstore::begin_runtime_kek_retirement(&pool, "old-kid", "new-kid")
        .await
        .unwrap();

    // This bounded pass models cancellation after one durable batch per
    // surface: the second slot row remains old-key and no cursor is persisted.
    let interrupted = reseal_private_projection_batch(&pool, "old-kid", 1)
        .await
        .unwrap();
    assert_eq!(interrupted.resealed, 8);
    assert_eq!(interrupted.batch_size, 1);
    assert!(interrupted.batch_full);
    assert_eq!(
        count_private_projection_envelopes_by_kid(&pool, "old-kid")
            .await
            .unwrap(),
        1
    );

    let (worker_a, worker_b) = tokio::join!(
        reseal_private_projection_batch(&pool, "old-kid", 1),
        reseal_private_projection_batch(&pool, "old-kid", 1),
    );
    let worker_a = worker_a.unwrap();
    let worker_b = worker_b.unwrap();
    assert_eq!(worker_a.resealed + worker_b.resealed, 1);
    assert_eq!(
        count_private_projection_envelopes_by_kid(&pool, "old-kid")
            .await
            .unwrap(),
        0
    );

    let resumed = reseal_private_projection_batch(&pool, "old-kid", 1)
        .await
        .unwrap();
    assert_eq!(resumed.examined, 0);
    assert_eq!(resumed.resealed, 0);
    assert!(!resumed.batch_full);
    assert_eq!(
        count_private_projection_envelopes_by_kid(&pool, "old-kid")
            .await
            .unwrap(),
        0
    );
    assert_eq!(open_all(&pool, game).await, before);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn raw_direct_envelope_writer_is_fenced_by_registry_transition(pool: PgPool) {
    let env = EncryptionEnvGuard::new();
    let game = Uuid::new_v4();
    let game_text = game.to_string();
    env.set_active("guard-old", "old raw writer guard key");

    let mut prepared = pool.begin().await.unwrap();
    let envelope = seal(
        &mut prepared,
        "slot_state",
        &[game_text.as_str(), "slot_1"],
        serde_json::json!({"role_key": "doctor", "alignment": "town"}),
    )
    .await;
    prepared.commit().await.unwrap();

    // This raw writer deliberately bypasses the application encryption API.
    // The database trigger must still hold a true shared row lock until commit.
    let mut writer = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO slot_state (game_id, slot_id, private) VALUES ($1, 'slot_1', $2)")
        .bind(game)
        .bind(&envelope)
        .execute(&mut *writer)
        .await
        .unwrap();

    env.set_active("guard-new", "new raw writer guard key");
    env.trust_prior_key("guard-old", "old raw writer guard key");
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();
    let retirement_pool = pool.clone();
    let transition = tokio::spawn(async move {
        eventstore::begin_runtime_kek_retirement(&retirement_pool, "guard-old", "guard-new").await
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        !transition.is_finished(),
        "the database write guard must fence a raw old-KID writer"
    );
    writer.commit().await.unwrap();
    assert_eq!(
        transition.await.unwrap().unwrap().lifecycle,
        eventstore::RuntimeKekLifecycle::Retiring
    );

    let error =
        sqlx::query("INSERT INTO slot_state (game_id, slot_id, private) VALUES ($1, 'slot_2', $2)")
            .bind(game)
            .bind(envelope)
            .execute(&pool)
            .await
            .expect_err("raw old-KID writes must fail after the fence");
    assert!(error.to_string().contains("is not writable"));
}
