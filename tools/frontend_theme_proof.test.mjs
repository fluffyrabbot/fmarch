import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { nativeMediaSetupPolicy, setPreferenceSystemScheme, setSystemScheme } from "./frontend_theme_proof.mjs";

function nativeMediaPage({ lostDarkOverrides = 0, failEvaluate, failEmulation } = {}) {
  let elapsed = 0;
  let nativeScheme = "light";
  let protocolScheme = "dark";
  let applicationReads = 0;
  const emulations = [];
  const observations = [];
  const application = { palette: "day" };
  const world = {
    location: { href: "http://127.0.0.1:1234/appearance" },
    document: {
      readyState: "complete",
      visibilityState: "visible",
      querySelector() {
        applicationReads += 1;
        throw new Error("native setup must not read or modify application state");
      },
    },
    matchMedia(query) {
      return { matches: query === `(prefers-color-scheme: ${nativeScheme})` };
    },
  };
  const evaluate = (fn, argument) => runInNewContext(`(${fn.toString()})(argument)`, { ...world, argument });
  const page = {
    async evaluate(fn) {
      if (failEvaluate) throw failEvaluate;
      return evaluate(fn);
    },
    async emulateMedia({ colorScheme }) {
      emulations.push(colorScheme);
      if (failEmulation) return await failEmulation();
      // The pinned Firefox resolves a cleared page override to its dark
      // context. Reassigning that unchanged override can leave native state
      // stale; an actual opposite transition forces a new native setting.
      const effective = colorScheme ?? "dark";
      if (effective !== protocolScheme) {
        if (effective === "dark" && lostDarkOverrides > 0) lostDarkOverrides -= 1;
        else nativeScheme = effective;
      }
      protocolScheme = effective;
    },
    async waitForFunction(fn, argument, { timeout, polling }) {
      observations.push({ requested: argument, timeout, polling });
      if (evaluate(fn, argument)) return;
      elapsed += timeout;
      const error = new Error(`native ${argument} media did not converge`);
      error.name = "TimeoutError";
      throw error;
    },
  };
  return { page, emulations, observations, application, now: () => elapsed, applicationReads: () => applicationReads };
}

test("native media setup observes an opposite transition instead of resetting to the context preference", async () => {
  const fake = nativeMediaPage();
  await fake.page.emulateMedia({ colorScheme: null });
  await fake.page.emulateMedia({ colorScheme: "dark" });
  await assert.rejects(fake.page.waitForFunction(
    scheme => matchMedia(`(prefers-color-scheme: ${scheme})`).matches,
    "dark",
    { timeout: 1 },
  ), /did not converge/);

  const result = await setSystemScheme(fake.page, "dark", { now: fake.now });
  assert.deepEqual(fake.emulations, [null, "dark", "light", "dark"]);
  assert.deepEqual(fake.observations.slice(-2).map(item => item.requested), ["light", "dark"]);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].opposite.light, true);
  assert.equal(result.attempts[0].requested.dark, true);
});

test("native media convergence retries only a lost native override within the original deadline", async () => {
  const fake = nativeMediaPage({ lostDarkOverrides: 1 });
  const result = await setSystemScheme(fake.page, "dark", { now: fake.now });
  assert.deepEqual(fake.emulations, ["light", "dark", "light", "dark"]);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].stage, "observe-requested");
  assert.equal(result.attempts[0].afterFailure.light, true);
  assert.equal(result.attempts[1].stage, "complete");
  assert.equal(result.elapsedMs, 10_000);
  for (const record of result.attempts) {
    assert.equal(record.before.url, "http://127.0.0.1:1234/appearance");
    assert.equal(record.before.readyState, "complete");
    assert.equal(record.before.visibilityState, "visible");
  }
});

test("the final system preference change observes native dark to light", async () => {
  const fake = nativeMediaPage();
  await setSystemScheme(fake.page, "dark", { now: fake.now });
  const result = await setSystemScheme(fake.page, "light", { now: fake.now });
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].opposite.dark, true);
  assert.equal(result.attempts[0].requested.light, true);
  assert.deepEqual(fake.observations.slice(-2).map(item => item.requested), ["dark", "light"]);
});

test("permanent native mismatch fails after bounded attempts without extending the total deadline", async () => {
  const fake = nativeMediaPage({ lostDarkOverrides: Infinity });
  await assert.rejects(setSystemScheme(fake.page, "dark", { now: fake.now }), error => {
    assert.equal(error.name, "NativeMediaSetupError");
    assert.equal(error.mediaDiagnostics.attempts.length, nativeMediaSetupPolicy.maxAttempts);
    assert.equal(error.mediaDiagnostics.elapsedMs, nativeMediaSetupPolicy.timeoutMs);
    assert.equal(error.mediaDiagnostics.attempts.at(-1).stage, "observe-requested");
    assert.equal(fake.emulations.length, 6);
    return true;
  });
});

test("transport and closed-page failures are not retried as native mismatches", async () => {
  for (const options of [
    { failEvaluate: new Error("page closed") },
    { failEmulation: async () => { throw new Error("transport disconnected"); } },
  ]) {
    const fake = nativeMediaPage(options);
    await assert.rejects(setSystemScheme(fake.page, "dark", { now: fake.now }), error => {
      assert.match(error.cause.message, /page closed|transport disconnected/);
      assert.equal(error.mediaDiagnostics.attempts.length, 1);
      assert.ok(fake.emulations.length <= 1);
      return true;
    });
  }
});

test("one overall watchdog bounds stalled native transport", async () => {
  const fake = nativeMediaPage({ failEmulation: () => new Promise(() => {}) });
  await assert.rejects(setSystemScheme(fake.page, "dark", { timeoutMs: 20 }), error => {
    assert.equal(error.cause.name, "NativeMediaDeadlineError");
    assert.equal(error.mediaDiagnostics.attempts.length, 1);
    assert.equal(fake.emulations.length, 1);
    return true;
  });
  await assert.rejects(setSystemScheme(fake.page, "dark", { timeoutMs: 30_001 }), /overall deadline/);
});

test("native diagnostics cannot keep a failed page alive beyond the setup deadline", async () => {
  const fake = nativeMediaPage();
  fake.page.evaluate = () => new Promise(() => {});
  await assert.rejects(setSystemScheme(fake.page, "dark", { timeoutMs: 20 }), error => {
    assert.equal(error.cause.name, "NativeMediaDeadlineError");
    assert.equal(error.mediaDiagnostics.attempts.length, 1);
    assert.equal(error.mediaDiagnostics.attempts[0].stage, "inspect");
    assert.deepEqual(fake.emulations, []);
    return true;
  });
});

test("native setup neither substitutes application palette assertions nor modifies application state", async () => {
  const fake = nativeMediaPage();
  await setSystemScheme(fake.page, "dark", { now: fake.now });
  assert.equal(fake.applicationReads(), 0);
  assert.equal(fake.application.palette, "day");
  assert.throws(() => assert.equal(fake.application.palette, "night"));

  const mismatched = nativeMediaPage({ lostDarkOverrides: Infinity });
  mismatched.application.palette = "night";
  await assert.rejects(setSystemScheme(mismatched.page, "dark", { now: mismatched.now }), /Native dark media setup failed/);
  assert.equal(mismatched.applicationReads(), 0);
});

test("native preference failures retain the exact step and a bounded screenshot artifact", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fmarch-theme-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [preference, step, requested] of [["light", "appearance", "dark"], ["system", "change", "light"]]) {
    const fake = nativeMediaPage({ failEmulation: async () => { throw new Error("transport disconnected"); } });
    fake.page.isClosed = () => false;
    fake.page.screenshot = async options => {
      assert.equal(options.timeout, 2_000);
      assert.equal(options.fullPage, true);
      await writeFile(options.path, "captured fixture");
    };
    await assert.rejects(setPreferenceSystemScheme(fake.page, { preference, step, requested, directory }), error => {
      assert.equal(error.cause.message, "transport disconnected");
      return true;
    });
    const file = `preference-${preference}-${step}-media-failure`;
    const report = JSON.parse(await readFile(path.join(directory, `${file}.json`), "utf8"));
    assert.equal(report.preference, preference);
    assert.equal(report.step, step);
    assert.equal(report.requested, requested);
    assert.equal(report.nativeMedia.attempts[0].before.readyState, "complete");
    assert.equal(report.screenshot, `${file}.png`);
    assert.deepEqual(report.diagnosticErrors, []);
    assert.equal(await readFile(path.join(directory, `${file}.png`), "utf8"), "captured fixture");
  }
});

test("failed diagnostic capture preserves the original native setup error", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "fmarch-theme-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [root, path.join(root, "missing-directory")]) {
    const fake = nativeMediaPage({ failEvaluate: new Error("page disconnected") });
    fake.page.isClosed = () => false;
    fake.page.screenshot = async () => { throw new Error("screenshot disconnected"); };
    await assert.rejects(setPreferenceSystemScheme(fake.page, { preference: "dark", step: "session", requested: "dark", directory }), error => {
      assert.equal(error.name, "NativeMediaSetupError");
      assert.equal(error.cause.message, "page disconnected");
      assert.equal(error.diagnosticErrors[0].stage, "screenshot");
      if (directory !== root) assert.equal(error.diagnosticErrors[1].stage, "artifact");
      return true;
    });
  }
});

test("a stalled failure screenshot cannot outlive its own bounded diagnostic budget", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fmarch-theme-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fake = nativeMediaPage({ failEvaluate: new Error("page disconnected") });
  fake.page.isClosed = () => false;
  fake.page.screenshot = () => new Promise(() => {});
  await assert.rejects(setPreferenceSystemScheme(fake.page, {
    preference: "system", step: "session", requested: "dark", directory,
  }, { screenshotTimeoutMs: 20 }), error => {
    assert.equal(error.cause.message, "page disconnected");
    assert.match(error.diagnosticErrors[0].error, /exceeded its deadline/);
    return true;
  });
  const report = JSON.parse(await readFile(path.join(directory, "preference-system-session-media-failure.json"), "utf8"));
  assert.equal(report.screenshot, null);
});
