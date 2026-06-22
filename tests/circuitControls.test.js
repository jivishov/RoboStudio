import assert from "node:assert/strict";
import test from "node:test";

import { findConnectedTerminals } from "../src/circuits/connectivity.js";
import { componentControlSummary, normalizeControlState, potentiometerSemanticValue } from "../src/circuits/controlModel.js";
import {
  createControlInteractionState,
  isMomentaryControlActive,
  pressMomentaryControl,
  releaseActiveMomentaryControl,
  releaseAllMomentaryControls
} from "../src/circuits/controlInteractions.js";
import { setComponentControl, normalizeProject, serializeCircuitLabProject } from "../src/circuits/model.js";
import { catalog } from "../src/circuits/catalog.js";
import { runCircuitLabTest } from "../src/circuits/testBench.js";

test("persistent control state normalizes and clamps to whitelisted values", () => {
  const supplyDef = catalog.getComponent("supply-servo-6v");
  const potDef = catalog.getComponent("potentiometer-10k");
  const servoDef = catalog.getComponent("servo-standard");

  assert.deepEqual(normalizeControlState(supplyDef, { power: "bad" }), { power: "off" });
  assert.deepEqual(normalizeControlState(supplyDef, { power: "on" }), { power: "on" });
  assert.deepEqual(normalizeControlState(potDef, { wiper: 2 }), { wiper: 1 });
  assert.deepEqual(normalizeControlState(servoDef, { previewAngleDeg: -20 }), { previewAngleDeg: 0 });
});

test("setComponentControl persists only documented controls and strips momentary state", () => {
  let project = normalizeProject({
    components: [
      { id: "pot", typeId: "potentiometer-10k", name: "Pot", position: [100, 100], props: { controls: { wiper: 0.5, press: "down" } } },
      { id: "button", typeId: "button-tactile", name: "Button", position: [140, 100], props: { controls: { press: "down" } } }
    ],
    connections: []
  });
  project = setComponentControl(project, "pot", "wiper", "0.72");

  const pot = project.components.find((component) => component.id === "pot");
  const button = project.components.find((component) => component.id === "button");
  assert.equal(potentiometerSemanticValue(pot), 0.72);
  assert.deepEqual(button.props.controls, undefined);
  assert.equal(serializeCircuitLabProject(project).includes("press"), false);
  assert.throws(() => setComponentControl(project, "pot", "press", "down"), /Unknown persistent control/);
});

test("momentary control interaction state is session-only and releasable", () => {
  const state = createControlInteractionState();
  assert.equal(pressMomentaryControl(state, "button", "press"), true);
  assert.equal(isMomentaryControlActive(state, "button", "press"), true);
  assert.equal(pressMomentaryControl(state, "button", "press"), false);
  assert.equal(releaseActiveMomentaryControl(state), true);
  assert.equal(isMomentaryControlActive(state, "button", "press"), false);
  assert.equal(pressMomentaryControl(state, "button", "press"), true);
  assert.equal(releaseAllMomentaryControls(state), true);
  assert.deepEqual(Object.keys(state.controlPresses), []);
});

test("button permanent buses and pressed potential state are deterministic", () => {
  const project = normalizeProject({
    components: [
      { id: "supply", typeId: "supply-servo-6v", name: "Supply", position: [80, 80], props: { controls: { power: "off" } } },
      { id: "button", typeId: "button-tactile", name: "Button", position: [120, 80] }
    ],
    connections: [
      { id: "sense_power", endpoints: [{ componentId: "supply", terminalId: "VPLUS" }, { componentId: "button", terminalId: "sense" }] },
      { id: "return_ground", endpoints: [{ componentId: "supply", terminalId: "GND" }, { componentId: "button", terminalId: "return" }] }
    ]
  });

  const unpressedSense = findConnectedTerminals(project, { componentId: "button", terminalId: "sense" });
  assert.equal(unpressedSense.some((terminal) => terminal.endpoint.terminalId === "sense2"), true);
  assert.equal(unpressedSense.some((terminal) => terminal.endpoint.terminalId === "return"), false);

  const result = runCircuitLabTest(project);
  assert.equal(result.issues.some((issue) => issue.code === "control-state-short"), true);
});

test("SPDT switch potential throws are checked for shorts", () => {
  const project = normalizeProject({
    components: [
      { id: "supply", typeId: "supply-servo-6v", name: "Supply", position: [80, 80] },
      { id: "switch", typeId: "switch-spdt-slide", name: "Switch", position: [120, 80], props: { controls: { throw: "a" } } }
    ],
    connections: [
      { id: "common_power", endpoints: [{ componentId: "supply", terminalId: "VPLUS" }, { componentId: "switch", terminalId: "COM" }] },
      { id: "throw_ground", endpoints: [{ componentId: "supply", terminalId: "GND" }, { componentId: "switch", terminalId: "B" }] }
    ]
  });
  const result = runCircuitLabTest(project);

  assert.equal(componentControlSummary(project.components[1], catalog.getComponent("switch-spdt-slide"))[0].value, "a");
  assert.equal(result.issues.some((issue) => issue.code === "control-state-short"), true);
});

test("imported occupancy conflicts remain loadable and become DRC errors", () => {
  const project = normalizeProject({
    components: [
      { id: "arduino", typeId: "controller-arduino-uno-r3", name: "Arduino", position: [80, 80] },
      { id: "led1", typeId: "led-red", name: "LED 1", position: [120, 80] },
      { id: "led2", typeId: "led-red", name: "LED 2", position: [160, 80] }
    ],
    controllerId: "arduino",
    connections: [
      { id: "wire1", endpoints: [{ componentId: "arduino", terminalId: "D8" }, { componentId: "led1", terminalId: "anode" }] },
      { id: "wire2", endpoints: [{ componentId: "arduino", terminalId: "D8" }, { componentId: "led2", terminalId: "anode" }] }
    ]
  });
  const result = runCircuitLabTest(project);

  assert.equal(result.issues.some((issue) => issue.code === "physical-terminal-occupied"), true);
});
