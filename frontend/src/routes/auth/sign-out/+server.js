import { redirect } from "@sveltejs/kit";

// Compatibility alias: sign-out is unified on /auth/logout for every method.
export function GET({ url }) {
  throw redirect(302, `/auth/logout?${url.searchParams}`);
}

export function POST({ url }) {
  throw redirect(303, `/auth/logout?${url.searchParams}`);
}
