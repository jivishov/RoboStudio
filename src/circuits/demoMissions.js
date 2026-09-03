import { circuitDesignRevision } from "./designRevision.js";
import {
  connectTerminals,
  createCircuitLabProject,
  normalizeProject,
  removeConnection
} from "./model.js";
import { runCircuitLabTest } from "./testBench.js";

export const SERVO_REPAIR_MISSION_ID = "servo-repair-v1";
export const SERVO_REPAIR_SCENARIO_VERSION = 1;
export const SERVO_REPAIR_TOOLSET_VERSION = 1;
export const SERVO_REPAIR_RUBRIC_VERSION = 2;
export const SERVO_REPAIR_FIXED_TIME = "2026-08-25T12:00:00.000Z";
export const SERVO_REPAIR_PROMPT = "Diagnose and repair this servo circuit. Preserve Arduino D9 as the servo signal. Use the external 6 V supply for servo power and establish a common ground with the Arduino. Explain the detected problems before modifying the circuit. After repair, rerun the circuit test and report remaining warnings and build evidence. Do not claim that RoboStudio compiled, flashed, physically tested, or certified the circuit.";

export const SERVO_REPAIR_REQUIRED_COMPONENTS = Object.freeze({
  arduino: "controller-arduino-uno-r3",
  breadboard: "breadboard-bb400-400",
  supply: "supply-servo-6v",
  servo: "servo-standard"
});

function requireConnection(project, connectionId) {
  if (!project.connections.some((connection) => connection.id === connectionId)) {
    throw new Error(`Servo repair mission cannot be built: missing starter connection ${connectionId}.`);
  }
}

export function createServoRepairMission(options = {}) {
  const now = options.now ?? SERVO_REPAIR_FIXED_TIME;
  let project = createCircuitLabProject({ now });
  for (const id of ["power_to_breadboard", "ground_to_breadboard", "servo_power", "servo_ground", "servo_signal"]) {
    requireConnection(project, id);
  }
  project = removeConnection(project, "ground_to_breadboard", { now });
  project = removeConnection(project, "servo_power", { now });
  project = connectTerminals(
    project,
    { componentId: "supply", terminalId: "GND" },
    { componentId: "breadboard", terminalId: "bn1" },
    { id: "supply_ground_to_breadboard", name: "External supply ground to breadboard", color: "#111827", now }
  );
  project = connectTerminals(
    project,
    { componentId: "arduino", terminalId: "5V" },
    { componentId: "servo", terminalId: "vplus" },
    { id: "unsafe_servo_power", name: "Unsafe Arduino 5V to servo power", color: "#dc2626", now }
  );
  project = normalizeProject({
    ...project,
    name: "WebMCP Servo Repair Mission",
    mode: "select",
    selectedComponentId: "servo",
    selectedConnectionId: null,
    app: { kind: SERVO_REPAIR_MISSION_ID, notes: "" },
    updatedAt: now
  }, { now });

  const test = runCircuitLabTest(project);
  const codes = new Set(test.issues.map((issue) => issue.code));
  for (const requiredCode of ["servo-controller-power", "missing-common-ground"]) {
    if (!codes.has(requiredCode)) throw new Error(`Servo repair mission initial DRC is missing ${requiredCode}.`);
  }
  const signal = project.connections.find((connection) => connection.id === "servo_signal");
  const signalKeys = new Set((signal?.endpoints ?? []).map((endpoint) => `${endpoint.componentId}:${endpoint.terminalId}`));
  if (!signalKeys.has("arduino:D9") || !signalKeys.has("servo:signal")) {
    throw new Error("Servo repair mission must preserve Arduino D9 -> servo.signal.");
  }
  return project;
}

export function servoRepairMissionMetadata(options = {}) {
  const project = createServoRepairMission(options);
  return {
    id: SERVO_REPAIR_MISSION_ID,
    scenarioVersion: SERVO_REPAIR_SCENARIO_VERSION,
    toolsetVersion: SERVO_REPAIR_TOOLSET_VERSION,
    rubricVersion: SERVO_REPAIR_RUBRIC_VERSION,
    prompt: SERVO_REPAIR_PROMPT,
    initialRevision: circuitDesignRevision(project),
    requiredComponents: { ...SERVO_REPAIR_REQUIRED_COMPONENTS }
  };
}
