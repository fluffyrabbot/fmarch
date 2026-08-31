import { createHash, randomUUID } from "node:crypto";
import {
  fixturePrincipalAuthorityId,
  fixturePrincipalTransport,
  requirePrincipalAuthorityId,
} from "../principal_fixture.mjs";

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
    principalId,
    globalCapabilities = [],
  }) => {
    const authorityPrincipalId = fixturePrincipalAuthorityId(principalId);
    requirePrincipalAuthorityId(
      authorityPrincipalId,
      "auth account transport",
    );
    await fetchJson(`${apiBaseUrl}/auth/accounts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rootAdminSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        password,
        principal_id: authorityPrincipalId,
        global_capabilities: globalCapabilities,
      }),
    });
  };

  const createAccountSession = async ({
    principalId,
    label,
    accountId: requestedAccountId,
    globalCapabilities = [],
  }) => {
    const authorityPrincipalId = fixturePrincipalAuthorityId(principalId);
    const accountId = requestedAccountId ?? `live-stack-${label}-${uuid()}@example.test`;
    const password = `live-stack account password ${uuid()}`;
    await createAuthAccount({
      accountId,
      password,
      principalId: authorityPrincipalId,
      globalCapabilities,
    });
    const session = await fetchJson(`${apiBaseUrl}/auth/accounts/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        password,
      }),
    });
    return {
      accountId,
      principalId: session.principal_id,
      sessionToken: requiredSessionToken(session),
      capabilityKinds: (session.capabilities ?? []).map(
        (capability) => capability.kind,
      ),
      authentication: "enabled-account-login",
    };
  };

  return Object.freeze({
    createAccountSession,
    createAuthAccount,
  });
}

function requiredSessionToken(session) {
  const token = session?.session_token;
  requireString(token, "auth response session_token");
  return token;
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

  return async function sendCommand(principalId, command) {
    const sessionToken = sessionTokenForPrincipal(principalId);
    if (typeof sessionToken !== "string" || sessionToken.trim() === "") {
      throw new Error(`live-stack command actor has no session: ${principalId}`);
    }
    const transportCommand = fixturePrincipalTransport(command, "command transport");
    const response = await fetchJson(`${apiBaseUrl}/commands`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: 2,
        id: nextEnvelopeId(),
        body: {
          kind: "Command",
          body: {
            command_id: uuid(),
            command: transportCommand,
          },
        },
      }),
    });
    if (response.body?.kind !== "Ack") {
      throw new Error(`seed command rejected: ${JSON.stringify(response)}`);
    }
    return {
      principalId,
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
