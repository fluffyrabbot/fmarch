#!/usr/bin/env bash
# Cargo artifacts live on an external writable root, exposed as repo target/.
# Discovery: FMARCH_EXTERNAL_BUILD_ROOT if set, else the preferred Darwin volume
# root when its parent exists and is writable, else fail closed (exit 75).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: check-build-posture.sh [--apply] [--repo-root DIR] [--preferred-root DIR]

Verify that repo target/ is a symlink onto an external Cargo build root.

Discovery:
  1. FMARCH_EXTERNAL_BUILD_ROOT, if set (verbatim)
  2. --preferred-root, default /Volumes/rabbitx10/build/fmarch, if its
     parent directory exists and is writable
  3. otherwise exit 75

--apply creates $root/target and the target/ symlink when missing.
It will not replace a real directory or a mismatched symlink.
EOF
}

fail() {
  local code="$1"
  shift
  echo "$*" >&2
  exit "${code}"
}

apply=0
repo_root=""
preferred_root="/Volumes/rabbitx10/build/fmarch"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      apply=1
      shift
      ;;
    --repo-root)
      [[ -n "${2:-}" && "${2}" != --* ]] || fail 2 "--repo-root requires a directory"
      repo_root="$2"
      shift 2
      ;;
    --preferred-root)
      [[ -n "${2:-}" && "${2}" != --* ]] || fail 2 "--preferred-root requires a directory"
      preferred_root="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail 2 "unknown argument: $1"
      ;;
  esac
done

if [[ -z "${repo_root}" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "${script_dir}/.." && pwd)"
else
  repo_root="$(cd "${repo_root}" && pwd)" || fail 2 "repo root is not a directory: ${repo_root}"
fi

preferred_root="${preferred_root%/}"

resolve_external_root() {
  if [[ -n "${FMARCH_EXTERNAL_BUILD_ROOT:-}" ]]; then
    printf '%s\n' "${FMARCH_EXTERNAL_BUILD_ROOT%/}"
    return 0
  fi
  local parent
  parent="$(dirname "${preferred_root}")"
  if [[ -d "${parent}" && -w "${parent}" ]]; then
    printf '%s\n' "${preferred_root}"
    return 0
  fi
  return 1
}

if ! external_root="$(resolve_external_root)"; then
  fail 75 "external build root is unavailable; mount ${preferred_root} or set writable FMARCH_EXTERNAL_BUILD_ROOT"
fi

target_path="${repo_root}/target"
expected_target="${external_root}/target"

ensure_external_target() {
  if [[ -n "${FMARCH_EXTERNAL_BUILD_ROOT:-}" && ! -d "${external_root}" ]]; then
    if [[ "${apply}" -eq 0 ]]; then
      fail 75 "FMARCH_EXTERNAL_BUILD_ROOT is not a writable directory: ${external_root}"
    fi
    local parent
    parent="$(dirname "${external_root}")"
    [[ -d "${parent}" && -w "${parent}" ]] \
      || fail 75 "cannot create FMARCH_EXTERNAL_BUILD_ROOT: ${external_root}"
  elif [[ -n "${FMARCH_EXTERNAL_BUILD_ROOT:-}" && ! -w "${external_root}" ]]; then
    fail 75 "FMARCH_EXTERNAL_BUILD_ROOT is not writable: ${external_root}"
  fi

  mkdir -p "${expected_target}" \
    || fail 75 "cannot create ${expected_target}"
  [[ -d "${expected_target}" && -w "${expected_target}" ]] \
    || fail 75 "external fmarch target is not a writable directory: ${expected_target}"

  local probe="${expected_target}/.fmarch-write-probe"
  : >"${probe}"
  rm -f "${probe}"
}

ensure_external_target

if [[ -L "${target_path}" ]]; then
  actual_target="$(readlink "${target_path}")"
  [[ "${actual_target}" == "${expected_target}" ]] \
    || fail 74 "unexpected target symlink: ${target_path} -> ${actual_target}; expected ${expected_target}"
elif [[ -e "${target_path}" ]]; then
  fail 74 "refusing real local target dir; expected symlink ${target_path} -> ${expected_target}"
elif [[ "${apply}" -eq 1 ]]; then
  ln -s "${expected_target}" "${target_path}" \
    || fail 74 "failed to create symlink ${target_path} -> ${expected_target}"
else
  fail 74 "refusing real local target dir; expected symlink ${target_path} -> ${expected_target}"
fi

expected_phys="$(cd "${expected_target}" && pwd -P)"
actual_phys="$(cd "${target_path}" && pwd -P)"
[[ "${actual_phys}" == "${expected_phys}" ]] \
  || fail 74 "external target resolved outside expected fmarch build root: ${actual_phys} (expected ${expected_phys})"

echo "build_posture=ok"
echo "target=${target_path}"
echo "external_root=${external_root}"
echo "external_target=${expected_target}"
