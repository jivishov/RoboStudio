import "./physics.css";
import "./shellHeader.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { collectAssemblyParts, createRoboticArmAssembly } from "./createAssembly.js";
import { createAssetManifest, manifestSummary } from "./academic/assetManifest.js";
import {
  createExperimentRun,
  createFabricationReadiness,
  sampleWorkspace,
  serializeExperimentRunsCsv,
  simulatePidResponse
} from "./academic/experiments.js";
import {
  createDefaultLabSpec,
  createLabReportHtml,
  createLabReportJson,
  evaluateLabSpec,
  labProgress
} from "./academic/labs.js";
import {
  createRoboStudioProject,
  createRoboStudioProjectZip,
  projectBundlePreflight,
  serializeRoboStudioProject
} from "./academic/projectPackage.js";
import { deleteActuator, evaluateActuators, upsertActuator } from "./physics/actuators.js";
import { CATEGORY_ORDER, runDesignAudit } from "./physics/audit.js";
import { checkCollisionProxies, collisionPairKey } from "./physics/collision.js";
import { DEFAULT_ACTUATORS } from "./physics/constants.js";
import { DynamicsRunner } from "./physics/dynamics.js";
import { createUrdfExport, serializeRobotDesign } from "./physics/exporters.js";
import {
  analyzeTopology,
  computeForwardKinematics,
  findJointChainToLink,
  getEndEffectorPosition,
  getJointAngle,
  solveIKCCD
} from "./physics/kinematics.js";
import { baseStability, computeMassProperties, estimateJointLoads } from "./physics/mass.js";
import {
  applyLinkWorldTransforms,
  createMeshPoseBindings,
  snapshotsToLinkMatrices
} from "./physics/meshPose.js";
import {
  collectAssemblyPartRecords,
  createRobotDesign,
  finiteNumber,
  getLinkBounds,
  isSampleAssembly,
  normalizeRobotDesign,
  sanitizeId
} from "./physics/model.js";
import { WorkbenchOverlays } from "./physics/overlays.js";
import { saveRobotDesign, snapshotNewerThanDesign } from "./physics/persistence.js";
import { mountShellCardToggles } from "./shellCards.js";
import { commitHistory, createHistory, historyStatus, redoHistory, resetHistory, undoHistory } from "./history.js";
import { mountPageAssistant } from "./assistant/chatUi.js";
import { mountAssistantEvalPanel } from "./assistant/evalRunner.js";
import { isAssistantEvalEnabled } from "./assistant/evalScenarios.js";
import { evaluateMechatronicsReadiness } from "./mechatronics/readiness.js";
import { isAssemblyHandoffRequested } from "./studio/partsHandoff.js";
import { resolveFirmwareChannelCommand } from "./mechatronics/runtimeBridge.js";
import { createWorkspaceStore } from "./workspaceStore.js";

const viewport = document.querySelector("#physics-viewport");
const physicsStage = document.querySelector(".physics-stage");
const snapshotStatus = document.querySelector("#snapshot-status");
const assemblySource = document.querySelector("#assembly-source");
const assemblyName = document.querySelector("#assembly-name");
const frameAssemblyButton = document.querySelector("#frame-assembly");
const saveDesignButton = document.querySelector("#save-design");
const loadDesignButton = document.querySelector("#load-design");
const exportDesignButton = document.querySelector("#export-design");
const exportUrdfButton = document.querySelector("#export-urdf");
const designFileInput = document.querySelector("#design-file-input");
const undoDesignButton = document.querySelector("#undo-design");
const redoDesignButton = document.querySelector("#redo-design");
const modeButtons = document.querySelectorAll("[data-mode]");
const modeControls = document.querySelector("#mode-controls");
const robotTree = document.querySelector("#robot-tree");
const designSummary = document.querySelector("#design-summary");
const metricsGrid = document.querySelector("#metrics-grid");
const inspectorPanel = document.querySelector("#inspector-panel");
const analysisResults = document.querySelector("#analysis-results");
const auditList = document.querySelector("#audit-list");
const viewportReadout = document.querySelector("#viewport-readout");
const runAuditButton = document.querySelector("#run-audit");
const simResetButton = document.querySelector("#sim-reset");
const simStepButton = document.querySelector("#sim-step");
const simRunButton = document.querySelector("#sim-run");
const helpButton = document.querySelector("#physics-help");
const helpDialog = document.querySelector("#physics-help-dialog");
const helpCloseButton = document.querySelector("#physics-help-close");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f7f9fc");

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 8000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
viewport.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 80;
controls.maxDistance = 1600;

scene.add(new THREE.HemisphereLight("#ffffff", "#c8d1df", 1.6));
const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
keyLight.position.set(180, 420, 240);
keyLight.castShadow = true;
scene.add(keyLight);

const grid = new THREE.GridHelper(820, 32, "#b9c2ce", "#dce2eb");
grid.material.opacity = 0.48;
grid.material.transparent = true;
scene.add(grid);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(820, 820), new THREE.ShadowMaterial({ opacity: 0.14 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const stlLoader = new STLLoader();
const gltfLoader = new GLTFLoader();
const overlays = new WorkbenchOverlays(scene);
const dynamics = new DynamicsRunner();

function createEmptyAssembly() {
  const group = new THREE.Group();
  group.name = "manual_robot_workspace";
  group.userData = {
    sourceStlCount: 0,
    generatedFrom: null,
    assemblyType: "manual"
  };
  return group;
}

const DENSITY_PRESETS = [
  { id: "pla", label: "PLA plastic", densityKgM3: 1240 },
  { id: "petg", label: "PETG plastic", densityKgM3: 1270 },
  { id: "nylon", label: "Nylon", densityKgM3: 1150 },
  { id: "aluminum", label: "Aluminum", densityKgM3: 2700 },
  { id: "steel", label: "Steel", densityKgM3: 7850 }
];

const COLLAPSIBLE_CARD_DEFAULTS = Object.freeze({
  "model-edit-link": true,
  "model-create-link": false,
  "model-collision-proxy": false,
  "model-end-effector": false,
  "model-edit-joint": false,
  "analyze-ik-target": true,
  "analyze-topology": false,
  "analyze-joint-pose": true,
  "lab-brief": true,
  "lab-checkpoints": true,
  "lab-experiments": true,
  "lab-controls": false,
  "lab-package": false,
  "actuators-assignment": true,
  "actuators-margins": true,
  "actuators-library": false,
  "actuators-editor": false,
  "simulate-runner": true,
  "audit-readiness": true,
  "audit-mechatronics": true,
  "audit-semantic-channel": true,
  "analysis-mass": false,
  "analysis-collisions": false,
  "analysis-loads": false
});

const FLOATING_PANEL_DEFAULTS = Object.freeze({
  snapshot: { collapsed: false, x: null, y: null },
  readout: { collapsed: false, x: null, y: null }
});

const WORKBENCH_HISTORY_LIMIT = 60;
const WORKBENCH_HISTORY_COMMIT_DELAY_MS = 250;
const designHistory = createHistory(null, {
  limit: WORKBENCH_HISTORY_LIMIT,
  clone: cloneWorkbenchHistorySnapshot,
  equals: (left, right) => (left?.signature ?? null) === (right?.signature ?? null)
});
let designHistoryCommitTimer = null;

const state = {
  mode: "model",
  assemblyRoot: null,
  meshBindings: new Map(),
  currentSnapshot: null,
  currentCircuitDesign: null,
  currentCircuitLabProject: null,
  currentMechatronicsBinding: null,
  mechatronicsReadiness: null,
  partLibraryItems: [],
  partRecords: [],
  design: null,
  transforms: new Map(),
  selectedLinkId: null,
  selectedJointId: null,
  selectedProxyId: null,
  selectedEffectorId: null,
  selectedActuatorId: null,
  selectedDensityId: "pla",
  ikTarget: [120, 250, 0],
  ikResult: null,
  labSpec: createDefaultLabSpec(),
  labCheckpointResults: [],
  experimentRuns: [],
  pidResponse: null,
  analysis: null,
  semanticCommand: {
    channelId: "",
    value: 0,
    status: "idle",
    message: "No semantic channel command has been applied."
  },
  collapsibleCards: { ...COLLAPSIBLE_CARD_DEFAULTS },
  floatingPanels: {
    snapshot: { ...FLOATING_PANEL_DEFAULTS.snapshot },
    readout: { ...FLOATING_PANEL_DEFAULTS.readout }
  },
  floatingDrag: null,
  simTimer: null,
  simulation: {
    status: "not initialized",
    message: "Simulation has not been initialized.",
    gravityEnabled: true,
    motorsEnabled: false,
    timestep: 1 / 60,
    lastError: null
  }
};

function assetUrlForFile(fileName) {
  return `${import.meta.env.BASE_URL}${encodeURIComponent(fileName)}`;
}

function loadStlGeometry(fileName) {
  return new Promise((resolve, reject) => {
    stlLoader.load(assetUrlForFile(fileName), resolve, undefined, reject);
  });
}

function glbToObject(glb) {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(glb, "", (gltf) => resolve(gltf.scene), reject);
  });
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxSize) || maxSize <= 0) return;

  const distance = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.position.set(center.x + distance * 0.7, center.y + distance * 0.44, center.z + distance * 1.05);
  camera.near = Math.max(0.1, distance / 150);
  camera.far = distance * 10;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function triangleCount(object) {
  let total = 0;
  object?.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    total += Math.round((child.geometry.index?.count ?? child.geometry.attributes.position?.count ?? 0) / 3);
  });
  return total;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function formatVector(values, digits = 0) {
  return (values ?? [0, 0, 0]).map((value) => formatNumber(value, digits)).join(", ");
}

function jointLabel(jointId) {
  return state.design?.joints.find((joint) => joint.id === jointId)?.name ?? jointId;
}

function downloadText(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function showStatus(message) {
  snapshotStatus.textContent = message;
}

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function cloneWorkbenchHistorySnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    design: cloneJsonValue(snapshot.design),
    ikTarget: [...(snapshot.ikTarget ?? [])],
    ikResult: cloneJsonValue(snapshot.ikResult),
    labCheckpointResults: cloneJsonValue(snapshot.labCheckpointResults),
    experimentRuns: cloneJsonValue(snapshot.experimentRuns),
    pidResponse: cloneJsonValue(snapshot.pidResponse)
  };
}

function captureWorkbenchHistorySnapshot() {
  if (!state.design) return null;
  const snapshot = {
    design: cloneJsonValue(state.design),
    selectedLinkId: state.selectedLinkId,
    selectedJointId: state.selectedJointId,
    selectedProxyId: state.selectedProxyId,
    selectedEffectorId: state.selectedEffectorId,
    selectedActuatorId: state.selectedActuatorId,
    selectedDensityId: state.selectedDensityId,
    ikTarget: [...state.ikTarget],
    ikResult: cloneJsonValue(state.ikResult),
    labCheckpointResults: cloneJsonValue(state.labCheckpointResults),
    experimentRuns: cloneJsonValue(state.experimentRuns),
    pidResponse: cloneJsonValue(state.pidResponse)
  };
  snapshot.signature = JSON.stringify(snapshot);
  return snapshot;
}

function clearPendingDesignHistoryCommit() {
  if (!designHistoryCommitTimer) return false;
  window.clearTimeout(designHistoryCommitTimer);
  designHistoryCommitTimer = null;
  return true;
}

function updateDesignHistoryControls() {
  const status = historyStatus(designHistory);
  if (undoDesignButton) undoDesignButton.disabled = !status.canUndo && !designHistoryCommitTimer;
  if (redoDesignButton) redoDesignButton.disabled = !status.canRedo;
}

function commitDesignHistoryNow() {
  const snapshot = captureWorkbenchHistorySnapshot();
  if (!snapshot) return;
  commitHistory(designHistory, snapshot);
  updateDesignHistoryControls();
}

function scheduleDesignHistoryCommit() {
  if (!state.design) return;
  clearPendingDesignHistoryCommit();
  designHistoryCommitTimer = window.setTimeout(() => {
    designHistoryCommitTimer = null;
    commitDesignHistoryNow();
  }, WORKBENCH_HISTORY_COMMIT_DELAY_MS);
  updateDesignHistoryControls();
}

function flushDesignHistoryCommit() {
  if (!clearPendingDesignHistoryCommit()) return;
  commitDesignHistoryNow();
}

function resetDesignHistory() {
  clearPendingDesignHistoryCommit();
  resetHistory(designHistory, captureWorkbenchHistorySnapshot());
  updateDesignHistoryControls();
}

function restoreWorkbenchHistorySnapshot(snapshot, message) {
  if (!snapshot?.design) return;
  state.design = normalizeRobotDesign(snapshot.design, state.partRecords);
  state.selectedLinkId = snapshot.selectedLinkId;
  state.selectedJointId = snapshot.selectedJointId;
  state.selectedProxyId = snapshot.selectedProxyId;
  state.selectedEffectorId = snapshot.selectedEffectorId;
  state.selectedActuatorId = snapshot.selectedActuatorId;
  state.selectedDensityId = snapshot.selectedDensityId ?? state.selectedDensityId;
  state.ikTarget = roundedVector(snapshot.ikTarget ?? state.ikTarget);
  state.ikResult = cloneJsonValue(snapshot.ikResult);
  state.labCheckpointResults = cloneJsonValue(snapshot.labCheckpointResults) ?? [];
  state.experimentRuns = cloneJsonValue(snapshot.experimentRuns) ?? [];
  state.pidResponse = cloneJsonValue(snapshot.pidResponse);
  invalidateSimulation("RobotDesign history restored; initialize simulation when ready.");
  renderAll();
  updateDesignHistoryControls();
  showStatus(message);
}

function undoDesignHistory() {
  flushDesignHistoryCommit();
  if (!historyStatus(designHistory).canUndo) return;
  restoreWorkbenchHistorySnapshot(undoHistory(designHistory), "Undo");
}

function redoDesignHistory() {
  flushDesignHistoryCommit();
  if (!historyStatus(designHistory).canRedo) return;
  restoreWorkbenchHistorySnapshot(redoHistory(designHistory), "Redo");
}

function isCollapsibleCardOpen(id) {
  if (!(id in state.collapsibleCards)) {
    state.collapsibleCards[id] = COLLAPSIBLE_CARD_DEFAULTS[id] ?? true;
  }
  return state.collapsibleCards[id];
}

function collapsibleCard(id, title, body, options = {}) {
  const open = isCollapsibleCardOpen(id);
  const kind = options.kind ?? "form-card";
  const contentId = `collapsible-${id}`;
  const meta = options.meta ? `<span class="collapsible-card__meta">${escapeHtml(options.meta)}</span>` : "";
  return `
    <div class="${kind} collapsible-card ${open ? "" : "is-collapsed"}" data-card-id="${escapeHtml(id)}">
      <button class="collapsible-card__toggle" type="button" data-toggle-card="${escapeHtml(id)}" aria-expanded="${open}" aria-controls="${escapeHtml(contentId)}">
        <span class="collapsible-card__label">
          <span class="collapsible-card__title">${escapeHtml(title)}</span>
          ${meta}
        </span>
        <span class="collapsible-card__chevron" aria-hidden="true"></span>
        <span class="collapsible-card__dots" aria-hidden="true"></span>
      </button>
      <div class="collapsible-card__content" id="${escapeHtml(contentId)}">
        <div class="collapsible-card__inner">${body}</div>
      </div>
    </div>
  `;
}

function applyCollapsibleCardState(card, open) {
  card.classList.toggle("is-collapsed", !open);
  const toggle = card.querySelector(".collapsible-card__toggle");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
}

function toggleCollapsibleCard(cardId, card) {
  const nextOpen = !isCollapsibleCardOpen(cardId);
  state.collapsibleCards[cardId] = nextOpen;
  if (card) applyCollapsibleCardState(card, nextOpen);
}

function floatingPanelState(id) {
  if (!state.floatingPanels[id]) {
    state.floatingPanels[id] = { ...(FLOATING_PANEL_DEFAULTS[id] ?? { collapsed: false, x: null, y: null }) };
  }
  return state.floatingPanels[id];
}

function floatingPanelHeader(id, title, contentId) {
  const panelState = floatingPanelState(id);
  return `
    <div class="floating-panel__bar" data-floating-drag="${escapeHtml(id)}">
      <button class="floating-panel__toggle" type="button" data-toggle-floating-panel="${escapeHtml(id)}" aria-expanded="${!panelState.collapsed}" aria-controls="${escapeHtml(contentId)}">
        <span>${escapeHtml(title)}</span>
        <span class="floating-panel__chevron" aria-hidden="true"></span>
      </button>
      <span class="floating-panel__grip" aria-hidden="true"></span>
    </div>
  `;
}

function floatingPanelById(id) {
  return Array.from(physicsStage.querySelectorAll("[data-floating-panel]")).find((panel) => panel.dataset.floatingPanel === id) ?? null;
}

function pointerPositionInStage(event) {
  const stageRect = physicsStage.getBoundingClientRect();
  return {
    x: event.clientX - stageRect.left,
    y: event.clientY - stageRect.top
  };
}

function panelPositionWithinStage(panel, x, y) {
  const stageRect = physicsStage.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 8;
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, stageRect.width - panelRect.width - margin)),
    y: Math.min(Math.max(margin, y), Math.max(margin, stageRect.height - panelRect.height - margin))
  };
}

function setFloatingPanelPosition(panel, id, x, y) {
  const next = panelPositionWithinStage(panel, x, y);
  const panelState = floatingPanelState(id);
  panelState.x = next.x;
  panelState.y = next.y;
  panel.style.left = `${next.x}px`;
  panel.style.top = `${next.y}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function currentFloatingPanelPosition(panel) {
  const stageRect = physicsStage.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return {
    x: panelRect.left - stageRect.left,
    y: panelRect.top - stageRect.top
  };
}

function applyFloatingPanelState(id, panel = floatingPanelById(id)) {
  if (!panel) return;
  const panelState = floatingPanelState(id);
  panel.classList.toggle("is-collapsed", panelState.collapsed);
  panel.querySelector("[data-toggle-floating-panel]")?.setAttribute("aria-expanded", String(!panelState.collapsed));
  if (Number.isFinite(panelState.x) && Number.isFinite(panelState.y)) {
    setFloatingPanelPosition(panel, id, panelState.x, panelState.y);
  }
}

function toggleFloatingPanel(id, panel = floatingPanelById(id)) {
  const panelState = floatingPanelState(id);
  panelState.collapsed = !panelState.collapsed;
  applyFloatingPanelState(id, panel);
}

function startFloatingPanelDrag(event, handle) {
  if (event.button !== 0) return;
  if (event.target.closest("[data-toggle-floating-panel]")) return;
  const panel = handle.closest("[data-floating-panel]");
  const id = panel?.dataset.floatingPanel;
  if (!panel || !id) return;
  event.preventDefault();
  event.stopPropagation();
  const start = currentFloatingPanelPosition(panel);
  const pointer = pointerPositionInStage(event);
  state.floatingDrag = {
    id,
    panel,
    pointerId: event.pointerId,
    offsetX: pointer.x - start.x,
    offsetY: pointer.y - start.y
  };
  panel.classList.add("is-dragging");
  panel.setPointerCapture?.(event.pointerId);
  setFloatingPanelPosition(panel, id, start.x, start.y);
}

function moveFloatingPanel(event) {
  const drag = state.floatingDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const pointer = pointerPositionInStage(event);
  setFloatingPanelPosition(drag.panel, drag.id, pointer.x - drag.offsetX, pointer.y - drag.offsetY);
}

function stopFloatingPanelDrag(event) {
  const drag = state.floatingDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.panel.classList.remove("is-dragging");
  drag.panel.releasePointerCapture?.(event.pointerId);
  state.floatingDrag = null;
}

function applyFloatingPanelStates() {
  for (const panel of physicsStage.querySelectorAll("[data-floating-panel]")) {
    const id = panel.dataset.floatingPanel;
    if (id) applyFloatingPanelState(id, panel);
  }
}

function selectedLink() {
  return state.design?.links.find((link) => link.id === state.selectedLinkId) ?? state.design?.links[0] ?? null;
}

function selectedJoint() {
  return state.design?.joints.find((joint) => joint.id === state.selectedJointId) ?? state.design?.joints[0] ?? null;
}

function selectedEffector() {
  return state.design?.endEffectors.find((item) => item.id === state.selectedEffectorId) ?? state.design?.endEffectors[0] ?? null;
}

function selectedActuator() {
  return state.design?.actuators.find((item) => item.id === state.selectedActuatorId) ?? state.design?.actuators[0] ?? null;
}

function selectedProxy() {
  const link = selectedLink();
  if (!link) return null;
  return link.collisionProxies.find((proxy) => proxy.id === state.selectedProxyId) ?? link.collisionProxies[0] ?? null;
}

function syncSelectedDesignItems() {
  const link = selectedLink();
  state.selectedLinkId = link?.id ?? null;
  const joint = selectedJoint();
  state.selectedJointId = joint?.id ?? null;
  const proxy = link?.collisionProxies.find((item) => item.id === state.selectedProxyId) ?? link?.collisionProxies[0] ?? null;
  state.selectedProxyId = proxy?.id ?? null;
  const effector = selectedEffector();
  state.selectedEffectorId = effector?.id ?? null;
  const actuator = selectedActuator();
  state.selectedActuatorId = actuator?.id ?? null;
}

function uniqueDesignId(base, fallback, existingIds) {
  const clean = sanitizeId(base, fallback);
  let id = clean;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${clean}_${suffix}`;
    suffix += 1;
  }
  return id;
}

function updateDesignTimestamp() {
  state.design.updatedAt = new Date().toISOString();
  invalidateSimulation("RobotDesign changed; initialize simulation again.");
  scheduleDesignHistoryCommit();
}

function syncSimulationButtons() {
  const running = state.simulation.status === "running";
  const label = running ? "Pause" : "Run";
  const accessibleLabel = `${label} simulation`;
  const icon = simRunButton.querySelector("[data-sim-run-icon]");
  const text = simRunButton.querySelector("[data-sim-run-label]");
  if (icon) icon.textContent = running ? "pause_circle" : "play_circle";
  if (text) text.textContent = label;
  simRunButton.setAttribute("aria-label", accessibleLabel);
  simRunButton.title = accessibleLabel;
  simRunButton.dataset.tooltip = label;
  simRunButton.classList.toggle("is-active", running);
}

function stopSimulationTimer() {
  if (state.simTimer) {
    window.clearInterval(state.simTimer);
    state.simTimer = null;
  }
  syncSimulationButtons();
}

function setSimulationStatus(status, message = "") {
  state.simulation.status = status;
  state.simulation.message = message || status;
  state.simulation.lastError = status === "failed" ? message : null;
  syncSimulationButtons();
}

function invalidateSimulation(message = "Simulation has not been initialized.") {
  stopSimulationTimer();
  dynamics.clear();
  setSimulationStatus("not initialized", message);
}

function simulationDrivesPose() {
  return dynamics.status().ready && ["running", "paused", "stepped"].includes(state.simulation.status);
}

function applyFkPoseToMeshes() {
  applyLinkWorldTransforms(state.meshBindings, state.design, state.transforms);
}

function applySimulationPoseToMeshes(options = {}) {
  if (!dynamics.status().ready) return null;
  const matrices = snapshotsToLinkMatrices(dynamics.bodySnapshots());
  applyLinkWorldTransforms(state.meshBindings, state.design, matrices);
  if (options.updateOverlays) {
    const collisions = checkCollisionProxies(state.design, matrices);
    overlays.update(state.design, matrices, { collisions });
    overlays.setTarget(state.ikTarget);
  }
  return matrices;
}

function readSimulationOptions() {
  const gravityField = modeControls.querySelector("#sim-gravity");
  const motorsField = modeControls.querySelector("#sim-motors");
  const timestepField = modeControls.querySelector("#sim-timestep");
  if (gravityField instanceof HTMLSelectElement) {
    state.simulation.gravityEnabled = gravityField.value !== "off";
  }
  if (motorsField instanceof HTMLSelectElement) {
    state.simulation.motorsEnabled = motorsField.value === "hold";
  }
  if (timestepField instanceof HTMLInputElement) {
    state.simulation.timestep = Math.min(1 / 15, Math.max(1 / 240, finiteNumber(timestepField.value, state.simulation.timestep)));
  }
  return {
    gravityEnabled: state.simulation.gravityEnabled,
    motorsEnabled: state.simulation.motorsEnabled,
    timestep: state.simulation.timestep
  };
}

function roundedVector(values) {
  return values.map((value) => Number(finiteNumber(value, 0).toFixed(5)));
}

function densityPreset(id = state.selectedDensityId) {
  return DENSITY_PRESETS.find((preset) => preset.id === id) ?? DENSITY_PRESETS[0];
}

function estimateMassFromBounds(bounds, densityKgM3 = densityPreset().densityKgM3) {
  const size = bounds?.size ?? [40, 40, 40];
  const volumeM3 = Math.max(1, size[0] * size[1] * size[2]) * 1e-9;
  return Number(Math.min(40, Math.max(0.01, volumeM3 * densityKgM3)).toFixed(3));
}

function estimateInertiaFromBounds(massKg, bounds) {
  const [x, y, z] = (bounds?.size ?? [40, 40, 40]).map((value) => Math.max(0.001, finiteNumber(value, 40)) * 0.001);
  return [
    Number(((massKg * (y * y + z * z)) / 12).toFixed(6)),
    Number(((massKg * (x * x + z * z)) / 12).toFixed(6)),
    Number(((massKg * (x * x + y * y)) / 12).toFixed(6))
  ];
}

function proxyShapeFromBounds(linkId, bounds, type = "box", id = null, existingProxies = []) {
  const size = (bounds?.size ?? [40, 40, 40]).map((value) => Math.max(6, finiteNumber(value, 6)));
  const radius = Math.max(3, Math.max(size[0], size[2]) / 2);
  const length = Math.max(6, size[1]);
  return {
    id: id ?? uniqueDesignId(`${linkId}_${type}_proxy`, "proxy", new Set(existingProxies.map((proxy) => proxy.id))),
    type,
    origin: roundedVector(bounds?.center ?? [0, 0, 0]),
    dimensions: type === "box" ? roundedVector(size) : roundedVector([radius, type === "sphere" ? radius : length, radius]),
    enabled: true
  };
}

function designMatchesParts(design, partRecords) {
  if (!design?.links?.length || !partRecords.length) return false;
  const current = new Set(partRecords.map((part) => part.id));
  const referenced = new Set(design.links.flatMap((link) => link.partIds ?? []));
  let overlap = 0;
  for (const partId of referenced) {
    if (current.has(partId)) overlap += 1;
  }
  return overlap > 0 && overlap / Math.max(1, current.size) > 0.45;
}

function refreshMechatronicsReadiness() {
  state.mechatronicsReadiness = evaluateMechatronicsReadiness({
    robotDesign: state.design,
    circuitLabProject: state.currentCircuitLabProject,
    mechatronicsBinding: state.currentMechatronicsBinding
  });
  return state.mechatronicsReadiness;
}

function compactCircuitStatus() {
  if (!state.currentCircuitLabProject) return "Absent";
  const status = state.mechatronicsReadiness?.overallStatus;
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Partial";
}

function circuitControllerLabel() {
  const project = state.currentCircuitLabProject;
  if (!project?.controllerId) return "None";
  const controller = project.components?.find((component) => component.id === project.controllerId);
  return controller?.name ?? project.controllerId;
}

function analyzeDesign() {
  state.transforms = computeForwardKinematics(state.design);
  const topology = analyzeTopology(state.design);
  const payloadKg = finiteNumber(state.design.assumptions?.payloadKg, 0);
  const collisions = checkCollisionProxies(state.design, state.transforms);
  const mass = computeMassProperties(state.design, state.transforms, payloadKg);
  const loads = estimateJointLoads(state.design, state.transforms, state.design.assumptions);
  const actuatorResults = evaluateActuators(state.design, loads);
  const stability = baseStability(state.design, mass);
  const audit = runDesignAudit(state.design, {
    collisions,
    actuatorResults,
    stability,
    topology,
    ikResult: state.ikResult,
    partRecords: state.partRecords
  });
  const urdf = createUrdfExport(state.design, state.partRecords);
  state.analysis = { collisions, mass, loads, actuatorResults, stability, topology, audit, urdf };
  refreshMechatronicsReadiness();
  if (simulationDrivesPose()) {
    applySimulationPoseToMeshes({ updateOverlays: true });
  } else {
    applyFkPoseToMeshes();
    overlays.update(state.design, state.transforms, { collisions });
  }
  overlays.setTarget(state.ikTarget);
}

function currentAssetManifest() {
  return createAssetManifest({
    snapshot: state.currentSnapshot,
    robotDesign: state.design,
    partRecords: state.partRecords,
    partLibraryItems: state.partLibraryItems,
    generatedAt: new Date().toISOString()
  });
}

function currentLabContext() {
  return {
    design: state.design,
    analysis: state.analysis,
    ikResult: state.ikResult,
    experimentRuns: state.experimentRuns,
    manifest: currentAssetManifest()
  };
}

function refreshLabCheckpoints() {
  state.labCheckpointResults = evaluateLabSpec(state.labSpec, currentLabContext());
  return state.labCheckpointResults;
}

function currentCheckpointResults() {
  return state.labCheckpointResults.length ? state.labCheckpointResults : evaluateLabSpec(state.labSpec, currentLabContext());
}

function academicMetadataForResults(results) {
  return {
    labId: state.labSpec.id,
    checkpointResults: results.map((result) => ({
      id: result.id,
      passed: result.passed,
      evidence: result.evidence
    })),
    experimentRunIds: state.experimentRuns.map((run) => run.id)
  };
}

function designWithAcademicMetadata(results = currentCheckpointResults()) {
  if (!state.design) return null;
  return {
    ...state.design,
    academic: academicMetadataForResults(results),
    controllers: state.design.controllers ?? [],
    trajectories: state.design.trajectories ?? [],
    sensors: state.design.sensors ?? []
  };
}

function syncAcademicMetadata() {
  const design = designWithAcademicMetadata();
  if (design) state.design = design;
}

function currentRoboStudioProject() {
  const results = currentCheckpointResults();
  return createRoboStudioProject({
    currentAssemblySnapshot: state.currentSnapshot,
    robotDesign: designWithAcademicMetadata(results),
    currentCircuitDesign: state.currentCircuitDesign,
    currentCircuitLabProject: state.currentCircuitLabProject,
    currentMechatronicsBinding: state.currentMechatronicsBinding,
    partRecords: state.partRecords,
    partLibraryItems: state.partLibraryItems
  });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function metric(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderSummary() {
  designSummary.innerHTML = [
    `<div class="summary-strip__item"><span>Links</span><strong>${state.design.links.length}</strong></div>`,
    `<div class="summary-strip__item"><span>Joints</span><strong>${state.design.joints.length}</strong></div>`,
    `<div class="summary-strip__item"><span>Circuit</span><strong>${escapeHtml(compactCircuitStatus())}</strong></div>`,
    `<div class="summary-strip__item summary-strip__item--source"><span>Source</span><strong>${state.design.source === "sample-prerigged" ? "Pre-rigged" : "Manual"}</strong></div>`
  ].join("");
}

function renderSummaryPlaceholder() {
  designSummary.innerHTML = [
    `<div class="summary-strip__item"><span>Links</span><strong>Loading</strong></div>`,
    `<div class="summary-strip__item"><span>Joints</span><strong>Loading</strong></div>`,
    `<div class="summary-strip__item"><span>Circuit</span><strong>${escapeHtml(compactCircuitStatus())}</strong></div>`,
    `<div class="summary-strip__item summary-strip__item--source"><span>Source</span><strong>Loading</strong></div>`
  ].join("");
}

function renderMetrics() {
  const mass = state.analysis?.mass;
  const com = mass?.centerOfMass ?? [0, 0, 0];
  const effector = selectedEffector();
  const effectorPosition = effector ? getEndEffectorPosition(state.design, effector.id, state.transforms) : new THREE.Vector3();
  metricsGrid.innerHTML = [
    metric("Assembly parts", state.partRecords.length),
    metric("Triangles", triangleCount(state.assemblyRoot).toLocaleString()),
    metric("Robot mass", `${formatNumber(mass?.totalMassKg, 2)} kg`),
    metric("Collisions", state.analysis?.collisions.length ?? 0),
    metric("COM", `${formatNumber(com[0], 0)}, ${formatNumber(com[1], 0)}, ${formatNumber(com[2], 0)} mm`),
    metric("Tool", `${formatNumber(effectorPosition.x, 0)}, ${formatNumber(effectorPosition.y, 0)}, ${formatNumber(effectorPosition.z, 0)} mm`)
  ].join("");
}

function renderTree() {
  const linkCards = state.design.links
    .map(
      (link) => `
        <article class="tree-card ${link.id === state.selectedLinkId ? "is-selected" : ""}">
          <span>link / ${link.partIds.length} parts / ${formatNumber(link.massKg, 2)} kg</span>
          <strong>${escapeHtml(link.name)}</strong>
          <button type="button" data-select-link="${escapeHtml(link.id)}">Select Link</button>
        </article>`
    )
    .join("");

  const jointCards = state.design.joints
    .map(
      (joint) => `
        <article class="tree-card ${joint.id === state.selectedJointId ? "is-selected" : ""}">
          <span>${escapeHtml(joint.type)} / ${escapeHtml(joint.parentLinkId)} -> ${escapeHtml(joint.childLinkId)}</span>
          <strong>${escapeHtml(joint.name)}</strong>
          <button type="button" data-select-joint="${escapeHtml(joint.id)}">Select Joint</button>
        </article>`
    )
    .join("");

  robotTree.innerHTML = `${linkCards}${jointCards}`;
}

function partCheckboxList(parts, className, options = {}) {
  if (!parts.length) return `<span class="empty-note">${escapeHtml(options.empty ?? "None")}</span>`;
  return parts
    .map((part) => {
      const suffix = options.owner ? ` / ${options.owner(part)?.name ?? "Unassigned"}` : "";
      const checked = options.checked ? "checked" : "";
      return `<label><input class="${className}" type="checkbox" value="${escapeHtml(part.id)}" ${checked} />${escapeHtml(part.name)}${escapeHtml(suffix)}</label>`;
    })
    .join("");
}

function proxyEditorHtml(link) {
  const proxy = selectedProxy();
  const proxyOptions = (link?.collisionProxies ?? [])
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === proxy?.id ? "selected" : ""}>${escapeHtml(item.id)}</option>`)
    .join("");
  const [a = 10, b = a, c = a] = proxy?.dimensions ?? [10, 10, 10];
  return collapsibleCard(
    "model-collision-proxy",
    "Collision proxy",
    `
      <div class="form-grid form-grid--two">
        <label class="form-field"><span>Proxy</span><select id="proxy-select">${proxyOptions || "<option value=''>No proxies</option>"}</select></label>
        <label class="form-field"><span>Type</span><select id="proxy-type">
          ${["box", "sphere", "capsule", "cylinder"].map((type) => `<option value="${type}" ${proxy?.type === type ? "selected" : ""}>${type}</option>`).join("")}
        </select></label>
        <label class="form-field"><span>Origin X</span><input id="proxy-origin-x" type="number" step="1" value="${escapeHtml(proxy?.origin?.[0] ?? 0)}" /></label>
        <label class="form-field"><span>Origin Y</span><input id="proxy-origin-y" type="number" step="1" value="${escapeHtml(proxy?.origin?.[1] ?? 0)}" /></label>
        <label class="form-field"><span>Origin Z</span><input id="proxy-origin-z" type="number" step="1" value="${escapeHtml(proxy?.origin?.[2] ?? 0)}" /></label>
        <label class="form-field"><span>Box X</span><input id="proxy-dim-x" type="number" step="1" min="0.001" value="${escapeHtml(a)}" /></label>
        <label class="form-field"><span>Box Y / length</span><input id="proxy-dim-y" type="number" step="1" min="0.001" value="${escapeHtml(b)}" /></label>
        <label class="form-field"><span>Box Z</span><input id="proxy-dim-z" type="number" step="1" min="0.001" value="${escapeHtml(c)}" /></label>
        <label class="form-field"><span>Radius</span><input id="proxy-radius" type="number" step="1" min="0.001" value="${escapeHtml(a)}" /></label>
        <label class="form-field"><span>Length</span><input id="proxy-length" type="number" step="1" min="0.001" value="${escapeHtml(b)}" /></label>
      </div>
      <label class="inline-check"><input id="proxy-enabled" type="checkbox" ${proxy?.enabled === false ? "" : "checked"} /> Enabled</label>
      <div class="form-actions">
        <button class="compact-button" id="apply-proxy" type="button">Apply Proxy</button>
        <button class="compact-button" id="add-proxy" type="button">Add Proxy</button>
        <button class="compact-button" id="reset-proxy" type="button">Reset From Bounds</button>
        <button class="compact-button is-risk" id="delete-proxy" type="button">Delete</button>
      </div>
    `,
    { meta: proxy ? `${proxy.type} / ${proxy.enabled === false ? "disabled" : "enabled"}` : "No proxy" }
  );
}

function endEffectorEditorHtml() {
  const effector = selectedEffector();
  const effectorOptions = state.design.endEffectors
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === effector?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
  const linkOptions = state.design.links
    .map((link) => `<option value="${escapeHtml(link.id)}" ${link.id === effector?.linkId ? "selected" : ""}>${escapeHtml(link.name)}</option>`)
    .join("");
  return collapsibleCard(
    "model-end-effector",
    "End effector",
    `
      <div class="form-grid form-grid--two">
        <label class="form-field"><span>Tool</span><select id="effector-select">${effectorOptions || "<option value=''>No tools</option>"}</select></label>
        <label class="form-field"><span>Name</span><input id="effector-name" value="${escapeHtml(effector?.name ?? "Tool")}" /></label>
        <label class="form-field"><span>Link</span><select id="effector-link">${linkOptions}</select></label>
        <label class="form-field"><span>Position X</span><input id="effector-pos-x" type="number" step="1" value="${escapeHtml(effector?.toolFrame?.position?.[0] ?? 0)}" /></label>
        <label class="form-field"><span>Position Y</span><input id="effector-pos-y" type="number" step="1" value="${escapeHtml(effector?.toolFrame?.position?.[1] ?? 0)}" /></label>
        <label class="form-field"><span>Position Z</span><input id="effector-pos-z" type="number" step="1" value="${escapeHtml(effector?.toolFrame?.position?.[2] ?? 0)}" /></label>
        <label class="form-field"><span>Rotation X</span><input id="effector-rot-x" type="number" step="1" value="${escapeHtml(effector?.toolFrame?.rotation?.[0] ?? 0)}" /></label>
        <label class="form-field"><span>Rotation Y</span><input id="effector-rot-y" type="number" step="1" value="${escapeHtml(effector?.toolFrame?.rotation?.[1] ?? 0)}" /></label>
        <label class="form-field"><span>Rotation Z</span><input id="effector-rot-z" type="number" step="1" value="${escapeHtml(effector?.toolFrame?.rotation?.[2] ?? 0)}" /></label>
      </div>
      <div class="form-actions">
        <button class="compact-button" id="apply-effector" type="button">Apply Tool</button>
        <button class="compact-button" id="add-effector" type="button">Add Tool</button>
        <button class="compact-button is-risk" id="delete-effector" type="button">Delete</button>
      </div>
    `,
    { meta: effector ? effector.linkId : "No tool" }
  );
}

function renderModelControls() {
  const link = selectedLink();
  const joint = selectedJoint();
  const owners = new Map();
  for (const ownerLink of state.design.links) {
    for (const partId of ownerLink.partIds ?? []) owners.set(partId, ownerLink);
  }
  const selectedParts = state.partRecords.filter((part) => link?.partIds.includes(part.id));
  const unassignedParts = state.partRecords.filter((part) => !owners.has(part.id));
  const assignedElsewhere = state.partRecords.filter((part) => {
    const owner = owners.get(part.id);
    return owner && owner.id !== link?.id;
  });
  const densityOptions = DENSITY_PRESETS.map(
    (preset) =>
      `<option value="${escapeHtml(preset.id)}" ${preset.id === state.selectedDensityId ? "selected" : ""}>${escapeHtml(preset.label)} (${preset.densityKgM3} kg/m3)</option>`
  ).join("");
  const editLinkBody = `
    <div class="form-grid form-grid--two">
      <label class="form-field"><span>Name</span><input id="link-name" value="${escapeHtml(link?.name ?? "")}" /></label>
      <label class="form-field"><span>Mass kg</span><input id="link-mass" type="number" step="0.05" min="0" value="${escapeHtml(link?.massKg ?? 0)}" /></label>
    </div>
    <div class="form-grid form-grid--two">
      <label class="form-field"><span>COM X</span><input id="link-com-x" type="number" step="1" value="${escapeHtml(link?.com?.[0] ?? 0)}" /></label>
      <label class="form-field"><span>COM Y</span><input id="link-com-y" type="number" step="1" value="${escapeHtml(link?.com?.[1] ?? 0)}" /></label>
      <label class="form-field"><span>COM Z</span><input id="link-com-z" type="number" step="1" value="${escapeHtml(link?.com?.[2] ?? 0)}" /></label>
      <label class="form-field"><span>Density preset</span><select id="density-preset">${densityOptions}</select></label>
    </div>
    <div class="form-actions">
      <button class="compact-button" id="estimate-link-mass" type="button">Estimate Mass/COM</button>
      <button class="compact-button" id="apply-link" type="button">Apply Link Changes</button>
    </div>
    <div class="part-assignment-groups">
      <div class="part-group"><span>Assigned to this link</span><div class="part-checks">${partCheckboxList(selectedParts, "part-assignment", { checked: true, empty: "No parts assigned to this link" })}</div></div>
      <div class="part-group"><span>Unassigned parts</span><div class="part-checks">${partCheckboxList(unassignedParts, "unassigned-part", { empty: "No unassigned parts" })}</div></div>
      <div class="part-group"><span>Assigned elsewhere - check to move</span><div class="part-checks">${partCheckboxList(assignedElsewhere, "reassigned-part", { owner: (part) => owners.get(part), empty: "No parts assigned elsewhere" })}</div></div>
    </div>
  `;
  const createLinkBody = `
    <label class="form-field"><span>Name</span><input id="new-link-name" placeholder="New link name" /></label>
    <div class="part-checks">${partCheckboxList(unassignedParts, "new-link-part", { empty: "No unassigned parts available" })}</div>
    <button class="compact-button" id="add-link" type="button">Create Link</button>
  `;
  const jointBody = `
    ${jointFormHtml(joint)}
    <div class="form-actions">
      <button class="compact-button" id="apply-joint" type="button">${joint ? "Apply Joint Changes" : "Add Joint"}</button>
      <button class="compact-button" id="add-joint" type="button">Add New Joint</button>
    </div>
  `;

  modeControls.innerHTML = `
    <h2>Model Mode</h2>
    ${collapsibleCard("model-edit-link", "Edit selected link", editLinkBody, { meta: link ? `${link.partIds.length} parts` : "No link" })}
    ${collapsibleCard("model-create-link", "Create link from unassigned parts", createLinkBody, { meta: `${unassignedParts.length} available` })}
    ${proxyEditorHtml(link)}
    ${endEffectorEditorHtml()}
    ${collapsibleCard("model-edit-joint", joint ? "Edit joint" : "Create joint", jointBody, { meta: joint ? `${joint.parentLinkId} -> ${joint.childLinkId}` : "No joint" })}
  `;
}

function jointFormHtml(joint = null) {
  const linkOptions = state.design.links.map((link) => `<option value="${escapeHtml(link.id)}">${escapeHtml(link.name)}</option>`).join("");
  const actuatorOptions = [`<option value="">Unassigned</option>`]
    .concat(state.design.actuators.map((actuator) => `<option value="${escapeHtml(actuator.id)}">${escapeHtml(actuator.name)}</option>`))
    .join("");
  return `
    <div class="form-grid form-grid--two">
      <label class="form-field"><span>Name</span><input id="joint-name" value="${escapeHtml(joint?.name ?? "New joint")}" /></label>
      <label class="form-field"><span>Type</span><select id="joint-type">
        ${["revolute", "prismatic", "fixed"].map((type) => `<option value="${type}" ${joint?.type === type ? "selected" : ""}>${type}</option>`).join("")}
      </select></label>
      <label class="form-field"><span>Parent</span><select id="joint-parent">${linkOptions}</select></label>
      <label class="form-field"><span>Child</span><select id="joint-child">${linkOptions}</select></label>
      <label class="form-field"><span>Origin X</span><input id="joint-origin-x" type="number" step="1" value="${escapeHtml(joint?.origin?.[0] ?? 0)}" /></label>
      <label class="form-field"><span>Origin Y</span><input id="joint-origin-y" type="number" step="1" value="${escapeHtml(joint?.origin?.[1] ?? 0)}" /></label>
      <label class="form-field"><span>Origin Z</span><input id="joint-origin-z" type="number" step="1" value="${escapeHtml(joint?.origin?.[2] ?? 0)}" /></label>
      <label class="form-field"><span>Axis X</span><input id="joint-axis-x" type="number" step="0.1" value="${escapeHtml(joint?.axis?.[0] ?? 0)}" /></label>
      <label class="form-field"><span>Axis Y</span><input id="joint-axis-y" type="number" step="0.1" value="${escapeHtml(joint?.axis?.[1] ?? 0)}" /></label>
      <label class="form-field"><span>Axis Z</span><input id="joint-axis-z" type="number" step="0.1" value="${escapeHtml(joint?.axis?.[2] ?? 1)}" /></label>
      <label class="form-field"><span>Min</span><input id="joint-min" type="number" step="1" value="${escapeHtml(joint?.min ?? -90)}" /></label>
      <label class="form-field"><span>Max</span><input id="joint-max" type="number" step="1" value="${escapeHtml(joint?.max ?? 90)}" /></label>
      <label class="form-field"><span>Damping</span><input id="joint-damping" type="number" step="0.01" min="0" value="${escapeHtml(joint?.damping ?? 0.15)}" /></label>
      <label class="form-field"><span>Friction</span><input id="joint-friction" type="number" step="0.01" min="0" value="${escapeHtml(joint?.friction ?? 0.05)}" /></label>
      <label class="form-field"><span>Actuator</span><select id="joint-actuator">${actuatorOptions}</select></label>
    </div>
  `;
}

function renderAnalyzeControls() {
  const effector = selectedEffector();
  const currentTool = effector
    ? getEndEffectorPosition(state.design, effector.id, state.transforms).toArray()
    : [0, 0, 0];
  const activeChain = effector
    ? findJointChainToLink(state.design, effector.linkId).map((joint) => joint.name)
    : [];
  const topology = state.analysis?.topology ?? analyzeTopology(state.design);
  const topologyMessages = [
    ...topology.multipleParents.map((item) => `${item.linkId} has parents ${item.parentLinkIds.join(", ")}`),
    ...topology.cycles.map((cycle) => `Cycle: ${cycle.join(" -> ")}`)
  ];
  const ikState = state.ikResult ? (state.ikResult.ok ? "Solved" : "Failed") : "Not solved";
  const clampedJoints = state.ikResult?.clampedJoints?.map(jointLabel).join(", ") || "None";
  const effectorOptions = state.design.endEffectors
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === effector?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
  const sliders = state.design.joints
    .filter((joint) => joint.type !== "fixed")
    .map(
      (joint) => `
        <label class="form-field">
          <span>${escapeHtml(joint.name)} (${formatNumber(getJointAngle(state.design, joint.id), 1)})</span>
          <input class="joint-angle" data-joint-id="${escapeHtml(joint.id)}" type="range" min="${joint.min}" max="${joint.max}" step="1" value="${getJointAngle(state.design, joint.id)}" />
        </label>`
    )
    .join("");
  const ikBody = `
    <label class="form-field"><span>End effector</span><select id="ik-effector">${effectorOptions}</select></label>
    <div class="form-grid form-grid--two">
      <label class="form-field"><span>Target X</span><input id="ik-target-x" type="number" step="5" value="${state.ikTarget[0]}" /></label>
      <label class="form-field"><span>Target Y</span><input id="ik-target-y" type="number" step="5" value="${state.ikTarget[1]}" /></label>
      <label class="form-field"><span>Target Z</span><input id="ik-target-z" type="number" step="5" value="${state.ikTarget[2]}" /></label>
    </div>
    <div class="analysis-kv">
      <div><span>Target XYZ</span><strong>${formatVector(state.ikTarget, 1)} mm</strong></div>
      <div><span>Current tool XYZ</span><strong>${formatVector(currentTool, 1)} mm</strong></div>
      <div><span>Active chain</span><strong>${escapeHtml(activeChain.join(" -> ") || "No chain reaches this tool")}</strong></div>
      <div><span>Status</span><strong>${escapeHtml(ikState)}</strong></div>
      <div><span>Error</span><strong>${formatNumber(state.ikResult?.errorMm, 2)} mm</strong></div>
      <div><span>Iterations</span><strong>${escapeHtml(state.ikResult?.iterations ?? "-")}</strong></div>
      <div><span>Clamped joints</span><strong>${escapeHtml(clampedJoints)}</strong></div>
    </div>
    <div class="form-actions">
      <button class="compact-button" id="solve-ik" type="button">Solve IK</button>
      <button class="compact-button" id="reset-chain-pose" type="button">Reset Chain Pose</button>
    </div>
  `;
  const topologyBody = `
    <p class="form-note">${escapeHtml(topologyMessages.length ? topologyMessages.join(" / ") : "No multiple-parent links or cycles detected.")}</p>
    <p class="form-note">${topology.unsupportedClosedLoop ? "Closed-loop solving is unsupported in V1; remove the extra parent joint or break the cycle before IK." : "Open serial chains are supported for deterministic IK."}</p>
  `;
  modeControls.innerHTML = `
    <h2>Analyze Mode</h2>
    ${collapsibleCard("analyze-ik-target", "Inverse kinematics target", ikBody, { meta: ikState })}
    ${collapsibleCard("analyze-topology", "Topology checks", topologyBody, { meta: topology.unsupportedClosedLoop ? "Needs attention" : "Open chain" })}
    ${collapsibleCard("analyze-joint-pose", "Joint pose", sliders || "<span>No movable joints are defined.</span>", { meta: `${state.design.joints.filter((joint) => joint.type !== "fixed").length} movable` })}
  `;
}

function renderLabCheckpointRows(results) {
  if (!results.length) return `<tr><td colspan="4">No lab checkpoints are configured.</td></tr>`;
  return results
    .map(
      (result) => `
        <tr data-state="${result.passed ? "ok" : "warn"}">
          <td>${escapeHtml(result.label)}</td>
          <td>${result.passed ? "Pass" : "Needs work"}</td>
          <td>${escapeHtml(result.evidence)}</td>
          <td>${escapeHtml(result.passed ? "No action needed." : result.action)}</td>
        </tr>`
    )
    .join("");
}

function renderExperimentRows() {
  if (!state.experimentRuns.length) return `<tr><td colspan="6">No experiment runs captured yet.</td></tr>`;
  return state.experimentRuns
    .slice()
    .reverse()
    .map(
      (run) => `
        <tr>
          <td>${escapeHtml(run.label)}</td>
          <td>${escapeHtml(new Date(run.createdAt).toLocaleTimeString())}</td>
          <td>${formatNumber(run.metrics?.totalMassKg, 3)}</td>
          <td>${formatNumber(run.metrics?.ikErrorMm, 2)}</td>
          <td>${escapeHtml(run.metrics?.collisionCount ?? 0)}</td>
          <td>${escapeHtml(run.simulation?.status ?? "not initialized")}</td>
        </tr>`
    )
    .join("");
}

function renderLabControlsEvidence() {
  const workspace = sampleWorkspace(state.design, selectedEffector()?.id);
  const fabrication = createFabricationReadiness(state.design, state.partRecords);
  const pid = state.pidResponse;
  const warnings = fabrication.warnings.length
    ? fabrication.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")
    : "<li>No fabrication readiness warnings.</li>";
  return `
    <div class="analysis-kv">
      <div><span>Workspace samples</span><strong>${workspace.sampleCount}</strong></div>
      <div><span>Workspace X</span><strong>${formatNumber(workspace.bounds.min[0], 0)} to ${formatNumber(workspace.bounds.max[0], 0)} mm</strong></div>
      <div><span>Workspace Y</span><strong>${formatNumber(workspace.bounds.min[1], 0)} to ${formatNumber(workspace.bounds.max[1], 0)} mm</strong></div>
      <div><span>Workspace Z</span><strong>${formatNumber(workspace.bounds.min[2], 0)} to ${formatNumber(workspace.bounds.max[2], 0)} mm</strong></div>
      <div><span>BOM rows</span><strong>${fabrication.bom.length}</strong></div>
      <div><span>Missing mesh files</span><strong>${fabrication.missingFileCount}</strong></div>
      <div><span>PID overshoot</span><strong>${pid ? `${formatNumber(pid.metrics.overshoot, 2)} deg` : "Not run"}</strong></div>
      <div><span>PID settling</span><strong>${pid?.metrics.settlingTimeS == null ? "Not settled" : `${formatNumber(pid.metrics.settlingTimeS, 2)} s`}</strong></div>
    </div>
    <ul class="urdf-issue-list">${warnings}</ul>
    <div class="form-actions">
      <button class="compact-button" id="run-pid-demo" type="button">Run PID Demo</button>
    </div>
  `;
}

function renderLabPackageStatus(project) {
  const bundle = projectBundlePreflight(project);
  const summary = manifestSummary(project.manifest);
  const issues = bundle.issues.length
    ? bundle.issues.slice(0, 5).map((issue) => `<li><b>${escapeHtml(issue.code)}</b> ${escapeHtml(issue.message)}</li>`).join("")
    : "<li>Project package preflight has no findings.</li>";
  return `
    <div class="analysis-kv">
      <div><span>Package state</span><strong>${bundle.ready ? "Ready" : "Blocked"}</strong></div>
      <div><span>Assets</span><strong>${summary.assetCount}</strong></div>
      <div><span>Manifest warnings</span><strong>${summary.warnings}</strong></div>
      <div><span>Electronics Studio design</span><strong>${project.workspace?.currentCircuitDesign ? "Included" : "None"}</strong></div>
      <div><span>Circuit Lab project</span><strong>${project.workspace?.currentCircuitLabProject ? "Included" : "None"}</strong></div>
      <div><span>Mechatronics binding</span><strong>${project.workspace?.currentMechatronicsBinding ? "Included" : "None"}</strong></div>
      <div><span>Runs</span><strong>${state.experimentRuns.length}</strong></div>
    </div>
    <ul class="urdf-issue-list">${issues}</ul>
    <div class="form-actions">
      <button class="compact-button" id="export-project-json" type="button">Export .robostudio.json</button>
      <button class="compact-button ${bundle.ready ? "is-active" : ""}" id="export-project-zip" type="button" ${bundle.ready ? "" : "disabled"}>Export .robostudio.zip</button>
    </div>
  `;
}

function renderLabControls() {
  const results = refreshLabCheckpoints();
  const progress = labProgress(results);
  const objectives = state.labSpec.learningObjectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const deliverables = state.labSpec.deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const project = currentRoboStudioProject();
  const briefBody = `
    <p class="form-note">${escapeHtml(state.labSpec.level)} / ${state.labSpec.durationMinutes} min / ${progress.percent}% complete</p>
    <h3>Learning objectives</h3>
    <ul class="urdf-issue-list">${objectives}</ul>
    <h3>Deliverables</h3>
    <ul class="urdf-issue-list">${deliverables}</ul>
  `;
  const checkpointBody = `
    <div class="table-scroll">
      <table class="analysis-table">
        <thead><tr><th>Checkpoint</th><th>Status</th><th>Evidence</th><th>Next action</th></tr></thead>
        <tbody>${renderLabCheckpointRows(results)}</tbody>
      </table>
    </div>
    <div class="form-actions">
      <button class="compact-button" id="run-lab-checkpoints" type="button">Refresh Checkpoints</button>
      <button class="compact-button" id="export-lab-report" type="button">Export HTML Report</button>
      <button class="compact-button" id="export-lab-report-json" type="button">Export Report JSON</button>
    </div>
  `;
  const experimentsBody = `
    <div class="table-scroll">
      <table class="analysis-table">
        <thead><tr><th>Run</th><th>Time</th><th>Mass kg</th><th>IK error mm</th><th>Collisions</th><th>Simulation</th></tr></thead>
        <tbody>${renderExperimentRows()}</tbody>
      </table>
    </div>
    <div class="form-actions">
      <button class="compact-button" id="capture-experiment-run" type="button">Capture Run</button>
      <button class="compact-button" id="export-runs-csv" type="button" ${state.experimentRuns.length ? "" : "disabled"}>Export CSV</button>
    </div>
  `;
  modeControls.innerHTML = `
    <h2>Lab Mode</h2>
    ${collapsibleCard("lab-brief", state.labSpec.title, briefBody, { meta: `${progress.passed}/${progress.total}` })}
    ${collapsibleCard("lab-checkpoints", "Course checkpoints", checkpointBody, { kind: "analysis-table-card", meta: `${progress.percent}%` })}
    ${collapsibleCard("lab-experiments", "Experiment evidence", experimentsBody, { kind: "analysis-table-card", meta: `${state.experimentRuns.length} runs` })}
    ${collapsibleCard("lab-controls", "Controls and fabrication basics", renderLabControlsEvidence(), { meta: "Evidence" })}
    ${collapsibleCard("lab-package", "Project package", renderLabPackageStatus(project), { meta: projectBundlePreflight(project).ready ? "Ready" : "Blocked" })}
  `;
}

function renderActuatorLibraryRows() {
  if (!state.design.actuators.length) return `<tr><td colspan="9">No actuators in the library.</td></tr>`;
  return state.design.actuators
    .map(
      (actuator) => `
        <tr class="${actuator.id === state.selectedActuatorId ? "is-selected" : ""}">
          <td>${escapeHtml(actuator.name)}</td>
          <td>${formatNumber(actuator.continuousTorqueNm, 2)}</td>
          <td>${formatNumber(actuator.peakTorqueNm, 2)}</td>
          <td>${formatNumber(actuator.maxSpeedDegS, 0)}</td>
          <td>${formatNumber(actuator.voltage, 1)}</td>
          <td>${formatNumber(actuator.massKg, 3)}</td>
          <td>${formatNumber(actuator.gearRatio, 1)}</td>
          <td>${formatNumber(actuator.efficiency, 2)}</td>
          <td>
            <button class="compact-button" type="button" data-select-actuator="${escapeHtml(actuator.id)}">Edit</button>
            <button class="compact-button is-risk" type="button" data-delete-actuator="${escapeHtml(actuator.id)}">Delete</button>
          </td>
        </tr>`
    )
    .join("");
}

function renderActuatorMarginRows() {
  const actuatorResults = state.analysis?.actuatorResults ?? [];
  if (!actuatorResults.length) return `<tr><td colspan="6">No joint loads to evaluate.</td></tr>`;
  return actuatorResults
    .map(
      (item) => `
        <tr data-state="${item.state}">
          <td>${escapeHtml(item.jointName)}</td>
          <td>${escapeHtml(item.actuatorName ?? "Unassigned")}</td>
          <td>${formatNumber(item.recommendedTorqueNm, 3)}</td>
          <td>${Number.isFinite(item.continuousMargin) ? `${formatNumber(item.continuousMargin, 2)}x` : "-"}</td>
          <td>${Number.isFinite(item.speedMargin) ? `${formatNumber(item.speedMargin, 2)}x` : "-"}</td>
          <td>${escapeHtml(item.state)}</td>
        </tr>`
    )
    .join("");
}

function renderActuatorControls() {
  const joint = selectedJoint();
  const actuator = selectedActuator() ?? DEFAULT_ACTUATORS[0];
  const jointOptions = state.design.joints
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === joint?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
  const actuatorOptions = [`<option value="">Unassigned</option>`]
    .concat(
      state.design.actuators.map(
        (item) => `<option value="${escapeHtml(item.id)}" ${item.id === joint?.actuatorId ? "selected" : ""}>${escapeHtml(item.name)}</option>`
      )
    )
    .join("");
  const actuatorResults = state.analysis?.actuatorResults ?? [];
  const riskCount = actuatorResults.filter((item) => item.state === "risk").length;
  const warnCount = actuatorResults.filter((item) => item.state === "warn").length;
  const marginMeta = riskCount ? `${riskCount} risk` : warnCount ? `${warnCount} warn` : "All ok";
  const assignmentBody = `
    <label class="form-field"><span>Joint</span><select id="actuator-joint">${jointOptions || "<option value=''>No joints</option>"}</select></label>
    <label class="form-field"><span>Actuator</span><select id="actuator-assignment">${actuatorOptions}</select></label>
    <button class="compact-button" id="assign-actuator" type="button">Assign</button>
  `;
  const marginsBody = `
    <div class="table-scroll">
      <table class="analysis-table">
        <thead><tr><th>Joint</th><th>Actuator</th><th>Recommended N.m</th><th>Torque margin</th><th>Speed margin</th><th>State</th></tr></thead>
        <tbody>${renderActuatorMarginRows()}</tbody>
      </table>
    </div>
  `;
  const libraryBody = `
    <div class="table-scroll">
      <table class="analysis-table">
        <thead><tr><th>Name</th><th>Cont. N.m</th><th>Peak N.m</th><th>Speed deg/s</th><th>Voltage</th><th>Mass kg</th><th>Gear</th><th>Eff.</th><th>Actions</th></tr></thead>
        <tbody>${renderActuatorLibraryRows()}</tbody>
      </table>
    </div>
  `;
  const editorBody = `
    <div class="form-grid form-grid--two">
      <label class="form-field"><span>Name</span><input id="actuator-name" value="${escapeHtml(actuator?.name ?? "Custom actuator")}" /></label>
      <label class="form-field"><span>Continuous N.m</span><input id="actuator-cont" type="number" step="0.1" min="0" value="${escapeHtml(actuator?.continuousTorqueNm ?? 1)}" /></label>
      <label class="form-field"><span>Peak N.m</span><input id="actuator-peak" type="number" step="0.1" min="0" value="${escapeHtml(actuator?.peakTorqueNm ?? 1.5)}" /></label>
      <label class="form-field"><span>Speed deg/s</span><input id="actuator-speed" type="number" step="10" min="1" value="${escapeHtml(actuator?.maxSpeedDegS ?? 180)}" /></label>
      <label class="form-field"><span>Voltage</span><input id="actuator-voltage" type="number" step="0.1" min="0" value="${escapeHtml(actuator?.voltage ?? 12)}" /></label>
      <label class="form-field"><span>Mass kg</span><input id="actuator-mass" type="number" step="0.01" min="0" value="${escapeHtml(actuator?.massKg ?? 0.1)}" /></label>
      <label class="form-field"><span>Gear ratio</span><input id="actuator-gear" type="number" step="0.1" min="1" value="${escapeHtml(actuator?.gearRatio ?? 1)}" /></label>
      <label class="form-field"><span>Efficiency</span><input id="actuator-efficiency" type="number" step="0.01" min="0.01" max="1" value="${escapeHtml(actuator?.efficiency ?? 0.7)}" /></label>
    </div>
    <label class="form-field"><span>Notes</span><textarea id="actuator-notes">${escapeHtml(actuator?.notes ?? "")}</textarea></label>
    <div class="form-actions">
      <button class="compact-button" id="save-actuator" type="button">Save Actuator</button>
      <button class="compact-button" id="add-actuator" type="button">Add As New</button>
      <button class="compact-button is-risk" id="delete-actuator" type="button">Delete Selected</button>
    </div>
  `;
  modeControls.innerHTML = `
    <h2>Actuator Mode</h2>
    ${collapsibleCard("actuators-assignment", "Joint assignment", assignmentBody, { meta: joint?.name ?? "No joint" })}
    ${collapsibleCard("actuators-margins", "Joint actuator margins", marginsBody, { kind: "analysis-table-card", meta: marginMeta })}
    ${collapsibleCard("actuators-library", "Actuator library", libraryBody, { kind: "analysis-table-card", meta: `${state.design.actuators.length} drives` })}
    ${collapsibleCard("actuators-editor", state.selectedActuatorId ? "Edit actuator" : "Add actuator", editorBody, { meta: actuator?.name ?? "Custom" })}
  `;
}

function renderSimulateControls() {
  const status = dynamics.status();
  const proxyConflicts = state.analysis?.collisions.length ?? 0;
  const pauseLabel = state.simulation.status === "running" ? "Pause" : "Run";
  const simulationBody = `
    <div class="analysis-kv">
      <div><span>State</span><strong>${escapeHtml(state.simulation.status)}</strong></div>
      <div><span>Timestep</span><strong>${formatNumber(state.simulation.timestep, 4)} s</strong></div>
      <div><span>Bodies</span><strong>${status.ready ? status.bodies : 0}</strong></div>
      <div><span>Joints</span><strong>${status.ready ? status.joints : 0}</strong></div>
      <div><span>Steps</span><strong>${status.steps}</strong></div>
      <div><span>Contact / collision</span><strong>${proxyConflicts ? `${proxyConflicts} proxy conflicts` : "No proxy conflicts"}</strong></div>
    </div>
    <label class="form-field"><span>Gravity</span><select id="sim-gravity"><option value="on" ${state.simulation.gravityEnabled ? "selected" : ""}>On</option><option value="off" ${state.simulation.gravityEnabled ? "" : "selected"}>Off</option></select></label>
    <label class="form-field"><span>Motors</span><select id="sim-motors"><option value="off" ${state.simulation.motorsEnabled ? "" : "selected"}>Off</option><option value="hold" ${state.simulation.motorsEnabled ? "selected" : ""}>Hold pose</option></select></label>
    <label class="form-field"><span>Timestep seconds</span><input id="sim-timestep" type="number" step="0.001" min="0.004" max="0.067" value="${escapeHtml(state.simulation.timestep)}" /></label>
    <p class="form-note">Motors are proxy-simulation controls for assigned actuators, not calibrated hardware torque output.</p>
    <p class="form-note">${escapeHtml(state.simulation.message)}</p>
    <div class="form-actions">
      <button class="compact-button" id="sim-reset-panel" type="button">Initialize / Reset</button>
      <button class="compact-button" id="sim-step-panel" type="button">Step</button>
      <button class="compact-button ${state.simulation.status === "running" ? "is-active" : ""}" id="sim-run-panel" type="button">${pauseLabel}</button>
    </div>
  `;
  modeControls.innerHTML = `
    <h2>Simulate Mode</h2>
    ${collapsibleCard("simulate-runner", "Rapier proxy simulation", simulationBody, { meta: state.simulation.status })}
  `;
}

function renderMechatronicsReadinessCard() {
  const readiness = state.mechatronicsReadiness ?? refreshMechatronicsReadiness();
  const validation = readiness.validation;
  const diagnostics = validation.diagnostics ?? [];
  const blockingCount = diagnostics.filter((item) => item.severity === "error").length;
  const voltageBlocked = diagnostics.some((item) => /voltage/i.test(item.code));
  const diagnosticItems = diagnostics.length
    ? diagnostics.slice(0, 5).map((item) => `<li><b>${escapeHtml(item.code)}</b> ${escapeHtml(item.message)}</li>`).join("")
    : "<li>No mechatronics binding diagnostics.</li>";
  return `
    <div class="analysis-kv">
      <div><span>Circuit Lab project present</span><strong>${state.currentCircuitLabProject ? "Yes" : "No"}</strong></div>
      <div><span>Selected controller</span><strong>${escapeHtml(circuitControllerLabel())}</strong></div>
      <div><span>Circuit DRC state</span><strong>${escapeHtml(readiness.electrical.status)}</strong></div>
      <div><span>Bound actuators</span><strong>${validation.coverage.boundActuators}/${validation.coverage.eligibleActuators}</strong></div>
      <div><span>Bound sensors</span><strong>${validation.coverage.boundSensors}/${validation.coverage.totalSensors}</strong></div>
      <div><span>Firmware channels valid</span><strong>${validation.coverage.validChannels}/${validation.coverage.totalChannels}</strong></div>
      <div><span>Voltage compatibility</span><strong>${voltageBlocked ? "Blocked" : blockingCount ? "Review diagnostics" : "No blocking voltage diagnostics"}</strong></div>
      <div><span>Semantic control availability</span><strong>${readiness.semanticRunAllowed ? "Available" : "Unavailable"}</strong></div>
    </div>
    <ul class="urdf-issue-list">${diagnosticItems}</ul>
    <p class="form-note">Binding edits remain in Circuit Lab V1. Workbench uses this view for read-only readiness and single-step semantic channel testing.</p>
    <div class="form-actions">
      <a class="compact-button" href="./circuits.html">Open Circuit Lab</a>
    </div>
  `;
}

function renderSemanticChannelCard() {
  const readiness = state.mechatronicsReadiness ?? refreshMechatronicsReadiness();
  const channels = readiness.validation.binding.firmwareChannels ?? [];
  const selectedChannelId = channels.some((channel) => channel.id === state.semanticCommand.channelId)
    ? state.semanticCommand.channelId
    : channels[0]?.id ?? "";
  const channelOptions = channels.length
    ? channels.map((channel) => `<option value="${escapeHtml(channel.id)}" ${channel.id === selectedChannelId ? "selected" : ""}>${escapeHtml(channel.id)} / ${escapeHtml(channel.semanticRole || "unmapped")}</option>`).join("")
    : `<option value="">No channels</option>`;
  const disabled = readiness.semanticRunAllowed && channels.length ? "" : "disabled";
  return `
    <label class="form-field"><span>Firmware channel</span><select id="semantic-channel-select">${channelOptions}</select></label>
    <label class="form-field"><span>Command value</span><input id="semantic-channel-value" type="number" step="1" value="${escapeHtml(state.semanticCommand.value)}" /></label>
    <p class="form-note">${escapeHtml(state.semanticCommand.message)}</p>
    <div class="form-actions">
      <button class="compact-button ${readiness.semanticRunAllowed ? "is-active" : ""}" id="apply-semantic-channel" type="button" ${disabled}>Apply Semantic Channel</button>
    </div>
  `;
}

function renderAuditControls() {
  const auditBody = `
    <span>Audit uses the same robot model for links, joints, proxies, mass, IK, actuators, and simulation readiness.</span>
    <button class="compact-button" id="audit-now" type="button">Run Audit</button>
  `;
  const readiness = state.mechatronicsReadiness ?? refreshMechatronicsReadiness();
  modeControls.innerHTML = `
    <h2>Audit Mode</h2>
    ${collapsibleCard("audit-readiness", "Readiness checks", auditBody, { meta: `${state.analysis?.audit?.length ?? 0} checks` })}
    ${collapsibleCard("audit-mechatronics", "Mechatronics readiness", renderMechatronicsReadinessCard(), { meta: compactCircuitStatus() })}
    ${collapsibleCard("audit-semantic-channel", "Semantic channel test", renderSemanticChannelCard(), { meta: readiness.semanticRunAllowed ? "Ready" : "Blocked" })}
  `;
}

function renderModeControls() {
  if (state.mode === "analyze") renderAnalyzeControls();
  else if (state.mode === "lab") renderLabControls();
  else if (state.mode === "actuators") renderActuatorControls();
  else if (state.mode === "simulate") renderSimulateControls();
  else if (state.mode === "audit") renderAuditControls();
  else renderModelControls();

  const parent = modeControls.querySelector("#joint-parent");
  const child = modeControls.querySelector("#joint-child");
  const actuator = modeControls.querySelector("#joint-actuator");
  const joint = selectedJoint();
  if (parent && joint) parent.value = joint.parentLinkId;
  if (child && joint) child.value = joint.childLinkId;
  if (actuator && joint?.actuatorId) actuator.value = joint.actuatorId;
}

function renderInspector() {
  const link = selectedLink();
  const joint = selectedJoint();
  const proxy = selectedProxy();
  const effector = selectedEffector();
  const linkBounds = link ? getLinkBounds(link, state.partRecords) : null;
  inspectorPanel.innerHTML = `
    <article class="result-card">
      <span>Selected link</span>
      <strong>${escapeHtml(link?.name ?? "None")}</strong>
      <p>${link?.partIds.length ?? 0} parts / ${formatNumber(link?.massKg, 2)} kg / bounds ${formatNumber(linkBounds?.size?.[0], 0)} x ${formatNumber(linkBounds?.size?.[1], 0)} x ${formatNumber(linkBounds?.size?.[2], 0)} mm</p>
    </article>
    <article class="result-card">
      <span>Selected joint</span>
      <strong>${escapeHtml(joint?.name ?? "None")}</strong>
      <p>${joint ? `${joint.type} / ${joint.parentLinkId} -> ${joint.childLinkId} / ${joint.min} to ${joint.max}` : "Create a joint to build a kinematic chain."}</p>
    </article>
    <article class="result-card">
      <span>Selected proxy</span>
      <strong>${escapeHtml(proxy?.id ?? "None")}</strong>
      <p>${proxy ? `${proxy.type} / ${proxy.enabled === false ? "disabled" : "enabled"} / ${proxy.dimensions.map((value) => formatNumber(value, 1)).join(" x ")}` : "Add a proxy to make this link collide in proxy checks."}</p>
    </article>
    <article class="result-card">
      <span>Selected tool</span>
      <strong>${escapeHtml(effector?.name ?? "None")}</strong>
      <p>${effector ? `${effector.linkId} / ${effector.toolFrame.position.map((value) => formatNumber(value, 1)).join(", ")} mm` : "Add an end effector for IK."}</p>
    </article>
  `;
}

function renderTorqueLoadTable(actuatorResults) {
  if (!actuatorResults.length) return "";
  const rows = actuatorResults
    .map(
      (item) => `
        <tr data-state="${item.state}">
          <td>${escapeHtml(item.jointName)}</td>
          <td>${formatNumber(item.carriedMassKg, 3)}</td>
          <td>${formatNumber(item.leverMm, 1)}</td>
          <td>${formatNumber(item.staticTorqueNm, 3)}</td>
          <td>${formatNumber(item.recommendedTorqueNm, 3)}</td>
          <td>${escapeHtml(item.actuatorName ?? "Unassigned")}</td>
          <td>${Number.isFinite(item.continuousMargin) ? `${formatNumber(item.continuousMargin, 2)}x` : "-"}</td>
          <td>${Number.isFinite(item.speedMargin) ? `${formatNumber(item.speedMargin, 2)}x` : "-"}</td>
          <td>${escapeHtml(item.state)}</td>
        </tr>`
    )
    .join("");
  return collapsibleCard(
    "analysis-loads",
    "Torque / load table",
    `
      <div class="table-scroll">
        <table class="analysis-table">
          <thead><tr><th>Joint</th><th>Carried kg</th><th>Lever mm</th><th>Static N.m</th><th>Recommended N.m</th><th>Actuator</th><th>Torque margin</th><th>Speed margin</th><th>State</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
    { kind: "analysis-table-card", meta: `${actuatorResults.length} joints` }
  );
}

function renderMassWorkflow(mass, stability) {
  const payloadKg = finiteNumber(state.design.assumptions?.payloadKg, 0);
  return collapsibleCard(
    "analysis-mass",
    "Mass / COM / stability",
    `
      <div class="analysis-kv">
        <div><span>Total mass</span><strong>${formatNumber(mass?.totalMassKg, 3)} kg</strong></div>
        <div><span>Payload</span><strong>${formatNumber(payloadKg, 3)} kg</strong></div>
        <div><span>World COM XYZ</span><strong>${formatVector(mass?.centerOfMass, 1)} mm</strong></div>
        <div><span>Base projection XZ</span><strong>${formatVector(stability?.baseProjectionMm, 1)} mm</strong></div>
        <div><span>Stability margin</span><strong>${formatNumber(stability?.marginMm, 1)} mm</strong></div>
        <div><span>Support center XZ</span><strong>${formatVector(stability?.supportCenterMm, 1)} mm</strong></div>
      </div>
    `,
    { kind: "analysis-table-card", meta: `${formatNumber(mass?.totalMassKg, 2)} kg` }
  );
}

function renderCollisionWorkflow(collisions) {
  const conflictRows = collisions.length
    ? collisions
        .map((collision) => {
          const pair = collisionPairKey(collision.linkA, collision.linkB);
          return `
            <tr data-state="risk">
              <td>${escapeHtml(collision.linkA)} / ${escapeHtml(collision.proxyA)}</td>
              <td>${escapeHtml(collision.linkB)} / ${escapeHtml(collision.proxyB)}</td>
              <td>${formatNumber(collision.overlapMm, 2)}</td>
              <td class="analysis-table__action"><button class="compact-button" type="button" data-allow-collision="${escapeHtml(pair)}">Allow Pair</button></td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="4">No active conflicts outside allowed pairs.</td></tr>`;
  const allowedPairs = [...new Set(state.design.allowedCollisions ?? [])];
  const allowedRows = allowedPairs.length
    ? allowedPairs
        .map(
          (pair) => `
            <tr>
              <td colspan="3">${escapeHtml(pair)}</td>
              <td class="analysis-table__action"><button class="compact-button is-risk" type="button" data-remove-allowed-collision="${escapeHtml(pair)}">Remove</button></td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="4">No intentional collision pairs are allowed.</td></tr>`;
  return collapsibleCard(
    "analysis-collisions",
    "Collision workflow",
    `
      <div class="table-scroll table-scroll--fit">
        <table class="analysis-table analysis-table--fit analysis-table--collision">
          <colgroup><col><col><col class="analysis-table__measure"><col class="analysis-table__action-col"></colgroup>
          <thead><tr><th>Link / proxy A</th><th>Link / proxy B</th><th>Overlap mm</th><th>Action</th></tr></thead>
          <tbody>${conflictRows}</tbody>
        </table>
      </div>
      <div class="table-scroll table-scroll--fit">
        <table class="analysis-table analysis-table--fit analysis-table--compact analysis-table--allowed-pairs">
          <colgroup><col><col><col><col class="analysis-table__action-col"></colgroup>
          <thead><tr><th colspan="4">Allowed pairs</th></tr></thead>
          <tbody>${allowedRows}</tbody>
        </table>
      </div>
    `,
    { kind: "analysis-table-card", meta: collisions.length ? `${collisions.length} conflicts` : "No conflicts" }
  );
}

function renderUrdfExportFlow(urdf) {
  const issues = urdf?.issues ?? [];
  const blockers = issues.filter((item) => item.level === "risk");
  const warnings = issues.filter((item) => item.level === "warn");
  const stateName = blockers.length ? "risk" : warnings.length ? "warn" : "ok";
  const issueItems = [...blockers, ...warnings].slice(0, 6);
  const issueList = issueItems.length
    ? `<ul class="urdf-issue-list">${issueItems
        .map((item) => `<li><b>${escapeHtml(item.code)}</b> ${escapeHtml(item.message)}</li>`)
        .join("")}</ul>`
    : `<p>Links, joints, inertials, visuals, collision proxies, limits, dynamics, and tool frames are ready for export.</p>`;
  const overflow = issues.length > issueItems.length
    ? `<p class="form-note">${issues.length - issueItems.length} more finding${issues.length - issueItems.length === 1 ? "" : "s"} are listed in Audit.</p>`
    : "";
  const limitations = (urdf?.model?.limitations ?? [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const downloadButton = blockers.length
    ? `<button class="compact-button" type="button" disabled>Resolve blockers</button>`
    : `<button class="compact-button is-active" type="button" data-download-urdf>Download URDF</button>`;

  return `
    <article class="result-card urdf-export-card" data-state="${stateName}">
      <span>URDF export</span>
      <strong>${blockers.length ? `${blockers.length} blockers` : warnings.length ? `${warnings.length} warnings` : "Ready"}</strong>
      ${issueList}
      ${overflow}
      <details>
        <summary>Limitations</summary>
        <ul class="urdf-issue-list">${limitations}</ul>
      </details>
      <div class="urdf-export-actions">${downloadButton}</div>
    </article>
  `;
}

function renderAnalysis() {
  const mass = state.analysis?.mass;
  const stability = state.analysis?.stability;
  const ik = state.ikResult;
  const collisions = state.analysis?.collisions ?? [];
  const actuatorResults = state.analysis?.actuatorResults ?? [];
  const urdf = state.analysis?.urdf;
  const cards = [
    `<article class="result-card" data-state="${stability?.ok ? "ok" : "warn"}"><span>Mass & stability</span><strong>${formatNumber(mass?.totalMassKg, 2)} kg total</strong><p>${escapeHtml(stability?.message ?? "No stability estimate.")}</p></article>`,
    `<article class="result-card" data-state="${collisions.length ? "risk" : "ok"}"><span>Collision proxies</span><strong>${collisions.length} active conflicts</strong><p>${collisions[0] ? `${collisions[0].linkA} vs ${collisions[0].linkB}` : "No proxy collisions outside allowed pairs."}</p></article>`,
    `<article class="result-card" data-state="${ik ? (ik.ok ? "ok" : "warn") : "warn"}"><span>IK</span><strong>${ik ? `${formatNumber(ik.errorMm, 2)} mm error` : "Not solved yet"}</strong><p>${escapeHtml(ik?.reason ?? "Set a target and solve an open chain.")}</p></article>`
  ];
  cards.push(
    ...actuatorResults.slice(0, 5).map(
      (item) =>
        `<article class="result-card" data-state="${item.state}"><span>${escapeHtml(item.jointName)}</span><strong>${escapeHtml(item.actuatorName ?? "No actuator")}</strong><p>${escapeHtml(item.message)} Recommended ${formatNumber(item.recommendedTorqueNm, 2)} N.m.</p></article>`
    )
  );
  analysisResults.innerHTML = `${cards.join("")}${renderUrdfExportFlow(urdf)}${renderMassWorkflow(mass, stability)}${renderCollisionWorkflow(collisions)}${renderTorqueLoadTable(actuatorResults)}`;
}

function renderAudit() {
  const audit = state.analysis?.audit ?? [];
  const grouped = new Map(CATEGORY_ORDER.map((category) => [category, []]));
  for (const item of audit) {
    const category = grouped.has(item.category) ? item.category : "Model";
    grouped.get(category).push(item);
  }
  auditList.innerHTML = [...grouped.entries()]
    .map(([category, items]) => {
      const body = items.length
        ? items
            .map(
              (item) =>
                `<article class="audit-item" data-state="${item.level}"><strong>${escapeHtml(item.code)}</strong><p>${escapeHtml(item.message)}</p><p><b>Next:</b> ${escapeHtml(item.action)}</p></article>`
            )
            .join("")
        : `<article class="audit-item" data-state="ok"><strong>No findings</strong><p>No action needed.</p></article>`;
      return `<section class="audit-group"><h3>${escapeHtml(category)}</h3>${body}</section>`;
    })
    .join("");
}

function renderViewportReadout() {
  const sim = dynamics.status();
  const proxyConflicts = state.analysis?.collisions.length ?? 0;
  const contentId = "floating-panel-readout-content";
  viewportReadout.innerHTML = `
    ${floatingPanelHeader("readout", "Readout", contentId)}
    <div class="floating-panel__content viewport-readout__content" id="${contentId}">
      <span>Target</span>
      <strong>${state.ikTarget.map((value) => formatNumber(value, 0)).join(", ")} mm</strong>
      <span>Simulation</span>
      <strong>${escapeHtml(state.simulation.status)} / ${sim.ready ? `${sim.steps} steps / ${sim.bodies} bodies` : "0 bodies"}</strong>
      <span>Collision status</span>
      <strong>${proxyConflicts ? `${proxyConflicts} proxy conflicts` : "No proxy conflicts"}</strong>
    </div>
  `;
  applyFloatingPanelState("readout", viewportReadout);
  syncSimulationButtons();
}

function renderAll() {
  if (!state.design) return;
  syncSelectedDesignItems();
  analyzeDesign();
  renderSummary();
  renderMetrics();
  renderTree();
  renderModeControls();
  renderInspector();
  renderAnalysis();
  renderAudit();
  renderViewportReadout();
  applyFloatingPanelStates();
  updateDesignHistoryControls();
}

function requireWorkbenchReady() {
  if (!state.design) throw new Error("The Robotics Workbench is not loaded yet.");
}

function workbenchLinkById(linkId = state.selectedLinkId) {
  const id = linkId || state.selectedLinkId;
  const link = state.design?.links.find((item) => item.id === id);
  if (!link) throw new Error(`Unknown link id: ${id}`);
  return link;
}

function workbenchJointById(jointId = state.selectedJointId) {
  const id = jointId || state.selectedJointId;
  const joint = state.design?.joints.find((item) => item.id === id);
  if (!joint) throw new Error(`Unknown joint id: ${id}`);
  return joint;
}

function workbenchProxyById(link, proxyId = state.selectedProxyId) {
  const id = proxyId || state.selectedProxyId;
  const proxy = link.collisionProxies.find((item) => item.id === id);
  if (!proxy) throw new Error(`Unknown proxy id: ${id}`);
  return proxy;
}

function workbenchEffectorById(effectorId = state.selectedEffectorId) {
  const id = effectorId || state.selectedEffectorId;
  const effector = state.design?.endEffectors.find((item) => item.id === id);
  if (!effector) throw new Error(`Unknown end effector id: ${id}`);
  return effector;
}

function workbenchActuatorById(actuatorId = state.selectedActuatorId) {
  const id = actuatorId || state.selectedActuatorId;
  const actuator = state.design?.actuators.find((item) => item.id === id);
  if (!actuator) throw new Error(`Unknown actuator id: ${id}`);
  return actuator;
}

function linkContext(link) {
  return {
    id: link.id,
    name: link.name,
    partCount: link.partIds.length,
    massKg: link.massKg,
    com: link.com,
    proxies: link.collisionProxies.map((proxy) => ({
      id: proxy.id,
      type: proxy.type,
      enabled: proxy.enabled !== false,
      origin: proxy.origin,
      dimensions: proxy.dimensions
    }))
  };
}

function workbenchAssistantContext() {
  if (!state.design) {
    return {
      page: "Robotics Design Workbench",
      ready: false,
      status: snapshotStatus.textContent
    };
  }
  const selectedEffectorItem = selectedEffector();
  return {
    page: "Robotics Design Workbench",
    ready: true,
    mode: state.mode,
    status: snapshotStatus.textContent,
    selections: {
      linkId: state.selectedLinkId,
      jointId: state.selectedJointId,
      proxyId: state.selectedProxyId,
      effectorId: state.selectedEffectorId,
      actuatorId: state.selectedActuatorId
    },
    design: {
      name: state.design.name,
      source: state.design.source,
      links: state.design.links.map(linkContext),
      joints: state.design.joints.map((joint) => ({
        id: joint.id,
        name: joint.name,
        type: joint.type,
        parentLinkId: joint.parentLinkId,
        childLinkId: joint.childLinkId,
        min: joint.min,
        max: joint.max,
        angle: getJointAngle(state.design, joint.id),
        actuatorId: joint.actuatorId
      })),
      endEffectors: state.design.endEffectors.map((effector) => ({
        id: effector.id,
        name: effector.name,
        linkId: effector.linkId,
        toolFrame: effector.toolFrame
      })),
      actuators: state.design.actuators.map((actuator) => ({
        id: actuator.id,
        name: actuator.name,
        continuousTorqueNm: actuator.continuousTorqueNm,
        peakTorqueNm: actuator.peakTorqueNm,
        maxSpeedDegS: actuator.maxSpeedDegS
      })),
      allowedCollisions: state.design.allowedCollisions ?? [],
      assumptions: state.design.assumptions
    },
    ik: {
      target: state.ikTarget,
      selectedEffectorPosition: selectedEffectorItem
        ? getEndEffectorPosition(state.design, selectedEffectorItem.id, state.transforms).toArray()
        : null,
      lastResult: state.ikResult
        ? {
            ok: state.ikResult.ok,
            errorMm: state.ikResult.errorMm,
            reason: state.ikResult.reason,
            iterations: state.ikResult.iterations
          }
        : null
    },
    analysis: state.analysis
      ? {
          collisions: state.analysis.collisions.length,
          auditFindings: state.analysis.audit.length,
          totalMassKg: state.analysis.mass.totalMassKg,
          stabilityOk: state.analysis.stability.ok,
          simulationStatus: state.simulation.status
        }
      : null,
    mechatronics: state.mechatronicsReadiness
      ? {
          circuitLabProjectPresent: Boolean(state.currentCircuitLabProject),
          electronicsDesignPresent: Boolean(state.currentCircuitDesign),
          bindingStatus: state.mechatronicsReadiness.binding.status,
          overallStatus: state.mechatronicsReadiness.overallStatus,
          semanticRunAllowed: state.mechatronicsReadiness.semanticRunAllowed,
          coverage: state.mechatronicsReadiness.coverage,
          diagnostics: state.mechatronicsReadiness.validation.diagnostics.map((item) => ({
            severity: item.severity,
            code: item.code,
            message: item.message
          }))
        }
      : null,
    simulation: {
      status: state.simulation.status,
      message: state.simulation.message,
      gravityEnabled: state.simulation.gravityEnabled,
      timestep: state.simulation.timestep,
      dynamics: dynamics.status()
    }
  };
}

function setWorkbenchLinkProperties(args) {
  const link = workbenchLinkById(args.linkId);
  if (typeof args.name === "string" && args.name.trim()) link.name = args.name.trim();
  if (args.massKg !== undefined) link.massKg = Math.max(0, finiteNumber(args.massKg, link.massKg));
  if (Array.isArray(args.com)) link.com = roundedVector(args.com);
  state.selectedLinkId = link.id;
  updateDesignTimestamp();
  renderAll();
  return `${link.name} updated.`;
}

function estimateWorkbenchLinkMassCom(linkId) {
  const link = workbenchLinkById(linkId);
  const bounds = getLinkBounds(link, state.partRecords);
  const massKg = estimateMassFromBounds(bounds, densityPreset().densityKgM3);
  link.massKg = massKg;
  link.com = roundedVector(bounds.center);
  link.inertia = estimateInertiaFromBounds(massKg, bounds);
  state.selectedLinkId = link.id;
  updateDesignTimestamp();
  renderAll();
  return `${link.name} mass and center of mass estimated.`;
}

function setWorkbenchProxy(args) {
  const link = workbenchLinkById(args.linkId);
  const proxy = workbenchProxyById(link, args.proxyId);
  if (args.type) proxy.type = args.type;
  if (Array.isArray(args.origin)) proxy.origin = roundedVector(args.origin);
  if (Array.isArray(args.dimensions)) proxy.dimensions = roundedVector(args.dimensions.map((value) => Math.max(0.001, value)));
  if (typeof args.enabled === "boolean") proxy.enabled = args.enabled;
  state.selectedLinkId = link.id;
  state.selectedProxyId = proxy.id;
  updateDesignTimestamp();
  renderAll();
  return `${proxy.id} updated.`;
}

function addWorkbenchProxy(args) {
  const link = workbenchLinkById(args.linkId);
  const proxy = proxyShapeFromBounds(link.id, getLinkBounds(link, state.partRecords), args.type ?? "box", null, link.collisionProxies);
  link.collisionProxies.push(proxy);
  state.selectedLinkId = link.id;
  state.selectedProxyId = proxy.id;
  updateDesignTimestamp();
  renderAll();
  return `${proxy.id} added.`;
}

function resetWorkbenchProxy(args) {
  const link = workbenchLinkById(args.linkId);
  const proxy = workbenchProxyById(link, args.proxyId);
  const reset = proxyShapeFromBounds(link.id, getLinkBounds(link, state.partRecords), proxy.type, proxy.id);
  proxy.origin = reset.origin;
  proxy.dimensions = reset.dimensions;
  proxy.enabled = true;
  state.selectedLinkId = link.id;
  state.selectedProxyId = proxy.id;
  updateDesignTimestamp();
  renderAll();
  return `${proxy.id} reset from link bounds.`;
}

function deleteWorkbenchProxy(args = {}) {
  const link = workbenchLinkById(args.linkId);
  const proxy = workbenchProxyById(link, args.proxyId);
  link.collisionProxies = link.collisionProxies.filter((item) => item.id !== proxy.id);
  state.selectedLinkId = link.id;
  state.selectedProxyId = link.collisionProxies[0]?.id ?? null;
  updateDesignTimestamp();
  renderAll();
  return `${proxy.id} deleted.`;
}

function setWorkbenchEffector(args) {
  const effector = workbenchEffectorById(args.effectorId);
  if (typeof args.name === "string" && args.name.trim()) effector.name = args.name.trim();
  if (args.linkId) {
    workbenchLinkById(args.linkId);
    effector.linkId = args.linkId;
  }
  if (Array.isArray(args.position)) effector.toolFrame.position = roundedVector(args.position);
  if (Array.isArray(args.rotation)) effector.toolFrame.rotation = roundedVector(args.rotation);
  state.selectedEffectorId = effector.id;
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
  return `${effector.name} updated.`;
}

function addWorkbenchEffector(args) {
  const link = workbenchLinkById(args.linkId || state.selectedLinkId);
  const name = args.name?.trim() || "Tool";
  const id = uniqueDesignId(name, "tool", new Set(state.design.endEffectors.map((item) => item.id)));
  state.design.endEffectors.push({
    id,
    name,
    linkId: link.id,
    toolFrame: {
      position: roundedVector(args.position ?? [0, 0, 0]),
      rotation: roundedVector(args.rotation ?? [0, 0, 0])
    }
  });
  state.selectedEffectorId = id;
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
  return `${name} added.`;
}

function deleteWorkbenchEffector(args = {}) {
  const effector = workbenchEffectorById(args.effectorId);
  state.design.endEffectors = state.design.endEffectors.filter((item) => item.id !== effector.id);
  state.selectedEffectorId = state.design.endEffectors[0]?.id ?? null;
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
  return `${effector.name} deleted.`;
}

function upsertWorkbenchJoint(args, forceNew = false) {
  const selected = forceNew ? null : (args.jointId ? workbenchJointById(args.jointId) : selectedJoint());
  const name = args.name?.trim() || selected?.name || "Joint";
  const id = selected && !forceNew
    ? selected.id
    : uniqueDesignId(name, "joint", new Set(state.design.joints.map((item) => item.id)));
  const parentLinkId = args.parentLinkId ?? selected?.parentLinkId;
  const childLinkId = args.childLinkId ?? selected?.childLinkId;
  if (!parentLinkId || !childLinkId || parentLinkId === childLinkId) {
    throw new Error("Joint parent and child links must be different.");
  }
  workbenchLinkById(parentLinkId);
  workbenchLinkById(childLinkId);
  const previousPair = selected && !forceNew ? adjacentJointPair(selected) : null;
  const joint = {
    id,
    name,
    type: args.type ?? selected?.type ?? "revolute",
    parentLinkId,
    childLinkId,
    origin: roundedVector(args.origin ?? selected?.origin ?? [0, 0, 0]),
    axis: roundedVector(args.axis ?? selected?.axis ?? [0, 0, 1]),
    min: finiteNumber(args.min, selected?.min ?? -90),
    max: finiteNumber(args.max, selected?.max ?? 90),
    damping: Math.max(0, finiteNumber(args.damping, selected?.damping ?? 0.15)),
    friction: Math.max(0, finiteNumber(args.friction, selected?.friction ?? 0.05)),
    actuatorId: args.actuatorId === "none" ? null : (args.actuatorId ?? selected?.actuatorId ?? null)
  };
  const index = state.design.joints.findIndex((item) => item.id === id);
  if (index >= 0) state.design.joints[index] = joint;
  else state.design.joints.push(joint);
  state.design.pose.jointAngles[joint.id] ??= 0;
  state.selectedJointId = joint.id;
  const allowedPair = adjacentJointPair(joint);
  state.design.allowedCollisions ??= [];
  if (previousPair && previousPair !== allowedPair) pruneUnusedAdjacentCollisionPair(previousPair, joint.id);
  if (!state.design.allowedCollisions.includes(allowedPair)) state.design.allowedCollisions.push(allowedPair);
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
  return `${joint.name} ${forceNew || index < 0 ? "added" : "updated"}.`;
}

function solveWorkbenchIk() {
  const effector = selectedEffector();
  if (!effector) throw new Error("No end effector is selected.");
  state.ikResult = solveIKCCD(state.design, effector.id, state.ikTarget);
  state.design.pose.jointAngles = { ...state.design.pose.jointAngles, ...state.ikResult.jointAngles };
  updateDesignTimestamp();
  renderAll();
  return state.ikResult.ok
    ? `IK solved with ${formatNumber(state.ikResult.errorMm, 2)} mm error.`
    : `IK did not solve: ${state.ikResult.reason}`;
}

function applySemanticChannelCommand(channelId, value) {
  requireWorkbenchReady();
  const result = resolveFirmwareChannelCommand({
    robotDesign: state.design,
    circuitLabProject: state.currentCircuitLabProject,
    mechatronicsBinding: state.currentMechatronicsBinding,
    channelId,
    value
  });
  state.semanticCommand = {
    channelId,
    value,
    status: result.ok ? "resolved" : "blocked",
    message: result.ok
      ? `Resolved ${channelId}.`
      : `Semantic channel blocked: ${result.reason}${result.diagnostics?.length ? ` (${result.diagnostics.map((item) => item.code).join(", ")})` : ""}.`
  };
  if (!result.ok) {
    renderAll();
    return state.semanticCommand.message;
  }
  if (result.type === "joint-command" && result.command === "position") {
    const joint = state.design.joints.find((item) => item.id === result.jointId);
    if (!joint) throw new Error(`Unknown joint id: ${result.jointId}`);
    state.design.pose.jointAngles = {
      ...state.design.pose.jointAngles,
      [joint.id]: result.value
    };
    state.ikResult = null;
    state.selectedJointId = joint.id;
    state.semanticCommand = {
      channelId,
      value,
      status: "applied",
      message: `${channelId} set ${joint.name} to ${formatNumber(result.value, 1)} degrees. Simulation was invalidated.`
    };
    updateDesignTimestamp();
    renderAll();
    return state.semanticCommand.message;
  }
  if (result.type === "sensor-expectation") {
    state.semanticCommand = {
      channelId,
      value,
      status: "resolved",
      message: `${channelId} expects ${result.measurement} on sensor ${result.sensorId}: ${result.expectedValue}.`
    };
    renderAll();
    return state.semanticCommand.message;
  }
  state.semanticCommand = {
    channelId,
    value,
    status: "unsupported",
    message: `${channelId} resolved to ${result.type}; V1 only applies position joint commands to the virtual pose.`
  };
  renderAll();
  return state.semanticCommand.message;
}

function applySemanticChannelFromControls() {
  const channelId = modeControls.querySelector("#semantic-channel-select")?.value ?? "";
  const value = finiteNumber(modeControls.querySelector("#semantic-channel-value")?.value, state.semanticCommand.value);
  const message = applySemanticChannelCommand(channelId, value);
  showStatus(message, 6200);
}

function upsertWorkbenchActuator(args) {
  const existing = args.actuatorId ? workbenchActuatorById(args.actuatorId) : selectedActuator();
  const name = args.name?.trim() || existing?.name || "Custom actuator";
  const actuator = upsertActuator(state.design, {
    id: existing?.id ?? sanitizeId(name, "custom_actuator"),
    name,
    continuousTorqueNm: args.continuousTorqueNm ?? existing?.continuousTorqueNm ?? 1,
    peakTorqueNm: args.peakTorqueNm ?? existing?.peakTorqueNm ?? 1.5,
    maxSpeedDegS: args.maxSpeedDegS ?? existing?.maxSpeedDegS ?? 180,
    voltage: args.voltage ?? existing?.voltage ?? 12,
    massKg: args.massKg ?? existing?.massKg ?? 0.1,
    gearRatio: args.gearRatio ?? existing?.gearRatio ?? 1,
    efficiency: args.efficiency ?? existing?.efficiency ?? 0.7,
    notes: args.notes ?? existing?.notes ?? ""
  });
  state.selectedActuatorId = actuator.id;
  updateDesignTimestamp();
  renderAll();
  return `${actuator.name} saved.`;
}

function mountWorkbenchAssistant() {
  const assistant = mountPageAssistant({
    pageId: "workbench",
    title: "Robotics Workbench",
    getContext: workbenchAssistantContext,
    actions: {
      workbench_set_mode: ({ mode }) => {
        requireWorkbenchReady();
        setMode(mode);
        return `Mode set to ${mode}.`;
      },
      workbench_frame_assembly: () => {
        if (state.assemblyRoot) fitCameraToObject(state.assemblyRoot);
        return "Assembly framed in the viewport.";
      },
      workbench_select_link: ({ linkId }) => {
        requireWorkbenchReady();
        const link = workbenchLinkById(linkId);
        state.selectedLinkId = link.id;
        state.selectedProxyId = link.collisionProxies[0]?.id ?? null;
        renderAll();
        return `${link.name} selected.`;
      },
      workbench_select_joint: ({ jointId }) => {
        requireWorkbenchReady();
        const joint = workbenchJointById(jointId);
        state.selectedJointId = joint.id;
        renderAll();
        return `${joint.name} selected.`;
      },
      workbench_select_proxy: ({ linkId, proxyId }) => {
        requireWorkbenchReady();
        const link = workbenchLinkById(linkId);
        const proxy = workbenchProxyById(link, proxyId);
        state.selectedLinkId = link.id;
        state.selectedProxyId = proxy.id;
        renderAll();
        return `${proxy.id} selected.`;
      },
      workbench_select_effector: ({ effectorId }) => {
        requireWorkbenchReady();
        const effector = workbenchEffectorById(effectorId);
        state.selectedEffectorId = effector.id;
        renderAll();
        return `${effector.name} selected.`;
      },
      workbench_select_actuator: ({ actuatorId }) => {
        requireWorkbenchReady();
        const actuator = workbenchActuatorById(actuatorId);
        state.selectedActuatorId = actuator.id;
        renderAll();
        return `${actuator.name} selected.`;
      },
      workbench_set_link_properties: (args) => {
        requireWorkbenchReady();
        return setWorkbenchLinkProperties(args);
      },
      workbench_estimate_link_mass_com: ({ linkId }) => {
        requireWorkbenchReady();
        return estimateWorkbenchLinkMassCom(linkId);
      },
      workbench_set_proxy: (args) => {
        requireWorkbenchReady();
        return setWorkbenchProxy(args);
      },
      workbench_add_proxy: (args) => {
        requireWorkbenchReady();
        return addWorkbenchProxy(args);
      },
      workbench_reset_proxy_from_bounds: (args) => {
        requireWorkbenchReady();
        return resetWorkbenchProxy(args);
      },
      workbench_set_effector: (args) => {
        requireWorkbenchReady();
        return setWorkbenchEffector(args);
      },
      workbench_add_effector: (args) => {
        requireWorkbenchReady();
        return addWorkbenchEffector(args);
      },
      workbench_set_joint: (args) => {
        requireWorkbenchReady();
        return upsertWorkbenchJoint(args, false);
      },
      workbench_add_joint: (args) => {
        requireWorkbenchReady();
        return upsertWorkbenchJoint(args, true);
      },
      workbench_set_ik_target: ({ effectorId, target }) => {
        requireWorkbenchReady();
        if (effectorId) state.selectedEffectorId = workbenchEffectorById(effectorId).id;
        state.ikTarget = roundedVector(target);
        state.ikResult = null;
        scheduleDesignHistoryCommit();
        renderAll();
        return `IK target set to ${formatVector(state.ikTarget, 1)} mm.`;
      },
      workbench_solve_ik: () => {
        requireWorkbenchReady();
        return solveWorkbenchIk();
      },
      workbench_reset_chain_pose: () => {
        requireWorkbenchReady();
        resetCurrentChainPose();
        return "Selected tool chain pose reset.";
      },
      workbench_assign_actuator: ({ jointId, actuatorId }) => {
        requireWorkbenchReady();
        const joint = workbenchJointById(jointId);
        joint.actuatorId = actuatorId === "none" ? null : actuatorId;
        state.selectedJointId = joint.id;
        updateDesignTimestamp();
        renderAll();
        return `${joint.name} actuator ${joint.actuatorId ? "assigned" : "cleared"}.`;
      },
      workbench_upsert_actuator: (args) => {
        requireWorkbenchReady();
        return upsertWorkbenchActuator(args);
      },
      workbench_allow_collision_pair: ({ pair, linkA, linkB }) => {
        requireWorkbenchReady();
        const nextPair = pair || (linkA && linkB ? collisionPairKey(linkA, linkB) : null);
        if (!nextPair) throw new Error("Provide pair or linkA/linkB.");
        allowCollisionPair(nextPair);
        return `${nextPair} allowed.`;
      },
      workbench_remove_allowed_collision_pair: ({ pair }) => {
        requireWorkbenchReady();
        removeAllowedCollisionPair(pair);
        return `${pair} removed from allowed collision pairs.`;
      },
      workbench_run_audit: () => {
        requireWorkbenchReady();
        renderAll();
        return "Audit refreshed.";
      },
      workbench_get_mechatronics_readiness: () => {
        requireWorkbenchReady();
        const readiness = refreshMechatronicsReadiness();
        return {
          ok: true,
          message: `Mechatronics readiness is ${readiness.overallStatus}.`,
          data: readiness
        };
      },
      workbench_apply_semantic_channel: ({ channelId, value }) => {
        requireWorkbenchReady();
        const message = applySemanticChannelCommand(channelId, value);
        showStatus(message, 6200);
        return {
          ok: state.semanticCommand.status === "applied" || state.semanticCommand.status === "resolved",
          message,
          data: state.semanticCommand
        };
      },
      workbench_set_simulation_options: ({ gravityEnabled, timestep }) => {
        requireWorkbenchReady();
        const wasReady = dynamics.status().ready;
        if (typeof gravityEnabled === "boolean") state.simulation.gravityEnabled = gravityEnabled;
        if (timestep !== undefined) {
          state.simulation.timestep = Math.min(1 / 15, Math.max(1 / 240, finiteNumber(timestep, state.simulation.timestep)));
        }
        if (wasReady) invalidateSimulation("Simulation options changed; initialize again.");
        renderAll();
        return "Simulation options updated.";
      },
      workbench_initialize_simulation: async () => {
        requireWorkbenchReady();
        await resetSimulation();
        return "Simulation initialized.";
      },
      workbench_step_simulation: async () => {
        requireWorkbenchReady();
        await stepSimulation();
        return "Simulation stepped.";
      },
      workbench_delete_proxy: (args) => {
        requireWorkbenchReady();
        return deleteWorkbenchProxy(args);
      },
      workbench_delete_effector: (args) => {
        requireWorkbenchReady();
        return deleteWorkbenchEffector(args);
      },
      workbench_delete_actuator: ({ actuatorId }) => {
        requireWorkbenchReady();
        removeSelectedActuator(actuatorId || selectedActuator()?.id);
        return "Actuator deleted.";
      },
      workbench_save_design: async () => {
        requireWorkbenchReady();
        await saveCurrentDesign();
        return "RobotDesign saved.";
      },
      workbench_import_design_picker: () => {
        designFileInput.click();
        return "RobotDesign import file picker opened.";
      },
      workbench_export_design_json: () => {
        downloadText(serializeRobotDesign(state.design), "robot-design.json", "application/json");
        return "RobotDesign JSON download started.";
      },
      workbench_export_urdf: () => {
        return downloadUrdfIfReady()
          ? "URDF download started."
          : "URDF export is blocked; review the Export findings.";
      },
      workbench_toggle_simulation_run: async () => {
        requireWorkbenchReady();
        await toggleSimulation();
        return "Simulation run state toggled.";
      }
    }
  });
  mountAssistantEvalPanel({ adapter: assistant.adapter });
  return assistant;
}

function checkedValues(selector) {
  return [...modeControls.querySelectorAll(`${selector}:checked`)].map((input) => input.value);
}

function applyLinkChanges() {
  const link = selectedLink();
  if (!link) return;
  state.selectedDensityId = modeControls.querySelector("#density-preset")?.value ?? state.selectedDensityId;
  link.name = modeControls.querySelector("#link-name")?.value || link.name;
  link.massKg = Math.max(0, finiteNumber(modeControls.querySelector("#link-mass")?.value, link.massKg));
  link.com = [
    finiteNumber(modeControls.querySelector("#link-com-x")?.value, link.com[0]),
    finiteNumber(modeControls.querySelector("#link-com-y")?.value, link.com[1]),
    finiteNumber(modeControls.querySelector("#link-com-z")?.value, link.com[2])
  ];
  const checked = [...new Set([...checkedValues(".part-assignment"), ...checkedValues(".unassigned-part"), ...checkedValues(".reassigned-part")])];
  for (const other of state.design.links) {
    if (other.id !== link.id) other.partIds = other.partIds.filter((partId) => !checked.includes(partId));
  }
  link.partIds = checked;
  updateDesignTimestamp();
  renderAll();
}

function estimateSelectedLinkMassCom() {
  const link = selectedLink();
  if (!link) return;
  state.selectedDensityId = modeControls.querySelector("#density-preset")?.value ?? state.selectedDensityId;
  const bounds = getLinkBounds(link, state.partRecords);
  const massKg = estimateMassFromBounds(bounds, densityPreset().densityKgM3);
  link.massKg = massKg;
  link.com = roundedVector(bounds.center);
  link.inertia = estimateInertiaFromBounds(massKg, bounds);
  updateDesignTimestamp();
  renderAll();
}

function addLink() {
  state.selectedDensityId = modeControls.querySelector("#density-preset")?.value ?? state.selectedDensityId;
  const partIds = checkedValues(".new-link-part");
  if (!partIds.length) {
    showStatus("Select at least one unassigned part for the new link");
    return;
  }
  const firstPart = state.partRecords.find((item) => item.id === partIds[0]);
  const name = modeControls.querySelector("#new-link-name")?.value || firstPart?.name || "New link";
  const id = uniqueDesignId(name, "link", new Set(state.design.links.map((item) => item.id)));
  const bounds = getLinkBounds({ partIds }, state.partRecords);
  for (const other of state.design.links) {
    other.partIds = other.partIds.filter((partId) => !partIds.includes(partId));
  }
  const massKg = estimateMassFromBounds(bounds);
  state.design.links.push({
    id,
    name,
    partIds,
    massKg,
    com: roundedVector(bounds.center),
    inertia: estimateInertiaFromBounds(massKg, bounds),
    collisionProxies: [proxyShapeFromBounds(id, bounds)]
  });
  state.selectedLinkId = id;
  state.selectedProxyId = state.design.links.at(-1)?.collisionProxies[0]?.id ?? null;
  updateDesignTimestamp();
  renderAll();
}

function applyProxyChanges() {
  const proxy = selectedProxy();
  if (!proxy) return;
  const type = modeControls.querySelector("#proxy-type")?.value ?? "box";
  const radius = Math.max(0.001, finiteNumber(modeControls.querySelector("#proxy-radius")?.value, 10));
  const length = Math.max(0.001, finiteNumber(modeControls.querySelector("#proxy-length")?.value, 10));
  proxy.type = type;
  proxy.origin = [
    finiteNumber(modeControls.querySelector("#proxy-origin-x")?.value, proxy.origin?.[0] ?? 0),
    finiteNumber(modeControls.querySelector("#proxy-origin-y")?.value, proxy.origin?.[1] ?? 0),
    finiteNumber(modeControls.querySelector("#proxy-origin-z")?.value, proxy.origin?.[2] ?? 0)
  ];
  proxy.dimensions = type === "box"
    ? [
        Math.max(0.001, finiteNumber(modeControls.querySelector("#proxy-dim-x")?.value, 10)),
        Math.max(0.001, finiteNumber(modeControls.querySelector("#proxy-dim-y")?.value, 10)),
        Math.max(0.001, finiteNumber(modeControls.querySelector("#proxy-dim-z")?.value, 10))
      ]
    : [radius, type === "sphere" ? radius : length, radius];
  proxy.enabled = modeControls.querySelector("#proxy-enabled")?.checked !== false;
  updateDesignTimestamp();
  renderAll();
}

function addProxy() {
  const link = selectedLink();
  if (!link) return;
  const type = modeControls.querySelector("#proxy-type")?.value ?? "box";
  const proxy = proxyShapeFromBounds(link.id, getLinkBounds(link, state.partRecords), type, null, link.collisionProxies);
  link.collisionProxies.push(proxy);
  state.selectedProxyId = proxy.id;
  updateDesignTimestamp();
  renderAll();
}

function resetProxyFromBounds() {
  const link = selectedLink();
  const proxy = selectedProxy();
  if (!link || !proxy) return;
  const reset = proxyShapeFromBounds(link.id, getLinkBounds(link, state.partRecords), proxy.type, proxy.id);
  proxy.origin = reset.origin;
  proxy.dimensions = reset.dimensions;
  proxy.enabled = true;
  updateDesignTimestamp();
  renderAll();
}

function deleteProxy() {
  const link = selectedLink();
  const proxy = selectedProxy();
  if (!link || !proxy) return;
  link.collisionProxies = link.collisionProxies.filter((item) => item.id !== proxy.id);
  state.selectedProxyId = link.collisionProxies[0]?.id ?? null;
  updateDesignTimestamp();
  renderAll();
}

function readEffectorFromForm(id) {
  return {
    id,
    name: modeControls.querySelector("#effector-name")?.value || "Tool",
    linkId: modeControls.querySelector("#effector-link")?.value ?? state.design.links[0]?.id,
    toolFrame: {
      position: [
        finiteNumber(modeControls.querySelector("#effector-pos-x")?.value, 0),
        finiteNumber(modeControls.querySelector("#effector-pos-y")?.value, 0),
        finiteNumber(modeControls.querySelector("#effector-pos-z")?.value, 0)
      ],
      rotation: [
        finiteNumber(modeControls.querySelector("#effector-rot-x")?.value, 0),
        finiteNumber(modeControls.querySelector("#effector-rot-y")?.value, 0),
        finiteNumber(modeControls.querySelector("#effector-rot-z")?.value, 0)
      ]
    }
  };
}

function applyEffectorChanges() {
  const effector = selectedEffector();
  if (!effector) return addEffector();
  Object.assign(effector, readEffectorFromForm(effector.id));
  state.selectedEffectorId = effector.id;
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
}

function addEffector() {
  if (!state.design.links.length) return;
  const name = modeControls.querySelector("#effector-name")?.value || "Tool";
  const id = uniqueDesignId(name, "tool", new Set(state.design.endEffectors.map((item) => item.id)));
  const effector = readEffectorFromForm(id);
  state.design.endEffectors.push(effector);
  state.selectedEffectorId = effector.id;
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
}

function deleteEffector() {
  const effector = selectedEffector();
  if (!effector) return;
  state.design.endEffectors = state.design.endEffectors.filter((item) => item.id !== effector.id);
  state.selectedEffectorId = state.design.endEffectors[0]?.id ?? null;
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
}

function adjacentJointPair(joint) {
  return collisionPairKey(joint.parentLinkId, joint.childLinkId);
}

function pruneUnusedAdjacentCollisionPair(pair, activeJointId) {
  if (!pair) return;
  const stillUsed = state.design.joints.some((joint) => joint.id !== activeJointId && adjacentJointPair(joint) === pair);
  if (!stillUsed) {
    state.design.allowedCollisions = (state.design.allowedCollisions ?? []).filter((item) => item !== pair);
  }
}

function applyJointChanges(forceNew = false) {
  const name = modeControls.querySelector("#joint-name")?.value || "Joint";
  const selected = selectedJoint();
  const id = forceNew || !selected ? uniqueDesignId(name, "joint", new Set(state.design.joints.map((item) => item.id))) : selected.id;
  const previousPair = !forceNew && selected ? adjacentJointPair(selected) : null;
  const parentLinkId = modeControls.querySelector("#joint-parent")?.value;
  const childLinkId = modeControls.querySelector("#joint-child")?.value;
  if (!parentLinkId || !childLinkId || parentLinkId === childLinkId) {
    showStatus("Joint parent and child links must be different");
    return;
  }
  const joint = {
    id,
    name,
    type: modeControls.querySelector("#joint-type")?.value ?? "revolute",
    parentLinkId,
    childLinkId,
    origin: [
      finiteNumber(modeControls.querySelector("#joint-origin-x")?.value, 0),
      finiteNumber(modeControls.querySelector("#joint-origin-y")?.value, 0),
      finiteNumber(modeControls.querySelector("#joint-origin-z")?.value, 0)
    ],
    axis: [
      finiteNumber(modeControls.querySelector("#joint-axis-x")?.value, 0),
      finiteNumber(modeControls.querySelector("#joint-axis-y")?.value, 0),
      finiteNumber(modeControls.querySelector("#joint-axis-z")?.value, 1)
    ],
    min: finiteNumber(modeControls.querySelector("#joint-min")?.value, -90),
    max: finiteNumber(modeControls.querySelector("#joint-max")?.value, 90),
    damping: Math.max(0, finiteNumber(modeControls.querySelector("#joint-damping")?.value, 0.15)),
    friction: Math.max(0, finiteNumber(modeControls.querySelector("#joint-friction")?.value, 0.05)),
    actuatorId: modeControls.querySelector("#joint-actuator")?.value || null
  };
  const index = state.design.joints.findIndex((item) => item.id === id);
  if (index >= 0) state.design.joints[index] = joint;
  else state.design.joints.push(joint);
  state.design.pose.jointAngles[joint.id] ??= 0;
  state.selectedJointId = joint.id;
  const allowedPair = adjacentJointPair(joint);
  state.design.allowedCollisions ??= [];
  if (previousPair && previousPair !== allowedPair) pruneUnusedAdjacentCollisionPair(previousPair, joint.id);
  if (!state.design.allowedCollisions.includes(allowedPair)) state.design.allowedCollisions.push(allowedPair);
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
}

function solveIkFromInputs() {
  state.selectedEffectorId = modeControls.querySelector("#ik-effector")?.value ?? selectedEffector()?.id;
  state.ikTarget = [
    finiteNumber(modeControls.querySelector("#ik-target-x")?.value, state.ikTarget[0]),
    finiteNumber(modeControls.querySelector("#ik-target-y")?.value, state.ikTarget[1]),
    finiteNumber(modeControls.querySelector("#ik-target-z")?.value, state.ikTarget[2])
  ];
  state.ikResult = solveIKCCD(state.design, state.selectedEffectorId, state.ikTarget);
  state.design.pose.jointAngles = { ...state.design.pose.jointAngles, ...state.ikResult.jointAngles };
  updateDesignTimestamp();
  renderAll();
}

function resetCurrentChainPose() {
  const effector = selectedEffector();
  if (!effector) return;
  const chain = findJointChainToLink(state.design, effector.linkId);
  for (const joint of chain) {
    state.design.pose.jointAngles[joint.id] = 0;
  }
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
}

function allowCollisionPair(pair) {
  if (!pair) return;
  state.design.allowedCollisions ??= [];
  if (!state.design.allowedCollisions.includes(pair)) state.design.allowedCollisions.push(pair);
  updateDesignTimestamp();
  renderAll();
}

function removeAllowedCollisionPair(pair) {
  if (!pair) return;
  state.design.allowedCollisions = (state.design.allowedCollisions ?? []).filter((item) => item !== pair);
  updateDesignTimestamp();
  renderAll();
}

function assignActuator() {
  const jointId = modeControls.querySelector("#actuator-joint")?.value;
  const actuatorId = modeControls.querySelector("#actuator-assignment")?.value;
  const joint = state.design.joints.find((item) => item.id === jointId);
  if (joint) {
    joint.actuatorId = actuatorId || null;
    state.selectedJointId = joint.id;
    updateDesignTimestamp();
  }
  renderAll();
}

function readActuatorForm(forceNew = false) {
  const selected = selectedActuator();
  const name = modeControls.querySelector("#actuator-name")?.value || "Custom actuator";
  const existingIds = new Set(state.design.actuators.map((item) => item.id));
  if (!forceNew && selected) existingIds.delete(selected.id);
  const id = forceNew || !selected
    ? uniqueDesignId(name, "actuator", existingIds)
    : selected.id;
  return {
    id,
    name,
    continuousTorqueNm: modeControls.querySelector("#actuator-cont")?.value,
    peakTorqueNm: modeControls.querySelector("#actuator-peak")?.value,
    maxSpeedDegS: modeControls.querySelector("#actuator-speed")?.value,
    voltage: modeControls.querySelector("#actuator-voltage")?.value,
    massKg: modeControls.querySelector("#actuator-mass")?.value,
    gearRatio: modeControls.querySelector("#actuator-gear")?.value,
    efficiency: modeControls.querySelector("#actuator-efficiency")?.value,
    notes: modeControls.querySelector("#actuator-notes")?.value ?? ""
  };
}

function saveActuator(forceNew = false) {
  const formActuator = readActuatorForm(forceNew);
  const actuator = upsertActuator(state.design, {
    ...formActuator,
    id: sanitizeId(formActuator.id, "custom_actuator")
  });
  state.selectedActuatorId = actuator.id;
  updateDesignTimestamp();
  renderAll();
}

function removeSelectedActuator(actuatorId = selectedActuator()?.id) {
  if (!actuatorId) return;
  if (deleteActuator(state.design, actuatorId)) {
    state.selectedActuatorId = state.design.actuators[0]?.id ?? null;
    updateDesignTimestamp();
  }
  renderAll();
}

async function resetSimulation() {
  if (state.simulation.status === "initializing") return;
  const options = readSimulationOptions();
  stopSimulationTimer();
  setSimulationStatus("initializing", "Loading Rapier and rebuilding proxy bodies.");
  renderViewportReadout();
  if (state.mode === "simulate") renderSimulateControls();
  try {
    const status = await dynamics.reset(state.design, state.transforms, options);
    setSimulationStatus("initialized", `Initialized ${status.bodies} proxy bodies and ${status.joints} joints.`);
  } catch (error) {
    console.error("Simulation initialization failed", error);
    dynamics.clear();
    setSimulationStatus("failed", error?.message ?? "Simulation failed to initialize.");
  }
  // "initialized" is not a simulation-driven pose state; renderAll restores the editable FK pose.
  renderAll();
}

async function stepSimulation() {
  if (state.simulation.status === "running") stopSimulationTimer();
  if (!dynamics.status().ready) await resetSimulation();
  if (!dynamics.status().ready) return;
  dynamics.step(1);
  setSimulationStatus("stepped", `Advanced one timestep to ${dynamics.status().steps} step(s).`);
  applySimulationPoseToMeshes({ updateOverlays: true });
  renderAll();
}

async function toggleSimulation() {
  if (state.simulation.status === "running") {
    stopSimulationTimer();
    setSimulationStatus("paused", `Paused at ${dynamics.status().steps} step(s).`);
    renderAll();
    return;
  }
  if (!dynamics.status().ready) await resetSimulation();
  if (!dynamics.status().ready) return;
  setSimulationStatus("running", "Simulation is running.");
  if (!state.simTimer) {
    state.simTimer = window.setInterval(() => {
      if (state.simulation.status !== "running") return;
      dynamics.step(1);
      state.simulation.message = `Running at ${dynamics.status().steps} step(s).`;
      applySimulationPoseToMeshes({ updateOverlays: dynamics.status().steps % 10 === 0 });
      renderViewportReadout();
      if (state.mode === "simulate" && dynamics.status().steps % 10 === 0) renderSimulateControls();
    }, 1000 / 30);
  }
  renderAll();
}

async function saveCurrentDesign() {
  syncAcademicMetadata();
  await saveRobotDesign(state.design);
  showStatus("RobotDesign saved");
}

function importDesignFile(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      flushDesignHistoryCommit();
      state.design = normalizeRobotDesign(parsed, state.partRecords);
      state.selectedLinkId = state.design.links[0]?.id ?? null;
      state.selectedJointId = state.design.joints[0]?.id ?? null;
      state.selectedProxyId = state.design.links[0]?.collisionProxies[0]?.id ?? null;
      state.selectedEffectorId = state.design.endEffectors[0]?.id ?? null;
      state.selectedActuatorId = state.design.actuators[0]?.id ?? null;
      invalidateSimulation("RobotDesign imported; initialize simulation when ready.");
      showStatus("RobotDesign imported");
      renderAll();
      commitDesignHistoryNow();
    } catch (error) {
      console.error(error);
      showStatus("Unable to import RobotDesign");
    }
  });
  reader.readAsText(file);
}

function downloadUrdfIfReady() {
  requireWorkbenchReady();
  const urdf = createUrdfExport(state.design, state.partRecords);
  state.analysis = { ...(state.analysis ?? {}), urdf };
  if (!urdf.ready) {
    renderAll();
    const blockers = urdf.issues.filter((item) => item.level === "risk").length;
    showStatus(`URDF export blocked by ${blockers} issue${blockers === 1 ? "" : "s"}`, 5200);
    return false;
  }
  downloadText(urdf.xml, "robot-design.urdf", "application/xml");
  const warnings = urdf.issues.filter((item) => item.level === "warn").length;
  showStatus(warnings ? `URDF download started with ${warnings} warning${warnings === 1 ? "" : "s"}` : "URDF download started", 5200);
  return true;
}

function showUrdfExportFlow() {
  requireWorkbenchReady();
  renderAll();
  const urdf = state.analysis?.urdf ?? createUrdfExport(state.design, state.partRecords);
  const blockers = urdf.issues.filter((item) => item.level === "risk").length;
  const warnings = urdf.issues.filter((item) => item.level === "warn").length;
  if (blockers) {
    showStatus(`URDF export has ${blockers} blocker${blockers === 1 ? "" : "s"}; review Analysis or Audit.`, 5600);
  } else if (warnings) {
    showStatus(`URDF export ready with ${warnings} warning${warnings === 1 ? "" : "s"}. Use Download URDF in Analysis.`, 5600);
  } else {
    showStatus("URDF export ready. Use Download URDF in Analysis.", 4800);
  }
}

function captureExperimentRun() {
  requireWorkbenchReady();
  flushDesignHistoryCommit();
  const status = dynamics.status();
  const run = createExperimentRun({
    design: state.design,
    transforms: state.transforms,
    analysis: state.analysis,
    ikResult: state.ikResult,
    simulation: {
      status: state.simulation.status,
      steps: status.steps,
      timestep: state.simulation.timestep,
      gravityEnabled: state.simulation.gravityEnabled
    },
    runIndex: state.experimentRuns.length,
    label: `Run ${state.experimentRuns.length + 1}`
  });
  state.experimentRuns.push(run);
  refreshLabCheckpoints();
  syncAcademicMetadata();
  showStatus(`${run.label} captured for lab evidence`);
  renderAll();
  commitDesignHistoryNow();
}

function exportExperimentRunsCsv() {
  if (!state.experimentRuns.length) {
    showStatus("Capture an experiment run before exporting CSV.");
    return;
  }
  downloadText(serializeExperimentRunsCsv(state.experimentRuns), "robostudio-experiment-runs.csv", "text/csv");
  showStatus("Experiment CSV download started");
}

function labReportInput() {
  const manifest = currentAssetManifest();
  const checkpointResults = state.labCheckpointResults.length ? state.labCheckpointResults : refreshLabCheckpoints();
  return {
    labSpec: state.labSpec,
    checkpointResults,
    experimentRuns: state.experimentRuns,
    design: designWithAcademicMetadata(checkpointResults),
    analysis: state.analysis,
    manifest
  };
}

function exportLabReportHtml() {
  downloadText(createLabReportHtml(labReportInput()), "robostudio-lab-report.html", "text/html");
  showStatus("Lab report HTML download started");
}

function exportLabReportJson() {
  downloadText(JSON.stringify(createLabReportJson(labReportInput()), null, 2), "robostudio-lab-report.json", "application/json");
  showStatus("Lab report JSON download started");
}

function runPidDemo() {
  flushDesignHistoryCommit();
  const firstMovableJoint = state.design.joints.find((joint) => joint.type !== "fixed");
  const initial = firstMovableJoint ? getJointAngle(state.design, firstMovableJoint.id) : 0;
  const target = firstMovableJoint ? Math.min(firstMovableJoint.max, Math.max(firstMovableJoint.min, initial + 45)) : 45;
  state.pidResponse = simulatePidResponse({ initial, target, durationS: 2, dt: 0.02, kp: 8, kd: 1.2 });
  state.design.controllers = [
    ...(state.design.controllers ?? []).filter((controller) => controller.id !== "lab_pid_demo"),
    {
      id: "lab_pid_demo",
      name: "Lab PID demo",
      type: "pid",
      jointId: firstMovableJoint?.id ?? null,
      gains: state.pidResponse.options,
      metrics: state.pidResponse.metrics
    }
  ];
  syncAcademicMetadata();
  showStatus("PID response demo captured");
  renderAll();
  commitDesignHistoryNow();
}

function exportProjectJson() {
  const project = currentRoboStudioProject();
  downloadText(serializeRoboStudioProject(project), "robostudio-project.robostudio.json", "application/json");
  showStatus("RoboStudio project JSON download started");
}

async function collectProjectBundleAssets(project) {
  const assets = [];
  if (state.currentSnapshot?.glb) {
    assets.push({ path: "assets/current-assembly.glb", data: state.currentSnapshot.glb });
  }
  const fileNames = new Set(
    (project.manifest?.assets ?? [])
      .filter((asset) => asset.fileName && asset.availability === "available")
      .map((asset) => asset.fileName)
  );
  for (const fileName of fileNames) {
    try {
      const response = await fetch(assetUrlForFile(fileName));
      if (!response.ok) continue;
      assets.push({ path: `assets/${fileName}`, data: await response.arrayBuffer() });
    } catch {
      // Imported user files are not always fetchable from the app origin; the manifest keeps that limitation visible.
    }
  }
  return assets;
}

async function exportProjectZip() {
  const project = currentRoboStudioProject();
  const preflight = projectBundlePreflight(project);
  if (!preflight.ready) {
    showStatus("Project ZIP is blocked by missing required assets.");
    renderAll();
    return;
  }
  const blob = await createRoboStudioProjectZip(project, { assets: await collectProjectBundleAssets(project) });
  downloadBlob(blob, "robostudio-project.robostudio.zip");
  showStatus("RoboStudio project ZIP download started");
}

function setMode(mode) {
  state.mode = mode;
  for (const button of modeButtons) button.classList.toggle("is-active", button.dataset.mode === mode);
  renderAll();
}

function shortcutTargetIsTextEditable(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable === true;
}

function handleDesignHistoryShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || shortcutTargetIsTextEditable(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoDesignHistory();
  } else if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault();
    redoDesignHistory();
  }
}

modeControls.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const toggleButton = target.closest("[data-toggle-card]");
  if (toggleButton instanceof HTMLElement && toggleButton.dataset.toggleCard && modeControls.contains(toggleButton)) {
    toggleCollapsibleCard(toggleButton.dataset.toggleCard, toggleButton.closest(".collapsible-card"));
    return;
  }
  if (target.id === "apply-link") applyLinkChanges();
  if (target.id === "estimate-link-mass") estimateSelectedLinkMassCom();
  if (target.id === "add-link") addLink();
  if (target.id === "apply-joint") applyJointChanges();
  if (target.id === "add-joint") applyJointChanges(true);
  if (target.id === "apply-proxy") applyProxyChanges();
  if (target.id === "add-proxy") addProxy();
  if (target.id === "reset-proxy") resetProxyFromBounds();
  if (target.id === "delete-proxy") deleteProxy();
  if (target.id === "apply-effector") applyEffectorChanges();
  if (target.id === "add-effector") addEffector();
  if (target.id === "delete-effector") deleteEffector();
  if (target.id === "solve-ik") solveIkFromInputs();
  if (target.id === "reset-chain-pose") resetCurrentChainPose();
  if (target.id === "assign-actuator") assignActuator();
  if (target.id === "save-actuator") saveActuator(false);
  if (target.id === "add-actuator") saveActuator(true);
  if (target.id === "delete-actuator") removeSelectedActuator();
  if (target.dataset.selectActuator) {
    state.selectedActuatorId = target.dataset.selectActuator;
    renderAll();
  }
  if (target.dataset.deleteActuator) removeSelectedActuator(target.dataset.deleteActuator);
  if (target.id === "sim-reset-panel") resetSimulation();
  if (target.id === "sim-step-panel") stepSimulation();
  if (target.id === "sim-run-panel") toggleSimulation();
  if (target.id === "audit-now") renderAll();
  if (target.id === "apply-semantic-channel") applySemanticChannelFromControls();
  if (target.id === "run-lab-checkpoints") {
    flushDesignHistoryCommit();
    refreshLabCheckpoints();
    syncAcademicMetadata();
    renderAll();
    commitDesignHistoryNow();
  }
  if (target.id === "capture-experiment-run") captureExperimentRun();
  if (target.id === "export-runs-csv") exportExperimentRunsCsv();
  if (target.id === "export-lab-report") exportLabReportHtml();
  if (target.id === "export-lab-report-json") exportLabReportJson();
  if (target.id === "run-pid-demo") runPidDemo();
  if (target.id === "export-project-json") exportProjectJson();
  if (target.id === "export-project-zip") exportProjectZip().catch((error) => {
    console.error(error);
    showStatus(error.message ?? "Unable to export project ZIP.");
  });
});

modeControls.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id === "sim-timestep") {
    const wasReady = dynamics.status().ready;
    readSimulationOptions();
    if (wasReady) invalidateSimulation("Simulation timestep changed; initialize again.");
    renderViewportReadout();
    return;
  }
  if (!target.classList.contains("joint-angle") || !target.dataset.jointId) return;
  state.design.pose.jointAngles[target.dataset.jointId] = Number(target.value);
  state.ikResult = null;
  updateDesignTimestamp();
  renderAll();
});

modeControls.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === "proxy-select") state.selectedProxyId = target.value;
  else if (target.id === "effector-select") state.selectedEffectorId = target.value;
  else if (target.id === "actuator-joint") state.selectedJointId = target.value;
  else if (target.id === "sim-gravity" || target.id === "sim-motors") {
    const wasReady = dynamics.status().ready;
    readSimulationOptions();
    if (wasReady) invalidateSimulation("Simulation options changed; initialize again.");
  }
  else if (target.id === "ik-effector") {
    state.selectedEffectorId = target.value;
    state.ikResult = null;
  }
  else return;
  renderAll();
});

analysisResults.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const toggleButton = target.closest("[data-toggle-card]");
  if (toggleButton instanceof HTMLElement && toggleButton.dataset.toggleCard && analysisResults.contains(toggleButton)) {
    toggleCollapsibleCard(toggleButton.dataset.toggleCard, toggleButton.closest(".collapsible-card"));
    return;
  }
  if (target.dataset.allowCollision) allowCollisionPair(target.dataset.allowCollision);
  if (target.dataset.removeAllowedCollision) removeAllowedCollisionPair(target.dataset.removeAllowedCollision);
});

robotTree.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.selectLink) {
    state.selectedLinkId = target.dataset.selectLink;
    state.selectedProxyId = selectedLink()?.collisionProxies[0]?.id ?? null;
  }
  if (target.dataset.selectJoint) state.selectedJointId = target.dataset.selectJoint;
  renderAll();
});

for (const button of modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

frameAssemblyButton.addEventListener("click", () => {
  if (state.assemblyRoot) {
    state.assemblyRoot.updateMatrixWorld(true);
    fitCameraToObject(state.assemblyRoot);
  }
});
saveDesignButton.addEventListener("click", saveCurrentDesign);
loadDesignButton.addEventListener("click", () => designFileInput.click());
designFileInput.addEventListener("change", () => {
  const file = designFileInput.files?.[0];
  if (file) importDesignFile(file);
  designFileInput.value = "";
});
undoDesignButton?.addEventListener("click", undoDesignHistory);
redoDesignButton?.addEventListener("click", redoDesignHistory);
document.addEventListener("keydown", handleDesignHistoryShortcut);
exportDesignButton.addEventListener("click", () => {
  syncAcademicMetadata();
  downloadText(serializeRobotDesign(state.design), "robot-design.json", "application/json");
});
exportUrdfButton.addEventListener("click", showUrdfExportFlow);
analysisResults.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest("[data-download-urdf]")) downloadUrdfIfReady();
});
runAuditButton.addEventListener("click", renderAll);
simResetButton.addEventListener("click", resetSimulation);
simStepButton.addEventListener("click", stepSimulation);
simRunButton.addEventListener("click", toggleSimulation);
physicsStage.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const toggle = target.closest("[data-toggle-floating-panel]");
  if (!(toggle instanceof HTMLElement) || !toggle.dataset.toggleFloatingPanel || !physicsStage.contains(toggle)) return;
  toggleFloatingPanel(toggle.dataset.toggleFloatingPanel, toggle.closest("[data-floating-panel]"));
});
physicsStage.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const handle = target.closest("[data-floating-drag]");
  if (handle instanceof HTMLElement && physicsStage.contains(handle)) startFloatingPanelDrag(event, handle);
});
physicsStage.addEventListener("pointermove", moveFloatingPanel);
physicsStage.addEventListener("pointerup", stopFloatingPanelDrag);
physicsStage.addEventListener("pointercancel", stopFloatingPanelDrag);
helpButton?.addEventListener("click", () => {
  if (helpDialog?.open) return;
  if (typeof helpDialog?.showModal === "function") helpDialog.showModal();
  else helpDialog?.setAttribute("open", "");
});
helpCloseButton?.addEventListener("click", () => helpDialog?.close());
helpDialog?.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

window.addEventListener("resize", () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  applyFloatingPanelStates();
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

async function loadAssembly() {
  showStatus("Checking current assembly snapshot");
  renderSummaryPlaceholder();
  try {
    const evalMode = isAssistantEvalEnabled();
    const workspace = evalMode
      ? { currentAssemblySnapshot: null, currentRobotDesign: null, currentCircuitDesign: null, currentCircuitLabProject: null, currentMechatronicsBinding: null, partLibraryItems: [] }
      : await createWorkspaceStore().readWorkspace();
    const assemblyHandoffRequested = isAssemblyHandoffRequested(window.location.search);
    const snapshot = assemblyHandoffRequested ? workspace.currentAssemblySnapshot : null;
    state.currentCircuitDesign = workspace.currentCircuitDesign ?? null;
    state.currentCircuitLabProject = workspace.currentCircuitLabProject ?? null;
    state.currentMechatronicsBinding = workspace.currentMechatronicsBinding ?? null;
    state.partLibraryItems = workspace.partLibraryItems ?? [];
    const savedDesign = assemblyHandoffRequested ? workspace.currentRobotDesign : null;
    if (savedDesign) {
      state.mechatronicsReadiness = evaluateMechatronicsReadiness({
        robotDesign: savedDesign,
        circuitLabProject: state.currentCircuitLabProject,
        mechatronicsBinding: state.currentMechatronicsBinding
      });
    }
    renderSummaryPlaceholder();
    let snapshotParts = [];
    if (snapshot?.glb) {
      state.currentSnapshot = snapshot;
      state.assemblyRoot = await glbToObject(snapshot.glb);
      state.assemblyRoot.name = "current_design_snapshot";
      assemblySource.textContent = "Current snapshot";
      assemblyName.textContent = `Saved ${new Date(snapshot.savedAt).toLocaleTimeString()}`;
      showStatus("Loaded from Assembly Studio");
      snapshotParts = snapshot.parts ?? [];
      state.partRecords = collectAssemblyPartRecords(state.assemblyRoot, snapshotParts);
    } else {
      let loadedSample = false;
      if (import.meta.env.DEV && (evalMode || assemblyHandoffRequested)) {
        try {
          state.assemblyRoot = await createRoboticArmAssembly(loadStlGeometry);
          state.assemblyRoot.name = "sample_robotic_arm";
          loadedSample = true;
        } catch (error) {
          console.warn("Sample STL assets are unavailable; starting with an empty workbench.", error);
        }
      }
      if (!state.assemblyRoot) {
        state.assemblyRoot = createEmptyAssembly();
      }
      assemblySource.textContent = loadedSample ? (evalMode ? "Assistant eval sample" : "Fallback sample") : "Manual workspace";
      assemblyName.textContent = loadedSample ? "Robotic arm reference" : "No assembly snapshot";
      showStatus(
        loadedSample
          ? evalMode
            ? "Loaded sample arm for assistant eval"
            : "No snapshot found; loaded sample arm"
          : "Open the Assembly Studio and import STL files to begin"
      );
      snapshotParts = collectAssemblyParts(state.assemblyRoot);
      state.partRecords = collectAssemblyPartRecords(state.assemblyRoot, snapshotParts);
      state.currentSnapshot = {
        savedAt: new Date().toISOString(),
        glb: null,
        parts: state.partRecords,
        layout: null
      };
    }

    state.assemblyRoot.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    scene.add(state.assemblyRoot);
    state.meshBindings = createMeshPoseBindings(state.assemblyRoot, snapshotParts);

    const reuseSavedDesign = designMatchesParts(savedDesign, state.partRecords);
    state.design = reuseSavedDesign
      ? normalizeRobotDesign(savedDesign, state.partRecords)
      : createRobotDesign(state.partRecords, { sample: isSampleAssembly(state.partRecords) });
    state.selectedLinkId = state.design.links[0]?.id ?? null;
    state.selectedJointId = state.design.joints[0]?.id ?? null;
    state.selectedProxyId = state.design.links[0]?.collisionProxies[0]?.id ?? null;
    state.selectedEffectorId = state.design.endEffectors[0]?.id ?? null;
    state.selectedActuatorId = state.design.actuators[0]?.id ?? null;
    invalidateSimulation("Simulation has not been initialized.");
    resetDesignHistory();
    renderAll();
    state.assemblyRoot.updateMatrixWorld(true);
    fitCameraToObject(state.assemblyRoot);
    if (reuseSavedDesign && snapshotNewerThanDesign(snapshot, savedDesign)) {
      showStatus("Assembly geometry changed after the saved RobotDesign; refresh mass and proxies from bounds if needed.", 7200);
    }
  } catch (error) {
    console.error(error);
    showStatus(error?.userMessage ?? "Unable to load robotics workbench");
  }
}

renderer.setSize(viewport.clientWidth, viewport.clientHeight);
mountShellCardToggles(document);
mountWorkbenchAssistant();
animate();
loadAssembly();
