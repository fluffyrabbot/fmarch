import { join } from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";

// Proof lanes run several dev servers against one checkout. Each process
// given a scratch directory keeps its dependency-optimizer cache there (and
// its SvelteKit output, see svelte.config.js) instead of in shared state.
const scratch = process.env.FMARCH_FRONTEND_SCRATCH_DIR;

export default {
  ...(scratch ? { cacheDir: join(scratch, "vite-cache") } : {}),
  plugins: [sveltekit()],
};
