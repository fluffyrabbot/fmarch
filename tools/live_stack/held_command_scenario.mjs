import { createHash } from "node:crypto";

// Delay an actual browser decision at the HTTP boundary. Live transport, health,
// authority and response handling remain real; continue() never replaces bytes.
export async function captureHeldBrowserPost(page, {
  game, kind, initialRecovery, trigger,
}) {
  if (initialRecovery?.hello?.kind !== "hello" ||
      initialRecovery.hello.state !== "recovered" ||
      initialRecovery.hello.body?.protocol_v !== 3 ||
      initialRecovery.game !== game || initialRecovery.channelId !== "main" ||
      initialRecovery.hello.body.scope?.game !== game ||
      initialRecovery.hello.body.scope?.channel !== "main" ||
      !Number.isSafeInteger(initialRecovery.eventCount) || initialRecovery.eventCount < 1) {
    throw new Error("held browser command requires recovered Hello for its game");
  }
  const invite = kind === "issuePlayerInvite";
  const matches = (url) => invite
    ? url.pathname === `/g/${game}/host` && url.searchParams.has("/issuePlayerInvite")
    : url.pathname === "/commands";
  let capturedRoute;
  let capture;
  let released = false;
  let disposed = false;
  let capturedAt;
  let resolveCapture;
  let rejectCapture;
  const captured = new Promise((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  });
  const handler = async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || capturedRoute) {
      await route.fallback();
      return;
    }
    const bytes = request.postDataBuffer();
    try {
      if (!bytes) throw new Error("held request has no original body");
      const body = invite ? null : request.postDataJSON();
      const command = body?.body?.body;
      if (!invite && (body?.v !== 3 || body.body?.kind !== "Command" ||
          command?.command?.[kind]?.game !== game ||
          typeof command.command_id !== "string")) {
        throw new Error(`unexpected held ${kind} command`);
      }
      capturedRoute = route;
      capturedAt = performance.now();
      capture = {
        status: "captured", game, kind, initialRecovery,
        commandId: command?.command_id ?? null,
        requestEnvelope: invite ? null : structuredClone(body),
        pathname: new URL(request.url()).pathname,
        bodySha256: createHash("sha256").update(bytes).digest("hex"),
        bodyBytes: bytes.length,
        ordering: ["captured-before-competing-command"],
      };
      resolveCapture();
    } catch (error) {
      await route.abort();
      rejectCapture(error);
    }
  };
  await page.route(matches, handler);
  const completion = Promise.resolve().then(trigger);
  // Observe rejection immediately, including a click failure before interception.
  completion.catch(rejectCapture);
  const deadline = setTimeout(() => rejectCapture(new Error(`no ${kind} browser POST captured`)), 15_000);
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      if (capturedRoute && !released) await capturedRoute.abort();
    } finally {
      await page.unroute(matches, handler);
    }
  };
  try {
    await captured;
  } catch (error) {
    await dispose();
    throw error;
  } finally {
    clearTimeout(deadline);
  }
  return {
    completion,
    dispose,
    async releaseAfter(competingOutcome) {
      const streamSeqs = competingOutcome?.streamSeqs;
      if (disposed || released || !Array.isArray(streamSeqs) || streamSeqs.length === 0 ||
          !streamSeqs.every((seq) => Number.isSafeInteger(seq) && seq > 0)) {
        throw new Error("held request requires one competing committed command before release");
      }
      capture.competingCommand = {
        commandId: competingOutcome.commandId ?? null,
        streamSeqs: [...streamSeqs],
      };
      capture.ordering.push("competing-command-acked");
      try {
        capture.releasedBodySha256 = createHash("sha256")
          .update(capturedRoute.request().postDataBuffer()).digest("hex");
        if (capture.releasedBodySha256 !== capture.bodySha256) {
          throw new Error("held browser request bytes changed before release");
        }
        // No URL, body, method or header overrides: this is the captured request.
        await capturedRoute.continue();
        released = true;
        capture.status = "released";
        capture.heldMilliseconds = performance.now() - capturedAt;
        capture.ordering.push("continued-unchanged");
      } finally {
        await dispose();
      }
      return structuredClone(capture);
    },
  };
}
