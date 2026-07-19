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
    heading: "Role identity",
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
          "Slot authority is pending host replacement; the role card unlocks once the host processes the replacement.",
        statusMessage: "Role identity is pending host replacement",
      });
    }
    return Object.freeze({
      state: "unassigned",
      name: "No role assigned",
      alignmentLabel: "Unassigned",
      description: "The host has not assigned a role to this slot yet.",
      statusMessage: "No role is assigned to this slot",
    });
  }
  if (role === null) {
    return Object.freeze({
      state: "unpublished",
      name: humanizeRoleTag(roleKey),
      alignmentLabel: "Not published",
      description:
        "Role details are not published to this surface; your Role PM channel remains the authoritative text.",
      statusMessage: "Role details are not published to this surface",
    });
  }
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
    statusMessage: "Role identity is read from your slot's command state",
  });
}

export function humanizeRoleTag(tag) {
  const spaced = String(tag ?? "").replaceAll("_", " ").trim();
  if (spaced === "") {
    return "Unknown";
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
