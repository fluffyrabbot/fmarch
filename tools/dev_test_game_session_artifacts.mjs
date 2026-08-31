import path from "node:path";

export const canonicalSessionArtifacts = Object.freeze({
  json: "target/dev-test-game/session.json",
  markdown: "target/dev-test-game/session.md",
  proofRun: "target/dev-test-game/proof-run.json",
});

export const hostSetupSessionArtifacts = Object.freeze({
  json: "target/dev-test-game/host-setup-session.json",
  markdown: "target/dev-test-game/host-setup-session.md",
  proofRun: "target/dev-test-game/host-setup-proof.json",
});

export function sessionArtifactsForConfiguration(
  paths,
  { hostSetupOnly = false } = {},
) {
  const selected = hostSetupOnly
    ? paths.session.hostSetup
    : paths.session.canonical;
  return sessionArtifactsForPaths({
    repoRoot: paths.repoRoot,
    jsonPath: selected.json,
    markdownPath: selected.markdown,
    proofRunPath: selected.proofRun,
  });
}

export function sessionArtifactsForPaths({
  repoRoot,
  jsonPath,
  markdownPath,
  proofRunPath,
}) {
  return Object.freeze({
    json: path.relative(repoRoot, jsonPath),
    markdown: path.relative(repoRoot, markdownPath),
    proofRun: path.relative(repoRoot, proofRunPath),
  });
}

export function buildSessionCard({
  game,
  gameName,
  seedMode,
  databaseUrl,
  apiBaseUrl,
  frontendBaseUrl,
  seedCommands,
  setupBootstrap = null,
  identityBootstrap = null,
  sessions,
  artifacts = canonicalSessionArtifacts,
}) {
  const withFrontendUrls = Object.fromEntries(
    Object.entries(sessions).map(([role, session]) => [
      role,
      {
        ...session,
        loginUrl: roleLoginUrl({ frontendBaseUrl, session }),
        directUrl: `${frontendBaseUrl}${session.returnTo}`,
      },
    ]),
  );
  return {
    status: "ready",
    name: gameName,
    game,
    pack: "mafiascum",
    phase: "D01",
    seedMode,
    databaseUrl,
    apiBaseUrl,
    frontendBaseUrl,
    seedCommandCount:
      seedCommands.length + (setupBootstrap?.commandCount ?? 0),
    directSeedCommandCount: seedCommands.length,
    setupBootstrap,
    identityBootstrap,
    sessions: withFrontendUrls,
    artifacts,
  };
}

export function withSessionVerification(card, verification) {
  return {
    ...card,
    verification,
  };
}

export function roleLoginUrl({ frontendBaseUrl, session }) {
  const params = new URLSearchParams({ returnTo: session.returnTo });
  let route = "/auth/login";
  if (
    session.credentialKind === "invite" ||
    session.inviteToken !== undefined
  ) {
    route = "/auth/game-invite";
    params.set("invite", session.inviteToken);
    if (session.accountId !== undefined) {
      params.set("account", session.accountId);
    }
  } else if (session.credentialKind === "account") {
    route = "/auth/login/classic";
    params.set("account", session.accountId);
  } else if (typeof session.token === "string" && session.token !== "") {
    route = "/auth/game-invite";
  }
  return `${frontendBaseUrl}${route}?${params.toString()}`;
}

export function sessionArtifactWrites({ card, repoRoot }) {
  return Object.freeze([
    artifactWrite(
      path.join(repoRoot, card.artifacts.json),
      jsonArtifactDocument(card),
    ),
    artifactWrite(
      path.join(repoRoot, card.artifacts.markdown),
      markdownSessionCard(card),
    ),
  ]);
}

export function verificationProofArtifactWrites({
  card,
  verification,
  paths,
  generatedAt,
}) {
  const writes = [];
  if (verification.earliestReachedTie !== undefined) {
    writes.push(
      artifactWrite(
        paths.proof.earliestReached,
        jsonArtifactDocument(verification.earliestReachedTie),
      ),
    );
  }
  if (verification.hostDecidesTie !== undefined) {
    writes.push(
      artifactWrite(
        paths.proof.hostDecides,
        jsonArtifactDocument(verification.hostDecidesTie),
      ),
    );
  }
  const hostDecidesRace =
    verification.hostDecidesRace ??
    verification.multiplayerHardening?.concurrentHostPromptSelectionRace;
  if (hostDecidesRace !== undefined) {
    writes.push(
      artifactWrite(
        paths.proof.hostDecidesRace,
        jsonArtifactDocument(hostDecidesRace),
      ),
    );
  }
  writes.push(
    artifactWrite(
      paths.proof.hostSetup,
      jsonArtifactDocument(
        buildDevTestGameHostSetupProof(card, verification, {
          ...(generatedAt === undefined ? {} : { generatedAt }),
        }),
      ),
    ),
  );
  return Object.freeze(writes);
}

export function proofRunArtifactWrite({ proofRun, paths }) {
  return artifactWrite(
    paths.session.canonical.proofRun,
    jsonArtifactDocument(proofRun),
  );
}

export function buildDevTestGameHostSetupProof(
  card,
  verification,
  { generatedAt = new Date().toISOString() } = {},
) {
  return {
    proof: "dev-test-game-host-setup-proof",
    status: "passed",
    game: card.game,
    generatedAt,
    proofBoundary:
      "Local dev-test-game host setup role URL browser proof over the seeded setup route plus a disposable setup game. Proves setup route rendering, policy round-trip, stale duplicate AddSlot rejection, setup refresh after reject, roster assignment, role assignment, and readiness recovery; it does not prove the full core loop, multiplayer hardening, hosted deployment, beta readiness, or production readiness.",
    hostSetup: verification.hostSetup,
    mediaResponseGuard: verification.mediaResponseGuard,
  };
}

export function jsonArtifactDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseNamedGamesRegistry(body) {
  const parsed = JSON.parse(body);
  return parsed !== null && typeof parsed === "object" ? parsed : {};
}

export function buildNamedGamesRegistry(
  registry,
  name,
  card,
  { updatedAt = new Date().toISOString() } = {},
) {
  return {
    ...registry,
    [name]: {
      game: card.game,
      updatedAt,
      session: card.artifacts,
    },
  };
}

export function namedGamesRegistryDocument(
  registry,
  name,
  card,
  options,
) {
  return jsonArtifactDocument(
    buildNamedGamesRegistry(registry, name, card, options),
  );
}

export function sessionCardConsoleLines(card) {
  const lines = [
    "\nfmarch dev test game is ready",
    `name: ${card.name}`,
    `game: ${card.game}`,
    `seed: ${card.seedMode}`,
    `frontend: ${card.frontendBaseUrl}`,
    `api: ${card.apiBaseUrl}`,
    `artifact: ${card.artifacts.markdown}`,
  ];
  for (const [role, session] of Object.entries(card.sessions)) {
    lines.push(
      `\n${role}`,
      `  url:    ${session.loginUrl}`,
    );
    const token = session.inviteToken ?? session.token;
    if (token !== undefined) {
      lines.push(`  token:  ${token}`);
    }
    if (session.accountId !== undefined) {
      lines.push(`  account: ${session.accountId}`);
      if (typeof session.password === "string") {
        lines.push(`  password: ${session.password}`);
      }
    }
  }
  return Object.freeze(lines);
}

export function relativeArtifactPath(paths, filePath) {
  return path.relative(paths.repoRoot, filePath);
}

function artifactWrite(filePath, contents) {
  return Object.freeze({ filePath, contents });
}

export function markdownSessionCard(card) {
  const lines = [
    "# fmarch Dev Test Game",
    "",
    `- status: ${card.status}`,
    `- name: ${card.name}`,
    `- game: ${card.game}`,
    `- pack: ${card.pack}`,
    `- phase: ${card.phase}`,
    `- seed: ${card.seedMode}`,
    `- frontend: ${card.frontendBaseUrl}`,
    `- api: ${card.apiBaseUrl}`,
    ...(card.setupBootstrap === null
      ? []
      : [
          `- setup bootstrap: ${card.setupBootstrap.status} via ${card.setupBootstrap.roleUrl}`,
          `- setup bootstrap commands: ${card.setupBootstrap.commandCount}`,
        ]),
    ...(card.identityBootstrap === null
      ? []
      : [
          `- identity bootstrap: ${card.identityBootstrap.rootSessionSource} -> ${card.identityBootstrap.browserCredentialIssuer}`,
          `- root session process-bound: ${card.identityBootstrap.rootSessionProcessBound}`,
          `- local proof instance id exposed: ${card.identityBootstrap.localProofInstanceIdExposed}`,
        ]),
    "",
    "Open a role login URL, enter the seeded account password, and submit. Invite tokens and account IDs are prefilled in the URL; session tokens are repeated below for recovery/debug use.",
    "",
  ];
  for (const [role, session] of Object.entries(card.sessions)) {
    const token = session.inviteToken ?? session.token;
    lines.push(
      `## ${role}`,
      "",
      `Role login URL: ${session.loginUrl}`,
      "",
      ...(token === undefined ? [] : [`Credential token: ${token}`]),
      ...(session.accountId === undefined
        ? []
        : [
            `Account: ${session.accountId}`,
            ...(typeof session.password === "string"
              ? [`Password: ${session.password}`]
              : []),
          ]),
      "",
    );
  }
  if (card.verification !== undefined) {
    lines.push("## Verification", "", `Roles: ${card.verification.roles.join(", ")}`, "");
    if (card.verification.sessions !== undefined) {
      for (const [role, verified] of Object.entries(card.verification.sessions)) {
        lines.push(
          "",
          `- ${role}: ${verified.capabilityKinds.join(", ")} via ${verified.cookie.valuePrefix}...`,
        );
      }
      lines.push("");
    }
    if (card.verification.proofStability !== undefined) {
      const hostConfirmClicks = card.verification.proofStability.hostConfirmClicks;
      lines.push(
        "## Proof Stability Audit",
        "",
        `Status: ${card.verification.proofStability.status}`,
        "",
        `Host confirms: ${hostConfirmClicks.total} total; ${hostConfirmClicks.concurrentClickCount ?? 0} concurrent browser clicks; ${hostConfirmClicks.retryClickCount} retried; ${hostConfirmClicks.domFallbackCount} DOM fallbacks; ${hostConfirmClicks.forceFallbackCount} force fallbacks`,
        "",
      );
      if (hostConfirmClicks.events.length > 0) {
        lines.push("Host confirm retry/fallback events:", "");
        for (const event of hostConfirmClicks.events) {
          lines.push(
            `- ${event.actionId} ${event.roleLabel}: ${event.method} after ${event.attempts} attempts`,
          );
        }
        lines.push("");
      }
    }
    if (card.verification.coreLoop !== undefined) {
      lines.push(
        "## Core Loop Proof",
        "",
        `Status: ${card.verification.coreLoop.status}`,
        "",
        `Proof: ${card.verification.coreLoop.proof}`,
        "",
        `Rejected vote: ${card.verification.coreLoop.rejectedVote.message}`,
        "",
      );
    }
    if (card.verification.dayVoteResolution !== undefined) {
      lines.push(
        "## Day Vote Resolution Proof",
        "",
        `Status: ${card.verification.dayVoteResolution.status}`,
        "",
        `Proof: ${card.verification.dayVoteResolution.proof}`,
        "",
        `Outcome: ${card.verification.dayVoteResolution.dayVoteOutcome.status} ${card.verification.dayVoteResolution.dayVoteOutcome.winner_slot}`,
        "",
      );
    }
    if (card.verification.dayVoteNoLynch !== undefined) {
      lines.push(
        "## Day Vote No-Lynch Proof",
        "",
        `Status: ${card.verification.dayVoteNoLynch.status}`,
        "",
        `Proof: ${card.verification.dayVoteNoLynch.proof}`,
        "",
        `Outcome: ${card.verification.dayVoteNoLynch.dayVoteOutcome.status} ${card.verification.dayVoteNoLynch.dayVoteOutcome.tallies.no_lynch}`,
        "",
      );
    }
    if (card.verification.vanillizerRoleAction !== undefined) {
      lines.push(
        "## Vanillizer Role Action Proof",
        "",
        `Status: ${card.verification.vanillizerRoleAction.status}`,
        "",
        `Proof: ${card.verification.vanillizerRoleAction.proof}`,
        "",
        `Actor role URL: ${card.verification.vanillizerRoleAction.actorRoleUrl}`,
        "",
        `Target role URL: ${card.verification.vanillizerRoleAction.targetRoleUrl}`,
        "",
        `Target role: ${card.verification.vanillizerRoleAction.targetBefore.commandState.role.key} -> ${card.verification.vanillizerRoleAction.targetAfterReload.commandState.role.key}`,
        "",
      );
    }
    if (card.verification.cohostConsole !== undefined) {
      lines.push(
        "## Cohost Console Proof",
        "",
        `Status: ${card.verification.cohostConsole.status}`,
        "",
        `Proof: ${card.verification.cohostConsole.proof}`,
        "",
        `Extend deadline: ${card.verification.cohostConsole.extendDeadline.statusMessage}`,
        "",
        `Host-only controls visible: ${card.verification.cohostConsole.hostOnlyControlsVisible}`,
        "",
        `Host-only resolve: ${card.verification.cohostConsole.hostOnlyResolveReject.statusMessage}`,
        "",
      );
    }
    if (card.verification.cohostLaterPhaseDeadline !== undefined) {
      lines.push(
        "## Cohost Later-Phase Deadline Proof",
        "",
        `Status: ${card.verification.cohostLaterPhaseDeadline.status}`,
        "",
        `Proof: ${card.verification.cohostLaterPhaseDeadline.proof}`,
        "",
        `Extend deadline: ${card.verification.cohostLaterPhaseDeadline.extendDeadline.statusMessage}`,
        "",
        `Phase after reload: ${card.verification.cohostLaterPhaseDeadline.reload.phaseAfterReload.id} deadline ${card.verification.cohostLaterPhaseDeadline.reload.phaseAfterReload.deadline}`,
        "",
      );
    }
    if (card.verification.actionLoop !== undefined) {
      lines.push(
        "## Action Loop Proof",
        "",
        `Status: ${card.verification.actionLoop.status}`,
        "",
        `Proof: ${card.verification.actionLoop.proof}`,
        "",
        `Invalid action: ${card.verification.actionLoop.invalidAction.message}`,
        "",
        `Legal action: ${card.verification.actionLoop.legalAction.message}`,
        "",
      );
      if (card.verification.actionLoop.d02VoteNightTransition !== undefined) {
        lines.push(
          `D02 vote/night: ${card.verification.actionLoop.d02VoteNightTransition.dayVoteOutcome.status} -> ${card.verification.actionLoop.d02VoteNightTransition.n02ActionSurface.commandState.phase.phaseId}`,
          "",
        );
      }
    }
    if (card.verification.invalidActionRecovery !== undefined) {
      lines.push(
        "## Invalid Action Recovery Proof",
        "",
        `Status: ${card.verification.invalidActionRecovery.status}`,
        "",
        `Proof: ${card.verification.invalidActionRecovery.proof}`,
        "",
        `Reject: ${card.verification.invalidActionRecovery.reject.message}`,
        "",
        `Receipt: ${card.verification.invalidActionRecovery.currentReceipt.message}`,
        "",
        `Legal action visible: ${card.verification.invalidActionRecovery.legalActionVisible}`,
        "",
      );
    }
    if (card.verification.resolutionReceipts !== undefined) {
      lines.push(
        "## Resolution Receipt Proof",
        "",
        `Status: ${card.verification.resolutionReceipts.status}`,
        "",
        `Proof: ${card.verification.resolutionReceipts.proof}`,
        "",
        `Target notice: ${card.verification.resolutionReceipts.targetNotice.effect} ${card.verification.resolutionReceipts.targetNotice.status}`,
        "",
        `Normal player notice leaked: ${card.verification.resolutionReceipts.normalPlayerNoticeVisible}`,
        "",
      );
    }
    if (card.verification.deadPlayerRecovery !== undefined) {
      lines.push(
        "## Dead Player Recovery Proof",
        "",
        `Status: ${card.verification.deadPlayerRecovery.status}`,
        "",
        `Proof: ${card.verification.deadPlayerRecovery.proof}`,
        "",
        `Actor status: ${card.verification.deadPlayerRecovery.commandState.actorStatus}`,
        "",
        `Direct vote: ${card.verification.deadPlayerRecovery.directVote.statusMessage}`,
        "",
        `Direct post: ${card.verification.deadPlayerRecovery.directPost.statusMessage}`,
        "",
        `Direct action: ${card.verification.deadPlayerRecovery.directAction.statusMessage}`,
        "",
      );
    }
    if (card.verification.playerActionBoundary !== undefined) {
      lines.push(
        "## Player Action Boundary Proof",
        "",
        `Status: ${card.verification.playerActionBoundary.status}`,
        "",
        `Proof: ${card.verification.playerActionBoundary.proof}`,
        "",
        `Factional kill visible: ${card.verification.playerActionBoundary.factionalKillVisible}`,
        "",
        `Direct factional kill: ${card.verification.playerActionBoundary.directFactionalKill.statusMessage}`,
        "",
      );
    }
    if (card.verification.privateChannel !== undefined) {
      lines.push(
        "## Private Channel Proof",
        "",
        `Status: ${card.verification.privateChannel.status}`,
        "",
        `Proof: ${card.verification.privateChannel.proof}`,
        "",
        `Allowed post: ${card.verification.privateChannel.allowed.submitPost.message}`,
        "",
        `Denied route: ${card.verification.privateChannel.denied.status} ${card.verification.privateChannel.denied.actionLabel}`,
        "",
      );
    }
    if (card.verification.replacementConsole !== undefined) {
      lines.push(
        "## Replacement Console Proof",
        "",
        `Status: ${card.verification.replacementConsole.status}`,
        "",
        `Proof: ${card.verification.replacementConsole.proof}`,
        "",
        `Host-issued invite: ${card.verification.replacementConsole.hostIssuedInvite.statusText}`,
        "",
        `Redeemed invite recovery: ${card.verification.replacementConsole.redeemedInviteRecovery.message}`,
        "",
        `Revoked replacement session recovery: ${card.verification.replacementConsole.replacementSessionRevocation.routeErrorStatus}`,
        "",
        `Replacement session refresh recovery: ${card.verification.replacementConsole.replacementSessionRefresh.postStatus.message}`,
        "",
        `Invalid replacement recovery: ${card.verification.replacementConsole.invalidReplacementRecovery.reject.error}`,
        "",
        `Process replacement: ${card.verification.replacementConsole.processReplacement.statusMessage}`,
        "",
        `Assigned principal: ${card.verification.replacementConsole.projectedReplacement.assignedPrincipalId}`,
        "",
        `Replacement duplicate retry: ${card.verification.replacementConsole.replacementIdempotentRetry.retryReplacement.message}`,
        "",
        `Stale host invite recovery: ${card.verification.replacementConsole.staleHostInviteRecovery.retry.message}`,
        "",
        `Stale outgoing recovery: ${card.verification.replacementConsole.staleOutgoingPlayer.reject.message}`,
        "",
        `Stale replacement recovery: ${card.verification.replacementConsole.staleReplacementAfterSuccess.reject.error}`,
        "",
        `Incoming replacement: ${card.verification.replacementConsole.incomingPlayer.browserEntry.principalId} ${card.verification.replacementConsole.incomingPlayer.postStatus.message}`,
        "",
      );
    }
    if (card.verification.multiplayerHardening !== undefined) {
      lines.push(
        "## Multiplayer Hardening Proof",
        "",
        `Status: ${card.verification.multiplayerHardening.status}`,
        "",
        `Proof: ${card.verification.multiplayerHardening.proof}`,
        "",
        `Duplicate retry: ${card.verification.multiplayerHardening.idempotentRetry.retryPost.message}`,
        "",
        `Reconnect: attempt ${card.verification.multiplayerHardening.reconnect.reconnectRecoveryEvent.attempt} ${card.verification.multiplayerHardening.reconnect.reconnectRecoveryEvent.state}`,
        "",
        `Live lag resync: ${card.verification.multiplayerHardening.liveProjectionLagResync.resyncRecoveryCount} recoveries, ${card.verification.multiplayerHardening.liveProjectionLagResync.recoveryEpisodes.map((episode) => episode.continuationDeltaKind).join("/")}, reconnects ${card.verification.multiplayerHardening.liveProjectionLagResync.reconnectEventCount}`,
        "",
        `Stale player vote: ${card.verification.multiplayerHardening.stalePlayerVote.reject.message}`,
        "",
        `Stale dead-target vote: ${card.verification.multiplayerHardening.staleDeadTargetVote.reject.message}`,
        "",
        `Dead current vote: ${card.verification.multiplayerHardening.deadCurrentVote.target.label} cleared`,
        "",
        `Concurrent vote race: ${card.verification.multiplayerHardening.concurrentVoteRace.targetSlot} count ${card.verification.multiplayerHardening.concurrentVoteRace.apiProjection.count}`,
        "",
        `Concurrent player vote/resolve race: ${card.verification.multiplayerHardening.concurrentPlayerVoteResolveRace.outcomeSummary}`,
        "",
        `Concurrent player action/advance race: ${card.verification.multiplayerHardening.concurrentPlayerActionAdvanceRace.reject.message}`,
        "",
        `Concurrent cohost deadline/resolve race: ${card.verification.multiplayerHardening.concurrentCohostDeadlineResolveRace.outcomeSummary}`,
        "",
        `Concurrent replacement private-post race: ${card.verification.multiplayerHardening.concurrentReplacementPrivatePostRace.outcomeSummary}`,
        "",
        `Concurrent replacement vote race: ${card.verification.multiplayerHardening.concurrentReplacementVoteRace.outcomeSummary}`,
        "",
        `Concurrent replacement action race: ${card.verification.multiplayerHardening.concurrentReplacementActionRace.outcomeSummary}`,
        "",
        `Incoming replacement action: ${card.verification.multiplayerHardening.replacementIncomingAction.outcomeSummary}`,
        "",
        `Replacement action reconnect: ${card.verification.multiplayerHardening.replacementActionReconnect.outcomeSummary}`,
        "",
        `Stale replacement action after resolve: ${card.verification.multiplayerHardening.replacementStaleActionAfterResolve.reject.message}`,
        "",
        `Host lifecycle: ${card.verification.multiplayerHardening.hostLifecycleControl.markDead.statusMessage}`,
        "",
        `Stale host lifecycle: ${card.verification.multiplayerHardening.staleHostLifecycle.reject.message}`,
        "",
        `Host modkill: ${card.verification.multiplayerHardening.hostModkillControl.modkill.statusMessage}`,
        "",
        `Stale host modkill: ${card.verification.multiplayerHardening.staleHostModkill.reject.message}`,
        "",
        `Concurrent host lifecycle race: ${card.verification.multiplayerHardening.concurrentHostLifecycleRace.reject.message}`,
        "",
        `Concurrent HostDecides selection race: ${card.verification.multiplayerHardening.concurrentHostPromptSelectionRace.reject.message}`,
        "",
        `Concurrent host complete race: ${card.verification.multiplayerHardening.concurrentHostCompleteRace.reject.message}`,
        "",
        `Concurrent host publish race: ${card.verification.multiplayerHardening.concurrentHostPublishRace.reject.message}`,
        "",
      );
      if (card.verification.multiplayerHardening.concurrentPlayerCompleteRace !== undefined) {
        lines.push(
          `Concurrent player complete race: ${card.verification.multiplayerHardening.concurrentPlayerCompleteRace.outcomeSummary}`,
          "",
        );
      }
      lines.push(
        `Action idempotent retry: ${card.verification.multiplayerHardening.actionIdempotentRetry.retry.message}`,
        "",
        `Stale same action: ${card.verification.multiplayerHardening.staleSameActionRecovery.reject.message}`,
        "",
        `Stale action conflict: ${card.verification.multiplayerHardening.staleActionConflict.reject.message}`,
        "",
        `Stale control: ${card.verification.multiplayerHardening.staleHostControl.reject.message}`,
        "",
        `Concurrent host resolve race: ${card.verification.multiplayerHardening.concurrentHostResolveRace.reject.message}`,
        "",
        `Concurrent host advance race: ${card.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.message}`,
        "",
        `Concurrent host deadline race: ${card.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject.message}`,
        "",
        `Concurrent host mixed advance race: ${card.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.message}`,
        "",
        `Stale host resolve: ${card.verification.multiplayerHardening.staleHostResolve.reject.message}`,
        "",
        `Stale host advance: ${card.verification.multiplayerHardening.staleHostAdvance.reject.message}`,
        "",
        `Stale host publish: ${card.verification.multiplayerHardening.staleHostPublish.reject.message}`,
        "",
        `Stale host prompt: ${card.verification.multiplayerHardening.staleHostPrompt.reject.message}`,
        "",
        `Stale host complete: ${card.verification.multiplayerHardening.staleHostComplete.reject.message}`,
        "",
        `Stale player complete: ${card.verification.multiplayerHardening.stalePlayerComplete.reject.message}`,
        "",
        `Stale host deadline: ${card.verification.multiplayerHardening.staleHostDeadline.reject.message}`,
        "",
        `Stale cohost deadline: ${card.verification.multiplayerHardening.staleCohostDeadline.reject.message}`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

