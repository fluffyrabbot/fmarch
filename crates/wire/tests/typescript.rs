#[test]
fn generated_typescript_contract_is_current() {
    let expected = include_str!("../generated/types.ts");
    let actual = wire::typescript::render();
    assert_eq!(
        actual, expected,
        "wire TypeScript contract drifted; run `cargo run -p wire --bin export_types > crates/wire/generated/types.ts`"
    );
}

#[test]
fn submit_post_media_rejects_client_authored_variant_fields() {
    let command = serde_json::json!({
        "SubmitPost": {
            "game": uuid::Uuid::nil(),
            "channel_id": "role-pm",
            "actor_slot": "slot_1",
            "body": "private image",
            "media": [{
                "content_id": "a".repeat(64),
                "alt": "Private receipt",
                "variants": {
                    "tablet": {
                        "avif_url": "/client-authored/tablet.avif"
                    }
                }
            }]
        }
    });

    let error = serde_json::from_value::<wire::Command>(command).unwrap_err();
    assert!(error.to_string().contains("unknown field `variants`"));
}
