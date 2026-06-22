import assert from "node:assert/strict";
import test from "node:test";

import { applyStarterTemplate, createCircuitLabProject, connectTerminals, removeConnection } from "../src/circuits/model.js";
import { normalizeActuator } from "../src/physics/actuators.js";
import {
  createMechatronicsBinding,
  normalizeMechatronicsBinding,
  parseMechatronicsBindingJson,
  serializeMechatronicsBinding
} from "../src/mechatronics/model.js";
import { evaluateMechatronicsReadiness } from "../src/mechatronics/readiness.js";
import { resolveFirmwareChannelCommand } from "../src/mechatronics/runtimeBridge.js";
import { previewMechatronicsBindingSuggestions } from "../src/mechatronics/suggestions.js";
import { validateMechatronicsBinding } from "../src/mechatronics/validation.js";

function robotDesign(overrides = {}) {
  return {
    version: 1,
    units: "mm",
    joints: [
      { id: "shoulder", name: "Shoulder", type: "revolute", actuatorId: "servo_1", min: -90, max: 90 },
      { id: "fixed_base", name: "Fixed base", type: "fixed", actuatorId: null, min: 0, max: 0 }
    ],
    actuators: [
      {
        id: "servo_1",
        name: "Shoulder servo",
        voltage: 6,
        interface: { actuatorClass: "hobby-servo", commandMode: "position" }
      }
    ],
    sensors: [
      {
        id: "distance_1",
        name: "Distance sensor",
        interface: { sensorClass: "ultrasonic", measurement: "distance", valueType: "number", units: "mm" }
      }
    ],
    pose: { jointAngles: { shoulder: 0 } },
    ...overrides
  };
}

function servoBinding(overrides = {}) {
  return normalizeMechatronicsBinding({
    actuatorBindings: [
      {
        id: "shoulder_binding",
        jointId: "shoulder",
        actuatorId: "servo_1",
        circuitComponentId: "servo",
        firmwareChannelIds: ["servo_signal"],
        commandTransform: { invert: true, scale: 2, offset: 5 }
      }
    ],
    firmwareChannels: [
      {
        id: "servo_signal",
        semanticRole: "joint.command.position",
        direction: "controller-to-device",
        signalType: "servo-pulse",
        valueType: "number",
        controllerTerminalRef: { componentId: "arduino", terminalId: "D9" },
        deviceTerminalRef: { componentId: "servo", terminalId: "signal" }
      }
    ],
    ...overrides
  }, { now: "2026-06-18T12:00:00.000Z" });
}

test("MechatronicsBinding normalization is strict and preserves dangling references", () => {
  const binding = normalizeMechatronicsBinding({
    version: 1,
    actuatorBindings: [
      {
        id: "b1",
        jointId: "missing_joint",
        actuatorId: "missing_actuator",
        circuitComponentId: "missing_component",
        firmwareChannelIds: ["missing_channel"],
        commandTransform: { invert: true, scale: "2", offset: "3" },
        generatedSource: "do not persist"
      }
    ],
    firmwareChannels: [
      {
        id: "ch1",
        semanticRole: "joint.command.position",
        direction: "controller-to-device",
        signalType: "servo-pulse",
        valueType: "number",
        controllerTerminalRef: { componentId: "arduino", terminalId: "D9", x: 10 },
        deviceTerminalRef: { componentId: "servo", terminalId: "signal" },
        localPath: "C:\\secret\\file.txt",
        file_id: "vendor-file"
      }
    ],
    uiSelection: { x: 1 },
    pinMapCsv: "generated"
  });

  assert.deepEqual(Object.keys(binding).sort(), ["actuatorBindings", "firmwareChannels", "kind", "sensorBindings", "updatedAt", "version"].sort());
  assert.equal(binding.actuatorBindings[0].jointId, "missing_joint");
  assert.equal(binding.actuatorBindings[0].generatedSource, undefined);
  assert.equal(binding.firmwareChannels[0].localPath, undefined);
  assert.deepEqual(binding.firmwareChannels[0].controllerTerminalRef, { componentId: "arduino", terminalId: "D9" });
  assert.throws(() => parseMechatronicsBindingJson(JSON.stringify({ version: 2 })), /version 1/);
  assert.equal(createMechatronicsBinding({ now: "now" }).updatedAt, "now");
});

test("Mechatronics validation accepts a complete servo binding and resolves semantic command transforms", () => {
  const project = createCircuitLabProject();
  const binding = servoBinding();
  const validation = validateMechatronicsBinding({ robotDesign: robotDesign(), circuitLabProject: project, binding });

  assert.equal(validation.ok, true);
  assert.equal(validation.coverage.boundActuators, 1);
  assert.equal(validation.coverage.eligibleActuators, 1);
  assert.equal(validation.coverage.validChannels, 1);

  const command = resolveFirmwareChannelCommand({
    robotDesign: robotDesign(),
    circuitLabProject: project,
    mechatronicsBinding: binding,
    channelId: "servo_signal",
    value: 10
  });
  assert.deepEqual(command, {
    ok: true,
    type: "joint-command",
    jointId: "shoulder",
    channelId: "servo_signal",
    command: "position",
    value: -25
  });

  const clamped = resolveFirmwareChannelCommand({
    robotDesign: robotDesign(),
    circuitLabProject: project,
    mechatronicsBinding: binding,
    channelId: "servo_signal",
    value: 100
  });
  assert.equal(clamped.value, -90);
});

test("Mechatronics validation reports stale references, fixed joints, and actuator mismatches", () => {
  const project = createCircuitLabProject();
  const binding = servoBinding({
    actuatorBindings: [
      {
        id: "bad_binding",
        jointId: "fixed_base",
        actuatorId: "missing_actuator",
        circuitComponentId: "missing_component",
        firmwareChannelIds: ["missing_channel"]
      }
    ]
  });

  const validation = validateMechatronicsBinding({ robotDesign: robotDesign(), circuitLabProject: project, binding });
  const codes = validation.diagnostics.map((item) => item.code);
  assert.equal(validation.ok, false);
  assert.equal(codes.includes("fixed-joint-binding"), true);
  assert.equal(codes.includes("missing-actuator"), true);
  assert.equal(codes.includes("missing-circuit-component"), true);
  assert.equal(codes.includes("missing-firmware-channel"), true);
});

test("Mechatronics validation catches pin capability, terminal collisions, and disconnected channels", () => {
  const project = createCircuitLabProject();
  const binding = servoBinding({
    firmwareChannels: [
      {
        id: "bad_servo",
        semanticRole: "joint.command.position",
        direction: "controller-to-device",
        signalType: "servo-pulse",
        valueType: "number",
        controllerTerminalRef: { componentId: "arduino", terminalId: "D0" },
        deviceTerminalRef: { componentId: "servo", terminalId: "signal" }
      },
      {
        id: "duplicate_pin",
        semanticRole: "joint.command.velocity",
        direction: "controller-to-device",
        signalType: "digital",
        valueType: "number",
        controllerTerminalRef: { componentId: "arduino", terminalId: "D0" },
        deviceTerminalRef: { componentId: "servo", terminalId: "signal" }
      }
    ],
    actuatorBindings: [
      {
        id: "shoulder_binding",
        jointId: "shoulder",
        actuatorId: "servo_1",
        circuitComponentId: "servo",
        firmwareChannelIds: ["bad_servo", "duplicate_pin"]
      }
    ]
  });

  const validation = validateMechatronicsBinding({ robotDesign: robotDesign(), circuitLabProject: project, binding });
  const codes = validation.diagnostics.map((item) => item.code);
  assert.equal(codes.includes("pin-capability-mismatch"), true);
  assert.equal(codes.includes("controller-terminal-collision"), true);
  assert.equal(codes.includes("channel-terminals-disconnected"), true);
});

test("Mechatronics validation blocks unsafe electrical state and direct bare motor paths", () => {
  let unsafeServo = createCircuitLabProject();
  unsafeServo = removeConnection(unsafeServo, "power_to_breadboard");
  unsafeServo = removeConnection(unsafeServo, "servo_power");
  unsafeServo = connectTerminals(unsafeServo, { componentId: "arduino", terminalId: "5V" }, { componentId: "servo", terminalId: "vplus" });
  assert.equal(
    validateMechatronicsBinding({ robotDesign: robotDesign(), circuitLabProject: unsafeServo, binding: servoBinding() })
      .diagnostics.some((item) => item.code === "bound-component-electrical-blocked"),
    true
  );

  let motorProject = createCircuitLabProject();
  motorProject = removeConnection(motorProject, "servo_signal");
  motorProject = removeConnection(motorProject, "servo_power");
  motorProject = connectTerminals(motorProject, { componentId: "arduino", terminalId: "D9" }, { componentId: "servo", terminalId: "vplus" });
  assert.equal(validateMechatronicsBinding({ robotDesign: robotDesign(), circuitLabProject: motorProject, binding: servoBinding() }).ok, false);
});

test("Mechatronics readiness separates electrical and binding status", () => {
  const project = createCircuitLabProject();
  const actuatorOnlyRobot = robotDesign({ sensors: [] });
  const ready = evaluateMechatronicsReadiness({ robotDesign: actuatorOnlyRobot, circuitLabProject: project, mechatronicsBinding: servoBinding() });
  assert.equal(ready.binding.status, "ready");
  assert.equal(ready.semanticRunAllowed, true);

  const absent = evaluateMechatronicsReadiness({ robotDesign: actuatorOnlyRobot, circuitLabProject: project, mechatronicsBinding: null });
  assert.equal(absent.binding.status, "absent");
  assert.equal(absent.semanticRunAllowed, false);
});

test("Mechatronics binding suggestions use stable circuit and robot ids", () => {
  const result = previewMechatronicsBindingSuggestions({
    robotDesign: robotDesign({ sensors: [] }),
    circuitLabProject: createCircuitLabProject(),
    mechatronicsBinding: null
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestedActuatorBindings.length, 1);
  assert.equal(result.suggestedActuatorBindings[0].jointId, "shoulder");
  assert.equal(result.suggestedActuatorBindings[0].actuatorId, "servo_1");
  assert.equal(result.suggestedActuatorBindings[0].circuitComponentId, "servo");
  assert.equal(result.suggestedFirmwareChannels[0].controllerTerminalRef.componentId, "arduino");
  assert.equal(result.suggestedFirmwareChannels[0].deviceTerminalRef.componentId, "servo");
  assert.match(result.suggestedFirmwareChannels[0].id, /^[A-Za-z0-9_.:-]+$/);
});

test("Mechatronics binding suggestions do not map robot sensors to LEDs", () => {
  const result = previewMechatronicsBindingSuggestions({
    robotDesign: robotDesign({
      joints: [],
      actuators: [],
      sensors: [
        {
          id: "mode_button",
          name: "Mode button",
          interface: { sensorClass: "button", measurement: "digital", valueType: "boolean" }
        }
      ]
    }),
    circuitLabProject: applyStarterTemplate(createCircuitLabProject(), "esp32_led_button"),
    mechatronicsBinding: null
  });

  assert.equal(result.ok, true);
  assert.equal(result.candidateSensorComponents.some((component) => component.componentId === "led"), false);
  assert.equal(result.candidateSensorComponents.some((component) => component.componentId === "button"), true);
  assert.equal(result.suggestedSensorBindings[0].circuitComponentId, "button");
});

test("Robot actuator semantic interface metadata normalizes without circuit fields", () => {
  const actuator = normalizeActuator({
    id: "drive",
    voltage: 6,
    interface: { actuatorClass: "dc-motor", commandMode: "pwm-direction", terminalId: "D5" }
  });

  assert.deepEqual(actuator.interface, { actuatorClass: "dc-motor", commandMode: "pwm-direction" });
  assert.equal(actuator.interface.terminalId, undefined);
});
