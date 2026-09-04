//! The mention universes are separated by the type system, not by a validator.
//!
//! RFC 0007 invariants 4 and 5 say a game post carrying a profile address and
//! a community post carrying a slot address are *unrepresentable*. A runtime
//! assertion cannot prove that — it only proves that one code path happens to
//! refuse today. So this proof compiles fixtures out-of-line and requires the
//! compiler to be the one that refuses.
//!
//! The harness is deliberately dependency-free: it drives `rustc` against the
//! rlib this test is already linked to, so the fixtures see exactly the crate
//! under test and the proof adds no third-party code to a pure context.

use std::path::{Path, PathBuf};
use std::process::Command;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/compile_fail");

/// Every rejection the fixtures must provoke, keyed by fixture. Naming the
/// diagnostic keeps a fixture that stops compiling for an unrelated reason
/// (a renamed import, a typo) from being scored as a boundary proof.
const MUST_NOT_COMPILE: &[(&str, &[&str])] = &[
    (
        "slot_mention_on_community_post.rs",
        &["E0308", "E0308", "E0308"],
    ),
    (
        "profile_mention_on_game_post.rs",
        &["E0308", "E0308", "E0560"],
    ),
];

const MUST_COMPILE: &str = "control_addresses_stay_home.rs";

#[test]
fn a_slot_address_cannot_be_constructed_on_a_community_post() {
    let (fixture, expected) = MUST_NOT_COMPILE[0];
    let stderr = expect_compile_failure(fixture);
    assert_expected_diagnostics(fixture, &stderr, expected);
}

#[test]
fn a_profile_address_cannot_be_constructed_on_a_game_post() {
    let (fixture, expected) = MUST_NOT_COMPILE[1];
    let stderr = expect_compile_failure(fixture);
    assert_expected_diagnostics(fixture, &stderr, expected);
}

/// Without this control the two proofs above are unfalsifiable.
#[test]
fn each_address_still_compiles_inside_its_own_universe() {
    let output = compile(MUST_COMPILE);
    assert!(
        output.status.success(),
        "control fixture {MUST_COMPILE} must compile, but rustc refused it:\n{}",
        String::from_utf8_lossy(&output.stderr),
    );
}

fn expect_compile_failure(fixture: &str) -> String {
    let output = compile(fixture);
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(
        !output.status.success(),
        "fixture {fixture} compiled, so the mention universes are merely \
         validated apart rather than typed apart:\n{stderr}",
    );
    stderr
}

fn assert_expected_diagnostics(fixture: &str, stderr: &str, expected: &[&str]) {
    for code in expected {
        assert!(
            stderr.contains(code),
            "fixture {fixture} failed without the expected {code} diagnostic, so it \
             may be failing for an unrelated reason:\n{stderr}",
        );
    }
}

fn compile(fixture: &str) -> std::process::Output {
    let deps = deps_dir();
    let out_dir = std::env::temp_dir().join(format!("content-reference-universe-{fixture}"));
    std::fs::create_dir_all(&out_dir).expect("fixture output directory");
    let mut command = Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()));
    command
        .arg("--edition=2021")
        .arg("--crate-type=lib")
        .arg("--emit=metadata")
        .arg("-L")
        .arg(format!("dependency={}", deps.display()))
        .arg("--extern")
        .arg(format!(
            "content_reference={}",
            newest_rlib(&deps, "libcontent_reference").display()
        ))
        .arg("--out-dir")
        .arg(&out_dir)
        .arg(Path::new(FIXTURES).join(fixture));
    command.output().expect("rustc runs")
}

/// `target/<profile>/deps`, discovered from this test binary rather than
/// assumed, so a shared or relocated `CARGO_TARGET_DIR` still resolves.
fn deps_dir() -> PathBuf {
    std::env::current_exe()
        .expect("test binary path")
        .parent()
        .expect("test binary lives in the deps directory")
        .to_path_buf()
}

/// Cargo leaves one rlib per compilation of a crate in `deps`, and a shared
/// target directory accumulates several. The newest is the one this test binary
/// was just linked against. Fixtures name no other crate, so this resolves
/// exactly one extern and cannot pick a stale sibling.
fn newest_rlib(deps: &Path, stem: &str) -> PathBuf {
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(deps)
        .expect("deps directory is readable")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "rlib")
                && path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&format!("{stem}-")))
        })
        .filter_map(|path| {
            let modified = path.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect();
    candidates.sort_by_key(|(modified, _)| *modified);
    candidates
        .pop()
        .unwrap_or_else(|| panic!("no {stem} rlib in {}", deps.display()))
        .1
}
