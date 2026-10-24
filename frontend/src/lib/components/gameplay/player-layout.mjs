// The player workspace has two hydrated topologies (usage-frequency audit,
// decision 9). Below the rail width, Vote and More are bottom sheets opened
// from the dock; from the rail width up, the frame is two columns with a
// sticky rail and no dock. Server output and no-JavaScript readers get the
// "flow" topology: every sheet is an ordinary section after the composer.
export const PLAYER_RAIL_MIN_WIDTH_PX = 1100;
export const PLAYER_RAIL_MEDIA_QUERY = `(min-width: ${PLAYER_RAIL_MIN_WIDTH_PX}px)`;
export const PLAYER_LAYOUTS = Object.freeze(["flow", "sheet", "rail"]);

export function playerLayoutFor(railMatches) {
  return railMatches === true ? "rail" : "sheet";
}

/** Reports the hydrated layout now and on every crossing of the rail width. */
export function observePlayerLayout(windowRef, onChange) {
  if (typeof windowRef?.matchMedia !== "function") {
    onChange("sheet");
    return () => {};
  }
  const query = windowRef.matchMedia(PLAYER_RAIL_MEDIA_QUERY);
  const notify = () => onChange(playerLayoutFor(query.matches));
  notify();
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
