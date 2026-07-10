import { SESSION_COOKIE_NAME } from "../../../lib/server/session-capabilities.mjs";

const MAX_ENCODED_BYTES = 12 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg"]);

export async function POST({
  request,
  cookies,
  fetch: fetchImpl = fetch,
  env = process.env,
}) {
  const token = cookies?.get?.(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") {
    return emptyResponse(401);
  }
  const contentType = String(request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return emptyResponse(415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ENCODED_BYTES) {
    return emptyResponse(413);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_ENCODED_BYTES) {
    return emptyResponse(body.byteLength === 0 ? 422 : 413);
  }
  const response = await fetchImpl(mediaApiUrl(env, "/media/uploads"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": contentType,
    },
    body,
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

function mediaApiUrl(env, pathname) {
  const base = String(env?.FMARCH_API_BASE_URL ?? "").replace(/\/$/u, "");
  return `${base}${pathname}`;
}

function emptyResponse(status) {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", "content-length": "0" },
  });
}
