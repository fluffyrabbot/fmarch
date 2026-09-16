import assert from 'node:assert/strict';
import test from 'node:test';

import { loadManifest, MANIFEST_PATH, selectLanes } from './proof_lane_select.mjs';

// Keep source-ownership counterexamples runnable without resolving Cargo metadata.
// The main selector suite imports this module for canonical contract coverage.
const manifest = loadManifest(MANIFEST_PATH);
const liveOwner = manifest.areas.find((area) => area.id === 'frontend:live-projection');
const gameOwner = manifest.areas.find((area) => area.id === 'frontend:game');
const hostOwner = manifest.areas.find((area) => area.id === 'proof:host-console-live-stack');
const livePaths = [
  'frontend/src/lib/app/projection-store.mjs',
  'frontend/src/lib/app/projection-store.test.mjs',
  'frontend/src/lib/app/live-transport.mjs',
  'frontend/src/lib/app/live-transport.test.mjs',
];

test('live projection source and tests retain frontend coverage and arm real host delivery proof', () => {
  assert.deepEqual(liveOwner.paths, livePaths);
  assert.deepEqual(liveOwner.also_triggers, ['frontend:game', 'proof:host-console-live-stack']);
  for (const mode of ['inner', 'push']) {
    for (const source of livePaths) {
      const selection = selectLanes({ changed: [source], manifest, crateGraph: {}, mode });
      assert.deepEqual(selection.unmapped, []);
      assert.deepEqual(selection.touched[0], { id: liveOwner.id, reasons: [source] });
      assert.ok(selection.behavioralAreas.includes(gameOwner.id));
      assert.ok(selection.behavioralAreas.includes(hostOwner.id));
      for (const lane of [...gameOwner.lanes, ...hostOwner.lanes]) {
        assert.ok(selection.laneIds.includes(lane), `${source} must arm ${lane} in ${mode}`);
      }
      assert.ok(selection.laneIds.includes('test:host-console-live-stack-smoke'));
    }
  }
});

test('unrelated neighboring frontend changes do not acquire the host live proof cost', () => {
  for (const mode of ['inner', 'push']) {
    for (const source of [
      'frontend/src/lib/app/phase-theme.mjs',
      'frontend/src/lib/app/reading-checkpoint.mjs',
      'frontend/src/lib/app/app-status-model.mjs',
    ]) {
      const selection = selectLanes({ changed: [source], manifest, crateGraph: {}, mode });
      assert.deepEqual(selection.touched, [{ id: gameOwner.id, reasons: [source] }]);
      for (const lane of gameOwner.lanes) assert.ok(selection.laneIds.includes(lane));
      for (const lane of hostOwner.lanes) {
        assert.ok(!selection.laneIds.includes(lane), `${source} must not arm ${lane} in ${mode}`);
      }
      assert.ok(!selection.behavioralAreas.includes(liveOwner.id));
      assert.ok(!selection.behavioralAreas.includes(hostOwner.id));
    }
  }
});
