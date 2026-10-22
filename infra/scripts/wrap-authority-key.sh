#!/usr/bin/env bash
# Encrypt the subject-authority wrapping key under the environment's KMS key
# (RFC D7). The plaintext stays in operator escrow; only the ciphertext is
# handed to the API. Generates a fresh key when the escrow file is absent
# (a new authority); production cutover reuses the existing key.
#
# The encryption context binds the ciphertext to one environment. The IAM
# policy in infra/modules/environment/kms.tf requires the same context.
#
# usage: infra/scripts/wrap-authority-key.sh <staging|production>
set -euo pipefail
umask 077

environment=${1:?usage: wrap-authority-key.sh <staging|production>}
case "$environment" in staging | production) ;; *) echo "unknown environment: $environment" >&2; exit 64 ;; esac

infra_root=$(cd "$(dirname "$0")/.." && pwd)
secure_dir=$HOME/secure/fmarch/$environment
var_file=${FMARCH_INFRA_VAR_FILE:-$secure_dir/infra.tfvars}
plaintext_file=$secure_dir/subject-authority-wrap.key
ciphertext_file=$secure_dir/subject-authority-wrap.kms

if [ ! -e "$plaintext_file" ]; then
  openssl rand -base64 32 | tr -d '\n' >"$plaintext_file"
  echo "generated a new wrapping key in $plaintext_file; escrow it offline before use"
fi
[ "$(tr -d '\n' <"$plaintext_file" | base64 -d 2>/dev/null | wc -c | tr -d ' ')" = 32 ] \
  || { echo "$plaintext_file is not canonical base64 of 32 bytes" >&2; exit 65; }

key_arn=$(tofu -chdir="$infra_root/environments/$environment" output -json -var-file="$var_file" environment | jq -er .kms_key_arn)

tr -d '\n' <"$plaintext_file" | aws kms encrypt \
  --key-id "$key_arn" \
  --plaintext fileb:///dev/stdin \
  --encryption-context "fmarch:environment=$environment,fmarch:purpose=subject-authority-wrap" \
  --query CiphertextBlob --output text >"$ciphertext_file"

echo "wrote $ciphertext_file (FMARCH_SUBJECT_AUTHORITY_WRAP_KEY_CIPHERTEXT)"
