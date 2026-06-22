export const PIN_TYPES = Object.freeze({
  GPIO: "gpio",
  POWER: "power",
  GROUND: "ground",
  RESERVED: "reserved"
});

export const DEFAULT_BOARD_ID = "freenove-esp32-wrover-dev";
export const DEFAULT_COMPONENT_ID = "led-5mm-red";

function pin(id, label, type, position, options = {}) {
  return Object.freeze({
    id,
    label,
    type,
    position,
    voltage: options.voltage ?? (type === PIN_TYPES.POWER ? 3.3 : 0),
    capabilities: Object.freeze(options.capabilities ?? (type === PIN_TYPES.GPIO ? ["input", "output"] : [])),
    inputOnly: Boolean(options.inputOnly),
    strapping: Boolean(options.strapping),
    flash: Boolean(options.flash),
    reserved: Boolean(options.reserved),
    maxCurrentMa: options.maxCurrentMa ?? (type === PIN_TYPES.GPIO ? 12 : null),
    notes: options.notes ?? ""
  });
}

function headerPins(prefix, x, startZ, labels) {
  return labels.map((item, index) => {
    const [id, type, options = {}] = item;
    return pin(id, options.label ?? id, type, [x, 1.2, startZ - index * 5.08], {
      ...options,
      side: prefix
    });
  });
}

const esp32Left = headerPins("left", -24, 32, [
  ["3V3", PIN_TYPES.POWER],
  ["EN", PIN_TYPES.RESERVED, { reserved: true, notes: "Enable/reset pin." }],
  ["GPIO36", PIN_TYPES.GPIO, { inputOnly: true, capabilities: ["input", "adc"] }],
  ["GPIO39", PIN_TYPES.GPIO, { inputOnly: true, capabilities: ["input", "adc"] }],
  ["GPIO34", PIN_TYPES.GPIO, { inputOnly: true, capabilities: ["input", "adc"] }],
  ["GPIO35", PIN_TYPES.GPIO, { inputOnly: true, capabilities: ["input", "adc"] }],
  ["GPIO32", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
  ["GPIO33", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
  ["GPIO25", PIN_TYPES.GPIO],
  ["GPIO26", PIN_TYPES.GPIO],
  ["GPIO27", PIN_TYPES.GPIO],
  ["GPIO14", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO12", PIN_TYPES.GPIO, { strapping: true, notes: "Boot strapping pin." }],
  ["GND_L1", PIN_TYPES.GROUND, { label: "GND" }],
  ["GPIO13", PIN_TYPES.GPIO],
  ["GPIO9", PIN_TYPES.GPIO, { flash: true, reserved: true, notes: "Connected to flash on many ESP32 modules." }],
  ["GPIO10", PIN_TYPES.GPIO, { flash: true, reserved: true, notes: "Connected to flash on many ESP32 modules." }]
]);

const esp32Right = headerPins("right", 24, 32, [
  ["VIN", PIN_TYPES.POWER, { voltage: 5, label: "5V/VIN" }],
  ["GND_R1", PIN_TYPES.GROUND, { label: "GND" }],
  ["GPIO23", PIN_TYPES.GPIO],
  ["GPIO22", PIN_TYPES.GPIO],
  ["GPIO1", PIN_TYPES.GPIO, { notes: "UART TX." }],
  ["GPIO3", PIN_TYPES.GPIO, { notes: "UART RX." }],
  ["GPIO21", PIN_TYPES.GPIO],
  ["GND_R2", PIN_TYPES.GROUND, { label: "GND" }],
  ["GPIO19", PIN_TYPES.GPIO],
  ["GPIO18", PIN_TYPES.GPIO],
  ["GPIO5", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO17", PIN_TYPES.GPIO],
  ["GPIO16", PIN_TYPES.GPIO],
  ["GPIO4", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO0", PIN_TYPES.GPIO, { strapping: true, notes: "Boot mode strapping pin." }],
  ["GPIO2", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO15", PIN_TYPES.GPIO, { strapping: true }]
]);

const s3Left = headerPins("left", -24, 34, [
  ["3V3", PIN_TYPES.POWER],
  ["GND_L1", PIN_TYPES.GROUND, { label: "GND" }],
  ["GPIO4", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
  ["GPIO5", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
  ["GPIO6", PIN_TYPES.GPIO, { capabilities: ["input", "output"] }],
  ["GPIO7", PIN_TYPES.GPIO, { capabilities: ["input", "output"] }],
  ["GPIO15", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO16", PIN_TYPES.GPIO],
  ["GPIO17", PIN_TYPES.GPIO],
  ["GPIO18", PIN_TYPES.GPIO],
  ["GPIO8", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO3", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO46", PIN_TYPES.GPIO, { inputOnly: true, strapping: true, capabilities: ["input"] }],
  ["GPIO9", PIN_TYPES.GPIO],
  ["GPIO10", PIN_TYPES.GPIO],
  ["GPIO11", PIN_TYPES.GPIO],
  ["GPIO12", PIN_TYPES.GPIO]
]);

const s3Right = headerPins("right", 24, 34, [
  ["VIN", PIN_TYPES.POWER, { voltage: 5, label: "5V/VIN" }],
  ["GND_R1", PIN_TYPES.GROUND, { label: "GND" }],
  ["GPIO13", PIN_TYPES.GPIO],
  ["GPIO14", PIN_TYPES.GPIO],
  ["GPIO21", PIN_TYPES.GPIO],
  ["GPIO47", PIN_TYPES.GPIO],
  ["GPIO48", PIN_TYPES.GPIO],
  ["GPIO45", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO0", PIN_TYPES.GPIO, { strapping: true }],
  ["GPIO35", PIN_TYPES.GPIO],
  ["GPIO36", PIN_TYPES.GPIO],
  ["GPIO37", PIN_TYPES.GPIO],
  ["GPIO38", PIN_TYPES.GPIO],
  ["GPIO39", PIN_TYPES.GPIO],
  ["GPIO40", PIN_TYPES.GPIO],
  ["GPIO41", PIN_TYPES.GPIO],
  ["GPIO42", PIN_TYPES.GPIO]
]);

const c3Pins = [
  ...headerPins("left", -19, 26, [
    ["3V3", PIN_TYPES.POWER],
    ["GND_L1", PIN_TYPES.GROUND, { label: "GND" }],
    ["GPIO0", PIN_TYPES.GPIO, { strapping: true, capabilities: ["input", "output", "adc"] }],
    ["GPIO1", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO2", PIN_TYPES.GPIO, { strapping: true, capabilities: ["input", "output", "adc"] }],
    ["GPIO3", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO4", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO5", PIN_TYPES.GPIO, { strapping: true, capabilities: ["input", "output", "adc"] }],
    ["GPIO6", PIN_TYPES.GPIO],
    ["GPIO7", PIN_TYPES.GPIO]
  ]),
  ...headerPins("right", 19, 26, [
    ["VIN", PIN_TYPES.POWER, { voltage: 5, label: "5V/VIN" }],
    ["GND_R1", PIN_TYPES.GROUND, { label: "GND" }],
    ["GPIO8", PIN_TYPES.GPIO, { strapping: true }],
    ["GPIO9", PIN_TYPES.GPIO, { strapping: true }],
    ["GPIO10", PIN_TYPES.GPIO],
    ["GPIO18", PIN_TYPES.GPIO],
    ["GPIO19", PIN_TYPES.GPIO],
    ["GPIO20", PIN_TYPES.GPIO],
    ["GPIO21", PIN_TYPES.GPIO]
  ])
];

const c6Pins = [
  ...headerPins("left", -22, 30, [
    ["3V3", PIN_TYPES.POWER],
    ["GND_L1", PIN_TYPES.GROUND, { label: "GND" }],
    ["GPIO0", PIN_TYPES.GPIO, { strapping: true }],
    ["GPIO1", PIN_TYPES.GPIO],
    ["GPIO2", PIN_TYPES.GPIO],
    ["GPIO3", PIN_TYPES.GPIO],
    ["GPIO4", PIN_TYPES.GPIO],
    ["GPIO5", PIN_TYPES.GPIO],
    ["GPIO6", PIN_TYPES.GPIO],
    ["GPIO7", PIN_TYPES.GPIO],
    ["GPIO8", PIN_TYPES.GPIO, { strapping: true }]
  ]),
  ...headerPins("right", 22, 30, [
    ["VIN", PIN_TYPES.POWER, { voltage: 5, label: "5V/VIN" }],
    ["GND_R1", PIN_TYPES.GROUND, { label: "GND" }],
    ["GPIO9", PIN_TYPES.GPIO, { strapping: true }],
    ["GPIO10", PIN_TYPES.GPIO],
    ["GPIO11", PIN_TYPES.GPIO],
    ["GPIO12", PIN_TYPES.GPIO],
    ["GPIO13", PIN_TYPES.GPIO],
    ["GPIO14", PIN_TYPES.GPIO],
    ["GPIO15", PIN_TYPES.GPIO],
    ["GPIO18", PIN_TYPES.GPIO],
    ["GPIO19", PIN_TYPES.GPIO]
  ])
];

const xiaoPins = [
  ...headerPins("left", -9, 16, [
    ["3V3", PIN_TYPES.POWER],
    ["GND_L1", PIN_TYPES.GROUND, { label: "GND" }],
    ["GPIO1", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO2", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO3", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO4", PIN_TYPES.GPIO, { capabilities: ["input", "output", "adc"] }],
    ["GPIO5", PIN_TYPES.GPIO]
  ]),
  ...headerPins("right", 9, 16, [
    ["VIN", PIN_TYPES.POWER, { voltage: 5, label: "5V" }],
    ["GPIO43", PIN_TYPES.GPIO],
    ["GPIO44", PIN_TYPES.GPIO],
    ["GPIO7", PIN_TYPES.GPIO],
    ["GPIO8", PIN_TYPES.GPIO, { strapping: true }],
    ["GPIO9", PIN_TYPES.GPIO],
    ["GPIO10", PIN_TYPES.GPIO]
  ])
];

function board(id, name, target, dimensions, pins, options = {}) {
  return Object.freeze({
    id,
    name,
    target,
    dimensions,
    model: options.model ?? null,
    pins: Object.freeze(pins),
    notes: options.notes ?? ""
  });
}

const boards = Object.freeze({
  "esp32-devkitc-v4": board("esp32-devkitc-v4", "ESP32 DevKitC V4", "esp32", [54, 1.6, 78], [...esp32Left, ...esp32Right], {
    model: "esp32-devkitc.glb"
  }),
  "freenove-esp32-wrover-dev": board("freenove-esp32-wrover-dev", "Freenove ESP32 WROVER Dev", "esp32", [58, 1.6, 86], [...esp32Left, ...esp32Right], {
    model: "esp32-devkitc.glb",
    notes: "Compatible with the common Freenove WROVER dev board pinout used by Circuitiny."
  }),
  "esp32s3-devkitc-1": board("esp32s3-devkitc-1", "ESP32-S3 DevKitC-1", "esp32s3", [52, 1.6, 86], [...s3Left, ...s3Right], {
    model: "esp32s3-devkitc.glb"
  }),
  "esp32c3-devkitm-1": board("esp32c3-devkitm-1", "ESP32-C3 DevKitM-1", "esp32c3", [42, 1.6, 62], c3Pins, {
    model: "esp32c3-devkitm.glb"
  }),
  "esp32c6-devkitc-1": board("esp32c6-devkitc-1", "ESP32-C6 DevKitC-1", "esp32c6", [48, 1.6, 72], c6Pins, {
    model: "esp32c6-devkitc.glb"
  }),
  "xiao-esp32s3": board("xiao-esp32s3", "Seeed XIAO ESP32S3", "esp32s3", [22, 1.6, 34], xiaoPins, {
    model: "xiao-esp32s3.glb"
  })
});

function componentPin(id, label, type, position, options = {}) {
  return Object.freeze({
    id,
    label,
    type,
    position,
    voltage: options.voltage ?? 0,
    role: options.role ?? null
  });
}

function component(definition) {
  return Object.freeze({
    ...definition,
    pins: Object.freeze(definition.pins),
    dimensions: Object.freeze(definition.dimensions ?? [10, 8, 10]),
    schematic: Object.freeze(definition.schematic ?? {}),
    sim: Object.freeze(definition.sim ?? {})
  });
}

const ledPins = [
  componentPin("anode", "Anode", PIN_TYPES.GPIO, [-1.27, 0, 0], { role: "positive" }),
  componentPin("cathode", "Cathode", PIN_TYPES.GROUND, [1.27, 0, 0], { role: "negative" })
];

const components = Object.freeze({
  "led-5mm-red": component({
    id: "led-5mm-red",
    name: "5 mm Red LED",
    category: "Output",
    color: "#ef4444",
    dimensions: [7, 12, 7],
    model: "led.glb",
    pins: ledPins,
    schematic: { symbol: "led" },
    sim: { role: "led", outputPin: "anode", returnPin: "cathode", nominalVoltage: 2.0 }
  }),
  "led-5mm-green": component({
    id: "led-5mm-green",
    name: "5 mm Green LED",
    category: "Output",
    color: "#22c55e",
    dimensions: [7, 12, 7],
    model: "led.glb",
    pins: ledPins,
    schematic: { symbol: "led" },
    sim: { role: "led", outputPin: "anode", returnPin: "cathode", nominalVoltage: 2.1 }
  }),
  "led-5mm-yellow": component({
    id: "led-5mm-yellow",
    name: "5 mm Yellow LED",
    category: "Output",
    color: "#eab308",
    dimensions: [7, 12, 7],
    model: "led.glb",
    pins: ledPins,
    schematic: { symbol: "led" },
    sim: { role: "led", outputPin: "anode", returnPin: "cathode", nominalVoltage: 2.0 }
  }),
  "resistor-220r": component({
    id: "resistor-220r",
    name: "220 ohm Resistor",
    category: "Passive",
    color: "#d6b06d",
    dimensions: [18, 5, 5],
    model: "resistor.glb",
    pins: [
      componentPin("a", "A", PIN_TYPES.GPIO, [-8, 0, 0]),
      componentPin("b", "B", PIN_TYPES.GPIO, [8, 0, 0])
    ],
    schematic: { symbol: "resistor" },
    sim: { role: "resistor", resistanceOhm: 220, passive: true, bridgePins: ["a", "b"] }
  }),
  "resistor-10k": component({
    id: "resistor-10k",
    name: "10k Resistor",
    category: "Passive",
    color: "#c99a5a",
    dimensions: [18, 5, 5],
    model: "resistor.glb",
    pins: [
      componentPin("a", "A", PIN_TYPES.GPIO, [-8, 0, 0]),
      componentPin("b", "B", PIN_TYPES.GPIO, [8, 0, 0])
    ],
    schematic: { symbol: "resistor" },
    sim: { role: "resistor", resistanceOhm: 10000, passive: true, bridgePins: ["a", "b"] }
  }),
  "button-6mm": component({
    id: "button-6mm",
    name: "6 mm Tactile Button",
    category: "Input",
    color: "#38bdf8",
    dimensions: [8, 5, 8],
    model: "button.glb",
    pins: [
      componentPin("a", "A", PIN_TYPES.GPIO, [-3, 0, -3], { role: "input" }),
      componentPin("b", "B", PIN_TYPES.GROUND, [3, 0, 3], { role: "return" })
    ],
    schematic: { symbol: "button" },
    sim: { role: "button", inputPin: "a", returnPin: "b" }
  })
});

export const catalog = Object.freeze({
  getBoard: (id) => boards[id] ?? null,
  getComponent: (id) => components[id] ?? null,
  listBoards: () => Object.values(boards),
  listComponents: () => Object.values(components)
});

export function boardPinById(board, pinId) {
  return board?.pins?.find((item) => item.id === pinId || item.label === pinId) ?? null;
}

export function componentPinById(componentDef, pinId) {
  return componentDef?.pins?.find((item) => item.id === pinId || item.label === pinId) ?? null;
}

export function pinColor(type) {
  if (type === PIN_TYPES.POWER) return "#ef4444";
  if (type === PIN_TYPES.GROUND) return "#38bdf8";
  if (type === PIN_TYPES.RESERVED) return "#94a3b8";
  return "#fbbf24";
}

export function isGroundPin(pinDef) {
  return pinDef?.type === PIN_TYPES.GROUND || String(pinDef?.id ?? "").toUpperCase().includes("GND");
}

export function isPowerPin(pinDef) {
  return pinDef?.type === PIN_TYPES.POWER || ["VIN", "3V3", "5V"].includes(String(pinDef?.id ?? "").toUpperCase());
}

export function gpioNumber(pinId) {
  const match = String(pinId ?? "").match(/GPIO(\d+)/i);
  return match ? Number(match[1]) : null;
}
