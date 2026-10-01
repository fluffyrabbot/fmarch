import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { createCompletedExportFetchObserver } from "./completed_game_export_fetch.mjs";

const exportUrl = "http://127.0.0.1:1234/games/fixture/export";
const sessionToken = "host-proof-session";
const headers = { authorization: `Bearer ${sessionToken}` };

test("real independent exports may differ while observation matches the exact live loader response", async t => {
  let count = 0;
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/games/fixture/export");
    assert.equal(request.headers.authorization, headers.authorization);
    count++;
    const nonce = randomBytes(24).toString("base64");
    const manifest = { version: 3, stream_keys: [{ nonce }], events: [{ kind: "GameCompleted" }] };
    manifest.checksum_sha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    response.writeHead(200, { "content-type": "application/json", "x-export-request": String(count) });
    response.end(JSON.stringify(manifest));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/games/fixture/export`;
  const independentManifest = await (await fetch(url, { headers })).json();
  let originalResponse;
  const observer = createCompletedExportFetchObserver({ exportUrl: url, sessionToken, fetchImpl: async (...args) => {
    originalResponse = await fetch(...args);
    return originalResponse;
  } });
  const loaderResponse = await observer.fetch(new Request(url, { headers }));
  assert.equal(loaderResponse, originalResponse, "observer must return the same live response object");
  assert.equal(loaderResponse.status, 200);
  assert.equal(loaderResponse.headers.get("x-export-request"), "2");
  const loaderManifest = await loaderResponse.json();
  const observedManifest = await observer.manifest();
  assert.equal(count, 2, "observer must not issue an extra export or replay a prior response");
  assert.notEqual(independentManifest.stream_keys[0].nonce, loaderManifest.stream_keys[0].nonce);
  assert.notEqual(independentManifest.checksum_sha256, loaderManifest.checksum_sha256);
  assert.deepEqual(observedManifest, loaderManifest);
});

test("only the exact GET URL and host bearer credential identify the loader export", async () => {
  const forwarded = [];
  const observer = createCompletedExportFetchObserver({ exportUrl, sessionToken, fetchImpl: async (input, init) => {
    forwarded.push([input, init]);
    return Response.json({ checksum_sha256: "live-response" });
  } });
  const requests = [
    [exportUrl.replace("fixture", "foreign"), { headers }],
    [exportUrl, { method: "POST", headers }],
    [exportUrl, { headers: { authorization: "Bearer another-host" } }],
    [exportUrl, {}],
    [exportUrl + "?other=1", { headers }],
  ];
  for (const args of requests) await observer.fetch(...args);
  await assert.rejects(observer.manifest(), /observed 0/);
  const request = new Request(exportUrl, { headers });
  const init = { method: "GET" };
  const response = await observer.fetch(request, init);
  assert.equal(forwarded.at(-1)[0], request);
  assert.equal(forwarded.at(-1)[1], init);
  assert.deepEqual(await response.json(), await observer.manifest());
});

test("duplicate matching exports are rejected instead of silently choosing a nonce", async () => {
  const observer = createCompletedExportFetchObserver({ exportUrl, sessionToken, fetchImpl: async () => Response.json({ version: 3 }) });
  await Promise.all([observer.fetch(exportUrl, { headers }), observer.fetch(exportUrl, { headers })]);
  await assert.rejects(observer.manifest(), /observed 2/);
});

test("failed HTTP responses and malformed manifest bodies cannot become accepted observations", async () => {
  for (const response of [new Response("unavailable", { status: 503 }), new Response("bad JSON"), Response.json(null), Response.json([])]) {
    const observer = createCompletedExportFetchObserver({ exportUrl, sessionToken, fetchImpl: async () => response });
    assert.equal(await observer.fetch(exportUrl, { headers }), response);
    await assert.rejects(observer.manifest());
  }
});

test("observation caps cloned bytes while leaving the real response body intact", async () => {
  const manifest = { nonce: "x".repeat(100) };
  const response = Response.json(manifest);
  const observer = createCompletedExportFetchObserver({ exportUrl, sessionToken, maxBytes: 16, fetchImpl: async () => response });
  assert.equal(await observer.fetch(exportUrl, { headers }), response);
  await assert.rejects(observer.manifest(), /byte limit/);
  assert.deepEqual(await response.json(), manifest);
});

test("observation bounds a stalled clone and cancels only its own body branch", async () => {
  let sourceCancelled = false;
  const response = new Response(new ReadableStream({ cancel() { sourceCancelled = true; } }));
  const observer = createCompletedExportFetchObserver({ exportUrl, sessionToken, timeoutMs: 10, fetchImpl: async () => response });
  await observer.fetch(exportUrl, { headers });
  await assert.rejects(observer.manifest(), /timed out/);
  assert.equal(sourceCancelled, false, "observing a clone must not cancel the loader's branch");
  await response.body.cancel();
  assert.equal(sourceCancelled, true);
});
