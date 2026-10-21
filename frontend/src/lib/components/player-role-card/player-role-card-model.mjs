import { buildRoleCardViewModel } from "../role-card/role-card-model.mjs";

export const PLAYER_ROLE_CARD_CONTRACT = Object.freeze({
  proofCheckId: "player-role-card",
  rootClassName: "player-role-card fm-proof-disclosure",
  rootTestId: "player-role-card",
  nameTestId: "player-role-card-name",
  alignmentTestId: "player-role-card-alignment",
  descriptionTestId: "player-role-card-description",
  statusTestId: "player-role-card-status",
  componentName: "player-role-card",
});

// Leak boundary: this card reads only the self-scoped command state, so it can
// never show another slot's role. Dead and replaced actors keep their own card.
export function buildPlayerRoleCardViewModel({
  commandState = {},
  player = {},
} = {}) {
  const role = commandState?.role ?? null;
  const roleKey = role?.key ?? commandState?.roleKey ?? null;
  const actorStatus = String(
    commandState?.actorStatus ?? player.status ?? "",
  ).trim();
  const identity = resolveRoleIdentity({ role, roleKey, actorStatus });

  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_ROLE_CARD_CONTRACT.rootClassName,
      testId: PLAYER_ROLE_CARD_CONTRACT.rootTestId,
      data: Object.freeze({
        component: PLAYER_ROLE_CARD_CONTRACT.componentName,
        proofCheckId: PLAYER_ROLE_CARD_CONTRACT.proofCheckId,
        roleState: identity.state,
        roleKey: roleKey ?? "",
        roleAlignment: role?.alignment ?? "",
      }),
    }),
    heading: "Your role",
    proofCheckId: PLAYER_ROLE_CARD_CONTRACT.proofCheckId,
    name: Object.freeze({
      testId: PLAYER_ROLE_CARD_CONTRACT.nameTestId,
      value: identity.name,
    }),
    alignment: Object.freeze({
      testId: PLAYER_ROLE_CARD_CONTRACT.alignmentTestId,
      label: identity.alignmentLabel,
    }),
    description: Object.freeze({
      testId: PLAYER_ROLE_CARD_CONTRACT.descriptionTestId,
      value: identity.description,
    }),
    // The full role card, built from this actor's own role reference only.
    roleCard: identity.roleCard,
    referenceHref: identity.referenceHref ?? null,
    status: Object.freeze({
      testId: PLAYER_ROLE_CARD_CONTRACT.statusTestId,
      state: identity.state === "assigned" ? "ack" : "pending",
      message: identity.statusMessage,
    }),
  });
}

function resolveRoleIdentity({ role, roleKey, actorStatus }) {
  if (roleKey === null || roleKey === "") {
    if (actorStatus === "pending_replacement") {
      return Object.freeze({
        state: "pending_replacement",
        name: "Role pending",
        alignmentLabel: "Pending",
        description:
          "Your seat is being handed to a replacement; your role shows again once the host completes it.",
        statusMessage: "Waiting for the host to complete the replacement",
        roleCard: null,
      });
    }
    // Roles are dealt when the game starts; a seated player is never told
    // they are "unassigned" (RFC 0008, decision 5).
    return Object.freeze({
      state: "unassigned",
      name: "Your role arrives when the game starts",
      alignmentLabel: "Before start",
      description: "The host deals roles when the game starts. Yours will appear here.",
      statusMessage: "Your role arrives when the game starts",
      roleCard: null,
    });
  }
  if (role === null) {
    return Object.freeze({
      state: "unpublished",
      name: humanizeRoleTag(roleKey),
      alignmentLabel: "In your role PM",
      description: "Your role PM holds the full text of your role.",
      statusMessage: "Read your role PM for the full text",
      roleCard: null,
    });
  }
  const reference = role.reference ?? null;
  if (reference !== null) {
    return Object.freeze({
      state: "assigned",
      name: reference.name,
      alignmentLabel: reference.alignment.label,
      description: reference.summary,
      statusMessage: "Your role for this game",
      roleCard: buildRoleCardViewModel({ role: reference, variant: "full", bare: true }),
      referenceHref: `/roles?${new URLSearchParams({ pack: reference.packKey, role: reference.key })}`,
    });
  }
  // Packs without presentation (test fixtures) fall back to the raw role.
  return Object.freeze({
    state: "assigned",
    name: humanizeRoleTag(role.key),
    alignmentLabel:
      role.alignment === null || role.alignment === undefined || role.alignment === ""
        ? "Unaligned"
        : humanizeRoleTag(role.alignment),
    description:
      String(role.description ?? "").trim() === ""
        ? "This role has no published description."
        : String(role.description),
    statusMessage: "Your role for this game",
    roleCard: null,
  });
}

export function humanizeRoleTag(tag) {
  const spaced = String(tag ?? "").replaceAll("_", " ").trim();
  if (spaced === "") {
    return "Unknown";
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
