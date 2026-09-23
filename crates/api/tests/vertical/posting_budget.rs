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

fn thread_post(game: Uuid, body: &str) -> Command {
    Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
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
    seed_single_vote_game(app.clone(), game).await;

    let (status, _, accepted) = post_command_response(
        &app,
        20,
        stable_command_id(20),
        "user_a",
        &[],
        thread_post(game, "within budget"),
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
            thread_post(game, "over budget"),
        )
        .await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert!(matches!(retry_after, Some(1..=60)), "{retry_after:?}");
        match limited.body {
            ServerMsg::Reject(reject) => {
                assert_eq!(reject.error, RejectCode::RateLimited);
                assert!(reject.retryable);
            }
            other => panic!("expected a RateLimited reject, got {other:?}"),
        }
    }
    assert_eq!(posts_with_body(&pool, game, "over budget").await, 0);
    let receipts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM command_receipt WHERE command_id = $1")
            .bind(limited_command)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(receipts, 0, "a rate-limited command stores no receipt");

    // A global operator may act for the slot, but that escalation is not host
    // standing in this game: the operator is budgeted like any member.
    for (attempt, expected) in [(30, StatusCode::OK), (31, StatusCode::TOO_MANY_REQUESTS)] {
        let (status, _, _) = post_command_response(
            &app,
            attempt,
            stable_command_id(attempt),
            "ops_o",
            &["GlobalAdmin"],
            thread_post(game, "operator post"),
        )
        .await;
        assert_eq!(status, expected, "operator attempt {attempt}");
    }

    // The game's own host holds HostOf(game) and writes its thread without limit.
    for attempt in 40..43 {
        let (status, _, accepted) = post_command_response(
            &app,
            attempt,
            stable_command_id(attempt),
            "host_h",
            &["GlobalAdmin"],
            thread_post(game, "host post"),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "host attempt {attempt}");
        expect_ack(accepted);
    }
    assert_eq!(posts_with_body(&pool, game, "host post").await, 3);
}
