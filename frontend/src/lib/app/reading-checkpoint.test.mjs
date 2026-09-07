import assert from "node:assert/strict";
import { test } from "node:test";
import { createReadingCheckpoint, checkpointView } from "./reading-checkpoint.mjs";
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(body) });
const position = n => ({ source_seq: n, offset_px: 100 });
const options = { game: "g", channel: "main", principal: "p", windowRef: null, documentRef: null, BroadcastChannelImpl: null };
test("two readers converge without moving the active peer, and conflicts require fresh intent", async () => {
  let server = { revision: 0, position: null, available: false };
  const writes = [], resumed = [];
  const fetchImpl = async (_, init) => {
    if (init.method !== "POST") return response(server);
    const input = JSON.parse(init.body); writes.push(input);
    if (input.expected_revision !== server.revision) return response(server, 409);
    server = { revision: server.revision + 1, position: input.position, available: true };
    return response(server);
  };
  const a = createReadingCheckpoint({ ...options, fetchImpl });
  const b = createReadingCheckpoint({ ...options, fetchImpl, onInitial: value => resumed.push(value) });
  await a.refresh(); await b.refresh();
  a.save(position(20)); await settle();
  b.save(position(10)); await settle();
  assert.equal(server.position.source_seq, 20);
  assert.equal(writes.length, 2);
  await b.refresh(); assert.equal(resumed.length, 1);
  b.save(position(10)); await settle();
  assert.equal(server.position.source_seq, 10); assert.equal(server.revision, 2);
  a.dispose(); b.dispose();
});
test("revocation fences an in-flight write and clears queued private positions", async () => {
  let finish, revoke = false, denied = 0, calls = 0;
  const controller = createReadingCheckpoint({ ...options, onDenied: () => ++denied,
    fetchImpl: async (_, init) => {
      if (init.method === "POST") { ++calls; return new Promise(resolve => { finish = resolve; }); }
      return revoke ? response({}, 403) : response({ revision: 1, position: position(20), available: true });
    } });
  await controller.refresh(); controller.save(position(30)); controller.save(position(40));
  revoke = true; await controller.refresh();
  finish(response({ revision: 2, position: position(30), available: true })); await settle();
  controller.save(position(50)); await settle();
  assert.equal(denied, 1); assert.equal(calls, 1); controller.dispose();
});
test("unavailable destinations retain only position metadata, and user input wins a slow initial load", async () => {
  let resume = 0;
  const controller = createReadingCheckpoint({ ...options, onInitial: () => ++resume,
    fetchImpl: async () => response({ revision: 2, position: position(10), available: false }) });
  controller.interruptResume(); await controller.refresh(); assert.equal(resume, 0); controller.dispose();
  assert.throws(() => checkpointView({ revision: 0, position: position(10), available: true }));
  assert.throws(() => checkpointView({ revision: 1, position: position(Number.MAX_SAFE_INTEGER + 1), available: true }));
});

test("a queued gesture cannot inherit a newer peer revision from an in-flight save response", async () => {
  let finish, calls = 0;
  const controller = createReadingCheckpoint({ ...options,
    fetchImpl: async (_, init) => {
      if (init.method === "POST") { ++calls; return new Promise(resolve => { finish = resolve; }); }
      return response({ revision: 1, position: position(10), available: true });
    } });
  await controller.refresh(); controller.save(position(20)); controller.save(position(30));
  finish(response({ revision: 3, position: position(40), available: true })); await settle();
  assert.equal(calls, 1); controller.dispose();
});
