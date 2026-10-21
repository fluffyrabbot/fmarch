// Roles a game thread post made public (RFC 0009). The projection decides the
// list at write time from its own reveal flags, so a Janitor, Flipless or
// alignment-only flip arrives with none. Nothing here reads a role out of the
// post body.
import { buildRoleCardViewModel } from "./role-card-model.mjs";
import { normalizeRoleReference } from "./role-reference-model.mjs";
import { seatNames } from "../../app/seat-presenter.mjs";

export const THREAD_ROLE_REVEALS_CONTRACT = Object.freeze({
  component: "thread-role-reveals",
  modalEyebrow: "Revealed role",
  minTouchTargetPx: 44,
});

/**
 * Wire `role_reveals` (or an already-normalized list) → frozen
 * `{ slotId, roleKey, role }` entries. `role` is the normalized reference, or
 * null when the pack carries no presentation for it; a malformed entry drops.
 */
export function normalizeThreadRoleReveals(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    value
      .map((item) => {
        const slotId = String(item?.slot_id ?? item?.slotId ?? "").trim();
        const roleKey = String(item?.role_key ?? item?.roleKey ?? "").trim();
        if (slotId === "" || roleKey === "") {
          return null;
        }
        const role = item?.role !== undefined ? item.role : normalizeRoleReference(item?.reference ?? null);
        return Object.freeze({ slotId, roleKey, role: role ?? null });
      })
      .filter(Boolean),
  );
}

/**
 * The chips one post renders: the seat as named at the post, and a chip card
 * plus the full card its modal opens. A reveal without a reference keeps its
 * label and renders no chip.
 */
export function buildThreadRoleRevealViews(value, { names = seatNames(), at = null, testIdPrefix }) {
  return Object.freeze(
    normalizeThreadRoleReveals(value).map((reveal) => {
      const slotLabel = names.label(reveal.slotId, { at });
      const roleLabel = reveal.role?.name ?? humanizeRoleKey(reveal.roleKey);
      return Object.freeze({
        slotId: reveal.slotId,
        testId: `${testIdPrefix}-${reveal.slotId}`,
        slotLabel,
        roleLabel,
        ariaLabel: `${slotLabel} was ${roleLabel}: open role card`,
        chip: reveal.role === null ? null : buildRoleCardViewModel({ role: reveal.role, variant: "chip" }),
        card: reveal.role === null ? null : buildRoleCardViewModel({ role: reveal.role, variant: "full" }),
        minTouchTargetPx: THREAD_ROLE_REVEALS_CONTRACT.minTouchTargetPx,
      });
    }),
  );
}

function humanizeRoleKey(key) {
  const spaced = String(key).replaceAll("_", " ").replaceAll("-", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
