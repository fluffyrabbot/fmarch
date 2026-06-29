import { error, fail } from "@sveltejs/kit";
import { operatorProofRunUrl } from "../../lib/app/cold-load.mjs";
import { resolveFixtureRouteState } from "../../lib/app/app-route-state-model.mjs";
import {
  readLocalBackupRestoreProof,
  readLocalAdminSpineProof,
  readLocalDevTestGameProofRun,
  readLocalIdentityAdapterProof,
  readLocalNextAction,
  readLocalOpsArtifacts,
  readLocalProofGraph,
  readLocalReleaseReadinessChecklist,
  readLocalSeedFixtureSummary,
  readLocalSpineManifest,
  readLocalProofFreshness,
} from "../../lib/server/local-ops-artifacts.mjs";
import { SESSION_COOKIE_NAME } from "../../lib/server/session-capabilities.mjs";
import {
  adminForbiddenMessage,
  buildAdminRouteData,
  summarizeRecoveryGate,
} from "./admin-route-model.mjs";

export async function load({ cookies, locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const data = await buildAdminRouteData({
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    game: url.searchParams.get("game") ?? "midsummer",
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken: cookies?.get?.(SESSION_COOKIE_NAME) ?? null,
    identityPrincipalUserId: url.searchParams.get("identity_principal_user_id") ?? "host_h",
    proofRun: await readLocalDevTestGameProofRun(),
    opsArtifacts: await readLocalOpsArtifacts(),
    seedFixtureSummary: await readLocalSeedFixtureSummary(),
    releaseReadinessChecklist: await readLocalReleaseReadinessChecklist(),
    backupRestoreProof: await readLocalBackupRestoreProof(),
    identityAdapterProof: await readLocalIdentityAdapterProof(),
    spineManifest: await readLocalSpineManifest(),
    adminSpineProof: await readLocalAdminSpineProof(),
    proofGraph: await readLocalProofGraph(),
    nextAction: await readLocalNextAction(),
    proofFreshness: await readLocalProofFreshness(),
  });

  if (!data.access.allowed) {
    throw error(403, adminForbiddenMessage());
  }

  return {
    ...data,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "admin",
      url,
      fixtureMode,
    }),
  };
}

export const actions = {
  checkRecoveryGate: async ({ fetch, locals, request }) => {
    const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
    const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
    const capabilities = Array.isArray(locals.resolvedCapabilities)
      ? locals.resolvedCapabilities
      : [];
    const canReadRecovery = capabilities.some(
      (capability) =>
        capability?.kind === "GlobalAdmin" || capability?.kind === "GlobalMod",
    );
    if (!canReadRecovery) {
      return fail(403, {
        id: "recovery-gate",
        state: "reject",
        message: "Recovery gate checks require GlobalAdmin or GlobalMod",
      });
    }

    const formData = await request.formData();
    const game = requiredFormString(formData, "game");
    const principalUserId =
      typeof locals.principalUserId === "string" && locals.principalUserId.trim() !== ""
        ? locals.principalUserId
        : requiredFormString(formData, "principalUserId");

    if (fixtureMode && apiBaseUrl === "") {
      return {
        id: "recovery-gate",
        ...summarizeRecoveryGate(fixtureRecoveryGateReport()),
        boundary: "fixture",
      };
    }

    const response = await fetch(
      operatorProofRunUrl({
        apiBaseUrl,
        game,
        principalUserId,
        path: "operator/proof-runs/go-no-go",
      }),
      { headers: { accept: "application/json" } },
    );
    const body = await response.json();
    if (!response.ok) {
      return fail(response.status, {
        id: "recovery-gate",
        state: "reject",
        message: body?.message ?? "Recovery gate check rejected",
      });
    }

    return {
      id: "recovery-gate",
      ...summarizeRecoveryGate(body),
    };
  },

  grantSession: async ({ cookies, fetch, locals, request }) => {
    const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
    const capabilities = Array.isArray(locals.resolvedCapabilities)
      ? locals.resolvedCapabilities
      : [];
    const canGrant = capabilities.some(
      (capability) => capability?.kind === "GlobalAdmin",
    );
    if (!canGrant) {
      return fail(403, {
        id: "session-grants",
        state: "reject",
        message: "Session grants require GlobalAdmin",
      });
    }

    const sessionToken = cookies.get(SESSION_COOKIE_NAME);
    if (!sessionToken) {
      return fail(401, {
        id: "session-grants",
        state: "reject",
        message: "Missing authenticated admin session",
      });
    }

    const formData = await request.formData();
    const grantPayload = parseSessionGrantPayload(formData);
    if (grantPayload.status === "reject") {
      return fail(400, {
        id: "session-grants",
        state: "reject",
        message: grantPayload.message,
      });
    }

    const response = await fetch(`${apiBaseUrl}/auth/session-grants`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(grantPayload.payload),
    });
    const body = await response.json();
    if (!response.ok) {
      return fail(response.status, {
        id: "session-grants",
        state: "reject",
        message: body?.message ?? "Session grant rejected",
      });
    }

    const grantedKinds = (body.capabilities ?? [])
      .map((capability) => capability.kind)
      .join(", ");
    return {
      id: "session-grants",
      state: "ack",
      message: `Granted ${grantedKinds} to ${body.principal_user_id}`,
      principalUserId: body.principal_user_id,
      capabilityKinds: grantedKinds,
    };
  },
};

function requiredFormString(formData, field) {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim() === "") {
    throw error(400, `${field} is required`);
  }
  return value;
}

function parseSessionGrantPayload(formData) {
  const expiresAtText = requiredFormString(formData, "expiresAt");
  if (!/^\d+$/u.test(expiresAtText)) {
    return Object.freeze({
      status: "reject",
      message: "Session grant expiry must be a positive Unix timestamp",
    });
  }
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    return Object.freeze({
      status: "reject",
      message: "Session grant expiry must be a positive Unix timestamp",
    });
  }

  const globalCapabilities = [
    ...new Set(formData.getAll("globalCapability").map(String)),
  ];
  const unsupported = globalCapabilities.filter(
    (capability) => capability !== "GlobalMod",
  );
  if (globalCapabilities.length === 0 || unsupported.length > 0) {
    return Object.freeze({
      status: "reject",
      message:
        "Session grant form can only request the explicit GlobalMod capability",
    });
  }

  return Object.freeze({
    status: "ok",
    payload: Object.freeze({
      token: requiredFormString(formData, "token"),
      principal_user_id: requiredFormString(formData, "principalUserId"),
      expires_at: expiresAt,
      global_capabilities: Object.freeze(globalCapabilities),
    }),
  });
}

function fixtureRecoveryGateReport() {
  return Object.freeze({
    ok: true,
    production: Object.freeze({
      trusted: 3,
      total_artifact_rows: 3,
      non_trusted: 0,
    }),
  });
}
