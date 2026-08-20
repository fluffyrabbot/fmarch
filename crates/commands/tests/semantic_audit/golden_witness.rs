// Pack-scoped command witnesses for fresh N01/D01 goldens. Engine inner-events
// stay owned by `check:command-goldens`; this driver proves
// `Command::ResolvePhase` persisted the same envelope on one migrated pool.
// Command-admission rejects stay excluded in the manifest: those goldens cannot
// round-trip through SubmitAction/SubmitVote.

const GOLDEN_COMMAND_WITNESSES_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/semantic_audit/golden_command_witnesses.json"
));

struct GoldenCommandWitnessPack {
    pack: String,
    stems: Vec<String>,
}

fn golden_command_witness_packs() -> Vec<GoldenCommandWitnessPack> {
    let manifest: serde_json::Value = serde_json::from_str(GOLDEN_COMMAND_WITNESSES_JSON)
        .expect("golden command witness manifest parses");
    manifest["packs"]
        .as_array()
        .expect("witness manifest packs")
        .iter()
        .map(|pack| GoldenCommandWitnessPack {
            pack: pack["pack"]
                .as_str()
                .expect("witness pack name")
                .to_string(),
            stems: pack["stems"]
                .as_array()
                .expect("witness pack stems")
                .iter()
                .map(|stem| {
                    stem.as_str()
                        .expect("witness stem is a string")
                        .to_string()
                })
                .collect(),
        })
        .collect()
}

fn commands_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("commands crate lives under crates/commands")
        .to_path_buf()
}

fn pack_golden_path(pack: &str, stem: &str) -> PathBuf {
    commands_repo_root()
        .join("packs")
        .join(pack)
        .join("golden")
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

fn load_pack_golden(pack: &str, stem: &str) -> serde_json::Value {
    let path = pack_golden_path(pack, stem);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("read {pack} golden {}: {err}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|err| panic!("parse {pack} golden {}: {err}", path.display()))
}

fn occupant_id(pack: &str, stem: &str, slot: &str) -> String {
    format!("gw_{pack}_{stem}_{slot}")
}

fn vote_target(pack: &str, stem: &str, targets: &[String]) -> VoteTarget {
    match targets {
        [target] if target == "no_lynch" => VoteTarget::NoLynch,
        [target] => VoteTarget::Slot(target.clone()),
        other => panic!("golden {pack}/{stem}: day_vote needs one target, got {other:?}"),
    }
}

fn submission_grant_id(submission: &serde_json::Value) -> Option<String> {
    submission
        .get("metadata")
        .and_then(|metadata| metadata.get("grant_id"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

async fn replay_pack_golden(
    pool: &PgPool,
    pack: &str,
    stem: &str,
    golden: &serde_json::Value,
) -> Result<Uuid, String> {
    if let Some(reason) = fresh_command_witness_reason(golden) {
        return Err(format!(
            "{pack}/{stem} is not a fresh command witness: {reason}"
        ));
    }

    let input = &golden["input"];
    let phase_id = input["phase_id"]
        .as_str()
        .unwrap_or_else(|| panic!("golden {pack}/{stem} missing input.phase_id"));
    let seed = input["seed"]
        .as_u64()
        .unwrap_or_else(|| panic!("golden {pack}/{stem} missing input.seed"));
    let slots = input["state"]["slots"]
        .as_array()
        .unwrap_or_else(|| panic!("golden {pack}/{stem} missing input.state.slots"));
    let submissions = input["submissions"].as_array().cloned().unwrap_or_default();

    let game = Uuid::new_v4();
    let host_id = format!("gw_host_{pack}_{stem}");
    let host = user(&host_id);

    handle(
        pool,
        &host,
        Command::CreateGame {
            game,
            pack: pack.into(),
            cohost_denied: vec![],
        },
    )
    .await
    .map_err(|err| format!("{pack}/{stem}: CreateGame: {err}"))?;

    for slot in slots {
        let slot_id = slot["slot_id"]
            .as_str()
            .ok_or_else(|| format!("{pack}/{stem}: slot missing slot_id"))?;
        let role_key = slot["role_key"]
            .as_str()
            .ok_or_else(|| format!("{pack}/{stem}: {slot_id} missing role_key"))?;
        let occupant = occupant_id(pack, stem, slot_id);
        handle(
            pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot_id.into(),
            },
        )
        .await
        .map_err(|err| format!("{pack}/{stem}: AddSlot {slot_id}: {err}"))?;
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
        .map_err(|err| format!("{pack}/{stem}: SeatPersona {slot_id}: {err}"))?;
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
        .map_err(|err| format!("{pack}/{stem}: AssignRole {slot_id}: {err}"))?;
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
    .map_err(|err| format!("{pack}/{stem}: StartGame {phase_id}: {err}"))?;

    for submission in &submissions {
        let template_id = submission["template_id"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {pack}/{stem}: submission missing template_id"));
        let actor = submission["actor"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {pack}/{stem}: submission missing actor"));
        let action_id = submission["action_id"]
            .as_str()
            .unwrap_or_else(|| panic!("golden {pack}/{stem}: submission missing action_id"));
        let targets = submission["targets"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let occupant = user(&occupant_id(pack, stem, actor));
        let submitted = if template_id == "day_vote" {
            handle(
                pool,
                &occupant,
                Command::SubmitVote {
                    game,
                    actor_slot: actor.into(),
                    target: vote_target(pack, stem, &targets),
                },
            )
            .await
            .map(|_| ())
            .map_err(|err| format!("SubmitVote {actor}: {err}"))
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
                    grant_id: submission_grant_id(submission),
                },
            )
            .await
            .map(|_| ())
            .map_err(|err| format!("SubmitAction {actor}/{template_id}: {err}"))
        };
        if let Err(err) = submitted {
            return Err(format!(
                "{pack}/{stem}: command admission rejected a golden submission ({err})"
            ));
        }
    }

    handle(pool, &host, Command::ResolvePhase { game, seed })
        .await
        .map_err(|err| format!("{pack}/{stem}: ResolvePhase: {err}"))?;

    let applied_payload = resolution_payload(pool, game, phase_id, seed).await;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .map_err(|err| format!("{pack}/{stem}: ResolutionApplied validates: {err}"))?;
    let actual = applied
        .events
        .iter()
        .map(|event| serde_json::to_value(event).expect("indexed event serializes"))
        .collect::<Vec<_>>();
    let expected = golden["expected_events"]
        .as_array()
        .cloned()
        .ok_or_else(|| format!("{pack}/{stem} missing expected_events"))?;
    let actual = domain::normalize_golden_events(&actual);
    let expected = domain::normalize_golden_events(&expected);
    if actual != expected {
        return Err(format!(
            "{pack}/{stem}: command witness drifted from packs/{pack}/golden/{stem}.json"
        ));
    }

    let audit = audit_resolution_envelopes(pool, game)
        .await
        .map_err(|err| format!("{pack}/{stem}: audit_resolution_envelopes: {err}"))?;
    if !audit.ok {
        return Err(format!("{pack}/{stem}: resolution audit drifted: {audit:?}"));
    }
    Ok(game)
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn fresh_pack_goldens_replay_through_command_resolve(pool: PgPool) {
    let packs = golden_command_witness_packs();
    assert!(
        !packs.is_empty(),
        "golden command witness list must not be empty"
    );

    let mut last_game = None;
    let mut replayed = 0usize;
    let mut failures = Vec::new();
    for pack in &packs {
        assert!(
            !pack.stems.is_empty(),
            "golden command witness pack {} must list stems",
            pack.pack
        );
        for stem in &pack.stems {
            let golden = load_pack_golden(&pack.pack, stem);
            match replay_pack_golden(&pool, &pack.pack, stem, &golden).await {
                Ok(game) => {
                    last_game = Some(game);
                    replayed += 1;
                }
                Err(error) => failures.push(error),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "golden command witness failures:\n{}",
        failures.join("\n")
    );
    assert!(replayed > 0, "at least one golden must replay");

    let game = last_game.expect("at least one golden replayed");
    let slots_before = serde_json::to_string(&slot_state(&pool, game).await.unwrap())
        .expect("slot_state serializes");
    rebuild(&pool, game)
        .await
        .expect("pack-scoped projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve the last golden command witness"
    );
}

fn folded_minimizer_witness_cases() -> Vec<FoldedMinimizerCase> {
    vec![
        FoldedMinimizerCase {
            stem: "chinese-folded-wolf-beauty-drag-semantic-expectations".into(),
            fixture_json: chinese_folded_wolf_beauty_drag_fixture_json(),
            min_expectations: 3,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: Some(1),
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "chinese-folded-cupid-lover-suicide-semantic-expectations".into(),
            fixture_json: chinese_folded_cupid_lover_suicide_fixture_json(),
            min_expectations: 3,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: Some(1),
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "chinese-folded-hunter-retaliation-semantic-expectations".into(),
            fixture_json: chinese_folded_hunter_retaliation_fixture_json(),
            min_expectations: 3,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: Some(1),
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "chinese-folded-hunter-poison-suppression-semantic-expectations".into(),
            fixture_json: chinese_folded_hunter_poison_suppression_fixture_json(),
            min_expectations: 3,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: Some(1),
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "chinese-sheriff-badge-election-semantic-expectations".into(),
            fixture_json: chinese_sheriff_badge_election_fixture_json(),
            min_expectations: 5,
            expected_audited: 1,
            expected_traces: 1,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "chinese-sheriff-badge-pass-semantic-expectations".into(),
            fixture_json: chinese_sheriff_badge_pass_fixture_json(),
            min_expectations: 5,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "chinese-sheriff-badge-destroy-semantic-expectations".into(),
            fixture_json: chinese_sheriff_badge_destroy_fixture_json(),
            min_expectations: 5,
            expected_audited: 3,
            expected_traces: 3,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "ita-buffered-release-semantic-expectations".into(),
            fixture_json: ita_buffered_release_fixture_json(),
            min_expectations: 8,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "ita-buffered-release-invalidated-semantic-expectations".into(),
            fixture_json: ita_buffered_release_invalidated_fixture_json(),
            min_expectations: 10,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "ita-buffered-release-refunded-semantic-expectations".into(),
            fixture_json: ita_buffered_release_refunded_fixture_json(),
            min_expectations: 7,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "ita-buffered-release-hp-hybrid-semantic-expectations".into(),
            fixture_json: ita_buffered_release_hp_hybrid_fixture_json(),
            min_expectations: 11,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "ita-lifecycle-controls-semantic-expectations".into(),
            fixture_json: ita_lifecycle_controls_fixture_json(),
            min_expectations: 6,
            expected_audited: 1,
            expected_traces: 1,
            expected_setup_phases: None,
            require_projection_audit: true,
        },
        FoldedMinimizerCase {
            stem: "mafia-universe-day-notes-semantic-expectations".into(),
            fixture_json: mafia_universe_day_notes_fixture_json(),
            min_expectations: 7,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "mafiascum-no-majority-revote-resolution-semantic-expectations".into(),
            fixture_json: mafiascum_no_majority_revote_prompt_fixture_json(),
            min_expectations: 6,
            expected_audited: 1,
            expected_traces: 1,
            expected_setup_phases: None,
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "mafiascum-beloved-princess-skip-next-day-semantic-expectations".into(),
            fixture_json: mafiascum_beloved_princess_skip_next_day_fixture_json(),
            min_expectations: 7,
            expected_audited: 1,
            expected_traces: 1,
            expected_setup_phases: None,
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "mafiascum-virgin-night-skip-next-day-semantic-expectations".into(),
            fixture_json: mafiascum_virgin_night_skip_next_day_fixture_json(),
            min_expectations: 6,
            expected_audited: 1,
            expected_traces: 1,
            expected_setup_phases: None,
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "dynamic-vote-no-majority-revote-semantic-expectations".into(),
            fixture_json: dynamic_vote_no_majority_revote_prompt_fixture_json(),
            min_expectations: 6,
            expected_audited: 2,
            expected_traces: 2,
            expected_setup_phases: None,
            require_projection_audit: false,
        },
        FoldedMinimizerCase {
            stem: "dynamic-vote-pk-resolution-semantic-expectations".into(),
            fixture_json: dynamic_vote_pk_prompt_fixture_json(),
            min_expectations: 7,
            expected_audited: 3,
            expected_traces: 3,
            expected_setup_phases: None,
            require_projection_audit: false,
        },
    ]
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn folded_semantic_fixtures_shrink_on_isolated_workers(
    pool_options: sqlx::postgres::PgPoolOptions,
    connect_options: sqlx::postgres::PgConnectOptions,
) {
    let cases = folded_minimizer_witness_cases();
    assert_eq!(
        cases.len(),
        FOLDED_MINIMIZER_WITNESS_CASES,
        "folded minimizer witness case manifest"
    );
    let mut principals = BTreeSet::new();
    for case in &cases {
        principals.extend(
            minimizer_fixture_principals(&case.fixture_json)
                .expect("folded minimizer principals derive from valid fixtures"),
        );
    }
    let fixture_pool = pool_options
        .max_connections(1)
        .connect_with(connect_options.clone())
        .await
        .expect("connect folded minimizer identity fixture pool");
    ensure_test_principals(&fixture_pool, principals.iter().map(String::as_str)).await;
    fixture_pool.close().await;

    let reports = run_folded_minimizer_cases(connect_options, cases);
    assert_eq!(
        reports.len(),
        FOLDED_MINIMIZER_WITNESS_CASES,
        "folded minimizer workers must drain every case"
    );
}
