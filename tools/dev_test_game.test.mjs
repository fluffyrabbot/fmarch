import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildSessionCard,
  createTokenSet,
  markdownSessionCard,
  parseArgs,
  seedCommandPlanForGame,
  selectGame,
} from "./dev_test_game.mjs";
import {
  assertDevTestGameProofRun,
  buildDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  assertHostedAdminHandoffProofReadinessDecisions,
  assertDevTestGameReleaseReadiness,
  buildDevTestGameReleaseReadiness,
  hostedAdminHandoffProofReadinessDecision,
  recoveryReceiptReleaseReadinessValidators,
  validateDevTestGameAdminSpineProof,
  validateDevTestGameAdminSpineTerminalBatches,
  validateDevTestGameHostSetupProof,
} from "./dev_test_game_release_readiness.mjs";
import {
  completedGameHardeningSpineCycleId,
  completedGameRaceCoverageCellCases,
  completedGameRaceCoverageCellIds,
  completedGameHardeningSpineLaneCases,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  coreLoopGeneratedFromScenarioFamilies,
} from "./dev_test_game_core_loop_generated_from_families.mjs";
import {
  playerInvalidActionRecoveryMessage,
} from "./dev_test_game_core_loop_player_action_recovery_scenarios.mjs";
import {
  completedGameEndgameSurfaceFixture,
  dayFiveNoLynchResolutionSurfaceFixture,
} from "./dev_test_game_core_loop_completed_game_fixtures.mjs";
import {
  completedPrivateChannelSnapshot,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransition,
  coreLoopPrivateChannelRecoveryCoverageFamilies,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelInvalidActionRecoveryScenario,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  hostPhaseTransitionActionFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";
import {
  nightFourNoActionSurfaceFixture,
  nightFourNoActionResolutionSurfaceFixture,
  postNightFourTransitionSurfaceFixture,
} from "./dev_test_game_core_loop_late_action_fixtures.mjs";
import {
  postDayThreeResolutionSurfaceFixture,
} from "./dev_test_game_core_loop_surface_fixtures.mjs";
import {
  assertDevTestGameOpsArtifacts,
  buildDevTestGameOpsArtifacts,
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_ops_artifacts.mjs";
import {
  assertDevTestGameHostedOpsSignals,
  buildDevTestGameHostedOpsSignals,
  devTestGameHostedOpsSignalsCommand,
  devTestGameHostedOpsSignalsPath,
} from "./dev_test_game_hosted_ops_signals.mjs";
import {
  devTestGameHostedOpsSignalsAdminProofPath,
  hostedOpsSignalCheckIds,
  hostedOpsSignalRelatedAuditIds,
  hostedOpsTelemetryBoundaryCheckId,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityHandoffCase,
  realHostedObservabilityHandoffCheckIds,
  realHostedObservabilityHandoffInputIds,
  realHostedObservabilityHandoffInputSections,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  hostedIdentityEvidencePathKind,
  releaseAdminProofFallbackUnprovenIds,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  devTestGameReleaseAdminProofPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameAdminSpineAdminProofPath,
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  assertDevTestGameSeedFixtureSummary,
  buildDevTestGameSeedFixtureSummary,
} from "./dev_test_game_seed_fixture_summary.mjs";
import {
  seedProofLaneCoverageCountSummary,
  seedProofLaneCoverageFixture,
  seedProofLaneCoverageForPassedLanes,
  seedRequiredScenarioIds,
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  hostStaleControlCoverageFamilies,
  hostStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  privateChannelStaleActionConflictMessageLaneId,
  staleConflictMessageCoverageFamilies,
  staleConflictMessageSurfaceCases,
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  hostedMatrixAdminRequiredCheckIds,
  hostedMatrixExternalEvidenceProofTarget,
  hostedMatrixProgressCheckIds,
  hostedMatrixRealHostedBlockedCheckIds,
  hostedMatrixRealHostedEvidenceCommand,
  hostedMatrixRealHostedHandoffChecklist,
  hostedMatrixReconnectLaneIds,
  hostedMatrixRelatedAuditIds,
  hostedMatrixRequestedEvidenceIds,
  hostedMatrixStaleConflictMilestoneCases,
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  hardeningAuditLaneIds,
} from "./dev_test_game_hardening_scenarios.mjs";
import {
  replacementPrivateChannelRecoveryCoverageFamilies,
  replacementPrivateChannelRecoveryLaneIds,
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
  replacementStalePrivatePostAfterCompleteScenario,
  replacementStalePrivatePostAfterResolveScenario,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  replacementActionRecoveryCoverageFamilies,
  replacementActionLaneIds,
  replacementActionReconnectScenario,
  replacementIncomingActionScenario,
  replacementStaleActionAfterResolveScenario,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementHandoffRecoveryCoverageFamilies,
  replacementHandoffHardeningLaneIds,
  replacementHandoffRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  coreLoopAuditLaneIds,
  coreLoopAdminCheckIds,
} from "./dev_test_game_core_loop_scenarios.mjs";
import {
  adminSpineHostedOpsInputReadinessEnv,
  adminSpinePreGraphReadinessEvidenceEnv,
  adminSpineReadinessEvidenceEnv,
  adminSpineTerminalBatchProofPath,
  adminSpineTerminalBatchReadinessEvidenceEnv,
  devTestGameAdminSpinePlan,
  terminalAdminProofBatchPlan,
  terminalRefreshAdminProofBatchPlan,
} from "./dev_test_game_admin_spine.mjs";
import {
  backupAwareOpsEnv,
  backupRestoreEvidenceEnv,
  backupRestoreFinalReadinessEnv,
  devTestGameBackupRestoreSpinePlan,
  opsReadinessEnv,
  seedReadinessEnv,
} from "./dev_test_game_backup_restore_spine.mjs";
import {
  devTestGameIdentityOperatorSpinePlan,
  devTestGameIdentitySpinePlan,
  identityOperatorReadinessEnv,
  identityReadinessEnv,
} from "./dev_test_game_identity_spine.mjs";
import {
  devTestGameOpsSpinePlan,
  opsSpineReadinessEnv,
} from "./dev_test_game_ops_spine.mjs";
import {
  devTestGameSeedFixtureSpinePlan,
  seedFixtureSpineEnv,
} from "./dev_test_game_seed_fixture_spine.mjs";
import {
  buildDevTestGameIdentityAdapterContractPacket,
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterProofVersion,
} from "./dev_test_game_identity_adapter_contract.mjs";
import {
  assertDevTestGameHostedIdentityEvidence,
  buildDevTestGameHostedIdentityEvidence,
  devTestGameHostedIdentityCompleteAdminProofCommand,
  devTestGameHostedIdentityCompleteAdminProofPath,
  devTestGameHostedIdentityCompleteEvidencePath,
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityOperatorAdminProofCommand,
  devTestGameHostedIdentityOperatorAdminProofPath,
  devTestGameHostedIdentityOperatorEvidencePath,
  devTestGameHostedIdentityProgressionAdminProofCommand,
  devTestGameHostedIdentityProgressionSummaryCommand,
  devTestGameHostedIdentityProgressionSummaryPath,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceFixturePaths,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionStatuses,
  hostedIdentityEvidenceOperatorAbuseRateLimitPartialFixturePath,
  hostedIdentityEvidenceOperatorAbuseRateLimitRecoveredFixturePath,
  hostedIdentityEvidenceOperatorSessionSecretPartialFixturePath,
  hostedIdentityEvidenceOperatorSessionSecretRecoveredFixturePath,
  hostedIdentityEvidenceOperatorAuditRetentionPartialFixturePath,
  hostedIdentityEvidenceOperatorAuditRetentionRecoveredFixturePath,
  hostedIdentityEvidenceOperatorAccountLifecyclePartialFixturePath,
  hostedIdentityEvidenceOperatorAccountLifecycleRecoveredFixturePath,
  hostedIdentityEvidenceOperatorAccountRecoveryRecoveredFixturePath,
  hostedIdentityEvidenceOperatorInvitePartialFixturePath,
  hostedIdentityEvidenceOperatorInviteRecoveredFixturePath,
  hostedIdentityEvidenceOperatorProofDrilldowns,
  hostedIdentityEvidenceOperatorPartialFixturePath,
  hostedIdentityEvidenceOperatorRecoveredFixturePath,
  hostedIdentityOperatorEvidencePacketPath,
  hostedIdentityEvidencePacketSectionDefinitions,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionPath,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityEvidenceSectionInputRows,
  hostedIdentityEvidenceSectionInputStatuses,
  validateHostedIdentityEvidencePlaceholder,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  assertDevTestGameHostedIdentityProgressionSummary,
  buildDevTestGameHostedIdentityProgressionSummary,
} from "./dev_test_game_hosted_identity_progression_summary.mjs";
import {
  devTestGameCoreLiveSpinePlan,
  devTestGameLiveSpinePlan,
} from "./dev_test_game_live_spine.mjs";
import {
  recoveryReceiptGraphDescriptors,
  recoveryReceiptProofPlanSteps,
  recoveryReceiptProofTargets,
} from "./dev_test_game_recovery_receipt_catalog.mjs";
import {
  devTestGameReleaseReadinessScript,
  releaseReadinessSteps,
} from "./dev_test_game_spine_readiness_steps.mjs";
import {
  assertDevTestGameSpineManifest,
  buildDevTestGameSpineManifest,
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
  nextActionCommand,
  nextActionPath,
  proofFreshnessAdminProofCommand,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_spine_manifest.mjs";
import {
  buildAdminAuditHandoffPath,
} from "./dev_test_game_admin_audit_handoff_path.mjs";
import {
  assertGeneratedAdminProofHandoffPath,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import {
  hostedAdminHandoffProofArtifactCase,
  hostedAdminHandoffProofArtifactCases,
} from "./dev_test_game_hosted_handoff_proof_cases.mjs";
import {
  assertDevTestGameNextAction,
  buildDevTestGameNextAction,
  devTestGameDefaultSequenceStage,
  devTestGameHardeningAdminProofCommand,
  devTestGameHostedIdentitySequenceStage,
  devTestGameHostedIdentitySequencePromotionCommand,
  devTestGameIdentityAdminProofCommand,
  devTestGameLiveProofCommand,
  devTestGameNextActionPath,
  devTestGameReleaseReadinessPath,
  devTestGameSeedFixtureCommand,
  devTestGameSeedFixturePath,
  devTestGameSeedFixtureRoleUrl,
} from "./dev_test_game_next_action.mjs";
import {
  assertDevTestGameProofGraph,
  assertDevTestGameProofGraphCoversAdminSpine,
  assertDevTestGameProofGraphCoversProductionFeatureTargets,
  buildDevTestGameProofGraph,
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph.mjs";
import {
  adminProofDestinationRequirementLinkRows,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  productionFeatureGraphSourceNodeId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
import {
  assertDevTestGameRaceCoverage,
  buildDevTestGameRaceCoverage,
  devTestGameRaceCoverageAdminProofPath,
  devTestGameRaceCoverageCommand,
  devTestGameRaceCoveragePath,
  raceCoverageLocalReadinessMilestoneCases,
  raceCoveragePromotedReloadGroup,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  buildDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixCommand,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  featureSpineFixture,
  hostedProductionIdentityUnprovenFixture,
  invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenFixture,
  releaseReadinessTraceCandidateFixture,
} from "./dev_test_game_next_action_spine_fixtures.mjs";
import {
  coreLoopFeatureSpineTargetRows,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  devTestGameHostSetupProofCommand,
  hostSetupFeatureSpineCycleId,
  hostSetupFeatureSpineTargetRows,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  cohostFeatureSpineCycleId,
  cohostFeatureSpineTargetRows,
  devTestGameCohostConsoleProofCommand,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  devTestGameReplacementPlayerProofCommand,
  replacementFeatureSpineCycleId,
  replacementFeatureSpineTargetRows,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  devTestGameReplacementActionProofCommand,
  replacementActionFeatureSpineCycleId,
  replacementActionFeatureSpineTargetRows,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  devTestGameReplacementPrivateProofCommand,
  replacementPrivateFeatureSpineCycleId,
  replacementPrivateFeatureSpineTargetRows,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";
import {
  assertDevTestGameHostedMatrixExternalEvidence,
  buildDevTestGameHostedMatrixExternalEvidence,
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import {
  assertDevTestGameHostedEvidenceLane,
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
  runDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceLaneAdminProofPath,
  hostedEvidenceBlockedHandoffChecklistFixture,
  hostedEvidenceHandoffChecklistFromPreflight,
  hostedEvidenceHandoffBlockedCheckIds,
  hostedEvidenceHandoffInputIds,
  hostedEvidenceHandoffInputSectionStatuses,
  hostedEvidenceHandoffSectionInputRows,
  hostedEvidenceHandoffSectionInputStatuses,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  assertDevTestGameHostedEvidenceLaneDemoProof,
  devTestGameHostedEvidenceLaneDemoBlockedPath,
  devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
  devTestGameHostedEvidenceLaneDemoPassedPath,
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLaneDemoRawEvidencePath,
  runDevTestGameHostedEvidenceLaneDemoProof,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  assertDevTestGameHostedMatrixRawEvidence,
  buildDevTestGameHostedMatrixRawEvidence,
  devTestGameHostedMatrixRawEvidenceCommand,
  devTestGameHostedMatrixRawEvidencePath,
} from "./dev_test_game_hosted_matrix_raw_evidence.mjs";
import {
  assertDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightCommand,
  devTestGameHostedTargetPreflightAdminProofPath,
  devTestGameHostedTargetPreflightPath,
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightCheckIds,
  hostedTargetPreflightExternalTargetsRequiredEvidence,
  hostedTargetPreflightMissingApiUrlRequiredEvidence,
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_runbook.mjs";
import {
  devTestGameAdminSpineProofBatchPlans,
  devTestGameAdminSpineProofPlan,
} from "./dev_test_game_admin_spine_proof.mjs";
import {
  assertAdminRoleSurfaceStatusText,
  assertVisibleAdminRoleSurfaceRows,
  normalizedEvidenceObjectRowIds,
  resolveAdminAuditProofBatchPlan,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  recoveryMilestoneCoverageCases,
} from "./dev_test_game_release_readiness_milestone_cases.mjs";
import {
  privateChannelNormalizedEvidenceObjects,
  replacementPrivatePostNormalizedEvidenceObjects,
} from "./dev_test_game_normalized_evidence_objects.mjs";
import {
  assertReleaseAdminProof,
} from "./dev_test_game_release_admin_proof.mjs";
import {
  assertProofGraphAdminProof,
} from "./dev_test_game_proof_graph_admin_proof.mjs";

test("dev test-game args expose reset reuse naming and verification controls", () => {
  assert.deepEqual(
    parseArgs([
      "--name",
      "morning",
      "--reset",
      "--api-port",
      "4101",
      "--api-startup-timeout-ms",
      "900000",
      "--frontend-port",
      "4102",
      "--verify-host-setup-only",
      "--no-keepalive",
    ]),
    {
      name: "morning",
      reset: true,
      apiPort: 4101,
      apiStartupTimeoutMs: 900000,
      frontendPort: 4102,
      verifyHostSetupOnly: true,
      noKeepalive: true,
    },
  );

  assert.throws(() => parseArgs(["--frontend-port", "nope"]), /positive integer/);
});

test("session cards can target focused proof artifacts without clobbering canonical proof inputs", () => {
  const game = "45454545-4545-4545-8545-454545454545";
  const sessions = {
    hostSetup: {
      principalUserId: "host_h",
      credentialKind: "invite",
      token: "host-setup-token",
      inviteToken: "host-setup-token",
      returnTo: `/g/${game}/setup`,
      expectedCapabilityKind: "HostOf",
    },
  };

  const canonical = buildSessionCard({
    gameName: "canonical",
    game,
    seedMode: "seeded",
    databaseUrl: "postgres://db/fmarch",
    apiBaseUrl: "http://127.0.0.1:4101",
    frontendBaseUrl: "http://127.0.0.1:4102",
    seedCommands: [],
    sessions,
  });
  assert.deepEqual(canonical.artifacts, {
    json: "target/dev-test-game/session.json",
    markdown: "target/dev-test-game/session.md",
    proofRun: "target/dev-test-game/proof-run.json",
  });

  const focused = buildSessionCard({
    gameName: "host-setup",
    game,
    seedMode: "seeded",
    databaseUrl: "postgres://db/fmarch",
    apiBaseUrl: "http://127.0.0.1:4101",
    frontendBaseUrl: "http://127.0.0.1:4102",
    seedCommands: [],
    sessions,
    artifacts: {
      json: "target/dev-test-game/host-setup-session.json",
      markdown: "target/dev-test-game/host-setup-session.md",
      proofRun: "target/dev-test-game/host-setup-proof.json",
    },
  });
  assert.deepEqual(focused.artifacts, {
    json: "target/dev-test-game/host-setup-session.json",
    markdown: "target/dev-test-game/host-setup-session.md",
    proofRun: "target/dev-test-game/host-setup-proof.json",
  });
});

test("private-channel stale action recovery uses shared transition assertion", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");
  assert(
    source.includes(
      "./dev_test_game_core_loop_private_channel_context_assertions.mjs",
    ),
    "dev-test-game live harness should import shared private-channel context assertions",
  );
  assert(
    source.includes("./dev_test_game_core_loop_private_receipt_scenarios.mjs"),
    "dev-test-game live harness should import shared private-channel command outcome assertions",
  );
  const start = source.indexOf(
    "async function submitPrivateChannelStaleActionReconnectRecovery",
  );
  const end = source.indexOf("async function submitConcurrentActionRace", start);
  assert(start >= 0, "private-channel stale action recovery function should exist");
  assert(end > start, "private-channel stale action recovery function should be bounded");
  const body = source.slice(start, end);

  assert(
    body.includes("assertLiveStaleN01ActionTransitionRecovery"),
    "private-channel stale action recovery should reuse the shared stale action transition assertion",
  );
  assert(
    body.includes("liveStaleN01ToD02ActionTransitionScenario"),
    "private-channel stale action recovery should reuse the live N01-to-D02 scenario facts",
  );
  assert(
    body.includes("assertPrivateChannelRouteContext"),
    "private-channel stale action recovery should reuse shared channel route context assertions",
  );
});

test("private-channel recovery wrappers share channel context assertions", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");
  const wrappers = [
    {
      start: "async function verifyPrivateChannelInvalidActionRecovery",
      end: "async function verifySeededDeadPlayerRecovery",
      expected: [
        "assertPrivateChannelContext",
        "assertPrivateChannelRouteContext",
      ],
    },
    {
      start: "async function submitPrivateChannelStaleActionReconnectRecovery",
      end: "async function submitConcurrentActionRace",
      expected: ["assertPrivateChannelRouteContext"],
    },
    {
      start: "async function verifyStalePrivateChannelPostAfterPhaseTransition",
      end: "async function verifyCompletedPrivateChannelRecovery",
      expected: [
        "assertPrivateChannelId",
        "assertLivePrivateChannelSubmitPostAckOutcome",
        "submitPostAckProof",
      ],
    },
    {
      start: "async function verifyCompletedPrivateChannelRecovery",
      end: "async function seedPrivateChannelCompleteGame",
      expected: [
        "assertPrivateChannelContext",
        "assertPrivateChannelRouteContext",
        "assertLiveCompletedPrivateChannelPostRejectOutcome",
        "completedPostRejectProof",
      ],
    },
  ];

  for (const wrapper of wrappers) {
    const start = source.indexOf(wrapper.start);
    const end = source.indexOf(wrapper.end, start);
    assert(start >= 0, `${wrapper.start} should exist`);
    assert(end > start, `${wrapper.start} should be bounded by ${wrapper.end}`);
    const body = source.slice(start, end);
    for (const expected of wrapper.expected) {
      assert(
        body.includes(expected),
        `${wrapper.start} should use ${expected}`,
      );
    }
  }
});

test("dev test-game spine orchestrators expose stable proof order and env maps", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    packageJson.scripts["test:dev-test-game-core-live"],
    "node tools/dev_test_game_live_spine.mjs --core",
  );
  assert.equal(
    packageJson.scripts["test:dev-test-game-live"],
    "node tools/dev_test_game_live_spine.mjs",
  );
  assert.equal(
    packageJson.scripts["test:dev-test-game-ops"],
    "node tools/dev_test_game_ops_spine.mjs",
  );
  assert.equal(
    packageJson.scripts["test:dev-test-game-seed-fixture"],
    "node tools/dev_test_game_seed_fixture_spine.mjs",
  );
  assert.equal(
    packageJson.scripts["test:dev-test-game-next-action:hosted-identity"],
    "FMARCH_DEV_TEST_GAME_SEQUENCE_STAGE=hosted-identity npm run test:dev-test-game-next-action",
  );
  assert.equal(
    packageJson.scripts["test:dev-test-game-identity:operator"],
    "node tools/dev_test_game_identity_spine.mjs --operator",
  );
  assert.equal(
    packageJson.scripts[
      "test:dev-test-game-hosted-identity-partial-admin-proof"
    ],
    "node tools/dev_test_game_hosted_identity_partial_admin_proof.mjs",
  );
  assert.equal(
    packageJson.scripts[devTestGameHostedIdentityCompleteAdminProofCommand],
    "node tools/dev_test_game_hosted_identity_complete_admin_proof.mjs",
  );
  assert.equal(
    packageJson.scripts[devTestGameHostedIdentityOperatorAdminProofCommand],
    "node tools/dev_test_game_hosted_identity_operator_admin_proof.mjs",
  );
  assert.equal(
    devTestGameHostedIdentityCompleteEvidencePath,
    "target/dev-test-game/hosted-identity-evidence-complete.json",
  );
  assert.equal(
    devTestGameHostedIdentityCompleteAdminProofPath,
    "target/dev-test-game/hosted-identity-evidence-complete-admin-proof.json",
  );
  assert.equal(
    devTestGameHostedIdentityOperatorEvidencePath,
    "target/dev-test-game/hosted-identity-evidence-operator.json",
  );
  assert.equal(
    devTestGameHostedIdentityOperatorAdminProofPath,
    "target/dev-test-game/hosted-identity-evidence-operator-admin-proof.json",
  );
  assert.equal(
    hostedIdentityOperatorEvidencePacketPath,
    "target/operator-evidence/hosted-identity-redacted.example.json",
  );
  assert.equal(
    packageJson.scripts[
      "test:dev-test-game-hosted-identity-progression-admin-proof"
    ],
    "node tools/dev_test_game_hosted_identity_progression_admin_proof.mjs",
  );
  assert.equal(
    devTestGameHostedIdentityProgressionSummaryCommand,
    "test:dev-test-game-hosted-identity-progression-summary",
  );
  assert.equal(
    packageJson.scripts[devTestGameHostedIdentityProgressionSummaryCommand],
    "node tools/dev_test_game_hosted_identity_progression_summary.mjs",
  );
  assert.equal(
    devTestGameHostedIdentityProgressionSummaryPath,
    "target/dev-test-game/hosted-identity-progression-summary.json",
  );
  const operatorDocs = await readFile(
    "docs/ops/human-run-test-games.md",
    "utf8",
  );
  assert(
    operatorDocs.includes(
      `FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=${hostedIdentityEvidencePlaceholderFixturePath} npm run ${devTestGameHostedIdentityEvidenceCommand}`,
    ),
  );
  assert(
    operatorDocs.includes(
      `FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=${hostedIdentityEvidencePlaceholderFixturePath} npm run test:dev-test-game-hosted-identity-evidence-admin-proof`,
    ),
  );
  assert(
    operatorDocs.includes(
      "That placeholder keeps `releaseReady` and `productionReady` false.",
    ),
  );
  assert(
    operatorDocs.includes(
      `npm run ${devTestGameHostedIdentityProgressionSummaryCommand}`,
    ),
  );
  assert(
    operatorDocs.includes(
      `npm run ${devTestGameHostedIdentityCompleteAdminProofCommand}`,
    ),
  );
  assert(
    operatorDocs.includes(
      `npm run ${devTestGameHostedIdentityOperatorAdminProofCommand}`,
    ),
  );
  for (const progression of hostedIdentityEvidenceFamilyProgressionCases) {
    assert(
      operatorDocs.includes(
        `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=${progression.id} npm run ${devTestGameHostedIdentityProgressionAdminProofCommand}`,
      ),
      `operator docs should expose ${progression.id} hosted identity progression proof command`,
    );
  }
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assert.equal(
      packageJson.scripts[descriptor.proofCommand],
      `node ${descriptor.proofScript}`,
    );
  }
  assert.deepEqual(
    devTestGameOpsSpinePlan.map((step) => step.script),
    [
      "tools/dev_test_game_ops_artifacts.mjs",
      "tools/dev_test_game_ops_admin_proof.mjs",
      devTestGameReleaseReadinessScript,
    ],
  );
  assert.deepEqual(opsSpineReadinessEnv, {
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
    FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: devTestGameOpsAdminProofPath,
  });
  assert.deepEqual(devTestGameOpsSpinePlan[2], {
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    readinessReason: "ops-artifacts-and-admin-surface",
    changedInputs: [devTestGameOpsArtifactsPath, devTestGameOpsAdminProofPath],
    env: opsSpineReadinessEnv,
  });
  assert.deepEqual(
    devTestGameSeedFixtureSpinePlan.map((step) => step.script),
    [
      "tools/dev_test_game_seed_fixture_summary.mjs",
      "tools/dev_test_game_seed_admin_proof.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_next_action.mjs",
    ],
  );
  assert.deepEqual(seedFixtureSpineEnv, {
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      devTestGameSeedFixturePath,
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
  });
  assert.deepEqual(devTestGameSeedFixtureSpinePlan[2], {
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    readinessReason: "seed-fixture-and-admin-surface",
    changedInputs: [devTestGameSeedFixturePath, devTestGameSeedAdminProofPath],
    env: seedFixtureSpineEnv,
  });
  assert.deepEqual(
    devTestGameBackupRestoreSpinePlan.map((step) => step.script),
    [
      "tools/live_stack_backup_restore_drill.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_ops_artifacts.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_seed_fixture_summary.mjs",
      "tools/dev_test_game_seed_admin_proof.mjs",
      "tools/dev_test_game_backup_admin_proof.mjs",
      devTestGameReleaseReadinessScript,
    ],
  );
  assert.deepEqual(backupRestoreEvidenceEnv, {
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
      "target/live-stack-backup-restore-drill/local-live-stack.dump",
  });
  assert.deepEqual(backupAwareOpsEnv, {
    FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP:
      "target/live-stack-backup-restore-drill/local-live-stack.dump",
  });
  assert.deepEqual(opsReadinessEnv, {
    ...backupRestoreEvidenceEnv,
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  });
  assert.deepEqual(seedReadinessEnv, {
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
  });
  assert.deepEqual(backupRestoreFinalReadinessEnv, {
    ...backupRestoreEvidenceEnv,
    FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF: devTestGameBackupAdminProofPath,
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
  });
  assert.deepEqual(
    devTestGameIdentitySpinePlan.map((step) => step.script),
    [
      "tools/auth_invite_role_proof.mjs",
      "tools/dev_test_game_identity_admin_proof.mjs",
      "tools/dev_test_game_hosted_identity_evidence.mjs",
      "tools/dev_test_game_hosted_identity_progression_summary.mjs",
      devTestGameReleaseReadinessScript,
    ],
  );
  assert.deepEqual(
    devTestGameIdentityOperatorSpinePlan.map((step) => step.script),
    [
      "tools/auth_invite_role_proof.mjs",
      "tools/dev_test_game_identity_admin_proof.mjs",
      "tools/dev_test_game_hosted_identity_evidence.mjs",
      "tools/dev_test_game_hosted_identity_progression_summary.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_hosted_identity_operator_admin_proof.mjs",
      devTestGameReleaseReadinessScript,
    ],
  );
  assert.equal(
    devTestGameIdentityOperatorSpinePlan.at(-1).readinessReason,
    "identity-operator-hosted-evidence-predicate",
  );
  assert.deepEqual(identityReadinessEnv, {
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
      "target/auth-invite-role-proof/invite-role-proof.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
      devTestGameIdentityAdminProofPath,
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
      devTestGameHostedIdentityEvidencePath,
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY:
      devTestGameHostedIdentityProgressionSummaryPath,
  });
  assert.deepEqual(identityOperatorReadinessEnv, {
    ...identityReadinessEnv,
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF:
      devTestGameHostedIdentityOperatorAdminProofPath,
  });
  assert.deepEqual(adminSpineReadinessEvidenceEnv, {
    FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF:
      devTestGameCoreLoopAdminProofPath,
    FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF:
      devTestGameHardeningAdminProofPath,
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
      "target/live-stack-backup-restore-drill/local-live-stack.dump",
    FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF: devTestGameBackupAdminProofPath,
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
    FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: devTestGameOpsAdminProofPath,
    FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS: devTestGameHostedOpsSignalsPath,
    FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS_ADMIN_PROOF:
      devTestGameHostedOpsSignalsAdminProofPath,
    FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF:
      devTestGameRealHostedObservabilityHandoffPath,
    FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF:
      hostedAdminHandoffProofArtifactCase(
        "realHostedObservabilityHandoffAdminProof",
      ).path,
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
      "target/dev-test-game/seed-fixture-summary.json",
    FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
    FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK:
      "target/dev-test-game/release-runbook.json",
    FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF:
      devTestGameReleaseRunbookAdminProofPath,
    FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
      "target/auth-invite-role-proof/invite-role-proof.json",
    FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
      devTestGameIdentityAdminProofPath,
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
      "target/dev-test-game/hosted-identity-evidence.json",
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY:
      devTestGameHostedIdentityProgressionSummaryPath,
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF:
      hostedAdminHandoffProofArtifactCase("hostedIdentityEvidenceAdminProof").path,
    FMARCH_DEV_TEST_GAME_SPINE_MANIFEST: "target/dev-test-game/spine-manifest.json",
    FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF:
      devTestGameSpineManifestAdminProofPath,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF:
      "target/dev-test-game/admin-spine-proof.json",
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF:
      devTestGameAdminSpineAdminProofPath,
    FMARCH_DEV_TEST_GAME_RACE_COVERAGE: "target/dev-test-game/race-coverage.json",
    FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF:
      devTestGameRaceCoverageAdminProofPath,
    FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
      "target/dev-test-game/hosted-concurrent-race-matrix.json",
    FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF:
      hostedAdminHandoffProofArtifactCase(
        "hostedConcurrentRaceMatrixAdminProof",
      ).path,
    FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT:
      "target/dev-test-game/hosted-target-preflight.json",
    FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF:
      devTestGameHostedTargetPreflightAdminProofPath,
    FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE:
      "target/dev-test-game/hosted-evidence-lane.json",
    FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF:
      devTestGameHostedEvidenceLaneAdminProofPath,
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH: "target/dev-test-game/proof-graph.json",
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF:
      "target/dev-test-game/proof-graph-admin-proof.json",
    FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF:
      "target/dev-test-game/proof-freshness-admin-proof.json",
    FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF:
      "target/dev-test-game/next-action-admin-proof.json",
  });
  assert.deepEqual(adminSpineTerminalBatchReadinessEvidenceEnv, {
    ...adminSpineReadinessEvidenceEnv,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES:
      adminSpineTerminalBatchProofPath,
  });
  assert.deepEqual(adminSpineHostedOpsInputReadinessEnv, {
    FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
    FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
      devTestGameHostedConcurrentRaceMatrixPath,
  });
  const coreLoopRecoveryReceiptSelector = {
    provingNodeId: "admin-proof:core-loop",
  };
  const hardeningRecoveryReceiptSelector = {
    provingNodeId: "admin-proof:hardening",
  };
  const coreLoopRecoveryReceiptDescriptors =
    recoveryReceiptGraphDescriptors.filter(
      (descriptor) =>
        descriptor.provingNodeId ===
        coreLoopRecoveryReceiptSelector.provingNodeId,
    );
  const hardeningRecoveryReceiptDescriptors =
    recoveryReceiptGraphDescriptors.filter(
      (descriptor) =>
        descriptor.provingNodeId ===
        hardeningRecoveryReceiptSelector.provingNodeId,
    );
  assert.deepEqual(
    recoveryReceiptProofPlanSteps(coreLoopRecoveryReceiptSelector),
    coreLoopRecoveryReceiptDescriptors.map((descriptor) => ({
      kind: "node",
      script: descriptor.proofScript,
    })),
  );
  assert.deepEqual(
    recoveryReceiptProofPlanSteps(hardeningRecoveryReceiptSelector),
    hardeningRecoveryReceiptDescriptors.map((descriptor) => ({
      kind: "node",
      script: descriptor.proofScript,
    })),
  );
  assert.deepEqual(
    recoveryReceiptProofTargets(coreLoopRecoveryReceiptSelector),
    coreLoopRecoveryReceiptDescriptors.map((descriptor) => descriptor.proofTarget),
  );
  assert.deepEqual(
    recoveryReceiptProofTargets(hardeningRecoveryReceiptSelector),
    hardeningRecoveryReceiptDescriptors.map(
      (descriptor) => descriptor.proofTarget,
    ),
  );
  assert.deepEqual(devTestGameCoreLiveSpinePlan, [
    { kind: "npm", script: "dev:test-game:prebuild" },
    { kind: "node", script: "tools/dev_test_game_live_proof.mjs" },
    { kind: "node", script: "tools/dev_test_game_proof_contract.mjs" },
    { kind: "node", script: "tools/dev_test_game_core_loop_admin_proof.mjs" },
    ...recoveryReceiptProofPlanSteps(coreLoopRecoveryReceiptSelector),
    { kind: "node", script: "tools/dev_test_game_hardening_admin_proof.mjs" },
    ...recoveryReceiptProofPlanSteps(hardeningRecoveryReceiptSelector),
    {
      kind: "node",
      script: devTestGameReleaseReadinessScript,
      readinessReason: "core-live-gameplay-admin-surfaces",
      changedInputs: [
        "target/dev-test-game/proof-run.json",
        devTestGameCoreLoopAdminProofPath,
        ...recoveryReceiptProofTargets(coreLoopRecoveryReceiptSelector),
        devTestGameHardeningAdminProofPath,
        ...recoveryReceiptProofTargets(hardeningRecoveryReceiptSelector),
      ],
    },
  ]);
  assert.deepEqual(devTestGameLiveSpinePlan, [
    ...devTestGameCoreLiveSpinePlan,
    { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
    { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
    { kind: "custom", script: "backup-restore", label: "Backup/restore spine" },
    { kind: "custom", script: "identity", label: "Identity spine" },
    { kind: "custom", script: "admin", label: "Admin spine" },
  ]);
  assert.deepEqual(
    devTestGameAdminSpinePlan.map((step) => step.script),
    [
      "tools/dev_test_game_race_coverage.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_hosted_concurrent_race_matrix.mjs",
      "tools/dev_test_game_ops_artifacts.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_hosted_identity_evidence.mjs",
      "tools/dev_test_game_hosted_identity_progression_summary.mjs",
      "tools/dev_test_game_hosted_target_preflight.mjs",
      "tools/dev_test_game_hosted_evidence_lane.mjs",
      "tools/dev_test_game_hosted_evidence_lane_demo_proof.mjs",
      "tools/dev_test_game_hosted_ops_signals.mjs",
      "tools/dev_test_game_real_hosted_observability_handoff.mjs",
      "tools/dev_test_game_release_runbook.mjs",
      "admin-spine-proof",
      "tools/dev_test_game_admin_spine_admin_proof.mjs",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_spine_manifest.mjs",
      "tools/dev_test_game_next_action.mjs",
      "tools/dev_test_game_proof_graph.mjs",
      "terminal-admin-proof-batch",
      devTestGameReleaseReadinessScript,
      "tools/dev_test_game_next_action.mjs",
      "terminal-refresh-admin-proof-batch",
      "tools/dev_test_game_proof_graph.mjs",
      "tools/dev_test_game_proof_graph_admin_proof.mjs",
      "tools/dev_test_game_next_action.mjs",
      "tools/dev_test_game_next_action_admin_proof.mjs",
      "tools/dev_test_game_admin_spine_admin_proof.mjs",
      devTestGameReleaseReadinessScript,
    ],
  );
  assert.deepEqual(devTestGameAdminSpinePlan[13], {
    kind: "custom",
    script: "admin-spine-proof",
    label: "Admin spine proof",
  });
  assert.deepEqual(devTestGameAdminSpinePlan[19], {
    kind: "custom",
    script: "terminal-admin-proof-batch",
    label: "Terminal admin proof batch",
  });
  assert.deepEqual(devTestGameAdminSpinePlan[22], {
    kind: "custom",
    script: "terminal-refresh-admin-proof-batch",
    label: "Terminal refresh admin proof batch",
  });
  assert.deepEqual(devTestGameAdminSpinePlan[4], {
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    readinessReason: "hosted-matrix-and-ops-inputs-for-hosted-signals",
    changedInputs: [
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameOpsArtifactsPath,
    ],
    env: adminSpineHostedOpsInputReadinessEnv,
  });
  assertAdminAuditBatchPlan({
    plan: terminalAdminProofBatchPlan,
    label: "Terminal admin proof batch",
    caseSmokeNames: [
      "dev-test-game-proof-graph-admin-proof",
      "dev-test-game-proof-freshness-admin-proof",
      "dev-test-game-next-action-admin-proof",
    ],
  });
  assertAdminAuditBatchPlan({
    plan: terminalRefreshAdminProofBatchPlan,
    label: "Terminal refresh admin proof batch",
    caseSmokeNames: [
      "dev-test-game-proof-freshness-admin-proof",
      "dev-test-game-next-action-admin-proof",
    ],
  });
  const aggregateAdminProofBatchPlans = devTestGameAdminSpineProofBatchPlans();
  assert.deepEqual(
    aggregateAdminProofBatchPlans.map((batchPlan) => ({
      label: batchPlan.label,
      specIds: batchPlan.specs.map((spec) => spec.id),
    })),
    [
      {
        label: "Aggregate pre-release admin proof batch",
        specIds: [
          "core-loop",
          "hardening",
          "identity",
          "hosted-identity-evidence",
          "backup",
          "ops",
          "seed",
        ],
      },
      {
        label: "Aggregate release and hosted admin proof batch",
        specIds: [
          "release",
          "release-runbook",
          "race-coverage",
          "hosted-target-preflight",
          "hosted-evidence-lane",
          "hosted-concurrent-race-matrix",
          "hosted-ops-signals",
          "real-hosted-observability-handoff",
          "spine-manifest",
        ],
      },
    ],
  );
  for (const batchPlan of aggregateAdminProofBatchPlans) {
    assertAdminAuditBatchPlan({
      plan: batchPlan,
      label: batchPlan.label,
      caseSmokeNames: batchPlan.specs.map(
        (spec) => spec.caseFactory().smokeName,
      ),
    });
  }
  assert.equal(
    devTestGameAdminSpinePlan[15].env,
    adminSpinePreGraphReadinessEvidenceEnv,
  );
  for (const key of [
    "FMARCH_DEV_TEST_GAME_PROOF_GRAPH",
    "FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF",
    "FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF",
    "FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF",
  ]) {
    assert.equal(devTestGameAdminSpinePlan[15].env[key], undefined);
    assert.equal(Object.hasOwn(devTestGameAdminSpinePlan[15].env, key), false);
  }
  assert.equal(
    devTestGameAdminSpinePlan.at(-1).env,
    adminSpineTerminalBatchReadinessEvidenceEnv,
  );
  assertReleaseReadinessStepMetadata({
    ops: devTestGameOpsSpinePlan,
    seedFixture: devTestGameSeedFixtureSpinePlan,
    backupRestore: devTestGameBackupRestoreSpinePlan,
    identity: devTestGameIdentitySpinePlan,
    admin: devTestGameAdminSpinePlan,
    coreLive: devTestGameCoreLiveSpinePlan,
    live: devTestGameLiveSpinePlan,
  });
});

function assertAdminAuditBatchPlan({ plan, label, caseSmokeNames }) {
  assert.equal(plan.label, label);
  assert.equal(typeof plan.reason, "string");
  assert.notEqual(plan.reason.trim(), "");
  const resolved = resolveAdminAuditProofBatchPlan(plan);
  assert.deepEqual(
    resolved.cases.map((proofCase) => proofCase.smokeName),
    caseSmokeNames,
  );
  assert.deepEqual(
    new Set(Object.keys(resolved.envOverrides)).size,
    Object.keys(resolved.envOverrides).length,
  );
}

function assertReleaseReadinessStepMetadata(plansByName) {
  for (const [name, plan] of Object.entries(plansByName)) {
    const readinessSteps = releaseReadinessSteps(plan);
    assert.notEqual(
      readinessSteps.length,
      0,
      `${name} has no release-readiness steps`,
    );
    let previousChangedInputs = "";
    for (const step of readinessSteps) {
      assert.equal(step.script, devTestGameReleaseReadinessScript);
      assert.equal(typeof step.readinessReason, "string");
      assert.notEqual(step.readinessReason.trim(), "");
      assert.ok(Array.isArray(step.changedInputs));
      assert.notEqual(step.changedInputs.length, 0);
      assert.equal(
        new Set(step.changedInputs).size,
        step.changedInputs.length,
        `${name} readiness step ${step.readinessReason} repeats an input`,
      );
      const changedInputs = step.changedInputs.join("\0");
      assert.notEqual(
        changedInputs,
        previousChangedInputs,
        `${name} readiness step ${step.readinessReason} repeats the previous input set`,
      );
      previousChangedInputs = changedInputs;
    }
  }
}

const hostedIdentityEvidenceFamilyCheckIds = Object.freeze([
  "hosted-account-lifecycle-evidence",
  "invite-delivery-evidence",
  "account-recovery-evidence",
  "abuse-and-rate-limit-evidence",
  "session-secret-policy-evidence",
  "hosted-audit-retention-export-evidence",
]);

test("hosted identity evidence lane records blocked and passed handoffs", async () => {
  const blocked = await buildDevTestGameHostedIdentityEvidence({
    env: {},
    generatedAt: "2026-07-01T00:00:00.000Z",
  });
  assertDevTestGameHostedIdentityEvidence(blocked);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(
    blocked.hostedHandoffChecklist.inputIds,
    hostedIdentityEvidenceInputIds,
  );
  assert.deepEqual(
    blocked.hostedHandoffChecklist.operatorProofDrilldowns,
    hostedIdentityEvidenceOperatorProofDrilldowns,
  );
  assert.deepEqual(blocked.hostedHandoffChecklist.operatorProofDrilldowns[0], {
    id: "partial-operator-account-recovery-admin-proof",
    label: "Account recovery operator packet admin proof",
    command: `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=account-recovery npm run ${devTestGameHostedIdentityProgressionAdminProofCommand}`,
    progressionId: "account-recovery",
    sourcePath:
      "target/dev-test-game/hosted-identity-evidence-account-recovery.json",
    proofTarget:
      "target/dev-test-game/hosted-identity-evidence-account-recovery-admin-proof.json",
    roleUrl: "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
    firstMissingInputId: "redacted-account-recovery-packet",
    firstMissingCheckId: "account-recovery-evidence",
    proofBoundary:
      "Fixture-backed local admin browser proof for the account recovery operator hosted identity packet. It proves the admin handoff can surface redacted-account-recovery-packet as provided while the overall hosted identity evidence stays blocked; it does not prove hosted account recovery traffic, release readiness, or production readiness.",
  });
  assert.equal(
    blocked.hostedHandoffChecklist.blockedReceipt.firstMissingOperatorArtifact
      .inputId,
    "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
  );
  assert.equal(
    blocked.hostedHandoffChecklist.blockedReceipt.firstMissingOperatorArtifact
      .roleSurfaceDrilldown.proofGraphEvidencePath,
    "target/dev-test-game/proof-graph.json",
  );
  assert(
    blocked.hostedHandoffChecklist.blockedCheckIds.includes(
      "hosted-identity-evidence-path-configured",
    ),
  );
  assert.deepEqual(
    blocked.hostedHandoffChecklist.requirementGroups.find(
      (group) => group.id === "hosted-identity-evidence-intake",
    )?.blockedCheckIds,
    [
      "hosted-identity-evidence-path-configured",
      "hosted-identity-evidence-readable",
    ],
  );
  assert.deepEqual(
    {
      status: blocked.target.redactedIntakePacket.status,
      sectionCount: blocked.target.redactedIntakePacket.sectionCount,
      providedSectionCount:
        blocked.target.redactedIntakePacket.providedSectionCount,
      missingSectionCount: blocked.target.redactedIntakePacket.missingSectionCount,
      requiredInputCount: blocked.target.redactedIntakePacket.requiredInputCount,
      providedInputCount: blocked.target.redactedIntakePacket.providedInputCount,
      missingInputCount: blocked.target.redactedIntakePacket.missingInputCount,
      redactedEvidenceRefCount:
        blocked.target.redactedIntakePacket.redactedEvidenceRefCount,
    },
    {
      status: "missing",
      sectionCount: 6,
      providedSectionCount: 0,
      missingSectionCount: 6,
      requiredInputCount: 16,
      providedInputCount: 0,
      missingInputCount: 16,
      redactedEvidenceRefCount: 0,
    },
  );
  assert.deepEqual(
    blocked.target.redactedIntakePacket.sections.map((section) => [
      section.id,
      section.status,
      section.requiredInputIds,
      section.providedInputIds,
      section.redactedEvidenceRefCount,
      section.missingInputs,
    ]),
    hostedIdentityEvidencePacketSectionDefinitions.map((section) => [
      section.field,
      "missing",
      [...section.requiredInputIds],
      [],
      0,
      [
        "section-object",
        "status-provided",
        ...section.requiredInputIds,
        "redactedEvidenceRefs",
        ...(section.field === "inviteDelivery" ? ["rawInviteTokensIncluded"] : []),
        ...(section.field === "sessionSecretPolicy"
          ? ["rawSessionSecretsIncluded"]
          : []),
      ],
    ]),
  );

  assert.equal(hostedIdentityEvidencePlaceholderSchema.properties.version.const, 1);
  const malformedPath =
    "target/dev-test-game/hosted-identity-evidence-malformed.test.json";
  await mkdir("target/dev-test-game", { recursive: true });
  await writeFile(
    malformedPath,
    `${JSON.stringify({
      version: 1,
      proof: "hosted-production-identity-evidence",
      releaseReady: false,
      productionReady: false,
      hostedIdentity: {
        accountLifecycle: false,
      },
    })}\n`,
  );
  const malformed = await buildDevTestGameHostedIdentityEvidence({
    env: { FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH: malformedPath },
    generatedAt: "2026-07-01T00:00:00.500Z",
  });
  assertDevTestGameHostedIdentityEvidence(malformed);
  assert.equal(malformed.status, "blocked");
  assert.deepEqual(
    malformed.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-identity-evidence-path-configured", "passed"],
      ["hosted-identity-evidence-readable", "blocked"],
      ["hosted-account-lifecycle-evidence", "blocked"],
      ["invite-delivery-evidence", "blocked"],
      ["account-recovery-evidence", "blocked"],
      ["abuse-and-rate-limit-evidence", "blocked"],
      ["session-secret-policy-evidence", "blocked"],
      ["hosted-audit-retention-export-evidence", "blocked"],
      ["role-surface-adapter-preserved", "blocked"],
      ["identity-adapter-contract-compatible", "blocked"],
      ["release-claim-boundary-carried", "passed"],
    ],
  );
  assert.match(
    malformed.checks.find(
      (check) => check.id === "hosted-identity-evidence-readable",
    )?.requiredEvidence ?? "",
    /matching tools\/fixtures\/dev_test_game_hosted_identity_evidence\.placeholder\.json/,
  );

  const placeholderSource = JSON.parse(
    await readFile(hostedIdentityEvidencePlaceholderFixturePath, "utf8"),
  );
  assert.deepEqual(validateHostedIdentityEvidencePlaceholder(placeholderSource), []);
  const redactedPassSource = JSON.parse(
    await readFile(hostedIdentityEvidenceRedactedPassFixturePath, "utf8"),
  );
  assert.deepEqual(validateHostedIdentityEvidencePlaceholder(redactedPassSource), []);
  const placeholder = await buildDevTestGameHostedIdentityEvidence({
    env: {
      FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
        hostedIdentityEvidencePlaceholderFixturePath,
    },
    generatedAt: "2026-07-01T00:00:00.750Z",
  });
  assertDevTestGameHostedIdentityEvidence(placeholder);
  assert.equal(placeholder.status, "blocked");
  assert.equal(placeholder.target.roleSurfaceContractDiff.status, "passed");
  assert.equal(
    placeholder.target.identityAdapterContractComparison.status,
    "passed",
  );
  assert.deepEqual(
    placeholder.hostedHandoffChecklist.requirementGroups.find(
      (group) => group.id === "hosted-identity-evidence-intake",
    )?.blockedCheckIds,
    [],
  );
  assert.deepEqual(
    placeholder.hostedHandoffChecklist.blockedCheckIds.filter((id) =>
      id.includes("identity-evidence"),
    ),
    [],
  );

  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorPartialFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAccountLifecyclePartialFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAccountLifecycleRecoveredFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAccountRecoveryRecoveredFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAbuseRateLimitPartialFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAbuseRateLimitRecoveredFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorSessionSecretPartialFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorSessionSecretRecoveredFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAuditRetentionPartialFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorAuditRetentionRecoveredFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorInvitePartialFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorInviteRecoveredFixturePath,
  ));
  assert(hostedIdentityEvidenceFixturePaths.includes(
    hostedIdentityEvidenceOperatorRecoveredFixturePath,
  ));
  for (const fixturePath of hostedIdentityEvidenceFixturePaths) {
    assert.equal(hostedIdentityEvidencePathKind(fixturePath), "fixture");
  }
  for (const fixturePath of [
    ...new Set(
      hostedIdentityEvidenceFamilyProgressionCases.flatMap((progression) => [
        progression.missingFixturePath,
        progression.recoveredFixturePath,
      ]),
    ),
  ]) {
    const source = JSON.parse(await readFile(fixturePath, "utf8"));
    assert.deepEqual(validateHostedIdentityEvidencePlaceholder(source), []);
  }
  const operatorEvidenceByFixturePath = new Map();
  for (const [index, fixturePath] of [
    ...new Set(
      hostedIdentityEvidenceFamilyProgressionCases.flatMap((progression) => [
        progression.missingFixturePath,
        progression.recoveredFixturePath,
      ]),
    ),
  ].entries()) {
    const evidence = await buildDevTestGameHostedIdentityEvidence({
      env: {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH: fixturePath,
      },
      generatedAt: `2026-07-01T00:00:00.${875 + index}Z`,
    });
    assertDevTestGameHostedIdentityEvidence(evidence);
    operatorEvidenceByFixturePath.set(fixturePath, evidence);
  }
  for (const progression of hostedIdentityEvidenceFamilyProgressionCases) {
    const operatorMissing = operatorEvidenceByFixturePath.get(
      progression.missingFixturePath,
    );
    const operatorRecovered = operatorEvidenceByFixturePath.get(
      progression.recoveredFixturePath,
    );
    assert.equal(operatorMissing.status, "blocked");
    assert.equal(operatorMissing.target.rawEvidenceStatus, "passed");
    assert.equal(operatorMissing.target.roleSurfaceContractDiff.status, "passed");
    assert.equal(
      operatorMissing.target.identityAdapterContractComparison.status,
      "passed",
    );
    assert.deepEqual(operatorMissing.hostedHandoffChecklist.blockedCheckIds, [
      progression.checkId,
    ]);
    assert.equal(
      operatorMissing.hostedHandoffChecklist.blockedReceipt
        .firstMissingOperatorArtifact.inputId,
      progression.missingInputId,
    );
    assert.equal(
      operatorMissing.hostedHandoffChecklist.blockedReceipt
        .firstMissingOperatorArtifact.checkId,
      progression.checkId,
    );
    assert.equal(
      operatorMissing.hostedHandoffChecklist.blockedReceipt
        .firstMissingOperatorArtifact.roleSurfaceDrilldown
        .proofGraphEvidencePath,
      "target/dev-test-game/proof-graph.json",
    );
    assert.deepEqual(
      operatorMissing.target.redactedIntakePacket.sections
        .filter((section) => section.status !== "provided")
        .map((section) => [section.id, section.missingInputs]),
      [[progression.field, [...progression.expectedMissingInputs]]],
    );
    assert.equal(
      operatorRecovered.status,
      progression.adminProofMode === "provided-family-still-blocked"
        ? "blocked"
        : "passed",
    );
    assert.equal(operatorRecovered.target.rawEvidenceStatus, "passed");
    if (progression.adminProofMode === "provided-family-still-blocked") {
      assert.deepEqual(
        operatorRecovered.hostedHandoffChecklist.blockedCheckIds,
        hostedIdentityEvidenceFamilyCheckIds.filter(
          (checkId) => checkId !== progression.checkId,
        ),
      );
      assert.notEqual(
        operatorRecovered.hostedHandoffChecklist.blockedReceipt,
        undefined,
      );
    } else {
      assert.deepEqual(operatorRecovered.hostedHandoffChecklist.blockedCheckIds, []);
      assert.equal(
        operatorRecovered.hostedHandoffChecklist.blockedReceipt,
        undefined,
      );
    }
    assert.deepEqual(
      operatorRecovered.target.redactedIntakePacket.sections
        .filter((section) => section.id === progression.field)
        .map((section) => [
          section.status,
          section.providedInputIds,
          section.missingInputs,
          section.redactedEvidenceRefs.map((ref) => ref.id),
        ]),
      [
        [
          "provided",
          [...progression.recoveredProvidedInputIds],
          [],
          [...progression.recoveredRedactedEvidenceRefIds],
        ],
      ],
    );
    assert.deepEqual(
      operatorMissing.checks
        .filter(
          (partialCheck) =>
            partialCheck.status !==
            operatorRecovered.checks.find(
              (recoveredCheck) => recoveredCheck.id === partialCheck.id,
            )?.status,
        )
        .map((check) => check.id),
      progression.adminProofMode === "provided-family-still-blocked"
        ? hostedIdentityEvidenceFamilyCheckIds
        : [progression.checkId],
    );
  }

  const progressionSummary =
    buildDevTestGameHostedIdentityProgressionSummary({
      generatedAt: "2026-07-01T00:00:00.950Z",
    });
  assertDevTestGameHostedIdentityProgressionSummary(progressionSummary);
  assert.equal(progressionSummary.releaseReady, false);
  assert.equal(progressionSummary.productionReady, false);
  assert.equal(
    progressionSummary.nextCommand,
    `npm run ${devTestGameHostedIdentityProgressionSummaryCommand}`,
  );
  assert.equal(
    progressionSummary.nextProofTarget,
    devTestGameHostedIdentityProgressionSummaryPath,
  );
  assert.deepEqual(
    progressionSummary.progressions.map((progression) => ({
      id: progression.id,
      missingFixturePath: progression.missingFixturePath,
      recoveredFixturePath: progression.recoveredFixturePath,
      adminProofMode: progression.adminProofMode,
      adminProofFixturePath: progression.adminProofFixturePath,
      proofCommand: progression.proofCommand,
      evidencePath: progression.evidencePath,
      adminProofTarget: progression.adminProofTarget,
      roleUrl: progression.roleUrl,
      firstMissingInputId: progression.firstMissingInputId,
      firstMissingCheckId: progression.firstMissingCheckId,
    })),
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => ({
      id: progression.id,
      missingFixturePath: progression.missingFixturePath,
      recoveredFixturePath: progression.recoveredFixturePath,
      adminProofMode: progression.adminProofMode,
      adminProofFixturePath: progression.adminProofFixturePath,
      proofCommand: `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=${progression.id} npm run ${devTestGameHostedIdentityProgressionAdminProofCommand}`,
      evidencePath: hostedIdentityEvidenceProgressionPath(progression.id),
      adminProofTarget: hostedIdentityEvidenceProgressionAdminProofPath(
        progression.id,
      ),
      roleUrl: "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      firstMissingInputId: progression.missingInputId,
      firstMissingCheckId: progression.checkId,
    })),
  );

  const rawPath = "target/dev-test-game/hosted-identity-evidence-raw.test.json";
  await writeFile(
    rawPath,
    `${JSON.stringify(redactedPassSource)}\n`,
  );
  const passed = await buildDevTestGameHostedIdentityEvidence({
    env: { FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH: rawPath },
    generatedAt: "2026-07-01T00:00:01.000Z",
  });
  assertDevTestGameHostedIdentityEvidence(passed);
  assert.equal(passed.status, "passed");
  assert.deepEqual(
    passed.target.expectedRoleSurfaceContract,
    hostedIdentityExpectedRoleSurfaceContract,
  );
  assert.equal(passed.target.roleSurfaceContractDiff.status, "passed");
  assert.deepEqual(passed.target.roleSurfaceContractDiff.mismatches, []);
  assert.deepEqual(
    {
      status: passed.target.identityAdapterContractComparison.status,
      localAdapterId: passed.target.identityAdapterContractComparison.localAdapterId,
      hostedAdapterId:
        passed.target.identityAdapterContractComparison.hostedAdapterId,
      mismatches: passed.target.identityAdapterContractComparison.mismatches,
    },
    {
      status: "passed",
      localAdapterId: "local-production-identity-adapter-v1",
      hostedAdapterId: "local-production-identity-adapter-v1",
      mismatches: [],
    },
  );
  assert.equal(passed.hostedHandoffChecklist.status, "passed");
  assert.deepEqual(passed.hostedHandoffChecklist.blockedCheckIds, []);
  assert.deepEqual(
    {
      status: passed.target.redactedIntakePacket.status,
      sectionCount: passed.target.redactedIntakePacket.sectionCount,
      providedSectionCount: passed.target.redactedIntakePacket.providedSectionCount,
      missingSectionCount: passed.target.redactedIntakePacket.missingSectionCount,
      requiredInputCount: passed.target.redactedIntakePacket.requiredInputCount,
      providedInputCount: passed.target.redactedIntakePacket.providedInputCount,
      missingInputCount: passed.target.redactedIntakePacket.missingInputCount,
      redactedEvidenceRefCount:
        passed.target.redactedIntakePacket.redactedEvidenceRefCount,
    },
    {
      status: "provided",
      sectionCount: 6,
      providedSectionCount: 6,
      missingSectionCount: 0,
      requiredInputCount: 16,
      providedInputCount: 16,
      missingInputCount: 0,
      redactedEvidenceRefCount: 6,
    },
  );
  assert.deepEqual(
    passed.target.redactedIntakePacket.sections.map((section) => [
      section.id,
      section.status,
      section.requiredInputIds,
      section.providedInputIds,
      section.redactedEvidenceRefCount,
      section.missingInputs,
      section.redactedEvidenceRefs.map((ref) => [
        ref.evidenceFamily,
        ref.capturedAt,
        ref.retentionWindow,
        ref.exportLocator,
      ]),
    ]),
    [
      [
        "accountLifecycle",
        "provided",
        ["createAccount", "login", "disableAccount", "enableAccount"],
        ["createAccount", "login", "disableAccount", "enableAccount"],
        1,
        [],
        [
          [
            "account-lifecycle",
            "2026-07-01T00:00:00.000Z",
            "90d",
            "s3://redacted/fmarch/identity/account-lifecycle.json",
          ],
        ],
      ],
      [
        "inviteDelivery",
        "provided",
        ["deliveryChannels", "revocationCovered"],
        ["deliveryChannels", "revocationCovered"],
        1,
        [],
        [
          [
            "invite-delivery",
            "2026-07-01T00:00:00.000Z",
            "90d",
            "s3://redacted/fmarch/identity/invites.json",
          ],
        ],
      ],
      [
        "accountRecovery",
        "provided",
        ["recoveryMethods", "recoveredSessionsPreserveRoleSurfaceAdapter"],
        ["recoveryMethods", "recoveredSessionsPreserveRoleSurfaceAdapter"],
        1,
        [],
        [
          [
            "account-recovery",
            "2026-07-01T00:00:00.000Z",
            "90d",
            "s3://redacted/fmarch/identity/recovery.json",
          ],
        ],
      ],
      [
        "abuseAndRateLimitPolicy",
        "provided",
        ["protectedOperations", "rateLimitPolicyRef"],
        ["protectedOperations", "rateLimitPolicyRef"],
        1,
        [],
        [
          [
            "abuse-rate-limit",
            "2026-07-01T00:00:00.000Z",
            "90d",
            "s3://redacted/fmarch/identity/abuse-rate-limit.json",
          ],
        ],
      ],
      [
        "sessionSecretPolicy",
        "provided",
        ["storage", "rotation", "deploymentSecretSource"],
        ["storage", "rotation", "deploymentSecretSource"],
        1,
        [],
        [
          [
            "session-secret-policy",
            "2026-07-01T00:00:00.000Z",
            "90d",
            "s3://redacted/fmarch/identity/session-secret.json",
          ],
        ],
      ],
      [
        "hostedAuditRetentionExport",
        "provided",
        ["eventFamilies", "retentionWindow", "exportRef"],
        ["eventFamilies", "retentionWindow", "exportRef"],
        1,
        [],
        [
          [
            "audit-retention-export",
            "2026-07-01T00:00:00.000Z",
            "90d",
            "s3://redacted/fmarch/identity/audit-retention.json",
          ],
        ],
      ],
    ],
  );

  const changedRoleSurfaceSource = JSON.parse(JSON.stringify(redactedPassSource));
  changedRoleSurfaceSource.hostedIdentity.roleSurfaceArchitectureChanged = true;
  changedRoleSurfaceSource.hostedIdentity.roleSurfaceContract.roleUrlPatterns = [
    ...changedRoleSurfaceSource.hostedIdentity.roleSurfaceContract.roleUrlPatterns,
    { id: "invite-token-url", href: "/invite/:token" },
  ];
  const changedRoleSurfacePath =
    "target/dev-test-game/hosted-identity-role-surface-changed.test.json";
  await writeFile(
    changedRoleSurfacePath,
    `${JSON.stringify(changedRoleSurfaceSource)}\n`,
  );
  const changedRoleSurface = await buildDevTestGameHostedIdentityEvidence({
    env: { FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH: changedRoleSurfacePath },
    generatedAt: "2026-07-01T00:00:01.500Z",
  });
  assertDevTestGameHostedIdentityEvidence(changedRoleSurface);
  assert.equal(changedRoleSurface.status, "blocked");
  assert.equal(
    changedRoleSurface.checks.find(
      (check) => check.id === "role-surface-adapter-preserved",
    )?.status,
    "blocked",
  );
  assert.deepEqual(
    changedRoleSurface.target.roleSurfaceContractDiff.mismatches.map(
      (mismatch) => mismatch.path,
    ),
    [
      "hostedIdentity.roleSurfaceArchitectureChanged",
      "hostedIdentity.roleSurfaceContract.roleUrlPatterns.length",
    ],
  );

  const changedAdapterContractSource = JSON.parse(JSON.stringify(redactedPassSource));
  changedAdapterContractSource.hostedIdentity.identityAdapterContract.roleSurfaceArchitectureChanged =
    true;
  changedAdapterContractSource.hostedIdentity.identityAdapterContract.roleSurfaceContract.roleUrlPatterns =
    [
      ...changedAdapterContractSource.hostedIdentity.identityAdapterContract
        .roleSurfaceContract.roleUrlPatterns,
      { id: "account-url", href: "/accounts/:accountId" },
    ];
  const changedAdapterContractPath =
    "target/dev-test-game/hosted-identity-adapter-contract-changed.test.json";
  await writeFile(
    changedAdapterContractPath,
    `${JSON.stringify(changedAdapterContractSource)}\n`,
  );
  const changedAdapterContract = await buildDevTestGameHostedIdentityEvidence({
    env: { FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH: changedAdapterContractPath },
    generatedAt: "2026-07-01T00:00:02.000Z",
  });
  assertDevTestGameHostedIdentityEvidence(changedAdapterContract);
  assert.equal(changedAdapterContract.status, "blocked");
  assert.equal(
    changedAdapterContract.checks.find(
      (check) => check.id === "identity-adapter-contract-compatible",
    )?.status,
    "blocked",
  );
  assert.deepEqual(
    changedAdapterContract.target.identityAdapterContractComparison.mismatches.map(
      (mismatch) => mismatch.path,
    ),
    [
      "identityAdapterContract.roleSurfaceArchitectureChanged",
      "identityAdapterContract.roleSurfaceContract.roleUrlPatterns.length",
      "hostedIdentity.roleSurfaceArchitectureChanged",
      "hostedIdentity.roleSurfaceContract.roleUrlPatterns.length",
    ],
  );
});

test("dev test-game spine manifest records command order and evidence wiring", () => {
  const manifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "core-loop",
          label: "Core loop admin proof",
          path: devTestGameCoreLoopAdminProofPath,
          status: "stale",
          mtime: "2026-06-25T00:00:00.000Z",
          ageSeconds: 90000,
          maxAgeSeconds: 86400,
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
    adminSpineProof: {
      recovery: {
        surfaces: [
          {
            id: "core-loop",
            path: devTestGameCoreLoopAdminProofPath,
            rerunCommand: "npm run test:dev-test-game-core-loop-admin-proof",
          },
        ],
      },
    },
  });
  assertDevTestGameSpineManifest(manifest);
  assert.equal(manifest.status, "passed");
  assert.equal(manifest.releaseReady, false);
  assert.equal(manifest.productionReady, false);
  assert.deepEqual(manifest.commands.coreLive.plan, devTestGameCoreLiveSpinePlan);
  assert.equal(manifest.commands.coreLive.script, "test:dev-test-game-core-live");
  assert.equal(manifest.commands.live.script, "test:dev-test-game-live");
  assert.deepEqual(manifest.commands.live.plan, devTestGameLiveSpinePlan);
  assert.deepEqual(
    manifest.commands.backupRestore.plan,
    devTestGameBackupRestoreSpinePlan,
  );
  assert.deepEqual(manifest.commands.identity.plan, devTestGameIdentitySpinePlan);
  assert.equal(
    manifest.commands.identityOperator.script,
    "test:dev-test-game-identity:operator",
  );
  assert.deepEqual(
    manifest.commands.identityOperator.plan,
    devTestGameIdentityOperatorSpinePlan,
  );
  assert.deepEqual(
    manifest.commands.adminSpine.plan,
    devTestGameAdminSpineProofPlan.map(({ id, label, script, path }) => ({
      id,
      label,
      script,
      path,
    })),
  );
  assert.deepEqual(
    devTestGameAdminSpineProofPlan.map(({ id, caseFactory }) => [
      id,
      typeof caseFactory,
    ]),
    devTestGameAdminSpineProofPlan.map(({ id }) => [id, "function"]),
  );
  assert.deepEqual(
    manifest.commands.adminSpine.readinessEnv,
    adminSpineTerminalBatchReadinessEvidenceEnv,
  );
  assert.equal(
    manifest.commands.adminSpine.terminalBatchProofArtifact,
    adminSpineTerminalBatchProofPath,
  );
  assert.deepEqual(manifest.commands.proofFreshness, {
    script: proofFreshnessAdminProofCommand,
    proofArtifact: proofFreshnessAdminProofPath,
    dependsOn: [
      devTestGameRaceCoveragePath,
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/admin-spine-proof.json",
      devTestGameReleaseReadinessPath,
    ],
  });
  assert.deepEqual(manifest.commands.raceCoverage, {
    script: devTestGameRaceCoverageCommand,
    proofArtifact: devTestGameRaceCoveragePath,
    dependsOn: ["target/dev-test-game/proof-run.json"],
  });
  assert.deepEqual(manifest.commands.ops, {
    script: "test:dev-test-game-ops",
    plan: devTestGameOpsSpinePlan,
  });
  assert.deepEqual(manifest.commands.seedFixture, {
    script: "test:dev-test-game-seed-fixture",
    plan: devTestGameSeedFixtureSpinePlan,
  });
  assert.deepEqual(manifest.commands.hostedConcurrentRaceMatrix, {
    script: devTestGameHostedConcurrentRaceMatrixCommand,
    proofArtifact: devTestGameHostedConcurrentRaceMatrixPath,
    dependsOn: [
      devTestGameReleaseReadinessPath,
      devTestGameRaceCoveragePath,
    ],
  });
  assert.deepEqual(manifest.commands.hostedIdentityEvidence, {
    script: devTestGameHostedIdentityEvidenceCommand,
    proofArtifact: devTestGameHostedIdentityEvidencePath,
    dependsOn: [
      "target/auth-invite-role-proof/invite-role-proof.json",
      devTestGameIdentityAdminProofPath,
    ],
    roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
  });
  const hostedIdentityEvidenceAdminProofArtifact =
    hostedAdminHandoffProofArtifactCase("hostedIdentityEvidenceAdminProof");
  assert.deepEqual(manifest.commands.hostedIdentityEvidenceAdminProof, {
    script: hostedIdentityEvidenceAdminProofArtifact.script,
    proofArtifact: hostedIdentityEvidenceAdminProofArtifact.path,
    dependsOn: [
      devTestGameHostedIdentityEvidencePath,
      "target/dev-test-game/proof-run.json",
    ],
    roleUrl: hostedIdentityEvidenceAdminProofArtifact.roleUrl,
  });
  assert.deepEqual(manifest.commands.hostedOpsSignals, {
    script: devTestGameHostedOpsSignalsCommand,
    proofArtifact: devTestGameHostedOpsSignalsPath,
    dependsOn: [
      devTestGameOpsArtifactsPath,
      devTestGameReleaseReadinessPath,
      devTestGameHostedConcurrentRaceMatrixPath,
    ],
  });
  assert.deepEqual(manifest.commands.realHostedObservabilityHandoff, {
    script: devTestGameRealHostedObservabilityHandoffCommand,
    proofArtifact: devTestGameRealHostedObservabilityHandoffPath,
    dependsOn: [devTestGameHostedOpsSignalsPath],
    roleUrl:
      "/admin/audit/local-real-hosted-observability-handoff?game=<seeded-game>",
  });
  const realHostedObservabilityHandoffAdminProofArtifact =
    hostedAdminHandoffProofArtifactCase(
      "realHostedObservabilityHandoffAdminProof",
    );
  assert.deepEqual(manifest.commands.realHostedObservabilityHandoffAdminProof, {
    script: realHostedObservabilityHandoffAdminProofArtifact.script,
    proofArtifact: realHostedObservabilityHandoffAdminProofArtifact.path,
    dependsOn: [devTestGameRealHostedObservabilityHandoffPath],
    roleUrl: realHostedObservabilityHandoffAdminProofArtifact.roleUrl,
  });
  assert.deepEqual(manifest.commands.hostedTargetPreflight, {
    script: devTestGameHostedTargetPreflightCommand,
    proofArtifact: devTestGameHostedTargetPreflightPath,
    dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
    roleUrl: "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.hostedEvidenceLane, {
    script: devTestGameHostedEvidenceLaneCommand,
    proofArtifact: devTestGameHostedEvidenceLanePath,
    dependsOn: [
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedTargetPreflightPath,
    ],
    roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.hostedEvidenceLaneDemoProof, {
    script: devTestGameHostedEvidenceLaneDemoProofCommand,
    proofArtifact: devTestGameHostedEvidenceLaneDemoProofPath,
    dependsOn: [devTestGameHostedConcurrentRaceMatrixPath],
    demoOnly: true,
    roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  });
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assert.deepEqual(manifest.commands[descriptor.receiptKey], {
      script: descriptor.proofCommand,
      proofArtifact: descriptor.proofTarget,
      dependsOn: [...descriptor.manifestDependsOn],
      roleUrl: descriptor.roleUrl,
    });
  }
  assert.deepEqual(manifest.commands.releaseRunbook, {
    script: devTestGameReleaseRunbookCommand,
    proofArtifact: devTestGameReleaseRunbookPath,
    dependsOn: [devTestGameReleaseReadinessPath],
    roleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.nextAction, {
    script: nextActionCommand,
    proofArtifact: nextActionPath,
    dependsOn: [
      "target/dev-test-game/spine-manifest.json",
      devTestGameOpsArtifactsPath,
      devTestGameReleaseReadinessPath,
      devTestGameRaceCoveragePath,
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedTargetPreflightPath,
      devTestGameHostedEvidenceLanePath,
      devTestGameHostedEvidenceLaneDemoProofPath,
    ],
  });
  assert.deepEqual(manifest.commands.nextActionAdminProof, {
    script: nextActionAdminProofCommand,
    proofArtifact: nextActionAdminProofPath,
    dependsOn: [
      "target/dev-test-game/next-action.json",
      "target/dev-test-game/proof-run.json",
      devTestGameProofGraphPath,
    ],
    roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
  });
  assert.deepEqual(manifest.commands.proofGraph, {
    script: devTestGameProofGraphCommand,
    proofArtifact: devTestGameProofGraphPath,
    dependsOn: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/admin-spine-proof.json",
    ],
  });
  assert.deepEqual(manifest.commands.proofGraphAdminProof, {
    script: devTestGameProofGraphAdminProofCommand,
    proofArtifact: devTestGameProofGraphAdminProofPath,
    dependsOn: [
      "target/dev-test-game/proof-graph.json",
      "target/dev-test-game/admin-spine-proof.json",
      "target/dev-test-game/proof-run.json",
    ],
    roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
  });
  assert.deepEqual(
    manifest.terminalArtifacts.map((artifact) => ({
      id: artifact.id,
      command: artifact.command,
      path: artifact.path,
      roleUrl: artifact.roleUrl,
    })),
    [
      {
        id: "next-action",
        command: nextActionCommand,
        path: nextActionPath,
        roleUrl: undefined,
      },
      {
        id: "next-action-admin-proof",
        command: nextActionAdminProofCommand,
        path: nextActionAdminProofPath,
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      },
      {
        id: "proof-graph",
        command: devTestGameProofGraphCommand,
        path: devTestGameProofGraphPath,
        roleUrl: undefined,
      },
      {
        id: "proof-graph-admin-proof",
        command: devTestGameProofGraphAdminProofCommand,
        path: devTestGameProofGraphAdminProofPath,
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      },
    ],
  );
  assert.equal(manifest.artifactFreshness.status, "blocked");
  assert.equal(
    manifest.artifactFreshness.nextCommand,
    "npm run test:dev-test-game-core-loop-admin-proof",
  );
  assert.deepEqual(
    manifest.artifactFreshness.artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      refreshCommand: artifact.refreshCommand,
      refreshSource: artifact.refreshSource,
      nextCommand: artifact.nextCommand,
    })),
    [
      {
        id: "core-loop",
        status: "stale",
        refreshCommand: "npm run test:dev-test-game-core-loop-admin-proof",
        refreshSource: "admin-spine-recovery",
        nextCommand: "npm run test:dev-test-game-core-loop-admin-proof",
      },
      {
        id: "spine-manifest",
        status: "fresh",
        refreshCommand: "npm run test:dev-test-game-spine-manifest",
        refreshSource: "manifest-default",
        nextCommand: undefined,
      },
    ],
  );
  assert.deepEqual(manifest.evidenceEnv.identity.identityReadinessEnv, identityReadinessEnv);
  assert.deepEqual(manifest.evidenceEnv.ops.opsSpineReadinessEnv, opsSpineReadinessEnv);
  assert.deepEqual(
    manifest.evidenceEnv.seedFixture.seedFixtureSpineEnv,
    seedFixtureSpineEnv,
  );
  assert(manifest.artifacts.includes("target/dev-test-game/spine-manifest.json"));
  assert(manifest.artifacts.includes("target/dev-test-game/spine-manifest.md"));
  assert(manifest.artifacts.includes("target/dev-test-game/admin-spine-proof.json"));
  assert(manifest.artifacts.includes(proofFreshnessAdminProofPath));
  assert(manifest.artifacts.includes(devTestGameRaceCoveragePath));
  assert(manifest.artifacts.includes(devTestGameHostedConcurrentRaceMatrixPath));
  assert(manifest.artifacts.includes(devTestGameHostedIdentityEvidencePath));
  for (const artifactCase of hostedAdminHandoffProofArtifactCases) {
    assert(manifest.artifacts.includes(artifactCase.path));
  }
  assert(manifest.artifacts.includes(devTestGameHostedOpsSignalsPath));
  assert(manifest.artifacts.includes(devTestGameHostedTargetPreflightPath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLanePath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoProofPath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoRawEvidencePath));
  assert(
    manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoExternalEvidencePath),
  );
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoBlockedPath));
  assert(manifest.artifacts.includes(devTestGameHostedEvidenceLaneDemoPassedPath));
  assert(manifest.artifacts.includes(devTestGameReleaseRunbookPath));
  assert(manifest.artifacts.includes(nextActionPath));
  assert(manifest.artifacts.includes(nextActionAdminProofPath));
  assert(manifest.artifacts.includes(devTestGameProofGraphPath));
  assert(manifest.artifacts.includes(devTestGameProofGraphAdminProofPath));
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assert(manifest.artifacts.includes(descriptor.proofTarget));
  }
  assert(manifest.artifacts.includes(devTestGameReleaseAdminProofPath));
  assert(
    manifest.artifacts.includes(
      devTestGameSpineManifestAdminProofPath,
    ),
  );
  assert(
    manifest.artifacts.includes(devTestGameAdminSpineAdminProofPath),
  );
  assert(
    manifest.artifacts.includes(
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    ),
  );
});

test("dev test-game spine manifest blocks freshness on proof-run session drift", () => {
  const manifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofRunContract: {
      status: "failed",
      proofPath: "target/dev-test-game/proof-run.json",
      sessionPath: "target/dev-test-game/session.json",
      reason: "proof-run-session-mismatch",
      message:
        "target/dev-test-game/proof-run.json is stale or does not match target/dev-test-game/session.json",
    },
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });
  assertDevTestGameSpineManifest(manifest);
  assert.equal(manifest.artifactFreshness.status, "blocked");
  assert.equal(
    manifest.artifactFreshness.nextCommand,
    "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
  );
  assert.deepEqual(manifest.artifactFreshness.proofRunContract, {
    status: "failed",
    proofPath: "target/dev-test-game/proof-run.json",
    sessionPath: "target/dev-test-game/session.json",
    reason: "proof-run-session-mismatch",
    message:
      "target/dev-test-game/proof-run.json is stale or does not match target/dev-test-game/session.json",
  });
  assert.deepEqual(
    manifest.artifactFreshness.artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      refreshCommand: artifact.refreshCommand,
      nextCommand: artifact.nextCommand,
      contractReason: artifact.contractReason,
      sessionPath: artifact.sessionPath,
    })),
    [
      {
        id: "proof-run",
        status: "stale",
        refreshCommand:
          "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
        nextCommand:
          "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
        contractReason: "proof-run-session-mismatch",
        sessionPath: "target/dev-test-game/session.json",
      },
      {
        id: "spine-manifest",
        status: "fresh",
        refreshCommand: "npm run test:dev-test-game-spine-manifest",
        nextCommand: undefined,
        contractReason: undefined,
        sessionPath: undefined,
      },
    ],
  );
});

test("dev test-game next-action derives one local recovery command from the manifest", () => {
  const staleManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 0,
        staleCount: 1,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "core-loop",
          label: "Core loop admin proof",
          path: devTestGameCoreLoopAdminProofPath,
          status: "stale",
          mtime: "2026-06-25T00:00:00.000Z",
          ageSeconds: 90000,
          maxAgeSeconds: 86400,
        },
      ],
    },
    adminSpineProof: {
      recovery: {
        surfaces: [
          {
            id: "core-loop",
            path: devTestGameCoreLoopAdminProofPath,
            rerunCommand: "npm run test:dev-test-game-core-loop-admin-proof",
          },
        ],
      },
    },
  });
  const staleAction = buildDevTestGameNextAction(staleManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
  });
  assertDevTestGameNextAction(staleAction);
  assert.deepEqual(staleAction.nextAction, {
    command: "npm run test:dev-test-game-core-loop-admin-proof",
    reason: "artifact-not-fresh",
    status: "blocked",
    artifact: {
      id: "core-loop",
      label: "Core loop admin proof",
      path: devTestGameCoreLoopAdminProofPath,
      status: "stale",
      refreshSource: "admin-spine-recovery",
    },
  });
  assert.deepEqual(staleAction.selectionTrace, {
    strategy: "development-spine-priority",
    candidateCount: 1,
    selectedArtifactId: "core-loop",
    candidates: [
      {
        rank: 1,
        id: "core-loop",
        label: "Core loop admin proof",
        path: devTestGameCoreLoopAdminProofPath,
        status: "stale",
        priority: 2,
        selected: true,
        refreshCommand: "npm run test:dev-test-game-core-loop-admin-proof",
        refreshSource: "admin-spine-recovery",
        ageSeconds: 90000,
        maxAgeSeconds: 86400,
      },
    ],
  });
  const missingDemoProofManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 0,
        staleCount: 0,
        missingCount: 1,
      },
      artifacts: [
        {
          id: "hosted-evidence-lane-demo",
          label: "Hosted evidence lane demo proof",
          path: devTestGameHostedEvidenceLaneDemoProofPath,
          status: "missing",
          maxAgeSeconds: 86400,
        },
      ],
    },
  });
  const missingDemoProofAction = buildDevTestGameNextAction(missingDemoProofManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
  });
  assertDevTestGameNextAction(missingDemoProofAction);
  assert.deepEqual(missingDemoProofAction.nextAction, {
    command: `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
    reason: "artifact-not-fresh",
    status: "blocked",
    artifact: {
      id: "hosted-evidence-lane-demo",
      label: "Hosted evidence lane demo proof",
      path: devTestGameHostedEvidenceLaneDemoProofPath,
      status: "missing",
      refreshSource: "manifest-default",
    },
  });
  assert.deepEqual(missingDemoProofAction.selectionTrace, {
    strategy: "development-spine-priority",
    candidateCount: 1,
    selectedArtifactId: "hosted-evidence-lane-demo",
    candidates: [
      {
        rank: 1,
        id: "hosted-evidence-lane-demo",
        label: "Hosted evidence lane demo proof",
        path: devTestGameHostedEvidenceLaneDemoProofPath,
        status: "missing",
        priority: 19,
        selected: true,
        refreshCommand: `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
        refreshSource: "manifest-default",
        maxAgeSeconds: 86400,
      },
    ],
  });

  const freshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });
  const freshAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "hosted-production-identity",
          status: "unproven",
          requiredEvidence: "Hosted account lifecycle",
        },
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence:
            "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(freshAction);
  const hostedConcurrentMatrixUnproven =
    invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenFixture({
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      spineRoleUrl:
        coreLoopSpineTargetsFixture().roleUrlHrefs["d02-n02-actionPlayer"],
      browserProofCommand: devTestGameLiveProofCommand,
      includeTargetRerunCommand: true,
    });
  const hostedProductionIdentityUnproven =
    hostedProductionIdentityUnprovenFixture({
      proofTarget: devTestGameHostedIdentityEvidencePath,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameIdentityAdminProofCommand,
      includeTargetRerunCommand: true,
      requiredEvidence: "Hosted account lifecycle",
      hostedHandoffChecklist: hostedIdentityHandoffChecklistFixture(),
    });
  assert.deepEqual(freshAction.nextAction, {
    command: devTestGameLiveProofCommand,
    reason: "sequence-deferred-hosted-identity",
    status: "blocked",
    sequenceDeferral: {
      status: "blocked",
      currentSequenceStage: "local-capability-model",
      requiredSequenceStage: "hosted-identity",
      deferredUnprovenId: "hosted-production-identity",
      deferredCommand: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
      deferredProofTarget: devTestGameHostedIdentityEvidencePath,
      deferredRoleUrl:
        "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      nextLocalCommand: devTestGameLiveProofCommand,
      nextLocalProofTarget: "target/dev-test-game/proof-run.json",
      roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      sequenceTransition: {
        status: "blocked",
        promotionCommand: devTestGameHostedIdentitySequencePromotionCommand,
        promotedSequenceStage: "hosted-identity",
      },
      buildSlice:
        "Keep hosted production identity deferred while the local seeded capability model remains the active architecture sequence; refresh the core-live role proof before replacing dev tokens with hosted accounts, sessions, and invites.",
      requiredBeforeHostedIdentity:
        "The local core gameplay, hardening, and local ops proof spine should remain the trusted development surface before production identity replaces dev tokens.",
      localCapabilityConfidence: hostedIdentityLocalCapabilityConfidenceFixture(),
      proofBoundary:
        "Sequencing hold only. This records that hosted production identity is a real release-readiness blocker, but not the next local-development command; it does not prove hosted account lifecycle, invite delivery, release readiness, or production readiness.",
    },
  });
  assert.deepEqual(freshAction.selectionTrace, {
    strategy: "development-spine-priority",
    candidateCount: 0,
    selectedArtifactId: null,
    candidates: [],
  });
  assert.deepEqual(freshAction.stabilityTrace, {
    strategy: "proof-stability-before-readiness",
    status: "clean",
    hostConfirmClicks: 55,
    retryClickCount: 0,
    domFallbackCount: 0,
    forceFallbackCount: 0,
    failureCount: 0,
    maxAttempts: 1,
    eventCount: 0,
    selected: false,
  });
  const cleanSeedProofLaneCoverage = seedProofLaneCoverageFixture();
  const cleanSeedProofLaneCoverageCounts = seedProofLaneCoverageCountSummary(
    cleanSeedProofLaneCoverage,
  );
  assert.deepEqual(freshAction.seedProofLaneCoverageTrace, {
    strategy: "seed-proof-lane-coverage-before-readiness",
    status: "clean",
    source: "target/dev-test-game/release-readiness-checklist.json",
    checkId: "local-seed-demo-fixture",
    passedLaneCount: cleanSeedProofLaneCoverageCounts.passedLaneCount,
    directSeededLaneCount:
      cleanSeedProofLaneCoverageCounts.directSeededLaneCount,
    aliasOnlyLaneCount: cleanSeedProofLaneCoverageCounts.aliasOnlyLaneCount,
    aggregateOnlyLaneCount:
      cleanSeedProofLaneCoverageCounts.aggregateOnlyLaneCount,
    unclassifiedLaneCount: 0,
    unclassifiedLaneIds: [],
    selected: false,
  });
  assert.deepEqual(freshAction.localReadinessDependencyTrace, {
    strategy: "local-readiness-dependency-before-hosted-work",
    candidateCount: 0,
    selectedCheckId: null,
    candidates: [],
  });
  assert.deepEqual(freshAction.releaseReadinessTrace, {
    strategy: "local-dev-release-readiness-priority",
    candidateCount: 2,
    selectedUnprovenId: "hosted-production-identity",
    candidates: [
      releaseReadinessTraceCandidateFixture({
        rank: 1,
        id: hostedProductionIdentityUnproven.id,
        selected: true,
        proofTarget: devTestGameHostedIdentityEvidencePath,
        browserProofCommand: devTestGameLiveProofCommand,
        rerunCommand: devTestGameIdentityAdminProofCommand,
        includeTargetRerunCommand: true,
        requiredEvidence: "Hosted account lifecycle",
        hostedHandoffChecklist: hostedIdentityHandoffChecklistFixture(),
      }),
      releaseReadinessTraceCandidateFixture({
        rank: 2,
        id: hostedConcurrentMatrixUnproven.id,
        selected: false,
        proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
        spineRoleUrl:
          coreLoopSpineTargetsFixture().roleUrlHrefs["d02-n02-actionPlayer"],
        browserProofCommand: devTestGameLiveProofCommand,
        includeTargetRerunCommand: true,
      }),
    ],
  });
  const localCapabilityPassedAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      includeOpsArtifactBundleCheck: true,
      unproven: [
        {
          id: "hosted-production-identity",
          status: "unproven",
          requiredEvidence: "Hosted account lifecycle",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(localCapabilityPassedAction);
  assert.deepEqual(localCapabilityPassedAction.nextAction, {
    command: devTestGameHostedIdentitySequencePromotionCommand,
    reason: "sequence-deferred-hosted-identity",
    status: "blocked",
    sequenceDeferral: {
      status: "blocked",
      currentSequenceStage: "local-capability-model",
      requiredSequenceStage: "hosted-identity",
      deferredUnprovenId: "hosted-production-identity",
      deferredCommand: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
      deferredProofTarget: devTestGameHostedIdentityEvidencePath,
      deferredRoleUrl:
        "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      nextLocalCommand: devTestGameHostedIdentitySequencePromotionCommand,
      nextLocalProofTarget: devTestGameNextActionPath,
      roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      sequenceTransition: {
        status: "ready",
        promotionCommand: devTestGameHostedIdentitySequencePromotionCommand,
        promotedSequenceStage: "hosted-identity",
      },
      buildSlice:
        "Local seeded capability confidence is passed; promote the next-action generator to the hosted-identity sequence stage before replacing dev tokens with hosted accounts, sessions, and invites.",
      requiredBeforeHostedIdentity:
        "The local core gameplay, hardening, and local ops proof spine should remain the trusted development surface before production identity replaces dev tokens.",
      localCapabilityConfidence:
        hostedIdentityPassedLocalCapabilityConfidenceFixture(),
      proofBoundary:
        "Sequencing hold only. This records that hosted production identity is a real release-readiness blocker, but not the next local-development command; it does not prove hosted account lifecycle, invite delivery, release readiness, or production readiness.",
    },
  });
  const hostedIdentityStageAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    sequenceStage: devTestGameHostedIdentitySequenceStage,
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      includeOpsArtifactBundleCheck: true,
      unproven: [
        {
          id: "hosted-production-identity",
          status: "unproven",
          requiredEvidence: "Hosted account lifecycle",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(hostedIdentityStageAction);
  assert.equal(
    hostedIdentityStageAction.generatedFrom.sequenceStage,
    devTestGameHostedIdentitySequenceStage,
  );
  assert.deepEqual(hostedIdentityStageAction.nextAction, {
    command: `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
    reason: "release-readiness-unproven",
    status: "ready",
    unproven: hostedProductionIdentityUnproven,
  });
  assert.deepEqual(
    hostedIdentityStageAction.nextAction.unproven.hostedHandoffChecklist
      .operatorProofDrilldowns,
    hostedIdentityEvidenceOperatorProofDrilldowns,
  );
  assert.deepEqual(
    hostedIdentityStageAction.nextAction.unproven.hostedHandoffChecklist
      .progressionSummary.progressionIds,
    hostedIdentityEvidenceFamilyProgressionCases.map(
      (progression) => progression.id,
    ),
  );
  assert.deepEqual(
    hostedIdentityStageAction.nextAction.unproven.hostedHandoffChecklist
      .progressionSummary.progressionProofTargets,
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) =>
      hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
    ),
  );
  assert.equal(
    freshAction.generatedFrom.sequenceStage,
    devTestGameDefaultSequenceStage,
  );
  const missingLocalDependencyAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      includeProofGraphHandoffCheck: false,
      unproven: [
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence: "Hosted concurrent matrix evidence",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(missingLocalDependencyAction);
  assert.deepEqual(missingLocalDependencyAction.nextAction, {
    command: "npm run test:dev-test-game-proof-graph-admin-proof",
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-proof-graph-admin-role-handoffs",
      status: "missing",
      requiredEvidence:
        "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
      buildSlice:
        "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
      proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
      roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
    },
  });
  assert.deepEqual(missingLocalDependencyAction.localReadinessDependencyTrace, {
    strategy: "local-readiness-dependency-before-hosted-work",
    candidateCount: 1,
    selectedCheckId: "local-proof-graph-admin-role-handoffs",
    candidates: [
      {
        rank: 1,
        id: "local-proof-graph-admin-role-handoffs",
        status: "missing",
        priority: 0,
        selected: true,
        command: "npm run test:dev-test-game-proof-graph-admin-proof",
        buildSlice:
          "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
        proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
        proofBoundary:
          "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
        requiredEvidence:
          "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
      },
    ],
  });
  const missingSeedFixtureDependencyAction = buildDevTestGameNextAction(
    freshManifest,
    {
      generatedAt: "2026-06-26T00:00:01.000Z",
      opsArtifacts: devTestGameOpsArtifactsFixture(),
      raceCoverage: devTestGameRaceCoverageFixture(),
      releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
        seedProofLaneCoverage: null,
        unproven: [
          {
            id: "seed-demo-fixtures",
            status: "unproven",
            requiredEvidence:
              "Machine-readable seeded local demo fixture and scenario inventory tied to this proof run",
          },
          {
            id: "hosted-production-identity",
            status: "unproven",
            requiredEvidence: "Hosted account lifecycle",
          },
        ],
      }),
    },
  );
  assertDevTestGameNextAction(missingSeedFixtureDependencyAction);
  assert.deepEqual(missingSeedFixtureDependencyAction.nextAction, {
    command: devTestGameSeedFixtureCommand,
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-seed-demo-fixture",
      status: "missing",
      requiredEvidence:
        "Passed local seed/demo fixture inventory and admin role-surface proof in the generated release-readiness checklist",
      buildSlice:
        "Generate the local seed/demo fixture inventory and admin proof before choosing hosted readiness work.",
      proofTarget: devTestGameSeedFixturePath,
      roleUrl: devTestGameSeedFixtureRoleUrl,
    },
  });
  assert.deepEqual(
    missingSeedFixtureDependencyAction.localReadinessDependencyTrace,
    {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 1,
      selectedCheckId: "local-seed-demo-fixture",
      candidates: [
        {
          rank: 1,
          id: "local-seed-demo-fixture",
          status: "missing",
          priority: 3,
          selected: true,
          command: devTestGameSeedFixtureCommand,
          buildSlice:
            "Generate the local seed/demo fixture inventory and admin proof before choosing hosted readiness work.",
          proofTarget: devTestGameSeedFixturePath,
          roleUrl: devTestGameSeedFixtureRoleUrl,
          proofBoundary:
            "Local seed/demo fixture inventory and admin browser proof for one dev-test-game run. This recovers the local fixture dependency only; it does not prove hosted demo data, invite delivery, release readiness, or production readiness.",
          requiredEvidence:
            "Passed local seed/demo fixture inventory and admin role-surface proof in the generated release-readiness checklist",
        },
      ],
    },
  );
  const driftedSeedProofLaneCoverage = seedProofLaneCoverageFixture({
    unclassifiedLaneIds: ["new-production-proof-lane"],
  });
  const driftedSeedProofLaneCoverageCounts = seedProofLaneCoverageCountSummary(
    driftedSeedProofLaneCoverage,
  );
  const unclassifiedSeedCoverageAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      seedProofLaneCoverage: driftedSeedProofLaneCoverage,
      unproven: [
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence: "Hosted concurrent matrix evidence",
        },
      ],
    }),
  });
  assertDevTestGameNextAction(unclassifiedSeedCoverageAction);
  assert.deepEqual(unclassifiedSeedCoverageAction.nextAction, {
    command: devTestGameSeedFixtureCommand,
    reason: "seed-proof-lane-coverage-drift",
    status: "blocked",
    seedProofLaneCoverage: {
      source: "target/dev-test-game/release-readiness-checklist.json",
      status: "drifted",
      passedLaneCount: driftedSeedProofLaneCoverageCounts.passedLaneCount,
      unclassifiedLaneCount: 1,
      unclassifiedLaneIds: ["new-production-proof-lane"],
      buildSlice:
        "Classify every passed proof lane as direct seeded, alias-covered, or aggregate-only before expanding the production-facing seeded proof spine.",
      proofTarget: devTestGameSeedFixturePath,
      roleUrl: devTestGameSeedFixtureRoleUrl,
    },
  });
  assert.deepEqual(unclassifiedSeedCoverageAction.seedProofLaneCoverageTrace, {
    strategy: "seed-proof-lane-coverage-before-readiness",
    status: "drifted",
    source: "target/dev-test-game/release-readiness-checklist.json",
    checkId: "local-seed-demo-fixture",
    passedLaneCount: driftedSeedProofLaneCoverageCounts.passedLaneCount,
    directSeededLaneCount:
      driftedSeedProofLaneCoverageCounts.directSeededLaneCount,
    aliasOnlyLaneCount: driftedSeedProofLaneCoverageCounts.aliasOnlyLaneCount,
    aggregateOnlyLaneCount:
      driftedSeedProofLaneCoverageCounts.aggregateOnlyLaneCount,
    unclassifiedLaneCount:
      driftedSeedProofLaneCoverageCounts.unclassifiedLaneCount,
    unclassifiedLaneIds: ["new-production-proof-lane"],
    selected: true,
  });
  const missingNextActionAdminDependencyAction = buildDevTestGameNextAction(
    freshManifest,
    {
      generatedAt: "2026-06-26T00:00:01.000Z",
      opsArtifacts: devTestGameOpsArtifactsFixture(),
      raceCoverage: devTestGameRaceCoverageFixture(),
      releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
        includeProofFreshnessAdminCheck: false,
        includeNextActionAdminCheck: false,
        unproven: [
          {
            id: "hosted-concurrent-race-matrix",
            status: "unproven",
            requiredEvidence: "Hosted concurrent matrix evidence",
          },
        ],
      }),
    },
  );
  assertDevTestGameNextAction(missingNextActionAdminDependencyAction);
  assert.deepEqual(missingNextActionAdminDependencyAction.nextAction, {
    command: "npm run test:dev-test-game-proof-freshness-admin-proof",
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-proof-freshness-admin-surface",
      status: "missing",
      requiredEvidence:
        "Passed proof-freshness admin surface check in the generated release-readiness checklist",
      buildSlice:
        "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
      roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
    },
  });
  assert.deepEqual(
    missingNextActionAdminDependencyAction.localReadinessDependencyTrace,
    {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 2,
      selectedCheckId: "local-proof-freshness-admin-surface",
      candidates: [
        {
          rank: 1,
          id: "local-proof-freshness-admin-surface",
          status: "missing",
          priority: 1,
          selected: true,
          command: "npm run test:dev-test-game-proof-freshness-admin-proof",
          buildSlice:
            "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
          proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
          roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
          proofBoundary:
            "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed proof-freshness admin surface check in the generated release-readiness checklist",
        },
        {
          rank: 2,
          id: "local-next-action-admin-surface",
          status: "missing",
          priority: 2,
          selected: false,
          command: "npm run test:dev-test-game-next-action-admin-proof",
          buildSlice:
            "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
          proofTarget: "target/dev-test-game/next-action-admin-proof.json",
          roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          proofBoundary:
            "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed next-action admin surface check in the generated release-readiness checklist",
        },
      ],
    },
  );
  const missingOnlyNextActionAdminDependencyAction = buildDevTestGameNextAction(
    freshManifest,
    {
      generatedAt: "2026-06-26T00:00:01.000Z",
      opsArtifacts: devTestGameOpsArtifactsFixture(),
      raceCoverage: devTestGameRaceCoverageFixture(),
      releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
        includeNextActionAdminCheck: false,
        unproven: [
          {
            id: "hosted-concurrent-race-matrix",
            status: "unproven",
            requiredEvidence: "Hosted concurrent matrix evidence",
          },
        ],
      }),
    },
  );
  assertDevTestGameNextAction(missingOnlyNextActionAdminDependencyAction);
  assert.deepEqual(missingOnlyNextActionAdminDependencyAction.nextAction, {
    command: "npm run test:dev-test-game-next-action-admin-proof",
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-next-action-admin-surface",
      status: "missing",
      requiredEvidence:
        "Passed next-action admin surface check in the generated release-readiness checklist",
      buildSlice:
        "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/next-action-admin-proof.json",
      roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
    },
  });
  assert.deepEqual(
    missingOnlyNextActionAdminDependencyAction.localReadinessDependencyTrace,
    {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 1,
      selectedCheckId: "local-next-action-admin-surface",
      candidates: [
        {
          rank: 1,
          id: "local-next-action-admin-surface",
          status: "missing",
          priority: 2,
          selected: true,
          command: "npm run test:dev-test-game-next-action-admin-proof",
          buildSlice:
            "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
          proofTarget: "target/dev-test-game/next-action-admin-proof.json",
          roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          proofBoundary:
            "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed next-action admin surface check in the generated release-readiness checklist",
        },
      ],
    },
  );
  const missingDemoReadinessDependencyAction = buildDevTestGameNextAction(
    freshManifest,
    {
      generatedAt: "2026-06-26T00:00:01.000Z",
      opsArtifacts: devTestGameOpsArtifactsFixture(),
      raceCoverage: devTestGameRaceCoverageFixture(),
      releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
        includeHostedEvidenceLaneDemoProofCheck: false,
        unproven: [
          {
            id: "hosted-deployment",
            status: "unproven",
            requiredEvidence:
              "Hosted API/frontend deployment proof with external health checks",
          },
        ],
      }),
    },
  );
  assertDevTestGameNextAction(missingDemoReadinessDependencyAction);
  assert.deepEqual(missingDemoReadinessDependencyAction.nextAction, {
    command: `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
    reason: "release-readiness-local-check-missing",
    status: "blocked",
    localCheck: {
      id: "local-hosted-evidence-lane-demo-proof",
      status: "missing",
      requiredEvidence:
        "Passed local hosted evidence lane demo proof with synthetic external target warning",
      buildSlice:
        "Refresh the local hosted evidence lane demo proof before choosing hosted deployment work.",
      proofTarget: devTestGameHostedEvidenceLaneDemoProofPath,
      roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
    },
  });
  assert.deepEqual(
    missingDemoReadinessDependencyAction.localReadinessDependencyTrace,
    {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 1,
      selectedCheckId: "local-hosted-evidence-lane-demo-proof",
      candidates: [
        {
          rank: 1,
          id: "local-hosted-evidence-lane-demo-proof",
          status: "missing",
          priority: 4,
          selected: true,
          command: `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
          buildSlice:
            "Refresh the local hosted evidence lane demo proof before choosing hosted deployment work.",
          proofTarget: devTestGameHostedEvidenceLaneDemoProofPath,
          roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
          proofBoundary:
            "Local demo proof for the hosted evidence lane pass path. This recovers the blocked-to-passed handoff using synthetic external-looking evidence only; it does not prove hosted deployment, release readiness, or production readiness.",
          requiredEvidence:
            "Passed local hosted evidence lane demo proof with synthetic external target warning",
        },
      ],
    },
  );
  assert.deepEqual(freshAction.replacementRaceReloadTrace, {
    strategy: "replacement-race-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 3,
    coveredCellCount: 3,
    gapCount: 0,
    cells: [
      {
        id: "replacement-private-post",
        raceLaneId: replacementPrivatePostRaceLaneIds[0],
        reloadLaneId: replacementPrivatePostRaceLaneIds[1],
        reloadStatus: "passed",
        covered: true,
      },
      {
        id: "replacement-vote",
        raceLaneId: "concurrent-replacement-vote-race",
        reloadLaneId: "concurrent-replacement-vote-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
      {
        id: "replacement-action",
        raceLaneId: "concurrent-replacement-action-race",
        reloadLaneId: "concurrent-replacement-action-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
    ],
  });
  assert.deepEqual(freshAction.hostConcurrentRaceReloadTrace, {
    strategy: "host-concurrent-race-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 7,
    coveredCellCount: 7,
    gapCount: 0,
    cells: hostConcurrentRaceReloadCellsFixture(),
  });
  assert.deepEqual(freshAction.playerConcurrentActionReloadTrace, {
    strategy: "player-concurrent-action-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 5,
    coveredCellCount: 5,
    gapCount: 0,
    cells: playerConcurrentActionReloadCellsFixture(),
  });
  assert.deepEqual(freshAction.cohostDeadlineRaceReloadTrace, {
    strategy: "cohost-deadline-race-reload-before-readiness",
    status: "covered",
    source: devTestGameRaceCoveragePath,
    requiredCellCount: 1,
    coveredCellCount: 1,
    gapCount: 0,
    cells: cohostDeadlineRaceReloadCellsFixture(),
  });
  assert.deepEqual(
    freshAction.raceCoveragePromotedMilestones,
    raceCoveragePromotedMilestonesFixture({ groupStatus: "covered" }),
  );
  assert.deepEqual(freshAction.staleConflictMessageTrace, {
    strategy: "stale-conflict-message-before-readiness",
    status: "covered",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredLaneCount: staleConflictMessageLaneIds.length,
    coveredLaneCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
    laneIds: [...staleConflictMessageLaneIds],
    surfaceCoverage: staleConflictMessageSurfaceCoverageFixture(),
    surfaces: staleConflictMessageSurfaceFixtureRows(),
  });
  assert.deepEqual(freshAction.hostStaleControlTrace, {
    strategy: "host-stale-control-before-readiness",
    status: "covered",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredLaneCount: hostStaleControlLaneIds.length,
    coveredLaneCount: hostStaleControlLaneIds.length,
    gapCount: 0,
    laneIds: [...hostStaleControlLaneIds],
  });
});

test("spine manifest blocks freshness when proof-run no longer matches session", () => {
  const manifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "proof-run",
          label: "Proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
    proofRunContract: {
      status: "failed",
      proofPath: "target/dev-test-game/proof-run.json",
      sessionPath: "target/dev-test-game/session.json",
      reason: "proof-run-session-mismatch",
      message:
        "target/dev-test-game/proof-run.json is stale or does not match target/dev-test-game/session.json",
    },
  });

  assertDevTestGameSpineManifest(manifest);
  assert.equal(manifest.artifactFreshness.status, "blocked");
  assert.equal(
    manifest.artifactFreshness.nextCommand,
    "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
  );
  assert.deepEqual(manifest.artifactFreshness.proofRunContract, {
    status: "failed",
    proofPath: "target/dev-test-game/proof-run.json",
    sessionPath: "target/dev-test-game/session.json",
    reason: "proof-run-session-mismatch",
    message:
      "target/dev-test-game/proof-run.json is stale or does not match target/dev-test-game/session.json",
  });
  assert.deepEqual(manifest.artifactFreshness.artifacts, [
    {
      id: "proof-run",
      label: "Proof run and session contract",
      path: "target/dev-test-game/proof-run.json",
      status: "stale",
      mtime: "2026-06-26T00:00:00.000Z",
      ageSeconds: 0,
      maxAgeSeconds: 86400,
      refreshCommand:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
      refreshSource: "manifest-default",
      nextCommand:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
      contractStatus: "failed",
      contractReason: "proof-run-session-mismatch",
      contractMessage:
        "target/dev-test-game/proof-run.json is stale or does not match target/dev-test-game/session.json",
      sessionPath: "target/dev-test-game/session.json",
    },
  ]);
});

test("dev test-game next-action advances hosted deployment after target preflight passes", () => {
  const freshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
        },
      ],
    },
  });
  const readiness = devTestGameReleaseReadinessChecklistFixture({
    unproven: [
      {
        id: "hosted-deployment",
        status: "unproven",
        requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
      },
    ],
  });

  const blockedPreflightAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: readiness,
    hostedTargetPreflight: hostedTargetPreflightFixture({ status: "blocked" }),
    proofGraph: nextActionProofGraphFixture("host-phase-control"),
  });
  assertDevTestGameNextAction(blockedPreflightAction);
  assert.equal(
    blockedPreflightAction.nextAction.command,
    `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  );
  assert.equal(blockedPreflightAction.nextAction.status, "blocked");
  assert.equal(
    blockedPreflightAction.nextAction.unproven.proofTarget,
    devTestGameHostedEvidenceLanePath,
  );
  assert.equal(
    blockedPreflightAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    blockedPreflightAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-evidence-lane",
  );
  assert.equal(
    blockedPreflightAction.releaseReadinessTrace.candidates[0].roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    blockedPreflightAction.releaseReadinessTrace.candidates[0].proofGraphNodeId,
    "admin-proof:hosted-evidence-lane",
  );
  assert.equal(
    blockedPreflightAction.releaseReadinessTrace.candidates[0].actionStatus,
    "blocked",
  );
  assert.deepEqual(
    blockedPreflightAction.nextAction.unproven.spineTarget,
    resolvedFeatureSpineTargetFixture("host-phase-control"),
  );
  assert.deepEqual(
    blockedPreflightAction.nextAction.unproven.productionFeatureSpineTarget,
    productionFeatureSpineTargetFixture("host-phase-control"),
  );
  assert.deepEqual(
    blockedPreflightAction.nextAction.unproven.spineDrilldown,
    featureSpineDrilldownFixture("host-phase-control"),
  );
  assert.deepEqual(
    blockedPreflightAction.releaseReadinessTrace.candidates[0].spineTarget,
    blockedPreflightAction.nextAction.unproven.spineTarget,
  );
  assert.deepEqual(
    blockedPreflightAction.nextAction.unproven.selectedProductionFeatureGraph,
    {
      nodeId: "production-feature:host-phase-control",
      status: "passed",
      sourceNodeId: "admin-proof:core-loop",
      edge: {
        from: "admin-proof:core-loop",
        to: "production-feature:host-phase-control",
        relationship: "proves-production-feature",
      },
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
      targetRoleUrl:
        coreLoopSpineTargetsFixture().roleUrlHrefs["d02-n02-host"],
      edgeTargetRoleUrl:
        coreLoopSpineTargetsFixture().roleUrlHrefs["d02-n02-host"],
      selectedSpineTargetRoleUrl:
        coreLoopSpineTargetsFixture().roleUrlHrefs["d02-n02-host"],
      targetRoleUrlMatchesSelectedSpineTarget: true,
      browserProofCommand: devTestGameLiveProofCommand,
      proofTarget: devTestGameReleaseReadinessPath,
      coverageDecision:
        resolvedFeatureSpineTargetFixture("host-phase-control")
          .coverageDecision,
    },
  );
  assert.deepEqual(
    blockedPreflightAction.releaseReadinessTrace.candidates[0]
      .selectedProductionFeatureGraph,
    blockedPreflightAction.nextAction.unproven.selectedProductionFeatureGraph,
  );
  assert.equal(
    blockedPreflightAction.generatedFrom.hostedTargetPreflightStatus,
    "blocked",
  );
  assert.equal(
    blockedPreflightAction.generatedFrom.proofGraph,
    devTestGameProofGraphPath,
  );
  assert.deepEqual(
    blockedPreflightAction.nextAction.unproven.hostedHandoffChecklist.inputIds,
    hostedEvidenceHandoffInputIds,
  );
  assert.deepEqual(
    blockedPreflightAction.nextAction.unproven.hostedHandoffChecklist
      .blockedCheckIds,
    hostedEvidenceHandoffBlockedCheckIds,
  );
  assert.deepEqual(
    blockedPreflightAction.releaseReadinessTrace.candidates[0]
      .hostedHandoffChecklist,
    blockedPreflightAction.nextAction.unproven.hostedHandoffChecklist,
  );

  const mixedBlockedAndReadyReadiness = devTestGameReleaseReadinessChecklistFixture({
    unproven: [
      {
        id: "hosted-deployment",
        status: "unproven",
        requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
      },
      {
        id: "human-release-runbook",
        status: "unproven",
        requiredEvidence:
          "Human-executed beta/release checklist with rollback and support path",
      },
    ],
  });
  const mixedBlockedAndReadyAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: mixedBlockedAndReadyReadiness,
    hostedTargetPreflight: hostedTargetPreflightFixture({ status: "blocked" }),
  });
  assertDevTestGameNextAction(mixedBlockedAndReadyAction);
  assert.equal(
    mixedBlockedAndReadyAction.nextAction.unproven.id,
    "human-release-runbook",
  );
  assert.equal(mixedBlockedAndReadyAction.nextAction.status, "ready");
  assert.equal(
    mixedBlockedAndReadyAction.nextAction.command,
    "npm run test:dev-test-game-release-runbook",
  );
  assert.equal(
    mixedBlockedAndReadyAction.releaseReadinessTrace.candidates[0].id,
    "human-release-runbook",
  );
  assert.equal(
    mixedBlockedAndReadyAction.releaseReadinessTrace.candidates[0].actionStatus,
    "ready",
  );
  assert.equal(
    mixedBlockedAndReadyAction.releaseReadinessTrace.candidates[1].id,
    "hosted-deployment",
  );
  assert.equal(
    mixedBlockedAndReadyAction.releaseReadinessTrace.candidates[1].actionStatus,
    "blocked",
  );
  assert.deepEqual(
    mixedBlockedAndReadyAction.releaseReadinessTrace.candidates[1]
      .hostedHandoffChecklist.blockedCheckIds,
    hostedEvidenceHandoffBlockedCheckIds,
  );

  const externalHostedMatrixAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "real-hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence:
            "Externally reachable hosted API/frontend deployment, multi-node command race execution, and hosted reload/reconnect and stale-client conflict evidence beyond the local hosted-like matrix artifact",
        },
      ],
    }),
    hostedTargetPreflight: hostedTargetPreflightFixture({ status: "blocked" }),
  });
  assertDevTestGameNextAction(externalHostedMatrixAction);
  assert.equal(externalHostedMatrixAction.nextAction.status, "blocked");
  assert.equal(
    externalHostedMatrixAction.nextAction.unproven.realHostedEvidenceStatus,
    "unproven",
  );
  assert.deepEqual(
    externalHostedMatrixAction.nextAction.unproven.hostedHandoffChecklist
      .blockedCheckIds,
    hostedMatrixRealHostedBlockedCheckIds,
  );
  assert.equal(
    externalHostedMatrixAction.nextAction.unproven.realHostedEvidenceInputs
      .command,
    hostedMatrixRealHostedEvidenceCommand,
  );
  assert.deepEqual(
    externalHostedMatrixAction.releaseReadinessTrace.candidates[0]
      .hostedHandoffChecklist,
    externalHostedMatrixAction.nextAction.unproven.hostedHandoffChecklist,
  );

  const passedPreflightAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: readiness,
    hostedTargetPreflight: hostedTargetPreflightFixture({ status: "passed" }),
  });
  assertDevTestGameNextAction(passedPreflightAction);
  assert.equal(
    passedPreflightAction.nextAction.command,
    `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  );
  assert.equal(passedPreflightAction.nextAction.status, "ready");
  assert.equal(
    passedPreflightAction.nextAction.unproven.proofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
  assert.equal(
    passedPreflightAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    passedPreflightAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-concurrent-race-matrix",
  );
  assert.equal(
    passedPreflightAction.releaseReadinessTrace.candidates[0].command,
    `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  );
  assert.equal(
    passedPreflightAction.generatedFrom.hostedTargetPreflightStatus,
    "passed",
  );
  assert.equal(
    passedPreflightAction.generatedFrom.hostedTargetPreflightNextProofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );

  const syntheticPreflightAction = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: readiness,
    hostedTargetPreflight: hostedTargetPreflightFixture({
      status: "passed",
      rawEvidenceSyntheticExternalTarget: true,
    }),
  });
  assertDevTestGameNextAction(syntheticPreflightAction);
  assert.equal(syntheticPreflightAction.nextAction.status, "blocked");
  assert.equal(
    syntheticPreflightAction.nextAction.command,
    `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
  );
  assert.equal(
    syntheticPreflightAction.nextAction.unproven.proofTarget,
    devTestGameHostedEvidenceLaneDemoProofPath,
  );
  assert.equal(
    syntheticPreflightAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    syntheticPreflightAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-evidence-lane",
  );
  assert.equal(
    syntheticPreflightAction.nextAction.unproven.hostedEvidenceMode,
    "synthetic-demo",
  );
  assert.equal(
    syntheticPreflightAction.nextAction.unproven.realHostedEvidenceStatus,
    "unproven",
  );
  assert.equal(
    syntheticPreflightAction.releaseReadinessTrace.candidates[0].actionStatus,
    "blocked",
  );
  assert.equal(
    syntheticPreflightAction.releaseReadinessTrace.candidates[0].command,
    `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
  );
  assert.equal(
    syntheticPreflightAction.generatedFrom.hostedTargetPreflightNextProofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
});

test("dev test-game hosted evidence lane records blocked preflight state", async () => {
  const lane = await runDevTestGameHostedEvidenceLane({
    env: {},
    generatedAt: "2026-06-26T00:00:00.000Z",
  });

  assertDevTestGameHostedEvidenceLane(lane);
  assert.equal(lane.status, "blocked");
  assert.equal(lane.releaseReady, false);
  assert.equal(lane.productionReady, false);
  assert.equal(lane.preflightStatus, "blocked");
  assert.deepEqual(lane.blockedCheckIds, hostedTargetPreflightBlockingCheckIds);
  assert.deepEqual(
    lane.checks
      .filter((check) => lane.blockedCheckIds.includes(check.id))
      .map((check) => [check.id, check.requiredEvidence]),
    [
      [
        "hosted-frontend-url-configured",
        hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      ],
      [
        "hosted-api-url-configured",
        hostedTargetPreflightMissingApiUrlRequiredEvidence,
      ],
      [
        "hosted-targets-external",
        hostedTargetPreflightExternalTargetsRequiredEvidence(),
      ],
      [
        "raw-evidence-path-configured",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
      [
        "raw-evidence-readable",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
    ],
  );
  assert.equal(lane.blockedReceipt.status, "blocked");
  assert.deepEqual(lane.blockedReceipt.missingRequiredInputs, [
    "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
    "FMARCH_HOSTED_MATRIX_API_URL",
    "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
  ]);
  assert.equal(
    lane.blockedReceipt.localVsHostedBoundary,
    "Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.",
  );
  assert.equal(lane.nextCommand, `npm run ${devTestGameHostedEvidenceLaneCommand}`);
  assert.equal(lane.nextProofTarget, devTestGameHostedEvidenceLanePath);
  assert.deepEqual(lane.generatedFrom, {
    hostedTargetPreflight: devTestGameHostedTargetPreflightPath,
  });
});

test("dev test-game next-action blocks readiness work on saved harness stability drift", () => {
  const freshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });

  const action = buildDevTestGameNextAction(freshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture({
      proofStability: {
        status: "passed",
        hostConfirmClicks: {
          total: 55,
          firstClickCount: 53,
          concurrentClickCount: 0,
          retryClickCount: 1,
          domFallbackCount: 1,
          forceFallbackCount: 0,
          failureCount: 0,
          maxAttempts: 3,
          byAction: { resolve_phase: 2 },
          byRole: { host: 2 },
          events: [
            {
              actionId: "resolve_phase",
              roleLabel: "host",
              method: "playwright-retry",
              attempts: 2,
            },
            {
              actionId: "extend_deadline",
              roleLabel: "cohost",
              method: "dom-fallback",
              attempts: 3,
            },
          ],
        },
      },
    }),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence: "Hosted or hosted-like concurrent command race matrix",
        },
      ],
    }),
  });

  assertDevTestGameNextAction(action);
  assert.deepEqual(action.nextAction, {
    command: devTestGameLiveProofCommand,
    reason: "harness-stability-drift",
    status: "blocked",
    stability: {
      source: "target/dev-test-game/ops-artifacts.json",
      hostConfirmClicks: 55,
      retryClickCount: 1,
      domFallbackCount: 1,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 3,
      eventCount: 2,
      buildSlice:
        "Stabilize the critical host-confirm browser interaction before expanding the production-facing seeded proof spine.",
      proofTarget: "target/dev-test-game/session.json",
    },
  });
  assert.deepEqual(action.stabilityTrace, {
    strategy: "proof-stability-before-readiness",
    status: "drifted",
    hostConfirmClicks: 55,
    retryClickCount: 1,
    domFallbackCount: 1,
    forceFallbackCount: 0,
    failureCount: 0,
    maxAttempts: 3,
    eventCount: 2,
    selected: true,
  });
  assert.equal(
    action.releaseReadinessTrace.selectedUnprovenId,
    "hosted-concurrent-race-matrix",
  );
  assert.equal(action.hostConcurrentRaceReloadTrace.status, "covered");
  assert.equal(action.playerConcurrentActionReloadTrace.status, "covered");
  assert.equal(action.cohostDeadlineRaceReloadTrace.status, "covered");
  assert.equal(action.staleConflictMessageTrace.status, "covered");
  assert.equal(action.hostStaleControlTrace.status, "covered");
});

test("dev test-game next-action prioritizes development-spine recovery over manifest order", () => {
  const staleManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 3,
        freshCount: 0,
        staleCount: 1,
        missingCount: 2,
      },
      artifacts: [
        {
          id: "release",
          label: "Release admin proof",
          path: devTestGameReleaseAdminProofPath,
          status: "missing",
        },
        {
          id: "next-action",
          label: "Next action receipt",
          path: "target/dev-test-game/next-action.json",
          status: "missing",
        },
        {
          id: "proof-run",
          label: "Live proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
          mtime: "2026-06-25T00:00:00.000Z",
          ageSeconds: 90000,
          maxAgeSeconds: 86400,
        },
      ],
    },
  });

  const staleAction = buildDevTestGameNextAction(staleManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
  });

  assertDevTestGameNextAction(staleAction);
  assert.deepEqual(staleAction.nextAction, {
    command: devTestGameLiveProofCommand,
    reason: "artifact-not-fresh",
    status: "blocked",
    artifact: {
      id: "proof-run",
      label: "Live proof run",
      path: "target/dev-test-game/proof-run.json",
      status: "stale",
      refreshSource: "manifest-default",
    },
  });
  assert.deepEqual(
    staleAction.selectionTrace.candidates.map((candidate) => [
      candidate.rank,
      candidate.id,
      candidate.status,
      candidate.priority,
      candidate.selected,
      candidate.refreshCommand,
    ]),
    [
      [
        1,
        "proof-run",
        "stale",
        0,
        true,
        devTestGameLiveProofCommand,
      ],
      [2, "release", "missing", 21, false, "npm run test:dev-test-game-release-admin-proof"],
      [3, "next-action", "missing", 10000, false, "npm run test:dev-test-game-admin-spine"],
    ],
  );
});

test("dev test-game proof graph records local proof role URLs and recovery edges", () => {
  const adminSpineProof = adminSpineProofFixture();
  const validatedAdminSpineProof = validateDevTestGameAdminSpineProof(
    adminSpineProof,
  );
  assert.deepEqual(
    validatedAdminSpineProof.batches.map((batch) => [
      batch.label,
      batch.caseCount,
      batch.sharedFrontendSession,
      batch.sharedChromiumSession,
    ]),
    [
      [
        "Aggregate pre-release admin proof batch",
        7,
        true,
        true,
      ],
      [
        "Aggregate release and hosted admin proof batch",
        9,
        true,
        true,
      ],
    ],
  );
  const terminalBatches = validateDevTestGameAdminSpineTerminalBatches(
    adminSpineTerminalBatchesFixture(),
  );
  assert.deepEqual(
    terminalBatches.batches.map((batch) => [
      batch.label,
      batch.caseCount,
      batch.proofIds,
      batch.sharedFrontendSession,
      batch.sharedChromiumSession,
    ]),
    [
      [
        "Terminal admin proof batch",
        3,
        ["proof-graph", "proof-freshness", "next-action"],
        true,
        true,
      ],
      [
        "Terminal refresh admin proof batch",
        2,
        ["proof-freshness", "next-action"],
        true,
        true,
      ],
    ],
  );
  const releaseReadiness = devTestGameReleaseReadinessChecklistFixture({
    includeHostSetupProofCheck: true,
    unproven: [
      {
        id: "hosted-deployment",
        status: "unproven",
        requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
      },
    ],
  });
  const spineManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "blocked",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "proof-run",
          label: "Dev test-game proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
        },
      ],
    },
    adminSpineProof,
  });
  const graph = buildDevTestGameProofGraph(
    {
      spineManifest,
      adminSpineProof,
      adminSpineTerminalBatches: adminSpineTerminalBatchesFixture(),
      ...recoveryReceiptFixtures(),
      releaseReadiness,
    },
    {
      generatedAt: "2026-06-26T00:00:00.000Z",
    },
  );

  assertDevTestGameProofGraph(graph, { releaseReadiness });
  assertDevTestGameProofGraphCoversAdminSpine(graph, adminSpineProof);
  assertDevTestGameProofGraphCoversProductionFeatureTargets(
    graph,
    releaseReadiness,
  );
  assert.equal(graph.summary.nodeCount, 72);
  assert.equal(graph.summary.roleUrlCount, 72);
  assert.equal(graph.summary.roleSurfaceProofCount, 5);
  assert.equal(graph.summary.productionFeatureTargetCount, 41);
  assert.equal(graph.summary.terminalBatchCount, 2);
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assert.equal(
      graph.summary[descriptor.summaryLaneCountKey],
      descriptor.laneIds.length,
    );
  }
  assert.equal(
    graph.generatedFrom.adminSpineTerminalBatches,
    "target/dev-test-game/admin-spine-terminal-batches.json",
  );
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assert.equal(graph.generatedFrom[descriptor.receiptKey], descriptor.proofTarget);
  }
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => [node.surfaceId, node.artifact, node.roleUrl, node.proofCommand]),
    adminSpineProof.adminProofs.map((proof) => [
      proof.id,
      proof.path,
      proof.detailRoleUrl,
      proof.rerunCommand,
    ]),
  );
  const proofGraphReceiptNodeIds = recoveryReceiptGraphDescriptors.map(
    (descriptor) => descriptor.nodeId,
  );
  assert.deepEqual(
    graph.nodes
      .filter((node) =>
        [
          "admin-spine",
          "spine-manifest",
          "proof-graph",
          "proof-freshness",
          "next-action",
          "admin-spine-terminal-batches",
          ...proofGraphReceiptNodeIds,
        ].includes(node.id),
      )
      .map((node) => [
        node.id,
        node.kind,
        node.artifact,
        node.roleUrl,
        node.recoveryCommand,
      ]),
    [
      [
        "admin-spine",
        "aggregate-proof",
        "target/dev-test-game/admin-spine-proof.json",
        "/admin/audit/local-admin-spine?game=<seeded-game>",
        "npm run test:dev-test-game-admin-spine",
      ],
      [
        "spine-manifest",
        "manifest",
        "target/dev-test-game/spine-manifest.json",
        "/admin/audit/local-spine-manifest?game=<seeded-game>",
        "npm run test:dev-test-game-spine-manifest-admin-proof",
      ],
      [
        "proof-graph",
        "proof-graph",
        "target/dev-test-game/proof-graph.json",
        "/admin/audit/local-proof-graph?game=<seeded-game>",
        "test:dev-test-game-proof-graph",
      ],
      [
        "proof-freshness",
        "freshness-dashboard",
        "target/dev-test-game/proof-freshness-admin-proof.json",
        "/admin/audit/local-proof-freshness?game=<seeded-game>",
        devTestGameLiveProofCommand,
      ],
      [
        "next-action",
        "recovery-receipt",
        "target/dev-test-game/next-action.json",
        "/admin/audit/local-next-action?game=<seeded-game>",
        "test:dev-test-game-proof-freshness-admin-proof",
      ],
      [
        "admin-spine-terminal-batches",
        "terminal-proof-batch-receipt",
        "target/dev-test-game/admin-spine-terminal-batches.json",
        "/admin/audit/local-admin-spine?game=<seeded-game>",
        "npm run test:dev-test-game-admin-spine",
      ],
      ...recoveryReceiptGraphDescriptors.map((descriptor) => [
        descriptor.nodeId,
        descriptor.kind,
        descriptor.proofTarget,
        descriptor.roleUrl,
        descriptor.proofCommand,
      ]),
    ],
  );
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.kind === "role-surface-proof")
      .map((node) => [
        node.id,
        node.sourceCheckId,
        node.artifact,
        node.roleUrl,
        node.recoveryCommand,
      ]),
    [
      [
        "role-surface:host-setup",
        "local-host-setup-proof",
        "target/dev-test-game/host-setup-proof.json",
        "http://127.0.0.1:5173/g/<seeded-game>/setup",
        "npm run dev:test-game -- --verify-host-setup-only",
      ],
      [
        "role-surface:cohost-console",
        "local-cohost-console-proof",
        "target/dev-test-game/proof-run.json",
        "http://127.0.0.1:5173/g/<seeded-game>/host",
        "npm run test:dev-test-game-core-live",
      ],
      [
        "role-surface:replacement-player",
        "local-replacement-player-proof",
        "target/dev-test-game/proof-run.json",
        "http://127.0.0.1:5173/g/<seeded-game>",
        "npm run test:dev-test-game-core-live",
      ],
      [
        "role-surface:replacement-action",
        "local-replacement-action-proof",
        "target/dev-test-game/proof-run.json",
        "http://127.0.0.1:5173/g/<replacement-action-game>",
        "npm run test:dev-test-game-core-live",
      ],
      [
        "role-surface:replacement-private-channel",
        "local-replacement-private-proof",
        "target/dev-test-game/proof-run.json",
        "http://127.0.0.1:5173/g/<replacement-private-game>/c/private%3Amafia_day_chat",
        "npm run test:dev-test-game-core-live",
      ],
    ],
  );
  assert(
    graph.edges.some(
      (edge) =>
        edge.from === "spine-manifest" &&
        edge.to === "role-surface:host-setup" &&
        edge.relationship === "records",
    ),
  );
  const coreLoopProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-core-loop-proof",
    ).spineTargets.productionFeatureTargets;
  const hardeningProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-hardening-proof",
    ).spineTargets.productionFeatureTargets;
  const identityAdapterCheck = releaseReadiness.localDevelopmentSpine.checks.find(
    (check) => check.id === "local-identity-adapter-proof",
  );
  const hostSetupProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-host-setup-proof",
    ).spineTargets.productionFeatureTargets;
  const cohostProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-cohost-console-proof",
    ).spineTargets.productionFeatureTargets;
  const replacementProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-replacement-player-proof",
    ).spineTargets.productionFeatureTargets;
  const replacementActionProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-replacement-action-proof",
    ).spineTargets.productionFeatureTargets;
  const replacementPrivateProductionFeatureTargets =
    releaseReadiness.localDevelopmentSpine.checks.find(
      (check) => check.id === "local-replacement-private-proof",
    ).spineTargets.productionFeatureTargets;
  const expectedProductionFeatureRows = [
    ...[
      coreLoopProductionFeatureTargets,
      hostSetupProductionFeatureTargets,
      cohostProductionFeatureTargets,
      replacementProductionFeatureTargets,
      replacementActionProductionFeatureTargets,
      replacementPrivateProductionFeatureTargets,
      hardeningProductionFeatureTargets,
    ]
      .flatMap((productionFeatureTargets) =>
        productionFeatureTargets.slotIds.map((slotId) => {
          const target = productionFeatureTargets.bySlotId[slotId];
          return [
            `production-feature:${slotId}`,
            slotId,
            target.sourceCheckId,
            devTestGameReleaseReadinessPath,
            target.detailRoleUrl,
            target.roleUrl,
            target.browserProofCommand,
            target.rerunCommand,
            expectedPrivateChannelFeatureEvidenceObjectNames(slotId),
          ];
        }),
      ),
    [
      "production-feature:identity-adapter",
      "identity-adapter",
      "local-identity-adapter-proof",
      devTestGameReleaseReadinessPath,
      identityAdapterCheck.adminRoleSurface.detailRoleUrl,
      identityAdapterCheck.adminRoleSurface.detailRoleUrl,
      devTestGameLiveProofCommand,
      devTestGameIdentityAdminProofCommand,
      [],
    ],
  ];
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.kind === "production-feature-spine-target")
      .map((node) => [
        node.id,
        node.featureSlotId,
        node.sourceCheckId,
        node.artifact,
        node.roleUrl,
        node.targetRoleUrl,
        node.browserProofCommand,
        node.recoveryCommand,
        node.evidenceObjectNames ?? [],
      ]),
    expectedProductionFeatureRows,
  );
  assert(
    graph.edges.some(
      (edge) =>
        edge.from === "proof-freshness" &&
        edge.to === "next-action" &&
        edge.relationship === "recovers-through",
    ),
  );
  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.from === "admin-spine-terminal-batches")
      .map((edge) => [edge.to, edge.relationship]),
    [
      ["proof-graph", "terminal-browser-proof"],
      ["proof-freshness", "terminal-browser-proof"],
      ["next-action", "terminal-browser-proof"],
    ],
  );
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assert.deepEqual(
      graph.edges
        .filter(
          (edge) =>
            edge.from === descriptor.nodeId || edge.to === descriptor.nodeId,
        )
        .map((edge) => [edge.from, edge.to, edge.relationship]),
      [
        [descriptor.provingNodeId, descriptor.nodeId, "proves"],
        [descriptor.nodeId, "proof-graph", "records"],
        [descriptor.nodeId, "next-action", "summarizes-into"],
      ],
    );
  }
  assert(
    expectedProductionFeatureRows.every(([, slotId, sourceCheckId]) =>
      graph.edges.some(
        (edge) =>
          edge.from === productionFeatureGraphSourceNodeId(sourceCheckId) &&
          edge.to === `production-feature:${slotId}` &&
          edge.relationship === "proves-production-feature",
      ),
    ),
  );
  const seedDriftManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: 0,
          maxAgeSeconds: 86400,
        },
      ],
    },
    adminSpineProof,
  });
  const seedDriftReleaseReadiness = devTestGameReleaseReadinessChecklistFixture({
    seedProofLaneCoverage: seedProofLaneCoverageFixture({
      unclassifiedLaneIds: ["new-production-proof-lane"],
    }),
    unproven: [
      {
        id: "hosted-concurrent-race-matrix",
        status: "unproven",
        requiredEvidence: "Hosted concurrent matrix evidence",
      },
    ],
  });
  const seedDriftNextAction = buildDevTestGameNextAction(seedDriftManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: seedDriftReleaseReadiness,
  });
  const seedDriftGraph = buildDevTestGameProofGraph(
    {
      spineManifest: seedDriftManifest,
      adminSpineProof,
      nextAction: seedDriftNextAction,
      releaseReadiness: seedDriftReleaseReadiness,
    },
    {
      generatedAt: "2026-06-26T00:00:02.000Z",
    },
  );
  assertDevTestGameProofGraph(seedDriftGraph, {
    releaseReadiness: seedDriftReleaseReadiness,
  });
  assert.deepEqual(
    seedDriftGraph.edges.find(
      (edge) =>
        edge.from === "next-action" &&
        edge.to === "admin-proof:seed" &&
        edge.relationship === "recovery-target",
    ),
    {
      from: "next-action",
      to: "admin-proof:seed",
      relationship: "recovery-target",
      reason: "seed-proof-lane-coverage-drift",
      command: devTestGameSeedFixtureCommand,
      roleUrl: devTestGameSeedFixtureRoleUrl,
      proofTarget: devTestGameSeedFixturePath,
      buildSlice:
        "Classify every passed proof lane as direct seeded, alias-covered, or aggregate-only before expanding the production-facing seeded proof spine.",
      unclassifiedLaneCount: 1,
      unclassifiedLaneIds: ["new-production-proof-lane"],
    },
  );
  assert.equal(seedDriftGraph.generatedFrom.nextAction, nextActionPath);
  assert.equal(
    seedDriftGraph.generatedFrom.releaseReadiness,
    devTestGameReleaseReadinessPath,
  );
  assert.throws(
    () =>
      assertDevTestGameProofGraphCoversAdminSpine(
        {
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== "admin-proof:identity"),
        },
        adminSpineProof,
      ),
    /proof graph admin surface count drifted/,
  );
});

test("core-loop generatedFrom families come from one canonical bundle", () => {
  const families = coreLoopGeneratedFromScenarioFamilies();
  assert.deepEqual(Object.keys(families), [
    "hostControlFamily",
    "playerActionRecoveryFamily",
    "privateReceiptSurfaceFamily",
    "postDayVoteAdvanceFamily",
    "voteResolutionFamily",
    "phaseProgressionFamily",
    "lateActionProgressionFamily",
    "resolutionReceiptPrivacyFamily",
    "noLynchProgressionFamily",
    "dayFiveProgressionFamily",
    "completedEndgameProgressionFamily",
    "privateChannelRecoveryFamily",
  ]);
  assert.deepEqual(families.phaseProgressionFamily.laneIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
    "night-three-action-resolution",
    "action-loop",
  ]);
  assert.deepEqual(families.dayFiveProgressionFamily.staleRejects, {
    staleDayFiveVote:
      families.dayFiveProgressionFamily.surfaces.dayFiveNoLynchResolution
        .staleDayFiveVoteCase,
  });
  assert.deepEqual(
    coreLoopAdminProofFixture().generatedFrom.phaseProgressionFamily,
    families.phaseProgressionFamily,
  );
});

test("admin proof fixtures prove normalized evidence object rows", () => {
  const releaseProof = assertReleaseAdminProof(releaseAdminProofFixture());
  assert.deepEqual(
    releaseProof.generatedFrom.evidenceObjectRowIds,
    [
      ...expectedNormalizedEvidenceObjectRowIds({
        parentId: "local-private-channel-recovery-milestone",
        objects: privateChannelNormalizedEvidenceObjects,
      }),
      ...expectedNormalizedEvidenceObjectRowIds({
        parentId: "local-replacement-private-recovery-milestone",
        objects: replacementPrivatePostNormalizedEvidenceObjects,
      }),
    ],
  );
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: releaseProof.adminRoleSurface,
    rowIds: releaseProof.generatedFrom.evidenceObjectRowIds,
    proofName: "release admin proof fixture",
    rowName: "evidence object",
  });

  const proofGraphProof = assertProofGraphAdminProof(
    proofGraphAdminProofFixture(),
  );
  assert.deepEqual(
    proofGraphProof.generatedFrom.evidenceObjectRowIds,
    [
      ...expectedNormalizedEvidenceObjectRowIds({
        parentId: "private-channel-recovery-receipt",
        objects: privateChannelNormalizedEvidenceObjects,
      }),
      ...expectedNormalizedEvidenceObjectRowIds({
        parentId: "replacement-private-recovery-receipt",
        objects: replacementPrivatePostNormalizedEvidenceObjects,
      }),
    ],
  );
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: proofGraphProof.adminRoleSurface,
    rowIds: proofGraphProof.generatedFrom.evidenceObjectRowIds,
    proofName: "proof graph admin proof fixture",
    rowName: "evidence object",
  });
});

test("admin role surface helpers assert visible rows and status text", () => {
  const adminRoleSurface = {
    visibleRelatedLinks: ["local-next-action"],
    visibleUnprovenStatuses: {
      "hosted-deployment": "blocked - needs hosted API URL",
    },
  };

  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface,
    rowIds: ["local-next-action"],
    proofName: "helper proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface,
    expectedStatuses: {
      "hosted-deployment": "hosted API URL",
    },
    proofName: "helper proof",
    rowName: "blocked evidence",
    surfaceKey: "visibleUnprovenStatuses",
  });
  assert.throws(
    () =>
      assertVisibleAdminRoleSurfaceRows({
        adminRoleSurface,
        rowIds: ["local-release-readiness"],
        proofName: "helper proof",
        rowName: "related link",
        surfaceKey: "visibleRelatedLinks",
      }),
    /helper proof missing related link: local-release-readiness/,
  );
  assert.throws(
    () =>
      assertAdminRoleSurfaceStatusText({
        adminRoleSurface,
        expectedStatuses: {
          "hosted-deployment": "backup receipt",
        },
        proofName: "helper proof",
        rowName: "blocked evidence",
        surfaceKey: "visibleUnprovenStatuses",
      }),
    /helper proof missing blocked evidence: hosted-deployment/,
  );
});

test("admin audit handoff paths normalize the shared hosted handoff shape", () => {
  assert.deepEqual(
    buildAdminAuditHandoffPath({
      upstreamAuditId: "local-next-action",
      localCapabilityAuditId: "local-race-coverage",
      downstreamStatus: "unproven",
      downstreamCommand: "npm run test:dev-test-game-hosted-matrix-external-evidence",
      downstreamProofTarget: "target/dev-test-game/hosted-matrix-external.json",
    }),
    {
      upstreamAuditId: "local-next-action",
      upstreamLabel: "Ranked next action",
      localCapabilityAuditId: "local-race-coverage",
      downstreamStatus: "unproven",
      downstreamCommand:
        "npm run test:dev-test-game-hosted-matrix-external-evidence",
      downstreamProofTarget: "target/dev-test-game/hosted-matrix-external.json",
    },
  );
});

test("hosted admin proof fixtures carry visible shared handoff paths", () => {
  const proofFixtures = [
    ["hosted identity", hostedIdentityEvidenceAdminProofFixture()],
    ["hosted matrix", hostedConcurrentRaceMatrixAdminProofFixture()],
    [
      "real hosted observability",
      realHostedObservabilityHandoffAdminProofFixture(),
    ],
  ];
  for (const [label, proof] of proofFixtures) {
    assertGeneratedAdminProofHandoffPath({
      proof,
      proofName: `${label} proof fixture`,
    });
  }
});

test("hosted handoff proof catalog requires explicit readiness decisions", async () => {
  for (const artifactCase of hostedAdminHandoffProofArtifactCases) {
    assert.equal(
      hostedAdminHandoffProofReadinessDecision(artifactCase),
      "readiness-loaded",
      `${artifactCase.id} should be loaded by release readiness`,
    );
  }
  const futureProofCase = {
    id: "future-hosted-handoff-admin-proof",
    readinessId: "futureHostedHandoffAdminProof",
    path: "target/dev-test-game/future-hosted-handoff-admin-proof.json",
    envVar: "FMARCH_DEV_TEST_GAME_FUTURE_HOSTED_HANDOFF_ADMIN_PROOF",
    outputKeys: {
      data: "futureHostedHandoffAdminProof",
      path: "futureHostedHandoffAdminProofPath",
      freshnessMetadata: "futureHostedHandoffAdminProofArtifact",
    },
  };
  assert.equal(hostedAdminHandoffProofReadinessDecision(futureProofCase), null);
  await assert.rejects(
    () =>
      assertHostedAdminHandoffProofReadinessDecisions({
        artifactCases: [futureProofCase],
        artifactExists: async () => true,
      }),
    /hosted handoff proof readiness decision missing: future-hosted-handoff-admin-proof/,
  );
  await assert.doesNotReject(() =>
    assertHostedAdminHandoffProofReadinessDecisions({
      artifactCases: [futureProofCase],
      artifactExists: async () => false,
    }),
  );
});

test("named game selection is idempotent by default with explicit reset and reuse", () => {
  const registry = {
    local: { game: "11111111-1111-4111-8111-111111111111" },
  };
  assert.deepEqual(
    selectGame({ args: {}, gameName: "local", registry }),
    {
      game: "11111111-1111-4111-8111-111111111111",
      seedMode: "reuse-if-present",
    },
  );
  assert.deepEqual(
    selectGame({
      args: { reset: true },
      gameName: "local",
      registry,
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
    }),
    {
      game: "22222222-2222-4222-8222-222222222222",
      seedMode: "seed",
    },
  );
  assert.deepEqual(
    selectGame({ args: { reuse: true }, gameName: "local", registry }),
    {
      game: "11111111-1111-4111-8111-111111111111",
      seedMode: "reuse",
    },
  );
  assert.throws(
    () => selectGame({ args: { reuse: true }, gameName: "missing", registry: {} }),
    /no named game 'missing'/,
  );
});

test("seed plan creates a playable mafiascum D01 game shape", () => {
  const game = "33333333-3333-4333-8333-333333333333";
  const plan = seedCommandPlanForGame(game);
  assert.equal(plan.length, 22);
  assert.deepEqual(plan[0], ["host_h", { CreateGame: { game, pack: "mafiascum" } }]);
  assert(plan.some(([, command]) => command.AddCohost?.user === "cohost_c"));
  assert(plan.some(([, command]) => command.StartGame?.phase === "D01"));
  assert(plan.some(([, command]) => command.SubmitVote?.target?.Slot === "slot_5"));
  assert(plan.some(([, command]) => command.SubmitPost?.channel_id === "main"));
});

test("session card and markdown include role credential URLs and tokens", async () => {
  const game = "44444444-4444-4444-8444-444444444444";
  const tokens = createTokenSet("dev-test-card");
  const replacementResolvedPrivatePost =
    replacementStalePrivatePostAfterResolveScenario();
  const replacementCompletedPrivatePost =
    replacementStalePrivatePostAfterCompleteScenario();
  const replacementIncomingActionCase = replacementIncomingActionScenario();
  const replacementActionReconnectCase = replacementActionReconnectScenario();
  const replacementStaleActionAfterResolveCase =
    replacementStaleActionAfterResolveScenario();
  const card = buildSessionCard({
    gameName: "card",
    game,
    seedMode: "seeded",
    databaseUrl: "postgres://db/fmarch",
    apiBaseUrl: "http://127.0.0.1:4101",
    frontendBaseUrl: "http://127.0.0.1:4102",
    seedCommands: [{ command: { CreateGame: { game, pack: "mafiascum" } } }],
    identityBootstrap: {
      status: "passed",
      devSessionEndpointEnabled: false,
      rootSessionSource: "auth_session",
      browserCredentialIssuer: "/auth/session-grants",
      rootPrincipalUserId: "root_admin",
      rootCapabilityKinds: ["GlobalAdmin"],
      rawRootTokenStored: false,
      boundary:
        "Root GlobalAdmin is seeded directly into the local auth_session table.",
    },
    sessions: {
      host: {
        principalUserId: "host_h",
        credentialKind: "invite",
        token: tokens.host,
        inviteToken: tokens.host,
        returnTo: `/g/${game}/host`,
        expectedCapabilityKind: "HostOf",
      },
      hostSetup: {
        principalUserId: "host_h",
        credentialKind: "invite",
        token: tokens.hostSetup,
        inviteToken: tokens.hostSetup,
        returnTo: `/g/${game}/setup`,
        expectedCapabilityKind: "HostOf",
      },
      player: {
        principalUserId: "player-mira",
        credentialKind: "invite",
        token: tokens.player,
        inviteToken: tokens.player,
        returnTo: `/g/${game}`,
        expectedCapabilityKind: "SlotOccupant",
      },
      replacementPlayer: {
        principalUserId: "player-rowan",
        credentialKind: "invite",
        token: tokens.replacementPlayer,
        inviteToken: tokens.replacementPlayer,
        returnTo: `/g/${game}`,
        expectedCapabilityKind: "SlotOccupant",
      },
      cohost: {
        principalUserId: "cohost_c",
        credentialKind: "invite",
        token: tokens.cohost,
        inviteToken: tokens.cohost,
        returnTo: `/g/${game}/host`,
        expectedCapabilityKind: "CohostOf",
      },
    },
  });

  assert.equal(card.name, "card");
  assert.equal(card.seedCommandCount, 1);
  assert.equal(card.identityBootstrap.devSessionEndpointEnabled, false);
  assert.equal(card.identityBootstrap.rootSessionSource, "auth_session");
  assert.equal(card.identityBootstrap.browserCredentialIssuer, "/auth/session-grants");
  assert.equal(
    card.sessions.host.loginUrl,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=dev-test-card-host`,
  );
  assert.equal(card.sessions.host.credentialKind, "invite");
  assert.equal(card.sessions.host.inviteToken, "dev-test-card-host");
  assert.equal(card.sessions.player.token, "dev-test-card-player");
  card.verification = {
    status: "passed",
    roles: [
      "host",
      "hostSetup",
      "player",
      "actionPlayer",
      "deniedPlayer",
      "cohost",
      "replacementPlayer",
    ],
    sessions: {
      hostSetup: {
        capabilityKinds: ["HostOf"],
        cookie: { valuePrefix: "invite-session-" },
      },
      cohost: {
        capabilityKinds: ["CohostOf"],
        cookie: { valuePrefix: "invite-session-" },
      },
      replacementPlayer: {
        principalUserId: "player-rowan",
        capabilityKinds: ["SlotOccupant", "ChannelMember"],
        cookie: { valuePrefix: "invite-session-" },
      },
    },
    hostSetup: {
      status: "passed",
      proof:
        "Host setup role URL opens roster, role, policy, invite, and start recovery surface, then round-trips the post-policy command and restores the seeded policy.",
      roleUrl: `http://127.0.0.1:4102/g/${game}/setup`,
      capabilityLabel: `HostOf(${game})`,
      readinessSummary: "Started at D01",
      phaseId: "D01",
      startDisabled: true,
      hostHref: `/g/${game}/host`,
      slotIds: ["slot-7", "slot_4"],
      roleKeys: ["mafia_goon", "vanilla_townie"],
      mainPolicyText: "Media-only posts are disabled.",
      policyCommand: {
        status: "passed",
        actionId: "set-post-policy",
        commandKind: "SetPostPolicy",
        channelId: "main",
        allowMediaOnlySequence: [true, false],
        finalPolicyText: "Media-only posts are disabled.",
        enabled: {
          status: "ack",
          policyText: "Media-only posts are enabled.",
          refreshedAllowMediaOnly: true,
          streamSeqs: [23],
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "host_h",
                command: {
                  SetPostPolicy: {
                    game,
                    channel_id: "main",
                    allow_media_only: true,
                  },
                },
              },
            },
          },
        },
        restored: {
          status: "ack",
          policyText: "Media-only posts are disabled.",
          refreshedAllowMediaOnly: false,
          streamSeqs: [24],
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "host_h",
                command: {
                  SetPostPolicy: {
                    game,
                    channel_id: "main",
                    allow_media_only: false,
                  },
                },
              },
            },
          },
        },
      },
      setupMutationCommand: {
        status: "passed",
        proof:
          "A disposable pre-start setup role URL added a slot, assigned its occupant, assigned its role, and refreshed to ready setup state.",
        game: "77777777-7777-4777-8777-777777777777",
        roleUrl:
          "http://127.0.0.1:4102/g/77777777-7777-4777-8777-777777777777/setup",
        sessionPrincipalUserId: "host_h",
        seed: {
          game: "77777777-7777-4777-8777-777777777777",
          commands: 4,
          initialSlotId: "slot_1",
          initialPrincipalUserId: "setup-player-one",
          initialRoleKey: "vanilla_townie",
        },
        addedSlotId: "slot_extra",
        assignedPrincipalUserId: "setup-extra-player",
        assignedRoleKey: "mafia_goon",
        initialSummary: "Ready to start",
        duplicateAddSlotRecovery: {
          status: "reject",
          statusText: "Reject InvalidTarget: invalid target",
          commandKind: "AddSlot",
          error: "InvalidTarget",
          retryable: false,
          command: {
            game: "77777777-7777-4777-8777-777777777777",
            slot: "slot_extra",
          },
          streamSeqs: [],
          readinessSummary: "Setup still needs attention",
          refreshedReadinessSummary: "Setup still needs attention",
          refreshedSlotCount: 2,
          duplicateSlotCountAfterReject: 1,
        },
        finalSummary: "Ready to start",
        finalStartAvailable: true,
        finalSlot: {
          slotId: "slot_extra",
          occupantUserId: "setup-extra-player",
          alive: true,
          status: "alive",
          statusTags: [],
          roleKey: "mafia_goon",
        },
        commands: {
          addSlot: {
            status: "ack",
            commandKind: "AddSlot",
            command: {
              game: "77777777-7777-4777-8777-777777777777",
              slot: "slot_extra",
            },
            streamSeqs: [5],
            readinessSummary: "Setup still needs attention",
          },
          assignSlot: {
            status: "ack",
            commandKind: "AssignSlot",
            command: {
              game: "77777777-7777-4777-8777-777777777777",
              slot: "slot_extra",
              user: "setup-extra-player",
            },
            streamSeqs: [6],
            readinessSummary: "Setup still needs attention",
          },
          assignRole: {
            status: "ack",
            commandKind: "AssignRole",
            command: {
              game: "77777777-7777-4777-8777-777777777777",
              slot: "slot_extra",
              role_key: "mafia_goon",
            },
            streamSeqs: [7],
            readinessSummary: "Ready to start",
          },
        },
      },
      readyCheckIds: [
        "game-created",
        "pack-valid",
        "slots-exist",
        "slots-occupied",
        "roles-assigned",
        "policy-acknowledged",
        "start-phase",
      ],
    },
    proofStability: {
      status: "passed",
      hostConfirmClicks: {
        total: 4,
        firstClickCount: 3,
        concurrentClickCount: 0,
        retryClickCount: 1,
        domFallbackCount: 0,
        forceFallbackCount: 0,
        failureCount: 0,
        maxAttempts: 2,
        byAction: { resolve_phase: 2, extend_deadline: 2 },
        byRole: { host: 2, cohost: 2 },
        events: [
          {
            actionId: "resolve_phase",
            roleLabel: "host",
            method: "playwright-retry",
            attempts: 2,
          },
        ],
      },
    },
    cohostConsole: {
      status: "passed",
      capabilityLabel: `CohostOf(${game})`,
      proof: "cohost opened the host console, extended deadline, and rejected host-only resolve",
      extendDeadline: {
        statusMessage: "Ack: stream seqs 41",
        commandStatus: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "cohost_c",
                command: {
                  ExtendDeadline: {
                    game,
                    phase: "D01",
                  },
                },
              },
            },
          },
        },
      },
      hostOnlyControlsVisible: false,
      hostOnlyResolveReject: {
        statusMessage: "Reject NotHost: not host",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "cohost_c",
              command: {
                ResolvePhase: {
                  game,
                  seed: 918273,
                },
              },
            },
          },
        },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "NotHost",
              message: "not host",
              retryable: false,
            },
          },
        },
      },
      phaseAfterReject: {
        id: "D01",
        locked: false,
      },
    },
    coreLoop: {
      status: "passed",
      proof: "host locked D01 and player recovered from PhaseLocked",
      lock: { commandStatus: { state: "ack" } },
      lockedVoteControl: {
        exists: false,
        disabled: true,
        reason: "control absent",
        text: "",
      },
      rejectedVote: { error: "PhaseLocked", message: "Reject PhaseLocked: phase locked" },
      staleVoteBrowserProof: {
        roleUrl: `/g/${game}/player-goon-a`,
        receipt: {
          actionId: "submit_vote",
          state: "reject",
          commandTrace: { projectionRefreshKeys: ["votecount", "commandState"] },
        },
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale vote state, refresh and use current controls",
        commandStateBeforeClose: {
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        },
        commandStateAfterReject: {
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        },
        voteControlAfterReject: { exists: false, disabled: true },
        votecountUnchanged: true,
      },
      unlock: { commandStatus: { state: "ack" } },
    },
    dayVoteResolution: {
      status: "passed",
      proof: "action-player cast the majority day vote and host resolved the lynch",
      voterBeforeVote: {
        currentVote: null,
        voteTargets: [
          { kind: "slot", slotId: "slot-2", label: "Slot 2" },
          { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          { kind: "no_lynch", slotId: null, label: "No lynch" },
        ],
      },
      voterCurrentVoteBefore: {
        hasVote: "false",
        text: "Current vote No current vote",
      },
      voterWithdrawBefore: {
        exists: true,
        disabled: true,
        reason: "No current vote",
        text: "Withdraw vote",
      },
      voterVoteButtons: [
        { action: "submit_vote", text: "Vote Slot 2", disabled: false },
        {
          action: "submit_vote:slot-3",
          text: "Vote Slot 3",
          disabled: false,
        },
        {
          action: "submit_vote:no_lynch",
          text: "Vote no lynch",
          disabled: false,
        },
      ],
      finalVote: {
        state: "ack",
        requestEnvelope: {
          body: {
            body: {
              command: {
                SubmitVote: {
                  game,
                  actor_slot: "slot_4",
                  target: { Slot: "slot-2" },
                },
              },
            },
          },
        },
      },
      voterAfterVote: {
        currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
      },
      voterCurrentVoteAfter: {
        hasVote: "true",
        text: "Current vote Slot 2",
      },
      voterWithdrawAfter: {
        exists: true,
        disabled: false,
        reason: "",
        text: "Withdraw vote",
      },
      voterVotecountAfterVote: [{ target: "slot-2", count: 4 }],
      resolveDay: { commandStatus: { state: "ack" } },
      hostAfterResolve: {
        dayVoteOutcomes: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        outcomePanel: "D01 Lynch\nSlot 2 was eliminated by official vote.",
        outcomeTally: "Slot 2\n4/3",
      },
      dayVoteOutcome: {
        phase_id: "D01",
        status: "Lynch",
        winner_slot: "slot-2",
        tallies: { "slot-2": 4 },
      },
      hostSlot: { slot_id: "slot-2", alive: false, status: "dead" },
      targetCommandState: {
        actorSlot: "slot-2",
        actorAlive: false,
        actorStatus: "dead",
      },
      targetNotice: {
        audience_slot: "slot-2",
        effect: "player_killed",
        status: "day_vote",
      },
      targetControls: {
        vote: { exists: false, disabled: true, reason: "control absent", text: "" },
        withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
        post: { exists: true, disabled: true, reason: "", text: "Post" },
      },
      targetDayVoteOutcomes: [
        { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
      ],
      targetOutcomePanel: "D01 Lynch\nSlot 2 was eliminated by official vote.",
      targetOutcomeTally: "Slot 2\n4/3",
    },
    dayVoteNoLynch: {
      status: "passed",
      proof: "two player role URLs clicked no-lynch and host resolved without a death",
      miraNoLynchVote: {
        state: "ack",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "player-mira",
              command: {
                SubmitVote: {
                  target: "NoLynch",
                },
              },
            },
          },
        },
      },
      miraVotecountAfterVote: [{ target: "no_lynch", count: 1 }],
      seedNoLynchVote: {
        state: "ack",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "player-seed",
              command: {
                SubmitVote: {
                  target: "NoLynch",
                },
              },
            },
          },
        },
      },
      seedVotecountAfterVote: [{ target: "no_lynch", count: 2 }],
      resolveDay: { commandStatus: { state: "ack" } },
      hostAfterResolve: {
        dayVoteOutcomes: [
          { phaseId: "D01", status: "NoLynch", winnerSlot: null },
        ],
        outcomePanel: "D01 NoLynch\nThe official vote resolved without an elimination.",
        outcomeTally: "No lynch\n2/2",
      },
      dayVoteOutcome: {
        phase_id: "D01",
        status: "NoLynch",
        winner_slot: null,
        tallies: { no_lynch: 2 },
      },
      survivorSlot: { slot_id: "slot_3", alive: true, status: "alive" },
      survivorCommandState: {
        actorSlot: "slot_3",
        actorAlive: true,
        actorStatus: "alive",
      },
      survivorNotifications: [],
      survivorDayVoteOutcomes: [
        { phaseId: "D01", status: "NoLynch", winnerSlot: null },
      ],
      survivorOutcomePanel:
        "D01 NoLynch\nThe official vote resolved without an elimination.",
      survivorOutcomeTally: "No lynch\n2/2",
    },
    actionLoop: {
      status: "passed",
      proof: "host resolved N01 and action player advanced to D02",
      invalidAction: {
        error: "InvalidTarget",
        message: playerInvalidActionRecoveryMessage,
      },
      legalAction: { state: "ack", message: "Ack: stream seqs 42" },
      dayNightTransition: {
        status: "passed",
        hostRoleUrl: `/g/${game}/host`,
        actionRoleUrl: `/g/${game}/player-goon-a`,
        normalPlayerRoleUrl: `/g/${game}/player-villager-a`,
        resolveDayState: "ack",
        advanceNightState: "ack",
        dayLockedActionSurface: {
          commandState: {
            actorSlot: "slot_4",
            phase: { phaseId: "D01", locked: true },
            actions: [],
          },
          buttons: [],
        },
        nightActionSurface: {
          commandState: {
            actorSlot: "slot_4",
            phase: { phaseId: "N01", locked: false },
            actions: [{ templateId: "factional_kill" }],
          },
          buttons: [
            { action: "submit_action:factional_kill", disabled: false },
            { action: "submit_invalid_action:factional_kill", disabled: false },
          ],
        },
        normalPlayerNightSurface: {
          phase: { phaseId: "N01", locked: false },
          commandActions: [],
          factionalKillVisible: false,
          directRejectError: "InvalidTarget",
        },
      },
      nightResolutionTransition: {
        status: "passed",
        hostRoleUrl: `/g/${game}/host`,
        actionRoleUrl: `/g/${game}/player-goon-a`,
        targetRoleUrl: `/g/${game}/player-target-a`,
        normalPlayerRoleUrl: `/g/${game}/player-villager-a`,
        legalActionState: "ack",
        legalActionTemplateId: "factional_kill",
        legalActionTarget: "slot-2",
        resolveNightState: "ack",
        resolvedTargetSlot: {
          slot_id: "slot-2",
          alive: false,
          status: "dead",
        },
        targetReceiptSurface: {
          targetNotice: {
            audience_slot: "slot-2",
            effect: "player_killed",
            status: "factional_kill",
          },
          targetPrivateQueueItem: { effect: "player_killed" },
          targetCommandState: {
            actorSlot: "slot-2",
            actorAlive: false,
            actorStatus: "dead",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
        },
        advanceDayState: "ack",
        d02ActionSurface: {
          commandState: {
            actorSlot: "slot_4",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
          buttons: [{ action: "submit_vote:slot-2", disabled: false }],
        },
        d02NormalPlayerSurface: {
          commandState: {
            actorSlot: "slot-7",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
          buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
        },
      },
      d02VoteNightTransition: {
        status: "passed",
        game: `${game}-d02-vote`,
        hostRoleUrl: `/g/${game}-d02-vote/host`,
        actionRoleUrl: `/g/${game}-d02-vote/player-goon-a`,
        playerRoleUrl: `/g/${game}-d02-vote/player-villager-a`,
        targetRoleUrl: `/g/${game}-d02-vote/player-target-a`,
        hostBeforeVote: { phase: { id: "D02", locked: false } },
        actionBeforeVote: {
          commandState: {
            actorSlot: "slot_4",
            currentVote: null,
          },
          buttons: [{ action: "submit_vote:slot-2", disabled: false }],
        },
        voteTarget: { slotId: "slot-2" },
        finalVote: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    actor_slot: "slot_4",
                    target: { Slot: "slot-2" },
                  },
                },
              },
            },
          },
        },
        apiVoteRow: { phaseId: "D02", target: "slot-2", count: 3 },
        resolveD02: { commandStatus: { state: "ack" } },
        hostAfterResolve: { phase: { id: "D02", locked: true } },
        dayVoteOutcome: {
          phaseId: "D02",
          status: "Lynch",
          winnerSlot: "slot-2",
          tallies: { "slot-2": 3 },
        },
        hostSlotAfterResolve: { alive: false, status: "dead" },
        targetReceiptSurface: {
          targetNotice: {
            audience_slot: "slot-2",
            effect: "player_killed",
            status: "day_vote",
          },
          targetCommandState: {
            actorAlive: false,
            actorStatus: "dead",
          },
        },
        advanceN02: { commandStatus: { state: "ack" } },
        n02HostSurface: { phase: { id: "N02", locked: false } },
        n02ActionSurface: {
          commandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            phase: { phaseId: "N02", locked: false },
            actions: [{ templateId: "factional_kill", targets: ["slot-3"] }],
          },
          buttons: [{ action: "submit_action:factional_kill", disabled: false }],
        },
        n02NormalPlayerSurface: {
          commandState: {
            actorSlot: "slot-7",
            phase: { phaseId: "N02", locked: false },
          },
          factionalKillVisible: false,
        },
        staleD02VoteTransitionSetup: {
          commandState: { phase: { phaseId: "D02", locked: false } },
          voteButton: { action: "submit_vote", disabled: false },
          closedStatus: { state: "closed" },
        },
        staleD02VoteAfterTransition: {
          status: "passed",
          reject: {
            state: "reject",
            error: "PhaseLocked",
            message:
              "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
          },
          dispatchPlan: {
            projectionRefreshKeys: [
              "votecount",
              "commandState",
              "dayVoteOutcomes",
            ],
          },
          commandStateAfterReject: {
            phase: { phaseId: "N02", locked: false },
          },
          buttonsAfterReject: [
            { action: "submit_action:factional_kill", disabled: false },
          ],
          receiptStatusText:
            "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
        },
        n02ActionTarget: "slot-3",
        n02ActionSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                    targets: ["slot-3"],
                  },
                },
              },
            },
          },
        },
        n02ActionAfterSubmit: {
          buttons: [],
        },
        resolveN02: { commandStatus: { state: "ack" } },
        hostAfterResolveN02: { phase: { id: "N02", locked: true } },
        n02ResolvedTargetSlot: {
          slot_id: "slot-3",
          alive: false,
          status: "dead",
        },
        advanceD03: { commandStatus: { state: "ack" } },
        d03ActionSurface: {
          commandState: {
            phase: { phaseId: "D03", locked: false },
          },
          buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
        },
        d03NormalPlayerSurface: {
          commandState: {
            phase: { phaseId: "D03", locked: false },
            actorSlot: "slot-7",
            voteTargets: [{ kind: "slot", slotId: "slot_4", label: "Slot 4" }],
          },
          buttons: [
            { action: "submit_vote:slot_4", text: "Vote Slot 4", disabled: false },
            { action: "submit_vote:no_lynch", disabled: false },
          ],
        },
        d03TerminalVoteTarget: {
          kind: "slot",
          slotId: "slot_4",
          label: "Slot 4",
        },
        d03TerminalVoteButton: {
          action: "submit_vote:slot_4",
          text: "Vote Slot 4",
          disabled: false,
        },
        d03TerminalVoteSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-mira",
                command: {
                  SubmitVote: {
                    actor_slot: "slot-7",
                    target: { Slot: "slot_4" },
                  },
                },
              },
            },
          },
        },
        d03TerminalPlayerAfterVote: {
          commandState: {
            currentVote: { kind: "slot", slotId: "slot_4" },
          },
          currentVote: { hasVote: "true" },
          votecount: [{ target: "slot_4", count: 1 }],
        },
        d03TerminalApiVoteRow: {
          phaseId: "D03",
          target: "slot_4",
          count: 1,
        },
        resolveD03: { commandStatus: { state: "ack" } },
        hostAfterResolveD03: {
          phase: { id: "D03", locked: true },
          phaseActions: ["advance_phase"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "pending",
            },
          ],
          promptActions: [
            "resolve_host_prompt-D03-revote-NoMajority-no_majority_continue_revote",
            "resolve_host_prompt-D03-revote-NoMajority-no_majority_no_lynch",
          ],
          slots: [{ slot_id: "slot_4", alive: true, status: "alive" }],
        },
        d03RevotePrompt: {
          id: "D03:revote:NoMajority",
          label: "revote",
          value: "no_majority",
          status: "pending",
        },
        d03RevotePromptActionId:
          "resolve_host_prompt-D03-revote-NoMajority-no_majority_continue_revote",
        d03TerminalDayVoteOutcome: {
          phaseId: "D03",
          status: "NoMajority",
          winnerSlot: null,
          tallies: { slot_4: 1 },
        },
        d03TerminalResolvedSlot: {
          slot_id: "slot_4",
          alive: true,
          status: "alive",
        },
        d03TerminalAdvanceReject: {
          commandStatus: {
            state: "reject",
            error: "InvalidTarget",
            message:
              "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          },
        },
        hostAfterTerminalAdvanceReject: {
          phase: { id: "D03", locked: true },
          phaseActions: ["advance_phase", "unlock_thread"],
          slots: [{ slot_id: "slot_4", alive: true, status: "alive" }],
        },
        d03TerminalActivityStatusText:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        d03TerminalActivityRow: {
          source: "outcome",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        d03TerminalDispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        d03TerminalApiHostStateAfterReject: {
          phase: { id: "D03", locked: true },
        },
        d03TerminalHostReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          phase: { id: "D03", locked: true },
          phaseActions: ["advance_phase", "unlock_thread"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "pending",
            },
          ],
          promptActions: [
            "resolve_host_prompt-D03-revote-NoMajority-no_majority_continue_revote",
            "resolve_host_prompt-D03-revote-NoMajority-no_majority_no_lynch",
          ],
          dayVoteOutcomes: [
            {
              phaseId: "D03",
              status: "NoMajority",
              winnerSlot: null,
              tallies: { slot_4: 1 },
            },
          ],
          outcomePanel: "D03 NoMajority\nNoMajority",
          apiPhase: { id: "D03", locked: true },
        },
        d03RevotePromptResolution: {
          commandStatus: {
            state: "ack",
            streamSeqs: [58, 59],
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    ResolveHostPrompt: {
                      prompt_id: "D03:revote:NoMajority",
                      decision: {
                        SelectPolicy: {
                          policy: "no_majority_continue_revote",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        hostAfterD03RevotePrompt: {
          phase: { id: "D03R1", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
          ],
          promptActions: [],
        },
        actionAfterD03RevotePrompt: {
          commandState: {
            voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
          },
          buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
        },
        normalAfterD03RevotePrompt: {
          buttons: [{ action: "submit_vote:slot_4", disabled: false }],
        },
        d03RevoteBallotTarget: {
          kind: "no_lynch",
          slotId: null,
          label: "No lynch",
        },
        d03RevoteNoLynchButton: {
          action: "submit_vote:no_lynch",
          disabled: false,
        },
        d03RevoteVoteSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-goon-a",
                command: {
                  SubmitVote: {
                    actor_slot: "slot_4",
                    target: "NoLynch",
                  },
                },
              },
            },
          },
        },
        d03RevoteActionAfterVote: {
          commandState: {
            phase: { phaseId: "D03R1", locked: false },
            currentVote: { kind: "no_lynch", slotId: null, label: "No lynch" },
          },
          currentVote: { hasVote: "true" },
          votecount: [{ phaseId: "D03R1", target: "no_lynch", count: 1 }],
        },
        d03RevoteApiNoLynchRow: {
          phaseId: "D03R1",
          target: "no_lynch",
          count: 1,
          needed: 2,
        },
        d03RevoteApiOriginalD03Row: {
          phaseId: "D03",
          target: "slot_4",
          count: 1,
          needed: 2,
        },
        d03RevoteApiStaleD03NoLynchRow: null,
        hostBeforeResolveD03R1: {
          phase: { id: "D03R1", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          votecount: [{ phaseId: "D03R1", target: "no_lynch", count: 1 }],
        },
        resolveD03R1: { commandStatus: { state: "ack" } },
        hostAfterResolveD03R1: {
          phase: { id: "D03R1", locked: true },
          phaseActions: ["advance_phase"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
            {
              id: "D03R1:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "pending",
            },
          ],
          promptActions: [
            "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote",
            "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_no_lynch",
          ],
          dayVoteOutcomes: [
            {
              phaseId: "D03R1",
              status: "NoMajority",
              winnerSlot: null,
              tallies: { no_lynch: 1 },
            },
          ],
          votecount: [{ phaseId: "D03R1", target: "no_lynch", count: 1 }],
          outcomePanel: "D03R1 NoMajority\nNoMajority",
        },
        d03R1DayVoteOutcome: {
          phaseId: "D03R1",
          status: "NoMajority",
          winnerSlot: null,
          tallies: { no_lynch: 1 },
        },
        d03R1RevotePrompt: {
          id: "D03R1:revote:NoMajority",
          label: "revote",
          value: "no_majority",
          status: "pending",
        },
        d03R1RevotePromptActionId:
          "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote",
        apiPromptsAfterResolveD03R1: [
          { id: "D03:revote:NoMajority", status: "resolved" },
          { id: "D03R1:revote:NoMajority", status: "pending" },
        ],
        d03R1RevotePromptResolution: {
          commandStatus: {
            state: "ack",
            streamSeqs: [60, 61],
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    ResolveHostPrompt: {
                      prompt_id: "D03R1:revote:NoMajority",
                      decision: {
                        SelectPolicy: {
                          policy: "no_majority_continue_revote",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        hostAfterD03R1RevotePrompt: {
          phase: { id: "D03R2", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
            {
              id: "D03R1:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
          ],
          promptActions: [],
        },
        actionAfterD03R1RevotePrompt: {
          commandState: {
            phase: { phaseId: "D03R2", locked: false },
          },
          buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
        },
        normalAfterD03R1RevotePrompt: {
          commandState: {
            phase: { phaseId: "D03R2", locked: false },
          },
          buttons: [{ action: "submit_vote:slot_4", disabled: false }],
        },
        apiPromptsAfterD03R1Revote: [
          { id: "D03:revote:NoMajority", status: "resolved" },
          { id: "D03R1:revote:NoMajority", status: "resolved" },
        ],
        d03R2RevoteBallotTarget: {
          kind: "no_lynch",
          slotId: null,
          label: "No lynch",
        },
        d03R2RevoteNoLynchButton: {
          action: "submit_vote:no_lynch",
          disabled: false,
        },
        d03R2RevoteVoteSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-goon-a",
                command: {
                  SubmitVote: {
                    actor_slot: "slot_4",
                    target: "NoLynch",
                  },
                },
              },
            },
          },
        },
        d03R2RevoteActionAfterVote: {
          commandState: {
            phase: { phaseId: "D03R2", locked: false },
            currentVote: { kind: "no_lynch", slotId: null, label: "No lynch" },
          },
          currentVote: { hasVote: "true" },
          votecount: [{ phaseId: "D03R2", target: "no_lynch", count: 1 }],
        },
        d03R2RevoteApiNoLynchRow: {
          phaseId: "D03R2",
          target: "no_lynch",
          count: 1,
          needed: 2,
        },
        d03R2RevoteApiOriginalD03Row: {
          phaseId: "D03",
          target: "slot_4",
          count: 1,
          needed: 2,
        },
        d03R2RevoteApiD03R1NoLynchRow: {
          phaseId: "D03R1",
          target: "no_lynch",
          count: 1,
          needed: 2,
        },
        d03R2RevoteApiStaleD03NoLynchRow: null,
        hostBeforeResolveD03R2: {
          phase: { id: "D03R2", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          votecount: [{ phaseId: "D03R2", target: "no_lynch", count: 1 }],
        },
        resolveD03R2: { commandStatus: { state: "ack" } },
        hostAfterResolveD03R2: {
          phase: { id: "D03R2", locked: true },
          phaseActions: ["advance_phase"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
            {
              id: "D03R1:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
            {
              id: "D03R2:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "pending",
            },
          ],
          promptActions: [
            "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
            "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch",
          ],
          dayVoteOutcomes: [
            {
              phaseId: "D03R2",
              status: "NoMajority",
              winnerSlot: null,
              tallies: { no_lynch: 1 },
            },
          ],
          votecount: [{ phaseId: "D03R2", target: "no_lynch", count: 1 }],
          outcomePanel: "D03R2 NoMajority\nNoMajority",
        },
        d03R2DayVoteOutcome: {
          phaseId: "D03R2",
          status: "NoMajority",
          winnerSlot: null,
          tallies: { no_lynch: 1 },
        },
        d03R2RevotePrompt: {
          id: "D03R2:revote:NoMajority",
          label: "revote",
          value: "no_majority",
          status: "pending",
        },
        d03R2RevotePromptActionId:
          "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch",
        d03R2StaleContinuePolicyActionId:
          "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
        apiPromptsAfterResolveD03R2: [
          { id: "D03:revote:NoMajority", status: "resolved" },
          { id: "D03R1:revote:NoMajority", status: "resolved" },
          { id: "D03R2:revote:NoMajority", status: "pending" },
        ],
        d03R2NoLynchPolicyResolution: {
          commandStatus: {
            state: "ack",
            streamSeqs: [64, 65],
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    ResolveHostPrompt: {
                      prompt_id: "D03R2:revote:NoMajority",
                      decision: {
                        SelectPolicy: {
                          policy: "no_majority_no_lynch",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        hostAfterD03R2NoLynchPolicy: {
          phase: { id: "N03", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          hostPrompts: [
            {
              id: "D03:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
            {
              id: "D03R1:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
            {
              id: "D03R2:revote:NoMajority",
              label: "revote",
              value: "no_majority",
              status: "resolved",
            },
          ],
          promptActions: [],
        },
        actionAfterD03R2NoLynchPolicy: {
          commandState: {
            phase: { phaseId: "N03", locked: false },
            actions: [
              {
                templateId: "factional_kill",
                targets: ["slot-7"],
              },
            ],
          },
          buttons: [{ action: "submit_action:factional_kill", disabled: false }],
        },
        normalAfterD03R2NoLynchPolicy: {
          commandState: {
            phase: { phaseId: "N03", locked: false },
          },
          buttons: [],
        },
        apiPromptsAfterD03R2NoLynchPolicy: [
          { id: "D03:revote:NoMajority", status: "resolved" },
          { id: "D03R1:revote:NoMajority", status: "resolved" },
          { id: "D03R2:revote:NoMajority", status: "resolved" },
        ],
        d03R2StaleContinuePolicySetup: {
          game,
          promptId: "D03R2:revote:NoMajority",
          promptActions: [
            "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
            "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch",
          ],
          prompts: [
            { id: "D03:revote:NoMajority", status: "resolved" },
            { id: "D03R1:revote:NoMajority", status: "resolved" },
            { id: "D03R2:revote:NoMajority", status: "pending" },
          ],
          closedStatus: { state: "closed" },
        },
        d03R2StaleContinuePolicyRecovery: {
          setup: {
            promptActions: [
              "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
              "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch",
            ],
          },
          reject: {
            state: "reject",
            error: "PromptAlreadyResolved",
            message: "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
            serverEnvelope: { body: { kind: "Reject" } },
          },
          commandOutcomes: [
            {
              actionId:
                "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
              state: "reject",
              error: "PromptAlreadyResolved",
            },
          ],
          promptsAfterReject: [
            { id: "D03:revote:NoMajority", status: "resolved" },
            { id: "D03R1:revote:NoMajority", status: "resolved" },
            { id: "D03R2:revote:NoMajority", status: "resolved" },
          ],
          promptActionsAfterReject: [],
          activityStatusText:
            "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
          activityRow: {
            source: "outcome",
            actionId:
              "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
            dispatchKind: "resolve_host_prompt",
          },
          dispatchPlan: {
            projectionRefreshKeys: ["hostPrompts"],
          },
          apiPromptsAfterReject: [
            { prompt_id: "D03:revote:NoMajority", status: "resolved" },
            { prompt_id: "D03R1:revote:NoMajority", status: "resolved" },
            { prompt_id: "D03R2:revote:NoMajority", status: "resolved" },
          ],
          staleHostPromptReloadAfterReject: {
            status: "passed",
            routeResponseStatus: 200,
            rejectReceiptStatusText:
              "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
            surfaceText: "Host console",
            promptsAfterReload: [
              { id: "D03:revote:NoMajority", status: "resolved" },
              { id: "D03R1:revote:NoMajority", status: "resolved" },
              { id: "D03R2:revote:NoMajority", status: "resolved" },
            ],
            phase: { id: "N03", locked: false },
            phaseActionsAfterReload: ["lock_thread", "resolve_phase"],
            promptActionsAfterReload: [],
            apiPromptsAfterReload: [
              { prompt_id: "D03:revote:NoMajority", status: "resolved" },
              { prompt_id: "D03R1:revote:NoMajority", status: "resolved" },
              { prompt_id: "D03R2:revote:NoMajority", status: "resolved" },
            ],
          },
        },
        n03ActionTarget: "slot-7",
        n03ActionSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-goon-a",
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                    targets: ["slot-7"],
                  },
                },
              },
            },
          },
        },
        n03ActionAfterSubmit: {
          commandState: {
            phase: { phaseId: "N03", locked: false },
          },
          buttons: [],
        },
        resolveN03: {
          commandStatus: { state: "ack" },
        },
        hostAfterResolveN03: {
          phase: { id: "N03", locked: true },
          phaseActions: ["advance_phase", "unlock_thread"],
        },
        n03ResolvedTargetSlot: {
          slot_id: "slot-7",
          alive: false,
          status: "dead",
        },
        advanceD04: {
          commandStatus: { state: "ack" },
        },
        d04ActionSurface: {
          commandState: {
            phase: { phaseId: "D04", locked: false },
          },
          buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
        },
        d04TargetSurface: {
          commandState: {
            actorAlive: false,
            phase: { phaseId: "D04", locked: false },
          },
          buttons: [],
        },
        d04NoLynchVoteSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    actor_slot: "slot_4",
                    target: "NoLynch",
                  },
                },
              },
            },
          },
        },
        d04ActionAfterNoLynchVote: {
          commandState: {
            phase: { phaseId: "D04", locked: false },
            currentVote: { kind: "no_lynch" },
          },
          votecount: [{ target: "no_lynch", count: 1 }],
        },
        d04NoLynchApiRow: {
          phaseId: "D04",
          target: "no_lynch",
          count: 1,
        },
        hostAfterResolveD04: {
          phase: { id: "D04", locked: true },
        },
        resolveD04: {
          commandStatus: { state: "ack" },
        },
        d04DayVoteOutcome: {
          status: "NoLynch",
          winnerSlot: null,
          tallies: { no_lynch: 1 },
        },
        advanceN04: {
          commandStatus: { state: "ack" },
        },
        n04ActionSurface: {
          commandState: {
            phase: { phaseId: "N04", locked: false },
            actions: [],
          },
          buttons: [],
        },
        n04NoActionState: {
          actionCount: 0,
          actionSubmitControls: 0,
        },
        n04DeadPlayerSurface: {
          buttons: [],
        },
        resolveN04: {
          commandStatus: { state: "ack" },
        },
        hostAfterResolveN04: {
          phase: { id: "N04", locked: true },
        },
        advanceD05: {
          commandStatus: { state: "ack" },
        },
        d05ActionSurface: {
          commandState: {
            phase: { phaseId: "D05", locked: false },
          },
          buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
        },
        d05DeadPlayerSurface: {
          buttons: [],
        },
        d05NoLynchVoteSubmission: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    actor_slot: "slot_4",
                    target: "NoLynch",
                  },
                },
              },
            },
          },
        },
        d05ActionAfterNoLynchVote: {
          commandState: {
            phase: { phaseId: "D05", locked: false },
            currentVote: { kind: "no_lynch" },
          },
          votecount: [{ target: "no_lynch", count: 1 }],
        },
        d05NoLynchApiRow: {
          phaseId: "D05",
          target: "no_lynch",
          count: 1,
        },
        hostAfterResolveD05: {
          phase: { id: "D05", locked: true },
        },
        resolveD05: {
          commandStatus: { state: "ack" },
        },
        d05DayVoteOutcome: {
          status: "NoLynch",
          winnerSlot: null,
          tallies: { no_lynch: 1 },
        },
        advanceN05: {
          commandStatus: { state: "ack" },
        },
        n05ActionSurface: {
          commandState: {
            phase: { phaseId: "N05", locked: false },
            actions: [],
          },
          buttons: [],
        },
      },
      staleActionConflict: {
        reject: { error: "PhaseLocked" },
      },
      deadlineAdvance: {
        status: "passed",
        phaseBeforeAdvance: {
          id: "D01",
          locked: true,
          deadline: 1781928000,
        },
        advance: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    AdvancePhaseByDeadline: {
                      game,
                      phase: "D01",
                      observed_at: 1781928001,
                    },
                  },
                },
              },
            },
          },
        },
        command: {
          game,
          phase: "D01",
          observed_at: 1781928001,
        },
        phaseAfterAdvance: { id: "N01", locked: false },
        apiPhaseAfterAdvance: {
          phase_id: "N01",
          locked: false,
          deadline: null,
        },
      },
      staleDeadlineAdvance: {
        status: "passed",
        actionId: "advance_phase_by_deadline",
        setup: {
          stalePhase: {
            id: "D01",
            locked: true,
            deadline: 1781928000,
          },
          visibleActions: [
            "unlock_thread",
            "advance_phase",
            "advance_phase_by_deadline",
          ],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
        },
        phaseAfterReject: { id: "N01", locked: false },
        visibleActionsAfterReject: ["resolve_phase", "lock_thread"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
        activityRow: {
          source: "outcome",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: {
          phase_id: "N01",
          locked: false,
          deadline: null,
        },
      },
      resolvedTargetSlot: { alive: false },
      d02Phase: { phaseId: "D02" },
      privateChannelInvalidActionRecovery: {
        status: "passed",
        laneId: privateChannelInvalidActionRecoveryScenario().laneId,
        channel: privateChannelInvalidActionRecoveryScenario().channelId,
        route: {
          responseStatus: 200,
        },
        reject: {
          state: "reject",
          error: privateChannelInvalidActionRecoveryScenario().commandError,
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot:
                      privateChannelInvalidActionRecoveryScenario().actorSlot,
                    template_id:
                      privateChannelInvalidActionRecoveryScenario()
                        .expectedActionTemplateId,
                    targets: [
                      privateChannelInvalidActionRecoveryScenario().actorSlot,
                    ],
                  },
                },
              },
            },
          },
        },
        afterRejectSnapshot: {
          channelContext: {
            channelId: privateChannelInvalidActionRecoveryScenario().channelId,
            actorSlot: privateChannelInvalidActionRecoveryScenario().actorSlot,
          },
          commandState: {
            phase: {
              phaseId: privateChannelInvalidActionRecoveryScenario()
                .expectedPhaseId,
            },
            actions: [
              {
                templateId:
                  privateChannelInvalidActionRecoveryScenario()
                    .expectedActionTemplateId,
              },
            ],
          },
        },
        currentReceipt: {
          actionId: privateChannelInvalidActionRecoveryScenario().clickedAction,
          state: "reject",
          commandTrace: {
            projectionRefreshKeys:
              privateChannelInvalidActionRecoveryScenario().expectedRefreshKeys,
          },
        },
        receiptStatusText:
          privateChannelInvalidActionRecoveryScenario().commandMessage,
        apiCommandStateAfterReject: {
          actions: [
            {
              template_id:
                privateChannelInvalidActionRecoveryScenario()
                  .expectedActionTemplateId,
            },
          ],
        },
        legalActionVisibleAfterReject: true,
        privateThreadPagerVisible: true,
      },
    },
    invalidActionRecovery: {
      status: "passed",
      proof: "invalid action receipt kept legal action available",
      reject: {
        state: "reject",
        error: "InvalidTarget",
        message: playerInvalidActionRecoveryMessage,
      },
      commandState: {
        phase: { phaseId: "N01" },
        actions: [{ templateId: "factional_kill" }],
      },
      legalActionVisible: true,
      currentReceipt: {
        actionId: "submit_invalid_action:factional_kill",
        state: "reject",
        message: playerInvalidActionRecoveryMessage,
        commandTrace: {
          projectionRefreshKeys: ["notifications", "investigationResults", "commandState"],
        },
      },
      receiptStatusText: playerInvalidActionRecoveryMessage,
    },
    resolutionReceipts: {
      status: "passed",
      proof: "target player saw death notice and other players did not",
      targetSlot: "slot-2",
      hostSlotReceipt: { slot_id: "slot-2", alive: false, status: "dead" },
      targetNotice: {
        audience_slot: "slot-2",
        effect: "player_killed",
        status: "factional_kill",
      },
      targetPrivateQueueItem: {
        audience_slot: "slot-2",
        effect: "player_killed",
        status: "factional_kill",
      },
      targetCommandState: { actorSlot: "slot-2", actions: [] },
      actionReceipt: {
        state: "ack",
        templateId: "factional_kill",
        target: "slot-2",
      },
      normalPlayerNoticeVisible: false,
      actionPlayerNoticeVisible: false,
    },
    deadPlayerRecovery: {
      status: "passed",
      proof: "dead player controls disabled and direct commands rejected",
      targetSlot: "slot-2",
      commandState: {
        actorSlot: "slot-2",
        actorAlive: false,
        actorStatus: "dead",
        phase: { phaseId: "D02" },
        actions: [],
      },
      channelContext: {
        actorSlot: "slot-2",
        actorAlive: "false",
        actorStatus: "dead",
        text: "Posting target Main thread as slot-2 (dead)",
      },
      disabledControls: {
        vote: { exists: false, disabled: true, reason: "control absent", text: "" },
        withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
        post: { exists: true, disabled: true, reason: "", text: "Post" },
      },
      actionControlCount: 0,
      directVote: {
        statusMessage: "Reject SlotNotAlive: slot not alive",
        requestEnvelope: { body: { body: { principal_user_id: "player-target" } } },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "SlotNotAlive",
              message: "slot not alive",
              retryable: false,
            },
          },
        },
      },
      directPost: {
        statusMessage: "Reject SlotNotAlive: slot not alive",
        requestEnvelope: { body: { body: { principal_user_id: "player-target" } } },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "SlotNotAlive",
              message: "slot not alive",
              retryable: false,
            },
          },
        },
      },
      directAction: {
        statusMessage: "Reject SlotNotAlive: slot not alive",
        requestEnvelope: { body: { body: { principal_user_id: "player-target" } } },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "SlotNotAlive",
              message: "slot not alive",
              retryable: false,
            },
          },
        },
      },
      commandStateAfterRejects: {
        actorSlot: "slot-2",
        actorAlive: false,
        actorStatus: "dead",
        actions: [],
      },
    },
    playerActionBoundary: {
      status: "passed",
      proof: "player did not see factional kill and direct command rejected",
      phase: { phaseId: "N01" },
      commandActions: [],
      factionalKillVisible: false,
      directFactionalKill: {
        statusMessage: "Reject InvalidTarget: invalid target",
        requestEnvelope: {
          body: {
            body: {
              principal_user_id: "player-mira",
              command: {
                SubmitAction: {
                  game,
                  template_id: "factional_kill",
                },
              },
            },
          },
        },
        serverEnvelope: {
          body: {
            kind: "Reject",
            body: {
              error: "InvalidTarget",
              message: "invalid target",
              retryable: false,
            },
          },
        },
      },
      phaseAfterReject: { phaseId: "N01" },
      actionVisibleAfterReject: false,
    },
    privateChannel: {
      status: "passed",
      proof: "player posted privately and denied player recovered",
      channel: "private:mafia_day_chat",
      allowed: {
        url: `/g/${game}/c/private%3Amafia_day_chat`,
        submitPost: { state: "ack", message: "Ack: stream seqs 43" },
      },
      denied: { status: 403, actionLabel: "Back to board" },
      stalePostAfterPhaseTransition: {
        status: "passed",
        laneId: coreLoopPrivateChannelStalePostLaneId,
        channel: "private:mafia_day_chat",
        postBody: "Stale private-channel post after D01 phase closure fixture.",
        stalePost: {
          state: "ack",
          message: "Ack: stream seqs 43",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                    body: "Stale private-channel post after D01 phase closure fixture.",
                  },
                },
              },
            },
          },
          serverEnvelope: { body: { kind: "Ack" } },
        },
        receiptStatusText: "Ack: stream seqs 43",
        commandStateAfterAck: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "thread",
            "votecount",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        projectedPost: {
          body: "Stale private-channel post after D01 phase closure fixture.",
        },
        apiThreadAfterAck: {
          posts: [
            {
              body:
                "Stale private-channel post after D01 phase closure fixture.",
            },
          ],
        },
        submitPostAckProof: {
          status: "passed",
          clickedAction: "submit_post",
          commandKind: "SubmitPost",
          command: {
            game,
            channel_id: "private:mafia_day_chat",
            actor_slot: "slot-7",
            body: "Stale private-channel post after D01 phase closure fixture.",
          },
          commandStatus: {
            state: "ack",
            message: "Ack: stream seqs 43",
          },
          bridgePlan: {
            role: "player",
            commandKind: "SubmitPost",
            commandEndpoint: "/commands",
            finalState: "ack",
            projectionRefreshKeys: [
              "thread",
              "votecount",
              "commandState",
              "dayVoteOutcomes",
            ],
          },
          receipts: [
            {
              actionId: "submit_post",
              state: "ack",
            },
          ],
          projectionThread: {
            posts: [
              {
                body:
                  "Stale private-channel post after D01 phase closure fixture.",
              },
            ],
          },
          privatePostBody:
            "Stale private-channel post after D01 phase closure fixture.",
          receiptCount: 1,
          receiptStatusText: "Ack: stream seqs 43",
          receiptRefreshKeys:
            "thread,votecount,commandState,dayVoteOutcomes",
        },
      },
      completedGameRecovery: {
        status: "passed",
        laneId: coreLoopPrivateChannelCompletedPostLaneId,
        channel: "private:mafia_day_chat",
        postBody: "Completed private-channel stale post fixture.",
        closedStatus: { state: "closed" },
        complete: {
          commandStatus: {
            state: "ack",
          },
        },
        reject: {
          state: "reject",
          error: "GameAlreadyCompleted",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                    body: "Completed private-channel stale post fixture.",
                  },
                },
              },
            },
          },
        },
        receiptStatusText: "Reject GameAlreadyCompleted: game already completed",
        commandStateAfterReject: {
          gameCompleted: true,
          actions: [],
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["commandState"],
        },
        apiThreadPostBodies: [],
        reloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          recoveredCommandState: { gameCompleted: true },
          reloadChannelContext: {
            channelId: "private:mafia_day_chat",
          },
          reloadButtons: [
            { action: "submit_post", disabled: true },
          ],
          reloadRejectedPostVisible: false,
          apiThreadPostBodiesAfterReload: [],
        },
        completedPostRejectProof: {
          status: "passed",
          clickedThroughFromRoleUrl: true,
          rawInviteTokensVisible: false,
          sourceRoleUrl:
            `http://127.0.0.1:5173/g/${game}/c/private%3Amafia_day_chat`,
          visitedRolePath: `/g/${game}/c/private%3Amafia_day_chat`,
          clickedAction: "submit_post",
          commandKind: "SubmitPost",
          command: {
            game,
            channel_id: "private:mafia_day_chat",
            actor_slot: "slot-7",
            body: "Completed private-channel stale post fixture.",
          },
          commandStatus: {
            state: "reject",
            error: "GameAlreadyCompleted",
            message: "Reject GameAlreadyCompleted: game already completed",
          },
          bridgePlan: {
            role: "player",
            commandKind: "SubmitPost",
            commandEndpoint: "/commands",
            finalState: "reject",
            projectionRefreshKeys: [
              "commandState",
            ],
          },
          receipts: [
            {
              actionId: "submit_post",
              state: "reject",
            },
          ],
          stalePrivatePostBody: "Completed private-channel stale post fixture.",
          submitDisabledBeforeReject: false,
          snapshotAfterReject: {
            checkpoint: {
              phaseId: "D01",
              phaseState: "open",
              actorSlot: "slot-7",
              actionState: "disabled:game complete",
              receiptState: "reject:GameAlreadyCompleted",
            },
            commandPanelChannelId: "private:mafia_day_chat",
            channelContext: {
              channelId: "private:mafia_day_chat",
              actorSlot: "slot-7",
              capabilityLabel: "ChannelMember(private:mafia_day_chat)",
              actorStatus: "alive",
            },
            commandState: {
              actorSlot: "slot-7",
              gameCompleted: true,
              actions: [],
              voteTargets: [],
              boundary:
                staleCompletedPrivatePostScenario().routeBoundary,
            },
            threadPostBodies: ["Completed private channel remains readable."],
            buttons: [
              { action: "withdraw_vote", disabled: true, reason: "" },
              { action: "submit_post", disabled: true, reason: "" },
            ],
            enabledMutatingButtons: [],
          },
          snapshotAfterReload: {
            checkpoint: {
              phaseId: "D01",
              phaseState: "open",
              actorSlot: "slot-7",
              actionState: "disabled:game complete",
              receiptState: "reject:GameAlreadyCompleted",
            },
            commandPanelChannelId: "private:mafia_day_chat",
            channelContext: {
              channelId: "private:mafia_day_chat",
              actorSlot: "slot-7",
              capabilityLabel: "ChannelMember(private:mafia_day_chat)",
              actorStatus: "alive",
            },
            commandState: {
              actorSlot: "slot-7",
              gameCompleted: true,
              actions: [],
              voteTargets: [],
              boundary:
                staleCompletedPrivatePostScenario().routeBoundary,
            },
            threadPostBodies: ["Completed private channel remains readable."],
            buttons: [
              { action: "withdraw_vote", disabled: true, reason: "" },
              { action: "submit_post", disabled: true, reason: "" },
            ],
            enabledMutatingButtons: [],
          },
          reloadedResyncSnapshotCommandState: {
            gameCompleted: true,
          },
          receiptStatusText:
            "Reject GameAlreadyCompleted: game already completed",
          receiptRefreshKeys: "commandState",
        },
      },
    },
    replacementConsole: {
      status: "passed",
      proof: "host processed replacement",
      hostIssuedInvite: {
        status: "passed",
        targetLabel: "Slot 7 / player-rowan",
        statusText: "Replacement invite issued",
        loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}&invite=replacement-${game}-fixture`,
        returnTo: `/g/${game}`,
        inviteTokenPrefix: `replacement-${game}-`,
        tokenPresent: true,
        session: {
          principalUserId: "player-rowan",
          credentialKind: "invite",
          token: `replacement-${game}-fixture`,
          inviteToken: `replacement-${game}-fixture`,
          loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}&invite=replacement-${game}-fixture`,
          directUrl: `http://127.0.0.1:4102/g/${game}`,
          returnTo: `/g/${game}`,
          expectedCapabilityKind: "SlotOccupant",
          globalCapabilities: [],
          issuedBy: {
            principalUserId: "host_h",
            capabilityKind: "HostOf",
            game,
            surface: "host-replacement-invite-panel",
          },
        },
      },
      pendingIncomingPlayer: {
        status: "passed",
        principalUserId: "player-rowan",
        capabilityKinds: [],
        capabilityLabel: `PendingReplacement(${game})`,
        routeStateText:
          "Replacement invite accepted. Slot authority is pending host replacement; refresh this role URL after the host processes the replacement.",
        commandState: {
          actorSlot: "slot-7",
          actorAlive: false,
          actorStatus: "pending_replacement",
          actions: [],
        },
        coldLoadEndpoints: {
          commandStateEndpoint: null,
        },
        controlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
      },
      redeemedInviteRecovery: {
        status: "passed",
        message: "Session or invite token is missing, expired, or revoked",
        prefilledInviteToken: true,
        sessionCookiePresent: false,
        stayedOnLogin: true,
      },
      replacementSessionRevocation: {
        status: "passed",
        revokedPrincipalUserId: "player-rowan",
        apiSessionStatus: 401,
        routeErrorStatus: 403,
        routeErrorActionHref: "/",
        playerSurfaceVisible: false,
        controlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
        sessionCookie: {
          httpOnly: true,
          sameSite: "Lax",
          secure: false,
          valuePrefix: "invite-session-",
        },
      },
      replacementSessionRefresh: {
        status: "passed",
        session: {
          principalUserId: "player-rowan",
          credentialKind: "session",
          token: `dev-test-card-${game}-replacement-session-refresh-token`,
          loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}`,
          directUrl: `http://127.0.0.1:4102/g/${game}`,
          returnTo: `/g/${game}`,
          expectedCapabilityKind: "SlotOccupant",
          globalCapabilities: [],
          capabilityKinds: [],
          issuedBy: {
            principalUserId: "root_admin",
            capabilityKind: "GlobalAdmin",
            surface: "/auth/session-grants",
          },
        },
        login: {
          prefilledSessionToken: false,
          submittedSessionToken: true,
          usedInviteToken: false,
          landedOnDirectUrl: true,
        },
        browserEntry: {
          principalUserId: "player-rowan",
          capabilityKinds: ["SlotOccupant", "ChannelMember"],
          cookie: { valuePrefix: "dev-test-card-" },
        },
        commandState: {
          actorSlot: "slot-7",
          actorAlive: true,
          actions: [],
        },
        capabilityLabel: "SlotOccupant or ChannelMember(main)",
        controlCounts: {
          primaryButtons: 3,
          actionButtons: 0,
        },
        postStatus: {
          state: "ack",
          message: "Ack: stream seqs 46",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    actor_slot: "slot-7",
                    body: "Replacement Rowan refreshed-session post from dev:test-game",
                  },
                },
              },
            },
          },
        },
        rowanProjectedPost: {
          authorSlot: "slot-7",
          body: "Replacement Rowan refreshed-session post from dev:test-game",
        },
        privateReceiptIsolation: {
          targetKillVisible: false,
          actionResultVisible: false,
          notificationCount: 0,
          investigationResultCount: 0,
        },
      },
      replacementStaleSessionAfterRefresh: {
        status: "passed",
        apiSessionStatus: 401,
        routeErrorStatus: 403,
        routeErrorActionHref: "/",
        playerSurfaceVisible: false,
        controlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
        staleCookie: {
          httpOnly: true,
          sameSite: "Lax",
          secure: false,
          valuePrefix: "invite-session-",
        },
        freshCredentialKind: "session",
        freshRoleUrlHasInvite: false,
      },
      replacementReconnectRecovery: {
        status: "passed",
        principalUserId: "player-rowan",
        actorSlot: "slot-7",
        reconnectingStatus: { state: "reconnecting" },
        reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
        recoveredSnapshotContainsPost: true,
        recoveredPostBody: "Replacement Rowan reconnect proof from dev:test-game",
        reconnectCommand: {
          principalUserId: "player-rowan",
          command: {
            SubmitPost: {
              actor_slot: "slot-7",
              body: "Replacement Rowan reconnect proof from dev:test-game",
            },
          },
          streamSeqs: [47],
        },
        recoveredCommandState: {
          actorSlot: "slot-7",
          actorAlive: true,
        },
      },
      invalidReplacementRecovery: {
        status: "passed",
        invalidReplacement: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-rowan",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Reject",
              body: {
                error: "InvalidTarget",
                message: "invalid target",
                retryable: false,
              },
            },
          },
        },
        reject: {
          error: "InvalidTarget",
          message: "invalid target",
          retryable: false,
        },
        activityStatusText:
          "Reject InvalidTarget: invalid target; replacement target is stale, refresh the host console and use the current slot occupant",
        activityRow: {
          source: "outcome",
          actionId: "process_replacement_invalid_target",
          dispatchKind: "process_replacement",
          statusKey: "process_replacement_invalid_target",
        },
        dispatchPlan: {
          finalState: "reject",
          projectionRefreshKeys: [],
        },
        hostProjectionAfterReject: {
          slotId: "slot-7",
          occupantLabel: "player-mira",
        },
        apiSlotAfterReject: {
          slot_id: "slot-7",
          occupant_user_id: "player-mira",
        },
        pendingAfterReject: {
          principalUserId: "player-rowan",
          capabilityKinds: [],
          capabilityLabel: `PendingReplacement(${game})`,
          commandState: {
            actorStatus: "pending_replacement",
          },
          coldLoadEndpoints: {
            commandStateEndpoint: null,
          },
          controlCounts: {
            primaryButtons: 0,
            actionButtons: 0,
          },
        },
      },
      processReplacement: {
        statusMessage: "Ack: stream seqs 44",
        commandStatus: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command_id: "replacement-command-id",
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Ack",
              body: {
                stream_seqs: [44],
              },
            },
          },
        },
      },
      projectedReplacement: {
        slotId: "slot-7",
        occupantLabel: "player-rowan",
        historyLabel: "Slot slot-7 history preserved",
      },
      apiSlot: {
        slot_id: "slot-7",
        occupant_user_id: "player-rowan",
      },
      replacementIdempotentRetry: {
        status: "passed",
        commandId: "replacement-command-id",
        originalStreamSeqs: [44],
        retryStreamSeqs: [44],
        sameStreamSeqs: true,
        retryReplacement: {
          state: "ack",
          message: "Ack: stream seqs 44",
          httpStatus: 200,
          requestEnvelope: {
            body: {
              body: {
                command_id: "replacement-command-id",
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Ack",
              body: {
                stream_seqs: [44],
              },
            },
          },
        },
        hostProjectionAfterRetry: {
          slotId: "slot-7",
          occupantLabel: "player-rowan",
          historyLabel: "Slot slot-7 history preserved",
        },
        apiSlotAfterRetry: {
          slot_id: "slot-7",
          occupant_user_id: "player-rowan",
        },
      },
      staleHostInviteRecovery: {
        status: "passed",
        beforeSubmit: {
          principalUserId: "player-mira",
          expectedOccupantUserId: "player-mira",
          slotId: "slot-7",
        },
        reject: {
          state: "reject",
          message: "Invite target is stale; slot-7 is currently occupied by player-rowan",
          urlRendered: false,
        },
        retry: {
          state: "ack",
          target: {
            principalUserId: "player-rowan",
            expectedOccupantUserId: "player-rowan",
            slotId: "slot-7",
          },
          message: "Player invite issued",
          loginUrl: `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}&invite=player-${game}-fixture`,
        },
      },
      staleOutgoingPlayer: {
        status: "passed",
        setup: {
          commandState: {
            actorSlot: "slot-7",
            actorAlive: true,
          },
          closedStatus: { state: "closed" },
        },
        reject: {
          error: "NotYourSlot",
          message:
            "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
        },
        recoveredCommandState: {
          actorSlot: "slot-7",
          actorAlive: false,
          actorStatus: "replaced",
          actions: [],
          boundary: "Reject NotYourSlot: not your slot; The current session no longer owns slot-7.",
        },
        contextState: {
          actorAlive: "false",
          actorStatus: "replaced",
          capabilityLabel: "No current SlotOccupant(slot-7)",
        },
        buttonsDisabled: true,
        commandReceipts: [
          {
            actionId: "submit_vote",
            current: true,
            message:
              "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
          },
        ],
        staleAction: {
          state: "reject",
          error: "NotYourSlot",
          message:
            "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot-7",
                    template_id: "factional_kill",
                  },
                },
              },
            },
          },
        },
        commandStateAfterStaleAction: {
          actorSlot: "slot-7",
          actorAlive: false,
          actorStatus: "replaced",
          actions: [],
        },
        actionControlCountAfterStaleAction: 0,
        buttonsDisabledAfterStaleAction: true,
      },
      staleReplacementAfterSuccess: {
        status: "passed",
        invalidReplacement: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "host_h",
                command: {
                  ProcessReplacement: {
                    game,
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
          serverEnvelope: {
            body: {
              kind: "Reject",
              body: {
                error: "InvalidTarget",
                message: "invalid target",
                retryable: false,
              },
            },
          },
        },
        reject: {
          error: "InvalidTarget",
          message: "invalid target",
          retryable: false,
        },
        activityStatusText:
          "Reject InvalidTarget: invalid target; replacement target is stale, refresh the host console and use the current slot occupant",
        activityRow: {
          source: "outcome",
          actionId: "process_replacement_stale_success",
          dispatchKind: "process_replacement",
          statusKey: "process_replacement_stale_success",
        },
        dispatchPlan: {
          finalState: "reject",
          projectionRefreshKeys: [],
        },
        hostProjectionAfterReject: {
          slotId: "slot-7",
          occupantLabel: "player-rowan",
        },
        apiSlotAfterReject: {
          slot_id: "slot-7",
          occupant_user_id: "player-rowan",
        },
        staleOutgoingPlayer: {
          recoveredCommandState: {
            actorStatus: "replaced",
          },
          buttonsDisabled: true,
        },
      },
      incomingPlayer: {
        status: "passed",
        browserEntry: {
          principalUserId: "player-rowan",
          capabilityKinds: ["SlotOccupant", "ChannelMember"],
        },
        commandState: {
          actorSlot: "slot-7",
          actorAlive: true,
          actions: [],
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        capabilityLabel: "SlotOccupant or ChannelMember(main)",
        stableHistoryVisible: true,
        postStatus: {
          state: "ack",
          message: "Ack: stream seqs 45",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    actor_slot: "slot-7",
                    body: "Replacement Rowan post from dev:test-game",
                  },
                },
              },
            },
          },
        },
        rowanProjectedPost: {
          authorSlot: "slot-7",
          body: "Replacement Rowan post from dev:test-game",
        },
        replacementVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        vote: {
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitVote: {
                    actor_slot: "slot-7",
                    target: { Slot: "slot-3" },
                  },
                },
              },
            },
          },
          serverEnvelope: { body: { kind: "Ack" } },
        },
        privateReceiptIsolation: {
          targetKillVisible: false,
          actionResultVisible: false,
          notificationCount: 0,
          investigationResultCount: 0,
        },
      },
      stalePrivateChannel: {
        status: "passed",
        channel: "private:mafia_day_chat",
        stalePost: {
          state: "reject",
          error: "NotYourSlot",
          message:
            "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-mira",
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterStalePost: {
          actorStatus: "replaced",
          actions: [],
        },
        staleControlCounts: {
          primaryButtons: 0,
          actionButtons: 0,
        },
        staleRoute: {
          status: 403,
          message:
            "Game game-a channel private:mafia_day_chat requires scoped channel capability.",
        },
        rowanRoute: {
          channelContextId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          capabilityLabel: "ChannelMember(private:mafia_day_chat)",
        },
        rowanPost: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                principal_user_id: "player-rowan",
                command: {
                  SubmitPost: {
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        stalePostBody: "Stale Mira private post after replacement",
        rowanPostBody: "Replacement Rowan private-channel post",
        apiThreadPostBodies: ["Replacement Rowan private-channel post"],
      },
      stalePrivateReceipts: {
        status: "passed",
        staleNotifications: {
          status: 403,
          body: {
            error: "NotAuthorized",
            message: "principal cannot read player notifications for this game",
          },
        },
        staleInvestigationResults: {
          status: 403,
          body: {
            error: "NotAuthorized",
            message: "principal cannot read investigation results for this game",
          },
        },
        rowanNotifications: {
          status: 200,
          body: [],
        },
        rowanInvestigationResults: {
          status: 200,
          body: [],
        },
        rowanProjection: {
          notificationCount: 0,
          investigationResultCount: 0,
          targetKillVisible: false,
          actionResultVisible: false,
        },
        rowanQueue: {
          count: 0,
          emptyVisible: true,
          boundary:
            "Notifications and investigation results are loaded from principal-scoped endpoints only.",
        },
        staleRouteStillForbidden: true,
      },
    },
    multiplayerHardening: {
      status: "passed",
      proof: "duplicate command id returned one post and stale host control recovered",
      idempotentRetry: {
        channel: "main",
        firstPost: { state: "ack", streamSeqs: [44] },
        retryPost: { state: "ack", streamSeqs: [44], message: "Ack: stream seqs 44" },
        projectedPostCount: 1,
      },
      reconnect: {
        status: "passed",
        reconnectingStatus: { state: "reconnecting" },
        reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
        recoveredSnapshotContainsPost: true,
      },
      stalePlayerVote: {
        status: "passed",
        commandStateBeforeClose: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        voteControlBeforeClose: {
          exists: true,
          disabled: false,
          reason: "",
          text: "Vote Slot 3",
        },
        withdrawBeforeClose: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        reject: {
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
        },
        phaseAfterReject: { locked: true },
        commandStateAfterReject: {
          phase: { locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        voteControlAfterReject: {
          exists: false,
          disabled: true,
          reason: "control absent",
          text: "",
        },
        withdrawAfterReject: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        hostPhaseAfterUnlock: { locked: false },
      },
      stalePlayerVoteAfterChange: {
        status: "passed",
        commandStateBeforeClose: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        actionCommandStateBeforeChange: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot-7", label: "Slot 7" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        staleVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        closedStatus: { state: "closed" },
        actionVote: { state: "ack" },
        apiVotecountAfterActionVote: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
        ],
        staleVote: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    target: { Slot: "slot-3" },
                  },
                },
              },
            },
          },
        },
        commandStateAfterAck: {
          currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        },
        votecountAfterAck: [
          { target: "no_lynch", count: 1 },
          { target: "slot-3", count: 1 },
        ],
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterAck: {
          hasVote: "true",
          text: "Current vote Slot 3",
        },
        apiVotecountAfterAck: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 1 },
          },
        ],
        apiCommandStateAfterAck: {
          current_vote: { kind: "slot", slot_id: "slot-3", label: "Slot 3" },
        },
        withdrawPlayer: { state: "ack" },
        withdrawAction: { state: "ack" },
        apiVotecountAfterCleanup: [],
        apiCommandStateAfterCleanup: {
          current_vote: null,
        },
      },
      stalePlayerWithdrawAfterChange: {
        status: "passed",
        commandStateBeforeVote: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        staleVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        initialVote: { state: "ack" },
        commandStateBeforeClose: {
          currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 3",
        },
        withdrawBeforeClose: {
          exists: true,
          disabled: false,
          reason: "",
          text: "Withdraw vote",
        },
        closedStatus: { state: "closed" },
        liveChangeVote: { state: "ack" },
        apiCommandStateAfterLiveChange: {
          current_vote: { kind: "no_lynch", slot_id: null, label: "No lynch" },
        },
        apiVotecountAfterLiveChange: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
        ],
        staleWithdraw: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  WithdrawVote: {
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterWithdraw: {
          currentVote: null,
        },
        votecountAfterWithdraw: [],
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterWithdraw: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterAck: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        apiCommandStateAfterWithdraw: {
          current_vote: null,
        },
        apiVotecountAfterWithdraw: [],
      },
      stalePlayerWithdrawAfterPhaseClosure: {
        status: "passed",
        game: "phase-closure-game",
        hostEntry: {
          capabilityKinds: ["HostOf"],
        },
        playerEntry: {
          capabilityKinds: ["SlotOccupant"],
        },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          phase: { phaseId: "D01", locked: false },
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 2",
        },
        withdrawBeforeClose: {
          exists: true,
          disabled: false,
          reason: "",
          text: "Withdraw vote",
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostAfterResolve: {
          phase: { id: "D01", locked: true },
          dayVoteOutcomes: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
        },
        apiCommandStateAfterResolve: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        staleWithdraw: {
          state: "reject",
          error: "PhaseLocked",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  WithdrawVote: {
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterReject: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        buttonsAfterReject: [
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
          { action: "submit_post", disabled: false, text: "Post" },
        ],
        dayVoteOutcomesAfterReject: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterReject: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
      },
      stalePlayerVoteAfterPhaseClosure: {
        status: "passed",
        game: "phase-closure-vote-game",
        hostEntry: {
          capabilityKinds: ["HostOf"],
        },
        playerEntry: {
          capabilityKinds: ["SlotOccupant"],
        },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          phase: { phaseId: "D01", locked: false },
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "no_lynch", label: "No lynch" },
          ],
        },
        staleVoteTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote:slot-3",
          disabled: false,
          text: "Vote Slot 3",
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 2",
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostAfterResolve: {
          phase: { id: "D01", locked: true },
          dayVoteOutcomes: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
        },
        apiCommandStateAfterResolve: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        staleVote: {
          state: "reject",
          error: "PhaseLocked",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterReject: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        buttonsAfterReject: [
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
          { action: "submit_post", disabled: false, text: "Post" },
        ],
        dayVoteOutcomesAfterReject: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterReject: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
      },
      stalePlayerPostAfterPhaseClosure: {
        status: "passed",
        game: "phase-closure-post-game",
        postBody: "Stale player post after D01 phase closure",
        hostEntry: {
          capabilityKinds: ["HostOf"],
        },
        playerEntry: {
          capabilityKinds: ["SlotOccupant"],
        },
        commandStateBeforeClose: {
          actorSlot: "slot-7",
          phase: { phaseId: "D01", locked: false },
          currentVote: { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        },
        currentVoteBeforeClose: {
          hasVote: "true",
          text: "Current vote Slot 2",
        },
        submitPostBeforeClose: {
          action: "submit_post",
          disabled: false,
          text: "Post",
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostAfterResolve: {
          phase: { id: "D01", locked: true },
          dayVoteOutcomes: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
        },
        apiCommandStateAfterResolve: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        stalePost: {
          state: "ack",
          streamSeqs: [501],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    actor_slot: "slot-7",
                    channel_id: "main",
                    body: "Stale player post after D01 phase closure",
                  },
                },
              },
            },
          },
        },
        projectedPost: {
          body: "Stale player post after D01 phase closure",
          authorSlot: "slot-7",
        },
        commandStateAfterAck: {
          phase: { phaseId: "D01", locked: true },
          currentVote: null,
          voteTargets: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "thread",
            "votecount",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        currentVoteAfterAck: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        withdrawAfterAck: {
          exists: true,
          disabled: true,
          reason: "No current vote",
          text: "Withdraw vote",
        },
        buttonsAfterAck: [
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
          { action: "submit_post", disabled: false, text: "Post" },
        ],
        dayVoteOutcomesAfterAck: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterAck: {
          phase: { locked: true },
          current_vote: null,
          vote_targets: [],
        },
        apiThreadAfterAck: {
          posts: [
            {
              body: "Stale player post after D01 phase closure",
              author_slot: "slot-7",
            },
          ],
        },
      },
      staleDeadTargetVote: {
        status: "passed",
        commandStateBeforeClose: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        staleTarget: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        staleVoteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        currentVoteBeforeClose: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        closedStatus: { state: "closed" },
        markDead: { state: "ack", slot: "slot-3", status: "dead" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; vote target is no longer valid, refresh and use current vote controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandStateAfterReject: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        apiCommandStateAfterReject: {
          vote_targets: [
            { kind: "slot", slot_id: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slot_id: null, label: "No lynch" },
          ],
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        buttonsAfterReject: [
          { action: "submit_vote", disabled: false, text: "Vote Slot 4" },
          { action: "submit_vote:no_lynch", disabled: false, text: "Vote no lynch" },
          { action: "withdraw_vote", disabled: true, text: "Withdraw vote" },
        ],
        currentVoteAfterReject: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        restoreAlive: { state: "ack", slot: "slot-3", status: "alive" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
      },
      deadCurrentVote: {
        status: "passed",
        commandStateBeforeVote: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        target: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        voteButton: {
          action: "submit_vote",
          disabled: false,
          text: "Vote Slot 3",
        },
        vote: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    target: { Slot: "slot-3" },
                  },
                },
              },
            },
          },
        },
        commandStateAfterVote: {
          currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        },
        currentVoteAfterVote: {
          hasVote: "true",
          text: "Current vote Slot 3",
        },
        playerVotecountAfterVote: [{ target: "slot-3", count: 1 }],
        apiVotecountAfterVote: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 1 },
          },
        ],
        markDead: { state: "ack", slot: "slot-3", status: "dead" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        commandStateAfterDead: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        currentVoteAfterDead: {
          hasVote: "false",
          text: "Current vote No current vote",
        },
        playerVotecountAfterDead: [],
        hostVotecountAfterDead: [],
        apiCommandStateAfterDead: {
          current_vote: null,
          vote_targets: [
            { kind: "slot", slot_id: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slot_id: null, label: "No lynch" },
          ],
        },
        apiVotecountAfterDead: [],
        staleHostPublishAfterClear: {
          status: "passed",
          actionId: "publish_votecount",
          setup: {
            stalePhase: { id: "D02", locked: false },
            votecountRows: [{ target: "slot-3", count: 1 }],
            votecountActions: ["publish_votecount"],
            closedStatus: { state: "closed" },
            staleBody: "Official votecount for D02\n- slot-3: 1",
          },
          expectedBody: "Official votecount for D02\n\nNo active ballots.",
          staleBody: "Official votecount for D02\n- slot-3: 1",
          publish: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    PublishVotecount: { game },
                  },
                },
              },
            },
          },
          commandOutcomes: [
            {
              source: "outcome",
              actionId: "publish_votecount",
              state: "ack",
            },
          ],
          votecountActionsAfterPublish: ["publish_votecount"],
          activityStatusText: "Ack: stream seqs 45",
          activityRow: {
            source: "outcome",
            actionId: "publish_votecount",
            dispatchKind: "publish_votecount",
          },
          dispatchPlan: { projectionRefreshKeys: [] },
          apiExpectedPostCount: 1,
          apiStalePostCount: 0,
          playerExpectedPostCount: 1,
          playerStalePostCount: 0,
        },
        restoreAlive: { state: "ack", slot: "slot-3", status: "alive" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        commandStateAfterRestore: {
          currentVote: null,
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
      },
      concurrentVoteRace: {
        status: "passed",
        targetSlot: "slot-3",
        target: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        playerCommandStateBeforeVote: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot_4", label: "Slot 4" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        actionCommandStateBeforeVote: {
          voteTargets: [
            { kind: "slot", slotId: "slot-3", label: "Slot 3" },
            { kind: "slot", slotId: "slot-7", label: "Slot 7" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        playerVote: { state: "ack", streamSeqs: [45] },
        actionVote: { state: "ack", streamSeqs: [46] },
        apiProjection: { count: 2 },
        roleReloadAfterRace: {
          status: "passed",
          playerRouteStatus: 200,
          actionRouteStatus: 200,
          playerCommandState: {
            currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          },
          actionCommandState: {
            currentVote: { kind: "slot", slotId: "slot-3", label: "Slot 3" },
          },
          playerCurrentVote: { hasVote: "true", text: "Current vote: Slot 3" },
          actionCurrentVote: { hasVote: "true", text: "Current vote: Slot 3" },
          playerProjection: [{ target: "slot-3", count: 2 }],
          actionProjection: [{ target: "slot-3", count: 2 }],
          apiProjection: { count: 2 },
        },
      },
      concurrentPlayerVoteResolveRace: {
        status: "passed",
        game: "vote-resolve-race-game-a",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        setupCommandState: {
          actorSlot: "slot_4",
          phase: { phaseId: "D01", locked: false },
        },
        setupVoteButton: { action: "submit_vote:slot-2", disabled: false },
        setupHostPhase: { id: "D01", locked: false },
        setupHostPhaseActions: ["resolve_phase"],
        vote: {
          state: "ack",
          streamSeqs: [47],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    game: "vote-resolve-race-game-a",
                    actor_slot: "slot_4",
                    target: { Slot: "slot-2" },
                  },
                },
              },
            },
          },
        },
        resolve: {
          state: "ack",
          streamSeqs: [48, 49, 50],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ResolvePhase: { game: "vote-resolve-race-game-a", seed: 71004 },
                },
              },
            },
          },
        },
        voteSeq: 47,
        resolveSeq: 48,
        outcomeSummary: "vote seq 47 before resolve seq 48",
        commandStateAfterRace: {
          phase: { phaseId: "D01", locked: true },
          voteTargets: [],
        },
        buttonsAfterRace: [
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: false },
        ],
        hostPhaseAfterRace: { id: "D01", locked: true },
        hostDayVoteOutcomesAfterRace: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        playerDayVoteOutcomesAfterRace: [
          { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
        ],
        apiCommandStateAfterRace: {
          phase: { phase_id: "D01", locked: true },
          vote_targets: [],
        },
        apiDayVoteOutcomesAfterRace: [
          { phase_id: "D01", status: "Lynch", winner_slot: "slot-2" },
        ],
        roleReloadAfterRace: {
          status: "passed",
          playerRouteResponseStatus: 200,
          hostRouteResponseStatus: 200,
          commandStateAfterReload: {
            phase: { phaseId: "D01", locked: true },
            voteTargets: [],
          },
          buttonsAfterReload: [
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: false },
          ],
          hostPhaseAfterReload: { id: "D01", locked: true },
          hostDayVoteOutcomesAfterReload: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
          playerDayVoteOutcomesAfterReload: [
            { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
          ],
          apiCommandStateAfterReload: {
            phase: { phase_id: "D01", locked: true },
            vote_targets: [],
          },
          apiDayVoteOutcomesAfterReload: [
            { phase_id: "D01", status: "Lynch", winner_slot: "slot-2" },
          ],
        },
      },
      concurrentPlayerActionAdvanceRace: {
        status: "passed",
        game: "action-advance-race-game-a",
        hostEntry: { capabilityKinds: ["HostOf"] },
        actionEntry: { capabilityKinds: ["SlotOccupant"] },
        setupCommandState: {
          actorSlot: "slot_4",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        setupActionButton: {
          action: "submit_action:factional_kill",
          disabled: false,
        },
        setupHostPhase: { id: "N01", locked: false },
        setupHostPhaseActions: ["resolve_phase"],
        closedStatus: { state: "closed" },
        resolveNight: { commandStatus: { state: "ack" } },
        lockedHostPhase: { id: "N01", locked: true },
        lockedHostPhaseActions: ["advance_phase"],
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message: "Reject PhaseLocked",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    game: "action-advance-race-game-a",
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        advance: {
          state: "ack",
          streamSeqs: [52],
          serverEnvelope: { body: { kind: "Ack" } },
        },
        commandStateAfterRace: {
          actorSlot: "slot_4",
          phase: { phaseId: "D02", locked: false },
          actions: [],
        },
        buttonsAfterRace: [{ action: "submit_vote:no_lynch", disabled: false }],
        hostPhaseAfterRace: { id: "D02", locked: false },
        hostPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        apiCommandStateAfterRace: {
          actor_slot: "slot_4",
          phase: { phase_id: "D02", locked: false },
          actions: [],
        },
        apiHostStateAfterRace: { phase: { phase_id: "D02", locked: false } },
        roleReloadAfterRace: {
          status: "passed",
          actionRouteResponseStatus: 200,
          hostRouteResponseStatus: 200,
          commandStateAfterReload: {
            actorSlot: "slot_4",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
          buttonsAfterReload: [{ action: "submit_vote:no_lynch", disabled: false }],
          hostPhaseAfterReload: { id: "D02", locked: false },
          hostPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          apiCommandStateAfterReload: {
            actor_slot: "slot_4",
            phase: { phase_id: "D02", locked: false },
            actions: [],
          },
          apiHostStateAfterReload: { phase: { phase_id: "D02", locked: false } },
        },
      },
      concurrentCohostDeadlineResolveRace: {
        status: "passed",
        game: "deadline-resolve-race-game-a",
        deadlineAt: 1781928000,
        hostEntry: { capabilityKinds: ["HostOf"] },
        cohostEntry: { capabilityKinds: ["CohostOf"] },
        setupHostPhase: { id: "D01", locked: false },
        setupCohostPhase: { id: "D01", locked: false },
        setupHostPhaseActions: ["resolve_phase"],
        setupHostDeadlineActions: ["extend_deadline"],
        setupCohostPhaseActions: [],
        setupCohostDeadlineActions: ["extend_deadline"],
        resolve: {
          state: "ack",
          streamSeqs: [54, 55, 56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { ResolvePhase: { game: "deadline-resolve-race-game-a" } },
              },
            },
          },
        },
        deadline: {
          state: "ack",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ExtendDeadline: {
                    game: "deadline-resolve-race-game-a",
                    phase: "D01",
                    at: 1781928000,
                  },
                },
              },
            },
          },
        },
        deadlineSeq: 53,
        resolveSeq: 54,
        outcomeSummary: "deadline seq 53 before resolve seq 54",
        hostPhaseAfterRace: { id: "D01", locked: true, deadline: 1781928000 },
        cohostPhaseAfterRace: { id: "D01", locked: true, deadline: 1781928000 },
        hostPhaseActionsAfterRace: ["unlock_thread", "advance_phase"],
        cohostPhaseActionsAfterRace: [],
        hostDeadlineActionsAfterRace: ["extend_deadline"],
        cohostDeadlineActionsAfterRace: ["extend_deadline"],
        hostStateAfterRace: {
          phase: { phase_id: "D01", locked: true, deadline: 1781928000 },
        },
        cohostStateAfterRace: {
          phase: { phase_id: "D01", locked: true, deadline: 1781928000 },
        },
        roleReloadAfterRace: {
          status: "passed",
          expectedDeadline: 1781928000,
          hostRouteResponseStatus: 200,
          cohostRouteResponseStatus: 200,
          hostPhaseAfterReload: { id: "D01", locked: true, deadline: 1781928000 },
          cohostPhaseAfterReload: { id: "D01", locked: true, deadline: 1781928000 },
          hostPhaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          cohostPhaseActionsAfterReload: [],
          hostDeadlineActionsAfterReload: ["extend_deadline"],
          cohostDeadlineActionsAfterReload: ["extend_deadline"],
          hostApiPhaseAfterReload: {
            phase_id: "D01",
            locked: true,
            deadline: 1781928000,
          },
          cohostApiPhaseAfterReload: {
            phase_id: "D01",
            locked: true,
            deadline: 1781928000,
          },
        },
      },
      concurrentReplacementPrivatePostRace: {
        status: "passed",
        game: "replacement-private-post-race-game-a",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostReplacement: { occupantLabel: "player-mira" },
        setupCommandState: { actorSlot: "slot-7", actorStatus: "alive" },
        setupChannelContext: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot-7",
          actorStatus: "alive",
        },
        post: {
          state: "ack",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    game: "replacement-private-post-race-game-a",
                    channel_id: "private:mafia_day_chat",
                    actor_slot: "slot-7",
                  },
                },
              },
            },
          },
        },
        replacement: {
          state: "ack",
          streamSeqs: [54],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-private-post-race-game-a",
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        postSeq: 53,
        replacementSeq: 54,
        outcomeSummary: "private post seq 53 before replacement seq 54",
        commandStateAfterRace: { status: 403, error: "NotYourSlot" },
        buttonsAfterRace: [{ action: "submit_post", disabled: true }],
        hostReplacementAfterRace: { occupantLabel: "player-rowan" },
        apiSlotAfterRace: { occupant_user_id: "player-rowan" },
        staleRoute: {
          status: 403,
          responseStatus: 403,
          message: "Forbidden: requires scoped channel capability",
        },
        postBody: "Replacement race private post fixture.",
        apiThreadPostBodies: ["Replacement race private post fixture."],
      },
      concurrentReplacementVoteRace: {
        status: "passed",
        game: "replacement-vote-race-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostReplacement: { occupantLabel: "player-mira" },
        setupCommandState: {
          actorSlot: "slot-7",
          actorStatus: "alive",
          voteTargets: [{ kind: "slot", slotId: "slot-2" }],
        },
        setupButtons: [{ action: "submit_vote:slot-2", disabled: false }],
        vote: {
          state: "ack",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitVote: {
                    game: "replacement-vote-race-game-a",
                    actor_slot: "slot-7",
                    target: { Slot: "slot-2" },
                  },
                },
              },
            },
          },
        },
        replacement: {
          state: "ack",
          streamSeqs: [54],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-vote-race-game-a",
                    slot: "slot-7",
                    outgoing_user: "player-mira",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        voteSeq: 53,
        replacementSeq: 54,
        outcomeSummary: "vote seq 53 before replacement seq 54",
        commandStateAfterRace: { status: 403, error: "NotYourSlot" },
        hostReplacementAfterRace: { occupantLabel: "player-rowan" },
        apiSlotAfterRace: { occupant_user_id: "player-rowan" },
        apiVotecountAfterRace: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D01", candidate_slot: "slot-2", count: 1 },
          },
        ],
        targetVotecount: { phaseId: "D01", target: "slot-2", count: 1 },
      },
      concurrentReplacementActionRace: {
        status: "passed",
        game: "replacement-action-race-game-a",
        targetSlot: "slot-2",
        hostEntry: { capabilityKinds: ["HostOf"] },
        playerEntry: { capabilityKinds: ["SlotOccupant"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostPhase: { id: "N01", locked: false },
        setupSlot: { occupant_user_id: "player-goon-a" },
        setupCommandState: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [{ templateId: "factional_kill" }],
        },
        setupButtons: [{ action: "submit_action:factional_kill", disabled: false }],
        action: {
          state: "ack",
          streamSeqs: [55],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    game: "replacement-action-race-game-a",
                    action_id: "replacement_race_factional_kill",
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        replacement: {
          state: "ack",
          streamSeqs: [56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: "replacement-action-race-game-a",
                    slot: "slot_4",
                    outgoing_user: "player-goon-a",
                    incoming_user: "player-rowan",
                  },
                },
              },
            },
          },
        },
        actionSeq: 55,
        replacementSeq: 56,
        outcomeSummary: "action seq 55 before replacement seq 56",
        commandStateAfterRace: { status: 403, error: "NotYourSlot" },
        staleRetry: {
          state: "reject",
          error: "NotYourSlot",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        hostPhaseAfterRace: { id: "N01", locked: false },
        apiSlotAfterRace: { occupant_user_id: "player-rowan" },
        apiCurrentCommandStateStatus: { status: 200 },
        currentCommandStateAfterRace: {
          actor_slot: "slot_4",
          actor_status: "alive",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        currentRoleCommandState: {
          actorSlot: "slot_4",
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        currentRoleButtons: [],
      },
      replacementIncomingAction: {
        status: "passed",
        game: replacementIncomingActionCase.gameFixtureId,
        targetSlot: replacementIncomingActionCase.targetSlot,
        hostEntry: { capabilityKinds: ["HostOf"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        targetEntry: { capabilityKinds: ["SlotOccupant"] },
        setupHostPhase: { id: replacementIncomingActionCase.phaseId, locked: false },
        setupSlot: {
          occupant_user_id:
            replacementIncomingActionCase.staleOutgoingPrincipalUserId,
        },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: replacementIncomingActionCase.gameFixtureId,
                    slot: replacementIncomingActionCase.actorSlot,
                    outgoing_user:
                      replacementIncomingActionCase.staleOutgoingPrincipalUserId,
                    incoming_user:
                      replacementIncomingActionCase.replacementPrincipalUserId,
                  },
                },
              },
            },
          },
        },
        outgoingCommandStateAfterReplacement: {
          status: 403,
          error: replacementIncomingActionCase.staleOutgoingError,
        },
        currentCommandStateBeforeAction: {
          actorSlot: replacementIncomingActionCase.actorSlot,
          actorStatus: "alive",
          phase: { phaseId: replacementIncomingActionCase.phaseId, locked: false },
          actions: [{ templateId: replacementIncomingActionCase.templateId }],
        },
        currentButtonsBeforeAction: [
          { action: replacementIncomingActionCase.commandAction, disabled: false },
        ],
        action: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id:
                  replacementIncomingActionCase.replacementPrincipalUserId,
                command: {
                  SubmitAction: {
                    game: replacementIncomingActionCase.gameFixtureId,
                    action_id: replacementIncomingActionCase.actionId,
                    actor_slot: replacementIncomingActionCase.actorSlot,
                    template_id: replacementIncomingActionCase.templateId,
                    targets: [replacementIncomingActionCase.targetSlot],
                  },
                },
              },
            },
          },
        },
        currentCommandStateAfterAction: { actions: [] },
        currentButtonsAfterAction: [],
        apiCommandStateAfterAction: { actions: [] },
        resolveNight: { commandStatus: { state: "ack" } },
        hostPhaseAfterResolve: { id: replacementIncomingActionCase.phaseId, locked: true },
        targetSlotAfterResolve: {
          slot_id: replacementIncomingActionCase.targetSlot,
          alive: false,
          status: replacementIncomingActionCase.targetStatusAfterKill,
        },
        targetCommandState: {
          actorSlot: replacementIncomingActionCase.targetSlot,
          actorAlive: false,
          actorStatus: replacementIncomingActionCase.targetStatusAfterKill,
        },
        targetNotice: {
          audience_slot: replacementIncomingActionCase.targetSlot,
          effect: replacementIncomingActionCase.targetNoticeEffect,
          status: replacementIncomingActionCase.templateId,
        },
        replacementPrivateIsolation: {
          targetKillVisible: false,
          notificationCount: 0,
        },
        outcomeSummary: replacementIncomingActionCase.outcomeSummary,
      },
      replacementActionReconnect: {
        status: "passed",
        game: replacementActionReconnectCase.gameFixtureId,
        targetSlot: replacementActionReconnectCase.targetSlot,
        hostEntry: { capabilityKinds: ["HostOf"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        targetEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: replacementActionReconnectCase.gameFixtureId,
                    slot: replacementActionReconnectCase.actorSlot,
                    outgoing_user:
                      replacementActionReconnectCase.staleOutgoingPrincipalUserId,
                    incoming_user:
                      replacementActionReconnectCase.replacementPrincipalUserId,
                  },
                },
              },
            },
          },
        },
        commandStateBeforeAction: {
          actorSlot: replacementActionReconnectCase.actorSlot,
          actorStatus: "alive",
          phase: { phaseId: replacementActionReconnectCase.phaseId, locked: false },
          actions: [{ templateId: replacementActionReconnectCase.templateId }],
        },
        action: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id:
                  replacementActionReconnectCase.replacementPrincipalUserId,
                command: {
                  SubmitAction: {
                    game: replacementActionReconnectCase.gameFixtureId,
                    action_id: replacementActionReconnectCase.actionId,
                    actor_slot: replacementActionReconnectCase.actorSlot,
                    template_id: replacementActionReconnectCase.templateId,
                    targets: [replacementActionReconnectCase.targetSlot],
                  },
                },
              },
            },
          },
        },
        resolveNight: { commandStatus: { state: "ack" } },
        targetSlotAfterResolve: {
          slot_id: replacementActionReconnectCase.targetSlot,
          alive: false,
          status: replacementActionReconnectCase.targetStatusAfterKill,
        },
        targetCommandState: {
          actorSlot: replacementActionReconnectCase.targetSlot,
          actorAlive: false,
          actorStatus: replacementActionReconnectCase.targetStatusAfterKill,
        },
        targetNoticeBeforeReconnect: {
          audience_slot: replacementActionReconnectCase.targetSlot,
          effect: replacementActionReconnectCase.targetNoticeEffect,
          status: replacementActionReconnectCase.templateId,
        },
        reconnect: {
          status: "passed",
          principalUserId: replacementActionReconnectCase.replacementPrincipalUserId,
          actorSlot: replacementActionReconnectCase.actorSlot,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredSnapshotContainsPost: true,
          reconnectCommand: {
            principalUserId:
              replacementActionReconnectCase.replacementPrincipalUserId,
            command: {
              SubmitPost: {
                actor_slot: replacementActionReconnectCase.actorSlot,
                body:
                  `${replacementActionReconnectCase.reconnectPostBodyPrefix}fixture`,
              },
            },
            streamSeqs: [60],
          },
          recoveredCommandState: {
            actorSlot: replacementActionReconnectCase.actorSlot,
            actorAlive: true,
            actorStatus: "alive",
            phase: { phaseId: replacementActionReconnectCase.phaseId, locked: true },
            actions: [],
          },
        },
        commandStateAfterReconnect: {
          actorSlot: replacementActionReconnectCase.actorSlot,
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: replacementActionReconnectCase.phaseId, locked: true },
          actions: [],
        },
        buttonsAfterReconnect: [],
        rowanPrivateIsolationAfterReconnect: {
          targetKillVisible: false,
          notificationCount: 0,
        },
        targetNoticeAfterReconnect: {
          audience_slot: replacementActionReconnectCase.targetSlot,
          effect: replacementActionReconnectCase.targetNoticeEffect,
          status: replacementActionReconnectCase.templateId,
        },
        outcomeSummary: replacementActionReconnectCase.outcomeSummary,
      },
      replacementStaleActionAfterResolve: {
        status: "passed",
        game: replacementStaleActionAfterResolveCase.gameFixtureId,
        targetSlot: replacementStaleActionAfterResolveCase.targetSlot,
        hostEntry: { capabilityKinds: ["HostOf"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        targetEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: replacementStaleActionAfterResolveCase.gameFixtureId,
                    slot: replacementStaleActionAfterResolveCase.actorSlot,
                    outgoing_user:
                      replacementStaleActionAfterResolveCase
                        .staleOutgoingPrincipalUserId,
                    incoming_user:
                      replacementStaleActionAfterResolveCase
                        .replacementPrincipalUserId,
                  },
                },
              },
            },
          },
        },
        commandStateBeforeClose: {
          actorSlot: replacementStaleActionAfterResolveCase.actorSlot,
          actorStatus: "alive",
          phase: {
            phaseId: replacementStaleActionAfterResolveCase.phaseId,
            locked: false,
          },
          actions: [
            { templateId: replacementStaleActionAfterResolveCase.templateId },
          ],
        },
        buttonsBeforeClose: [
          {
            action: replacementStaleActionAfterResolveCase.commandAction,
            disabled: false,
          },
        ],
        actionButtonBeforeClose: {
          action: replacementStaleActionAfterResolveCase.commandAction,
          disabled: false,
        },
        closedStatus: { state: "closed" },
        resolveNight: { commandStatus: { state: "ack" } },
        hostPhaseAfterResolve: {
          id: replacementStaleActionAfterResolveCase.phaseId,
          locked: true,
        },
        hostPhaseActionsAfterResolve: ["advance_phase"],
        targetSlotAfterResolve: {
          slot_id: replacementStaleActionAfterResolveCase.targetSlot,
          alive: true,
          status: "alive",
        },
        reject: {
          state: "reject",
          error: replacementStaleActionAfterResolveCase.rejectionError,
          message:
            `${replacementStaleActionAfterResolveCase.rejectionStatusText}: phase locked; ${replacementStaleActionAfterResolveCase.staleActionStateMessageFragment}, refresh and use ${replacementStaleActionAfterResolveCase.currentActionControlsMessageFragment}`,
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: replacementStaleActionAfterResolveCase.actorSlot,
                    action_id:
                      replacementStaleActionAfterResolveCase.staleActionId,
                    template_id:
                      replacementStaleActionAfterResolveCase.templateId,
                    targets: [replacementStaleActionAfterResolveCase.targetSlot],
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          actorSlot: replacementStaleActionAfterResolveCase.actorSlot,
          actorAlive: true,
          actorStatus: "alive",
          phase: {
            phaseId: replacementStaleActionAfterResolveCase.phaseId,
            locked: true,
          },
          actions: [],
        },
        buttonsAfterReject: [],
        dispatchPlan: {
          projectionRefreshKeys: ["notifications", "investigationResults", "commandState"],
        },
        currentReceipt: {
          actionId: replacementStaleActionAfterResolveCase.commandAction,
          state: "reject",
          commandTrace: { projectionRefreshKeys: ["commandState"] },
        },
        receiptStatusText:
          `${replacementStaleActionAfterResolveCase.rejectionStatusText}: phase locked; ${replacementStaleActionAfterResolveCase.staleActionStateMessageFragment}, refresh and use ${replacementStaleActionAfterResolveCase.currentActionControlsMessageFragment}`,
        apiCommandStateAfterReject: {
          actor_slot: replacementStaleActionAfterResolveCase.actorSlot,
          actor_alive: true,
          actor_status: "alive",
          phase: {
            phase_id: replacementStaleActionAfterResolveCase.phaseId,
            locked: true,
          },
          actions: [],
        },
        targetSlotAfterReject: {
          slot_id: replacementStaleActionAfterResolveCase.targetSlot,
          alive: true,
          status: "alive",
        },
        rowanPrivateIsolationAfterReject: {
          targetKillVisible: false,
          notificationCount: 0,
        },
        targetCommandStateAfterReject: {
          actorSlot: replacementStaleActionAfterResolveCase.targetSlot,
          actorAlive: true,
          actorStatus: "alive",
          phase: {
            phaseId: replacementStaleActionAfterResolveCase.phaseId,
            locked: true,
          },
          actions: [],
        },
        targetNoticeAfterReject: null,
        outcomeSummary: replacementStaleActionAfterResolveCase.outcomeSummary,
      },
      replacementStalePrivatePostAfterResolve: {
        status: "passed",
        game: replacementResolvedPrivatePost.gameFixtureId,
        channel: replacementResolvedPrivatePost.channelId,
        hostEntry: { capabilityKinds: ["HostOf"] },
        staleOutgoingEntry: { capabilityKinds: ["SlotOccupant"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: replacementResolvedPrivatePost.gameFixtureId,
                    slot: replacementResolvedPrivatePost.actorSlot,
                    outgoing_user:
                      replacementResolvedPrivatePost.staleOutgoingPrincipalUserId,
                    incoming_user:
                      replacementResolvedPrivatePost.replacementPrincipalUserId,
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterProcess: {
          occupantLabel: replacementResolvedPrivatePost.replacementOccupantLabel,
        },
        commandStateBeforeClose: {
          actorSlot: replacementResolvedPrivatePost.actorSlot,
          actorStatus: "alive",
          phase: { phaseId: "D01", locked: false },
        },
        channelContextBeforeClose: {
          channelId: replacementResolvedPrivatePost.channelId,
          actorSlot: replacementResolvedPrivatePost.actorSlot,
          actorStatus: "alive",
          capabilityLabel:
            `ChannelMember(${replacementResolvedPrivatePost.channelId})`,
        },
        submitPostBeforeClose: {
          action: replacementResolvedPrivatePost.commandAction,
          disabled: false,
        },
        closedStatus: { state: "closed" },
        resolveDay: { commandStatus: { state: "ack" } },
        hostPhaseAfterResolve: { id: "D01", locked: true },
        apiCommandStateAfterResolve: {
          actor_slot: replacementResolvedPrivatePost.actorSlot,
          phase: { phase_id: "D01", locked: true },
        },
        postBody: replacementResolvedPrivatePost.fixturePostBody,
        stalePost: {
          state: "ack",
          streamSeqs: [replacementResolvedPrivatePost.postAckSeq],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id:
                  replacementResolvedPrivatePost.replacementPrincipalUserId,
                command: {
                  SubmitPost: {
                    channel_id: replacementResolvedPrivatePost.channelId,
                    actor_slot: replacementResolvedPrivatePost.actorSlot,
                    body: replacementResolvedPrivatePost.fixturePostBody,
                  },
                },
              },
            },
          },
        },
        dispatchPlan: { projectionRefreshKeys: ["thread", "commandState"] },
        currentReceipt: {
          actionId: replacementResolvedPrivatePost.commandAction,
          state: "ack",
        },
        commandStateAfterAck: {
          actorSlot: replacementResolvedPrivatePost.actorSlot,
          actorStatus: "alive",
          phase: { phaseId: "D01", locked: true },
          voteTargets: [],
        },
        channelContextAfterAck: {
          channelId: replacementResolvedPrivatePost.channelId,
          actorSlot: replacementResolvedPrivatePost.actorSlot,
        },
        projectedPost: {
          authorSlot: replacementResolvedPrivatePost.actorSlot,
          body: replacementResolvedPrivatePost.fixturePostBody,
        },
        apiThreadPostBodies: [
          replacementResolvedPrivatePost.fixturePostBody,
        ],
        rowanPrivateIsolationAfterAck: {
          targetKillVisible: false,
          actionResultVisible: false,
        },
        staleOutgoingRouteAfterAck: { status: 403 },
        staleOutgoingThreadAfterAck: { status: 403 },
        privateReconnectAfterAck: {
          status: "passed",
          reconnectCommandStateBeforeDrop: {
            actorSlot: replacementResolvedPrivatePost.actorSlot,
            phase: { phaseId: "D01", locked: true },
          },
          reconnectChannelContextBeforeDrop: {
            channelId: replacementResolvedPrivatePost.channelId,
            actorSlot: replacementResolvedPrivatePost.actorSlot,
          },
          reconnectButtonsBeforeDrop: [
            { action: "withdraw_vote", disabled: true },
            {
              action: replacementResolvedPrivatePost.commandAction,
              disabled: false,
            },
          ],
          reconnectingStatus: { state: "reconnecting" },
          reconnectPostBody: replacementResolvedPrivatePost.reconnectPostBody,
          reconnectCommand: {
            principalUserId:
              replacementResolvedPrivatePost.replacementPrincipalUserId,
            command: {
              SubmitPost: {
                channel_id: replacementResolvedPrivatePost.channelId,
                actor_slot: replacementResolvedPrivatePost.actorSlot,
                body: replacementResolvedPrivatePost.reconnectPostBody,
              },
            },
          },
          reconnectRecoveryEvent: {
            attempt: 1,
            state: "recovered",
          },
          recoveredCommandState: {
            actorSlot: replacementResolvedPrivatePost.actorSlot,
            phase: { phaseId: "D01", locked: true },
            voteTargets: [],
          },
          recoveredSnapshotContainsPost: true,
          reconnectChannelContextAfterRecovery: {
            channelId: replacementResolvedPrivatePost.channelId,
            actorSlot: replacementResolvedPrivatePost.actorSlot,
          },
          reconnectButtonsAfterRecovery: [
            { action: "withdraw_vote", disabled: true },
            {
              action: replacementResolvedPrivatePost.commandAction,
              disabled: false,
            },
          ],
          apiThreadPostBodiesAfterReconnect: [
            replacementResolvedPrivatePost.fixturePostBody,
            replacementResolvedPrivatePost.reconnectPostBody,
          ],
          apiCommandStateAfterReconnect: {
            phase: { phase_id: "D01", locked: true },
            vote_targets: [],
          },
          staleOutgoingThreadAfterReconnect: { status: 403 },
        },
        outcomeSummary: replacementResolvedPrivatePost.outcomeSummary,
      },
      replacementStalePrivatePostAfterComplete: {
        status: "passed",
        game: replacementCompletedPrivatePost.gameFixtureId,
        channel: replacementCompletedPrivatePost.channelId,
        hostEntry: { capabilityKinds: ["HostOf"] },
        staleOutgoingEntry: { capabilityKinds: ["SlotOccupant"] },
        replacementEntry: { capabilityKinds: ["SlotOccupant"] },
        replacement: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  ProcessReplacement: {
                    game: replacementCompletedPrivatePost.gameFixtureId,
                    slot: replacementCompletedPrivatePost.actorSlot,
                    incoming_user:
                      replacementCompletedPrivatePost.replacementPrincipalUserId,
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterProcess: {
          occupantLabel: replacementCompletedPrivatePost.replacementOccupantLabel,
        },
        commandStateBeforeClose: {
          actorSlot: replacementCompletedPrivatePost.actorSlot,
          gameCompleted: false,
        },
        channelContextBeforeClose: {
          channelId: replacementCompletedPrivatePost.channelId,
          actorSlot: replacementCompletedPrivatePost.actorSlot,
          capabilityLabel:
            `ChannelMember(${replacementCompletedPrivatePost.channelId})`,
        },
        submitPostBeforeClose: {
          action: replacementCompletedPrivatePost.commandAction,
          disabled: false,
        },
        closedStatus: { state: "closed" },
        complete: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    CompleteGame: {
                      game: replacementCompletedPrivatePost.gameFixtureId,
                    },
                  },
                },
              },
            },
          },
        },
        hostSlotsAfterComplete: [
          { role_revealed: true, alignment_revealed: true },
        ],
        hostActionsAfterComplete: [],
        apiStateAfterComplete: { completed: true },
        postBody: replacementCompletedPrivatePost.fixturePostBody,
        reject: {
          state: "reject",
          error: replacementCompletedPrivatePost.commandError,
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                principal_user_id:
                  replacementCompletedPrivatePost.replacementPrincipalUserId,
                command: {
                  SubmitPost: {
                    channel_id: replacementCompletedPrivatePost.channelId,
                    actor_slot: replacementCompletedPrivatePost.actorSlot,
                    body: replacementCompletedPrivatePost.fixturePostBody,
                  },
                },
              },
            },
          },
        },
        dispatchPlan: { projectionRefreshKeys: ["commandState"] },
        currentReceipt: {
          actionId: replacementCompletedPrivatePost.commandAction,
          state: "reject",
        },
        receiptStatusText: replacementCompletedPrivatePost.commandMessage,
        commandStateAfterReject: {
          actorSlot: replacementCompletedPrivatePost.actorSlot,
          gameCompleted: true,
          actions: [],
          voteTargets: [],
          boundary: replacementCompletedPrivatePost.commandStateBoundary,
        },
        channelContextAfterReject: {
          channelId: replacementCompletedPrivatePost.channelId,
          actorSlot: replacementCompletedPrivatePost.actorSlot,
        },
        buttonsAfterReject: [
          { action: "withdraw_vote", disabled: true },
          {
            action: replacementCompletedPrivatePost.commandAction,
            disabled: true,
          },
        ],
        apiCommandStateAfterReject: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        apiThreadPostBodies: [],
        staleOutgoingRouteAfterReject: { status: 403 },
        staleOutgoingThreadAfterReject: { status: 403 },
        privateReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          threadPagerVisible: true,
          recoveredCommandState: {
            actorSlot: replacementCompletedPrivatePost.actorSlot,
            gameCompleted: true,
            actions: [],
            voteTargets: [],
            boundary: replacementCompletedPrivatePost.commandStateBoundary,
          },
          reloadChannelContext: {
            channelId: replacementCompletedPrivatePost.channelId,
            actorSlot: replacementCompletedPrivatePost.actorSlot,
            capabilityLabel:
              `ChannelMember(${replacementCompletedPrivatePost.channelId})`,
          },
          reloadButtons: [
            { action: "withdraw_vote", disabled: true },
            {
              action: replacementCompletedPrivatePost.commandAction,
              disabled: true,
            },
          ],
          reloadThreadPostBodies: [],
          reloadRejectedPostVisible: false,
          apiCommandStateAfterReload: {
            game_completed: true,
            actions: [],
            vote_targets: [],
          },
          apiThreadPostBodiesAfterReload: [],
          staleOutgoingRouteAfterReload: {
            status: 403,
            responseStatus: 403,
          },
          staleOutgoingThreadAfterReload: { status: 403 },
        },
        outcomeSummary: replacementCompletedPrivatePost.outcomeSummary,
      },
      staleHostPublishAfterChange: {
        status: "passed",
        actionId: "publish_votecount",
        setup: {
          stalePhase: { id: "D02", locked: false },
          votecountRows: [{ target: "slot-3", count: 2 }],
          votecountActions: ["publish_votecount"],
          closedStatus: { state: "closed" },
        },
        staleBody: "Official votecount for D02\n- slot-3: 2",
        changeVote: { state: "ack" },
        apiVotecountAfterChange: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "no_lynch", count: 1 },
          },
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 1 },
          },
        ],
        currentRows: [
          { phaseId: "D02", target: "no_lynch", count: 1 },
          { phaseId: "D02", target: "slot-3", count: 1 },
        ],
        expectedBody: "Official votecount for D02\n- no_lynch: 1\n- slot-3: 1",
        publish: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    PublishVotecount: { game },
                  },
                },
              },
            },
          },
        },
        apiExpectedPostCount: 1,
        apiStalePostCount: 0,
        playerExpectedPostCount: 1,
        playerStalePostCount: 0,
        activityStatusText: "Ack: stream seqs 47",
        activityRow: {
          source: "outcome",
          actionId: "publish_votecount",
          dispatchKind: "publish_votecount",
        },
        restoreVote: { state: "ack" },
        apiVotecountAfterRestore: [
          {
            kind: "VoteCountChanged",
            body: { phase_id: "D02", candidate_slot: "slot-3", count: 2 },
          },
        ],
      },
      hostVotecountPublication: {
        status: "passed",
        expectedBody: "Official votecount for D02\n- slot-3: 2",
        publish: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    PublishVotecount: { game },
                  },
                },
              },
            },
          },
        },
        playerThreadPost: {
          body: "Official votecount for D02\n- slot-3: 2",
          authorLabel: "host",
        },
        apiThreadPost: {
          body: "Official votecount for D02\n- slot-3: 2",
          author_user: "host",
        },
        activityStatusText: "Ack: stream seqs 47",
      },
      concurrentHostPublishRace: {
        status: "passed",
        game: "publish-race-game",
        seed: { game: "publish-race-game", commands: 22 },
        firstHostRoute: { status: 200, url: "/g/publish-race-game/host" },
        secondHostRoute: { status: 200, url: "/g/publish-race-game/host" },
        playerRoute: { status: 200, url: "/g/publish-race-game" },
        targetSlot: "slot_5",
        targetCount: 3,
        expectedRows: [{ phaseId: "D01", target: "slot_5", count: 3 }],
        expectedBody: "Official votecount for D01\n- slot_5: 3",
        firstOutcome: { state: "ack" },
        secondOutcome: { state: "reject", error: "InvalidTarget" },
        ackRaceRole: "first",
        rejectRaceRole: "second",
        ack: {
          state: "ack",
          streamSeqs: [61],
          serverEnvelope: { body: { kind: "Ack" } },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandGames: ["publish-race-game", "publish-race-game"],
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
        roleReloadAfterRace: {
          status: "passed",
          firstHostRouteStatus: 200,
          secondHostRouteStatus: 200,
          playerRouteStatus: 200,
          firstHostProjection: [{ target: "slot_5", count: 3 }],
          secondHostProjection: [{ target: "slot_5", count: 3 }],
          playerProjection: [{ target: "slot_5", count: 3 }],
          apiProjection: { phaseId: "D01", target: "slot_5", count: 3 },
          apiOfficialPostCount: 1,
          playerOfficialPostCount: 1,
        },
        outcomeSummary: "first ACK, second rejected duplicate official count",
      },
      staleHostPublish: {
        status: "passed",
        actionId: "publish_votecount",
        setup: {
          stalePhase: { id: "D02", locked: false },
          votecountRows: [{ target: "slot-3", count: 2 }],
          votecountActions: ["publish_votecount"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            source: "outcome",
            actionId: "publish_votecount",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        votecountActionsAfterReject: ["publish_votecount"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
        activityRow: {
          source: "outcome",
          actionId: "publish_votecount",
          dispatchKind: "publish_votecount",
        },
        dispatchPlan: { projectionRefreshKeys: [] },
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
      },
      hostLifecycleControl: {
        status: "passed",
        targetSlot: "slot-7",
        markDead: {
          statusMessage: "Ack: stream seqs 48",
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    SetSlotStatus: { game, slot: "slot-7", status: "dead" },
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterDead: { lifecycleLabel: "Dead" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        playerCommandStateAfterDead: {
          actorAlive: false,
          actorStatus: "dead",
          actions: [],
        },
        disabledControls: {
          vote: { exists: false, disabled: true, reason: "control absent", text: "" },
          withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
          post: { exists: true, disabled: true, reason: "", text: "Post" },
        },
        actionControlCount: 0,
        directPost: {
          state: "reject",
          error: "SlotNotAlive",
        },
        restoreAlive: { state: "ack" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        playerCommandStateAfterRestore: {
          actorAlive: true,
          actorStatus: "alive",
        },
      },
      staleHostLifecycle: {
        status: "passed",
        actionId: "mark_dead",
        lifecycleStatus: "dead",
        setup: {
          stalePhase: { id: "D02", locked: false },
          replacement: { lifecycleLabel: "Alive" },
          lifecycleActions: ["mark_dead", "modkill_slot"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "mark_dead",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        replacementAfterReject: { lifecycleLabel: "Alive" },
        lifecycleActionsAfterReject: ["mark_dead", "modkill_slot"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
        activityRow: {
          source: "outcome",
          actionId: "mark_dead",
          dispatchKind: "mark_dead",
        },
        dispatchPlan: { projectionRefreshKeys: [] },
        apiSlotAfterReject: { alive: false, status: "dead" },
        playerCommandStateAfterReject: {
          actorAlive: false,
          actorStatus: "dead",
        },
        staleHostSlotLifecycleReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          phaseAfterReload: { id: "D02", locked: false },
          replacementAfterReload: { lifecycleLabel: "Dead" },
          lifecycleActionsAfterReload: [],
          apiSlotAfterReload: { alive: false, status: "dead" },
        },
      },
      hostModkillControl: {
        status: "passed",
        targetSlot: "slot-7",
        modkill: {
          statusMessage: "Ack: stream seqs 49",
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    SetSlotStatus: { game, slot: "slot-7", status: "modkilled" },
                  },
                },
              },
            },
          },
        },
        hostReplacementAfterModkill: { lifecycleLabel: "Modkilled" },
        apiSlotAfterModkill: { alive: false, status: "modkilled" },
        playerCommandStateAfterModkill: {
          actorAlive: false,
          actorStatus: "modkilled",
          actions: [],
        },
        disabledControls: {
          vote: { exists: false, disabled: true, reason: "control absent", text: "" },
          withdraw: { exists: true, disabled: true, reason: "", text: "Withdraw vote" },
          post: { exists: true, disabled: true, reason: "", text: "Post" },
        },
        actionControlCount: 0,
        directPost: {
          state: "reject",
          error: "SlotNotAlive",
        },
        restoreAlive: { state: "ack" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        playerCommandStateAfterRestore: {
          actorAlive: true,
          actorStatus: "alive",
        },
      },
      staleHostModkill: {
        status: "passed",
        actionId: "modkill_slot",
        lifecycleStatus: "modkilled",
        setup: {
          stalePhase: { id: "D02", locked: false },
          replacement: { lifecycleLabel: "Alive" },
          lifecycleActions: ["mark_dead", "modkill_slot"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "modkill_slot",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        replacementAfterReject: { lifecycleLabel: "Alive" },
        lifecycleActionsAfterReject: ["mark_dead", "modkill_slot"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
        activityRow: {
          source: "outcome",
          actionId: "modkill_slot",
          dispatchKind: "modkill_slot",
        },
        dispatchPlan: { projectionRefreshKeys: [] },
        apiSlotAfterReject: { alive: false, status: "modkilled" },
        playerCommandStateAfterReject: {
          actorAlive: false,
          actorStatus: "modkilled",
        },
        staleHostSlotLifecycleReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          phaseAfterReload: { id: "D02", locked: false },
          replacementAfterReload: { lifecycleLabel: "Modkilled" },
          lifecycleActionsAfterReload: [],
          apiSlotAfterReload: { alive: false, status: "modkilled" },
        },
      },
      concurrentHostLifecycleRace: {
        status: "passed",
        game: "lifecycle-race-game-a",
        actionId: "mixed_slot_lifecycle",
        setup: {
          deadPagePhase: { id: "D02", locked: false },
          modkillPagePhase: { id: "D02", locked: false },
          deadPageReplacement: { lifecycleLabel: "Alive" },
          modkillPageReplacement: { lifecycleLabel: "Alive" },
          deadPageLifecycleActions: ["mark_dead", "modkill_slot"],
          modkillPageLifecycleActions: ["mark_dead", "modkill_slot"],
          affectedPlayerCommandState: {
            actorSlot: "slot-7",
            actorAlive: true,
            actorStatus: "alive",
          },
        },
        ackRaceRole: "dead",
        rejectRaceRole: "modkill",
        ackActionId: "mark_dead",
        rejectActionId: "modkill_slot",
        winningStatus: "dead",
        winningLabel: "Dead",
        ack: {
          state: "ack",
          commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          streamSeqs: [50],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "dead",
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "modkilled",
                  },
                },
              },
            },
          },
        },
        deadOutcome: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "dead",
                  },
                },
              },
            },
          },
        },
        modkillOutcome: {
          state: "reject",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SetSlotStatus: {
                    game: "lifecycle-race-game-a",
                    slot: "slot-7",
                    status: "modkilled",
                  },
                },
              },
            },
          },
        },
        deadReplacementAfterRace: { lifecycleLabel: "Dead" },
        modkillReplacementAfterRace: { lifecycleLabel: "Dead" },
        deadLifecycleActionsAfterRace: [],
        modkillLifecycleActionsAfterRace: [],
        deadActivityStatusText: "Ack: stream seqs 50",
        modkillActivityStatusText:
          "Reject InvalidTarget: invalid target; slot lifecycle changed or is already current, refresh the slot controls before retrying",
        deadActivityRow: {
          source: "status",
          actionId: "mark_dead",
          dispatchKind: "mark_dead",
        },
        modkillActivityRow: {
          source: "outcome",
          actionId: "modkill_slot",
          dispatchKind: "modkill_slot",
        },
        affectedPlayerCommandStateAfterRace: {
          actorAlive: false,
          actorStatus: "dead",
          actions: [],
        },
        disabledControls: {
          vote: { disabled: true },
          withdraw: { disabled: true },
          post: { disabled: true },
        },
        actionControlCount: 0,
        directPost: {
          state: "reject",
          error: "SlotNotAlive",
        },
        apiSlotAfterRace: { alive: false, status: "dead" },
        roleReloadAfterRace: {
          status: "passed",
          deadRouteStatus: 200,
          modkillRouteStatus: 200,
          playerRouteStatus: 200,
          deadPhaseAfterReload: { id: "D02", locked: false },
          modkillPhaseAfterReload: { id: "D02", locked: false },
          deadReplacementAfterReload: { lifecycleLabel: "Dead" },
          modkillReplacementAfterReload: { lifecycleLabel: "Dead" },
          deadLifecycleActionsAfterReload: [],
          modkillLifecycleActionsAfterReload: [],
          affectedPlayerCommandStateAfterReload: {
            actorAlive: false,
            actorStatus: "dead",
            actions: [],
          },
          disabledControlsAfterReload: {
            vote: { disabled: true },
            withdraw: { disabled: true },
            post: { disabled: true },
          },
          actionControlCountAfterReload: 0,
          apiSlotAfterReload: { alive: false, status: "dead" },
        },
      },
      concurrentActionRace: {
        status: "passed",
        staleN01Phase: { phaseId: "N01" },
        actionConfig: {
          templateId: "factional_kill",
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        targetSlot: "slot-2",
        ack: {
          state: "ack",
          commandId: "11111111-1111-4111-8111-111111111111",
          streamSeqs: [42],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "22222222-2222-4222-8222-222222222222",
          error: "ActionAlreadySubmitted",
          message:
            "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        liveCommandStateAfterRace: {
          actorSlot: "slot_4",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        concurrentCommandStateAfterRace: {
          actorSlot: "slot_4",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        apiCommandStateAfterRace: {
          actor_slot: "slot_4",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        resolvedTargetSlot: {
          slot_id: "slot-2",
          alive: false,
          status: "dead",
        },
        actionVisibleAfterRefresh: false,
        roleReloadAfterRace: {
          status: "passed",
          actionRouteStatus: 200,
          hostRouteStatus: 200,
          actionCommandState: {
            actorSlot: "slot_4",
            phase: { phaseId: "N01", locked: true },
            actions: [],
          },
          actionVisibleAfterReload: false,
          hostPhase: { id: "N01", locked: true },
          hostSlotsAfterReload: [],
          apiCommandState: {
            actor_slot: "slot_4",
            phase: { phase_id: "N01", locked: true },
            actions: [],
          },
          apiTargetSlot: {
            slot_id: "slot-2",
            alive: false,
            status: "dead",
          },
        },
      },
      actionIdempotentRetry: {
        status: "passed",
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        legalActionCommandId: "11111111-1111-4111-8111-111111111111",
        legalActionStreamSeqs: [42],
        legalActionTarget: "slot-2",
        retry: {
          state: "ack",
          commandId: "11111111-1111-4111-8111-111111111111",
          message: "Ack: stream seqs 42",
          streamSeqs: [42],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        commandStateAfterRetry: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "ack",
          commandTrace: {
            projectionRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
          },
        },
        receiptStatusText: "Ack: stream seqs 42",
        apiCommandStateAfterRetry: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        actionVisibleAfterRefresh: false,
      },
      staleSameActionRecovery: {
        status: "passed",
        sourceRoleUrl: "http://127.0.0.1:5173/g/midsummer",
        visitedRolePath: "/g/midsummer",
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        legalActionCommandId: "11111111-1111-4111-8111-111111111111",
        legalActionTarget: "slot-2",
        reject: {
          state: "reject",
          commandId: "22222222-2222-4222-8222-222222222222",
          error: "ActionAlreadySubmitted",
          message:
            "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    action_id: "role_factional_kill",
                    template_id: "factional_kill",
                    targets: ["slot-2"],
                  },
                },
              },
            },
          },
        },
        phaseAfterReject: { phaseId: "N01", locked: false },
        commandStateAfterReject: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "N01", locked: false },
          actions: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "reject",
          commandTrace: {
            projectionRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
          },
        },
        receiptStatusText:
          "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
        apiCommandStateAfterReject: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "N01", locked: false },
          actions: [],
        },
        actionVisibleAfterRefresh: false,
      },
      staleDeadActionConflict: {
        status: "passed",
        sourceRoleUrl: "http://127.0.0.1:5173/g/midsummer",
        visitedRolePath: "/g/midsummer",
        markDead: { state: "ack" },
        apiSlotAfterDead: { alive: false, status: "dead" },
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        reject: {
          error: "SlotNotAlive",
          message:
            "Reject SlotNotAlive: slot not alive; actor is no longer alive, refresh and use current action controls",
        },
        commandStateAfterReject: {
          actorAlive: false,
          actorStatus: "dead",
          actions: [],
        },
        actionVisibleAfterRefresh: false,
        restoreAlive: { state: "ack" },
        apiSlotAfterRestore: { alive: true, status: "alive" },
        liveCommandStateAfterRestore: {
          actorAlive: true,
          actorStatus: "alive",
          actions: [{ templateId: "factional_kill" }],
        },
      },
      staleActionConflict: {
        status: "passed",
        sourceRoleUrl: "http://127.0.0.1:5173/g/midsummer",
        visitedRolePath: "/g/midsummer",
        actionConfig: {
          templateId: "factional_kill",
        },
        staleN01Phase: { phaseId: "N01" },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                  },
                },
              },
            },
          },
        },
        phaseAfterReject: { phaseId: "D02" },
        commandStateAfterReject: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "D02", locked: false },
          actions: [],
        },
        dispatchPlan: {
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "reject",
          commandTrace: {
            projectionRefreshKeys: [
              "notifications",
              "investigationResults",
              "commandState",
            ],
          },
        },
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        apiCommandStateAfterReject: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "D02", locked: false },
          actions: [],
        },
        reconnectAfterReject: {
          status: "passed",
          principalUserId: "player-goon-a",
          actorSlot: "slot_4",
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredSnapshotContainsPost: true,
          reconnectCommand: {
            principalUserId: "player-goon-a",
            command: {
              SubmitPost: {
                actor_slot: "slot_4",
                body: "Stale action reconnect proof from dev:test-game fixture",
              },
            },
            streamSeqs: [60],
          },
          recoveredCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
        },
        buttonsAfterReconnect: [],
        actionVisibleAfterRefresh: false,
      },
      privateChannelStaleActionReconnectRecovery: {
        status: "passed",
        sourceRoleUrl:
          "http://127.0.0.1:5173/g/midsummer/c/private%3Amafia_day_chat",
        visitedRolePath: "/g/midsummer/c/private%3Amafia_day_chat",
        channel: "private:mafia_day_chat",
        staleN01Phase: { phaseId: "N01" },
        channelContextBeforeClose: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot_4",
        },
        actionConfig: {
          templateId: "factional_kill",
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitAction: {
                    actor_slot: "slot_4",
                    template_id: "factional_kill",
                  },
                },
              },
            },
          },
        },
        commandStateAfterReject: {
          actorSlot: "slot_4",
          actorAlive: true,
          actorStatus: "alive",
          phase: { phaseId: "D02", locked: false },
          actions: [],
        },
        channelContextAfterReject: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot_4",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["commandState", "dayVoteOutcomes"],
        },
        currentReceipt: {
          actionId: "submit_action:factional_kill",
          state: "reject",
          commandTrace: {
            projectionRefreshKeys: ["commandState"],
          },
        },
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        apiCommandStateAfterReject: {
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          phase: { phase_id: "D02", locked: false },
          actions: [],
        },
        actionVisibleAfterRefresh: false,
        privateThreadPagerVisibleAfterReject: true,
        reconnectAfterReject: {
          status: "passed",
          principalUserId: "player-goon-a",
          actorSlot: "slot_4",
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredSnapshotContainsPost: true,
          reconnectCommand: {
            command: {
              SubmitPost: {
                channel_id: "private:mafia_day_chat",
                actor_slot: "slot_4",
              },
            },
          },
          recoveredCommandState: {
            actorSlot: "slot_4",
            actorAlive: true,
            actorStatus: "alive",
            phase: { phaseId: "D02", locked: false },
            actions: [],
          },
        },
        reconnectChannelContext: {
          channelId: "private:mafia_day_chat",
          actorSlot: "slot_4",
        },
        privateThreadPagerVisibleAfterReconnect: true,
        buttonsAfterReconnect: [],
      },
      staleHostControl: {
        status: "passed",
        setup: {
          stalePhase: { id: "N01", locked: true },
          visibleActions: ["unlock_thread", "advance_phase"],
          closedStatus: { state: "closed" },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        commandOutcomes: [
          {
            actionId: "unlock_thread",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        visibleActionsAfterReject: ["lock_thread", "resolve_phase"],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "unlock_thread",
          dispatchKind: "unlock_thread",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false },
      },
      concurrentHostResolveRace: {
        status: "passed",
        game: "race-game-a",
        actionId: "resolve_phase",
        setup: {
          stalePhase: { id: "D02", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        ack: {
          state: "ack",
          commandId: "33333333-3333-4333-8333-333333333333",
          streamSeqs: [49],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { ResolvePhase: { game: "race-game-a" } },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "44444444-4444-4444-8444-444444444444",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: { ResolvePhase: { game: "race-game-a" } },
              },
            },
          },
        },
        livePhaseAfterRace: { id: "D02", locked: true },
        concurrentPhaseAfterRace: { id: "D02", locked: true },
        livePhaseActionsAfterRace: ["unlock_thread", "advance_phase"],
        concurrentPhaseActionsAfterRace: ["unlock_thread", "advance_phase"],
        liveDeadlineActionsAfterRace: ["extend_deadline"],
        concurrentDeadlineActionsAfterRace: ["extend_deadline"],
        liveActivityStatusText: "Ack: stream seqs 49",
        concurrentActivityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        liveActivityRow: {
          source: "status",
          actionId: "resolve_phase",
          dispatchKind: "resolve_phase",
        },
        concurrentActivityRow: {
          source: "outcome",
          actionId: "resolve_phase",
          dispatchKind: "resolve_phase",
        },
        apiPhaseAfterRace: { phase_id: "D02", locked: true },
        roleReloadAfterRace: {
          status: "passed",
          liveRouteStatus: 200,
          concurrentRouteStatus: 200,
          livePhaseAfterReload: { id: "D02", locked: true },
          concurrentPhaseAfterReload: { id: "D02", locked: true },
          livePhaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          concurrentPhaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          liveDeadlineActionsAfterReload: ["extend_deadline"],
          concurrentDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "D02", locked: true },
        },
        restoreAfterRace: {
          commandStatus: {
            state: "ack",
            requestEnvelope: {
              body: {
                body: {
                  command: { UnlockThread: { game: "race-game-a" } },
                },
              },
            },
          },
        },
        apiPhaseAfterRestore: { phase_id: "D02", locked: false },
      },
      concurrentHostAdvanceRace: {
        status: "passed",
        game: "advance-race-game-a",
        actionId: "advance_phase",
        setup: {
          stalePhase: { id: "D02", locked: true },
          phaseActions: ["unlock_thread", "advance_phase"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        ack: {
          state: "ack",
          commandId: "55555555-5555-4555-8555-555555555555",
          streamSeqs: [53],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "advance-race-game-a" } },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "66666666-6666-4666-8666-666666666666",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "advance-race-game-a" } },
              },
            },
          },
        },
        livePhaseAfterRace: { id: "N02", locked: false },
        concurrentPhaseAfterRace: { id: "N02", locked: false },
        livePhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        concurrentPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        liveDeadlineActionsAfterRace: ["extend_deadline"],
        concurrentDeadlineActionsAfterRace: ["extend_deadline"],
        liveActivityStatusText: "Ack: stream seqs 53",
        concurrentActivityStatusText:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        liveActivityRow: {
          source: "status",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        concurrentActivityRow: {
          source: "outcome",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        apiPhaseAfterRace: { phase_id: "N02", locked: false },
        roleReloadAfterRace: {
          status: "passed",
          liveRouteStatus: 200,
          concurrentRouteStatus: 200,
          livePhaseAfterReload: { id: "N02", locked: false },
          concurrentPhaseAfterReload: { id: "N02", locked: false },
          livePhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          concurrentPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          liveDeadlineActionsAfterReload: ["extend_deadline"],
          concurrentDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "N02", locked: false },
        },
      },
      concurrentHostDeadlineAdvanceRace: {
        status: "passed",
        game: "deadline-advance-race-game-a",
        actionId: "advance_phase_by_deadline",
        setup: {
          stalePhase: { id: "D01", locked: true, deadline: 918300 },
          visibleActions: [
            "unlock_thread",
            "advance_phase",
            "advance_phase_by_deadline",
          ],
          closedStatus: { state: "closed" },
        },
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        ack: {
          state: "ack",
          commandId: "77777777-7777-4777-8777-777777777777",
          streamSeqs: [54, 55],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "deadline-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "88888888-8888-4888-8888-888888888888",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: deadline target is stale; refresh and use the current deadline controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "deadline-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        livePhaseAfterRace: { id: "N01", locked: false, deadline: null },
        concurrentPhaseAfterRace: { id: "N01", locked: false, deadline: null },
        livePhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        concurrentPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        liveDeadlineActionsAfterRace: ["extend_deadline"],
        concurrentDeadlineActionsAfterRace: ["extend_deadline"],
        liveActivityStatusText: "Ack: stream seqs 54, 55",
        concurrentActivityStatusText:
          "Reject InvalidTarget: deadline target is stale; refresh and use the current deadline controls",
        liveActivityRow: {
          source: "status",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        concurrentActivityRow: {
          source: "outcome",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        apiPhaseAfterRace: { phase_id: "N01", locked: false, deadline: null },
        roleReloadAfterRace: {
          status: "passed",
          liveRouteStatus: 200,
          concurrentRouteStatus: 200,
          livePhaseAfterReload: { id: "N01", locked: false, deadline: null },
          concurrentPhaseAfterReload: {
            id: "N01",
            locked: false,
            deadline: null,
          },
          livePhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          concurrentPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          liveDeadlineActionsAfterReload: ["extend_deadline"],
          concurrentDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: {
            phase_id: "N01",
            locked: false,
            deadline: null,
          },
        },
      },
      concurrentHostMixedAdvanceRace: {
        status: "passed",
        game: "mixed-advance-race-game-a",
        actionId: "mixed_advance_phase",
        setup: {
          stalePhase: { id: "D01", locked: true, deadline: 918300 },
          visibleActions: [
            "unlock_thread",
            "advance_phase",
            "advance_phase_by_deadline",
          ],
          closedStatus: { state: "closed" },
        },
        ackRaceRole: "normal",
        rejectRaceRole: "deadline",
        ackActionId: "advance_phase",
        rejectActionId: "advance_phase_by_deadline",
        ack: {
          state: "ack",
          commandId: "99999999-9999-4999-8999-999999999999",
          streamSeqs: [56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "mixed-advance-race-game-a" } },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "mixed-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        normalOutcome: {
          state: "ack",
          requestEnvelope: {
            body: {
              body: {
                command: { AdvancePhase: { game: "mixed-advance-race-game-a" } },
              },
            },
          },
        },
        deadlineOutcome: {
          state: "reject",
          requestEnvelope: {
            body: {
              body: {
                command: {
                  AdvancePhaseByDeadline: {
                    game: "mixed-advance-race-game-a",
                    phase: "D01",
                    observed_at: 918301,
                  },
                },
              },
            },
          },
        },
        normalPhaseAfterRace: { id: "N01", locked: false, deadline: null },
        deadlinePhaseAfterRace: { id: "N01", locked: false, deadline: null },
        normalPhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        deadlinePhaseActionsAfterRace: ["resolve_phase", "lock_thread"],
        normalDeadlineActionsAfterRace: ["extend_deadline"],
        deadlineDeadlineActionsAfterRace: ["extend_deadline"],
        normalActivityStatusText: "Ack: stream seqs 56",
        deadlineActivityStatusText:
          "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
        normalActivityRow: {
          source: "status",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        deadlineActivityRow: {
          source: "outcome",
          actionId: "advance_phase_by_deadline",
          dispatchKind: "advance_phase_by_deadline",
        },
        apiPhaseAfterRace: { phase_id: "N01", locked: false, deadline: null },
        roleReloadAfterRace: {
          status: "passed",
          normalRouteStatus: 200,
          deadlineRouteStatus: 200,
          normalPhaseAfterReload: {
            id: "N01",
            locked: false,
            deadline: null,
          },
          deadlinePhaseAfterReload: {
            id: "N01",
            locked: false,
            deadline: null,
          },
          normalPhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          deadlinePhaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          normalDeadlineActionsAfterReload: ["extend_deadline"],
          deadlineDeadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: {
            phase_id: "N01",
            locked: false,
            deadline: null,
          },
        },
      },
      staleHostResolve: {
        status: "passed",
        actionId: "resolve_phase",
        setup: {
          roleUrl: `/g/${game}/host`,
          stalePhase: { id: "D02", locked: false },
          phaseActions: ["resolve_phase", "lock_thread"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        staleClickBrowserProof: {
          roleUrl: `/g/${game}/host`,
          clickedActionId: "resolve_phase",
          receiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          dispatchRefreshKeys: ["host"],
          phaseAfterReject: { id: "D02", locked: true },
          phaseActionsAfterReject: ["unlock_thread", "advance_phase"],
        },
        liveResolve: {
          commandStatus: {
            state: "ack",
            streamSeqs: [50],
            requestEnvelope: {
              body: {
                body: {
                  command: { ResolvePhase: { game } },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "resolve_phase",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: true },
        phaseActionsAfterReject: ["unlock_thread", "advance_phase"],
        deadlineActionsAfterReject: ["extend_deadline"],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "resolve_phase",
          dispatchKind: "resolve_phase",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: true },
        staleHostResolveReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: true },
          phaseActionsAfterReload: ["unlock_thread", "advance_phase"],
          deadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "D02", locked: true },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: true },
          },
        },
        phaseActionsAfterReconnect: ["unlock_thread", "advance_phase"],
        deadlineActionsAfterReconnect: ["extend_deadline"],
        restoreAfterReject: {
          commandStatus: {
            state: "ack",
            streamSeqs: [51],
          },
        },
        apiPhaseAfterRestore: { phase_id: "D02", locked: false },
      },
      staleHostAdvance: {
        status: "passed",
        actionId: "advance_phase",
        setup: {
          roleUrl: `/g/${game}/host`,
          stalePhase: { id: "D02", locked: true },
          phaseActions: ["unlock_thread", "advance_phase"],
          deadlineActions: ["extend_deadline"],
          closedStatus: { state: "closed" },
        },
        staleClickBrowserProof: {
          roleUrl: `/g/${game}/host`,
          clickedActionId: "advance_phase",
          receiptStatusText:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          dispatchRefreshKeys: ["host"],
          phaseAfterReject: { id: "D02", locked: false },
          phaseActionsAfterReject: ["resolve_phase", "lock_thread"],
        },
        liveUnlock: {
          commandStatus: {
            state: "ack",
            streamSeqs: [52],
            requestEnvelope: {
              body: {
                body: {
                  command: { UnlockThread: { game } },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "InvalidTarget",
          message:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "advance_phase",
            state: "reject",
            error: "InvalidTarget",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        phaseActionsAfterReject: ["resolve_phase", "lock_thread"],
        deadlineActionsAfterReject: ["extend_deadline"],
        activityStatusText:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "advance_phase",
          dispatchKind: "advance_phase",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false },
        staleHostAdvanceReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: false },
          phaseActionsAfterReload: ["resolve_phase", "lock_thread"],
          deadlineActionsAfterReload: ["extend_deadline"],
          apiPhaseAfterReload: { phase_id: "D02", locked: false },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: false },
          },
        },
        phaseActionsAfterReconnect: ["resolve_phase", "lock_thread"],
        deadlineActionsAfterReconnect: ["extend_deadline"],
      },
      staleHostPrompt: {
        status: "passed",
        game: `${game}-prompt-test`,
        promptId: "D01:skip_next_day:slot_1",
        actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
        setup: {
          promptId: "D01:skip_next_day:slot_1",
          promptActions: ["resolve_host_prompt-D01-skip_next_day-slot_1"],
          prompts: [
            {
              id: "D01:skip_next_day:slot_1",
              status: "pending",
            },
          ],
          closedStatus: { state: "closed" },
        },
        liveResolve: {
          commandStatus: {
            state: "ack",
            streamSeqs: [53, 54],
            requestEnvelope: {
              body: {
                body: {
                  command: {
                    ResolveHostPrompt: {
                      game: `${game}-prompt-test`,
                      prompt_id: "D01:skip_next_day:slot_1",
                    },
                  },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "PromptAlreadyResolved",
          message: "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
            state: "reject",
            error: "PromptAlreadyResolved",
          },
        ],
        promptsAfterReject: [
          {
            id: "D01:skip_next_day:slot_1",
            status: "resolved",
          },
        ],
        promptActionsAfterReject: [],
        activityStatusText: "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
        activityRow: {
          source: "outcome",
          actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
          dispatchKind: "resolve_host_prompt",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["hostPrompts"],
        },
        apiPromptsAfterReject: [
          {
            prompt_id: "D01:skip_next_day:slot_1",
            status: "resolved",
          },
        ],
        staleHostPromptReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
          surfaceText: "Host console",
          promptsAfterReload: [
            {
              id: "D01:skip_next_day:slot_1",
              status: "resolved",
            },
          ],
          promptActionsAfterReload: [],
          apiPromptsAfterReload: [
            {
              prompt_id: "D01:skip_next_day:slot_1",
              status: "resolved",
            },
          ],
        },
      },
      staleHostComplete: {
        status: "passed",
        game: `${game}-complete-test`,
        actionId: "complete_game",
        setup: {
          roleActions: ["complete_game"],
          revealText: "0/1 slots revealed",
          slots: [
            { role_revealed: false, alignment_revealed: false },
          ],
          closedStatus: { state: "closed" },
        },
        liveComplete: {
          commandStatus: {
            state: "ack",
            streamSeqs: [55],
            requestEnvelope: {
              body: {
                body: {
                  command: { CompleteGame: { game: `${game}-complete-test` } },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandOutcomes: [
          {
            actionId: "complete_game",
            state: "reject",
            error: "GameAlreadyCompleted",
          },
        ],
        slotsAfterReject: [
          { role_revealed: true, alignment_revealed: true },
        ],
        revealTextAfterReject: "All 1 slots revealed",
        roleActionsAfterReject: [],
        activityStatusText: "Reject GameAlreadyCompleted: game already completed",
        activityRow: {
          source: "outcome",
          actionId: "complete_game",
          dispatchKind: "complete_game",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiStateAfterReject: {
          completed: true,
          slots: [
            { role_revealed: true, alignment_revealed: true },
          ],
        },
        staleHostReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject GameAlreadyCompleted: game already completed",
          surfaceText: "All 1 slots revealed",
          slotsAfterReload: [
            { role_revealed: true, alignment_revealed: true },
          ],
          revealTextAfterReload: "All 1 slots revealed",
          roleActionsAfterReload: [],
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
        reconnectAfterReject: {
          status: "passed",
          game: `${game}-complete-test`,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
        roleActionsAfterReconnect: [],
      },
      concurrentHostCompleteRace: {
        status: "passed",
        game: `${game}-concurrent-complete-test`,
        actionId: "complete_game",
        setup: {
          firstRoleActions: ["complete_game"],
          secondRoleActions: ["complete_game"],
          firstRevealText: "0/1 slots revealed",
          secondRevealText: "0/1 slots revealed",
          firstSlots: [
            { role_revealed: false, alignment_revealed: false },
          ],
          secondSlots: [
            { role_revealed: false, alignment_revealed: false },
          ],
        },
        ackRaceRole: "first",
        rejectRaceRole: "second",
        ack: {
          state: "ack",
          commandId: "concurrent-complete-ack",
          streamSeqs: [56],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  CompleteGame: { game: `${game}-concurrent-complete-test` },
                },
              },
            },
          },
        },
        reject: {
          state: "reject",
          commandId: "concurrent-complete-reject",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  CompleteGame: { game: `${game}-concurrent-complete-test` },
                },
              },
            },
          },
        },
        firstOutcome: {
          state: "ack",
          commandId: "concurrent-complete-ack",
        },
        secondOutcome: {
          state: "reject",
          commandId: "concurrent-complete-reject",
          error: "GameAlreadyCompleted",
        },
        firstSlotsAfterRace: [
          { role_revealed: true, alignment_revealed: true },
        ],
        secondSlotsAfterRace: [
          { role_revealed: true, alignment_revealed: true },
        ],
        firstRevealTextAfterRace: "All 1 slots revealed",
        secondRevealTextAfterRace: "All 1 slots revealed",
        firstRoleActionsAfterRace: [],
        secondRoleActionsAfterRace: [],
        firstActivityStatusText: "Ack: stream seqs 56",
        secondActivityStatusText:
          "Reject GameAlreadyCompleted: game already completed",
        firstActivityRow: {
          source: "outcome",
          actionId: "complete_game",
          dispatchKind: "complete_game",
        },
        secondActivityRow: {
          source: "outcome",
          actionId: "complete_game",
          dispatchKind: "complete_game",
        },
        firstDispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        secondDispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiStateAfterRace: {
          completed: true,
          slots: [
            { role_revealed: true, alignment_revealed: true },
          ],
        },
        roleReloadAfterRace: {
          status: "passed",
          firstRouteStatus: 200,
          secondRouteStatus: 200,
          firstSlotsAfterReload: [
            { role_revealed: true, alignment_revealed: true },
          ],
          secondSlotsAfterReload: [
            { role_revealed: true, alignment_revealed: true },
          ],
          firstRevealTextAfterReload: "All 1 slots revealed",
          secondRevealTextAfterReload: "All 1 slots revealed",
          firstRoleActionsAfterReload: [],
          secondRoleActionsAfterReload: [],
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
      },
      concurrentPlayerCompleteRace: {
        status: "passed",
        game: `${game}-concurrent-player-complete-test`,
        postBody: "concurrent player complete fixture post",
        setupCommandState: {
          actorSlot: "slot-7",
          gameCompleted: false,
          actions: [],
          voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
        },
        setupButtons: [{ action: "submit_post", disabled: false }],
        setupPostButton: { action: "submit_post", disabled: false },
        setupHostActions: ["complete_game"],
        setupHostSlots: [
          { role_revealed: false, alignment_revealed: false },
        ],
        post: {
          state: "reject",
          commandId: "concurrent-player-complete-post",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  SubmitPost: {
                    game: `${game}-concurrent-player-complete-test`,
                    channel_id: "main",
                    actor_slot: "slot-7",
                    body: "concurrent player complete fixture post",
                    media: [],
                  },
                },
              },
            },
          },
        },
        complete: {
          state: "ack",
          commandId: "concurrent-player-complete-complete",
          streamSeqs: [57],
          serverEnvelope: { body: { kind: "Ack" } },
          requestEnvelope: {
            body: {
              body: {
                command: {
                  CompleteGame: { game: `${game}-concurrent-player-complete-test` },
                },
              },
            },
          },
        },
        postSeq: null,
        completeSeq: 57,
        outcomeSummary: "post rejected GameAlreadyCompleted after completion",
        commandStateAfterRace: {
          gameCompleted: true,
          boundary: "game is complete",
          actions: [],
          voteTargets: [],
        },
        buttonsAfterRace: [
          { action: "submit_vote:no_lynch", disabled: true },
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: true },
        ],
        publicReloadAfterRace: {
          status: "passed",
          routeResponseStatus: 200,
          surfaceText:
            "Endgame\nThe game is complete.\nNo older posts\nSubmit post",
          threadPagerVisible: true,
          recoveredCommandState: {
            actorSlot: "slot-7",
            gameCompleted: true,
            boundary: "game is complete",
            actions: [],
            voteTargets: [],
          },
          reloadButtons: [
            { action: "submit_vote:no_lynch", disabled: true },
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: true },
          ],
          reloadThreadPostBodies: [],
          reloadPostCount: 0,
          reloadPostVisible: false,
          apiCommandStateAfterReload: {
            game_completed: true,
            actions: [],
            vote_targets: [],
          },
          apiThreadPostBodiesAfterReload: [],
          apiThreadPostCount: 0,
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
        hostSlotsAfterRace: [
          { role_revealed: true, alignment_revealed: true },
        ],
        apiCommandStateAfterRace: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        apiThreadHasPost: false,
        apiThreadPostCount: 0,
        apiStateAfterRace: {
          completed: true,
          slots: [
            { role_revealed: true, alignment_revealed: true },
          ],
        },
      },
      stalePlayerComplete: {
        status: "passed",
        game: `${game}-player-complete-test`,
        setupCommandState: {
          actorSlot: "slot-7",
          gameCompleted: false,
          actions: [],
          voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
        },
        setupButtons: [
          { action: "submit_vote:no_lynch", disabled: false },
          { action: "withdraw_vote", disabled: false },
          { action: "submit_post", disabled: false },
        ],
        staleVoteButton: { action: "submit_vote:no_lynch", disabled: false },
        closedStatus: { state: "closed" },
        liveComplete: {
          state: "ack",
          streamSeqs: [56],
        },
        reject: {
          state: "reject",
          error: "GameAlreadyCompleted",
          message: "Reject GameAlreadyCompleted: game already completed",
          serverEnvelope: { body: { kind: "Reject" } },
        },
        commandStateAfterReject: {
          gameCompleted: true,
          actions: [],
          voteTargets: [],
          boundary: "The game is complete; role actions, votes, and posts are closed.",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["votecount", "commandState"],
        },
        buttonsAfterReject: [
          { action: "submit_vote", disabled: true },
          { action: "withdraw_vote", disabled: true },
          { action: "submit_post", disabled: true },
        ],
        currentVoteAfterReject: {
          hasVote: "false",
          text: "No current vote",
        },
        apiCommandStateAfterReject: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        stalePublicReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          surfaceText:
            "Endgame\nThe game is complete.\nNo current vote\nNo older posts",
          threadPagerVisible: true,
          recoveredCommandState: {
            actorSlot: "slot-7",
            gameCompleted: true,
            actions: [],
            voteTargets: [],
            boundary:
              "The game is complete; role actions, votes, and posts are closed.",
          },
          reloadButtons: [
            { action: "submit_vote", disabled: true },
            { action: "withdraw_vote", disabled: true },
            { action: "submit_post", disabled: true },
          ],
          reloadCurrentVote: {
            hasVote: "false",
            text: "No current vote",
          },
          reloadThreadPostBodies: [],
          apiCommandStateAfterReload: {
            game_completed: true,
            actions: [],
            vote_targets: [],
          },
          apiThreadPostBodiesAfterReload: [],
          apiStateAfterReload: {
            completed: true,
            slots: [
              { role_revealed: true, alignment_revealed: true },
            ],
          },
        },
      },
      staleHostDeadline: {
        status: "passed",
        actionId: "extend_deadline",
        setup: {
          roleUrl: `/g/${game}/host`,
          stalePhase: { id: "D01", locked: false },
          deadlineActions: ["extend_deadline"],
          phaseActions: ["lock_thread", "resolve_phase"],
          closedStatus: { state: "closed" },
        },
        staleClickBrowserProof: {
          roleUrl: `/g/${game}/host`,
          clickedActionId: "extend_deadline",
          receiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          dispatchRefreshKeys: ["host"],
          phaseAfterReject: { id: "D02", locked: false },
          deadlineActionsAfterReject: ["extend_deadline"],
          phaseActionsAfterReject: ["lock_thread", "resolve_phase"],
          apiPhaseAfterReject: { phase_id: "D02", locked: false, deadline: null },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        commandOutcomes: [
          {
            actionId: "extend_deadline",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        deadlineActionsAfterReject: ["extend_deadline"],
        phaseActionsAfterReject: ["lock_thread", "resolve_phase"],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false, deadline: null },
        staleHostDeadlineReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: false },
          deadlineActionsAfterReload: ["extend_deadline"],
          phaseActionsAfterReload: ["lock_thread", "resolve_phase"],
          apiPhaseAfterReload: { phase_id: "D02", locked: false, deadline: null },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: false },
          },
        },
        deadlineActionsAfterReconnect: ["extend_deadline"],
        phaseActionsAfterReconnect: ["lock_thread", "resolve_phase"],
        apiPhaseAfterReconnect: { phase_id: "D02", locked: false, deadline: null },
      },
      staleCohostDeadline: {
        status: "passed",
        actionId: "extend_deadline",
        setup: {
          roleUrl: `/g/${game}/host?cohost=cohost_c`,
          stalePhase: { id: "D01", locked: false },
          deadlineActions: ["extend_deadline"],
          phaseActions: [],
          closedStatus: { state: "closed" },
        },
        staleClickBrowserProof: {
          roleUrl: `/g/${game}/host?cohost=cohost_c`,
          clickedActionId: "extend_deadline",
          receiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          dispatchRefreshKeys: ["host"],
          phaseAfterReject: { id: "D02", locked: false },
          deadlineActionsAfterReject: ["extend_deadline"],
          phaseActionsAfterReject: [],
          apiPhaseAfterReject: { phase_id: "D02", locked: false, deadline: null },
        },
        reject: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        },
        commandOutcomes: [
          {
            actionId: "extend_deadline",
            state: "reject",
            error: "PhaseLocked",
          },
        ],
        phaseAfterReject: { id: "D02", locked: false },
        deadlineActionsAfterReject: ["extend_deadline"],
        phaseActionsAfterReject: [],
        activityStatusText:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        activityRow: {
          source: "outcome",
          actionId: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
        dispatchPlan: {
          projectionRefreshKeys: ["host"],
        },
        apiPhaseAfterReject: { phase_id: "D02", locked: false, deadline: null },
        staleCohostDeadlineReloadAfterReject: {
          status: "passed",
          routeResponseStatus: 200,
          rejectReceiptStatusText:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          surfaceText: "Host console",
          phaseAfterReload: { id: "D02", locked: false },
          deadlineActionsAfterReload: ["extend_deadline"],
          phaseActionsAfterReload: [],
          apiPhaseAfterReload: { phase_id: "D02", locked: false, deadline: null },
        },
        reconnectAfterReject: {
          status: "passed",
          game,
          reconnectingStatus: { state: "reconnecting" },
          reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
          recoveredStatus: { state: "recovered" },
          recoveredHostProjection: {
            phase: { id: "D02", locked: false },
          },
        },
        deadlineActionsAfterReconnect: ["extend_deadline"],
        phaseActionsAfterReconnect: [],
        apiPhaseAfterReconnect: { phase_id: "D02", locked: false, deadline: null },
      },
    },
  };
  card.sessions.replacementPlayer =
    card.verification.replacementConsole.replacementSessionRefresh.session;
  card.verification.sessions.replacementPlayer =
    card.verification.replacementConsole.replacementSessionRefresh.browserEntry;
  const markdown = markdownSessionCard(card);
  assert(markdown.includes("# fmarch Dev Test Game"));
  assert(markdown.includes("identity bootstrap: auth_session -> /auth/session-grants"));
  assert(markdown.includes("dev session endpoint enabled: false"));
  assert(markdown.includes("Open a role login URL"));
  assert(markdown.includes("dev-test-card-host"));
  assert(markdown.includes("dev-test-card-cohost"));
  assert(markdown.includes("replacement-session-refresh-token"));
  assert(markdown.includes(`returnTo=%2Fg%2F${game}`));
  assert(markdown.includes("Credential token: dev-test-card-player"));
  assert(markdown.includes("## Proof Stability Audit"));
  assert(
    markdown.includes(
      "Host confirms: 4 total; 0 concurrent browser clicks; 1 retried; 0 DOM fallbacks; 0 force fallbacks",
    ),
  );
  assert(markdown.includes("resolve_phase host: playwright-retry after 2 attempts"));
  assert(markdown.includes("## Cohost Console Proof"));
  assert(markdown.includes("Extend deadline: Ack: stream seqs 41"));
  assert(markdown.includes("Host-only controls visible: false"));
  assert(markdown.includes("Host-only resolve: Reject NotHost: not host"));
  assert(markdown.includes("## Core Loop Proof"));
  assert(markdown.includes("Reject PhaseLocked: phase locked"));
  assert(markdown.includes("## Day Vote Resolution Proof"));
  assert(markdown.includes("Outcome: Lynch slot-2"));
  assert(markdown.includes("## Day Vote No-Lynch Proof"));
  assert(markdown.includes("Outcome: NoLynch 2"));
  assert(markdown.includes("## Action Loop Proof"));
  assert(markdown.includes("Reject InvalidTarget: invalid target"));
  assert(markdown.includes("## Invalid Action Recovery Proof"));
  assert(markdown.includes(`Receipt: ${playerInvalidActionRecoveryMessage}`));
  assert(markdown.includes("Legal action visible: true"));
  assert(markdown.includes("## Resolution Receipt Proof"));
  assert(markdown.includes("Target notice: player_killed factional_kill"));
  assert(markdown.includes("Normal player notice leaked: false"));
  assert(markdown.includes("## Dead Player Recovery Proof"));
  assert(markdown.includes("Actor status: dead"));
  assert(markdown.includes("Direct vote: Reject SlotNotAlive: slot not alive"));
  assert(markdown.includes("Direct post: Reject SlotNotAlive: slot not alive"));
  assert(markdown.includes("Direct action: Reject SlotNotAlive: slot not alive"));
  assert(markdown.includes("## Player Action Boundary Proof"));
  assert(markdown.includes("Factional kill visible: false"));
  assert(markdown.includes("Direct factional kill: Reject InvalidTarget: invalid target"));
  assert(markdown.includes("## Private Channel Proof"));
  assert(markdown.includes("Denied route: 403 Back to board"));
  assert(markdown.includes("## Replacement Console Proof"));
  assert(markdown.includes("Host-issued invite: Replacement invite issued"));
  assert(
    markdown.includes(
      "Redeemed invite recovery: Session or invite token is missing, expired, or revoked",
    ),
  );
  assert(markdown.includes("Invalid replacement recovery: InvalidTarget"));
  assert(markdown.includes("Process replacement: Ack: stream seqs 44"));
  assert(markdown.includes("Projected occupant: player-rowan"));
  assert(markdown.includes("Replacement duplicate retry: Ack: stream seqs 44"));
  assert(markdown.includes("Stale host invite recovery: Player invite issued"));
  assert(
    markdown.includes(
      "Stale outgoing recovery: Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
    ),
  );
  assert(markdown.includes("Stale replacement recovery: InvalidTarget"));
  assert(markdown.includes("Incoming replacement: player-rowan Ack: stream seqs 45"));
  assert(markdown.includes("## Multiplayer Hardening Proof"));
  assert(markdown.includes("Duplicate retry: Ack: stream seqs 44"));
  assert(markdown.includes("Reconnect: attempt 1 recovered"));
  assert(markdown.includes("Stale player vote: Reject PhaseLocked"));
  assert(markdown.includes("Stale dead-target vote: Reject InvalidTarget"));
  assert(markdown.includes("Dead current vote: Slot 3 cleared"));
  assert(markdown.includes("Concurrent vote race: slot-3 count 2"));
  assert(markdown.includes("Concurrent player vote/resolve race: vote seq 47 before resolve seq 48"));
  assert(markdown.includes("Concurrent player action/advance race: Reject PhaseLocked"));
  assert(markdown.includes("Concurrent cohost deadline/resolve race: deadline seq 53 before resolve seq 54"));
  assert(markdown.includes("Concurrent host resolve race: Reject PhaseLocked"));
  assert(markdown.includes("Concurrent host advance race: Reject InvalidTarget"));
  assert(markdown.includes("Host lifecycle: Ack: stream seqs 48"));
  assert(markdown.includes("Stale host lifecycle: Reject InvalidTarget"));
  assert(markdown.includes("Host modkill: Ack: stream seqs 49"));
  assert(markdown.includes("Stale host modkill: Reject InvalidTarget"));
  assert(markdown.includes("Concurrent host lifecycle race: Reject InvalidTarget"));
  assert(
    markdown.includes(
      "Concurrent player complete race: post rejected GameAlreadyCompleted after completion",
    ),
  );
  assert(markdown.includes("Concurrent host publish race: Reject InvalidTarget"));
  assert(markdown.includes("Stale action conflict: Reject PhaseLocked"));
  assert(markdown.includes("Stale control: Reject PhaseLocked"));
  assert(markdown.includes("Stale host resolve: Reject PhaseLocked"));
  assert(markdown.includes("Stale host publish: Reject InvalidTarget"));
  assert(markdown.includes("Stale host complete: Reject GameAlreadyCompleted"));
  assert(markdown.includes("Stale player complete: Reject GameAlreadyCompleted"));
  assert(markdown.includes("Stale host deadline: Reject PhaseLocked"));
  assert(markdown.includes("Stale cohost deadline: Reject PhaseLocked"));
  const proofRun = buildDevTestGameProofRun(card, {
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameProofRun(proofRun);
  assert.equal(proofRun.status, "passed");
  assert.equal(proofRun.identityBootstrap.devSessionEndpointEnabled, false);
  assert.equal(proofRun.identityBootstrap.rootSessionSource, "auth_session");
  assert.equal(proofRun.productionReady, false);
  assert.equal(proofRun.releaseReady, false);
  const stalePrivatePostLane = proofRun.lanes.find(
    (lane) => lane.id === coreLoopPrivateChannelStalePostLaneId,
  );
  assert.equal(stalePrivatePostLane.status, "passed");
  assert.equal(
    stalePrivatePostLane.evidence.normalizedProofStatus,
    "passed",
  );
  assert.equal(
    stalePrivatePostLane.evidence.submitPostAckProof.command.channel_id,
    "private:mafia_day_chat",
  );
  assert.equal(
    stalePrivatePostLane.evidence.submitPostAckProof.receiptRefreshKeys,
    "thread,votecount,commandState,dayVoteOutcomes",
  );
  const completedPrivatePostLane = proofRun.lanes.find(
    (lane) => lane.id === coreLoopPrivateChannelCompletedPostLaneId,
  );
  assert.equal(completedPrivatePostLane.status, "passed");
  assert.equal(
    completedPrivatePostLane.evidence.normalizedProofStatus,
    "passed",
  );
  assert.equal(
    completedPrivatePostLane.evidence.completedPostRejectProof.commandStatus.error,
    "GameAlreadyCompleted",
  );
  assert.equal(
    completedPrivatePostLane.evidence.completedPostRejectProof.receiptRefreshKeys,
    "commandState",
  );
  for (const object of replacementPrivatePostNormalizedEvidenceObjects) {
    const lane = proofRun.lanes.find((candidate) => candidate.id === object.laneId);
    assert.equal(lane.status, "passed");
    assert.equal(lane.evidence.normalizedProofStatus, "passed");
    assert.equal(lane.evidence[object.name].status, "passed");
  }
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    const receipt = descriptor.buildReceipt(proofRun, {
      generatedAt: "2026-06-26T00:00:00.000Z",
    });
    descriptor.assertReceipt(receipt);
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.generatedFrom.roleUrl, descriptor.roleUrl);
    assert.deepEqual(receipt.laneIds, descriptor.laneIds);
  }
  assert.deepEqual(
    proofRun.lanes.map((lane) => lane.id),
    [
      "browser-entry",
      "host-setup-role",
      "cohost-console",
      "core-loop",
      "day-vote-resolution",
      "day-vote-no-lynch",
      "action-loop",
      "night-three-action-resolution",
      "host-deadline-advance",
      "stale-deadline-advance",
      "invalid-action-recovery",
      "resolution-receipts",
      "dead-player-recovery",
      "player-action-boundary",
      ...coreLoopPrivateChannelRecoveryLaneIds,
      ...replacementHandoffRecoveryLaneIds.slice(0, 8),
      staleConflictMessageLaneIds[0],
      ...replacementHandoffRecoveryLaneIds.slice(8),
      "idempotent-retry",
      "action-idempotent-retry",
      "concurrent-action-race",
      "concurrent-action-race-reload",
      "reconnect-recovery",
      "stale-player-vote",
      "stale-player-vote-after-change",
      "stale-player-withdraw-after-change",
      "stale-player-withdraw-after-phase-closure",
      "stale-player-vote-after-phase-closure",
      "stale-player-post-after-phase-closure",
      "concurrent-player-vote-resolve-race",
      "concurrent-player-vote-resolve-race-reload",
      "concurrent-player-action-advance-race",
      "concurrent-player-action-advance-race-reload",
      "concurrent-cohost-deadline-resolve-race",
      "concurrent-cohost-deadline-resolve-race-reload",
      ...replacementPrivatePostRaceLaneIds,
      "concurrent-replacement-vote-race",
      "concurrent-replacement-vote-race-reload",
      "concurrent-replacement-action-race",
      "concurrent-replacement-action-race-reload",
      "replacement-incoming-action",
      "replacement-action-reconnect",
      "replacement-stale-action-after-resolve",
      ...replacementPrivatePostRecoveryLaneIds,
      "stale-dead-target-vote",
      "dead-current-vote",
      "concurrent-vote-race",
      "concurrent-vote-race-reload",
      "stale-host-publish-after-change",
      "host-votecount-publication",
      "concurrent-host-publish-race",
      "concurrent-host-publish-race-reload",
      "stale-host-publish",
      "host-lifecycle-control",
      "stale-host-lifecycle",
      "stale-host-lifecycle-reload",
      "host-modkill-control",
      "stale-host-modkill",
      "stale-host-modkill-reload",
      "concurrent-host-lifecycle-race",
      "concurrent-host-lifecycle-race-reload",
      "stale-host-prompt",
      "stale-host-prompt-reload",
      "stale-host-complete",
      "stale-host-complete-reload",
      "stale-host-complete-reconnect-recovery",
      "concurrent-host-complete-race",
      "concurrent-host-complete-race-reload",
      "concurrent-player-complete-race",
      "public-player-complete-reload",
      "stale-player-complete",
      "stale-player-complete-reload",
      "stale-same-action-recovery",
      "stale-dead-action-conflict",
      "stale-action-conflict",
      "stale-action-conflict-message",
      "stale-action-reconnect-recovery",
      privateChannelStaleActionConflictMessageLaneId,
      "private-channel-stale-action-reconnect-recovery",
      "stale-host-control",
      "concurrent-host-resolve-race",
      "concurrent-host-resolve-race-reload",
      "concurrent-host-advance-race",
      "concurrent-host-advance-race-reload",
      "concurrent-host-deadline-advance-race",
      "concurrent-host-deadline-advance-race-reload",
      "concurrent-host-mixed-advance-race",
      "concurrent-host-mixed-advance-race-reload",
      "stale-host-resolve",
      "stale-host-resolve-reload",
      "stale-host-resolve-reconnect-recovery",
      "stale-host-advance",
      "stale-host-advance-reload",
      "stale-host-advance-reconnect-recovery",
      "stale-host-deadline",
      "stale-host-deadline-reload",
      "stale-host-deadline-reconnect-recovery",
      "stale-cohost-deadline",
      "stale-cohost-deadline-reload",
      "stale-cohost-deadline-reconnect-recovery",
    ],
  );
  const raceCoverage = buildDevTestGameRaceCoverage(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameRaceCoverage(raceCoverage);
  assert.equal(raceCoverage.status, "passed");
  assert.equal(raceCoverage.releaseReady, false);
  assert.equal(raceCoverage.productionReady, false);
  assert.equal(raceCoverage.summary.cellCount, 16);
  assert.equal(raceCoverage.summary.provenCellCount, 16);
  assert.equal(raceCoverage.summary.reloadRequiredCellCount, 16);
  assert.equal(raceCoverage.summary.reloadCoveredCellCount, 16);
  assert.equal(raceCoverage.summary.reloadGapCount, 0);
  assert.deepEqual(
    raceCoverage.cells
      .filter((cell) => cell.actorPair === "host vs host")
      .map((cell) => cell.id),
    [
      "host-resolve",
      "host-advance",
      "host-deadline-advance",
      "host-lifecycle",
      "host-mixed-advance",
      "host-votecount-publication",
      "host-complete-game",
    ],
  );
  const readiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameReleaseReadiness(readiness);
  assert.equal(readiness.status, "passed");
  assert.equal(readiness.readinessStatus, "not_ready");
  assert.equal(readiness.releaseReady, false);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.releaseReadiness.status, "not_ready");
  assert.equal(
    readiness.readinessSummary.status,
    readiness.releaseReadiness.status,
  );
  assert.equal(
    readiness.readinessSummary.unprovenCount,
    readiness.releaseReadiness.unproven.length,
  );
  assert(
    readiness.releaseReadiness.unproven.some(
      (item) => item.id === "production-identity" && item.status === "unproven",
    ),
  );
  assert(
    readiness.releaseReadiness.unproven.some(
      (item) => item.id === "backup-restore-drill" && item.status === "unproven",
    ),
  );
  const coreLoopReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    coreLoopAdminProofPath: devTestGameCoreLoopAdminProofPath,
    coreLoopAdminProof: coreLoopAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(coreLoopReadiness);
  assert.equal(
    coreLoopReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-core-loop-proof",
    ).adminRoleSurface.detailRoleUrl,
    localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
  );
  assert.deepEqual(
    coreLoopReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-core-loop-proof",
    ).spineTargets,
    coreLoopSpineTargetsFixture(),
  );
  assert.deepEqual(
    coreLoopReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-core-loop-proof",
    ).spineTargets.productionFeatureTargets.bySlotId["resolution-receipts"],
    featureSpineCaseFixture("resolution-receipts").spineTarget,
  );
  assert.equal(
    coreLoopReadiness.generatedFrom.coreLoopAdminProof,
    devTestGameCoreLoopAdminProofPath,
  );
  const hardeningReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    hardeningAdminProofPath: devTestGameHardeningAdminProofPath,
    hardeningAdminProof: hardeningAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hardeningReadiness);
  assert.equal(
    hardeningReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hardening-proof",
    ).adminRoleSurface.detailRoleUrl,
    localAdminAuditRoleUrl(localAdminAuditIds.hardening),
  );
  const hardeningRoleUrlHrefs = hardeningRoleUrlHrefsFromProofRun(proofRun);
  assert.deepEqual(
    hardeningReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hardening-proof",
    ).spineTargets,
    hardeningSpineTargetsFixture({ roleUrlHrefs: hardeningRoleUrlHrefs }),
  );
  assert.deepEqual(
    hardeningReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hardening-proof",
    ).spineTargets.productionFeatureTargets.bySlotId[
      "replacement-stale-conflict-message"
    ],
    featureSpineCaseFixture("replacement-stale-conflict-message", {
      roleUrlHrefs: hardeningRoleUrlHrefs,
    }).spineTarget,
  );
  assert.equal(
    hardeningReadiness.generatedFrom.hardeningAdminProof,
    devTestGameHardeningAdminProofPath,
  );
  assertReadinessRecoveryMilestonesMirrorProofCoverage({
    readiness: hardeningReadiness,
    proofRun,
  });
  const validatedHostSetupProof = validateDevTestGameHostSetupProof(
    hostSetupProofFixture(),
    {
      path: "target/dev-test-game/host-setup-proof.json",
    },
  );
  assert.equal(
    validatedHostSetupProof.roleUrl,
    "http://127.0.0.1:5173/g/<seeded-game>/setup",
  );
  const hostSetupReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    hostSetupProofPath: "target/dev-test-game/host-setup-proof.json",
    hostSetupProof: hostSetupProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostSetupReadiness);
  const hostSetupCheck = hostSetupReadiness.localDevelopmentSpine.checks.find(
    (item) => item.id === "local-host-setup-proof",
  );
  assert.deepEqual(
    [
      hostSetupReadiness.generatedFrom.hostSetupProof,
      hostSetupReadiness.localDevelopmentSpine.evidence.hostSetupProof.roleUrl,
      hostSetupCheck.roleUrl,
      hostSetupCheck.recoveryCommand,
      hostSetupCheck.readyCheckIds.includes("start-phase"),
      hostSetupCheck.spineTargets,
    ],
    [
      "target/dev-test-game/host-setup-proof.json",
      "http://127.0.0.1:5173/g/<seeded-game>/setup",
      "http://127.0.0.1:5173/g/<seeded-game>/setup",
      "npm run dev:test-game -- --verify-host-setup-only",
      true,
      hostSetupSpineTargetsFixture(),
    ],
  );
  const cohostCheck = hostSetupReadiness.localDevelopmentSpine.checks.find(
    (item) => item.id === "local-cohost-console-proof",
  );
  assert.deepEqual(
    [
      cohostCheck.roleUrl,
      cohostCheck.capabilityLabel,
      cohostCheck.extendDeadlineState,
      cohostCheck.hostOnlyRejectError,
      cohostCheck.phaseAfterRejectId,
      cohostCheck.phaseAfterRejectLocked,
      cohostCheck.recoveryCommand,
      cohostCheck.spineTargets,
    ],
    [
      cohostCheck.roleUrl,
      "CohostOf(<seeded-game>)",
      "ack",
      "NotHost",
      "D01",
      false,
      "npm run test:dev-test-game-core-live",
      cohostSpineTargetsFixture({ roleUrl: cohostCheck.roleUrl }),
    ],
  );
  const replacementCheck = hostSetupReadiness.localDevelopmentSpine.checks.find(
    (item) => item.id === "local-replacement-player-proof",
  );
  assert.deepEqual(
    [
      replacementCheck.roleUrl,
      replacementCheck.principalUserId,
      replacementCheck.commandStateSlot,
      replacementCheck.capabilityKinds,
      replacementCheck.hostIssuedInvite,
      replacementCheck.sessionRefresh,
      replacementCheck.incomingPlayer,
      replacementCheck.staleOutgoing,
      replacementCheck.privateAuthority,
      replacementCheck.recoveryCommand,
      replacementCheck.spineTargets,
    ],
    [
      "http://127.0.0.1:4102/g/<seeded-game>",
      "player-rowan",
      "slot-7",
      ["SlotOccupant", "ChannelMember"],
      {
        principalUserId: "player-rowan",
        issuedBy: "host_h",
        issuedByCapability: "HostOf",
        returnTo: "/g/<seeded-game>",
        tokenPresent: true,
      },
      {
        credentialKind: "session",
        usedInviteToken: false,
        landedOnDirectUrl: true,
        commandStateSlot: "slot-7",
      },
      {
        postState: "ack",
        voteState: "Ack",
        stableHistoryVisible: true,
        targetKillVisible: false,
        actionResultVisible: false,
      },
      {
        rejectError: "NotYourSlot",
        recoveredActorStatus: "replaced",
        buttonsDisabled: true,
      },
      {
        channel: "private:mafia_day_chat",
        staleRejectError: "NotYourSlot",
        staleRouteStatus: 403,
        rowanPostState: "ack",
        staleNotificationsStatus: 403,
        rowanNotificationsStatus: 200,
      },
      "npm run test:dev-test-game-core-live",
      replacementSpineTargetsFixture({ roleUrl: replacementCheck.roleUrl }),
    ],
  );
  const replacementActionCheck =
    hostSetupReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-replacement-action-proof",
    );
  assert.deepEqual(
    [
      replacementActionCheck.roleUrl,
      replacementActionCheck.incomingAction,
      replacementActionCheck.reconnect,
      replacementActionCheck.staleAction,
      replacementActionCheck.recoveryCommand,
      replacementActionCheck.spineTargets,
    ],
    [
      "http://127.0.0.1:4102/g/<replacement-action-game>",
      {
        game: "<replacement-action-game>",
        targetSlot: "slot-2",
        replacementState: "ack",
        actionState: "ack",
        targetAlive: false,
        staleOutgoingError: "NotYourSlot",
        rowanPrivateKillVisible: false,
      },
      {
        game: "<replacement-action-reconnect-game>",
        replacementState: "ack",
        actionState: "ack",
        reconnectState: "recovered",
        phaseLocked: true,
        actionCount: 0,
        targetNoticeStatus: "factional_kill",
        rowanPrivateKillVisible: false,
      },
      {
        game: "<replacement-stale-action-game>",
        rejectError: "PhaseLocked",
        refreshedPhase: "N01",
        refreshedLocked: true,
        refreshedActionCount: 0,
        targetAlive: true,
        rowanPrivateKillVisible: false,
        targetNoticePresent: false,
      },
      "npm run test:dev-test-game-core-live",
      replacementActionSpineTargetsFixture({
        roleUrl: replacementActionCheck.roleUrl,
      }),
    ],
  );
  const replacementPrivateCheck =
    hostSetupReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-replacement-private-proof",
    );
  assert.deepEqual(
    [
      replacementPrivateCheck.roleUrl,
      replacementPrivateCheck.authority,
      replacementPrivateCheck.receipts,
      replacementPrivateCheck.resolvedPost,
      replacementPrivateCheck.reconnect,
      replacementPrivateCheck.completedPost,
      replacementPrivateCheck.completedReload,
      replacementPrivateCheck.recoveryCommand,
      replacementPrivateCheck.spineTargets,
    ],
    [
      "http://127.0.0.1:4102/g/<replacement-private-game>/c/private%3Amafia_day_chat",
      {
        channel: "private:mafia_day_chat",
        staleRejectError: "NotYourSlot",
        staleRouteStatus: 403,
        rowanCapabilityLabel: "ChannelMember(private:mafia_day_chat)",
        rowanPostState: "ack",
      },
      {
        staleNotificationsStatus: 403,
        staleInvestigationResultsStatus: 403,
        rowanNotificationsStatus: 200,
        rowanInvestigationResultsStatus: 200,
        rowanPrivateQueueCount: 0,
      },
      {
        game: "<replacement-private-game>",
        channel: "private:mafia_day_chat",
        postState: "ack",
        refreshedPhase: "D01",
        refreshedLocked: true,
        staleRouteStatus: 403,
        normalizedProofStatus: "passed",
      },
      {
        game: "<replacement-private-game>",
        reconnectState: "recovered",
        recoveredPhase: "D01",
        recoveredLocked: true,
        staleThreadStatus: 403,
        normalizedProofStatus: "passed",
      },
      {
        game: "<replacement-private-completed-game>",
        rejectError: "GameAlreadyCompleted",
        gameCompleted: true,
        staleThreadStatus: 403,
        normalizedProofStatus: "passed",
      },
      {
        game: "<replacement-private-completed-game>",
        routeStatus: 200,
        gameCompleted: true,
        staleRouteStatus: 403,
        normalizedProofStatus: "passed",
      },
      "npm run test:dev-test-game-core-live",
      replacementPrivateSpineTargetsFixture({
        roleUrl: replacementPrivateCheck.roleUrl,
      }),
    ],
  );
  assert(hostSetupReadiness.releaseReadiness.reason.includes("local host setup proof"));
  const raceCoverageReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    raceCoveragePath: "target/dev-test-game/race-coverage.json",
    raceCoverage,
    raceCoverageAdminProofPath: devTestGameRaceCoverageAdminProofPath,
    raceCoverageAdminProof: raceCoverageAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(raceCoverageReadiness);
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-race-coverage-inventory",
    ).cellCount,
    16,
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-race-coverage-inventory",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-race-coverage?game=<seeded-game>",
  );
  assert.equal(
    raceCoverageReadiness.generatedFrom.raceCoverage,
    "target/dev-test-game/race-coverage.json",
  );
  assert.equal(
    raceCoverageReadiness.generatedFrom.raceCoverageAdminProof,
    devTestGameRaceCoverageAdminProofPath,
  );
  for (const milestoneCase of raceCoverageLocalReadinessMilestoneCases()) {
    assert.deepEqual(
      raceCoverageReadiness.generatedFrom[milestoneCase.generatedFromKey],
      raceReloadMilestoneFixture(milestoneCase.groupId),
    );
    assert.deepEqual(
      raceCoverageReadiness.localDevelopmentSpine.checks.find(
        (item) => item.id === milestoneCase.id,
      ),
      {
        id: milestoneCase.id,
        label: milestoneCase.label,
        status: "passed",
        evidence: "target/dev-test-game/race-coverage.json",
        proofBoundary: milestoneCase.proofBoundary,
        cellIds: [...milestoneCase.cellIds],
        requiredCellCount: milestoneCase.cellIds.length,
        coveredCellCount: milestoneCase.cellIds.length,
      },
    );
  }
  assert.deepEqual(
    raceCoverageReadiness.generatedFrom.raceCoveragePromotedMilestones,
    raceCoveragePromotedMilestonesFixture({ groupStatus: "passed" }),
  );
  assert.equal(
    raceCoverageReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-race-coverage-promoted-milestones",
    ).passedGroupCount,
    4,
  );
  assert(
    raceCoverageReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "hosted-concurrent-race-matrix" &&
        item.requiredEvidence.includes("Hosted or hosted-like concurrent command race matrix"),
    ),
  );
  const hostedMatrix =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(raceCoverageReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedTarget: {
        frontendBaseUrl: null,
        apiBaseUrl: null,
        evidencePath: null,
        evidence: undefined,
      },
    });
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(hostedMatrix);
  assert.equal(hostedMatrix.status, "passed");
  assert.equal(hostedMatrix.releaseReady, false);
  assert.equal(
    hostedMatrix.requestedEvidence.firstProofTarget,
    devTestGameHostedConcurrentRaceMatrixPath,
  );
  assert.equal(hostedMatrix.summary.cellCount, 16);
  assert.equal(hostedMatrix.summary.reloadCoveredCellCount, 16);
  assert.equal(
    hostedMatrix.summary.reconnectLaneCount,
    hostedMatrixReconnectLaneIds.length,
  );
  assert.equal(
    hostedMatrix.summary.staleConflictLaneCount,
    hostedMatrixStaleConflictLaneIds.length,
  );
  assert.deepEqual(
    hostedMatrix.staleConflictMilestones.map((milestone) => [
      milestone.id,
      milestone.status,
      milestone.laneId,
      milestone.progressCheckId,
    ]),
    hostedMatrixStaleConflictMilestoneCases().map((scenario) => [
      scenario.id,
      "passed",
      scenario.laneId,
      scenario.progressCheckId,
    ]),
  );
  assert.equal(hostedMatrix.summary.hostedEvidenceStatus, "not_configured");
  assert.equal(hostedMatrix.summary.hostedEvidenceMode, "not_configured");
  assert.equal(
    hostedMatrix.summary.localDemoHostedEvidenceStatus,
    "not_applicable",
  );
  assert.equal(hostedMatrix.summary.realHostedEvidenceStatus, "unproven");
  assert.equal(hostedMatrix.summary.realHostedDeploymentStatus, "unproven");
  assert.equal(
    hostedMatrix.realHostedEvidenceInputs.command,
    hostedMatrixRealHostedEvidenceCommand,
  );
  assert.equal(
    hostedMatrix.realHostedEvidenceInputs.proofTarget,
    hostedMatrixExternalEvidenceProofTarget,
  );
  assert.equal(hostedMatrix.hostedHandoffChecklist.status, "blocked");
  assert.equal(
    hostedMatrix.hostedHandoffChecklist.preflightStatus,
    "not_configured",
  );
  assert.deepEqual(
    hostedMatrix.hostedHandoffChecklist.blockedCheckIds,
    hostedMatrixRealHostedBlockedCheckIds,
  );
  assert.deepEqual(
    hostedMatrix.hostedHandoffChecklist.blockedReceipt.missingRequiredInputs,
    [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
  );
  assert.match(
    hostedMatrix.hostedHandoffChecklist.blockedChecks.find(
      (check) => check.id === "real-hosted-stale-client-proof-inputs",
    )?.requiredEvidence ?? "",
    /stale-client conflict messages/,
  );
  assert.equal(hostedMatrix.externalHostedEvidence.status, "not_configured");
  assert(
    hostedMatrix.hostedLikeTarget.roleSurfaces.every(
      (surface) =>
        surface.directUrl.startsWith("http://") &&
        !surface.directUrl.includes("invite=") &&
        !("token" in surface) &&
        !("inviteToken" in surface) &&
        !("loginUrl" in surface),
    ),
  );
  assert.deepEqual(
    hostedMatrix.generatedFrom.raceCoveragePromotedMilestones.groupIds,
    [
      "replacement-race-reload",
      "host-concurrent-race-reload",
      "player-concurrent-action-reload",
      "cohost-deadline-race-reload",
    ],
  );
  assert.deepEqual(
    hostedMatrix.evidenceProgress.map((item) => [item.id, item.status]),
    [
      ...hostedMatrixProgressCheckIds
        .slice(0, 6)
        .map((checkId) => [checkId, "passed"]),
      [hostedMatrixProgressCheckIds[6], "not_applicable"],
      [hostedMatrixProgressCheckIds[7], "unproven"],
      [hostedMatrixProgressCheckIds[8], "unproven"],
    ],
  );
  const hostedMatrixWithExternalTarget =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(raceCoverageReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedTarget: {
        frontendBaseUrl: "https://fmarch.example.test",
        apiBaseUrl: "https://api.fmarch.example.test",
        evidencePath: "target/dev-test-game/hosted-matrix-external.json",
        evidence: {
          proof: "fmarch-hosted-concurrent-race-matrix-evidence",
          status: "passed",
          generatedAt: "2026-06-26T00:00:00.000Z",
          frontendBaseUrl: "https://fmarch.example.test",
          apiBaseUrl: "https://api.fmarch.example.test",
          groupIds: ["replacement-race-reload"],
          cellIds: ["replacement-private-post"],
          commandRaceCount: 1,
          reloadRecoveryCount: 1,
          reconnectRecovery: true,
          staleConflictMessages: true,
          rawRoleCredentialsRedacted: true,
        },
      },
    });
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(
    hostedMatrixWithExternalTarget,
  );
  assert.equal(
    hostedMatrixWithExternalTarget.summary.hostedEvidenceStatus,
    "passed",
  );
  assert.equal(
    hostedMatrixWithExternalTarget.summary.hostedEvidenceMode,
    "real-hosted",
  );
  assert.equal(
    hostedMatrixWithExternalTarget.summary.localDemoHostedEvidenceStatus,
    "not_applicable",
  );
  assert.equal(
    hostedMatrixWithExternalTarget.summary.realHostedEvidenceStatus,
    "passed",
  );
  assert.equal(
    hostedMatrixWithExternalTarget.hostedHandoffChecklist,
    undefined,
  );
  assert.equal(hostedMatrixWithExternalTarget.externalHostedEvidence.status, "passed");
  assert.deepEqual(
    hostedMatrixWithExternalTarget.evidenceProgress.find(
      (item) => item.id === "real-hosted-evidence-required",
    ),
    {
      id: "real-hosted-evidence-required",
      status: "passed",
      evidence: [
        "https://fmarch.example.test",
        "https://api.fmarch.example.test",
        "target/dev-test-game/hosted-matrix-external.json",
      ],
    },
  );
  assert.deepEqual(
    hostedMatrixWithExternalTarget.evidenceProgress.find(
      (item) => item.id === "real-hosted-deployment",
    ),
    {
      id: "real-hosted-deployment",
      status: "passed",
      evidence: [
        "https://fmarch.example.test",
        "https://api.fmarch.example.test",
        "target/dev-test-game/hosted-matrix-external.json",
      ],
      requiredEvidence:
        "Externally reachable hosted API/frontend deployment, multi-node command race execution, and hosted reconnect/stale-client evidence.",
    },
  );
  assert.deepEqual(hostedMatrixWithExternalTarget.remainingGaps, [
    "beta/release/operator readiness and human rollback path",
  ]);
  const rawEvidence = buildDevTestGameHostedMatrixRawEvidence({
    matrix: hostedMatrix,
    generatedAt: "2026-06-26T00:00:00.000Z",
    frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
    apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
  });
  assertDevTestGameHostedMatrixRawEvidence(rawEvidence, {
    frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
    apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
  });
  assert.equal(
    devTestGameHostedMatrixRawEvidenceCommand,
    "test:dev-test-game-hosted-matrix-raw-evidence",
  );
  assert.equal(
    devTestGameHostedMatrixRawEvidencePath,
    "target/dev-test-game/hosted-matrix-raw.json",
  );
  assert.deepEqual(
    rawEvidence.observations.map((observation) => observation.cellId),
    [
      "replacement-private-post",
      "replacement-vote",
      "replacement-action",
    ],
  );
  const externalEvidence =
    buildDevTestGameHostedMatrixExternalEvidence({
      matrix: hostedMatrix,
      rawEvidence,
      generatedAt: "2026-06-26T00:00:00.000Z",
      frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
      apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
      rawEvidenceSource: "target/dev-test-game/hosted-matrix-raw.json",
    });
  assertDevTestGameHostedMatrixExternalEvidence(externalEvidence, {
    frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
    apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
  });
  assert.equal(externalEvidence.proof, "fmarch-hosted-concurrent-race-matrix-evidence");
  assert.deepEqual(externalEvidence.groupIds, ["replacement-race-reload"]);
  assert.deepEqual(externalEvidence.cellIds, [
    "replacement-private-post",
    "replacement-vote",
    "replacement-action",
  ]);
  assert.equal(
    devTestGameHostedMatrixExternalEvidenceCommand,
    "test:dev-test-game-hosted-matrix-external-evidence",
  );
  assert.equal(
    devTestGameHostedMatrixExternalEvidencePath,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  const laneFrontendBaseUrl = "https://fmarch.example.test";
  const laneApiBaseUrl = "https://api.fmarch.example.test";
  const laneRawEvidence = {
    ...rawEvidence,
    frontendBaseUrl: laneFrontendBaseUrl,
    apiBaseUrl: laneApiBaseUrl,
  };
  assertDevTestGameHostedMatrixRawEvidence(laneRawEvidence, {
    frontendBaseUrl: laneFrontendBaseUrl,
    apiBaseUrl: laneApiBaseUrl,
  });
  await mkdir("target/dev-test-game", { recursive: true });
  await Promise.all([
    writeFile(
      devTestGameHostedConcurrentRaceMatrixPath,
      `${JSON.stringify(hostedMatrix, null, 2)}\n`,
    ),
    writeFile(
      devTestGameHostedMatrixRawEvidencePath,
      `${JSON.stringify(laneRawEvidence, null, 2)}\n`,
    ),
  ]);
  const passedLaneExternalEvidencePath =
    "target/dev-test-game/hosted-matrix-external-lane-pass.json";
  const passedLane = await runDevTestGameHostedEvidenceLane({
    generatedAt: "2026-06-26T00:00:00.000Z",
    env: {
      FMARCH_HOSTED_MATRIX_FRONTEND_URL: laneFrontendBaseUrl,
      FMARCH_HOSTED_MATRIX_API_URL: laneApiBaseUrl,
      FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH:
        devTestGameHostedMatrixRawEvidencePath,
      FMARCH_HOSTED_MATRIX_EVIDENCE_PATH: passedLaneExternalEvidencePath,
    },
  });
  assertDevTestGameHostedEvidenceLane(passedLane);
  assert.equal(passedLane.status, "passed");
  assert.equal(passedLane.preflightStatus, "passed");
  assert.deepEqual(passedLane.blockedCheckIds, []);
  assert.equal(passedLane.hostedEvidence.mode, "real-hosted");
  assert.equal(passedLane.hostedEvidence.realHostedEvidenceStatus, "passed");
  assert.equal(
    passedLane.nextCommand,
    `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`,
  );
  assert.equal(passedLane.nextProofTarget, passedLaneExternalEvidencePath);
  assert.deepEqual(
    passedLane.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-target-preflight", "passed"],
      ["external-hosted-evidence-written", "passed"],
      ["local-demo-pass-path", "not_applicable"],
      ["real-hosted-evidence-required", "passed"],
      ["release-claim-boundary-carried", "passed"],
    ],
  );
  const passedLanePreflight = assertDevTestGameHostedTargetPreflight(
    JSON.parse(await readFile(devTestGameHostedTargetPreflightPath, "utf8")),
  );
  assert.equal(passedLanePreflight.status, "passed");
  assert.equal(
    passedLanePreflight.nextProofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
  const passedLaneExternalEvidence =
    assertDevTestGameHostedMatrixExternalEvidence(
      JSON.parse(await readFile(passedLaneExternalEvidencePath, "utf8")),
      {
        frontendBaseUrl: laneFrontendBaseUrl,
        apiBaseUrl: laneApiBaseUrl,
      },
    );
  assert.deepEqual(passedLaneExternalEvidence.generatedFrom, {
    hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
    hostedConcurrentRaceMatrixGeneratedAt: hostedMatrix.generatedAt,
    rawEvidence: devTestGameHostedMatrixRawEvidencePath,
    rawEvidenceGeneratedAt: laneRawEvidence.generatedAt,
    rawEvidenceSyntheticExternalTarget: false,
  });
  const laneFreshManifest = buildDevTestGameSpineManifest({
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshness: {
      version: 1,
      proof: "dev-test-game-proof-freshness",
      status: "passed",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      proofBoundary: "test freshness boundary",
      summary: {
        artifactCount: 1,
        freshCount: 1,
        staleCount: 0,
        missingCount: 0,
      },
      artifacts: [
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
        },
      ],
    },
  });
  const passedLaneNextAction = buildDevTestGameNextAction(laneFreshManifest, {
    generatedAt: "2026-06-26T00:00:01.000Z",
    opsArtifacts: devTestGameOpsArtifactsFixture(),
    raceCoverage: devTestGameRaceCoverageFixture(),
    releaseReadinessChecklist: devTestGameReleaseReadinessChecklistFixture({
      unproven: [
        {
          id: "hosted-deployment",
          status: "unproven",
          requiredEvidence:
            "Hosted API/frontend deployment proof with external health checks",
        },
      ],
    }),
    hostedTargetPreflight: passedLanePreflight,
  });
  assertDevTestGameNextAction(passedLaneNextAction);
  assert.equal(
    passedLaneNextAction.nextAction.unproven.proofTarget,
    devTestGameHostedMatrixExternalEvidencePath,
  );
  assert.equal(
    passedLaneNextAction.nextAction.unproven.roleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    passedLaneNextAction.nextAction.unproven.proofGraphNodeId,
    "admin-proof:hosted-concurrent-race-matrix",
  );
  const demoProof = await runDevTestGameHostedEvidenceLaneDemoProof({
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameHostedEvidenceLaneDemoProof(demoProof);
  assert.equal(
    devTestGameHostedEvidenceLaneDemoProofCommand,
    "test:dev-test-game-hosted-evidence-lane-demo-proof",
  );
  assert.equal(
    devTestGameHostedEvidenceLaneDemoProofPath,
    "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
  );
  assert.equal(
    demoProof.generatedFrom.rawEvidence,
    devTestGameHostedEvidenceLaneDemoRawEvidencePath,
  );
  assert.equal(
    demoProof.generatedFrom.externalEvidence,
    devTestGameHostedEvidenceLaneDemoExternalEvidencePath,
  );
  assert.equal(demoProof.target.syntheticExternalTarget, true);
  assert.equal(demoProof.blockedLane.status, "blocked");
  assert.equal(demoProof.passedLane.status, "passed");
  assert.equal(demoProof.passedLane.hostedEvidenceMode, "synthetic-demo");
  assert.equal(demoProof.passedLane.realHostedEvidenceStatus, "unproven");
  assert.equal(
    demoProof.handoff.blockedRoleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    demoProof.handoff.passedRoleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    demoProof.externalEvidence.rawRoleCredentialsRedacted,
    true,
  );
  assert.equal(demoProof.externalEvidence.sourceMode, "synthetic-demo");
  assert.equal(demoProof.externalEvidence.rawEvidenceSyntheticExternalTarget, true);
  const hostedMatrixWithProducedExternalEvidence =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(raceCoverageReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedTarget: {
        frontendBaseUrl: hostedMatrix.hostedLikeTarget.frontendBaseUrl,
        apiBaseUrl: hostedMatrix.hostedLikeTarget.apiBaseUrl,
        evidencePath: devTestGameHostedMatrixExternalEvidencePath,
        evidence: externalEvidence,
      },
    });
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.externalHostedEvidence.status,
    "passed",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.hostedEvidenceStatus,
    "passed",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.hostedEvidenceMode,
    "local-or-loopback",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.localDemoHostedEvidenceStatus,
    "not_applicable",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.realHostedEvidenceStatus,
    "unproven",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.summary.realHostedDeploymentStatus,
    "unproven",
  );
  assert.equal(
    hostedMatrixWithProducedExternalEvidence.evidenceProgress.find(
      (item) => item.id === "real-hosted-deployment",
    ).status,
    "unproven",
  );
  const hostedMatrixReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    raceCoveragePath: "target/dev-test-game/race-coverage.json",
    raceCoverage,
    hostedConcurrentRaceMatrixPath: devTestGameHostedConcurrentRaceMatrixPath,
    hostedConcurrentRaceMatrix: hostedMatrix,
    hostedConcurrentRaceMatrixAdminProofPath:
      "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
    hostedConcurrentRaceMatrixAdminProof:
      hostedConcurrentRaceMatrixAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostedMatrixReadiness);
  assert(
    hostedMatrixReadiness.localDevelopmentSpine.checks.some(
      (item) =>
        item.id === "local-hosted-concurrent-race-matrix" &&
        item.status === "passed" &&
        item.cellCount === 16 &&
        item.staleConflictMilestones?.[0]?.id ===
          hostedMatrixStaleConflictMilestoneCases()[0].id,
    ),
  );
  assert.equal(
    hostedMatrixReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-concurrent-race-matrix",
    ),
    false,
  );
  assert(
    hostedMatrixReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "real-hosted-concurrent-race-matrix" &&
        item.status === "unproven",
    ),
  );
  const refreshedHostedMatrix =
    buildDevTestGameHostedConcurrentRaceMatrixEvidence(hostedMatrixReadiness, {
      raceCoverage,
      proofRun,
      session: card,
      generatedAt: "2026-06-26T00:00:00.000Z",
    });
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(refreshedHostedMatrix);
  assert.equal(
    refreshedHostedMatrix.requestedEvidence.id,
    "real-hosted-concurrent-race-matrix",
  );
  assert.equal(refreshedHostedMatrix.hostedHandoffChecklist.status, "blocked");
  assert.equal(
    refreshedHostedMatrix.hostedHandoffChecklist.command,
    hostedMatrixRealHostedEvidenceCommand,
  );
  const opsArtifacts = buildDevTestGameOpsArtifacts({
    session: card,
    proofRun,
    readiness,
    generatedAt: "2026-06-26T00:00:00.000Z",
    artifacts: {
      session: artifactSummary("target/dev-test-game/session.json"),
      proofRun: artifactSummary("target/dev-test-game/proof-run.json"),
      readiness: artifactSummary(
        "target/dev-test-game/release-readiness-checklist.json",
      ),
    },
  });
  assertDevTestGameOpsArtifacts(opsArtifacts);
  assert.equal(opsArtifacts.status, "passed");
  assert.equal(opsArtifacts.releaseReady, false);
  assert.equal(opsArtifacts.productionReady, false);
  assert.equal(opsArtifacts.run.game, game);
  assert.equal(opsArtifacts.run.seedCommandCount, 1);
  assert.equal(opsArtifacts.proofRun.laneCount, proofRun.lanes.length);
  assert.equal(opsArtifacts.proofStability.hostConfirmClicks.total, 4);
  assert.equal(
    opsArtifacts.checks.some(
      (check) =>
        check.id === "proof-stability-summarized" &&
        check.hostConfirmClicks === 4 &&
        check.concurrentClickCount === 0 &&
        check.retryClickCount === 1,
    ),
    true,
  );
  assert.equal(
    opsArtifacts.roles.host.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=REDACTED`,
  );
  assert.equal(opsArtifacts.roles.replacementPlayer.credentialKind, "session");
  assert.equal(
    opsArtifacts.roles.replacementPlayer.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}`,
  );
  assert.equal(
    opsArtifacts.roles.replacementPlayer.loginUrlRedacted.includes("invite="),
    false,
  );
  assert.equal(JSON.stringify(opsArtifacts).includes("dev-test-card-host"), false);
  assert.equal(JSON.stringify(opsArtifacts).includes("dev-test-card-player"), false);
  assert.equal(
    JSON.stringify(opsArtifacts).includes("replacement-session-refresh-token"),
    false,
  );
  const opsReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    opsArtifactsPath: devTestGameOpsArtifactsPath,
    opsArtifacts,
    opsAdminProofPath: devTestGameOpsAdminProofPath,
    opsAdminProof: opsAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(opsReadiness);
  assert(
    opsReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-ops-artifact-bundle" && item.status === "passed",
    ),
  );
  assert.deepEqual(
    opsReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-ops-artifact-bundle",
    ).spineLane,
    {
      manifestCommandKey: "ops",
      command: "npm run test:dev-test-game-ops",
    },
  );
  assert.equal(
    opsReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-ops-artifact-bundle",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-ops-artifacts?game=<seeded-game>",
  );
  assert.equal(
    opsReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "observability-and-operations",
    ),
    false,
  );
  assert(
    opsReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "hosted-observability-and-operations" &&
        item.status === "unproven",
    ),
  );
  const hostedOpsSignals = buildDevTestGameHostedOpsSignals({
    opsArtifacts,
    hostedConcurrentRaceMatrix: hostedMatrix,
    readiness: opsReadiness,
    generatedAt: "2026-06-26T00:00:00.000Z",
    artifacts: {
      opsArtifacts: artifactSummary(devTestGameOpsArtifactsPath),
      hostedConcurrentRaceMatrix: artifactSummary(
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      ),
      readiness: artifactSummary(devTestGameReleaseReadinessPath),
    },
  });
  assertDevTestGameHostedOpsSignals(hostedOpsSignals);
  assert.equal(devTestGameHostedOpsSignalsCommand, "test:dev-test-game-hosted-ops-signals");
  assert.equal(
    devTestGameHostedOpsSignalsPath,
    "target/dev-test-game/hosted-ops-signals.json",
  );
  assert.equal(hostedOpsSignals.matrix.cellCount, 16);
  assert.equal(
    hostedOpsSignals.checks.find(
      (check) => check.id === hostedOpsTelemetryBoundaryCheckId,
    )
      .status,
    "unproven",
  );
  const hostedOpsReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    opsArtifactsPath: devTestGameOpsArtifactsPath,
    opsArtifacts,
    hostedOpsSignalsPath: devTestGameHostedOpsSignalsPath,
    hostedOpsSignals,
    hostedOpsSignalsAdminProofPath: devTestGameHostedOpsSignalsAdminProofPath,
    hostedOpsSignalsAdminProof: hostedOpsSignalsAdminProofFixture(),
    realHostedObservabilityHandoffAdminProofPath:
      hostedAdminHandoffProofArtifactCase(
        "realHostedObservabilityHandoffAdminProof",
      ).path,
    realHostedObservabilityHandoffAdminProof:
      realHostedObservabilityHandoffAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostedOpsReadiness);
  const hostedOpsReadinessCheck =
    hostedOpsReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hosted-ops-signals",
    );
  assert.equal(hostedOpsReadinessCheck.status, "passed");
  assert.equal(hostedOpsReadinessCheck.cellCount, 16);
  assert.equal(
    hostedOpsReadinessCheck.realHostedObservabilityHandoffAdminRoleSurface
      .path,
    hostedAdminHandoffProofArtifactCase(
      "realHostedObservabilityHandoffAdminProof",
    ).path,
  );
  assert.equal(
    hostedOpsReadiness.generatedFrom.realHostedObservabilityHandoffAdminProof,
    hostedAdminHandoffProofArtifactCase(
      "realHostedObservabilityHandoffAdminProof",
    ).path,
  );
  assert.equal(
    hostedOpsReadiness.localDevelopmentSpine.evidence.hostedOpsSignals
      .realHostedObservabilityHandoffAdminRoleSurface.path,
    hostedAdminHandoffProofArtifactCase(
      "realHostedObservabilityHandoffAdminProof",
    ).path,
  );
  assert.equal(
    hostedOpsReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-observability-and-operations",
    ),
    false,
  );
  assert(
    hostedOpsReadiness.releaseReadiness.unproven.some(
      (item) =>
        item.id === "real-hosted-observability-and-operations" &&
        item.status === "unproven",
    ),
  );
  const hostedEvidenceLaneReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    hostedEvidenceLaneAdminProofPath: devTestGameHostedEvidenceLaneAdminProofPath,
    hostedEvidenceLaneAdminProof: hostedEvidenceLaneAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(hostedEvidenceLaneReadiness);
  const hostedEvidenceLaneCheck =
    hostedEvidenceLaneReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hosted-evidence-lane-admin-surface",
    );
  assert.equal(hostedEvidenceLaneCheck.status, "passed");
  assert.equal(hostedEvidenceLaneCheck.laneStatus, "blocked");
  assert.equal(hostedEvidenceLaneCheck.preflightStatus, "blocked");
  assert.equal(hostedEvidenceLaneCheck.blockedCheckCount, 5);
  assert.equal(
    hostedEvidenceLaneCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    hostedEvidenceLaneCheck.adminRoleSurface.preflightStatus,
    "blocked",
  );
  const hostedEvidenceLaneDemoReadiness = buildDevTestGameReleaseReadiness(
    proofRun,
    {
      generatedAt: "2026-06-26T00:00:00.000Z",
      hostedEvidenceLaneDemoProofPath:
        "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
      hostedEvidenceLaneDemoProof: hostedEvidenceLaneDemoProofFixture(),
    },
  );
  assertDevTestGameReleaseReadiness(hostedEvidenceLaneDemoReadiness);
  const hostedEvidenceLaneDemoCheck =
    hostedEvidenceLaneDemoReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hosted-evidence-lane-demo-proof",
    );
  assert.equal(hostedEvidenceLaneDemoCheck.status, "passed");
  assert.equal(hostedEvidenceLaneDemoCheck.dependencyGated, true);
  assert.equal(hostedEvidenceLaneDemoCheck.demoOnly, true);
  assert.equal(hostedEvidenceLaneDemoCheck.syntheticExternalTarget, true);
  assert.equal(hostedEvidenceLaneDemoCheck.blockedLaneStatus, "blocked");
  assert.equal(hostedEvidenceLaneDemoCheck.passedLaneStatus, "passed");
  assert.equal(
    hostedEvidenceLaneDemoCheck.passedRoleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    hostedEvidenceLaneDemoCheck.recovery.roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(
    hostedEvidenceLaneDemoReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-deployment",
    ),
    true,
  );
  assert.equal(
    hostedEvidenceLaneDemoReadiness.localDevelopmentSpine.evidence
      .hostedEvidenceLaneDemoProof.demoOnly,
    true,
  );
  const seedFixture = buildDevTestGameSeedFixtureSummary({
    session: card,
    proofRun,
    readiness: opsReadiness,
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  assertDevTestGameSeedFixtureSummary(seedFixture);
  assert.equal(seedFixture.status, "passed");
  assert.equal(seedFixture.releaseReady, false);
  assert.equal(seedFixture.productionReady, false);
  assert.equal(seedFixture.fixture.game, game);
  assert.equal(seedFixture.fixture.slots.length, 5);
  assert.equal(
    seedFixture.fixture.roles.host.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=REDACTED`,
  );
  assert.equal(seedFixture.fixture.roles.replacementPlayer.credentialKind, "session");
  assert.equal(
    seedFixture.fixture.roles.replacementPlayer.loginUrlRedacted,
    `http://127.0.0.1:4102/auth/login?returnTo=%2Fg%2F${game}`,
  );
  assert.equal(
    seedFixture.fixture.roles.replacementPlayer.loginUrlRedacted.includes("invite="),
    false,
  );
  assert.equal(JSON.stringify(seedFixture).includes("dev-test-card-host"), false);
  assert.equal(JSON.stringify(seedFixture).includes("dev-test-card-player"), false);
  assert.equal(
    JSON.stringify(seedFixture).includes("replacement-session-refresh-token"),
    false,
  );
  assert.deepEqual(
    seedFixture.demoScenarios.map((scenario) => scenario.id),
    seedScenarioCoverageGroups.allDemo,
  );
  assert.equal(seedFixture.proofLaneCoverage.status, "passed");
  assert.equal(seedFixture.proofLaneCoverage.unclassified.count, 0);
  assert.deepEqual(
    seedFixture.proofLaneCoverage,
    seedProofLaneCoverageForPassedLanes(
      proofRun.lanes
        .filter((lane) => lane.status === "passed")
        .map((lane) => lane.id),
    ),
  );
  assert.deepEqual(
    seedFixture.proofLaneCoverage.aliasOnly.laneIds,
    seedProofLaneCoverageFixture().aliasOnly.laneIds,
  );
  assert.deepEqual(
    seedFixture.proofLaneCoverage.aggregateOnly.laneIds,
    seedProofLaneCoverageFixture().aggregateOnly.laneIds,
  );
  const seedFixtureReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    opsArtifactsPath: devTestGameOpsArtifactsPath,
    opsArtifacts,
    seedFixtureSummaryPath: "target/dev-test-game/seed-fixture-summary.json",
    seedFixtureSummary: seedFixture,
    seedAdminProofPath: devTestGameSeedAdminProofPath,
    seedAdminProof: seedAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(seedFixtureReadiness);
  assert(
    seedFixtureReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-seed-demo-fixture" && item.status === "passed",
    ),
  );
  assert.equal(
    seedFixtureReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-seed-demo-fixture",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-seed-fixtures?game=<seeded-game>",
  );
  assert.deepEqual(
    seedFixtureReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-seed-demo-fixture",
    ).spineLane,
    {
      manifestCommandKey: "seedFixture",
      command: "npm run test:dev-test-game-seed-fixture",
    },
  );
  assert.equal(
    seedFixtureReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-seed-demo-fixture",
    ).proofLaneCoverage.unclassified.count,
    0,
  );
  assert.equal(
    seedFixtureReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "seed-demo-fixtures",
    ),
    false,
  );
  assert(
    seedFixtureReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-demo-fixtures" && item.status === "unproven",
    ),
  );
  const identityReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    identityAdapterProofPath:
      "target/auth-invite-role-proof/invite-role-proof.json",
    identityAdapterProof: identityAdapterProofFixture(game),
    identityAdminProofPath: devTestGameIdentityAdminProofPath,
    identityAdminProof: identityAdminProofFixture(),
    hostedIdentityEvidenceAdminProofPath:
      "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
    hostedIdentityEvidenceAdminProof: hostedIdentityEvidenceAdminProofFixture(),
    hostedIdentityCompleteAdminProofPath:
      devTestGameHostedIdentityCompleteAdminProofPath,
    hostedIdentityCompleteAdminProof: hostedIdentityCompleteAdminProofFixture(),
    hostedIdentityProgressionSummaryPath:
      devTestGameHostedIdentityProgressionSummaryPath,
    hostedIdentityProgressionSummary:
      buildDevTestGameHostedIdentityProgressionSummary({
        generatedAt: "2026-06-26T00:00:00.000Z",
      }),
  });
  assertDevTestGameReleaseReadiness(identityReadiness);
  assert(
    identityReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-identity-adapter-proof" && item.status === "passed",
    ),
  );
  assert.equal(
    identityReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-identity-adapter-proof",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-identity-adapter?game=<seeded-game>",
  );
  assert.equal(
    identityReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "production-identity",
    ),
    false,
  );
  const hostedIdentityEvidenceCheck =
    identityReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hosted-identity-evidence-admin-surface",
    );
  assert.equal(hostedIdentityEvidenceCheck.status, "passed");
  assert.equal(hostedIdentityEvidenceCheck.evidenceStatus, "blocked");
  assert.equal(hostedIdentityEvidenceCheck.handoffReceiptStatus, "blocked");
  assert.equal(
    hostedIdentityEvidenceCheck.handoffReceiptNextProofTarget,
    "target/dev-test-game/hosted-identity-evidence.json",
  );
  assert.deepEqual(
    hostedIdentityEvidenceCheck.handoffReceiptMissingRequiredInputs,
    hostedIdentityEvidenceHandoffCase().blockedReceipt.missingRequiredInputs,
  );
  assert.equal(
    hostedIdentityEvidenceCheck.handoffReceiptMissingInputCount,
    hostedIdentityEvidenceHandoffCase().blockedReceipt.missingRequiredInputs.length,
  );
  assert.equal(
    identityReadiness.generatedFrom.hostedIdentityProgressionSummary,
    devTestGameHostedIdentityProgressionSummaryPath,
  );
  assert.equal(
    identityReadiness.localDevelopmentSpine.evidence
      .hostedIdentityProgressionSummary.progressionCount,
    hostedIdentityEvidenceFamilyProgressionCases.length,
  );
  assert.deepEqual(
    hostedIdentityEvidenceCheck.progressionIds,
    hostedIdentityEvidenceFamilyProgressionCases.map(
      (progression) => progression.id,
    ),
  );
  assert.deepEqual(
    hostedIdentityEvidenceCheck.progressionProofTargets,
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) =>
      hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
    ),
  );
  assert.deepEqual(
    hostedIdentityEvidenceCheck.progressionSummary.progressions.map(
      (progression) => [
        progression.id,
        progression.missingFixturePath,
        progression.recoveredFixturePath,
        progression.proofCommand,
        progression.adminProofTarget,
      ],
    ),
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => [
      progression.id,
      progression.missingFixturePath,
      progression.recoveredFixturePath,
      `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=${progression.id} npm run ${devTestGameHostedIdentityProgressionAdminProofCommand}`,
      hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
    ]),
  );
  const hostedIdentityCompleteCheck =
    identityReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-hosted-identity-complete-redacted-packet",
    );
  assert.equal(hostedIdentityCompleteCheck.status, "passed");
  assert.equal(
    hostedIdentityCompleteCheck.evidence,
    devTestGameHostedIdentityCompleteAdminProofPath,
  );
  assert.equal(hostedIdentityCompleteCheck.rawEvidencePathKind, "fixture");
  assert.equal(
    hostedIdentityCompleteCheck.rawEvidencePath,
    hostedIdentityEvidenceRedactedPassFixturePath,
  );
  assert.equal(hostedIdentityCompleteCheck.releaseReady, false);
  assert.equal(hostedIdentityCompleteCheck.productionReady, false);
  assert.deepEqual(hostedIdentityCompleteCheck.hostedIdentityPacketSummaryStatuses, {
    status: "provided\n6/6 sections provided\n0 sections missing",
    inputs: "16/16 inputs provided\n0 inputs missing",
    "redacted-refs": "6 redacted refs",
  });
  assert.equal(
    identityReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "hosted-production-identity" && item.status === "unproven",
    ),
    true,
  );
  const backupRestoreReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    backupRestoreProofPath:
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    backupRestoreDumpPath: "target/live-stack-backup-restore-drill/local-live-stack.dump",
    backupAdminProofPath: devTestGameBackupAdminProofPath,
    backupAdminProof: backupAdminProofFixture(),
    backupRestoreProof: {
      version: 1,
      status: "passed",
      scope: "local-live-stack-backup-restore-drill",
      productionReady: false,
      proofBoundary: "Local disposable Postgres backup/restore proof.",
      artifact: {
        proof: "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
        dump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
      },
      checks: [
        { id: "dump-created", status: "passed" },
        { id: "event-log-restored", status: "passed" },
        { id: "projection-fingerprints-restored", status: "passed" },
        { id: "auth-sessions-restored", status: "passed" },
        { id: "restored-api-capabilities", status: "passed" },
      ],
      fingerprints: {
        source: { events: { total: 3 }, projections: { phase_state: [] } },
        restored: { events: { total: 3 }, projections: { phase_state: [] } },
      },
      restoredApiEvidence: {
        restoredSessions: {
          host: ["HostOf"],
          player: ["SlotOccupant", "ChannelMember"],
          admin: ["GlobalAdmin"],
        },
      },
    },
  });
  assertDevTestGameReleaseReadiness(backupRestoreReadiness);
  assert(
    backupRestoreReadiness.localDevelopmentSpine.checks.some(
      (item) => item.id === "local-backup-restore-drill" && item.status === "passed",
    ),
  );
  assert.equal(
    backupRestoreReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-backup-restore-drill",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-backup-restore?game=<seeded-game>",
  );
  assert.equal(
    backupRestoreReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "backup-restore-drill",
    ),
    false,
  );
  assert(
    backupRestoreReadiness.releaseReadiness.unproven.some(
      (item) => item.id === "production-backup-recovery" && item.status === "unproven",
    ),
  );
  assert.equal(backupRestoreReadiness.releaseReadiness.status, "not_ready");
  const adminSpineReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    adminSpineProofPath: "target/dev-test-game/admin-spine-proof.json",
    adminSpineProof: adminSpineProofFixture(),
    adminSpineAdminProofPath: devTestGameAdminSpineAdminProofPath,
    adminSpineAdminProof: adminSpineAdminProofFixture(),
    adminSpineTerminalBatchesPath:
      "target/dev-test-game/admin-spine-terminal-batches.json",
    adminSpineTerminalBatches: adminSpineTerminalBatchesFixture(),
    ...recoveryReceiptFixtureOptions(),
  });
  assertDevTestGameReleaseReadiness(adminSpineReadiness);
  assert.equal(
    adminSpineReadiness.generatedFrom.adminProofSpine,
    "target/dev-test-game/admin-spine-proof.json",
  );
  assert.equal(
    adminSpineReadiness.generatedFrom.adminSpineAdminProof,
    devTestGameAdminSpineAdminProofPath,
  );
  assert.equal(
    adminSpineReadiness.generatedFrom.adminSpineTerminalBatches,
    "target/dev-test-game/admin-spine-terminal-batches.json",
  );
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    const validateReceipt =
      recoveryReceiptReleaseReadinessValidators[descriptor.receiptKey];
    assert.equal(typeof validateReceipt, "function");
    assert.equal(
      validateReceipt(recoveryReceiptFixture(descriptor)).path,
      descriptor.proofTarget,
    );
    assert.equal(
      adminSpineReadiness.generatedFrom[descriptor.receiptKey],
      descriptor.proofTarget,
    );
    assert.equal(
      adminSpineReadiness.localDevelopmentSpine.checks.find(
        (item) => item.id === descriptor.readinessCheckId,
      ).roleUrl,
      descriptor.roleUrl,
    );
    assert.equal(
      adminSpineReadiness.localDevelopmentSpine.evidence[descriptor.receiptKey]
        .laneCount,
      descriptor.laneIds.length,
    );
  }
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-admin-spine-surface",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-admin-spine?game=<seeded-game>",
  );
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine.proofCount,
    16,
  );
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine.recovery.nextCommand,
    "npm run test:dev-test-game-admin-spine",
  );
  assert.equal(
    adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine
      .terminalBatches.batchCount,
    2,
  );
  assert.deepEqual(adminSpineReadiness.localDevelopmentSpine.evidence.adminProofSpine.proofIds, [
    "core-loop",
    "hardening",
    "identity",
    "hosted-identity-evidence",
    "backup",
    "ops",
    "seed",
    "release",
    "release-runbook",
    "race-coverage",
    "hosted-target-preflight",
    "hosted-evidence-lane",
    "hosted-concurrent-race-matrix",
    "hosted-ops-signals",
    "real-hosted-observability-handoff",
    "spine-manifest",
  ]);
  const proofGraphHandoffReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofGraphAdminProofPath: "target/dev-test-game/proof-graph-admin-proof.json",
    proofGraphAdminProof: proofGraphAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(proofGraphHandoffReadiness);
  assert.equal(
    proofGraphHandoffReadiness.generatedFrom.proofGraphAdminProof,
    "target/dev-test-game/proof-graph-admin-proof.json",
  );
  const handoffCheck =
    proofGraphHandoffReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-proof-graph-admin-role-handoffs",
  );
  assert.equal(handoffCheck.status, "passed");
  assert.equal(
    handoffCheck.roleHandoffCount,
    adminProofDestinationRequirementLinkRows.length,
  );
  assert(handoffCheck.roleHandoffIds.includes("admin-proof:release"));
  assert(handoffCheck.destinationAuditIds.includes("local-release-readiness"));
  assert.equal(
    handoffCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-proof-graph?game=<seeded-game>",
  );
  assert.equal(
    proofGraphHandoffReadiness.localDevelopmentSpine.evidence.proofGraphAdminProof
      .roleHandoffCount,
    adminProofDestinationRequirementLinkRows.length,
  );
  const proofFreshnessAdminReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    proofFreshnessAdminProofPath:
      "target/dev-test-game/proof-freshness-admin-proof.json",
    proofFreshnessAdminProof: proofFreshnessAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(proofFreshnessAdminReadiness);
  const proofFreshnessAdminCheck =
    proofFreshnessAdminReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-proof-freshness-admin-surface",
    );
  assert.equal(proofFreshnessAdminCheck.status, "passed");
  assert.equal(proofFreshnessAdminCheck.dependencyGated, true);
  assert.equal(
    proofFreshnessAdminCheck.recovery.command,
    "npm run test:dev-test-game-proof-freshness-admin-proof",
  );
  assert.equal(proofFreshnessAdminCheck.artifactCount, 3);
  assert.equal(
    proofFreshnessAdminCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-proof-freshness?game=<seeded-game>",
  );
  assert.equal(
    proofFreshnessAdminReadiness.localDevelopmentSpine.evidence
      .proofFreshnessAdminProof.nextActionStatus,
    "ready",
  );
  const nextActionAdminReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    nextActionAdminProofPath: "target/dev-test-game/next-action-admin-proof.json",
    nextActionAdminProof: nextActionAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(nextActionAdminReadiness);
  const nextActionAdminCheck =
    nextActionAdminReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-next-action-admin-surface",
    );
  assert.equal(nextActionAdminCheck.status, "passed");
  assert.equal(nextActionAdminCheck.dependencyGated, true);
  assert.equal(
    nextActionAdminCheck.recovery.command,
    "npm run test:dev-test-game-next-action-admin-proof",
  );
  assert.equal(
    nextActionAdminCheck.adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-next-action?game=<seeded-game>",
  );
  assert.equal(
    nextActionAdminReadiness.localDevelopmentSpine.evidence.nextActionAdminProof
      .localReadinessDependencyCandidateCount,
    0,
  );
  const manifestReadiness = buildDevTestGameReleaseReadiness(proofRun, {
    generatedAt: "2026-06-26T00:00:00.000Z",
    spineManifestPath: "target/dev-test-game/spine-manifest.json",
    spineManifest: spineManifestFixture(),
    spineManifestAdminProofPath: devTestGameSpineManifestAdminProofPath,
    spineManifestAdminProof: spineManifestAdminProofFixture(),
  });
  assertDevTestGameReleaseReadiness(manifestReadiness);
  assert.equal(
    manifestReadiness.generatedFrom.spineManifest,
    "target/dev-test-game/spine-manifest.json",
  );
  assert.equal(
    manifestReadiness.generatedFrom.spineManifestAdminProof,
    devTestGameSpineManifestAdminProofPath,
  );
  assert.equal(
    manifestReadiness.localDevelopmentSpine.checks.find(
      (item) => item.id === "local-spine-manifest",
    ).adminRoleSurface.detailRoleUrl,
    "/admin/audit/local-spine-manifest?game=<seeded-game>",
  );
});

function artifactSummary(path) {
  return {
    path,
    mtime: "2026-06-26T00:00:00.000Z",
    ageSeconds: 0,
    sizeBytes: 123,
    sha256: "0".repeat(64),
  };
}

function hostSetupProofFixture(game = "game-a") {
  return {
    proof: "dev-test-game-host-setup-proof",
    status: "passed",
    generatedAt: "2026-06-26T00:00:00.000Z",
    game,
    proofBoundary:
      "Local dev-test-game host setup role URL browser proof over the seeded setup route.",
    hostSetup: {
      status: "passed",
      proof: "Host setup role URL opens setup recovery surface.",
      roleUrl: `http://127.0.0.1:5173/g/${game}/setup`,
      capabilityLabel: `HostOf(${game})`,
      readinessSummary: "Started at D01",
      phaseId: "D01",
      startDisabled: true,
      hostHref: `/g/${game}/host`,
      slotIds: ["slot-2", "slot-3", "slot-7", "slot_4", "slot_5"],
      roleKeys: ["mafia_goon", "vanilla_townie"],
      mainPolicyText: "Media-only posts are disabled.",
      policyCommand: {
        status: "passed",
        commandKind: "SetPostPolicy",
        channelId: "main",
        allowMediaOnlySequence: [true, false],
        finalPolicyText: "Media-only posts are disabled.",
      },
      setupMutationCommand: {
        status: "passed",
        proof: "A disposable pre-start setup role URL refreshed to ready setup state.",
        game: "setup-game-a",
        roleUrl: "http://127.0.0.1:5173/g/setup-game-a/setup",
        sessionPrincipalUserId: "host_h",
        addedSlotId: "slot_extra",
        assignedPrincipalUserId: "setup-extra-player",
        assignedRoleKey: "mafia_goon",
        initialSummary: "Ready to start",
        duplicateAddSlotRecovery: {
          status: "reject",
          statusText: "Reject InvalidTarget: invalid target",
          commandKind: "AddSlot",
          error: "InvalidTarget",
          retryable: false,
          refreshedReadinessSummary: "Setup still needs attention",
        },
        finalSummary: "Ready to start",
        finalStartAvailable: true,
        finalSlot: {
          slotId: "slot_extra",
          occupantUserId: "setup-extra-player",
          roleKey: "mafia_goon",
        },
        commands: {
          addSlot: { status: "ack" },
          assignSlot: { status: "ack" },
          assignRole: { status: "ack" },
        },
      },
      readyCheckIds: [
        "game-created",
        "pack-valid",
        "slots-exist",
        "slots-occupied",
        "roles-assigned",
        "policy-acknowledged",
        "start-phase",
      ],
    },
  };
}

function identityAdapterProofFixture(game) {
  const identityAdapterContract = buildDevTestGameIdentityAdapterContractPacket();
  return {
    version: devTestGameIdentityAdapterProofVersion,
    proof: "auth-invite-role-proof",
    status: "passed",
    scope: "local-auth-invite-role-proof",
    productionReady: false,
    releaseReady: false,
    proofBoundary: "Local invite proof only.",
    identityAdapter: {
      status: "passed",
      replacesDevTokensWithoutRoleSurfaceChange: true,
      browserCookieName: "fmarch_session",
      sessionCredentialKind: "opaque-session",
      inviteCredentialKind: "single-use-invite",
      accountCredentialKind: "local-password-account",
      lifecycleControls: [
        "account-disable",
        "account-enable",
        "session-rotation",
        "session-revocation",
        "invite-revocation",
      ],
      delegatedIssuanceControls: ["host-scoped-invite-issuance"],
      roleSurfacePattern: "/auth/login?returnTo=<role-surface>&invite=<token>",
      accountRoleSurfacePattern: "/auth/login?returnTo=<role-surface>&account=<account-id>",
      capabilityAuthority:
        "auth_session resolves principal_user_id and committed game/global capabilities at the API boundary",
    },
    identityAdapterContract,
    identityAdapterContractDiff:
      devTestGameIdentityAdapterContractDiff(identityAdapterContract),
    identityLifecycle: {
      status: "passed",
      sessionRotation: {
        status: "passed",
        principalUserId: "host_h",
        oldSessionRejected: true,
        rotatedSessionCapabilityKinds: ["HostOf"],
        sameRoleSurface: true,
      },
      sessionRevocation: {
        status: "passed",
        principalUserId: "host_h",
        revokedSessionRejected: true,
      },
      inviteRevocation: {
        status: "passed",
        principalUserId: "host_h",
        revokedInviteRejected: true,
        recoveryCapabilityKinds: ["HostOf"],
        sameRoleSurface: true,
      },
      hostScopedInviteIssuance: {
        status: "passed",
        issuingCapability: "HostOf(game)",
        hostRoleSurface: `/g/${game}/host`,
        hostAction: "?/issuePlayerInvite",
        hostPanelTestId: "host-player-invite-panel",
        clickedThroughFromHostRoleUrl: true,
        issuedByPrincipalUserId: "host_h",
        issuedForGame: game,
        storedGameScope: game,
        principalUserId: "player-mira",
        globalCapabilitiesGranted: 0,
        redeemedCapabilityKinds: ["SlotOccupant"],
        sameRoleSurface: true,
        hostRoleSurfaceStillValid: true,
        rawInviteTokenStored: false,
      },
      accountLogin: {
        status: "passed",
        principalUserId: "host_h",
        accountId: "host@example.test",
        capabilityKinds: ["HostOf"],
        sameRoleSurface: true,
        cookieValuePrefix: "account-session-",
        rawPasswordStored: false,
      },
      accountLifecycle: {
        status: "passed",
        adminControlSurface: {
          status: "passed",
          detailRoleUrl:
            "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
          controlsTestId: "admin-identity-account-controls",
          visitedDetailRoleUrl: true,
          staleConflictStatusText:
            "stale account lifecycle state for host@example.test; refresh and use current account controls before enable",
          reloadRecoveryStatus: "disabled",
          reloadRecoveryDetailRoleUrl:
            "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
          reloadRecoveryTargetText: "host@example.test host_h disabled",
        },
        disabledStatus: "disabled",
        enabledStatus: "enabled",
        disabledAccountRejected: true,
        staleAccountSessionRejected: true,
        staleAdminControlRejected: true,
        staleAdminControlReloadRecovered: true,
        recoveryCapabilityKinds: ["HostOf"],
        sameRoleSurface: true,
        revokedSessionCount: 1,
        disabledAtPresent: true,
        enabledDisabledAtCleared: true,
        rawPasswordStored: false,
      },
      auditTrail: {
        status: "passed",
        principalUserId: "host_h",
        eventKinds: [
          "account_created",
          "account_disabled",
          "account_enabled",
          "account_session_created",
          "invite_revoked",
          "session_revoked",
          "session_rotated",
        ],
        actorUserIds: ["admin_a", "host_h"],
        rawTokensStored: false,
      },
      adminAuditSurface: {
        status: "passed",
        overviewRoleUrl: "/admin?game=<seeded-game>",
        detailRoleUrl:
          "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
        linkTestId: "admin-audit-link-identity-lifecycle",
        surfaceTestId: "admin-audit-detail-surface",
        clickedThroughFromOverview: true,
        visibleEventKinds: [
          "account_created",
          "account_disabled",
          "account_enabled",
          "account_session_created",
          "session_rotated",
          "session_revoked",
          "invite_revoked",
        ],
        principalUserId: "host_h",
        rawTokensVisible: false,
      },
      nonClaims: [
        "hosted account recovery",
        "email or out-of-band invite delivery",
        "rate limiting or abuse controls",
        "hosted audit retention or export policy",
      ],
    },
    game,
    seedCommands: Array.from({ length: 22 }, (_, index) => ({
      principalUserId: index === 0 ? "host_h" : "player-mira",
      kind: index === 0 ? "CreateGame" : "SeedCommand",
      streamSeqs: [index + 1],
    })),
    accounts: {
      host: {
        accountId: "host@example.test",
        principalUserId: "host_h",
        globalCapabilities: [],
      },
    },
    roles: {
      admin: identityRole({
        role: "admin",
        loginUrl: "http://127.0.0.1:5173/auth/login?returnTo=%2Fadmin&invite=admin-invite-token",
        principalUserId: "admin_a",
        capabilityKinds: ["GlobalAdmin"],
      }),
      host: identityRole({
        role: "host",
        loginUrl: `http://127.0.0.1:5173/auth/login?returnTo=%2Fg%2F${game}%2Fhost&invite=host-invite-token`,
        principalUserId: "host_h",
        capabilityKinds: ["HostOf"],
      }),
      player: identityRole({
        role: "player",
        loginUrl: `http://127.0.0.1:5173/auth/login?returnTo=%2Fg%2F${game}&invite=player-invite-token`,
        principalUserId: "player-mira",
        capabilityKinds: ["SlotOccupant"],
      }),
    },
  };
}

function devTestGameReleaseReadinessChecklistFixture({
  unproven,
  seedProofLaneCoverage = seedProofLaneCoverageFixture(),
  includeProofGraphHandoffCheck = true,
  includeProofFreshnessAdminCheck = true,
  includeNextActionAdminCheck = true,
  includeHostedEvidenceLaneDemoProofCheck = true,
  includeHostSetupProofCheck = false,
  includeOpsArtifactBundleCheck = false,
}) {
  return {
    version: 1,
    proof: "dev-test-game-release-readiness",
    status: "passed",
    readinessStatus: "not_ready",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-release-readiness-checklist",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      proofGeneratedAt: "2026-06-26T00:00:00.000Z",
      game: "game-a",
      staleConflictMessageMilestone: staleConflictMessageMilestoneFixture(),
      hostStaleControlMilestone: hostStaleControlMilestoneFixture(),
      privateChannelRecoveryMilestone: privateChannelRecoveryMilestoneFixture(),
      replacementPrivateRecoveryMilestone:
        replacementPrivateRecoveryMilestoneFixture(),
      replacementActionRecoveryMilestone:
        replacementActionRecoveryMilestoneFixture(),
      replacementHandoffRecoveryMilestone:
        replacementHandoffRecoveryMilestoneFixture(),
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: [
        {
          id: "local-role-url-browser-proof",
          label: "Seeded role URLs and browser proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
        },
        ...(includeHostSetupProofCheck
          ? [
              {
                id: "local-host-setup-proof",
                label: "Host setup role URL, policy, roster, and recovery proof",
                status: "passed",
                evidence: "target/dev-test-game/host-setup-proof.json",
                roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
                proofBoundary:
                  "Local dev-test-game host setup role URL browser proof over the seeded setup route.",
                capabilityLabel: "HostOf(<seeded-game>)",
                readyCheckIds: [
                  "game-created",
                  "pack-valid",
                  "slots-exist",
                  "slots-occupied",
                  "roles-assigned",
                  "policy-acknowledged",
                  "start-phase",
                ],
                setupMutationStatus: "passed",
                policyCommandStatus: "passed",
                recoveryCommand:
                  "npm run dev:test-game -- --verify-host-setup-only",
                spineTargets: hostSetupSpineTargetsFixture(),
              },
            ]
          : []),
        {
          id: "local-cohost-console-proof",
          label: "Cohost role URL delegated host-console proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/host",
          proofBoundary:
            "Seeded dev-test-game cohost role URL proof from proof-run. Proves delegated deadline control and NotHost rejection for host-only resolve; does not prove hosted identity, multi-node races, release readiness, or production readiness.",
          capabilityLabel: "CohostOf(<seeded-game>)",
          extendDeadlineState: "ack",
          extendDeadlinePrincipal: "cohost_c",
          hostOnlyRejectError: "NotHost",
          hostOnlyRejectPrincipal: "cohost_c",
          phaseAfterRejectId: "D01",
          phaseAfterRejectLocked: false,
          recoveryCommand: "npm run test:dev-test-game-core-live",
          spineTargets: cohostSpineTargetsFixture(),
        },
        {
          id: "local-replacement-player-proof",
          label: "Replacement player role URL proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          roleUrl: "http://127.0.0.1:5173/g/<seeded-game>",
          proofBoundary:
            "Seeded dev-test-game replacement player role URL proof from proof-run. Proves host-issued replacement URL, fresh replacement session recovery, incoming player slot authority, stale outgoing player rejection, and private-channel authority transfer; does not prove hosted identity, invite delivery, multi-node races, release readiness, or production readiness.",
          principalUserId: "player-rowan",
          commandStateSlot: "slot-7",
          capabilityKinds: ["SlotOccupant", "ChannelMember"],
          hostIssuedInvite: {
            principalUserId: "player-rowan",
            issuedBy: "host_h",
            issuedByCapability: "HostOf",
            returnTo: "/g/<seeded-game>",
            tokenPresent: true,
          },
          sessionRefresh: {
            credentialKind: "session",
            usedInviteToken: false,
            landedOnDirectUrl: true,
            commandStateSlot: "slot-7",
          },
          incomingPlayer: {
            postState: "ack",
            voteState: "Ack",
            stableHistoryVisible: true,
            targetKillVisible: false,
            actionResultVisible: false,
          },
          staleOutgoing: {
            rejectError: "NotYourSlot",
            recoveredActorStatus: "replaced",
            buttonsDisabled: true,
          },
          privateAuthority: {
            channel: "private:mafia_day_chat",
            staleRejectError: "NotYourSlot",
            staleRouteStatus: 403,
            rowanPostState: "ack",
            staleNotificationsStatus: 403,
            rowanNotificationsStatus: 200,
          },
          recoveryCommand: "npm run test:dev-test-game-core-live",
          spineTargets: replacementSpineTargetsFixture(),
        },
        {
          id: "local-replacement-action-proof",
          label: "Replacement action recovery role URL proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          roleUrl: "http://127.0.0.1:5173/g/<replacement-action-game>",
          proofBoundary:
            "Seeded dev-test-game replacement action role URL proof from proof-run. Proves incoming replacement factional_kill submission, reconnect into locked resolved state, stale replacement action PhaseLocked recovery, and scoped target receipt visibility; does not prove hosted identity, hosted transport, multi-node races, release readiness, or production readiness.",
          incomingAction: {
            game: "<replacement-action-game>",
            targetSlot: "slot-2",
            replacementState: "ack",
            actionState: "ack",
            targetAlive: false,
            staleOutgoingError: "NotYourSlot",
            rowanPrivateKillVisible: false,
          },
          reconnect: {
            game: "<replacement-action-reconnect-game>",
            replacementState: "ack",
            actionState: "ack",
            reconnectState: "recovered",
            phaseLocked: true,
            actionCount: 0,
            targetNoticeStatus: "factional_kill",
            rowanPrivateKillVisible: false,
          },
          staleAction: {
            game: "<replacement-stale-action-game>",
            rejectError: "PhaseLocked",
            refreshedPhase: "N01",
            refreshedLocked: true,
            refreshedActionCount: 0,
            targetAlive: true,
            rowanPrivateKillVisible: false,
            targetNoticePresent: false,
          },
          recoveryCommand: "npm run test:dev-test-game-core-live",
          spineTargets: replacementActionSpineTargetsFixture(),
        },
        {
          id: "local-replacement-private-proof",
          label: "Replacement private-channel recovery role URL proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          roleUrl:
            "http://127.0.0.1:5173/g/<replacement-private-game>/c/private%3Amafia_day_chat",
          proofBoundary:
            "Seeded dev-test-game replacement private-channel role URL proof from proof-run. Proves current replacement private-channel authority, stale outgoing private-channel and receipt denial, stale private-post ACK and reconnect recovery after resolution, completed-game private-post rejection, and completed private-channel reload; does not prove hosted identity, hosted transport, release readiness, or production readiness.",
          authority: {
            channel: "private:mafia_day_chat",
            staleRejectError: "NotYourSlot",
            staleRouteStatus: 403,
            rowanCapabilityLabel: "ChannelMember(private:mafia_day_chat)",
            rowanPostState: "ack",
          },
          receipts: {
            staleNotificationsStatus: 403,
            staleInvestigationResultsStatus: 403,
            rowanNotificationsStatus: 200,
            rowanInvestigationResultsStatus: 200,
            rowanPrivateQueueCount: 0,
          },
          resolvedPost: {
            game: "<replacement-private-game>",
            channel: "private:mafia_day_chat",
            postState: "ack",
            refreshedPhase: "D01",
            refreshedLocked: true,
            staleRouteStatus: 403,
            normalizedProofStatus: "passed",
          },
          reconnect: {
            game: "<replacement-private-game>",
            reconnectState: "recovered",
            recoveredPhase: "D01",
            recoveredLocked: true,
            staleThreadStatus: 403,
            normalizedProofStatus: "passed",
          },
          completedPost: {
            game: "<replacement-private-completed-game>",
            rejectError: "GameAlreadyCompleted",
            gameCompleted: true,
            staleThreadStatus: 403,
            normalizedProofStatus: "passed",
          },
          completedReload: {
            game: "<replacement-private-completed-game>",
            routeStatus: 200,
            gameCompleted: true,
            staleRouteStatus: 403,
            normalizedProofStatus: "passed",
          },
          recoveryCommand: "npm run test:dev-test-game-core-live",
          spineTargets: replacementPrivateSpineTargetsFixture(),
        },
        {
          id: "local-core-loop-proof",
          label:
            "Host controls, replacement, player actions, private channels, and day/night loop",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: coreLoopAuditLaneIds,
          adminRoleSurface: {
            path: devTestGameCoreLoopAdminProofPath,
            detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
          },
          spineTargets: coreLoopSpineTargetsFixture(),
        },
        {
          id: "local-hardening-proof",
          label:
            "Idempotency, reconnect, stale-client, and local concurrent race matrix",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: hardeningAuditLaneIds,
          adminRoleSurface: {
            status: "passed",
            path: devTestGameHardeningAdminProofPath,
            detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
            visibleChecks: [
              ...hardeningAdminProofFixture().adminRoleSurface.visibleChecks,
            ],
          },
          spineTargets: hardeningSpineTargetsFixture(),
        },
        ...recoveryMilestoneFixtureChecks(),
        ...(includeOpsArtifactBundleCheck
          ? [
              {
                id: "local-ops-artifact-bundle",
                label: "Local ops artifact bundle",
                status: "passed",
                evidence: "target/dev-test-game/ops-artifacts.json",
                proofBoundary: "Local ops artifact bundle.",
                adminRoleSurface: {
                  status: "passed",
                  detailRoleUrl:
                    "/admin/audit/local-ops-artifacts?game=<seeded-game>",
                },
              },
            ]
          : []),
        ...(seedProofLaneCoverage === null
          ? []
          : [
              {
                id: "local-seed-demo-fixture",
                label: "Local seed/demo fixture summary",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/seed-fixture-summary.json",
                proofBoundary:
                  "Local seed/demo fixture inventory for one dev-test-game run.",
                recovery: {
                  command: devTestGameSeedFixtureCommand,
                  buildSlice:
                    "Generate the local seed/demo fixture inventory and admin proof before choosing hosted readiness work.",
                  proofTarget: devTestGameSeedFixturePath,
                  roleUrl: devTestGameSeedFixtureRoleUrl,
                  proofBoundary:
                    "Local seed/demo fixture inventory and admin browser proof for one dev-test-game run. This recovers the local fixture dependency only; it does not prove hosted demo data, invite delivery, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed local seed/demo fixture inventory and admin role-surface proof in the generated release-readiness checklist",
                },
                scenarioCount: seedScenarioCoverageGroups.allDemo.length,
                proofLaneCoverage: seedProofLaneCoverage,
              },
            ]),
        {
          id: "local-identity-adapter-proof",
          label: "Local production-identity adapter proof",
          status: "passed",
          evidence: "target/auth-invite-role-proof/invite-role-proof.json",
          proofBoundary:
            "Local identity adapter proof keeps role surfaces stable.",
          roles: ["admin", "host", "player"],
          adminRoleSurface: {
            status: "passed",
            path: devTestGameIdentityAdminProofPath,
            proofBoundary:
              "Local identity adapter admin role URL proof.",
            overviewRoleUrl: "/admin?game=<seeded-game>",
            detailRoleUrl:
              "/admin/audit/local-identity-adapter?game=<seeded-game>",
            visibleChecks: [
              "account-login",
              "account-lifecycle",
              "session-rotation",
              "session-revocation",
              "invite-revocation",
              "host-scoped-invite-issuance",
              "audit-trail",
              "admin-audit-surface",
            ],
            visibleSessions: ["admin", "host", "player"],
          },
        },
        ...(includeProofGraphHandoffCheck
          ? [
              {
                id: "local-proof-graph-admin-role-handoffs",
                label: "Proof graph admin role handoffs",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/proof-graph-admin-proof.json",
                proofBoundary:
                  "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL.",
                recovery: {
                  command: "npm run test:dev-test-game-proof-graph-admin-proof",
                  buildSlice:
                    "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
                  proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
                  roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
                  proofBoundary:
                    "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
                },
                roleHandoffCount: 10,
                roleHandoffIds: ["admin-proof:release"],
                destinationAuditIds: ["local-release-readiness"],
              },
            ]
          : []),
        ...(includeProofFreshnessAdminCheck
          ? [
              {
                id: "local-proof-freshness-admin-surface",
                label: "Proof freshness admin surface",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/proof-freshness-admin-proof.json",
                proofBoundary:
                  "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts.",
                recovery: {
                  command:
                    "npm run test:dev-test-game-proof-freshness-admin-proof",
                  buildSlice:
                    "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
                  proofTarget:
                    "target/dev-test-game/proof-freshness-admin-proof.json",
                  roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
                  proofBoundary:
                    "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed proof-freshness admin surface check in the generated release-readiness checklist",
                },
                artifactCount: 3,
                artifactIds: ["proof-run", "release-readiness", "next-action"],
                maxAgeHours: 24,
                nextActionCommand:
                  "npm run test:dev-test-game-hosted-concurrent-race-matrix",
                nextActionStatus: "ready",
                nextActionReason: "release-readiness-unproven",
              },
            ]
          : []),
        ...(includeNextActionAdminCheck
          ? [
              {
                id: "local-next-action-admin-surface",
                label: "Next-action admin surface",
                status: "passed",
                dependencyGated: true,
                evidence: "target/dev-test-game/next-action-admin-proof.json",
                proofBoundary:
                  "Local browser proof that the next-action admin surface exposes the selected command.",
                recovery: {
                  command: "npm run test:dev-test-game-next-action-admin-proof",
                  buildSlice:
                    "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
                  proofTarget: "target/dev-test-game/next-action-admin-proof.json",
                  roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
                  proofBoundary:
                    "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed next-action admin surface check in the generated release-readiness checklist",
                },
                selectedCommand: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
                selectedReason: "release-readiness-unproven",
                releaseReadinessCandidateCount: 1,
                localReadinessDependencyCandidateCount: 0,
              },
            ]
          : []),
        ...(includeHostedEvidenceLaneDemoProofCheck
          ? [
              {
                id: "local-hosted-evidence-lane-demo-proof",
                label: "Local hosted evidence lane demo proof",
                status: "passed",
                dependencyGated: true,
                evidence:
                  "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
                proofBoundary:
                  "Local demo proof for the hosted evidence lane pass path.",
                demoOnly: true,
                syntheticExternalTarget: true,
                blockedLaneStatus: "blocked",
                passedLaneStatus: "passed",
                passedRoleUrl:
                  "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
                externalEvidencePath:
                  "target/dev-test-game/hosted-matrix-demo-external.json",
                recovery: {
                  command:
                    "npm run test:dev-test-game-hosted-evidence-lane-demo-proof",
                  buildSlice:
                    "Refresh the local hosted evidence lane demo proof before choosing hosted deployment work.",
                  proofTarget:
                    "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
                  roleUrl:
                    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
                  proofBoundary:
                    "Local demo proof for the hosted evidence lane pass path. This recovers the blocked-to-passed handoff using synthetic external-looking evidence only; it does not prove hosted deployment, release readiness, or production readiness.",
                  requiredEvidence:
                    "Passed local hosted evidence lane demo proof with synthetic external target warning",
                },
              },
            ]
          : []),
      ],
    },
    releaseReadiness: {
      status: "not_ready",
      reason: "Local proof passed, but release evidence remains unproven.",
      unprovenCount: unproven.length,
      unprovenIds: unproven.map((item) => item.id),
      unproven,
    },
    readinessSummary: {
      status: "not_ready",
      proofStatus: "passed",
      releaseReady: false,
      productionReady: false,
      localDevelopmentSpineStatus: "passed",
      unprovenCount: unproven.length,
      unprovenIds: unproven.map((item) => item.id),
      firstUnprovenRequiredEvidence: unproven[0]?.requiredEvidence ?? null,
      reason: "Local proof passed, but release evidence remains unproven.",
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact without release claims.",
  };
}

function hostedIdentityLocalCapabilityConfidenceFixture() {
  return {
    status: "blocked",
    source: devTestGameReleaseReadinessPath,
    requiredCheckIds: [
      "local-core-loop-proof",
      "local-hardening-proof",
      "local-ops-artifact-bundle",
      "local-seed-demo-fixture",
      "local-identity-adapter-proof",
    ],
    checkCount: 5,
    passedCheckCount: 4,
    checks: [
      {
        id: "local-core-loop-proof",
        label:
          "Host controls, replacement, player actions, private channels, and day/night loop",
        status: "passed",
        evidence: "target/dev-test-game/proof-run.json",
        roleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
        proofBoundary: "",
      },
      {
        id: "local-hardening-proof",
        label:
          "Idempotency, reconnect, stale-client, and local concurrent race matrix",
        status: "passed",
        evidence: "target/dev-test-game/proof-run.json",
        roleUrl: "/admin/audit/local-hardening?game=<seeded-game>",
        proofBoundary: "",
      },
      {
        id: "local-ops-artifact-bundle",
        label: "local-ops-artifact-bundle",
        status: "missing",
        evidence: "",
        roleUrl: "",
        proofBoundary: "",
      },
      {
        id: "local-seed-demo-fixture",
        label: "Local seed/demo fixture summary",
        status: "passed",
        evidence: "target/dev-test-game/seed-fixture-summary.json",
        roleUrl: devTestGameSeedFixtureRoleUrl,
        proofBoundary:
          "Local seed/demo fixture inventory for one dev-test-game run.",
      },
      {
        id: "local-identity-adapter-proof",
        label: "Local production-identity adapter proof",
        status: "passed",
        evidence: "target/auth-invite-role-proof/invite-role-proof.json",
        roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
        proofBoundary:
          "Local identity adapter proof keeps role surfaces stable.",
      },
    ],
    proofBoundary:
      "Local capability-model confidence is derived from the current release-readiness checklist. It requires passed core-loop, hardening, local ops, seed/demo fixture, and local identity-adapter rows before hosted identity can move out of sequencing deferral; it does not prove hosted accounts, sessions, invites, release readiness, or production readiness.",
  };
}

function hostedIdentityPassedLocalCapabilityConfidenceFixture() {
  const confidence = hostedIdentityLocalCapabilityConfidenceFixture();
  return {
    ...confidence,
    status: "passed",
    passedCheckCount: 5,
    checks: confidence.checks.map((check) =>
      check.id === "local-ops-artifact-bundle"
        ? {
            id: "local-ops-artifact-bundle",
            label: "Local ops artifact bundle",
            status: "passed",
            evidence: "target/dev-test-game/ops-artifacts.json",
            roleUrl: "/admin/audit/local-ops-artifacts?game=<seeded-game>",
            proofBoundary: "Local ops artifact bundle.",
          }
        : check,
    ),
  };
}

function recoveryMilestoneFixtureChecks() {
  const milestonesByGeneratedFromKey = {
    staleConflictMessageMilestone: staleConflictMessageMilestoneFixture(),
    hostStaleControlMilestone: hostStaleControlMilestoneFixture(),
    privateChannelRecoveryMilestone: privateChannelRecoveryMilestoneFixture(),
    replacementActionRecoveryMilestone: replacementActionRecoveryMilestoneFixture(),
    replacementHandoffRecoveryMilestone:
      replacementHandoffRecoveryMilestoneFixture(),
    replacementPrivateRecoveryMilestone:
      replacementPrivateRecoveryMilestoneFixture(),
  };
  return recoveryMilestoneCoverageCases.map((scenario) => {
    const milestone = milestonesByGeneratedFromKey[scenario.generatedFromKey];
    return {
      id: scenario.checkId,
      label: scenario.label,
      status: milestone.status,
      evidence: "target/dev-test-game/proof-run.json",
      proofBoundary: scenario.proofBoundary,
      laneIds: [...milestone.laneIds],
      requiredLaneCount: milestone.requiredLaneCount,
      coveredLaneCount: milestone.coveredLaneCount,
      familyCount: milestone.familyCount,
      expectedLaneCount: milestone.expectedLaneCount,
      expectedFamilyCount: milestone.expectedFamilyCount,
      ...(scenario.hasSurfaceCoverage === true
        ? { surfaceCoverage: milestone.surfaceCoverage }
        : {}),
      ...(scenario.hasSurfaceChecks === true ? { surfaces: milestone.surfaces } : {}),
      ...(milestone.normalizedEvidenceObjects === undefined
        ? {}
        : { normalizedEvidenceObjects: milestone.normalizedEvidenceObjects }),
    };
  });
}

function assertReadinessRecoveryMilestonesMirrorProofCoverage({
  readiness,
  proofRun,
}) {
  for (const scenario of recoveryMilestoneCoverageCases) {
    const coverage = proofRun[scenario.coverageKey];
    assert(
      coverage !== undefined,
      `proof-run fixture missing coverage summary: ${scenario.coverageKey}`,
    );
    const check = readiness.localDevelopmentSpine.checks.find(
      (item) => item.id === scenario.checkId,
    );
    assert(
      check !== undefined,
      `readiness checklist missing local milestone: ${scenario.checkId}`,
    );
    const generatedSnapshot = readiness.generatedFrom[scenario.generatedFromKey];
    assert(
      generatedSnapshot !== undefined,
      `readiness generatedFrom missing milestone: ${scenario.generatedFromKey}`,
    );

    assert.deepEqual(
      visibleRecoveryMilestoneCoverage(check),
      {
        id: scenario.checkId,
        label: scenario.label,
        status: coverage.status,
        evidence: "target/dev-test-game/proof-run.json",
        proofBoundary: scenario.proofBoundary,
        laneIds: [...coverage.sourceLaneIds],
        requiredLaneCount: coverage.laneCount,
        coveredLaneCount: coverage.passedLaneCount,
        familyCount: coverage.familyCount,
        expectedLaneCount: coverage.expectedLaneCount,
        expectedFamilyCount: coverage.expectedFamilyCount,
        ...(scenario.hasSurfaceCoverage === true
          ? { surfaceCoverage: generatedSnapshot.surfaceCoverage }
          : {}),
        ...expectedPrivateChannelEvidenceObjectsForScenario(scenario),
      },
      `${scenario.checkId} should mirror proof-run ${scenario.coverageKey}`,
    );
    assert.deepEqual(
      generatedRecoveryMilestoneCoverage(generatedSnapshot),
      {
        status: coverage.status,
        laneIds: [...coverage.sourceLaneIds],
        requiredLaneCount: coverage.laneCount,
        coveredLaneCount: coverage.passedLaneCount,
        gapCount: coverage.laneCount - coverage.passedLaneCount,
        familyCount: coverage.familyCount,
        expectedLaneCount: coverage.expectedLaneCount,
        expectedFamilyCount: coverage.expectedFamilyCount,
        families: coverage.families,
        ...expectedPrivateChannelEvidenceObjectsForScenario(scenario),
      },
      `${scenario.generatedFromKey} should mirror proof-run ${scenario.coverageKey}`,
    );
  }
}

function visibleRecoveryMilestoneCoverage(check) {
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    evidence: check.evidence,
    proofBoundary: check.proofBoundary,
    laneIds: check.laneIds,
    requiredLaneCount: check.requiredLaneCount,
    coveredLaneCount: check.coveredLaneCount,
    familyCount: check.familyCount,
    expectedLaneCount: check.expectedLaneCount,
    expectedFamilyCount: check.expectedFamilyCount,
    ...(check.surfaceCoverage === undefined
      ? {}
      : { surfaceCoverage: check.surfaceCoverage }),
    ...(check.normalizedEvidenceObjects === undefined
      ? {}
      : { normalizedEvidenceObjects: check.normalizedEvidenceObjects }),
  };
}

function generatedRecoveryMilestoneCoverage(milestone) {
  return {
    status: milestone.status,
    laneIds: milestone.laneIds,
    requiredLaneCount: milestone.requiredLaneCount,
    coveredLaneCount: milestone.coveredLaneCount,
    gapCount: milestone.gapCount,
    familyCount: milestone.familyCount,
    expectedLaneCount: milestone.expectedLaneCount,
    expectedFamilyCount: milestone.expectedFamilyCount,
    families: milestone.families,
    ...(milestone.normalizedEvidenceObjects === undefined
      ? {}
      : { normalizedEvidenceObjects: milestone.normalizedEvidenceObjects }),
  };
}

function expectedPrivateChannelEvidenceObjectsForScenario(scenario) {
  const objectsByGeneratedFromKey = {
    privateChannelRecoveryMilestone: privateChannelNormalizedEvidenceObjects,
    replacementPrivateRecoveryMilestone:
      replacementPrivatePostNormalizedEvidenceObjects,
  };
  const objects = objectsByGeneratedFromKey[scenario.generatedFromKey];
  return objects === undefined
    ? {}
    : {
        normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
          objects,
        ),
      };
}

function expectedPrivateChannelFeatureEvidenceObjectNames(slotId) {
  return slotId === "private-channel"
    ? ["submitPostAckProof", "completedPostRejectProof"]
    : [];
}

function expectedPassedNormalizedEvidenceObjects(objects) {
  return objects.map((object) => ({
    ...object,
    status: "passed",
    evidencePath: `lanes.${object.laneId}.evidence.${object.name}`,
  }));
}

function expectedNormalizedEvidenceObjectRowIds({ parentId, objects }) {
  return normalizedEvidenceObjectRowIds({ parentId, objects });
}

function staleConflictMessageMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...staleConflictMessageLaneIds],
    requiredLaneCount: staleConflictMessageLaneIds.length,
    coveredLaneCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
    familyCount: staleConflictMessageCoverageFamilies().length,
    expectedLaneCount: staleConflictMessageLaneIds.length,
    expectedFamilyCount: staleConflictMessageCoverageFamilies().length,
    families: staleConflictMessageCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
    surfaceCoverage: staleConflictMessageSurfaceCoverageFixture(),
    surfaces: staleConflictMessageSurfaceFixtureRows(),
  };
}

function staleConflictMessageSurfaceCoverageFixture() {
  return {
    status: "complete",
    requiredSurfaceCount: staleConflictMessageLaneIds.length,
    coveredSurfaceCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
  };
}

function staleConflictMessageSurfaceFixtureRows() {
  return staleConflictMessageSurfaceCases().map((scenario) => ({
    id: scenario.id,
    checkId: scenario.checkId,
    label: scenario.label,
    status: "passed",
    laneId: scenario.laneId,
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    rejectError: scenario.expectedRejectError,
    rejectMessage:
      scenario.expectedRejectMessageFragment === undefined
        ? ""
        : `Reject ${scenario.expectedRejectError}: ${scenario.expectedRejectMessageFragment}`,
    receiptStatusText:
      scenario.expectedReceiptFragment === undefined
        ? ""
        : `Reject ${scenario.expectedRejectError}: ${scenario.expectedReceiptFragment}`,
    proofBoundary: scenario.proofBoundary,
  }));
}

function hostStaleControlMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...hostStaleControlLaneIds],
    requiredLaneCount: hostStaleControlLaneIds.length,
    coveredLaneCount: hostStaleControlLaneIds.length,
    gapCount: 0,
    familyCount: hostStaleControlCoverageFamilies().length,
    expectedLaneCount: hostStaleControlLaneIds.length,
    expectedFamilyCount: hostStaleControlCoverageFamilies().length,
    families: hostStaleControlCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
  };
}

function privateChannelRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
    requiredLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
    coveredLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
    gapCount: 0,
    familyCount: coreLoopPrivateChannelRecoveryCoverageFamilies().length,
    expectedLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
    expectedFamilyCount: coreLoopPrivateChannelRecoveryCoverageFamilies().length,
    families: coreLoopPrivateChannelRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
    ...expectedPrivateChannelEvidenceObjectsForScenario({
      generatedFromKey: "privateChannelRecoveryMilestone",
    }),
  };
}

function replacementActionRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...replacementActionLaneIds],
    requiredLaneCount: replacementActionLaneIds.length,
    coveredLaneCount: replacementActionLaneIds.length,
    gapCount: 0,
    familyCount: replacementActionRecoveryCoverageFamilies().length,
    expectedLaneCount: replacementActionLaneIds.length,
    expectedFamilyCount: replacementActionRecoveryCoverageFamilies().length,
    families: replacementActionRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
  };
}

function replacementPrivateRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...replacementPrivateChannelRecoveryLaneIds],
    requiredLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
    coveredLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
    gapCount: 0,
    familyCount: replacementPrivateChannelRecoveryCoverageFamilies().length,
    expectedLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
    expectedFamilyCount:
      replacementPrivateChannelRecoveryCoverageFamilies().length,
    families: replacementPrivateChannelRecoveryCoverageFamilies().map(
      (family) => ({
        ...family,
        status: "passed",
        passedLaneIds: [...family.laneIds],
      }),
    ),
    ...expectedPrivateChannelEvidenceObjectsForScenario({
      generatedFromKey: "replacementPrivateRecoveryMilestone",
    }),
  };
}

function replacementHandoffRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...replacementHandoffRecoveryLaneIds],
    requiredLaneCount: replacementHandoffRecoveryLaneIds.length,
    coveredLaneCount: replacementHandoffRecoveryLaneIds.length,
    gapCount: 0,
    familyCount: replacementHandoffRecoveryCoverageFamilies().length,
    expectedLaneCount: replacementHandoffRecoveryLaneIds.length,
    expectedFamilyCount: replacementHandoffRecoveryCoverageFamilies().length,
    families: replacementHandoffRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
  };
}

function devTestGameRaceCoverageFixture() {
  const cells = [
    raceCoverageCell("player-vote-change", "concurrent-vote-race", "concurrent-vote-race-reload"),
    raceCoverageCell("player-night-action", "concurrent-action-race", "concurrent-action-race-reload"),
    raceCoverageCell(
      "player-vote-vs-host-resolve",
      "concurrent-player-vote-resolve-race",
      "concurrent-player-vote-resolve-race-reload",
    ),
    raceCoverageCell(
      "player-action-vs-host-advance",
      "concurrent-player-action-advance-race",
      "concurrent-player-action-advance-race-reload",
    ),
    raceCoverageCell(
      "cohost-deadline-vs-host-resolve",
      "concurrent-cohost-deadline-resolve-race",
      "concurrent-cohost-deadline-resolve-race-reload",
    ),
    raceCoverageCell(
      "replacement-private-post",
      replacementPrivatePostRaceLaneIds[0],
      replacementPrivatePostRaceLaneIds[1],
    ),
    raceCoverageCell(
      "replacement-vote",
      "concurrent-replacement-vote-race",
      "concurrent-replacement-vote-race-reload",
    ),
    raceCoverageCell(
      "replacement-action",
      "concurrent-replacement-action-race",
      "concurrent-replacement-action-race-reload",
    ),
    raceCoverageCell("host-resolve", "concurrent-host-resolve-race", "concurrent-host-resolve-race-reload"),
    raceCoverageCell("host-advance", "concurrent-host-advance-race", "concurrent-host-advance-race-reload"),
    raceCoverageCell(
      "host-deadline-advance",
      "concurrent-host-deadline-advance-race",
      "concurrent-host-deadline-advance-race-reload",
    ),
    raceCoverageCell("host-lifecycle", "concurrent-host-lifecycle-race", "concurrent-host-lifecycle-race-reload"),
    raceCoverageCell(
      "host-mixed-advance",
      "concurrent-host-mixed-advance-race",
      "concurrent-host-mixed-advance-race-reload",
    ),
    raceCoverageCell(
      "host-votecount-publication",
      "concurrent-host-publish-race",
      "concurrent-host-publish-race-reload",
    ),
    ...completedGameRaceCoverageCellCases().map(
      ({ id, raceLaneId, reloadLaneId }) =>
        raceCoverageCell(id, raceLaneId, reloadLaneId),
    ),
  ];
  return {
    version: 1,
    proof: "dev-test-game-race-coverage",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-race-coverage",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      proofGeneratedAt: "2026-06-26T00:00:00.000Z",
      game: "game-a",
      laneCount: 119,
    },
    summary: {
      cellCount: cells.length,
      provenCellCount: cells.length,
      unprovenCellCount: 0,
      reloadRequiredCellCount: cells.length,
      reloadCoveredCellCount: cells.length,
      reloadGapCount: 0,
    },
    cells,
    unprovenCells: [],
    reloadGaps: [],
  };
}

function hostConcurrentRaceReloadCellIdsFixture() {
  return raceReloadGroupCellIdsFixture("host-concurrent-race-reload");
}

function replacementRaceReloadCellIdsFixture() {
  return raceReloadGroupCellIdsFixture("replacement-race-reload");
}

function hostConcurrentRaceReloadCellsFixture() {
  return [
    {
      id: "host-resolve",
      raceLaneId: "concurrent-host-resolve-race",
      reloadLaneId: "concurrent-host-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-advance",
      raceLaneId: "concurrent-host-advance-race",
      reloadLaneId: "concurrent-host-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-deadline-advance",
      raceLaneId: "concurrent-host-deadline-advance-race",
      reloadLaneId: "concurrent-host-deadline-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-lifecycle",
      raceLaneId: "concurrent-host-lifecycle-race",
      reloadLaneId: "concurrent-host-lifecycle-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-mixed-advance",
      raceLaneId: "concurrent-host-mixed-advance-race",
      reloadLaneId: "concurrent-host-mixed-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-votecount-publication",
      raceLaneId: "concurrent-host-publish-race",
      reloadLaneId: "concurrent-host-publish-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    completedRaceCoverageCellFixture("host-complete-game"),
  ];
}

function playerConcurrentActionReloadCellIdsFixture() {
  return raceReloadGroupCellIdsFixture("player-concurrent-action-reload");
}

function playerConcurrentActionReloadCellsFixture() {
  return [
    {
      id: "player-vote-change",
      raceLaneId: "concurrent-vote-race",
      reloadLaneId: "concurrent-vote-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-night-action",
      raceLaneId: "concurrent-action-race",
      reloadLaneId: "concurrent-action-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-vote-vs-host-resolve",
      raceLaneId: "concurrent-player-vote-resolve-race",
      reloadLaneId: "concurrent-player-vote-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-action-vs-host-advance",
      raceLaneId: "concurrent-player-action-advance-race",
      reloadLaneId: "concurrent-player-action-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    completedRaceCoverageCellFixture("player-vs-completed-game"),
  ];
}

function cohostDeadlineRaceReloadCellIdsFixture() {
  return raceReloadGroupCellIdsFixture("cohost-deadline-race-reload");
}

function raceReloadGroupCellIdsFixture(groupId) {
  return [...raceCoveragePromotedReloadGroup(groupId).cellIds];
}

function raceReloadMilestoneFixture(groupId) {
  const cellIds = raceReloadGroupCellIdsFixture(groupId);
  return {
    status: "passed",
    cellIds,
    requiredCellCount: cellIds.length,
    coveredCellCount: cellIds.length,
    gapCount: 0,
  };
}

function cohostDeadlineRaceReloadCellsFixture() {
  return [
    {
      id: "cohost-deadline-vs-host-resolve",
      raceLaneId: "concurrent-cohost-deadline-resolve-race",
      reloadLaneId: "concurrent-cohost-deadline-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function raceCoveragePromotedMilestonesFixture({ groupStatus }) {
  const requiredCellCount = raceCoveragePromotedReloadGroups.reduce(
    (total, group) => total + group.cellIds.length,
    0,
  );
  return {
    status: "passed",
    cellCount: requiredCellCount,
    provenCellCount: requiredCellCount,
    reloadCoveredCellCount: requiredCellCount,
    groupCount: raceCoveragePromotedReloadGroups.length,
    passedGroupCount: raceCoveragePromotedReloadGroups.length,
    requiredCellCount,
    coveredCellCount: requiredCellCount,
    gapCount: 0,
    groups: raceCoveragePromotedReloadGroups.map((group) => ({
      id: group.id,
      label: group.label,
      status: groupStatus,
      cellIds: [...group.cellIds],
      requiredCellCount: group.cellIds.length,
      coveredCellCount: group.cellIds.length,
      gapCount: 0,
    })),
  };
}

function completedRaceCoverageCellFixture(id) {
  const cell = completedGameRaceCoverageCellCases().find(
    (candidate) => candidate.id === id,
  );
  if (cell === undefined) {
    throw new Error(`unknown completed race coverage fixture cell: ${id}`);
  }
  return {
    id: cell.id,
    raceLaneId: cell.raceLaneId,
    reloadLaneId: cell.reloadLaneId,
    reloadStatus: "passed",
    covered: true,
  };
}

function raceCoverageCell(id, raceLaneId, reloadLaneId) {
  return {
    id,
    actorPair: "test",
    commandFamily: "test",
    raceLaneId,
    raceStatus: "passed",
    reloadLaneId,
    reloadStatus: "passed",
    reloadCoverage: "passed",
    status: "passed",
    provenBy: [raceLaneId, reloadLaneId],
    missingLaneIds: [],
  };
}

function devTestGameOpsArtifactsFixture({
  proofStability = {
    status: "passed",
    hostConfirmClicks: {
      total: 55,
      firstClickCount: 55,
      concurrentClickCount: 0,
      retryClickCount: 0,
      domFallbackCount: 0,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 1,
      byAction: { resolve_phase: 20, extend_deadline: 35 },
      byRole: { host: 30, cohost: 25 },
      events: [],
    },
  },
} = {}) {
  return {
    version: 1,
    proof: "dev-test-game-ops-artifacts",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-ops-artifacts",
    proofBoundary: "Local artifact bundle.",
    generatedFrom: {
      sessionJson: "target/dev-test-game/session.json",
      proofRun: "target/dev-test-game/proof-run.json",
      readinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
    },
    run: {
      name: "midsummer",
      game: "midsummer",
      verificationStatus: "passed",
      seedCommandCount: 22,
      roleCount: 7,
    },
    roles: {},
    proofRun: {
      status: "passed",
      laneCount: 121,
      lanes: [],
      nonClaims: [],
    },
    proofStability,
    readiness: {
      status: "not_ready",
      releaseReady: false,
      productionReady: false,
      localChecks: [],
      unproven: [],
    },
    artifacts: {
      session: { path: "target/dev-test-game/session.json" },
      proofRun: { path: "target/dev-test-game/proof-run.json" },
      readiness: { path: "target/dev-test-game/release-readiness-checklist.json" },
    },
    checks: [
      { id: "source-artifacts-checksummed", status: "passed" },
      { id: "role-entrypoints-redacted", status: "passed" },
      { id: "proof-lanes-summarized", status: "passed" },
      {
        id: "proof-stability-summarized",
        status: "passed",
        hostConfirmClicks: proofStability.hostConfirmClicks.total,
        concurrentClickCount: proofStability.hostConfirmClicks.concurrentClickCount ?? 0,
        retryClickCount: proofStability.hostConfirmClicks.retryClickCount,
        domFallbackCount: proofStability.hostConfirmClicks.domFallbackCount,
        forceFallbackCount: proofStability.hostConfirmClicks.forceFallbackCount,
      },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function identityAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-identity-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-identity-admin-surface",
    proofBoundary: "Local admin identity adapter proof only.",
    generatedFrom: {
      identityAdapterProof: "target/auth-invite-role-proof/invite-role-proof.json",
      game: "00000000-0000-0000-0000-000000000001",
      identityAdapterContractStatus: "passed",
      identityAdapterContractMismatchIds: [],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-identity-adapter",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "account-login",
        "account-lifecycle",
        "session-rotation",
        "session-revocation",
        "invite-revocation",
        "host-scoped-invite-issuance",
        "audit-trail",
        "admin-audit-surface",
      ],
      visibleSessions: ["admin", "host", "player"],
      visibleIdentityAdapterContract: { status: "passed" },
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function coreLoopAdminProofFixture() {
  const completedGameHardeningCoverageStatus =
    completedGameHardeningCoverageStatusFixture();
  return {
    version: 1,
    proof: "dev-test-game-core-loop-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-core-loop-admin-surface",
    proofBoundary: "Local admin core-loop proof only.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      coreLoopSpineStatus:
        "passed: D01 -> N01 -> D02, vote ack, N02 action ack, next D03, terminal advance InvalidTarget, reload D03, revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03",
      completedGameHardeningCoverageStatus,
      ...coreLoopGeneratedFromScenarioFamilies(),
      coreLoopSpineRows: {
        cycles: [
          "d01-n01-d02",
          "d02-n02",
          "n02-d03",
          "d03-n03",
          "n03-d04",
          "d04-n04-d05",
          "d05-n05",
        ],
        roleUrls: [
          "d01-n01-d02-host",
          "d01-n01-d02-actionPlayer",
          "d01-n01-d02-normalPlayer",
          "d01-n01-d02-target",
          "d01-n01-d02-privateChannel",
          "d02-n02-host",
          "d02-n02-actionPlayer",
          "d02-n02-normalPlayer",
          "d02-n02-target",
          "n02-d03-host",
          "n02-d03-actionPlayer",
          "n02-d03-normalPlayer",
          "d03-n03-host",
          "d03-n03-actionPlayer",
          "d03-n03-normalPlayer",
          "n03-d04-host",
          "n03-d04-actionPlayer",
          "n03-d04-target",
          "d04-n04-d05-host",
          "d04-n04-d05-actionPlayer",
          "d04-n04-d05-deadPlayer",
          "d05-n05-host",
          "d05-n05-actionPlayer",
        ],
        roleUrlHrefs: {
          "d01-n01-d02-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001/host",
          "d01-n01-d02-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
          "d01-n01-d02-normalPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
          "d01-n01-d02-target":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
          "d01-n01-d02-privateChannel":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001/c/private%3Amafia_day_chat",
          "d02-n02-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
          "d02-n02-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d02-n02-normalPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d02-n02-target":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "n02-d03-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
          "n02-d03-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "n02-d03-normalPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d03-n03-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
          "d03-n03-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d03-n03-normalPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "n03-d04-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
          "n03-d04-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "n03-d04-target":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d04-n04-d05-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
          "d04-n04-d05-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d04-n04-d05-deadPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
          "d05-n05-host":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
          "d05-n05-actionPlayer":
            "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
        },
        checkpoints: [
          "d01-n01-d02-d01-resolved-locked",
          "d01-n01-d02-n01-action-open",
          "d01-n01-d02-n01-resolved-target-killed",
          "d01-n01-d02-d02-day-controls-return",
          "d02-n02-d02-vote-open",
          "d02-n02-d02-deciding-vote-submitted",
          "d02-n02-d02-resolved-target-killed",
          "d02-n02-n02-action-open",
          "n02-d03-n02-action-open",
          "n02-d03-n02-action-submitted",
          "n02-d03-n02-resolved-target-killed",
          "n02-d03-d03-day-controls-return",
          "n02-d03-d03-terminal-advance-reject",
          "n02-d03-d03-terminal-reload-recovery",
          "n02-d03-d03-revote-prompt-resolved",
          "n02-d03-d03r1-revote-ballot-submitted",
          "n02-d03-d03r1-revote-resolved-no-majority",
          "n02-d03-d03r2-revote-prompt-resolved",
          "n02-d03-d03r2-revote-ballot-submitted",
          "n02-d03-d03r2-revote-resolved-no-majority",
          "n02-d03-d03r2-stale-continue-policy-recovery",
          "d03-n03-d03-terminal-advance-reject",
          "d03-n03-d03-terminal-reload-recovery",
          "d03-n03-d03-revote-prompt-resolved",
          "d03-n03-d03r1-revote-ballot-submitted",
          "d03-n03-d03r1-revote-resolved-no-majority",
          "d03-n03-d03r2-revote-prompt-resolved",
          "d03-n03-d03r2-revote-ballot-submitted",
          "d03-n03-d03r2-revote-resolved-no-majority",
          "d03-n03-d03r2-stale-continue-policy-recovery",
          "n03-d04-n03-action-open",
          "n03-d04-n03-action-submitted",
          "n03-d04-n03-resolved-target-killed",
          "n03-d04-d04-day-controls-return",
          "d04-n04-d05-d04-no-lynch-vote-submitted",
          "d04-n04-d05-d04-resolved-no-lynch",
          "d04-n04-d05-n04-no-action-open",
          "d04-n04-d05-n04-resolved-no-action",
          "d04-n04-d05-d05-day-controls-return",
          "d05-n05-d05-no-lynch-vote-submitted",
          "d05-n05-d05-resolved-no-lynch",
          "d05-n05-n05-night-controls-return",
        ],
        recoveryHooks: [
          "staleLockedVoteReject",
          "invalidActionReject",
          "normalPlayerDirectActionReject",
          "staleActionConflictReject",
          "staleVoteTransitionReject",
          "staleActionTransitionReject",
          "d03TerminalAdvanceReject",
        ],
      },
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
      linkTestId: `admin-audit-link-${localAdminAuditIds.coreLoop}`,
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [...coreLoopAdminCheckIds],
      visibleCheckStatuses: {
        "core-loop-spine":
          "passed: D01 -> N01 -> D02, vote ack, N02 action ack, next D03, terminal advance InvalidTarget, reload D03, revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03, N03 action ack, next D04",
        "completed-game-hardening-coverage": completedGameHardeningCoverageStatus,
      },
      visibleSpineCycles: [
        "d01-n01-d02",
        "d02-n02",
        "n02-d03",
        "d03-n03",
        "n03-d04",
        "d04-n04-d05",
        "d05-n05",
      ],
      visibleSpineRoleUrls: [
        "d01-n01-d02-host",
        "d01-n01-d02-actionPlayer",
        "d01-n01-d02-normalPlayer",
        "d01-n01-d02-target",
        "d01-n01-d02-privateChannel",
        "d02-n02-host",
        "d02-n02-actionPlayer",
        "d02-n02-normalPlayer",
        "d02-n02-target",
        "n02-d03-host",
        "n02-d03-actionPlayer",
        "n02-d03-normalPlayer",
        "d03-n03-host",
        "d03-n03-actionPlayer",
        "d03-n03-normalPlayer",
        "n03-d04-host",
        "n03-d04-actionPlayer",
        "n03-d04-target",
        "d04-n04-d05-host",
        "d04-n04-d05-actionPlayer",
        "d04-n04-d05-deadPlayer",
        "d05-n05-host",
        "d05-n05-actionPlayer",
      ],
      visibleSpineCheckpoints: [
        "d01-n01-d02-d01-resolved-locked",
        "d01-n01-d02-n01-action-open",
        "d01-n01-d02-n01-resolved-target-killed",
        "d01-n01-d02-d02-day-controls-return",
        "d02-n02-d02-vote-open",
        "d02-n02-d02-deciding-vote-submitted",
        "d02-n02-d02-resolved-target-killed",
        "d02-n02-n02-action-open",
        "n02-d03-n02-action-open",
        "n02-d03-n02-action-submitted",
        "n02-d03-n02-resolved-target-killed",
        "n02-d03-d03-day-controls-return",
        "n02-d03-d03-terminal-advance-reject",
        "n02-d03-d03-terminal-reload-recovery",
        "n02-d03-d03-revote-prompt-resolved",
        "n02-d03-d03r1-revote-ballot-submitted",
        "n02-d03-d03r1-revote-resolved-no-majority",
        "n02-d03-d03r2-revote-prompt-resolved",
        "n02-d03-d03r2-revote-ballot-submitted",
        "n02-d03-d03r2-revote-resolved-no-majority",
        "n02-d03-d03r2-stale-continue-policy-recovery",
        "d03-n03-d03-terminal-advance-reject",
        "d03-n03-d03-terminal-reload-recovery",
        "d03-n03-d03-revote-prompt-resolved",
        "d03-n03-d03r1-revote-ballot-submitted",
        "d03-n03-d03r1-revote-resolved-no-majority",
        "d03-n03-d03r2-revote-prompt-resolved",
        "d03-n03-d03r2-revote-ballot-submitted",
        "d03-n03-d03r2-revote-resolved-no-majority",
        "d03-n03-d03r2-stale-continue-policy-recovery",
        "n03-d04-n03-action-open",
        "n03-d04-n03-action-submitted",
        "n03-d04-n03-resolved-target-killed",
        "n03-d04-d04-day-controls-return",
        "d04-n04-d05-d04-no-lynch-vote-submitted",
        "d04-n04-d05-d04-resolved-no-lynch",
        "d04-n04-d05-n04-no-action-open",
        "d04-n04-d05-n04-resolved-no-action",
        "d04-n04-d05-d05-day-controls-return",
        "d05-n05-d05-no-lynch-vote-submitted",
        "d05-n05-d05-resolved-no-lynch",
        "d05-n05-n05-night-controls-return",
      ],
      visibleSpineRecoveryHooks: [
        "staleLockedVoteReject",
        "invalidActionReject",
        "normalPlayerDirectActionReject",
        "staleActionConflictReject",
        "staleVoteTransitionReject",
        "staleActionTransitionReject",
        "d03TerminalAdvanceReject",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    hostRoleSurface: hostLifecycleRoleSurfaceFixture(),
    hostModkillControlSurface: hostModkillControlSurfaceFixture(),
    hostLifecycleRaceSurface: hostLifecycleRaceSurfaceFixture(),
    hostPublishRaceSurface: hostPublishRaceSurfaceFixture(),
    hostResolveRaceSurface: hostResolveRaceSurfaceFixture(),
    hostAdvanceRaceSurface: hostAdvanceRaceSurfaceFixture(),
    hostDeadlineAdvanceRaceSurface: hostDeadlineAdvanceRaceSurfaceFixture(),
    hostMixedAdvanceRaceSurface: hostMixedAdvanceRaceSurfaceFixture(),
    playerRoleSurface: playerActionRoleSurfaceFixture(),
    targetResolutionReceiptSurface: targetResolutionReceiptSurfaceFixture(),
    normalResolutionPrivacySurface: normalResolutionPrivacySurfaceFixture(),
    targetDayVoteReceiptSurface: targetDayVoteReceiptSurfaceFixture(),
    normalDayVotePrivacySurface: normalDayVotePrivacySurfaceFixture(),
    hostPhaseTransitionSurface: hostPhaseTransitionSurfaceFixture(),
    targetPostDayVoteAdvanceSurface: targetPostDayVoteAdvanceSurfaceFixture(),
    normalPostDayVoteAdvanceSurface: normalPostDayVoteAdvanceSurfaceFixture(),
    nightActionResolutionReceiptSurface:
      nightActionResolutionReceiptSurfaceFixture(),
    normalNightActionResolutionPrivacySurface:
      normalNightActionResolutionPrivacySurfaceFixture(),
    hostNightActionTransitionSurface: hostNightActionTransitionSurfaceFixture(),
    dayThreeVoteResolutionSurface: dayThreeVoteResolutionSurfaceFixture(),
    postDayThreeResolutionSurface: postDayThreeResolutionSurfaceFixture(),
    nightThreeEmptyResolutionSurface: nightThreeEmptyResolutionSurfaceFixture(),
    dayFourSurvivorRoleSurface: dayFourSurvivorRoleSurfaceFixture(),
    nightFourNoActionSurface: nightFourNoActionSurfaceFixture(),
    nightFourNoActionResolutionSurface: nightFourNoActionResolutionSurfaceFixture(),
    postNightFourTransitionSurface: postNightFourTransitionSurfaceFixture(),
    dayFiveNoLynchResolutionSurface: dayFiveNoLynchResolutionSurfaceFixture(),
    completedGameEndgameSurface: completedGameEndgameSurfaceFixture(),
    privateChannelRoleSurface: privateChannelRoleSurfaceFixture(),
  };
}

function hostLifecycleRoleSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    visitedRolePath: "/g/00000000-0000-0000-0000-000000000002/host",
    surfaceTestId: "host-console-surface",
    checkpointTestId: "host-lifecycle-control-checkpoint",
    clickedThroughFromRoleUrl: true,
    hostLifecycleControlCheckpoint: {
      proofCheckId: "host-lifecycle-control",
      phaseId: "D01",
      phaseState: "open",
      slotId: "slot-7",
      actionState: "enabled:mark_dead,modkill_slot",
      deadlineAffordance: "resolve_phase,lock_thread",
      visibleRows: [
        "phase",
        "slot",
        "actionState",
        "deadlineAffordance",
        "recovery",
      ],
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh host projection and use current lifecycle controls.",
      statusText: "Host lifecycle controls are reachable from this role URL",
    },
    hostLifecycleControlClickProof: {
      status: "passed",
      clickedAction: "lock_thread",
      commandKind: "LockThread",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
      },
      commandStatus: {
        state: "ack",
        message: "Ack: stream seqs 601",
      },
      commandOutcome: {
        state: "ack",
        message: "Ack: stream seqs 601",
      },
      bridgePlan: {
        role: "moderator",
        commandKind: "LockThread",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: [],
      },
      projection: {
        phase: {
          id: "D01",
          locked: true,
        },
      },
      checkpointPhaseStateAfterAck: "locked",
      checkpointDeadlineAffordanceAfterAck: "unlock_thread,advance_phase",
      statusText: "Ack: stream seqs 601",
      activityCount: 1,
      activityStatusText: "Ack: stream seqs 601",
    },
    hostLifecycleStaleRejectProof: {
      status: "passed",
      clickedAction: "lock_thread",
      commandKind: "LockThread",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
      },
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
        message: "Reject PhaseLocked: phase locked",
      },
      commandOutcome: {
        state: "reject",
        error: "PhaseLocked",
        message: "Reject PhaseLocked: phase locked",
      },
      bridgePlan: {
        role: "moderator",
        commandKind: "LockThread",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: ["host"],
      },
      projection: {
        phase: {
          id: "D01",
          locked: false,
        },
      },
      checkpointPhaseStateAfterReject: "open",
      checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh host projection and use current lifecycle controls.",
      activityCount: 1,
      activityStatusText: "Reject PhaseLocked: phase locked",
    },
    releaseReady: false,
    productionReady: false,
  };
}

function hostModkillControlSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "host-modkill-control",
    staleProofCheckId: "stale-host-modkill",
    staleReloadProofCheckId: "stale-host-modkill-reload",
    hostModkillControl: {
      id: "host-modkill-control",
      label: "Host modkill control disables player commands",
      status: "passed",
      evidence: {
        targetSlot: "slot-7",
        modkillState: "ack",
        commandStatus: "modkilled",
        apiModkillStatus: "modkilled",
        actorStatusAfterModkill: "modkilled",
        directPostError: "SlotNotAlive",
        restoreState: "ack",
        apiRestoredStatus: "alive",
        actorStatusAfterRestore: "alive",
      },
    },
    staleHostModkill: {
      id: "stale-host-modkill",
      label: "Stale host modkill rejects current status",
      status: "passed",
      evidence: {
        rejectError: "InvalidTarget",
        staleLifecycle: "Alive",
        apiStatus: "modkilled",
        actorStatus: "modkilled",
      },
    },
    staleHostModkillReload: {
      id: "stale-host-modkill-reload",
      label: "Stale host modkill reloads terminal slot controls",
      status: "passed",
      evidence: {
        routeResponseStatus: 200,
        routeStatus: 200,
        lifecycle: "Modkilled",
        apiStatus: "modkilled",
      },
    },
  };
}

function hostLifecycleRaceSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "concurrent-host-lifecycle-race",
    reloadProofCheckId: "concurrent-host-lifecycle-race-reload",
    hostLifecycleRace: {
      id: "concurrent-host-lifecycle-race",
      label: "Concurrent host lifecycle commands converge",
      status: "passed",
      evidence: {
        ackRaceRole: "dead",
        rejectRaceRole: "modkill",
        ackActionId: "mark_dead",
        rejectActionId: "modkill_slot",
        game: "lifecycle-race-game-a",
        winningStatus: "dead",
        rejectError: "InvalidTarget",
        apiStatus: "dead",
      },
    },
    hostLifecycleRaceReload: {
      id: "concurrent-host-lifecycle-race-reload",
      label: "Concurrent host lifecycle race reloads terminal slot projections",
      status: "passed",
      evidence: {
        game: "lifecycle-race-game-a",
        winningStatus: "dead",
        deadRouteStatus: 200,
        modkillRouteStatus: 200,
        playerRouteStatus: 200,
        deadLifecycleLabel: "Dead",
        modkillLifecycleLabel: "Dead",
        playerStatus: "dead",
        apiStatus: "dead",
      },
    },
  };
}

function hostPublishRaceSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "concurrent-host-publish-race",
    reloadProofCheckId: "concurrent-host-publish-race-reload",
    hostPublishRace: {
      id: "concurrent-host-publish-race",
      label: "Concurrent host publishes converge",
      status: "passed",
      evidence: {
        game: "publish-race-game-a",
        targetSlot: "slot_5",
        targetCount: 3,
        ackRaceRole: "second",
        rejectRaceRole: "first",
        ackState: "ack",
        rejectError: "InvalidTarget",
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
      },
    },
    hostPublishRaceReload: {
      id: "concurrent-host-publish-race-reload",
      label: "Concurrent host publish race reloads official count truth",
      status: "passed",
      evidence: {
        firstHostRouteStatus: 200,
        secondHostRouteStatus: 200,
        playerRouteStatus: 200,
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
      },
    },
  };
}

function hostResolveRaceSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "concurrent-host-resolve-race",
    reloadProofCheckId: "concurrent-host-resolve-race-reload",
    hostResolveRace: {
      id: "concurrent-host-resolve-race",
      label: "Concurrent host resolves converge",
      status: "passed",
      evidence: {
        ackPageRole: "concurrent",
        rejectPageRole: "live",
        game: "resolve-race-game-a",
        ackState: "ack",
        rejectError: "PhaseLocked",
        lockedAfterRace: true,
        lockedAfterRestore: false,
      },
    },
    hostResolveRaceReload: {
      id: "concurrent-host-resolve-race-reload",
      label: "Concurrent host resolve race reloads locked host projections",
      status: "passed",
      evidence: {
        game: "resolve-race-game-a",
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
        livePhase: { id: "D02", state: "locked", locked: true },
        concurrentPhase: { id: "D02", state: "locked", locked: true },
        apiLocked: true,
      },
    },
  };
}

function hostAdvanceRaceSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "concurrent-host-advance-race",
    reloadProofCheckId: "concurrent-host-advance-race-reload",
    hostAdvanceRace: {
      id: "concurrent-host-advance-race",
      label: "Concurrent host advances converge",
      status: "passed",
      evidence: {
        ackPageRole: "concurrent",
        rejectPageRole: "live",
        game: "advance-race-game-a",
        ackState: "ack",
        rejectError: "InvalidTarget",
        phaseAfterRace: "N02",
      },
    },
    hostAdvanceRaceReload: {
      id: "concurrent-host-advance-race-reload",
      label: "Concurrent host advance race reloads open host projections",
      status: "passed",
      evidence: {
        game: "advance-race-game-a",
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
        livePhase: { id: "N02", state: "open", locked: false },
        concurrentPhase: { id: "N02", state: "open", locked: false },
        apiPhase: "N02",
      },
    },
  };
}

function hostDeadlineAdvanceRaceSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "concurrent-host-deadline-advance-race",
    reloadProofCheckId: "concurrent-host-deadline-advance-race-reload",
    hostDeadlineAdvanceRace: {
      id: "concurrent-host-deadline-advance-race",
      label: "Concurrent host deadline advances converge",
      status: "passed",
      evidence: {
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        game: "deadline-advance-race-game-a",
        ackState: "ack",
        rejectError: "InvalidTarget",
        phaseAfterRace: "N01",
      },
    },
    hostDeadlineAdvanceRaceReload: {
      id: "concurrent-host-deadline-advance-race-reload",
      label:
        "Concurrent host deadline advance race reloads open host projections",
      status: "passed",
      evidence: {
        game: "deadline-advance-race-game-a",
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
        livePhase: { id: "N01", state: "open", locked: false },
        concurrentPhase: { id: "N01", state: "open", locked: false },
        apiPhase: "N01",
        apiDeadline: null,
      },
    },
  };
}

function hostMixedAdvanceRaceSurfaceFixture() {
  return {
    status: "passed",
    proofCheckId: "concurrent-host-mixed-advance-race",
    reloadProofCheckId: "concurrent-host-mixed-advance-race-reload",
    hostMixedAdvanceRace: {
      id: "concurrent-host-mixed-advance-race",
      label: "Concurrent host mixed advance commands converge",
      status: "passed",
      evidence: {
        ackRaceRole: "deadline",
        rejectRaceRole: "normal",
        ackActionId: "advance_phase_by_deadline",
        rejectActionId: "advance_phase",
        game: "mixed-advance-race-game-a",
        ackState: "ack",
        rejectError: "InvalidTarget",
        phaseAfterRace: "N01",
      },
    },
    hostMixedAdvanceRaceReload: {
      id: "concurrent-host-mixed-advance-race-reload",
      label: "Concurrent host mixed advance race reloads open host projections",
      status: "passed",
      evidence: {
        game: "mixed-advance-race-game-a",
        normalRouteStatus: 200,
        deadlineRouteStatus: 200,
        normalPhase: { id: "N01", state: "open", locked: false },
        deadlinePhase: { id: "N01", state: "open", locked: false },
        apiPhase: "N01",
        apiDeadline: null,
      },
    },
  };
}

function playerActionRoleSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    visitedRolePath: "/g/00000000-0000-0000-0000-000000000002",
    surfaceTestId: "player-surface",
    checkpointTestId: "player-action-submission-checkpoint",
    clickedThroughFromRoleUrl: true,
    playerActionSubmissionCheckpoint: {
      proofCheckId: "player-action-submission",
      phaseId: "N02",
      phaseState: "open",
      actorSlot: "slot-7",
      actionState: "enabled:submit_action:factional_kill",
      selectedAction: "factional_kill",
      targetSlots: "slot-3",
      receiptState: "idle",
      visibleRows: [
        "phase",
        "actor",
        "actionState",
        "target",
        "receipt",
        "recovery",
      ],
      targetText: "Selected target\nfactional_kill -> slot-3",
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh command state and use current action controls.",
      statusText: "Player action submission is reachable from this role URL",
    },
    playerActionSubmissionClickProof: {
      status: "passed",
      clickedAction: "submit_action:factional_kill",
      commandKind: "SubmitAction",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
        action_id: "factional_kill",
        actor_slot: "slot-7",
        template_id: "factional_kill",
        targets: ["slot-3"],
        grant_id: "grant-factional-kill",
      },
      commandStatus: {
        state: "ack",
        message: "Ack: stream seqs 501",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitAction",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: [
          "notifications",
          "investigationResults",
          "commandState",
        ],
      },
      receipts: [
        {
          actionId: "submit_action:factional_kill",
          state: "ack",
          message: "Ack: stream seqs 501",
          current: true,
        },
      ],
      projectionCommandState: {
        phase: {
          phaseId: "N02",
        },
        actions: [],
      },
      checkpointReceiptState: "ack:Ack: stream seqs 501",
      checkpointActionStateAfterAck: "disabled:no legal action available",
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 501",
    },
    playerActionInvalidRecoveryProof: {
      status: "passed",
      clickedAction: "submit_invalid_action:factional_kill",
      commandKind: "SubmitAction",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
        action_id: "invalid_self_factional_kill",
        actor_slot: "slot-7",
        template_id: "factional_kill",
        targets: ["slot-7"],
        grant_id: "grant-factional-kill",
      },
      commandStatus: {
        state: "reject",
        error: "InvalidTarget",
        message: playerInvalidActionRecoveryMessage,
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitAction",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: [
          "notifications",
          "investigationResults",
          "commandState",
        ],
      },
      receipts: [
        {
          actionId: "submit_invalid_action:factional_kill",
          state: "reject",
          message: playerInvalidActionRecoveryMessage,
          current: true,
        },
      ],
      projectionCommandState: {
        phase: {
          phaseId: "N02",
        },
        actions: [
          {
            templateId: "factional_kill",
          },
        ],
      },
      checkpointReceiptState: "reject:InvalidTarget",
      checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
      checkpointTargetSlotsAfterReject: "slot-3",
      receiptCount: 1,
      receiptStatusText: playerInvalidActionRecoveryMessage,
    },
    releaseReady: false,
    productionReady: false,
  };
}

function targetResolutionReceiptSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    targetSlot: "slot-2",
    principalUserId: "player_ilya",
    checkpoint: {
      phaseId: "N01",
      phaseState: "locked",
      actorSlot: "slot-2",
      actionState: "disabled:actor is not alive",
      receiptState: "idle",
      statusText: "Player action unavailable: actor is not alive",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 1,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: "player_killed\nfactional_kill\nReview player_killed",
      detailText: "Phase N01",
    },
    projectionCommandState: {
      actorSlot: "slot-2",
      actorAlive: false,
      actorStatus: "dead",
      actions: [],
      boundary:
        "Seeded browser target role received factional_kill private receipt after N01 resolution.",
    },
    projectionNotifications: [
      {
        effect: "player_killed",
        phase_id: "N01",
        status: "factional_kill",
      },
    ],
    resyncFromSeq: 901,
    resyncSnapshotCommandState: {
      actorSlot: "slot-2",
    },
    resyncSnapshotNotifications: [
      {
        effect: "player_killed",
      },
    ],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_ilya",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_ilya&slot_id=slot-2",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function normalResolutionPrivacySurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    normalSlot: "slot-4",
    principalUserId: "player_rowan",
    checkpoint: {
      phaseId: "N01",
      phaseState: "locked",
      actorSlot: "slot-4",
      actionState: "disabled:phase locked",
      receiptState: "idle",
      statusText: "Player action unavailable: phase locked",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 0,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateEmptyText: "No private results visible to this session.",
    targetReceiptVisible: false,
    projectionCommandState: {
      actorSlot: "slot-4",
      actorAlive: true,
      actorStatus: "alive",
      phase: {
        phaseId: "N01",
        locked: true,
      },
      actions: [],
      boundary:
        "Seeded browser normal role received no target-only private receipt after N01 resolution.",
    },
    projectionNotifications: [],
    resyncFromSeq: 901,
    resyncSnapshotCommandState: {
      actorSlot: "slot-4",
    },
    resyncSnapshotNotifications: [],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_rowan",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_rowan&slot_id=slot-4",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function targetDayVoteReceiptSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    targetSlot: "slot-2",
    principalUserId: "player_ilya",
    checkpoint: {
      phaseId: "D02",
      phaseState: "locked",
      actorSlot: "slot-2",
      actionState: "disabled:actor is not alive",
      receiptState: "idle",
      statusText: "Player action unavailable: actor is not alive",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 1,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: "player_killed\nday_vote\nReview player_killed",
      detailText: "Phase D02",
    },
    projectionCommandState: {
      actorSlot: "slot-2",
      actorAlive: false,
      actorStatus: "dead",
      phase: {
        phaseId: "D02",
        locked: true,
      },
      actions: [],
      boundary:
        "Seeded browser target role received day_vote private receipt after D02 resolution.",
    },
    projectionNotifications: [
      {
        effect: "player_killed",
        phase_id: "D02",
        status: "day_vote",
      },
    ],
    resyncFromSeq: 902,
    resyncSnapshotCommandState: {
      actorSlot: "slot-2",
    },
    resyncSnapshotNotifications: [
      {
        status: "day_vote",
      },
    ],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_ilya",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_ilya&slot_id=slot-2",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function normalDayVotePrivacySurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    normalSlot: "slot-4",
    principalUserId: "player_rowan",
    checkpoint: {
      phaseId: "D02",
      phaseState: "locked",
      actorSlot: "slot-4",
      actionState: "disabled:phase locked",
      receiptState: "idle",
      statusText: "Player action unavailable: phase locked",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 0,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateEmptyText: "No private results visible to this session.",
    targetReceiptVisible: false,
    projectionCommandState: {
      actorSlot: "slot-4",
      actorAlive: true,
      actorStatus: "alive",
      phase: {
        phaseId: "D02",
        locked: true,
      },
      actions: [],
      boundary:
        "Seeded browser normal role received no target-only private receipt after D02 resolution.",
    },
    projectionNotifications: [],
    resyncFromSeq: 902,
    resyncSnapshotCommandState: {
      actorSlot: "slot-4",
    },
    resyncSnapshotNotifications: [],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_rowan",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_rowan&slot_id=slot-4",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function targetPostDayVoteAdvanceSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    targetSlot: "slot-2",
    principalUserId: "player_ilya",
    checkpoint: {
      phaseId: "N02",
      phaseState: "open",
      actorSlot: "slot-2",
      actionState: "disabled:actor is not alive",
      receiptState: "idle",
      statusText: "Player action unavailable: actor is not alive",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 1,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: "player_killed\nday_vote\nReview player_killed",
      detailText: "Phase D02",
    },
    projectionCommandState: {
      actorSlot: "slot-2",
      actorAlive: false,
      actorStatus: "dead",
      phase: {
        phaseId: "N02",
        locked: false,
      },
      actions: [],
      boundary:
        "Seeded browser target role remained dead after host advanced D02 to open N02.",
    },
    projectionNotifications: [
      {
        effect: "player_killed",
        phase_id: "D02",
        status: "day_vote",
      },
    ],
    resyncFromSeq: 903,
    resyncSnapshotCommandState: {
      actorSlot: "slot-2",
      phase: {
        phaseId: "N02",
      },
    },
    resyncSnapshotNotifications: [
      {
        status: "day_vote",
      },
    ],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_ilya",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_ilya&slot_id=slot-2",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function normalPostDayVoteAdvanceSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    normalSlot: "slot-4",
    principalUserId: "player_rowan",
    checkpoint: {
      phaseId: "N02",
      phaseState: "open",
      actorSlot: "slot-4",
      actionState: "disabled:no legal action available",
      receiptState: "idle",
      statusText: "Player action unavailable: no legal action available",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 0,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateEmptyText: "No private results visible to this session.",
    targetReceiptVisible: false,
    projectionCommandState: {
      actorSlot: "slot-4",
      actorAlive: true,
      actorStatus: "alive",
      phase: {
        phaseId: "N02",
        locked: false,
      },
      actions: [],
      boundary:
        "Seeded browser normal role stayed alive with no target-only receipt after host advanced D02 to open N02.",
    },
    projectionNotifications: [],
    resyncFromSeq: 903,
    resyncSnapshotCommandState: {
      actorSlot: "slot-4",
      phase: {
        phaseId: "N02",
      },
    },
    resyncSnapshotNotifications: [],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_rowan",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_rowan&slot_id=slot-4",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function nightActionResolutionReceiptSurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    targetSlot: "slot-3",
    principalUserId: "player-seed",
    checkpoint: {
      phaseId: "N02",
      phaseState: "locked",
      actorSlot: "slot-3",
      actionState: "disabled:actor is not alive",
      receiptState: "idle",
      statusText: "Player action unavailable: actor is not alive",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 1,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: "player_killed\nfactional_kill\nReview player_killed",
      detailText: "Phase N02",
    },
    projectionCommandState: {
      actorSlot: "slot-3",
      actorAlive: false,
      actorStatus: "dead",
      phase: {
        phaseId: "N02",
        locked: true,
      },
      actions: [],
      boundary:
        "Seeded browser night target role received factional_kill private receipt after N02 resolution.",
    },
    projectionNotifications: [
      {
        effect: "player_killed",
        phase_id: "N02",
        status: "factional_kill",
      },
    ],
    resyncFromSeq: 904,
    resyncSnapshotCommandState: {
      actorSlot: "slot-3",
      phase: {
        phaseId: "N02",
      },
    },
    resyncSnapshotNotifications: [
      {
        status: "factional_kill",
      },
    ],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player-seed",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player-seed&slot_id=slot-3",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function normalNightActionResolutionPrivacySurfaceFixture() {
  return {
    status: "passed",
    sourceRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    visitedRolePath:
      "/g/00000000-0000-0000-0000-000000000002?private=notification-1",
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    normalSlot: "slot-4",
    principalUserId: "player_rowan",
    checkpoint: {
      phaseId: "N02",
      phaseState: "locked",
      actorSlot: "slot-4",
      actionState: "disabled:phase locked",
      receiptState: "idle",
      statusText: "Player action unavailable: phase locked",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 0,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    privateEmptyText: "No private results visible to this session.",
    targetReceiptVisible: false,
    projectionCommandState: {
      actorSlot: "slot-4",
      actorAlive: true,
      actorStatus: "alive",
      phase: {
        phaseId: "N02",
        locked: true,
      },
      actions: [],
      boundary:
        "Seeded browser normal role received no target-only private receipt after N02 resolution.",
    },
    projectionNotifications: [],
    resyncFromSeq: 904,
    resyncSnapshotCommandState: {
      actorSlot: "slot-4",
      phase: {
        phaseId: "N02",
      },
    },
    resyncSnapshotNotifications: [],
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/notifications?principal_user_id=player_rowan",
      commandStateEndpoint:
        "/games/00000000-0000-0000-0000-000000000002/player-command-state?principal_user_id=player_rowan&slot_id=slot-4",
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function hostPhaseTransitionSurfaceFixture() {
  return {
    status: "passed",
    sourceHostRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    sourcePlayerRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    visitedHostRolePath: "/g/00000000-0000-0000-0000-000000000002/host",
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    transition: "resolve_phase:ack:801 -> advance_phase:ack:802 -> player:N02",
    resolveProof: hostPhaseTransitionActionFixture({
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 801,
      phaseId: "D02",
      phaseState: "locked",
      deadlineAffordance: "unlock_thread,advance_phase",
      projectionRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
      command: {
        game: "00000000-0000-0000-0000-000000000002",
        seed: 918273,
      },
    }),
    advanceProof: hostPhaseTransitionActionFixture({
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 802,
      phaseId: "N02",
      phaseState: "open",
      deadlineAffordance: "resolve_phase,lock_thread",
      projectionRefreshKeys: [],
      command: {
        game: "00000000-0000-0000-0000-000000000002",
      },
    }),
    staleHostAdvanceRecoveryProof: {
      status: "passed",
      sourceRoleUrl:
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
      visitedRolePath: "/g/00000000-0000-0000-0000-000000000002/host",
      surfaceTestId: "host-console-surface",
      setupResyncFromSeq: 801,
      setupSnapshotHost: {
        phase: {
          id: "D02",
          state: "locked",
        },
      },
      clickedAction: "advance_phase",
      commandKind: "AdvancePhase",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
      },
      commandStatus: {
        state: "reject",
        error: "InvalidTarget",
        message:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      },
      commandOutcome: {
        state: "reject",
        error: "InvalidTarget",
        message:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      },
      bridgePlan: {
        role: "moderator",
        commandKind: "AdvancePhase",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: ["host"],
      },
      projection: {
        phase: {
          id: "N02",
          state: "open",
          locked: false,
        },
      },
      checkpointPhaseIdAfterReject: "N02",
      checkpointPhaseStateAfterReject: "open",
      checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
      activityStatusText:
        "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      releaseReady: false,
      productionReady: false,
    },
    playerObservationProof: {
      status: "passed",
      sourceRoleUrl:
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
      visitedRolePath: "/g/00000000-0000-0000-0000-000000000002",
      surfaceTestId: "player-surface",
      resyncFromSeq: 802,
      resyncKeys: [
        "thread",
        "votecount",
        "dayVoteOutcomes",
        "notifications",
        "investigationResults",
        "commandState",
      ],
      staleVoteRecoveryProof: {
        status: "passed",
        clickedAction: "submit_vote",
        commandKind: "SubmitVote",
        setupResyncFromSeq: 801,
        setupSnapshotCommandState: {
          phase: {
            phaseId: "D02",
          },
          voteTargets: [
            { kind: "slot", slotId: "slot-2", label: "Slot 2" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        command: {
          game: "00000000-0000-0000-0000-000000000002",
          actor_slot: "slot-7",
          target: { Slot: "slot-2" },
        },
        commandStatus: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
        },
        bridgePlan: {
          role: "player",
          commandKind: "SubmitVote",
          commandEndpoint: "/commands",
          finalState: "reject",
          projectionRefreshKeys: [
            "votecount",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        receipts: [
          {
            actionId: "submit_vote",
            state: "reject",
            message:
              "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
            current: true,
          },
        ],
        projectionCommandState: {
          phase: {
            phaseId: "N02",
          },
          boundary:
            "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
        },
        checkpointReceiptState: "reject:PhaseLocked",
        checkpointPhaseIdAfterReject: "N02",
        checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
        checkpointTargetSlotsAfterReject: "slot-3",
        recoveryText:
          "Stale recovery\nReject PhaseLocked: refresh command state and use current action controls.",
        receiptCount: 1,
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
      },
      staleActionRecoveryProof: {
        status: "passed",
        clickedAction: "submit_action:factional_kill",
        commandKind: "SubmitAction",
        command: {
          game: "00000000-0000-0000-0000-000000000002",
          action_id: "factional_kill",
          actor_slot: "slot-7",
          template_id: "factional_kill",
          targets: ["slot-3"],
          grant_id: "grant-factional-kill",
        },
        commandStatus: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        },
        bridgePlan: {
          role: "player",
          commandKind: "SubmitAction",
          commandEndpoint: "/commands",
          finalState: "reject",
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
        },
        receipts: [
          {
            actionId: "submit_vote",
            state: "reject",
            message:
              "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
            current: false,
          },
          {
            actionId: "submit_action:factional_kill",
            state: "reject",
            message:
              "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
            current: true,
          },
        ],
        projectionCommandState: {
          phase: {
            phaseId: "N02",
          },
          boundary:
            "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
        },
        checkpointReceiptState: "reject:PhaseLocked",
        checkpointPhaseIdAfterReject: "N02",
        checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
        checkpointTargetSlotsAfterReject: "slot-3",
        recoveryText:
          "Stale recovery\nReject PhaseLocked: refresh command state and use current action controls.",
        receiptCount: 2,
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      },
      resyncSnapshotCommandState: {
        phase: {
          phaseId: "N02",
        },
      },
      projectionCommandState: {
        phase: {
          phaseId: "N02",
        },
        boundary:
          "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
      },
      checkpointPhaseId: "N02",
      checkpointPhaseState: "open",
      checkpointActionState: "enabled:submit_action:factional_kill",
      checkpointTargetSlots: "slot-3",
      checkpointReceiptState: "reject:PhaseLocked",
      releaseReady: false,
      productionReady: false,
    },
    releaseReady: false,
    productionReady: false,
  };
}

function hostNightActionTransitionSurfaceFixture() {
  const game = "00000000-0000-0000-0000-000000000002";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceNightTargetRoleUrl: `${baseRoleUrl}?private=notification-1`,
    sourceNormalRoleUrl: `${baseRoleUrl}?private=notification-1`,
    visitedHostRolePath: `/g/${game}/host`,
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    transition:
      "resolve_phase:ack:905 -> advance_phase:ack:906 -> actionPlayer:D03 -> target:D03 -> normal:D03",
    resolveProof: hostPhaseTransitionActionFixture({
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 905,
      phaseId: "N02",
      phaseState: "locked",
      deadlineAffordance: "unlock_thread,advance_phase",
      projectionRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
      command: {
        game,
        seed: 918273,
      },
    }),
    advanceProof: hostPhaseTransitionActionFixture({
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 906,
      phaseId: "D03",
      phaseState: "open",
      deadlineAffordance: "resolve_phase,lock_thread",
      projectionRefreshKeys: [],
      command: {
        game,
      },
    }),
    actionPlayerObservationProof: dayThreeObservationFixture({
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      principalUserId: "player_mira",
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      boundary:
        "Seeded browser action player observed host AdvancePhase from resolved N02 into open D03.",
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
      notificationsEndpoint: `/games/${game}/notifications?principal_user_id=player_mira`,
    }),
    nightTargetObservationProof: dayThreeObservationFixture({
      sourceRoleUrl: `${baseRoleUrl}?private=notification-1`,
      visitedRolePath: `/g/${game}?private=notification-1`,
      principalUserId: "player-seed",
      slotField: "targetSlot",
      slot: "slot-3",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "Player action unavailable: actor is not alive",
      privateCount: 1,
      boundary:
        "Seeded browser killed target stayed dead with factional_kill receipt after host advanced N02 to D03.",
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=player-seed&slot_id=slot-3`,
      notificationsEndpoint: `/games/${game}/notifications?principal_user_id=player-seed`,
    }),
    normalObservationProof: dayThreeObservationFixture({
      sourceRoleUrl: `${baseRoleUrl}?private=notification-1`,
      visitedRolePath: `/g/${game}?private=notification-1`,
      principalUserId: "player_rowan",
      slotField: "normalSlot",
      slot: "slot-4",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      boundary:
        "Seeded browser normal player observed open D03 with no target-only private receipt after host advanced N02.",
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=player_rowan&slot_id=slot-4`,
      notificationsEndpoint: `/games/${game}/notifications?principal_user_id=player_rowan`,
    }),
    releaseReady: false,
    productionReady: false,
  };
}

function dayThreeObservationFixture({
  sourceRoleUrl,
  visitedRolePath,
  principalUserId,
  slotField,
  slot,
  actorAlive,
  actorStatus,
  actionState,
  statusText,
  privateCount,
  boundary,
  commandStateEndpoint,
  notificationsEndpoint,
}) {
  const privateReceipt = privateCount > 0;
  const proof = {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    [slotField]: slot,
    principalUserId,
    checkpoint: {
      phaseId: "D03",
      phaseState: "open",
      actorSlot: slot,
      actionState,
      receiptState: "idle",
      statusText,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: privateCount,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    projectionCommandState: {
      actorSlot: slot,
      actorAlive,
      actorStatus,
      phase: {
        phaseId: "D03",
        locked: false,
      },
      actions: [],
      boundary,
    },
    projectionNotifications: privateReceipt
      ? [
          {
            effect: "player_killed",
            phase_id: "N02",
            status: "factional_kill",
          },
        ]
      : [],
    resyncFromSeq: 906,
    resyncSnapshotCommandState: {
      actorSlot: slot,
      phase: {
        phaseId: "D03",
      },
    },
    resyncSnapshotNotifications: privateReceipt
      ? [
          {
            status: "factional_kill",
          },
        ]
      : [],
    coldLoadEndpoints: {
      notificationsEndpoint,
      commandStateEndpoint,
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (privateReceipt) {
    proof.privateNotice = {
      id: "notification-1",
      kind: "notification",
      text: "player_killed factional_kill",
      detailText: "Phase N02",
    };
  } else {
    proof.privateEmptyText = "No private results visible";
  }
  return proof;
}

function dayThreeVoteResolutionSurfaceFixture() {
  const game = "00000000-0000-0000-0000-000000000002";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    clickedThroughFromRoleUrl: true,
    transition: "player:submit_vote:ack:907 -> host:resolve_phase:ack:908",
    playerVoteProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_vote",
      commandKind: "SubmitVote",
      command: {
        game,
        actor_slot: "slot-7",
        target: { Slot: "slot-4" },
      },
      commandStatus: {
        state: "ack",
        message: "Ack: stream seqs 907",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitVote",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: ["votecount", "commandState"],
      },
      receipts: [
        {
          actionId: "submit_vote",
          state: "ack",
          message: "Ack: stream seqs 907",
          current: true,
        },
      ],
      projectionCommandState: {
        actorSlot: "slot-7",
        phase: {
          phaseId: "D03",
          locked: false,
        },
        currentVote: {
          kind: "slot",
          slotId: "slot-4",
          label: "Slot 4",
        },
        boundary:
          "Seeded browser Day 3 vote ACK refreshed current vote and votecount projection.",
      },
      projectionVotecount: [
        {
          target: "slot-4 / Rowan",
          count: 2,
          needed: 2,
        },
      ],
      projectionDayVoteOutcomes: [
        {
          phaseId: "D02",
          status: "Lynch",
        },
      ],
      setupResyncFromSeq: 906,
      setupSnapshotCommandState: {
        phase: {
          phaseId: "D03",
        },
      },
      currentVote: {
        hasVote: "true",
        text: "Current vote Slot 4",
      },
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 907",
      receiptRefreshKeys: "votecount,commandState",
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    hostResolutionProof: seededCoreLoopHostSurfaceFixture({
      game,
      resolveProof: {
        ...hostPhaseTransitionActionFixture({
          actionId: "resolve_phase",
          commandKind: "ResolvePhase",
          streamSeq: 908,
          phaseId: "D03",
          phaseState: "locked",
          deadlineAffordance: "unlock_thread,advance_phase",
          projectionRefreshKeys: [
            "host",
            "votecount",
            "dayVoteOutcomes",
            "hostPrompts",
          ],
          command: {
            game,
            seed: 918273,
          },
        }),
        votecountProjection: [
          {
            target: "slot-4 / Rowan",
            count: 2,
            needed: 2,
          },
        ],
        dayVoteOutcomesProjection: [
          { phaseId: "D02", status: "Lynch" },
          { phaseId: "D03", status: "Lynch", winnerSlot: "slot-4" },
        ],
      },
      hostVotecountProjection: [
        {
          target: "slot-4 / Rowan",
          count: 2,
          needed: 2,
        },
      ],
      hostDayVoteOutcomesProjection: [
        { phaseId: "D02", status: "Lynch" },
        { phaseId: "D03", status: "Lynch", winnerSlot: "slot-4" },
      ],
    }),
    releaseReady: false,
    productionReady: false,
  };
}

function nightThreeEmptyResolutionSurfaceFixture() {
  const game = "00000000-0000-0000-0000-000000000002";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition:
      "actionPlayer:N03:no_action -> host:resolve_phase:ack:910 -> host:advance_phase:ack:911 -> actionPlayer:D04:no_lynch_vote",
    actionPlayerNoActionProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "N03",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player opened N03 with no legal night action after D03 attrition.",
      resyncFromSeq: 909,
    }),
    hostTransitionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 909,
      setupPhaseId: "N03",
      setupPhaseState: "open",
      resolveProof: hostPhaseTransitionActionFixture({
        actionId: "resolve_phase",
        commandKind: "ResolvePhase",
        streamSeq: 910,
        phaseId: "N03",
        phaseState: "locked",
        deadlineAffordance: "unlock_thread,advance_phase",
        projectionRefreshKeys: [
          "host",
          "votecount",
          "dayVoteOutcomes",
          "hostPrompts",
        ],
        command: {
          game,
          seed: 918273,
        },
      }),
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 911,
        phaseId: "D04",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
      }),
    }),
    actionPlayerDayFourProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "D04",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed host AdvancePhase from empty N03 into open D04 no-lynch voting.",
      resyncFromSeq: 911,
      voteButtonCount: 1,
      voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
    }),
    releaseReady: false,
    productionReady: false,
  };
}

function dayFourSurvivorRoleSurfaceFixture() {
  const game = "00000000-0000-0000-0000-000000000002";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    survivorProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "survivorSlot",
      slot: "slot-5",
      principalUserId: "player_sage",
      phaseId: "D04",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser survivor role opened D04 as a living vote target for the next night-action loop.",
      resyncFromSeq: 911,
      voteButtonCount: 2,
      voteTargets: [
        { kind: "slot", slotId: "slot-7", label: "Slot 7" },
        { kind: "no_lynch", slotId: null, label: "No lynch" },
      ],
    }),
    releaseReady: false,
    productionReady: false,
  };
}

function privateChannelRoleSurfaceFixture() {
  const game = "00000000-0000-0000-0000-000000000002";
  const roleUrl =
    `http://127.0.0.1:5173/g/${game}/c/role-pm?private=notification-1`;
  const visitedRolePath =
    `/g/${game}/c/role-pm?private=notification-1`;
  const completedPrivateReloadScenario = completedPrivateChannelReloadScenario();
  const staleCompletedPrivateScenario = staleCompletedPrivatePostScenario();
  const completedPrivateReloadSnapshot = completedPrivateChannelSnapshot({
    scenario: completedPrivateReloadScenario,
  });
  const completedPrivateRejectSnapshot = completedPrivateChannelSnapshot({
    scenario: completedPrivateReloadScenario,
    receiptState: `reject:${staleCompletedPrivateScenario.commandError}`,
    boundary: staleCompletedPrivateScenario.routeBoundary,
  });
  return {
    status: "passed",
    sourceRoleUrl: roleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    channelRailTestId: "player-channel-role-pm",
    clickedThroughFromRoleUrl: true,
    channelId: "role-pm",
    channelAriaCurrent: "page",
    commandPanelChannelId: "role-pm",
    channelContextChannelId: "role-pm",
    channelContextCapabilityLabel: "ChannelMember(role-pm)",
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 2,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    expandedPrivateItem: {
      id: "notification-1",
      detailTestId: "player-private-detail-notification-1",
      detailText: "Phase N02",
    },
    submitPostProof: {
      status: "passed",
      clickedAction: "submit_post",
      commandKind: "SubmitPost",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
        channel_id: "role-pm",
        actor_slot: "slot-7",
        body: "Private role proof post",
      },
      commandStatus: {
        state: "ack",
        message: "Ack: stream seqs 701",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitPost",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: [
          "thread",
          "votecount",
          "commandState",
          "dayVoteOutcomes",
        ],
      },
      receipts: [
        {
          actionId: "submit_post",
          state: "ack",
          message: "Ack: stream seqs 701",
          current: true,
        },
      ],
      projectionThread: {
        posts: [
          {
            seq: 701,
            body: "Private role proof post",
          },
        ],
      },
      privatePostBody: "Private role proof post",
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 701",
      receiptRefreshKeys: "thread,votecount,commandState,dayVoteOutcomes",
    },
    stalePostAfterPhaseTransitionProof: {
      status: "passed",
      sourceRoleUrl:
        "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/c/role-pm?private=notification-1",
      visitedRolePath:
        "/g/00000000-0000-0000-0000-000000000002/c/role-pm?private=notification-1",
      clickedAction: "submit_post",
      commandKind: "SubmitPost",
      command: {
        game: "00000000-0000-0000-0000-000000000002",
        channel_id: "role-pm",
        actor_slot: "slot-7",
        body: "Stale private phase proof post",
      },
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
        message:
          "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitPost",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: [
          "thread",
          "votecount",
          "commandState",
          "dayVoteOutcomes",
        ],
      },
      receipts: [
        {
          actionId: "submit_post",
          state: "reject",
          message:
            "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
          current: true,
        },
      ],
      projectionCommandState: {
        phase: {
          phaseId: "D02",
          locked: true,
        },
        boundary:
          "Seeded browser private post PhaseLocked recovery refreshed role-pm into locked Day 2.",
      },
      projectionThread: {
        posts: [
          {
            seq: 802,
            body: "Current role-pm thread after stale private post reject",
          },
        ],
      },
      stalePrivatePostBody: "Stale private phase proof post",
      currentThreadText: "Current role-pm thread after stale private post reject",
      checkpointPhaseId: "D02",
      checkpointActionState: "disabled:phase locked",
      checkpointReceiptState: "reject:PhaseLocked",
      receiptStatusText:
        "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
      receiptRefreshKeys: "thread,votecount,commandState,dayVoteOutcomes",
      rawInviteTokensVisible: false,
    },
    completedPrivateChannelProof: {
      status: "passed",
      sourceRoleUrl: roleUrl,
      visitedRolePath,
      clickedThroughFromRoleUrl: true,
      transition: completedPrivateChannelTransition(),
      reloadProof: {
        status: "passed",
        sourceRoleUrl: roleUrl,
        visitedRolePath,
        surfaceTestId: "player-surface",
        clickedThroughFromRoleUrl: true,
        resyncFromSeq: completedPrivateReloadScenario.resyncFromSeq,
        initialResyncSnapshotCommandState:
          completedPrivateReloadSnapshot.commandState,
        reloadedResyncSnapshotCommandState:
          completedPrivateReloadSnapshot.commandState,
        initialSnapshot: completedPrivateReloadSnapshot,
        reloadedSnapshot: completedPrivateReloadSnapshot,
        rawInviteTokensVisible: false,
        releaseReady: false,
        productionReady: false,
      },
      staleCompletedPostRecoveryProof: {
        status: "passed",
        sourceRoleUrl: roleUrl,
        visitedRolePath,
        clickedThroughFromRoleUrl: true,
        clickedAction: staleCompletedPrivateScenario.clickedAction,
        commandKind: staleCompletedPrivateScenario.commandKind,
        command: {
          game,
          channel_id: staleCompletedPrivateScenario.channelId,
          actor_slot: staleCompletedPrivateScenario.actorSlot,
          body: staleCompletedPrivateScenario.stalePostBody,
        },
        commandStatus: {
          state: "reject",
          error: staleCompletedPrivateScenario.commandError,
          message: staleCompletedPrivateScenario.commandMessage,
        },
        bridgePlan: {
          role: "player",
          commandKind: staleCompletedPrivateScenario.commandKind,
          commandEndpoint: "/commands",
          finalState: "reject",
          projectionRefreshKeys: staleCompletedPrivateScenario.expectedRefreshKeys,
        },
        receipts: [
          {
            actionId: staleCompletedPrivateScenario.clickedAction,
            state: "reject",
            message: staleCompletedPrivateScenario.commandMessage,
            current: true,
          },
        ],
        stalePrivatePostBody: staleCompletedPrivateScenario.stalePostBody,
        submitDisabledBeforeReject: false,
        snapshotAfterReject: completedPrivateRejectSnapshot,
        snapshotAfterReload: completedPrivateRejectSnapshot,
        reloadedResyncSnapshotCommandState:
          completedPrivateRejectSnapshot.commandState,
        receiptStatusText: staleCompletedPrivateScenario.commandMessage,
        receiptRefreshKeys:
          staleCompletedPrivateScenario.expectedRefreshKeys.join(","),
        rawInviteTokensVisible: false,
      },
      releaseReady: false,
      productionReady: false,
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

function coreLoopSpineTargetsFixture() {
  const roleUrlHrefs = {
    "d01-n01-d02-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001/host",
    "d01-n01-d02-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
    "d01-n01-d02-normalPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
    "d01-n01-d02-target":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001",
    "d01-n01-d02-privateChannel":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000001/c/private%3Amafia_day_chat",
    "d02-n02-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    "d02-n02-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d02-n02-normalPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d02-n02-target":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "n02-d03-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    "n02-d03-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "n02-d03-normalPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d03-n03-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    "d03-n03-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d03-n03-normalPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "n03-d04-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    "n03-d04-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "n03-d04-target":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d04-n04-d05-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    "d04-n04-d05-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d04-n04-d05-deadPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    "d05-n05-host":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host",
    "d05-n05-actionPlayer":
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
  };
  return {
    status: "passed",
    detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    defaultCycleId: "d02-n02",
    defaultRoleUrlId: "d02-n02-actionPlayer",
    defaultRoleUrl:
      "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002",
    defaultCheckpointId: "d02-n02-n02-action-open",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: [
      "d01-n01-d02",
      "d02-n02",
      "n02-d03",
      "d03-n03",
      "n03-d04",
      "d04-n04-d05",
      "d05-n05",
    ],
    roleUrlIds: [
      "d01-n01-d02-host",
      "d01-n01-d02-actionPlayer",
      "d01-n01-d02-normalPlayer",
      "d01-n01-d02-target",
      "d01-n01-d02-privateChannel",
      "d02-n02-host",
      "d02-n02-actionPlayer",
      "d02-n02-normalPlayer",
      "d02-n02-target",
      "n02-d03-host",
      "n02-d03-actionPlayer",
      "n02-d03-normalPlayer",
      "d03-n03-host",
      "d03-n03-actionPlayer",
      "d03-n03-normalPlayer",
      "n03-d04-host",
      "n03-d04-actionPlayer",
      "n03-d04-target",
      "d04-n04-d05-host",
      "d04-n04-d05-actionPlayer",
      "d04-n04-d05-deadPlayer",
      "d05-n05-host",
      "d05-n05-actionPlayer",
    ],
    checkpointIds: [
      "d01-n01-d02-d01-resolved-locked",
      "d01-n01-d02-n01-action-open",
      "d01-n01-d02-n01-resolved-target-killed",
      "d01-n01-d02-d02-day-controls-return",
      "d02-n02-d02-vote-open",
      "d02-n02-d02-deciding-vote-submitted",
      "d02-n02-d02-resolved-target-killed",
      "d02-n02-n02-action-open",
      "n02-d03-n02-action-open",
      "n02-d03-n02-action-submitted",
      "n02-d03-n02-resolved-target-killed",
      "n02-d03-d03-day-controls-return",
      "n02-d03-d03-terminal-advance-reject",
      "n02-d03-d03-terminal-reload-recovery",
      "n02-d03-d03-revote-prompt-resolved",
      "n02-d03-d03r1-revote-ballot-submitted",
      "n02-d03-d03r1-revote-resolved-no-majority",
      "n02-d03-d03r2-revote-prompt-resolved",
      "n02-d03-d03r2-revote-ballot-submitted",
      "n02-d03-d03r2-revote-resolved-no-majority",
      "n02-d03-d03r2-stale-continue-policy-recovery",
      "d03-n03-d03-terminal-advance-reject",
      "d03-n03-d03-terminal-reload-recovery",
      "d03-n03-d03-revote-prompt-resolved",
      "d03-n03-d03r1-revote-ballot-submitted",
      "d03-n03-d03r1-revote-resolved-no-majority",
      "d03-n03-d03r2-revote-prompt-resolved",
      "d03-n03-d03r2-revote-ballot-submitted",
      "d03-n03-d03r2-revote-resolved-no-majority",
      "d03-n03-d03r2-stale-continue-policy-recovery",
      "n03-d04-n03-action-open",
      "n03-d04-n03-action-submitted",
      "n03-d04-n03-resolved-target-killed",
      "n03-d04-d04-day-controls-return",
      "d04-n04-d05-d04-no-lynch-vote-submitted",
      "d04-n04-d05-d04-resolved-no-lynch",
      "d04-n04-d05-n04-no-action-open",
      "d04-n04-d05-n04-resolved-no-action",
      "d04-n04-d05-d05-day-controls-return",
      "d05-n05-d05-no-lynch-vote-submitted",
      "d05-n05-d05-resolved-no-lynch",
      "d05-n05-n05-night-controls-return",
    ],
    recoveryHookIds: [
      "staleLockedVoteReject",
      "invalidActionReject",
      "normalPlayerDirectActionReject",
      "staleActionConflictReject",
      "staleVoteTransitionReject",
      "staleActionTransitionReject",
      "d03TerminalAdvanceReject",
    ],
    visibleAdminCheckIds: [...coreLoopAdminCheckIds],
    roleUrlHrefs,
    productionFeatureTargets: coreLoopProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function coreLoopProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = Object.values(coreLoopFeatureSpineTargetRows).map(
    (row) => row.featureSlotId,
  );
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function hostSetupSpineTargetsFixture() {
  const roleUrlHrefs = {
    "host-setup": "http://127.0.0.1:5173/g/<seeded-game>/setup",
  };
  return {
    status: "passed",
    detailRoleUrl: roleUrlHrefs["host-setup"],
    defaultCycleId: hostSetupFeatureSpineCycleId,
    defaultRoleUrlId: "host-setup",
    defaultRoleUrl: roleUrlHrefs["host-setup"],
    defaultCheckpointId: "start-phase",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: [hostSetupFeatureSpineCycleId],
    roleUrlIds: ["host-setup"],
    checkpointIds: ["start-phase"],
    recoveryHookIds: [],
    visibleAdminCheckIds: [
      "game-created",
      "pack-valid",
      "slots-exist",
      "slots-occupied",
      "roles-assigned",
      "policy-acknowledged",
      "start-phase",
    ],
    roleUrlHrefs,
    productionFeatureTargets:
      hostSetupProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function hostSetupProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = Object.values(hostSetupFeatureSpineTargetRows).map(
    (row) => row.featureSlotId,
  );
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function cohostSpineTargetsFixture({
  roleUrl = "http://127.0.0.1:5173/g/<seeded-game>/host",
} = {}) {
  const roleUrlHrefs = {
    "cohost-console": roleUrl,
  };
  return {
    status: "passed",
    detailRoleUrl: roleUrlHrefs["cohost-console"],
    defaultCycleId: cohostFeatureSpineCycleId,
    defaultRoleUrlId: "cohost-console",
    defaultRoleUrl: roleUrlHrefs["cohost-console"],
    defaultCheckpointId: "extend-deadline-ack",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: [cohostFeatureSpineCycleId],
    roleUrlIds: ["cohost-console"],
    checkpointIds: ["extend-deadline-ack"],
    recoveryHookIds: [],
    visibleAdminCheckIds: ["cohost-console"],
    roleUrlHrefs,
    productionFeatureTargets:
      cohostProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function cohostProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = Object.values(cohostFeatureSpineTargetRows).map(
    (row) => row.featureSlotId,
  );
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function replacementSpineTargetsFixture({
  roleUrl = "http://127.0.0.1:5173/g/<seeded-game>",
} = {}) {
  const roleUrlHrefs = {
    "replacement-player": roleUrl,
  };
  return {
    status: "passed",
    detailRoleUrl: roleUrlHrefs["replacement-player"],
    defaultCycleId: replacementFeatureSpineCycleId,
    defaultRoleUrlId: "replacement-player",
    defaultRoleUrl: roleUrlHrefs["replacement-player"],
    defaultCheckpointId: "incoming-player-slot-authority",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: [replacementFeatureSpineCycleId],
    roleUrlIds: ["replacement-player"],
    checkpointIds: ["incoming-player-slot-authority"],
    recoveryHookIds: [],
    visibleAdminCheckIds: [
      "replacement-host-issued-invite",
      "replacement-session-refresh-recovery",
      "replacement-incoming-player",
      "replacement-stale-player",
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
    ],
    roleUrlHrefs,
    productionFeatureTargets:
      replacementProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function replacementProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = Object.values(replacementFeatureSpineTargetRows).map(
    (row) => row.featureSlotId,
  );
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function replacementActionSpineTargetsFixture({
  roleUrl = "http://127.0.0.1:5173/g/<replacement-action-game>",
} = {}) {
  const roleUrlHrefs = {
    "replacement-action": roleUrl,
  };
  return {
    status: "passed",
    detailRoleUrl: roleUrlHrefs["replacement-action"],
    defaultCycleId: replacementActionFeatureSpineCycleId,
    defaultRoleUrlId: "replacement-action",
    defaultRoleUrl: roleUrlHrefs["replacement-action"],
    defaultCheckpointId: "replacement-incoming-action",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: [replacementActionFeatureSpineCycleId],
    roleUrlIds: ["replacement-action"],
    checkpointIds: ["replacement-incoming-action"],
    recoveryHookIds: [],
    visibleAdminCheckIds: [
      "replacement-incoming-action",
      "replacement-action-reconnect",
      "replacement-stale-action-after-resolve",
    ],
    roleUrlHrefs,
    productionFeatureTargets:
      replacementActionProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function replacementActionProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = Object.values(replacementActionFeatureSpineTargetRows).map(
    (row) => row.featureSlotId,
  );
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function replacementPrivateSpineTargetsFixture({
  roleUrl =
    "http://127.0.0.1:5173/g/<replacement-private-game>/c/private%3Amafia_day_chat",
} = {}) {
  const roleUrlHrefs = {
    "replacement-private-channel": roleUrl,
  };
  return {
    status: "passed",
    detailRoleUrl: roleUrlHrefs["replacement-private-channel"],
    defaultCycleId: replacementPrivateFeatureSpineCycleId,
    defaultRoleUrlId: "replacement-private-channel",
    defaultRoleUrl: roleUrlHrefs["replacement-private-channel"],
    defaultCheckpointId: "replacement-stale-private-channel",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: [replacementPrivateFeatureSpineCycleId],
    roleUrlIds: ["replacement-private-channel"],
    checkpointIds: ["replacement-stale-private-channel"],
    recoveryHookIds: [],
    visibleAdminCheckIds: [
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
      "replacement-stale-private-post-after-resolve",
      "replacement-stale-private-post-reconnect",
      "replacement-stale-private-post-after-complete",
      "replacement-stale-private-post-after-complete-reload",
    ],
    roleUrlHrefs,
    productionFeatureTargets:
      replacementPrivateProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function replacementPrivateProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = Object.values(replacementPrivateFeatureSpineTargetRows).map(
    (row) => row.featureSlotId,
  );
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function hardeningSpineTargetsFixture({
  roleUrlHrefs = hardeningRoleUrlHrefsFixture(),
} = {}) {
  return {
    status: "passed",
    detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    defaultCycleId: "hardening-stale-conflict",
    defaultRoleUrlId: "replacement-stale-conflict-message",
    defaultRoleUrl: roleUrlHrefs["replacement-stale-conflict-message"],
    defaultCheckpointId: "replacement-stale-conflict-message",
    browserProofCommand: devTestGameLiveProofCommand,
    cycleIds: ["hardening-stale-conflict", completedGameHardeningSpineCycleId],
    roleUrlIds: Object.keys(roleUrlHrefs),
    checkpointIds: Object.keys(roleUrlHrefs),
    recoveryHookIds: [],
    visibleAdminCheckIds: [
      ...hardeningAdminProofFixture().adminRoleSurface.visibleChecks,
    ],
    roleUrlHrefs,
    productionFeatureTargets:
      hardeningProductionFeatureTargetsFixture(roleUrlHrefs),
  };
}

function hardeningRoleUrlHrefsFromProofRun(proofRun) {
  const laneById = new Map(proofRun.lanes.map((lane) => [lane.id, lane]));
  const frontendBaseUrl = String(proofRun.session.frontendBaseUrl).replace(
    /\/$/,
    "",
  );
  return {
    ...Object.fromEntries(
      staleConflictMessageSurfaceCases().map((surface) => [
        surface.laneId,
        String(laneById.get(surface.laneId)?.evidence?.roleUrl ?? ""),
      ]),
    ),
    ...Object.fromEntries(
      completedGameHardeningSpineLaneCases().map((scenario) => [
        scenario.id,
        hardeningSpineRoleUrlFromGame({
          frontendBaseUrl,
          game: laneById.get(scenario.id).evidence.game,
          role: scenario.role,
        }),
      ]),
    ),
  };
}

function hardeningRoleUrlHrefsFixture() {
  return {
    ...Object.fromEntries(
      staleConflictMessageSurfaceFixtureRows().map((surface) => [
        surface.laneId,
        surface.roleUrl,
      ]),
    ),
    ...Object.fromEntries(
      completedGameHardeningSpineLaneCases().map((scenario) => [
        scenario.id,
        hardeningSpineRoleUrlFromGame({
          frontendBaseUrl: "http://127.0.0.1:5173",
          game: `fixture-${scenario.id}`,
          role: scenario.role,
        }),
      ]),
    ),
  };
}

function hardeningSpineRoleUrlFromGame({ frontendBaseUrl, game, role }) {
  return `${frontendBaseUrl}/g/${game}${role === "host" ? "/host" : ""}`;
}

function hardeningProductionFeatureTargetsFixture(roleUrlHrefs) {
  const slotIds = [
    "completed-game-stale-recovery",
    "replacement-stale-conflict-message",
  ];
  return {
    status: "passed",
    slotIds,
    bySlotId: Object.fromEntries(
      slotIds.map((slotId) => [
        slotId,
        featureSpineCaseFixture(slotId, { roleUrlHrefs }).spineTarget,
      ]),
    ),
  };
}

function productionFeatureSpineTargetFixture(slotId = "player-action-submission") {
  return featureSpineCaseFixture(slotId).productionFeatureSpineTarget;
}

function resolvedFeatureSpineTargetFixture(slotId = "player-action-submission") {
  return featureSpineCaseFixture(slotId).spineTarget;
}

function nextActionProofGraphFixture(slotId = "player-action-submission") {
  const target = resolvedFeatureSpineTargetFixture(slotId);
  const sourceNodeId = productionFeatureGraphSourceNodeId(target.sourceCheckId);
  const nodeId = `production-feature:${slotId}`;
  return {
    version: 1,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-proof-graph",
    nodes: [
      {
        id: nodeId,
        kind: "production-feature-spine-target",
        status: "passed",
        featureSlotId: slotId,
        sourceCheckId: target.sourceCheckId,
        roleUrl: target.detailRoleUrl,
        targetRoleUrl: target.roleUrl,
        browserProofCommand: target.browserProofCommand,
        artifact: devTestGameReleaseReadinessPath,
      },
    ],
    edges: [
      {
        from: sourceNodeId,
        to: nodeId,
        relationship: "proves-production-feature",
        featureSlotId: slotId,
        targetRoleUrl: target.roleUrl,
        command: target.browserProofCommand,
      },
    ],
  };
}

function featureSpineDrilldownFixture(slotId = "player-action-submission") {
  return featureSpineCaseFixture(slotId).spineDrilldown;
}

function featureSpineCaseFixture(
  slotId = "player-action-submission",
  { roleUrlHrefs } = {},
) {
  if (slotId === "identity-adapter") {
    return featureSpineFixture({
      slotId,
      detailRoleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      roleUrl: "/admin/audit/local-identity-adapter?game=<seeded-game>",
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameIdentityAdminProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  if (slotId === "host-setup-route") {
    return featureSpineFixture({
      slotId,
      detailRoleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
      roleUrlsById:
        roleUrlHrefs ?? hostSetupSpineTargetsFixture().roleUrlHrefs,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameHostSetupProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  if (slotId === "cohost-console") {
    const cohostRoleUrl =
      roleUrlHrefs?.["cohost-console"] ??
      cohostSpineTargetsFixture().roleUrlHrefs["cohost-console"];
    return featureSpineFixture({
      slotId,
      detailRoleUrl: cohostRoleUrl,
      roleUrlsById:
        roleUrlHrefs ?? cohostSpineTargetsFixture().roleUrlHrefs,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameCohostConsoleProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  if (slotId === "replacement-player-role-surface") {
    const replacementRoleUrl =
      roleUrlHrefs?.["replacement-player"] ??
      replacementSpineTargetsFixture().roleUrlHrefs["replacement-player"];
    return featureSpineFixture({
      slotId,
      detailRoleUrl: replacementRoleUrl,
      roleUrlsById:
        roleUrlHrefs ?? replacementSpineTargetsFixture().roleUrlHrefs,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameReplacementPlayerProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  if (slotId === "replacement-action-recovery") {
    const replacementActionRoleUrl =
      roleUrlHrefs?.["replacement-action"] ??
      replacementActionSpineTargetsFixture().roleUrlHrefs[
        "replacement-action"
      ];
    return featureSpineFixture({
      slotId,
      detailRoleUrl: replacementActionRoleUrl,
      roleUrlsById:
        roleUrlHrefs ?? replacementActionSpineTargetsFixture().roleUrlHrefs,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameReplacementActionProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  if (slotId === "replacement-private-channel-recovery") {
    const replacementPrivateRoleUrl =
      roleUrlHrefs?.["replacement-private-channel"] ??
      replacementPrivateSpineTargetsFixture().roleUrlHrefs[
        "replacement-private-channel"
      ];
    return featureSpineFixture({
      slotId,
      detailRoleUrl: replacementPrivateRoleUrl,
      roleUrlsById:
        roleUrlHrefs ?? replacementPrivateSpineTargetsFixture().roleUrlHrefs,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameReplacementPrivateProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  if (
    [
      "replacement-stale-conflict-message",
      "completed-game-stale-recovery",
    ].includes(slotId)
  ) {
    return featureSpineFixture({
      slotId,
      detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
      roleUrlsById: roleUrlHrefs ?? hardeningRoleUrlHrefsFixture(),
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameHardeningAdminProofCommand,
      includeTargetRerunCommand: true,
    });
  }
  return featureSpineFixture({
    slotId,
    roleUrlsById: roleUrlHrefs ?? coreLoopSpineTargetsFixture().roleUrlHrefs,
    browserProofCommand: devTestGameLiveProofCommand,
    includeTargetRerunCommand: true,
  });
}

function hostedIdentityHandoffChecklistFixture() {
  return hostedIdentityEvidenceHandoffCase();
}

function hardeningAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hardening-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hardening-admin-surface",
    proofBoundary: "Local admin hardening proof only.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
      linkTestId: `admin-audit-link-${localAdminAuditIds.hardening}`,
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        ...replacementHandoffHardeningLaneIds.slice(0, -1),
        ...staleConflictMessageLaneIds,
        replacementHandoffHardeningLaneIds.at(-1),
        "idempotent-retry",
        "action-idempotent-retry",
        "concurrent-action-race",
        "concurrent-action-race-reload",
        "reconnect-recovery",
        "stale-player-vote",
        "stale-player-vote-after-change",
        "stale-player-withdraw-after-change",
        "stale-player-withdraw-after-phase-closure",
        "stale-player-vote-after-phase-closure",
        "stale-player-post-after-phase-closure",
        "concurrent-player-vote-resolve-race",
        "concurrent-player-vote-resolve-race-reload",
        "concurrent-player-action-advance-race",
        "concurrent-player-action-advance-race-reload",
        "concurrent-cohost-deadline-resolve-race",
        "concurrent-cohost-deadline-resolve-race-reload",
        ...replacementPrivatePostRaceLaneIds,
        "concurrent-replacement-vote-race",
        "concurrent-replacement-vote-race-reload",
        "concurrent-replacement-action-race",
        "concurrent-replacement-action-race-reload",
        "replacement-incoming-action",
        "replacement-action-reconnect",
        "replacement-stale-action-after-resolve",
        ...replacementPrivatePostRecoveryLaneIds,
        "concurrent-vote-race",
        "concurrent-vote-race-reload",
        "stale-host-publish-after-change",
        "concurrent-host-publish-race",
        "concurrent-host-publish-race-reload",
        "stale-host-publish",
        "stale-host-lifecycle",
        "stale-host-lifecycle-reload",
        "stale-host-modkill",
        "stale-host-modkill-reload",
        "stale-host-prompt",
        "stale-host-prompt-reload",
        "stale-host-complete",
        "stale-host-complete-reload",
        "stale-host-complete-reconnect-recovery",
        "concurrent-host-complete-race",
        "concurrent-host-complete-race-reload",
        "concurrent-player-complete-race",
        "public-player-complete-reload",
        "stale-player-complete",
        "stale-player-complete-reload",
        "stale-same-action-recovery",
        "stale-dead-action-conflict",
        "stale-action-conflict",
        "stale-action-conflict-message",
        "stale-action-reconnect-recovery",
        "private-channel-stale-action-reconnect-recovery",
        "stale-host-control",
        "concurrent-host-resolve-race",
        "concurrent-host-resolve-race-reload",
        "concurrent-host-advance-race",
        "concurrent-host-advance-race-reload",
        "concurrent-host-deadline-advance-race",
        "concurrent-host-deadline-advance-race-reload",
        "concurrent-host-lifecycle-race",
        "concurrent-host-lifecycle-race-reload",
        "concurrent-host-complete-race",
        "concurrent-host-complete-race-reload",
        "stale-host-prompt-reload",
        "stale-host-complete-reload",
        "stale-host-complete-reconnect-recovery",
        "concurrent-player-complete-race",
        "public-player-complete-reload",
        "stale-player-complete-reload",
        "concurrent-host-mixed-advance-race",
        "concurrent-host-mixed-advance-race-reload",
        "stale-host-resolve",
        "stale-host-resolve-reload",
        "stale-host-resolve-reconnect-recovery",
        "stale-host-advance",
        "stale-host-advance-reload",
        "stale-host-advance-reconnect-recovery",
        "stale-host-deadline",
        "stale-host-deadline-reload",
        "stale-host-deadline-reconnect-recovery",
        "stale-cohost-deadline",
        "stale-cohost-deadline-reload",
        "stale-cohost-deadline-reconnect-recovery",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    playerRecoveryRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.playerRecovery),
      linkTestId: `admin-audit-link-${localAdminAuditIds.playerRecovery}`,
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [...playerRecoveryAuditLaneIds],
      visibleRelatedLinks: [
        localAdminAuditIds.coreLoop,
        localAdminAuditIds.hardening,
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function opsAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-ops-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-ops-admin-surface",
    proofBoundary: "Local admin ops artifact proof only.",
    generatedFrom: {
      opsArtifacts: "target/dev-test-game/ops-artifacts.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-ops-artifacts?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-ops-artifacts",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "source-artifacts-checksummed",
        "role-entrypoints-redacted",
        "proof-lanes-summarized",
        "proof-stability-summarized",
        "release-boundary-carried",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedOpsSignalsAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-ops-signals-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-ops-signals-admin-surface",
    proofBoundary: "Local admin hosted ops signals proof only.",
    generatedFrom: {
      hostedOpsSignals: "target/dev-test-game/hosted-ops-signals.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-hosted-ops-signals?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-ops-signals",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [...hostedOpsSignalCheckIds],
      visibleRelatedLinks: [...hostedOpsSignalRelatedAuditIds],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function realHostedObservabilityHandoffAdminProofFixture() {
  const defaultHandoff = realHostedObservabilityHandoffCase();
  const handoff = realHostedObservabilityHandoffCase({
    inputSections: realHostedObservabilityHandoffInputSections({
      checks: [
        {
          id: "local-hosted-ops-signals-baseline-carried",
          status: "passed",
        },
        ...defaultHandoff.blockedChecks,
      ],
    }),
  });
  const sectionInputRows = realHostedObservabilitySectionInputRowsFixture(handoff);
  const summaryRows = [
    {
      id: "status",
      status: "blocked\n1/10 checks passed\n9 checks blocked",
    },
    {
      id: "inputs",
      status: "1/11 inputs provided\n10 inputs missing",
    },
    {
      id: "baseline",
      status:
        "baseline only\ntarget/dev-test-game/hosted-ops-signals.json\nLocal hosted-like signals cannot satisfy real hosted observability evidence.",
    },
  ];
  return {
    version: 1,
    proof: "dev-test-game-real-hosted-observability-handoff-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-real-hosted-observability-handoff-admin-surface",
    proofBoundary: "Local admin real hosted observability handoff proof only.",
    generatedFrom: {
      handoff: devTestGameRealHostedObservabilityHandoffPath,
      game: "00000000-0000-0000-0000-000000000001",
      checkIds: [...realHostedObservabilityHandoffCheckIds],
      blockedCheckIds: [...handoff.blockedCheckIds],
      hostedHandoffInputIds: [...realHostedObservabilityHandoffInputIds],
      hostedHandoffBlockedCheckIds: [...handoff.blockedCheckIds],
      hostedHandoffGroupIds: handoff.requirementGroups.map((group) => group.id),
      hostedHandoffInputSectionIds: handoff.inputSections.map(
        (section) => section.id,
      ),
      hostedHandoffInputSectionStatuses: Object.fromEntries(
        handoff.inputSections.map((section) => [section.id, section.status]),
      ),
      hostedHandoffSectionInputIds: sectionInputRows.map((row) => row.id),
      hostedHandoffSectionInputStatuses: Object.fromEntries(
        sectionInputRows.map((row) => [row.id, row.status]),
      ),
      realHostedObservabilitySummaryIds: summaryRows.map((row) => row.id),
      realHostedObservabilitySummaryStatuses: Object.fromEntries(
        summaryRows.map((row) => [row.id, row.status]),
      ),
      handoffPath: {
        upstreamAuditId: "local-next-action",
        upstreamLabel: "Ranked next action",
        localCapabilityAuditId: "local-hosted-ops-signals",
        downstreamStatus: "blocked",
        downstreamCommand:
          "npm run test:dev-test-game-real-hosted-observability-handoff",
        downstreamProofTarget:
          "target/dev-test-game/real-hosted-observability-handoff.json",
      },
      relatedAuditIds: ["local-hosted-ops-signals", "local-next-action"],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/local-real-hosted-observability-handoff?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-real-hosted-observability-handoff",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [...realHostedObservabilityHandoffCheckIds],
      visibleUnproven: [...handoff.blockedCheckIds],
      visibleHostedHandoffInputs: [...realHostedObservabilityHandoffInputIds],
      visibleHostedHandoffBlockedChecks: [...handoff.blockedCheckIds],
      visibleHostedHandoffGroups: handoff.requirementGroups.map(
        (group) => group.id,
      ),
      visibleHostedHandoffInputSections: handoff.inputSections.map(
        (section) => section.id,
      ),
      visibleHostedHandoffInputSectionStatuses: Object.fromEntries(
        handoff.inputSections.map((section) => [
          section.id,
          `${section.label} ${section.status}`,
        ]),
      ),
      visibleHostedHandoffSectionInputs: sectionInputRows.map((row) => row.id),
      visibleHostedHandoffSectionInputStatuses: Object.fromEntries(
        sectionInputRows.map((row) => [row.id, `${row.id} ${row.status}`]),
      ),
      visibleRealHostedObservabilitySummaries: summaryRows.map((row) => row.id),
      visibleRealHostedObservabilitySummaryStatuses: Object.fromEntries(
        summaryRows.map((row) => [row.id, row.status]),
      ),
      visibleHandoffPath: {
        upstreamAuditId: "local-next-action",
        upstreamLabel: "Ranked next action",
        localCapabilityAuditId: "local-hosted-ops-signals",
        downstreamStatus: "blocked",
        downstreamCommand:
          "npm run test:dev-test-game-real-hosted-observability-handoff",
        downstreamProofTarget:
          "target/dev-test-game/real-hosted-observability-handoff.json",
      },
      visibleRelatedLinks: ["local-hosted-ops-signals", "local-next-action"],
      visibleRelatedDestinations: [
        {
          linkId: "local-next-action",
          auditId: "local-next-action",
          detailRoleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          visibleChecks: ["next-command"],
        },
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function realHostedObservabilitySectionInputRowsFixture(handoff) {
  return handoff.inputSections.flatMap((section) =>
    section.requiredInputIds.map((inputId) => ({
      id: `${section.id}-${inputId}`,
      status: section.providedInputIds.includes(inputId) ? "provided" : "missing",
    })),
  );
}

function seedAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-seed-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-seed-admin-surface",
    proofBoundary: "Local admin seed fixture proof only.",
    generatedFrom: {
      seedFixtureSummary: "target/dev-test-game/seed-fixture-summary.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-seed-fixtures?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-seed-fixtures",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleScenarios: [...seedScenarioCoverageGroups.allDemo],
      visibleProofLaneCoverage: [
        "direct-seeded",
        "alias-only",
        "aggregate-only",
        "unclassified",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function backupAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-backup-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-backup-admin-surface",
    proofBoundary: "Local admin backup/restore proof only.",
    generatedFrom: {
      backupRestoreProof:
        "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
      backupRestoreDump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-backup-restore?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-backup-restore",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "dump-created",
        "event-log-restored",
        "projection-fingerprints-restored",
        "auth-sessions-restored",
        "restored-api-capabilities",
      ],
      visibleSessions: ["host", "player", "admin"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function releaseAdminProofFixture() {
  const evidenceObjectRowIds = [
    ...expectedNormalizedEvidenceObjectRowIds({
      parentId: "local-private-channel-recovery-milestone",
      objects: privateChannelNormalizedEvidenceObjects,
    }),
    ...expectedNormalizedEvidenceObjectRowIds({
      parentId: "local-replacement-private-recovery-milestone",
      objects: replacementPrivatePostNormalizedEvidenceObjects,
    }),
  ];
  return {
    version: 1,
    proof: "dev-test-game-release-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-admin-surface",
    proofBoundary: "Local admin release-readiness proof only.",
    generatedFrom: {
      releaseReadinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
      game: "00000000-0000-0000-0000-000000000001",
      localCheckIds: [
        "local-role-url-browser-proof",
        "local-core-loop-proof",
        "local-hardening-proof",
      ],
      evidenceObjectRowIds,
      localPrerequisiteIds: releaseAdminProofLocalPrerequisiteIds(),
      unprovenIds: [...releaseAdminProofFallbackUnprovenIds],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-release-readiness?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-release-readiness",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "local-role-url-browser-proof",
        "local-core-loop-proof",
        "local-hardening-proof",
        ...evidenceObjectRowIds,
      ],
      visibleLocalPrerequisites: releaseAdminProofLocalPrerequisiteIds(),
      visibleLocalPrerequisiteRoleUrls: Object.fromEntries(
        releaseAdminProofLocalPrerequisiteIds().map((id) => [
          id,
          releaseAdminProofLocalPrerequisiteRoleUrl(id),
        ]),
      ),
      visitedLocalPrerequisiteDestinations:
        releaseAdminProofLocalPrerequisiteIds().map((id) => ({
          id,
          auditId: releaseAdminProofLocalPrerequisiteAuditId(id),
          detailRoleUrl: releaseAdminProofLocalPrerequisiteRoleUrl(id),
          clickedThrough: true,
        })),
      visibleUnproven: [...releaseAdminProofFallbackUnprovenIds],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function releaseAdminProofLocalPrerequisiteIds() {
  return [
    "local-proof-graph-admin-role-handoffs",
    "local-proof-freshness-admin-surface",
    "local-next-action-admin-surface",
    "local-hosted-evidence-lane-demo-proof",
  ];
}

function releaseAdminProofLocalPrerequisiteAuditId(id) {
  return {
    "local-proof-graph-admin-role-handoffs": "local-proof-graph",
    "local-proof-freshness-admin-surface": "local-proof-freshness",
    "local-next-action-admin-surface": "local-next-action",
    "local-hosted-evidence-lane-demo-proof": "local-hosted-evidence-lane",
  }[id];
}

function releaseAdminProofLocalPrerequisiteRoleUrl(id) {
  return `/admin/audit/${releaseAdminProofLocalPrerequisiteAuditId(id)}?game=<seeded-game>`;
}

function releaseRunbookAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-release-runbook-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-runbook-admin-surface",
    proofBoundary: "Local admin release-runbook proof only.",
    generatedFrom: {
      releaseRunbook: "target/dev-test-game/release-runbook.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      checkIds: [
        "remaining-readiness-gaps-mapped",
        "rollback-path-carried",
        "support-path-carried",
        "release-claim-boundary-carried",
        "human-approval-boundary-carried",
      ],
      runbookItemIds: ["hosted-deployment", "human-release-approval"],
      relatedAuditIds: ["local-release-readiness"],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-release-runbook",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "remaining-readiness-gaps-mapped",
        "rollback-path-carried",
        "support-path-carried",
        "release-claim-boundary-carried",
        "human-approval-boundary-carried",
      ],
      visibleUnproven: ["hosted-deployment", "human-release-approval"],
      visibleRelatedLinks: ["local-release-readiness"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function proofGraphAdminProofFixture() {
  const handoffs = adminProofDestinationRequirementLinkRows.map(
    ([linkId, auditId]) => ({
      linkId,
      auditId,
      requiredCheckIds: [],
      requiredCheckStatuses: {},
      requiredScenarioIds: [],
      requiredSessionIds: [],
      requiredUnprovenIds: [],
      requiredRelatedLinkIds: [],
      ...(linkId === "admin-proof:hosted-evidence-lane"
        ? {
            requiredHostedHandoffInputIds: hostedHandoffInputIdsFixture(),
            requiredHostedHandoffBlockedCheckIds:
              hostedHandoffBlockedCheckIdsFixture(),
          }
        : {}),
    }),
  );
  const adminProofSurfaceIds = handoffs.map((handoff) =>
    handoff.linkId.replace("admin-proof:", ""),
  );
  const hostSetupGraphTarget = proofGraphHostSetupFeatureTargetFixture();
  const cohostGraphTarget = proofGraphCohostFeatureTargetFixture();
  const replacementGraphTarget = proofGraphReplacementFeatureTargetFixture();
  const replacementActionGraphTarget =
    proofGraphReplacementActionFeatureTargetFixture();
  const replacementPrivateGraphTarget =
    proofGraphReplacementPrivateFeatureTargetFixture();
  const evidenceObjectRowIds = [
    ...expectedNormalizedEvidenceObjectRowIds({
      parentId: "private-channel-recovery-receipt",
      objects: privateChannelNormalizedEvidenceObjects,
    }),
    ...expectedNormalizedEvidenceObjectRowIds({
      parentId: "replacement-private-recovery-receipt",
      objects: replacementPrivatePostNormalizedEvidenceObjects,
    }),
  ];
  return {
    version: 1,
    proof: "dev-test-game-proof-graph-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-proof-graph-admin-surface",
    proofBoundary: "Local admin proof graph handoff proof only.",
    generatedFrom: {
      proofGraph: "target/dev-test-game/proof-graph.json",
      proofRun: "target/dev-test-game/proof-run.json",
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      game: "00000000-0000-0000-0000-000000000001",
      nodeIds: [
        ...handoffs.map((handoff) => handoff.linkId),
        hostSetupGraphTarget.roleSurfaceNodeId,
        hostSetupGraphTarget.productionFeatureNodeId,
        cohostGraphTarget.roleSurfaceNodeId,
        cohostGraphTarget.productionFeatureNodeId,
        replacementGraphTarget.roleSurfaceNodeId,
        replacementGraphTarget.productionFeatureNodeId,
        replacementActionGraphTarget.roleSurfaceNodeId,
        replacementActionGraphTarget.productionFeatureNodeId,
        replacementPrivateGraphTarget.roleSurfaceNodeId,
        replacementPrivateGraphTarget.productionFeatureNodeId,
      ],
      evidenceObjectRowIds,
      edgeRowIds: [
        hostSetupGraphTarget.edgeRowId,
        cohostGraphTarget.edgeRowId,
        replacementGraphTarget.edgeRowId,
        replacementActionGraphTarget.edgeRowId,
        replacementPrivateGraphTarget.edgeRowId,
      ],
      edgeCount: handoffs.length + 5,
      adminProofSurfaceIds,
      adminProofRoleHandoffs: handoffs,
      hostSetupFeatureTarget: hostSetupGraphTarget,
      cohostFeatureTarget: cohostGraphTarget,
      replacementFeatureTarget: replacementGraphTarget,
      replacementActionFeatureTarget: replacementActionGraphTarget,
      replacementPrivateFeatureTarget: replacementPrivateGraphTarget,
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-proof-graph",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        ...handoffs.map((handoff) => handoff.linkId),
        hostSetupGraphTarget.roleSurfaceNodeId,
        hostSetupGraphTarget.productionFeatureNodeId,
        hostSetupGraphTarget.edgeRowId,
        `coverage-decision:${hostSetupGraphTarget.productionFeatureNodeId}`,
        cohostGraphTarget.roleSurfaceNodeId,
        cohostGraphTarget.productionFeatureNodeId,
        cohostGraphTarget.edgeRowId,
        `coverage-decision:${cohostGraphTarget.productionFeatureNodeId}`,
        replacementGraphTarget.roleSurfaceNodeId,
        replacementGraphTarget.productionFeatureNodeId,
        replacementGraphTarget.edgeRowId,
        `coverage-decision:${replacementGraphTarget.productionFeatureNodeId}`,
        replacementActionGraphTarget.roleSurfaceNodeId,
        replacementActionGraphTarget.productionFeatureNodeId,
        replacementActionGraphTarget.edgeRowId,
        `coverage-decision:${replacementActionGraphTarget.productionFeatureNodeId}`,
        replacementPrivateGraphTarget.roleSurfaceNodeId,
        replacementPrivateGraphTarget.productionFeatureNodeId,
        replacementPrivateGraphTarget.edgeRowId,
        `coverage-decision:${replacementPrivateGraphTarget.productionFeatureNodeId}`,
        ...evidenceObjectRowIds,
      ],
      visibleRelatedLinks: [
        ...handoffs.map((handoff) => handoff.linkId),
        hostSetupGraphTarget.roleSurfaceNodeId,
        hostSetupGraphTarget.productionFeatureNodeId,
        cohostGraphTarget.roleSurfaceNodeId,
        cohostGraphTarget.productionFeatureNodeId,
        replacementGraphTarget.roleSurfaceNodeId,
        replacementGraphTarget.productionFeatureNodeId,
        replacementActionGraphTarget.roleSurfaceNodeId,
        replacementActionGraphTarget.productionFeatureNodeId,
        replacementPrivateGraphTarget.roleSurfaceNodeId,
        replacementPrivateGraphTarget.productionFeatureNodeId,
      ],
      visibleRelatedDestinations: handoffs.map((handoff) => ({
        linkId: handoff.linkId,
        auditId: handoff.auditId,
        detailRoleUrl: `/admin/audit/${handoff.auditId}?game=<seeded-game>`,
        ...(handoff.linkId === "admin-proof:hosted-evidence-lane"
          ? {
              visibleHostedHandoffInputs: hostedHandoffInputIdsFixture(),
              visibleHostedHandoffBlockedChecks:
                hostedHandoffBlockedCheckIdsFixture(),
            }
          : {}),
      })),
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function proofGraphHostSetupFeatureTargetFixture() {
  return {
    roleSurfaceNodeId: "role-surface:host-setup",
    productionFeatureNodeId: "production-feature:host-setup-route",
    edgeRowId:
      "edge:role-surface:host-setup:proves-production-feature:production-feature:host-setup-route",
    sourceCheckId: "local-host-setup-proof",
    featureSlotId: "host-setup-route",
    roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
    targetRoleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
    checkpointId: "start-phase",
    adminCheckId: "start-phase",
    browserProofCommand: devTestGameLiveProofCommand,
    recoveryCommand: devTestGameHostSetupProofCommand,
    coverageDecision:
      featureSpineCaseFixture("host-setup-route").spineTarget.coverageDecision,
  };
}

function proofGraphCohostFeatureTargetFixture() {
  return {
    roleSurfaceNodeId: "role-surface:cohost-console",
    productionFeatureNodeId: "production-feature:cohost-console",
    edgeRowId:
      "edge:role-surface:cohost-console:proves-production-feature:production-feature:cohost-console",
    sourceCheckId: "local-cohost-console-proof",
    featureSlotId: "cohost-console",
    roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/host",
    targetRoleUrl: "http://127.0.0.1:5173/g/<seeded-game>/host",
    checkpointId: "extend-deadline-ack",
    adminCheckId: "cohost-console",
    browserProofCommand: devTestGameLiveProofCommand,
    recoveryCommand: devTestGameCohostConsoleProofCommand,
    coverageDecision:
      featureSpineCaseFixture("cohost-console").spineTarget.coverageDecision,
  };
}

function proofGraphReplacementFeatureTargetFixture() {
  return {
    roleSurfaceNodeId: "role-surface:replacement-player",
    productionFeatureNodeId:
      "production-feature:replacement-player-role-surface",
    edgeRowId:
      "edge:role-surface:replacement-player:proves-production-feature:production-feature:replacement-player-role-surface",
    sourceCheckId: "local-replacement-player-proof",
    featureSlotId: "replacement-player-role-surface",
    roleUrl: "http://127.0.0.1:5173/g/<seeded-game>",
    targetRoleUrl: "http://127.0.0.1:5173/g/<seeded-game>",
    checkpointId: "incoming-player-slot-authority",
    adminCheckId: "replacement-incoming-player",
    browserProofCommand: devTestGameLiveProofCommand,
    recoveryCommand: devTestGameReplacementPlayerProofCommand,
    coverageDecision:
      featureSpineCaseFixture("replacement-player-role-surface").spineTarget
        .coverageDecision,
  };
}

function proofGraphReplacementActionFeatureTargetFixture() {
  return {
    roleSurfaceNodeId: "role-surface:replacement-action",
    productionFeatureNodeId: "production-feature:replacement-action-recovery",
    edgeRowId:
      "edge:role-surface:replacement-action:proves-production-feature:production-feature:replacement-action-recovery",
    sourceCheckId: "local-replacement-action-proof",
    featureSlotId: "replacement-action-recovery",
    roleUrl: "http://127.0.0.1:5173/g/<replacement-action-game>",
    targetRoleUrl: "http://127.0.0.1:5173/g/<replacement-action-game>",
    checkpointId: "replacement-incoming-action",
    adminCheckId: "replacement-incoming-action",
    browserProofCommand: devTestGameLiveProofCommand,
    recoveryCommand: devTestGameReplacementActionProofCommand,
    coverageDecision:
      featureSpineCaseFixture("replacement-action-recovery").spineTarget
        .coverageDecision,
  };
}

function proofGraphReplacementPrivateFeatureTargetFixture() {
  return {
    roleSurfaceNodeId: "role-surface:replacement-private-channel",
    productionFeatureNodeId:
      "production-feature:replacement-private-channel-recovery",
    edgeRowId:
      "edge:role-surface:replacement-private-channel:proves-production-feature:production-feature:replacement-private-channel-recovery",
    sourceCheckId: "local-replacement-private-proof",
    featureSlotId: "replacement-private-channel-recovery",
    roleUrl:
      "http://127.0.0.1:5173/g/<replacement-private-game>/c/private%3Amafia_day_chat",
    targetRoleUrl:
      "http://127.0.0.1:5173/g/<replacement-private-game>/c/private%3Amafia_day_chat",
    checkpointId: "replacement-stale-private-channel",
    adminCheckId: "replacement-stale-private-channel",
    browserProofCommand: devTestGameLiveProofCommand,
    recoveryCommand: devTestGameReplacementPrivateProofCommand,
    coverageDecision:
      featureSpineCaseFixture("replacement-private-channel-recovery").spineTarget
        .coverageDecision,
  };
}

function hostedHandoffInputIdsFixture() {
  return [...hostedEvidenceBlockedHandoffChecklistFixture().inputIds];
}

function hostedHandoffBlockedCheckIdsFixture() {
  return [
    ...hostedEvidenceBlockedHandoffChecklistFixture().blockedCheckIds,
  ];
}

function proofFreshnessAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-proof-freshness-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-proof-freshness-admin-surface",
    proofBoundary: "Local proof-freshness admin proof only.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      nextAction: "target/dev-test-game/next-action.json",
      game: "00000000-0000-0000-0000-000000000001",
      artifactIds: ["proof-run", "release-readiness", "next-action"],
      maxAgeHours: 24,
      nextActionCommand:
        "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      nextActionStatus: "ready",
      nextActionReason: "release-readiness-unproven",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-proof-freshness",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "proof-run",
        "release-readiness",
        "next-action",
        "next-action-handoff",
      ],
      visibleRelatedLinks: ["local-next-action"],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function nextActionAdminProofFixture() {
  const hostedHandoffChecklist = hostedEvidenceBlockedHandoffChecklistFixture({
    command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
    proofTarget: "target/dev-test-game/hosted-concurrent-race-matrix.json",
  });
  const handoffSectionInputRows = hostedEvidenceHandoffSectionInputRows(
    hostedHandoffChecklist.inputSections,
  );
  const invalidActionRecoveryUnproven =
    invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenFixture({
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      spineRoleUrl:
        coreLoopSpineTargetsFixture().roleUrlHrefs["d02-n02-actionPlayer"],
      browserProofCommand: devTestGameLiveProofCommand,
      includeTargetRerunCommand: true,
    });
  return {
    version: 1,
    proof: "dev-test-game-next-action-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-next-action-admin-surface",
    proofBoundary: "Local next-action admin proof only.",
    generatedFrom: {
      nextAction: "target/dev-test-game/next-action.json",
      proofRun: "target/dev-test-game/proof-run.json",
      proofGraph: "target/dev-test-game/proof-graph.json",
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      game: "00000000-0000-0000-0000-000000000001",
      command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      reason: "release-readiness-unproven",
      actionStatus: "ready",
      localCheckId: null,
      localCheckRoleUrl: null,
      unprovenId: "hosted-concurrent-race-matrix",
      unprovenRoleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      unprovenProofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      unprovenProductionFeatureSpineTarget:
        invalidActionRecoveryUnproven.productionFeatureSpineTarget,
      unprovenSpineDrilldown: invalidActionRecoveryUnproven.spineDrilldown,
      unprovenSpineTarget: invalidActionRecoveryUnproven.spineTarget,
      unprovenHostedHandoffChecklist: hostedHandoffChecklist,
      selectedProofGraphNode: {
        id: "admin-proof:hosted-concurrent-race-matrix",
        status: "ready",
        auditId: "local-hosted-concurrent-race-matrix",
        roleUrl:
          "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
        proofCommand:
          "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
      },
      relatedHandoffs: [
        {
          linkId: "selected-proof-graph-node",
          auditId: "local-proof-graph",
          requiredCheckIds: ["admin-proof:hosted-concurrent-race-matrix"],
          requiredRelatedLinkIds: ["admin-proof:hosted-concurrent-race-matrix"],
        },
        {
          linkId: "admin-proof:hosted-concurrent-race-matrix",
          auditId: "local-hosted-concurrent-race-matrix",
          requiredCheckIds: [hostedMatrixAdminRequiredCheckIds[0]],
          requiredCheckStatuses: {
            [hostedMatrixAdminRequiredCheckIds.at(-1)]: "unproven",
          },
          requiredUnprovenIds: [hostedMatrixRequestedEvidenceIds[0]],
          requiredReconnectLaneIds: [],
          requiredStaleConflictLaneIds: [],
          requiredRelatedLinkIds: hostedMatrixRelatedAuditIds,
        },
      ],
      selectionTrace: {
        strategy: "development-spine-priority",
        candidateCount: 0,
        selectedArtifactId: null,
        candidateIds: [],
      },
      releaseReadinessTrace: {
        strategy: "local-dev-release-readiness-priority",
        candidateCount: 1,
        selectedUnprovenId: "hosted-concurrent-race-matrix",
        candidateIds: ["hosted-concurrent-race-matrix"],
      },
      localReadinessDependencyTrace: {
        strategy: "local-readiness-dependency-before-hosted-work",
        candidateCount: 0,
        selectedCheckId: null,
        candidateIds: [],
      },
      seedProofLaneCoverageTrace: {
        strategy: "seed-proof-lane-coverage-before-readiness",
        status: "clean",
        selected: false,
        unclassifiedLaneCount: 0,
        unclassifiedLaneIds: [],
      },
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-next-action",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "next-command",
        "release-readiness-unproven",
        "selection-trace",
        "hosted-concurrent-race-matrix",
        "selected-proof-graph-node",
        "selected-proof-graph-destination",
        "selected-feature-spine-declaration",
        "selected-spine-target",
        "selected-spine-drilldown",
        "selected-spine-admin-check",
        "selected-spine-rerun-command",
        "selected-spine-browser-proof",
        "selected-spine-coverage-decision",
        "seed-proof-lane-coverage-trace",
        "release-readiness-selection-trace",
      ],
      visibleRelatedLinks: [
        "selected-proof-graph-node",
        "admin-proof:hosted-concurrent-race-matrix",
      ],
      visibleHostedHandoffInputs: hostedHandoffChecklist.inputIds,
      visibleHostedHandoffBlockedChecks: hostedHandoffChecklist.blockedCheckIds,
      visibleHostedHandoffInputSections: hostedHandoffChecklist.inputSections.map(
        (section) => section.id,
      ),
      visibleHostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(
          hostedHandoffChecklist.inputSections,
        ),
      visibleHostedHandoffSectionInputs: handoffSectionInputRows.map(
        (row) => row.id,
      ),
      visibleHostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(
          hostedHandoffChecklist.inputSections,
        ),
      visibleHostedHandoffSummary: {
        status: hostedHandoffChecklist.status,
        preflightStatus: hostedHandoffChecklist.preflightStatus,
        command: hostedHandoffChecklist.command,
        proofTarget: hostedHandoffChecklist.proofTarget,
      },
      ...(hostedHandoffChecklist.blockedReceipt === undefined
        ? {}
        : {
            visibleHostedHandoffBlockedReceipt: {
              status: hostedHandoffChecklist.blockedReceipt.status,
              operatorAction: hostedHandoffChecklist.blockedReceipt.operatorAction,
              localVsHostedBoundary:
                hostedHandoffChecklist.blockedReceipt.localVsHostedBoundary,
              nextProofTarget:
                hostedHandoffChecklist.blockedReceipt.nextProofTarget,
              missingRequiredInputs:
                hostedHandoffChecklist.blockedReceipt.missingRequiredInputs,
            },
          }),
      visibleRelatedDestinations: [
        {
          linkId: "selected-proof-graph-node",
          auditId: "local-proof-graph",
          detailRoleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
          visibleChecks: ["admin-proof:hosted-concurrent-race-matrix"],
          visibleRelatedLinks: ["admin-proof:hosted-concurrent-race-matrix"],
        },
        {
          linkId: "admin-proof:hosted-concurrent-race-matrix",
          auditId: "local-hosted-concurrent-race-matrix",
          detailRoleUrl:
            "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
          visibleChecks: [hostedMatrixAdminRequiredCheckIds[0]],
          visibleUnproven: [hostedMatrixRequestedEvidenceIds[0]],
          visibleRelatedLinks: hostedMatrixRelatedAuditIds,
        },
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function raceCoverageAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-race-coverage-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-race-coverage-admin-surface",
    proofBoundary: "Local admin race coverage proof only.",
    generatedFrom: {
      raceCoverage: "target/dev-test-game/race-coverage.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      cellIds: [
        "player-vote-change",
        "player-night-action",
        "player-vote-vs-host-resolve",
        "player-action-vs-host-advance",
        "cohost-deadline-vs-host-resolve",
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
        "host-resolve",
        "host-advance",
        "host-deadline-advance",
        "host-lifecycle",
        "host-mixed-advance",
        ...completedGameRaceCoverageCellIds(),
      ],
      cellCount: 16,
      reloadCoveredCellCount: 15,
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-race-coverage?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-race-coverage",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "player-vote-change",
        "player-night-action",
        "player-vote-vs-host-resolve",
        "player-action-vs-host-advance",
        "cohost-deadline-vs-host-resolve",
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
        "host-resolve",
        "host-advance",
        "host-deadline-advance",
        "host-lifecycle",
        "host-mixed-advance",
        ...completedGameRaceCoverageCellIds(),
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedConcurrentRaceMatrixAdminProofFixture() {
  const hostedHandoffChecklist = hostedMatrixRealHostedHandoffChecklist();
  const summaryRows = [
    {
      id: "coverage",
      status:
        `passed\n3/3 cells passed\n3/3 reloads covered\n${hostedMatrixReconnectLaneIds.length} reconnect lanes\n${hostedMatrixStaleConflictLaneIds.length} stale conflict lanes`,
    },
    {
      id: "hosted-evidence",
      status: "unproven\nunproven\nnot_configured",
    },
    {
      id: "missing-inputs",
      status:
        "3 missing hosted inputs\nFMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH\nLocal hosted-like matrix evidence cannot satisfy real hosted race evidence.",
    },
  ];
  return {
    version: 1,
    proof: "dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-concurrent-race-matrix-admin-surface",
    proofBoundary: "Local admin hosted matrix proof only.",
    generatedFrom: {
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      cellIds: [
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
      ],
      reconnectLaneIds: hostedMatrixReconnectLaneIds,
      staleConflictLaneIds: hostedMatrixStaleConflictLaneIds,
      staleConflictMilestones: hostedMatrixStaleConflictMilestoneCases().map(
        (scenario) => ({
          id: scenario.id,
          laneId: scenario.laneId,
          progressCheckId: scenario.progressCheckId,
        }),
      ),
      progressCheckIds: hostedMatrixProgressCheckIds,
      relatedAuditIds: hostedMatrixRelatedAuditIds,
      requestedEvidenceId: "hosted-concurrent-race-matrix",
      hostedEvidenceStatus: "not_configured",
      hostedEvidenceMode: "not_configured",
      localDemoHostedEvidenceStatus: "not_applicable",
      realHostedEvidenceStatus: "unproven",
      hostedMatrixSummaryIds: summaryRows.map((row) => row.id),
      hostedMatrixSummaryStatuses: Object.fromEntries(
        summaryRows.map((row) => [row.id, row.status]),
      ),
      realHostedEvidenceInputIds: hostedHandoffChecklist.inputIds,
      hostedHandoffInputIds: hostedHandoffChecklist.inputIds,
      hostedHandoffBlockedCheckIds: hostedHandoffChecklist.blockedCheckIds,
      hostedHandoffSummary: {
        status: hostedHandoffChecklist.status,
        preflightStatus: hostedHandoffChecklist.preflightStatus,
        command: hostedHandoffChecklist.command,
        proofTarget: hostedHandoffChecklist.proofTarget,
      },
      hostedHandoffBlockedReceipt: hostedHandoffChecklist.blockedReceipt,
      handoffPath: {
        upstreamAuditId: "local-next-action",
        upstreamLabel: "Ranked next action",
        localCapabilityAuditId: "local-race-coverage",
        downstreamStatus: "unproven",
        downstreamCommand: hostedMatrixRealHostedEvidenceCommand,
        downstreamProofTarget: hostedMatrixExternalEvidenceProofTarget,
      },
      realHostedDeploymentStatus: "unproven",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-concurrent-race-matrix",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        ...hostedMatrixProgressCheckIds,
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
      ],
      visibleReconnectLanes: hostedMatrixReconnectLaneIds,
      visibleStaleConflictLanes: hostedMatrixStaleConflictLaneIds,
      visibleHostedMatrixSummaries: summaryRows.map((row) => row.id),
      visibleHostedMatrixSummaryStatuses: Object.fromEntries(
        summaryRows.map((row) => [row.id, row.status]),
      ),
      visibleUnproven: [
        "hosted-concurrent-race-matrix",
        "remaining-gap-1",
        "remaining-gap-2",
      ],
      visibleRelatedLinks: hostedMatrixRelatedAuditIds,
      visibleRealHostedEvidenceInputs: hostedHandoffChecklist.inputIds,
      visibleHostedHandoffInputs: hostedHandoffChecklist.inputIds,
      visibleHostedHandoffBlockedChecks:
        hostedHandoffChecklist.blockedCheckIds,
      visibleHostedHandoffSummary: {
        status: hostedHandoffChecklist.status,
        preflightStatus: hostedHandoffChecklist.preflightStatus,
        command: hostedHandoffChecklist.command,
        proofTarget: hostedHandoffChecklist.proofTarget,
      },
      visibleHostedHandoffBlockedReceipt: {
        status: hostedHandoffChecklist.blockedReceipt.status,
        operatorAction: hostedHandoffChecklist.blockedReceipt.operatorAction,
        localVsHostedBoundary:
          hostedHandoffChecklist.blockedReceipt.localVsHostedBoundary,
        nextProofTarget: hostedHandoffChecklist.blockedReceipt.nextProofTarget,
        missingRequiredInputs:
          hostedHandoffChecklist.blockedReceipt.missingRequiredInputs,
      },
      visibleHandoffPath: {
        upstreamAuditId: "local-next-action",
        upstreamLabel: "Ranked next action",
        localCapabilityAuditId: "local-race-coverage",
        downstreamStatus: "unproven",
        downstreamCommand: hostedMatrixRealHostedEvidenceCommand,
        downstreamProofTarget: hostedMatrixExternalEvidenceProofTarget,
      },
      visibleRelatedDestinations: [
        {
          linkId: "local-next-action",
          auditId: "local-next-action",
          detailRoleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          visibleChecks: ["next-command"],
        },
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function spineManifestFixture() {
  return {
    version: 1,
    proof: "dev-test-game-spine-manifest",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-spine-manifest",
    proofBoundary: "Generated local dev-test-game orchestration manifest.",
    commands: {
      coreLive: {
        script: "test:dev-test-game-core-live",
        plan: [{ script: "dev:test-game:prebuild" }],
      },
      live: {
        script: "test:dev-test-game-live",
        plan: [{ script: "dev:test-game:prebuild" }],
      },
      backupRestore: { plan: [{ script: "tools/live_stack_backup_restore_drill.mjs" }] },
      identity: { plan: [{ script: "tools/auth_invite_role_proof.mjs" }] },
      adminSpine: {
        script: "test:dev-test-game-admin-spine",
        proofArtifact: "target/dev-test-game/admin-spine-proof.json",
        plan: [{ script: "tools/dev_test_game_spine_manifest_admin_proof.mjs" }],
      },
      proofFreshness: {
        script: "test:dev-test-game-proof-freshness-admin-proof",
        proofArtifact: "target/dev-test-game/proof-freshness-admin-proof.json",
      },
      nextAction: {
        script: "test:dev-test-game-next-action",
        proofArtifact: "target/dev-test-game/next-action.json",
      },
    },
    terminalArtifacts: [
      {
        id: "next-action",
        command: "test:dev-test-game-next-action",
        path: "target/dev-test-game/next-action.json",
      },
      {
        id: "next-action-admin-proof",
        command: "test:dev-test-game-next-action-admin-proof",
        path: "target/dev-test-game/next-action-admin-proof.json",
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
        dependsOn: [
          "target/dev-test-game/next-action.json",
          "target/dev-test-game/proof-run.json",
        ],
      },
    ],
    artifactFreshness: {
      status: "blocked",
      proof: "dev-test-game-proof-freshness",
      proofCommand: "test:dev-test-game-proof-freshness-admin-proof",
      proofArtifact: "target/dev-test-game/proof-freshness-admin-proof.json",
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      nextCommand:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
      proofBoundary: "Local proof freshness dashboard.",
      artifacts: [
        {
          id: "proof-run",
          label: "Dev test-game proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
          refreshCommand:
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
          nextCommand:
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live",
          refreshSource: "manifest-default",
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          refreshCommand: "npm run test:dev-test-game-spine-manifest",
          refreshSource: "manifest-default",
        },
      ],
    },
    artifacts: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/spine-manifest.md",
      devTestGameSpineManifestAdminProofPath,
      "target/dev-test-game/proof-freshness-admin-proof.json",
      "target/dev-test-game/next-action.json",
      "target/dev-test-game/next-action-admin-proof.json",
    ],
    checks: [
      { id: "core-live-order-recorded", status: "passed" },
      { id: "live-spine-order-recorded", status: "passed" },
      { id: "sub-spine-orders-recorded", status: "passed" },
      { id: "evidence-env-wiring-recorded", status: "passed" },
      { id: "freshness-proof-recorded", status: "passed" },
      { id: "artifact-refresh-status-recorded", status: "passed" },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function spineManifestAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-spine-manifest-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-spine-manifest-admin-surface",
    proofBoundary: "Local admin spine manifest proof only.",
    generatedFrom: {
      spineManifest: "target/dev-test-game/spine-manifest.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-spine-manifest?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-spine-manifest",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "core-live-order-recorded",
        "live-spine-order-recorded",
        "sub-spine-orders-recorded",
        "evidence-env-wiring-recorded",
        "freshness-proof-recorded",
        "artifact-refresh-status-recorded",
        "release-boundary-carried",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedTargetPreflightAdminProofFixture() {
  const handoff = hostedEvidenceBlockedHandoffChecklistFixture();
  const blockedCheckRequiredEvidence = Object.fromEntries(
    handoff.blockedChecks.map((check) => [
      check.id,
      check.requiredEvidence,
    ]),
  );
  const sectionInputRows = hostedEvidenceHandoffSectionInputRows(
    handoff.inputSections,
  );
  return {
    version: 1,
    proof: "dev-test-game-hosted-target-preflight-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-target-preflight-admin-surface",
    proofBoundary: "Local admin hosted target preflight proof only.",
    generatedFrom: {
      hostedTargetPreflight: "target/dev-test-game/hosted-target-preflight.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      checkIds: [...hostedTargetPreflightCheckIds],
      blockedCheckIds: [...hostedTargetPreflightBlockingCheckIds],
      blockedCheckRequiredEvidence,
      hostedHandoffInputIds: handoff.inputIds,
      hostedHandoffBlockedCheckIds: handoff.blockedCheckIds,
      hostedHandoffBlockedCheckRequiredEvidence: blockedCheckRequiredEvidence,
      hostedHandoffSummary: {
        status: handoff.status,
        preflightStatus: handoff.preflightStatus,
        command: handoff.command,
        proofTarget: handoff.proofTarget,
      },
      hostedHandoffInputSectionIds: handoff.inputSections.map(
        (section) => section.id,
      ),
      hostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(handoff.inputSections),
      hostedHandoffSectionInputIds: sectionInputRows.map((row) => row.id),
      hostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(handoff.inputSections),
      ...(handoff.blockedReceipt === undefined
        ? {}
        : { hostedHandoffBlockedReceipt: handoff.blockedReceipt }),
      relatedAuditIds: [
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-target-preflight",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [...hostedTargetPreflightCheckIds],
      visibleUnproven: [...hostedTargetPreflightBlockingCheckIds],
      visibleUnprovenStatuses: Object.fromEntries(
        Object.entries(blockedCheckRequiredEvidence).map(([checkId, evidence]) => [
          checkId,
          `${checkId}\nblocked\n${evidence}`,
        ]),
      ),
      visibleHostedHandoffInputs: handoff.inputIds,
      visibleHostedHandoffBlockedChecks: handoff.blockedCheckIds,
      visibleHostedHandoffBlockedCheckStatuses: Object.fromEntries(
        Object.entries(blockedCheckRequiredEvidence).map(([checkId, evidence]) => [
          checkId,
          `${checkId}\nblocked\n${evidence}`,
        ]),
      ),
      visibleHostedHandoffSummary: {
        status: handoff.status,
        preflightStatus: handoff.preflightStatus,
        command: handoff.command,
        proofTarget: handoff.proofTarget,
      },
      visibleHostedHandoffInputSections: handoff.inputSections.map(
        (section) => section.id,
      ),
      visibleHostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(handoff.inputSections),
      visibleHostedHandoffSectionInputs: sectionInputRows.map((row) => row.id),
      visibleHostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(handoff.inputSections),
      ...(handoff.blockedReceipt === undefined
        ? {}
        : {
            visibleHostedHandoffBlockedReceipt: {
              status: handoff.blockedReceipt.status,
              operatorAction: handoff.blockedReceipt.operatorAction,
              localVsHostedBoundary: handoff.blockedReceipt.localVsHostedBoundary,
              nextProofTarget: handoff.blockedReceipt.nextProofTarget,
              missingRequiredInputs: handoff.blockedReceipt.missingRequiredInputs,
            },
          }),
      visibleRelatedLinks: [
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedIdentityEvidenceAdminProofFixture() {
  const handoff = hostedIdentityEvidenceHandoffCase();
  const progressionSummary = buildDevTestGameHostedIdentityProgressionSummary({
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  const progressionStatuses = Object.fromEntries(
    progressionSummary.progressions.map((progression) => [
      progression.id,
      progression.adminProofTarget,
    ]),
  );
  const handoffGroupIds = handoff.requirementGroups.map((group) => group.id);
  const handoffSectionInputRows = hostedIdentityEvidenceSectionInputRows(
    handoff.inputSections,
  );
  const packetInputRows = hostedIdentityPacketInputRowsFixture();
  const packetSummaryRows = [
    {
      id: "status",
      status: "missing\n0/6 sections provided\n6 sections missing",
    },
    {
      id: "inputs",
      status: "0/16 inputs provided\n16 inputs missing",
    },
    {
      id: "redacted-refs",
      status: "0 redacted refs",
    },
  ];
  return {
    version: 1,
    proof: "dev-test-game-hosted-identity-evidence-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-identity-evidence-admin-surface",
    proofBoundary: "Local admin hosted identity evidence proof only.",
    generatedFrom: {
      hostedIdentityEvidence: "target/dev-test-game/hosted-identity-evidence.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      rawEvidenceStatus: "blocked",
      checkIds: hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
      checkStatuses: Object.fromEntries(
        hostedIdentityEvidenceBlockedChecks.map((check) => [check.id, "blocked"]),
      ),
      blockedCheckIds: hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
      hostedHandoffInputIds: handoff.inputIds,
      hostedHandoffInputValues: {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
          hostedIdentityEvidencePlaceholderFixturePath,
      },
      hostedHandoffBlockedCheckIds: handoff.blockedCheckIds,
      hostedHandoffGroupIds: handoffGroupIds,
      hostedHandoffGroupStatuses: Object.fromEntries(
        handoff.requirementGroups.map((group) => [group.id, group.status]),
      ),
      hostedHandoffInputSectionIds: handoff.inputSections.map(
        (section) => section.id,
      ),
      hostedHandoffInputSectionStatuses:
        hostedIdentityEvidenceInputSectionStatuses(handoff.inputSections),
      hostedHandoffSectionInputIds: handoffSectionInputRows.map((row) => row.id),
      hostedHandoffSectionInputStatuses:
        hostedIdentityEvidenceSectionInputStatuses(handoff.inputSections),
      hostedHandoffOperatorProofIds: handoff.operatorProofDrilldowns.map(
        (drilldown) => drilldown.id,
      ),
      hostedHandoffOperatorProofStatuses: Object.fromEntries(
        handoff.operatorProofDrilldowns.map((drilldown) => [
          drilldown.id,
          drilldown.command,
        ]),
      ),
      hostedHandoffSummary: {
        status: handoff.status,
        preflightStatus: handoff.preflightStatus,
        command: handoff.command,
        proofTarget: handoff.proofTarget,
      },
      hostedHandoffBlockedReceipt: handoff.blockedReceipt,
      handoffPath: {
        upstreamAuditId: "local-next-action",
        upstreamLabel: "Ranked next action",
        localCapabilityAuditId: "local-identity-adapter",
        downstreamStatus: "blocked",
        downstreamCommand: "npm run test:dev-test-game-hosted-identity-evidence",
        downstreamProofTarget: "target/dev-test-game/hosted-identity-evidence.json",
      },
      hostedIdentityPacketSummaryIds: packetSummaryRows.map((row) => row.id),
      hostedIdentityPacketSummaryStatuses: Object.fromEntries(
        packetSummaryRows.map((row) => [row.id, row.status]),
      ),
      hostedIdentityPacketSectionIds: hostedIdentityEvidencePacketSectionDefinitions.map(
        (section) => section.field,
      ),
      hostedIdentityPacketInputIds: packetInputRows.map((row) => row.id),
      hostedIdentityPacketInputStatuses: Object.fromEntries(
        packetInputRows.map((row) => [row.id, row.status]),
      ),
      hostedIdentityProgressionSummary:
        "target/dev-test-game/hosted-identity-progression-summary.json",
      hostedIdentityProgressionIds: progressionSummary.progressions.map(
        (progression) => progression.id,
      ),
      hostedIdentityProgressionStatuses: progressionStatuses,
      hostedIdentityRoleSurfaceContractDiffStatus: "blocked",
      hostedIdentityRoleSurfaceContractMismatchIds: [
        "hostedIdentity-roleSurfaceArchitectureChanged",
        "hostedIdentity-roleSurfaceContract",
      ],
      relatedAuditIds: ["local-identity-adapter", "local-next-action"],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl:
        "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-identity-evidence",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
      visibleUnproven: hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
      visibleHostedHandoffInputs: [...hostedIdentityEvidenceInputIds],
      visibleHostedHandoffInputValues: {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
          `FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH ${hostedIdentityEvidencePlaceholderFixturePath} required`,
      },
      visibleHostedHandoffBlockedChecks: handoff.blockedCheckIds,
      visibleHostedHandoffGroups: handoffGroupIds,
      visibleHostedHandoffGroupStatuses: Object.fromEntries(
        handoff.requirementGroups.map((group) => [
          group.id,
          `${group.label} ${group.status}`,
        ]),
      ),
      visibleHostedHandoffInputSections: handoff.inputSections.map(
        (section) => section.id,
      ),
      visibleHostedHandoffInputSectionStatuses: Object.fromEntries(
        handoff.inputSections.map((section) => [
          section.id,
          `${section.label} ${section.status}`,
        ]),
      ),
      visibleHostedHandoffSectionInputs: handoffSectionInputRows.map(
        (row) => row.id,
      ),
      visibleHostedHandoffSectionInputStatuses: Object.fromEntries(
        handoffSectionInputRows.map((row) => [row.id, `${row.id} ${row.status}`]),
      ),
      visibleHostedHandoffOperatorProofs: handoff.operatorProofDrilldowns.map(
        (drilldown) => drilldown.id,
      ),
      visibleHostedHandoffOperatorProofStatuses: Object.fromEntries(
        handoff.operatorProofDrilldowns.map((drilldown) => [
          drilldown.id,
          `${drilldown.label} ${drilldown.command} ${drilldown.progressionId} ${drilldown.sourcePath} ${drilldown.proofTarget} ${drilldown.roleUrl} ${drilldown.firstMissingInputId} ${drilldown.firstMissingCheckId} ${drilldown.proofBoundary}`,
        ]),
      ),
      visibleHostedHandoffSummary: {
        status: handoff.status,
        preflightStatus: handoff.preflightStatus,
        command: handoff.command,
        proofTarget: handoff.proofTarget,
      },
      visibleHostedHandoffBlockedReceipt: {
        status: handoff.blockedReceipt.status,
        operatorAction: handoff.blockedReceipt.operatorAction,
        localVsHostedBoundary: handoff.blockedReceipt.localVsHostedBoundary,
        nextProofTarget: handoff.blockedReceipt.nextProofTarget,
        missingRequiredInputs: handoff.blockedReceipt.missingRequiredInputs,
        firstMissingOperatorArtifact:
          handoff.blockedReceipt.firstMissingOperatorArtifact,
      },
      visibleHandoffPath: {
        upstreamAuditId: "local-next-action",
        upstreamLabel: "Ranked next action",
        localCapabilityAuditId: "local-identity-adapter",
        downstreamStatus: "blocked",
        downstreamCommand: "npm run test:dev-test-game-hosted-identity-evidence",
        downstreamProofTarget: "target/dev-test-game/hosted-identity-evidence.json",
      },
      visibleHostedIdentityPacketSummaries: packetSummaryRows.map((row) => row.id),
      visibleHostedIdentityPacketSummaryStatuses: Object.fromEntries(
        packetSummaryRows.map((row) => [row.id, row.status]),
      ),
      visibleHostedIdentityPacketSections:
        hostedIdentityEvidencePacketSectionDefinitions.map((section) => section.field),
      visibleHostedIdentityPacketInputs: packetInputRows.map((row) => row.id),
      visibleHostedIdentityPacketInputStatuses: Object.fromEntries(
        packetInputRows.map((row) => [row.id, `${row.id} ${row.status}`]),
      ),
      visibleHostedIdentityProgressions: progressionSummary.progressions.map(
        (progression) => progression.id,
      ),
      visibleHostedIdentityProgressionStatuses: progressionStatuses,
      visibleHostedIdentityRoleSurfaceContractDiff: { status: "blocked" },
      visibleHostedIdentityRoleSurfaceContractMismatches: [
        "hostedIdentity-roleSurfaceArchitectureChanged",
        "hostedIdentity-roleSurfaceContract",
      ],
      visibleRelatedLinks: ["local-identity-adapter", "local-next-action"],
      visibleRelatedDestinations: [
        {
          linkId: "local-next-action",
          auditId: "local-next-action",
          detailRoleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
          visibleChecks: ["next-command"],
        },
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedIdentityCompleteAdminProofFixture() {
  const proof = JSON.parse(JSON.stringify(hostedIdentityEvidenceAdminProofFixture()));
  const packetSummaryRows = [
    {
      id: "status",
      status: "provided\n6/6 sections provided\n0 sections missing",
    },
    {
      id: "inputs",
      status: "16/16 inputs provided\n0 inputs missing",
    },
    {
      id: "redacted-refs",
      status: "6 redacted refs",
    },
  ];
  const packetInputRows = hostedIdentityEvidencePacketSectionDefinitions.flatMap(
    (section) =>
      section.requiredInputIds.map((inputId) => ({
        id: `${section.field}-${inputId}`,
        status: "provided",
      })),
  );
  proof.proofBoundary =
    "Local admin hosted identity complete redacted packet proof only.";
  proof.generatedFrom.hostedIdentityEvidence =
    "target/dev-test-game/hosted-identity-evidence-complete.json";
  proof.generatedFrom.status = "passed";
  proof.generatedFrom.rawEvidenceStatus = "passed";
  proof.generatedFrom.rawEvidencePath =
    hostedIdentityEvidenceRedactedPassFixturePath;
  proof.generatedFrom.checkStatuses = Object.fromEntries(
    hostedIdentityEvidenceBlockedChecks.map((check) => [check.id, "passed"]),
  );
  proof.generatedFrom.blockedCheckIds = [];
  proof.generatedFrom.hostedHandoffInputValues = {
    FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
      hostedIdentityEvidenceRedactedPassFixturePath,
  };
  proof.generatedFrom.hostedHandoffBlockedCheckIds = [];
  proof.generatedFrom.hostedHandoffGroupStatuses = Object.fromEntries(
    hostedIdentityEvidenceHandoffCase().requirementGroups.map((group) => [
      group.id,
      "passed",
    ]),
  );
  proof.generatedFrom.hostedHandoffInputSectionStatuses = {
    "proof-command": "provided",
    "evidence-file": "provided",
    "role-surface-contracts": "provided",
    "identity-operations": "provided",
  };
  proof.generatedFrom.hostedHandoffSectionInputStatuses = Object.fromEntries(
    hostedIdentityEvidenceSectionInputRows(
      hostedIdentityEvidenceHandoffCase().inputSections,
    ).map((row) => [row.id, "provided"]),
  );
  proof.generatedFrom.hostedHandoffSummary = {
    ...proof.generatedFrom.hostedHandoffSummary,
    status: "passed",
    preflightStatus: "passed",
  };
  delete proof.generatedFrom.hostedHandoffBlockedReceipt;
  proof.generatedFrom.handoffPath.downstreamStatus = "passed";
  proof.generatedFrom.hostedIdentityPacketSummaryStatuses = Object.fromEntries(
    packetSummaryRows.map((row) => [row.id, row.status]),
  );
  proof.generatedFrom.hostedIdentityPacketInputStatuses = Object.fromEntries(
    packetInputRows.map((row) => [row.id, row.status]),
  );
  proof.generatedFrom.hostedIdentityRoleSurfaceContractDiffStatus = "passed";
  proof.generatedFrom.hostedIdentityRoleSurfaceContractMismatchIds = [];
  proof.adminRoleSurface.visibleChecks = hostedIdentityEvidenceBlockedChecks.map(
    (check) => check.id,
  );
  proof.adminRoleSurface.visibleUnproven = [];
  proof.adminRoleSurface.visibleHostedHandoffInputValues = {
    FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
      `FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH ${hostedIdentityEvidenceRedactedPassFixturePath} required`,
  };
  proof.adminRoleSurface.visibleHostedHandoffBlockedChecks = [];
  proof.adminRoleSurface.visibleHostedHandoffGroupStatuses = Object.fromEntries(
    hostedIdentityEvidenceHandoffCase().requirementGroups.map((group) => [
      group.id,
      `${group.label} passed`,
    ]),
  );
  proof.adminRoleSurface.visibleHostedHandoffInputSectionStatuses = {
    "proof-command": "Proof command provided",
    "evidence-file": "Evidence file provided",
    "role-surface-contracts": "Role-surface contracts provided",
    "identity-operations": "Identity operations provided",
  };
  proof.adminRoleSurface.visibleHostedHandoffSectionInputStatuses =
    Object.fromEntries(
      hostedIdentityEvidenceSectionInputRows(
        hostedIdentityEvidenceHandoffCase().inputSections,
      ).map((row) => [row.id, `${row.id} provided`]),
    );
  proof.adminRoleSurface.visibleHostedHandoffSummary = {
    ...proof.adminRoleSurface.visibleHostedHandoffSummary,
    status: "passed",
    preflightStatus: "passed",
  };
  delete proof.adminRoleSurface.visibleHostedHandoffBlockedReceipt;
  proof.adminRoleSurface.visibleHandoffPath.downstreamStatus = "passed";
  proof.adminRoleSurface.visibleHostedIdentityPacketSummaryStatuses =
    Object.fromEntries(packetSummaryRows.map((row) => [row.id, row.status]));
  proof.adminRoleSurface.visibleHostedIdentityPacketInputStatuses =
    Object.fromEntries(
      packetInputRows.map((row) => [row.id, `${row.id} provided`]),
    );
  proof.adminRoleSurface.visibleHostedIdentityRoleSurfaceContractDiff = {
    status: "passed",
  };
  proof.adminRoleSurface.visibleHostedIdentityRoleSurfaceContractMismatches = [];
  return proof;
}

function hostedIdentityPacketInputRowsFixture() {
  return hostedIdentityEvidencePacketSectionDefinitions.flatMap((section) =>
    section.requiredInputIds.map((inputId) => ({
      id: `${section.field}-${inputId}`,
      status: "missing",
    })),
  );
}

function hostedEvidenceLaneAdminProofFixture() {
  const handoff = hostedEvidenceBlockedHandoffChecklistFixture();
  const sectionInputRows = hostedEvidenceHandoffSectionInputRows(
    handoff.inputSections,
  );
  return {
    version: 1,
    proof: "dev-test-game-hosted-evidence-lane-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-evidence-lane-admin-surface",
    proofBoundary: "Local admin hosted evidence lane proof only.",
    generatedFrom: {
      hostedEvidenceLane: "target/dev-test-game/hosted-evidence-lane.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      status: "blocked",
      preflightStatus: "blocked",
      checkIds: [
        "hosted-target-preflight",
        ...hostedTargetPreflightBlockingCheckIds,
        "release-claim-boundary-carried",
      ],
      blockedCheckIds: [...hostedTargetPreflightBlockingCheckIds],
      realHostedEvidenceInputIds: [...hostedEvidenceHandoffInputIds],
      hostedHandoffInputIds: handoff.inputIds,
      hostedHandoffBlockedCheckIds: handoff.blockedCheckIds,
      hostedHandoffInputSectionIds: handoff.inputSections.map(
        (section) => section.id,
      ),
      hostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(handoff.inputSections),
      hostedHandoffSectionInputIds: sectionInputRows.map((row) => row.id),
      hostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(handoff.inputSections),
      relatedAuditIds: [
        "local-hosted-target-preflight",
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-hosted-evidence-lane",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "hosted-target-preflight",
        ...hostedTargetPreflightBlockingCheckIds,
        "release-claim-boundary-carried",
      ],
      visibleUnproven: [...hostedTargetPreflightBlockingCheckIds],
      visibleRealHostedEvidenceInputs: [...hostedEvidenceHandoffInputIds],
      visibleHostedHandoffInputs: handoff.inputIds,
      visibleHostedHandoffBlockedChecks: handoff.blockedCheckIds,
      visibleHostedHandoffInputSections: handoff.inputSections.map(
        (section) => section.id,
      ),
      visibleHostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(handoff.inputSections),
      visibleHostedHandoffSectionInputs: sectionInputRows.map((row) => row.id),
      visibleHostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(handoff.inputSections),
      visibleRelatedLinks: [
        "local-hosted-target-preflight",
        "local-hosted-concurrent-race-matrix",
        "local-next-action",
      ],
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function hostedEvidenceLaneDemoProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-evidence-lane-demo-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-hosted-evidence-lane-demo-proof",
    proofBoundary:
      "Local demo proof for the hosted evidence lane pass path without hosted deployment claims.",
    target: {
      frontendBaseUrl: "https://fmarch-demo.example.test",
      apiBaseUrl: "https://api.fmarch-demo.example.test",
      groupId: "replacement-race-reload",
      syntheticExternalTarget: true,
    },
    generatedFrom: {
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      hostedConcurrentRaceMatrixGeneratedAt: "2026-06-26T00:00:00.000Z",
      hostedEvidenceLane: "target/dev-test-game/hosted-evidence-lane.json",
      blockedLane: "target/dev-test-game/hosted-evidence-lane-demo-blocked.json",
      passedLane: "target/dev-test-game/hosted-evidence-lane-demo-passed.json",
      rawEvidence: "target/dev-test-game/hosted-matrix-demo-raw.json",
      externalEvidence: "target/dev-test-game/hosted-matrix-demo-external.json",
    },
    checks: [
      {
        id: "blocked-lane-recorded",
        status: "blocked",
        evidence: "target/dev-test-game/hosted-evidence-lane-demo-blocked.json",
      },
      {
        id: "synthetic-raw-evidence-written",
        status: "passed",
        evidence: "target/dev-test-game/hosted-matrix-demo-raw.json",
      },
      {
        id: "passed-lane-recorded",
        status: "passed",
        evidence: "target/dev-test-game/hosted-evidence-lane-demo-passed.json",
      },
      {
        id: "external-evidence-written",
        status: "passed",
        evidence: "target/dev-test-game/hosted-matrix-demo-external.json",
      },
      {
        id: "synthetic-demo-boundary-carried",
        status: "passed",
        hostedEvidenceMode: "synthetic-demo",
        realHostedEvidenceStatus: "unproven",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    handoff: {
      blockedRoleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      passedRoleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      blockedNextCommand: "npm run test:dev-test-game-hosted-evidence-lane",
      passedNextCommand:
        "npm run test:dev-test-game-hosted-matrix-external-evidence",
      passedNextProofTarget: "target/dev-test-game/hosted-matrix-demo-external.json",
    },
    blockedLane: {
      status: "blocked",
      preflightStatus: "blocked",
      blockedCheckIds: [hostedTargetPreflightBlockingCheckIds[0]],
      nextProofTarget: "target/dev-test-game/hosted-evidence-lane.json",
    },
    passedLane: {
      status: "passed",
      preflightStatus: "passed",
      blockedCheckIds: [],
      hostedEvidenceMode: "synthetic-demo",
      realHostedEvidenceStatus: "unproven",
      nextProofTarget: "target/dev-test-game/hosted-matrix-demo-external.json",
    },
    externalEvidence: {
      proof: "fmarch-hosted-concurrent-race-matrix-evidence",
      status: "passed",
      sourceMode: "synthetic-demo",
      rawEvidenceSyntheticExternalTarget: true,
      groupIds: ["replacement-race-reload"],
      cellIds: [
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
      ],
      commandRaceCount: 3,
      reloadRecoveryCount: 3,
      reconnectRecovery: true,
      staleConflictMessages: true,
      rawRoleCredentialsRedacted: true,
    },
  };
}

function hostedTargetPreflightFixture({
  status,
  rawEvidenceSyntheticExternalTarget = false,
}) {
  const passed = status === "passed";
  const target = {
    frontendBaseUrl: passed ? "https://fmarch.example.test" : null,
    apiBaseUrl: passed ? "https://api.fmarch.example.test" : null,
    groupId: "replacement-race-reload",
    rawEvidencePath: passed
      ? "target/dev-test-game/hosted-matrix-raw-evidence.json"
      : null,
    rawEvidenceStatus: passed ? "passed" : "blocked",
    rawEvidenceSyntheticExternalTarget,
  };
  const checks = [
    ...hostedTargetPreflightBlockingCheckIds.map((id) => ({
      id,
      status: passed ? "passed" : "blocked",
      ...(passed
        ? {}
        : { requiredEvidence: hostedTargetPreflightRequiredEvidence(id) }),
    })),
    {
      id: "release-claim-boundary-carried",
      status: "passed",
      releaseReady: false,
      productionReady: false,
    },
  ];
  const blockedReceipt = passed
    ? undefined
    : {
        status: "blocked",
        blockedCheckIds: [...hostedTargetPreflightBlockingCheckIds],
        command: "npm run test:dev-test-game-hosted-evidence-lane",
        proofTarget: devTestGameHostedTargetPreflightPath,
        nextProofTarget: devTestGameHostedTargetPreflightPath,
        requiredInputs: [
          {
            name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
            value: null,
            required: true,
            purpose: "Externally reachable frontend base URL.",
          },
          {
            name: "FMARCH_HOSTED_MATRIX_API_URL",
            value: null,
            required: true,
            purpose:
              "Externally reachable API base URL for the same hosted deployment.",
          },
          {
            name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
            value: "replacement-race-reload",
            required: true,
            purpose: "Hosted matrix group to prove.",
          },
          {
            name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
            value: null,
            required: true,
            purpose:
              "Readable raw hosted matrix evidence captured from the real target.",
          },
        ],
        missingRequiredInputs: [
          "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
          "FMARCH_HOSTED_MATRIX_API_URL",
          "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        ],
        operatorAction:
          "Configure the hosted frontend/API URLs plus a readable raw hosted matrix evidence JSON from that same deployment, then rerun npm run test:dev-test-game-hosted-evidence-lane.",
        localVsHostedBoundary:
          "Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.",
      };
  return {
    version: 1,
    proof: "dev-test-game-hosted-target-preflight",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "hosted-target-preflight",
    proofBoundary: "Hosted target preflight fixture without release claims.",
    target,
    checks,
    ...(passed
      ? {}
      : { blockedReceipt }),
    hostedHandoffChecklist: hostedEvidenceHandoffChecklistFromPreflight({
      preflight: {
        status,
        checks,
        target,
        ...(blockedReceipt === undefined ? {} : { blockedReceipt }),
      },
    }),
    nextCommand: passed
      ? `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`
      : `npm run ${devTestGameHostedTargetPreflightCommand}`,
    nextProofTarget: passed
      ? devTestGameHostedMatrixExternalEvidencePath
      : devTestGameHostedTargetPreflightPath,
  };
}

function hostedTargetPreflightRequiredEvidence(id) {
  return {
    "hosted-frontend-url-configured":
      hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
    "hosted-api-url-configured":
      hostedTargetPreflightMissingApiUrlRequiredEvidence,
    "hosted-targets-external":
      hostedTargetPreflightExternalTargetsRequiredEvidence(),
    "raw-evidence-path-configured":
      hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
    "raw-evidence-readable":
      hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  }[id];
}

function adminSpineAdminProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine-admin-surface",
    proofBoundary: "Local admin aggregate spine proof only.",
    generatedFrom: {
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      proofIds: [
        "core-loop",
        "hardening",
        "identity",
        "hosted-identity-evidence",
        "backup",
        "ops",
        "seed",
        "release",
        "release-runbook",
        "race-coverage",
        "hosted-target-preflight",
        "hosted-evidence-lane",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "spine-manifest",
      ],
      batchIds: [
        "aggregate-pre-release-admin-proof-batch",
        "aggregate-release-and-hosted-admin-proof-batch",
      ],
      batchLabels: [
        "Aggregate pre-release admin proof batch",
        "Aggregate release and hosted admin proof batch",
      ],
      batchCaseCounts: [
        {
          label: "Aggregate pre-release admin proof batch",
          caseCount: 7,
        },
        {
          label: "Aggregate release and hosted admin proof batch",
          caseCount: 9,
        },
      ],
    },
    adminRoleSurface: {
      status: "passed",
      overviewRoleUrl: "/admin?game=<seeded-game>",
      detailRoleUrl: "/admin/audit/local-admin-spine?game=<seeded-game>",
      linkTestId: "admin-audit-link-local-admin-spine",
      surfaceTestId: "admin-audit-detail-surface",
      clickedThroughFromOverview: true,
      visibleChecks: [
        "core-loop",
        "hardening",
        "identity",
        "backup",
        "ops",
        "seed",
        "release",
        "release-runbook",
        "race-coverage",
        "hosted-target-preflight",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "spine-manifest",
        "recovery",
        "spine-manifest-handoff",
      ],
      visibleAdminSpineBatches: [
        "aggregate-pre-release-admin-proof-batch",
        "aggregate-release-and-hosted-admin-proof-batch",
      ],
      visibleAdminSpineBatchStatuses: {
        "aggregate-pre-release-admin-proof-batch":
          "Aggregate pre-release admin proof batch passed 7 cases shared frontend shared chromium",
        "aggregate-release-and-hosted-admin-proof-batch":
          "Aggregate release and hosted admin proof batch passed 9 cases shared frontend shared chromium",
      },
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
  };
}

function adminSpineTerminalBatchesFixture() {
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-terminal-batches",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-admin-spine-terminal-batches",
    proofBoundary: "Local admin spine terminal proof-batch receipt.",
    generatedFrom: {
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
      proofGraph: "target/dev-test-game/proof-graph.json",
      nextAction: "target/dev-test-game/next-action.json",
      proofFreshnessAdminProof:
        "target/dev-test-game/proof-freshness-admin-proof.json",
      nextActionAdminProof: "target/dev-test-game/next-action-admin-proof.json",
      batchCount: 2,
    },
    batches: [
      {
        label: "Terminal admin proof batch",
        reason:
          "terminal graph, freshness, and next-action admin surfaces share the generated proof graph inputs",
        status: "passed",
        caseCount: 3,
        caseSmokeNames: [
          "dev-test-game-proof-graph-admin-proof",
          "dev-test-game-proof-freshness-admin-proof",
          "dev-test-game-next-action-admin-proof",
        ],
        proofIds: ["proof-graph", "proof-freshness", "next-action"],
        artifactPaths: [
          "target/dev-test-game/proof-graph-admin-proof.json",
          "target/dev-test-game/proof-freshness-admin-proof.json",
          "target/dev-test-game/next-action-admin-proof.json",
        ],
        elapsedMs: 2400,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
      {
        label: "Terminal refresh admin proof batch",
        reason:
          "freshness and next-action admin surfaces share the refreshed next-action input",
        status: "passed",
        caseCount: 2,
        caseSmokeNames: [
          "dev-test-game-proof-freshness-admin-proof",
          "dev-test-game-next-action-admin-proof",
        ],
        proofIds: ["proof-freshness", "next-action"],
        artifactPaths: [
          "target/dev-test-game/proof-freshness-admin-proof.json",
          "target/dev-test-game/next-action-admin-proof.json",
        ],
        elapsedMs: 1600,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function recoveryReceiptFixtures() {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => [
      descriptor.receiptKey,
      recoveryReceiptFixture(descriptor),
    ]),
  );
}

function recoveryReceiptFixtureOptions() {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.flatMap((descriptor) => [
      [descriptor.pathOptionKey, descriptor.proofTarget],
      [descriptor.receiptKey, recoveryReceiptFixture(descriptor)],
    ]),
  );
}

function recoveryReceiptFixture(descriptor) {
  const fixture = descriptor.receiptFixture;
  return {
    version: 1,
    proof: `dev-test-game-${descriptor.kind}`,
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: fixture.scope,
    proofBoundary: fixture.proofBoundary,
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      [fixture.adminProofSourceKey]: fixture.adminProofSourcePath,
      game: "00000000-0000-0000-0000-000000000001",
      family: {
        id: descriptor.familyId,
        laneIds: [...descriptor.laneIds],
      },
      roleUrl: descriptor.roleUrl,
    },
    summary: {
      status: "passed",
      laneCount: descriptor.laneIds.length,
      passedLaneCount: descriptor.laneIds.length,
      familyCount: fixture.familyCount,
      expectedLaneCount: descriptor.laneIds.length,
      expectedFamilyCount: fixture.familyCount,
    },
    laneIds: [...descriptor.laneIds],
    ...(descriptor.normalizedEvidenceObjects.length === 0
      ? {}
      : {
          normalizedEvidenceObjects: descriptor.normalizedEvidenceObjects.map(
            (object) => ({
              ...object,
              status: "passed",
              evidencePath: `lanes.${object.laneId}.evidence.${object.name}`,
            }),
          ),
        }),
    lanes: descriptor.laneIds.map((laneId) => ({
      id: laneId,
      label: laneId,
      status: "passed",
      compactStatus: `passed:${laneId}`,
      evidence: fixture.evidence,
    })),
  };
}

function completedGameHardeningCoverageStatusFixture() {
  const cases = completedGameHardeningSpineLaneCases();
  const familyCount = new Set(cases.map((scenario) => scenario.family)).size;
  return `passed: ${cases.length}/${cases.length} lanes across ${familyCount} families`;
}

function adminSpineProofFixture() {
  const fixtures = [
    ["core-loop", coreLoopAdminProofFixture()],
    ["hardening", hardeningAdminProofFixture()],
    ["identity", identityAdminProofFixture()],
    ["hosted-identity-evidence", hostedIdentityEvidenceAdminProofFixture()],
    ["backup", backupAdminProofFixture()],
    ["ops", opsAdminProofFixture()],
    ["seed", seedAdminProofFixture()],
    ["release", releaseAdminProofFixture()],
    ["release-runbook", releaseRunbookAdminProofFixture()],
    ["race-coverage", raceCoverageAdminProofFixture()],
    ["hosted-target-preflight", hostedTargetPreflightAdminProofFixture()],
    ["hosted-evidence-lane", hostedEvidenceLaneAdminProofFixture()],
    [
      "hosted-concurrent-race-matrix",
      hostedConcurrentRaceMatrixAdminProofFixture(),
    ],
    ["hosted-ops-signals", hostedOpsSignalsAdminProofFixture()],
    [
      "real-hosted-observability-handoff",
      realHostedObservabilityHandoffAdminProofFixture(),
    ],
    ["spine-manifest", spineManifestAdminProofFixture()],
  ];
  const batches = adminSpineProofBatchFixtures(fixtures);
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine",
    generatedAt: "2026-06-26T00:00:00.000Z",
    generatedFrom: {
      game: "00000000-0000-0000-0000-000000000001",
      proofs: Object.fromEntries(fixtures.map(([id]) => [id, proofPathFor(id)])),
    },
    adminProofs: fixtures.map(([id, proof]) => ({
      id,
      label: `${id} admin proof`,
      proof: proof.proof,
      status: "passed",
      path: proofPathFor(id),
      rerunCommand: adminProofRerunCommandFor(id),
      refreshedInCurrentRun: true,
      game: proof.generatedFrom.game,
      overviewRoleUrl: proof.adminRoleSurface.overviewRoleUrl,
      detailRoleUrl: proof.adminRoleSurface.detailRoleUrl,
      releaseReady: false,
      productionReady: false,
    })),
    batches,
    recovery: {
      status: "passed",
      surfaceCount: fixtures.length,
      refreshedCount: fixtures.length,
      batchCount: batches.length,
      batches: batches.map((batch) => ({
        label: batch.label,
        reason: batch.reason,
        status: batch.status,
        caseCount: batch.caseCount,
        elapsedMs: batch.elapsedMs,
        artifactPaths: batch.artifactPaths,
      })),
      nextCommand: "npm run test:dev-test-game-admin-spine",
      proofBoundary: "Local aggregate recovery commands only.",
      surfaces: fixtures.map(([id]) => ({
        id,
        label: `${id} admin proof`,
        status: "passed",
        path: proofPathFor(id),
        rerunCommand: adminProofRerunCommandFor(id),
        refreshedInCurrentRun: true,
        mtime: "2026-06-26T00:00:00.000Z",
        sizeBytes: 42,
      })),
    },
    proofBoundary: "Local aggregate admin spine proof only.",
  };
}

function adminSpineProofBatchFixtures(fixtures) {
  const fixtureMap = new Map(fixtures);
  return [
    adminSpineProofBatchFixture({
      label: "Aggregate pre-release admin proof batch",
      reason:
        "core, hardening, identity, backup, ops, and seed admin surfaces share the pre-readiness local proof inputs",
      proofIds: [
        "core-loop",
        "hardening",
        "identity",
        "hosted-identity-evidence",
        "backup",
        "ops",
        "seed",
      ],
      fixtureMap,
      elapsedMs: 1200,
    }),
    adminSpineProofBatchFixture({
      label: "Aggregate release and hosted admin proof batch",
      reason:
        "release, hosted, race coverage, and manifest admin surfaces share the post-readiness rollup inputs",
      proofIds: [
        "release",
        "release-runbook",
        "race-coverage",
        "hosted-target-preflight",
        "hosted-evidence-lane",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "real-hosted-observability-handoff",
        "spine-manifest",
      ],
      fixtureMap,
      elapsedMs: 1800,
    }),
  ];
}

function adminSpineProofBatchFixture({
  label,
  reason,
  proofIds,
  fixtureMap,
  elapsedMs,
}) {
  return {
    label,
    reason,
    status: "passed",
    caseCount: proofIds.length,
    caseSmokeNames: proofIds.map((id) => fixtureMap.get(id).proof),
    proofIds,
    artifactPaths: proofIds.map((id) => proofPathFor(id)),
    elapsedMs,
    sharedFrontendSession: true,
    sharedChromiumSession: true,
    releaseReady: false,
    productionReady: false,
  };
}

function proofPathFor(id) {
  return `target/dev-test-game/${id === "core-loop" ? "core-loop" : id}-admin-proof.json`;
}

function adminProofRerunCommandFor(id) {
  return `npm run test:dev-test-game-${id}-admin-proof`;
}

function identityRole({ role, loginUrl, principalUserId, capabilityKinds }) {
  return {
    role,
    loginUrl,
    returnTo: new URL(loginUrl).searchParams.get("returnTo"),
    principalUserId,
    capabilityKinds,
    cookie: {
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      valuePrefix: "invite-session-",
    },
  };
}
