function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeActuatorInterface(value = {}) {
  if (!value || typeof value !== "object") return null;
  const actuatorClass = ["hobby-servo", "dc-motor", "stepper", "bldc", "linear", "generic"].includes(value.actuatorClass)
    ? value.actuatorClass
    : "generic";
  const commandMode = ["position", "velocity", "pwm-direction", "step-direction", "generic"].includes(value.commandMode)
    ? value.commandMode
    : "generic";
  return { actuatorClass, commandMode };
}

export function normalizeActuator(actuator = {}, fallbackId = "actuator") {
  const continuousTorqueNm = Math.max(0, finiteNumber(actuator.continuousTorqueNm, 0));
  const peakTorqueNm = Math.max(continuousTorqueNm, finiteNumber(actuator.peakTorqueNm, continuousTorqueNm));
  const normalized = {
    id: String(actuator.id ?? fallbackId),
    name: String(actuator.name ?? actuator.id ?? fallbackId),
    continuousTorqueNm,
    peakTorqueNm,
    maxSpeedDegS: Math.max(1, finiteNumber(actuator.maxSpeedDegS, 1)),
    voltage: Math.max(0, finiteNumber(actuator.voltage, 0)),
    massKg: Math.max(0, finiteNumber(actuator.massKg, 0)),
    gearRatio: Math.max(1, finiteNumber(actuator.gearRatio, 1)),
    efficiency: Math.min(1, Math.max(0.01, finiteNumber(actuator.efficiency, 0.7))),
    notes: String(actuator.notes ?? "")
  };
  const semanticInterface = normalizeActuatorInterface(actuator.interface);
  if (semanticInterface) normalized.interface = semanticInterface;
  return normalized;
}

export function evaluateActuators(design, jointLoads) {
  const actuators = new Map((design.actuators ?? []).map((actuator) => [actuator.id, actuator]));
  const targetSpeedDegS = Math.max(1, finiteNumber(design.assumptions?.targetSpeedDegS, 45));

  return jointLoads.map((load) => {
    const joint = design.joints.find((item) => item.id === load.jointId);
    const actuator = actuators.get(joint?.actuatorId);
    if (!joint || joint.type === "fixed") {
      return { ...load, targetSpeedDegS, state: "ok", message: "Fixed joint does not require an actuator." };
    }

    if (!actuator) {
      return { ...load, targetSpeedDegS, state: "warn", message: "No actuator assigned." };
    }

    const continuousMargin = actuator.continuousTorqueNm / Math.max(0.001, load.recommendedTorqueNm);
    const peakMargin = actuator.peakTorqueNm / Math.max(0.001, load.recommendedTorqueNm);
    const speedMargin = actuator.maxSpeedDegS / targetSpeedDegS;
    const state = continuousMargin < 1 || peakMargin < 1 ? "risk" : continuousMargin < 1.35 || peakMargin < 1.15 || speedMargin < 1 ? "warn" : "ok";
    const message =
      state === "risk"
        ? `${actuator.name} is undersized for the recommended torque.`
        : state === "warn"
          ? `${actuator.name} has limited torque or speed margin.`
          : `${actuator.name} has practical torque margin.`;

    return {
      ...load,
      actuatorId: actuator.id,
      actuatorName: actuator.name,
      continuousTorqueNm: actuator.continuousTorqueNm,
      peakTorqueNm: actuator.peakTorqueNm,
      continuousMargin: Number(continuousMargin.toFixed(2)),
      peakMargin: Number(peakMargin.toFixed(2)),
      speedMargin: Number(speedMargin.toFixed(2)),
      targetSpeedDegS,
      state,
      message
    };
  });
}

export function upsertActuator(design, actuator) {
  design.actuators ??= [];
  const next = normalizeActuator(actuator);
  const index = design.actuators.findIndex((item) => item.id === next.id);
  if (index >= 0) design.actuators[index] = next;
  else design.actuators.push(next);
  return next;
}

export function deleteActuator(design, actuatorId) {
  const before = design.actuators?.length ?? 0;
  design.actuators = (design.actuators ?? []).filter((item) => item.id !== actuatorId);
  for (const joint of design.joints ?? []) {
    if (joint.actuatorId === actuatorId) joint.actuatorId = null;
  }
  return design.actuators.length !== before;
}
