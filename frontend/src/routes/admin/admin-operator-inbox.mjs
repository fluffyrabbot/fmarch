export const ADMIN_OPERATOR_INBOX_CONTRACT = Object.freeze({
  componentName: "admin-operator-inbox",
  mode: "exception-inbox-decision-canvas",
  selectionMode: "url-addressable-roving-tablist",
  queryParam: "task",
  rootTestId: "admin-operator-inbox",
  queueTestId: "admin-operator-inbox-queue",
  canvasTestId: "admin-operator-decision-canvas",
  initialCanvasCount: 1,
  queueWidthPx: 260,
  stackBelowPx: 820,
});

export function buildAdminOperatorInbox({
  gameSetup = [],
  audit = [],
  recoveryTasks = [],
  commandStatuses = {},
  selectedTaskId = null,
} = {}) {
  const tasks = [
    ...gameSetup.map((item, index) => setupTask(item, index, commandStatuses[item.id])),
    ...audit.map((item, index) => auditTask(item, index)),
    ...recoveryTasks.map((item, index) => recoveryTask(item, index, commandStatuses[item.id])),
  ].sort((left, right) => left.rank - right.rank || left.sourceIndex - right.sourceIndex);
  const resolvedSelectedTaskId = tasks.some((task) => task.id === selectedTaskId)
    ? selectedTaskId
    : tasks[0]?.id ?? null;
  const selectedTask = tasks.find((task) => task.id === resolvedSelectedTaskId) ?? null;
  const attentionCount = tasks.filter((task) => task.attention).length;
  return Object.freeze({
    root: Object.freeze({
      testId: ADMIN_OPERATOR_INBOX_CONTRACT.rootTestId,
      data: Object.freeze({
        component: ADMIN_OPERATOR_INBOX_CONTRACT.componentName,
        mode: ADMIN_OPERATOR_INBOX_CONTRACT.mode,
        selectionMode: ADMIN_OPERATOR_INBOX_CONTRACT.selectionMode,
        initialCanvasCount: String(ADMIN_OPERATOR_INBOX_CONTRACT.initialCanvasCount),
      }),
    }),
    queue: Object.freeze({
      testId: ADMIN_OPERATOR_INBOX_CONTRACT.queueTestId,
      heading: "Operator inbox",
      summary: attentionCount === 0
        ? "No exceptions need attention. Routine actions remain available."
        : `${attentionCount} ${attentionCount === 1 ? "exception needs" : "exceptions need"} attention.`,
      attentionCount,
    }),
    canvas: Object.freeze({ testId: ADMIN_OPERATOR_INBOX_CONTRACT.canvasTestId }),
    tasks: Object.freeze(tasks),
    selectedTaskId: resolvedSelectedTaskId,
    selectedTask,
  });
}

export function adminInboxTaskId(url) {
  const value = parseAdminInboxUrl(url).searchParams.get(
    ADMIN_OPERATOR_INBOX_CONTRACT.queryParam,
  );
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function adminInboxTaskHref({ url, taskId }) {
  const parsed = parseAdminInboxUrl(url);
  const normalizedTaskId = String(taskId ?? "").trim();
  if (normalizedTaskId === "") {
    parsed.searchParams.delete(ADMIN_OPERATOR_INBOX_CONTRACT.queryParam);
  } else {
    parsed.searchParams.set(
      ADMIN_OPERATOR_INBOX_CONTRACT.queryParam,
      normalizedTaskId,
    );
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function adjacentAdminInboxTaskId({ tasks = [], selectedTaskId, key }) {
  if (tasks.length === 0) return null;
  if (key === "Home") return tasks[0].id;
  if (key === "End") return tasks.at(-1).id;
  const delta = ["ArrowRight", "ArrowDown"].includes(key)
    ? 1
    : ["ArrowLeft", "ArrowUp"].includes(key)
      ? -1
      : 0;
  if (delta === 0) return null;
  const selectedIndex = Math.max(
    0,
    tasks.findIndex((task) => task.id === selectedTaskId),
  );
  return tasks[(selectedIndex + delta + tasks.length) % tasks.length].id;
}

function setupTask(item, sourceIndex, status) {
  const state = commandState(status);
  const attention = ["blocked", "interrupted"].includes(state);
  return task({
    kind: "setup",
    item,
    sourceIndex,
    rank: attention ? -20 : 10,
    attention,
    state,
    badge: attention ? "Needs recovery" : "Routine",
  });
}

function auditTask(item, sourceIndex) {
  const attention = auditNeedsAttention(item.status);
  return task({
    kind: "audit",
    item,
    sourceIndex,
    rank: attention ? -10 : 30,
    attention,
    state: attention ? "blocked" : "ready",
    badge: attention ? "Review" : "Current",
  });
}

function recoveryTask(item, sourceIndex, status) {
  const state = commandState(status);
  const attention = ["blocked", "interrupted"].includes(state);
  return task({
    kind: "recovery",
    item,
    sourceIndex,
    rank: attention ? -20 : 20,
    attention,
    state,
    badge: attention ? "Needs recovery" : "On demand",
  });
}

function task({ kind, item, sourceIndex, rank, attention, state, badge }) {
  const sourceId = String(item.id);
  const id = `${kind}:${sourceId}`;
  return Object.freeze({
    id,
    kind,
    sourceId,
    sourceIndex,
    rank,
    attention,
    state,
    badge,
    label: String(item.label),
    summary: String(item.value ?? item.status ?? "Review operator work"),
    item,
    testId: `admin-inbox-task-${kind}-${sourceId}`,
    panelTestId: `admin-inbox-panel-${kind}-${sourceId}`,
  });
}

function commandState(status) {
  if (status?.state === "interrupted") return "interrupted";
  if (status?.state === "reject") return "blocked";
  if (status?.state === "pending") return "pending";
  if (status?.state === "ack") return "updated";
  return "ready";
}

function auditNeedsAttention(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "") return true;
  return ["unavailable", "blocked", "fail", "missing", "stale", "reject", "error"]
    .some((marker) => value.includes(marker));
}

function parseAdminInboxUrl(url) {
  return url instanceof URL
    ? new URL(url.href)
    : new URL(String(url ?? "/admin"), "http://fmarch.local");
}
