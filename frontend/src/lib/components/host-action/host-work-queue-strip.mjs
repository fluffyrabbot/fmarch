// The decision queue: every task the game is waiting on the host for, in
// posture order. Below the rail width it is a strip under the host bar and a
// chosen task opens as a sheet; from the rail width up it heads the rail
// above the decision canvas (usage-frequency audit, decision 11).
export const HOST_WORK_QUEUE_STRIP_CONTRACT = Object.freeze({
  rootClassName: "host-task-queue",
  componentName: "host-task-queue",
  rootTestId: "host-task-queue",
  summaryTestId: "host-task-queue-summary",
  thumbZone: "moderator-primary-actions",
  taskMinBlockPx: 44,
});

export function buildHostWorkQueueStripViewModel({
  decisions = [],
  selectedTaskId = null,
  attentionCount = decisions.length,
  summary = "Nothing needs you right now",
  layout = "strip",
} = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: HOST_WORK_QUEUE_STRIP_CONTRACT.rootClassName,
      ariaLabel: "Host task queue",
      testId: HOST_WORK_QUEUE_STRIP_CONTRACT.rootTestId,
      data: Object.freeze({
        component: HOST_WORK_QUEUE_STRIP_CONTRACT.componentName,
        thumbZone: HOST_WORK_QUEUE_STRIP_CONTRACT.thumbZone,
        layout,
      }),
    }),
    summary: Object.freeze({
      testId: HOST_WORK_QUEUE_STRIP_CONTRACT.summaryTestId,
      label: "Host queue",
      attentionCount,
      attentionLabel: `${attentionCount} decision${attentionCount === 1 ? "" : "s"} need attention`,
      text: summary,
    }),
    tasks: Object.freeze(
      decisions.map((task) =>
        Object.freeze({
          id: task.id,
          kind: task.kind,
          sourceId: task.sourceId ?? null,
          label: task.label,
          meta: task.meta,
          urgency: task.urgency,
          urgencyLabel: task.urgencyLabel,
          state: task.state,
          testId: task.testId,
          selected: task.id === selectedTaskId,
          minBlockPx: HOST_WORK_QUEUE_STRIP_CONTRACT.taskMinBlockPx,
        }),
      ),
    ),
  });
}
