import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RFC_PATH = "docs/rfcs/0006-executable-bounded-context-architecture.md";

const PURE_CONTEXT_MANIFESTS = [
  "crates/attention/Cargo.toml",
  "crates/community_membership/Cargo.toml",
  "crates/content_reference/Cargo.toml",
  "crates/domain/Cargo.toml",
  "crates/forum/Cargo.toml",
  "crates/game_platform/Cargo.toml",
  "crates/principal/Cargo.toml",
  "crates/social/Cargo.toml",
  "crates/trust_safety/Cargo.toml",
];

export const ACTIVE_HARD_BANS = [
  {
    id: "hard:pure-context-inward-only",
    manifests: PURE_CONTEXT_MANIFESTS,
    dependencies: [
      "api",
      "axum",
      "caps",
      "commands",
      "database_schema",
      "eventstore",
      "identity",
      "object_store",
      "operator_api",
      "operator_proof",
      "projections",
      "reqwest",
      "server",
      "sqlx",
      "wire",
    ],
  },
  {
    id: "hard:event-journal-no-outward-dependencies",
    manifests: ["crates/eventstore/Cargo.toml"],
    dependencies: [
      "api",
      "caps",
      "commands",
      "operator_api",
      "operator_proof",
      "projections",
      "server",
      "wire",
    ],
  },
  {
    id: "hard:api-does-not-import-operations-plane",
    manifests: ["crates/api/Cargo.toml"],
    dependencies: ["operator_api", "operator_proof", "server"],
  },
  {
    id: "hard:public-server-does-not-import-proof-engine",
    manifests: ["crates/server/Cargo.toml"],
    dependencies: ["operator_proof"],
  },
  {
    id: "hard:wire-does-not-import-runtime-or-privacy",
    manifests: ["crates/wire/Cargo.toml"],
    dependencies: [
      "api",
      "database_schema",
      "eventstore",
      "identity",
      "operator_api",
      "operator_proof",
      "server",
      "sqlx",
    ],
  },
];

export const DEPENDENCY_RATCHETS = [
  {
    id: "ratchet:server-direct-workspace-dependencies",
    manifest: "crates/server/Cargo.toml",
    allowedWorkspaceDependencies: [
      "api",
      "caps",
      "commands",
      "content_registry",
      "database_schema",
      "domain",
      "eventstore",
      "identity",
      "media",
      "operator_api",
      "profile_application",
      "profile_handle_index",
      "projections",
    ],
  },
  {
    id: "ratchet:api-direct-workspace-dependencies",
    manifest: "crates/api/Cargo.toml",
    allowedWorkspaceDependencies: [
      "attention",
      "caps",
      "commands",
      "community_membership",
      "content_reference",
      "content_registry",
      "database_schema",
      "domain",
      "eventstore",
      "forum",
      "game_platform",
      "identity",
      "media",
      "membership_application",
      "principal",
      "profile_application",
      "projections",
      "social",
      "trust_safety",
      "wire",
    ],
  },
  {
    id: "ratchet:projections-direct-workspace-dependencies",
    manifest: "crates/projections/Cargo.toml",
    allowedWorkspaceDependencies: [
      "attention",
      "content_reference",
      "content_registry",
      "database_schema",
      "domain",
      "eventstore",
      "forum",
      "game_platform",
      "identity",
      "principal",
      "profile_handle_index",
      "social",
      "trust_safety",
    ],
  },
  {
    id: "ratchet:wire-direct-workspace-dependencies",
    manifest: "crates/wire/Cargo.toml",
    allowedWorkspaceDependencies: [
      "caps",
      "commands",
      "content_reference",
      "domain",
      "game_platform",
      "principal",
      "projections",
    ],
  },
];

export const TARGET_BANS = [
  {
    id: "target:public-runtime-is-adapter-only",
    manifest: "crates/server/Cargo.toml",
    dependencies: [
      "caps",
      "commands",
      "content_registry",
      "database_schema",
      "domain",
      "eventstore",
      "identity",
      "media",
      "operator_api",
      "profile_application",
      "profile_handle_index",
      "projections",
      "sqlx",
    ],
  },
  {
    id: "target:http-api-has-no-persistence",
    manifest: "crates/api/Cargo.toml",
    dependencies: [
      "commands",
      "database_schema",
      "eventstore",
      "identity",
      "media",
      "projections",
      "sqlx",
    ],
  },
  {
    id: "target:wire-has-no-internal-dependencies",
    manifest: "crates/wire/Cargo.toml",
    dependencies: [
      "caps",
      "commands",
      "content_reference",
      "domain",
      "game_platform",
      "principal",
      "projections",
    ],
  },
  {
    id: "target:event-journal-is-context-neutral",
    manifest: "crates/eventstore/Cargo.toml",
    dependencies: ["domain", "principal"],
  },
  {
    id: "target:monolithic-projections-have-no-write-authority",
    manifest: "crates/projections/Cargo.toml",
    dependencies: ["eventstore", "identity"],
  },
];

export const REQUIRED_RFC_HEADINGS = [
  "## Target dependency DAG",
  "## Fitness enforcement: hard bans, ratchets, and target bans",
  "## Typed event codec contract",
  "## Authoritative and derived state inventory",
  "## Context, schema, and role ownership",
  "## Minimal `GameAggregate` state",
  "## Privacy lifecycle and receipts",
  "## Shadow projection rebuild protocol",
  "## Atomic migration sequence",
];

/**
 * Parse production dependency declarations without invoking Cargo. Development
 * dependencies are deliberately excluded: this contract governs code shipped
 * in a runtime artifact, including target-specific and build dependencies.
 */
export function parseCargoDependencies(source) {
  const dependencies = [];
  const lines = source.split(/\r?\n/);
  let section = "";
  let tableDependency;
  let tableDeclaration = [];

  const flushTableDependency = () => {
    if (!tableDependency) return;
    const declaration = tableDeclaration.join("\n");
    const packageName = declaration.match(/\bpackage\s*=\s*"([^"]+)"/)?.[1] ?? tableDependency;
    dependencies.push({
      alias: tableDependency,
      name: packageName,
      workspacePath: /\bpath\s*=\s*"[^"]+"/.test(declaration),
    });
    tableDependency = undefined;
    tableDeclaration = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (sectionMatch) {
      flushTableDependency();
      section = sectionMatch[1];
      tableDependency = productionDependencyTableName(section);
      continue;
    }
    if (tableDependency) {
      tableDeclaration.push(line);
      continue;
    }
    if (!isProductionDependencySection(section)) continue;

    const dependencyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!dependencyMatch) continue;

    let declaration = dependencyMatch[2];
    let braceDepth = braceDelta(declaration);
    while (braceDepth > 0 && index + 1 < lines.length) {
      index += 1;
      declaration += `\n${lines[index]}`;
      braceDepth += braceDelta(lines[index]);
    }

    const alias = dependencyMatch[1];
    const packageName = declaration.match(/\bpackage\s*=\s*"([^"]+)"/)?.[1] ?? alias;
    dependencies.push({
      alias,
      name: packageName,
      workspacePath: /\bpath\s*=\s*"[^"]+"/.test(declaration),
    });
  }

  flushTableDependency();

  return dependencies;
}

export function hardBanViolations(manifestDependencies, policies = ACTIVE_HARD_BANS) {
  const violations = [];
  for (const policy of policies) {
    const forbidden = new Set(policy.dependencies);
    for (const manifest of policy.manifests) {
      const dependencies = manifestDependencies.get(manifest);
      if (!dependencies) {
        violations.push(`${policy.id}: governed manifest is missing: ${manifest}`);
        continue;
      }
      for (const dependency of dependencies) {
        if (forbidden.has(dependency.name)) {
          violations.push(`${policy.id}: ${manifest} depends on forbidden ${dependency.name}`);
        }
      }
    }
  }
  return violations;
}

export function ratchetViolations(
  manifestDependencies,
  policies = DEPENDENCY_RATCHETS,
  workspacePackageNames = new Set(),
) {
  const violations = [];
  for (const policy of policies) {
    const dependencies = manifestDependencies.get(policy.manifest);
    if (!dependencies) {
      violations.push(`${policy.id}: governed manifest is missing: ${policy.manifest}`);
      continue;
    }
    const allowed = new Set(policy.allowedWorkspaceDependencies);
    const directWorkspaceDependencies = dependencies.filter(
      (candidate) => candidate.workspacePath || workspacePackageNames.has(candidate.name),
    );
    const present = new Set(directWorkspaceDependencies.map((dependency) => dependency.name));
    for (const dependency of directWorkspaceDependencies) {
      if (!allowed.has(dependency.name)) {
        violations.push(
          `${policy.id}: ${policy.manifest} added workspace dependency ${dependency.name}; ` +
            "remove it or amend the ratchet in the same reviewed architecture migration",
        );
      }
    }
    for (const dependency of allowed) {
      if (!present.has(dependency)) {
        violations.push(
          `${policy.id}: ${policy.manifest} no longer depends on recorded workspace dependency ${dependency}; ` +
            "remove the stale ratchet allowance in the same architecture migration",
        );
      }
    }
  }
  return violations;
}

export function outstandingTargetDebt(manifestDependencies, policies = TARGET_BANS) {
  const debt = [];
  for (const policy of policies) {
    const dependencyNames = new Set(
      (manifestDependencies.get(policy.manifest) ?? []).map((dependency) => dependency.name),
    );
    for (const dependency of policy.dependencies) {
      if (dependencyNames.has(dependency)) {
        debt.push(`${policy.id}: ${policy.manifest} -> ${dependency}`);
      }
    }
  }
  return debt;
}

export function rfcContractViolations(source) {
  const violations = [];
  if (!source.includes("<!-- architecture-fitness-contract:v1 -->")) {
    violations.push(`${RFC_PATH}: missing architecture-fitness-contract:v1 marker`);
  }
  for (const heading of REQUIRED_RFC_HEADINGS) {
    if (!source.includes(heading)) violations.push(`${RFC_PATH}: missing heading ${heading}`);
  }
  for (const policy of [...ACTIVE_HARD_BANS, ...DEPENDENCY_RATCHETS, ...TARGET_BANS]) {
    if (!source.includes(`\`${policy.id}\``)) {
      violations.push(`${RFC_PATH}: missing policy identifier ${policy.id}`);
    }
  }
  return violations;
}

export async function inspectRepository(root = REPO_ROOT) {
  const manifestPaths = new Set([
    ...ACTIVE_HARD_BANS.flatMap((policy) => policy.manifests),
    ...DEPENDENCY_RATCHETS.map((policy) => policy.manifest),
    ...TARGET_BANS.map((policy) => policy.manifest),
  ]);
  const manifestDependencies = new Map();
  for (const manifestPath of [...manifestPaths].sort()) {
    const source = await readFile(path.join(root, manifestPath), "utf8");
    manifestDependencies.set(manifestPath, parseCargoDependencies(source));
  }
  const workspacePackageNames = await loadWorkspacePackageNames(root);
  const rfc = await readFile(path.join(root, RFC_PATH), "utf8");
  return {
    violations: [
      ...hardBanViolations(manifestDependencies),
      ...ratchetViolations(manifestDependencies, DEPENDENCY_RATCHETS, workspacePackageNames),
      ...rfcContractViolations(rfc),
    ],
    targetDebt: outstandingTargetDebt(manifestDependencies),
  };
}

async function loadWorkspacePackageNames(root) {
  const workspaceSource = await readFile(path.join(root, "Cargo.toml"), "utf8");
  const membersBody = workspaceSource.match(
    /^members\s*=\s*\[([\s\S]*?)^\s*]\s*$/m,
  )?.[1];
  if (membersBody === undefined) {
    throw new Error("Cargo.toml must declare an explicit workspace members array");
  }
  const members = [...membersBody.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const names = await Promise.all(
    members.map(async (member) => {
      const source = await readFile(path.join(root, member, "Cargo.toml"), "utf8");
      const packageSection = source.match(
        /^\[package]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m,
      )?.[1];
      const name = packageSection?.match(/^\s*name\s*=\s*"([^"]+)"\s*$/m)?.[1];
      if (!name) throw new Error(`${member}/Cargo.toml must declare package.name`);
      return name;
    }),
  );
  return new Set(names);
}

function isProductionDependencySection(section) {
  if (section === "dependencies" || section === "build-dependencies") return true;
  if (section.includes("dev-dependencies")) return false;
  return section.endsWith(".dependencies") || section.endsWith(".build-dependencies");
}

function productionDependencyTableName(section) {
  if (section.includes("dev-dependencies")) return undefined;
  return section.match(/(?:^|\.)(?:build-)?dependencies\.([A-Za-z0-9_-]+)$/)?.[1];
}

function braceDelta(value) {
  return [...value].reduce(
    (depth, character) => depth + (character === "{" ? 1 : character === "}" ? -1 : 0),
    0,
  );
}

async function main() {
  const result = await inspectRepository();
  if (result.violations.length > 0) {
    for (const violation of result.violations) console.error(`architecture fitness: ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `architecture fitness passed; ${result.targetDebt.length} target dependency edges remain as explicit migration debt`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
