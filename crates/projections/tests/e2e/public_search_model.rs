use std::collections::{BTreeMap, BTreeSet};

use super::*;

const QUERY: &str = "modelsearchtoken";
const SEED: u64 = 0x5ea2_c4d5_91b7_0f3d;
const ROUNDS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MutationKind {
    DiscussionPost,
    TopicVisibility,
    ProfileUpdate,
    GamePost,
    MuteToggle,
    ModerationToggle,
    Rebuild,
}

impl MutationKind {
    const ALL: [Self; 7] = [
        Self::DiscussionPost,
        Self::TopicVisibility,
        Self::ProfileUpdate,
        Self::GamePost,
        Self::MuteToggle,
        Self::ModerationToggle,
        Self::Rebuild,
    ];

    const fn label(self) -> &'static str {
        match self {
            Self::DiscussionPost => "discussion-post",
            Self::TopicVisibility => "topic-visibility",
            Self::ProfileUpdate => "profile-update",
            Self::GamePost => "game-post",
            Self::MuteToggle => "mute-toggle",
            Self::ModerationToggle => "moderation-toggle",
            Self::Rebuild => "rebuild",
        }
    }
}

struct DeterministicRng(u64);

impl DeterministicRng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    fn index(&mut self, upper: usize) -> usize {
        assert!(upper > 0);
        (self.next() % upper as u64) as usize
    }

    fn shuffle<T>(&mut self, values: &mut [T]) {
        for end in (1..values.len()).rev() {
            let index = self.index(end + 1);
            values.swap(index, end);
        }
    }
}

#[derive(Clone)]
struct ModelDocument {
    kind: projections::PublicSearchDocumentType,
    surface_id: Uuid,
    source_seq: i64,
    updated_seq: i64,
    rank_class: u8,
    author_profile_id: Option<Uuid>,
    visible: bool,
}

impl ModelDocument {
    fn document_key(&self) -> String {
        format!("{}-{}", self.surface_id, self.source_seq)
    }

    fn identity(&self) -> String {
        format!("{}:{}", self.kind.as_str(), self.document_key())
    }
}

#[derive(Default)]
struct SearchOracle {
    documents: BTreeMap<String, ModelDocument>,
    surface_visibility: BTreeMap<Uuid, bool>,
    viewer_mutes: BTreeMap<Uuid, BTreeSet<Uuid>>,
}

impl SearchOracle {
    fn upsert_surface(
        &mut self,
        kind: projections::PublicSearchDocumentType,
        surface_id: Uuid,
        updated_seq: i64,
        visible: bool,
        author_profile_id: Option<Uuid>,
    ) {
        self.surface_visibility.insert(surface_id, visible);
        self.upsert(ModelDocument {
            kind,
            surface_id,
            source_seq: 0,
            updated_seq,
            rank_class: 2,
            author_profile_id,
            visible: true,
        });
    }

    fn touch_surface(&mut self, surface_id: Uuid, updated_seq: i64) {
        let document = self
            .documents
            .values_mut()
            .find(|document| document.surface_id == surface_id && document.source_seq == 0)
            .unwrap_or_else(|| panic!("missing modeled surface {surface_id}"));
        document.updated_seq = updated_seq;
    }

    fn set_surface_visibility(&mut self, surface_id: Uuid, visible: bool) {
        let previous = self.surface_visibility.insert(surface_id, visible);
        assert!(
            previous.is_some(),
            "missing modeled visibility for {surface_id}"
        );
    }

    fn add_post(
        &mut self,
        kind: projections::PublicSearchDocumentType,
        surface_id: Uuid,
        source_seq: i64,
        author_profile_id: Option<Uuid>,
    ) {
        self.upsert(ModelDocument {
            kind,
            surface_id,
            source_seq,
            updated_seq: source_seq,
            rank_class: 1,
            author_profile_id,
            visible: true,
        });
    }

    fn set_document_visibility(&mut self, surface_id: Uuid, source_seq: i64, visible: bool) {
        let document = self
            .documents
            .values_mut()
            .find(|document| document.surface_id == surface_id && document.source_seq == source_seq)
            .unwrap_or_else(|| panic!("missing modeled document {surface_id}:{source_seq}"));
        document.visible = visible;
    }

    fn set_mute(&mut self, viewer: PrincipalId, author_profile_id: Uuid, active: bool) {
        let muted = self.viewer_mutes.entry(viewer.as_uuid()).or_default();
        if active {
            assert!(
                muted.insert(author_profile_id),
                "modeled mute was already active"
            );
        } else {
            assert!(
                muted.remove(&author_profile_id),
                "modeled mute was not active"
            );
        }
    }

    fn upsert(&mut self, document: ModelDocument) {
        let identity = document.identity();
        let previous = self.documents.insert(identity.clone(), document);
        assert!(previous.is_none(), "duplicate modeled document {identity}");
    }

    fn expected(&self, filter: PublicSearchFilter, viewer: Option<PrincipalId>) -> Vec<String> {
        let muted = viewer.and_then(|principal| self.viewer_mutes.get(&principal.as_uuid()));
        let mut documents = self
            .documents
            .values()
            .filter(|document| {
                self.surface_visibility
                    .get(&document.surface_id)
                    .copied()
                    .unwrap_or(false)
                    && document.visible
                    && document.author_profile_id.is_none_or(|author| {
                        !muted.is_some_and(|profiles| profiles.contains(&author))
                    })
                    && match filter {
                        PublicSearchFilter::All => true,
                        PublicSearchFilter::Group(group) => document.kind.group() == group,
                    }
            })
            .collect::<Vec<_>>();
        documents.sort_by(|left, right| {
            right
                .rank_class
                .cmp(&left.rank_class)
                .then_with(|| right.updated_seq.cmp(&left.updated_seq))
                .then_with(|| left.kind.as_str().cmp(right.kind.as_str()))
                .then_with(|| left.document_key().cmp(&right.document_key()))
        });
        documents.into_iter().map(ModelDocument::identity).collect()
    }
}

struct TopicFixture {
    id: Uuid,
    author_profile_id: Uuid,
    principal: PrincipalId,
    version: i64,
    visible: bool,
    next_post: usize,
}

struct AuthorFixture {
    id: Uuid,
    principal: PrincipalId,
    handle: String,
}

#[derive(Clone, Copy)]
struct ViewerFixture {
    label: &'static str,
    principal: PrincipalId,
}

struct MuteFixture {
    viewer_index: usize,
    author_index: usize,
    active: bool,
    relationship_id: Option<Uuid>,
}

struct ModeratedPostFixture {
    surface_id: Uuid,
    source_seq: i64,
    case_id: Option<Uuid>,
    hidden: bool,
}

struct ProfileFixture {
    id: Uuid,
    principal: String,
    revision: u64,
    public: bool,
    update_count: usize,
}

struct GameFixture {
    id: Uuid,
    next_post: usize,
}

struct ModelFixtureState {
    oracle: SearchOracle,
    authors: Vec<AuthorFixture>,
    viewers: [ViewerFixture; 2],
    mutes: Vec<MuteFixture>,
    moderated_posts: Vec<ModeratedPostFixture>,
    reporter: PrincipalId,
    moderator: PrincipalId,
    topics: Vec<TopicFixture>,
    profiles: Vec<ProfileFixture>,
    games: Vec<GameFixture>,
}

#[derive(Clone, Copy)]
struct ViewerCase {
    label: &'static str,
    principal: Option<PrincipalId>,
}

fn viewer_cases(fixture: &ModelFixtureState) -> [ViewerCase; 3] {
    [
        ViewerCase {
            label: "anonymous",
            principal: None,
        },
        ViewerCase {
            label: fixture.viewers[0].label,
            principal: Some(fixture.viewers[0].principal),
        },
        ViewerCase {
            label: fixture.viewers[1].label,
            principal: Some(fixture.viewers[1].principal),
        },
    ]
}

fn result_identity(row: &projections::PublicSearchRow) -> String {
    format!("{}:{}", row.kind.as_str(), row.document_key)
}

fn filter_cases() -> [(&'static str, PublicSearchFilter); 4] {
    [
        ("all", PublicSearchFilter::All),
        (
            "discussions",
            PublicSearchFilter::Group(projections::PublicSearchGroup::Discussions),
        ),
        (
            "profiles",
            PublicSearchFilter::Group(projections::PublicSearchGroup::Profiles),
        ),
        (
            "games",
            PublicSearchFilter::Group(projections::PublicSearchGroup::Games),
        ),
    ]
}

async fn assert_fresh_traversal(
    pool: &PgPool,
    oracle: &SearchOracle,
    viewer: ViewerCase,
    label: &str,
    filter: PublicSearchFilter,
    limit: i64,
    context: &str,
) {
    let expected = oracle.expected(filter, viewer.principal);
    let label = format!("{}/{label}", viewer.label);
    let mut actual = Vec::new();
    let mut cursor = None;
    let mut page_count = 0usize;
    loop {
        page_count += 1;
        assert!(
            page_count <= expected.len() + 2,
            "seed {SEED:#x} {context} {label}: cursor traversal did not terminate"
        );
        let page = public_search(pool, QUERY, filter, cursor, limit, viewer.principal)
            .await
            .unwrap();
        assert!(
            page.results.len() <= limit as usize,
            "seed {SEED:#x} {context} {label}: page exceeded limit {limit}"
        );
        for row in &page.results {
            actual.push(result_identity(row));
        }
        match page.next_cursor {
            Some(next) => {
                assert_eq!(
                    page.results.len(),
                    limit as usize,
                    "seed {SEED:#x} {context} {label}: partial page exposed a cursor"
                );
                let last = page.results.last().expect("cursor page has a final row");
                assert_eq!(next.rank, last.rank);
                assert_eq!(next.updated_seq, last.updated_seq);
                assert_eq!(next.document_type, last.kind);
                assert_eq!(next.document_key, last.document_key);
                cursor = Some(next);
            }
            None => break,
        }
    }
    assert_eq!(
        actual, expected,
        "seed {SEED:#x} {context} {label}: public search diverged from the event-side oracle"
    );
}

struct StaleCursorProbe {
    label: &'static str,
    filter: PublicSearchFilter,
    viewer: ViewerCase,
    seen: BTreeSet<String>,
    cursor: Option<projections::PublicSearchCursor>,
}

async fn capture_stale_cursor(
    pool: &PgPool,
    viewer: ViewerCase,
    label: &'static str,
    filter: PublicSearchFilter,
) -> StaleCursorProbe {
    let page = public_search(pool, QUERY, filter, None, 3, viewer.principal)
        .await
        .unwrap();
    StaleCursorProbe {
        label,
        filter,
        viewer,
        seen: page.results.iter().map(result_identity).collect(),
        cursor: page.next_cursor,
    }
}

async fn assert_stale_cursor_remains_duplicate_free(
    pool: &PgPool,
    mut probe: StaleCursorProbe,
    context: &str,
) {
    let mut page_count = 0usize;
    while let Some(cursor) = probe.cursor {
        page_count += 1;
        assert!(
            page_count <= 64,
            "seed {SEED:#x} {context} {}: stale cursor did not terminate",
            probe.label
        );
        let page = public_search(
            pool,
            QUERY,
            probe.filter,
            Some(cursor),
            3,
            probe.viewer.principal,
        )
        .await
        .unwrap();
        for row in &page.results {
            let identity = result_identity(row);
            assert!(
                probe.seen.insert(identity.clone()),
                "seed {SEED:#x} {context} {}/{}: stale cursor repeated {identity}",
                probe.viewer.label,
                probe.label
            );
        }
        probe.cursor = page.next_cursor;
    }
}

async fn latest_event_seq(pool: &PgPool, stream_id: Uuid) -> i64 {
    eventstore::load_stream(pool, stream_id)
        .await
        .unwrap()
        .last()
        .unwrap_or_else(|| panic!("stream {stream_id} has no events"))
        .seq
}

async fn install_fixture(pool: &PgPool) -> ModelFixtureState {
    let mut oracle = SearchOracle::default();
    let area = Uuid::from_u128(0x4d4f_4445_4c53_4541_5243_4800_0001);
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({
                "slug": "model-search",
                "title": "Model search",
                "description": "Deterministic stateful search proof"
            }),
            ActorId::Principal(fixture_principal_id("model_search_moderator")),
            1,
        )],
    )
    .await
    .unwrap();

    let mut profiles = Vec::new();
    for index in 0..3 {
        let principal = format!("model_search_profile_{index}");
        ensure_test_principal(pool, &principal).await;
        let profile_id = create_test_profile(
            pool,
            &principal,
            &format!("model_profile_{index}"),
            &format!("{QUERY} Profile {index}"),
            &format!("Stateful profile fixture {index}"),
            ProfileVisibility::Public,
            10 + index as i64,
        )
        .await;
        let seq = latest_event_seq(pool, profile_id).await;
        oracle.upsert_surface(
            projections::PublicSearchDocumentType::Profile,
            profile_id,
            seq,
            true,
            Some(profile_id),
        );
        profiles.push(ProfileFixture {
            id: profile_id,
            principal,
            revision: 1,
            public: true,
            update_count: 0,
        });
    }

    let mut authors = Vec::new();
    for index in 0..3 {
        let principal = auxiliary_principal(0x4d4f_4445_4c53_0000 + index as u128);
        ensure_auxiliary_principal(pool, principal).await;
        let handle = format!("model_author_{index}");
        let id = create_auxiliary_profile(
            pool,
            principal,
            &handle,
            &format!("{QUERY} Author {index}"),
            &format!("Stable public author fixture {index}"),
            ProfileVisibility::Public,
            16 + index as i64,
        )
        .await;
        let seq = latest_event_seq(pool, id).await;
        oracle.upsert_surface(
            projections::PublicSearchDocumentType::Profile,
            id,
            seq,
            true,
            Some(id),
        );
        authors.push(AuthorFixture {
            id,
            principal,
            handle,
        });
    }

    let viewers = [
        ViewerFixture {
            label: "viewer-a",
            principal: auxiliary_principal(0x4d4f_4445_4c53_0100),
        },
        ViewerFixture {
            label: "viewer-b",
            principal: auxiliary_principal(0x4d4f_4445_4c53_0101),
        },
    ];
    for (index, viewer) in viewers.iter().enumerate() {
        ensure_auxiliary_principal(pool, viewer.principal).await;
        create_auxiliary_profile(
            pool,
            viewer.principal,
            &format!("model_viewer_{index}"),
            &format!("Model Viewer {index}"),
            "Personalized search fixture",
            ProfileVisibility::Public,
            19 + index as i64,
        )
        .await;
    }

    let mut topics = Vec::new();
    for (index, author) in authors.iter().enumerate() {
        let id = Uuid::from_u128(0x4d4f_4445_4c53_4541_5243_4810_0000 + index as u128);
        let stored = append_discussion_and_project(
            pool,
            id,
            &[
                EventInput::new(
                    "DiscussionTopicCreated",
                    1,
                    serde_json::json!({
                        "area_id": area,
                        "title": format!("{QUERY} Topic {index}"),
                        "author_profile_id": author.id
                    }),
                    ActorId::Principal(author.principal),
                    20 + index as i64 * 2,
                ),
                EventInput::new(
                    "DiscussionPostSubmitted",
                    1,
                    serde_json::json!({
                        "body": format!("{QUERY} discussion initial {index}"),
                        "author_profile_id": author.id
                    }),
                    ActorId::Principal(author.principal),
                    21 + index as i64 * 2,
                ),
            ],
        )
        .await
        .unwrap();
        let post_seq = stored[1].seq;
        oracle.upsert_surface(
            projections::PublicSearchDocumentType::Discussion,
            id,
            post_seq,
            true,
            Some(author.id),
        );
        oracle.add_post(
            projections::PublicSearchDocumentType::DiscussionPost,
            id,
            post_seq,
            Some(author.id),
        );
        topics.push(TopicFixture {
            id,
            author_profile_id: author.id,
            principal: author.principal,
            version: 2,
            visible: true,
            next_post: 1,
        });
    }

    ensure_test_principal(pool, "model_search_host").await;
    let mut games = Vec::new();
    let mut moderated_posts = Vec::new();
    for index in 0..3 {
        let id = Uuid::from_u128(0x4d4f_4445_4c53_4541_5243_4820_0000 + index as u128);
        let stored = append_and_project(
            pool,
            id,
            &[
                EventInput::new(
                    "GameCreated",
                    1,
                    test_game_created_payload("model_search_host", QUERY),
                    ActorId::Principal(fixture_principal_id("model_search_host")),
                    40 + index as i64 * 3,
                ),
                EventInput::new(
                    "GameStarted",
                    1,
                    serde_json::json!({ "phase_id": "D01" }),
                    ActorId::Host,
                    41 + index as i64 * 3,
                ),
                EventInput::new(
                    "PostSubmitted",
                    1,
                    serde_json::json!({
                        "channel_id": "main",
                        "author": { "kind": "slot", "slot_id": "slot_1" },
                        "body": format!("{QUERY} game initial {index}"),
                        "phase_id": "D01"
                    }),
                    ActorId::Slot("slot_1".into()),
                    42 + index as i64 * 3,
                ),
            ],
        )
        .await
        .unwrap();
        let post_seq = stored[2].seq;
        oracle.upsert_surface(
            projections::PublicSearchDocumentType::Game,
            id,
            post_seq,
            true,
            None,
        );
        oracle.add_post(
            projections::PublicSearchDocumentType::GamePost,
            id,
            post_seq,
            None,
        );
        games.push(GameFixture { id, next_post: 1 });
        moderated_posts.push(ModeratedPostFixture {
            surface_id: id,
            source_seq: post_seq,
            case_id: None,
            hidden: false,
        });
    }
    let reporter = auxiliary_principal(0x4d4f_4445_4c53_0200);
    let moderator = auxiliary_principal(0x4d4f_4445_4c53_0201);
    ensure_auxiliary_principal(pool, reporter).await;
    ensure_auxiliary_principal(pool, moderator).await;
    ModelFixtureState {
        oracle,
        authors,
        viewers,
        mutes: vec![
            MuteFixture {
                viewer_index: 0,
                author_index: 0,
                active: false,
                relationship_id: None,
            },
            MuteFixture {
                viewer_index: 1,
                author_index: 1,
                active: false,
                relationship_id: None,
            },
            MuteFixture {
                viewer_index: 0,
                author_index: 2,
                active: false,
                relationship_id: None,
            },
        ],
        moderated_posts,
        reporter,
        moderator,
        topics,
        profiles,
        games,
    }
}

async fn apply_mutation(
    pool: &PgPool,
    fixture: &mut ModelFixtureState,
    kind: MutationKind,
    round: usize,
    step: usize,
) {
    let ModelFixtureState {
        oracle,
        authors,
        viewers,
        mutes,
        moderated_posts,
        reporter,
        moderator,
        topics,
        profiles,
        games,
    } = fixture;
    let target_index = round % topics.len();
    match kind {
        MutationKind::DiscussionPost => {
            let topic = &mut topics[target_index];
            let stored = append_discussion_and_project_expected(
                pool,
                topic.id,
                topic.version,
                &[EventInput::new(
                    "DiscussionPostSubmitted",
                    1,
                    serde_json::json!({
                        "body": format!("{QUERY} discussion mutation {}", topic.next_post),
                        "author_profile_id": topic.author_profile_id
                    }),
                    ActorId::Principal(topic.principal),
                    100 + step as i64,
                )],
            )
            .await
            .unwrap();
            let seq = stored[0].seq;
            topic.version += 1;
            topic.next_post += 1;
            oracle.touch_surface(topic.id, seq);
            oracle.add_post(
                projections::PublicSearchDocumentType::DiscussionPost,
                topic.id,
                seq,
                Some(topic.author_profile_id),
            );
        }
        MutationKind::TopicVisibility => {
            let topic = &mut topics[target_index];
            topic.visible = !topic.visible;
            let visibility = if topic.visible { "visible" } else { "hidden" };
            let stored = append_discussion_and_project_expected(
                pool,
                topic.id,
                topic.version,
                &[EventInput::new(
                    "DiscussionTopicVisibilityChanged",
                    1,
                    serde_json::json!({ "visibility": visibility }),
                    ActorId::Principal(fixture_principal_id("model_search_moderator")),
                    100 + step as i64,
                )],
            )
            .await
            .unwrap();
            topic.version += 1;
            oracle.touch_surface(topic.id, stored[0].seq);
            oracle.set_surface_visibility(topic.id, topic.visible);
        }
        MutationKind::ProfileUpdate => {
            let profile = &mut profiles[target_index];
            profile.public = !profile.public;
            profile.update_count += 1;
            update_test_profile(
                pool,
                TestProfileUpdate {
                    profile_id: profile.id,
                    principal: &profile.principal,
                    expected_revision: profile.revision,
                    edit: test_profile_edit(
                        &format!("{QUERY} Profile update {}", profile.update_count),
                        &format!("Stateful profile mutation {}", profile.update_count),
                        if profile.public {
                            ProfileVisibility::Public
                        } else {
                            ProfileVisibility::Private
                        },
                    ),
                    occurred_at: 100 + step as i64,
                },
            )
            .await;
            profile.revision += 1;
            let seq = latest_event_seq(pool, profile.id).await;
            oracle.touch_surface(profile.id, seq);
            oracle.set_surface_visibility(profile.id, profile.public);
        }
        MutationKind::GamePost => {
            let game = &mut games[target_index];
            let stored = append_and_project(
                pool,
                game.id,
                &[EventInput::new(
                    "PostSubmitted",
                    1,
                    serde_json::json!({
                        "channel_id": "main",
                        "author": { "kind": "slot", "slot_id": "slot_1" },
                        "body": format!("{QUERY} game mutation {}", game.next_post),
                        "phase_id": "D01"
                    }),
                    ActorId::Slot("slot_1".into()),
                    100 + step as i64,
                )],
            )
            .await
            .unwrap();
            let seq = stored[0].seq;
            game.next_post += 1;
            oracle.touch_surface(game.id, seq);
            oracle.add_post(
                projections::PublicSearchDocumentType::GamePost,
                game.id,
                seq,
                None,
            );
        }
        MutationKind::MuteToggle => {
            let mute = &mut mutes[target_index];
            let viewer = viewers[mute.viewer_index];
            let author = &authors[mute.author_index];
            if mute.active {
                let state = projections::unmute_public_profile(
                    pool,
                    viewer.principal,
                    &author.handle,
                    100 + step as i64,
                )
                .await
                .unwrap();
                assert!(!state.muted);
                oracle.set_mute(viewer.principal, author.id, false);
            } else {
                let state = projections::mute_public_profile(
                    pool,
                    viewer.principal,
                    &author.handle,
                    100 + step as i64,
                )
                .await
                .unwrap();
                assert!(state.muted);
                let relationship_id: Uuid = sqlx::query_scalar(
                    "SELECT relationship_id FROM profile_mute WHERE principal_id = $1 AND target_profile_id = $2",
                )
                .bind(viewer.principal.as_uuid())
                .bind(author.id)
                .fetch_one(pool)
                .await
                .unwrap();
                match mute.relationship_id {
                    Some(existing) => assert_eq!(existing, relationship_id),
                    None => mute.relationship_id = Some(relationship_id),
                }
                oracle.set_mute(viewer.principal, author.id, true);
            }
            mute.active = !mute.active;
            projections::rebuild_member_mute_stream(
                pool,
                mute.relationship_id.expect("mute relationship exists"),
            )
            .await
            .unwrap();
        }
        MutationKind::ModerationToggle => {
            let target = &mut moderated_posts[target_index];
            if target.hidden {
                let case_id = target.case_id.expect("moderation case exists");
                let state = projections::moderation_case_state(pool, case_id)
                    .await
                    .unwrap()
                    .unwrap();
                let events = trust_safety::decide_moderation(
                    Some(&state),
                    ModerationCommand::Restore {
                        reason: "stateful model restore".into(),
                    },
                )
                .unwrap();
                projections::append_moderation_and_project_expected(
                    pool,
                    case_id,
                    state.version,
                    events,
                    *moderator,
                    100 + step as i64,
                )
                .await
                .unwrap();
                target.hidden = false;
                oracle.set_document_visibility(target.surface_id, target.source_seq, true);
            } else {
                projections::submit_moderation_report(
                    pool,
                    ModerationTarget {
                        public: PublicContentRef::new(target.surface_id, target.source_seq),
                    },
                    Uuid::new_v4(),
                    *reporter,
                    ReportReasonFamily::Spam,
                    "stateful model report".into(),
                    100 + step as i64,
                )
                .await
                .unwrap();
                let case_id: Uuid = sqlx::query_scalar(
                    "SELECT case_id FROM moderation_case WHERE surface_id = $1 AND source_seq = $2",
                )
                .bind(target.surface_id)
                .bind(target.source_seq)
                .fetch_one(pool)
                .await
                .unwrap();
                target.case_id = Some(case_id);
                let state = projections::moderation_case_state(pool, case_id)
                    .await
                    .unwrap()
                    .unwrap();
                let events = trust_safety::decide_moderation(
                    Some(&state),
                    ModerationCommand::Hide {
                        reason: "stateful model hide".into(),
                    },
                )
                .unwrap();
                projections::append_moderation_and_project_expected(
                    pool,
                    case_id,
                    state.version,
                    events,
                    *moderator,
                    100 + step as i64,
                )
                .await
                .unwrap();
                target.hidden = true;
                oracle.set_document_visibility(target.surface_id, target.source_seq, false);
            }
            projections::rebuild_moderation_stream(
                pool,
                target.case_id.expect("moderation case exists"),
            )
            .await
            .unwrap();
        }
        MutationKind::Rebuild => match round % 3 {
            0 => rebuild_discussion_stream(pool, topics[(round / 3) % topics.len()].id)
                .await
                .unwrap(),
            1 => rebuild_profile_stream(pool, profiles[(round / 3 + 1) % profiles.len()].id)
                .await
                .unwrap(),
            _ => rebuild(pool, games[(round / 3 + 2) % games.len()].id)
                .await
                .unwrap(),
        },
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn public_search_matches_a_stateful_oracle_across_mutations(pool: PgPool) {
    let mut fixture = install_fixture(&pool).await;
    let mut rng = DeterministicRng::new(SEED);
    let filters = filter_cases();
    let mut operation_counts = BTreeMap::new();

    for viewer in viewer_cases(&fixture) {
        for (label, filter) in filters {
            assert_fresh_traversal(
                &pool,
                &fixture.oracle,
                viewer,
                label,
                filter,
                3,
                "initial state",
            )
            .await;
        }
    }

    let mut step = 0usize;
    for round in 0..ROUNDS {
        let mut mutations = MutationKind::ALL;
        rng.shuffle(&mut mutations);
        for mutation in mutations {
            let probe_index = rng.index(filters.len());
            let viewers = viewer_cases(&fixture);
            let probe_viewer = viewers[rng.index(viewers.len())];
            let (probe_label, probe_filter) = filters[probe_index];
            let stale = capture_stale_cursor(&pool, probe_viewer, probe_label, probe_filter).await;
            apply_mutation(&pool, &mut fixture, mutation, round, step).await;
            let context = format!("step {step} {}", mutation.label());
            assert_stale_cursor_remains_duplicate_free(&pool, stale, &context).await;
            let page_limit = 1 + rng.index(4) as i64;
            for viewer in viewer_cases(&fixture) {
                for (label, filter) in filters {
                    assert_fresh_traversal(
                        &pool,
                        &fixture.oracle,
                        viewer,
                        label,
                        filter,
                        page_limit,
                        &context,
                    )
                    .await;
                }
            }
            *operation_counts.entry(mutation.label()).or_insert(0usize) += 1;
            step += 1;
        }
    }

    for mutation in MutationKind::ALL {
        assert_eq!(
            operation_counts.get(mutation.label()),
            Some(&ROUNDS),
            "seed {SEED:#x}: mutation coverage drifted for {}",
            mutation.label()
        );
    }
    assert!(
        fixture
            .topics
            .iter()
            .all(|topic| topic.version == 6 && topic.visible && topic.next_post == 3),
        "seed {SEED:#x}: every topic must receive two posts and two visibility transitions"
    );
    assert!(
        fixture
            .profiles
            .iter()
            .all(|profile| profile.revision == 3 && profile.public && profile.update_count == 2),
        "seed {SEED:#x}: every profile must cross private and return public"
    );
    assert!(
        fixture.games.iter().all(|game| game.next_post == 3),
        "seed {SEED:#x}: every game must receive two additional posts"
    );
    assert!(
        fixture
            .mutes
            .iter()
            .all(|mute| !mute.active && mute.relationship_id.is_some()),
        "seed {SEED:#x}: every mute must activate, replay, deactivate, and replay"
    );
    assert!(
        fixture
            .moderated_posts
            .iter()
            .all(|target| !target.hidden && target.case_id.is_some()),
        "seed {SEED:#x}: every target must hide, replay, restore, and replay"
    );
    for limit in [1, 2, 3, 5] {
        for viewer in viewer_cases(&fixture) {
            for (label, filter) in filters {
                assert_fresh_traversal(
                    &pool,
                    &fixture.oracle,
                    viewer,
                    label,
                    filter,
                    limit,
                    "final page-size matrix",
                )
                .await;
                let first = public_search(&pool, QUERY, filter, None, limit, viewer.principal)
                    .await
                    .unwrap();
                let repeated = public_search(&pool, QUERY, filter, None, limit, viewer.principal)
                    .await
                    .unwrap();
                assert_eq!(
                    first, repeated,
                    "seed {SEED:#x} final {}/{label}/{limit}: unchanged state was not byte-stable",
                    viewer.label
                );
            }
        }
    }
}
