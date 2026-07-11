function assertCustomDescriptorText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`admin spine custom step requires ${field}`);
  }
}

function adminSpineCustomStepDescriptor({ label, script }) {
  assertCustomDescriptorText(script, "script");
  assertCustomDescriptorText(label, "label");
  return Object.freeze({ label, script });
}

export const adminSpineProofCustomStep = adminSpineCustomStepDescriptor({
  label: "Admin spine proof",
  script: "admin-spine-proof",
});

export const adminSpineTerminalValidationReceiptCustomStep =
  adminSpineCustomStepDescriptor({
    label: "Admin spine terminal validation receipt",
    script: "admin-spine-terminal-validation-receipt",
  });

export const adminSpineCustomStepRegistry = Object.freeze([
  adminSpineProofCustomStep,
  adminSpineTerminalValidationReceiptCustomStep,
]);

export function adminSpineCustomPlanStep(descriptor) {
  assertCustomDescriptorText(descriptor?.script, "script");
  assertCustomDescriptorText(descriptor?.label, "label");
  return {
    kind: "custom",
    script: descriptor.script,
    label: descriptor.label,
  };
}
