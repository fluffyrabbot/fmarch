import { redirect } from "@sveltejs/kit";

// Compatibility alias for the pre-chooser WorkOS entry point.
export function GET({ url }) {
  throw redirect(302, `/auth/login/workos?${url.searchParams}`);
}
