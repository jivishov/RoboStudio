import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertRepoRelativePath,
  hasForbiddenEmbeddedData,
  readPngInfo,
  stripPngMetadata
} from "./png-assets.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const manifestPath = path.join(scriptDir, "photoreal-manifest.json");
const outputDir = path.join(repoRoot, "src", "circuits", "assets", "photoreal");
const generatedPath = path.join(repoRoot, "src", "circuits", "generated", "photorealAssets.js");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const { getPhysicalDefinition } = await import(pathToFileURL(path.join(repoRoot, "src", "circuits", "physicalCatalog.js")));

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function number(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be a positive number.`);
  return numeric;
}

function round(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/u, "");
}

function rasterDataUri(entry) {
  const rasterPath = assertRepoRelativePath(repoRoot, entry.rasterSource, `${entry.id}.rasterSource`);
  if (!fs.existsSync(rasterPath)) {
    throw new Error(`${entry.id} is missing raster source ${path.relative(repoRoot, rasterPath).replaceAll(path.sep, "/")}. Run scripts/circuits/extract-photoreal-raster-sources.py first.`);
  }
  const raster = stripPngMetadata(fs.readFileSync(rasterPath), entry.id);
  const info = readPngInfo(raster, entry.id);
  if (!info.hasAlpha) throw new Error(`${entry.id} raster source must include transparency.`);
  if (info.bitDepth !== 8) throw new Error(`${entry.id} raster source must use 8-bit color depth.`);
  const encoded = raster.toString("base64");
  if (hasForbiddenEmbeddedData(encoded)) throw new Error(`${entry.id} raster source contains forbidden embedded data.`);
  return `data:image/png;base64,${encoded}`;
}

function svgFor(entry) {
  const width = number(entry.widthMm, `${entry.id}.widthMm`);
  const height = number(entry.heightMm, `${entry.id}.heightMm`);
  const href = rasterDataUri(entry);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}mm" height="${round(height)}mm" data-component-id="${escapeXml(entry.id)}" data-asset-kind="${manifest.assetKind}" data-raster-source="raster/${escapeXml(entry.id)}.png">
  <title>${escapeXml(entry.label ?? entry.id)} RoboStudio photorealistic raster wrapper</title>
  <image href="${href}" x="0" y="0" width="${round(width)}" height="${round(height)}" preserveAspectRatio="xMidYMid meet"/>
</svg>
`;
}

function validateManifestEntry(entry) {
  if (!entry.id || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.id)) throw new Error(`Invalid component id in manifest: ${entry.id}`);
  const expectedRaster = `src/circuits/assets/photoreal/raster/${entry.id}.png`;
  const expectedWrapper = `src/circuits/assets/photoreal/${entry.id}.svg`;
  if (entry.rasterSource !== expectedRaster) throw new Error(`${entry.id}.rasterSource must be ${expectedRaster}.`);
  if (entry.svgWrapper !== expectedWrapper) throw new Error(`${entry.id}.svgWrapper must be ${expectedWrapper}.`);
  const physical = getPhysicalDefinition(entry.id);
  if (!physical) throw new Error(`${entry.id} is missing from physicalCatalog.`);
  const width = number(entry.widthMm, `${entry.id}.widthMm`);
  const height = number(entry.heightMm, `${entry.id}.heightMm`);
  const [physicalWidth, physicalHeight] = physical.physicalSizeMm;
  if (Math.abs(width - Number(physicalWidth)) > 0.001 || Math.abs(height - Number(physicalHeight)) > 0.001) {
    throw new Error(`${entry.id} manifest size ${width} x ${height} mm does not match physical definition ${physicalWidth} x ${physicalHeight} mm.`);
  }
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(generatedPath), { recursive: true });

for (const entry of manifest.components) {
  validateManifestEntry(entry);
  fs.writeFileSync(assertRepoRelativePath(repoRoot, entry.svgWrapper, `${entry.id}.svgWrapper`), svgFor(entry));
}

const ids = manifest.components.map((entry) => entry.id).sort();
const generated = `export const photorealAssetIds = Object.freeze(${JSON.stringify(ids, null, 2)});

export const photorealAssetUrls = Object.freeze({
${ids.map((id) => `  ${JSON.stringify(id)}: new URL("../assets/photoreal/${id}.svg", import.meta.url).href`).join(",\n")}
});

export function getPhotorealAssetUrl(componentTypeId) {
  return photorealAssetUrls[componentTypeId] ?? null;
}
`;
fs.writeFileSync(generatedPath, generated);

console.log(`Generated ${ids.length} Circuit Lab photorealistic PNG-backed SVG wrappers.`);
console.log("No runtime asset fetch, Fritzing graphic, or project-state asset data was emitted.");
