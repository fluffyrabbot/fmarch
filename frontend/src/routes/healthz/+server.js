// Liveness probe for the frontend service itself. Deliberately touches no
// upstream: the Railway healthcheck must stay green during an API outage so
// frontend fixes remain deployable while the API is down.
export function GET() {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
