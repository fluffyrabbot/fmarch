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
  assertDevTestGameIdentityAdapterContractPacket,
  buildDevTestGameIdentityAdapterContractPacket,
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterProofVersion,
} from "./dev_test_game_identity_adapter_contract.mjs";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "auth-invite-role-proof");
const configuredMediaRoot = process.env.FMARCH_MEDIA_ROOT;
if (configuredMediaRoot !== undefined && configuredMediaRoot.trim() === "") {
  throw new Error("FMARCH_MEDIA_ROOT must not be empty");
}
const mediaRoot =
  configuredMediaRoot === undefined
    ? path.join(artifactDir, "media-store")
    : path.resolve(repoRoot, configuredMediaRoot);
const evidencePath = path.join(artifactDir, "invite-role-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const game = randomUUID();
const rootAdminSessionToken = `invite-proof-root-admin-${game}`;
const seedSessionTokens = new Map();
const inviteTokens = Object.freeze({
  admin: `invite-proof-admin-${game}`,
  host: `invite-proof-host-${game}`,
  player: `invite-proof-player-${game}`,
});
const accountCredentials = Object.freeze({
  admin: Object.freeze({
    accountId: `admin-${game}@example.test`,
    password: `admin-account-password-${game}`,
  }),
  host: Object.freeze({
    accountId: `host-${game}@example.test`,
    password: `host-account-password-${game}`,
  }),
  player: Object.freeze({
    accountId: `player-${game}@example.test`,
    password: `player-account-password-${game}`,
  }),
});
const registrationCredentials = Object.freeze({
  accountId: `registered-${game}@example.test`,
  password: `registered-account-password-${game}`,
});
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const deliveryIntentPollTimeoutMs = 5000;
const deliveryIntentPollIntervalMs = 100;

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
  const accounts = await createAccounts(apiBaseUrl);
  const invites = await createInvites(apiBaseUrl);
  const frontendBaseUrl = await startFrontend(apiBaseUrl);
  browser = await chromium.launch();
  const proofRoles = {
    admin: await driveInviteLogin({
      frontendBaseUrl,
      apiBaseUrl,
      role: "admin",
      inviteToken: inviteTokens.admin,
      accountCredential: accountCredentials.admin,
      returnTo: "/admin",
      expectedCapability: "GlobalAdmin",
    }),
    host: await driveInviteLogin({
      frontendBaseUrl,
      apiBaseUrl,
      role: "host",
      inviteToken: inviteTokens.host,
      accountCredential: accountCredentials.host,
      returnTo: `/g/${game}/host`,
      expectedCapability: "HostOf",
    }),
    player: await driveInviteLogin({
      frontendBaseUrl,
      apiBaseUrl,
      role: "player",
      inviteToken: inviteTokens.player,
      accountCredential: accountCredentials.player,
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
    hostAccount: accountCredentials.host,
  });
  const roles = redactProofRoles(proofRoles);
  const identityAdapterContract = buildDevTestGameIdentityAdapterContractPacket({
    lifecycleStatus: identityLifecycle.status,
  });

  const evidence = {
    version: devTestGameIdentityAdapterProofVersion,
    proof: "auth-invite-role-proof",
    status: "passed",
    releaseReady: false,
    scope: "local-auth-invite-role-proof",
    productionReady: false,
    proofBoundary:
      "Local scratch-Postgres plus local Rust API, SvelteKit registration/login/logout/account-security/account-recovery/host/admin-audit routes, and Chromium proof. Proves Argon2id account credentials, bounded self-service registration into an unprivileged opaque session and seeded game pending-authority surface, hashed single-use recovery credentials, account-bound invite redemption, and a local account credential lifecycle preserve the existing role-surface capability architecture for seeded admin, host, and player URLs. Both invite and recovery issuance persist redacted typed delivery intents through a provider-neutral gateway, deterministically fail their first local-adapter attempt, record typed provider outcomes, observe the declared retry boundary, succeed through the GlobalAdmin retry transition, render the provider/outcome in the admin audit, and then reach the unchanged role surface without storing a raw credential. The lane also proves authenticated logout with denied role back navigation, atomic overdue-session rotation with one concurrent winner and a cleared stale loser, authenticated password rotation and account recovery with session revocation, invalid/expired/revoked/replayed recovery rejection, recovered-password return to the same host role URL, two-tier Postgres credential-attempt throttling with hashed account/source scopes, bounded unknown-account traffic, stale-row pruning, timing-equalized missing credentials, visible retry states, and post-lockout recovery to the same host role URL, host-role-surface game-scoped player invite issuance, GlobalAdmin account creation/disable/enable, stale account-session revocation, disabled-account login rejection, GlobalAdmin discovery, and inspection of local identity lifecycle audit rows from the admin overview; it does not prove real email or SMS traffic, provider bounce handling, hosted delivery availability, hosted identity, distributed or edge abuse controls, hosted password-parameter monitoring, hosted audit retention/export, or beta release readiness.",
    identityAdapter: {
      status: "passed",
      replacesDevTokensWithoutRoleSurfaceChange: true,
      browserCookieName: "fmarch_session",
      sessionCredentialKind: "opaque-session",
      inviteCredentialKind: "account-bound-single-use-invite",
      accountCredentialKind: "local-password-account",
      accountPasswordAlgorithm: "argon2id",
      accountRecoveryCredentialKind: "hashed-single-use-recovery-credential",
      credentialAttemptPolicyKind: "two-tier-postgres-account-source-lockout",
      credentialAttemptSourceKind: "sveltekit-client-address-to-trusted-api-header",
      lifecycleControls: [
        "account-disable",
        "account-enable",
        "account-password-rotation",
        "account-recovery-credential-issuance",
        "account-recovery-credential-revocation",
        "account-recovery",
        "account-registration",
        "credential-attempt-throttling",
        "session-rotation",
        "session-age-rotation",
        "session-logout",
        "session-revocation",
        "invite-revocation",
      ],
      delegatedIssuanceControls: ["host-scoped-invite-issuance"],
      roleSurfacePattern:
        "/auth/invite?returnTo=<role-surface>&invite=<token>&account=<account-id>",
      accountRoleSurfacePattern: "/auth/login/classic?returnTo=<role-surface>&account=<account-id>",
      accountSecurityRoleSurfacePattern:
        "/auth/account/security?account=<account-id>&returnTo=<role-surface>",
      accountRecoveryRoleSurfacePattern:
        "/auth/account/recovery?account=<account-id>&returnTo=<role-surface>",
      accountRegistrationRoleSurfacePattern:
        "/auth/register/classic?account=<account-id>&returnTo=<role-surface>",
      capabilityAuthority:
        "auth_session resolves principal_user_id and committed game/global capabilities at the API boundary",
    },
    identityAdapterContract,
    identityAdapterContractDiff:
      devTestGameIdentityAdapterContractDiff(identityAdapterContract),
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
    accounts,
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
    INSERT INTO auth_account (
      account_id,
      principal_user_id,
      password_hash,
      created_at,
      disabled_at,
      global_capabilities
    )
    VALUES (
      'root-admin-seed@local.fmarch.test',
      'root_admin',
      'seed-only-not-a-real-hash',
      0,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[]
    )
    ON CONFLICT (account_id) DO NOTHING;
  `);
  await runSql(url, `
    INSERT INTO auth_session (
      token_hash,
      principal_user_id,
      created_at,
      expires_at,
      revoked_at,
      global_capabilities,
      authenticated_at
    )
    VALUES (
      ${sqlLiteral(hashSessionToken(rootAdminSessionToken))},
      'root_admin',
      0,
      4102444800,
      NULL,
      ARRAY['GlobalAdmin']::TEXT[],
      0
    );
  `);
}

async function createInvites(apiBaseUrl) {
  return {
    admin: await createInvite(apiBaseUrl, {
      inviteToken: inviteTokens.admin,
      accountId: accountCredentials.admin.accountId,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createInvite(apiBaseUrl, {
      inviteToken: inviteTokens.host,
      accountId: accountCredentials.host.accountId,
      principalUserId: "host_h",
    }),
    player: await createInvite(apiBaseUrl, {
      inviteToken: inviteTokens.player,
      accountId: accountCredentials.player.accountId,
      principalUserId: "player-mira",
    }),
  };
}

async function createAccounts(apiBaseUrl) {
  return {
    admin: await createAccount(apiBaseUrl, {
      accountId: accountCredentials.admin.accountId,
      password: accountCredentials.admin.password,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
    }),
    host: await createAccount(apiBaseUrl, {
      accountId: accountCredentials.host.accountId,
      password: accountCredentials.host.password,
      principalUserId: "host_h",
    }),
    player: await createAccount(apiBaseUrl, {
      accountId: accountCredentials.player.accountId,
      password: accountCredentials.player.password,
      principalUserId: "player-mira",
    }),
  };
}

async function createAccount(
  apiBaseUrl,
  {
    accountId,
    password,
    principalUserId,
    globalCapabilities = [],
    bearerToken = rootAdminSessionToken,
  },
) {
  const response = await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: accountId,
      password,
      principal_user_id: principalUserId,
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    accountId: response.account_id,
    principalUserId: response.principal_user_id,
    globalCapabilities: response.global_capabilities,
  };
}

async function createInvite(
  apiBaseUrl,
  {
    inviteToken,
    accountId,
    principalUserId,
    globalCapabilities = [],
    gameScope = null,
    bearerToken = rootAdminSessionToken,
  },
) {
  const response = await fetchJson(`${apiBaseUrl}/auth/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      account_id: accountId,
      expected_principal_user_id: principalUserId,
      expires_at: 4102444800,
      ...(gameScope === null ? {} : { game: gameScope }),
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    accountId: response.account_id,
    principalUserId: response.principal_user_id,
    expiresAt: response.expires_at,
    game: response.game,
    globalCapabilities: response.global_capabilities,
    invitedByUserId: response.invited_by_user_id,
    deliveryId: response.delivery_id,
    deliveryStatus: response.delivery_status,
    deliveryAttemptCount: response.delivery_attempt_count,
    deliveryProviderId: response.delivery_provider_id,
    deliveryOutcomeKind: response.delivery_outcome_kind,
    deliveryOutcomeCode: response.delivery_outcome_code,
  };
}

async function driveInviteLogin({
  frontendBaseUrl,
  apiBaseUrl,
  role,
  inviteToken,
  accountCredential,
  returnTo,
  expectedCapability,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/invite?returnTo=${encodeURIComponent(
    returnTo,
  )}&invite=${encodeURIComponent(inviteToken)}&account=${encodeURIComponent(
    accountCredential.accountId,
  )}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-invite-surface").waitFor({ state: "visible" });
    const tokenValue = await page.getByTestId("auth-invite-token").inputValue();
    if (tokenValue !== inviteToken) {
      throw new Error(`${role} invite token was not prefilled`);
    }
    const accountValue = await page.getByTestId("auth-invite-account").inputValue();
    if (accountValue !== accountCredential.accountId) {
      throw new Error(`${role} invite account was not prefilled`);
    }
    await page.getByTestId("auth-invite-password").fill(accountCredential.password);
    await Promise.all([
      page.waitForURL(`${frontendBaseUrl}${returnTo}`, { timeout: 15000 }),
      page.getByTestId("auth-invite-submit").click(),
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
      accountId: accountCredential.accountId,
      capabilityKinds,
      sessionToken: sessionCookie.value,
      cookie: {
        httpOnly: sessionCookie.httpOnly,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
        valuePrefix: sessionCookie.value.slice(0, "fmss_".length),
      },
    };
  } finally {
    await page.close();
  }
}

async function driveAccountLogin({
  frontendBaseUrl,
  apiBaseUrl,
  accountId,
  password,
  returnTo,
  expectedCapability,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/login/classic?returnTo=${encodeURIComponent(
    returnTo,
  )}&account=${encodeURIComponent(accountId)}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-classic-surface").waitFor({ state: "visible" });
    const accountValue = await page.getByTestId("auth-login-account").inputValue();
    if (accountValue !== accountId) {
      throw new Error(`account login id was not prefilled: ${accountValue}`);
    }
    await page.getByTestId("auth-login-password").fill(password);
    await Promise.all([
      page.waitForURL(`${frontendBaseUrl}${returnTo}`, { timeout: 15000 }),
      page.getByTestId("auth-login-submit").click(),
    ]);
    await page.waitForLoadState("networkidle");
    const cookies = await page.context().cookies(frontendBaseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
    if (sessionCookie === undefined) {
      throw new Error("account login did not set fmarch_session cookie");
    }
    const session = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
      headers: { authorization: `Bearer ${sessionCookie.value}` },
    });
    const capabilityKinds = (session.capabilities ?? []).map(
      (capability) => capability.kind,
    );
    if (!capabilityKinds.includes(expectedCapability)) {
      throw new Error(
        `account session missing ${expectedCapability}: ${JSON.stringify(session)}`,
      );
    }
    const bodyText = await page.locator("body").innerText();
    if (!bodyText.includes(game)) {
      throw new Error(`account login did not render game ${game}`);
    }
    return {
      role: "hostAccount",
      loginUrl,
      returnTo,
      accountId,
      principalUserId: session.principal_user_id,
      capabilityKinds,
      sessionToken: sessionCookie.value,
      cookie: {
        httpOnly: sessionCookie.httpOnly,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
        valuePrefix: sessionCookie.value.slice(0, "fmss_".length),
      },
    };
  } finally {
    await page.close();
  }
}

async function driveAccountRegistration({
  apiBaseUrl,
  frontendBaseUrl,
  accountCredential,
  returnTo,
}) {
  const registrationRoleUrl = `/auth/register/classic?account=${encodeURIComponent(
    accountCredential.accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
  const securityRoleUrl = `/auth/account/security?account=${encodeURIComponent(
    accountCredential.accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  let sessionToken;
  let principalUserId;
  try {
    await page.goto(`${frontendBaseUrl}${registrationRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("auth-registration-classic-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByTestId("auth-registration-password").fill(accountCredential.password);
    await page
      .getByTestId("auth-registration-confirm-password")
      .fill(accountCredential.password);
    await Promise.all([
      page.waitForURL(`${frontendBaseUrl}${securityRoleUrl}`, { timeout: 15000 }),
      page.getByTestId("auth-registration-submit").click(),
    ]);
    await page.getByTestId("account-security-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const cookies = await page.context().cookies(frontendBaseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
    if (sessionCookie === undefined || !sessionCookie.value.startsWith("fmss_")) {
      throw new Error("account registration did not establish an opaque registration session");
    }
    sessionToken = sessionCookie.value;
    const session = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    principalUserId = session.principal_user_id;
    if (
      typeof principalUserId !== "string" ||
      !principalUserId.startsWith("registered-") ||
      (session.capabilities ?? []).length !== 0
    ) {
      throw new Error(`account registration session drifted: ${JSON.stringify(session)}`);
    }
    await page.goto(`${frontendBaseUrl}${returnTo}`, { waitUntil: "networkidle" });
    await page.getByTestId("route-state-player-empty").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const gameRoleText = await page.getByTestId("route-state-player-empty").innerText();
    if (!gameRoleText.includes("Slot authority is pending host replacement")) {
      throw new Error(`registered account game role recovery drifted: ${gameRoleText}`);
    }
  } finally {
    await page.close();
  }

  const duplicateContext = await browser.newContext();
  try {
    const duplicatePage = await duplicateContext.newPage();
    await duplicatePage.goto(`${frontendBaseUrl}${registrationRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await duplicatePage.getByTestId("auth-registration-password").fill(accountCredential.password);
    await duplicatePage
      .getByTestId("auth-registration-confirm-password")
      .fill(accountCredential.password);
    await duplicatePage.getByTestId("auth-registration-submit").click();
    await duplicatePage.getByTestId("auth-registration-reject").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const duplicateText = await duplicatePage.getByTestId("auth-registration-reject").innerText();
    const duplicateCookies = await duplicateContext.cookies(frontendBaseUrl);
    if (!duplicateText.includes("already exists") || duplicateCookies.some((cookie) => cookie.name === "fmarch_session")) {
      throw new Error(`account registration duplicate recovery drifted: ${duplicateText}`);
    }
  } finally {
    await duplicateContext.close();
  }

  const rateLimitContext = await browser.newContext();
  try {
    const rateLimitPage = await rateLimitContext.newPage();
    await rateLimitPage.goto(
      `${frontendBaseUrl}/auth/register/classic?account=${encodeURIComponent(
        `rate-limit-${game}@example.test`,
      )}&returnTo=${encodeURIComponent(returnTo)}`,
      { waitUntil: "networkidle" },
    );
    await rateLimitPage
      .getByTestId("auth-registration-password")
      .fill(`rate-limit-password-${game}`);
    await rateLimitPage
      .getByTestId("auth-registration-confirm-password")
      .fill(`rate-limit-password-${game}`);
    await rateLimitPage.getByTestId("auth-registration-submit").click();
    await rateLimitPage.getByTestId("auth-registration-reject").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const rateLimitText = await rateLimitPage.getByTestId("auth-registration-reject").innerText();
    if (!rateLimitText.includes("Too many registration attempts")) {
      throw new Error(`account registration rate limit recovery drifted: ${rateLimitText}`);
    }
  } finally {
    await rateLimitContext.close();
  }

  const registrationAttempts = await storedRegistrationAttemptRecords();
  if (
    registrationAttempts.length !== 1 ||
    registrationAttempts[0].scopeHash.length !== 64 ||
    registrationAttempts[0].attemptCount !== 3 ||
    registrationAttempts[0].blocked !== true
  ) {
    throw new Error(`account registration attempt storage drifted: ${JSON.stringify(registrationAttempts)}`);
  }
  return {
    registrationRoleUrl,
    securityRoleUrl,
    registrationSurfaceTestId: "auth-registration-classic-surface",
    securitySurfaceTestId: "account-security-surface",
    accountId: accountCredential.accountId,
    principalUserId,
    sessionToken,
    sessionCookiePrefix: "fmss_",
    sessionHasNoGameCapabilities: true,
    gameRolePendingReplacement: true,
    gameRoleRecoveryTestId: "route-state-player-empty",
    duplicateRejected: true,
    rateLimitVisible: true,
    rateLimitSeconds: 2,
    registrationScopeHashed: true,
    registrationScopeCount: registrationAttempts.length,
  };
}

async function proveCredentialAttemptThrottling({
  frontendBaseUrl,
  apiBaseUrl,
  accountId,
  password,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/login/classic?returnTo=${encodeURIComponent(
    returnTo,
  )}&account=${encodeURIComponent(accountId)}`;
  const wrongPassword = `throttled-wrong-password-${game}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-classic-surface").waitFor({ state: "visible" });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await page.getByTestId("auth-login-password").fill(wrongPassword);
      await page.getByTestId("auth-login-submit").click();
      const rejection = page.getByTestId("auth-login-reject");
      await rejection.waitFor({ state: "visible", timeout: 15000 });
      const rejectionText = (await rejection.innerText()).trim();
      if (
        attempt < 5 &&
        rejectionText !== "Account credentials are missing, disabled, or invalid"
      ) {
        throw new Error(`credential attempt ${attempt} rejected unexpectedly: ${rejectionText}`);
      }
      if (
        attempt === 5 &&
        !/^Too many credential attempts\. Try again in \d+ seconds\.$/.test(rejectionText)
      ) {
        throw new Error(`credential lockout did not expose retry timing: ${rejectionText}`);
      }
    }

    const storedAttempts = await storedAuthAttemptRecords();
    const blockedAttempts = storedAttempts.filter((attempt) => attempt.blocked);
    if (
      storedAttempts.length !== 2 ||
      blockedAttempts.length !== 1 ||
      storedAttempts.some(
        (attempt) =>
          attempt.failureCount !== 5 ||
          attempt.scopeHash.length !== 64 ||
          attempt.scopeHash.includes(accountId),
      )
    ) {
      throw new Error(
        `credential attempt policy did not store two hashed tiers with one lockout: ${JSON.stringify(storedAttempts)}`,
      );
    }

    await delay(2500);
    const recoveredLogin = await driveAccountLogin({
      frontendBaseUrl,
      apiBaseUrl,
      accountId,
      password,
      returnTo,
      expectedCapability: "HostOf",
    });
    const remainingAttempts = await storedAuthAttemptRecords();
    if (remainingAttempts.length !== 0) {
      throw new Error("successful post-lockout login did not clear credential attempts");
    }
    const unknownAccountBounding = await proveUnknownCredentialAttemptBounding({
      apiBaseUrl,
      frontendBaseUrl,
      accountId,
      password,
      returnTo,
    });
    return {
      status: "passed",
      loginUrl,
      rejectionTestId: "auth-login-reject",
      threshold: 5,
      sourceThreshold: 7,
      windowSeconds: 30,
      lockoutSeconds: 2,
      retentionSeconds: 120,
      retryTimingVisible: true,
      hashedScopeStored: true,
      storedScopeCount: storedAttempts.length,
      blockedScopeCount: blockedAttempts.length,
      rawAccountOrSourceStored: false,
      browserObservedOperation: "account-login",
      coveredCredentialOperations: [
        "account-login",
        "invite-redemption",
        "account-recovery",
      ],
      trustedSourceHeader: false,
      postLockoutCapabilityKinds: recoveredLogin.capabilityKinds,
      sameRoleSurface:
        new URL(recoveredLogin.loginUrl).searchParams.get("returnTo") === returnTo,
      successfulLoginClearedFailures: true,
      unknownAccountBounding,
      recoveredSessionToken: recoveredLogin.sessionToken,
      unknownAccountRecoveredSessionToken:
        unknownAccountBounding.recoveredSessionToken,
    };
  } finally {
    await page.close();
  }
}

async function proveUnknownCredentialAttemptBounding({
  apiBaseUrl,
  frontendBaseUrl,
  accountId,
  password,
  returnTo,
}) {
  await insertStaleAuthAttemptRecord();
  const requests = Array.from({ length: 7 }, (_, index) => {
    const unknownAccountId = `unknown-${index}-${game}@example.test`;
    const operation = ["account-login", "invite-redemption", "account-recovery"][index % 3];
    if (operation === "account-login") {
      return {
        operation,
        url: `${apiBaseUrl}/auth/accounts/login`,
        body: {
          account_id: unknownAccountId,
          password: `unknown-password-${game}`,
          session_token: `unknown-session-${index}-${game}`,
          expires_at: 4102444800,
        },
      };
    }
    if (operation === "invite-redemption") {
      return {
        operation,
        url: `${apiBaseUrl}/auth/invites/redeem`,
        body: {
          invite_token: `unknown-invite-${index}-${game}`,
          account_id: unknownAccountId,
          password: `unknown-password-${game}`,
          session_token: `unknown-invite-session-${index}-${game}`,
        },
      };
    }
    return {
      operation,
      url: `${apiBaseUrl}/auth/accounts/recoveries`,
      body: {
        account_id: unknownAccountId,
        recovery_token: `unknown-recovery-${index}-${game}`,
        new_password: `unknown-recovery-password-${game}`,
      },
    };
  });
  for (const [index, request] of requests.entries()) {
    const response = await fetchWithTimeout(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fmarch-auth-source": `spoofed-source-${index}`,
      },
      body: JSON.stringify(request.body),
    });
    const expectedStatus = index < 6 ? 401 : 429;
    if (response.status !== expectedStatus) {
      throw new Error(
        `unknown ${request.operation} attempt ${index + 1} returned ${response.status}, expected ${expectedStatus}`,
      );
    }
    if (index === 6 && !/^\d+$/.test(response.headers.get("retry-after") ?? "")) {
      throw new Error("unknown credential source lockout omitted Retry-After");
    }
    await response.json();
  }

  const storedAttempts = await storedAuthAttemptRecords();
  if (
    storedAttempts.length !== 1 ||
    storedAttempts[0].failureCount !== 7 ||
    storedAttempts[0].blocked !== true ||
    storedAttempts[0].scopeHash.length !== 64
  ) {
    throw new Error(
      `unknown credential attempts did not collapse into one source scope: ${JSON.stringify(storedAttempts)}`,
    );
  }
  await delay(2500);
  const recoveredLogin = await driveAccountLogin({
    frontendBaseUrl,
    apiBaseUrl,
    accountId,
    password,
    returnTo,
    expectedCapability: "HostOf",
  });
  if ((await storedAuthAttemptRecords()).length !== 0) {
    throw new Error("known login did not clear the expired source-pressure scope");
  }
  return {
    status: "passed",
    identifierCount: requests.length,
    storedScopeCount: storedAttempts.length,
    sourceThreshold: 7,
    spoofedSourceHeadersIgnored: true,
    staleRowsPruned: true,
    unknownCredentialWorkFactor: "argon2id-dummy-verification",
    operationKinds: [...new Set(requests.map((request) => request.operation))],
    retryAfterPresent: true,
    postLockoutCapabilityKinds: recoveredLogin.capabilityKinds,
    sameRoleSurface:
      new URL(recoveredLogin.loginUrl).searchParams.get("returnTo") === returnTo,
    recoveredSessionToken: recoveredLogin.sessionToken,
  };
}

async function driveAccountPasswordRotation({
  frontendBaseUrl,
  sessionToken,
  accountId,
  currentPassword,
  newPassword,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const securityRoleUrl = `/auth/account/security?account=${encodeURIComponent(
    accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
  const expectedLoginUrl = `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(
    returnTo,
  )}&account=${encodeURIComponent(accountId)}`;
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
    await page.goto(`${frontendBaseUrl}${securityRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("account-security-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const accountValue = await page
      .getByTestId("account-security-account")
      .inputValue();
    if (accountValue !== accountId) {
      throw new Error(`account security id was not prefilled: ${accountValue}`);
    }
    await page.getByTestId("account-security-current-password").fill(currentPassword);
    await page.getByTestId("account-security-new-password").fill(newPassword);
    await page.getByTestId("account-security-confirm-password").fill(newPassword);
    await Promise.all([
      page.waitForURL(expectedLoginUrl, { timeout: 15000 }),
      page.getByTestId("account-security-submit").click(),
    ]);
    await page.getByTestId("auth-login-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const cookies = await page.context().cookies(frontendBaseUrl);
    if (cookies.some((cookie) => cookie.name === "fmarch_session")) {
      throw new Error("password rotation did not clear the revoked browser session");
    }
    return {
      status: "passed",
      securityRoleUrl,
      surfaceTestId: "account-security-surface",
      accountPrefilled: true,
      revokedCookieCleared: true,
      loginReturnTo: returnTo,
    };
  } finally {
    await page.close();
  }
}

async function driveAccountRecoveryCredentialIssuance({
  frontendBaseUrl,
  sessionToken,
  accountId,
  currentPassword,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const securityRoleUrl = `/auth/account/security?account=${encodeURIComponent(
    accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
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
    await page.goto(`${frontendBaseUrl}${securityRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("account-security-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByTestId("account-recovery-issue-password").fill(currentPassword);
    await page.getByTestId("account-recovery-issue-submit").click();
    await page.getByTestId("account-recovery-issued").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const recoveryToken = (
      await page.getByTestId("account-recovery-issued-token").innerText()
    ).trim();
    const recoveryId = (
      await page.getByTestId("account-recovery-issued-id").innerText()
    ).trim();
    if (!recoveryToken.startsWith("account-recovery-") || recoveryId === "") {
      throw new Error("account security surface returned a malformed recovery credential");
    }
    return {
      status: "passed",
      securityRoleUrl,
      surfaceTestId: "account-security-surface",
      issueFormTestId: "account-recovery-issue-form",
      recoveryToken,
      recoveryId,
      rawTokenVisibleOnce: true,
    };
  } finally {
    await page.close();
  }
}

async function driveAccountRecoveryCredentialRevocation({
  frontendBaseUrl,
  sessionToken,
  accountId,
  currentPassword,
  recoveryId,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const securityRoleUrl = `/auth/account/security?account=${encodeURIComponent(
    accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
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
    await page.goto(`${frontendBaseUrl}${securityRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("account-recovery-revoke-id").fill(recoveryId);
    await page.getByTestId("account-recovery-revoke-password").fill(currentPassword);
    await page.getByTestId("account-recovery-revoke-submit").click();
    await page.getByTestId("account-recovery-revoke-status").waitFor({
      state: "visible",
      timeout: 15000,
    });
    return {
      status: "passed",
      securityRoleUrl,
      revokeFormTestId: "account-recovery-revoke-form",
      recoveryId,
    };
  } finally {
    await page.close();
  }
}

async function issueAccountRecoveryCredential({
  apiBaseUrl,
  sessionToken,
  accountId,
  currentPassword,
  expiresAt,
}) {
  const response = await fetchJson(`${apiBaseUrl}/auth/accounts/recovery-credentials`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: accountId,
      current_password: currentPassword,
      expires_at: expiresAt,
    }),
  });
  return {
    status: response.status,
    recoveryId: response.recovery_id,
    recoveryToken: response.recovery_token,
    expiresAt: response.expires_at,
  };
}

async function driveRejectedAccountRecovery({
  frontendBaseUrl,
  accountId,
  recoveryToken,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const recoveryRoleUrl = `/auth/account/recovery?account=${encodeURIComponent(
    accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
  try {
    await page.goto(`${frontendBaseUrl}${recoveryRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("account-recovery-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByTestId("account-recovery-token").fill(recoveryToken);
    await page
      .getByTestId("account-recovery-new-password")
      .fill(`rejected-recovery-password-${game}`);
    await page
      .getByTestId("account-recovery-confirm-password")
      .fill(`rejected-recovery-password-${game}`);
    await page.getByTestId("account-recovery-submit").click();
    await page.getByTestId("account-recovery-reject").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const rejectionText = await page.getByTestId("account-recovery-reject").innerText();
    if (!rejectionText.includes("missing, expired, revoked, used, or invalid")) {
      throw new Error(`account recovery rejection drifted: ${rejectionText}`);
    }
    return {
      status: "reject",
      recoveryRoleUrl,
      surfaceTestId: "account-recovery-surface",
      rejectionText,
    };
  } finally {
    await page.close();
  }
}

async function driveAccountRecovery({
  frontendBaseUrl,
  accountId,
  recoveryToken,
  newPassword,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const recoveryRoleUrl = `/auth/account/recovery?account=${encodeURIComponent(
    accountId,
  )}&returnTo=${encodeURIComponent(returnTo)}`;
  const expectedLoginUrl = `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(
    returnTo,
  )}&account=${encodeURIComponent(accountId)}`;
  try {
    await page.goto(`${frontendBaseUrl}${recoveryRoleUrl}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("account-recovery-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const accountValue = await page.getByTestId("account-recovery-account").inputValue();
    if (accountValue !== accountId) {
      throw new Error(`account recovery id was not prefilled: ${accountValue}`);
    }
    await page.getByTestId("account-recovery-token").fill(recoveryToken);
    await page.getByTestId("account-recovery-new-password").fill(newPassword);
    await page.getByTestId("account-recovery-confirm-password").fill(newPassword);
    await Promise.all([
      page.waitForURL(expectedLoginUrl, { timeout: 15000 }),
      page.getByTestId("account-recovery-submit").click(),
    ]);
    await page.getByTestId("auth-login-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    return {
      status: "passed",
      recoveryRoleUrl,
      surfaceTestId: "account-recovery-surface",
      accountPrefilled: true,
      loginReturnTo: returnTo,
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
  hostAccount,
}) {
  const accountRegistration = await driveAccountRegistration({
    apiBaseUrl,
    frontendBaseUrl,
    accountCredential: registrationCredentials,
    returnTo: `/g/${game}`,
  });
  const rotatedSessionToken = `rotated-host-session-${game}`;
  const rotatedHostPassword = `rotated-host-password-${game}`;
  const recoveredHostPassword = `recovered-host-password-${game}`;
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
    accountId: hostAccount.accountId,
    principalUserId: "host_h",
  });
  const inviteRevocation = await revokeInvite({
    apiBaseUrl,
    inviteToken: revokedInviteToken,
  });
  const revokedInviteReject = await driveRejectedInviteLogin({
    frontendBaseUrl,
    inviteToken: revokedInviteToken,
    accountCredential: hostAccount,
    returnTo: hostReturnTo,
  });

  const recoveryInviteToken = `recovery-host-invite-${game}`;
  const recoveryInvite = await createInvite(apiBaseUrl, {
    inviteToken: recoveryInviteToken,
    accountId: hostAccount.accountId,
    principalUserId: "host_h",
  });
  const inviteDelivery = await retryFailedDelivery({
    apiBaseUrl,
    deliveryId: recoveryInvite.deliveryId,
    expectedKind: "invite",
  });
  const recovery = await driveInviteLogin({
    frontendBaseUrl,
    apiBaseUrl,
    role: "hostRecovery",
    inviteToken: recoveryInviteToken,
    accountCredential: hostAccount,
    returnTo: hostReturnTo,
    expectedCapability: "HostOf",
  });
  const hostScopedInviteIssuance = await proveHostScopedInviteIssuance({
    apiBaseUrl,
    frontendBaseUrl,
    hostSessionToken: recovery.sessionToken,
    hostReturnTo,
    playerAccount: accountCredentials.player,
  });
  const accountLogin = await driveAccountLogin({
    frontendBaseUrl,
    apiBaseUrl,
    accountId: hostAccount.accountId,
    password: hostAccount.password,
    returnTo: hostReturnTo,
    expectedCapability: "HostOf",
  });
  await assertBrowserSessionRendersRole({
    frontendBaseUrl,
    sessionToken: accountLogin.sessionToken,
    returnTo: hostReturnTo,
    expectedText: game,
  });
  const browserLogoutLogin = await driveAccountLogin({
    frontendBaseUrl,
    apiBaseUrl,
    accountId: hostAccount.accountId,
    password: hostAccount.password,
    returnTo: hostReturnTo,
    expectedCapability: "HostOf",
  });
  const browserLogout = await driveBrowserLogout({
    apiBaseUrl,
    frontendBaseUrl,
    sessionToken: browserLogoutLogin.sessionToken,
    returnTo: hostReturnTo,
  });
  const overdueSessionLogin = await driveAccountLogin({
    frontendBaseUrl,
    apiBaseUrl,
    accountId: hostAccount.accountId,
    password: hostAccount.password,
    returnTo: hostReturnTo,
    expectedCapability: "HostOf",
  });
  const overdueSessionRotation = await driveOverdueBrowserSessionRotation({
    apiBaseUrl,
    frontendBaseUrl,
    sessionToken: overdueSessionLogin.sessionToken,
    returnTo: hostReturnTo,
  });
  const staleAccountLifecyclePage = await openAdminAccountLifecyclePage({
    frontendBaseUrl,
    adminSessionToken,
    accountId: hostAccount.accountId,
  });
  let staleAccountLifecycleConflict;
  let staleAccountLifecycleReloadRecovery;
  const accountDisableControl = await driveAdminAccountLifecycleControl({
    frontendBaseUrl,
    adminSessionToken,
    accountId: hostAccount.accountId,
    action: "disable",
  });
  try {
    await assertUnauthorizedSession(apiBaseUrl, accountLogin.sessionToken);
    const disabledAccountReject = await driveRejectedAccountLogin({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      password: hostAccount.password,
      returnTo: hostReturnTo,
    });
    staleAccountLifecycleConflict = await submitAdminAccountLifecycleControl({
      page: staleAccountLifecyclePage.page,
      accountId: hostAccount.accountId,
      action: "enable",
      expectedState: "reject",
      expectedText: "stale account lifecycle state",
    });
    staleAccountLifecycleReloadRecovery =
      await reloadStaleAdminAccountLifecyclePage({
        page: staleAccountLifecyclePage.page,
        accountId: hostAccount.accountId,
        detailRoleUrl: staleAccountLifecyclePage.detailRoleUrl,
      });
    const accountEnableControl = await submitAdminAccountLifecycleControl({
      page: staleAccountLifecyclePage.page,
      accountId: hostAccount.accountId,
      action: "enable",
      expectedState: "ack",
      expectedText: `${hostAccount.accountId} enabled`,
      detailRoleUrl: staleAccountLifecyclePage.detailRoleUrl,
    });
    const accountRecoveryLogin = await driveAccountLogin({
      frontendBaseUrl,
      apiBaseUrl,
      accountId: hostAccount.accountId,
      password: hostAccount.password,
      returnTo: hostReturnTo,
      expectedCapability: "HostOf",
    });
    await assertBrowserSessionRendersRole({
      frontendBaseUrl,
      sessionToken: accountRecoveryLogin.sessionToken,
      returnTo: hostReturnTo,
      expectedText: game,
    });
    const activeRecoveryCredential = await driveAccountRecoveryCredentialIssuance({
      frontendBaseUrl,
      sessionToken: accountRecoveryLogin.sessionToken,
      accountId: hostAccount.accountId,
      currentPassword: hostAccount.password,
      returnTo: hostReturnTo,
    });
    const recoveryDelivery = await retryFailedDeliveryForCredential({
      apiBaseUrl,
      credential: activeRecoveryCredential.recoveryToken,
      expectedKind: "recovery",
    });
    const revokedRecoveryCredential = await driveAccountRecoveryCredentialIssuance({
      frontendBaseUrl,
      sessionToken: accountRecoveryLogin.sessionToken,
      accountId: hostAccount.accountId,
      currentPassword: hostAccount.password,
      returnTo: hostReturnTo,
    });
    const recoveryCredentialRevocation = await driveAccountRecoveryCredentialRevocation({
      frontendBaseUrl,
      sessionToken: accountRecoveryLogin.sessionToken,
      accountId: hostAccount.accountId,
      currentPassword: hostAccount.password,
      recoveryId: revokedRecoveryCredential.recoveryId,
      returnTo: hostReturnTo,
    });
    const expiredRecoveryCredential = await issueAccountRecoveryCredential({
      apiBaseUrl,
      sessionToken: accountRecoveryLogin.sessionToken,
      accountId: hostAccount.accountId,
      currentPassword: hostAccount.password,
      expiresAt: Math.floor(Date.now() / 1000) + 2,
    });
    const accountPasswordRotation = await driveAccountPasswordRotation({
      frontendBaseUrl,
      sessionToken: accountRecoveryLogin.sessionToken,
      accountId: hostAccount.accountId,
      currentPassword: hostAccount.password,
      newPassword: rotatedHostPassword,
      returnTo: hostReturnTo,
    });
    await assertUnauthorizedSession(apiBaseUrl, accountRecoveryLogin.sessionToken);
    const oldPasswordReject = await driveRejectedAccountLogin({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      password: hostAccount.password,
      returnTo: hostReturnTo,
    });
    const rotatedPasswordLogin = await driveAccountLogin({
      frontendBaseUrl,
      apiBaseUrl,
      accountId: hostAccount.accountId,
      password: rotatedHostPassword,
      returnTo: hostReturnTo,
      expectedCapability: "HostOf",
    });
    await assertBrowserSessionRendersRole({
      frontendBaseUrl,
      sessionToken: rotatedPasswordLogin.sessionToken,
      returnTo: hostReturnTo,
      expectedText: game,
    });
    const invalidRecoveryReject = await driveRejectedAccountRecovery({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      recoveryToken: `invalid-recovery-${game}`,
      returnTo: hostReturnTo,
    });
    const revokedRecoveryReject = await driveRejectedAccountRecovery({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      recoveryToken: revokedRecoveryCredential.recoveryToken,
      returnTo: hostReturnTo,
    });
    await delay(
      Math.max(0, (expiredRecoveryCredential.expiresAt + 1) * 1000 - Date.now()),
    );
    const expiredRecoveryReject = await driveRejectedAccountRecovery({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      recoveryToken: expiredRecoveryCredential.recoveryToken,
      returnTo: hostReturnTo,
    });
    const accountRecovery = await driveAccountRecovery({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      recoveryToken: activeRecoveryCredential.recoveryToken,
      newPassword: recoveredHostPassword,
      returnTo: hostReturnTo,
    });
    await assertUnauthorizedSession(apiBaseUrl, rotatedPasswordLogin.sessionToken);
    const replayedRecoveryReject = await driveRejectedAccountRecovery({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      recoveryToken: activeRecoveryCredential.recoveryToken,
      returnTo: hostReturnTo,
    });
    const rotatedPasswordReject = await driveRejectedAccountLogin({
      frontendBaseUrl,
      accountId: hostAccount.accountId,
      password: rotatedHostPassword,
      returnTo: hostReturnTo,
    });
    const recoveredPasswordLogin = await driveAccountLogin({
      frontendBaseUrl,
      apiBaseUrl,
      accountId: hostAccount.accountId,
      password: recoveredHostPassword,
      returnTo: hostReturnTo,
      expectedCapability: "HostOf",
    });
    await assertBrowserSessionRendersRole({
      frontendBaseUrl,
      sessionToken: recoveredPasswordLogin.sessionToken,
      returnTo: hostReturnTo,
      expectedText: game,
    });
    const credentialAttemptThrottling = await proveCredentialAttemptThrottling({
      frontendBaseUrl,
      apiBaseUrl,
      accountId: hostAccount.accountId,
      password: recoveredHostPassword,
      returnTo: hostReturnTo,
    });
    return await finishIdentityLifecycleProof({
      apiBaseUrl,
      frontendBaseUrl,
      adminSessionToken,
      hostSessionToken,
      rotatedSessionToken,
      browserLogout,
      overdueSessionRotation,
      revokedInviteToken,
      recoveryInviteToken,
      accountLogin,
      accountRecoveryLogin,
      accountPasswordRotation,
      oldPasswordReject,
      rotatedPasswordLogin,
      rotatedHostPassword,
      recoveredPasswordLogin,
      recoveredHostPassword,
      credentialAttemptThrottling,
      activeRecoveryCredential,
      revokedRecoveryCredential,
      expiredRecoveryCredential,
      recoveryCredentialRevocation,
      invalidRecoveryReject,
      revokedRecoveryReject,
      expiredRecoveryReject,
      replayedRecoveryReject,
      rotatedPasswordReject,
      accountRecovery,
      accountDisableControl,
      accountEnableControl,
      staleAccountLifecycleConflict,
      staleAccountLifecycleReloadRecovery,
      disabledAccountReject,
      hostScopedInviteIssuance,
      rotation,
      rotatedSession,
      sessionRevocation,
      inviteRevocation,
      revokedInviteReject,
      recovery,
      hostReturnTo,
      hostAccount,
      accountRegistration,
      inviteDelivery,
      recoveryDelivery,
    });
  } finally {
    await staleAccountLifecyclePage.page.close();
  }
}

async function finishIdentityLifecycleProof({
  apiBaseUrl,
  frontendBaseUrl,
  adminSessionToken,
  hostSessionToken,
  rotatedSessionToken,
  browserLogout,
  overdueSessionRotation,
  revokedInviteToken,
  recoveryInviteToken,
  accountLogin,
  accountRecoveryLogin,
  accountPasswordRotation,
  oldPasswordReject,
  rotatedPasswordLogin,
  rotatedHostPassword,
  recoveredPasswordLogin,
  recoveredHostPassword,
  credentialAttemptThrottling,
  activeRecoveryCredential,
  revokedRecoveryCredential,
  expiredRecoveryCredential,
  recoveryCredentialRevocation,
  invalidRecoveryReject,
  revokedRecoveryReject,
  expiredRecoveryReject,
  replayedRecoveryReject,
  rotatedPasswordReject,
  accountRecovery,
  accountDisableControl,
  accountEnableControl,
  staleAccountLifecycleConflict,
  staleAccountLifecycleReloadRecovery,
  disabledAccountReject,
  hostScopedInviteIssuance,
  rotation,
  rotatedSession,
  sessionRevocation,
  inviteRevocation,
  revokedInviteReject,
  recovery,
  hostReturnTo,
  hostAccount,
  accountRegistration,
  inviteDelivery,
  recoveryDelivery,
}) {
  const auditTrail = await fetchIdentityLifecycleAudit({
    apiBaseUrl,
    principalUserId: "host_h",
  });
  const auditEventKinds = auditTrail.entries.map((entry) => entry.event_kind).sort();
  const passwordRotationAudit = auditTrail.entries.find(
    (entry) => entry.event_kind === "account_password_rotated",
  );
  const accountRecoveryAudit = auditTrail.entries.find(
    (entry) => entry.event_kind === "account_recovered",
  );
  const registrationAuditTrail = await fetchIdentityLifecycleAudit({
    apiBaseUrl,
    principalUserId: accountRegistration.principalUserId,
  });
  const registrationAuditEventKinds = registrationAuditTrail.entries
    .map((entry) => entry.event_kind)
    .sort();
  for (const eventKind of ["account_registered", "account_session_created"]) {
    if (!registrationAuditEventKinds.includes(eventKind)) {
      throw new Error(`account registration audit missing ${eventKind}`);
    }
  }
  for (const eventKind of [
    "account_created",
    "account_disabled",
    "account_enabled",
    "account_session_created",
    "account_password_rotated",
    "account_recovery_credential_issued",
    "account_recovery_credential_revoked",
    "account_recovery_rejected",
    "account_recovered",
    "auth_attempt_rate_limited",
    "auth_delivery_queued",
    "auth_delivery_retryable_failed",
    "auth_delivery_retried",
    "invite_redeemed",
    "invite_revoked",
    "session_logged_out",
    "session_revoked",
    "session_rotated",
  ]) {
    if (!auditEventKinds.includes(eventKind)) {
      throw new Error(`identity lifecycle audit missing ${eventKind}`);
    }
  }
  const deliveryRetryAudit = auditTrail.entries.find(
    (entry) => entry.event_kind === "auth_delivery_retried",
  );
  if (deliveryRetryAudit?.actor_user_id !== "root_admin") {
    throw new Error("delivery retry audit did not identify the GlobalAdmin actor");
  }
  if ((passwordRotationAudit?.metadata?.revoked_session_count ?? 0) < 1) {
    throw new Error("password rotation audit did not record revoked sessions");
  }
  if ((accountRecoveryAudit?.metadata?.revoked_session_count ?? 0) < 1) {
    throw new Error("account recovery audit did not record revoked sessions");
  }
  const storedRecoveryCredentials = await storedRecoveryCredentialRecords();
  const rawRecoveryTokens = [
    activeRecoveryCredential.recoveryToken,
    revokedRecoveryCredential.recoveryToken,
    expiredRecoveryCredential.recoveryToken,
  ];
  const storedRecoveryText = JSON.stringify(storedRecoveryCredentials);
  if (
    storedRecoveryCredentials.length !== 3 ||
    rawRecoveryTokens.some((token) => storedRecoveryText.includes(token))
  ) {
    throw new Error("account recovery credentials were not stored as redacted hashes");
  }
  const auditText = JSON.stringify(auditTrail);
  for (const rawToken of [
    hostSessionToken,
    rotatedSessionToken,
    browserLogout.oldSessionToken,
    overdueSessionRotation.oldSessionToken,
    overdueSessionRotation.rotatedSessionToken,
    revokedInviteToken,
    recoveryInviteToken,
    accountLogin.sessionToken,
    accountRecoveryLogin.sessionToken,
    rotatedPasswordLogin.sessionToken,
    recoveredPasswordLogin.sessionToken,
    credentialAttemptThrottling.recoveredSessionToken,
    credentialAttemptThrottling.unknownAccountRecoveredSessionToken,
    hostAccount.password,
    registrationCredentials.password,
    accountRegistration.sessionToken,
    rotatedHostPassword,
    recoveredHostPassword,
    ...rawRecoveryTokens,
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
      browserLogout.oldSessionToken,
      overdueSessionRotation.oldSessionToken,
      overdueSessionRotation.rotatedSessionToken,
      revokedInviteToken,
      recoveryInviteToken,
      accountLogin.sessionToken,
      accountRecoveryLogin.sessionToken,
      rotatedPasswordLogin.sessionToken,
      recoveredPasswordLogin.sessionToken,
      credentialAttemptThrottling.recoveredSessionToken,
      credentialAttemptThrottling.unknownAccountRecoveredSessionToken,
      hostAccount.password,
      registrationCredentials.password,
      accountRegistration.sessionToken,
      rotatedHostPassword,
      recoveredHostPassword,
      ...rawRecoveryTokens,
    ],
  });

  return {
    status: "passed",
    localDelivery: {
      status: "passed",
      adapter: "local-deterministic",
      gateway: "provider-neutral-delivery-gateway-v1",
      providerId: "local-deterministic",
      typedOutcomes: true,
      invite: inviteDelivery,
      recovery: recoveryDelivery,
      retryActorUserId: deliveryRetryAudit.actor_user_id,
      rawCredentialsStored: false,
    },
    accountRegistration: {
      status: "passed",
      registrationRoleUrl: accountRegistration.registrationRoleUrl,
      securityRoleUrl: accountRegistration.securityRoleUrl,
      registrationSurfaceTestId: accountRegistration.registrationSurfaceTestId,
      securitySurfaceTestId: accountRegistration.securitySurfaceTestId,
      accountId: accountRegistration.accountId,
      principalUserId: accountRegistration.principalUserId,
      sessionCookiePrefix: accountRegistration.sessionCookiePrefix,
      sessionHasNoGameCapabilities: accountRegistration.sessionHasNoGameCapabilities,
      gameRolePendingReplacement: accountRegistration.gameRolePendingReplacement,
      gameRoleRecoveryTestId: accountRegistration.gameRoleRecoveryTestId,
      duplicateRejected: accountRegistration.duplicateRejected,
      rateLimitVisible: accountRegistration.rateLimitVisible,
      rateLimitSeconds: accountRegistration.rateLimitSeconds,
      registrationScopeHashed: accountRegistration.registrationScopeHashed,
      registrationScopeCount: accountRegistration.registrationScopeCount,
      rawPasswordStored: false,
      auditEventKinds: registrationAuditEventKinds,
    },
    sessionRotation: {
      status: "passed",
      principalUserId: rotation.principal_user_id,
      oldSessionRejected: true,
      rotatedSessionCapabilityKinds: (rotatedSession.capabilities ?? []).map(
        (capability) => capability.kind,
      ),
      sameRoleSurface: true,
    },
    sessionAgeRotation: {
      status: "passed",
      maxAgeSeconds: overdueSessionRotation.maxAgeSeconds,
      oldSessionRejected: overdueSessionRotation.oldSessionRejected,
      rotatedSessionCapabilityKinds: overdueSessionRotation.rotatedSessionCapabilityKinds,
      winnerRenderedRole: overdueSessionRotation.winnerRenderedRole,
      staleLoserCookieCleared: overdueSessionRotation.staleLoserCookieCleared,
      staleLoserDeniedStatus: overdueSessionRotation.staleLoserDeniedStatus,
    },
    sessionLogout: {
      status: "passed",
      logoutRoleUrl: browserLogout.logoutRoleUrl,
      logoutSurfaceTestId: browserLogout.logoutSurfaceTestId,
      oldSessionRejected: browserLogout.oldSessionRejected,
      cookieCleared: browserLogout.cookieCleared,
      backNavigationDeniedStatus: browserLogout.backNavigationDeniedStatus,
      backNavigationRecoveryTestId: browserLogout.backNavigationRecoveryTestId,
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
    hostScopedInviteIssuance,
    accountLogin: {
      status: "passed",
      principalUserId: accountLogin.principalUserId,
      accountId: accountLogin.accountId,
      capabilityKinds: accountLogin.capabilityKinds,
      sameRoleSurface:
        new URL(accountLogin.loginUrl).searchParams.get("returnTo") === hostReturnTo,
      cookieValuePrefix: accountLogin.cookie.valuePrefix,
      rawPasswordStored: false,
    },
    accountPasswordRotation: {
      status: "passed",
      passwordAlgorithm: "argon2id",
      securityRoleUrl: accountPasswordRotation.securityRoleUrl,
      securitySurfaceTestId: accountPasswordRotation.surfaceTestId,
      accountPrefilled: accountPasswordRotation.accountPrefilled,
      staleSessionRejected: true,
      oldPasswordRejected: oldPasswordReject.status === "reject",
      newPasswordCapabilityKinds: rotatedPasswordLogin.capabilityKinds,
      sameRoleSurface:
        new URL(rotatedPasswordLogin.loginUrl).searchParams.get("returnTo") ===
        hostReturnTo,
      revokedSessionCount: passwordRotationAudit.metadata.revoked_session_count,
      rawPasswordStored: false,
    },
    accountRecovery: {
      status: "passed",
      credentialKind: "hashed-single-use-recovery-credential",
      passwordAlgorithm: "argon2id",
      securityRoleUrl: activeRecoveryCredential.securityRoleUrl,
      recoveryRoleUrl: accountRecovery.recoveryRoleUrl,
      securitySurfaceTestId: activeRecoveryCredential.surfaceTestId,
      recoverySurfaceTestId: accountRecovery.surfaceTestId,
      issueFormTestId: activeRecoveryCredential.issueFormTestId,
      revokeFormTestId: recoveryCredentialRevocation.revokeFormTestId,
      accountPrefilled: accountRecovery.accountPrefilled,
      rawCredentialVisibleOnce: activeRecoveryCredential.rawTokenVisibleOnce,
      rawCredentialStored: false,
      invalidCredentialRejected: invalidRecoveryReject.status === "reject",
      expiredCredentialRejected: expiredRecoveryReject.status === "reject",
      revokedCredentialRejected: revokedRecoveryReject.status === "reject",
      replayedCredentialRejected: replayedRecoveryReject.status === "reject",
      priorSessionRejected: true,
      priorPasswordRejected: rotatedPasswordReject.status === "reject",
      recoveredPasswordCapabilityKinds: recoveredPasswordLogin.capabilityKinds,
      sameRoleSurface:
        new URL(recoveredPasswordLogin.loginUrl).searchParams.get("returnTo") ===
        hostReturnTo,
      revokedSessionCount: accountRecoveryAudit.metadata.revoked_session_count,
      storedCredentialCount: storedRecoveryCredentials.length,
      usedCredentialCount: storedRecoveryCredentials.filter((entry) => entry.used)
        .length,
      revokedCredentialCount: storedRecoveryCredentials.filter(
        (entry) => entry.revoked,
      ).length,
    },
    credentialAttemptThrottling: {
      status: credentialAttemptThrottling.status,
      policyKind: "two-tier-postgres-account-source-lockout",
      loginUrl: credentialAttemptThrottling.loginUrl,
      rejectionTestId: credentialAttemptThrottling.rejectionTestId,
      threshold: credentialAttemptThrottling.threshold,
      sourceThreshold: credentialAttemptThrottling.sourceThreshold,
      windowSeconds: credentialAttemptThrottling.windowSeconds,
      lockoutSeconds: credentialAttemptThrottling.lockoutSeconds,
      retentionSeconds: credentialAttemptThrottling.retentionSeconds,
      retryTimingVisible: credentialAttemptThrottling.retryTimingVisible,
      hashedScopeStored: credentialAttemptThrottling.hashedScopeStored,
      storedScopeCount: credentialAttemptThrottling.storedScopeCount,
      blockedScopeCount: credentialAttemptThrottling.blockedScopeCount,
      rawAccountOrSourceStored: credentialAttemptThrottling.rawAccountOrSourceStored,
      browserObservedOperation: credentialAttemptThrottling.browserObservedOperation,
      coveredCredentialOperations: credentialAttemptThrottling.coveredCredentialOperations,
      trustedSourceHeader: credentialAttemptThrottling.trustedSourceHeader,
      postLockoutCapabilityKinds: credentialAttemptThrottling.postLockoutCapabilityKinds,
      sameRoleSurface: credentialAttemptThrottling.sameRoleSurface,
      successfulLoginClearedFailures:
        credentialAttemptThrottling.successfulLoginClearedFailures,
      unknownAccountBounding: {
        status: credentialAttemptThrottling.unknownAccountBounding.status,
        identifierCount:
          credentialAttemptThrottling.unknownAccountBounding.identifierCount,
        storedScopeCount:
          credentialAttemptThrottling.unknownAccountBounding.storedScopeCount,
        sourceThreshold:
          credentialAttemptThrottling.unknownAccountBounding.sourceThreshold,
        spoofedSourceHeadersIgnored:
          credentialAttemptThrottling.unknownAccountBounding
            .spoofedSourceHeadersIgnored,
        staleRowsPruned:
          credentialAttemptThrottling.unknownAccountBounding.staleRowsPruned,
        unknownCredentialWorkFactor:
          credentialAttemptThrottling.unknownAccountBounding
            .unknownCredentialWorkFactor,
        operationKinds:
          credentialAttemptThrottling.unknownAccountBounding.operationKinds,
        retryAfterPresent:
          credentialAttemptThrottling.unknownAccountBounding.retryAfterPresent,
        postLockoutCapabilityKinds:
          credentialAttemptThrottling.unknownAccountBounding
            .postLockoutCapabilityKinds,
        sameRoleSurface:
          credentialAttemptThrottling.unknownAccountBounding.sameRoleSurface,
      },
    },
    accountLifecycle: {
      status: "passed",
      disabledStatus: accountDisableControl.statusText,
      enabledStatus: accountEnableControl.statusText,
      adminControlSurface: {
        status: "passed",
        detailRoleUrl: accountDisableControl.detailRoleUrl,
        controlsTestId: accountDisableControl.controlsTestId,
        disabledStatusTestId: accountDisableControl.statusTestId,
        enabledStatusTestId: accountEnableControl.statusTestId,
        disabledStatusText: accountDisableControl.visibleStatusText,
        enabledStatusText: accountEnableControl.visibleStatusText,
        staleConflictStatusTestId: staleAccountLifecycleConflict.statusTestId,
        staleConflictStatusText: staleAccountLifecycleConflict.visibleStatusText,
        reloadRecoveryStatus:
          staleAccountLifecycleReloadRecovery.reloadedTargetState,
        reloadRecoveryDetailRoleUrl:
          staleAccountLifecycleReloadRecovery.detailRoleUrl,
        reloadRecoveryTargetText:
          staleAccountLifecycleReloadRecovery.targetText,
        visitedDetailRoleUrl:
          accountDisableControl.visitedDetailRoleUrl &&
          accountEnableControl.visitedDetailRoleUrl &&
          staleAccountLifecycleReloadRecovery.visitedDetailRoleUrl,
      },
      disabledAccountRejected: disabledAccountReject.status === "reject",
      staleAccountSessionRejected: true,
      staleAdminControlRejected: staleAccountLifecycleConflict.status === "passed",
      staleAdminControlReloadRecovered:
        staleAccountLifecycleReloadRecovery.status === "passed" &&
        accountEnableControl.status === "passed",
      recoveryCapabilityKinds: accountRecoveryLogin.capabilityKinds,
      sameRoleSurface:
        new URL(accountRecoveryLogin.loginUrl).searchParams.get("returnTo") ===
        hostReturnTo,
      revokedSessionCount: accountDisableControl.revokedSessionCount,
      disabledAtPresent: true,
      enabledDisabledAtCleared: true,
      rawPasswordStored: false,
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
      "hosted account recovery delivery or traffic",
      "hosted password parameter monitoring or credential reset policy",
      "email or out-of-band invite delivery",
      "cross-game invite restrictions beyond recorded local game scope",
      "hosted distributed or edge abuse controls",
      "hosted audit retention or export policy",
    ],
  };
}

async function proveHostScopedInviteIssuance({
  apiBaseUrl,
  frontendBaseUrl,
  hostSessionToken,
  hostReturnTo,
  playerAccount,
}) {
  const hostSurface = await driveHostPlayerInviteSurface({
    frontendBaseUrl,
    hostSessionToken,
    hostReturnTo,
    playerAccount,
  });
  const issued = await storedInviteRecord(hostSurface.inviteToken);
  if (
    issued.invitedByUserId !== "host_h" ||
    issued.principalUserId !== "player-mira" ||
    issued.accountId !== playerAccount.accountId
  ) {
    throw new Error(
      `host-scoped invite row did not match host surface: ${JSON.stringify(issued)}`,
    );
  }
  if (issued.game !== game) {
    throw new Error(
      `host-scoped invite row did not preserve game scope: ${JSON.stringify(issued)}`,
    );
  }
  if (issued.globalCapabilities.length !== 0) {
    throw new Error("host-scoped invite unexpectedly granted global capabilities");
  }
  const player = await driveInviteLogin({
    frontendBaseUrl,
    apiBaseUrl,
    role: "hostSurfacePlayerInvite",
    inviteToken: hostSurface.inviteToken,
    accountCredential: playerAccount,
    returnTo: `/g/${game}`,
    expectedCapability: "SlotOccupant",
  });
  await assertBrowserSessionRendersRole({
    frontendBaseUrl,
    sessionToken: player.sessionToken,
    returnTo: `/g/${game}`,
    expectedText: game,
  });
  await assertBrowserSessionRendersRole({
    frontendBaseUrl,
    sessionToken: hostSessionToken,
    returnTo: hostReturnTo,
    expectedText: game,
  });
  return {
    status: "passed",
    issuingCapability: "HostOf(game)",
    hostRoleSurface: hostSurface.roleSurface,
    hostAction: "?/issuePlayerInvite",
    hostPanelTestId: "host-player-invite-panel",
    clickedThroughFromHostRoleUrl: hostSurface.clickedThroughFromHostRoleUrl,
    issuedByPrincipalUserId: issued.invitedByUserId,
    issuedForGame: hostSurface.game,
    storedGameScope: issued.game,
    principalUserId: player.principalUserId,
    boundAccountId: issued.accountId,
    accountBindingRequired: true,
    globalCapabilitiesGranted: issued.globalCapabilities.length,
    redeemedCapabilityKinds: player.capabilityKinds,
    sameRoleSurface:
      new URL(player.loginUrl).searchParams.get("returnTo") === `/g/${game}`,
    hostRoleSurfaceStillValid: true,
    rawInviteTokenStored: false,
  };
}

async function driveHostPlayerInviteSurface({
  frontendBaseUrl,
  hostSessionToken,
  hostReturnTo,
  playerAccount,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.context().addCookies([
      {
        name: "fmarch_session",
        value: hostSessionToken,
        url: frontendBaseUrl,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${frontendBaseUrl}${hostReturnTo}`, { waitUntil: "networkidle" });
    const inviteDrawer = page.getByTestId("host-invite-workflows");
    await inviteDrawer.waitFor({ state: "visible" });
    await inviteDrawer.evaluate((node) => {
      node.open = true;
    });
    await page.getByTestId("host-player-invite-panel").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const targetText = await page.getByTestId("host-player-invite-target").innerText();
    if (!targetText.includes("player-mira")) {
      throw new Error(`host player invite target drifted: ${targetText}`);
    }
    await page
      .getByTestId("host-player-invite-account")
      .fill(playerAccount.accountId);
    await page.getByTestId("host-player-invite-submit").click();
    await page.getByTestId("host-player-invite-url").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const statusText = await page.getByTestId("host-player-invite-status").innerText();
    if (!statusText.includes("Player invite issued")) {
      throw new Error(`host player invite status drifted: ${statusText}`);
    }
    const href = await page.getByTestId("host-player-invite-url").getAttribute("href");
    const loginUrl = new URL(href, frontendBaseUrl);
    const inviteToken = loginUrl.searchParams.get("invite");
    const returnTo = loginUrl.searchParams.get("returnTo");
    const accountId = loginUrl.searchParams.get("account");
    if (
      loginUrl.pathname !== "/auth/invite" ||
      inviteToken === null ||
      !inviteToken.startsWith(`player-${game}-`) ||
      returnTo !== `/g/${game}` ||
      accountId !== playerAccount.accountId
    ) {
      throw new Error(`host player invite URL drifted: ${loginUrl.toString()}`);
    }
    return {
      roleSurface: hostReturnTo,
      targetPrincipalUserId: "player-mira",
      game,
      loginUrl: loginUrl.toString(),
      returnTo,
      accountId,
      inviteToken,
      clickedThroughFromHostRoleUrl: true,
    };
  } finally {
    await page.close();
  }
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

async function retryFailedDelivery({ apiBaseUrl, deliveryId, expectedKind }) {
  if (typeof deliveryId !== "string" || deliveryId === "") {
    throw new Error("delivery issuance did not return a delivery id");
  }
  await delay(1100);
  const response = await fetchJson(
    `${apiBaseUrl}/auth/delivery-intents/${encodeURIComponent(deliveryId)}/retry`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${rootAdminSessionToken}` },
    },
  );
  if (
    response.status !== "delivered" ||
    response.delivery_id !== deliveryId ||
    response.delivery_kind !== expectedKind ||
    response.attempt_count !== 2 ||
    response.delivery_provider_id !== "local-deterministic" ||
    response.delivery_outcome_kind !== "delivered" ||
    response.delivery_outcome_code !== null
  ) {
    throw new Error(`delivery retry drifted: ${JSON.stringify(response)}`);
  }
  return {
    deliveryId,
    deliveryKind: expectedKind,
    status: response.status,
    attemptCount: response.attempt_count,
    providerId: response.delivery_provider_id,
    outcomeKind: response.delivery_outcome_kind,
    outcomeCode: response.delivery_outcome_code,
  };
}

async function retryFailedDeliveryForCredential({ apiBaseUrl, credential, expectedKind }) {
  const delivery = await waitForRetryableDeliveryIntent({
    credentialHash: hashSessionToken(credential),
    expectedKind,
  });
  if (
    delivery.deliveryKind !== expectedKind ||
    delivery.status !== "retryable_failed" ||
    delivery.providerId !== "local-deterministic" ||
    delivery.outcomeKind !== "retryable_failure" ||
    delivery.outcomeCode !== "local_transient"
  ) {
    throw new Error(`stored delivery intent drifted: ${JSON.stringify(delivery)}`);
  }
  return await retryFailedDelivery({
    apiBaseUrl,
    deliveryId: delivery.deliveryId,
    expectedKind,
  });
}

async function waitForRetryableDeliveryIntent({ credentialHash, expectedKind }) {
  const deadline = Date.now() + deliveryIntentPollTimeoutMs;
  let lastDelivery;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      lastDelivery = await storedDeliveryIntent(credentialHash);
      if (
        lastDelivery.deliveryKind === expectedKind &&
        lastDelivery.status === "retryable_failed" &&
        lastDelivery.providerId === "local-deterministic" &&
        lastDelivery.outcomeKind === "retryable_failure" &&
        lastDelivery.outcomeCode === "local_transient"
      ) {
        return lastDelivery;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(deliveryIntentPollIntervalMs);
  }
  if (lastDelivery !== undefined) {
    return lastDelivery;
  }
  throw lastError ?? new Error("delivery intent was not persisted");
}

async function disableAccount({ apiBaseUrl, accountId }) {
  return await fetchJson(`${apiBaseUrl}/auth/accounts/disable`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: accountId,
    }),
  });
}

async function enableAccount({ apiBaseUrl, accountId }) {
  return await fetchJson(`${apiBaseUrl}/auth/accounts/enable`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: accountId,
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

async function driveAdminAccountLifecycleControl({
  frontendBaseUrl,
  adminSessionToken,
  accountId,
  action,
}) {
  const opened = await openAdminAccountLifecyclePage({
    frontendBaseUrl,
    adminSessionToken,
    accountId,
  });
  try {
    return await submitAdminAccountLifecycleControl({
      page: opened.page,
      accountId,
      action,
      expectedState: "ack",
      expectedText:
        action === "disable" ? `${accountId} disabled` : `${accountId} enabled`,
      detailRoleUrl: opened.detailRoleUrl,
    });
  } finally {
    await opened.page.close();
  }
}

async function openAdminAccountLifecyclePage({
  frontendBaseUrl,
  adminSessionToken,
  accountId,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const detailPath = `/admin/audit/identity-lifecycle?game=${encodeURIComponent(
    game,
  )}&principal_user_id=host_h`;
  const detailUrl = `${frontendBaseUrl}${detailPath}`;
  await page.context().addCookies([
    {
      name: "fmarch_session",
      value: adminSessionToken,
      url: frontendBaseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(detailUrl, { waitUntil: "networkidle" });
  await page.getByTestId("admin-audit-detail-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.getByTestId("admin-identity-account-controls").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const targetText = await page
    .getByTestId("admin-identity-account-control-target")
    .innerText();
  if (!targetText.includes(accountId) || !targetText.includes("host_h")) {
    await page.close();
    throw new Error(`admin account lifecycle target drifted: ${targetText}`);
  }
  return {
    page,
    detailRoleUrl:
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
  };
}

async function reloadStaleAdminAccountLifecyclePage({
  page,
  accountId,
  detailRoleUrl,
}) {
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("admin-identity-account-controls").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const targetText = await page
    .getByTestId("admin-identity-account-control-target")
    .innerText();
  if (!targetText.includes(accountId) || !targetText.includes("disabled")) {
    throw new Error(
      `admin account lifecycle reload did not show disabled target: ${targetText}`,
    );
  }
  return {
    status: "passed",
    detailRoleUrl,
    controlsTestId: "admin-identity-account-controls",
    targetTestId: "admin-identity-account-control-target",
    targetText,
    reloadedTargetState: "disabled",
    visitedDetailRoleUrl: true,
  };
}

async function submitAdminAccountLifecycleControl({
  page,
  accountId,
  action,
  expectedState,
  expectedText,
  detailRoleUrl = "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
}) {
  const actionConfig =
    action === "disable"
      ? {
          buttonTestId: "admin-identity-account-disable-submit",
          statusTestId: "admin-identity-account-disable-status",
          statusText: "disabled",
        }
      : {
          buttonTestId: "admin-identity-account-enable-submit",
          statusTestId: "admin-identity-account-enable-status",
          statusText: "enabled",
        };
  await page.getByTestId(actionConfig.buttonTestId).click();
  await page.getByTestId(actionConfig.statusTestId).waitFor({
    state: "visible",
    timeout: 15000,
  });
  const statusLocator = page.getByTestId(actionConfig.statusTestId);
  const visibleStatusText = await statusLocator.innerText();
  const state = await statusLocator.getAttribute("data-state");
  if (state !== expectedState || !visibleStatusText.includes(expectedText)) {
    throw new Error(
      `admin account ${action} status drifted: ${state} ${visibleStatusText}`,
    );
  }
  return {
    status: "passed",
    statusText: actionConfig.statusText,
    detailRoleUrl,
    controlsTestId: "admin-identity-account-controls",
    statusTestId: actionConfig.statusTestId,
    visibleStatusText,
    revokedSessionCount:
      action === "disable" ? revokedSessionCountFromStatus(visibleStatusText) : 0,
    visitedDetailRoleUrl: true,
  };
}

function revokedSessionCountFromStatus(statusText) {
  const match = /revoked\s+(\d+)\s+sessions/u.exec(statusText);
  if (match === null) {
    throw new Error(`admin account lifecycle status missing revoked count: ${statusText}`);
  }
  return Number(match[1]);
}

async function storedInviteRecord(inviteToken) {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  const output = await runProcess("psql", [
    proofDatabase.url,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    `
      SELECT json_build_object(
        'accountId', account_id,
        'principalUserId', principal_user_id,
        'game', COALESCE(game::TEXT, ''),
        'invitedByUserId', invited_by_user_id,
        'globalCapabilities', COALESCE(to_json(global_capabilities), '[]'::JSON)
      )::TEXT
      FROM auth_invite
      WHERE token_hash = ${sqlLiteral(hashSessionToken(inviteToken))}
    `,
  ]);
  const json = output.trim();
  if (json === "") {
    throw new Error("stored invite row was not found");
  }
  return JSON.parse(json);
}

async function storedRecoveryCredentialRecords() {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  const output = await runProcess("psql", [
    proofDatabase.url,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    `
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'recoveryId', recovery_id,
            'tokenHash', token_hash,
            'used', used_at IS NOT NULL,
            'revoked', revoked_at IS NOT NULL,
            'expired', expires_at <= EXTRACT(EPOCH FROM NOW())::BIGINT
          )
          ORDER BY created_at, recovery_id
        ),
        '[]'::JSON
      )::TEXT
      FROM auth_account_recovery_credential
    `,
  ]);
  return JSON.parse(output.trim() || "[]");
}

async function storedAuthAttemptRecords() {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  const output = await runProcess("psql", [
    proofDatabase.url,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    `
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'scopeHash', scope_hash,
            'failureCount', failure_count,
            'blocked', blocked_until > EXTRACT(EPOCH FROM NOW())::BIGINT
          )
          ORDER BY scope_hash
        ),
        '[]'::JSON
      )::TEXT
      FROM auth_credential_attempt
    `,
  ]);
  return JSON.parse(output.trim() || "[]");
}

async function storedRegistrationAttemptRecords() {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  const output = await runProcess("psql", [
    proofDatabase.url,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    `
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'scopeHash', scope_hash,
            'attemptCount', attempt_count,
            'blocked', blocked_until > EXTRACT(EPOCH FROM NOW())::BIGINT
          )
          ORDER BY scope_hash
        ),
        '[]'::JSON
      )::TEXT
      FROM auth_registration_attempt
    `,
  ]);
  return JSON.parse(output.trim() || "[]");
}

async function storedDeliveryIntent(credentialHash) {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  const output = await runProcess("psql", [
    proofDatabase.url,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    `
      SELECT json_build_object(
        'deliveryId', delivery_id,
        'deliveryKind', delivery_kind,
        'status', status,
        'attemptCount', attempt_count,
        'credentialHash', credential_hash,
        'providerId', provider_id,
        'outcomeKind', outcome_kind,
        'outcomeCode', outcome_code
      )::TEXT
      FROM auth_delivery_intent
      WHERE credential_hash = ${sqlLiteral(credentialHash)}
    `,
  ]);
  const trimmed = output.trim();
  if (trimmed === "") {
    throw new Error("delivery intent was not persisted");
  }
  return JSON.parse(trimmed);
}

async function insertStaleAuthAttemptRecord() {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  await runProcess("psql", [
    proofDatabase.url,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `
      INSERT INTO auth_credential_attempt (
        scope_hash, window_started_at, failure_count, blocked_until, updated_at
      )
      VALUES ('stale-proof-scope', 0, 1, NULL, 0)
    `,
  ]);
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
    // Healthy diagnostics collapse by default; the identity-lifecycle card may
    // sit inside collapsed disclosures. Force every ancestor open.
    const identityAuditLink = page.getByTestId("admin-audit-link-identity-lifecycle");
    await identityAuditLink.waitFor({ state: "attached", timeout: 15000 });
    await identityAuditLink.evaluate((node) => {
      for (let element = node.parentElement; element; element = element.parentElement) {
        if (element.tagName === "DETAILS") {
          element.open = true;
        }
      }
    });
    try {
      await identityAuditLink.waitFor({ state: "visible", timeout: 15000 });
    } catch (error) {
      const diagnostics = await identityAuditLink.evaluate((node) => {
        const chain = [];
        for (let element = node; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          chain.push(
            `${element.tagName}.${element.className} display=${style.display} visibility=${style.visibility} open=${element.open ?? "-"}`,
          );
        }
        return chain.join(" | ");
      });
      throw new Error(`identity audit link stayed hidden: ${diagnostics}`, { cause: error });
    }
    await page
      .getByTestId("admin-audit-link-identity-lifecycle")
      .evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
      });
    await page.getByTestId("admin-audit-link-identity-lifecycle").focus();
    await Promise.all([
      page.waitForURL(detailUrl, { timeout: 15000 }),
      page.keyboard.press("Enter"),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("admin-audit-detail-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const renderedAuditText = await page.locator("body").innerText();
    if (!(await page.getByTestId("admin-audit-detail-entries").isVisible())) {
      throw new Error(
        `admin identity lifecycle audit rendered no entries at ${page.url()}: ${renderedAuditText}`,
      );
    }
    const visibleEventKinds = [];
    for (const eventKind of [
      "account_created",
      "account_disabled",
      "account_enabled",
      "account_password_rotated",
      "account_recovery_credential_issued",
      "account_recovery_credential_revoked",
      "account_recovery_rejected",
      "account_recovered",
      "auth_attempt_rate_limited",
      "auth_delivery_queued",
      "auth_delivery_retryable_failed",
      "auth_delivery_retried",
      "account_session_created",
      "invite_redeemed",
      "session_rotated",
      "session_logged_out",
      "session_revoked",
      "invite_revoked",
    ]) {
      const entry = page.getByTestId(`admin-audit-entry-${eventKind}`).first();
      if ((await entry.count()) === 0) {
        throw new Error(
          `admin identity lifecycle audit missing ${eventKind} at ${page.url()}: ${renderedAuditText}`,
        );
      }
      await entry.waitFor({
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
    const deliveryProvider = page
      .getByTestId("admin-audit-entry-auth_delivery_retried-delivery-provider")
      .first();
    const deliveryOutcome = page
      .getByTestId("admin-audit-entry-auth_delivery_retried-delivery-outcome")
      .first();
    const deliveryOutcomeCode = page
      .getByTestId("admin-audit-entry-auth_delivery_retried-delivery-outcome-code")
      .first();
    const deliveryReceipt = page
      .getByTestId("admin-audit-entry-auth_delivery_retried-delivery-provider-receipt")
      .first();
    await deliveryProvider.waitFor({ state: "visible", timeout: 15000 });
    await deliveryOutcome.waitFor({ state: "visible", timeout: 15000 });
    const deliveryProviderId = await deliveryProvider.innerText();
    const deliveryOutcomeKind = await deliveryOutcome.innerText();
    if (
      deliveryProviderId !== "local-deterministic" ||
      deliveryOutcomeKind !== "delivered"
    ) {
      throw new Error(
        `admin identity lifecycle audit delivery outcome drifted: ${deliveryProviderId}/${deliveryOutcomeKind}`,
      );
    }
    if ((await deliveryOutcomeCode.count()) !== 0) {
      throw new Error("admin identity lifecycle audit rendered an absent delivery outcome code");
    }
    await deliveryReceipt.waitFor({ state: "visible", timeout: 15000 });
    const deliveryProviderReceiptId = await deliveryReceipt.innerText();
    if (!deliveryProviderReceiptId.startsWith("local-")) {
      throw new Error("admin identity lifecycle audit did not render the provider receipt");
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
      deliveryProviderId,
      deliveryOutcomeKind,
      deliveryOutcomeCodeVisible: false,
      deliveryProviderReceiptId,
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

async function driveBrowserLogout({
  apiBaseUrl,
  frontendBaseUrl,
  sessionToken,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const logoutRoleUrl = `/auth/logout?returnTo=${encodeURIComponent(returnTo)}`;
  const expectedLoginUrl = `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(
    returnTo,
  )}`;
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
    await page.goto(`${frontendBaseUrl}${logoutRoleUrl}`, { waitUntil: "networkidle" });
    await page.getByTestId("auth-logout-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await Promise.all([
      page.waitForURL(expectedLoginUrl, { timeout: 15000 }),
      page.getByTestId("auth-logout-submit").click(),
    ]);
    await page.getByTestId("auth-login-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const cookies = await page.context().cookies(frontendBaseUrl);
    const cookieCleared = !cookies.some((cookie) => cookie.name === "fmarch_session");
    await assertUnauthorizedSession(apiBaseUrl, sessionToken);
    const backNavigation = await page.goto(`${frontendBaseUrl}${returnTo}`, {
      waitUntil: "networkidle",
    });
    const recovery = page.getByTestId("route-error-surface");
    await recovery.waitFor({ state: "visible", timeout: 15000 });
    const backNavigationDeniedStatus = Number(await recovery.getAttribute("data-status"));
    if (
      !cookieCleared ||
      backNavigation?.status() !== 403 ||
      backNavigationDeniedStatus !== 403
    ) {
      throw new Error(
        `browser logout recovery drifted: ${JSON.stringify({
          cookieCleared,
          responseStatus: backNavigation?.status() ?? null,
          backNavigationDeniedStatus,
        })}`,
      );
    }
    return {
      oldSessionToken: sessionToken,
      logoutRoleUrl,
      logoutSurfaceTestId: "auth-logout-surface",
      oldSessionRejected: true,
      cookieCleared,
      backNavigationDeniedStatus,
      backNavigationRecoveryTestId: "route-error-surface",
    };
  } finally {
    await page.close();
  }
}

async function driveOverdueBrowserSessionRotation({
  apiBaseUrl,
  frontendBaseUrl,
  sessionToken,
  returnTo,
}) {
  if (proofDatabase === undefined) {
    throw new Error("proof database is not available");
  }
  const maxAgeSeconds = 86_400;
  await runSql(
    proofDatabase.url,
    `
      UPDATE auth_session
      SET created_at = 0,
          authenticated_at = 0
      WHERE token_hash = ${sqlLiteral(hashSessionToken(sessionToken))}
    `,
  );
  const overdue = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (overdue.rotation_required !== true) {
    throw new Error("overdue account session did not report a rotation requirement");
  }

  const firstContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const secondContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const cookie = {
    name: "fmarch_session",
    value: sessionToken,
    url: frontendBaseUrl,
    httpOnly: true,
    sameSite: "Lax",
  };
  try {
    await Promise.all([
      firstContext.addCookies([cookie]),
      secondContext.addCookies([cookie]),
    ]);
    await Promise.all([
      firstPage.goto(`${frontendBaseUrl}${returnTo}`, { waitUntil: "networkidle" }),
      secondPage.goto(`${frontendBaseUrl}${returnTo}`, { waitUntil: "networkidle" }),
    ]);
    const pages = [
      { context: firstContext, page: firstPage },
      { context: secondContext, page: secondPage },
    ];
    const sessions = await Promise.all(
      pages.map(async ({ context, page }) => ({
        context,
        page,
        cookie: (await context.cookies(frontendBaseUrl)).find(
          (entry) => entry.name === "fmarch_session",
        ),
      })),
    );
    const winners = sessions.filter(
      (entry) => entry.cookie !== undefined && entry.cookie.value !== sessionToken,
    );
    const losers = sessions.filter((entry) => entry.cookie === undefined);
    if (winners.length !== 1 || losers.length !== 1) {
      throw new Error(
        `overdue rotation did not produce one winner and one stale loser: ${JSON.stringify({
          winnerCount: winners.length,
          loserCount: losers.length,
        })}`,
      );
    }
    const winner = winners[0];
    const loser = losers[0];
    const winnerText = await winner.page.locator("body").innerText();
    if (!winnerText.includes(game)) {
      throw new Error("rotated browser session did not render the role surface");
    }
    const loserRecovery = loser.page.getByTestId("route-error-surface");
    await loserRecovery.waitFor({ state: "visible", timeout: 15000 });
    const staleLoserDeniedStatus = Number(
      await loserRecovery.getAttribute("data-status"),
    );
    if (staleLoserDeniedStatus !== 403) {
      throw new Error(`stale rotation loser did not render 403: ${staleLoserDeniedStatus}`);
    }
    await assertUnauthorizedSession(apiBaseUrl, sessionToken);
    const rotatedSession = await assertSessionCapability({
      apiBaseUrl,
      token: winner.cookie.value,
      expectedCapability: "HostOf",
    });
    return {
      oldSessionToken: sessionToken,
      rotatedSessionToken: winner.cookie.value,
      maxAgeSeconds,
      oldSessionRejected: true,
      rotatedSessionCapabilityKinds: (rotatedSession.capabilities ?? []).map(
        (capability) => capability.kind,
      ),
      winnerRenderedRole: true,
      staleLoserCookieCleared: true,
      staleLoserDeniedStatus,
    };
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
}

async function driveRejectedInviteLogin({
  frontendBaseUrl,
  inviteToken,
  accountCredential,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/invite?returnTo=${encodeURIComponent(
    returnTo,
  )}&invite=${encodeURIComponent(inviteToken)}&account=${encodeURIComponent(
    accountCredential.accountId,
  )}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-invite-surface").waitFor({ state: "visible" });
    await page.getByTestId("auth-invite-password").fill(accountCredential.password);
    await page.getByTestId("auth-invite-submit").click();
    await page.getByText("Invitation is missing, expired, revoked, or already used").waitFor({
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

async function driveRejectedAccountLogin({
  frontendBaseUrl,
  accountId,
  password,
  returnTo,
}) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const loginUrl = `${frontendBaseUrl}/auth/login/classic?returnTo=${encodeURIComponent(
    returnTo,
  )}&account=${encodeURIComponent(accountId)}`;
  try {
    await page.goto(loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-classic-surface").waitFor({ state: "visible" });
    await page.getByTestId("auth-login-password").fill(password);
    await page.getByTestId("auth-login-submit").click();
    await page.getByText("Account credentials are missing, disabled, or invalid").waitFor({
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
    evidence.version !== devTestGameIdentityAdapterProofVersion ||
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
    evidence.identityAdapter?.inviteCredentialKind !==
      "account-bound-single-use-invite" ||
    evidence.identityAdapter?.accountCredentialKind !== "local-password-account" ||
    evidence.identityAdapter?.accountPasswordAlgorithm !== "argon2id" ||
    evidence.identityAdapter?.accountRecoveryCredentialKind !==
      "hashed-single-use-recovery-credential" ||
    evidence.identityAdapter?.credentialAttemptPolicyKind !==
      "two-tier-postgres-account-source-lockout" ||
    evidence.identityAdapter?.credentialAttemptSourceKind !==
      "sveltekit-client-address-to-trusted-api-header" ||
    !evidence.identityAdapter?.lifecycleControls?.includes(
      "account-password-rotation",
    ) ||
    !evidence.identityAdapter?.lifecycleControls?.includes("account-registration") ||
    !evidence.identityAdapter?.lifecycleControls?.includes("account-recovery") ||
    !evidence.identityAdapter?.lifecycleControls?.includes(
      "credential-attempt-throttling",
    ) ||
    !evidence.identityAdapter?.lifecycleControls?.includes("session-age-rotation") ||
    !evidence.identityAdapter?.lifecycleControls?.includes("session-logout") ||
    evidence.identityAdapterContractDiff?.status !== "passed" ||
    !evidence.identityAdapter?.delegatedIssuanceControls?.includes(
      "host-scoped-invite-issuance",
    ) ||
    evidence.identityLifecycle?.status !== "passed" ||
    evidence.identityLifecycle?.accountRegistration?.status !== "passed" ||
    evidence.identityLifecycle?.accountRegistration?.registrationSurfaceTestId !==
      "auth-registration-classic-surface" ||
    evidence.identityLifecycle?.accountRegistration?.securitySurfaceTestId !==
      "account-security-surface" ||
    evidence.identityLifecycle?.accountRegistration?.sessionCookiePrefix !==
      "fmss_" ||
    evidence.identityLifecycle?.accountRegistration?.sessionHasNoGameCapabilities !== true ||
    evidence.identityLifecycle?.accountRegistration?.gameRolePendingReplacement !== true ||
    evidence.identityLifecycle?.accountRegistration?.gameRoleRecoveryTestId !==
      "route-state-player-empty" ||
    evidence.identityLifecycle?.accountRegistration?.duplicateRejected !== true ||
    evidence.identityLifecycle?.accountRegistration?.rateLimitVisible !== true ||
    evidence.identityLifecycle?.accountRegistration?.registrationScopeHashed !== true ||
    evidence.identityLifecycle?.accountRegistration?.rawPasswordStored !== false ||
    evidence.identityLifecycle?.localDelivery?.status !== "passed" ||
    evidence.identityLifecycle?.localDelivery?.adapter !== "local-deterministic" ||
    evidence.identityLifecycle?.localDelivery?.gateway !==
      "provider-neutral-delivery-gateway-v1" ||
    evidence.identityLifecycle?.localDelivery?.providerId !== "local-deterministic" ||
    evidence.identityLifecycle?.localDelivery?.typedOutcomes !== true ||
    evidence.identityLifecycle?.localDelivery?.invite?.deliveryKind !== "invite" ||
    evidence.identityLifecycle?.localDelivery?.invite?.status !== "delivered" ||
    evidence.identityLifecycle?.localDelivery?.invite?.attemptCount !== 2 ||
    evidence.identityLifecycle?.localDelivery?.invite?.providerId !== "local-deterministic" ||
    evidence.identityLifecycle?.localDelivery?.invite?.outcomeKind !== "delivered" ||
    evidence.identityLifecycle?.localDelivery?.invite?.outcomeCode !== null ||
    evidence.identityLifecycle?.localDelivery?.recovery?.deliveryKind !== "recovery" ||
    evidence.identityLifecycle?.localDelivery?.recovery?.status !== "delivered" ||
    evidence.identityLifecycle?.localDelivery?.recovery?.attemptCount !== 2 ||
    evidence.identityLifecycle?.localDelivery?.recovery?.providerId !== "local-deterministic" ||
    evidence.identityLifecycle?.localDelivery?.recovery?.outcomeKind !== "delivered" ||
    evidence.identityLifecycle?.localDelivery?.recovery?.outcomeCode !== null ||
    evidence.identityLifecycle?.localDelivery?.retryActorUserId !== "root_admin" ||
    evidence.identityLifecycle?.localDelivery?.rawCredentialsStored !== false ||
    evidence.identityLifecycle?.sessionRotation?.oldSessionRejected !== true ||
    evidence.identityLifecycle?.sessionAgeRotation?.oldSessionRejected !== true ||
    !evidence.identityLifecycle?.sessionAgeRotation?.rotatedSessionCapabilityKinds?.includes(
      "HostOf",
    ) ||
    evidence.identityLifecycle?.sessionAgeRotation?.winnerRenderedRole !== true ||
    evidence.identityLifecycle?.sessionAgeRotation?.staleLoserCookieCleared !== true ||
    evidence.identityLifecycle?.sessionAgeRotation?.staleLoserDeniedStatus !== 403 ||
    evidence.identityLifecycle?.sessionLogout?.oldSessionRejected !== true ||
    evidence.identityLifecycle?.sessionLogout?.cookieCleared !== true ||
    evidence.identityLifecycle?.sessionLogout?.backNavigationDeniedStatus !== 403 ||
    evidence.identityLifecycle?.sessionLogout?.backNavigationRecoveryTestId !==
      "route-error-surface" ||
    evidence.identityLifecycle?.sessionRevocation?.revokedSessionRejected !== true ||
    evidence.identityLifecycle?.inviteRevocation?.revokedInviteRejected !== true ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.status !== "passed" ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.issuingCapability !==
      "HostOf(game)" ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.hostRoleSurface !==
      `/g/${game}/host` ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.hostAction !==
      "?/issuePlayerInvite" ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.hostPanelTestId !==
      "host-player-invite-panel" ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.clickedThroughFromHostRoleUrl !==
      true ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.issuedByPrincipalUserId !==
      "host_h" ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.issuedForGame !== game ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.storedGameScope !== game ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.accountBindingRequired !== true ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.boundAccountId !==
      accountCredentials.player.accountId ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.globalCapabilitiesGranted !== 0 ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.rawInviteTokenStored !== false ||
    !evidence.identityLifecycle?.hostScopedInviteIssuance?.redeemedCapabilityKinds?.includes(
      "SlotOccupant",
    ) ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.hostScopedInviteIssuance?.hostRoleSurfaceStillValid !== true ||
    evidence.identityLifecycle?.accountLogin?.status !== "passed" ||
    evidence.identityLifecycle?.accountLogin?.principalUserId !== "host_h" ||
    evidence.identityLifecycle?.accountLogin?.accountId !==
      accountCredentials.host.accountId ||
    !evidence.identityLifecycle?.accountLogin?.capabilityKinds?.includes("HostOf") ||
    evidence.identityLifecycle?.accountLogin?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.accountLogin?.cookieValuePrefix !== "fmss_" ||
    evidence.identityLifecycle?.accountLogin?.rawPasswordStored !== false ||
    evidence.identityLifecycle?.accountPasswordRotation?.status !== "passed" ||
    evidence.identityLifecycle?.accountPasswordRotation?.passwordAlgorithm !==
      "argon2id" ||
    evidence.identityLifecycle?.accountPasswordRotation?.securityRoleUrl !==
      `/auth/account/security?account=${encodeURIComponent(
        accountCredentials.host.accountId,
      )}&returnTo=${encodeURIComponent(`/g/${game}/host`)}` ||
    evidence.identityLifecycle?.accountPasswordRotation?.securitySurfaceTestId !==
      "account-security-surface" ||
    evidence.identityLifecycle?.accountPasswordRotation?.accountPrefilled !== true ||
    evidence.identityLifecycle?.accountPasswordRotation?.staleSessionRejected !== true ||
    evidence.identityLifecycle?.accountPasswordRotation?.oldPasswordRejected !== true ||
    !evidence.identityLifecycle?.accountPasswordRotation?.newPasswordCapabilityKinds?.includes(
      "HostOf",
    ) ||
    evidence.identityLifecycle?.accountPasswordRotation?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.accountPasswordRotation?.revokedSessionCount < 1 ||
    evidence.identityLifecycle?.accountPasswordRotation?.rawPasswordStored !== false ||
    evidence.identityLifecycle?.accountRecovery?.status !== "passed" ||
    evidence.identityLifecycle?.accountRecovery?.credentialKind !==
      "hashed-single-use-recovery-credential" ||
    evidence.identityLifecycle?.accountRecovery?.passwordAlgorithm !== "argon2id" ||
    evidence.identityLifecycle?.accountRecovery?.recoveryRoleUrl !==
      `/auth/account/recovery?account=${encodeURIComponent(
        accountCredentials.host.accountId,
      )}&returnTo=${encodeURIComponent(`/g/${game}/host`)}` ||
    evidence.identityLifecycle?.accountRecovery?.recoverySurfaceTestId !==
      "account-recovery-surface" ||
    evidence.identityLifecycle?.accountRecovery?.rawCredentialVisibleOnce !== true ||
    evidence.identityLifecycle?.accountRecovery?.rawCredentialStored !== false ||
    evidence.identityLifecycle?.accountRecovery?.invalidCredentialRejected !== true ||
    evidence.identityLifecycle?.accountRecovery?.expiredCredentialRejected !== true ||
    evidence.identityLifecycle?.accountRecovery?.revokedCredentialRejected !== true ||
    evidence.identityLifecycle?.accountRecovery?.replayedCredentialRejected !== true ||
    evidence.identityLifecycle?.accountRecovery?.priorSessionRejected !== true ||
    evidence.identityLifecycle?.accountRecovery?.priorPasswordRejected !== true ||
    !evidence.identityLifecycle?.accountRecovery?.recoveredPasswordCapabilityKinds?.includes(
      "HostOf",
    ) ||
    evidence.identityLifecycle?.accountRecovery?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.accountRecovery?.revokedSessionCount < 1 ||
    evidence.identityLifecycle?.accountRecovery?.storedCredentialCount !== 3 ||
    evidence.identityLifecycle?.accountRecovery?.usedCredentialCount !== 1 ||
    evidence.identityLifecycle?.accountRecovery?.revokedCredentialCount !== 1 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.status !== "passed" ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.policyKind !==
      "two-tier-postgres-account-source-lockout" ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.rejectionTestId !==
      "auth-login-reject" ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.threshold !== 5 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.sourceThreshold !== 7 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.retentionSeconds !== 120 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.retryTimingVisible !== true ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.hashedScopeStored !== true ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.storedScopeCount !== 2 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.blockedScopeCount !== 1 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.rawAccountOrSourceStored !== false ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.trustedSourceHeader !== false ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.successfulLoginClearedFailures !==
      true ||
    !evidence.identityLifecycle?.credentialAttemptThrottling?.coveredCredentialOperations?.includes(
      "invite-redemption",
    ) ||
    !evidence.identityLifecycle?.credentialAttemptThrottling?.coveredCredentialOperations?.includes(
      "account-recovery",
    ) ||
    !evidence.identityLifecycle?.credentialAttemptThrottling?.postLockoutCapabilityKinds?.includes(
      "HostOf",
    ) ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding?.status !==
      "passed" ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.identifierCount !== 7 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.storedScopeCount !== 1 ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.spoofedSourceHeadersIgnored !== true ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.staleRowsPruned !== true ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.unknownCredentialWorkFactor !== "argon2id-dummy-verification" ||
    !evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.operationKinds?.includes("account-recovery") ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.retryAfterPresent !== true ||
    !evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.postLockoutCapabilityKinds?.includes("HostOf") ||
    evidence.identityLifecycle?.credentialAttemptThrottling?.unknownAccountBounding
      ?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.accountLifecycle?.status !== "passed" ||
    evidence.identityLifecycle?.accountLifecycle?.adminControlSurface?.status !== "passed" ||
    evidence.identityLifecycle?.accountLifecycle?.adminControlSurface?.detailRoleUrl !==
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h" ||
    evidence.identityLifecycle?.accountLifecycle?.adminControlSurface?.controlsTestId !==
      "admin-identity-account-controls" ||
    evidence.identityLifecycle?.accountLifecycle?.adminControlSurface?.visitedDetailRoleUrl !==
      true ||
    evidence.identityLifecycle?.accountLifecycle?.disabledStatus !== "disabled" ||
    evidence.identityLifecycle?.accountLifecycle?.enabledStatus !== "enabled" ||
    evidence.identityLifecycle?.accountLifecycle?.disabledAccountRejected !== true ||
    evidence.identityLifecycle?.accountLifecycle?.staleAccountSessionRejected !== true ||
    evidence.identityLifecycle?.accountLifecycle?.staleAdminControlRejected !== true ||
    evidence.identityLifecycle?.accountLifecycle?.staleAdminControlReloadRecovered !==
      true ||
    evidence.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryStatus !== "disabled" ||
    evidence.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryDetailRoleUrl !==
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h" ||
    !String(
      evidence.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.reloadRecoveryTargetText ?? "",
    ).includes("disabled") ||
    !String(
      evidence.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.staleConflictStatusText ?? "",
    ).includes("stale account lifecycle state") ||
    !String(
      evidence.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.staleConflictStatusText ?? "",
    ).includes("refresh and use current account controls") ||
    !evidence.identityLifecycle?.accountLifecycle?.recoveryCapabilityKinds?.includes(
      "HostOf",
    ) ||
    evidence.identityLifecycle?.accountLifecycle?.sameRoleSurface !== true ||
    evidence.identityLifecycle?.accountLifecycle?.revokedSessionCount < 1 ||
    evidence.identityLifecycle?.accountLifecycle?.disabledAtPresent !== true ||
    evidence.identityLifecycle?.accountLifecycle?.enabledDisabledAtCleared !== true ||
    evidence.identityLifecycle?.accountLifecycle?.rawPasswordStored !== false ||
    evidence.identityLifecycle?.auditTrail?.status !== "passed" ||
    evidence.identityLifecycle?.auditTrail?.rawTokensStored !== false ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("session_rotated") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("session_revoked") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("invite_redeemed") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("invite_revoked") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("account_created") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("account_disabled") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes("account_enabled") ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_session_created",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_password_rotated",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_recovery_credential_issued",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_recovery_credential_revoked",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_recovery_rejected",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "account_recovered",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "auth_attempt_rate_limited",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "auth_delivery_queued",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "auth_delivery_retryable_failed",
    ) ||
    !evidence.identityLifecycle?.auditTrail?.eventKinds?.includes(
      "auth_delivery_retried",
    ) ||
    evidence.identityLifecycle?.adminAuditSurface?.status !== "passed" ||
    evidence.identityLifecycle?.adminAuditSurface?.clickedThroughFromOverview !== true ||
    evidence.identityLifecycle?.adminAuditSurface?.rawTokensVisible !== false ||
    evidence.identityLifecycle?.adminAuditSurface?.deliveryProviderId !==
      "local-deterministic" ||
    evidence.identityLifecycle?.adminAuditSurface?.deliveryOutcomeKind !== "delivered" ||
    evidence.identityLifecycle?.adminAuditSurface?.deliveryOutcomeCodeVisible !== false ||
    !evidence.identityLifecycle?.adminAuditSurface?.deliveryProviderReceiptId?.startsWith(
      "local-",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "session_rotated",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "session_revoked",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "invite_revoked",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_created",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_disabled",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_enabled",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_session_created",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_password_rotated",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_recovery_credential_issued",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_recovery_credential_revoked",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_recovery_rejected",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "account_recovered",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "auth_attempt_rate_limited",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "auth_delivery_queued",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "auth_delivery_retryable_failed",
    ) ||
    !evidence.identityLifecycle?.adminAuditSurface?.visibleEventKinds?.includes(
      "auth_delivery_retried",
    )
  ) {
    throw new Error("invite proof must preserve the role-surface identity adapter");
  }
  assertDevTestGameIdentityAdapterContractPacket(evidence.identityAdapterContract);
  if (
    evidence.accounts?.host?.accountId !== accountCredentials.host.accountId ||
    evidence.accounts?.host?.principalUserId !== "host_h" ||
    Object.hasOwn(evidence.accounts.host, "password")
  ) {
    throw new Error("invite proof must include only redacted account evidence");
  }
  for (const [role, capability] of [
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]) {
    if (!evidence.roles[role].capabilityKinds.includes(capability)) {
      throw new Error(`${role} invite proof missing ${capability}`);
    }
    if (evidence.roles[role].cookie.valuePrefix !== "fmss_") {
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
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      FMARCH_BIND: `${host}:${port}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      FMARCH_AUTH_RATE_LIMIT_MAX_FAILURES: "5",
      FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES: "7",
      FMARCH_AUTH_REGISTRATION_SOURCE_LIMIT: "3",
      FMARCH_AUTH_RATE_LIMIT_WINDOW_SECONDS: "30",
      FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS: "2",
      FMARCH_AUTH_RATE_LIMIT_RETENTION_SECONDS: "120",
      FMARCH_LOCAL_DELIVERY_FAIL_FIRST_ATTEMPT: "1",
      FMARCH_TRUST_AUTH_SOURCE_HEADER: "0",
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
  // This lane proves session-freshness semantics (rotation races, revocation,
  // disablement) against out-of-band state changes; the SSR resolution cache
  // would mask them for up to its TTL, so the proof runs cache-disabled.
  process.env.FMARCH_SESSION_CACHE_TTL_MS = "0";
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

// The strict wire rejects any actor field in the envelope; seed commands act
// as a principal by presenting a granted session for that principal instead.
async function seedSessionToken(apiBaseUrl, principalUserId) {
  if (principalUserId === "root_admin") {
    return rootAdminSessionToken;
  }
  const cached = seedSessionTokens.get(principalUserId);
  if (cached !== undefined) {
    return cached;
  }
  const granted = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${rootAdminSessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      principal_user_id: principalUserId,
      expires_at: 4102444800,
      global_capabilities: ["GlobalAdmin"],
    }),
  });
  if (typeof granted.session_token !== "string" || granted.session_token === "") {
    throw new Error(`session grant for ${principalUserId} returned no session_token`);
  }
  seedSessionTokens.set(principalUserId, granted.session_token);
  return granted.session_token;
}

async function sendCommand(apiBaseUrl, id, principalUserId, command) {
  const sessionToken = await seedSessionToken(apiBaseUrl, principalUserId);
  const result = await fetchJson(`${apiBaseUrl}/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      v: 1,
      id,
      body: {
        kind: "Command",
        body: {
          command_id: randomUUID(),
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
