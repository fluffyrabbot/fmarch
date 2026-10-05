// Absence from a paginated window is not evidence that an original is gone.
// Unavailable sequences must come from a scoped authorized read or removal event.
export function quotationOriginalState(original, confirmedUnavailable = false) {
  if (original?.retracted === true) return "unavailable";
  if (original !== undefined) return "loaded";
  return confirmedUnavailable ? "unavailable" : "unresolved";
}
