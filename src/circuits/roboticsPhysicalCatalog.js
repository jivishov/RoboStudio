const IFACE = Object.freeze({
  FEMALE_CONTROLLER_HEADER: "female-controller-header",
  MALE_HEADER_PIN: "male-header-pin",
  COMPONENT_LEAD: "component-lead",
  SCREW_TERMINAL: "screw-terminal",
  SERVO_FEMALE_PLUG: "servo-female-plug",
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
    attachmentCapacity: options.attachmentCapacity ?? 1,
    sourceMappingId: options.sourceMappingId ?? null,
    physicalLabel: options.physicalLabel ?? null
  };
}

function definePhysical(id, physicalSizeMm, terminals, options = {}) {
  const [width, height] = physicalSizeMm;
  return {
    id,
    version: 1,
    physicalSizeMm: [width, height],
    bodyBoundsMm: options.bodyBoundsMm ?? bounds(width, height),
    visualBoundsMm: options.visualBoundsMm ?? options.bodyBoundsMm ?? bounds(width, height),
    clampBoundsMm: options.clampBoundsMm ?? options.visualBoundsMm ?? options.bodyBoundsMm ?? bounds(width, height),
    terminals,
    insertionPatterns: options.insertionPatterns ?? [],
    controls: options.controls ?? {}
  };
}

function dualRows(leftIds, rightIds, xOffset, startY, pitch = 2.54, iface = IFACE.MALE_HEADER_PIN) {
  const terminals = {};
  leftIds.forEach((id, index) => {
    terminals[id] = terminal([-xOffset, startY + index * pitch], iface, { sourceMappingId: id });
  });
  rightIds.forEach((id, index) => {
    terminals[id] = terminal([xOffset, startY + index * pitch], iface, { sourceMappingId: id });
  });
  return terminals;
}

function row(ids, startX, y, pitch = 2.54, iface = IFACE.MALE_HEADER_PIN) {
  const terminals = {};
  ids.forEach((id, index) => {
    terminals[id] = terminal([startX + index * pitch, y], iface, { sourceMappingId: id });
  });
  return terminals;
}

function column(ids, x, startY, pitch = 2.54, iface = IFACE.MALE_HEADER_PIN) {
  const terminals = {};
  ids.forEach((id, index) => {
    terminals[id] = terminal([x, startY + index * pitch], iface, { sourceMappingId: id });
  });
  return terminals;
}

function servoHeaders(prefixes, startX, y) {
  const terminals = {};
  prefixes.forEach((prefix, index) => {
    const x = startX + index * 6.2;
    terminals[`${prefix}_signal`] = terminal([x, y - 2.54], IFACE.MALE_HEADER_PIN);
    terminals[`${prefix}_vplus`] = terminal([x, y], IFACE.MALE_HEADER_PIN);
    terminals[`${prefix}_gnd`] = terminal([x, y + 2.54], IFACE.MALE_HEADER_PIN);
  });
  return terminals;
}

const NANO_LEFT = ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN"];
const NANO_RIGHT = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND2", "RST2", "D0", "D1"];
const PICO_LEFT = ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND2", "GP6", "GP7", "GP8", "GP9", "GND3", "GP10", "GP11", "GP12", "GP13", "GND4", "GP14", "GP15"];
const PICO_RIGHT = ["VBUS", "VSYS", "GND8", "3V3_EN", "3V3", "ADC_VREF", "GP28", "GND7", "GP27", "GP26", "RUN", "GP22", "GND6", "GP21", "GP20", "GP19", "GP18", "GND5", "GP17", "GP16"];

export const roboticsPhysicalCatalog = freezeDeep({
  "controller-arduino-nano": definePhysical("controller-arduino-nano", [18, 45], dualRows(NANO_LEFT, NANO_RIGHT, 7.62, -17.78)),
  "controller-raspberry-pi-pico": definePhysical("controller-raspberry-pi-pico", [21, 51], dualRows(PICO_LEFT, PICO_RIGHT, 8.89, -24.13)),
  "driver-pca9685-servo": definePhysical("driver-pca9685-servo", [63, 25], {
    ...row(["GND", "OE", "SCL", "SDA", "VCC", "VPLUS"], -28, -9.5),
    ...servoHeaders(Array.from({ length: 16 }, (_, index) => `ch${index}`), -27, 7.4)
  }),
  "regulator-lm2596-buck": definePhysical("regulator-lm2596-buck", [48, 26], {
    VIN_PLUS: terminal([-20, -6], IFACE.SCREW_TERMINAL),
    VIN_MINUS: terminal([-20, 6], IFACE.SCREW_TERMINAL),
    OUT_PLUS: terminal([20, -6], IFACE.SCREW_TERMINAL),
    OUT_MINUS: terminal([20, 6], IFACE.SCREW_TERMINAL)
  }),
  "battery-lipo-2s-jst": definePhysical("battery-lipo-2s-jst", [55, 34], {
    VPLUS: terminal([24, -3.2], IFACE.JST_POWER, { visibleSizeMm: 4 }),
    GND: terminal([24, 3.2], IFACE.JST_POWER, { visibleSizeMm: 4 })
  }),
  "distribution-servo-power": definePhysical("distribution-servo-power", [60, 35], {
    VIN: terminal([-25, -7], IFACE.SCREW_TERMINAL),
    GND: terminal([-25, 7], IFACE.SCREW_TERMINAL),
    ...servoHeaders(["s1", "s2", "s3", "s4"], -7, 9)
  }),
  "level-shifter-4ch": definePhysical("level-shifter-4ch", [28, 24], {
    ...column(["HV", "HV1", "HV2", "HV3", "HV4", "GND_HV"], -11, -7.62),
    ...column(["LV", "LV1", "LV2", "LV3", "LV4", "GND_LV"], 11, -7.62)
  }),
  "driver-tb6612fng": definePhysical("driver-tb6612fng", [36, 28], {
    ...column(["VM", "VCC", "GND", "STBY", "AIN1", "AIN2", "PWMA"], -15, -7.62),
    ...column(["A01", "A02", "B02", "B01", "PWMB", "BIN2", "BIN1"], 15, -7.62)
  }),
  "driver-a4988-stepper": definePhysical("driver-a4988-stepper", [20, 28], {
    ...column(["EN", "MS1", "MS2", "MS3", "RST", "SLP", "STEP", "DIR"], -7.62, -8.89),
    ...column(["VMOT", "GNDM", "2B", "2A", "1A", "1B", "VDD", "GND"], 7.62, -8.89)
  }),
  "driver-mosfet-low-side": definePhysical("driver-mosfet-low-side", [26, 22], {
    SIG: terminal([-10, 7], IFACE.MALE_HEADER_PIN),
    GND: terminal([-5, 7], IFACE.MALE_HEADER_PIN),
    VIN: terminal([10, -4], IFACE.SCREW_TERMINAL),
    LOAD: terminal([10, 5], IFACE.SCREW_TERMINAL)
  }),
  "servo-micro-9g": definePhysical("servo-micro-9g", [34, 16], {
    signal: terminal([17, -5.08], IFACE.SERVO_FEMALE_PLUG),
    vplus: terminal([17, 0], IFACE.SERVO_FEMALE_PLUG),
    gnd: terminal([17, 5.08], IFACE.SERVO_FEMALE_PLUG)
  }),
  "motor-tt-gearmotor": definePhysical("motor-tt-gearmotor", [50, 24], {
    a: terminal([-21, -4], IFACE.MOTOR_TAB),
    b: terminal([-21, 4], IFACE.MOTOR_TAB)
  }),
  "stepper-nema17": definePhysical("stepper-nema17", [42, 42], {
    A1: terminal([18, -7.62], IFACE.STEPPER_COIL),
    A2: terminal([18, -2.54], IFACE.STEPPER_COIL),
    B1: terminal([18, 2.54], IFACE.STEPPER_COIL),
    B2: terminal([18, 7.62], IFACE.STEPPER_COIL)
  }),
  "actuator-solenoid-6v": definePhysical("actuator-solenoid-6v", [48, 20], {
    plus: terminal([-20, -4], IFACE.PIGTAIL_CONDUCTOR),
    minus: terminal([-20, 4], IFACE.PIGTAIL_CONDUCTOR)
  }),
  "sensor-line-tcrt5000": definePhysical("sensor-line-tcrt5000", [32, 14], row(["VCC", "GND", "DO", "AO"], -3.81, 5.2)),
  "sensor-vl53l0x-tof": definePhysical("sensor-vl53l0x-tof", [22, 16], row(["VIN", "GND", "SCL", "SDA", "XSHUT", "GPIO1"], -6.35, 6.1)),
  "sensor-mpu6050-imu": definePhysical("sensor-mpu6050-imu", [22, 16], row(["VCC", "GND", "SCL", "SDA", "INT"], -5.08, 6.1)),
  "sensor-wheel-encoder": definePhysical("sensor-wheel-encoder", [28, 18], row(["VCC", "GND", "A", "B"], -3.81, 7)),
  "switch-limit-micro": definePhysical("switch-limit-micro", [20, 10], row(["COM", "NO", "NC"], -2.54, 4)),
  "input-joystick-module": definePhysical("input-joystick-module", [36, 28], row(["GND", "VCC", "VRX", "VRY", "SW"], -5.08, 11)),
  "sensor-ina219-current": definePhysical("sensor-ina219-current", [24, 18], {
    VIN_PLUS: terminal([-9, -4], IFACE.SCREW_TERMINAL),
    VIN_MINUS: terminal([-9, 4], IFACE.SCREW_TERMINAL),
    VCC: terminal([9, -5.08], IFACE.MALE_HEADER_PIN),
    GND: terminal([9, -2.54], IFACE.MALE_HEADER_PIN),
    SCL: terminal([9, 2.54], IFACE.MALE_HEADER_PIN),
    SDA: terminal([9, 5.08], IFACE.MALE_HEADER_PIN)
  }),
  "neopixel-strip-8": definePhysical("neopixel-strip-8", [68, 10], {
    "5V": terminal([-31, -2.5], IFACE.SOLDER_LUG),
    GND: terminal([-31, 2.5], IFACE.SOLDER_LUG),
    DIN: terminal([-26, 0], IFACE.SOLDER_LUG),
    DOUT: terminal([31, 0], IFACE.SOLDER_LUG)
  })
});
