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
                .map(|stem| stem.as_str().expect("witness stem is a string").to_string())
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
            phase: domain::phase::PhaseId::parse(phase_id)
                .expect("golden witness phase id is canonical"),
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
        return Err(format!(
            "{pack}/{stem}: resolution audit drifted: {audit:?}"
        ));
    }
    Ok(game)
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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

const LEFTOVER_HOST_RESOLVE_PHASE_CASES: usize = 140;
const LEFTOVER_HOST_RESOLVE_SHARDS: usize = 4;
const LEFTOVER_HOST_RESOLVE_SERIAL_BASELINE_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/semantic_audit/serial_case_baseline.json"
));

type LeftoverCaseFuture = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'static>>;
type LeftoverCaseRunner = fn(PgPool) -> LeftoverCaseFuture;

struct LeftoverCaseSpec {
    id: &'static str,
    baseline_milliseconds: u128,
    run: LeftoverCaseRunner,
}

macro_rules! leftover_host_resolve_specs {
    ($baseline:ident, $($case:ident),+ $(,)?) => {{
        vec![$(
            LeftoverCaseSpec {
                id: stringify!($case),
                baseline_milliseconds: *$baseline
                    .get(stringify!($case))
                    .unwrap_or_else(|| panic!("missing serial baseline for {}", stringify!($case))),
                run: (|pool| -> LeftoverCaseFuture { Box::pin($case(pool)) })
                    as LeftoverCaseRunner,
            },
        )+]
    }};
}

fn leftover_host_resolve_case_specs() -> Vec<LeftoverCaseSpec> {
    let baseline_json: serde_json::Value =
        serde_json::from_str(LEFTOVER_HOST_RESOLVE_SERIAL_BASELINE_JSON)
            .expect("serial case baseline parses");
    let baseline = baseline_json["cases"]
        .as_array()
        .expect("serial case baseline cases")
        .iter()
        .map(|case| {
            (
                case["id"].as_str().expect("serial baseline case id"),
                case["milliseconds"]
                    .as_u64()
                    .expect("serial baseline duration") as u128,
            )
        })
        .collect::<BTreeMap<_, _>>();
    leftover_host_resolve_specs!(
        baseline,
        host_resolve_phase_reveals_town_alignment_without_role,
        host_resolve_phase_carries_mafia_universe_reveal_town,
        host_resolve_phase_carries_mafia_universe_alignment_oracle_reveal,
        host_resolve_phase_carries_mafia_universe_role_oracle_reveal,
        host_resolve_phase_carries_mafia_universe_backup_inheritance,
        host_resolve_phase_projects_hero_instigator_kill_on_vote_duel,
        host_resolve_phase_carries_twilight_self_destruct_window,
        host_resolve_phase_carries_mafiascum_white_wolf_king_dual_window,
        host_resolve_phase_conceals_janitor_and_flipless_death_reveals,
        host_resolve_phase_projects_alignment_only_death_reveal,
        host_resolve_phase_carries_default_open_guardian_seer,
        host_resolve_phase_carries_default_open_day_majority,
        host_resolve_phase_carries_super_saint_lynch_trigger,
        host_resolve_phase_projects_beloved_princess_host_prompt,
        host_resolve_phase_projects_virgin_night_death_skip_prompt,
        host_resolve_phase_uses_pack_declared_role_tiebreaker,
        host_resolve_phase_uses_dynamic_effect_vote_weight,
        host_resolve_phase_uses_vote_weight_action_grant,
        host_resolve_phase_uses_dynamic_vote_weight_for_no_majority_prompt,
        host_resolve_phase_uses_loved_hated_threshold_adjustments,
        host_resolve_phase_projects_epicmafia_pk_tie_prompt,
        host_resolve_phase_uses_dynamic_vote_weight_for_pk_tie_prompt,
        host_resolve_phase_carries_sheriff_badge_lifecycle,
        host_resolve_phase_carries_knight_duel_death,
        host_resolve_phase_carries_knight_duel_failure_before_vote,
        host_resolve_phase_consumes_white_wolf_carry_on_next_wolf_kill,
        host_resolve_phase_consumes_passive_white_wolf_carry_on_next_wolf_kill,
        host_resolve_phase_carries_chinese_wolf_faction_vote_policy,
        host_resolve_phase_carries_wolf_beauty_mark_and_drag,
        host_resolve_phase_carries_witch_poison_beauty_drag,
        host_resolve_phase_stacks_wolf_beauty_drag_with_direct_death,
        host_resolve_phase_carries_guard_witch_poison_policy,
        host_resolve_phase_carries_guard_witch_double_save_policy,
        host_resolve_phase_carries_guard_witch_killtarget_policy,
        host_resolve_phase_carries_ita_session_lethal_shot,
        host_resolve_phase_invalidates_later_ita_shot_at_dead_target,
        host_resolve_phase_refunds_ita_shot_at_already_dead_target,
        host_resolve_phase_buffers_ita_shot_without_same_pass_resolution,
        host_resolve_phase_releases_buffered_ita_shot_on_later_pass,
        host_resolve_phase_invalidates_buffered_ita_shot_on_later_release,
        host_resolve_phase_refunds_buffered_ita_shot_when_target_dies_before_release,
        host_resolve_phase_applies_ita_lifecycle_pause_control,
        host_resolve_phase_releases_buffered_ita_hp_and_hybrid_protection,
        host_resolve_phase_carries_ita_chance_overrides_and_shields,
        host_resolve_phase_carries_mafia_universe_basic_nar,
        host_resolve_phase_carries_mafia_universe_joat_block_counter,
        host_resolve_phase_carries_mafiascum_joat_block_counter,
        host_resolve_phase_carries_mafiascum_two_shot_counter,
        host_resolve_phase_carries_mafia_universe_night_desperado_kills,
        host_resolve_phase_carries_mafia_universe_day_vigilante_kills,
        host_resolve_phase_carries_mafia_universe_day_desperado_failback,
        host_resolve_phase_carries_mafia_universe_cpr_harm,
        host_resolve_phase_carries_mafia_universe_framer_investigation,
        host_resolve_phase_carries_mafia_universe_town_framer_investigation,
        host_resolve_phase_carries_mafiascum_role_scan,
        host_resolve_phase_carries_mafiascum_coroner_corpse_inspection,
        host_resolve_phase_carries_mafiascum_pt_cop_access,
        host_resolve_phase_carries_mafia_universe_role_set_info,
        host_resolve_phase_carries_mafia_universe_role_and_full_role_info,
        host_resolve_phase_carries_mafia_universe_culture_aliases,
        host_resolve_phase_carries_mafia_universe_parity_scan_memory,
        host_resolve_phase_carries_mafia_universe_graph_info,
        host_resolve_phase_carries_mafia_universe_voyeur_action_info,
        host_resolve_phase_carries_mafia_universe_ninja_hidden_visit_results,
        host_resolve_phase_carries_mafia_universe_redirect_graph,
        host_resolve_phase_carries_mafia_universe_commute,
        host_resolve_phase_carries_mafia_universe_poison_cure_and_delayed_death,
        host_resolve_phase_carries_mafia_universe_healer_alias_cure,
        host_resolve_phase_carries_mafia_universe_douse_extinguish_and_ignite,
        host_resolve_phase_carries_mafia_universe_town_firefighter_preempt_alias,
        host_resolve_phase_carries_mafia_universe_motivator_grants_and_spends,
        host_resolve_phase_carries_mafia_universe_fruit_vendor_notifications,
        host_resolve_phase_carries_mafia_universe_inventor_item_grants_and_spends,
        host_resolve_phase_carries_mafia_universe_empower_bypass,
        host_resolve_phase_carries_day_announcements_and_last_words,
        host_resolve_phase_uses_pack_declared_night_parity,
        host_resolve_phase_uses_pack_declared_cycle_parity,
        host_resolve_phase_applies_godfather_investigation_override,
        host_resolve_phase_projects_mafiascum_info_results,
        host_resolve_phase_carries_mafiascum_fruit_vendor_notification,
        host_resolve_phase_preserves_prior_investigation_memory,
        host_resolve_phase_records_visit_history_for_prior_motion,
        host_resolve_phase_carries_action_history_for_non_consecutive,
        host_resolve_phase_projects_conversion_and_persistent_effects,
        host_resolve_phase_blocks_conversion_of_pending_death_target,
        host_resolve_phase_filters_hidden_effect_notifications,
        host_resolve_phase_persists_loyal_conversion_block_trace,
        host_resolve_phase_persists_disloyal_modifier_trace_and_projection,
        host_resolve_phase_carries_poison_cure_and_delayed_death,
        host_resolve_phase_traces_pending_poison_target_already_dead,
        host_resolve_phase_persists_cleanse_read_effect_trace_decision,
        host_resolve_phase_deprograms_from_conversion_origin,
        host_resolve_phase_vanillaize_then_restore_mutation,
        host_resolve_phase_backup_cop_inherits_on_death,
        host_resolve_phase_targeted_backup_inherits_chosen_source,
        host_resolve_phase_carries_condemner_target_lynch_win,
        host_resolve_phase_carries_executioner_target_lynch_win,
        host_resolve_phase_self_lynch_win_suppresses_target_lynch_and_faction_wins,
        host_resolve_phase_projects_pgo_visit_trigger,
        host_resolve_phase_projects_target_filtered_visitor_kill,
        host_resolve_phase_projects_epicmafia_bomb_trigger,
        host_resolve_phase_protects_generated_pgo_trigger_kill,
        host_resolve_phase_generated_pgo_kill_obeys_transient_target_state,
        host_resolve_phase_bodyguard_intercepts_generated_pgo_trigger_kill,
        host_resolve_phase_persists_cpr_harm_policy,
        host_resolve_phase_bypasses_protection_for_strongman_trigger_kill,
        host_resolve_phase_projects_death_trigger_kill,
        host_resolve_phase_projects_effect_marked_trigger_kill,
        host_resolve_phase_projects_phase_end_trigger_kill,
        host_resolve_phase_projects_win_trigger_before_final_win,
        host_resolve_phase_protects_ordinary_vengeful_trigger_kill,
        host_resolve_phase_bypasses_bodyguard_for_strongman_trigger_kill,
        host_resolve_phase_persists_redirect_trace_edge,
        host_resolve_phase_persists_mass_redirect_rotate_trace_edges,
        host_resolve_phase_persists_suppression_and_conflict_trace_decisions,
        host_resolve_phase_strong_willed_bypasses_roleblock,
        host_resolve_phase_non_roleblockable_block_survives_roleblock,
        host_resolve_phase_persists_catastrophic_roleblock_multi_action_trace,
        host_resolve_phase_persists_combined_trace_audit_branches,
        host_resolve_phase_persists_redirect_loop_cap_trace_note,
        host_resolve_phase_persists_trigger_loop_cap_trace_note,
        host_resolve_phase_persists_target_state_trace_decisions,
        host_resolve_phase_preserves_ninja_hidden_visit_results,
        host_resolve_phase_projects_tracker_private_visit_result,
        host_resolve_phase_projects_babysitter_dependency_death,
        host_resolve_phase_projects_hider_host_death,
        host_resolve_phase_carries_lover_link_and_suicide,
        host_resolve_phase_stacks_lover_suicide_with_direct_death,
        host_resolve_phase_carries_mafia_universe_lover_setup_cascade,
        host_resolve_phase_projects_mafia_universe_bomber_triggers,
        host_resolve_phase_projects_mafiascum_bomb_trigger,
        host_resolve_phase_carries_hunter_retaliation,
        host_resolve_phase_carries_chinese_hunter_poison_policy,
        host_resolve_phase_carries_chinese_hunter_day_vote_retaliation,
        host_resolve_phase_carries_chinese_idiot_survival_policy,
        host_resolve_phase_carries_chinese_prophet_alignment_result,
        host_resolve_phase_carries_chinese_cupid_link_and_lovers_cascade,
        host_resolve_phase_carries_chinese_lover_poison_cascade,
        host_resolve_phase_carries_chinese_lover_lynch_cascade,
        host_resolve_phase_emits_hammer_vote_outcome,
    )
}

fn leftover_host_resolve_assignments(specs: &[LeftoverCaseSpec]) -> BTreeMap<&'static str, usize> {
    let mut ordered = specs.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        right
            .baseline_milliseconds
            .cmp(&left.baseline_milliseconds)
            .then_with(|| left.id.cmp(right.id))
    });
    let mut loads = [0u128; LEFTOVER_HOST_RESOLVE_SHARDS];
    let mut assignments = BTreeMap::new();
    for case in ordered {
        let shard = loads
            .iter()
            .enumerate()
            .min_by_key(|(shard, load)| (**load, *shard))
            .map(|(shard, _)| shard)
            .expect("semantic shards are non-empty");
        loads[shard] += case.baseline_milliseconds;
        assignments.insert(case.id, shard);
    }
    assignments
}

async fn run_leftover_host_resolve_shard(pool: PgPool, shard: usize) {
    let specs = leftover_host_resolve_case_specs();
    assert_eq!(
        specs.len(),
        LEFTOVER_HOST_RESOLVE_PHASE_CASES,
        "leftover host_resolve corpus must retain every handwritten case"
    );
    let assignments = leftover_host_resolve_assignments(&specs);
    assert_eq!(assignments.len(), LEFTOVER_HOST_RESOLVE_PHASE_CASES);
    let mut timings = Vec::new();
    for case in specs
        .iter()
        .filter(|case| assignments.get(case.id) == Some(&shard))
    {
        let started = std::time::Instant::now();
        (case.run)(pool.clone()).await;
        let milliseconds = started.elapsed().as_millis();
        eprintln!(
            "FMARCH_SEMANTIC_CASE\t{}\t{}\t{}",
            case.id, shard, milliseconds
        );
        timings.push((case.id, milliseconds));
    }
    assert!(!timings.is_empty(), "semantic shard {shard} must own cases");
    if let Ok(artifact_dir) = std::env::var("FMARCH_PROOF_ARTIFACT_DIR") {
        let cases = timings
            .iter()
            .map(|(id, milliseconds)| {
                serde_json::json!({
                    "id": id,
                    "milliseconds": milliseconds,
                })
            })
            .collect::<Vec<_>>();
        std::fs::write(
            std::path::Path::new(&artifact_dir)
                .join(format!("semantic-shard-{shard}-case-timings.json")),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schema": 1,
                "shard": shard,
                "cases": cases,
            }))
            .expect("serialize semantic shard timings"),
        )
        .expect("write semantic shard timings");
    }
}

#[test]
fn leftover_host_resolve_shard_contract_is_complete_deterministic_and_balanced() {
    let specs = leftover_host_resolve_case_specs();
    assert_eq!(specs.len(), LEFTOVER_HOST_RESOLVE_PHASE_CASES);
    let ids = specs.iter().map(|case| case.id).collect::<BTreeSet<_>>();
    assert_eq!(ids.len(), LEFTOVER_HOST_RESOLVE_PHASE_CASES);
    let first = leftover_host_resolve_assignments(&specs);
    let second = leftover_host_resolve_assignments(&specs);
    assert_eq!(
        first, second,
        "semantic shard assignment must be deterministic"
    );
    let mut counts = [0usize; LEFTOVER_HOST_RESOLVE_SHARDS];
    let mut loads = [0u128; LEFTOVER_HOST_RESOLVE_SHARDS];
    for case in &specs {
        let shard = first[case.id];
        counts[shard] += 1;
        loads[shard] += case.baseline_milliseconds;
    }
    assert_eq!(
        counts.iter().sum::<usize>(),
        LEFTOVER_HOST_RESOLVE_PHASE_CASES
    );
    assert!(counts.iter().all(|count| *count > 0));
    let lightest = *loads.iter().min().expect("semantic shard loads");
    let heaviest = *loads.iter().max().expect("semantic shard loads");
    assert!(
        heaviest - lightest <= 1_000,
        "duration-balanced shards drifted: {loads:?}"
    );
}

macro_rules! semantic_shard_test {
    ($name:ident, $shard:literal) => {
        #[sqlx::test(migrations = "../database_schema/migrations")]
        async fn $name(pool: PgPool) {
            run_leftover_host_resolve_shard(pool, $shard).await;
        }
    };
}

semantic_shard_test!(leftover_host_resolve_phase_cases_shard_0, 0);
semantic_shard_test!(leftover_host_resolve_phase_cases_shard_1, 1);
semantic_shard_test!(leftover_host_resolve_phase_cases_shard_2, 2);
semantic_shard_test!(leftover_host_resolve_phase_cases_shard_3, 3);
