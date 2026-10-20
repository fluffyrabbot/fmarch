import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// SvelteKit rewrites every generated file when a process starts, and dev
// servers watch them; concurrent proof processes each keep their own copy.
// Generated imports are relative to outDir while Vite resolves importers by
// real path, so a scratch path through a symlink (the proof build root) must
// be resolved first.
const scratchDir = process.env.FMARCH_FRONTEND_SCRATCH_DIR;
const scratch = scratchDir ? (mkdirSync(scratchDir, { recursive: true }), realpathSync(scratchDir)) : null;

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    ...(scratch ? { outDir: join(scratch, "svelte-kit") } : {}),
    csp: {
      mode: "nonce",
      directives: {
        "default-src": ["self"],
        "base-uri": ["none"],
        "connect-src": [
          "self",
          "https://fmarch-staging.up.railway.app",
          "wss://fmarch-staging.up.railway.app",
          "https://fmarch-production.up.railway.app",
          "wss://fmarch-production.up.railway.app",
        ],
        "font-src": ["self"],
        "form-action": ["self"],
        "frame-ancestors": ["none"],
        "frame-src": ["https://www.youtube-nocookie.com"],
        "img-src": ["self", "data:", "blob:"],
        "manifest-src": ["self"],
        "media-src": ["self"],
        "object-src": ["none"],
        "script-src": ["self", "strict-dynamic"],
        "script-src-attr": ["none"],
        "style-src": ["self"],
        // SvelteKit's generated accessibility route announcer has one fixed
        // inline style attribute. Authorize only that exact value; application
        // source remains inline-style-free.
        "style-src-attr": [
          "unsafe-hashes",
          "sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=",
        ],
        "worker-src": ["self"],
      },
    },
  },
};

export default config;
