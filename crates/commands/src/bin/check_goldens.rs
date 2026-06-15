use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::ExitCode,
};

use serde_json::Value;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = Args::parse()?;
    run_with_args(args)
}

fn run_with_args(args: Args) -> Result<(), String> {
    let mut paths = if args.paths.is_empty() {
        discover_repo_goldens()?
    } else {
        collect_requested_goldens(&args.paths)?
    };
    paths.sort();
    paths.dedup();

    let mut pack_jsons: BTreeMap<String, Value> = BTreeMap::new();
    let mut drift = Vec::new();
    let mut checked = 0usize;

    for path in &paths {
        let pack_name = pack_name_for_golden(path)?;
        let raw =
            fs::read_to_string(path).map_err(|err| format!("read {}: {err}", path.display()))?;
        let mut golden: Value =
            serde_json::from_str(&raw).map_err(|err| format!("parse {}: {err}", path.display()))?;

        let base_pack_json = if let Some(pack_json) = pack_jsons.get(&pack_name) {
            pack_json.clone()
        } else {
            let pack_json = load_pack_json(&pack_name)?;
            pack_jsons.insert(pack_name.clone(), pack_json.clone());
            pack_json
        };
        let pack_json = domain::golden_pack_json_with_overrides(&base_pack_json, &golden)
            .map_err(|err| format!("apply {} pack overrides: {err}", path.display()))?;
        let pack_raw = serde_json::to_string(&pack_json)
            .map_err(|err| format!("encode overridden pack for {}: {err}", path.display()))?;
        let pack = domain::load_pack_from_json(&pack_raw)
            .map_err(|err| format!("load pack for {}: {err}", path.display()))?;

        let input = golden
            .get("input")
            .ok_or_else(|| format!("{}: missing input", path.display()))?;
        let actual = domain::normalize_golden_events(
            &domain::golden_events_from_input_value(input, pack, "golden-run")
                .map_err(|err| format!("run {}: {err}", path.display()))?,
        );
        let expected = golden
            .get("expected_events")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("{}: missing expected_events array", path.display()))?;
        let expected = domain::normalize_golden_events(expected);

        if expected != actual {
            if args.write {
                golden["expected_events"] = Value::Array(actual);
                let pretty = serde_json::to_string_pretty(&golden)
                    .map_err(|err| format!("encode {}: {err}", path.display()))?;
                fs::write(path, format!("{pretty}\n"))
                    .map_err(|err| format!("write {}: {err}", path.display()))?;
            } else {
                drift.push(drift_message(path, &expected, &actual));
            }
        }
        checked += 1;
    }

    if !drift.is_empty() {
        return Err(format!(
            "golden drift detected in {} fixture(s):\n{}",
            drift.len(),
            drift.join("\n")
        ));
    }

    if args.write {
        println!("ok: wrote {checked} golden fixture(s)");
    } else {
        println!("ok: checked {checked} golden fixture(s)");
    }
    Ok(())
}

struct Args {
    write: bool,
    paths: Vec<PathBuf>,
}

impl Args {
    fn parse() -> Result<Self, String> {
        let mut write = false;
        let mut check = false;
        let mut paths = Vec::new();
        for arg in env::args().skip(1) {
            match arg.as_str() {
                "--write" => write = true,
                "--check" => check = true,
                "-h" | "--help" => return Err(usage()),
                _ => paths.push(PathBuf::from(arg)),
            }
        }
        if write && check {
            return Err("--write and --check are mutually exclusive".to_string());
        }
        Ok(Self { write, paths })
    }
}

fn usage() -> String {
    "usage: check_goldens [--check|--write] [<golden.json|pack-dir|golden-dir|packs-dir> ...]"
        .to_string()
}

fn discover_repo_goldens() -> Result<Vec<PathBuf>, String> {
    collect_requested_goldens(&[repo_root().join("packs")])
}

fn collect_requested_goldens(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut goldens = Vec::new();
    for path in paths {
        if path.is_file() {
            if is_golden_json(path) {
                goldens.push(path.clone());
            } else {
                return Err(format!("{} is not a golden JSON fixture", path.display()));
            }
        } else if path.is_dir() {
            collect_golden_files(path, &mut goldens)?;
        } else {
            return Err(format!("{} does not exist", path.display()));
        }
    }
    if goldens.is_empty() {
        return Err("no golden fixtures found".to_string());
    }
    Ok(goldens)
}

fn collect_golden_files(path: &Path, goldens: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|err| format!("read dir {}: {err}", path.display()))? {
        let entry = entry.map_err(|err| format!("read dir {}: {err}", path.display()))?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_golden_files(&entry_path, goldens)?;
        } else if is_golden_json(&entry_path) {
            goldens.push(entry_path);
        }
    }
    Ok(())
}

fn is_golden_json(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()) == Some("json")
        && path
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some("golden")
}

fn pack_name_for_golden(path: &Path) -> Result<String, String> {
    path.parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("{} is not under packs/<pack>/golden", path.display()))
}

fn load_pack_json(pack_name: &str) -> Result<Value, String> {
    let path = repo_root().join("packs").join(pack_name).join("pack.json");
    let raw = fs::read_to_string(&path).map_err(|err| format!("read {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("parse {}: {err}", path.display()))
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("commands crate should live under crates/commands")
        .to_path_buf()
}

fn drift_message(path: &Path, expected: &[Value], actual: &[Value]) -> String {
    if expected.len() != actual.len() {
        return format!(
            "{}: expected_events length {} != regenerated {}",
            path.display(),
            expected.len(),
            actual.len()
        );
    }
    let index = expected
        .iter()
        .zip(actual)
        .position(|(expected, actual)| expected != actual)
        .unwrap_or(0);
    format!("{}: expected_events[{index}] drifted", path.display())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use serde_json::{json, Value};

    use super::{repo_root, run_with_args, Args};

    #[test]
    fn write_mode_regenerates_a_drifted_temp_fixture() {
        let temp_root = unique_temp_root();
        let golden_dir = temp_root.join("packs/default_open/golden");
        fs::create_dir_all(&golden_dir).unwrap();
        let fixture_path = golden_dir.join("day_majority_elimination.json");
        let source_path =
            repo_root().join("packs/default_open/golden/day_majority_elimination.json");
        let source = fs::read_to_string(&source_path).unwrap();
        let mut fixture: Value = serde_json::from_str(&source).unwrap();
        fixture["expected_events"] = json!([]);
        fs::write(
            &fixture_path,
            format!("{}\n", serde_json::to_string_pretty(&fixture).unwrap()),
        )
        .unwrap();

        let check_args = Args {
            write: false,
            paths: vec![fixture_path.clone()],
        };
        let err = run_with_args(check_args).expect_err("drifted temp fixture should fail check");
        assert!(
            err.contains("expected_events length 0"),
            "unexpected drift error: {err}"
        );

        run_with_args(Args {
            write: true,
            paths: vec![fixture_path.clone()],
        })
        .expect("write mode should regenerate expected_events");
        run_with_args(Args {
            write: false,
            paths: vec![fixture_path.clone()],
        })
        .expect("regenerated fixture should pass check mode");

        let regenerated: Value =
            serde_json::from_str(&fs::read_to_string(&fixture_path).unwrap()).unwrap();
        assert!(
            regenerated["expected_events"]
                .as_array()
                .is_some_and(|events| !events.is_empty()),
            "write mode should persist regenerated expected events"
        );

        fs::remove_dir_all(temp_root).unwrap();
    }

    fn unique_temp_root() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "fmarch-check-goldens-{}-{nanos}",
            std::process::id()
        ))
    }
}
