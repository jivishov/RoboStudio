import "./styles.css";
import "./shellHeader.css";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SOURCE_REFERENCE_URL } from "./assemblySpec.js";
import { collectAssemblyParts, createMaterial, createRoboticArmAssembly } from "./createAssembly.js";
import {
  JOINT_DEFINITIONS,
  JOINTS_BY_ID,
  clampJointAngle,
  getMostSpecificJointIdForPart,
  getJointWorldAxis,
  getJointWorldPivot
} from "./studio/jointRig.js";
import {
  applyPoseToAssembly,
  capturePartOffsetFromWorld,
  captureRestState,
  createDefaultPose,
  getPartOffsetTransform,
  normalizePose,
  resetPartOffset,
  serializePose,
  setPartOffsetTransform
} from "./studio/poseState.js";
import { scaleForTargetBounds } from "./studio/resize.js";
import {
  generatedSnapshotParts,
  isPartsHandoffRequested,
  isValidGeneratedAssemblySnapshot
} from "./studio/partsHandoff.js";
import { CURRENT_SNAPSHOT_KEY, SNAPSHOT_STORE_NAME, readWorkspaceValue, writeWorkspaceValue } from "./workspaceDb.js";
import { isShellCardOpen, mountShellCardToggles } from "./shellCards.js";
import { mountPageAssistant } from "./assistant/chatUi.js";
import { mountAssistantEvalPanel } from "./assistant/evalRunner.js";

const viewport = document.querySelector("#viewport");
const stage = document.querySelector(".stage");
const loading = document.querySelector("#loading");
const exportButton = document.querySelector("#export-glb");
const openPhysicsButton = document.querySelector("#open-physics");
const importStlButton = document.querySelector("#import-stl");
const clearSceneButton = document.querySelector("#clear-scene");
const stlFileInput = document.querySelector("#stl-file-input");
const savePoseButton = document.querySelector("#save-pose");
const loadPoseButton = document.querySelector("#load-pose");
const poseFileInput = document.querySelector("#pose-file-input");
const orbitToggle = document.querySelector("#orbit-toggle");
const zoomToggle = document.querySelector("#zoom-toggle");
const partSearch = document.querySelector("#part-search");
const clearSearchButton = document.querySelector("#clear-search");
const partsList = document.querySelector("#parts-list");
const modeButtons = document.querySelectorAll("[data-mode]");
const jointSelect = document.querySelector("#joint-select");
const jointAngleRange = document.querySelector("#joint-angle-range");
const jointAngleNumber = document.querySelector("#joint-angle-number");
const jointRangeScaleLabels = document.querySelectorAll(".range-scale span");
const resetJointButton = document.querySelector("#reset-joint");
const resetPoseButton = document.querySelector("#reset-pose");
const resetSelectedButton = document.querySelector("#reset-selected");
const duplicateSelectedButton = document.querySelector("#duplicate-selected");
const removeSelectedButton = document.querySelector("#remove-selected");
const selectedPartName = document.querySelector("#selected-part-name");
const selectedPartSource = document.querySelector("#selected-part-source");
const selectedVisibleToggle = document.querySelector("#selected-visible-toggle");
const selectedOpacity = document.querySelector("#selected-opacity");
const selectedOpacityValue = document.querySelector("#selected-opacity-value");
const selectedTriangles = document.querySelector("#selected-triangles");
const selectedMaterials = document.querySelector("#selected-materials");
const selectedBounds = document.querySelector("#selected-bounds");
const offsetInputs = document.querySelectorAll(".offset-input");
const scaleInputs = document.querySelectorAll(".scale-input");
const resizeSizeInputs = document.querySelectorAll(".resize-size-input");
const selectedCurrentSize = document.querySelector("#selected-current-size");
const resizeUniformToggle = document.querySelector("#resize-uniform-toggle");
const resetScaleButton = document.querySelector("#reset-scale");
const activeModeLabel = document.querySelector("#active-mode-label");
const activeModeInstructions = document.querySelector("#active-mode-instructions");
const stageSelectedName = document.querySelector("#stage-selected-name");
const stagePartCount = document.querySelector("#stage-part-count");
const stageWorkspaceMode = document.querySelector("#stage-workspace-mode");
const stagePoseStatus = document.querySelector("#stage-pose-status");
const workspaceSummary = document.querySelector("#workspace-summary");
const viewportDockButtons = document.querySelectorAll("[data-viewport-action]");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f7f9fc");

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.style.touchAction = "none";
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.minDistance = 160;
controls.maxDistance = 900;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.enabled = false;
scene.add(transformControls.getHelper());

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const selectionHelper = new THREE.BoxHelper(new THREE.Object3D(), "#f59e0b");
selectionHelper.visible = false;
scene.add(selectionHelper);

const jointPivotHelper = new THREE.Mesh(
  new THREE.SphereGeometry(5.2, 20, 12),
  new THREE.MeshBasicMaterial({ color: "#f97316", depthTest: false })
);
jointPivotHelper.renderOrder = 10;
jointPivotHelper.visible = false;
scene.add(jointPivotHelper);

const jointAxisHelper = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
  new THREE.LineBasicMaterial({ color: "#f97316", depthTest: false })
);
jointAxisHelper.renderOrder = 10;
jointAxisHelper.visible = false;
scene.add(jointAxisHelper);

const hemiLight = new THREE.HemisphereLight("#ffffff", "#cad2df", 1.8);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
keyLight.position.set(180, 420, 240);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 900;
keyLight.shadow.camera.left = -350;
keyLight.shadow.camera.right = 350;
keyLight.shadow.camera.top = 450;
keyLight.shadow.camera.bottom = -150;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight("#dfe8ff", 1.1);
fillLight.position.set(-260, 180, -220);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(620, 620),
  new THREE.ShadowMaterial({ opacity: 0.18 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(620, 20, "#b8c0cc", "#d9dee7");
grid.material.opacity = 0.42;
grid.material.transparent = true;
scene.add(grid);

let assemblyGroup;
let parts = [];
let partsById = new Map();
let partRowsById = new Map();
let restState;
let poseState;
let selectedPart = null;
let studioMode = "hinge";
let partFilter = "";
let statusTimer = null;
let importedColorIndex = 0;
let layoutDirty = false;
let gridVisible = true;

const loader = new STLLoader();
const gltfLoader = new GLTFLoader();
const IMPORT_COLORS = ["#2563eb", "#0f9f6e", "#b45309", "#7c3aed", "#c026d3", "#0891b2"];
const STUDIO_LAYOUT_VERSION = 2;

function createEmptyAssembly() {
  const group = new THREE.Group();
  group.name = "manual_stl_workspace";
  group.userData = {
    sourceStlCount: 0,
    generatedFrom: null,
    assemblyType: "manual"
  };
  return group;
}

function deg(value) {
  return (value * Math.PI) / 180;
}

function radToDeg(value) {
  return (value * 180) / Math.PI;
}

function assetUrlForFile(fileName) {
  return `${import.meta.env.BASE_URL}${encodeURIComponent(fileName)}`;
}

function loadStlGeometry(fileName) {
  return new Promise((resolve, reject) => {
    loader.load(assetUrlForFile(fileName), resolve, undefined, reject);
  });
}

function sanitizeId(value, fallback = "part") {
  return (
    value
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 44) || fallback
  );
}

function uniquePartId(baseId) {
  const cleanBase = sanitizeId(baseId);
  let id = cleanBase;
  let suffix = 2;

  while (partsById.has(id)) {
    id = `${cleanBase}_${suffix}`;
    suffix += 1;
  }

  return id;
}

function refreshPartIndex() {
  parts = collectAssemblyParts(assemblyGroup);
  partsById = new Map(parts.map((part) => [part.userData.id, part]));
}

function partTypeCounts() {
  return {
    imported: parts.filter((part) => part.userData.type === "imported").length,
    sample: parts.filter((part) => part.userData.type === "source").length,
    generated: parts.filter((part) => ["generated", "inferred"].includes(part.userData.type)).length
  };
}

function markDirty(message = null) {
  layoutDirty = true;
  updateWorkspaceSummary();
  updateStageStatus();
  updateSceneControls();
  if (message) showStatus(message);
}

function updateWorkspaceSummary() {
  const { imported: importedCount, sample: sampleCount, generated: generatedCount } = partTypeCounts();
  const segments = [];

  if (importedCount) segments.push(`${importedCount} imported`);
  if (sampleCount) segments.push(`${sampleCount} sample STL`);
  if (generatedCount) segments.push(`${generatedCount} generated`);

  workspaceSummary.textContent = segments.length ? segments.join(" / ") : "Import STL files to begin";
}

function registerPart(part) {
  part.castShadow = true;
  part.receiveShadow = true;
  assemblyGroup.add(part);
  part.updateMatrixWorld(true);
  parts.push(part);
  partsById.set(part.userData.id, part);
  restState.restMatrices.set(part.userData.id, part.matrixWorld.clone());
  poseState.visibility[part.userData.id] = true;
}

function normalizeImportedGeometry(geometry) {
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  return geometry;
}

function arrayBufferToGeometry(buffer) {
  return normalizeImportedGeometry(loader.parse(buffer));
}

function readCurrentAssemblySnapshot() {
  return readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY);
}

function parseGlbSnapshot(glb) {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(glb, "", resolve, reject);
  });
}

function normalizeGeneratedSnapshotMesh(mesh, metadata) {
  mesh.name = metadata?.id ?? mesh.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.geometry?.computeBoundingBox?.();
  mesh.geometry?.computeVertexNormals?.();
  if (mesh.material) {
    for (const material of partMaterials(mesh)) {
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
  } else {
    mesh.material = createMaterial("#2563eb", true);
  }
  mesh.userData = {
    ...mesh.userData,
    id: metadata?.id ?? mesh.userData.id ?? sanitizeId(mesh.name, "generated_part"),
    label: metadata?.label ?? mesh.userData.label ?? mesh.name,
    file: null,
    type: "generated",
    source: "part-studio",
    inferredReason: "Generated in Robotic Component Builder.",
    jointNotes: null
  };
}

async function createGeneratedAssemblyFromSnapshot(snapshot) {
  if (!isValidGeneratedAssemblySnapshot(snapshot)) {
    throw new Error("Component Builder snapshot is missing generated GLB data.");
  }

  const gltf = await parseGlbSnapshot(snapshot.glb);
  const group = gltf.scene ?? new THREE.Group();
  const generatedParts = generatedSnapshotParts(snapshot);
  const snapshotParts = new Map(generatedParts.filter((part) => part?.id).map((part) => [part.id, part]));
  const meshes = [];
  group.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  if (!meshes.length) {
    throw new Error("Component Builder snapshot GLB did not contain generated meshes.");
  }

  for (const [index, mesh] of meshes.entries()) {
    const metadata =
      snapshotParts.get(mesh.userData?.id) ??
      snapshotParts.get(mesh.name) ??
      generatedParts[index] ??
      null;
    normalizeGeneratedSnapshotMesh(mesh, metadata);
  }

  group.name = "part_studio_generated_assembly";
  group.userData = {
    sourceStlCount: 0,
    generatedFrom: "part-studio",
    assemblyType: "generated",
    manifest: meshes.map((mesh) => mesh.userData)
  };
  return group;
}

function createImportedMesh(geometry, fileName, id, label) {
  const color = IMPORT_COLORS[importedColorIndex % IMPORT_COLORS.length];
  importedColorIndex += 1;

  const mesh = new THREE.Mesh(geometry, createMaterial(color, false));
  mesh.name = id;
  mesh.userData = {
    id,
    label,
    file: fileName,
    type: "imported",
    imported: true,
    inferredReason: null,
    jointNotes: null
  };
  return mesh;
}

async function importStlFiles(fileList) {
  const files = [...(fileList ?? [])].filter((file) => file.name.toLowerCase().endsWith(".stl"));
  if (!files.length || !assemblyGroup || !poseState || !restState) return;

  importStlButton.disabled = true;
  showStatus(`Importing ${files.length} STL file${files.length === 1 ? "" : "s"}...`, 10000);

  const importedParts = [];

  for (const file of files) {
    try {
      const geometry = arrayBufferToGeometry(await file.arrayBuffer());
      const label = file.name.replace(/\.[^.]+$/, "");
      const id = uniquePartId(label);
      const mesh = createImportedMesh(geometry, file.name, id, label);
      registerPart(mesh);
      importedParts.push(mesh);
    } catch (error) {
      console.error(`Failed to import ${file.name}`, error);
      showStatus(`Import failed: ${file.name}`, 5200);
    }
  }

  buildPartsList();
  updateAllControls();

  if (importedParts.length) {
    selectPart(importedParts[0]);
    fitCameraToObject(importedParts.length === 1 ? importedParts[0] : assemblyGroup);
    markDirty(`Imported ${importedParts.length} STL file${importedParts.length === 1 ? "" : "s"}`);
  }

  importStlButton.disabled = false;
  stlFileInput.value = "";
}

function filesContainStl(dataTransfer) {
  return [...(dataTransfer?.files ?? [])].some((file) => file.name.toLowerCase().endsWith(".stl"));
}

function showStatus(message, timeout = 2200) {
  clearTimeout(statusTimer);
  loading.textContent = message;
  loading.hidden = false;

  statusTimer = setTimeout(() => {
    if (assemblyGroup) loading.hidden = true;
  }, timeout);
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxSize) || maxSize <= 0) return;
  const distance = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));

  camera.position.set(center.x + distance * 0.52, center.y + distance * 0.32, center.z + distance * 0.9);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = distance * 8;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function selectedPartId() {
  return selectedPart?.userData?.id ?? null;
}

function setButtonText(button, text) {
  const label = button.querySelector(".shell-header__label:not(.shell-header__label--hint)");
  if (label) {
    label.textContent = text;
    return;
  }

  const textNode = [...button.childNodes]
    .reverse()
    .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

  if (textNode) {
    textNode.textContent = ` ${text}`;
  } else {
    button.append(` ${text}`);
  }
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function formatBounds(part) {
  if (!part) return "-";

  const box = new THREE.Box3().setFromObject(part);
  const size = box.getSize(new THREE.Vector3());
  return `${formatNumber(size.x, 1)} x ${formatNumber(size.y, 1)} x ${formatNumber(size.z, 1)}`;
}

function partBoundsSize(part) {
  if (!part) return [0, 0, 0];
  const box = new THREE.Box3().setFromObject(part);
  const size = box.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}

function partMaterials(part) {
  if (!part?.material) return [];
  return Array.isArray(part.material) ? part.material : [part.material];
}

function partOpacity(part) {
  const material = partMaterials(part)[0];
  return material?.transparent ? material.opacity : 1;
}

function setPartOpacity(part, opacity) {
  for (const material of partMaterials(part)) {
    material.transparent = opacity < 0.995;
    material.opacity = opacity;
    material.needsUpdate = true;
  }
}

function triangleCount(part) {
  const geometry = part?.geometry;
  if (!geometry) return 0;
  const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
  return Math.round(count / 3);
}

function workspaceModeLabel() {
  const counts = partTypeCounts();
  if (!parts.length) return "Empty workspace";
  if (counts.imported && parts.length > counts.imported) return "Mixed STL assembly";
  if (counts.imported) return "Imported STL assembly";
  if (counts.sample) return "Sample assembly";
  if (counts.generated) return "Generated part assembly";
  return "Sample assembly";
}

function currentJoint() {
  return JOINTS_BY_ID.get(jointSelect.value);
}

function updateStageStatus() {
  if (stageSelectedName) stageSelectedName.textContent = selectedPart?.userData?.id ?? "None";
  if (stagePartCount) stagePartCount.textContent = `${parts.filter((part) => part.visible).length}/${parts.length} visible`;
  if (stageWorkspaceMode) stageWorkspaceMode.textContent = workspaceModeLabel();
  if (stagePoseStatus) stagePoseStatus.textContent = layoutDirty ? "unsaved changes" : "saved";
}

function updateSceneControls() {
  const visibleCount = parts.filter((part) => part.visible).length;

  for (const button of viewportDockButtons) {
    if (button.dataset.viewportAction === "show-all") {
      button.disabled = !parts.length || visibleCount === parts.length;
    } else if (button.dataset.viewportAction === "hide-all") {
      button.disabled = !parts.length || visibleCount === 0;
    }
  }
  if (clearSceneButton) clearSceneButton.disabled = !parts.length;
}

function buildJointSelect() {
  jointSelect.replaceChildren();

  for (const joint of JOINT_DEFINITIONS) {
    const option = document.createElement("option");
    option.value = joint.id;
    option.textContent = joint.label;
    jointSelect.append(option);
  }

  if (JOINTS_BY_ID.has("elbow")) {
    jointSelect.value = "elbow";
  }
}

function buildPartsList() {
  partsList.replaceChildren();
  partRowsById = new Map();

  const query = partFilter.trim().toLowerCase();
  const groups = [
    {
      key: "imported",
      label: "Imported STL",
      parts: parts.filter((part) => part.userData.type === "imported")
    },
    {
      key: "source",
      label: "Sample assembly",
      parts: parts.filter((part) => part.userData.type === "source")
    },
    {
      key: "inferred",
      label: "Generated parts",
      parts: parts.filter((part) => ["generated", "inferred"].includes(part.userData.type))
    }
  ];

  for (const group of groups) {
    const matchingParts = group.parts.filter((part) => {
      if (!query) return true;
      const searchable = `${part.userData.label} ${part.userData.file ?? ""} ${part.userData.id}`;
      return searchable.toLowerCase().includes(query);
    });

    if (!matchingParts.length) continue;

    const cardId = `assembly-parts-${group.key}`;
    const open = isShellCardOpen(cardId);
    const contentId = `${cardId}-content`;
    const section = document.createElement("section");
    section.className = `parts-group collapsible-card shell-card${open ? "" : " is-collapsed"}`;
    section.dataset.cardId = cardId;

    const heading = document.createElement("button");
    heading.className = "parts-group__heading collapsible-card__toggle shell-card__toggle";
    heading.type = "button";
    heading.dataset.toggleShellCard = cardId;
    heading.setAttribute("aria-expanded", String(open));
    heading.setAttribute("aria-controls", contentId);

    const labelWrap = document.createElement("span");
    labelWrap.className = "collapsible-card__label";
    const label = document.createElement("span");
    label.className = "collapsible-card__title";
    label.textContent = group.label;
    const count = document.createElement("span");
    count.className = "collapsible-card__meta";
    count.textContent = matchingParts.length;
    labelWrap.append(label, count);

    const chevron = document.createElement("span");
    chevron.className = "collapsible-card__chevron";
    chevron.setAttribute("aria-hidden", "true");
    const dots = document.createElement("span");
    dots.className = "collapsible-card__dots";
    dots.setAttribute("aria-hidden", "true");
    heading.append(labelWrap, chevron, dots);
    section.append(heading);

    const content = document.createElement("div");
    content.className = "collapsible-card__content";
    content.id = contentId;
    const inner = document.createElement("div");
    inner.className = "collapsible-card__inner parts-group__body";

    for (const part of matchingParts) {
      const row = document.createElement("div");
      row.className = "part-row";
      row.title = part.userData.inferredReason || part.userData.file || part.userData.label;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Select ${part.userData.label}`);

      const visibility = document.createElement("label");
      visibility.className = "part-row__visibility";
      visibility.addEventListener("click", (event) => event.stopPropagation());

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = part.visible;
      input.addEventListener("change", () => {
        poseState.visibility[part.userData.id] = input.checked;
        applyCurrentPose();
        updateVisibilityToggle(visibility, input, part);
        if (!input.checked && selectedPart === part) {
          selectPart(null);
        } else {
          updateSelectedInspector();
        }
        markDirty(`${part.userData.label ?? part.userData.id} ${input.checked ? "shown" : "hidden"}`);
      });

      const visibilityIcon = document.createElement("span");
      visibilityIcon.className = "material-symbols-rounded app-icon visibility-glyph";
      visibilityIcon.setAttribute("aria-hidden", "true");
      visibility.append(input, visibilityIcon);
      updateVisibilityToggle(visibility, input, part);

      const dot = document.createElement("span");
      dot.className = `part-dot${["generated", "inferred"].includes(part.userData.type) ? " part-dot--inferred" : ""}`;

      const name = document.createElement("span");
      name.className = "part-row__name";
      name.textContent = part.userData.id;

      const menu = document.createElement("span");
      menu.className = "part-row__menu";
      menu.textContent = "...";

      row.append(visibility, dot, name, menu);
      row.addEventListener("click", () => selectPart(part));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectPart(part);
        }
      });
      inner.append(row);
      partRowsById.set(part.userData.id, row);
    }

    content.append(inner);
    section.append(content);

    partsList.append(section);
  }

  if (!partRowsById.size) {
    const empty = document.createElement("p");
    empty.className = "parts-empty";
    empty.textContent = query ? "No matching parts" : "Import STL files to begin.";
    partsList.append(empty);
  }
}

function updatePartRows() {
  for (const part of parts) {
    const row = partRowsById.get(part.userData.id);
    if (!row) continue;

    row.classList.toggle("is-selected", part === selectedPart);
    const input = row.querySelector("input[type='checkbox']");
    const visibility = row.querySelector(".part-row__visibility");
    if (input) {
      input.checked = part.visible;
      updateVisibilityToggle(visibility, input, part);
    }
  }
}

function updateVisibilityToggle(label, input, part) {
  if (!label || !input) return;
  const visible = Boolean(input.checked);
  const labelText = part.userData.label ?? part.userData.id;
  const action = visible ? "Hide" : "Show";
  const icon = label.querySelector(".visibility-glyph");
  label.title = `${action} ${labelText}`;
  input.setAttribute("aria-label", `${action} ${labelText}`);
  if (icon) icon.textContent = visible ? "layers" : "layers_clear";
}

function downloadBlob(content, fileName, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function createAssemblyGlb() {
  const exporter = new GLTFExporter();
  assemblyGroup.updateMatrixWorld(true);

  return new Promise((resolve, reject) => {
    exporter.parse(assemblyGroup, resolve, reject, {
      binary: true,
      onlyVisible: false
    });
  });
}

function serializePartSnapshot(part) {
  part.updateMatrixWorld(true);
  return {
    id: part.userData.id,
    label: part.userData.label ?? part.userData.id,
    type: part.userData.type,
    file: part.userData.file ?? null,
    visible: part.visible,
    triangles: triangleCount(part),
    bounds: formatBounds(part),
    matrixWorld: part.matrixWorld.toArray()
  };
}

async function saveCurrentAssemblySnapshot(glb) {
  await writeWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, {
    savedAt: new Date().toISOString(),
    glb,
    parts: parts.map(serializePartSnapshot),
    layout: poseState ? JSON.parse(serializePose(poseState)) : null
  });
}

async function exportAssemblyGlb() {
  if (!assemblyGroup) return;

  exportButton.disabled = true;
  setButtonText(exportButton, "Exporting...");
  applyCurrentPose();

  try {
    const result = await createAssemblyGlb();
    downloadBlob(result, "stl-assembly.glb", "model/gltf-binary");
    exportButton.disabled = false;
    setButtonText(exportButton, "Export GLB");
    showStatus("Assembly GLB exported");
  } catch (error) {
    console.error("GLB export failed", error);
    exportButton.disabled = false;
    setButtonText(exportButton, "Export GLB");
    showStatus("GLB export failed", 4200);
  }
}

async function openPhysicsWorkbench() {
  if (!assemblyGroup) return;

  openPhysicsButton.disabled = true;
  setButtonText(openPhysicsButton, "Preparing...");
  applyCurrentPose();

  try {
    await saveCurrentAssemblySnapshot(await createAssemblyGlb());
    window.location.href = `${import.meta.env.BASE_URL}physics.html`;
  } catch (error) {
    console.error("Workbench handoff failed", error);
    openPhysicsButton.disabled = false;
    setButtonText(openPhysicsButton, "Workbench");
    showStatus("Unable to prepare workbench", 4200);
  }
}

function savePoseJson() {
  if (!poseState) return;
  const importedParts = parts
    .filter((part) => part.userData.type === "imported")
    .map((part) => ({
      id: part.userData.id,
      label: part.userData.label,
      file: part.userData.file
    }));

  const payload = JSON.stringify(
    {
      studioVersion: STUDIO_LAYOUT_VERSION,
      units: "mm",
      note: "This project saves layout, visibility, and rig pose. Re-import the same STL files before loading if imported geometry is missing.",
      importedParts,
      pose: JSON.parse(serializePose(poseState))
    },
    null,
    2
  );

  layoutDirty = false;
  updateStageStatus();
  downloadBlob(payload, "stl-studio-layout.json", "application/json");
  showStatus("Layout JSON saved");
}

function loadPoseJson(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      poseState = normalizePose(parsed.studioVersion ? parsed.pose : parsed, parts);
      applyCurrentPose();
      if (selectedPart && !selectedPart.visible) {
        selectPart(null);
      }
      updateAllControls();
      layoutDirty = false;
      updateStageStatus();
      showStatus(parsed.studioVersion ? "Layout JSON loaded" : "Pose JSON loaded");
    } catch (error) {
      console.error(error);
      showStatus(`Pose load failed: ${error.message}`, 5200);
    } finally {
      poseFileInput.value = "";
    }
  });
  reader.addEventListener("error", () => {
    showStatus("Pose load failed", 5200);
    poseFileInput.value = "";
  });
  reader.readAsText(file);
}

function applyCurrentPose() {
  if (!parts.length || !restState || !poseState) return;
  applyPoseToAssembly(parts, restState, poseState);
  updateSelectionHelper();
  updateJointHelper();
  updatePartRows();
  updateStageStatus();
  updateSceneControls();
}

function updateModeButtons() {
  for (const button of modeButtons) {
    button.classList.toggle("is-active", button.dataset.mode === studioMode);
  }

  if (activeModeLabel) {
    activeModeLabel.textContent = titleCase(studioMode);
  }

  if (activeModeInstructions) {
    const instructionsByMode = {
      select: ["Click a part to select", "Use inspector values to inspect"],
      move: ["Select a part", "Drag arrows or edit position"],
      rotate: ["Select a part", "Drag rings or edit rotation"],
      resize: ["Select a part", "Drag handles or enter target size"],
      hinge: ["Click a rigged part or choose a joint", "Use slider or angle input to rotate"]
    };
    activeModeInstructions.replaceChildren(
      ...instructionsByMode[studioMode].map((instruction) => {
        const item = document.createElement("li");
        item.textContent = instruction;
        return item;
      })
    );
  }
}

function updateTransformAttachment() {
  transformControls.detach();
  transformControls.enabled = false;

  if (selectedPart && selectedPart.visible && (studioMode === "move" || studioMode === "rotate" || studioMode === "resize")) {
    transformControls.enabled = true;
    transformControls.setMode(studioMode === "move" ? "translate" : studioMode === "resize" ? "scale" : "rotate");
    transformControls.attach(selectedPart);
  }
}

function setStudioMode(mode) {
  studioMode = mode;
  if (studioMode === "hinge") {
    syncJointToSelectedPart();
  }
  updateModeButtons();
  updateTransformAttachment();
  updateJointHelper();
}

function updateSelectionHelper() {
  if (!selectedPart || !selectedPart.visible) {
    selectionHelper.visible = false;
    return;
  }

  selectionHelper.setFromObject(selectedPart);
  selectionHelper.visible = true;
}

function updateJointHelper() {
  const visible = studioMode === "hinge" && poseState && JOINTS_BY_ID.has(jointSelect.value);
  jointPivotHelper.visible = visible;
  jointAxisHelper.visible = visible;

  if (!visible) return;

  const pivot = getJointWorldPivot(jointSelect.value, poseState);
  const axis = getJointWorldAxis(jointSelect.value, poseState);
  const start = pivot.clone().addScaledVector(axis, -24);
  const end = pivot.clone().addScaledVector(axis, 24);

  jointPivotHelper.position.copy(pivot);
  jointAxisHelper.geometry.setFromPoints([start, end]);
}

function updateJointControls() {
  if (!poseState) return;

  const joint = JOINTS_BY_ID.get(jointSelect.value);
  if (!joint) return;

  const angle = clampJointAngle(joint.id, poseState.joints[joint.id]?.angleDeg ?? joint.defaultDeg);
  jointAngleRange.min = joint.minDeg;
  jointAngleRange.max = joint.maxDeg;
  jointAngleRange.step = "1";
  jointAngleRange.value = angle;
  jointAngleNumber.min = joint.minDeg;
  jointAngleNumber.max = joint.maxDeg;
  jointAngleNumber.value = angle;
  updateJointRangeScale(joint);
  updateStageStatus();
}

function formatRangeLabel(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function updateJointRangeScale(joint) {
  if (!jointRangeScaleLabels.length) return;

  const span = joint.maxDeg - joint.minDeg;
  const values = [0, 0.25, 0.5, 0.75, 1].map((step) => joint.minDeg + span * step);
  for (const [index, label] of [...jointRangeScaleLabels].entries()) {
    label.textContent = formatRangeLabel(values[index] ?? joint.maxDeg);
  }
}

function offsetToEulerDegrees(transform) {
  const quaternion = new THREE.Quaternion().fromArray(transform.quaternion).normalize();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return [radToDeg(euler.x), radToDeg(euler.y), radToDeg(euler.z)];
}

function updateSelectedInspector() {
  const partId = selectedPartId();
  const hasSelection = Boolean(partId);

  selectedPartName.textContent = selectedPart?.userData?.id ?? "No part selected";
  selectedPartSource.textContent = selectedPart
    ? selectedPart.userData.type === "imported"
      ? selectedPart.userData.file
      : selectedPart.userData.type === "source"
        ? "Sample STL"
        : "Generated"
    : "-";
  resetSelectedButton.disabled = !hasSelection;
  duplicateSelectedButton.disabled = !hasSelection;
  removeSelectedButton.disabled = !hasSelection || selectedPart?.userData.type !== "imported";
  selectedVisibleToggle.disabled = !hasSelection;
  selectedVisibleToggle.checked = selectedPart?.visible ?? false;

  const transform = hasSelection ? getPartOffsetTransform(poseState, partId) : null;
  const rotation = transform ? offsetToEulerDegrees(transform) : [0, 0, 0];
  const opacity = hasSelection ? partOpacity(selectedPart) : 1;

  selectedOpacity.disabled = !hasSelection;
  selectedOpacity.value = Math.round(opacity * 100);
  selectedOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
  selectedTriangles.textContent = hasSelection ? triangleCount(selectedPart).toLocaleString() : "-";
  selectedMaterials.textContent = hasSelection ? Math.max(1, partMaterials(selectedPart).length) : "-";
  selectedBounds.textContent = hasSelection ? formatBounds(selectedPart) : "-";
  const boundsSize = hasSelection ? partBoundsSize(selectedPart) : [0, 0, 0];
  if (selectedCurrentSize) {
    selectedCurrentSize.textContent = hasSelection
      ? boundsSize.map((value) => formatNumber(value, 1)).join(" x ")
      : "-";
  }

  for (const input of offsetInputs) {
    input.disabled = !hasSelection;
    const axis = Number(input.dataset.axis);
    if (!hasSelection) {
      input.value = "0";
    } else if (input.dataset.offsetKind === "position") {
      input.value = transform.position[axis].toFixed(2);
    } else {
      input.value = rotation[axis].toFixed(1);
    }
  }

  for (const [index, input] of [...scaleInputs].entries()) {
    input.disabled = !hasSelection;
    input.value = hasSelection ? transform.scale[index].toFixed(3) : "1.000";
  }

  for (const [index, input] of [...resizeSizeInputs].entries()) {
    input.disabled = !hasSelection;
    input.value = hasSelection ? boundsSize[index].toFixed(2) : "0";
  }
  if (resizeUniformToggle) resizeUniformToggle.disabled = !hasSelection;
  if (resetScaleButton) resetScaleButton.disabled = !hasSelection;

  updateStageStatus();
}

function updateAllControls() {
  updateWorkspaceSummary();
  updateJointControls();
  updateSelectedInspector();
  updateModeButtons();
  updateTransformAttachment();
  updateSelectionHelper();
  updateJointHelper();
  updatePartRows();
  updateSceneControls();
}

function selectPart(part) {
  selectedPart = part?.visible ? part : null;
  syncJointToSelectedPart();
  updateSelectedInspector();
  updateSelectionHelper();
  updateTransformAttachment();
  updatePartRows();
}

function syncJointToSelectedPart() {
  if (studioMode !== "hinge" || !selectedPart || selectedPart.userData.type === "imported") {
    return;
  }

  const jointId = getMostSpecificJointIdForPart(selectedPart.userData.id);
  if (!jointId || !JOINTS_BY_ID.has(jointId) || jointSelect.value === jointId) {
    return;
  }

  jointSelect.value = jointId;
  updateJointControls();
  updateJointHelper();
}

function setJointAngle(jointId, value) {
  const joint = JOINTS_BY_ID.get(jointId);
  if (!joint) return;

  poseState.joints[jointId] = { angleDeg: clampJointAngle(jointId, Number(value)) };
  applyCurrentPose();
  updateJointControls();
  updateTransformAttachment();
  markDirty();
}

function resetCurrentJoint() {
  const joint = JOINTS_BY_ID.get(jointSelect.value);
  if (!joint) return;
  setJointAngle(joint.id, joint.defaultDeg);
}

function resetPose() {
  poseState = createDefaultPose(parts);
  applyCurrentPose();
  updateAllControls();
  markDirty("Assembly reset");
}

function resetSelectedPart() {
  const partId = selectedPartId();
  if (!partId) return;

  resetPartOffset(poseState, partId);
  applyCurrentPose();
  updateSelectedInspector();
  updateTransformAttachment();
  markDirty("Transform reset");
}

function handleOffsetInput(input) {
  const partId = selectedPartId();
  if (!partId) return;

  const transform = getPartOffsetTransform(poseState, partId);
  const axis = Number(input.dataset.axis);
  const value = Number(input.value);

  if (input.dataset.offsetKind === "position") {
    transform.position[axis] = Number.isFinite(value) ? value : 0;
  } else {
    const rotation = offsetToEulerDegrees(transform);
    rotation[axis] = Number.isFinite(value) ? value : 0;
    const euler = new THREE.Euler(deg(rotation[0]), deg(rotation[1]), deg(rotation[2]), "XYZ");
    transform.quaternion = new THREE.Quaternion().setFromEuler(euler).toArray();
  }

  setPartOffsetTransform(poseState, partId, transform);
  applyCurrentPose();
  updateSelectedInspector();
  updateTransformAttachment();
  markDirty();
}

function handleScaleInput(input) {
  const partId = selectedPartId();
  if (!partId) return;

  const transform = getPartOffsetTransform(poseState, partId);
  const axis = Number(input.dataset.axis);
  const value = Number(input.value);
  transform.scale[axis] = Number.isFinite(value) && value > 0 ? value : 1;

  setPartOffsetTransform(poseState, partId, transform);
  applyCurrentPose();
  updateSelectedInspector();
  updateTransformAttachment();
  markDirty();
}

function setSelectedScaleVector(scale, message = "Resize updated") {
  const partId = selectedPartId();
  if (!partId) throw new Error("Select a part before resizing.");
  const transform = getPartOffsetTransform(poseState, partId);
  transform.scale = scale.map((value) => Math.max(0.001, Number(value)));
  setPartOffsetTransform(poseState, partId, transform);
  applyCurrentPose();
  updateSelectedInspector();
  updateTransformAttachment();
  markDirty(message);
}

function resizeSelectedPartToTargetSize(targetSizeMm, options = {}) {
  const partId = selectedPartId();
  if (!partId || !selectedPart) throw new Error("Select a part before resizing.");
  const transform = getPartOffsetTransform(poseState, partId);
  const currentBounds = partBoundsSize(selectedPart);
  const nextScale = scaleForTargetBounds(currentBounds, transform.scale, targetSizeMm, options);
  setSelectedScaleVector(nextScale, "Part resized");
}

function handleResizeSizeInput(input) {
  try {
    const axis = Number(input.dataset.axis);
    const currentBounds = partBoundsSize(selectedPart);
    const target = [...currentBounds];
    target[axis] = Number(input.value);
    resizeSelectedPartToTargetSize(target, {
      axis,
      uniform: resizeUniformToggle?.checked !== false
    });
  } catch (error) {
    showStatus(error.message ?? "Unable to resize selected part.", 4200);
    updateSelectedInspector();
  }
}

function resetSelectedScale() {
  const partId = selectedPartId();
  if (!partId) return;
  setSelectedScaleVector([1, 1, 1], "Scale reset");
}

function worldMatrixToLocalTransform(worldMatrix, parent) {
  const parentInverse = new THREE.Matrix4();
  parent.updateMatrixWorld(true);
  parentInverse.copy(parent.matrixWorld).invert();
  const localMatrix = parentInverse.multiply(worldMatrix);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  localMatrix.decompose(position, quaternion, scale);

  return { position, quaternion, scale };
}

function duplicateSelectedPart() {
  if (!selectedPart || !assemblyGroup || !restState || !poseState) return;

  selectedPart.updateMatrixWorld(true);
  const id = uniquePartId(`${selectedPart.userData.id}_copy`);
  const material = partMaterials(selectedPart).map((item) => item.clone());
  const clone = new THREE.Mesh(selectedPart.geometry.clone(), material.length === 1 ? material[0] : material);
  const { position, quaternion, scale } = worldMatrixToLocalTransform(selectedPart.matrixWorld.clone(), assemblyGroup);
  clone.position.copy(position).add(new THREE.Vector3(24, 0, 0));
  clone.quaternion.copy(quaternion);
  clone.scale.copy(scale);
  clone.name = id;
  clone.userData = {
    id,
    label: `${selectedPart.userData.label ?? selectedPart.userData.id} copy`,
    file: selectedPart.userData.file ?? null,
    type: "imported",
    imported: true,
    inferredReason: "Duplicated in studio workspace.",
    jointNotes: null
  };

  registerPart(clone);
  buildPartsList();
  selectPart(clone);
  updateAllControls();
  markDirty("Part duplicated");
}

function removeSelectedPart() {
  if (!selectedPart || selectedPart.userData.type !== "imported") {
    showStatus("Sample parts are locked. Hide them with the visibility control.");
    return;
  }

  const partId = selectedPart.userData.id;
  transformControls.detach();
  assemblyGroup.remove(selectedPart);
  selectedPart.geometry?.dispose();
  for (const material of partMaterials(selectedPart)) {
    material.dispose?.();
  }
  restState.restMatrices.delete(partId);
  delete poseState.partOffsets[partId];
  delete poseState.visibility[partId];
  selectedPart = null;
  refreshPartIndex();
  buildPartsList();
  updateAllControls();
  markDirty("Part removed");
}

function disposePart(part) {
  part.geometry?.dispose?.();
  for (const material of partMaterials(part)) {
    material.dispose?.();
  }
}

function clearScene({ confirm = true } = {}) {
  if (!parts.length) return false;
  if (confirm && !window.confirm("Clear all parts from the scene?")) return false;

  transformControls.detach();
  selectedPart = null;

  for (const part of parts) {
    disposePart(part);
  }
  scene.remove(assemblyGroup);

  assemblyGroup = createEmptyAssembly();
  scene.add(assemblyGroup);
  parts = [];
  partsById = new Map();
  partRowsById = new Map();
  restState = captureRestState(parts);
  poseState = createDefaultPose(parts);
  partFilter = "";
  partSearch.value = "";
  importedColorIndex = 0;

  buildPartsList();
  applyCurrentPose();
  updateAllControls();
  markDirty("Scene cleared");
  return true;
}

function setGridVisible(visible) {
  gridVisible = visible;
  grid.visible = visible;
  for (const button of viewportDockButtons) {
    if (button.dataset.viewportAction === "grid") {
      button.classList.toggle("is-active", visible);
      button.setAttribute("aria-pressed", String(visible));
    }
  }
  updateSceneControls();
}

function setCameraControlState({ orbit, zoom }) {
  if (typeof orbit === "boolean") {
    controls.enableRotate = orbit;
    orbitToggle.checked = orbit;
  }
  if (typeof zoom === "boolean") {
    controls.enableZoom = zoom;
    zoomToggle.checked = zoom;
  }
  updateSceneControls();
}

function setAllPartsVisible(visible) {
  if (!poseState || !parts.length) return;
  for (const part of parts) {
    poseState.visibility[part.userData.id] = visible;
  }
  if (!visible) selectedPart = null;
  applyCurrentPose();
  updateAllControls();
  markDirty(visible ? "All parts shown" : "All parts hidden");
}

function captureSelectedOffsetFromTransformControls() {
  const partId = selectedPartId();
  if (!partId || !selectedPart) return;

  selectedPart.updateMatrixWorld(true);
  capturePartOffsetFromWorld(partId, selectedPart.matrixWorld.clone(), restState, poseState);
  updateSelectedInspector();
  updateSelectionHelper();
  markDirty();
}

function pickPart(event) {
  if (!parts.length || transformControls.dragging) return;
  if (event.button !== 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(
    parts.filter((part) => part.visible),
    false
  );
  selectPart(hits[0]?.object ?? null);
}

function onResize() {
  const { clientWidth, clientHeight } = viewport;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

function animate() {
  controls.update();
  if (selectionHelper.visible) selectionHelper.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function assistantPartSummary(part) {
  const partId = part.userData.id;
  const transform = poseState ? getPartOffsetTransform(poseState, partId) : null;
  return {
    id: partId,
    name: part.userData.label ?? part.name ?? part.userData.id,
    type: part.userData.type ?? "part",
    visible: part.visible,
    opacityPercent: Math.round(partOpacity(part) * 100),
    triangles: triangleCount(part),
    boundsSizeMm: partBoundsSize(part),
    scale: transform?.scale ?? [1, 1, 1]
  };
}

function studioAssistantContext() {
  return {
    page: "STL Assembly Studio",
    ready: Boolean(assemblyGroup && poseState),
    mode: studioMode,
    controls: {
      orbit: controls.enableRotate,
      zoom: controls.enableZoom,
      gridVisible
    },
    search: partFilter,
    selection: selectedPart ? assistantPartSummary(selectedPart) : null,
    counts: {
      parts: parts.length,
      visibleParts: parts.filter((part) => part.visible).length,
      importedParts: parts.filter((part) => part.userData.type === "imported").length
    },
    parts: parts.slice(0, 80).map(assistantPartSummary),
    joints: JOINT_DEFINITIONS.map((joint) => ({
      id: joint.id,
      name: joint.label,
      minDeg: joint.minDeg,
      maxDeg: joint.maxDeg,
      currentDeg: poseState?.joints?.[joint.id]?.angleDeg ?? joint.defaultDeg
    })),
    layoutDirty
  };
}

function requireAssemblyReady() {
  if (!assemblyGroup || !poseState) throw new Error("The assembly is not loaded yet.");
}

function partForAssistant(partId) {
  if (partId === "none") return null;
  const part = partsById.get(partId);
  if (!part) throw new Error(`Unknown part id: ${partId}`);
  return part;
}

function selectPartForAssistant(partId) {
  const part = partForAssistant(partId);
  selectPart(part);
  return part;
}

function setPartVisibleForAssistant(partId, visible) {
  const part = partForAssistant(partId);
  poseState.visibility[partId] = visible;
  part.visible = visible;
  if (!visible && selectedPart?.userData.id === partId) selectPart(null);
  applyCurrentPose();
  updateAllControls();
  markDirty(`${part.userData.label ?? partId} ${visible ? "shown" : "hidden"}`);
}

function studioSetSelectedTransform(args) {
  requireAssemblyReady();
  if (args.partId) selectPartForAssistant(args.partId);
  const partId = selectedPartId();
  if (!partId) throw new Error("Select a part before changing its transform.");
  const transform = getPartOffsetTransform(poseState, partId);
  if (Array.isArray(args.position)) {
    transform.position = args.position.map((value) => Number(value));
  }
  if (Array.isArray(args.rotationDeg)) {
    const euler = new THREE.Euler(
      deg(args.rotationDeg[0]),
      deg(args.rotationDeg[1]),
      deg(args.rotationDeg[2]),
      "XYZ"
    );
    transform.quaternion = new THREE.Quaternion().setFromEuler(euler).toArray();
  }
  if (Array.isArray(args.scale)) {
    transform.scale = args.scale.map((value) => Math.max(0.001, Number(value)));
  }
  setPartOffsetTransform(poseState, partId, transform);
  applyCurrentPose();
  updateSelectedInspector();
  updateTransformAttachment();
  markDirty("Transform updated");
}

function studioResizeSelectedPart(args = {}) {
  requireAssemblyReady();
  if (args.partId) selectPartForAssistant(args.partId);
  if (!selectedPart) throw new Error("Select a part before resizing.");
  const currentBounds = partBoundsSize(selectedPart);
  const longestAxis = currentBounds.reduce((bestAxis, size, axis) => (size > currentBounds[bestAxis] ? axis : bestAxis), 0);
  resizeSelectedPartToTargetSize(args.targetSizeMm, {
    axis: longestAxis,
    uniform: args.uniform !== false
  });
}

function mountStudioAssistant() {
  const assistant = mountPageAssistant({
    pageId: "studio",
    title: "Assembly Studio",
    getContext: studioAssistantContext,
    actions: {
      studio_set_mode: ({ mode }) => {
        requireAssemblyReady();
        setStudioMode(mode);
        return `Mode set to ${mode}.`;
      },
      studio_search_parts: ({ query }) => {
        partFilter = query;
        partSearch.value = query;
        buildPartsList();
        updatePartRows();
        return query ? `Parts filtered by "${query}".` : "Parts search cleared.";
      },
      studio_clear_search: () => {
        partFilter = "";
        partSearch.value = "";
        buildPartsList();
        updatePartRows();
        return "Parts search cleared.";
      },
      studio_select_part: ({ partId }) => {
        requireAssemblyReady();
        const part = selectPartForAssistant(partId);
        return part ? `Selected ${part.userData.label ?? part.userData.id}.` : "Selection cleared.";
      },
      studio_frame_assembly: () => {
        requireAssemblyReady();
        fitCameraToObject(assemblyGroup);
        return "Assembly framed in the viewport.";
      },
      studio_set_camera_controls: ({ orbit, zoom }) => {
        setCameraControlState({ orbit, zoom });
        return "Camera controls updated.";
      },
      studio_set_grid_visible: ({ visible }) => {
        setGridVisible(visible);
        return visible ? "Grid shown." : "Grid hidden.";
      },
      studio_set_part_visibility: ({ partId, visible }) => {
        requireAssemblyReady();
        setPartVisibleForAssistant(partId, visible);
        return `${partId} ${visible ? "shown" : "hidden"}.`;
      },
      studio_set_part_opacity: ({ partId, opacityPercent }) => {
        requireAssemblyReady();
        const part = partForAssistant(partId);
        setPartOpacity(part, Math.min(100, Math.max(15, opacityPercent)) / 100);
        if (selectedPart?.userData.id === partId) updateSelectedInspector();
        markDirty(`${partId} opacity updated`);
        return `${partId} opacity set to ${Math.round(opacityPercent)}%.`;
      },
      studio_set_joint_angle: ({ jointId, angleDeg }) => {
        requireAssemblyReady();
        setJointAngle(jointId, angleDeg);
        return `${jointId} set to ${Math.round(angleDeg * 10) / 10} degrees.`;
      },
      studio_reset_current_joint: () => {
        requireAssemblyReady();
        resetCurrentJoint();
        return "Current joint reset.";
      },
      studio_reset_pose: () => {
        requireAssemblyReady();
        resetPose();
        return "Pose reset.";
      },
      studio_set_selected_transform: (args) => {
        studioSetSelectedTransform(args);
        return "Selected part transform updated.";
      },
      studio_resize_selected_part: (args) => {
        studioResizeSelectedPart(args);
        return "Selected part resized.";
      },
      studio_duplicate_selected_part: () => {
        duplicateSelectedPart();
        return "Selected part duplicated.";
      },
      studio_remove_selected_part: () => {
        removeSelectedPart();
        return "Selected imported part removed.";
      },
      studio_save_pose_json: () => {
        savePoseJson();
        return "Layout JSON download started.";
      },
      studio_load_pose_json: () => {
        poseFileInput.click();
        return "Layout JSON file picker opened.";
      },
      studio_export_glb: async () => {
        await exportAssemblyGlb();
        return "Assembly GLB export started.";
      },
      studio_open_physics_workbench: async () => {
        await openPhysicsWorkbench();
        return "Robotics Design Workbench is opening.";
      },
      studio_import_stl_picker: () => {
        stlFileInput.click();
        return "STL import file picker opened.";
      },
      studio_clear_scene: () => {
        const cleared = clearScene({ confirm: false });
        return cleared ? "Scene cleared." : "Scene already empty.";
      }
    }
  });
  mountAssistantEvalPanel({ adapter: assistant.adapter });
  return assistant;
}

partSearch.addEventListener("input", () => {
  partFilter = partSearch.value;
  buildPartsList();
  updatePartRows();
});

clearSearchButton.addEventListener("click", () => {
  partFilter = "";
  partSearch.value = "";
  buildPartsList();
  updatePartRows();
  partSearch.focus();
});

clearSceneButton.addEventListener("click", () => clearScene());

selectedVisibleToggle.addEventListener("change", () => {
  const partId = selectedPartId();
  if (!partId) return;
  poseState.visibility[partId] = selectedVisibleToggle.checked;
  markDirty();
  applyCurrentPose();
  if (!selectedVisibleToggle.checked) {
    selectPart(null);
  } else {
    updateSelectedInspector();
  }
});

selectedOpacity.addEventListener("input", () => {
  if (!selectedPart) return;
  const opacity = Number(selectedOpacity.value) / 100;
  setPartOpacity(selectedPart, opacity);
  selectedOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
  markDirty();
});

for (const button of modeButtons) {
  button.addEventListener("click", () => setStudioMode(button.dataset.mode));
}

for (const button of viewportDockButtons) {
  if (button.dataset.viewportAction === "grid") {
    button.classList.toggle("is-active", gridVisible);
    button.setAttribute("aria-pressed", String(gridVisible));
  }

  button.addEventListener("click", () => {
    if (button.dataset.viewportAction === "frame") {
      if (assemblyGroup) fitCameraToObject(assemblyGroup);
    } else if (button.dataset.viewportAction === "grid") {
      setGridVisible(!gridVisible);
    } else if (button.dataset.viewportAction === "show-all") {
      setAllPartsVisible(true);
    } else if (button.dataset.viewportAction === "hide-all") {
      setAllPartsVisible(false);
    }
  });
}

mountShellCardToggles(document);

stage.addEventListener("dragover", (event) => {
  if (!filesContainStl(event.dataTransfer)) return;
  event.preventDefault();
  stage.classList.add("is-dragging");
});

stage.addEventListener("dragleave", (event) => {
  if (!stage.contains(event.relatedTarget)) {
    stage.classList.remove("is-dragging");
  }
});

stage.addEventListener("drop", (event) => {
  if (!filesContainStl(event.dataTransfer)) return;
  event.preventDefault();
  stage.classList.remove("is-dragging");
  importStlFiles(event.dataTransfer.files);
});

transformControls.addEventListener("dragging-changed", (event) => {
  controls.enabled = !event.value;
  if (!event.value) {
    captureSelectedOffsetFromTransformControls();
    applyCurrentPose();
    updateTransformAttachment();
  }
});

transformControls.addEventListener("objectChange", captureSelectedOffsetFromTransformControls);

renderer.domElement.addEventListener("pointerdown", pickPart);

orbitToggle.addEventListener("change", () => {
  setCameraControlState({ orbit: orbitToggle.checked });
});

zoomToggle.addEventListener("change", () => {
  setCameraControlState({ zoom: zoomToggle.checked });
});

exportButton.addEventListener("click", exportAssemblyGlb);
openPhysicsButton.addEventListener("click", openPhysicsWorkbench);
importStlButton.addEventListener("click", () => stlFileInput.click());
stlFileInput.addEventListener("change", () => importStlFiles(stlFileInput.files));
savePoseButton.addEventListener("click", savePoseJson);
loadPoseButton.addEventListener("click", () => poseFileInput.click());
poseFileInput.addEventListener("change", () => loadPoseJson(poseFileInput.files?.[0]));

jointSelect.addEventListener("change", () => {
  updateJointControls();
  updateJointHelper();
});
jointAngleRange.addEventListener("input", () => setJointAngle(jointSelect.value, jointAngleRange.value));
jointAngleNumber.addEventListener("input", () => setJointAngle(jointSelect.value, jointAngleNumber.value));
resetJointButton.addEventListener("click", resetCurrentJoint);
resetPoseButton.addEventListener("click", resetPose);
resetSelectedButton.addEventListener("click", resetSelectedPart);
resetScaleButton.addEventListener("click", resetSelectedScale);
duplicateSelectedButton.addEventListener("click", duplicateSelectedPart);
removeSelectedButton.addEventListener("click", removeSelectedPart);

for (const input of offsetInputs) {
  input.addEventListener("change", () => handleOffsetInput(input));
}

for (const input of scaleInputs) {
  input.addEventListener("change", () => handleScaleInput(input));
}

for (const input of resizeSizeInputs) {
  input.addEventListener("change", () => handleResizeSizeInput(input));
}

window.addEventListener("resize", onResize);

async function init() {
  try {
    loading.textContent = "Loading STL studio...";
    buildJointSelect();
    let loadedSample = false;
    let loadedGenerated = false;
    let startupStatus = null;
    if (isPartsHandoffRequested(window.location.search)) {
      try {
        assemblyGroup = await createGeneratedAssemblyFromSnapshot(await readCurrentAssemblySnapshot());
        loadedGenerated = true;
        startupStatus = "Loaded generated parts from Component Builder";
      } catch (error) {
        console.warn("Component Builder handoff snapshot is unavailable; falling back to sample arm.", error);
        startupStatus = "Component Builder handoff unavailable; loaded fallback workspace";
      }
    }
    if (!assemblyGroup && import.meta.env.DEV) {
      try {
        assemblyGroup = await createRoboticArmAssembly(loadStlGeometry);
        assemblyGroup.userData.referenceUrl = SOURCE_REFERENCE_URL;
        loadedSample = true;
      } catch (error) {
        console.warn("Sample STL assets are unavailable; starting with an empty workspace.", error);
      }
    }
    if (!assemblyGroup) {
      assemblyGroup = createEmptyAssembly();
      studioMode = "select";
    }
    scene.add(assemblyGroup);

    parts = collectAssemblyParts(assemblyGroup);
    partsById = new Map(parts.map((part) => [part.userData.id, part]));
    restState = captureRestState(parts);
    poseState = createDefaultPose(parts);
    layoutDirty = false;

    buildPartsList();
    applyCurrentPose();
    selectPart(partsById.get("upper_arm") ?? partsById.get("lower_arm") ?? parts[0] ?? null);
    updateAllControls();
    if (parts.length) fitCameraToObject(assemblyGroup);
    loading.hidden = true;
    if (loadedGenerated) {
      showStatus(startupStatus, 4200);
    } else if (startupStatus) {
      showStatus(startupStatus, 5200);
    } else if (!loadedSample) {
      showStatus("Import STL files to begin.", 4200);
    }
  } catch (error) {
    console.error(error);
    loading.textContent = "Unable to load the robotic arm studio.";
    exportButton.disabled = true;
    savePoseButton.disabled = true;
    loadPoseButton.disabled = true;
  }
}

mountStudioAssistant();
onResize();
animate();
init();
