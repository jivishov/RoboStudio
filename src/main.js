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
import { meshPayloadFromBufferGeometry } from "./studio/featureDetection.js";
import {
  SERVO_HORN_SPACING_PRESETS,
  createFeatureAnchor,
  createMeasurementAnchor,
  formatMeasurement,
  measureAnchors,
  spacingAdjustmentForTarget
} from "./studio/measurements.js";
import {
  DEFAULT_CLICK_DRAG_TOLERANCE_PX,
  DEFAULT_FEATURE_PICK_TOLERANCE_PX,
  FEATURE_DETECTION_STATES,
  classifyPointerGesture,
  featureAnchorLabel,
  featureAnchorRole,
  isSpacingPairSupported,
  pickFeatureTarget
} from "./studio/interaction.js";
import {
  generatedSnapshotParts,
  isPartsHandoffRequested,
  isValidGeneratedAssemblySnapshot
} from "./studio/partsHandoff.js";
import { CURRENT_SNAPSHOT_KEY, SNAPSHOT_STORE_NAME, readWorkspaceValue, writeWorkspaceValue } from "./workspaceDb.js";
import { isShellCardOpen, mountShellCardToggles } from "./shellCards.js";
import { commitHistory, createHistory, historyStatus, redoHistory, resetHistory, undoHistory } from "./history.js";
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
const undoStudioButton = document.querySelector("#undo-studio");
const redoStudioButton = document.querySelector("#redo-studio");
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
const measurementAnchorA = document.querySelector("#measurement-anchor-a");
const measurementAnchorB = document.querySelector("#measurement-anchor-b");
const measurementDistance = document.querySelector("#measurement-distance");
const measurementProjected = document.querySelector("#measurement-projected");
const measurementDelta = document.querySelector("#measurement-delta");
const measurementClearance = document.querySelector("#measurement-clearance");
const measurementNextPick = document.querySelector("#measurement-next-pick");
const measurementPickAButton = document.querySelector("#measurement-pick-a");
const measurementPickBButton = document.querySelector("#measurement-pick-b");
const measureAnchorAPartButton = document.querySelector("#measure-anchor-a-part");
const measureAnchorBPartButton = document.querySelector("#measure-anchor-b-part");
const measureAnchorAFeatureButton = document.querySelector("#measure-anchor-a-feature");
const measureAnchorBFeatureButton = document.querySelector("#measure-anchor-b-feature");
const measurementPreset = document.querySelector("#measurement-preset");
const measurementTargetDistance = document.querySelector("#measurement-target-distance");
const measurementSymmetricToggle = document.querySelector("#measurement-symmetric-toggle");
const measurementUseCurrentButton = document.querySelector("#measurement-use-current");
const measurementApplySpacingButton = document.querySelector("#measurement-apply-spacing");
const measurementClearButton = document.querySelector("#measurement-clear");
const featureDetectionStatus = document.querySelector("#feature-detection-status");
const featureSelect = document.querySelector("#feature-select");
const featureCenterInputs = document.querySelectorAll(".feature-center-input");
const featureRadiusInput = document.querySelector("#feature-radius-input");
const featureLengthInput = document.querySelector("#feature-length-input");
const featureAngleInput = document.querySelector("#feature-angle-input");
const featureConfidence = document.querySelector("#feature-confidence");
const featureDetectButton = document.querySelector("#feature-detect");
const featurePreviewButton = document.querySelector("#feature-preview");
const featureApplyButton = document.querySelector("#feature-apply");
const featureUndoButton = document.querySelector("#feature-undo");
const activeModeLabel = document.querySelector("#active-mode-label");
const activeModeInstructions = document.querySelector("#active-mode-instructions");
const stageSelectedName = document.querySelector("#stage-selected-name");
const stagePartCount = document.querySelector("#stage-part-count");
const stageWorkspaceMode = document.querySelector("#stage-workspace-mode");
const stagePoseStatus = document.querySelector("#stage-pose-status");
const workspaceSummary = document.querySelector("#workspace-summary");
const viewportDockButtons = document.querySelectorAll("[data-viewport-action]");
const orientationGizmo = document.querySelector(".view-cube");
const orientationFace = orientationGizmo?.querySelector("[data-orientation-face]");
const orientationAxisElements = {
  x: orientationGizmo?.querySelector('[data-orientation-axis="x"]'),
  y: orientationGizmo?.querySelector('[data-orientation-axis="y"]'),
  z: orientationGizmo?.querySelector('[data-orientation-axis="z"]')
};
const orientationLineElements = {
  x: orientationGizmo?.querySelector('[data-orientation-line="x"]'),
  y: orientationGizmo?.querySelector('[data-orientation-line="y"]'),
  z: orientationGizmo?.querySelector('[data-orientation-line="z"]')
};

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
const orientationCameraSpace = new THREE.Vector3();
const orientationCameraQuaternion = new THREE.Quaternion();
const orientationAxes = [
  { id: "x", vector: new THREE.Vector3(1, 0, 0) },
  { id: "y", vector: new THREE.Vector3(0, 1, 0) },
  { id: "z", vector: new THREE.Vector3(0, 0, 1) }
];
const ORIENTATION_GIZMO_RADIUS_PX = 28;

const selectionHelper = new THREE.BoxHelper(new THREE.Object3D(), "#f59e0b");
selectionHelper.visible = false;
scene.add(selectionHelper);

const measurementOverlay = new THREE.Group();
measurementOverlay.name = "measurement_overlay";
scene.add(measurementOverlay);

const featureOverlay = new THREE.Group();
featureOverlay.name = "feature_overlay";
scene.add(featureOverlay);

const featureCenterHandle = new THREE.Mesh(
  new THREE.SphereGeometry(4.4, 18, 12),
  new THREE.MeshBasicMaterial({ color: "#14b8a6", depthTest: false })
);
featureCenterHandle.name = "feature_center_handle";
featureCenterHandle.renderOrder = 18;
featureCenterHandle.visible = false;
featureOverlay.add(featureCenterHandle);

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
let featureWorker = null;
let nextFeatureRequestId = 1;
let nextFeatureDetectionToken = 1;
let selectedFeatureId = null;
let selectedFeatureIds = new Set();
let featureEditHistory = [];
let transformSubject = "part";
let pointerDownState = null;
let hoveredFeatureTarget = null;
let featureDragState = null;
let lastMeasurementOverlaySignature = "";
let lastFeatureOverlaySignature = "";
let measurementState = {
  anchorA: null,
  anchorB: null,
  nextAnchor: "A",
  targetDistanceMm: 24
};
let gridVisible = true;

const loader = new STLLoader();
const gltfLoader = new GLTFLoader();
const IMPORT_COLORS = ["#2563eb", "#0f9f6e", "#b45309", "#7c3aed", "#c026d3", "#0891b2"];
const STUDIO_LAYOUT_VERSION = 2;
const FEATURE_PICK_WORLD_TOLERANCE_MM = 5;
const STUDIO_HISTORY_LIMIT = 20;
const STUDIO_HISTORY_COMMIT_DELAY_MS = 250;
const studioHistory = createHistory(null, {
  limit: STUDIO_HISTORY_LIMIT,
  clone: cloneStudioHistorySnapshot,
  equals: (left, right) => (left?.signature ?? null) === (right?.signature ?? null),
  dispose: disposeStudioHistorySnapshot
});
let studioHistoryCommitTimer = null;

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
  scheduleStudioHistoryCommit();
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
  ensurePartFeatureState(part);
  part.castShadow = true;
  part.receiveShadow = true;
  assemblyGroup.add(part);
  part.updateMatrixWorld(true);
  parts.push(part);
  partsById.set(part.userData.id, part);
  restState.restMatrices.set(part.userData.id, part.matrixWorld.clone());
  poseState.visibility[part.userData.id] = true;
}

function ensurePartFeatureState(part) {
  if (!part?.userData) return null;
  part.userData.detectedFeatures = Array.isArray(part.userData.detectedFeatures) ? part.userData.detectedFeatures : [];
  part.userData.featureDetectionState =
    Object.values(FEATURE_DETECTION_STATES).includes(part.userData.featureDetectionState)
      ? part.userData.featureDetectionState
      : part.userData.detectedFeatures.length
        ? FEATURE_DETECTION_STATES.READY
        : FEATURE_DETECTION_STATES.NOT_DETECTED;
  part.userData.featureGeometryRevision = Number.isInteger(part.userData.featureGeometryRevision)
    ? part.userData.featureGeometryRevision
    : 0;
  part.userData.featureDetectionRevision = Number.isInteger(part.userData.featureDetectionRevision)
    ? part.userData.featureDetectionRevision
    : part.userData.detectedFeatures.length
      ? part.userData.featureGeometryRevision
      : null;
  part.userData.featureDetectionError = part.userData.featureDetectionError ?? null;
  part.userData.featureDetectionToken = Number.isInteger(part.userData.featureDetectionToken)
    ? part.userData.featureDetectionToken
    : 0;
  return part.userData;
}

function partFeatureState(part) {
  return ensurePartFeatureState(part)?.featureDetectionState ?? FEATURE_DETECTION_STATES.NOT_DETECTED;
}

function partHasFreshFeatures(part) {
  const data = ensurePartFeatureState(part);
  return (
    data?.featureDetectionState === FEATURE_DETECTION_STATES.READY &&
    data.featureDetectionRevision === data.featureGeometryRevision &&
    Array.isArray(data.detectedFeatures) &&
    data.detectedFeatures.length > 0
  );
}

function canDetectPartFeatures(part) {
  return Boolean(part?.geometry?.attributes?.position);
}

function setFeatureDetectionState(part, state, options = {}) {
  const data = ensurePartFeatureState(part);
  if (!data) return;
  data.featureDetectionState = state;
  data.featureDetectionError = options.error ?? null;
  if (state === FEATURE_DETECTION_STATES.READY || state === FEATURE_DETECTION_STATES.NONE_FOUND) {
    data.featureDetectionRevision = data.featureGeometryRevision;
  }
}

function bumpFeatureGeometryRevision(part, options = {}) {
  const data = ensurePartFeatureState(part);
  if (!data) return;
  data.featureGeometryRevision += 1;
  if (options.clearFeatures === true) {
    data.detectedFeatures = [];
    if (selectedPart === part) setSelectedFeatureIds([]);
  }
  data.featureDetectionRevision = null;
  data.featureDetectionState = options.state ?? FEATURE_DETECTION_STATES.STALE;
  data.featureDetectionError = null;
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

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function cloneSnapshotMaterials(materials = []) {
  return materials.length === 1 ? materials[0] : materials;
}

function disposeMaterials(materials = []) {
  for (const material of materials) {
    material?.dispose?.();
  }
}

function disposeStudioHistorySnapshot(snapshot) {
  if (snapshot?.historyOwned === false) return;
  for (const part of snapshot?.parts ?? []) {
    part.geometry?.dispose?.();
    disposeMaterials(part.materials);
  }
}

function cloneStudioPartSnapshot(part) {
  return {
    ...part,
    userData: cloneJsonValue(part.userData),
    geometry: part.geometry?.clone?.() ?? null,
    materials: (part.materials ?? []).map((material) => material.clone()),
    restMatrix: [...(part.restMatrix ?? [])],
    position: [...(part.position ?? [])],
    quaternion: [...(part.quaternion ?? [])],
    scale: [...(part.scale ?? [])]
  };
}

function cloneStudioHistorySnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    historyOwned: true,
    groupUserData: cloneJsonValue(snapshot.groupUserData),
    poseState: cloneJsonValue(snapshot.poseState),
    measurementState: cloneJsonValue(snapshot.measurementState),
    selectedFeatureIds: [...(snapshot.selectedFeatureIds ?? [])],
    parts: (snapshot.parts ?? []).map(cloneStudioPartSnapshot)
  };
}

function materialHistorySignature(part) {
  return partMaterials(part).map((material) => ({
    color: material.color?.getHexString?.() ?? null,
    opacity: Number(Number(material.opacity ?? 1).toFixed(4)),
    transparent: material.transparent === true,
    side: material.side ?? null
  }));
}

function studioHistorySignature(snapshot) {
  return JSON.stringify({
    groupName: snapshot.groupName,
    groupUserData: snapshot.groupUserData,
    importedColorIndex: snapshot.importedColorIndex,
    layoutDirty: snapshot.layoutDirty,
    selectedPartId: snapshot.selectedPartId,
    selectedFeatureId: snapshot.selectedFeatureId,
    selectedFeatureIds: snapshot.selectedFeatureIds ?? (snapshot.selectedFeatureId ? [snapshot.selectedFeatureId] : []),
    poseState: snapshot.poseState,
    measurementState: snapshot.measurementState,
    parts: snapshot.parts.map((part) => ({
      id: part.userData?.id,
      name: part.name,
      visible: part.visible,
      userData: part.userData,
      restMatrix: part.restMatrix,
      position: part.position,
      quaternion: part.quaternion,
      scale: part.scale,
      materials: part.materialSignature,
      vertexCount: part.geometry?.attributes?.position?.count ?? 0,
      indexCount: part.geometry?.index?.count ?? 0
    }))
  });
}

function captureStudioHistorySnapshot() {
  if (!assemblyGroup || !poseState || !restState) return null;
  const snapshot = {
    historyOwned: false,
    groupName: assemblyGroup.name,
    groupUserData: cloneJsonValue(assemblyGroup.userData),
    importedColorIndex,
    layoutDirty,
    selectedPartId: selectedPart?.userData?.id ?? null,
    selectedFeatureId,
    selectedFeatureIds: [...selectedFeatureIds],
    poseState: cloneJsonValue(poseState),
    measurementState: currentStudioMeasurementState(),
    parts: parts.map((part) => {
      part.updateMatrixWorld(true);
      return {
        name: part.name,
        visible: part.visible,
        userData: cloneJsonValue(part.userData),
        geometry: part.geometry ?? null,
        materials: partMaterials(part),
        materialSignature: materialHistorySignature(part),
        restMatrix: restState.restMatrices.get(part.userData.id)?.toArray() ?? part.matrixWorld.toArray(),
        position: part.position.toArray(),
        quaternion: part.quaternion.toArray(),
        scale: part.scale.toArray()
      };
    })
  };
  snapshot.signature = studioHistorySignature(snapshot);
  return snapshot;
}

function clearPendingStudioHistoryCommit() {
  if (!studioHistoryCommitTimer) return false;
  window.clearTimeout(studioHistoryCommitTimer);
  studioHistoryCommitTimer = null;
  return true;
}

function updateStudioHistoryControls() {
  const status = historyStatus(studioHistory);
  if (undoStudioButton) undoStudioButton.disabled = !status.canUndo && !studioHistoryCommitTimer;
  if (redoStudioButton) redoStudioButton.disabled = !status.canRedo;
}

function commitStudioHistoryNow() {
  const snapshot = captureStudioHistorySnapshot();
  if (!snapshot) return;
  const committed = commitHistory(studioHistory, snapshot);
  disposeStudioHistorySnapshot(snapshot);
  disposeStudioHistorySnapshot(committed);
  updateStudioHistoryControls();
}

function scheduleStudioHistoryCommit() {
  if (!assemblyGroup || !poseState || !restState) return;
  clearPendingStudioHistoryCommit();
  studioHistoryCommitTimer = window.setTimeout(() => {
    studioHistoryCommitTimer = null;
    commitStudioHistoryNow();
  }, STUDIO_HISTORY_COMMIT_DELAY_MS);
  updateStudioHistoryControls();
}

function flushStudioHistoryCommit() {
  if (!clearPendingStudioHistoryCommit()) return;
  commitStudioHistoryNow();
}

function resetStudioHistory() {
  clearPendingStudioHistoryCommit();
  const snapshot = captureStudioHistorySnapshot();
  const reset = resetHistory(studioHistory, snapshot);
  disposeStudioHistorySnapshot(snapshot);
  disposeStudioHistorySnapshot(reset);
  updateStudioHistoryControls();
}

function restoreStudioHistorySnapshot(snapshot, message) {
  if (!snapshot) return;
  transformControls.detach();
  selectedPart = null;
  setSelectedFeatureIds([]);
  featureEditHistory = [];
  pointerDownState = null;
  hoveredFeatureTarget = null;
  featureDragState = null;
  renderer.domElement.style.cursor = "";

  for (const part of parts) {
    disposePart(part);
  }
  if (assemblyGroup) scene.remove(assemblyGroup);

  assemblyGroup = createEmptyAssembly();
  assemblyGroup.name = snapshot.groupName || assemblyGroup.name;
  assemblyGroup.userData = cloneJsonValue(snapshot.groupUserData ?? assemblyGroup.userData);
  scene.add(assemblyGroup);

  parts = [];
  partsById = new Map();
  partRowsById = new Map();
  restState = { restMatrices: new Map() };

  for (const partSnapshot of snapshot.parts ?? []) {
    const mesh = new THREE.Mesh(partSnapshot.geometry, cloneSnapshotMaterials(partSnapshot.materials));
    mesh.name = partSnapshot.name;
    mesh.userData = cloneJsonValue(partSnapshot.userData ?? {});
    mesh.position.fromArray(partSnapshot.position ?? [0, 0, 0]);
    mesh.quaternion.fromArray(partSnapshot.quaternion ?? [0, 0, 0, 1]);
    mesh.scale.fromArray(partSnapshot.scale ?? [1, 1, 1]);
    mesh.visible = partSnapshot.visible !== false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ensurePartFeatureState(mesh);
    assemblyGroup.add(mesh);
    parts.push(mesh);
    partsById.set(mesh.userData.id, mesh);
    const restMatrix = Array.isArray(partSnapshot.restMatrix)
      ? new THREE.Matrix4().fromArray(partSnapshot.restMatrix)
      : mesh.matrixWorld.clone();
    restState.restMatrices.set(mesh.userData.id, restMatrix);
  }

  poseState = normalizePose(snapshot.poseState, parts);
  importedColorIndex = snapshot.importedColorIndex ?? importedColorIndex;
  layoutDirty = snapshot.layoutDirty === true;
  selectedPart = partsById.get(snapshot.selectedPartId) ?? parts[0] ?? null;
  setSelectedFeatureIds(snapshot.selectedFeatureIds ?? (snapshot.selectedFeatureId ? [snapshot.selectedFeatureId] : []), {
    primaryId: snapshot.selectedFeatureId
  });
  if (!selectedFeatureIds.size) selectDefaultFeature(selectedPart);
  measurementState = {
    anchorA: restoreMeasurementAnchor(snapshot.measurementState?.anchorA),
    anchorB: restoreMeasurementAnchor(snapshot.measurementState?.anchorB),
    nextAnchor: snapshot.measurementState?.nextAnchor === "B" ? "B" : "A",
    targetDistanceMm: Number(snapshot.measurementState?.targetDistanceMm) || 24
  };

  buildPartsList();
  applyCurrentPose();
  updateAllControls();
  updateStudioHistoryControls();
  showStatus(message);
}

function undoStudioHistory() {
  flushStudioHistoryCommit();
  if (!historyStatus(studioHistory).canUndo) return;
  restoreStudioHistorySnapshot(undoHistory(studioHistory), "Undo");
}

function redoStudioHistory() {
  flushStudioHistoryCommit();
  if (!historyStatus(studioHistory).canRedo) return;
  restoreStudioHistorySnapshot(redoHistory(studioHistory), "Redo");
}

function triangleCount(part) {
  const geometry = part?.geometry;
  if (!geometry) return 0;
  const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
  return Math.round(count / 3);
}

function vectorToArray(vector) {
  return [vector.x, vector.y, vector.z];
}

function formatVector(values, digits = 2) {
  return values.map((value) => formatNumber(value, digits)).join(", ");
}

function ensureFeatureWorker() {
  if (!featureWorker) {
    featureWorker = new Worker(new URL("./studio/featureWorker.js", import.meta.url), { type: "module" });
  }
  return featureWorker;
}

function requestFeatureWorker(type, payload) {
  const worker = ensureFeatureWorker();
  const requestId = nextFeatureRequestId;
  nextFeatureRequestId += 1;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data?.requestId !== requestId) return;
      worker.removeEventListener("message", onMessage);
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error?.message ?? "Feature worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ requestId, type, payload });
  });
}

function selectedFeatures() {
  ensurePartFeatureState(selectedPart);
  return selectedPart?.userData?.detectedFeatures ?? [];
}

function validFeatureSelectionIds(ids, features = selectedFeatures()) {
  const available = new Set(features.map((feature) => feature.id));
  const valid = [];
  for (const id of ids ?? []) {
    if (!available.has(id) || valid.includes(id)) continue;
    valid.push(id);
  }
  return valid;
}

function setSelectedFeatureIds(ids, options = {}) {
  const features = selectedFeatures();
  const valid = validFeatureSelectionIds(ids, features);
  selectedFeatureIds = new Set(valid);
  const requestedPrimary = options.primaryId ?? selectedFeatureId;
  selectedFeatureId = valid.includes(requestedPrimary) ? requestedPrimary : valid[0] ?? null;
}

function selectDefaultFeature(part = selectedPart) {
  const firstId = part?.userData?.detectedFeatures?.[0]?.id ?? null;
  setSelectedFeatureIds(firstId ? [firstId] : [], { primaryId: firstId });
}

function selectedFeatureSelection() {
  const features = selectedFeatures();
  const selectedIds = validFeatureSelectionIds(selectedFeatureIds, features);
  if (selectedIds.length !== selectedFeatureIds.size) {
    setSelectedFeatureIds(selectedIds, { primaryId: selectedFeatureId });
  }
  return selectedIds.map((id) => features.find((feature) => feature.id === id)).filter(Boolean);
}

function selectedFeature() {
  const features = selectedFeatures();
  const primary = features.find((feature) => feature.id === selectedFeatureId);
  return primary ?? selectedFeatureSelection()[0] ?? null;
}

function canEditMeshFeatures(part) {
  return Boolean(part?.geometry?.attributes?.position);
}

function selectedPartSupportsFeatureEditing() {
  return canEditMeshFeatures(selectedPart);
}

function cloneFeatureList(features) {
  return JSON.parse(JSON.stringify(features ?? []));
}

function ensureFeatureOriginalProfile(feature) {
  if (!feature) return null;
  if (!feature.original) feature.original = featureProfile(feature);
  return feature.original;
}

function setFeatureList(part, features) {
  if (!part) return;
  ensurePartFeatureState(part);
  part.userData.detectedFeatures = cloneFeatureList(features).map((feature) => ({
    ...feature,
    original: feature.original ?? featureProfile(feature)
  }));
  part.userData.featureDetectionState = part.userData.detectedFeatures.length
    ? FEATURE_DETECTION_STATES.READY
    : FEATURE_DETECTION_STATES.NONE_FOUND;
  part.userData.featureDetectionRevision = part.userData.featureGeometryRevision;
  part.userData.featureDetectionError = null;
  if (part === selectedPart) {
    const previousIds = [...selectedFeatureIds];
    setSelectedFeatureIds(previousIds.length ? previousIds : [selectedFeatureId].filter(Boolean), { primaryId: selectedFeatureId });
    if (!selectedFeatureIds.size) selectDefaultFeature(part);
  }
}

function featureProfile(feature) {
  if (!feature) return null;
  return {
    type: feature.type,
    axis: feature.axis,
    center: [...feature.center],
    radiusMm: Number(feature.radiusMm),
    widthMm: Number(feature.widthMm ?? feature.radiusMm * 2),
    lengthMm: Number(feature.lengthMm ?? feature.radiusMm * 2),
    angleDeg: Number(feature.angleDeg ?? 0),
    depthMm: Number(feature.depthMm ?? 1)
  };
}

function selectedFeatureGroupCenter(selection = selectedFeatureSelection()) {
  if (!selection.length) return null;
  const total = selection.reduce(
    (sum, feature) => sum.map((value, axis) => value + Number(feature.center?.[axis] ?? 0)),
    [0, 0, 0]
  );
  return total.map((value) => value / selection.length);
}

function featureNumberValue(feature, key) {
  if (!feature) return null;
  if (key === "radiusMm") return Number(feature.radiusMm ?? feature.widthMm / 2);
  if (key === "lengthMm") return Number(feature.lengthMm ?? feature.radiusMm * 2);
  return Number(feature[key]);
}

function sharedFeatureNumber(selection, key, predicate = () => true) {
  const values = selection.filter(predicate).map((feature) => featureNumberValue(feature, key)).filter(Number.isFinite);
  if (!values.length) return null;
  const first = values[0];
  return values.every((value) => Math.abs(value - first) <= 0.001) ? first : null;
}

function setFeatureInputValue(input, value, digits = 2) {
  if (!input) return;
  input.value = Number.isFinite(value) ? Number(value).toFixed(digits) : "";
  input.placeholder = Number.isFinite(value) ? "" : "Mixed";
}

function updateFeatureFromInputs() {
  const selection = selectedFeatureSelection();
  if (!selection.length) return [];
  for (const feature of selection) ensureFeatureOriginalProfile(feature);
  const previousCenter = selectedFeatureGroupCenter(selection);
  const nextCenter = [...previousCenter];
  for (const input of featureCenterInputs) {
    const axis = Number(input.dataset.axis);
    const value = Number(input.value);
    if (Number.isFinite(value)) nextCenter[axis] = value;
  }
  const centerDelta = nextCenter.map((value, axis) => value - previousCenter[axis]);
  if (centerDelta.some((value) => Math.abs(value) > 1e-9)) {
    for (const feature of selection) {
      feature.center = feature.center.map((value, axis) => value + centerDelta[axis]);
    }
  }
  const radius = Number(featureRadiusInput?.value);
  if (Number.isFinite(radius) && radius > 0) {
    for (const feature of selection) {
      feature.radiusMm = radius;
      feature.widthMm = radius * 2;
    }
  }
  const length = Number(featureLengthInput?.value);
  if (Number.isFinite(length) && length > 0) {
    for (const feature of selection.filter((item) => item.type === "roundedSlot")) {
      feature.lengthMm = length;
    }
  }
  const angle = Number(featureAngleInput?.value);
  if (Number.isFinite(angle)) {
    for (const feature of selection.filter((item) => item.type === "roundedSlot")) {
      feature.angleDeg = angle;
    }
  }
  return selection;
}

function bufferGeometryFromMeshData(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3));
  if (mesh.normals?.length === mesh.vertices?.length) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function replacePartGeometry(part, mesh, options = {}) {
  const nextGeometry = bufferGeometryFromMeshData(mesh);
  part.geometry?.dispose?.();
  part.geometry = nextGeometry;
  part.updateMatrixWorld(true);
  if (options.preserveFeatureCache !== true) {
    bumpFeatureGeometryRevision(part, { clearFeatures: true });
  }
}

function partLocalToWorld(part, point) {
  return part.localToWorld(new THREE.Vector3(point[0], point[1], point[2]));
}

function partWorldToLocal(part, vector) {
  const local = part.worldToLocal(vector.clone());
  return [local.x, local.y, local.z];
}

const FEATURE_AXIS_PLANES = Object.freeze({
  x: { u: 1, v: 2 },
  y: { u: 0, v: 2 },
  z: { u: 0, v: 1 }
});

function featureSlotDirection(feature) {
  const plane = FEATURE_AXIS_PLANES[feature.axis] ?? FEATURE_AXIS_PLANES.y;
  const angle = ((feature.angleDeg ?? 0) * Math.PI) / 180;
  const direction = [0, 0, 0];
  direction[plane.u] = Math.cos(angle);
  direction[plane.v] = Math.sin(angle);
  return direction;
}

function featureLocalEndpoints(feature) {
  if (feature.type !== "roundedSlot") return null;
  const radius = (feature.widthMm ?? feature.radiusMm * 2) / 2;
  const halfStraight = Math.max(0, (feature.lengthMm ?? radius * 2) / 2 - radius);
  const direction = featureSlotDirection(feature);
  return [
    feature.center.map((value, index) => value - direction[index] * halfStraight),
    feature.center.map((value, index) => value + direction[index] * halfStraight)
  ];
}

function worldFeatureForAnchor(feature, part) {
  if (!feature || !part) return null;
  const endpoints = featureLocalEndpoints(feature);
  return {
    ...feature,
    worldCenter: vectorToArray(partLocalToWorld(part, feature.center)),
    worldEndpoints: endpoints?.map((point) => vectorToArray(partLocalToWorld(part, point))) ?? null
  };
}

function anchorFromFeature(feature = selectedFeature(), part = selectedPart) {
  const worldFeature = worldFeatureForAnchor(feature, part);
  return worldFeature ? createFeatureAnchor(worldFeature, { label: `${part.userData.id} ${feature.label ?? feature.id}` }) : null;
}

function featureByTarget(target) {
  const part = target?.partId ? partsById.get(target.partId) : null;
  const feature = part?.userData?.detectedFeatures?.find((item) => item.id === target.featureId) ?? null;
  return { part, feature };
}

function anchorFromFeatureTarget(target) {
  const { part, feature } = featureByTarget(target);
  if (!part || !feature) return null;
  const worldFeature = worldFeatureForAnchor(feature, part);
  return createFeatureAnchor(worldFeature, {
    label: featureAnchorLabel(part.userData.id, feature, target),
    role: featureAnchorRole(target),
    endpointIndex: target.endpointIndex
  });
}

function anchorFromPartCenter(part = selectedPart) {
  if (!part) return null;
  const box = new THREE.Box3().setFromObject(part);
  return createMeasurementAnchor({
    type: "partBoundsCenter",
    partId: part.userData.id,
    label: `${part.userData.id} bounds center`,
    worldPosition: vectorToArray(box.getCenter(new THREE.Vector3()))
  });
}

function setMeasurementAnchor(name, anchor) {
  if (!anchor) return;
  if (name === "A") {
    measurementState.anchorA = anchor;
    measurementState.nextAnchor = "B";
  } else {
    measurementState.anchorB = anchor;
    measurementState.nextAnchor = "A";
  }
  updateMeasurementControls();
  renderMeasurementOverlay();
}

function setMeasurementPickTarget(target) {
  measurementState.nextAnchor = target === "B" ? "B" : "A";
  updateMeasurementControls();
}

function currentMeasurement() {
  return measureAnchors(measurementState.anchorA, measurementState.anchorB, { activePlane: "xz" });
}

function measurementTarget() {
  const preset = SERVO_HORN_SPACING_PRESETS.find((item) => item.id === measurementPreset?.value);
  const value = Number(preset?.targetDistanceMm ?? measurementTargetDistance?.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
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
  updateStudioHistoryControls();
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

function disposeOverlayChildren(group, keep = new Set()) {
  for (const child of [...group.children]) {
    if (keep.has(child)) continue;
    group.remove(child);
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
    child.material?.map?.dispose?.();
  }
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function createMeasurementLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 280;
  canvas.height = 76;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawRoundedRect(context, 14, 12, canvas.width - 28, canvas.height - 24, 13);
  context.fillStyle = "rgba(21, 35, 56, 0.86)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.font = "800 25px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(46, 12.5, 1);
  sprite.renderOrder = 22;
  return sprite;
}

function createMeasurementAnchorMarker(position, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  context.arc(48, 48, 28, 0, Math.PI * 2);
  context.strokeStyle = color;
  context.lineWidth = 7;
  context.stroke();
  context.beginPath();
  context.arc(48, 48, 8, 0, Math.PI * 2);
  context.fillStyle = color;
  context.globalAlpha = 0.78;
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true
  }));
  marker.position.fromArray(position);
  marker.scale.set(14, 14, 1);
  marker.renderOrder = 20;
  return marker;
}

function measurementLabelOffsetDirection(start, end) {
  camera.updateMatrixWorld(true);
  const cameraRight = new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld).normalize();
  const cameraUp = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld).normalize();
  const delta = new THREE.Vector3().subVectors(end, start);
  const screenX = delta.dot(cameraRight);
  const screenY = delta.dot(cameraUp);
  const offset = new THREE.Vector3()
    .copy(cameraRight)
    .multiplyScalar(-screenY)
    .addScaledVector(cameraUp, screenX);
  if (offset.lengthSq() < 1e-6) return cameraUp;
  return offset.normalize();
}

function trimmedMeasurementLinePoints(start, end, trimDistance = 8) {
  const delta = new THREE.Vector3().subVectors(end, start);
  const length = delta.length();
  if (length <= trimDistance * 2.5) return null;
  const direction = delta.divideScalar(length);
  return [
    start.clone().addScaledVector(direction, trimDistance),
    end.clone().addScaledVector(direction, -trimDistance)
  ];
}

function measurementOverlaySignature() {
  const measurement = currentMeasurement();
  return JSON.stringify({
    a: measurementState.anchorA?.worldPosition ?? null,
    b: measurementState.anchorB?.worldPosition ?? null,
    d: measurement.ready ? Number(measurement.distanceMm.toFixed(3)) : null,
    camera: camera.quaternion.toArray().map((value) => Number(value.toFixed(3)))
  });
}

function renderMeasurementOverlay(options = {}) {
  const signature = measurementOverlaySignature();
  if (options.force !== true && signature === lastMeasurementOverlaySignature) return;
  lastMeasurementOverlaySignature = signature;
  disposeOverlayChildren(measurementOverlay);
  const a = measurementState.anchorA?.worldPosition;
  const b = measurementState.anchorB?.worldPosition;
  if (a) measurementOverlay.add(createMeasurementAnchorMarker(a, "#2563eb"));
  if (b) measurementOverlay.add(createMeasurementAnchorMarker(b, "#f97316"));
  if (!a || !b) return;

  const start = new THREE.Vector3().fromArray(a);
  const end = new THREE.Vector3().fromArray(b);
  const linePoints = trimmedMeasurementLinePoints(start, end);
  if (linePoints) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linePoints),
      new THREE.LineBasicMaterial({
        color: "#334155",
        depthTest: false,
        transparent: true,
        opacity: 0.42
      })
    );
    line.renderOrder = 18;
    measurementOverlay.add(line);
  }

  const measurement = currentMeasurement();
  const label = createMeasurementLabel(`${formatMeasurement(measurement.distanceMm)} mm`);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const offsetDirection = measurementLabelOffsetDirection(start, end);
  const labelOffset = Math.max(22, Math.min(48, measurement.distanceMm * 0.55));
  label.position.copy(midpoint).addScaledVector(offsetDirection, labelOffset);
  measurementOverlay.add(label);
}

function featureOutlinePoints(feature) {
  if (!feature) return [];
  const points = [];
  const plane = FEATURE_AXIS_PLANES[feature.axis] ?? FEATURE_AXIS_PLANES.y;
  const radius = Number(feature.radiusMm ?? feature.widthMm / 2);
  if (feature.type !== "roundedSlot") {
    for (let index = 0; index < 72; index += 1) {
      const angle = (index / 72) * Math.PI * 2;
      const point = [...feature.center];
      point[plane.u] += Math.cos(angle) * radius;
      point[plane.v] += Math.sin(angle) * radius;
      points.push(point);
    }
    return points;
  }

  const width = Number(feature.widthMm ?? radius * 2);
  const length = Number(feature.lengthMm ?? width);
  const halfStraight = Math.max(0, length / 2 - width / 2);
  const direction = featureSlotDirection(feature);
  const normal = [0, 0, 0];
  normal[plane.u] = -direction[plane.v];
  normal[plane.v] = direction[plane.u];
  const left = feature.center.map((value, axis) => value - direction[axis] * halfStraight);
  const right = feature.center.map((value, axis) => value + direction[axis] * halfStraight);
  for (let index = 0; index <= 24; index += 1) {
    const angle = Math.PI / 2 - (index / 24) * Math.PI;
    points.push(right.map((value, axis) => value + direction[axis] * Math.cos(angle) * radius + normal[axis] * Math.sin(angle) * radius));
  }
  for (let index = 0; index <= 24; index += 1) {
    const angle = -Math.PI / 2 - (index / 24) * Math.PI;
    points.push(left.map((value, axis) => value + direction[axis] * Math.cos(angle) * radius + normal[axis] * Math.sin(angle) * radius));
  }
  return points;
}

function featureOverlaySignature() {
  if (!selectedPart) return "none";
  selectedPart.updateMatrixWorld(true);
  return JSON.stringify({
    partId: selectedPart.userData.id,
    mode: studioMode,
    selectedFeatureId,
    selectedFeatureIds: [...selectedFeatureIds],
    matrix: selectedPart.matrixWorld.elements.map((value) => Number(value.toFixed(3))),
    state: partFeatureState(selectedPart),
    features: selectedFeatures().map((feature) => ({
      id: feature.id,
      type: feature.type,
      center: feature.center?.map((value) => Number(Number(value).toFixed(3))),
      radiusMm: Number(Number(feature.radiusMm ?? 0).toFixed(3)),
      widthMm: Number(Number(feature.widthMm ?? 0).toFixed(3)),
      lengthMm: Number(Number(feature.lengthMm ?? 0).toFixed(3)),
      angleDeg: Number(Number(feature.angleDeg ?? 0).toFixed(3))
    }))
  });
}

function renderFeatureOverlay(options = {}) {
  const signature = featureOverlaySignature();
  if (options.force !== true && signature === lastFeatureOverlaySignature) return;
  lastFeatureOverlaySignature = signature;
  disposeOverlayChildren(featureOverlay, new Set([featureCenterHandle]));
  const selection = selectedFeatureSelection();
  const selectedIds = new Set(selection.map((feature) => feature.id));
  const groupCenter = selectedFeatureGroupCenter(selection);
  featureCenterHandle.visible = false;
  if (!selectedPart || studioMode !== "feature") return;

  for (const item of selectedFeatures()) {
    const selected = selectedIds.has(item.id);
    const color = item.id === selectedFeatureId ? "#0f766e" : selected ? "#14b8a6" : "#64748b";
    const points = featureOutlinePoints(item).map((point) => partLocalToWorld(selectedPart, point));
    if (points.length < 3) continue;
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, depthTest: false })
    );
    line.renderOrder = selected ? 17 : 16;
    featureOverlay.add(line);
  }

  if (!groupCenter) return;
  featureCenterHandle.position.copy(partLocalToWorld(selectedPart, groupCenter));
  featureCenterHandle.visible = studioMode === "feature";
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
    window.location.href = `${import.meta.env.BASE_URL}physics.html?fromAssembly=1`;
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
      pose: JSON.parse(serializePose(poseState)),
      measurements: currentStudioMeasurementState(),
      detectedFeatures: currentFeatureMetadata()
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
      if (parsed.measurements) {
        measurementState.anchorA = restoreMeasurementAnchor(parsed.measurements.anchorA);
        measurementState.anchorB = restoreMeasurementAnchor(parsed.measurements.anchorB);
        measurementState.nextAnchor = parsed.measurements.nextAnchor === "B" ? "B" : "A";
        measurementState.targetDistanceMm = Number(parsed.measurements.targetDistanceMm) || measurementState.targetDistanceMm;
        if (measurementTargetDistance) measurementTargetDistance.value = measurementState.targetDistanceMm.toFixed(2);
      }
      for (const record of parsed.detectedFeatures ?? []) {
        const part = partsById.get(record.partId);
        if (part) {
          ensurePartFeatureState(part);
          setFeatureList(part, record.features);
        }
      }
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
  renderFeatureOverlay();
  renderMeasurementOverlay();
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
      measure: ["Pick A or B", "Click holes/slots or surfaces"],
      feature: ["Click a part to detect holes/slots", "Select one or more detected features", "Drag or edit fields, then apply"],
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
  transformSubject = "part";

  const featureSelection = selectedFeatureSelection();
  const groupCenter = selectedFeatureGroupCenter(featureSelection);
  if (studioMode === "feature" && selectedPart && featureSelection.length && groupCenter && selectedPartSupportsFeatureEditing()) {
    featureCenterHandle.position.copy(partLocalToWorld(selectedPart, groupCenter));
    transformControls.enabled = true;
    transformControls.setMode("translate");
    transformControls.attach(featureCenterHandle);
    transformSubject = "feature";
    return;
  }

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
  renderFeatureOverlay({ force: true });
  renderMeasurementOverlay({ force: true });
  maybeAutoDetectSelectedFeatures();
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

function updateMeasurementControls() {
  const measurement = currentMeasurement();
  if (measurementAnchorA) measurementAnchorA.textContent = measurementState.anchorA?.label ?? "-";
  if (measurementAnchorB) measurementAnchorB.textContent = measurementState.anchorB?.label ?? "-";
  if (measurementDistance) measurementDistance.textContent = measurement.ready ? `${formatMeasurement(measurement.distanceMm)} mm` : "-";
  if (measurementProjected) {
    measurementProjected.textContent = measurement.ready ? `${formatMeasurement(measurement.projectedDistanceMm)} mm` : "-";
  }
  if (measurementDelta) measurementDelta.textContent = measurement.ready ? `${formatVector(measurement.deltaMm, 2)} mm` : "-";
  if (measurementClearance) {
    measurementClearance.textContent = measurement.edgeClearanceMm == null ? "-" : `${formatMeasurement(measurement.edgeClearanceMm)} mm`;
  }
  if (measurementNextPick) measurementNextPick.textContent = measurementState.nextAnchor;
  if (measurementPickAButton) {
    const active = measurementState.nextAnchor === "A";
    measurementPickAButton.classList.toggle("is-active", active);
    measurementPickAButton.setAttribute("aria-pressed", String(active));
  }
  if (measurementPickBButton) {
    const active = measurementState.nextAnchor === "B";
    measurementPickBButton.classList.toggle("is-active", active);
    measurementPickBButton.setAttribute("aria-pressed", String(active));
  }

  const hasSelection = Boolean(selectedPart);
  const hasFeature = Boolean(selectedFeature());
  if (measureAnchorAPartButton) measureAnchorAPartButton.disabled = !hasSelection;
  if (measureAnchorBPartButton) measureAnchorBPartButton.disabled = !hasSelection;
  if (measureAnchorAFeatureButton) measureAnchorAFeatureButton.disabled = !hasFeature;
  if (measureAnchorBFeatureButton) measureAnchorBFeatureButton.disabled = !hasFeature;
  if (measurementUseCurrentButton) measurementUseCurrentButton.disabled = !measurement.ready;
  if (measurementApplySpacingButton) {
    measurementApplySpacingButton.disabled =
      !measurement.ready ||
      measurementTarget() <= 0 ||
      !isSpacingPairSupported(measurementState.anchorA, measurementState.anchorB, {
        isPartEditable: (partId) => partsById.get(partId)?.userData?.type === "imported"
      });
  }
}

function updateFeatureControls() {
  const features = selectedFeatures();
  const feature = selectedFeature();
  const featureSelection = selectedFeatureSelection();
  const selectedIds = new Set(featureSelection.map((item) => item.id));
  const selectionCount = featureSelection.length;
  const groupCenter = selectedFeatureGroupCenter(featureSelection);
  const selectedSlots = featureSelection.filter((item) => item.type === "roundedSlot");
  const hasSelection = Boolean(selectedPart);
  const canEdit = selectedPartSupportsFeatureEditing();
  const detectionState = selectedPart ? partFeatureState(selectedPart) : FEATURE_DETECTION_STATES.NOT_DETECTED;
  const partLabel = selectedPart?.userData?.label ?? selectedPart?.userData?.id ?? "part";

  if (featureDetectionStatus) {
    if (!hasSelection) {
      featureDetectionStatus.textContent = "Select a part, then click Detect Holes";
    } else if (detectionState === FEATURE_DETECTION_STATES.DETECTING) {
      featureDetectionStatus.textContent = `Detecting ${partLabel}...`;
    } else if (detectionState === FEATURE_DETECTION_STATES.ERROR) {
      featureDetectionStatus.textContent = `Detection failed: ${selectedPart.userData.featureDetectionError ?? "unknown error"}`;
    } else if (features.length && detectionState === FEATURE_DETECTION_STATES.READY) {
      const selectedText = selectionCount ? `, ${selectionCount} selected` : "";
      featureDetectionStatus.textContent = `${features.length} feature${features.length === 1 ? "" : "s"} ready${selectedText}${canEdit ? "" : " (measurement only)"}`;
    } else if (detectionState === FEATURE_DETECTION_STATES.NONE_FOUND) {
      featureDetectionStatus.textContent = `No through-holes/slots found${canEdit ? "" : " (measurement only)"}`;
    } else if (detectionState === FEATURE_DETECTION_STATES.STALE) {
      featureDetectionStatus.textContent = "Geometry changed; redetect holes/slots";
    } else {
      featureDetectionStatus.textContent = canEdit
        ? "Click Detect Holes, or click the part in Feature mode"
        : "Measurement only: detect features for snapping";
    }
  }

  if (featureSelect) {
    featureSelect.disabled = !features.length;
    featureSelect.replaceChildren(
      ...(features.length
        ? features.map((item) => {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = `${item.label ?? item.id} / ${item.type === "roundedSlot" ? "slot" : "hole"}`;
            option.selected = selectedIds.has(item.id);
            return option;
          })
        : [new Option("No detected features", "")])
    );
  }

  for (const input of featureCenterInputs) {
    const axis = Number(input.dataset.axis);
    input.disabled = !selectionCount || !canEdit;
    input.value = groupCenter ? Number(groupCenter[axis]).toFixed(2) : "0";
    input.placeholder = "";
  }
  if (featureRadiusInput) {
    featureRadiusInput.disabled = !selectionCount || !canEdit;
    setFeatureInputValue(featureRadiusInput, sharedFeatureNumber(featureSelection, "radiusMm"), 2);
  }
  if (featureLengthInput) {
    featureLengthInput.disabled = !selectedSlots.length || !canEdit;
    setFeatureInputValue(featureLengthInput, sharedFeatureNumber(featureSelection, "lengthMm", (item) => item.type === "roundedSlot"), 2);
  }
  if (featureAngleInput) {
    featureAngleInput.disabled = !selectedSlots.length || !canEdit;
    setFeatureInputValue(featureAngleInput, sharedFeatureNumber(featureSelection, "angleDeg", (item) => item.type === "roundedSlot"), 1);
  }
  if (featureConfidence) {
    featureConfidence.textContent = selectionCount > 1
      ? `${selectionCount} selected`
      : feature
        ? `${Math.round((feature.confidence ?? 0) * 100)}%`
        : "-";
  }
  if (featureDetectButton) featureDetectButton.disabled = !hasSelection || !canDetectPartFeatures(selectedPart) || detectionState === FEATURE_DETECTION_STATES.DETECTING;
  if (featurePreviewButton) featurePreviewButton.disabled = !selectionCount;
  if (featureApplyButton) featureApplyButton.disabled = !selectionCount || !canEdit;
  if (featureUndoButton) featureUndoButton.disabled = !featureEditHistory.length;

  updateMeasurementControls();
  renderFeatureOverlay();
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
  updateFeatureControls();
  updateMeasurementControls();
  updateModeButtons();
  updateTransformAttachment();
  updateSelectionHelper();
  renderMeasurementOverlay();
  updateJointHelper();
  updatePartRows();
  updateSceneControls();
}

function selectPart(part) {
  const previousPartId = selectedPart?.userData?.id ?? null;
  selectedPart = part?.visible ? part : null;
  ensurePartFeatureState(selectedPart);
  if ((selectedPart?.userData?.id ?? null) !== previousPartId) {
    selectDefaultFeature(selectedPart);
  }
  syncJointToSelectedPart();
  updateSelectedInspector();
  updateFeatureControls();
  updateMeasurementControls();
  updateSelectionHelper();
  updateTransformAttachment();
  updatePartRows();
  renderFeatureOverlay();
  maybeAutoDetectSelectedFeatures();
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

async function detectFeaturesForPart(part, options = {}) {
  if (!part) throw new Error("Select a part before detecting features.");
  if (!canDetectPartFeatures(part)) throw new Error("Selected part has no mesh geometry to inspect.");
  ensurePartFeatureState(part);
  const token = nextFeatureDetectionToken;
  nextFeatureDetectionToken += 1;
  part.userData.featureDetectionToken = token;
  setFeatureDetectionState(part, FEATURE_DETECTION_STATES.DETECTING);
  if (part === selectedPart) updateFeatureControls();
  try {
    const response = await requestFeatureWorker("detectFeatures", {
      partId: part.userData.id,
      geometry: meshPayloadFromBufferGeometry(part.geometry)
    });
    if (part.userData.featureDetectionToken !== token || partsById.get(part.userData.id) !== part) {
      return part.userData.detectedFeatures ?? [];
    }
    setFeatureList(part, response.features ?? []);
    if (part === selectedPart) updateFeatureControls();
    renderFeatureOverlay();
    if (options.showStatus !== false) {
      showStatus(response.features?.length ? `Detected ${response.features.length} feature${response.features.length === 1 ? "" : "s"}` : "No hole or slot features detected", 3600);
    }
    return response.features ?? [];
  } catch (error) {
    if (part.userData.featureDetectionToken === token) {
      setFeatureDetectionState(part, FEATURE_DETECTION_STATES.ERROR, { error: error.message ?? "Detection failed" });
      if (part === selectedPart) updateFeatureControls();
    }
    if (options.showStatus !== false) showStatus(error.message ?? "Feature detection failed", 5200);
    throw error;
  } finally {
    if (part === selectedPart) updateFeatureControls();
  }
}

async function detectFeaturesForSelectedPart(options = {}) {
  return detectFeaturesForPart(selectedPart, options);
}

function selectedPartNeedsFeatureDetection() {
  if (!selectedPart || !canDetectPartFeatures(selectedPart)) return false;
  const state = partFeatureState(selectedPart);
  return (
    state === FEATURE_DETECTION_STATES.NOT_DETECTED ||
    state === FEATURE_DETECTION_STATES.STALE ||
    state === FEATURE_DETECTION_STATES.ERROR ||
    (state === FEATURE_DETECTION_STATES.READY && selectedPart.userData.featureDetectionRevision !== selectedPart.userData.featureGeometryRevision)
  );
}

function maybeAutoDetectSelectedFeatures() {
  if (studioMode !== "feature" || !selectedPart || !selectedPartNeedsFeatureDetection()) return;
  detectFeaturesForSelectedPart({ showStatus: false }).catch(() => {});
}

function currentEditedFeaturePairs() {
  const beforeEdit = selectedFeatureSelection().map((feature) => ({
    feature,
    originalFeature: ensureFeatureOriginalProfile(feature)
  }));
  const selection = updateFeatureFromInputs();
  if (!selection.length) throw new Error("Select one or more detected features first.");
  const originalById = new Map(beforeEdit.map((entry) => [entry.feature.id, entry.originalFeature]));
  return selection.map((feature) => ({
    feature,
    originalFeature: originalById.get(feature.id) ?? featureProfile(feature),
    editedFeature: {
      ...feature,
      ...featureProfile(feature)
    }
  }));
}

async function applyFeatureEditsForPart(part, featureEdits) {
  if (!part || !featureEdits?.length) throw new Error("Select one or more detected features first.");
  if (!canEditMeshFeatures(part)) throw new Error("Selected part mesh cannot be edited in Feature mode.");

  const oldGeometry = part.geometry.clone();
  const oldFeatures = cloneFeatureList(part.userData.detectedFeatures);
  const originalSelected = selectedFeatureId;
  const originalSelectedIds = [...selectedFeatureIds];
  featureApplyButton.disabled = true;
  showStatus(featureEdits.length === 1 ? "Applying feature edit..." : `Applying ${featureEdits.length} feature edits...`, 10000);

  try {
    const response = await requestFeatureWorker("applyFeatureEdits", {
      geometry: meshPayloadFromBufferGeometry(part.geometry),
      edits: featureEdits.map(({ feature, originalFeature, editedFeature }) => ({
        originalFeature: originalFeature ?? feature,
        editedFeature
      }))
    });
    featureEditHistory.push({
      part,
      geometry: oldGeometry,
      features: oldFeatures,
      selectedFeatureId: originalSelected,
      selectedFeatureIds: originalSelectedIds
    });
    replacePartGeometry(part, response.mesh, { preserveFeatureCache: true });
    const data = ensurePartFeatureState(part);
    data.featureGeometryRevision += 1;
    for (const { feature, editedFeature } of featureEdits) {
      Object.assign(feature, editedFeature, featureProfile(editedFeature));
      feature.original = featureProfile(feature);
    }
    setFeatureDetectionState(part, FEATURE_DETECTION_STATES.READY);
    updateFeatureControls();
    updateSelectedInspector();
    renderFeatureOverlay();
    detectFeaturesForPart(part, { showStatus: false }).catch(() => {});
    markDirty(`${featureEdits.length === 1 ? "Feature" : "Features"} edited (${response.mesh?.method ?? "mesh"})`);
    return response.mesh;
  } catch (error) {
    oldGeometry.dispose?.();
    showStatus(error.message ?? "Feature edit failed", 6200);
    throw error;
  } finally {
    featureApplyButton.disabled = !selectedFeature() || !selectedPartSupportsFeatureEditing();
  }
}

async function applyFeatureEditForPart(part, feature, editedFeature = feature) {
  return applyFeatureEditsForPart(part, [{ feature, editedFeature }]);
}

async function applySelectedFeatureEdit() {
  return applyFeatureEditsForPart(selectedPart, currentEditedFeaturePairs());
}

function undoLastFeatureEdit() {
  const entry = featureEditHistory.pop();
  if (!entry) return;
  entry.part.geometry?.dispose?.();
  entry.part.geometry = entry.geometry;
  ensurePartFeatureState(entry.part);
  entry.part.userData.featureGeometryRevision += 1;
  setFeatureList(entry.part, entry.features);
  if (entry.part === selectedPart) {
    setSelectedFeatureIds(entry.selectedFeatureIds ?? [entry.selectedFeatureId].filter(Boolean), {
      primaryId: entry.selectedFeatureId
    });
  }
  entry.part.updateMatrixWorld(true);
  updateAllControls();
  markDirty("Feature edit undone");
}

function localDeltaFromWorldMove(part, worldPosition, worldMove) {
  const start = part.worldToLocal(new THREE.Vector3().fromArray(worldPosition));
  const end = part.worldToLocal(new THREE.Vector3().fromArray(worldPosition).add(new THREE.Vector3().fromArray(worldMove)));
  return [end.x - start.x, end.y - start.y, end.z - start.z];
}

async function applyFeatureSpacing() {
  if (
    !isSpacingPairSupported(measurementState.anchorA, measurementState.anchorB, {
      isPartEditable: (partId) => partsById.get(partId)?.userData?.type === "imported"
    })
  ) {
    throw new Error("Apply Spacing supports same imported-part features or cross-part anchor spacing.");
  }
  const target = measurementTarget();
  const adjustment = spacingAdjustmentForTarget(measurementState.anchorA, measurementState.anchorB, target, {
    symmetric: measurementSymmetricToggle?.checked === true
  });
  if (!adjustment.ok) throw new Error(adjustment.reason);

  const { anchorA, anchorB } = measurementState;
  if (anchorA?.featureId && anchorB?.featureId && anchorA.partId === anchorB.partId) {
    const part = partsById.get(anchorB.partId);
    if (!part) throw new Error("Measured feature part is not available.");
    selectPart(part);
    const moves = [
      measurementSymmetricToggle?.checked === true ? ["A", anchorA, adjustment.moveA] : null,
      ["B", anchorB, adjustment.moveB]
    ].filter(Boolean);
    for (const [_name, anchor, move] of moves) {
      const feature = part.userData.detectedFeatures?.find((item) => item.id === anchor.featureId);
      if (!feature) throw new Error(`Feature is no longer available: ${anchor.featureId}`);
      const localDelta = localDeltaFromWorldMove(part, anchor.worldPosition, move);
      const edited = {
        ...feature,
        center: feature.center.map((value, index) => value + localDelta[index])
      };
      setSelectedFeatureIds([feature.id], { primaryId: feature.id });
      await applyFeatureEditForPart(part, feature, edited);
    }
    measurementState.anchorA = anchorFromFeature(part.userData.detectedFeatures.find((item) => item.id === anchorA.featureId), part);
    measurementState.anchorB = anchorFromFeature(part.userData.detectedFeatures.find((item) => item.id === anchorB.featureId), part);
    updateMeasurementControls();
    renderMeasurementOverlay();
    return;
  }

  const partToMove = partsById.get(anchorB?.partId);
  if (!partToMove) throw new Error("Anchor B must belong to a part for cross-part spacing.");
  selectPart(partToMove);
  const transform = getPartOffsetTransform(poseState, partToMove.userData.id);
  transform.position = transform.position.map((value, index) => value + adjustment.moveB[index]);
  setPartOffsetTransform(poseState, partToMove.userData.id, transform);
  applyCurrentPose();
  measurementState.anchorB = {
    ...anchorB,
    worldPosition: anchorB.worldPosition.map((value, index) => value + adjustment.moveB[index])
  };
  updateAllControls();
  markDirty("Part spacing adjusted");
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
  setSelectedFeatureIds([]);
  featureEditHistory = featureEditHistory.filter((entry) => entry.part?.userData?.id !== partId);
  if (measurementState.anchorA?.partId === partId) measurementState.anchorA = null;
  if (measurementState.anchorB?.partId === partId) measurementState.anchorB = null;
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
  setSelectedFeatureIds([]);
  featureEditHistory = [];
  pointerDownState = null;
  hoveredFeatureTarget = null;
  renderer.domElement.style.cursor = "";
  measurementState = {
    anchorA: null,
    anchorB: null,
    nextAnchor: "A",
    targetDistanceMm: 24
  };
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

function serializeMeasurementAnchor(anchor) {
  if (!anchor) return null;
  return {
    type: anchor.type,
    label: anchor.label,
    partId: anchor.partId ?? null,
    featureId: anchor.featureId ?? null,
    role: anchor.role ?? null,
    worldPosition: anchor.worldPosition ?? null,
    localPosition: anchor.localPosition ?? null,
    edgeOffsetMm: anchor.edgeOffsetMm ?? 0
  };
}

function restoreMeasurementAnchor(anchor) {
  return anchor ? createMeasurementAnchor(anchor) : null;
}

function currentStudioMeasurementState() {
  return {
    anchorA: serializeMeasurementAnchor(measurementState.anchorA),
    anchorB: serializeMeasurementAnchor(measurementState.anchorB),
    nextAnchor: measurementState.nextAnchor,
    targetDistanceMm: measurementTarget()
  };
}

function currentFeatureMetadata() {
  return parts
    .filter((part) => part.userData.detectedFeatures?.length)
    .map((part) => ({
      partId: part.userData.id,
      features: cloneFeatureList(part.userData.detectedFeatures).map((feature) => ({
        id: feature.id,
        type: feature.type,
        axis: feature.axis,
        center: feature.center,
        radiusMm: feature.radiusMm,
        widthMm: feature.widthMm ?? null,
        lengthMm: feature.lengthMm ?? null,
        angleDeg: feature.angleDeg ?? 0,
        confidence: feature.confidence ?? null
      }))
    }));
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

function moveSelectedFeatureGroupToLocalCenter(part, nextCenter, selection = selectedFeatureSelection()) {
  if (!part || !selection.length || !nextCenter) return false;
  for (const feature of selection) ensureFeatureOriginalProfile(feature);
  const previousCenter = selectedFeatureGroupCenter(selection);
  if (!previousCenter) return false;
  const delta = nextCenter.map((value, axis) => value - previousCenter[axis]);
  for (const feature of selection) {
    feature.center = feature.center.map((value, axis) => value + delta[axis]);
  }
  return true;
}

function captureFeatureCenterFromTransformControls() {
  const selection = selectedFeatureSelection();
  if (!selection.length || !selectedPart) return;
  moveSelectedFeatureGroupToLocalCenter(selectedPart, partWorldToLocal(selectedPart, featureCenterHandle.position), selection);
  updateFeatureControls();
  renderFeatureOverlay();
  updateMeasurementControls();
}

function featureAxisWorldNormal(part, feature) {
  const axisVector =
    feature?.axis === "x"
      ? new THREE.Vector3(1, 0, 0)
      : feature?.axis === "z"
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0, 1, 0);
  part.updateMatrixWorld(true);
  return axisVector.transformDirection(part.matrixWorld).normalize();
}

function pointerHitsTransformControls(event) {
  if (!transformControls.enabled) return false;
  pointerContext(event);
  const helper = transformControls.getHelper?.();
  if (!helper) return false;
  return raycaster.intersectObject(helper, true).length > 0;
}

function beginFeatureDirectDrag(event, target) {
  if (!target || pointerHitsTransformControls(event)) return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey) return false;
  const { part, feature } = featureByTarget(target);
  if (!part || !feature || !canEditMeshFeatures(part)) return false;
  if (selectedPart !== part || !selectedFeatureIds.has(feature.id)) {
    selectFeatureTarget(target, { showStatus: false });
  }
  const selection = selectedFeatureSelection();
  const groupCenter = selectedFeatureGroupCenter(selection);
  if (!selection.length || !groupCenter) return false;
  const worldCenter = partLocalToWorld(part, groupCenter);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(featureAxisWorldNormal(part, feature), worldCenter);
  const startPlanePoint = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, startPlanePoint)) return false;
  featureDragState = {
    pointerId: event.pointerId,
    part,
    feature,
    selection,
    plane,
    dragOffset: worldCenter.clone().sub(startPlanePoint)
  };
  controls.enabled = false;
  pointerDownState = null;
  event.preventDefault();
  event.stopImmediatePropagation?.();
  return true;
}

function updateFeatureDirectDrag(event) {
  if (!featureDragState) return false;
  if (event.pointerId !== featureDragState.pointerId) return true;
  pointerContext(event);
  const planePoint = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(featureDragState.plane, planePoint)) return true;
  const nextWorldCenter = planePoint.add(featureDragState.dragOffset);
  moveSelectedFeatureGroupToLocalCenter(
    featureDragState.part,
    partWorldToLocal(featureDragState.part, nextWorldCenter),
    featureDragState.selection
  );
  updateFeatureControls();
  renderFeatureOverlay();
  updateMeasurementControls();
  event.preventDefault();
  event.stopImmediatePropagation?.();
  return true;
}

function finishFeatureDirectDrag(event) {
  if (!featureDragState) return false;
  if (event.pointerId !== featureDragState.pointerId) return true;
  updateFeatureDirectDrag(event);
  featureDragState = null;
  controls.enabled = true;
  updateTransformAttachment();
  event.preventDefault();
  event.stopImmediatePropagation?.();
  return true;
}

function pointerContext(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return {
    rect,
    screen: [event.clientX - rect.left, event.clientY - rect.top]
  };
}

function visiblePartHits(event) {
  pointerContext(event);
  return raycaster.intersectObjects(
    parts.filter((part) => part.visible),
    false
  );
}

function featurePickRecords() {
  const records = [];
  for (const part of parts) {
    if (!part.visible || !partHasFreshFeatures(part)) continue;
    for (const feature of part.userData.detectedFeatures ?? []) {
      const worldFeature = worldFeatureForAnchor(feature, part);
      if (!worldFeature) continue;
      records.push({
        partId: part.userData.id,
        featureId: feature.id,
        type: feature.type,
        visible: true,
        stale: false,
        worldCenter: worldFeature.worldCenter,
        worldEndpoints: worldFeature.worldEndpoints
      });
    }
  }
  return records;
}

function projectWorldPointForPick(rect, worldPosition) {
  const point = new THREE.Vector3().fromArray(worldPosition).project(camera);
  return {
    screen: [((point.x + 1) / 2) * rect.width, ((-point.y + 1) / 2) * rect.height],
    visible: point.z >= -1 && point.z <= 1
  };
}

function pickFeatureAtEvent(event, hit = null) {
  const { rect, screen } = pointerContext(event);
  return pickFeatureTarget(featurePickRecords(), screen, {
    tolerancePx: DEFAULT_FEATURE_PICK_TOLERANCE_PX,
    worldToleranceMm: FEATURE_PICK_WORLD_TOLERANCE_MM,
    hitWorldPosition: hit ? vectorToArray(hit.point) : null,
    projectWorldPoint: (worldPosition) => projectWorldPointForPick(rect, worldPosition)
  });
}

function selectFeatureTarget(target, options = {}) {
  const { part, feature } = featureByTarget(target);
  if (!part || !feature) return false;
  if (selectedPart !== part) selectPart(part);
  let selected = true;
  if (options.toggle === true) {
    const nextIds = new Set(selectedFeatureIds);
    if (nextIds.has(feature.id)) {
      nextIds.delete(feature.id);
      selected = false;
    } else {
      nextIds.add(feature.id);
    }
    setSelectedFeatureIds(nextIds, { primaryId: nextIds.has(feature.id) ? feature.id : selectedFeatureId });
  } else if (options.add === true) {
    setSelectedFeatureIds([...selectedFeatureIds, feature.id], { primaryId: feature.id });
  } else {
    setSelectedFeatureIds([feature.id], { primaryId: feature.id });
  }
  updateFeatureControls();
  updateMeasurementControls();
  updateTransformAttachment();
  renderFeatureOverlay();
  if (options.showStatus !== false) {
    showStatus(`${featureAnchorLabel(part.userData.id, feature, target)} ${selected ? "selected" : "deselected"}`, 1800);
  }
  return true;
}

function setMeasurementAnchorFromFeatureTarget(target) {
  const anchor = anchorFromFeatureTarget(target);
  if (!anchor) return false;
  selectFeatureTarget(target, { showStatus: false });
  setMeasurementAnchor(measurementState.nextAnchor, anchor);
  return true;
}

function handleMeasureClick(event, hit) {
  const featureTarget = pickFeatureAtEvent(event, hit);
  if (featureTarget && setMeasurementAnchorFromFeatureTarget(featureTarget)) return;

  if (!hit) return;
  selectPart(hit.object);
  setMeasurementAnchor(
    measurementState.nextAnchor,
    createMeasurementAnchor({
      type: "pickedPoint",
      partId: hit.object.userData.id,
      label: `${hit.object.userData.id} surface point`,
      worldPosition: vectorToArray(hit.point),
      localPosition: vectorToArray(hit.object.worldToLocal(hit.point.clone()))
    })
  );
}

function handleFeatureClick(event, hit) {
  const featureTarget = pickFeatureAtEvent(event, hit);
  if (featureTarget && selectFeatureTarget(featureTarget, { toggle: event.shiftKey || event.ctrlKey || event.metaKey })) return;

  if (hit?.object) {
    selectPart(hit.object);
    maybeAutoDetectSelectedFeatures();
    return;
  }

  selectPart(null);
}

function handleViewportPointerDown(event) {
  if (!parts.length || event.button !== 0) return;
  if (studioMode === "feature") {
    const hits = visiblePartHits(event);
    const target = pickFeatureAtEvent(event, hits[0] ?? null);
    if (beginFeatureDirectDrag(event, target)) return;
  }
  pointerDownState = {
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    pointerId: event.pointerId
  };
}

function handleViewportPointerMove(event) {
  if (updateFeatureDirectDrag(event)) return;
  if (studioMode !== "feature" && studioMode !== "measure") {
    hoveredFeatureTarget = null;
    renderer.domElement.style.cursor = "";
    return;
  }
  const target = pickFeatureAtEvent(event);
  hoveredFeatureTarget = target;
  renderer.domElement.style.cursor = target ? "pointer" : "";
}

function handleViewportPointerUp(event) {
  if (finishFeatureDirectDrag(event)) {
    pointerDownState = null;
    return;
  }
  if (!parts.length || !pointerDownState) return;
  const gesture = classifyPointerGesture(pointerDownState, event, {
    dragging: transformControls.dragging,
    maxDistancePx: DEFAULT_CLICK_DRAG_TOLERANCE_PX
  });
  pointerDownState = null;
  if (!gesture.isClick) return;

  const hits = visiblePartHits(event);
  const hit = hits[0] ?? null;

  if (studioMode === "measure") {
    handleMeasureClick(event, hit);
    return;
  }

  if (studioMode === "feature") {
    handleFeatureClick(event, hit);
    return;
  }

  selectPart(hit?.object ?? null);
}

function onResize() {
  const { clientWidth, clientHeight } = viewport;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

function updateOrientationGizmo() {
  if (!orientationGizmo) return;

  camera.getWorldQuaternion(orientationCameraQuaternion).invert();

  for (const axis of orientationAxes) {
    const label = orientationAxisElements[axis.id];
    const line = orientationLineElements[axis.id];
    if (!label || !line) continue;

    orientationCameraSpace.copy(axis.vector).applyQuaternion(orientationCameraQuaternion);
    const x = orientationCameraSpace.x * ORIENTATION_GIZMO_RADIUS_PX;
    const y = -orientationCameraSpace.y * ORIENTATION_GIZMO_RADIUS_PX;
    const z = orientationCameraSpace.z;
    const depth = (z + 1) / 2;
    const length = Math.max(8, Math.hypot(x, y));
    const angle = Math.atan2(y, x);
    const labelScale = 0.76 + depth * 0.26;
    const opacity = 0.48 + depth * 0.48;

    label.style.opacity = opacity.toFixed(3);
    label.style.zIndex = String(10 + Math.round(depth * 10));
    label.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px)) scale(${labelScale.toFixed(3)})`;
    line.style.setProperty("--orientation-axis-length", `${length.toFixed(2)}px`);
    line.style.setProperty("--orientation-axis-angle", `${angle.toFixed(4)}rad`);
    line.style.setProperty("--orientation-axis-opacity", (0.34 + depth * 0.42).toFixed(3));
    line.style.zIndex = String(3 + Math.round(depth * 6));
  }

  if (orientationFace) {
    const facingAngle = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    orientationFace.style.setProperty("--orientation-face-angle", `${(-facingAngle).toFixed(4)}rad`);
  }
}

function shortcutTargetIsTextEditable(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable === true;
}

function handleStudioHistoryShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || shortcutTargetIsTextEditable(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoStudioHistory();
  } else if ((key === "z" && event.shiftKey) || key === "y") {
    event.preventDefault();
    redoStudioHistory();
  }
}

function animate() {
  controls.update();
  updateOrientationGizmo();
  if (selectionHelper.visible) selectionHelper.update();
  if (measurementState.anchorA || measurementState.anchorB) renderMeasurementOverlay();
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
    detectedFeatures: (part.userData.detectedFeatures ?? []).map((feature) => ({
      id: feature.id,
      type: feature.type,
      center: feature.center,
      radiusMm: feature.radiusMm,
      lengthMm: feature.lengthMm ?? null,
      widthMm: feature.widthMm ?? null,
      confidence: feature.confidence ?? null
    })),
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
    measurement: {
      anchorA: serializeMeasurementAnchor(measurementState.anchorA),
      anchorB: serializeMeasurementAnchor(measurementState.anchorB),
      nextAnchor: measurementState.nextAnchor,
      result: currentMeasurement(),
      targetDistanceMm: measurementTarget()
    },
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
      studio_detect_features: async ({ partId } = {}) => {
        requireAssemblyReady();
        if (partId) selectPartForAssistant(partId);
        const features = await detectFeaturesForSelectedPart();
        return {
          message: `Detected ${features.length} feature${features.length === 1 ? "" : "s"}.`,
          features
        };
      },
      studio_select_feature: ({ partId, featureId }) => {
        requireAssemblyReady();
        const part = selectPartForAssistant(partId);
        const feature = part.userData.detectedFeatures?.find((item) => item.id === featureId);
        if (!feature) throw new Error(`Unknown detected feature id for ${partId}: ${featureId}`);
        setSelectedFeatureIds([feature.id], { primaryId: feature.id });
        updateFeatureControls();
        updateMeasurementControls();
        updateTransformAttachment();
        renderFeatureOverlay();
        return `${feature.label ?? feature.id} selected.`;
      },
      studio_measure_between_anchors: ({ anchorA, anchorB } = {}) => {
        if (anchorA) measurementState.anchorA = createMeasurementAnchor(anchorA);
        if (anchorB) measurementState.anchorB = createMeasurementAnchor(anchorB);
        updateMeasurementControls();
        renderMeasurementOverlay();
        return currentMeasurement();
      },
      studio_set_measurement_target: ({ targetDistanceMm, presetId } = {}) => {
        const preset = SERVO_HORN_SPACING_PRESETS.find((item) => item.id === presetId);
        const target = preset?.targetDistanceMm ?? targetDistanceMm;
        if (!Number.isFinite(Number(target)) || Number(target) <= 0) {
          throw new Error("Provide a positive measurement target distance.");
        }
        if (measurementPreset) measurementPreset.value = preset?.id ?? "";
        if (measurementTargetDistance) measurementTargetDistance.value = Number(target).toFixed(3);
        measurementState.targetDistanceMm = Number(target);
        updateMeasurementControls();
        return `Measurement target set to ${Number(target).toFixed(3)} mm.`;
      },
      studio_set_measurement_pick_target: ({ target }) => {
        setMeasurementPickTarget(target);
        return `Next measurement pick will set Anchor ${measurementState.nextAnchor}.`;
      },
      studio_apply_feature_edit: async (args = {}) => {
        requireAssemblyReady();
        if (args.partId) selectPartForAssistant(args.partId);
        if (args.featureId) setSelectedFeatureIds([args.featureId], { primaryId: args.featureId });
        const feature = selectedFeature();
        if (!feature) throw new Error("Select or provide a detected feature before editing.");
        const edited = {
          ...feature,
          center: Array.isArray(args.center) ? args.center.map(Number) : feature.center,
          radiusMm: Number.isFinite(Number(args.radiusMm)) ? Number(args.radiusMm) : feature.radiusMm,
          lengthMm: Number.isFinite(Number(args.lengthMm)) ? Number(args.lengthMm) : feature.lengthMm,
          angleDeg: Number.isFinite(Number(args.angleDeg)) ? Number(args.angleDeg) : feature.angleDeg
        };
        await applyFeatureEditForPart(selectedPart, feature, edited);
        return "Feature edit applied.";
      },
      studio_apply_feature_spacing: async ({ targetDistanceMm, symmetric } = {}) => {
        if (Number.isFinite(Number(targetDistanceMm)) && Number(targetDistanceMm) > 0) {
          measurementTargetDistance.value = Number(targetDistanceMm).toFixed(3);
          measurementState.targetDistanceMm = Number(targetDistanceMm);
        }
        if (typeof symmetric === "boolean") measurementSymmetricToggle.checked = symmetric;
        await applyFeatureSpacing();
        return "Feature spacing applied.";
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

function populateMeasurementPresets() {
  if (!measurementPreset) return;
  for (const preset of SERVO_HORN_SPACING_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} (${preset.targetDistanceMm.toFixed(2)} mm)`;
    measurementPreset.append(option);
  }
}

populateMeasurementPresets();

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
    if (transformSubject === "feature") {
      captureFeatureCenterFromTransformControls();
    } else {
      captureSelectedOffsetFromTransformControls();
      applyCurrentPose();
    }
    updateTransformAttachment();
  }
});

transformControls.addEventListener("objectChange", () => {
  if (transformSubject === "feature") captureFeatureCenterFromTransformControls();
  else captureSelectedOffsetFromTransformControls();
});

renderer.domElement.addEventListener("pointerdown", handleViewportPointerDown, { capture: true });
renderer.domElement.addEventListener("pointermove", handleViewportPointerMove, { capture: true });
renderer.domElement.addEventListener("pointerup", handleViewportPointerUp, { capture: true });

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
undoStudioButton?.addEventListener("click", undoStudioHistory);
redoStudioButton?.addEventListener("click", redoStudioHistory);
document.addEventListener("keydown", handleStudioHistoryShortcut);

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

measureAnchorAPartButton.addEventListener("click", () => setMeasurementAnchor("A", anchorFromPartCenter()));
measureAnchorBPartButton.addEventListener("click", () => setMeasurementAnchor("B", anchorFromPartCenter()));
measureAnchorAFeatureButton.addEventListener("click", () => setMeasurementAnchor("A", anchorFromFeature()));
measureAnchorBFeatureButton.addEventListener("click", () => setMeasurementAnchor("B", anchorFromFeature()));
measurementPickAButton.addEventListener("click", () => setMeasurementPickTarget("A"));
measurementPickBButton.addEventListener("click", () => setMeasurementPickTarget("B"));
measurementPreset.addEventListener("change", () => {
  const preset = SERVO_HORN_SPACING_PRESETS.find((item) => item.id === measurementPreset.value);
  if (preset && measurementTargetDistance) measurementTargetDistance.value = preset.targetDistanceMm.toFixed(3);
  updateMeasurementControls();
});
measurementTargetDistance.addEventListener("change", () => {
  measurementState.targetDistanceMm = measurementTarget();
  updateMeasurementControls();
});
measurementUseCurrentButton.addEventListener("click", () => {
  const measurement = currentMeasurement();
  if (!measurement.ready) return;
  measurementPreset.value = "";
  measurementTargetDistance.value = measurement.distanceMm.toFixed(3);
  measurementState.targetDistanceMm = measurement.distanceMm;
  updateMeasurementControls();
});
measurementApplySpacingButton.addEventListener("click", () => {
  applyFeatureSpacing().catch((error) => showStatus(error.message ?? "Spacing adjustment failed", 6200));
});
measurementClearButton.addEventListener("click", () => {
  measurementState.anchorA = null;
  measurementState.anchorB = null;
  measurementState.nextAnchor = "A";
  updateMeasurementControls();
  renderMeasurementOverlay();
});

featureSelect.addEventListener("change", () => {
  const ids = [...featureSelect.selectedOptions].map((option) => option.value).filter(Boolean);
  setSelectedFeatureIds(ids, { primaryId: ids.includes(selectedFeatureId) ? selectedFeatureId : ids[0] });
  updateFeatureControls();
  updateTransformAttachment();
});
featureDetectButton.addEventListener("click", () => {
  detectFeaturesForSelectedPart().catch(() => {});
});
featurePreviewButton.addEventListener("click", () => {
  updateFeatureFromInputs();
  setStudioMode("feature");
  updateFeatureControls();
});
featureApplyButton.addEventListener("click", () => {
  applySelectedFeatureEdit().catch(() => {});
});
featureUndoButton.addEventListener("click", undoLastFeatureEdit);

for (const input of featureCenterInputs) {
  input.addEventListener("change", () => {
    updateFeatureFromInputs();
    updateFeatureControls();
    updateTransformAttachment();
  });
}

for (const input of [featureRadiusInput, featureLengthInput, featureAngleInput]) {
  input.addEventListener("change", () => {
    updateFeatureFromInputs();
    updateFeatureControls();
  });
}

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
    resetStudioHistory();
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
