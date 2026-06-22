import { roboticsPhysicalCatalog } from "./roboticsPhysicalCatalog.js";

export const CONNECTOR_INTERFACES = Object.freeze({
  FEMALE_BREADBOARD_SOCKET: "female-breadboard-socket",
  FEMALE_CONTROLLER_HEADER: "female-controller-header",
  MALE_HEADER_PIN: "male-header-pin",
  COMPONENT_LEAD: "component-lead",
  SCREW_TERMINAL: "screw-terminal",
  SERVO_FEMALE_PLUG: "servo-female-plug",
  SERVO_MALE_HEADER: "servo-male-header",
  JST_POWER: "jst-power-lead",
  PIGTAIL_CONDUCTOR: "pigtail-conductor",
  SOLDER_LUG: "solder-lug",
  MOTOR_TAB: "motor-tab",
  STEPPER_COIL: "stepper-coil-lead",
  JUMPER_WIRE_END: "jumper-wire-end"
});

export const DIRECT_INSERT_COMPATIBILITY = Object.freeze({
  "component-lead": Object.freeze(["female-breadboard-socket"]),
  "male-header-pin": Object.freeze(["female-breadboard-socket", "female-controller-header"]),
  "jumper-wire-end": Object.freeze([
    "female-breadboard-socket",
    "female-controller-header",
    "male-header-pin",
    "component-lead",
    "screw-terminal",
    "servo-female-plug",
    "servo-male-header",
    "jst-power-lead",
    "pigtail-conductor",
    "solder-lug",
    "motor-tab",
    "stepper-coil-lead"
  ])
});

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function bounds(width, height, x = -width / 2, y = -height / 2) {
  return { x, y, width, height };
}

function terminal(positionMm, connectorInterface, options = {}) {
  const [x, y] = positionMm;
  const visibleSize = options.visibleSizeMm ?? (connectorInterface === CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET ? 1.9 : 3.2);
  return {
    positionMm: [Number(x), Number(y)],
    visibleBoundsMm: options.visibleBoundsMm ?? bounds(visibleSize, visibleSize, Number(x) - visibleSize / 2, Number(y) - visibleSize / 2),
    connectorInterface,
    attachmentCapacity: options.attachmentCapacity ?? 1,
    sourceMappingId: options.sourceMappingId ?? null,
    physicalLabel: options.physicalLabel ?? null
  };
}

function controls(controlsById = {}) {
  return controlsById;
}

function definePhysical(id, definition) {
  const [width, height] = definition.physicalSizeMm;
  return freezeDeep({
    id,
    version: 1,
    physicalSizeMm: [width, height],
    bodyBoundsMm: definition.bodyBoundsMm ?? bounds(width, height),
    visualBoundsMm: definition.visualBoundsMm ?? definition.bodyBoundsMm ?? bounds(width, height),
    clampBoundsMm: definition.clampBoundsMm ?? definition.visualBoundsMm ?? definition.bodyBoundsMm ?? bounds(width, height),
    terminals: definition.terminals ?? {},
    insertionPatterns: definition.insertionPatterns ?? [],
    controls: definition.controls ?? {}
  });
}

function fiveHoleIds(column, letters) {
  return letters.map((letter) => `r${column}${letter}`);
}

function makeBb400Terminals({ railHoles = 25, railPitch = 2.54, centralColumns = 30, centralPitch = 2.54, legacy = false } = {}) {
  const terminals = {};
  const centralStart = -((centralColumns - 1) * centralPitch) / 2;
  const railStart = -((railHoles - 1) * railPitch) / 2;
  for (let column = 1; column <= centralColumns; column += 1) {
    const x = centralStart + (column - 1) * centralPitch;
    ["a", "b", "c", "d", "e"].forEach((letter, index) => {
      terminals[`r${column}${letter}`] = terminal([x, -11.43 + index * centralPitch], CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET);
    });
    ["f", "g", "h", "i", "j"].forEach((letter, index) => {
      terminals[`r${column}${letter}`] = terminal([x, 1.27 + index * centralPitch], CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET);
    });
  }
  for (let index = 1; index <= railHoles; index += 1) {
    const x = legacy ? -72 + (index - 1) * 5 : railStart + (index - 1) * railPitch;
    terminals[`tp${index}`] = terminal([x, legacy ? -32 : -24.13], CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET);
    terminals[`tn${index}`] = terminal([x, legacy ? -27 : -19.05], CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET);
    terminals[`bp${index}`] = terminal([x, legacy ? 27 : 19.05], CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET);
    terminals[`bn${index}`] = terminal([x, legacy ? 32 : 24.13], CONNECTOR_INTERFACES.FEMALE_BREADBOARD_SOCKET);
  }
  return terminals;
}

const UNO_DIGITAL_TOP = ["D13", "D12", "D11", "D10", "D9", "D8"];
const UNO_DIGITAL_RIGHT = ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"];
const UNO_POWER = ["IOREF", "RESET", "3V3", "5V", "GND", "GND2", "VIN"];
const UNO_ANALOG = ["A0", "A1", "A2", "A3", "A4", "A5"];

function makeUnoTerminals() {
  const terminals = {};
  UNO_DIGITAL_TOP.forEach((id, index) => {
    terminals[id] = terminal([14.5 + index * 2.54, -23.5], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: id });
  });
  UNO_DIGITAL_RIGHT.forEach((id, index) => {
    terminals[id] = terminal([33.3, -17.78 + index * 2.54], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: id });
  });
  UNO_POWER.forEach((id, index) => {
    terminals[id] = terminal([-26.7 + index * 2.54, 22.2], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: id });
  });
  UNO_ANALOG.forEach((id, index) => {
    terminals[id] = terminal([11.4 + index * 2.54, 22.2], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: id });
  });
  terminals.AREF = terminal([9.42, -23.5], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: "AREF" });
  terminals.GND3 = terminal([11.96, -23.5], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: "GND3" });
  terminals.SDA = terminal([29.74, -23.5], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: "SDA" });
  terminals.SCL = terminal([32.28, -23.5], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, { sourceMappingId: "SCL" });
  return terminals;
}

const ESP32_LEFT = ["VIN", "GND2", "GPIO13", "GPIO12", "GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39", "GPIO36", "EN"];
const ESP32_RIGHT = ["3V3", "GND", "GPIO15", "GPIO2", "GPIO4", "GPIO16", "GPIO17", "GPIO5", "GPIO18", "GPIO19", "GPIO21", "GPIO3", "GPIO1", "GPIO22", "GPIO23"];

function makeEsp32Terminals() {
  const terminals = {};
  ESP32_LEFT.forEach((id, index) => {
    terminals[id] = terminal([-12.7, -17.78 + index * 2.54], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { sourceMappingId: id });
  });
  ESP32_RIGHT.forEach((id, index) => {
    terminals[id] = terminal([12.7, -17.78 + index * 2.54], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { sourceMappingId: id });
  });
  return terminals;
}

export const physicalCatalog = freezeDeep({
  "breadboard-bb400-400": definePhysical("breadboard-bb400-400", {
    physicalSizeMm: [84, 54.3],
    terminals: makeBb400Terminals(),
    insertionPatterns: []
  }),
  "breadboard-400": definePhysical("breadboard-400", {
    physicalSizeMm: [165, 72],
    terminals: makeBb400Terminals({ railHoles: 30, railPitch: 5, centralPitch: 5, legacy: true }),
    insertionPatterns: []
  }),
  "controller-arduino-uno-r3": definePhysical("controller-arduino-uno-r3", {
    physicalSizeMm: [72.58, 53.34],
    terminals: makeUnoTerminals(),
    insertionPatterns: []
  }),
  "controller-esp32-devkit": definePhysical("controller-esp32-devkit", {
    physicalSizeMm: [30, 55],
    terminals: makeEsp32Terminals(),
    insertionPatterns: [
      {
        id: "esp32-devkit-v1-30-pin-headers",
        terminalIds: [...ESP32_LEFT, ...ESP32_RIGHT],
        rigidity: "rigid",
        allowedRotationsDeg: [0, 180],
        positionToleranceMm: 0.25,
        angularToleranceDeg: 1
      }
    ]
  }),
  "supply-servo-6v": definePhysical("supply-servo-6v", {
    physicalSizeMm: [62, 34],
    terminals: {
      VPLUS: terminal([-25, -8], CONNECTOR_INTERFACES.SCREW_TERMINAL),
      GND: terminal([-25, 8], CONNECTOR_INTERFACES.SCREW_TERMINAL)
    },
    controls: controls({
      power: {
        type: "toggle",
        hitShapeMm: bounds(12, 12, 17, -14),
        focusOrder: 1,
        persistent: true,
        defaultValue: "off",
        legacyDefaultValue: "on",
        normalize: "power"
      }
    })
  }),
  "servo-standard": definePhysical("servo-standard", {
    physicalSizeMm: [52, 28],
    visualBoundsMm: bounds(72, 32, -34, -16),
    terminals: {
      signal: terminal([26, -8], CONNECTOR_INTERFACES.SERVO_FEMALE_PLUG),
      vplus: terminal([26, 0], CONNECTOR_INTERFACES.SERVO_FEMALE_PLUG),
      gnd: terminal([26, 8], CONNECTOR_INTERFACES.SERVO_FEMALE_PLUG)
    },
    controls: controls({
      previewAngleDeg: {
        type: "angle",
        hitShapeMm: bounds(24, 24, -2, -12),
        focusOrder: 1,
        persistent: true,
        defaultValue: 90,
        legacyDefaultValue: 90,
        normalize: "servoAngle"
      }
    })
  }),
  "led-red": definePhysical("led-red", {
    physicalSizeMm: [18, 18],
    terminals: {
      anode: terminal([-5.08, 0], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      cathode: terminal([5.08, 0], CONNECTOR_INTERFACES.COMPONENT_LEAD)
    },
    insertionPatterns: [{
      id: "fixed-led-leads",
      terminalIds: ["anode", "cathode"],
      rigidity: "fixed-lead-span",
      allowedRotationsDeg: [0, 90, 180, 270],
      positionToleranceMm: 0.25,
      angularToleranceDeg: 1
    }]
  }),
  "resistor-220": definePhysical("resistor-220", {
    physicalSizeMm: [30, 10],
    terminals: {
      a: terminal([-5.08, 0], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      b: terminal([5.08, 0], CONNECTOR_INTERFACES.COMPONENT_LEAD)
    },
    insertionPatterns: [{
      id: "fixed-resistor-10-16mm-span",
      terminalIds: ["a", "b"],
      rigidity: "fixed-lead-span",
      allowedRotationsDeg: [0, 90, 180, 270],
      positionToleranceMm: 0.25,
      angularToleranceDeg: 1
    }]
  }),
  "capacitor-electrolytic-470uf": definePhysical("capacitor-electrolytic-470uf", {
    physicalSizeMm: [24, 22],
    terminals: {
      pos: terminal([0, 12], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      neg: terminal([0, 17.08], CONNECTOR_INTERFACES.COMPONENT_LEAD)
    },
    insertionPatterns: [{
      id: "radial-capacitor-5-08mm-span",
      terminalIds: ["pos", "neg"],
      rigidity: "fixed-lead-span",
      allowedRotationsDeg: [0, 90, 180, 270],
      positionToleranceMm: 0.25,
      angularToleranceDeg: 1
    }]
  }),
  "button-tactile": definePhysical("button-tactile", {
    physicalSizeMm: [12, 12],
    terminals: {
      sense: terminal([-3.81, -3.81], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      sense2: terminal([3.81, -3.81], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      return: terminal([-3.81, 3.81], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      return2: terminal([3.81, 3.81], CONNECTOR_INTERFACES.COMPONENT_LEAD)
    },
    insertionPatterns: [{
      id: "tactile-switch-four-legs",
      terminalIds: ["sense", "sense2", "return", "return2"],
      rigidity: "rigid",
      allowedRotationsDeg: [0, 90, 180, 270],
      positionToleranceMm: 0.25,
      angularToleranceDeg: 1
    }],
    controls: controls({
      press: {
        type: "momentary",
        hitShapeMm: bounds(10, 10),
        focusOrder: 1,
        persistent: false,
        defaultValue: "up",
        legacyDefaultValue: "up",
        normalize: "momentary"
      }
    })
  }),
  "ultrasonic-hcsr04": definePhysical("ultrasonic-hcsr04", {
    physicalSizeMm: [45, 24],
    terminals: {
      VCC: terminal([-3.81, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN),
      TRIG: terminal([-1.27, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN),
      ECHO: terminal([1.27, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN),
      GND: terminal([3.81, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN)
    },
    insertionPatterns: []
  }),
  "driver-l298n": definePhysical("driver-l298n", {
    physicalSizeMm: [58, 42],
    terminals: {
      VMOTOR: terminal([-24, -16], CONNECTOR_INTERFACES.SCREW_TERMINAL),
      GND: terminal([-24, -6], CONNECTOR_INTERFACES.SCREW_TERMINAL),
      IN1: terminal([-24, 8], CONNECTOR_INTERFACES.MALE_HEADER_PIN),
      IN2: terminal([-24, 16], CONNECTOR_INTERFACES.MALE_HEADER_PIN),
      OUT1: terminal([24, -8], CONNECTOR_INTERFACES.SCREW_TERMINAL),
      OUT2: terminal([24, 8], CONNECTOR_INTERFACES.SCREW_TERMINAL)
    }
  }),
  "motor-dc": definePhysical("motor-dc", {
    physicalSizeMm: [42, 28],
    terminals: {
      a: terminal([-18, 0], CONNECTOR_INTERFACES.MOTOR_TAB),
      b: terminal([18, 0], CONNECTOR_INTERFACES.MOTOR_TAB)
    }
  }),
  "potentiometer-10k": definePhysical("potentiometer-10k", {
    physicalSizeMm: [26, 30],
    terminals: {
      A: terminal([-5.08, 15], CONNECTOR_INTERFACES.SOLDER_LUG),
      W: terminal([0, 15], CONNECTOR_INTERFACES.SOLDER_LUG),
      B: terminal([5.08, 15], CONNECTOR_INTERFACES.SOLDER_LUG)
    },
    controls: controls({
      wiper: {
        type: "range",
        hitShapeMm: bounds(18, 18, -9, -14),
        focusOrder: 1,
        persistent: true,
        defaultValue: 0.5,
        legacyDefaultValue: 0.5,
        normalize: "unitInterval"
      }
    })
  }),
  "switch-spdt-slide": definePhysical("switch-spdt-slide", {
    physicalSizeMm: [18, 10],
    terminals: {
      A: terminal([-5.08, 6], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      COM: terminal([0, 6], CONNECTOR_INTERFACES.COMPONENT_LEAD),
      B: terminal([5.08, 6], CONNECTOR_INTERFACES.COMPONENT_LEAD)
    },
    controls: controls({
      throw: {
        type: "switch",
        hitShapeMm: bounds(14, 9, -7, -5),
        focusOrder: 1,
        persistent: true,
        defaultValue: "a",
        legacyDefaultValue: "a",
        normalize: "throw"
      }
    })
  }),
  ...roboticsPhysicalCatalog
});

export function getPhysicalDefinition(componentTypeId) {
  return physicalCatalog[componentTypeId] ?? null;
}

export function listPhysicalDefinitions() {
  return Object.values(physicalCatalog);
}

export function physicalTerminalIds(componentTypeId) {
  return Object.keys(getPhysicalDefinition(componentTypeId)?.terminals ?? {});
}

export function directConnectorInterfacesCompatible(sourceInterface, targetInterface) {
  if (!sourceInterface || !targetInterface) return false;
  if (sourceInterface === targetInterface) return true;
  return DIRECT_INSERT_COMPATIBILITY[sourceInterface]?.includes(targetInterface) ?? false;
}

export function relativeScalesMatch(sourceScale = 1, targetScale = 1, tolerance = 0.005) {
  const source = Number(sourceScale);
  const target = Number(targetScale);
  if (!Number.isFinite(source) || !Number.isFinite(target) || target === 0) return false;
  return Math.abs((source / target) - 1) <= tolerance;
}

export function breadboardBusDefinitions({ railHoles = 25 } = {}) {
  const buses = [];
  for (let column = 1; column <= 30; column += 1) {
    buses.push({ id: `row_${column}_left`, terminalIds: fiveHoleIds(column, ["a", "b", "c", "d", "e"]) });
    buses.push({ id: `row_${column}_right`, terminalIds: fiveHoleIds(column, ["f", "g", "h", "i", "j"]) });
  }
  buses.push({ id: "top_positive_rail", terminalIds: Array.from({ length: railHoles }, (_, index) => `tp${index + 1}`) });
  buses.push({ id: "top_ground_rail", terminalIds: Array.from({ length: railHoles }, (_, index) => `tn${index + 1}`) });
  buses.push({ id: "bottom_positive_rail", terminalIds: Array.from({ length: railHoles }, (_, index) => `bp${index + 1}`) });
  buses.push({ id: "bottom_ground_rail", terminalIds: Array.from({ length: railHoles }, (_, index) => `bn${index + 1}`) });
  return buses;
}
