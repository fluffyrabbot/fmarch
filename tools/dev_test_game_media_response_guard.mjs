const browserPatchSymbol = Symbol.for("fmarch.devTestGame.mediaResponseGuard.browserPatch");

export function createUnexpectedMediaResponseGuard({
  label = "dev-test-game-browser-proof",
  allow = [],
} = {}) {
  const seenResponses = new WeakSet();
  const attachedContexts = new WeakSet();
  const attachedPages = new WeakSet();
  const mediaResponses = [];
  const unexpectedMedia404s = [];

  function recordResponse(response) {
    if (response === null || typeof response !== "object") {
      return;
    }
    if (seenResponses.has(response)) {
      return;
    }
    seenResponses.add(response);
    const record = mediaResponseRecord(response);
    if (record === null) {
      return;
    }
    mediaResponses.push(record);
    if (record.status === 404 && !isAllowedMedia404(record, allow)) {
      unexpectedMedia404s.push(record);
    }
  }

  function attachContext(context) {
    if (
      context === null ||
      typeof context !== "object" ||
      typeof context.on !== "function" ||
      attachedContexts.has(context)
    ) {
      return context;
    }
    attachedContexts.add(context);
    context.on("response", recordResponse);
    if (typeof context.pages === "function") {
      for (const page of context.pages()) {
        attachPage(page);
      }
    }
    return context;
  }

  function attachPage(page) {
    if (
      page === null ||
      typeof page !== "object" ||
      typeof page.on !== "function" ||
      attachedPages.has(page)
    ) {
      return page;
    }
    attachedPages.add(page);
    page.on("response", recordResponse);
    if (typeof page.context === "function") {
      attachContext(page.context());
    }
    return page;
  }

  function attachBrowser(browser) {
    if (browser === null || typeof browser !== "object") {
      return browser;
    }
    if (browser[browserPatchSymbol] === true) {
      return browser;
    }
    Object.defineProperty(browser, browserPatchSymbol, {
      value: true,
      enumerable: false,
    });
    if (typeof browser.newContext === "function") {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => attachContext(await newContext(...args));
    }
    if (typeof browser.newPage === "function") {
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async (...args) => attachPage(await newPage(...args));
    }
    return browser;
  }

  function assertNoUnexpectedMedia404({ phase = label } = {}) {
    if (unexpectedMedia404s.length === 0) {
      return;
    }
    throw new Error(
      `${phase} observed unexpected local media 404 responses: ${JSON.stringify(
        unexpectedMedia404s,
      )}`,
    );
  }

  function summary() {
    return Object.freeze({
      status: unexpectedMedia404s.length === 0 ? "passed" : "failed",
      boundary:
        "Seeded browser proof fails when a local /media/* request returns 404; intentional denied media remains represented by non-404 status-specific assertions.",
      mediaResponseCount: mediaResponses.length,
      unexpectedMedia404Count: unexpectedMedia404s.length,
      unexpectedMedia404s: unexpectedMedia404s.map((record) => ({ ...record })),
    });
  }

  return Object.freeze({
    attachBrowser,
    attachContext,
    attachPage,
    assertNoUnexpectedMedia404,
    summary,
  });
}

function mediaResponseRecord(response) {
  const url = response.url?.();
  if (typeof url !== "string") {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith("/media/")) {
    return null;
  }
  const request = response.request?.();
  return Object.freeze({
    url,
    pathname: parsed.pathname,
    status: response.status?.() ?? null,
    ok: response.ok?.() ?? null,
    method: request?.method?.() ?? null,
    resourceType: request?.resourceType?.() ?? null,
    pageUrl: pageUrlForResponse(response),
  });
}

function pageUrlForResponse(response) {
  try {
    return response.frame?.()?.page?.()?.url?.() ?? null;
  } catch {
    return null;
  }
}

function isAllowedMedia404(record, allow) {
  return allow.some((entry) => {
    if (typeof entry === "function") {
      return entry(record) === true;
    }
    if (entry instanceof RegExp) {
      return entry.test(record.pathname);
    }
    return typeof entry === "string" && entry === record.pathname;
  });
}
