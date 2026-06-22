import { evaluateActuators } from "../physics/actuators.js";
import { checkCollisionProxies } from "../physics/collision.js";
import { analyzeTopology, computeForwardKinematics, getEndEffectorPosition, getJointAngle } from "../physics/kinematics.js";
import { baseStability, computeMassProperties, estimateJointLoads } from "../physics/mass.js";

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 3) {
  return Number(finiteNumber(value).toFixed(digits));
}

function roundVector(values, digits = 3) {
  return (values ?? [0, 0, 0]).map((value) => round(value, digits));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function analysisForDesign(design, transforms = computeForwardKinematics(design)) {
  const payloadKg = finiteNumber(design.assumptions?.payloadKg, 0);
  const collisions = checkCollisionProxies(design, transforms);
  const mass = computeMassProperties(design, transforms, payloadKg);
  const loads = estimateJointLoads(design, transforms, design.assumptions);
  const actuatorResults = evaluateActuators(design, loads);
  const stability = baseStability(design, mass);
  const topology = analyzeTopology(design);
  return { collisions, mass, loads, actuatorResults, stability, topology };
}

export function forwardKinematicsTable(design, transforms = computeForwardKinematics(design)) {
  return (design.links ?? []).map((link) => {
    const matrix = transforms.get(link.id);
    const position = matrix ? [matrix.elements[12], matrix.elements[13], matrix.elements[14]] : [0, 0, 0];
    return {
      linkId: link.id,
      linkName: link.name,
      positionMm: roundVector(position, 2)
    };
  });
}

export function jointStateTable(design) {
  return (design.joints ?? []).map((joint) => ({
    jointId: joint.id,
    jointName: joint.name,
    type: joint.type,
    value: round(getJointAngle(design, joint.id), 2),
    min: joint.min,
    max: joint.max,
    actuatorId: joint.actuatorId ?? null
  }));
}

export function createExperimentRun(input = {}) {
  const design = input.design;
  if (!design) throw new Error("Experiment runs require a RobotDesign.");
  const transforms = input.transforms ?? computeForwardKinematics(design);
  const analysis = input.analysis ?? analysisForDesign(design, transforms);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const runIndex = Number.isInteger(input.runIndex) ? input.runIndex : 0;
  const timestampId = createdAt.replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "");
  const effector = input.effectorId
    ? design.endEffectors?.find((item) => item.id === input.effectorId)
    : design.endEffectors?.[0];
  const toolPosition = effector ? getEndEffectorPosition(design, effector.id, transforms).toArray() : [0, 0, 0];
  const actuatorRisks = analysis.actuatorResults?.filter((item) => item.state === "risk").length ?? 0;
  const actuatorWarnings = analysis.actuatorResults?.filter((item) => item.state === "warn").length ?? 0;

  return {
    version: 1,
    id: input.id ?? `run_${String(runIndex + 1).padStart(3, "0")}_${timestampId}`,
    label: input.label ?? `Run ${runIndex + 1}`,
    createdAt,
    designVersion: design.version,
    assumptions: { ...(design.assumptions ?? {}) },
    pose: JSON.parse(JSON.stringify(design.pose ?? { jointAngles: {} })),
    simulation: {
      status: input.simulation?.status ?? "not initialized",
      steps: input.simulation?.steps ?? 0,
      timestep: input.simulation?.timestep ?? null,
      gravityEnabled: input.simulation?.gravityEnabled ?? true
    },
    metrics: {
      totalMassKg: analysis.mass?.totalMassKg ?? null,
      centerOfMass: analysis.mass?.centerOfMass ?? null,
      stabilityMarginMm: analysis.stability?.marginMm ?? null,
      collisionCount: analysis.collisions?.length ?? 0,
      actuatorRisks,
      actuatorWarnings,
      ikOk: input.ikResult?.ok ?? null,
      ikErrorMm: input.ikResult?.errorMm ?? null,
      toolPositionMm: roundVector(toolPosition, 2)
    },
    fkTable: forwardKinematicsTable(design, transforms),
    jointTable: jointStateTable(design),
    actuatorMargins: analysis.actuatorResults ?? []
  };
}

export function serializeExperimentRunsCsv(runs = []) {
  const header = [
    "id",
    "label",
    "createdAt",
    "totalMassKg",
    "comXmm",
    "comYmm",
    "comZmm",
    "stabilityMarginMm",
    "collisionCount",
    "actuatorRisks",
    "actuatorWarnings",
    "ikOk",
    "ikErrorMm",
    "toolXmm",
    "toolYmm",
    "toolZmm",
    "simulationStatus",
    "simulationSteps"
  ];
  const rows = runs.map((run) => {
    const com = run.metrics?.centerOfMass ?? [];
    const tool = run.metrics?.toolPositionMm ?? [];
    return [
      run.id,
      run.label,
      run.createdAt,
      run.metrics?.totalMassKg,
      com[0],
      com[1],
      com[2],
      run.metrics?.stabilityMarginMm,
      run.metrics?.collisionCount,
      run.metrics?.actuatorRisks,
      run.metrics?.actuatorWarnings,
      run.metrics?.ikOk,
      run.metrics?.ikErrorMm,
      tool[0],
      tool[1],
      tool[2],
      run.simulation?.status,
      run.simulation?.steps
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

export function sampleWorkspace(design, effectorId = design.endEffectors?.[0]?.id, options = {}) {
  const movable = (design.joints ?? []).filter((joint) => joint.type === "revolute" || joint.type === "prismatic");
  const samples = [];
  const baseAngles = { ...(design.pose?.jointAngles ?? {}) };
  const valuesForJoint = (joint) => {
    const min = finiteNumber(joint.min, 0);
    const max = finiteNumber(joint.max, min);
    const midpoint = (min + max) / 2;
    return [min, midpoint, max].slice(0, Math.max(1, options.valuesPerJoint ?? 3));
  };

  for (const joint of movable) {
    for (const value of valuesForJoint(joint)) {
      const pose = { jointAngles: { ...baseAngles, [joint.id]: value } };
      const transforms = computeForwardKinematics(design, pose);
      const point = getEndEffectorPosition(design, effectorId, transforms).toArray();
      samples.push({ jointId: joint.id, value: round(value, 2), positionMm: roundVector(point, 2) });
    }
  }

  const axes = [0, 1, 2].map((axis) => samples.map((sample) => sample.positionMm[axis]));
  return {
    sampleCount: samples.length,
    samples,
    bounds: samples.length
      ? {
          min: axes.map((values) => round(Math.min(...values), 2)),
          max: axes.map((values) => round(Math.max(...values), 2))
        }
      : { min: [0, 0, 0], max: [0, 0, 0] }
  };
}

export function interpolateTrajectory(keyframes = [], options = {}) {
  const sorted = [...keyframes].sort((a, b) => finiteNumber(a.timeS, 0) - finiteNumber(b.timeS, 0));
  if (sorted.length < 2) return sorted.map((frame) => ({ ...frame, jointAngles: { ...(frame.jointAngles ?? {}) } }));
  const samplesPerSegment = Math.max(2, options.samplesPerSegment ?? 8);
  const result = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    const jointIds = new Set([...Object.keys(start.jointAngles ?? {}), ...Object.keys(end.jointAngles ?? {})]);
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const alpha = step / samplesPerSegment;
      const jointAngles = {};
      for (const jointId of jointIds) {
        const a = finiteNumber(start.jointAngles?.[jointId], 0);
        const b = finiteNumber(end.jointAngles?.[jointId], a);
        jointAngles[jointId] = round(a + (b - a) * alpha, 3);
      }
      result.push({
        timeS: round(finiteNumber(start.timeS, 0) + (finiteNumber(end.timeS, 0) - finiteNumber(start.timeS, 0)) * alpha, 3),
        jointAngles
      });
    }
  }
  result.push({ ...sorted.at(-1), jointAngles: { ...(sorted.at(-1).jointAngles ?? {}) } });
  return result;
}

export function simulatePidResponse(options = {}) {
  const target = finiteNumber(options.target, 90);
  const dt = Math.max(0.001, finiteNumber(options.dt, 0.02));
  const durationS = Math.max(dt, finiteNumber(options.durationS, 2));
  const kp = Math.max(0, finiteNumber(options.kp, 5));
  const ki = Math.max(0, finiteNumber(options.ki, 0));
  const kd = Math.max(0, finiteNumber(options.kd, 0.4));
  const damping = Math.max(0, finiteNumber(options.damping, 2.5));
  let position = finiteNumber(options.initial, 0);
  let velocity = 0;
  let integral = 0;
  let previousError = target - position;
  const samples = [];

  for (let time = 0; time <= durationS + 1e-9; time += dt) {
    const error = target - position;
    integral += error * dt;
    const derivative = (error - previousError) / dt;
    const command = kp * error + ki * integral + kd * derivative;
    const acceleration = command - damping * velocity;
    velocity += acceleration * dt;
    position += velocity * dt;
    previousError = error;
    samples.push({
      timeS: round(time, 3),
      target: round(target, 3),
      position: round(position, 3),
      error: round(target - position, 3),
      command: round(command, 3)
    });
  }

  const maxPosition = Math.max(...samples.map((sample) => sample.position));
  const overshoot = Math.max(0, maxPosition - target);
  const tolerance = Math.max(1, Math.abs(target) * 0.02);
  const settlingSample = samples.find((sample, index) =>
    samples.slice(index).every((next) => Math.abs(next.error) <= tolerance)
  );
  return {
    options: { target, dt, durationS, kp, ki, kd, damping },
    samples,
    metrics: {
      overshoot: round(overshoot, 3),
      steadyStateError: samples.length ? round(samples.at(-1).error, 3) : target,
      settlingTimeS: settlingSample ? settlingSample.timeS : null
    }
  };
}

export function createFabricationReadiness(design, partRecords = []) {
  const generatedParts = partRecords.filter((part) => part.type === "generated" || part.source === "part-studio");
  const missingFiles = partRecords.filter((part) => !part.file);
  const actuatorIds = new Set((design.joints ?? []).map((joint) => joint.actuatorId).filter(Boolean));
  const warnings = [];
  if (missingFiles.length) warnings.push(`${missingFiles.length} visual parts do not have standalone STL filenames.`);
  if ((design.links ?? []).some((link) => !(link.massKg > 0))) warnings.push("Some links need positive mass before fabrication review.");
  if ((design.joints ?? []).some((joint) => joint.type !== "fixed" && !joint.actuatorId)) warnings.push("Some movable joints have no actuator assignment.");
  return {
    partCount: partRecords.length,
    generatedPartCount: generatedParts.length,
    missingFileCount: missingFiles.length,
    actuatorCount: actuatorIds.size,
    bom: [
      ...partRecords.map((part) => ({ type: "part", id: part.id, name: part.name ?? part.label ?? part.id, quantity: 1 })),
      ...[...actuatorIds].map((id) => ({ type: "actuator", id, name: design.actuators?.find((item) => item.id === id)?.name ?? id, quantity: 1 }))
    ],
    warnings
  };
}
