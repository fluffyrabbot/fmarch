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
  const additionalRooms = evidence.browser?.additionalRooms;
  const deadChat = evidence.browser?.deadChat;
  const spectator = evidence.browser?.spectator;
  const summary = {
    version: LIVE_STACK_PROOF_SUMMARY_VERSION,
    proof: "host-console-live-stack-summary",
    status: "passed",
    productionReady: false,
    generatedAt,
    scope: "local-live-stack-proof-summary",
    proofBoundary:
      "Compact derivative report from the local live-stack browser proof. It summarizes host setup, host votecount convergence, reconnect recovery, Role PM, Mason/Neighbor, dead-chat, and read-only spectator lifecycle evidence plus host ops evidence for inspection; the full proof JSON remains the source of truth and this does not prove hosted, beta, release, or production readiness.",
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
    additionalRoomLifecycle: {
      status: additionalRoomsStatus(additionalRooms),
      game: additionalRooms?.game ?? null,
      coveredKinds: additionalRooms?.coveredKinds ?? [],
      remainingKinds: additionalRooms?.remainingKinds ?? [],
      rooms: (additionalRooms?.rooms ?? []).map((room) => ({
        kind: room.kind,
        channelId: room.channelId,
        status: room.status,
        declaredMemberCount: room.declaredMemberSlots?.length ?? 0,
        outgoingSubmitState: room.outgoing?.submitOutcome?.state ?? null,
        outgoingLiveDeltaKind:
          room.outgoing?.commandLiveDelta?.delta?.kind ?? null,
        incomingSubmitState: room.incoming?.submitOutcome?.state ?? null,
        incomingInitialLiveDeltaKind:
          room.incoming?.initialLiveDelta?.delta?.kind ?? null,
        incomingCommandLiveDeltaKind:
          room.incoming?.commandLiveDelta?.delta?.kind ?? null,
        reloadedPostCount: room.incoming?.reloadedPostBodies?.length ?? 0,
        incomingMediaBodyBytes: room.incoming?.mediaBodyBytes ?? 0,
        encryptedStorage: room.encryptedStorage?.rawCheck ?? null,
        staleOutgoing: `${room.staleOutgoing?.routeStatus ?? ""}/${room.staleOutgoing?.threadStatus ?? ""}/${room.staleOutgoing?.mediaStatus ?? ""}/${room.staleOutgoing?.mediaBodyBytes ?? ""}/${room.staleOutgoing?.postReject?.error ?? ""}`,
        outsider: `${room.outsider?.routeStatus ?? ""}/${room.outsider?.threadStatus ?? ""}/${room.outsider?.mediaStatus ?? ""}/${room.outsider?.mediaBodyBytes ?? ""}/${room.outsider?.postReject?.error ?? ""}`,
      })),
    },
    deadChatLifecycle: {
      status: deadChatStatus(deadChat),
      game: deadChat?.game ?? null,
      channelId: deadChat?.channelId ?? null,
      derivedCapability: deadChat?.derivedCapability ?? null,
      outgoingSubmitState: deadChat?.outgoing?.submitOutcome?.state ?? null,
      outgoingLiveDeltaKind:
        deadChat?.outgoing?.commandLiveDelta?.delta?.kind ?? null,
      incomingSubmitState: deadChat?.incoming?.submitOutcome?.state ?? null,
      incomingInitialLiveDeltaKind:
        deadChat?.incoming?.initialLiveDelta?.delta?.kind ?? null,
      incomingCommandLiveDeltaKind:
        deadChat?.incoming?.commandLiveDelta?.delta?.kind ?? null,
      reloadedPostCount: deadChat?.incoming?.reloadedPostBodies?.length ?? 0,
      incomingMediaBodyBytes: deadChat?.incoming?.mediaBodyBytes ?? 0,
      encryptedStorage: deadChat?.encryptedStorage?.rawCheck ?? null,
      staleOutgoing: `${deadChat?.staleOutgoing?.routeStatus ?? ""}/${deadChat?.staleOutgoing?.threadStatus ?? ""}/${deadChat?.staleOutgoing?.mediaStatus ?? ""}/${deadChat?.staleOutgoing?.mediaBodyBytes ?? ""}/${deadChat?.staleOutgoing?.postReject?.error ?? ""}`,
      living: `${deadChat?.living?.routeStatus ?? ""}/${deadChat?.living?.threadStatus ?? ""}/${deadChat?.living?.mediaStatus ?? ""}/${deadChat?.living?.mediaBodyBytes ?? ""}/${deadChat?.living?.postReject?.error ?? ""}`,
      restoredAlive: `${deadChat?.restoredAlive?.routeStatus ?? ""}/${deadChat?.restoredAlive?.threadStatus ?? ""}/${deadChat?.restoredAlive?.mediaStatus ?? ""}/${deadChat?.restoredAlive?.mediaBodyBytes ?? ""}/${deadChat?.restoredAlive?.postReject?.error ?? ""}`,
    },
    spectatorRoomLifecycle: {
      status: spectatorRoomStatus(spectator),
      game: spectator?.game ?? null,
      channelId: spectator?.channelId ?? null,
      derivedCapability: spectator?.derivedCapability ?? null,
      preGrant: `${spectator?.preGrant?.routeStatus ?? ""}/${spectator?.preGrant?.threadStatus ?? ""}`,
      initialLiveDeltaKind: spectator?.initialLiveDelta?.delta?.kind ?? null,
      liveDeltaKind: spectator?.liveDelta?.delta?.kind ?? null,
      reloadedPostCount: spectator?.reloadedPostBodies?.length ?? 0,
      mediaBodyBytes: spectator?.initialMediaBodyBytes ?? 0,
      appendReject: spectator?.appendReject?.error ?? null,
      encryptedStorage: spectator?.encryptedStorage?.rawCheck ?? null,
      deniedEndpoints: spectator?.deniedEndpoints ?? {},
      revoked: `${spectator?.revoked?.routeStatus ?? ""}/${spectator?.revoked?.threadStatus ?? ""}/${spectator?.revoked?.mediaStatus ?? ""}/${spectator?.revoked?.mediaBodyBytes ?? ""}/${spectator?.revoked?.appendReject?.error ?? ""}`,
      accountSessionActive: spectator?.revoked?.accountSessionActive ?? false,
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
        id: "mason-neighbor-room-summary",
        status: additionalRoomsStatus(additionalRooms),
      },
      {
        id: "dead-chat-summary",
        status: deadChatStatus(deadChat),
      },
      {
        id: "spectator-room-summary",
        status: spectatorRoomStatus(spectator),
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
    "mason-neighbor-room-summary",
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
  if (
    summary.additionalRoomLifecycle?.status !== "passed" ||
    JSON.stringify(summary.additionalRoomLifecycle?.coveredKinds) !==
      JSON.stringify(["Mason", "Neighbor"]) ||
    JSON.stringify(summary.additionalRoomLifecycle?.remainingKinds) !==
      JSON.stringify([]) ||
    summary.additionalRoomLifecycle?.rooms?.some(
      (room) =>
        room.status !== "passed" ||
        room.encryptedStorage !== "2|0|2|0" ||
        room.staleOutgoing !== "403/403/403/0/NotYourSlot" ||
        room.outsider !== "403/403/403/0/NotAuthorized",
    )
  ) {
    throw new Error("live-stack summary missing Mason/Neighbor room lifecycle proof");
  }
  if (
    summary.deadChatLifecycle?.status !== "passed" ||
    summary.deadChatLifecycle?.channelId !== "dead" ||
    summary.deadChatLifecycle?.derivedCapability !== "DeadViewer(game)" ||
    summary.deadChatLifecycle?.encryptedStorage !== "2|0|2|0" ||
    summary.deadChatLifecycle?.staleOutgoing !== "403/403/403/0/NotYourSlot" ||
    summary.deadChatLifecycle?.living !== "403/403/403/0/NotAuthorized" ||
    summary.deadChatLifecycle?.restoredAlive !== "403/403/403/0/NotAuthorized"
  ) {
    throw new Error("live-stack summary missing dead-chat lifecycle proof");
  }
  if (
    summary.spectatorRoomLifecycle?.status !== "passed" ||
    summary.spectatorRoomLifecycle?.channelId !== "spectator" ||
    summary.spectatorRoomLifecycle?.derivedCapability !== "SpectatorOf(game)" ||
    summary.spectatorRoomLifecycle?.preGrant !== "403/403" ||
    summary.spectatorRoomLifecycle?.initialLiveDeltaKind !== "ThreadPostsChanged" ||
    summary.spectatorRoomLifecycle?.liveDeltaKind !== "ThreadPostsChanged" ||
    summary.spectatorRoomLifecycle?.encryptedStorage !== "2|0|2|0" ||
    summary.spectatorRoomLifecycle?.appendReject !== "NotAuthorized" ||
    summary.spectatorRoomLifecycle?.revoked !== "403/403/403/0/NotAuthorized" ||
    summary.spectatorRoomLifecycle?.accountSessionActive !== true
  ) {
    throw new Error("live-stack summary missing spectator-room lifecycle proof");
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
    `| Mason and Neighbor rooms | ${summary.additionalRoomLifecycle.status} | covered=${summary.additionalRoomLifecycle.coveredKinds.join(",")}, remaining=${summary.additionalRoomLifecycle.remainingKinds.join(",")}, rooms=${summary.additionalRoomLifecycle.rooms.map((room) => `${room.kind}:${room.status}:${room.encryptedStorage}`).join("; ")} |`,
    `| Dead chat | ${summary.deadChatLifecycle.status} | capability=${summary.deadChatLifecycle.derivedCapability ?? ""}, live=${summary.deadChatLifecycle.incomingInitialLiveDeltaKind ?? ""}/${summary.deadChatLifecycle.incomingCommandLiveDeltaKind ?? ""}, encrypted=${summary.deadChatLifecycle.encryptedStorage ?? ""}, stale=${summary.deadChatLifecycle.staleOutgoing}, living=${summary.deadChatLifecycle.living}, restored=${summary.deadChatLifecycle.restoredAlive} |`,
    `| Spectator room | ${summary.spectatorRoomLifecycle.status} | capability=${summary.spectatorRoomLifecycle.derivedCapability ?? ""}, preGrant=${summary.spectatorRoomLifecycle.preGrant}, live=${summary.spectatorRoomLifecycle.initialLiveDeltaKind ?? ""}/${summary.spectatorRoomLifecycle.liveDeltaKind ?? ""}, encrypted=${summary.spectatorRoomLifecycle.encryptedStorage ?? ""}, append=${summary.spectatorRoomLifecycle.appendReject ?? ""}, revoked=${summary.spectatorRoomLifecycle.revoked} |`,
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

function additionalRoomsStatus(evidence) {
  const expectedKinds = ["Mason", "Neighbor"];
  return evidence?.status === "passed" &&
    JSON.stringify(evidence.coveredKinds) === JSON.stringify(expectedKinds) &&
    JSON.stringify(evidence.remainingKinds) ===
      JSON.stringify([]) &&
    expectedKinds.every((kind) => {
      const room = evidence.rooms?.find((candidate) => candidate.kind === kind);
      return (
        room?.status === "passed" &&
        room.declaredMemberSlots?.length === 2 &&
        room.outgoing?.submitOutcome?.state === "ack" &&
        room.outgoing?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
        room.incoming?.submitOutcome?.state === "ack" &&
        room.incoming?.initialLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
        room.incoming?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
        room.incoming?.reloadedPostBodies?.length === 2 &&
        room.incoming?.mediaBodyBytes > 0 &&
        room.encryptedStorage?.rawCheck === "2|0|2|0" &&
        room.staleOutgoing?.routeStatus === 403 &&
        room.staleOutgoing?.threadStatus === 403 &&
        room.staleOutgoing?.mediaStatus === 403 &&
        room.staleOutgoing?.mediaBodyBytes === 0 &&
        room.staleOutgoing?.postReject?.error === "NotYourSlot" &&
        room.outsider?.routeStatus === 403 &&
        room.outsider?.threadStatus === 403 &&
        room.outsider?.mediaStatus === 403 &&
        room.outsider?.mediaBodyBytes === 0 &&
        room.outsider?.postReject?.error === "NotAuthorized"
      );
    })
    ? "passed"
    : "failed";
}

function deadChatStatus(evidence) {
  return evidence?.status === "passed" &&
    evidence?.channelId === "dead" &&
    evidence?.derivedCapability === "DeadViewer(game)" &&
    evidence?.outgoing?.submitOutcome?.state === "ack" &&
    evidence?.outgoing?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.incoming?.submitOutcome?.state === "ack" &&
    evidence?.incoming?.initialLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.incoming?.commandLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.incoming?.reloadedPostBodies?.length === 2 &&
    evidence?.incoming?.mediaBodyBytes > 0 &&
    evidence?.encryptedStorage?.rawCheck === "2|0|2|0" &&
    evidence?.staleOutgoing?.routeStatus === 403 &&
    evidence?.staleOutgoing?.threadStatus === 403 &&
    evidence?.staleOutgoing?.mediaStatus === 403 &&
    evidence?.staleOutgoing?.mediaBodyBytes === 0 &&
    evidence?.staleOutgoing?.postReject?.error === "NotYourSlot" &&
    evidence?.living?.routeStatus === 403 &&
    evidence?.living?.threadStatus === 403 &&
    evidence?.living?.mediaStatus === 403 &&
    evidence?.living?.mediaBodyBytes === 0 &&
    evidence?.living?.postReject?.error === "NotAuthorized" &&
    evidence?.restoredAlive?.routeStatus === 403 &&
    evidence?.restoredAlive?.threadStatus === 403 &&
    evidence?.restoredAlive?.mediaStatus === 403 &&
    evidence?.restoredAlive?.mediaBodyBytes === 0 &&
    evidence?.restoredAlive?.postReject?.error === "NotAuthorized"
    ? "passed"
    : "failed";
}

function spectatorRoomStatus(evidence) {
  const denied = evidence?.deniedEndpoints ?? {};
  return evidence?.status === "passed" &&
    evidence?.channelId === "spectator" &&
    evidence?.derivedCapability === "SpectatorOf(game)" &&
    evidence?.preGrant?.routeStatus === 403 &&
    evidence?.preGrant?.threadStatus === 403 &&
    evidence?.initialMediaBodyBytes > 0 &&
    evidence?.initialLiveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.liveDelta?.delta?.kind === "ThreadPostsChanged" &&
    evidence?.reloadedPostBodies?.length === 2 &&
    evidence?.appendReject?.error === "NotAuthorized" &&
    evidence?.encryptedStorage?.rawCheck === "2|0|2|0" &&
    ["dead", "rolePm", "faction", "main", "notifications", "investigations", "commandState"].every(
      (id) => denied[id] === 403,
    ) &&
    evidence?.revoked?.routeStatus === 403 &&
    evidence?.revoked?.threadStatus === 403 &&
    evidence?.revoked?.mediaStatus === 403 &&
    evidence?.revoked?.mediaBodyBytes === 0 &&
    evidence?.revoked?.appendReject?.error === "NotAuthorized" &&
    evidence?.revoked?.accountSessionActive === true
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
