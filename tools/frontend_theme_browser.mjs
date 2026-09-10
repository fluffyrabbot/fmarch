// One real engine, one isolated fixture server, one complete theme receipt.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { proveThemes } from './frontend_theme_proof.mjs';
import { provePhaseGroundContrast } from './frontend_phase_contrast.mjs';
import { linuxVisualEnvironment } from './linux_visual_environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontendRoot = path.join(root, 'frontend');
const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'));
const name = process.env.FMARCH_PROOF_BROWSER ?? 'chromium';
const engine = {chromium, firefox, webkit}[name];
if (!engine) throw new Error(`Unknown theme proof browser: ${name}`);
const artifactDir = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, 'target/frontend-themes', name));
await mkdir(artifactDir, {recursive: true});
process.env.FMARCH_FRONTEND_FIXTURE_SESSION = '1';
process.chdir(frontendRoot);
let server;
let browser;
try {
  const { createServer } = await import(frontendRequire.resolve('vite'));
  server = await createServer({root: frontendRoot, server: {host: '127.0.0.1', port: 0}, logLevel: 'error'});
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address !== 'object') throw new Error('Theme server has no TCP address');
  browser = await engine.launch();
  const themes = await proveThemes({browser, baseUrl: `http://127.0.0.1:${address.port}`, artifactDir, proveContrast: provePhaseGroundContrast});
  await writeFile(path.join(artifactDir, 'theme-browser.json'), JSON.stringify({
    ...themes,
    browser: {name, version: browser.version(), node: process.version},
    visualEnvironment: name === 'chromium' ? await linuxVisualEnvironment() : {platform: process.platform, arch: process.arch},
  }, null, 2) + '\n');
} catch (error) {
  await writeFile(path.join(artifactDir, 'theme-browser.json'), JSON.stringify({status: 'failed', browser: {name}, error: error.stack}, null, 2) + '\n');
  throw error;
} finally {
  try { await browser?.close(); } finally { await server?.close(); }
}
