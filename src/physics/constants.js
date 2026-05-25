export const ROBOT_DESIGN_VERSION = 1;
export const GRAVITY = 9.80665;
export const MM_TO_M = 0.001;
export const M_TO_MM = 1000;

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  payloadKg: 0.25,
  safetyFactor: 2,
  targetSpeedDegS: 45
});

export const DEFAULT_ACTUATORS = Object.freeze([
  {
    id: "servo_20kg",
    name: "20 kg.cm servo",
    continuousTorqueNm: 1.25,
    peakTorqueNm: 1.96,
    maxSpeedDegS: 300,
    voltage: 6,
    massKg: 0.065,
    gearRatio: 1,
    efficiency: 0.72,
    notes: "Common hobby-class baseline."
  },
  {
    id: "servo_35kg",
    name: "35 kg.cm servo",
    continuousTorqueNm: 2.2,
    peakTorqueNm: 3.43,
    maxSpeedDegS: 240,
    voltage: 7.4,
    massKg: 0.09,
    gearRatio: 1,
    efficiency: 0.74,
    notes: "Higher torque metal gear servo."
  },
  {
    id: "nema17_5to1",
    name: "NEMA 17 + 5:1",
    continuousTorqueNm: 2.7,
    peakTorqueNm: 4.2,
    maxSpeedDegS: 180,
    voltage: 24,
    massKg: 0.42,
    gearRatio: 5,
    efficiency: 0.68,
    notes: "Stepper with modest reduction."
  },
  {
    id: "harmonic_14nm",
    name: "BLDC harmonic 14 N.m",
    continuousTorqueNm: 8.5,
    peakTorqueNm: 14,
    maxSpeedDegS: 120,
    voltage: 24,
    massKg: 0.78,
    gearRatio: 50,
    efficiency: 0.78,
    notes: "Compact actuator-class joint module."
  }
]);

export const PROXY_TYPES = Object.freeze(["box", "sphere", "capsule", "cylinder"]);
