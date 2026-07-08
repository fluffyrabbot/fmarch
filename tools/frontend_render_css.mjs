import { readFile } from "node:fs/promises";
import path from "node:path";

// Shared inline-CSS loader for the no-bind Chromium harnesses. These lanes
// render from an inlined stylesheet list and strip `@import`, so any new
// global stylesheet must be added here. This list is the only one.
const GLOBAL_STYLE_FILES = Object.freeze([
  "frontend/src/lib/styles/tokens.css",
  "frontend/src/lib/styles/primitives.css",
  "frontend/src/lib/styles/app.css",
]);

// host-console-critical-path.css must load after primitives.css and any
// component styles so its remaining overrides keep winning on load order.
const HOST_ACTION_STYLE_FILES = Object.freeze([
  "frontend/src/lib/components/host-action/touch-control.css",
  "frontend/src/lib/components/host-action/host-console-critical-path.css",
]);

export const RENDER_CSS_FILES = Object.freeze([
  ...GLOBAL_STYLE_FILES,
  ...HOST_ACTION_STYLE_FILES,
]);

export async function loadRenderCss({ repoRoot, componentStyleFiles = [] }) {
  const files = [
    ...GLOBAL_STYLE_FILES,
    ...componentStyleFiles,
    ...HOST_ACTION_STYLE_FILES,
  ];
  const chunks = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(repoRoot, file), "utf8");
      if (file.endsWith(".svelte")) {
        return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)]
          .map((match) => match[1].trim())
          .join("\n");
      }
      return source.replace(/^@import .+;\n/gm, "");
    }),
  );
  return chunks.join("\n");
}
