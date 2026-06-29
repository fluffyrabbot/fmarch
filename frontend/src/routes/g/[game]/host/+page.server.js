import { randomUUID } from "node:crypto";
import { error, fail } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../../lib/app/app-route-state-model.mjs";
import { SESSION_COOKIE_NAME } from "../../../../lib/server/session-capabilities.mjs";
import {
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
  resolveHostRouteCapabilities,
  resolveHostRoutePrincipal,
} from "./host-route-model.mjs";

export async function load({ params, locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const capabilities = resolveHostRouteCapabilities({
    game: params.game,
    locals,
  });
  const principalUserId = resolveHostRoutePrincipal({
    game: params.game,
    locals,
  });
  if (principalUserId === "") {
    throw error(403, "Host console requires an authenticated host session.");
  }

  const routeData = await buildHostConsoleRouteData({
    game: params.game,
    capabilities,
    principalUserId,
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
  });

  if (!routeData.access.allowed) {
    throw error(403, hostConsoleForbiddenMessage(params.game));
  }

  return {
    ...routeData,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "moderator",
      url,
      fixtureMode,
    }),
  };
}

export const actions = {
  issuePlayerInvite: async ({ cookies, fetch, params, request, url }) =>
    await issueHostScopedInvite({
      cookies,
      fetch,
      params,
      request,
      url,
      field: "playerInvite",
      tokenPrefix: "player",
      defaultPrincipalUserId: "player-mira",
      ackMessage: "Player invite issued",
      rejectMessage: "Player invite was rejected",
    }),
  issueReplacementInvite: async ({ cookies, fetch, params, request, url }) =>
    await issueHostScopedInvite({
      cookies,
      fetch,
      params,
      request,
      url,
      field: "replacementInvite",
      tokenPrefix: "replacement",
      defaultPrincipalUserId: "player-rowan",
      ackMessage: "Replacement invite issued",
      rejectMessage: "Replacement invite was rejected",
    }),
};

async function issueHostScopedInvite({
  cookies,
  fetch,
  params,
  request,
  url,
  field,
  tokenPrefix,
  defaultPrincipalUserId,
  ackMessage,
  rejectMessage,
}) {
  const sessionToken = cookies.get(SESSION_COOKIE_NAME);
  if (sessionToken === undefined || sessionToken.trim() === "") {
    return fail(401, inviteForm(field, {
      state: "reject",
      message: "Host session is required",
    }));
  }

  const formData = await request.formData();
  const principalUserId = invitePrincipal(
    formData.get("principalUserId"),
    defaultPrincipalUserId,
  );
  const returnTo = `/g/${params.game}`;
  const inviteToken = `${tokenPrefix}-${params.game}-${randomUUID()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const response = await fetch(authInvitesUrl(process.env), {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      principal_user_id: principalUserId,
      expires_at: expiresAt,
      game: params.game,
    }),
  });

  if (!response.ok) {
    return fail(response.status, inviteForm(field, {
      state: "reject",
      message: rejectMessage,
    }));
  }

  const invite = await response.json();
  const loginPath = inviteLoginPath({ returnTo, inviteToken });
  return inviteForm(field, {
    state: "ack",
    message: ackMessage,
    principalUserId: invite.principal_user_id,
    invitedByUserId: invite.invited_by_user_id,
    game: invite.game,
    returnTo,
    loginUrl: `${url.origin}${loginPath}`,
    loginPath,
    expiresAt: invite.expires_at,
  });
}

function inviteForm(field, invite) {
  return {
    [field]: invite,
  };
}

function invitePrincipal(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function inviteLoginPath({ returnTo, inviteToken }) {
  const params = new URLSearchParams({ returnTo, invite: inviteToken });
  return `/auth/login?${params.toString()}`;
}

function authInvitesUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/invites`;
}
