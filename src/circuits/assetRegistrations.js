import { geometryEvidenceId } from "./geometryEvidence.js";
import { getPhysicalDefinition } from "./physicalCatalog.js";

const PHOTOREAL_COMPONENT_IDS = Object.freeze([
  "controller-arduino-uno-r3",
  "controller-esp32-devkit",
  "breadboard-bb400-400",
  "supply-servo-6v",
  "servo-standard",
  "led-red",
  "resistor-220",
  "capacitor-electrolytic-470uf",
  "button-tactile",
  "ultrasonic-hcsr04",
  "driver-l298n",
  "motor-dc",
  "potentiometer-10k",
  "switch-spdt-slide",
  "controller-arduino-nano",
  "controller-raspberry-pi-pico",
  "driver-pca9685-servo",
  "regulator-lm2596-buck",
  "battery-lipo-2s-jst",
  "distribution-servo-power",
  "level-shifter-4ch",
  "driver-tb6612fng",
  "driver-a4988-stepper",
  "driver-mosfet-low-side",
  "servo-micro-9g",
  "motor-tt-gearmotor",
  "stepper-nema17",
  "actuator-solenoid-6v",
  "sensor-line-tcrt5000",
  "sensor-vl53l0x-tof",
  "sensor-mpu6050-imu",
  "sensor-wheel-encoder",
  "switch-limit-micro",
  "input-joystick-module",
  "sensor-ina219-current",
  "neopixel-strip-8"
]);

const REVIEW_LANDMARKS = Object.freeze({
  "controller-arduino-uno-r3": ["D0", "D13", "SCL", "NC", "A0", "A5", "VIN"],
  "controller-esp32-devkit": ["3V3", "VIN", "GND", "GND2", "D2", "CLK"],
  "breadboard-bb400-400": ["r1a", "r30j", "tp1", "tp25", "bn1", "bn25"],
  "driver-pca9685-servo": ["ch0_signal", "ch0_gnd", "ch15_signal", "ch15_gnd"]
});

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function registration(componentTypeId) {
  const terminalIds = Object.keys(getPhysicalDefinition(componentTypeId)?.terminals ?? {});
  const defaultLandmarks = terminalIds.length <= 3
    ? terminalIds
    : [terminalIds[0], terminalIds[Math.floor(terminalIds.length / 2)], terminalIds[terminalIds.length - 1]];
  return [componentTypeId, {
    id: `${componentTypeId}-asset-registration`,
    version: 1,
    assetId: componentTypeId,
    geometryEvidenceId: geometryEvidenceId(componentTypeId),
    rasterCrop: {
      units: "normalized",
      x: 0,
      y: 0,
      width: 1,
      height: 1
    },
    uniformScale: 1,
    translationMm: [0, 0],
    orientationDeg: 0,
    reviewLandmarks: (REVIEW_LANDMARKS[componentTypeId] ?? defaultLandmarks).map((terminalId) => ({ terminalId }))
  }];
}

export const assetRegistrationCatalog = freezeDeep(Object.fromEntries(
  PHOTOREAL_COMPONENT_IDS.map(registration)
));

export function getAssetRegistration(componentTypeId) {
  return assetRegistrationCatalog[componentTypeId] ?? null;
}

export function listAssetRegistrations() {
  return Object.values(assetRegistrationCatalog);
}

export function registeredRasterFrame(registrationValue, rasterWidth, rasterHeight, widthMm, heightMm) {
  const registrationRecord = registrationValue ?? {};
  const crop = registrationRecord.rasterCrop ?? {};
  const cropX = Number(crop.x ?? 0);
  const cropY = Number(crop.y ?? 0);
  const cropWidth = Number(crop.width ?? 1);
  const cropHeight = Number(crop.height ?? 1);
  const uniformScale = Number(registrationRecord.uniformScale ?? 1);
  const [translationX, translationY] = registrationRecord.translationMm ?? [0, 0];
  const croppedPixelWidth = Number(rasterWidth) * cropWidth;
  const croppedPixelHeight = Number(rasterHeight) * cropHeight;
  const orientationDeg = Number(registrationRecord.orientationDeg ?? 0);
  const swapsAxes = orientationDeg === 90 || orientationDeg === 270;
  const orientedPixelWidth = swapsAxes ? croppedPixelHeight : croppedPixelWidth;
  const orientedPixelHeight = swapsAxes ? croppedPixelWidth : croppedPixelHeight;
  const baseMmPerPixel = Math.min(Number(widthMm) / orientedPixelWidth, Number(heightMm) / orientedPixelHeight);
  const mmPerPixel = baseMmPerPixel * uniformScale;
  const cropCenterPixelX = Number(rasterWidth) * (cropX + cropWidth / 2);
  const cropCenterPixelY = Number(rasterHeight) * (cropY + cropHeight / 2);
  const radians = orientationDeg * Math.PI / 180;
  const preRotationTranslationX = Number(translationX) * Math.cos(radians) + Number(translationY) * Math.sin(radians);
  const preRotationTranslationY = -Number(translationX) * Math.sin(radians) + Number(translationY) * Math.cos(radians);
  return {
    x: Number(widthMm) / 2 + preRotationTranslationX - cropCenterPixelX * mmPerPixel,
    y: Number(heightMm) / 2 + preRotationTranslationY - cropCenterPixelY * mmPerPixel,
    width: Number(rasterWidth) * mmPerPixel,
    height: Number(rasterHeight) * mmPerPixel,
    orientationDeg,
    mmPerPixel
  };
}
