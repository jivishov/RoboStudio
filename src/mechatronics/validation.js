import { catalog } from "../circuits/catalog.js";
import { findConnectedTerminals, resolveTerminal } from "../circuits/connectivity.js";
import { terminalIsSignalInput, terminalIsSignalOutput, terminalVoltageRange } from "../circuits/electricalAnalysis.js";
import { normalizeProject } from "../circuits/model.js";
import { runCircuitLabTest } from "../circuits/testBench.js";
import { normalizeMechatronicsBinding } from "./model.js";

function diagnostic(severity, code, message, targets = {}) {
  return { severity, code, message, targets };
}

function endpointKey(ref) {
  return ref ? `${ref.componentId}:${ref.terminalId}` : "";
}

function duplicateIds(items, type, diagnostics) {
  const seen = new Set();
  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      diagnostics.push(diagnostic("error", "duplicate-id", `Duplicate ${type} id: ${item.id || "(blank)"}.`, { id: item.id ?? null, type }));
    }
    seen.add(item.id);
  }
}

function capabilityForSignal(terminal, signalType, direction, semanticRole) {
  const caps = terminal?.capabilities ?? [];
  if (signalType === "servo-pulse") return direction === "controller-to-device" ? caps.servoPulse === true : terminalIsSignalInput(terminal);
  if (signalType === "pwm") return direction === "controller-to-device" ? terminal.pwm === true || caps.pwm === true : terminalIsSignalInput(terminal);
  if (signalType === "analog") return direction === "device-to-controller" ? caps.adc === true : false;
  if (signalType === "i2c") {
    if (semanticRole === "sensor.bus.sda") return caps.i2cSda === true;
    if (semanticRole === "sensor.bus.scl") return caps.i2cScl === true;
    return caps.i2cSda === true || caps.i2cScl === true;
  }
  if (signalType === "uart") {
    if (semanticRole === "sensor.bus.uart-tx") return caps.uartTx === true;
    if (semanticRole === "sensor.bus.uart-rx") return caps.uartRx === true;
    return caps.uartTx === true || caps.uartRx === true;
  }
  if (signalType === "step") return caps.step === true || caps.digitalOutput === true;
  if (signalType === "direction") return caps.direction === true || caps.digitalOutput === true;
  if (signalType === "enable") return caps.enable === true || caps.digitalOutput === true;
  if (signalType === "digital") {
    if (direction === "controller-to-device") return caps.digitalOutput === true || caps.includes?.("output");
    if (direction === "device-to-controller") return caps.digitalInput === true || caps.includes?.("input");
    return terminalIsSignalInput(terminal) && terminalIsSignalOutput(terminal);
  }
  return false;
}

function validateSignalDirection(channel, controller, device, diagnostics) {
  if (controller.terminal.kind !== "signal" || device.terminal.kind !== "signal") {
    diagnostics.push(diagnostic("error", "firmware-channel-non-signal", `${channel.id} uses a power, ground, or load terminal as a firmware channel.`, {
      channelId: channel.id,
      terminalRefs: [channel.controllerTerminalRef, channel.deviceTerminalRef]
    }));
    return;
  }
  if (channel.direction === "controller-to-device") {
    if (!terminalIsSignalOutput(controller.terminal) || !terminalIsSignalInput(device.terminal)) {
      diagnostics.push(diagnostic("error", "signal-direction-mismatch", `${channel.id} direction does not match controller output to device input.`, { channelId: channel.id }));
    }
  } else if (channel.direction === "device-to-controller") {
    if (!terminalIsSignalInput(controller.terminal) || !terminalIsSignalOutput(device.terminal)) {
      diagnostics.push(diagnostic("error", "signal-direction-mismatch", `${channel.id} direction does not match device output to controller input.`, { channelId: channel.id }));
    }
  }
}

function validateChannelCapabilities(channel, controller, diagnostics) {
  if (!capabilityForSignal(controller.terminal, channel.signalType, channel.direction, channel.semanticRole)) {
    diagnostics.push(diagnostic("error", "pin-capability-mismatch", `${channel.id} requires ${channel.signalType} capability on ${controller.label}.`, {
      channelId: channel.id,
      terminalRefs: [channel.controllerTerminalRef]
    }));
  }
}

function roleCompatible(bindingKind, componentDefinition) {
  const role = componentDefinition?.engineering?.robotics?.role ?? "";
  if (bindingKind === "actuator") return role.startsWith("actuator.") || role.startsWith("driver.");
  if (bindingKind === "sensor") return role.startsWith("sensor.");
  return false;
}

function voltageCompatible(robotActuator, componentDefinition, terminalId) {
  const voltage = Number(robotActuator?.voltage);
  if (!Number.isFinite(voltage) || voltage <= 0) return true;
  const terminal = componentDefinition?.terminals?.find((item) => item.id === terminalId);
  if (!terminal) return true;
  const range = terminalVoltageRange(componentDefinition, terminal);
  const minimum = range.minimumV != null ? Number(range.minimumV) : null;
  const maximum = range.maximumV != null ? Number(range.maximumV) : null;
  if (Number.isFinite(minimum) && voltage < minimum) return false;
  if (Number.isFinite(maximum) && voltage > maximum) return false;
  return true;
}

function validateChannelReference(project, channel, diagnostics) {
  if (!channel.semanticRole || !channel.direction || !channel.signalType || !channel.valueType) {
    diagnostics.push(diagnostic("error", "invalid-firmware-channel", `${channel.id} has an invalid semantic role, direction, signal type, or value type.`, { channelId: channel.id }));
  }
  const controller = resolveTerminal(project, channel.controllerTerminalRef);
  const device = resolveTerminal(project, channel.deviceTerminalRef);
  if (!controller.ok) {
    diagnostics.push(diagnostic("error", "missing-controller-terminal", `${channel.id} references a missing controller terminal.`, { channelId: channel.id, terminalRefs: [channel.controllerTerminalRef] }));
  }
  if (!device.ok) {
    diagnostics.push(diagnostic("error", "missing-device-terminal", `${channel.id} references a missing device terminal.`, { channelId: channel.id, terminalRefs: [channel.deviceTerminalRef] }));
  }
  if (!controller.ok || !device.ok) return null;
  if (channel.controllerTerminalRef.componentId !== project.controllerId) {
    diagnostics.push(diagnostic("error", "controller-terminal-mismatch", `${channel.id} does not use the selected Circuit Lab controller.`, { channelId: channel.id, terminalRefs: [channel.controllerTerminalRef] }));
  }
  validateSignalDirection(channel, controller, device, diagnostics);
  validateChannelCapabilities(channel, controller, diagnostics);
  const linked = findConnectedTerminals(project, channel.controllerTerminalRef);
  if (!linked.some((record) => endpointKey(record.endpoint) === endpointKey(channel.deviceTerminalRef))) {
    diagnostics.push(diagnostic("error", "channel-terminals-disconnected", `${channel.id} controller and device terminals are not wired together.`, {
      channelId: channel.id,
      terminalRefs: [channel.controllerTerminalRef, channel.deviceTerminalRef]
    }));
  }
  return { controller, device };
}

function validateControllerTerminalCollisions(binding, project, diagnostics) {
  const byTerminal = new Map();
  for (const channel of binding.firmwareChannels) {
    const key = endpointKey(channel.controllerTerminalRef);
    if (!key) continue;
    if (!byTerminal.has(key)) byTerminal.set(key, []);
    byTerminal.get(key).push(channel);
  }
  for (const [key, channels] of byTerminal.entries()) {
    if (channels.length < 2) continue;
    const resolved = resolveTerminal(project, channels[0].controllerTerminalRef);
    const shareable = resolved.ok && resolved.terminal.shareableBus === true && channels.every((channel) => channel.signalType === "i2c" || channel.signalType === "uart");
    if (!shareable) {
      diagnostics.push(diagnostic("error", "controller-terminal-collision", `${key} is assigned to multiple non-shareable firmware channels.`, {
        terminalRefs: [channels[0].controllerTerminalRef],
        channelIds: channels.map((channel) => channel.id)
      }));
    }
  }
}

function validateBusCompleteness(binding, diagnostics) {
  const roles = new Set(binding.firmwareChannels.map((channel) => channel.semanticRole));
  if (roles.has("sensor.bus.sda") !== roles.has("sensor.bus.scl")) {
    diagnostics.push(diagnostic("error", "incomplete-i2c-bus", "I2C bindings need both SDA and SCL channels.", {}));
  }
  if (roles.has("sensor.bus.uart-tx") !== roles.has("sensor.bus.uart-rx")) {
    diagnostics.push(diagnostic("warning", "incomplete-uart-pair", "UART bindings should include both TX and RX directions when the device needs bidirectional serial.", {}));
  }
}

function componentById(project, componentId) {
  return project.components.find((component) => component.id === componentId) ?? null;
}

function validatesDriverPathToMotor(project, motorComponentId) {
  const motor = componentById(project, motorComponentId);
  const motorDef = motor ? catalog.getComponent(motor.typeId) : null;
  if (motorDef?.engineering?.robotics?.role !== "actuator.dc-motor") return true;
  return motorDef.terminals.some((terminal) =>
    findConnectedTerminals(project, { componentId: motor.id, terminalId: terminal.id })
      .some((record) => record.componentDefinition.engineering?.robotics?.role === "driver.hbridge")
  );
}

function bindingChannelSet(binding) {
  return new Set(binding.firmwareChannels.map((channel) => channel.id));
}

export function validateMechatronicsBinding({ robotDesign = null, circuitLabProject = null, binding = null } = {}) {
  const normalizedBinding = normalizeMechatronicsBinding(binding);
  const project = circuitLabProject ? normalizeProject(circuitLabProject) : null;
  const diagnostics = [];
  const hasBindingRecords = normalizedBinding.actuatorBindings.length > 0
    || normalizedBinding.sensorBindings.length > 0
    || normalizedBinding.firmwareChannels.length > 0;
  duplicateIds(normalizedBinding.actuatorBindings, "actuator binding", diagnostics);
  duplicateIds(normalizedBinding.sensorBindings, "sensor binding", diagnostics);
  duplicateIds(normalizedBinding.firmwareChannels, "firmware channel", diagnostics);

  if (!robotDesign && hasBindingRecords) diagnostics.push(diagnostic("error", "missing-robot-design", "RobotDesign is required for binding validation."));
  if (!project) diagnostics.push(diagnostic("error", "missing-circuit-lab-project", "CircuitLabProject is required for binding validation."));
  if ((!robotDesign && hasBindingRecords) || !project) {
    return { ok: false, binding: normalizedBinding, diagnostics, coverage: { boundActuators: 0, eligibleActuators: 0, boundSensors: 0, totalSensors: 0, validChannels: 0, totalChannels: normalizedBinding.firmwareChannels.length } };
  }
  if (!hasBindingRecords) {
    return { ok: !diagnostics.some((item) => item.severity === "error"), binding: normalizedBinding, diagnostics, coverage: { boundActuators: 0, eligibleActuators: (robotDesign?.joints ?? []).filter((joint) => joint.type !== "fixed" && joint.actuatorId).length, boundSensors: 0, totalSensors: (robotDesign?.sensors ?? []).length, validChannels: 0, totalChannels: 0 } };
  }

  const joints = new Map((robotDesign.joints ?? []).map((joint) => [joint.id, joint]));
  const actuators = new Map((robotDesign.actuators ?? []).map((actuator) => [actuator.id, actuator]));
  const sensors = new Map((robotDesign.sensors ?? []).map((sensor) => [sensor.id, sensor]));
  const channelIds = bindingChannelSet(normalizedBinding);
  const channelsById = new Map(normalizedBinding.firmwareChannels.map((channel) => [channel.id, channel]));
  const boundJointIds = new Set();
  const boundSensorIds = new Set();

  const circuitIssues = runCircuitLabTest(project).issues;

  for (const channel of normalizedBinding.firmwareChannels) {
    validateChannelReference(project, channel, diagnostics);
  }
  validateControllerTerminalCollisions(normalizedBinding, project, diagnostics);
  validateBusCompleteness(normalizedBinding, diagnostics);

  for (const actuatorBinding of normalizedBinding.actuatorBindings) {
    const joint = joints.get(actuatorBinding.jointId);
    const actuator = actuators.get(actuatorBinding.actuatorId);
    const component = componentById(project, actuatorBinding.circuitComponentId);
    const definition = component ? catalog.getComponent(component.typeId) : null;
    if (!joint) diagnostics.push(diagnostic("error", "missing-joint", `${actuatorBinding.id} references missing joint ${actuatorBinding.jointId}.`, { bindingId: actuatorBinding.id }));
    if (joint?.type === "fixed") diagnostics.push(diagnostic("error", "fixed-joint-binding", `${joint.name} is fixed and cannot be actuator-bound.`, { bindingId: actuatorBinding.id, jointId: joint.id }));
    if (!actuator) diagnostics.push(diagnostic("error", "missing-actuator", `${actuatorBinding.id} references missing actuator ${actuatorBinding.actuatorId}.`, { bindingId: actuatorBinding.id }));
    if (joint && actuator && joint.actuatorId !== actuator.id) {
      diagnostics.push(diagnostic("error", "joint-actuator-mismatch", `${actuatorBinding.id} actuator does not match ${joint.name}.`, { bindingId: actuatorBinding.id, jointId: joint.id, actuatorId: actuator.id }));
    }
    if (!component || !definition) diagnostics.push(diagnostic("error", "missing-circuit-component", `${actuatorBinding.id} references missing circuit component ${actuatorBinding.circuitComponentId}.`, { bindingId: actuatorBinding.id }));
    else if (!roleCompatible("actuator", definition)) diagnostics.push(diagnostic("error", "component-role-mismatch", `${component.name} is not an actuator or actuator interface.`, { bindingId: actuatorBinding.id, componentId: component.id }));
    if (actuator && definition && !voltageCompatible(actuator, definition, definition.sim?.powerTerminal ?? "vplus")) {
      diagnostics.push(diagnostic("error", "actuator-voltage-mismatch", `${actuator.name} voltage is outside ${component.name} accepted power range.`, { bindingId: actuatorBinding.id, componentId: component?.id }));
    }
    if (component && !validatesDriverPathToMotor(project, component.id)) {
      diagnostics.push(diagnostic("error", "driver-path-missing", `${component.name} is not connected to a compatible motor driver output path.`, { bindingId: actuatorBinding.id, componentId: component.id }));
    }
    for (const channelId of actuatorBinding.firmwareChannelIds) {
      if (!channelIds.has(channelId)) diagnostics.push(diagnostic("error", "missing-firmware-channel", `${actuatorBinding.id} references missing firmware channel ${channelId}.`, { bindingId: actuatorBinding.id, channelId }));
      const channel = channelsById.get(channelId);
      if (channel && component && channel.deviceTerminalRef?.componentId !== component.id) {
        const device = componentById(project, channel.deviceTerminalRef?.componentId);
        const deviceRole = catalog.getComponent(device?.typeId)?.engineering?.robotics?.role;
        if (!(deviceRole === "driver.hbridge" && definition?.engineering?.robotics?.role === "actuator.dc-motor")) {
          diagnostics.push(diagnostic("error", "device-terminal-component-mismatch", `${channel.id} device terminal is inconsistent with ${actuatorBinding.id}.`, { bindingId: actuatorBinding.id, channelId: channel.id }));
        }
      }
    }
    if (circuitIssues.some((issue) => issue.targets?.componentIds?.includes(actuatorBinding.circuitComponentId) && issue.severity === "error")) {
      diagnostics.push(diagnostic("error", "bound-component-electrical-blocked", `${actuatorBinding.circuitComponentId} has blocking Circuit Lab diagnostics.`, { bindingId: actuatorBinding.id, componentId: actuatorBinding.circuitComponentId }));
    }
    if (joint?.id) {
      if (boundJointIds.has(joint.id)) diagnostics.push(diagnostic("error", "duplicate-joint-binding", `${joint.name} has multiple physical actuator bindings.`, { jointId: joint.id }));
      boundJointIds.add(joint.id);
    }
    if (actuator && !actuator.interface) {
      diagnostics.push(diagnostic("warning", "actuator-interface-missing", `${actuator.name} has no semantic actuator interface metadata.`, { actuatorId: actuator.id }));
    }
  }

  for (const sensorBinding of normalizedBinding.sensorBindings) {
    const sensor = sensors.get(sensorBinding.sensorId);
    const component = componentById(project, sensorBinding.circuitComponentId);
    const definition = component ? catalog.getComponent(component.typeId) : null;
    if (!sensor) diagnostics.push(diagnostic("error", "missing-sensor", `${sensorBinding.id} references missing sensor ${sensorBinding.sensorId}.`, { bindingId: sensorBinding.id }));
    if (!component || !definition) diagnostics.push(diagnostic("error", "missing-circuit-component", `${sensorBinding.id} references missing circuit component ${sensorBinding.circuitComponentId}.`, { bindingId: sensorBinding.id }));
    else if (!roleCompatible("sensor", definition)) diagnostics.push(diagnostic("error", "component-role-mismatch", `${component.name} is not a sensor component.`, { bindingId: sensorBinding.id, componentId: component.id }));
    for (const channelId of sensorBinding.firmwareChannelIds) {
      if (!channelIds.has(channelId)) diagnostics.push(diagnostic("error", "missing-firmware-channel", `${sensorBinding.id} references missing firmware channel ${channelId}.`, { bindingId: sensorBinding.id, channelId }));
    }
    if (sensor?.id) {
      if (boundSensorIds.has(sensor.id)) diagnostics.push(diagnostic("error", "duplicate-sensor-binding", `${sensor.name} has multiple physical sensor bindings.`, { sensorId: sensor.id }));
      boundSensorIds.add(sensor.id);
    }
    if (sensor && !sensor.interface) {
      diagnostics.push(diagnostic("warning", "sensor-interface-missing", `${sensor.name} has no semantic sensor interface metadata.`, { sensorId: sensor.id }));
    }
  }

  const eligibleActuators = (robotDesign.joints ?? []).filter((joint) => joint.type !== "fixed" && joint.actuatorId).length;
  const totalSensors = (robotDesign.sensors ?? []).length;
  const validChannelIds = new Set(normalizedBinding.firmwareChannels.map((channel) => channel.id));
  for (const item of diagnostics.filter((item) => item.severity === "error" && item.targets?.channelId)) {
    validChannelIds.delete(item.targets.channelId);
  }

  return {
    ok: !diagnostics.some((item) => item.severity === "error"),
    binding: normalizedBinding,
    diagnostics,
    coverage: {
      boundActuators: boundJointIds.size,
      eligibleActuators,
      boundSensors: boundSensorIds.size,
      totalSensors,
      validChannels: validChannelIds.size,
      totalChannels: normalizedBinding.firmwareChannels.length
    }
  };
}
