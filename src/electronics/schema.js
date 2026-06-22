import { DEFAULT_BOARD_ID, DEFAULT_COMPONENT_ID, catalog } from "./catalog.js";

export const CIRCUIT_DESIGN_VERSION = 1;
export const CIRCUIT_UNITS = "mm";
export const CIRCUIT_KIND = "CircuitDesign";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso(options = {}) {
  return options.now ?? new Date().toISOString();
}

function stableId(text) {
  return String(text ?? "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "item";
}

export function uniqueCircuitId(base, existingIds = []) {
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

function vector(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value)) return [...fallback];
  return [
    numberOr(value[0], fallback[0] ?? 0),
    numberOr(value[1], fallback[1] ?? 0),
    numberOr(value[2], fallback[2] ?? 0)
  ];
}

function positionFromInput(value, fallback = [0, 5, 0], options = {}) {
  const raw = vector(value, fallback);
  if (options.scaleMetersToMm) return raw.map((item) => item * 1000);
  return raw;
}

export function deriveTargetForBoard(boardId) {
  return catalog.getBoard(boardId)?.target ?? "esp32";
}

export function endpointKey(endpoint) {
  if (!endpoint) return "";
  if (endpoint.type === "board") return `board:${endpoint.pinId}`;
  if (endpoint.type === "component") return `component:${endpoint.instanceId}:${endpoint.pinId}`;
  return "";
}

export function normalizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "object") return null;
  if (endpoint.type === "board" || endpoint.board || endpoint.boardPinId) {
    const pinId = endpoint.pinId ?? endpoint.boardPinId ?? endpoint.board?.pinId ?? endpoint.board;
    if (!pinId) return null;
    return { type: "board", pinId: String(pinId) };
  }
  if (endpoint.type === "component" || endpoint.instance || endpoint.component || endpoint.instanceId) {
    const instanceId = endpoint.instanceId ?? endpoint.componentId ?? endpoint.instance?.id ?? endpoint.component?.id;
    const pinId = endpoint.pinId ?? endpoint.instance?.pinId ?? endpoint.component?.pinId;
    if (!instanceId || !pinId) return null;
    return { type: "component", instanceId: String(instanceId), pinId: String(pinId) };
  }
  return null;
}

function normalizeComponentInstance(component, index = 0, options = {}) {
  const componentId = component.componentId ?? component.defId ?? component.type ?? component.catalogId ?? DEFAULT_COMPONENT_ID;
  const componentDef = catalog.getComponent(componentId);
  const id = String(component.id ?? component.instanceId ?? `${stableId(componentDef?.name ?? componentId)}_${index + 1}`);
  return {
    id,
    componentId,
    name: String(component.name ?? component.label ?? componentDef?.name ?? componentId),
    position: positionFromInput(component.positionMm ?? component.position, [0, 5, 0], options),
    rotation: vector(component.rotationDeg ?? component.rotation, [0, 0, 0]),
    props: cloneJson(component.props ?? {})
  };
}

function normalizeBoard(boardInput) {
  const boardId = typeof boardInput === "string"
    ? boardInput
    : boardInput?.id ?? boardInput?.boardId ?? DEFAULT_BOARD_ID;
  return {
    id: String(boardId),
    name: String(boardInput?.name ?? catalog.getBoard(boardId)?.name ?? boardId),
    position: vector(boardInput?.position, [0, 0, 0]),
    rotation: vector(boardInput?.rotation, [0, 0, 0])
  };
}

function normalizeNet(net, index = 0) {
  const endpoints = [];
  const seen = new Set();
  for (const rawEndpoint of net?.endpoints ?? []) {
    const endpoint = normalizeEndpoint(rawEndpoint);
    const key = endpointKey(endpoint);
    if (!endpoint || seen.has(key)) continue;
    seen.add(key);
    endpoints.push(endpoint);
  }
  return {
    id: String(net?.id ?? `net_${index + 1}`),
    name: String(net?.name ?? net?.label ?? `Net ${index + 1}`),
    color: typeof net?.color === "string" ? net.color : null,
    endpoints
  };
}

function normalizeCustomCode(customCode) {
  const files = Array.isArray(customCode?.files)
    ? customCode.files
        .filter((file) => file?.path && typeof file.content === "string")
        .map((file) => ({ path: String(file.path), content: file.content }))
    : [];
  return { files };
}

function normalizeApp(app) {
  const source = app && typeof app === "object" ? app : {};
  return {
    kind: String(source.kind ?? "blink"),
    outputComponentId: source.outputComponentId ?? "led_1",
    inputComponentId: source.inputComponentId ?? "button_1",
    blinkPeriodMs: Math.max(50, numberOr(source.blinkPeriodMs, 500)),
    notes: String(source.notes ?? "")
  };
}

function normalizeNativeDesign(input, options = {}) {
  const board = normalizeBoard(input?.board ?? input?.boardId);
  const components = Array.isArray(input?.components)
    ? input.components.map((component, index) => normalizeComponentInstance(component, index, options))
    : [];
  const nets = Array.isArray(input?.nets) ? input.nets.map((net, index) => normalizeNet(net, index)) : [];
  const selectedComponentId = input?.selectedComponentId ?? input?.selectedInstanceId ?? components[0]?.id ?? null;
  return {
    kind: CIRCUIT_KIND,
    version: CIRCUIT_DESIGN_VERSION,
    units: CIRCUIT_UNITS,
    name: String(input?.name ?? "Electronics design"),
    target: String(input?.target ?? deriveTargetForBoard(board.id)),
    board,
    components,
    nets,
    app: normalizeApp(input?.app),
    customCode: normalizeCustomCode(input?.customCode),
    selectedComponentId: selectedComponentId && components.some((component) => component.id === selectedComponentId)
      ? selectedComponentId
      : components[0]?.id ?? null,
    selectedNetId: input?.selectedNetId && nets.some((net) => net.id === input.selectedNetId) ? input.selectedNetId : null,
    updatedAt: input?.updatedAt ?? nowIso(options)
  };
}

function normalizeCircuitinyDesign(input, options = {}) {
  const components = Array.isArray(input?.components)
    ? input.components
    : Object.entries(input?.components ?? {}).map(([id, value]) => ({ id, ...value }));
  return normalizeNativeDesign({
    kind: CIRCUIT_KIND,
    version: CIRCUIT_DESIGN_VERSION,
    name: input?.name ?? input?.projectName ?? "Imported Circuitiny design",
    target: input?.target,
    board: input?.board,
    components,
    nets: input?.nets,
    app: input?.app,
    customCode: input?.customCode,
    updatedAt: input?.updatedAt
  }, { ...options, scaleMetersToMm: true });
}

export function normalizeCircuitDesign(input, options = {}) {
  if (!input) return createSeedCircuitDesign(options);
  if (input.schemaVersion === 1 && input.version !== CIRCUIT_DESIGN_VERSION) {
    return normalizeCircuitinyDesign(input, options);
  }
  return normalizeNativeDesign(input, options);
}

export function createSeedCircuitDesign(options = {}) {
  const timestamp = nowIso(options);
  return normalizeNativeDesign({
    kind: CIRCUIT_KIND,
    version: CIRCUIT_DESIGN_VERSION,
    units: CIRCUIT_UNITS,
    name: options.name ?? "ESP32 Blink And Button",
    board: { id: options.boardId ?? DEFAULT_BOARD_ID },
    components: [
      {
        id: "led_1",
        componentId: "led-5mm-red",
        name: "Status LED",
        position: [70, 8, 15],
        rotation: [0, 0, 0]
      },
      {
        id: "resistor_1",
        componentId: "resistor-220r",
        name: "LED Resistor",
        position: [48, 5, 15],
        rotation: [0, 0, 0]
      },
      {
        id: "button_1",
        componentId: "button-6mm",
        name: "Mode Button",
        position: [-62, 5, -14],
        rotation: [0, 0, 0]
      }
    ],
    nets: [
      {
        id: "net_gpio2_resistor",
        name: "GPIO2 to resistor",
        endpoints: [
          { type: "board", pinId: "GPIO2" },
          { type: "component", instanceId: "resistor_1", pinId: "a" }
        ]
      },
      {
        id: "net_resistor_led",
        name: "Resistor to LED",
        endpoints: [
          { type: "component", instanceId: "resistor_1", pinId: "b" },
          { type: "component", instanceId: "led_1", pinId: "anode" }
        ]
      },
      {
        id: "net_led_ground",
        name: "LED return",
        endpoints: [
          { type: "component", instanceId: "led_1", pinId: "cathode" },
          { type: "board", pinId: "GND_R1" }
        ]
      },
      {
        id: "net_gpio4_button",
        name: "GPIO4 button sense",
        endpoints: [
          { type: "board", pinId: "GPIO4" },
          { type: "component", instanceId: "button_1", pinId: "a" }
        ]
      },
      {
        id: "net_button_ground",
        name: "Button return",
        endpoints: [
          { type: "component", instanceId: "button_1", pinId: "b" },
          { type: "board", pinId: "GND_L1" }
        ]
      }
    ],
    app: {
      kind: "blink",
      outputComponentId: "led_1",
      inputComponentId: "button_1",
      blinkPeriodMs: 500
    },
    selectedComponentId: "led_1",
    updatedAt: timestamp
  }, { ...options, now: timestamp });
}

export function parseCircuitDesignJson(source, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Circuit design JSON is invalid: ${error.message}`);
  }
  const design = normalizeCircuitDesign(parsed, options);
  if (design.version !== CIRCUIT_DESIGN_VERSION || design.units !== CIRCUIT_UNITS) {
    throw new Error("Circuit design JSON must normalize to CircuitDesign version 1 in millimeters.");
  }
  return design;
}

export function serializeCircuitDesign(design) {
  return JSON.stringify(normalizeCircuitDesign(design), null, 2);
}

export function touchCircuitDesign(design, options = {}) {
  return { ...normalizeCircuitDesign(design, options), updatedAt: nowIso(options) };
}

export function setBoard(design, boardId, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  const board = catalog.getBoard(boardId);
  if (!board) throw new Error(`Unknown board: ${boardId}`);
  return touchCircuitDesign({
    ...next,
    target: board.target,
    board: { ...next.board, id: board.id, name: board.name }
  }, options);
}

export function addComponent(design, componentId = DEFAULT_COMPONENT_ID, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  const componentDef = catalog.getComponent(componentId);
  if (!componentDef) throw new Error(`Unknown component: ${componentId}`);
  const id = uniqueCircuitId(options.id ?? componentDef.id, next.components.map((component) => component.id));
  const component = normalizeComponentInstance({
    id,
    componentId,
    name: options.name ?? componentDef.name,
    position: options.position ?? [40 + next.components.length * 14, 5, -28],
    rotation: options.rotation ?? [0, 0, 0],
    props: options.props ?? {}
  });
  return touchCircuitDesign({
    ...next,
    components: [...next.components, component],
    selectedComponentId: component.id
  }, options);
}

export function updateComponent(design, componentId, patch = {}, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  if (!next.components.some((component) => component.id === componentId)) {
    throw new Error(`Unknown component instance: ${componentId}`);
  }
  const components = next.components.map((component) => {
    if (component.id !== componentId) return component;
    return normalizeComponentInstance({
      ...component,
      ...patch,
      id: component.id,
      componentId: component.componentId,
      position: patch.position ?? component.position,
      rotation: patch.rotation ?? component.rotation,
      props: { ...component.props, ...(patch.props ?? {}) }
    });
  });
  return touchCircuitDesign({ ...next, components, selectedComponentId: componentId }, options);
}

export function removeComponent(design, componentId, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  const components = next.components.filter((component) => component.id !== componentId);
  if (components.length === next.components.length) throw new Error(`Unknown component instance: ${componentId}`);
  const nets = next.nets
    .map((net) => ({
      ...net,
      endpoints: net.endpoints.filter((endpoint) => endpoint.type !== "component" || endpoint.instanceId !== componentId)
    }))
    .filter((net) => net.endpoints.length > 0);
  return touchCircuitDesign({
    ...next,
    components,
    nets,
    selectedComponentId: components[0]?.id ?? null,
    selectedNetId: next.selectedNetId && nets.some((net) => net.id === next.selectedNetId) ? next.selectedNetId : null
  }, options);
}

export function connectPins(design, endpointA, endpointB, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  const first = normalizeEndpoint(endpointA);
  const second = normalizeEndpoint(endpointB);
  if (!first || !second) throw new Error("Both circuit endpoints are required.");
  const endpoints = [first, second];
  const id = uniqueCircuitId(options.id ?? "net", next.nets.map((net) => net.id));
  const name = options.name ?? `${first.pinId} to ${second.pinId}`;
  return touchCircuitDesign({
    ...next,
    nets: [
      ...next.nets,
      normalizeNet({
        id,
        name,
        color: options.color ?? null,
        endpoints
      }, next.nets.length)
    ],
    selectedNetId: id
  }, options);
}

export function removeNet(design, netId, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  const nets = next.nets.filter((net) => net.id !== netId);
  if (nets.length === next.nets.length) throw new Error(`Unknown net: ${netId}`);
  return touchCircuitDesign({
    ...next,
    nets,
    selectedNetId: next.selectedNetId === netId ? null : next.selectedNetId
  }, options);
}

export function selectComponent(design, componentId, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  if (componentId !== null && !next.components.some((component) => component.id === componentId)) {
    throw new Error(`Unknown component instance: ${componentId}`);
  }
  return { ...next, selectedComponentId: componentId, selectedNetId: null };
}

export function selectNet(design, netId, options = {}) {
  const next = normalizeCircuitDesign(design, options);
  if (netId !== null && !next.nets.some((net) => net.id === netId)) {
    throw new Error(`Unknown net: ${netId}`);
  }
  return { ...next, selectedComponentId: null, selectedNetId: netId };
}

export function circuitSummary(design) {
  const normalized = normalizeCircuitDesign(design);
  return {
    name: normalized.name,
    target: normalized.target,
    boardId: normalized.board.id,
    componentCount: normalized.components.length,
    netCount: normalized.nets.length,
    updatedAt: normalized.updatedAt
  };
}
