import JSZip from "jszip";
import { normalizeProject as normalizeCircuitLabProject } from "../circuits/model.js";
import { normalizeMechatronicsBinding } from "../mechatronics/model.js";
import { createAssetManifest, preflightAssetBundle } from "./assetManifest.js";

export const ROBOSTUDIO_PROJECT_VERSION = 1;

function basename(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.split(/[\\/]/).filter(Boolean).at(-1) ?? text;
}

function stripBinarySnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    savedAt: snapshot.savedAt ?? null,
    glb: null,
    glbRetained: Boolean(snapshot.glb),
    glbByteLength: snapshot.glb?.byteLength ?? snapshot.glb?.size ?? null,
    layout: snapshot.layout ?? null,
    parts: (snapshot.parts ?? []).map((part) => ({
      id: part.id,
      label: part.label ?? part.name ?? part.id,
      name: part.name ?? part.label ?? part.id,
      type: part.type ?? "assembly",
      source: part.source ?? null,
      file: basename(part.file),
      visible: part.visible !== false,
      triangles: part.triangles ?? 0,
      bounds: part.bounds ?? null,
      matrixWorld: part.matrixWorld ?? null
    }))
  };
}

function projectWarnings(manifest, preflightIssues) {
  return [
    ...(manifest?.warnings ?? []),
    ...preflightIssues.filter((issue) => issue.level === "risk").map((issue) => ({
      code: issue.code,
      message: issue.message,
      assetId: issue.assetId ?? null
    }))
  ];
}

export function createRoboStudioProject(input = {}) {
  const workspace = input.workspace ?? {};
  const snapshot = input.currentAssemblySnapshot ?? workspace.currentAssemblySnapshot ?? null;
  const robotDesign = input.robotDesign ?? workspace.currentRobotDesign ?? null;
  const circuitDesign = input.currentCircuitDesign ?? workspace.currentCircuitDesign ?? null;
  const circuitLabProject = input.currentCircuitLabProject ?? workspace.currentCircuitLabProject ?? null;
  const mechatronicsBinding = input.currentMechatronicsBinding ?? workspace.currentMechatronicsBinding ?? null;
  const partLibraryItems = input.partLibraryItems ?? workspace.partLibraryItems ?? [];
  const manifest = input.manifest ?? createAssetManifest({
    snapshot,
    robotDesign,
    partRecords: input.partRecords ?? snapshot?.parts ?? [],
    partLibraryItems,
    generatedAt: input.exportedAt
  });
  const preflightIssues = preflightAssetBundle(manifest);

  return {
    version: ROBOSTUDIO_PROJECT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    workspace: {
      currentAssemblySnapshot: stripBinarySnapshot(snapshot),
      currentRobotDesign: robotDesign ?? null,
      currentCircuitDesign: circuitDesign ?? null,
      currentCircuitLabProject: circuitLabProject ? normalizeCircuitLabProject(circuitLabProject) : null,
      currentMechatronicsBinding: mechatronicsBinding ? normalizeMechatronicsBinding(mechatronicsBinding) : null,
      partLibraryItems: Array.isArray(partLibraryItems) ? partLibraryItems : []
    },
    manifest,
    warnings: projectWarnings(manifest, preflightIssues)
  };
}

export function serializeRoboStudioProject(project) {
  return JSON.stringify(project, null, 2);
}

export function parseRoboStudioProjectJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`RoboStudio project JSON is invalid: ${error.message}`);
  }
  if (!parsed || parsed.version !== ROBOSTUDIO_PROJECT_VERSION || !parsed.workspace) {
    throw new Error("RoboStudio project JSON must use version 1 and include a workspace.");
  }
  return parsed;
}

export function projectBundlePreflight(project) {
  const issues = preflightAssetBundle(project?.manifest);
  const riskCount = issues.filter((issue) => issue.level === "risk").length;
  return {
    ready: riskCount === 0,
    issues
  };
}

export async function createRoboStudioProjectZip(project, options = {}) {
  const preflight = projectBundlePreflight(project);
  if (!preflight.ready && options.allowBlocked !== true) {
    throw new Error("RoboStudio project bundle is blocked by missing required assets.");
  }
  const zip = new JSZip();
  zip.file("robostudio-project.json", serializeRoboStudioProject(project));
  zip.file("manifest.json", JSON.stringify(project.manifest ?? {}, null, 2));
  for (const asset of options.assets ?? []) {
    if (!asset?.path || asset.data == null) continue;
    zip.file(asset.path, asset.data);
  }
  zip.file(
    "README.txt",
    [
      "RoboStudio project bundle",
      "",
      "This archive contains editable RoboStudio state and an asset manifest.",
      "Binary STL/GLB assets are included when the exporter can read retained or app-owned mesh data.",
      "Open robostudio-project.json in RoboStudio to restore the editable design state."
    ].join("\n")
  );
  return zip.generateAsync({
    type: options.type ?? "blob",
    compression: "DEFLATE"
  });
}

export function restoreWorkspaceFromRoboStudioProject(project) {
  const parsed = typeof project === "string" ? parseRoboStudioProjectJson(project) : project;
  const warnings = [];
  const snapshot = parsed.workspace?.currentAssemblySnapshot ?? null;
  const circuitLabProject = parsed.workspace?.currentCircuitLabProject
    ? normalizeCircuitLabProject(parsed.workspace.currentCircuitLabProject)
    : null;
  const mechatronicsBinding = parsed.workspace?.currentMechatronicsBinding
    ? normalizeMechatronicsBinding(parsed.workspace.currentMechatronicsBinding)
    : null;
  if (snapshot?.glbRetained) {
    warnings.push({
      code: "snapshot-binary-not-in-json",
      message: "The JSON project records that a GLB snapshot existed, but state-only JSON does not include the binary GLB."
    });
  }
  return {
    currentAssemblySnapshot: snapshot,
    currentRobotDesign: parsed.workspace?.currentRobotDesign ?? null,
    currentCircuitDesign: parsed.workspace?.currentCircuitDesign ?? null,
    currentCircuitLabProject: circuitLabProject,
    currentMechatronicsBinding: mechatronicsBinding,
    partLibraryItems: parsed.workspace?.partLibraryItems ?? [],
    warnings
  };
}
