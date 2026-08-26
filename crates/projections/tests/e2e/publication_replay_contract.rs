use super::*;

const DISCUSSION_QUERY: &str = "adapterreplaydiscussiontoken";
const GAME_QUERY: &str = "adapterreplaygametoken";

#[derive(Clone, Copy)]
enum PublicationAdapter {
    Discussion,
    Game,
}

impl PublicationAdapter {
    const fn label(self) -> &'static str {
        match self {
            Self::Discussion => "discussion",
            Self::Game => "game",
        }
    }

    const fn document_type(self) -> projections::PublicSearchDocumentType {
        match self {
            Self::Discussion => projections::PublicSearchDocumentType::DiscussionPost,
            Self::Game => projections::PublicSearchDocumentType::GamePost,
        }
    }

    const fn search_group(self) -> projections::PublicSearchGroup {
        match self {
            Self::Discussion => projections::PublicSearchGroup::Discussions,
            Self::Game => projections::PublicSearchGroup::Games,
        }
    }

    const fn visible_to_muting_viewer(self) -> bool {
        match self {
            Self::Discussion => false,
            Self::Game => true,
        }
    }

    async fn rebuild_source(self, pool: &PgPool, surface_id: Uuid) {
        match self {
            Self::Discussion => rebuild_discussion_stream(pool, surface_id).await.unwrap(),
            Self::Game => rebuild(pool, surface_id).await.unwrap(),
        }
    }
}

#[derive(Clone, Copy)]
struct AdapterFixture {
    adapter: PublicationAdapter,
    surface_id: Uuid,
    source_seq: i64,
    query: &'static str,
}

impl AdapterFixture {
    fn document_key(self) -> String {
        format!("{}-{}", self.surface_id, self.source_seq)
    }
}

async fn assert_adapter_visibility(
    pool: &PgPool,
    fixture: AdapterFixture,
    viewer: PrincipalId,
    globally_visible: bool,
    context: &str,
) {
    let projection: (bool, bool, Option<Uuid>) = sqlx::query_as(
        r#"
        SELECT publication.visible, search.visible, publication.author_profile_id
        FROM public_publication AS publication
        JOIN public_search_document AS search
          ON search.surface_id = publication.surface_id
         AND search.source_seq = publication.source_seq
        WHERE publication.surface_id = $1
          AND publication.source_seq = $2
          AND search.document_type = $3
        "#,
    )
    .bind(fixture.surface_id)
    .bind(fixture.source_seq)
    .bind(fixture.adapter.document_type().as_str())
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        projection.0,
        globally_visible,
        "{} {context}: publication visibility diverged",
        fixture.adapter.label()
    );
    assert_eq!(
        projection.1,
        globally_visible,
        "{} {context}: search visibility diverged",
        fixture.adapter.label()
    );
    match fixture.adapter {
        PublicationAdapter::Discussion => assert!(projection.2.is_some()),
        PublicationAdapter::Game => assert!(projection.2.is_none()),
    }

    let filter = PublicSearchFilter::Group(fixture.adapter.search_group());
    let expected_key = fixture.document_key();
    for (viewer_label, viewer_principal, expected_visible) in [
        ("anonymous", None, globally_visible),
        (
            "muting-viewer",
            Some(viewer),
            globally_visible && fixture.adapter.visible_to_muting_viewer(),
        ),
    ] {
        let page = public_search(pool, fixture.query, filter, None, 10, viewer_principal)
            .await
            .unwrap();
        let matches = page
            .results
            .iter()
            .filter(|row| {
                row.kind == fixture.adapter.document_type() && row.document_key == expected_key
            })
            .count();
        assert_eq!(
            matches,
            usize::from(expected_visible),
            "{} {context}/{viewer_label}: search visibility diverged",
            fixture.adapter.label()
        );
    }
}

async fn open_and_hide(
    pool: &PgPool,
    fixture: AdapterFixture,
    reporter: PrincipalId,
    moderator: PrincipalId,
    occurred_at: i64,
) -> Uuid {
    projections::submit_moderation_report(
        pool,
        ModerationTarget {
            public: PublicContentRef::new(fixture.surface_id, fixture.source_seq),
        },
        Uuid::new_v4(),
        reporter,
        ReportReasonFamily::Spam,
        format!("{} adapter replay contract", fixture.adapter.label()),
        occurred_at,
    )
    .await
    .unwrap();
    let case_id: Uuid = sqlx::query_scalar(
        "SELECT case_id FROM moderation_case WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(fixture.surface_id)
    .bind(fixture.source_seq)
    .fetch_one(pool)
    .await
    .unwrap();
    let state = projections::moderation_case_state(pool, case_id)
        .await
        .unwrap()
        .unwrap();
    let events = trust_safety::decide_moderation(
        Some(&state),
        ModerationCommand::Hide {
            reason: "adapter replay contract hide".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        pool,
        case_id,
        state.version,
        events,
        moderator,
        occurred_at + 1,
    )
    .await
    .unwrap();
    case_id
}

async fn restore(pool: &PgPool, case_id: Uuid, moderator: PrincipalId, occurred_at: i64) {
    let state = projections::moderation_case_state(pool, case_id)
        .await
        .unwrap()
        .unwrap();
    let events = trust_safety::decide_moderation(
        Some(&state),
        ModerationCommand::Restore {
            reason: "adapter replay contract restore".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        pool,
        case_id,
        state.version,
        events,
        moderator,
        occurred_at,
    )
    .await
    .unwrap();
}

async fn prove_replay_contract(
    pool: &PgPool,
    fixture: AdapterFixture,
    viewer: PrincipalId,
    reporter: PrincipalId,
    moderator: PrincipalId,
    occurred_at: i64,
) {
    assert_adapter_visibility(pool, fixture, viewer, true, "initial").await;

    let case_id = open_and_hide(pool, fixture, reporter, moderator, occurred_at).await;
    assert_adapter_visibility(pool, fixture, viewer, false, "hidden").await;

    fixture
        .adapter
        .rebuild_source(pool, fixture.surface_id)
        .await;
    assert_adapter_visibility(pool, fixture, viewer, false, "source-rebuilt while hidden").await;

    rebuild_moderation_stream(pool, case_id).await.unwrap();
    assert_adapter_visibility(
        pool,
        fixture,
        viewer,
        false,
        "moderation-rebuilt after source",
    )
    .await;

    restore(pool, case_id, moderator, occurred_at + 2).await;
    assert_adapter_visibility(pool, fixture, viewer, true, "restored").await;

    rebuild_moderation_stream(pool, case_id).await.unwrap();
    assert_adapter_visibility(
        pool,
        fixture,
        viewer,
        true,
        "moderation-rebuilt while visible",
    )
    .await;

    fixture
        .adapter
        .rebuild_source(pool, fixture.surface_id)
        .await;
    assert_adapter_visibility(
        pool,
        fixture,
        viewer,
        true,
        "source-rebuilt after moderation",
    )
    .await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn publication_adapters_preserve_moderation_and_mute_overlays_across_replay(pool: PgPool) {
    let author = auxiliary_principal(0x2501);
    let viewer = auxiliary_principal(0x2502);
    let reporter = auxiliary_principal(0x2503);
    let moderator = auxiliary_principal(0x2504);
    let host = auxiliary_principal(0x2505);
    for principal in [author, viewer, reporter, moderator, host] {
        ensure_auxiliary_principal(&pool, principal).await;
    }
    let author_profile_id = create_auxiliary_profile(
        &pool,
        author,
        "adapter_author",
        "Adapter Author",
        "Stable publication adapter author",
        ProfileVisibility::Public,
        1,
    )
    .await;
    create_auxiliary_profile(
        &pool,
        viewer,
        "adapter_viewer",
        "Adapter Viewer",
        "Personalized publication adapter viewer",
        ProfileVisibility::Public,
        2,
    )
    .await;
    projections::mute_public_profile(&pool, viewer, "adapter_author", 3)
        .await
        .unwrap();
    let relationship_id: Uuid = sqlx::query_scalar(
        "SELECT relationship_id FROM profile_mute WHERE principal_id = $1 AND target_profile_id = $2",
    )
    .bind(viewer.as_uuid())
    .bind(author_profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();

    let area = Uuid::from_u128(0x5055_424c_4943_4154_494f_4e00_0001);
    let topic = Uuid::from_u128(0x5055_424c_4943_4154_494f_4e00_0002);
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({
                "slug": "adapter-replay",
                "title": "Adapter replay",
                "description": "Publication adapter replay contract"
            }),
            ActorId::Principal(moderator),
            4,
        )],
    )
    .await
    .unwrap();
    let discussion_events = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({
                    "area_id": area,
                    "title": "Replay contract topic",
                    "author_profile_id": author_profile_id
                }),
                ActorId::Principal(author),
                5,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": DISCUSSION_QUERY,
                    "author_profile_id": author_profile_id
                }),
                ActorId::Principal(author),
                6,
            ),
        ],
    )
    .await
    .unwrap();
    let discussion = AdapterFixture {
        adapter: PublicationAdapter::Discussion,
        surface_id: topic,
        source_seq: discussion_events[1].seq,
        query: DISCUSSION_QUERY,
    };

    let game = Uuid::from_u128(0x5055_424c_4943_4154_494f_4e00_0003);
    let game_events = append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload(&host.to_string(), "adapter_replay_contract"),
                ActorId::Principal(host),
                7,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                8,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": GAME_QUERY,
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                9,
            ),
        ],
    )
    .await
    .unwrap();
    let game = AdapterFixture {
        adapter: PublicationAdapter::Game,
        surface_id: game,
        source_seq: game_events[2].seq,
        query: GAME_QUERY,
    };

    prove_replay_contract(&pool, discussion, viewer, reporter, moderator, 20).await;
    prove_replay_contract(&pool, game, viewer, reporter, moderator, 30).await;

    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();
    assert_adapter_visibility(&pool, discussion, viewer, true, "final mute replay").await;
    assert_adapter_visibility(&pool, game, viewer, true, "final mute replay").await;
}
