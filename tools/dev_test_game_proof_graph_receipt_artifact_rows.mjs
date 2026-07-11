import {
  devTestGameProofGraphAdminProofPath,
  hostedIdentityNextActionAdminProofPath,
  nextActionAdminProofPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  defineAdminProofBatchRegistry,
} from "./dev_test_game_admin_proof_batch_registry.mjs";

export const proofGraphTerminalReceiptParentId =
  "admin-spine-terminal-batches";

export const terminalAdminProofBatchLabel = "Terminal admin proof batch";
export const terminalHostedIdentityNextActionAdminProofBatchLabel =
  "Terminal hosted identity next-action admin proof batch";
export const terminalRefreshAdminProofBatchLabel =
  "Terminal refresh admin proof batch";
export const terminalAdminProofBatchScript = "terminal-admin-proof-batch";
export const terminalHostedIdentityNextActionAdminProofBatchScript =
  "terminal-hosted-identity-next-action-admin-proof-batch";
export const terminalRefreshAdminProofBatchScript =
  "terminal-refresh-admin-proof-batch";
export const terminalAdminProofBatchReason =
  "terminal graph, freshness, and next-action admin surfaces share the generated proof graph inputs";
export const terminalHostedIdentityNextActionAdminProofBatchReason =
  "hosted identity next-action input proves the promoted operator-aware admin rows before the default next-action receipt is restored";
export const terminalRefreshAdminProofBatchReason =
  "freshness and next-action admin surfaces share the refreshed next-action input";

export const hostedIdentityTerminalReceiptArtifactCase =
  terminalReceiptRegistryEntry({
    proofId: "hosted-identity-next-action",
    artifactPath: hostedIdentityNextActionAdminProofPath,
    batchLabel: terminalHostedIdentityNextActionAdminProofBatchLabel,
    terminalGraphEdge: false,
  });

export const terminalProofGraphReceiptRegistry = Object.freeze([
  terminalReceiptRegistryEntry({
    proofId: "proof-graph",
    artifactPath: devTestGameProofGraphAdminProofPath,
    batchLabel: terminalAdminProofBatchLabel,
    terminalGraphEdge: true,
  }),
  terminalReceiptRegistryEntry({
    proofId: "proof-freshness",
    artifactPath: proofFreshnessAdminProofPath,
    batchLabel: terminalAdminProofBatchLabel,
    terminalGraphEdge: true,
  }),
  terminalReceiptRegistryEntry({
    proofId: "next-action",
    artifactPath: nextActionAdminProofPath,
    batchLabel: terminalAdminProofBatchLabel,
    terminalGraphEdge: true,
  }),
  terminalReceiptRegistryEntry({
    proofId: hostedIdentityTerminalReceiptArtifactCase.proofId,
    artifactPath: hostedIdentityTerminalReceiptArtifactCase.artifactPath,
    batchLabel: hostedIdentityTerminalReceiptArtifactCase.batchLabel,
    terminalGraphEdge: false,
  }),
  terminalReceiptRegistryEntry({
    proofId: "proof-freshness",
    artifactPath: proofFreshnessAdminProofPath,
    batchLabel: terminalRefreshAdminProofBatchLabel,
    terminalGraphEdge: false,
  }),
  terminalReceiptRegistryEntry({
    proofId: "next-action",
    artifactPath: nextActionAdminProofPath,
    batchLabel: terminalRefreshAdminProofBatchLabel,
    terminalGraphEdge: false,
  }),
]);

export const terminalProofGraphReceiptBatchRegistry = defineAdminProofBatchRegistry(
  [
    {
      label: terminalAdminProofBatchLabel,
      script: terminalAdminProofBatchScript,
      reason: terminalAdminProofBatchReason,
    },
    {
      label: terminalHostedIdentityNextActionAdminProofBatchLabel,
      script: terminalHostedIdentityNextActionAdminProofBatchScript,
      reason: terminalHostedIdentityNextActionAdminProofBatchReason,
    },
    {
      label: terminalRefreshAdminProofBatchLabel,
      script: terminalRefreshAdminProofBatchScript,
      reason: terminalRefreshAdminProofBatchReason,
    },
  ].map((batch) => {
    const receipts = terminalProofGraphReceiptRegistry.filter(
      (entry) => entry.batchLabel === batch.label,
    );
    return {
      label: batch.label,
      script: batch.script,
      reason: batch.reason,
      proofIds: receipts.map((entry) => entry.proofId),
      artifactPaths: receipts.map((entry) => entry.artifactPath),
      receiptArtifacts: Object.freeze(
        receipts.map((entry) => receiptArtifactFromRegistryEntry(entry)),
      ),
    };
  }),
);

export const terminalProofGraphReceiptArtifacts = Object.freeze(
  terminalProofGraphReceiptRegistry.map((entry) =>
    receiptArtifactFromRegistryEntry(entry),
  ),
);

export const terminalProofGraphEdgeTargetIds = Object.freeze(
  terminalProofGraphReceiptRegistry
    .filter((entry) => entry.terminalGraphEdge)
    .map((entry) => entry.proofId),
);

export const terminalProofGraphUniqueReceiptTargets = Object.freeze(
  uniqueReceiptTargets(terminalProofGraphReceiptRegistry),
);

export function normalizeProofGraphReceiptArtifactRows({
  parentId,
  artifacts,
}) {
  return Object.freeze(
    (Array.isArray(artifacts) ? artifacts : [])
      .map((artifact, index) =>
        normalizeProofGraphReceiptArtifact({
          parentId,
          artifact,
          fallbackSuffix: String(index),
        }),
      )
      .filter(
        (artifact) => artifact.proofId !== "" && artifact.artifactPath !== "",
      )
  );
}

export function proofGraphReceiptArtifactRowIds(proofGraph) {
  return proofGraphReceiptArtifactRowIdsFromNodes(proofGraph?.nodes);
}

export function proofGraphReceiptArtifactRowIdsFromNodes(nodes) {
  return Object.freeze(
    (Array.isArray(nodes) ? nodes : []).flatMap((node) =>
      normalizeProofGraphReceiptArtifactRows({
        parentId: node?.id,
        artifacts: node?.receiptArtifacts,
      }).map((artifact) => artifact.rowId),
    ),
  );
}

export function proofGraphReceiptArtifactRowId({ parentId, artifact }) {
  const batchSuffix = slugIdPart(artifact?.batchLabel);
  return `receipt-artifact:${String(parentId ?? "")}:${String(
    artifact?.proofId ?? "",
  )}:${batchSuffix === "" ? String(artifact?.fallbackSuffix ?? "") : batchSuffix}`;
}

export function proofGraphReceiptArtifactRowStatus(artifact) {
  return `${String(artifact?.proofId ?? "")}:${String(
    artifact?.batchLabel ?? "",
  )}:${String(artifact?.artifactPath ?? "")}`;
}

function slugIdPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function terminalReceiptArtifactCase({
  parentId,
  proofId,
  artifactPath,
  batchLabel,
}) {
  const artifact = Object.freeze({
    proofId,
    artifactPath,
    batchLabel,
  });
  const rowId = proofGraphReceiptArtifactRowId({ parentId, artifact });
  const status = proofGraphReceiptArtifactRowStatus(artifact);
  return Object.freeze({
    ...artifact,
    parentId,
    id: rowId,
    rowId,
    status,
    visibleStatusText: `${rowId}\n${status}`,
  });
}

function terminalReceiptRegistryEntry({
  proofId,
  artifactPath,
  batchLabel,
  terminalGraphEdge,
}) {
  return Object.freeze({
    ...terminalReceiptArtifactCase({
      parentId: proofGraphTerminalReceiptParentId,
      proofId,
      artifactPath,
      batchLabel,
    }),
    terminalGraphEdge,
  });
}

function receiptArtifactFromRegistryEntry(entry) {
  return Object.freeze({
    parentId: entry.parentId,
    id: entry.id,
    rowId: entry.rowId,
    status: entry.status,
    visibleStatusText: entry.visibleStatusText,
    proofId: entry.proofId,
    artifactPath: entry.artifactPath,
    batchLabel: entry.batchLabel,
  });
}

function normalizeProofGraphReceiptArtifact({
  parentId,
  artifact,
  fallbackSuffix,
}) {
  const base = {
    parentId: String(artifact?.parentId ?? parentId ?? ""),
    proofId: String(artifact?.proofId ?? ""),
    artifactPath: String(artifact?.artifactPath ?? ""),
    batchLabel: String(artifact?.batchLabel ?? ""),
    fallbackSuffix,
  };
  const rowId =
    typeof artifact?.rowId === "string" && artifact.rowId.trim() !== ""
      ? artifact.rowId
      : proofGraphReceiptArtifactRowId({
          parentId: base.parentId,
          artifact: base,
        });
  const status =
    typeof artifact?.status === "string" && artifact.status.trim() !== ""
      ? artifact.status
      : proofGraphReceiptArtifactRowStatus(base);
  return Object.freeze({
    parentId: base.parentId,
    id: rowId,
    rowId,
    status,
    visibleStatusText:
      typeof artifact?.visibleStatusText === "string" &&
      artifact.visibleStatusText.trim() !== ""
        ? artifact.visibleStatusText
        : `${rowId}\n${status}`,
    proofId: base.proofId,
    artifactPath: base.artifactPath,
    batchLabel: base.batchLabel,
  });
}

function uniqueReceiptTargets(registry) {
  const seen = new Set();
  const targets = [];
  for (const entry of registry) {
    if (seen.has(entry.proofId)) {
      continue;
    }
    seen.add(entry.proofId);
    targets.push(
      Object.freeze({
        proofId: entry.proofId,
        artifactPath: entry.artifactPath,
      }),
    );
  }
  return targets;
}
