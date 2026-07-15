import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { createCircuitBuildGuideZip } from "../src/circuits/artifactZip.js";
import { buildCircuitArtifacts } from "../src/circuits/artifacts.js";
import { generateCircuitLabSource } from "../src/circuits/codegen.js";
import { serializeCircuitLabProject } from "../src/circuits/model.js";

const FORBIDDEN_RUNTIME_OR_ASSET_MARKERS = [
  "<svg",
  ".fzp",
  "fritzing",
  "provenance",
  "sourcerevision",
  "c:\\secret",
  "sha256",
  "file_id",
  "viewzoom",
  "viewbox",
  "drawer",
  "ghost",
  "targetlock",
  "screenpoint",
  "unsafeconfirmation",
  "stagedmutation",
  "placementrisk",
  "historyStack".toLowerCase()
];

function boundaryFixture() {
  return {
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    name: "Cycle 5 boundary fixture",
    mode: "wire",
    components: [{
      id: "local_widget",
      typeId: "custom:localwidget",
      name: "Local widget",
      position: [120, 160],
      props: {
        scale: 1,
        customSvg: "<svg><circle id='connector0' /></svg>",
        sourceRevision: "Fritzing-local",
        localPath: "C:\\secret\\part.fzp",
        providerFileId: "file_id_runtime"
      }
    }],
    connections: [],
    app: { kind: "robotics_starter", notes: "" },
    viewZoom: 8,
    viewBox: "0 0 10 10",
    drawer: "hardware",
    ghost: { x: 1 },
    targetLock: { componentId: "local_widget", terminalId: "connector0" },
    screenPoint: [20, 30],
    unsafeConfirmation: { accepted: true },
    stagedMutation: { id: "runtime-only" },
    placementRisk: "electrical-hazard",
    historyStack: [{ id: "runtime-only" }]
  };
}

function assertBoundaryClean(text, label) {
  const normalized = String(text).toLowerCase();
  assert.match(normalized, /custom:localwidget/u, `${label} retains the stable custom type id`);
  for (const marker of FORBIDDEN_RUNTIME_OR_ASSET_MARKERS) {
    assert.equal(normalized.includes(marker), false, `${label} excludes ${marker}`);
  }
}

test("Cycle 5 project, build-guide ZIP, and source exports retain stable IDs without local assets or transient state", async () => {
  const fixture = boundaryFixture();
  assertBoundaryClean(serializeCircuitLabProject(fixture), "CircuitLabProject JSON");

  const artifacts = buildCircuitArtifacts({ circuitLabProject: fixture });
  assertBoundaryClean(artifacts.files["circuit-lab-project.json"], "build-guide project JSON");
  const zipBytes = await createCircuitBuildGuideZip(artifacts, { type: "uint8array" });
  const zip = await JSZip.loadAsync(zipBytes);
  const zipText = (await Promise.all(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.async("string"))
  )).join("\n");
  assertBoundaryClean(zipText, "build-guide ZIP");
  assert.match(zipText, /did not compile, flash, execute, inspect, or hardware-test/u);

  const source = generateCircuitLabSource(fixture);
  const sourceText = source.files.map((file) => `${file.path}\n${file.content}`).join("\n");
  assertBoundaryClean(sourceText, "source export");
  assert.match(sourceText, /source-only/u);
  assert.match(sourceText, /not built, flashed, executed, or hardware-tested/u);
});
