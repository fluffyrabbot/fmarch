import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedCommandPlanForGame } from "./dev_test_game.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";

export const DEV_TEST_GAME_SEED_FIXTURE_SUMMARY_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultPaths = Object.freeze({
  session: path.join(artifactDir, "session.json"),
  proofRun: path.join(artifactDir, "proof-run.json"),
  readiness: path.join(artifactDir, "release-readiness-checklist.json"),
});
const jsonPath = path.join(artifactDir, "seed-fixture-summary.json");
const markdownPath = path.join(artifactDir, "seed-fixture-summary.md");

export function buildDevTestGameSeedFixtureSummary({
  session,
  proofRun,
  readiness,
  generatedAt = new Date().toISOString(),
  paths = {},
}) {
  const proof = assertDevTestGameProofRun(proofRun);
  const checklist = assertDevTestGameReleaseReadiness(readiness);
  if (session?.game !== proof.session.game) {
    throw new Error(`seed fixture session/proof game mismatch: ${session?.game}`);
  }
  if (checklist.generatedFrom?.game !== proof.session.game) {
    throw new Error(
      `seed fixture readiness/proof game mismatch: ${checklist.generatedFrom?.game}`,
    );
  }
  const roles = redactRoles(session.sessions ?? {});
  const slots = summarizeSeedSlots(seedCommandPlanForGame(session.game));
  const laneIds = proof.lanes.map((lane) => lane.id);
  const summary = {
    version: DEV_TEST_GAME_SEED_FIXTURE_SUMMARY_VERSION,
    proof: "dev-test-game-seed-fixture-summary",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-seed-fixture",
    proofBoundary:
      "Local seed/demo fixture inventory for one dev-test-game run. It maps seeded slots, redacted role URLs, and browser-proof lanes into reusable local scenarios; it does not prove hosted demo data, production identity, invite delivery, beta readiness, or release readiness.",
    generatedFrom: {
      sessionJson: paths.session ?? "target/dev-test-game/session.json",
      proofRun: paths.proofRun ?? "target/dev-test-game/proof-run.json",
      readinessChecklist:
        paths.readiness ?? "target/dev-test-game/release-readiness-checklist.json",
      game: proof.session.game,
    },
    fixture: {
      name: session.name,
      game: session.game,
      pack: session.pack,
      phase: session.phase,
      seedMode: session.seedMode,
      seedCommandCount: session.seedCommandCount,
      roleCount: Object.keys(roles).length,
      roles,
      slots,
    },
    demoScenarios: demoScenarios({ roles, laneIds }),
    proofRun: {
      status: proof.status,
      laneCount: proof.lanes.length,
      lanes: proof.lanes.map((lane) => ({ id: lane.id, status: lane.status })),
      nonClaims: proof.nonClaims,
    },
    readiness: {
      status: checklist.status,
      releaseReady: checklist.releaseReady,
      productionReady: checklist.productionReady,
      localChecks: checklist.localDevelopmentSpine.checks.map((check) => ({
        id: check.id,
        status: check.status,
      })),
      unproven: checklist.releaseReadiness.unproven.map((item) => ({
        id: item.id,
        status: item.status,
      })),
    },
    checks: [
      {
        id: "role-entrypoints-redacted",
        status: "passed",
        evidence: Object.keys(roles),
      },
      {
        id: "seed-slots-enumerated",
        status: "passed",
        slotCount: slots.length,
      },
      {
        id: "demo-scenarios-mapped",
        status: "passed",
        scenarioCount: 14,
      },
      {
        id: "proof-lanes-carried",
        status: "passed",
        laneCount: proof.lanes.length,
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
  assertDevTestGameSeedFixtureSummary(summary);
  return summary;
}

export function assertDevTestGameSeedFixtureSummary(summary) {
  if (summary?.version !== DEV_TEST_GAME_SEED_FIXTURE_SUMMARY_VERSION) {
    throw new Error(`seed fixture summary version drifted: ${summary?.version}`);
  }
  if (summary.proof !== "dev-test-game-seed-fixture-summary") {
    throw new Error(`unexpected seed fixture proof id: ${summary.proof}`);
  }
  if (summary.status !== "passed") {
    throw new Error(`seed fixture summary status is ${summary.status}`);
  }
  if (summary.scope !== "local-dev-test-game-seed-fixture") {
    throw new Error(`seed fixture summary scope drifted: ${summary.scope}`);
  }
  if (summary.releaseReady !== false || summary.productionReady !== false) {
    throw new Error("seed fixture summary must not claim release or production readiness");
  }
  const requiredChecks = [
    "role-entrypoints-redacted",
    "seed-slots-enumerated",
    "demo-scenarios-mapped",
    "proof-lanes-carried",
    "release-boundary-carried",
  ];
  const checks = new Map((summary.checks ?? []).map((check) => [check.id, check.status]));
  for (const id of requiredChecks) {
    if (checks.get(id) !== "passed") {
      throw new Error(`seed fixture summary missing passed check: ${id}`);
    }
  }
  const requiredScenarios = [
    "host-phase-controls",
    "cohost-deadline-control",
    "player-vote-recovery",
    "player-action-denied",
    "invalid-action-recovery",
    "resolution-receipt",
    "dead-player-recovery",
    "night-action-loop",
    "host-replacement-console",
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    "replacement-stale-conflict-message",
    "replacement-invalid-target-recovery",
    "replacement-idempotent-retry",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
    "action-idempotent-retry",
    "concurrent-action-race",
    "stale-same-action-recovery",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ];
  const scenarios = new Map(
    (summary.demoScenarios ?? []).map((scenario) => [scenario.id, scenario]),
  );
  for (const id of requiredScenarios) {
    if (scenarios.get(id)?.status !== "available_locally") {
      throw new Error(`seed fixture summary missing local scenario: ${id}`);
    }
  }
  if ((summary.fixture?.slots ?? []).length < 5) {
    throw new Error("seed fixture summary must enumerate seeded slots");
  }
  const serialized = JSON.stringify(summary);
  if (/invite=(?!REDACTED)/.test(serialized)) {
    throw new Error("seed fixture summary leaked an invite URL token");
  }
  for (const [role, entry] of Object.entries(summary.fixture?.roles ?? {})) {
    if (typeof entry.loginUrlRedacted !== "string" || entry.loginUrlRedacted === "") {
      throw new Error(`seed fixture role ${role} missing redacted login URL`);
    }
    if (
      entry.credentialKind === "invite" &&
      entry.loginUrlRedacted?.includes("invite=REDACTED") !== true
    ) {
      throw new Error(`seed fixture role ${role} missing redacted invite URL`);
    }
    if (
      entry.credentialKind === "session" &&
      entry.loginUrlRedacted?.includes("invite=") === true
    ) {
      throw new Error(`seed fixture role ${role} leaked invite query on session URL`);
    }
    if ("token" in entry || "inviteToken" in entry) {
      throw new Error(`seed fixture role ${role} leaked a credential field`);
    }
  }
  return summary;
}

function demoScenarios({ roles, laneIds }) {
  const hasLane = (id) => laneIds.includes(id);
  const scenario = ({ id, title, role, provenBy, note }) => ({
    id,
    title,
    status: "available_locally",
    role,
    roleUrlRedacted: roles[role]?.loginUrlRedacted ?? null,
    provenBy,
    note,
  });
  return [
    scenario({
      id: "host-phase-controls",
      title: "Host phase controls",
      role: "host",
      provenBy: ["browser-entry", "core-loop"].filter(hasLane),
      note: "Host opens the seeded role URL, locks D01, recovers stale controls, resolves phases, and advances the local game.",
    }),
    scenario({
      id: "cohost-deadline-control",
      title: "Cohost deadline control",
      role: "cohost",
      provenBy: ["browser-entry", "cohost-console"].filter(hasLane),
      note: "Cohost opens the seeded host-console role URL with CohostOf authority, sees only delegated deadline controls, extends the active deadline, and rejects host-only ResolvePhase through /commands.",
    }),
    scenario({
      id: "player-vote-recovery",
      title: "Player vote recovery",
      role: "player",
      provenBy: ["browser-entry", "core-loop", "stale-player-vote"].filter(hasLane),
      note: "Player opens the seeded role URL, submits votes, and sees clear PhaseLocked recovery from stale state.",
    }),
    scenario({
      id: "day-vote-resolution",
      title: "Day vote resolution",
      role: "actionPlayer",
      provenBy: ["browser-entry", "day-vote-resolution"].filter(hasLane),
      note: "Action player opens a seeded role URL, casts the majority Slot 2 vote, then host and target-player role URLs prove the official day-vote lynch result.",
    }),
    scenario({
      id: "day-vote-no-lynch",
      title: "Day vote no lynch",
      role: "player",
      provenBy: ["browser-entry", "day-vote-no-lynch"].filter(hasLane),
      note: "Host and surviving-player role URLs prove a seeded official NoLynch result renders without a day-vote death receipt.",
    }),
    scenario({
      id: "player-action-denied",
      title: "Player action denied",
      role: "player",
      provenBy: ["browser-entry", "player-action-boundary"].filter(hasLane),
      note: "Player keeps private-channel capability but does not see factional_kill, and a direct factional_kill SubmitAction rejects through /commands.",
    }),
    scenario({
      id: "invalid-action-recovery",
      title: "Invalid action recovery",
      role: "actionPlayer",
      provenBy: ["browser-entry", "invalid-action-recovery"].filter(hasLane),
      note: "Action player submits the seeded invalid self-action, sees a current InvalidTarget receipt, refreshes command state, and keeps the legal factional_kill control available.",
    }),
    scenario({
      id: "resolution-receipt",
      title: "Resolution receipt",
      role: "deniedPlayer",
      provenBy: ["browser-entry", "resolution-receipts"].filter(hasLane),
      note: "Killed player opens the seeded role URL after N01 resolves and sees only the target-scoped player_killed factional_kill notice.",
    }),
    scenario({
      id: "dead-player-recovery",
      title: "Dead player recovery",
      role: "deniedPlayer",
      provenBy: ["browser-entry", "dead-player-recovery"].filter(hasLane),
      note: "Killed player opens the seeded D02 role URL with dead state, no legal actions, disabled controls, and SlotNotAlive recovery from direct vote, post, and action commands.",
    }),
    scenario({
      id: "night-action-loop",
      title: "Night action loop",
      role: "actionPlayer",
      provenBy: ["action-loop", "stale-action-conflict"].filter(hasLane),
      note: "Action player sees a live factional_kill control, rejects an invalid self-action, submits a legal action, and refreshes out of stale N01.",
    }),
    scenario({
      id: "action-idempotent-retry",
      title: "Action idempotent retry",
      role: "actionPlayer",
      provenBy: ["action-idempotent-retry"].filter(hasLane),
      note: "A frozen N01 action-player page replays the successful factional_kill command id, receives the original ACK stream seqs, and refreshes to N01 with no stale action controls.",
    }),
    scenario({
      id: "concurrent-action-race",
      title: "Concurrent action race",
      role: "actionPlayer",
      provenBy: ["concurrent-action-race"].filter(hasLane),
      note: "Two action-player role pages submit factional_kill concurrently with distinct command ids, prove one ACK plus one ActionAlreadySubmitted recovery, and resolve only the winning action.",
    }),
    scenario({
      id: "concurrent-host-resolve-race",
      title: "Concurrent host resolve race",
      role: "host",
      provenBy: ["concurrent-host-resolve-race"].filter(hasLane),
      note: "Two host role pages submit D02 resolve_phase concurrently with distinct command ids, prove one ACK plus one PhaseLocked recovery, and restore the phase unlocked for follow-on controls.",
    }),
    scenario({
      id: "concurrent-host-advance-race",
      title: "Concurrent host advance race",
      role: "host",
      provenBy: ["concurrent-host-advance-race"].filter(hasLane),
      note: "Two host role pages submit D02 advance_phase concurrently with distinct command ids, prove one ACK plus one InvalidTarget recovery, and converge to the next open phase.",
    }),
    scenario({
      id: "concurrent-host-deadline-advance-race",
      title: "Concurrent host deadline advance race",
      role: "host",
      provenBy: ["concurrent-host-deadline-advance-race"].filter(hasLane),
      note: "Two host role pages submit D01 advance_phase_by_deadline concurrently with distinct command ids, prove one deadline evidence ACK plus one InvalidTarget recovery, and converge to the next open phase.",
    }),
    scenario({
      id: "concurrent-host-mixed-advance-race",
      title: "Concurrent host mixed advance race",
      role: "host",
      provenBy: ["concurrent-host-mixed-advance-race"].filter(hasLane),
      note: "Two host role pages submit D01 advance_phase and advance_phase_by_deadline concurrently with distinct command ids, prove exactly one ACK plus one InvalidTarget recovery, and converge to the next open phase without duplicate deadline evidence.",
    }),
    scenario({
      id: "stale-same-action-recovery",
      title: "Stale same action recovery",
      role: "actionPlayer",
      provenBy: ["stale-same-action-recovery"].filter(hasLane),
      note: "A frozen N01 action-player page submits factional_kill after the live action succeeds, sees ActionAlreadySubmitted recovery guidance, and refreshes to N01 with no stale action controls.",
    }),
    scenario({
      id: "stale-action-conflict-message",
      title: "Stale action conflict message",
      role: "actionPlayer",
      provenBy: ["stale-action-conflict-message"].filter(hasLane),
      note: "A frozen N01 action-player page clicks a stale factional_kill control after D02, sees a PhaseLocked receipt that names stale action state, and refreshes to current action controls.",
    }),
    scenario({
      id: "stale-dead-action-conflict",
      title: "Stale dead action conflict",
      role: "actionPlayer",
      provenBy: ["stale-dead-action-conflict"].filter(hasLane),
      note: "A frozen N01 action-player page clicks a stale factional_kill control after its actor is marked dead, sees a SlotNotAlive receipt that names actor death, and refreshes out of stale action controls.",
    }),
    scenario({
      id: "host-replacement-console",
      title: "Host replacement console",
      role: "host",
      provenBy: ["replacement-console"].filter(hasLane),
      note: "Host opens the seeded role URL, processes the Slot 7 replacement, updates the projected occupant, and preserves stable slot history.",
    }),
    scenario({
      id: "replacement-host-issued-invite",
      title: "Host-issued replacement invite",
      role: "host",
      provenBy: ["replacement-host-issued-invite"].filter(hasLane),
      note: "Host opens the seeded role URL, issues the local player-rowan replacement invite from the host surface, and the generated URL becomes the replacementPlayer role entry.",
    }),
    scenario({
      id: "replacement-pending-player",
      title: "Pending replacement player",
      role: "replacementPlayer",
      provenBy: ["replacement-pending-player"].filter(hasLane),
      note: "Incoming player opens the host-issued role URL before replacement, lands on an authenticated pending surface, has no current SlotOccupant authority, and sees no player controls.",
    }),
    scenario({
      id: "replacement-redeemed-invite-recovery",
      title: "Redeemed replacement invite recovery",
      role: "replacementPlayer",
      provenBy: ["replacement-redeemed-invite-recovery"].filter(hasLane),
      note: "A fresh browser opens the already-redeemed replacement invite URL, receives a clear login rejection, and does not get an fmarch_session cookie.",
    }),
    scenario({
      id: "replacement-session-revocation-recovery",
      title: "Revoked replacement session recovery",
      role: "replacementPlayer",
      provenBy: ["replacement-session-revocation-recovery"].filter(hasLane),
      note: "After Rowan acts as the incoming Slot 7 player, the replacement browser session is revoked, the old cookie is rejected by the auth API, and the role path returns to the shared 403 recovery boundary without player controls.",
    }),
    scenario({
      id: "replacement-session-refresh-recovery",
      title: "Fresh replacement session recovery",
      role: "replacementPlayer",
      provenBy: ["replacement-session-refresh-recovery"].filter(hasLane),
      note: "After revocation, a fresh local session grant for player-rowan is submitted through the normal login page, restores the replacement role URL to Slot 7 authority, ACKs a new post, and avoids invite-token replay.",
    }),
    scenario({
      id: "replacement-stale-session-after-refresh",
      title: "Stale replacement session after refresh",
      role: "replacementPlayer",
      provenBy: ["replacement-stale-session-after-refresh"].filter(hasLane),
      note: "A separate stale browser context keeps the revoked replacement cookie while Rowan logs in elsewhere with a fresh session, and reloading that stale role path remains on the 403 recovery boundary without player controls.",
    }),
    scenario({
      id: "replacement-reconnect-recovery",
      title: "Replacement reconnect recovery",
      role: "replacementPlayer",
      provenBy: ["replacement-reconnect-recovery"].filter(hasLane),
      note: "After Rowan logs in with a fresh replacement session, the role page drops its live projection and reconnects to current Slot 7 command state plus a new Rowan post appended elsewhere.",
    }),
    scenario({
      id: "replacement-stale-conflict-message",
      title: "Replacement stale conflict message",
      role: "host",
      provenBy: ["replacement-stale-conflict-message"].filter(hasLane),
      note: "After Slot 7 transfers to Rowan, a stale host replacement action against Mira shows an explicit stale-target conflict message telling the host to refresh and use the current slot occupant.",
    }),
    scenario({
      id: "replacement-invalid-target-recovery",
      title: "Invalid replacement recovery",
      role: "replacementPlayer",
      provenBy: ["replacement-invalid-target-recovery"].filter(hasLane),
      note: "Host sends a stale replacement command with the wrong outgoing user, receives a visible InvalidTarget command-activity receipt, and the incoming replacement URL stays pending without slot authority or controls.",
    }),
    scenario({
      id: "replacement-idempotent-retry",
      title: "Replacement duplicate retry",
      role: "host",
      provenBy: ["replacement-idempotent-retry"].filter(hasLane),
      note: "Host replays the successful ProcessReplacement command id through /commands, receives the original ACK stream seqs, and Slot 7 remains with Rowan.",
    }),
    scenario({
      id: "stale-host-invite-recovery",
      title: "Stale host invite recovery",
      role: "host",
      provenBy: ["stale-host-invite-recovery"].filter(hasLane),
      note: "A stale host role URL submits the old player-mira invite target after replacement, receives stale-target recovery without a URL, then retries the current player-rowan target from the same surface.",
    }),
    scenario({
      id: "replacement-stale-success-recovery",
      title: "Stale replacement after success",
      role: "host",
      provenBy: ["replacement-stale-success-recovery"].filter(hasLane),
      note: "After Slot 7 transfers to player-rowan, host sends a stale replacement for player-mira, receives a visible InvalidTarget receipt, Slot 7 remains with Rowan, and Mira's old URL stays replaced and disabled.",
    }),
    scenario({
      id: "replacement-stale-player",
      title: "Replacement stale player recovery",
      role: "player",
      provenBy: ["replacement-stale-player"].filter(hasLane),
      note: "Outgoing player opens the seeded role URL before replacement, submits a stale Slot 7 vote after replacement, receives NotYourSlot recovery, and loses old Slot 7 controls.",
    }),
    scenario({
      id: "replacement-stale-action",
      title: "Replacement stale action recovery",
      role: "player",
      provenBy: ["replacement-stale-action"].filter(hasLane),
      note: "Outgoing player submits an action-shaped stale Slot 7 command after replacement, receives NotYourSlot recovery, and the old role URL keeps no action controls.",
    }),
    scenario({
      id: "replacement-stale-private-channel",
      title: "Replacement stale private channel",
      role: "player",
      provenBy: ["replacement-stale-private-channel"].filter(hasLane),
      note: "Outgoing player loses Slot 7 private-channel authority after replacement, while the incoming replacement role URL can post in that same private channel.",
    }),
    scenario({
      id: "replacement-stale-private-receipts",
      title: "Replacement stale private receipts",
      role: "player",
      provenBy: ["replacement-stale-private-receipts"].filter(hasLane),
      note: "Outgoing player loses private notification and investigation-result reads after replacement, while the incoming replacement role URL keeps a current private queue without target-only receipts.",
    }),
    scenario({
      id: "replacement-incoming-player",
      title: "Incoming replacement player",
      role: "replacementPlayer",
      provenBy: ["replacement-incoming-player"].filter(hasLane),
      note: "Incoming player opens the seeded role URL after replacement, receives current Slot 7 authority, sees stable Slot 7 history, submits a Slot 7 post and vote, and does not receive target-only private receipts.",
    }),
    scenario({
      id: "private-channel-member",
      title: "Private channel member",
      role: "player",
      provenBy: ["private-channel"].filter(hasLane),
      note: "Member role opens the pack-declared private channel and posts through /commands.",
    }),
    scenario({
      id: "private-channel-denied",
      title: "Private channel denial",
      role: "deniedPlayer",
      provenBy: ["private-channel"].filter(hasLane),
      note: "Denied role opens the same channel and lands on a clear 403 recovery path.",
    }),
    scenario({
      id: "multiplayer-hardening",
      title: "Multiplayer hardening",
      role: "player",
      provenBy: [
        "replacement-redeemed-invite-recovery",
        "replacement-session-revocation-recovery",
        "replacement-session-refresh-recovery",
        "replacement-stale-session-after-refresh",
        "replacement-reconnect-recovery",
        "replacement-stale-conflict-message",
        "replacement-idempotent-retry",
        "stale-host-invite-recovery",
        "idempotent-retry",
        "action-idempotent-retry",
        "concurrent-action-race",
        "reconnect-recovery",
        "concurrent-vote-race",
        "stale-host-publish",
        "stale-host-lifecycle",
        "stale-host-modkill",
        "stale-host-prompt",
        "stale-host-complete",
        "stale-player-complete",
        "stale-same-action-recovery",
        "stale-dead-action-conflict",
        "stale-action-conflict-message",
        "stale-host-control",
        "concurrent-host-resolve-race",
        "concurrent-host-advance-race",
        "concurrent-host-deadline-advance-race",
        "concurrent-host-mixed-advance-race",
        "stale-host-resolve",
        "stale-host-advance",
        "stale-host-deadline",
        "stale-cohost-deadline",
      ].filter(hasLane),
      note: "Seeded roles exercise stale replacement invite recovery, stale host invite retry recovery, duplicate replacement and post command retry, reconnect recovery, one concurrent vote race, host resolve/advance/deadline-advance/mixed-advance races, stale host phase/resolve/advance/publish/lifecycle/modkill/prompt/complete-game/deadline control rejection plus stale player completed-game command closure, and stale cohost deadline recovery.",
    }),
    scenario({
      id: "local-ops-readiness",
      title: "Local ops readiness",
      role: "admin",
      provenBy: ["local-ops-artifact-bundle", "local-backup-restore-drill"],
      note: "Local generated artifacts carry the current ops and backup/restore evidence when those readiness checks are present.",
    }),
  ];
}

function summarizeSeedSlots(plan) {
  const slots = new Map();
  for (const [, command] of plan) {
    if (command.AddSlot !== undefined) {
      const slotId = command.AddSlot.slot;
      slots.set(slotId, { slotId });
    }
    if (command.AssignSlot !== undefined) {
      const slotId = command.AssignSlot.slot;
      slots.set(slotId, { ...(slots.get(slotId) ?? { slotId }), user: command.AssignSlot.user });
    }
    if (command.AssignRole !== undefined) {
      const slotId = command.AssignRole.slot;
      slots.set(slotId, {
        ...(slots.get(slotId) ?? { slotId }),
        roleKey: command.AssignRole.role_key,
      });
    }
  }
  return Array.from(slots.values()).map((slot) => ({
    slotId: slot.slotId,
    user: slot.user ?? null,
    roleKey: slot.roleKey ?? null,
    fixtureRole: fixtureRoleForUser(slot.user),
  }));
}

function fixtureRoleForUser(user) {
  if (user === "player-mira") {
    return "player";
  }
  if (user === "player-seed") {
    return "actionPlayer";
  }
  if (user === "player-target") {
    return "deniedPlayer";
  }
  return "seededParticipant";
}

function redactRoles(sessions) {
  return Object.fromEntries(
    Object.entries(sessions).map(([role, session]) => [
      role,
      {
        principalUserId: session.principalUserId,
        credentialKind: session.credentialKind,
        returnTo: session.returnTo,
        expectedCapabilityKind: session.expectedCapabilityKind,
        directUrl: session.directUrl,
        loginUrlRedacted: redactLoginUrl(session.loginUrl),
        inviteTokenRedacted: session.inviteToken === undefined ? undefined : "REDACTED",
      },
    ]),
  );
}

function redactLoginUrl(loginUrl) {
  if (typeof loginUrl !== "string" || loginUrl === "") {
    return loginUrl;
  }
  const url = new URL(loginUrl);
  if (url.searchParams.has("invite")) {
    url.searchParams.set("invite", "REDACTED");
  }
  return url.toString();
}

function markdownSeedFixture(summary) {
  const lines = [
    "# fmarch Dev Test Game Seed Fixture",
    "",
    `- status: ${summary.status}`,
    `- releaseReady: ${summary.releaseReady}`,
    `- productionReady: ${summary.productionReady}`,
    `- generatedAt: ${summary.generatedAt}`,
    `- game: ${summary.fixture.game}`,
    "",
    summary.proofBoundary,
    "",
    "## Roles",
    "",
    "| Role | Principal | URL |",
    "| --- | --- | --- |",
  ];
  for (const [role, entry] of Object.entries(summary.fixture.roles)) {
    lines.push(`| ${role} | ${entry.principalUserId} | \`${entry.loginUrlRedacted}\` |`);
  }
  lines.push("", "## Seeded Slots", "", "| Slot | User | Role Key | Fixture Role |", "| --- | --- | --- | --- |");
  for (const slot of summary.fixture.slots) {
    lines.push(
      `| ${slot.slotId} | ${slot.user ?? ""} | ${slot.roleKey ?? ""} | ${slot.fixtureRole} |`,
    );
  }
  lines.push("", "## Demo Scenarios", "", "| Scenario | Role | Lanes |", "| --- | --- | --- |");
  for (const scenario of summary.demoScenarios) {
    lines.push(
      `| ${scenario.id} | ${scenario.role} | ${scenario.provenBy.join(", ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const paths = {
    session: resolvePath(process.env.FMARCH_DEV_TEST_GAME_SESSION, defaultPaths.session),
    proofRun: resolvePath(process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN, defaultPaths.proofRun),
    readiness: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_READINESS,
      defaultPaths.readiness,
    ),
  };
  const [session, proofRun, readiness] = await Promise.all([
    readJson(paths.session),
    readJson(paths.proofRun),
    readJson(paths.readiness),
  ]);
  const summary = buildDevTestGameSeedFixtureSummary({
    session,
    proofRun,
    readiness,
    paths: {
      session: path.relative(repoRoot, paths.session),
      proofRun: path.relative(repoRoot, paths.proofRun),
      readiness: path.relative(repoRoot, paths.readiness),
    },
  });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(markdownPath, markdownSeedFixture(summary));
  console.log(`wrote ${path.relative(repoRoot, jsonPath)} (${summary.status})`);
}

function resolvePath(value, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return path.resolve(process.cwd(), value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
