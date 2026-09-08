import { randomBytes } from "node:crypto";

import { authSourceHeader } from "../frontend/src/lib/server/auth-source.mjs";

export function createCapacityAuthSourceAuthority(
  signingKey = randomBytes(32).toString("hex"),
) {
  if (typeof signingKey !== "string" || Buffer.byteLength(signingKey) < 32) {
    throw new Error("capacity auth-source signing key must contain at least 32 bytes");
  }
  const signingEnvironment = Object.freeze({
    FMARCH_AUTH_SOURCE_SIGNING_KEY: signingKey,
  });
  return Object.freeze({
    serverEnvironment(environment = {}) {
      return {
        ...environment,
        ...signingEnvironment,
        FMARCH_TRUST_AUTH_SOURCE_HEADER: "0",
      };
    },
    requestHeaders(source, headers = {}, now = Date.now()) {
      return {
        ...headers,
        ...authSourceHeader(source, signingEnvironment, now),
      };
    },
  });
}
