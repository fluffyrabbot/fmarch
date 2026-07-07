export const HOST_VOTECOUNT_PANEL_CONTRACT = Object.freeze({
  rootClassName: "host-console-critical-path__votecount fm-section",
  rowsClassName: "host-console-critical-path__vote-rows fm-wagon",
  rowClassName: "host-console-critical-path__vote-row fm-wagon__row",
  emptyClassName: "host-console-critical-path__empty",
  componentName: "host-votecount-panel",
  minRowTargetPx: 44,
});

export function buildHostVotecountPanelViewModel({
  boundary,
  rows = [],
} = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: HOST_VOTECOUNT_PANEL_CONTRACT.rootClassName,
      ariaLabel: "Votecount",
      testId: "host-console-votecount",
      data: Object.freeze({
        component: HOST_VOTECOUNT_PANEL_CONTRACT.componentName,
      }),
    }),
    heading: "Votecount",
    boundary: Object.freeze({
      status: boundary?.status ?? "unknown",
      statusLabel: "Official count",
      command: boundary?.command ?? "official-votecount-live-ws",
      label: "Live official tally",
      commandTestId: "host-console-votecount-boundary",
    }),
    empty: Object.freeze({
      className: HOST_VOTECOUNT_PANEL_CONTRACT.emptyClassName,
      message: "No active ballots",
    }),
    classes: Object.freeze({
      rows: HOST_VOTECOUNT_PANEL_CONTRACT.rowsClassName,
      row: HOST_VOTECOUNT_PANEL_CONTRACT.rowClassName,
    }),
    rows: Object.freeze(rows.map(normalizeVotecountRow)),
  });
}

export function votecountRowTestId(target) {
  return `host-console-votecount-row-${String(target).replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function normalizeVotecountRow(row) {
  const count = Number(row.count ?? 0);
  const needed = Number(row.needed ?? 0);
  return Object.freeze({
    target: String(row.target ?? "unknown"),
    tally: `${count}/${needed}`,
    fillPercent: needed > 0 ? Math.min(Math.round((count / needed) * 100), 100) : 0,
    atHammer: needed > 0 && count > 0 && needed - count <= 1,
    testId: votecountRowTestId(row.target ?? "unknown"),
    minTargetPx: HOST_VOTECOUNT_PANEL_CONTRACT.minRowTargetPx,
  });
}
