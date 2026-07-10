function publicResolution(prompt) {
  return prompt?.public_resolution ?? prompt?.publicResolution ?? null;
}

export function matchesDayVoteElimination(
  prompt,
  { phaseId, selectedSlot, reason },
) {
  const resolution = publicResolution(prompt);
  return (
    resolution?.kind === "day_vote_elimination" &&
    resolution?.phase_id === phaseId &&
    resolution?.selected_slot === selectedSlot &&
    resolution?.reason === reason
  );
}

export function matchesPhaseAdvance(
  prompt,
  { sourcePhaseId, targetPhaseId, reason, skippedPhaseId = null },
) {
  const resolution = publicResolution(prompt);
  return (
    resolution?.kind === "phase_advance" &&
    resolution?.source_phase_id === sourcePhaseId &&
    resolution?.target_phase_id === targetPhaseId &&
    resolution?.reason === reason &&
    (resolution?.skipped_phase_id ?? null) === skippedPhaseId
  );
}
