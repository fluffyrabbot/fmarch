import assert from "node:assert/strict";
import { test } from "node:test";
import {
  productionFeatureSourceTargetFromReadiness,
  productionFeatureSourceTargetsByCheckIdFromReadiness,
} from "./dev_test_game_production_feature_readiness_sources.mjs";
import {
  identityFeatureSpineSourceCheckId,
  identityFeatureSpineTargetRows,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

const browserProofCommand =
  "npm run test:dev-test-game-core-live:local";
const coreLoopAdminProofCommand =
  "npm run test:dev-test-game-core-loop-admin-proof";
const hardeningAdminProofCommand =
  "npm run test:dev-test-game-hardening-admin-proof";
const identityAdminProofCommand =
  "npm run test:dev-test-game-identity-admin-proof";
const rerunCommands = Object.freeze({
  "local-core-loop-proof": coreLoopAdminProofCommand,
  "local-hardening-proof": hardeningAdminProofCommand,
  "local-identity-adapter-proof": identityAdminProofCommand,
});
const coreLoopRoleUrl = localAdminAuditRoleUrl(localAdminAuditIds.coreLoop);
const hardeningRoleUrl = localAdminAuditRoleUrl(localAdminAuditIds.hardening);
const identityAdapterRoleUrl = localAdminAuditRoleUrl(
  localAdminAuditIds.identityAdapter,
);

test("production feature readiness sources derive every available source target", () => {
  const sourceTargets = productionFeatureSourceTargetsByCheckIdFromReadiness(
    readinessFixture(),
    {
      defaultBrowserProofCommand: browserProofCommand,
      defaultRerunCommandBySourceCheckId: rerunCommands,
    },
  );

  assert.deepEqual(Object.keys(sourceTargets), [
    "local-core-loop-proof",
    "local-hardening-proof",
    "local-identity-adapter-proof",
  ]);
  assert.equal(sourceTargets["local-core-loop-proof"].roleUrlId, "d02-n02-host");
  assert.equal(
    sourceTargets["local-hardening-proof"].roleUrlHrefs[
      "replacement-stale-conflict-message"
    ],
    "http://127.0.0.1:5173/g/game-a/host",
  );
  assert.deepEqual(
    sourceTargets["local-hardening-proof"].browserWorkbench,
    {
      status: "passed",
      route: "/g/game-a/host",
      roleUrl: "http://127.0.0.1:5173/g/game-a/host",
      roleSurface: "hardening-host",
      featureSlotId: "replacement-stale-conflict-message",
      requiredEvidence:
        "Seeded hardening host role URL opens /g/game-a/host in the browser proof before replacement-stale-conflict-message recovery is trusted.",
    },
  );
  assert.equal(
    sourceTargets[identityFeatureSpineSourceCheckId].rerunCommand,
    identityAdminProofCommand,
  );
  assert.deepEqual(
    {
      sourceCheckId: sourceTargets[identityFeatureSpineSourceCheckId]
        .sourceCheckId,
      cycleId: sourceTargets[identityFeatureSpineSourceCheckId].cycleId,
      roleUrlId: sourceTargets[identityFeatureSpineSourceCheckId].roleUrlId,
      checkpointId:
        sourceTargets[identityFeatureSpineSourceCheckId].checkpointId,
    },
    {
      sourceCheckId: identityFeatureSpineSourceCheckId,
      cycleId: identityFeatureSpineTargetRows.identityAdapter.cycleId,
      roleUrlId: identityFeatureSpineTargetRows.identityAdapter.roleUrlId,
      checkpointId: identityFeatureSpineTargetRows.identityAdapter.checkpointId,
    },
  );
});

test("production feature readiness source target fails closed for missing rows", () => {
  assert.equal(
    productionFeatureSourceTargetFromReadiness(
      { localDevelopmentSpine: { checks: [] } },
      "local-core-loop-proof",
    ),
    null,
  );
  assert.equal(
    productionFeatureSourceTargetFromReadiness(
      {
        localDevelopmentSpine: {
          checks: [
            {
              id: "local-identity-adapter-proof",
              adminRoleSurface: {
                detailRoleUrl: identityAdapterRoleUrl,
                visibleChecks: ["account-login"],
              },
            },
          ],
        },
      },
      "local-identity-adapter-proof",
      {
        defaultBrowserProofCommand: browserProofCommand,
        defaultRerunCommandBySourceCheckId: {},
      },
    ),
    null,
  );
});

function readinessFixture() {
  return {
    localDevelopmentSpine: {
      checks: [
        {
          id: "local-core-loop-proof",
          spineTargets: {
            detailRoleUrl: coreLoopRoleUrl,
            defaultCycleId: "d02-n02",
            defaultRoleUrlId: "d02-n02-host",
            defaultRoleUrl: "http://127.0.0.1:5173/g/game-b/host",
            defaultCheckpointId: "d02-n02-d02-vote-open",
            browserProofCommand,
            cycleIds: ["d02-n02"],
            roleUrlIds: ["d02-n02-host"],
            checkpointIds: ["d02-n02-d02-vote-open"],
            recoveryHookIds: [],
            visibleAdminCheckIds: ["host-lifecycle-control"],
            roleUrlHrefs: {
              "d02-n02-host": "http://127.0.0.1:5173/g/game-b/host",
            },
          },
        },
        {
          id: "local-hardening-proof",
          spineTargets: {
            detailRoleUrl: hardeningRoleUrl,
            defaultCycleId: "hardening-stale-conflict",
            defaultRoleUrlId: "replacement-stale-conflict-message",
            defaultRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
            defaultCheckpointId: "replacement-stale-conflict-message",
            browserProofCommand,
            browserWorkbench: {
              status: "passed",
              route: "/g/game-a/host",
              roleUrl: "http://127.0.0.1:5173/g/game-a/host",
              roleSurface: "hardening-host",
              featureSlotId: "replacement-stale-conflict-message",
              requiredEvidence:
                "Seeded hardening host role URL opens /g/game-a/host in the browser proof before replacement-stale-conflict-message recovery is trusted.",
            },
            cycleIds: ["hardening-stale-conflict"],
            roleUrlIds: ["replacement-stale-conflict-message"],
            checkpointIds: ["replacement-stale-conflict-message"],
            recoveryHookIds: [],
            visibleAdminCheckIds: ["replacement-stale-conflict-message"],
            roleUrlHrefs: {
              "replacement-stale-conflict-message":
                "http://127.0.0.1:5173/g/game-a/host",
            },
          },
        },
        {
          id: "local-identity-adapter-proof",
          adminRoleSurface: {
            detailRoleUrl: identityAdapterRoleUrl,
            visibleChecks: ["account-login"],
          },
        },
      ],
    },
  };
}
