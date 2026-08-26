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
