use super::*;

fn killed(slot_id: &str, cause: &str, death_reveal: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "PlayerKilled",
        "payload": {
            "slot_id": slot_id,
            "cause": cause,
            "attackers": ["slot_5"],
            "unstoppable": false,
            "death_reveal": death_reveal
        }
    })
}

/// The day note a resolution writes for a prior-night death. The command
/// layer copies the victim's role into it whatever that death's reveal mode
/// was, so the projection is the only gate between this key and the thread.
fn day_note(slot_id: &str, role_key: &str, sequence: u32) -> serde_json::Value {
    serde_json::json!({
        "kind": "DayAnnouncement",
        "payload": {
            "player_id": slot_id,
            "cause": "night_kill",
            "source_action_id": null,
            "attackers": ["slot_5"],
            "unstoppable": false,
            "role_key": role_key,
            "role_payload": "RoleKey",
            "recorded_at": null,
            "sequence": sequence,
            "day": 2,
            "night": 1,
            "phase_id": "D02"
        }
    })
}

fn resolution(phase_id: &str, kills: usize, events: Vec<serde_json::Value>) -> serde_json::Value {
    let count = events.len();
    let events: Vec<_> = events
        .into_iter()
        .enumerate()
        .map(|(index, mut event)| {
            event["index"] = serde_json::json!(index);
            event
        })
        .collect();
    serde_json::json!({
        "phase_id": phase_id,
        "run_id": format!("resolution:test:{phase_id}:flip_role_reveals"),
        "result_version": domain::RESULT_VERSION,
        "seed": 41,
        "counts": { "events": count, "kills": kills, "saves": 0 },
        "events": events,
        "started_at": 40,
        "finished_at": 40
    })
}

/// RFC 0009: a flip post names a role only when the projection made that
/// role public. A Janitor kill, a Flipless seat and an alignment-only flip
/// all fold with `role_revealed` unset, so their posts carry no role — not
/// as a structured reveal, and not in the body text either.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concealed_flips_carry_no_role_in_thread_posts(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let pack_artifact = test_pack_artifact("mafiascum");
    let mut setup = vec![eventstore::EventInput::new(
        "GameCreated",
        1,
        serde_json::json!({
            "host_principal_id": PrincipalId::fixture("host"),
            "pack_ref": pack_artifact.pack_ref.clone(),
            "pack_artifact": pack_artifact,
        }),
        event_actor::ActorId::Principal(PrincipalId::fixture("host")),
        1,
    )];
    for (slot_id, role_key, alignment) in [
        ("slot_1", "vanilla_townie", "town"),
        ("slot_2", "vanilla_townie", "town"),
        ("slot_3", "flipless_townie", "town"),
        ("slot_4", "vanilla_townie", "town"),
        ("slot_5", "mafia_goon", "mafia"),
    ] {
        setup.push(eventstore::EventInput::new(
            "SlotAdded",
            1,
            serde_json::json!({ "slot_id": slot_id }),
            event_actor::ActorId::Host,
            2,
        ));
        setup.push(eventstore::EventInput::new(
            "RoleAssigned",
            1,
            serde_json::json!({
                "slot_id": slot_id,
                "role_key": role_key,
                "alignment": alignment,
            }),
            event_actor::ActorId::Host,
            3,
        ));
    }
    setup.push(eventstore::EventInput::new(
        "GameStarted",
        1,
        serde_json::json!({ "phase_id": "N01" }),
        event_actor::ActorId::Host,
        4,
    ));
    setup.push(eventstore::EventInput::new(
        "ResolutionApplied",
        1,
        resolution(
            "N01",
            4,
            vec![
                killed("slot_1", "factional_kill", "Full"),
                killed("slot_2", "factional_kill", "AlignmentOnly"),
                killed("slot_3", "factional_kill", "Concealed"),
                killed("slot_4", "janitor_kill", "Concealed"),
                serde_json::json!({
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "N01",
                        "deaths": [
                            { "slot_id": "slot_1", "cause": "factional_kill" },
                            { "slot_id": "slot_2", "cause": "factional_kill" },
                            { "slot_id": "slot_3", "cause": "factional_kill" },
                            { "slot_id": "slot_4", "cause": "janitor_kill" }
                        ]
                    }
                }),
            ],
        ),
        event_actor::ActorId::System,
        5,
    ));
    setup.push(eventstore::EventInput::new(
        "ResolutionApplied",
        1,
        resolution(
            "D02",
            0,
            vec![
                day_note("slot_1", "vanilla_townie", 0),
                day_note("slot_2", "vanilla_townie", 1),
                day_note("slot_3", "flipless_townie", 2),
                day_note("slot_4", "vanilla_townie", 3),
                serde_json::json!({
                    "kind": "PhaseAnnouncement",
                    "payload": { "phase_id": "D02", "deaths": [] }
                }),
            ],
        ),
        event_actor::ActorId::System,
        6,
    ));
    projections::append_and_project(&pool, game, &setup)
        .await
        .unwrap();

    let app = router(pool).await;
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: PublicGameThreadPage = serde_json::from_slice(&bytes).unwrap();

    let flip_posts: Vec<_> = page
        .posts
        .iter()
        .filter(|post| matches!(&post.author, GameThreadAuthor::System))
        .collect();
    assert_eq!(
        flip_posts.len(),
        2,
        "each resolution publishes one system post: {:?}",
        page.posts
    );
    for post in &flip_posts {
        let revealed: Vec<_> = post
            .role_reveals
            .iter()
            .map(|reveal| (reveal.slot_id.as_str(), reveal.role_key.as_str()))
            .collect();
        assert_eq!(
            revealed,
            [("slot_1", "vanilla_townie")],
            "only the fully revealed death carries a role: {}",
            post.body
        );
        assert_eq!(
            post.role_reveals[0]
                .reference
                .as_ref()
                .map(|reference| reference.name.as_str()),
            Some("Vanilla Townie"),
            "the API attaches the pack's public role reference"
        );
    }

    let day_post = flip_posts
        .iter()
        .find(|post| post.body.contains("Day 2 announcement"))
        .expect("D02 publishes the prior-night death announcements");
    for line in day_post.body.lines() {
        if line.contains("slot_1 died") {
            assert!(
                line.contains("role: vanilla_townie"),
                "a fully revealed death names its role: {line}"
            );
        } else {
            assert!(
                !line.contains("role:"),
                "a concealed or alignment-only death names no role: {line}"
            );
        }
    }
    assert!(
        !day_post.body.contains("flipless_townie"),
        "the Flipless role never reaches the thread: {}",
        day_post.body
    );
}
