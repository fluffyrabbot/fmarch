const WORKOS_AUTHKIT_ENV = Object.freeze([
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
]);

let authKitModulePromise;

export function workosAuthKitConfigured(env = process.env) {
  const configured = WORKOS_AUTHKIT_ENV.filter(
    (name) => typeof env?.[name] === "string" && env[name].trim() !== "",
  );
  if (configured.length === 0) return false;
  if (configured.length !== WORKOS_AUTHKIT_ENV.length) {
    const missing = WORKOS_AUTHKIT_ENV.filter((name) => !configured.includes(name));
    throw new Error(`incomplete WorkOS AuthKit configuration; missing ${missing.join(", ")}`);
  }
  return true;
}

// AuthKit's sealed session cookie only exists between the WorkOS redirect and
// the one-time exchange at /auth/workos/complete; nothing else may read it.
export const WORKOS_SESSION_COOKIE_NAME = "wos-session";

let configuredAuthKitPromise;

export function loadWorkosAuthKitModule() {
  authKitModulePromise ??= import("@workos/authkit-sveltekit");
  return authKitModulePromise;
}

export function loadAuthKit(env = process.env) {
  if (!workosAuthKitConfigured(env)) {
    throw new Error("WorkOS AuthKit is not configured");
  }
  configuredAuthKitPromise ??= loadWorkosAuthKitModule().then(
    ({ authKit, configureAuthKit }) => {
      configureAuthKit({
        clientId: env.WORKOS_CLIENT_ID,
        apiKey: env.WORKOS_API_KEY,
        redirectUri: env.WORKOS_REDIRECT_URI,
        cookiePassword: env.WORKOS_COOKIE_PASSWORD,
      });
      return authKit;
    },
  );
  return configuredAuthKitPromise;
}
