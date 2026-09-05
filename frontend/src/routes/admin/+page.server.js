import { randomUUID } from "node:crypto";
import { error, fail, redirect } from "@sveltejs/kit";
import { buildAdminCommand, buildCommandEnvelope } from "../../lib/app/command-boundary.mjs";
import { operatorProofRunUrl } from "../../lib/app/cold-load.mjs";
import { resolveFixtureRouteState } from "../../lib/app/app-route-state-model.mjs";
import { canonicalPrincipalId } from "../../lib/principal-id.mjs";
import { serverApiBaseUrl } from "../../lib/server/api-base.mjs";
import { frontendFixtureMode } from "../../lib/server/runtime-mode.mjs";
import { accessTokenForRequest } from "../../lib/server/session-capabilities.mjs";
import {
  adminForbiddenMessage,
  buildAdminRuntimeRouteData,
  loadAdminGameBootstrap,
  loadAdminGameIndex,
  summarizeRecoveryGate,
} from "./admin-runtime-route-model.mjs";

export async function load({ cookies, locals, fetch, url }) {
  if (typeof locals.principalId !== "string" || locals.principalId.trim() === "") {
    throw redirect(303, loginHref(url));
  }
  const requestedIdentityPrincipalId = url.searchParams.get("principal_id");
  const identityPrincipalId = requestedIdentityPrincipalId === null
    ? locals.principalId
    : canonicalPrincipalId(requestedIdentityPrincipalId);
  if (identityPrincipalId === null) {
    throw error(400, "principal_id must be a canonical UUID");
  }
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = frontendFixtureMode();
  const sessionToken = accessTokenForRequest({ locals, cookies });
  const gameIndexPage = await loadAdminGameIndex({
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken,
    fallback: fixtureMode && apiBaseUrl === "" ? fixtureAdminGameIndex() : null,
  });
  const bootstrapCatalog = await loadAdminGameBootstrap({
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken,
    fallback: fixtureMode && apiBaseUrl === "" ? fixtureAdminBootstrapCatalog() : null,
  });
  const data = await buildAdminRuntimeRouteData({
    principalId: locals.principalId,
    capabilities: locals.resolvedCapabilities,
    game: optionalGame(url.searchParams.get("game")),
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken,
    gameIndexPage,
    bootstrapCatalog,
    includeLegacyIdentityOps: classicAuthEnabled(process.env),
    identityPrincipalId,
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

function fixtureAdminGameIndex() {
  return Object.freeze({
    games: Object.freeze([
      Object.freeze({ game: "midsummer", pack: "mafiascum", status: "active", phase_id: "D02" }),
      Object.freeze({ game: "solstice", pack: "mafia_universe", status: "completed", phase_id: "D01" }),
      Object.freeze({ game: "new-moon", pack: "mafiascum", status: "setup", phase_id: null }),
    ]),
    next_cursor: null,
  });
}

function fixtureAdminBootstrapCatalog() {
  return Object.freeze({
    packs: Object.freeze([
      Object.freeze({ key: "mafiascum", name: "Mafiascum" }),
      Object.freeze({ key: "mafia_universe", name: "Mafia Universe" }),
    ]),
  });
}

function optionalGame(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function loginHref(url) {
  const returnTo = `${url.pathname}${url.search}`;
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export const actions = {
  createGame: async ({ cookies, fetch, locals, request }) => {
    const capabilities = Array.isArray(locals.resolvedCapabilities)
      ? locals.resolvedCapabilities
      : [];
    if (!capabilities.some((capability) => capability?.kind === "GlobalAdmin")) {
      return fail(403, { bootstrap: { state: "reject", message: "Game creation requires GlobalAdmin" } });
    }
    const sessionToken = accessTokenForRequest({ locals, cookies });
    if (!sessionToken || typeof locals.principalId !== "string") {
      return fail(401, { bootstrap: { state: "reject", message: "Authenticated admin session required" } });
    }
    const formData = await request.formData();
    const pack = requiredFormString(formData, "pack");
    const game = randomUUID();
    const envelope = buildCommandEnvelope({
      command: buildAdminCommand({ action: "create_game", game, pack }),
      commandId: randomUUID(),
      envelopeId: Date.now(),
    });
    const response = await fetch(`${serverApiBaseUrl()}/commands`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
    const body = await response.json();
    if (!response.ok || body?.body?.kind !== "Ack") {
      return fail(response.ok ? 409 : response.status, {
        bootstrap: {
          state: "reject",
          message: body?.body?.body?.message ?? "Game creation was rejected",
        },
      });
    }
    throw redirect(303, `/g/${game}/setup`);
  },

  checkRecoveryGate: async ({ cookies, fetch, locals, request }) => {
    const apiBaseUrl = serverApiBaseUrl();
    const fixtureMode = frontendFixtureMode();
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

    if (fixtureMode && apiBaseUrl === "") {
      return {
        id: "recovery-gate",
        ...summarizeRecoveryGate(fixtureRecoveryGateReport()),
        boundary: "fixture",
      };
    }

    const sessionToken = accessTokenForRequest({ locals, cookies });
    if (!sessionToken) {
      return fail(401, {
        id: "recovery-gate",
        state: "reject",
        message: "Missing authenticated operator session",
      });
    }

    const response = await fetch(
      operatorProofRunUrl({
        apiBaseUrl,
        game,
        path: "operator/proof-runs/go-no-go",
      }),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${sessionToken}`,
        },
      },
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
};

// Classic identity operations are first-class whenever the classic sign-in
// method is enabled, independent of whether WorkOS is also configured.
function classicAuthEnabled(env) {
  return env?.FMARCH_CLASSIC_AUTH !== "0";
}

function requiredFormString(formData, field) {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim() === "") {
    throw error(400, `${field} is required`);
  }
  return value;
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
