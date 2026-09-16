import { phaseDetailsFromId } from "../../frontend/src/lib/phase-id.mjs";

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
