// Cold Vite hydration and the first around-sequence recovery share the worker
// with every forced-full lane. Give only that initialization boundary a wider
// budget; in-page and history restorations retain Playwright's 30-second bound.
export const DURABLE_READING_CHECKPOINT_INITIALIZATION_TIMEOUT_MS = 90_000;
export const DURABLE_READING_CHECKPOINT_RESTORE_TIMEOUT_MS = 30_000;

const RESTORED_OFFSET_TOLERANCE_PX = 2;
const DIAGNOSTIC_CAPTURE_TIMEOUT_MS = 5_000;

export async function initializeReadingCheckpointClientsSequentially({
  clients,
  navigate,
  position,
  timeout = DURABLE_READING_CHECKPOINT_INITIALIZATION_TIMEOUT_MS,
  diagnosticContext,
}) {
  if (!Array.isArray(clients) || clients.length === 0) {
    throw new TypeError("reading checkpoint setup requires at least one client");
  }
  if (typeof navigate !== "function") {
    throw new TypeError("reading checkpoint setup requires a navigate function");
  }
  const expected = normalizePosition(position);
  // Each client must reach its saved position before the next client begins
  // hydration. The proof exercises cross-client convergence after this setup.
  for (const client of clients) {
    const label = String(client?.label ?? "unknown-client");
    if (!client?.page) {
      throw new TypeError(`reading checkpoint client ${label} is missing its page`);
    }
    try {
      await navigate(client.page, { label, timeout });
    } catch (cause) {
      await throwReadingCheckpointPhaseError(client.page, {
        cause,
        diagnosticContext,
        phase: `initial-navigation:${label}`,
        position: expected,
        timeout,
      });
    }
    await waitForReadingCheckpointRestoration(client.page, {
      diagnosticContext,
      phase: `initial-restore:${label}`,
      position: expected,
      timeout,
    });
  }
}

export async function waitForReadingCheckpointRestoration(page, {
  phase,
  position,
  timeout = DURABLE_READING_CHECKPOINT_RESTORE_TIMEOUT_MS,
  verifyOffset = true,
  diagnosticContext,
}) {
  const expected = normalizePosition(position);
  if (typeof phase !== "string" || phase.length === 0) {
    throw new TypeError("reading checkpoint restoration requires a phase label");
  }
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new TypeError("reading checkpoint restoration requires a positive timeout");
  }
  try {
    await page.waitForFunction(
      ({ sourceSeq, offsetPx, tolerancePx, verifyOffset }) => {
        const active = document.activeElement;
        return active?.id === `thread-post-${sourceSeq}`
          && (!verifyOffset
            || Math.abs(active.getBoundingClientRect().top - offsetPx) < tolerancePx);
      },
      {
        sourceSeq: expected.source_seq,
        offsetPx: expected.offset_px,
        tolerancePx: RESTORED_OFFSET_TOLERANCE_PX,
        verifyOffset,
      },
      { timeout },
    );
  } catch (cause) {
    await throwReadingCheckpointPhaseError(page, {
      cause,
      diagnosticContext,
      phase,
      position: expected,
      timeout,
      verifyOffset,
    });
  }
}

function normalizePosition(position) {
  if (!Number.isSafeInteger(position?.source_seq) || position.source_seq <= 0
    || !Number.isFinite(position?.offset_px)) {
    throw new TypeError("reading checkpoint restoration requires a valid position");
  }
  return {
    source_seq: position.source_seq,
    offset_px: position.offset_px,
  };
}

async function throwReadingCheckpointPhaseError(page, {
  cause,
  diagnosticContext,
  phase,
  position,
  timeout,
  verifyOffset = true,
}) {
  let browser;
  try {
    browser = await withDiagnosticDeadline(
      () => page.evaluate(({ source_seq: sourceSeq }) => {
        const active = document.activeElement;
        const expectedPost = document.getElementById(`thread-post-${sourceSeq}`);
        const thread = document.getElementById("player-thread");
        const recovery = document.querySelector('[data-testid="reader-recovery"]');
        const resume = document.querySelector('[data-testid="resume-saved-position"]');
        const elementState = element => element ? {
          id: element.id || null,
          testId: element.dataset?.testid ?? null,
          tagName: element.tagName,
          top: element.getBoundingClientRect().top,
          bottom: element.getBoundingClientRect().bottom,
        } : null;
        const relevantResources = performance.getEntriesByType("resource")
          .filter(entry => entry.name.includes("reading-checkpoint") || entry.name.includes("around_seq="))
          .slice(-12)
          .map(entry => ({
            durationMs: Math.round(entry.duration),
            name: entry.name,
            responseEndMs: Math.round(entry.responseEnd),
          }));
        return {
          active: elementState(active),
          document: {
            readyState: document.readyState,
            visibilityState: document.visibilityState,
          },
          expectedPost: elementState(expectedPost),
          historyState: history.state ?? null,
          navigationType: performance.getEntriesByType("navigation").at(-1)?.type ?? null,
          recovery: recovery ? {
            ariaBusy: recovery.getAttribute("aria-busy"),
            text: recovery.textContent?.trim().slice(0, 1_000) ?? "",
          } : null,
          relevantResources,
          resumeSavedPosition: elementState(resume),
          statusMessages: [...document.querySelectorAll('[role="status"]')]
            .map(element => element.textContent?.trim().slice(0, 500) ?? "")
            .filter(Boolean),
          thread: thread ? {
            postCount: thread.querySelectorAll('[id^="thread-post-"]').length,
            ...elementState(thread),
          } : null,
          url: location.href,
        };
      }, position),
      "browser diagnostic capture",
    );
  } catch (error) {
    browser = { captureError: describeError(error) };
  }

  let harness = null;
  try {
    harness = typeof diagnosticContext === "function"
      ? await withDiagnosticDeadline(
        () => diagnosticContext(),
        "harness diagnostic capture",
      )
      : null;
  } catch (error) {
    harness = { captureError: describeError(error) };
  }

  throw new Error(
    `durable reading checkpoint phase failed: ${JSON.stringify({
      browser,
      expected: position,
      harness,
      phase,
      timeoutMs: timeout,
      verifyOffset,
    })}`,
    { cause },
  );
}

async function withDiagnosticDeadline(operation, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${DIAGNOSTIC_CAPTURE_TIMEOUT_MS}ms`)),
          DIAGNOSTIC_CAPTURE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
