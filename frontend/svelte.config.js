import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
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
