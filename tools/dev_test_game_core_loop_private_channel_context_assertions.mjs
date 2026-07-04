export function assertPrivateChannelContext({
  context,
  expectedChannelId,
  expectedActorSlot,
  expectedActorStatus,
  requireCapabilityLabel = false,
  label = "private-channel context",
  includeEvidenceInError = false,
}) {
  if (
    context?.channelId !== expectedChannelId ||
    context?.actorSlot !== expectedActorSlot ||
    (expectedActorStatus !== undefined &&
      context?.actorStatus !== expectedActorStatus) ||
    (requireCapabilityLabel === true &&
      !String(context?.capabilityLabel ?? "").includes(
        `ChannelMember(${expectedChannelId})`,
      ))
  ) {
    throwPrivateChannelContextAssertionError({
      message: `${label} drifted`,
      evidence: { context, expectedChannelId, expectedActorSlot, expectedActorStatus },
      includeEvidenceInError,
    });
  }
}

export function assertPrivateChannelId({
  channelId,
  expectedChannelId,
  label = "private-channel id",
  includeEvidenceInError = false,
}) {
  if (channelId !== expectedChannelId) {
    throwPrivateChannelContextAssertionError({
      message: `${label} drifted`,
      evidence: { channelId, expectedChannelId },
      includeEvidenceInError,
    });
  }
}

export function assertPrivateThreadPagerVisible({
  visible,
  label = "private-channel thread pager",
  includeEvidenceInError = false,
}) {
  if (visible !== true) {
    throwPrivateChannelContextAssertionError({
      message: `${label} drifted`,
      evidence: { visible },
      includeEvidenceInError,
    });
  }
}

export function assertPrivateChannelRouteContext({
  context,
  expectedChannelId,
  expectedActorSlot,
  expectedActorStatus,
  privateThreadPagerVisible,
  requireCapabilityLabel = false,
  label = "private-channel route context",
  includeEvidenceInError = false,
}) {
  assertPrivateChannelContext({
    context,
    expectedChannelId,
    expectedActorSlot,
    expectedActorStatus,
    requireCapabilityLabel,
    label,
    includeEvidenceInError,
  });
  assertPrivateThreadPagerVisible({
    visible: privateThreadPagerVisible,
    label,
    includeEvidenceInError,
  });
}

function throwPrivateChannelContextAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
