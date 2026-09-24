import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { validateFleetProofReceipt } from "./release_coordinator_contract.mjs";

export function fleetReleaseWorkflow(manifest, mode = "audit", platform = "linux") {
  assert.equal(manifest?.schemaVersion, 1, "fleet workflow manifest schema drifted");
  const profile = manifest?.profiles?.[platform];
  assert.ok(profile, `fleet workflow has no ${platform} profile`);
  const verify = mode === "default" ? profile.verify : profile.verificationModes?.[mode];
  assert.ok(Array.isArray(verify) && verify.length > 0, `fleet workflow has no ${mode} verification mode`);
  return { setup: profile.setup ?? [], verify };
}

export function fleetReleaseAuthority(manifest) {
  const authority = manifest?.releaseAuthority;
  assert.equal(authority?.host, "cachy", "release authority must be canonical Cachy");
  assert.equal(authority?.platform, "linux", "release authority platform must be Linux");
  assert.equal(authority?.verificationMode, "audit", "release authority must require audit mode");
  assert.match(
    authority?.receiptPublicKeySha256 ?? "",
    /^[0-9a-f]{64}$/u,
    "release authority must pin the receipt public key",
  );
  return authority;
}

export function defaultFleetPublicKeyPath(env = process.env) {
  const fleetRoot = env.FLUFFYFLEET_ROOT ?? path.join(homedir(), "apps", "fluffyfleet");
  return path.join(fleetRoot, "var", "keys", "hosts", "cachy", "receipt-public.pem");
}

export async function loadFleetReleaseProof({
  repoRoot,
  commit,
  receiptPath,
  publicKeyPath = defaultFleetPublicKeyPath(),
  expectedJobId,
  now = new Date(),
  maxAgeMilliseconds,
}) {
  assert.ok(receiptPath, "release requires --fleet-receipt or FMARCH_FLEET_RECEIPT");
  assert.ok(expectedJobId, "release requires --fleet-job or FMARCH_FLEET_JOB_ID");
  const [receiptBytes, publicKeyPem, manifestBytes] = await Promise.all([
    readFile(path.resolve(receiptPath), "utf8"),
    readFile(path.resolve(publicKeyPath), "utf8"),
    readFile(path.join(repoRoot, ".fluffyfleet.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBytes);
  const authority = fleetReleaseAuthority(manifest);
  const envelope = JSON.parse(receiptBytes);
  const proof = validateFleetProofReceipt(envelope, {
    expectedCommit: commit,
    publicKeyPem,
    expectedJobId,
    expectedHost: authority.host,
    expectedPlatform: authority.platform,
    expectedVerificationMode: authority.verificationMode,
    expectedTrustRootSha256: authority.receiptPublicKeySha256,
    expectedWorkflow: fleetReleaseWorkflow(
      manifest,
      authority.verificationMode,
      authority.platform,
    ),
    now,
    ...(maxAgeMilliseconds === undefined ? {} : { maxAgeMilliseconds }),
  });
  return {...proof, source_content: sourceContentFromVerifiedEnvelope(envelope, commit)};
}

// Call only after the complete envelope signature, workflow and commit are verified.
export function sourceContentFromVerifiedEnvelope(envelope, commit) {
  const steps = envelope.document.evidence.steps.filter(s => s.label === "verify: node tools/source_content_report.mjs");
  assert.equal(steps.length, 1, "audit must contain exactly one canonical source content report");
  const report = JSON.parse(steps[0].stdout);
  assert.equal(report.kind, "fmarch-source-content");
  assert.equal(report.version, 1);
  assert.equal(report.commit, commit, "source content report commit drifted");
  assert.equal(report.platform, "linux");
  assert.equal(report.content?.status, "ok");
  assert.match(report.content.registry_hash ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(report.content.pack_count, 5);
  assert.equal(report.content.program_count, 5);
  assert.ok(Array.isArray(report.content.packs) && Array.isArray(report.content.programs));
  return report;
}
