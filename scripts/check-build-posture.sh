#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
external_target="/Volumes/rabbitx10/build/fmarch/target"
target_path="${repo_root}/target"

fail() {
  local code="$1"
  shift
  echo "$*" >&2
  exit "${code}"
}

[[ -d /Volumes/rabbitx10/build ]] \
  || fail 75 "external build root is missing: /Volumes/rabbitx10/build"
[[ -w /Volumes/rabbitx10/build ]] \
  || fail 75 "external build root is not writable: /Volumes/rabbitx10/build"

mkdir -p "$(dirname "${external_target}")"
if [[ ! -e "${external_target}" ]]; then
  mkdir -p "${external_target}"
fi
[[ -d "${external_target}" ]] \
  || fail 75 "external fmarch target is not a directory: ${external_target}"
[[ -w "${external_target}" ]] \
  || fail 75 "external fmarch target is not writable: ${external_target}"

probe="${external_target}/.codex-write-probe"
: >"${probe}"
rm -f "${probe}"

[[ -L "${target_path}" ]] \
  || fail 74 "refusing real local target dir; expected symlink ${target_path} -> ${external_target}"

actual_target="$(readlink "${target_path}")"
[[ "${actual_target}" == "${external_target}" ]] \
  || fail 74 "unexpected target symlink: ${target_path} -> ${actual_target}; expected ${external_target}"

case "$(cd "${external_target}" && pwd -P)" in
  /Volumes/rabbitx10/build/fmarch/target)
    ;;
  *)
    fail 74 "external target resolved outside expected fmarch build root: ${external_target}"
    ;;
esac

echo "build_posture=ok"
echo "target=${target_path}"
echo "external_target=${external_target}"
