import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../lib/app/app-route-state-model.mjs";
import { uiWorkbenchEnabled } from "../../../lib/dev/ui-workbench.mjs";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import {
  readLocalBackupRestoreProof,
  readLocalAdminSpineProof,
  readLocalAdminSpineTerminalBatches,
  readLocalDevTestGameProofRun,
  readLocalHostedConcurrentRaceMatrix,
  readLocalHostedEvidenceLane,
  readLocalHostedEvidenceLaneDemoProof,
  readLocalHostedIdentityEvidence,
  readLocalHostedOpsSignals,
  readLocalRealHostedObservabilityHandoff,
  readLocalHostedTargetPreflight,
  readLocalIdentityAdapterProof,
  readLocalNextAction,
  readLocalOpsArtifacts,
  readLocalProofGraph,
  readLocalRaceCoverage,
  readLocalReleaseReadinessChecklist,
  readLocalReleaseRunbook,
  readLocalSeedFixtureSummary,
  readLocalSpineManifest,
  readLocalProofFreshness,
} from "../../../lib/server/local-ops-artifacts.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";
import {
  adminForbiddenMessage,
  buildAdminRouteData,
} from "../../../routes/admin/admin-route-model.mjs";

export { actions } from "../../../routes/admin/+page.server.js";

export async function load({ cookies, locals, fetch, url }) {
  _requireDevOps();
  const apiBaseUrl = serverApiBaseUrl();
  const game = url.searchParams.get("game") ?? "midsummer";
  const data = await buildAdminRouteData({
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    game,
    fetchImpl: apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken: accessTokenForRequest({ locals, cookies }),
    identityPrincipalUserId: url.searchParams.get("identity_principal_user_id") ?? "host_h",
    proofRun: await readLocalDevTestGameProofRun(),
    opsArtifacts: await readLocalOpsArtifacts(),
    seedFixtureSummary: await readLocalSeedFixtureSummary(),
    releaseReadinessChecklist: await readLocalReleaseReadinessChecklist(),
    releaseRunbook: await readLocalReleaseRunbook(),
    backupRestoreProof: await readLocalBackupRestoreProof(),
    identityAdapterProof: await readLocalIdentityAdapterProof(),
    spineManifest: await readLocalSpineManifest(),
    adminSpineProof: await readLocalAdminSpineProof(),
    adminSpineTerminalBatches: await readLocalAdminSpineTerminalBatches(),
    proofGraph: await readLocalProofGraph(),
    raceCoverage: await readLocalRaceCoverage(),
    hostedConcurrentRaceMatrix: await readLocalHostedConcurrentRaceMatrix(),
    hostedEvidenceLane: await readLocalHostedEvidenceLane(),
    hostedEvidenceLaneDemoProof: await readLocalHostedEvidenceLaneDemoProof(),
    hostedIdentityEvidence: await readLocalHostedIdentityEvidence(),
    hostedOpsSignals: await readLocalHostedOpsSignals(),
    realHostedObservabilityHandoff: await readLocalRealHostedObservabilityHandoff(),
    hostedTargetPreflight: await readLocalHostedTargetPreflight(),
    nextAction: await readLocalNextAction(),
    proofFreshness: await readLocalProofFreshness(),
  });
  if (!data.access.allowed) {
    throw error(403, adminForbiddenMessage());
  }
  return _rewriteDevOpsLinks({
    ...data,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "admin",
      url,
      fixtureMode: true,
    }),
  });
}

export function _requireDevOps(env = process.env) {
  if (!uiWorkbenchEnabled(env)) {
    throw error(404, "Not found");
  }
}

export function _rewriteDevOpsLinks(value) {
  if (Array.isArray(value)) {
    return value.map(_rewriteDevOpsLinks);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, _rewriteDevOpsLinks(item)]),
    );
  }
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/^\/admin\/audit\//u, "/_dev/ops/audit/")
    .replace(/^\/admin\/artifact/u, "/_dev/ops/artifact")
    .replace(/^\/admin(?=\?|$)/u, "/_dev/ops");
}
