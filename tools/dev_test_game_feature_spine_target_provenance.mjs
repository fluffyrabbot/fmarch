export function featureSpineTargetProvenanceCase({
  targetKey,
  sourceFactory,
  sourceRow,
  source,
}) {
  return Object.freeze({
    targetKey,
    sourceFactory,
    featureSlotId: sourceRow.featureSlotId,
    sourceCheckId: sourceRow.sourceCheckId,
    cycleId: sourceRow.cycleId,
    roleUrlId: sourceRow.roleUrlId,
    checkpointId: sourceRow.checkpointId,
    ...(sourceRow.recoveryHookId === undefined
      ? {}
      : { recoveryHookId: sourceRow.recoveryHookId }),
    adminCheckId: sourceRow.adminCheckId,
    proofArtifact: source.proofArtifact,
    rerunCommand: source.rerunCommand,
    graphSourceNodeId: source.graphSourceNodeId,
    readinessSourceKind: source.readinessSourceKind,
  });
}
