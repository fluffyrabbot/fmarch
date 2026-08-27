// Liveness probe for the frontend service itself. Deliberately touches no
// upstream: the Railway healthcheck must stay green during an API outage so
// frontend fixes remain deployable while the API is down.
export function GET() {
  return new Response(
    JSON.stringify({
      status: "ok",
      release_commit: process.env.FMARCH_RELEASE_COMMIT ?? "development",
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
