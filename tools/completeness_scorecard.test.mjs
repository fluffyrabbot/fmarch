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

test("real completion registry exposes subscriptions after moderation operations", async () => {
  const registry = await loadCompletionRegistry();
  await validateRegistry(registry);
  const summary = summarizeRegistry(registry);
  assert.deepEqual(summary.byExecutionClass["external-evidence"], {
    complete: 0,
    partial: 0,
    open: 0,
    blocked: 6,
    deferred: 0,
    total: 6,
  });
  assert.equal(summary.productCapabilitiesComplete, false);
  assert.equal(summary.platformComplete, false);
  assert.equal(summary.releaseComplete, false);
  assert.equal(nextBuildableCodeItem(registry)?.id, "product.community.subscriptions");
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
  const discussions = cyclic.items.find(
    (item) => item.id === "product.community.discussions",
  );
  discussions.status = "open";
  discussions.remaining = ["cyclic test dependency"];
  const profiles = cyclic.items.find(
    (item) => item.id === "product.community.profiles",
  );
  profiles.status = "open";
  profiles.remaining = ["cyclic test dependency"];
  const search = cyclic.items.find((item) => item.id === "product.community.search");
  search.status = "open";
  search.remaining = ["cyclic test dependency"];
  const moderation = cyclic.items.find(
    (item) => item.id === "product.community.moderation-operations",
  );
  moderation.status = "open";
  moderation.remaining = ["cyclic test dependency"];
  const registration = cyclic.items.find(
    (item) => item.id === "product.identity.registration",
  );
  const delivery = cyclic.items.find((item) => item.id === "product.identity.delivery");
  registration.status = "open";
  registration.remaining = ["cyclic test dependency"];
  delivery.status = "open";
  delivery.remaining = ["cyclic test dependency"];
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
  whitespaceRemaining.items.find((item) => item.id === "housekeeping.codename").remaining = ["   "];
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
