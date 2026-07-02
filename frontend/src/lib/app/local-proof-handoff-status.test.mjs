import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostedMatrixHandoffSummary,
  hostedMatrixHandoffSummaryForRoleLink,
  selectedNextActionProofGraphNodeStatus,
  selectedNextActionProofGraphNodeSummary,
} from "./local-proof-handoff-status.mjs";

test("selected next-action graph node summary carries browser-visible status text", () => {
  const nextAction = nextActionFixture();
  const proofGraph = proofGraphFixture();

  assert.deepEqual(
    selectedNextActionProofGraphNodeSummary({ nextAction, proofGraph }),
    {
      id: "admin-proof:hosted-concurrent-race-matrix",
      status: "passed",
      auditId: "local-hosted-concurrent-race-matrix",
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofCommand:
        "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      proofTarget:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      graphProofCommand:
        "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    },
  );
  assert.equal(
    selectedNextActionProofGraphNodeStatus({ nextAction, proofGraph }),
    "passed: npm run test:dev-test-game-hosted-concurrent-race-matrix -> target/dev-test-game/hosted-concurrent-race-matrix.json",
  );
});

test("selected hosted evidence lane graph node summary carries demo proof command", () => {
  const nextAction = {
    nextAction: {
      command: "npm run test:dev-test-game-hosted-evidence-lane-demo-proof",
      unproven: {
        proofTarget:
          "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
        proofGraphNodeId: "admin-proof:hosted-evidence-lane",
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
    },
  };
  const proofGraph = {
    version: 1,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    scope: "local-dev-test-game-proof-graph",
    nodes: [
      {
        id: "admin-proof:hosted-evidence-lane",
        status: "passed",
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
        proofCommand:
          "npm run test:dev-test-game-hosted-evidence-lane-admin-proof",
      },
    ],
  };

  assert.deepEqual(
    selectedNextActionProofGraphNodeSummary({ nextAction, proofGraph }),
    {
      id: "admin-proof:hosted-evidence-lane",
      status: "passed",
      auditId: "local-hosted-evidence-lane",
      roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      proofCommand:
        "npm run test:dev-test-game-hosted-evidence-lane-demo-proof",
      proofTarget: "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
      graphProofCommand:
        "npm run test:dev-test-game-hosted-evidence-lane-admin-proof",
    },
  );
  assert.equal(
    selectedNextActionProofGraphNodeStatus({ nextAction, proofGraph }),
    "passed: npm run test:dev-test-game-hosted-evidence-lane-demo-proof -> target/dev-test-game/hosted-evidence-lane-demo-proof.json",
  );
});

test("selected next-action graph node summary fails closed for missing graph node", () => {
  assert.equal(
    selectedNextActionProofGraphNodeSummary({
      nextAction: nextActionFixture(),
      proofGraph: { ...proofGraphFixture(), nodes: [] },
    }),
    null,
  );
  assert.equal(
    selectedNextActionProofGraphNodeStatus({
      nextAction: nextActionFixture(),
      proofGraph: null,
    }),
    "",
  );
});

test("hosted matrix handoff summary derives destination proof assertions", () => {
  const expected = {
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: "local-hosted-concurrent-race-matrix",
    requiredCheckIds: [
      "hosted-like-api-frontend-target",
      "real-hosted-deployment",
      "player-vote-change",
      "player-night-action",
    ],
    requiredCheckStatuses: {
      "real-hosted-deployment": "unproven",
    },
    requiredUnprovenIds: [
      "hosted-concurrent-race-matrix",
      "remaining-gap-1",
      "remaining-gap-2",
    ],
    requiredReconnectLaneIds: [],
    requiredStaleConflictLaneIds: [],
    requiredRelatedLinkIds: ["local-race-coverage", "local-next-action"],
  };

  assert.deepEqual(
    hostedMatrixHandoffSummary({
      nextAction: nextActionFixture(),
      hostedMatrix: hostedMatrixFixture(),
    }),
    expected,
  );
  assert.deepEqual(
    hostedMatrixHandoffSummaryForRoleLink({
      linkId: "admin-proof:hosted-concurrent-race-matrix",
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      hostedMatrix: hostedMatrixFixture(),
    }),
    expected,
  );
});

function nextActionFixture() {
  return {
    nextAction: {
      command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      unproven: {
        proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
        proofTarget: "target/dev-test-game/hosted-concurrent-race-matrix.json",
        roleUrl:
          "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      },
    },
  };
}

function proofGraphFixture() {
  return {
    version: 1,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    scope: "local-dev-test-game-proof-graph",
    nodes: [
      {
        id: "admin-proof:hosted-concurrent-race-matrix",
        status: "passed",
        roleUrl:
          "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
        proofCommand:
          "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
      },
    ],
  };
}

function hostedMatrixFixture() {
  return {
    evidenceProgress: [
      { id: "hosted-like-api-frontend-target" },
      { id: "real-hosted-deployment" },
    ],
    cells: [{ id: "player-vote-change" }, { id: "player-night-action" }],
    requestedEvidence: { id: "hosted-concurrent-race-matrix" },
    remainingGaps: [{ id: "gap-a" }, { id: "gap-b" }],
    summary: {
      realHostedDeploymentStatus: "unproven",
    },
  };
}
