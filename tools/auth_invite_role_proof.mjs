import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { seedCommandPlanForGame } from "./dev_test_game.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "auth-invite-role-proof");
const evidencePath = path.join(artifactDir, "invite-role-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const game = randomUUID();
const rootAdminSessionToken = `invite-proof-root-admin-${game}`;
const inviteTokens = Object.freeze({
  admin: `invite-proof-admin-${game}`,
  host: `invite-proof-host-${game}`,
  player: `invite-proof-player-${game}`,
});
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://fmarch:fmarch@localhost:5544/fmarch",
  );
}

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "auth-invite-role-proof",
});

let proofDatabase;
let server;
let vite;
let browser;
let serverOutput = "";
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;

try {
  await mkdir(artifactDir, { recursive: true });
  proofDatabase = await createScratchDatabase(databaseUrl);
  const apiBaseUrl = await startApi(proofDatabase.url);
  await seedRootAdminSession(proofDatabase.url);
  const seedCommands = await seedGame(apiBaseUrl);
  const invites = await createInvites(apiBaseUrl);
  const frontendBaseUrl = await startFrontend(apiBaseUrl);
  browser = await chromium.launch();
  const proofRoles = {
    admin: await driveInviteLogin({
      frontendBaseUrl,
      apiBaseUrl,
      role: "admin",
      inviteToken: inviteTokens.admin,
      returnTo: "/admin",
      expectedCapability: "GlobalAdmin",
    }),
    host: await driveInviteLogin({
      frontendBaseUrl,
      apiBaseUrl,
      role: "host",
      inviteToken: inviteTokens.host,
      returnTo: `/g/${game}/host`,
      expectedCapability: "HostOf",
    }),
    player: await driveInviteLogin({
      frontendBaseUrl,
      apiBaseUrl,
      role: "player",
      inviteToken: inviteTokens.player,
      returnTo: `/g/${game}`,
      expectedCapability: "SlotOccupant",
    }),
  };
  const identityLifecycle = await proveIdentityLifecycle({
    apiBaseUrl,
    frontendBaseUrl,
    adminSessionToken: proofRoles.admin.sessionToken,
    hostSessionToken: proofRoles.host.sessionToken,
    hostReturnTo: `/g/${game}/host`,
  });
  const roles = redactProofRoles(proofRoles);

  const evidence = {
    version: 5,
    proof: "auth-invite-role-proof",
    status: "passed",
    releaseReady: false,
    scope: "local-auth-invite-role-proof",
    productionReady: false,
    proofBoundary:
      "Local scratch-Postgres plus local Rust API, SvelteKit login/action/admin-audit routes, and Chromium proof. Proves invite-issued sessions preserve the existing role-surface capability architecture for seeded admin, host, and player URLs, including GlobalAdmin discovery and inspection of local identity lifecycle audit rows from the admin overview; it does not prove production account recovery, email delivery, hosted identity, abuse controls, hosted audit retention/export, or beta release readiness.",
    identityAdapter: {
      status: "passed",
      replacesDevTokensWithoutRoleSurfaceChange: true,
      browserCookieName: "fmarch_session",
      sessionCredentialKind: "opaque-session",
      inviteCredentialKind: "single-use-invite",
      lifecycleControls: ["session-rotation", "session-revocation", "invite-revocation"],
      roleSurfacePattern: "/auth/login?returnTo=<role-surface>&invite=<token>",
      capabilityAuthority:
        "auth_session resolves principal_user_id and committed game/global capabilities at the API boundary",
    },
    identityLifecycle,
    game,
    database: {
      name: proofDatabase.name,
      lifecycle: "created-and-dropped-per-proof-run",
    },
    apiBaseUrl,
    frontendBaseUrl,
    seedCommands,
    invites,
    roles,
  };
  assertInviteProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "auth-invite-role-proof",
    stage: "invite-proof-listen",
  });
  if (!handled) {
    error.serverOutput = serverOutput.slice(-4000);
    throw error;
  }
} finally {
  if (browser !== undefined) {
    await browser.close();
  }
  if (vite !== undefined) {
    await vite.close();
  }
  if (server !== undefined) {
    await stopChild(server);
  }
  if (proofDatabase !== undefined) {
    await dropScratchDatabase(proofDatabase);
  }
  if (previousApiBaseUrl === undefined) {
    delete process.env.FMARCH_API_BASE_URL;
  } else {
    process.env.FMARCH_API_BASE_URL = previousApiBaseUrl;
  }
}

async function seedGame(apiBaseUrl) {
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlanForGame(game)) {
    commands.push(
      await sendCommand(apiBaseUrl, commands.length + 1, principalUserId, command),
    );
  }
  return commands;
}

async function seedRootAdminSession(url) {
  await runSql(url, `
    INSERT INTO auth_session (
      token_hash,
      principal_user_id,
      created_at,
      expires_at,
      revoked_at,
      global_capabilities
    )
    VALUES (
      ${sqlLiteral(hashSessionToken(rootAdminSessionToken))},
      'root_admin',
      0,
      4102444800,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[]
    );
  `);
}

async function createInvites(apiBaseUrl) {
  return {
    admin: await createInvite(apiBaseUrl, {
      inviteToken: inviteTokens.admin,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createInvite(apiBaseUrl, {
      inviteToken: inviteTokens.host,
      principalUserId: "host_h",
    }),
    player: await createInvite(apiBaseUrl, {
      inviteToken: inviteTokens.player,
      principalUserId: "player-mira",
    }),
  };
}

async function createInvite(
  apiBaseUrl,
  { inviteToken, principalUserId, globalCapabilities = [] },
) {
  const response = await fetchJson(`${apiBaseUrl}/auth/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      principal_user_id: principalUserId,
      expires_at: 4102444800,
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    principalUserId: response.principal_user_id,
    expiresAt: response.expires_at,
    globalCapabilities: response.global_capabilities,
  };
}

async function driveInviteLogin({
  frontendBaseUrl,
  apiBaseUrl,
  role,
  inviteToken,
  returnTo,
  expectedCapability,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(
    returnTo,
  )}&invite=${encodeURIComponent(inviteToken)}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
    const tokenValue = await page.getByTestId("auth-login-token").inputValue();
    if (tokenValue !== inviteToken) {
      throw new Error(`${role} invite token was not prefilled`);
    }
    await Promise.all([
      page.waitForURL(`${frontendBaseUrl}${returnTo}`, { timeout: 15000 }),
      page.getByTestId("auth-login-submit").click(),
    ]);
    await page.waitForLoadState("networkidle");
    const cookies = await page.context().cookies(frontendBaseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
    if (sessionCookie === undefined) {
      throw new Error(`${role} invite login did not set fmarch_session cookie`);
    }
    const session = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
      headers: { authorization: `Bearer ${sessionCookie.value}` },
    });
    const capabilityKinds = (session.capabilities ?? []).map(
      (capability) => capability.kind,
    );
    if (!capabilityKinds.includes(expectedCapability)) {
      throw new Error(
        `${role} invite session missing ${expectedCapability}: ${JSON.stringify(session)}`,
      );
    }
    const bodyText = await page.locator("body").innerText();
    if (!bodyText.includes(game) && role !== "admin") {
      throw new Error(`${role} invite URL did not render game ${game}`);
    }
    return {
      role,
      loginUrl,
      returnTo,
      principalUserId: session.principal_user_id,
      capabilityKinds,
      sessionToken: sessionCookie.value,
      cookie: {
        httpOnly: sessionCookie.httpOnly,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
        valuePrefix: sessionCookie.value.slice(0, "invite-session-".length),
      },
    };
  } finally {
    await page.close();
  }
}

async function proveIdentityLifecycle({
  apiBaseUrl,
  frontendBaseUrl,
  adminSessionToken,
  hostSessionToken,
  hostReturnTo,
}) {
  const rotatedSessionToken = `rotated-host-session-${game}`;
  const rotation = await rotateSession({
    apiBaseUrl,
    oldSessionToken: hostSessionToken,
    newSessionToken: rotatedSessionToken,
  });
  await assertUnauthorizedSession(apiBaseUrl, hostSessionToken);
  const rotatedSession = await assertSessionCapability({
    apiBaseUrl,
    token: rotatedSessionToken,
    expectedCapability: "HostOf",
  });
  await assertBrowserSessionRendersRole({
    frontendBaseUrl,
    sessionToken: rotatedSessionToken,
    returnTo: hostReturnTo,
    expectedText: game,
  });
  const sessionRevocation = await revokeSession({
    apiBaseUrl,
    token: rotatedSessionToken,
  });
  await assertUnauthorizedSession(apiBaseUrl, rotatedSessionToken);

  const revokedInviteToken = `revoked-host-invite-${game}`;
  await createInvite(apiBaseUrl, {
    inviteToken: revokedInviteToken,
    principalUserId: "host_h",
  });
  const inviteRevocation = await revokeInvite({
    apiBaseUrl,
    inviteToken: revokedInviteToken,
  });
  const revokedInviteReject = await driveRejectedInviteLogin({
    frontendBaseUrl,
    inviteToken: revokedInviteToken,
    returnTo: hostReturnTo,
  });

  const recoveryInviteToken = `recovery-host-invite-${game}`;
  await createInvite(apiBaseUrl, {
    inviteToken: recoveryInviteToken,
    principalUserId: "host_h",
  });
  const recovery = await driveInviteLogin({
    frontendBaseUrl,
    apiBaseUrl,
    role: "hostRecovery",
    inviteToken: recoveryInviteToken,
    returnTo: hostReturnTo,
    expectedCapability: "HostOf",
  });
  const auditTrail = await fetchIdentityLifecycleAudit({
    apiBaseUrl,
    principalUserId: "host_h",
  });
  const auditEventKinds = auditTrail.entries.map((entry) => entry.event_kind).sort();
  for (const eventKind of ["invite_revoked", "session_revoked", "session_rotated"]) {
    if (!auditEventKinds.includes(eventKind)) {
      throw new Error(`identity lifecycle audit missing ${eventKind}`);
    }
  }
  const auditText = JSON.stringify(auditTrail);
  for (const rawToken of [
    hostSessionToken,
    rotatedSessionToken,
    revokedInviteToken,
    recoveryInviteToken,
  ]) {
    if (auditText.includes(rawToken)) {
      throw new Error("identity lifecycle audit leaked a raw credential");
    }
  }
  const adminAuditSurface = await driveAdminIdentityAuditSurface({
    frontendBaseUrl,
    adminSessionToken,
    rawTokens: [
      hostSessionToken,
      rotatedSessionToken,
      revokedInviteToken,
      recoveryInviteToken,
    ],
  });

  return {
    status: "passed",
    sessionRotation: {
      status: "passed",
      principalUserId: rotation.principal_user_id,
      oldSessionRejected: true,
      rotatedSessionCapabilityKinds: (rotatedSession.capabilities ?? []).map(
        (capability) => capability.kind,
      ),
      sameRoleSurface: true,
    },
    sessionRevocation: {
      status: "passed",
      principalUserId: sessionRevocation.principal_user_id,
      revokedSessionRejected: true,
    },
    inviteRevocation: {
      status: "passed",
      principalUserId: inviteRevocation.principal_user_id,
      revokedInviteRejected: revokedInviteReject.status === "reject",
      recoveryCapabilityKinds: recovery.capabilityKinds,
      sameRoleSurface: new URL(recovery.loginUrl).searchParams.get("returnTo") === hostReturnTo,
    },
    auditTrail: {
      status: "passed",
      principalUserId: "host_h",
      eventKinds: auditEventKinds,
      actorUserIds: [
        ...new Set(
          auditTrail.entries
            .map((entry) => entry.actor_user_id)
            .filter((actorUserId) => actorUserId !== null),
        ),
      ].sort(),
      rawTokensStored: false,
    },
    adminAuditSurface,
    nonClaims: [
      "hosted account recovery",
      "email or out-of-band invite delivery",
      "rate limiting or abuse controls",
      "hosted audit retention or export policy",
    ],
  };
}

async function rotateSession({ apiBaseUrl, oldSessionToken, newSessionToken }) {
  return await fetchJson(`${apiBaseUrl}/auth/session-rotations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oldSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session_token: newSessionToken,
    }),
  });
}

async function revokeSession({ apiBaseUrl, token }) {
  return await fetchJson(`${apiBaseUrl}/auth/session-revocations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
}

async function revokeInvite({ apiBaseUrl, inviteToken }) {
  return await fetchJson(`${apiBaseUrl}/auth/invite-revocations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
    }),
  });
}

async function fetchIdentityLifecycleAudit({ apiBaseUrl, principalUserId }) {
  return await fetchJson(
    `${apiBaseUrl}/auth/identity-lifecycle-audit?principal_user_id=${encodeURIComponent(
      principalUserId,
    )}`,
    {
      headers: {
        authorization: `Bearer ${rootAdminSessionToken}`,
      },
    },
  );
}

async function driveAdminIdentityAuditSurface({
  frontendBaseUrl,
  adminSessionToken,
  rawTokens,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const overviewUrl = `${frontendBaseUrl}/admin?game=${encodeURIComponent(game)}`;
  const detailPath = `/admin/audit/identity-lifecycle?game=${encodeURIComponent(
    game,
  )}&principal_user_id=host_h`;
  const detailUrl = `${frontendBaseUrl}${detailPath}`;
  try {
    await page.context().addCookies([
      {
        name: "fmarch_session",
        value: adminSessionToken,
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(overviewUrl, { waitUntil: "networkidle" });
    await page.getByTestId("admin-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByTestId("admin-audit-link-identity-lifecycle").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(detailUrl, { timeout: 15000 }),
      page.getByTestId("admin-audit-link-identity-lifecycle").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const visibleEventKinds = [];
    for (const eventKind of ["session_rotated", "session_revoked", "invite_revoked"]) {
      await page.getByTestId(`admin-audit-entry-${eventKind}`).waitFor({
        state: "visible",
        timeout: 15000,
      });
      visibleEventKinds.push(eventKind);
    }
    const bodyText = await page.locator("body").innerText();
    if (!bodyText.includes("host_h")) {
      throw new Error("admin identity lifecycle audit did not show the host principal");
    }
    for (const rawToken of rawTokens) {
      if (bodyText.includes(rawToken)) {
        throw new Error("admin identity lifecycle audit leaked a raw credential");
      }
    }
    return {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
      linkTestId: "admin-audit-link-identity-lifecycle",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleEventKinds,
      principalUserId: "host_h",
      rawTokensVisible: false,
    };
  } finally {
    await page.close();
  }
}

async function assertUnauthorizedSession(apiBaseUrl, token) {
  const response = await fetchWithTimeout(`${apiBaseUrl}/auth/session?game=${game}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status !== 401) {
    throw new Error(`expected revoked session to be unauthorized, got ${response.status}`);
  }
}

async function assertSessionCapability({ apiBaseUrl, token, expectedCapability }) {
  const session = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const capabilityKinds = (session.capabilities ?? []).map(
    (capability) => capability.kind,
  );
  if (!capabilityKinds.includes(expectedCapability)) {
    throw new Error(`rotated session missing ${expectedCapability}`);
  }
  return session;
}

async function assertBrowserSessionRendersRole({
  frontendBaseUrl,
  sessionToken,
  returnTo,
  expectedText,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.context().addCookies([
      {
        name: "fmarch_session",
        value: sessionToken,
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${returnTo}`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    if (!bodyText.includes(expectedText)) {
      throw new Error("rotated browser session did not render the role surface");
    }
  } finally {
    await page.close();
  }
}

async function driveRejectedInviteLogin({ frontendBaseUrl, inviteToken, returnTo }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(
    returnTo,
  )}&invite=${encodeURIComponent(inviteToken)}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
    await page.getByTestId("auth-login-submit").click();
    await page.getByText("Session or invite token is missing, expired, or revoked").waitFor({
      state: "visible",
      timeout: 15000,
    });
    return {
      status: "reject",
      loginUrl,
      returnTo,
    };
  } finally {
    await page.close();
  }
}

function redactProofRoles(roles) {
  return Object.fromEntries(
    Object.entries(roles).map(([role, entry]) => {
      const { sessionToken: _sessionToken, ...redacted } = entry;
      return [role, redacted];
    }),
  );
}

function assertInviteProof(evidence) {
  if (
    evidence.version !== 5 ||
    evidence.proof !== "auth-invite-role-proof" ||
    evidence.status !== "passed" ||
    evidence.productionReady !== false ||
    evidence.releaseReady !== false
  ) {
    throw new Error("invite proof must pass locally without claiming production readiness");
  }
  if (
    evidence.identityAdapter?.replacesDevTokensWithoutRoleSurfaceChange !== true ||
    evidence.identityAdapter?.browserCookieName !== "fmarch_session" ||
    evidence.identityLifecycle?.status !== "passed" ||
    evidence.identityLifecycle?.sessionRotation?.oldSessionRejected !== true ||
    evidence.identityLifecycle?.sessionRevocation?.revokedSessionRejected !== true ||
    evidence.identityLifecycle?.inviteRevocation?.revokedInviteRejected !== true ||
    evidence.identityLifecycle?.auditTrail?.status !== "passed" ||
    evidence.identityLifecycle?.auditTrail?.rawTokensStored !== false ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("session_rotated") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("session_revoked") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("invite_revoked") ||
    evidence.identityLifecycle?.adminAuditSurface?.status !== "passed" ||
    evidence.identityLifecycle?.adminAuditSurface?.clickedThroughFromOverview !== true ||
    evidence.identityLifecycle?.adminAuditSurface?.rawTokensVisible !== false ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "session_rotated",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "session_revoked",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "invite_revoked",
    )
  ) {
    throw new Error("invite proof must preserve the role-surface identity adapter");
  }
  for (const [role, capability] of [
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]) {
    if (!evidence.roles[role].capabilityKinds.includes(capability)) {
      throw new Error(`${role} invite proof missing ${capability}`);
    }
    if (evidence.roles[role].cookie.valuePrefix !== "invite-session-") {
      throw new Error(`${role} invite proof did not use an invite-issued session`);
    }
  }
}

async function createScratchDatabase(sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const scratch = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sanitizeDatabaseName(sourceName)}_invite_${process.pid}_${Date.now()}`;
  scratch.pathname = `/${name}`;
  await runProcess("psql", [
    admin.toString(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${name}"`,
  ]);
  return { name, adminUrl: admin.toString(), url: scratch.toString() };
}

async function dropScratchDatabase({ adminUrl, name }) {
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${sqlLiteral(name)}`,
  ]);
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DROP DATABASE IF EXISTS "${name}"`,
  ]);
}

async function startApi(url) {
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      FMARCH_BIND: `${host}:${port}`,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  await waitForHealth(baseUrl);
  return baseUrl;
}

async function startFrontend(apiBaseUrl) {
  process.env.FMARCH_API_BASE_URL = apiBaseUrl;
  const previousCwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer: createViteServer } = await import(
      frontendRequire.resolve("vite")
    );
    vite = await createViteServer({
      root: frontendRoot,
      server: {
        host,
        port: 0,
        strictPort: false,
        proxy: {
          "/commands": apiBaseUrl,
          "/games": apiBaseUrl,
          "/ws": {
            target: apiBaseUrl,
            ws: true,
          },
        },
      },
      logLevel: "error",
    });
  } finally {
    process.chdir(previousCwd);
  }
  await vite.listen();
  const address = vite.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit invite proof server did not expose a TCP address");
  }
  return `http://${host}:${address.port}`;
}

async function sendCommand(apiBaseUrl, id, principalUserId, command) {
  const result = await fetchJson(`${apiBaseUrl}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 1,
      id,
      body: {
        kind: "Command",
        body: {
          command_id: randomUUID(),
          principal_user_id: principalUserId,
          command,
        },
      },
    }),
  });
  if (result.body?.kind !== "Ack") {
    throw new Error(`command rejected: ${JSON.stringify(result)}`);
  }
  return {
    principalUserId,
    kind: Object.keys(command)[0],
    streamSeqs: result.body.body.stream_seqs,
  };
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null || server?.signalCode !== null) {
      throw new Error(`Rust API exited before healthcheck:\n${serverOutput.slice(-4000)}`);
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/healthz`, {}, 1000);
      if (response.ok) {
        return;
      }
    } catch {
      // The Rust server may still be compiling, migrating, or binding.
    }
    await delay(250);
  }
  throw new Error(`Rust API did not become healthy at ${baseUrl}/healthz`);
}

async function runSql(url, sql) {
  return await runProcess("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

async function runProcess(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`${command} ${args[0]} failed with exit ${code}:\n${output}`);
  }
  return output;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGINT");
  const stopped = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000).then(() => "timeout"),
  ]);
  if (stopped === "timeout") {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address !== "object") {
          reject(new Error("free port server did not expose an address"));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  const prefix = sanitized === "" ? "fmarch" : sanitized;
  return prefix.slice(0, 20);
}
