import assert from "node:assert/strict";
import { THEMES } from "../frontend/src/lib/app/theme.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Exercise real route hydration and the same healthy transport as the workbench.
// No theme DOM overrides: every palette assertion follows a user preference or
// an authoritative fixture refresh through the application's live boundary.
export async function proveThemes({ browser, baseUrl, artifactDir, proveContrast }) {
  const directory = path.join(artifactDir, "themes");
  await mkdir(directory, { recursive: true });
  const evidence = [];
  for (const viewport of [{ name: "desktop", width: 1440, height: 920 }, { name: "mobile", width: 390, height: 844 }]) {
    for (const { id: themeId } of THEMES) {
      for (const role of ["player", "player-normal", "moderator"]) {
        const context = await browser.newContext({ viewport, colorScheme: "light", reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        try {
          await page.goto(`${baseUrl}/appearance`, { waitUntil: "networkidle" });
          await page.getByLabel("Theme", { exact: true }).selectOption(themeId);
          await page.getByLabel("Color preference").selectOption("game");
          await saveAppearance(page, context, themeId, "game");
          await page.goto(`${baseUrl}/_dev/ui/session?scenario=${role}`, { waitUntil: "networkidle" });
          const shell = page.locator('[data-component="fm-app-shell"]');
          for (const [button, phase, palette] of [["Day", "day", "day"], ["Night", "night", "night"], ["Twilight", "twilight", "twilight"]]) {
            await page.getByRole("button", { name: button, exact: true }).click();
            await page.waitForFunction(({ themeId, phase, palette }) => {
              const shell = document.querySelector('[data-component="fm-app-shell"]');
              return shell?.dataset.theme === themeId && shell.dataset.phase === phase && shell.dataset.palette === palette;
            }, { themeId, phase, palette });
            assert.ok((await page.locator("body").innerText()).includes(`${button} 1`));
            assert.ok(!((await page.locator("body").innerText()).includes("Host commands paused")));
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${themeId}/${role}/${viewport.name} horizontal overflow`);
            const file = `${viewport.name}-${themeId}-${role}-${phase}.png`;
            await shell.screenshot({ path: path.join(directory, file) });
            evidence.push({ themeId, role, viewport: viewport.name, phase, palette, screenshot: `themes/${file}` });
          }
          // The resolved CSS values must satisfy the shared semantic contrasts
          // for both complete theme definitions, beyond the active phase alone.
          if (viewport.name === "desktop" && role === "moderator") {
            evidence.push({ themeId, contrast: await proveContrast(page) });
          }
          // Same-document route teardown must drop the game phase.
          await page.locator('.fm-app-shell__brand').click();
          await page.waitForURL(`${baseUrl}/`);
          await page.waitForFunction(() => {
            const shell = document.querySelector('[data-component="fm-app-shell"]');
            return shell && !shell.hasAttribute("data-phase") && shell.dataset.palette === "day";
          });
          assert.deepEqual(errors, [], `${themeId}/${role}/${viewport.name} browser errors`);
        } finally { await context.close(); }
      }
    }
  }
  // Preference persistence and system changes are tested independently of game
  // phase. Deliberate full reload checks the server cookie, not just client state.
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  try {
    for (const [scheme, expected] of [["light", "day"], ["dark", "night"], ["system", "night"]]) {
      await page.goto(`${baseUrl}/appearance`, { waitUntil: "networkidle" });
      await setPreferenceSystemScheme(page, { preference: scheme, step: "appearance", requested: "dark", directory });
      await page.getByLabel("Theme", { exact: true }).selectOption("slate");
      await page.getByLabel("Color preference").selectOption(scheme);
      await saveAppearance(page, context, "slate", scheme);
      await page.goto(`${baseUrl}/_dev/ui/session?scenario=player`, { waitUntil: "networkidle" });
      await setPreferenceSystemScheme(page, { preference: scheme, step: "session", requested: "dark", directory });
      await page.getByTestId("player-surface").waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Night", exact: true }).click();
      await page.waitForFunction(expected => {
        const shell = document.querySelector('[data-component="fm-app-shell"]');
        return shell?.dataset.phase === "night" && shell.dataset.palette === expected && shell.dataset.theme === "slate";
      }, expected).catch(async error => {
        await page.screenshot({ path: path.join(directory, `preference-failure-${scheme}.png`), fullPage: true });
        await writeFile(path.join(directory, `preference-failure-${scheme}.json`), JSON.stringify({
          scheme, expected,
          actual: await page.locator('[data-component="fm-app-shell"]').evaluate(element => ({ ...element.dataset })),
          systemDark: await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches),
          preferenceCookie: (await context.cookies()).find(cookie => cookie.name === "fmarch_appearance")?.value,
          body: await page.locator("body").innerText(),
        }, null, 2));
        throw error;
      });
      evidence.push({ preference: scheme, system: "dark", phase: "night", palette: expected });
    }
    await setPreferenceSystemScheme(page, { preference: "system", step: "change", requested: "light", directory });
    await page.waitForFunction(() => document.querySelector('[data-component="fm-app-shell"]')?.dataset.palette === "day");
    evidence.push({ preference: "system", system: "light", phase: "night", palette: "day" });
  } finally { await context.close(); }
  return { status: "passed", boundary: "Real routes, persisted preferences, workbench live refresh, teardown, responsive geometry, and semantic contrast", cases: evidence };
}

export const nativeMediaSetupPolicy = Object.freeze({ timeoutMs: 30_000, maxAttempts: 3 });

export async function setPreferenceSystemScheme(page, { preference, step, requested, directory }, {
  screenshotTimeoutMs = 2_000,
} = {}) {
  assert.ok(Number.isSafeInteger(screenshotTimeoutMs) && screenshotTimeoutMs > 0 && screenshotTimeoutMs <= 2_000,
    "native media failure screenshot must remain bounded");
  try {
    return await setSystemScheme(page, requested);
  } catch (error) {
    const file = `preference-${preference}-${step}-media-failure`;
    const diagnosticErrors = [];
    let screenshot;
    let watchdog;
    try {
      if (!page.isClosed()) {
        await Promise.race([
          page.screenshot({ path: path.join(directory, `${file}.png`), fullPage: true, timeout: screenshotTimeoutMs }),
          new Promise((_resolve, reject) => {
            watchdog = setTimeout(() => reject(new Error("native media failure screenshot exceeded its deadline")), screenshotTimeoutMs);
          }),
        ]);
        screenshot = `${file}.png`;
      }
    } catch (diagnosticError) {
      diagnosticErrors.push({ stage: "screenshot", error: String(diagnosticError.message).slice(0, 500) });
    } finally {
      clearTimeout(watchdog);
    }
    try {
      await writeFile(path.join(directory, `${file}.json`), JSON.stringify({
        preference, step, requested,
        error: error.message,
        nativeMedia: error.mediaDiagnostics,
        screenshot: screenshot ?? null,
        diagnosticErrors,
      }, null, 2) + "\n");
    } catch (diagnosticError) {
      diagnosticErrors.push({ stage: "artifact", error: String(diagnosticError.message).slice(0, 500) });
    }
    if (diagnosticErrors.length > 0) error.diagnosticErrors = diagnosticErrors;
    throw error;
  }
}

export async function setSystemScheme(page, colorScheme, {
  timeoutMs = nativeMediaSetupPolicy.timeoutMs,
  now = () => performance.now(),
} = {}) {
  assert.ok(colorScheme === "light" || colorScheme === "dark", "native media setup requires light or dark");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= nativeMediaSetupPolicy.timeoutMs,
    "native media setup timeout must remain within its overall deadline");
  const started = now();
  const deadline = started + timeoutMs;
  const opposite = colorScheme === "dark" ? "light" : "dark";
  const attempts = [];
  const deadlineError = new Error("native media setup exceeded its overall deadline");
  deadlineError.name = "NativeMediaDeadlineError";
  let watchdog;
  const expired = new Promise((_resolve, reject) => {
    watchdog = setTimeout(() => reject(deadlineError), timeoutMs);
  });
  const bounded = async (operation) => {
    if (now() >= deadline) throw deadlineError;
    const value = await Promise.race([operation(), expired]);
    if (now() >= deadline) throw deadlineError;
    return value;
  };
  const snapshot = () => bounded(() => page.evaluate(() => ({
    url: location.href.slice(0, 1_000),
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    light: matchMedia("(prefers-color-scheme: light)").matches,
  })));
  try {
    for (let attempt = 1; attempt <= nativeMediaSetupPolicy.maxAttempts; attempt += 1) {
      const record = { attempt, stage: "inspect" };
      attempts.push(record);
      const attemptDeadline = Math.min(deadline, now() + Math.ceil(timeoutMs / nativeMediaSetupPolicy.maxAttempts));
      try {
        record.before = await snapshot();
        // Clearing a page override inherits the context's dark setting in
        // Firefox. Observe a real opposite transition before applying the
        // requested scheme to the current document after navigation.
        for (const [stage, scheme] of [["opposite", opposite], ["requested", colorScheme]]) {
          record.stage = `apply-${stage}`;
          await bounded(() => page.emulateMedia({ colorScheme: scheme }));
          record.stage = `observe-${stage}`;
          const remaining = attemptDeadline - now();
          if (remaining <= 0) {
            const error = new Error("native media transition did not converge within its attempt budget");
            error.name = "TimeoutError";
            throw error;
          }
          await bounded(() => page.waitForFunction(
            requested => matchMedia(`(prefers-color-scheme: ${requested})`).matches,
            scheme,
            { timeout: remaining, polling: 50 },
          ));
          record[stage] = await snapshot();
          if (!record[stage][scheme] || record[stage][scheme === "dark" ? "light" : "dark"]) {
            const error = new Error("native media changed before the transition was observed");
            error.name = "NativeMediaMismatchError";
            throw error;
          }
        }
        record.stage = "complete";
        return { requested: colorScheme, elapsedMs: now() - started, attempts };
      } catch (error) {
        record.error = { name: error.name, message: String(error.message).slice(0, 500) };
        record.elapsedMs = now() - started;
        const nativeMismatch = record.stage.startsWith("observe-") &&
          (error.name === "TimeoutError" || error.name === "NativeMediaMismatchError");
        if (!nativeMismatch || attempt === nativeMediaSetupPolicy.maxAttempts || now() >= deadline) throw error;
        record.afterFailure = await snapshot();
      }
    }
  } catch (cause) {
    const error = new Error(`Native ${colorScheme} media setup failed: ${String(cause.message).slice(0, 500)}`, { cause });
    error.name = "NativeMediaSetupError";
    error.mediaDiagnostics = { requested: colorScheme, timeoutMs, elapsedMs: now() - started, attempts };
    throw error;
  } finally {
    clearTimeout(watchdog);
  }
}

async function saveAppearance(page, context, themeId, scheme) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.getByRole("button", { name: "Save appearance" }).click(),
  ]);
  assert.equal(decodeURIComponent((await context.cookies()).find(cookie => cookie.name === "fmarch_appearance")?.value ?? ""),
    `${themeId}:${scheme}`, "the server must persist the submitted appearance before another navigation");
}
