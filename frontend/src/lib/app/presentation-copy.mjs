// The sentence a person reads for what they hold in a game ("Hosting
// Midsummer Invitational"). It takes the typed capability and the game's
// title; capability kinds and game ids never reach the text.
export function capabilitySentence(capability, { gameTitle = null } = {}) {
  const title = typeof gameTitle === "string" && gameTitle.trim() !== "" ? gameTitle : "this game";
  switch (capability?.kind) {
    case "GlobalAdmin":
      return "Site administrator";
    case "GlobalMod":
      return "Community moderator";
    case "HostOf":
      return `Hosting ${title}`;
    case "CohostOf":
      return `Co-hosting ${title}`;
    case "SlotOccupant":
    case "ChannelMember":
      return `Playing ${title}`;
    case "PendingReplacement":
      return `Joining ${title} as a replacement`;
    case "DeadViewer":
    case "SpectatorOf":
      return `Watching ${title}`;
    default:
      return gameTitle === null ? "Signed in" : `Reading ${title}`;
  }
}

const AUTHORITY_NOUNS = Object.freeze({
  GlobalAdmin: "site administrators",
  GlobalMod: "community moderators",
  HostOf: "the game's host",
  CohostOf: "co-hosts",
});

// Who may use an operator control, from the capability kinds it requires
// ("Site administrators or community moderators").
export function authoritySentence(kinds = []) {
  const nouns = (Array.isArray(kinds) ? kinds : [])
    .map((kind) => AUTHORITY_NOUNS[kind])
    .filter(Boolean);
  if (nouns.length === 0) {
    return "Signed-in accounts";
  }
  const text = nouns.join(" or ");
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

export function packLabel(pack) {
  return pack
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
