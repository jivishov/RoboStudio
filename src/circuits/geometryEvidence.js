export const GEOMETRY_ACCURACY_CLASSES = Object.freeze({
  EXACT_MODEL_VERIFIED: "exact-model-verified",
  REPRESENTATIVE_NOMINAL: "representative-nominal",
  APPROXIMATE: "approximate"
});

export const GEOMETRY_SOURCE_KINDS = Object.freeze({
  MANUFACTURER_DRAWING: "manufacturer-drawing",
  MANUFACTURER_DATASHEET: "manufacturer-datasheet",
  ARTWORK_CALIBRATED: "artwork-calibrated",
  GENERIC_ESTIMATE: "generic-estimate"
});

const EXACT_EVIDENCE = Object.freeze({
  "controller-arduino-uno-r3": {
    sourceKind: GEOMETRY_SOURCE_KINDS.MANUFACTURER_DRAWING,
    provenanceId: "arduino-a000066-official-cad",
    sourceRevision: "UNO-TH_Rev3e",
    registrationToleranceMm: 0.25
  },
  "controller-esp32-devkit": {
    sourceKind: GEOMETRY_SOURCE_KINDS.MANUFACTURER_DRAWING,
    provenanceId: "espressif-esp32-devkitc-v4-official-drawing",
    sourceRevision: "ESP32-DevKitC V4",
    registrationToleranceMm: 0.25
  },
  "breadboard-bb400-400": {
    sourceKind: GEOMETRY_SOURCE_KINDS.MANUFACTURER_DATASHEET,
    provenanceId: "busboard-bb400-official-datasheet",
    sourceRevision: "BPS-DAT-(BB400)-0001 Rev 6",
    registrationToleranceMm: 0.25
  }
});

const REPRESENTATIVE_IDS = Object.freeze([
  "servo-standard",
  "led-red",
  "resistor-220",
  "capacitor-electrolytic-470uf",
  "button-tactile",
  "ultrasonic-hcsr04",
  "motor-dc",
  "potentiometer-10k",
  "switch-spdt-slide",
  "controller-arduino-nano",
  "controller-raspberry-pi-pico",
  "driver-pca9685-servo",
  "driver-a4988-stepper",
  "servo-micro-9g",
  "stepper-nema17",
  "switch-limit-micro"
]);

const APPROXIMATE_IDS = Object.freeze([
  "supply-servo-6v",
  "driver-l298n",
  "regulator-lm2596-buck",
  "battery-lipo-2s-jst",
  "distribution-servo-power",
  "level-shifter-4ch",
  "driver-tb6612fng",
  "driver-mosfet-low-side",
  "motor-tt-gearmotor",
  "actuator-solenoid-6v",
  "sensor-line-tcrt5000",
  "sensor-vl53l0x-tof",
  "sensor-mpu6050-imu",
  "sensor-wheel-encoder",
  "input-joystick-module",
  "sensor-ina219-current",
  "neopixel-strip-8",
  "breadboard-400"
]);

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function evidenceId(componentTypeId) {
  return `${componentTypeId}-geometry-evidence`;
}

function evidence(componentTypeId, accuracyClass, overrides = {}) {
  return [evidenceId(componentTypeId), {
    id: evidenceId(componentTypeId),
    componentTypeId,
    accuracyClass,
    sourceKind: overrides.sourceKind ?? GEOMETRY_SOURCE_KINDS.GENERIC_ESTIMATE,
    provenanceId: overrides.provenanceId ?? "robostudio-cycle-01-physical-audit",
    sourceRevision: overrides.sourceRevision ?? "2026-07-14 nominal geometry audit",
    registrationToleranceMm: overrides.registrationToleranceMm ?? (
      accuracyClass === GEOMETRY_ACCURACY_CLASSES.REPRESENTATIVE_NOMINAL ? 0.5 : 1.5
    )
  }];
}

export const geometryEvidenceCatalog = freezeDeep(Object.fromEntries([
  ...Object.entries(EXACT_EVIDENCE).map(([componentTypeId, overrides]) => evidence(
    componentTypeId,
    GEOMETRY_ACCURACY_CLASSES.EXACT_MODEL_VERIFIED,
    overrides
  )),
  ...REPRESENTATIVE_IDS.map((componentTypeId) => evidence(
    componentTypeId,
    GEOMETRY_ACCURACY_CLASSES.REPRESENTATIVE_NOMINAL,
    componentTypeId === "driver-pca9685-servo" ? {
      sourceKind: GEOMETRY_SOURCE_KINDS.MANUFACTURER_DATASHEET,
      provenanceId: "adafruit-pca9685-16-channel-official-guide",
      sourceRevision: "Guide revision 2026-05-19",
      registrationToleranceMm: 0.5
    } : {}
  )),
  ...APPROXIMATE_IDS.map((componentTypeId) => evidence(
    componentTypeId,
    GEOMETRY_ACCURACY_CLASSES.APPROXIMATE
  ))
]));

export function geometryEvidenceId(componentTypeId) {
  return evidenceId(componentTypeId);
}

export function getGeometryEvidence(evidenceIdValue) {
  return geometryEvidenceCatalog[evidenceIdValue] ?? null;
}

export function geometryEvidenceForComponent(componentTypeId) {
  return getGeometryEvidence(evidenceId(componentTypeId));
}

export function listGeometryEvidence() {
  return Object.values(geometryEvidenceCatalog);
}
