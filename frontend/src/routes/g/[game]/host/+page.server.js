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
  issuePlayerInvite: async ({ cookies, fetch, locals, params, request, url }) =>
    await _issueHostScopedInvite({
      cookies,
      fetch,
      locals,
      params,
      request,
      url,
      field: "playerInvite",
      tokenPrefix: "player",
      defaultPrincipalUserId: "player-mira",
      ackMessage: "Player invite issued",
      rejectMessage: "Player invite was rejected",
    }),
  issueReplacementInvite: async ({ cookies, fetch, locals, params, request, url }) =>
    await _issueHostScopedInvite({
      cookies,
      fetch,
      locals,
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

export async function _issueHostScopedInvite({
  cookies,
  fetch,
  locals,
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
  const principalForProjection = resolveHostRoutePrincipal({
    game: params.game,
    locals,
  });
  if (principalForProjection === "") {
    return fail(401, inviteForm(field, {
      state: "reject",
      message: "Host session is required",
    }));
  }
  const principalUserId = invitePrincipal(
    formData.get("principalUserId"),
    defaultPrincipalUserId,
  );
  const accountId = inviteAccountId(formData.get("accountId"));
  if (accountId === "") {
    return fail(400, inviteForm(field, {
      state: "reject",
      message: "Invited account is required",
      principalUserId,
    }));
  }
  const slotId = inviteSlotId(formData.get("slotId"));
  const expectedOccupantUserId = invitePrincipal(
    formData.get("expectedOccupantUserId"),
    principalUserId,
  );
  const currentOccupant = await currentInviteTargetOccupant({
    fetch,
    game: params.game,
    principalUserId: principalForProjection,
    slotId,
    sessionToken,
  });
  if (currentOccupant !== expectedOccupantUserId) {
    return fail(409, inviteForm(field, {
      state: "reject",
      message: `Invite target is stale; ${slotId} is currently occupied by ${currentOccupant}`,
      principalUserId,
      slotId,
      expectedOccupantUserId,
      currentOccupantUserId: currentOccupant,
    }));
  }
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
      account_id: accountId,
      expected_principal_user_id: principalUserId,
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
  const loginPath = inviteLoginPath({
    returnTo,
    inviteToken,
    accountId: invite.account_id,
  });
  return inviteForm(field, {
    state: "ack",
    message: ackMessage,
    principalUserId: invite.principal_user_id,
    accountId: invite.account_id,
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

function inviteAccountId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function inviteSlotId(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "slot-7";
}

function inviteLoginPath({ returnTo, inviteToken, accountId }) {
  const params = new URLSearchParams({
    returnTo,
    invite: inviteToken,
    account: accountId,
  });
  return `/auth/login?${params.toString()}`;
}

async function currentInviteTargetOccupant({
  fetch,
  game,
  principalUserId,
  slotId,
  sessionToken,
}) {
  const response = await fetch(
    hostConsoleStateUrl(process.env, { game, principalUserId, slotId }),
    {
      headers: {
        authorization: `Bearer ${sessionToken}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`host invite target projection failed with ${response.status}`);
  }
  const state = await response.json();
  const slot = Array.isArray(state?.slots)
    ? state.slots.find((candidate) => candidate.slot_id === slotId)
    : null;
  if (typeof slot?.occupant_user_id !== "string" || slot.occupant_user_id.trim() === "") {
    throw new Error(`host invite target projection missing ${slotId}`);
  }
  return slot.occupant_user_id;
}

function authInvitesUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/invites`;
}

function hostConsoleStateUrl(env, { game, principalUserId, slotId }) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  const params = new URLSearchParams({
    principal_user_id: principalUserId,
    slot_id: slotId,
  });
  return `${baseUrl}/games/${encodeURIComponent(game)}/host-console-state?${params.toString()}`;
}
