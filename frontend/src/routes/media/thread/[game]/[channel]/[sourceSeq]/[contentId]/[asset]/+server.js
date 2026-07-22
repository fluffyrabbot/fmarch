import { SESSION_COOKIE_NAME } from "../../../../../../../../lib/server/session-capabilities.mjs";

const FORWARDED_HEADERS = Object.freeze([
  "cache-control",
  "content-type",
  "etag",
  "x-fmarch-media-content-address",
  "x-fmarch-media-channel",
  "x-fmarch-media-post-seq",
  "x-fmarch-media-reference",
  "x-fmarch-media-variant",
  "x-fmarch-media-format",
]);

export async function GET({
  params,
  request,
  cookies,
  fetch: fetchImpl = fetch,
  env = process.env,
}) {
  const token = cookies?.get?.(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") {
    return emptyResponse(401);
  }
  const pathname = `/media/thread/${encodeURIComponent(params.game)}/${encodeURIComponent(
    params.channel,
  )}/${encodeURIComponent(params.sourceSeq)}/${encodeURIComponent(
    params.contentId,
  )}/${encodeURIComponent(params.asset)}`;
  const base = String(
    env?.FMARCH_API_INTERNAL_URL ?? env?.FMARCH_API_BASE_URL ?? "",
  ).replace(/\/$/u, "");
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "image/avif,image/webp",
  };
  const ifNoneMatch = request?.headers?.get?.("if-none-match");
  if (typeof ifNoneMatch === "string" && ifNoneMatch.trim() !== "") {
    headers["if-none-match"] = ifNoneMatch;
  }
  const response = await fetchImpl(`${base}${pathname}`, { headers });
  if (!response.ok && response.status !== 304) {
    return emptyResponse(response.status);
  }
  const responseHeaders = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }
  if (response.status === 304) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }
  const body = await response.arrayBuffer();
  responseHeaders.set("content-length", String(body.byteLength));
  return new Response(body, { status: response.status, headers: responseHeaders });
}

function emptyResponse(status) {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", "content-length": "0" },
  });
}
