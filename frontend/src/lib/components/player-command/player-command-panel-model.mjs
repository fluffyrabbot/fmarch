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
        }),
        commandButton({
          action: "withdraw_vote",
          label: composer.withdrawCommandLabel,
        }),
        commandButton({
          action: "submit_post",
          label: composer.postCommandLabel,
        }),
      ]),
    }),
  });
}

function buildChannelContextViewModel({ channel = {}, player = {} }) {
  const channelId = String(channel.channel ?? "main");
  const channelLabel = String(channel.label ?? "Main thread");
  const capabilityLabel = String(
    channel.capabilityLabel ?? player.capabilityLabel ?? "Scoped player capability",
  );
  const slotId = String(player.slotId ?? "slot");
  return Object.freeze({
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId,
    channelLabel,
    capabilityLabel,
    slotId,
    label: "Posting target",
    value: `${channelLabel} as ${slotId}`,
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

function commandButton({ action, label, primary = false }) {
  return Object.freeze({
    action,
    label: String(label ?? action),
    className: primary
      ? "fm-touch-button"
      : "fm-touch-button fm-touch-button--secondary",
    data: Object.freeze({
      action,
      minTouchTargetPx: PLAYER_COMMAND_PANEL_CONTRACT.minTouchTargetPx,
    }),
  });
}
