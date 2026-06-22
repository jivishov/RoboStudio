import "./electronics.css";
import "./shellHeader.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mountPageAssistant } from "./assistant/chatUi.js";
import { mountAssistantEvalPanel } from "./assistant/evalRunner.js";
import {
  commitHistory,
  createHistory,
  currentHistoryValue,
  historyStatus,
  redoHistory,
  resetHistory,
  undoHistory
} from "./history.js";
import { mountShellCardToggles } from "./shellCards.js";
import { CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, readWorkspaceValue, writeWorkspaceValue } from "./workspaceDb.js";
import { catalog, pinColor } from "./electronics/catalog.js";
import {
  addComponent,
  circuitSummary,
  connectPins,
  createSeedCircuitDesign,
  normalizeCircuitDesign,
  parseCircuitDesignJson,
  removeComponent,
  removeNet,
  selectComponent,
  selectNet,
  serializeCircuitDesign,
  setBoard,
  touchCircuitDesign,
  updateComponent
} from "./electronics/schema.js";
import { createFirmwareProjectZip, firmwareArchiveName, generateCircuitFirmware } from "./electronics/codegen.js";
import { runDrc, suggestSafePin } from "./electronics/drc.js";
import { endpointLabel, resolvePin } from "./electronics/pins.js";

const statusEl = document.querySelector("#electronics-status");
const circuitNameInput = document.querySelector("#circuit-name");
const boardSelect = document.querySelector("#board-select");
const boardReadout = document.querySelector("#board-readout");
const circuitSummaryEl = document.querySelector("#circuit-summary");
const catalogList = document.querySelector("#catalog-list");
const componentCountEl = document.querySelector("#component-count");
const componentList = document.querySelector("#component-list");
const netCountEl = document.querySelector("#net-count");
const netList = document.querySelector("#net-list");
const boardPinSelect = document.querySelector("#board-pin-select");
const endpointComponentSelect = document.querySelector("#endpoint-component-select");
const componentPinSelect = document.querySelector("#component-pin-select");
const connectNetButton = document.querySelector("#connect-net");
const pendingPinStatus = document.querySelector("#pending-pin-status");
const selectedSummary = document.querySelector("#selected-summary");
const componentNameInput = document.querySelector("#component-name");
const componentXInput = document.querySelector("#component-x");
const componentYInput = document.querySelector("#component-y");
const componentZInput = document.querySelector("#component-z");
const applyComponentButton = document.querySelector("#apply-component");
const removeComponentButton = document.querySelector("#remove-component");
const drcSummary = document.querySelector("#drc-summary");
const drcList = document.querySelector("#drc-list");
const codeFileSelect = document.querySelector("#code-file-select");
const codePreview = document.querySelector("#code-preview");
const viewportReadout = document.querySelector("#viewport-readout");
const viewportEl = document.querySelector("#electronics-viewport");
const newButton = document.querySelector("#new-circuit");
const saveButton = document.querySelector("#save-circuit");
const openButton = document.querySelector("#open-circuit");
const undoButton = document.querySelector("#undo-circuit");
const redoButton = document.querySelector("#redo-circuit");
const exportJsonButton = document.querySelector("#export-circuit-json");
const exportFirmwareButton = document.querySelector("#export-firmware");
const fileInput = document.querySelector("#circuit-file-input");
const frameButton = document.querySelector("#frame-circuit");
const runDrcButton = document.querySelector("#run-drc");
const suggestOutputButton = document.querySelector("#suggest-output-pin");
const generateCodeButton = document.querySelector("#generate-code");

const history = createHistory(createSeedCircuitDesign());
const sceneState = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  boardGroup: new THREE.Group(),
  componentGroup: new THREE.Group(),
  wireGroup: new THREE.Group(),
  interactive: [],
  animationFrame: null
};
const uiState = {
  pendingEndpoint: null,
  drc: runDrc(history.current),
  firmware: generateCircuitFirmware(history.current),
  selectedCodePath: "main/app_main.c"
};
let storageHydrationFinished = false;
let userEditedBeforeStorageHydration = false;

function showStatus(message, timeoutMs = 3600) {
  statusEl.textContent = message;
  if (!timeoutMs) return;
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    const summary = circuitSummary(currentDesign());
    statusEl.textContent = `${summary.name} / ${summary.componentCount} components / ${summary.netCount} nets`;
  }, timeoutMs);
}

function currentDesign() {
  return normalizeCircuitDesign(currentHistoryValue(history));
}

function noteUserEdit(options = {}) {
  if (!storageHydrationFinished && options.userEdit !== false) {
    userEditedBeforeStorageHydration = true;
  }
}

function commitDesign(nextDesign, message = "Circuit updated", options = {}) {
  noteUserEdit(options);
  commitHistory(history, normalizeCircuitDesign(nextDesign));
  refreshDerived();
  render();
  showStatus(message);
  return currentDesign();
}

function resetDesign(nextDesign, message = "Circuit reset", options = {}) {
  noteUserEdit(options);
  resetHistory(history, normalizeCircuitDesign(nextDesign));
  uiState.pendingEndpoint = null;
  refreshDerived();
  render();
  showStatus(message);
  return currentDesign();
}

function commitSelection(nextDesign) {
  noteUserEdit();
  commitHistory(history, normalizeCircuitDesign(nextDesign));
  render();
}

function refreshDerived() {
  const design = currentDesign();
  uiState.drc = runDrc(design);
  uiState.firmware = generateCircuitFirmware(design);
  if (!uiState.firmware.files.some((file) => file.path === uiState.selectedCodePath)) {
    uiState.selectedCodePath = uiState.firmware.files[0]?.path ?? "";
  }
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

function createMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.58,
    metalness: options.metalness ?? 0.08,
    transparent: Boolean(options.opacity && options.opacity < 1),
    opacity: options.opacity ?? 1
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse?.((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose?.());
      } else {
        object.material?.dispose?.();
      }
    });
  }
}

function endpointText(endpoint) {
  return endpointLabel(currentDesign(), endpoint);
}

function selectedComponent(design = currentDesign()) {
  return design.components.find((component) => component.id === design.selectedComponentId) ?? null;
}

function selectedNet(design = currentDesign()) {
  return design.nets.find((net) => net.id === design.selectedNetId) ?? null;
}

function initScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f12");
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1600);
  camera.position.set(120, 120, 150);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  viewportEl.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(10, 0, 0);

  scene.add(new THREE.HemisphereLight("#e8f7ff", "#1d1610", 1.2));
  const keyLight = new THREE.DirectionalLight("#ffffff", 1.3);
  keyLight.position.set(90, 140, 80);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const grid = new THREE.GridHelper(240, 24, "#355049", "#1b2a2b");
  grid.position.y = -2;
  scene.add(grid);

  scene.add(sceneState.boardGroup, sceneState.componentGroup, sceneState.wireGroup);
  Object.assign(sceneState, { scene, camera, renderer, controls });
  resizeScene();
  renderer.domElement.addEventListener("pointerdown", handleViewportPointer);
  window.addEventListener("resize", resizeScene);
  animateScene();
}

function resizeScene() {
  if (!sceneState.renderer || !sceneState.camera) return;
  const rect = viewportEl.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  sceneState.renderer.setSize(width, height, false);
  sceneState.camera.aspect = width / height;
  sceneState.camera.updateProjectionMatrix();
}

function animateScene() {
  sceneState.animationFrame = window.requestAnimationFrame(animateScene);
  sceneState.controls?.update();
  sceneState.renderer?.render(sceneState.scene, sceneState.camera);
}

function frameCircuit() {
  const design = currentDesign();
  const board = catalog.getBoard(design.board.id);
  const maxDim = Math.max(board?.dimensions?.[0] ?? 60, board?.dimensions?.[2] ?? 80, 120);
  sceneState.controls.target.set(10, 0, 0);
  sceneState.camera.position.set(maxDim * 1.4, maxDim * 1.15, maxDim * 1.55);
  sceneState.camera.lookAt(sceneState.controls.target);
  sceneState.controls.update();
}

function createPinMesh(resolved, radius = 1.65) {
  const material = createMaterial(pinColor(resolved.definition.type), { roughness: 0.35 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  mesh.position.fromArray(resolved.worldPosition);
  mesh.userData.endpoint = resolved.endpoint;
  mesh.userData.kind = "pin";
  mesh.userData.label = resolved.label;
  sceneState.interactive.push(mesh);
  return mesh;
}

function renderBoardScene(design) {
  clearGroup(sceneState.boardGroup);
  const board = catalog.getBoard(design.board.id);
  if (!board) return;
  const [width, thickness, depth] = board.dimensions;
  const boardMesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, depth),
    createMaterial("#164038", { roughness: 0.82 })
  );
  boardMesh.position.set(0, 0, 0);
  boardMesh.castShadow = true;
  boardMesh.receiveShadow = true;
  sceneState.boardGroup.add(boardMesh);

  const moduleMesh = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.44, 3.5, depth * 0.48),
    createMaterial("#242b31", { roughness: 0.7 })
  );
  moduleMesh.position.set(0, 3, 8);
  sceneState.boardGroup.add(moduleMesh);

  for (const pin of board.pins) {
    const resolved = resolvePin(design, { type: "board", pinId: pin.id });
    if (!resolved.ok) continue;
    sceneState.boardGroup.add(createPinMesh(resolved, 1.35));
  }
}

function componentGeometry(componentDef) {
  if (componentDef?.sim?.role === "led") return new THREE.CapsuleGeometry(3.2, 7, 8, 16);
  if (componentDef?.sim?.role === "resistor") return new THREE.CapsuleGeometry(2.2, 13, 6, 14);
  if (componentDef?.sim?.role === "button") return new THREE.BoxGeometry(9, 5, 9);
  const [x, y, z] = componentDef?.dimensions ?? [10, 8, 10];
  return new THREE.BoxGeometry(x, y, z);
}

function renderComponentScene(design) {
  clearGroup(sceneState.componentGroup);
  for (const component of design.components) {
    const componentDef = catalog.getComponent(component.componentId);
    const material = createMaterial(componentDef?.color ?? "#94a3b8");
    const mesh = new THREE.Mesh(componentGeometry(componentDef), material);
    mesh.position.fromArray(component.position);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(component.rotation[0] ?? 0),
      THREE.MathUtils.degToRad(component.rotation[1] ?? 0),
      THREE.MathUtils.degToRad(component.rotation[2] ?? 0)
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = "component";
    mesh.userData.instanceId = component.id;
    sceneState.interactive.push(mesh);
    sceneState.componentGroup.add(mesh);

    if (component.id === design.selectedComponentId) {
      const outline = new THREE.Mesh(
        new THREE.BoxGeometry(
          (componentDef?.dimensions?.[0] ?? 12) + 5,
          (componentDef?.dimensions?.[1] ?? 8) + 5,
          (componentDef?.dimensions?.[2] ?? 12) + 5
        ),
        createMaterial("#2dd4bf", { opacity: 0.18 })
      );
      outline.position.copy(mesh.position);
      sceneState.componentGroup.add(outline);
    }

    for (const pin of componentDef?.pins ?? []) {
      const resolved = resolvePin(design, { type: "component", instanceId: component.id, pinId: pin.id });
      if (!resolved.ok) continue;
      sceneState.componentGroup.add(createPinMesh(resolved, 1.2));
    }
  }
}

function renderWireScene(design) {
  clearGroup(sceneState.wireGroup);
  for (const net of design.nets) {
    const points = net.endpoints
      .map((endpoint) => resolvePin(design, endpoint))
      .filter((pin) => pin.ok)
      .map((pin) => new THREE.Vector3(...pin.worldPosition));
    if (points.length < 2) continue;
    const color = net.color ?? "#f8c35d";
    for (let index = 1; index < points.length; index += 1) {
      const start = points[0].clone();
      const end = points[index].clone();
      const mid = start.clone().lerp(end, 0.5);
      mid.y += 10;
      const curve = new THREE.CatmullRomCurve3([start, mid, end]);
      const geometry = new THREE.TubeGeometry(curve, 16, 0.62, 8, false);
      const mesh = new THREE.Mesh(geometry, createMaterial(color, { roughness: 0.42 }));
      mesh.userData.kind = "net";
      mesh.userData.netId = net.id;
      sceneState.interactive.push(mesh);
      sceneState.wireGroup.add(mesh);
    }
  }
}

function renderScene() {
  const design = currentDesign();
  sceneState.interactive = [];
  renderBoardScene(design);
  renderComponentScene(design);
  renderWireScene(design);
}

function sameEndpoint(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function handlePinClick(endpoint) {
  if (!uiState.pendingEndpoint) {
    uiState.pendingEndpoint = endpoint;
    renderPendingEndpoint();
    showStatus(`Selected ${endpointText(endpoint)} as wire start`);
    return;
  }
  if (sameEndpoint(uiState.pendingEndpoint, endpoint)) {
    uiState.pendingEndpoint = null;
    renderPendingEndpoint();
    showStatus("Wire start cleared");
    return;
  }
  const first = uiState.pendingEndpoint;
  uiState.pendingEndpoint = null;
  commitDesign(connectPins(currentDesign(), first, endpoint, {
    name: `${endpointText(first)} to ${endpointText(endpoint)}`
  }), "Net connected");
}

function handleViewportPointer(event) {
  const rect = sceneState.renderer.domElement.getBoundingClientRect();
  sceneState.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  sceneState.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  sceneState.raycaster.setFromCamera(sceneState.pointer, sceneState.camera);
  const hits = sceneState.raycaster.intersectObjects(sceneState.interactive, false);
  if (!hits.length) return;
  const hit = hits[0].object;
  if (hit.userData.kind === "pin") {
    handlePinClick(hit.userData.endpoint);
    viewportReadout.textContent = `Pin ${hit.userData.label}`;
    return;
  }
  if (hit.userData.kind === "component") {
    commitHistory(history, selectComponent(currentDesign(), hit.userData.instanceId));
    render();
    viewportReadout.textContent = `Selected ${hit.userData.instanceId}`;
    return;
  }
  if (hit.userData.kind === "net") {
    commitHistory(history, selectNet(currentDesign(), hit.userData.netId));
    render();
    viewportReadout.textContent = `Selected ${hit.userData.netId}`;
  }
}

function renderBoardOptions(design) {
  boardSelect.innerHTML = catalog.listBoards()
    .map((board) => `<option value="${board.id}" ${board.id === design.board.id ? "selected" : ""}>${board.name}</option>`)
    .join("");
  const board = catalog.getBoard(design.board.id);
  boardReadout.innerHTML = [
    ["Target", board?.target ?? design.target],
    ["Pins", board?.pins?.length ?? 0],
    ["Size", `${board?.dimensions?.[0] ?? 0} x ${board?.dimensions?.[2] ?? 0} mm`]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
  boardPinSelect.innerHTML = (board?.pins ?? [])
    .map((pin) => `<option value="${pin.id}">${pin.label ?? pin.id}</option>`)
    .join("");
}

function renderCatalog() {
  catalogList.innerHTML = catalog.listComponents().map((component) => `
    <article class="catalog-item">
      <span class="catalog-item__swatch" style="background:${component.color ?? "#94a3b8"}"></span>
      <div>
        <strong>${component.name}</strong>
        <span>${component.category} / ${component.pins.length} pins</span>
      </div>
      <button type="button" data-add-component="${component.id}">Add</button>
    </article>
  `).join("");
}

function renderComponents(design) {
  componentCountEl.textContent = String(design.components.length);
  componentList.innerHTML = design.components.map((component) => {
    const componentDef = catalog.getComponent(component.componentId);
    return `
      <article class="component-item ${component.id === design.selectedComponentId ? "is-selected" : ""}" data-component-id="${component.id}">
        <strong>${component.name}</strong>
        <span>${componentDef?.name ?? component.componentId}</span>
        <div class="component-item__meta">
          <span>${component.position.map((value) => Number(value).toFixed(0)).join(", ")} mm</span>
          <span>${componentDef?.sim?.role ?? "component"}</span>
        </div>
      </article>
    `;
  }).join("");
  endpointComponentSelect.innerHTML = design.components
    .map((component) => `<option value="${component.id}" ${component.id === design.selectedComponentId ? "selected" : ""}>${component.name}</option>`)
    .join("");
  renderComponentPinOptions(design);
}

function renderComponentPinOptions(design) {
  const instanceId = endpointComponentSelect.value || design.components[0]?.id;
  const instance = design.components.find((component) => component.id === instanceId);
  const componentDef = instance ? catalog.getComponent(instance.componentId) : null;
  componentPinSelect.innerHTML = (componentDef?.pins ?? [])
    .map((pin) => `<option value="${pin.id}">${pin.label ?? pin.id}</option>`)
    .join("");
}

function renderNets(design) {
  netCountEl.textContent = String(design.nets.length);
  netList.innerHTML = design.nets.map((net) => `
    <article class="net-item ${net.id === design.selectedNetId ? "is-selected" : ""}" data-net-id="${net.id}">
      <strong>${net.name}</strong>
      <span>${net.endpoints.map((endpoint) => endpointText(endpoint)).join(" / ")}</span>
      <div class="net-item__meta">
        <span>${net.endpoints.length} endpoints</span>
        <button type="button" data-remove-net="${net.id}">Remove</button>
      </div>
    </article>
  `).join("");
}

function renderPendingEndpoint() {
  pendingPinStatus.textContent = uiState.pendingEndpoint
    ? `Wire start: ${endpointText(uiState.pendingEndpoint)}. Click a second pin.`
    : "Click two pins in the scene to wire directly.";
}

function renderInspector(design) {
  const component = selectedComponent(design);
  const enabled = Boolean(component);
  for (const input of [componentNameInput, componentXInput, componentYInput, componentZInput]) input.disabled = !enabled;
  applyComponentButton.disabled = !enabled;
  removeComponentButton.disabled = !enabled;
  if (!component) {
    selectedSummary.textContent = selectedNet(design)
      ? `Selected net: ${selectedNet(design).name}`
      : "No component selected.";
    componentNameInput.value = "";
    componentXInput.value = "";
    componentYInput.value = "";
    componentZInput.value = "";
    return;
  }
  const componentDef = catalog.getComponent(component.componentId);
  selectedSummary.textContent = `${component.name} / ${componentDef?.name ?? component.componentId} / ${componentDef?.pins?.length ?? 0} pins`;
  componentNameInput.value = component.name;
  componentXInput.value = Number(component.position[0]).toFixed(1);
  componentYInput.value = Number(component.position[1]).toFixed(1);
  componentZInput.value = Number(component.position[2]).toFixed(1);
}

function renderDrc() {
  const { summary, issues, ok } = uiState.drc;
  drcSummary.textContent = ok
    ? `${summary.warnings} warnings`
    : `${summary.errors} errors`;
  if (!issues.length) {
    drcList.innerHTML = `<article class="drc-item" data-severity="info"><strong>Pass</strong><span>No electronics rule issues found.</span></article>`;
    return;
  }
  drcList.innerHTML = issues.map((item) => `
    <article class="drc-item" data-severity="${item.severity}">
      <strong>${item.severity}</strong>
      <span>${item.message}</span>
    </article>
  `).join("");
}

function renderFirmware() {
  const files = uiState.firmware.files;
  codeFileSelect.innerHTML = files
    .map((file) => `<option value="${file.path}" ${file.path === uiState.selectedCodePath ? "selected" : ""}>${file.path}</option>`)
    .join("");
  const selected = files.find((file) => file.path === uiState.selectedCodePath) ?? files[0];
  codePreview.textContent = selected?.content ?? "";
  exportFirmwareButton.disabled = !uiState.firmware.ready;
}

function renderHistoryButtons() {
  const status = historyStatus(history);
  undoButton.disabled = !status.canUndo;
  redoButton.disabled = !status.canRedo;
}

function render() {
  const design = currentDesign();
  circuitNameInput.value = design.name;
  circuitSummaryEl.textContent = `${design.nets.length} nets`;
  renderBoardOptions(design);
  renderCatalog();
  renderComponents(design);
  renderNets(design);
  renderPendingEndpoint();
  renderInspector(design);
  renderDrc();
  renderFirmware();
  renderHistoryButtons();
  renderScene();
  const summary = circuitSummary(design);
  statusEl.textContent = `${summary.name} / ${summary.componentCount} components / ${summary.netCount} nets`;
}

function addCatalogComponent(componentId, options = {}) {
  const next = addComponent(currentDesign(), componentId, options);
  return commitDesign(next, `${catalog.getComponent(componentId)?.name ?? componentId} added`);
}

function applyInspectorEdit() {
  const component = selectedComponent();
  if (!component) return null;
  const position = [
    Number(componentXInput.value),
    Number(componentYInput.value),
    Number(componentZInput.value)
  ];
  if (!position.every(Number.isFinite)) throw new Error("Component position must use finite numbers.");
  return commitDesign(updateComponent(currentDesign(), component.id, {
    name: componentNameInput.value.trim() || component.name,
    position
  }), `${component.name} updated`);
}

function connectSelectedControls() {
  const instanceId = endpointComponentSelect.value;
  const componentPinId = componentPinSelect.value;
  if (!boardPinSelect.value || !instanceId || !componentPinId) return null;
  return commitDesign(connectPins(
    currentDesign(),
    { type: "board", pinId: boardPinSelect.value },
    { type: "component", instanceId, pinId: componentPinId },
    { name: `${boardPinSelect.value} to ${instanceId}.${componentPinId}` }
  ), "Net connected");
}

async function saveCurrentDesign() {
  noteUserEdit();
  const design = touchCircuitDesign(currentDesign());
  resetHistory(history, design);
  await writeWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, design);
  render();
  showStatus("CircuitDesign saved to browser storage");
  return design;
}

async function readSavedDesign() {
  const saved = await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY);
  return saved ? normalizeCircuitDesign(saved) : null;
}

async function hydrateSavedDesign() {
  let saved;
  try {
    saved = await readSavedDesign();
  } finally {
    storageHydrationFinished = true;
  }
  if (saved && !userEditedBeforeStorageHydration) {
    resetDesign(saved, "Saved CircuitDesign loaded", { userEdit: false });
    return;
  }
  if (saved && userEditedBeforeStorageHydration) {
    showStatus("Saved CircuitDesign found; current edits were kept", 5200);
    return;
  }
  if (!userEditedBeforeStorageHydration) {
    showStatus("Starter CircuitDesign loaded");
  }
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

async function importCircuitFile(file) {
  const text = await file.text();
  const imported = parseCircuitDesignJson(text);
  resetDesign(imported, "CircuitDesign imported");
}

function exportCircuitJson() {
  downloadBlob(serializeCircuitDesign(currentDesign()), "robostudio-circuit.json", "application/json;charset=utf-8");
  showStatus("CircuitDesign JSON export started");
}

async function exportFirmwareZip() {
  refreshDerived();
  if (!uiState.firmware.ready) {
    showStatus("Firmware export blocked by DRC errors", 5200);
    throw new Error("Firmware export is blocked until DRC errors are resolved.");
  }
  const zip = await createFirmwareProjectZip(currentDesign());
  downloadBlob(zip, firmwareArchiveName(currentDesign()), "application/zip");
  showStatus("ESP-IDF firmware zip export started");
}

function electronicsAssistantContext() {
  const design = currentDesign();
  return {
    ready: true,
    page: "Electronics Studio",
    summary: circuitSummary(design),
    board: {
      id: design.board.id,
      name: catalog.getBoard(design.board.id)?.name ?? design.board.id,
      target: design.target
    },
    selectedComponent: selectedComponent(design),
    selectedNet: selectedNet(design),
    components: design.components.map((component) => ({
      id: component.id,
      name: component.name,
      componentId: component.componentId,
      role: catalog.getComponent(component.componentId)?.sim?.role ?? null,
      position: component.position
    })),
    nets: design.nets.map((net) => ({
      id: net.id,
      name: net.name,
      endpoints: net.endpoints.map((endpoint) => ({ ...endpoint, label: endpointLabel(design, endpoint) }))
    })),
    drc: uiState.drc,
    firmware: {
      ready: uiState.firmware.ready,
      files: uiState.firmware.files.map((file) => file.path)
    }
  };
}

function mountElectronicsAssistant() {
  const assistant = mountPageAssistant({
    pageId: "electronics",
    title: "Electronics Studio",
    getContext: electronicsAssistantContext,
    actions: {
      electronics_new_design: () => {
        resetDesign(createSeedCircuitDesign(), "New CircuitDesign");
        return "New CircuitDesign started.";
      },
      electronics_save_design: async () => {
        await saveCurrentDesign();
        return "CircuitDesign saved.";
      },
      electronics_open_design_picker: () => {
        fileInput.click();
        return "Electronics design JSON file picker opened.";
      },
      electronics_export_design_json: () => {
        exportCircuitJson();
        return "CircuitDesign JSON export started.";
      },
      electronics_export_firmware_zip: async () => {
        await exportFirmwareZip();
        return "ESP-IDF firmware zip export started.";
      },
      electronics_select_board: ({ boardId }) => {
        commitDesign(setBoard(currentDesign(), boardId), `${catalog.getBoard(boardId).name} selected`);
        return `${catalog.getBoard(boardId).name} selected.`;
      },
      electronics_add_component: ({ componentId, name, position }) => {
        const next = addCatalogComponent(componentId, { name, position });
        return `${selectedComponent(next)?.name ?? componentId} added.`;
      },
      electronics_select_component: ({ instanceId }) => {
        commitHistory(history, selectComponent(currentDesign(), instanceId));
        render();
        return `${instanceId} selected.`;
      },
      electronics_move_component: ({ instanceId, position }) => {
        commitDesign(updateComponent(currentDesign(), instanceId, { position }), `${instanceId} moved`);
        return `${instanceId} moved.`;
      },
      electronics_connect_pins: ({ endpointA, endpointB, name }) => {
        commitDesign(connectPins(currentDesign(), endpointA, endpointB, { name }), "Net connected");
        return "Net connected.";
      },
      electronics_remove_net: ({ netId }) => {
        commitDesign(removeNet(currentDesign(), netId), "Net removed");
        return `${netId} removed.`;
      },
      electronics_remove_component: ({ instanceId }) => {
        commitDesign(removeComponent(currentDesign(), instanceId), "Component removed");
        return `${instanceId} removed.`;
      },
      electronics_run_drc: () => {
        refreshDerived();
        renderDrc();
        return { ok: uiState.drc.ok, message: "Electronics DRC complete.", data: uiState.drc };
      },
      electronics_suggest_safe_pin: ({ role }) => {
        const suggestion = suggestSafePin(currentDesign(), { role });
        return suggestion ? `Suggested ${role} pin: ${suggestion.pinId}.` : `No unused safe ${role} pin is available.`;
      },
      electronics_generate_code: () => {
        refreshDerived();
        renderFirmware();
        return {
          ok: true,
          message: "Firmware files generated.",
          data: { ready: uiState.firmware.ready, files: uiState.firmware.files.map((file) => file.path) }
        };
      }
    }
  });
  mountAssistantEvalPanel({ adapter: assistant.adapter });
  return assistant;
}

function bindEvents() {
  mountShellCardToggles(document);
  newButton.addEventListener("click", () => {
    if (window.confirm("Start a new electronics design?")) resetDesign(createSeedCircuitDesign(), "New CircuitDesign");
  });
  saveButton.addEventListener("click", () => saveCurrentDesign().catch((error) => showStatus(error.message, 5200)));
  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files ?? [];
    fileInput.value = "";
    if (!file) return;
    try {
      await importCircuitFile(file);
    } catch (error) {
      showStatus(error.message ?? "Unable to import circuit JSON", 6200);
    }
  });
  undoButton.addEventListener("click", () => {
    noteUserEdit();
    undoHistory(history);
    refreshDerived();
    render();
    showStatus("Undo complete");
  });
  redoButton.addEventListener("click", () => {
    noteUserEdit();
    redoHistory(history);
    refreshDerived();
    render();
    showStatus("Redo complete");
  });
  exportJsonButton.addEventListener("click", exportCircuitJson);
  exportFirmwareButton.addEventListener("click", () => exportFirmwareZip().catch((error) => showStatus(error.message, 6200)));
  frameButton.addEventListener("click", frameCircuit);
  circuitNameInput.addEventListener("change", () => {
    commitDesign(touchCircuitDesign({ ...currentDesign(), name: circuitNameInput.value.trim() || "Electronics design" }), "Circuit renamed");
  });
  boardSelect.addEventListener("change", () => {
    commitDesign(setBoard(currentDesign(), boardSelect.value), "Board changed");
  });
  catalogList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-component]");
    if (!button) return;
    addCatalogComponent(button.dataset.addComponent);
  });
  componentList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-component-id]");
    if (!item) return;
    commitSelection(selectComponent(currentDesign(), item.dataset.componentId));
  });
  endpointComponentSelect.addEventListener("change", () => renderComponentPinOptions(currentDesign()));
  connectNetButton.addEventListener("click", connectSelectedControls);
  netList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-net]");
    if (removeButton) {
      commitDesign(removeNet(currentDesign(), removeButton.dataset.removeNet), "Net removed");
      return;
    }
    const item = event.target.closest("[data-net-id]");
    if (!item) return;
    commitSelection(selectNet(currentDesign(), item.dataset.netId));
  });
  applyComponentButton.addEventListener("click", () => {
    try {
      applyInspectorEdit();
    } catch (error) {
      showStatus(error.message ?? "Unable to update component", 5200);
    }
  });
  removeComponentButton.addEventListener("click", () => {
    const component = selectedComponent();
    if (!component || !window.confirm(`Remove ${component.name}?`)) return;
    commitDesign(removeComponent(currentDesign(), component.id), "Component removed");
  });
  runDrcButton.addEventListener("click", () => {
    refreshDerived();
    renderDrc();
    showStatus(uiState.drc.ok ? "DRC passed" : "DRC found blocking issues");
  });
  suggestOutputButton.addEventListener("click", () => {
    const suggestion = suggestSafePin(currentDesign(), { role: "output" });
    showStatus(suggestion ? `Suggested output pin: ${suggestion.pinId}` : "No unused safe output pin available", 5200);
  });
  generateCodeButton.addEventListener("click", () => {
    refreshDerived();
    renderFirmware();
    showStatus("Firmware files regenerated");
  });
  codeFileSelect.addEventListener("change", () => {
    uiState.selectedCodePath = codeFileSelect.value;
    renderFirmware();
  });
}

async function start() {
  initScene();
  bindEvents();
  refreshDerived();
  render();
  frameCircuit();
  try {
    await Promise.race([
      hydrateSavedDesign(),
      timeoutAfter(2500, "Workspace storage is still opening; starter CircuitDesign stays active.")
    ]);
  } catch (error) {
    showStatus(error.message ?? "Starter CircuitDesign is ready", 5200);
  }
  frameCircuit();
  mountElectronicsAssistant();
}

start().catch((error) => {
  console.error("Electronics Studio failed to start", error);
  resetDesign(createSeedCircuitDesign(), "Electronics Studio loaded with starter design", { userEdit: false });
});
