use std::path::PathBuf;

#[test]
fn live_projection_publication_has_one_typed_owner_without_local_lint_debt() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let publication = std::fs::read_to_string(source_root.join("live_projection.rs")).unwrap();

    assert!(composition_root.contains("mod live_projection;"));
    assert!(publication.contains("struct LiveProjectionChangeSet"));
    assert!(publication.contains("struct LiveProjectionPublisher"));
    assert!(publication.contains("struct LiveProjectionUpdate"));
    assert!(publication.contains("enum LiveProjectionReceive"));
    assert!(publication.contains("fn assemble_update"));
    assert!(publication.contains("pub(super) async fn receive"));

    assert!(!composition_root.contains("struct LiveProjectionUpdate"));
    assert!(!composition_root.contains("fn publish_live_projection_change"));
    assert!(!composition_root.contains("fn receive_live_projection"));
    assert!(!composition_root.contains("fn current_votecount_rows"));
    assert!(!composition_root.contains("projection flags remain explicit"));
    assert!(
        !publication.contains("#[expect") && !publication.contains("#[allow(clippy"),
        "the live-publication boundary must not hide architectural lint debt"
    );
}
