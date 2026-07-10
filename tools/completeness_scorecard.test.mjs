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

test("real completion registry validates and selects the media storage slice", async () => {
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
  assert.equal(
    nextBuildableCodeItem(registry)?.id,
    "product.media.canonical-blob-store",
  );
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
  assert.doesNotMatch(rendered, /Last updated|main @|Proof surface|tools\/ file/);
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
  const canonical = cyclic.items.find(
    (item) => item.id === "product.media.canonical-blob-store",
  );
  const variants = cyclic.items.find(
    (item) => item.id === "product.media.variant-generation",
  );
  canonical.depends_on = [variants.id];
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
    (item) => item.id === "product.media.canonical-blob-store",
  ).remaining = ["   "];
  await assert.rejects(
    validateRegistry(whitespaceRemaining, { verifySourcePaths: false }),
    /remaining must contain nonempty strings/,
  );

  const completeRecommendedSlice = structuredClone(registry);
  completeRecommendedSlice.items[0].recommended_slice = structuredClone(
    registry.items.find(
      (item) => item.id === "product.media.canonical-blob-store",
    ).recommended_slice,
  );
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
