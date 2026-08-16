#!/usr/bin/env bash
# Hermetic discovery/--apply matrix. Does not touch the real checkout target/.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="${script_dir}/check-build-posture.sh"
repo_root="$(cd "${script_dir}/.." && pwd)"
pass=0
fail=0
scratch_roots=()

cleanup() {
  local root
  for root in "${scratch_roots[@]+"${scratch_roots[@]}"}"; do
    rm -rf "${root}"
  done
}
trap cleanup EXIT

scratch() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/fmarch-posture.XXXXXX")"
  scratch_roots+=("${dir}")
  printf '%s\n' "${dir}"
}

assert_exit() {
  local expected="$1"
  local name="$2"
  shift 2
  local rc=0
  local out err
  out="$(mktemp "${TMPDIR:-/tmp}/fmarch-posture-out.XXXXXX")"
  err="$(mktemp "${TMPDIR:-/tmp}/fmarch-posture-err.XXXXXX")"
  scratch_roots+=("${out}" "${err}")
  "$@" >"${out}" 2>"${err}" || rc=$?
  if [[ "${rc}" -eq "${expected}" ]]; then
    echo "ok - ${name}"
    pass=$((pass + 1))
    return 0
  fi
  echo "not ok - ${name} (exit ${rc}, expected ${expected})"
  echo "  stdout: $(cat "${out}")"
  echo "  stderr: $(cat "${err}")"
  fail=$((fail + 1))
}

assert_link() {
  local link="$1"
  local expected="$2"
  local name="$3"
  local actual
  if [[ ! -L "${link}" ]]; then
    echo "not ok - ${name} (${link} is not a symlink)"
    fail=$((fail + 1))
    return 0
  fi
  actual="$(readlink "${link}")"
  if [[ "${actual}" == "${expected}" ]]; then
    echo "ok - ${name}"
    pass=$((pass + 1))
    return 0
  fi
  echo "not ok - ${name} (${link} -> ${actual}, expected ${expected})"
  fail=$((fail + 1))
}

run_script() {
  env -u FMARCH_EXTERNAL_BUILD_ROOT bash "${script}" "$@"
}

run_script_env() {
  local root="$1"
  shift
  env FMARCH_EXTERNAL_BUILD_ROOT="${root}" bash "${script}" "$@"
}

ws="$(scratch)"
pref_parent="$(scratch)"
pref="${pref_parent}/fmarch"
env_parent="$(scratch)"
env_root="${env_parent}/external"
missing_pref="/no/such/fmarch/build-root"

assert_exit 75 "no env and missing preferred root fails closed" \
  run_script --repo-root "${ws}" --preferred-root "${missing_pref}"

assert_exit 0 "preferred root is used when its parent is writable" \
  run_script --apply --repo-root "${ws}" --preferred-root "${pref}"
assert_link "${ws}/target" "${pref}/target" "apply creates preferred-root symlink"

assert_exit 0 "check is idempotent on a correct preferred-root symlink" \
  run_script --repo-root "${ws}" --preferred-root "${pref}"

ws_env="$(scratch)"
assert_exit 0 "FMARCH_EXTERNAL_BUILD_ROOT wins over a usable preferred root" \
  run_script_env "${env_root}" --apply --repo-root "${ws_env}" --preferred-root "${pref}"
assert_link "${ws_env}/target" "${env_root}/target" "env override symlink ignores preferred root"

assert_exit 0 "check accepts the env override after apply" \
  run_script_env "${env_root}" --repo-root "${ws_env}" --preferred-root "${pref}"

missing_env="${env_parent}/missing-root"
ws_missing="$(scratch)"
assert_exit 75 "check fails when FMARCH_EXTERNAL_BUILD_ROOT is missing" \
  run_script_env "${missing_env}" --repo-root "${ws_missing}" --preferred-root "${missing_pref}"

assert_exit 0 "apply creates a missing FMARCH_EXTERNAL_BUILD_ROOT" \
  run_script_env "${missing_env}" --apply --repo-root "${ws_missing}" --preferred-root "${missing_pref}"
assert_link "${ws_missing}/target" "${missing_env}/target" "apply env root symlink"

ws_real="$(scratch)"
mkdir -p "${ws_real}/target"
echo stay >"${ws_real}/target/keep-me"
assert_exit 74 "check refuses a real target directory" \
  run_script_env "${env_root}" --repo-root "${ws_real}" --preferred-root "${missing_pref}"
assert_exit 74 "apply refuses a real target directory" \
  run_script_env "${env_root}" --apply --repo-root "${ws_real}" --preferred-root "${missing_pref}"
if [[ -f "${ws_real}/target/keep-me" ]]; then
  echo "ok - apply does not delete a real target directory"
  pass=$((pass + 1))
else
  echo "not ok - apply deleted a real target directory"
  fail=$((fail + 1))
fi

ws_wrong="$(scratch)"
ln -s /tmp/fmarch-not-the-build-root "${ws_wrong}/target"
assert_exit 74 "check refuses a mismatched symlink" \
  run_script_env "${env_root}" --repo-root "${ws_wrong}" --preferred-root "${missing_pref}"
assert_exit 74 "apply refuses a mismatched symlink" \
  run_script_env "${env_root}" --apply --repo-root "${ws_wrong}" --preferred-root "${missing_pref}"

if grep -E '^(target-dir|build-dir)\s*=' "${repo_root}/.cargo/config.toml" >/dev/null; then
  echo "not ok - repo .cargo/config.toml must not set target-dir or build-dir"
  fail=$((fail + 1))
else
  echo "ok - repo .cargo/config.toml has no target-dir or build-dir"
  pass=$((pass + 1))
fi

if grep -E 'CARGO_TARGET_DIR' "${repo_root}/.cargo/config.toml" >/dev/null; then
  echo "not ok - repo .cargo/config.toml must not set CARGO_TARGET_DIR"
  fail=$((fail + 1))
else
  echo "ok - repo .cargo/config.toml has no CARGO_TARGET_DIR"
  pass=$((pass + 1))
fi

echo "${pass} passed, ${fail} failed"
if [[ "${fail}" -ne 0 ]]; then
  exit 1
fi
