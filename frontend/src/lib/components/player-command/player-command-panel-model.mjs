export const PLAYER_COMMAND_PANEL_CONTRACT = Object.freeze({
  rootClassName: "player-command-panel",
  componentName: "player-command-panel",
  thumbZone: "player-primary-actions",
  thumbZoneTestId: "player-primary-action-zone",
  channelContextTestId: "player-command-channel-context",
  deadlineTestId: "player-votecount-deadline",
  minTouchTargetPx: 44,
  actions: Object.freeze(["submit_vote", "withdraw_vote", "submit_post"]),
});

export function buildPlayerCommandPanelViewModel({
  composer,
  phase = {},
  votecount = [],
  channel = {},
  player = {},
}) {
  const channelContext = buildChannelContextViewModel({ channel, player });
  const playerCommandsDisabled =
    player.alive === false || player.gameCompleted === true;
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_COMMAND_PANEL_CONTRACT.rootClassName,
      data: Object.freeze({
        component: PLAYER_COMMAND_PANEL_CONTRACT.componentName,
        thumbZone: PLAYER_COMMAND_PANEL_CONTRACT.thumbZone,
        channelId: channelContext.channelId,
      }),
      testId: PLAYER_COMMAND_PANEL_CONTRACT.thumbZoneTestId,
    }),
    heading: "Votecount",
    deadline: buildDeadlineViewModel(phase),
    rows: Object.freeze(votecount.map(normalizeVotecountRow)),
    composer: Object.freeze({
      label: "Post body",
      defaultBody: String(composer.defaultBody ?? ""),
      channelContext,
      buttons: Object.freeze([
        commandButton({
          action: "submit_vote",
          label: composer.voteCommandLabel,
          primary: true,
          disabled: playerCommandsDisabled,
        }),
        commandButton({
          action: "withdraw_vote",
          label: composer.withdrawCommandLabel,
          disabled: playerCommandsDisabled,
        }),
        commandButton({
          action: "submit_post",
          label: composer.postCommandLabel,
          disabled: playerCommandsDisabled,
        }),
      ]),
      actionHeading: "Night actions",
      actionButtons: Object.freeze(
        (composer.actionCommands ?? []).map(actionCommandButton),
      ),
    }),
  });
}

function buildChannelContextViewModel({ channel = {}, player = {} }) {
  const channelId = String(channel.channel ?? "main");
  const channelLabel = String(channel.label ?? "Main thread");
  const actorStatus = String(player.status ?? "").trim();
  const capabilityLabel = String(
    actorStatus === "replaced"
      ? player.capabilityLabel ?? channel.capabilityLabel ?? "Scoped player capability"
      : channel.capabilityLabel ?? player.capabilityLabel ?? "Scoped player capability",
  );
  const slotId = String(player.slotId ?? "slot");
  const actorAlive = player.alive === false ? "false" : player.alive === true ? "true" : "unknown";
  const lifecycleSuffix =
    actorStatus !== "" && actorStatus !== "alive" ? ` (${actorStatus})` : "";
  return Object.freeze({
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId,
    channelLabel,
    capabilityLabel,
    slotId,
    actorAlive,
    actorStatus,
    label: "Posting target",
    value: `${channelLabel} as ${slotId}${lifecycleSuffix}`,
  });
}

function buildDeadlineViewModel(phase) {
  const deadlineLabel = String(phase.deadlineLabel ?? "").trim();
  const phaseLabel = String(phase.label ?? "Current phase");
  const state = String(phase.state ?? "unknown");
  return Object.freeze({
    testId: PLAYER_COMMAND_PANEL_CONTRACT.deadlineTestId,
    label: "Deadline",
    phaseLabel,
    value: deadlineLabel === "" ? "No deadline projected" : deadlineLabel,
    state,
    isProjected: deadlineLabel !== "",
  });
}

function normalizeVotecountRow(row) {
  return Object.freeze({
    target: String(row.target ?? "unknown"),
    tally: `${Number(row.count ?? 0)}/${Number(row.needed ?? 0)}`,
  });
}

function commandButton({ action, label, primary = false, disabled = false }) {
  return Object.freeze({
    action,
    label: String(label ?? action),
    disabled,
    className: primary
      ? "fm-touch-button"
      : "fm-touch-button fm-touch-button--secondary",
    data: Object.freeze({
      action,
      minTouchTargetPx: PLAYER_COMMAND_PANEL_CONTRACT.minTouchTargetPx,
    }),
  });
}

function actionCommandButton(command) {
  const action = String(command?.action ?? "submit_action");
  return Object.freeze({
    action,
    commandKind: String(command?.commandKind ?? action),
    label: String(command?.label ?? action),
    disabled: false,
    detail: String(command?.detail ?? ""),
    className: "fm-touch-button fm-touch-button--secondary",
    data: Object.freeze({
      action,
      templateId: String(command?.templateId ?? ""),
      targetSlots: Object.freeze(
        normalizeTargets(command?.targets ?? command?.targetSlot),
      ),
      minTouchTargetPx: PLAYER_COMMAND_PANEL_CONTRACT.minTouchTargetPx,
    }),
  });
}

function normalizeTargets(value) {
  if (Array.isArray(value)) {
    return value.map((target) => String(target));
  }
  if (value === undefined || value === null || value === "") {
    return Object.freeze([]);
  }
  return Object.freeze([String(value)]);
}
