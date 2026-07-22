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

export function loadWorkosAuthKitModule() {
  authKitModulePromise ??= import("@workos/authkit-sveltekit");
  return authKitModulePromise;
}

export function loadAuthKit() {
  return loadWorkosAuthKitModule().then(({ authKit }) => authKit);
}
