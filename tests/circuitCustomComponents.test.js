import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFritzingCustomComponentDefinition,
  sanitizeLocalSvg
} from "../src/circuits/customComponents.js";
import {
  catalog,
  clearCustomCircuitComponents,
  registerCustomCircuitComponents
} from "../src/circuits/catalog.js";
import {
  normalizeProject,
  serializeCircuitLabProject
} from "../src/circuits/model.js";
import { runCircuitLabTest } from "../src/circuits/testBench.js";

const SYNTHETIC_FZP = `
<module moduleId="localWidget">
  <title>Local Widget</title>
  <connectors>
    <connector id="connector0" name="SIG" type="male">
      <gender>male</gender>
      <views><breadboardView><p svgId="pin0" terminalId="term0" /></breadboardView></views>
    </connector>
    <connector id="connector1" name="GND" type="male">
      <gender>male</gender>
      <views><breadboardView><p svgId="pin1" terminalId="term1" /></breadboardView></views>
    </connector>
  </connectors>
  <buses>
    <bus id="common">
      <nodeMember connectorId="connector0" />
      <nodeMember connectorId="connector1" />
    </bus>
  </buses>
</module>`;

const SYNTHETIC_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
  <defs><linearGradient id="bodyGradient"><stop offset="0" stop-color="#fff" /></linearGradient></defs>
  <rect id="body" x="0" y="0" width="20" height="10" fill="url(#bodyGradient)" />
  <circle id="term0" cx="5" cy="5" r="1" />
  <circle id="term1" cx="15" cy="5" r="1" />
</svg>`;

const TRANSFORMED_FZP = `
<module moduleId="transformedWidget">
  <title>Transformed Widget</title>
  <views><breadboardView><layers image="transformed.svg" /></breadboardView></views>
  <connectors>
    <connector id="connector0" name="GROUP" type="male">
      <gender>male</gender>
      <views><breadboardView><p terminalId="pinGroup" /></breadboardView></views>
    </connector>
    <connector id="connector1" name="USE" type="male">
      <gender>male</gender>
      <views><breadboardView><p svgId="pinUse" /></breadboardView></views>
    </connector>
  </connectors>
</module>`;

const TRANSFORMED_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
  <defs>
    <circle id="basePin" cx="1" cy="2" r="1" />
  </defs>
  <g id="pinGroup" transform="translate(10 5)">
    <circle cx="2" cy="3" r="1" />
  </g>
  <use id="pinUse" href="#basePin" x="20" y="8" />
</svg>`;

test("Fritzing local import creates a validated custom component definition", () => {
  const definition = buildFritzingCustomComponentDefinition({
    fzpText: SYNTHETIC_FZP,
    svgText: SYNTHETIC_SVG,
    fzpFileName: "local-widget.fzp",
    svgFileName: "local-widget.svg",
    physicalWidthMm: 20,
    physicalHeightMm: 10,
    licenseAccepted: true,
    now: "2026-06-19T12:00:00.000Z"
  });

  assert.equal(definition.id, "custom:localwidget");
  assert.equal(definition.kind, "CircuitCustomComponentDefinition");
  assert.equal(definition.visual.assetKind, "local-sanitized-svg");
  assert.equal(definition.licenseAcceptance.localOnly, true);
  assert.equal(definition.terminals.length, 2);
  assert.deepEqual(definition.terminals.map((terminal) => terminal.id), ["connector0", "connector1"]);
  assert.deepEqual(definition.terminals[0].positionMm, [-5, 0]);
  assert.deepEqual(definition.terminals[1].positionMm, [5, 0]);
  assert.equal(definition.internalBuses[0].terminalIds.length, 2);
  assert.equal(definition.visual.sanitizedSvg.includes("custom_localwidget__bodygradient"), true);
  assert.equal(definition.visual.sanitizedSvg.includes("id=\"bodyGradient\""), false);
});

test("Fritzing import resolves transformed group and local use anchors", () => {
  const definition = buildFritzingCustomComponentDefinition({
    fzpText: TRANSFORMED_FZP,
    svgText: TRANSFORMED_SVG,
    fzpFileName: "transformed.fzp",
    svgFileName: "transformed.svg",
    physicalWidthMm: 30,
    physicalHeightMm: 20,
    licenseAccepted: true,
    now: "2026-06-19T12:00:00.000Z"
  });

  assert.deepEqual(definition.terminals.map((terminal) => terminal.id), ["connector0", "connector1"]);
  assert.deepEqual(definition.terminals[0].positionMm, [-3, -2]);
  assert.deepEqual(definition.terminals[1].positionMm, [6, 0]);
});

test("Fritzing import requires explicit physical calibration and matching breadboard SVG", () => {
  assert.throws(
    () => buildFritzingCustomComponentDefinition({
      fzpText: SYNTHETIC_FZP,
      svgText: SYNTHETIC_SVG,
      licenseAccepted: true
    }),
    /physical width/
  );
  assert.throws(
    () => buildFritzingCustomComponentDefinition({
      fzpText: TRANSFORMED_FZP,
      svgText: TRANSFORMED_SVG,
      svgFileName: "wrong.svg",
      physicalWidthMm: 30,
      physicalHeightMm: 20,
      licenseAccepted: true
    }),
    /does not match/
  );
});

test("custom SVG sanitizer rejects unsafe external and scripted content", () => {
  assert.throws(
    () => sanitizeLocalSvg(`<svg><script>alert(1)</script></svg>`, "bad"),
    /unsafe/
  );
  assert.throws(
    () => sanitizeLocalSvg(`<svg><image href="https://example.com/part.png" /></svg>`, "bad"),
    /unsafe/
  );
  assert.throws(
    () => sanitizeLocalSvg(`<svg><rect onload="alert(1)" /></svg>`, "bad"),
    /unsafe/
  );
  assert.throws(
    () => sanitizeLocalSvg(`<svg><rect fill="url(#missing)" /></svg>`, "bad"),
    /unresolved id/
  );
  assert.throws(
    () => sanitizeLocalSvg(`<svg><circle id="dup" /><rect id="dup" /></svg>`, "bad"),
    /duplicate ids/
  );
});

test("custom component registry overlays catalog without leaking assets into projects", () => {
  clearCustomCircuitComponents();
  const [registered] = registerCustomCircuitComponents([
    buildFritzingCustomComponentDefinition({
      fzpText: SYNTHETIC_FZP,
      svgText: SYNTHETIC_SVG,
      physicalWidthMm: 20,
      physicalHeightMm: 10,
      licenseAccepted: true,
      now: "2026-06-19T12:00:00.000Z"
    })
  ]);
  const component = catalog.getComponent(registered.id);
  assert.equal(component.id, "custom:localwidget");
  assert.equal(component.custom.localOnly, true);
  assert.equal(component.terminals.length, 2);

  const project = normalizeProject({
    components: [{ id: "local_widget", typeId: component.id, position: [100, 100] }],
    connections: []
  });
  const serialized = serializeCircuitLabProject(project).toLowerCase();
  assert.equal(serialized.includes("<svg"), false);
  assert.equal(serialized.includes(".fzp"), false);
  assert.equal(serialized.includes("fritzing"), false);
  assert.equal(serialized.includes("connector0"), false);
  assert.equal(serialized.includes("sourceasset"), false);
  clearCustomCircuitComponents();
});

test("custom component registry strips imported sim and voltage behavior", () => {
  clearCustomCircuitComponents();
  const [registered] = registerCustomCircuitComponents([{
    kind: "CircuitCustomComponentDefinition",
    version: 1,
    id: "custom:malicious_servo",
    name: "Malicious Servo",
    category: "Custom",
    physical: { physicalSizeMm: [12, 8] },
    terminals: [{
      id: "signal",
      label: "Signal",
      kind: "signal",
      positionMm: [0, 0],
      connectorInterface: "jumper-wire-end",
      electricalRole: "controller-output",
      voltageDomainId: "logic"
    }],
    engineering: {
      specificationBasis: "untrusted",
      voltageDomains: [{ id: "logic", nominalV: 5 }],
      robotics: { role: "actuator", interface: "servo" }
    },
    sim: { role: "servo", signalTerminal: "signal" },
    licenseAcceptance: { accepted: true, localOnly: true, shareAlike: true }
  }]);
  const component = catalog.getComponent(registered.id);
  assert.equal(component.sim.role, "custom");
  assert.equal(component.engineering.specificationBasis, "local-custom");
  assert.deepEqual(component.engineering.voltageDomains, []);
  assert.equal(component.engineering.robotics.role, "passive");
  assert.notEqual(component.terminals[0].electricalRole, "controller-output");
  assert.equal(component.terminals[0].voltageDomainId, null);
  clearCustomCircuitComponents();
});

test("missing custom component IDs stay loadable and produce DRC guidance", () => {
  clearCustomCircuitComponents();
  const project = normalizeProject({
    components: [{ id: "missing", typeId: "custom:missing_part", name: "Missing imported part", position: [100, 100] }],
    connections: []
  });
  const definition = catalog.getComponent("custom:missing_part");
  assert.equal(definition.custom.missing, true);
  const result = runCircuitLabTest(project);
  assert.equal(result.issues.some((issue) => issue.code === "missing-custom-component"), true);
});
