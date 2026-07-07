export const HOST_WORK_QUEUE_STRIP_CONTRACT = Object.freeze({
  rootClassName: "host-console-critical-path__queues",
  queueClassName: "host-console-critical-path__queue fm-section",
  componentName: "host-work-queue-strip",
  minQueueBlockPx: 112,
});

export function buildHostWorkQueueStripViewModel({ queues = [] } = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: HOST_WORK_QUEUE_STRIP_CONTRACT.rootClassName,
      ariaLabel: "Host queues",
      data: Object.freeze({
        component: HOST_WORK_QUEUE_STRIP_CONTRACT.componentName,
      }),
    }),
    queues: Object.freeze(
      queues.map((queue) =>
        Object.freeze({
          id: String(queue.id ?? "queue"),
          label: String(queue.label ?? "Queue"),
          value: String(queue.value ?? "No work queued"),
          className: HOST_WORK_QUEUE_STRIP_CONTRACT.queueClassName,
          testId: `host-work-queue-${stableId(queue.id ?? queue.label ?? "queue")}`,
          minBlockPx: HOST_WORK_QUEUE_STRIP_CONTRACT.minQueueBlockPx,
        }),
      ),
    ),
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

function stableId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
}
