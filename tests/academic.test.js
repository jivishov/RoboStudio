import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { createAssetManifest, manifestSummary, preflightAssetBundle } from "../src/academic/assetManifest.js";
import {
  createDefaultLabSpec,
  createLabReportHtml,
  createLabReportJson,
  evaluateLabSpec,
  labProgress
} from "../src/academic/labs.js";
import {
  createExperimentRun,
  createFabricationReadiness,
  interpolateTrajectory,
  sampleWorkspace,
  serializeExperimentRunsCsv,
  simulatePidResponse
} from "../src/academic/experiments.js";
import {
  createRoboStudioProject,
  createRoboStudioProjectZip,
  parseRoboStudioProjectJson,
  projectBundlePreflight,
  restoreWorkspaceFromRoboStudioProject,
  serializeRoboStudioProject
} from "../src/academic/projectPackage.js";
import { createCircuitLabProject } from "../src/circuits/model.js";
import { createUrdfExport } from "../src/physics/exporters.js";
import { computeForwardKinematics, solveIKCCD } from "../src/physics/kinematics.js";
import { baseStability, computeMassProperties, estimateJointLoads } from "../src/physics/mass.js";
import { evaluateActuators } from "../src/physics/actuators.js";
import { checkCollisionProxies } from "../src/physics/collision.js";

function academicDesign() {
  return {
    version: 1,
    units: "mm",
    name: "Academic two link",
    assumptions: { payloadKg: 0.1, safetyFactor: 2, targetSpeedDegS: 45 },
    links: [
      {
        id: "base",
        name: "Base",
        partIds: ["base"],
        massKg: 1,
        com: [0, 0, 0],
        inertia: [0.01, 0.02, 0.03],
        collisionProxies: [{ id: "base_box", type: "box", origin: [0, -80, 0], dimensions: [80, 40, 80], enabled: true }]
      },
      {
        id: "upper",
        name: "Upper",
        partIds: ["upper"],
        massKg: 0.35,
        com: [50, 0, 0],
        inertia: [0.003, 0.006, 0.008],
        collisionProxies: [{ id: "upper_box", type: "box", origin: [50, 0, 0], dimensions: [90, 18, 18], enabled: true }]
      },
      {
        id: "forearm",
        name: "Forearm",
        partIds: ["forearm"],
        massKg: 0.25,
        com: [50, 0, 0],
        inertia: [0.002, 0.005, 0.006],
        collisionProxies: [{ id: "forearm_box", type: "box", origin: [50, 0, 0], dimensions: [90, 18, 18], enabled: true }]
      }
    ],
    joints: [
      {
        id: "shoulder",
        name: "Shoulder",
        type: "revolute",
        parentLinkId: "base",
        childLinkId: "upper",
        origin: [0, 0, 0],
        axis: [0, 0, 1],
        min: -180,
        max: 180,
        damping: 0.1,
        friction: 0.05,
        actuatorId: "drive"
      },
      {
        id: "elbow",
        name: "Elbow",
        type: "revolute",
        parentLinkId: "upper",
        childLinkId: "forearm",
        origin: [100, 0, 0],
        axis: [0, 0, 1],
        min: -150,
        max: 150,
        damping: 0.1,
        friction: 0.05,
        actuatorId: "drive"
      }
    ],
    endEffectors: [{ id: "tool0", name: "Tool", linkId: "forearm", toolFrame: { position: [90, 0, 0], rotation: [0, 0, 0] } }],
    actuators: [{ id: "drive", name: "Lab drive", continuousTorqueNm: 30, peakTorqueNm: 40, maxSpeedDegS: 360 }],
    allowedCollisions: ["base|upper", "forearm|upper"],
    pose: { jointAngles: { shoulder: 0, elbow: 0 } }
  };
}

function partRecords() {
  return [
    { id: "base", name: "Base", file: "Base.STL", type: "sample" },
    { id: "upper", name: "Upper", file: "C:\\fixtures\\Upper.STL", type: "sample" },
    { id: "forearm", name: "Forearm", type: "generated", source: "part-studio", file: null }
  ];
}

function portablePartRecords() {
  return [
    { id: "base", name: "Base", file: "Base.STL", type: "sample" },
    { id: "upper", name: "Upper", file: "Upper.STL", type: "sample" },
    { id: "forearm", name: "Forearm", file: "Forearm.STL", type: "sample" }
  ];
}

function analysisFor(design, records = partRecords(), ikResult = null) {
  const transforms = computeForwardKinematics(design);
  const mass = computeMassProperties(design, transforms, design.assumptions.payloadKg);
  const loads = estimateJointLoads(design, transforms, design.assumptions);
  return {
    transforms,
    collisions: checkCollisionProxies(design, transforms),
    mass,
    loads,
    actuatorResults: evaluateActuators(design, loads),
    stability: baseStability(design, mass),
    urdf: createUrdfExport(design, records),
    ikResult
  };
}

test("asset manifest normalizes path-like files and preflights portable assets", () => {
  const manifest = createAssetManifest({
    snapshot: { savedAt: "now", glb: new ArrayBuffer(8), parts: partRecords() },
    robotDesign: academicDesign(),
    partLibraryItems: [{ id: "saved_link", name: "Saved link" }],
    generatedAt: "2026-05-30T12:00:00.000Z"
  });

  assert.equal(manifest.assets.some((asset) => asset.id === "snapshot_glb"), true);
  assert.ok(manifest.warnings.some((warning) => warning.code === "asset-path-normalized"));
  assert.equal(manifest.assets.find((asset) => asset.ownerRefs.includes("part:upper")).fileName, "Upper.STL");
  assert.deepEqual(manifestSummary(manifest).byAvailability.generated, 2);
  assert.equal(preflightAssetBundle(manifest).some((issue) => issue.level === "risk"), false);
});

test("RoboStudio project JSON is state-only and zip export is generated from manifest preflight", async () => {
  const currentCircuitLabProject = createCircuitLabProject({ now: "2026-06-18T12:00:00.000Z" });
  const currentMechatronicsBinding = {
    version: 1,
    actuatorBindings: [{ id: "b1", jointId: "shoulder", actuatorId: "strong", circuitComponentId: "servo", firmwareChannelIds: ["ch1"] }],
    firmwareChannels: [
      {
        id: "ch1",
        semanticRole: "joint.command.position",
        direction: "controller-to-device",
        signalType: "servo-pulse",
        valueType: "number",
        controllerTerminalRef: { componentId: "arduino", terminalId: "D9" },
        deviceTerminalRef: { componentId: "servo", terminalId: "signal" },
        generatedSource: "derived"
      }
    ],
    generatedFirmware: "derived",
    bomCsv: "derived",
    localPath: "C:\\secret\\artifact.txt"
  };
  const project = createRoboStudioProject({
    currentAssemblySnapshot: { savedAt: "now", glb: new ArrayBuffer(4), parts: partRecords() },
    robotDesign: academicDesign(),
    currentCircuitDesign: { version: 1, units: "mm", name: "Blink circuit", components: [], nets: [] },
    currentCircuitLabProject,
    currentMechatronicsBinding,
    partLibraryItems: [{ id: "saved_link", name: "Saved link" }]
  });
  const workspaceProject = createRoboStudioProject({
    workspace: {
      currentCircuitDesign: { version: 1, units: "mm", name: "Workspace circuit", components: [], nets: [] },
      currentCircuitLabProject,
      currentMechatronicsBinding
    }
  });
  const olderProject = parseRoboStudioProjectJson(JSON.stringify({
    version: 1,
    exportedAt: "2026-06-18T12:00:00.000Z",
    workspace: {
      currentCircuitDesign: { version: 1, units: "mm", name: "Older circuit", components: [], nets: [] }
    }
  }));
  const parsed = parseRoboStudioProjectJson(serializeRoboStudioProject(project));
  const restored = restoreWorkspaceFromRoboStudioProject(parsed);
  const restoredOlder = restoreWorkspaceFromRoboStudioProject(olderProject);
  const zipBytes = await createRoboStudioProjectZip(project, {
    type: "uint8array",
    assets: [{ path: "assets/current-assembly.glb", data: new Uint8Array([1, 2, 3]) }]
  });

  assert.equal(parsed.workspace.currentAssemblySnapshot.glb, null);
  assert.equal(parsed.workspace.currentAssemblySnapshot.glbRetained, true);
  assert.equal(parsed.workspace.currentCircuitDesign.name, "Blink circuit");
  assert.equal(parsed.workspace.currentCircuitLabProject.kind, "CircuitLabProject");
  assert.equal(parsed.workspace.currentMechatronicsBinding.kind, "MechatronicsBinding");
  assert.equal(parsed.workspace.currentMechatronicsBinding.generatedFirmware, undefined);
  assert.equal(parsed.workspace.currentMechatronicsBinding.firmwareChannels[0].generatedSource, undefined);
  assert.equal(workspaceProject.workspace.currentCircuitDesign.name, "Workspace circuit");
  assert.equal(workspaceProject.workspace.currentCircuitLabProject.kind, "CircuitLabProject");
  assert.equal(parsed.workspace.partLibraryItems[0].id, "saved_link");
  assert.equal(restored.currentCircuitDesign.name, "Blink circuit");
  assert.equal(restored.currentCircuitLabProject.kind, "CircuitLabProject");
  assert.equal(restored.currentMechatronicsBinding.kind, "MechatronicsBinding");
  assert.equal(restoredOlder.currentCircuitDesign.name, "Older circuit");
  assert.equal(restoredOlder.currentCircuitLabProject, null);
  assert.equal(restoredOlder.currentMechatronicsBinding, null);
  assert.equal(restored.partLibraryItems[0].id, "saved_link");
  assert.ok(restored.warnings.some((warning) => warning.code === "snapshot-binary-not-in-json"));
  assert.equal(projectBundlePreflight(project).ready, true);
  assert.ok(zipBytes.length > 100);
  assert.throws(
    () => restoreWorkspaceFromRoboStudioProject({
      version: 1,
      workspace: { currentMechatronicsBinding: { version: 2 } }
    }),
    /version 1/
  );
});

test("RoboStudio project package excludes local Circuit Lab custom libraries", async () => {
  const currentCircuitLabProject = {
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    name: "Custom local part circuit",
    components: [{
      id: "local_widget",
      typeId: "custom:localwidget",
      name: "Local Widget",
      position: [120, 160],
      props: {
        customSvg: "<svg><circle id=\"project_prop_anchor\" /></svg>",
        sourceRevision: "local-secret"
      }
    }],
    connections: [],
    app: { kind: "robotics_starter", notes: "" }
  };
  const project = createRoboStudioProject({
    workspace: {
      currentCircuitLabProject,
      circuitCustomComponents: [{
        id: "custom:localwidget",
        visual: { sanitizedSvg: "<svg><circle id=\"connector0\" /></svg>" },
        provenance: { sourceProject: "Fritzing local import", connectorMappings: [{ terminalId: "connector0", sourceMappingId: "connector0" }] }
      }]
    }
  });
  const json = serializeRoboStudioProject(project);
  const lowerJson = json.toLowerCase();
  const zipBytes = await createRoboStudioProjectZip(project, { type: "uint8array" });
  const zip = await JSZip.loadAsync(zipBytes);
  const packagedJson = await zip.file("robostudio-project.json").async("string");
  const lowerPackagedJson = packagedJson.toLowerCase();

  assert.match(json, /custom:localwidget/);
  for (const forbidden of ["<svg", ".fzp", "connector0", "provenance", "circuitcustomcomponents", "sourcerevision", "fritzing"]) {
    assert.equal(lowerJson.includes(forbidden), false);
    assert.equal(lowerPackagedJson.includes(forbidden), false);
  }
});

test("lab checkpoints, experiment runs, and reports capture undergraduate deliverables", () => {
  const design = academicDesign();
  const ikResult = solveIKCCD(design, "tool0", [0, 190, 0], { toleranceMm: 10, maxIterations: 160 });
  design.pose.jointAngles = { ...design.pose.jointAngles, ...ikResult.jointAngles };
  const analysis = analysisFor(design, portablePartRecords(), ikResult);
  const run = createExperimentRun({ design, analysis, ikResult, simulation: { status: "stepped", steps: 1 }, label: "Payload reach" });
  const lab = createDefaultLabSpec();
  const results = evaluateLabSpec(lab, { design, analysis, ikResult, experimentRuns: [run] });
  const report = createLabReportJson({ labSpec: lab, checkpointResults: results, experimentRuns: [run], design, analysis });
  const html = createLabReportHtml({ labSpec: lab, checkpointResults: results, experimentRuns: [run], design, analysis });
  const csv = serializeExperimentRunsCsv([run]);
  const stableRun = createExperimentRun({
    design,
    analysis,
    createdAt: "2026-05-30T12:00:00.000Z",
    runIndex: 4
  });

  assert.equal(labProgress(results).passed, results.length);
  assert.equal(report.progress.percent, 100);
  assert.match(html, /Robot Modeling And Evidence Lab/);
  assert.match(csv, /Payload reach/);
  assert.equal(stableRun.id, "run_005_2026_05_30T12_00_00_000Z");
  assert.equal(stableRun.label, "Run 5");
});

test("workspace sampling, trajectory interpolation, PID, and fabrication readiness support master-level evidence", () => {
  const design = academicDesign();
  const workspace = sampleWorkspace(design, "tool0");
  const trajectory = interpolateTrajectory([
    { timeS: 0, jointAngles: { shoulder: 0, elbow: 0 } },
    { timeS: 1, jointAngles: { shoulder: 90, elbow: -45 } }
  ], { samplesPerSegment: 4 });
  const pid = simulatePidResponse({ target: 45, durationS: 1, dt: 0.02, kp: 8, kd: 1 });
  const fabrication = createFabricationReadiness(design, partRecords());

  assert.equal(workspace.sampleCount, 6);
  assert.equal(trajectory.length, 5);
  assert.ok(pid.samples.length > 10);
  assert.equal(pid.metrics.overshoot >= 0, true);
  assert.equal(fabrication.bom.some((item) => item.type === "actuator" && item.id === "drive"), true);
  assert.equal(fabrication.missingFileCount, 1);
});
