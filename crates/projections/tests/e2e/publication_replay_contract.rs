use super::*;

const PROFILE_QUERY: &str = "latticeprofiletoken";
const DISCUSSION_SURFACE_QUERY: &str = "latticediscussionsurfacetoken";
const DISCUSSION_POST_QUERY: &str = "latticediscussionposttoken";
const GAME_SURFACE_QUERY: &str = "latticegamesurfacetoken";
const GAME_POST_QUERY: &str = "latticegameposttoken";

#[derive(Clone, Copy)]
enum SourceAdapter {
    Profile,
    Discussion,
    Game,
}

impl SourceAdapter {
    async fn rebuild(self, pool: &PgPool, surface_id: Uuid) {
        match self {
            Self::Profile => rebuild_profile_stream(pool, surface_id).await.unwrap(),
            Self::Discussion => rebuild_discussion_stream(pool, surface_id).await.unwrap(),
            Self::Game => rebuild(pool, surface_id).await.unwrap(),
        }
    }
}

#[derive(Clone, Copy)]
struct SearchFixture {
    label: &'static str,
    adapter: SourceAdapter,
    document_type: projections::PublicSearchDocumentType,
    surface_id: Uuid,
    source_seq: i64,
    query: &'static str,
    author_profile_id: Option<Uuid>,
}

impl SearchFixture {
    fn document_key(self) -> String {
        format!("{}-{}", self.surface_id, self.source_seq)
    }

    const fn is_post(self) -> bool {
        matches!(
            self.document_type,
            projections::PublicSearchDocumentType::DiscussionPost
                | projections::PublicSearchDocumentType::GamePost
        )
    }
}

#[derive(Clone, Copy)]
struct ProjectedVisibility {
    surface: bool,
    document: bool,
}

impl ProjectedVisibility {
    const VISIBLE: Self = Self {
        surface: true,
        document: true,
    };

    const fn effective(self) -> bool {
        self.surface && self.document
    }
}

#[derive(Clone, Copy)]
struct FixtureSet {
    profile: SearchFixture,
    discussion: SearchFixture,
    discussion_post: SearchFixture,
    game: SearchFixture,
    game_post: SearchFixture,
}

#[derive(Clone, Copy)]
struct LatticeState {
    profile_present: bool,
    discussion_surface_visible: bool,
    discussion_post_visible: bool,
    game_post_visible: bool,
}

impl LatticeState {
    const INITIAL: Self = Self {
        profile_present: true,
        discussion_surface_visible: true,
        discussion_post_visible: true,
        game_post_visible: true,
    };
}

async fn assert_search_visibility(
    pool: &PgPool,
    fixture: SearchFixture,
    viewer: PrincipalId,
    globally_visible: bool,
    context: &str,
) {
    let expected_key = fixture.document_key();
    for (viewer_label, viewer_principal, expected_visible) in [
        ("anonymous", None, globally_visible),
        (
            "muting-viewer",
            Some(viewer),
            globally_visible && fixture.author_profile_id.is_none(),
        ),
    ] {
        let page = public_search(
            pool,
            fixture.query,
            PublicSearchFilter::Group(fixture.document_type.group()),
            None,
            10,
            viewer_principal,
        )
        .await
        .unwrap();
        let matches = page
            .results
            .iter()
            .filter(|row| row.kind == fixture.document_type && row.document_key == expected_key)
            .count();
        assert_eq!(
            matches,
            usize::from(expected_visible),
            "{} {context}/{viewer_label}: effective search visibility diverged",
            fixture.label
        );
    }
}

async fn assert_document(
    pool: &PgPool,
    fixture: SearchFixture,
    viewer: PrincipalId,
    expected: Option<ProjectedVisibility>,
    context: &str,
) {
    let projection: Option<(bool, bool, Option<Uuid>, Option<bool>)> = sqlx::query_as(
        r#"
        SELECT surface.visible,
               search.visible,
               search.author_profile_id,
               publication.visible
        FROM publication_surface AS surface
        JOIN public_search_document AS search
          ON search.surface_id = surface.surface_id
        LEFT JOIN public_publication AS publication
          ON publication.surface_id = search.surface_id
         AND publication.source_seq = search.source_seq
        WHERE search.surface_id = $1
          AND search.source_seq = $2
          AND search.document_type = $3
        "#,
    )
    .bind(fixture.surface_id)
    .bind(fixture.source_seq)
    .bind(fixture.document_type.as_str())
    .fetch_optional(pool)
    .await
    .unwrap();

    match (projection, expected) {
        (None, None) => {}
        (None, Some(_)) => panic!("{} {context}: projected document is absent", fixture.label),
        (Some(_), None) => panic!("{} {context}: projected document survived", fixture.label),
        (Some(actual), Some(expected)) => {
            assert_eq!(
                actual.0, expected.surface,
                "{} {context}: surface visibility diverged",
                fixture.label
            );
            assert_eq!(
                actual.1, expected.document,
                "{} {context}: document visibility diverged",
                fixture.label
            );
            assert_eq!(
                actual.2, fixture.author_profile_id,
                "{} {context}: author attribution diverged",
                fixture.label
            );
            assert_eq!(
                actual.3,
                fixture.is_post().then_some(expected.document),
                "{} {context}: publication visibility diverged",
                fixture.label
            );
        }
    }

    assert_search_visibility(
        pool,
        fixture,
        viewer,
        expected.is_some_and(ProjectedVisibility::effective),
        context,
    )
    .await;
}

async fn assert_lattice(
    pool: &PgPool,
    fixtures: FixtureSet,
    viewer: PrincipalId,
    state: LatticeState,
    context: &str,
) {
    assert_document(
        pool,
        fixtures.profile,
        viewer,
        state
            .profile_present
            .then_some(ProjectedVisibility::VISIBLE),
        context,
    )
    .await;
    assert_document(
        pool,
        fixtures.discussion,
        viewer,
        Some(ProjectedVisibility {
            surface: state.discussion_surface_visible,
            document: state.discussion_surface_visible,
        }),
        context,
    )
    .await;
    assert_document(
        pool,
        fixtures.discussion_post,
        viewer,
        Some(ProjectedVisibility {
            surface: state.discussion_surface_visible,
            document: state.discussion_post_visible,
        }),
        context,
    )
    .await;
    assert_document(
        pool,
        fixtures.game,
        viewer,
        Some(ProjectedVisibility::VISIBLE),
        context,
    )
    .await;
    assert_document(
        pool,
        fixtures.game_post,
        viewer,
        Some(ProjectedVisibility {
            surface: true,
            document: state.game_post_visible,
        }),
        context,
    )
    .await;
}

async fn open_and_hide(
    pool: &PgPool,
    fixture: SearchFixture,
    reporter: PrincipalId,
    moderator: PrincipalId,
    occurred_at: i64,
) -> Uuid {
    assert!(fixture.is_post(), "only publications can be moderated");
    projections::submit_moderation_report(
        pool,
        ModerationTarget {
            public: PublicContentRef::new(fixture.surface_id, fixture.source_seq),
        },
        Uuid::new_v4(),
        reporter,
        ReportReasonFamily::Spam,
        format!("{} visibility lattice contract", fixture.label),
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
            reason: "visibility lattice contract hide".into(),
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
            reason: "visibility lattice contract restore".into(),
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

async fn update_profile_visibility(
    pool: &PgPool,
    profile_id: Uuid,
    principal: PrincipalId,
    expected_revision: u64,
    visibility: ProfileVisibility,
    occurred_at: i64,
) {
    profile_application::update_profile(
        pool,
        ProfileId::from_uuid(profile_id),
        principal,
        ProfileRevision::new(expected_revision),
        test_profile_edit(
            &format!("{PROFILE_QUERY} Author"),
            "Publication visibility lattice author",
            visibility,
        ),
        occurred_at,
    )
    .await
    .unwrap();
}

async fn set_topic_visibility(
    pool: &PgPool,
    topic_id: Uuid,
    expected_version: i64,
    visible: bool,
    moderator: PrincipalId,
    occurred_at: i64,
) {
    append_discussion_and_project_expected(
        pool,
        topic_id,
        expected_version,
        &[EventInput::new(
            "DiscussionTopicVisibilityChanged",
            1,
            serde_json::json!({
                "visibility": if visible { "visible" } else { "hidden" }
            }),
            ActorId::Principal(moderator),
            occurred_at,
        )],
    )
    .await
    .unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn all_publication_types_preserve_the_visibility_lattice_across_replay(pool: PgPool) {
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
        "lattice_author",
        &format!("{PROFILE_QUERY} Author"),
        "Publication visibility lattice author",
        ProfileVisibility::Public,
        1,
    )
    .await;
    create_auxiliary_profile(
        &pool,
        viewer,
        "lattice_viewer",
        "Lattice Viewer",
        "Personalized visibility lattice viewer",
        ProfileVisibility::Public,
        2,
    )
    .await;
    projections::mute_public_profile(&pool, viewer, "lattice_author", 3)
        .await
        .unwrap();
    let durable_mute: (Uuid, i64) = sqlx::query_as(
        "SELECT relationship_id, version FROM profile_mute WHERE principal_id = $1 AND target_profile_id = $2",
    )
    .bind(viewer.as_uuid())
    .bind(author_profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let relationship_id = durable_mute.0;

    let area = Uuid::from_u128(0x5055_424c_4943_4154_494f_4e00_0001);
    let topic = Uuid::from_u128(0x5055_424c_4943_4154_494f_4e00_0002);
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({
                "slug": "visibility-lattice",
                "title": "Visibility lattice",
                "description": "Publication visibility lattice contract"
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
                    "title": DISCUSSION_SURFACE_QUERY,
                    "author_profile_id": author_profile_id
                }),
                ActorId::Principal(author),
                5,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": DISCUSSION_POST_QUERY,
                    "author_profile_id": author_profile_id
                }),
                ActorId::Principal(author),
                6,
            ),
        ],
    )
    .await
    .unwrap();

    let game_id = Uuid::from_u128(0x5055_424c_4943_4154_494f_4e00_0003);
    append_and_project(
        &pool,
        game_id,
        &[EventInput::new(
            "GameCreated",
            1,
            test_game_created_payload(&host.to_string(), GAME_SURFACE_QUERY),
            ActorId::Principal(host),
            7,
        )],
    )
    .await
    .unwrap();
    let setup_game = SearchFixture {
        label: "game",
        adapter: SourceAdapter::Game,
        document_type: projections::PublicSearchDocumentType::Game,
        surface_id: game_id,
        source_seq: 0,
        query: GAME_SURFACE_QUERY,
        author_profile_id: None,
    };
    assert_document(&pool, setup_game, viewer, None, "setup lifecycle").await;

    let game_events = append_and_project(
        &pool,
        game_id,
        &[
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
                    "body": GAME_POST_QUERY,
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                9,
            ),
        ],
    )
    .await
    .unwrap();

    let fixtures = FixtureSet {
        profile: SearchFixture {
            label: "profile",
            adapter: SourceAdapter::Profile,
            document_type: projections::PublicSearchDocumentType::Profile,
            surface_id: author_profile_id,
            source_seq: 0,
            query: PROFILE_QUERY,
            author_profile_id: Some(author_profile_id),
        },
        discussion: SearchFixture {
            label: "discussion",
            adapter: SourceAdapter::Discussion,
            document_type: projections::PublicSearchDocumentType::Discussion,
            surface_id: topic,
            source_seq: 0,
            query: DISCUSSION_SURFACE_QUERY,
            author_profile_id: Some(author_profile_id),
        },
        discussion_post: SearchFixture {
            label: "discussion-post",
            adapter: SourceAdapter::Discussion,
            document_type: projections::PublicSearchDocumentType::DiscussionPost,
            surface_id: topic,
            source_seq: discussion_events[1].seq,
            query: DISCUSSION_POST_QUERY,
            author_profile_id: Some(author_profile_id),
        },
        game: setup_game,
        game_post: SearchFixture {
            label: "game-post",
            adapter: SourceAdapter::Game,
            document_type: projections::PublicSearchDocumentType::GamePost,
            surface_id: game_id,
            source_seq: game_events[1].seq,
            query: GAME_POST_QUERY,
            author_profile_id: None,
        },
    };

    assert_lattice(&pool, fixtures, viewer, LatticeState::INITIAL, "initial").await;
    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        LatticeState::INITIAL,
        "mute replay",
    )
    .await;

    update_profile_visibility(
        &pool,
        author_profile_id,
        author,
        1,
        ProfileVisibility::Private,
        10,
    )
    .await;
    let mut state = LatticeState {
        profile_present: false,
        ..LatticeState::INITIAL
    };
    assert_lattice(&pool, fixtures, viewer, state, "private profile").await;
    assert!(projections::member_mutes(&pool, viewer, None, 20)
        .await
        .unwrap()
        .members
        .is_empty());
    assert_eq!(
        sqlx::query_as::<_, (Uuid, i64)>(
            "SELECT relationship_id, version FROM profile_mute WHERE principal_id = $1 AND target_profile_id = $2",
        )
        .bind(viewer.as_uuid())
        .bind(author_profile_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        durable_mute,
    );
    fixtures
        .profile
        .adapter
        .rebuild(&pool, author_profile_id)
        .await;
    assert_lattice(&pool, fixtures, viewer, state, "private profile replay").await;
    update_profile_visibility(
        &pool,
        author_profile_id,
        author,
        2,
        ProfileVisibility::Public,
        11,
    )
    .await;
    state.profile_present = true;
    assert_lattice(&pool, fixtures, viewer, state, "public profile restored").await;
    assert_eq!(
        projections::member_mutes(&pool, viewer, None, 20)
            .await
            .unwrap()
            .members
            .len(),
        1,
    );
    assert_eq!(
        sqlx::query_as::<_, (Uuid, i64)>(
            "SELECT relationship_id, version FROM profile_mute WHERE principal_id = $1 AND target_profile_id = $2",
        )
        .bind(viewer.as_uuid())
        .bind(author_profile_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        durable_mute,
    );
    fixtures
        .profile
        .adapter
        .rebuild(&pool, author_profile_id)
        .await;
    assert_lattice(&pool, fixtures, viewer, state, "public profile replay").await;

    let discussion_case =
        open_and_hide(&pool, fixtures.discussion_post, reporter, moderator, 20).await;
    state.discussion_post_visible = false;
    assert_lattice(&pool, fixtures, viewer, state, "discussion post hidden").await;
    set_topic_visibility(&pool, topic, 2, false, moderator, 22).await;
    state.discussion_surface_visible = false;
    assert_lattice(&pool, fixtures, viewer, state, "discussion surface hidden").await;
    fixtures.discussion.adapter.rebuild(&pool, topic).await;
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "discussion source rebuilt before moderation",
    )
    .await;
    rebuild_moderation_stream(&pool, discussion_case)
        .await
        .unwrap();
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "discussion moderation rebuilt after source",
    )
    .await;
    restore(&pool, discussion_case, moderator, 23).await;
    state.discussion_post_visible = true;
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "discussion post restored under hidden surface",
    )
    .await;
    rebuild_moderation_stream(&pool, discussion_case)
        .await
        .unwrap();
    fixtures.discussion.adapter.rebuild(&pool, topic).await;
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "discussion moderation rebuilt before source",
    )
    .await;
    set_topic_visibility(&pool, topic, 3, true, moderator, 24).await;
    state.discussion_surface_visible = true;
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "discussion surface restored",
    )
    .await;

    let game_case = open_and_hide(&pool, fixtures.game_post, reporter, moderator, 30).await;
    state.game_post_visible = false;
    assert_lattice(&pool, fixtures, viewer, state, "game post hidden").await;
    fixtures.game.adapter.rebuild(&pool, game_id).await;
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "game source rebuilt before moderation",
    )
    .await;
    rebuild_moderation_stream(&pool, game_case).await.unwrap();
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "game moderation rebuilt after source",
    )
    .await;
    restore(&pool, game_case, moderator, 32).await;
    state.game_post_visible = true;
    rebuild_moderation_stream(&pool, game_case).await.unwrap();
    fixtures.game.adapter.rebuild(&pool, game_id).await;
    assert_lattice(
        &pool,
        fixtures,
        viewer,
        state,
        "game moderation rebuilt before source",
    )
    .await;

    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();
    assert_lattice(&pool, fixtures, viewer, state, "final mute replay").await;

    assert!(
        !projections::unmute_public_profile(&pool, viewer, "lattice_author", 40)
            .await
            .unwrap()
            .muted
    );
    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();
    for fixture in [
        fixtures.profile,
        fixtures.discussion,
        fixtures.discussion_post,
        fixtures.game,
        fixtures.game_post,
    ] {
        let page = public_search(
            &pool,
            fixture.query,
            PublicSearchFilter::Group(fixture.document_type.group()),
            None,
            10,
            Some(viewer),
        )
        .await
        .unwrap();
        assert_eq!(
            page.results
                .iter()
                .filter(|row| row.document_key == fixture.document_key())
                .count(),
            1,
            "{} must become visible after restored-target unmute and replay",
            fixture.label,
        );
    }
}
