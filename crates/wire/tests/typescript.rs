#[test]
fn generated_typescript_contract_is_current() {
    let expected = include_str!("../generated/types.ts");
    let actual = wire::typescript::render();
    assert_eq!(
        actual, expected,
        "wire TypeScript contract drifted; run `cargo run -p wire --bin export_types -- --write`"
    );
}

#[test]
fn create_game_cohost_policy_is_omittable_in_both_wire_directions_and_typescript() {
    let game = uuid::Uuid::nil();
    let parsed = serde_json::from_value::<wire::Command>(serde_json::json!({
        "CreateGame": {
            "game": game,
            "pack": "mafiascum"
        }
    }))
    .unwrap();
    assert!(matches!(
        parsed,
        wire::Command::CreateGame {
            cohost_denied,
            ..
        } if cohost_denied.is_empty()
    ));

    let serialized = serde_json::to_value(wire::Command::CreateGame {
        game,
        pack: "mafiascum".to_owned(),
        cohost_denied: Vec::new(),
    })
    .unwrap();
    assert!(serialized["CreateGame"].get("cohost_denied").is_none());

    assert!(wire::typescript::render().contains(
        "CreateGame\": { game: string, pack: string, cohost_denied?: Array<CohostPermissionClass>"
    ));
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
            "effects": [
                {
                    "kind": "mark",
                    "target": "slot_1",
                    "effect": "bomb"
                },
                {
                    "kind": "grant",
                    "target": "slot_1",
                    "grant": {
                        "grant_id": "vote_power_boost",
                        "kind": "vote_weight",
                        "uses": 1,
                        "vote_weight": 2.0,
                        "visibility": "target"
                    }
                }
            ],
            "reason": "manual adjudication"
        }
    });

    let parsed = serde_json::from_value::<wire::Command>(command).unwrap();
    let serialized = serde_json::to_value(&parsed).unwrap();
    assert_eq!(
        serialized["ApplyEffectPlan"]["effects"][1]["grant"]["kind"],
        "vote_weight"
    );
    assert!(matches!(
        parsed,
        wire::Command::ApplyEffectPlan { effects, reason, .. }
            if effects.len() == 2
                && reason == "manual adjudication"
                && matches!(
                    &effects[1],
                    game_platform::ConcreteEffect::Grant { grant, .. }
                        if grant.kind == game_platform::GrantKind::VoteWeight
                            && grant.vote_weight == Some(2.0)
                )
    ));
}

#[test]
fn attach_day_program_carries_only_a_content_addressed_reference() {
    let game = "00000000-0000-0000-0000-000000000123";
    let command = serde_json::json!({
        "AttachDayProgram": {
            "game": game,
            "program_ref": {
                "id": "raffle",
                "version": 1,
                "content_hash": "43ae91d9858580a74f00dfa91848821d4ce60a93a68ab8dbd972818a06d24800"
            }
        }
    });
    let parsed = serde_json::from_value::<wire::Command>(command).unwrap();
    assert!(matches!(
        parsed.into_dispatch(),
        wire::CommandDispatch::AttachDayProgram { program_ref, .. }
            if program_ref.id.as_str() == "raffle"
                && program_ref.version == 1
                && program_ref.content_hash.as_str()
                    == "43ae91d9858580a74f00dfa91848821d4ce60a93a68ab8dbd972818a06d24800"
    ));

    let inline = serde_json::json!({
        "AttachDayProgram": {
            "game": game,
            "program": {
                "id": "browser-authored",
                "version": 1,
                "display_name": "Browser authored",
                "theme_ref": null,
                "events": []
            }
        }
    });
    assert!(serde_json::from_value::<wire::Command>(inline).is_err());
}
