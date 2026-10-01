#!/usr/bin/env bash
# Select the repository's proof runtime after the worker's login shell. The
# fallback copies authenticated cached packages; it never changes the host.
set -euo pipefail

fail() {
  printf 'with-proof-node: %s\n' "$*" >&2
  exit 78
}

if [[ $# -eq 0 ]]; then
  printf 'usage: bash scripts/with-proof-node.sh COMMAND [ARGS...]\n' >&2
  exit 64
fi

# A qualified ambient runtime needs no package cache or toolchain directory.
if [[ $(command -v node || true) != "${FMARCH_PROOF_TOOLCHAIN_ROOT:-}/node-26.9.0-npm-12.0.2-v2/usr/bin/node" &&
      $(node --version 2>/dev/null || true) == v26.9.0 &&
      $(npm --version 2>/dev/null || true) == 12.0.2 ]]; then
  export FMARCH_PROOF_NODE_ACTIVE=1
  exec "$@"
fi

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] ||
  fail 'the cached fallback requires the canonical x86_64 Linux worker'
[[ ${FMARCH_PROOF_TOOLCHAIN_ROOT:-} == /* ]] ||
  fail 'set FMARCH_PROOF_TOOLCHAIN_ROOT to an absolute owned toolchain directory'

proof_node_root="$FMARCH_PROOF_TOOLCHAIN_ROOT/node-26.9.0-npm-12.0.2-v2"
proof_package_cache="${FMARCH_PROOF_PACKAGE_CACHE:-/var/cache/pacman/pkg}"
node_package=nodejs-26.9.0-1-x86_64_v4.pkg.tar.zst
npm_package=npm-12.0.2-1-any.pkg.tar.zst
simdjson_package=simdjson-1:4.6.11-1.1-x86_64_v4.pkg.tar.zst
node_digest=53db52467e9aea840db61566716d10a0ad8bfb92bd229b518fdb3b529c6ca38f
npm_digest=a4a1c92be2d9a92a2f7251fc09181678c115ab945c0cfb8d3a98afe4e52ebba0
simdjson_digest=a89914e67fa79b0e3329bbbb846b6b9b03da5f32d5d67826d76f1fcc89bacfb7
simdjson_library_digest=bdfd907d8740acb86b797f6453d81f1d647087e536c2f34fdd07c6d65807d223
proof_node_manifest="fmarch-proof-node-v2
$node_package $node_digest
$npm_package $npm_digest
$simdjson_package $simdjson_digest"

# Keep the compatibility library out of the proof command's ambient loader
# path. Node descendants inherit it so process.execPath (the real ELF binary)
# remains executable, while the parent proof shell and its other children keep
# their original loader environment.
proof_node_shim=$(cat <<'SHIM'
#!/bin/bash
set -euo pipefail
node_usr_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
node_private_lib="$node_usr_root/lib/fmarch-node"
if [[ ${LD_LIBRARY_PATH:-} != "$node_private_lib" && ${LD_LIBRARY_PATH:-} != "$node_private_lib:"* ]]; then
  export LD_LIBRARY_PATH="$node_private_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
exec "$node_usr_root/libexec/node" "$@"
SHIM
)

check_runtime() {
  local runtime_root="$1" actual directory entry
  for directory in usr usr/bin usr/libexec usr/lib usr/lib/fmarch-node usr/lib/node_modules usr/lib/node_modules/npm usr/lib/node_modules/npm/bin; do
    [[ -d "$runtime_root/$directory" && ! -L "$runtime_root/$directory" ]] ||
      fail "missing or unsafe isolated runtime directory $runtime_root/$directory; preserve it for inspection"
  done
  [[ -x "$runtime_root/usr/bin/node" && ! -L "$runtime_root/usr/bin/node" &&
     -x "$runtime_root/usr/libexec/node" && ! -L "$runtime_root/usr/libexec/node" &&
     -f "$runtime_root/usr/lib/node_modules/npm/bin/npm-cli.js" && ! -L "$runtime_root/usr/lib/node_modules/npm/bin/npm-cli.js" &&
     -f "$runtime_root/usr/lib/node_modules/npm/bin/npx-cli.js" && ! -L "$runtime_root/usr/lib/node_modules/npm/bin/npx-cli.js" ]] ||
    fail "incomplete isolated runtime at $runtime_root; preserve it for inspection"
  [[ $(cat "$runtime_root/usr/bin/node") == "$proof_node_shim" ]] ||
    fail "unexpected isolated Node shim at $runtime_root; preserve it for inspection"
  local private_library="$runtime_root/usr/lib/fmarch-node"
  [[ -d "$private_library" && ! -L "$private_library" &&
     -f "$private_library/libsimdjson.so.33.0.0" && ! -L "$private_library/libsimdjson.so.33.0.0" &&
     -L "$private_library/libsimdjson.so.33" &&
     $(readlink "$private_library/libsimdjson.so.33") == libsimdjson.so.33.0.0 ]] ||
    fail "missing or unsafe private simdjson library at $runtime_root; preserve it for inspection"
  printf '%s  %s\n' "$simdjson_library_digest" "$private_library/libsimdjson.so.33.0.0" | sha256sum --check --status ||
    fail "private simdjson library digest mismatch at $runtime_root; preserve it for inspection"
  for entry in "$private_library"/* "$private_library"/.[!.]* "$private_library"/..?*; do
    [[ -e "$entry" || -L "$entry" ]] || continue
    [[ "$entry" == "$private_library/libsimdjson.so.33" || "$entry" == "$private_library/libsimdjson.so.33.0.0" ]] ||
      fail "unexpected private Node library entry $entry; preserve it for inspection"
  done
  actual=$("$runtime_root/usr/bin/node" --version 2>&1) ||
    fail "isolated Node cannot execute: $actual"
  [[ "$actual" == v26.9.0 ]] || fail "isolated Node version is $actual, expected v26.9.0"
  # Cachy packages npm dependencies separately. Keep their resolution scoped to
  # this command; other shared libraries and npm dependencies remain host inputs.
  actual=$(PATH="$runtime_root/usr/bin:$PATH" NODE_PATH=/usr/lib/node_modules \
    "$runtime_root/usr/bin/node" "$runtime_root/usr/lib/node_modules/npm/bin/npm-cli.js" --version 2>&1) ||
    fail "isolated npm cannot execute with host packaged dependencies: $actual"
  [[ "$actual" == 12.0.2 ]] || fail "isolated npm version is $actual, expected 12.0.2"
  [[ -L "$runtime_root/usr/bin/npm" &&
     $(readlink "$runtime_root/usr/bin/npm") == ../lib/node_modules/npm/bin/npm-cli.js &&
     -L "$runtime_root/usr/bin/npx" &&
     $(readlink "$runtime_root/usr/bin/npx") == ../lib/node_modules/npm/bin/npx-cli.js ]] ||
    fail "isolated npm/npx links are not relative owned links: $runtime_root"
}

check_installed_runtime() {
  [[ -d "$proof_node_root" && ! -L "$proof_node_root" &&
     -f "$proof_node_root/.fmarch-proof-node" &&
     ! -L "$proof_node_root/.fmarch-proof-node" &&
     $(cat "$proof_node_root/.fmarch-proof-node") == "$proof_node_manifest" ]] ||
    fail "unexpected runtime path $proof_node_root; preserve it for inspection"
  check_runtime "$proof_node_root"
}

if [[ ! -e "$proof_node_root" && ! -L "$proof_node_root" ]]; then
  for command_name in flock sha256sum pacman-key bsdtar; do
    command -v "$command_name" >/dev/null || fail "required cached-package tool is unavailable: $command_name"
  done
  mkdir -p "$FMARCH_PROOF_TOOLCHAIN_ROOT"
  # Serialise cooperating installers and retain the lock file as an owned
  # coordination artifact. Never repair or remove an unexpected runtime path.
  exec 9>"$FMARCH_PROOF_TOOLCHAIN_ROOT/.node-26.9.0-npm-12.0.2-v2.install.lock"
  flock 9
  if [[ ! -e "$proof_node_root" && ! -L "$proof_node_root" ]]; then
    for package_name in "$node_package" "$npm_package" "$simdjson_package"; do
      package_path="$proof_package_cache/$package_name"
      [[ -f "$package_path" && -f "$package_path.sig" ]] ||
        fail "authenticated cached package is unavailable: $package_path (and .sig)"
      if [[ "$package_name" == "$node_package" ]]; then
        package_digest="$node_digest"
      elif [[ "$package_name" == "$npm_package" ]]; then
        package_digest="$npm_digest"
      else
        package_digest="$simdjson_digest"
      fi
      printf '%s  %s\n' "$package_digest" "$package_path" | sha256sum --check --status ||
        fail "cached package digest mismatch: $package_path"
      pacman-key --verify "$package_path.sig" "$package_path" >&2 ||
        fail "cached package signature verification failed: $package_path"
    done

    proof_node_stage=$(mktemp -d "$FMARCH_PROOF_TOOLCHAIN_ROOT/.node-26.9.0-npm-12.0.2-v2.stage.XXXXXX")
    cleanup_stage() { [[ -z "${proof_node_stage:-}" ]] || rm -rf -- "$proof_node_stage"; }
    trap cleanup_stage EXIT
    bsdtar --no-same-owner -xf "$proof_package_cache/$node_package" -C "$proof_node_stage" usr/bin/node ||
      fail 'could not extract the authenticated Node package'
    bsdtar --no-same-owner -xf "$proof_package_cache/$npm_package" -C "$proof_node_stage" usr/lib/node_modules/npm ||
      fail 'could not extract the authenticated npm package'
    mkdir -p "$proof_node_stage/usr/libexec" "$proof_node_stage/usr/lib/fmarch-node"
    mv "$proof_node_stage/usr/bin/node" "$proof_node_stage/usr/libexec/node"
    bsdtar --no-same-owner -xf "$proof_package_cache/$simdjson_package" -C "$proof_node_stage/usr/lib/fmarch-node" --strip-components 2 \
      usr/lib/libsimdjson.so.33 usr/lib/libsimdjson.so.33.0.0 ||
      fail 'could not extract the authenticated simdjson library'
    printf '%s\n' "$proof_node_shim" >"$proof_node_stage/usr/bin/node"
    chmod +x "$proof_node_stage/usr/bin/node"
    # Package links point at /usr. Recreate only these two links inside staging.
    ln -s ../lib/node_modules/npm/bin/npm-cli.js "$proof_node_stage/usr/bin/npm"
    ln -s ../lib/node_modules/npm/bin/npx-cli.js "$proof_node_stage/usr/bin/npx"
    check_runtime "$proof_node_stage"
    printf '%s\n' "$proof_node_manifest" >"$proof_node_stage/.fmarch-proof-node"
    # GNU mv -Tn atomically publishes the directory without replacing an
    # unexpected concurrent destination. A skipped rename leaves staging intact.
    mv -Tn -- "$proof_node_stage" "$proof_node_root"
    [[ ! -d "$proof_node_stage" ]] || fail "runtime destination appeared during installation: $proof_node_root"
    proof_node_stage=
    trap - EXIT
  fi
  exec 9>&-
fi

check_installed_runtime
export PATH="$proof_node_root/usr/bin:$PATH"
export NODE_PATH=/usr/lib/node_modules
export FMARCH_PROOF_NODE_ACTIVE=1
exec "$@"
