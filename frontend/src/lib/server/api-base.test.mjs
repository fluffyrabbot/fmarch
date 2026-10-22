import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { publicApiBaseUrl, serverApiBaseUrl } from "./api-base.mjs";

test("serverApiBaseUrl prefers the internal endpoint over the public one", () => {
  assert.equal(
    serverApiBaseUrl({
      FMARCH_API_INTERNAL_URL: "http://10.40.1.6",
      FMARCH_API_BASE_URL: "https://api.example.test",
    }),
    "http://10.40.1.6",
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
      /must be http:\/\/<RFC 1918 IPv4>/u,
      value,
    );
  }
  assert.throws(
    () =>
      serverApiBaseUrl({
        FMARCH_API_INTERNAL_URL: "http://127.0.0.1:4017",
        NODE_ENV: "production",
      }),
    /must be http:\/\/<RFC 1918 IPv4>/u,
  );
});

test("publicApiBaseUrl ignores the internal endpoint", () => {
  assert.equal(
    publicApiBaseUrl({
      FMARCH_API_INTERNAL_URL: "http://10.40.1.6",
      FMARCH_API_BASE_URL: "https://api.example.test/",
    }),
    "https://api.example.test",
  );
  assert.equal(
    publicApiBaseUrl({ FMARCH_API_INTERNAL_URL: "http://10.40.1.6" }),
    "",
  );
});

test("serverApiBaseUrl admits private IPv4 load balancers with an optional port", () => {
  for (const value of ["http://10.40.1.6", "http://172.16.0.9:8080", "http://192.168.1.2:80"]) {
    assert.equal(serverApiBaseUrl({ FMARCH_API_INTERNAL_URL: value, NODE_ENV: "production" }), value);
  }
});

test("serverApiBaseUrl rejects every near-match for the private load balancer", () => {
  for (const value of [
    "http://attacker.example:8080",
    "http://8.8.8.8",
    "http://172.32.0.1",
    "http://172.15.0.1",
    "http://192.169.1.1",
    "http://010.40.1.6",
    "http://10.40.1.256",
    "http://10.40.1",
    "https://10.40.1.6",
    "http://user@10.40.1.6",
    "http://10.40.1.6/",
    "http://10.40.1.6/path",
    "http://10.40.1.6?next=attacker",
    "http://10.40.1.6#attacker",
    "http://10.40.1.6:0",
    "http://10.40.1.6:65536",
    " http://10.40.1.6",
    "http://10.40.1.6 ",
    "http://fmarch.railway.internal:8080",
  ]) {
    assert.throws(
      () => serverApiBaseUrl({ FMARCH_API_INTERNAL_URL: value }),
      /must be http:\/\/<RFC 1918 IPv4>/u,
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
