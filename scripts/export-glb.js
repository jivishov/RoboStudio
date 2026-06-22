import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { collectAssemblyParts, createRoboticArmAssembly } from "../src/createAssembly.js";
import { applyPoseToAssembly, captureRestState, normalizePose } from "../src/studio/poseState.js";

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class NodeFileReader {
    result = null;
    error = null;
    onloadend = null;
    onerror = null;

    async readAsArrayBuffer(blob) {
      try {
        this.result = await blob.arrayBuffer();
        this.onloadend?.({ target: this });
      } catch (error) {
        this.error = error;
        this.onerror?.({ target: this });
      }
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const stlRoot = path.join(projectRoot, "STL_files");
const artifactsRoot = path.join(projectRoot, "artifacts");
const outputPath = path.join(artifactsRoot, "robotic-arm-assembled.glb");
const args = process.argv.slice(2);
const poseIndex = args.indexOf("--pose");
const posePath =
  poseIndex === -1
    ? args.find((arg) => arg.toLowerCase().endsWith(".json")) ?? null
    : args[poseIndex + 1];

if (poseIndex !== -1 && !posePath) {
  throw new Error("Missing pose JSON path after --pose.");
}

const loader = new STLLoader();

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadStlGeometry(fileName) {
  const data = await readFile(path.join(stlRoot, fileName));
  return loader.parse(toArrayBuffer(data));
}

function exportGlb(input) {
  const exporter = new GLTFExporter();
  input.updateMatrixWorld(true);

  return new Promise((resolve, reject) => {
    exporter.parse(input, resolve, reject, {
      binary: true,
      onlyVisible: false,
      trs: false
    });
  });
}

const assembly = await createRoboticArmAssembly(loadStlGeometry);

if (posePath) {
  const parts = collectAssemblyParts(assembly);
  const poseJson = JSON.parse(await readFile(path.resolve(projectRoot, posePath), "utf8"));
  const pose = normalizePose(poseJson, parts);
  applyPoseToAssembly(parts, captureRestState(parts), pose);
}

const glb = await exportGlb(assembly);

await mkdir(artifactsRoot, { recursive: true });
await writeFile(outputPath, Buffer.from(glb));

console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
if (posePath) {
  console.log(`Applied pose: ${path.relative(projectRoot, path.resolve(projectRoot, posePath))}`);
}
console.log(`Assembly meshes: ${assembly.userData.manifest.length}`);
console.log(`Source STL count: ${assembly.userData.sourceStlCount}`);
