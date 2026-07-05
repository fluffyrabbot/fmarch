import {
  coreLoopFeatureSpineSource,
  devTestGameCoreLoopAdminProofCommand,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  devTestGameHardeningAdminProofCommand,
  hardeningFeatureSpineSource,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  devTestGameIdentityAdminProofCommand,
  identityFeatureSpineSource,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  devTestGameHostSetupProofCommand,
  hostSetupFeatureSpineSource,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  cohostFeatureSpineSource,
  devTestGameCohostConsoleProofCommand,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  devTestGameReplacementPlayerProofCommand,
  replacementFeatureSpineSource,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  devTestGameReplacementActionProofCommand,
  replacementActionFeatureSpineSource,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  devTestGameReplacementPrivateProofCommand,
  replacementPrivateFeatureSpineSource,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";

export const productionFeatureReadinessSourceKind = Object.freeze({
  spineTargets: "spine-targets",
  identityAdapter: "identity-adapter",
});

export const productionFeatureCoverageDecisionKind = Object.freeze({
  seededRoleUrlProof: "seeded-role-url-proof",
  seededAdminProof: "seeded-admin-proof",
  deferred: "deferred",
  blockedLocalPrerequisite: "blocked-local-prerequisite",
});

export const devTestGameProductionFeatureBrowserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live";
export {
  devTestGameCoreLoopAdminProofCommand,
  devTestGameCohostConsoleProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameHostSetupProofCommand,
  devTestGameIdentityAdminProofCommand,
  devTestGameReplacementActionProofCommand,
  devTestGameReplacementPlayerProofCommand,
  devTestGameReplacementPrivateProofCommand,
};

export const productionFeatureSourceRegistry = Object.freeze([
  coreLoopFeatureSpineSource,
  hostSetupFeatureSpineSource,
  cohostFeatureSpineSource,
  replacementFeatureSpineSource,
  replacementActionFeatureSpineSource,
  replacementPrivateFeatureSpineSource,
  hardeningFeatureSpineSource,
  identityFeatureSpineSource,
]);

export const productionFeatureSourceCheckIds = Object.freeze(
  productionFeatureSourceRegistry.map((source) => source.sourceCheckId),
);

export const productionFeatureRoleSurfaceSources = Object.freeze(
  productionFeatureSourceRegistry.filter((source) =>
    source.graphSourceNodeId.startsWith("role-surface:"),
  ),
);

export const productionFeatureRoleSurfaceSourceCheckIds = Object.freeze(
  productionFeatureRoleSurfaceSources.map((source) => source.sourceCheckId),
);

export const productionFeatureSourceByCheckId = Object.freeze(
  Object.fromEntries(
    productionFeatureSourceRegistry.map((source) => [
      source.sourceCheckId,
      source,
    ]),
  ),
);

export function productionFeatureSourceForCheckId(sourceCheckId) {
  const source = productionFeatureSourceByCheckId[sourceCheckId];
  if (source === undefined) {
    throw new Error(`unknown production feature source check: ${sourceCheckId}`);
  }
  return source;
}

export function productionFeatureSourceCoverageDecision(source) {
  const decision = source?.coverageDecision;
  if (decision === null || typeof decision !== "object") {
    return null;
  }
  const kind = decision.kind;
  if (
    kind === productionFeatureCoverageDecisionKind.seededRoleUrlProof ||
    kind === productionFeatureCoverageDecisionKind.seededAdminProof
  ) {
    return typeof decision.proofCommand === "string" &&
      decision.proofCommand.trim() !== "" &&
      decision.proofCommand === source.rerunCommand
      ? decision
      : null;
  }
  if (kind === productionFeatureCoverageDecisionKind.deferred) {
    return typeof decision.reason === "string" &&
      decision.reason.trim() !== "" &&
      typeof decision.nextDecisionTrigger === "string" &&
      decision.nextDecisionTrigger.trim() !== ""
      ? decision
      : null;
  }
  if (kind === productionFeatureCoverageDecisionKind.blockedLocalPrerequisite) {
    return typeof decision.prerequisiteCheckId === "string" &&
      decision.prerequisiteCheckId.trim() !== "" &&
      typeof decision.recoveryCommand === "string" &&
      decision.recoveryCommand.trim() !== ""
      ? decision
      : null;
  }
  return null;
}

export function productionFeatureSourceCoverageDecisionForCheckId(sourceCheckId) {
  return productionFeatureSourceCoverageDecision(
    productionFeatureSourceForCheckId(sourceCheckId),
  );
}

export function productionFeatureSourceCoverageDecisionSummary(source) {
  const decision = productionFeatureSourceCoverageDecision(source);
  if (decision === null) {
    return null;
  }
  if (
    decision.kind === productionFeatureCoverageDecisionKind.seededRoleUrlProof ||
    decision.kind === productionFeatureCoverageDecisionKind.seededAdminProof
  ) {
    return {
      kind: decision.kind,
      proofCommand: decision.proofCommand,
    };
  }
  if (decision.kind === productionFeatureCoverageDecisionKind.deferred) {
    return {
      kind: decision.kind,
      reason: decision.reason,
      nextDecisionTrigger: decision.nextDecisionTrigger,
    };
  }
  if (decision.kind === productionFeatureCoverageDecisionKind.blockedLocalPrerequisite) {
    return {
      kind: decision.kind,
      prerequisiteCheckId: decision.prerequisiteCheckId,
      recoveryCommand: decision.recoveryCommand,
    };
  }
  return null;
}

export function productionFeatureSourceCoverageDecisionSummaryForCheckId(
  sourceCheckId,
) {
  return productionFeatureSourceCoverageDecisionSummary(
    productionFeatureSourceForCheckId(sourceCheckId),
  );
}

export function assertProductionFeatureSourceCoverageDecisions(
  sources = productionFeatureSourceRegistry,
) {
  const missing = [];
  for (const source of sources) {
    const decision = productionFeatureSourceCoverageDecision(source);
    if (decision === null) {
      missing.push(source?.sourceCheckId ?? "<unknown>");
      continue;
    }
    if (
      decision.kind === productionFeatureCoverageDecisionKind.seededRoleUrlProof &&
      (typeof source.roleUrlIncludes !== "string" ||
        source.roleUrlIncludes.trim() === "")
    ) {
      missing.push(source.sourceCheckId);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `production feature source missing coverage decision: ${missing.join(", ")}`,
    );
  }
}

export function productionFeatureSourceSpineChecklist(
  source,
  {
    browserProofCommand = devTestGameProductionFeatureBrowserProofCommand,
  } = {},
) {
  const decision = productionFeatureSourceCoverageDecision(source);
  return Object.freeze({
    sourceCheckId: String(source?.sourceCheckId ?? ""),
    coverageDecision:
      decision === null
        ? "missing"
        : `declared:${String(decision.kind ?? "unknown")}`,
    roleUrlTarget:
      typeof source?.roleUrlIncludes === "string" &&
      source.roleUrlIncludes.trim() !== "" &&
      typeof source?.detailRoleUrlIncludes === "string" &&
      source.detailRoleUrlIncludes.trim() !== ""
        ? "declared"
        : "missing",
    browserProofCommand:
      typeof browserProofCommand === "string" &&
      browserProofCommand.includes("test:dev-test-game-core-live")
        ? browserProofCommand
        : "",
    proofGraphVisibility:
      typeof source?.graphSourceNodeId === "string" &&
      source.graphSourceNodeId.trim() !== ""
        ? source.graphSourceNodeId
        : "",
    readinessDrilldown:
      Object.values(productionFeatureReadinessSourceKind).includes(
        source?.readinessSourceKind,
      )
        ? source.readinessSourceKind
        : "",
    nextActionDrilldown:
      decision !== null &&
      typeof source?.rerunCommand === "string" &&
      source.rerunCommand.trim() !== "" &&
      productionFeatureSourceCoverageDecisionSummary(source) !== null
        ? "coverage-decision-summary"
        : "",
  });
}

export function assertProductionFeatureSourceSpineChecklist(
  sources = productionFeatureSourceRegistry,
  options = {},
) {
  const missing = [];
  for (const source of sources) {
    const checklist = productionFeatureSourceSpineChecklist(source, options);
    for (const [key, value] of Object.entries(checklist)) {
      if (key === "sourceCheckId") {
        continue;
      }
      if (
        typeof value !== "string" ||
        value.trim() === "" ||
        value === "missing"
      ) {
        missing.push(`${checklist.sourceCheckId || "<unknown>"}.${key}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `production feature source spine checklist missing: ${missing.join(", ")}`,
    );
  }
}

assertProductionFeatureSourceCoverageDecisions();
assertProductionFeatureSourceSpineChecklist();
