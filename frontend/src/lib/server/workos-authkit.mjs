const WORKOS_AUTHKIT_MODULE = "@workos/authkit-sveltekit";

let authKitModulePromise;

export function loadWorkosAuthKitModule() {
  authKitModulePromise ??= import(/* @vite-ignore */ WORKOS_AUTHKIT_MODULE);
  return authKitModulePromise;
}

export function loadAuthKit() {
  return loadWorkosAuthKitModule().then(({ authKit }) => authKit);
}
