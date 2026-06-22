import fs from "node:fs";
import path from "node:path";

const [, , sourceRoot, componentName, terminalMapPath] = process.argv;

if (!sourceRoot || !componentName || !terminalMapPath) {
  console.error("Usage: node scripts/circuits/import-wokwi-visual.mjs <wokwi-elements-v1.9.2-root> <component-name> <terminal-map.json>");
  process.exit(2);
}

const allowlist = JSON.parse(fs.readFileSync(new URL("./asset-allowlist.json", import.meta.url), "utf8"));
const wokwi = allowlist.allowedThirdPartySources.find((item) => item.sourceProject === "wokwi/wokwi-elements");
const root = path.resolve(sourceRoot);
const packageJsonPath = path.join(root, "package.json");
if (!fs.existsSync(packageJsonPath)) {
  console.error("Pinned Wokwi source snapshot must contain package.json.");
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(terminalMapPath, "utf8"));
if (!Object.keys(map).length) {
  console.error("Wokwi importer requires an explicit upstream-to-RoboStudio terminal map.");
  process.exit(1);
}

console.log(`Validated Wokwi import inputs for ${componentName} from ${root}.`);
console.log(`Expected pinned source: ${wokwi.version} / ${wokwi.sourceRevision}.`);
console.log("Static SVG extraction is intentionally review-gated; no production asset was written.");
