# Dev-Test-Game Hosted Evidence Operator Checklist

This checklist is the source-controlled operator contract for unblocking the hosted-deployment release-readiness row. It does not prove hosted deployment by itself; it names the real hosted inputs and proof commands the generated lane must receive.

## Required Inputs

| Input | Required | Purpose |
| --- | --- | --- |
| `FMARCH_HOSTED_MATRIX_FRONTEND_URL` | yes | Externally reachable frontend base URL. |
| `FMARCH_HOSTED_MATRIX_API_URL` | yes | Externally reachable API base URL for the same hosted deployment. |
| `FMARCH_HOSTED_MATRIX_GROUP_ID` | yes | Hosted matrix group to prove. |
| `FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH` | yes | Raw hosted matrix evidence packet; proof=fmarch-hosted-concurrent-race-matrix-raw; status=passed; matching frontendBaseUrl/apiBaseUrl/groupId; commandRaceCount/reloadRecoveryCount for promoted cells; reconnectRecovery=true; staleConflictMessages=true; rawRoleCredentialsRedacted=true; per-cell observations filled from tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.template.json. |
| `FMARCH_HOSTED_MATRIX_EVIDENCE_PATH` | no | Optional normalized hosted matrix evidence output path. |

## Proof Commands

1. Validate the raw evidence template: `npm run test:dev-test-game-hosted-matrix-raw-evidence-template-proof`
2. Capture or validate the real hosted raw packet: `npm run test:dev-test-game-real-hosted-matrix-raw-capture`
3. Rerun the hosted evidence lane: `npm run test:dev-test-game-hosted-evidence-lane`

## Artifacts

- Checklist: `docs/dev-test-game-hosted-evidence-operator-checklist.md`
- Hosted lane proof target: `target/dev-test-game/hosted-evidence-lane.json`
- Hosted target preflight target: `target/dev-test-game/hosted-target-preflight.json`
- Raw evidence template: `tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.template.json`
- Raw capture proof target: `target/dev-test-game/real-hosted-matrix-raw-capture.json`

## Blocked Checks

- `hosted-frontend-url-configured`
- `hosted-api-url-configured`
- `hosted-targets-external`
- `raw-evidence-path-configured`
- `raw-evidence-readable`
- `raw-evidence-real-hosted-target`

## Boundary

Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.
