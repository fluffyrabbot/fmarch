import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const appRoutePages = Object.freeze([
  "frontend/src/routes/+page.svelte",
  "frontend/src/routes/admin/+page.svelte",
  "frontend/src/routes/admin/audit/[audit]/+page.svelte",
  "frontend/src/routes/g/[game]/+page.svelte",
  "frontend/src/routes/g/[game]/c/[channel]/+page.svelte",
  "frontend/src/routes/g/[game]/host/+page.svelte",
]);

const rootOwnedLoaders = Object.freeze([
  "frontend/src/routes/+page.server.js",
  "frontend/src/routes/admin/+page.server.js",
  "frontend/src/routes/admin/audit/[audit]/+page.server.js",
  "frontend/src/routes/g/[game]/+page.server.js",
  "frontend/src/routes/g/[game]/c/[channel]/+page.server.js",
  "frontend/src/routes/g/[game]/host/+page.server.js",
]);

test("app route pages render surfaces only under the root-owned app shell", async () => {
  const rootLayout = await readWorkspaceFile("frontend/src/routes/+layout.svelte");
  assert.match(rootLayout, /import AppShell from "\$lib\/app\/AppShell\.svelte";/u);
  assert.match(rootLayout, /<AppShell shell=\{layoutShell\}>/u);

  for (const routePage of appRoutePages) {
    const source = await readWorkspaceFile(routePage);
    assert.doesNotMatch(
      source,
      /import\s+AppShell\s+from/u,
      `${routePage} must not import AppShell; root +layout owns it`,
    );
    assert.doesNotMatch(
      source,
      /<AppShell\b/u,
      `${routePage} must render only its role surface`,
    );
  }
});

test("app route loaders opt into the root app shell explicitly", async () => {
  for (const loader of rootOwnedLoaders) {
    const source = await readWorkspaceFile(loader);
    assert.match(
      source,
      /shellOwner:\s*"layout"/u,
      `${loader} must return shellOwner: "layout"`,
    );
  }
});

async function readWorkspaceFile(relativePath) {
  return await readFile(path.join(repoRoot, relativePath), "utf8");
}
