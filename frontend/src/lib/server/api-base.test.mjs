import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { publicApiBaseUrl, serverApiBaseUrl } from "./api-base.mjs";

test("serverApiBaseUrl prefers the internal endpoint over the public one", () => {
  assert.equal(
    serverApiBaseUrl({
      FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
      FMARCH_API_BASE_URL: "https://api.example.test",
    }),
    "http://fmarch.railway.internal:8080",
  );
});

test("serverApiBaseUrl falls back to the public endpoint and strips trailing slashes", () => {
  assert.equal(
    serverApiBaseUrl({ FMARCH_API_BASE_URL: "https://api.example.test/" }),
    "https://api.example.test",
  );
  assert.equal(serverApiBaseUrl({ FMARCH_API_INTERNAL_URL: "  " }), "");
  assert.equal(serverApiBaseUrl(undefined), "");
});

test("serverApiBaseUrl admits only an explicit non-production IPv4 loopback port", () => {
  assert.equal(
    serverApiBaseUrl({ FMARCH_API_INTERNAL_URL: "http://127.0.0.1:4017" }),
    "http://127.0.0.1:4017",
  );
  for (const value of [
    "http://localhost:4017",
    "http://127.0.0.2:4017",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:4017/",
  ]) {
    assert.throws(
      () => serverApiBaseUrl({ FMARCH_API_INTERNAL_URL: value }),
      /must be exactly http:\/\/fmarch\.railway\.internal:8080/u,
      value,
    );
  }
  assert.throws(
    () =>
      serverApiBaseUrl({
        FMARCH_API_INTERNAL_URL: "http://127.0.0.1:4017",
        NODE_ENV: "production",
      }),
    /must be exactly http:\/\/fmarch\.railway\.internal:8080/u,
  );
});

test("publicApiBaseUrl ignores the internal endpoint", () => {
  assert.equal(
    publicApiBaseUrl({
      FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
      FMARCH_API_BASE_URL: "https://api.example.test/",
    }),
    "https://api.example.test",
  );
  assert.equal(
    publicApiBaseUrl({ FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080" }),
    "",
  );
});

test("serverApiBaseUrl rejects every near-match for the Railway private host", () => {
  for (const value of [
    "http://attacker.example:8080",
    "http://fmarch.railway.internal:4000",
    "http://user@fmarch.railway.internal:8080",
    "http://fmarch.railway.internal:8080/path",
    "http://fmarch.railway.internal:8080?next=attacker",
    "http://fmarch.railway.internal:8080#attacker",
    "http://fmarch.railway.internal:8080/",
    " http://fmarch.railway.internal:8080",
    "http://fmarch.railway.internal:8080 ",
  ]) {
    assert.throws(
      () => serverApiBaseUrl({ FMARCH_API_INTERNAL_URL: value }),
      /must be exactly http:\/\/fmarch\.railway\.internal:8080/u,
      value,
    );
  }
});

test("public API bases are root origins and production requires HTTPS", () => {
  assert.equal(
    serverApiBaseUrl({ FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" }),
    "http://127.0.0.1:4017",
  );
  for (const env of [
    { FMARCH_API_BASE_URL: "https://user@api.example.test" },
    { FMARCH_API_BASE_URL: "https://api.example.test/path" },
    { FMARCH_API_BASE_URL: "https://api.example.test?query=1" },
    { FMARCH_API_BASE_URL: "http://api.example.test", NODE_ENV: "production" },
  ]) {
    assert.throws(() => serverApiBaseUrl(env), /FMARCH_API_BASE_URL must/u);
  }
});

test("server route modules resolve API authority through the validated owner", async () => {
  const routeRoot = new URL("../../routes/", import.meta.url);
  const entries = await readdir(routeRoot, { recursive: true });
  const serverRoutes = entries.filter(
    (entry) => entry.endsWith("+page.server.js") || entry.endsWith("+server.js"),
  );
  assert(serverRoutes.length > 0);
  for (const route of serverRoutes) {
    const source = await readFile(new URL(route, routeRoot), "utf8");
    assert.doesNotMatch(
      source,
      /process\.env\.FMARCH_API_(?:INTERNAL_)?BASE_URL/u,
      `${route} bypasses serverApiBaseUrl/publicApiBaseUrl`,
    );
  }
});
