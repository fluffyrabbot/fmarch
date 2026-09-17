import assert from "node:assert/strict";
import { normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";

export function assertHostDeadlineCommand({ game, before, commandStatus, rejectedCommandStatus }) {
  const decoded = normalizeCommandResponse({
    commandId: commandStatus.commandId,
    requestEnvelope: commandStatus.requestEnvelope,
    response: { status: commandStatus.httpStatus },
    serverEnvelope: commandStatus.serverEnvelope,
  });
  assert.equal(decoded.state, "ack");
  assert.equal(commandStatus.state, "ack");
  assert.deepEqual(commandStatus.streamSeqs, decoded.streamSeqs);
  assert.ok(decoded.streamSeqs.length > 0);
  const command = commandStatus.requestEnvelope.body.body.command.ExtendDeadline;
  assert.equal(command.game, game);
  assert.equal(command.phase, before.phase.id);
  assert.ok(Number.isSafeInteger(command.at) && command.at > 0);
  assert.notEqual(command.at, before.phase.deadline, "the deadline command must change the prior value");
  if (before.phase.deadline !== null && before.phase.deadline !== undefined) {
    assert.equal(command.at, before.phase.deadline + 24 * 3600);
  }
  // The rejected attempt was the real same control with no committed mutation.
  // Retain that offered target instead of a retired fixture clock or timestamp.
  assert.equal(rejectedCommandStatus.state, "reject");
  assert.equal(rejectedCommandStatus.error, "StreamConflict");
  assert.equal(rejectedCommandStatus.retryable, true);
  assert.deepEqual(command, rejectedCommandStatus.requestEnvelope.body.body.command.ExtendDeadline);
  return command;
}

export async function waitForHostDeadlineDelivery({ page, game, before, commandStatus, rejectedCommandStatus, readApiPhase, diagnostics }) {
  let command;
  let apiPhase;
  try {
    command = assertHostDeadlineCommand({ game, before, commandStatus, rejectedCommandStatus });
    const boundary = { eventCount: before.eventCount, command };
    await page.waitForFunction(selectHostDeadlineDelivery, boundary);
    const delivery = await page.evaluate(selectHostDeadlineDelivery, boundary);
    assert.ok(delivery);
    apiPhase = await readApiPhase();
    assertHostDeadlineApiPhase(apiPhase, command);
    const renderedLabel = (await page.getByTestId("host-console-deadline").textContent()).trim();
    // Match the route's explicit Pacific date/time display in the browser's own
    // locale implementation, with the committed epoch as the sole date input.
    const expectedLabel = await page.evaluate((at) => new Date(at * 1000).toLocaleString("en-US", {
      dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles",
    }), command.at);
    assert.equal(renderedLabel, expectedLabel);
    return { status: "passed", before, commandStatus, rejectedCommandStatus, command, delivery, apiPhase, renderedLabel, expectedLabel };
  } catch (error) {
    const after = await page.evaluate((eventCount) => ({
      phase: window.__fmarchHostProjection?.phase,
      health: window.__fmarchHostLiveProjectionStatus,
      metrics: window.__fmarchGetHostLiveProjectionMetrics?.() ?? null,
      eventsSinceBoundary: (window.__fmarchHostLiveProjectionEvents ?? []).slice(eventCount),
    }), before.eventCount).catch((readError) => ({ snapshotError: String(readError) }));
    apiPhase ??= await readApiPhase().catch((readError) => ({ readError: String(readError) }));
    throw new Error(`host deadline live delivery failed: ${JSON.stringify({ game, before, commandStatus, rejectedCommandStatus, command, after, apiPhase, network: diagnostics() })}`, { cause: error });
  }
}

export function selectHostDeadlineDelivery({ eventCount, command }) {
  const events = window.__fmarchHostLiveProjectionEvents ?? [];
  const observedEventIndex = events.findIndex((event, index) => index >= eventCount &&
    event?.delta?.kind === "HostConsoleHeaderChanged" && event.delta.body?.game === command.game &&
    event.delta.body?.phase?.phase_id === command.phase && event.delta.body.phase.deadline === command.at);
  const phase = window.__fmarchHostProjection?.phase;
  if (observedEventIndex < 0 || phase?.id !== command.phase || phase.deadline !== command.at) return null;
  return { observedEventIndex, event: events[observedEventIndex], phase };
}

export function assertHostDeadlineApiPhase(phase, command) {
  assert.equal(phase.phase_id, command.phase);
  assert.equal(phase.deadline, command.at);
}
