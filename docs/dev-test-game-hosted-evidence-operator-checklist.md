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

1. Prove this checklist contract: `npm run test:dev-test-game-hosted-evidence-operator-checklist`
2. Validate the raw evidence template: `npm run test:dev-test-game-hosted-matrix-raw-evidence-template-proof`
3. Capture or validate the real hosted raw packet: `npm run test:dev-test-game-real-hosted-matrix-raw-capture`
4. Recheck hosted target preflight: `npm run test:dev-test-game-hosted-target-preflight`
5. Rerun the hosted evidence lane: `npm run test:dev-test-game-hosted-evidence-lane`

## Direct Operator Run Sequence

| Step | Command | Proof Target |
| --- | --- | --- |
| Prove checklist contract | `npm run test:dev-test-game-hosted-evidence-operator-checklist` | `target/dev-test-game/hosted-evidence-operator-checklist-proof.json` |
| Validate raw evidence template | `npm run test:dev-test-game-hosted-matrix-raw-evidence-template-proof` | `target/dev-test-game/hosted-matrix-raw-evidence-template-proof.json` |
| Validate operator raw capture | `npm run test:dev-test-game-real-hosted-matrix-raw-capture` | `target/dev-test-game/real-hosted-matrix-raw-capture.json` |
| Recheck hosted target preflight | `npm run test:dev-test-game-hosted-target-preflight` | `target/dev-test-game/hosted-target-preflight.json` |
| Rerun hosted evidence lane | `npm run test:dev-test-game-hosted-evidence-lane` | `target/dev-test-game/hosted-evidence-lane.json` |

## Artifacts

- Checklist: `docs/dev-test-game-hosted-evidence-operator-checklist.md`
- Checklist proof target: `target/dev-test-game/hosted-evidence-operator-checklist-proof.json`
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
