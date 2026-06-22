const KINDS = Object.freeze({
  SIGNAL: "signal",
  POWER: "power",
  GROUND: "ground",
  PASSIVE: "passive",
  LOAD: "load"
});

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
  if (kind === KINDS.POWER) return Number.isFinite(Number(options.voltage)) ? "power-source" : "power-input";
  if (kind === KINDS.GROUND) return "ground";
  if (kind === KINDS.LOAD) return "load-output";
  if (kind === KINDS.PASSIVE) return "passive";
  const flags = capabilityFlags(options);
  if (flags.digitalInput && flags.digitalOutput) return "bidirectional";
  if (flags.digitalInput) return "signal-input";
  if (flags.digitalOutput) return "signal-output";
  return "bidirectional";
}

function terminal(id, label, kind, options = {}) {
  return Object.freeze({
    id,
    label,
    kind,
    position: [0, 0],
    voltage: options.voltage ?? null,
    capabilities: capabilityFlags(options),
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

function signal(id, options = {}) {
  return terminal(id, options.label ?? id, KINDS.SIGNAL, {
    capabilities: options.capabilities ?? ["input", "output"],
    voltageDomainId: options.voltageDomainId ?? "logic",
    signalTypes: options.signalTypes ?? ["digital"],
    logicMinimumV: options.logicMinimumV ?? 0,
    logicMaximumV: options.logicMaximumV ?? 5,
    electricalRole: options.electricalRole,
    inputOnly: options.inputOnly,
    pwm: options.pwm,
    servoPulse: options.servoPulse,
    adc: options.adc,
    i2cSda: options.i2cSda,
    i2cScl: options.i2cScl,
    uartTx: options.uartTx,
    uartRx: options.uartRx,
    step: options.step,
    direction: options.direction,
    enable: options.enable,
    connectorId: options.connectorId,
    recommendedWireColor: options.recommendedWireColor,
    maxCurrentMa: options.maxCurrentMa ?? 20,
    reserved: options.reserved,
    reservedReason: options.reservedReason,
    strapping: options.strapping
  });
}

function powerInput(id, label, domainId, options = {}) {
  return terminal(id, label ?? id, KINDS.POWER, {
    voltage: options.voltage,
    electricalRole: "power-input",
    voltageDomainId: domainId,
    connectorId: options.connectorId,
    recommendedWireColor: options.recommendedWireColor ?? "red",
    recommendedGaugeAwg: options.recommendedGaugeAwg,
    maxCurrentMa: options.maxCurrentMa
  });
}

function powerSource(id, label, domainId, options = {}) {
  return terminal(id, label ?? id, KINDS.POWER, {
    voltage: options.voltage,
    electricalRole: "power-source",
    voltageDomainId: domainId,
    connectorId: options.connectorId,
    recommendedWireColor: options.recommendedWireColor ?? "red",
    recommendedGaugeAwg: options.recommendedGaugeAwg,
    maxCurrentMa: options.maxCurrentMa
  });
}

function ground(id = "GND", options = {}) {
  return terminal(id, options.label ?? "GND", KINDS.GROUND, {
    voltageDomainId: "ground",
    connectorId: options.connectorId,
    recommendedWireColor: options.recommendedWireColor ?? "black",
    recommendedGaugeAwg: options.recommendedGaugeAwg
  });
}

function passive(id, label, options = {}) {
  return terminal(id, label ?? id, KINDS.PASSIVE, {
    electricalRole: options.electricalRole ?? "passive",
    voltageDomainId: options.voltageDomainId ?? null,
    connectorId: options.connectorId,
    recommendedWireColor: options.recommendedWireColor,
    recommendedGaugeAwg: options.recommendedGaugeAwg
  });
}

function load(id, label, domainId, options = {}) {
  return terminal(id, label ?? id, KINDS.LOAD, {
    electricalRole: options.electricalRole ?? "load-output",
    voltageDomainId: domainId,
    connectorId: options.connectorId,
    recommendedGaugeAwg: options.recommendedGaugeAwg
  });
}

function voltageDomain(id, role, minimumV, nominalV, maximumV) {
  return { id, role, minimumV, nominalV, maximumV };
}

function connector(id, family, terminalIds, options = {}) {
  return { id, family, pinPitchMm: options.pinPitchMm ?? 2.54, keyed: Boolean(options.keyed), terminalIds };
}

function required(terminalId, role) {
  return { terminalId, role };
}

function nanoTerminals() {
  const terminals = [];
  for (let index = 0; index <= 13; index += 1) {
    terminals.push(signal(`D${index}`, {
      pwm: [3, 5, 6, 9, 10, 11].includes(index),
      servoPulse: index >= 2,
      reserved: index < 2,
      reservedReason: index < 2 ? "Default USB serial/programming terminal." : ""
    }));
  }
  for (let index = 0; index <= 7; index += 1) {
    terminals.push(signal(`A${index}`, {
      capabilities: ["input"],
      adc: true,
      signalTypes: ["analog", "digital"],
      electricalRole: "bidirectional"
    }));
  }
  return [
    ...terminals,
    powerSource("5V", "5V", "logic", { voltage: 5, maxCurrentMa: 500 }),
    powerSource("3V3", "3V3", "logic3v3", { voltage: 3.3, maxCurrentMa: 50, recommendedWireColor: "orange" }),
    powerInput("VIN", "VIN", "raw", { voltage: 7 }),
    signal("AREF", { capabilities: ["input"], inputOnly: true, signalTypes: ["analog-reference"], electricalRole: "signal-input" }),
    signal("RST", { label: "RST", capabilities: ["input"], inputOnly: true, signalTypes: ["reset"], electricalRole: "signal-input" }),
    signal("RST2", { label: "RST", capabilities: ["input"], inputOnly: true, signalTypes: ["reset"], electricalRole: "signal-input" }),
    ground("GND"),
    ground("GND2", { label: "GND" })
  ];
}

function picoTerminals() {
  const signals = Array.from({ length: 29 }, (_, index) => `GP${index}`).map((id) => signal(id, {
    logicMaximumV: 3.3,
    voltageDomainId: "logic",
    pwm: true,
    adc: ["GP26", "GP27", "GP28"].includes(id),
    i2cSda: ["GP0", "GP4", "GP8", "GP12", "GP16", "GP20"].includes(id),
    i2cScl: ["GP1", "GP5", "GP9", "GP13", "GP17", "GP21"].includes(id),
    servoPulse: true,
    maxCurrentMa: 12
  }));
  return [
    ...signals,
    powerInput("VBUS", "VBUS", "usb", { voltage: 5, maxCurrentMa: 500 }),
    powerInput("VSYS", "VSYS", "raw", { voltage: 5, maxCurrentMa: 500 }),
    powerSource("3V3", "3V3", "logic", { voltage: 3.3, maxCurrentMa: 300, recommendedWireColor: "orange" }),
    signal("3V3_EN", { label: "3V3 EN", capabilities: ["input"], logicMaximumV: 3.3, inputOnly: true }),
    signal("ADC_VREF", { label: "ADC VREF", capabilities: ["input"], logicMaximumV: 3.3, inputOnly: true, signalTypes: ["analog-reference"] }),
    signal("RUN", { capabilities: ["input"], logicMaximumV: 3.3, inputOnly: true, signalTypes: ["reset"] }),
    ...["GND", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7", "GND8"].map((id) => ground(id, { label: "GND" }))
  ];
}

function servoChannelTerminals(count = 16) {
  return Array.from({ length: count }, (_, index) => [
    signal(`ch${index}_signal`, { label: `CH${index} S`, capabilities: ["output"], signalTypes: ["servo-pulse"], electricalRole: "signal-output", connectorId: "servo-bank", servoPulse: true }),
    powerSource(`ch${index}_vplus`, `CH${index} +V`, "actuator", { voltage: 6, connectorId: "servo-bank", maxCurrentMa: 1000 }),
    ground(`ch${index}_gnd`, { label: `CH${index} GND`, connectorId: "servo-bank" })
  ]).flat();
}

const servoPowerChannels = ["s1", "s2", "s3", "s4"].flatMap((id, index) => [
  signal(`${id}_signal`, { label: `S${index + 1} SIG`, capabilities: ["input", "output"], signalTypes: ["servo-pulse"], connectorId: "servo-power-bank", servoPulse: true }),
  powerSource(`${id}_vplus`, `S${index + 1} +V`, "actuator", { voltage: 6, connectorId: "servo-power-bank", maxCurrentMa: 1500 }),
  ground(`${id}_gnd`, { label: `S${index + 1} GND`, connectorId: "servo-power-bank" })
]);

export const roboticsComponentDefinitions = Object.freeze([
  {
    id: "controller-arduino-nano",
    name: "Arduino Nano",
    category: "Controller",
    color: "#1f8a83",
    terminals: nanoTerminals(),
    internalBuses: [
      { id: "ground_common", terminalIds: ["GND", "GND2"] }
    ],
    engineering: {
      voltageDomains: [
        voltageDomain("logic", "source", 4.75, 5, 5.25),
        voltageDomain("logic3v3", "source", 3.1, 3.3, 3.5),
        voltageDomain("raw", "input", 7, 9, 12)
      ],
      connectors: [
        connector("nano-headers", "arduino-nano-dual-row-header", ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN", "D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND2", "RST2", "D0", "D1"])
      ],
      protection: { levelShifting: "not-required", currentLimiting: "unknown" },
      robotics: { role: "controller", interface: "digital" }
    },
    sim: { role: "controller", firmware: "arduino", family: "avr" }
  },
  {
    id: "controller-raspberry-pi-pico",
    name: "Raspberry Pi Pico",
    category: "Controller",
    color: "#0f6b7a",
    terminals: picoTerminals(),
    internalBuses: [{ id: "ground_common", terminalIds: ["GND", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7", "GND8"] }],
    engineering: {
      voltageDomains: [
        voltageDomain("logic", "source", 3.1, 3.3, 3.5),
        voltageDomain("usb", "input", 4.75, 5, 5.25),
        voltageDomain("raw", "input", 1.8, 5, 5.5)
      ],
      connectors: [connector("pico-headers", "pico-dual-row-header", ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND2", "GP6", "GP7", "GP8", "GP9", "GND3", "GP10", "GP11", "GP12", "GP13", "GND4", "GP14", "GP15", "VBUS", "VSYS", "GND8", "3V3_EN", "3V3", "ADC_VREF", "GP28", "GND7", "GP27", "GP26", "RUN", "GP22", "GND6", "GP21", "GP20", "GP19", "GP18", "GND5", "GP17", "GP16"])],
      protection: { levelShifting: "required", currentLimiting: "unknown" },
      robotics: { role: "controller", interface: "digital" }
    },
    sim: { role: "controller", firmware: "unsupported", family: "rp2040" }
  },
  {
    id: "driver-pca9685-servo",
    name: "PCA9685 16-channel servo driver",
    category: "Driver",
    color: "#1d4ed8",
    terminals: [
      ground("GND", { connectorId: "control-header" }),
      signal("OE", { capabilities: ["input"], inputOnly: true, connectorId: "control-header" }),
      signal("SCL", { capabilities: ["input"], i2cScl: true, shareableBus: true, signalTypes: ["i2c"], connectorId: "control-header" }),
      signal("SDA", { capabilities: ["input", "output"], i2cSda: true, shareableBus: true, signalTypes: ["i2c"], connectorId: "control-header" }),
      powerInput("VCC", "VCC", "logic", { voltage: 5, connectorId: "control-header" }),
      powerInput("VPLUS", "V+", "actuator", { voltage: 6, connectorId: "control-header", maxCurrentMa: 10000 }),
      ...servoChannelTerminals(16)
    ],
    engineering: {
      voltageDomains: [voltageDomain("logic", "input", 3, 5, 5.5), voltageDomain("actuator", "input", 4.8, 6, 6)],
      currentMa: { idle: 10, typical: 25, peak: null, stall: null },
      connectors: [
        connector("control-header", "single-row-header", ["GND", "OE", "SCL", "SDA", "VCC", "VPLUS"]),
        connector("servo-bank", "rc-servo-jr-bank", servoChannelTerminals(16).map((item) => item.id))
      ],
      protection: { levelShifting: "integrated", currentLimiting: "external", decouplingRecommendation: "Use a bulk capacitor near the servo V+ terminal." },
      robotics: { role: "driver.servo-pwm", interface: "i2c-servo-pulse" },
      requiredConnections: [required("VCC", "power-input"), required("GND", "common-ground"), required("SCL", "controller-output"), required("SDA", "controller-output"), required("VPLUS", "external-power")]
    },
    sim: { role: "pwmDriver" }
  },
  {
    id: "regulator-lm2596-buck",
    name: "LM2596 buck converter",
    category: "Power",
    color: "#2563eb",
    terminals: [
      powerInput("VIN_PLUS", "VIN+", "input", { voltage: 12, connectorId: "input" }),
      ground("VIN_MINUS", { label: "VIN-", connectorId: "input" }),
      powerSource("OUT_PLUS", "OUT+", "regulated", { voltage: 5, maxCurrentMa: 2000, connectorId: "output" }),
      ground("OUT_MINUS", { label: "OUT-", connectorId: "output" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("input", "input", 4, 12, 35), voltageDomain("regulated", "source", 1.25, 5, 30)],
      currentMa: { idle: 5, typical: 1000, peak: 2000, stall: null },
      connectors: [connector("input", "screw-terminal", ["VIN_PLUS", "VIN_MINUS"], { pinPitchMm: 5.08, keyed: true }), connector("output", "screw-terminal", ["OUT_PLUS", "OUT_MINUS"], { pinPitchMm: 5.08, keyed: true })],
      protection: { currentLimiting: "unknown", fuseRecommendation: "Confirm converter setting with a meter before connecting logic." },
      robotics: { role: "power-regulator", interface: "passive" },
      requiredConnections: [required("VIN_PLUS", "external-power"), required("VIN_MINUS", "common-ground")]
    },
    sim: { role: "regulator" }
  },
  {
    id: "battery-lipo-2s-jst",
    name: "2S LiPo battery with JST lead",
    category: "Power",
    color: "#334155",
    terminals: [
      powerSource("VPLUS", "+V", "battery", { voltage: 7.4, maxCurrentMa: 5000, connectorId: "jst-output", recommendedGaugeAwg: 20 }),
      ground("GND", { connectorId: "jst-output", recommendedGaugeAwg: 20 })
    ],
    engineering: {
      voltageDomains: [voltageDomain("battery", "source", 6, 7.4, 8.4)],
      currentMa: { idle: 0, typical: 5000, peak: 5000, stall: 5000 },
      connectors: [connector("jst-output", "jst-power-lead", ["VPLUS", "GND"], { pinPitchMm: null, keyed: true })],
      protection: { currentLimiting: "external", fuseRecommendation: "Use a fuse or protected distribution path for physical bring-up." },
      robotics: { role: "power-source", interface: "passive" }
    },
    sim: { role: "externalSupply", voltage: 7.4, maxCurrentMa: 5000 }
  },
  {
    id: "distribution-servo-power",
    name: "4-port servo power distribution board",
    category: "Power",
    color: "#475569",
    terminals: [
      powerInput("VIN", "VIN", "actuator", { voltage: 6, maxCurrentMa: 6000, connectorId: "power-input", recommendedGaugeAwg: 20 }),
      ground("GND", { connectorId: "power-input", recommendedGaugeAwg: 20 }),
      ...servoPowerChannels
    ],
    internalBuses: [
      { id: "servo_positive_bus", terminalIds: ["VIN", "s1_vplus", "s2_vplus", "s3_vplus", "s4_vplus"] },
      { id: "servo_ground_bus", terminalIds: ["GND", "s1_gnd", "s2_gnd", "s3_gnd", "s4_gnd"] }
    ],
    engineering: {
      voltageDomains: [
        voltageDomain("actuator", "input", 4.8, 6, 6),
        voltageDomain("logic", "bidirectional", 0, 5, 5)
      ],
      currentMa: { idle: 0, typical: 3000, peak: 6000, stall: null },
      connectors: [connector("power-input", "screw-terminal", ["VIN", "GND"], { pinPitchMm: 5.08, keyed: true }), connector("servo-power-bank", "rc-servo-jr-bank", servoPowerChannels.map((item) => item.id))],
      protection: { currentLimiting: "external", fuseRecommendation: "Fuse the input feed for expected servo current." },
      robotics: { role: "power-distribution", interface: "servo-power" },
      requiredConnections: [required("VIN", "external-power"), required("GND", "common-ground")]
    },
    sim: { role: "powerDistribution" }
  },
  {
    id: "level-shifter-4ch",
    name: "4-channel logic level shifter",
    category: "Interface",
    color: "#7c3aed",
    terminals: [
      powerInput("HV", "HV", "high", { voltage: 5, connectorId: "high-side" }),
      powerInput("LV", "LV", "low", { voltage: 3.3, connectorId: "low-side" }),
      ground("GND_HV", { label: "GND", connectorId: "high-side" }),
      ground("GND_LV", { label: "GND", connectorId: "low-side" }),
      ...[1, 2, 3, 4].flatMap((index) => [
        signal(`HV${index}`, { label: `HV${index}`, connectorId: "high-side", voltageDomainId: "high", logicMaximumV: 5 }),
        signal(`LV${index}`, { label: `LV${index}`, connectorId: "low-side", voltageDomainId: "low", logicMaximumV: 3.3 })
      ])
    ],
    internalBuses: [{ id: "ground_common", terminalIds: ["GND_HV", "GND_LV"] }],
    engineering: {
      voltageDomains: [voltageDomain("high", "input", 4.5, 5, 5.5), voltageDomain("low", "input", 3, 3.3, 3.6)],
      connectors: [connector("high-side", "single-row-header", ["HV", "HV1", "HV2", "HV3", "HV4", "GND_HV"]), connector("low-side", "single-row-header", ["LV", "LV1", "LV2", "LV3", "LV4", "GND_LV"])],
      protection: { levelShifting: "integrated", currentLimiting: "external" },
      robotics: { role: "interface.level-shifter", interface: "digital" },
      requiredConnections: [required("HV", "power-input"), required("LV", "power-input"), required("GND_HV", "common-ground")]
    },
    sim: { role: "levelShifter" }
  },
  {
    id: "driver-tb6612fng",
    name: "TB6612FNG dual motor driver",
    category: "Driver",
    color: "#b91c1c",
    terminals: [
      powerInput("VM", "VM", "motor", { voltage: 6, connectorId: "driver-headers", recommendedGaugeAwg: 22 }),
      powerInput("VCC", "VCC", "logic", { voltage: 5, connectorId: "driver-headers" }),
      ground("GND", { connectorId: "driver-headers" }),
      ...["STBY", "AIN1", "AIN2", "PWMA", "BIN1", "BIN2", "PWMB"].map((id) => signal(id, { capabilities: ["input"], inputOnly: true, connectorId: "driver-headers", signalTypes: ["digital", "pwm-direction"], pwm: id.startsWith("PWM") })),
      ...["A01", "A02", "B01", "B02"].map((id) => load(id, id, "motor", { connectorId: "driver-headers", recommendedGaugeAwg: 22 }))
    ],
    engineering: {
      voltageDomains: [voltageDomain("motor", "input", 2.5, 6, 13.5), voltageDomain("logic", "input", 2.7, 5, 5.5)],
      currentMa: { idle: 0, typical: null, peak: 1200, stall: null },
      connectors: [connector("driver-headers", "dual-row-header", ["VM", "VCC", "GND", "STBY", "AIN1", "AIN2", "PWMA", "BIN1", "BIN2", "PWMB", "A01", "A02", "B01", "B02"])],
      protection: { inductiveLoad: true, flyback: "integrated", currentLimiting: "unknown" },
      robotics: { role: "driver.hbridge", interface: "pwm-direction" },
      requiredConnections: [required("VM", "external-power"), required("GND", "common-ground"), required("AIN1", "controller-output"), required("AIN2", "controller-output")]
    },
    sim: { role: "motorDriver" }
  },
  {
    id: "driver-a4988-stepper",
    name: "A4988 stepper driver",
    category: "Driver",
    color: "#991b1b",
    terminals: [
      powerInput("VMOT", "VMOT", "motor", { voltage: 12, connectorId: "a4988-headers", recommendedGaugeAwg: 20 }),
      ground("GNDM", { label: "GND", connectorId: "a4988-headers", recommendedGaugeAwg: 20 }),
      powerInput("VDD", "VDD", "logic", { voltage: 5, connectorId: "a4988-headers" }),
      ground("GND", { connectorId: "a4988-headers" }),
      ...["STEP", "DIR", "EN", "MS1", "MS2", "MS3", "RST", "SLP"].map((id) => signal(id, { capabilities: ["input"], inputOnly: true, connectorId: "a4988-headers", signalTypes: ["digital", id === "STEP" ? "step" : id === "DIR" ? "direction" : "enable"], step: id === "STEP", direction: id === "DIR", enable: id === "EN" })),
      ...["1A", "1B", "2A", "2B"].map((id) => load(id, id, "motor", { connectorId: "a4988-headers", recommendedGaugeAwg: 20 }))
    ],
    engineering: {
      voltageDomains: [voltageDomain("motor", "input", 8, 12, 35), voltageDomain("logic", "input", 3, 5, 5.5)],
      currentMa: { idle: 0, typical: null, peak: 1000, stall: null },
      connectors: [connector("a4988-headers", "dual-row-header", ["EN", "MS1", "MS2", "MS3", "RST", "SLP", "STEP", "DIR", "VMOT", "GNDM", "2B", "2A", "1A", "1B", "VDD", "GND"])],
      protection: { inductiveLoad: true, flyback: "integrated", currentLimiting: "integrated", decouplingRecommendation: "Add motor-supply bulk capacitance close to VMOT and GND." },
      robotics: { role: "driver.stepper", interface: "step-direction" },
      requiredConnections: [required("VMOT", "external-power"), required("GNDM", "common-ground"), required("VDD", "power-input"), required("STEP", "controller-output"), required("DIR", "controller-output")]
    },
    sim: { role: "stepperDriver" }
  },
  {
    id: "driver-mosfet-low-side",
    name: "Logic-level MOSFET low-side driver",
    category: "Driver",
    color: "#0f172a",
    terminals: [
      signal("SIG", { capabilities: ["input"], inputOnly: true, connectorId: "logic-header", signalTypes: ["digital", "pwm"], pwm: true }),
      ground("GND", { connectorId: "logic-header" }),
      powerInput("VIN", "LOAD+", "load", { voltage: 6, connectorId: "load-terminal", recommendedGaugeAwg: 22 }),
      load("LOAD", "LOAD-", "load", { connectorId: "load-terminal", recommendedGaugeAwg: 22 })
    ],
    engineering: {
      voltageDomains: [voltageDomain("load", "input", 3, 6, 24), voltageDomain("logic", "input", 3, 5, 5.5)],
      currentMa: { idle: 0, typical: null, peak: 3000, stall: null },
      connectors: [connector("logic-header", "single-row-header", ["SIG", "GND"]), connector("load-terminal", "screw-terminal", ["VIN", "LOAD"], { pinPitchMm: 5.08 })],
      protection: { inductiveLoad: true, flyback: "required", currentLimiting: "external" },
      robotics: { role: "driver.low-side-switch", interface: "digital" },
      requiredConnections: [required("SIG", "controller-output"), required("GND", "common-ground"), required("VIN", "external-power"), required("LOAD", "actuator-output")]
    },
    sim: { role: "lowSideDriver" }
  },
  {
    id: "servo-micro-9g",
    name: "Micro 9g servo",
    category: "Actuator",
    color: "#2563eb",
    terminals: [
      signal("signal", { label: "Signal", capabilities: ["input"], inputOnly: true, servoPulse: true, signalTypes: ["servo-pulse"], electricalRole: "signal-input", connectorId: "servo-lead", recommendedWireColor: "orange" }),
      powerInput("vplus", "+V", "actuator", { voltage: 6, connectorId: "servo-lead", recommendedGaugeAwg: 22 }),
      ground("gnd", { label: "GND", connectorId: "servo-lead", recommendedWireColor: "brown", recommendedGaugeAwg: 22 })
    ],
    engineering: {
      voltageDomains: [voltageDomain("actuator", "input", 4.8, 6, 6), voltageDomain("logic", "input", 3, 5, 5.5)],
      currentMa: { idle: null, typical: 500, peak: 900, stall: null },
      polarity: "required",
      connectors: [connector("servo-lead", "rc-servo-jr", ["signal", "vplus", "gnd"])],
      protection: { currentLimiting: "external", decouplingRecommendation: "Add local bulk capacitance near grouped servos." },
      robotics: { role: "actuator.servo", interface: "servo-pulse" }
    },
    sim: { role: "servo", signalTerminal: "signal", powerTerminal: "vplus", groundTerminal: "gnd", loadCurrentMa: 500 }
  },
  {
    id: "motor-tt-gearmotor",
    name: "TT gearmotor",
    category: "Actuator",
    color: "#f59e0b",
    terminals: [load("a", "A", "motor", { connectorId: "motor-leads", recommendedGaugeAwg: 20 }), load("b", "B", "motor", { connectorId: "motor-leads", recommendedGaugeAwg: 20 })],
    engineering: {
      voltageDomains: [voltageDomain("motor", "input", 3, 6, 9)],
      currentMa: { idle: null, typical: 250, peak: 1000, stall: null },
      polarity: "reversible",
      connectors: [connector("motor-leads", "wire-leads", ["a", "b"], { pinPitchMm: null })],
      protection: { inductiveLoad: true, flyback: "required", currentLimiting: "external" },
      robotics: { role: "actuator.dc-motor", interface: "pwm-direction" }
    },
    sim: { role: "dcMotor", loadCurrentMa: 250 }
  },
  {
    id: "stepper-nema17",
    name: "NEMA17 stepper motor",
    category: "Actuator",
    color: "#475569",
    terminals: ["A1", "A2", "B1", "B2"].map((id) => load(id, id, "motor", { connectorId: "stepper-leads", recommendedGaugeAwg: 20 })),
    engineering: {
      voltageDomains: [voltageDomain("motor", "input", 8, 12, 24)],
      currentMa: { idle: null, typical: 1200, peak: 2000, stall: null },
      polarity: "coil-pairs-required",
      connectors: [connector("stepper-leads", "stepper-coil-leads", ["A1", "A2", "B1", "B2"], { pinPitchMm: null })],
      protection: { inductiveLoad: true, flyback: "required", currentLimiting: "external" },
      robotics: { role: "actuator.stepper", interface: "step-direction" }
    },
    sim: { role: "stepperMotor", loadCurrentMa: 1200 }
  },
  {
    id: "actuator-solenoid-6v",
    name: "6V push-pull solenoid",
    category: "Actuator",
    color: "#64748b",
    terminals: [powerInput("plus", "+", "actuator", { voltage: 6, connectorId: "solenoid-leads", recommendedGaugeAwg: 20 }), ground("minus", { label: "-", connectorId: "solenoid-leads", recommendedGaugeAwg: 20 })],
    engineering: {
      voltageDomains: [voltageDomain("actuator", "input", 5, 6, 6.5)],
      currentMa: { idle: 0, typical: 1000, peak: 2000, stall: null },
      polarity: "required",
      connectors: [connector("solenoid-leads", "pigtail-conductors", ["plus", "minus"], { pinPitchMm: null })],
      protection: { inductiveLoad: true, flyback: "required", currentLimiting: "external" },
      robotics: { role: "actuator.solenoid", interface: "digital" }
    },
    sim: { role: "solenoid", loadCurrentMa: 1000 }
  },
  {
    id: "sensor-line-tcrt5000",
    name: "TCRT5000 line sensor",
    category: "Sensor",
    color: "#111827",
    terminals: [
      powerInput("VCC", "VCC", "sensor", { voltage: 5, connectorId: "sensor-header" }),
      ground("GND", { connectorId: "sensor-header" }),
      signal("DO", { capabilities: ["output"], electricalRole: "signal-output", connectorId: "sensor-header" }),
      signal("AO", { capabilities: ["output"], electricalRole: "signal-output", signalTypes: ["analog"], connectorId: "sensor-header" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("sensor", "input", 3.3, 5, 5.5), voltageDomain("logic", "bidirectional", 0, 5, 5)],
      currentMa: { idle: 5, typical: 20, peak: 40, stall: null },
      connectors: [connector("sensor-header", "single-row-header", ["VCC", "GND", "DO", "AO"])],
      protection: { levelShifting: "required" },
      robotics: { role: "sensor.line", interface: "digital-analog" },
      requiredConnections: [required("VCC", "power-input"), required("GND", "common-ground"), required("DO", "controller-input")]
    },
    sim: { role: "sensor", voltage: 5 }
  },
  {
    id: "sensor-vl53l0x-tof",
    name: "VL53L0X time-of-flight sensor",
    category: "Sensor",
    color: "#2563eb",
    terminals: [
      powerInput("VIN", "VIN", "sensor", { voltage: 3.3, connectorId: "i2c-header" }),
      ground("GND", { connectorId: "i2c-header" }),
      signal("SCL", { capabilities: ["input"], i2cScl: true, shareableBus: true, signalTypes: ["i2c"], logicMaximumV: 3.3, connectorId: "i2c-header" }),
      signal("SDA", { capabilities: ["input", "output"], i2cSda: true, shareableBus: true, signalTypes: ["i2c"], logicMaximumV: 3.3, connectorId: "i2c-header" }),
      signal("XSHUT", { capabilities: ["input"], inputOnly: true, logicMaximumV: 3.3, connectorId: "i2c-header" }),
      signal("GPIO1", { capabilities: ["output"], electricalRole: "signal-output", logicMaximumV: 3.3, connectorId: "i2c-header" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("sensor", "input", 2.8, 3.3, 3.6), voltageDomain("logic", "bidirectional", 0, 3.3, 3.3)],
      currentMa: { idle: 5, typical: 20, peak: 40, stall: null },
      connectors: [connector("i2c-header", "single-row-header", ["VIN", "GND", "SCL", "SDA", "XSHUT", "GPIO1"])],
      protection: { levelShifting: "required" },
      robotics: { role: "sensor.distance", interface: "i2c" },
      requiredConnections: [required("VIN", "power-input"), required("GND", "common-ground"), required("SCL", "controller-output"), required("SDA", "controller-output")]
    },
    sim: { role: "sensor", voltage: 3.3 }
  },
  {
    id: "sensor-mpu6050-imu",
    name: "MPU-6050 IMU",
    category: "Sensor",
    color: "#0f766e",
    terminals: [
      powerInput("VCC", "VCC", "sensor", { voltage: 3.3, connectorId: "i2c-header" }),
      ground("GND", { connectorId: "i2c-header" }),
      signal("SCL", { capabilities: ["input"], i2cScl: true, shareableBus: true, signalTypes: ["i2c"], logicMaximumV: 3.3, connectorId: "i2c-header" }),
      signal("SDA", { capabilities: ["input", "output"], i2cSda: true, shareableBus: true, signalTypes: ["i2c"], logicMaximumV: 3.3, connectorId: "i2c-header" }),
      signal("INT", { capabilities: ["output"], electricalRole: "signal-output", logicMaximumV: 3.3, connectorId: "i2c-header" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("sensor", "input", 3, 3.3, 5), voltageDomain("logic", "bidirectional", 0, 3.3, 3.3)],
      currentMa: { idle: 3, typical: 10, peak: 20, stall: null },
      connectors: [connector("i2c-header", "single-row-header", ["VCC", "GND", "SCL", "SDA", "INT"])],
      protection: { levelShifting: "required" },
      robotics: { role: "sensor.imu", interface: "i2c" },
      requiredConnections: [required("VCC", "power-input"), required("GND", "common-ground"), required("SCL", "controller-output"), required("SDA", "controller-output")]
    },
    sim: { role: "sensor", voltage: 3.3 }
  },
  {
    id: "sensor-wheel-encoder",
    name: "Quadrature wheel encoder",
    category: "Sensor",
    color: "#1f2937",
    terminals: [
      powerInput("VCC", "VCC", "sensor", { voltage: 5, connectorId: "encoder-header" }),
      ground("GND", { connectorId: "encoder-header" }),
      signal("A", { capabilities: ["output"], electricalRole: "signal-output", connectorId: "encoder-header" }),
      signal("B", { capabilities: ["output"], electricalRole: "signal-output", connectorId: "encoder-header" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("sensor", "input", 3.3, 5, 5.5), voltageDomain("logic", "bidirectional", 0, 5, 5)],
      currentMa: { idle: 5, typical: 20, peak: 40, stall: null },
      connectors: [connector("encoder-header", "single-row-header", ["VCC", "GND", "A", "B"])],
      protection: { levelShifting: "required" },
      robotics: { role: "sensor.encoder", interface: "quadrature" },
      requiredConnections: [required("VCC", "power-input"), required("GND", "common-ground"), required("A", "controller-input"), required("B", "controller-input")]
    },
    sim: { role: "sensor", voltage: 5 }
  },
  {
    id: "switch-limit-micro",
    name: "Micro limit switch",
    category: "Input",
    color: "#374151",
    terminals: [passive("COM", "COM", { connectorId: "switch-lugs" }), passive("NO", "NO", { connectorId: "switch-lugs" }), passive("NC", "NC", { connectorId: "switch-lugs" })],
    engineering: {
      connectors: [connector("switch-lugs", "limit-switch-lugs", ["COM", "NO", "NC"])],
      robotics: { role: "sensor.digital", interface: "digital" }
    },
    sim: { role: "switch" }
  },
  {
    id: "input-joystick-module",
    name: "Analog joystick module",
    category: "Input",
    color: "#2563eb",
    terminals: [
      ground("GND", { connectorId: "joystick-header" }),
      powerInput("VCC", "VCC", "logic", { voltage: 5, connectorId: "joystick-header" }),
      signal("VRX", { capabilities: ["output"], electricalRole: "signal-output", signalTypes: ["analog"], connectorId: "joystick-header" }),
      signal("VRY", { capabilities: ["output"], electricalRole: "signal-output", signalTypes: ["analog"], connectorId: "joystick-header" }),
      signal("SW", { capabilities: ["output"], electricalRole: "signal-output", signalTypes: ["digital"], connectorId: "joystick-header" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("logic", "input", 3.3, 5, 5.5)],
      currentMa: { idle: 1, typical: 5, peak: 10, stall: null },
      connectors: [connector("joystick-header", "single-row-header", ["GND", "VCC", "VRX", "VRY", "SW"])],
      robotics: { role: "sensor.analog", interface: "analog-digital" },
      requiredConnections: [required("VCC", "power-input"), required("GND", "common-ground"), required("VRX", "controller-input"), required("VRY", "controller-input")]
    },
    sim: { role: "joystick" }
  },
  {
    id: "sensor-ina219-current",
    name: "INA219 current sensor",
    category: "Sensor",
    color: "#0e7490",
    terminals: [
      powerInput("VIN_PLUS", "VIN+", "sense", { voltage: 12, connectorId: "sense-terminal", recommendedGaugeAwg: 20 }),
      load("VIN_MINUS", "VIN-", "sense", { connectorId: "sense-terminal", recommendedGaugeAwg: 20 }),
      powerInput("VCC", "VCC", "logic", { voltage: 5, connectorId: "i2c-header" }),
      ground("GND", { connectorId: "i2c-header" }),
      signal("SCL", { capabilities: ["input"], i2cScl: true, shareableBus: true, signalTypes: ["i2c"], connectorId: "i2c-header" }),
      signal("SDA", { capabilities: ["input", "output"], i2cSda: true, shareableBus: true, signalTypes: ["i2c"], connectorId: "i2c-header" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("sense", "input", 0, 12, 26), voltageDomain("logic", "input", 3, 5, 5.5)],
      currentMa: { idle: 1, typical: 2, peak: 5, stall: null },
      connectors: [connector("sense-terminal", "screw-terminal", ["VIN_PLUS", "VIN_MINUS"], { pinPitchMm: 5.08 }), connector("i2c-header", "single-row-header", ["VCC", "GND", "SCL", "SDA"])],
      protection: { levelShifting: "required", currentLimiting: "external" },
      robotics: { role: "sensor.current", interface: "i2c" },
      requiredConnections: [required("VCC", "power-input"), required("GND", "common-ground"), required("SCL", "controller-output"), required("SDA", "controller-output")]
    },
    sim: { role: "sensor", voltage: 5 }
  },
  {
    id: "neopixel-strip-8",
    name: "8-pixel NeoPixel strip",
    category: "Output",
    color: "#111827",
    terminals: [
      powerInput("5V", "5V", "logic", { voltage: 5, connectorId: "strip-pads", recommendedGaugeAwg: 22 }),
      ground("GND", { connectorId: "strip-pads", recommendedGaugeAwg: 22 }),
      signal("DIN", { capabilities: ["input"], inputOnly: true, electricalRole: "signal-input", signalTypes: ["neopixel-data"], connectorId: "strip-pads" }),
      signal("DOUT", { capabilities: ["output"], electricalRole: "signal-output", signalTypes: ["neopixel-data"], connectorId: "strip-pads" })
    ],
    engineering: {
      voltageDomains: [voltageDomain("logic", "input", 4.5, 5, 5.5)],
      currentMa: { idle: 8, typical: 160, peak: 480, stall: null },
      connectors: [connector("strip-pads", "solder-pads", ["5V", "GND", "DIN", "DOUT"])],
      protection: { levelShifting: "required", currentLimiting: "external", decouplingRecommendation: "Add a bulk capacitor across strip power for physical builds." },
      robotics: { role: "output.indicator", interface: "addressable-led" },
      requiredConnections: [required("5V", "power-input"), required("GND", "common-ground"), required("DIN", "controller-output")]
    },
    sim: { role: "neopixel" }
  }
]);
