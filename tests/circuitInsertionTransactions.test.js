import assert from "node:assert/strict";
import test from "node:test";

import {
  catalog,
  clearCustomCircuitComponents,
  registerCustomCircuitComponents
} from "../src/circuits/catalog.js";
import { resolveTerminal } from "../src/circuits/connectivity.js";
import { buildFritzingCustomComponentDefinition } from "../src/circuits/customComponents.js";
import { deriveDrcFingerprintDelta } from "../src/circuits/drcFingerprint.js";
import {
  directInsertionEndpointPairsForComponent,
  evaluateInsertionConstellation,
  inspectDirectInsertionState,
  insertComponentIntoNearestTerminals,
  occupancyBlockReason,
  resolveInsertionOutcome,
  terminalsMechanicallyMate
} from "../src/circuits/insertion.js";
import {
  addComponent,
  connectTerminals,
  normalizeProject,
  parseCircuitLabProjectJson,
  serializeCircuitLabProject,
  updateComponent
} from "../src/circuits/model.js";
import { runCircuitLabTest } from "../src/circuits/testBench.js";
import {
  commitStagedMutation,
  stageDisconnectMutation,
  stageInsertionMutation,
  stageWireMutation
} from "../src/circuits/transactions.js";

function emptyProject() {
  return normalizeProject({
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    name: "Cycle 2 test",
    components: [],
    connections: [],
    app: { kind: "cycle-2-test" },
    updatedAt: "2026-07-14T00:00:00.000Z"
  });
}

function addAtTerminal(project, typeId, componentId, sourceTerminalId, targetEndpoint, options = {}) {
  let next = addComponent(project, typeId, { id: componentId, rotation: options.rotation ?? 0 });
  const target = resolveTerminal(next, targetEndpoint);
  const sourceTerminal = catalog.getComponent(typeId).terminals.find((terminal) => terminal.id === sourceTerminalId);
  assert.equal(target.ok, true);
  next = updateComponent(next, componentId, {
    rotation: options.rotation ?? 0,
    position: [
      target.worldPosition[0] - sourceTerminal.position[0],
      target.worldPosition[1] - sourceTerminal.position[1]
    ]
  });
  return next;
}

function safeCapacitorPlacement() {
  let base = emptyProject();
  base = addComponent(base, "breadboard-bb400-400", { id: "bb", position: [500, 325] });
  const proposed = addAtTerminal(
    base,
    "capacitor-electrolytic-470uf",
    "cap",
    "pos",
    { componentId: "bb", terminalId: "r15a" }
  );
  return { base, proposed };
}

function insertedCapacitorProject() {
  const { proposed } = safeCapacitorPlacement();
  const inserted = insertComponentIntoNearestTerminals(proposed, "cap");
  assert.equal(inserted.insertedCount, 2);
  return inserted.project;
}

function reversedCapacitorPlacement() {
  let base = emptyProject();
  base = addComponent(base, "breadboard-bb400-400", { id: "bb", position: [500, 325] });
  base = addComponent(base, "supply-servo-6v", { id: "supply", position: [100, 100] });
  base = connectTerminals(base, { componentId: "supply", terminalId: "GND" }, { componentId: "bb", terminalId: "r15b" }, { id: "ground_row" });
  base = connectTerminals(base, { componentId: "supply", terminalId: "VPLUS" }, { componentId: "bb", terminalId: "r16b" }, { id: "power_row" });
  const proposed = addAtTerminal(
    base,
    "capacitor-electrolytic-470uf",
    "cap",
    "pos",
    { componentId: "bb", terminalId: "r15a" }
  );
  return { base, proposed };
}

test("directional mechanical mating rejects identical genders and accepts declared source-to-target relationships", () => {
  const cap = catalog.getComponent("capacitor-electrolytic-470uf");
  const breadboard = catalog.getComponent("breadboard-bb400-400");
  const servo = catalog.getComponent("servo-standard");
  const pca = catalog.getComponent("driver-pca9685-servo");
  const uno = catalog.getComponent("controller-arduino-uno-r3");

  assert.equal(terminalsMechanicallyMate(cap.terminals[0], breadboard.terminals[0]), true);
  assert.equal(terminalsMechanicallyMate(breadboard.terminals[0], breadboard.terminals[1]), false);
  assert.equal(terminalsMechanicallyMate(pca.terminals.find((item) => item.id === "ch0_signal"), uno.terminals.find((item) => item.id === "D0")), false);
  assert.equal(terminalsMechanicallyMate(servo.terminals.find((item) => item.id === "signal"), pca.terminals.find((item) => item.id === "ch0_signal")), true);
  assert.equal(terminalsMechanicallyMate(pca.terminals.find((item) => item.id === "ch0_signal"), servo.terminals.find((item) => item.id === "signal")), false);
});

test("built-in insertion sources cannot mate to custom targets while manual custom endpoint wires remain available", () => {
  clearCustomCircuitComponents();
  try {
    registerCustomCircuitComponents([buildFritzingCustomComponentDefinition({
      fzpText: `
        <module moduleId="cycle2FemaleSocket">
          <title>Cycle 2 Female Socket</title>
          <connectors>
            <connector id="connector0" name="Socket" type="female">
              <gender>female</gender>
              <views><breadboardView><p svgId="socket" terminalId="socket" /></breadboardView></views>
            </connector>
          </connectors>
        </module>`,
      svgText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="socket" cx="5" cy="5" r="1" /></svg>`,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      licenseAccepted: true,
      now: "2026-07-14T00:00:00.000Z"
    })]);
    let base = emptyProject();
    base = addComponent(base, "custom:cycle2femalesocket", { id: "custom_target", position: [500, 325] });
    const proposed = addAtTerminal(
      base,
      "capacitor-electrolytic-470uf",
      "cap",
      "pos",
      { componentId: "custom_target", terminalId: "connector0" }
    );
    const insertion = stageInsertionMutation(base, proposed, "cap", 2);

    assert.equal(insertion.mechanical.state, "not-applicable");
    assert.equal(insertion.candidateProject.connections.length, 0);
    const manualWire = stageWireMutation(
      proposed,
      { componentId: "cap", terminalId: "pos" },
      { componentId: "custom_target", terminalId: "connector0" },
      3
    );
    assert.notEqual(manualWire.status, "mechanically-impossible");
    assert.equal(manualWire.candidateProject.connections.length, 1);
  } finally {
    clearCustomCircuitComponents();
  }
});

test("capacity greater than one leaves a direct-insertion slot available and blocks only when the fixture is full", () => {
  const endpoint = { componentId: "capacity-target", terminalId: "slot" };
  const endpointKey = "capacity-target:slot";
  const sourceComponent = { id: "capacity-source", position: [0, 0], rotation: 0, props: { scale: 1 } };
  const sourceDefinition = {
    id: "capacity-source-type",
    dimensions: [10, 10],
    physicalPorts: [],
    terminals: [{
      id: "lead",
      position: [0, 0],
      connectorInterface: "component-lead",
      attachmentCapacity: 1
    }]
  };
  const targetRecord = {
    component: { id: endpoint.componentId, position: [0, 0], rotation: 0, props: { scale: 1 } },
    componentDefinition: { id: "capacity-target-type", dimensions: [10, 10], physicalPorts: [] },
    terminal: {
      id: endpoint.terminalId,
      position: [0, 0],
      connectorInterface: "female-breadboard-socket",
      attachmentCapacity: 2
    },
    endpoint,
    worldPosition: [0, 0]
  };
  const pattern = {
    id: "capacity-pattern",
    terminalIds: ["lead"],
    rigidity: "flexible",
    positionToleranceMm: 0.25,
    angularToleranceDeg: 1
  };
  const constellationOptions = {
    proposedComponent: sourceComponent,
    componentDefinition: sourceDefinition,
    pattern,
    targetComponentId: endpoint.componentId,
    targetLookup: { query: () => [{ record: targetRecord, distance: 0 }] },
    targetByKey: new Map([[endpointKey, targetRecord]]),
    requiredTargets: new Map()
  };
  const oneAttachment = {
    occupancyByEndpoint: new Map([[endpointKey, [{ connectionId: "insert_a", kind: "direct-insertion" }]]])
  };
  const fullFixture = {
    occupancyByEndpoint: new Map([[endpointKey, [
      { connectionId: "insert_a", kind: "direct-insertion" },
      { connectionId: "insert_b", kind: "direct-insertion" }
    ]]])
  };
  const ordinaryWireFixture = {
    occupancyByEndpoint: new Map([[endpointKey, [{ connectionId: "wire_a", kind: "wire" }]]])
  };
  const fullBefore = JSON.stringify(fullFixture.occupancyByEndpoint.get(endpointKey));

  assert.equal(occupancyBlockReason(oneAttachment, endpoint, 2), null);
  assert.equal(occupancyBlockReason(fullFixture, endpoint, 2), "full-contact");
  assert.equal(occupancyBlockReason(ordinaryWireFixture, endpoint, 2), "ordinary-wire-present");
  assert.equal(evaluateInsertionConstellation({ ...constellationOptions, occupancy: oneAttachment }).ok, true);
  assert.deepEqual(evaluateInsertionConstellation({ ...constellationOptions, occupancy: fullFixture }), {
    ok: false,
    reasonCode: "full-contact"
  });
  assert.deepEqual(evaluateInsertionConstellation({ ...constellationOptions, occupancy: ordinaryWireFixture }), {
    ok: false,
    reasonCode: "ordinary-wire-present"
  });
  assert.equal(JSON.stringify(fullFixture.occupancyByEndpoint.get(endpointKey)), fullBefore);
});

test("complete constellation solving is deterministic and commits every safe contact atomically", () => {
  const { base, proposed } = safeCapacitorPlacement();
  const first = stageInsertionMutation(base, proposed, "cap", 4);
  const second = stageInsertionMutation(base, proposed, "cap", 4);

  assert.equal(first.status, "electrically-safe");
  assert.equal(first.mechanical.state, "resolved");
  assert.equal(first.requiresConfirmation, false);
  assert.equal(first.candidateProject.connections.filter((item) => item.kind === "direct-insertion").length, 2);
  assert.deepEqual(first.exactEndpointPairs, second.exactEndpointPairs);
  assert.deepEqual(first.addedConnectionIds, ["insert_cap_neg", "insert_cap_pos"]);
  assert.deepEqual(first.exactEndpointPairs.map((pair) => `${pair.sourceEndpoint.terminalId}:${pair.targetEndpoint.terminalId}`), [
    "pos:r15a",
    "neg:r16a"
  ]);

  const committed = commitStagedMutation(base, 4, first);
  assert.equal(committed.ok, true);
  assert.equal(committed.project.connections.filter((item) => item.kind === "direct-insertion").length, 2);
});

test("servo plug matching enforces all three ordered contacts and catalog port direction", () => {
  let base = emptyProject();
  base = addComponent(base, "driver-pca9685-servo", { id: "pca", position: [500, 300] });
  const proposed = addAtTerminal(base, "servo-standard", "servo", "signal", { componentId: "pca", terminalId: "ch0_signal" });
  const resolved = resolveInsertionOutcome(proposed, "servo");

  assert.equal(resolved.state, "resolved");
  assert.deepEqual(resolved.plan.matches.map((match) => [match.source.terminal.id, match.target.terminal.id]), [
    ["signal", "ch0_signal"],
    ["vplus", "ch0_vplus"],
    ["gnd", "ch0_gnd"]
  ]);
  assert.equal(resolved.plan.maximumAngularResidualDeg, 0);

  const rotated = updateComponent(proposed, "servo", { rotation: 180 });
  const blocked = resolveInsertionOutcome(rotated, "servo", {
    requiredEndpointPairs: resolved.plan.matches.map((match) => ({
      sourceEndpoint: match.source.endpoint,
      targetEndpoint: match.target.endpoint
    }))
  });
  assert.equal(blocked.state, "blocked");
});

test("mechanically valid reversed polarity remains unchanged until confirmation and stays an unsuppressed DRC fault after commit", () => {
  const { base, proposed } = reversedCapacitorPlacement();
  const baseBeforeStaging = serializeCircuitLabProject(base);
  const proposedBeforeStaging = serializeCircuitLabProject(proposed);
  const mutation = stageInsertionMutation(base, proposed, "cap", 9);

  assert.equal(mutation.status, "electrically-hazardous");
  assert.equal(mutation.mechanical.resolved, true);
  assert.equal(mutation.requiresConfirmation, true);
  assert.equal(base.connections.some((item) => item.kind === "direct-insertion"), false);
  assert.equal(mutation.candidateProject.connections.filter((item) => item.kind === "direct-insertion").length, 2);
  assert.equal(mutation.drcDelta.electricalHazardFingerprints.length > 0, true);
  assert.equal(mutation.electrical.hazards.some((issue) => issue.code === "capacitor-polarity-reversed"), true);
  assert.equal(serializeCircuitLabProject(base), baseBeforeStaging);
  assert.equal(serializeCircuitLabProject(proposed), proposedBeforeStaging);
  assert.deepEqual(base.connections.map((item) => item.id).sort(), ["ground_row", "power_row"]);

  const committed = commitStagedMutation(base, 9, mutation);
  assert.equal(committed.ok, true);
  assert.equal(committed.project.connections.filter((item) => item.kind === "direct-insertion").length, 2);
  const testResult = runCircuitLabTest(committed.project);
  assert.equal(testResult.issues.some((issue) => issue.code === "capacitor-polarity-reversed" && issue.placementRisk === "electrical-hazard"), true);
});

test("ordinary source or nearest-target wires block the whole insertion without pruning or partial effects", () => {
  const { base: emptyBase, proposed: emptyProposed } = safeCapacitorPlacement();
  let targetOccupied = connectTerminals(emptyBase, { componentId: "bb", terminalId: "r15a" }, { componentId: "bb", terminalId: "r20a" }, { id: "ordinary_target_wire" });
  targetOccupied = addAtTerminal(targetOccupied, "capacitor-electrolytic-470uf", "cap", "pos", { componentId: "bb", terminalId: "r15a" });
  const targetBeforeStaging = serializeCircuitLabProject(targetOccupied);
  const targetMutation = stageInsertionMutation(emptyBase, targetOccupied, "cap", 1);
  assert.equal(targetMutation.status, "mechanically-impossible");
  assert.equal(targetMutation.mechanical.reasonCode, "ordinary-wire-present");
  assert.equal(targetMutation.candidateProject, null);
  assert.equal(targetOccupied.connections.some((item) => item.id === "ordinary_target_wire"), true);
  assert.equal(serializeCircuitLabProject(targetOccupied), targetBeforeStaging);

  let sourceOccupied = connectTerminals(emptyProposed, { componentId: "cap", terminalId: "pos" }, { componentId: "bb", terminalId: "r20a" }, { id: "ordinary_source_wire" });
  const sourceBeforeStaging = serializeCircuitLabProject(sourceOccupied);
  const sourceMutation = stageInsertionMutation(emptyBase, sourceOccupied, "cap", 2);
  assert.equal(sourceMutation.status, "mechanically-impossible");
  assert.equal(sourceMutation.mechanical.reasonCode, "ordinary-wire-present");
  assert.equal(sourceOccupied.connections.some((item) => item.id === "ordinary_source_wire"), true);
  assert.equal(serializeCircuitLabProject(sourceOccupied), sourceBeforeStaging);
});

test("same-gender and incomplete patterns are mechanically impossible and never expose an override", () => {
  let base = emptyProject();
  base = addComponent(base, "led-red", { id: "led", position: [500, 300] });
  const proposed = addAtTerminal(base, "capacitor-electrolytic-470uf", "cap", "pos", { componentId: "led", terminalId: "anode" });
  const sameGender = stageInsertionMutation(base, proposed, "cap", 2);
  assert.equal(sameGender.status, "mechanically-impossible");
  assert.equal(sameGender.requiresConfirmation, false);
  assert.equal(sameGender.candidateProject, null);

  const inserted = insertedCapacitorProject();
  const insertedBeforeStaging = serializeCircuitLabProject(inserted);
  const pairs = directInsertionEndpointPairsForComponent(inserted, "cap");
  const incomplete = stageInsertionMutation(inserted, inserted, "cap", 3, {
    operationKind: "re-seat",
    requiredEndpointPairs: pairs.slice(0, 1)
  });
  assert.equal(incomplete.status, "mechanically-impossible");
  assert.equal(incomplete.candidateProject, null);
  assert.equal(inserted.connections.filter((item) => item.kind === "direct-insertion").length, 2);
  assert.equal(serializeCircuitLabProject(inserted), insertedBeforeStaging);
});

test("failed rematch preserves the prior direct insertion and component transform", () => {
  const inserted = insertedCapacitorProject();
  const proposed = updateComponent(inserted, "cap", { props: { scale: 1.2 } });
  const insertedBeforeStaging = serializeCircuitLabProject(inserted);
  const proposedBeforeStaging = serializeCircuitLabProject(proposed);
  const mutation = stageInsertionMutation(inserted, proposed, "cap", 11);

  assert.equal(mutation.status, "mechanically-impossible");
  assert.equal(mutation.candidateProject, null);
  assert.equal(inserted.components.find((item) => item.id === "cap").props.scale, 1);
  assert.equal(inserted.connections.filter((item) => item.kind === "direct-insertion").length, 2);
  assert.equal(serializeCircuitLabProject(inserted), insertedBeforeStaging);
  assert.equal(serializeCircuitLabProject(proposed), proposedBeforeStaging);
});

test("manual wires enforce capacity, derive adapter review, and confirm only new electrical hazards", () => {
  let adapterBase = emptyProject();
  adapterBase = addComponent(adapterBase, "controller-arduino-uno-r3", { id: "uno", position: [300, 300] });
  adapterBase = addComponent(adapterBase, "servo-standard", { id: "servo", position: [600, 300] });
  const adapterWire = stageWireMutation(adapterBase, { componentId: "uno", terminalId: "D9" }, { componentId: "servo", terminalId: "signal" }, 1);
  assert.equal(adapterWire.status, "electrically-safe");
  assert.equal(adapterWire.requiresConfirmation, false);
  assert.equal(runCircuitLabTest(adapterWire.candidateProject).issues.some((issue) => issue.code === "adapter-harness-review" && issue.domain === "mechanical"), true);

  const full = stageWireMutation(adapterWire.candidateProject, { componentId: "uno", terminalId: "D9" }, { componentId: "servo", terminalId: "vplus" }, 2);
  assert.equal(full.status, "mechanically-impossible");
  assert.equal(full.mechanical.reasonCode, "full-contact");

  let shortBase = emptyProject();
  shortBase = addComponent(shortBase, "supply-servo-6v", { id: "supply", position: [300, 300] });
  shortBase = addComponent(shortBase, "breadboard-bb400-400", { id: "bb", position: [600, 325] });
  const hazardousWire = stageWireMutation(shortBase, { componentId: "supply", terminalId: "VPLUS" }, { componentId: "supply", terminalId: "GND" }, 5);
  assert.equal(hazardousWire.status, "electrically-hazardous");
  assert.equal(hazardousWire.requiresConfirmation, true);
  const hazardousBase = commitStagedMutation(shortBase, 5, hazardousWire).project;
  const unrelated = stageWireMutation(hazardousBase, { componentId: "bb", terminalId: "r1a" }, { componentId: "bb", terminalId: "r2a" }, 6);
  assert.equal(unrelated.requiresConfirmation, false);
  assert.equal(unrelated.drcDelta.electricalHazardFingerprints.length, 0);
});

test("stale generations commit nothing even when the staged plan was otherwise valid", () => {
  let base = insertedCapacitorProject();
  base = connectTerminals(base, { componentId: "bb", terminalId: "r29a" }, { componentId: "bb", terminalId: "r30a" }, { id: "ordinary_preserved_wire" });
  const stale = updateComponent(base, "cap", { position: [700, 420] });
  const mutation = stageInsertionMutation(stale, stale, "cap", 14, { operationKind: "re-seat", repairMode: true });
  const before = serializeCircuitLabProject(stale);
  const committed = commitStagedMutation(stale, 15, mutation);

  assert.equal(mutation.status, "electrically-safe");
  assert.equal(committed.ok, false);
  assert.equal(committed.reason, "stale-generation");
  assert.equal(serializeCircuitLabProject(committed.project), before);
  assert.deepEqual(committed.project.connections.map((item) => item.id).sort(), [
    "insert_cap_neg",
    "insert_cap_pos",
    "ordinary_preserved_wire"
  ]);
});

test("stale direct insertions survive load/export and expose runtime-only blocking mechanical guidance", () => {
  const inserted = insertedCapacitorProject();
  const stale = updateComponent(inserted, "cap", { position: [700, 420] });
  const serialized = serializeCircuitLabProject(stale);
  const loaded = parseCircuitLabProjectJson(serialized);
  const states = inspectDirectInsertionState(loaded);
  const result = runCircuitLabTest(loaded);
  const issue = result.issues.find((item) => item.code === "stale-direct-insertion");

  assert.equal(states.length, 1);
  assert.equal(states[0].stale, true);
  assert.equal(loaded.connections.filter((item) => item.kind === "direct-insertion").length, 2);
  assert.equal(issue.severity, "error");
  assert.equal(issue.domain, "mechanical");
  assert.equal(issue.placementRisk, null);
  assert.match(issue.fix, /Re-seat/);
  assert.equal(serialized.includes("placementRisk"), false);
  assert.equal(serialized.includes("stale-direct-insertion"), false);
});

test("Re-seat and Disconnect use the same atomic staged transaction path", () => {
  const inserted = insertedCapacitorProject();
  const stale = updateComponent(inserted, "cap", { position: [700, 420] });
  const reSeat = stageInsertionMutation(stale, stale, "cap", 21, { operationKind: "re-seat", repairMode: true });

  assert.equal(reSeat.status, "electrically-safe");
  assert.deepEqual(reSeat.removedConnectionIds, ["insert_cap_neg", "insert_cap_pos"]);
  assert.deepEqual(reSeat.addedConnectionIds, ["insert_cap_neg", "insert_cap_pos"]);
  const repaired = commitStagedMutation(stale, 21, reSeat);
  assert.equal(repaired.ok, true);
  assert.equal(inspectDirectInsertionState(repaired.project)[0].stale, false);

  const ids = inspectDirectInsertionState(repaired.project)[0].connectionIds;
  const disconnect = stageDisconnectMutation(repaired.project, ids, 22, { componentId: "cap" });
  const disconnected = commitStagedMutation(repaired.project, 22, disconnect);
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.project.connections.some((item) => item.kind === "direct-insertion"), false);
});

test("DRC issues carry runtime domains and canonical deltas distinguish new hazards from unrelated pre-existing hazards", () => {
  const { base, proposed } = reversedCapacitorPlacement();
  const candidate = stageInsertionMutation(base, proposed, "cap", 1).candidateProject;
  const baseTest = runCircuitLabTest(base);
  const candidateTest = runCircuitLabTest(candidate);
  const delta = deriveDrcFingerprintDelta(baseTest.issues, candidateTest.issues);

  assert.equal(candidateTest.issues.every((issue) => ["mechanical", "electrical", "completeness", "metadata"].includes(issue.domain)), true);
  assert.equal(delta.electricalHazards.length > 0, true);
  assert.deepEqual(delta.electricalHazardFingerprints, [...delta.electricalHazardFingerprints].sort());
  const repeated = deriveDrcFingerprintDelta(baseTest.issues, candidateTest.issues);
  assert.deepEqual(repeated.electricalHazardFingerprints, delta.electricalHazardFingerprints);
});

test("target-aware DRC dedupe preserves a distinct second short without re-prompting for an unrelated safe edit", () => {
  let base = emptyProject();
  base = addComponent(base, "supply-servo-6v", { id: "supply_a", position: [160, 140] });
  base = addComponent(base, "supply-servo-6v", { id: "supply_b", position: [360, 140] });
  base = addComponent(base, "breadboard-bb400-400", { id: "bb", position: [650, 325] });
  base = connectTerminals(base, { componentId: "supply_a", terminalId: "VPLUS" }, { componentId: "supply_a", terminalId: "GND" }, { id: "short_a" });
  const candidate = connectTerminals(base, { componentId: "supply_b", terminalId: "VPLUS" }, { componentId: "supply_b", terminalId: "GND" }, { id: "short_b" });
  const baseTest = runCircuitLabTest(base);
  const candidateTest = runCircuitLabTest(candidate);
  const delta = deriveDrcFingerprintDelta(baseTest.issues, candidateTest.issues);

  assert.equal(baseTest.issues.filter((item) => item.code === "power-ground-short").length, 1);
  assert.equal(candidateTest.issues.filter((item) => item.code === "power-ground-short").length, 2);
  assert.equal(delta.added.filter((item) => item.code === "power-ground-short").length, 1);
  assert.equal(delta.electricalHazards.filter((item) => item.code === "power-ground-short").length, 1);
  assert.equal(delta.electricalHazards[0].endpoints.some((endpoint) => endpoint.componentId === "supply_b"), true);

  const safeEdit = stageWireMutation(base, { componentId: "bb", terminalId: "r1a" }, { componentId: "bb", terminalId: "r2a" }, 18);
  assert.equal(safeEdit.status, "electrically-safe");
  assert.equal(safeEdit.requiresConfirmation, false);
  assert.equal(safeEdit.drcDelta.electricalHazardFingerprints.length, 0);
});

test("same-severity transition to electrical placement risk is worsened and unchanged hazards do not re-prompt", () => {
  let base = emptyProject();
  base = addComponent(base, "controller-arduino-uno-r3", { id: "uno", position: [260, 300] });
  base = addComponent(base, "motor-dc", { id: "motor", position: [650, 300] });
  const baseIssue = runCircuitLabTest(base).issues.find((item) => item.code === "inductive-load-without-driver");
  const mutation = stageWireMutation(base, { componentId: "uno", terminalId: "D9" }, { componentId: "motor", terminalId: "a" }, 24);
  const candidateIssue = runCircuitLabTest(mutation.candidateProject).issues.find((item) => item.code === "inductive-load-without-driver");
  const riskDelta = deriveDrcFingerprintDelta([baseIssue], [candidateIssue]);

  assert.equal(baseIssue.severity, "error");
  assert.equal(baseIssue.placementRisk, null);
  assert.equal(candidateIssue.severity, "error");
  assert.equal(candidateIssue.placementRisk, "electrical-hazard");
  assert.equal(mutation.status, "electrically-hazardous");
  assert.equal(mutation.requiresConfirmation, true);
  assert.equal(riskDelta.worsened.filter((item) => item.code === "inductive-load-without-driver").length, 1);
  assert.equal(mutation.drcDelta.worsenedFingerprints.length, 1);

  const unchanged = deriveDrcFingerprintDelta(
    runCircuitLabTest(mutation.candidateProject).issues,
    runCircuitLabTest(mutation.candidateProject).issues
  );
  assert.equal(unchanged.worsened.length, 0);
  assert.equal(unchanged.electricalHazardFingerprints.length, 0);
});

test("manual wire staging catches missing endpoints before commit and preserves the exact base project", () => {
  const { base } = safeCapacitorPlacement();
  const snapshot = JSON.stringify(base);
  const blocked = stageWireMutation(
    base,
    { componentId: "bb", terminalId: "r1a" },
    { componentId: "missing", terminalId: "nope" },
    31
  );
  assert.equal(blocked.status, "mechanically-impossible");
  assert.equal(blocked.mechanical.reasonCode, "invalid-endpoint");
  assert.equal(blocked.candidateProject, null);
  assert.equal(JSON.stringify(base), snapshot);
  const commit = commitStagedMutation(base, 31, blocked);
  assert.equal(commit.ok, false);
  assert.deepEqual(commit.project, base);
});
