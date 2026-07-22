export function hostCommandStatusMessage(status, actionLabel = "Action") {
  if (status === undefined || status === null) return "";
  if (status.state === "pending") return `${actionLabel} is in progress.`;
  if (status.state === "interrupted") {
    return String(status.message ?? `${actionLabel} was interrupted.`);
  }
  if (status.state === "ack") return `${actionLabel} completed.`;
  if (status.state === "reject") {
    return status.retryable === true
      ? `${actionLabel} could not be completed. Refresh and try again.`
      : `${actionLabel} could not be completed.`;
  }
  return `${actionLabel} updated.`;
}

export function visibleHostCommandStatus(status, actionLabel = "Action") {
  if (status === undefined || status === null) return null;
  return Object.freeze({
    ...status,
    message: hostCommandStatusMessage(status, actionLabel),
  });
}
