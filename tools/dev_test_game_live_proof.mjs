import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionPath = path.join(repoRoot, "target", "dev-test-game", "session.json");
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://fmarch:fmarch@localhost:5544/fmarch";

const exitCode = await run("npm", [
  "run",
  "dev:test-game",
  "--",
  "--name",
  "live-proof",
  "--reset",
  "--verify",
  "--no-keepalive",
]);
if (exitCode !== 0) {
  process.exit(exitCode);
}

const session = JSON.parse(await readFile(sessionPath, "utf8"));
assert.equal(session.status, "ready");
assert.equal(session.name, "live-proof");
assert.equal(session.seedMode, "seeded");
assert.equal(session.seedCommandCount, 20);
assert.equal(session.verification?.status, "passed");
assert.deepEqual(session.verification.roles, ["host", "player"]);
assert.match(session.frontendBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(session.apiBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
for (const role of ["admin", "cohost", "host", "player"]) {
  assert.equal(typeof session.sessions[role]?.token, "string", `${role} token`);
  assert.equal(session.sessions[role].credentialKind, "invite", `${role} credential kind`);
  assert.equal(session.sessions[role].inviteToken, session.sessions[role].token);
  assert.match(session.sessions[role].loginUrl, /\/auth\/login\?returnTo=.*&invite=/);
}
assert.equal(
  session.verification.sessions.host.capabilityKinds.includes("HostOf"),
  true,
);
assert.equal(
  session.verification.sessions.player.capabilityKinds.includes("SlotOccupant"),
  true,
);
assert.equal(session.verification.sessions.host.cookie.valuePrefix, "invite-session-");
assert.equal(session.verification.sessions.player.cookie.valuePrefix, "invite-session-");
assert.equal(session.verification.coreLoop.status, "passed");
assert.equal(session.verification.coreLoop.lock.commandStatus.state, "ack");
assert.equal(session.verification.coreLoop.rejectedVote.state, "reject");
assert.equal(session.verification.coreLoop.rejectedVote.error, "PhaseLocked");
assert.equal(session.verification.coreLoop.unlock.commandStatus.state, "ack");
assert.equal(
  session.verification.coreLoop.playerPhases.lockedBeforeVote.locked,
  true,
);
assert.equal(
  session.verification.coreLoop.playerPhases.unlockedAfterRecovery.locked,
  false,
);

console.log(`dev test-game live proof passed for ${session.game}`);

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
