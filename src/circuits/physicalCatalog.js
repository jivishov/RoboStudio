import { roboticsPhysicalCatalog } from "./roboticsPhysicalCatalog.js";
import { geometryEvidenceId } from "./geometryEvidence.js";

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
  "servo-female-plug": Object.freeze(["servo-male-header"]),
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
    connectorId: options.connectorId ?? null,
    anchorKind: options.anchorKind ?? "on-body",
    attachmentCapacity: options.attachmentCapacity ?? 1,
    sourceMappingId: options.sourceMappingId ?? null,
    physicalLabel: options.physicalLabel ?? null
  };
}

function physicalPort(id, engineeringConnectorId, terminalIds, housingBoundsMm, contactPitchMm, contactAxisLocal, outwardNormalLocal, keyed = false, componentTypeId = null) {
  return {
    id,
    engineeringConnectorId,
    terminalIds,
    housingBoundsMm,
    contactPitchMm,
    contactAxisLocal,
    outwardNormalLocal,
    keyed,
    geometryEvidenceId: geometryEvidenceId(componentTypeId)
  };
}

function horizontalPortBounds(startX, endX, y, thickness = 3.2) {
  const half = thickness / 2;
  const left = Math.min(startX, endX) - half;
  return bounds(Math.abs(endX - startX) + thickness, thickness, left, y - half);
}

function verticalPortBounds(x, startY, endY, thickness = 3.2) {
  const half = thickness / 2;
  const top = Math.min(startY, endY) - half;
  return bounds(thickness, Math.abs(endY - startY) + thickness, x - half, top);
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
    visualBoundsMm: definition.visualBoundsMm ?? bounds(width, height),
    clampBoundsMm: definition.clampBoundsMm ?? definition.visualBoundsMm ?? bounds(width, height),
    geometryEvidenceId: definition.geometryEvidenceId ?? geometryEvidenceId(id),
    terminals: definition.terminals ?? {},
    physicalPorts: definition.physicalPorts ?? [],
    formedLeadGeometry: definition.formedLeadGeometry ?? null,
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

const UNO_DIGITAL_8 = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"];
const UNO_DIGITAL_10 = ["D8", "D9", "D10", "D11", "D12", "D13", "GND3", "AREF", "SDA", "SCL"];
const UNO_POWER = ["NC", "IOREF", "RESET", "3V3", "5V", "GND", "GND2", "VIN"];
const UNO_ANALOG = ["A0", "A1", "A2", "A3", "A4", "A5"];
const UNO_VISUAL_CENTER_FROM_BOARD_CENTER_X = 2;

function makeUnoTerminals() {
  const terminals = {};
  UNO_DIGITAL_8.forEach((id, index) => {
    terminals[id] = terminal([31.21 - index * 2.54, -24.13], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, {
      connectorId: "digital-header-8",
      sourceMappingId: id
    });
  });
  UNO_DIGITAL_10.forEach((id, index) => {
    terminals[id] = terminal([9.366 - index * 2.54, -24.13], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, {
      connectorId: "digital-header-10",
      sourceMappingId: id
    });
  });
  UNO_POWER.forEach((id, index) => {
    terminals[id] = terminal([-6.35 + UNO_VISUAL_CENTER_FROM_BOARD_CENTER_X + index * 2.54, 24.13], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, {
      connectorId: "power-header",
      sourceMappingId: id
    });
  });
  UNO_ANALOG.forEach((id, index) => {
    terminals[id] = terminal([16.51 + UNO_VISUAL_CENTER_FROM_BOARD_CENTER_X + index * 2.54, 24.13], CONNECTOR_INTERFACES.FEMALE_CONTROLLER_HEADER, {
      connectorId: "analog-header",
      sourceMappingId: id
    });
  });
  return terminals;
}

const ESP32_LEFT = ["3V3", "EN", "GPIO36", "GPIO39", "GPIO34", "GPIO35", "GPIO32", "GPIO33", "GPIO25", "GPIO26", "GPIO27", "GPIO14", "GPIO12", "GND2", "GPIO13", "D2", "D3", "CMD", "VIN"];
const ESP32_RIGHT = ["GND", "GPIO23", "GPIO22", "GPIO1", "GPIO3", "GPIO21", "GND3", "GPIO19", "GPIO18", "GPIO5", "GPIO17", "GPIO16", "GPIO4", "GPIO0", "GPIO2", "GPIO15", "D1", "D0", "CLK"];

function makeEsp32Terminals() {
  const terminals = {};
  ESP32_LEFT.forEach((id, index) => {
    terminals[id] = terminal([-12.7, -22.86 + index * 2.54], CONNECTOR_INTERFACES.MALE_HEADER_PIN, {
      connectorId: "j2-header",
      sourceMappingId: id
    });
  });
  ESP32_RIGHT.forEach((id, index) => {
    terminals[id] = terminal([12.7, -22.86 + index * 2.54], CONNECTOR_INTERFACES.MALE_HEADER_PIN, {
      connectorId: "j3-header",
      sourceMappingId: id
    });
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
    bodyBoundsMm: bounds(68.58, 53.34, -32.29, -26.67),
    visualBoundsMm: bounds(72.58, 53.34),
    clampBoundsMm: bounds(72.58, 53.34),
    terminals: makeUnoTerminals(),
    physicalPorts: [
      physicalPort("digital-header-8", "digital-header-8", UNO_DIGITAL_8, horizontalPortBounds(31.21, 13.43, -24.13), 2.54, [-1, 0], [0, -1], false, "controller-arduino-uno-r3"),
      physicalPort("digital-header-10", "digital-header-10", UNO_DIGITAL_10, horizontalPortBounds(9.366, -13.494, -24.13), 2.54, [-1, 0], [0, -1], false, "controller-arduino-uno-r3"),
      physicalPort("power-header", "power-header", UNO_POWER, horizontalPortBounds(-4.35, 13.43, 24.13), 2.54, [1, 0], [0, 1], false, "controller-arduino-uno-r3"),
      physicalPort("analog-header", "analog-header", UNO_ANALOG, horizontalPortBounds(18.51, 31.21, 24.13), 2.54, [1, 0], [0, 1], false, "controller-arduino-uno-r3")
    ],
    insertionPatterns: []
  }),
  "controller-esp32-devkit": definePhysical("controller-esp32-devkit", {
    physicalSizeMm: [27.94, 48.26],
    terminals: makeEsp32Terminals(),
    physicalPorts: [
      physicalPort("j2-header", "j2-header", ESP32_LEFT, verticalPortBounds(-12.7, -22.86, 22.86, 2.54), 2.54, [0, 1], [-1, 0], false, "controller-esp32-devkit"),
      physicalPort("j3-header", "j3-header", ESP32_RIGHT, verticalPortBounds(12.7, -22.86, 22.86, 2.54), 2.54, [0, 1], [1, 0], false, "controller-esp32-devkit")
    ],
    insertionPatterns: [
      {
        id: "esp32-devkitc-v4-38-pin-headers",
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
      VPLUS: terminal([-25, -2.54], CONNECTOR_INTERFACES.SCREW_TERMINAL, { connectorId: "supply-output" }),
      GND: terminal([-25, 2.54], CONNECTOR_INTERFACES.SCREW_TERMINAL, { connectorId: "supply-output" })
    },
    physicalPorts: [
      physicalPort("supply-output", "supply-output", ["VPLUS", "GND"], verticalPortBounds(-25, -2.54, 2.54, 5), 5.08, [0, 1], [-1, 0], true, "supply-servo-6v")
    ],
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
      signal: terminal([34, -2.54], CONNECTOR_INTERFACES.SERVO_FEMALE_PLUG, { connectorId: "servo-lead", anchorKind: "external-port" }),
      vplus: terminal([34, 0], CONNECTOR_INTERFACES.SERVO_FEMALE_PLUG, { connectorId: "servo-lead", anchorKind: "external-port" }),
      gnd: terminal([34, 2.54], CONNECTOR_INTERFACES.SERVO_FEMALE_PLUG, { connectorId: "servo-lead", anchorKind: "external-port" })
    },
    physicalPorts: [
      physicalPort("servo-plug", "servo-lead", ["signal", "vplus", "gnd"], verticalPortBounds(34, -2.54, 2.54, 5), 2.54, [0, 1], [1, 0], true, "servo-standard")
    ],
    insertionPatterns: [{
      id: "standard-servo-three-contact-plug",
      terminalIds: ["signal", "vplus", "gnd"],
      rigidity: "rigid",
      allowedRotationsDeg: [0, 90, 180, 270],
      positionToleranceMm: 0.25,
      angularToleranceDeg: 1
    }],
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
    bodyBoundsMm: bounds(8, 10, -4, -6),
    terminals: {
      anode: terminal([-1.27, 8], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "led-legs", anchorKind: "external-lead" }),
      cathode: terminal([1.27, 8], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "led-legs", anchorKind: "external-lead" })
    },
    formedLeadGeometry: {
      version: 1,
      leadPathsMm: {
        anode: [[-1.27, 2], [-1.27, 8]],
        cathode: [[1.27, 2], [1.27, 8]]
      }
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
    bodyBoundsMm: bounds(18, 7, -9, -3.5),
    visualBoundsMm: bounds(30, 18, -15, -5),
    terminals: {
      a: terminal([-5.08, 8], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "resistor-leads", anchorKind: "external-lead" }),
      b: terminal([5.08, 8], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "resistor-leads", anchorKind: "external-lead" })
    },
    formedLeadGeometry: {
      version: 1,
      leadPathsMm: {
        a: [[-9, 0], [-12, 0], [-12, 8], [-5.08, 8]],
        b: [[9, 0], [12, 0], [12, 8], [5.08, 8]]
      }
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
    bodyBoundsMm: bounds(14, 17, -7, -9),
    terminals: {
      pos: terminal([-1.27, 10], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "capacitor-legs", anchorKind: "external-lead" }),
      neg: terminal([1.27, 10], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "capacitor-legs", anchorKind: "external-lead" })
    },
    formedLeadGeometry: {
      version: 1,
      leadPathsMm: {
        pos: [[-1.27, 5], [-1.27, 10]],
        neg: [[1.27, 5], [1.27, 10]]
      }
    },
    insertionPatterns: [{
      id: "radial-capacitor-2-54mm-span",
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
      sense: terminal([-3.81, -2.54], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "button-pins" }),
      sense2: terminal([3.81, -2.54], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "button-pins" }),
      return: terminal([-3.81, 2.54], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "button-pins" }),
      return2: terminal([3.81, 2.54], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "button-pins" })
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
    visualBoundsMm: bounds(45, 28, -22.5, -12),
    terminals: {
      VCC: terminal([-3.81, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { connectorId: "hcsr04-header", anchorKind: "external-port" }),
      TRIG: terminal([-1.27, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { connectorId: "hcsr04-header", anchorKind: "external-port" }),
      ECHO: terminal([1.27, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { connectorId: "hcsr04-header", anchorKind: "external-port" }),
      GND: terminal([3.81, 13], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { connectorId: "hcsr04-header", anchorKind: "external-port" })
    },
    physicalPorts: [
      physicalPort("hcsr04-header", "hcsr04-header", ["VCC", "TRIG", "ECHO", "GND"], horizontalPortBounds(-3.81, 3.81, 13), 2.54, [1, 0], [0, 1], false, "ultrasonic-hcsr04")
    ],
    insertionPatterns: []
  }),
  "driver-l298n": definePhysical("driver-l298n", {
    physicalSizeMm: [58, 42],
    terminals: {
      VMOTOR: terminal([-24, -12.54], CONNECTOR_INTERFACES.SCREW_TERMINAL, { connectorId: "l298n-power" }),
      GND: terminal([-24, -7.46], CONNECTOR_INTERFACES.SCREW_TERMINAL, { connectorId: "l298n-power" }),
      IN1: terminal([-24, 8], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { connectorId: "l298n-logic" }),
      IN2: terminal([-24, 10.54], CONNECTOR_INTERFACES.MALE_HEADER_PIN, { connectorId: "l298n-logic" }),
      OUT1: terminal([24, -2.54], CONNECTOR_INTERFACES.SCREW_TERMINAL, { connectorId: "l298n-motor" }),
      OUT2: terminal([24, 2.54], CONNECTOR_INTERFACES.SCREW_TERMINAL, { connectorId: "l298n-motor" })
    },
    physicalPorts: [
      physicalPort("l298n-power", "l298n-power", ["VMOTOR", "GND"], verticalPortBounds(-24, -12.54, -7.46, 5), 5.08, [0, 1], [-1, 0], true, "driver-l298n"),
      physicalPort("l298n-logic", "l298n-logic", ["IN1", "IN2"], verticalPortBounds(-24, 8, 10.54), 2.54, [0, 1], [-1, 0], false, "driver-l298n"),
      physicalPort("l298n-motor", "l298n-motor", ["OUT1", "OUT2"], verticalPortBounds(24, -2.54, 2.54, 5), 5.08, [0, 1], [1, 0], true, "driver-l298n")
    ]
  }),
  "motor-dc": definePhysical("motor-dc", {
    physicalSizeMm: [42, 28],
    terminals: {
      a: terminal([-18, 0], CONNECTOR_INTERFACES.MOTOR_TAB, { connectorId: "motor-leads" }),
      b: terminal([18, 0], CONNECTOR_INTERFACES.MOTOR_TAB, { connectorId: "motor-leads" })
    }
  }),
  "potentiometer-10k": definePhysical("potentiometer-10k", {
    physicalSizeMm: [26, 30],
    terminals: {
      A: terminal([-5.08, 15], CONNECTOR_INTERFACES.SOLDER_LUG, { connectorId: "pot-lugs" }),
      W: terminal([0, 15], CONNECTOR_INTERFACES.SOLDER_LUG, { connectorId: "pot-lugs" }),
      B: terminal([5.08, 15], CONNECTOR_INTERFACES.SOLDER_LUG, { connectorId: "pot-lugs" })
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
    visualBoundsMm: bounds(18, 14, -9, -5),
    terminals: {
      A: terminal([-5.08, 6], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "switch-pins", anchorKind: "external-lead" }),
      COM: terminal([0, 6], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "switch-pins", anchorKind: "external-lead" }),
      B: terminal([5.08, 6], CONNECTOR_INTERFACES.COMPONENT_LEAD, { connectorId: "switch-pins", anchorKind: "external-lead" })
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
