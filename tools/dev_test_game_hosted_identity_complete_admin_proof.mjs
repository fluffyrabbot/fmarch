import { pathToFileURL } from "node:url";
import {
  writeHostedIdentityCompleteAdminProof,
} from "./dev_test_game_hosted_identity_evidence_admin_proof.mjs";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await writeHostedIdentityCompleteAdminProof();
}
