import { error } from "@sveltejs/kit";
import {
  readLocalBackupRestoreProof,
  readLocalAdminSpineProof,
  readLocalDevTestGameProofRun,
  readLocalHostedConcurrentRaceMatrix,
  readLocalHostedEvidenceLane,
  readLocalHostedEvidenceLaneDemoProof,
  readLocalHostedOpsSignals,
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
} from "../../../../lib/server/local-ops-artifacts.mjs";
import { SESSION_COOKIE_NAME } from "../../../../lib/server/session-capabilities.mjs";
import {
  adminForbiddenMessage,
  buildAdminAuditDetailData,
} from "../../admin-route-model.mjs";

export async function load({ cookies, locals, fetch, params, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const data = await buildAdminAuditDetailData({
    audit: params.audit,
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    game: url.searchParams.get("game") ?? "midsummer",
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
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
    proofGraph: await readLocalProofGraph(),
    raceCoverage: await readLocalRaceCoverage(),
    hostedConcurrentRaceMatrix: await readLocalHostedConcurrentRaceMatrix(),
    hostedEvidenceLane: await readLocalHostedEvidenceLane(),
    hostedEvidenceLaneDemoProof: await readLocalHostedEvidenceLaneDemoProof(),
    hostedOpsSignals: await readLocalHostedOpsSignals(),
    hostedTargetPreflight: await readLocalHostedTargetPreflight(),
    nextAction: await readLocalNextAction(),
    proofFreshness: await readLocalProofFreshness(),
  });

  if (!data.access.allowed) {
    throw error(403, adminForbiddenMessage());
  }
  if (data.audit === null) {
    throw error(404, `Admin audit item ${data.auditId} is not available.`);
  }

  return {
    ...data,
    shellOwner: "layout",
  };
}
