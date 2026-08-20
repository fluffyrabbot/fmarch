// Pack-scoped command witness for mafiascum goldens that previously each
// bought an isolated `sqlx::test` database. Engine inner-events stay owned by
// `check:command-goldens`; this driver proves `Command::ResolvePhase` persisted
// the same envelope on one migrated pool.

const MAFIASCUM_COMMAND_WITNESSES_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/semantic_audit/mafiascum_command_witnesses.json"
));

struct MafiascumCommandWitnessManifest {
    pack: String,
    stems: Vec<String>,
}

fn mafiascum_command_witness_manifest() -> MafiascumCommandWitnessManifest {
    let manifest: serde_json::Value = serde_json::from_str(MAFIASCUM_COMMAND_WITNESSES_JSON)
        .expect("mafiascum command witness manifest parses");
    let pack = manifest["pack"]
        .as_str()
        .expect("witness manifest pack")
        .to_string();
    let stems = manifest["stems"]
        .as_array()
        .expect("witness manifest stems")
        .iter()
        .map(|stem| {
            stem.as_str()
                .expect("witness stem is a string")
                .to_string()
        })
        .collect();
    MafiascumCommandWitnessManifest { pack, stems }
}

fn commands_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("commands crate lives under crates/commands")
        .to_path_buf()
}

fn mafiascum_golden_path(stem: &str) -> PathBuf {
    commands_repo_root()
        .join("packs/mafiascum/golden")
        .join(format!("{stem}.json"))
}

fn fresh_command_witness_reason(golden: &serde_json::Value) -> Option<String> {
    if golden
        .get("pack_overrides")
        .is_some_and(|value| !value.is_null())
    {
        return Some("pack_overrides".into());
    }
    let input = &golden["input"];
    let state = &input["state"];
    let phase = input["phase_id"]
        .as_str()
        .or_else(|| state["phase_id"].as_str())
        .unwrap_or("");
    if phase != "N01" && phase != "D01" {
        return Some(format!("phase={phase}"));
    }
    let slots = match state["slots"].as_array() {
        Some(slots) => slots,
        None => return Some("missing-slots".into()),
    };
    if slots
        .iter()
        .any(|slot| slot["status"].as_str() != Some("alive"))
    {
        return Some("dead".into());
    }
    if slots.iter().any(|slot| {
        slot["effects"]
            .as_array()
            .is_some_and(|effects| !effects.is_empty())
    }) {
        return Some("slot-effects".into());
    }
    for key in [
        "effect_records",
        "action_history",
        "action_grants",
        "delayed_deaths",
        "investigation_memory",
        "visit_history",
        "use_counters",
        "private_channels",
    ] {
        if state
            .get(key)
            .and_then(serde_json::Value::as_array)
            .is_some_and(|values| !values.is_empty())
        {
            return Some(key.into());
        }
    }
    let submissions = match input["submissions"].as_array() {
        Some(submissions) => submissions,
        None => return Some("missing-submissions".into()),
    };
    if submissions
        .iter()
        .any(|submission| submission["withdrawn"].as_bool() == Some(true))
    {
        return Some("withdrawn".into());
    }
    None
}

fn load_mafiascum_golden(stem: &str) -> serde_json::Value {
    let path = mafiascum_golden_path(stem);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("read mafiascum golden {}: {err}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|err| panic!("parse mafiascum golden {}: {err}", path.display()))
}

fn occupant_id(stem: &str, slot: &str) -> String {
    format!("gw_{stem}_{slot}")
}

fn vote_target(stem: &str, targets: &[String]) -> VoteTarget {
    match targets {
        [target] if target == "no_lynch" => VoteTarget::NoLynch,
        [target] => VoteTarget::Slot(target.clone()),
        other => panic!("golden {stem}: day_vote needs one target, got {other:?}"),
    }
}

async fn replay_mafiascum_golden(pool: &PgPool, stem: &str, golden: &serde_json::Value) -> Uuid {
    if let Some(reason) = fresh_command_witness_reason(golden) {
        panic!("mafiascum golden {stem} is not a fresh command witness: {reason}");
    }

    let input = &golden["input"];
    let phase_id = input["phase_id"]
        .as_str()
        .unwrap_or_else(|| panic!("golden {stem} missing input.phase_id"));
    let seed = input["seed"]
        .as_u64()
        .unwrap_or_else(|| panic!("golden {stem} missing input.seed"));
    let slots = input["state"]["slots"]
        .as_array()
        .unwrap_or_else(|| panic!("golden {stem} missing input.state.slots"));
    let submissions = input["submissions"].as_array().cloned().unwrap_or_default();

    let game = Uuid::new_v4();
    let host_id = format!("gw_host_{stem}");
    let host = user(&host_id);

    handle(
        pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap_or_else(|err| panic!("golden {stem}: CreateGame: {err}"));

    for slot in slots {
        let slot_id = slot["slot_id"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {stem}: slot missing slot_id"));
        let role_key = slot["role_key"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {stem}: {slot_id} missing role_key"));
        let occupant = occupant_id(stem, slot_id);
        handle(
            pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot_id.into(),
            },
        )
        .await
        .unwrap_or_else(|err| panic!("golden {stem}: AddSlot {slot_id}: {err}"));
        handle(
            pool,
            &host,
            commands::seat_persona! {
                game,
                slot: slot_id.to_string(),
                user: occupant,
            },
        )
        .await
        .unwrap_or_else(|err| panic!("golden {stem}: SeatPersona {slot_id}: {err}"));
        handle(
            pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot_id.into(),
                role_key: role_key.into(),
            },
        )
        .await
        .unwrap_or_else(|err| panic!("golden {stem}: AssignRole {slot_id}: {err}"));
    }

    handle(
        pool,
        &host,
        Command::StartGame {
            game,
            phase: phase_id.into(),
        },
    )
    .await
    .unwrap_or_else(|err| panic!("golden {stem}: StartGame {phase_id}: {err}"));

    for submission in &submissions {
        let template_id = submission["template_id"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {stem}: submission missing template_id"));
        let actor = submission["actor"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {stem}: submission missing actor"));
        let action_id = submission["action_id"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {stem}: submission missing action_id"));
        let targets = submission["targets"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let occupant = user(&occupant_id(stem, actor));
        if template_id == "day_vote" {
            handle(
                pool,
                &occupant,
                Command::SubmitVote {
                    game,
                    actor_slot: actor.into(),
                    target: vote_target(stem, &targets),
                },
            )
            .await
            .unwrap_or_else(|err| panic!("golden {stem}: SubmitVote {actor}: {err}"));
        } else {
            handle(
                pool,
                &occupant,
                Command::SubmitAction {
                    game,
                    action_id: action_id.into(),
                    actor_slot: actor.into(),
                    template_id: template_id.into(),
                    targets,
                    grant_id: None,
                },
            )
            .await
            .unwrap_or_else(|err| {
                panic!("golden {stem}: SubmitAction {actor}/{template_id}: {err}")
            });
        }
    }

    handle(
        pool,
        &host,
        Command::ResolvePhase { game, seed },
    )
    .await
    .unwrap_or_else(|err| panic!("golden {stem}: ResolvePhase: {err}"));

    let applied_payload = resolution_payload(pool, game, phase_id, seed).await;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .unwrap_or_else(|err| panic!("golden {stem}: ResolutionApplied validates: {err}"));
    let actual = applied
        .events
        .iter()
        .map(|event| serde_json::to_value(event).expect("indexed event serializes"))
        .collect::<Vec<_>>();
    let expected = golden["expected_events"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| panic!("golden {stem} missing expected_events"));
    assert_eq!(
        domain::normalize_golden_events(&actual),
        domain::normalize_golden_events(&expected),
        "command witness drifted from packs/mafiascum/golden/{stem}.json"
    );

    let audit = audit_resolution_envelopes(pool, game)
        .await
        .unwrap_or_else(|err| panic!("golden {stem}: audit_resolution_envelopes: {err}"));
    assert!(
        audit.ok,
        "golden {stem}: resolution audit drifted: {audit:?}"
    );
    game
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn mafiascum_fresh_goldens_replay_through_command_resolve(pool: PgPool) {
    let manifest = mafiascum_command_witness_manifest();
    assert_eq!(manifest.pack, "mafiascum");
    assert!(
        !manifest.stems.is_empty(),
        "mafiascum command witness list must not be empty"
    );

    let mut last_game = None;
    for stem in &manifest.stems {
        let golden = load_mafiascum_golden(stem);
        last_game = Some(replay_mafiascum_golden(&pool, stem, &golden).await);
    }

    let game = last_game.expect("at least one mafiascum golden replayed");
    let slots_before = serde_json::to_string(&slot_state(&pool, game).await.unwrap())
        .expect("slot_state serializes");
    rebuild(&pool, game)
        .await
        .expect("pack-scoped projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve the last mafiascum command witness"
    );
}
