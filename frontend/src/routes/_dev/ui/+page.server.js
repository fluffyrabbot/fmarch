import { error } from "@sveltejs/kit";
import {
  UI_WORKBENCH_GROUPS,
  UI_WORKBENCH_VIEWPORTS,
  uiWorkbenchEnabled,
} from "../../../lib/dev/ui-workbench.mjs";

export function load() {
  if (!uiWorkbenchEnabled()) {
    throw error(404, "Not found");
  }

  return {
    scenarioGroups: UI_WORKBENCH_GROUPS,
    viewports: UI_WORKBENCH_VIEWPORTS,
  };
}
