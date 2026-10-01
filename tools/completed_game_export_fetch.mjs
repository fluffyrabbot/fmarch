/** Observe the exact live export consumed by the role loader without replacing it. */
export function createCompletedExportFetchObserver({ exportUrl, sessionToken, fetchImpl = globalThis.fetch, timeoutMs = 15_000, maxBytes = 4 * 1024 * 1024 }) {
  const expectedUrl = new URL(exportUrl).href;
  if (typeof sessionToken !== "string" || !sessionToken) throw new Error("export observation requires its host session token");
  const observations = [];
  return {
    async fetch(input, init) {
      const url = input instanceof Request ? input.url : new URL(input).href;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const matches = url === expectedUrl && method.toUpperCase() === "GET" && headers.get("authorization") === `Bearer ${sessionToken}`;
      const response = await fetchImpl(input, init);
      if (matches) {
        const observed = readManifestClone(response, { timeoutMs, maxBytes })
          .then(manifest => ({ manifest }), error => ({ error }));
        observations.push(observed);
      }
      return response;
    },
    async manifest() {
      if (observations.length !== 1) throw new Error(`role loader must consume exactly one authenticated export response; observed ${observations.length}`);
      const observed = await observations[0];
      if (observed.error) throw observed.error;
      return observed.manifest;
    },
  };
}

async function readManifestClone(response, { timeoutMs, maxBytes }) {
  if (response.status !== 200) throw new Error(`observed export response returned ${response.status}`);
  const reader = response.clone().body?.getReader();
  if (!reader) throw new Error("observed export response has no manifest body");
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("export response observation timed out")), timeoutMs); });
  let finished = false;
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) { finished = true; break; }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("export response observation exceeded its byte limit");
      chunks.push(value);
    }
    const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("observed export response is not a manifest object");
    return manifest;
  } finally {
    clearTimeout(timer);
    if (finished) reader.releaseLock();
    else void reader.cancel().catch(() => {});
  }
}
