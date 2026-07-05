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
