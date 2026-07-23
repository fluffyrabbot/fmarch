import { createHmac } from "node:crypto";

export function authSourceHeader(authSource, env = process.env, now = Date.now()) {
  if (authSource === null) {
    return {};
  }
  const key = env.FMARCH_AUTH_SOURCE_SIGNING_KEY;
  if (typeof key !== "string" || Buffer.byteLength(key) < 32) {
    return { "x-fmarch-auth-source": authSource };
  }
  const timestamp = Math.floor(now / 1000).toString();
  const signature = createHmac("sha256", key)
    .update(`${timestamp}\n${authSource.toLowerCase()}`)
    .digest("hex");
  return {
    "x-fmarch-auth-source": authSource,
    "x-fmarch-auth-source-timestamp": timestamp,
    "x-fmarch-auth-source-signature": signature,
  };
}
