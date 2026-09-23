import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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

  const createGrantedSession = async ({
    principalId,
    globalCapabilities = [],
  }) => {
    const authorityPrincipalId = fixturePrincipalAuthorityId(principalId);
    const accountId = `live-stack-grant-${authorityPrincipalId}-${uuid()}@example.test`;
    const password = `live-stack grant password ${uuid()}`;
    await createAuthAccount({
      accountId,
      password,
      principalId: authorityPrincipalId,
      globalCapabilities,
    });
    const session = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rootAdminSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        principal_id: requirePrincipalAuthorityId(
          authorityPrincipalId,
          "session grant transport",
        ),
        expires_at: 4102444800,
        global_capabilities: globalCapabilities,
      }),
    });
    return {
      accountId,
      principalId: session.principal_id,
      sessionToken: requiredSessionToken(session),
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

function requiredSessionToken(session) {
  const token = session?.session_token;
  requireString(token, "auth response session_token");
  return token;
}

const FIXTURE_COMMAND_MAX_ATTEMPTS = 5;

// Fail-fast HTTP admission try-locks the command's source stream and answers a
// concurrent holder (another writer, a refresh fence) with a retryable
// StreamConflict. Fixture drivers retry exactly that reject, resending the
// identical serialized envelope so the command identity stays idempotent.
export function isRetryableStreamConflict(error) {
  const reject = error?.body?.body;
  return error?.status === 409
    && reject?.kind === "Reject"
    && reject.body?.error === "StreamConflict"
    && reject.body?.retryable === true;
}

export function createLiveStackCommandSender({
  apiBaseUrl,
  fetchJson,
  nextEnvelopeId,
  sessionTokenForPrincipal,
  uuid = randomUUID,
  pause = delay,
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
    const request = {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: 3,
        id: nextEnvelopeId(),
        body: {
          kind: "Command",
          body: {
            command_id: uuid(),
            command: transportCommand,
          },
        },
      }),
    };
    let response;
    for (let attempt = 1; ; attempt += 1) {
      try {
        response = await fetchJson(`${apiBaseUrl}/commands`, request);
        break;
      } catch (error) {
        if (!isRetryableStreamConflict(error) || attempt >= FIXTURE_COMMAND_MAX_ATTEMPTS) {
          throw error;
        }
        await pause(25 * attempt);
      }
    }
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
