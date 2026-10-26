// A game surface has two hydrated topologies (usage-frequency audit,
// decisions 9 and 11). Below the rail width its secondary surfaces are bottom
// sheets opened from a dock or a strip; from the rail width up the frame is
// two columns with a sticky rail. Server output and no-JavaScript readers get
// the "flow" topology: every sheet is an ordinary section after the composer.
export const GAME_RAIL_MIN_WIDTH_PX = 1100;
export const GAME_RAIL_MEDIA_QUERY = `(min-width: ${GAME_RAIL_MIN_WIDTH_PX}px)`;
export const GAME_LAYOUTS = Object.freeze(["flow", "sheet", "rail"]);
/** A crossing must hold this long before the topology follows it. */
export const GAME_LAYOUT_SETTLE_MS = 120;

export function gameLayoutFor(railMatches) {
  return railMatches === true ? "rail" : "sheet";
}

/**
 * Reports the hydrated layout now and after every settled crossing of the
 * rail width. Crossing the width rebuilds the sheets or the rail, which drops
 * whatever they held (an armed confirmation, a scroll position), so a blip
 * that crosses and returns within the settle time is not a crossing.
 */
export function observeGameLayout(windowRef, onChange, { settleMs = GAME_LAYOUT_SETTLE_MS } = {}) {
  if (typeof windowRef?.matchMedia !== "function") {
    onChange("sheet");
    return () => {};
  }
  const query = windowRef.matchMedia(GAME_RAIL_MEDIA_QUERY);
  const setTimer = windowRef.setTimeout ?? globalThis.setTimeout;
  const clearTimer = windowRef.clearTimeout ?? globalThis.clearTimeout;
  let reported = gameLayoutFor(query.matches);
  let timer = null;
  onChange(reported);
  const settle = () => {
    timer = null;
    const next = gameLayoutFor(query.matches);
    if (next !== reported) {
      reported = next;
      onChange(next);
    }
  };
  const crossed = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(settle, settleMs);
  };
  query.addEventListener("change", crossed);
  return () => {
    if (timer !== null) clearTimer(timer);
    query.removeEventListener("change", crossed);
  };
}
