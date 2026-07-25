import { createHash, randomUUID } from "node:crypto";

export function createLiveStackAuth({
  apiBaseUrl,
  fetchJson,
  rootAdminSessionToken,
  uuid = randomUUID,
}) {
  requireFunction(fetchJson, "fetchJson");
  requireString(apiBaseUrl, "apiBaseUrl");
  requireString(rootAdminSessionToken, "rootAdminSessionToken");

  const createAuthAccount = async ({
    accountId,
    password,
    principalUserId,
  }) => {
    await fetchJson(`${apiBaseUrl}/auth/accounts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rootAdminSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        password,
        principal_user_id: principalUserId,
      }),
    });
  };

  const createAccountSession = async ({ token, principalUserId, label }) => {
    const accountId = `live-stack-${label}-${uuid()}@example.test`;
    const password = `live-stack account password ${uuid()}`;
    await createAuthAccount({ accountId, password, principalUserId });
    const session = await fetchJson(`${apiBaseUrl}/auth/accounts/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        password,
        session_token: token,
        expires_at: 4102444800,
      }),
    });
    return {
      accountId,
      principalUserId: session.principal_user_id,
      capabilityKinds: (session.capabilities ?? []).map(
        (capability) => capability.kind,
      ),
      authentication: "enabled-account-login",
    };
  };

  const createGrantedSession = async ({
    token,
    principalUserId,
    globalCapabilities = [],
  }) => {
    const session = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rootAdminSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token,
        principal_user_id: principalUserId,
        expires_at: 4102444800,
        global_capabilities: globalCapabilities,
      }),
    });
    return {
      principalUserId: session.principal_user_id,
      capabilityKinds: (session.capabilities ?? []).map(
        (capability) => capability.kind,
      ),
    };
  };

  return Object.freeze({
    createAccountSession,
    createAuthAccount,
    createGrantedSession,
  });
}

export function createLiveStackCommandSender({
  apiBaseUrl,
  fetchJson,
  nextEnvelopeId,
  sessionTokenForPrincipal,
  uuid = randomUUID,
}) {
  requireString(apiBaseUrl, "apiBaseUrl");
  requireFunction(fetchJson, "fetchJson");
  requireFunction(nextEnvelopeId, "nextEnvelopeId");
  requireFunction(sessionTokenForPrincipal, "sessionTokenForPrincipal");

  return async function sendCommand(principalUserId, command) {
    const sessionToken = sessionTokenForPrincipal(principalUserId);
    if (typeof sessionToken !== "string" || sessionToken.trim() === "") {
      throw new Error(`live-stack command actor has no session: ${principalUserId}`);
    }
    const response = await fetchJson(`${apiBaseUrl}/commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: 1,
        id: nextEnvelopeId(),
        body: {
          kind: "Command",
          body: {
            command_id: uuid(),
            command,
          },
        },
      }),
    });
    if (response.body?.kind !== "Ack") {
      throw new Error(`seed command rejected: ${JSON.stringify(response)}`);
    }
    return {
      principalUserId,
      command,
      streamSeqs: response.body.body.stream_seqs,
    };
  };
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`live-stack ${name} function is required`);
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`live-stack ${name} is required`);
  }
}
