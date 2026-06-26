import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEV_TEST_GAME_PROOF_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSessionPath = path.join(repoRoot, "target", "dev-test-game", "session.json");
const defaultProofPath = path.join(repoRoot, "target", "dev-test-game", "proof-run.json");
const requiredLaneIds = Object.freeze([
  "browser-entry",
  "core-loop",
  "action-loop",
  "private-channel",
  "idempotent-retry",
  "reconnect-recovery",
  "stale-player-vote",
  "concurrent-vote-race",
  "stale-host-control",
]);

export function buildDevTestGameProofRun(session, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const verification = session?.verification ?? {};
  const hardening = verification.multiplayerHardening ?? {};
  const lanes = [
    lane("browser-entry", "Role URLs open verified browser sessions", {
      roles: verification.roles ?? [],
      sessionRoles: Object.keys(verification.sessions ?? {}),
      passed: verification.status === "passed" && requiredRolesPresent(verification),
    }),
    lane("core-loop", "Host phase controls and player locked-vote recovery", {
      rejectedVoteError: verification.coreLoop?.rejectedVote?.error ?? null,
      lockState: verification.coreLoop?.lock?.commandStatus?.state ?? null,
      unlockState: verification.coreLoop?.unlock?.commandStatus?.state ?? null,
      passed:
        verification.coreLoop?.status === "passed" &&
        verification.coreLoop?.rejectedVote?.error === "PhaseLocked" &&
        verification.coreLoop?.lock?.commandStatus?.state === "ack" &&
        verification.coreLoop?.unlock?.commandStatus?.state === "ack",
    }),
    lane("action-loop", "Day/night action submission and resolution", {
      invalidActionError: verification.actionLoop?.invalidAction?.error ?? null,
      legalActionState: verification.actionLoop?.legalAction?.state ?? null,
      resolvedTargetAlive: verification.actionLoop?.resolvedTargetSlot?.alive ?? null,
      advancedPhase: verification.actionLoop?.d02Phase?.phaseId ?? null,
      passed:
        verification.actionLoop?.status === "passed" &&
        verification.actionLoop?.invalidAction?.error === "InvalidTarget" &&
        verification.actionLoop?.legalAction?.state === "ack" &&
        verification.actionLoop?.resolvedTargetSlot?.alive === false &&
        verification.actionLoop?.d02Phase?.phaseId === "D02",
    }),
    lane("private-channel", "Private channel member post and denied recovery", {
      channel: verification.privateChannel?.channel ?? null,
      allowedState: verification.privateChannel?.allowed?.submitPost?.state ?? null,
      deniedStatus: verification.privateChannel?.denied?.status ?? null,
      passed:
        verification.privateChannel?.status === "passed" &&
        verification.privateChannel?.channel === "private:mafia_day_chat" &&
        verification.privateChannel?.allowed?.submitPost?.state === "ack" &&
        verification.privateChannel?.denied?.status === 403,
    }),
    lane("idempotent-retry", "Duplicate command id returns original ACK", {
      channel: hardening.idempotentRetry?.channel ?? null,
      firstState: hardening.idempotentRetry?.firstPost?.state ?? null,
      retryState: hardening.idempotentRetry?.retryPost?.state ?? null,
      sameStreamSeqs: sameArray(
        hardening.idempotentRetry?.firstPost?.streamSeqs,
        hardening.idempotentRetry?.retryPost?.streamSeqs,
      ),
      projectedPostCount: hardening.idempotentRetry?.projectedPostCount ?? null,
      passed:
        hardening.idempotentRetry?.channel === "main" &&
        hardening.idempotentRetry?.firstPost?.state === "ack" &&
        hardening.idempotentRetry?.retryPost?.state === "ack" &&
        sameArray(
          hardening.idempotentRetry?.firstPost?.streamSeqs,
          hardening.idempotentRetry?.retryPost?.streamSeqs,
        ) &&
        hardening.idempotentRetry?.projectedPostCount === 1,
    }),
    lane("reconnect-recovery", "Dropped player live projection reconnects", {
      reconnectingState: hardening.reconnect?.reconnectingStatus?.state ?? null,
      recoveryState: hardening.reconnect?.reconnectRecoveryEvent?.state ?? null,
      recoveredSnapshotContainsPost:
        hardening.reconnect?.recoveredSnapshotContainsPost ?? null,
      passed:
        hardening.reconnect?.status === "passed" &&
        hardening.reconnect?.reconnectingStatus?.state === "reconnecting" &&
        hardening.reconnect?.reconnectRecoveryEvent?.state === "recovered" &&
        hardening.reconnect?.recoveredSnapshotContainsPost === true,
    }),
    lane("stale-player-vote", "Stale player vote rejects and refreshes command state", {
      rejectError: hardening.stalePlayerVote?.reject?.error ?? null,
      phaseAfterRejectLocked: hardening.stalePlayerVote?.phaseAfterReject?.locked ?? null,
      cleanupLocked: hardening.stalePlayerVote?.hostPhaseAfterUnlock?.locked ?? null,
      passed:
        hardening.stalePlayerVote?.status === "passed" &&
        hardening.stalePlayerVote?.reject?.error === "PhaseLocked" &&
        hardening.stalePlayerVote?.phaseAfterReject?.locked === true &&
        hardening.stalePlayerVote?.hostPhaseAfterUnlock?.locked === false,
    }),
    lane("concurrent-vote-race", "Concurrent player votes converge in projections", {
      targetSlot: hardening.concurrentVoteRace?.targetSlot ?? null,
      playerState: hardening.concurrentVoteRace?.playerVote?.state ?? null,
      actionState: hardening.concurrentVoteRace?.actionVote?.state ?? null,
      distinctStreamSeqs: !sameArray(
        hardening.concurrentVoteRace?.playerVote?.streamSeqs,
        hardening.concurrentVoteRace?.actionVote?.streamSeqs,
      ),
      apiCount: hardening.concurrentVoteRace?.apiProjection?.count ?? null,
      passed:
        hardening.concurrentVoteRace?.status === "passed" &&
        hardening.concurrentVoteRace?.targetSlot === "slot_5" &&
        hardening.concurrentVoteRace?.playerVote?.state === "ack" &&
        hardening.concurrentVoteRace?.actionVote?.state === "ack" &&
        !sameArray(
          hardening.concurrentVoteRace?.playerVote?.streamSeqs,
          hardening.concurrentVoteRace?.actionVote?.streamSeqs,
        ) &&
        hardening.concurrentVoteRace?.apiProjection?.count === 2,
    }),
    lane("stale-host-control", "Stale host phase control rejects without drift", {
      rejectError: hardening.staleHostControl?.reject?.error ?? null,
      phaseId: hardening.staleHostControl?.phaseAfterReject?.phase_id ?? null,
      locked: hardening.staleHostControl?.phaseAfterReject?.locked ?? null,
      passed:
        hardening.staleHostControl?.reject?.error === "PhaseLocked" &&
        hardening.staleHostControl?.phaseAfterReject?.phase_id === "D02" &&
        hardening.staleHostControl?.phaseAfterReject?.locked === false,
    }),
  ];
  const status = lanes.every((item) => item.status === "passed") ? "passed" : "failed";
  return {
    version: DEV_TEST_GAME_PROOF_VERSION,
    proof: "dev-test-game-proof-run",
    status,
    generatedAt,
    productionReady: false,
    releaseReady: false,
    scope: "local-dev-test-game-harness",
    artifacts: {
      sessionJson: "target/dev-test-game/session.json",
      sessionMarkdown: "target/dev-test-game/session.md",
      proofRun: "target/dev-test-game/proof-run.json",
    },
    session: {
      name: session?.name ?? null,
      game: session?.game ?? null,
      seedMode: session?.seedMode ?? null,
      frontendBaseUrl: session?.frontendBaseUrl ?? null,
      apiBaseUrl: session?.apiBaseUrl ?? null,
      verificationStatus: verification.status ?? null,
      roles: verification.roles ?? [],
    },
    lanes,
    nonClaims: [
      "production account identity",
      "hosted deployment",
      "exhaustive race coverage",
      "backup/restore",
      "beta or release readiness",
    ],
    proofBoundary:
      "Local Rust API plus SvelteKit browser proof over one seeded mafiascum game. Passing means the local development-spine role URLs exercised the recorded lanes; it does not prove production identity, hosted deployment, exhaustive races, backup/restore, or release readiness.",
  };
}

export function assertDevTestGameProofRun(proof) {
  if (proof?.version !== DEV_TEST_GAME_PROOF_VERSION) {
    throw new Error(`dev-test-game proof version drifted: ${proof?.version}`);
  }
  if (proof.proof !== "dev-test-game-proof-run") {
    throw new Error(`unexpected dev-test-game proof id: ${proof.proof}`);
  }
  if (proof.status !== "passed") {
    const failed = (proof.lanes ?? [])
      .filter((check) => check.status !== "passed")
      .map((check) => check.id)
      .join(", ");
    throw new Error(`dev-test-game proof failed: ${failed}`);
  }
  if (proof.productionReady !== false || proof.releaseReady !== false) {
    throw new Error("dev-test-game proof must not claim production or release readiness");
  }
  for (const laneId of requiredLaneIds) {
    if (!proof.lanes?.some((laneItem) => laneItem.id === laneId && laneItem.status === "passed")) {
      throw new Error(`dev-test-game proof missing passed lane: ${laneId}`);
    }
  }
  return proof;
}

function lane(id, label, evidence) {
  const { passed, ...rest } = evidence;
  return {
    id,
    label,
    status: passed ? "passed" : "failed",
    evidence: rest,
  };
}

function requiredRolesPresent(verification) {
  return ["host", "player", "actionPlayer", "deniedPlayer"].every((role) =>
    (verification.roles ?? []).includes(role),
  );
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultProofPath;
  const sessionPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : defaultSessionPath;
  const [proof, session] = await Promise.all([
    readJson(proofPath),
    readJson(sessionPath),
  ]);
  assertDevTestGameProofRun(proof);
  const expected = buildDevTestGameProofRun(session, {
    generatedAt: proof.generatedAt,
  });
  if (JSON.stringify(proof) !== JSON.stringify(expected)) {
    throw new Error(
      `dev-test-game proof is stale or does not match ${path.relative(repoRoot, sessionPath)}`,
    );
  }
  console.log(
    `validated ${path.relative(repoRoot, proofPath)} (${proof.lanes.length} lanes)`,
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
