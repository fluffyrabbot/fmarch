import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeSchemaDump } from "./database_schema_snapshot.mjs";

test("schema dump normalization removes host-version and random restriction noise", () => {
  const dump = `-- PostgreSQL database dump\n-- Dumped from database version 16.15\n-- Dumped by pg_dump version 17.2\n\\restrict random-token\n\nCREATE TABLE public.example (id bigint);\n\n\\unrestrict random-token\n-- PostgreSQL database dump complete\n`;
  const normalized = normalizeSchemaDump(dump, 3);
  assert.match(normalized, /fmarch epoch 3/);
  assert.match(normalized, /CREATE TABLE public\.example/);
  assert.doesNotMatch(normalized, /16\.15|17\.2|random-token/);
});
