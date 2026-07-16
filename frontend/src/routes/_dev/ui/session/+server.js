import { error, redirect } from "@sveltejs/kit";
import {
  browserSessionCookieOptions,
  FIXTURE_SESSION_COOKIE_NAME,
} from "../../../../lib/server/session-capabilities.mjs";
import {
  UI_WORKBENCH_PATH,
  uiWorkbenchDestination,
  uiWorkbenchEnabled,
  uiWorkbenchScenario,
} from "../../../../lib/dev/ui-workbench.mjs";

export function GET({ cookies, url }) {
  if (!uiWorkbenchEnabled()) {
    throw error(404, "Not found");
  }

  const scenarioId = url.searchParams.get("scenario");
  const state = url.searchParams.get("state");
  const scenario = uiWorkbenchScenario(scenarioId);
  const destination = uiWorkbenchDestination({ scenarioId, state });
  if (scenario === null || destination === null) {
    throw redirect(303, UI_WORKBENCH_PATH);
  }

  cookies.set(
    FIXTURE_SESSION_COOKIE_NAME,
    scenario.token,
    browserSessionCookieOptions(url),
  );
  throw redirect(303, destination);
}
