use super::*;

async fn get_citations(app: &axum::Router, uri: String) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_citation_batch_is_bounded_flat_and_visibility_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone()).await;
    let topic = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO publication_surface (surface_id, search_group, title, href, updated_seq)
         VALUES ($1, 'discussions', 'Citation batch', '/discussions/general/t/fixture', 32)",
    )
    .bind(topic)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public_publication (surface_id, source_seq, body, href, occurred_at)
         SELECT $1, seq, 'Citation post', '/discussions/general/t/fixture', seq
         FROM generate_series(10, 32) AS seq",
    )
    .bind(topic)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public_citation (
             quoted_surface_id, quoted_source_seq, quoting_surface_id, quoting_source_seq, occurred_at
         ) SELECT $1, 10, $1, seq, seq FROM generate_series(11, 32) AS seq",
    )
    .bind(topic)
    .execute(&pool)
    .await
    .unwrap();

    for (limit_query, expected_previews) in [("", 5), ("&limit=0", 1), ("&limit=100", 20)] {
        let (status, json) = get_citations(
            &app,
            format!("/discussions/topics/{topic}/citations?source_seqs=32,10,999{limit_query}"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let batch: wire::PublicPostCitationBatch = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(batch.pages.len(), 2, "missing targets are omitted");
        assert_eq!(batch.pages[0].quoted_source_seq, 10);
        assert_eq!(batch.pages[0].citation_count, 22);
        assert_eq!(batch.pages[0].citations.len(), expected_previews);
        assert_eq!(batch.pages[1].quoted_source_seq, 32);
        assert_eq!(batch.pages[1].citation_count, 0);
        assert!(batch.pages[1].citations.is_empty());
        assert_eq!(
            json["pages"][0]["citations"][0],
            serde_json::json!({
                "quoting_surface_id": topic,
                "quoting_source_seq": 32,
                "occurred_at": 32,
            }),
        );
    }

    let source_seqs = (1..=50)
        .map(|seq| seq.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let (status, json) = get_citations(
        &app,
        format!("/discussions/topics/{topic}/citations?source_seqs={source_seqs}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["pages"].as_array().unwrap().len(), 23);

    for source_seqs in [
        "".to_owned(),
        "0".into(),
        "-1".into(),
        "1,1".into(),
        "1,,2".into(),
        "one".into(),
        "9223372036854775808".into(),
        format!("{source_seqs},51"),
    ] {
        let (status, json) = get_citations(
            &app,
            format!("/discussions/topics/{topic}/citations?source_seqs={source_seqs}"),
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
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/discussions/topics/{topic}/citations{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let removed = app
        .clone()
        .oneshot(
            Request::get(format!("/discussions/topics/{topic}/posts/10/citations"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(removed.status(), StatusCode::NOT_FOUND);

    sqlx::query(
        "UPDATE public_publication SET visible = false WHERE surface_id = $1 AND source_seq = 10",
    )
    .bind(topic)
    .execute(&pool)
    .await
    .unwrap();
    let (status, hidden_post) = get_citations(
        &app,
        format!("/discussions/topics/{topic}/citations?source_seqs=10,999"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(hidden_post, serde_json::json!({"pages": []}));

    sqlx::query("UPDATE publication_surface SET visible = false WHERE surface_id = $1")
        .bind(topic)
        .execute(&pool)
        .await
        .unwrap();
    for surface in [topic, Uuid::new_v4()] {
        let (status, json) = get_citations(
            &app,
            format!("/discussions/topics/{surface}/citations?source_seqs=10,32"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json, serde_json::json!({"pages": []}));
    }
}
