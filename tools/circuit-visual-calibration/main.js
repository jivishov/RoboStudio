import "./style.css";
import { catalog } from "../../src/circuits/catalog.js";
import { getAssetRegistration, registeredRasterFrame } from "../../src/circuits/assetRegistrations.js";

const input = document.querySelector("#asset-input");
const componentSelect = document.querySelector("#component-id");
const summary = document.querySelector("#component-summary");
const preview = document.querySelector("#preview");
const output = document.querySelector("#manifest-output");
const exportButton = document.querySelector("#export-manifest");
const rotationSelect = document.querySelector("#component-rotation");
const zoomSelect = document.querySelector("#inspection-zoom");
const registrationControls = {
  cropX: document.querySelector("#crop-x"),
  cropY: document.querySelector("#crop-y"),
  cropWidth: document.querySelector("#crop-width"),
  cropHeight: document.querySelector("#crop-height"),
  uniformScale: document.querySelector("#uniform-scale"),
  translateX: document.querySelector("#translate-x"),
  translateY: document.querySelector("#translate-y"),
  orientation: document.querySelector("#artwork-orientation")
};

const rasterUrls = Object.fromEntries(Object.entries(import.meta.glob(
  "../../src/circuits/assets/photoreal/raster/*.png",
  { eager: true, query: "?url", import: "default" }
)).map(([path, url]) => [path.split("/").pop().replace(/\.png$/u, ""), url]));

let objectUrl = null;
let fileMeta = null;
let rasterSize = [1, 1];

function svgElement(tag, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text) element.textContent = text;
  return element;
}

function componentDefinition() {
  return catalog.getComponent(componentSelect.value);
}

function registrationDraft() {
  const definition = componentDefinition();
  const base = getAssetRegistration(definition.id);
  return {
    ...base,
    rasterCrop: {
      units: "normalized",
      x: Number(registrationControls.cropX.value),
      y: Number(registrationControls.cropY.value),
      width: Number(registrationControls.cropWidth.value),
      height: Number(registrationControls.cropHeight.value)
    },
    uniformScale: Number(registrationControls.uniformScale.value),
    translationMm: [Number(registrationControls.translateX.value), Number(registrationControls.translateY.value)],
    orientationDeg: Number(registrationControls.orientation.value)
  };
}

function resetRegistration() {
  const registration = getAssetRegistration(componentSelect.value);
  registrationControls.cropX.value = registration.rasterCrop.x;
  registrationControls.cropY.value = registration.rasterCrop.y;
  registrationControls.cropWidth.value = registration.rasterCrop.width;
  registrationControls.cropHeight.value = registration.rasterCrop.height;
  registrationControls.uniformScale.value = registration.uniformScale;
  registrationControls.translateX.value = registration.translationMm[0];
  registrationControls.translateY.value = registration.translationMm[1];
  registrationControls.orientation.value = registration.orientationDeg;
}

function currentArtworkUrl() {
  return objectUrl ?? rasterUrls[componentSelect.value] ?? null;
}

function renderPreview() {
  const definition = componentDefinition();
  if (!definition) return;
  const [width, height] = definition.dimensions;
  const visual = definition.visualBoundsMm;
  const padding = Math.max(10, Math.min(width, height) * 0.18);
  const rotation = Number(rotationSelect.value);
  const radians = rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedCorners = [
    [visual.x, visual.y],
    [visual.x + visual.width, visual.y],
    [visual.x + visual.width, visual.y + visual.height],
    [visual.x, visual.y + visual.height]
  ].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  const xs = rotatedCorners.map((point) => point[0]);
  const ys = rotatedCorners.map((point) => point[1]);
  const viewBox = [Math.min(...xs) - padding, Math.min(...ys) - padding, Math.max(...xs) - Math.min(...xs) + padding * 2, Math.max(...ys) - Math.min(...ys) + padding * 2];
  preview.setAttribute("viewBox", viewBox.join(" "));
  preview.style.width = `${viewBox[2] * Number(zoomSelect.value)}px`;
  preview.style.height = `${viewBox[3] * Number(zoomSelect.value)}px`;
  preview.dataset.componentId = definition.id;
  preview.dataset.inspectionZoom = zoomSelect.value;
  preview.dataset.componentRotation = rotationSelect.value;
  preview.replaceChildren();
  const scene = svgElement("g", { transform: `rotate(${rotation})` });
  const artworkUrl = currentArtworkUrl();
  if (artworkUrl) {
    const frame = registeredRasterFrame(registrationDraft(), rasterSize[0], rasterSize[1], width, height);
    const definitions = svgElement("defs");
    const artworkClip = svgElement("clipPath", { id: "calibration-artwork-clip" });
    artworkClip.append(svgElement("rect", { x: -width / 2, y: -height / 2, width, height }));
    definitions.append(artworkClip);
    scene.append(definitions);
    const artworkGroup = svgElement("g", { "clip-path": "url(#calibration-artwork-clip)" });
    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("href", artworkUrl);
    image.setAttribute("x", String(frame.x - width / 2));
    image.setAttribute("y", String(frame.y - height / 2));
    image.setAttribute("width", String(frame.width));
    image.setAttribute("height", String(frame.height));
    image.setAttribute("preserveAspectRatio", "none");
    if (frame.orientationDeg) image.setAttribute("transform", `rotate(${frame.orientationDeg})`);
    image.classList.add("calibration-artwork");
    artworkGroup.append(image);
    scene.append(artworkGroup);
  }
  for (const [bounds, className] of [[definition.bodyBoundsMm, "body-bound"], [definition.visualBoundsMm, "visual-bound"], [definition.clampBoundsMm, "clamp-bound"]]) {
    scene.append(svgElement("rect", { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, class: className }));
  }
  for (const port of definition.physicalPorts ?? []) {
    const bounds = port.housingBoundsMm;
    const group = svgElement("g", { "data-port-id": port.id });
    group.append(svgElement("rect", { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, class: "port-bound" }));
    const portLabelX = bounds.x + bounds.width / 2;
    const portLabelY = bounds.y - 0.8;
    group.append(svgElement("text", {
      x: portLabelX,
      y: portLabelY,
      class: "port-label",
      transform: `rotate(-55 ${portLabelX} ${portLabelY})`
    }, port.id));
    scene.append(group);
  }
  const landmarkIds = new Set(getAssetRegistration(definition.id).reviewLandmarks.map((landmark) => landmark.terminalId));
  for (const terminal of definition.terminals) {
    const group = svgElement("g", { "data-terminal-id": terminal.id, class: landmarkIds.has(terminal.id) ? "is-landmark" : "" });
    group.append(svgElement("title", {}, `${terminal.id} · ${terminal.anchorKind}`));
    group.append(svgElement("circle", { cx: terminal.position[0], cy: terminal.position[1], r: 0.72, class: "terminal-center" }));
    group.append(svgElement("line", { x1: terminal.position[0] - 1.2, y1: terminal.position[1], x2: terminal.position[0] + 1.2, y2: terminal.position[1], class: "terminal-crosshair" }));
    group.append(svgElement("line", { x1: terminal.position[0], y1: terminal.position[1] - 1.2, x2: terminal.position[0], y2: terminal.position[1] + 1.2, class: "terminal-crosshair" }));
    if (definition.terminals.length <= 20 || landmarkIds.has(terminal.id)) {
      group.append(svgElement("text", {
        x: terminal.position[0] + 0.5,
        y: terminal.position[1] - 1,
        class: "terminal-label",
        transform: `rotate(-55 ${terminal.position[0] + 0.5} ${terminal.position[1] - 1})`
      }, `${terminal.id} · ${terminal.anchorKind}`));
    }
    scene.append(group);
  }
  preview.append(scene);
  const evidence = definition.geometryEvidence;
  summary.innerHTML = `<strong>${definition.name}</strong><span>${width} × ${height} mm · ${definition.terminals.length} contacts · ${definition.physicalPorts.length} housings</span><span class="accuracy accuracy--${evidence.accuracyClass}">${evidence.accuracyClass}</span><span>${evidence.sourceKind} · ${evidence.sourceRevision}</span><span>Registration tolerance: ${evidence.registrationToleranceMm} mm</span><details class="contact-index"><summary>Immutable contact IDs (${definition.terminals.length})</summary><code>${definition.terminals.map((terminal) => terminal.id).join(" · ")}</code></details>`;
}

function loadArtworkDimensions(url) {
  const image = new Image();
  image.onload = () => {
    rasterSize = [image.naturalWidth || image.width, image.naturalHeight || image.height];
    renderPreview();
  };
  image.src = url;
}

function selectComponent() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  fileMeta = null;
  input.value = "";
  resetRegistration();
  loadArtworkDimensions(currentArtworkUrl());
}

input.addEventListener("change", () => {
  const [file] = input.files ?? [];
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = file ? URL.createObjectURL(file) : null;
  fileMeta = file ? { name: file.name, type: file.type, size: file.size } : null;
  if (objectUrl) loadArtworkDimensions(objectUrl);
  else loadArtworkDimensions(currentArtworkUrl());
});

for (const control of [...Object.values(registrationControls), rotationSelect, zoomSelect]) {
  control.addEventListener("input", renderPreview);
}

componentSelect.addEventListener("change", selectComponent);

exportButton.addEventListener("click", () => {
  output.textContent = JSON.stringify({
    ...registrationDraft(),
    sourceAssetName: fileMeta?.name ?? `${componentSelect.value}.png`,
    notes: "Build-time registration only. Terminal IDs and centers remain immutable. Do not persist local paths, image data, or calibration state in CircuitLabProject."
  }, null, 2);
});

for (const component of catalog.listComponents().filter((item) => rasterUrls[item.id]).sort((a, b) => a.name.localeCompare(b.name))) {
  componentSelect.append(new Option(component.name, component.id));
}
componentSelect.value = "controller-arduino-uno-r3";
selectComponent();
