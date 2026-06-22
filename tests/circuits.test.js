import assert from "node:assert/strict";
import test from "node:test";

import { createCircuitBuildGuideZip } from "../src/circuits/artifactZip.js";
import { buildCircuitArtifacts } from "../src/circuits/artifacts.js";
import { findConnectedTerminals, resolveTerminal } from "../src/circuits/connectivity.js";
import { generateCircuitLabSource } from "../src/circuits/codegen.js";
import { catalog } from "../src/circuits/catalog.js";
import { evaluateCircuitReadiness } from "../src/circuits/readiness.js";
import { physicalCatalog } from "../src/circuits/physicalCatalog.js";
import {
  MAX_COMPONENT_SCALE,
  MIN_COMPONENT_SCALE,
  clampComponentPosition,
  componentBounds,
  normalizeComponentRotation
} from "../src/circuits/geometry.js";
import {
  insertComponentIntoNearestTerminals,
  rematchDirectInsertionConnections,
  terminalInsertionRole,
  terminalsCanInsert
} from "../src/circuits/insertion.js";
import {
  addComponent,
  applyStarterTemplate,
  connectTerminals,
  createCircuitLabProject,
  normalizeProject,
  parseCircuitLabProjectJson,
  removeConnection,
  updateComponent
} from "../src/circuits/model.js";
import { runCircuitLabTest } from "../src/circuits/testBench.js";

const ROBOTICS_COMPONENT_WAVE_IDS = Object.freeze([
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

test("Circuit Lab default servo starter uses external power and common ground", () => {
  const project = createCircuitLabProject({ now: "2026-06-09T12:00:00.000Z" });
  const result = runCircuitLabTest(project);
  const source = generateCircuitLabSource(project);

  assert.equal(project.kind, "CircuitLabProject");
  assert.equal(project.units, "mm");
  assert.equal(project.updatedAt, "2026-06-09T12:00:00.000Z");
  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.issues.some((item) => item.code === "generic-rating-review"), true);
  assert.equal(result.ok, true);
  assert.equal(source.target, "arduino");
  assert.match(source.files.find((file) => file.path.endsWith(".ino")).content, /Servo servo1;/);
  assert.match(source.files.find((file) => file.path.endsWith(".ino")).content, /SERVO_1_PIN = 9/);
});

test("breadboard rail topology connects supply power to servo through rail buses", () => {
  const project = createCircuitLabProject();
  const linked = findConnectedTerminals(project, { componentId: "supply", terminalId: "VPLUS" });

  assert.equal(linked.some((terminal) => terminal.endpoint.componentId === "servo" && terminal.endpoint.terminalId === "vplus"), true);
  assert.equal(linked.some((terminal) => terminal.endpoint.componentId === "breadboard" && terminal.endpoint.terminalId === "bp5"), true);
});

test("Circuit Lab flags unsafe servo power from controller 5V", () => {
  let project = createCircuitLabProject();
  for (const connectionId of ["power_to_breadboard", "servo_power"]) {
    project = removeConnection(project, connectionId, { now: "2026-06-09T12:00:00.000Z" });
  }
  project = connectTerminals(
    project,
    { componentId: "arduino", terminalId: "5V" },
    { componentId: "servo", terminalId: "vplus" },
    { id: "unsafe_servo_power", name: "Unsafe servo power" }
  );

  const result = runCircuitLabTest(project);
  assert.equal(result.issues.some((item) => item.code === "servo-controller-power"), true);
  assert.equal(result.ok, false);
});

test("Circuit Lab catches direct LED wiring without a resistor", () => {
  let project = applyStarterTemplate(createCircuitLabProject(), "esp32_led_button");
  project = removeConnection(project, "gpio_led_resistor");
  project = removeConnection(project, "resistor_led");
  project = connectTerminals(
    project,
    { componentId: "esp32", terminalId: "GPIO16" },
    { componentId: "led", terminalId: "anode" },
    { id: "direct_led", name: "Direct LED" }
  );

  const result = runCircuitLabTest(project);
  assert.equal(result.issues.some((item) => item.code === "led-missing-resistor"), true);
});

test("ESP32 starter generates source-only ESP-IDF files", () => {
  const project = applyStarterTemplate(createCircuitLabProject(), "esp32_led_button");
  const source = generateCircuitLabSource(project);
  const result = runCircuitLabTest(project);

  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.warnings, 0);
  assert.equal(source.target, "espidf");
  assert.equal(source.files.some((file) => file.path === "main/app_main.c"), true);
  assert.match(source.files.find((file) => file.path === "main/app_main.c").content, /GPIO_NUM_16/);
  assert.match(source.files.find((file) => file.path === "main/app_main.c").content, /GPIO_NUM_17/);
  assert.match(source.files.find((file) => file.path === "README.md").content, /source-only/i);
  assert.match(source.files.find((file) => file.path === "README.md").content, /not built, flashed, executed, or hardware-tested/i);
});

test("Circuit Lab rejects impossible terminal wires before mutating topology", () => {
  const project = createCircuitLabProject();

  assert.throws(
    () => connectTerminals(project, { componentId: "arduino", terminalId: "D9" }, { componentId: "servo", terminalId: "missing" }),
    /Unknown terminal: servo\.missing/
  );
  assert.throws(
    () => connectTerminals(project, { componentId: "arduino", terminalId: "D9" }, { componentId: "arduino", terminalId: "D9" }),
    /two different terminals/
  );
});

test("Circuit Lab JSON import rejects explicit incompatible project headers", () => {
  assert.throws(
    () => parseCircuitLabProjectJson(JSON.stringify({ kind: "CircuitLabProject", version: 2, units: "mm", components: [], connections: [] })),
    /version 1/
  );
  assert.throws(
    () => parseCircuitLabProjectJson(JSON.stringify({ kind: "OtherProject", version: 1, units: "mm", components: [], connections: [] })),
    /kind CircuitLabProject/
  );
  assert.throws(
    () => parseCircuitLabProjectJson(JSON.stringify({ kind: "CircuitLabProject", version: 1, units: "inch", components: [], connections: [] })),
    /millimeters/
  );

  const legacy = parseCircuitLabProjectJson(JSON.stringify({
    components: [{ id: "arduino", typeId: "controller-arduino-uno-r3", position: [0, 0] }],
    connections: []
  }));
  assert.equal(legacy.kind, "CircuitLabProject");
  assert.equal(legacy.version, 1);
  assert.equal(legacy.units, "mm");
});

test("Circuit Lab scaled components keep terminals and bounds aligned", () => {
  let project = createCircuitLabProject();
  project = updateComponent(project, "servo", {
    props: { scale: 1.5 }
  });
  const servo = project.components.find((component) => component.id === "servo");
  const terminal = resolveTerminal(project, { componentId: "servo", terminalId: "signal" });
  const bounds = componentBounds(servo, { dimensions: [52, 28] });

  assert.equal(terminal.ok, true);
  assert.deepEqual(terminal.worldPosition, [125 + 26 * 1.5, 210 - 8 * 1.5]);
  assert.equal(bounds.width, 78);
  assert.equal(bounds.height, 42);
});

test("Circuit Lab normalizes equipment rotation and older projects default to zero", () => {
  let project = createCircuitLabProject();
  project = updateComponent(project, "servo", { rotation: 450 });
  assert.equal(project.components.find((component) => component.id === "servo").rotation, 90);

  project = updateComponent(project, "servo", { rotation: -15 });
  assert.equal(project.components.find((component) => component.id === "servo").rotation, 345);
  assert.equal(normalizeComponentRotation(360), 0);

  const older = normalizeProject({
    components: [{ id: "servo", typeId: "servo-standard", name: "Old servo", position: [100, 100] }],
    connections: []
  });
  assert.equal(older.components[0].rotation, 0);
});

test("Circuit Lab rotated terminals follow equipment center rotation", () => {
  let project = createCircuitLabProject();
  project = updateComponent(project, "servo", { rotation: 90 });
  let terminal = resolveTerminal(project, { componentId: "servo", terminalId: "signal" });
  assert.equal(terminal.ok, true);
  assert.deepEqual(terminal.worldPosition.map(Math.round), [133, 236]);

  project = updateComponent(project, "servo", { rotation: 180 });
  terminal = resolveTerminal(project, { componentId: "servo", terminalId: "signal" });
  assert.deepEqual(terminal.worldPosition.map(Math.round), [99, 218]);

  project = updateComponent(project, "servo", { rotation: 270 });
  terminal = resolveTerminal(project, { componentId: "servo", terminalId: "signal" });
  assert.deepEqual(terminal.worldPosition.map(Math.round), [117, 184]);
});

test("Circuit Lab rotated bounds and clamping keep equipment inside the bench", () => {
  const definition = catalog.getComponent("servo-standard");
  const component = {
    id: "servo",
    typeId: "servo-standard",
    name: "Servo",
    position: [125, 210],
    rotation: 90,
    props: { scale: 1 }
  };
  const bounds = componentBounds(component, definition);
  assert.equal(Math.round(bounds.width), 28);
  assert.equal(Math.round(bounds.height), 52);

  const position = clampComponentPosition(component, definition, [4, 4], 1, 90);
  const clampedBounds = componentBounds({ ...component, position }, definition);
  assert.equal(clampedBounds.left >= 5.99, true);
  assert.equal(clampedBounds.top >= 5.99, true);
});

test("Circuit Lab capacitor has two physical legs without an internal short", () => {
  let project = createCircuitLabProject();
  project = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  const definition = catalog.getComponent("capacitor-electrolytic-470uf");
  assert.deepEqual(definition.terminals.map((terminal) => terminal.id), ["pos", "neg"]);
  assert.deepEqual(definition.terminals.map((terminal) => terminal.position), [[0, 12], [0, 17.08]]);
  assert.equal(definition.internalBuses.length, 0);

  const linked = findConnectedTerminals(project, { componentId: "cap", terminalId: "pos" });
  assert.equal(linked.some((terminal) => terminal.endpoint.componentId === "cap" && terminal.endpoint.terminalId === "neg"), false);
});

test("Circuit Lab inserts capacitor legs into matching breadboard rail holes", () => {
  let project = createCircuitLabProject();
  project = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  project = updateComponent(project, "cap", { position: [487.78, 417.05] });

  const insertion = insertComponentIntoNearestTerminals(project, "cap");
  const insertedPairs = insertion.project.connections
    .filter((connection) => connection.id.startsWith("insert_cap_"))
    .map((connection) => connection.endpoints.map((endpoint) => `${endpoint.componentId}:${endpoint.terminalId}`).sort().join("|"));

  assert.equal(insertion.insertedCount, 2);
  assert.deepEqual(insertedPairs.sort(), [
    "breadboard:bn20|cap:neg",
    "breadboard:bp20|cap:pos"
  ]);
  assert.equal(findConnectedTerminals(insertion.project, { componentId: "cap", terminalId: "pos" })
    .some((terminal) => terminal.endpoint.componentId === "breadboard" && terminal.endpoint.terminalId === "bp20"), true);
  assert.equal(findConnectedTerminals(insertion.project, { componentId: "cap", terminalId: "pos" })
    .some((terminal) => terminal.endpoint.componentId === "breadboard" && terminal.endpoint.terminalId === "bn20"), false);
});

test("Circuit Lab keeps HC-SR04 wire-connected even when its header is near breadboard holes", () => {
  let project = createCircuitLabProject();
  project = addComponent(project, "ultrasonic-hcsr04", { id: "sonar" });
  const sensor = catalog.getComponent("ultrasonic-hcsr04");
  const vcc = sensor.terminals.find((terminal) => terminal.id === "VCC");
  const target = resolveTerminal(project, { componentId: "breadboard", terminalId: "r15f" });
  project = updateComponent(project, "sonar", {
    position: [
      target.worldPosition[0] - vcc.position[0],
      target.worldPosition[1] - vcc.position[1]
    ]
  });

  const insertion = insertComponentIntoNearestTerminals(project, "sonar");
  assert.equal(insertion.insertedCount, 0);
  assert.equal(insertion.project.connections.some((connection) => connection.kind === "direct-insertion"), false);
});

test("Circuit Lab rematches or detaches direct insertions after transform changes", () => {
  let project = createCircuitLabProject();
  project = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  project = updateComponent(project, "cap", { position: [487.78, 417.05] });
  const inserted = insertComponentIntoNearestTerminals(project, "cap").project;

  const rematched = rematchDirectInsertionConnections(inserted, "cap");
  assert.equal(rematched.rematched, true);
  assert.equal(rematched.insertedCount, 2);

  const scaled = updateComponent(inserted, "cap", { props: { scale: 1.2 } });
  const broken = rematchDirectInsertionConnections(scaled, "cap");
  assert.equal(broken.rematched, false);
  assert.equal(broken.detachedCount, 2);
  assert.equal(broken.project.connections.some((connection) => connection.kind === "direct-insertion"), false);
});

test("Circuit Lab insertion refuses reversed polarized rail holes", () => {
  const capacitor = catalog.getComponent("capacitor-electrolytic-470uf");
  const breadboard = catalog.getComponent("breadboard-400");
  const capPos = capacitor.terminals.find((terminal) => terminal.id === "pos");
  const capNeg = capacitor.terminals.find((terminal) => terminal.id === "neg");
  const positiveRail = breadboard.terminals.find((terminal) => terminal.id === "bp5");
  const groundRail = breadboard.terminals.find((terminal) => terminal.id === "bn5");

  assert.equal(terminalInsertionRole(capPos), "positive");
  assert.equal(terminalInsertionRole(capNeg), "negative");
  assert.equal(terminalsCanInsert(capPos, positiveRail), true);
  assert.equal(terminalsCanInsert(capNeg, groundRail), true);
  assert.equal(terminalsCanInsert(capPos, groundRail), false);
  assert.equal(terminalsCanInsert(capNeg, positiveRail), false);
});

test("Circuit Lab normalizes component resize scale to supported bounds", () => {
  let project = createCircuitLabProject();
  project = updateComponent(project, "servo", { props: { scale: 20 } });
  assert.equal(project.components.find((component) => component.id === "servo").props.scale, MAX_COMPONENT_SCALE);

  project = updateComponent(project, "servo", { props: { scale: 0.1 } });
  assert.equal(project.components.find((component) => component.id === "servo").props.scale, MIN_COMPONENT_SCALE);
});

test("Circuit Lab catalog exposes normalized engineering metadata without replacing legacy fields", () => {
  for (const definition of catalog.listComponents()) {
    assert.equal(definition.engineering.specificationBasis, "generic");
    const terminalIds = new Set(definition.terminals.map((terminal) => terminal.id));
    for (const terminal of definition.terminals) {
      assert.equal(typeof terminal.id, "string");
      assert.equal(terminal.id.length > 0, true);
      assert.equal(Array.isArray(terminal.capabilities), true);
      assert.equal(typeof terminal.capabilities.digitalInput, "boolean");
      assert.equal(typeof terminal.electricalRole, "string");
      if (terminal.connectorId) {
        assert.equal(definition.engineering.connectors.some((connector) => connector.id === terminal.connectorId), true);
      }
      if (terminal.voltageDomainId && terminal.voltageDomainId !== "ground") {
        assert.equal(definition.engineering.voltageDomains.some((domain) => domain.id === terminal.voltageDomainId), true);
      }
    }
    for (const connector of definition.engineering.connectors) {
      assert.equal(connector.terminalIds.every((terminalId) => terminalIds.has(terminalId)), true);
    }
  }

  const arduino = catalog.getComponent("controller-arduino-uno-r3");
  const d2 = arduino.terminals.find((terminal) => terminal.id === "D2");
  const d9 = arduino.terminals.find((terminal) => terminal.id === "D9");
  const a0 = arduino.terminals.find((terminal) => terminal.id === "A0");
  assert.equal(d2.pwm, false);
  assert.equal(d2.capabilities.servoPulse, true);
  assert.equal(d9.pwm, true);
  assert.equal(d9.capabilities.servoPulse, true);
  assert.equal(a0.capabilities.adc, true);
});

test("robotics component wave has usable physical connectors and conservative metadata", () => {
  for (const componentId of ROBOTICS_COMPONENT_WAVE_IDS) {
    const definition = catalog.getComponent(componentId);
    const physical = physicalCatalog[componentId];
    assert.ok(definition, `${componentId} is in the catalog`);
    assert.ok(physical, `${componentId} has a physical definition`);
    assert.equal(definition.hidden, false);
    assert.equal(definition.engineering.specificationBasis, "generic");
    assert.equal(definition.engineering.connectors.length > 0, true, `${componentId} has connector groups`);
    assert.equal(definition.terminals.length, Object.keys(physical.terminals).length, `${componentId} terminal count matches physical anchors`);

    const terminalIds = new Set(definition.terminals.map((terminal) => terminal.id));
    const coordinateKeys = new Set();
    for (const terminal of definition.terminals) {
      assert.equal(typeof terminal.connectorInterface, "string", `${componentId}.${terminal.id} has a connector interface`);
      assert.notEqual(terminal.connectorInterface, "", `${componentId}.${terminal.id} has a non-empty connector interface`);
      const key = terminal.position.map((value) => Number(value).toFixed(3)).join(",");
      assert.equal(coordinateKeys.has(key), false, `${componentId}.${terminal.id} does not duplicate a physical anchor`);
      coordinateKeys.add(key);
      if (terminal.voltageDomainId && terminal.voltageDomainId !== "ground") {
        assert.equal(definition.engineering.voltageDomains.some((domain) => domain.id === terminal.voltageDomainId), true, `${componentId}.${terminal.id} voltage domain exists`);
      }
    }
    for (const connector of definition.engineering.connectors) {
      assert.equal(connector.terminalIds.length > 0, true, `${componentId}.${connector.id} lists terminals`);
      assert.equal(connector.terminalIds.every((terminalId) => terminalIds.has(terminalId)), true, `${componentId}.${connector.id} members exist`);
    }
    for (const required of definition.engineering.requiredConnections ?? []) {
      assert.equal(terminalIds.has(required.terminalId), true, `${componentId}.${required.terminalId} required connection target exists`);
    }
  }
});

test("Circuit Lab normalizes bounded per-instance engineering overrides", () => {
  let project = createCircuitLabProject();
  project = updateComponent(project, "servo", {
    props: {
      scale: 1.2,
      engineeringOverrides: {
        nominalVoltageV: "5.5",
        typicalCurrentMa: 650,
        stallCurrentMa: 1200,
        connectorFamily: "micro-servo-lead",
        vendorFileId: "file_id_secret",
        datasheet: "C:\\secret\\datasheet.pdf"
      }
    }
  });

  const overrides = project.components.find((component) => component.id === "servo").props.engineeringOverrides;
  assert.deepEqual(overrides, {
    nominalVoltageV: 5.5,
    typicalCurrentMa: 650,
    stallCurrentMa: 1200,
    connectorFamily: "micro-servo-lead"
  });
});

test("unsupported controller source export stays wiring-only while preserving artifacts", () => {
  const project = normalizeProject({
    name: "Pico wiring plan",
    controllerId: "pico",
    components: [
      { id: "pico", typeId: "controller-raspberry-pi-pico", name: "Raspberry Pi Pico", position: [100, 100] },
      { id: "tof", typeId: "sensor-vl53l0x-tof", name: "ToF sensor", position: [180, 100] }
    ],
    connections: [
      {
        id: "scl",
        endpoints: [
          { componentId: "pico", terminalId: "GP1" },
          { componentId: "tof", terminalId: "SCL" }
        ]
      }
    ]
  });
  const source = generateCircuitLabSource(project);

  assert.equal(source.target, "unsupported");
  assert.equal(source.ready, false);
  assert.equal(source.files.some((file) => file.path === "UNSUPPORTED_CONTROLLER.md"), true);
  assert.equal(source.files.some((file) => file.path.endsWith(".ino") || file.path === "main/app_main.c"), false);
  assert.equal(source.files.some((file) => file.path === "bom.csv"), true);
  assert.equal(source.files.some((file) => file.path === "harness.csv"), true);
  assert.match(source.files.find((file) => file.path === "README.md").content, /source export not available for unsupported controllers/);
});

test("Circuit Lab DRC catches voltage range, logic level, and sensor completeness issues", () => {
  let project = applyStarterTemplate(createCircuitLabProject(), "esp32_led_button");
  project = addComponent(project, "ultrasonic-hcsr04", { id: "distance" });
  project = connectTerminals(project, { componentId: "esp32", terminalId: "3V3" }, { componentId: "distance", terminalId: "VCC" });
  project = connectTerminals(project, { componentId: "distance", terminalId: "ECHO" }, { componentId: "esp32", terminalId: "GPIO18" });

  const result = runCircuitLabTest(project);
  assert.equal(result.issues.some((issue) => issue.code === "voltage-out-of-range"), true);
  assert.equal(result.issues.some((issue) => issue.code === "logic-level-mismatch"), true);
  assert.equal(result.issues.some((issue) => issue.code === "required-connection-missing"), true);
});

test("Circuit Lab DRC requires powered sources for required sensor power inputs", () => {
  let project = createCircuitLabProject();
  project = addComponent(project, "ultrasonic-hcsr04", { id: "distance" });
  project = connectTerminals(project, { componentId: "distance", terminalId: "VCC" }, { componentId: "breadboard", terminalId: "r1a" }, { id: "floating_sensor_vcc" });
  project = connectTerminals(project, { componentId: "distance", terminalId: "GND" }, { componentId: "arduino", terminalId: "GND2" }, { id: "sensor_ground" });
  project = connectTerminals(project, { componentId: "distance", terminalId: "TRIG" }, { componentId: "arduino", terminalId: "D8" }, { id: "sensor_trig" });
  project = connectTerminals(project, { componentId: "distance", terminalId: "ECHO" }, { componentId: "arduino", terminalId: "D7" }, { id: "sensor_echo" });
  const unpowered = runCircuitLabTest(project);
  assert.equal(unpowered.issues.some((issue) => issue.code === "required-power-missing"), true);

  project = removeConnection(project, "floating_sensor_vcc");
  project = connectTerminals(project, { componentId: "distance", terminalId: "VCC" }, { componentId: "arduino", terminalId: "5V" }, { id: "powered_sensor_vcc" });
  const powered = runCircuitLabTest(project);
  assert.equal(powered.issues.some((issue) => issue.code === "required-power-missing"), false);
});

test("Circuit Lab DRC catches reversed capacitor polarity and high-current actuator budgets", () => {
  let reversed = createCircuitLabProject();
  reversed = addComponent(reversed, "capacitor-electrolytic-470uf", { id: "cap" });
  reversed = connectTerminals(reversed, { componentId: "cap", terminalId: "pos" }, { componentId: "breadboard", terminalId: "bn20" });
  assert.equal(runCircuitLabTest(reversed).issues.some((issue) => issue.code === "capacitor-polarity-reversed"), true);

  const sixServo = applyStarterTemplate(createCircuitLabProject(), "arduino_six_servo_order");
  const result = runCircuitLabTest(sixServo);
  assert.equal(result.issues.some((issue) => issue.code === "supply-peak-current-budget"), true);
  assert.equal(result.issues.some((issue) => issue.code === "breadboard-actuator-current"), true);
});

test("Circuit Lab issue targets and readiness expose blocking scope without DOM data", () => {
  let project = createCircuitLabProject();
  project = removeConnection(project, "power_to_breadboard");
  project = removeConnection(project, "servo_power");
  project = connectTerminals(project, { componentId: "arduino", terminalId: "5V" }, { componentId: "servo", terminalId: "vplus" });

  const result = runCircuitLabTest(project);
  const issue = result.issues.find((item) => item.code === "servo-controller-power");
  assert.equal(issue.blocks.sourceMapping, true);
  assert.deepEqual(issue.targets.componentIds, ["servo"]);
  assert.equal(issue.targets.terminalRefs.some((endpoint) => endpoint.componentId === "arduino" && endpoint.terminalId === "5V"), true);
  assert.equal(result.highlights.some((highlight) => highlight.type === "component" && highlight.componentId === "servo"), true);

  const blocked = evaluateCircuitReadiness({ circuitLabProject: project });
  assert.equal(blocked.electrical.status, "blocked");
  assert.equal(blocked.sourceMappingAllowed, false);

  const readyForReview = evaluateCircuitReadiness({ circuitLabProject: createCircuitLabProject() });
  assert.equal(readyForReview.electrical.status, "review-required");
  assert.equal(readyForReview.source.status, "standalone-ready");
  assert.equal(readyForReview.semanticRunAllowed, false);
});

function boundRobotDesign() {
  return {
    version: 1,
    units: "mm",
    joints: [{ id: "shoulder", name: "Shoulder", type: "revolute", actuatorId: "servo_1", min: -90, max: 90 }],
    actuators: [{ id: "servo_1", name: "Shoulder servo", voltage: 6, interface: { actuatorClass: "hobby-servo", commandMode: "position" } }],
    sensors: [],
    pose: { jointAngles: { shoulder: 0 } }
  };
}

function boundServoBinding() {
  return {
    version: 1,
    actuatorBindings: [
      {
        id: "shoulder_binding",
        jointId: "shoulder",
        actuatorId: "servo_1",
        circuitComponentId: "servo",
        firmwareChannelIds: ["servo_signal"]
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
    ]
  };
}

test("Circuit artifacts derive pin map, BOM, harness, and checklist from one analyzed state", async () => {
  const artifacts = buildCircuitArtifacts({
    circuitLabProject: createCircuitLabProject(),
    robotDesign: boundRobotDesign(),
    mechatronicsBinding: boundServoBinding()
  });

  assert.equal(artifacts.test.summary.errors, 0);
  assert.equal(artifacts.bindingValidation.ok, true);
  assert.equal(artifacts.pinMapRows[0]["firmware channel ID"], "servo_signal");
  assert.equal(artifacts.pinMapRows[0]["generated source symbol"], "SERVO_SIGNAL");
  assert.equal(artifacts.bomRows.some((row) => row["catalog type ID"] === "servo-standard" && row["review required"] === "yes"), true);
  assert.equal(artifacts.harnessRows.every((row) => row.length === "TBD"), true);
  assert.match(artifacts.files["pin-map.csv"], /firmware channel ID/);
  assert.match(artifacts.files["bom.csv"], /specification basis/);
  assert.match(artifacts.files["harness.csv"], /junction required; branch topology unspecified/);
  assert.match(artifacts.files["build-checklist.md"], /not hardware verification/i);

  const zipBytes = await createCircuitBuildGuideZip(artifacts, { type: "uint8array" });
  assert.equal(zipBytes.length > 100, true);
});

test("Circuit artifacts split BOM rows when instance engineering overrides differ", () => {
  let project = applyStarterTemplate(createCircuitLabProject(), "arduino_six_servo_order");
  project = updateComponent(project, "servo_base", {
    props: {
      engineeringOverrides: {
        typicalCurrentMa: 450,
        peakCurrentMa: 900,
        connectorFamily: "confirmed-servo-lead"
      }
    }
  });

  const artifacts = buildCircuitArtifacts({ circuitLabProject: project });
  const servoRows = artifacts.bomRows.filter((row) => row["catalog type ID"] === "servo-standard");
  assert.equal(servoRows.length, 2);
  assert.equal(servoRows.some((row) => row["instance engineering overrides"].includes("typicalCurrentMa:450")), true);
  assert.equal(servoRows.some((row) => row["instance engineering overrides"] === "catalog default"), true);
});

test("Circuit Lab source generation is safe by default and binding-aware when semantic channels exist", () => {
  const standalone = generateCircuitLabSource(createCircuitLabProject());
  const arduino = standalone.files.find((file) => file.path.endsWith(".ino")).content;
  assert.doesNotMatch(arduino, /write\(70\)|write\(110\)/);
  assert.doesNotMatch(arduino, /DRIVER_IN1_PIN, HIGH/);
  assert.match(standalone.files.find((file) => file.path === "README.md").content, /not built, flashed, executed, or hardware-tested/i);
  assert.equal(standalone.files.some((file) => file.path === "pin-map.csv"), true);

  const linked = generateCircuitLabSource(createCircuitLabProject(), {
    robotDesign: boundRobotDesign(),
    mechatronicsBinding: boundServoBinding()
  });
  const linkedArduino = linked.files.find((file) => file.path.endsWith(".ino")).content;
  assert.equal(linked.ready, true);
  assert.match(linkedArduino, /void set_servo_signal\(int degrees\)/);
  assert.match(linkedArduino, /Servo servo_servo_signal;/);
  assert.doesNotMatch(linkedArduino, /autonomous sweep/i);
  assert.match(linked.files.find((file) => file.path === "pin-map.csv").content, /SERVO_SIGNAL/);
});

test("Circuit Lab ESP-IDF source does not claim semantic linked output before channel codegen exists", () => {
  const project = applyStarterTemplate(createCircuitLabProject(), "esp32_led_button");
  const source = generateCircuitLabSource(project, {
    robotDesign: {
      version: 1,
      units: "mm",
      joints: [],
      actuators: [],
      sensors: [{ id: "button_1", name: "Mode button", interface: { sensorClass: "button", measurement: "digital", valueType: "boolean" } }]
    },
    mechatronicsBinding: {
      sensorBindings: [{ id: "button_binding", sensorId: "button_1", circuitComponentId: "button", firmwareChannelIds: ["button_signal"] }],
      firmwareChannels: [
        {
          id: "button_signal",
          semanticRole: "sensor.read.digital",
          direction: "device-to-controller",
          signalType: "digital",
          valueType: "boolean",
          controllerTerminalRef: { componentId: "esp32", terminalId: "GPIO17" },
          deviceTerminalRef: { componentId: "button", terminalId: "sense" }
        }
      ]
    }
  });

  assert.equal(source.target, "espidf");
  assert.equal(source.ready, false);
  const readme = source.files.find((file) => file.path === "README.md").content;
  assert.match(readme, /ESP-IDF semantic channels are not emitted yet/);
  assert.doesNotMatch(source.files.find((file) => file.path === "main/app_main.c").content, /button_signal/i);
});
