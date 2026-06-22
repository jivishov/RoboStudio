import { catalog } from "../circuits/catalog.js";
import { findConnectedTerminals } from "../circuits/connectivity.js";
import { normalizeProject } from "../circuits/model.js";
import { normalizeMechatronicsBinding } from "./model.js";

function stableId(...parts) {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "binding";
}

function roboticsRole(component) {
  return catalog.getComponent(component.typeId)?.engineering?.robotics?.role ?? "";
}

function signalTerminalFor(component, role) {
  const definition = catalog.getComponent(component.typeId);
  const terminals = definition?.terminals ?? [];
  if (role.startsWith("actuator.servo")) {
    return terminals.find((terminal) => terminal.id === "signal")
      ?? terminals.find((terminal) => terminal.electricalRole === "signal-input")
      ?? terminals.find((terminal) => terminal.kind === "signal");
  }
  return terminals.find((terminal) => terminal.electricalRole === "signal-output")
    ?? terminals.find((terminal) => terminal.electricalRole === "signal-input")
    ?? terminals.find((terminal) => terminal.kind === "signal");
}

function existingChannelForComponent(binding, componentId) {
  return binding.firmwareChannels.find((channel) => channel.deviceTerminalRef?.componentId === componentId) ?? null;
}

function channelSkeletonForComponent(project, component, role) {
  const signalTerminal = signalTerminalFor(component, role);
  if (!signalTerminal) return null;
  const controllerConnection = findConnectedTerminals(project, {
    componentId: component.id,
    terminalId: signalTerminal.id
  }).find((record) => record.endpoint?.componentId === project.controllerId && record.terminal?.kind === "signal");
  if (!controllerConnection) return null;
  const isSensor = role.startsWith("sensor.");
  const channelId = stableId(isSensor ? "sensor" : "joint", component.id, signalTerminal.id);
  return {
    id: channelId,
    semanticRole: isSensor ? "sensor.read.digital" : "joint.command.position",
    direction: isSensor ? "device-to-controller" : "controller-to-device",
    signalType: role.startsWith("actuator.servo") ? "servo-pulse" : "digital",
    valueType: isSensor ? "boolean" : "number",
    controllerTerminalRef: {
      componentId: controllerConnection.endpoint.componentId,
      terminalId: controllerConnection.endpoint.terminalId
    },
    deviceTerminalRef: { componentId: component.id, terminalId: signalTerminal.id }
  };
}

function componentSummary(component) {
  return {
    componentId: component.id,
    typeId: component.typeId,
    name: component.name,
    roboticsRole: roboticsRole(component)
  };
}

export function previewMechatronicsBindingSuggestions({
  robotDesign = null,
  circuitLabProject = null,
  mechatronicsBinding = null
} = {}) {
  const project = circuitLabProject ? normalizeProject(circuitLabProject) : null;
  const binding = normalizeMechatronicsBinding(mechatronicsBinding);
  if (!robotDesign || !project) {
    return {
      ok: false,
      reason: !robotDesign ? "robot-design-unavailable" : "circuit-lab-project-unavailable",
      suggestedFirmwareChannels: [],
      suggestedActuatorBindings: [],
      suggestedSensorBindings: []
    };
  }

  const boundJointIds = new Set(binding.actuatorBindings.map((item) => item.jointId));
  const boundSensorIds = new Set(binding.sensorBindings.map((item) => item.sensorId));
  const usedComponentIds = new Set([
    ...binding.actuatorBindings.map((item) => item.circuitComponentId),
    ...binding.sensorBindings.map((item) => item.circuitComponentId)
  ]);
  const actuatorComponents = project.components
    .filter((component) => {
      const role = roboticsRole(component);
      return role.startsWith("actuator.") || role.startsWith("driver.");
    })
    .filter((component) => !usedComponentIds.has(component.id));
  const sensorComponents = project.components
    .filter((component) => roboticsRole(component).startsWith("sensor."))
    .filter((component) => !usedComponentIds.has(component.id));

  const suggestedFirmwareChannels = [];
  const channelByComponent = new Map();
  for (const component of [...actuatorComponents, ...sensorComponents]) {
    const existing = existingChannelForComponent(binding, component.id);
    const next = existing ?? channelSkeletonForComponent(project, component, roboticsRole(component));
    if (!next) continue;
    channelByComponent.set(component.id, next);
    if (!existing) suggestedFirmwareChannels.push(next);
  }

  const unboundJoints = (robotDesign.joints ?? [])
    .filter((joint) => joint.type !== "fixed" && joint.actuatorId && !boundJointIds.has(joint.id));
  const suggestedActuatorBindings = unboundJoints
    .map((joint, index) => {
      const component = actuatorComponents[index];
      const channel = component ? channelByComponent.get(component.id) : null;
      if (!component || !channel) return null;
      return {
        id: stableId("actuator", joint.id, joint.actuatorId),
        jointId: joint.id,
        actuatorId: joint.actuatorId,
        circuitComponentId: component.id,
        firmwareChannelIds: [channel.id],
        commandTransform: { invert: false, scale: 1, offset: 0 }
      };
    })
    .filter(Boolean);

  const unboundSensors = (robotDesign.sensors ?? []).filter((sensor) => !boundSensorIds.has(sensor.id));
  const suggestedSensorBindings = unboundSensors
    .map((sensor, index) => {
      const component = sensorComponents[index];
      const channel = component ? channelByComponent.get(component.id) : null;
      if (!component || !channel) return null;
      return {
        id: stableId("sensor", sensor.id),
        sensorId: sensor.id,
        circuitComponentId: component.id,
        firmwareChannelIds: [channel.id]
      };
    })
    .filter(Boolean);

  return {
    ok: true,
    candidateActuatorComponents: actuatorComponents.map(componentSummary),
    candidateSensorComponents: sensorComponents.map(componentSummary),
    suggestedFirmwareChannels,
    suggestedActuatorBindings,
    suggestedSensorBindings
  };
}
