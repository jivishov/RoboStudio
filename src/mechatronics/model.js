export const MECHATRONICS_BINDING_KIND = "MechatronicsBinding";
export const MECHATRONICS_BINDING_VERSION = 1;

const SEMANTIC_ROLES = new Set([
  "joint.command.position",
  "joint.command.velocity",
  "joint.command.step",
  "joint.command.direction",
  "joint.command.enable",
  "sensor.read.digital",
  "sensor.read.analog",
  "sensor.trigger",
  "sensor.echo",
  "sensor.bus.sda",
  "sensor.bus.scl",
  "sensor.bus.uart-tx",
  "sensor.bus.uart-rx"
]);

const DIRECTIONS = new Set(["controller-to-device", "device-to-controller", "bidirectional"]);
const SIGNAL_TYPES = new Set(["servo-pulse", "pwm", "digital", "analog", "step", "direction", "enable", "i2c", "uart"]);
const VALUE_TYPES = new Set(["boolean", "integer", "number"]);

function nowIso(options = {}) {
  return options.now ?? new Date().toISOString();
}

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeEndpointRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  const componentId = text(ref.componentId);
  const terminalId = text(ref.terminalId);
  if (!componentId || !terminalId) return null;
  return { componentId, terminalId };
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const item = text(value);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function normalizeCommandTransform(transform = {}) {
  return {
    invert: transform?.invert === true,
    scale: finiteNumber(transform?.scale, 1),
    offset: finiteNumber(transform?.offset, 0)
  };
}

function normalizeActuatorBinding(binding = {}, index = 0) {
  return {
    id: text(binding.id, `actuator_binding_${index + 1}`),
    jointId: text(binding.jointId),
    actuatorId: text(binding.actuatorId),
    circuitComponentId: text(binding.circuitComponentId),
    firmwareChannelIds: normalizeStringArray(binding.firmwareChannelIds),
    commandTransform: normalizeCommandTransform(binding.commandTransform)
  };
}

function normalizeSensorBinding(binding = {}, index = 0) {
  return {
    id: text(binding.id, `sensor_binding_${index + 1}`),
    sensorId: text(binding.sensorId),
    circuitComponentId: text(binding.circuitComponentId),
    firmwareChannelIds: normalizeStringArray(binding.firmwareChannelIds)
  };
}

function normalizeFirmwareChannel(channel = {}, index = 0) {
  const semanticRole = text(channel.semanticRole);
  const direction = text(channel.direction);
  const signalType = text(channel.signalType);
  const valueType = text(channel.valueType);
  return {
    id: text(channel.id, `firmware_channel_${index + 1}`),
    semanticRole: SEMANTIC_ROLES.has(semanticRole) ? semanticRole : "",
    direction: DIRECTIONS.has(direction) ? direction : "",
    signalType: SIGNAL_TYPES.has(signalType) ? signalType : "",
    valueType: VALUE_TYPES.has(valueType) ? valueType : "",
    controllerTerminalRef: normalizeEndpointRef(channel.controllerTerminalRef),
    deviceTerminalRef: normalizeEndpointRef(channel.deviceTerminalRef)
  };
}

export function createMechatronicsBinding(options = {}) {
  return {
    kind: MECHATRONICS_BINDING_KIND,
    version: MECHATRONICS_BINDING_VERSION,
    actuatorBindings: [],
    sensorBindings: [],
    firmwareChannels: [],
    updatedAt: nowIso(options)
  };
}

export function normalizeMechatronicsBinding(input = null, options = {}) {
  if (!input) return createMechatronicsBinding(options);
  if (input.version != null && Number(input.version) !== MECHATRONICS_BINDING_VERSION) {
    throw new Error("MechatronicsBinding must use version 1.");
  }
  return {
    kind: MECHATRONICS_BINDING_KIND,
    version: MECHATRONICS_BINDING_VERSION,
    actuatorBindings: Array.isArray(input.actuatorBindings)
      ? input.actuatorBindings.map(normalizeActuatorBinding)
      : [],
    sensorBindings: Array.isArray(input.sensorBindings)
      ? input.sensorBindings.map(normalizeSensorBinding)
      : [],
    firmwareChannels: Array.isArray(input.firmwareChannels)
      ? input.firmwareChannels.map(normalizeFirmwareChannel)
      : Array.isArray(input.channels)
        ? input.channels.map(normalizeFirmwareChannel)
        : [],
    updatedAt: input.updatedAt ? text(input.updatedAt) : nowIso(options)
  };
}

export function parseMechatronicsBindingJson(source, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Mechatronics binding JSON is invalid: ${error.message}`);
  }
  const normalized = normalizeMechatronicsBinding(parsed, options);
  if (normalized.kind !== MECHATRONICS_BINDING_KIND || normalized.version !== MECHATRONICS_BINDING_VERSION) {
    throw new Error("Mechatronics binding JSON must normalize to MechatronicsBinding version 1.");
  }
  return normalized;
}

export function serializeMechatronicsBinding(binding) {
  return JSON.stringify(normalizeMechatronicsBinding(binding), null, 2);
}

export function knownMechatronicsEnums() {
  return {
    semanticRoles: [...SEMANTIC_ROLES],
    directions: [...DIRECTIONS],
    signalTypes: [...SIGNAL_TYPES],
    valueTypes: [...VALUE_TYPES]
  };
}
