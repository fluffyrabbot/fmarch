#!/usr/bin/env bash
# Bounded fake-runtime checks: no package downloads, host mutations, or builds.
set -euo pipefail
proof_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/with-proof-node.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/fmarch-proof-node-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/node" <<'SCRIPT'
#!/bin/bash
printf '%s\n' "${TEST_SYSTEM_NODE_VERSION:-v26.10.0}"
SCRIPT
cat >"$fake_bin/npm" <<'SCRIPT'
#!/bin/bash
printf '%s\n' "${TEST_SYSTEM_NPM_VERSION:-12.1.0}"
SCRIPT
cat >"$fake_bin/uname" <<'SCRIPT'
#!/bin/bash
if [[ "$1" == -s ]]; then printf 'Linux\n'; else printf 'x86_64\n'; fi
SCRIPT
for fake_tool in flock sha256sum pacman-key bsdtar; do
  cat >"$fake_bin/$fake_tool" <<'SCRIPT'
#!/bin/bash
# Hash/signature/extraction never succeed for the dummy package fixture.
if [[ "${0##*/}" == flock ]]; then exit 0; fi
exit 1
SCRIPT
done
chmod +x "$fake_bin/"*

run_case() {
  local expected="$1" label="$2" result=0
  shift 2
  "$@" >"$test_root/out" 2>"$test_root/err" || result=$?
  if [[ "$result" != "$expected" ]]; then
    printf 'not ok - %s: exit %s, expected %s\n' "$label" "$result" "$expected" >&2
    cat "$test_root/out" "$test_root/err" >&2
    exit 1
  fi
  printf 'ok - %s\n' "$label"
}

run_wrapper() {
  env PATH="$fake_bin:/usr/bin:/bin" \
    FMARCH_PROOF_TOOLCHAIN_ROOT="$test_root/toolchain" \
    FMARCH_PROOF_PACKAGE_CACHE="$test_root/packages" \
    /bin/bash "$proof_script" "$@"
}

run_case 64 'missing command is rejected' run_wrapper
run_case 0 'qualified system runtime preserves arguments, PATH, and activation' \
  env PATH="$fake_bin:/usr/bin:/bin" TEST_SYSTEM_NODE_VERSION=v26.9.0 \
    TEST_SYSTEM_NPM_VERSION=12.0.2 FMARCH_PROOF_TOOLCHAIN_ROOT=unused \
    /bin/bash "$proof_script" /bin/bash -c \
    '[[ "$FMARCH_PROOF_NODE_ACTIVE" == 1 && "$PATH" == "$1" && "$2" == "argument with spaces" && "$3" == "literal * dollar \$" ]]' \
    test "$fake_bin:/usr/bin:/bin" 'argument with spaces' 'literal * dollar $'
run_case 37 'wrapped command exit status is preserved' \
  env PATH="$fake_bin:/usr/bin:/bin" TEST_SYSTEM_NODE_VERSION=v26.9.0 \
    TEST_SYSTEM_NPM_VERSION=12.0.2 /bin/bash "$proof_script" /bin/bash -c 'exit 37'
run_case 78 'missing cached archives fail closed' run_wrapper /bin/true
[[ $(cat "$test_root/err") == *'authenticated cached package is unavailable'* ]]

mkdir -p "$test_root/packages"
touch "$test_root/packages/nodejs-26.9.0-1-x86_64_v4.pkg.tar.zst" \
  "$test_root/packages/nodejs-26.9.0-1-x86_64_v4.pkg.tar.zst.sig"
run_case 78 'unverified archive cannot provision a runtime' run_wrapper /bin/true
[[ $(cat "$test_root/err") == *'cached package digest mismatch'* ]]

runtime_root="$test_root/toolchain/node-26.9.0-npm-12.0.2"
mkdir -p "$runtime_root/usr/bin" "$runtime_root/usr/lib/node_modules/npm/bin"
printf 'retained\n' >"$runtime_root/unexpected"
run_case 78 'unexpected existing runtime is preserved' run_wrapper /bin/true
[[ $(cat "$runtime_root/unexpected") == retained && ! -e "$runtime_root/.fmarch-proof-node" ]]

cat >"$runtime_root/.fmarch-proof-node" <<'MANIFEST'
fmarch-proof-node-v1
nodejs-26.9.0-1-x86_64_v4.pkg.tar.zst 53db52467e9aea840db61566716d10a0ad8bfb92bd229b518fdb3b529c6ca38f
npm-12.0.2-1-any.pkg.tar.zst a4a1c92be2d9a92a2f7251fc09181678c115ab945c0cfb8d3a98afe4e52ebba0
MANIFEST
cat >"$runtime_root/usr/bin/node" <<'SCRIPT'
#!/bin/bash
if [[ "$1" == --version ]]; then
  printf '%s\n' "${TEST_ISOLATED_NODE_VERSION:-v26.9.0}"
else
  [[ "$NODE_PATH" == /usr/lib/node_modules ]] || exit 9
  printf '%s\n' "${TEST_ISOLATED_NPM_VERSION:-12.0.2}"
fi
SCRIPT
cat >"$runtime_root/usr/lib/node_modules/npm/bin/npm-cli.js" <<'SCRIPT'
#!/bin/bash
printf '12.0.2\n'
SCRIPT
cp "$runtime_root/usr/lib/node_modules/npm/bin/npm-cli.js" "$runtime_root/usr/lib/node_modules/npm/bin/npx-cli.js"
chmod +x "$runtime_root/usr/bin/node" "$runtime_root/usr/lib/node_modules/npm/bin/"*
ln -s ../lib/node_modules/npm/bin/npm-cli.js "$runtime_root/usr/bin/npm"
ln -s ../lib/node_modules/npm/bin/npx-cli.js "$runtime_root/usr/bin/npx"
run_case 0 'isolated runtime takes PATH precedence and scopes host npm dependencies' \
  run_wrapper /bin/bash -c \
    '[[ "$(command -v node)" == "$1/usr/bin/node" && "$(npm --version)" == 12.0.2 && "$FMARCH_PROOF_NODE_ACTIVE" == 1 && "$NODE_PATH" == /usr/lib/node_modules && "$2" == "argument with spaces" ]]' \
    test "$runtime_root" 'argument with spaces'
run_case 78 'wrong isolated Node version cannot execute the requested command' \
  env TEST_ISOLATED_NODE_VERSION=v26.10.0 PATH="$fake_bin:/usr/bin:/bin" \
    FMARCH_PROOF_TOOLCHAIN_ROOT="$test_root/toolchain" \
    /bin/bash "$proof_script" /usr/bin/touch "$test_root/should-not-exist"
[[ ! -e "$test_root/should-not-exist" ]]
run_case 78 'wrong isolated npm version cannot execute the requested command' \
  env TEST_ISOLATED_NPM_VERSION=12.1.0 PATH="$fake_bin:/usr/bin:/bin" \
    FMARCH_PROOF_TOOLCHAIN_ROOT="$test_root/toolchain" \
    /bin/bash "$proof_script" /usr/bin/touch "$test_root/should-not-exist"
[[ ! -e "$test_root/should-not-exist" ]]
rm "$runtime_root/usr/bin/npm"
ln -s /usr/lib/node_modules/npm/bin/npm-cli.js "$runtime_root/usr/bin/npm"
run_case 78 'absolute npm link cannot escape the isolated runtime' run_wrapper /bin/true
[[ $(readlink "$runtime_root/usr/bin/npm") == /usr/lib/node_modules/npm/bin/npm-cli.js ]]
printf 'proof Node wrapper tests passed\n'
