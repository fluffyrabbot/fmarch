//! A game's origin remains private until start, is source-owned, and replays
//! independently of both the forum stream and subscription stream.
use super::*;

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn signup_origin_is_private_until_start_and_rebuilds_without_duplicate_delivery(
    pool: PgPool,
) {
    let host = auxiliary_principal(0x5101);
    let early = auxiliary_principal(0x5102);
    let during_setup = auxiliary_principal(0x5103);
    let departed = auxiliary_principal(0x5104);
    let late = auxiliary_principal(0x5105);
    for principal in [host, early, during_setup, departed, late] {
        ensure_auxiliary_principal(&pool, principal).await;
    }
    let profile = create_auxiliary_profile(
        &pool,
        host,
        "signup_host",
        "Signup Host",
        "",
        ProfileVisibility::Public,
        1,
    )
    .await;
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({"slug":"signup", "title":"Signup", "description":"Ordinary topics"}),
            ActorId::Principal(host),
            2,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(&pool, topic, &[
        EventInput::new("DiscussionTopicCreated", 1, serde_json::json!({"area_id":area,"title":"Our signup","author_profile_id":profile}), ActorId::Principal(host), 3),
        EventInput::new("DiscussionPostSubmitted", 1, serde_json::json!({"body":"Join the game","author_profile_id":profile}), ActorId::Principal(host), 4),
    ]).await.unwrap();
    let target = WatchTarget { surface_id: topic };
    for principal in [host, early, departed] {
        projections::subscribe_to_public_target(&pool, target.clone(), principal, 5)
            .await
            .unwrap();
    }
    let game = Uuid::new_v4();
    let mut payload = test_game_created_payload(&host.to_string(), "signup_pack");
    payload["origin"] = serde_json::json!({"surface_id":topic,"source_seq":0});
    let created = append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "GameCreated",
            1,
            payload,
            ActorId::Principal(host),
            6,
        )],
    )
    .await
    .unwrap()[0]
        .seq;
    assert!(projections::public_game_by_id(&pool, game)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        projections::game_origin_topic(&pool, game)
            .await
            .unwrap()
            .unwrap()
            .topic_id,
        topic
    );
    assert!(discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .spawned_games
        .is_empty());
    assert!(projections::public_inbox(&pool, early, None, 20)
        .await
        .unwrap()
        .items
        .is_empty());
    // Membership at delivery, not at game creation, determines recipients.
    projections::subscribe_to_public_target(&pool, target.clone(), during_setup, 7)
        .await
        .unwrap();
    projections::unsubscribe_from_public_target(&pool, target.clone(), departed, 8)
        .await
        .unwrap();
    let started = append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "GameStarted",
            1,
            serde_json::json!({"phase_id":"D01"}),
            ActorId::Host,
            9,
        )],
    )
    .await
    .unwrap()[0]
        .seq;
    projections::subscribe_to_public_target(&pool, target.clone(), late, 10)
        .await
        .unwrap();
    for principal in [early, during_setup] {
        let inbox = projections::public_inbox(&pool, principal, None, 20)
            .await
            .unwrap();
        assert_eq!(inbox.items.len(), 1);
        assert_eq!(inbox.items[0].source_seq, created);
        assert_eq!(inbox.items[0].delivery_seq, started);
        assert_eq!(inbox.items[0].reason, "game_spawned_from_watched_topic");
        assert_eq!(inbox.items[0].href, format!("/games/{game}"));
        assert_eq!(inbox.unread_count, 1);
    }
    for principal in [host, departed, late] {
        assert!(projections::public_inbox(&pool, principal, None, 20)
            .await
            .unwrap()
            .items
            .is_empty());
    }
    let before = projections::public_inbox(&pool, during_setup, None, 20)
        .await
        .unwrap();
    let topic_before = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    assert_eq!(topic_before.spawned_games.len(), 1);
    assert_eq!(topic_before.posting_state, "open");
    assert_eq!(
        projections::public_game_by_id(&pool, game)
            .await
            .unwrap()
            .unwrap()
            .origin_topic
            .unwrap()
            .topic_id,
        topic
    );
    // A launch address is an attention destination, never authored content.
    // Normal posts remain quotable, while the same topic + GameCreated address
    // visible in the inbox must not become quotation or report evidence.
    let quotation_state =
        projections::quotation_thread_for_discussion(&pool, topic, Some(during_setup))
            .await
            .unwrap();
    assert_eq!(quotation_state.posts.len(), 1);
    let opening_quotation = content_reference::Quotation {
        target: content_reference::PostRef {
            kind: content_reference::PostKind::DiscussionPost,
            scope_id: topic,
            source_seq: quotation_state.posts[0].source_seq,
        },
        excerpt: "Join the game".into(),
    };
    assert!(content_reference::decide_quotations(&quotation_state, &[opening_quotation]).is_ok());
    let launch_quotation = content_reference::Quotation {
        target: content_reference::PostRef {
            kind: content_reference::PostKind::DiscussionPost,
            scope_id: topic,
            source_seq: created,
        },
        excerpt: "Our signup".into(),
    };
    assert_eq!(
        content_reference::decide_quotations(&quotation_state, &[launch_quotation]),
        Err(content_reference::ContentReferenceReject::QuotationNotFound)
    );
    let launch_report = Uuid::new_v4();
    assert!(matches!(
        projections::submit_moderation_report(
            &pool,
            ModerationTarget {
                public: PublicContentRef::new(topic, created),
            },
            launch_report,
            during_setup,
            ReportReasonFamily::Other,
            "An inbox destination is not post evidence".into(),
            10,
        )
        .await,
        Err(ProjectionError::ModerationTargetNotPublic)
    ));
    assert!(
        projections::moderation_report_receipt(&pool, launch_report, during_setup)
            .await
            .unwrap()
            .is_none()
    );

    // Exercise the game publication's independent read-time visibility gate.
    // There is no game-surface hide command; this fixture changes only that
    // projection bit, then restores it without replay or delivery mutation.
    assert_eq!(
        sqlx::query("UPDATE publication_surface SET visible = FALSE WHERE surface_id = $1")
            .bind(game)
            .execute(&pool)
            .await
            .unwrap()
            .rows_affected(),
        1
    );
    assert!(discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .spawned_games
        .is_empty());
    let hidden_game_inbox = projections::public_inbox(&pool, during_setup, None, 20)
        .await
        .unwrap();
    assert!(hidden_game_inbox.items.is_empty());
    assert_eq!(hidden_game_inbox.unread_count, 0);
    let retained_delivery: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM member_inbox_item WHERE principal_id = $1 AND surface_id = $2 AND source_seq = $3 AND reason = 'game_spawned_from_watched_topic'",
    )
    .bind(during_setup.as_uuid())
    .bind(topic)
    .bind(created)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        retained_delivery, 1,
        "visibility must not erase launch history"
    );
    assert_eq!(
        sqlx::query("UPDATE publication_surface SET visible = TRUE WHERE surface_id = $1")
            .bind(game)
            .execute(&pool)
            .await
            .unwrap()
            .rows_affected(),
        1
    );
    assert_eq!(
        discussion_topic_by_id(&pool, topic).await.unwrap().unwrap(),
        topic_before
    );
    assert_eq!(
        projections::public_inbox(&pool, during_setup, None, 20)
            .await
            .unwrap(),
        before,
        "restoring game visibility reveals the original delivery without duplication"
    );
    let auto_watches: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM public_watch WHERE surface_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(auto_watches, 0);
    let subscription: Uuid = sqlx::query_scalar(
        "SELECT subscription_id FROM public_watch WHERE surface_id = $1 AND principal_id = $2",
    )
    .bind(topic)
    .bind(during_setup.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    for _ in 0..2 {
        rebuild(&pool, game).await.unwrap();
        assert_eq!(
            projections::public_inbox(&pool, during_setup, None, 20)
                .await
                .unwrap(),
            before
        );
        rebuild_discussion_stream(&pool, topic).await.unwrap();
        assert_eq!(
            projections::public_inbox(&pool, during_setup, None, 20)
                .await
                .unwrap(),
            before
        );
        projections::rebuild_subscription_stream(&pool, subscription)
            .await
            .unwrap();
        assert_eq!(
            discussion_topic_by_id(&pool, topic).await.unwrap().unwrap(),
            topic_before
        );
        assert_eq!(
            projections::public_inbox(&pool, during_setup, None, 20)
                .await
                .unwrap(),
            before
        );
    }
    // The audit includes launch attention, not only the reverse edge.
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
    sqlx::query(
        "DELETE FROM member_inbox_item WHERE principal_id=$1 AND surface_id=$2 AND source_seq=$3",
    )
    .bind(during_setup.as_uuid())
    .bind(topic)
    .bind(created)
    .execute(&pool)
    .await
    .unwrap();
    let damaged = audit_rebuild(&pool, game).await.unwrap();
    assert!(!damaged.ok);
    assert!(damaged
        .tables
        .iter()
        .any(|table| table.table == "member_inbox_item" && !table.matches));
    assert!(
        projections::public_inbox(&pool, during_setup, None, 20)
            .await
            .unwrap()
            .items
            .is_empty(),
        "audit is rollback-only"
    );
    rebuild(&pool, game).await.unwrap();
    sqlx::query("INSERT INTO member_inbox_item (principal_id,surface_id,source_seq,delivery_seq,reason,occurred_at) VALUES ($1,$2,$3,$4,'game_spawned_from_watched_topic',9)")
        .bind(late.as_uuid()).bind(topic).bind(created).bind(started).execute(&pool).await.unwrap();
    assert!(
        !audit_rebuild(&pool, game).await.unwrap().ok,
        "spurious recipient is corruption too"
    );
    rebuild(&pool, game).await.unwrap();
    assert!(projections::public_inbox(&pool, late, None, 20)
        .await
        .unwrap()
        .items
        .is_empty());
    sqlx::query("DELETE FROM discussion_topic_spawned_game WHERE game_id=$1")
        .bind(game)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!audit_rebuild(&pool, game).await.unwrap().ok);
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::public_inbox(&pool, during_setup, None, 20)
            .await
            .unwrap(),
        before,
        "replay fences and cleans by canonical event origin even when the reverse edge is absent"
    );
    // Topic visibility controls links and delivery reads without erasing origin.
    append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionTopicVisibilityChanged",
            1,
            serde_json::json!({"visibility":"hidden"}),
            ActorId::Principal(host),
            11,
        )],
    )
    .await
    .unwrap();
    assert!(projections::public_game_by_id(&pool, game)
        .await
        .unwrap()
        .unwrap()
        .origin_topic
        .is_none());
    assert!(projections::public_inbox(&pool, during_setup, None, 20)
        .await
        .unwrap()
        .items
        .is_empty());
    append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionTopicVisibilityChanged",
            1,
            serde_json::json!({"visibility":"visible"}),
            ActorId::Principal(host),
            12,
        )],
    )
    .await
    .unwrap();
    assert_eq!(
        projections::public_inbox(&pool, during_setup, None, 20)
            .await
            .unwrap(),
        before
    );
    // A second game from the same ordinary topic has its own stable edge.
    let second = Uuid::new_v4();
    let mut payload = test_game_created_payload(&host.to_string(), "signup_pack");
    payload["origin"] = serde_json::json!({"surface_id":topic,"source_seq":0});
    append_and_project(
        &pool,
        second,
        &[
            EventInput::new("GameCreated", 1, payload, ActorId::Principal(host), 13),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({"phase_id":"D01"}),
                ActorId::Host,
                14,
            ),
        ],
    )
    .await
    .unwrap();
    assert_eq!(
        discussion_topic_by_id(&pool, topic)
            .await
            .unwrap()
            .unwrap()
            .spawned_games
            .len(),
        2
    );
    let inbox = projections::public_inbox(&pool, during_setup, None, 20)
        .await
        .unwrap();
    assert_eq!(inbox.items.len(), 2);
    let latest_delivery = inbox.items[0].delivery_seq;
    projections::advance_subscription_read_cursor(&pool, target, during_setup, latest_delivery, 15)
        .await
        .unwrap();
    projections::advance_member_inbox_read_cursor(&pool, early, latest_delivery, 16)
        .await
        .unwrap();
    for principal in [early, during_setup] {
        assert_eq!(
            projections::public_inbox(&pool, principal, None, 20)
                .await
                .unwrap()
                .unread_count,
            0
        );
    }
    rebuild(&pool, second).await.unwrap();
    for principal in [early, during_setup] {
        assert_eq!(
            projections::public_inbox(&pool, principal, None, 20)
                .await
                .unwrap()
                .unread_count,
            0,
            "replay cannot reopen already read launch delivery"
        );
    }
}
