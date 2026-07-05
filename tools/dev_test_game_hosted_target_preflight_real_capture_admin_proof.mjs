import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameHostedTargetPreflightRealCaptureAdminProofPath,
  devTestGameHostedTargetPreflightRealCaptureProofSourcePath,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedTargetPreflightAdminProofCase,
} from "./dev_test_game_hosted_target_preflight_admin_proof.mjs";
import {
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import {
  devTestGameHostedMatrixRawEvidenceRealCaptureExamplePath,
} from "./dev_test_game_hosted_matrix_raw_evidence_fixture_proof.mjs";
import {
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import {
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const sourcePath = path.join(
  repoRoot,
  devTestGameHostedTargetPreflightRealCaptureProofSourcePath,
);
const evidencePath = path.join(
  repoRoot,
  devTestGameHostedTargetPreflightRealCaptureAdminProofPath,
);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const preflight = await buildDevTestGameHostedTargetPreflight({
    env: {
      ...process.env,
      FMARCH_HOSTED_MATRIX_FRONTEND_URL: "https://fmarch-demo.example.test",
      FMARCH_HOSTED_MATRIX_API_URL: "https://api.fmarch-demo.example.test",
      FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH:
        devTestGameHostedMatrixRawEvidenceRealCaptureExamplePath,
    },
  });
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, `${JSON.stringify(preflight, null, 2)}\n`);
  await runAdminAuditProof(
    hostedTargetPreflightAdminProofCase({
      preflightPath: sourcePath,
      evidencePath,
      requiredText: [
        "passed",
        devTestGameRealHostedMatrixRawCapturePath,
        devTestGameHostedMatrixRawEvidenceRealCaptureExamplePath,
        `npm run test:dev-test-game-hosted-matrix-external-evidence`,
        devTestGameHostedMatrixExternalEvidencePath,
        "release not ready",
        "production not ready",
      ],
    }),
  );
}

export {
  devTestGameHostedTargetPreflightPath,
  devTestGameHostedTargetPreflightRealCaptureAdminProofPath,
  devTestGameHostedTargetPreflightRealCaptureProofSourcePath,
};
