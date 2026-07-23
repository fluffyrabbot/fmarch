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
            "channel_id": "private:role_pm:slot-7",
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

#[test]
fn apply_effect_plan_deserializes_the_canonical_concrete_catalog() {
    let command = serde_json::json!({
        "ApplyEffectPlan": {
            "game": uuid::Uuid::nil(),
            "effects": [{
                "kind": "mark",
                "target": "slot_1",
                "effect": "bomb"
            }],
            "reason": "manual adjudication"
        }
    });

    let parsed = serde_json::from_value::<wire::Command>(command).unwrap();
    assert!(matches!(
        parsed,
        wire::Command::ApplyEffectPlan { effects, reason, .. }
            if effects.len() == 1 && reason == "manual adjudication"
    ));
}
