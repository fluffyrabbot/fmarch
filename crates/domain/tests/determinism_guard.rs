use std::{fs, path::Path};

use domain::{resolve, DayPhaseInputs, Pack, ResolutionInput, StateSnapshot, Submission};
use serde::Deserialize;
use serde_json::{json, Value};

fn domain_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn collect_rs_files(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).unwrap_or_else(|e| panic!("read dir {dir:?}: {e}")) {
        let entry = entry.unwrap_or_else(|e| panic!("read entry in {dir:?}: {e}"));
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            files.push(path);
        }
    }
}

fn uncommented_source(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut in_block = false;

    for line in source.lines() {
        let mut rest = line;
        loop {
            if in_block {
                if let Some(end) = rest.find("*/") {
                    rest = &rest[end + 2..];
                    in_block = false;
                } else {
                    break;
                }
            } else if let Some(start) = rest.find("/*") {
                out.push_str(&rest[..start]);
                out.push('\n');
                rest = &rest[start + 2..];
                in_block = true;
            } else {
                if let Some(comment) = rest.find("//") {
                    out.push_str(&rest[..comment]);
                } else {
                    out.push_str(rest);
                }
                out.push('\n');
                break;
            }
        }
    }

    out
}

#[test]
fn domain_source_rejects_ambient_rng_and_wall_clock() {
    let root = domain_root();
    let mut files = Vec::new();
    collect_rs_files(&root.join("src"), &mut files);
    files.push(root.join("Cargo.toml"));

    let forbidden = [
        "std::time",
        "SystemTime",
        "Instant::now",
        "UNIX_EPOCH",
        "chrono::",
        "time::OffsetDateTime",
        "time::SystemTime",
        "rand::",
        "thread_rng",
        "random::<",
        "fastrand",
        "getrandom",
        "OsRng",
    ];

    let mut violations = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
        let scanned = if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            uncommented_source(&source)
        } else {
            source
        };
        for needle in forbidden {
            if scanned.contains(needle) {
                violations.push(format!(
                    "{} contains forbidden ambient determinism API `{needle}`",
                    path.strip_prefix(root).unwrap_or(&path).display()
                ));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "domain code must stay deterministic; seed randomness through ResolutionInput.seed and use logical_time for timestamps:\n{}",
        violations.join("\n")
    );
}

#[derive(Clone, Deserialize)]
struct FixtureInput {
    #[serde(default)]
    game_id: String,
    phase_id: String,
    state: StateSnapshot,
    submissions: Vec<Submission>,
    #[serde(default)]
    day_phase_inputs: DayPhaseInputs,
}

#[test]
fn seeded_property_family_replays_ordering_and_fixpoints_deterministically() {
    let seeds = [101_u64, 202, 303, 404, 505, 606, 707, 808];

    for seed in seeds {
        let ordering = same_ability_ordering_input(seed);
        assert_replay_and_permutations_are_stable(
            "same-ability ordering",
            ordering,
            load_pack_named("mafiascum"),
            seed,
            ExpectedNote::None,
        );

        let redirect = fixture_input("mafiascum", "redirect_cycle_stable.json", seed);
        assert_replay_and_permutations_are_stable(
            "redirect graph ordering",
            redirect,
            load_pack_named("mafiascum"),
            seed,
            ExpectedNote::None,
        );

        let mut redirect_loop_pack = load_pack_named("mafiascum");
        redirect_loop_pack.redirects.loop_cap = 1;
        let redirect_loop = fixture_input("mafiascum", "busdriver_redirect.json", seed);
        assert_replay_and_permutations_are_stable(
            "redirect loop-cap termination",
            redirect_loop,
            redirect_loop_pack,
            seed,
            ExpectedNote::Contains(
                "redirect loop_cap (1) reached; truncating redirect graph rules",
            ),
        );

        let mut trigger_loop_pack = load_pack_named("mafiascum");
        trigger_loop_pack.redirects.loop_cap = 1;
        let mut trigger_loop = fixture_input("mafiascum", "vengeful_retaliates_on_kill.json", seed);
        trigger_loop.state.slots[0]
            .effects
            .push("vengeful".to_string());
        assert_replay_and_permutations_are_stable(
            "trigger loop-cap termination",
            trigger_loop,
            trigger_loop_pack,
            seed,
            ExpectedNote::Contains("trigger loop_cap (1) reached; terminating trigger fixpoint"),
        );
    }
}

#[derive(Clone, Copy)]
enum ExpectedNote {
    None,
    Contains(&'static str),
}

fn assert_replay_and_permutations_are_stable(
    label: &str,
    input: FixtureInput,
    pack: Pack,
    seed: u64,
    expected_note: ExpectedNote,
) {
    let baseline = canonical_output(&input, pack.clone(), seed, 0, label);
    let replay = canonical_output(&input, pack.clone(), seed, 0, label);
    assert_eq!(
        baseline, replay,
        "{label}: exact replay drifted for seed {seed}"
    );

    if let ExpectedNote::Contains(note) = expected_note {
        let notes = baseline["trace"]["notes"]
            .as_array()
            .expect("trace.notes should be an array");
        assert!(
            notes.iter().any(|value| value == note),
            "{label}: expected trace note {note:?} for seed {seed}, got {notes:?}"
        );
    }

    for permutation in 1..=3 {
        let mut permuted = input.clone();
        permute_submissions(&mut permuted.submissions, seed, permutation);
        let got = canonical_output(&permuted, pack.clone(), seed, permutation, label);
        assert_eq!(
            baseline, got,
            "{label}: permutation {permutation} changed canonical output for seed {seed}"
        );
    }
}

fn canonical_output(
    input: &FixtureInput,
    pack: Pack,
    seed: u64,
    run_variant: usize,
    label: &str,
) -> Value {
    let output = resolve(ResolutionInput {
        game_id: input.game_id.clone(),
        phase_id: input.phase_id.clone(),
        run_id: format!("property:{label}:{seed}:{run_variant}"),
        state: input.state.clone(),
        submissions: input.submissions.clone(),
        day_phase_inputs: input.day_phase_inputs.clone(),
        pack,
        seed,
        logical_time: 0,
    });
    let mut value = json!({
        "applied": output.applied,
        "trace": output.trace,
        "post_state": output.post_state,
    });
    value["applied"]["run_id"] = json!("<stable>");
    value["trace"]["run_id"] = json!("<stable>");
    value
}

fn permute_submissions(submissions: &mut [Submission], seed: u64, permutation: usize) {
    if submissions.len() < 2 {
        return;
    }
    match permutation {
        1 => submissions.reverse(),
        2 => {
            let by = (seed as usize % submissions.len()).max(1);
            submissions.rotate_left(by);
        }
        3 => {
            let left = seed as usize % submissions.len();
            let right = (left + 1) % submissions.len();
            submissions.swap(left, right);
        }
        _ => unreachable!("only three permutations are used"),
    }
}

fn same_ability_ordering_input(seed: u64) -> FixtureInput {
    fixture_from_value(json!({
        "game_id": "property_same_ability_ordering",
        "phase_id": "N01",
        "state": {
            "phase_kind": "Night",
            "phase_number": 1,
            "phase_id": "N01",
            "phase_deadline": null,
            "phase_policy": {
                "cadence": ["Day", "Night"],
                "subsegments": {"Day": ["main", "eod"]},
                "twilight": false
            },
            "slots": [
                {
                    "slot_id": "slot_1",
                    "role_key": "mafia_goon",
                    "alignment": "mafia",
                    "status": "alive",
                    "effects": []
                },
                {
                    "slot_id": "slot_2",
                    "role_key": "doctor",
                    "alignment": "town",
                    "status": "alive",
                    "effects": []
                },
                {
                    "slot_id": "slot_3",
                    "role_key": "doctor",
                    "alignment": "town",
                    "status": "alive",
                    "effects": []
                },
                {
                    "slot_id": "slot_4",
                    "role_key": "vanilla_townie",
                    "alignment": "town",
                    "status": "alive",
                    "effects": []
                },
                {
                    "slot_id": "slot_5",
                    "role_key": "vanilla_townie",
                    "alignment": "town",
                    "status": "alive",
                    "effects": []
                }
            ]
        },
        "submissions": [
            {
                "action_id": "protect_a",
                "actor": "slot_2",
                "template_id": "doctor_protect",
                "targets": ["slot_4"],
                "phase_id": "N01",
                "submitted_at": 7,
                "withdrawn": false,
                "metadata": {}
            },
            {
                "action_id": "protect_b",
                "actor": "slot_3",
                "template_id": "doctor_protect",
                "targets": ["slot_4"],
                "phase_id": "N01",
                "submitted_at": 7,
                "withdrawn": false,
                "metadata": {}
            },
            {
                "action_id": "kill_target",
                "actor": "slot_1",
                "template_id": "factional_kill",
                "targets": ["slot_4"],
                "phase_id": "N01",
                "submitted_at": 1,
                "withdrawn": false,
                "metadata": {}
            }
        ],
        "seed": seed
    }))
}

fn fixture_input(pack: &str, fixture: &str, seed: u64) -> FixtureInput {
    let path = domain_root()
        .parent()
        .and_then(Path::parent)
        .expect("domain crate should live under crates/domain")
        .join("packs")
        .join(pack)
        .join("golden")
        .join(fixture);
    let raw = fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {path:?}: {err}"));
    let mut value: Value =
        serde_json::from_str(&raw).unwrap_or_else(|err| panic!("parse {path:?}: {err}"));
    value["input"]["seed"] = json!(seed);
    fixture_from_value(value["input"].clone())
}

fn fixture_from_value(value: Value) -> FixtureInput {
    serde_json::from_value(value).expect("property fixture input should deserialize")
}

fn load_pack_named(name: &str) -> Pack {
    let path = domain_root()
        .parent()
        .and_then(Path::parent)
        .expect("domain crate should live under crates/domain")
        .join("packs")
        .join(name)
        .join("pack.json");
    let raw = fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {path:?}: {err}"));
    domain::load_pack_from_json(&raw).unwrap_or_else(|err| panic!("load {name}/pack.json: {err}"))
}
