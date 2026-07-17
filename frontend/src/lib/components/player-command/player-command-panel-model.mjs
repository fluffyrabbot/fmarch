import { buildPlayerActionTargetPicker } from "./player-action-target-picker.mjs";

export const PLAYER_COMMAND_PANEL_CONTRACT = Object.freeze({
  rootClassName: "player-command-panel fm-card fm-primary-action-zone",
  componentName: "player-command-panel",
  actionPriority: "primary",
  quickActionClassName: "player-command-panel__quick-actions fm-action-tray",
  quickActionTestId: "player-quick-vote-actions",
  thumbZone: "player-primary-actions",
  thumbZoneTestId: "player-primary-action-zone",
  channelContextTestId: "player-command-channel-context",
  deadlineTestId: "player-votecount-deadline",
  minTouchTargetPx: 44,
  actions: Object.freeze(["submit_vote", "submit_vote:no_lynch", "withdraw_vote", "submit_post"]),
});

export function buildPlayerCommandPanelViewModel({
  composer,
  phase = {},
  votecount = [],
  channel = {},
  player = {},
  confirmingAction = null,
}) {
  if (player.readOnly === true) {
    return Object.freeze({
      root: Object.freeze({
        className: PLAYER_COMMAND_PANEL_CONTRACT.rootClassName,
        data: Object.freeze({
          component: PLAYER_COMMAND_PANEL_CONTRACT.componentName,
          thumbZone: PLAYER_COMMAND_PANEL_CONTRACT.thumbZone,
          channelId: String(channel.channel ?? "spectator"),
          actionPriority: PLAYER_COMMAND_PANEL_CONTRACT.actionPriority,
        }),
        testId: PLAYER_COMMAND_PANEL_CONTRACT.thumbZoneTestId,
      }),
      heading: "Votecount",
      deadline: buildDeadlineViewModel(phase),
      rows: Object.freeze(votecount.map(normalizeVotecountRow)),
      composer: Object.freeze({ readOnly: true }),
      quickActions: Object.freeze({
        className: PLAYER_COMMAND_PANEL_CONTRACT.quickActionClassName,
        testId: PLAYER_COMMAND_PANEL_CONTRACT.quickActionTestId,
        buttons: Object.freeze([]),
      }),
    });
  }
  const channelContext = buildChannelContextViewModel({ channel, player });
  const playerCommandsDisabled =
    player.alive === false || player.gameCompleted === true;
  const postCommandDisabled =
    player.gameCompleted === true ||
    (player.alive === false && channelContext.channelId !== "dead");
  const voteButtons = voteCommandButtons({
    composer,
    disabled: playerCommandsDisabled,
  });
  const withdrawButton = commandButton({
    action: "withdraw_vote",
    label: composer.withdrawCommandLabel,
    disabled: playerCommandsDisabled || composer.canWithdrawVote !== true,
    reason:
      playerCommandsDisabled || composer.canWithdrawVote === true
        ? ""
        : composer.withdrawDisabledReason,
  });
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_COMMAND_PANEL_CONTRACT.rootClassName,
      data: Object.freeze({
        component: PLAYER_COMMAND_PANEL_CONTRACT.componentName,
        thumbZone: PLAYER_COMMAND_PANEL_CONTRACT.thumbZone,
        channelId: channelContext.channelId,
        actionPriority: PLAYER_COMMAND_PANEL_CONTRACT.actionPriority,
      }),
      testId: PLAYER_COMMAND_PANEL_CONTRACT.thumbZoneTestId,
    }),
    quickActions: Object.freeze({
      className: PLAYER_COMMAND_PANEL_CONTRACT.quickActionClassName,
      testId: PLAYER_COMMAND_PANEL_CONTRACT.quickActionTestId,
      buttons: Object.freeze([...voteButtons, withdrawButton]),
    }),
    heading: "Votecount",
    deadline: buildDeadlineViewModel(phase),
    rows: Object.freeze(votecount.map(normalizeVotecountRow)),
    composer: Object.freeze({
      label: "Post body",
      defaultBody: String(composer.defaultBody ?? ""),
      channelContext,
      currentVote: buildCurrentVoteViewModel(composer),
      buttons: Object.freeze([
        commandButton({
          action: "submit_post",
          label: composer.postCommandLabel,
          disabled: postCommandDisabled,
        }),
      ]),
      actionHeading: "Night actions",
      actionPicker: buildPlayerActionTargetPicker({
        actionCommands: composer.actionCommands ?? [],
        confirmingAction,
        disabled: playerCommandsDisabled,
      }),
    }),
  });
}

function buildCurrentVoteViewModel(composer = {}) {
  const label = String(composer.currentVoteLabel ?? "No current vote");
  return Object.freeze({
    testId: "player-current-vote",
    label: "Current vote",
    value: label.replace(/^Current vote:\s*/u, ""),
    hasVote: composer.hasCurrentVote === true,
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
    audienceLabel:
      channelId === "main"
        ? "Everyone at the table reads this"
        : "Only this channel's members read this",
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

function commandButton({
  action,
  label,
  primary = false,
  disabled = false,
  reason = "",
}) {
  return Object.freeze({
    action,
    label: String(label ?? action),
    disabled,
    reason: String(reason ?? ""),
    className: primary
      ? "fm-touch-button"
      : "fm-touch-button fm-touch-button--secondary",
    data: Object.freeze({
      action,
      minTouchTargetPx: PLAYER_COMMAND_PANEL_CONTRACT.minTouchTargetPx,
    }),
  });
}

function voteCommandButtons({ composer, disabled }) {
  const voteCommands = normalizeVoteCommands(composer);
  return voteCommands.map((command, index) =>
    commandButton({
      action: command.action,
      label: command.label,
      primary: index === 0,
      disabled,
    }),
  );
}

function normalizeVoteCommands(composer = {}) {
  if (Array.isArray(composer.voteCommands)) {
    return composer.voteCommands.map((command) =>
      Object.freeze({
        action: String(command?.action ?? "submit_vote"),
        label: String(command?.label ?? command?.action ?? "submit_vote"),
      }),
    );
  }
  return Object.freeze([
    Object.freeze({
      action: "submit_vote",
      label: composer.voteCommandLabel,
    }),
  ]);
}
