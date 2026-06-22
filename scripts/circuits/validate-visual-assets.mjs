import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertRepoRelativePath,
  hasForbiddenEmbeddedData,
  readPngInfo,
  stripPngMetadata
} from "./png-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const allowlistPath = path.join(repoRoot, "scripts", "circuits", "asset-allowlist.json");
const photorealManifestPath = path.join(repoRoot, "scripts", "circuits", "photoreal-manifest.json");
const photorealAssetDir = path.join(repoRoot, "src", "circuits", "assets", "photoreal");
const photorealRasterDir = path.join(photorealAssetDir, "raster");
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
const photorealManifest = JSON.parse(fs.readFileSync(photorealManifestPath, "utf8"));
const { visualProvenanceRecords } = await import(pathToFileURL(path.join(repoRoot, "src", "circuits", "generated", "visualProvenance.js")));
const { photorealAssetIds, photorealAssetUrls } = await import(pathToFileURL(path.join(repoRoot, "src", "circuits", "generated", "photorealAssets.js")));
const { listPhysicalDefinitions } = await import(pathToFileURL(path.join(repoRoot, "src", "circuits", "physicalCatalog.js")));
const { listVisualDefinitions } = await import(pathToFileURL(path.join(repoRoot, "src", "circuits", "visualCatalog.js")));

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function numbersMatch(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

function resolveManifestPath(value, label) {
  try {
    return assertRepoRelativePath(repoRoot, value, label);
  } catch (error) {
    fail(error.message);
    return null;
  }
}

function readPngFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const source = fs.readFileSync(filePath);
    return {
      source,
      info: readPngInfo(source, label),
      stripped: stripPngMetadata(source, label)
    };
  } catch (error) {
    fail(error.message);
    return null;
  }
}

const provenanceById = new Map(visualProvenanceRecords.map((record) => [record.id, record]));
const physicalDefinitions = listPhysicalDefinitions();
const visualDefinitions = listVisualDefinitions();
const physicalById = new Map(physicalDefinitions.map((definition) => [definition.id, definition]));
const visualById = new Map(visualDefinitions.map((definition) => [definition.id, definition]));
const allowedThirdParty = new Set(
  allowlist.allowedThirdPartySources.map((item) => `${item.sourceProject}:${item.sourceRevision}:${item.licenseSpdx}:${item.approvalStatus}`)
);
const approvedRoboStudio = new Set(allowlist.approvedRoboStudioSources);
const manifestEntries = Array.isArray(photorealManifest.components) ? photorealManifest.components : [];
const manifestById = new Map();
const generatedPhotorealIds = new Set(photorealAssetIds);

if (photorealManifest.assetKind !== "photorealistic-svg-wrapper") fail("Photoreal manifest assetKind must be photorealistic-svg-wrapper.");
if (photorealManifest.provenanceId !== "robostudio-photorealistic-component-wrappers") fail("Photoreal manifest must use the approved RoboStudio provenance id.");

const sourceGridColumns = Number(photorealManifest.grid?.columns);
const sourceGridRows = Number(photorealManifest.grid?.rows);
const sourceGridIsValid = Number.isInteger(sourceGridColumns) && Number.isInteger(sourceGridRows) && sourceGridColumns > 0 && sourceGridRows > 0;
if (!sourceGridIsValid) {
  fail("Photoreal manifest must define a positive integer source grid.");
} else if (manifestEntries.length !== sourceGridColumns * sourceGridRows) {
  fail(`Photoreal manifest has ${manifestEntries.length} entries but the source grid has ${sourceGridColumns * sourceGridRows} cells.`);
}

const sourceSheetPath = resolveManifestPath(photorealManifest.sourceSheet, "photorealManifest.sourceSheet");
const sourceSheet = readPngFile(sourceSheetPath, "photoreal source sheet");
if (!sourceSheet) {
  fail("Photoreal manifest source sheet is missing.");
} else if (sourceGridIsValid) {
  if (sourceSheet.info.width % sourceGridColumns !== 0 || sourceSheet.info.height % sourceGridRows !== 0) {
    fail(`Photoreal source sheet ${sourceSheet.info.width}x${sourceSheet.info.height} does not divide cleanly into the declared ${sourceGridColumns}x${sourceGridRows} grid.`);
  }
  if (!sourceSheet.info.criticalOnly) fail("Photoreal source sheet must not contain PNG metadata chunks.");
}

for (const entry of manifestEntries) {
  if (!entry.id) {
    fail("Every photoreal manifest entry needs an id.");
    continue;
  }
  if (manifestById.has(entry.id)) fail(`Photoreal manifest duplicates ${entry.id}.`);
  manifestById.set(entry.id, entry);
}

for (const record of visualProvenanceRecords) {
  if (!record.id) fail("Every provenance record needs an id.");
  if (record.sourceProject === "Fritzing parts" && record.approvalStatus !== "blocked") {
    fail(`${record.id} uses Fritzing and must stay blocked until legal review.`);
  }
  if (record.sourceProject === "wokwi/wokwi-elements") {
    const key = `${record.sourceProject}:${record.sourceRevision}:${record.licenseSpdx}:${record.approvalStatus}`;
    if (!allowedThirdParty.has(key)) fail(`${record.id} is not in the approved third-party allowlist.`);
    if (record.noticePath !== "LICENSES/wokwi-elements-MIT.txt") fail(`${record.id} must point to the Wokwi MIT notice.`);
  }
  if (record.sourceProject === "RoboStudio" && record.approvalStatus !== "approved") {
    fail(`${record.id} is a RoboStudio source but is not approved.`);
  }
  if (record.sourceProject === "RoboStudio" && !approvedRoboStudio.has(record.id)) {
    warn(`${record.id} is approved but is not listed in approvedRoboStudioSources.`);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "sourcePath" || key === "noticePath" || key === "generatedAssetPaths") continue;
    if (hasForbiddenEmbeddedData(value)) fail(`${record.id}.${key} contains a path-like or handle-like value.`);
  }
}

for (const physical of physicalDefinitions) {
  const terminalIds = Object.keys(physical.terminals ?? {});
  if (!terminalIds.length) fail(`${physical.id} has no physical terminals.`);
  const seenCoordinates = new Map();
  for (const terminalId of terminalIds) {
    const terminal = physical.terminals[terminalId];
    if (!Array.isArray(terminal.positionMm) || terminal.positionMm.length !== 2) {
      fail(`${physical.id}.${terminalId} missing positionMm.`);
      continue;
    }
    const key = terminal.positionMm.map((value) => Number(value).toFixed(4)).join(",");
    const existing = seenCoordinates.get(key);
    if (existing) fail(`${physical.id} duplicates physical anchor ${key} for ${existing} and ${terminalId}.`);
    seenCoordinates.set(key, terminalId);
    if (!terminal.connectorInterface) fail(`${physical.id}.${terminalId} missing connectorInterface.`);
    if (!Number.isFinite(Number(terminal.attachmentCapacity)) || Number(terminal.attachmentCapacity) < 1) {
      fail(`${physical.id}.${terminalId} must define attachmentCapacity >= 1.`);
    }
  }
}

for (const visual of visualDefinitions) {
  const physical = physicalById.get(visual.physicalDefinitionId);
  if (!physical) {
    fail(`${visual.id} references missing physical definition ${visual.physicalDefinitionId}.`);
    continue;
  }
  const provenance = provenanceById.get(visual.provenanceId);
  if (!provenance) fail(`${visual.id} references missing provenance ${visual.provenanceId}.`);
  if (provenance?.approvalStatus !== "approved") fail(`${visual.id} provenance is not approved.`);
  const physicalIds = new Set(Object.keys(physical.terminals));
  const visualIds = Object.keys(visual.terminalVisuals ?? {});
  const mapped = new Set();
  for (const terminalId of visualIds) {
    if (!physicalIds.has(terminalId)) fail(`${visual.id} exposes unknown terminal ${terminalId}.`);
    if (mapped.has(terminalId)) fail(`${visual.id} maps ${terminalId} more than once.`);
    mapped.add(terminalId);
    const ref = visual.terminalVisuals[terminalId]?.sourceConnectorRef;
    if (!ref) fail(`${visual.id}.${terminalId} missing sourceConnectorRef.`);
  }
  for (const terminalId of physicalIds) {
    if (!mapped.has(terminalId)) fail(`${visual.id} missing visual terminal mapping for ${terminalId}.`);
  }
}

for (const entry of manifestEntries) {
  const physical = physicalById.get(entry.id);
  const visual = visualById.get(entry.id);
  const expectedRasterSource = `src/circuits/assets/photoreal/raster/${entry.id}.png`;
  const expectedWrapper = `src/circuits/assets/photoreal/${entry.id}.svg`;
  if (entry.rasterSource !== expectedRasterSource) fail(`${entry.id} rasterSource must be ${expectedRasterSource}.`);
  if (entry.svgWrapper !== expectedWrapper) fail(`${entry.id} svgWrapper must be ${expectedWrapper}.`);
  const wrapperPath = resolveManifestPath(entry.svgWrapper, `${entry.id}.svgWrapper`) ?? path.join(photorealAssetDir, `${entry.id}.svg`);
  const rasterPath = resolveManifestPath(entry.rasterSource, `${entry.id}.rasterSource`) ?? path.join(photorealRasterDir, `${entry.id}.png`);
  if (!physical) fail(`${entry.id} photoreal manifest entry has no physical definition.`);
  if (!visual) fail(`${entry.id} photoreal manifest entry has no visual definition.`);
  if (!Number.isFinite(Number(entry.widthMm)) || !Number.isFinite(Number(entry.heightMm))) {
    fail(`${entry.id} photoreal manifest entry must define widthMm and heightMm.`);
  }
  if (physical && (!numbersMatch(entry.widthMm, physical.physicalSizeMm?.[0]) || !numbersMatch(entry.heightMm, physical.physicalSizeMm?.[1]))) {
    fail(`${entry.id} photoreal manifest dimensions ${entry.widthMm}x${entry.heightMm} do not match physical ${physical.physicalSizeMm?.join("x")}.`);
  }
  if (visual) {
    if (visual.assetKind !== "photorealistic-svg-wrapper") fail(`${entry.id} visual assetKind must be photorealistic-svg-wrapper.`);
    if (visual.assetId !== entry.id) fail(`${entry.id} visual assetId must match the manifest component id.`);
    if (visual.provenanceId !== photorealManifest.provenanceId) fail(`${entry.id} visual uses unexpected photoreal provenance.`);
  }
  if (!generatedPhotorealIds.has(entry.id)) fail(`${entry.id} missing from generated photoreal asset id registry.`);
  if (!photorealAssetUrls[entry.id]) fail(`${entry.id} missing from generated photoreal asset URL registry.`);
  const raster = readPngFile(rasterPath, entry.id);
  if (!raster) {
    fail(`${entry.id} missing transparent raster PNG source.`);
  } else {
    if (!raster.info.hasAlpha) fail(`${entry.id} raster source must include an alpha channel.`);
    if (raster.info.bitDepth !== 8) fail(`${entry.id} raster source must use 8-bit color depth.`);
    if (!raster.info.criticalOnly) fail(`${entry.id} raster source must not contain PNG metadata chunks.`);
    if (raster.info.width < 16 || raster.info.height < 16) fail(`${entry.id} raster source is unexpectedly small: ${raster.info.width}x${raster.info.height}.`);
  }
  if (!fs.existsSync(wrapperPath)) {
    fail(`${entry.id} missing photoreal SVG wrapper.`);
    continue;
  }
  const svg = fs.readFileSync(wrapperPath, "utf8");
  const svgMetadataForScan = svg.replace(/\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u, "");
  const rasterBase64 = raster ? raster.stripped.toString("base64") : "";
  if (hasForbiddenEmbeddedData(svgMetadataForScan)) fail(`${entry.id} photoreal wrapper contains a local path, hash, key, URL, or provider handle.`);
  if (hasForbiddenEmbeddedData(rasterBase64)) fail(`${entry.id} embedded raster payload contains forbidden text.`);
  if (!svg.includes(`data-component-id="${entry.id}"`)) fail(`${entry.id} photoreal wrapper missing data-component-id.`);
  if (!svg.includes('data-asset-kind="photorealistic-svg-wrapper"')) fail(`${entry.id} photoreal wrapper missing asset kind marker.`);
  if (!svg.includes(`data-raster-source="raster/${entry.id}.png"`)) fail(`${entry.id} photoreal wrapper missing raster source marker.`);
  if (!svg.includes('href="data:image/png;base64,')) fail(`${entry.id} photoreal wrapper must embed a PNG data URI.`);
  if (rasterBase64 && !svg.includes(`href="data:image/png;base64,${rasterBase64}"`)) {
    fail(`${entry.id} photoreal wrapper does not embed the matching raster source.`);
  }
  if (/<(?:rect|circle|ellipse|path|text)\b/iu.test(svg)) fail(`${entry.id} photoreal wrapper must not contain procedural SVG drawing primitives.`);
  const viewBox = svg.match(/\bviewBox="([^"]+)"/)?.[1]?.trim().split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite)) {
    fail(`${entry.id} photoreal wrapper missing numeric viewBox.`);
  } else if (!numbersMatch(viewBox[0], 0) || !numbersMatch(viewBox[1], 0) || !numbersMatch(viewBox[2], entry.widthMm) || !numbersMatch(viewBox[3], entry.heightMm)) {
    fail(`${entry.id} photoreal wrapper viewBox ${viewBox.join(" ")} does not match physical dimensions ${entry.widthMm} ${entry.heightMm}.`);
  }
}

for (const visual of visualDefinitions.filter((definition) => definition.assetKind === "photorealistic-svg-wrapper")) {
  if (!manifestById.has(visual.id)) fail(`${visual.id} photoreal visual is missing from the manifest.`);
}

for (const assetId of photorealAssetIds) {
  if (!manifestById.has(assetId)) fail(`${assetId} generated photoreal asset is missing from the manifest.`);
}

if (warnings.length) {
  for (const message of warnings) console.warn(`warning: ${message}`);
}
if (errors.length) {
  for (const message of errors) console.error(`error: ${message}`);
  process.exit(1);
}

console.log(`Validated ${visualProvenanceRecords.length} provenance records, ${visualDefinitions.length} visual definitions, and ${manifestEntries.length} photoreal wrappers.`);
