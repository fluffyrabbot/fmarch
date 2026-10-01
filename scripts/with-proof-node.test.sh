#!/usr/bin/env bash
# Bounded fake-runtime checks: no package downloads, host mutations, or builds.
set -euo pipefail
# npm reaches this fixture through Node, whose descendants inherit the private
# loader scope. Each fake-runtime case supplies its own loader environment.
unset LD_LIBRARY_PATH
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
printf '%s\n' "${TEST_SYSTEM_NPM_VERSION:-12.2.0}"
SCRIPT
cat >"$fake_bin/uname" <<'SCRIPT'
#!/bin/bash
if [[ "$1" == -s ]]; then printf 'Linux\n'; else printf 'x86_64\n'; fi
SCRIPT
cat >"$fake_bin/flock" <<'SCRIPT'
#!/bin/bash
exit 0
SCRIPT
cat >"$fake_bin/sha256sum" <<'SCRIPT'
#!/bin/bash
# Model only the authenticated archive identities and exact library bytes.
read -r digest file
case "$file" in
  */libsimdjson.so.33.0.0)
    [[ "$digest" == bdfd907d8740acb86b797f6453d81f1d647087e536c2f34fdd07c6d65807d223 && $(cat "$file") == 'pinned fake simdjson' ]] ;;
  */nodejs-26.9.0-1-x86_64_v4.pkg.tar.zst)
    [[ ${TEST_ALLOW_ARCHIVES:-0} == 1 && "$digest" == 53db52467e9aea840db61566716d10a0ad8bfb92bd229b518fdb3b529c6ca38f ]] ;;
  */npm-12.0.2-1-any.pkg.tar.zst)
    [[ ${TEST_ALLOW_ARCHIVES:-0} == 1 && "$digest" == a4a1c92be2d9a92a2f7251fc09181678c115ab945c0cfb8d3a98afe4e52ebba0 ]] ;;
  */simdjson-1:4.6.11-1.1-x86_64_v4.pkg.tar.zst)
    [[ ${TEST_ALLOW_ARCHIVES:-0} == 1 && "$digest" == a89914e67fa79b0e3329bbbb846b6b9b03da5f32d5d67826d76f1fcc89bacfb7 ]] ;;
  *) exit 1 ;;
esac
SCRIPT
cat >"$fake_bin/pacman-key" <<'SCRIPT'
#!/bin/bash
[[ ${TEST_ALLOW_ARCHIVES:-0} == 1 && ${TEST_REJECT_SIGNATURE:-0} != 1 && "$1" == --verify ]]
SCRIPT
cat >"$fake_bin/bsdtar" <<'SCRIPT'
#!/bin/bash
set -euo pipefail
[[ "$1" == --no-same-owner && "$2" == -xf && "$4" == -C ]]
archive="$3"; destination="$5"
shift 5
case "$archive" in
  */nodejs-*)
    [[ "$*" == usr/bin/node ]]
    mkdir -p "$destination/usr/bin"
    cat >"$destination/usr/bin/node" <<'NODE'
#!/bin/bash
set -euo pipefail
expected_private="$(cd "$(dirname "$0")/../lib/fmarch-node" && pwd -P)"
[[ ${LD_LIBRARY_PATH:-} == "$expected_private" || ${LD_LIBRARY_PATH:-} == "$expected_private:"* ]] || exit 71
case "$1" in
  --version) printf '%s\n' "${TEST_ISOLATED_NODE_VERSION:-v26.9.0}" ;;
  --probe-arguments)
    [[ "$2" == 'argument with spaces' && "$3" == 'literal * dollar $' ]] ;;
  --probe-descendant) exec "$0" --version ;;
  --probe-loader) printf '%s\n' "$LD_LIBRARY_PATH" ;;
  --probe-exit) exit "$2" ;;
  */npm-cli.js|*/npx-cli.js|*/npm|*/npx)
    [[ "$NODE_PATH" == /usr/lib/node_modules ]] || exit 72
    printf '%s\n' "${TEST_ISOLATED_NPM_VERSION:-12.0.2}" ;;
  *) exit 73 ;;
esac
NODE
    chmod +x "$destination/usr/bin/node" ;;
  */npm-*)
    [[ "$*" == usr/lib/node_modules/npm ]]
    mkdir -p "$destination/usr/lib/node_modules/npm/bin"
    for name in npm-cli.js npx-cli.js; do
      printf '#!/usr/bin/env node\n' >"$destination/usr/lib/node_modules/npm/bin/$name"
      chmod +x "$destination/usr/lib/node_modules/npm/bin/$name"
    done ;;
  */simdjson-*)
    [[ "$*" == '--strip-components 2 usr/lib/libsimdjson.so.33 usr/lib/libsimdjson.so.33.0.0' ]]
    printf '%s\n' "${TEST_SIMDJSON_CONTENT:-pinned fake simdjson}" >"$destination/libsimdjson.so.33.0.0"
    ln -s libsimdjson.so.33.0.0 "$destination/libsimdjson.so.33" ;;
  *) exit 74 ;;
esac
SCRIPT
# The editing Mac's mv lacks GNU -T. Fake only that installation publication.
cat >"$fake_bin/mv" <<'SCRIPT'
#!/bin/bash
if [[ "$1" == -Tn ]]; then
  shift
  if [[ "$1" == -- ]]; then shift; fi
  [[ ! -e "$2" ]] || exit 0
  exec /bin/mv "$1" "$2"
fi
exec /bin/mv "$@"
SCRIPT
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
run_case 78 'missing cached archives fail closed' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'authenticated cached package is unavailable'* ]]
mkdir -p "$test_root/packages"
for package in nodejs-26.9.0-1-x86_64_v4.pkg.tar.zst npm-12.0.2-1-any.pkg.tar.zst simdjson-1:4.6.11-1.1-x86_64_v4.pkg.tar.zst; do
  touch "$test_root/packages/$package" "$test_root/packages/$package.sig"
done
run_case 78 'unverified archive cannot provision a runtime' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'cached package digest mismatch'* ]]
export TEST_ALLOW_ARCHIVES=1
run_case 78 'invalid package signatures fail closed' env TEST_REJECT_SIGNATURE=1 \
  PATH="$fake_bin:/usr/bin:/bin" FMARCH_PROOF_TOOLCHAIN_ROOT="$test_root/toolchain" \
  FMARCH_PROOF_PACKAGE_CACHE="$test_root/packages" /bin/bash "$proof_script" /usr/bin/true
[[ $(cat "$test_root/err") == *'cached package signature verification failed'* ]]

legacy_root="$test_root/toolchain/node-26.9.0-npm-12.0.2"
mkdir -p "$legacy_root"
printf 'retained v1\n' >"$legacy_root/evidence"
runtime_root="$test_root/toolchain/node-26.9.0-npm-12.0.2-v2"
run_case 0 'authenticated archives provision a separate v2 runtime' run_wrapper /usr/bin/true
[[ $(cat "$legacy_root/evidence") == 'retained v1' ]]
[[ $(head -n 1 "$runtime_root/.fmarch-proof-node") == fmarch-proof-node-v2 ]]
private_library="$(cd "$runtime_root/usr/lib/fmarch-node" && pwd -P)"
[[ $(readlink "$private_library/libsimdjson.so.33") == libsimdjson.so.33.0.0 && ! -e "$private_library/libsimdjson.so" ]]
run_case 0 'isolated runtime takes PATH precedence and scopes host npm dependencies' \
  run_wrapper /bin/bash -c \
    '[[ "$(command -v node)" == "$1/usr/bin/node" && "$(npm --version)" == 12.0.2 && "$FMARCH_PROOF_NODE_ACTIVE" == 1 && "$NODE_PATH" == /usr/lib/node_modules && -z ${LD_LIBRARY_PATH+x} ]]' \
    test "$runtime_root"
run_case 0 'Node shim preserves arguments' run_wrapper node --probe-arguments 'argument with spaces' 'literal * dollar $'
run_case 39 'Node shim preserves binary exit status' run_wrapper node --probe-exit 39
run_case 0 'direct real-Node descendants inherit the private loader scope' run_wrapper node --probe-descendant
[[ $(cat "$test_root/out") == v26.9.0 ]]
run_case 0 'private library precedes inherited paths without contaminating the outer shell' \
  env LD_LIBRARY_PATH=/existing/proof/library PATH="$fake_bin:/usr/bin:/bin" \
    FMARCH_PROOF_TOOLCHAIN_ROOT="$test_root/toolchain" /bin/bash "$proof_script" /bin/bash -c \
    '[[ "$LD_LIBRARY_PATH" == /existing/proof/library && "$(node --probe-loader)" == "$1:/existing/proof/library" && "$LD_LIBRARY_PATH" == /existing/proof/library ]]' \
    test "$private_library"

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

mv "$runtime_root/usr/libexec" "$test_root/libexec-preserved"
ln -s "$test_root/libexec-preserved" "$runtime_root/usr/libexec"
run_case 78 'linked runtime parents cannot redirect shim execution' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'missing or unsafe isolated runtime directory'* ]]
rm "$runtime_root/usr/libexec"
mv "$test_root/libexec-preserved" "$runtime_root/usr/libexec"
printf 'unrelated library\n' >"$private_library/libcrypto.so.3"
run_case 78 'private scope cannot introduce unrelated library overrides' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'unexpected private Node library entry'* ]]
rm "$private_library/libcrypto.so.3"
mv "$private_library/libsimdjson.so.33.0.0" "$test_root/simdjson-preserved"
run_case 78 'missing private library fails without replacing the runtime' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'missing or unsafe private simdjson library'* ]]
printf 'tampered\n' >"$private_library/libsimdjson.so.33.0.0"
run_case 78 'tampered private library fails admission' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'private simdjson library digest mismatch'* ]]
run_case 78 'owned runtime already on PATH still receives integrity admission' \
  env PATH="$runtime_root/usr/bin:$fake_bin:/usr/bin:/bin" \
    FMARCH_PROOF_TOOLCHAIN_ROOT="$test_root/toolchain" /bin/bash "$proof_script" /usr/bin/true
[[ $(cat "$test_root/err") == *'private simdjson library digest mismatch'* ]]

mv "$test_root/simdjson-preserved" "$private_library/libsimdjson.so.33.0.0"
rm "$private_library/libsimdjson.so.33"
ln -s /usr/lib/libsimdjson.so.34 "$private_library/libsimdjson.so.33"
run_case 78 'private library cannot alias the incompatible system ABI' run_wrapper /usr/bin/true
rm "$private_library/libsimdjson.so.33"
ln -s libsimdjson.so.33.0.0 "$private_library/libsimdjson.so.33"
cp "$runtime_root/usr/bin/node" "$test_root/shim-preserved"
printf '\n# unexpected shim modification\n' >>"$runtime_root/usr/bin/node"
run_case 78 'unexpected Node shim is preserved and rejected' run_wrapper /usr/bin/true
[[ $(cat "$test_root/err") == *'unexpected isolated Node shim'* ]]
mv "$test_root/shim-preserved" "$runtime_root/usr/bin/node"
rm "$runtime_root/usr/bin/npm"
ln -s /usr/lib/node_modules/npm/bin/npm-cli.js "$runtime_root/usr/bin/npm"
run_case 78 'absolute npm link cannot escape the isolated runtime' run_wrapper /usr/bin/true
[[ $(readlink "$runtime_root/usr/bin/npm") == /usr/lib/node_modules/npm/bin/npm-cli.js ]]
printf 'proof Node wrapper tests passed\n'
