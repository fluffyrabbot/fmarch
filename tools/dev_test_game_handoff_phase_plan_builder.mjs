import {
  phaseLocalNextActionStep,
} from "./dev_test_game_spine_runner.mjs";
import {
  releaseReadinessStep,
} from "./dev_test_game_spine_readiness_steps.mjs";

export function handoffDescriptorPlanStep(
  descriptor,
  { readinessEnv, customPlanForScript } = {},
) {
  if (descriptor.phaseLocalNextAction !== undefined) {
    return {
      step: descriptor.step,
      planStep: phaseLocalNextActionStep(descriptor.phaseLocalNextAction),
    };
  }
  if (descriptor.readinessReason !== undefined) {
    return {
      step: descriptor.step,
      planStep: releaseReadinessStep({
        reason: descriptor.readinessReason,
        changedInputs: descriptor.changedInputs,
        env: readinessEnv,
      }),
    };
  }
  if (descriptor.kind === "custom") {
    return customHandoffDescriptorPlanStep(descriptor, { customPlanForScript });
  }
  return {
    step: descriptor.step,
    planStep: {
      kind: descriptor.kind,
      script: descriptor.script,
      ...(descriptor.env === undefined ? {} : { env: descriptor.env }),
    },
    outputs: descriptor.artifacts,
  };
}

function customHandoffDescriptorPlanStep(descriptor, { customPlanForScript }) {
  if (typeof customPlanForScript !== "function") {
    throw new Error(
      `custom handoff descriptor ${descriptor.step} is missing a plan resolver`,
    );
  }
  const plan = customPlanForScript(descriptor.script);
  if (plan.label !== descriptor.label) {
    throw new Error(
      `custom handoff descriptor ${descriptor.step} label drifted from registry`,
    );
  }
  return {
    step: descriptor.step,
    planStep: {
      kind: descriptor.kind,
      script: plan.script,
      label: plan.label,
    },
    outputs: descriptor.artifacts,
  };
}
