use std::path::PathBuf;

#[test]
fn embed_http_has_one_typed_owner_without_command_lock_or_csp_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let embed_http = std::fs::read_to_string(source_root.join("embed_http.rs")).unwrap();
    let command_http = std::fs::read_to_string(source_root.join("command_http.rs")).unwrap();

    assert!(composition_root.contains("mod embed_http;"));
    assert!(composition_root.contains("let embed_routes = embed_http::routes();"));
    assert!(composition_root.contains(".merge(embed_routes)"));
    assert!(embed_http.contains("async fn resolve_youtube_embed("));
    assert!(embed_http.contains(".route(\"/embeds/youtube/resolve\", post(resolve_youtube_embed))"));
    assert!(!command_http.contains("async fn resolve_youtube_embed("));
    assert!(command_http.contains("async fn prepare_command_embed("));
    assert!(
        !embed_http.contains("commands::handle") && !embed_http.contains("handle_idempotent"),
        "embed lookup must not take the game command lock"
    );
}
