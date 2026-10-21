// The release acceptance key lets the release coordinator mint short sessions
// for the two staging acceptance principals. Only the release machine holds
// the key (32 random bytes, lowercase hex, in a 0600 file); the coordinator
// deploys its SHA-256 to the staging API, which can verify but never mint it.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const RELEASE_ACCEPTANCE_KEY_DIGEST_VARIABLE = 'FMARCH_RELEASE_ACCEPTANCE_KEY_SHA256';
export const RELEASE_ACCEPTANCE_KEY_HEADER = 'x-fmarch-release-acceptance-key';
const keyShape = /^[0-9a-f]{64}$/u;

export function releaseAcceptanceKeyPath(env = process.env) {
  return path.resolve(env.FMARCH_RELEASE_ACCEPTANCE_KEY_FILE ?? path.join(os.homedir(), 'secure', 'fmarch', 'release-acceptance.key'));
}

export function releaseAcceptanceKeyDigest(key) {
  assert.match(key, keyShape, 'Release acceptance key must be 32 bytes of lowercase hex');
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export async function readReleaseAcceptanceKey(file) {
  let metadata;
  try {metadata = await stat(file);} catch {throw Error(`Release acceptance key ${file} is missing; create it with node tools/release_acceptance_key.mjs --generate`);}
  assert.ok(metadata.isFile() && metadata.size <= 128, `Release acceptance key ${file} is not a key file`);
  assert.equal(metadata.mode & 0o077, 0, `Release acceptance key ${file} must be private (mode 0600)`);
  const key = (await readFile(file, 'utf8')).replace(/\n$/u, '');
  assert.match(key, keyShape, `Release acceptance key ${file} must hold 32 bytes of lowercase hex`);
  return key;
}

export async function generateReleaseAcceptanceKey(file) {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const key = randomBytes(32).toString('hex');
  try {
    await writeFile(file, `${key}\n`, {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error.code === 'EEXIST') throw Error(`Release acceptance key ${file} already exists; it is never overwritten`);
    throw error;
  }
  return releaseAcceptanceKeyDigest(key);
}

async function main(argv) {
  const file = releaseAcceptanceKeyPath();
  if (argv.length === 1 && argv[0] === '--generate') {
    console.log(JSON.stringify({file, sha256: await generateReleaseAcceptanceKey(file)}));
  } else if (argv.length === 1 && argv[0] === '--check') {
    console.log(JSON.stringify({file, sha256: releaseAcceptanceKeyDigest(await readReleaseAcceptanceKey(file))}));
  } else {
    throw Error('Usage: node tools/release_acceptance_key.mjs --generate|--check (key file: FMARCH_RELEASE_ACCEPTANCE_KEY_FILE or ~/secure/fmarch/release-acceptance.key)');
  }
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode = 1;});
}
