export const DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION = 1;
export const hostedMatrixRawEvidenceContract = Object.freeze({
  version: DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION,
  proof: "fmarch-hosted-concurrent-race-matrix-raw",
  status: "passed",
  requiredTopLevelFields: Object.freeze([
    "frontendBaseUrl",
    "apiBaseUrl",
    "groupId",
    "commandRaceCount",
    "reloadRecoveryCount",
    "reconnectRecovery",
    "staleConflictMessages",
    "rawRoleCredentialsRedacted",
    "observations",
  ]),
  requiredObservationFields: Object.freeze([
    "cellId",
    "raceLaneId",
    "reloadLaneId",
    "roleSurfaces",
  ]),
  requiredInvariants: Object.freeze([
    "frontendBaseUrl, apiBaseUrl, and groupId match the configured hosted target",
    "commandRaceCount and reloadRecoveryCount cover the promoted group cells",
    "reconnectRecovery and staleConflictMessages are true",
    "rawRoleCredentialsRedacted is true",
    "observations include every promoted group cell",
  ]),
});

export function hostedMatrixRawEvidenceContractSummary() {
  return [
    "Raw hosted matrix evidence packet",
    "proof=fmarch-hosted-concurrent-race-matrix-raw",
    "status=passed",
    "matching frontendBaseUrl/apiBaseUrl/groupId",
    "commandRaceCount/reloadRecoveryCount for promoted cells",
    "reconnectRecovery=true",
    "staleConflictMessages=true",
    "rawRoleCredentialsRedacted=true",
    "per-cell observations",
  ].join("; ");
}
