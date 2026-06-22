import { analyzeCircuit, currentScenarioForComponent, terminalVoltageRange } from "./electricalAnalysis.js";
import { endpointLabel, resolveTerminal } from "./connectivity.js";
import { normalizeProject, serializeCircuitLabProject } from "./model.js";
import { runCircuitLabTest } from "./testBench.js";
import { catalog } from "./catalog.js";
import { normalizeMechatronicsBinding } from "../mechatronics/model.js";
import { evaluateMechatronicsReadiness } from "../mechatronics/readiness.js";
import { validateMechatronicsBinding } from "../mechatronics/validation.js";

export const BUILD_CHECKLIST_STEPS = Object.freeze([
  { id: "confirm-ratings", label: "Confirm actual part ratings against catalog assumptions." },
  { id: "power-off", label: "Keep all power off." },
  { id: "inspect-polarity", label: "Inspect polarity." },
  { id: "inspect-connectors", label: "Inspect connector orientation." },
  { id: "ground-strategy", label: "Verify supply and controller ground strategy." },
  { id: "logic-compatibility", label: "Verify logic-voltage compatibility." },
  { id: "actuator-distribution", label: "Verify actuator distribution and wire gauge." },
  { id: "driver-protection", label: "Check driver and protection devices." },
  { id: "continuity", label: "Perform continuity and direct-short checks." },
  { id: "controller-first", label: "Power the controller without actuator power." },
  { id: "one-path-at-a-time", label: "Power one actuator/sensor path at a time." },
  { id: "current-limiting", label: "Use current limiting where available." },
  { id: "stop-on-fault", label: "Stop immediately on overheating, odor, unexpected motion, or voltage collapse." },
  { id: "source-not-tested", label: "Confirm that generated source has not been compiled or hardware-tested by RoboStudio." }
]);

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeRowsCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n") + "\n";
}

function sourceSymbol(channelId) {
  return String(channelId ?? "channel")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "CHANNEL";
}

function bindingForChannel(binding, channelId) {
  const actuator = binding.actuatorBindings.find((item) => item.firmwareChannelIds.includes(channelId));
  if (actuator) return { type: "actuator", item: actuator };
  const sensor = binding.sensorBindings.find((item) => item.firmwareChannelIds.includes(channelId));
  if (sensor) return { type: "sensor", item: sensor };
  return { type: "unbound", item: null };
}

function buildPinMap(project, binding, validation) {
  const diagnosticByChannel = new Map();
  for (const diagnostic of validation.diagnostics ?? []) {
    const channelId = diagnostic.targets?.channelId;
    if (!channelId) continue;
    if (!diagnosticByChannel.has(channelId)) diagnosticByChannel.set(channelId, []);
    diagnosticByChannel.get(channelId).push(diagnostic);
  }
  return binding.firmwareChannels.map((channel) => {
    const linked = bindingForChannel(binding, channel.id);
    const controller = resolveTerminal(project, channel.controllerTerminalRef);
    const device = resolveTerminal(project, channel.deviceTerminalRef);
    const controllerLabel = controller.ok ? controller.terminal.label ?? controller.terminal.id : "";
    const capabilityStatus = diagnosticByChannel.has(channel.id) ? "blocked" : "ok";
    return {
      "binding type": linked.type,
      "joint or sensor ID": linked.item?.jointId ?? linked.item?.sensorId ?? "",
      "actuator or sensor ID": linked.item?.actuatorId ?? linked.item?.sensorId ?? "",
      "circuit component ID": linked.item?.circuitComponentId ?? channel.deviceTerminalRef?.componentId ?? "",
      "firmware channel ID": channel.id,
      "semantic role": channel.semanticRole,
      "signal type": channel.signalType,
      direction: channel.direction,
      "controller component ID": channel.controllerTerminalRef?.componentId ?? "",
      "controller terminal ID": channel.controllerTerminalRef?.terminalId ?? "",
      "physical pin label": controllerLabel,
      "device component ID": channel.deviceTerminalRef?.componentId ?? "",
      "device terminal ID": channel.deviceTerminalRef?.terminalId ?? "",
      "voltage domain": device.ok ? device.terminal.voltageDomainId ?? "" : "",
      "capability status": capabilityStatus,
      "generated source symbol": sourceSymbol(channel.id)
    };
  });
}

function connectorSummary(definition) {
  return (definition.engineering?.connectors ?? [])
    .map((connector) => `${connector.family}${connector.pinPitchMm ? ` ${connector.pinPitchMm}mm` : ""}`)
    .join("; ");
}

function voltageSummary(definition) {
  return (definition.engineering?.voltageDomains ?? [])
    .map((domain) => `${domain.id}:${domain.minimumV ?? "?"}-${domain.maximumV ?? "?"}V nominal ${domain.nominalV ?? "?"}V`)
    .join("; ");
}

function overrideSignature(component) {
  const overrides = component.props?.engineeringOverrides ?? null;
  if (!overrides || typeof overrides !== "object" || !Object.keys(overrides).length) return "";
  return Object.keys(overrides)
    .sort()
    .map((key) => `${key}:${overrides[key]}`)
    .join("; ");
}

function buildBom(project) {
  const groups = new Map();
  for (const component of project.components) {
    const signature = overrideSignature(component);
    const key = `${component.typeId}::${signature}`;
    if (!groups.has(key)) groups.set(key, { typeId: component.typeId, signature, instances: [] });
    groups.get(key).instances.push(component);
  }
  return [...groups.values()].map(({ typeId, signature, instances }) => {
    const definition = catalog.getComponent(typeId);
    const current = currentScenarioForComponent(instances[0], definition);
    const reviewRequired = definition?.engineering?.specificationBasis === "generic" ? "yes" : "no";
    return {
      quantity: instances.length,
      "catalog type ID": typeId,
      "generic description": definition?.name ?? typeId,
      "robotics role": definition?.engineering?.robotics?.role ?? definition?.sim?.role ?? "",
      "project instance names": instances.map((component) => component.name).join("; "),
      "accepted/nominal voltage": voltageSummary(definition),
      "idle current mA": current.idle ?? "",
      "typical current mA": current.typical ?? "",
      "peak current mA": current.peak ?? "",
      "stall current mA": current.stall ?? "",
      "connector family": connectorSummary(definition),
      "pin pitch": (definition?.engineering?.connectors ?? []).map((connector) => connector.pinPitchMm ?? "unknown").join("; "),
      polarity: definition?.engineering?.polarity ?? "",
      "instance engineering overrides": signature || "catalog default",
      "protection notes": Object.entries(definition?.engineering?.protection ?? {}).map(([key, value]) => `${key}:${value ?? ""}`).join("; "),
      "specification basis": definition?.engineering?.specificationBasis ?? "generic",
      "review required": reviewRequired
    };
  });
}

function recommendedWireColor(resolvedEndpoints) {
  return resolvedEndpoints.map((endpoint) => endpoint.terminal.recommendedWireColor).filter(Boolean)[0] ?? "";
}

function recommendedGauge(resolvedEndpoints) {
  return resolvedEndpoints.map((endpoint) => endpoint.terminal.recommendedGaugeAwg).filter((value) => value != null)[0] ?? "";
}

function netRole(resolvedEndpoints) {
  if (resolvedEndpoints.some((endpoint) => endpoint.terminal.electricalRole === "ground")) return "ground";
  if (resolvedEndpoints.some((endpoint) => endpoint.terminal.electricalRole === "power-source" || endpoint.terminal.electricalRole === "power-input")) return "power";
  if (resolvedEndpoints.some((endpoint) => endpoint.terminal.kind === "signal")) return "signal";
  return "passive";
}

function connectorAt(resolved) {
  const connector = resolved.componentDefinition.engineering?.connectors?.find((item) => item.id === resolved.terminal.connectorId);
  return `${resolved.endpoint.componentId}.${resolved.endpoint.terminalId}:${connector?.family ?? "unknown"}`;
}

function buildHarness(project) {
  return project.connections.map((connection) => {
    const endpoints = connection.endpoints.map((endpoint) => resolveTerminal(project, endpoint)).filter((resolved) => resolved.ok);
    return {
      "connection ID": connection.id,
      "connection name": connection.name,
      "net role": netRole(endpoints),
      "endpoint count": endpoints.length,
      "endpoint references": endpoints.map((resolved) => `${resolved.endpoint.componentId}.${resolved.endpoint.terminalId}`).join("; "),
      "persisted display color": connection.color ?? "",
      "recommended physical wire color": recommendedWireColor(endpoints),
      "recommended gauge": recommendedGauge(endpoints),
      "connector at each endpoint": endpoints.map(connectorAt).join("; "),
      "adapter required": endpoints.length > 1 && new Set(endpoints.map(connectorAt)).size > 1 ? "review connector compatibility" : "",
      "physical junction required": endpoints.length > 2 ? "junction required; branch topology unspecified" : "",
      length: "TBD"
    };
  });
}

function buildChecklist(project) {
  const completed = new Set(project.app?.buildChecklist?.completedStepIds ?? []);
  const steps = BUILD_CHECKLIST_STEPS.map((step, index) => ({
    ...step,
    order: index + 1,
    completed: completed.has(step.id)
  }));
  const markdown = [
    "# RoboStudio Build Checklist",
    "",
    "RoboStudio generated this checklist from editable project state. It is not hardware verification.",
    "",
    ...steps.map((step) => `- [${step.completed ? "x" : " "}] ${step.label}`)
  ].join("\n") + "\n";
  return { steps, markdown };
}

export function buildCircuitArtifacts({ circuitLabProject, robotDesign = null, mechatronicsBinding = null, sessionState = null } = {}) {
  const project = normalizeProject(circuitLabProject);
  const binding = mechatronicsBinding ? normalizeMechatronicsBinding(mechatronicsBinding) : normalizeMechatronicsBinding();
  const analysis = analyzeCircuit(project, { sessionState });
  const test = runCircuitLabTest(project, { sessionState });
  const bindingValidation = validateMechatronicsBinding({ robotDesign, circuitLabProject: project, binding });
  const readiness = evaluateMechatronicsReadiness({ robotDesign, circuitLabProject: project, mechatronicsBinding: binding });
  const pinMapRows = buildPinMap(project, binding, bindingValidation);
  const bomRows = buildBom(project);
  const harnessRows = buildHarness(project);
  const checklist = buildChecklist(project);
  const pinMapColumns = ["binding type", "joint or sensor ID", "actuator or sensor ID", "circuit component ID", "firmware channel ID", "semantic role", "signal type", "direction", "controller component ID", "controller terminal ID", "physical pin label", "device component ID", "device terminal ID", "voltage domain", "capability status", "generated source symbol"];
  const bomColumns = ["quantity", "catalog type ID", "generic description", "robotics role", "project instance names", "accepted/nominal voltage", "idle current mA", "typical current mA", "peak current mA", "stall current mA", "connector family", "pin pitch", "polarity", "instance engineering overrides", "protection notes", "specification basis", "review required"];
  const harnessColumns = ["connection ID", "connection name", "net role", "endpoint count", "endpoint references", "persisted display color", "recommended physical wire color", "recommended gauge", "connector at each endpoint", "adapter required", "physical junction required", "length"];

  return {
    project,
    analysis,
    test,
    binding,
    bindingValidation,
    readiness,
    pinMapRows,
    bomRows,
    harnessRows,
    checklist,
    files: {
      "circuit-lab-project.json": serializeCircuitLabProject(project),
      "pin-map.csv": serializeRowsCsv(pinMapRows, pinMapColumns),
      "bom.csv": serializeRowsCsv(bomRows, bomColumns),
      "harness.csv": serializeRowsCsv(harnessRows, harnessColumns),
      "build-checklist.md": checklist.markdown
    },
    endpointLabel: (endpoint) => endpointLabel(project, endpoint)
  };
}
