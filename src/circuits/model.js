import { DEFAULT_TEMPLATE_ID, catalog, terminalById } from "./catalog.js";
import { normalizeControlState, setPersistentControlOnComponent } from "./controlModel.js";
import { normalizeComponentRotation, normalizeComponentScale } from "./geometry.js";
import { assertEndpointsHaveCapacity } from "./occupancy.js";
import { CURRENT_CIRCUIT_LAB_PROJECT_KEY } from "../workspaceDb.js";

export const CIRCUIT_LAB_KIND = "CircuitLabProject";
export const CIRCUIT_LAB_VERSION = 1;
export const CIRCUIT_LAB_UNITS = "mm";
export { CURRENT_CIRCUIT_LAB_PROJECT_KEY };

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso(options = {}) {
  return options.now ?? new Date().toISOString();
}

function stableId(value) {
  return String(value ?? "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "item";
}

export function uniqueId(base, existingIds = []) {
  const used = new Set(existingIds);
  const root = stableId(base);
  if (!used.has(root)) return root;
  let index = 2;
  while (used.has(`${root}_${index}`)) index += 1;
  return `${root}_${index}`;
}

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function vector2(value, fallback = [0, 0]) {
  if (!Array.isArray(value)) return [...fallback];
  return [numberOr(value[0], fallback[0] ?? 0), numberOr(value[1], fallback[1] ?? 0)];
}

function finiteOverride(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function shortTextOverride(value, maxLength = 48) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /(?:[a-z]:\\|\/|https?:\/\/|sha256|file_id)/i.test(trimmed)) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeEngineeringOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object") return null;
  const normalized = {};
  const numericKeys = [
    "minimumVoltageV",
    "nominalVoltageV",
    "maximumVoltageV",
    "idleCurrentMa",
    "typicalCurrentMa",
    "peakCurrentMa",
    "stallCurrentMa",
    "pinPitchMm"
  ];
  for (const key of numericKeys) {
    const numeric = finiteOverride(overrides[key]);
    if (numeric !== null) normalized[key] = numeric;
  }
  const connectorFamily = shortTextOverride(overrides.connectorFamily);
  if (connectorFamily) normalized.connectorFamily = connectorFamily;
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeComponentProps(props = {}, definition = null) {
  const normalized = {};
  const input = props && typeof props === "object" ? cloneJson(props) : {};
  normalized.scale = normalizeComponentScale(input.scale);
  const controls = normalizeControlState(definition, input.controls);
  if (Object.keys(controls).length) normalized.controls = controls;
  const engineeringOverrides = normalizeEngineeringOverrides(input.engineeringOverrides);
  if (engineeringOverrides) normalized.engineeringOverrides = engineeringOverrides;
  return normalized;
}

export function normalizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "object") return null;
  const componentId = endpoint.componentId ?? endpoint.instanceId ?? endpoint.component;
  const terminalId = endpoint.terminalId ?? endpoint.pinId ?? endpoint.terminal;
  if (!componentId || !terminalId) return null;
  return {
    componentId: String(componentId),
    terminalId: String(terminalId)
  };
}

function normalizeComponentInstance(component, index = 0) {
  const typeId = component.typeId ?? component.componentId ?? component.catalogId;
  const definition = catalog.getComponent(typeId);
  if (!definition) {
    return {
      id: String(component.id ?? `unknown_${index + 1}`),
      typeId: String(typeId ?? "unknown"),
      name: String(component.name ?? typeId ?? `Component ${index + 1}`),
      position: vector2(component.position, [40 + index * 30, 40]),
      rotation: normalizeComponentRotation(component.rotation),
      props: normalizeComponentProps(component.props)
    };
  }
  return {
    id: String(component.id ?? uniqueId(definition.id, [])),
    typeId: definition.id,
    name: String(component.name ?? definition.name),
    position: vector2(component.position, [40 + index * 30, 40]),
    rotation: normalizeComponentRotation(component.rotation),
    props: normalizeComponentProps(component.props, definition)
  };
}

function normalizeConnection(connection, index = 0) {
  const endpoints = [];
  const seen = new Set();
  for (const rawEndpoint of connection?.endpoints ?? []) {
    const endpoint = normalizeEndpoint(rawEndpoint);
    if (!endpoint) continue;
    const key = endpointKey(endpoint);
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push(endpoint);
  }
  return {
    id: String(connection?.id ?? `connection_${index + 1}`),
    name: String(connection?.name ?? `Connection ${index + 1}`),
    kind: connection?.kind === "direct-insertion" ? "direct-insertion" : "wire",
    color: typeof connection?.color === "string" ? connection.color : null,
    endpoints
  };
}

export function normalizeProject(input, options = {}) {
  if (!input) return createCircuitLabProject(options);
  const components = Array.isArray(input.components)
    ? input.components.map((component, index) => normalizeComponentInstance(component, index))
    : [];
  const connections = Array.isArray(input.connections)
    ? input.connections.map((connection, index) => normalizeConnection(connection, index))
    : [];
  const selectedComponentId = input.selectedComponentId && components.some((item) => item.id === input.selectedComponentId)
    ? input.selectedComponentId
    : components[0]?.id ?? null;
  const selectedConnectionId = input.selectedConnectionId && connections.some((item) => item.id === input.selectedConnectionId)
    ? input.selectedConnectionId
    : null;
  return {
    kind: CIRCUIT_LAB_KIND,
    version: CIRCUIT_LAB_VERSION,
    units: CIRCUIT_LAB_UNITS,
    name: String(input.name ?? "Circuit Lab project"),
    mode: ["select", "place", "wire", "test"].includes(input.mode) ? input.mode : "select",
    controllerId: input.controllerId && components.some((item) => item.id === input.controllerId)
      ? input.controllerId
      : components.find((item) => catalog.getComponent(item.typeId)?.sim.role === "controller")?.id ?? null,
    components,
    connections,
    app: {
      kind: String(input.app?.kind ?? "robotics_starter"),
      notes: String(input.app?.notes ?? "")
    },
    selectedComponentId,
    selectedConnectionId,
    updatedAt: input.updatedAt ?? nowIso(options)
  };
}

export function endpointKey(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  return normalized ? `${normalized.componentId}:${normalized.terminalId}` : "";
}

function canonicalEndpoint(project, endpointInput) {
  const endpoint = normalizeEndpoint(endpointInput);
  if (!endpoint) throw new Error("Invalid Circuit Lab endpoint.");
  const component = project.components.find((item) => item.id === endpoint.componentId);
  const definition = component ? catalog.getComponent(component.typeId) : null;
  const terminal = terminalById(definition, endpoint.terminalId);
  if (!component || !definition || !terminal) {
    throw new Error(`Unknown terminal: ${endpoint.componentId}.${endpoint.terminalId}`);
  }
  return { componentId: component.id, terminalId: terminal.id };
}

function touch(project, options = {}) {
  return { ...normalizeProject(project, options), updatedAt: nowIso(options) };
}

function starterComponents(templateId) {
  if (templateId === "arduino_six_servo_order") {
    return [
      ["arduino", "controller-arduino-uno-r3", "Arduino Uno R3", [850, 140]],
      ["breadboard", "breadboard-bb400-400", "Breadboard rails", [470, 410]],
      ["supply", "supply-servo-6v", "External servo power", [850, 505]],
      ["servo_base", "servo-standard", "Base servo", [120, 110]],
      ["servo_shoulder", "servo-standard", "Shoulder servo", [120, 180]],
      ["servo_elbow", "servo-standard", "Elbow servo", [120, 250]],
      ["servo_wrist_rotate", "servo-standard", "Wrist rotate", [120, 320]],
      ["servo_wrist_lift", "servo-standard", "Wrist up/down", [120, 390]],
      ["servo_gripper", "servo-standard", "Gripper", [120, 460]]
    ];
  }
  if (templateId === "esp32_led_button") {
    return [
      ["esp32", "controller-esp32-devkit", "ESP32 DevKit", [820, 170]],
      ["breadboard", "breadboard-bb400-400", "Breadboard", [470, 400]],
      ["led", "led-red", "Status LED", [350, 260]],
      ["resistor", "resistor-220", "LED resistor", [480, 260]],
      ["button", "button-tactile", "Mode button", [380, 500]]
    ];
  }
  if (templateId === "motor_driver_dc") {
    return [
      ["arduino", "controller-arduino-uno-r3", "Arduino Uno R3", [850, 150]],
      ["breadboard", "breadboard-bb400-400", "Breadboard", [470, 420]],
      ["supply", "supply-servo-6v", "Motor supply", [850, 520]],
      ["driver", "driver-l298n", "Motor driver", [500, 220]],
      ["motor", "motor-dc", "Drive motor", [250, 220]]
    ];
  }
  return [
    ["arduino", "controller-arduino-uno-r3", "Arduino Uno R3", [850, 165]],
    ["breadboard", "breadboard-bb400-400", "Breadboard rails", [470, 410]],
    ["supply", "supply-servo-6v", "External servo power", [850, 510]],
    ["servo", "servo-standard", "Test servo", [125, 210]]
  ];
}

function connection(id, name, color, endpoints) {
  return { id, name, color, kind: "wire", endpoints };
}

function starterConnections(templateId) {
  if (templateId === "arduino_six_servo_order") {
    const signalMap = [
      ["servo_base", "D8"],
      ["servo_shoulder", "D9"],
      ["servo_elbow", "D10"],
      ["servo_wrist_rotate", "D5"],
      ["servo_wrist_lift", "D6"],
      ["servo_gripper", "D7"]
    ];
    return [
      connection("power_to_breadboard", "External +V to breadboard rail", "#dc2626", [
        { componentId: "supply", terminalId: "VPLUS" },
        { componentId: "breadboard", terminalId: "bp1" }
      ]),
      connection("ground_to_breadboard", "External ground to breadboard rail", "#1f2937", [
        { componentId: "supply", terminalId: "GND" },
        { componentId: "breadboard", terminalId: "bn1" },
        { componentId: "arduino", terminalId: "GND" }
      ]),
      ...signalMap.map(([servoId, pinId], index) => connection(`${servoId}_signal`, `${servoId} signal to ${pinId}`, "#f59e0b", [
        { componentId: "arduino", terminalId: pinId },
        { componentId: servoId, terminalId: "signal" }
      ])),
      ...signalMap.flatMap(([servoId], index) => [
        connection(`${servoId}_power`, `${servoId} +V`, "#dc2626", [
          { componentId: "breadboard", terminalId: `bp${4 + index * 3}` },
          { componentId: servoId, terminalId: "vplus" }
        ]),
        connection(`${servoId}_ground`, `${servoId} ground`, "#111827", [
          { componentId: "breadboard", terminalId: `bn${4 + index * 3}` },
          { componentId: servoId, terminalId: "gnd" }
        ])
      ])
    ];
  }
  if (templateId === "esp32_led_button") {
    return [
      connection("gpio_led_resistor", "GPIO16 to resistor", "#f59e0b", [
        { componentId: "esp32", terminalId: "GPIO16" },
        { componentId: "resistor", terminalId: "a" }
      ]),
      connection("resistor_led", "Resistor to LED", "#f59e0b", [
        { componentId: "resistor", terminalId: "b" },
        { componentId: "led", terminalId: "anode" }
      ]),
      connection("led_ground", "LED return", "#111827", [
        { componentId: "led", terminalId: "cathode" },
        { componentId: "esp32", terminalId: "GND" }
      ]),
      connection("button_signal", "GPIO17 button sense", "#f59e0b", [
        { componentId: "esp32", terminalId: "GPIO17" },
        { componentId: "button", terminalId: "sense" }
      ]),
      connection("button_ground", "Button return", "#111827", [
        { componentId: "button", terminalId: "return" },
        { componentId: "esp32", terminalId: "GND2" }
      ])
    ];
  }
  if (templateId === "motor_driver_dc") {
    return [
      connection("motor_power", "Motor supply to driver", "#dc2626", [
        { componentId: "supply", terminalId: "VPLUS" },
        { componentId: "driver", terminalId: "VMOTOR" }
      ]),
      connection("motor_ground", "Common ground", "#111827", [
        { componentId: "supply", terminalId: "GND" },
        { componentId: "driver", terminalId: "GND" },
        { componentId: "arduino", terminalId: "GND" }
      ]),
      connection("driver_in1", "Driver IN1", "#f59e0b", [
        { componentId: "arduino", terminalId: "D5" },
        { componentId: "driver", terminalId: "IN1" }
      ]),
      connection("driver_in2", "Driver IN2", "#f59e0b", [
        { componentId: "arduino", terminalId: "D6" },
        { componentId: "driver", terminalId: "IN2" }
      ]),
      connection("motor_out1", "Motor OUT1", "#475569", [
        { componentId: "driver", terminalId: "OUT1" },
        { componentId: "motor", terminalId: "a" }
      ]),
      connection("motor_out2", "Motor OUT2", "#475569", [
        { componentId: "driver", terminalId: "OUT2" },
        { componentId: "motor", terminalId: "b" }
      ])
    ];
  }
  return [
    connection("power_to_breadboard", "External +V to breadboard rail", "#dc2626", [
      { componentId: "supply", terminalId: "VPLUS" },
      { componentId: "breadboard", terminalId: "bp1" }
    ]),
    connection("ground_to_breadboard", "Common ground", "#111827", [
      { componentId: "supply", terminalId: "GND" },
      { componentId: "breadboard", terminalId: "bn1" },
      { componentId: "arduino", terminalId: "GND" }
    ]),
    connection("servo_power", "Servo +V", "#dc2626", [
      { componentId: "breadboard", terminalId: "bp5" },
      { componentId: "servo", terminalId: "vplus" }
    ]),
    connection("servo_ground", "Servo ground", "#111827", [
      { componentId: "breadboard", terminalId: "bn5" },
      { componentId: "servo", terminalId: "gnd" }
    ]),
    connection("servo_signal", "Servo signal D9", "#f59e0b", [
      { componentId: "arduino", terminalId: "D9" },
      { componentId: "servo", terminalId: "signal" }
    ])
  ];
}

export function createCircuitLabProject(options = {}) {
  const templateId = options.templateId ?? DEFAULT_TEMPLATE_ID;
  const components = starterComponents(templateId).map(([id, typeId, name, position]) => ({
    id,
    typeId,
    name,
    position,
    props: catalog.getComponent(typeId)?.controls?.power ? { controls: { power: "off" } } : {}
  }));
  const controllerId = components.find((item) => catalog.getComponent(item.typeId)?.sim.role === "controller")?.id ?? null;
  return normalizeProject({
    kind: CIRCUIT_LAB_KIND,
    version: CIRCUIT_LAB_VERSION,
    units: CIRCUIT_LAB_UNITS,
    name: options.name ?? "Circuit Lab robotics starter",
    controllerId,
    components,
    connections: starterConnections(templateId),
    selectedComponentId: controllerId,
    app: { kind: templateId },
    updatedAt: nowIso(options)
  }, options);
}

export function applyStarterTemplate(project, templateId, options = {}) {
  const base = createCircuitLabProject({ ...options, templateId });
  return touch({ ...base, name: project?.name ?? base.name, app: { kind: templateId, notes: "" } }, options);
}

export function addComponent(project, typeId, options = {}) {
  const normalized = normalizeProject(project, options);
  const definition = catalog.getComponent(typeId);
  if (!definition) throw new Error(`Unknown Circuit Lab component: ${typeId}`);
  const id = uniqueId(options.id ?? definition.id, normalized.components.map((item) => item.id));
  const instance = normalizeComponentInstance({
    id,
    typeId,
    name: options.name ?? definition.name,
    position: options.position ?? [120 + normalized.components.length * 28, 140],
    props: options.props ?? {}
  });
  return touch({
    ...normalized,
    components: [...normalized.components, instance],
    selectedComponentId: instance.id,
    selectedConnectionId: null,
    controllerId: normalized.controllerId ?? (definition.sim.role === "controller" ? instance.id : null)
  }, options);
}

export function updateComponent(project, componentId, patch = {}, options = {}) {
  const normalized = normalizeProject(project, options);
  if (!normalized.components.some((item) => item.id === componentId)) throw new Error(`Unknown component: ${componentId}`);
  const components = normalized.components.map((component) => component.id === componentId
    ? normalizeComponentInstance({ ...component, ...patch, id: component.id, typeId: component.typeId })
    : component);
  return touch({ ...normalized, components, selectedComponentId: componentId, selectedConnectionId: null }, options);
}

export function setComponentControl(project, componentId, controlId, value, options = {}) {
  const normalized = normalizeProject(project, options);
  const component = normalized.components.find((item) => item.id === componentId);
  const definition = component ? catalog.getComponent(component.typeId) : null;
  if (!component || !definition) throw new Error(`Unknown component: ${componentId}`);
  const patched = setPersistentControlOnComponent(component, definition, controlId, value);
  const components = normalized.components.map((item) => item.id === componentId ? normalizeComponentInstance(patched) : item);
  return touch({
    ...normalized,
    components,
    selectedComponentId: componentId,
    selectedConnectionId: null
  }, options);
}

export function removeComponent(project, componentId, options = {}) {
  const normalized = normalizeProject(project, options);
  const components = normalized.components.filter((item) => item.id !== componentId);
  if (components.length === normalized.components.length) throw new Error(`Unknown component: ${componentId}`);
  const connections = normalized.connections
    .map((connectionItem) => ({
      ...connectionItem,
      endpoints: connectionItem.endpoints.filter((endpoint) => endpoint.componentId !== componentId)
    }))
    .filter((connectionItem) => connectionItem.endpoints.length > 1);
  return touch({
    ...normalized,
    components,
    connections,
    selectedComponentId: components[0]?.id ?? null,
    selectedConnectionId: null,
    controllerId: normalized.controllerId === componentId ? components.find((item) => catalog.getComponent(item.typeId)?.sim.role === "controller")?.id ?? null : normalized.controllerId
  }, options);
}

export function connectTerminals(project, endpointA, endpointB, options = {}) {
  const normalized = normalizeProject(project, options);
  const first = canonicalEndpoint(normalized, endpointA);
  const second = canonicalEndpoint(normalized, endpointB);
  if (endpointKey(first) === endpointKey(second)) throw new Error("A wire needs two different terminals.");
  const kind = options.kind === "direct-insertion" ? "direct-insertion" : "wire";
  if (options.enforceOccupancy !== false) assertEndpointsHaveCapacity(normalized, [first, second], { kind });
  const id = uniqueId(options.id ?? "wire", normalized.connections.map((item) => item.id));
  const name = options.name ?? `${first.componentId}.${first.terminalId} to ${second.componentId}.${second.terminalId}`;
  return touch({
    ...normalized,
    connections: [...normalized.connections, normalizeConnection({
      id,
      name,
      kind,
      color: options.color ?? null,
      endpoints: [first, second]
    }, normalized.connections.length)],
    selectedConnectionId: id,
    selectedComponentId: null
  }, options);
}

export function removeConnection(project, connectionId, options = {}) {
  const normalized = normalizeProject(project, options);
  const connections = normalized.connections.filter((item) => item.id !== connectionId);
  if (connections.length === normalized.connections.length) throw new Error(`Unknown connection: ${connectionId}`);
  return touch({
    ...normalized,
    connections,
    selectedConnectionId: normalized.selectedConnectionId === connectionId ? null : normalized.selectedConnectionId
  }, options);
}

export function selectComponent(project, componentId, options = {}) {
  const normalized = normalizeProject(project, options);
  if (componentId !== null && !normalized.components.some((item) => item.id === componentId)) throw new Error(`Unknown component: ${componentId}`);
  return { ...normalized, selectedComponentId: componentId, selectedConnectionId: null };
}

export function selectConnection(project, connectionId, options = {}) {
  const normalized = normalizeProject(project, options);
  if (connectionId !== null && !normalized.connections.some((item) => item.id === connectionId)) throw new Error(`Unknown connection: ${connectionId}`);
  return { ...normalized, selectedComponentId: null, selectedConnectionId: connectionId };
}

export function setProjectMode(project, mode, options = {}) {
  const normalized = normalizeProject(project, options);
  if (!["select", "place", "wire", "test"].includes(mode)) throw new Error(`Unknown Circuit Lab mode: ${mode}`);
  return { ...normalized, mode };
}

export function parseCircuitLabProjectJson(source, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Circuit Lab JSON is invalid: ${error.message}`);
  }
  if (parsed?.kind != null && parsed.kind !== CIRCUIT_LAB_KIND) {
    throw new Error("Circuit Lab JSON must use kind CircuitLabProject.");
  }
  if (parsed?.version != null && Number(parsed.version) !== CIRCUIT_LAB_VERSION) {
    throw new Error("Circuit Lab JSON must use CircuitLabProject version 1.");
  }
  if (parsed?.units != null && parsed.units !== CIRCUIT_LAB_UNITS) {
    throw new Error("Circuit Lab JSON must use millimeters.");
  }
  const normalized = normalizeProject(parsed, options);
  if (normalized.kind !== CIRCUIT_LAB_KIND || normalized.version !== CIRCUIT_LAB_VERSION || normalized.units !== CIRCUIT_LAB_UNITS) {
    throw new Error("Circuit Lab JSON must normalize to CircuitLabProject version 1 in millimeters.");
  }
  return normalized;
}

export function serializeCircuitLabProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

export function projectSummary(project) {
  const normalized = normalizeProject(project);
  const controller = normalized.components.find((item) => item.id === normalized.controllerId);
  return {
    name: normalized.name,
    controller: controller?.name ?? "No controller",
    componentCount: normalized.components.length,
    connectionCount: normalized.connections.length
  };
}
