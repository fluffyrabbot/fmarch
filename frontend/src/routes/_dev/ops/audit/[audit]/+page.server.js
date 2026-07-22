import { error } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../../../lib/server/api-base.mjs";
import {
  readLocalBackupRestoreProof,
  readLocalAdminSpineProof,
  readLocalAdminSpineTerminalBatches,
  readLocalDevTestGameProofRun,
  readLocalHostedConcurrentRaceMatrix,
  readLocalHostedEvidenceLane,
  readLocalHostedEvidenceLaneDemoProof,
  readLocalHostedIdentityEvidence,
  readLocalHostedIdentityProgressionSummary,
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
} from "../../../../../lib/server/local-ops-artifacts.mjs";
import { SESSION_COOKIE_NAME } from "../../../../../lib/server/session-capabilities.mjs";
import {
  adminForbiddenMessage,
  buildAdminAuditDetailData,
} from "../../../../../routes/admin/admin-route-model.mjs";
import { _requireDevOps, _rewriteDevOpsLinks } from "../../+page.server.js";

export { actions } from "../../../../../routes/admin/audit/[audit]/+page.server.js";

export async function load({ cookies, locals, fetch, params, url }) {
  _requireDevOps();
  const apiBaseUrl = serverApiBaseUrl();
  const game = url.searchParams.get("game") ?? "midsummer";
  const data = await buildAdminAuditDetailData({
    audit: params.audit,
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    game,
    fetchImpl: apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken: cookies?.get?.(SESSION_COOKIE_NAME) ?? null,
    identityPrincipalUserId: url.searchParams.get("principal_user_id") ?? "host_h",
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
    hostedIdentityProgressionSummary: await readLocalHostedIdentityProgressionSummary(),
    hostedOpsSignals: await readLocalHostedOpsSignals(),
    realHostedObservabilityHandoff: await readLocalRealHostedObservabilityHandoff(),
    hostedTargetPreflight: await readLocalHostedTargetPreflight(),
    nextAction: await readLocalNextAction(),
    proofFreshness: await readLocalProofFreshness(),
  });
  if (!data.access.allowed) {
    throw error(403, adminForbiddenMessage());
  }
  if (data.audit === null) {
    throw error(404, `Local proof item ${data.auditId} is not available.`);
  }
  return _rewriteDevOpsLinks({ ...data, shellOwner: "layout" });
}
