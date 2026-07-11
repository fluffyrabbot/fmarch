use api::{ApiState, HostSetupStateResponse, MediaUploadResponse};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use media::{MediaLimits, MediaStore, VariantLimits};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::OnceLock;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{
    ClientEnvelope, ClientMsg, Command, CommandMsg, DiscussionThreadPage, DiscussionTopicPage,
    GameIndexPage, PlayerInvestigationResult, PlayerNotification, ProjectionDelta, RejectCode,
    RejectMsg, ServerEnvelope, ServerMsg, SlotLifecycle, SubmitPostMedia, ThreadPage, VoteTarget,
    PROTOCOL_VERSION,
};

fn router(pool: sqlx::PgPool) -> axum::Router {
    api::router(pool, shared_test_media_store())
}

fn router_with_dev_auth(pool: sqlx::PgPool) -> axum::Router {
    api::router_with_state(test_api_state(pool).with_dev_auth(true))
}

fn test_api_state(pool: sqlx::PgPool) -> ApiState {
    ApiState::new(pool, shared_test_media_store())
}

fn shared_test_media_store() -> MediaStore {
    static ROOT: OnceLock<TempDir> = OnceLock::new();
    let root = ROOT.get_or_init(|| tempfile::tempdir().expect("create shared API test media root"));
    MediaStore::open(root.path(), MediaLimits::default()).expect("open shared API test media store")
}

async fn create_test_auth_account(
    app: &axum::Router,
    admin_token: &str,
    account_id: &str,
    password: &str,
    principal_user_id: &str,
) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "account_id": account_id,
                        "password": password,
                        "principal_user_id": principal_user_id
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

async fn create_media_upload_account_session(app: &axum::Router, label: &str) -> (String, String) {
    let admin_token = format!("media-upload-admin-{label}");
    let account_id = format!("media-upload-{label}@example.test");
    let principal_user_id = format!("media_upload_{label}");
    let password = "correct horse battery";
    let session_token = format!("media-upload-session-{label}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": admin_token,
                        "principal_user_id": format!("media_admin_{label}"),
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    create_test_auth_account(app, &admin_token, &account_id, password, &principal_user_id).await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": account_id,
                        "password": password,
                        "session_token": session_token,
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    (session_token, principal_user_id)
}

async fn post_media_upload(
    app: &axum::Router,
    token: Option<&str>,
    content_type: &str,
    body: Vec<u8>,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("POST")
        .uri("/media/uploads")
        .header("content-type", content_type);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    app.clone()
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap()
}

fn media_upload_png(width: u32, height: u32) -> Vec<u8> {
    let pixels: Vec<u8> = (0..u64::from(width) * u64::from(height))
        .flat_map(|index| {
            [
                (index % 251) as u8,
                ((index * 3) % 251) as u8,
                ((index * 7) % 251) as u8,
                if index % 5 == 0 { 127 } else { 255 },
            ]
        })
        .collect();
    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&pixels).unwrap();
    }
    encoded
}

fn media_blob_entry_count(root: &Path) -> usize {
    std::fs::read_dir(root.join("blobs")).unwrap().count()
}

async fn post_public_auth_json(
    app: &axum::Router,
    uri: &str,
    body: serde_json::Value,
    source: Option<&str>,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(source) = source {
        request = request.header("x-fmarch-auth-source", source);
    }
    app.clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn media_upload_authorized_is_idempotent_and_restart_verified(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool, store.clone())
            .with_dev_auth(true)
            .with_variant_limits(VariantLimits::default()),
    );
    let (token, _) = create_media_upload_account_session(&app, "authorized").await;
    let png = media_upload_png(3, 2);

    let first = post_media_upload(&app, Some(&token), "image/png", png.clone()).await;
    assert_eq!(first.status(), StatusCode::CREATED);
    let first: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(first.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(first.intrinsic_width, 3);
    assert_eq!(first.intrinsic_height, 2);
    assert_eq!(
        first.variant_recipe_revision,
        media::VARIANT_RECIPE_REVISION
    );
    assert_eq!(first.variants.len(), 6);
    assert!(first
        .variants
        .iter()
        .all(|variant| variant.encoded_len > 0 && variant.blake3.len() == 64));

    let repeated = post_media_upload(&app, Some(&token), "image/png", png).await;
    assert_eq!(repeated.status(), StatusCode::OK);
    let repeated: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(repeated.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(repeated, first);
    assert_eq!(media_blob_entry_count(root.path()), 1);

    drop(app);
    drop(store);
    let restarted = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let id = first.content_id.parse::<media::ContentId>().unwrap();
    assert!(restarted.lookup(id).unwrap().is_some());
    assert!(restarted
        .lookup_variant_set(id, VariantLimits::default())
        .unwrap()
        .is_some());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn media_upload_rejects_nonaccount_expired_revoked_and_disabled_sessions_without_retention(
    pool: sqlx::PgPool,
) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(ApiState::new(pool.clone(), store).with_dev_auth(true));
    let png = media_upload_png(2, 2);

    let missing = post_media_upload(&app, None, "image/png", png.clone()).await;
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

    let dev_only_token = "media-upload-dev-only";
    let dev_only = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": dev_only_token,
                        "principal_user_id": "media_dev_only",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": []
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dev_only.status(), StatusCode::OK);
    let rejected = post_media_upload(&app, Some(dev_only_token), "image/png", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let (expired_token, expired_principal) =
        create_media_upload_account_session(&app, "expired").await;
    sqlx::query("UPDATE auth_session SET expires_at = 1 WHERE principal_user_id = $1")
        .bind(&expired_principal)
        .execute(&pool)
        .await
        .unwrap();
    let rejected = post_media_upload(&app, Some(&expired_token), "image/png", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let (revoked_token, revoked_principal) =
        create_media_upload_account_session(&app, "revoked").await;
    sqlx::query("UPDATE auth_session SET revoked_at = 1 WHERE principal_user_id = $1")
        .bind(&revoked_principal)
        .execute(&pool)
        .await
        .unwrap();
    let rejected = post_media_upload(&app, Some(&revoked_token), "image/png", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let (disabled_token, disabled_principal) =
        create_media_upload_account_session(&app, "disabled").await;
    sqlx::query("UPDATE auth_account SET disabled_at = 1 WHERE principal_user_id = $1")
        .bind(&disabled_principal)
        .execute(&pool)
        .await
        .unwrap();
    let rejected = post_media_upload(&app, Some(&disabled_token), "image/png", png).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(media_blob_entry_count(root.path()), 0);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn media_upload_rejects_type_malformed_dimension_and_body_limits_without_retention(
    pool: sqlx::PgPool,
) {
    let root = tempfile::tempdir().unwrap();
    let media_limits = MediaLimits::new(1_024, 1, 1, 1, 4).unwrap();
    let store = MediaStore::open(root.path(), media_limits).unwrap();
    let app = api::router_with_state(ApiState::new(pool.clone(), store).with_dev_auth(true));
    let (token, _) = create_media_upload_account_session(&app, "invalid").await;
    let png = media_upload_png(2, 2);

    let rejected =
        post_media_upload(&app, Some(&token), "application/octet-stream", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let rejected = post_media_upload(&app, Some(&token), "image/jpeg", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let rejected = post_media_upload(&app, Some(&token), "image/gif", b"GIF89a".to_vec()).await;
    assert_eq!(rejected.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);

    let mut malformed = b"\x89PNG\r\n\x1a\n".to_vec();
    malformed.extend_from_slice(b"not-a-real-png");
    let rejected = post_media_upload(&app, Some(&token), "image/png", malformed).await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let rejected = post_media_upload(&app, Some(&token), "image/png", png).await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let mut oversized = vec![0_u8; 1_025];
    oversized[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let rejected = post_media_upload(&app, Some(&token), "image/png", oversized).await;
    assert_eq!(rejected.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(media_blob_entry_count(root.path()), 0);

    let variant_root = tempfile::tempdir().unwrap();
    let variant_store = MediaStore::open(variant_root.path(), MediaLimits::default()).unwrap();
    let variant_limits = VariantLimits::new(2_560, 2_560, 6_553_600, 8, 48).unwrap();
    let variant_app = api::router_with_state(
        ApiState::new(pool, variant_store)
            .with_dev_auth(true)
            .with_variant_limits(variant_limits),
    );
    let (variant_token, _) =
        create_media_upload_account_session(&variant_app, "variant-limit").await;
    let rejected = post_media_upload(
        &variant_app,
        Some(&variant_token),
        "image/png",
        media_upload_png(1, 1),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(media_blob_entry_count(variant_root.path()), 0);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn role_pm_media_reloads_transfers_and_denies_stale_outgoing_session(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app =
        api::router_with_state(ApiState::new(pool.clone(), store.clone()).with_dev_auth(true));
    let (outgoing_token, outgoing_principal) =
        create_media_upload_account_session(&app, "private-post-member").await;
    let (incoming_token, incoming_principal) =
        create_media_upload_account_session(&app, "private-post-incoming").await;
    let (outsider_token, _) =
        create_media_upload_account_session(&app, "private-post-nonmember").await;
    let game = Uuid::new_v4();
    let channel_id = domain::role_pm_channel_id("slot_1");

    for (id, principal, command) in [
        (
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        ),
        (
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        ),
        (
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: outgoing_principal.clone(),
            },
        ),
        (
            4,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            5,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }
    let members = projections::private_channel_members(&pool, game)
        .await
        .unwrap();
    assert!(members.iter().any(|member| {
        member.channel_id == channel_id
            && member.kind == "RolePm"
            && member.slot_id == "slot_1"
            && member.source == "engine.role_pm"
    }));

    let upload = post_media_upload(
        &app,
        Some(&outgoing_token),
        "image/png",
        media_upload_png(300, 225),
    )
    .await;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(upload.into_body(), usize::MAX).await.unwrap()).unwrap();

    expect_ack(
        post_command(
            app.clone(),
            6,
            outgoing_principal.as_str(),
            Command::SubmitPost {
                game,
                channel_id: channel_id.clone(),
                actor_slot: "slot_1".into(),
                body: "private uploaded image".into(),
                media: Some(vec![SubmitPostMedia {
                    content_id: upload.content_id.clone(),
                    alt: "Private uploaded receipt".into(),
                }]),
            },
        )
        .await,
    );
    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' ORDER BY seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(payload["media"][0]["content_id"], upload.content_id);
    assert_eq!(payload["media"][0]["alt"], "Private uploaded receipt");
    assert_eq!(
        payload["media"][0]["variants"].as_object().unwrap().len(),
        3
    );
    assert!(payload["media"][0].get("url").is_none());
    assert!(payload["media"][0].get("kind").is_none());

    let missing_handle = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    let rejected = post_command(
        app.clone(),
        7,
        outgoing_principal.as_str(),
        Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: "slot_1".into(),
            body: "missing media must not post".into(),
            media: Some(vec![SubmitPostMedia {
                content_id: missing_handle.into(),
                alt: "Missing image".into(),
            }]),
        },
    )
    .await;
    expect_reject(rejected, RejectCode::InvalidTarget);

    expect_ack(
        post_command(
            app.clone(),
            8,
            "host_h",
            Command::ProcessReplacement {
                game,
                slot: "slot_1".into(),
                outgoing_user: outgoing_principal.clone(),
                incoming_user: incoming_principal.clone(),
            },
        )
        .await,
    );
    expect_reject(
        post_command(
            app.clone(),
            9,
            outgoing_principal.as_str(),
            Command::SubmitPost {
                game,
                channel_id: channel_id.clone(),
                actor_slot: "slot_1".into(),
                body: "stale outgoing Role PM post".into(),
                media: None,
            },
        )
        .await,
        RejectCode::NotYourSlot,
    );
    drop(app);
    drop(store);
    let restarted = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router(pool.clone(), restarted);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id={incoming_principal}&channel={channel_id}"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    let initial_role_pm = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 1
                        && delta.posts[0].body == "private uploaded image"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("incoming replacement should hydrate the transferred Role PM thread");

    expect_ack(
        post_command(
            app.clone(),
            10,
            incoming_principal.as_str(),
            Command::SubmitPost {
                game,
                channel_id: channel_id.clone(),
                actor_slot: "slot_1".into(),
                body: "incoming Role PM post".into(),
                media: None,
            },
        )
        .await,
    );
    let live_role_pm = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.iter().any(|post| post.body == "incoming Role PM post")
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("incoming Role PM post should publish a capability-filtered live thread delta");
    assert!(live_role_pm.id > initial_role_pm.id);

    let (mut stale_socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id={outgoing_principal}&channel={channel_id}"
    ))
    .await
    .unwrap();
    let stale_hello = stale_socket.next().await.unwrap().unwrap();
    let stale_hello: ServerEnvelope =
        serde_json::from_str(&stale_hello.into_text().unwrap()).unwrap();
    assert!(matches!(stale_hello.body, ServerMsg::Hello(_)));
    let stale_thread = tokio::time::timeout(std::time::Duration::from_millis(500), async {
        loop {
            let frame = stale_socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(_))
            ) {
                return envelope;
            }
        }
    })
    .await;
    assert!(
        stale_thread.is_err(),
        "the replaced principal must not receive Role PM rows on websocket hydration"
    );
    drop(socket);
    drop(stale_socket);
    server.abort();

    let thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/{channel_id}/thread?principal_user_id={incoming_principal}&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(thread.status(), StatusCode::OK);
    let thread: ThreadPage =
        serde_json::from_slice(&to_bytes(thread.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(thread.posts.len(), 2);
    assert_eq!(thread.posts[0].body, "private uploaded image");
    assert_eq!(thread.posts[1].body, "incoming Role PM post");
    assert_eq!(thread.posts[0].media.len(), 1);
    let media = &thread.posts[0].media[0];
    assert_eq!(media.content_id, upload.content_id);
    assert_eq!(media.alt, "Private uploaded receipt");
    assert_eq!(media.variants.len(), 3);
    let tablet = media.variants.get("tablet").unwrap();
    assert_eq!((tablet.width, tablet.height), (300, 225));
    assert!(tablet.avif_url.ends_with("/tablet.avif"));
    assert!(tablet.webp_url.ends_with("/tablet.webp"));

    let served = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(tablet.avif_url.as_str())
                .header("authorization", format!("Bearer {incoming_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(served.headers()["content-type"], "image/avif");
    assert_eq!(
        served.headers()["x-fmarch-media-content-address"],
        upload.content_id
    );
    assert_eq!(
        served.headers()["x-fmarch-media-channel"],
        channel_id.as_str()
    );
    assert_eq!(served.headers()["x-fmarch-media-variant"], "tablet");
    assert_eq!(served.headers()["x-fmarch-media-format"], "avif");
    assert_eq!(served.headers()["cache-control"], "private, no-cache");
    let etag = served.headers()["etag"].to_str().unwrap().to_string();
    assert!(!to_bytes(served.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());

    let not_modified = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(tablet.avif_url.as_str())
                .header("authorization", format!("Bearer {incoming_token}"))
                .header("if-none-match", etag.as_str())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(not_modified.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(not_modified.headers()["etag"], etag);
    assert!(to_bytes(not_modified.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());

    let stale_thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/{channel_id}/thread?principal_user_id={outgoing_principal}&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_thread.status(), StatusCode::FORBIDDEN);

    let stale_media = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(tablet.avif_url.as_str())
                .header("authorization", format!("Bearer {outgoing_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_media.status(), StatusCode::FORBIDDEN);
    assert_ne!(stale_media.headers()["content-type"], "image/avif");
    let stale_media_reject: RejectMsg =
        serde_json::from_slice(&to_bytes(stale_media.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert_eq!(stale_media_reject.error, RejectCode::NotAuthorized);

    let denied = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(tablet.avif_url.as_str())
                .header("authorization", format!("Bearer {outsider_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_ne!(denied.headers()["content-type"], "image/avif");
    let denied_reject: RejectMsg =
        serde_json::from_slice(&to_bytes(denied.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(denied_reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn mason_neighbor_rooms_encrypt_reload_transfer_and_deny_nonmembers(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(ApiState::new(pool.clone(), store).with_dev_auth(true));
    let (mason_outgoing_token, mason_outgoing) =
        create_media_upload_account_session(&app, "mason-outgoing").await;
    let (mason_incoming_token, mason_incoming) =
        create_media_upload_account_session(&app, "mason-incoming").await;
    let (neighbor_outgoing_token, neighbor_outgoing) =
        create_media_upload_account_session(&app, "neighbor-outgoing").await;
    let (neighbor_incoming_token, neighbor_incoming) =
        create_media_upload_account_session(&app, "neighbor-incoming").await;
    let (outsider_token, outsider) =
        create_media_upload_account_session(&app, "mason-neighbor-outsider").await;
    let game = Uuid::new_v4();

    let mut command_id = 1_u64;
    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    command_id += 1;
    for (slot, principal, role) in [
        ("mason_1", mason_outgoing.as_str(), "mason"),
        ("mason_2", "mason_peer", "mason"),
        ("neighbor_1", neighbor_outgoing.as_str(), "neighbor"),
        ("neighbor_2", "neighbor_peer", "neighbor"),
        ("outsider_1", outsider.as_str(), "vanilla_townie"),
    ] {
        for command in [
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: principal.into(),
            },
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        ] {
            expect_ack(post_command(app.clone(), command_id, "host_h", command).await);
            command_id += 1;
        }
    }
    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    command_id += 1;

    let memberships = projections::private_channel_members(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|member| {
            matches!(
                member.channel_id.as_str(),
                "private:mason" | "private:neighbor"
            )
        })
        .map(|member| {
            (
                member.channel_id,
                member.kind,
                member.slot_id,
                member.reveals_alignment,
                member.source,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        memberships,
        vec![
            (
                "private:mason".into(),
                "Mason".into(),
                "mason_1".into(),
                "Town".into(),
                "pack.private_channels.mason".into(),
            ),
            (
                "private:mason".into(),
                "Mason".into(),
                "mason_2".into(),
                "Town".into(),
                "pack.private_channels.mason".into(),
            ),
            (
                "private:neighbor".into(),
                "Neighbor".into(),
                "neighbor_1".into(),
                "None".into(),
                "pack.private_channels.neighbor".into(),
            ),
            (
                "private:neighbor".into(),
                "Neighbor".into(),
                "neighbor_2".into(),
                "None".into(),
                "pack.private_channels.neighbor".into(),
            ),
        ]
    );

    let upload = post_media_upload(
        &app,
        Some(&mason_outgoing_token),
        "image/png",
        media_upload_png(320, 240),
    )
    .await;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(upload.into_body(), usize::MAX).await.unwrap()).unwrap();

    for (principal, slot, channel, body, alt) in [
        (
            mason_outgoing.as_str(),
            "mason_1",
            "private:mason",
            "Mason history before replacement",
            "Mason private receipt",
        ),
        (
            neighbor_outgoing.as_str(),
            "neighbor_1",
            "private:neighbor",
            "Neighbor history before replacement",
            "Neighbor private receipt",
        ),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                command_id,
                principal,
                Command::SubmitPost {
                    game,
                    channel_id: channel.into(),
                    actor_slot: slot.into(),
                    body: body.into(),
                    media: Some(vec![SubmitPostMedia {
                        content_id: upload.content_id.clone(),
                        alt: alt.into(),
                    }]),
                },
            )
            .await,
        );
        command_id += 1;
    }

    let stored_private_posts = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' \
         AND payload->>'channel_id' IN ('private:mason', 'private:neighbor') ORDER BY stream_seq",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(stored_private_posts.len(), 2);
    for payload in &stored_private_posts {
        assert!(payload.get("body").is_none());
        assert!(payload["body_private"]["ciphertext"].is_string());
        assert_eq!(payload["media"][0]["content_id"], upload.content_id);
    }

    for (slot, outgoing, incoming) in [
        ("mason_1", mason_outgoing.as_str(), mason_incoming.as_str()),
        (
            "neighbor_1",
            neighbor_outgoing.as_str(),
            neighbor_incoming.as_str(),
        ),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                command_id,
                "host_h",
                Command::ProcessReplacement {
                    game,
                    slot: slot.into(),
                    outgoing_user: outgoing.into(),
                    incoming_user: incoming.into(),
                },
            )
            .await,
        );
        command_id += 1;
    }

    for (principal, slot, channel) in [
        (mason_outgoing.as_str(), "mason_1", "private:mason"),
        (neighbor_outgoing.as_str(), "neighbor_1", "private:neighbor"),
    ] {
        expect_reject(
            post_command(
                app.clone(),
                command_id,
                principal,
                Command::SubmitPost {
                    game,
                    channel_id: channel.into(),
                    actor_slot: slot.into(),
                    body: "stale outgoing room post".into(),
                    media: None,
                },
            )
            .await,
            RejectCode::NotYourSlot,
        );
        command_id += 1;
    }

    for (principal, slot, channel, body) in [
        (
            mason_incoming.as_str(),
            "mason_1",
            "private:mason",
            "Incoming Mason continued the room",
        ),
        (
            neighbor_incoming.as_str(),
            "neighbor_1",
            "private:neighbor",
            "Incoming Neighbor continued the room",
        ),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                command_id,
                principal,
                Command::SubmitPost {
                    game,
                    channel_id: channel.into(),
                    actor_slot: slot.into(),
                    body: body.into(),
                    media: None,
                },
            )
            .await,
        );
        command_id += 1;
    }

    let room_cases = [
        (
            "private:mason",
            mason_incoming.as_str(),
            mason_incoming_token.as_str(),
            mason_outgoing.as_str(),
            mason_outgoing_token.as_str(),
            "Mason history before replacement",
            "Incoming Mason continued the room",
        ),
        (
            "private:neighbor",
            neighbor_incoming.as_str(),
            neighbor_incoming_token.as_str(),
            neighbor_outgoing.as_str(),
            neighbor_outgoing_token.as_str(),
            "Neighbor history before replacement",
            "Incoming Neighbor continued the room",
        ),
    ];
    let mut rebuilt_bodies = Vec::new();
    for (
        channel,
        incoming,
        incoming_token,
        outgoing,
        outgoing_token,
        history_body,
        incoming_body,
    ) in room_cases
    {
        let thread = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/channels/{channel}/thread?principal_user_id={incoming}&limit=10"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(thread.status(), StatusCode::OK);
        let thread: ThreadPage =
            serde_json::from_slice(&to_bytes(thread.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(
            thread
                .posts
                .iter()
                .map(|post| post.body.as_str())
                .collect::<Vec<_>>(),
            vec![history_body, incoming_body],
        );
        assert!(thread.posts.iter().all(|post| post.channel_id == channel));
        let media_url = thread.posts[0].media[0]
            .variants
            .get("tablet")
            .unwrap()
            .avif_url
            .clone();
        rebuilt_bodies.push((
            channel.to_string(),
            incoming.to_string(),
            thread.posts.clone(),
        ));

        let allowed_media = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(media_url.as_str())
                    .header("authorization", format!("Bearer {incoming_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed_media.status(), StatusCode::OK);
        assert_eq!(allowed_media.headers()["content-type"], "image/avif");
        assert!(!to_bytes(allowed_media.into_body(), usize::MAX)
            .await
            .unwrap()
            .is_empty());

        for (denied_principal, denied_token) in [
            (outgoing, outgoing_token),
            (outsider.as_str(), outsider_token.as_str()),
        ] {
            let denied_thread = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("GET")
                        .uri(format!(
                            "/games/{game}/channels/{channel}/thread?principal_user_id={denied_principal}"
                        ))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(denied_thread.status(), StatusCode::FORBIDDEN);

            let denied_media = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("GET")
                        .uri(media_url.as_str())
                        .header("authorization", format!("Bearer {denied_token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(denied_media.status(), StatusCode::FORBIDDEN);
            assert_ne!(denied_media.headers()["content-type"], "image/avif");
        }
    }

    for channel in ["private:mason", "private:neighbor"] {
        expect_reject(
            post_command(
                app.clone(),
                command_id,
                outsider.as_str(),
                Command::SubmitPost {
                    game,
                    channel_id: channel.into(),
                    actor_slot: "outsider_1".into(),
                    body: "outsider room post".into(),
                    media: None,
                },
            )
            .await,
            RejectCode::NotAuthorized,
        );
        command_id += 1;
    }

    projections::rebuild(&pool, game).await.unwrap();
    for (channel, incoming, before) in rebuilt_bodies {
        let rebuilt = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/channels/{channel}/thread?principal_user_id={incoming}&limit=10"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rebuilt.status(), StatusCode::OK);
        let rebuilt: ThreadPage =
            serde_json::from_slice(&to_bytes(rebuilt.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(
            rebuilt.posts, before,
            "{channel} history and canonical media must survive projection rebuild",
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dead_chat_lifecycle_encrypts_streams_transfers_and_revokes(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(ApiState::new(pool.clone(), store).with_dev_auth(true));
    let (outgoing_token, outgoing) =
        create_media_upload_account_session(&app, "dead-chat-outgoing").await;
    let (incoming_token, incoming) =
        create_media_upload_account_session(&app, "dead-chat-incoming").await;
    let (living_token, living) =
        create_media_upload_account_session(&app, "dead-chat-living").await;
    let game = Uuid::new_v4();
    let dead_slot = "dead_slot";
    let living_slot = "living_slot";
    let mut command_id = 1_u64;

    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    command_id += 1;
    for (slot, principal) in [
        (dead_slot, outgoing.as_str()),
        (living_slot, living.as_str()),
    ] {
        for command in [
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
            Command::AssignSlot {
                game,
                slot: slot.into(),
                user: principal.into(),
            },
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: "vanilla_townie".into(),
            },
        ] {
            expect_ack(post_command(app.clone(), command_id, "host_h", command).await);
            command_id += 1;
        }
    }
    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    command_id += 1;

    let before_death = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/dead/thread?principal_user_id={outgoing}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(before_death.status(), StatusCode::FORBIDDEN);
    expect_reject(
        post_command(
            app.clone(),
            command_id,
            outgoing.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "alive dead-chat attempt".into(),
                media: None,
            },
        )
        .await,
        RejectCode::NotAuthorized,
    );
    command_id += 1;

    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::SetSlotStatus {
                game,
                slot: dead_slot.into(),
                status: SlotLifecycle::Dead,
            },
        )
        .await,
    );
    command_id += 1;

    let upload = post_media_upload(
        &app,
        Some(&outgoing_token),
        "image/png",
        media_upload_png(360, 240),
    )
    .await;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(upload.into_body(), usize::MAX).await.unwrap()).unwrap();
    expect_ack(
        post_command(
            app.clone(),
            command_id,
            outgoing.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "dead history with canonical media".into(),
                media: Some(vec![SubmitPostMedia {
                    content_id: upload.content_id.clone(),
                    alt: "Dead-chat receipt".into(),
                }]),
            },
        )
        .await,
    );
    command_id += 1;

    let stored: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' \
         AND payload->>'channel_id' = 'dead' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(stored.get("body").is_none());
    assert!(stored["body_private"]["ciphertext"].is_string());
    assert_eq!(stored["media"][0]["content_id"], upload.content_id);

    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::ProcessReplacement {
                game,
                slot: dead_slot.into(),
                outgoing_user: outgoing.clone(),
                incoming_user: incoming.clone(),
            },
        )
        .await,
    );
    command_id += 1;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id={incoming}&channel=dead"
    ))
    .await
    .unwrap();
    let hello: ServerEnvelope =
        serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    let initial_dead_chat = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 1
                        && delta.posts[0].channel_id == "dead"
                        && delta.posts[0].body == "dead history with canonical media"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("incoming dead occupant receives channel-scoped initial delta");

    expect_ack(
        post_command(
            app.clone(),
            command_id,
            incoming.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "incoming dead-chat live delta".into(),
                media: None,
            },
        )
        .await,
    );
    command_id += 1;
    let live_dead_chat = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 2
                        && delta.posts.iter().all(|post| post.channel_id == "dead")
                        && delta.posts[1].body == "incoming dead-chat live delta"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("dead-chat command publishes a channel-scoped live delta");
    assert!(live_dead_chat.id > initial_dead_chat.id);

    let thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/dead/thread?principal_user_id={incoming}&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(thread.status(), StatusCode::OK);
    let thread: ThreadPage =
        serde_json::from_slice(&to_bytes(thread.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(
        thread
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec![
            "dead history with canonical media",
            "incoming dead-chat live delta"
        ],
    );
    assert!(thread.posts.iter().all(|post| post.channel_id == "dead"));
    let media_url = thread.posts[0].media[0]
        .variants
        .get("tablet")
        .unwrap()
        .avif_url
        .clone();
    let allowed_media = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(media_url.as_str())
                .header("authorization", format!("Bearer {incoming_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed_media.status(), StatusCode::OK);
    assert_eq!(allowed_media.headers()["content-type"], "image/avif");
    assert!(!to_bytes(allowed_media.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());

    for (principal, token, slot, expected_append_reject) in [
        (
            outgoing.as_str(),
            outgoing_token.as_str(),
            dead_slot,
            RejectCode::NotYourSlot,
        ),
        (
            living.as_str(),
            living_token.as_str(),
            living_slot,
            RejectCode::NotAuthorized,
        ),
    ] {
        let denied_thread = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/channels/dead/thread?principal_user_id={principal}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied_thread.status(), StatusCode::FORBIDDEN);
        let denied_media = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(media_url.as_str())
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied_media.status(), StatusCode::FORBIDDEN);
        assert_ne!(denied_media.headers()["content-type"], "image/avif");
        expect_reject(
            post_command(
                app.clone(),
                command_id,
                principal,
                Command::SubmitPost {
                    game,
                    channel_id: "dead".into(),
                    actor_slot: slot.into(),
                    body: "denied dead-chat append".into(),
                    media: None,
                },
            )
            .await,
            expected_append_reject,
        );
        command_id += 1;
    }

    let before_rebuild = projections::thread_view_for_channel(&pool, game, "dead", None, 10)
        .await
        .unwrap();
    projections::rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::thread_view_for_channel(&pool, game, "dead", None, 10)
            .await
            .unwrap()
            .posts,
        before_rebuild.posts,
        "dead-chat text and canonical media survive projection rebuild",
    );

    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::SetSlotStatus {
                game,
                slot: dead_slot.into(),
                status: SlotLifecycle::Alive,
            },
        )
        .await,
    );
    command_id += 1;
    let restored_thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/dead/thread?principal_user_id={incoming}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(restored_thread.status(), StatusCode::FORBIDDEN);
    let restored_media = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(media_url.as_str())
                .header("authorization", format!("Bearer {incoming_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(restored_media.status(), StatusCode::FORBIDDEN);
    assert_ne!(restored_media.headers()["content-type"], "image/avif");
    expect_reject(
        post_command(
            app,
            command_id,
            incoming.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "dead".into(),
                actor_slot: dead_slot.into(),
                body: "restored-alive dead-chat append".into(),
                media: None,
            },
        )
        .await,
        RejectCode::NotAuthorized,
    );

    drop(socket);
    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn spectator_room_grant_reads_host_notices_and_revokes(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(ApiState::new(pool.clone(), store).with_dev_auth(true));
    let (spectator_token, spectator) =
        create_media_upload_account_session(&app, "spectator-room").await;
    let game = Uuid::new_v4();

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
    let before_grant = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/spectator/thread?principal_user_id={spectator}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(before_grant.status(), StatusCode::FORBIDDEN);
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::GrantSpectator {
                game,
                user: spectator.clone(),
            },
        )
        .await,
    );
    expect_reject(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::GrantSpectator {
                game,
                user: spectator.clone(),
            },
        )
        .await,
        RejectCode::InvalidTarget,
    );

    let upload = post_media_upload(
        &app,
        Some(&spectator_token),
        "image/png",
        media_upload_png(32, 32),
    )
    .await;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(upload.into_body(), usize::MAX).await.unwrap()).unwrap();
    let content_id = upload.content_id.clone();
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::PublishSpectatorPost {
                game,
                body: "Host notice for the spectator room".into(),
                media: Some(vec![SubmitPostMedia {
                    content_id: content_id.clone(),
                    alt: "Spectator notice receipt".into(),
                }]),
            },
        )
        .await,
    );

    let stored: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' \
         AND payload->>'channel_id' = 'spectator' ORDER BY stream_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(stored.get("body").is_none());
    assert!(stored["body_private"]["ciphertext"].is_string());
    assert!(!stored
        .to_string()
        .contains("Host notice for the spectator room"));
    assert_eq!(stored["media"][0]["content_id"], content_id);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id={spectator}&channel=spectator"
    ))
    .await
    .unwrap();
    let hello: ServerEnvelope =
        serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    let initial_spectator = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 1
                        && delta.posts[0].channel_id == "spectator"
                        && delta.posts[0].body == "Host notice for the spectator room"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("spectator websocket receives a channel-scoped initial delta");

    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::PublishSpectatorPost {
                game,
                body: "Live spectator notice".into(),
                media: None,
            },
        )
        .await,
    );
    let live_spectator = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 2
                        && delta.posts.iter().all(|post| post.channel_id == "spectator")
                        && delta.posts[1].body == "Live spectator notice"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host publication produces a channel-scoped spectator live delta");
    assert!(live_spectator.id > initial_spectator.id);

    let thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/spectator/thread?principal_user_id={spectator}&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(thread.status(), StatusCode::OK);
    let thread: ThreadPage =
        serde_json::from_slice(&to_bytes(thread.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(thread.posts.len(), 2);
    assert!(thread
        .posts
        .iter()
        .all(|post| post.channel_id == "spectator"));
    assert!(thread
        .posts
        .iter()
        .all(|post| post.author_user.as_deref() == Some("host")));
    assert_eq!(thread.posts[0].body, "Host notice for the spectator room");
    assert_eq!(thread.posts[1].body, "Live spectator notice");
    let media_url = thread.posts[0].media[0]
        .variants
        .get("tablet")
        .unwrap()
        .avif_url
        .clone();
    let allowed_media = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(media_url.as_str())
                .header("authorization", format!("Bearer {spectator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed_media.status(), StatusCode::OK);
    assert_eq!(allowed_media.headers()["content-type"], "image/avif");
    assert!(!to_bytes(allowed_media.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());

    for path in [
        format!("/games/{game}/channels/dead/thread?principal_user_id={spectator}"),
        format!(
            "/games/{game}/channels/private:role_pm:slot_1/thread?principal_user_id={spectator}"
        ),
        format!(
            "/games/{game}/channels/private:mafia_day_chat/thread?principal_user_id={spectator}"
        ),
        format!("/games/{game}/notifications?principal_user_id={spectator}"),
        format!("/games/{game}/investigation-results?principal_user_id={spectator}"),
        format!("/games/{game}/player-command-state?principal_user_id={spectator}"),
    ] {
        let denied = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    }
    expect_reject(
        post_command(
            app.clone(),
            6,
            spectator.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "spectator".into(),
                actor_slot: "invented-slot".into(),
                body: "spectator append attempt".into(),
                media: None,
            },
        )
        .await,
        RejectCode::NotAuthorized,
    );

    projections::rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::spectator_memberships(&pool, game)
            .await
            .unwrap()
            .len(),
        1,
        "the explicit spectator grant survives rebuild"
    );
    assert_eq!(
        projections::thread_view_for_channel(&pool, game, "spectator", None, 10)
            .await
            .unwrap()
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Host notice for the spectator room",
            "Live spectator notice"
        ],
        "encrypted spectator history and media references survive rebuild",
    );
    expect_ack(
        post_command(
            app.clone(),
            7,
            "host_h",
            Command::RevokeSpectator {
                game,
                user: spectator.clone(),
            },
        )
        .await,
    );
    let revoked_thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/spectator/thread?principal_user_id={spectator}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked_thread.status(), StatusCode::FORBIDDEN);
    let revoked_media = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(media_url.as_str())
                .header("authorization", format!("Bearer {spectator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked_media.status(), StatusCode::FORBIDDEN);
    assert_ne!(revoked_media.headers()["content-type"], "image/avif");
    let revoked_media_reject: RejectMsg = serde_json::from_slice(
        &to_bytes(revoked_media.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(revoked_media_reject.error, RejectCode::NotAuthorized);
    expect_reject(
        post_command(
            app.clone(),
            8,
            spectator.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "spectator".into(),
                actor_slot: "invented-slot".into(),
                body: "revoked spectator append attempt".into(),
                media: None,
            },
        )
        .await,
        RejectCode::NotAuthorized,
    );
    expect_ack(
        post_command(
            app,
            9,
            "host_h",
            Command::PublishSpectatorPost {
                game,
                body: "Notice after revocation".into(),
                media: None,
            },
        )
        .await,
    );
    let revoked_live = tokio::time::timeout(std::time::Duration::from_millis(500), async {
        loop {
            let envelope: ServerEnvelope =
                serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(_))
            ) {
                return envelope;
            }
        }
    })
    .await;
    assert!(
        revoked_live.is_err(),
        "revoked spectator receives no thread rows from later host publications",
    );
    drop(socket);
    server.abort();
}

fn stable_command_id(id: u64) -> Uuid {
    Uuid::from_u128(id as u128)
}

fn command_envelope_with_command_id(
    id: u64,
    command_id: Uuid,
    principal_user_id: &str,
    command: Command,
) -> ClientEnvelope {
    ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id,
            principal_user_id: principal_user_id.to_string(),
            command,
        }),
    )
}

async fn post_command(
    app: axum::Router,
    id: u64,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    post_command_with_command_id(app, id, stable_command_id(id), principal_user_id, command).await
}

async fn post_command_with_command_id(
    app: axum::Router,
    id: u64,
    command_id: Uuid,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    let body = serde_json::to_vec(&command_envelope_with_command_id(
        id,
        command_id,
        principal_user_id,
        command,
    ))
    .unwrap();
    let response = app
        .clone()
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

fn expect_ack(envelope: ServerEnvelope) -> Vec<i64> {
    match envelope.body {
        ServerMsg::Ack(ack) => {
            assert!(!ack.stream_seqs.is_empty());
            ack.stream_seqs
        }
        other => panic!("expected Ack, got {other:?}"),
    }
}

fn expect_reject(envelope: ServerEnvelope, expected: RejectCode) {
    match envelope.body {
        ServerMsg::Reject(reject) => assert_eq!(reject.error, expected),
        other => panic!("expected Reject({expected:?}), got {other:?}"),
    }
}

async fn seed_single_vote_game(app: axum::Router, game: Uuid) {
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
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_2".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_3".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            6,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            7,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_2".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            8,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_3".into(),
                user: "user_b".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            9,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_3".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            10,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app,
            11,
            "user_a",
            Command::SubmitVote {
                game,
                actor_slot: "slot_1".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await,
    );
}

async fn seed_beloved_princess_ready_to_resolve(app: axum::Router, game: Uuid) {
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
    for (base, slot, user_id, role) in [
        (10, "slot_1", "user_1", "beloved_princess"),
        (20, "slot_2", "user_2", "vanilla_townie"),
        (30, "slot_3", "user_3", "vanilla_townie"),
        (40, "slot_4", "user_4", "mafia_goon"),
        (50, "slot_5", "user_5", "mafia_goon"),
        (60, "slot_6", "user_6", "vanilla_townie"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                base,
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
                base + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user_id.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                base + 2,
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
            80,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    for (id, user, actor_slot) in [
        (81, "user_2", "slot_2"),
        (82, "user_3", "slot_3"),
        (83, "user_4", "slot_4"),
        (84, "user_5", "slot_5"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::Slot("slot_1".into()),
                },
            )
            .await,
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_command_boundary_updates_votecount(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/votecount"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let deltas: Vec<ProjectionDelta> = serde_json::from_slice(&bytes).unwrap();

    assert!(deltas.iter().any(|delta| matches!(
        delta,
        ProjectionDelta::VoteCountChanged(v)
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 1
    )));
}

async fn get_endgame_summary(app: axum::Router, game: Uuid) -> api::EndgameSummaryResponse {
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/endgame-summary"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn endgame_summary_reveals_winner_only_after_terminal_win(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "default_open".into(),
            },
        )
        .await,
    );
    for (base, slot, user_id, role) in [
        (10, "slot_1", "user_1", "citizen"),
        (20, "slot_2", "user_2", "agent"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                base,
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
                base + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user_id.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                base + 2,
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
            30,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    let ongoing = get_endgame_summary(app.clone(), game).await;
    assert_eq!(ongoing.game, game);
    assert!(
        !ongoing.completed,
        "endgame summary must not report completion mid-game"
    );
    assert!(
        ongoing.winner.is_none(),
        "winner fact must be absent before the terminal WinReached"
    );
    assert_eq!(ongoing.slots.len(), 2);
    assert!(
        ongoing.vote_history.is_empty(),
        "vote history must stay absent before host completion"
    );
    assert!(
        ongoing.slots.iter().all(|slot| slot.role_key.is_none()
            && slot.alignment.is_none()
            && !slot.role_revealed
            && !slot.alignment_revealed),
        "per-slot role facts must stay reveal-gated mid-game: {:?}",
        ongoing.slots
    );

    expect_ack(
        post_command(
            app.clone(),
            40,
            "user_2",
            Command::SubmitAction {
                game,
                action_id: "agent_kills_last_town_n01".into(),
                actor_slot: "slot_2".into(),
                template_id: "agent_kill".into(),
                targets: vec!["slot_1".into()],
                grant_id: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            41,
            "host_h",
            Command::ResolvePhase { game, seed: 9911 },
        )
        .await,
    );

    let won = get_endgame_summary(app.clone(), game).await;
    let winner = won
        .winner
        .expect("terminal WinReached must fold the winner fact into the summary");
    assert_eq!(winner.alignment, "mafia");
    assert!(
        winner.reason.contains("reaches parity"),
        "winner reason carries the engine's win reason: {}",
        winner.reason
    );
    assert_eq!(winner.phase_id, "N01");
    assert!(
        !won.completed,
        "the engine win is not the host's GameCompleted fact"
    );
    assert!(
        won.slots
            .iter()
            .all(|slot| slot.role_revealed && slot.alignment_revealed),
        "WinReached must flip every slot's reveal flags: {:?}",
        won.slots
    );
    let citizen = won
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("citizen slot in summary");
    assert!(!citizen.alive, "the night kill folds into the summary");
    assert_eq!(citizen.role_key.as_deref(), Some("citizen"));
    assert_eq!(citizen.alignment.as_deref(), Some("town"));
    let agent = won
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_2")
        .expect("agent slot in summary");
    assert!(agent.alive);
    assert_eq!(agent.role_key.as_deref(), Some("agent"));
    assert_eq!(agent.alignment.as_deref(), Some("mafia"));

    expect_ack(post_command(app.clone(), 42, "host_h", Command::CompleteGame { game }).await);
    let completed = get_endgame_summary(app, game).await;
    assert!(
        completed.completed,
        "CompleteGame must flip the endgame summary's completed fact"
    );
    assert!(
        completed.winner.is_some(),
        "the winner fact must survive completion"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn endgame_summary_reveals_vote_history_only_after_completion(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    expect_ack(
        post_command(
            app.clone(),
            12,
            "host_h",
            Command::ResolvePhase { game, seed: 8812 },
        )
        .await,
    );
    let resolved = get_endgame_summary(app.clone(), game).await;
    assert!(!resolved.completed);
    assert!(
        resolved.vote_history.is_empty(),
        "resolved ballots must remain outside the endgame summary before CompleteGame"
    );

    expect_ack(post_command(app.clone(), 13, "host_h", Command::CompleteGame { game }).await);
    let completed = get_endgame_summary(app, game).await;
    assert!(completed.completed);
    assert_eq!(completed.vote_history.len(), 1);
    let day_one = &completed.vote_history[0];
    assert_eq!(day_one.phase_id, "D01");
    assert_eq!(day_one.status, "NoMajority");
    assert_eq!(day_one.winner_slot, None);
    assert_eq!(day_one.tallies, serde_json::json!({ "slot_2": 1.0 }));
    assert_eq!(day_one.votes, serde_json::json!({ "slot_1": "slot_2" }));
    assert_eq!(day_one.majority, Some(2.0));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_can_publish_projection_derived_votecount_to_thread(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    expect_reject(
        post_command(
            app.clone(),
            12,
            "user_a",
            Command::PublishVotecount { game },
        )
        .await,
        RejectCode::NotHost,
    );
    expect_ack(
        post_command(
            app.clone(),
            13,
            "host_h",
            Command::PublishVotecount { game },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    let official = page
        .posts
        .iter()
        .find(|post| post.body.starts_with("Official votecount for D01"))
        .expect("official votecount post");

    assert_eq!(official.author_user.as_deref(), Some("host"));
    assert_eq!(official.author_slot, None);
    assert!(official.body.contains("- slot_2: 1"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_setup_sequence_commits_to_setup_state(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    for (id, command) in [
        (
            1,
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        ),
        (
            2,
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        ),
        (
            3,
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "player_mira".into(),
            },
        ),
        (
            4,
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            5,
            Command::SetPostPolicy {
                game,
                channel_id: "main".into(),
                allow_media_only: true,
            },
        ),
        (
            6,
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, "host_h", command).await);
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/setup-state?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let setup: HostSetupStateResponse = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(setup.game, game);
    assert!(setup.created);
    assert_eq!(setup.pack.key, "mafiascum");
    assert!(setup.pack.valid);
    assert!(setup.pack.role_keys.contains(&"vanilla_townie".to_string()));
    assert!(setup.pack.start_phase_options.contains(&"D01".to_string()));
    assert_eq!(setup.slots.len(), 1);
    assert_eq!(setup.slots[0].slot_id, "slot_1");
    assert_eq!(
        setup.slots[0].occupant_user_id.as_deref(),
        Some("player_mira")
    );
    assert_eq!(setup.slots[0].role_key.as_deref(), Some("vanilla_townie"));
    assert_eq!(setup.post_policies.len(), 1);
    assert_eq!(setup.post_policies[0].channel_id, "main");
    assert!(setup.post_policies[0].allow_media_only);
    assert_eq!(
        setup.phase.as_ref().map(|phase| phase.phase_id.as_str()),
        Some("D01")
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn player_command_state_derives_phase_valid_role_actions(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    for (id, principal, command) in [
        (
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        ),
        (
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_4".into(),
            },
        ),
        (
            3,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot-2".into(),
            },
        ),
        (
            4,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot-3".into(),
            },
        ),
        (
            5,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_4".into(),
                user: "action-goon".into(),
            },
        ),
        (
            6,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_4".into(),
                role_key: "mafia_goon".into(),
            },
        ),
        (
            7,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot-2".into(),
                user: "action-target".into(),
            },
        ),
        (
            8,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot-2".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            9,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot-3".into(),
                user: "action-town".into(),
            },
        ),
        (
            10,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot-3".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            11,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-goon&slot_id=slot_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["actor_slot"], "slot_4");
    assert_eq!(state["actor_alive"], true);
    assert_eq!(state["actor_status"], "alive");
    assert_eq!(state["role_key"], "mafia_goon");
    assert_eq!(state["role"]["key"], "mafia_goon");
    assert_eq!(state["role"]["alignment"], "mafia");
    assert!(state["role"]["description"]
        .as_str()
        .unwrap()
        .contains("factional kill"));
    assert_eq!(state["phase"]["phase_id"], "N01");
    assert_eq!(state["phase"]["phase_kind"], "Night");
    assert_eq!(state["actions"][0]["template_id"], "factional_kill");
    assert_eq!(
        state["actions"][0]["targets"],
        serde_json::json!(["slot-2"])
    );
    assert_eq!(
        state["actions"][0]["target_options"],
        serde_json::json!(["slot-2", "slot-3"])
    );
    assert!(state["boundary"]
        .as_str()
        .unwrap()
        .contains("Final command validation"));
    assert_eq!(state["current_actions"], serde_json::json!([]));

    expect_ack(
        post_command(
            app.clone(),
            12,
            "action-goon",
            Command::SubmitAction {
                game,
                action_id: "role_factional_kill".into(),
                actor_slot: "slot_4".into(),
                template_id: "factional_kill".into(),
                targets: vec!["slot-2".into()],
                grant_id: None,
            },
        )
        .await,
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-goon&slot_id=slot_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let submitted_state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(submitted_state["phase"]["phase_id"], "N01");
    assert_eq!(submitted_state["actor_alive"], true);
    assert_eq!(submitted_state["actor_status"], "alive");
    assert_eq!(submitted_state["actions"], serde_json::json!([]));
    // current_actions surfaces the submitted night action with its chosen target
    // (slice 2). factional_kill is filtered out of `actions` once submitted, so
    // the client renders and withdraws it from current_actions.
    assert_eq!(
        submitted_state["current_actions"],
        serde_json::json!([{
            "action_id": "role_factional_kill",
            "template_id": "factional_kill",
            "targets": ["slot-2"],
            "grant_id": null
        }])
    );

    // Withdrawing clears current_actions and restores factional_kill to `actions`.
    expect_ack(
        post_command(
            app.clone(),
            13,
            "action-goon",
            Command::WithdrawAction {
                game,
                action_id: "role_factional_kill".into(),
                actor_slot: "slot_4".into(),
            },
        )
        .await,
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-goon&slot_id=slot_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let withdrawn_state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(withdrawn_state["current_actions"], serde_json::json!([]));
    assert_eq!(
        withdrawn_state["actions"][0]["template_id"],
        "factional_kill"
    );

    // Re-submit so the night kill still resolves for the rest of the scenario.
    expect_ack(
        post_command(
            app.clone(),
            14,
            "action-goon",
            Command::SubmitAction {
                game,
                action_id: "role_factional_kill".into(),
                actor_slot: "slot_4".into(),
                template_id: "factional_kill".into(),
                targets: vec!["slot-2".into()],
                grant_id: None,
            },
        )
        .await,
    );

    expect_ack(
        post_command(
            app.clone(),
            15,
            "host_h",
            Command::ResolvePhase { game, seed: 930901 },
        )
        .await,
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=action-target"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let target_notifications: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(target_notifications.len(), 1);
    assert_eq!(target_notifications[0].audience_slot, "slot-2");
    assert_eq!(target_notifications[0].effect, "player_killed");
    assert_eq!(target_notifications[0].status, "factional_kill");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-target&slot_id=slot-2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let dead_state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(dead_state["actor_slot"], "slot-2");
    assert_eq!(dead_state["actor_alive"], false);
    assert_eq!(dead_state["actor_status"], "dead");
    assert_eq!(dead_state["actions"], serde_json::json!([]));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=action-goon"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let actor_notifications: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        actor_notifications
            .iter()
            .all(|notice| notice.effect != "player_killed"),
        "actor should not receive target-only death notice"
    );

    expect_ack(
        post_command(
            app.clone(),
            16,
            "host_h",
            Command::OpenDayPhase {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-goon&slot_id=slot_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let day_state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(day_state["phase"]["phase_id"], "D01");
    assert_eq!(day_state["actor_alive"], true);
    assert_eq!(day_state["actor_status"], "alive");
    assert_eq!(day_state["actions"], serde_json::json!([]));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-target&slot_id=slot_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotYourSlot);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn player_command_state_exposes_day_vote_targets(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    for (id, principal, command) in [
        (
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        ),
        (
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_4".into(),
            },
        ),
        (
            3,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot-2".into(),
            },
        ),
        (
            4,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot-3".into(),
            },
        ),
        (
            5,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_4".into(),
                user: "action-goon".into(),
            },
        ),
        (
            6,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_4".into(),
                role_key: "mafia_goon".into(),
            },
        ),
        (
            7,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot-2".into(),
                user: "action-target".into(),
            },
        ),
        (
            8,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot-2".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            9,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot-3".into(),
                user: "action-town".into(),
            },
        ),
        (
            10,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot-3".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            11,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-town&slot_id=slot-3"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["phase"]["phase_id"], "D01");
    assert_eq!(
        state["vote_targets"],
        serde_json::json!([
            {"kind": "slot", "slot_id": "slot-2", "label": "Slot 2"},
            {"kind": "slot", "slot_id": "slot_4", "label": "Slot 4"},
            {"kind": "no_lynch", "slot_id": null, "label": "No lynch"}
        ])
    );
    assert_eq!(state["current_vote"], serde_json::Value::Null);
    assert_eq!(state["actions"], serde_json::json!([]));

    expect_ack(
        post_command(
            app.clone(),
            12,
            "action-town",
            Command::SubmitVote {
                game,
                actor_slot: "slot-3".into(),
                target: VoteTarget::Slot("slot-2".into()),
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-town&slot_id=slot-3"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        state["current_vote"],
        serde_json::json!({"kind": "slot", "slot_id": "slot-2", "label": "Slot 2"})
    );

    expect_ack(
        post_command(
            app.clone(),
            13,
            "host_h",
            Command::SetSlotStatus {
                game,
                slot: "slot-2".into(),
                status: SlotLifecycle::Dead,
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-town&slot_id=slot-3"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["current_vote"], serde_json::Value::Null);
    assert_eq!(
        state["vote_targets"],
        serde_json::json!([
            {"kind": "slot", "slot_id": "slot_4", "label": "Slot 4"},
            {"kind": "no_lynch", "slot_id": null, "label": "No lynch"}
        ])
    );

    expect_ack(post_command(app.clone(), 14, "host_h", Command::LockThread { game }).await);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/player-command-state?principal_user_id=action-town&slot_id=slot-3"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["phase"]["locked"], true);
    assert_eq!(state["vote_targets"], serde_json::json!([]));
    assert_eq!(state["current_vote"], serde_json::Value::Null);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_sends_initial_votecount_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_a"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let delta = socket.next().await.unwrap().unwrap();
    let delta: ServerEnvelope = serde_json::from_str(&delta.into_text().unwrap()).unwrap();
    assert_eq!(delta.id, 1);
    assert!(matches!(
        delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 1
    ));

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_streams_command_following_votecount_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_b"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_delta = socket.next().await.unwrap().unwrap();
    let initial_delta: ServerEnvelope =
        serde_json::from_str(&initial_delta.into_text().unwrap()).unwrap();
    assert!(matches!(
        initial_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game && v.candidate_slot == "slot_2" && v.count == 1
    ));
    let initial_thread = socket.next().await.unwrap().unwrap();
    let initial_thread: ServerEnvelope =
        serde_json::from_str(&initial_thread.into_text().unwrap()).unwrap();
    assert_eq!(initial_thread.id, 2);
    assert!(matches!(
        initial_thread.body,
        ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(t))
            if t.game == game
    ));

    expect_ack(
        post_command(
            app,
            12,
            "user_b",
            Command::SubmitVote {
                game,
                actor_slot: "slot_3".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await,
    );

    let live_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::VoteCountChanged(ref v))
                    if v.game == game
                        && v.phase_id == "D01"
                        && v.candidate_slot == "slot_2"
                        && v.count == 2
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("game websocket should receive command-following votecount delta");
    assert!(live_delta.id >= 3);
    assert!(matches!(
        live_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 2
    ));

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_lag_requests_resync_and_keeps_streaming(pool: sqlx::PgPool) {
    let state = test_api_state(pool)
        .with_live_projection_capacity(1)
        .with_live_projection_delivery_delay(std::time::Duration::from_secs(2));
    let app = api::router_with_state(state);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_b"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    for offset in 0_u64..3 {
        expect_ack(
            post_command(
                app.clone(),
                1_000 + offset,
                "user_b",
                Command::SubmitPost {
                    game,
                    channel_id: "main".into(),
                    actor_slot: "slot_3".into(),
                    body: format!("lag burst post {offset}"),
                    media: None,
                },
            )
            .await,
        );
    }

    let resync = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ResyncRequired { from_seq: 0 })
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("capacity-one websocket should request projection resync after lag");

    let continuation_body = format!("post after lag resync {}", Uuid::new_v4());
    expect_ack(
        post_command(
            app,
            2_000,
            "user_b",
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: "slot_3".into(),
                body: continuation_body.clone(),
                media: None,
            },
        )
        .await,
    );

    let continued = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref thread))
                    if thread.posts.iter().any(|post| post.body == continuation_body)
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("websocket should keep delivering current projections after lag resync");
    assert!(continued.id > resync.id);

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_streams_votecount_clear_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_a"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_delta = socket.next().await.unwrap().unwrap();
    let initial_delta: ServerEnvelope =
        serde_json::from_str(&initial_delta.into_text().unwrap()).unwrap();
    assert!(matches!(
        initial_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game && v.candidate_slot == "slot_2" && v.count == 1
    ));
    let initial_thread = socket.next().await.unwrap().unwrap();
    let initial_thread: ServerEnvelope =
        serde_json::from_str(&initial_thread.into_text().unwrap()).unwrap();
    assert_eq!(initial_thread.id, 2);
    assert!(matches!(
        initial_thread.body,
        ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(t))
            if t.game == game
    ));

    expect_ack(
        post_command(
            app,
            12,
            "user_a",
            Command::WithdrawVote {
                game,
                actor_slot: "slot_1".into(),
            },
        )
        .await,
    );

    let live_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::VoteCountCleared(ref v))
                    if v.game == game
                        && v.phase_id == "D01"
                        && v.candidate_slot == "slot_2"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("game websocket should receive command-following votecount clear delta");
    assert!(live_delta.id >= 3);
    assert!(matches!(
        live_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountCleared(v))
            if v.game == game && v.phase_id == "D01" && v.candidate_slot == "slot_2"
    ));

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_game_connection_streams_thread_delta_after_official_votecount(
    pool: sqlx::PgPool,
) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_a"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_thread = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive initial thread projection");
    assert!(
        matches!(
            &initial_thread.body,
            ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                if delta.posts.iter().all(|post| !post.body.starts_with("Official votecount"))
        ),
        "seeded game should not already contain an official count post"
    );

    expect_ack(post_command(app, 13, "host_h", Command::PublishVotecount { game }).await);

    let thread_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.iter().any(|post|
                            post.author_user.as_deref() == Some("host")
                                && post.body.starts_with("Official votecount for D01")
                                && post.body.contains("- slot_2: 1")
                        )
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host-published official count should stream as a thread delta");
    assert!(thread_delta.id > initial_thread.id);

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_host_connection_streams_command_following_host_prompts_delta(
    pool: sqlx::PgPool,
) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_beloved_princess_ready_to_resolve(app.clone(), game).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=host_h"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_empty_prompts = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(ref delta))
                    if delta.game == game && delta.prompts.is_empty()
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host websocket should receive the initial empty prompt projection");
    assert!(
        initial_empty_prompts.id > 0,
        "initial prompt delta should be a server projection frame"
    );

    expect_ack(
        post_command(
            app,
            90,
            "host_h",
            Command::ResolvePhase { game, seed: 7421 },
        )
        .await,
    );

    let prompt_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(ref delta))
                    if delta.game == game
                        && delta.prompts.iter().any(|prompt|
                            prompt.prompt_id == "D01:skip_next_day:slot_1"
                                && prompt.kind == "skip_next_day"
                                && prompt.status == "pending"
                                && prompt.reason == "beloved_princess_death"
                        )
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host websocket should receive command-following host prompt projection");
    assert!(
        prompt_delta.id > initial_empty_prompts.id,
        "command-following prompt delta should follow the initial projection"
    );

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_player_connection_streams_scoped_private_notification_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "chinese_structured".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cupid"),
        (5, "slot_2", "user_2", "villager"),
        (8, "slot_3", "user_3", "prophet"),
        (11, "slot_4", "user_4", "wolf"),
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
            20,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            21,
            "user_1",
            Command::SubmitAction {
                game,
                action_id: "link_lovers_n01".into(),
                actor_slot: "slot_1".into(),
                template_id: "link_lovers".into(),
                targets: vec!["slot_2".into(), "slot_3".into()],
                grant_id: None,
            },
        )
        .await,
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?game={game}&principal_user_id=user_2"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_private = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::PlayerNotificationsChanged(ref delta))
                    if delta.game == game && delta.notifications.is_empty()
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive initial scoped notification projection");

    let initial_investigations = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::PlayerInvestigationResultsChanged(ref delta))
                    if delta.game == game && delta.results.is_empty()
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive initial scoped investigation projection");
    assert!(initial_investigations.id > initial_private.id);

    expect_ack(
        post_command(
            app,
            22,
            "host_h",
            Command::ResolvePhase { game, seed: 930601 },
        )
        .await,
    );

    let notification_delta = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope =
                serde_json::from_str(&frame.into_text().unwrap()).unwrap();
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::PlayerNotificationsChanged(ref delta))
                    if delta.game == game
                        && delta.notifications.iter().any(|notice|
                            notice.audience_slot == "slot_2"
                                && notice.effect == "lovers_link"
                                && notice.status == "link_lovers_n01"
                        )
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("player websocket should receive command-following scoped notification projection");
    assert!(notification_delta.id > initial_private.id);

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_day_vote_outcomes_returns_canonical_engine_result(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            11,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (idx, slot, user_id, role) in [
        (12, "slot_1", "user_1", "vanilla_townie"),
        (16, "slot_2", "user_2", "vanilla_townie"),
        (20, "slot_3", "user_3", "mafia_goon"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                idx,
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
                idx + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user_id.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                idx + 2,
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
            24,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    for (idx, user_id, actor_slot) in [(25, "user_1", "slot_1"), (26, "user_2", "slot_2")] {
        expect_ack(
            post_command(
                app.clone(),
                idx,
                user_id,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::NoLynch,
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            27,
            "host_h",
            Command::ResolvePhase { game, seed: 606 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/day-vote-outcomes"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let deltas: Vec<ProjectionDelta> = serde_json::from_slice(&bytes).unwrap();

    assert!(deltas.iter().any(|delta| matches!(
        delta,
        ProjectionDelta::DayVoteOutcomeApplied(outcome)
            if outcome.game == game
                && outcome.phase_id == "D01"
                && outcome.status == "NoLynch"
                && outcome.winner_slot.is_none()
                && outcome.tallies["no_lynch"] == serde_json::json!(2.0)
    )));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_thread_cold_load_returns_paginated_posts(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

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
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    for (id, body) in [(6, "one"), (7, "two"), (8, "three")] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "user_a",
                Command::SubmitPost {
                    game,
                    channel_id: "main".into(),
                    actor_slot: "slot_1".into(),
                    body: body.into(),
                    media: None,
                },
            )
            .await,
        );
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread?limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        page.posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["two", "three"]
    );
    assert_eq!(page.posts[0].author_slot.as_deref(), Some("slot_1"));
    let before = page.next_before_seq.expect("older page cursor");

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread?before_seq={before}&limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let older: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(older.posts.len(), 1);
    assert_eq!(older.posts[0].body, "one");
    assert_eq!(older.next_before_seq, None);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn public_game_index_cold_load_pages_only_active_and_completed_rows(pool: sqlx::PgPool) {
    let active_game = Uuid::from_u128(11);
    let completed_game = Uuid::from_u128(12);
    let setup_game = Uuid::from_u128(13);
    for (game, pack, status, phase_id, updated_seq, completed_seq) in [
        (
            active_game,
            "mafiascum",
            "active",
            Some("N01"),
            120_i64,
            None,
        ),
        (
            completed_game,
            "mafia_universe",
            "completed",
            Some("D01"),
            130_i64,
            Some(130_i64),
        ),
        (setup_game, "epicmafia", "setup", None, 140_i64, None),
    ] {
        sqlx::query(
            "INSERT INTO game_index (game_id, pack, status, phase_id, created_seq, started_seq, completed_seq, updated_seq) VALUES ($1, $2, $3, $4, 1, 2, $5, $6)",
        )
        .bind(game)
        .bind(pack)
        .bind(status)
        .bind(phase_id)
        .bind(completed_seq)
        .bind(updated_seq)
        .execute(&pool)
        .await
        .unwrap();
    }

    let app = router(pool);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/games?limit=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let latest: GameIndexPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(latest.games.len(), 1);
    assert_eq!(latest.games[0].game, completed_game);
    assert_eq!(latest.games[0].status, "completed");
    assert_eq!(latest.games[0].phase_id.as_deref(), Some("D01"));
    let cursor = latest.next_cursor.expect("older game cursor");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games?limit=1&cursor={cursor}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let older: GameIndexPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(older.games.len(), 1);
    assert_eq!(older.games[0].game, active_game);
    assert_eq!(older.games[0].status, "active");
    assert_eq!(older.next_cursor, None);

    let invalid = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/games?cursor=not-a-cursor")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    let bytes = to_bytes(invalid.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::StreamConflict);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn discussion_api_requires_sessions_pages_public_topics_and_enforces_global_moderation(
    pool: sqlx::PgPool,
) {
    let app = router_with_dev_auth(pool);
    for (token, principal_user_id, globals) in [
        (
            "discussion-member",
            "discussion_member",
            serde_json::json!([]),
        ),
        (
            "discussion-moderator",
            "discussion_moderator",
            serde_json::json!(["GlobalMod"]),
        ),
    ] {
        let response = post_public_auth_json(
            &app,
            "/auth/dev-session",
            serde_json::json!({
                "token": token,
                "principal_user_id": principal_user_id,
                "expires_at": 4_102_444_800i64,
                "global_capabilities": globals,
            }),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    let create_area = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/discussions/areas")
                .header("authorization", "Bearer discussion-moderator")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "slug": "general",
                        "title": "General discussion",
                        "description": "Public member discussion"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_area.status(), StatusCode::CREATED);

    for (title, body) in [
        ("First topic", "First opening"),
        ("Second topic", "Second opening"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/discussions/areas/general/topics")
                    .header("authorization", "Bearer discussion-member")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "title": title, "body": body }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/discussions/areas/general?limit=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let page: DiscussionTopicPage =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(page.topics.len(), 1);
    assert_eq!(page.topics[0].title, "Second topic");
    let topic = page.topics[0].topic;
    let cursor = page.next_cursor.expect("topic page cursor");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/discussions/areas/general?limit=1&cursor={cursor}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let older: DiscussionTopicPage =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(older.topics.len(), 1);
    assert_eq!(older.topics[0].title, "First topic");

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/discussions/topics/{topic}/moderation"))
                .header("authorization", "Bearer discussion-member")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"status":"locked"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let locked = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/discussions/topics/{topic}/moderation"))
                .header("authorization", "Bearer discussion-moderator")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"status":"locked"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(locked.status(), StatusCode::OK);

    let rejected_post = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/discussions/topics/{topic}/posts"))
                .header("authorization", "Bearer discussion-member")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"body":"late reply"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected_post.status(), StatusCode::CONFLICT);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/discussions/topics/{topic}?limit=10"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let thread: DiscussionThreadPage =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(thread.topic.status, "locked");
    assert_eq!(thread.posts.len(), 1);
    assert_eq!(thread.posts[0].body, "Second opening");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_channel_thread_cold_load_is_channel_scoped_and_authorized(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO slot_occupancy (game_id, slot_id, occupant_user_id) VALUES ($1, 'slot_1', 'user_a')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO private_channel_member \
         (game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source) \
         VALUES ($1, 'private:role_pm:slot_1', 'role_pm', 'slot_1', 'vanilla_townie', 'never', 'test')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    for (source_seq, channel_id, body) in [
        (10_i64, "main", "main thread post"),
        (11_i64, "private:role_pm:slot_1", "private role note"),
    ] {
        sqlx::query(
            "INSERT INTO thread_view \
             (game_id, source_seq, stream_seq, channel_id, author_slot, author_user, phase_id, body, occurred_at) \
             VALUES ($1, $2, $2, $3, 'slot_1', NULL, 'D01', $4, 1781928000)",
        )
        .bind(game)
        .bind(source_seq)
        .bind(channel_id)
        .bind(body)
        .execute(&pool)
        .await
        .unwrap();
    }

    let app = router(pool);
    let main = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/channels/main/thread?limit=10"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(main.status(), StatusCode::OK);
    let bytes = to_bytes(main.into_body(), usize::MAX).await.unwrap();
    let main_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        main_page
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["main thread post"]
    );

    let private = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:role_pm:slot_1/thread?principal_user_id=user_a&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(private.status(), StatusCode::OK);
    let bytes = to_bytes(private.into_body(), usize::MAX).await.unwrap();
    let private_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        private_page
            .posts
            .iter()
            .map(|post| (post.channel_id.as_str(), post.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("private:role_pm:slot_1", "private role note")]
    );

    let denied = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:role_pm:slot_1/thread?principal_user_id=user_b"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_private_channel_submit_post_requires_channel_membership(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    for (id, principal, command) in [
        (
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        ),
        (
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        ),
        (
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        ),
        (
            4,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            5,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }
    sqlx::query(
        "INSERT INTO private_channel_member \
         (game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source) \
         VALUES ($1, 'private:role_pm:slot_1', 'role_pm', 'slot_1', 'vanilla_townie', 'never', 'test')",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();

    expect_ack(
        post_command(
            app.clone(),
            6,
            "user_a",
            Command::SubmitPost {
                game,
                channel_id: "private:role_pm:slot_1".into(),
                actor_slot: "slot_1".into(),
                body: "private role confirmation".into(),
                media: None,
            },
        )
        .await,
    );
    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted' ORDER BY seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(payload["channel_id"], "private:role_pm:slot_1");
    assert_eq!(payload["slot_or_user"]["slot"], "slot_1");
    assert_eq!(payload["phase_id"], "D01");
    assert!(payload.get("body").is_none());
    assert!(payload["body_private"]["ciphertext"].is_string());
    assert!(payload["body_private"]["kid"].is_string());

    let private_thread = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/private:role_pm:slot_1/thread?principal_user_id=user_a&limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(private_thread.status(), StatusCode::OK);
    let bytes = to_bytes(private_thread.into_body(), usize::MAX)
        .await
        .unwrap();
    let private_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(private_page.posts[0].body, "private role confirmation");

    let denied = post_command(
        app,
        7,
        "user_a",
        Command::SubmitPost {
            game,
            channel_id: "scum-chat".into(),
            actor_slot: "slot_1".into(),
            body: "not a member".into(),
            media: None,
        },
    )
    .await;
    expect_reject(denied, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_faction_day_chat_is_command_declared_and_channel_scoped(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

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
        (11, "slot_4", "town_user", "vanilla_townie"),
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
            14,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    let members = projections::private_channel_members(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .filter(|member| member.channel_id == "private:mafia_day_chat")
        .map(|member| (member.slot_id, member.role_key, member.kind))
        .collect::<Vec<_>>();
    assert_eq!(
        members,
        vec![
            (
                "slot_1".to_string(),
                "encryptor".to_string(),
                "FactionDayChat".to_string()
            ),
            (
                "slot_2".to_string(),
                "mafia_goon".to_string(),
                "FactionDayChat".to_string()
            ),
        ],
        "StartGame should declare only eligible mafia faction-day-chat members",
    );

    expect_ack(
        post_command(
            app.clone(),
            15,
            "encryptor_user",
            Command::SubmitPost {
                game,
                channel_id: "private:mafia_day_chat".into(),
                actor_slot: "slot_1".into(),
                body: "day chat is live".into(),
                media: None,
            },
        )
        .await,
    );

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
    let allowed_page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        allowed_page
            .posts
            .iter()
            .map(|post| (post.channel_id.as_str(), post.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("private:mafia_day_chat", "day chat is live")]
    );
    assert!(allowed_page.posts[0].media.is_empty());

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
        16,
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_action_commands_are_capability_gated_and_projected(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

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
        (2, "slot_7", "player_mira", "vanilla_townie"),
        (5, "slot_target", "player_target", "vanilla_townie"),
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
            8,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            9,
            "player_mira",
            Command::SubmitPost {
                game,
                channel_id: "main".into(),
                actor_slot: "slot_7".into(),
                body: "Slot 7 check-in before replacement".into(),
                media: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            10,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );

    expect_reject(
        post_command(
            app.clone(),
            11,
            "player_mira",
            Command::ExtendDeadline {
                game,
                phase: "D01".into(),
                at: 1_781_928_000,
            },
        )
        .await,
        RejectCode::NotHost,
    );
    expect_ack(
        post_command(
            app.clone(),
            12,
            "cohost_c",
            Command::ExtendDeadline {
                game,
                phase: "D01".into(),
                at: 1_781_928_000,
            },
        )
        .await,
    );

    expect_reject(
        post_command(
            app.clone(),
            13,
            "cohost_c",
            Command::ProcessReplacement {
                game,
                slot: "slot_7".into(),
                outgoing_user: "player_mira".into(),
                incoming_user: "player_rowan".into(),
            },
        )
        .await,
        RejectCode::NotHost,
    );
    expect_ack(
        post_command(
            app.clone(),
            14,
            "host_h",
            Command::ProcessReplacement {
                game,
                slot: "slot_7".into(),
                outgoing_user: "player_mira".into(),
                incoming_user: "player_rowan".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            15,
            "host_h",
            Command::SetSlotStatus {
                game,
                slot: "slot_7".into(),
                status: SlotLifecycle::Modkilled,
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-console-state?principal_user_id=host_h&slot_id=slot_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["phase"]["phase_id"], "D01");
    assert_eq!(state["phase"]["deadline"], 1_781_928_000);
    assert_eq!(state["slots"][0]["slot_id"], "slot_7");
    assert_eq!(state["slots"][0]["occupant_user_id"], "player_rowan");
    assert_eq!(state["slots"][0]["alive"], false);
    assert_eq!(state["slots"][0]["status"], "modkilled");
    assert_eq!(state["thread_posts"][0]["author_slot"], "slot_7");
    assert_eq!(
        state["thread_posts"][0]["body"],
        "Slot 7 check-in before replacement"
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-console-state?principal_user_id=player_mira&slot_id=slot_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn opaque_auth_session_resolves_committed_host_capabilities(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let game = Uuid::new_v4();

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

    let disabled_app = router(pool.clone());
    let disabled_response = disabled_app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "dev-token",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(disabled_response.status(), StatusCode::NOT_FOUND);

    let missing_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "opaque-host-session-token",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer opaque-host-session-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "host_h");
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dev_global_admin_session_round_trips_global_capability(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "opaque-admin-session-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "admin_a");
    assert_eq!(session["capabilities"][0]["kind"], "GlobalAdmin");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer opaque-admin-session-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["capabilities"][0]["kind"], "GlobalAdmin");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn global_admin_can_issue_scoped_operator_session_grants(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "grant-admin-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-grants")
                .header("content-type", "application/json")
                .header("authorization", "Bearer grant-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "token": "granted-global-mod-token",
                        "principal_user_id": "mod_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalMod"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "mod_a");
    assert_eq!(session["capabilities"][0]["kind"], "GlobalMod");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer granted-global-mod-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "mod_a");
    assert_eq!(session["capabilities"][0]["kind"], "GlobalMod");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-grants")
                .header("content-type", "application/json")
                .header("authorization", "Bearer granted-global-mod-token")
                .body(Body::from(
                    serde_json::json!({
                        "token": "forbidden-admin-token",
                        "principal_user_id": "other_admin",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn identity_delivery_intent_is_redacted_and_retryable(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let admin_token = "delivery-admin-token";
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": admin_token,
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    create_test_auth_account(
        &app,
        admin_token,
        "delivery@example.test",
        "correct horse battery",
        "delivery_user",
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "delivery-invite-raw-token",
                        "account_id": "delivery@example.test",
                        "expected_principal_user_id": "delivery_user",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let invite: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(invite["delivery_status"], "delivered");
    assert_eq!(invite["delivery_attempt_count"], 1);
    let delivery_id = Uuid::parse_str(invite["delivery_id"].as_str().expect("delivery id"))
        .expect("typed delivery id");

    let (credential_hash, status, attempts, next_attempt_at, delivered_at, last_error) =
        sqlx::query_as::<_, (String, String, i32, Option<i64>, Option<i64>, Option<String>)>(
            "SELECT credential_hash, status, attempt_count, next_attempt_at, delivered_at, last_error FROM auth_delivery_intent WHERE delivery_id = $1",
        )
        .bind(delivery_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "delivered");
    assert_eq!(attempts, 1);
    assert!(next_attempt_at.is_none());
    assert!(delivered_at.is_some());
    assert!(last_error.is_none());
    assert!(!credential_hash.contains("delivery-invite-raw-token"));

    sqlx::query(
        "UPDATE auth_delivery_intent SET status = 'retryable_failed', next_attempt_at = 0, delivered_at = NULL, last_error = 'local-delivery-transient' WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .execute(&pool)
    .await
    .unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/auth/delivery-intents/{delivery_id}/retry"))
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let retried: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(retried["status"], "delivered");
    assert_eq!(retried["attempt_count"], 2);
    let audit_rows = sqlx::query_as::<_, (String, String)>(
        "SELECT event_kind, actor_user_id FROM identity_lifecycle_audit WHERE principal_user_id = 'delivery_user' ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        audit_rows,
        vec![
            ("account_created".to_string(), "admin_a".to_string()),
            (
                "auth_delivery_queued".to_string(),
                "delivery_user".to_string()
            ),
            (
                "auth_delivery_delivered".to_string(),
                "delivery_user".to_string()
            ),
            ("auth_delivery_retried".to_string(), "admin_a".to_string()),
        ]
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn public_account_registration_creates_unprivileged_opaque_session(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/registrations")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "New.User+One@Example.Test",
                        "password": "correct horse battery",
                        "session_token": "registered-account-session"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let registered: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(registered["account_id"], "new.user+one@example.test");
    let principal_user_id = registered["principal_user_id"]
        .as_str()
        .expect("registration principal");
    assert!(principal_user_id.starts_with("registered-"));
    assert!(registered["expires_at"].as_i64().is_some());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer registered-account-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], principal_user_id);
    assert_eq!(session["capabilities"], serde_json::json!([]));

    let (stored_principal, password_hash, global_capabilities) =
        sqlx::query_as::<_, (String, String, Vec<String>)>(
            "SELECT principal_user_id, password_hash, global_capabilities FROM auth_account WHERE account_id = $1",
        )
        .bind("new.user+one@example.test")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_principal, principal_user_id);
    assert!(password_hash.starts_with("$argon2id$"));
    assert!(global_capabilities.is_empty());

    let audit_kinds = sqlx::query_scalar::<_, String>(
        "SELECT event_kind FROM identity_lifecycle_audit WHERE principal_user_id = $1 ORDER BY id",
    )
    .bind(principal_user_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        audit_kinds,
        vec![
            "account_registered".to_string(),
            "account_session_created".to_string(),
        ]
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/registrations")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "new.user+one@example.test",
                        "password": "correct horse battery",
                        "session_token": "registered-account-session-replay"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn public_account_registration_bounds_hashed_source_attempts(pool: sqlx::PgPool) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_registration_source_limit(2)
            .with_trusted_auth_attempt_source_header(true),
    );
    for (account_id, session_token, expected_status) in [
        ("first@example.test", "registration-first", StatusCode::OK),
        (
            "second@example.test",
            "registration-second",
            StatusCode::TOO_MANY_REQUESTS,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/registrations")
                    .header("content-type", "application/json")
                    .header("x-fmarch-auth-source", "198.51.100.71")
                    .body(Body::from(
                        serde_json::json!({
                            "account_id": account_id,
                            "password": "correct horse battery",
                            "session_token": session_token
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
    }

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/registrations")
                .header("content-type", "application/json")
                .header("x-fmarch-auth-source", "198.51.100.72")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "other-source@example.test",
                        "password": "correct horse battery",
                        "session_token": "registration-other-source"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let stored_scopes = sqlx::query_scalar::<_, String>(
        "SELECT scope_hash FROM auth_registration_attempt ORDER BY scope_hash",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(stored_scopes.len(), 2);
    assert!(stored_scopes.iter().all(|scope| scope.len() == 64));
    assert!(stored_scopes
        .iter()
        .all(|scope| !scope.contains("198.51.100")));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn global_admin_account_login_creates_normal_role_session(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let game = Uuid::new_v4();

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

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "account-admin-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts")
                .header("content-type", "application/json")
                .header("authorization", "Bearer account-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "password": "correct horse battery",
                        "principal_user_id": "host_h"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let account: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(account["account_id"], "host@example.test");
    assert_eq!(account["principal_user_id"], "host_h");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "password": "wrong password",
                        "session_token": "host-account-session-wrong",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "password": "correct horse battery",
                        "session_token": "host-account-session",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let login: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(login["principal_user_id"], "host_h");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer host-account-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "host_h");
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/disable")
                .header("content-type", "application/json")
                .header("authorization", "Bearer account-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let disabled: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(disabled["status"], "disabled");
    assert_eq!(disabled["account_id"], "host@example.test");
    assert_eq!(disabled["principal_user_id"], "host_h");
    assert_eq!(disabled["revoked_session_count"], 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer host-account-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/enable")
                .header("content-type", "application/json")
                .header("authorization", "Bearer account-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "expected_disabled": false
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let stale: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(stale.error, RejectCode::StreamConflict);
    assert!(stale.message.contains("stale account lifecycle state"));
    assert!(stale
        .message
        .contains("refresh and use current account controls"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "password": "correct horse battery",
                        "session_token": "disabled-host-account-session",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/enable")
                .header("content-type", "application/json")
                .header("authorization", "Bearer account-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "expected_disabled": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let enabled: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(enabled["status"], "enabled");
    assert_eq!(enabled["disabled_at"], serde_json::Value::Null);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "password": "correct horse battery",
                        "session_token": "reenabled-host-account-session",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer reenabled-host-account-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reenabled_session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reenabled_session["principal_user_id"], "host_h");
    assert_eq!(reenabled_session["capabilities"][0]["kind"], "HostOf");

    let stored_password_hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM auth_account WHERE account_id = $1",
    )
    .bind("host@example.test")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(stored_password_hash.starts_with("$argon2id$v=19$"));
    assert!(!stored_password_hash.contains("correct horse battery"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/password-rotations")
                .header("content-type", "application/json")
                .header("authorization", "Bearer reenabled-host-account-session")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "current_password": "correct horse battery",
                        "new_password": "rotated correct horse battery"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rotation: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rotation["status"], "rotated");
    assert_eq!(rotation["principal_user_id"], "host_h");
    assert_eq!(rotation["password_algorithm"], "argon2id");
    assert!(rotation["revoked_session_count"].as_i64().unwrap() >= 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer reenabled-host-account-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    for (password, session_token, expected_status) in [
        (
            "correct horse battery",
            "old-password-host-account-session",
            StatusCode::UNAUTHORIZED,
        ),
        (
            "rotated correct horse battery",
            "rotated-password-host-account-session",
            StatusCode::OK,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "account_id": "host@example.test",
                            "password": password,
                            "session_token": session_token,
                            "expires_at": 4_102_444_800i64
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
    }

    let recovery_expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86_400;
    let mut recovery_credentials = Vec::new();
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/recovery-credentials")
                    .header("content-type", "application/json")
                    .header(
                        "authorization",
                        "Bearer rotated-password-host-account-session",
                    )
                    .body(Body::from(
                        serde_json::json!({
                            "account_id": "host@example.test",
                            "current_password": "rotated correct horse battery",
                            "expires_at": recovery_expires_at
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let credential: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(credential["status"], "issued");
        assert!(credential["recovery_token"]
            .as_str()
            .unwrap()
            .starts_with("account-recovery-"));
        recovery_credentials.push(credential);
    }

    let active_recovery_token = recovery_credentials[0]["recovery_token"]
        .as_str()
        .unwrap()
        .to_string();
    let revoked_recovery_token = recovery_credentials[1]["recovery_token"]
        .as_str()
        .unwrap()
        .to_string();
    let revoked_recovery_id = recovery_credentials[1]["recovery_id"].as_str().unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/recovery-credential-revocations")
                .header("content-type", "application/json")
                .header(
                    "authorization",
                    "Bearer rotated-password-host-account-session",
                )
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "current_password": "rotated correct horse battery",
                        "recovery_id": revoked_recovery_id
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/recoveries")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "recovery_token": revoked_recovery_token,
                        "new_password": "must not become the password"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/recoveries")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "host@example.test",
                        "recovery_token": active_recovery_token,
                        "new_password": "recovered correct horse battery"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let recovery: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(recovery["status"], "recovered");
    assert_eq!(recovery["password_algorithm"], "argon2id");
    assert!(recovery["revoked_session_count"].as_i64().unwrap() >= 1);

    for recovery_token in [&active_recovery_token, &revoked_recovery_token] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/recoveries")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "account_id": "host@example.test",
                            "recovery_token": recovery_token,
                            "new_password": "replay must not become password"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header(
                    "authorization",
                    "Bearer rotated-password-host-account-session",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    for (password, session_token, expected_status) in [
        (
            "rotated correct horse battery",
            "pre-recovery-password-session",
            StatusCode::UNAUTHORIZED,
        ),
        (
            "recovered correct horse battery",
            "recovered-password-session",
            StatusCode::OK,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "account_id": "host@example.test",
                            "password": password,
                            "session_token": session_token,
                            "expires_at": 4_102_444_800i64
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
    }

    let stored_recovery_hashes = sqlx::query_scalar::<_, String>(
        "SELECT token_hash FROM auth_account_recovery_credential ORDER BY recovery_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(stored_recovery_hashes
        .iter()
        .all(|hash| !hash.contains("account-recovery-")));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/identity-lifecycle-audit?principal_user_id=host_h")
                .header("authorization", "Bearer account-admin-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let audit: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let audit_text = audit.to_string();
    assert!(audit_text.contains("account_created"));
    assert!(audit_text.contains("account_session_created"));
    assert!(audit_text.contains("account_disabled"));
    assert!(audit_text.contains("account_enabled"));
    assert!(audit_text.contains("account_password_rotated"));
    assert!(audit_text.contains("account_recovery_credential_issued"));
    assert!(audit_text.contains("account_recovery_credential_revoked"));
    assert!(audit_text.contains("account_recovery_rejected"));
    assert!(audit_text.contains("account_recovered"));
    assert!(audit_text.contains("argon2id"));
    assert!(!audit_text.contains("correct horse battery"));
    assert!(!audit_text.contains("rotated correct horse battery"));
    assert!(!audit_text.contains("recovered correct horse battery"));
    assert!(!audit_text.contains(&active_recovery_token));
    assert!(!audit_text.contains(&revoked_recovery_token));
    assert!(!audit_text.contains("host-account-session"));
    assert!(!audit_text.contains("disabled-host-account-session"));
    assert!(!audit_text.contains("reenabled-host-account-session"));
    assert!(!audit_text.contains("old-password-host-account-session"));
    assert!(!audit_text.contains("rotated-password-host-account-session"));
    assert!(!audit_text.contains("pre-recovery-password-session"));
    assert!(!audit_text.contains("recovered-password-session"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn public_credential_failures_share_a_hashed_retryable_lockout(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let admin_token = "credential-throttle-admin";
    let account_id = "throttled-host@example.test";
    let password = "correct horse battery";

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": admin_token,
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    create_test_auth_account(&app, admin_token, account_id, password, "host_h").await;

    let failed_requests = [
        (
            "/auth/accounts/login",
            serde_json::json!({
                "account_id": account_id,
                "password": "wrong password",
                "session_token": "failed-login-session",
                "expires_at": 4_102_444_800i64
            }),
        ),
        (
            "/auth/invites/redeem",
            serde_json::json!({
                "invite_token": "invalid-invite",
                "account_id": account_id,
                "password": "wrong password",
                "session_token": "failed-invite-session"
            }),
        ),
        (
            "/auth/accounts/recoveries",
            serde_json::json!({
                "account_id": account_id,
                "recovery_token": "invalid-recovery-1",
                "new_password": "replacement password one"
            }),
        ),
        (
            "/auth/accounts/recoveries",
            serde_json::json!({
                "account_id": account_id,
                "recovery_token": "invalid-recovery-2",
                "new_password": "replacement password two"
            }),
        ),
        (
            "/auth/accounts/recoveries",
            serde_json::json!({
                "account_id": account_id,
                "recovery_token": "invalid-recovery-3",
                "new_password": "replacement password three"
            }),
        ),
    ];
    for (index, (uri, body)) in failed_requests.into_iter().enumerate() {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        if index < 4 {
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        } else {
            assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
            let retry_after = response
                .headers()
                .get("retry-after")
                .unwrap()
                .to_str()
                .unwrap()
                .parse::<i64>()
                .unwrap();
            assert!(retry_after > 0 && retry_after <= 900);
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(reject.error, RejectCode::NotAuthorized);
            assert!(reject.retryable);
        }
    }

    let attempts = sqlx::query_as::<_, (String, i32, Option<i64>)>(
        "SELECT scope_hash, failure_count, blocked_until FROM auth_credential_attempt ORDER BY scope_hash",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(attempts.len(), 2);
    assert!(attempts
        .iter()
        .all(|attempt| attempt.0.len() == 64 && !attempt.0.contains(account_id)));
    assert!(attempts.iter().all(|attempt| attempt.1 == 5));
    let blocked_attempt = attempts
        .iter()
        .find(|attempt| attempt.2.is_some())
        .expect("known account scope must be blocked");
    assert_eq!(
        attempts
            .iter()
            .filter(|attempt| attempt.2.is_some())
            .count(),
        1
    );

    let rate_limit_audit = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT token_hash, metadata FROM identity_lifecycle_audit WHERE event_kind = 'auth_attempt_rate_limited'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rate_limit_audit.0, blocked_attempt.0);
    assert_eq!(rate_limit_audit.1["operation"], "account-recovery");
    assert_eq!(rate_limit_audit.1["scope_kind"], "account");
    assert_eq!(rate_limit_audit.1["account_max_failures"], 5);
    assert_eq!(rate_limit_audit.1["source_max_failures"], 50);
    assert_eq!(rate_limit_audit.1["trusted_source_header"], false);
    assert!(!rate_limit_audit.1.to_string().contains("invalid-recovery"));

    sqlx::query("UPDATE auth_credential_attempt SET blocked_until = 0, updated_at = 0")
        .execute(&pool)
        .await
        .unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": account_id,
                        "password": password,
                        "session_token": "post-lockout-session",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let remaining_attempts =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_credential_attempt")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining_attempts, 0);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn unknown_credentials_use_one_source_scope_and_prune_stale_rows(pool: sqlx::PgPool) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_dev_auth(true)
            .with_auth_attempt_limits(2, 3, 900, 900, 900),
    );
    sqlx::query(
        r#"
        INSERT INTO auth_credential_attempt (
            scope_hash, window_started_at, failure_count, blocked_until, updated_at
        )
        VALUES ('stale-scope', 0, 1, NULL, 0)
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let requests = [
        (
            "/auth/accounts/login",
            serde_json::json!({
                "account_id": "missing-login@example.test",
                "password": "wrong password",
                "session_token": "missing-login-session",
                "expires_at": 4_102_444_800i64
            }),
            "spoofed-source-a",
        ),
        (
            "/auth/invites/redeem",
            serde_json::json!({
                "invite_token": "missing-invite",
                "account_id": "missing-invite@example.test",
                "password": "wrong password",
                "session_token": "missing-invite-session"
            }),
            "spoofed-source-b",
        ),
        (
            "/auth/accounts/recoveries",
            serde_json::json!({
                "account_id": "missing-recovery@example.test",
                "recovery_token": "missing-recovery",
                "new_password": "replacement password"
            }),
            "spoofed-source-c",
        ),
    ];
    for (index, (uri, body, spoofed_source)) in requests.into_iter().enumerate() {
        let response = post_public_auth_json(&app, uri, body, Some(spoofed_source)).await;
        assert_eq!(
            response.status(),
            if index < 2 {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::TOO_MANY_REQUESTS
            },
        );
    }

    let attempts = sqlx::query_as::<_, (String, i32, Option<i64>)>(
        "SELECT scope_hash, failure_count, blocked_until FROM auth_credential_attempt",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].0.len(), 64);
    assert_eq!(attempts[0].1, 3);
    assert!(attempts[0].2.is_some());
    let audit_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE event_kind = 'auth_attempt_rate_limited'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 0);

    let response = post_public_auth_json(
        &app,
        "/auth/accounts/login",
        serde_json::json!({
            "account_id": "another-random-account@example.test",
            "password": "wrong password",
            "session_token": "another-missing-session",
            "expires_at": 4_102_444_800i64
        }),
        Some("another-spoofed-source"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let row_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_credential_attempt")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row_count, 1);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn trusted_credential_sources_partition_account_lockouts(pool: sqlx::PgPool) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_dev_auth(true)
            .with_auth_attempt_limits(3, 20, 900, 900, 900)
            .with_trusted_auth_attempt_source_header(true),
    );
    let admin_token = "trusted-source-admin";
    let account_id = "partitioned-host@example.test";
    let password = "correct horse battery";
    let response = post_public_auth_json(
        &app,
        "/auth/dev-session",
        serde_json::json!({
            "token": admin_token,
            "principal_user_id": "admin_a",
            "expires_at": 4_102_444_800i64,
            "global_capabilities": ["GlobalAdmin"]
        }),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    create_test_auth_account(&app, admin_token, account_id, password, "host_h").await;

    for (source, expected_status) in [
        ("source-a", StatusCode::UNAUTHORIZED),
        ("source-b", StatusCode::UNAUTHORIZED),
        ("source-a", StatusCode::UNAUTHORIZED),
        ("source-b", StatusCode::UNAUTHORIZED),
        ("source-a", StatusCode::TOO_MANY_REQUESTS),
    ] {
        let response = post_public_auth_json(
            &app,
            "/auth/accounts/login",
            serde_json::json!({
                "account_id": account_id,
                "password": "wrong password",
                "session_token": format!("wrong-{source}-session"),
                "expires_at": 4_102_444_800i64
            }),
            Some(source),
        )
        .await;
        assert_eq!(response.status(), expected_status);
    }

    let attempts_before_success =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_credential_attempt")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(attempts_before_success, 4);
    let response = post_public_auth_json(
        &app,
        "/auth/accounts/login",
        serde_json::json!({
            "account_id": account_id,
            "password": password,
            "session_token": "trusted-source-b-session",
            "expires_at": 4_102_444_800i64
        }),
        Some("source-b"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let remaining_attempts =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_credential_attempt")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining_attempts, 2);

    let response = post_public_auth_json(
        &app,
        "/auth/accounts/login",
        serde_json::json!({
            "account_id": account_id,
            "password": password,
            "session_token": "blocked-source-a-session",
            "expires_at": 4_102_444_800i64
        }),
        Some("source-a"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let audit = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT metadata FROM identity_lifecycle_audit WHERE event_kind = 'auth_attempt_rate_limited'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit["scope_kind"], "account");
    assert_eq!(audit["trusted_source_header"], true);
    assert!(!audit.to_string().contains("source-a"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn global_admin_invite_redeems_to_normal_role_session(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let game = Uuid::new_v4();

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

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "invite-admin-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    create_test_auth_account(
        &app,
        "invite-admin-token",
        "host@example.test",
        "host invite password",
        "host_h",
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites")
                .header("content-type", "application/json")
                .header("authorization", "Bearer invite-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "expected_principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let invite: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(invite["account_id"], "host@example.test");
    assert_eq!(invite["principal_user_id"], "host_h");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "password": "wrong invite password",
                        "session_token": "wrong-host-invite-session"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "password": "host invite password",
                        "session_token": "host-invite-session"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let redeemed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(redeemed["principal_user_id"], "host_h");
    assert_eq!(redeemed["capabilities"].as_array().unwrap().len(), 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer host-invite-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "host_h");
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "password": "host invite password",
                        "session_token": "second-host-session"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_issued_invite_redeems_through_game_role_projection(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let game = Uuid::new_v4();

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
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot-7".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot-7".into(),
                user: "player-rowan".into(),
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "host-issuer-session",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "invite-account-admin",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    create_test_auth_account(
        &app,
        "invite-account-admin",
        "rowan@example.test",
        "rowan invite password",
        "player-rowan",
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites")
                .header("content-type", "application/json")
                .header("authorization", "Bearer host-issuer-session")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "rowan-replacement-invite",
                        "account_id": "rowan@example.test",
                        "expected_principal_user_id": "player-rowan",
                        "expires_at": 4_102_444_800i64,
                        "game": game
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let invite: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(invite["principal_user_id"], "player-rowan");
    assert_eq!(invite["game"], game.to_string());
    assert_eq!(invite["invited_by_user_id"], "host_h");
    assert_eq!(invite["global_capabilities"].as_array().unwrap().len(), 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "rowan-replacement-invite",
                        "account_id": "rowan@example.test",
                        "password": "rowan invite password",
                        "session_token": "rowan-replacement-session"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer rowan-replacement-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_user_id"], "player-rowan");
    assert_eq!(session["capabilities"][0]["kind"], "SlotOccupant");
    assert_eq!(session["capabilities"][0]["body"]["slot"], "slot-7");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites")
                .header("content-type", "application/json")
                .header("authorization", "Bearer rowan-replacement-session")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "forbidden-global",
                        "account_id": "missing@example.test",
                        "expected_principal_user_id": "other",
                        "expires_at": 4_102_444_800i64,
                        "game": game,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn session_lifecycle_rotates_once_and_logs_out_the_presented_token(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "lifecycle-browser-session-v1",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    sqlx::query("UPDATE auth_session SET created_at = 0 WHERE principal_user_id = 'host_h'")
        .execute(&pool)
        .await
        .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer lifecycle-browser-session-v1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["rotation_required"], true);
    assert_eq!(session["created_at"], 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-browser-session-v1")
                .body(Body::from(
                    serde_json::json!({ "session_token": "lifecycle-browser-session-v2" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-browser-session-v1")
                .body(Body::from(
                    serde_json::json!({ "session_token": "lifecycle-browser-session-v3" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-logout")
                .header("authorization", "Bearer lifecycle-browser-session-v2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let logged_out: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(logged_out["status"], "logged_out");
    assert_eq!(logged_out["principal_user_id"], "host_h");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", "Bearer lifecycle-browser-session-v2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let audit = sqlx::query_as::<_, (String, String, Option<String>, serde_json::Value)>(
        r#"
        SELECT event_kind, principal_user_id, related_token_hash, metadata
        FROM identity_lifecycle_audit
        WHERE event_kind = 'session_logged_out'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "session_logged_out");
    assert_eq!(audit.1, "host_h");
    assert_eq!(audit.2, None);
    assert_eq!(audit.3, serde_json::json!({}));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn auth_lifecycle_rotates_sessions_and_revokes_invites(pool: sqlx::PgPool) {
    let app = router_with_dev_auth(pool.clone());
    let game = Uuid::new_v4();

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

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/dev-session")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "token": "lifecycle-admin-token",
                        "principal_user_id": "admin_a",
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    create_test_auth_account(
        &app,
        "lifecycle-admin-token",
        "lifecycle-host@example.test",
        "lifecycle invite password",
        "host_h",
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-grants")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "token": "host-session-v1",
                        "principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", "Bearer host-session-v1")
                .body(Body::from(
                    serde_json::json!({
                        "session_token": "host-session-v2"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rotated: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rotated["principal_user_id"], "host_h");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer host-session-v1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer host-session-v2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-revocations")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "token": "host-session-v2"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", "Bearer host-session-v2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "revoked-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "expected_principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invite-revocations")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "revoked-host-invite"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "revoked-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "password": "lifecycle invite password",
                        "session_token": "should-not-exist"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites")
                .header("content-type", "application/json")
                .header("authorization", "Bearer lifecycle-admin-token")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "replacement-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "expected_principal_user_id": "host_h",
                        "expires_at": 4_102_444_800i64
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/invites/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "replacement-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "password": "lifecycle invite password",
                        "session_token": "replacement-host-session"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/identity-lifecycle-audit?principal_user_id=host_h")
                .header("authorization", "Bearer lifecycle-admin-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let audit: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let entries = audit["entries"].as_array().expect("audit entries array");
    let event_kinds: BTreeSet<_> = entries
        .iter()
        .map(|entry| entry["event_kind"].as_str().expect("audit event kind"))
        .collect();
    assert_eq!(
        event_kinds,
        BTreeSet::from([
            "account_created",
            "invite_redeemed",
            "invite_revoked",
            "session_revoked",
            "session_rotated",
        ])
    );
    assert!(entries.iter().any(|entry| {
        entry["event_kind"] == "session_rotated"
            && entry["actor_user_id"] == "host_h"
            && entry["principal_user_id"] == "host_h"
    }));
    assert!(entries.iter().any(|entry| {
        entry["event_kind"] == "session_revoked"
            && entry["actor_user_id"] == "admin_a"
            && entry["principal_user_id"] == "host_h"
    }));
    assert!(entries.iter().any(|entry| {
        entry["event_kind"] == "invite_revoked"
            && entry["actor_user_id"] == "admin_a"
            && entry["principal_user_id"] == "host_h"
    }));
    let audit_text = audit.to_string();
    for raw_token in [
        "host-session-v1",
        "host-session-v2",
        "revoked-host-invite",
        "replacement-host-invite",
    ] {
        assert!(
            !audit_text.contains(raw_token),
            "audit response leaked raw token {raw_token}"
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn duplicate_command_id_returns_original_ack_without_duplicate_post(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

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
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    let command_id = Uuid::new_v4();
    let command = Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
        body: "commit happened; ack vanished".into(),
        media: None,
    };

    let first_ack = expect_ack(
        post_command_with_command_id(app.clone(), 5, command_id, "user_a", command.clone()).await,
    );
    let retry_ack =
        expect_ack(post_command_with_command_id(app, 6, command_id, "user_a", command).await);
    assert_eq!(retry_ack, first_ack);

    let post_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(post_count, 1, "retry must not append a duplicate post");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_notifications_are_capability_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "chinese_structured".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cupid"),
        (5, "slot_2", "user_2", "villager"),
        (8, "slot_3", "user_3", "prophet"),
        (11, "slot_4", "user_4", "wolf"),
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
            20,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    expect_ack(
        post_command(
            app.clone(),
            21,
            "user_1",
            Command::SubmitAction {
                game,
                action_id: "link_lovers_n01".into(),
                actor_slot: "slot_1".into(),
                template_id: "link_lovers".into(),
                targets: vec!["slot_2".into(), "slot_3".into()],
                grant_id: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            22,
            "host_h",
            Command::ResolvePhase { game, seed: 930601 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=user_2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_two: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_two.len(), 1);
    assert_eq!(user_two[0].audience_slot, "slot_2");
    assert_eq!(user_two[0].effect, "lovers_link");
    assert_eq!(user_two[0].status, "link_lovers_n01");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=user_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_four: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_four.is_empty(),
        "unaddressed occupants see no private notice"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 2);
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_2"));
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_3"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_investigation_results_are_capability_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

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
        (2, "slot_1", "user_1", "cop"),
        (5, "slot_2", "user_2", "framer"),
        (8, "slot_3", "user_3", "vanilla_townie"),
        (11, "slot_4", "user_4", "godfather"),
        (14, "slot_5", "user_5", "miller"),
        (17, "slot_6", "user_6", "cop"),
        (20, "slot_7", "user_7", "cop"),
        (23, "slot_8", "user_8", "vanilla_townie"),
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
            30,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    for (id, user, actor_slot, action_id, template_id, target) in [
        (31, "user_2", "slot_2", "frame_n01", "frame", "slot_3"),
        (
            32,
            "user_1",
            "slot_1",
            "cop_godfather_n01",
            "cop_investigate",
            "slot_4",
        ),
        (
            33,
            "user_6",
            "slot_6",
            "cop_miller_n01",
            "cop_investigate",
            "slot_5",
        ),
        (
            34,
            "user_7",
            "slot_7",
            "cop_framed_n01",
            "cop_investigate",
            "slot_3",
        ),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitAction {
                    game,
                    action_id: action_id.into(),
                    actor_slot: actor_slot.into(),
                    template_id: template_id.into(),
                    targets: vec![target.into()],
                    grant_id: None,
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            40,
            "host_h",
            Command::ResolvePhase { game, seed: 930801 },
        )
        .await,
    );
    projections::rebuild(&pool, game)
        .await
        .expect("investigation-result projection rebuild");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_one: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_one.len(), 1);
    assert_eq!(user_one[0].audience_slot, "slot_1");
    assert_eq!(user_one[0].mode, "Parity");
    assert_eq!(user_one[0].target_slot, "slot_4");
    assert_eq!(user_one[0].result, serde_json::json!("town"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_6"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_six: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_six.len(), 1);
    assert_eq!(user_six[0].audience_slot, "slot_6");
    assert_eq!(user_six[0].target_slot, "slot_5");
    assert_eq!(user_six[0].result, serde_json::json!("scum"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_seven: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_seven.len(), 1);
    assert_eq!(user_seven[0].audience_slot, "slot_7");
    assert_eq!(user_seven[0].target_slot, "slot_3");
    assert_eq!(user_seven[0].result, serde_json::json!("scum"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_8"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_eight: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_eight.is_empty(),
        "unaddressed occupants see no private investigation results"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 3);
    assert!(host.iter().any(|result| result.audience_slot == "slot_1"
        && result.target_slot == "slot_4"
        && result.result == serde_json::json!("town")));
    assert!(host.iter().any(|result| result.audience_slot == "slot_6"
        && result.target_slot == "slot_5"
        && result.result == serde_json::json!("scum")));
    assert!(host.iter().any(|result| result.audience_slot == "slot_7"
        && result.target_slot == "slot_3"
        && result.result == serde_json::json!("scum")));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_hello_announces_protocol(pool: sqlx::PgPool) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(pool)).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
        .await
        .unwrap();
    let msg = socket.next().await.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    let envelope: ServerEnvelope = serde_json::from_str(&text).unwrap();

    assert_eq!(envelope.v, PROTOCOL_VERSION);
    assert_eq!(envelope.id, 0);
    match envelope.body {
        ServerMsg::Hello(hello) => {
            assert_eq!(hello.protocol_v, PROTOCOL_VERSION);
            assert_eq!(hello.server, "fmarch-dev");
            assert!(hello.caps.is_empty());
        }
        other => panic!("expected Hello, got {other:?}"),
    }

    server.abort();
}
