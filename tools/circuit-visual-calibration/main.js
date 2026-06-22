import "./style.css";

const input = document.querySelector("#asset-input");
const widthInput = document.querySelector("#width-mm");
const heightInput = document.querySelector("#height-mm");
const preview = document.querySelector("#preview");
const output = document.querySelector("#manifest-output");
const exportButton = document.querySelector("#export-manifest");

let objectUrl = null;
let fileMeta = null;

function dimensions() {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 40,
    height: Number.isFinite(height) && height > 0 ? height : 24
  };
}

function renderPreview() {
  const { width, height } = dimensions();
  preview.setAttribute("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);
  preview.replaceChildren();
  if (objectUrl) {
    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("href", objectUrl);
    image.setAttribute("x", String(-width / 2));
    image.setAttribute("y", String(-height / 2));
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    preview.append(image);
  }
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  outline.setAttribute("x", String(-width / 2));
  outline.setAttribute("y", String(-height / 2));
  outline.setAttribute("width", String(width));
  outline.setAttribute("height", String(height));
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", "#1268e8");
  outline.setAttribute("stroke-width", "0.4");
  preview.append(outline);
  for (const scale of [0.55, 1, 1.9]) {
    const guide = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    guide.setAttribute("x", String((-width * scale) / 2));
    guide.setAttribute("y", String((-height * scale) / 2));
    guide.setAttribute("width", String(width * scale));
    guide.setAttribute("height", String(height * scale));
    guide.setAttribute("fill", "none");
    guide.setAttribute("stroke", scale === 1 ? "#0c7c59" : "#b7791f");
    guide.setAttribute("stroke-width", "0.18");
    guide.setAttribute("stroke-dasharray", "1 1");
    preview.append(guide);
  }
}

function manifestFragment() {
  const { width, height } = dimensions();
  return {
    version: 1,
    sourceAssetName: fileMeta?.name ?? "unloaded asset",
    physicalSizeMm: [width, height],
    viewBox: [-width / 2, -height / 2, width, height],
    bodyBoundsMm: { x: -width / 2, y: -height / 2, width, height },
    visualBoundsMm: { x: -width / 2, y: -height / 2, width, height },
    clampBoundsMm: { x: -width / 2, y: -height / 2, width, height },
    terminals: {},
    controls: {},
    notes: "Calibration draft only. Do not persist image data, local paths, or object URLs into CircuitLabProject."
  };
}

input.addEventListener("change", () => {
  const [file] = input.files ?? [];
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = file ? URL.createObjectURL(file) : null;
  fileMeta = file ? { name: file.name, type: file.type, size: file.size } : null;
  renderPreview();
});

for (const control of [widthInput, heightInput]) {
  control.addEventListener("input", renderPreview);
}

exportButton.addEventListener("click", () => {
  output.textContent = JSON.stringify(manifestFragment(), null, 2);
});

renderPreview();
