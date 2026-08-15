import { WorkOS } from "@workos-inc/node";
import {
  AuthService,
  CookieSessionStorage,
  sessionEncryption,
} from "@workos/authkit-session";

const WORKOS_AUTHKIT_ENV = Object.freeze([
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
]);

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

// Retained only for defensive cleanup of cookies issued by an older frontend.
// The direct ceremony never persists a WorkOS session in the browser.
export const WORKOS_SESSION_COOKIE_NAME = "wos-session";

let configuredAuthKitPromise;

export function loadAuthKit(env = process.env) {
  if (!workosAuthKitConfigured(env)) {
    throw new Error("WorkOS AuthKit is not configured");
  }
  configuredAuthKitPromise ??= Promise.resolve(createWorkosAuthKit(env));
  return configuredAuthKitPromise;
}

export async function beginWorkosAuthorization(
  { cookies, intent, returnTo, loginHint },
  { loadAuthKitImpl = loadAuthKit, env = process.env } = {},
) {
  const authKit = await loadAuthKitImpl(env);
  const options = {
    returnPathname: returnTo,
    ...(typeof loginHint === "string" && loginHint !== "" ? { loginHint } : {}),
  };
  const method = intent === "sign-up" ? "createSignUp" : "createSignIn";
  const result = await authKit[method](cookies, options);
  return result.url;
}

export function createWorkosAuthKit(
  env,
  { client = null, encryption = sessionEncryption } = {},
) {
  const config = {
    clientId: env.WORKOS_CLIENT_ID,
    apiKey: env.WORKOS_API_KEY,
    redirectUri: env.WORKOS_REDIRECT_URI,
    cookiePassword: env.WORKOS_COOKIE_PASSWORD,
    apiHostname: "api.workos.com",
    apiHttps: true,
    cookieMaxAge: 60 * 60 * 24 * 400,
    cookieName: WORKOS_SESSION_COOKIE_NAME,
    cookieSameSite: "lax",
  };
  const storage = new CeremonyCookieStorage(config);
  const workos =
    client ??
    new WorkOS(config.apiKey, {
      appInfo: { name: "fmarch-frontend", version: "pre-1.0" },
    });
  return new AuthService(config, storage, workos, encryption);
}

class CeremonyCookieStorage extends CookieSessionStorage {
  async getCookie(cookies, name) {
    const value = cookies?.get?.(name);
    return typeof value === "string" ? value : null;
  }

  async setCookie(cookies, name, value, options) {
    if (cookies?.set === undefined) {
      return super.setCookie(cookies, name, value, options);
    }
    cookies.set(name, value, cookieOptions(options));
    return { response: cookies };
  }

  async clearCookie(cookies, name, options) {
    if (cookies?.delete === undefined) {
      return super.clearCookie(cookies, name, options);
    }
    cookies.delete(name, deletionOptions(options));
    return { response: cookies };
  }

  async getSession() {
    return null;
  }

  // AuthService returns authResponse directly to the callback. Deliberately
  // discard its encrypted session: the API is the sole JWT verifier and owns
  // the only durable browser session.
  async saveSession(cookies) {
    return cookies === undefined ? {} : { response: cookies };
  }

  async clearSession(cookies) {
    if (cookies?.delete !== undefined) {
      cookies.delete(WORKOS_SESSION_COOKIE_NAME, { path: "/" });
      return { response: cookies };
    }
    return {};
  }
}

function cookieOptions(options) {
  return {
    path: options.path ?? "/",
    ...(options.domain === undefined ? {} : { domain: options.domain }),
    ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
    ...(options.expires === undefined ? {} : { expires: options.expires }),
    ...(options.httpOnly === undefined ? {} : { httpOnly: options.httpOnly }),
    ...(options.secure === undefined ? {} : { secure: options.secure }),
    ...(options.sameSite === undefined ? {} : { sameSite: options.sameSite }),
    ...(options.priority === undefined ? {} : { priority: options.priority }),
  };
}

function deletionOptions(options) {
  return {
    path: options.path ?? "/",
    ...(options.domain === undefined ? {} : { domain: options.domain }),
  };
}
