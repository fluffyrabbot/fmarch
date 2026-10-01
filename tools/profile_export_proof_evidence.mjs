import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROFILE_PROOF_LANE = "test:dev-test-game-profile";
export const COMPLETED_EXPORT_PROOF_LANE = "test:dev-test-game-completed-export";
const capabilities = new Map([
  [PROFILE_PROOF_LANE, "product.community.profiles"],
  [COMPLETED_EXPORT_PROOF_LANE, "product.archive.completed-game-export"],
]);

export function profileExportEvidenceContract(laneId, { root = repoRoot, manifest } = {}) {
  assert.ok(capabilities.has(laneId), `unsupported product role proof lane ${laneId}`);
  const source = manifest ?? JSON.parse(readFileSync(path.join(root, "docs/ops/proof-lane-manifest.json"), "utf8"));
  const declarations = source.lanes?.[laneId]?.completion_evidence;
  assert.ok(Array.isArray(declarations) && declarations.length === 1, `${laneId} must declare one completion artifact`);
  const declaration = declarations[0];
  assert.equal(declaration?.capability, capabilities.get(laneId), `${laneId} completion capability differs`);
  assert.match(declaration?.artifact ?? "", /^[a-z0-9][a-z0-9._-]*\.json$/, `${laneId} requires a JSON artifact basename`);
  assert.match(declaration?.proof ?? "", /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, `${laneId} requires a proof identity`);
  return { ...declaration, laneId };
}

function assertBase(evidence, laneId, options) {
  const { env = process.env } = options;
  const contract = profileExportEvidenceContract(laneId, options);
  assert.equal(evidence?.version, 1, "product role proof version differs");
  assert.equal(evidence.proof, contract.proof, "product role proof identity differs");
  assert.equal(evidence.status, "passed", "product role proof did not pass");
  assert.equal(evidence.scope, `local-${contract.proof}`, "product role proof scope differs");
  assert.equal(evidence.releaseReady, false, "local proof must not claim release readiness");
  assert.equal(evidence.productionReady, false, "local proof must not claim production readiness");
  assert.ok(typeof evidence.proofBoundary === "string" && evidence.proofBoundary.trim(), "product role proof boundary is missing");
  assert.equal(evidence.execution?.laneId, laneId, "product role proof belongs to another lane");
  const runner = env.FMARCH_PROOF_LANE_ID !== undefined || env.FMARCH_PROOF_RUN_ID !== undefined;
  if (runner) {
    assert.equal(env.FMARCH_PROOF_LANE_ID, laneId, "product role proof invoked under another lane");
    assert.ok(typeof env.FMARCH_PROOF_RUN_ID === "string" && env.FMARCH_PROOF_RUN_ID.trim(), "runner proof requires a run identity");
    assert.ok(typeof env.FMARCH_PROOF_ARTIFACT_DIR === "string" && env.FMARCH_PROOF_ARTIFACT_DIR.trim(), "runner proof requires an artifact directory");
    assert.equal(evidence.execution.runId, env.FMARCH_PROOF_RUN_ID, "product role proof belongs to another run");
    assert.equal(evidence.execution.databaseLifecycle, "runner-owned-disposable-per-proof-run", "canonical proof must use its runner database");
  } else {
    assert.equal(evidence.execution.runId, null, "standalone proof cannot adopt a runner receipt");
    assert.equal(evidence.execution.databaseLifecycle, "harness-owned-disposable-per-proof-run", "standalone proof must own its disposable database");
  }
  assert.equal(typeof evidence.roleUrl, "string", "product role URL is missing");
  const url = new URL(evidence.roleUrl);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port &&
    !url.username && !url.password && !url.search && !url.hash, "product role URL must identify its local browser surface");
  return url;
}

export function assertProfileProofEvidence(evidence, options = {}) {
  const url = assertBase(evidence, PROFILE_PROOF_LANE, options);
  assert.equal(url.pathname, "/profile/edit", "profile proof must exercise the owner editor");
  for (const stage of ["created", "publicView", "edited", "ownerScope", "privacy"]) {
    assert.equal(evidence[stage]?.status, "passed", `profile ${stage} evidence is incomplete`);
  }
  assert.equal(evidence.created.editorTestId, "profile-editor-surface");
  assert.equal(evidence.publicView.displayName, "Owner Profile");
  assert.match(evidence.edited.expectedRevision, /^(?:0|[1-9][0-9]*)$/u);
  assert.equal(evidence.edited.reloadBio, "Updated public bio.");
  assert.equal(evidence.ownerScope.createSurface, true, "other account reached the owner's profile editor");
  assert.equal(evidence.privacy.ownerVisibility, "private", "owner profile privacy did not persist");
  assert.equal(evidence.privacy.apiStatus, 404, "private profile API must return not found");
  assert.equal(evidence.privacy.unavailable, true, "private profile remained public");
  assert.equal(evidence.privacy.testId, "profile-public-unavailable");
  return evidence;
}

export function assertCompletedExportProofEvidence(evidence, options = {}) {
  const url = assertBase(evidence, COMPLETED_EXPORT_PROOF_LANE, options);
  assert.match(url.pathname, /^\/g\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/host\/export$/, "export proof must exercise the game's host export route");
  const manifest = evidence.manifest;
  assert.equal(manifest?.version, 3, "completed export wire version differs");
  assert.match(manifest.checksum, /^[a-f0-9]{64}$/, "rendered export checksum is invalid");
  assert.equal(manifest.checksum, manifest.apiChecksum, "rendered export checksum differs from the API");
  assert.ok(Number.isSafeInteger(manifest.eventCount) && manifest.eventCount > 0, "export event count is invalid");
  assert.equal(manifest.eventCount, manifest.apiEventCount, "rendered export count differs from the API");
  assert.equal(manifest.completedEventPresent, true, "export lacks game completion");
  assert.equal(manifest.roleResponseStatus, 200, "host export route did not succeed");
  return evidence;
}

export async function readProfileExportProofEvidence(laneId, options = {}) {
  const { root = repoRoot, env = process.env } = options;
  const contract = profileExportEvidenceContract(laneId, options);
  if (env.FMARCH_PROOF_ARTIFACT_DIR !== undefined) {
    assert.ok(typeof env.FMARCH_PROOF_ARTIFACT_DIR === "string" && env.FMARCH_PROOF_ARTIFACT_DIR.trim(), "proof artifact directory must be nonempty");
  }
  const artifactDir = path.resolve(env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, "target", contract.proof));
  const evidencePath = path.join(artifactDir, contract.artifact);
  const metadata = await lstat(evidencePath);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), "product role evidence must be a regular file");
  const [realDirectory, realEvidence] = await Promise.all([realpath(artifactDir), realpath(evidencePath)]);
  assert.equal(path.dirname(realEvidence), realDirectory, "product role evidence escaped its artifact directory");
  const evidence = JSON.parse(await readFile(realEvidence, "utf8"));
  const validate = laneId === PROFILE_PROOF_LANE ? assertProfileProofEvidence : assertCompletedExportProofEvidence;
  validate(evidence, options);
  return { laneId, artifact: contract.artifact, proof: contract.proof, execution: evidence.execution, status: evidence.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, "usage: node tools/profile_export_proof_evidence.mjs LANE_ID");
    console.log(JSON.stringify(await readProfileExportProofEvidence(process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
