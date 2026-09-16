use std::path::PathBuf;

#[test]
fn public_platform_http_has_one_typed_owner_without_transport_or_persistence_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let public_platform_http =
        std::fs::read_to_string(source_root.join("public_platform_http.rs")).unwrap();
    let game_http = std::fs::read_to_string(source_root.join("game_http.rs")).unwrap();
    let command_http = std::fs::read_to_string(source_root.join("command_http.rs")).unwrap();

    assert!(composition_root.contains("mod public_platform_http;"));
    assert!(composition_root
        .contains("let public_platform_routes = public_platform_http::routes(&state);"));
    assert!(composition_root.contains(".merge(public_platform_routes)"));
    assert!(public_platform_http.contains("struct PublicPlatformHttpState"));
    assert!(public_platform_http.contains("fn routes(state: &ApiState) -> Router<ApiState>"));
    assert!(public_platform_http.contains(".with_state(PublicPlatformHttpState::new("));

    for owned_symbol in [
        "struct PublicSearchQuery",
        "async fn public_search(",
        "async fn public_inbox(",
        "async fn member_mutes(",
        "async fn subscription_target_state(",
        "async fn discussion_areas(",
        "async fn discussion_post_citations(",
        "async fn submit_moderation_report(",
        "async fn moderation_cases(",
        "async fn public_profile(",
        "async fn create_profile(",
    ] {
        assert!(
            public_platform_http.contains(owned_symbol),
            "missing public-platform HTTP owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns public-platform HTTP symbol: {owned_symbol}"
        );
    }

    assert!(game_http.contains("async fn public_game_thread("));
    assert!(!public_platform_http.contains("async fn public_game_thread("));

    let live_delivery = std::fs::read_to_string(source_root.join("live_delivery.rs")).unwrap();
    assert!(command_http.contains("async fn command("));
    assert!(!composition_root.contains("async fn command("));
    assert!(!public_platform_http.contains("async fn command("));
    for live_owned in ["async fn create_websocket_ticket(", "async fn ws_session("] {
        assert!(live_delivery.contains(live_owned));
        assert!(!composition_root.contains(live_owned));
        assert!(
            !public_platform_http.contains(live_owned),
            "live transport drifted into public-platform HTTP: {live_owned}"
        );
    }
    assert!(!public_platform_http.contains("async fn create_auth_session("));

    let search_telemetry = public_platform_http
        .split("event = \"public_search_completed\"")
        .nth(1)
        .and_then(|source| source.split(");").next())
        .expect("public search must emit its bounded completion event");
    for field in [
        "filter = filter_label",
        "page = page_kind",
        "limit",
        "result_count",
        "has_next_page",
        "traffic_class",
        "selectivity_signal_basis_points",
        "elapsed_ms",
    ] {
        assert!(
            search_telemetry.contains(field),
            "public search telemetry omitted {field}"
        );
    }
    for forbidden in [
        "normalized_query",
        "query_hash",
        "viewer_principal_id",
        "headers",
    ] {
        assert!(
            !search_telemetry.contains(forbidden),
            "public search telemetry exposed {forbidden}"
        );
    }

    assert!(
        !public_platform_http.contains("sqlx::query")
            && !public_platform_http.contains("use super::*")
            && !public_platform_http.contains("#[expect")
            && !public_platform_http.contains("#[allow(clippy"),
        "the public-platform HTTP boundary must not own persistence or hide ownership/lint debt"
    );
}

/// Editability is a per-thread-source policy. The forum owns post edit and
/// retraction; game channels have no counterpart because their posts are
/// slot-authored evidence in a live game. This test makes that absence a
/// contract rather than an omission: the game command boundary rejects every
/// edit-shaped input at deserialization, the command enums carry no such
/// variant, and the only edit routes are keyed by a discussion topic whose
/// write state is loaded from `discussion_topic`, so a game `PostRef` cannot
/// reach `forum::decide_topic`.
#[test]
fn game_threads_have_no_edit_or_retract_path() {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let wire_source = std::fs::read_to_string(repo_root.join("wire/src/lib.rs")).unwrap();
    let commands_source =
        std::fs::read_to_string(repo_root.join("commands/src/model.rs")).unwrap();
    let public_platform_http = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/public_platform_http.rs"),
    )
    .unwrap();
    let game_http =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/game_http.rs"))
            .unwrap();
    let command_http = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/command_http.rs"),
    )
    .unwrap();

    // Runtime proof: every edit-shaped command is refused at the wire and
    // pipeline boundaries before any authority check could run.
    let game = uuid::Uuid::new_v4();
    for variant in ["EditPost", "RetractPost", "PostEdited", "PostRetracted", "DeletePost"] {
        let payload = serde_json::json!({
            variant: {
                "game": game,
                "channel_id": "main",
                "actor_slot": "slot_1",
                "source_seq": 7,
                "body": "rewritten",
                "expected_revision": 0
            }
        });
        let wire_error = serde_json::from_value::<wire::Command>(payload.clone())
            .expect_err("wire Command must not admit a game post edit");
        assert!(
            wire_error.to_string().contains("unknown variant"),
            "wire rejected {variant} for the wrong reason: {wire_error}"
        );
        let commands_error = serde_json::from_value::<commands::Command>(payload)
            .expect_err("commands Command must not admit a game post edit");
        assert!(
            commands_error.to_string().contains("unknown variant"),
            "commands rejected {variant} for the wrong reason: {commands_error}"
        );
    }

    // Declaration proof: the enums themselves carry no edit or retract variant.
    for (name, source) in [("wire", &wire_source), ("commands", &commands_source)] {
        let command_enum = source
            .split("pub enum Command {")
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap_or_else(|| panic!("{name} must declare pub enum Command"));
        for forbidden in ["EditPost", "RetractPost", "DeletePost", "Edit {", "Retract {"] {
            assert!(
                !command_enum.contains(forbidden),
                "{name}::Command grew a game post edit path: {forbidden}"
            );
        }
        assert!(
            command_enum.contains("SubmitPost {"),
            "{name}::Command still submits game posts"
        );
    }

    // Route proof: the only edit and retract handlers live on the discussion
    // topic route, load the topic through discussion_topic_by_id, and are
    // decided by the forum write model. Game HTTP owns none of them.
    assert!(public_platform_http.contains(
        "\"/discussions/topics/{topic}/posts/{source_seq}\",\n            axum::routing::put(edit_discussion_post).delete(retract_discussion_post),"
    ));
    for handler in ["async fn edit_discussion_post(", "async fn retract_discussion_post("] {
        let body = public_platform_http
            .split(handler)
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap_or_else(|| panic!("public platform HTTP must own {handler}"));
        assert!(body.contains("DiscussionProfileAuthentication(profile)"));
        assert!(body.contains("projections::discussion_topic_by_id(&state.pool, topic)"));
        assert!(body.contains("projections::discussion_post_write_state(&state.pool, topic, source_seq)"));
        assert!(body.contains("forum::decide_topic("));
        assert!(!body.contains("game"), "{handler} must not reach for game state");
    }
    for source in [&game_http, &command_http] {
        for forbidden in [
            "decide_topic",
            "EditPost",
            "RetractPost",
            "edit_discussion_post",
            "retract_discussion_post",
        ] {
            assert!(
                !source.contains(forbidden),
                "game or command HTTP acquired a post edit path: {forbidden}"
            );
        }
    }
}
