import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DRAWINGS_DIR = path.join(ROOT_DIR, "drawings");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

function findBrowser() {
  return chromeCandidates.find((candidate) => fs.existsSync(candidate));
}

function renderSvg(browserPath, fileName, width, height) {
  const inputPath = path.join(DRAWINGS_DIR, fileName);
  const outputPath = inputPath.replace(/\.svg$/i, ".png");
  const result = spawnSync(
    browserPath,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      `--screenshot=${outputPath}`,
      pathToFileURL(inputPath).href
    ],
    { stdio: "pipe", encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to render ${fileName}: ${result.stderr || result.stdout}`);
  }
  return outputPath;
}

function renderAll() {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error("Chrome or Edge was not found. Set CHROME_PATH to render PNG previews.");
  }

  const renders = [
    ["assembly_sketch.svg", 1800, 1180],
    ["assembly_steps.svg", 1800, 850],
    ["all_stl_objects.svg", 1814, 3450],
    ["part_sheet_01_04.svg", 1580, 1110],
    ["part_sheet_05_08.svg", 1580, 1110],
    ["part_sheet_09_12.svg", 1580, 1110],
    ["part_sheet_13_16.svg", 1580, 1110]
  ];

  for (const [fileName, width, height] of renders) {
    const outputPath = renderSvg(browserPath, fileName, width, height);
    console.log(`Rendered ${path.relative(process.cwd(), outputPath)}`);
  }
}

renderAll();
