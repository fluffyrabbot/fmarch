use super::*;

async fn citation_response(
    app: &axum::Router,
    uri: &str,
    token: Option<&str>,
) -> axum::response::Response {
    let mut request = Request::get(uri);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    app.clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn citation_json(
    app: &axum::Router,
    uri: &str,
    token: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let response = citation_response(app, uri, token).await;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn start_citation_game(pool: &sqlx::PgPool, host: PrincipalId) -> Uuid {
    let game = Uuid::new_v4();
    let artifact = test_pack_artifact("mafiascum");
    projections::append_and_project(
        pool,
        game,
        &[
            eventstore::EventInput::new(
                "GameCreated",
                1,
                serde_json::json!({
                    "host_principal_id": host,
                    "pack_ref": artifact.pack_ref.clone(),
                    "pack_artifact": artifact,
                }),
                event_actor::ActorId::Principal(host),
                1,
            ),
            eventstore::EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({"phase_id": "D01"}),
                event_actor::ActorId::Host,
                2,
            ),
        ],
    )
    .await
    .unwrap();
    game
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_game_citation_batches_are_bounded_visible_and_profile_independent(
    pool: sqlx::PgPool,
) {
    let app = router(pool.clone()).await;
    let game = start_citation_game(&pool, PrincipalId::fixture("citation-host")).await;
    sqlx::query(
        "INSERT INTO public_publication (surface_id, source_seq, body, href, occurred_at)
         SELECT $1, seq, 'Slot citation', '/games/' || $1::text, seq
         FROM generate_series(1, 1100) AS seq",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public_citation (
             quoted_surface_id, quoted_source_seq, quoting_surface_id, quoting_source_seq, occurred_at
         ) SELECT $1, target, $1, 50 + (target - 1) * 21 + preview, preview
         FROM generate_series(1, 50) AS target CROSS JOIN generate_series(1, 21) AS preview",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    let source_seqs = (1..=50)
        .rev()
        .map(|seq| seq.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let uri = format!("/games/{game}/citations?source_seqs={source_seqs}");
    let (status, anonymous) = citation_json(&app, &uri, None).await;
    assert_eq!(status, StatusCode::OK);
    for (suffix, cap) in [
        ("", 5),
        ("&limit=0", 1),
        ("&limit=-10", 1),
        ("&limit=100", 20),
    ] {
        let (status, json) = citation_json(&app, &format!("{uri}{suffix}"), None).await;
        assert_eq!(status, StatusCode::OK);
        let batch: wire::PublicPostCitationBatch = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(batch.pages.len(), 50);
        assert_eq!(
            batch
                .pages
                .iter()
                .map(|page| page.citations.len())
                .sum::<usize>(),
            50 * cap
        );
        for (index, page) in batch.pages.iter().enumerate() {
            assert_eq!(page.quoted_surface_id, game);
            assert_eq!(page.quoted_source_seq, index as i64 + 1);
            assert_eq!(page.citation_count, 21, "counts precede per-target caps");
            assert_eq!(page.citations.len(), cap);
            assert_eq!(
                page.citations[0].quoting_source_seq,
                50 + (index as i64 + 1) * 21
            );
            assert!(page
                .citations
                .windows(2)
                .all(|pair| pair[0].quoting_source_seq > pair[1].quoting_source_seq));
        }
        assert_eq!(
            json["pages"][0]["citations"][0],
            serde_json::json!({
                "quoting_surface_id": game, "quoting_source_seq": 71, "occurred_at": 21,
            })
        );
    }

    let (reader_token, _) = create_media_upload_account_session(&app, "citation-reader").await;
    let (muted_token, _) = create_media_upload_account_session(&app, "citation-muted").await;
    let profile = post_bearer_json(&app, "/profiles", serde_json::json!({
        "handle": "citation_muted", "display_name": "Muted Member", "bio": "Citation privacy fixture", "visibility": "public",
    }), &muted_token).await;
    assert_eq!(profile.status(), StatusCode::CREATED);
    let (status, signed_in) = citation_json(&app, &uri, Some(&reader_token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(signed_in, anonymous);
    let muted = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mutes/profiles/citation_muted")
                .header("authorization", format!("Bearer {reader_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(muted.status(), StatusCode::OK);
    let (status, with_mute) = citation_json(&app, &uri, Some(&reader_token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        with_mute, anonymous,
        "account profile mutes cannot change slot citation data"
    );

    for source_seqs in [
        "".to_owned(),
        "0".into(),
        "-1".into(),
        "1,1".into(),
        "01,1".into(),
        "1,,2".into(),
        "one".into(),
        "9223372036854775808".into(),
        format!("{source_seqs},51"),
    ] {
        let (status, json) = citation_json(
            &app,
            &format!("/games/{game}/citations?source_seqs={source_seqs}"),
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "accepted {source_seqs:?}: {json}"
        );
        assert_eq!(
            json["error"],
            serde_json::json!(RejectCode::InvalidArgument)
        );
    }
    for query in [
        "",
        "?source_seqs=1&source_seqs=2",
        "?source_seqs=1&limit=bad",
    ] {
        assert_eq!(
            citation_response(&app, &format!("/games/{game}/citations{query}"), None)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    sqlx::query("UPDATE public_publication SET visible = false WHERE surface_id = $1 AND source_seq IN (2, 1100)")
        .bind(game).execute(&pool).await.unwrap();
    let (status, filtered) = citation_json(
        &app,
        &format!("/games/{game}/citations?source_seqs=50,2,1100,9999"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(filtered["pages"].as_array().unwrap().len(), 1);
    assert_eq!(filtered["pages"][0]["quoted_source_seq"], 50);
    assert_eq!(filtered["pages"][0]["citation_count"], 20);
    assert_eq!(
        filtered["pages"][0]["citations"][0]["quoting_source_seq"],
        1099
    );
    let (_, zero) = citation_json(
        &app,
        &format!("/games/{game}/citations?source_seqs=51,9999"),
        None,
    )
    .await;
    assert_eq!(zero["pages"].as_array().unwrap().len(), 1);
    assert_eq!(zero["pages"][0]["citation_count"], 0);
    assert_eq!(zero["pages"][0]["citations"], serde_json::json!([]));
    sqlx::query("UPDATE publication_surface SET visible = false WHERE surface_id = $1")
        .bind(game)
        .execute(&pool)
        .await
        .unwrap();
    let (status, hidden) = citation_json(&app, &uri, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(hidden, serde_json::json!({"pages": []}));

    let discussion = Uuid::new_v4();
    sqlx::query("INSERT INTO publication_surface (surface_id, search_group, title, href, updated_seq) VALUES ($1, 'discussions', 'Discussion', '/discussions/fixture', 1)")
        .bind(discussion).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO public_publication (surface_id, source_seq, body, href, occurred_at) VALUES ($1, 1, 'Forum post', '/discussions/fixture', 1)")
        .bind(discussion).execute(&pool).await.unwrap();
    sqlx::query("UPDATE game_index SET status = 'setup' WHERE game_id = $1")
        .bind(game)
        .execute(&pool)
        .await
        .unwrap();
    for unavailable in [game, discussion, Uuid::new_v4()] {
        let (status, rejected) = citation_json(
            &app,
            &format!("/games/{unavailable}/citations?source_seqs=1"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            rejected["error"],
            serde_json::json!(RejectCode::UnknownGame)
        );
    }
}

async fn submit_citation_post(
    pool: &sqlx::PgPool,
    game: Uuid,
    channel: &str,
    target: Option<i64>,
) -> i64 {
    let quotations: Vec<_> = target
        .into_iter()
        .map(|source_seq| {
            serde_json::json!({
                "target": {"kind": "game_post", "scope_id": game, "source_seq": source_seq},
                "excerpt": "Claim",
            })
        })
        .collect();
    projections::append_and_project(pool, game, &[eventstore::EventInput::new("PostSubmitted", 1,
        serde_json::json!({"channel_id": channel, "author": {"kind": "slot", "slot_id": "slot_1"},
            "body": "Claim", "phase_id": "D01", "quotations": quotations}),
        event_actor::ActorId::Slot("slot_1".into()), 3,
    )]).await.unwrap()[0].seq
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn private_game_citations_remain_authorized_nested_and_channel_scoped(pool: sqlx::PgPool) {
    let app = router(pool.clone()).await;
    let host = PrincipalId::fixture("private-citation-host");
    let host_token = issue_dev_session_for_principal(&app, host, &[]).await;
    let outsider_token = issue_dev_session(&app, "private-citation-outsider", &[]).await;
    let game = start_citation_game(&pool, host).await;
    let private_target = submit_citation_post(&pool, game, "private:one", None).await;
    let private_quoter =
        submit_citation_post(&pool, game, "private:one", Some(private_target)).await;
    let public_target = submit_citation_post(&pool, game, "main", None).await;
    let public_quoter = submit_citation_post(&pool, game, "main", Some(public_target)).await;
    let private_uri =
        format!("/games/{game}/channels/private:one/posts/{private_target}/citations");
    assert_eq!(
        citation_response(&app, &private_uri, None).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        citation_response(&app, &private_uri, Some(&outsider_token))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let (status, private) = citation_json(&app, &private_uri, Some(&host_token)).await;
    assert_eq!(status, StatusCode::OK);
    let private_page: wire::PostCitationPage = serde_json::from_value(private.clone()).unwrap();
    assert_eq!(private_page.citation_count, 1);
    assert_eq!(
        private["citations"][0]["quoting"],
        serde_json::json!({
            "kind": "game_post", "scope_id": game, "source_seq": private_quoter,
        })
    );
    for uri in [
        format!("/games/{game}/channels/private:two/posts/{private_target}/citations"),
        format!("/games/{game}/channels/private:one/posts/{public_target}/citations"),
        format!("/games/{game}/channels/main/posts/{public_target}/citations"),
        format!("/games/{game}/posts/{public_target}/citations"),
    ] {
        assert_eq!(
            citation_response(&app, &uri, Some(&host_token))
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        citation_response(
            &app,
            &format!("/games/{game}/channels/main/posts/{public_target}/citations"),
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let (status, public) = citation_json(
        &app,
        &format!(
            "/games/{game}/citations?source_seqs={private_target},{private_quoter},{public_target}"
        ),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(public["pages"].as_array().unwrap().len(), 1);
    assert_eq!(public["pages"][0]["quoted_source_seq"], public_target);
    assert_eq!(public["pages"][0]["citation_count"], 1);
    assert_eq!(
        public["pages"][0]["citations"][0]["quoting_source_seq"],
        public_quoter
    );
}
