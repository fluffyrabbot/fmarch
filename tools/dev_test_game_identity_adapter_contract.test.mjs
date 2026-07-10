import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDevTestGameIdentityAdapterContractPacket,
  buildDevTestGameIdentityAdapterContractPacket,
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterExpectedContract,
  devTestGameIdentityAdapterProofVersion,
} from "./dev_test_game_identity_adapter_contract.mjs";

test("identity adapter contract preserves shared role-surface architecture", () => {
  const packet = buildDevTestGameIdentityAdapterContractPacket();
  assert.equal(devTestGameIdentityAdapterProofVersion, 14);
  assert.equal(packet.status, "passed");
  assert.equal(packet.adapterId, "local-production-identity-adapter-v1");
  assert.equal(
    packet.roleSurfaceContract.architectureId,
    "seeded-role-url-plus-session-adapter-v1",
  );
  assertDevTestGameIdentityAdapterContractPacket(packet);
  assert.equal(devTestGameIdentityAdapterContractDiff(packet).status, "passed");

  const changed = {
    ...packet,
    roleSurfaceArchitectureChanged: true,
    roleSurfaceContract: {
      ...packet.roleSurfaceContract,
      roleUrlPatterns: [
        ...packet.roleSurfaceContract.roleUrlPatterns,
        { id: "account-url", href: "/accounts/:accountId" },
      ],
    },
  };
  const diff = devTestGameIdentityAdapterContractDiff(changed);
  assert.equal(diff.status, "blocked");
  assert.deepEqual(
    diff.roleSurfaceContractDiff.mismatches.map((mismatch) => mismatch.path),
    [
      "hostedIdentity.roleSurfaceArchitectureChanged",
      "hostedIdentity.roleSurfaceContract.roleUrlPatterns.length",
    ],
  );
  assert.equal(
    devTestGameIdentityAdapterExpectedContract.browserCookieName,
    "fmarch_session",
  );
  assert.equal(devTestGameIdentityAdapterExpectedContract.passwordAlgorithm, "argon2id");
  assert.ok(
    devTestGameIdentityAdapterExpectedContract.lifecycleControls.includes(
      "account-password-rotation",
    ),
  );
  assert.equal(
    devTestGameIdentityAdapterExpectedContract.credentialKinds.recovery,
    "hashed-single-use-recovery-credential",
  );
  assert.ok(
    devTestGameIdentityAdapterExpectedContract.lifecycleControls.includes(
      "account-recovery",
    ),
  );
});
