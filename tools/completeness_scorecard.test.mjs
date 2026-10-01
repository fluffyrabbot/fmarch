import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  checkScorecard,
  completenessScorecardPath,
  loadCompletionRegistry,
  nextBuildableCodeItem,
  renderScorecard,
  repoRoot,
  summarizeRegistry,
  validateRegistry,
} from "./completeness_scorecard.mjs";

test("real completion registry records the 1.0 substrate frontier", async () => {
  const registry = await loadCompletionRegistry();
  await validateRegistry(registry);
  const summary = summarizeRegistry(registry);
  assert.deepEqual(summary.byExecutionClass.code, {
    complete: 50,
    partial: 1,
    open: 6,
    blocked: 0,
    deferred: 0,
    total: 57,
  });
  assert.deepEqual(summary.byExecutionClass["external-evidence"], {
    complete: 0,
    partial: 0,
    open: 0,
    blocked: 6,
    deferred: 0,
    total: 6,
  });
  assert.deepEqual(summary.byExecutionClass.human, {
    complete: 1,
    partial: 0,
    open: 2,
    blocked: 1,
    deferred: 0,
    total: 4,
  });
  // Signup linkage and posting budgets are complete; the other 2026-09-22
  // forum readiness gaps remain stated open product items.
  assert.equal(summary.productCapabilitiesComplete, false);
  assert.equal(summary.platformComplete, false);
  assert.equal(summary.releaseComplete, false);
  assert.equal(
    registry.items.find((item) => item.id === "product.mash.scale-acceptance")
      ?.status,
    "complete",
  );
  assert.equal(
    nextBuildableCodeItem(registry)?.id,
    "foundation.executable-bounded-contexts",
  );
  assert.equal(
    registry.items.find((item) => item.id === "product.community.forum-editing-curation")
      ?.status,
    "complete",
  );
  assert.equal(
    registry.items.find((item) => item.id === "product.community.posting-rate-limits")
      ?.status,
    "complete",
  );
  // RFC 0006 is a sequenced architecture migration with two landed steps; its
  // registry item resolves the RFC's status pointer without implying closure.
  assert.equal(
    registry.items.find((item) => item.id === "foundation.executable-bounded-contexts")
      ?.status,
    "partial",
  );
  assert.equal(
    registry.items.find((item) => item.id === "product.game.persona-occupancy")
      ?.status,
    "complete",
  );
  assert.equal(
    registry.items.find((item) => item.id === "optional.public-history-explorer")
      ?.status,
    "deferred",
  );
  assert.deepEqual(summary.byExecutionClass.optional, {
    complete: 0,
    partial: 0,
    open: 0,
    blocked: 0,
    deferred: 3,
    total: 3,
  });
});

test("generated scorecard exactly matches the canonical registry", async () => {
  const registry = await loadCompletionRegistry();
  const rendered = renderScorecard(registry);
  const saved = await readFile(
    path.resolve(repoRoot, completenessScorecardPath),
    "utf8",
  );
  assert.equal(saved, rendered);
  assert.equal(await checkScorecard(), true);
  assert.match(rendered, /Canonical private media blob store/);
  assert.match(rendered, /Authenticated bounded media upload/);
  assert.match(rendered, /Uploaded media through a private post/);
  assert.match(rendered, /Sixty-player mash acceptance/);
  assert.match(rendered, /binary-CBOR WebSocket projection delivery/);
  assert.doesNotMatch(rendered, /Last updated|main @|Proof surface|tools\/ file/);
});

test("governing docs record the typed vote-target contract", async () => {
  const [domain, roadmap] = await Promise.all([
    readFile(path.resolve(repoRoot, "docs/arch/01-domain-model.md"), "utf8"),
    readFile(path.resolve(repoRoot, "docs/arch/08-roadmap.md"), "utf8"),
  ]);

  assert.match(domain, /Votes are never parsed from post text/);
  assert.match(domain, /selection sends `SubmitVote` with `Slot\(slot_id\)` or `NoLynch`/);
  assert.doesNotMatch(domain, /Open design call:\*\* strict tag syntax/);
  assert.match(roadmap, /typed `SubmitVote`\/`WithdrawVote`/);
  assert.doesNotMatch(roadmap, /\*\*Vote syntax\*\*/);
});

test("governing transport docs and browser boundary require binary CBOR", async () => {
  const [wire, transport] = await Promise.all([
    readFile(path.resolve(repoRoot, "docs/arch/04-wire-protocol.md"), "utf8"),
    readFile(
      path.resolve(repoRoot, "frontend/src/lib/app/live-transport.mjs"),
      "utf8",
    ),
  ]);

  assert.match(wire, /WebSocket\/binary CBOR/);
  assert.match(wire, /There is no JSON WebSocket compatibility mode/);
  assert.match(transport, /protocol: "WebSocket CBOR"/);
  assert.match(transport, /decodeServerEnvelopeFrame/);
  assert.doesNotMatch(transport, /JSON\.parse\(String\(event\.data\)\)/);
});

test("registry validation rejects duplicate ids and unknown dependencies", async () => {
  const registry = await loadCompletionRegistry();
  const duplicate = structuredClone(registry);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  await assert.rejects(
    validateRegistry(duplicate, { verifySourcePaths: false }),
    /duplicate completion registry item/,
  );

  const unknownDependency = structuredClone(registry);
  unknownDependency.items[0].depends_on = ["missing.capability"];
  await assert.rejects(
    validateRegistry(unknownDependency, { verifySourcePaths: false }),
    /unknown dependency/,
  );
});

test("registry validation rejects dependency cycles", async () => {
  const registry = await loadCompletionRegistry();
  const cyclic = structuredClone(registry);
  // Open every complete item so the cycle check is reached before the
  // complete-depends-on-incomplete check, regardless of which items exist.
  for (const item of cyclic.items) {
    if (item.status === "complete") {
      item.status = item.execution_class === "external-evidence" ? "partial" : "open";
      item.remaining = ["cyclic test dependency"];
    }
  }
  const registration = cyclic.items.find(
    (item) => item.id === "product.identity.registration",
  );
  const delivery = cyclic.items.find((item) => item.id === "product.identity.delivery");
  registration.depends_on = [delivery.id];
  delivery.depends_on = [registration.id];
  await assert.rejects(
    validateRegistry(cyclic, { verifySourcePaths: false }),
    /dependency cycle/,
  );
});

test("registry validation rejects illegal completion and blocked states", async () => {
  const registry = await loadCompletionRegistry();

  const completeWithoutEvidence = structuredClone(registry);
  completeWithoutEvidence.items[0].evidence = [];
  await assert.rejects(
    validateRegistry(completeWithoutEvidence, { verifySourcePaths: false }),
    /has no evidence/,
  );

  const blockedWithoutOwnerInput = structuredClone(registry);
  delete blockedWithoutOwnerInput.items.find(
    (item) => item.id === "hosted-deployment",
  ).blocked_on;
  await assert.rejects(
    validateRegistry(blockedWithoutOwnerInput, { verifySourcePaths: false }),
    /blocked_on/,
  );

  const deferredCode = structuredClone(registry);
  deferredCode.items.find(
    (item) => item.id === "optional.projection-snapshots",
  ).execution_class = "code";
  await assert.rejects(
    validateRegistry(deferredCode, { verifySourcePaths: false }),
    /invalid code status/,
  );

  const whitespaceRemaining = structuredClone(registry);
  whitespaceRemaining.items.find(
    (item) => item.id === "housekeeping.accessibility-review",
  ).remaining = ["   "];
  await assert.rejects(
    validateRegistry(whitespaceRemaining, { verifySourcePaths: false }),
    /remaining must contain nonempty strings/,
  );

  const completeRecommendedSlice = structuredClone(registry);
  completeRecommendedSlice.items[0].recommended_slice = {
    objective: "Exercise the complete-item recommendation guard.",
    paths: ["tools/completeness_scorecard.test.mjs"],
    proof_commands: ["npm run test:completeness-scorecard"],
    non_claims: ["No product behavior changes."],
  };
  await assert.rejects(
    validateRegistry(completeRecommendedSlice, { verifySourcePaths: false }),
    /invalid recommended slice owner/,
  );
});

test("registry validation rejects circular evidence and unknown release authority", async () => {
  const registry = await loadCompletionRegistry();

  const circularEvidence = structuredClone(registry);
  circularEvidence.items[0].evidence = [
    { kind: "source", value: "docs/ops/../ops/completeness-scorecard.md" },
  ];
  await assert.rejects(
    validateRegistry(circularEvidence, { verifySourcePaths: false }),
    /circular evidence/,
  );

  const outsideEvidence = structuredClone(registry);
  outsideEvidence.items[0].evidence = [
    { kind: "source", value: "../outside-fmarch.md" },
  ];
  await assert.rejects(
    validateRegistry(outsideEvidence, { verifySourcePaths: false }),
    /outside the repository/,
  );

  const mismatchedAuthority = structuredClone(registry);
  mismatchedAuthority.items.find(
    (item) => item.id === "hosted-production-identity",
  ).authority.id = "hosted-deployment";
  await assert.rejects(
    validateRegistry(mismatchedAuthority, { verifySourcePaths: false }),
    /invalid authority/,
  );

  const unknownCommand = structuredClone(registry);
  unknownCommand.items.find(
    (item) => item.id === "product.game.core-loop",
  ).evidence[0].value = "npm run test:command-that-does-not-exist";
  await assert.rejects(
    validateRegistry(unknownCommand, { verifySourcePaths: false }),
    /unknown package script/,
  );
});

const canonicalCapabilities = [
  ["product.community.profiles", "test:dev-test-game-profile"],
  ["product.archive.completed-game-export", "test:dev-test-game-completed-export"],
];

async function canonicalFixture() {
  return {
    registry: await loadCompletionRegistry(),
    proofManifest: JSON.parse(await readFile(
      path.resolve(repoRoot, "docs/ops/proof-lane-manifest.json"), "utf8",
    )),
  };
}

test("profile and export completion references resolve canonical browser acceptance", async () => {
  const { registry, proofManifest } = await canonicalFixture();
  for (const [capability, laneId] of canonicalCapabilities) {
    const item = registry.items.find((entry) => entry.id === capability);
    assert.equal(item.status, "complete");
    assert.deepEqual(item.evidence.filter((entry) => entry.kind === "canonical-lane"), [
      { kind: "canonical-lane", value: laneId },
    ]);
    assert.ok(!item.evidence.some((entry) => entry.value.includes(":local") || entry.value.startsWith("target/")));
    assert.equal(proofManifest.lanes[laneId].completion_evidence[0].capability, capability);
  }
  assert.equal(await validateRegistry(registry, { proofManifest, verifySourcePaths: false }), registry);
  assert.match(renderScorecard(registry), /canonical-lane: `test:dev-test-game-profile`/);
  assert.match(renderScorecard(registry), /canonical-lane: `test:dev-test-game-completed-export`/);
});

test("canonical completion rejects missing, foreign, and unreciprocated coverage", async (t) => {
  for (const [name, mutate, expected] of [
    ["missing lane", ({ proofManifest }, laneId) => { delete proofManifest.lanes[laneId]; }, /unknown canonical lane/],
    ["missing declaration", ({ proofManifest }, laneId) => { delete proofManifest.lanes[laneId].completion_evidence; }, /no matching canonical declaration/],
    ["foreign lane", ({ registry }, laneId, capability) => {
      registry.items.find((item) => item.id === capability).evidence.find((entry) => entry.kind === "canonical-lane").value = "test:dev-test-game-completed-export";
    }, /no matching canonical declaration/],
    ["local command substitution", ({ registry }, laneId, capability) => {
      const item = registry.items.find((entry) => entry.id === capability);
      item.evidence = item.evidence.filter((entry) => entry.kind !== "canonical-lane");
      item.evidence.push({ kind: "command", value: `npm run ${laneId}:local` });
    }, /lacks reciprocal registry evidence/],
    ["unknown capability", ({ proofManifest }, laneId) => {
      proofManifest.lanes[laneId].completion_evidence[0].capability = "product.missing";
    }, /unknown capability/],
    ["missing behavioral owner", ({ proofManifest }, laneId, capability) => {
      for (const area of proofManifest.areas) {
        if (area.capabilities?.includes(capability)) area.lanes = area.lanes.filter((entry) => entry !== laneId);
      }
    }, /no direct area owner/],
    ["duplicate registry reference", ({ registry }, laneId, capability) => {
      registry.items.find((item) => item.id === capability).evidence.push({ kind: "canonical-lane", value: laneId });
    }, /repeats canonical lane/],
  ]) {
    await t.test(name, async () => {
      const fixture = await canonicalFixture();
      mutate(fixture, canonicalCapabilities[0][1], canonicalCapabilities[0][0]);
      await assert.rejects(
        validateRegistry(fixture.registry, { proofManifest: fixture.proofManifest, verifySourcePaths: false }),
        expected,
      );
    });
  }
});

test("canonical completion requires direct browser execution and runner-owned artifacts", async (t) => {
  for (const [name, mutate, expected] of [
    ["hermetic substitution", (lane) => { lane.execution.class = "hermetic"; }, /must execute browser acceptance/],
    ["local spine wrapper", (lane) => { lane.execution.argv[2] += ":local"; }, /registered npm script directly/],
    ["foreign script", (lane) => { lane.execution.argv[2] = "test:frontend-contract"; }, /registered npm script directly/],
    ["shell command", (lane) => { lane.execution.argv = ["sh", "-c", "npm run test:dev-test-game-profile"]; }, /registered npm script directly/],
    ["ambient artifact directory", (lane) => { lane.execution.resources = lane.execution.resources.filter((resource) => resource.kind !== "artifact-dir"); }, /runner-owned artifact directory/],
  ]) {
    await t.test(name, async () => {
      const { registry, proofManifest } = await canonicalFixture();
      mutate(proofManifest.lanes[canonicalCapabilities[0][1]]);
      await assert.rejects(validateRegistry(registry, { proofManifest, verifySourcePaths: false }), expected);
    });
  }
});

test("canonical completion metadata is explicit, unique, and runner relative", async (t) => {
  for (const [name, mutate, expected] of [
    ["empty declaration", (lane) => { lane.completion_evidence = []; }, /nonempty array/],
    ["unknown metadata field", (lane) => { lane.completion_evidence[0].filename = "extra.json"; }, /invalid completion evidence metadata/],
    ["duplicate capability", (lane) => { lane.completion_evidence.push(structuredClone(lane.completion_evidence[0])); }, /repeats capability/],
    ["absolute artifact", (lane) => { lane.completion_evidence[0].artifact = "/tmp/proof.json"; }, /safe runner-relative JSON/],
    ["escaping artifact", (lane) => { lane.completion_evidence[0].artifact = "../proof.json"; }, /safe runner-relative JSON/],
    ["normalized escape", (lane) => { lane.completion_evidence[0].artifact = "a/../proof.json"; }, /safe runner-relative JSON/],
    ["artifact wildcard", (lane) => { lane.completion_evidence[0].artifact = "*.json"; }, /safe runner-relative JSON/],
    ["non JSON artifact", (lane) => { lane.completion_evidence[0].artifact = "proof.txt"; }, /safe runner-relative JSON/],
    ["missing proof identity", (lane) => { lane.completion_evidence[0].proof = ""; }, /stable proof identifier/],
  ]) {
    await t.test(name, async () => {
      const { registry, proofManifest } = await canonicalFixture();
      mutate(proofManifest.lanes[canonicalCapabilities[0][1]]);
      await assert.rejects(validateRegistry(registry, { proofManifest, verifySourcePaths: false }), expected);
    });
  }
});
