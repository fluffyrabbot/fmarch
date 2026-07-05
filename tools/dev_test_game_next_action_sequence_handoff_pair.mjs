import {
  hostedIdentityNextActionAdminProofPath,
  hostedIdentityNextActionPath,
  nextActionAdminProofPath,
  nextActionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  hostedIdentityTerminalReceiptArtifactCase,
  terminalRefreshAdminProofBatchLabel,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";

export function devTestGameNextActionSequenceHandoffPair() {
  return {
    id: "next-action-sequence-handoff",
    status: "passed",
    proofBoundary:
      "Local terminal receipt pairing for the canonical default next-action sequence blocker and the opt-in hosted identity predicate. It proves both admin browser surfaces were generated and kept separate; it does not prove live hosted identity traffic, release readiness, or production readiness.",
    defaultSequenceBlocker: {
      id: "default-sequence-blocker",
      label: "Default sequence blocker",
      status: "passed",
      proofId: "next-action",
      nextActionPath,
      adminProofPath: nextActionAdminProofPath,
      batchLabel: terminalRefreshAdminProofBatchLabel,
      expectedReason: "sequence-deferred-hosted-identity",
      expectedActionStatus: "blocked",
    },
    hostedIdentityPredicate: {
      id: "opt-in-hosted-identity-predicate",
      label: "Opt-in hosted identity predicate",
      status: "passed",
      proofId: hostedIdentityTerminalReceiptArtifactCase.proofId,
      nextActionPath: hostedIdentityNextActionPath,
      adminProofPath: hostedIdentityNextActionAdminProofPath,
      batchLabel: hostedIdentityTerminalReceiptArtifactCase.batchLabel,
      expectedReason: "release-readiness-unproven",
      expectedActionStatus: "ready",
    },
  };
}

export function assertDevTestGameNextActionSequenceHandoffPair(pair) {
  const expected = devTestGameNextActionSequenceHandoffPair();
  if (JSON.stringify(pair) !== JSON.stringify(expected)) {
    throw new Error("next-action sequence handoff pair drifted");
  }
  return pair;
}
