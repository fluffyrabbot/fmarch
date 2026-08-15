import { createWorkosCallbackHandler } from "$lib/server/workos-callback.mjs";

// One callback owns the whole ceremony: validate PKCE/state, exchange the
// provider code, immediately trade the provider access token for the
// backend-owned app session, and discard all WorkOS browser state.
export const GET = createWorkosCallbackHandler();
