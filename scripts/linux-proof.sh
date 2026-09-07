#!/usr/bin/env bash
# Repository-owned Linux proof: one shared host lock, isolated resources,
# existing lane DAG and receipts. Never falls back to the editing machine.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ${HOST_HEAVY_BUILD_LOCK_HELD:-0} != 1 ]]; then
  exec python3 scripts/with-heavy-build-lock.py -- bash scripts/linux-proof.sh "$@"
fi
: "${FMARCH_EXTERNAL_BUILD_ROOT:?set the fmarch-only external build root}"
: "${FMARCH_PROOF_TOOLCHAIN_ROOT:?set the pinned toolchain root}"
export FMARCH_DEV_POSTGRES_BIN="$FMARCH_PROOF_TOOLCHAIN_ROOT/postgresql-16.15-openssl/bin"
export PATH="$FMARCH_DEV_POSTGRES_BIN:$PATH"
[[ $(uname -s) == Linux && $(node --version) == v26.8.1 && $(npm --version) == 12.0.2 ]]
[[ $(rustc --version) == 'rustc 1.95.0 '* && $(pg_ctl --version) == 'pg_ctl (PostgreSQL) 16.15' ]]
export CARGO_BUILD_JOBS=2
export FMARCH_DEV_POSTGRES_HOST=127.0.0.1
export FMARCH_DEV_POSTGRES_PORT=15544
export FMARCH_DEV_POSTGRES_DATA="$FMARCH_EXTERNAL_BUILD_ROOT/postgres/data"
export FMARCH_DEV_POSTGRES_LOG="$FMARCH_EXTERNAL_BUILD_ROOT/postgres/server.log"
export DATABASE_URL=postgres://fmarch:fmarch@127.0.0.1:15544/fmarch
bash scripts/check-build-posture.sh --apply
export FMARCH_PROOF_ENVIRONMENT_SHA="$(node tools/linux_proof_environment.mjs)"
node tools/dev_postgres.mjs start
trap 'node tools/dev_postgres.mjs stop' EXIT
npm run proof:lanes -- "$@" --run
