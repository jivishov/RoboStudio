import "./parts.css";
import { mountPageAssistant } from "./assistant/chatUi.js";
import { mountAssistantEvalPanel } from "./assistant/evalRunner.js";
import {
  BOOLEAN_OPERATION_KIND,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND,
  uniquePartId
} from "./parts/contracts.js";
import {
  BOOLEAN_OPERATIONS,
  createBooleanOperationBody,
  createCircularPatternProfiles,
  createLinearPatternProfiles,
  createRevolveBodyFromPreset,
  listRevolvePresets
} from "./parts/featureOps.js";
import { createSpurGearBody } from "./parts/gears.js";
import {
  addBody,
  commitProject,
  createProjectHistory,
  deleteBody,
  duplicateBody,
  normalizePartProject,
  redoProject,
  resetProjectHistory,
  selectBody,
  selectedBody,
  undoProject,
  updateBody
} from "./parts/projectState.js";
import { parsePartProjectJson, serializePartProject } from "./parts/serialization.js";
import {
  combinedProfileBounds,
  createCircularHole,
  createSlottedHole,
  profileBounds,
  profileCenter,
  profileSize
} from "./parts/sketch.js";
import { createBodyFromTemplate, listPartTemplates } from "./parts/templates.js";
import { validateBody, validatePartProject } from "./parts/validation.js";
import { createPartPreviewScene } from "./parts/previewScene.js";
import { createGeneratedAssemblySnapshot } from "./parts/snapshot.js";
import {
  bodyEffectiveSizeMm,
  resizePartBodyToTargetSize,
  targetSizeFromAxisEdit
} from "./parts/resize.js";
import { SKETCH_MOUSE_RESIZE_MIN_MM, targetSizeFromSketchResize } from "./parts/sketchResize.js";
import { CURRENT_SNAPSHOT_KEY, SNAPSHOT_STORE_NAME, writeWorkspaceValue } from "./workspaceDb.js";

const templateSelect = document.querySelector("#template-select");
const addTemplateButton = document.querySelector("#add-template");
const addLinearPatternButton = document.querySelector("#add-linear-pattern");
const addCircularPatternButton = document.querySelector("#add-circular-pattern");
const revolvePresetSelect = document.querySelector("#revolve-preset-select");
const addRevolveBodyButton = document.querySelector("#add-revolve-body");
const addSpurGearButton = document.querySelector("#add-spur-gear");
const booleanOperationSelect = document.querySelector("#boolean-operation-select");
const addBooleanBodyButton = document.querySelector("#add-boolean-body");
const bodyList = document.querySelector("#body-list");
const bodyCount = document.querySelector("#body-count");
const bodyProperties = document.querySelector("#body-properties");
const outerProfileFields = document.querySelector("#outer-profile-fields");
const cutProfileFields = document.querySelector("#cut-profile-fields");
const sketchPreview = document.querySelector("#sketch-preview");
const selectedBodySummary = document.querySelector("#selected-body-summary");
const projectUpdatedAt = document.querySelector("#project-updated-at");
const validationCount = document.querySelector("#validation-count");
const validationList = document.querySelector("#validation-list");
const newProjectButton = document.querySelector("#new-project");
const saveProjectButton = document.querySelector("#save-project");
const openProjectButton = document.querySelector("#open-project");
const projectFileInput = document.querySelector("#project-file-input");
const undoButton = document.querySelector("#undo-project");
const redoButton = document.querySelector("#redo-project");
const exportStlButton = document.querySelector("#export-stl");
const sendAssemblyButton = document.querySelector("#send-assembly");
const duplicateBodyButton = document.querySelector("#duplicate-body");
const deleteBodyButton = document.querySelector("#delete-body");
const addCircularHoleButton = document.querySelector("#add-circular-hole");
const addSlottedHoleButton = document.querySelector("#add-slotted-hole");
const statusElement = document.querySelector("#part-status");
const modelPreview = document.querySelector("#model-preview");
const compileCount = document.querySelector("#compile-count");
const buildCount = document.querySelector("#build-count");
const compileList = document.querySelector("#compile-list");

const history = createProjectHistory();
const cadWorker = new Worker(new URL("./parts/cadWorker.js", import.meta.url), { type: "module" });
const previewScene = createPartPreviewScene(modelPreview);
const SVG_NS = "http://www.w3.org/2000/svg";
let statusTimer = null;
let compileTimer = null;
let workerRequestId = 0;
let activeCompileRequestId = null;
let pendingCompileSignature = null;
let lastCompletedCompileSignature = null;
let compileResults = new Map();
let compileErrors = [];
let compiling = false;
let resizeUniform = true;
let resizeKeepCutSizes = true;
let sketchResizeDrag = null;
const pendingStlExports = new Map();
const compileRequestSignatures = new Map();

function showStatus(message, timeout = 2400) {
  clearTimeout(statusTimer);
  statusElement.textContent = message;
  statusElement.hidden = false;
  statusTimer = setTimeout(() => {
    statusElement.hidden = true;
  }, timeout);
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

function nextWorkerRequestId() {
  workerRequestId += 1;
  return workerRequestId;
}

function selectedCompileResult() {
  const body = selectedProjectBody();
  return body ? compileResults.get(body.id) ?? null : null;
}

function bodySourceKind(body) {
  return body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
}

function isSketchBody(body) {
  return bodySourceKind(body) === SKETCH_EXTRUDE_KIND;
}

function sourceLabel(body) {
  const kind = bodySourceKind(body);
  if (kind === REVOLVE_KIND) return "lathe";
  if (kind === SPUR_GEAR_KIND) return "gear";
  if (kind === BOOLEAN_OPERATION_KIND) return body.boolean?.operation ?? "boolean";
  return `${formatNumber(body?.extrudeDepthMm, 1)} mm`;
}

function compileResultCount(project) {
  return project.bodies.filter((body) => compileResults.has(body.id)).length;
}

function bodyCompileSignature(body) {
  return {
    id: body.id,
    source: body.source,
    sketch: body.sketch,
    extrudeDepthMm: body.extrudeDepthMm,
    revolve: body.revolve,
    gear: body.gear,
    boolean: body.boolean
  };
}

function projectCompileSignature(project) {
  return JSON.stringify(project.bodies.map(bodyCompileSignature));
}

function renderCompileStatus(project = history.current) {
  const resultCount = compileResultCount(project);
  const total = project.bodies.length;
  const hasSelectedResult = Boolean(selectedCompileResult());
  const hasHandoffResult = resultCount > 0;

  exportStlButton.disabled = !hasSelectedResult || compiling;
  sendAssemblyButton.disabled = !hasHandoffResult || compiling;
  compileCount.textContent = compiling ? "Building" : total ? `${resultCount}/${total}` : "Idle";
  buildCount.textContent = compileErrors.length ? `${compileErrors.length}` : resultCount ? "OK" : "Idle";
  compileList.replaceChildren();

  if (compiling) {
    const item = document.createElement("li");
    item.className = "validation-ok";
    item.textContent = "Building generated solids";
    compileList.append(item);
    return;
  }

  if (!total) {
    const item = document.createElement("li");
    item.textContent = "Add a body to build a solid preview.";
    compileList.append(item);
    return;
  }

  if (!compileErrors.length && resultCount) {
    const item = document.createElement("li");
    item.className = "validation-ok";
    item.textContent = `${resultCount} generated solid${resultCount === 1 ? "" : "s"} ready`;
    compileList.append(item);
    return;
  }

  for (const error of compileErrors.slice(0, 8)) {
    const item = document.createElement("li");
    const code = document.createElement("span");
    code.className = "validation-code";
    code.textContent = error.bodyId ?? error.code;
    const message = document.createElement("span");
    message.textContent = error.issues?.[0]?.message ?? error.message;
    item.append(code, message);
    compileList.append(item);
  }
}

function updateGeneratedPreview(project = history.current, options = {}) {
  previewScene.updateBodies(project.bodies, compileResults, project.selectedBodyId, options);
}

function requestCadCompile(project = history.current) {
  const signature = projectCompileSignature(project);

  if (!compiling && signature === lastCompletedCompileSignature) {
    updateGeneratedPreview(project, { fitCamera: false });
    renderCompileStatus(project);
    return;
  }

  if (compiling && signature === pendingCompileSignature) {
    updateGeneratedPreview(project, { fitCamera: false });
    renderCompileStatus(project);
    return;
  }

  clearTimeout(compileTimer);

  if (!project.bodies.length) {
    activeCompileRequestId = null;
    pendingCompileSignature = null;
    lastCompletedCompileSignature = signature;
    compiling = false;
    compileResults = new Map();
    compileErrors = [];
    updateGeneratedPreview(project);
    renderCompileStatus(project);
    return;
  }

  compiling = true;
  pendingCompileSignature = signature;
  activeCompileRequestId = null;
  renderCompileStatus(project);

  compileTimer = setTimeout(() => {
    const requestId = nextWorkerRequestId();
    activeCompileRequestId = requestId;
    compileRequestSignatures.set(requestId, signature);
    cadWorker.postMessage({
      type: "compileBodies",
      requestId,
      bodies: project.bodies
    });
  }, 180);
}

function handleCompileResult(message) {
  if (message.requestId !== activeCompileRequestId) {
    compileRequestSignatures.delete(message.requestId);
    return;
  }
  compiling = false;
  lastCompletedCompileSignature = compileRequestSignatures.get(message.requestId) ?? pendingCompileSignature;
  pendingCompileSignature = null;
  compileRequestSignatures.delete(message.requestId);
  compileResults = new Map(message.results.map((result) => [result.bodyId, result]));
  compileErrors = message.errors ?? [];
  updateGeneratedPreview();
  renderCompileStatus();
}

function handleStlExportResult(message) {
  if (!pendingStlExports.has(message.requestId)) return;
  pendingStlExports.delete(message.requestId);
  exportStlButton.disabled = false;
  downloadBlob(message.stl, message.fileName, "model/stl");
  showStatus("STL export started");
  renderCompileStatus();
}

function handleStlExportError(message) {
  if (!pendingStlExports.has(message.requestId)) return;
  pendingStlExports.delete(message.requestId);
  exportStlButton.disabled = false;
  showStatus(message.error?.message ?? "STL export failed", 5200);
  renderCompileStatus();
}

cadWorker.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (message.type === "compileBodiesResult") handleCompileResult(message);
  if (message.type === "exportStlResult") handleStlExportResult(message);
  if (message.type === "exportStlError") handleStlExportError(message);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCadReady(timeoutMs = 6000) {
  requestCadCompile(history.current);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const signature = projectCompileSignature(history.current);
    if (!compiling && signature === lastCompletedCompileSignature) {
      renderCompileStatus(history.current);
      return;
    }
    await sleep(50);
  }
  throw new Error("Generated solids are still building. Try again after the build status is ready.");
}

function templateLabel(templateId) {
  return listPartTemplates().find((template) => template.id === templateId)?.label ?? templateId;
}

function renderTemplateOptions() {
  templateSelect.replaceChildren(
    ...listPartTemplates().map((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.label;
      return option;
    })
  );
}

function renderAdvancedOptions() {
  revolvePresetSelect.replaceChildren(
    ...listRevolvePresets().map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      return option;
    })
  );
  booleanOperationSelect.replaceChildren(
    ...BOOLEAN_OPERATIONS.map((operation) => {
      const option = document.createElement("option");
      option.value = operation;
      option.textContent = operation;
      return option;
    })
  );
}

function selectedProjectBody() {
  return selectedBody(history.current);
}

function commit(nextProject, message) {
  commitProject(history, nextProject);
  render();
  if (message) showStatus(message);
}

function commitSelectedBody(mutator, message = "Body updated") {
  const body = selectedProjectBody();
  if (!body) return;
  commit(updateBody(history.current, body.id, mutator), message);
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "0";
}

function finiteNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a finite number.`);
  return numeric;
}

function positiveNumber(value, label) {
  const numeric = finiteNumber(value, label);
  if (numeric <= 0) throw new Error(`${label} must be positive.`);
  return numeric;
}

function vector3ForAssistant(value, label, options = {}) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a three-number vector.`);
  const vector = value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
  if (options.positive && vector.some((item) => item <= 0)) throw new Error(`${label} values must be positive.`);
  return vector;
}

function optionValues(select) {
  return [...select.options].map((option) => option.value);
}

function ensureSelectValue(select, value, label) {
  if (!optionValues(select).includes(value)) throw new Error(`Unknown ${label}: ${value}`);
  select.value = value;
  return value;
}

function bodyForAssistant(bodyId = history.current.selectedBodyId) {
  const id = bodyId || history.current.selectedBodyId;
  const body = history.current.bodies.find((item) => item.id === id);
  if (!body) throw new Error(id ? `Unknown body id: ${id}` : "No body is selected.");
  return body;
}

function selectBodyForAssistant(bodyId) {
  const body = bodyForAssistant(bodyId);
  history.current = selectBody(history.current, body.id);
  render();
  return selectedProjectBody() ?? body;
}

function selectedSketchBodyForAssistant(bodyId) {
  const body = bodyId ? selectBodyForAssistant(bodyId) : selectedProjectBody();
  if (!body) throw new Error("No body is selected.");
  if (!isSketchBody(body) || !body.sketch?.outerProfile) {
    throw new Error(`${body.name} is not an editable sketch body.`);
  }
  return body;
}

function findCutIndex(body, args = {}) {
  if (args.profileId) {
    const index = body.sketch.cutProfiles.findIndex((profile) => profile.id === args.profileId);
    if (index < 0) throw new Error(`Unknown cut profile id: ${args.profileId}`);
    return index;
  }
  if (args.cutIndex !== undefined) {
    const index = Math.trunc(finiteNumber(args.cutIndex, "cutIndex"));
    if (index < 0 || index >= body.sketch.cutProfiles.length) throw new Error(`Unknown cut profile index: ${index}`);
    return index;
  }
  if (body.sketch.cutProfiles.length === 1) return 0;
  throw new Error("Provide profileId or cutIndex for a cut profile.");
}

function profileSummary(profile, index = null) {
  if (!profile) return null;
  return {
    id: profile.id,
    type: profile.type,
    index,
    x: profile.x,
    z: profile.z,
    radius: profile.radius,
    length: profile.length,
    width: profile.width,
    height: profile.height,
    cornerRadius: profile.cornerRadius,
    points: profile.points
  };
}

function assistantBodySummary(body) {
  return {
    id: body.id,
    name: body.name,
    color: body.color,
    sourceKind: bodySourceKind(body),
    extrudeDepthMm: body.extrudeDepthMm,
    transform: body.transform,
    effectiveSizeMm: currentBodySize(body),
    compileReady: compileResults.has(body.id),
    valid: validateBody(body).length === 0,
    outerProfile: profileSummary(body.sketch?.outerProfile ?? null),
    cutProfiles: (body.sketch?.cutProfiles ?? []).map((profile, index) => profileSummary(profile, index))
  };
}

function partsAssistantContext() {
  const project = history.current;
  const selected = selectedProjectBody();
  const resultCount = compileResultCount(project);
  const issues = validatePartProject(project);
  return {
    page: "Robotic Part Studio",
    ready: true,
    project: {
      version: project.version,
      units: project.units,
      selectedBodyId: project.selectedBodyId,
      updatedAt: project.updatedAt
    },
    counts: {
      bodies: project.bodies.length,
      compiledBodies: resultCount,
      validationIssues: issues.length,
      compileErrors: compileErrors.length
    },
    controls: {
      templateId: templateSelect.value,
      templates: listPartTemplates(),
      revolvePresetId: revolvePresetSelect.value,
      revolvePresets: listRevolvePresets(),
      booleanOperation: booleanOperationSelect.value,
      booleanOperations: BOOLEAN_OPERATIONS
    },
    history: {
      canUndo: history.undoStack.length > 0,
      canRedo: history.redoStack.length > 0
    },
    selection: selected ? assistantBodySummary(selected) : null,
    bodies: project.bodies.map(assistantBodySummary),
    validation: issues.slice(0, 12),
    compile: {
      compiling,
      status: compileCount.textContent,
      buildStatus: buildCount.textContent,
      selectedReady: Boolean(selectedCompileResult()),
      exportReady: Boolean(selectedCompileResult()) && !compiling,
      handoffReady: resultCount > 0 && !compiling,
      errors: compileErrors.slice(0, 8)
    }
  };
}

function setBodyPropertiesForAssistant(args = {}) {
  const body = args.bodyId ? selectBodyForAssistant(args.bodyId) : bodyForAssistant();
  commitSelectedBody((draft) => {
    if (typeof args.name === "string" && args.name.trim()) draft.name = args.name.trim();
    if (typeof args.color === "string") {
      if (!/^#[0-9a-f]{6}$/i.test(args.color)) throw new Error("Color must be a six-digit hex value.");
      draft.color = args.color;
    }
    if (args.extrudeDepthMm !== undefined) {
      if (!isSketchBody(draft)) throw new Error("Only sketch bodies expose extrusion depth.");
      draft.extrudeDepthMm = positiveNumber(args.extrudeDepthMm, "extrudeDepthMm");
    }
    if (Array.isArray(args.position)) draft.transform.position = vector3ForAssistant(args.position, "position");
    if (Array.isArray(args.scale)) draft.transform.scale = vector3ForAssistant(args.scale, "scale", { positive: true });
    return draft;
  }, `${body.name} updated`);
  return "Body properties updated.";
}

function resizeBodyForAssistant(args = {}) {
  const body = args.bodyId ? selectBodyForAssistant(args.bodyId) : bodyForAssistant();
  if (!Array.isArray(args.targetSizeMm)) throw new Error("targetSizeMm must be an [X, Y, Z] millimeter vector.");
  const currentSize = currentBodySize(body);
  const requestedSize = vector3ForAssistant(args.targetSizeMm, "targetSizeMm", { positive: true });
  const uniformAxis = currentSize.reduce((bestAxis, size, axis) => (size > currentSize[bestAxis] ? axis : bestAxis), 0);
  const targetSize = args.uniform === false
    ? requestedSize
    : targetSizeFromAxisEdit(currentSize, uniformAxis, requestedSize[uniformAxis], true);
  commitSelectedBody(
    (draft) =>
      resizePartBodyToTargetSize(draft, targetSize, {
        currentSizeMm: currentSize,
        keepCutSizes: args.keepCutSizes !== false
      }),
    `${body.name} resized`
  );
  return `${body.name} resized to ${targetSize.map((value) => formatNumber(value, 1)).join(" x ")} mm.`;
}

function applyProfileArguments(profile, args = {}) {
  for (const prop of ["x", "z"]) {
    if (args[prop] !== undefined) profile[prop] = finiteNumber(args[prop], prop);
  }
  for (const prop of ["radius", "length", "width", "height"]) {
    if (args[prop] !== undefined) profile[prop] = positiveNumber(args[prop], prop);
  }
  if (args.cornerRadius !== undefined) profile.cornerRadius = Math.max(0, finiteNumber(args.cornerRadius, "cornerRadius"));
  if (args.points !== undefined) {
    if (profile.type !== "polyline") throw new Error("Only polyline profiles expose editable points.");
    if (!Array.isArray(args.points) || args.points.length < 3) throw new Error("Polyline profiles need at least three points.");
    profile.points = args.points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error(`points[${index}] must be an [x, z] pair.`);
      return [finiteNumber(point[0], `points[${index}][0]`), finiteNumber(point[1], `points[${index}][1]`)];
    });
  }
}

function setProfileForAssistant(args = {}) {
  const body = selectedSketchBodyForAssistant(args.bodyId);
  if (args.target === "cut") {
    const cutIndex = findCutIndex(body, args);
    commitSelectedBody((draft) => {
      applyProfileArguments(draft.sketch.cutProfiles[cutIndex], args);
      return draft;
    }, "Cut profile updated");
    return "Cut profile updated.";
  }
  commitSelectedBody((draft) => {
    if (!draft.sketch.outerProfile) throw new Error("The selected body has no outer profile.");
    applyProfileArguments(draft.sketch.outerProfile, args);
    return draft;
  }, "Outer profile updated");
  return "Outer profile updated.";
}

function addTemplateBody(templateId = templateSelect.value) {
  ensureSelectValue(templateSelect, templateId, "template id");
  const existingIds = new Set(history.current.bodies.map((body) => body.id));
  const body = createBodyFromTemplate(templateSelect.value, { existingIds });
  commit(addBody(history.current, body), `${templateLabel(templateSelect.value)} added`);
  return body;
}

function addCutProfileForAssistant(args = {}) {
  selectedSketchBodyForAssistant(args.bodyId);
  const cut = createCutProfile(args.type);
  if (!cut) throw new Error("Unable to create a cut profile for the selected body.");
  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(cut);
    return draft;
  }, args.type === "slot" ? "Slotted hole added" : "Circular hole added");
  return `${cut.id} added.`;
}

function removeCutProfileForAssistant(args = {}) {
  const body = selectedSketchBodyForAssistant(args.bodyId);
  const index = findCutIndex(body, args);
  const profile = body.sketch.cutProfiles[index];
  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.splice(index, 1);
    return draft;
  }, "Cut removed");
  return `${profile.id} removed.`;
}

function duplicateBodyForAssistant(bodyId) {
  const body = bodyId ? selectBodyForAssistant(bodyId) : bodyForAssistant();
  commit(duplicateBody(history.current, body.id), "Body duplicated");
  return `${body.name} duplicated.`;
}

function deleteBodyForAssistant(bodyId) {
  const body = bodyId ? selectBodyForAssistant(bodyId) : bodyForAssistant();
  commit(deleteBody(history.current, body.id), "Body deleted");
  return `${body.name} deleted.`;
}

function createField(labelText, input) {
  const label = document.createElement("label");
  label.className = "parts-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

function createInput({ value, type = "number", step = "1", min = null, dataset = {}, disabled = false }) {
  const input = document.createElement("input");
  input.type = type;
  input.value = String(value ?? "");
  input.disabled = disabled;
  if (step != null) input.step = step;
  if (min != null) input.min = min;
  for (const [key, dataValue] of Object.entries(dataset)) {
    input.dataset[key] = dataValue;
  }
  return input;
}

function createVectorFields(title, values, datasetPrefix, step = "1") {
  const grid = document.createElement("div");
  grid.className = "parts-field-grid";
  const titleElement = document.createElement("span");
  titleElement.textContent = title;
  grid.append(titleElement);
  for (const [index, axis] of ["X", "Y", "Z"].entries()) {
    grid.append(
      createField(
        axis,
        createInput({
          value: formatNumber(values[index], datasetPrefix === "scale" ? 3 : 1),
          step,
          min: datasetPrefix === "scale" ? "0.001" : null,
          dataset: { transformKind: datasetPrefix, axis: String(index) }
        })
      )
    );
  }
  return grid;
}

function createOutputField(labelText, value) {
  const label = document.createElement("label");
  label.className = "parts-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  const output = document.createElement("output");
  output.textContent = value;
  label.append(span, output);
  return label;
}

function createCheckboxRow(labelText, checked, dataset = {}) {
  const label = document.createElement("label");
  label.className = "parts-checkbox-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  for (const [key, value] of Object.entries(dataset)) {
    input.dataset[key] = value;
  }
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(input, span);
  return label;
}

function currentBodySize(body) {
  const compileResult = bodySourceKind(body) === BOOLEAN_OPERATION_KIND ? compileResults.get(body.id) ?? null : null;
  return bodyEffectiveSizeMm(body, compileResult);
}

function createResizeSection(body) {
  const section = document.createElement("div");
  section.className = "parts-resize-section";

  const title = document.createElement("div");
  title.className = "parts-resize-section__title";
  const heading = document.createElement("span");
  heading.textContent = "Resize";
  const hint = document.createElement("small");
  hint.textContent = isSketchBody(body) ? "Target dimensions edit the source sketch where possible" : "Target dimensions edit source parameters when available";
  title.append(heading, hint);

  const currentSize = currentBodySize(body);
  const currentGrid = document.createElement("div");
  currentGrid.className = "parts-field-grid";
  const currentLabel = document.createElement("span");
  currentLabel.textContent = "Current size (mm)";
  currentGrid.append(currentLabel);
  for (const [index, axis] of ["X", "Y", "Z"].entries()) {
    currentGrid.append(createOutputField(axis, formatNumber(currentSize[index], 2)));
  }

  const targetGrid = document.createElement("div");
  targetGrid.className = "parts-field-grid";
  const targetLabel = document.createElement("span");
  targetLabel.textContent = "Target size (mm)";
  targetGrid.append(targetLabel);
  for (const [index, axis] of ["X", "Y", "Z"].entries()) {
    targetGrid.append(
      createField(
        axis,
        createInput({
          value: formatNumber(currentSize[index], 2),
          step: "0.5",
          min: "0.001",
          dataset: { resizeTargetAxis: String(index) }
        })
      )
    );
  }

  const options = document.createElement("div");
  options.className = "parts-resize-options";
  options.append(createCheckboxRow("Uniform", resizeUniform, { resizeOption: "uniform" }));
  if (isSketchBody(body)) {
    options.append(createCheckboxRow("Keep hole sizes", resizeKeepCutSizes, { resizeOption: "keepCutSizes" }));
  }

  const note = document.createElement("p");
  note.className = "parts-resize-note";
  note.textContent = isSketchBody(body) && resizeKeepCutSizes
    ? "Hole centers move with the body; screw and bearing clearances stay fixed."
    : isSketchBody(body)
      ? "Cut profiles scale with the body footprint."
      : "Boolean bodies fall back to placement scale when their operands cannot be source-resized safely.";

  section.append(title, currentGrid, targetGrid, options, note);
  return section;
}

function renderBodyList(project) {
  bodyCount.textContent = String(project.bodies.length);
  bodyList.replaceChildren();

  if (!project.bodies.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "Add a template body";
    bodyList.append(empty);
    return;
  }

  for (const body of project.bodies) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `body-row${body.id === project.selectedBodyId ? " is-selected" : ""}`;
    row.dataset.bodyId = body.id;

    const swatch = document.createElement("span");
    swatch.className = "body-row__swatch";
    swatch.style.background = body.color;

    const name = document.createElement("span");
    name.className = "body-row__name";
    name.textContent = body.name;

    const depth = document.createElement("span");
    depth.className = "body-row__depth";
    depth.textContent = sourceLabel(body);

    row.append(swatch, name, depth);
    row.addEventListener("click", () => {
      history.current = selectBody(project, body.id);
      render();
      showStatus(`Selected ${body.name}`);
    });
    bodyList.append(row);
  }
}

function renderBodyProperties(body) {
  bodyProperties.replaceChildren();
  const hasBody = Boolean(body);
  const sketchEditable = hasBody && isSketchBody(body);
  duplicateBodyButton.disabled = !hasBody;
  deleteBodyButton.disabled = !hasBody;
  addCircularHoleButton.disabled = !sketchEditable;
  addSlottedHoleButton.disabled = !sketchEditable;
  addLinearPatternButton.disabled = !sketchEditable;
  addCircularPatternButton.disabled = !sketchEditable;
  addBooleanBodyButton.disabled = history.current.bodies.length < 2;

  if (!body) {
    bodyProperties.append(emptyMessage("No body selected"));
    return;
  }

  bodyProperties.append(
    createField(
      "Name",
      createInput({ type: "text", value: body.name, step: null, dataset: { bodyProp: "name" } })
    ),
    createField(
      "Color",
      createInput({ type: "color", value: body.color, step: null, dataset: { bodyProp: "color" } })
    ),
    createResizeSection(body),
    createVectorFields("Position (mm)", body.transform.position, "position", "1"),
    createVectorFields("Placement scale", body.transform.scale, "scale", "0.05")
  );

  if (sketchEditable) {
    bodyProperties.insertBefore(
      createField(
        "Extrude depth (Y mm)",
        createInput({
          value: formatNumber(body.extrudeDepthMm, 2),
          step: "0.5",
          min: "0.1",
          dataset: { bodyProp: "extrudeDepthMm" }
        })
      ),
      bodyProperties.children[2]
    );
  } else {
    bodyProperties.append(createAdvancedBodySummary(body));
  }
}

function createAdvancedBodySummary(body) {
  const summary = document.createElement("div");
  summary.className = "advanced-summary";
  const title = document.createElement("span");
  title.textContent = "Source";
  const value = document.createElement("strong");
  const kind = bodySourceKind(body);
  if (kind === REVOLVE_KIND) {
    value.textContent = `${body.revolve?.presetId ?? "lathe"} / ${body.revolve?.segments ?? 0} segments`;
  } else if (kind === SPUR_GEAR_KIND) {
    value.textContent = `${body.gear?.toothCount ?? 0} teeth / module ${body.gear?.moduleMm ?? 0}`;
  } else if (kind === BOOLEAN_OPERATION_KIND) {
    value.textContent = `${body.boolean?.operation ?? "boolean"} / ${(body.boolean?.operandBodyIds ?? []).join(", ")}`;
  } else {
    value.textContent = kind;
  }
  summary.append(title, value);
  return summary;
}

function profileField(label, value, prop, scope, options = {}) {
  return createField(
    label,
    createInput({
      value: formatNumber(value, options.digits ?? 2),
      step: options.step ?? "0.5",
      min: options.min ?? null,
      dataset: { profileScope: scope, profileProp: prop, ...(options.dataset ?? {}) }
    })
  );
}

function renderProfileFields(container, profile, scope) {
  container.replaceChildren();
  if (!profile) {
    container.append(emptyMessage("Missing profile"));
    return;
  }

  if (profile.type === "circle") {
    container.append(
      profileField("Center X", profile.x, "x", scope),
      profileField("Center Z", profile.z, "z", scope),
      profileField("Radius", profile.radius, "radius", scope, { min: "0.1" })
    );
    return;
  }

  if (profile.type === "roundedSlot") {
    container.append(
      profileField("Center X", profile.x, "x", scope),
      profileField("Center Z", profile.z, "z", scope),
      profileField("Length", profile.length, "length", scope, { min: "0.1" }),
      profileField("Width", profile.width, "width", scope, { min: "0.1" })
    );
    return;
  }

  if (profile.type === "polyline") {
    for (const [index, point] of profile.points.entries()) {
      const grid = document.createElement("div");
      grid.className = "parts-field-grid";
      const title = document.createElement("span");
      title.textContent = `Point ${index + 1}`;
      grid.append(
        title,
        profileField("X", point[0], "point", scope, { dataset: { pointIndex: String(index), pointAxis: "0" } }),
        profileField("Z", point[1], "point", scope, { dataset: { pointIndex: String(index), pointAxis: "1" } })
      );
      container.append(grid);
    }
    return;
  }

  container.append(
    profileField("Center X", profile.x, "x", scope),
    profileField("Center Z", profile.z, "z", scope),
    profileField("Width", profile.width, "width", scope, { min: "0.1" }),
    profileField("Height", profile.height, "height", scope, { min: "0.1" }),
    profileField("Corner radius", profile.cornerRadius, "cornerRadius", scope, { min: "0" })
  );
}

function renderCutProfiles(body) {
  cutProfileFields.replaceChildren();
  if (!body) {
    cutProfileFields.append(emptyMessage("No body selected"));
    return;
  }

  if (!body.sketch.cutProfiles.length) {
    cutProfileFields.append(emptyMessage("No holes or cuts"));
    return;
  }

  for (const [index, profile] of body.sketch.cutProfiles.entries()) {
    const card = document.createElement("section");
    card.className = "cut-card";

    const header = document.createElement("div");
    header.className = "cut-card__header";
    const title = document.createElement("strong");
    title.textContent = `${profile.id} / ${profile.type}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "parts-icon-button parts-icon-button--danger";
    remove.setAttribute("aria-label", `Remove ${profile.id}`);
    remove.dataset.removeCutIndex = String(index);
    const removeIcon = document.createElement("span");
    removeIcon.className = "parts-icon parts-icon--delete";
    removeIcon.setAttribute("aria-hidden", "true");
    remove.append(removeIcon);
    header.append(title, remove);

    const fields = document.createElement("div");
    fields.className = "inspector-stack";
    renderProfileFields(fields, profile, `cut:${index}`);
    card.append(header, fields);
    cutProfileFields.append(card);
  }
}

function emptyMessage(message) {
  const element = document.createElement("p");
  element.className = "empty-note";
  element.textContent = message;
  return element;
}

function createMapper(bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxZ - bounds.minZ, 1);
  const svgWidth = 940;
  const svgHeight = 560;
  const padding = 46;
  const scale = Math.min((svgWidth - padding * 2) / width, (svgHeight - padding * 2) / height);
  const offsetX = (svgWidth - width * scale) / 2;
  const offsetY = (svgHeight - height * scale) / 2;

  return {
    svgWidth,
    svgHeight,
    scale,
    x(value) {
      return offsetX + (value - bounds.minX) * scale;
    },
    z(value) {
      return svgHeight - (offsetY + (value - bounds.minZ) * scale);
    },
    sketchX(value) {
      return bounds.minX + (value - offsetX) / scale;
    },
    sketchZ(value) {
      return bounds.minZ + (svgHeight - value - offsetY) / scale;
    }
  };
}

function roundedRectPath(x0, y0, x1, y1, radius) {
  const r = Math.max(0, Math.min(radius, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2));
  if (r <= 0.01) return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
  return [
    `M ${x0 + r} ${y0}`,
    `L ${x1 - r} ${y0}`,
    `Q ${x1} ${y0} ${x1} ${y0 + r}`,
    `L ${x1} ${y1 - r}`,
    `Q ${x1} ${y1} ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `Q ${x0} ${y1} ${x0} ${y1 - r}`,
    `L ${x0} ${y0 + r}`,
    `Q ${x0} ${y0} ${x0 + r} ${y0}`,
    "Z"
  ].join(" ");
}

function profileToSvg(profile, mapper, className, fill) {
  const strokeProps = `class="${className}" fill="${fill}" vector-effect="non-scaling-stroke"`;
  if (profile.type === "circle") {
    return `<circle ${strokeProps} cx="${mapper.x(profile.x)}" cy="${mapper.z(profile.z)}" r="${profile.radius * mapper.scale}" />`;
  }

  if (profile.type === "roundedSlot") {
    const radius = (profile.width / 2) * mapper.scale;
    const halfStraight = Math.max(0, (profile.length - profile.width) / 2);
    const left = mapper.x(profile.x - halfStraight);
    const right = mapper.x(profile.x + halfStraight);
    const top = mapper.z(profile.z + profile.width / 2);
    const bottom = mapper.z(profile.z - profile.width / 2);
    const path = [
      `M ${left} ${top}`,
      `L ${right} ${top}`,
      `A ${radius} ${radius} 0 0 1 ${right} ${bottom}`,
      `L ${left} ${bottom}`,
      `A ${radius} ${radius} 0 0 1 ${left} ${top}`,
      "Z"
    ].join(" ");
    return `<path ${strokeProps} d="${path}" />`;
  }

  if (profile.type === "polyline") {
    const points = profile.points.map((point) => `${mapper.x(point[0])},${mapper.z(point[1])}`).join(" ");
    return `<polygon ${strokeProps} points="${points}" />`;
  }

  const x0 = mapper.x(profile.x - profile.width / 2);
  const x1 = mapper.x(profile.x + profile.width / 2);
  const y0 = mapper.z(profile.z + profile.height / 2);
  const y1 = mapper.z(profile.z - profile.height / 2);
  const path = roundedRectPath(x0, y0, x1, y1, (profile.cornerRadius ?? 0) * mapper.scale);
  return `<path ${strokeProps} d="${path}" />`;
}

function resizeHandleSvg(handle, x, z, mapper) {
  const size = 14;
  const cx = mapper.x(x);
  const cy = mapper.z(z);
  return `<rect class="sketch-resize-handle sketch-resize-handle--${handle}" data-sketch-resize-handle="${handle}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="3" vector-effect="non-scaling-stroke" />`;
}

function sketchResizeHandlesSvg(body, mapper) {
  const bounds = profileBounds(body?.sketch?.outerProfile);
  if (!bounds) return "";
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const handles = [
    ["nw", bounds.minX, bounds.maxZ],
    ["n", centerX, bounds.maxZ],
    ["ne", bounds.maxX, bounds.maxZ],
    ["e", bounds.maxX, centerZ],
    ["se", bounds.maxX, bounds.minZ],
    ["s", centerX, bounds.minZ],
    ["sw", bounds.minX, bounds.minZ],
    ["w", bounds.minX, centerZ]
  ];

  return `<g class="sketch-resize-handles" aria-label="Mouse resize handles">${handles
    .map(([handle, x, z]) => resizeHandleSvg(handle, x, z, mapper))
    .join("")}</g>`;
}

function gridStepForBounds(bounds) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);
  const rawStep = span / 28;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  for (const factor of [1, 2, 5, 10]) {
    if (rawStep <= magnitude * factor) return magnitude * factor;
  }
  return magnitude * 10;
}

function gridSvg(bounds, mapper) {
  const lines = [];
  const step = gridStepForBounds(bounds);
  const startX = Math.floor(bounds.minX / step) * step;
  const endX = Math.ceil(bounds.maxX / step) * step;
  const startZ = Math.floor(bounds.minZ / step) * step;
  const endZ = Math.ceil(bounds.maxZ / step) * step;

  for (let x = startX; x <= endX; x += step) {
    const className = Math.abs(x) < 0.001 ? "sketch-axis-line" : "sketch-grid-line";
    lines.push(`<line class="${className}" x1="${mapper.x(x)}" y1="0" x2="${mapper.x(x)}" y2="${mapper.svgHeight}" vector-effect="non-scaling-stroke" />`);
  }
  for (let z = startZ; z <= endZ; z += step) {
    const className = Math.abs(z) < 0.001 ? "sketch-axis-line" : "sketch-grid-line";
    lines.push(`<line class="${className}" x1="0" y1="${mapper.z(z)}" x2="${mapper.svgWidth}" y2="${mapper.z(z)}" vector-effect="non-scaling-stroke" />`);
  }
  return lines.join("");
}

function sketchPointFromPointer(event, drag) {
  const svgX = ((event.clientX - drag.rect.left) / Math.max(drag.rect.width, 1)) * drag.mapper.svgWidth;
  const svgY = ((event.clientY - drag.rect.top) / Math.max(drag.rect.height, 1)) * drag.mapper.svgHeight;
  return {
    x: drag.mapper.sketchX(svgX),
    z: drag.mapper.sketchZ(svgY)
  };
}

function previewSketchResizeProject(nextProject) {
  history.current = normalizePartProject(nextProject);
  render();
}

function clearSketchResizeListeners() {
  window.removeEventListener("pointermove", handleSketchResizeMove);
  window.removeEventListener("pointerup", endSketchResizeDrag);
  window.removeEventListener("pointercancel", cancelSketchResizeDrag);
  window.removeEventListener("blur", cancelSketchResizeDrag);
}

function releaseSketchResizeCapture(drag) {
  try {
    drag.captureTarget?.releasePointerCapture?.(drag.pointerId);
  } catch (_error) {
    // The sketch SVG can be replaced while live resize previews render.
  }
}

function handleSketchResizeMove(event) {
  if (!sketchResizeDrag || event.pointerId !== sketchResizeDrag.pointerId) return;
  event.preventDefault();

  try {
    const point = sketchPointFromPointer(event, sketchResizeDrag);
    const targetSize = targetSizeFromSketchResize(point, sketchResizeDrag, {
      uniform: resizeUniform,
      minSizeMm: SKETCH_MOUSE_RESIZE_MIN_MM
    });
    const nextProject = updateBody(sketchResizeDrag.startProject, sketchResizeDrag.bodyId, (draft) =>
      resizePartBodyToTargetSize(draft, targetSize, {
        currentSizeMm: sketchResizeDrag.startSize,
        keepCutSizes: resizeKeepCutSizes
      })
    );
    sketchResizeDrag.latestProject = nextProject;
    previewSketchResizeProject(nextProject);
  } catch (error) {
    showStatus(error.message ?? "Unable to resize body.", 4200);
  }
}

function endSketchResizeDrag(event) {
  if (!sketchResizeDrag || event.pointerId !== sketchResizeDrag.pointerId) return;
  event.preventDefault();
  clearSketchResizeListeners();

  const drag = sketchResizeDrag;
  sketchResizeDrag = null;
  releaseSketchResizeCapture(drag);
  const finalProject = normalizePartProject(drag.latestProject ?? history.current);
  const changed = JSON.stringify(drag.startProject) !== JSON.stringify(finalProject);
  if (changed) {
    history.undoStack.push(drag.startProject);
    if (history.undoStack.length > history.limit) history.undoStack.shift();
    history.current = finalProject;
    history.redoStack = [];
  }
  render();

  const issues = validateBody(selectedProjectBody());
  if (!changed) {
    showStatus("Resize unchanged");
  } else if (issues.length) {
    showStatus(issues[0].message, 5200);
  } else {
    showStatus("Resized by mouse");
  }
}

function cancelSketchResizeDrag(event) {
  if (!sketchResizeDrag || (Number.isInteger(event?.pointerId) && event.pointerId !== sketchResizeDrag.pointerId)) return;
  clearSketchResizeListeners();
  const drag = sketchResizeDrag;
  sketchResizeDrag = null;
  releaseSketchResizeCapture(drag);
  history.current = drag.startProject;
  render();
}

function beginSketchResizeDrag(event, body, mapper) {
  if (event.button !== 0) return;
  if (sketchResizeDrag) {
    cancelSketchResizeDrag({ pointerId: sketchResizeDrag.pointerId });
    return;
  }
  const handle = event.target?.dataset?.sketchResizeHandle;
  if (!handle || !body?.sketch?.outerProfile) return;
  const bounds = profileBounds(body.sketch.outerProfile);
  if (!bounds) return;

  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const startProject = normalizePartProject(history.current);
  sketchResizeDrag = {
    pointerId: event.pointerId,
    bodyId: body.id,
    handle,
    mapper,
    rect,
    captureTarget: event.currentTarget,
    startProject,
    latestProject: startProject,
    startSize: currentBodySize(body),
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerZ: (bounds.minZ + bounds.maxZ) / 2
  };
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  } catch (_error) {
  }
  window.addEventListener("pointermove", handleSketchResizeMove);
  window.addEventListener("pointerup", endSketchResizeDrag);
  window.addEventListener("pointercancel", cancelSketchResizeDrag);
  window.addEventListener("blur", cancelSketchResizeDrag);
}

function renderSketchPreview(body) {
  sketchPreview.replaceChildren();
  if (body && !isSketchBody(body)) {
    const element = document.createElement("p");
    element.className = "sketch-empty";
    element.textContent = "Advanced body";
    sketchPreview.append(element);
    return;
  }

  if (!body?.sketch?.outerProfile) {
    const element = document.createElement("p");
    element.className = "sketch-empty";
    element.textContent = "Add a template body";
    sketchPreview.append(element);
    return;
  }

  const profiles = [body.sketch.outerProfile, ...body.sketch.cutProfiles];
  const rawBounds = combinedProfileBounds(profiles);
  const margin = 16;
  const bounds = {
    minX: rawBounds.minX - margin,
    maxX: rawBounds.maxX + margin,
    minZ: rawBounds.minZ - margin,
    maxZ: rawBounds.maxZ + margin
  };
  const mapper = createMapper(bounds);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${mapper.svgWidth} ${mapper.svgHeight}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${body.name} sketch preview`);
  svg.innerHTML = `
    <rect width="${mapper.svgWidth}" height="${mapper.svgHeight}" fill="#f8fafc" />
    ${gridSvg(bounds, mapper)}
    ${profileToSvg(body.sketch.outerProfile, mapper, "sketch-outer", `${body.color}33`)}
    ${body.sketch.cutProfiles.map((profile) => profileToSvg(profile, mapper, "sketch-cut", "#ffffff")).join("")}
    ${sketchResizeHandlesSvg(body, mapper)}
  `;
  svg.addEventListener("pointerdown", (event) => beginSketchResizeDrag(event, body, mapper));
  sketchPreview.append(svg);
}

function renderValidation(project) {
  const issues = validatePartProject(project);
  validationCount.textContent = issues.length ? `${issues.length}` : "OK";
  validationList.replaceChildren();

  if (!issues.length) {
    const ok = document.createElement("li");
    ok.className = "validation-ok";
    ok.textContent = "Project validates";
    validationList.append(ok);
    return;
  }

  for (const item of issues.slice(0, 12)) {
    const row = document.createElement("li");
    const code = document.createElement("span");
    code.className = "validation-code";
    code.textContent = item.code;
    const message = document.createElement("span");
    message.textContent = item.message;
    row.append(code, message);
    validationList.append(row);
  }
}

function render() {
  history.current = normalizePartProject(history.current);
  const project = history.current;
  const body = selectedProjectBody();

  projectUpdatedAt.textContent = project.updatedAt ? new Date(project.updatedAt).toLocaleString() : "-";
  selectedBodySummary.textContent = body
    ? `${body.name} / ${isSketchBody(body) ? (body.sketch.outerProfile?.type ?? "no profile") : sourceLabel(body)}`
    : "No body selected";

  undoButton.disabled = history.undoStack.length === 0;
  redoButton.disabled = history.redoStack.length === 0;
  saveProjectButton.disabled = false;

  renderBodyList(project);
  renderBodyProperties(body);
  if (body && !isSketchBody(body)) {
    outerProfileFields.replaceChildren(createAdvancedBodySummary(body));
  } else {
    renderProfileFields(outerProfileFields, body?.sketch?.outerProfile ?? null, "outer");
  }
  renderCutProfiles(body);
  renderSketchPreview(body);
  renderValidation(project);
  previewScene.setSelectedBodyId(project.selectedBodyId);
  requestCadCompile(project);
}

function updateProfileFromInput(input) {
  const body = selectedProjectBody();
  if (!body) return;

  const scope = input.dataset.profileScope;
  const prop = input.dataset.profileProp;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;

  commitSelectedBody((draft) => {
    const profile =
      scope === "outer"
        ? draft.sketch.outerProfile
        : draft.sketch.cutProfiles[Number(scope.split(":")[1])];
    if (!profile) return draft;

    if (prop === "point") {
      const point = profile.points?.[Number(input.dataset.pointIndex)];
      if (point) point[Number(input.dataset.pointAxis)] = value;
    } else {
      profile[prop] = value;
    }
    return draft;
  });
}

function handleBodyPropertyInput(input) {
  const prop = input.dataset.bodyProp;
  commitSelectedBody((draft) => {
    if (prop === "name") draft.name = input.value.trim() || draft.name;
    if (prop === "color") draft.color = input.value;
    if (prop === "extrudeDepthMm") draft.extrudeDepthMm = Number(input.value);
    return draft;
  });
}

function handleTransformInput(input) {
  const kind = input.dataset.transformKind;
  const axis = Number(input.dataset.axis);
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;

  commitSelectedBody((draft) => {
    draft.transform[kind][axis] = value;
    return draft;
  });
}

function handleResizeOptionInput(input) {
  if (input.dataset.resizeOption === "uniform") resizeUniform = input.checked;
  if (input.dataset.resizeOption === "keepCutSizes") resizeKeepCutSizes = input.checked;
  window.setTimeout(() => renderBodyProperties(selectedProjectBody()), 0);
}

function handleResizeTargetInput(input) {
  const body = selectedProjectBody();
  if (!body) return;

  try {
    const axis = Number(input.dataset.resizeTargetAxis);
    const currentSize = currentBodySize(body);
    const targetSize = targetSizeFromAxisEdit(currentSize, axis, Number(input.value), resizeUniform);
    window.setTimeout(() => {
      try {
        commitSelectedBody((draft) =>
          resizePartBodyToTargetSize(draft, targetSize, {
            currentSizeMm: currentSize,
            keepCutSizes: resizeKeepCutSizes
          })
        );
        const issues = validateBody(selectedProjectBody());
        if (issues.length) {
          showStatus(issues[0].message, 5200);
        } else {
          showStatus(`Resized ${body.name}`);
        }
      } catch (error) {
        showStatus(error.message ?? "Unable to resize body.", 5200);
        renderBodyProperties(selectedProjectBody());
      }
    }, 0);
  } catch (error) {
    showStatus(error.message ?? "Unable to resize body.", 5200);
    renderBodyProperties(body);
  }
}

function handleInspectorChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.resizeOption) handleResizeOptionInput(input);
  if (input.dataset.resizeTargetAxis) handleResizeTargetInput(input);
  if (input.dataset.bodyProp) handleBodyPropertyInput(input);
  if (input.dataset.transformKind) handleTransformInput(input);
  if (input.dataset.profileScope) updateProfileFromInput(input);
}

function createCutProfile(type) {
  const body = selectedProjectBody();
  if (!isSketchBody(body) || !body?.sketch?.outerProfile) return null;
  const [centerX, centerZ] = profileCenter(body.sketch.outerProfile);
  const size = profileSize(body.sketch.outerProfile);
  const existingIds = new Set([
    body.sketch.outerProfile.id,
    ...body.sketch.cutProfiles.map((profile) => profile.id)
  ]);

  if (type === "slot") {
    return createSlottedHole({
      id: uniquePartId("slot_hole", existingIds, "slot_hole"),
      x: centerX,
      z: centerZ,
      length: Math.max(12, Math.min(size.width * 0.22, 28)),
      width: Math.max(4, Math.min(size.height * 0.12, 8))
    });
  }

  return createCircularHole({
    id: uniquePartId("hole", existingIds, "hole"),
    x: centerX,
    z: centerZ,
    radius: Math.max(2, Math.min(size.width, size.height) * 0.06)
  });
}

function selectedProfileIds(body) {
  return new Set([
    body.sketch.outerProfile.id,
    ...body.sketch.cutProfiles.map((profile) => profile.id)
  ]);
}

function addLinearHolePattern() {
  const body = selectedProjectBody();
  if (!isSketchBody(body) || !body?.sketch?.outerProfile) return;
  const [centerX, centerZ] = profileCenter(body.sketch.outerProfile);
  const size = profileSize(body.sketch.outerProfile);
  const hole = createCircularHole({
    id: "linear_hole",
    radius: Math.max(1.6, Math.min(size.width, size.height) * 0.04)
  });
  const holes = createLinearPatternProfiles(hole, {
    count: 5,
    spacingX: Math.max(8, size.width * 0.16),
    spacingZ: 0,
    originX: centerX,
    originZ: centerZ,
    idPrefix: "linear_hole",
    existingIds: selectedProfileIds(body)
  });

  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(...holes);
    return draft;
  }, "Linear hole pattern added");
}

function addCircularHolePattern() {
  const body = selectedProjectBody();
  if (!isSketchBody(body) || !body?.sketch?.outerProfile) return;
  const [centerX, centerZ] = profileCenter(body.sketch.outerProfile);
  const size = profileSize(body.sketch.outerProfile);
  const radius = Math.max(8, Math.min(size.width, size.height) * 0.32);
  const hole = createCircularHole({
    id: "bolt_hole",
    radius: Math.max(1.4, Math.min(size.width, size.height) * 0.035)
  });
  const holes = createCircularPatternProfiles(hole, {
    count: 6,
    radius,
    centerX,
    centerZ,
    idPrefix: "bolt_hole",
    existingIds: selectedProfileIds(body)
  });

  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(...holes);
    return draft;
  }, "Bolt circle added");
}

function addRevolvedBody(presetId = revolvePresetSelect.value) {
  ensureSelectValue(revolvePresetSelect, presetId, "revolve preset id");
  const existingIds = new Set(history.current.bodies.map((body) => body.id));
  const body = createRevolveBodyFromPreset(revolvePresetSelect.value, {}, existingIds);
  commit(addBody(history.current, body), `${body.name} added`);
  return body;
}

function addSpurGear() {
  const existingIds = new Set(history.current.bodies.map((body) => body.id));
  const body = createSpurGearBody(
    {
      gear: {
        toothCount: 24,
        moduleMm: 2,
        pressureAngleDeg: 20,
        boreDiameterMm: 6,
        thicknessMm: 6
      },
      color: "#d97706"
    },
    existingIds
  );
  commit(addBody(history.current, body), "Spur gear added");
  return body;
}

function booleanOperandBodies() {
  const selected = selectedProjectBody();
  const others = history.current.bodies.filter((body) => body.id !== selected?.id);
  if (selected) return [selected, ...others].slice(0, 2);
  return history.current.bodies.slice(0, 2);
}

function addBooleanBody(operation = booleanOperationSelect.value, options = {}) {
  ensureSelectValue(booleanOperationSelect, operation, "boolean operation");
  const operands = booleanOperandBodies();
  if (operands.length < 2) {
    if (options.throwOnInvalid) throw new Error("Create at least two bodies before adding a boolean body.");
    showStatus("Create at least two bodies before adding a boolean body.", 4200);
    return null;
  }

  const existingIds = new Set(history.current.bodies.map((body) => body.id));
  const body = createBooleanOperationBody(
    operation,
    operands,
    {
      name: `${operation} ${operands[0].name} ${operands[1].name}`,
      color: "#14b8a6"
    },
    existingIds
  );
  commit(addBody(history.current, body), `${operation} body added`);
  return body;
}

async function exportSelectedStl(options = {}) {
  if (options.waitForCompile) await waitForCadReady();
  const body = selectedProjectBody();
  if (!body || !compileResults.has(body.id)) {
    showStatus("Build a generated body before exporting STL.", 4200);
    if (options.throwOnInvalid) throw new Error("Build a generated body before exporting STL.");
    return;
  }

  const requestId = nextWorkerRequestId();
  pendingStlExports.set(requestId, body.id);
  exportStlButton.disabled = true;
  showStatus("Preparing STL...", 8000);
  cadWorker.postMessage({ type: "exportStl", requestId, body, bodies: history.current.bodies });
}

async function sendGeneratedAssembly(options = {}) {
  if (options.waitForCompile) await waitForCadReady();
  const visibleBodyIds = new Set(previewScene.getVisibleBodyIds());
  const bodies = history.current.bodies.filter(
    (body) => visibleBodyIds.has(body.id) && compileResults.has(body.id) && validateBody(body).length === 0
  );

  if (!bodies.length) {
    showStatus("Build at least one valid generated body before handoff.", 5200);
    if (options.throwOnInvalid) throw new Error("Build at least one valid generated body before handoff.");
    return;
  }

  sendAssemblyButton.disabled = true;
  showStatus("Preparing Assembly Studio handoff...", 10000);

  try {
    const snapshotCompileResults = new Map(compileResults);
    const matrixWorldById = previewScene.getMatrixWorldById();
    const glb = await previewScene.exportVisibleGlb();
    const snapshot = createGeneratedAssemblySnapshot({
      glb,
      bodies,
      compileResults: snapshotCompileResults,
      matrixWorldById
    });
    await writeWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, snapshot);
    window.location.href = `${import.meta.env.BASE_URL}?fromParts=1`;
  } catch (error) {
    console.error("Part Studio handoff failed", error);
    sendAssemblyButton.disabled = false;
    renderCompileStatus();
    showStatus("Unable to send generated parts to Assembly Studio.", 5200);
    if (options.throwOnInvalid) throw new Error("Unable to send generated parts to Assembly Studio.");
  }
}

function mountPartsAssistant() {
  const assistant = mountPageAssistant({
    pageId: "parts",
    title: "Robotic Part Studio",
    getContext: partsAssistantContext,
    actions: {
      parts_new_project: () => {
        resetProjectHistory(history);
        render();
        showStatus("New PartProject");
        return "New PartProject started.";
      },
      parts_save_project_json: () => {
        downloadBlob(serializePartProject(history.current), "robotic-part-project.json", "application/json");
        showStatus("PartProject JSON saved");
        return "PartProject JSON download started.";
      },
      parts_open_project_picker: () => {
        projectFileInput.click();
        return "PartProject JSON file picker opened.";
      },
      parts_export_selected_stl: async () => {
        await exportSelectedStl({ waitForCompile: true, throwOnInvalid: true });
        return "Selected body STL export started.";
      },
      parts_send_assembly: async () => {
        await sendGeneratedAssembly({ waitForCompile: true, throwOnInvalid: true });
        return "Assembly Studio handoff started.";
      },
      parts_open_assembly_studio: () => {
        window.location.href = import.meta.env.BASE_URL;
        return "Assembly Studio is opening.";
      },
      parts_undo: () => {
        if (!history.undoStack.length) return "Nothing to undo.";
        undoProject(history);
        render();
        return "Undo complete.";
      },
      parts_redo: () => {
        if (!history.redoStack.length) return "Nothing to redo.";
        redoProject(history);
        render();
        return "Redo complete.";
      },
      parts_select_body: ({ bodyId }) => {
        const body = selectBodyForAssistant(bodyId);
        showStatus(`Selected ${body.name}`);
        return `${body.name} selected.`;
      },
      parts_set_template_selection: ({ templateId }) => {
        ensureSelectValue(templateSelect, templateId, "template id");
        return `${templateLabel(templateId)} selected.`;
      },
      parts_add_template_body: ({ templateId }) => {
        const body = addTemplateBody(templateId ?? templateSelect.value);
        return `${body.name} added.`;
      },
      parts_duplicate_body: ({ bodyId } = {}) => duplicateBodyForAssistant(bodyId),
      parts_delete_body: ({ bodyId } = {}) => deleteBodyForAssistant(bodyId),
      parts_set_body_properties: (args) => setBodyPropertiesForAssistant(args),
      parts_resize_body: (args) => resizeBodyForAssistant(args),
      parts_set_profile: (args) => setProfileForAssistant(args),
      parts_add_cut_profile: (args) => addCutProfileForAssistant(args),
      parts_remove_cut_profile: (args) => removeCutProfileForAssistant(args),
      parts_add_linear_pattern: ({ bodyId } = {}) => {
        selectedSketchBodyForAssistant(bodyId);
        addLinearHolePattern();
        return "Linear hole pattern added.";
      },
      parts_add_circular_pattern: ({ bodyId } = {}) => {
        selectedSketchBodyForAssistant(bodyId);
        addCircularHolePattern();
        return "Bolt circle added.";
      },
      parts_set_revolve_preset: ({ presetId }) => {
        ensureSelectValue(revolvePresetSelect, presetId, "revolve preset id");
        return `${presetId} lathe preset selected.`;
      },
      parts_add_revolve_body: ({ presetId } = {}) => {
        const body = addRevolvedBody(presetId ?? revolvePresetSelect.value);
        return `${body.name} added.`;
      },
      parts_add_spur_gear: () => {
        const body = addSpurGear();
        return `${body.name} added.`;
      },
      parts_set_boolean_operation: ({ operation }) => {
        ensureSelectValue(booleanOperationSelect, operation, "boolean operation");
        return `${operation} selected.`;
      },
      parts_add_boolean_body: ({ operation } = {}) => {
        const body = addBooleanBody(operation ?? booleanOperationSelect.value, { throwOnInvalid: true });
        return `${body.name} added.`;
      }
    }
  });
  mountAssistantEvalPanel({ adapter: assistant.adapter });
  return assistant;
}

addTemplateButton.addEventListener("click", () => {
  addTemplateBody();
});

addLinearPatternButton.addEventListener("click", addLinearHolePattern);
addCircularPatternButton.addEventListener("click", addCircularHolePattern);
addRevolveBodyButton.addEventListener("click", addRevolvedBody);
addSpurGearButton.addEventListener("click", addSpurGear);
addBooleanBodyButton.addEventListener("click", addBooleanBody);

newProjectButton.addEventListener("click", () => {
  resetProjectHistory(history);
  render();
  showStatus("New PartProject");
});

saveProjectButton.addEventListener("click", () => {
  downloadBlob(serializePartProject(history.current), "robotic-part-project.json", "application/json");
  showStatus("PartProject JSON saved");
});

openProjectButton.addEventListener("click", () => projectFileInput.click());

projectFileInput.addEventListener("change", () => {
  const file = projectFileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      resetProjectHistory(history, parsePartProjectJson(reader.result));
      render();
      showStatus("PartProject JSON opened");
    } catch (error) {
      showStatus(error.message, 5200);
    } finally {
      projectFileInput.value = "";
    }
  });
  reader.addEventListener("error", () => {
    showStatus("PartProject JSON could not be read", 5200);
    projectFileInput.value = "";
  });
  reader.readAsText(file);
});

undoButton.addEventListener("click", () => {
  undoProject(history);
  render();
});

redoButton.addEventListener("click", () => {
  redoProject(history);
  render();
});

exportStlButton.addEventListener("click", () => {
  void exportSelectedStl();
});
sendAssemblyButton.addEventListener("click", () => {
  void sendGeneratedAssembly();
});

duplicateBodyButton.addEventListener("click", () => {
  if (!selectedProjectBody()) return;
  duplicateBodyForAssistant();
});

deleteBodyButton.addEventListener("click", () => {
  if (!selectedProjectBody()) return;
  deleteBodyForAssistant();
});

addCircularHoleButton.addEventListener("click", () => {
  const cut = createCutProfile("circle");
  if (!cut) return;
  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(cut);
    return draft;
  }, "Circular hole added");
});

addSlottedHoleButton.addEventListener("click", () => {
  const cut = createCutProfile("slot");
  if (!cut) return;
  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(cut);
    return draft;
  }, "Slotted hole added");
});

bodyProperties.addEventListener("change", handleInspectorChange);
outerProfileFields.addEventListener("change", handleInspectorChange);
cutProfileFields.addEventListener("change", handleInspectorChange);
cutProfileFields.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-cut-index]");
  if (!button) return;
  const index = Number(button.dataset.removeCutIndex);
  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.splice(index, 1);
    return draft;
  }, "Cut removed");
});

renderTemplateOptions();
renderAdvancedOptions();
render();
mountPartsAssistant();
