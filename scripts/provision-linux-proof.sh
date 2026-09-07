#!/usr/bin/env bash
set -euo pipefail
: "${FMARCH_PROOF_TOOLCHAIN_ROOT:?set an external fmarch toolchain root}"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]]
[[ $(node --version) == v26.8.1 && $(npm --version) == 12.0.2 ]]
[[ $(rustc --version) == 'rustc 1.95.0 '* ]]
pgroot="$FMARCH_PROOF_TOOLCHAIN_ROOT/postgresql-16.15-openssl"
if [[ ! -x "$pgroot/bin/pg_ctl" ]]; then
  mkdir -p "$FMARCH_PROOF_TOOLCHAIN_ROOT/source"
  cd "$FMARCH_PROOF_TOOLCHAIN_ROOT/source"
  curl --fail --location --connect-timeout 10 --max-time 180 --output postgresql-16.15.tar.bz2 https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2
  echo 'c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed  postgresql-16.15.tar.bz2' | sha256sum --check
  tar -xjf postgresql-16.15.tar.bz2
  cd postgresql-16.15
  ./configure --prefix="$pgroot" --without-icu --without-readline --with-ssl=openssl
  timeout --signal=TERM --kill-after=30s 20m make -j2
  timeout --signal=TERM --kill-after=30s 5m make install
fi
[[ $("$pgroot/bin/pg_ctl" --version) == 'pg_ctl (PostgreSQL) 16.15' ]]

[[ $("$pgroot/bin/pg_config" --configure) == *--with-ssl=openssl* ]]
