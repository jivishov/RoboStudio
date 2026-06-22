import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFritzingCustomComponentDefinition } from "../../src/circuits/customComponents.js";

const args = process.argv.slice(2);
const [fzpPath, svgPath] = args;
const flags = new Set(args.slice(2).filter((item) => String(item).startsWith("--")));

function optionValue(name) {
  const equals = args.find((item) => String(item).startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  console.error("Usage: node scripts/circuits/import-fritzing-part.mjs <local.fzp> <breadboard.svg> --local-library-draft --width-mm <mm> --height-mm <mm>");
}

if (!fzpPath || !svgPath || !flags.has("--local-library-draft")) {
  usage();
  process.exit(2);
}

const physicalWidthMm = Number(optionValue("--width-mm"));
const physicalHeightMm = Number(optionValue("--height-mm"));
if (!Number.isFinite(physicalWidthMm) || physicalWidthMm <= 0 || !Number.isFinite(physicalHeightMm) || physicalHeightMm <= 0) {
  usage();
  console.error("Both --width-mm and --height-mm must be positive millimeter values.");
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const allowlist = JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts", "circuits", "asset-allowlist.json"), "utf8"));
const blocked = allowlist.blockedSources.some((item) => item.sourceProject === "Fritzing parts" && item.approvalStatus === "blocked");

if (blocked) {
  console.warn("Fritzing graphics remain blocked from production assets; this run validates a local custom-library draft only.");
}

if (path.extname(fzpPath).toLowerCase() !== ".fzp") {
  console.error("Fritzing importer accepts only explicit .fzp paths.");
  process.exit(1);
}
if (path.extname(svgPath).toLowerCase() !== ".svg") {
  console.error("Fritzing importer requires the matching breadboard SVG as an explicit local file.");
  process.exit(1);
}

const fzpText = fs.readFileSync(fzpPath, "utf8");
const svgText = fs.readFileSync(svgPath, "utf8");
const draft = buildFritzingCustomComponentDefinition({
  fzpText,
  svgText,
  fzpFileName: path.basename(fzpPath),
  svgFileName: path.basename(svgPath),
  physicalWidthMm,
  physicalHeightMm,
  licenseAccepted: true,
  now: new Date().toISOString()
});

console.log(JSON.stringify({
  id: draft.id,
  name: draft.name,
  terminalCount: draft.terminals.length,
  internalBusCount: draft.internalBuses.length,
  license: draft.licenseAcceptance.licenseSpdx,
  localOnly: draft.licenseAcceptance.localOnly,
  sanitizedSvgBytes: Buffer.byteLength(draft.visual.sanitizedSvg ?? "", "utf8")
}, null, 2));
