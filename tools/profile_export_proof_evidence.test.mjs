import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PROFILE_PROOF_LANE, COMPLETED_EXPORT_PROOF_LANE,
  assertProfileProofEvidence, assertCompletedExportProofEvidence,
  profileExportEvidenceContract, readProfileExportProofEvidence,
} from "./profile_export_proof_evidence.mjs";

const contracts = [
  [PROFILE_PROOF_LANE, "product.community.profiles", "profile-proof.json", "profile-role-proof"],
  [COMPLETED_EXPORT_PROOF_LANE, "product.archive.completed-game-export", "completed-game-export-proof.json", "completed-game-export-role-proof"],
];
const manifest = { lanes: Object.fromEntries(contracts.map(([lane, capability, artifact, proof]) =>
  [lane, { completion_evidence: [{ capability, artifact, proof }] }])) };
const runnerEnvironment = (laneId, directory = "/proof/artifacts") => ({
  FMARCH_PROOF_LANE_ID: laneId, FMARCH_PROOF_RUN_ID: "run-current", FMARCH_PROOF_ARTIFACT_DIR: directory,
});
function passed(laneId, { standalone = false } = {}) {
  const { proof } = profileExportEvidenceContract(laneId, { manifest });
  return {
    version: 1, proof, status: "passed", scope: `local-${proof}`, releaseReady: false, productionReady: false,
    proofBoundary: "Local role browser proof; no hosted release readiness.",
    execution: { laneId, runId: standalone ? null : "run-current", databaseLifecycle: `${standalone ? "harness" : "runner"}-owned-disposable-per-proof-run` },
    roleUrl: laneId === PROFILE_PROOF_LANE ? "http://127.0.0.1:4200/profile/edit" : "http://127.0.0.1:4200/g/00112233-4455-4677-8899-aabbccddeeff/host/export",
    ...(laneId === PROFILE_PROOF_LANE ? {
      created: { status: "passed", editorTestId: "profile-editor-surface" },
      publicView: { status: "passed", displayName: "Owner Profile" },
      edited: { status: "passed", expectedRevision: "4", reloadBio: "Updated public bio." },
      ownerScope: { status: "passed", createSurface: true },
      privacy: { status: "passed", ownerVisibility: "private", apiStatus: 404, unavailable: true, testId: "profile-public-unavailable" },
    } : {
      manifest: { version: 3, checksum: "a".repeat(64), apiChecksum: "a".repeat(64), eventCount: 2, apiEventCount: 2, completedEventPresent: true, roleResponseStatus: 200 },
    }),
  };
}
const validator = lane => lane === PROFILE_PROOF_LANE ? assertProfileProofEvidence : assertCompletedExportProofEvidence;

test("complete profile and export observations validate in canonical and standalone lifecycles", () => {
  for (const [lane] of contracts) {
    validator(lane)(passed(lane), { manifest, env: runnerEnvironment(lane) });
    validator(lane)(passed(lane, { standalone: true }), { manifest, env: {} });
  }
});

test("a passed label cannot conceal foreign, partial, skipped, or overclaimed evidence", () => {
  for (const [lane] of contracts) {
    for (const mutate of [
      e => { e.status = "failed"; }, e => { e.status = "static-render-fallback-passed"; },
      e => { e.version = 2; }, e => { e.proof = "another-proof"; }, e => { e.scope = "hosted"; },
      e => { e.releaseReady = true; }, e => { e.productionReady = true; }, e => { delete e.proofBoundary; },
      e => { delete e.execution; }, e => { e.execution.laneId = "another-lane"; },
      e => { e.execution.runId = "run-previous"; }, e => { e.execution.databaseLifecycle = "harness-owned-disposable-per-proof-run"; },
      e => { e.roleUrl = "https://example.test/profile/edit"; }, e => { e.roleUrl += "?foreign=1"; },
    ]) {
      const evidence = passed(lane); mutate(evidence);
      assert.throws(() => validator(lane)(evidence, { manifest, env: runnerEnvironment(lane) }));
    }
    for (const env of [
      { FMARCH_PROOF_LANE_ID: lane }, { FMARCH_PROOF_RUN_ID: "run-current" },
      { ...runnerEnvironment(lane), FMARCH_PROOF_LANE_ID: "another-lane" },
      { ...runnerEnvironment(lane), FMARCH_PROOF_ARTIFACT_DIR: "" },
      { ...runnerEnvironment(lane), FMARCH_PROOF_RUN_ID: "" },
    ]) assert.throws(() => validator(lane)(passed(lane), { manifest, env }));
    assert.throws(() => validator(lane)(passed(lane), { manifest, env: {} }), /standalone/);
    assert.throws(() => validator(lane)(passed(lane, { standalone: true }), { manifest, env: runnerEnvironment(lane) }));
  }
});

test("profile acceptance requires creation, public identity, saved revision, owner isolation and withdrawal", () => {
  const mutations = [
    ...["created", "publicView", "edited", "ownerScope", "privacy"].map(stage => e => { delete e[stage]; }),
    e => { e.publicView.displayName = "Another Profile"; }, e => { e.created.editorTestId = "profile-create-surface"; },
    e => { e.edited.reloadBio = "Opening public bio."; }, e => { e.edited.expectedRevision = "-1"; },
    e => { e.edited.expectedRevision = "01"; }, e => { e.ownerScope.createSurface = false; },
    e => { e.privacy.ownerVisibility = "public"; }, e => { delete e.privacy.ownerVisibility; },
    e => { e.privacy.apiStatus = 500; }, e => { delete e.privacy.apiStatus; },
    e => { e.privacy.unavailable = false; }, e => { e.privacy.testId = "profile-public-card"; },
    e => { e.roleUrl = "http://127.0.0.1:4200/u/owner_profile"; },
  ];
  for (const mutate of mutations) {
    const evidence = passed(PROFILE_PROOF_LANE); mutate(evidence);
    assert.throws(() => assertProfileProofEvidence(evidence, { manifest, env: runnerEnvironment(PROFILE_PROOF_LANE) }));
  }
});

test("export acceptance requires the completed manifest and rendered/API checksum and count agreement", () => {
  for (const mutate of [
    e => { delete e.manifest; }, e => { e.manifest.version = 2; },
    e => { e.manifest.checksum = "not-a-checksum"; }, e => { e.manifest.apiChecksum = "b".repeat(64); },
    e => { delete e.manifest.apiChecksum; }, e => { e.manifest.eventCount = 0; e.manifest.apiEventCount = 0; },
    e => { e.manifest.eventCount = 1.5; }, e => { e.manifest.apiEventCount = 3; },
    e => { e.manifest.completedEventPresent = false; }, e => { e.manifest.roleResponseStatus = 403; },
    e => { e.roleUrl = "http://127.0.0.1:4200/g/not-a-game/host/export"; },
  ]) {
    const evidence = passed(COMPLETED_EXPORT_PROOF_LANE); mutate(evidence);
    assert.throws(() => assertCompletedExportProofEvidence(evidence, { manifest, env: runnerEnvironment(COMPLETED_EXPORT_PROOF_LANE) }));
  }
});

test("the manifest owns unambiguous artifact names and capability attribution", () => {
  for (const [lane] of contracts) {
    for (const mutate of [
      m => { delete m.lanes[lane]; }, m => { m.lanes[lane].completion_evidence.push(m.lanes[lane].completion_evidence[0]); },
      m => { m.lanes[lane].completion_evidence[0].capability = "other.capability"; },
      m => { m.lanes[lane].completion_evidence[0].artifact = "../escape.json"; },
      m => { m.lanes[lane].completion_evidence[0].artifact = "/absolute.json"; },
      m => { m.lanes[lane].completion_evidence[0].proof = ""; },
    ]) {
      const changed = structuredClone(manifest); mutate(changed);
      assert.throws(() => profileExportEvidenceContract(lane, { manifest: changed }));
    }
  }
  assert.throws(() => profileExportEvidenceContract("unknown-lane", { manifest }));
});

test("canonical artifact reads reject absent, malformed, failed, foreign and symlinked reports", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fmarch-profile-export-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [lane, , filename] of contracts) {
    const options = { manifest, env: runnerEnvironment(lane, directory) };
    const destination = path.join(directory, filename);
    await assert.rejects(readProfileExportProofEvidence(lane, { manifest, env: runnerEnvironment(lane, "") }), /nonempty/);
    await assert.rejects(readProfileExportProofEvidence(lane, options), /ENOENT/);
    await writeFile(destination, "{");
    await assert.rejects(readProfileExportProofEvidence(lane, options), SyntaxError);
    for (const mutate of [e => { e.status = "failed"; }, e => { e.execution.runId = "old-run"; }, e => { e.execution.laneId = "wrong-lane"; }]) {
      const evidence = passed(lane); mutate(evidence); await writeFile(destination, JSON.stringify(evidence));
      await assert.rejects(readProfileExportProofEvidence(lane, options));
    }
    await writeFile(destination, JSON.stringify(passed(lane)));
    assert.equal((await readProfileExportProofEvidence(lane, options)).status, "passed");
    const other = path.join(directory, "other.json");
    await writeFile(other, JSON.stringify(passed(lane))); await rm(destination); await symlink(other, destination);
    await assert.rejects(readProfileExportProofEvidence(lane, options), /regular file/);
    await rm(destination);
  }
});

test("canonical npm entrypoints validate the artifact after the browser producer exits", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const [lane] of contracts) {
    const stages = scripts[lane].split(/\s*&&\s*/);
    assert.equal(stages.length, 2, `${lane} must produce then validate its artifact`);
    const producer = lane === PROFILE_PROOF_LANE ? "profile_role_proof" : "completed_game_export_role_proof";
    assert.ok(stages[0].endsWith(`node tools/${producer}.mjs`));
    assert.equal(stages[1], `node tools/profile_export_proof_evidence.mjs ${lane}`);
  }
});
