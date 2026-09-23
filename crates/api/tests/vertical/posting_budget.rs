use super::*;

/// POST one command as `principal_label` holding `global_capabilities`,
/// keeping the HTTP status and headers a rate-limited reject carries.
async fn post_command_response(
    app: &axum::Router,
    id: u64,
    command_id: Uuid,
    principal_label: &str,
    global_capabilities: &[&str],
    command: Command,
) -> (StatusCode, Option<i64>, ServerEnvelope) {
    let token = issue_dev_session(app, principal_label, global_capabilities).await;
    let body = serde_json::to_vec(&command_envelope_with_command_id(
        id,
        command_id,
        principal_label,
        command,
    ))
    .unwrap();
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
    let status = response.status();
    let retry_after = response
        .headers()
        .get("retry-after")
        .map(|value| value.to_str().unwrap().parse::<i64>().unwrap());
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, retry_after, serde_json::from_slice(&bytes).unwrap())
}

fn thread_post(game: Uuid, slot: &str, body: &str) -> Command {
    Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: slot.into(),
        body: body.into(),
        media: None,
        quotations: None,
        mentions: None,
        embed: None,
    }
}

async fn posts_with_body(pool: &sqlx::PgPool, game: Uuid, body: &str) -> usize {
    logical_event_payloads(pool, game, "PostSubmitted")
        .await
        .into_iter()
        .filter(|payload| payload["body"] == body)
        .count()
}

/// A started game whose host also plays: `user_a` in slot_1, the host in
/// slot_2, and `user_b` in slot_3.
async fn seed_host_seated_game(app: &axum::Router, game: Uuid) {
    let mut id = 1;
    let mut host = |command: Command| {
        id += 1;
        post_command(app.clone(), id, "host_h", command)
    };
    expect_ack(
        host(Command::CreateGame {
            origin: None,
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        })
        .await,
    );
    for (slot, user) in [("slot_1", "user_a"), ("slot_2", "host_h"), ("slot_3", "user_b")] {
        expect_ack(host(Command::AddSlot { game, slot: slot.into() }).await);
        expect_ack(host(wire::seat_persona! { game, slot: slot.into(), user: user }).await);
        expect_ack(
            host(Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: "vanilla_townie".into(),
            })
            .await,
        );
    }
    expect_ack(
        host(Command::StartGame {
            game,
            phase: domain::phase::PhaseId::parse("D01").expect("static test phase id is canonical"),
        })
        .await,
    );
}

fn expect_rate_limited(status: StatusCode, retry_after: Option<i64>, envelope: ServerEnvelope) {
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(matches!(retry_after, Some(1..=60)), "{retry_after:?}");
    match envelope.body {
        ServerMsg::Reject(reject) => {
            assert_eq!(reject.error, RejectCode::RateLimited);
            assert!(reject.retryable);
        }
        other => panic!("expected a RateLimited reject, got {other:?}"),
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_thread_posts_draw_the_posting_budget_and_only_held_host_standing_exempts(
    pool: sqlx::PgPool,
) {
    let app = api::router_with_state(
        test_api_state(pool.clone())
            .await
            .with_local_proof_auth(test_local_proof_verifier())
            .with_posting_admission(projections::PostingAdmission::Enforced(
                projections::PostingBudgetPolicy {
                    posts_per_minute: 1,
                    ..projections::PostingBudgetPolicy::default()
                },
            )),
    );
    let game = Uuid::new_v4();
    seed_host_seated_game(&app, game).await;

    let (status, _, accepted) = post_command_response(
        &app,
        20,
        stable_command_id(20),
        "user_a",
        &[],
        thread_post(game, "slot_1", "within budget"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    expect_ack(accepted);

    let limited_command = stable_command_id(21);
    for attempt in [21, 22] {
        // The same command id retried inside the window is limited again, not
        // replayed: the rejected attempt stored no receipt.
        let (status, retry_after, limited) = post_command_response(
            &app,
            attempt,
            limited_command,
            "user_a",
            &[],
            thread_post(game, "slot_1", "over budget"),
        )
        .await;
        expect_rate_limited(status, retry_after, limited);
    }
    assert_eq!(posts_with_body(&pool, game, "over budget").await, 0);
    let receipts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM command_receipt WHERE command_id = $1")
            .bind(limited_command)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(receipts, 0, "a rate-limited command stores no receipt");

    // A seated player holding GlobalAdmin is not host of this game: the
    // escalation that satisfies HostOf for authority does not exempt.
    let (status, _, accepted) = post_command_response(
        &app,
        30,
        stable_command_id(30),
        "user_b",
        &["GlobalAdmin"],
        thread_post(game, "slot_3", "operator post"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    expect_ack(accepted);
    let (status, retry_after, limited) = post_command_response(
        &app,
        31,
        stable_command_id(31),
        "user_b",
        &["GlobalAdmin"],
        thread_post(game, "slot_3", "operator post"),
    )
    .await;
    expect_rate_limited(status, retry_after, limited);

    // The game's own host, playing a seat, writes its thread without limit.
    for attempt in 40..43 {
        let (status, _, accepted) = post_command_response(
            &app,
            attempt,
            stable_command_id(attempt),
            "host_h",
            &[],
            thread_post(game, "slot_2", "host post"),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "host attempt {attempt}");
        expect_ack(accepted);
    }
    assert_eq!(posts_with_body(&pool, game, "host post").await, 3);
}
