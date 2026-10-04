use command_transport::{CommandDispatch, CommandDispatchExt};
use serde_json::json;
use uuid::Uuid;
use wire::Command;
fn game(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
#[test]
fn submit_post_mentions_are_optional_and_survive_to_the_write_model() {
    let expected_game = game(13);
    let without: Command = serde_json::from_value(json!({
        "SubmitPost": {
            "game": expected_game,
            "channel_id": "main",
            "actor_slot": "slot_1",
            "body": "nobody in particular"
        }
    }))
    .unwrap();
    match without.into_dispatch() {
        CommandDispatch::Direct(commands::Command::SubmitPost { mentions, .. }) => {
            assert!(mentions.is_empty());
        }
        other => panic!("unexpected dispatch: {other:?}"),
    }

    let with: Command = serde_json::from_value(json!({
        "SubmitPost": {
            "game": expected_game,
            "channel_id": "scumchat",
            "actor_slot": "slot_1",
            "body": "@slot_3 you have been quiet",
            "mentions": [{ "slot_id": "slot_3", "offset": 0, "len": 6 }]
        }
    }))
    .unwrap();
    match with.into_dispatch() {
        CommandDispatch::Direct(commands::Command::SubmitPost { mentions, .. }) => {
            assert_eq!(
                mentions,
                vec![content_reference::SlotMentionCandidate {
                    slot_id: "slot_3".to_string(),
                    offset: 0,
                    len: 6,
                }]
            );
        }
        other => panic!("unexpected dispatch: {other:?}"),
    }

    assert!(serde_json::from_value::<Command>(json!({
        "SubmitPost": {
            "game": expected_game,
            "channel_id": "main",
            "actor_slot": "slot_1",
            "body": "@slot_3 you have been quiet",
            "mentions": [{ "slot_id": "slot_3", "offset": 0, "len": 0 }]
        }
    }))
    .is_err());
}
