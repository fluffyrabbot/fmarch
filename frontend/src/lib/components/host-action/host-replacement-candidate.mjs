import { canonicalPrincipalId } from "../../principal-id.mjs";

export function replacementHandle(value) {
  const handle = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
  return /^[a-zA-Z0-9_]{3,32}$/.test(handle) ? handle.toLowerCase() : null;
}

function present(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function replacementContext({ gameId, replacement, authority, completed = false }) {
  const authorized = authority?.capabilityKind === "HostOf" ||
    (authority?.capabilityKind === "CohostOf" && authority?.allowedClasses?.includes("replacement"));
  if (!authorized || completed || !canonicalPrincipalId(authority?.principalId) ||
    !present(gameId) || !present(replacement?.slotId) || !present(replacement?.personaId) ||
    !canonicalPrincipalId(replacement?.assignedPrincipalId)) return null;
  return Object.freeze({
    gameId,
    slotId: replacement.slotId,
    outgoingPersonaId: replacement.personaId,
    outgoingPrincipalId: replacement.assignedPrincipalId,
    authorityPrincipalId: authority.principalId,
    capabilityKind: authority.capabilityKind,
  });
}

export function validateReplacementCandidate(payload, context, handle) {
  if (!context || payload?.slot_id !== context.slotId ||
    payload?.outgoing_persona_id !== context.outgoingPersonaId ||
    payload?.handle !== handle || replacementHandle(payload?.handle) !== payload?.handle ||
    !canonicalPrincipalId(payload?.principal_id) ||
    payload.principal_id === context.outgoingPrincipalId || !present(payload?.display_name)) {
    throw new Error("Replacement lookup returned an invalid or stale member. Refresh and try again.");
  }
  return Object.freeze({
    ...context,
    principalId: payload.principal_id,
    handle: payload.handle,
    displayName: payload.display_name,
  });
}

// A candidate is local command intent. It never becomes part of the live projection.
export function replacementWithCandidate({ gameId, replacement, authority, candidate, fixtureMode = false }) {
  if (!replacement) return null;
  const { incomingPrincipalId: _fixturePrincipal, incomingDisplayLabel: _fixtureLabel, ...seat } = replacement;
  const context = replacementContext({ gameId, replacement, authority });
  if (context && candidate && Object.keys(context).every((key) => candidate[key] === context[key])) {
    try {
      const validated = validateReplacementCandidate({
        slot_id: candidate.slotId,
        outgoing_persona_id: candidate.outgoingPersonaId,
        principal_id: candidate.principalId,
        handle: candidate.handle,
        display_name: candidate.displayName,
      }, context, candidate.handle);
      return Object.freeze({ ...seat, incomingPrincipalId: validated.principalId,
        incomingDisplayLabel: `${validated.displayName} (@${validated.handle})` });
    } catch { /* Stale or malformed local intent cannot create an action. */ }
  }
  return fixtureMode === true ? replacement : Object.freeze(seat);
}

export function createReplacementChooser({ fetchImpl, onChange = () => {} }) {
  let context = null;
  let ready = false;
  let handle = "";
  let candidate = null;
  let state = "idle";
  let message = "";
  let generation = 0;
  let pending = null;
  const view = () => Object.freeze({ handle, candidate, state, message, available: ready && context !== null });
  const publish = () => onChange(view());
  function cancelPending() { generation += 1; pending?.abort(); pending = null; }
  return Object.freeze({
    view,
    setContext(next, nextReady) {
      const changed = JSON.stringify(context) !== JSON.stringify(next);
      if (!changed && ready === (nextReady === true)) return;
      cancelPending();
      context = next;
      ready = nextReady === true;
      if (changed) { candidate = null; state = "idle"; message = ""; }
      else if (state === "pending") { state = "idle"; message = ""; }
      publish();
    },
    setHandle(value) {
      if (handle === value) return;
      cancelPending();
      handle = value;
      candidate = null;
      state = "idle";
      message = "";
      publish();
    },
    async lookup() {
      if (!ready || !context) return;
      cancelPending();
      candidate = null;
      const normalized = replacementHandle(handle);
      if (!normalized) {
        state = "error"; message = "Enter the member’s full public handle."; publish(); return;
      }
      const requestedContext = context;
      const requestGeneration = generation;
      pending = new AbortController();
      state = "pending"; message = "Looking up member…"; publish();
      try {
        const query = new URLSearchParams({ slot_id: context.slotId, handle: normalized });
        const response = await fetchImpl(`/api/gameplay/games/${encodeURIComponent(context.gameId)}/replacement-candidate?${query}`, {
          headers: { accept: "application/json" }, signal: pending.signal,
        });
        if (!response.ok) throw new Error(response.status === 404
          ? "No available member with that public handle."
          : response.status === 401 || response.status === 403
            ? "Replacement access is unavailable. Refresh the host console."
            : "Replacement lookup failed. Try again.");
        const selected = validateReplacementCandidate(await response.json(), requestedContext, normalized);
        if (requestGeneration !== generation) return;
        candidate = selected;
        state = "selected";
        message = "Review the replacement command before confirming.";
      } catch (error) {
        if (requestGeneration !== generation) return;
        state = "error";
        message = error.message;
      }
      pending = null;
      publish();
    },
    destroy() { cancelPending(); },
  });
}
