import fs from "node:fs";
import path from "node:path";
import {
  hasForbiddenEmbeddedData,
  readPngInfo,
  stripPngMetadata
} from "./png-assets.mjs";
import { getAssetRegistration, registeredRasterFrame } from "../../src/circuits/assetRegistrations.js";

const args = process.argv.slice(2);
const componentFlagIndex = args.indexOf("--component-id");
const componentId = componentFlagIndex >= 0 ? args[componentFlagIndex + 1] : null;
if (componentFlagIndex >= 0) args.splice(componentFlagIndex, 2);

const [imagePath, widthMm, heightMm, outPath] = args;
if (!imagePath || !widthMm || !heightMm) {
  console.error("Usage: node scripts/circuits/wrap-raster-visual.mjs <transparent.png> <width-mm> <height-mm> [out.svg] [--component-id component-id]");
  process.exit(2);
}

const resolved = path.resolve(imagePath);
const ext = path.extname(resolved).toLowerCase();
if (ext !== ".png") {
  console.error("Raster wrapper accepts normalized PNG input only.");
  process.exit(1);
}
if (!fs.existsSync(resolved)) {
  console.error("Input PNG does not exist.");
  process.exit(1);
}
if (!Number.isFinite(Number(widthMm)) || !Number.isFinite(Number(heightMm)) || Number(widthMm) <= 0 || Number(heightMm) <= 0) {
  console.error("Physical dimensions must be positive finite millimeter values.");
  process.exit(1);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/u, "");
}

const wrapperComponentId = componentId ?? path.basename(resolved, ".png");
if (!/^[a-z0-9][a-z0-9-]*$/u.test(wrapperComponentId)) {
  console.error("Component id must use lowercase letters, numbers, and hyphens.");
  process.exit(1);
}

const stripped = stripPngMetadata(fs.readFileSync(resolved), wrapperComponentId);
const info = readPngInfo(stripped, wrapperComponentId);
if (!info.hasAlpha || info.bitDepth !== 8) {
  console.error("Input PNG must be an 8-bit transparent PNG.");
  process.exit(1);
}
const encoded = stripped.toString("base64");
if (hasForbiddenEmbeddedData(encoded)) {
  console.error("Embedded raster data contains path-like, hash-like, or file-handle-like text.");
  process.exit(1);
}

const width = Number(widthMm);
const height = Number(heightMm);
const registration = getAssetRegistration(wrapperComponentId) ?? {
  id: `${wrapperComponentId}-asset-registration-draft`,
  rasterCrop: { units: "normalized", x: 0, y: 0, width: 1, height: 1 },
  uniformScale: 1,
  translationMm: [0, 0],
  orientationDeg: 0
};
const frame = registeredRasterFrame(registration, info.width, info.height, width, height);
const rotation = frame.orientationDeg
  ? ` transform="rotate(${round(frame.orientationDeg)} ${round(width / 2)} ${round(height / 2)})"`
  : "";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}mm" height="${round(height)}mm" data-component-id="${escapeXml(wrapperComponentId)}" data-asset-kind="photorealistic-svg-wrapper" data-raster-source="${escapeXml(path.basename(resolved))}" data-registration-id="${escapeXml(registration.id)}" data-mm-per-pixel="${round(frame.mmPerPixel)}">
  <title>${escapeXml(wrapperComponentId)} RoboStudio raster wrapper</title>
  <image href="data:image/png;base64,${encoded}" x="${round(frame.x)}" y="${round(frame.y)}" width="${round(frame.width)}" height="${round(frame.height)}" preserveAspectRatio="none"${rotation}/>
</svg>
`;

if (outPath) {
  const out = path.resolve(outPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, svg);
  console.log(`Wrote ${out}`);
} else {
  process.stdout.write(svg);
}
