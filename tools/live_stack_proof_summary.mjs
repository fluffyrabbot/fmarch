import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLiveStackReadiness,
  buildLiveStackReadiness,
} from "./live_stack_readiness_contract.mjs";
import {
  setupCommandEvidenceKeys,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";

export const LIVE_STACK_PROOF_SUMMARY_VERSION = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultArtifactDir = path.join(repoRoot, "target", "host-console-live-stack-smoke");
const defaultProofPath = path.join(defaultArtifactDir, "live-stack-proof.json");
const defaultJsonPath = path.join(defaultArtifactDir, "live-stack-summary.json");
const defaultMarkdownPath = path.join(defaultArtifactDir, "live-stack-summary.md");

export function buildLiveStackProofSummary(
  evidence,
  {
    generatedAt = evidence?.generatedAt ?? new Date().toISOString(),
    proofPath = path.relative(repoRoot, defaultProofPath),
  } = {},
) {
  if (evidence?.status !== "passed") {
    throw new Error(`live-stack proof status is ${evidence?.status}`);
  }
  const readiness = evidence.readiness ?? buildLiveStackReadiness(evidence);
  assertLiveStackReadiness(readiness);
  const hostSetup = evidence.browser?.admin?.hostSetup;
  const setupCommandEvidence = hostSetup?.setupCommandEvidence ?? {};
  const convergence = evidence.browser?.hostVotecountConvergence;
  const reconnect = evidence.browser?.player?.reconnect;
  const moderator = evidence.browser?.moderator;
  const rolePmReplacement = moderator?.rolePmReplacement;
  const summary = {
    version: LIVE_STACK_PROOF_SUMMARY_VERSION,
    proof: "host-console-live-stack-summary",
    status: "passed",
    productionReady: false,
    generatedAt,
    scope: "local-live-stack-proof-summary",
    proofBoundary:
      "Compact derivative report from the local live-stack browser proof. It summarizes host setup, host votecount convergence, reconnect recovery, the Role PM replacement lifecycle, and host ops evidence for inspection; the full proof JSON remains the source of truth and this does not prove hosted, beta, release, or production readiness.",
    generatedFrom: {
      liveStackProof: proofPath,
      game: evidence.game,
      readinessVersion: readiness.version,
    },
    readiness: {
      status: readiness.status,
      checkCount: readiness.checks.length,
      checks: readiness.checks.map((check) => ({
        id: check.id,
        status: check.status,
      })),
    },
    hostSetupWorkflow: {
      status: hostSetup?.status ?? "missing",
      game: commandGame(
        setupCommandEvidence.startGame ?? hostSetup?.commands?.startGame,
      ),
      setupUrl: hostSetup?.setupUrl ?? null,
      hostConsoleUrl: hostSetup?.hostConsoleUrl ?? null,
      slotId: hostSetup?.slotId ?? null,
      occupantUserId: hostSetup?.occupantUserId ?? null,
      roleKey: hostSetup?.roleKey ?? null,
      policyBefore: hostSetup?.policyBefore ?? null,
      policyAfter: hostSetup?.policyAfter ?? null,
      readyReadinessSummary: hostSetup?.readyReadiness?.summary ?? null,
      startedReadinessSummary: hostSetup?.startedReadiness?.summary ?? null,
      hostConsolePhase: hostSetup?.hostConsoleState?.phase?.phase_id ?? null,
      hostConsoleSlot: hostSetup?.hostConsoleState?.slot?.slot_id ?? null,
      setupCommandEvidence: setupCommandEvidenceSummary(setupCommandEvidence),
      commands: Object.fromEntries(
        Object.entries(hostSetup?.commands ?? {}).map(([id, command]) => [
          id,
          {
            status: command.status,
            commandKind: command.commandKind,
            streamSeqs: command.streamSeqs ?? [],
            readinessSummary: command.readinessSummary ?? null,
          },
        ]),
      ),
    },
    hostVotecountConvergence: {
      status: convergence?.status ?? "missing",
      expectedCount: convergence?.expectedCount ?? null,
      apiSlot1Count: voteCountForSlot(convergence?.apiVoteCount, "slot_1"),
      beforeSlot1Count: voteCountForProjection(
        convergence?.before?.projection,
        "slot_1",
      ),
      afterSlot1Count: voteCountForProjection(
        convergence?.after?.projection,
        "slot_1",
      ),
      resyncState: convergence?.resyncEvent?.state ?? null,
      sawFreshVoteEvent: convergence?.sawFreshVoteEvent ?? false,
      proof: convergence?.proof ?? null,
    },
    reconnectRecovery: {
      status:
        reconnect?.reconnectRecoveryEvent?.state === "recovered" &&
        reconnect?.recoveredSnapshotContainsPost === true
          ? "passed"
          : "missing",
      state: reconnect?.reconnectRecoveryEvent?.state ?? null,
      recoveredSnapshotContainsPost:
        reconnect?.recoveredSnapshotContainsPost ?? false,
    },
    rolePmReplacementLifecycle: {
      status: rolePmReplacementStatus(rolePmReplacement),
      channelId: rolePmReplacement?.channelId ?? null,
      slotId: rolePmReplacement?.slotId ?? null,
      incomingPrincipalUserId:
        rolePmReplacement?.incoming?.principalUserId ?? null,
      incomingSubmitState:
        rolePmReplacement?.incoming?.submitOutcome?.state ?? null,
      initialLiveDeltaKind:
        rolePmReplacement?.incoming?.initialLiveDelta?.delta?.kind ?? null,
      commandLiveDeltaKind:
        rolePmReplacement?.incoming?.commandLiveDelta?.delta?.kind ?? null,
      reloadedPostCount:
        rolePmReplacement?.incoming?.reloadedPostBodies?.length ?? 0,
      incomingMediaBodyBytes:
        rolePmReplacement?.incoming?.mediaBodyBytes ?? 0,
      outgoingRouteStatus:
        rolePmReplacement?.outgoing?.routeStatus ?? null,
      outgoingThreadStatus:
        rolePmReplacement?.outgoing?.threadStatus ?? null,
      outgoingMediaStatus:
        rolePmReplacement?.outgoing?.mediaStatus ?? null,
      outgoingMediaBodyBytes:
        rolePmReplacement?.outgoing?.mediaBodyBytes ?? null,
      stalePostReject:
        rolePmReplacement?.outgoing?.stalePostReject?.error ?? null,
    },
    hostOpsWorkflow: {
      status: hostOpsStatus(moderator),
      promptState: moderator?.hostPrompt?.commandStatus?.state ?? null,
      slotLifecycleState: moderator?.slotLifecycle?.commandStatus?.state ?? null,
      playerInviteStatus: moderator?.playerInviteTarget?.status ?? null,
      playerInvitePrincipalUserId:
        moderator?.playerInviteTarget?.principalUserId ?? null,
      stalePlayerInviteState: moderator?.stalePlayerInviteReject?.state ?? null,
      stalePlayerInviteRetryState:
        moderator?.stalePlayerInviteReject?.retry?.state ?? null,
    },
    checks: [
      {
        id: "readiness-carried",
        status: readiness.status,
        checkCount: readiness.checks.length,
      },
      {
        id: "host-setup-summary",
        status: hostSetup?.status === "passed" ? "passed" : "failed",
      },
      {
        id: "host-votecount-convergence-summary",
        status:
          convergence?.status === "passed" &&
          convergence.expectedCount === 1 &&
          voteCountForProjection(convergence.after?.projection, "slot_1") === 1
            ? "passed"
            : "failed",
      },
      {
        id: "reconnect-summary",
        status:
          reconnect?.reconnectRecoveryEvent?.state === "recovered" &&
          reconnect?.recoveredSnapshotContainsPost === true
            ? "passed"
            : "failed",
      },
      {
        id: "role-pm-replacement-summary",
        status: rolePmReplacementStatus(rolePmReplacement),
      },
      {
        id: "host-ops-summary",
        status: hostOpsStatus(moderator),
      },
      {
        id: "production-boundary-carried",
        status: readiness.productionReady === false ? "passed" : "failed",
        productionReady: false,
      },
    ],
  };
  assertLiveStackProofSummary(summary);
  return Object.freeze(summary);
}

export function assertLiveStackProofSummary(summary) {
  if (summary?.version !== LIVE_STACK_PROOF_SUMMARY_VERSION) {
    throw new Error(`live-stack summary version drifted: ${summary?.version}`);
  }
  if (summary.proof !== "host-console-live-stack-summary") {
    throw new Error(`unexpected live-stack summary proof id: ${summary.proof}`);
  }
  if (summary.status !== "passed") {
    throw new Error(`live-stack summary status is ${summary.status}`);
  }
  if (summary.productionReady !== false) {
    throw new Error("live-stack summary must not claim production readiness");
  }
  const checks = new Map((summary.checks ?? []).map((check) => [check.id, check]));
  for (const id of [
    "readiness-carried",
    "host-setup-summary",
    "host-votecount-convergence-summary",
    "reconnect-summary",
    "role-pm-replacement-summary",
    "host-ops-summary",
    "production-boundary-carried",
  ]) {
    if (checks.get(id)?.status !== "passed") {
      throw new Error(`live-stack summary missing passed check: ${id}`);
    }
  }
  if (
    summary.hostSetupWorkflow?.setupCommandEvidence?.startGame?.commandKind !==
    "StartGame"
  ) {
    throw new Error("live-stack summary missing host setup StartGame command");
  }
  if (summary.hostSetupWorkflow?.readyReadinessSummary !== "Ready to start") {
    throw new Error("live-stack summary missing host setup ready state");
  }
  if (summary.hostSetupWorkflow?.startedReadinessSummary !== "Started at D01") {
    throw new Error("live-stack summary missing host setup started state");
  }
  if (summary.hostVotecountConvergence?.expectedCount !== 1) {
    throw new Error("live-stack summary votecount expected count drifted");
  }
  if (summary.hostVotecountConvergence?.afterSlot1Count !== 1) {
    throw new Error("live-stack summary missing host votecount convergence");
  }
  if (summary.hostVotecountConvergence?.resyncState !== "recovered") {
    throw new Error("live-stack summary missing host votecount resync recovery");
  }
  if (
    summary.rolePmReplacementLifecycle?.channelId !== "private:role_pm:slot-7" ||
    summary.rolePmReplacementLifecycle?.initialLiveDeltaKind !==
      "ThreadPostsChanged" ||
    summary.rolePmReplacementLifecycle?.commandLiveDeltaKind !==
      "ThreadPostsChanged" ||
    summary.rolePmReplacementLifecycle?.outgoingMediaBodyBytes !== 0 ||
    summary.rolePmReplacementLifecycle?.stalePostReject !== "NotYourSlot"
  ) {
    throw new Error("live-stack summary missing Role PM replacement lifecycle proof");
  }
  return summary;
}

export function markdownLiveStackProofSummary(summary) {
  const lines = [
    "# fmarch Live-Stack Proof Summary",
    "",
    `- status: ${summary.status}`,
    `- productionReady: ${summary.productionReady}`,
    `- generatedAt: ${summary.generatedAt}`,
    `- scope: ${summary.scope}`,
    `- source: \`${summary.generatedFrom.liveStackProof}\``,
    "",
    summary.proofBoundary,
    "",
    "## Readiness",
    "",
    "| Check | Status |",
    "| --- | --- |",
  ];
  for (const check of summary.readiness.checks) {
    lines.push(`| ${check.id} | ${check.status} |`);
  }
  lines.push(
    "",
    "## Host Setup",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| status | ${summary.hostSetupWorkflow.status} |`,
    `| game | ${summary.hostSetupWorkflow.game ?? ""} |`,
    `| slot | ${summary.hostSetupWorkflow.slotId ?? ""} |`,
    `| occupant | ${summary.hostSetupWorkflow.occupantUserId ?? ""} |`,
    `| role | ${summary.hostSetupWorkflow.roleKey ?? ""} |`,
    `| policy | ${summary.hostSetupWorkflow.policyBefore ?? ""} -> ${summary.hostSetupWorkflow.policyAfter ?? ""} |`,
    `| ready | ${summary.hostSetupWorkflow.readyReadinessSummary ?? ""} |`,
    `| started | ${summary.hostSetupWorkflow.startedReadinessSummary ?? ""} |`,
    "",
    "| Command | Status | Kind | Stream Seqs | Readiness |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [id, command] of Object.entries(
    summary.hostSetupWorkflow.setupCommandEvidence,
  )) {
    if (command === null) {
      lines.push(`| ${id} | missing |  |  |  |`);
      continue;
    }
    lines.push(
      `| ${id} | ${command.status} | ${command.commandKind} | ${command.streamSeqs.join(", ")} | ${command.readinessSummary ?? ""} |`,
    );
  }
  lines.push(
    "",
    "## Host Votecount Convergence",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| status | ${summary.hostVotecountConvergence.status} |`,
    `| expectedCount | ${summary.hostVotecountConvergence.expectedCount ?? ""} |`,
    `| before slot_1 | ${summary.hostVotecountConvergence.beforeSlot1Count ?? ""} |`,
    `| API slot_1 | ${summary.hostVotecountConvergence.apiSlot1Count ?? ""} |`,
    `| after slot_1 | ${summary.hostVotecountConvergence.afterSlot1Count ?? ""} |`,
    `| resync | ${summary.hostVotecountConvergence.resyncState ?? ""} |`,
    `| fresh vote event | ${summary.hostVotecountConvergence.sawFreshVoteEvent} |`,
    `| proof | ${summary.hostVotecountConvergence.proof ?? ""} |`,
    "",
    "## Recovery And Ops",
    "",
    "| Surface | Status | Details |",
    "| --- | --- | --- |",
    `| reconnect | ${summary.reconnectRecovery.status} | state=${summary.reconnectRecovery.state ?? ""}, post=${summary.reconnectRecovery.recoveredSnapshotContainsPost} |`,
    `| Role PM replacement | ${summary.rolePmReplacementLifecycle.status} | channel=${summary.rolePmReplacementLifecycle.channelId ?? ""}, incoming=${summary.rolePmReplacementLifecycle.incomingPrincipalUserId ?? ""}, live=${summary.rolePmReplacementLifecycle.commandLiveDeltaKind ?? ""}, reloadPosts=${summary.rolePmReplacementLifecycle.reloadedPostCount}, stale=${summary.rolePmReplacementLifecycle.stalePostReject ?? ""}, media=${summary.rolePmReplacementLifecycle.outgoingMediaStatus ?? ""}/${summary.rolePmReplacementLifecycle.outgoingMediaBodyBytes ?? ""} bytes |`,
    `| host ops | ${summary.hostOpsWorkflow.status} | prompt=${summary.hostOpsWorkflow.promptState ?? ""}, lifecycle=${summary.hostOpsWorkflow.slotLifecycleState ?? ""}, invite=${summary.hostOpsWorkflow.playerInviteStatus ?? ""}, staleInvite=${summary.hostOpsWorkflow.stalePlayerInviteState ?? ""}/${summary.hostOpsWorkflow.stalePlayerInviteRetryState ?? ""} |`,
  );
  return `${lines.join("\n")}\n`;
}

function hostOpsStatus(moderator) {
  return moderator?.hostPrompt?.commandStatus?.state === "ack" &&
    moderator?.slotLifecycle?.commandStatus?.state === "ack" &&
    moderator?.playerInviteTarget?.status === "passed" &&
    moderator?.stalePlayerInviteReject?.state === "recovered" &&
    moderator?.stalePlayerInviteReject?.retry?.state === "ack"
    ? "passed"
    : "failed";
}

function rolePmReplacementStatus(evidence) {
  return evidence?.status === "passed" &&
    evidence?.channelId === "private:role_pm:slot-7" &&
    evidence?.incoming?.submitOutcome?.state === "ack" &&
    evidence?.incoming?.initialLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.incoming?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.incoming?.reloadedPostBodies?.length >= 2 &&
    evidence?.incoming?.mediaBodyBytes > 0 &&
    evidence?.outgoing?.routeStatus === 403 &&
    evidence?.outgoing?.threadStatus === 403 &&
    evidence?.outgoing?.mediaStatus === 403 &&
    evidence?.outgoing?.mediaBodyBytes === 0 &&
    evidence?.outgoing?.stalePostReject?.error === "NotYourSlot"
    ? "passed"
    : "failed";
}

function commandGame(command) {
  return command?.command?.game ?? null;
}

function setupCommandEvidenceSummary(evidence) {
  return Object.fromEntries(
    setupCommandEvidenceKeys.map((key) => [
      key,
      evidence[key] === undefined || evidence[key] === null
        ? null
        : {
            status: evidence[key].status,
            commandKind: evidence[key].commandKind,
            streamSeqs: evidence[key].streamSeqs ?? [],
            readinessSummary: evidence[key].readinessSummary ?? null,
          },
    ]),
  );
}

function voteCountForSlot(votecount, slotId) {
  return (
    votecount?.find?.((event) => event.body?.candidate_slot === slotId)?.body?.count ??
    null
  );
}

function voteCountForProjection(projection, slotId) {
  return projection?.find?.((row) => row.target === slotId)?.count ?? null;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proofPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultProofPath;
  const jsonPath = process.env.FMARCH_LIVE_STACK_SUMMARY_JSON
    ? path.resolve(process.cwd(), process.env.FMARCH_LIVE_STACK_SUMMARY_JSON)
    : defaultJsonPath;
  const markdownPath = process.env.FMARCH_LIVE_STACK_SUMMARY_MD
    ? path.resolve(process.cwd(), process.env.FMARCH_LIVE_STACK_SUMMARY_MD)
    : defaultMarkdownPath;
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const summary = buildLiveStackProofSummary(proof, {
    proofPath: path.relative(repoRoot, proofPath),
  });
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(markdownPath, markdownLiveStackProofSummary(summary));
  console.log(`wrote ${path.relative(repoRoot, jsonPath)} (${summary.status})`);
}
