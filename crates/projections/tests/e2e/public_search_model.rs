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
    Rebuild,
}

impl MutationKind {
    const ALL: [Self; 5] = [
        Self::DiscussionPost,
        Self::TopicVisibility,
        Self::ProfileUpdate,
        Self::GamePost,
        Self::Rebuild,
    ];

    const fn label(self) -> &'static str {
        match self {
            Self::DiscussionPost => "discussion-post",
            Self::TopicVisibility => "topic-visibility",
            Self::ProfileUpdate => "profile-update",
            Self::GamePost => "game-post",
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
}

impl SearchOracle {
    fn upsert_surface(
        &mut self,
        kind: projections::PublicSearchDocumentType,
        surface_id: Uuid,
        updated_seq: i64,
        visible: bool,
    ) {
        self.surface_visibility.insert(surface_id, visible);
        self.upsert(ModelDocument {
            kind,
            surface_id,
            source_seq: 0,
            updated_seq,
            rank_class: 2,
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
    ) {
        self.upsert(ModelDocument {
            kind,
            surface_id,
            source_seq,
            updated_seq: source_seq,
            rank_class: 1,
        });
    }

    fn upsert(&mut self, document: ModelDocument) {
        let identity = document.identity();
        let previous = self.documents.insert(identity.clone(), document);
        assert!(previous.is_none(), "duplicate modeled document {identity}");
    }

    fn expected(&self, filter: PublicSearchFilter) -> Vec<String> {
        let mut documents = self
            .documents
            .values()
            .filter(|document| {
                self.surface_visibility
                    .get(&document.surface_id)
                    .copied()
                    .unwrap_or(false)
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
    principal: String,
    version: i64,
    visible: bool,
    next_post: usize,
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
    topics: Vec<TopicFixture>,
    profiles: Vec<ProfileFixture>,
    games: Vec<GameFixture>,
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
    label: &str,
    filter: PublicSearchFilter,
    limit: i64,
    context: &str,
) {
    let expected = oracle.expected(filter);
    let mut actual = Vec::new();
    let mut cursor = None;
    let mut page_count = 0usize;
    loop {
        page_count += 1;
        assert!(
            page_count <= expected.len() + 2,
            "seed {SEED:#x} {context} {label}: cursor traversal did not terminate"
        );
        let page = public_search(pool, QUERY, filter, cursor, limit, None)
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
    seen: BTreeSet<String>,
    cursor: Option<projections::PublicSearchCursor>,
}

async fn capture_stale_cursor(
    pool: &PgPool,
    label: &'static str,
    filter: PublicSearchFilter,
) -> StaleCursorProbe {
    let page = public_search(pool, QUERY, filter, None, 3, None)
        .await
        .unwrap();
    StaleCursorProbe {
        label,
        filter,
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
        let page = public_search(pool, QUERY, probe.filter, Some(cursor), 3, None)
            .await
            .unwrap();
        for row in &page.results {
            let identity = result_identity(row);
            assert!(
                probe.seen.insert(identity.clone()),
                "seed {SEED:#x} {context} {}: stale cursor repeated {identity}",
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
        );
        profiles.push(ProfileFixture {
            id: profile_id,
            principal,
            revision: 1,
            public: true,
            update_count: 0,
        });
    }

    let mut topics = Vec::new();
    for (index, profile) in profiles.iter().enumerate() {
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
                        "author_profile_id": profile.id
                    }),
                    ActorId::Principal(fixture_principal_id(&profile.principal)),
                    20 + index as i64 * 2,
                ),
                EventInput::new(
                    "DiscussionPostSubmitted",
                    1,
                    serde_json::json!({
                        "body": format!("{QUERY} discussion initial {index}"),
                        "author_profile_id": profile.id
                    }),
                    ActorId::Principal(fixture_principal_id(&profile.principal)),
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
        );
        oracle.add_post(
            projections::PublicSearchDocumentType::DiscussionPost,
            id,
            post_seq,
        );
        topics.push(TopicFixture {
            id,
            author_profile_id: profile.id,
            principal: profile.principal.clone(),
            version: 2,
            visible: true,
            next_post: 1,
        });
    }

    ensure_test_principal(pool, "model_search_host").await;
    let mut games = Vec::new();
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
        );
        oracle.add_post(
            projections::PublicSearchDocumentType::GamePost,
            id,
            post_seq,
        );
        games.push(GameFixture { id, next_post: 1 });
    }
    ModelFixtureState {
        oracle,
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
                    ActorId::Principal(fixture_principal_id(&topic.principal)),
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
            );
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

    for (label, filter) in filters {
        assert_fresh_traversal(&pool, &fixture.oracle, label, filter, 3, "initial state").await;
    }

    let mut step = 0usize;
    for round in 0..ROUNDS {
        let mut mutations = MutationKind::ALL;
        rng.shuffle(&mut mutations);
        for mutation in mutations {
            let probe_index = rng.index(filters.len());
            let (probe_label, probe_filter) = filters[probe_index];
            let stale = capture_stale_cursor(&pool, probe_label, probe_filter).await;
            apply_mutation(&pool, &mut fixture, mutation, round, step).await;
            let context = format!("step {step} {}", mutation.label());
            assert_stale_cursor_remains_duplicate_free(&pool, stale, &context).await;
            let page_limit = 1 + rng.index(4) as i64;
            for (label, filter) in filters {
                assert_fresh_traversal(&pool, &fixture.oracle, label, filter, page_limit, &context)
                    .await;
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
    for limit in [1, 2, 3, 5] {
        for (label, filter) in filters {
            assert_fresh_traversal(
                &pool,
                &fixture.oracle,
                label,
                filter,
                limit,
                "final page-size matrix",
            )
            .await;
            let first = public_search(&pool, QUERY, filter, None, limit, None)
                .await
                .unwrap();
            let repeated = public_search(&pool, QUERY, filter, None, limit, None)
                .await
                .unwrap();
            assert_eq!(
                first, repeated,
                "seed {SEED:#x} final {label}/{limit}: unchanged state was not byte-stable"
            );
        }
    }
}
