import assert from 'node:assert/strict';
import test from 'node:test';
import { readInfra, validateInfra } from './infra_contract.mjs';

const tree = readInfra();
const MODULE_BUCKETS = 'infra/modules/environment/buckets.tf';
const MODULE_LOCALS = 'infra/modules/environment/locals.tf';
const MODULE_KMS = 'infra/modules/environment/kms.tf';
const MODULE_NETWORK = 'infra/modules/environment/network.tf';
const MODULE_LBS = 'infra/modules/environment/load_balancers.tf';
const MODULE_OUTPUTS = 'infra/modules/environment/outputs.tf';
const DB_TEMPLATE = 'infra/modules/environment/cloud-init/db.yaml.tftpl';
const STAGING = 'infra/environments/staging/main.tf';
const CONFIGURE = 'infra/scripts/configure-db.sh';

function mutated(file, from, to) {
  assert.ok(tree[file]?.includes(from), `${file} no longer contains ${from}`);
  return { ...tree, [file]: tree[file].replace(from, to) };
}

test('the checked-in infrastructure satisfies the contract', () => {
  assert.deepEqual(validateInfra(tree), []);
});

test('each safety invariant rejects its violation', () => {
  const cases = [
    [MODULE_BUCKETS, 'is_file_lock_enabled = true', 'is_file_lock_enabled = false', /lacks Object Lock/],
    [MODULE_BUCKETS, 'mode = "compliance"', 'mode = "governance"', /not compliance mode/],
    [MODULE_BUCKETS, 'days_from_hiding_to_deleting = 1', 'days_from_hiding_to_deleting = 30', /never purges hidden versions/],
    [MODULE_LOCALS, 'purge_hidden = false', 'purge_hidden = true', /subject-journal purges hidden versions/],
    [MODULE_LOCALS, 'bucket = "subject-journal", capabilities = ["listFiles", "readFiles", "writeFiles"]',
      'bucket = "subject-journal", capabilities = ["listFiles", "readFiles", "writeFiles", "deleteFiles"]', /can hide journal entries/],
    [MODULE_LOCALS, '"listFiles", "readFiles", "writeFiles", "deleteFiles"] }', '"listFiles", "readFiles", "writeFiles", "deleteFiles", "bypassGovernance"] }', /bypassGovernance/],
    [MODULE_KMS, 'Action   = ["kms:Decrypt"]', 'Action   = ["kms:Decrypt", "kms:Encrypt"]', /grants/],
    [MODULE_KMS, '"aws:SourceIp"', '"aws:SourceVpc"', /lacks "aws:SourceIp"/],
    [MODULE_KMS, '"kms:EncryptionContext:fmarch:purpose"', '"kms:EncryptionContext:other"', /fmarch:purpose/],
    [STAGING, 'enforced = true\n    }\n\n    plan', 'enforced = false\n    }\n\n    plan', /does not enforce state encryption/],
    [DB_TEMPLATE, '${ssh_public_key}', '${db_owner_password}', /non-allowlisted db_owner_password/],
    [MODULE_NETWORK, 'port        = "22"', 'port        = "5432"', /more than operator SSH/],
    [MODULE_LBS, 'enable_public_interface = false', 'enable_public_interface = true', /public interface/],
    [MODULE_OUTPUTS, '    secret = key.application_key\n  } }\n  sensitive = true', '    secret = key.application_key\n  } }', /without sensitive/],
    [CONFIGURE, 'repo1-s3-key-secret=$backup_key_secret', 'repo1-s3-key-secret=$(value .bucket_writer_keys.pgbackrest.secret)', /outside an assignment/],
  ];
  for (const [file, from, to, expected] of cases) {
    const issues = validateInfra(mutated(file, from, to)).join('\n');
    assert.match(issues, expected, `${file}: ${from} -> ${to}`);
  }
});

test('the bucket set is exactly the RFC set', () => {
  const issues = validateInfra(mutated(MODULE_LOCALS, '    pgbackrest = {', '    vault = {\n      lock_days    = var.backup_lock_days\n      purge_hidden = true\n    }\n    pgbackrest = {'));
  assert.match(issues.join('\n'), /bucket set/);
});
