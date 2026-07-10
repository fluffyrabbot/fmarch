import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  releaseReadinessUnprovenItem,
} from "./dev_test_game_release_readiness_cases.mjs";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const completionRegistryPath = "docs/ops/completion-registry.json";
export const completenessScorecardPath = "docs/ops/completeness-scorecard.md";

const executionClassStatuses = Object.freeze({
  code: Object.freeze(["open", "partial", "complete"]),
  "external-evidence": Object.freeze(["blocked", "partial", "complete"]),
  human: Object.freeze(["open", "blocked", "complete"]),
  optional: Object.freeze(["deferred", "open", "partial", "complete"]),
});
const evidenceKinds = new Set(["source", "command", "artifact", "planned-command"]);
const sectionKinds = new Set([
  "foundation",
  "product-capability",
  "release-gate",
  "housekeeping",
  "optimization",
]);
const requiredForValues = new Set(["platform", "release", "optional"]);

export async function loadCompletionRegistry({ root = repoRoot } = {}) {
  return JSON.parse(
    await readFile(path.resolve(root, completionRegistryPath), "utf8"),
  );
}

export async function validateRegistry(
  registry,
  { root = repoRoot, verifySourcePaths = true } = {},
) {
  if (registry?.version !== 1) {
    throw new Error(`completion registry version drifted: ${registry?.version}`);
  }
  if (typeof registry.boundary !== "string" || registry.boundary.trim() === "") {
    throw new Error("completion registry is missing its boundary");
  }
  if (
    typeof registry.status_boundary !== "string" ||
    registry.status_boundary.trim() === ""
  ) {
    throw new Error("completion registry is missing its status boundary");
  }
  if (!Array.isArray(registry.sections) || registry.sections.length === 0) {
    throw new Error("completion registry has no sections");
  }
  if (!Array.isArray(registry.items) || registry.items.length === 0) {
    throw new Error("completion registry has no items");
  }

  const sections = new Map();
  const sectionOrders = new Set();
  for (const section of registry.sections) {
    assertNonemptyString(section?.id, "completion registry section id");
    assertNonemptyString(section?.title, `completion registry section ${section.id} title`);
    if (!sectionKinds.has(section?.kind)) {
      throw new Error(`completion registry section ${section.id} has invalid kind`);
    }
    if (!requiredForValues.has(section?.required_for)) {
      throw new Error(
        `completion registry section ${section.id} has invalid required_for`,
      );
    }
    assertPositiveInteger(section?.order, `completion registry section ${section.id} order`);
    if (sections.has(section.id)) {
      throw new Error(`duplicate completion registry section: ${section.id}`);
    }
    if (sectionOrders.has(section.order)) {
      throw new Error(`duplicate completion registry section order: ${section.order}`);
    }
    sections.set(section.id, section);
    sectionOrders.add(section.order);
  }

  const items = new Map();
  const itemOrdersBySection = new Map();
  const packageJson = JSON.parse(
    await readFile(path.resolve(root, "package.json"), "utf8"),
  );
  const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
  let recommendedSliceCount = 0;
  for (const item of registry.items) {
    assertNonemptyString(item?.id, "completion registry item id");
    if (items.has(item.id)) {
      throw new Error(`duplicate completion registry item: ${item.id}`);
    }
    if (!sections.has(item.section)) {
      throw new Error(
        `completion registry item ${item.id} has unknown section: ${item.section}`,
      );
    }
    assertPositiveInteger(item.order, `completion registry item ${item.id} order`);
    const sectionOrdersForItems = itemOrdersBySection.get(item.section) ?? new Set();
    if (sectionOrdersForItems.has(item.order)) {
      throw new Error(
        `duplicate completion registry item order in ${item.section}: ${item.order}`,
      );
    }
    sectionOrdersForItems.add(item.order);
    itemOrdersBySection.set(item.section, sectionOrdersForItems);
    assertNonemptyString(item.title, `completion registry item ${item.id} title`);
    assertNonemptyString(item.summary, `completion registry item ${item.id} summary`);
    const allowedStatuses = executionClassStatuses[item.execution_class];
    if (allowedStatuses === undefined) {
      throw new Error(
        `completion registry item ${item.id} has invalid execution class: ${item.execution_class}`,
      );
    }
    if (!allowedStatuses.includes(item.status)) {
      throw new Error(
        `completion registry item ${item.id} has invalid ${item.execution_class} status: ${item.status}`,
      );
    }
    const section = sections.get(item.section);
    if (
      (item.execution_class === "optional") !==
      (section.required_for === "optional")
    ) {
      throw new Error(
        `completion registry item ${item.id} optional class/section drifted`,
      );
    }
    if (
      item.execution_class === "external-evidence" &&
      section.kind !== "release-gate"
    ) {
      throw new Error(
        `completion registry item ${item.id} external evidence is outside release gates`,
      );
    }
    assertNonemptyStringArray(
      item.complete_when,
      `completion registry item ${item.id} complete_when`,
    );
    assertStringArray(item.depends_on, `completion registry item ${item.id} depends_on`);
    assertStringArray(item.remaining, `completion registry item ${item.id} remaining`);
    if (!Array.isArray(item.evidence)) {
      throw new Error(`completion registry item ${item.id} evidence must be an array`);
    }
    if (item.status === "complete") {
      if (item.evidence.length === 0) {
        throw new Error(`complete registry item ${item.id} has no evidence`);
      }
      if (item.remaining.length !== 0) {
        throw new Error(`complete registry item ${item.id} still has remaining work`);
      }
    } else {
      assertNonemptyStringArray(
        item.remaining,
        `incomplete completion registry item ${item.id} remaining`,
      );
    }
    if (item.status === "blocked") {
      assertNonemptyStringArray(
        item.blocked_on,
        `blocked completion registry item ${item.id} blocked_on`,
      );
    } else if (item.blocked_on !== undefined) {
      throw new Error(`non-blocked registry item ${item.id} declares blocked_on`);
    }
    if (item.status === "deferred") {
      if (item.execution_class !== "optional") {
        throw new Error(`deferred registry item ${item.id} is not optional`);
      }
      assertNonemptyString(
        item.decision_trigger,
        `deferred completion registry item ${item.id} decision_trigger`,
      );
    }
    if (item.authority !== undefined) {
      if (
        item.authority?.kind !== "release-readiness" ||
        typeof item.authority.id !== "string" ||
        item.authority.id === "" ||
        item.authority.id !== item.id ||
        item.section !== "release-evidence" ||
        !["external-evidence", "human"].includes(item.execution_class)
      ) {
        throw new Error(`completion registry item ${item.id} has invalid authority`);
      }
      releaseReadinessUnprovenItem(item.authority.id);
    } else if (
      item.section === "release-evidence" &&
      ["external-evidence", "human"].includes(item.execution_class)
    ) {
      throw new Error(`completion registry item ${item.id} is missing release authority`);
    }
    if (item.recommended_slice !== undefined) {
      if (item.execution_class !== "code" || item.status === "complete") {
        throw new Error(
          `completion registry item ${item.id} has an invalid recommended slice owner`,
        );
      }
      recommendedSliceCount += 1;
      assertRecommendedSlice(item.id, item.recommended_slice, { packageScripts });
    }
    for (const evidence of item.evidence) {
      await assertEvidence(item.id, evidence, {
        root,
        verifySourcePaths,
        packageScripts,
      });
    }
    items.set(item.id, item);
  }
  if (recommendedSliceCount > 1) {
    throw new Error("completion registry declares more than one active recommended slice");
  }

  for (const item of items.values()) {
    for (const dependencyId of item.depends_on) {
      if (dependencyId === item.id) {
        throw new Error(`completion registry item ${item.id} depends on itself`);
      }
      if (!items.has(dependencyId)) {
        throw new Error(
          `completion registry item ${item.id} has unknown dependency: ${dependencyId}`,
        );
      }
      if (item.status === "complete" && items.get(dependencyId).status !== "complete") {
        throw new Error(
          `complete registry item ${item.id} depends on incomplete item ${dependencyId}`,
        );
      }
    }
  }
  assertAcyclic(items);
  return registry;
}

export function summarizeRegistry(registry) {
  const sections = new Map(registry.sections.map((section) => [section.id, section]));
  const byExecutionClass = Object.fromEntries(
    Object.keys(executionClassStatuses).map((executionClass) => [
      executionClass,
      summarizeItems(
        registry.items.filter((item) => item.execution_class === executionClass),
      ),
    ]),
  );
  const productItems = registry.items.filter(
    (item) => sections.get(item.section)?.kind === "product-capability",
  );
  const platformItems = registry.items.filter(
    (item) => sections.get(item.section)?.required_for === "platform",
  );
  const requiredItems = registry.items.filter(
    (item) => sections.get(item.section)?.required_for !== "optional",
  );
  return {
    byExecutionClass,
    required: summarizeItems(requiredItems),
    productCapabilitiesComplete: productItems.every(
      (item) => item.status === "complete",
    ),
    platformComplete: platformItems.every((item) => item.status === "complete"),
    releaseComplete: requiredItems.every((item) => item.status === "complete"),
  };
}

export function nextBuildableCodeItem(registry) {
  const items = new Map(registry.items.map((item) => [item.id, item]));
  return orderedItems(registry).find(
    (item) =>
      item.execution_class === "code" &&
      item.status !== "complete" &&
      item.recommended_slice !== undefined &&
      item.depends_on.every((dependencyId) => items.get(dependencyId)?.status === "complete"),
  );
}

export function renderScorecard(registry) {
  const summary = summarizeRegistry(registry);
  const nextItem = nextBuildableCodeItem(registry);
  const lines = [
    "# Completeness scorecard",
    "",
    "> Generated from [completion-registry.json](completion-registry.json) by",
    "> `npm run generate:completeness-scorecard`. Do not edit this file directly.",
    "> Validate registry structure and generated-byte equality with",
    "> `npm run test:completeness-scorecard`.",
    "",
    registry.boundary,
    "",
    registry.status_boundary,
    "",
    "## Program summary",
    "",
    "Completion is reported by execution class. Optional work is excluded from the",
    "required denominator, and no proof-lane, tool-file, timestamp, or Git revision",
    "count is treated as product progress.",
    "",
    "| Execution class | Complete | Partial | Open | Blocked | Deferred | Total |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...Object.entries(summary.byExecutionClass).map(([executionClass, counts]) =>
      summaryRow(executionClass, counts),
    ),
    "",
    `Product capabilities complete: **${summary.productCapabilitiesComplete ? "yes" : "no"}**.`,
    `Required platform scope complete: **${summary.platformComplete ? "yes" : "no"}**.`,
    `Overall release closure complete: **${summary.releaseComplete ? "yes" : "no"}**.`,
    "",
    "## Next buildable coding slice",
    "",
  ];
  if (nextItem === undefined) {
    lines.push("No dependency-satisfied incomplete coding slice is registered.", "");
  } else {
    lines.push(
      `### ${nextItem.title} \`${nextItem.id}\``,
      "",
      nextItem.recommended_slice.objective,
      "",
      `Owned paths: ${nextItem.recommended_slice.paths.map(code).join(", ")}.`,
      "",
      "Proof:",
      "",
      ...nextItem.recommended_slice.proof_commands.map((command) => `- ${code(command)}`),
      "",
      "Explicit non-claims:",
      "",
      ...nextItem.recommended_slice.non_claims.map((claim) => `- ${claim}`),
      "",
    );
  }

  for (const section of orderedSections(registry)) {
    const sectionItems = orderedItems(registry).filter(
      (item) => item.section === section.id,
    );
    lines.push(
      `## ${section.title}`,
      "",
      "| Status | Capability | Depends on | Complete when | Current / remaining | Evidence / boundary |",
      "|---|---|---|---|---|---|",
      ...sectionItems.map(renderItemRow),
      "",
    );
  }

  lines.push(
    "## Orchestration contract",
    "",
    ...(registry.orchestration_rules ?? []).map((rule) => `- ${rule}`),
    "",
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export async function writeScorecard({ root = repoRoot } = {}) {
  const registry = await loadCompletionRegistry({ root });
  await validateRegistry(registry, { root });
  const rendered = renderScorecard(registry);
  await writeFile(path.resolve(root, completenessScorecardPath), rendered);
  return rendered;
}

export async function checkScorecard({ root = repoRoot } = {}) {
  const registry = await loadCompletionRegistry({ root });
  await validateRegistry(registry, { root });
  const expected = renderScorecard(registry);
  const actual = await readFile(path.resolve(root, completenessScorecardPath), "utf8");
  if (actual !== expected) {
    throw new Error(
      `${completenessScorecardPath} is stale; run npm run generate:completeness-scorecard`,
    );
  }
  return true;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !["--write", "--check"].includes(argv[0])) {
    throw new Error("usage: node tools/completeness_scorecard.mjs --write|--check");
  }
  if (argv[0] === "--write") {
    await writeScorecard();
    console.log(`wrote ${completenessScorecardPath}`);
    return;
  }
  await checkScorecard();
  console.log(`${completenessScorecardPath} is current`);
}

function summarizeItems(items) {
  return {
    complete: items.filter((item) => item.status === "complete").length,
    partial: items.filter((item) => item.status === "partial").length,
    open: items.filter((item) => item.status === "open").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    deferred: items.filter((item) => item.status === "deferred").length,
    total: items.length,
  };
}

function orderedSections(registry) {
  return [...registry.sections].sort((left, right) => left.order - right.order);
}

function orderedItems(registry) {
  const sectionOrder = new Map(
    registry.sections.map((section) => [section.id, section.order]),
  );
  return [...registry.items].sort(
    (left, right) =>
      sectionOrder.get(left.section) - sectionOrder.get(right.section) ||
      left.order - right.order,
  );
}

function renderItemRow(item) {
  const dependencies =
    item.depends_on.length === 0 ? "—" : item.depends_on.map(code).join("<br>");
  const evidence = item.evidence
    .map((entry) => `${entry.kind}: ${code(entry.value)}`)
    .join("<br>");
  const boundary = `${evidence}<br>${escapeTable(item.summary)}`;
  return [
    `| ${escapeTable(item.status)}`,
    `${escapeTable(item.title)}<br>${code(item.id)}`,
    dependencies,
    item.complete_when.map(escapeTable).join("<br>"),
    actionableState(item),
    `${boundary} |`,
  ].join(" | ");
}

function actionableState(item) {
  const rows = [];
  if (item.status === "complete") {
    rows.push("Complete.");
  } else {
    rows.push(...item.remaining.map((entry) => `Remaining: ${escapeTable(entry)}`));
  }
  if (item.blocked_on !== undefined) {
    rows.push(
      ...item.blocked_on.map((entry) => `Blocked on: ${escapeTable(entry)}`),
    );
  }
  if (item.decision_trigger !== undefined) {
    rows.push(`Decision trigger: ${escapeTable(item.decision_trigger)}`);
  }
  if (item.authority !== undefined) {
    rows.push(`Authority: ${code(`${item.authority.kind}:${item.authority.id}`)}`);
  }
  return rows.join("<br>");
}

function summaryRow(executionClass, counts) {
  return `| ${executionClass} | ${counts.complete} | ${counts.partial} | ${counts.open} | ${counts.blocked} | ${counts.deferred} | ${counts.total} |`;
}

function code(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
}

function assertNonemptyStringArray(value, label) {
  assertStringArray(value, label);
  if (value.length === 0 || value.some((entry) => entry.trim() === "")) {
    throw new Error(`${label} must contain nonempty strings`);
  }
}

function assertRecommendedSlice(itemId, slice, { packageScripts }) {
  assertNonemptyString(slice?.objective, `registry item ${itemId} slice objective`);
  assertNonemptyStringArray(slice?.paths, `registry item ${itemId} slice paths`);
  assertNonemptyStringArray(
    slice?.proof_commands,
    `registry item ${itemId} slice proof_commands`,
  );
  assertNonemptyStringArray(
    slice?.non_claims,
    `registry item ${itemId} slice non_claims`,
  );
  for (const command of slice.proof_commands) {
    assertCommandReference(itemId, command, packageScripts);
  }
}

async function assertEvidence(
  itemId,
  evidence,
  { root, verifySourcePaths, packageScripts },
) {
  if (!evidenceKinds.has(evidence?.kind)) {
    throw new Error(`completion registry item ${itemId} has invalid evidence kind`);
  }
  assertNonemptyString(evidence.value, `completion registry item ${itemId} evidence value`);
  if (["command", "planned-command"].includes(evidence.kind)) {
    assertCommandReference(itemId, evidence.value, packageScripts);
  }
  if (evidence.kind !== "source") {
    return;
  }
  const absoluteRoot = path.resolve(root);
  const absoluteSource = path.resolve(absoluteRoot, evidence.value);
  assertContainedSourcePath(itemId, absoluteRoot, absoluteSource);
  const forbiddenEvidencePaths = new Set(
    [completionRegistryPath, completenessScorecardPath].map((entry) =>
      path.resolve(absoluteRoot, entry),
    ),
  );
  if (forbiddenEvidencePaths.has(absoluteSource)) {
    throw new Error(
      `completion registry item ${itemId} cites generated or circular evidence: ${evidence.value}`,
    );
  }
  if (verifySourcePaths) {
    await access(absoluteSource);
    const [realRoot, realSource] = await Promise.all([
      realpath(absoluteRoot),
      realpath(absoluteSource),
    ]);
    assertContainedSourcePath(itemId, realRoot, realSource);
  }
}

function assertContainedSourcePath(itemId, root, source) {
  const relative = path.relative(root, source);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(
    `completion registry item ${itemId} cites source outside the repository: ${source}`,
  );
}

function assertCommandReference(itemId, command, packageScripts) {
  const match = String(command).match(/(?:^|\s)npm run ([^\s]+)/);
  if (match !== null && !packageScripts.has(match[1])) {
    throw new Error(
      `completion registry item ${itemId} references unknown package script: ${match[1]}`,
    );
  }
}

function assertAcyclic(items) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      throw new Error(`completion registry dependency cycle includes ${id}`);
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    for (const dependencyId of items.get(id).depends_on) {
      visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of items.keys()) {
    visit(id);
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
