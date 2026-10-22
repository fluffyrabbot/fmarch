#!/usr/bin/env node
// Static safety contract for infra/ (RFC docs/ops/hetzner-kamal-migration.md).
// Runs without OpenTofu or credentials, so it can gate every push.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_BUCKETS = ['media', 'pgbackrest', 'subject-journal', 'subject-keys'];
export const RETAINED_HIDDEN_BUCKETS = ['subject-journal'];
export const TEMPLATE_VARIABLES = ['debian_codename', 'ssh_public_key', 'volume_id'];
export const FORBIDDEN_B2_CAPABILITIES = [
  'bypassGovernance', 'writeFileRetentions', 'writeFileLegalHolds', 'writeBucketRetentions',
  'writeBuckets', 'deleteBuckets', 'writeKeys', 'deleteKeys',
];
const SECRET_REFERENCES = /random_password\.|aws_iam_access_key\.|\.application_key\b|\.secret\b|private_key_pem/;

export function readInfra(base = root) {
  const files = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.terraform') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tf|tftpl|sh)$/.test(entry.name)) files[path.relative(base, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(path.join(base, 'infra'));
  return files;
}

// Return the balanced-brace body of every block whose header matches.
export function blocks(text, header) {
  const found = [];
  const pattern = new RegExp(header.source, 'g');
  for (let match; (match = pattern.exec(text));) {
    const open = text.indexOf('{', match.index + match[0].length - 1);
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}' && --depth === 0) {
        found.push({ name: match[1] ?? match[0], body: text.slice(open + 1, i) });
        break;
      }
    }
  }
  return found;
}

const joined = (files, predicate) => Object.entries(files).filter(([p]) => predicate(p)).map(([, t]) => t).join('\n');
const isModule = p => p.startsWith('infra/modules/environment/') && p.endsWith('.tf');

export function validateInfra(files) {
  const issues = [];
  const report = message => issues.push(message);
  const module = joined(files, isModule);
  const allTf = joined(files, p => p.endsWith('.tf'));

  // Buckets: locked in compliance mode, undeletable, purge rules as designed.
  const environmentBuckets = blocks(module, /resource "b2_bucket" "(\w+)" \{/);
  if (environmentBuckets.length === 0) report('environment module declares no b2_bucket');
  for (const bucket of environmentBuckets) {
    if (!/is_file_lock_enabled\s*=\s*true/.test(bucket.body)) report(`b2_bucket.${bucket.name} lacks Object Lock`);
    if (!/mode\s*=\s*"compliance"/.test(bucket.body)) report(`b2_bucket.${bucket.name} lock is not compliance mode`);
    if (!/prevent_destroy\s*=\s*true/.test(bucket.body)) report(`b2_bucket.${bucket.name} lacks prevent_destroy`);
    if (!/days_from_hiding_to_deleting\s*=\s*1\b/.test(bucket.body)) report(`b2_bucket.${bucket.name} never purges hidden versions`);
  }
  const bucketMap = blocks(module, /\bbuckets = \{/)[0]?.body ?? '';
  const declared = [...bucketMap.matchAll(/^\s{4}([\w-]+) = \{([^}]*)\}/gm)].map(m => ({ name: m[1], body: m[2] }));
  const names = declared.map(b => b.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_BUCKETS)) report(`bucket set ${names.join(',')} != ${REQUIRED_BUCKETS.join(',')}`);
  for (const bucket of declared) {
    if (!/lock_days\s*=\s*var\.\w+/.test(bucket.body)) report(`bucket ${bucket.name} lock period is not a variable`);
    const retains = /purge_hidden\s*=\s*false/.test(bucket.body);
    if (retains !== RETAINED_HIDDEN_BUCKETS.includes(bucket.name)) {
      report(`bucket ${bucket.name} ${retains ? 'retains' : 'purges'} hidden versions contrary to D6/D13`);
    }
  }

  // Keys: no capability that can shorten retention or escape the bucket.
  for (const capability of FORBIDDEN_B2_CAPABILITIES) {
    if (new RegExp(`"${capability}"`).test(allTf)) report(`forbidden B2 capability ${capability}`);
  }
  const journalWriter = module.match(/api-subject-journal\s*=\s*\{[^}]*\}/)?.[0] ?? '';
  if (!journalWriter) report('missing api-subject-journal writer key');
  if (/deleteFiles/.test(journalWriter)) report('subject-journal writer can hide journal entries');
  for (const key of blocks(allTf, /resource "b2_application_key" "(\w+)" \{/)) {
    if (!/bucket_id\s*=/.test(key.body)) report(`b2_application_key.${key.name} is not bucket-scoped`);
  }

  // KMS: decrypt only, IP-pinned, bound to environment and purpose.
  const policy = blocks(module, /resource "aws_iam_user_policy" "(\w+)" \{/);
  if (policy.length !== 1) report(`expected exactly one IAM user policy, found ${policy.length}`);
  for (const { name, body } of policy) {
    const action = body.match(/Action\s*=\s*(\[[^\]]*\])/)?.[1];
    if (action !== '["kms:Decrypt"]') report(`aws_iam_user_policy.${name} grants ${action ?? 'nothing'}`);
    if (/"\*"/.test(body)) report(`aws_iam_user_policy.${name} uses a wildcard`);
    for (const required of ['"aws:SourceIp"', '"kms:EncryptionContext:fmarch:environment"', '"kms:EncryptionContext:fmarch:purpose"']) {
      if (!body.includes(required)) report(`aws_iam_user_policy.${name} lacks ${required}`);
    }
  }
  for (const key of blocks(module, /resource "aws_kms_key" "(\w+)" \{/)) {
    if (!/prevent_destroy\s*=\s*true/.test(key.body)) report(`aws_kms_key.${key.name} lacks prevent_destroy`);
  }

  // State: every root encrypts state and plans before they leave the machine.
  const roots = Object.keys(files).filter(p => /^infra\/(bootstrap|environments\/[\w-]+)\/[^/]+\.tf$/.test(p));
  for (const dir of new Set(roots.map(p => path.dirname(p)))) {
    const text = joined(files, p => path.dirname(p) === dir && p.endsWith('.tf'));
    const encryption = blocks(text, /\bencryption \{/)[0]?.body ?? '';
    for (const part of ['state', 'plan']) {
      const section = blocks(encryption, new RegExp(`\\b${part} \\{`))[0]?.body ?? '';
      if (!/enforced\s*=\s*true/.test(section)) report(`${dir} does not enforce ${part} encryption`);
    }
  }

  // User data: only public, non-secret template inputs.
  for (const [file, text] of Object.entries(files).filter(([p]) => p.endsWith('.tftpl'))) {
    for (const [, variable] of text.matchAll(/\$\{(\w+)\}/g)) {
      if (!TEMPLATE_VARIABLES.includes(variable)) report(`${file} interpolates non-allowlisted ${variable}`);
    }
  }
  for (const call of module.matchAll(/templatefile\([^,]+,\s*\{([^}]*)\}\)/g)) {
    for (const [, key] of call[1].matchAll(/^\s*(\w+)\s*=/gm)) {
      if (!TEMPLATE_VARIABLES.includes(key)) report(`templatefile passes non-allowlisted ${key}`);
    }
  }

  // Public surface: SSH from operator networks only; private LB stays private.
  for (const firewall of blocks(module, /resource "hcloud_firewall" "(\w+)" \{/)) {
    for (const rule of blocks(firewall.body, /\brule \{/)) {
      if (/direction\s*=\s*"in"/.test(rule.body) && !(/port\s*=\s*"22"/.test(rule.body) && /source_ips\s*=\s*var\.operator_cidrs/.test(rule.body))) {
        report(`hcloud_firewall.${firewall.name} admits more than operator SSH`);
      }
    }
  }
  const internal = blocks(module, /resource "hcloud_load_balancer_network" "internal" \{/)[0]?.body ?? '';
  if (!/enable_public_interface\s*=\s*false/.test(internal)) report('internal load balancer has a public interface');

  // Outputs carrying secrets must be sensitive.
  for (const output of blocks(allTf, /output "(\w+)" \{/)) {
    if (SECRET_REFERENCES.test(output.body) && !/sensitive\s*=\s*true/.test(output.body)) {
      report(`output ${output.name} exposes a secret without sensitive = true`);
    }
  }

  // configure-db.sh reads secrets into variables before any heredoc.
  const configure = files['infra/scripts/configure-db.sh'] ?? '';
  if (!configure) report('missing infra/scripts/configure-db.sh');
  for (const line of configure.split('\n').filter(l => l.includes('$(value '))) {
    if (!/^\w+=\$\(value [^)]*\)$/.test(line) && !line.startsWith('[ "$(value .environment)"')) {
      report(`configure-db.sh substitutes a value outside an assignment: ${line.trim()}`);
    }
  }

  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = validateInfra(readInfra());
  for (const issue of issues) console.error(`infra contract: ${issue}`);
  if (issues.length) process.exit(1);
  console.log('infra contract passed');
}
