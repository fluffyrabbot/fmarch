use super::*;

async fn fixture(pool: &sqlx::PgPool) -> (axum::Router, Uuid) {
    let app = router(pool.clone()).await;
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
                origin: None,
            },
        )
        .await,
    );
    for (id, slot) in [(2, "slot-7"), (3, "slot-8"), (4, "empty-slot")] {
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
    }
    for (id, slot, user) in [(5, "slot-7", "outgoing"), (6, "slot-8", "occupied")] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                wire::seat_persona! {
                    game, slot: slot.into(), user: user,
                },
            )
            .await,
        );
    }
    issue_dev_session(&app, "cohost_c", &[]).await;
    expect_ack(
        post_command(
            app.clone(),
            7,
            "host_h",
            Command::AddCohost {
                game,
                principal_id: PrincipalId::fixture("cohost_c"),
            },
        )
        .await,
    );
    (app, game)
}

async fn profile(pool: &sqlx::PgPool, app: &axum::Router, label: &str, public: bool) {
    issue_dev_session(app, label, &[]).await;
    profile_application::create_profile(
        pool,
        PrincipalId::fixture(label),
        social::ProfilePresentation::new(
            social::ProfileHandle::new(label).unwrap(),
            social::ProfileDisplayName::new(format!("Display {label}")).unwrap(),
            social::ProfileBio::new("Replacement candidate fixture").unwrap(),
            if public {
                social::ProfileVisibility::Public
            } else {
                social::ProfileVisibility::Private
            },
        ),
        1,
    )
    .await
    .unwrap();
}

fn path(game: Uuid, slot: &str, handle: &str) -> String {
    format!("/games/{game}/replacement-candidate?slot_id={slot}&handle={handle}")
}

async fn body(response: axum::response::Response) -> serde_json::Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

async fn candidate(
    app: &axum::Router,
    game: Uuid,
    slot: &str,
    handle: &str,
) -> wire::HostReplacementCandidate {
    let response = get_as_dev_principal(app, "host_h", path(game, slot, handle)).await;
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_value(body(response).await).unwrap()
}

fn replacement(game: Uuid, candidate: &wire::HostReplacementCandidate) -> Command {
    Command::ProcessReplacement {
        game,
        slot: candidate.slot_id.clone(),
        outgoing_persona_id: candidate.outgoing_persona_id,
        incoming_principal_id: candidate.principal_id,
    }
}

async fn stream(pool: &sqlx::PgPool, game: Uuid) -> serde_json::Value {
    serde_json::to_value(eventstore::load_stream(pool, game).await.unwrap()).unwrap()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_replacement_candidate_requires_replacement_authority_before_lookup(
    pool: sqlx::PgPool,
) {
    let (app, game) = fixture(&pool).await;
    profile(&pool, &app, "rowan", true).await;
    let unauthenticated = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path(game, "slot-7", "rowan"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let operator = issue_dev_session(&app, "operator", &["GlobalMod"]).await;
    let member = issue_dev_session(&app, "outgoing", &[]).await;
    // An unauthorized read must finish even while candidate storage is locked.
    // This proves that capability denial precedes the private identity lookup.
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE public_profile IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *gate)
        .await
        .unwrap();
    for token in [&operator, &member] {
        for handle in ["rowan", "missing"] {
            let response = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                app.clone().oneshot(
                    Request::builder()
                        .uri(path(game, "slot-7", handle))
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                ),
            )
            .await
            .expect("authorization must not wait for candidate storage")
            .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }
    gate.rollback().await.unwrap();

    let other_game = Uuid::new_v4();
    expect_ack(
        post_command(
            app.clone(),
            40,
            "other_host",
            Command::CreateGame {
                game: other_game,
                pack: "mafiascum".into(),
                origin: None,
                cohost_denied: vec![wire::CohostPermissionClass::Replacement],
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            41,
            "other_host",
            Command::AddCohost {
                game: other_game,
                principal_id: PrincipalId::fixture("cohost_c"),
            },
        )
        .await,
    );
    for (actor, target) in [
        ("cohost_c", other_game),
        ("host_h", other_game),
        ("cohost_c", Uuid::new_v4()),
    ] {
        let response = get_as_dev_principal(&app, actor, path(target, "slot-7", "rowan")).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_replacement_candidate_returns_exact_public_identity_and_current_persona(
    pool: sqlx::PgPool,
) {
    let (app, game) = fixture(&pool).await;
    profile(&pool, &app, "rowan", true).await;
    let before = stream(&pool, game).await;
    let outgoing = current_slot_persona_id(&pool, game, "slot-7").await;
    let expected = serde_json::json!({
        "slot_id":"slot-7", "outgoing_persona_id":outgoing.as_uuid(),
        "principal_id":PrincipalId::fixture("rowan"), "handle":"rowan", "display_name":"Display rowan",
    });
    for actor in ["host_h", "cohost_c"] {
        let response = get_as_dev_principal(&app, actor, path(game, "slot-7", "%20ROWAN%20")).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body(response).await, expected);
    }
    assert_eq!(
        stream(&pool, game).await,
        before,
        "lookup cannot reserve or replace a seat"
    );
    let selected = candidate(&app, game, "slot-7", "rowan").await;
    expect_ack(post_command(app.clone(), 20, "cohost_c", replacement(game, &selected)).await);
    assert_eq!(
        projections::slot_occupant(&pool, game, "slot-7")
            .await
            .unwrap(),
        Some(selected.principal_id)
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_replacement_candidate_hides_private_redacted_inactive_and_ineligible_principals(
    pool: sqlx::PgPool,
) {
    let (app, game) = fixture(&pool).await;
    for (label, public) in [
        ("rowan", true),
        ("outgoing", true),
        ("occupied", true),
        ("hidden", false),
        ("disabled", true),
        ("deactivated", true),
        ("erased", true),
        ("spectator", true),
    ] {
        profile(&pool, &app, label, public).await;
    }
    // A valid disabled owner shape, independently of whether its public read
    // model has been removed yet, must never become replacement authority.
    sqlx::query("UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_id = $1")
        .bind(PrincipalId::fixture("disabled").as_uuid()).execute(&pool).await.unwrap();
    identity::test_support::apply_member_lifecycle(
        &pool,
        &PrincipalId::fixture("deactivated"),
        identity::MemberLifecycleCommand::Deactivate {
            reason: "candidate fixture".into(),
        },
        3,
    )
    .await
    .unwrap();
    identity::test_support::request_member_erasure(&pool, &PrincipalId::fixture("erased"), 3)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT lifecycle FROM member_profile WHERE profile_id = (SELECT profile_id FROM public_profile WHERE handle = 'erased')")
        .fetch_optional(&pool).await.unwrap(), None, "erased presentation leaves public profiles");
    expect_ack(
        post_command(
            app.clone(),
            20,
            "host_h",
            Command::GrantSpectator {
                game,
                principal_id: PrincipalId::fixture("spectator"),
            },
        )
        .await,
    );
    let before = stream(&pool, game).await;
    let mut unavailable = None;
    for handle in [
        "missing",
        "hidden",
        "disabled",
        "deactivated",
        "erased",
        "outgoing",
        "occupied",
        "spectator",
    ] {
        let response = get_as_dev_principal(&app, "host_h", path(game, "slot-7", handle)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{handle}");
        let value = body(response).await;
        if let Some(expected) = &unavailable {
            assert_eq!(&value, expected, "uniform absence for {handle}");
        } else {
            unavailable = Some(value);
        }
    }
    assert_eq!(
        candidate(&app, game, "slot-7", "rowan").await.principal_id,
        PrincipalId::fixture("rowan")
    );
    assert_eq!(stream(&pool, game).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn host_replacement_candidate_rejects_malformed_queries_and_unknown_seats(
    pool: sqlx::PgPool,
) {
    let (app, game) = fixture(&pool).await;
    profile(&pool, &app, "rowan", true).await;
    for query in [
        "slot_id=slot-7",
        "slot_id=slot-7&handle=",
        "slot_id=slot-7&handle=a",
        "slot_id=slot-7&handle=rowan-other",
        "slot_id=%20slot-7&handle=rowan",
        "slot_id=&handle=rowan",
        "slot_id=slot-7%0A&handle=rowan",
        "slot_id=slot-7&handle=rowan&principal_id=ignored",
    ] {
        let response = get_as_dev_principal(
            &app,
            "host_h",
            format!("/games/{game}/replacement-candidate?{query}"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
    }
    for slot in ["missing-slot", "empty-slot"] {
        let response = get_as_dev_principal(&app, "host_h", path(game, slot, "rowan")).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn replacement_command_rechecks_candidate_occupancy_and_outgoing_persona(pool: sqlx::PgPool) {
    let (app, game) = fixture(&pool).await;
    profile(&pool, &app, "rowan", true).await;
    profile(&pool, &app, "next_candidate", true).await;
    let selected = candidate(&app, game, "slot-7", "rowan").await;
    let other_seat = candidate(&app, game, "slot-8", "rowan").await;
    expect_ack(post_command(app.clone(), 20, "host_h", replacement(game, &other_seat)).await);
    let before = stream(&pool, game).await;
    expect_reject(
        post_command(app.clone(), 21, "host_h", replacement(game, &selected)).await,
        RejectCode::InvalidTarget,
    );
    // Self-replacement must also reject rather than close and reopen its epoch.
    let self_replacement = Command::ProcessReplacement {
        game,
        slot: "slot-8".into(),
        outgoing_persona_id: current_slot_persona_id(&pool, game, "slot-8")
            .await
            .as_uuid(),
        incoming_principal_id: PrincipalId::fixture("rowan"),
    };
    expect_reject(
        post_command(app.clone(), 22, "host_h", self_replacement).await,
        RejectCode::InvalidTarget,
    );
    assert_eq!(stream(&pool, game).await, before);

    let next = candidate(&app, game, "slot-7", "next_candidate").await;
    expect_ack(post_command(app.clone(), 23, "host_h", replacement(game, &next)).await);
    let before = stream(&pool, game).await;
    let mut stale = next;
    stale.principal_id = PrincipalId::fixture("fresh_candidate");
    expect_reject(
        post_command(app.clone(), 24, "host_h", replacement(game, &stale)).await,
        RejectCode::InvalidTarget,
    );
    assert_eq!(
        stream(&pool, game).await,
        before,
        "old outgoing persona cannot replace a new occupancy"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn replacement_command_rechecks_candidate_activity_and_spectator_membership(
    pool: sqlx::PgPool,
) {
    let (app, game) = fixture(&pool).await;
    profile(&pool, &app, "rowan", true).await;
    profile(&pool, &app, "later_spectator", true).await;
    let selected = candidate(&app, game, "slot-7", "rowan").await;
    let later_spectator = candidate(&app, game, "slot-7", "later_spectator").await;
    expect_ack(
        post_command(
            app.clone(),
            20,
            "host_h",
            Command::GrantSpectator {
                game,
                principal_id: later_spectator.principal_id,
            },
        )
        .await,
    );
    let before = stream(&pool, game).await;
    expect_reject(
        post_command(
            app.clone(),
            21,
            "host_h",
            replacement(game, &later_spectator),
        )
        .await,
        RejectCode::InvalidTarget,
    );
    assert_eq!(stream(&pool, game).await, before);

    let token = issue_dev_session(&app, "host_h", &[]).await;
    sqlx::query("UPDATE platform_principal SET status = 'disabled', disabled_at = 2 WHERE principal_id = $1")
        .bind(selected.principal_id.as_uuid()).execute(&pool).await.unwrap();
    // Send using the existing actor session, without the fixture helper that
    // provisions target identities before commands.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&command_envelope_with_command_id(
                        22,
                        stable_command_id(22),
                        "host_h",
                        replacement(game, &selected),
                    ))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(body(response).await["error"], "InvalidTarget");
    assert_eq!(stream(&pool, game).await, before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn replacement_command_rechecks_member_deactivation_after_lookup(pool: sqlx::PgPool) {
    let (app, game) = fixture(&pool).await;
    profile(&pool, &app, "rowan", true).await;
    let selected = candidate(&app, game, "slot-7", "rowan").await;
    let token = issue_dev_session(&app, "host_h", &[]).await;
    identity::test_support::apply_member_lifecycle(
        &pool,
        &selected.principal_id,
        identity::MemberLifecycleCommand::Deactivate {
            reason: "changed after lookup".into(),
        },
        3,
    )
    .await
    .unwrap();
    // Deactivation deliberately leaves the principal and privacy subject
    // active. Replacement must consult the member's lifecycle as well.
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM platform_principal WHERE principal_id = $1"
        )
        .bind(selected.principal_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "active"
    );
    let before = stream(&pool, game).await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&command_envelope_with_command_id(
                        20,
                        stable_command_id(20),
                        "host_h",
                        replacement(game, &selected),
                    ))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    expect_reject(
        serde_json::from_value(body(response).await).unwrap(),
        RejectCode::InvalidTarget,
    );
    assert_eq!(stream(&pool, game).await, before);
    assert_eq!(
        projections::slot_occupant(&pool, game, "slot-7")
            .await
            .unwrap(),
        Some(PrincipalId::fixture("outgoing"))
    );
    let response = get_as_dev_principal(&app, "host_h", path(game, "slot-7", "rowan")).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
