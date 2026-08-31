import { randomBytes } from "node:crypto";

export const localProofSecretHeader = "x-fmarch-local-proof-secret";

// Create one authority bundle per spawned debug server. The secret stays in
// this closure so proof reports and generic object inspection cannot expose
// it accidentally; callers can only attenuate it into a child environment or
// the one dedicated request header.
export function createLocalProofAuth() {
  const secret = randomBytes(32).toString("hex");
  return Object.freeze({
    serverEnvironment(environment = {}) {
      return {
        ...environment,
        FMARCH_DEV_AUTH: "1",
        FMARCH_LOCAL_PROOF_SECRET: secret,
      };
    },
    requestHeaders(headers = {}) {
      return {
        ...headers,
        [localProofSecretHeader]: secret,
      };
    },
  });
}
