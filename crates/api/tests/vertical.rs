use api::{
    identity_delivery::{
        process_next_identity_delivery, unix_now_seconds, IdentityDeliveryAttempt,
        IdentityDeliveryFailureCode, IdentityDeliveryFuture, IdentityDeliveryGateway,
        IdentityDeliveryOutcome, LocalDeterministicIdentityDeliveryGateway,
    },
    ApiState, HostConsoleStateResponse, HostSetupStateResponse, MediaUploadResponse,
    WebsocketTicketResponse,
};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures_util::StreamExt;
use identity::{StaticAccessTokenVerifier, VerifiedIdentity, WorkosSessionId};
use media::{MediaLimits, MediaStore, VariantLimits};
use principal::PrincipalId;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;
use wire::{
    ClientEnvelope, ClientMsg, Command, CommandMsg, DiscussionThreadPage, DiscussionTopic,
    DiscussionTopicPage, GameIndexPage, GameThreadAuthor, InvestigationResultBody, MemberMutePage,
    MemberMuteState, MentionSuggestionPage, ModerationCaseDetail, ModerationCasePage,
    ModerationReportReceipt, PlayerInvestigationResult, PlayerNotification, ProfileEditor,
    ProjectionDelta, PublicGameThreadPage, PublicInboxPage, PublicProfile, PublicSearchFilterValue,
    PublicSearchPage, PublicSearchResultKind, RejectCode, RejectMsg, ServerEnvelope, ServerMsg,
    SlotLifecycle, SubmitPostMedia, SubscriptionTargetState, ThreadPage, VoteTarget,
    PROTOCOL_VERSION,
};

const TEST_LOCAL_PROOF_SECRET: &str =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_TEST_LOCAL_PROOF_SECRET: &str =
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

fn test_local_proof_verifier() -> api::LocalProofAuthVerifier {
    test_local_proof_verifier_for(TEST_LOCAL_PROOF_SECRET)
}

fn test_local_proof_verifier_for(secret: &str) -> api::LocalProofAuthVerifier {
    api::LocalProofAuthVerifier::from_secret(secret).expect("test local-proof secret is canonical")
}

fn fixture_principal_json(label: impl AsRef<str>) -> serde_json::Value {
    serde_json::json!(PrincipalId::fixture(label))
}

fn test_pack_artifact(key: &str) -> content_registry::PackArtifactSnapshot {
    content_registry::select_pack_artifact(key).expect("select verified test pack artifact")
}

async fn install_test_pack_artifact(
    pool: &sqlx::PgPool,
    artifact: &content_registry::PackArtifactSnapshot,
) {
    let mut tx = pool.begin().await.expect("begin pack artifact install");
    projections::install_pack_artifact_in_tx(&mut tx, artifact)
        .await
        .expect("install verified test pack artifact");
    tx.commit().await.expect("commit pack artifact install");
}

fn decode_server_envelope(message: tokio_tungstenite::tungstenite::Message) -> ServerEnvelope {
    let tokio_tungstenite::tungstenite::Message::Binary(bytes) = message else {
        panic!("expected binary CBOR websocket frame");
    };
    ciborium::from_reader(bytes.as_ref()).expect("decode server CBOR envelope")
}

fn router(pool: sqlx::PgPool) -> axum::Router {
    api::router_with_state(test_api_state(pool).with_local_proof_auth(test_local_proof_verifier()))
}

fn router_with_local_proof_auth(pool: sqlx::PgPool) -> axum::Router {
    router_with_local_proof_verifier(pool, test_local_proof_verifier())
}

fn router_with_local_proof_verifier(
    pool: sqlx::PgPool,
    verifier: api::LocalProofAuthVerifier,
) -> axum::Router {
    api::router_with_state(test_api_state(pool).with_local_proof_auth(verifier))
}

fn test_api_state(pool: sqlx::PgPool) -> ApiState {
    ApiState::new(pool, shared_test_media_store())
}

async fn community_invitation_for(pool: &sqlx::PgPool, account_id: &str) -> String {
    let founder = PrincipalId::random();
    let now = 1_700_000_000;
    let mut tx = pool.begin().await.unwrap();
    identity::methods::ensure_principal(&mut tx, &founder, &[], now)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    membership_application::ensure_founder_membership(pool, founder, now)
        .await
        .unwrap();
    membership_application::issue_invitation(
        pool,
        &membership_application::InvitationTargetIndex::from_env_or_local().unwrap(),
        founder,
        account_id,
        4_102_444_800,
        now,
    )
    .await
    .unwrap()
    .credential
}

fn minimal_day_event(event_id: &str) -> game_platform::DayEvent {
    game_platform::DayEvent {
        id: game_platform::DayEventId::new(event_id).unwrap(),
        program_id: game_platform::ProgramId::new("program-bakery").unwrap(),
        template_key: game_platform::TemplateKey::new("theme.raffle").unwrap(),
        phase_scope: game_platform::PhaseScope::DuringDay { number: 1 },
        schedule: game_platform::DayEventSchedule::HostOpened,
        participation: game_platform::ParticipationSpec {
            who: game_platform::ParticipantFilter::AliveSlots,
            mode: game_platform::ParticipationMode::OptIn,
            limits: game_platform::ParticipationLimits {
                minimum: 1,
                maximum: None,
            },
        },
        state: game_platform::DayEventState::Scheduled,
        resolution: game_platform::DayEventResolutionMode::HostDecision,
        rewards: vec![game_platform::RewardBinding {
            reward_key: game_platform::RewardKey::new("cookie").unwrap(),
            display_name_theme_key: game_platform::TemplateKey::new("theme.cookie").unwrap(),
            effects: vec![game_platform::RewardEffectTemplate {
                recipient: game_platform::RecipientSelector::Winner,
                operation: game_platform::EffectOperationTemplate::Mark {
                    effect: game_platform::Tag::new("bomb").unwrap(),
                },
            }],
        }],
        narrative: game_platform::NarrativeTemplates {
            opened: None,
            locked: None,
            resolved: None,
            cancelled: None,
        },
        channel_policy: game_platform::EventChannelPolicy::PublicMain,
    }
}

fn shared_test_media_store() -> MediaStore {
    static ROOT: OnceLock<TempDir> = OnceLock::new();
    let root = ROOT.get_or_init(|| tempfile::tempdir().expect("create shared API test media root"));
    MediaStore::open(root.path(), MediaLimits::default()).expect("open shared API test media store")
}

async fn logical_event_payloads(
    pool: &sqlx::PgPool,
    stream_id: Uuid,
    kind: &str,
) -> Vec<serde_json::Value> {
    eventstore::load_stream(pool, stream_id)
        .await
        .expect("load canonical event stream")
        .into_iter()
        .filter(|event| event.kind == kind)
        .map(|event| event.payload)
        .collect()
}

async fn last_logical_event_payload(
    pool: &sqlx::PgPool,
    stream_id: Uuid,
    kind: &str,
) -> serde_json::Value {
    logical_event_payloads(pool, stream_id, kind)
        .await
        .pop()
        .unwrap_or_else(|| panic!("missing {kind} event in {stream_id}"))
}

async fn issue_dev_session(
    app: &axum::Router,
    principal_label: &str,
    global_capabilities: &[&str],
) -> String {
    issue_dev_session_for_principal_with_secret(
        app,
        PrincipalId::fixture(principal_label),
        global_capabilities,
        TEST_LOCAL_PROOF_SECRET,
    )
    .await
}

async fn issue_dev_session_for_principal(
    app: &axum::Router,
    principal_id: PrincipalId,
    global_capabilities: &[&str],
) -> String {
    issue_dev_session_for_principal_with_secret(
        app,
        principal_id,
        global_capabilities,
        TEST_LOCAL_PROOF_SECRET,
    )
    .await
}

async fn issue_dev_session_for_principal_with_secret(
    app: &axum::Router,
    principal_id: PrincipalId,
    global_capabilities: &[&str],
    local_proof_secret: &str,
) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/local-proof/sessions")
                .header("content-type", "application/json")
                .header(api::LOCAL_PROOF_AUTH_HEADER, local_proof_secret)
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
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    response["session_token"]
        .as_str()
        .expect("dev session response must return its backend-generated token")
        .to_string()
}

async fn get_as_dev_principal(
    app: &axum::Router,
    principal_id: &str,
    uri: impl AsRef<str>,
) -> axum::response::Response {
    let session_token = issue_dev_session(app, principal_id, &[]).await;
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri.as_ref())
                .header("authorization", format!("Bearer {session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get_with_bearer(
    app: &axum::Router,
    session_token: &str,
    uri: impl AsRef<str>,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri.as_ref())
                .header("authorization", format!("Bearer {session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn issue_websocket_ticket(
    app: &axum::Router,
    session_token: &str,
    game: Uuid,
    channel: &str,
) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/websocket-tickets")
                .header("authorization", format!("Bearer {session_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "audience": "fmarch-live",
                        "game": game,
                        "channel": channel,
                        "after_seq": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let response: WebsocketTicketResponse = serde_json::from_slice(&body).unwrap();
    response.ticket
}

async fn issue_dev_websocket_ticket(
    app: &axum::Router,
    principal_id: &str,
    game: Uuid,
    channel: &str,
) -> String {
    let session_token = issue_dev_session(app, principal_id, &[]).await;
    issue_websocket_ticket(app, &session_token, game, channel).await
}

#[derive(Debug)]
struct PermanentFailureIdentityDeliveryGateway;

impl IdentityDeliveryGateway for PermanentFailureIdentityDeliveryGateway {
    fn provider_id(&self) -> &'static str {
        "fixture-permanent"
    }

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(async move {
            assert_eq!(
                attempt.credential_material.as_deref(),
                Some("permanent-delivery-invite-token")
            );
            IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::RecipientRejected,
            )
        })
    }
}

#[derive(Debug)]
struct UnexpectedIdentityDeliveryGateway;

impl IdentityDeliveryGateway for UnexpectedIdentityDeliveryGateway {
    fn provider_id(&self) -> &'static str {
        "fixture-cancel"
    }

    fn deliver<'a>(&'a self, _: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(async move { panic!("inactive credentials must be cancelled before delivery") })
    }
}

#[derive(Debug, Default)]
struct RecoveryProofIdentityDeliveryGateway {
    attempts: Mutex<Vec<(Uuid, i32, String)>>,
}

impl RecoveryProofIdentityDeliveryGateway {
    fn attempts(&self) -> Vec<(Uuid, i32, String)> {
        self.attempts
            .lock()
            .expect("recovery proof attempts")
            .clone()
    }
}

impl IdentityDeliveryGateway for RecoveryProofIdentityDeliveryGateway {
    fn provider_id(&self) -> &'static str {
        "fixture-recovery-proof"
    }

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(async move {
            let credential = attempt
                .credential_material
                .as_deref()
                .expect("recovery delivery credential remains available only at the gateway")
                .to_string();
            self.attempts
                .lock()
                .expect("record recovery proof attempt")
                .push((attempt.delivery_id, attempt.attempt_number, credential));
            if attempt.attempt_number == 1 {
                IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::LocalTransient,
                )
            } else {
                IdentityDeliveryOutcome::Delivered {
                    provider_receipt_id: format!("recovery-proof-{}", attempt.delivery_id),
                }
            }
        })
    }
}

async fn create_test_auth_account(
    app: &axum::Router,
    admin_token: &str,
    account_id: &str,
    password: &str,
    principal_label: &str,
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
                        "principal_id": PrincipalId::fixture(principal_label)
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn fresh_database_bootstraps_exactly_one_global_admin(pool: sqlx::PgPool) {
    assert!(
        api::bootstrap_workos_global_admin(&pool, "user_root", Some("root@example.test"),)
            .await
            .unwrap()
    );
    assert!(!api::bootstrap_workos_global_admin(
        &pool,
        "user_ignored",
        Some("ignored@example.test"),
    )
    .await
    .unwrap());
    let accounts = sqlx::query_as::<_, (String, Vec<String>)>(
        r#"
        SELECT identity.display_label, principal.global_capabilities
        FROM external_identity AS identity
        JOIN platform_principal AS principal
          ON principal.principal_id = identity.principal_id
        ORDER BY identity.display_label
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        accounts,
        vec![(
            "root@example.test".to_string(),
            vec!["GlobalAdmin".to_string()]
        )]
    );
}

async fn post_workos_session_exchange(
    app: &axum::Router,
    provider_assertion: Option<&str>,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("POST")
        .uri("/auth/sessions")
        .header("content-type", "application/json");
    if let Some(provider_assertion) = provider_assertion {
        request = request.header("authorization", format!("Bearer {provider_assertion}"));
    }
    app.clone()
        .oneshot(request.body(Body::from(r#"{"method":"workos"}"#)).unwrap())
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn verified_workos_sid_tombstones_return_the_exact_provider_logout_recovery_contract(
    pool: sqlx::PgPool,
) {
    let cases = [
        (
            "workos-recover-logout",
            "session_01HQAG1HENBZMAZD82YRXDFC0C",
            "logout",
        ),
        (
            "workos-recover-link",
            "session_01HQAG1HENBZMAZD82YRXDFC0D",
            "link_completed",
        ),
        (
            "workos-recover-method-disabled",
            "session_01HQAG1HENBZMAZD82YRXDFC0E",
            "method_disabled",
        ),
    ];
    let verifier = StaticAccessTokenVerifier::new(cases.map(|(token, session_id, _)| {
        (
            token.to_string(),
            VerifiedIdentity {
                subject: format!("user_{token}"),
                session_id: WorkosSessionId::parse(session_id).unwrap(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: None,
            },
        )
    }));
    for (_, session_id, reason) in cases {
        sqlx::query(
            r#"
            INSERT INTO workos_provider_session_tombstone (
                provider_session_hash, tombstoned_at, reason
            )
            VALUES ($1, 1, $2)
            "#,
        )
        .bind(WorkosSessionId::parse(session_id).unwrap().fingerprint())
        .bind(reason)
        .execute(&pool)
        .await
        .unwrap();
    }
    let app = api::router_with_state(
        test_api_state(pool.clone()).with_access_token_verifier(Arc::new(verifier)),
    );

    for (token, session_id, _) in cases {
        let response = post_workos_session_exchange(&app, Some(token)).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = response_json(response).await;
        assert_eq!(body.as_object().unwrap().len(), 2, "body: {body}");
        assert_eq!(
            body,
            serde_json::json!({
                "error": "WorkosProviderSessionLogoutRequired",
                "provider_logout_url": format!(
                    "https://api.workos.com/user_management/sessions/logout?session_id={session_id}"
                )
            })
        );
    }

    let mutation_counts: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT (SELECT COUNT(*) FROM platform_principal),
               (SELECT COUNT(*) FROM external_identity),
               (SELECT COUNT(*) FROM workos_provider_session),
               (SELECT COUNT(*) FROM workos_session_exchange)
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(mutation_counts, (0, 0, 0, 0));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_subject_erasure_tombstone_never_discloses_provider_logout_recovery(
    pool: sqlx::PgPool,
) {
    let subject = "user_erased_workos_recovery";
    let subject_only_sid = "session_01HQAG1HENBZMAZD82YRXDFC0F";
    let subject_and_sid = "session_01HQAG1HENBZMAZD82YRXDFC0G";
    let verifier = StaticAccessTokenVerifier::new([
        (
            "workos-erased-subject-only".to_string(),
            VerifiedIdentity {
                subject: subject.to_string(),
                session_id: WorkosSessionId::parse(subject_only_sid).unwrap(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: None,
            },
        ),
        (
            "workos-erased-subject-and-sid".to_string(),
            VerifiedIdentity {
                subject: subject.to_string(),
                session_id: WorkosSessionId::parse(subject_and_sid).unwrap(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: None,
            },
        ),
    ]);
    sqlx::query(
        r#"
        INSERT INTO workos_subject_tombstone (
            provider_subject_hash, tombstoned_at, reason
        )
        VALUES ($1, 1, 'subject_erasure')
        "#,
    )
    .bind(identity::workos::subject_fingerprint(subject))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workos_provider_session_tombstone (
            provider_session_hash, tombstoned_at, reason
        )
        VALUES ($1, 1, 'logout')
        "#,
    )
    .bind(
        WorkosSessionId::parse(subject_and_sid)
            .unwrap()
            .fingerprint(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let app =
        api::router_with_state(test_api_state(pool).with_access_token_verifier(Arc::new(verifier)));

    for token in [
        "workos-erased-subject-only",
        "workos-erased-subject-and-sid",
    ] {
        let response = post_workos_session_exchange(&app, Some(token)).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = response_json(response).await;
        assert_eq!(body["error"], "NotAuthorized");
        assert!(body.get("provider_logout_url").is_none(), "body: {body}");
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn unverified_malformed_and_expired_workos_assertions_never_receive_logout_recovery(
    pool: sqlx::PgPool,
) {
    let expired_sid = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0H").unwrap();
    let verifier = StaticAccessTokenVerifier::new([(
        "workos-expired-verified-token".to_string(),
        VerifiedIdentity {
            subject: "user_expired_workos_recovery".to_string(),
            session_id: expired_sid.clone(),
            issued_at: 0,
            expires_at: 1,
            signing_key_id: "test-workos-key".to_string(),
            email: None,
        },
    )]);
    sqlx::query(
        r#"
        INSERT INTO workos_provider_session_tombstone (
            provider_session_hash, tombstoned_at, reason
        )
        VALUES ($1, 1, 'logout')
        "#,
    )
    .bind(expired_sid.fingerprint())
    .execute(&pool)
    .await
    .unwrap();
    let app =
        api::router_with_state(test_api_state(pool).with_access_token_verifier(Arc::new(verifier)));

    for token in [
        Some("not.a.valid.jwt"),
        Some("unverified-workos-token"),
        Some("workos-expired-verified-token"),
        None,
    ] {
        let response = post_workos_session_exchange(&app, token).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = response_json(response).await;
        assert_eq!(body["error"], "NotAuthorized");
        assert!(body.get("provider_logout_url").is_none(), "body: {body}");
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_exchange_binds_a_stable_local_principal_and_coexists_with_classic(
    pool: sqlx::PgPool,
) {
    let verifier = StaticAccessTokenVerifier::new([
        (
            "workos-access-token".to_string(),
            VerifiedIdentity {
                subject: "user_01HWORKOS".to_string(),
                session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: Some("player@example.test".to_string()),
            },
        ),
        (
            "workos-access-token-2".to_string(),
            VerifiedIdentity {
                subject: "user_01HWORKOS".to_string(),
                session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: Some("player@example.test".to_string()),
            },
        ),
        (
            "workos-access-token-3".to_string(),
            VerifiedIdentity {
                subject: "user_01HWORKOS".to_string(),
                session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: Some("player@example.test".to_string()),
            },
        ),
    ]);
    let app = api::router_with_state(
        test_api_state(pool.clone()).with_access_token_verifier(Arc::new(verifier)),
    );

    // The WorkOS access token is exchanged exactly once for a backend session.
    let invitation = community_invitation_for(&pool, "player@example.test").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-access-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "method": "workos",
                        "invitation_credential": invitation
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let session_token = session["session_token"].as_str().unwrap().to_string();
    assert!(session_token.starts_with("fmss_"));
    assert!(session["expires_at"].as_i64().unwrap() > 0);
    let replay = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-access-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "method": "workos" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::CONFLICT);

    // A second exact assertion minted by the same WorkOS session is distinct
    // authority and may be exchanged once as well. Replay identity is the
    // token hash, not the provider `sid`.
    let second = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-access-token-2")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "method": "workos" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = to_bytes(second.into_body(), usize::MAX).await.unwrap();
    let second_session: serde_json::Value = serde_json::from_slice(&second_body).unwrap();
    let second_session_token = second_session["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    let second_replay = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-access-token-2")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "method": "workos" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_replay.status(), StatusCode::CONFLICT);
    let second_session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header("authorization", format!("Bearer {second_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_session_response.status(), StatusCode::OK);

    // The app session is the bearer; the provider JWT is rejected outside the
    // exchange.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header("authorization", format!("Bearer {session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header("authorization", "Bearer workos-access-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let bindings = sqlx::query_as::<_, (String, Uuid, String)>(
        r#"
        SELECT identity.subject, identity.principal_id, identity.display_label
        FROM external_identity AS identity
        WHERE identity.provider = 'workos'
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0].0, "user_01HWORKOS");
    assert_eq!(bindings[0].2, "player@example.test");

    // Classic routes stay mounted alongside WorkOS; malformed input is a
    // validation reject, not a hidden surface.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "account_id": "", "password": "" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // Disabling the principal kills both the existing session and any future
    // exchange.
    sqlx::query(
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 1 WHERE principal_id = $1",
    )
    .bind(bindings[0].1)
    .execute(&pool)
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/session")
                .header("authorization", format!("Bearer {session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("authorization", "Bearer workos-access-token-3")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "method": "workos" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_logout_revokes_the_local_provider_session_scope_and_returns_a_constrained_url(
    pool: sqlx::PgPool,
) {
    let session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
    let verifier = StaticAccessTokenVerifier::new(
        [
            "workos-logout-token-a",
            "workos-logout-token-b",
            "workos-logout-token-unused",
        ]
        .map(|token| {
            (
                token.to_string(),
                VerifiedIdentity {
                    subject: "user_logout".to_string(),
                    session_id: session_id.clone(),
                    issued_at: 1,
                    expires_at: 4_102_444_800,
                    signing_key_id: "test-workos-key".to_string(),
                    email: Some("logout@example.test".to_string()),
                },
            )
        }),
    );
    let app = api::router_with_state(
        test_api_state(pool.clone()).with_access_token_verifier(Arc::new(verifier)),
    );

    let invitation = community_invitation_for(&pool, "logout@example.test").await;
    let mut local_tokens = Vec::new();
    for (index, provider_token) in ["workos-logout-token-a", "workos-logout-token-b"]
        .into_iter()
        .enumerate()
    {
        let exchange = post_bearer_json(
            &app,
            "/auth/sessions",
            serde_json::json!({
                "method": "workos",
                "invitation_credential": (index == 0).then_some(invitation.as_str())
            }),
            provider_token,
        )
        .await;
        assert_eq!(exchange.status(), StatusCode::OK);
        let body = to_bytes(exchange.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        local_tokens.push(body["session_token"].as_str().unwrap().to_string());
    }

    let logout = post_bearer_json(
        &app,
        "/auth/session-logout",
        serde_json::json!({}),
        &local_tokens[0],
    )
    .await;
    assert_eq!(logout.status(), StatusCode::OK);
    let body = to_bytes(logout.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["status"], "logged_out");
    assert_eq!(
        body["provider_logout_url"],
        "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
    );
    // If the first committed response is lost, the exact local bearer remains
    // non-authorizing but can reproduce the same constrained upstream logout
    // navigation while it is otherwise unexpired.
    let retry = post_bearer_json(
        &app,
        "/auth/session-logout",
        serde_json::json!({}),
        &local_tokens[0],
    )
    .await;
    assert_eq!(retry.status(), StatusCode::OK);
    let retry = to_bytes(retry.into_body(), usize::MAX).await.unwrap();
    let retry: serde_json::Value = serde_json::from_slice(&retry).unwrap();
    assert_eq!(retry, body);

    for local_token in &local_tokens {
        let rejected = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/auth/session")
                    .header("authorization", format!("Bearer {local_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    }
    let delayed_assertion = post_bearer_json(
        &app,
        "/auth/sessions",
        serde_json::json!({ "method": "workos" }),
        "workos-logout-token-unused",
    )
    .await;
    assert_eq!(delayed_assertion.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(delayed_assertion).await,
        serde_json::json!({
            "error": "WorkosProviderSessionLogoutRequired",
            "provider_logout_url": "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
        })
    );
    let revocation = sqlx::query_as::<_, (i64, i64)>(
        r#"
        SELECT COUNT(*), COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)
        FROM auth_session
        WHERE workos_session_id = $1
        "#,
    )
    .bind(session_id.as_str())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(revocation, (2, 2));
    let provider_status: String = sqlx::query_scalar(
        "SELECT status FROM workos_provider_session WHERE provider_session_id = $1",
    )
    .bind(session_id.as_str())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(provider_status, "logged_out");
    let audit_metadata: serde_json::Value = sqlx::query_scalar(
        "SELECT metadata FROM identity_lifecycle_audit WHERE event_kind = 'session_logged_out'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_metadata["provider"], "workos");
    assert_eq!(audit_metadata["provider_session_scope"], true);
    assert_eq!(audit_metadata["revoked_session_count"], 2);
    assert!(!audit_metadata.to_string().contains(session_id.as_str()));
    let logout_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE event_kind = 'session_logged_out'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(logout_audits, 1, "a retry is not a second lifecycle event");

    sqlx::query(
        r#"
        UPDATE auth_session
        SET created_at = 1,
            authenticated_at = 1,
            idle_expires_at = 2,
            expires_at = 3
        WHERE token_hash = $1
        "#,
    )
    .bind(identity::token::hash_token(local_tokens[0].as_str()))
    .execute(&pool)
    .await
    .unwrap();
    let expired_retry = post_bearer_json(
        &app,
        "/auth/session-logout",
        serde_json::json!({}),
        &local_tokens[0],
    )
    .await;
    assert_eq!(expired_retry.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_logout_fails_closed_if_persisted_provider_session_custody_is_corrupted(
    pool: sqlx::PgPool,
) {
    let verifier = StaticAccessTokenVerifier::new([(
        "workos-tamper-token".to_string(),
        VerifiedIdentity {
            subject: "user_tamper".to_string(),
            session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
            issued_at: 1,
            expires_at: 4_102_444_800,
            signing_key_id: "test-workos-key".to_string(),
            email: Some("tamper@example.test".to_string()),
        },
    )]);
    let app = api::router_with_state(
        test_api_state(pool.clone()).with_access_token_verifier(Arc::new(verifier)),
    );
    let invitation = community_invitation_for(&pool, "tamper@example.test").await;
    let exchange = post_bearer_json(
        &app,
        "/auth/sessions",
        serde_json::json!({
            "method": "workos",
            "invitation_credential": invitation
        }),
        "workos-tamper-token",
    )
    .await;
    assert_eq!(exchange.status(), StatusCode::OK);
    let exchange_body = to_bytes(exchange.into_body(), usize::MAX).await.unwrap();
    let exchange_body: serde_json::Value = serde_json::from_slice(&exchange_body).unwrap();
    let local_token = exchange_body["session_token"].as_str().unwrap();

    // Simulate storage corruption below the catalog invariant. Runtime
    // validation must still reject it rather than reflecting attacker-chosen
    // bytes into a provider navigation URL.
    sqlx::query(
        "ALTER TABLE auth_session DROP CONSTRAINT auth_session_workos_session_shape_check, DROP CONSTRAINT auth_session_workos_provider_session_fkey",
    )
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE auth_session SET workos_session_id = 'session_invalid&return_to=https://evil.test'",
    )
    .execute(&pool)
    .await
    .unwrap();

    let logout = post_bearer_json(
        &app,
        "/auth/session-logout",
        serde_json::json!({}),
        local_token,
    )
    .await;
    assert_eq!(logout.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(logout.into_body(), usize::MAX).await.unwrap();
    assert!(!body.windows(9).any(|window| window == b"evil.test"));
}

async fn create_media_upload_account_session(app: &axum::Router, label: &str) -> (String, String) {
    let account_id = format!("media-upload-{label}@example.test");
    let principal_id = format!("media_upload_{label}");
    let password = "correct horse battery";
    let admin_token =
        issue_dev_session(app, &format!("media_admin_{label}"), &["GlobalAdmin"]).await;
    create_test_auth_account(app, &admin_token, &account_id, password, &principal_id).await;
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
                        "password": password
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let session_token = response["session_token"].as_str().unwrap().to_string();
    (session_token, principal_id)
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

async fn post_bearer_json(
    app: &axum::Router,
    uri: &str,
    body: serde_json::Value,
    token: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn media_upload_authorized_is_idempotent_and_restart_verified(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool, store.clone())
            .with_local_proof_auth(test_local_proof_verifier())
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn media_upload_rejects_missing_expired_revoked_and_disabled_sessions_without_retention(
    pool: sqlx::PgPool,
) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), store).with_local_proof_auth(test_local_proof_verifier()),
    );
    let png = media_upload_png(2, 2);

    let missing = post_media_upload(&app, None, "image/png", png.clone()).await;
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

    let dev_only_token = issue_dev_session(&app, "media_dev_only", &[]).await;
    let rejected = post_media_upload(&app, Some(&dev_only_token), "image/png", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let (expired_token, expired_principal) =
        create_media_upload_account_session(&app, "expired").await;
    sqlx::query(
        "UPDATE auth_session SET authenticated_at = 1, created_at = 1, expires_at = 2, idle_expires_at = 2 WHERE principal_id = $1",
    )
        .bind(PrincipalId::fixture(&expired_principal).as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let rejected = post_media_upload(&app, Some(&expired_token), "image/png", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let (revoked_token, revoked_principal) =
        create_media_upload_account_session(&app, "revoked").await;
    sqlx::query("UPDATE auth_session SET revoked_at = 1 WHERE principal_id = $1")
        .bind(PrincipalId::fixture(&revoked_principal).as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let rejected = post_media_upload(&app, Some(&revoked_token), "image/png", png.clone()).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let (disabled_token, disabled_principal) =
        create_media_upload_account_session(&app, "disabled").await;
    let disable_admin_token =
        issue_dev_session(&app, "media_disable_admin", &["GlobalAdmin"]).await;
    let disabled = post_bearer_json(
        &app,
        "/auth/accounts/disable",
        serde_json::json!({
            "account_id": "media-upload-disabled@example.test",
            "expected_disabled": false
        }),
        &disable_admin_token,
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::OK);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM auth_session WHERE principal_id = $1 AND revoked_at IS NOT NULL",
        )
        .bind(PrincipalId::fixture(&disabled_principal).as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        1,
    );
    let rejected = post_media_upload(&app, Some(&disabled_token), "image/png", png).await;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(media_blob_entry_count(root.path()), 0);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn media_upload_rejects_type_malformed_dimension_and_body_limits_without_retention(
    pool: sqlx::PgPool,
) {
    let root = tempfile::tempdir().unwrap();
    let media_limits = MediaLimits::new(1_024, 1, 1, 1, 4).unwrap();
    let store = MediaStore::open(root.path(), media_limits).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), store).with_local_proof_auth(test_local_proof_verifier()),
    );
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
            .with_local_proof_auth(test_local_proof_verifier())
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn role_pm_media_reloads_transfers_and_denies_stale_outgoing_session(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), store.clone())
            .with_local_proof_auth(test_local_proof_verifier()),
    );
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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

    let stale_outgoing_ticket =
        issue_websocket_ticket(&app, &outgoing_token, game, &channel_id).await;
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );
    let payload = last_logical_event_payload(&pool, game, "PostSubmitted").await;
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
            quotations: None,
            mentions: None,
            embed: None,
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
                outgoing_persona_id: current_slot_persona_id(&pool, game, "slot_1")
                    .await
                    .as_uuid(),
                incoming_principal_id: PrincipalId::fixture(&incoming_principal),
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
        RejectCode::NotYourSlot,
    );
    drop(app);
    drop(store);
    let restarted = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), restarted).with_local_proof_auth(test_local_proof_verifier()),
    );
    let incoming_ticket = issue_websocket_ticket(&app, &incoming_token, game, &channel_id).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={incoming_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    let initial_role_pm = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );
    let live_role_pm = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
        "ws://{addr}/ws?ticket={stale_outgoing_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let stale_frame =
        tokio::time::timeout(std::time::Duration::from_millis(500), stale_socket.next())
            .await
            .expect("stale scoped socket must be closed promptly");
    assert!(
        !matches!(
            stale_frame,
            Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(_)))
        ),
        "the replaced principal must not receive even Hello on stale Role PM authority"
    );
    drop(socket);
    drop(stale_socket);
    server.abort();

    let thread = get_as_dev_principal(
        &app,
        incoming_principal.as_str(),
        format!("/games/{game}/channels/{channel_id}/thread?limit=10"),
    )
    .await;
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

    let stale_thread = get_as_dev_principal(
        &app,
        outgoing_principal.as_str(),
        format!("/games/{game}/channels/{channel_id}/thread?limit=10"),
    )
    .await;
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn mason_neighbor_rooms_encrypt_reload_transfer_and_deny_nonmembers(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), store).with_local_proof_auth(test_local_proof_verifier()),
    );
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: slot.into(),
                user: principal,
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
                    quotations: None,
                    mentions: None,
                    embed: None,
                },
            )
            .await,
        );
        command_id += 1;
    }

    let stored_private_posts: Vec<_> = logical_event_payloads(&pool, game, "PostSubmitted")
        .await
        .into_iter()
        .filter(|payload| {
            matches!(
                payload["channel_id"].as_str(),
                Some("private:mason" | "private:neighbor")
            )
        })
        .collect();
    assert_eq!(stored_private_posts.len(), 2);
    for payload in &stored_private_posts {
        assert!(payload["body"].is_string());
        assert_eq!(payload["media"][0]["content_id"], upload.content_id);
    }

    for (slot, _outgoing, incoming) in [
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
                    outgoing_persona_id: current_slot_persona_id(&pool, game, slot).await.as_uuid(),
                    incoming_principal_id: PrincipalId::fixture(incoming),
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
                    quotations: None,
                    mentions: None,
                    embed: None,
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
                    quotations: None,
                    mentions: None,
                    embed: None,
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
        let thread = get_as_dev_principal(
            &app,
            incoming,
            format!("/games/{game}/channels/{channel}/thread?limit=10"),
        )
        .await;
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
            let denied_thread = get_as_dev_principal(
                &app,
                denied_principal,
                format!("/games/{game}/channels/{channel}/thread"),
            )
            .await;
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
                    quotations: None,
                    mentions: None,
                    embed: None,
                },
            )
            .await,
            RejectCode::NotAuthorized,
        );
        command_id += 1;
    }

    projections::rebuild(&pool, game).await.unwrap();
    for (channel, incoming, before) in rebuilt_bodies {
        let rebuilt = get_as_dev_principal(
            &app,
            incoming.as_str(),
            format!("/games/{game}/channels/{channel}/thread?limit=10"),
        )
        .await;
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn dead_chat_lifecycle_encrypts_streams_transfers_and_revokes(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), store).with_local_proof_auth(test_local_proof_verifier()),
    );
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: slot.into(),
                user: principal,
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        )
        .await,
    );
    command_id += 1;

    let before_death = get_as_dev_principal(
        &app,
        outgoing.as_str(),
        format!("/games/{game}/channels/dead/thread"),
    )
    .await;
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
                quotations: None,
                mentions: None,
                embed: None,
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );
    command_id += 1;

    let stored = logical_event_payloads(&pool, game, "PostSubmitted")
        .await
        .into_iter()
        .rev()
        .find(|payload| payload["channel_id"] == "dead")
        .expect("dead-chat post event");
    assert_eq!(stored["body"], "dead history with canonical media");
    assert_eq!(stored["media"][0]["content_id"], upload.content_id);

    expect_ack(
        post_command(
            app.clone(),
            command_id,
            "host_h",
            Command::ProcessReplacement {
                game,
                slot: dead_slot.into(),
                outgoing_persona_id: current_slot_persona_id(&pool, game, dead_slot)
                    .await
                    .as_uuid(),
                incoming_principal_id: PrincipalId::fixture(&incoming),
            },
        )
        .await,
    );
    command_id += 1;

    let incoming_ticket = issue_websocket_ticket(&app, &incoming_token, game, "dead").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={incoming_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello: ServerEnvelope = decode_server_envelope(socket.next().await.unwrap().unwrap());
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    let initial_dead_chat = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                decode_server_envelope(socket.next().await.unwrap().unwrap());
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );
    command_id += 1;
    let live_dead_chat = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                decode_server_envelope(socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 1
                        && delta.posts[0].channel_id == "dead"
                        && delta.posts[0].body == "incoming dead-chat live delta"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("dead-chat command publishes a channel-scoped live delta");
    assert!(live_dead_chat.id > initial_dead_chat.id);

    let thread = get_as_dev_principal(
        &app,
        incoming.as_str(),
        format!("/games/{game}/channels/dead/thread?limit=10"),
    )
    .await;
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
        let denied_thread = get_as_dev_principal(
            &app,
            principal,
            format!("/games/{game}/channels/dead/thread"),
        )
        .await;
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
                    quotations: None,
                    mentions: None,
                    embed: None,
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
    let restored_thread = get_as_dev_principal(
        &app,
        incoming.as_str(),
        format!("/games/{game}/channels/dead/thread"),
    )
    .await;
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
        RejectCode::NotAuthorized,
    );

    drop(socket);
    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn spectator_room_grant_reads_host_notices_and_revokes(pool: sqlx::PgPool) {
    let root = tempfile::tempdir().unwrap();
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    let app = api::router_with_state(
        ApiState::new(pool.clone(), store)
            .with_local_proof_auth(test_local_proof_verifier())
            .with_live_projection_delivery_delay(std::time::Duration::from_millis(500)),
    );
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
                cohost_denied: vec![],
            },
        )
        .await,
    );
    let before_grant = get_as_dev_principal(
        &app,
        spectator.as_str(),
        format!("/games/{game}/channels/spectator/thread"),
    )
    .await;
    assert_eq!(before_grant.status(), StatusCode::FORBIDDEN);
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::GrantSpectator {
                game,
                principal_id: PrincipalId::fixture(&spectator),
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
                principal_id: PrincipalId::fixture(&spectator),
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

    let stored = logical_event_payloads(&pool, game, "PostSubmitted")
        .await
        .into_iter()
        .rev()
        .find(|payload| payload["channel_id"] == "spectator")
        .expect("spectator post event");
    assert_eq!(stored["body"], "Host notice for the spectator room");
    assert_eq!(stored["media"][0]["content_id"], content_id);

    let spectator_ticket = issue_websocket_ticket(&app, &spectator_token, game, "spectator").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={spectator_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello: ServerEnvelope = decode_server_envelope(socket.next().await.unwrap().unwrap());
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    let initial_spectator = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope: ServerEnvelope =
                decode_server_envelope(socket.next().await.unwrap().unwrap());
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
                decode_server_envelope(socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.len() == 1
                        && delta.posts[0].channel_id == "spectator"
                        && delta.posts[0].body == "Live spectator notice"
            ) {
                return envelope;
            }
        }
    })
    .await
    .expect("host publication produces a channel-scoped spectator live delta");
    assert!(live_spectator.id > initial_spectator.id);

    let thread = get_as_dev_principal(
        &app,
        spectator.as_str(),
        format!("/games/{game}/channels/spectator/thread?limit=10"),
    )
    .await;
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
        .all(|post| matches!(&post.author, GameThreadAuthor::HostNarrator)));
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
        format!("/games/{game}/channels/dead/thread"),
        format!("/games/{game}/channels/private:role_pm:slot_1/thread"),
        format!("/games/{game}/channels/private:mafia_day_chat/thread"),
        format!("/games/{game}/notifications"),
        format!("/games/{game}/investigation-results"),
        format!("/games/{game}/player-command-state"),
    ] {
        let denied = get_as_dev_principal(&app, spectator.as_str(), path).await;
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
                quotations: None,
                mentions: None,
                embed: None,
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
    // Publication is committed and queued before revocation, but the delivery
    // delay keeps its already-assembled private payload behind the final
    // transaction-held capability fence.
    expect_ack(
        post_command(
            app.clone(),
            7,
            "host_h",
            Command::PublishSpectatorPost {
                game,
                body: "Notice racing spectator revocation".into(),
                media: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            8,
            "host_h",
            Command::RevokeSpectator {
                game,
                principal_id: PrincipalId::fixture(&spectator),
            },
        )
        .await,
    );
    let revoked_thread = get_as_dev_principal(
        &app,
        spectator.as_str(),
        format!("/games/{game}/channels/spectator/thread"),
    )
    .await;
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
            9,
            spectator.as_str(),
            Command::SubmitPost {
                game,
                channel_id: "spectator".into(),
                actor_slot: "invented-slot".into(),
                body: "revoked spectator append attempt".into(),
                media: None,
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
        RejectCode::NotAuthorized,
    );
    expect_ack(
        post_command(
            app,
            10,
            "host_h",
            Command::PublishSpectatorPost {
                game,
                body: "Notice after revocation".into(),
                media: None,
            },
        )
        .await,
    );
    let revoked_live = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while let Some(frame) = socket.next().await {
            match frame {
                Ok(tokio_tungstenite::tungstenite::Message::Binary(bytes)) => {
                    let envelope: ServerEnvelope = ciborium::from_reader(bytes.as_ref()).unwrap();
                    if matches!(
                        envelope.body,
                        ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref thread))
                            if thread.posts.iter().any(|post| matches!(post.body.as_str(),
                                "Notice racing spectator revocation" | "Notice after revocation"))
                    ) {
                        return true;
                    }
                }
                Ok(tokio_tungstenite::tungstenite::Message::Close(_)) | Err(_) => return false,
                _ => {}
            }
        }
        false
    })
    .await
    .expect("revoked spectator socket did not terminate after the delayed delivery fence");
    assert!(
        !revoked_live,
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
    _principal_id: &str,
    command: Command,
) -> ClientEnvelope {
    ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id,
            command,
        }),
    )
}

async fn post_command(
    app: axum::Router,
    id: u64,
    principal_id: &str,
    command: Command,
) -> ServerEnvelope {
    post_command_with_command_id(app, id, stable_command_id(id), principal_id, command).await
}

async fn post_command_with_command_id(
    app: axum::Router,
    id: u64,
    command_id: Uuid,
    principal_id: &str,
    command: Command,
) -> ServerEnvelope {
    let private_claim_principal = match &command {
        Command::SeatPersona { principal_id, .. } => Some(*principal_id),
        Command::ProcessReplacement {
            incoming_principal_id,
            ..
        } => Some(*incoming_principal_id),
        _ => None,
    };
    if let Some(private_claim_principal) = private_claim_principal {
        let _ = issue_dev_session_for_principal(&app, private_claim_principal, &[]).await;
    }
    let global_capabilities = if matches!(&command, Command::CreateGame { .. }) {
        vec!["GlobalAdmin"]
    } else {
        Vec::new()
    };
    let body = serde_json::to_vec(&command_envelope_with_command_id(
        id,
        command_id,
        principal_id,
        command,
    ))
    .unwrap();
    let token = issue_dev_session(&app, principal_id, &global_capabilities).await;
    let response = app
        .clone()
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

async fn current_slot_persona_id(
    pool: &sqlx::PgPool,
    game: Uuid,
    slot: &str,
) -> game_platform::GamePersonaId {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT persona_id FROM slot_occupancy_epoch \
         WHERE game_id = $1 AND slot_id = $2 AND ended_seq IS NULL",
    )
    .bind(game)
    .bind(slot)
    .fetch_one(pool)
    .await
    .map(game_platform::GamePersonaId::from_uuid)
    .expect("slot has one open persona occupancy epoch")
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_1".into(),
                user: "user_a",
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
            wire::seat_persona! {
                game,
                slot: "slot_3".into(),
                user: "user_b",
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
    let _ = issue_dev_session(&app, "cohost_c", &[]).await;
    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![wire::CohostPermissionClass::HostPromptResolve],
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
                wire::seat_persona! {
                    game,
                    slot: slot.into(),
                    user: user_id,
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
            75,
            "host_h",
            Command::AddCohost {
                game,
                principal_id: PrincipalId::fixture("cohost_c"),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            80,
            "host_h",
            Command::StartGame {
                game,
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                && v.phase_id.as_str() == "D01"
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
                wire::seat_persona! {
                    game,
                    slot: slot.into(),
                    user: user_id,
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
                phase: domain::phase::PhaseId::parse("N01")
                    .expect("static test phase id is canonical"),
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
    assert_eq!(winner.phase_id.as_str(), "N01");
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
    assert_eq!(day_one.phase_id.as_str(), "D01");
    assert_eq!(day_one.status, "NoMajority");
    assert_eq!(day_one.winner_slot, None);
    assert_eq!(
        day_one.tallies,
        std::collections::BTreeMap::from([("slot_2".into(), 1.0)])
    );
    assert_eq!(
        day_one.votes,
        std::collections::BTreeMap::from([("slot_1".into(), "slot_2".into())])
    );
    assert_eq!(day_one.majority, Some(2.0));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: PublicGameThreadPage = serde_json::from_slice(&bytes).unwrap();
    let official = page
        .posts
        .iter()
        .find(|post| post.body.starts_with("Official votecount for D01"))
        .expect("official votecount post");

    assert!(matches!(&official.author, GameThreadAuthor::HostNarrator));
    assert!(official.body.contains("- slot_2: 1"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_setup_sequence_commits_to_setup_state(pool: sqlx::PgPool) {
    let app = router(pool);
    let admin_token = issue_dev_session(&app, "host_setup_admin", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &admin_token,
        "mira@example.test",
        "correct horse battery",
        "player_mira",
    )
    .await;
    let game = Uuid::new_v4();
    let raffle_program: game_platform::DayProgram =
        serde_json::from_str(include_str!("../../../programs/raffle.v1.program.json")).unwrap();
    let raffle_program_ref = raffle_program.artifact_ref().unwrap();
    for (id, command) in [
        (
            1,
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_1".into(),
                user: "player_mira",
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
            Command::AttachDayProgram {
                game,
                program_ref: raffle_program_ref.clone(),
            },
        ),
        (
            7,
            Command::StartGame {
                game,
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, "host_h", command).await);
    }
    expect_reject(
        post_command(
            app.clone(),
            8,
            "host_h",
            Command::AttachDayProgram {
                game,
                program_ref: game_platform::DayProgramRef {
                    id: raffle_program_ref.id.clone(),
                    version: raffle_program_ref.version,
                    content_hash: game_platform::ProgramContentHash::new("0".repeat(64)).unwrap(),
                },
            },
        )
        .await,
        RejectCode::DayProgramValidation,
    );

    let host_token = issue_dev_session(&app, "host_h", &[]).await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/setup-state"))
                .header("authorization", format!("Bearer {host_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let serialized_setup = std::str::from_utf8(&bytes).unwrap();
    assert!(!serialized_setup.contains("mira@example.test"));
    assert!(!serialized_setup.contains("\"accounts\""));
    let setup: HostSetupStateResponse = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(setup.game, game);
    assert!(setup.created);
    assert_eq!(setup.pack.key, "mafiascum");
    assert!(setup.pack.valid);
    assert!(setup.pack.role_keys.contains(&"vanilla_townie".to_string()));
    assert!(setup
        .pack
        .roles
        .iter()
        .any(|role| role.key == "vanilla_townie" && role.label == "Vanilla Townie"));
    assert!(setup.pack.start_phase_options.contains(&"D01".to_string()));
    assert!(setup.program_catalog.iter().any(|option| {
        option.program_ref == raffle_program_ref
            && option.display_name == raffle_program.display_name
            && option.event_count == raffle_program.events.len()
            && option.compatibility.attachable
            && option.compatibility.issues.is_empty()
            && option.schedule_previews.len() == 1
            && option.schedule_previews[0].event_id == "raffle-d1"
            && option.schedule_previews[0].mode == "host_opened"
    }));
    assert_eq!(setup.attached_programs.len(), 1);
    assert_eq!(setup.attached_programs[0].program_id, "raffle");
    assert_eq!(setup.attached_programs[0].version, 1);
    assert_eq!(setup.attached_programs[0].event_count, 1);
    assert_eq!(setup.slots.len(), 1);
    assert_eq!(setup.slots[0].slot_id, "slot_1");
    assert!(setup.slots[0]
        .persona_id
        .as_deref()
        .is_some_and(|persona_id| Uuid::parse_str(persona_id).is_ok()));
    assert!(setup.slots[0]
        .public_name
        .as_deref()
        .is_some_and(|public_name| public_name == "Player slot_1"));
    assert_eq!(setup.slots[0].role_key.as_deref(), Some("vanilla_townie"));
    assert_eq!(setup.post_policies.len(), 1);
    assert_eq!(setup.post_policies[0].channel_id, "main");
    assert!(setup.post_policies[0].allow_media_only);
    assert_eq!(
        setup.phase.as_ref().map(|phase| phase.phase_id.as_str()),
        Some("D01")
    );

    let response =
        get_as_dev_principal(&app, "host_h", format!("/games/{game}/host-console-state")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host_state: api::HostConsoleStateResponse = serde_json::from_slice(&bytes).unwrap();
    let narrative = &host_state.day_events[0].narratives;
    assert_eq!(narrative.len(), 4);
    assert!(narrative.iter().all(|row| {
        row.channel_id == "main"
            && row.status == "armed"
            && row.body.is_none()
            && row.template_hash.len() == 64
    }));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_4".into(),
                user: "action-goon",
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
            wire::seat_persona! {
                game,
                slot: "slot-2".into(),
                user: "action-target",
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
            wire::seat_persona! {
                game,
                slot: "slot-3".into(),
                user: "action-town",
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
                phase: domain::phase::PhaseId::parse("N01")
                    .expect("static test phase id is canonical"),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }

    let response = get_as_dev_principal(
        &app,
        "action-goon",
        format!("/games/{game}/player-command-state?slot_id=slot_4"),
    )
    .await;
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
    assert!(state["phase"].get("phase_kind").is_none());
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
    let response = get_as_dev_principal(
        &app,
        "action-goon",
        format!("/games/{game}/player-command-state?slot_id=slot_4"),
    )
    .await;
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
    let response = get_as_dev_principal(
        &app,
        "action-goon",
        format!("/games/{game}/player-command-state?slot_id=slot_4"),
    )
    .await;
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
    let response = get_as_dev_principal(
        &app,
        "action-target",
        format!("/games/{game}/notifications"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let target_notifications: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(target_notifications.len(), 1);
    assert_eq!(target_notifications[0].audience_slot, "slot-2");
    assert_eq!(target_notifications[0].effect, "player_killed");
    assert_eq!(target_notifications[0].status, "factional_kill");

    let response = get_as_dev_principal(
        &app,
        "action-target",
        format!("/games/{game}/player-command-state?slot_id=slot-2"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let dead_state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(dead_state["actor_slot"], "slot-2");
    assert_eq!(dead_state["actor_alive"], false);
    assert_eq!(dead_state["actor_status"], "dead");
    assert_eq!(dead_state["actions"], serde_json::json!([]));

    let response =
        get_as_dev_principal(&app, "action-goon", format!("/games/{game}/notifications")).await;
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        )
        .await,
    );
    let response = get_as_dev_principal(
        &app,
        "action-goon",
        format!("/games/{game}/player-command-state?slot_id=slot_4"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let day_state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(day_state["phase"]["phase_id"], "D01");
    assert_eq!(day_state["actor_alive"], true);
    assert_eq!(day_state["actor_status"], "alive");
    assert_eq!(day_state["actions"], serde_json::json!([]));

    let response = get_as_dev_principal(
        &app,
        "action-target",
        format!("/games/{game}/player-command-state?slot_id=slot_4"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotYourSlot);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_4".into(),
                user: "action-goon",
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
            wire::seat_persona! {
                game,
                slot: "slot-2".into(),
                user: "action-target",
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
            wire::seat_persona! {
                game,
                slot: "slot-3".into(),
                user: "action-town",
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }

    let response = get_as_dev_principal(
        &app,
        "action-town",
        format!("/games/{game}/player-command-state?slot_id=slot-3"),
    )
    .await;
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

    let response = get_as_dev_principal(
        &app,
        "action-town",
        format!("/games/{game}/player-command-state?slot_id=slot-3"),
    )
    .await;
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

    let response = get_as_dev_principal(
        &app,
        "action-town",
        format!("/games/{game}/player-command-state?slot_id=slot-3"),
    )
    .await;
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

    let response = get_as_dev_principal(
        &app,
        "action-town",
        format!("/games/{game}/player-command-state?slot_id=slot-3"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["phase"]["locked"], true);
    assert_eq!(state["vote_targets"], serde_json::json!([]));
    assert_eq!(state["current_vote"], serde_json::Value::Null);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_game_connection_sends_initial_votecount_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;
    let ticket = issue_dev_websocket_ticket(&app, "user_a", game, "main").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let delta = socket.next().await.unwrap().unwrap();
    let delta: ServerEnvelope = decode_server_envelope(delta);
    assert_eq!(delta.id, 1);
    assert!(matches!(
        delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game
                && v.phase_id.as_str() == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 1
    ));

    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_game_connection_streams_command_following_votecount_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;
    let ticket = issue_dev_websocket_ticket(&app, "user_b", game, "main").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_delta = socket.next().await.unwrap().unwrap();
    let initial_delta: ServerEnvelope = decode_server_envelope(initial_delta);
    assert!(matches!(
        initial_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game && v.candidate_slot == "slot_2" && v.count == 1
    ));
    let initial_thread = socket.next().await.unwrap().unwrap();
    let initial_thread: ServerEnvelope = decode_server_envelope(initial_thread);
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
            let envelope: ServerEnvelope = decode_server_envelope(frame);
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::VoteCountChanged(ref v))
                    if v.game == game
                        && v.phase_id.as_str() == "D01"
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
                && v.phase_id.as_str() == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 2
    ));

    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_lag_requests_resync_and_keeps_streaming(pool: sqlx::PgPool) {
    let state = test_api_state(pool)
        .with_local_proof_auth(test_local_proof_verifier())
        .with_live_projection_capacity(1)
        .with_live_projection_delivery_delay(std::time::Duration::from_secs(2));
    let app = api::router_with_state(state);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;
    let ticket = issue_dev_websocket_ticket(&app, "user_b", game, "main").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
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
                    quotations: None,
                    mentions: None,
                    embed: None,
                },
            )
            .await,
        );
    }

    let resync = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );

    let continued = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_game_connection_streams_votecount_clear_delta(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;
    let ticket = issue_dev_websocket_ticket(&app, "user_a", game, "main").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_delta = socket.next().await.unwrap().unwrap();
    let initial_delta: ServerEnvelope = decode_server_envelope(initial_delta);
    assert!(matches!(
        initial_delta.body,
        ServerMsg::Delta(ProjectionDelta::VoteCountChanged(v))
            if v.game == game && v.candidate_slot == "slot_2" && v.count == 1
    ));
    let initial_thread = socket.next().await.unwrap().unwrap();
    let initial_thread: ServerEnvelope = decode_server_envelope(initial_thread);
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
            let envelope: ServerEnvelope = decode_server_envelope(frame);
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::VoteCountCleared(ref v))
                    if v.game == game
                        && v.phase_id.as_str() == "D01"
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
            if v.game == game && v.phase_id.as_str() == "D01" && v.candidate_slot == "slot_2"
    ));

    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_game_connection_streams_thread_delta_after_official_votecount(
    pool: sqlx::PgPool,
) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_single_vote_game(app.clone(), game).await;
    let ticket = issue_dev_websocket_ticket(&app, "user_a", game, "main").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_thread = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
            let envelope: ServerEnvelope = decode_server_envelope(frame);
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.iter().any(|post|
                            matches!(&post.author, GameThreadAuthor::HostNarrator)
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_host_connection_streams_command_following_host_prompts_delta(
    pool: sqlx::PgPool,
) {
    let app = router(pool);
    let game = Uuid::new_v4();
    seed_beloved_princess_ready_to_resolve(app.clone(), game).await;
    let ticket = issue_dev_websocket_ticket(&app, "host_h", game, "main").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_empty_prompts = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
            app.clone(),
            90,
            "host_h",
            Command::ResolvePhase { game, seed: 7421 },
        )
        .await,
    );

    let (prompt_delta_id, task_delta_id) =
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            let mut prompt_delta_id = None;
            let mut task_delta_id = None;
            loop {
                let frame = socket.next().await.unwrap().unwrap();
                let envelope: ServerEnvelope = decode_server_envelope(frame);
                match &envelope.body {
                    ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(delta))
                        if delta.game == game
                            && delta.prompts.iter().any(|prompt| {
                                prompt.prompt_id == "D01:skip_next_day:slot_1"
                                    && prompt.kind == "skip_next_day"
                                    && prompt.status == "pending"
                                    && prompt.reason == "beloved_princess_death"
                            }) =>
                    {
                        prompt_delta_id = Some(envelope.id);
                    }
                    ServerMsg::Delta(ProjectionDelta::HostConsoleTasksChanged(delta))
                        if delta.game == game
                            && delta.tasks.iter().any(|task| {
                                task.id == "engine-host-prompt:D01:skip_next_day:slot_1"
                                    && task.kind == wire::HostTaskKind::EngineHostPrompt
                                    && task.state == wire::HostTaskState::Ready
                                    && task.source_id == "D01:skip_next_day:slot_1"
                                    && task.allowed_commands
                                        == [wire::HostTaskAllowedCommand {
                                            kind: wire::HostTaskCommandKind::ResolveHostPrompt,
                                            permission_class:
                                                wire::CohostPermissionClass::HostPromptResolve,
                                        }]
                            }) =>
                    {
                        task_delta_id = Some(envelope.id);
                    }
                    _ => {}
                }
                if let (Some(prompt_delta_id), Some(task_delta_id)) =
                    (prompt_delta_id, task_delta_id)
                {
                    break (prompt_delta_id, task_delta_id);
                }
            }
        })
        .await
        .expect("host websocket should receive prompt facts and selected task instances");
    assert!(
        prompt_delta_id > initial_empty_prompts.id,
        "command-following prompt delta should follow the initial projection"
    );
    assert!(
        task_delta_id > initial_empty_prompts.id,
        "task selector delta should follow the initial projection"
    );

    let response = get_as_dev_principal(
        &app,
        "cohost_c",
        format!("/games/{game}/host-console-state"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: api::HostConsoleStateResponse = serde_json::from_slice(&bytes).unwrap();
    let task = state
        .tasks
        .iter()
        .find(|task| task.source_id == "D01:skip_next_day:slot_1")
        .expect("denied cohost should still see the blocked decision");
    assert_eq!(task.state, wire::HostTaskState::Blocked);
    assert!(task.allowed_commands.is_empty());
    assert_eq!(
        task.blocked_reason.as_deref(),
        Some("cohost policy denies host_prompt_resolve")
    );

    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn day_event_vertical_exposes_player_attention_and_permission_aware_host_task(
    pool: sqlx::PgPool,
) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();
    let _ = issue_dev_session(&app, "cohost_c", &[]).await;
    expect_ack(
        post_command(
            app.clone(),
            501,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![wire::CohostPermissionClass::DayEventResolve],
            },
        )
        .await,
    );
    for (id, command) in [
        (
            502,
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        ),
        (
            503,
            wire::seat_persona! {
                game,
                slot: "slot_1".into(),
                user: "user_a",
            },
        ),
        (
            504,
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        ),
        (
            505,
            Command::AddCohost {
                game,
                principal_id: PrincipalId::fixture("cohost_c"),
            },
        ),
        (
            506,
            Command::StartGame {
                game,
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        ),
        (
            507,
            Command::ScheduleDayEvent {
                game,
                event: minimal_day_event("event-cookie"),
            },
        ),
        (
            508,
            Command::OpenDayEvent {
                game,
                event_id: game_platform::DayEventId::new("event-cookie").unwrap(),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, "host_h", command).await);
    }

    let response = get_as_dev_principal(
        &app,
        "user_a",
        format!("/games/{game}/player-command-state?slot_id=slot_1"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: api::PlayerCommandStateResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(state.day_events.len(), 1);
    assert_eq!(state.day_events[0].event_id, "event-cookie");
    assert_eq!(state.day_events[0].participant_count, 0);
    assert_eq!(state.day_events[0].minimum_participants, 1);
    assert_eq!(state.day_events[0].maximum_participants, None);
    assert_eq!(state.day_events[0].reward_keys, ["cookie"]);
    assert!(state.day_events[0].can_submit);
    assert!(!state.day_events[0].can_withdraw);

    expect_ack(
        post_command(
            app.clone(),
            509,
            "user_a",
            Command::SubmitDayEventParticipation {
                game,
                event_id: game_platform::DayEventId::new("event-cookie").unwrap(),
                actor_slot: "slot_1".into(),
                payload: game_platform::ParticipationPayload::OptIn,
            },
        )
        .await,
    );
    expect_reject(
        post_command(
            app.clone(),
            510,
            "user_a",
            Command::SubmitDayEventParticipation {
                game,
                event_id: game_platform::DayEventId::new("event-cookie").unwrap(),
                actor_slot: "slot_1".into(),
                payload: game_platform::ParticipationPayload::OptIn,
            },
        )
        .await,
        RejectCode::DuplicateParticipation,
    );
    let response = get_as_dev_principal(
        &app,
        "user_a",
        format!("/games/{game}/player-command-state?slot_id=slot_1"),
    )
    .await;
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: api::PlayerCommandStateResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(state.day_events[0].participation_status, "submitted");
    assert_eq!(state.day_events[0].participant_count, 1);
    assert!(!state.day_events[0].can_submit);
    assert!(state.day_events[0].can_withdraw);
    expect_ack(
        post_command(
            app.clone(),
            511,
            "host_h",
            Command::LockDayEvent {
                game,
                event_id: game_platform::DayEventId::new("event-cookie").unwrap(),
            },
        )
        .await,
    );

    for (principal, expected_state, expected_commands, expected_reason) in [
        ("host_h", wire::HostTaskState::Ready, 1usize, None),
        (
            "cohost_c",
            wire::HostTaskState::Blocked,
            0usize,
            Some("cohost policy denies day_event_resolve"),
        ),
    ] {
        let response =
            get_as_dev_principal(&app, principal, format!("/games/{game}/host-console-state"))
                .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let state: api::HostConsoleStateResponse = serde_json::from_slice(&body).unwrap();
        let workspace = state
            .day_events
            .iter()
            .find(|event| event.event_id == "event-cookie")
            .expect("host DayEvent workspace is hydrated");
        assert_eq!(workspace.state, "locked");
        assert_eq!(workspace.participant_slots, ["slot_1"]);
        assert_eq!(
            workspace.definition.rewards[0].reward_key.as_str(),
            "cookie"
        );
        let task = state
            .tasks
            .iter()
            .find(|task| task.id == "day-event-resolve:event-cookie")
            .expect("locked event selects exactly one host task");
        assert_eq!(task.state, expected_state);
        assert_eq!(task.allowed_commands.len(), expected_commands);
        assert_eq!(task.blocked_reason.as_deref(), expected_reason);
    }

    expect_ack(
        post_command(
            app.clone(),
            512,
            "host_h",
            Command::ResolveDayEvent {
                game,
                event_id: game_platform::DayEventId::new("event-cookie").unwrap(),
                decision: game_platform::DayEventDecision::SelectWinners {
                    slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
                },
            },
        )
        .await,
    );
    expect_reject(
        post_command(
            app.clone(),
            513,
            "host_h",
            Command::ResolveDayEvent {
                game,
                event_id: game_platform::DayEventId::new("event-cookie").unwrap(),
                decision: game_platform::DayEventDecision::SelectWinners {
                    slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
                },
            },
        )
        .await,
        RejectCode::DayEventStateConflict,
    );
    let response =
        get_as_dev_principal(&app, "host_h", format!("/games/{game}/host-console-state")).await;
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: api::HostConsoleStateResponse = serde_json::from_slice(&body).unwrap();
    let resolved = state
        .day_events
        .iter()
        .find(|event| event.event_id == "event-cookie")
        .expect("resolved DayEvent remains visible with evidence");
    assert_eq!(resolved.auto_seed, None);
    assert_eq!(resolved.winner_slots, ["slot_1"]);
    assert_eq!(resolved.reward_keys_applied, ["cookie"]);
    assert!(matches!(
        resolved.resolution_evidence.as_ref(),
        Some(game_platform::DayEventResolutionEvidence::HostDecision {
            participant_slots,
        }) if participant_slots == &[game_platform::SlotId::new("slot_1").unwrap()]
    ));
    assert!(state
        .tasks
        .iter()
        .all(|task| task.id != "day-event-resolve:event-cookie"));

    let response = get_as_dev_principal(
        &app,
        "user_a",
        format!("/games/{game}/player-command-state?slot_id=slot_1"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: api::PlayerCommandStateResponse = serde_json::from_slice(&body).unwrap();
    assert!(
        state.day_events.is_empty(),
        "resolved events leave player attention"
    );
    assert!(projections::slot_effects(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|effect| effect.slot_id == "slot_1" && effect.effect == "bomb"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
                phase: domain::phase::PhaseId::parse("N01")
                    .expect("static test phase id is canonical"),
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

    let ticket = issue_dev_websocket_ticket(&app, "user_2", game, "main").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = socket.next().await.unwrap().unwrap();
    let hello: ServerEnvelope = decode_server_envelope(hello);
    assert!(matches!(hello.body, ServerMsg::Hello(_)));

    let initial_private = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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
            let envelope: ServerEnvelope = decode_server_envelope(frame);
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
                wire::seat_persona! {
                    game,
                    slot: slot.into(),
                    user: user_id,
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
                && outcome.phase_id.as_str() == "D01"
                && outcome.status == "NoLynch"
                && outcome.winner_slot.is_none()
                && outcome.tallies.get("no_lynch") == Some(&2.0)
    )));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_1".into(),
                user: "user_a",
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
                    quotations: None,
                    mentions: None,
                    embed: None,
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
                .uri(format!("/games/{game}?limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: PublicGameThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        page.posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["two", "three"]
    );
    assert!(matches!(
        &page.posts[0].author,
        GameThreadAuthor::Slot { slot_id } if slot_id == "slot_1"
    ));
    let before = page.next_before_seq.expect("older page cursor");

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}?before_seq={before}&limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let older: PublicGameThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(older.posts.len(), 1);
    assert_eq!(older.posts[0].body, "one");
    assert_eq!(older.next_before_seq, None);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn deprecated_raw_game_thread_cannot_bypass_hidden_post_visibility(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let hidden_source_seq = 41_i64;
    let pack_artifact = test_pack_artifact("mafiascum");
    install_test_pack_artifact(&pool, &pack_artifact).await;
    sqlx::query(
        "INSERT INTO game_index \
         (game_id, pack_key, pack_version, pack_content_hash, status, phase_id, created_seq, started_seq, completed_seq, updated_seq) \
         VALUES ($1, $2, $3, $4, 'active', 'D01', 1, 2, NULL, $5)",
    )
    .bind(game)
    .bind(&pack_artifact.pack_ref.key)
    .bind(i64::from(pack_artifact.pack_ref.version))
    .bind(pack_artifact.pack_ref.content_hash.as_str())
    .bind(hidden_source_seq)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO thread_view \
         (game_id, source_seq, stream_seq, channel_id, author_kind, author_slot_id, phase_id, body, body_private, occurred_at) \
         VALUES ($1, $2, $2, 'main', 'host_narrator', NULL, 'D01', 'moderated secret', NULL, 1781928000)",
    )
    .bind(game)
    .bind(hidden_source_seq)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO moderation_target_state \
         (surface_id, source_seq, visibility, reason, moderator_principal_id, updated_seq) \
         VALUES ($1, $2, 'hidden', 'confirmed abuse', $3, 42)",
    )
    .bind(game)
    .bind(hidden_source_seq)
    .bind(PrincipalId::fixture("global_mod").as_uuid())
    .execute(&pool)
    .await
    .unwrap();

    let app = router(pool);
    let public = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(public.status(), StatusCode::OK);
    let public: wire::PublicGameThreadPage =
        serde_json::from_slice(&to_bytes(public.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(
        public.posts.is_empty(),
        "the canonical public game boundary must omit globally hidden posts"
    );

    let raw = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        raw.status(),
        StatusCode::NOT_FOUND,
        "the deprecated raw thread route must not bypass the canonical visibility boundary"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
        let pack_artifact = test_pack_artifact(pack);
        install_test_pack_artifact(&pool, &pack_artifact).await;
        sqlx::query(
            "INSERT INTO game_index (game_id, pack_key, pack_version, pack_content_hash, status, phase_id, created_seq, started_seq, completed_seq, updated_seq) VALUES ($1, $2, $3, $4, $5, $6, 1, 2, $7, $8)",
        )
        .bind(game)
        .bind(&pack_artifact.pack_ref.key)
        .bind(i64::from(pack_artifact.pack_ref.version))
        .bind(pack_artifact.pack_ref.content_hash.as_str())
        .bind(status)
        .bind(phase_id)
        .bind(completed_seq)
        .bind(updated_seq)
        .execute(&pool)
        .await
        .unwrap();
    }

    let app = router_with_local_proof_auth(pool.clone());
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
    assert_eq!(
        latest.games[0]
            .phase_id
            .as_ref()
            .map(domain::phase::PhaseId::as_str),
        Some("D01")
    );
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

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/admin/games")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let admin_token = issue_dev_session(&app, "game_index_admin", &["GlobalAdmin"]).await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/admin/games?limit=100")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let operator_page: GameIndexPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        operator_page
            .games
            .iter()
            .map(|game| (game.game, game.status.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (setup_game, "setup"),
            (completed_game, "completed"),
            (active_game, "active"),
        ]
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/admin/game-bootstrap")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let bootstrap: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let pack_keys = bootstrap["packs"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|pack| pack["key"].as_str())
        .collect::<Vec<_>>();
    assert!(pack_keys.contains(&"mafiascum"));
    assert!(pack_keys.iter().all(|key| !key.starts_with("test_")));

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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn completed_game_export_is_host_gated_and_checksum_bearing(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    assert!(matches!(
        post_command(
            app.clone(),
            91,
            "export_host",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await
        .body,
        ServerMsg::Ack(_)
    ));
    assert!(matches!(
        post_command(
            app.clone(),
            92,
            "export_host",
            Command::CompleteGame { game }
        )
        .await
        .body,
        ServerMsg::Ack(_)
    ));
    let response = get_as_dev_principal(&app, "export_host", format!("/games/{game}/export")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let export: projections::CompletedGameExport =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(export.stream.stream_id, game);
    assert_eq!(export.stream.checksum_sha256.len(), 64);
    assert_eq!(export.archive_checksum_sha256.len(), 64);
    assert!(export
        .stream
        .events
        .iter()
        .any(|event| event.kind == "GameCompleted"));
    assert_eq!(
        get_as_dev_principal(&app, "not_host", format!("/games/{game}/export"))
            .await
            .status(),
        StatusCode::FORBIDDEN,
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_and_public_search_api_enforce_visibility_sessions_and_moderation(
    pool: sqlx::PgPool,
) {
    let app = router_with_local_proof_auth(pool.clone());
    let discussion_member_token = issue_dev_session(&app, "discussion_member", &[]).await;
    let discussion_moderator_token =
        issue_dev_session(&app, "discussion_moderator", &["GlobalMod"]).await;
    let account_admin_token =
        issue_dev_session(&app, "discussion_account_admin", &["GlobalAdmin"]).await;
    for principal_label in ["discussion_member", "discussion_moderator"] {
        create_test_auth_account(
            &app,
            &account_admin_token,
            &format!("{principal_label}@example.test"),
            "correct horse battery",
            principal_label,
        )
        .await;
    }

    for (token, handle, display_name) in [
        (
            discussion_member_token.as_str(),
            "discussion_member",
            "Discussion Member",
        ),
        (
            discussion_moderator_token.as_str(),
            "discussion_moderator",
            "Discussion Moderator",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/profiles")
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "handle": handle,
                            "display_name": display_name,
                            "bio": "Community profile",
                            "visibility": "public"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    let create_area = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/discussions/areas")
                .header(
                    "authorization",
                    format!("Bearer {discussion_moderator_token}"),
                )
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
                    .header("authorization", format!("Bearer {discussion_member_token}"))
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
                .header("authorization", format!("Bearer {discussion_member_token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"posting_state":"locked"}"#))
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
                .header(
                    "authorization",
                    format!("Bearer {discussion_moderator_token}"),
                )
                .header("content-type", "application/json")
                .body(Body::from(r#"{"posting_state":"locked"}"#))
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
                .header("authorization", format!("Bearer {discussion_member_token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"body":"late reply"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected_post.status(), StatusCode::CONFLICT);

    sqlx::query(
        "UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_id = $1",
    )
    .bind(PrincipalId::fixture("discussion_member").as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    let disabled_post = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/discussions/topics/{topic}/posts"))
                .header("authorization", format!("Bearer {discussion_member_token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"body":"disabled reply"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(disabled_post.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/discussions/areas/general/topics/{topic}?limit=10"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let thread: DiscussionThreadPage =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(thread.topic.posting_state, "locked");
    assert_eq!(thread.topic.visibility, "visible");
    assert_eq!(
        thread.posts[0].author.as_ref().unwrap().handle,
        "discussion_member"
    );
    assert_eq!(thread.posts.len(), 1);
    assert_eq!(thread.posts[0].body, "Second opening");

    let search_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/search?q=second&filter=discussions&limit=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(search_response.status(), StatusCode::OK);
    let search: PublicSearchPage = serde_json::from_slice(
        &to_bytes(search_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(search.results.len(), 1);
    assert!(search.results[0].href.contains("/discussions/general/t/"));
    assert_eq!(search.results[0].kind, PublicSearchResultKind::Discussion);
    let first_search_href = search.results[0].href.clone();
    let search_cursor = search.next_cursor.expect("public search cursor");
    let search_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/search?q=second&filter=discussions&limit=1&cursor={search_cursor}"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(search_response.status(), StatusCode::OK);
    let older_search: PublicSearchPage = serde_json::from_slice(
        &to_bytes(search_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(older_search.results.len(), 1);
    assert_ne!(older_search.results[0].href, first_search_href);

    let hidden = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/discussions/topics/{topic}/moderation"))
                .header(
                    "authorization",
                    format!("Bearer {discussion_moderator_token}"),
                )
                .header("content-type", "application/json")
                .body(Body::from(r#"{"visibility":"hidden"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::OK);
    let hidden_search = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/search?q=second&filter=discussions")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let hidden_search: PublicSearchPage = serde_json::from_slice(
        &to_bytes(hidden_search.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(hidden_search.results.is_empty());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_search_cursor_is_opaque_context_bound_and_accepts_each_group(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool);
    for cursor in [
        "abc:1:discussions:key",
        "1:abc:discussions:key",
        "1:1:discussion_topic:key",
        "1:1:discussions:",
        "1:1:discussions",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/search?q=ab&cursor={cursor}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "cursor {cursor} must be rejected"
        );
        let reject: RejectMsg =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(reject.error, RejectCode::InvalidArgument);
    }

    for (filter, filter_value, document_type) in [
        (
            "discussions",
            PublicSearchFilterValue::Discussions,
            "discussion_post",
        ),
        ("profiles", PublicSearchFilterValue::Profiles, "profile"),
        ("games", PublicSearchFilterValue::Games, "game_post"),
    ] {
        let cursor = public_search_test_cursor("ab", filter, document_type);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/search?q=ab&filter={filter}&cursor={cursor}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "filter {filter} cursor {cursor} must parse"
        );
        let page: PublicSearchPage =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(page.filter, filter_value);
        assert!(page.results.is_empty());
    }

    let discussion_cursor = public_search_test_cursor("ab", "discussions", "discussion_post");
    for uri in [
        format!("/search?q=changed&filter=discussions&cursor={discussion_cursor}"),
        format!("/search?q=ab&filter=games&cursor={discussion_cursor}"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let reject: RejectMsg =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(reject.error, RejectCode::InvalidArgument);
    }
}

fn public_search_test_cursor(query: &str, filter: &str, document_type: &str) -> String {
    URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "query_hash": format!("{:x}", Sha256::digest(query.as_bytes())),
            "filter": filter,
            "rank": 1,
            "updated_seq": 1,
            "document_type": document_type,
            "document_key": "doc-1"
        }))
        .unwrap(),
    )
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn member_mute_api_is_authenticated_private_and_reversible(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool);
    let (reader_token, _) = create_media_upload_account_session(&app, "mute-reader").await;
    let (target_token, _) = create_media_upload_account_session(&app, "mute-target").await;
    for (token, handle, display_name) in [
        (&reader_token, "mute_reader", "Mute Reader"),
        (&target_token, "mute_target", "Mute Target"),
    ] {
        let response = post_bearer_json(
            &app,
            "/profiles",
            serde_json::json!({
                "handle": handle,
                "display_name": display_name,
                "bio": "Public mute API profile",
                "visibility": "public"
            }),
            token,
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    let uri = "/mutes/profiles/mute_target";
    let unauthenticated = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let muted = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(muted.status(), StatusCode::OK);
    let muted: MemberMuteState =
        serde_json::from_slice(&to_bytes(muted.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(muted.muted);
    assert_eq!(muted.handle, "mute_target");

    let duplicate = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let self_mute = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mutes/profiles/mute_reader")
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(self_mute.status(), StatusCode::BAD_REQUEST);

    let list = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/mutes?limit=20")
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let list: MemberMutePage =
        serde_json::from_slice(&to_bytes(list.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(list.members.len(), 1);
    assert_eq!(list.members[0].handle, "mute_target");
    assert!(list.next_cursor.is_none());

    let target_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/mutes?limit=20")
                .header("authorization", format!("Bearer {target_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let target_list: MemberMutePage =
        serde_json::from_slice(&to_bytes(target_list.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert!(target_list.members.is_empty());

    let unmuted = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unmuted.status(), StatusCode::OK);
    let unmuted: MemberMuteState =
        serde_json::from_slice(&to_bytes(unmuted.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(!unmuted.muted);
    let duplicate_unmute = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate_unmute.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn subscription_api_keeps_member_inboxes_private_and_cursors_monotonic(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let (author_token, author_principal) =
        create_media_upload_account_session(&app, "subscription-author").await;
    let (watcher_token, watcher_principal) =
        create_media_upload_account_session(&app, "subscription-watcher").await;
    let profile_response = post_bearer_json(
        &app,
        "/profiles",
        serde_json::json!({
            "handle": "subscription_author",
            "display_name": "Subscription Author",
            "bio": "Writes watched topics",
            "visibility": "public"
        }),
        &author_token,
    )
    .await;
    assert_eq!(profile_response.status(), StatusCode::CREATED);

    let area = Uuid::new_v4();
    projections::append_discussion_and_project(
        &pool,
        area,
        &[eventstore::EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({
                "slug": "subscription-api",
                "title": "Subscription API",
                "description": "Watched updates"
            }),
            eventstore::ActorId::Principal(PrincipalId::fixture("moderator")),
            1,
        )],
    )
    .await
    .unwrap();
    let topic_response = post_bearer_json(
        &app,
        "/discussions/areas/subscription-api/topics",
        serde_json::json!({ "title": "API watch", "body": "Opening" }),
        &author_token,
    )
    .await;
    assert_eq!(topic_response.status(), StatusCode::CREATED);
    let topic: DiscussionTopic = serde_json::from_slice(
        &to_bytes(topic_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let subscription_uri = format!("/subscriptions/{}", topic.topic);
    let missing = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(&subscription_uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    let subscribed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(&subscription_uri)
                .header("authorization", format!("Bearer {watcher_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(subscribed.status(), StatusCode::OK);
    let subscribed: SubscriptionTargetState =
        serde_json::from_slice(&to_bytes(subscribed.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert!(subscribed.subscribed);
    assert_eq!(subscribed.unread_count, 0);

    let reply = post_bearer_json(
        &app,
        &format!("/discussions/topics/{}/posts", topic.topic),
        serde_json::json!({ "body": "Watched API reply" }),
        &author_token,
    )
    .await;
    assert_eq!(reply.status(), StatusCode::CREATED);
    let inbox = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inbox")
                .header("authorization", format!("Bearer {watcher_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inbox.status(), StatusCode::OK);
    let inbox: PublicInboxPage =
        serde_json::from_slice(&to_bytes(inbox.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(inbox.unread_count, 1);
    assert_eq!(inbox.items.len(), 1);
    assert!(inbox.items[0]
        .href
        .contains("/discussions/subscription-api/t/"));
    let inbox_json = serde_json::to_string(&inbox).unwrap();
    assert!(!inbox_json.contains(&PrincipalId::fixture(&watcher_principal).to_string()));
    assert!(!inbox_json.contains(&PrincipalId::fixture(&author_principal).to_string()));

    let author_inbox = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inbox")
                .header("authorization", format!("Bearer {author_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let author_inbox: PublicInboxPage = serde_json::from_slice(
        &to_bytes(author_inbox.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(author_inbox.items.is_empty());

    let source_seq = inbox.items[0].source_seq;
    let read = post_bearer_json(
        &app,
        &format!("{subscription_uri}/read"),
        serde_json::json!({ "read_through_seq": source_seq }),
        &watcher_token,
    )
    .await;
    assert_eq!(read.status(), StatusCode::OK);
    let read: SubscriptionTargetState =
        serde_json::from_slice(&to_bytes(read.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(read.unread_count, 0);
    let repeated = post_bearer_json(
        &app,
        &format!("{subscription_uri}/read"),
        serde_json::json!({ "read_through_seq": source_seq }),
        &watcher_token,
    )
    .await;
    assert_eq!(repeated.status(), StatusCode::BAD_REQUEST);

    let unsubscribed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&subscription_uri)
                .header("authorization", format!("Bearer {watcher_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unsubscribed.status(), StatusCode::OK);
    let unsubscribed: SubscriptionTargetState = serde_json::from_slice(
        &to_bytes(unsubscribed.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(!unsubscribed.subscribed);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn moderation_api_keeps_receipts_private_and_actions_public_content_synchronously(
    pool: sqlx::PgPool,
) {
    let verifier = test_local_proof_verifier();
    let app = router_with_local_proof_verifier(pool.clone(), verifier.clone());
    let moderation_app = router_with_local_proof_verifier(pool.clone(), verifier);
    let (member_token, member_principal) =
        create_media_upload_account_session(&app, "moderation-member").await;
    let moderator_principal = "community_moderator";
    let moderator_token = issue_dev_session(&app, moderator_principal, &["GlobalMod"]).await;
    let account_admin_token =
        issue_dev_session(&app, "moderation_account_admin", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &account_admin_token,
        "community-moderator@example.test",
        "correct horse battery",
        moderator_principal,
    )
    .await;

    let upload = post_media_upload(
        &app,
        Some(member_token.as_str()),
        "image/png",
        media_upload_png(300, 225),
    )
    .await;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload: MediaUploadResponse =
        serde_json::from_slice(&to_bytes(upload.into_body(), usize::MAX).await.unwrap()).unwrap();
    let mut post_media_variants = serde_json::Map::new();
    for variant in &upload.variants {
        post_media_variants
            .entry(variant.kind.clone())
            .or_insert_with(|| {
                serde_json::json!({
                    "width": variant.width,
                    "height": variant.height
                })
            });
    }

    let game = Uuid::new_v4();
    let pack_artifact = test_pack_artifact("mafiascum");
    projections::append_and_project(
        &pool,
        game,
        &[
            eventstore::EventInput::new(
                "GameCreated",
                1,
                serde_json::json!({
                    "host_principal_id": PrincipalId::fixture("host"),
                    "pack_ref": pack_artifact.pack_ref.clone(),
                    "pack_artifact": pack_artifact,
                }),
                eventstore::ActorId::Principal(PrincipalId::fixture("host")),
                1,
            ),
            eventstore::EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                eventstore::ActorId::Host,
                2,
            ),
            eventstore::EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "reportable cobalt content",
                    "phase_id": "D01",
                    "media": [{
                        "content_id": upload.content_id,
                        "alt": "Reportable cobalt evidence",
                        "variants": post_media_variants
                    }]
                }),
                eventstore::ActorId::Slot("slot_1".into()),
                3,
            ),
            eventstore::EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "private:role_pm:slot_1",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "private evidence is out of scope",
                    "phase_id": "D01"
                }),
                eventstore::ActorId::Slot("slot_1".into()),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let thread = projections::thread_view(&pool, game, None, 10)
        .await
        .unwrap();
    let public_post = thread
        .posts
        .iter()
        .find(|post| post.channel_id == "main")
        .unwrap();
    let public_source_seq = public_post.source_seq;
    let public_stream_seq = public_post.stream_seq;
    let private_source_seq =
        projections::thread_view_for_channel(&pool, game, "private:role_pm:slot_1", None, 10)
            .await
            .unwrap()
            .posts[0]
            .source_seq;
    let public_before_hide = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public_before_hide: PublicGameThreadPage = serde_json::from_slice(
        &to_bytes(public_before_hide.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let public_media_url = public_before_hide
        .posts
        .iter()
        .find(|post| post.source_seq == public_source_seq)
        .and_then(|post| post.media.first())
        .and_then(|media| media.variants.values().next())
        .map(|variant| variant.avif_url.clone())
        .expect("the public moderation target must expose its canonical media URL");
    let visible_media = get_with_bearer(&app, member_token.as_str(), &public_media_url).await;
    assert_eq!(visible_media.status(), StatusCode::OK);

    let report_body = serde_json::json!({
        "surface_id": game,
        "source_seq": public_source_seq,
        "reason_family": "harassment",
        "details": "member supplied context"
    });
    let response = post_bearer_json(
        &app,
        "/moderation/reports",
        report_body.clone(),
        member_token.as_str(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let receipt: ModerationReportReceipt =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(receipt.status, "received");
    let duplicate = post_bearer_json(
        &app,
        "/moderation/reports",
        report_body,
        member_token.as_str(),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let private_target = post_bearer_json(
        &app,
        "/moderation/reports",
        serde_json::json!({
            "surface_id": game,
            "source_seq": private_source_seq,
            "reason_family": "other"
        }),
        member_token.as_str(),
    )
    .await;
    assert_eq!(private_target.status(), StatusCode::NOT_FOUND);

    let denied_queue = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/moderation/cases")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied_queue.status(), StatusCode::FORBIDDEN);
    let queue = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/moderation/cases")
                .header("authorization", format!("Bearer {moderator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(queue.status(), StatusCode::OK);
    let queue: ModerationCasePage =
        serde_json::from_slice(&to_bytes(queue.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(queue.cases.len(), 1);
    assert_eq!(queue.cases[0].target_body, "reportable cobalt content");
    let case_id = queue.cases[0].case_id;
    let detail = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/moderation/cases/{case_id}"))
                .header("authorization", format!("Bearer {moderator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let detail: ModerationCaseDetail =
        serde_json::from_slice(&to_bytes(detail.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(
        detail.reports[0].reporter_principal_id,
        PrincipalId::fixture(&member_principal)
    );

    let moderator_console = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/games/{game}/host-console-state"))
                .header("authorization", format!("Bearer {moderator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(moderator_console.status(), StatusCode::OK);
    let moderator_console: HostConsoleStateResponse = serde_json::from_slice(
        &to_bytes(moderator_console.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(moderator_console
        .thread_posts
        .iter()
        .any(|post| post.stream_seq == public_stream_seq));

    let ticket = issue_websocket_ticket(&app, member_token.as_str(), game, "main").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = decode_server_envelope(socket.next().await.unwrap().unwrap());
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope = decode_server_envelope(socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.iter().any(|post| post.source_seq == public_source_seq)
            ) {
                return;
            }
        }
    })
    .await
    .expect("the live client should hydrate the visible post before moderation");

    let moderator_ticket =
        issue_websocket_ticket(&app, moderator_token.as_str(), game, "main").await;
    let (mut moderator_socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={moderator_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = decode_server_envelope(moderator_socket.next().await.unwrap().unwrap());
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope = decode_server_envelope(moderator_socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::HostConsoleStateChanged(ref delta))
                    if delta.game == game
                        && delta.thread_posts.iter().any(|post| post.stream_seq == public_stream_seq)
            ) {
                return;
            }
        }
    })
    .await
    .expect("the moderator socket should hydrate the initially visible host-console post");

    let hidden = post_bearer_json(
        &moderation_app,
        format!("/moderation/cases/{case_id}/actions").as_str(),
        serde_json::json!({ "action": "hide", "reason": "confirmed harassment" }),
        moderator_token.as_str(),
    )
    .await;
    assert_eq!(hidden.status(), StatusCode::OK);
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope = decode_server_envelope(socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostRemoved(ref delta))
                    if delta.game == game && delta.source_seq == public_source_seq
            ) {
                return;
            }
        }
    })
    .await
    .expect("a connected public client must purge a post immediately after it is hidden");
    let hidden_snapshot = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope = decode_server_envelope(socket.next().await.unwrap().unwrap());
            if let ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(delta)) = envelope.body {
                if delta.game == game {
                    return delta;
                }
            }
        }
    })
    .await
    .expect("hide must follow the tombstone with a visibility-filtered thread snapshot");
    assert!(
        hidden_snapshot
            .posts
            .iter()
            .all(|post| post.source_seq != public_source_seq),
        "the visibility-filtered snapshot must not resurrect the hidden source sequence"
    );
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope = decode_server_envelope(moderator_socket.next().await.unwrap().unwrap());
            if let ServerMsg::Delta(ProjectionDelta::HostConsoleThreadPostRemoved(delta)) =
                envelope.body
            {
                if delta.game == game && delta.stream_seq == public_stream_seq {
                    return;
                }
            }
        }
    })
    .await
    .expect("a connected host/global-operator client must purge the hidden post");
    let hidden_media = get_with_bearer(&app, member_token.as_str(), &public_media_url).await;
    assert_eq!(
        hidden_media.status(),
        StatusCode::NOT_FOUND,
        "hiding the post must close direct retrieval of its canonical media"
    );
    let public = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public: wire::PublicGameThreadPage =
        serde_json::from_slice(&to_bytes(public.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(public.posts.is_empty());
    let search = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/search?q=cobalt&filter=games")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let search: PublicSearchPage =
        serde_json::from_slice(&to_bytes(search.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(search.results.is_empty());

    let host_console = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/games/{game}/host-console-state"))
                .header("authorization", format!("Bearer {moderator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(host_console.status(), StatusCode::OK);
    let host_console: HostConsoleStateResponse = serde_json::from_slice(
        &to_bytes(host_console.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        host_console
            .thread_posts
            .iter()
            .all(|post| post.stream_seq != public_stream_seq),
        "host/global-operator reads must not bypass global post visibility"
    );

    // Model the cold-load/socket race directly: a browser may still have the
    // formerly visible post when it reconnects after the hide. Initial live
    // hydration must therefore send the durable tombstone as well as filtered
    // player and host-console snapshots.
    let hidden_ticket = issue_websocket_ticket(&app, moderator_token.as_str(), game, "main").await;
    let (mut hidden_socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={hidden_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let hello = decode_server_envelope(hidden_socket.next().await.unwrap().unwrap());
    assert!(matches!(hello.body, ServerMsg::Hello(_)));
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let mut saw_tombstone = false;
        let mut saw_filtered_thread = false;
        let mut saw_filtered_host_console = false;
        while !(saw_tombstone && saw_filtered_thread && saw_filtered_host_console) {
            let envelope = decode_server_envelope(hidden_socket.next().await.unwrap().unwrap());
            match envelope.body {
                ServerMsg::Delta(ProjectionDelta::ThreadPostRemoved(delta))
                    if delta.game == game && delta.source_seq == public_source_seq =>
                {
                    saw_tombstone = true;
                }
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(delta))
                    if delta.game == game =>
                {
                    assert!(delta
                        .posts
                        .iter()
                        .all(|post| post.source_seq != public_source_seq));
                    saw_filtered_thread = true;
                }
                ServerMsg::Delta(ProjectionDelta::HostConsoleStateChanged(delta))
                    if delta.game == game =>
                {
                    assert!(delta
                        .thread_posts
                        .iter()
                        .all(|post| post.stream_seq != public_source_seq));
                    saw_filtered_host_console = true;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("post-hide hydration must purge stale public and host-console state");
    drop(hidden_socket);

    let receipt_lookup = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/moderation/reports/{}", receipt.report_id))
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let receipt_lookup: ModerationReportReceipt = serde_json::from_slice(
        &to_bytes(receipt_lookup.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(receipt_lookup.status, "hidden");
    let moderator_receipt = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/moderation/reports/{}", receipt.report_id))
                .header("authorization", format!("Bearer {moderator_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(moderator_receipt.status(), StatusCode::NOT_FOUND);

    let restored = post_bearer_json(
        &moderation_app,
        format!("/moderation/cases/{case_id}/actions").as_str(),
        serde_json::json!({ "action": "restore", "reason": "appeal accepted" }),
        moderator_token.as_str(),
    )
    .await;
    assert_eq!(restored.status(), StatusCode::OK);
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let envelope = decode_server_envelope(socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::ThreadPostsChanged(ref delta))
                    if delta.game == game
                        && delta.posts.iter().any(|post| post.source_seq == public_source_seq)
            ) {
                return;
            }
        }
    })
    .await
    .expect("restoring the post should republish the visibility-filtered thread snapshot");
    let public = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public: wire::PublicGameThreadPage =
        serde_json::from_slice(&to_bytes(public.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(public.posts.len(), 1);
    let restored_media = get_with_bearer(&app, member_token.as_str(), &public_media_url).await;
    assert_eq!(
        restored_media.status(),
        StatusCode::OK,
        "restoring the post must restore canonical media retrieval"
    );
    drop(socket);
    drop(moderator_socket);
    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn profile_api_uses_enabled_accounts_and_principal_addressed_editing(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool);
    let (owner_token, owner_principal) =
        create_media_upload_account_session(&app, "profile-owner").await;
    let (other_token, _) = create_media_upload_account_session(&app, "profile-other").await;
    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/profiles")
                .header("authorization", format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"handle":"owner_profile","display_name":"Owner Profile","bio":"Public bio","visibility":"public"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let created_status = created.status();
    let created_body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        created_status,
        StatusCode::CREATED,
        "create profile response: {}",
        String::from_utf8_lossy(&created_body)
    );
    let editor: ProfileEditor = serde_json::from_slice(&created_body).unwrap();
    assert_eq!(editor.handle, "owner_profile");
    assert_eq!(editor.revision, 1);

    let public = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/profiles/owner_profile")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(public.status(), StatusCode::OK);
    let bytes = to_bytes(public.into_body(), usize::MAX).await.unwrap();
    let public: PublicProfile = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(public.display_name, "Owner Profile");
    assert!(!String::from_utf8_lossy(&bytes)
        .contains(&PrincipalId::fixture(&owner_principal).to_string()));

    let other_without_profile = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/profiles/me")
                .header("authorization", format!("Bearer {other_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "display_name": "Takeover",
                        "bio": "No",
                        "visibility": "public",
                        "expected_revision": editor.revision,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(other_without_profile.status(), StatusCode::NOT_FOUND);

    let legacy_targeted_edit = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/profiles/owner_profile")
                .header("authorization", format!("Bearer {other_token}"))
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        legacy_targeted_edit.status(),
        StatusCode::METHOD_NOT_ALLOWED
    );

    let updated = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/profiles/me")
                .header("authorization", format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "display_name": "Owner Profile",
                        "bio": "Private bio",
                        "visibility": "private",
                        "expected_revision": editor.revision,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated: ProfileEditor =
        serde_json::from_slice(&to_bytes(updated.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(updated.visibility, "private");
    assert_eq!(updated.revision, editor.revision + 1);

    let stale = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/profiles/me")
                .header("authorization", format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "display_name": "Stale edit",
                        "bio": "Must not overwrite the newer profile",
                        "visibility": "private",
                        "expected_revision": editor.revision,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let stale: RejectMsg =
        serde_json::from_slice(&to_bytes(stale.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(stale.error, RejectCode::StreamConflict);

    let owner_editor = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/profiles/me/editor")
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(owner_editor.status(), StatusCode::OK);
    let owner_editor: ProfileEditor = serde_json::from_slice(
        &to_bytes(owner_editor.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(owner_editor.visibility, "private");
    assert_eq!(owner_editor.revision, updated.revision);

    let hidden = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/profiles/owner_profile")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn vertical_channel_thread_cold_load_is_channel_scoped_and_authorized(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let game_text = game.to_string();
    let persona_id = Uuid::new_v4();
    let user_a = PrincipalId::fixture("user_a");
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &user_a, &[], 1)
        .await
        .unwrap();
    drop(connection);
    let mut persona_tx = pool.begin().await.unwrap();
    let subject_id = identity::ensure_active_subject(&mut persona_tx, user_a, 1)
        .await
        .unwrap();
    let persona_scope_key = persona_id.to_string();
    let claim_id = identity::insert_subject_claim(
        &mut persona_tx,
        subject_id,
        "game_persona_presentation",
        game,
        Some(&persona_scope_key),
        1,
        &game_platform::GamePersonaPresentation {
            public_name: game_platform::GamePersonaName::new("User A").unwrap(),
        },
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO game_persona (game_id, persona_id, registered_seq) VALUES ($1, $2, 1)",
    )
    .bind(game)
    .bind(persona_id)
    .execute(&mut *persona_tx)
    .await
    .unwrap();
    sqlx::query("INSERT INTO game_persona_subject_binding (game_id, persona_id, subject_id, current_claim_id, lifecycle) VALUES ($1, $2, $3, $4, 'active')")
        .bind(game)
        .bind(persona_id)
        .bind(subject_id.as_uuid())
        .bind(claim_id.as_uuid())
        .execute(&mut *persona_tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO game_persona_public (game_id, persona_id, current_public_name, registered_seq) VALUES ($1, $2, 'User A', 1)")
        .bind(game)
        .bind(persona_id)
        .execute(&mut *persona_tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO slot_occupancy_epoch \
         (game_id, occupancy_id, transition_id, slot_id, persona_id, began_seq, start_reason) \
         VALUES ($1, $2, $3, 'slot_1', $4, 2, 'initial_seating')",
    )
    .bind(game)
    .bind(Uuid::new_v4())
    .bind(Uuid::new_v4())
    .bind(persona_id)
    .execute(&mut *persona_tx)
    .await
    .unwrap();
    persona_tx.commit().await.unwrap();
    let mut member_tx = pool.begin().await.unwrap();
    let member_private = eventstore::encrypt_private_projection(
        &mut member_tx,
        serde_json::json!({
            "role_key": "vanilla_townie",
            "reveals_alignment": "never"
        }),
        &format!(
            "fmarch-projection-v1:private_channel_member:{game_text}:private:role_pm:slot_1:slot_1"
        ),
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO private_channel_member \
         (game_id, channel_id, kind, slot_id, private, source) \
         VALUES ($1, 'private:role_pm:slot_1', 'role_pm', 'slot_1', $2, 'test')",
    )
    .bind(game)
    .bind(member_private)
    .execute(&mut *member_tx)
    .await
    .unwrap();
    member_tx.commit().await.unwrap();
    for (source_seq, channel_id, body) in [
        (10_i64, "main", "main thread post"),
        (11_i64, "private:role_pm:slot_1", "private role note"),
    ] {
        let mut tx = pool.begin().await.unwrap();
        let (body, body_private) = if channel_id == "main" {
            (Some(body), None)
        } else {
            (
                None,
                Some(
                    eventstore::encrypt_private_projection(
                        &mut tx,
                        serde_json::json!({ "body": body }),
                        &format!(
                            "fmarch-projection-v1:thread_view:{game_text}:{source_seq}:{channel_id}"
                        ),
                    )
                    .await
                    .unwrap(),
                ),
            )
        };
        sqlx::query(
            "INSERT INTO thread_view \
             (game_id, source_seq, stream_seq, channel_id, author_kind, author_slot_id, phase_id, body, body_private, occurred_at) \
             VALUES ($1, $2, $2, $3, 'slot', 'slot_1', 'D01', $4, $5, 1781928000)",
        )
        .bind(game)
        .bind(source_seq)
        .bind(channel_id)
        .bind(body)
        .bind(body_private)
        .execute(&mut *tx)
        .await
        .unwrap();
        tx.commit().await.unwrap();
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
    assert_eq!(main.status(), StatusCode::NOT_FOUND);

    let private = get_as_dev_principal(
        &app,
        "user_a",
        format!("/games/{game}/channels/private:role_pm:slot_1/thread?limit=10"),
    )
    .await;
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

    let denied = get_as_dev_principal(
        &app,
        "user_b",
        format!("/games/{game}/channels/private:role_pm:slot_1/thread"),
    )
    .await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn vertical_private_day_event_channel_discloses_zero_bytes_after_denial_or_revocation(
    pool: sqlx::PgPool,
) {
    let app = router(pool.clone());
    let (member_token, member_principal) =
        create_media_upload_account_session(&app, "private-event-member").await;
    let (replacement_token, replacement_principal) =
        create_media_upload_account_session(&app, "private-event-replacement").await;
    let (nonmember_token, _) =
        create_media_upload_account_session(&app, "private-event-nonmember").await;
    let game = Uuid::new_v4();
    let host = caps::Principal::authenticated(PrincipalId::fixture("host_h"));
    for command in [
        commands::Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
        commands::Command::AddSlot {
            game,
            slot: "slot_1".into(),
        },
        commands::seat_persona! {
            game,
            slot: "slot_1".into(),
            user: member_principal.clone(),
        },
        commands::Command::AssignRole {
            game,
            slot: "slot_1".into(),
            role_key: "vanilla_townie".into(),
        },
        commands::Command::StartGame {
            game,
            phase: domain::phase::PhaseId::parse("D01").expect("static test phase id is canonical"),
        },
    ] {
        commands::handle(&pool, &host, command).await.unwrap();
    }
    let mut event = minimal_day_event("event-private-api");
    event.channel_policy = game_platform::EventChannelPolicy::Private {
        membership: game_platform::EventChannelMembership::Participants,
    };
    let event_id = event.id.clone();
    let channel_id = event.channel_policy.channel_id(&event_id).to_string();
    commands::handle(
        &pool,
        &host,
        commands::Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();
    commands::handle(
        &pool,
        &host,
        commands::Command::OpenDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    commands::handle(
        &pool,
        &caps::Principal::authenticated(PrincipalId::fixture(&member_principal)),
        commands::Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    let secret = "event-channel-secret-never-crosses-denied-boundaries";
    commands::handle(
        &pool,
        &caps::Principal::authenticated(PrincipalId::fixture(&member_principal)),
        commands::Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: "slot_1".into(),
            body: secret.into(),
            media: Vec::new(),
            quotations: Vec::new(),
            mentions: Vec::new(),
            embed_url: None,
            embed_snapshot: None,
        },
    )
    .await
    .unwrap();

    let member = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/{channel_id}/thread?limit=10"
                ))
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(member.status(), StatusCode::OK);
    let member_body = to_bytes(member.into_body(), usize::MAX).await.unwrap();
    assert!(String::from_utf8_lossy(&member_body).contains(secret));
    let command_state = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/player-command-state?slot_id=slot_1"))
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(command_state.status(), StatusCode::OK);
    let command_state: api::PlayerCommandStateResponse = serde_json::from_slice(
        &to_bytes(command_state.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(command_state.day_event_rooms.len(), 1);
    assert_eq!(command_state.day_event_rooms[0].channel_id, channel_id);
    assert_eq!(command_state.day_event_rooms[0].member_count, 1);
    assert!(command_state.day_event_rooms[0].posting_allowed);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/{channel_id}/thread?limit=10"
                ))
                .header("authorization", format!("Bearer {nonmember_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let denied_body = to_bytes(denied.into_body(), usize::MAX).await.unwrap();
    assert!(!String::from_utf8_lossy(&denied_body).contains(secret));

    let ticket = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/websocket-tickets")
                .header("authorization", format!("Bearer {member_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "audience": "fmarch-live",
                        "game": game,
                        "channel": channel_id,
                        "slot_id": "slot_1",
                        "after_seq": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ticket.status(), StatusCode::OK);

    commands::handle(
        &pool,
        &caps::Principal::authenticated(PrincipalId::fixture(&member_principal)),
        commands::Command::WithdrawDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .unwrap();
    for denied_request in [
        Request::builder()
            .method("GET")
            .uri(format!(
                "/games/{game}/channels/{channel_id}/thread?limit=10"
            ))
            .header("authorization", format!("Bearer {member_token}"))
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/auth/websocket-tickets")
            .header("authorization", format!("Bearer {member_token}"))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({
                    "audience": "fmarch-live",
                    "game": game,
                    "channel": channel_id,
                    "slot_id": "slot_1",
                    "after_seq": 0
                })
                .to_string(),
            ))
            .unwrap(),
        Request::builder()
            .method("GET")
            .uri(format!(
                "/media/thread/{game}/{channel_id}/1/{}/thumb.webp",
                "0".repeat(64)
            ))
            .header("authorization", format!("Bearer {member_token}"))
            .body(Body::empty())
            .unwrap(),
    ] {
        let denied = app.clone().oneshot(denied_request).await.unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let denied_body = to_bytes(denied.into_body(), usize::MAX).await.unwrap();
        assert!(
            !String::from_utf8_lossy(&denied_body).contains(secret),
            "revoked REST, WebSocket-ticket, and media boundaries disclose zero private bytes"
        );
    }

    let revoked_state = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/player-command-state?slot_id=slot_1"))
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let revoked_state: api::PlayerCommandStateResponse = serde_json::from_slice(
        &to_bytes(revoked_state.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(revoked_state.day_event_rooms.is_empty());

    commands::handle(
        &pool,
        &caps::Principal::authenticated(PrincipalId::fixture(&member_principal)),
        commands::Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    commands::handle(
        &pool,
        &host,
        commands::Command::ProcessReplacement {
            game,
            slot: "slot_1".into(),
            outgoing_persona_id: current_slot_persona_id(&pool, game, "slot_1").await,
            incoming_principal_id: PrincipalId::fixture(&replacement_principal),
        },
    )
    .await
    .unwrap();

    let outgoing_state = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/player-command-state?slot_id=slot_1"))
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(outgoing_state.status(), StatusCode::FORBIDDEN);

    commands::handle(
        &pool,
        &host,
        commands::Command::LockDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    let replacement_state = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/player-command-state?slot_id=slot_1"))
                .header("authorization", format!("Bearer {replacement_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replacement_state.status(), StatusCode::OK);
    let replacement_state: api::PlayerCommandStateResponse = serde_json::from_slice(
        &to_bytes(replacement_state.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(replacement_state.day_event_rooms.len(), 1);
    assert_eq!(replacement_state.day_event_rooms[0].state, "locked");
    assert!(!replacement_state.day_event_rooms[0].posting_allowed);

    let replacement_history = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/channels/{channel_id}/thread?limit=10"
                ))
                .header("authorization", format!("Bearer {replacement_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replacement_history.status(), StatusCode::OK);
    let replacement_history = to_bytes(replacement_history.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&replacement_history).contains(secret));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_1".into(),
                user: "user_a",
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
            },
        ),
    ] {
        expect_ack(post_command(app.clone(), id, principal, command).await);
    }
    let role_pm_member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM private_channel_member \
         WHERE game_id = $1 AND channel_id = 'private:role_pm:slot_1' \
         AND kind = 'RolePm' AND slot_id = 'slot_1'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role_pm_member_count, 1);

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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );
    let payload = last_logical_event_payload(&pool, game, "PostSubmitted").await;
    assert_eq!(payload["channel_id"], "private:role_pm:slot_1");
    assert_eq!(payload["author"]["kind"], "slot");
    assert_eq!(payload["author"]["slot_id"], "slot_1");
    assert_eq!(payload["phase_id"], "D01");
    assert_eq!(payload["body"], "private role confirmation");

    let private_thread = get_as_dev_principal(
        &app,
        "user_a",
        format!("/games/{game}/channels/private:role_pm:slot_1/thread?limit=10"),
    )
    .await;
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
            quotations: None,
            mentions: None,
            embed: None,
        },
    )
    .await;
    expect_reject(denied, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
                quotations: None,
                mentions: None,
                embed: None,
            },
        )
        .await,
    );

    let allowed = get_as_dev_principal(
        &app,
        "goon_user",
        format!("/games/{game}/channels/private:mafia_day_chat/thread?limit=10"),
    )
    .await;
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

    let denied_read = get_as_dev_principal(
        &app,
        "traitor_user",
        format!("/games/{game}/channels/private:mafia_day_chat/thread?limit=10"),
    )
    .await;
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
            quotations: None,
            mentions: None,
            embed: None,
        },
    )
    .await;
    expect_reject(denied_post, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_action_commands_are_capability_gated_and_projected(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();
    let _ = issue_dev_session(&app, "cohost_c", &[]).await;

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
                quotations: None,
                mentions: None,
                embed: None,
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
                principal_id: PrincipalId::fixture("cohost_c"),
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
                at: 1_781_928_000,
            },
        )
        .await,
    );

    expect_ack(
        post_command(
            app.clone(),
            13,
            "cohost_c",
            Command::ProcessReplacement {
                game,
                slot: "slot_7".into(),
                outgoing_persona_id: current_slot_persona_id(&pool, game, "slot_7")
                    .await
                    .as_uuid(),
                incoming_principal_id: PrincipalId::fixture("player_rowan"),
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

    let response = get_as_dev_principal(
        &app,
        "host_h",
        format!("/games/{game}/host-console-state?slot_id=slot_7"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let state: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(state["phase"]["phase_id"], "D01");
    assert_eq!(state["phase"]["deadline"], 1_781_928_000);
    assert_eq!(state["slots"][0]["slot_id"], "slot_7");
    assert_eq!(
        state["slots"][0]["assigned_principal_id"],
        serde_json::json!(PrincipalId::fixture("player_rowan"))
    );
    assert!(state["slots"][0]["persona_id"]
        .as_str()
        .is_some_and(|persona_id| Uuid::parse_str(persona_id).is_ok()));
    assert_eq!(state["slots"][0]["alive"], false);
    assert_eq!(state["slots"][0]["status"], "modkilled");
    assert_eq!(state["thread_posts"][0]["author"]["kind"], "slot");
    assert_eq!(state["thread_posts"][0]["author"]["slot_id"], "slot_7");
    assert_eq!(
        state["thread_posts"][0]["body"],
        "Slot 7 check-in before replacement"
    );

    let response = get_as_dev_principal(
        &app,
        "player_mira",
        format!("/games/{game}/host-console-state?slot_id=slot_7"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn opaque_auth_session_resolves_committed_host_capabilities(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await,
    );

    let disabled_app =
        api::router_with_state(test_api_state(pool.clone()).without_local_proof_auth());
    let disabled_response = disabled_app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/local-proof/sessions")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "principal_id": PrincipalId::fixture("host_h"),
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

    let host_session_token = issue_dev_session(&app, "host_h", &[]).await;

    let disabled_app =
        api::router_with_state(test_api_state(pool.clone()).without_local_proof_auth());
    let disabled_response = disabled_app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {host_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        disabled_response.status(),
        StatusCode::UNAUTHORIZED,
        "a previously issued local-proof bearer must lose all authority when the runtime gate is disabled"
    );

    let disabled_rotation = disabled_app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {host_session_token}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        disabled_rotation.status(),
        StatusCode::UNAUTHORIZED,
        "locked session-update paths must reject a local-proof bearer when the runtime gate is disabled"
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {host_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_id"], fixture_principal_json("host_h"));
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn local_proof_sessions_and_mint_credentials_are_bound_to_one_server_process(
    pool: sqlx::PgPool,
) {
    let first_verifier = test_local_proof_verifier_for(TEST_LOCAL_PROOF_SECRET);
    let first_instance_id = first_verifier.instance_id().clone();
    let second_verifier = test_local_proof_verifier_for(TEST_LOCAL_PROOF_SECRET);
    let second_instance_id = second_verifier.instance_id().clone();
    assert_ne!(first_instance_id, second_instance_id);

    let first_app =
        api::router_with_state(test_api_state(pool.clone()).with_local_proof_auth(first_verifier));
    let second_app =
        api::router_with_state(test_api_state(pool.clone()).with_local_proof_auth(second_verifier));

    // Both servers use the same endpoint credential and already exist before
    // either bearer is minted. Their independent process instances prevent
    // shared storage from making possession of A's token authority in B.
    let first_token = issue_dev_session_for_principal_with_secret(
        &first_app,
        PrincipalId::fixture("boot_a_principal"),
        &[],
        TEST_LOCAL_PROOF_SECRET,
    )
    .await;
    let second_token = issue_dev_session_for_principal_with_secret(
        &second_app,
        PrincipalId::fixture("boot_b_principal"),
        &[],
        TEST_LOCAL_PROOF_SECRET,
    )
    .await;

    let first_stored_instance: String = sqlx::query_scalar(
        "SELECT local_proof_instance_id FROM auth_session WHERE token_hash = $1",
    )
    .bind(identity::token::hash_token(first_token.as_str()))
    .fetch_one(&pool)
    .await
    .unwrap();
    let second_stored_instance: String = sqlx::query_scalar(
        "SELECT local_proof_instance_id FROM auth_session WHERE token_hash = $1",
    )
    .bind(identity::token::hash_token(second_token.as_str()))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first_stored_instance, first_instance_id.as_str());
    assert_eq!(second_stored_instance, second_instance_id.as_str());

    let reconstituted_instance = identity::LocalProofInstanceId::parse(first_stored_instance)
        .expect("stored local-proof designation remains canonical");
    let reconstituted_policy =
        identity::SessionPolicy::from_env().with_local_proof_instance(reconstituted_instance);
    assert!(matches!(
        identity::session::validate_session(
            &pool,
            first_token.as_str(),
            &reconstituted_policy,
            unix_now_seconds(),
        )
        .await,
        Err(identity::IdentityFlowError::Unauthorized)
    ), "a persisted process designation must not reconstruct local-proof authority without the original process store");

    assert_eq!(
        get_with_bearer(&first_app, &first_token, "/auth/session")
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        get_with_bearer(&second_app, &second_token, "/auth/session")
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        get_with_bearer(&first_app, &second_token, "/auth/session")
            .await
            .status(),
        StatusCode::UNAUTHORIZED,
        "server A must reject server B's local-proof bearer"
    );
    assert_eq!(
        get_with_bearer(&second_app, &first_token, "/auth/session")
            .await
            .status(),
        StatusCode::UNAUTHORIZED,
        "server B must reject a bearer minted by A after B started"
    );

    let cross_process_rotation = second_app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cross_process_rotation.status(), StatusCode::UNAUTHORIZED);

    let own_rotation = first_app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {first_token}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(own_rotation.status(), StatusCode::OK);
    let rotated_body = to_bytes(own_rotation.into_body(), usize::MAX)
        .await
        .unwrap();
    let rotated_body: serde_json::Value = serde_json::from_slice(&rotated_body).unwrap();
    let rotated_token = rotated_body["session_token"].as_str().unwrap();
    let rotated_instance: String = sqlx::query_scalar(
        "SELECT local_proof_instance_id FROM auth_session WHERE token_hash = $1",
    )
    .bind(identity::token::hash_token(rotated_token))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rotated_instance, first_instance_id.as_str());

    let mut rejection_body: Option<Vec<u8>> = None;
    for presented_secret in [
        None,
        Some(SECOND_TEST_LOCAL_PROOF_SECRET),
        Some("malformed"),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/auth/local-proof/sessions")
            .header("content-type", "application/json");
        if let Some(secret) = presented_secret {
            request = request.header(api::LOCAL_PROOF_AUTH_HEADER, secret);
        }
        let response = second_app
            .clone()
            .oneshot(
                request
                    .body(Body::from(
                        serde_json::json!({
                            "principal_id": PrincipalId::fixture("boot_b_principal"),
                            "expires_at": 4_102_444_800i64
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        if let Some(expected) = &rejection_body {
            assert_eq!(body.as_ref(), expected.as_slice());
        } else {
            rejection_body = Some(body.to_vec());
        }
    }

    sqlx::query(
        r#"
        INSERT INTO auth_websocket_ticket (
            token_hash, session_reference, access_expires_at,
            audience, game_id, channel_id, after_seq, issued_at, expires_at
        )
        VALUES ($1, $2, 4_102_444_800, 'fmarch-live', $3,
                'main', 0, 1, 4_102_444_800)
        "#,
    )
    .bind(identity::token::hash_token("boot-b-websocket-ticket"))
    .bind(identity::token::hash_token(second_token.as_str()))
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap();
    let startup_cleanup =
        identity::revoke_local_proof_sessions_for_startup(&pool, unix_now_seconds())
            .await
            .unwrap();
    assert_eq!(startup_cleanup.sessions, 2);
    assert_eq!(startup_cleanup.websocket_tickets, 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn dev_global_admin_session_round_trips_global_capability(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool);

    let admin_session_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", format!("Bearer {admin_session_token}"))
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_console_authority_is_scoped_to_the_presented_session(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool);
    let game = Uuid::new_v4();
    expect_ack(
        post_command(
            app.clone(),
            1,
            "game_host",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await,
    );

    let elevated_token = issue_dev_session(&app, "session_scoped_mod", &["GlobalMod"]).await;
    let plain_token = issue_dev_session(&app, "session_scoped_mod", &[]).await;

    for surface in [
        "host-console-state",
        "host-prompts",
        "host-phase-controls",
        "setup-state",
    ] {
        let uri = format!("/games/{game}/{surface}");
        let elevated = get_with_bearer(&app, &elevated_token, &uri).await;
        assert_eq!(
            elevated.status(),
            StatusCode::OK,
            "the explicitly elevated session must retain access to {surface}"
        );

        let plain = get_with_bearer(&app, &plain_token, &uri).await;
        assert_eq!(
            plain.status(),
            StatusCode::FORBIDDEN,
            "a plain session must not borrow GlobalMod from its live sibling on {surface}"
        );
    }

    let elevated_ticket = issue_websocket_ticket(&app, &elevated_token, game, "main").await;
    let plain_ticket = issue_websocket_ticket(&app, &plain_token, game, "main").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, server_app).await.unwrap();
    });
    let (mut elevated_socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={elevated_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let (mut plain_socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={plain_ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    for socket in [&mut elevated_socket, &mut plain_socket] {
        let hello = decode_server_envelope(socket.next().await.unwrap().unwrap());
        assert!(matches!(hello.body, ServerMsg::Hello(_)));
    }

    let mut elevated_host_state = false;
    let mut elevated_host_prompts = false;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !elevated_host_state || !elevated_host_prompts {
            let envelope = decode_server_envelope(elevated_socket.next().await.unwrap().unwrap());
            match envelope.body {
                ServerMsg::Delta(ProjectionDelta::HostConsoleStateChanged(delta))
                    if delta.game == game =>
                {
                    elevated_host_state = true;
                }
                ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(delta))
                    if delta.game == game =>
                {
                    elevated_host_prompts = true;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("the elevated sibling should hydrate both private host projections");

    let plain_host_hydration = tokio::time::timeout(std::time::Duration::from_millis(500), async {
        loop {
            let envelope = decode_server_envelope(plain_socket.next().await.unwrap().unwrap());
            if matches!(
                envelope.body,
                ServerMsg::Delta(ProjectionDelta::HostConsoleStateChanged(_))
                    | ServerMsg::Delta(ProjectionDelta::HostPromptsChanged(_))
            ) {
                return;
            }
        }
    })
    .await;
    assert!(
        plain_host_hydration.is_err(),
        "the plain sibling ticket must not hydrate host deltas while the elevated session exists"
    );

    drop(elevated_socket);
    drop(plain_socket);
    server.abort();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn legacy_session_grant_route_is_absent_even_for_global_admin(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-grants")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "principal_id": PrincipalId::fixture("mod_a"),
                        "expires_at": 4_102_444_800i64,
                        "global_capabilities": ["GlobalMod"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let target_session_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_session WHERE principal_id = $1")
            .bind(PrincipalId::fixture("mod_a").as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        target_session_count, 0,
        "the removed operator route must not mint a target session"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/local-proof/sessions")
                .header("content-type", "application/json")
                .header(api::LOCAL_PROOF_AUTH_HEADER, TEST_LOCAL_PROOF_SECRET)
                .body(Body::from(
                    serde_json::json!({
                        "principal_id": PrincipalId::fixture("mod_a"),
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
    assert_eq!(session["principal_id"], fixture_principal_json("mod_a"));
    assert_eq!(session["capabilities"][0]["kind"], "GlobalMod");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn identity_delivery_intent_is_redacted_and_retryable(pool: sqlx::PgPool) {
    let gateway = Arc::new(LocalDeterministicIdentityDeliveryGateway::new(true));
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
            .with_identity_delivery_gateway(gateway.clone()),
    );
    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &admin_token,
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
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "delivery-invite-raw-token",
                        "account_id": "delivery@example.test",
                        "expected_principal_id": PrincipalId::fixture("delivery_user"),
                        "expires_at": unix_now_seconds() + 3_600
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
    assert_eq!(invite["delivery_status"], "queued");
    assert_eq!(invite["delivery_attempt_count"], 0);
    assert_eq!(invite["delivery_provider_id"], "local-deterministic");
    assert_eq!(invite["delivery_outcome_kind"], "queued");
    assert!(invite["delivery_outcome_code"].is_null());
    let delivery_id = Uuid::parse_str(invite["delivery_id"].as_str().expect("delivery id"))
        .expect("typed delivery id");
    process_next_identity_delivery(&pool, gateway.as_ref(), unix_now_seconds())
        .await
        .unwrap()
        .expect("queued delivery claimed");
    assert!(
        process_next_identity_delivery(&pool, gateway.as_ref(), unix_now_seconds())
            .await
            .unwrap()
            .is_none()
    );

    let (
        credential_hash,
        status,
        attempts,
        next_attempt_at,
        delivered_at,
        last_error,
        provider_id,
        outcome_kind,
        outcome_code,
    ) = sqlx::query_as::<_, (
        String,
        String,
        i32,
        Option<i64>,
        Option<i64>,
        Option<String>,
        String,
        String,
        Option<String>,
    )>(
            "SELECT credential_hash, status, attempt_count, next_attempt_at, delivered_at, last_error, provider_id, outcome_kind, outcome_code FROM auth_delivery_intent WHERE delivery_id = $1",
        )
        .bind(delivery_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "retryable_failed");
    assert_eq!(attempts, 1);
    assert!(next_attempt_at.is_some());
    assert!(delivered_at.is_none());
    assert_eq!(last_error.as_deref(), Some("local_transient"));
    assert_eq!(provider_id, "local-deterministic");
    assert_eq!(outcome_kind, "retryable_failure");
    assert_eq!(outcome_code.as_deref(), Some("local_transient"));
    assert!(!credential_hash.contains("delivery-invite-raw-token"));
    let credential_envelope = sqlx::query_scalar::<_, String>(
        "SELECT credential_envelope::TEXT FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(credential_envelope.contains("fmarch-event-aead-v1"));
    assert!(!credential_envelope.contains("delivery-invite-raw-token"));
    sqlx::query("UPDATE auth_delivery_intent SET next_attempt_at = 0 WHERE delivery_id = $1")
        .bind(delivery_id)
        .execute(&pool)
        .await
        .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/admin/auth-deliveries")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let queue: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        queue["deliveries"][0]["delivery_id"],
        delivery_id.to_string()
    );
    assert_eq!(queue["deliveries"][0]["retry_eligible"], true);
    assert!(queue["deliveries"][0].get("credential_hash").is_none());
    assert!(queue["deliveries"][0].get("credential_envelope").is_none());
    assert!(!String::from_utf8_lossy(&bytes).contains("delivery-invite-raw-token"));
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
    assert_eq!(retried["delivery_provider_id"], "local-deterministic");
    assert_eq!(retried["delivery_outcome_kind"], "delivered");
    assert!(retried["delivery_outcome_code"].is_null());
    let provider_receipt_id = sqlx::query_scalar::<_, String>(
        "SELECT provider_receipt_id FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(provider_receipt_id, format!("local-{delivery_id}"));
    let audit_rows = sqlx::query_as::<_, (String, Uuid)>(
        "SELECT event_kind, actor_principal_id FROM identity_lifecycle_audit WHERE principal_id = $1 ORDER BY id",
    )
    .bind(PrincipalId::fixture("delivery_user").as_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        audit_rows,
        vec![
            (
                "account_created".to_string(),
                PrincipalId::fixture("admin_a").as_uuid(),
            ),
            (
                "auth_delivery_queued".to_string(),
                PrincipalId::fixture("delivery_user").as_uuid(),
            ),
            (
                "auth_delivery_retryable_failed".to_string(),
                PrincipalId::fixture("delivery_user").as_uuid(),
            ),
            (
                "auth_delivery_retried".to_string(),
                PrincipalId::fixture("admin_a").as_uuid(),
            ),
        ]
    );
    let outcome_audits = sqlx::query_as::<_, (String, Uuid, String, serde_json::Value)>(
        r#"
        SELECT event_kind, actor_principal_id, token_hash, metadata
        FROM identity_lifecycle_audit
        WHERE principal_id = $1
          AND event_kind IN ('auth_delivery_retryable_failed', 'auth_delivery_retried')
        ORDER BY id
        "#,
    )
    .bind(PrincipalId::fixture("delivery_user").as_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(outcome_audits.len(), 2);
    assert_eq!(outcome_audits[0].0, "auth_delivery_retryable_failed");
    assert_eq!(
        outcome_audits[0].1,
        PrincipalId::fixture("delivery_user").as_uuid()
    );
    assert_eq!(outcome_audits[0].2, credential_hash);
    assert_eq!(
        outcome_audits[0].3,
        serde_json::json!({
            "delivery_id": delivery_id,
            "delivery_kind": "invite",
            "account_id": "delivery@example.test",
            "adapter": "local-deterministic",
            "provider_id": "local-deterministic",
            "outcome_kind": "retryable_failure",
            "outcome_code": "local_transient",
            "provider_receipt_id": null
        })
    );
    assert_eq!(outcome_audits[1].0, "auth_delivery_retried");
    assert_eq!(
        outcome_audits[1].1,
        PrincipalId::fixture("admin_a").as_uuid()
    );
    assert_eq!(outcome_audits[1].2, outcome_audits[0].2);
    assert_eq!(
        outcome_audits[1].3,
        serde_json::json!({
            "delivery_id": delivery_id,
            "delivery_kind": "invite",
            "account_id": "delivery@example.test",
            "adapter": "local-deterministic",
            "provider_id": "local-deterministic",
            "outcome_kind": "delivered",
            "outcome_code": null,
            "provider_receipt_id": provider_receipt_id
        })
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn identity_delivery_gateway_persists_terminal_provider_outcomes(pool: sqlx::PgPool) {
    let gateway = Arc::new(PermanentFailureIdentityDeliveryGateway);
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
            .with_identity_delivery_gateway(gateway.clone()),
    );
    let admin_token = issue_dev_session(&app, "permanent_admin", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &admin_token,
        "permanent-delivery@example.test",
        "correct horse battery",
        "permanent_delivery_user",
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "permanent-delivery-invite-token",
                        "account_id": "permanent-delivery@example.test",
                        "expected_principal_id": PrincipalId::fixture("permanent_delivery_user"),
                        "expires_at": unix_now_seconds() + 3_600
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
    assert_eq!(invite["delivery_status"], "queued");
    assert_eq!(invite["delivery_provider_id"], "fixture-permanent");
    assert_eq!(invite["delivery_outcome_kind"], "queued");
    assert!(invite["delivery_outcome_code"].is_null());
    let delivery_id = Uuid::parse_str(invite["delivery_id"].as_str().expect("delivery id"))
        .expect("typed delivery id");
    process_next_identity_delivery(&pool, gateway.as_ref(), unix_now_seconds())
        .await
        .unwrap()
        .expect("queued delivery claimed");

    let persisted = sqlx::query_as::<_, (String, String, String, Option<String>)>(
        "SELECT status, provider_id, outcome_kind, outcome_code FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persisted.0, "permanent_failed");
    assert_eq!(persisted.1, "fixture-permanent");
    assert_eq!(persisted.2, "permanent_failure");
    assert_eq!(persisted.3.as_deref(), Some("recipient_rejected"));
    let terminal_state = sqlx::query_as::<
        _,
        (
            String,
            Option<Uuid>,
            Option<i64>,
            Option<serde_json::Value>,
            Option<String>,
            Option<i64>,
            Option<i64>,
        ),
    >(
        r#"
        SELECT credential_hash, claim_token, claim_expires_at, credential_envelope,
               provider_receipt_id, next_attempt_at, delivered_at
        FROM auth_delivery_intent
        WHERE delivery_id = $1
        "#,
    )
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(terminal_state.1.is_none());
    assert!(terminal_state.2.is_none());
    assert!(terminal_state.3.is_some());
    assert!(terminal_state.4.is_none());
    assert!(terminal_state.5.is_none());
    assert!(terminal_state.6.is_none());
    let terminal_audit = sqlx::query_as::<_, (String, Uuid, String, serde_json::Value)>(
        r#"
        SELECT event_kind, actor_principal_id, token_hash, metadata
        FROM identity_lifecycle_audit
        WHERE principal_id = $1
          AND event_kind = 'auth_delivery_permanent_failed'
        "#,
    )
    .bind(PrincipalId::fixture("permanent_delivery_user").as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(terminal_audit.0, "auth_delivery_permanent_failed");
    assert_eq!(
        terminal_audit.1,
        PrincipalId::fixture("permanent_delivery_user").as_uuid()
    );
    assert_eq!(terminal_audit.2, terminal_state.0);
    assert_eq!(
        terminal_audit.3,
        serde_json::json!({
            "delivery_id": delivery_id,
            "delivery_kind": "invite",
            "account_id": "permanent-delivery@example.test",
            "adapter": "fixture-permanent",
            "provider_id": "fixture-permanent",
            "outcome_kind": "permanent_failure",
            "outcome_code": "recipient_rejected",
            "provider_receipt_id": null
        })
    );

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
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn identity_delivery_claim_cancels_an_inactive_credential(pool: sqlx::PgPool) {
    let gateway = Arc::new(UnexpectedIdentityDeliveryGateway);
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
            .with_identity_delivery_gateway(gateway.clone()),
    );
    let admin_token = issue_dev_session(&app, "cancel_delivery_admin", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &admin_token,
        "cancel-delivery@example.test",
        "correct horse battery",
        "cancel_delivery_user",
    )
    .await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "cancel-delivery-invite-token",
                        "account_id": "cancel-delivery@example.test",
                        "expected_principal_id": PrincipalId::fixture("cancel_delivery_user"),
                        "expires_at": unix_now_seconds() + 3_600
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
    let delivery_id = Uuid::parse_str(invite["delivery_id"].as_str().expect("delivery id"))
        .expect("typed delivery id");
    let credential_hash = sqlx::query_scalar::<_, String>(
        "SELECT credential_hash FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE game_invitation SET revoked_at = 1 WHERE token_hash = $1")
        .bind(&credential_hash)
        .execute(&pool)
        .await
        .unwrap();

    let cancelled_at = unix_now_seconds();
    assert!(
        process_next_identity_delivery(&pool, gateway.as_ref(), cancelled_at)
            .await
            .unwrap()
            .is_none()
    );
    let cancelled = sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<Uuid>,
            Option<i64>,
            Option<serde_json::Value>,
        ),
    >(
        r#"
        SELECT status, outcome_kind, outcome_code, next_attempt_at, delivered_at,
               last_error, provider_receipt_id, claim_token, claim_expires_at,
               credential_envelope
        FROM auth_delivery_intent
        WHERE delivery_id = $1
        "#,
    )
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cancelled.0, "cancelled");
    assert_eq!(cancelled.1, "cancelled");
    assert_eq!(cancelled.2.as_deref(), Some("credential_inactive"));
    assert!(cancelled.3.is_none());
    assert!(cancelled.4.is_none());
    assert_eq!(cancelled.5.as_deref(), Some("credential_inactive"));
    assert!(cancelled.6.is_none());
    assert!(cancelled.7.is_none());
    assert!(cancelled.8.is_none());
    assert!(cancelled.9.is_none());

    let audit = sqlx::query_as::<_, (i64, String, Uuid, Uuid, String, serde_json::Value)>(
        r#"
        SELECT event_at, event_kind, actor_principal_id, principal_id, token_hash, metadata
        FROM identity_lifecycle_audit
        WHERE event_kind = 'auth_delivery_cancelled'
          AND principal_id = $1
        "#,
    )
    .bind(PrincipalId::fixture("cancel_delivery_user").as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, cancelled_at);
    assert_eq!(audit.1, "auth_delivery_cancelled");
    assert_eq!(
        audit.2,
        PrincipalId::fixture("cancel_delivery_user").as_uuid()
    );
    assert_eq!(
        audit.3,
        PrincipalId::fixture("cancel_delivery_user").as_uuid()
    );
    assert_eq!(audit.4, credential_hash);
    assert_eq!(
        audit.5,
        serde_json::json!({
            "delivery_id": delivery_id,
            "delivery_kind": "invite",
            "account_id": "cancel-delivery@example.test",
            "adapter": "fixture-cancel",
            "provider_id": "fixture-cancel",
            "outcome_kind": "cancelled",
            "outcome_code": "credential_inactive",
            "provider_receipt_id": null
        })
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn community_invitation_delivery_accepts_a_prospective_account_without_leaking_the_credential(
    pool: sqlx::PgPool,
) {
    let app = router_with_local_proof_auth(pool.clone());
    let sponsor = PrincipalId::fixture("community_sponsor");
    let sponsor_token = issue_dev_session_for_principal(&app, sponsor, &[]).await;
    membership_application::ensure_founder_membership(&pool, sponsor, unix_now_seconds())
        .await
        .unwrap();
    let recipient = "future.member@example.test";
    assert!(!sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM auth_account WHERE account_id = $1)",
    )
    .bind(recipient)
    .fetch_one(&pool)
    .await
    .unwrap());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/community/invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {sponsor_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "account_id": recipient,
                        "expires_at": unix_now_seconds() + 3_600
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let issued: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(issued["invitation"]["target_account_id"], recipient);
    assert!(issued["invitation"].get("credential").is_none());
    assert_eq!(issued["delivery_status"], "queued");

    let invitation_id = Uuid::parse_str(
        issued["invitation"]["invitation_id"]
            .as_str()
            .expect("invitation id"),
    )
    .unwrap();
    let (delivery_kind, account_id, delivery_hash, envelope) =
        sqlx::query_as::<_, (String, String, String, Option<serde_json::Value>)>(
            r#"
            SELECT delivery_kind, account_id, credential_hash, credential_envelope
            FROM auth_delivery_intent
            WHERE delivery_id = $1
            "#,
        )
        .bind(Uuid::parse_str(issued["delivery_id"].as_str().expect("delivery id")).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(delivery_kind, "community_invitation");
    assert_eq!(account_id, recipient);
    assert!(envelope.is_some());
    let credential_hash = sqlx::query_scalar::<_, String>(
        "SELECT token_hash FROM community_invitation_credential WHERE invitation_id = $1",
    )
    .bind(invitation_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(delivery_hash, credential_hash);
    let audit_metadata = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT metadata FROM identity_lifecycle_audit WHERE event_kind = 'auth_delivery_queued' AND token_hash = $1",
    )
    .bind(&credential_hash)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(audit_metadata.get("account_id").is_none());
    assert!(!audit_metadata.to_string().contains(recipient));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn community_stewardship_is_global_admin_only_and_never_returns_recipient_identity(
    pool: sqlx::PgPool,
) {
    let app = router_with_local_proof_auth(pool.clone());
    let now = unix_now_seconds();
    let admin = PrincipalId::fixture("community_steward_admin");
    let member = PrincipalId::fixture("community_steward_member");
    let admin_token = issue_dev_session_for_principal(&app, admin, &["GlobalAdmin"]).await;
    let member_token = issue_dev_session_for_principal(&app, member, &[]).await;
    membership_application::ensure_founder_membership(&pool, admin, now)
        .await
        .unwrap();
    let member_id = membership_application::ensure_founder_membership(&pool, member, now)
        .await
        .unwrap();
    let recipient = "private-recipient@example.test";
    let pending = membership_application::issue_invitation(
        &pool,
        &membership_application::InvitationTargetIndex::from_env_or_local().unwrap(),
        member,
        recipient,
        now + 3_600,
        now,
    )
    .await
    .unwrap();

    let forbidden = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin/community/stewardship")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin/community/stewardship")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(!String::from_utf8_lossy(&body).contains(recipient));
    assert_eq!(
        snapshot["pending_invitations"][0]["target_fingerprint"]
            .as_str()
            .unwrap()
            .len(),
        12
    );

    let suspended = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/admin/community/membership-suspensions")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "membership_id": member_id,
                        "reason": "verified stewardship test"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(suspended.status(), StatusCode::OK);
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM community_invitation WHERE invitation_id = $1",
        )
        .bind(pending.invitation_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "revoked"
    );

    let restored = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/admin/community/membership-restorations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({ "membership_id": member_id }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_account_registration_creates_unprivileged_opaque_session(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let invitation = community_invitation_for(&pool, "New.User+One@Example.Test").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/registrations")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invitation_credential": invitation,
                        "account_id": "New.User+One@Example.Test",
                        "password": "correct horse battery"
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
    let principal_id = PrincipalId::from_uuid(
        Uuid::parse_str(
            registered["principal_id"]
                .as_str()
                .expect("registration principal"),
        )
        .expect("registration principal must be a UUID"),
    );
    assert!(registered["expires_at"].as_i64().is_some());
    let registered_session_token = registered["session_token"]
        .as_str()
        .expect("registration returns a backend-generated session token")
        .to_string();

    let duplicate_invitation = community_invitation_for(&pool, "new.user+one@example.test").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header(
                    "authorization",
                    format!("Bearer {registered_session_token}"),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_id"], serde_json::json!(principal_id));
    assert_eq!(session["capabilities"], serde_json::json!([]));

    let (stored_principal, password_hash) = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT principal_id, password_hash FROM auth_account WHERE account_id = $1",
    )
    .bind("new.user+one@example.test")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_principal, principal_id.as_uuid());
    assert!(password_hash.starts_with("$argon2id$"));

    let audit_kinds = sqlx::query_scalar::<_, String>(
        "SELECT event_kind FROM identity_lifecycle_audit WHERE principal_id = $1 ORDER BY id",
    )
    .bind(principal_id.as_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audit_kinds, vec!["community_member_admitted".to_string()]);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/registrations")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invitation_credential": duplicate_invitation,
                        "account_id": "new.user+one@example.test",
                        "password": "correct horse battery"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_account_registration_bounds_hashed_source_attempts(pool: sqlx::PgPool) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_registration_source_limit(2)
            .with_trusted_auth_attempt_source_header(true),
    );
    for (account_id, expected_status) in [
        ("first@example.test", StatusCode::OK),
        ("second@example.test", StatusCode::TOO_MANY_REQUESTS),
    ] {
        let invitation = community_invitation_for(&pool, account_id).await;
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
                            "invitation_credential": invitation,
                            "account_id": account_id,
                            "password": "correct horse battery"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
    }

    let invitation = community_invitation_for(&pool, "other-source@example.test").await;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/registrations")
                .header("content-type", "application/json")
                .header("x-fmarch-auth-source", "198.51.100.72")
                .body(Body::from(
                    serde_json::json!({
                        "invitation_credential": invitation,
                        "account_id": "other-source@example.test",
                        "password": "correct horse battery"
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn global_admin_account_login_creates_normal_role_session(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await,
    );

    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;

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
                        "account_id": "host@example.test",
                        "password": "correct horse battery",
                        "principal_id": PrincipalId::fixture("host_h")
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
    assert_eq!(account["principal_id"], fixture_principal_json("host_h"));

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
                        "password": "wrong password"
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
                        "password": "correct horse battery"
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
    assert_eq!(login["principal_id"], fixture_principal_json("host_h"));
    let host_session_token = login["session_token"]
        .as_str()
        .expect("account login returns a backend-generated session token")
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {host_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_id"], fixture_principal_json("host_h"));
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/disable")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
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
    assert_eq!(disabled["principal_id"], fixture_principal_json("host_h"));
    assert!(disabled["revoked_session_count"].as_u64().unwrap() >= 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {host_session_token}"))
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
                .header("authorization", format!("Bearer {admin_token}"))
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
                        "password": "correct horse battery"
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
                .header("authorization", format!("Bearer {admin_token}"))
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
                        "password": "correct horse battery"
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
    let reenabled_session_token = login["session_token"]
        .as_str()
        .expect("account login returns a backend-generated session token")
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {reenabled_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reenabled_session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        reenabled_session["principal_id"],
        fixture_principal_json("host_h")
    );
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
                .header("authorization", format!("Bearer {reenabled_session_token}"))
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
    assert_eq!(rotation["principal_id"], fixture_principal_json("host_h"));
    assert_eq!(rotation["password_algorithm"], "argon2id");
    assert!(rotation["revoked_session_count"].as_i64().unwrap() >= 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {reenabled_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let mut rotated_password_session_token = None;
    for (password, expected_status) in [
        ("correct horse battery", StatusCode::UNAUTHORIZED),
        ("rotated correct horse battery", StatusCode::OK),
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
                            "password": password
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
        if expected_status == StatusCode::OK {
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let login: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            rotated_password_session_token = Some(
                login["session_token"]
                    .as_str()
                    .expect("login returns a backend-generated session token")
                    .to_string(),
            );
        }
    }
    let rotated_password_session_token = rotated_password_session_token.unwrap();

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
                        format!("Bearer {rotated_password_session_token}"),
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
                    format!("Bearer {rotated_password_session_token}"),
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
    for (credential, expected_code) in [
        (&recovery_credentials[0], "credential_consumed"),
        (&recovery_credentials[1], "credential_revoked"),
    ] {
        let delivery_id = Uuid::parse_str(credential["delivery_id"].as_str().unwrap()).unwrap();
        let delivery = sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT status, outcome_code, credential_envelope::TEXT FROM auth_delivery_intent WHERE delivery_id = $1",
        )
        .bind(delivery_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(delivery.0, "cancelled");
        assert_eq!(delivery.1, expected_code);
        assert!(delivery.2.is_none());
    }

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
                    format!("Bearer {rotated_password_session_token}"),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    for (password, expected_status) in [
        ("rotated correct horse battery", StatusCode::UNAUTHORIZED),
        ("recovered correct horse battery", StatusCode::OK),
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
                            "password": password
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
                .uri(format!(
                    "/auth/identity-lifecycle-audit?principal_id={}",
                    PrincipalId::fixture("host_h")
                ))
                .header("authorization", format!("Bearer {admin_token}"))
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
    for raw_session_token in [
        host_session_token.as_str(),
        reenabled_session_token.as_str(),
        rotated_password_session_token.as_str(),
    ] {
        assert!(!audit_text.contains(raw_session_token));
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_recovery_request_is_non_enumerating_and_rotates_credentials(pool: sqlx::PgPool) {
    let gateway = Arc::new(RecoveryProofIdentityDeliveryGateway::default());
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
            .with_identity_delivery_gateway(gateway.clone()),
    );
    let account_id = "recovery-request@example.test";
    let admin_token = issue_dev_session(&app, "recovery_request_admin", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &admin_token,
        account_id,
        "correct horse battery",
        "recovery_request_user",
    )
    .await;

    for requested_account in [account_id, "missing-recovery@example.test", account_id] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/recovery-requests")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "account_id": requested_account }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body, serde_json::json!({ "status": "accepted" }));
    }

    let credentials = sqlx::query_as::<_, (i64, i64)>(
        r#"
        SELECT COUNT(*)::BIGINT,
               COUNT(*) FILTER (WHERE revoked_at IS NULL)::BIGINT
        FROM auth_account_recovery_credential
        WHERE account_id = $1
        "#,
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(credentials, (2, 1));
    let delivery_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM auth_delivery_intent WHERE account_id = $1 AND delivery_kind = 'recovery'",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(delivery_count, 2);
    let deliveries = sqlx::query_as::<_, (Uuid, String, String, Option<String>, Option<i64>)>(
        r#"
        SELECT delivery.delivery_id,
               delivery.status,
               delivery.outcome_kind,
               delivery.credential_envelope::TEXT,
               recovery.revoked_at
        FROM auth_delivery_intent AS delivery
        JOIN auth_account_recovery_credential AS recovery
          ON recovery.token_hash = delivery.credential_hash
        WHERE delivery.account_id = $1 AND delivery.delivery_kind = 'recovery'
        "#,
    )
    .bind(account_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let cancelled = deliveries
        .iter()
        .find(|delivery| delivery.4.is_some())
        .expect("rotated credential delivery");
    let active = deliveries
        .iter()
        .find(|delivery| delivery.4.is_none())
        .expect("active credential delivery");
    assert_eq!(cancelled.1, "cancelled");
    assert_eq!(cancelled.2, "cancelled");
    assert!(cancelled.3.is_none());
    assert_eq!(active.1, "queued");

    let receipt = process_next_identity_delivery(&pool, gateway.as_ref(), unix_now_seconds())
        .await
        .unwrap()
        .expect("active rotated credential remains deliverable");
    assert_eq!(receipt.delivery_id, active.0);
    let attempts = gateway.attempts();
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0].0, active.0);
    assert_ne!(attempts[0].0, cancelled.0);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn recovery_delivery_is_expiry_bound_redacted_retryable_and_replay_safe(pool: sqlx::PgPool) {
    let gateway = Arc::new(RecoveryProofIdentityDeliveryGateway::default());
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
            .with_identity_delivery_gateway(gateway.clone()),
    );
    let account_id = "recovery-delivery@example.test";
    let admin_token = issue_dev_session(&app, "recovery_delivery_admin", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &admin_token,
        account_id,
        "correct horse battery",
        "recovery_delivery_user",
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/recovery-requests")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "account_id": account_id }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response_bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&response_bytes).unwrap(),
        serde_json::json!({ "status": "accepted" })
    );

    let (delivery_id, expires_at, envelope_text) = sqlx::query_as::<_, (Uuid, i64, String)>(
        r#"
        SELECT delivery_id, credential_expires_at, credential_envelope::TEXT
        FROM auth_delivery_intent
        WHERE account_id = $1 AND delivery_kind = 'recovery'
        ORDER BY created_at DESC, delivery_id DESC
        LIMIT 1
        "#,
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let first = process_next_identity_delivery(&pool, gateway.as_ref(), unix_now_seconds())
        .await
        .unwrap()
        .expect("first recovery delivery attempt");
    assert_eq!(first.status, "retryable_failed");
    assert_eq!(first.outcome_code.as_deref(), Some("local_transient"));
    let attempts = gateway.attempts();
    assert_eq!(attempts.len(), 1);
    let recovery_token = attempts[0].2.clone();
    assert!(recovery_token.starts_with("account-recovery-"));
    assert!(!String::from_utf8_lossy(&response_bytes).contains(&recovery_token));
    assert!(!envelope_text.contains(&recovery_token));
    let debug_attempt = format!(
        "{:?}",
        IdentityDeliveryAttempt {
            delivery_id,
            kind: api::identity_delivery::IdentityDeliveryKind::Recovery,
            account_id: account_id.to_string(),
            principal_id: PrincipalId::fixture("recovery_delivery_user"),
            credential_hash: "redacted-hash".to_string(),
            credential_expires_at: expires_at,
            credential_material: Some(recovery_token.clone()),
            attempt_number: 1,
        }
    );
    assert!(!debug_attempt.contains(&recovery_token));
    assert!(debug_attempt.contains("[sealed]"));

    sqlx::query("UPDATE auth_delivery_intent SET next_attempt_at = 0 WHERE delivery_id = $1")
        .bind(delivery_id)
        .execute(&pool)
        .await
        .unwrap();
    let response = app
        .clone()
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
    let attempts = gateway.attempts();
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0].2, attempts[1].2);

    for expected_status in [StatusCode::OK, StatusCode::UNAUTHORIZED] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/accounts/recoveries")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "account_id": account_id,
                            "recovery_token": recovery_token,
                            "new_password": "new correct horse battery"
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
        .clone()
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
    assert_eq!(response.status(), StatusCode::CONFLICT);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/accounts/recovery-requests")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "account_id": account_id }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let (expiring_delivery_id, expiring_at) = sqlx::query_as::<_, (Uuid, i64)>(
        r#"
        SELECT delivery_id, credential_expires_at
        FROM auth_delivery_intent
        WHERE account_id = $1 AND delivery_kind = 'recovery' AND delivery_id <> $2
        ORDER BY created_at DESC, delivery_id DESC
        LIMIT 1
        "#,
    )
    .bind(account_id)
    .bind(delivery_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let expired = process_next_identity_delivery(&pool, gateway.as_ref(), expiring_at)
        .await
        .unwrap()
        .expect("expired recovery delivery is finalized");
    assert_eq!(expired.delivery_id, expiring_delivery_id);
    assert_eq!(expired.status, "permanent_failed");
    assert_eq!(expired.outcome_code.as_deref(), Some("credential_expired"));
    assert_eq!(gateway.attempts().len(), 2);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_credential_failures_share_a_hashed_retryable_lockout(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let account_id = "throttled-host@example.test";
    let password = "correct horse battery";
    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;
    create_test_auth_account(&app, &admin_token, account_id, password, "host_h").await;

    let failed_requests = [
        (
            "/auth/accounts/login",
            serde_json::json!({
                "account_id": account_id,
                "password": "wrong password"
            }),
        ),
        (
            "/auth/game-invitations/redeem",
            serde_json::json!({
                "invite_token": "invalid-invite",
                "account_id": account_id,
                "password": "wrong password"
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
                        "password": password
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn unknown_credentials_use_one_source_scope_and_prune_stale_rows(pool: sqlx::PgPool) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
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
                "password": "wrong password"
            }),
            "spoofed-source-a",
        ),
        (
            "/auth/game-invitations/redeem",
            serde_json::json!({
                "invite_token": "missing-invite",
                "account_id": "missing-invite@example.test",
                "password": "wrong password"
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
            "password": "wrong password"
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn trusted_credential_sources_cannot_partition_account_lockouts(pool: sqlx::PgPool) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .with_local_proof_auth(test_local_proof_verifier())
            .with_auth_attempt_limits(3, 20, 900, 900, 900)
            .with_trusted_auth_attempt_source_header(true),
    );
    let account_id = "partitioned-host@example.test";
    let password = "correct horse battery";
    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;
    create_test_auth_account(&app, &admin_token, account_id, password, "host_h").await;

    for (source, expected_status) in [
        ("source-a", StatusCode::UNAUTHORIZED),
        ("source-b", StatusCode::UNAUTHORIZED),
        ("source-a", StatusCode::TOO_MANY_REQUESTS),
    ] {
        let response = post_public_auth_json(
            &app,
            "/auth/accounts/login",
            serde_json::json!({
                "account_id": account_id,
                "password": "wrong password"
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
    assert_eq!(attempts_before_success, 3);
    let response = post_public_auth_json(
        &app,
        "/auth/accounts/login",
        serde_json::json!({
            "account_id": account_id,
            "password": password
        }),
        Some("source-b"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let remaining_attempts =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_credential_attempt")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining_attempts, 3);

    let response = post_public_auth_json(
        &app,
        "/auth/accounts/login",
        serde_json::json!({
            "account_id": account_id,
            "password": password
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn global_admin_invite_redeems_to_normal_role_session(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await,
    );

    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;

    create_test_auth_account(
        &app,
        &admin_token,
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
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "expected_principal_id": PrincipalId::fixture("host_h"),
                        "expires_at": unix_now_seconds() + 3_600
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
    assert_eq!(invite["principal_id"], fixture_principal_json("host_h"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "password": "wrong invite password"
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
                .uri("/auth/game-invitations/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "password": "host invite password"
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
    assert_eq!(redeemed["principal_id"], fixture_principal_json("host_h"));
    assert_eq!(redeemed["capabilities"].as_array().unwrap().len(), 0);
    let host_session_token = redeemed["session_token"]
        .as_str()
        .expect("invite redemption returns a backend-generated session token")
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header("authorization", format!("Bearer {host_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(session["principal_id"], fixture_principal_json("host_h"));
    assert_eq!(session["capabilities"][0]["kind"], "HostOf");
    assert_eq!(session["capabilities"][0]["body"]["game"], game.to_string());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "host-invite-token",
                        "account_id": "host@example.test",
                        "password": "host invite password"
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_issued_invite_redeems_through_game_role_projection(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot-7".into(),
                user: "player-rowan",
            },
        )
        .await,
    );

    let host_issuer_token = issue_dev_session(&app, "host_h", &[]).await;
    let account_admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;
    create_test_auth_account(
        &app,
        &account_admin_token,
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
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {host_issuer_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "rowan-replacement-invite",
                        "account_id": "rowan@example.test",
                        "expected_principal_id": PrincipalId::fixture("player-rowan"),
                        "expires_at": unix_now_seconds() + 3_600,
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
    assert_eq!(
        invite["principal_id"],
        serde_json::json!(PrincipalId::fixture("player-rowan"))
    );
    assert_eq!(invite["game"], game.to_string());
    assert_eq!(
        invite["invited_by_principal_id"],
        serde_json::json!(PrincipalId::fixture("host_h"))
    );
    assert!(invite.get("global_capabilities").is_none());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "rowan-replacement-invite",
                        "account_id": "rowan@example.test",
                        "password": "rowan invite password"
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
    let replacement_session_token = redeemed["session_token"]
        .as_str()
        .expect("invite redemption returns a backend-generated session token")
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header(
                    "authorization",
                    format!("Bearer {replacement_session_token}"),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        session["principal_id"],
        serde_json::json!(PrincipalId::fixture("player-rowan"))
    );
    assert_eq!(session["capabilities"][0]["kind"], "SlotOccupant");
    assert_eq!(session["capabilities"][0]["body"]["slot"], "slot-7");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header(
                    "authorization",
                    format!("Bearer {replacement_session_token}"),
                )
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "forbidden-global",
                        "account_id": "missing@example.test",
                        "expected_principal_id": PrincipalId::fixture("other"),
                        "expires_at": unix_now_seconds() + 3_600,
                        "game": game,
                        "global_capabilities": ["GlobalAdmin"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header(
                    "authorization",
                    format!("Bearer {replacement_session_token}"),
                )
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "forbidden-target-probe",
                        "account_id": "missing@example.test",
                        "expected_principal_id": PrincipalId::fixture("other"),
                        "expires_at": unix_now_seconds() + 3_600,
                        "game": game
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn session_lifecycle_rotates_once_and_logs_out_the_presented_token(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/local-proof/sessions")
                .header("content-type", "application/json")
                .header(api::LOCAL_PROOF_AUTH_HEADER, TEST_LOCAL_PROOF_SECRET)
                .body(Body::from(
                    serde_json::json!({
                        "principal_id": PrincipalId::fixture("host_h"),
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
    let initial: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let initial_session_token = initial["session_token"]
        .as_str()
        .expect("dev session returns a backend-generated session token")
        .to_string();

    sqlx::query(
        "UPDATE auth_session SET created_at = 0, authenticated_at = 0 WHERE principal_id = $1",
    )
    .bind(PrincipalId::fixture("host_h").as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", format!("Bearer {initial_session_token}"))
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
                .header("authorization", format!("Bearer {initial_session_token}"))
                .body(Body::from(serde_json::json!({}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rotated: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let rotated_session_token = rotated["session_token"]
        .as_str()
        .expect("rotation returns a backend-generated session token")
        .to_string();
    assert!(rotated_session_token.starts_with("fmss_"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {initial_session_token}"))
                .body(Body::from(serde_json::json!({}).to_string()))
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
                .header("authorization", format!("Bearer {rotated_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let logged_out: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(logged_out["status"], "logged_out");
    assert_eq!(logged_out["principal_id"], fixture_principal_json("host_h"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", format!("Bearer {rotated_session_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let audit = sqlx::query_as::<_, (String, Uuid, Option<String>, serde_json::Value)>(
        r#"
        SELECT event_kind, principal_id, related_token_hash, metadata
        FROM identity_lifecycle_audit
        WHERE event_kind = 'session_logged_out'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "session_logged_out");
    assert_eq!(audit.1, PrincipalId::fixture("host_h").as_uuid());
    assert_eq!(audit.2, None);
    assert_eq!(audit.3, serde_json::json!({}));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn auth_lifecycle_rotates_sessions_and_revokes_invites(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
                cohost_denied: vec![],
            },
        )
        .await,
    );

    let admin_token = issue_dev_session(&app, "admin_a", &["GlobalAdmin"]).await;

    create_test_auth_account(
        &app,
        &admin_token,
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
                .uri("/auth/accounts/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "account_id": "lifecycle-host@example.test",
                        "password": "lifecycle invite password"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let logged_in: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let initial_host_session_token = logged_in["session_token"]
        .as_str()
        .expect("account login returns a backend-generated session token")
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/session-rotations")
                .header("content-type", "application/json")
                .header(
                    "authorization",
                    format!("Bearer {initial_host_session_token}"),
                )
                .body(Body::from(serde_json::json!({}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rotated: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rotated["principal_id"], fixture_principal_json("host_h"));
    let rotated_session_token = rotated["session_token"]
        .as_str()
        .expect("rotation returns a backend-generated session token")
        .to_string();
    assert!(rotated_session_token.starts_with("fmss_"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/auth/session?game={game}"))
                .header(
                    "authorization",
                    format!("Bearer {initial_host_session_token}"),
                )
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
                .header("authorization", format!("Bearer {rotated_session_token}"))
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
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "token": rotated_session_token.as_str()
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
                .header("authorization", format!("Bearer {rotated_session_token}"))
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
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "revoked-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "expected_principal_id": PrincipalId::fixture("host_h"),
                        "expires_at": unix_now_seconds() + 3_600
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let revoked_invite: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let revoked_delivery_id =
        Uuid::parse_str(revoked_invite["delivery_id"].as_str().unwrap()).unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitation-revocations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
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
                .uri("/auth/game-invitations/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "revoked-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "password": "lifecycle invite password"
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
                .uri("/auth/game-invitations")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "replacement-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "expected_principal_id": PrincipalId::fixture("host_h"),
                        "expires_at": unix_now_seconds() + 3_600
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let replacement_invite: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let replacement_delivery_id =
        Uuid::parse_str(replacement_invite["delivery_id"].as_str().unwrap()).unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/game-invitations/redeem")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "invite_token": "replacement-host-invite",
                        "account_id": "lifecycle-host@example.test",
                        "password": "lifecycle invite password"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let redemption: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let replacement_host_session_token = redemption["session_token"]
        .as_str()
        .expect("invite redemption returns a backend-generated session token")
        .to_string();
    for (delivery_id, expected_code) in [
        (revoked_delivery_id, "invite_revoked"),
        (replacement_delivery_id, "invite_redeemed"),
    ] {
        let delivery = sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT status, outcome_code, credential_envelope::TEXT FROM auth_delivery_intent WHERE delivery_id = $1",
        )
        .bind(delivery_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(delivery.0, "cancelled");
        assert_eq!(delivery.1, expected_code);
        assert!(delivery.2.is_none());
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/auth/identity-lifecycle-audit?principal_id={}",
                    PrincipalId::fixture("host_h")
                ))
                .header("authorization", format!("Bearer {admin_token}"))
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
            "account_session_created",
            "auth_delivery_cancelled",
            "auth_delivery_queued",
            "invite_redeemed",
            "invite_revoked",
            "session_revoked",
            "session_rotated",
        ])
    );
    assert!(entries.iter().any(|entry| {
        entry["event_kind"] == "session_rotated"
            && entry["actor_principal_id"] == fixture_principal_json("host_h")
            && entry["principal_id"] == fixture_principal_json("host_h")
    }));
    assert!(entries.iter().any(|entry| {
        entry["event_kind"] == "session_revoked"
            && entry["actor_principal_id"] == fixture_principal_json("admin_a")
            && entry["principal_id"] == fixture_principal_json("host_h")
    }));
    assert!(entries.iter().any(|entry| {
        entry["event_kind"] == "invite_revoked"
            && entry["actor_principal_id"] == fixture_principal_json("admin_a")
            && entry["principal_id"] == fixture_principal_json("host_h")
    }));
    let audit_text = audit.to_string();
    for raw_token in [
        initial_host_session_token.as_str(),
        rotated_session_token.as_str(),
        replacement_host_session_token.as_str(),
        "revoked-host-invite",
        "replacement-host-invite",
    ] {
        assert!(
            !audit_text.contains(raw_token),
            "audit response leaked raw token {raw_token}"
        );
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
            wire::seat_persona! {
                game,
                slot: "slot_1".into(),
                user: "user_a",
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
                phase: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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
        quotations: None,
        mentions: None,
        embed: None,
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
                phase: domain::phase::PhaseId::parse("N01")
                    .expect("static test phase id is canonical"),
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

    let response =
        get_as_dev_principal(&app, "user_2", format!("/games/{game}/notifications")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_two: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_two.len(), 1);
    assert_eq!(user_two[0].audience_slot, "slot_2");
    assert_eq!(user_two[0].effect, "lovers_link");
    assert_eq!(user_two[0].status, "link_lovers_n01");

    let response =
        get_as_dev_principal(&app, "user_4", format!("/games/{game}/notifications")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_four: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_four.is_empty(),
        "unaddressed occupants see no private notice"
    );

    let response =
        get_as_dev_principal(&app, "host_h", format!("/games/{game}/notifications")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 2);
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_2"));
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_3"));

    let response =
        get_as_dev_principal(&app, "outsider", format!("/games/{game}/notifications")).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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
                cohost_denied: vec![],
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
                phase: domain::phase::PhaseId::parse("N01")
                    .expect("static test phase id is canonical"),
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

    let response = get_as_dev_principal(
        &app,
        "user_1",
        format!("/games/{game}/investigation-results"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_one: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_one.len(), 1);
    assert_eq!(user_one[0].audience_slot, "slot_1");
    assert_eq!(user_one[0].mode, "Parity");
    assert_eq!(user_one[0].target_slot, "slot_4");
    assert_eq!(
        user_one[0].result,
        InvestigationResultBody::Label("town".into())
    );

    let response = get_as_dev_principal(
        &app,
        "user_6",
        format!("/games/{game}/investigation-results"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_six: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_six.len(), 1);
    assert_eq!(user_six[0].audience_slot, "slot_6");
    assert_eq!(user_six[0].target_slot, "slot_5");
    assert_eq!(
        user_six[0].result,
        InvestigationResultBody::Label("scum".into())
    );

    let response = get_as_dev_principal(
        &app,
        "user_7",
        format!("/games/{game}/investigation-results"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_seven: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_seven.len(), 1);
    assert_eq!(user_seven[0].audience_slot, "slot_7");
    assert_eq!(user_seven[0].target_slot, "slot_3");
    assert_eq!(
        user_seven[0].result,
        InvestigationResultBody::Label("scum".into())
    );

    let response = get_as_dev_principal(
        &app,
        "user_8",
        format!("/games/{game}/investigation-results"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_eight: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_eight.is_empty(),
        "unaddressed occupants see no private investigation results"
    );

    let response = get_as_dev_principal(
        &app,
        "host_h",
        format!("/games/{game}/investigation-results"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 3);
    assert!(host.iter().any(|result| result.audience_slot == "slot_1"
        && result.target_slot == "slot_4"
        && result.result == InvestigationResultBody::Label("town".into())));
    assert!(host.iter().any(|result| result.audience_slot == "slot_6"
        && result.target_slot == "slot_5"
        && result.result == InvestigationResultBody::Label("scum".into())));
    assert!(host.iter().any(|result| result.audience_slot == "slot_7"
        && result.target_slot == "slot_3"
        && result.result == InvestigationResultBody::Label("scum".into())));

    let response = get_as_dev_principal(
        &app,
        "outsider",
        format!("/games/{game}/investigation-results"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn websocket_hello_announces_protocol(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let app = router(pool);
    let ticket = issue_dev_websocket_ticket(&app, "hello-user", game, "main").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{addr}/ws?ticket={ticket}&audience=fmarch-live"
    ))
    .await
    .unwrap();
    let msg = socket.next().await.unwrap().unwrap();
    let envelope = decode_server_envelope(msg);

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
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_mentions_reject_indistinguishably_and_validate_spans(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let (author_token, _) =
        create_media_upload_account_session(&app, "mention-reject-author").await;
    let (target_token, _) =
        create_media_upload_account_session(&app, "mention-reject-target").await;
    let (hidden_token, _) =
        create_media_upload_account_session(&app, "mention-reject-hidden").await;
    for (token, handle, visibility) in [
        (&author_token, "reject_author", "public"),
        (&target_token, "mentionable_bob", "public"),
        (&hidden_token, "hidden_carol", "private"),
    ] {
        let profile_response = post_bearer_json(
            &app,
            "/profiles",
            serde_json::json!({
                "handle": handle,
                "display_name": handle,
                "bio": "mention reject matrix",
                "visibility": visibility
            }),
            token,
        )
        .await;
        assert_eq!(profile_response.status(), StatusCode::CREATED);
    }

    let area = Uuid::new_v4();
    projections::append_discussion_and_project(
        &pool,
        area,
        &[eventstore::EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({
                "slug": "mention-rejects",
                "title": "Mention Rejects",
                "description": "reject matrix"
            }),
            eventstore::ActorId::Principal(PrincipalId::fixture("moderator")),
            1,
        )],
    )
    .await
    .unwrap();
    let topic_response = post_bearer_json(
        &app,
        "/discussions/areas/mention-rejects/topics",
        serde_json::json!({ "title": "Rejects", "body": "Opening" }),
        &author_token,
    )
    .await;
    assert_eq!(topic_response.status(), StatusCode::CREATED);
    let topic: DiscussionTopic = serde_json::from_slice(
        &to_bytes(topic_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let posts_uri = format!("/discussions/topics/{}/posts", topic.topic);

    async fn post_mentions(
        app: &axum::Router,
        uri: &str,
        body: serde_json::Value,
        token: &str,
    ) -> (StatusCode, String) {
        let response = post_bearer_json(app, uri, body, token).await;
        let status = response.status();
        let text = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        (status, text)
    }

    let mention = |handle: &str, offset: usize, len: usize| serde_json::json!({ "handle": handle, "offset": offset, "len": len });
    // Unknown and private handles collapse to the same non-disclosing reject.
    let (unknown_status, unknown_body) = post_mentions(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@nobody_here hello",
            "mentions": [mention("nobody_here", 0, 12)]
        }),
        &author_token,
    )
    .await;
    let (hidden_status, hidden_body) = post_mentions(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@hidden_carol hello",
            "mentions": [mention("hidden_carol", 0, 13)]
        }),
        &author_token,
    )
    .await;
    assert_eq!(unknown_status, StatusCode::BAD_REQUEST);
    assert_eq!(hidden_status, StatusCode::BAD_REQUEST);
    assert_eq!(unknown_body, hidden_body);

    // Span text disagreeing with the resolved handle.
    let (status, _) = post_mentions(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@mentionable_bob hello",
            "mentions": [mention("mentionable_bob", 0, 5)]
        }),
        &author_token,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Duplicate target.
    let (status, _) = post_mentions(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@mentionable_bob and @mentionable_bob",
            "mentions": [
                mention("mentionable_bob", 0, 16),
                mention("mentionable_bob", 21, 16),
            ]
        }),
        &author_token,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Over the per-post cap.
    let many: Vec<serde_json::Value> = (0..9).map(|_| mention("mentionable_bob", 0, 16)).collect();
    let (status, _) = post_mentions(
        &app,
        &posts_uri,
        serde_json::json!({ "body": "@mentionable_bob hello", "mentions": many }),
        &author_token,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Happy path still lands.
    let (status, _) = post_mentions(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@mentionable_bob hello",
            "mentions": [mention("mentionable_bob", 0, 16)]
        }),
        &author_token,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_mention_delivers_to_non_watcher_through_api(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let (author_token, _) =
        create_media_upload_account_session(&app, "mention-delivery-author").await;
    let (mentioned_token, _) =
        create_media_upload_account_session(&app, "mention-delivery-target").await;
    for (token, handle) in [
        (&author_token, "delivery_author"),
        (&mentioned_token, "delivery_target"),
    ] {
        let profile_response = post_bearer_json(
            &app,
            "/profiles",
            serde_json::json!({
                "handle": handle,
                "display_name": handle,
                "bio": "mention delivery",
                "visibility": "public"
            }),
            token,
        )
        .await;
        assert_eq!(profile_response.status(), StatusCode::CREATED);
    }

    let area = Uuid::new_v4();
    projections::append_discussion_and_project(
        &pool,
        area,
        &[eventstore::EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({
                "slug": "mention-delivery",
                "title": "Mention Delivery",
                "description": "delivery proofs"
            }),
            eventstore::ActorId::Principal(PrincipalId::fixture("moderator")),
            1,
        )],
    )
    .await
    .unwrap();
    let topic_response = post_bearer_json(
        &app,
        "/discussions/areas/mention-delivery/topics",
        serde_json::json!({ "title": "Delivery", "body": "Opening" }),
        &author_token,
    )
    .await;
    assert_eq!(topic_response.status(), StatusCode::CREATED);
    let topic: DiscussionTopic = serde_json::from_slice(
        &to_bytes(topic_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let posts_uri = format!("/discussions/topics/{}/posts", topic.topic);

    let reply = post_bearer_json(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@delivery_target consider this",
            "mentions": [{ "handle": "delivery_target", "offset": 0, "len": 16 }]
        }),
        &author_token,
    )
    .await;
    assert_eq!(reply.status(), StatusCode::CREATED);

    let inbox = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inbox")
                .header("authorization", format!("Bearer {mentioned_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inbox.status(), StatusCode::OK);
    let inbox: PublicInboxPage =
        serde_json::from_slice(&to_bytes(inbox.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(inbox.unread_count, 1);
    assert_eq!(inbox.items.len(), 1);

    // Self-mention is accepted and delivers nothing.
    let self_mention = post_bearer_json(
        &app,
        &posts_uri,
        serde_json::json!({
            "body": "@delivery_author note to self",
            "mentions": [{ "handle": "delivery_author", "offset": 0, "len": 16 }]
        }),
        &author_token,
    )
    .await;
    assert_eq!(self_mention.status(), StatusCode::CREATED);
    let author_inbox = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inbox")
                .header("authorization", format!("Bearer {author_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let author_inbox: PublicInboxPage = serde_json::from_slice(
        &to_bytes(author_inbox.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(author_inbox.items.is_empty());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_mention_read_contract_and_typeahead_stay_non_disclosing(pool: sqlx::PgPool) {
    let app = router_with_local_proof_auth(pool.clone());
    let (author_token, _) = create_media_upload_account_session(&app, "mention-read-author").await;
    let (target_token, _) = create_media_upload_account_session(&app, "mention-read-target").await;
    let (private_token, _) =
        create_media_upload_account_session(&app, "mention-read-private").await;
    for (token, handle, visibility) in [
        (&author_token, "read_author", "public"),
        (&target_token, "read_target", "public"),
        (&private_token, "read_private", "private"),
    ] {
        let profile_response = post_bearer_json(
            &app,
            "/profiles",
            serde_json::json!({
                "handle": handle,
                "display_name": handle,
                "bio": "mention read",
                "visibility": visibility
            }),
            token,
        )
        .await;
        assert_eq!(profile_response.status(), StatusCode::CREATED);
    }

    // The typeahead sees the public corpus and only the public corpus: a
    // private handle and a handle nobody holds are the same empty answer.
    let suggestions = mention_suggestions(&app, "read_", &author_token).await;
    assert_eq!(
        suggestions
            .suggestions
            .iter()
            .map(|entry| entry.handle.as_str())
            .collect::<Vec<_>>(),
        vec!["read_author", "read_target"]
    );
    assert!(mention_suggestions(&app, "read_private", &author_token)
        .await
        .suggestions
        .is_empty());
    assert!(mention_suggestions(&app, "read_nobody", &author_token)
        .await
        .suggestions
        .is_empty());
    let anonymous = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/profiles/mention-suggestions?q=read_")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let area = Uuid::new_v4();
    projections::append_discussion_and_project(
        &pool,
        area,
        &[eventstore::EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({
                "slug": "mention-read",
                "title": "Mention Read",
                "description": "read proofs"
            }),
            eventstore::ActorId::Principal(PrincipalId::fixture("moderator")),
            1,
        )],
    )
    .await
    .unwrap();
    let topic_response = post_bearer_json(
        &app,
        "/discussions/areas/mention-read/topics",
        serde_json::json!({ "title": "Read", "body": "Opening" }),
        &author_token,
    )
    .await;
    assert_eq!(topic_response.status(), StatusCode::CREATED);
    let topic: DiscussionTopic = serde_json::from_slice(
        &to_bytes(topic_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let reply = post_bearer_json(
        &app,
        &format!("/discussions/topics/{}/posts", topic.topic),
        serde_json::json!({
            "body": "@read_target consider this",
            "mentions": [{ "handle": "read_target", "offset": 0, "len": 12 }]
        }),
        &author_token,
    )
    .await;
    assert_eq!(reply.status(), StatusCode::CREATED);

    let thread = discussion_thread(&app, "mention-read", topic.topic).await;
    let mentioning = thread
        .posts
        .iter()
        .find(|post| post.body.starts_with("@read_target"))
        .unwrap();
    assert_eq!(mentioning.mentions.len(), 1);
    assert_eq!(mentioning.mentions[0].offset, 0);
    assert_eq!(mentioning.mentions[0].len, 12);
    assert_eq!(
        mentioning.mentions[0]
            .profile
            .as_ref()
            .map(|profile| profile.handle.as_str()),
        Some("read_target")
    );

    // The addressed member clears the row through the principal cursor even
    // though no watch exists on this surface.
    let inbox = member_inbox(&app, &target_token).await;
    assert_eq!(inbox.unread_count, 1);
    assert_eq!(inbox.items[0].reason, "mention");
    assert!(!inbox.items[0].subscribed);
    let cleared = post_bearer_json(
        &app,
        "/inbox/read",
        serde_json::json!({ "read_through_seq": inbox.items[0].source_seq }),
        &target_token,
    )
    .await;
    assert_eq!(cleared.status(), StatusCode::OK);
    let cleared: PublicInboxPage =
        serde_json::from_slice(&to_bytes(cleared.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(cleared.unread_count, 0);
    let repeat = post_bearer_json(
        &app,
        "/inbox/read",
        serde_json::json!({ "read_through_seq": inbox.items[0].source_seq }),
        &target_token,
    )
    .await;
    assert_eq!(repeat.status(), StatusCode::BAD_REQUEST);

    // Once the target stops being public the read unlinks the span and keeps it.
    let privatize = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/profiles/me")
                .header("authorization", format!("Bearer {target_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "display_name": "read_target",
                        "bio": "mention read",
                        "visibility": "private",
                        "expected_revision": 1,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(privatize.status(), StatusCode::OK);
    let thread = discussion_thread(&app, "mention-read", topic.topic).await;
    let mentioning = thread
        .posts
        .iter()
        .find(|post| post.body.starts_with("@read_target"))
        .unwrap();
    assert_eq!(mentioning.mentions.len(), 1);
    assert_eq!(mentioning.mentions[0].len, 12);
    assert!(mentioning.mentions[0].profile.is_none());
}

async fn mention_suggestions(
    app: &axum::Router,
    query: &str,
    token: &str,
) -> MentionSuggestionPage {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/profiles/mention-suggestions?q={query}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

async fn member_inbox(app: &axum::Router, token: &str) -> PublicInboxPage {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inbox")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

async fn discussion_thread(app: &axum::Router, slug: &str, topic: Uuid) -> DiscussionThreadPage {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/discussions/areas/{slug}/topics/{topic}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
