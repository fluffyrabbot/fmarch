import {
  hostedIdentityNextActionAdminProofPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export const proofGraphTerminalReceiptParentId =
  "admin-spine-terminal-batches";

export const hostedIdentityTerminalReceiptArtifactCase =
  terminalReceiptArtifactCase({
    parentId: proofGraphTerminalReceiptParentId,
    proofId: "hosted-identity-next-action",
    artifactPath: hostedIdentityNextActionAdminProofPath,
    batchLabel: "Terminal hosted identity next-action admin proof batch",
  });

export function normalizeProofGraphReceiptArtifactRows({
  parentId,
  artifacts,
}) {
  return Object.freeze(
    (Array.isArray(artifacts) ? artifacts : [])
      .map((artifact, index) => ({
        proofId: String(artifact?.proofId ?? ""),
        artifactPath: String(artifact?.artifactPath ?? ""),
        batchLabel: String(artifact?.batchLabel ?? ""),
        fallbackSuffix: String(index),
      }))
      .filter(
        (artifact) => artifact.proofId !== "" && artifact.artifactPath !== "",
      )
      .map((artifact) => {
        const id = proofGraphReceiptArtifactRowId({ parentId, artifact });
        return Object.freeze({
          id,
          rowId: id,
          status: proofGraphReceiptArtifactRowStatus(artifact),
          proofId: artifact.proofId,
          artifactPath: artifact.artifactPath,
          batchLabel: artifact.batchLabel,
        });
      }),
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
    rowId,
    status,
    visibleStatusText: `${rowId}\n${status}`,
  });
}
