import assert from "node:assert/strict";
import test from "node:test";

import { runBoundedProcess } from "./proof_process.mjs";

test("bounded proof processes return only after successful exit", async () => {
  const output = await runBoundedProcess(
    process.execPath,
    ["-e", "process.stdout.write('bounded-ok')"],
    { timeoutMs: 2_000 },
  );
  assert.equal(output, "bounded-ok");
});

test("bounded proof processes kill and join a child that exceeds its budget", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      runBoundedProcess(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
        { timeoutMs: 250, terminationGraceMs: 50 },
      ),
    /exceeded 250ms and was terminated/u,
  );
  assert.ok(Date.now() - startedAt < 2_000, "hung child was not reaped promptly");
});
