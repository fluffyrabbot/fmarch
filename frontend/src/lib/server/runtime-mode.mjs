export const FRONTEND_FIXTURE_MODE_ENV = "FMARCH_FRONTEND_FIXTURE_SESSION";

export const PRODUCTION_FIXTURE_MODE_ERROR = Object.freeze({
  name: "RuntimeModeConfigurationError",
  code: "FMARCH_PRODUCTION_FIXTURE_MODE",
  message:
    "FMARCH_FRONTEND_FIXTURE_SESSION=1 is forbidden when NODE_ENV=production",
});

export function frontendFixtureMode(env = process.env) {
  const enabled = env?.[FRONTEND_FIXTURE_MODE_ENV] === "1";
  if (enabled && env?.NODE_ENV === "production") {
    const failure = new Error(PRODUCTION_FIXTURE_MODE_ERROR.message);
    failure.name = PRODUCTION_FIXTURE_MODE_ERROR.name;
    failure.code = PRODUCTION_FIXTURE_MODE_ERROR.code;
    throw failure;
  }
  return enabled;
}
