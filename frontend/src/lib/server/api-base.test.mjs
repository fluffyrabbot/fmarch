import assert from "node:assert/strict";
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
