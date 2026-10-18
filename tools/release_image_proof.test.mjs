import assert from 'node:assert/strict';
import test from 'node:test';
import { validateImageEvidence } from './release_image_proof.mjs';

function fixture() {
  const commit = 'a'.repeat(40);
  const expected = { status: 'ok', pack_count: 5, program_count: 5, registry_hash: 'b'.repeat(64), packs: [], programs: [] };
  return { commit, imageId: `sha256:${'c'.repeat(64)}`, expected, first: JSON.stringify(expected), second: JSON.stringify(expected),
    image: { Id: `sha256:${'c'.repeat(64)}`, Os: 'linux', Architecture: 'amd64',
      Config: { User: 'fmarch', Cmd: ['/bin/false'], Labels: { 'org.opencontainers.image.revision': commit } } } };
}

test('accepts attributed immutable runtime with matching deterministic content', () => {
  const input = fixture();
  assert.equal(validateImageEvidence(input).image_id, input.image.Id);
});

test('normalizes Podman inspection IDs while retaining the exact build identity', () => {
  const input = fixture();
  input.image.Id = input.image.Id.slice('sha256:'.length);
  assert.equal(validateImageEvidence(input).image_id, input.imageId);
});

test('rejects wrong source, platform, authority, mutable identity, and content', () => {
  const changes = [
    x => { x.image.Id = 'latest'; },
    x => { x.image.Id = 'c'.repeat(12); },
    x => { x.image.Id = 'd'.repeat(64); },
    x => { x.imageId = 'latest'; },
    x => { x.image.Architecture = 'arm64'; },
    x => { x.image.Config.User = 'root'; },
    x => { x.image.Config.Cmd = ['/usr/local/bin/fmarch-migrate']; },
    x => { x.image.Config.Labels['org.opencontainers.image.revision'] = 'd'.repeat(40); },
    x => { x.expected.registry_hash = 'e'.repeat(64); },
    x => { x.second = '{}'; },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.throws(() => validateImageEvidence(input));
  }
});
