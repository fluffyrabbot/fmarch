//! Mixed stream-key epoch proof through the HTTP thread read boundary.
//!
//! The projection test proves replay can decrypt old and new envelopes. This
//! test continues one hop outward: after replay/rebuild, the real API private
//! channel route returns plaintext only to an authorized channel member.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use media::{MediaLimits, MediaStore};
use principal::PrincipalId;
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
        std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
    }

    fn set_active_with_prior_key(&self, kid: &str, key: &str, prior_kid: &str, prior_key: &str) {
        self.set_active(kid, key);
        std::env::set_var("FMARCH_EVENT_WRAP_KEYS", format!("{prior_kid}={prior_key}"));
    }

    fn trust_prior_key(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_WRAP_KEYS", format!("{kid}={key}"));
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        match &self.prior_key {
            Some(value) => std::env::set_var("FMARCH_EVENT_WRAP_KEY", value),
            None => std::env::remove_var("FMARCH_EVENT_WRAP_KEY"),
        }
        match &self.prior_kid {
            Some(value) => std::env::set_var("FMARCH_EVENT_WRAP_KID", value),
            None => std::env::remove_var("FMARCH_EVENT_WRAP_KID"),
        }
        match &self.prior_keys {
            Some(value) => std::env::set_var("FMARCH_EVENT_WRAP_KEYS", value),
            None => std::env::remove_var("FMARCH_EVENT_WRAP_KEYS"),
        }
    }
}

fn stable_command_id(id: u64) -> Uuid {
    Uuid::from_u128(id as u128)
}

async fn post_command(
    app: axum::Router,
    id: u64,
    principal_id: PrincipalId,
    command: Command,
) -> ServerEnvelope {
    let global_capabilities = if matches!(&command, Command::CreateGame { .. }) {
        vec!["GlobalAdmin"]
    } else {
        Vec::new()
    };
    let body = serde_json::to_vec(&ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id: stable_command_id(id),
            command,
        }),
    ))
    .unwrap();
    let token = dev_session_token(&app, principal_id, global_capabilities).await;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("authorization", format!("Bearer {token}"))
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

async fn dev_session_token(
    app: &axum::Router,
    principal_id: PrincipalId,
    global_capabilities: Vec<&str>,
) -> String {
    let session = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "principal_id": principal_id,
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": global_capabilities
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session.status(), StatusCode::OK);
    let session_bytes = to_bytes(session.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&session_bytes).unwrap();
    session["session_token"]
        .as_str()
        .expect("dev session response must return its backend-generated token")
        .to_string()
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn mixed_kid_private_payloads_survive_rebuild_and_private_thread_api_read(
    pool: sqlx::PgPool,
) {
    let env = EncryptionEnvGuard::new();
    let media_root = tempfile::tempdir().unwrap();
    let media_store = MediaStore::open(media_root.path(), MediaLimits::default()).unwrap();
    let app =
        api::router_with_state(api::ApiState::new(pool.clone(), media_store).with_dev_auth(true));
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
            PrincipalId::fixture("host_h"),
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "encryptor_user", "encryptor"),
        (5, "slot_2", "goon_user", "mafia_goon"),
        (8, "slot_3", "traitor_user", "traitor"),
    ] {
        let _ = dev_session_token(&app, PrincipalId::fixture(user), Vec::new()).await;
        expect_ack(
            post_command(
                app.clone(),
                id,
                PrincipalId::fixture("host_h"),
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
                PrincipalId::fixture("host_h"),
                wire::seat_persona! {
                    game,
                    slot: slot.into(),
                    user: user,
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                PrincipalId::fixture("host_h"),
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
            PrincipalId::fixture("host_h"),
            Command::StartGame {
                game,
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        )
        .await,
    );

    env.set_active_with_prior_key(new_kid, new_key, old_kid, old_key);
    assert_eq!(
        eventstore::rotate_stream_data_key(&pool, game)
            .await
            .unwrap(),
        2
    );
    expect_ack(
        post_command(
            app.clone(),
            12,
            PrincipalId::fixture("encryptor_user"),
            Command::SubmitPost {
                game,
                channel_id: "private:mafia_day_chat".into(),
                actor_slot: "slot_1".into(),
                body: "mixed-key day chat survives replay".into(),
                media: None,
                quotations: None,
                embed: None,
            },
        )
        .await,
    );

    let raw_roles: Vec<(i16, i64, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT sealed_version, stream_key_epoch, sealed_nonce, sealed_body \
         FROM events WHERE stream_id = $1 AND kind = 'RoleAssigned' ORDER BY stream_seq",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(raw_roles.len(), 3);
    assert!(raw_roles.iter().all(|(version, epoch, nonce, body)| {
        *version == 3
            && *epoch == 1
            && nonce.len() == 24
            && body.len() >= 16
            && !body
                .windows("godfather".len())
                .any(|window| window == b"godfather")
    }));

    let raw_post: (i16, i64, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version, stream_key_epoch, sealed_nonce, sealed_body \
         FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' \
         ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_post.0, 3);
    assert_eq!(raw_post.1, 2);
    assert_eq!(raw_post.2.len(), 24);
    assert!(raw_post.3.len() >= 16);
    assert!(!raw_post
        .3
        .windows("mixed-key day chat survives replay".len())
        .any(|window| window == b"mixed-key day chat survives replay"));

    let wrapped_epochs: Vec<(i64, String)> = sqlx::query_as(
        "SELECT key_epoch, wrap_kid FROM event_stream_keys WHERE stream_id = $1 ORDER BY key_epoch",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        wrapped_epochs,
        vec![(1, old_kid.into()), (2, new_kid.into())]
    );

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

    let goon_token = dev_session_token(&app, PrincipalId::fixture("goon_user"), vec![]).await;
    let allowed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:mafia_day_chat/thread?limit=10"
                ))
                .header("authorization", format!("Bearer {goon_token}"))
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

    let traitor_token = dev_session_token(&app, PrincipalId::fixture("traitor_user"), vec![]).await;
    let denied_read = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:mafia_day_chat/thread?limit=10"
                ))
                .header("authorization", format!("Bearer {traitor_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied_read.status(), StatusCode::FORBIDDEN);

    let denied_post = post_command(
        app,
        13,
        PrincipalId::fixture("traitor_user"),
        Command::SubmitPost {
            game,
            channel_id: "private:mafia_day_chat".into(),
            actor_slot: "slot_3".into(),
            body: "traitor should not enter".into(),
            media: None,
            quotations: None,
            embed: None,
        },
    )
    .await;
    expect_reject(denied_post, RejectCode::NotAuthorized);
}
