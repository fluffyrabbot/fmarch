const MAX_PHASE_ORDINAL = 2_147_483_647;
const MAX_REVOTE_ATTEMPT = 4_294_967_295;

// Keep this grammar aligned with domain::phase::PhaseId. Phase identities are
// validated at the backend ingress, but the UI still needs to derive display
// facts from the one wire representation rather than receive redundant kind
// and number fields that can drift from the id.
const CANONICAL_PHASE_ID = /^(D|N|T)(0[1-9]|[1-9]\d+)(?:R([1-9]\d*))?$/u;

const PHASE_KIND_LABEL = Object.freeze({
  D: "Day",
  N: "Night",
  T: "Twilight",
});

/**
 * Parses a canonical PhaseId for presentation only. Invalid or absent values
 * are not coerced into a phase: callers must model a pre-phase game as null.
 */
export function phaseDetailsFromId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = CANONICAL_PHASE_ID.exec(value);
  if (match === null) {
    return null;
  }
  const number = Number(match[2]);
  const revote = match[3] === undefined ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(number) ||
    number > MAX_PHASE_ORDINAL ||
    (revote !== null &&
      (!Number.isSafeInteger(revote) || revote > MAX_REVOTE_ATTEMPT))
  ) {
    return null;
  }
  return Object.freeze({
    id: value,
    kind: PHASE_KIND_LABEL[match[1]],
    number,
    revote,
  });
}

export function canonicalPhaseId(value) {
  return phaseDetailsFromId(value)?.id ?? null;
}

export function phaseLabelFromId(value) {
  const details = phaseDetailsFromId(value);
  if (details === null) {
    return null;
  }
  const revote = details.revote === null ? "" : ` revote ${details.revote}`;
  return `${details.kind} ${details.number}${revote}`;
}
