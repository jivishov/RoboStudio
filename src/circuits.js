import "./circuits.css";
import "./shellHeader.css";
import { mountPageAssistant } from "./assistant/chatUi.js";
import {
  commitHistoryFrom,
  commitHistory,
  createHistory,
  currentHistoryValue,
  historyStatus,
  redoHistory,
  replaceHistoryValue,
  resetHistory,
  undoHistory
} from "./history.js";
import { mountShellCardToggles } from "./shellCards.js";
import { createWorkspaceStore } from "./workspaceStore.js";
import { createCircuitBuildGuideZip } from "./circuits/artifactZip.js";
import { buildCircuitArtifacts } from "./circuits/artifacts.js";
import {
  TERMINAL_KINDS,
  catalog,
  clearCustomCircuitComponents,
  componentColor,
  registerCustomCircuitComponents,
  starterTemplates
} from "./circuits/catalog.js";
import {
  buildFritzingCustomComponentDefinition,
  parseSvgViewBox
} from "./circuits/customComponents.js";
import { componentControlSummary, normalizeControlState } from "./circuits/controlModel.js";
import {
  createControlInteractionState,
  isMomentaryControlActive,
  pressMomentaryControl,
  releaseActiveMomentaryControl,
  releaseAllMomentaryControls,
  releaseMomentaryControl
} from "./circuits/controlInteractions.js";
import { endpointLabel, projectController, resolveTerminal, terminalsInUse } from "./circuits/connectivity.js";
import { connectionFittingDescriptors } from "./circuits/connectionFittings.js";
import { generateCircuitLabSource } from "./circuits/codegen.js";
import {
  BENCH_HEIGHT,
  BENCH_WIDTH,
  MAX_COMPONENT_SCALE,
  MIN_COMPONENT_SCALE,
  clampComponentPosition,
  componentBounds,
  componentScale,
  normalizeComponentRotation,
  normalizeComponentScale
} from "./circuits/geometry.js";
import { insertComponentIntoNearestTerminals, rematchDirectInsertionConnections } from "./circuits/insertion.js";
import { derivePhysicalOccupancy } from "./circuits/occupancy.js";
import { fallbackVisualNotice } from "./circuits/proceduralVisuals.js";
import { terminalAriaLabel, terminalRadius, terminalTooltip } from "./circuits/terminalRenderer.js";
import { getVisualDefinition } from "./circuits/visualCatalog.js";
import { componentVisualStatus } from "./circuits/visualRenderer.js";
import { endpointFittingClass, shouldRenderExternalWire, wirePath } from "./circuits/wireRenderer.js";
import { getPhotorealAssetUrl } from "./circuits/generated/photorealAssets.js";
import {
  addComponent,
  applyStarterTemplate,
  connectTerminals,
  createCircuitLabProject,
  normalizeProject,
  parseCircuitLabProjectJson,
  projectSummary,
  removeComponent,
  removeConnection,
  selectComponent,
  selectConnection,
  serializeCircuitLabProject,
  setComponentControl,
  setProjectMode,
  updateComponent
} from "./circuits/model.js";
import { runCircuitLabTest } from "./circuits/testBench.js";
import { normalizeMechatronicsBinding, parseMechatronicsBindingJson, serializeMechatronicsBinding } from "./mechatronics/model.js";
import { previewMechatronicsBindingSuggestions } from "./mechatronics/suggestions.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_BENCH_ZOOM = 0.65;
const MAX_BENCH_ZOOM = 2.6;
const BENCH_ZOOM_STEP = 1.18;

const statusEl = document.querySelector("#circuit-status");
const projectNameInput = document.querySelector("#circuit-lab-name");
const summaryEl = document.querySelector("#circuit-lab-summary");
const readoutEl = document.querySelector("#circuit-lab-readout");
const starterList = document.querySelector("#starter-list");
const hardwareList = document.querySelector("#hardware-list");
const componentCountEl = document.querySelector("#circuit-component-count");
const componentList = document.querySelector("#circuit-component-list");
const wireCountEl = document.querySelector("#circuit-wire-count");
const wireList = document.querySelector("#circuit-wire-list");
const benchSvg = document.querySelector("#circuit-bench");
const wireStatus = document.querySelector("#wire-status");
const selectedSummary = document.querySelector("#circuit-selected-summary");
const componentNameInput = document.querySelector("#circuit-component-name");
const componentXInput = document.querySelector("#circuit-component-x");
const componentYInput = document.querySelector("#circuit-component-y");
const componentScaleInput = document.querySelector("#circuit-component-scale");
const componentRotationInput = document.querySelector("#circuit-component-rotation");
const controlPanelEl = document.querySelector("#circuit-control-panel");
const engineeringMinVInput = document.querySelector("#circuit-engineering-min-v");
const engineeringNominalVInput = document.querySelector("#circuit-engineering-nominal-v");
const engineeringMaxVInput = document.querySelector("#circuit-engineering-max-v");
const engineeringTypicalMaInput = document.querySelector("#circuit-engineering-typical-ma");
const engineeringPeakMaInput = document.querySelector("#circuit-engineering-peak-ma");
const engineeringStallMaInput = document.querySelector("#circuit-engineering-stall-ma");
const rotateReverseButton = document.querySelector("#rotate-circuit-component-reverse");
const rotateClockwiseButton = document.querySelector("#rotate-circuit-component-clockwise");
const zoomOutButton = document.querySelector("#circuit-zoom-out");
const zoomInButton = document.querySelector("#circuit-zoom-in");
const zoomResetButton = document.querySelector("#circuit-zoom-reset");
const zoomLevelEl = document.querySelector("#circuit-zoom-level");
const applyComponentButton = document.querySelector("#apply-circuit-component");
const removeComponentButton = document.querySelector("#remove-circuit-component");
const testSummaryEl = document.querySelector("#circuit-test-summary");
const testList = document.querySelector("#circuit-test-list");
const bringupList = document.querySelector("#circuit-bringup-list");
const sourceFileSelect = document.querySelector("#circuit-source-file");
const sourcePreview = document.querySelector("#circuit-source-preview");
const tabButtons = [...document.querySelectorAll("[data-circuit-tab]")];
const bindingSummaryEl = document.querySelector("#circuit-binding-summary");
const bindingJsonInput = document.querySelector("#circuit-binding-json");
const bindingStatusEl = document.querySelector("#circuit-binding-status");
const applyBindingButton = document.querySelector("#apply-circuit-binding");
const saveBindingButton = document.querySelector("#save-circuit-binding");
const readinessSummaryEl = document.querySelector("#circuit-readiness-summary");
const readinessListEl = document.querySelector("#circuit-readiness-list");
const pinMapTableEl = document.querySelector("#circuit-pin-map-table");
const harnessTableEl = document.querySelector("#circuit-harness-table");
const bomTableEl = document.querySelector("#circuit-bom-table");
const checklistListEl = document.querySelector("#circuit-checklist-list");
const exportBuildGuideButton = document.querySelector("#export-circuit-build-guide");
const newButton = document.querySelector("#new-circuit-lab");
const saveButton = document.querySelector("#save-circuit-lab");
const openButton = document.querySelector("#open-circuit-lab");
const fileInput = document.querySelector("#circuit-lab-file-input");
const fritzingFzpInput = document.querySelector("#fritzing-fzp-input");
const fritzingSvgInput = document.querySelector("#fritzing-svg-input");
const undoButton = document.querySelector("#undo-circuit-lab");
const redoButton = document.querySelector("#redo-circuit-lab");
const exportJsonButton = document.querySelector("#export-circuit-lab-json");
const downloadSourceButton = document.querySelector("#download-circuit-lab-source");
const runTestButton = document.querySelector("#run-circuit-test");
const modeButtons = [...document.querySelectorAll("[data-circuit-mode]")];

const history = createHistory(createCircuitLabProject());
const workspaceStore = createWorkspaceStore();
const uiState = {
  pendingEndpoint: null,
  wireDrag: null,
  activeTab: "inspect",
  selectedIssueId: null,
  binding: normalizeMechatronicsBinding(),
  robotDesign: null,
  artifacts: buildCircuitArtifacts({ circuitLabProject: createCircuitLabProject() }),
  test: runCircuitLabTest(createCircuitLabProject()),
  source: generateCircuitLabSource(createCircuitLabProject()),
  selectedSourcePath: "",
  customComponents: [],
  hardwareFilters: {
    query: "",
    category: "all"
  },
  controls: createControlInteractionState(),
  view: {
    zoom: 1,
    center: [BENCH_WIDTH / 2, BENCH_HEIGHT / 2]
  }
};
let storageHydrationFinished = false;
let userEditedBeforeStorageHydration = false;
let pointerInteraction = null;
let wireInteraction = null;
let benchPanInteraction = null;
let pendingPreviewProject = null;
let previewAnimationFrame = 0;
let suppressNextBenchClick = false;
let pendingFritzingFzpFile = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentProject() {
  return normalizeProject(currentHistoryValue(history));
}

function selectedComponentInstance(project = currentProject()) {
  return project.components.find((component) => component.id === project.selectedComponentId) ?? null;
}

function selectedConnection(project = currentProject()) {
  return project.connections.find((connection) => connection.id === project.selectedConnectionId) ?? null;
}

function noteUserEdit(options = {}) {
  if (!storageHydrationFinished && options.userEdit !== false) userEditedBeforeStorageHydration = true;
}

function refreshDerived() {
  const project = currentProject();
  uiState.artifacts = buildCircuitArtifacts({
    circuitLabProject: project,
    robotDesign: uiState.robotDesign,
    mechatronicsBinding: uiState.binding,
    sessionState: uiState.controls
  });
  uiState.test = uiState.artifacts.test;
  uiState.source = generateCircuitLabSource(project, {
    mechatronicsBinding: uiState.binding,
    artifacts: uiState.artifacts
  });
  if (uiState.selectedIssueId && !uiState.test.issues.some((issue) => issue.id === uiState.selectedIssueId)) {
    uiState.selectedIssueId = null;
  }
  if (!uiState.source.files.some((file) => file.path === uiState.selectedSourcePath)) {
    uiState.selectedSourcePath = uiState.source.files[0]?.path ?? "";
  }
}

function showStatus(message, timeoutMs = 3600) {
  statusEl.textContent = message;
  if (!timeoutMs) return;
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    const summary = projectSummary(currentProject());
    statusEl.textContent = `${summary.name} / ${summary.componentCount} components / ${summary.connectionCount} wires`;
  }, timeoutMs);
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeBenchZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_BENCH_ZOOM, Math.max(MIN_BENCH_ZOOM, numeric));
}

function clampBenchViewCenter(center, zoom = uiState.view.zoom) {
  const viewWidth = BENCH_WIDTH / zoom;
  const viewHeight = BENCH_HEIGHT / zoom;
  const halfWidth = Math.min(BENCH_WIDTH / 2, viewWidth / 2);
  const halfHeight = Math.min(BENCH_HEIGHT / 2, viewHeight / 2);
  return [
    Math.min(BENCH_WIDTH - halfWidth, Math.max(halfWidth, Number(center?.[0] ?? BENCH_WIDTH / 2))),
    Math.min(BENCH_HEIGHT - halfHeight, Math.max(halfHeight, Number(center?.[1] ?? BENCH_HEIGHT / 2)))
  ];
}

function benchViewBoxFor(zoom = uiState.view.zoom, center = uiState.view.center) {
  const normalizedZoom = normalizeBenchZoom(zoom);
  const viewWidth = BENCH_WIDTH / normalizedZoom;
  const viewHeight = BENCH_HEIGHT / normalizedZoom;
  const clampedCenter = clampBenchViewCenter(center, normalizedZoom);
  return [
    clampedCenter[0] - viewWidth / 2,
    clampedCenter[1] - viewHeight / 2,
    viewWidth,
    viewHeight
  ];
}

function renderBenchView() {
  const viewBox = benchViewBoxFor();
  benchSvg.setAttribute("viewBox", viewBox.map((value) => value.toFixed(3)).join(" "));
  benchSvg.classList.toggle("is-pan-ready", uiState.view.zoom > 1.001);
  benchSvg.classList.toggle("is-panning", Boolean(benchPanInteraction));
  if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(uiState.view.zoom * 100)}%`;
  if (zoomOutButton) zoomOutButton.disabled = uiState.view.zoom <= MIN_BENCH_ZOOM + 0.001;
  if (zoomInButton) zoomInButton.disabled = uiState.view.zoom >= MAX_BENCH_ZOOM - 0.001;
}

function setBenchZoom(nextZoom, options = {}) {
  const currentZoom = uiState.view.zoom;
  const next = normalizeBenchZoom(nextZoom);
  const anchor = options.anchorPoint;
  let center = uiState.view.center;
  if (anchor) {
    const oldViewBox = benchViewBoxFor(currentZoom, center);
    const relative = [
      oldViewBox[2] ? (anchor[0] - oldViewBox[0]) / oldViewBox[2] : 0.5,
      oldViewBox[3] ? (anchor[1] - oldViewBox[1]) / oldViewBox[3] : 0.5
    ];
    const nextWidth = BENCH_WIDTH / next;
    const nextHeight = BENCH_HEIGHT / next;
    center = [
      anchor[0] - relative[0] * nextWidth + nextWidth / 2,
      anchor[1] - relative[1] * nextHeight + nextHeight / 2
    ];
  }
  uiState.view.zoom = next;
  uiState.view.center = clampBenchViewCenter(center, next);
  renderBench();
}

function resetBenchZoom() {
  uiState.view.zoom = 1;
  uiState.view.center = [BENCH_WIDTH / 2, BENCH_HEIGHT / 2];
  renderBench();
}

function commitProject(project, message = "Circuit Lab updated", options = {}) {
  noteUserEdit(options);
  commitHistory(history, normalizeProject(project));
  uiState.pendingEndpoint = null;
  uiState.wireDrag = null;
  releaseAllMomentaryControls(uiState.controls);
  refreshDerived();
  render();
  showStatus(message);
  return currentProject();
}

function resetProject(project, message = "Circuit Lab reset", options = {}) {
  noteUserEdit(options);
  resetHistory(history, normalizeProject(project));
  if (options.preserveBinding !== true) uiState.binding = normalizeMechatronicsBinding();
  uiState.pendingEndpoint = null;
  uiState.wireDrag = null;
  releaseAllMomentaryControls(uiState.controls);
  refreshDerived();
  render();
  showStatus(message);
  return currentProject();
}

function stableBindingId(...parts) {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "binding";
}

function replaceBindingSession(binding, message = "Mechatronics binding updated") {
  noteUserEdit();
  uiState.binding = normalizeMechatronicsBinding({
    ...binding,
    updatedAt: new Date().toISOString()
  });
  refreshDerived();
  render();
  showStatus(`${message}; save to persist it`);
  return uiState.binding;
}

function setActuatorBindingSession(args) {
  const binding = normalizeMechatronicsBinding(uiState.binding);
  const id = args.bindingId || stableBindingId("actuator", args.jointId, args.actuatorId);
  const nextItem = {
    id,
    jointId: args.jointId,
    actuatorId: args.actuatorId,
    circuitComponentId: args.circuitComponentId,
    firmwareChannelIds: args.firmwareChannelIds,
    commandTransform: args.commandTransform ?? { invert: false, scale: 1, offset: 0 }
  };
  const index = binding.actuatorBindings.findIndex((item) => item.id === id);
  if (index >= 0) binding.actuatorBindings[index] = nextItem;
  else binding.actuatorBindings.push(nextItem);
  replaceBindingSession(binding, `${id} actuator binding staged`);
  return nextItem;
}

function setSensorBindingSession(args) {
  const binding = normalizeMechatronicsBinding(uiState.binding);
  const id = args.bindingId || stableBindingId("sensor", args.sensorId);
  const nextItem = {
    id,
    sensorId: args.sensorId,
    circuitComponentId: args.circuitComponentId,
    firmwareChannelIds: args.firmwareChannelIds
  };
  const index = binding.sensorBindings.findIndex((item) => item.id === id);
  if (index >= 0) binding.sensorBindings[index] = nextItem;
  else binding.sensorBindings.push(nextItem);
  replaceBindingSession(binding, `${id} sensor binding staged`);
  return nextItem;
}

function setFirmwareChannelSession(args) {
  const binding = normalizeMechatronicsBinding(uiState.binding);
  const nextItem = {
    id: args.channelId,
    semanticRole: args.semanticRole,
    direction: args.direction,
    signalType: args.signalType,
    valueType: args.valueType,
    controllerTerminalRef: args.controllerTerminalRef,
    deviceTerminalRef: args.deviceTerminalRef
  };
  const index = binding.firmwareChannels.findIndex((item) => item.id === nextItem.id);
  if (index >= 0) binding.firmwareChannels[index] = nextItem;
  else binding.firmwareChannels.push(nextItem);
  replaceBindingSession(binding, `${nextItem.id} firmware channel staged`);
  return nextItem;
}

function removeBindingSession({ targetType, targetId }) {
  const binding = normalizeMechatronicsBinding(uiState.binding);
  if (targetType === "actuator") {
    binding.actuatorBindings = binding.actuatorBindings.filter((item) => item.id !== targetId);
  } else if (targetType === "sensor") {
    binding.sensorBindings = binding.sensorBindings.filter((item) => item.id !== targetId);
  } else if (targetType === "firmwareChannel") {
    binding.firmwareChannels = binding.firmwareChannels.filter((item) => item.id !== targetId);
    binding.actuatorBindings = binding.actuatorBindings.map((item) => ({
      ...item,
      firmwareChannelIds: item.firmwareChannelIds.filter((channelId) => channelId !== targetId)
    }));
    binding.sensorBindings = binding.sensorBindings.map((item) => ({
      ...item,
      firmwareChannelIds: item.firmwareChannelIds.filter((channelId) => channelId !== targetId)
    }));
  }
  replaceBindingSession(binding, `${targetId} removed from binding`);
  return normalizeMechatronicsBinding(uiState.binding);
}

function commitSelection(project) {
  replaceHistoryValue(history, normalizeProject(project));
  render();
}

function downloadBlob(data, fileName, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function svgElement(tag, attributes = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  element.append(...children);
  return element;
}

function componentLabel(component, componentDef) {
  const bounds = componentBounds(component, componentDef);
  const label = svgElement("text", {
    x: component.position[0],
    y: bounds.top - 8,
    "text-anchor": "middle",
    class: "bench-label"
  });
  label.textContent = component.name;
  return label;
}

function localText(text, x, y, className = "component-print", attributes = {}) {
  const element = svgElement("text", {
    x,
    y,
    class: className,
    "text-anchor": "middle",
    ...attributes
  });
  element.textContent = text;
  return element;
}

function pinPad(x, y, kind = "signal", size = 2.6) {
  return svgElement("rect", {
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
    rx: 0.6,
    class: `printed-pad printed-pad--${kind}`
  });
}

function pinRow(count, x, y, spacing, kind = "signal") {
  return Array.from({ length: count }, (_, index) => pinPad(x, y + index * spacing, kind));
}

function breadboardBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  const railXs = componentDef.terminals
    .filter((terminal) => /^bp\d+$/.test(terminal.id))
    .map((terminal) => terminal.position[0]);
  const railStart = Math.min(...railXs);
  const railEnd = Math.max(...railXs);
  const elements = [
    svgElement("rect", {
      x: -width / 2,
      y: -height / 2,
      width,
      height,
      rx: 7,
      class: "component-body",
      fill: componentDef.color
    }),
    svgElement("rect", {
      x: -width / 2 + 5,
      y: -height / 2 + 5,
      width: width - 10,
      height: height - 10,
      rx: 5,
      class: "breadboard-well"
    }),
    svgElement("line", {
      x1: -width / 2 + 8,
      x2: width / 2 - 8,
      y1: 0,
      y2: 0,
      stroke: "#d9d2c3",
      "stroke-width": 3
    }),
    svgElement("line", {
      x1: railStart - 2,
      x2: railEnd + 2,
      y1: componentDef.terminals.find((terminal) => terminal.id === "tp1")?.position[1] ?? -24,
      y2: componentDef.terminals.find((terminal) => terminal.id === "tp1")?.position[1] ?? -24,
      stroke: "#dc2626",
      "stroke-width": 1.5
    }),
    svgElement("line", {
      x1: railStart - 2,
      x2: railEnd + 2,
      y1: componentDef.terminals.find((terminal) => terminal.id === "bn1")?.position[1] ?? 24,
      y2: componentDef.terminals.find((terminal) => terminal.id === "bn1")?.position[1] ?? 24,
      stroke: "#111827",
      "stroke-width": 1.5
    }),
    localText("+", -width / 2 + 7, componentDef.terminals.find((terminal) => terminal.id === "tp1")?.position[1] ?? -24, "component-print component-print--red"),
    localText("-", -width / 2 + 7, componentDef.terminals.find((terminal) => terminal.id === "bn1")?.position[1] ?? 24, "component-print component-print--blue"),
    localText("1", componentDef.terminals.find((terminal) => terminal.id === "r1a")?.position[0] ?? -37, -1.5, "component-print component-print--muted"),
    localText("15", componentDef.terminals.find((terminal) => terminal.id === "r15a")?.position[0] ?? -1.3, -1.5, "component-print component-print--muted"),
    localText("30", componentDef.terminals.find((terminal) => terminal.id === "r30a")?.position[0] ?? 37, -1.5, "component-print component-print--muted"),
    localText("A-E", -width / 2 + 12, -13, "component-print component-print--muted"),
    localText("F-J", -width / 2 + 12, 16, "component-print component-print--muted"),
    localText("400 POINT", 0, -2, "component-print component-print--muted")
  ];
  return elements;
}

function arduinoBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("rect", {
      x: -width / 2,
      y: -height / 2,
      width,
      height,
      rx: 7,
      class: "component-body",
      fill: componentColor(componentDef)
    }),
    svgElement("rect", { x: -width / 2 + 7, y: -height / 2 + 5, width: 14, height: 11, rx: 1.5, class: "usb-port" }),
    svgElement("rect", { x: width / 2 - 15, y: -height / 2 + 6, width: 10, height: 10, rx: 2, class: "barrel-jack" }),
    svgElement("rect", { x: -12, y: -8, width: 28, height: 18, rx: 2, class: "controller-chip" }),
    svgElement("rect", { x: -28, y: 11, width: 20, height: 7, rx: 1.5, class: "silver-part" }),
    svgElement("circle", { cx: 24, cy: 9, r: 5, class: "reset-button" }),
    ...componentDef.terminals.map((terminal) => pinPad(terminal.position[0], terminal.position[1], terminal.kind === TERMINAL_KINDS.POWER ? "power" : terminal.kind === TERMINAL_KINDS.GROUND ? "ground" : "signal", 2.2)),
    localText("ARDUINO", 0, -13, "component-print component-print--light"),
    localText("UNO R3", 0, 21, "component-print component-print--light")
  ];
}

function esp32Background(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 6, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("rect", { x: -12, y: -height / 2 - 2, width: 24, height: 10, rx: 2, class: "usb-port" }),
    svgElement("rect", { x: -18, y: -17, width: 36, height: 26, rx: 2, class: "esp-shield" }),
    svgElement("rect", { x: -17, y: height / 2 - 16, width: 34, height: 11, rx: 1, class: "antenna-zone" }),
    ...componentDef.terminals.map((terminal) => pinPad(terminal.position[0], terminal.position[1], terminal.kind === TERMINAL_KINDS.POWER ? "power" : terminal.kind === TERMINAL_KINDS.GROUND ? "ground" : "signal", 2.2)),
    localText("ESP32", 0, -3, "component-print component-print--dark"),
    localText("WROOM", 0, 16, "component-print component-print--light")
  ];
}

function servoBackground(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const angle = normalizeControlState(componentDef, component?.props?.controls).previewAngleDeg ?? 90;
  const hornRotation = Number(angle) - 90;
  return [
    svgElement("rect", { x: -width / 2 - 8, y: -height / 2 + 5, width: 8, height: height - 10, rx: 2, class: "servo-tab" }),
    svgElement("rect", { x: width / 2, y: -height / 2 + 5, width: 8, height: height - 10, rx: 2, class: "servo-tab" }),
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 5, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("rect", { x: -width / 2 + 6, y: -height / 2 + 4, width: 18, height: height - 8, rx: 2, class: "servo-gearbox" }),
    svgElement("g", { class: "servo-horn-state", transform: `rotate(${hornRotation} 10 0)`, "data-control-state": String(Math.round(Number(angle))) }, [
      svgElement("circle", { cx: 10, cy: 0, r: 11, class: "servo-horn" }),
      svgElement("circle", { cx: 10, cy: 0, r: 3.2, class: "servo-screw" }),
      svgElement("line", { x1: 10, y1: 0, x2: 25, y2: -8, class: "servo-arm" }),
      svgElement("line", { x1: 10, y1: 0, x2: 25, y2: 8, class: "servo-arm" })
    ]),
    svgElement("line", { x1: width / 2 - 1, y1: -8, x2: width / 2 + 9, y2: -8, class: "servo-pigtail servo-pigtail--signal" }),
    svgElement("line", { x1: width / 2 - 1, y1: 0, x2: width / 2 + 9, y2: 0, class: "servo-pigtail servo-pigtail--power" }),
    svgElement("line", { x1: width / 2 - 1, y1: 8, x2: width / 2 + 9, y2: 8, class: "servo-pigtail servo-pigtail--ground" }),
    svgElement("rect", { x: width / 2 - 3, y: -11, width: 6, height: 22, rx: 1, class: "terminal-block" }),
    localText("SERVO", -9, 4, "component-print component-print--light")
  ];
}

function supplyBackground(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const power = normalizeControlState(componentDef, component?.props?.controls).power ?? "off";
  const switchY = power === "on" ? -height / 2 + 5 : -height / 2 + 12;
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 5, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("rect", { x: -width / 2 + 7, y: -height / 2 + 7, width: width - 14, height: 4, rx: 2, class: "battery-highlight" }),
    svgElement("rect", { x: width / 2 - 14, y: -height / 2 + 5, width: 8, height: 17, rx: 2, class: "power-switch-slot" }),
    svgElement("rect", { x: width / 2 - 14, y: switchY, width: 8, height: 10, rx: 1.5, class: `power-switch power-switch--${power}` }),
    svgElement("circle", { cx: width / 2 - 3, cy: -height / 2 + 8, r: 1.7, class: `power-indicator power-indicator--${power}` }),
    svgElement("rect", { x: -width / 2 + 2, y: -12, width: 12, height: 8, rx: 1, class: "terminal-block terminal-block--red" }),
    svgElement("rect", { x: -width / 2 + 2, y: 4, width: 12, height: 8, rx: 1, class: "terminal-block terminal-block--black" }),
    localText("+", -width / 2 + 8, -6, "component-print component-print--light"),
    localText("-", -width / 2 + 8, 10, "component-print component-print--light"),
    localText("6V", -1, 1, "component-print component-print--light"),
    localText("SUPPLY", 12, 11, "component-print component-print--muted")
  ];
}

function ledBackground(componentDef) {
  return [
    svgElement("line", { x1: -12, y1: 0, x2: -5, y2: 0, class: "part-lead" }),
    svgElement("line", { x1: 5, y1: 0, x2: 12, y2: 0, class: "part-lead" }),
    svgElement("path", { d: "M -6 2 C -7 -7, 7 -7, 6 2 Z", class: "led-lens", fill: componentColor(componentDef) }),
    svgElement("line", { x1: 3, y1: -4, x2: 6, y2: -8, class: "led-glint" }),
    svgElement("line", { x1: 6, y1: 4, x2: 8, y2: 4, class: "led-flat" })
  ];
}

function resistorBackground() {
  return [
    svgElement("line", { x1: -22, y1: 0, x2: -14, y2: 0, class: "part-lead" }),
    svgElement("line", { x1: 14, y1: 0, x2: 22, y2: 0, class: "part-lead" }),
    svgElement("rect", { x: -14, y: -5, width: 28, height: 10, rx: 5, class: "resistor-body" }),
    svgElement("rect", { x: -7, y: -5, width: 2.2, height: 10, class: "resistor-band resistor-band--red" }),
    svgElement("rect", { x: -2, y: -5, width: 2.2, height: 10, class: "resistor-band resistor-band--red" }),
    svgElement("rect", { x: 3.2, y: -5, width: 2.2, height: 10, class: "resistor-band resistor-band--brown" }),
    svgElement("rect", { x: 8.2, y: -5, width: 2.2, height: 10, class: "resistor-band resistor-band--gold" })
  ];
}

function capacitorBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("path", { d: `M -5 ${height / 2 - 2} L -5 12 L 0 12`, class: "part-lead" }),
    svgElement("path", { d: `M 5 ${height / 2 - 2} L 5 17 L 0 17`, class: "part-lead" }),
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 4, class: "capacitor-can", fill: componentColor(componentDef) }),
    svgElement("rect", { x: width / 2 - 8, y: -height / 2 + 2, width: 4, height: height - 4, rx: 1.4, class: "capacitor-negative-stripe" }),
    localText("+", -7, 2, "component-print component-print--light"),
    localText("470uF", 1, -5, "component-print component-print--light")
  ];
}

function buttonBackground(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const pressed = isMomentaryControlActive(uiState.controls, component?.id, "press");
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 4, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("circle", { cx: 0, cy: pressed ? 1.2 : 0, r: pressed ? 6.2 : 7, class: `button-cap ${pressed ? "button-cap--pressed" : ""}` }),
    svgElement("line", { x1: -14, y1: -7, x2: -10, y2: -7, class: "button-leg" }),
    svgElement("line", { x1: 10, y1: -7, x2: 14, y2: -7, class: "button-leg" }),
    svgElement("line", { x1: -14, y1: 7, x2: -10, y2: 7, class: "button-leg" }),
    svgElement("line", { x1: 10, y1: 7, x2: 14, y2: 7, class: "button-leg" })
  ];
}

function ultrasonicBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 3, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("circle", { cx: -11, cy: -1, r: 8.5, class: "ultrasonic-can" }),
    svgElement("circle", { cx: 11, cy: -1, r: 8.5, class: "ultrasonic-can" }),
    svgElement("circle", { cx: -11, cy: -1, r: 5.5, class: "ultrasonic-mesh" }),
    svgElement("circle", { cx: 11, cy: -1, r: 5.5, class: "ultrasonic-mesh" }),
    ...[-18, -6, 6, 18].map((x) => pinPad(x, height / 2 - 4, "signal", 2.8)),
    localText("HC-SR04", 0, -height / 2 + 6, "component-print component-print--light")
  ];
}

function driverBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 4, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("rect", { x: -7, y: -12, width: 21, height: 24, rx: 2, class: "driver-heatsink" }),
    ...[-7, -2, 3, 8].map((x) => svgElement("line", { x1: x, y1: -11, x2: x, y2: 11, class: "driver-fin" })),
    svgElement("circle", { cx: 18, cy: -13, r: 5, class: "driver-capacitor" }),
    svgElement("rect", { x: -width / 2 + 2, y: -19, width: 12, height: 11, rx: 1, class: "terminal-block terminal-block--green" }),
    svgElement("rect", { x: width / 2 - 14, y: -13, width: 12, height: 22, rx: 1, class: "terminal-block terminal-block--green" }),
    localText("L298N", -10, 18, "component-print component-print--light")
  ];
}

function motorBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("rect", { x: -width / 2 - 3, y: -5, width: 7, height: 10, rx: 1, class: "motor-terminal motor-terminal--a" }),
    svgElement("rect", { x: width / 2 - 4, y: -5, width: 7, height: 10, rx: 1, class: "motor-terminal motor-terminal--b" }),
    svgElement("rect", { x: -width / 2 + 6, y: -height / 2, width: width - 12, height, rx: height / 2, class: "motor-can", fill: componentColor(componentDef) }),
    svgElement("rect", { x: -width / 2, y: -10, width: 8, height: 20, rx: 2, class: "motor-endcap" }),
    svgElement("line", { x1: width / 2 - 3, y1: 0, x2: width / 2 + 11, y2: 0, class: "motor-shaft" }),
    svgElement("circle", { cx: 2, cy: 0, r: 7, class: "motor-core" }),
    localText("DC", 1, 4, "component-print component-print--light")
  ];
}

function potentiometerBackground(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const wiper = normalizeControlState(componentDef, component?.props?.controls).wiper ?? 0.5;
  const angle = -135 + Number(wiper) * 270;
  return [
    svgElement("circle", { cx: 0, cy: -3, r: 10, class: "potentiometer-body", fill: componentColor(componentDef) }),
    svgElement("circle", { cx: 0, cy: -3, r: 5, class: "potentiometer-knob" }),
    svgElement("line", { x1: 0, y1: -3, x2: 0, y2: -11, class: "potentiometer-index", transform: `rotate(${angle} 0 -3)` }),
    ...[-5.08, 0, 5.08].map((x) => svgElement("line", { x1: x, y1: height / 2 - 7, x2: x, y2: height / 2, class: "part-lead" })),
    localText("10K", 0, 7, "component-print component-print--light")
  ];
}

function switchBackground(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const throwState = normalizeControlState(componentDef, component?.props?.controls).throw ?? "a";
  const thumbX = throwState === "b" ? 0.5 : -5.5;
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 2, class: "component-body", fill: componentColor(componentDef) }),
    svgElement("rect", { x: -5, y: -4, width: 10, height: 8, rx: 1.5, class: "switch-slot" }),
    svgElement("rect", { x: thumbX, y: -3, width: 5, height: 6, rx: 1, class: `switch-thumb switch-thumb--${throwState}` }),
    ...[-5.08, 0, 5.08].map((x) => svgElement("line", { x1: x, y1: height / 2 - 1, x2: x, y2: height / 2 + 5, class: "part-lead" }))
  ];
}

function fallbackBackground(componentDef) {
  const [width, height] = componentDef.dimensions;
  return [
    svgElement("rect", { x: -width / 2, y: -height / 2, width, height, rx: 5, class: "component-body", fill: componentColor(componentDef) }),
    localText(componentDef.name, 0, 3, "component-print component-print--light")
  ];
}

function customSvgArtwork(componentDef) {
  if (!componentDef.view?.customSvg) return null;
  try {
    const parser = new DOMParser();
    const documentValue = parser.parseFromString(componentDef.view.customSvg, "image/svg+xml");
    const root = documentValue.documentElement;
    if (!root || root.nodeName.toLowerCase() === "parsererror") return null;
    const viewBox = componentDef.view.customViewBox ?? parseSvgViewBox(componentDef.view.customSvg);
    const [width, height] = componentDef.dimensions;
    const scale = Math.min(width / viewBox.width, height / viewBox.height);
    const outer = svgElement("g", { class: "custom-component-svg", transform: `scale(${scale})` });
    const inner = svgElement("g", { transform: `translate(${-viewBox.x - viewBox.width / 2} ${-viewBox.y - viewBox.height / 2})` });
    for (const child of [...root.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.TEXT_NODE) {
        inner.append(document.importNode(child, true));
      }
    }
    outer.append(inner);
    return [outer];
  } catch {
    return null;
  }
}

function photorealAssetArtwork(componentDef) {
  const visual = getVisualDefinition(componentDef.id);
  if (visual?.assetKind !== "photorealistic-svg-wrapper") return null;
  const assetUrl = getPhotorealAssetUrl(visual.assetId ?? componentDef.id);
  if (!assetUrl) return null;
  const [width, height] = componentDef.dimensions;
  return [svgElement("image", {
    href: assetUrl,
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    class: "photoreal-component-image",
    preserveAspectRatio: "xMidYMid meet"
  })];
}

function servoStateOverlay(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const angle = normalizeControlState(componentDef, component?.props?.controls).previewAngleDeg ?? 90;
  const hornRotation = Number(angle) - 90;
  const centerX = width / 2 > 40 ? 10 : Math.min(9, width * 0.22);
  return [
    svgElement("g", { class: "servo-horn-state photoreal-state-overlay", transform: `rotate(${hornRotation} ${centerX} 0)`, "data-control-state": String(Math.round(Number(angle))) }, [
      svgElement("circle", { cx: centerX, cy: 0, r: Math.min(11, height * 0.38), class: "servo-horn" }),
      svgElement("circle", { cx: centerX, cy: 0, r: 2.4, class: "servo-screw" }),
      svgElement("line", { x1: centerX, y1: 0, x2: centerX + Math.min(15, width * 0.3), y2: -Math.min(8, height * 0.25), class: "servo-arm" }),
      svgElement("line", { x1: centerX, y1: 0, x2: centerX + Math.min(15, width * 0.3), y2: Math.min(8, height * 0.25), class: "servo-arm" })
    ])
  ];
}

function supplyStateOverlay(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const power = normalizeControlState(componentDef, component?.props?.controls).power ?? "off";
  const switchY = power === "on" ? -height / 2 + 5 : -height / 2 + 12;
  return [
    svgElement("rect", { x: width / 2 - 14, y: -height / 2 + 5, width: 8, height: 17, rx: 2, class: "power-switch-slot photoreal-state-overlay" }),
    svgElement("rect", { x: width / 2 - 14, y: switchY, width: 8, height: 10, rx: 1.5, class: `power-switch power-switch--${power} photoreal-state-overlay` }),
    svgElement("circle", { cx: width / 2 - 3, cy: -height / 2 + 8, r: 1.7, class: `power-indicator power-indicator--${power} photoreal-state-overlay` })
  ];
}

function buttonStateOverlay(componentDef, component) {
  const pressed = isMomentaryControlActive(uiState.controls, component?.id, "press");
  return [
    svgElement("circle", { cx: 0, cy: pressed ? 1.2 : 0, r: pressed ? 5.1 : 5.8, class: `button-cap photoreal-state-overlay ${pressed ? "button-cap--pressed" : ""}` })
  ];
}

function potentiometerStateOverlay(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const wiper = normalizeControlState(componentDef, component?.props?.controls).wiper ?? 0.5;
  const angle = -135 + Number(wiper) * 270;
  return [
    svgElement("line", {
      x1: 0,
      y1: -height * 0.12,
      x2: 0,
      y2: -height * 0.32,
      class: "potentiometer-index photoreal-state-overlay",
      transform: `rotate(${angle} 0 ${-height * 0.12})`
    }),
    svgElement("circle", { cx: 0, cy: -height * 0.12, r: Math.min(width, height) * 0.09, class: "potentiometer-knob photoreal-state-overlay" })
  ];
}

function switchStateOverlay(componentDef, component) {
  const [width, height] = componentDef.dimensions;
  const throwState = normalizeControlState(componentDef, component?.props?.controls).throw ?? "a";
  const thumbX = throwState === "b" ? width * 0.08 : -width * 0.16;
  return [
    svgElement("rect", { x: -width * 0.24, y: -height * 0.32, width: width * 0.48, height: height * 0.54, rx: 1.2, class: "switch-slot photoreal-state-overlay" }),
    svgElement("rect", { x: thumbX, y: -height * 0.24, width: width * 0.22, height: height * 0.4, rx: 1, class: `switch-thumb switch-thumb--${throwState} photoreal-state-overlay` })
  ];
}

function photorealStateOverlays(componentDef, component) {
  if (componentDef.sim.role === "servo") return servoStateOverlay(componentDef, component);
  if (componentDef.sim.role === "externalSupply") return supplyStateOverlay(componentDef, component);
  if (componentDef.sim.role === "button") return buttonStateOverlay(componentDef, component);
  if (componentDef.sim.role === "potentiometer" || componentDef.sim.role === "joystick") return potentiometerStateOverlay(componentDef, component);
  if (componentDef.sim.role === "switch") return switchStateOverlay(componentDef, component);
  return [];
}

function componentArtwork(componentDef, component = null) {
  const customArtwork = customSvgArtwork(componentDef);
  if (customArtwork) return customArtwork;
  const photorealArtwork = photorealAssetArtwork(componentDef);
  if (photorealArtwork) return [...photorealArtwork, ...photorealStateOverlays(componentDef, component)];
  if (componentDef.sim.role === "breadboard") return breadboardBackground(componentDef);
  if (componentDef.sim.role === "controller" && componentDef.sim.family === "avr") return arduinoBackground(componentDef);
  if (componentDef.sim.role === "controller" && componentDef.sim.family === "esp32") return esp32Background(componentDef);
  if (componentDef.sim.role === "servo") return servoBackground(componentDef, component);
  if (componentDef.sim.role === "externalSupply") return supplyBackground(componentDef, component);
  if (componentDef.sim.role === "led") return ledBackground(componentDef);
  if (componentDef.sim.role === "resistor") return resistorBackground(componentDef);
  if (componentDef.sim.role === "capacitor") return capacitorBackground(componentDef);
  if (componentDef.sim.role === "button") return buttonBackground(componentDef, component);
  if (componentDef.sim.role === "sensor") return ultrasonicBackground(componentDef);
  if (componentDef.sim.role === "motorDriver") return driverBackground(componentDef);
  if (componentDef.sim.role === "dcMotor") return motorBackground(componentDef);
  if (componentDef.sim.role === "potentiometer") return potentiometerBackground(componentDef, component);
  if (componentDef.sim.role === "switch") return switchBackground(componentDef, component);
  return fallbackBackground(componentDef);
}

function componentHitbox(componentDef) {
  const [width, height] = componentDef.dimensions;
  return svgElement("rect", {
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    rx: 6,
    class: "component-hitbox"
  });
}

function renderTerminals(component, componentDef, highlightEndpointKeys, occupancyByEndpoint = new Map()) {
  const terminals = [];
  for (const terminal of componentDef.terminals) {
    const endpointKey = `${component.id}:${terminal.id}`;
    const terminalEl = svgElement("circle", {
      cx: terminal.position[0],
      cy: terminal.position[1],
      r: terminalRadius(componentDef),
      class: [
        componentDef.sim.role === "breadboard" ? "breadboard-hole" : "terminal",
        uiState.pendingEndpoint?.componentId === component.id && uiState.pendingEndpoint?.terminalId === terminal.id ? "is-pending" : "",
        highlightEndpointKeys.has(endpointKey) ? "is-highlighted" : "",
        uiState.wireDrag?.targetEndpoint && endpointKey === `${uiState.wireDrag.targetEndpoint.componentId}:${uiState.wireDrag.targetEndpoint.terminalId}` ? "is-snap-target" : ""
      ].filter(Boolean).join(" "),
      "data-terminal-component": component.id,
      "data-terminal-id": terminal.id,
      "data-kind": terminal.kind,
      tabindex: 0,
      role: "button",
      "aria-label": terminalAriaLabel(component, terminal)
    }, [svgElement("title", {}, [document.createTextNode(terminalTooltip(component, terminal, occupancyByEndpoint.get(endpointKey)))])]);
    terminals.push(terminalEl);
  }
  return terminals;
}

function selectionOverlay(component, componentDef) {
  const bounds = componentBounds(component, componentDef);
  const scalePercent = Math.round(componentScale(component) * 100);
  const rotation = normalizeComponentRotation(component.rotation);
  const overlay = svgElement("g", {
    class: "selection-overlay",
    "data-component-id": component.id
  });
  overlay.append(
    svgElement("rect", {
      x: bounds.x - 4,
      y: bounds.y - 4,
      width: bounds.width + 8,
      height: bounds.height + 8,
      rx: 5,
      class: "selection-box"
    }),
    svgElement("rect", {
      x: bounds.right + 2,
      y: bounds.bottom + 2,
      width: 12,
      height: 12,
      rx: 2,
      class: "resize-handle",
      "data-resize-component-id": component.id
    }),
    svgElement("text", {
      x: bounds.right + 18,
      y: bounds.bottom + 12,
      class: "selection-size-label"
    }, [document.createTextNode(`${scalePercent}% / ${rotation}deg`)])
  );
  return overlay;
}

function renderComponent(project, component, highlightEndpointKeys, highlightComponentIds = new Set(), occupancyByEndpoint = new Map()) {
  const componentDef = catalog.getComponent(component.typeId);
  if (!componentDef) return null;
  const visualStatus = componentVisualStatus(componentDef);
  const scale = componentScale(component);
  const group = svgElement("g", {
    class: `bench-component ${component.id === project.selectedComponentId ? "is-selected" : ""} ${highlightComponentIds.has(component.id) ? "is-highlighted" : ""}`,
    "data-component-id": component.id,
    "data-visual-kind": visualStatus.assetKind
  });
  const artwork = svgElement("g", {
    class: "component-artwork",
    transform: `translate(${component.position[0]} ${component.position[1]}) rotate(${normalizeComponentRotation(component.rotation)}) scale(${scale})`,
    "data-component-id": component.id
  });
  artwork.append(componentHitbox(componentDef), ...componentArtwork(componentDef, component));
  artwork.append(...renderTerminals(component, componentDef, highlightEndpointKeys, occupancyByEndpoint));
  group.append(artwork, componentLabel(component, componentDef));
  if (!visualStatus.ok) group.append(svgElement("title", {}, [document.createTextNode(fallbackVisualNotice(componentDef))]));
  if (component.id === project.selectedComponentId) group.append(selectionOverlay(component, componentDef));
  return group;
}

function renderWires(project, highlightConnectionIds) {
  const group = svgElement("g", { class: "bench-wires" });
  for (const connection of project.connections) {
    if (!shouldRenderExternalWire(connection)) continue;
    const points = connection.endpoints
      .map((endpoint) => resolveTerminal(project, endpoint))
      .filter((terminal) => terminal.ok);
    if (points.length < 2) continue;
    const bridgeWire = points.every((point) => point.componentDefinition.sim.role === "breadboard");
    for (let index = 1; index < points.length; index += 1) {
      group.append(svgElement("path", {
        d: wirePath(points[0].worldPosition, points[index].worldPosition),
        stroke: connection.color ?? "#f59e0b",
        class: [
          "wire-path",
          bridgeWire ? "wire-path--bridge" : "",
          connection.id === project.selectedConnectionId ? "is-selected" : "",
          highlightConnectionIds.has(connection.id) ? "is-highlighted" : ""
        ].filter(Boolean).join(" "),
        "data-connection-id": connection.id
      }));
      for (const point of [points[0], points[index]]) {
        group.append(svgElement("circle", {
          cx: point.worldPosition[0],
          cy: point.worldPosition[1],
          r: bridgeWire ? 2.2 : 3.4,
          fill: connection.color ?? "#f59e0b",
          class: [
            "wire-end",
            bridgeWire ? "wire-end--bridge" : endpointFittingClass(point),
            connection.id === project.selectedConnectionId ? "is-selected" : ""
          ].filter(Boolean).join(" "),
          "data-connection-id": connection.id
        }));
      }
    }
  }
  return group;
}

function fittingElement(descriptor, highlightConnectionIds) {
  const selected = highlightConnectionIds.has(descriptor.connectionId) ? "is-highlighted" : "";
  const group = svgElement("g", {
    class: ["connection-fitting", `connection-fitting--${descriptor.type}`, selected].filter(Boolean).join(" "),
    transform: `translate(${descriptor.position[0]} ${descriptor.position[1]}) rotate(${descriptor.angle})`,
    "data-fitting-connection-id": descriptor.connectionId,
    "data-fitting-type": descriptor.type,
    "data-fitting-endpoint": descriptor.endpointKey
  });
  const color = descriptor.color ?? "#f59e0b";
  if (descriptor.type === "breadboard-wire") {
    group.append(
      svgElement("circle", { cx: 0, cy: 0, r: 2.15, fill: color, class: "connection-fitting__socket-fill" }),
      svgElement("path", { d: "M -0.8 0 L 4.2 0", stroke: color, "stroke-width": 2.4, "stroke-linecap": "round", class: "connection-fitting__lead" })
    );
  } else if (descriptor.type === "inserted-breadboard-lead" || descriptor.type === "inserted-lead") {
    group.append(
      svgElement("circle", { cx: 0, cy: 0, r: 2.05, class: "connection-fitting__socket-fill" }),
      svgElement("line", { x1: -0.1, y1: 0, x2: 5.6, y2: 0, stroke: color, "stroke-width": 1.6, "stroke-linecap": "round", class: "connection-fitting__inserted-lead" })
    );
  } else if (descriptor.type === "ferrule") {
    group.append(
      svgElement("rect", { x: -1.8, y: -2.1, width: 5.8, height: 4.2, rx: 0.8, fill: "#d1d5db", class: "connection-fitting__metal" }),
      svgElement("line", { x1: 2.5, y1: 0, x2: 7.2, y2: 0, stroke: color, "stroke-width": 2.6, "stroke-linecap": "round", class: "connection-fitting__lead" })
    );
  } else if (descriptor.type === "servo-plug" || descriptor.type === "jst-plug") {
    group.append(
      svgElement("rect", { x: -3, y: -2.6, width: 6.4, height: 5.2, rx: 1, fill: descriptor.type === "jst-plug" ? "#f8fafc" : "#111827", class: "connection-fitting__plug" }),
      svgElement("line", { x1: 2.5, y1: 0, x2: 8, y2: 0, stroke: color, "stroke-width": 2.4, "stroke-linecap": "round", class: "connection-fitting__lead" })
    );
  } else if (descriptor.type === "solder-pad" || descriptor.type === "pigtail") {
    group.append(
      svgElement("circle", { cx: 0, cy: 0, r: 2.4, fill: "#cbd5e1", class: "connection-fitting__metal" }),
      svgElement("line", { x1: 1.6, y1: 0, x2: 7.5, y2: 0, stroke: color, "stroke-width": 2.2, "stroke-linecap": "round", class: "connection-fitting__lead" })
    );
  } else {
    group.append(
      svgElement("rect", { x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 0.7, fill: "#111827", class: "connection-fitting__plug" }),
      svgElement("line", { x1: 1.5, y1: 0, x2: 7.4, y2: 0, stroke: color, "stroke-width": 2.4, "stroke-linecap": "round", class: "connection-fitting__lead" })
    );
  }
  return group;
}

function renderConnectionFittings(project, highlightConnectionIds) {
  const group = svgElement("g", { class: "bench-connection-fittings", "aria-hidden": "true" });
  for (const descriptor of connectionFittingDescriptors(project)) {
    group.append(fittingElement(descriptor, highlightConnectionIds));
  }
  return group;
}

function renderWirePreview(project) {
  if (!uiState.wireDrag) return null;
  const start = resolveTerminal(project, uiState.wireDrag.startEndpoint);
  if (!start.ok) return null;
  const target = uiState.wireDrag.targetEndpoint ? resolveTerminal(project, uiState.wireDrag.targetEndpoint) : null;
  const end = target?.ok ? target.worldPosition : uiState.wireDrag.currentPoint;
  const color = target?.ok ? "#0ea5a4" : "#64748b";
  return svgElement("g", { class: "bench-wire-preview" }, [
    svgElement("path", {
      d: wirePath(start.worldPosition, end),
      stroke: color,
      class: "wire-path wire-path--preview"
    }),
    svgElement("circle", { cx: start.worldPosition[0], cy: start.worldPosition[1], r: 3, class: "wire-end wire-end--preview" }),
    svgElement("circle", { cx: end[0], cy: end[1], r: 3, class: "wire-end wire-end--preview" })
  ]);
}

function renderBench() {
  const project = currentProject();
  const occupancy = derivePhysicalOccupancy(project);
  renderBenchView();
  benchSvg.replaceChildren();
  const selectedIssue = uiState.selectedIssueId
    ? uiState.test.issues.find((issue) => issue.id === uiState.selectedIssueId)
    : null;
  const selectedEndpointKeys = new Set(
    (selectedIssue?.targets?.terminalRefs ?? []).map((endpoint) => `${endpoint.componentId}:${endpoint.terminalId}`)
  );
  const selectedConnectionIds = new Set(selectedIssue?.targets?.connectionIds ?? []);
  const selectedComponentIds = new Set(selectedIssue?.targets?.componentIds ?? []);
  const activeHighlights = selectedIssue
    ? uiState.test.highlights.filter((item) => (
      (item.endpoint && selectedEndpointKeys.has(`${item.endpoint.componentId}:${item.endpoint.terminalId}`))
      || (item.connectionId && selectedConnectionIds.has(item.connectionId))
      || (item.componentId && selectedComponentIds.has(item.componentId))
    ))
    : uiState.test.highlights;
  const highlightEndpointKeys = new Set(
    activeHighlights.filter((item) => item.type === "endpoint").map((item) => `${item.endpoint.componentId}:${item.endpoint.terminalId}`)
  );
  const highlightConnectionIds = new Set(
    activeHighlights.filter((item) => item.type === "connection").map((item) => item.connectionId)
  );
  const highlightComponentIds = new Set(
    activeHighlights.filter((item) => item.type === "component").map((item) => item.componentId)
  );
  benchSvg.append(svgElement("rect", { x: 0, y: 0, width: BENCH_WIDTH, height: BENCH_HEIGHT, fill: "transparent", class: "bench-pan-surface" }));
  benchSvg.append(renderWires(project, highlightConnectionIds));
  const preview = renderWirePreview(project);
  if (preview) benchSvg.append(preview);
  const componentsLayer = svgElement("g", { class: "bench-components" });
  for (const component of project.components) {
    const rendered = renderComponent(project, component, highlightEndpointKeys, highlightComponentIds, occupancy.occupancyByEndpoint);
    if (rendered) componentsLayer.append(rendered);
  }
  benchSvg.append(componentsLayer);
  benchSvg.append(renderConnectionFittings(project, highlightConnectionIds));
}

function renderProjectPanel(project) {
  const summary = projectSummary(project);
  projectNameInput.value = project.name;
  summaryEl.textContent = `${summary.connectionCount} wires`;
  readoutEl.innerHTML = [
    ["Controller", summary.controller],
    ["Components", summary.componentCount],
    ["Wires", summary.connectionCount],
    ["Units", project.units]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function renderStarters() {
  starterList.innerHTML = starterTemplates.map((template) => `
    <article class="starter-card">
      <strong>${escapeHtml(template.name)}</strong>
      <span>${escapeHtml(template.description)}</span>
      <button type="button" data-starter-template="${escapeHtml(template.id)}">Load Template</button>
    </article>
  `).join("");
}

function renderHardwareCatalog() {
  const components = catalog.listComponents();
  const categories = ["all", ...new Set(components.map((item) => item.category).filter(Boolean).sort((left, right) => left.localeCompare(right)))];
  const query = uiState.hardwareFilters.query.trim().toLowerCase();
  const category = uiState.hardwareFilters.category;
  const filteredComponents = components.filter((item) => {
    const categoryMatch = category === "all" || item.category === category;
    const queryMatch = !query || `${item.name} ${item.id} ${item.category} ${item.engineering?.robotics?.role ?? ""}`.toLowerCase().includes(query);
    return categoryMatch && queryMatch;
  });
  const builtIns = filteredComponents.filter((item) => !item.custom?.localOnly);
  const custom = filteredComponents.filter((item) => item.custom?.localOnly && !item.custom?.missing);
  const builtInTotal = components.filter((item) => !item.custom?.localOnly).length;
  const customTotal = components.filter((item) => item.custom?.localOnly && !item.custom?.missing).length;
  const hasActiveFilters = Boolean(query) || category !== "all";
  const categoryLabel = category === "all" ? "All categories" : category;
  const itemMarkup = (item) => `
    <article class="hardware-item ${item.custom?.localOnly ? "hardware-item--custom" : ""}" draggable="true" data-hardware-item="${escapeHtml(item.id)}">
      <span class="hardware-swatch" style="background:${escapeHtml(componentColor(item))}"></span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.category)} / ${item.terminals.length} terminals${item.custom?.localOnly ? " / local" : ""}</span>
      </div>
      <div class="hardware-item__actions">
        <button type="button" data-add-hardware="${escapeHtml(item.id)}">Add</button>
        ${item.custom?.localOnly ? `<button type="button" data-edit-custom-component="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)} metadata">Edit</button>` : ""}
        ${item.custom?.localOnly ? `<button type="button" data-delete-custom-component="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button>` : ""}
      </div>
    </article>
  `;
  hardwareList.innerHTML = `
    <div class="hardware-library-tools">
      <label class="hardware-filter-field">
        <span>Search</span>
        <input type="search" value="${escapeHtml(uiState.hardwareFilters.query)}" placeholder="sensor, driver, servo" data-hardware-search />
      </label>
      <label class="hardware-filter-field">
        <span>Category</span>
        <select data-hardware-category>
          ${categories.map((item) => `<option value="${escapeHtml(item)}" ${item === category ? "selected" : ""}>${escapeHtml(item === "all" ? "All" : item)}</option>`).join("")}
        </select>
      </label>
      <button class="circuit-primary-button" type="button" data-import-fritzing>
        Import Fritzing Part
      </button>
      ${hasActiveFilters ? `<button class="hardware-filter-clear" type="button" data-clear-hardware-filters>Show all</button>` : ""}
      <span class="hardware-filter-summary">
        ${builtIns.length} of ${builtInTotal} built-ins shown / ${custom.length} of ${customTotal} local custom shown / ${escapeHtml(categoryLabel)}
      </span>
    </div>
    <div class="hardware-library-group">
      <strong>Built-in (${builtIns.length}/${builtInTotal})</strong>
      ${builtIns.length ? builtIns.map(itemMarkup).join("") : `<p class="hardware-empty">No built-in components match the current filters.</p>`}
    </div>
    <div class="hardware-library-group">
      <strong>Custom (${custom.length}/${customTotal})</strong>
      ${custom.length ? custom.map(itemMarkup).join("") : `<p class="hardware-empty">No local custom components imported.</p>`}
    </div>
  `;
}

function renderComponents(project) {
  componentCountEl.textContent = String(project.components.length);
  componentList.innerHTML = project.components.map((component) => {
    const definition = catalog.getComponent(component.typeId);
    return `
      <article class="circuit-item ${component.id === project.selectedComponentId ? "is-selected" : ""}" data-component-id="${escapeHtml(component.id)}">
        <strong>${escapeHtml(component.name)}</strong>
        <span>${escapeHtml(definition?.name ?? component.typeId)}</span>
        <div class="circuit-item__meta">
          <span>${component.position.map((value) => Number(value).toFixed(0)).join(", ")} mm</span>
          <span>${Math.round(componentScale(component) * 100)}%</span>
          <span>${normalizeComponentRotation(component.rotation)}deg</span>
          <span>${escapeHtml(definition?.category ?? "Unknown")}</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderWiresList(project) {
  wireCountEl.textContent = String(project.connections.length);
  wireList.innerHTML = project.connections.map((connection) => `
    <article class="circuit-item ${connection.id === project.selectedConnectionId ? "is-selected" : ""}" data-connection-id="${escapeHtml(connection.id)}">
      <strong>${escapeHtml(connection.name)}</strong>
      <span>${connection.endpoints.map((endpoint) => escapeHtml(endpointLabel(project, endpoint))).join(" / ")}</span>
      <div class="circuit-item__meta">
        <span>${connection.endpoints.length} terminals</span>
        <button type="button" data-remove-connection="${escapeHtml(connection.id)}">Remove</button>
      </div>
    </article>
  `).join("");
}

function renderControlPanel(component, definition) {
  if (!controlPanelEl) return;
  const controls = componentControlSummary(component, definition);
  if (!component || !definition || !controls.length) {
    controlPanelEl.innerHTML = "";
    controlPanelEl.hidden = true;
    return;
  }
  controlPanelEl.hidden = false;
  controlPanelEl.innerHTML = `
    <div class="circuit-details circuit-control-panel__inner">
      <strong>Controls</strong>
      ${controls.map((control) => {
        const value = control.value;
        if (control.controlId === "power") {
          return `
            <label class="circuit-field" for="control-${escapeHtml(component.id)}-${escapeHtml(control.controlId)}">
              <span>Power (${escapeHtml(value)})</span>
              <select id="control-${escapeHtml(component.id)}-${escapeHtml(control.controlId)}" data-control-id="${escapeHtml(control.controlId)}">
                <option value="off" ${value === "off" ? "selected" : ""}>Off</option>
                <option value="on" ${value === "on" ? "selected" : ""}>On</option>
              </select>
            </label>
          `;
        }
        if (control.controlId === "throw") {
          return `
            <label class="circuit-field" for="control-${escapeHtml(component.id)}-${escapeHtml(control.controlId)}">
              <span>Throw (${escapeHtml(value.toUpperCase())})</span>
              <select id="control-${escapeHtml(component.id)}-${escapeHtml(control.controlId)}" data-control-id="${escapeHtml(control.controlId)}">
                <option value="a" ${value === "a" ? "selected" : ""}>A</option>
                <option value="b" ${value === "b" ? "selected" : ""}>B</option>
              </select>
            </label>
          `;
        }
        if (!control.persistent) {
          const active = isMomentaryControlActive(uiState.controls, component.id, control.controlId);
          return `
            <button class="circuit-momentary ${active ? "is-active" : ""}" type="button" data-momentary-control-id="${escapeHtml(control.controlId)}" aria-pressed="${active ? "true" : "false"}">
              ${active ? "Pressed" : "Press"} ${escapeHtml(control.controlId)}
            </button>
          `;
        }
        const isAngle = control.controlId === "previewAngleDeg";
        const min = isAngle ? 0 : 0;
        const max = isAngle ? 180 : 1;
        const step = isAngle ? 1 : 0.01;
        const label = isAngle ? `Preview angle (${Number(value).toFixed(0)} deg)` : `Wiper (${Math.round(Number(value) * 100)}%)`;
        return `
          <label class="circuit-field" for="control-${escapeHtml(component.id)}-${escapeHtml(control.controlId)}">
            <span>${escapeHtml(label)}</span>
            <input id="control-${escapeHtml(component.id)}-${escapeHtml(control.controlId)}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" data-control-id="${escapeHtml(control.controlId)}" />
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderInspector(project) {
  const component = selectedComponentInstance(project);
  const enabled = Boolean(component);
  for (const input of [componentNameInput, componentXInput, componentYInput, componentScaleInput, componentRotationInput]) input.disabled = !enabled;
  for (const input of [engineeringMinVInput, engineeringNominalVInput, engineeringMaxVInput, engineeringTypicalMaInput, engineeringPeakMaInput, engineeringStallMaInput]) {
    if (input) input.disabled = !enabled;
  }
  rotateReverseButton.disabled = !enabled;
  rotateClockwiseButton.disabled = !enabled;
  applyComponentButton.disabled = !enabled;
  removeComponentButton.disabled = !enabled;
  if (!component) {
    const connection = selectedConnection(project);
    selectedSummary.textContent = connection ? `Selected wire: ${connection.name}` : "No component selected.";
    componentNameInput.value = "";
    componentXInput.value = "";
    componentYInput.value = "";
    componentScaleInput.value = "";
    componentRotationInput.value = "";
    for (const input of [engineeringMinVInput, engineeringNominalVInput, engineeringMaxVInput, engineeringTypicalMaInput, engineeringPeakMaInput, engineeringStallMaInput]) {
      if (input) input.value = "";
    }
    renderControlPanel(null, null);
    return;
  }
  const definition = catalog.getComponent(component.typeId);
  const bounds = definition ? componentBounds(component, definition) : { width: 0, height: 0 };
  selectedSummary.textContent = `${component.name} / ${definition?.category ?? "Unknown"} / ${definition?.terminals?.length ?? 0} terminals / ${bounds.width.toFixed(0)} x ${bounds.height.toFixed(0)} mm / ${normalizeComponentRotation(component.rotation)}deg`;
  componentNameInput.value = component.name;
  componentXInput.value = Number(component.position[0]).toFixed(1);
  componentYInput.value = Number(component.position[1]).toFixed(1);
  componentScaleInput.value = String(Math.round(componentScale(component) * 100));
  componentRotationInput.value = String(normalizeComponentRotation(component.rotation));
  const overrides = component.props?.engineeringOverrides ?? {};
  if (engineeringMinVInput) engineeringMinVInput.value = overrides.minimumVoltageV ?? "";
  if (engineeringNominalVInput) engineeringNominalVInput.value = overrides.nominalVoltageV ?? "";
  if (engineeringMaxVInput) engineeringMaxVInput.value = overrides.maximumVoltageV ?? "";
  if (engineeringTypicalMaInput) engineeringTypicalMaInput.value = overrides.typicalCurrentMa ?? "";
  if (engineeringPeakMaInput) engineeringPeakMaInput.value = overrides.peakCurrentMa ?? "";
  if (engineeringStallMaInput) engineeringStallMaInput.value = overrides.stallCurrentMa ?? "";
  renderControlPanel(component, definition);
}

function renderTest() {
  const { summary, issues, ok } = uiState.test;
  testSummaryEl.textContent = ok ? formatCount(summary.warnings, "warning") : formatCount(summary.errors, "error");
  if (!issues.length) {
    testList.innerHTML = `<article class="test-item" data-severity="info"><strong class="test-item__title">Pass</strong><span class="test-item__message">No blocking robotics circuit issues found.</span></article>`;
    return;
  }
  testList.innerHTML = issues.map((item) => `
    <article class="test-item ${item.id === uiState.selectedIssueId ? "is-selected" : ""}" data-severity="${escapeHtml(item.severity)}" data-issue-id="${escapeHtml(item.id)}">
      <strong class="test-item__title">${escapeHtml(item.severity.toUpperCase())} / ${escapeHtml(item.code)}</strong>
      <span class="test-item__message">${escapeHtml(item.message)}</span>
      ${item.fix ? `<span class="test-item__fix">${escapeHtml(item.fix)}</span>` : ""}
    </article>
  `).join("");
}

function renderBringup() {
  bringupList.innerHTML = uiState.test.bringUpSteps
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join("");
}

function renderSource() {
  const files = uiState.source.files;
  sourceFileSelect.innerHTML = files
    .map((file) => `<option value="${escapeHtml(file.path)}" ${file.path === uiState.selectedSourcePath ? "selected" : ""}>${escapeHtml(file.path)}</option>`)
    .join("");
  const selected = files.find((file) => file.path === uiState.selectedSourcePath) ?? files[0];
  sourcePreview.textContent = selected?.content ?? "";
}

function renderWorkflowTabs() {
  for (const button of tabButtons) {
    button.classList.toggle("is-active", button.dataset.circuitTab === uiState.activeTab);
  }
  const visibleByTab = {
    inspect: new Set(["circuit-inspector-card", "circuit-wires-card"]),
    validate: new Set(["circuit-test-card", "circuit-bringup-card"]),
    bind: new Set(["circuit-binding-card", "circuit-test-card"]),
    build: new Set(["circuit-build-card", "circuit-source-card"])
  };
  const visible = visibleByTab[uiState.activeTab] ?? visibleByTab.inspect;
  for (const card of document.querySelectorAll(".circuit-panel--right [data-card-id]")) {
    card.hidden = !visible.has(card.dataset.cardId);
  }
}

function renderStatusList(container, rows) {
  if (!container) return;
  container.innerHTML = rows.map((row) => `
    <div class="circuit-status-row" data-status="${escapeHtml(row.status ?? "info")}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.value)}</strong>
    </div>
  `).join("");
}

function renderTable(container, rows, columns) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<p class="circuit-empty-note">No rows.</p>`;
    return;
  }
  container.innerHTML = `
    <table class="circuit-data-table">
      <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderBinding() {
  if (bindingJsonInput && document.activeElement !== bindingJsonInput) {
    bindingJsonInput.value = serializeMechatronicsBinding(uiState.binding);
  }
  const validation = uiState.artifacts.bindingValidation;
  const status = uiState.artifacts.readiness.binding.status;
  if (bindingSummaryEl) bindingSummaryEl.textContent = status;
  const rows = validation.diagnostics.length
    ? validation.diagnostics.map((item) => ({ label: item.code, value: item.message, status: item.severity }))
    : [{ label: "Binding", value: status === "absent" ? "No binding records saved." : "No blocking binding diagnostics.", status: status === "ready" ? "ready" : "info" }];
  renderStatusList(bindingStatusEl, rows);
}

function renderBuildArtifacts() {
  const readiness = uiState.artifacts.readiness;
  if (readinessSummaryEl) readinessSummaryEl.textContent = readiness.overallStatus;
  renderStatusList(readinessListEl, [
    { label: "Electrical DRC", value: readiness.electrical.status, status: readiness.electrical.status },
    { label: "Binding coverage", value: readiness.binding.status, status: readiness.binding.status },
    { label: "Firmware channel mapping", value: readiness.source.status, status: readiness.source.status },
    { label: "Build checklist", value: readiness.build.status, status: readiness.build.status },
    { label: "BOM completeness", value: `${uiState.artifacts.bomRows.length} catalog groups`, status: "info" },
    { label: "Harness completeness", value: `${uiState.artifacts.harnessRows.length} connections`, status: "info" }
  ]);
  renderTable(pinMapTableEl, uiState.artifacts.pinMapRows, ["binding type", "joint or sensor ID", "firmware channel ID", "semantic role", "signal type", "controller terminal ID", "device component ID", "device terminal ID", "capability status"]);
  renderTable(harnessTableEl, uiState.artifacts.harnessRows, ["connection ID", "net role", "endpoint count", "persisted display color", "recommended physical wire color", "recommended gauge", "physical junction required", "length"]);
  renderTable(bomTableEl, uiState.artifacts.bomRows, ["quantity", "catalog type ID", "generic description", "robotics role", "accepted/nominal voltage", "typical current mA", "peak current mA", "connector family", "review required"]);
  renderStatusList(checklistListEl, uiState.artifacts.checklist.steps.map((step) => ({
    label: `${step.order}. ${step.id}`,
    value: step.completed ? "Done" : step.label,
    status: step.completed ? "ready" : "info"
  })));
}

function renderHistoryButtons() {
  const status = historyStatus(history);
  undoButton.disabled = !status.canUndo;
  redoButton.disabled = !status.canRedo;
}

function renderModeButtons(project) {
  for (const button of modeButtons) {
    button.classList.toggle("is-active", button.dataset.circuitMode === project.mode);
  }
}

function renderWireStatus(project) {
  if (uiState.wireDrag) {
    const target = uiState.wireDrag.targetEndpoint ? endpointLabel(project, uiState.wireDrag.targetEndpoint) : "a terminal";
    wireStatus.textContent = `Wire drag: release on ${target}.`;
  } else if (uiState.pendingEndpoint) {
    wireStatus.textContent = `Wire start: ${endpointLabel(project, uiState.pendingEndpoint)}. Click a second terminal.`;
  } else if (project.mode === "wire") {
    wireStatus.textContent = "Wire mode: drag from one terminal to another, or click two terminals.";
  } else if (project.mode === "test") {
    wireStatus.textContent = uiState.test.ok ? "Circuit test is clear for source generation." : "Circuit test found blocking issues.";
  } else {
    wireStatus.textContent = "Select a component or switch to Wire mode.";
  }
}

function render() {
  const project = currentProject();
  renderProjectPanel(project);
  renderStarters();
  renderHardwareCatalog();
  renderComponents(project);
  renderWiresList(project);
  renderInspector(project);
  renderTest();
  renderBringup();
  renderSource();
  renderBinding();
  renderBuildArtifacts();
  renderWorkflowTabs();
  renderHistoryButtons();
  renderModeButtons(project);
  renderWireStatus(project);
  renderBench();
  const summary = projectSummary(project);
  statusEl.textContent = `${summary.name} / ${summary.componentCount} components / ${summary.connectionCount} wires`;
}

function renderControlSessionState() {
  const project = currentProject();
  refreshDerived();
  renderInspector(project);
  renderTest();
  renderBringup();
  renderBuildArtifacts();
  renderWireStatus(project);
  renderBench();
}

function pressMomentaryControlFromElement(controlEl) {
  const component = selectedComponentInstance();
  if (!controlEl || !component) return false;
  const changed = pressMomentaryControl(uiState.controls, component.id, controlEl.dataset.momentaryControlId);
  if (changed) renderControlSessionState();
  return changed;
}

function releaseMomentaryControlFromElement(controlEl) {
  const component = selectedComponentInstance();
  if (!controlEl || !component) return false;
  const changed = releaseMomentaryControl(uiState.controls, component.id, controlEl.dataset.momentaryControlId);
  if (changed) renderControlSessionState();
  return changed;
}

function releaseActiveMomentaryControlAndRender() {
  if (releaseActiveMomentaryControl(uiState.controls)) renderControlSessionState();
}

function releaseAllMomentaryControlsAndRender() {
  if (releaseAllMomentaryControls(uiState.controls)) renderControlSessionState();
}

function addHardware(typeId, options = {}) {
  const definition = catalog.getComponent(typeId);
  const requestedPosition = Array.isArray(options.position) && definition
    ? clampComponentPosition({ position: options.position, props: options.props ?? {} }, definition, options.position)
    : options.position;
  const next = addComponent(currentProject(), typeId, { ...options, position: requestedPosition });
  const componentId = next.selectedComponentId;
  const insertion = componentId ? insertComponentIntoNearestTerminals(next, componentId) : { project: next, insertedCount: 0 };
  const name = catalog.getComponent(typeId)?.name ?? typeId;
  return commitProject(insertion.project, insertion.insertedCount ? `${name} inserted` : `${name} added`);
}

function benchPointFromEvent(event) {
  const matrix = benchSvg.getScreenCTM();
  if (!matrix) return [0, 0];
  const point = benchSvg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return [
    Math.min(BENCH_WIDTH, Math.max(0, transformed.x)),
    Math.min(BENCH_HEIGHT, Math.max(0, transformed.y))
  ];
}

function isBenchPanBlockedTarget(target) {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest([
    "[data-component-id]",
    "[data-terminal-component]",
    "[data-connection-id]",
    "[data-fitting-connection-id]",
    "[data-resize-component-id]"
  ].join(",")));
}

function beginBenchPanInteraction(event) {
  if (uiState.view.zoom <= 1.001 || isBenchPanBlockedTarget(event.target)) return false;
  const bounds = benchSvg.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  benchPanInteraction = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startCenter: [...uiState.view.center],
    startViewBox: benchViewBoxFor(),
    svgWidth: bounds.width,
    svgHeight: bounds.height,
    moved: false
  };
  benchSvg.setPointerCapture(event.pointerId);
  renderBenchView();
  event.preventDefault();
  return true;
}

function updateBenchPanInteraction(event) {
  if (!benchPanInteraction || event.pointerId !== benchPanInteraction.pointerId) return;
  const dxClient = event.clientX - benchPanInteraction.startClientX;
  const dyClient = event.clientY - benchPanInteraction.startClientY;
  if (!benchPanInteraction.moved && Math.hypot(dxClient, dyClient) < 3) return;
  benchPanInteraction.moved = true;
  const [, , viewWidth, viewHeight] = benchPanInteraction.startViewBox;
  const dxWorld = dxClient * viewWidth / benchPanInteraction.svgWidth;
  const dyWorld = dyClient * viewHeight / benchPanInteraction.svgHeight;
  uiState.view.center = clampBenchViewCenter([
    benchPanInteraction.startCenter[0] - dxWorld,
    benchPanInteraction.startCenter[1] - dyWorld
  ], uiState.view.zoom);
  renderBenchView();
  event.preventDefault();
}

function finishBenchPanInteraction(event) {
  if (!benchPanInteraction || event.pointerId !== benchPanInteraction.pointerId) return;
  const moved = benchPanInteraction.moved;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  benchPanInteraction = null;
  suppressNextBenchClick = moved;
  renderBenchView();
  if (moved) event.preventDefault();
}

function cancelBenchPanInteraction(event) {
  if (!benchPanInteraction || event.pointerId !== benchPanInteraction.pointerId) return;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  benchPanInteraction = null;
  renderBenchView();
}

function endpointKeyValue(endpoint) {
  return endpoint ? `${endpoint.componentId}:${endpoint.terminalId}` : "";
}

function nearestTerminalEndpoint(project, point, options = {}) {
  let best = null;
  const excludeKey = endpointKeyValue(options.exclude);
  for (const component of project.components) {
    const definition = catalog.getComponent(component.typeId);
    if (!definition) continue;
    for (const terminal of definition.terminals) {
      const endpoint = { componentId: component.id, terminalId: terminal.id };
      if (excludeKey && endpointKeyValue(endpoint) === excludeKey) continue;
      const resolved = resolveTerminal(project, endpoint);
      if (!resolved.ok) continue;
      const distance = Math.hypot(point[0] - resolved.worldPosition[0], point[1] - resolved.worldPosition[1]);
      const threshold = definition.sim.role === "breadboard" ? 5.2 : 10;
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { endpoint: resolved.endpoint, distance };
      }
    }
  }
  return best?.endpoint ?? null;
}

function renderInteractionPreview(project) {
  replaceHistoryValue(history, normalizeProject(project));
  const normalized = currentProject();
  renderComponents(normalized);
  renderWiresList(normalized);
  renderInspector(normalized);
  renderWireStatus(normalized);
  renderBench();
  const summary = projectSummary(normalized);
  statusEl.textContent = `${summary.name} / ${summary.componentCount} components / ${summary.connectionCount} wires`;
}

function scheduleInteractionPreview(project) {
  pendingPreviewProject = project;
  if (previewAnimationFrame) return;
  previewAnimationFrame = window.requestAnimationFrame(() => {
    previewAnimationFrame = 0;
    if (!pendingPreviewProject) return;
    renderInteractionPreview(pendingPreviewProject);
    pendingPreviewProject = null;
  });
}

function selectedStartProject(project, componentId) {
  try {
    return selectComponent(project, componentId);
  } catch {
    return project;
  }
}

function beginComponentInteraction(event, componentId, kind) {
  const project = currentProject();
  const startProject = selectedStartProject(project, componentId);
  const component = startProject.components.find((item) => item.id === componentId);
  const definition = component ? catalog.getComponent(component.typeId) : null;
  if (!component || !definition) return;
  noteUserEdit();
  pointerInteraction = {
    pointerId: event.pointerId,
    kind,
    componentId,
    definition,
    component,
    startProject,
    startPoint: benchPointFromEvent(event),
    moved: false
  };
  uiState.pendingEndpoint = null;
  renderInteractionPreview(startProject);
  benchSvg.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateComponentInteraction(event) {
  if (!pointerInteraction || event.pointerId !== pointerInteraction.pointerId) return;
  const point = benchPointFromEvent(event);
  const dx = point[0] - pointerInteraction.startPoint[0];
  const dy = point[1] - pointerInteraction.startPoint[1];
  if (!pointerInteraction.moved && Math.hypot(dx, dy) < 3) return;
  pointerInteraction.moved = true;
  const { component, definition, startProject } = pointerInteraction;
  let patch;
  if (pointerInteraction.kind === "resize") {
    const [baseWidth, baseHeight] = definition.dimensions;
    const scale = normalizeComponentScale(Math.max(
      Math.abs(point[0] - component.position[0]) / (baseWidth / 2),
      Math.abs(point[1] - component.position[1]) / (baseHeight / 2)
    ));
    patch = {
      position: clampComponentPosition(component, definition, component.position, scale),
      props: { ...component.props, scale }
    };
  } else {
    const scale = componentScale(component);
    patch = {
      position: clampComponentPosition(component, definition, [
        component.position[0] + dx,
        component.position[1] + dy
      ], scale)
    };
  }
  scheduleInteractionPreview(updateComponent(startProject, component.id, patch));
}

function finishComponentInteraction(event) {
  if (!pointerInteraction || event.pointerId !== pointerInteraction.pointerId) return;
  if (previewAnimationFrame) {
    window.cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = 0;
  }
  if (pendingPreviewProject) {
    renderInteractionPreview(pendingPreviewProject);
    pendingPreviewProject = null;
  }
  const moved = pointerInteraction.moved;
  const finalProject = currentProject();
  const startProject = pointerInteraction.startProject;
  const componentId = pointerInteraction.componentId;
  const interactionKind = pointerInteraction.kind;
  const message = pointerInteraction.kind === "resize" ? "Component resized" : "Component moved";
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  pointerInteraction = null;
  suppressNextBenchClick = moved;
  if (!moved) return;
  const insertion = interactionKind === "move"
    ? (() => {
        const rematch = rematchDirectInsertionConnections(finalProject, componentId);
        return rematch.hadDirectInsertion ? rematch : insertComponentIntoNearestTerminals(finalProject, componentId);
      })()
    : rematchDirectInsertionConnections(finalProject, componentId);
  if (interactionKind === "resize" && insertion.hadDirectInsertion && !insertion.rematched) {
    commitHistoryFrom(history, startProject, startProject);
    refreshDerived();
    render();
    showStatus("Resize blocked: directly inserted components must stay aligned to every inserted terminal. Detach it first.", 6200);
    return;
  }
  commitHistoryFrom(history, startProject, insertion.project);
  refreshDerived();
  render();
  showStatus(insertion.detachedCount
    ? `Component detached from ${insertion.detachedCount} direct insertion${insertion.detachedCount === 1 ? "" : "s"}`
    : insertion.insertedCount
    ? `Component inserted into ${insertion.insertedCount} terminal${insertion.insertedCount === 1 ? "" : "s"}`
    : message);
}

function cancelComponentInteraction(event) {
  if (!pointerInteraction || event.pointerId !== pointerInteraction.pointerId) return;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  const startProject = pointerInteraction.startProject;
  pointerInteraction = null;
  pendingPreviewProject = null;
  if (previewAnimationFrame) {
    window.cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = 0;
  }
  renderInteractionPreview(startProject);
}

function beginWireInteraction(event, componentId, terminalId) {
  const project = currentProject();
  const endpoint = { componentId, terminalId };
  const resolved = resolveTerminal(project, endpoint);
  if (!resolved.ok) return;
  wireInteraction = {
    pointerId: event.pointerId,
    startEndpoint: resolved.endpoint,
    startPoint: benchPointFromEvent(event),
    currentPoint: resolved.worldPosition,
    targetEndpoint: null,
    moved: false
  };
  benchSvg.setPointerCapture(event.pointerId);
}

function updateWireInteraction(event) {
  if (!wireInteraction || event.pointerId !== wireInteraction.pointerId) return;
  const project = currentProject();
  const point = benchPointFromEvent(event);
  const dx = point[0] - wireInteraction.startPoint[0];
  const dy = point[1] - wireInteraction.startPoint[1];
  if (!wireInteraction.moved && Math.hypot(dx, dy) < 3) return;
  wireInteraction.moved = true;
  const targetEndpoint = nearestTerminalEndpoint(project, point, { exclude: wireInteraction.startEndpoint });
  wireInteraction.currentPoint = point;
  wireInteraction.targetEndpoint = targetEndpoint;
  uiState.pendingEndpoint = wireInteraction.startEndpoint;
  uiState.wireDrag = {
    startEndpoint: wireInteraction.startEndpoint,
    currentPoint: point,
    targetEndpoint
  };
  renderWireStatus(project);
  renderBench();
}

function finishWireInteraction(event) {
  if (!wireInteraction || event.pointerId !== wireInteraction.pointerId) return;
  const interaction = wireInteraction;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  wireInteraction = null;
  uiState.wireDrag = null;
  uiState.pendingEndpoint = null;
  if (!interaction.moved) {
    renderWireStatus(currentProject());
    return;
  }
  suppressNextBenchClick = true;
  if (!interaction.targetEndpoint) {
    render();
    showStatus("Wire was not connected: release on a real terminal or breadboard hole.", 5200);
    return;
  }
  const project = currentProject();
  commitProject(connectTerminals(project, interaction.startEndpoint, interaction.targetEndpoint, {
    name: `${endpointLabel(project, interaction.startEndpoint)} to ${endpointLabel(project, interaction.targetEndpoint)}`
  }), "Wire connected");
}

function cancelWireInteraction(event) {
  if (!wireInteraction || event.pointerId !== wireInteraction.pointerId) return;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  wireInteraction = null;
  uiState.wireDrag = null;
  uiState.pendingEndpoint = null;
  render();
}

function handleTerminalClick(componentId, terminalId) {
  const project = currentProject();
  const endpoint = { componentId, terminalId };
  if (project.mode !== "wire") {
    commitSelection(selectComponent(project, componentId));
    wireStatus.textContent = endpointLabel(project, endpoint);
    return;
  }
  if (!uiState.pendingEndpoint) {
    uiState.pendingEndpoint = endpoint;
    renderWireStatus(project);
    renderBench();
    showStatus(`Selected ${endpointLabel(project, endpoint)} as wire start`);
    return;
  }
  if (uiState.pendingEndpoint.componentId === componentId && uiState.pendingEndpoint.terminalId === terminalId) {
    uiState.pendingEndpoint = null;
    renderWireStatus(project);
    renderBench();
    showStatus("Wire start cleared");
    return;
  }
  const first = uiState.pendingEndpoint;
  uiState.pendingEndpoint = null;
  commitProject(connectTerminals(project, first, endpoint, {
    name: `${endpointLabel(project, first)} to ${endpointLabel(project, endpoint)}`
  }), "Wire connected");
}

function numericInputOverride(input) {
  if (!input || input.value.trim() === "") return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function inspectorEngineeringOverrides() {
  const entries = [
    ["minimumVoltageV", numericInputOverride(engineeringMinVInput)],
    ["nominalVoltageV", numericInputOverride(engineeringNominalVInput)],
    ["maximumVoltageV", numericInputOverride(engineeringMaxVInput)],
    ["typicalCurrentMa", numericInputOverride(engineeringTypicalMaInput)],
    ["peakCurrentMa", numericInputOverride(engineeringPeakMaInput)],
    ["stallCurrentMa", numericInputOverride(engineeringStallMaInput)]
  ].filter(([, value]) => value !== null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function updateComponentWithInsertionGuard(project, componentId, patch) {
  const transformed = updateComponent(project, componentId, patch);
  const rematch = rematchDirectInsertionConnections(transformed, componentId);
  if (rematch.hadDirectInsertion && !rematch.rematched) {
    throw new Error("Directly inserted components must stay aligned to a complete compatible hole pattern. Detach it before changing scale or rotation.");
  }
  return rematch.hadDirectInsertion ? rematch.project : transformed;
}

function applyInspectorEdit() {
  const component = selectedComponentInstance();
  if (!component) return;
  const x = Number(componentXInput.value);
  const y = Number(componentYInput.value);
  const scale = normalizeComponentScale(Number(componentScaleInput.value) / 100);
  const rotation = normalizeComponentRotation(componentRotationInput.value);
  const definition = catalog.getComponent(component.typeId);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Component coordinates must be finite numbers.");
  if (!definition) throw new Error(`Unknown component type: ${component.typeId}`);
  const engineeringOverrides = inspectorEngineeringOverrides();
  const nextProject = updateComponentWithInsertionGuard(currentProject(), component.id, {
    name: componentNameInput.value.trim() || component.name,
    position: clampComponentPosition(component, definition, [x, y], scale, rotation),
    rotation,
    props: {
      ...component.props,
      scale,
      ...(engineeringOverrides ? { engineeringOverrides } : { engineeringOverrides: undefined })
    }
  });
  commitProject(nextProject, `${component.name} updated`);
}

function rotateSelectedComponent(deltaDegrees) {
  const component = selectedComponentInstance();
  if (!component) return;
  const definition = catalog.getComponent(component.typeId);
  if (!definition) throw new Error(`Unknown component type: ${component.typeId}`);
  const rotation = normalizeComponentRotation(component.rotation + deltaDegrees);
  const nextProject = updateComponentWithInsertionGuard(currentProject(), component.id, {
    rotation,
    position: clampComponentPosition(component, definition, component.position, componentScale(component), rotation)
  });
  commitProject(nextProject, `${component.name} rotated`);
}

async function saveProject() {
  const project = normalizeProject(currentProject());
  const binding = normalizeMechatronicsBinding(uiState.binding);
  resetHistory(history, project);
  await workspaceStore.writeCurrentCircuitLabProject(project);
  await workspaceStore.writeCurrentMechatronicsBinding(binding);
  render();
  showStatus("Circuit Lab project and binding saved to browser storage");
  return project;
}

async function readSavedProject() {
  const [project, binding, robotDesign] = await Promise.all([
    workspaceStore.readCurrentCircuitLabProject(),
    workspaceStore.readCurrentMechatronicsBinding(),
    workspaceStore.readCurrentRobotDesign()
  ]);
  return {
    project: project ? normalizeProject(project) : null,
    binding: binding ? normalizeMechatronicsBinding(binding) : null,
    robotDesign: robotDesign ?? null
  };
}

async function hydrateSavedProject() {
  let saved;
  try {
    await loadCustomCircuitLibrary();
    saved = await readSavedProject();
  } finally {
    storageHydrationFinished = true;
  }
  uiState.robotDesign = saved?.robotDesign ?? null;
  if (saved?.binding) uiState.binding = saved.binding;
  if (saved?.project && !userEditedBeforeStorageHydration) {
    resetProject(saved.project, "Saved Circuit Lab project loaded", { userEdit: false, preserveBinding: true });
  } else if (saved?.project && userEditedBeforeStorageHydration) {
    showStatus("Saved Circuit Lab project found; current edits were kept", 5200);
  } else {
    showStatus("Starter Circuit Lab project loaded");
  }
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

async function importProjectFile(file) {
  const text = await file.text();
  resetProject(parseCircuitLabProjectJson(text), "Circuit Lab project imported");
}

async function loadCustomCircuitLibrary() {
  const definitions = await workspaceStore.listCircuitCustomComponents();
  clearCustomCircuitComponents();
  registerCustomCircuitComponents(definitions);
  uiState.customComponents = definitions;
  return definitions;
}

function promptPhysicalSize(svgText) {
  const viewBox = parseSvgViewBox(svgText);
  const widthText = window.prompt("Physical width in millimeters for this custom component.", Number(viewBox.width).toFixed(2));
  if (widthText === null) throw new Error("Fritzing import canceled.");
  const heightText = window.prompt("Physical height in millimeters for this custom component.", Number(viewBox.height).toFixed(2));
  if (heightText === null) throw new Error("Fritzing import canceled.");
  const width = String(widthText).trim() ? Number(widthText) : viewBox.width;
  const height = String(heightText).trim() ? Number(heightText) : viewBox.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Custom component physical width and height must be positive millimeter values.");
  }
  return { width, height };
}

async function importFritzingCustomComponentFiles(fzpFile, svgFile) {
  if (!fzpFile || !svgFile) throw new Error("Select both a Fritzing .fzp file and its breadboard SVG.");
  const accepted = window.confirm([
    "Import this Fritzing-derived visual for local use only?",
    "",
    "Fritzing part graphics are treated as share-alike licensed assets. RoboStudio will save the sanitized visual only in this browser's local custom component library and will not include it in production assets or project packages."
  ].join("\n"));
  if (!accepted) throw new Error("Fritzing import canceled before license acceptance.");
  const [fzpText, svgText] = await Promise.all([fzpFile.text(), svgFile.text()]);
  const { width, height } = promptPhysicalSize(svgText);
  const definition = buildFritzingCustomComponentDefinition({
    fzpText,
    svgText,
    fzpFileName: fzpFile.name,
    svgFileName: svgFile.name,
    physicalWidthMm: width,
    physicalHeightMm: height,
    licenseAccepted: true,
    now: new Date().toISOString()
  });
  await workspaceStore.writeCircuitCustomComponent(definition);
  await loadCustomCircuitLibrary();
  refreshDerived();
  render();
  showStatus(`${definition.name} imported into the local custom library`);
  return definition;
}

async function deleteCustomComponentDefinition(typeId) {
  const definition = catalog.getComponent(typeId);
  if (!definition?.custom?.localOnly || definition.custom.missing) return;
  if (!window.confirm(`Delete ${definition.name} from the local custom component library? Existing project instances will remain as missing custom components.`)) return;
  await workspaceStore.deleteCircuitCustomComponent(typeId);
  await loadCustomCircuitLibrary();
  refreshDerived();
  render();
  showStatus(`${definition.name} removed from the local custom library`);
}

async function editCustomComponentDefinition(typeId) {
  const existing = uiState.customComponents.find((definition) => definition.id === typeId);
  if (!existing) throw new Error("Custom component metadata is not loaded.");
  const name = window.prompt("Custom component display name.", existing.name);
  if (name === null) return;
  const category = window.prompt("Custom component category.", existing.category);
  if (category === null) return;
  const updated = {
    ...existing,
    name: name.trim() || existing.name,
    category: category.trim() || existing.category,
    updatedAt: new Date().toISOString()
  };
  await workspaceStore.writeCircuitCustomComponent(updated);
  await loadCustomCircuitLibrary();
  refreshDerived();
  render();
  showStatus(`${updated.name} metadata updated`);
}

function exportProjectJson() {
  downloadBlob(serializeCircuitLabProject(currentProject()), "robostudio-circuit-lab.json", "application/json;charset=utf-8");
  showStatus("Circuit Lab JSON export started");
}

async function exportBuildGuideZip() {
  const bytes = await createCircuitBuildGuideZip(uiState.artifacts);
  downloadBlob(bytes, "robostudio-build-guide.zip", "application/zip");
  showStatus("Build guide export started");
}

function downloadSelectedSource() {
  const file = uiState.source.files.find((item) => item.path === uiState.selectedSourcePath) ?? uiState.source.files[0];
  if (!file) return;
  downloadBlob(file.content, file.path.split("/").pop() || "circuit-lab-source.txt", "text/plain;charset=utf-8");
  showStatus(`${file.path} download started`);
}

function suggestSafeTerminal(role = "output") {
  const project = currentProject();
  const controller = projectController(project);
  if (!controller) return null;
  const used = terminalsInUse(project);
  return controller.definition.terminals
    .filter((terminal) => terminal.kind === TERMINAL_KINDS.SIGNAL)
    .filter((terminal) => !used.has(`${controller.instance.id}:${terminal.id}`))
    .filter((terminal) => !terminal.reserved)
    .filter((terminal) => role !== "output" || (!terminal.inputOnly && terminal.capabilities.includes("output")))
    .filter((terminal) => role !== "input" || terminal.capabilities.includes("input"))
    .sort((left, right) => {
      if (left.strapping !== right.strapping) return left.strapping ? 1 : -1;
      return left.id.localeCompare(right.id, undefined, { numeric: true });
    })[0] ?? null;
}

function controlsForComponent(component) {
  const definition = catalog.getComponent(component?.typeId);
  return {
    componentId: component?.id ?? null,
    componentName: component?.name ?? "",
    componentTypeId: component?.typeId ?? "",
    controls: componentControlSummary(component, definition)
  };
}

function focusTerminal(endpoint) {
  const resolved = resolveTerminal(currentProject(), endpoint);
  if (!resolved.ok) throw new Error(resolved.error);
  renderBench();
  const selector = `[data-terminal-component="${CSS.escape(resolved.endpoint.componentId)}"][data-terminal-id="${CSS.escape(resolved.endpoint.terminalId)}"]`;
  const element = benchSvg.querySelector(selector);
  element?.focus();
  wireStatus.textContent = endpointLabel(currentProject(), resolved.endpoint);
  return resolved;
}

function circuitAssistantContext() {
  const project = currentProject();
  return {
    ready: true,
    page: "Circuit Lab",
    summary: projectSummary(project),
    mode: project.mode,
    controller: projectController(project)?.instance ?? null,
    selectedComponent: selectedComponentInstance(project),
    selectedConnection: selectedConnection(project),
    components: project.components.map((component) => ({
      id: component.id,
      typeId: component.typeId,
      name: component.name,
      position: component.position,
      rotation: normalizeComponentRotation(component.rotation),
      scale: componentScale(component),
      role: catalog.getComponent(component.typeId)?.sim.role ?? null,
      controls: controlsForComponent(component).controls.filter((control) => control.persistent)
    })),
    connections: project.connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      endpoints: connection.endpoints.map((endpoint) => ({ ...endpoint, label: endpointLabel(project, endpoint) }))
    })),
    test: uiState.test,
    readiness: {
      robotDesignPresent: Boolean(uiState.robotDesign),
      overallStatus: uiState.artifacts.readiness.overallStatus,
      electricalStatus: uiState.artifacts.readiness.electrical.status,
      bindingStatus: uiState.artifacts.readiness.binding.status,
      sourceStatus: uiState.artifacts.readiness.source.status,
      buildStatus: uiState.artifacts.readiness.build.status,
      semanticRunAllowed: uiState.artifacts.readiness.semanticRunAllowed,
      sourceMappingAllowed: uiState.artifacts.readiness.sourceMappingAllowed
    },
    binding: {
      actuatorBindings: uiState.binding.actuatorBindings.length,
      sensorBindings: uiState.binding.sensorBindings.length,
      firmwareChannels: uiState.binding.firmwareChannels.length,
      diagnostics: uiState.artifacts.bindingValidation.diagnostics.map((item) => ({
        severity: item.severity,
        code: item.code,
        message: item.message
      }))
    },
    artifacts: {
      pinMapRows: uiState.artifacts.pinMapRows.length,
      harnessRows: uiState.artifacts.harnessRows.length,
      bomRows: uiState.artifacts.bomRows.length,
      checklistSteps: uiState.artifacts.checklist.steps.length
    },
    source: {
      ready: uiState.source.ready,
      target: uiState.source.target,
      files: uiState.source.files.map((file) => file.path)
    }
  };
}

function mountCircuitAssistant() {
  const assistant = mountPageAssistant({
    pageId: "circuits",
    title: "Circuit Lab",
    getContext: circuitAssistantContext,
    actions: {
      circuits_new_project: () => {
        resetProject(createCircuitLabProject(), "New Circuit Lab project");
        return "New Circuit Lab project started.";
      },
      circuits_save_project: async () => {
        await saveProject();
        return "Circuit Lab project saved.";
      },
      circuits_open_project_picker: () => {
        fileInput.click();
        return "Circuit Lab JSON file picker opened.";
      },
      circuits_export_project_json: () => {
        exportProjectJson();
        return "Circuit Lab JSON export started.";
      },
      circuits_apply_starter_template: ({ templateId }) => {
        resetProject(applyStarterTemplate(currentProject(), templateId), "Starter circuit loaded");
        return `${templateId} loaded.`;
      },
      circuits_add_hardware: ({ componentTypeId, name, position }) => {
        const next = addHardware(componentTypeId, { name, position });
        return `${selectedComponentInstance(next)?.name ?? componentTypeId} added.`;
      },
      circuits_select_component: ({ componentId }) => {
        commitSelection(selectComponent(currentProject(), componentId));
        return `${componentId} selected.`;
      },
      circuits_move_component: ({ componentId, position }) => {
        const project = currentProject();
        const component = project.components.find((item) => item.id === componentId);
        const definition = component ? catalog.getComponent(component.typeId) : null;
        const nextPosition = definition ? clampComponentPosition(component, definition, position, componentScale(component)) : position;
        const insertion = insertComponentIntoNearestTerminals(updateComponent(project, componentId, { position: nextPosition }), componentId);
        commitProject(insertion.project, insertion.insertedCount ? `${componentId} inserted` : `${componentId} moved`);
        return insertion.insertedCount
          ? `${componentId} moved and inserted into ${insertion.insertedCount} terminal${insertion.insertedCount === 1 ? "" : "s"}.`
          : `${componentId} moved.`;
      },
      circuits_resize_component: ({ componentId, scale }) => {
        const project = currentProject();
        const component = project.components.find((item) => item.id === componentId);
        const definition = component ? catalog.getComponent(component.typeId) : null;
        if (!component || !definition) throw new Error(`Unknown component: ${componentId}`);
        const normalizedScale = normalizeComponentScale(scale);
        commitProject(updateComponent(project, componentId, {
          position: clampComponentPosition(component, definition, component.position, normalizedScale),
          props: { ...component.props, scale: normalizedScale }
        }), `${componentId} resized`);
        return `${componentId} resized to ${Math.round(normalizedScale * 100)}%.`;
      },
      circuits_rotate_component: ({ componentId, rotationDegrees }) => {
        const project = currentProject();
        const component = project.components.find((item) => item.id === componentId);
        const definition = component ? catalog.getComponent(component.typeId) : null;
        if (!component || !definition) throw new Error(`Unknown component: ${componentId}`);
        const rotation = normalizeComponentRotation(rotationDegrees);
        commitProject(updateComponent(project, componentId, {
          rotation,
          position: clampComponentPosition(component, definition, component.position, componentScale(component), rotation)
        }), `${componentId} rotated`);
        return `${componentId} rotated to ${rotation} degrees.`;
      },
      circuits_connect_terminals: ({ endpointA, endpointB, name }) => {
        commitProject(connectTerminals(currentProject(), endpointA, endpointB, { name }), "Wire connected");
        return "Wire connected.";
      },
      circuits_remove_component: ({ componentId }) => {
        commitProject(removeComponent(currentProject(), componentId), "Component removed");
        return `${componentId} removed.`;
      },
      circuits_remove_connection: ({ connectionId }) => {
        commitProject(removeConnection(currentProject(), connectionId), "Wire removed");
        return `${connectionId} removed.`;
      },
      circuits_run_test: () => {
        refreshDerived();
        render();
        return { ok: uiState.test.ok, message: "Circuit Lab test complete.", data: uiState.test };
      },
      circuits_get_readiness: () => {
        refreshDerived();
        return {
          ok: true,
          message: `Circuit Lab readiness is ${uiState.artifacts.readiness.overallStatus}.`,
          data: uiState.artifacts.readiness
        };
      },
      circuits_get_binding_status: () => {
        refreshDerived();
        return {
          ok: uiState.artifacts.bindingValidation.ok,
          message: `Binding status is ${uiState.artifacts.readiness.binding.status}.`,
          data: {
            status: uiState.artifacts.readiness.binding.status,
            coverage: uiState.artifacts.bindingValidation.coverage,
            diagnostics: uiState.artifacts.bindingValidation.diagnostics
          }
        };
      },
      circuits_preview_binding_suggestions: async () => {
        const robotDesign = await workspaceStore.readCurrentRobotDesign();
        uiState.robotDesign = robotDesign ?? null;
        refreshDerived();
        const suggestions = previewMechatronicsBindingSuggestions({
          robotDesign: uiState.robotDesign,
          circuitLabProject: currentProject(),
          mechatronicsBinding: uiState.binding
        });
        return {
          ok: suggestions.ok,
          message: suggestions.ok
            ? "Binding suggestions generated from saved RobotDesign and current Circuit Lab wiring."
            : `Binding suggestions unavailable: ${suggestions.reason}.`,
          data: suggestions
        };
      },
      circuits_get_pin_map: () => {
        refreshDerived();
        return { ok: true, message: `${uiState.artifacts.pinMapRows.length} pin-map row(s).`, data: uiState.artifacts.pinMapRows };
      },
      circuits_get_harness: () => {
        refreshDerived();
        return { ok: true, message: `${uiState.artifacts.harnessRows.length} harness row(s).`, data: uiState.artifacts.harnessRows };
      },
      circuits_get_bom: () => {
        refreshDerived();
        return { ok: true, message: `${uiState.artifacts.bomRows.length} BOM row(s).`, data: uiState.artifacts.bomRows };
      },
      circuits_get_build_checklist: () => {
        refreshDerived();
        return { ok: true, message: `${uiState.artifacts.checklist.steps.length} checklist step(s).`, data: uiState.artifacts.checklist };
      },
      circuits_get_component_controls: ({ componentId } = {}) => {
        const project = currentProject();
        const components = componentId
          ? project.components.filter((component) => component.id === componentId)
          : project.components.filter((component) => componentControlSummary(component, catalog.getComponent(component.typeId)).some((control) => control.persistent));
        if (componentId && !components.length) throw new Error(`Unknown component: ${componentId}`);
        const data = components.map(controlsForComponent);
        return {
          ok: true,
          message: `${data.length} controllable component${data.length === 1 ? "" : "s"}.`,
          data
        };
      },
      circuits_set_component_control: ({ componentId, controlId, value }) => {
        const next = setComponentControl(currentProject(), componentId, controlId, value);
        commitProject(next, `${componentId} ${controlId} updated`);
        return {
          ok: true,
          message: `${componentId}.${controlId} updated.`,
          data: controlsForComponent(currentProject().components.find((component) => component.id === componentId))
        };
      },
      circuits_focus_terminal: ({ endpoint }) => {
        const resolved = focusTerminal(endpoint);
        return {
          ok: true,
          message: `${resolved.label} focused.`,
          data: {
            endpoint: resolved.endpoint,
            connectorInterface: resolved.terminal.connectorInterface,
            electricalRole: resolved.terminal.electricalRole,
            voltageDomainId: resolved.terminal.voltageDomainId
          }
        };
      },
      circuits_set_actuator_binding: (args) => {
        const staged = setActuatorBindingSession(args);
        return {
          ok: !uiState.artifacts.bindingValidation.diagnostics.some((item) => item.severity === "error"),
          message: `${staged.id} staged in session. Use Save to persist it.`,
          data: {
            binding: staged,
            status: uiState.artifacts.readiness.binding.status,
            diagnostics: uiState.artifacts.bindingValidation.diagnostics
          }
        };
      },
      circuits_set_sensor_binding: (args) => {
        const staged = setSensorBindingSession(args);
        return {
          ok: !uiState.artifacts.bindingValidation.diagnostics.some((item) => item.severity === "error"),
          message: `${staged.id} staged in session. Use Save to persist it.`,
          data: {
            binding: staged,
            status: uiState.artifacts.readiness.binding.status,
            diagnostics: uiState.artifacts.bindingValidation.diagnostics
          }
        };
      },
      circuits_set_firmware_channel: (args) => {
        const staged = setFirmwareChannelSession(args);
        return {
          ok: !uiState.artifacts.bindingValidation.diagnostics.some((item) => item.severity === "error"),
          message: `${staged.id} staged in session. Use Save to persist it.`,
          data: {
            channel: staged,
            status: uiState.artifacts.readiness.binding.status,
            diagnostics: uiState.artifacts.bindingValidation.diagnostics
          }
        };
      },
      circuits_remove_binding: (args) => {
        const binding = removeBindingSession(args);
        return {
          ok: true,
          message: `${args.targetId} removed in session. Use Save to persist the removal.`,
          data: {
            binding,
            status: uiState.artifacts.readiness.binding.status,
            diagnostics: uiState.artifacts.bindingValidation.diagnostics
          }
        };
      },
      circuits_suggest_safe_terminal: ({ role }) => {
        const suggestion = suggestSafeTerminal(role);
        return suggestion ? `Suggested ${role} terminal: ${suggestion.id}.` : `No unused safe ${role} terminal is available.`;
      },
      circuits_generate_source: () => {
        refreshDerived();
        renderSource();
        return {
          ok: uiState.source.ready,
          message: uiState.source.ready
            ? "Circuit Lab source preview is ready."
            : "Circuit Lab source preview is blocked; review readiness and DRC diagnostics.",
          data: { ready: uiState.source.ready, target: uiState.source.target, files: uiState.source.files.map((file) => file.path) }
        };
      },
      circuits_export_build_guide: async () => {
        await exportBuildGuideZip();
        return "Circuit Lab build-guide ZIP download started.";
      }
    }
  });
  if (window.matchMedia("(max-width: 980px)").matches) {
    assistant.root.classList.add("is-collapsed");
    assistant.root.querySelector(".assistant-card__collapse")?.setAttribute("aria-expanded", "false");
  }
  return assistant;
}

function bindEvents() {
  mountShellCardToggles(document);
  newButton.addEventListener("click", () => {
    if (window.confirm("Start a new Circuit Lab project?")) resetProject(createCircuitLabProject(), "New Circuit Lab project");
  });
  saveButton.addEventListener("click", () => saveProject().catch((error) => showStatus(error.message, 5200)));
  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files ?? [];
    fileInput.value = "";
    if (!file) return;
    try {
      await importProjectFile(file);
    } catch (error) {
      showStatus(error.message ?? "Unable to import Circuit Lab JSON", 6200);
    }
  });
  fritzingFzpInput?.addEventListener("change", () => {
    const [file] = fritzingFzpInput.files ?? [];
    fritzingFzpInput.value = "";
    if (!file) return;
    pendingFritzingFzpFile = file;
    fritzingSvgInput?.click();
  });
  fritzingSvgInput?.addEventListener("change", async () => {
    const [file] = fritzingSvgInput.files ?? [];
    fritzingSvgInput.value = "";
    if (!file || !pendingFritzingFzpFile) return;
    const fzpFile = pendingFritzingFzpFile;
    pendingFritzingFzpFile = null;
    try {
      await importFritzingCustomComponentFiles(fzpFile, file);
    } catch (error) {
      showStatus(error.message ?? "Unable to import Fritzing part", 7200);
    }
  });
  undoButton.addEventListener("click", () => {
    noteUserEdit();
    undoHistory(history);
    uiState.pendingEndpoint = null;
    uiState.wireDrag = null;
    refreshDerived();
    render();
    showStatus("Undo complete");
  });
  redoButton.addEventListener("click", () => {
    noteUserEdit();
    redoHistory(history);
    uiState.pendingEndpoint = null;
    uiState.wireDrag = null;
    refreshDerived();
    render();
    showStatus("Redo complete");
  });
  exportJsonButton.addEventListener("click", exportProjectJson);
  downloadSourceButton.addEventListener("click", downloadSelectedSource);
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      uiState.activeTab = button.dataset.circuitTab;
      render();
    });
  }
  applyBindingButton?.addEventListener("click", () => {
    try {
      uiState.binding = parseMechatronicsBindingJson(bindingJsonInput.value);
      refreshDerived();
      render();
      showStatus("Mechatronics binding applied");
    } catch (error) {
      showStatus(error.message ?? "Unable to apply binding", 6200);
    }
  });
  saveBindingButton?.addEventListener("click", async () => {
    try {
      uiState.binding = parseMechatronicsBindingJson(bindingJsonInput.value);
      await workspaceStore.writeCurrentMechatronicsBinding(uiState.binding);
      refreshDerived();
      render();
      showStatus("Mechatronics binding saved");
    } catch (error) {
      showStatus(error.message ?? "Unable to save binding", 6200);
    }
  });
  exportBuildGuideButton?.addEventListener("click", async () => {
    try {
      await exportBuildGuideZip();
    } catch (error) {
      showStatus(error.message ?? "Unable to export build guide", 6200);
    }
  });
  projectNameInput.addEventListener("change", () => {
    commitProject({ ...currentProject(), name: projectNameInput.value.trim() || "Circuit Lab project" }, "Circuit Lab renamed");
  });
  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      commitProject(setProjectMode(currentProject(), button.dataset.circuitMode), `${button.dataset.circuitMode} mode`);
    });
  }
  starterList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-starter-template]");
    if (!button) return;
    if (window.confirm("Replace the current Circuit Lab bench with this starter circuit?")) {
      resetProject(applyStarterTemplate(currentProject(), button.dataset.starterTemplate), "Starter circuit loaded");
    }
  });
  hardwareList.addEventListener("click", (event) => {
    const importButton = event.target.closest("[data-import-fritzing]");
    if (importButton) {
      pendingFritzingFzpFile = null;
      fritzingFzpInput?.click();
      return;
    }
    const clearFiltersButton = event.target.closest("[data-clear-hardware-filters]");
    if (clearFiltersButton) {
      uiState.hardwareFilters.query = "";
      uiState.hardwareFilters.category = "all";
      renderHardwareCatalog();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-custom-component]");
    if (deleteButton) {
      deleteCustomComponentDefinition(deleteButton.dataset.deleteCustomComponent)
        .catch((error) => showStatus(error.message ?? "Unable to delete custom component", 6200));
      return;
    }
    const editButton = event.target.closest("[data-edit-custom-component]");
    if (editButton) {
      editCustomComponentDefinition(editButton.dataset.editCustomComponent)
        .catch((error) => showStatus(error.message ?? "Unable to edit custom component", 6200));
      return;
    }
    const button = event.target.closest("[data-add-hardware]");
    if (!button) return;
    addHardware(button.dataset.addHardware);
  });
  hardwareList.addEventListener("input", (event) => {
    const search = event.target.closest("[data-hardware-search]");
    if (!search) return;
    uiState.hardwareFilters.query = search.value;
  });
  hardwareList.addEventListener("change", (event) => {
    const search = event.target.closest("[data-hardware-search]");
    if (search) {
      uiState.hardwareFilters.query = search.value;
      renderHardwareCatalog();
      return;
    }
    const category = event.target.closest("[data-hardware-category]");
    if (!category) return;
    uiState.hardwareFilters.category = category.value;
    renderHardwareCatalog();
  });
  hardwareList.addEventListener("keydown", (event) => {
    const search = event.target.closest("[data-hardware-search]");
    if (!search || event.key !== "Enter") return;
    uiState.hardwareFilters.query = search.value;
    renderHardwareCatalog();
  });
  hardwareList.addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-hardware-item]");
    if (!item || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-robostudio-circuit-component", item.dataset.hardwareItem);
    event.dataTransfer.setData("text/plain", item.dataset.hardwareItem);
  });
  componentList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-component-id]");
    if (!item) return;
    commitSelection(selectComponent(currentProject(), item.dataset.componentId));
  });
  wireList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-connection]");
    if (removeButton) {
      commitProject(removeConnection(currentProject(), removeButton.dataset.removeConnection), "Wire removed");
      return;
    }
    const item = event.target.closest("[data-connection-id]");
    if (!item) return;
    commitSelection(selectConnection(currentProject(), item.dataset.connectionId));
  });
  testList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-issue-id]");
    if (!item) return;
    uiState.selectedIssueId = uiState.selectedIssueId === item.dataset.issueId ? null : item.dataset.issueId;
    renderTest();
    renderBench();
  });
  benchSvg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const terminal = event.target.closest("[data-terminal-component]");
    if (terminal && currentProject().mode === "wire") {
      beginWireInteraction(event, terminal.dataset.terminalComponent, terminal.dataset.terminalId);
      return;
    }
    const resizeHandle = event.target.closest("[data-resize-component-id]");
    if (resizeHandle) {
      beginComponentInteraction(event, resizeHandle.dataset.resizeComponentId, "resize");
      return;
    }
    if (event.target.closest("[data-terminal-component]") || event.target.closest("[data-connection-id]")) return;
    const component = event.target.closest("[data-component-id]");
    const project = currentProject();
    if (component && (project.mode === "select" || project.mode === "place")) {
      beginComponentInteraction(event, component.dataset.componentId, "move");
      return;
    }
    beginBenchPanInteraction(event);
  });
  benchSvg.addEventListener("pointermove", (event) => {
    updateWireInteraction(event);
    updateComponentInteraction(event);
    updateBenchPanInteraction(event);
  });
  benchSvg.addEventListener("pointerup", (event) => {
    finishWireInteraction(event);
    finishComponentInteraction(event);
    finishBenchPanInteraction(event);
  });
  benchSvg.addEventListener("pointercancel", (event) => {
    cancelWireInteraction(event);
    cancelComponentInteraction(event);
    cancelBenchPanInteraction(event);
  });
  benchSvg.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  benchSvg.addEventListener("drop", (event) => {
    event.preventDefault();
    const typeId = event.dataTransfer?.getData("application/x-robostudio-circuit-component") || event.dataTransfer?.getData("text/plain");
    if (!typeId || !catalog.getComponent(typeId)) return;
    addHardware(typeId, { position: benchPointFromEvent(event) });
  });
  benchSvg.addEventListener("click", (event) => {
    if (suppressNextBenchClick) {
      suppressNextBenchClick = false;
      return;
    }
    const terminal = event.target.closest("[data-terminal-component]");
    if (terminal) {
      handleTerminalClick(terminal.dataset.terminalComponent, terminal.dataset.terminalId);
      return;
    }
    const connection = event.target.closest("[data-connection-id]");
    if (connection) {
      commitSelection(selectConnection(currentProject(), connection.dataset.connectionId));
      return;
    }
    const component = event.target.closest("[data-component-id]");
    if (component) commitSelection(selectComponent(currentProject(), component.dataset.componentId));
  });
  benchSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const anchorPoint = benchPointFromEvent(event);
    const direction = event.deltaY < 0 ? BENCH_ZOOM_STEP : 1 / BENCH_ZOOM_STEP;
    setBenchZoom(uiState.view.zoom * direction, { anchorPoint });
  }, { passive: false });
  zoomOutButton.addEventListener("click", () => setBenchZoom(uiState.view.zoom / BENCH_ZOOM_STEP));
  zoomInButton.addEventListener("click", () => setBenchZoom(uiState.view.zoom * BENCH_ZOOM_STEP));
  zoomResetButton.addEventListener("click", resetBenchZoom);
  applyComponentButton.addEventListener("click", () => {
    try {
      applyInspectorEdit();
    } catch (error) {
      showStatus(error.message ?? "Unable to update component", 5200);
    }
  });
  controlPanelEl?.addEventListener("change", (event) => {
    const control = event.target.closest("[data-control-id]");
    const component = selectedComponentInstance();
    if (!control || !component) return;
    try {
      commitProject(setComponentControl(currentProject(), component.id, control.dataset.controlId, control.value), `${component.name} control updated`);
    } catch (error) {
      showStatus(error.message ?? "Unable to update control", 5200);
    }
  });
  controlPanelEl?.addEventListener("pointerdown", (event) => {
    const control = event.target.closest("[data-momentary-control-id]");
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    control.setPointerCapture?.(event.pointerId);
    pressMomentaryControlFromElement(control);
  });
  controlPanelEl?.addEventListener("pointerup", (event) => {
    const control = event.target.closest("[data-momentary-control-id]");
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    releaseMomentaryControlFromElement(control);
  });
  controlPanelEl?.addEventListener("pointercancel", releaseActiveMomentaryControlAndRender);
  controlPanelEl?.addEventListener("pointerleave", releaseActiveMomentaryControlAndRender);
  controlPanelEl?.addEventListener("keydown", (event) => {
    const control = event.target.closest("[data-momentary-control-id]");
    if (!control) {
      if (event.key === "Escape") releaseActiveMomentaryControlAndRender();
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      pressMomentaryControlFromElement(control);
    }
    if (event.key === "Escape") releaseActiveMomentaryControlAndRender();
  });
  controlPanelEl?.addEventListener("keyup", (event) => {
    const control = event.target.closest("[data-momentary-control-id]");
    if (!control) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      releaseMomentaryControlFromElement(control);
    }
  });
  window.addEventListener("pointerup", releaseActiveMomentaryControlAndRender);
  window.addEventListener("pointercancel", releaseActiveMomentaryControlAndRender);
  window.addEventListener("blur", releaseAllMomentaryControlsAndRender);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") releaseAllMomentaryControlsAndRender();
  });
  rotateReverseButton.addEventListener("click", () => {
    try {
      rotateSelectedComponent(-15);
    } catch (error) {
      showStatus(error.message ?? "Unable to rotate component", 5200);
    }
  });
  rotateClockwiseButton.addEventListener("click", () => {
    try {
      rotateSelectedComponent(15);
    } catch (error) {
      showStatus(error.message ?? "Unable to rotate component", 5200);
    }
  });
  removeComponentButton.addEventListener("click", () => {
    const component = selectedComponentInstance();
    if (!component || !window.confirm(`Remove ${component.name}?`)) return;
    commitProject(removeComponent(currentProject(), component.id), "Component removed");
  });
  runTestButton.addEventListener("click", () => {
    refreshDerived();
    render();
    showStatus(uiState.test.ok ? "Circuit test passed" : "Circuit test found blocking issues");
  });
  sourceFileSelect.addEventListener("change", () => {
    uiState.selectedSourcePath = sourceFileSelect.value;
    renderSource();
  });
}

async function start() {
  bindEvents();
  refreshDerived();
  render();
  try {
    await Promise.race([
      hydrateSavedProject(),
      timeoutAfter(2500, "Workspace storage is still opening; starter Circuit Lab project stays active.")
    ]);
  } catch (error) {
    showStatus(error.message ?? "Starter Circuit Lab project is ready", 5200);
  }
  mountCircuitAssistant();
}

start().catch((error) => {
  console.error("Circuit Lab failed to start", error);
  resetProject(createCircuitLabProject(), "Circuit Lab loaded with starter project", { userEdit: false });
});
