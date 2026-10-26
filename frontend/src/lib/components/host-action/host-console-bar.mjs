// The host bar: the game and phase, the attention badge, the deadline, Post,
// the per-phase routine tools, and the Tools popover with the rare ones
// (usage-frequency audit, decisions 11 and 12).
export const HOST_CONSOLE_BAR_CONTRACT = Object.freeze({
  rootTestId: "host-console-bar",
  attentionTestId: "host-console-attention",
  deadlineTestId: "host-console-bar-deadline",
  postTestId: "host-bar-post",
  toolRowTestId: "host-tool-row",
  toolsTestId: "host-tools",
  toolsMenuTestId: "host-tools-menu",
  routineToolIds: Object.freeze(["votecount", "deadline", "phase"]),
  rareToolIds: Object.freeze(["replacement", "slot-lifecycle", "roles"]),
});

const TOOL_LABELS = Object.freeze({
  votecount: "Votecount",
  deadline: "Deadline",
  phase: "End phase",
  replacement: "Replacement",
  "slot-lifecycle": "Slot lifecycle",
  roles: "Roles",
});

export function buildHostConsoleBarViewModel({
  game = {},
  phase = null,
  nowSeconds = null,
  attentionCount = 0,
  tasks = [],
  decisions = [],
  postAvailable = false,
} = {}) {
  const countdown = formatDeadlineCountdown({ deadlineSeconds: phase?.deadline, nowSeconds });
  const deadlineLabel = typeof phase?.deadlineLabel === "string" && phase.deadlineLabel.trim() !== ""
    ? phase.deadlineLabel.trim()
    : null;
  const taskIds = new Set(tasks.map((task) => task.id));
  const dueIds = new Set(decisions.map((task) => task.id));
  const tool = (id) => Object.freeze({
    id,
    label: TOOL_LABELS[id],
    testId: `host-tool-${id}`,
    available: taskIds.has(id),
    due: dueIds.has(id),
  });
  return Object.freeze({
    root: Object.freeze({ testId: HOST_CONSOLE_BAR_CONTRACT.rootTestId }),
    gameLabel: String(game.label ?? "Game"),
    title: `Host · ${phase?.label ?? "Awaiting first phase"}`,
    attention: Object.freeze({
      testId: HOST_CONSOLE_BAR_CONTRACT.attentionTestId,
      count: attentionCount,
      label: "Attention",
      value: `${attentionCount} decision${attentionCount === 1 ? "" : "s"}`,
      state: attentionCount > 0 ? "attention" : "idle",
    }),
    deadline: countdown === null && deadlineLabel === null
      ? null
      : Object.freeze({
          testId: HOST_CONSOLE_BAR_CONTRACT.deadlineTestId,
          label: "Deadline",
          value: countdown ?? deadlineLabel,
          detail: countdown === null ? null : deadlineLabel,
        }),
    post: Object.freeze({
      testId: HOST_CONSOLE_BAR_CONTRACT.postTestId,
      label: "Post",
      available: postAvailable === true,
    }),
    toolRow: Object.freeze({
      testId: HOST_CONSOLE_BAR_CONTRACT.toolRowTestId,
      ariaLabel: "Host tools",
    }),
    routine: Object.freeze(HOST_CONSOLE_BAR_CONTRACT.routineToolIds.map(tool)),
    tools: Object.freeze({
      testId: HOST_CONSOLE_BAR_CONTRACT.toolsTestId,
      menuTestId: HOST_CONSOLE_BAR_CONTRACT.toolsMenuTestId,
      label: "Tools",
      items: Object.freeze(HOST_CONSOLE_BAR_CONTRACT.rareToolIds.map(tool)),
    }),
  });
}

export function formatDeadlineCountdown({ deadlineSeconds, nowSeconds } = {}) {
  if (!Number.isFinite(deadlineSeconds) || !Number.isFinite(nowSeconds)) {
    return null;
  }
  const remainingSeconds = Math.floor(deadlineSeconds) - Math.floor(nowSeconds);
  if (remainingSeconds <= 0) {
    return "Deadline passed";
  }
  if (remainingSeconds < 60) {
    return "Closes in under 1m";
  }
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  if (hours === 0) {
    return `Closes in ${minutes}m`;
  }
  if (minutes === 0) {
    return `Closes in ${hours}h`;
  }
  return `Closes in ${hours}h ${minutes}m`;
}
