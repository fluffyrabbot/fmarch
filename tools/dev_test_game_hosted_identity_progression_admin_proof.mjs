import { pathToFileURL } from "node:url";
import {
  writeHostedIdentityProgressionAdminProof,
} from "./dev_test_game_hosted_identity_evidence_admin_proof.mjs";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await writeHostedIdentityProgressionAdminProof({
    progressionId:
      process.env.FMARCH_HOSTED_IDENTITY_PROGRESSION_ID ?? process.argv[2],
  });
}
