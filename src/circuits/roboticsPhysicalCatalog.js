import { geometryEvidenceId } from "./geometryEvidence.js";

const IFACE = Object.freeze({
  FEMALE_CONTROLLER_HEADER: "female-controller-header",
  MALE_HEADER_PIN: "male-header-pin",
  COMPONENT_LEAD: "component-lead",
  SCREW_TERMINAL: "screw-terminal",
  SERVO_FEMALE_PLUG: "servo-female-plug",
  SERVO_MALE_HEADER: "servo-male-header",
  PIGTAIL_CONDUCTOR: "pigtail-conductor",
  SOLDER_LUG: "solder-lug",
  MOTOR_TAB: "motor-tab",
  JST_POWER: "jst-power-lead",
  STEPPER_COIL: "stepper-coil-lead"
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
  const visibleSize = options.visibleSizeMm ?? 3.2;
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

function physicalPort(id, engineeringConnectorId, terminalIds, housingBoundsMm, contactPitchMm, contactAxisLocal, outwardNormalLocal, keyed, componentTypeId) {
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
  return bounds(Math.abs(endX - startX) + thickness, thickness, Math.min(startX, endX) - half, y - half);
}

function verticalPortBounds(x, startY, endY, thickness = 3.2) {
  const half = thickness / 2;
  return bounds(thickness, Math.abs(endY - startY) + thickness, x - half, Math.min(startY, endY) - half);
}

function definePhysical(id, physicalSizeMm, terminals, options = {}) {
  const [width, height] = physicalSizeMm;
  return {
    id,
    version: 1,
    physicalSizeMm: [width, height],
    bodyBoundsMm: options.bodyBoundsMm ?? bounds(width, height),
    visualBoundsMm: options.visualBoundsMm ?? bounds(width, height),
    clampBoundsMm: options.clampBoundsMm ?? options.visualBoundsMm ?? bounds(width, height),
    geometryEvidenceId: options.geometryEvidenceId ?? geometryEvidenceId(id),
    terminals,
    physicalPorts: options.physicalPorts ?? [],
    formedLeadGeometry: options.formedLeadGeometry ?? null,
    insertionPatterns: options.insertionPatterns ?? [],
    controls: options.controls ?? {}
  };
}

function dualRows(leftIds, rightIds, xOffset, startY, pitch = 2.54, iface = IFACE.MALE_HEADER_PIN, connectorIds = [null, null]) {
  const terminals = {};
  leftIds.forEach((id, index) => {
    terminals[id] = terminal([-xOffset, startY + index * pitch], iface, { connectorId: connectorIds[0], sourceMappingId: id });
  });
  rightIds.forEach((id, index) => {
    terminals[id] = terminal([xOffset, startY + index * pitch], iface, { connectorId: connectorIds[1], sourceMappingId: id });
  });
  return terminals;
}

function row(ids, startX, y, pitch = 2.54, iface = IFACE.MALE_HEADER_PIN, connectorId = null, anchorKind = "on-body") {
  const terminals = {};
  ids.forEach((id, index) => {
    terminals[id] = terminal([startX + index * pitch, y], iface, { connectorId, anchorKind, sourceMappingId: id });
  });
  return terminals;
}

function column(ids, x, startY, pitch = 2.54, iface = IFACE.MALE_HEADER_PIN, connectorId = null) {
  const terminals = {};
  ids.forEach((id, index) => {
    terminals[id] = terminal([x, startY + index * pitch], iface, { connectorId, sourceMappingId: id });
  });
  return terminals;
}

function servoHeaders(prefixes, startX, y, connectorId) {
  const terminals = {};
  prefixes.forEach((prefix, index) => {
    const x = startX + index * 2.54;
    terminals[`${prefix}_signal`] = terminal([x, y - 2.54], IFACE.SERVO_MALE_HEADER, { connectorId });
    terminals[`${prefix}_vplus`] = terminal([x, y], IFACE.SERVO_MALE_HEADER, { connectorId });
    terminals[`${prefix}_gnd`] = terminal([x, y + 2.54], IFACE.SERVO_MALE_HEADER, { connectorId });
  });
  return terminals;
}

function servoPorts(componentTypeId, prefixes, startX, y, engineeringConnectorId) {
  return prefixes.map((prefix, index) => {
    const x = startX + index * 2.54;
    return physicalPort(
      `${prefix}-port`,
      engineeringConnectorId,
      [`${prefix}_signal`, `${prefix}_vplus`, `${prefix}_gnd`],
      verticalPortBounds(x, y - 2.54, y + 2.54, 2.54),
      2.54,
      [0, 1],
      [1, 0],
      true,
      componentTypeId
    );
  });
}

const NANO_LEFT = ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN"];
const NANO_RIGHT = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND2", "RST2", "D0", "D1"];
const PICO_LEFT = ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND2", "GP6", "GP7", "GP8", "GP9", "GND3", "GP10", "GP11", "GP12", "GP13", "GND4", "GP14", "GP15"];
const PICO_RIGHT = ["VBUS", "VSYS", "GND8", "3V3_EN", "3V3", "ADC_VREF", "GP28", "GND7", "GP27", "GP26", "RUN", "GP22", "GND6", "GP21", "GP20", "GP19", "GP18", "GND5", "GP17", "GP16"];

export const roboticsPhysicalCatalog = freezeDeep({
  "controller-arduino-nano": definePhysical("controller-arduino-nano", [18, 45], dualRows(NANO_LEFT, NANO_RIGHT, 7.62, -17.78, 2.54, IFACE.MALE_HEADER_PIN, ["nano-headers", "nano-headers"]), {
    physicalPorts: [
      physicalPort("nano-left", "nano-headers", NANO_LEFT, verticalPortBounds(-7.62, -17.78, 17.78, 2.54), 2.54, [0, 1], [-1, 0], false, "controller-arduino-nano"),
      physicalPort("nano-right", "nano-headers", NANO_RIGHT, verticalPortBounds(7.62, -17.78, 17.78, 2.54), 2.54, [0, 1], [1, 0], false, "controller-arduino-nano")
    ]
  }),
  "controller-raspberry-pi-pico": definePhysical("controller-raspberry-pi-pico", [21, 51], dualRows(PICO_LEFT, PICO_RIGHT, 8.89, -24.13, 2.54, IFACE.MALE_HEADER_PIN, ["pico-headers", "pico-headers"]), {
    physicalPorts: [
      physicalPort("pico-left", "pico-headers", PICO_LEFT, verticalPortBounds(-8.89, -24.13, 24.13, 2.54), 2.54, [0, 1], [-1, 0], false, "controller-raspberry-pi-pico"),
      physicalPort("pico-right", "pico-headers", PICO_RIGHT, verticalPortBounds(8.89, -24.13, 24.13, 2.54), 2.54, [0, 1], [1, 0], false, "controller-raspberry-pi-pico")
    ]
  }),
  "driver-pca9685-servo": definePhysical("driver-pca9685-servo", [63, 25], {
    ...row(["GND", "OE", "SCL", "SDA", "VCC", "VPLUS"], -28, -9.5, 2.54, IFACE.MALE_HEADER_PIN, "control-header"),
    ...servoHeaders(Array.from({ length: 16 }, (_, index) => `ch${index}`), -19.05, 7.4, "servo-bank")
  }, {
    physicalPorts: [
      physicalPort("control-header", "control-header", ["GND", "OE", "SCL", "SDA", "VCC", "VPLUS"], horizontalPortBounds(-28, -15.3, -9.5), 2.54, [1, 0], [0, -1], false, "driver-pca9685-servo"),
      ...servoPorts("driver-pca9685-servo", Array.from({ length: 16 }, (_, index) => `ch${index}`), -19.05, 7.4, "servo-bank")
    ]
  }),
  "regulator-lm2596-buck": definePhysical("regulator-lm2596-buck", [48, 26], {
    VIN_PLUS: terminal([-20, -2.54], IFACE.SCREW_TERMINAL, { connectorId: "input" }),
    VIN_MINUS: terminal([-20, 2.54], IFACE.SCREW_TERMINAL, { connectorId: "input" }),
    OUT_PLUS: terminal([20, -2.54], IFACE.SCREW_TERMINAL, { connectorId: "output" }),
    OUT_MINUS: terminal([20, 2.54], IFACE.SCREW_TERMINAL, { connectorId: "output" })
  }, {
    physicalPorts: [
      physicalPort("input", "input", ["VIN_PLUS", "VIN_MINUS"], verticalPortBounds(-20, -2.54, 2.54, 5.08), 5.08, [0, 1], [-1, 0], true, "regulator-lm2596-buck"),
      physicalPort("output", "output", ["OUT_PLUS", "OUT_MINUS"], verticalPortBounds(20, -2.54, 2.54, 5.08), 5.08, [0, 1], [1, 0], true, "regulator-lm2596-buck")
    ]
  }),
  "battery-lipo-2s-jst": definePhysical("battery-lipo-2s-jst", [55, 34], {
    VPLUS: terminal([28, -1.27], IFACE.JST_POWER, { visibleSizeMm: 4, connectorId: "jst-output", anchorKind: "external-port" }),
    GND: terminal([28, 1.27], IFACE.JST_POWER, { visibleSizeMm: 4, connectorId: "jst-output", anchorKind: "external-port" })
  }, {
    visualBoundsMm: bounds(60, 34, -27.5, -17),
    clampBoundsMm: bounds(60, 34, -27.5, -17),
    physicalPorts: [physicalPort("jst-output", "jst-output", ["VPLUS", "GND"], verticalPortBounds(28, -1.27, 1.27, 4), 2.54, [0, 1], [1, 0], true, "battery-lipo-2s-jst")]
  }),
  "distribution-servo-power": definePhysical("distribution-servo-power", [60, 35], {
    VIN: terminal([-25, -2.54], IFACE.SCREW_TERMINAL, { connectorId: "power-input" }),
    GND: terminal([-25, 2.54], IFACE.SCREW_TERMINAL, { connectorId: "power-input" }),
    ...servoHeaders(["s1", "s2", "s3", "s4"], -3.81, 9, "servo-power-bank")
  }, {
    physicalPorts: [
      physicalPort("power-input", "power-input", ["VIN", "GND"], verticalPortBounds(-25, -2.54, 2.54, 5.08), 5.08, [0, 1], [-1, 0], true, "distribution-servo-power"),
      ...servoPorts("distribution-servo-power", ["s1", "s2", "s3", "s4"], -3.81, 9, "servo-power-bank")
    ]
  }),
  "level-shifter-4ch": definePhysical("level-shifter-4ch", [28, 24], {
    ...column(["HV", "HV1", "HV2", "HV3", "HV4", "GND_HV"], -11, -6.35, 2.54, IFACE.MALE_HEADER_PIN, "high-side"),
    ...column(["LV", "LV1", "LV2", "LV3", "LV4", "GND_LV"], 11, -6.35, 2.54, IFACE.MALE_HEADER_PIN, "low-side")
  }, {
    physicalPorts: [
      physicalPort("high-side", "high-side", ["HV", "HV1", "HV2", "HV3", "HV4", "GND_HV"], verticalPortBounds(-11, -6.35, 6.35), 2.54, [0, 1], [-1, 0], false, "level-shifter-4ch"),
      physicalPort("low-side", "low-side", ["LV", "LV1", "LV2", "LV3", "LV4", "GND_LV"], verticalPortBounds(11, -6.35, 6.35), 2.54, [0, 1], [1, 0], false, "level-shifter-4ch")
    ]
  }),
  "driver-tb6612fng": definePhysical("driver-tb6612fng", [36, 28], {
    ...column(["VM", "VCC", "GND", "STBY", "AIN1", "AIN2", "PWMA"], -15, -7.62, 2.54, IFACE.MALE_HEADER_PIN, "driver-headers"),
    ...column(["BIN1", "BIN2", "PWMB", "A01", "A02", "B01", "B02"], 15, -7.62, 2.54, IFACE.MALE_HEADER_PIN, "driver-headers")
  }, {
    physicalPorts: [
      physicalPort("driver-left", "driver-headers", ["VM", "VCC", "GND", "STBY", "AIN1", "AIN2", "PWMA"], verticalPortBounds(-15, -7.62, 7.62), 2.54, [0, 1], [-1, 0], false, "driver-tb6612fng"),
      physicalPort("driver-right", "driver-headers", ["BIN1", "BIN2", "PWMB", "A01", "A02", "B01", "B02"], verticalPortBounds(15, -7.62, 7.62), 2.54, [0, 1], [1, 0], false, "driver-tb6612fng")
    ]
  }),
  "driver-a4988-stepper": definePhysical("driver-a4988-stepper", [20, 28], {
    ...column(["EN", "MS1", "MS2", "MS3", "RST", "SLP", "STEP", "DIR"], -7.62, -8.89, 2.54, IFACE.MALE_HEADER_PIN, "a4988-headers"),
    ...column(["VMOT", "GNDM", "2B", "2A", "1A", "1B", "VDD", "GND"], 7.62, -8.89, 2.54, IFACE.MALE_HEADER_PIN, "a4988-headers")
  }, {
    physicalPorts: [
      physicalPort("a4988-left", "a4988-headers", ["EN", "MS1", "MS2", "MS3", "RST", "SLP", "STEP", "DIR"], verticalPortBounds(-7.62, -8.89, 8.89), 2.54, [0, 1], [-1, 0], false, "driver-a4988-stepper"),
      physicalPort("a4988-right", "a4988-headers", ["VMOT", "GNDM", "2B", "2A", "1A", "1B", "VDD", "GND"], verticalPortBounds(7.62, -8.89, 8.89), 2.54, [0, 1], [1, 0], false, "driver-a4988-stepper")
    ]
  }),
  "driver-mosfet-low-side": definePhysical("driver-mosfet-low-side", [26, 22], {
    SIG: terminal([-7.54, 7], IFACE.MALE_HEADER_PIN, { connectorId: "logic-header" }),
    GND: terminal([-5, 7], IFACE.MALE_HEADER_PIN, { connectorId: "logic-header" }),
    VIN: terminal([10, -2.54], IFACE.SCREW_TERMINAL, { connectorId: "load-terminal" }),
    LOAD: terminal([10, 2.54], IFACE.SCREW_TERMINAL, { connectorId: "load-terminal" })
  }, {
    physicalPorts: [
      physicalPort("logic-header", "logic-header", ["SIG", "GND"], horizontalPortBounds(-7.54, -5, 7), 2.54, [1, 0], [0, 1], false, "driver-mosfet-low-side"),
      physicalPort("load-terminal", "load-terminal", ["VIN", "LOAD"], verticalPortBounds(10, -2.54, 2.54, 5.08), 5.08, [0, 1], [1, 0], false, "driver-mosfet-low-side")
    ]
  }),
  "servo-micro-9g": definePhysical("servo-micro-9g", [34, 16], {
    signal: terminal([23, -2.54], IFACE.SERVO_FEMALE_PLUG, { connectorId: "servo-lead", anchorKind: "external-port" }),
    vplus: terminal([23, 0], IFACE.SERVO_FEMALE_PLUG, { connectorId: "servo-lead", anchorKind: "external-port" }),
    gnd: terminal([23, 2.54], IFACE.SERVO_FEMALE_PLUG, { connectorId: "servo-lead", anchorKind: "external-port" })
  }, {
    visualBoundsMm: bounds(50, 16, -17, -8),
    clampBoundsMm: bounds(50, 16, -17, -8),
    physicalPorts: [physicalPort("servo-plug", "servo-lead", ["signal", "vplus", "gnd"], verticalPortBounds(23, -2.54, 2.54, 4), 2.54, [0, 1], [1, 0], true, "servo-micro-9g")],
    insertionPatterns: [{
      id: "micro-servo-three-contact-plug",
      terminalIds: ["signal", "vplus", "gnd"],
      rigidity: "rigid",
      allowedRotationsDeg: [0, 90, 180, 270],
      positionToleranceMm: 0.25,
      angularToleranceDeg: 1
    }]
  }),
  "motor-tt-gearmotor": definePhysical("motor-tt-gearmotor", [50, 24], {
    a: terminal([-21, -4], IFACE.MOTOR_TAB, { connectorId: "motor-leads" }),
    b: terminal([-21, 4], IFACE.MOTOR_TAB, { connectorId: "motor-leads" })
  }),
  "stepper-nema17": definePhysical("stepper-nema17", [42, 42], {
    A1: terminal([22, -7.62], IFACE.STEPPER_COIL, { connectorId: "stepper-leads", anchorKind: "external-lead" }),
    A2: terminal([22, -2.54], IFACE.STEPPER_COIL, { connectorId: "stepper-leads", anchorKind: "external-lead" }),
    B1: terminal([22, 2.54], IFACE.STEPPER_COIL, { connectorId: "stepper-leads", anchorKind: "external-lead" }),
    B2: terminal([22, 7.62], IFACE.STEPPER_COIL, { connectorId: "stepper-leads", anchorKind: "external-lead" })
  }, {
    visualBoundsMm: bounds(46, 42, -21, -21),
    clampBoundsMm: bounds(46, 42, -21, -21)
  }),
  "actuator-solenoid-6v": definePhysical("actuator-solenoid-6v", [48, 20], {
    plus: terminal([-25, -4], IFACE.PIGTAIL_CONDUCTOR, { connectorId: "solenoid-leads", anchorKind: "external-lead" }),
    minus: terminal([-25, 4], IFACE.PIGTAIL_CONDUCTOR, { connectorId: "solenoid-leads", anchorKind: "external-lead" })
  }, {
    visualBoundsMm: bounds(50, 20, -26, -10),
    clampBoundsMm: bounds(50, 20, -26, -10)
  }),
  "sensor-line-tcrt5000": definePhysical("sensor-line-tcrt5000", [32, 14], row(["VCC", "GND", "DO", "AO"], -3.81, 5.2, 2.54, IFACE.MALE_HEADER_PIN, "sensor-header"), {
    physicalPorts: [physicalPort("sensor-header", "sensor-header", ["VCC", "GND", "DO", "AO"], horizontalPortBounds(-3.81, 3.81, 5.2), 2.54, [1, 0], [0, 1], false, "sensor-line-tcrt5000")]
  }),
  "sensor-vl53l0x-tof": definePhysical("sensor-vl53l0x-tof", [22, 16], row(["VIN", "GND", "SCL", "SDA", "XSHUT", "GPIO1"], -6.35, 6.1, 2.54, IFACE.MALE_HEADER_PIN, "i2c-header"), {
    physicalPorts: [physicalPort("i2c-header", "i2c-header", ["VIN", "GND", "SCL", "SDA", "XSHUT", "GPIO1"], horizontalPortBounds(-6.35, 6.35, 6.1), 2.54, [1, 0], [0, 1], false, "sensor-vl53l0x-tof")]
  }),
  "sensor-mpu6050-imu": definePhysical("sensor-mpu6050-imu", [22, 16], row(["VCC", "GND", "SCL", "SDA", "INT"], -5.08, 6.1, 2.54, IFACE.MALE_HEADER_PIN, "i2c-header"), {
    physicalPorts: [physicalPort("i2c-header", "i2c-header", ["VCC", "GND", "SCL", "SDA", "INT"], horizontalPortBounds(-5.08, 5.08, 6.1), 2.54, [1, 0], [0, 1], false, "sensor-mpu6050-imu")]
  }),
  "sensor-wheel-encoder": definePhysical("sensor-wheel-encoder", [28, 18], row(["VCC", "GND", "A", "B"], -3.81, 7, 2.54, IFACE.MALE_HEADER_PIN, "encoder-header"), {
    physicalPorts: [physicalPort("encoder-header", "encoder-header", ["VCC", "GND", "A", "B"], horizontalPortBounds(-3.81, 3.81, 7), 2.54, [1, 0], [0, 1], false, "sensor-wheel-encoder")]
  }),
  "switch-limit-micro": definePhysical("switch-limit-micro", [20, 10], row(["COM", "NO", "NC"], -2.54, 4, 2.54, IFACE.SOLDER_LUG, "switch-lugs")),
  "input-joystick-module": definePhysical("input-joystick-module", [36, 28], row(["GND", "VCC", "VRX", "VRY", "SW"], -5.08, 11, 2.54, IFACE.MALE_HEADER_PIN, "joystick-header"), {
    physicalPorts: [physicalPort("joystick-header", "joystick-header", ["GND", "VCC", "VRX", "VRY", "SW"], horizontalPortBounds(-5.08, 5.08, 11), 2.54, [1, 0], [0, 1], false, "input-joystick-module")]
  }),
  "sensor-ina219-current": definePhysical("sensor-ina219-current", [24, 18], {
    VIN_PLUS: terminal([-9, -2.54], IFACE.SCREW_TERMINAL, { connectorId: "sense-terminal" }),
    VIN_MINUS: terminal([-9, 2.54], IFACE.SCREW_TERMINAL, { connectorId: "sense-terminal" }),
    VCC: terminal([9, -3.81], IFACE.MALE_HEADER_PIN, { connectorId: "i2c-header" }),
    GND: terminal([9, -1.27], IFACE.MALE_HEADER_PIN, { connectorId: "i2c-header" }),
    SCL: terminal([9, 1.27], IFACE.MALE_HEADER_PIN, { connectorId: "i2c-header" }),
    SDA: terminal([9, 3.81], IFACE.MALE_HEADER_PIN, { connectorId: "i2c-header" })
  }, {
    physicalPorts: [
      physicalPort("sense-terminal", "sense-terminal", ["VIN_PLUS", "VIN_MINUS"], verticalPortBounds(-9, -2.54, 2.54, 5.08), 5.08, [0, 1], [-1, 0], false, "sensor-ina219-current"),
      physicalPort("i2c-header", "i2c-header", ["VCC", "GND", "SCL", "SDA"], verticalPortBounds(9, -3.81, 3.81), 2.54, [0, 1], [1, 0], false, "sensor-ina219-current")
    ]
  }),
  "neopixel-strip-8": definePhysical("neopixel-strip-8", [68, 10], {
    "5V": terminal([-31, -2.5], IFACE.SOLDER_LUG, { connectorId: "strip-pads" }),
    GND: terminal([-31, 2.5], IFACE.SOLDER_LUG, { connectorId: "strip-pads" }),
    DIN: terminal([-26, 0], IFACE.SOLDER_LUG, { connectorId: "strip-pads" }),
    DOUT: terminal([31, 0], IFACE.SOLDER_LUG, { connectorId: "strip-pads" })
  })
});
