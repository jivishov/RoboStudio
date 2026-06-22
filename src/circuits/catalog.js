import {
  CIRCUIT_CUSTOM_TYPE_PREFIX,
  normalizeCircuitCustomComponentDefinition
} from "./customComponents.js";
import { breadboardBusDefinitions, getPhysicalDefinition, physicalTerminalIds } from "./physicalCatalog.js";
import { roboticsComponentDefinitions } from "./roboticsCatalog.js";

export const TERMINAL_KINDS = Object.freeze({
  SIGNAL: "signal",
  POWER: "power",
  GROUND: "ground",
  PASSIVE: "passive",
  LOAD: "load"
});

export const DEFAULT_TEMPLATE_ID = "arduino_servo_safe";

function capabilityFlags(options = {}) {
  const legacy = new Set(options.capabilities ?? []);
  const flags = {
    digitalInput: Boolean(options.digitalInput ?? legacy.has("input")),
    digitalOutput: Boolean(options.digitalOutput ?? legacy.has("output")),
    pwm: Boolean(options.pwm),
    servoPulse: Boolean(options.servoPulse),
    adc: Boolean(options.adc),
    i2cSda: Boolean(options.i2cSda),
    i2cScl: Boolean(options.i2cScl),
    uartTx: Boolean(options.uartTx),
    uartRx: Boolean(options.uartRx),
    step: Boolean(options.step),
    direction: Boolean(options.direction),
    enable: Boolean(options.enable)
  };
  return Object.freeze(Object.assign([...legacy], flags));
}

function defaultElectricalRole(kind, options = {}) {
  if (options.electricalRole) return options.electricalRole;
  if (kind === TERMINAL_KINDS.POWER) return Number.isFinite(Number(options.voltage)) ? "power-source" : "power-input";
  if (kind === TERMINAL_KINDS.GROUND) return "ground";
  if (kind === TERMINAL_KINDS.LOAD) return "load-output";
  if (kind === TERMINAL_KINDS.PASSIVE) return "passive";
  const flags = capabilityFlags(options);
  if (flags.digitalInput && flags.digitalOutput) return "bidirectional";
  if (flags.digitalInput) return "signal-input";
  if (flags.digitalOutput) return "signal-output";
  return "bidirectional";
}

function terminal(id, label, kind, x, y, options = {}) {
  const flags = capabilityFlags(options);
  return Object.freeze({
    id,
    label,
    kind,
    position: [x, y],
    voltage: options.voltage ?? null,
    capabilities: flags,
    pwm: Boolean(options.pwm),
    inputOnly: Boolean(options.inputOnly),
    strapping: Boolean(options.strapping),
    bootSensitive: Boolean(options.bootSensitive ?? options.strapping),
    reserved: Boolean(options.reserved),
    reservedReason: options.reservedReason ?? "",
    maxCurrentMa: options.maxCurrentMa ?? null,
    electricalRole: defaultElectricalRole(kind, options),
    voltageDomainId: options.voltageDomainId ?? null,
    signalTypes: Object.freeze(options.signalTypes ?? []),
    logicMinimumV: options.logicMinimumV ?? null,
    logicMaximumV: options.logicMaximumV ?? null,
    shareableBus: Boolean(options.shareableBus),
    connectorId: options.connectorId ?? null,
    connectorInterface: options.connectorInterface ?? null,
    attachmentCapacity: options.attachmentCapacity ?? 1,
    sourceMappingId: options.sourceMappingId ?? null,
    visibleBoundsMm: options.visibleBoundsMm ?? null,
    physicalLabel: options.physicalLabel ?? label,
    recommendedWireColor: options.recommendedWireColor ?? null,
    recommendedGaugeAwg: options.recommendedGaugeAwg ?? null,
    notes: options.notes ?? ""
  });
}

function defaultEngineering(definition) {
  return {
    specificationBasis: "generic",
    voltageDomains: [],
    currentMa: { idle: null, typical: null, peak: null, stall: null },
    polarity: "not-applicable",
    isolated: false,
    connectors: [],
    protection: {
      inductiveLoad: false,
      flyback: "not-applicable",
      currentLimiting: "unknown",
      levelShifting: "unknown",
      decouplingRecommendation: null,
      fuseRecommendation: null
    },
    wiring: {
      recommendedColorsByRole: {},
      recommendedGaugeAwg: null,
      notes: ""
    },
    robotics: {
      role: definition.sim?.role ?? "passive",
      interface: "passive"
    },
    requiredConnections: []
  };
}

function derivePhysicalTerminals(definition, rawTerminals = []) {
  const physical = getPhysicalDefinition(definition.id);
  if (!physical) return rawTerminals;
  const rawById = new Map(rawTerminals.map((item) => [item.id, item]));
  return Object.entries(physical.terminals).map(([terminalId, physicalTerminal]) => {
    const raw = rawById.get(terminalId)
      ?? terminal(terminalId, physicalTerminal.physicalLabel ?? terminalId, TERMINAL_KINDS.PASSIVE, 0, 0);
    return Object.freeze({
      ...raw,
      position: Object.freeze([...physicalTerminal.positionMm]),
      connectorInterface: physicalTerminal.connectorInterface,
      attachmentCapacity: physicalTerminal.attachmentCapacity,
      sourceMappingId: physicalTerminal.sourceMappingId,
      visibleBoundsMm: Object.freeze({ ...physicalTerminal.visibleBoundsMm }),
      physicalLabel: physicalTerminal.physicalLabel ?? raw.physicalLabel ?? raw.label ?? terminalId
    });
  });
}

function component(definition) {
  const defaults = defaultEngineering(definition);
  const provided = definition.engineering ?? {};
  const physical = getPhysicalDefinition(definition.id);
  const derivedTerminals = derivePhysicalTerminals(definition, definition.terminals ?? []);
  const dimensions = physical?.physicalSizeMm ?? definition.dimensions ?? [40, 24];
  const engineering = {
    ...defaults,
    ...provided,
    currentMa: { ...defaults.currentMa, ...(provided.currentMa ?? {}) },
    protection: { ...defaults.protection, ...(provided.protection ?? {}) },
    wiring: { ...defaults.wiring, ...(provided.wiring ?? {}) },
    robotics: { ...defaults.robotics, ...(provided.robotics ?? {}) }
  };
  return Object.freeze({
    ...definition,
    dimensions: Object.freeze(dimensions),
    physicalDefinitionId: physical?.id ?? definition.physicalDefinitionId ?? null,
    bodyBoundsMm: Object.freeze(physical?.bodyBoundsMm ?? { x: -dimensions[0] / 2, y: -dimensions[1] / 2, width: dimensions[0], height: dimensions[1] }),
    visualBoundsMm: Object.freeze(physical?.visualBoundsMm ?? { x: -dimensions[0] / 2, y: -dimensions[1] / 2, width: dimensions[0], height: dimensions[1] }),
    clampBoundsMm: Object.freeze(physical?.clampBoundsMm ?? { x: -dimensions[0] / 2, y: -dimensions[1] / 2, width: dimensions[0], height: dimensions[1] }),
    terminals: Object.freeze(derivedTerminals),
    internalBuses: Object.freeze(definition.internalBuses ?? []),
    insertionPatterns: Object.freeze(physical?.insertionPatterns ?? definition.insertionPatterns ?? []),
    controls: Object.freeze(physical?.controls ?? definition.controls ?? {}),
    hidden: Boolean(definition.hidden),
    engineering: Object.freeze({
      ...engineering,
      voltageDomains: Object.freeze(engineering.voltageDomains ?? []),
      currentMa: Object.freeze(engineering.currentMa ?? {}),
      connectors: Object.freeze(engineering.connectors ?? []),
      protection: Object.freeze(engineering.protection ?? {}),
      wiring: Object.freeze(engineering.wiring ?? {}),
      robotics: Object.freeze(engineering.robotics ?? {}),
      requiredConnections: Object.freeze(engineering.requiredConnections ?? [])
    }),
    sim: Object.freeze(definition.sim ?? {}),
    view: Object.freeze(definition.view ?? {})
  });
}

function breadboardTerminals(typeId = "breadboard-400") {
  return physicalTerminalIds(typeId).map((terminalId) => {
    const railMatch = /^(t|b)(p|n)(\d+)$/.exec(terminalId);
    if (railMatch) {
      const kind = railMatch[2] === "p" ? TERMINAL_KINDS.POWER : TERMINAL_KINDS.GROUND;
      return terminal(terminalId, `${railMatch[2] === "p" ? "+" : "-"}${railMatch[3]}`, kind, 0, 0, {
        connectorId: "tie-points"
      });
    }
    return terminal(terminalId, terminalId.replace(/^r/, ""), TERMINAL_KINDS.PASSIVE, 0, 0, {
      connectorId: "tie-points"
    });
  });
}

function breadboardBuses(railHoles = 30) {
  return breadboardBusDefinitions({ railHoles });
}

const arduinoDigital = Array.from({ length: 14 }, (_, index) =>
  terminal(`D${index}`, `D${index}`, TERMINAL_KINDS.SIGNAL, 28, -29 + index * 4.4, {
    capabilities: ["input", "output"],
    pwm: [3, 5, 6, 9, 10, 11].includes(index),
    servoPulse: index >= 2,
    voltageDomainId: "logic",
    signalTypes: ["digital", "pwm", ...(index >= 2 ? ["servo-pulse"] : [])],
    logicMinimumV: 0,
    logicMaximumV: 5,
    electricalRole: "bidirectional",
    reserved: index < 2,
    reservedReason: index < 2 ? "Default USB serial/programming terminal." : "",
    maxCurrentMa: 20
  })
);

const arduinoAnalog = Array.from({ length: 6 }, (_, index) =>
  terminal(`A${index}`, `A${index}`, TERMINAL_KINDS.SIGNAL, -30 + index * 9.5, 27, {
    capabilities: ["input"],
    adc: true,
    voltageDomainId: "logic",
    signalTypes: ["analog", "digital"],
    logicMinimumV: 0,
    logicMaximumV: 5,
    electricalRole: "bidirectional",
    maxCurrentMa: 20
  })
);

const esp32SignalMeta = [
  ["GPIO13", "GPIO13", false, false, false],
  ["GPIO12", "GPIO12", true, false, false],
  ["GPIO14", "GPIO14", false, false, false],
  ["GPIO27", "GPIO27", false, false, false],
  ["GPIO26", "GPIO26", false, false, false],
  ["GPIO25", "GPIO25", false, false, false],
  ["GPIO33", "GPIO33", false, false, false],
  ["GPIO32", "GPIO32", false, false, false],
  ["GPIO35", "GPIO35", false, true, false],
  ["GPIO34", "GPIO34", false, true, false],
  ["GPIO39", "GPIO39/VN", false, true, false],
  ["GPIO36", "GPIO36/VP", false, true, false],
  ["EN", "EN", false, true, true],
  ["GPIO15", "GPIO15", true, false, false],
  ["GPIO2", "GPIO2", true, false, false],
  ["GPIO4", "GPIO4", true, false, false],
  ["GPIO16", "GPIO16/RX2", false, false, false],
  ["GPIO17", "GPIO17/TX2", false, false, false],
  ["GPIO5", "GPIO5", true, false, false],
  ["GPIO18", "GPIO18", false, false, false],
  ["GPIO19", "GPIO19", false, false, false],
  ["GPIO21", "GPIO21", false, false, false],
  ["GPIO3", "GPIO3/RX0", false, false, true],
  ["GPIO1", "GPIO1/TX0", false, false, true],
  ["GPIO22", "GPIO22", false, false, false],
  ["GPIO23", "GPIO23", false, false, false]
];

const esp32Signals = esp32SignalMeta.map(([id, label, strapping, inputOnly, reserved], index) =>
  terminal(id, label, TERMINAL_KINDS.SIGNAL, index < 13 ? -23 : 23, -24 + (index % 13) * 7.5, {
    capabilities: inputOnly ? ["input"] : ["input", "output"],
    pwm: !inputOnly,
    adc: ["GPIO2", "GPIO4", "GPIO12", "GPIO13", "GPIO14", "GPIO15", "GPIO25", "GPIO26", "GPIO27", "GPIO32", "GPIO33", "GPIO34", "GPIO35", "GPIO36", "GPIO39"].includes(id),
    i2cSda: id === "GPIO21",
    i2cScl: id === "GPIO22",
    shareableBus: id === "GPIO21" || id === "GPIO22",
    voltageDomainId: "logic",
    signalTypes: ["digital", "pwm"],
    logicMinimumV: 0,
    logicMaximumV: 3.3,
    electricalRole: inputOnly ? "signal-input" : "bidirectional",
    inputOnly,
    strapping,
    reserved,
    reservedReason: reserved ? (id === "EN" ? "Enable/reset pin; not a general GPIO." : "Default serial/programming terminal.") : "",
    maxCurrentMa: inputOnly ? null : 12
  })
);

const components = Object.freeze({
  "controller-arduino-uno-r3": component({
    id: "controller-arduino-uno-r3",
    name: "Arduino Uno R3",
    category: "Controller",
    dimensions: [72, 54],
    color: "#1f8a83",
    terminals: [
      ...arduinoDigital,
      ...arduinoAnalog,
      terminal("SDA", "SDA", TERMINAL_KINDS.SIGNAL, 0, 0, {
        capabilities: ["input", "output"],
        i2cSda: true,
        shareableBus: true,
        voltageDomainId: "logic",
        signalTypes: ["i2c"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "bidirectional",
        maxCurrentMa: 20
      }),
      terminal("SCL", "SCL", TERMINAL_KINDS.SIGNAL, 0, 0, {
        capabilities: ["input", "output"],
        i2cScl: true,
        shareableBus: true,
        voltageDomainId: "logic",
        signalTypes: ["i2c"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "bidirectional",
        maxCurrentMa: 20
      }),
      terminal("AREF", "AREF", TERMINAL_KINDS.SIGNAL, 0, 0, {
        capabilities: ["input"],
        voltageDomainId: "logic",
        signalTypes: ["analog-reference"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "signal-input",
        inputOnly: true
      }),
      terminal("IOREF", "IOREF", TERMINAL_KINDS.POWER, 0, 0, {
        voltage: 5,
        maxCurrentMa: 50,
        electricalRole: "power-source",
        voltageDomainId: "logic",
        recommendedWireColor: "red"
      }),
      terminal("RESET", "RESET", TERMINAL_KINDS.SIGNAL, 0, 0, {
        capabilities: ["input"],
        voltageDomainId: "logic",
        signalTypes: ["reset"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "signal-input",
        inputOnly: true
      }),
      terminal("5V", "5V", TERMINAL_KINDS.POWER, -30, 20, {
        voltage: 5,
        maxCurrentMa: 500,
        electricalRole: "power-source",
        voltageDomainId: "logic",
        recommendedWireColor: "red"
      }),
      terminal("3V3", "3V3", TERMINAL_KINDS.POWER, -18, 20, {
        voltage: 3.3,
        maxCurrentMa: 50,
        electricalRole: "power-source",
        voltageDomainId: "logic3v3",
        recommendedWireColor: "orange"
      }),
      terminal("GND", "GND", TERMINAL_KINDS.GROUND, -6, 20, { voltageDomainId: "ground", recommendedWireColor: "black" }),
      terminal("GND2", "GND", TERMINAL_KINDS.GROUND, 6, 20, { voltageDomainId: "ground", recommendedWireColor: "black" }),
      terminal("GND3", "GND", TERMINAL_KINDS.GROUND, 0, 0, { voltageDomainId: "ground", recommendedWireColor: "black" }),
      terminal("VIN", "VIN", TERMINAL_KINDS.POWER, 18, 20, {
        voltage: 7,
        electricalRole: "power-input",
        voltageDomainId: "raw",
        recommendedWireColor: "red"
      })
    ],
    internalBuses: [
      { id: "i2c_sda_duplicate", terminalIds: ["A4", "SDA"] },
      { id: "i2c_scl_duplicate", terminalIds: ["A5", "SCL"] },
      { id: "ground_header_common", terminalIds: ["GND", "GND2", "GND3"] }
    ],
    engineering: {
      voltageDomains: [
        { id: "logic", role: "source", minimumV: 4.75, nominalV: 5, maximumV: 5.25 },
        { id: "logic3v3", role: "source", minimumV: 3.1, nominalV: 3.3, maximumV: 3.5 },
        { id: "raw", role: "input", minimumV: 7, nominalV: 9, maximumV: 12 }
      ],
      connectors: [
        { id: "digital-header", family: "arduino-stackable-header", pinPitchMm: 2.54, keyed: false, terminalIds: [...arduinoDigital.map((item) => item.id), "AREF", "GND3", "SDA", "SCL"] },
        { id: "analog-power-header", family: "arduino-stackable-header", pinPitchMm: 2.54, keyed: false, terminalIds: [...arduinoAnalog.map((item) => item.id), "IOREF", "RESET", "5V", "3V3", "GND", "GND2", "VIN"] }
      ],
      protection: { levelShifting: "not-required", currentLimiting: "unknown" },
      robotics: { role: "controller", interface: "digital" }
    },
    sim: { role: "controller", firmware: "arduino", family: "avr" }
  }),
  "controller-esp32-devkit": component({
    id: "controller-esp32-devkit",
    name: "ESP32 DevKit V1 - 30 pin",
    category: "Controller",
    dimensions: [58, 86],
    color: "#0f766e",
    terminals: [
      ...esp32Signals,
      terminal("3V3", "3V3", TERMINAL_KINDS.POWER, -23, 32, {
        voltage: 3.3,
        maxCurrentMa: 250,
        electricalRole: "power-source",
        voltageDomainId: "logic",
        recommendedWireColor: "orange"
      }),
      terminal("VIN", "5V/VIN", TERMINAL_KINDS.POWER, 23, 32, {
        voltage: 5,
        maxCurrentMa: 500,
        electricalRole: "power-input",
        voltageDomainId: "raw",
        recommendedWireColor: "red"
      }),
      terminal("GND", "GND", TERMINAL_KINDS.GROUND, -23, 39, { voltageDomainId: "ground", recommendedWireColor: "black" }),
      terminal("GND2", "GND", TERMINAL_KINDS.GROUND, 23, 39, { voltageDomainId: "ground", recommendedWireColor: "black" })
    ],
    engineering: {
      voltageDomains: [
        { id: "logic", role: "source", minimumV: 3.1, nominalV: 3.3, maximumV: 3.5 },
        { id: "raw", role: "input", minimumV: 4.75, nominalV: 5, maximumV: 5.5 }
      ],
      connectors: [
        { id: "devkit-headers", family: "esp32-devkit-v1-30pin-header", pinPitchMm: 2.54, keyed: false, terminalIds: ["VIN", "GND2", "GPIO13", "GPIO12", "GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39", "GPIO36", "EN", "3V3", "GND", "GPIO15", "GPIO2", "GPIO4", "GPIO16", "GPIO17", "GPIO5", "GPIO18", "GPIO19", "GPIO21", "GPIO3", "GPIO1", "GPIO22", "GPIO23"] }
      ],
      protection: { levelShifting: "required", currentLimiting: "unknown" },
      robotics: { role: "controller", interface: "digital" }
    },
    sim: { role: "controller", firmware: "espidf", family: "esp32" }
  }),
  "breadboard-bb400-400": component({
    id: "breadboard-bb400-400",
    name: "BB400 400-point breadboard",
    category: "Prototyping",
    color: "#f7f4e8",
    terminals: breadboardTerminals("breadboard-bb400-400"),
    internalBuses: breadboardBuses(25),
    engineering: {
      currentMa: { idle: 0, typical: null, peak: null, stall: null },
      connectors: [
        { id: "tie-points", family: "breadboard-tie-point", pinPitchMm: 2.54, keyed: false, terminalIds: breadboardTerminals("breadboard-bb400-400").map((item) => item.id) }
      ],
      protection: { currentLimiting: "external", fuseRecommendation: "Keep breadboard rail current below 1 A hard maximum and below conservative starter limits." },
      robotics: { role: "prototyping", interface: "passive" }
    },
    sim: { role: "breadboard", maxRailCurrentMa: 1000, railHoles: 25 }
  }),
  "breadboard-400": component({
    id: "breadboard-400",
    name: "Legacy 420-terminal breadboard",
    category: "Prototyping",
    dimensions: [165, 72],
    color: "#f7f4e8",
    hidden: true,
    terminals: breadboardTerminals("breadboard-400"),
    internalBuses: breadboardBuses(30),
    engineering: {
      currentMa: { idle: 0, typical: null, peak: null, stall: null },
      connectors: [
        { id: "tie-points", family: "breadboard-tie-point", pinPitchMm: 5, keyed: false, terminalIds: breadboardTerminals("breadboard-400").map((item) => item.id) }
      ],
      protection: { currentLimiting: "external", fuseRecommendation: "Keep breadboard rail current below 1 A hard maximum and below conservative starter limits." },
      robotics: { role: "prototyping", interface: "passive" }
    },
    sim: { role: "breadboard", maxRailCurrentMa: 1000, legacy: true, railHoles: 30 }
  }),
  "supply-servo-6v": component({
    id: "supply-servo-6v",
    name: "External servo supply 6V",
    category: "Power",
    dimensions: [62, 34],
    color: "#313946",
    terminals: [
      terminal("VPLUS", "+V", TERMINAL_KINDS.POWER, -25, -8, {
        voltage: 6,
        maxCurrentMa: 5000,
        electricalRole: "power-source",
        voltageDomainId: "actuator",
        recommendedWireColor: "red",
        recommendedGaugeAwg: 20
      }),
      terminal("GND", "GND", TERMINAL_KINDS.GROUND, -25, 8, {
        voltageDomainId: "ground",
        recommendedWireColor: "black",
        recommendedGaugeAwg: 20
      })
    ],
    engineering: {
      voltageDomains: [{ id: "actuator", role: "source", minimumV: 5.8, nominalV: 6, maximumV: 6.2 }],
      currentMa: { idle: 0, typical: 5000, peak: 5000, stall: 5000 },
      connectors: [{ id: "supply-output", family: "screw-terminal", pinPitchMm: 5.08, keyed: true, terminalIds: ["VPLUS", "GND"] }],
      protection: { currentLimiting: "unknown", fuseRecommendation: "Use an external fuse sized for the actuator harness." },
      wiring: { recommendedColorsByRole: { "power-source": "red", ground: "black" }, recommendedGaugeAwg: 20, notes: "Use a current-rated external supply for actuators." },
      robotics: { role: "power-source", interface: "passive" }
    },
    sim: { role: "externalSupply", voltage: 6, maxCurrentMa: 5000 }
  }),
  "servo-standard": component({
    id: "servo-standard",
    name: "Standard hobby servo",
    category: "Actuator",
    dimensions: [52, 28],
    color: "#24446f",
    terminals: [
      terminal("signal", "Signal", TERMINAL_KINDS.SIGNAL, 26, -8, {
        capabilities: ["input"],
        servoPulse: true,
        voltageDomainId: "logic",
        signalTypes: ["servo-pulse"],
        logicMinimumV: 3,
        logicMaximumV: 5,
        electricalRole: "signal-input",
        connectorId: "servo-lead",
        recommendedWireColor: "orange"
      }),
      terminal("vplus", "+V", TERMINAL_KINDS.POWER, 26, 0, {
        voltage: 6,
        electricalRole: "power-input",
        voltageDomainId: "actuator",
        connectorId: "servo-lead",
        recommendedWireColor: "red",
        recommendedGaugeAwg: 22
      }),
      terminal("gnd", "GND", TERMINAL_KINDS.GROUND, 26, 8, {
        voltageDomainId: "ground",
        connectorId: "servo-lead",
        recommendedWireColor: "brown",
        recommendedGaugeAwg: 22
      })
    ],
    engineering: {
      voltageDomains: [
        { id: "actuator", role: "input", minimumV: 4.8, nominalV: 6, maximumV: 6 },
        { id: "logic", role: "input", minimumV: 3, nominalV: 5, maximumV: 5.5 }
      ],
      currentMa: { idle: null, typical: 800, peak: 1500, stall: null },
      polarity: "required",
      connectors: [{ id: "servo-lead", family: "rc-servo-jr", pinPitchMm: 2.54, keyed: false, terminalIds: ["signal", "vplus", "gnd"] }],
      protection: { currentLimiting: "external", decouplingRecommendation: "Add local bulk capacitance near grouped servos." },
      wiring: { recommendedColorsByRole: { "signal-input": "orange", "power-input": "red", ground: "brown" }, recommendedGaugeAwg: 22, notes: "Confirm actual servo stall current before physical bring-up." },
      robotics: { role: "actuator.servo", interface: "servo-pulse" }
    },
    sim: { role: "servo", signalTerminal: "signal", powerTerminal: "vplus", groundTerminal: "gnd", loadCurrentMa: 800 }
  }),
  "led-red": component({
    id: "led-red",
    name: "Red LED",
    category: "Output",
    dimensions: [18, 18],
    color: "#d63a3a",
    terminals: [
      terminal("anode", "Anode", TERMINAL_KINDS.SIGNAL, -6, 0, {
        electricalRole: "power-input",
        voltageDomainId: "logic",
        connectorId: "led-legs",
        recommendedWireColor: "red"
      }),
      terminal("cathode", "Cathode", TERMINAL_KINDS.GROUND, 6, 0, {
        voltageDomainId: "ground",
        connectorId: "led-legs",
        recommendedWireColor: "black"
      })
    ],
    engineering: {
      voltageDomains: [{ id: "logic", role: "input", minimumV: 1.8, nominalV: 2, maximumV: 2.4 }],
      currentMa: { idle: 0, typical: 10, peak: 20, stall: null },
      polarity: "required",
      connectors: [{ id: "led-legs", family: "through-hole-legs", pinPitchMm: 2.54, keyed: false, terminalIds: ["anode", "cathode"] }],
      protection: { currentLimiting: "external" },
      robotics: { role: "output.indicator", interface: "digital" }
    },
    sim: { role: "led", outputTerminal: "anode", returnTerminal: "cathode", nominalVoltage: 2 }
  }),
  "resistor-220": component({
    id: "resistor-220",
    name: "220 ohm resistor",
    category: "Passive",
    dimensions: [30, 10],
    color: "#c49a55",
    terminals: [
      terminal("a", "A", TERMINAL_KINDS.PASSIVE, -14, 0, { electricalRole: "passive", connectorId: "resistor-leads" }),
      terminal("b", "B", TERMINAL_KINDS.PASSIVE, 14, 0, { electricalRole: "passive", connectorId: "resistor-leads" })
    ],
    internalBuses: [{ id: "resistance", terminalIds: ["a", "b"], passive: true, resistanceOhm: 220 }],
    engineering: {
      currentMa: { idle: 0, typical: null, peak: null, stall: null },
      connectors: [{ id: "resistor-leads", family: "through-hole-legs", pinPitchMm: 2.54, keyed: false, terminalIds: ["a", "b"] }],
      protection: { currentLimiting: "integrated" },
      robotics: { role: "passive", interface: "passive" }
    },
    sim: { role: "resistor", resistanceOhm: 220 }
  }),
  "capacitor-electrolytic-470uf": component({
    id: "capacitor-electrolytic-470uf",
    name: "470 uF electrolytic capacitor",
    category: "Passive",
    dimensions: [24, 22],
    color: "#334155",
    terminals: [
      terminal("pos", "+", TERMINAL_KINDS.PASSIVE, 0, 12, {
        electricalRole: "power-input",
        voltageDomainId: "actuator",
        connectorId: "capacitor-legs",
        recommendedWireColor: "red",
        notes: "Positive capacitor leg"
      }),
      terminal("neg", "-", TERMINAL_KINDS.PASSIVE, 0, 17, {
        electricalRole: "ground",
        voltageDomainId: "ground",
        connectorId: "capacitor-legs",
        recommendedWireColor: "black",
        notes: "Negative capacitor leg"
      })
    ],
    engineering: {
      voltageDomains: [{ id: "actuator", role: "input", minimumV: 0, nominalV: 6, maximumV: null }],
      currentMa: { idle: 0, typical: 0, peak: null, stall: null },
      polarity: "required",
      connectors: [{ id: "capacitor-legs", family: "through-hole-legs", pinPitchMm: 2.54, keyed: false, terminalIds: ["pos", "neg"] }],
      protection: { decouplingRecommendation: "Place near the actuator power rail with correct polarity." },
      robotics: { role: "passive", interface: "passive" }
    },
    sim: { role: "capacitor", capacitanceUf: 470, polarized: true }
  }),
  "button-tactile": component({
    id: "button-tactile",
    name: "Tactile button",
    category: "Input",
    dimensions: [24, 20],
    color: "#38bdf8",
    terminals: [
      terminal("sense", "Sense", TERMINAL_KINDS.SIGNAL, -10, 0, {
        capabilities: ["output"],
        voltageDomainId: "logic",
        signalTypes: ["digital"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "signal-output",
        connectorId: "button-pins"
      }),
      terminal("sense2", "Sense 2", TERMINAL_KINDS.SIGNAL, 10, 0, {
        capabilities: ["output"],
        voltageDomainId: "logic",
        signalTypes: ["digital"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "signal-output",
        connectorId: "button-pins"
      }),
      terminal("return", "Return", TERMINAL_KINDS.GROUND, 10, 0, {
        voltageDomainId: "ground",
        connectorId: "button-pins",
        recommendedWireColor: "black"
      }),
      terminal("return2", "Return 2", TERMINAL_KINDS.GROUND, -10, 0, {
        voltageDomainId: "ground",
        connectorId: "button-pins",
        recommendedWireColor: "black"
      })
    ],
    internalBuses: [
      { id: "button_sense_side", terminalIds: ["sense", "sense2"] },
      { id: "button_return_side", terminalIds: ["return", "return2"] }
    ],
    engineering: {
      voltageDomains: [{ id: "logic", role: "bidirectional", minimumV: 0, nominalV: 5, maximumV: 5 }],
      connectors: [{ id: "button-pins", family: "tactile-switch", pinPitchMm: 2.54, keyed: false, terminalIds: ["sense", "sense2", "return", "return2"] }],
      robotics: { role: "sensor.digital", interface: "digital" }
    },
    sim: { role: "button", inputTerminal: "sense", returnTerminal: "return" }
  }),
  "ultrasonic-hcsr04": component({
    id: "ultrasonic-hcsr04",
    name: "HC-SR04 ultrasonic sensor",
    category: "Sensor",
    dimensions: [45, 24],
    color: "#2f9e44",
    terminals: [
      terminal("VCC", "VCC", TERMINAL_KINDS.POWER, -18, 13, {
        voltage: 5,
        electricalRole: "power-input",
        voltageDomainId: "sensor",
        connectorId: "hcsr04-header",
        recommendedWireColor: "red"
      }),
      terminal("TRIG", "TRIG", TERMINAL_KINDS.SIGNAL, -6, 13, {
        capabilities: ["input"],
        voltageDomainId: "logic",
        signalTypes: ["digital"],
        logicMinimumV: 3,
        logicMaximumV: 5,
        electricalRole: "signal-input",
        connectorId: "hcsr04-header",
        recommendedWireColor: "yellow"
      }),
      terminal("ECHO", "ECHO", TERMINAL_KINDS.SIGNAL, 6, 13, {
        capabilities: ["output"],
        voltageDomainId: "logic",
        signalTypes: ["digital"],
        logicMinimumV: 0,
        logicMaximumV: 5,
        electricalRole: "signal-output",
        connectorId: "hcsr04-header",
        recommendedWireColor: "green"
      }),
      terminal("GND", "GND", TERMINAL_KINDS.GROUND, 18, 13, {
        voltageDomainId: "ground",
        connectorId: "hcsr04-header",
        recommendedWireColor: "black"
      })
    ],
    engineering: {
      voltageDomains: [
        { id: "sensor", role: "input", minimumV: 4.5, nominalV: 5, maximumV: 5.5 },
        { id: "logic", role: "bidirectional", minimumV: 3, nominalV: 5, maximumV: 5 }
      ],
      currentMa: { idle: 2, typical: 15, peak: 30, stall: null },
      connectors: [{ id: "hcsr04-header", family: "single-row-header", pinPitchMm: 2.54, keyed: false, terminalIds: ["VCC", "TRIG", "ECHO", "GND"] }],
      protection: { levelShifting: "required" },
      robotics: { role: "sensor.distance", interface: "digital" },
      requiredConnections: [
        { terminalId: "VCC", role: "power-input" },
        { terminalId: "GND", role: "common-ground" },
        { terminalId: "TRIG", role: "controller-output" },
        { terminalId: "ECHO", role: "controller-input" }
      ]
    },
    sim: { role: "sensor", voltage: 5 }
  }),
  "driver-l298n": component({
    id: "driver-l298n",
    name: "L298N motor driver",
    category: "Driver",
    dimensions: [58, 42],
    color: "#8c2f39",
    terminals: [
      terminal("VMOTOR", "VMOT", TERMINAL_KINDS.POWER, -24, -16, {
        voltage: 6,
        electricalRole: "power-input",
        voltageDomainId: "motor",
        connectorId: "l298n-power",
        recommendedWireColor: "red",
        recommendedGaugeAwg: 20
      }),
      terminal("GND", "GND", TERMINAL_KINDS.GROUND, -24, -6, {
        voltageDomainId: "ground",
        connectorId: "l298n-power",
        recommendedWireColor: "black",
        recommendedGaugeAwg: 20
      }),
      terminal("IN1", "IN1", TERMINAL_KINDS.SIGNAL, -24, 8, {
        capabilities: ["input"],
        voltageDomainId: "logic",
        signalTypes: ["digital", "pwm-direction"],
        logicMinimumV: 3,
        logicMaximumV: 5,
        electricalRole: "signal-input",
        connectorId: "l298n-logic"
      }),
      terminal("IN2", "IN2", TERMINAL_KINDS.SIGNAL, -24, 16, {
        capabilities: ["input"],
        voltageDomainId: "logic",
        signalTypes: ["digital", "pwm-direction"],
        logicMinimumV: 3,
        logicMaximumV: 5,
        electricalRole: "signal-input",
        connectorId: "l298n-logic"
      }),
      terminal("OUT1", "OUT1", TERMINAL_KINDS.LOAD, 24, -8, {
        electricalRole: "load-output",
        voltageDomainId: "motor",
        connectorId: "l298n-motor",
        recommendedGaugeAwg: 20
      }),
      terminal("OUT2", "OUT2", TERMINAL_KINDS.LOAD, 24, 8, {
        electricalRole: "load-output",
        voltageDomainId: "motor",
        connectorId: "l298n-motor",
        recommendedGaugeAwg: 20
      })
    ],
    engineering: {
      voltageDomains: [
        { id: "motor", role: "input", minimumV: 5, nominalV: 6, maximumV: 12 },
        { id: "logic", role: "input", minimumV: 3, nominalV: 5, maximumV: 5.5 }
      ],
      currentMa: { idle: 0, typical: null, peak: 2000, stall: null },
      connectors: [
        { id: "l298n-power", family: "screw-terminal", pinPitchMm: 5.08, keyed: true, terminalIds: ["VMOTOR", "GND"] },
        { id: "l298n-logic", family: "single-row-header", pinPitchMm: 2.54, keyed: false, terminalIds: ["IN1", "IN2"] },
        { id: "l298n-motor", family: "screw-terminal", pinPitchMm: 5.08, keyed: true, terminalIds: ["OUT1", "OUT2"] }
      ],
      protection: { inductiveLoad: true, flyback: "integrated", currentLimiting: "unknown" },
      wiring: { recommendedGaugeAwg: 20, notes: "Use a driver between controller terminals and bare motors." },
      robotics: { role: "driver.hbridge", interface: "pwm-direction" },
      requiredConnections: [
        { terminalId: "VMOTOR", role: "external-power" },
        { terminalId: "GND", role: "common-ground" },
        { terminalId: "IN1", role: "controller-output" },
        { terminalId: "IN2", role: "controller-output" },
        { terminalId: "OUT1", role: "actuator-output" },
        { terminalId: "OUT2", role: "actuator-output" }
      ]
    },
    sim: { role: "motorDriver" }
  }),
  "motor-dc": component({
    id: "motor-dc",
    name: "DC motor",
    category: "Actuator",
    dimensions: [42, 28],
    color: "#64748b",
    terminals: [
      terminal("a", "A", TERMINAL_KINDS.LOAD, -18, 0, {
        electricalRole: "power-input",
        voltageDomainId: "motor",
        connectorId: "motor-leads",
        recommendedGaugeAwg: 20
      }),
      terminal("b", "B", TERMINAL_KINDS.LOAD, 18, 0, {
        electricalRole: "power-input",
        voltageDomainId: "motor",
        connectorId: "motor-leads",
        recommendedGaugeAwg: 20
      })
    ],
    engineering: {
      voltageDomains: [{ id: "motor", role: "input", minimumV: 3, nominalV: 6, maximumV: 12 }],
      currentMa: { idle: null, typical: 600, peak: 1200, stall: null },
      polarity: "reversible",
      connectors: [{ id: "motor-leads", family: "wire-leads", pinPitchMm: null, keyed: false, terminalIds: ["a", "b"] }],
      protection: { inductiveLoad: true, flyback: "required", currentLimiting: "external" },
      wiring: { recommendedGaugeAwg: 20, notes: "Do not connect a bare motor directly to controller GPIO." },
      robotics: { role: "actuator.dc-motor", interface: "pwm-direction" }
    },
    sim: { role: "dcMotor", loadCurrentMa: 600 }
  }),
  "potentiometer-10k": component({
    id: "potentiometer-10k",
    name: "10 kOhm potentiometer",
    category: "Input",
    color: "#7c6a52",
    terminals: [
      terminal("A", "A", TERMINAL_KINDS.PASSIVE, -5, 15, { connectorId: "pot-lugs", electricalRole: "passive" }),
      terminal("W", "Wiper", TERMINAL_KINDS.SIGNAL, 0, 15, {
        connectorId: "pot-lugs",
        capabilities: ["output"],
        voltageDomainId: "logic",
        signalTypes: ["analog"],
        electricalRole: "signal-output"
      }),
      terminal("B", "B", TERMINAL_KINDS.PASSIVE, 5, 15, { connectorId: "pot-lugs", electricalRole: "passive" })
    ],
    engineering: {
      voltageDomains: [{ id: "logic", role: "bidirectional", minimumV: 0, nominalV: null, maximumV: 5 }],
      connectors: [{ id: "pot-lugs", family: "solder-lug", pinPitchMm: 5.08, keyed: false, terminalIds: ["A", "W", "B"] }],
      robotics: { role: "sensor.analog", interface: "analog" }
    },
    sim: { role: "potentiometer", resistanceOhm: 10000 }
  }),
  "switch-spdt-slide": component({
    id: "switch-spdt-slide",
    name: "SPDT slide switch",
    category: "Input",
    color: "#475569",
    terminals: [
      terminal("A", "A", TERMINAL_KINDS.PASSIVE, -5, 6, { connectorId: "switch-pins", electricalRole: "passive" }),
      terminal("COM", "COM", TERMINAL_KINDS.PASSIVE, 0, 6, { connectorId: "switch-pins", electricalRole: "passive" }),
      terminal("B", "B", TERMINAL_KINDS.PASSIVE, 5, 6, { connectorId: "switch-pins", electricalRole: "passive" })
    ],
    engineering: {
      connectors: [{ id: "switch-pins", family: "spdt-slide-switch", pinPitchMm: 2.54, keyed: false, terminalIds: ["A", "COM", "B"] }],
      robotics: { role: "sensor.digital", interface: "digital" }
    },
    sim: { role: "switch" }
  }),
  ...Object.fromEntries(roboticsComponentDefinitions.map((definition) => [definition.id, component(definition)]))
});

const starterTemplates = Object.freeze([
  {
    id: "arduino_servo_safe",
    name: "Arduino servo safe test",
    description: "One servo, external 6V power, shared ground, and Arduino signal."
  },
  {
    id: "arduino_six_servo_order",
    name: "Arduino six-servo bring-up",
    description: "Six servos staged in a safe numbered test order with external power."
  },
  {
    id: "esp32_led_button",
    name: "ESP32 LED and button",
    description: "Starter signal loop with resistor-limited LED and grounded button."
  },
  {
    id: "motor_driver_dc",
    name: "Motor driver and DC motor",
    description: "Controller signals, external motor power, and driver outputs."
  }
]);

const customComponents = new Map();
const missingCustomComponents = new Map();

function customCatalogComponent(definitionInput) {
  const definition = normalizeCircuitCustomComponentDefinition(definitionInput);
  const terminals = definition.terminals.map((item) => terminal(
    item.id,
    item.label,
    item.kind,
    item.positionMm[0],
    item.positionMm[1],
    {
      connectorInterface: item.connectorInterface,
      attachmentCapacity: item.attachmentCapacity,
      sourceMappingId: item.sourceMappingId,
      visibleBoundsMm: item.visibleBoundsMm,
      physicalLabel: item.physicalLabel,
      electricalRole: item.electricalRole ?? undefined,
      voltageDomainId: item.voltageDomainId ?? undefined,
      notes: item.notes
    }
  ));
  return component({
    id: definition.id,
    name: definition.name,
    category: definition.category,
    dimensions: definition.physical.physicalSizeMm,
    color: "#52616b",
    terminals,
    internalBuses: definition.internalBuses,
    engineering: {
      specificationBasis: "local-custom",
      connectors: [{
        id: "custom-connectors",
        family: "local-fritzing-import",
        pinPitchMm: null,
        keyed: false,
        terminalIds: terminals.map((item) => item.id)
      }],
      robotics: { role: "passive", interface: "passive" }
    },
    sim: { role: "custom" },
    view: {
      customSvg: definition.visual.sanitizedSvg,
      customViewBox: definition.visual.viewBox,
      localOnly: true
    },
    custom: {
      localOnly: true,
      missing: false,
      licenseSpdx: definition.licenseAcceptance.licenseSpdx,
      sourceProject: definition.provenance.sourceProject
    }
  });
}

function missingCustomComponent(typeId) {
  const id = String(typeId ?? "");
  if (!missingCustomComponents.has(id)) {
    missingCustomComponents.set(id, component({
      id,
      name: "Missing custom component",
      category: "Custom",
      dimensions: [46, 26],
      color: "#6b7280",
      terminals: [],
      engineering: {
        specificationBasis: "missing-custom-library",
        robotics: { role: "passive", interface: "unknown" }
      },
      sim: { role: "custom" },
      hidden: true,
      custom: {
        localOnly: true,
        missing: true
      }
    }));
  }
  return missingCustomComponents.get(id);
}

export function clearCustomCircuitComponents() {
  customComponents.clear();
  missingCustomComponents.clear();
}

export function registerCustomCircuitComponents(definitions = []) {
  const normalizedDefinitions = definitions.map((definition) => normalizeCircuitCustomComponentDefinition(definition));
  for (const definition of normalizedDefinitions) {
    customComponents.set(definition.id, customCatalogComponent(definition));
    missingCustomComponents.delete(definition.id);
  }
  return normalizedDefinitions.map((definition) => customComponents.get(definition.id));
}

export function listRegisteredCustomCircuitComponents() {
  return [...customComponents.values()];
}

function componentById(id) {
  if (components[id]) return components[id];
  if (customComponents.has(id)) return customComponents.get(id);
  if (String(id ?? "").startsWith(CIRCUIT_CUSTOM_TYPE_PREFIX)) return missingCustomComponent(id);
  return null;
}

function visibleComponents(options = {}) {
  return [
    ...Object.values(components),
    ...customComponents.values()
  ].filter((item) => options.includeHidden || !item.hidden);
}

export const catalog = Object.freeze({
  getComponent: componentById,
  listComponents: visibleComponents,
  listControllers: () => visibleComponents().filter((item) => item.sim.role === "controller"),
  listStarterComponents: () => visibleComponents().filter((item) => item.category !== "Controller")
});

export { starterTemplates };

export function terminalById(componentDef, terminalId) {
  return componentDef?.terminals?.find((item) => item.id === terminalId)
    ?? componentDef?.terminals?.find((item) => item.label === terminalId)
    ?? null;
}

export function componentColor(componentDef) {
  return componentDef?.color ?? "#64748b";
}
