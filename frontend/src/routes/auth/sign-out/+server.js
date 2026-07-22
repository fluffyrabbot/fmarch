import { loadAuthKit } from "$lib/server/workos-authkit.mjs";

export async function GET(event) {
  const authKit = await loadAuthKit();
  return authKit.signOut(event);
}

export async function POST(event) {
  const authKit = await loadAuthKit();
  return authKit.signOut(event);
}
