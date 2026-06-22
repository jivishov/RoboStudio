import { runCircuitLabTest } from "./testBench.js";

function issueBlocks(issues, field) {
  return issues.some((issue) => issue.blocks?.[field] || issue.severity === "error");
}

function bindingStatus(mechatronicsBinding) {
  if (!mechatronicsBinding) return "absent";
  const diagnostics = Array.isArray(mechatronicsBinding.diagnostics) ? mechatronicsBinding.diagnostics : [];
  if (diagnostics.some((item) => item.severity === "error")) return "blocked";
  const channels = Array.isArray(mechatronicsBinding.channels) ? mechatronicsBinding.channels : [];
  const actuatorBindings = Array.isArray(mechatronicsBinding.actuatorBindings) ? mechatronicsBinding.actuatorBindings : [];
  const sensorBindings = Array.isArray(mechatronicsBinding.sensorBindings) ? mechatronicsBinding.sensorBindings : [];
  return channels.length || actuatorBindings.length || sensorBindings.length ? "ready" : "partial";
}

function unresolvedCriticalMetadataCount(project) {
  if (!project) return 0;
  return (project.components ?? []).filter((component) => {
    const overrides = component.props?.engineeringOverrides ?? {};
    const hasCurrent = Number.isFinite(Number(overrides.typicalCurrentMa))
      || Number.isFinite(Number(overrides.peakCurrentMa))
      || Number.isFinite(Number(overrides.stallCurrentMa));
    return !hasCurrent && /servo|motor/i.test(`${component.typeId} ${component.name}`);
  }).length;
}

export function evaluateCircuitReadiness({ circuitLabProject = null, robotDesign = null, mechatronicsBinding = null } = {}) {
  if (!circuitLabProject) {
    return {
      electrical: { status: "absent" },
      binding: { status: bindingStatus(mechatronicsBinding) },
      source: { status: "blocked" },
      build: { status: "blocked" },
      sourceMappingAllowed: false,
      semanticRunAllowed: false,
      overallStatus: "absent",
      errorCount: 0,
      warningCount: 0,
      unresolvedCriticalMetadataCount: 0
    };
  }

  const test = runCircuitLabTest(circuitLabProject);
  const errorCount = test.summary.errors;
  const warningCount = test.summary.warnings;
  const metadataCount = unresolvedCriticalMetadataCount(circuitLabProject);
  const electricalStatus = errorCount
    ? "blocked"
    : metadataCount
      ? "review-required"
      : warningCount
        ? "ready-with-warnings"
        : "ready";
  const binding = bindingStatus(mechatronicsBinding);
  const sourceMappingAllowed = !issueBlocks(test.issues, "sourceMapping") && Boolean(circuitLabProject.controllerId);
  const semanticRunAllowed = sourceMappingAllowed && binding === "ready" && Boolean(robotDesign);
  const sourceStatus = sourceMappingAllowed ? (semanticRunAllowed ? "robot-ready" : "standalone-ready") : "blocked";
  const buildStatus = errorCount ? "blocked" : metadataCount || warningCount ? "review-required" : "ready";
  const overallStatus = errorCount
    ? "blocked"
    : semanticRunAllowed
      ? "ready"
      : warningCount || metadataCount
        ? "review-required"
        : "ready-with-warnings";

  return {
    electrical: { status: electricalStatus },
    binding: { status: binding },
    source: { status: sourceStatus },
    build: { status: buildStatus },
    sourceMappingAllowed,
    semanticRunAllowed,
    overallStatus,
    errorCount,
    warningCount,
    unresolvedCriticalMetadataCount: metadataCount
  };
}
