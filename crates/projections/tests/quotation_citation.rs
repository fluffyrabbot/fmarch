//! First-class quotations fold into public and private citation indexes identically.

use content_reference::{PostKind, PostRef};
use event_actor::ActorId;
use eventstore::EventInput;
use projections::test_support::append_discussion_and_project;
use projections::{
    append_and_project, discussion_posts, off_page_game_citation_counts, public_thread_view,
    rebuild, rebuild_discussion_stream, visible_incoming_citations,
    visible_public_incoming_citation_pages,
};
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileHandle, ProfilePresentation,
    ProfileVisibility,
};
use sqlx::Row;
use uuid::Uuid;

fn test_principal(value: u128) -> PrincipalId {
    PrincipalId::from_uuid(Uuid::from_u128(value))
}

fn test_game_created_payload(host_principal_id: PrincipalId, key: &str) -> serde_json::Value {
    let artifact = content_registry::select_pack_artifact(key)
        .unwrap_or_else(|error| panic!("select canonical test pack artifact `{key}`: {error}"));
    serde_json::json!({
        "host_principal_id": host_principal_id,
        "pack_ref": &artifact.pack_ref,
        "pack_artifact": artifact,
    })
}

async fn ensure_test_principal(pool: &sqlx::PgPool, principal_id: PrincipalId) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal_id, &[], 1)
        .await
        .unwrap();
}

async fn create_test_profile(
    pool: &sqlx::PgPool,
    principal: PrincipalId,
    handle: &str,
    display_name: &str,
    bio: &str,
    visibility: ProfileVisibility,
    occurred_at: i64,
) -> Uuid {
    let presentation = ProfilePresentation::new(
        ProfileHandle::new(handle).unwrap(),
        ProfileDisplayName::new(display_name).unwrap(),
        ProfileBio::new(bio).unwrap(),
        visibility,
    );
    profile_application::create_profile(pool, principal, presentation, occurred_at)
        .await
        .unwrap()
        .as_uuid()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_quotations_fold_and_rebuild_identically(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(81);
    let topic = Uuid::from_u128(82);
    let quote_member = test_principal(1);
    let moderator = test_principal(2);
    ensure_test_principal(&pool, quote_member).await;
    let profile = create_test_profile(
        &pool,
        quote_member,
        "quote_member",
        "Quote Member",
        "Cites sources",
        ProfileVisibility::Public,
        1,
    )
    .await;
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "quotes", "title": "Quotes", "description": "Citation proofs" }),
            ActorId::Principal(moderator),
            2,
        )],
    )
    .await
    .unwrap();
    let stored = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Signal theory", "author_profile_id": profile }),
                ActorId::Principal(quote_member),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Alpha signal analysis", "author_profile_id": profile }),
                ActorId::Principal(quote_member),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let quoted_seq = stored[1].seq;
    let quoting = append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": "Answering that claim",
                "author_profile_id": profile,
                "quotations": [{
                    "target": {
                        "kind": "discussion_post",
                        "scope_id": topic,
                        "source_seq": quoted_seq
                    },
                    "excerpt": "Alpha signal"
                }]
            }),
            ActorId::Principal(quote_member),
            5,
        )],
    )
    .await
    .unwrap();

    let before_citations = public_citation_rows(&pool, topic).await;
    let before_json: serde_json::Value = sqlx::query_scalar(
        "SELECT quotations FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(quoting[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before_citations.len(), 1);
    assert_eq!(before_citations[0].0, quoted_seq);
    assert_eq!(before_citations[0].1, quoting[0].seq);
    assert_eq!(before_json[0]["excerpt"], "Alpha signal");

    let quoted_events = eventstore::load_stream(&pool, topic).await.unwrap();
    let first_post = quoted_events
        .iter()
        .find(|event| event.kind == "DiscussionPostSubmitted")
        .unwrap();
    assert_eq!(first_post.payload["quotations"], serde_json::json!([]));

    rebuild_discussion_stream(&pool, topic).await.unwrap();
    let after_citations = public_citation_rows(&pool, topic).await;
    let after_json: serde_json::Value = sqlx::query_scalar(
        "SELECT quotations FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(quoting[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before_citations, after_citations);
    assert_eq!(before_json, after_json);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_quotations_fold_and_rebuild_identically(pool: sqlx::PgPool) {
    let game = Uuid::from_u128(91);
    let host = test_principal(3);
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload(host, "mafiascum"),
                ActorId::Principal(host),
                1,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                2,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "Alpha signal analysis",
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                3,
            ),
        ],
    )
    .await
    .unwrap();
    let quoted_seq: i64 = sqlx::query_scalar(
        "SELECT source_seq FROM thread_view WHERE game_id = $1 AND channel_id = 'main'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "main",
                "author": { "kind": "slot", "slot_id": "slot_1" },
                "body": "Answering that claim",
                "phase_id": "D01",
                "quotations": [{
                    "target": {
                        "kind": "game_post",
                        "scope_id": game,
                        "source_seq": quoted_seq
                    },
                    "excerpt": "Alpha signal"
                }]
            }),
            ActorId::Slot("slot_1".into()),
            4,
        )],
    )
    .await
    .unwrap();

    let before = public_citation_rows(&pool, game).await;
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].0, quoted_seq);

    rebuild(&pool, game).await.unwrap();
    assert_eq!(before, public_citation_rows(&pool, game).await);

    let page = public_thread_view(&pool, game, None, 10).await.unwrap();
    assert_eq!(page.posts.len(), 2);
    assert_eq!(page.posts[0].citation_count, 1);
    assert!(page.posts[0].quotations.is_empty());
    assert_eq!(page.posts[1].quotations[0].excerpt, "Alpha signal");
    assert_eq!(page.posts[1].citation_count, 0);
    let citations = visible_incoming_citations(
        &pool,
        PostRef {
            kind: PostKind::GamePost,
            scope_id: game,
            source_seq: quoted_seq,
        },
        Some("main"),
        5,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(citations.citation_count, 1);
    assert_eq!(
        citations.citations[0].quoting.source_seq,
        page.posts[1].source_seq
    );

    let quoting_seq = page.posts[1].source_seq;
    let off_page =
        off_page_game_citation_counts(&pool, game, "main", &[quoting_seq], &[quoting_seq])
            .await
            .unwrap();
    assert_eq!(off_page, vec![(quoted_seq, 1)]);
    assert!(off_page_game_citation_counts(
        &pool,
        game,
        "main",
        &[quoting_seq],
        &[quoted_seq, quoting_seq],
    )
    .await
    .unwrap()
    .is_empty());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_read_contract_counts_visible_citations_and_omits_hidden_quoters(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(101);
    let topic = Uuid::from_u128(102);
    let reader = test_principal(4);
    let moderator = test_principal(5);
    ensure_test_principal(&pool, reader).await;
    let profile = create_test_profile(
        &pool,
        reader,
        "reader",
        "Reader",
        "Reads community discussions",
        ProfileVisibility::Public,
        1,
    )
    .await;
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "read", "title": "Read", "description": "" }),
            ActorId::Principal(moderator),
            2,
        )],
    )
    .await
    .unwrap();
    let stored = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Claims", "author_profile_id": profile }),
                ActorId::Principal(reader),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Root claim", "author_profile_id": profile }),
                ActorId::Principal(reader),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let quoted_seq = stored[1].seq;
    let quoting = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": "Visible quote",
                    "author_profile_id": profile,
                    "quotations": [{
                        "target": {
                            "kind": "discussion_post",
                            "scope_id": topic,
                            "source_seq": quoted_seq
                        },
                        "excerpt": "Root"
                    }]
                }),
                ActorId::Principal(reader),
                5,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": "Hidden quote",
                    "author_profile_id": profile,
                    "quotations": [{
                        "target": {
                            "kind": "discussion_post",
                            "scope_id": topic,
                            "source_seq": quoted_seq
                        },
                        "excerpt": "Root"
                    }]
                }),
                ActorId::Principal(reader),
                6,
            ),
        ],
    )
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO moderation_target_state (
            surface_id, source_seq, visibility, reason,
            moderator_principal_id, updated_seq
        ) VALUES ($1, $2, 'hidden', 'spam', $3, $2)
        "#,
    )
    .bind(topic)
    .bind(quoting[1].seq)
    .bind(moderator.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public_publication SET visible = FALSE WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(quoting[1].seq)
    .execute(&pool)
    .await
    .unwrap();

    let page = discussion_posts(&pool, topic, None, 10, None)
        .await
        .unwrap();
    assert_eq!(page.posts.len(), 2);
    assert_eq!(page.posts[0].source_seq, quoted_seq);
    assert_eq!(page.posts[0].citation_count, 1);
    assert_eq!(page.posts[1].quotations[0].excerpt, "Root");
    assert_eq!(page.posts[1].citation_count, 0);

    let citations = visible_public_incoming_citation_pages(&pool, topic, &[quoted_seq], None, 1)
        .await
        .unwrap();
    assert_eq!(citations.len(), 1);
    let citations = &citations[0];
    assert_eq!(citations.citation_count, 1);
    assert_eq!(citations.citations.len(), 1);
    assert_eq!(citations.citations[0].quoting.source_seq, quoting[0].seq);
    assert!(
        visible_public_incoming_citation_pages(&pool, topic, &[quoting[1].seq], None, 5,)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn citation_batch_counts_before_each_target_limit_and_orders_by_sequence(pool: sqlx::PgPool) {
    let (author, profile) = citation_member(&pool, 201, "batch_author").await;
    let topic = Uuid::from_u128(202);
    citation_topic(&pool, Uuid::from_u128(203), topic, author, profile).await;
    let first = citation_post(&pool, topic, author, profile, &[], 10).await;
    let second = citation_post(&pool, topic, author, profile, &[], 11).await;
    let uncited = citation_post(&pool, topic, author, profile, &[], 12).await;
    let mut quoting_seqs = Vec::new();
    for index in 0..7 {
        let targets = if index < 2 {
            vec![first, second]
        } else {
            vec![first]
        };
        // Event sequence is authoritative even when the recorded clock goes backwards.
        quoting_seqs
            .push(citation_post(&pool, topic, author, profile, &targets, 100 - index).await);
    }

    let pages = visible_public_incoming_citation_pages(
        &pool,
        topic,
        &[uncited, second, first, i64::MAX],
        None,
        5,
    )
    .await
    .unwrap();
    assert_eq!(
        pages
            .iter()
            .map(|page| page.quoted.source_seq)
            .collect::<Vec<_>>(),
        vec![first, second, uncited],
        "visible targets are ordered independently of request order; missing targets are omitted"
    );
    assert!(pages.iter().all(|page| page.quoted.surface_id == topic));
    assert_eq!(pages[0].citation_count, 7);
    assert_eq!(pages[1].citation_count, 2);
    assert_eq!(pages[0].citations.len(), 5);
    assert_eq!(pages[1].citations.len(), 2, "the preview cap is per target");
    assert_eq!(
        pages[0]
            .citations
            .iter()
            .map(|row| row.quoting.source_seq)
            .collect::<Vec<_>>(),
        quoting_seqs
            .iter()
            .rev()
            .take(5)
            .copied()
            .collect::<Vec<_>>()
    );
    assert_eq!(
        pages[1]
            .citations
            .iter()
            .map(|row| row.quoting.source_seq)
            .collect::<Vec<_>>(),
        vec![quoting_seqs[1], quoting_seqs[0]]
    );
    assert_eq!(pages[0].citations[0].occurred_at, 94);
    assert_eq!(pages[0].citations[4].occurred_at, 98);
    assert_eq!(pages[2].citation_count, 0);
    assert!(
        pages[2].citations.is_empty(),
        "visible uncited targets still have a page"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn citation_batch_preview_rows_stay_bounded_at_fifty_targets(pool: sqlx::PgPool) {
    let (author, profile) = citation_member(&pool, 231, "batch_ceiling").await;
    let topic = Uuid::from_u128(232);
    citation_topic(&pool, Uuid::from_u128(233), topic, author, profile).await;
    let posts: Vec<_> = (0..71)
        .map(|index| {
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Claim", "author_profile_id": profile }),
                ActorId::Principal(author),
                10 + index,
            )
        })
        .collect();
    let stored = append_discussion_and_project(&pool, topic, &posts)
        .await
        .unwrap();
    let targets: Vec<_> = stored[..50].iter().map(|event| event.seq).collect();
    let quoters: Vec<_> = stored[50..].iter().map(|event| event.seq).collect();
    // Populate a dense read-index fixture over real publications to bound the
    // batch result independently of any one submission's quotation limit.
    sqlx::query(
        r#"
        INSERT INTO public_citation (
            quoted_surface_id, quoted_source_seq,
            quoting_surface_id, quoting_source_seq, occurred_at
        )
        SELECT $1, target.source_seq, $1, quoter.source_seq, 100
        FROM unnest($2::bigint[]) AS target(source_seq)
        CROSS JOIN unnest($3::bigint[]) AS quoter(source_seq)
        "#,
    )
    .bind(topic)
    .bind(&targets)
    .bind(&quoters)
    .execute(&pool)
    .await
    .unwrap();

    for (requested_limit, expected_limit) in [(5, 5), (i64::MAX, 20)] {
        let pages =
            visible_public_incoming_citation_pages(&pool, topic, &targets, None, requested_limit)
                .await
                .unwrap();
        assert_eq!(pages.len(), 50);
        assert_eq!(
            pages.iter().map(|page| page.citations.len()).sum::<usize>(),
            50 * expected_limit
        );
        for (page, source_seq) in pages.iter().zip(&targets) {
            assert_eq!(page.quoted.source_seq, *source_seq);
            assert_eq!(
                page.citation_count, 21,
                "preview limits must not truncate full counts"
            );
            assert_eq!(page.citations.len(), expected_limit);
            assert_eq!(
                page.citations
                    .iter()
                    .map(|row| row.quoting.source_seq)
                    .collect::<Vec<_>>(),
                quoters
                    .iter()
                    .rev()
                    .take(expected_limit)
                    .copied()
                    .collect::<Vec<_>>()
            );
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn citation_batch_applies_viewer_mutes_to_targets_counts_and_previews(pool: sqlx::PgPool) {
    let (author, author_profile) = citation_member(&pool, 211, "batch_visible").await;
    let (muted_author, muted_profile) = citation_member(&pool, 212, "batch_muted").await;
    let (viewer, _) = citation_member(&pool, 213, "batch_viewer").await;
    let topic = Uuid::from_u128(214);
    citation_topic(&pool, Uuid::from_u128(215), topic, author, author_profile).await;
    let target = citation_post(&pool, topic, author, author_profile, &[], 10).await;
    let hidden_target = citation_post(&pool, topic, author, author_profile, &[], 11).await;
    let muted_target = citation_post(&pool, topic, muted_author, muted_profile, &[], 12).await;
    let uncited = citation_post(&pool, topic, author, author_profile, &[], 13).await;
    let visible_quote = citation_post(&pool, topic, author, author_profile, &[target], 14).await;
    let muted_quote = citation_post(&pool, topic, muted_author, muted_profile, &[target], 15).await;
    sqlx::query(
        "UPDATE public_publication SET visible = FALSE WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(hidden_target)
    .execute(&pool)
    .await
    .unwrap();
    projections::mute_public_profile(&pool, viewer, "batch_muted", 16)
        .await
        .unwrap();

    let requested = [i64::MAX, muted_target, target, hidden_target, uncited];
    let anonymous = visible_public_incoming_citation_pages(&pool, topic, &requested, None, 5)
        .await
        .unwrap();
    assert_eq!(
        anonymous
            .iter()
            .map(|page| page.quoted.source_seq)
            .collect::<Vec<_>>(),
        vec![target, muted_target, uncited]
    );
    assert_eq!(anonymous[0].citation_count, 2);
    assert_eq!(
        anonymous[0]
            .citations
            .iter()
            .map(|row| row.quoting.source_seq)
            .collect::<Vec<_>>(),
        vec![muted_quote, visible_quote]
    );
    let personalized =
        visible_public_incoming_citation_pages(&pool, topic, &requested, Some(viewer), 1)
            .await
            .unwrap();
    assert_eq!(
        personalized
            .iter()
            .map(|page| page.quoted.source_seq)
            .collect::<Vec<_>>(),
        vec![target, uncited],
        "unknown, hidden, and muted targets are all omitted"
    );
    assert_eq!(
        personalized[0].citation_count, 1,
        "mutes apply before counting and before the one-row preview cap"
    );
    assert_eq!(personalized[0].citations.len(), 1);
    assert_eq!(
        personalized[0].citations[0].quoting.source_seq,
        visible_quote
    );
    assert_eq!(personalized[1].citation_count, 0);
    assert!(personalized[1].citations.is_empty());

    projections::unmute_public_profile(&pool, viewer, "batch_muted", 17)
        .await
        .unwrap();
    assert_eq!(
        visible_public_incoming_citation_pages(&pool, topic, &requested, Some(viewer), 5)
            .await
            .unwrap(),
        anonymous,
        "unmuting restores the same counts and previews as the anonymous view"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn citation_batch_requires_publication_and_surface_visibility_at_both_endpoints(
    pool: sqlx::PgPool,
) {
    let (author, profile) = citation_member(&pool, 221, "batch_surface").await;
    let quoted_topic = Uuid::from_u128(222);
    let quoting_topic = Uuid::from_u128(223);
    citation_topic(&pool, Uuid::from_u128(224), quoted_topic, author, profile).await;
    citation_topic(&pool, Uuid::from_u128(225), quoting_topic, author, profile).await;
    let target = citation_post(&pool, quoted_topic, author, profile, &[], 10).await;
    let quoting = citation_post(&pool, quoting_topic, author, profile, &[], 11).await;
    // The generic publication index resolves each endpoint independently. This
    // index fixture isolates surface overlays; it does not admit cross-topic
    // quotations through the discussion write model.
    sqlx::query(
        "INSERT INTO public_citation (quoted_surface_id, quoted_source_seq, quoting_surface_id, quoting_source_seq, occurred_at) VALUES ($1, $2, $3, $4, 11)",
    )
    .bind(quoted_topic)
    .bind(target)
    .bind(quoting_topic)
    .bind(quoting)
    .execute(&pool)
    .await
    .unwrap();
    let visible = visible_public_incoming_citation_pages(&pool, quoted_topic, &[target], None, 5)
        .await
        .unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].citation_count, 1);
    assert_eq!(visible[0].citations.len(), 1);
    assert_eq!(visible[0].citations[0].quoting.surface_id, quoting_topic);
    assert_eq!(visible[0].citations[0].quoting.source_seq, quoting);

    for (table, surface_id, source_seq, target_hidden) in [
        ("public_publication", quoting_topic, Some(quoting), false),
        ("publication_surface", quoting_topic, None, false),
        ("public_publication", quoted_topic, Some(target), true),
        ("publication_surface", quoted_topic, None, true),
    ] {
        set_citation_fixture_visibility(&pool, surface_id, source_seq, false).await;
        let hidden =
            visible_public_incoming_citation_pages(&pool, quoted_topic, &[target], None, 5)
                .await
                .unwrap();
        if target_hidden {
            assert!(
                hidden.is_empty(),
                "a hidden {table} target must not have a page"
            );
        } else {
            assert_eq!(hidden.len(), 1, "the visible target remains in the batch");
            assert_eq!(
                hidden[0].citation_count, 0,
                "hidden {table} citations do not count"
            );
            assert!(hidden[0].citations.is_empty());
        }
        set_citation_fixture_visibility(&pool, surface_id, source_seq, true).await;
        assert_eq!(
            visible_public_incoming_citation_pages(&pool, quoted_topic, &[target], None, 5)
                .await
                .unwrap(),
            visible,
            "restoring {table} visibility restores the citation"
        );
    }
}

async fn set_citation_fixture_visibility(
    pool: &sqlx::PgPool,
    surface_id: Uuid,
    source_seq: Option<i64>,
    visible: bool,
) {
    let update = match source_seq {
        Some(source_seq) => sqlx::query(
            "UPDATE public_publication SET visible = $1 WHERE surface_id = $2 AND source_seq = $3",
        )
        .bind(visible)
        .bind(surface_id)
        .bind(source_seq),
        None => sqlx::query("UPDATE publication_surface SET visible = $1 WHERE surface_id = $2")
            .bind(visible)
            .bind(surface_id),
    };
    assert_eq!(update.execute(pool).await.unwrap().rows_affected(), 1);
}

async fn citation_member(pool: &sqlx::PgPool, value: u128, handle: &str) -> (PrincipalId, Uuid) {
    let principal = test_principal(value);
    ensure_test_principal(pool, principal).await;
    let profile = create_test_profile(
        pool,
        principal,
        handle,
        handle,
        "Citation test member",
        ProfileVisibility::Public,
        1,
    )
    .await;
    (principal, profile)
}

async fn citation_topic(
    pool: &sqlx::PgPool,
    area: Uuid,
    topic: Uuid,
    author: PrincipalId,
    profile: Uuid,
) {
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated", 1,
            serde_json::json!({ "slug": format!("citations-{}", area.simple()), "title": "Citations", "description": "Citation proofs" }),
            ActorId::Principal(author), 2,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        pool,
        topic,
        &[EventInput::new(
            "DiscussionTopicCreated", 1,
            serde_json::json!({ "area_id": area, "title": "Cited claims", "author_profile_id": profile }),
            ActorId::Principal(author), 3,
        )],
    )
    .await
    .unwrap();
}

async fn citation_post(
    pool: &sqlx::PgPool,
    topic: Uuid,
    author: PrincipalId,
    profile: Uuid,
    targets: &[i64],
    occurred_at: i64,
) -> i64 {
    let quotations: Vec<_> = targets.iter().map(|source_seq| serde_json::json!({
        "target": { "kind": "discussion_post", "scope_id": topic, "source_seq": source_seq },
        "excerpt": "Claim"
    })).collect();
    append_discussion_and_project(
        pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted", 1,
            serde_json::json!({ "body": "Claim", "author_profile_id": profile, "quotations": quotations }),
            ActorId::Principal(author), occurred_at,
        )],
    )
    .await
    .unwrap()[0].seq
}

async fn public_citation_rows(pool: &sqlx::PgPool, surface_id: Uuid) -> Vec<(i64, i64)> {
    sqlx::query(
        r#"
        SELECT quoted_source_seq, quoting_source_seq
        FROM public_citation
        WHERE quoting_surface_id = $1
        ORDER BY quoting_source_seq, quoted_source_seq
        "#,
    )
    .bind(surface_id)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<i64, _>("quoted_source_seq"),
            row.get::<i64, _>("quoting_source_seq"),
        )
    })
    .collect()
}
