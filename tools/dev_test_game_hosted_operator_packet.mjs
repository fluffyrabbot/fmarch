import {
  assertHostedMatrixRawEvidenceTemplateDescriptor,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";

export function blockedOperatorPacketFromReceipt(receipt) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.status !== "blocked"
  ) {
    return null;
  }
  const artifact = receipt.firstMissingOperatorArtifact;
  if (artifact === null || typeof artifact !== "object") {
    return null;
  }
  const drilldown =
    artifact.roleSurfaceDrilldown !== null &&
    typeof artifact.roleSurfaceDrilldown === "object"
      ? artifact.roleSurfaceDrilldown
      : {};
  const packet = {
    status: "blocked",
    firstMissingInputId: String(artifact.inputId ?? ""),
    firstMissingCheckId: String(artifact.checkId ?? ""),
    firstMissingSectionId: String(artifact.sectionId ?? ""),
    firstMissingSectionLabel: String(artifact.sectionLabel ?? ""),
    firstMissingRequiredEvidence: String(artifact.requiredEvidence ?? ""),
    rawEvidenceContractSummary: String(
      receipt.rawEvidenceContractSummary ?? "",
    ),
    rawEvidenceContractRequiredTopLevelFields: Array.isArray(
      receipt.rawEvidenceContract?.requiredTopLevelFields,
    )
      ? receipt.rawEvidenceContract.requiredTopLevelFields.map((field) =>
          String(field),
        )
      : [],
    ...(receipt.rawEvidenceTemplate === undefined
      ? {}
      : {
          rawEvidenceTemplate:
            assertHostedMatrixRawEvidenceTemplateDescriptor(
              receipt.rawEvidenceTemplate,
            ),
        }),
    operatorAction: String(receipt.operatorAction ?? ""),
    localVsHostedBoundary: String(receipt.localVsHostedBoundary ?? ""),
    proofTarget: String(receipt.proofTarget ?? ""),
    nextProofTarget: String(receipt.nextProofTarget ?? ""),
    missingRequiredInputs: Array.isArray(receipt.missingRequiredInputs)
      ? receipt.missingRequiredInputs.map((input) => String(input))
      : [],
    selectedProductionFeatureGraphNodeId: String(
      drilldown.productionFeatureGraphNodeId ?? "",
    ),
    selectedProductionFeatureRoleUrl: String(
      drilldown.localCapabilityRoleUrl ?? "",
    ),
    roleSurfaceDrilldown: {
      localCapabilityAuditId: String(drilldown.localCapabilityAuditId ?? ""),
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffAuditId: String(drilldown.handoffAuditId ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    },
  };
  return assertBlockedOperatorPacket(packet);
}

export function assertBlockedOperatorPacket(packet) {
  if (
    packet === null ||
    typeof packet !== "object" ||
    packet.status !== "blocked" ||
    typeof packet.firstMissingInputId !== "string" ||
    packet.firstMissingInputId === "" ||
    typeof packet.firstMissingCheckId !== "string" ||
    packet.firstMissingCheckId === "" ||
    typeof packet.firstMissingSectionId !== "string" ||
    packet.firstMissingSectionId === "" ||
    typeof packet.firstMissingRequiredEvidence !== "string" ||
    packet.firstMissingRequiredEvidence === "" ||
    typeof packet.rawEvidenceContractSummary !== "string" ||
    packet.rawEvidenceContractSummary === "" ||
    !Array.isArray(packet.rawEvidenceContractRequiredTopLevelFields) ||
    packet.rawEvidenceContractRequiredTopLevelFields.length === 0 ||
    (packet.rawEvidenceTemplate !== undefined &&
      assertHostedMatrixRawEvidenceTemplateDescriptor(
        packet.rawEvidenceTemplate,
      ) === null) ||
    typeof packet.operatorAction !== "string" ||
    packet.operatorAction === "" ||
    typeof packet.localVsHostedBoundary !== "string" ||
    packet.localVsHostedBoundary === "" ||
    typeof packet.proofTarget !== "string" ||
    packet.proofTarget === "" ||
    typeof packet.nextProofTarget !== "string" ||
    packet.nextProofTarget === "" ||
    !Array.isArray(packet.missingRequiredInputs) ||
    (packet.missingRequiredInputs.length > 0 &&
      !packet.missingRequiredInputs.includes(packet.firstMissingInputId)) ||
    typeof packet.selectedProductionFeatureGraphNodeId !== "string" ||
    packet.selectedProductionFeatureGraphNodeId === "" ||
    typeof packet.selectedProductionFeatureRoleUrl !== "string" ||
    packet.selectedProductionFeatureRoleUrl === "" ||
    packet.roleSurfaceDrilldown === null ||
    typeof packet.roleSurfaceDrilldown !== "object" ||
    packet.roleSurfaceDrilldown.productionFeatureGraphNodeId !==
      packet.selectedProductionFeatureGraphNodeId ||
    packet.roleSurfaceDrilldown.localCapabilityRoleUrl !==
      packet.selectedProductionFeatureRoleUrl
  ) {
    throw new Error("hosted blocked operator packet drifted");
  }
  return packet;
}

export function visibleBlockedOperatorPacket(packet) {
  if (packet === null || packet === undefined) {
    return null;
  }
  const drilldown = packet.roleSurfaceDrilldown ?? {};
  return {
    status: String(packet.status ?? ""),
    firstMissingInputId: String(packet.firstMissingInputId ?? ""),
    firstMissingCheckId: String(packet.firstMissingCheckId ?? ""),
    firstMissingSectionId: String(packet.firstMissingSectionId ?? ""),
    firstMissingSectionLabel: String(packet.firstMissingSectionLabel ?? ""),
    firstMissingRequiredEvidence: String(
      packet.firstMissingRequiredEvidence ?? "",
    ),
    rawEvidenceContractSummary: String(
      packet.rawEvidenceContractSummary ?? "",
    ),
    rawEvidenceContractRequiredTopLevelFields: (
      packet.rawEvidenceContractRequiredTopLevelFields ?? []
    ).map((field) => String(field)),
    ...(packet.rawEvidenceTemplate === undefined
      ? {}
      : {
          rawEvidenceTemplate:
            assertHostedMatrixRawEvidenceTemplateDescriptor(
              packet.rawEvidenceTemplate,
            ),
        }),
    operatorAction: String(packet.operatorAction ?? ""),
    localVsHostedBoundary: String(packet.localVsHostedBoundary ?? ""),
    proofTarget: String(packet.proofTarget ?? ""),
    nextProofTarget: String(packet.nextProofTarget ?? ""),
    missingRequiredInputs: (packet.missingRequiredInputs ?? []).map((input) =>
      String(input),
    ),
    selectedProductionFeatureGraphNodeId: String(
      packet.selectedProductionFeatureGraphNodeId ?? "",
    ),
    selectedProductionFeatureRoleUrl: String(
      packet.selectedProductionFeatureRoleUrl ?? "",
    ),
    roleSurfaceDrilldown: {
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    },
  };
}

export function blockedOperatorPacketText(packet) {
  const visible = visibleBlockedOperatorPacket(packet);
  if (visible === null) {
    return [];
  }
  return [
    visible.status,
    visible.firstMissingInputId,
    visible.firstMissingCheckId,
    visible.firstMissingSectionId,
    visible.firstMissingSectionLabel,
    visible.firstMissingRequiredEvidence,
    visible.rawEvidenceContractSummary,
    ...visible.rawEvidenceContractRequiredTopLevelFields,
    ...(visible.rawEvidenceTemplate === undefined
      ? []
      : [
          visible.rawEvidenceTemplate.id,
          visible.rawEvidenceTemplate.status,
          visible.rawEvidenceTemplate.path,
          visible.rawEvidenceTemplate.proofCommand,
          visible.rawEvidenceTemplate.proofTarget,
          visible.rawEvidenceTemplate.copyToEnv,
          visible.rawEvidenceTemplate.validatorCommand,
          visible.rawEvidenceTemplate.validatorProofTarget,
        ]),
    visible.operatorAction,
    visible.localVsHostedBoundary,
    visible.proofTarget,
    visible.nextProofTarget,
    ...visible.missingRequiredInputs,
    visible.selectedProductionFeatureGraphNodeId,
    visible.selectedProductionFeatureRoleUrl,
    visible.roleSurfaceDrilldown.localCapabilityRoleUrl,
    visible.roleSurfaceDrilldown.handoffRoleUrl,
    visible.roleSurfaceDrilldown.proofGraphNodeId,
    visible.roleSurfaceDrilldown.productionFeatureGraphNodeId,
    visible.roleSurfaceDrilldown.proofGraphEvidencePath,
  ];
}
