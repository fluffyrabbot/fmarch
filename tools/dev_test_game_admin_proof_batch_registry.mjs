export function defineAdminProofBatchRegistry(batchSpecs, options = {}) {
  const specs = Array.isArray(batchSpecs) ? batchSpecs : [];
  if (specs.length === 0) {
    throw new Error("admin proof batch registry requires at least one batch");
  }
  const seenScripts = new Set();
  return Object.freeze(
    specs.map((spec) => {
      assertRequiredText(spec?.label, "label");
      assertRequiredText(spec?.script, "script");
      assertRequiredText(spec?.reason, "reason");
      if (seenScripts.has(spec.script)) {
        throw new Error(`admin proof batch script is duplicated: ${spec.script}`);
      }
      seenScripts.add(spec.script);
      const proofIds = assertProofIds(spec);
      const artifactPaths = artifactPathsForSpec({
        spec,
        proofIds,
        artifactPathForProofId: options.artifactPathForProofId,
      });
      return Object.freeze({
        ...spec,
        proofIds,
        artifactPaths,
      });
    }),
  );
}

export function adminProofBatchStatusText(batch) {
  assertRequiredText(batch?.label, "label");
  const caseCount = Number(batch?.caseCount ?? batch?.proofIds?.length);
  if (!Number.isInteger(caseCount) || caseCount < 0) {
    throw new Error(`admin proof batch ${batch.label} has invalid case count`);
  }
  return `${batch.label} passed ${caseCount} cases shared frontend shared chromium`;
}

export function adminProofBatchIdFromLabel(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function assertRequiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`admin proof batch requires ${field}`);
  }
}

function assertProofIds(spec) {
  if (!Array.isArray(spec.proofIds) || spec.proofIds.length === 0) {
    throw new Error(`admin proof batch ${spec.label} requires proof ids`);
  }
  const seen = new Set();
  return Object.freeze(
    spec.proofIds.map((proofId) => {
      assertRequiredText(proofId, "proof id");
      if (seen.has(proofId)) {
        throw new Error(
          `admin proof batch ${spec.label} has duplicate proof id: ${proofId}`,
        );
      }
      seen.add(proofId);
      return proofId;
    }),
  );
}

function artifactPathsForSpec({ spec, proofIds, artifactPathForProofId }) {
  const explicitPaths = spec.artifactPaths;
  if (explicitPaths !== undefined) {
    if (
      !Array.isArray(explicitPaths) ||
      explicitPaths.length !== proofIds.length
    ) {
      throw new Error(
        `admin proof batch ${spec.label} artifact paths must match proof ids`,
      );
    }
    return Object.freeze(
      explicitPaths.map((artifactPath) => {
        assertRequiredText(artifactPath, "artifact path");
        return artifactPath;
      }),
    );
  }
  if (typeof artifactPathForProofId !== "function") {
    throw new Error(
      `admin proof batch ${spec.label} requires artifact paths or a resolver`,
    );
  }
  return Object.freeze(
    proofIds.map((proofId) => {
      const artifactPath = artifactPathForProofId(proofId);
      assertRequiredText(artifactPath, "artifact path");
      return artifactPath;
    }),
  );
}
