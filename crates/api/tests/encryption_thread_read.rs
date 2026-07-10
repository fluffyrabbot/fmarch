//! Mixed-KID private payload proof through the HTTP thread read boundary.
//!
//! The projection test proves replay can decrypt old and new envelopes. This
//! test continues one hop outward: after replay/rebuild, the real API private
//! channel route returns plaintext only to an authorized channel member.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use media::{MediaLimits, MediaStore};
use std::sync::{Mutex, MutexGuard};
use tower::ServiceExt;
use uuid::Uuid;
use wire::{
    ClientEnvelope, ClientMsg, Command, CommandMsg, RejectCode, ServerEnvelope, ServerMsg,
    ThreadPage,
};

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

    fn set_active_with_prior_key(&self, kid: &str, key: &str, prior_kid: &str, prior_key: &str) {
        self.set_active(kid, key);
        std::env::set_var(
            "FMARCH_EVENT_ENCRYPTION_KEYS",
            format!("{prior_kid}={prior_key}"),
        );
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

fn stable_command_id(id: u64) -> Uuid {
    Uuid::from_u128(id as u128)
}

async fn post_command(
    app: axum::Router,
    id: u64,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    let body = serde_json::to_vec(&ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id: stable_command_id(id),
            principal_user_id: principal_user_id.to_string(),
            command,
        }),
    ))
    .unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn expect_ack(envelope: ServerEnvelope) {
    match envelope.body {
        ServerMsg::Ack(ack) => assert!(!ack.stream_seqs.is_empty()),
        other => panic!("expected Ack, got {other:?}"),
    }
}

fn expect_reject(envelope: ServerEnvelope, expected: RejectCode) {
    match envelope.body {
        ServerMsg::Reject(reject) => assert_eq!(reject.error, expected),
        other => panic!("expected Reject({expected:?}), got {other:?}"),
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn mixed_kid_private_payloads_survive_rebuild_and_private_thread_api_read(
    pool: sqlx::PgPool,
) {
    let env = EncryptionEnvGuard::new();
    let media_root = tempfile::tempdir().unwrap();
    let media_store = MediaStore::open(media_root.path(), MediaLimits::default()).unwrap();
    let app = api::router(pool.clone(), media_store);
    let game = Uuid::new_v4();
    let old_kid = "old-kid";
    let old_key = "old private event encryption key";
    let new_kid = "new-kid";
    let new_key = "new private event encryption key";

    env.set_active(old_kid, old_key);
    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "encryptor_user", "encryptor"),
        (5, "slot_2", "goon_user", "mafia_goon"),
        (8, "slot_3", "traitor_user", "traitor"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            11,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    env.set_active_with_prior_key(new_kid, new_key, old_kid, old_key);
    expect_ack(
        post_command(
            app.clone(),
            12,
            "encryptor_user",
            Command::SubmitPost {
                game,
                channel_id: "private:mafia_day_chat".into(),
                actor_slot: "slot_1".into(),
                body: "mixed-key day chat survives replay".into(),
                media: None,
            },
        )
        .await,
    );

    let raw_roles: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'RoleAssigned' ORDER BY stream_seq",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(raw_roles.len(), 3);
    assert!(raw_roles.iter().all(|payload| {
        payload.get("role_key").is_none()
            && payload["private"]["kid"] == old_kid
            && payload["private"]["ciphertext"].is_string()
    }));

    let raw_post: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_post["channel_id"], "private:mafia_day_chat");
    assert!(raw_post.get("body").is_none());
    assert_eq!(raw_post["body_private"]["kid"], new_kid);
    assert!(raw_post["body_private"]["ciphertext"].is_string());

    env.set_active(new_kid, new_key);
    let missing_old = projections::audit_rebuild(&pool, game)
        .await
        .expect_err("projection replay must not decrypt old envelopes without their kid");
    assert!(
        missing_old.to_string().contains(old_kid),
        "missing-key replay error should name {old_kid}, got {missing_old}"
    );

    env.trust_prior_key(old_kid, old_key);
    let audit = projections::audit_rebuild(&pool, game)
        .await
        .expect("rollback replay audit should decrypt both envelope kids");
    assert!(audit.ok, "mixed-kid rollback replay drifted: {audit:?}");
    projections::rebuild(&pool, game)
        .await
        .expect("destructive rebuild should decrypt both envelope kids");

    let allowed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:mafia_day_chat/thread?principal_user_id=goon_user&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
    let bytes = to_bytes(allowed.into_body(), usize::MAX).await.unwrap();
    let page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(page.posts.len(), 1);
    assert_eq!(page.posts[0].channel_id, "private:mafia_day_chat");
    assert_eq!(page.posts[0].body, "mixed-key day chat survives replay");

    let denied_read = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:mafia_day_chat/thread?principal_user_id=traitor_user&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied_read.status(), StatusCode::FORBIDDEN);

    let denied_post = post_command(
        app,
        13,
        "traitor_user",
        Command::SubmitPost {
            game,
            channel_id: "private:mafia_day_chat".into(),
            actor_slot: "slot_3".into(),
            body: "traitor should not enter".into(),
            media: None,
        },
    )
    .await;
    expect_reject(denied_post, RejectCode::NotAuthorized);
}
