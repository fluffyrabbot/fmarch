import { error, fail } from "@sveltejs/kit";
import {
  readLocalBackupRestoreProof,
  readLocalAdminSpineProof,
  readLocalDevTestGameProofRun,
  readLocalHostedConcurrentRaceMatrix,
  readLocalHostedEvidenceLane,
  readLocalHostedEvidenceLaneDemoProof,
  readLocalHostedIdentityEvidence,
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
    hostedIdentityEvidence: await readLocalHostedIdentityEvidence(),
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

export const actions = {
  disableAccount: async ({ cookies, fetch, locals, request }) =>
    await submitAccountLifecycleAction({
      cookies,
      fetch,
      locals,
      request,
      actionId: "account-disable",
      endpoint: "/auth/accounts/disable",
      verb: "disabled",
      defaultMessage: "Account disable rejected",
      buildPayload: (accountId) => ({
        account_id: accountId,
        revoke_sessions: true,
      }),
    }),

  enableAccount: async ({ cookies, fetch, locals, request }) =>
    await submitAccountLifecycleAction({
      cookies,
      fetch,
      locals,
      request,
      actionId: "account-enable",
      endpoint: "/auth/accounts/enable",
      verb: "enabled",
      defaultMessage: "Account enable rejected",
      buildPayload: (accountId) => ({
        account_id: accountId,
      }),
    }),
};

async function submitAccountLifecycleAction({
  cookies,
  fetch,
  locals,
  request,
  actionId,
  endpoint,
  verb,
  defaultMessage,
  buildPayload,
}) {
  const capabilities = Array.isArray(locals.resolvedCapabilities)
    ? locals.resolvedCapabilities
    : [];
  const canManageAccounts = capabilities.some(
    (capability) => capability?.kind === "GlobalAdmin",
  );
  if (!canManageAccounts) {
    return fail(403, {
      id: actionId,
      state: "reject",
      message: "Account lifecycle controls require GlobalAdmin",
    });
  }

  const sessionToken = cookies.get(SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return fail(401, {
      id: actionId,
      state: "reject",
      message: "Missing authenticated admin session",
    });
  }

  const formData = await request.formData();
  const accountId = formString(formData, "accountId");
  const expectedDisabled = formBoolean(formData, "expectedDisabled");
  if (accountId === null) {
    return fail(400, {
      id: actionId,
      state: "reject",
      message: "Account lifecycle action requires accountId",
    });
  }

  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const payload = buildPayload(accountId);
  if (expectedDisabled !== null) {
    payload.expected_disabled = expectedDisabled;
  }
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    return fail(response.status, {
      id: actionId,
      state: "reject",
      message: body?.message ?? defaultMessage,
    });
  }

  return {
    id: actionId,
    state: "ack",
    message:
      actionId === "account-disable"
        ? `${body.account_id} ${verb}; revoked ${
            body.revoked_session_count ?? 0
          } sessions`
        : `${body.account_id} ${verb}`,
    accountId: body.account_id,
    principalUserId: body.principal_user_id,
    disabledAt: body.disabled_at ?? null,
    revokedSessionCount: body.revoked_session_count ?? 0,
  };
}

function formString(formData, field) {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim();
}

function formBoolean(formData, field) {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}
