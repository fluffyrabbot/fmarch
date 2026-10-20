import { buildPlayerActionTargetPicker } from "./player-action-target-picker.mjs";
import { seatNames } from "../../app/seat-presenter.mjs";
import { buildPlayerVotePicker } from "./player-vote-picker-model.mjs";

export const PLAYER_COMMAND_PANEL_CONTRACT = Object.freeze({
  rootClassName: "player-command-panel fm-card fm-primary-action-zone",
  componentName: "player-command-panel",
  actionPriority: "primary",
  contextClassName: "player-command-panel__context",
  thumbZone: "player-primary-actions",
  thumbZoneTestId: "player-primary-action-zone",
  channelContextTestId: "player-command-channel-context",
  deadlineTestId: "player-votecount-deadline",
  minTouchTargetPx: 44,
  actions: Object.freeze(["submit_vote", "submit_vote:no_lynch", "withdraw_vote", "submit_post"]),
});

export function buildPlayerCommandPanelViewModel({
  composer = {},
  phase = {},
  votecount = [],
  channel = {},
  player = {},
  commandPending = false,
  commandInterrupted = false,
  confirmingAction = null,
  selectedVoteAction = null,
  roster = [],
}) {
  const names = seatNames(roster);
  const channelContext = buildChannelContextViewModel({ channel, player, names });
  const readOnlyReason =
    player.readOnly === true
      ? "Spectator rooms are read-only."
      : channel.allowed === false
        ? "You no longer have access to this event room."
        : channel.postingAllowed === false
          ? `${channel.roomStateLabel ?? "This event room is read-only"}. History remains available to current members.`
          : null;
  if (readOnlyReason !== null) {
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
      heading: "Vote",
      context: buildActionContextViewModel({ phase, composer }),
      votePicker: buildPlayerVotePicker({
        voteCommands: composer.voteCommands ?? [],
        currentVote: composer.currentVote ?? null,
        votecount,
        roster,
        disabled: true,
      }),
      composer: Object.freeze({
        readOnly: true,
        reason: readOnlyReason,
        channelContext,
      }),
    });
  }
  const commandUnavailable = commandPending || commandInterrupted;
  const playerCommandsDisabled =
    commandUnavailable || player.alive === false || player.gameCompleted === true;
  const postCommandDisabled =
    commandUnavailable || player.gameCompleted === true ||
    (player.alive === false && channelContext.channelId !== "dead");
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_COMMAND_PANEL_CONTRACT.rootClassName,
      data: Object.freeze({
        component: PLAYER_COMMAND_PANEL_CONTRACT.componentName,
        thumbZone: PLAYER_COMMAND_PANEL_CONTRACT.thumbZone,
        channelId: channelContext.channelId,
        actionPriority: PLAYER_COMMAND_PANEL_CONTRACT.actionPriority,
      }),
      ariaBusy: commandPending ? "true" : undefined,
      testId: PLAYER_COMMAND_PANEL_CONTRACT.thumbZoneTestId,
    }),
    heading: "Vote",
    context: buildActionContextViewModel({ phase, composer }),
    votePicker: buildPlayerVotePicker({
      voteCommands: composer.voteCommands ?? [],
      currentVote: composer.currentVote ?? null,
      votecount,
      roster,
      selectedAction: selectedVoteAction,
      disabled: playerCommandsDisabled,
      canWithdraw: composer.canWithdrawVote === true,
      withdrawReason: composer.withdrawDisabledReason,
    }),
    composer: Object.freeze({
      label: "Post body",
      defaultBody: String(composer.defaultBody ?? ""),
      channelContext,
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
        roster,
      }),
    }),
  });
}

function buildActionContextViewModel({ phase = {}, composer = {} } = {}) {
  return Object.freeze({
    className: PLAYER_COMMAND_PANEL_CONTRACT.contextClassName,
    deadline: buildDeadlineViewModel(phase),
    currentVote: buildCurrentVoteViewModel(composer),
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

function buildChannelContextViewModel({ channel = {}, player = {}, names = seatNames() }) {
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
    value: `${channelLabel} as ${names.label(slotId)}${lifecycleSuffix}`,
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
