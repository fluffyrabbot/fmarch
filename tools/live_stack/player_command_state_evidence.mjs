import { phaseDetailsFromId } from "../../frontend/src/lib/phase-id.mjs";

export function queuePlayerCommandStateResponse(response, responses, tasks) {
  const task = readPlayerCommandStateResponse(response).then((evidence) => responses.push(evidence));
  // A response body can reject while failure cleanup closes its context. Attach
  // an observer immediately so it cannot mask the primary failure as unhandled;
  // retain the original promise so active checkpoints still throw every error.
  task.catch(() => {});
  tasks.push(task);
}

export async function settlePlayerCommandStateResponses(tasks) {
  await Promise.all(tasks);
}

export async function readPlayerCommandStateResponse(response) {
  const body = await response.json();
  const url = response.url();
  const phaseId = body.phase?.phase_id ?? null;
  return {
    url,
    pathname: new URL(url).pathname,
    status: response.status(),
    ok: response.ok(),
    actorSlot: body.actor_slot ?? null,
    roleKey: body.role_key ?? null,
    phaseId,
    // Kind is a derived evidence field, never a second wire authority.
    phaseKind: phaseDetailsFromId(phaseId)?.kind ?? null,
    locked: body.phase?.locked ?? null,
    actions: (body.actions ?? []).map((action) => ({
      templateId: action.template_id,
      targets: action.targets,
      targetOptions: action.target_options,
    })),
    boundary: body.boundary ?? null,
  };
}
