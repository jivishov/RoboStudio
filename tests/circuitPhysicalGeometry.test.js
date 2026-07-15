import assert from "node:assert/strict";
import test from "node:test";

import { assetRegistrationCatalog, listAssetRegistrations, registeredRasterFrame } from "../src/circuits/assetRegistrations.js";
import { catalog } from "../src/circuits/catalog.js";
import { connectionFittingDescriptors } from "../src/circuits/connectionFittings.js";
import { resolveTerminal } from "../src/circuits/connectivity.js";
import { geometryEvidenceForComponent, listGeometryEvidence } from "../src/circuits/geometryEvidence.js";
import { listPhysicalDefinitions, physicalCatalog } from "../src/circuits/physicalCatalog.js";
import { validateAssetRegistration, validateGeometryEvidenceRecord, validatePhysicalDefinition } from "../src/circuits/physicalValidation.js";
import { normalizeProject } from "../src/circuits/model.js";

const BUILT_IN_IDS = Object.freeze(catalog.listComponents().map((component) => component.id));

function pointInBounds(point, bounds, tolerance = 0.001) {
  return point[0] >= bounds.x - tolerance
    && point[0] <= bounds.x + bounds.width + tolerance
    && point[1] >= bounds.y - tolerance
    && point[1] <= bounds.y + bounds.height + tolerance;
}

function manualWorldPosition(component, terminal) {
  const radians = Number(component.rotation) * Math.PI / 180;
  const scale = Number(component.props?.scale ?? 1);
  const x = terminal.position[0] * scale;
  const y = terminal.position[1] * scale;
  return [
    component.position[0] + x * Math.cos(radians) - y * Math.sin(radians),
    component.position[1] + x * Math.sin(radians) + y * Math.cos(radians)
  ];
}

test("every built-in has decision-complete geometry evidence and constrained asset registration", () => {
  assert.equal(BUILT_IN_IDS.length, 36);
  assert.equal(listAssetRegistrations().length, 36);
  assert.equal(listGeometryEvidence().length, 37, "visible built-ins plus the hidden legacy breadboard are classified");
  for (const componentId of BUILT_IN_IDS) {
    const component = catalog.getComponent(componentId);
    const physical = physicalCatalog[componentId];
    const evidence = geometryEvidenceForComponent(componentId);
    const registration = assetRegistrationCatalog[componentId];
    assert.ok(physical, `${componentId} has physical geometry`);
    assert.deepEqual(validateGeometryEvidenceRecord(evidence), [], `${componentId} evidence is valid`);
    assert.deepEqual(validatePhysicalDefinition(physical, component), [], `${componentId} physical geometry is valid`);
    assert.deepEqual(validateAssetRegistration(registration, physical, evidence), [], `${componentId} registration is valid`);
    assert.ok(registration.reviewLandmarks.length >= 2, `${componentId} has review landmarks`);
    assert.equal("perspective" in registration, false);
    assert.equal("shear" in registration, false);
    assert.equal("terminalTransform" in registration, false);
  }
});

test("right-angle asset registration keeps uniform pixels and applies translation in final component coordinates", () => {
  const frame = registeredRasterFrame({
    rasterCrop: { units: "normalized", x: 0, y: 0, width: 1, height: 1 },
    uniformScale: 1,
    translationMm: [3, 4],
    orientationDeg: 90
  }, 100, 50, 40, 30);
  assert.equal(frame.mmPerPixel, 0.3);
  assert.equal(frame.width, 30);
  assert.equal(frame.height, 15);
  const center = [frame.x + frame.width / 2, frame.y + frame.height / 2];
  const rotatedCenter = [20 - (center[1] - 15), 15 + (center[0] - 20)];
  assert.ok(Math.hypot(rotatedCenter[0] - 23, rotatedCenter[1] - 19) < 0.001);
});

test("official UNO, ESP32-DevKitC V4, and BB400 maps retain documented dimensions, order, and pitch", () => {
  const uno = physicalCatalog["controller-arduino-uno-r3"];
  assert.deepEqual(uno.physicalSizeMm, [72.58, 53.34]);
  assert.deepEqual(uno.physicalPorts.map((port) => port.terminalIds), [
    ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"],
    ["D8", "D9", "D10", "D11", "D12", "D13", "GND3", "AREF", "SDA", "SCL"],
    ["NC", "IOREF", "RESET", "3V3", "5V", "GND", "GND2", "VIN"],
    ["A0", "A1", "A2", "A3", "A4", "A5"]
  ]);
  assert.deepEqual(uno.terminals.D0.positionMm, [31.21, -24.13]);
  assert.deepEqual(uno.terminals.SCL.positionMm, [-13.494, -24.13]);

  const esp32 = physicalCatalog["controller-esp32-devkit"];
  assert.deepEqual(esp32.physicalSizeMm, [27.94, 48.26]);
  assert.equal(esp32.physicalPorts.length, 2);
  assert.equal(esp32.physicalPorts.every((port) => port.terminalIds.length === 19 && port.contactPitchMm === 2.54), true);
  assert.deepEqual(esp32.physicalPorts[0].terminalIds.slice(0, 5), ["3V3", "EN", "GPIO36", "GPIO39", "GPIO34"]);
  assert.deepEqual(esp32.physicalPorts[1].terminalIds.slice(-5), ["GPIO2", "GPIO15", "D1", "D0", "CLK"]);
  const legacyEsp32DevKit30TerminalIds = [
    "VIN", "GND2", "GPIO13", "GPIO12", "GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32",
    "GPIO35", "GPIO34", "GPIO39", "GPIO36", "EN", "3V3", "GND", "GPIO15", "GPIO2", "GPIO4",
    "GPIO16", "GPIO17", "GPIO5", "GPIO18", "GPIO19", "GPIO21", "GPIO3", "GPIO1", "GPIO22", "GPIO23"
  ];
  const currentEsp32TerminalIds = new Set(catalog.getComponent("controller-esp32-devkit").terminals.map((terminal) => terminal.id));
  assert.equal(legacyEsp32DevKit30TerminalIds.every((terminalId) => currentEsp32TerminalIds.has(terminalId)), true, "the legacy 30-pin compatibility IDs remain stable");

  const bb400 = physicalCatalog["breadboard-bb400-400"];
  assert.deepEqual(bb400.physicalSizeMm, [84, 54.3]);
  assert.equal(Object.keys(bb400.terminals).length, 400);
  assert.ok(Math.abs(bb400.terminals.r2a.positionMm[0] - bb400.terminals.r1a.positionMm[0] - 2.54) < 0.001);
  assert.ok(Math.abs(bb400.terminals.r1b.positionMm[1] - bb400.terminals.r1a.positionMm[1] - 2.54) < 0.001);
});

test("JST and screw-terminal contacts are grouped only by their actual shared housings", () => {
  const housedInterfaces = new Set(["jst-power-lead", "screw-terminal"]);
  let jstPortCount = 0;
  let screwTerminalPortCount = 0;

  for (const physical of listPhysicalDefinitions()) {
    const terminalGroups = new Map();
    for (const [terminalId, terminal] of Object.entries(physical.terminals)) {
      if (!housedInterfaces.has(terminal.connectorInterface)) continue;
      const key = `${terminal.connectorInterface}:${terminal.connectorId}`;
      const group = terminalGroups.get(key) ?? [];
      group.push(terminalId);
      terminalGroups.set(key, group);
    }

    for (const [key, terminalIds] of terminalGroups) {
      const [connectorInterface, connectorId] = key.split(":");
      const matchingPorts = physical.physicalPorts.filter((port) => port.engineeringConnectorId === connectorId);
      assert.equal(matchingPorts.length, 1, `${physical.id}.${connectorId} has one actual housing`);
      assert.deepEqual(new Set(matchingPorts[0].terminalIds), new Set(terminalIds), `${physical.id}.${connectorId} contains exactly its housed contacts`);
      if (connectorInterface === "jst-power-lead") jstPortCount += 1;
      if (connectorInterface === "screw-terminal") screwTerminalPortCount += 1;
    }
  }

  assert.equal(jstPortCount, 1, "the LiPo JST plug is modeled as one two-contact housing");
  assert.equal(screwTerminalPortCount, 8, "all eight built-in screw-terminal blocks are modeled independently");
});

test("physical ports use unique ordered contacts and sourced pitch within acceptance tolerance", () => {
  for (const physical of listPhysicalDefinitions()) {
    const membership = new Set();
    for (const port of physical.physicalPorts) {
      assert.ok(port.terminalIds.length >= 2, `${physical.id}.${port.id} is a shared housing`);
      for (const terminalId of port.terminalIds) {
        assert.equal(membership.has(terminalId), false, `${physical.id}.${terminalId} belongs to one housing`);
        membership.add(terminalId);
        assert.equal(pointInBounds(physical.terminals[terminalId].positionMm, port.housingBoundsMm), true);
      }
      for (let index = 1; index < port.terminalIds.length; index += 1) {
        const previous = physical.terminals[port.terminalIds[index - 1]].positionMm;
        const current = physical.terminals[port.terminalIds[index]].positionMm;
        const measured = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
        const tolerance = Math.max(0.25, port.contactPitchMm * 0.05);
        assert.ok(Math.abs(measured - port.contactPitchMm) <= tolerance, `${physical.id}.${port.id} pitch is within ${tolerance} mm`);
      }
    }
  }
});

test("PCA9685 and both servo variants expose one correctly ordered three-contact housing per servo port", () => {
  const pca = physicalCatalog["driver-pca9685-servo"];
  const channels = pca.physicalPorts.filter((port) => /^ch\d+-port$/u.test(port.id));
  assert.equal(channels.length, 16);
  channels.forEach((port, index) => {
    assert.deepEqual(port.terminalIds, [`ch${index}_signal`, `ch${index}_vplus`, `ch${index}_gnd`]);
    assert.equal(port.contactPitchMm, 2.54);
    assert.equal(pointInBounds([port.housingBoundsMm.x, port.housingBoundsMm.y], pca.visualBoundsMm), true);
    assert.equal(pointInBounds([port.housingBoundsMm.x + port.housingBoundsMm.width, port.housingBoundsMm.y + port.housingBoundsMm.height], pca.visualBoundsMm), true);
  });
  for (const componentId of ["servo-standard", "servo-micro-9g"]) {
    const physical = physicalCatalog[componentId];
    assert.equal(physical.physicalPorts.length, 1);
    assert.deepEqual(physical.physicalPorts[0].terminalIds, ["signal", "vplus", "gnd"]);
    assert.equal(physical.physicalPorts[0].contactPitchMm, 2.54);
  }
});

test("formed leads terminate at immutable external anchors and every off-body contact is explicitly tagged", () => {
  for (const componentId of ["led-red", "resistor-220", "capacitor-electrolytic-470uf"]) {
    const physical = physicalCatalog[componentId];
    for (const [terminalId, path] of Object.entries(physical.formedLeadGeometry.leadPathsMm)) {
      assert.deepEqual(path.at(-1), physical.terminals[terminalId].positionMm);
      assert.equal(physical.terminals[terminalId].anchorKind, "external-lead");
    }
  }
  for (const physical of listPhysicalDefinitions()) {
    for (const terminal of Object.values(physical.terminals)) {
      if (!pointInBounds(terminal.positionMm, physical.bodyBoundsMm) || !pointInBounds(terminal.positionMm, physical.visualBoundsMm)) {
        assert.ok(["external-lead", "external-port"].includes(terminal.anchorKind), `${physical.id} off-body terminal is tagged`);
      }
    }
  }
});

test("resolver, rendered local transform, and fixed-normal fitting centers agree at every right-angle rotation", () => {
  for (const componentId of BUILT_IN_IDS) {
    const definition = catalog.getComponent(componentId);
    const terminal = definition.terminals[0];
    for (const rotation of [0, 90, 180, 270]) {
      const subject = { id: "subject", typeId: componentId, name: definition.name, position: [220, 210], rotation, props: { scale: 1 } };
      const mate = { id: "mate", typeId: componentId, name: `${definition.name} mate`, position: [620, 430], rotation: 0, props: { scale: 1 } };
      const project = normalizeProject({
        version: 1,
        units: "mm",
        components: [subject, mate],
        connections: [{ id: "wire", kind: "wire", color: "#f59e0b", endpoints: [{ componentId: "subject", terminalId: terminal.id }, { componentId: "mate", terminalId: terminal.id }] }],
        controllerId: null,
        app: {},
        updatedAt: "2026-07-14T00:00:00.000Z"
      });
      const resolved = resolveTerminal(project, { componentId: "subject", terminalId: terminal.id });
      const rendered = manualWorldPosition(subject, terminal);
      const fitting = connectionFittingDescriptors(project).find((item) => item.endpointKey === `subject:${terminal.id}`);
      assert.ok(resolved.ok && fitting, `${componentId} rotation ${rotation} resolves`);
      assert.ok(Math.hypot(resolved.worldPosition[0] - rendered[0], resolved.worldPosition[1] - rendered[1]) <= 0.01);
      assert.ok(Math.hypot(fitting.position[0] - resolved.worldPosition[0], fitting.position[1] - resolved.worldPosition[1]) <= 0.01);
      assert.ok(Math.abs(Math.hypot(...fitting.outwardNormalWorld) - 1) <= 0.001);
    }
  }
});
