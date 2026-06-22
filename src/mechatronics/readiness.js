import { evaluateCircuitReadiness } from "../circuits/readiness.js";
import { validateMechatronicsBinding } from "./validation.js";

function bindingStatus(validation) {
  if (!validation.binding.actuatorBindings.length && !validation.binding.sensorBindings.length && !validation.binding.firmwareChannels.length) {
    return "absent";
  }
  if (validation.diagnostics.some((item) => item.severity === "error")) return "blocked";
  const { boundActuators, eligibleActuators, boundSensors, totalSensors } = validation.coverage;
  if (boundActuators < eligibleActuators || boundSensors < totalSensors) return "partial";
  return "ready";
}

export function evaluateMechatronicsReadiness({ robotDesign = null, circuitLabProject = null, mechatronicsBinding = null } = {}) {
  const validation = validateMechatronicsBinding({ robotDesign, circuitLabProject, binding: mechatronicsBinding });
  const binding = bindingStatus(validation);
  const circuit = evaluateCircuitReadiness({
    circuitLabProject,
    robotDesign,
    mechatronicsBinding: {
      ...validation.binding,
      diagnostics: validation.diagnostics,
      channels: validation.binding.firmwareChannels
    }
  });
  const semanticRunAllowed = circuit.sourceMappingAllowed && binding === "ready";
  const overallStatus = circuit.electrical.status === "blocked" || binding === "blocked"
    ? "blocked"
    : binding === "ready" && semanticRunAllowed
      ? "ready"
      : binding === "absent"
        ? "partial"
        : "review-required";

  return {
    ...circuit,
    binding: { status: binding },
    validation,
    sourceMappingAllowed: circuit.sourceMappingAllowed,
    semanticRunAllowed,
    overallStatus,
    coverage: validation.coverage
  };
}
