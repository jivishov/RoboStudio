import "./tokens.css";
import "./shellCards.css";
import "./parts.css";
import "./shellHeader.css";
import { mountPageAssistant } from "./assistant/chatUi.js";
import { mountAssistantEvalPanel } from "./assistant/evalRunner.js";
import { isSupabaseConfigured } from "./auth/authConfig.js";
import { createAuthSessionController } from "./auth/authSession.js";
import {
  ADVANCED_CAD_RECIPE_KIND,
  BOOLEAN_OPERATION_KIND,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND,
  sanitizePartId,
  uniquePartId
} from "./parts/contracts.js";
import {
  createAdvancedCadRecipeBodyFromArgs,
  replaceAdvancedCadRecipeBodyFromArgs
} from "./parts/advancedCadRecipe.js";
import {
  BOOLEAN_OPERATIONS,
  FULL_REVOLVE_ANGLE_DEG,
  createBooleanOperationBody,
  createCircularPatternProfiles,
  createLinearPatternProfiles,
  createRevolveBodyFromPreset,
  listRevolvePresets
} from "./parts/featureOps.js";
import {
  MAX_ABS_HELIX_ANGLE_DEG,
  MAX_ABS_PROFILE_SHIFT,
  MAX_PRESSURE_ANGLE_DEG,
  MAX_TOOTH_COUNT,
  MIN_PRESSURE_ANGLE_DEG,
  MIN_TOOTH_COUNT,
  createSpurGearBody,
  spurGearGeometry
} from "./parts/gears.js";
import { spurGearPairReport } from "./parts/gearPair.js";
import { ABSENT_OUTPUT, formatOutput } from "./parts/format.js";
import { ISO_53_PROFILE_ANGLE_DEG, listBasicRackProfiles } from "./parts/standards/gears.js";
import {
  applyCompileOutcome,
  compileCacheErrors,
  compileCacheResults,
  compileCacheWarnings,
  createCompileCache,
  planBodyCompile,
  pruneCompileCache
} from "./parts/compileCache.js";
import { bodyCompensationReport } from "./parts/cadCompile.js";
import { CAD_COMPILE_URL, createCadBackendProbe, describeCadBackend } from "./parts/cadBackend.js";
import { exactBodyCompileRequest, exactBodyUnavailableReason } from "./parts/backendPayload.js";
import { scaleGeometryProperties } from "./parts/massProperties.js";
import {
  EXPORT_FORMATS,
  EXPORT_FORMAT_3MF,
  EXPORT_FORMAT_ASCII_STL,
  EXPORT_FORMAT_STEP,
  bodyExportAvailabilities,
  bodyExportAvailability
} from "./parts/exportFormats.js";
import { NON_WATERTIGHT_CODE } from "./parts/watertight.js";
import { getMaterial, listMaterials, massGramsForVolume } from "./parts/materials.js";
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
import { createStatusChannel } from "./statusChannel.js";
import { createHistoryShortcutHandler } from "./shortcuts.js";
import {
  CUT_PROFILE_TYPES,
  OUTER_PROFILE_TYPES,
  combinedProfileBounds,
  createCircularHole,
  createSlottedHole,
  profileBounds,
  profileCenter,
  profileSize
} from "./parts/sketch.js";
import { createBodyFromTemplate, listPartTemplates } from "./parts/templates.js";
import { appendHardwarePatternToSketch, getHardwareEntry, listHardwareEntries } from "./parts/hardware.js";
import { createCustomSketchBodyFromArgs, replaceSketchBodyFromArgs } from "./parts/customSketchBody.js";
import {
  addPartLibraryItemToProject,
  createPartLibraryItem,
  mergePartLibraryItems,
  normalizePartLibraryItem,
  parsePartLibraryBundleJson,
  partLibraryItemSummary,
  serializePartLibraryBundle
} from "./parts/library.js";
import {
  deleteSupabasePartLibraryItem,
  syncPartLibraryWithSupabase,
  upsertSupabasePartLibraryItem
} from "./parts/supabaseLibrary.js";
import { validateBody, validatePartProject } from "./parts/validation.js";
import { createPartPreviewScene } from "./parts/previewScene.js";
import { createGeneratedAssemblySnapshot } from "./parts/snapshot.js";
import {
  bodyEffectiveSizeMm,
  resizePartBodyToTargetSize,
  targetSizeFromAxisEdit
} from "./parts/resize.js";
import { SKETCH_MOUSE_RESIZE_MIN_MM, targetSizeFromSketchResize } from "./parts/sketchResize.js";
import {
  HOLE_FACES,
  HOLE_POCKET_STYLES,
  HOLE_PROCESSES,
  HOLE_STANDARDS,
  HOLE_STYLES,
  describeHole,
  holeDerivedRadiusMm,
  normalizeHoleSpec,
  resolveHole
} from "./parts/holes.js";
import { CLEARANCE_FITS, FASTENER_SIZES } from "./parts/standards/fasteners.js";
import { bodyProcessId, projectManufacturabilityIssues } from "./parts/dfm.js";
import { describeMinimumLength, describePurchased, projectBom } from "./parts/bom.js";
import { projectPrintPrep } from "./parts/printPrep.js";
import { bodyDrawingSheet } from "./parts/drawings/sheet.js";
import { describeProcess, getProcessProfile, listProcessProfiles, normalizeProcessId } from "./parts/process.js";
import { createWorkspaceStore } from "./workspaceStore.js";
import { createPartProjectAutosave } from "./parts/autosave.js";
import { mountShellCardToggles } from "./shellCards.js";

/** The size a hole starts at when a standard is first chosen for a profile. */
const DEFAULT_HOLE_SIZE = "M3";

const templateSelect = document.querySelector("#template-select");
const addTemplateButton = document.querySelector("#add-template");
const addLinearPatternButton = document.querySelector("#add-linear-pattern");
const addCircularPatternButton = document.querySelector("#add-circular-pattern");
const hardwareEntrySelect = document.querySelector("#hardware-entry-select");
const applyHardwarePatternButton = document.querySelector("#apply-hardware-pattern");
const hardwareEntryNote = document.querySelector("#hardware-entry-note");
const revolvePresetSelect = document.querySelector("#revolve-preset-select");
const addRevolveBodyButton = document.querySelector("#add-revolve-body");
const addSpurGearButton = document.querySelector("#add-spur-gear");
const booleanOperationSelect = document.querySelector("#boolean-operation-select");
const addBooleanBodyButton = document.querySelector("#add-boolean-body");
const saveLibraryPartButton = document.querySelector("#save-library-part");
const exportLibraryButton = document.querySelector("#export-library");
const importLibraryButton = document.querySelector("#import-library");
const librarySignInButton = document.querySelector("#library-sign-in");
const librarySyncButton = document.querySelector("#library-sync");
const librarySignOutButton = document.querySelector("#library-sign-out");
const libraryAuthStatus = document.querySelector("#library-auth-status");
const libraryFileInput = document.querySelector("#library-file-input");
const libraryList = document.querySelector("#library-list");
const libraryCount = document.querySelector("#library-count");
const bodyList = document.querySelector("#body-list");
const bodyCount = document.querySelector("#body-count");
const bodyProperties = document.querySelector("#body-properties");
const outerProfileFields = document.querySelector("#outer-profile-fields");
const cutProfileFields = document.querySelector("#cut-profile-fields");
const sketchPreview = document.querySelector("#sketch-preview");
const massProperties = document.querySelector("#mass-properties");
const massSummary = document.querySelector("#mass-summary");
const selectedBodySummary = document.querySelector("#selected-body-summary");
const projectUpdatedAt = document.querySelector("#project-updated-at");
const validationCount = document.querySelector("#validation-count");
const validationList = document.querySelector("#validation-list");
const dfmCount = document.querySelector("#dfm-count");
const dfmList = document.querySelector("#dfm-list");
const documentsSummary = document.querySelector("#documents-summary");
const bomTotalMass = document.querySelector("#bom-total-mass");
const bomPartsList = document.querySelector("#bom-parts-list");
const bomPurchasedList = document.querySelector("#bom-purchased-list");
const bomNote = document.querySelector("#bom-note");
const printPrepSummary = document.querySelector("#print-prep-summary");
const printPrepList = document.querySelector("#print-prep-list");
const drawingSummary = document.querySelector("#drawing-summary");
const drawingSheet = document.querySelector("#drawing-sheet");
const processSelect = document.querySelector("#process-select");
const compensationNominal = document.querySelector("#compensation-nominal");
const compensationAsMade = document.querySelector("#compensation-as-made");
const compensationNote = document.querySelector("#compensation-note");
const newProjectButton = document.querySelector("#new-project");
const saveProjectButton = document.querySelector("#save-project");
const openProjectButton = document.querySelector("#open-project");
const projectFileInput = document.querySelector("#project-file-input");
const undoButton = document.querySelector("#undo-project");
const redoButton = document.querySelector("#redo-project");
const exportMenu = document.querySelector("#export-menu");
const exportMenuToggle = document.querySelector("#export-menu-toggle");
const exportMenuPanel = document.querySelector("#export-menu-panel");
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

const CAD_COMPILE_TIMEOUT_MS = 15000;
const history = createProjectHistory();
const workspaceStore = createWorkspaceStore();
let cadWorker = null;
const previewScene = createPartPreviewScene(modelPreview);
const SVG_NS = "http://www.w3.org/2000/svg";
let compileTimer = null;
let compileTimeoutTimer = null;
let workerRequestId = 0;
// One request is in flight at a time. `activeCompileRequest` carries the body IDs it
// covers and the signatures they were posted at, so its result can be folded into the
// per-body cache and a superseded request can be abandoned without losing track of
// which bodies still need building.
let activeCompileRequest = null;
const compileCache = createCompileCache();
let compileResults = new Map();
let compileErrors = [];
let compileWarnings = [];
// A worker-level failure belongs to no body, so it is held separately from the
// per-body errors the cache owns.
let compileWorkerError = null;
let compiling = false;
let cadWorkerMessageCount = 0;
const compileRequestLog = [];
let resizeUniform = true;
let resizeKeepCutSizes = true;
// Which gear the mesh check compares against. A pair is a derived report rather than
// a persisted entity, so this is presentation state and never reaches the project.
let gearPairPartnerId = null;
let sketchResizeDrag = null;
const pendingExports = new Map();
let partLibraryItems = [];
const authController = createAuthSessionController();
let authState = authController.getState();
let libraryCloudBusy = false;
let lastSyncedUserId = null;

const statusChannel = createStatusChannel({
  element: statusElement,
  defaultTimeoutMs: 2400,
  reveal: true,
  liveRegionId: "part-live-region"
});

function showStatus(message, timeout = 2400) {
  statusChannel.show(message, timeout);
}

// Persistence. `history` is session-only UI state; only `history.current` is ever written.
let persistenceReady = false;
let savedProjectGeneration = 0;
let savedProjectUnreadable = false;

const projectAutosave = createPartProjectAutosave({
  serialize: (project) => serializePartProject(project),
  // Every mutation, including a bare re-selection, re-timestamps the project. A new timestamp
  // over identical geometry is not work worth a write, so it is excluded from the comparison.
  fingerprint: (project) => serializePartProject({ ...project, updatedAt: "" }),
  write: (serialized) => workspaceStore.writeCurrentPartProject(JSON.parse(serialized)),
  onWritten: () => {
    savedProjectGeneration += 1;
  },
  onError: (error) => {
    console.error("Component Builder autosave failed", error);
    showStatus("Project could not be saved to this browser. Save JSON to keep your work.", 6200);
  }
});

function scheduleProjectAutosave() {
  if (!persistenceReady) return;
  projectAutosave.schedule(history.current);
}

function flushProjectAutosave() {
  if (!persistenceReady) return Promise.resolve({ written: false, reason: "not-ready" });
  return projectAutosave.flush();
}

async function restoreSavedProject() {
  let savedRecord = null;
  try {
    savedRecord = await workspaceStore.readCurrentPartProject();
  } catch (error) {
    console.warn("Saved Component Builder project could not be read", error);
    savedProjectUnreadable = true;
    showStatus("Saved project storage is unavailable. Starting a new project.", 6200);
    return false;
  }
  if (savedRecord == null) return false;

  try {
    // Restore through the shared parser so a project written by a build with extra fields
    // loads here with those fields dropped rather than throwing (meta_plan landmine two).
    const project = parsePartProjectJson(
      typeof savedRecord === "string" ? savedRecord : JSON.stringify(savedRecord)
    );
    resetProjectHistory(history, project);
    render();
    projectAutosave.markSaved(history.current);
    const count = history.current.bodies.length;
    showStatus(`Restored saved project with ${count} bod${count === 1 ? "y" : "ies"}`);
    return true;
  } catch (error) {
    // The unreadable record is deliberately left in place: it is the user's only copy of
    // whatever was there, and autosave stays idle until they make a real edit.
    console.warn("Saved Component Builder project could not be restored", error);
    savedProjectUnreadable = true;
    showStatus("Saved project could not be read and was left untouched. Starting a new project.", 6200);
    return false;
  }
}

async function bootstrapProjectPersistence() {
  await restoreSavedProject();
  persistenceReady = true;
  installNavigationGuards();
  return { savedProjectUnreadable };
}

function installNavigationGuards() {
  // In-app page links can wait for the write, so they never need to interrupt the user.
  for (const link of document.querySelectorAll(".shell-header__page-link")) {
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      if (!projectAutosave.isDirty()) return;
      event.preventDefault();
      const href = link.href;
      void flushProjectAutosave().finally(() => {
        window.location.href = href;
      });
    });
  }

  // Reload and tab close cannot await a write, so an unflushed project has to prompt.
  window.addEventListener("beforeunload", (event) => {
    if (!projectAutosave.isDirty()) return;
    void flushProjectAutosave();
    event.preventDefault();
    event.returnValue = "";
  });

  // Backgrounding the tab is the last reliable point to persist without a prompt.
  window.addEventListener("pagehide", () => {
    void flushProjectAutosave();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushProjectAutosave();
  });
}

function installPersistenceInstrumentation() {
  window.__partsPersistence = Object.freeze({
    ready: () => persistenceReady,
    generation: () => savedProjectGeneration,
    dirty: () => projectAutosave.isDirty(),
    stats: () => projectAutosave.stats(),
    flush: () => flushProjectAutosave(),
    savedProjectUnreadable: () => savedProjectUnreadable,
    project: () => JSON.parse(serializePartProject(history.current)),
    historyDepth: () => ({ undo: history.undoStack.length, redo: history.redoStack.length })
  });
}

/**
 * Compile instrumentation for the browser suite.
 *
 * Two claims this cycle makes are only worth making if they are observable: that
 * editing one body recompiles that body alone, and that changing a material posts
 * no worker message at all. Both are read from here.
 */
function installCompileInstrumentation() {
  window.__partsCompile = Object.freeze({
    requests: () => compileRequestLog.map((entry) => ({ requestId: entry.requestId, bodyIds: [...entry.bodyIds] })),
    lastRequest: () => {
      const entry = compileRequestLog[compileRequestLog.length - 1];
      return entry ? { requestId: entry.requestId, bodyIds: [...entry.bodyIds] } : null;
    },
    workerMessages: () => cadWorkerMessageCount,
    compiling: () => compiling,
    resultBodyIds: () => [...compileResults.keys()],
    warnings: () => compileWarnings.map((warning) => ({ ...warning })),
    geometryProperties: (bodyId) => {
      const properties = compileResults.get(bodyId)?.geometryProperties ?? null;
      return properties ? JSON.parse(JSON.stringify(properties)) : null;
    },
    massGrams: (bodyId) => {
      const body = history.current.bodies.find((item) => item.id === bodyId) ?? null;
      return body ? bodyMassGrams(body) : null;
    }
  });
}

/**
 * Manufacturability instrumentation for the browser suite.
 *
 * The claim worth observing from a real page is that these findings never gate:
 * a body with findings still validates, still builds and still offers its exports.
 * The spec reads the findings from here and the gate from `validateBody` beside it.
 */
function installDfmInstrumentation() {
  window.__partsDfm = Object.freeze({
    processId: (bodyId) => {
      const body = history.current.bodies.find((item) => item.id === bodyId) ?? null;
      return body ? bodyProcessId(body) : null;
    },
    findings: () =>
      projectManufacturabilityIssues(history.current).map((issue) => ({
        bodyId: issue.bodyId,
        code: issue.code,
        severity: issue.severity,
        message: issue.message
      })),
    validationIssues: () => validatePartProject(history.current).map((issue) => issue.code)
  });
}

/**
 * Backend-probe instrumentation for the browser suite.
 *
 * The claim worth observing from a real page is that the export menu **agrees with the
 * probe in both directions**: STEP is offered when the bridge answered and refused with
 * the bridge's own sentence when it did not. A spec that only ever ran on a machine
 * without build123d would assert one branch and pass on a tree where the other is
 * unreachable, which is audit A3 - so the spec reads the state from here and asserts the
 * row against it, and is correct on either kind of machine.
 */
function installCadBackendInstrumentation() {
  window.__partsCadBackend = Object.freeze({
    snapshot: () => ({ ...cadBackendProbe.snapshot() }),
    available: () => cadBackendProbe.available(),
    probe: async () => ({ ...(await cadBackendProbe.probe()) }),
    reset: () => cadBackendProbe.reset(),
    exportAvailability: (formatId) => {
      const body = selectedProjectBody();
      const entry = bodyExportAvailability(body, formatId, exportMenuContext(body));
      return { available: entry.available, reason: entry.reason ?? null, note: entry.note ?? null };
    }
  });
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

function isAdvancedCadRecipeBody(body) {
  return bodySourceKind(body) === ADVANCED_CAD_RECIPE_KIND;
}

function sourceLabel(body) {
  const kind = bodySourceKind(body);
  if (kind === REVOLVE_KIND) return "lathe";
  if (kind === SPUR_GEAR_KIND) return "gear";
  if (kind === BOOLEAN_OPERATION_KIND) return body.boolean?.operation ?? "boolean";
  if (kind === ADVANCED_CAD_RECIPE_KIND) return "advanced CAD";
  return `${formatNumber(body?.extrudeDepthMm, 1)} mm`;
}

function compileResultCount(project) {
  return project.bodies.filter((body) => compileResults.has(body.id)).length;
}

/**
 * What still needs compiling, given the per-body cache and the request in flight.
 *
 * Change detection lives in `compileCache.js` and is deliberately separate from the
 * autosave fingerprint: a rename must save without recompiling, and a material
 * change must do neither.
 */
function currentCompilePlan(project = history.current) {
  return planBodyCompile(project.bodies, compileCache, activeCompileRequest?.signatures ?? new Map());
}

function syncCompileViews(project = history.current) {
  compileResults = compileCacheResults(compileCache, project.bodies);
  compileWarnings = compileCacheWarnings(compileCache, project.bodies);
  const bodyErrors = compileCacheErrors(compileCache, project.bodies);
  compileErrors = compileWorkerError ? [compileWorkerError, ...bodyErrors] : bodyErrors;
}

function compileFailure(code, message, bodyId = null) {
  return { bodyId, code, message, issues: [] };
}

function workerEventMessage(event, fallback) {
  const message = event?.message || event?.error?.message || fallback;
  const location = [event?.filename, event?.lineno, event?.colno].filter(Boolean).join(":");
  return location ? `${message} (${location})` : message;
}

function clearCompileTimeout() {
  clearTimeout(compileTimeoutTimer);
  compileTimeoutTimer = null;
}

function startCompileTimeout(requestId) {
  clearCompileTimeout();
  compileTimeoutTimer = setTimeout(() => {
    if (requestId !== activeCompileRequest?.requestId) return;
    handleCadWorkerFailure(
      compileFailure("worker-timeout", "Generated solid build timed out. The CAD worker was restarted.")
    );
  }, CAD_COMPILE_TIMEOUT_MS);
}

function replaceCadWorker() {
  cadWorker?.terminate?.();
  cadWorker = null;
}

function ensureCadWorker() {
  cadWorker ??= createCadWorker();
  return cadWorker;
}

function handleCadWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.type === "compileBodiesResult") handleCompileResult(message);
  if (message.type === "exportBodyResult") handleExportResult(message);
  if (message.type === "exportBodyError") handleExportError(message);
}

function handleCadWorkerFailure(error) {
  clearTimeout(compileTimer);
  compileTimer = null;
  clearCompileTimeout();
  activeCompileRequest = null;
  compiling = false;
  pendingExports.clear();
  // The worker is being replaced, so nothing cached can be trusted to match what the
  // next worker would produce.
  compileCache.clear();
  compileWorkerError = error;
  syncCompileViews(history.current);
  updateGeneratedPreview(history.current);
  renderCompileStatus(history.current);
  showStatus("Generated solid build failed. Edit the body or try again.", 5200);
  replaceCadWorker();
}

function createCadWorker() {
  // Keep the Worker URL inline so Vite bundles the module worker and its imports for GitHub Pages.
  const worker = new Worker(new URL("./parts/cadWorker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event) => {
    if (worker !== cadWorker) return;
    handleCadWorkerMessage(event);
  });
  worker.addEventListener("error", (event) => {
    if (worker !== cadWorker) return;
    handleCadWorkerFailure(
      compileFailure("worker-error", workerEventMessage(event, "Generated solid build failed in the CAD worker."))
    );
  });
  worker.addEventListener("messageerror", (event) => {
    if (worker !== cadWorker) return;
    handleCadWorkerFailure(
      compileFailure(
        "worker-message-error",
        workerEventMessage(event, "Generated solid build response could not be read.")
      )
    );
  });
  return worker;
}

function renderCompileStatus(project = history.current) {
  const resultCount = compileResultCount(project);
  const total = project.bodies.length;
  const hasHandoffResult = resultCount > 0;
  const selected = selectedProjectBody();

  renderExportMenu(selected);
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
    item.className = "validation-note";
    item.textContent = "Add a body to build a solid preview.";
    compileList.append(item);
    return;
  }

  if (!compileErrors.length && resultCount) {
    const item = document.createElement("li");
    item.className = "validation-ok";
    item.textContent = `${resultCount} generated solid${resultCount === 1 ? "" : "s"} ready`;
    compileList.append(item);
    appendCompileWarnings();
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

  appendCompileWarnings();
}

/**
 * Whether the selected body's built surface is closed.
 *
 * Read from the compile result's warnings rather than from `geometryProperties`,
 * because the warning is produced from the solid the exporters will serialize
 * while the exact 2D mass path never looks at that solid at all. `null` means
 * unknown - nothing has built yet - which is not the same as open.
 */
function bodyWatertightVerdict(body) {
  const result = body ? compileResults.get(body.id) : null;
  if (!result) return null;
  return !(result.warnings ?? []).some((warning) => warning.code === NON_WATERTIGHT_CODE);
}

/**
 * The optional local build123d bridge, asked at most once and never from a render.
 *
 * `renderExportMenu` runs on every render, so it reads `snapshot()` - synchronous, cached,
 * and `unknown` until something has actually asked. `probe()` is fired when the export
 * menu is opened and when a STEP export is attempted, which is the only two moments the
 * answer changes what the user sees.
 */
const cadBackendProbe = createCadBackendProbe();

function refreshCadBackendProbe() {
  const before = cadBackendProbe.snapshot().state;
  void cadBackendProbe.probe().then((snapshot) => {
    // Re-render only when the answer actually moved, so a probe that confirms what the
    // menu already showed does not churn the DOM under an open menu.
    if (snapshot.state !== before) renderExportMenu();
  });
}

function exportMenuContext(body) {
  const backend = cadBackendProbe.snapshot();
  return {
    built: Boolean(body && compileResults.has(body.id)),
    valid: Boolean(body) && validateBody(body).length === 0,
    watertight: bodyWatertightVerdict(body),
    compiling,
    // Three states, not two: `null` is "not yet asked" and must never render as "absent".
    // `cadBackend.js` carries the bridge's own refusal code through, so the menu can say
    // *which* of its outcomes it saw instead of flattening them into "unavailable".
    backendAvailable: cadBackendProbe.available(),
    backendReason: backend.state === "unavailable" ? describeCadBackend(backend) : null
  };
}

function setExportMenuOpen(open) {
  const expanded = open && !exportMenuToggle.disabled;
  exportMenuToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  exportMenuPanel.hidden = !expanded;
}

function isExportMenuOpen() {
  return exportMenuToggle.getAttribute("aria-expanded") === "true";
}

/**
 * The export menu, rebuilt from the format table on every render.
 *
 * Every format is always listed. An unavailable one is disabled and carries the
 * sentence `exportFormats.js` produced, which is what `AGENTS.md:112` asks for -
 * "unavailable with a reason" rather than a control that is permanently dead and
 * silent about why.
 */
function renderExportMenu(body = selectedProjectBody()) {
  const availabilities = bodyExportAvailabilities(body, exportMenuContext(body));
  const availableCount = availabilities.filter((entry) => entry.available).length;

  exportMenuToggle.disabled = availableCount === 0 || pendingExports.size > 0;
  exportMenuToggle.textContent = pendingExports.size
    ? "Exporting..."
    : availableCount
      ? `Export (${availableCount})`
      : "Export";
  if (exportMenuToggle.disabled) setExportMenuOpen(false);

  exportMenuPanel.replaceChildren();
  for (const entry of availabilities) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "parts-export__item";
    item.dataset.exportFormat = entry.formatId;
    item.setAttribute("role", "menuitem");
    item.disabled = !entry.available;

    const label = document.createElement("span");
    label.className = "parts-export__label";
    label.textContent = entry.format.label;
    const reason = document.createElement("span");
    reason.className = "parts-export__reason";
    // ⚠ `note` is not decoration. An available format may still carry something the user
    // needs - "the local build123d backend has not answered yet" is the difference between
    // a question nobody has asked and a negative answer, and dropping it here would put
    // the A2 three-state distinction into a field the page never renders.
    reason.textContent = entry.available ? entry.note ?? entry.format.hint : entry.reason;
    item.append(label, reason);
    exportMenuPanel.append(item);
  }
}

/**
 * Compile warnings are reports, not gates. A disconnected body still compiles,
 * exports and hands off; the Build panel says so and nothing blocks.
 */
function appendCompileWarnings() {
  for (const warning of compileWarnings.slice(0, 6)) {
    const item = document.createElement("li");
    item.className = "validation-note";
    const code = document.createElement("span");
    code.className = "validation-code";
    code.textContent = warning.bodyId ?? warning.code;
    const message = document.createElement("span");
    message.textContent = warning.message;
    item.append(code, message);
    compileList.append(item);
  }
}

function updateGeneratedPreview(project = history.current, options = {}) {
  previewScene.updateBodies(project.bodies, compileResults, project.selectedBodyId, options);
}

function postCadWorkerMessage(message, transfers = undefined) {
  const worker = ensureCadWorker();
  if (transfers) worker.postMessage(message, transfers);
  else worker.postMessage(message);
  cadWorkerMessageCount += 1;
}

function requestCadCompile(project = history.current) {
  pruneCompileCache(compileCache, project.bodies);

  if (!project.bodies.length) {
    clearTimeout(compileTimer);
    compileTimer = null;
    clearCompileTimeout();
    activeCompileRequest = null;
    compiling = false;
    compileWorkerError = null;
    syncCompileViews(project);
    updateGeneratedPreview(project);
    renderCompileStatus(project);
    return;
  }

  const { staleBodyIds } = currentCompilePlan(project);
  syncCompileViews(project);

  // Nothing stale and nothing queued: every body is already cached or in flight, so
  // this render costs no compile at all.
  if (!staleBodyIds.length) {
    if (!activeCompileRequest && !compileTimer) compiling = false;
    updateGeneratedPreview(project, { fitCamera: false });
    renderCompileStatus(project);
    return;
  }

  clearTimeout(compileTimer);
  compiling = true;
  renderCompileStatus(project);
  compileTimer = setTimeout(postCompileRequest, 180);
}

function postCompileRequest() {
  compileTimer = null;
  const project = history.current;
  // A queued request supersedes whatever was in flight. Dropping the in-flight
  // signatures first is what stops a body being masked as "already building" by a
  // request whose result will now be discarded.
  activeCompileRequest = null;
  const { signatures, staleBodyIds } = currentCompilePlan(project);

  if (!staleBodyIds.length) {
    compiling = false;
    syncCompileViews(project);
    updateGeneratedPreview(project, { fitCamera: false });
    renderCompileStatus(project);
    return;
  }

  const requestId = nextWorkerRequestId();
  activeCompileRequest = {
    requestId,
    bodyIds: staleBodyIds,
    signatures: new Map(staleBodyIds.map((bodyId) => [bodyId, signatures.get(bodyId)]))
  };
  compileRequestLog.push({ requestId, bodyIds: [...staleBodyIds] });

  try {
    // The whole body list travels with every request even when one body is being
    // rebuilt, because boolean operands must be resolvable (`AGENTS.md:38`).
    postCadWorkerMessage({
      type: "compileBodies",
      requestId,
      bodies: project.bodies,
      compileBodyIds: staleBodyIds
    });
    startCompileTimeout(requestId);
  } catch (error) {
    handleCadWorkerFailure(
      compileFailure("worker-post-message-error", `Unable to start generated solid build: ${error.message}`)
    );
  }
}

function handleCompileResult(message) {
  if (!activeCompileRequest || message.requestId !== activeCompileRequest.requestId) return;

  clearCompileTimeout();
  const request = activeCompileRequest;
  activeCompileRequest = null;
  compiling = Boolean(compileTimer);
  compileWorkerError = null;

  const { unassignedErrors } = applyCompileOutcome(compileCache, {
    signatures: request.signatures,
    bodyIds: request.bodyIds,
    results: message.results,
    errors: message.errors
  });
  compileWorkerError = unassignedErrors[0] ?? null;
  // A body deleted while its compile was in flight would otherwise leave an entry
  // behind for a body that no longer exists.
  pruneCompileCache(compileCache, history.current.bodies);

  syncCompileViews(history.current);
  updateGeneratedPreview();
  renderCompileStatus();
  renderMassProperties(selectedProjectBody());
  // The bill of materials weighs every body, not just the selected one, so it is the one
  // panel a compile can change without the selection changing. Re-rendered here rather
  // than in `render()` alone, which runs on edits and not on results arriving - without
  // this every BOM row read "this body has not been built yet" forever.
  renderDocuments(history.current);
}

function exportFormatLabel(formatId) {
  return EXPORT_FORMATS.find((format) => format.id === formatId)?.label ?? "Export";
}

function handleExportResult(message) {
  const pending = pendingExports.get(message.requestId);
  if (!pending) return;
  pendingExports.delete(message.requestId);
  renderCompileStatus();
  downloadBlob(message.data, message.fileName, message.mimeType);

  const label = exportFormatLabel(message.formatId);
  // An export warning is a statement about the file that was produced, not a
  // failure, so it replaces the confirmation rather than suppressing the download.
  const warning = message.warnings?.[0]?.message;
  if (warning) showStatus(`${label} exported. ${warning}`, 8200);
  else showStatus(`${label} export started`);
  pending.resolve?.(message);
}

function handleExportError(message) {
  const pending = pendingExports.get(message.requestId);
  if (!pending) return;
  pendingExports.delete(message.requestId);
  renderCompileStatus();
  const text = message.error?.message ?? `${exportFormatLabel(pending.formatId)} export failed`;
  showStatus(text, 6200);
  pending.reject?.(new Error(text));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCadReady(timeoutMs = 6000) {
  requestCadCompile(history.current);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { staleBodyIds } = currentCompilePlan(history.current);
    if (!compiling && !compileTimer && !activeCompileRequest && !staleBodyIds.length) {
      renderCompileStatus(history.current);
      return;
    }
    if (!compiling && compileErrors.length) {
      throw new Error(compileErrors[0].issues?.[0]?.message ?? compileErrors[0].message ?? "Generated solid build failed.");
    }
    await sleep(50);
  }
  throw new Error("Generated solids are still building. Try again after the build status is ready.");
}

function templateLabel(templateId) {
  return listPartTemplates().find((template) => template.id === templateId)?.label ?? templateId;
}

function renderTemplateOptions() {
  const groups = new Map();
  for (const template of listPartTemplates()) {
    const category = template.category ?? "Templates";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(template);
  }

  templateSelect.replaceChildren(
    ...[...groups.entries()].map(([category, templates]) => {
      const group = document.createElement("optgroup");
      group.label = category;
      group.append(
        ...templates.map((template) => {
          const option = document.createElement("option");
          option.value = template.id;
          option.textContent = template.label;
          return option;
        })
      );
      return group;
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
  hardwareEntrySelect.replaceChildren(
    ...listHardwareEntries().map((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${entry.category}: ${entry.label}`;
      // The summary is the entry's own sentence rather than one written here, so the
      // tooltip cannot describe a pattern the catalogue does not resolve.
      option.title = entry.summary;
      return option;
    })
  );
  renderHardwareEntryNote();
}

/** The selected entry's summary, so the user knows what a click will cut. */
function renderHardwareEntryNote() {
  const entry = getHardwareEntry(hardwareEntrySelect.value);
  hardwareEntryNote.textContent = entry ? entry.summary : "";
}

function sortLibraryItems(items) {
  return [...items].sort((first, second) => {
    const firstTime = Date.parse(first.updatedAt ?? "");
    const secondTime = Date.parse(second.updatedAt ?? "");
    if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
      return secondTime - firstTime;
    }
    return String(first.name).localeCompare(String(second.name));
  });
}

function libraryItemById(itemId) {
  const item = partLibraryItems.find((entry) => entry.id === itemId);
  if (!item) throw new Error(`Unknown library item: ${itemId}`);
  return item;
}

function handleLibraryError(error, fallback = "Part library action failed.") {
  console.error(fallback, error);
  showStatus(error?.message ?? fallback, 5200);
}

function signedInSession() {
  return authState.status === "authenticated" ? authState.session : null;
}

function cloudStatusText() {
  if (!isSupabaseConfigured) return "Configure Supabase to enable cloud sync";
  if (libraryCloudBusy) return "Cloud sync working";
  if (authState.status === "checking") return "Checking cloud sign-in";
  if (authState.status === "authenticated") {
    return authState.user?.email ? `Signed in as ${authState.user.email}` : "Signed in";
  }
  if (authState.status === "error" && authState.error) return authState.error;
  return "Local library only";
}

async function persistLocalLibraryItems(items) {
  for (const item of items) {
    await workspaceStore.writePartLibraryItem(item);
  }
}

async function syncLibraryToSupabase(options = {}) {
  const session = signedInSession();
  if (!session) throw new Error("Sign in before syncing the part library.");
  libraryCloudBusy = true;
  renderLibraryPanel();
  try {
    const mergedItems = await syncPartLibraryWithSupabase(session, partLibraryItems);
    await persistLocalLibraryItems(mergedItems);
    partLibraryItems = sortLibraryItems(mergedItems);
    if (!options.silent) showStatus(`Synced ${partLibraryItems.length} library part${partLibraryItems.length === 1 ? "" : "s"}`);
    return partLibraryItems;
  } finally {
    libraryCloudBusy = false;
    renderLibraryPanel();
  }
}

async function loadPartLibrary() {
  try {
    const storedItems = await workspaceStore.listPartLibraryItems();
    const normalizedItems = [];
    for (const item of storedItems) {
      try {
        normalizedItems.push(normalizePartLibraryItem(item));
      } catch (error) {
        console.warn("Ignoring invalid part library item", error);
      }
    }
    partLibraryItems = sortLibraryItems(normalizedItems);
    renderLibraryPanel();
    if (signedInSession()) {
      await syncLibraryToSupabase({ silent: true });
    }
  } catch (error) {
    handleLibraryError(error, "Part library could not be loaded.");
  }
}

async function saveSelectedPartToLibrary() {
  const body = selectedProjectBody();
  if (!body) throw new Error("Select a body before saving to the library.");

  const item = createPartLibraryItem(history.current, body.id, {
    existingIds: new Set(partLibraryItems.map((entry) => entry.id))
  });
  await workspaceStore.writePartLibraryItem(item);
  partLibraryItems = sortLibraryItems([item, ...partLibraryItems]);
  if (signedInSession()) {
    try {
      await upsertSupabasePartLibraryItem(signedInSession(), item);
    } catch (error) {
      handleLibraryError(error, "Cloud save failed.");
    }
  }
  renderLibraryPanel();
  showStatus(`${item.name} saved to library`);
  return item;
}

function addLibraryItemToCurrentProject(itemId) {
  const item = libraryItemById(itemId);
  const result = addPartLibraryItemToProject(history.current, item);
  commit(result.project, `${item.name} added from library`);
  return result;
}

async function deleteLibraryItem(itemId) {
  const item = libraryItemById(itemId);
  await workspaceStore.deletePartLibraryItem(item.id);
  partLibraryItems = partLibraryItems.filter((entry) => entry.id !== item.id);
  if (signedInSession()) {
    try {
      await deleteSupabasePartLibraryItem(signedInSession(), item.id);
    } catch (error) {
      handleLibraryError(error, "Cloud delete failed.");
    }
  }
  renderLibraryPanel();
  showStatus(`${item.name} removed from library`);
  return item;
}

function exportLibraryJson() {
  if (!partLibraryItems.length) throw new Error("Save a part before exporting the library.");
  downloadBlob(serializePartLibraryBundle(partLibraryItems), "robotic-part-library.json", "application/json");
  showStatus("Part library JSON export started");
}

async function importPartLibraryJson(source) {
  const bundle = parsePartLibraryBundleJson(source);
  const importedItems = bundle.items.map((item) => normalizePartLibraryItem(item));
  await persistLocalLibraryItems(importedItems);
  partLibraryItems = sortLibraryItems(mergePartLibraryItems(partLibraryItems, importedItems));
  if (signedInSession()) {
    for (const item of importedItems) {
      try {
        await upsertSupabasePartLibraryItem(signedInSession(), item);
      } catch (error) {
        handleLibraryError(error, "Cloud import sync failed.");
      }
    }
  }
  renderLibraryPanel();
  showStatus(
    `Imported ${importedItems.length} librar${importedItems.length === 1 ? "y part" : "y parts"}`
  );
  return importedItems;
}

function libraryMetaText(item) {
  const summary = partLibraryItemSummary(item);
  const bodyWord = summary.bodyCount === 1 ? "body" : "bodies";
  return `${summary.bodyCount} ${bodyWord} / ${summary.sourceKind}`;
}

function renderLibraryPanel() {
  libraryCount.textContent = String(partLibraryItems.length);
  saveLibraryPartButton.disabled = !selectedProjectBody();
  exportLibraryButton.disabled = partLibraryItems.length === 0;
  libraryAuthStatus.textContent = cloudStatusText();
  librarySignInButton.disabled = !isSupabaseConfigured || authState.status === "authenticated" || authState.status === "checking" || libraryCloudBusy;
  librarySyncButton.disabled = !signedInSession() || libraryCloudBusy;
  librarySignOutButton.disabled = !signedInSession() || libraryCloudBusy;
  libraryList.replaceChildren();

  if (!partLibraryItems.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "Save selected parts for reuse";
    libraryList.append(empty);
    return;
  }

  for (const item of partLibraryItems) {
    const row = document.createElement("div");
    row.className = "library-row";

    const label = document.createElement("div");
    label.className = "library-row__label";

    const name = document.createElement("span");
    name.className = "library-row__name";
    name.textContent = item.name;

    const meta = document.createElement("span");
    meta.className = "library-row__meta";
    meta.textContent = libraryMetaText(item);

    const actions = document.createElement("div");
    actions.className = "library-row__actions";

    const addButton = document.createElement("button");
    addButton.className = "library-row__button";
    addButton.type = "button";
    addButton.textContent = "Add";
    addButton.addEventListener("click", () => {
      try {
        addLibraryItemToCurrentProject(item.id);
      } catch (error) {
        handleLibraryError(error);
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "library-row__button library-row__button--danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      void deleteLibraryItem(item.id).catch((error) => handleLibraryError(error));
    });

    label.append(name, meta);
    actions.append(addButton, deleteButton);
    row.append(label, actions);
    libraryList.append(row);
  }
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

/**
 * For an `<input>`'s `value`, where the control has to hold something parseable and a
 * dash would be a value the user then has to clear. Never use it for a rendered output
 * cell: the `"0"` below is a fabricated number, which is what `formatOutput` exists to
 * refuse.
 */
function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "0";
}

/**
 * A number, or a thrown error naming the field.
 *
 * The fourth answer, and the reason this is not `contracts.js`'s `isFiniteNumber` or
 * `asFiniteNumber`: those two serve code that has a sensible response to a bad number,
 * and the assistant action catalog has none. An action arrives as parsed JSON from a
 * model, so a non-finite depth is a malformed request, not a value to coerce - the
 * caller needs the field name in the rejection, which is what `label` carries.
 */
function finiteNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a finite number.`);
  return numeric;
}

/** Positive, or a thrown error naming the field. See `finiteNumber` for why not `contracts.js`. */
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

function selectedAdvancedCadBodyForAssistant(bodyId) {
  const body = bodyId ? selectBodyForAssistant(bodyId) : selectedProjectBody();
  if (!body) throw new Error("No body is selected.");
  if (!isAdvancedCadRecipeBody(body)) {
    throw new Error(`${body.name} is not an advanced CAD recipe body.`);
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
  const resolved = resolveHole(profile.hole);
  return {
    id: profile.id,
    type: profile.type,
    index,
    hole: profile.hole ?? null,
    // Reported so the assistant can see a refusal instead of reading a radius that
    // silently did not change.
    holeStatus: resolved ? (resolved.ok ? "resolved" : resolved.code) : null,
    holeReason: resolved?.ok === false ? resolved.reason : null,
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
    materialId: body.materialId,
    processId: bodyProcessId(body),
    // Null rather than absent when the body has not built yet: the assistant must not
    // be able to read a stale or invented mass.
    massG: bodyMassGrams(body),
    volumeMm3: scaledBodyGeometryProperties(body)?.volumeMm3 ?? null,
    advancedCadRecipe: isAdvancedCadRecipeBody(body)
      ? {
          version: body.advancedCadRecipe?.version,
          units: body.advancedCadRecipe?.units,
          operationCount: body.advancedCadRecipe?.operations?.length ?? 0,
          operations: (body.advancedCadRecipe?.operations ?? []).map((operation) => ({
            id: operation.id,
            type: operation.type,
            mode: operation.mode,
            label: operation.label
          }))
        }
      : null,
    outerProfile: profileSummary(body.sketch?.outerProfile ?? null),
    cutProfiles: (body.sketch?.cutProfiles ?? []).map((profile, index) => profileSummary(profile, index))
  };
}

function partsAssistantContext() {
  const project = history.current;
  const selected = selectedProjectBody();
  const resultCount = compileResultCount(project);
  const issues = validatePartProject(project);
  // Computed once: the truncated list below and the count beside it must be two
  // views of the same array, not two independent calls that a re-render could make
  // disagree.
  const manufacturabilityIssues = projectManufacturabilityIssues(project);
  return {
    page: "Robotic Component Builder",
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
      manufacturabilityIssues: manufacturabilityIssues.length,
      compileErrors: compileErrors.length
    },
    controls: {
      templateId: templateSelect.value,
      templates: listPartTemplates(),
      revolvePresetId: revolvePresetSelect.value,
      revolvePresets: listRevolvePresets(),
      booleanOperation: booleanOperationSelect.value,
      booleanOperations: BOOLEAN_OPERATIONS,
      customSketch: {
        supportedOuterProfileTypes: OUTER_PROFILE_TYPES,
        supportedCutProfileTypes: CUT_PROFILE_TYPES,
        sketchPlane: "X/Z",
        extrusionAxis: "Y"
      },
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        supportedOperations: ["box", "cylinder", "hole", "slot", "fillet", "chamfer", "shell", "boolean", "pattern", "transform", "label"],
        browserPreviewOperations: ["box", "cylinder", "hole", "slot"],
        stepExport: "local build123d backend required"
      }
    },
    history: {
      canUndo: history.undoStack.length > 0,
      canRedo: history.redoStack.length > 0
    },
    library: {
      count: partLibraryItems.length,
      items: partLibraryItems.map(partLibraryItemSummary),
      cloud: {
        configured: isSupabaseConfigured,
        status: authState.status,
        signedIn: Boolean(signedInSession()),
        userEmail: authState.user?.email ?? null
      }
    },
    selection: selected ? assistantBodySummary(selected) : null,
    bodies: project.bodies.map(assistantBodySummary),
    validation: issues.slice(0, 12),
    // Reported separately from `validation` and never merged into it, so the
    // assistant cannot mistake "this wall is too thin to print" for "this body
    // will not compile". The first is advice; only the second stops anything.
    //
    // Capped at twelve like the list beside it, and the true total is in
    // `counts.manufacturabilityIssues` for the same reason `validationIssues` is
    // there: the panel can show a count badge above a truncated list, this payload
    // cannot, so an assistant reading twelve findings would otherwise report twelve
    // as the total. A truncated list that reads as complete is the same class of
    // dishonesty as a fabricated zero.
    manufacturability: manufacturabilityIssues
      .slice(0, 12)
      .map((issue) => ({
        bodyId: issue.bodyId,
        code: issue.code,
        severity: issue.severity,
        message: issue.message
      })),
    compile: {
      compiling,
      status: compileCount.textContent,
      buildStatus: buildCount.textContent,
      selectedReady: Boolean(selectedCompileResult()),
      exportReady: Boolean(selectedCompileResult()) && !compiling,
      handoffReady: resultCount > 0 && !compiling,
      errors: compileErrors.slice(0, 8),
      warnings: compileWarnings.slice(0, 8).map((warning) => ({
        bodyId: warning.bodyId,
        code: warning.code,
        message: warning.message
      })),
      // Stated per format so the assistant reports what a user can actually do
      // instead of inferring it from a body kind.
      exportFormats: bodyExportAvailabilities(selected, exportMenuContext(selected)).map((entry) => ({
        formatId: entry.formatId,
        label: entry.format.label,
        available: entry.available,
        reason: entry.reason
      }))
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
    if (args.materialId !== undefined) {
      // Refuse an unknown material rather than silently normalizing it to PLA: the
      // caller would otherwise be told a mass for a material it did not ask for.
      if (!getMaterial(args.materialId)) throw new Error(`Unknown materialId: ${args.materialId}.`);
      draft.materialId = args.materialId;
    }
    if (args.processId !== undefined) {
      // Refused rather than normalized for the same reason as the material: a
      // caller told "process set" while the page silently kept FDM would then be
      // handed FDM's thresholds and believe they were a laser's.
      if (!getProcessProfile(args.processId)) throw new Error(`Unknown processId: ${args.processId}.`);
      draft.processId = args.processId;
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

/**
 * Attach a fastener standard to a profile on the assistant's behalf.
 *
 * Refuses loudly rather than writing an unresolvable hole, because the assistant's
 * caller sees a thrown message and can correct itself, whereas a persisted refusal
 * only surfaces later as a Build-panel warning. The refusal reason from
 * `holes.js` is passed through verbatim: it already names the combination.
 */
function applyHoleArgument(profile, hole) {
  if (hole === null) {
    delete profile.hole;
    return;
  }
  if (profile.type !== "circle") {
    throw new Error("A fastener standard can only be attached to a circular cut profile.");
  }
  const resolved = resolveHole(hole);
  if (!resolved) throw new Error("A hole needs a fastener size, such as M3.");
  if (!resolved.ok) throw new Error(resolved.reason);
  profile.hole = resolved.spec;
}

function applyProfileArguments(profile, args = {}) {
  for (const prop of ["x", "z"]) {
    if (args[prop] !== undefined) profile[prop] = finiteNumber(args[prop], prop);
  }
  for (const prop of ["radius", "length", "width", "height"]) {
    if (args[prop] !== undefined) profile[prop] = positiveNumber(args[prop], prop);
  }
  if (args.cornerRadius !== undefined) profile.cornerRadius = Math.max(0, finiteNumber(args.cornerRadius, "cornerRadius"));
  if (args.clearHole === true) delete profile.hole;
  if (args.hole !== undefined) applyHoleArgument(profile, args.hole);
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

function issueData(issues = []) {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path,
    severity: issue.severity ?? "error"
  }));
}

function compileStatusForAssistant(bodyId) {
  const errors = compileErrors
    .filter((error) => !error.bodyId || error.bodyId === bodyId)
    .slice(0, 4)
    .map((error) => ({
      bodyId: error.bodyId,
      code: error.code,
      message: error.issues?.[0]?.message ?? error.message
    }));
  const ready = compileResults.has(bodyId);
  return {
    ready,
    compiling,
    status: ready ? "ready" : errors.length ? "error" : compiling ? "building" : "queued",
    errors
  };
}

function customSketchToolOutput(action, result, message, options = {}) {
  const bodyId = result.body?.id ?? null;
  const validationIssues = issueData(result.validationIssues);
  const status = options.status ?? (result.accepted ? "accepted" : "validation_failed");
  const ok = options.ok ?? result.accepted;
  return {
    ok,
    action,
    status,
    message,
    error: ok ? undefined : message,
    data: {
      accepted: result.accepted,
      bodyId,
      designIntent: result.designIntent,
      validationIssues,
      compile: options.compile ?? (bodyId ? compileStatusForAssistant(bodyId) : null)
    }
  };
}

function advancedCadToolOutput(action, result, message, options = {}) {
  const bodyId = result.body?.id ?? null;
  const validationIssues = issueData(result.validationIssues);
  const status = options.status ?? (result.accepted ? "accepted" : "validation_failed");
  const ok = options.ok ?? result.accepted;
  return {
    ok,
    action,
    status,
    message,
    error: ok ? undefined : message,
    data: {
      accepted: result.accepted,
      bodyId,
      designIntent: result.designIntent,
      validationIssues,
      compile: options.compile ?? (bodyId ? compileStatusForAssistant(bodyId) : null),
      stepExport: "Use parts_export_selected_step after selecting this body when a local build123d backend is available."
    }
  };
}

async function createCustomSketchBodyForAssistant(args = {}) {
  const result = createCustomSketchBodyFromArgs(args, {
    existingBodyIds: new Set(history.current.bodies.map((body) => body.id))
  });
  if (!result.accepted) {
    return customSketchToolOutput(
      "parts_create_custom_sketch_body",
      result,
      `Custom sketch rejected: ${result.validationIssues[0]?.message ?? "validation failed."}`
    );
  }

  commit(addBody(history.current, result.body), `${result.body.name} custom sketch added`);
  try {
    await waitForCadReady();
  } catch {
    return customSketchToolOutput(
      "parts_create_custom_sketch_body",
      result,
      `${result.body.name} custom sketch body was added, but the build needs refinement.`,
      { ok: false, status: "compile_failed" }
    );
  }
  return customSketchToolOutput(
    "parts_create_custom_sketch_body",
    result,
    `${result.body.name} custom sketch body added and built.`
  );
}

async function replaceSketchBodyForAssistant(args = {}) {
  const current = selectedSketchBodyForAssistant(args.bodyId);
  const result = replaceSketchBodyFromArgs(current, args);
  if (!result.accepted) {
    return customSketchToolOutput(
      "parts_replace_sketch_body",
      result,
      `Replacement sketch rejected: ${result.validationIssues[0]?.message ?? "validation failed."}`
    );
  }

  commit(updateBody(history.current, current.id, () => result.body), `${result.body.name} sketch replaced`);
  try {
    await waitForCadReady();
  } catch {
    return customSketchToolOutput(
      "parts_replace_sketch_body",
      result,
      `${result.body.name} sketch was replaced, but the build needs refinement.`,
      { ok: false, status: "compile_failed" }
    );
  }
  return customSketchToolOutput(
    "parts_replace_sketch_body",
    result,
    `${result.body.name} sketch replaced and built.`
  );
}

async function createAdvancedCadBodyForAssistant(args = {}) {
  const result = createAdvancedCadRecipeBodyFromArgs(args, {
    existingBodyIds: new Set(history.current.bodies.map((body) => body.id))
  });
  if (!result.accepted) {
    return advancedCadToolOutput(
      "parts_create_advanced_cad_body",
      result,
      `Advanced CAD recipe rejected: ${result.validationIssues[0]?.message ?? "validation failed."}`
    );
  }

  commit(addBody(history.current, result.body), `${result.body.name} advanced CAD body added`);
  try {
    await waitForCadReady();
  } catch {
    return advancedCadToolOutput(
      "parts_create_advanced_cad_body",
      result,
      `${result.body.name} advanced CAD body was added, but the preview build needs refinement or the local build123d backend.`,
      { ok: false, status: "compile_failed" }
    );
  }
  return advancedCadToolOutput(
    "parts_create_advanced_cad_body",
    result,
    `${result.body.name} advanced CAD body added and built.`
  );
}

async function replaceAdvancedCadBodyForAssistant(args = {}) {
  const current = selectedAdvancedCadBodyForAssistant(args.bodyId);
  const result = replaceAdvancedCadRecipeBodyFromArgs(current, args);
  if (!result.accepted) {
    return advancedCadToolOutput(
      "parts_replace_advanced_cad_body",
      result,
      `Advanced CAD replacement rejected: ${result.validationIssues[0]?.message ?? "validation failed."}`
    );
  }

  commit(updateBody(history.current, current.id, () => result.body), `${result.body.name} advanced CAD recipe replaced`);
  try {
    await waitForCadReady();
  } catch {
    return advancedCadToolOutput(
      "parts_replace_advanced_cad_body",
      result,
      `${result.body.name} advanced CAD recipe was replaced, but the preview build needs refinement or the local build123d backend.`,
      { ok: false, status: "compile_failed" }
    );
  }
  return advancedCadToolOutput(
    "parts_replace_advanced_cad_body",
    result,
    `${result.body.name} advanced CAD recipe replaced and built.`
  );
}

function addCutProfileForAssistant(args = {}) {
  selectedSketchBodyForAssistant(args.bodyId);
  const cut = createCutProfile(args.type, { x: args.x, z: args.z, hole: args.hole });
  if (!cut) throw new Error("Unable to create a cut profile for the selected body.");
  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(cut);
    return draft;
  }, args.type === "slot" ? "Slotted hole added" : "Circular hole added");
  const label = describeHole(cut.hole);
  return label ? `${cut.id} added as a ${label} at diameter ${formatNumber(cut.radius * 2, 2)} mm.` : `${cut.id} added.`;
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

function createInput({ value, type = "number", step = "1", min = null, max = null, dataset = {}, disabled = false }) {
  const input = document.createElement("input");
  input.type = type;
  input.value = String(value ?? "");
  input.disabled = disabled;
  if (step != null) input.step = step;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
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
    currentGrid.append(createOutputField(axis, formatOutput(currentSize[index], 2)));
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
  // The note has to say what the checkbox does *not* control: a cut profile with a
  // locked standards hole keeps its diameter either way, so unchecking the box does
  // not quietly turn an M3 clearance hole into whatever the scale factor makes it.
  note.textContent = isSketchBody(body) && resizeKeepCutSizes
    ? "Hole centers move with the body; every cut keeps its size."
    : isSketchBody(body)
      ? "Cut profiles scale with the body footprint, except holes locked to a fastener standard."
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
  applyHardwarePatternButton.disabled = !sketchEditable;
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
    if (bodySourceKind(body) === REVOLVE_KIND) bodyProperties.append(createRevolveAngleField(body));
    if (bodySourceKind(body) === SPUR_GEAR_KIND) {
      bodyProperties.append(createGearToothSection(body), createGearMeshSection(body));
    }
  }
}

/** A titled block of inspector fields, styled like the resize section beside it. */
function createInspectorSubsection(title, hint) {
  const section = document.createElement("div");
  section.className = "parts-inspector-subsection";
  const heading = document.createElement("div");
  heading.className = "parts-inspector-subsection__title";
  const label = document.createElement("span");
  label.textContent = title;
  heading.append(label);
  if (hint) {
    const small = document.createElement("small");
    small.textContent = hint;
    heading.append(small);
  }
  section.append(heading);
  return section;
}

function createFieldGrid(title, fields) {
  const grid = document.createElement("div");
  grid.className = "parts-field-grid";
  if (title) {
    const label = document.createElement("span");
    label.textContent = title;
    grid.append(label);
  }
  grid.append(...fields);
  return grid;
}

/**
 * The gear tooth form.
 *
 * `pressureAngleDeg` was editable nowhere before this cycle, which was consistent
 * with it having no effect. Now every field here reaches geometry, so each one is
 * exposed - including the three the cycle added, whose defaults reproduce the
 * nominal gear exactly.
 */
function createGearToothSection(body) {
  const gear = body.gear ?? {};
  const geometry = spurGearGeometry(gear);
  // The rack is only *the* ISO 53 rack at a 20 degree profile angle. This page lets
  // the angle run 10 to 35 because the involute is exact at any of them, but the
  // proportions at any other angle are a generalisation of the standard, so the
  // heading says which of the two the reader is looking at rather than claiming ISO
  // 53 for a tooth that is not one. `standards/gears.js` has always been able to
  // answer this; before, nothing asked.
  const section = createInspectorSubsection(
    "Tooth form",
    `${geometry.rackDeviatesFromStandard ? "ISO 53 basic rack proportions, generalised to this profile angle" : "ISO 53 basic rack"}, involute flank. Pitch ${formatNumber(geometry.pitchRadiusMm * 2, 2)} mm, base ${formatNumber(geometry.baseRadiusMm * 2, 2)} mm, root ${formatNumber(geometry.rootRadiusMm * 2, 2)} mm, tip ${formatNumber(geometry.tipRadiusMm * 2, 2)} mm diameter.`
  );

  if (geometry.rackDeviatesFromStandard) {
    const note = document.createElement("p");
    note.className = "parts-resize-note";
    note.dataset.gearRackDeviation = "1";
    note.textContent = `ISO 53 fixes the profile angle at ${formatNumber(ISO_53_PROFILE_ANGLE_DEG, 0)} degrees, so the ${formatNumber(geometry.pressureAngleDeg, 1)} degree tooth below uses the rack's addendum, dedendum and tip radius scaled to this angle. The involute flank is exact; the proportions are this page's generalisation and not a quotation from the standard.`;
    section.append(note);
  }

  section.append(
    createFieldGrid("Teeth and size", [
      createField(
        "Teeth",
        createInput({
          value: String(gear.toothCount ?? 24),
          step: "1",
          min: String(MIN_TOOTH_COUNT),
          max: String(MAX_TOOTH_COUNT),
          dataset: { bodyProp: "gearToothCount" }
        })
      ),
      createField(
        "Module (mm)",
        createInput({
          value: formatNumber(gear.moduleMm, 3),
          step: "0.25",
          min: "0.01",
          dataset: { bodyProp: "gearModuleMm" }
        })
      ),
      createField(
        "Pressure angle (deg)",
        createInput({
          value: formatNumber(gear.pressureAngleDeg, 1),
          step: "0.5",
          min: String(MIN_PRESSURE_ANGLE_DEG),
          max: String(MAX_PRESSURE_ANGLE_DEG),
          dataset: { bodyProp: "gearPressureAngleDeg" }
        })
      ),
      createField(
        "Thickness (Y mm)",
        createInput({
          value: formatNumber(gear.thicknessMm, 2),
          step: "0.5",
          min: "0.1",
          dataset: { bodyProp: "gearThicknessMm" }
        })
      ),
      createField(
        "Bore (mm)",
        createInput({
          value: formatNumber(gear.boreDiameterMm, 2),
          step: "0.5",
          min: "0",
          dataset: { bodyProp: "gearBoreDiameterMm" }
        })
      ),
      createField(
        "Helix angle (deg)",
        createInput({
          value: formatNumber(gear.helixAngleDeg, 1),
          step: "1",
          min: String(-MAX_ABS_HELIX_ANGLE_DEG),
          max: String(MAX_ABS_HELIX_ANGLE_DEG),
          dataset: { bodyProp: "gearHelixAngleDeg" }
        })
      )
    ])
  );

  const { field: rackField } = createSelectField(
    "Basic rack",
    listBasicRackProfiles().map((entry) => ({ value: entry.id, label: entry.label })),
    gear.rackProfileId ?? "A",
    { bodyProp: "gearRackProfileId" }
  );

  const filletInput = createInput({
    // Blank means "follow the rack profile", which is what the placeholder states.
    value: gear.rootFilletFactor == null ? "" : formatNumber(gear.rootFilletFactor, 3),
    step: "0.02",
    min: "0",
    dataset: { bodyProp: "gearRootFilletFactor" }
  });
  filletInput.placeholder = formatNumber(geometry.rack.filletRadiusFactor, 2);

  section.append(
    rackField,
    createFieldGrid("Allowances", [
      createField(
        "Profile shift x",
        createInput({
          value: formatNumber(gear.profileShiftCoefficient, 3),
          step: "0.05",
          min: String(-MAX_ABS_PROFILE_SHIFT),
          max: String(MAX_ABS_PROFILE_SHIFT),
          dataset: { bodyProp: "gearProfileShiftCoefficient" }
        })
      ),
      createField(
        "Backlash (mm)",
        createInput({
          value: formatNumber(gear.backlashMm, 3),
          step: "0.02",
          min: "0",
          dataset: { bodyProp: "gearBacklashMm" }
        })
      ),
      createField("Root fillet / m", filletInput)
    ]),
    createFieldGrid("Measured tooth", [
      createOutputField("Root land (mm)", formatOutput(geometry.rootLandWidthMm, 3)),
      createOutputField("Top land (mm)", formatOutput(geometry.tipLandWidthMm, 3)),
      createOutputField("Fillet (mm)", formatOutput(geometry.rootFilletRadiusMm, 3))
    ])
  );

  if (geometry.helical) {
    section.append(
      createFieldGrid("Normal plane", [
        createOutputField("Normal module", formatOutput(geometry.normalModuleMm, 3)),
        createOutputField("Normal angle (deg)", formatOutput(geometry.normalPressureAngleDeg, 2)),
        createOutputField(
          "Twist (deg)",
          formatOutput(geometry.twistAngleRad == null ? null : (geometry.twistAngleRad * 180) / Math.PI, 2)
        )
      ])
    );
  }

  return section;
}

/**
 * Does this gear mesh with another one in the project?
 *
 * A pair is a derived report and not a persisted entity - `PartProject` has bodies
 * and no relationships - so which partner is selected is session-only presentation
 * state, held in `gearPairPartnerId` beside the other inspector toggles and never
 * written to the project. Picking a partner therefore neither saves nor recompiles.
 */
function createGearMeshSection(body) {
  const partners = history.current.bodies.filter(
    (candidate) => candidate.id !== body.id && bodySourceKind(candidate) === SPUR_GEAR_KIND
  );
  const section = createInspectorSubsection(
    "Mesh check",
    "Contact ratio and centre distance against another gear. A derived report; nothing here is saved."
  );

  if (!partners.length) {
    section.append(emptyMessage("Add a second gear to check a pair"));
    return section;
  }

  const selectedId = partners.some((candidate) => candidate.id === gearPairPartnerId)
    ? gearPairPartnerId
    : partners[0].id;
  const { field } = createSelectField(
    "Meshes with",
    partners.map((candidate) => ({ value: candidate.id, label: candidate.name })),
    selectedId,
    { gearPairPartner: "1" }
  );
  section.append(field);

  const partner = partners.find((candidate) => candidate.id === selectedId);
  const report = spurGearPairReport(body.gear, partner.gear);

  if (!report.ok && report.centreDistanceMm == null) {
    for (const issue of report.issues) section.append(gearMeshNote(issue));
    return section;
  }

  section.append(
    createFieldGrid("Pair", [
      createOutputField("Centre distance (mm)", formatOutput(report.centreDistanceMm, 3)),
      createOutputField("Contact ratio", formatOutput(report.contactRatio, 3)),
      createOutputField("Ratio", `${report.toothCountB}:${report.toothCountA}`)
    ]),
    createFieldGrid("Allowance", [
      createOutputField("Backlash (mm)", formatOutput(report.circumferentialBacklashMm, 3)),
      createOutputField("Tip-root gap (mm)", formatOutput(report.tipRootClearanceMm, 3)),
      createOutputField(
        report.helical ? "Total contact ratio" : "Operating angle (deg)",
        report.helical
          ? formatOutput(report.totalContactRatio, 3)
          : formatOutput(report.operatingPressureAngleDeg, 2)
      )
    ])
  );

  for (const issue of report.issues) section.append(gearMeshNote(issue));
  return section;
}

function gearMeshNote(issue) {
  const note = document.createElement("p");
  note.className = issue.severity === "error" ? "empty-note" : "parts-resize-note";
  note.textContent = issue.message;
  return note;
}

function createRevolveAngleField(body) {
  return createField(
    "Revolve angle (deg)",
    createInput({
      value: formatNumber(body.revolve?.angleDeg ?? FULL_REVOLVE_ANGLE_DEG, 1),
      step: "15",
      min: "1",
      dataset: { bodyProp: "revolveAngleDeg" }
    })
  );
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
    value.textContent = `${body.gear?.toothCount ?? 0} teeth / module ${body.gear?.moduleMm ?? 0} / ${body.gear?.pressureAngleDeg ?? 0} deg`;
  } else if (kind === BOOLEAN_OPERATION_KIND) {
    value.textContent = `${body.boolean?.operation ?? "boolean"} / ${(body.boolean?.operandBodyIds ?? []).join(", ")}`;
  } else if (kind === ADVANCED_CAD_RECIPE_KIND) {
    value.textContent = `recipe v${body.advancedCadRecipe?.version ?? "?"} / ${body.advancedCadRecipe?.operations?.length ?? 0} operations`;
  } else {
    value.textContent = kind;
  }
  summary.append(title, value);
  return summary;
}

function createSelectField(labelText, options, selectedValue, dataset = {}) {
  const select = document.createElement("select");
  for (const [key, value] of Object.entries(dataset)) {
    select.dataset[key] = value;
  }
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === selectedValue;
    select.append(element);
  }
  return { field: createField(labelText, select), select };
}

/**
 * Density-free geometry properties for a body, with its placement scale applied.
 *
 * The worker result is scale-free on purpose - the compile signature ignores the
 * transform - so the scale is folded in here rather than by recompiling.
 *
 * The Mass card, the assistant context and the bill of materials all read this one
 * function. That matters more than it looks: a BOM that fell back to `bodyGeometryProperties`
 * for an unbuilt sketch body would show a mass in the Documents card and a dash in the
 * Mass card for the same body at the same moment, which is a second mass path wearing
 * the first one's clothes.
 */
function scaledBodyGeometryProperties(body) {
  if (!body) return null;
  const properties = compileResults.get(body.id)?.geometryProperties ?? null;
  if (!properties) return null;
  return scaleGeometryProperties(properties, body.transform?.scale ?? [1, 1, 1]);
}

function bodyMassGrams(body) {
  const properties = scaledBodyGeometryProperties(body);
  if (!properties) return null;
  return massGramsForVolume(properties.volumeMm3, body.materialId);
}

/** A dash, never an interpolated number. */
function massText(grams) {
  return grams == null ? ABSENT_OUTPUT : `${formatNumber(grams, grams < 10 ? 2 : 1)} g`;
}

function renderMassProperties(body) {
  massProperties.replaceChildren();

  if (!body) {
    massSummary.textContent = ABSENT_OUTPUT;
    massProperties.append(emptyMessage("No body selected"));
    return;
  }

  const material = getMaterial(body.materialId);
  const { field: materialField } = createSelectField(
    "Material",
    listMaterials().map((entry) => ({ value: entry.id, label: entry.label })),
    body.materialId,
    { bodyProp: "materialId" }
  );
  massProperties.append(materialField);

  const properties = scaledBodyGeometryProperties(body);
  const grams = properties ? massGramsForVolume(properties.volumeMm3, body.materialId) : null;
  massSummary.textContent = massText(grams);

  const printedMass = createOutputField("Printed mass", massText(grams));
  printedMass.querySelector("output").id = "body-mass-value";
  // The unit conversion has to happen after the absence check, not before: `null / 1000`
  // is `0`, so an absent volume would reach `formatOutput` as a perfectly finite zero -
  // a fabricated number in the one card whose contract is to show a dash instead of a
  // guess. Same class of defect as cycle 04's `finiteOrNull`.
  const volume = createOutputField(
    "Volume (cm3)",
    formatOutput(properties?.volumeMm3 == null ? null : properties.volumeMm3 / 1000, 3)
  );
  volume.querySelector("output").id = "body-volume-value";
  const area = createOutputField(
    "Surface area (cm2)",
    formatOutput(properties?.surfaceAreaMm2 == null ? null : properties.surfaceAreaMm2 / 100, 2)
  );
  area.querySelector("output").id = "body-area-value";
  massProperties.append(printedMass, volume, area);

  if (properties?.centroidMm) {
    const grid = document.createElement("div");
    grid.className = "parts-field-grid";
    const title = document.createElement("span");
    title.textContent = "Centroid (mm)";
    grid.append(title);
    for (const [index, axis] of ["X", "Y", "Z"].entries()) {
      const value = properties.centroidMm[index];
      grid.append(createOutputField(axis, formatOutput(value, 2)));
    }
    massProperties.append(grid);
  }

  const note = document.createElement("p");
  note.className = "parts-resize-note";
  note.id = "mass-method-note";
  if (!properties) {
    note.textContent = "Mass appears once this body has built a solid.";
  } else if (properties.volumeUnavailableReason) {
    // Task-critical honesty: the divergence theorem returns a number for an open
    // surface, and that number means nothing, so the dash is the answer.
    note.textContent = properties.volumeUnavailableReason;
  } else if (grams == null) {
    note.textContent = `${material?.label ?? "This material"} has no published density, so no mass is stated.`;
  } else {
    note.textContent = properties.method === "exact-2d"
      ? `Exact profile integral at ${material.densityGcm3} g/cm3. Material changes never rebuild the solid.`
      : `Measured from the built mesh at ${material.densityGcm3} g/cm3, so it follows the tessellation.`;
  }
  massProperties.append(note);
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

function holeSelectOptions(values, labels = {}) {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

/**
 * The fastener-standards picker for one cut profile.
 *
 * Only the controls that mean something for the chosen style are rendered: a
 * process column exists only for a counterbore, and a face only for a style that
 * cuts a pocket. Showing a disabled "cut from" selector on a plain through hole
 * would imply the page had an opinion about a face it never touches.
 *
 * The radius is rendered as an output rather than an input whenever the hole is
 * resolved and locked, because in that state the standard owns the number: the
 * field is not disabled to be difficult, it is disabled because typing in it would
 * be overwritten by the next normalization and that would be a lie.
 */
function appendHoleFields(container, profile, scope) {
  const spec = normalizeHoleSpec(profile.hole);
  const resolved = resolveHole(profile.hole);

  const { field: standardField } = createSelectField(
    "Hole standard",
    [{ value: "", label: "None (free radius)" }, ...holeSelectOptions(HOLE_STANDARDS)],
    spec?.standard ?? "",
    { profileScope: scope, holeProp: "standard" }
  );
  container.append(standardField);
  if (!spec) return;

  const { field: sizeField } = createSelectField(
    "Fastener size",
    holeSelectOptions(FASTENER_SIZES),
    spec.size,
    { profileScope: scope, holeProp: "size" }
  );
  const { field: styleField } = createSelectField(
    "Hole style",
    holeSelectOptions(HOLE_STYLES, {
      through: "through",
      counterbore: "counterbore",
      countersink: "countersink",
      tapped: "tapped (tap drill)",
      heatSetInsert: "heat-set insert",
      nutTrap: "nut trap"
    }),
    spec.style,
    { profileScope: scope, holeProp: "style" }
  );
  const { field: fitField } = createSelectField(
    "Clearance fit",
    holeSelectOptions(CLEARANCE_FITS),
    spec.fit,
    { profileScope: scope, holeProp: "fit" }
  );
  container.append(sizeField, styleField, fitField);

  if (spec.style === "counterbore") {
    const { field: processField } = createSelectField(
      "Counterbore process",
      holeSelectOptions(HOLE_PROCESSES, { fdm: "printed (FDM)", machined: "machined (DIN 974-1)" }),
      spec.process,
      { profileScope: scope, holeProp: "process" }
    );
    container.append(processField);
  }

  if (HOLE_POCKET_STYLES.includes(spec.style)) {
    const { field: faceField } = createSelectField(
      "Cut pocket from",
      holeSelectOptions(HOLE_FACES, { top: "top face (+Y)", bottom: "bottom face (-Y)" }),
      spec.fromFace,
      { profileScope: scope, holeProp: "fromFace" }
    );
    container.append(faceField);
  }

  container.append(
    createCheckboxRow("Lock to standard diameter", spec.lockSize, { profileScope: scope, holeProp: "lockSize" })
  );

  const note = document.createElement("p");
  note.className = `parts-resize-note hole-note${resolved?.ok ? "" : " hole-note--refused"}`;
  note.dataset.holeNote = scope;
  if (!resolved?.ok) {
    note.textContent = resolved?.reason ?? "This hole cannot be resolved.";
  } else {
    const pocket = resolved.pocket;
    const pocketText = pocket
      ? ` ${pocket.style} pocket ${formatNumber(pocket.depthMm, 2)} mm deep from the ${pocket.fromFace} face.`
      : "";
    const unverified = resolved.unverifiedDimensions.length
      ? ` Flagged as unverified against a published standard: ${resolved.unverifiedDimensions.join(", ")}.`
      : "";
    // Both numbers at the exact place cycle 09's plan points at: a hole the user asked
    // for at 3.4 mm and a printer that will produce 3.32. The drawn figure keeps its
    // "from the fastener table" attribution and the as-made figure names the process, so
    // neither sentence can be mistaken for the other - and where the process publishes
    // no compensation there is one sentence rather than the same number twice.
    const compensationMm = selectedBodyCompensationMm();
    const asMade = compensationMm === null
      ? ""
      : ` It will measure about ${formatNumber(resolved.pilotDiameterMm - 2 * compensationMm, 2)} mm `
        + `once ${describeProcess(bodyProcessId(selectedProjectBody()))} has made it.`;
    note.textContent = `Pilot diameter ${formatNumber(resolved.pilotDiameterMm, 2)} mm from the fastener table, as drawn.${asMade}${pocketText}${unverified}`;
  }
  container.append(note);
}

/**
 * The selected body's signed compensation, or `null` where its process publishes none.
 *
 * A thin read of `bodyCompensationReport` rather than a second calculation, so the
 * inspector's sentence and the Manufacturability card's pair can never state different
 * compensations for the same body - and `null` stays `null` all the way to the caller,
 * which is what stops "no compensation" rendering as a second number equal to the first.
 */
function selectedBodyCompensationMm() {
  const body = selectedProjectBody();
  return body ? bodyCompensationReport(body).compensationMm : null;
}

function renderProfileFields(container, profile, scope) {
  container.replaceChildren();
  if (!profile) {
    container.append(emptyMessage("Missing profile"));
    return;
  }

  if (profile.type === "circle") {
    const derivedRadius = holeDerivedRadiusMm(profile.hole);
    container.append(
      profileField("Center X", profile.x, "x", scope),
      profileField("Center Z", profile.z, "z", scope),
      derivedRadius == null
        ? profileField("Radius", profile.radius, "radius", scope, { min: "0.1" })
        : createOutputField("Radius (from standard)", formatOutput(profile.radius, 2))
    );
    // A standards hole is a hole in a plate, so the picker belongs on cut profiles
    // only. An outer profile is the part's own outline and has no fastener.
    if (String(scope).startsWith("cut:")) appendHoleFields(container, profile, scope);
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
    title.textContent = `${profile.id} / ${describeHole(profile.hole) ?? profile.type}`;
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

const DFM_SEVERITY_CLASS = {
  error: "",
  warning: "validation-note",
  info: "validation-info"
};

/**
 * Manufacturability, as its own section rather than folded into Build.
 *
 * The two lists answer different questions and arrive by different routes. Build
 * carries compile warnings: statements about the solid the worker built, arriving
 * asynchronously with every worker message. These are statements about the design
 * against a process the user picked, computed synchronously on this thread from
 * the sketch alone. Merging them would also put a `<select>` inside a list that a
 * worker message rebuilds, which is a race waiting to be found.
 *
 * The picker writes the **selected body's** `processId`, because that is where it
 * is persisted; the list covers the whole project, so a laser-cut plate and a
 * printed bracket are each checked against their own process at once.
 */
/**
 * The drawing and the part, stated as two numbers that cannot be read as one.
 *
 * Cycle 09's whole point. A hole the user asked for at 3.4 mm and a printer that will
 * produce 3.32 are two facts, and a card showing one number has thrown away the
 * information - so both are rendered, each under its own label, and the as-made figure
 * is never shown without the drawn figure beside it.
 *
 * The smallest hole is the one shown because it is the one a compensation decides: a
 * fixed 0.08 mm is a rounding error on a 20 mm bore and a fifth of a 0.8 mm pilot. When
 * a body has no circular cut the pair falls back to the outline perimeter, which every
 * body has, so the card never goes blank while still having something to say.
 *
 * `formatOutput` rather than `toFixed`, and an explicit sentence rather than a zero,
 * for audit A2: a process that publishes no compensation has no second number, and
 * rendering "0.000" for that would tell the reader the page had measured a machine.
 */
function renderCompensation(body) {
  if (!body) {
    compensationNominal.textContent = ABSENT_OUTPUT;
    compensationAsMade.textContent = ABSENT_OUTPUT;
    compensationNote.textContent = "Select a body to see what its process will make of it.";
    return;
  }

  const report = bodyCompensationReport(body);
  const smallest = report.holes.length
    ? report.holes.reduce((min, hole) => (hole.nominalDiameterMm < min.nominalDiameterMm ? hole : min))
    : null;
  const label = smallest ? "Smallest hole" : "Outline perimeter";
  const nominalMm = smallest ? smallest.nominalDiameterMm : report.nominal?.perimeterMm ?? null;
  const asMadeMm = smallest ? smallest.asMadeDiameterMm : report.asMade?.perimeterMm ?? null;

  for (const [element, suffix] of [[compensationNominal, "as drawn"], [compensationAsMade, "as made"]]) {
    element.parentElement.querySelector(".parts-compensation__label").textContent = `${label}, ${suffix} (mm)`;
  }
  compensationNominal.textContent = formatOutput(nominalMm, 3);
  compensationAsMade.textContent = formatOutput(asMadeMm, 3);

  if (!report.compensationText) {
    compensationNote.textContent =
      `${report.processLabel} publishes no compensation here, so the part is drawn and made at the same size. `
      + "That is not a measurement of zero - it is the absence of one.";
    return;
  }
  // A feature smaller than the compensation has no as-made size, and the reason is worth
  // more than the dash: this is a body the chosen process cannot make, said plainly.
  if (report.asMadeUnavailableReason) {
    compensationNote.textContent = `${report.processLabel}: ${report.asMadeUnavailableReason}`;
    return;
  }
  if (!report.nominal) {
    compensationNote.textContent =
      `${report.processLabel}: ${report.compensationText} This body's geometry does not come from a sketch, `
      + "so there is no drawn profile here to compare it against.";
    return;
  }
  compensationNote.textContent = `${report.processLabel}: ${report.compensationText}`;
}

function renderManufacturability(project) {
  const body = selectedProjectBody();
  const selectedProcessId = body ? bodyProcessId(body) : normalizeProcessId(null);

  processSelect.replaceChildren();
  for (const entry of listProcessProfiles()) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    option.selected = entry.id === selectedProcessId;
    processSelect.append(option);
  }
  processSelect.disabled = !body;
  // The profile's own confidence note, so the reader can see that these are shop
  // practice rather than a standard before they trust a threshold.
  processSelect.title = body
    ? getProcessProfile(selectedProcessId)?.note ?? ""
    : "Select a body to choose how it is made.";

  renderCompensation(body);

  const issues = projectManufacturabilityIssues(project);
  dfmCount.textContent = issues.length ? `${issues.length}` : "OK";
  dfmList.replaceChildren();

  if (!project.bodies.length) {
    const note = document.createElement("li");
    note.className = "validation-note";
    note.textContent = "Add a body to check it against a process.";
    dfmList.append(note);
    return;
  }

  if (!issues.length) {
    const ok = document.createElement("li");
    ok.className = "validation-ok";
    ok.textContent = "Every feature is makeable by the chosen process";
    dfmList.append(ok);
    return;
  }

  for (const issue of issues.slice(0, 12)) {
    const row = document.createElement("li");
    row.className = DFM_SEVERITY_CLASS[issue.severity] ?? "";
    row.dataset.dfmCode = issue.code;
    row.dataset.dfmSeverity = issue.severity;
    const code = document.createElement("span");
    code.className = "validation-code";
    code.textContent = issue.bodyId ?? issue.code;
    const message = document.createElement("span");
    message.textContent = issue.message;
    row.append(code, message);
    dfmList.append(row);
  }
}

/** One list row: a short code chip and a sentence, the shape every other list here uses. */
function documentRow(code, text, className = "") {
  const row = document.createElement("li");
  if (className) row.className = className;
  const chip = document.createElement("span");
  chip.className = "validation-code";
  chip.textContent = code;
  const message = document.createElement("span");
  message.textContent = text;
  row.append(chip, message);
  return row;
}

/**
 * The bill of materials and the print-prep report.
 *
 * ⚠ Every derived number goes through `formatOutput`, and that is the point of the panel
 * rather than a detail of it. This is a table of derived numbers several of which are
 * legitimately absent, and the absent-not-zero defect has shipped three times in this
 * project - always caught in review, never by a test. A row whose mass the page does not
 * hold shows a dash **and** the reason, and it still appears: dropping the row would be
 * the same lie told by omission, and a reader counting rows would have nothing to tell
 * them so.
 *
 * `validateManufacturability` is unmemoized and runs on every render, and print prep calls
 * it once per body - so this panel re-derives with the project rather than with every
 * pointer move, which is what `render()` already is. Cycle 06 measured the rule set well
 * under a millisecond for the templates and named a fifty-body project as where it would
 * show; that is still where it would show, and it is recorded rather than pre-optimised.
 */
function renderDocuments(project) {
  const bom = projectBom(project, {
    geometryPropertiesById: new Map(
      project.bodies
        .map((body) => [body.id, scaledBodyGeometryProperties(body)])
        .filter(([, properties]) => properties)
    ),
    watertightById: new Map(project.bodies.map((body) => [body.id, bodyWatertightVerdict(body)]))
  });

  bomPartsList.replaceChildren();
  bomPurchasedList.replaceChildren();
  printPrepList.replaceChildren();

  if (!project.bodies.length) {
    documentsSummary.textContent = ABSENT_OUTPUT;
    bomTotalMass.textContent = ABSENT_OUTPUT;
    bomNote.textContent = "Add a body to produce a bill of materials.";
    printPrepSummary.textContent = ABSENT_OUTPUT;
    return;
  }

  for (const part of bom.parts) {
    const mass = formatOutput(part.massGrams, 2);
    const row = documentRow(
      part.name,
      part.massGrams == null
        ? `${mass} g - ${part.massUnavailableReason}`
        : `${mass} g of ${part.materialLabel}, ${part.processLabel}`,
      part.massGrams == null ? "validation-note" : ""
    );
    row.dataset.bomBodyId = part.bodyId;
    row.dataset.bomMass = mass;
    bomPartsList.append(row);
  }

  for (const entry of bom.purchased) {
    const row = documentRow(
      `${entry.quantity} x`,
      [describePurchased(entry), describeMinimumLength(entry)].filter(Boolean).join(" - ")
    );
    row.dataset.bomPurchased = entry.key;
    bomPurchasedList.append(row);
  }
  if (!bom.purchased.length) {
    bomPurchasedList.append(documentRow("Buy", "No hole in this project resolves to a fastener.", "validation-ok"));
  }

  // Null, not a partial sum presented as the answer. A reader takes a total to cover the
  // rows above it, so a total missing a row is absent and says how short it is.
  bomTotalMass.textContent = `${formatOutput(bom.totals.massGrams, 2)} g`;
  bomNote.textContent = bom.totals.massUnavailableReason
    ? `${bom.totals.massUnavailableReason} The bodies that could be weighed come to ${formatOutput(bom.totals.knownMassGrams, 2)} g.`
    : "";
  documentsSummary.textContent = `${bom.totals.partCount} made / ${bom.totals.purchasedCount} bought`;

  renderDrawingSheet(selectedProjectBody());

  const prep = projectPrintPrep(project);
  const needingSupport = prep.filter((entry) => entry.supports.required);
  printPrepSummary.textContent = needingSupport.length ? `${needingSupport.length} need support` : "No supports";
  for (const entry of prep) {
    const row = documentRow(
      entry.name,
      [
        entry.supports.summary,
        entry.orientation.recommendation ? `Orientation: ${entry.orientation.recommendation}` : entry.orientation.why,
        entry.stock.matches === false ? entry.stock.reason : null
      ]
        .filter(Boolean)
        .join(" "),
      entry.supports.required ? "validation-note" : ""
    );
    row.dataset.printPrepBodyId = entry.bodyId ?? "";
    row.dataset.printPrepSupports = String(entry.supports.required);
    printPrepList.append(row);
  }
}

/**
 * The drawing sheet for the selected body.
 *
 * ⚠ `innerHTML`, and the one place on this page that uses it. `bodyDrawingSheet` returns
 * markup it built itself from numbers, and every string it interpolates goes through its
 * own `escapeXml` - there is no path from a project field to unescaped markup. Building
 * several hundred SVG nodes through `createElement` per render would be the alternative,
 * and it would put the drawing's structure in two places: the string the tests parse and
 * the DOM the user sees.
 *
 * The mesh is passed for the isometric only. It is the compiled result the page already
 * holds, never a recompile, and a body with no result yet gets a sheet whose isometric
 * says so rather than a blank frame.
 */
function renderDrawingSheet(body) {
  if (!body) {
    drawingSheet.replaceChildren();
    drawingSummary.textContent = ABSENT_OUTPUT;
    return;
  }
  const result = compileResults.get(body.id) ?? null;
  drawingSheet.innerHTML = bodyDrawingSheet(body, {
    mesh: result ? { vertices: result.vertices, triangleCount: result.triangleCount, bounds: result.bounds } : null,
    materialLabel: getMaterial(body.materialId)?.label ?? body.materialId,
    processLabel: describeProcess(bodyProcessId(body)) ?? bodyProcessId(body)
  });
  drawingSummary.textContent = isSketchBody(body) ? "A3, dimensioned" : "A3, isometric only";
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

  renderLibraryPanel();
  renderBodyList(project);
  renderBodyProperties(body);
  if (body && !isSketchBody(body)) {
    outerProfileFields.replaceChildren(createAdvancedBodySummary(body));
  } else {
    renderProfileFields(outerProfileFields, body?.sketch?.outerProfile ?? null, "outer");
  }
  renderCutProfiles(body);
  renderSketchPreview(body);
  renderMassProperties(body);
  renderValidation(project);
  renderManufacturability(project);
  renderDocuments(project);
  previewScene.setSelectedBodyId(project.selectedBodyId);
  requestCadCompile(project);
  scheduleProjectAutosave();
}

function profileForScope(draft, scope) {
  return scope === "outer" ? draft.sketch.outerProfile : draft.sketch.cutProfiles[Number(scope.split(":")[1])];
}

/**
 * Apply one standards-picker change to a cut profile's `hole`.
 *
 * Clearing the standard removes the whole `hole` object rather than leaving an
 * empty one behind, so "None" really does return the profile to a plain circle
 * with the author's own radius. Every other change writes one field and lets
 * `normalizeProfile` re-derive the radius on commit, which is why there is no
 * radius arithmetic here: one place owns that, and it is `createCircleProfile`.
 */
function updateProfileHoleFromInput(input) {
  const scope = input.dataset.profileScope;
  const prop = input.dataset.holeProp;

  commitSelectedBody((draft) => {
    const profile = profileForScope(draft, scope);
    if (!profile) return draft;

    if (prop === "standard") {
      if (!input.value) {
        delete profile.hole;
        return draft;
      }
      // A first standard selection needs a size to become a hole at all, because a
      // hole with no size is indistinguishable from no hole.
      profile.hole = { ...(profile.hole ?? {}), standard: input.value, size: profile.hole?.size ?? DEFAULT_HOLE_SIZE };
      return draft;
    }

    if (!profile.hole) return draft;
    profile.hole = {
      ...profile.hole,
      [prop]: prop === "lockSize" ? input.checked : input.value
    };
    return draft;
  }, "Hole standard updated");
}

function updateProfileFromInput(input) {
  const body = selectedProjectBody();
  if (!body) return;

  const scope = input.dataset.profileScope;
  const prop = input.dataset.profileProp;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;

  commitSelectedBody((draft) => {
    const profile = profileForScope(draft, scope);
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
    // Material is source of truth for mass and nothing else: it is absent from the
    // compile signature, so changing it saves the project without rebuilding a solid.
    if (prop === "materialId") draft.materialId = input.value;
    if (prop === "revolveAngleDeg" && draft.revolve) draft.revolve.angleDeg = Number(input.value);
    applyGearPropertyInput(draft, prop, input);
    return draft;
  });
}

/**
 * Gear fields, all of which reach geometry.
 *
 * `normalizeSpurGearSpec` clamps every one of these and re-derives `extrudeDepthMm`
 * from the thickness, so this writes the raw value and lets the whitelist decide -
 * which is also why an out-of-range entry snaps back on the next render rather than
 * producing an uncompilable body.
 */
function applyGearPropertyInput(draft, prop, input) {
  if (!draft.gear || !prop.startsWith("gear")) return;
  if (prop === "gearToothCount") draft.gear.toothCount = Math.round(Number(input.value));
  if (prop === "gearModuleMm") draft.gear.moduleMm = Number(input.value);
  if (prop === "gearPressureAngleDeg") draft.gear.pressureAngleDeg = Number(input.value);
  if (prop === "gearThicknessMm") draft.gear.thicknessMm = Number(input.value);
  if (prop === "gearBoreDiameterMm") draft.gear.boreDiameterMm = Number(input.value);
  if (prop === "gearHelixAngleDeg") draft.gear.helixAngleDeg = Number(input.value);
  if (prop === "gearProfileShiftCoefficient") draft.gear.profileShiftCoefficient = Number(input.value);
  if (prop === "gearBacklashMm") draft.gear.backlashMm = Number(input.value);
  if (prop === "gearRackProfileId") draft.gear.rackProfileId = input.value;
  // An empty fillet field means "follow the rack profile", which the normalizer
  // stores as null rather than resolving, so switching rack still moves the fillet.
  if (prop === "gearRootFilletFactor") {
    draft.gear.rootFilletFactor = String(input.value).trim() === "" ? null : Number(input.value);
  }
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
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) return;
  // Hole controls carry `profileScope` too, so they are dispatched first and the
  // handler returns: they are not numeric profile fields and must not fall through
  // to `updateProfileFromInput`.
  if (input.dataset.holeProp) {
    updateProfileHoleFromInput(input);
    return;
  }
  // The mesh partner is session-only presentation state, so it re-renders the
  // inspector and neither commits the project nor triggers a compile.
  if (input.dataset.gearPairPartner) {
    gearPairPartnerId = input.value;
    window.setTimeout(() => renderBodyProperties(selectedProjectBody()), 0);
    return;
  }
  if (input.dataset.resizeOption) handleResizeOptionInput(input);
  if (input.dataset.resizeTargetAxis) handleResizeTargetInput(input);
  if (input.dataset.bodyProp) handleBodyPropertyInput(input);
  if (input.dataset.transformKind) handleTransformInput(input);
  if (input.dataset.profileScope) updateProfileFromInput(input);
}

function createCutProfile(type, options = {}) {
  const body = selectedProjectBody();
  if (!isSketchBody(body) || !body?.sketch?.outerProfile) return null;
  const [defaultX, defaultZ] = profileCenter(body.sketch.outerProfile);
  const centerX = Number.isFinite(Number(options.x)) ? Number(options.x) : defaultX;
  const centerZ = Number.isFinite(Number(options.z)) ? Number(options.z) : defaultZ;
  const size = profileSize(body.sketch.outerProfile);
  const existingIds = new Set([
    body.sketch.outerProfile.id,
    ...body.sketch.cutProfiles.map((profile) => profile.id)
  ]);

  if (type === "slot") {
    if (options.hole) throw new Error("A fastener standard can only be attached to a circular cut profile.");
    return createSlottedHole({
      id: uniquePartId("slot_hole", existingIds, "slot_hole"),
      x: centerX,
      z: centerZ,
      length: Math.max(12, Math.min(size.width * 0.22, 28)),
      width: Math.max(4, Math.min(size.height * 0.12, 8))
    });
  }

  const profile = createCircularHole({
    id: uniquePartId("hole", existingIds, "hole"),
    x: centerX,
    z: centerZ,
    radius: Math.max(2, Math.min(size.width, size.height) * 0.06)
  });
  if (!options.hole) return profile;

  // Validated through the same refusal path the assistant's profile editor uses,
  // rather than a second copy of it, then rebuilt so the returned profile already
  // carries its derived radius. Without the rebuild the caller would report the
  // placeholder diameter in its status message and only the commit would correct it.
  applyHoleArgument(profile, options.hole);
  return createCircularHole(profile);
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

/**
 * Resolve the chosen hardware entry against the selected body and append its cuts.
 *
 * Deliberately the same shape as the two pattern buttons above: resolve, then one
 * `commitSelectedBody`. That is what makes an applied hardware pattern
 * indistinguishable from hand-authored cuts - it goes through `normalizeSketch` and
 * `normalizeProfile` like every other mutation, nothing about it is persisted beyond
 * the profiles themselves, and undo takes it back in one step.
 *
 * The pattern is centred on the outer profile's centre rather than on the origin,
 * because a sketch whose plate is off-centre is the case where the difference shows.
 */
function applyHardwarePattern(entryId = hardwareEntrySelect.value) {
  const body = selectedProjectBody();
  if (!isSketchBody(body) || !body?.sketch?.outerProfile) return;
  const [centerX, centerZ] = profileCenter(body.sketch.outerProfile);
  const applied = appendHardwarePatternToSketch(body.sketch, entryId, { centerX, centerZ });

  if (!applied.ok) {
    // A refusal is reported and changes nothing, exactly as an unresolvable hole does.
    // It is a status message rather than a validation issue because there is no body
    // state to be invalid: the geometry the user had is the geometry they still have.
    showStatus(applied.resolved.reason, 6400);
    return;
  }

  commitSelectedBody((draft) => {
    draft.sketch.cutProfiles.push(...applied.resolved.profiles);
    return draft;
  }, applied.resolved.label);
}

function addRevolvedBody(presetId = revolvePresetSelect.value) {
  const selectedPresetId = typeof presetId === "string" ? presetId : revolvePresetSelect.value;
  ensureSelectValue(revolvePresetSelect, selectedPresetId, "revolve preset id");
  const existingIds = new Set(history.current.bodies.map((body) => body.id));
  const body = createRevolveBodyFromPreset(selectedPresetId, {}, existingIds);
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
  const selectedOperation = typeof operation === "string" ? operation : booleanOperationSelect.value;
  ensureSelectValue(booleanOperationSelect, selectedOperation, "boolean operation");
  const operands = booleanOperandBodies();
  if (operands.length < 2) {
    if (options.throwOnInvalid) throw new Error("Create at least two bodies before adding a boolean body.");
    showStatus("Create at least two bodies before adding a boolean body.", 4200);
    return null;
  }

  const existingIds = new Set(history.current.bodies.map((body) => body.id));
  const body = createBooleanOperationBody(
    selectedOperation,
    operands,
    {
      name: `${selectedOperation} ${operands[0].name} ${operands[1].name}`,
      color: "#14b8a6"
    },
    existingIds
  );
  commit(addBody(history.current, body), `${selectedOperation} body added`);
  return body;
}

/**
 * Export the selected body to one format through the CAD worker.
 *
 * The availability table is consulted here as well as in the menu, because the
 * assistant and the browser suite can reach this without going through a button,
 * and a refusal has to state the same reason either way.
 */
async function exportSelectedFormat(formatId, options = {}) {
  if (options.waitForCompile) await waitForCadReady();
  const body = selectedProjectBody();
  const availability = bodyExportAvailability(body, formatId, exportMenuContext(body));
  if (!availability.available) {
    showStatus(availability.reason, 5200);
    if (options.throwOnInvalid) throw new Error(availability.reason);
    return null;
  }

  if (formatId === EXPORT_FORMAT_STEP) return exportSelectedStep(options);
  if (formatId === EXPORT_FORMAT_3MF) return exportSelected3mf(body, options);

  const requestId = nextWorkerRequestId();
  const label = exportFormatLabel(formatId);
  let settled = null;
  const finished = new Promise((resolve, reject) => {
    settled = { resolve, reject };
  });
  pendingExports.set(requestId, { formatId, bodyId: body.id, ...settled });
  renderCompileStatus();
  showStatus(`Preparing ${label}...`, 8000);

  try {
    postCadWorkerMessage({
      type: "exportBody",
      requestId,
      formatId,
      body,
      bodies: history.current.bodies
    });
  } catch (error) {
    pendingExports.delete(requestId);
    renderCompileStatus();
    handleCadWorkerFailure(
      compileFailure("worker-post-message-error", `Unable to start ${label} export: ${error.message}`, body.id)
    );
    if (options.throwOnInvalid) throw new Error(`Unable to start ${label} export.`);
    return null;
  }

  if (options.throwOnInvalid) return finished;
  // Nothing is awaiting this one, and an export failure is already reported through
  // `showStatus`, so the rejection is absorbed rather than left unhandled.
  finished.catch(() => {});
  return null;
}

function exportSelectedStl(options = {}) {
  return exportSelectedFormat(EXPORT_FORMAT_ASCII_STL, options);
}

/**
 * 3MF, built here rather than in the worker.
 *
 * The mesh is already in the compile cache, so this needs no worker round trip and
 * no second compile - and it keeps JSZip out of the worker bundle, which Vite
 * would otherwise inline into the preview startup path (`AGENTS.md:48`).
 */
async function exportSelected3mf(body, options = {}) {
  showStatus("Preparing 3MF...", 8000);
  try {
    const { exportBodyMeshTo3mf } = await import("./parts/exporters/threeMf.js");
    const result = await exportBodyMeshTo3mf(body, compileResults.get(body.id), {
      watertight: bodyWatertightVerdict(body)
    });
    downloadBlob(result.data, result.fileName, result.mimeType);
    showStatus("3MF export started");
    return result;
  } catch (error) {
    const message = error?.message ?? "3MF export failed.";
    showStatus(message, 6200);
    if (options.throwOnInvalid) throw new Error(message);
    return null;
  }
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * STEP for **any** body kind, through the optional local bridge.
 *
 * ⚠ This used to refuse everything but an `advancedCadRecipe` body, because the bridge
 * read `body.advancedCadRecipe` and nothing else. `backendPayload.js` now builds a
 * declarative payload per kind - a sketch's profiles, a revolve's polygon, a gear's
 * transverse outline, a boolean's operand closure - so the remaining question about STEP
 * is whether a bridge is there to answer it, which is what the probe is for.
 *
 * The request asks for **no mesh and no STL**. The STEP is OCCT's own BREP from
 * `export_step` and has never touched the ASCII STL; keeping `includeMesh` false is what
 * makes that true rather than merely intended.
 */
async function exportSelectedStep(options = {}) {
  const body = selectedProjectBody();
  if (!body) {
    showStatus("Select a body before exporting STEP.", 4200);
    if (options.throwOnInvalid) throw new Error("Select a body before exporting STEP.");
    return;
  }

  // Asked before the round trip, so a body with no exact representation - a sketch with
  // no outer profile, a boolean whose operand is gone - is refused for the reason that is
  // true about the body rather than being blamed on a missing backend.
  const unavailable = exactBodyUnavailableReason(body, { bodies: history.current.bodies });
  if (unavailable) {
    showStatus(unavailable, 5200);
    if (options.throwOnInvalid) throw new Error(unavailable);
    return;
  }

  try {
    showStatus("Preparing STEP with local CAD backend...", 10000);
    const response = await fetch(CAD_COMPILE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        exactBodyCompileRequest(body, {
          bodies: history.current.bodies,
          includeStep: true,
          includeStl: false,
          includeMesh: false
        })
      )
    });
    let result = null;
    try {
      result = await response.json();
    } catch {
      result = { ok: false, message: "Advanced CAD backend did not return JSON." };
    }
    if (!response.ok || !result?.ok || !result.stepBase64) {
      throw new Error(result?.message ?? "Advanced CAD backend is unavailable.");
    }

    downloadBlob(
      bytesFromBase64(result.stepBase64),
      `${sanitizePartId(body.name ?? body.id, "part")}.step`,
      "model/step"
    );
    // A gear's involute flanks are a sampled point list at the page's chord tolerance, and
    // the payload declares it. Saying so beats letting a tier called "exact" imply more
    // than it delivered.
    showStatus(
      result.fidelity === "sampled"
        ? "STEP export started. Curved flanks in this body are sampled to the page's chord tolerance."
        : "STEP export started"
    );
  } catch (error) {
    const message = error?.message ?? "STEP export failed.";
    showStatus(message, 6200);
    // The bridge just told us something the cached probe may not know. Asking again keeps
    // the menu's next sentence consistent with what actually happened.
    refreshCadBackendProbe();
    if (options.throwOnInvalid) throw new Error(message);
  }
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
    await workspaceStore.writeCurrentAssemblySnapshot(snapshot);
    // The handoff navigates away, so the project must be on disk before the page unloads.
    await flushProjectAutosave();
    window.location.href = `${import.meta.env.BASE_URL}?fromParts=1`;
  } catch (error) {
    console.error("Component Builder handoff failed", error);
    sendAssemblyButton.disabled = false;
    renderCompileStatus();
    showStatus("Unable to send generated parts to Assembly Studio.", 5200);
    if (options.throwOnInvalid) throw new Error("Unable to send generated parts to Assembly Studio.");
  }
}

function mountPartsAssistant() {
  const assistant = mountPageAssistant({
    pageId: "parts",
    title: "Robotic Component Builder",
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
      parts_save_selected_to_library: async () => {
        const item = await saveSelectedPartToLibrary();
        return `${item.name} saved to the local part library.`;
      },
      parts_add_library_item: ({ itemId }) => {
        const item = libraryItemById(itemId);
        addLibraryItemToCurrentProject(item.id);
        return `${item.name} added from the local part library.`;
      },
      parts_delete_library_item: async ({ itemId }) => {
        const item = await deleteLibraryItem(itemId);
        return `${item.name} removed from the local part library.`;
      },
      parts_export_library_json: () => {
        exportLibraryJson();
        return "Part library JSON export started.";
      },
      parts_open_library_import_picker: () => {
        libraryFileInput.click();
        return "Part library JSON file picker opened.";
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
      parts_open_assembly_studio: async () => {
        await flushProjectAutosave();
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
      parts_create_custom_sketch_body: (args) => createCustomSketchBodyForAssistant(args),
      parts_replace_sketch_body: (args) => replaceSketchBodyForAssistant(args),
      parts_create_advanced_cad_body: (args) => createAdvancedCadBodyForAssistant(args),
      parts_replace_advanced_cad_body: (args) => replaceAdvancedCadBodyForAssistant(args),
      parts_export_selected_step: async () => {
        await exportSelectedStep({ throwOnInvalid: true });
        return "Selected advanced CAD body STEP export started.";
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
hardwareEntrySelect.addEventListener("change", renderHardwareEntryNote);
applyHardwarePatternButton.addEventListener("click", () => applyHardwarePattern());
addRevolveBodyButton.addEventListener("click", () => addRevolvedBody());
addSpurGearButton.addEventListener("click", addSpurGear);
addBooleanBodyButton.addEventListener("click", () => addBooleanBody());

newProjectButton.addEventListener("click", () => {
  // The project is autosaved now, so New replaces stored work and not just the session.
  // Same guard, and for the same reason, as Circuit Lab's new-project button.
  if (history.current.bodies.length && !window.confirm("Start a new PartProject? The saved project will be replaced.")) return;
  resetProjectHistory(history);
  render();
  showStatus("New PartProject");
});

saveProjectButton.addEventListener("click", () => {
  downloadBlob(serializePartProject(history.current), "robotic-part-project.json", "application/json");
  showStatus("PartProject JSON saved");
});

saveLibraryPartButton.addEventListener("click", () => {
  void saveSelectedPartToLibrary().catch((error) => handleLibraryError(error));
});

exportLibraryButton.addEventListener("click", () => {
  try {
    exportLibraryJson();
  } catch (error) {
    handleLibraryError(error);
  }
});

importLibraryButton.addEventListener("click", () => libraryFileInput.click());

librarySignInButton.addEventListener("click", () => {
  void authController.signIn().catch((error) => handleLibraryError(error, "Google sign-in failed."));
});

librarySyncButton.addEventListener("click", () => {
  void syncLibraryToSupabase().catch((error) => handleLibraryError(error, "Cloud sync failed."));
});

librarySignOutButton.addEventListener("click", () => {
  void authController.signOut().catch((error) => handleLibraryError(error, "Sign-out failed."));
});

libraryFileInput.addEventListener("change", () => {
  const file = libraryFileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    void importPartLibraryJson(reader.result).catch((error) => handleLibraryError(error)).finally(() => {
      libraryFileInput.value = "";
    });
  });
  reader.addEventListener("error", () => {
    showStatus("Part library JSON could not be read", 5200);
    libraryFileInput.value = "";
  });
  reader.readAsText(file);
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

const handleProjectHistoryShortcut = createHistoryShortcutHandler({
  undo: () => {
    undoProject(history);
    render();
  },
  redo: () => {
    redoProject(history);
    render();
  }
});

undoButton.addEventListener("click", () => {
  undoProject(history);
  render();
});

redoButton.addEventListener("click", () => {
  redoProject(history);
  render();
});

document.addEventListener("keydown", handleProjectHistoryShortcut);

exportMenuToggle.addEventListener("click", () => {
  const opening = !isExportMenuOpen();
  setExportMenuOpen(opening);
  // Opening the menu is the moment the answer starts to matter, and the only moment a
  // user is waiting for it. The probe is cached, so this costs one subprocess per session
  // and nothing on Pages after the first refusal expires.
  if (opening) refreshCadBackendProbe();
});

exportMenuPanel.addEventListener("click", (event) => {
  const item = event.target.closest("[data-export-format]");
  if (!item || item.disabled) return;
  setExportMenuOpen(false);
  void exportSelectedFormat(item.dataset.exportFormat);
});

// A popover that only closes by re-clicking its own trigger is a trap for a
// keyboard user and a nuisance for everyone else.
document.addEventListener("pointerdown", (event) => {
  if (!isExportMenuOpen() || exportMenu.contains(event.target)) return;
  setExportMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !isExportMenuOpen()) return;
  setExportMenuOpen(false);
  exportMenuToggle.focus();
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

processSelect.addEventListener("change", () => {
  const value = processSelect.value;
  // Absent from `COMPILE_SIGNATURE_FIELDS`, so this saves the project and rebuilds
  // nothing: a process is how the geometry is judged, never what it is.
  commitSelectedBody((draft) => {
    draft.processId = value;
    return draft;
  }, `Process set to ${getProcessProfile(value)?.label ?? value}`);
});

bodyProperties.addEventListener("change", handleInspectorChange);
massProperties.addEventListener("change", handleInspectorChange);
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

mountShellCardToggles(document);
renderTemplateOptions();
renderAdvancedOptions();
authController.subscribe((nextAuthState) => {
  authState = nextAuthState;
  renderLibraryPanel();
  const userId = signedInSession()?.user?.id ?? null;
  if (userId && userId !== lastSyncedUserId) {
    lastSyncedUserId = userId;
    void syncLibraryToSupabase({ silent: true }).catch((error) => handleLibraryError(error, "Cloud sync failed."));
  }
  if (!userId) lastSyncedUserId = null;
});
render();
installPersistenceInstrumentation();
installCompileInstrumentation();
installDfmInstrumentation();
installCadBackendInstrumentation();
void bootstrapProjectPersistence();
void loadPartLibrary();
void authController.refresh();
mountPartsAssistant();
