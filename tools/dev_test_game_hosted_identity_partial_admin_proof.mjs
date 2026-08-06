// Deprecated alias of progression/evidence admin-proof — do not add more re-export-only *-admin-proof scripts (docs/ops/proof-product-freeze.md).
import { pathToFileURL } from "node:url";
import {
  writeHostedIdentityPartialOperatorAdminProof,
} from "./dev_test_game_hosted_identity_evidence_admin_proof.mjs";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await writeHostedIdentityPartialOperatorAdminProof();
}
