import assert from "node:assert/strict";
import { THEMES } from "../frontend/src/lib/app/theme.mjs";
import { mkdir } from "node:fs/promises";
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
          await Promise.all([page.waitForURL(`${baseUrl}/appearance`), page.getByRole("button", { name: "Save appearance" }).click()]);
          await page.waitForLoadState("networkidle");
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
      await page.getByLabel("Theme", { exact: true }).selectOption("slate");
      await page.getByLabel("Color preference").selectOption(scheme);
      await page.getByRole("button", { name: "Save appearance" }).click();
      await page.waitForLoadState("networkidle");
      await page.goto(`${baseUrl}/_dev/ui/session?scenario=player`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Night", exact: true }).click();
      await page.waitForFunction(expected => {
        const shell = document.querySelector('[data-component="fm-app-shell"]');
        return shell?.dataset.phase === "night" && shell.dataset.palette === expected && shell.dataset.theme === "slate";
      }, expected);
      evidence.push({ preference: scheme, system: "dark", phase: "night", palette: expected });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.querySelector('[data-component="fm-app-shell"]')?.dataset.palette === "day");
    evidence.push({ preference: "system", system: "light", phase: "night", palette: "day" });
  } finally { await context.close(); }
  return { status: "passed", boundary: "Real routes, persisted preferences, workbench live refresh, teardown, responsive geometry, and semantic contrast", cases: evidence };
}
