#!/usr/bin/env bash
# Configure the PostgreSQL host of one environment from OpenTofu outputs:
# TLS from the private CA, PostgreSQL settings and pg_hba, the schema-owner
# login and database, the pgBackRest repository in B2 with a first full
# backup, the backup timers, and the migrator env file.
#
# Secrets travel over SSH stdin only; none reach command lines or user data.
# Idempotent: rerun after `tofu apply` renews the server certificate.
#
# usage: infra/scripts/configure-db.sh <staging|production>
set -euo pipefail

environment=${1:?usage: configure-db.sh <staging|production>}
case "$environment" in staging | production) ;; *) echo "unknown environment: $environment" >&2; exit 64 ;; esac

infra_root=$(cd "$(dirname "$0")/.." && pwd)
var_file=${FMARCH_INFRA_VAR_FILE:-$HOME/secure/fmarch/$environment/infra.tfvars}
[ -r "$var_file" ] || { echo "missing $var_file" >&2; exit 66; }

outputs=$(tofu -chdir="$infra_root/environments/$environment" output -json -var-file="$var_file" environment)
value() { jq -er "$1" <<<"$outputs"; }

[ "$(value .environment)" = "$environment" ] || { echo "outputs belong to another environment" >&2; exit 65; }

host=$(value .db_host.public_ipv4)
private_ip=$(value .db_host.private_ip)
subnet=$(value .subnet_cidr)
# Read every value up front: a failed assignment aborts under `set -e`,
# whereas a failed substitution inside a heredoc would write an empty secret.
shared_buffers=$(value .db_shared_buffers)
b2_region=$(value .b2_region)
backup_bucket=$(value .buckets.pgbackrest)
backup_key_id=$(value .bucket_writer_keys.pgbackrest.key_id)
backup_key_secret=$(value .bucket_writer_keys.pgbackrest.secret)
backup_cipher=$(value .pgbackrest_cipher_pass)
owner_password=$(value .database_authority.owner_password)
instance_id=$(value .database_authority.instance_id)
application_secret=$(value .database_authority.application_secret)
key_admin_secret=$(value .database_authority.key_admin_secret)
authority_revision=$(value .database_authority.revision)
pg_ca_cert=$(value .pg_ca_cert)
pg_server_cert=$(value .pg_server_tls.cert)
pg_server_key=$(value .pg_server_tls.key)
pg_etc=/etc/postgresql/16/main

ssh_opts=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes)
# Remote commands are deliberately expanded locally; they carry no secrets.
# shellcheck disable=SC2029
remote() { ssh "${ssh_opts[@]}" "deploy@$host" "$@"; }

# put MODE OWNER:GROUP PATH < content
# The file is created with its final mode and owner before any byte lands.
put() {
  local mode=$1 owner=$2 path=$3
  remote "sudo install -m $mode -o ${owner%%:*} -g ${owner##*:} /dev/null '$path' && sudo tee '$path' >/dev/null"
}

echo "waiting for cloud-init on $host"
remote 'sudo cloud-init status --wait >/dev/null'
remote "mountpoint -q /var/lib/postgresql && test -d /var/lib/postgresql/16/main" \
  || { echo "PGDATA is not on the attached volume" >&2; exit 70; }

echo "installing TLS material"
remote 'sudo install -d -m 0750 -o root -g postgres /etc/fmarch/pg-tls'
printf '%s\n' "$pg_ca_cert" | put 0644 root:root /etc/fmarch/pg-tls/ca.crt
printf '%s\n' "$pg_server_cert" | put 0644 root:postgres /etc/fmarch/pg-tls/server.crt
printf '%s\n' "$pg_server_key" | put 0600 postgres:postgres /etc/fmarch/pg-tls/server.key

echo "configuring PostgreSQL"
put 0644 postgres:postgres "$pg_etc/conf.d/fmarch.conf" <<EOF
listen_addresses = 'localhost,$private_ip'
ssl = on
ssl_cert_file = '/etc/fmarch/pg-tls/server.crt'
ssl_key_file = '/etc/fmarch/pg-tls/server.key'
ssl_min_protocol_version = 'TLSv1.3'
password_encryption = 'scram-sha-256'
shared_buffers = '$shared_buffers'
wal_level = replica
max_wal_senders = 5
archive_mode = on
archive_command = 'pgbackrest --stanza=fmarch archive-push %p'
archive_timeout = 60
log_line_prefix = '%m [%p] %q%u@%d '
EOF

put 0640 postgres:postgres "$pg_etc/pg_hba.conf" <<EOF
# Managed by infra/scripts/configure-db.sh.
local   all     postgres                                         peer
local   all     all                                              reject
hostssl fmarch  fmarch_owner,fmarch_application,fmarch_key_admin  $subnet  scram-sha-256
host    all     all                                              0.0.0.0/0  reject
host    all     all                                              ::/0       reject
EOF

echo "configuring pgBackRest"
remote 'sudo install -d -m 0750 -o postgres -g postgres /etc/pgbackrest'
put 0640 postgres:postgres /etc/pgbackrest/pgbackrest.conf <<EOF
[global]
repo1-type=s3
repo1-s3-endpoint=s3.$b2_region.backblazeb2.com
repo1-s3-region=$b2_region
repo1-s3-bucket=$backup_bucket
repo1-s3-key=$backup_key_id
repo1-s3-key-secret=$backup_key_secret
repo1-s3-uri-style=path
repo1-path=/fmarch
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$backup_cipher
repo1-retention-full-type=time
repo1-retention-full=35
repo1-bundle=y
repo1-block=y
compress-type=zst
process-max=2
start-fast=y
log-level-console=info
log-level-file=detail

[fmarch]
pg1-path=/var/lib/postgresql/16/main
EOF

remote 'sudo systemctl restart postgresql@16-main'

echo "creating the schema owner and database"
remote 'sudo -u postgres psql -v ON_ERROR_STOP=1 -q' <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fmarch_owner') THEN
    CREATE ROLE fmarch_owner;
  END IF;
END \$\$;
ALTER ROLE fmarch_owner WITH LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS
  PASSWORD '$owner_password';
SELECT 'CREATE DATABASE fmarch OWNER fmarch_owner'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'fmarch') \gexec
EOF

echo "initialising the backup repository"
remote 'sudo -u postgres pgbackrest --stanza=fmarch stanza-create'
remote 'sudo -u postgres pgbackrest --stanza=fmarch check'
if remote "sudo -u postgres pgbackrest --stanza=fmarch info --output=json" | jq -e '.[0].backup | length == 0' >/dev/null; then
  remote 'sudo -u postgres pgbackrest --stanza=fmarch --type=full backup'
fi
remote 'sudo systemctl enable --now fmarch-pgbackrest-full.timer fmarch-pgbackrest-diff.timer'

echo "writing the migrator env file"
put 0600 deploy:deploy /etc/fmarch/migrator.env <<EOF
# One-shot migrator authority (RFC release step 6). Run with
#   docker run --rm --network host --env-file /etc/fmarch/migrator.env \\
#     -v /etc/fmarch/pg-tls/ca.crt:/etc/fmarch/pg-tls/ca.crt:ro <image@digest> \\
#     fmarch-migrate --operation-id <id>
DATABASE_MIGRATION_URL=postgres://fmarch_owner:$owner_password@$private_ip:5432/fmarch?sslmode=verify-full&sslrootcert=/etc/fmarch/pg-tls/ca.crt
FMARCH_DATABASE_ENVIRONMENT=$environment
FMARCH_DATABASE_INSTANCE_ID=$instance_id
FMARCH_DATABASE_APPLICATION_PASSWORD=$application_secret
FMARCH_DATABASE_KEY_ADMIN_PASSWORD=$key_admin_secret
FMARCH_DATABASE_AUTHORITY_REVISION=$authority_revision
FMARCH_DB_ACQUIRE_TIMEOUT_MS=30000
FMARCH_DB_LOCK_TIMEOUT_MS=60000
FMARCH_DB_STATEMENT_TIMEOUT_MS=300000
FMARCH_DB_OPERATION_TIMEOUT_MS=600000
RUST_LOG=info
EOF

echo "$environment database host configured: $host ($private_ip)"
