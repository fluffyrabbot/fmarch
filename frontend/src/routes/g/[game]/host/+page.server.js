import { randomUUID } from "node:crypto";
import { error, fail } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../../lib/app/app-route-state-model.mjs";
import { canonicalPrincipalId } from "../../../../lib/principal-id.mjs";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";
import { frontendFixtureMode } from "../../../../lib/server/runtime-mode.mjs";
import { loadHostGameplaySnapshot } from "../../../../lib/server/gameplay-api.mjs";
import {
  applyUpstreamSessionInvalidation,
  upstreamRouteFailure,
} from "../../../../lib/server/upstream-route.mjs";
import {
  authenticatedApiFetch,
  accessTokenForRequest,
} from "../../../../lib/server/session-capabilities.mjs";
import { buildHostConsoleStateEndpoint } from "../../../../lib/components/host-action/host-command-boundary.mjs";
import { workosAuthKitConfigured } from "../../../../lib/server/workos-authkit.mjs";
import {
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
  resolveHostConsoleAccess,
  resolveHostRouteCapabilities,
  resolveHostRoutePrincipal,
} from "./host-route-model.mjs";

export async function load({ params, locals, fetch, url, cookies }) {
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = frontendFixtureMode();
  const capabilities = resolveHostRouteCapabilities({
    game: params.game,
    locals,
  });
  const principalId = resolveHostRoutePrincipal({
    game: params.game,
    locals,
  });
  if (principalId === "") {
    throw error(403, "Host console requires an authenticated host session.");
  }
  const access = resolveHostConsoleAccess({ game: params.game, capabilities });
  if (!access.allowed) {
    throw error(403, hostConsoleForbiddenMessage(params.game));
  }
  let coldLoad = null;
  if (!fixtureMode) {
    const result = await loadHostGameplaySnapshot({
      game: params.game,
      expectedPrincipalId: principalId,
      expectedCapabilityKind: access.capability.kind,
      fetchImpl: authenticatedApiFetch({ cookies, fetchImpl: fetch }),
      apiBaseUrl,
      hostConsoleStateEndpoint: buildHostConsoleStateEndpoint({
        gameId: params.game,
        slotId: url?.searchParams.get("slot_id") || undefined,
        apiBaseUrl,
      }),
    });
    if (result.kind !== "ready") {
      const routeFailure = upstreamRouteFailure(result, { resource: "Host console" });
      applyUpstreamSessionInvalidation(cookies, routeFailure);
      throw error(routeFailure.status, routeFailure.message);
    }
    coldLoad = result.data;
  }
  const routeData = buildHostConsoleRouteData({
    game: params.game,
    capabilities,
    principalId,
    coldLoad,
    fixtureMode,
  });

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
  ackMessage,
  rejectMessage,
}) {
  const sessionToken = accessTokenForRequest({ cookies });
  if (sessionToken === null) {
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
  const principalId = canonicalPrincipalId(formData.get("principalId"));
  if (principalId === null) {
    return fail(400, inviteForm(field, {
      state: "reject",
      message: "Invited principal must be a canonical UUID",
    }));
  }
  const accountId = inviteAccountId(formData.get("accountId"));
  if (accountId === "") {
    return fail(400, inviteForm(field, {
      state: "reject",
      message: "Invited account is required",
      principalId,
    }));
  }
  const slotId = inviteSlotId(formData.get("slotId"));
  if (slotId === null) {
    return fail(400, inviteForm(field, {
      state: "reject",
      message: "Invite slot is required",
      principalId,
    }));
  }
  const expectedOccupantPrincipalId = canonicalPrincipalId(
    formData.get("expectedOccupantPrincipalId"),
  );
  if (expectedOccupantPrincipalId === null) {
    return fail(400, inviteForm(field, {
      state: "reject",
      message: "Expected occupant principal must be a canonical UUID",
      principalId,
      slotId,
    }));
  }
  let currentOccupant;
  try {
    currentOccupant = await currentInviteTargetOccupant({
      fetch,
      game: params.game,
      slotId,
      sessionToken,
    });
  } catch {
    return fail(502, inviteForm(field, {
      state: "reject",
      message: "Invite target projection is unavailable",
      principalId,
      slotId,
      expectedOccupantPrincipalId,
    }));
  }
  if (currentOccupant !== expectedOccupantPrincipalId) {
    return fail(409, inviteForm(field, {
      state: "reject",
      message: `Invite target is stale; ${slotId} is currently occupied by ${currentOccupant}`,
      principalId,
      slotId,
      expectedOccupantPrincipalId,
      currentOccupantPrincipalId: currentOccupant,
    }));
  }
  const returnTo = `/g/${params.game}`;
  if (workosAuthKitConfigured(process.env)) {
    const loginPath = workosInviteLoginPath({ returnTo, loginHint: accountId });
    return inviteForm(field, {
      state: "ack",
      message: ackMessage,
      principalId,
      accountId,
      invitedByPrincipalId: principalForProjection,
      game: params.game,
      returnTo,
      loginUrl: `${url.origin}${loginPath}`,
      loginPath,
      identityProvider: "workos",
    });
  }
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
      expected_principal_id: principalId,
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

  let invite;
  try {
    invite = await response.json();
  } catch {
    return fail(502, inviteForm(field, {
      state: "reject",
      message: "Invite service returned an invalid response",
    }));
  }
  const issuedPrincipalId = canonicalPrincipalId(invite?.principal_id);
  const invitedByPrincipalId = canonicalPrincipalId(invite?.invited_by_principal_id);
  if (
    issuedPrincipalId !== principalId ||
    invitedByPrincipalId !== principalForProjection ||
    invite?.account_id !== accountId ||
    invite?.game !== params.game
  ) {
    return fail(502, inviteForm(field, {
      state: "reject",
      message: "Invite service returned mismatched principal authority",
    }));
  }
  const loginPath = inviteLoginPath({
    returnTo,
    inviteToken,
    accountId: invite.account_id,
  });
  return inviteForm(field, {
    state: "ack",
    message: ackMessage,
    principalId: issuedPrincipalId,
    accountId: invite.account_id,
    invitedByPrincipalId,
    game: invite.game,
    returnTo,
    loginUrl: `${url.origin}${loginPath}`,
    loginPath,
    expiresAt: invite.expires_at,
    ...(typeof invite.delivery_status === "string"
      ? {
          deliveryId: invite.delivery_id,
          deliveryStatus: invite.delivery_status,
          deliveryProviderId: invite.delivery_provider_id,
          deliveryOutcomeKind: invite.delivery_outcome_kind,
        }
      : {}),
  });
}

function inviteForm(field, invite) {
  return {
    [field]: invite,
  };
}

function inviteAccountId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function inviteSlotId(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function inviteLoginPath({ returnTo, inviteToken, accountId }) {
  const params = new URLSearchParams({
    returnTo,
    invite: inviteToken,
    account: accountId,
  });
  return `/auth/game-invite?${params.toString()}`;
}

function workosInviteLoginPath({ returnTo, loginHint }) {
  const params = new URLSearchParams({ returnTo });
  if (loginHint.includes("@")) params.set("loginHint", loginHint);
  return `/auth/login/workos?${params.toString()}`;
}

async function currentInviteTargetOccupant({
  fetch,
  game,
  slotId,
  sessionToken,
}) {
  const response = await fetch(
    hostConsoleStateUrl(process.env, { game, slotId }),
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
  const principalId = canonicalPrincipalId(slot?.assigned_principal_id);
  if (principalId === null) {
    throw new Error(`host invite target projection missing canonical principal for ${slotId}`);
  }
  return principalId;
}

function authInvitesUrl(env) {
  return `${serverApiBaseUrl(env)}/auth/game-invitations`;
}

function hostConsoleStateUrl(env, { game, slotId }) {
  const baseUrl = serverApiBaseUrl(env);
  const params = new URLSearchParams({ slot_id: slotId });
  return `${baseUrl}/games/${encodeURIComponent(game)}/host-console-state?${params.toString()}`;
}
