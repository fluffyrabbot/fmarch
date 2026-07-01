import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createUnexpectedMediaResponseGuard } from "./dev_test_game_media_response_guard.mjs";

test("media response guard fails unexpected local media 404s", () => {
  const guard = createUnexpectedMediaResponseGuard({ label: "fixture-proof" });
  const context = new EventEmitter();
  guard.attachContext(context);

  context.emit("response", responseFor("http://localhost/media/midsummer/thread/missing.png", {
    status: 404,
    ok: false,
  }));

  assert.throws(
    () => guard.assertNoUnexpectedMedia404(),
    /fixture-proof observed unexpected local media 404 responses/,
  );
  assert.deepEqual(guard.summary(), {
    status: "failed",
    boundary:
      "Seeded browser proof fails when a local /media/* request returns 404; intentional denied media remains represented by non-404 status-specific assertions.",
    mediaResponseCount: 1,
    unexpectedMedia404Count: 1,
    unexpectedMedia404s: [
      {
        url: "http://localhost/media/midsummer/thread/missing.png",
        pathname: "/media/midsummer/thread/missing.png",
        status: 404,
        ok: false,
        method: "GET",
        resourceType: "image",
        pageUrl: "http://localhost/g/midsummer",
      },
    ],
  });
});

test("media response guard allows non-media and intentional denied media", () => {
  const guard = createUnexpectedMediaResponseGuard();
  const context = new EventEmitter();
  guard.attachContext(context);

  context.emit("response", responseFor("http://localhost/not-media/missing.png", {
    status: 404,
    ok: false,
  }));
  context.emit("response", responseFor("http://localhost/media/private/denied.png", {
    status: 403,
    ok: false,
  }));
  context.emit("response", responseFor("http://localhost/media/midsummer/thread/receipt.png", {
    status: 200,
    ok: true,
  }));

  guard.assertNoUnexpectedMedia404();
  assert.deepEqual(guard.summary(), {
    status: "passed",
    boundary:
      "Seeded browser proof fails when a local /media/* request returns 404; intentional denied media remains represented by non-404 status-specific assertions.",
    mediaResponseCount: 2,
    unexpectedMedia404Count: 0,
    unexpectedMedia404s: [],
  });
});

test("media response guard patches future browser contexts and pages", async () => {
  const context = new EventEmitter();
  context.pages = () => [];
  const page = new EventEmitter();
  page.context = () => context;
  const browser = {
    async newContext() {
      return context;
    },
    async newPage() {
      return page;
    },
  };
  const guard = createUnexpectedMediaResponseGuard();
  guard.attachBrowser(browser);

  const patchedContext = await browser.newContext();
  const patchedPage = await browser.newPage();
  patchedContext.emit("response", responseFor("http://localhost/media/ok.png", {
    status: 200,
    ok: true,
  }));
  patchedPage.emit("response", responseFor("http://localhost/media/also-ok.png", {
    status: 200,
    ok: true,
  }));

  guard.assertNoUnexpectedMedia404();
  assert.equal(guard.summary().mediaResponseCount, 2);
});

function responseFor(url, { status, ok }) {
  return {
    url: () => url,
    status: () => status,
    ok: () => ok,
    request: () => ({
      method: () => "GET",
      resourceType: () => "image",
    }),
    frame: () => ({
      page: () => ({
        url: () => "http://localhost/g/midsummer",
      }),
    }),
  };
}
