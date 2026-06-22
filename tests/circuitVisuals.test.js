import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { catalog } from "../src/circuits/catalog.js";
import { connectionFittingDescriptors } from "../src/circuits/connectionFittings.js";
import { physicalCatalog } from "../src/circuits/physicalCatalog.js";
import { listVisualDefinitions } from "../src/circuits/visualCatalog.js";
import { visualProvenanceRecords } from "../src/circuits/generated/visualProvenance.js";
import { photorealAssetIds, getPhotorealAssetUrl } from "../src/circuits/generated/photorealAssets.js";
import { insertComponentIntoNearestTerminals } from "../src/circuits/insertion.js";
import { shouldRenderExternalWire } from "../src/circuits/wireRenderer.js";
import { addComponent, createCircuitLabProject, normalizeProject, serializeCircuitLabProject, updateComponent } from "../src/circuits/model.js";

const PLANNED_PHOTOREAL_IDS = Object.freeze([
  "controller-arduino-uno-r3",
  "controller-esp32-devkit",
  "breadboard-bb400-400",
  "supply-servo-6v",
  "servo-standard",
  "led-red",
  "resistor-220",
  "capacitor-electrolytic-470uf",
  "button-tactile",
  "ultrasonic-hcsr04",
  "driver-l298n",
  "motor-dc",
  "potentiometer-10k",
  "switch-spdt-slide",
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

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("Circuit visual catalog maps every physical terminal without owning coordinates", () => {
  for (const visual of listVisualDefinitions()) {
    const physical = physicalCatalog[visual.physicalDefinitionId];
    assert.ok(physical, `${visual.id} references a physical definition`);
    assert.equal(JSON.stringify(visual.terminalVisuals).includes("positionMm"), false);
    assert.deepEqual(
      Object.keys(visual.terminalVisuals).sort(),
      Object.keys(physical.terminals).sort(),
      `${visual.id} terminal mappings match physical anchors`
    );
  }
});

test("photoreal wrapper registry covers current built-ins and the robotics component wave", () => {
  assert.equal(new Set(photorealAssetIds).size, photorealAssetIds.length);
  for (const componentId of PLANNED_PHOTOREAL_IDS) {
    const component = catalog.getComponent(componentId);
    const visual = listVisualDefinitions().find((item) => item.id === componentId);
    assert.ok(component, `${componentId} is present in the circuit catalog`);
    assert.equal(component.hidden, false, `${componentId} remains visible in the hardware library`);
    assert.equal(visual?.assetKind, "photorealistic-svg-wrapper", `${componentId} uses a photoreal wrapper`);
    assert.equal(visual?.assetId, componentId, `${componentId} visual references its generated wrapper`);
    assert.equal(photorealAssetIds.includes(componentId), true, `${componentId} is generated`);
    assert.match(getPhotorealAssetUrl(componentId), new RegExp(`${componentId}\\.svg$`));
    const wrapper = fs.readFileSync(new URL(`../src/circuits/assets/photoreal/${componentId}.svg`, import.meta.url), "utf8");
    assert.match(wrapper, /href="data:image\/png;base64,/u, `${componentId} wrapper embeds a raster PNG`);
    assert.doesNotMatch(wrapper, /<(?:rect|circle|ellipse|path|text)\b/iu, `${componentId} wrapper does not fall back to procedural SVG`);
  }
});

test("photoreal manifest records explicit source and wrapper paths", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../scripts/circuits/photoreal-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.sourceSheet, "src/circuits/assets/photoreal/source/robostudio-photoreal-sheet.png");
  assert.deepEqual(manifest.grid, { columns: 6, rows: 6 });
  assert.equal(manifest.components.length, PLANNED_PHOTOREAL_IDS.length);
  for (const component of manifest.components) {
    assert.equal(component.rasterSource, `src/circuits/assets/photoreal/raster/${component.id}.png`);
    assert.equal(component.svgWrapper, `src/circuits/assets/photoreal/${component.id}.svg`);
  }
});

test("raster wrapper utility emits production wrapper metadata", () => {
  const scriptPath = fileURLToPath(new URL("../scripts/circuits/wrap-raster-visual.mjs", import.meta.url));
  const rasterPath = fileURLToPath(new URL("../src/circuits/assets/photoreal/raster/led-red.png", import.meta.url));
  const output = execFileSync(process.execPath, [scriptPath, rasterPath, "18", "18", "--component-id", "led-red"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(output, /data-component-id="led-red"/u);
  assert.match(output, /data-asset-kind="photorealistic-svg-wrapper"/u);
  assert.match(output, /data-raster-source="led-red\.png"/u);
  assert.match(output, /href="data:image\/png;base64,/u);
  assert.doesNotMatch(output, /<(?:rect|circle|ellipse|path|text)\b/iu);
  const outputWithoutNamespace = output.replace(/\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u, "");
  assert.doesNotMatch(outputWithoutNamespace, /(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/|sha256|file_id|https?:\/\/)/iu);
});

test("stateful photoreal controls keep declarative overlay mappings", () => {
  const expectations = new Map([
    ["servo-standard", "previewAngleDeg"],
    ["servo-micro-9g", "previewAngleDeg"],
    ["supply-servo-6v", "power"],
    ["button-tactile", "press"],
    ["potentiometer-10k", "wiper"],
    ["switch-spdt-slide", "throw"],
    ["switch-limit-micro", "throw"]
  ]);
  for (const [componentId, controlId] of expectations) {
    const visual = listVisualDefinitions().find((item) => item.id === componentId);
    assert.ok(visual?.controlVisuals?.[controlId], `${componentId} exposes ${controlId} state overlay metadata`);
  }
});

test("BB400, Arduino, ESP32, and legacy breadboard expose expected physical counts", () => {
  const bb400 = catalog.getComponent("breadboard-bb400-400");
  const legacy = catalog.getComponent("breadboard-400");
  const arduino = catalog.getComponent("controller-arduino-uno-r3");
  const esp32 = catalog.getComponent("controller-esp32-devkit");

  assert.equal(bb400.terminals.length, 400);
  assert.equal(bb400.internalBuses.filter((bus) => /^top_|^bottom_/.test(bus.id)).every((bus) => bus.terminalIds.length === 25), true);
  assert.equal(legacy.terminals.length, 420);
  assert.equal(catalog.listComponents().some((item) => item.id === "breadboard-400"), false);
  assert.equal(arduino.terminals.length, 31);
  assert.equal(esp32.terminals.length, 30);
  assert.deepEqual(
    esp32.engineering.connectors[0].terminalIds,
    ["VIN", "GND2", "GPIO13", "GPIO12", "GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39", "GPIO36", "EN", "3V3", "GND", "GPIO15", "GPIO2", "GPIO4", "GPIO16", "GPIO17", "GPIO5", "GPIO18", "GPIO19", "GPIO21", "GPIO3", "GPIO1", "GPIO22", "GPIO23"]
  );
});

test("visual provenance approves Wokwi records and blocks Fritzing graphics", () => {
  const wokwi = visualProvenanceRecords.filter((record) => record.sourceProject === "wokwi/wokwi-elements");
  assert.equal(wokwi.length > 0, true);
  assert.equal(wokwi.every((record) => record.licenseSpdx === "MIT" && record.sourceRevision === "3c8178e" && record.approvalStatus === "approved"), true);
  assert.equal(wokwi.every((record) => record.generatedAssetPaths.length === 0), true);
  assert.equal(listVisualDefinitions().some((visual) => visual.provenanceId.startsWith("wokwi-")), false);

  const fritzing = visualProvenanceRecords.find((record) => record.sourceProject === "Fritzing parts");
  assert.equal(fritzing.approvalStatus, "blocked");
  assert.equal(fritzing.generatedAssetPaths.length, 0);
});

test("direct insertion uses connection kind and is suppressed from external wire rendering", () => {
  let project = createCircuitLabProject();
  project = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  project = updateComponent(project, "cap", { position: [487.78, 417.05] });
  const insertion = insertComponentIntoNearestTerminals(project, "cap");
  const inserted = insertion.project.connections.filter((connection) => connection.id.startsWith("insert_cap_"));

  assert.equal(inserted.length, 2);
  assert.equal(inserted.every((connection) => connection.kind === "direct-insertion"), true);
  assert.equal(inserted.every((connection) => shouldRenderExternalWire(connection) === false), true);
  assert.equal(shouldRenderExternalWire({ kind: "wire" }), true);
});

test("connection fitting descriptors classify realistic wire and inserted endpoint hardware", () => {
  const starterFittings = connectionFittingDescriptors(createCircuitLabProject());
  assert.equal(starterFittings.some((item) => item.type === "breadboard-wire" && item.endpoint.componentId === "breadboard" && item.endpoint.terminalId === "bp5"), true);
  assert.equal(starterFittings.some((item) => item.type === "dupont-header" && item.endpoint.componentId === "arduino" && item.endpoint.terminalId === "D9"), true);
  assert.equal(starterFittings.some((item) => item.type === "servo-plug" && item.endpoint.componentId === "servo" && item.endpoint.terminalId === "signal"), true);
  assert.equal(starterFittings.some((item) => item.type === "ferrule" && item.endpoint.componentId === "supply" && item.endpoint.terminalId === "VPLUS"), true);

  let project = createCircuitLabProject();
  project = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  project = updateComponent(project, "cap", { position: [487.78, 417.05] });
  const insertedProject = insertComponentIntoNearestTerminals(project, "cap").project;
  const insertedFittings = connectionFittingDescriptors(insertedProject);
  assert.equal(insertedFittings.some((item) => item.type === "inserted-breadboard-lead" && item.endpoint.componentId === "breadboard"), true);
  assert.equal(insertedFittings.some((item) => item.type === "inserted-lead" && item.endpoint.componentId === "cap"), true);
});

test("CircuitLabProject serialization strips visual/provenance asset fields", () => {
  const project = normalizeProject({
    components: [{
      id: "supply",
      typeId: "supply-servo-6v",
      name: "Supply",
      position: [100, 100],
      visualSymbolId: "wokwi-secret",
      sourceRevision: "3c8178e",
      props: {
        scale: 1,
        controls: { power: "on" },
        provenanceId: "wokwi-elements",
        assetPath: "C:\\secret\\visual.svg"
      }
    }],
    connections: [{
      id: "wire",
      kind: "wire",
      endpoints: [],
      sourceConnectorRef: "fritzing-pin",
      svg: "<svg></svg>"
    }]
  });
  const serialized = serializeCircuitLabProject(project).toLowerCase();

  assert.equal(serialized.includes(".svg"), false);
  assert.equal(serialized.includes(".png"), false);
  assert.equal(serialized.includes("wokwi"), false);
  assert.equal(serialized.includes("fritzing"), false);
  assert.equal(serialized.includes("provenance"), false);
  assert.equal(serialized.includes("3c8178e"), false);
  assert.equal(serialized.includes("c:\\secret"), false);
});
