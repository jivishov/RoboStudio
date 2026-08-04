import "./tokens.css";
import "./shellCards.css";
import "./circuits.css";
import "./shellHeader.css";
import { mountPageAssistant } from "./assistant/chatUi.js";
import {
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
  normalizeComponentScale,
  terminalWorldPosition
} from "./circuits/geometry.js";
import { inspectDirectInsertionState } from "./circuits/insertion.js";
import { installMaterialSymbolsFallback } from "./circuits/materialSymbols.js";
import { derivePhysicalOccupancy } from "./circuits/occupancy.js";
import { fallbackVisualNotice } from "./circuits/proceduralVisuals.js";
import { terminalAriaLabel, terminalTooltip } from "./circuits/terminalRenderer.js";
import {
  createProjectedTerminalResolver,
  terminalEndpointKey,
  terminalPointerProfile
} from "./circuits/screenSpaceResolver.js";
import { nearestVisibleTerminalInDirection } from "./circuits/spatialNavigation.js";
import {
  DEFAULT_VIEW_ZOOM,
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  clampViewCenter,
  clippedComponentCounts,
  componentCamera,
  defaultCameraForProject,
  overviewCameraForProject,
  portCamera,
  viewBoxForCamera
} from "./circuits/workbenchView.js";
import { getVisualDefinition } from "./circuits/visualCatalog.js";
import { componentVisualStatus } from "./circuits/visualRenderer.js";
import { endpointFittingClass, shouldRenderExternalWire, wirePath } from "./circuits/wireRenderer.js";
import { getPhotorealAssetUrl } from "./circuits/generated/photorealAssets.js";
import {
  addComponent,
  applyStarterTemplate,
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
import {
  commitStagedMutation,
  stageDisconnectMutation,
  stageInsertionMutation,
  stageWireMutation
} from "./circuits/transactions.js";
import { normalizeMechatronicsBinding, parseMechatronicsBindingJson, serializeMechatronicsBinding } from "./mechatronics/model.js";
import { previewMechatronicsBindingSuggestions } from "./mechatronics/suggestions.js";
import { createStatusChannel } from "./statusChannel.js";

installMaterialSymbolsFallback(document);

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_BENCH_ZOOM = MIN_VIEW_ZOOM;
const MAX_BENCH_ZOOM = MAX_VIEW_ZOOM;
const BENCH_ZOOM_STEP = 1.18;
const WIRE_HINT_SESSION_KEY = "robostudio:circuit-lab:first-wire-complete";

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
const overviewButton = document.querySelector("#circuit-view-overview");
const frameButton = document.querySelector("#circuit-view-frame");
const edgeCues = document.querySelector("#circuit-edge-cues");
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
const mutationConfirmation = document.querySelector("#circuit-mutation-confirmation");
const mutationConfirmationTitle = document.querySelector("#circuit-mutation-confirmation-title");
const mutationConfirmationSummary = document.querySelector("#circuit-mutation-confirmation-summary");
const mutationConfirmationEndpoints = document.querySelector("#circuit-mutation-confirmation-endpoints");
const mutationConfirmationHazards = document.querySelector("#circuit-mutation-confirmation-hazards");
const confirmMutationButton = document.querySelector("#confirm-circuit-mutation");
const cancelMutationButton = document.querySelector("#cancel-circuit-mutation");
const precisionHud = document.querySelector("#circuit-precision-hud");
const liveRegion = document.querySelector("#circuit-live-region");
const activeTerminalProxy = document.querySelector("#circuit-active-terminal-proxy");
const hardwareDrawer = document.querySelector("#circuit-hardware-drawer");
const workflowDrawer = document.querySelector("#circuit-workflow-drawer");
const hardwareDrawerTrigger = document.querySelector("#open-circuit-hardware-drawer");
const workflowDrawerTrigger = document.querySelector("#open-circuit-workflow-drawer");
const workflowPanel = document.querySelector("#circuit-workflow-panel");
const drawerMediaQuery = window.matchMedia("(max-width: 1199.98px)");

function sessionWireHintDismissed() {
  try {
    return window.sessionStorage.getItem(WIRE_HINT_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

const history = createHistory(createCircuitLabProject());
const workspaceStore = createWorkspaceStore();
const uiState = {
  pendingEndpoint: null,
  wireDrag: null,
  pendingMutation: null,
  projectGeneration: 0,
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
    ...defaultCameraForProject(currentHistoryValue(history), (typeId) => catalog.getComponent(typeId)),
    userAdjusted: false,
    userAdjustedBeforeHydration: false
  },
  placement: null,
  explicitSelectedComponentId: null,
  openDrawer: null,
  drawerTrigger: null,
  wireHintDismissed: sessionWireHintDismissed(),
  targeting: {
    resolution: null,
    focusedEndpoint: null,
    focusSource: null,
    lockedEndpointKey: "",
    ambiguityAction: null,
    lastClientPoint: null,
    pointerType: "mouse"
  }
};
let storageHydrationFinished = false;
let userEditedBeforeStorageHydration = false;
let pointerInteraction = null;
let wireInteraction = null;
let benchPanInteraction = null;
let pendingPreviewProject = null;
let previewAnimationFrame = 0;
let pendingTargetPointer = null;
let suppressNextBenchClick = false;
let pendingFritzingFzpFile = null;
let benchLayers = null;
let circuitAssistantHandle = null;

const cycle3Diagnostics = {
  fullBenchReplacementCount: 0,
  stableBenchRenderCount: 0,
  transientRenderCount: 0,
  pointerFrameCount: 0,
  pointerEventCount: 0,
  wheelEventCount: 0
};

function physicalPortForTerminal(definition, terminalId) {
  return (definition?.physicalPorts ?? []).find((port) => port.terminalIds.includes(terminalId)) ?? null;
}

function collectProjectedTerminalAnchors(project = currentProject()) {
  const occupancy = derivePhysicalOccupancy(project);
  const anchors = [];
  for (const component of project.components) {
    const definition = catalog.getComponent(component.typeId);
    if (!definition) continue;
    const visualDefinition = getVisualDefinition(component.typeId);
    for (const terminal of definition.terminals) {
      const endpoint = { componentId: component.id, terminalId: terminal.id };
      const endpointKey = terminalEndpointKey(endpoint);
      const used = occupancy.occupancyByEndpoint.get(endpointKey)?.length ?? 0;
      const capacity = Math.max(1, Number(terminal.attachmentCapacity ?? 1));
      const port = physicalPortForTerminal(definition, terminal.id);
      const contactIndex = port ? port.terminalIds.indexOf(terminal.id) : -1;
      anchors.push({
        endpoint,
        endpointKey,
        svgPoint: terminalWorldPosition(component, terminal),
        componentId: component.id,
        componentLabel: component.name,
        componentTypeId: component.typeId,
        terminalId: terminal.id,
        terminalLabel: terminal.physicalLabel ?? terminal.label ?? terminal.id,
        terminalAriaLabel: terminalAriaLabel(component, terminal),
        physicalPortId: port?.id ?? terminal.connectorId ?? null,
        physicalPortLabel: port?.id ?? terminal.connectorId ?? "Independent contact",
        contactPosition: port && contactIndex >= 0 ? `${contactIndex + 1}/${port.terminalIds.length}` : "Independent",
        connectorType: terminal.connectorInterface ?? port?.engineeringConnectorId ?? "unknown",
        engineeringConnectorId: port?.engineeringConnectorId ?? terminal.connectorId ?? null,
        capacityUsed: used,
        capacity,
        invalidReason: used >= capacity
          ? `Terminal ${component.id}.${terminal.id} is full (${used}/${capacity} attachments).`
          : null,
        electricalRole: terminal.electricalRole ?? terminal.kind ?? "unknown",
        voltageDomainId: terminal.voltageDomainId ?? "unspecified",
        geometryAccuracy: definition.geometryEvidence?.accuracyClass ?? "unclassified",
        terminal,
        component,
        componentDefinition: definition,
        port,
        terminalVisual: visualDefinition?.terminalVisuals?.[terminal.id] ?? null
      });
    }
  }
  return anchors;
}

const projectedTerminalResolver = createProjectedTerminalResolver({
  collectAnchors: (project) => collectProjectedTerminalAnchors(project),
  getScreenCTM: () => benchSvg.getScreenCTM()
});

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

// Circuit Lab already owns #circuit-live-region for interaction announcements,
// so the status channel here does not announce; routing both through one region
// would double-announce every commit and every block.
const statusChannel = createStatusChannel({
  element: statusEl,
  defaultTimeoutMs: 3600,
  announce: false,
  cancelPendingOnPersistentMessage: false,
  onIdle: () => {
    const summary = projectSummary(currentProject());
    statusEl.textContent = `${summary.name} / ${summary.componentCount} components / ${summary.connectionCount} wires`;
  }
});

function showStatus(message, timeoutMs = 3600) {
  statusChannel.show(message, timeoutMs);
}

function announceInteraction(message) {
  if (!liveRegion || !message) return;
  liveRegion.textContent = "";
  window.requestAnimationFrame(() => {
    liveRegion.textContent = String(message);
  });
}

function markWireHintComplete() {
  if (uiState.wireHintDismissed) return;
  uiState.wireHintDismissed = true;
  try {
    window.sessionStorage.setItem(WIRE_HINT_SESSION_KEY, "true");
  } catch {
    // The hint remains dismissed for this page session when storage is unavailable.
  }
}

function drawerRecord(name) {
  if (name === "hardware") return { panel: hardwareDrawer, trigger: hardwareDrawerTrigger };
  if (name === "workflow") return { panel: workflowDrawer, trigger: workflowDrawerTrigger };
  return null;
}

function syncDrawerLayout() {
  const compact = drawerMediaQuery.matches;
  for (const name of ["hardware", "workflow"]) {
    const record = drawerRecord(name);
    if (!record?.panel || !record.trigger) continue;
    const open = compact && uiState.openDrawer === name;
    record.panel.classList.toggle("is-open", open);
    record.panel.inert = compact && !open;
    record.trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }
  document.querySelector(".circuit-shell")?.classList.toggle("has-open-drawer", compact && Boolean(uiState.openDrawer));
}

function closeOpenDrawer(options = {}) {
  if (!uiState.openDrawer) return false;
  const trigger = uiState.drawerTrigger ?? drawerRecord(uiState.openDrawer)?.trigger;
  const panel = drawerRecord(uiState.openDrawer)?.panel;
  if (panel?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
  uiState.openDrawer = null;
  uiState.drawerTrigger = null;
  syncDrawerLayout();
  if (options.restoreFocus !== false) trigger?.focus({ preventScroll: true });
  return true;
}

function openDrawer(name, trigger = drawerRecord(name)?.trigger) {
  if (!drawerMediaQuery.matches) return false;
  if (uiState.openDrawer === name) return true;
  if (uiState.openDrawer) closeOpenDrawer({ restoreFocus: false });
  uiState.openDrawer = name;
  uiState.drawerTrigger = trigger;
  syncDrawerLayout();
  const panel = drawerRecord(name)?.panel;
  panel?.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']")?.focus({ preventScroll: true });
  return true;
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeBenchZoom(value) {
  return Math.min(MAX_BENCH_ZOOM, Math.max(MIN_BENCH_ZOOM, Number(value) || DEFAULT_VIEW_ZOOM));
}

function clampBenchViewCenter(center, zoom = uiState.view.zoom) {
  return clampViewCenter(center, zoom);
}

function benchViewBoxFor(zoom = uiState.view.zoom, center = uiState.view.center) {
  return viewBoxForCamera({ zoom, center });
}

function renderEdgeCues() {
  if (!edgeCues) return;
  const counts = clippedComponentCounts(currentProject(), (typeId) => catalog.getComponent(typeId), benchViewBoxFor());
  const labels = { top: "Up", right: "Right", bottom: "Down", left: "Left" };
  let visible = false;
  for (const direction of Object.keys(labels)) {
    const element = edgeCues.querySelector(`[data-edge-direction='${direction}']`);
    const count = counts[direction];
    if (!element) continue;
    element.hidden = count === 0;
    element.textContent = count ? `${labels[direction]} ${count}` : "";
    if (count) visible = true;
  }
  edgeCues.hidden = !visible;
}

function renderBenchView() {
  const viewBox = benchViewBoxFor();
  benchSvg.setAttribute("viewBox", viewBox.map((value) => value.toFixed(3)).join(" "));
  projectedTerminalResolver.invalidate("camera-viewbox");
  benchSvg.classList.toggle("is-pan-ready", uiState.view.zoom > 1.001);
  benchSvg.classList.toggle("is-panning", Boolean(benchPanInteraction));
  if (zoomLevelEl) zoomLevelEl.textContent = `View ${Math.round(uiState.view.zoom * 100)}%`;
  if (zoomOutButton) zoomOutButton.disabled = uiState.view.zoom <= MIN_BENCH_ZOOM + 0.001;
  if (zoomInButton) zoomInButton.disabled = uiState.view.zoom >= MAX_BENCH_ZOOM - 0.001;
  renderEdgeCues();
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
  if (options.userAdjusted !== false) {
    uiState.view.userAdjusted = true;
    if (!storageHydrationFinished) uiState.view.userAdjustedBeforeHydration = true;
  }
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
  renderTransientLayer();
}

function resetBenchZoom() {
  const project = currentProject();
  const selected = uiState.explicitSelectedComponentId
    ? project.components.find((component) => component.id === uiState.explicitSelectedComponentId)
    : null;
  const definition = selected ? catalog.getComponent(selected.typeId) : null;
  const next = selected && definition
    ? { zoom: DEFAULT_VIEW_ZOOM, center: [
        (componentBounds(selected, definition).left + componentBounds(selected, definition).right) / 2,
        (componentBounds(selected, definition).top + componentBounds(selected, definition).bottom) / 2
      ] }
    : defaultCameraForProject(project, (typeId) => catalog.getComponent(typeId));
  uiState.view.zoom = DEFAULT_VIEW_ZOOM;
  uiState.view.center = clampBenchViewCenter(next.center, DEFAULT_VIEW_ZOOM);
  uiState.view.userAdjusted = true;
  if (!storageHydrationFinished) uiState.view.userAdjustedBeforeHydration = true;
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
  renderTransientLayer();
}

function showOverview() {
  const next = overviewCameraForProject(currentProject(), (typeId) => catalog.getComponent(typeId));
  uiState.view.zoom = next.zoom;
  uiState.view.center = next.center;
  uiState.view.userAdjusted = true;
  if (!storageHydrationFinished) uiState.view.userAdjustedBeforeHydration = true;
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
  renderTransientLayer();
}

function frameSelectionOrPort() {
  const project = currentProject();
  const target = targetRecordForDisplay();
  let next = null;
  if (target?.component && target?.port) next = portCamera(target.component, target.port);
  if (!next) {
    const selectedId = uiState.explicitSelectedComponentId ?? project.selectedComponentId;
    const component = project.components.find((item) => item.id === selectedId);
    const definition = component ? catalog.getComponent(component.typeId) : null;
    if (component && definition) next = componentCamera(component, definition);
  }
  if (!next) {
    showStatus("Select a component or focus a physical port before framing.", 5200);
    return;
  }
  uiState.view.zoom = next.zoom;
  uiState.view.center = next.center;
  uiState.view.userAdjusted = true;
  if (!storageHydrationFinished) uiState.view.userAdjustedBeforeHydration = true;
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
  renderTransientLayer();
}

function clearPendingMutation() {
  uiState.pendingMutation = null;
}

function mutationVerb(mutation) {
  if (mutation?.operationKind === "connect") return "Connect";
  if (mutation?.operationKind === "re-seat") return "Re-seat";
  if (mutation?.operationKind === "disconnect") return "Disconnect";
  return "Place";
}

function renderMutationConfirmation() {
  const mutation = uiState.pendingMutation;
  if (!mutationConfirmation) return;
  mutationConfirmation.hidden = !mutation;
  if (!mutation) return;
  const project = mutation.candidateProject ?? currentProject();
  const verb = mutationVerb(mutation);
  mutationConfirmationTitle.textContent = `${verb} anyway? Electrical hazard detected`;
  mutationConfirmationSummary.textContent = `Mechanical fit is resolved, but ${mutation.electrical.hazards.length} new or worsened electrical hazard${mutation.electrical.hazards.length === 1 ? "" : "s"} would be added. The project and history remain unchanged until you confirm.`;
  mutationConfirmationEndpoints.innerHTML = mutation.exactEndpointPairs.length
    ? mutation.exactEndpointPairs.map((pair) => `
        <div>${escapeHtml(endpointLabel(project, pair.sourceEndpoint))} &harr; ${escapeHtml(endpointLabel(project, pair.targetEndpoint))}</div>
      `).join("")
    : `<div>No direct endpoint pair is staged.</div>`;
  mutationConfirmationHazards.innerHTML = mutation.electrical.hazards
    .map((issue) => `<li><strong>${escapeHtml(issue.code)}</strong>: ${escapeHtml(issue.message)}</li>`)
    .join("");
  confirmMutationButton.textContent = `${verb} anyway`;
}

function stagedMutationMessage(mutation) {
  if (mutation.operationKind === "connect") return "Wire connected";
  if (mutation.operationKind === "disconnect") return "Direct insertion disconnected";
  if (mutation.operationKind === "re-seat") return "Direct insertion re-seated";
  const count = mutation.exactEndpointPairs.length;
  return count ? `Component inserted into ${count} terminal${count === 1 ? "" : "s"}` : "Component updated";
}

function commitResolvedMutation(mutation, message = stagedMutationMessage(mutation)) {
  let committed;
  try {
    committed = commitStagedMutation(currentProject(), uiState.projectGeneration, mutation);
  } catch (error) {
    clearPendingMutation();
    refreshDerived();
    render();
    showStatus(`The physical connection could not be committed: ${error.message ?? "unknown commit failure"}. Nothing changed.`, 6200);
    announceInteraction(`Error. ${error.message ?? "The physical connection could not be committed"}. Nothing changed.`);
    return { committed: false, reason: "commit-failure", project: currentProject(), error };
  }
  if (!committed.ok) {
    clearPendingMutation();
    refreshDerived();
    render();
    const stale = committed.reason === "stale-generation" || committed.reason === "stale-base-project" || committed.reason === "stale-plan";
    showStatus(stale
      ? "The staged connection is stale because the project changed; nothing was committed."
      : "The physical connection could not be revalidated; nothing was committed.", 6200);
    announceInteraction(stale ? "Error. The staged connection is stale. Nothing changed." : "Error. The physical connection could not be revalidated. Nothing changed.");
    return { committed: false, reason: committed.reason, project: currentProject() };
  }
  if (mutation.operationKind === "connect") markWireHintComplete();
  const project = commitProject(committed.project, message);
  announceInteraction(`${message}.`);
  return { committed: true, reason: null, project };
}

function presentStagedMutation(mutation, options = {}) {
  clearPendingMutation();
  if (!mutation || mutation.status === "mechanically-impossible") {
    refreshDerived();
    render();
    showStatus(`Connection blocked: ${mutation?.mechanical?.message ?? "mechanically impossible"} No changes were made.`, 6200);
    announceInteraction(`Error. ${mutation?.mechanical?.message ?? "Mechanical placement is impossible"} No changes were made.`);
    return { committed: false, pending: false, blocked: true, project: currentProject(), mutation };
  }
  if (mutation.requiresConfirmation) {
    uiState.pendingMutation = mutation;
    refreshDerived();
    render();
    showStatus(`${mutationVerb(mutation)} is mechanically resolved but electrically hazardous; confirmation is required.`, 0);
    announceInteraction(`${mutationVerb(mutation)} target confirmed. Electrical hazard confirmation is required.`);
    return { committed: false, pending: true, blocked: false, project: currentProject(), mutation };
  }
  const committed = commitResolvedMutation(mutation, options.message ?? stagedMutationMessage(mutation));
  return { ...committed, pending: false, blocked: !committed.committed, mutation };
}

function cancelPendingMutation(message = "Staged connection canceled; no changes were made.") {
  if (!uiState.pendingMutation) return false;
  clearPendingMutation();
  refreshDerived();
  render();
  showStatus(message);
  announceInteraction("Cancellation confirmed. No changes were made.");
  return true;
}

function commitProject(project, message = "Circuit Lab updated", options = {}) {
  noteUserEdit(options);
  clearPendingMutation();
  commitHistory(history, normalizeProject(project));
  uiState.projectGeneration += 1;
  uiState.pendingEndpoint = null;
  uiState.wireDrag = null;
  uiState.placement = null;
  clearTargetingResolution();
  releaseAllMomentaryControls(uiState.controls);
  refreshDerived();
  render();
  showStatus(message);
  return currentProject();
}

function resetProject(project, message = "Circuit Lab reset", options = {}) {
  noteUserEdit(options);
  clearPendingMutation();
  resetHistory(history, normalizeProject(project));
  uiState.projectGeneration += 1;
  if (options.preserveBinding !== true) uiState.binding = normalizeMechatronicsBinding();
  uiState.pendingEndpoint = null;
  uiState.wireDrag = null;
  clearTargetingResolution();
  uiState.targeting.focusedEndpoint = null;
  uiState.targeting.focusSource = null;
  uiState.explicitSelectedComponentId = null;
  uiState.placement = null;
  if (options.preserveView !== true) {
    const nextView = defaultCameraForProject(project, (typeId) => catalog.getComponent(typeId));
    uiState.view.zoom = nextView.zoom;
    uiState.view.center = nextView.center;
    uiState.view.userAdjusted = false;
  }
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

function commitSelection(project, options = {}) {
  clearPendingMutation();
  replaceHistoryValue(history, normalizeProject(project));
  uiState.projectGeneration += 1;
  if (options.explicit !== false) uiState.explicitSelectedComponentId = normalizeProject(project).selectedComponentId;
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
  const accuracy = componentDef.geometryEvidence?.accuracyClass;
  label.textContent = accuracy === "approximate" ? `${component.name} · approximate geometry` : component.name;
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

function terminalGlyphKind(terminal, terminalVisual) {
  const connector = terminal.connectorInterface ?? "";
  if (connector.includes("breadboard")) return "breadboard-socket";
  if (connector.includes("female-controller") || terminalVisual?.emphasisShape === "socket") return "female-header";
  if (connector.includes("male-header")) return "male-pin";
  if (connector.includes("screw")) return "screw-cup";
  if (connector.includes("component-lead")) return "lead";
  if (connector.includes("lug")) return "lug";
  if (connector.includes("tab")) return "tab";
  if (connector.includes("pigtail") || connector.includes("jst") || connector.includes("coil-lead")) return "pigtail";
  return "contact-pad";
}

function terminalGlyphShapes(kind, width, height) {
  const halfWidth = Math.max(0.8, width / 2);
  const halfHeight = Math.max(0.8, height / 2);
  const radius = Math.max(0.7, Math.min(halfWidth, halfHeight));
  if (kind === "breadboard-socket") {
    return [
      svgElement("circle", { cx: 0, cy: 0, r: radius, class: "terminal-glyph__body" }),
      svgElement("circle", { cx: 0, cy: 0, r: radius * 0.42, class: "terminal-glyph__aperture" })
    ];
  }
  if (kind === "female-header") {
    return [
      svgElement("rect", { x: -halfWidth, y: -halfHeight, width: halfWidth * 2, height: halfHeight * 2, rx: 0.45, class: "terminal-glyph__body" }),
      svgElement("circle", { cx: 0, cy: 0, r: radius * 0.38, class: "terminal-glyph__aperture" })
    ];
  }
  if (kind === "male-pin") {
    return [
      svgElement("rect", { x: -halfWidth * 0.58, y: -halfHeight * 0.58, width: halfWidth * 1.16, height: halfHeight * 1.16, rx: 0.2, class: "terminal-glyph__pin" }),
      svgElement("rect", { x: -halfWidth, y: -halfHeight, width: halfWidth * 2, height: halfHeight * 2, rx: 0.3, class: "terminal-glyph__outline" })
    ];
  }
  if (kind === "screw-cup") {
    return [
      svgElement("circle", { cx: 0, cy: 0, r: radius, class: "terminal-glyph__metal" }),
      svgElement("line", { x1: -radius * 0.62, y1: radius * 0.62, x2: radius * 0.62, y2: -radius * 0.62, class: "terminal-glyph__slot" })
    ];
  }
  if (kind === "lead") {
    return [
      svgElement("line", { x1: -halfWidth, y1: 0, x2: halfWidth, y2: 0, class: "terminal-glyph__lead" }),
      svgElement("circle", { cx: 0, cy: 0, r: Math.min(radius, 1.05), class: "terminal-glyph__metal" })
    ];
  }
  if (kind === "lug") {
    return [
      svgElement("ellipse", { cx: 0, cy: 0, rx: halfWidth, ry: halfHeight, class: "terminal-glyph__metal" }),
      svgElement("circle", { cx: 0, cy: 0, r: radius * 0.35, class: "terminal-glyph__aperture" })
    ];
  }
  if (kind === "tab") {
    return [
      svgElement("rect", { x: -halfWidth, y: -halfHeight * 0.65, width: halfWidth * 2, height: halfHeight * 1.3, rx: 0.35, class: "terminal-glyph__metal" }),
      svgElement("circle", { cx: 0, cy: 0, r: radius * 0.28, class: "terminal-glyph__aperture" })
    ];
  }
  if (kind === "pigtail") {
    return [
      svgElement("line", { x1: -halfWidth, y1: 0, x2: halfWidth * 0.35, y2: 0, class: "terminal-glyph__lead" }),
      svgElement("circle", { cx: halfWidth * 0.45, cy: 0, r: Math.min(radius, 1.25), class: "terminal-glyph__body" })
    ];
  }
  return [svgElement("rect", {
    x: -halfWidth,
    y: -halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
    rx: Math.min(halfWidth, halfHeight) * 0.35,
    class: "terminal-glyph__body"
  })];
}

function renderTerminalGlyphs(project, highlightEndpointKeys, occupancyByEndpoint = new Map()) {
  const group = svgElement("g", {
    class: "bench-terminal-overlay",
    "data-bench-layer-content": "terminals",
    "aria-hidden": "true"
  });
  for (const component of project.components) {
    const definition = catalog.getComponent(component.typeId);
    if (!definition) continue;
    const visualDefinition = getVisualDefinition(component.typeId);
    for (const terminal of definition.terminals) {
      const endpointKey = `${component.id}:${terminal.id}`;
      const bounds = terminal.visibleBoundsMm ?? { width: 3.2, height: 3.2 };
      const worldPosition = terminalWorldPosition(component, terminal);
      const kind = terminalGlyphKind(terminal, visualDefinition?.terminalVisuals?.[terminal.id]);
      const terminalGroup = svgElement("g", {
        transform: `translate(${worldPosition[0]} ${worldPosition[1]}) rotate(${normalizeComponentRotation(component.rotation)}) scale(${componentScale(component)})`,
        class: [
          "terminal-glyph",
          `terminal-glyph--${kind}`,
          highlightEndpointKeys.has(endpointKey) ? "is-highlighted" : ""
        ].filter(Boolean).join(" "),
        "data-terminal-component": component.id,
        "data-terminal-id": terminal.id,
        "data-terminal-key": endpointKey,
        "data-kind": terminal.kind,
        "data-connector-glyph": kind,
        "data-terminal-aria-label": terminalAriaLabel(component, terminal)
      });
      terminalGroup.append(
        ...terminalGlyphShapes(kind, Number(bounds.width ?? 3.2), Number(bounds.height ?? 3.2)),
        svgElement("title", {}, [document.createTextNode(terminalTooltip(component, terminal, occupancyByEndpoint.get(endpointKey)))])
      );
      group.append(terminalGroup);
    }
  }
  return group;
}

function renderPhysicalPorts(componentDef) {
  return (componentDef.physicalPorts ?? []).map((port) => {
    const bounds = port.housingBoundsMm;
    return svgElement("rect", {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      rx: Math.min(1.1, bounds.width / 4, bounds.height / 4),
      class: `physical-port-housing ${port.keyed ? "is-keyed" : ""}`,
      "data-physical-port-id": port.id,
      "data-engineering-connector-id": port.engineeringConnectorId,
      "data-geometry-evidence-id": port.geometryEvidenceId,
      "aria-hidden": "true"
    }, [svgElement("title", {}, [document.createTextNode(`${port.id}: ${port.terminalIds.join(", ")}`)])]);
  });
}

function renderFormedLeads(componentDef) {
  return Object.entries(componentDef.formedLeadGeometry?.leadPathsMm ?? {}).map(([terminalId, points]) => (
    svgElement("polyline", {
      points: points.map((point) => `${point[0]},${point[1]}`).join(" "),
      class: "formed-component-lead",
      "data-formed-lead-terminal-id": terminalId,
      "aria-hidden": "true"
    })
  ));
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

function renderComponent(project, component, highlightComponentIds = new Set()) {
  const componentDef = catalog.getComponent(component.typeId);
  if (!componentDef) return null;
  const visualStatus = componentVisualStatus(componentDef);
  const scale = componentScale(component);
  const group = svgElement("g", {
    class: `bench-component ${component.id === project.selectedComponentId ? "is-selected" : ""} ${highlightComponentIds.has(component.id) ? "is-highlighted" : ""}`,
    "data-component-id": component.id,
    "data-visual-kind": visualStatus.assetKind,
    "data-geometry-accuracy": componentDef.geometryEvidence?.accuracyClass ?? "unclassified"
  });
  const artwork = svgElement("g", {
    class: "component-artwork",
    transform: `translate(${component.position[0]} ${component.position[1]}) rotate(${normalizeComponentRotation(component.rotation)}) scale(${scale})`,
    "data-component-id": component.id
  });
  artwork.append(componentHitbox(componentDef), ...componentArtwork(componentDef, component), ...renderFormedLeads(componentDef), ...renderPhysicalPorts(componentDef));
  group.append(artwork, componentLabel(component, componentDef));
  if (!visualStatus.ok) group.append(svgElement("title", {}, [document.createTextNode(fallbackVisualNotice(componentDef))]));
  if (component.id === project.selectedComponentId) group.append(selectionOverlay(component, componentDef));
  return group;
}

function renderWires(project, highlightConnectionIds) {
  const group = svgElement("g", { class: "bench-wires" });
  const staleInsertionIds = new Set(uiState.test.issues
    .filter((issue) => issue.code === "stale-direct-insertion")
    .flatMap((issue) => issue.connectionIds));
  for (const connection of project.connections) {
    const points = connection.endpoints
      .map((endpoint) => resolveTerminal(project, endpoint))
      .filter((terminal) => terminal.ok);
    if (points.length < 2) continue;
    if (!shouldRenderExternalWire(connection)) {
      if (staleInsertionIds.has(connection.id)) {
        for (let index = 1; index < points.length; index += 1) {
          group.append(svgElement("path", {
            d: wirePath(points[0].worldPosition, points[index].worldPosition),
            class: "wire-path wire-path--stale-insertion",
            "data-stale-insertion-id": connection.id
          }));
        }
      }
      continue;
    }
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
    "data-fitting-endpoint": descriptor.endpointKey,
    "data-fitting-port-id": descriptor.portId ?? "",
    "data-fitting-combined": descriptor.combined ? "true" : "false"
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
  const color = uiState.wireDrag.invalidReason ? "#dc2626" : target?.ok ? "#0ea5a4" : "#64748b";
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

function ensureBenchLayers() {
  if (benchLayers) return benchLayers;
  const background = svgElement("rect", {
    x: 0,
    y: 0,
    width: BENCH_WIDTH,
    height: BENCH_HEIGHT,
    fill: "transparent",
    class: "bench-pan-surface",
    "data-bench-layer": "background"
  });
  const committedWires = svgElement("g", {
    class: "bench-layer bench-layer--committed-wires",
    "data-bench-layer": "committed-wires"
  });
  const components = svgElement("g", {
    class: "bench-layer bench-layer--components",
    "data-bench-layer": "components"
  });
  const terminals = svgElement("g", {
    class: "bench-layer bench-layer--terminals",
    "data-bench-layer": "terminals",
    "aria-hidden": "true"
  });
  const transient = svgElement("g", {
    class: "bench-layer bench-layer--transient",
    "data-bench-layer": "transient",
    "aria-hidden": "true"
  });
  benchSvg.append(background, committedWires, components, terminals, transient);
  benchLayers = { background, committedWires, components, terminals, transient };
  return benchLayers;
}

function activeBenchHighlights() {
  const selectedIssue = uiState.selectedIssueId
    ? uiState.test.issues.find((issue) => issue.id === uiState.selectedIssueId)
    : null;
  const selectedEndpointKeys = new Set(
    (selectedIssue?.targets?.terminalRefs ?? []).map((endpoint) => `${endpoint.componentId}:${endpoint.terminalId}`)
  );
  const selectedConnectionIds = new Set(selectedIssue?.targets?.connectionIds ?? []);
  const selectedComponentIds = new Set(selectedIssue?.targets?.componentIds ?? []);
  const highlights = selectedIssue
    ? uiState.test.highlights.filter((item) => (
      (item.endpoint && selectedEndpointKeys.has(`${item.endpoint.componentId}:${item.endpoint.terminalId}`))
      || (item.connectionId && selectedConnectionIds.has(item.connectionId))
      || (item.componentId && selectedComponentIds.has(item.componentId))
    ))
    : uiState.test.highlights;
  return {
    endpointKeys: new Set(highlights.filter((item) => item.type === "endpoint").map((item) => `${item.endpoint.componentId}:${item.endpoint.terminalId}`)),
    connectionIds: new Set(highlights.filter((item) => item.type === "connection").map((item) => item.connectionId)),
    componentIds: new Set(highlights.filter((item) => item.type === "component").map((item) => item.componentId))
  };
}

function renderStableBench() {
  const project = currentProject();
  const occupancy = derivePhysicalOccupancy(project);
  const layers = ensureBenchLayers();
  renderBenchView();
  const highlights = activeBenchHighlights();
  layers.committedWires.replaceChildren(
    renderWires(project, highlights.connectionIds),
    renderConnectionFittings(project, highlights.connectionIds)
  );
  layers.components.replaceChildren();
  for (const component of project.components) {
    const rendered = renderComponent(project, component, highlights.componentIds);
    if (rendered) layers.components.append(rendered);
  }
  layers.terminals.replaceChildren(renderTerminalGlyphs(project, highlights.endpointKeys, occupancy.occupancyByEndpoint));
  projectedTerminalResolver.invalidate("stable-bench-geometry");
  cycle3Diagnostics.stableBenchRenderCount += 1;
}

function cssPixelsToWorld(pixels) {
  const matrix = benchSvg.getScreenCTM();
  if (!matrix) return Number(pixels);
  const xScale = Math.hypot(Number(matrix.a), Number(matrix.b));
  const yScale = Math.hypot(Number(matrix.c), Number(matrix.d));
  const scale = Math.max(0.0001, (xScale + yScale) / 2);
  return Number(pixels) / scale;
}

function targetRecordForDisplay() {
  if (uiState.targeting.resolution?.target) return uiState.targeting.resolution.target;
  const endpoint = uiState.targeting.focusedEndpoint ?? uiState.pendingEndpoint;
  return endpoint ? projectedTerminalResolver.resolveEndpoint(endpoint, currentProject()) : null;
}

function syncActiveTerminalProxy() {
  if (!activeTerminalProxy) return;
  const target = targetRecordForDisplay();
  if (!target) {
    activeTerminalProxy.textContent = "No terminal focused";
    activeTerminalProxy.setAttribute("aria-label", "No terminal focused");
    activeTerminalProxy.removeAttribute("data-endpoint-key");
    return;
  }
  const blocked = target.invalidReason ? ` Blocked: ${target.invalidReason}` : " Available.";
  const label = `${target.terminalAriaLabel}. ${target.capacityUsed} of ${target.capacity} attachments used.${blocked}`;
  activeTerminalProxy.textContent = label;
  activeTerminalProxy.setAttribute("aria-label", label);
  activeTerminalProxy.dataset.endpointKey = target.endpointKey;
}

function renderTargetingOverlay() {
  const record = targetRecordForDisplay();
  if (!record) return null;
  const resolution = uiState.targeting.resolution;
  const profile = terminalPointerProfile(resolution?.pointerType ?? uiState.targeting.pointerType);
  const haloRadius = cssPixelsToWorld(resolution?.radiusPx ?? profile.radiusPx);
  const crosshairRadius = cssPixelsToWorld(5);
  const group = svgElement("g", {
    class: [
      "bench-targeting-overlay",
      record.invalidReason ? "is-invalid" : "is-valid",
      resolution?.ambiguous ? "is-ambiguous" : ""
    ].filter(Boolean).join(" "),
    "data-target-endpoint": record.endpointKey
  });
  group.append(
    svgElement("circle", {
      cx: record.svgPoint[0],
      cy: record.svgPoint[1],
      r: haloRadius,
      class: "terminal-acquisition-halo"
    }),
    svgElement("path", {
      d: `M ${record.svgPoint[0] - crosshairRadius} ${record.svgPoint[1]} L ${record.svgPoint[0] + crosshairRadius} ${record.svgPoint[1]} M ${record.svgPoint[0]} ${record.svgPoint[1] - crosshairRadius} L ${record.svgPoint[0]} ${record.svgPoint[1] + crosshairRadius}`,
      class: "terminal-exact-crosshair"
    })
  );
  if (resolution?.ambiguous) {
    for (const candidate of resolution.candidates.slice(0, 4)) {
      group.append(svgElement("circle", {
        cx: candidate.svgPoint[0],
        cy: candidate.svgPoint[1],
        r: cssPixelsToWorld(3.5),
        class: "terminal-ambiguity-marker",
        "data-ambiguity-endpoint": candidate.endpointKey
      }));
    }
  }
  return group;
}

function renderComponentGhost() {
  const previewProject = pointerInteraction?.previewProject ?? uiState.placement?.previewProject;
  if (!previewProject) return null;
  const componentId = pointerInteraction?.componentId ?? uiState.placement?.componentId;
  const component = previewProject.components.find((item) => item.id === componentId);
  if (!component) return null;
  const ghost = renderComponent(previewProject, component, new Set());
  if (!ghost) return null;
  ghost.classList.add("bench-component--ghost");
  ghost.dataset.placementPreviewComponentId = componentId;
  ghost.removeAttribute("data-component-id");
  return ghost;
}

function activePlacementPreview() {
  if (pointerInteraction?.previewMutation || pointerInteraction?.previewProject) {
    return {
      componentId: pointerInteraction.componentId,
      project: pointerInteraction.previewProject,
      mutation: pointerInteraction.previewMutation
    };
  }
  if (uiState.placement) {
    return {
      componentId: uiState.placement.componentId,
      project: uiState.placement.previewProject,
      mutation: uiState.placement.mutation
    };
  }
  return null;
}

function placementStatus(mutation) {
  if (!mutation || mutation.status === "mechanically-impossible") {
    return { key: "blocked", label: "Blocked", detail: mutation?.mechanical?.message ?? "Mechanical placement is impossible." };
  }
  if (mutation.requiresConfirmation) {
    return { key: "hazard", label: "Electrical hazard", detail: "Mechanical fit resolved; confirmation is required." };
  }
  return { key: "safe", label: "Mechanically valid", detail: mutation.exactEndpointPairs.length ? "All physical contacts match." : "Free placement is available." };
}

function renderPlacementPreviewOverlay() {
  const preview = activePlacementPreview();
  if (!preview?.project) return null;
  const component = preview.project.components.find((item) => item.id === preview.componentId);
  const definition = component ? catalog.getComponent(component.typeId) : null;
  if (!component || !definition) return null;
  const status = placementStatus(preview.mutation);
  const bounds = componentBounds(component, definition);
  const group = svgElement("g", {
    class: `placement-preview placement-preview--${status.key}`,
    "data-placement-status": status.key,
    "aria-hidden": "true"
  });
  group.append(svgElement("rect", {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
    rx: 4,
    class: "placement-preview__bounds",
    "data-placement-preview-bounds": component.id,
    "data-placement-preview-shape": status.key
  }));
  for (const pair of preview.mutation?.exactEndpointPairs ?? []) {
    const source = resolveTerminal(preview.project, pair.sourceEndpoint);
    const target = resolveTerminal(preview.project, pair.targetEndpoint);
    if (!source.ok || !target.ok) continue;
    group.append(
      svgElement("line", {
        x1: source.worldPosition[0],
        y1: source.worldPosition[1],
        x2: target.worldPosition[0],
        y2: target.worldPosition[1],
        class: "placement-preview__match"
      }),
      svgElement("circle", { cx: source.worldPosition[0], cy: source.worldPosition[1], r: 3, class: "placement-preview__contact" }),
      svgElement("circle", { cx: target.worldPosition[0], cy: target.worldPosition[1], r: 3, class: "placement-preview__contact" })
    );
  }
  const labelWidth = Math.max(92, Math.min(190, status.label.length * 7.2 + 24));
  group.append(
    svgElement("rect", {
      x: bounds.left,
      y: Math.max(8, bounds.top - 24),
      width: labelWidth,
      height: 18,
      rx: 3,
      class: "placement-preview__status-box"
    }),
    svgElement("text", {
      x: bounds.left + 7,
      y: Math.max(8, bounds.top - 24) + 12.5,
      class: "placement-preview__status-text"
    }, [document.createTextNode(status.label)])
  );
  return group;
}

function renderTransientLayer() {
  const layers = ensureBenchLayers();
  const project = currentProject();
  const children = [];
  const preview = renderWirePreview(project);
  if (preview) children.push(preview);
  const ghost = renderComponentGhost();
  if (ghost) children.push(ghost);
  const placementPreview = renderPlacementPreviewOverlay();
  if (placementPreview) children.push(placementPreview);
  const targeting = renderTargetingOverlay();
  if (targeting) children.push(targeting);
  layers.transient.replaceChildren(...children);
  renderPrecisionHud();
  syncActiveTerminalProxy();
  cycle3Diagnostics.transientRenderCount += 1;
}

function renderBench() {
  renderStableBench();
  renderTransientLayer();
}

function precisionClusterMarkup(target, candidates) {
  const nearby = (candidates?.length ? candidates : [target]).slice(0, 12);
  const size = 112;
  const center = size / 2;
  const scale = 2.4;
  const points = nearby.map((candidate) => {
    const dx = (candidate.screenPoint?.[0] ?? target.screenPoint?.[0] ?? 0) - (target.screenPoint?.[0] ?? 0);
    const dy = (candidate.screenPoint?.[1] ?? target.screenPoint?.[1] ?? 0) - (target.screenPoint?.[1] ?? 0);
    const x = Math.min(size - 8, Math.max(8, center + dx * scale));
    const y = Math.min(size - 8, Math.max(8, center + dy * scale));
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${candidate.endpointKey === target.endpointKey ? 5 : 3.2}" class="${candidate.endpointKey === target.endpointKey ? "is-target" : ""}" />`;
  }).join("");
  return `
    <svg class="circuit-precision-hud__cluster" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="4" />
      ${points}
      <path d="M ${center - 9} ${center} H ${center + 9} M ${center} ${center - 9} V ${center + 9}" />
    </svg>`;
}

function renderPrecisionHud() {
  if (!precisionHud) return;
  const project = currentProject();
  const resolution = uiState.targeting.resolution;
  const target = targetRecordForDisplay();
  const allowedContext = project.mode === "wire"
    || project.mode === "place"
    || Boolean(uiState.targeting.focusedEndpoint)
    || Boolean(resolution?.ambiguous);
  precisionHud.hidden = !target || !allowedContext || Boolean(uiState.pendingMutation);
  if (precisionHud.hidden) {
    precisionHud.replaceChildren();
    return;
  }

  const invalidReason = target.invalidReason;
  const candidates = resolution?.nearbyCandidates ?? [target];
  const ambiguityCandidates = resolution?.candidates ?? [];
  const chooser = resolution?.ambiguous
    ? `
      <div class="circuit-precision-hud__chooser" role="group" aria-label="Ambiguous terminal candidates">
        <strong>${formatCount(resolution.ambiguityCount, "contact")} ${resolution.ambiguityCount === 1 ? "is" : "are"} within the ${escapeHtml(resolution.pointerType)} precision band</strong>
        ${ambiguityCandidates.slice(0, 4).map((candidate) => `
          <button type="button" data-precision-candidate="${escapeHtml(candidate.endpointKey)}" aria-label="Choose ${escapeHtml(candidate.terminalAriaLabel)}">
            <span>${escapeHtml(candidate.componentLabel)} / ${escapeHtml(candidate.terminalLabel)}</span>
            <small>${escapeHtml(candidate.terminalId)} / ${candidate.capacityUsed}/${candidate.capacity}${candidate.invalidReason ? ` / blocked` : ""}</small>
          </button>
        `).join("")}
        ${resolution.ambiguityCount > 4 ? `
          <div class="circuit-precision-hud__zoom-actions">
            <button type="button" data-precision-action="frame-port">Frame port</button>
            <button type="button" data-precision-action="add-zoom">Add zoom</button>
          </div>
        ` : ""}
      </div>
    `
    : "";
  precisionHud.dataset.endpointKey = target.endpointKey;
  precisionHud.dataset.invalid = invalidReason ? "true" : "false";
  precisionHud.innerHTML = `
    <div class="circuit-precision-hud__header">
      <div>
        <span class="circuit-precision-hud__eyebrow">${resolution?.ambiguous ? "Ambiguous precision target" : "Exact precision target"}</span>
        <strong>${escapeHtml(target.componentLabel)} / ${escapeHtml(target.terminalLabel)}</strong>
      </div>
      <span class="circuit-precision-hud__state ${invalidReason ? "is-invalid" : "is-valid"}">${invalidReason ? "Blocked" : "Available"}</span>
    </div>
    <div class="circuit-precision-hud__body">
      ${precisionClusterMarkup(target, candidates)}
      <dl>
        <div><dt>Terminal</dt><dd>${escapeHtml(target.terminalId)}</dd></div>
        <div><dt>Physical port</dt><dd>${escapeHtml(target.physicalPortLabel)} / ${escapeHtml(target.contactPosition)}</dd></div>
        <div><dt>Connector</dt><dd>${escapeHtml(target.connectorType)}</dd></div>
        <div><dt>Role / voltage</dt><dd>${escapeHtml(target.electricalRole)} / ${escapeHtml(target.voltageDomainId)}</dd></div>
        <div><dt>Occupancy</dt><dd>${target.capacityUsed}/${target.capacity}</dd></div>
        <div><dt>Position</dt><dd>${target.svgPoint[0].toFixed(2)}, ${target.svgPoint[1].toFixed(2)} mm</dd></div>
        <div><dt>Geometry</dt><dd>${escapeHtml(target.geometryAccuracy)}</dd></div>
      </dl>
    </div>
    ${invalidReason ? `<p class="circuit-precision-hud__reason"><strong>Cannot connect:</strong> ${escapeHtml(invalidReason)}</p>` : ""}
    ${chooser}
  `;
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
  const itemMarkup = (item) => {
    const accuracyClass = item.geometryEvidence?.accuracyClass;
    const accuracyLabel = accuracyClass === "approximate"
      ? "approximate geometry"
      : accuracyClass === "representative-nominal"
        ? "representative geometry"
        : accuracyClass === "exact-model-verified"
          ? "verified geometry"
          : "";
    return `
    <article class="hardware-item ${item.custom?.localOnly ? "hardware-item--custom" : ""}" draggable="true" data-hardware-item="${escapeHtml(item.id)}">
      <span class="hardware-swatch" style="background:${escapeHtml(componentColor(item))}"></span>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.category)} / ${item.terminals.length} terminals${item.custom?.localOnly ? " / local" : ""}</span>
        ${accuracyLabel ? `<span class="hardware-geometry-class hardware-geometry-class--${escapeHtml(accuracyClass)}">${escapeHtml(accuracyLabel)}</span>` : ""}
      </div>
      <div class="hardware-item__actions">
        <button type="button" data-add-hardware="${escapeHtml(item.id)}">Add</button>
        ${item.custom?.localOnly ? `<button type="button" data-edit-custom-component="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)} metadata">Edit</button>` : ""}
        ${item.custom?.localOnly ? `<button type="button" data-delete-custom-component="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button>` : ""}
      </div>
    </article>
  `;
  };
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
        <span>${escapeHtml(connection.kind ?? "wire")}</span>
        <button type="button" data-remove-connection="${escapeHtml(connection.id)}">${connection.kind === "direct-insertion" ? "Disconnect" : "Remove"}</button>
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
      <strong class="test-item__title">${escapeHtml(item.severity.toUpperCase())} / ${escapeHtml(item.domain)} / ${escapeHtml(item.code)}</strong>
      <span class="test-item__message">${escapeHtml(item.message)}</span>
      ${item.fix ? `<span class="test-item__fix">${escapeHtml(item.fix)}</span>` : ""}
      ${item.code === "stale-direct-insertion" ? `
        <div class="test-item__actions">
          <button type="button" data-stale-action="re-seat" ${item.componentId ? "" : "disabled"}>Re-seat</button>
          <button type="button" data-stale-action="disconnect">Disconnect</button>
        </div>
      ` : ""}
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
    const active = button.dataset.circuitTab === uiState.activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }
  const visibleByTab = {
    inspect: new Set(["circuit-inspector-card", "circuit-wires-card"]),
    "test-results": new Set(["circuit-test-card", "circuit-bringup-card"]),
    bind: new Set(["circuit-binding-card"]),
    build: new Set(["circuit-build-card", "circuit-source-card"])
  };
  const visible = visibleByTab[uiState.activeTab] ?? visibleByTab.inspect;
  for (const card of document.querySelectorAll(".circuit-panel--right [data-card-id]")) {
    card.hidden = !visible.has(card.dataset.cardId);
  }
  const activeButton = tabButtons.find((button) => button.dataset.circuitTab === uiState.activeTab);
  if (workflowPanel && activeButton) workflowPanel.setAttribute("aria-labelledby", activeButton.id);
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
    const active = button.dataset.circuitMode === project.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function renderWireStatus(project) {
  if (uiState.placement) {
    const status = placementStatus(uiState.placement.mutation);
    wireStatus.textContent = `Place ${uiState.placement.name}: ${status.label}. ${status.detail}`;
  } else if (uiState.wireDrag) {
    const target = uiState.wireDrag.targetEndpoint ? endpointLabel(project, uiState.wireDrag.targetEndpoint) : "a terminal";
    if (uiState.wireDrag.invalidReason) wireStatus.textContent = `Wire target ${target} is blocked: ${uiState.wireDrag.invalidReason}`;
    else if (uiState.wireDrag.ambiguous) wireStatus.textContent = `Wire target overlaps multiple contacts near ${target}; release, then choose the exact terminal.`;
    else wireStatus.textContent = `Wire drag: release on ${target}.`;
  } else if (uiState.pendingEndpoint) {
    wireStatus.textContent = `Wire start: ${endpointLabel(project, uiState.pendingEndpoint)}. Click a second terminal.`;
  } else if (project.mode === "wire") {
    wireStatus.textContent = uiState.wireHintDismissed
      ? "Wire mode: drag from one terminal to another, or click two terminals."
      : "First Wire: choose an exact terminal, then choose its destination. The hint dismisses after a successful connection.";
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
  renderMutationConfirmation();
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

function addHardwareImmediate(typeId, options = {}) {
  const base = currentProject();
  const definition = catalog.getComponent(typeId);
  const requestedPosition = Array.isArray(options.position) && definition
    ? clampComponentPosition({ position: options.position, props: options.props ?? {} }, definition, options.position)
    : options.position;
  const next = addComponent(base, typeId, { ...options, position: requestedPosition });
  const componentId = next.selectedComponentId;
  const name = catalog.getComponent(typeId)?.name ?? typeId;
  if (!componentId) return commitProject(next, `${name} added`);
  const mutation = stageInsertionMutation(base, next, componentId, uiState.projectGeneration, { operationKind: "place" });
  return presentStagedMutation(mutation, { message: mutation.exactEndpointPairs.length ? `${name} inserted` : `${name} added` }).project;
}

function setPlacementMode() {
  noteUserEdit();
  const project = currentProject();
  if (project.mode === "place") return project;
  clearPendingMutation();
  renderMutationConfirmation();
  const next = setProjectMode(project, "place");
  replaceHistoryValue(history, next);
  uiState.projectGeneration += 1;
  renderModeButtons(next);
  renderWireStatus(next);
  return currentProject();
}

function buildNewPlacementPreview(point) {
  const placement = uiState.placement;
  if (!placement) return null;
  const definition = catalog.getComponent(placement.typeId);
  if (!definition) return null;
  const position = clampComponentPosition({ position: point, props: placement.props }, definition, point);
  const proposed = addComponent(placement.baseProject, placement.typeId, {
    id: placement.componentId,
    name: placement.name,
    props: placement.props,
    position
  });
  const mutation = stageInsertionMutation(
    placement.baseProject,
    proposed,
    placement.componentId,
    placement.baseGeneration,
    { operationKind: "place" }
  );
  placement.point = position;
  placement.mutation = mutation;
  placement.previewProject = mutation.candidateProject ?? proposed;
  return placement;
}

function beginPlacement(typeId, options = {}) {
  const definition = catalog.getComponent(typeId);
  if (!definition) throw new Error(`Unknown Circuit Lab component: ${typeId}`);
  if (uiState.placement) cancelPlacement("Previous placement canceled.", { announce: false });
  const baseProject = setPlacementMode();
  const seed = addComponent(baseProject, typeId, {
    name: options.name,
    props: options.props,
    position: options.position ?? uiState.view.center
  });
  uiState.placement = {
    typeId,
    componentId: seed.selectedComponentId,
    name: options.name ?? definition.name,
    props: options.props ?? {},
    source: options.source ?? "hardware-card",
    nativeDrag: Boolean(options.nativeDrag),
    baseProject,
    baseGeneration: uiState.projectGeneration,
    point: options.position ?? uiState.view.center,
    pendingPoint: null,
    mutation: null,
    previewProject: null
  };
  buildNewPlacementPreview(uiState.placement.point);
  if (
    drawerMediaQuery.matches
    && uiState.openDrawer === "hardware"
    && ["hardware-card", "hardware-drag", "hardware-drop"].includes(uiState.placement.source)
  ) {
    closeOpenDrawer({ restoreFocus: false });
  }
  renderTransientLayer();
  renderWireStatus(baseProject);
  benchSvg.focus({ preventScroll: true });
  announceInteraction(`${definition.name} placement started. Move the ghost, then press Enter or tap the bench to place it.`);
  return uiState.placement;
}

function updatePlacementAtPoint(point) {
  if (!uiState.placement) return null;
  buildNewPlacementPreview(point);
  const status = placementStatus(uiState.placement.mutation);
  wireStatus.textContent = `Place ${uiState.placement.name}: ${status.label}. ${status.detail}`;
  return uiState.placement;
}

function schedulePlacementAtPoint(point) {
  if (!uiState.placement) return;
  uiState.placement.pendingPoint = point;
  schedulePointerFrame();
}

function flushPlacementPreview() {
  const point = uiState.placement?.pendingPoint;
  if (!uiState.placement || !point) return;
  uiState.placement.pendingPoint = null;
  updatePlacementAtPoint(point);
}

function commitPlacement() {
  const placement = uiState.placement;
  if (!placement?.mutation) return { committed: false, pending: false, blocked: true };
  if (placement.mutation.status === "mechanically-impossible") {
    const status = placementStatus(placement.mutation);
    showStatus(`Placement blocked: ${status.detail} No changes were made.`, 6200);
    announceInteraction(`Error. ${status.detail} No changes were made.`);
    renderTransientLayer();
    return { committed: false, pending: false, blocked: true, mutation: placement.mutation };
  }
  const mutation = placement.mutation;
  const componentId = placement.componentId;
  const name = placement.name;
  uiState.placement = null;
  uiState.explicitSelectedComponentId = componentId;
  renderTransientLayer();
  return presentStagedMutation(mutation, {
    message: mutation.exactEndpointPairs.length ? `${name} inserted` : `${name} added`
  });
}

function cancelPlacement(message = "Placement canceled; no component was added.", options = {}) {
  if (!uiState.placement) return false;
  uiState.placement = null;
  pendingTargetPointer = null;
  renderWireStatus(currentProject());
  renderTransientLayer();
  showStatus(message);
  if (options.announce !== false) announceInteraction("Placement canceled. No component was added and history was unchanged.");
  return true;
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
  benchPanInteraction.pendingClientPoint = [event.clientX, event.clientY];
  schedulePointerFrame();
  event.preventDefault();
}

function finishBenchPanInteraction(event) {
  if (!benchPanInteraction || event.pointerId !== benchPanInteraction.pointerId) return;
  flushPointerFrameNow();
  const moved = benchPanInteraction.moved;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  benchPanInteraction = null;
  suppressNextBenchClick = moved;
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
  renderTransientLayer();
  if (moved) event.preventDefault();
}

function cancelBenchPanInteraction(event) {
  if (!benchPanInteraction || event.pointerId !== benchPanInteraction.pointerId) return;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  benchPanInteraction = null;
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
  renderTransientLayer();
}

function endpointKeyValue(endpoint) {
  return endpoint ? `${endpoint.componentId}:${endpoint.terminalId}` : "";
}

function candidateWithInteractionValidity(candidate, startEndpoint = null) {
  if (!candidate) return candidate;
  const sameEndpoint = startEndpoint && candidate.endpointKey === endpointKeyValue(startEndpoint);
  return {
    ...candidate,
    invalidReason: sameEndpoint
      ? `Choose a different terminal; ${candidate.componentId}.${candidate.terminalId} is already the wire start.`
      : candidate.invalidReason
  };
}

function resolutionWithInteractionValidity(result, startEndpoint = null) {
  if (!result) return null;
  const nearbyCandidates = result.nearbyCandidates.map((candidate) => candidateWithInteractionValidity(candidate, startEndpoint));
  const byKey = new Map(nearbyCandidates.map((candidate) => [candidate.endpointKey, candidate]));
  return {
    ...result,
    target: result.target ? byKey.get(result.target.endpointKey) ?? candidateWithInteractionValidity(result.target, startEndpoint) : null,
    candidates: result.candidates.map((candidate) => byKey.get(candidate.endpointKey) ?? candidateWithInteractionValidity(candidate, startEndpoint)),
    nearbyCandidates
  };
}

function resolveTerminalAtClientPoint(clientPoint, pointerType = "mouse", startEndpoint = null) {
  const result = projectedTerminalResolver.resolve(clientPoint, {
    pointerType,
    lockedEndpointKey: uiState.targeting.lockedEndpointKey
  }, currentProject());
  return resolutionWithInteractionValidity(result, startEndpoint);
}

function setTargetingResolution(result, options = {}) {
  uiState.targeting.resolution = result;
  if (result?.target && !result.ambiguous) uiState.targeting.lockedEndpointKey = result.target.endpointKey;
  if (options.clientPoint) uiState.targeting.lastClientPoint = [...options.clientPoint];
  if (options.pointerType) uiState.targeting.pointerType = options.pointerType;
  if (Object.hasOwn(options, "ambiguityAction")) uiState.targeting.ambiguityAction = options.ambiguityAction;
  return result;
}

function clearTargetingResolution(options = {}) {
  uiState.targeting.resolution = null;
  uiState.targeting.ambiguityAction = null;
  uiState.targeting.lockedEndpointKey = null;
  if (options.keepPointer !== true) uiState.targeting.lastClientPoint = null;
}

function refreshTargetResolutionFromLastPoint() {
  const clientPoint = uiState.targeting.lastClientPoint;
  if (!clientPoint) {
    const endpoint = uiState.targeting.focusedEndpoint ?? uiState.pendingEndpoint;
    const projected = endpoint ? projectedTerminalResolver.resolveEndpoint(endpoint, currentProject()) : null;
    if (!projected) return null;
    uiState.targeting.resolution = {
      pointerType: uiState.targeting.pointerType,
      ...terminalPointerProfile(uiState.targeting.pointerType),
      target: projected,
      candidates: [projected],
      nearbyCandidates: [projected],
      ambiguous: false,
      ambiguityCount: 1
    };
    return uiState.targeting.resolution;
  }
  const startEndpoint = wireInteraction?.startEndpoint ?? uiState.pendingEndpoint;
  const result = resolveTerminalAtClientPoint(clientPoint, uiState.targeting.pointerType, startEndpoint);
  setTargetingResolution(result, { clientPoint, pointerType: uiState.targeting.pointerType });
  return result;
}

function renderInteractionPreview(project) {
  if (!pointerInteraction) return;
  const proposed = normalizeProject(project);
  pointerInteraction.proposedProject = proposed;
  const mutation = stageInsertionMutation(
    pointerInteraction.startProject,
    proposed,
    pointerInteraction.componentId,
    pointerInteraction.baseGeneration,
    { operationKind: "place" }
  );
  pointerInteraction.previewMutation = mutation;
  pointerInteraction.previewProject = mutation.candidateProject ?? proposed;
  const status = placementStatus(mutation);
  wireStatus.textContent = `${pointerInteraction.kind === "resize" ? "Resize" : "Move"} ${pointerInteraction.component.name}: ${status.label}. ${status.detail}`;
}

function flushWirePointerPreview() {
  const pending = wireInteraction?.pendingPointer;
  if (!wireInteraction || !pending) return;
  wireInteraction.pendingPointer = null;
  const result = resolveTerminalAtClientPoint(
    pending.clientPoint,
    pending.pointerType,
    wireInteraction.startEndpoint
  );
  setTargetingResolution(result, {
    clientPoint: pending.clientPoint,
    pointerType: pending.pointerType
  });
  wireInteraction.currentPoint = pending.worldPoint;
  wireInteraction.targetResolution = result;
  wireInteraction.targetEndpoint = result?.target?.endpoint ?? null;
  wireInteraction.invalidReason = result?.target?.invalidReason ?? null;
  uiState.pendingEndpoint = wireInteraction.startEndpoint;
  uiState.wireDrag = {
    startEndpoint: wireInteraction.startEndpoint,
    currentPoint: pending.worldPoint,
    targetEndpoint: wireInteraction.targetEndpoint,
    invalidReason: wireInteraction.invalidReason,
    ambiguous: Boolean(result?.ambiguous)
  };
  renderWireStatus(currentProject());
}

function flushBenchPanPreview() {
  const clientPoint = benchPanInteraction?.pendingClientPoint;
  if (!benchPanInteraction || !clientPoint) return;
  benchPanInteraction.pendingClientPoint = null;
  const dxClient = clientPoint[0] - benchPanInteraction.startClientX;
  const dyClient = clientPoint[1] - benchPanInteraction.startClientY;
  const [, , viewWidth, viewHeight] = benchPanInteraction.startViewBox;
  const dxWorld = dxClient * viewWidth / benchPanInteraction.svgWidth;
  const dyWorld = dyClient * viewHeight / benchPanInteraction.svgHeight;
  uiState.view.center = clampBenchViewCenter([
    benchPanInteraction.startCenter[0] - dxWorld,
    benchPanInteraction.startCenter[1] - dyWorld
  ], uiState.view.zoom);
  uiState.view.userAdjusted = true;
  if (!storageHydrationFinished) uiState.view.userAdjustedBeforeHydration = true;
  renderBenchView();
  refreshTargetResolutionFromLastPoint();
}

function flushPassiveTargetPreview() {
  if (wireInteraction || !pendingTargetPointer) return;
  const pending = pendingTargetPointer;
  pendingTargetPointer = null;
  const startEndpoint = uiState.pendingEndpoint;
  const result = resolveTerminalAtClientPoint(pending.clientPoint, pending.pointerType, startEndpoint);
  setTargetingResolution(result, {
    clientPoint: pending.clientPoint,
    pointerType: pending.pointerType
  });
}

function schedulePointerFrame() {
  if (previewAnimationFrame) return;
  previewAnimationFrame = window.requestAnimationFrame(() => {
    previewAnimationFrame = 0;
    if (pendingPreviewProject) {
      renderInteractionPreview(pendingPreviewProject);
      pendingPreviewProject = null;
    }
    flushBenchPanPreview();
    flushWirePointerPreview();
    flushPlacementPreview();
    flushPassiveTargetPreview();
    renderTransientLayer();
    cycle3Diagnostics.pointerFrameCount += 1;
  });
}

function flushPointerFrameNow() {
  if (previewAnimationFrame) {
    window.cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = 0;
  }
  if (pendingPreviewProject) {
    renderInteractionPreview(pendingPreviewProject);
    pendingPreviewProject = null;
  }
  flushBenchPanPreview();
  flushWirePointerPreview();
  flushPlacementPreview();
  flushPassiveTargetPreview();
  renderTransientLayer();
}

function scheduleInteractionPreview(project) {
  pendingPreviewProject = project;
  schedulePointerFrame();
}

function beginComponentInteraction(event, componentId, kind) {
  cancelPendingMutation("Previous staged connection canceled.");
  const project = currentProject();
  const startProject = project;
  const component = startProject.components.find((item) => item.id === componentId);
  const definition = component ? catalog.getComponent(component.typeId) : null;
  if (!component || !definition) return;
  pointerInteraction = {
    pointerId: event.pointerId,
    kind,
    componentId,
    definition,
    component,
    startProject,
    baseGeneration: uiState.projectGeneration,
    startPoint: benchPointFromEvent(event),
    previewProject: null,
    proposedProject: null,
    previewMutation: null,
    moved: false
  };
  uiState.pendingEndpoint = null;
  clearTargetingResolution();
  renderTransientLayer();
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
  const finalProject = pointerInteraction.proposedProject ?? pointerInteraction.startProject;
  const startProject = pointerInteraction.startProject;
  const componentId = pointerInteraction.componentId;
  const baseGeneration = pointerInteraction.baseGeneration;
  const message = pointerInteraction.kind === "resize" ? "Component resized" : "Component moved";
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  pointerInteraction = null;
  suppressNextBenchClick = moved;
  if (!moved) return;
  const mutation = stageInsertionMutation(startProject, finalProject, componentId, baseGeneration, {
    operationKind: "place"
  });
  presentStagedMutation(mutation, { message });
}

function cancelComponentInteraction(event) {
  if (!pointerInteraction || event.pointerId !== pointerInteraction.pointerId) return;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  pointerInteraction = null;
  pendingPreviewProject = null;
  suppressNextBenchClick = true;
  if (previewAnimationFrame) {
    window.cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = 0;
  }
  renderWireStatus(currentProject());
  renderTransientLayer();
  showStatus("Pointer interaction canceled; no staged connection was committed.");
  announceInteraction("Component move canceled. Transform, connections, generation, and history are unchanged.");
}

function requestWireConnection(endpointA, endpointB, options = {}) {
  const project = currentProject();
  announceInteraction(`Confirmed target ${endpointLabel(project, endpointB)}.`);
  try {
    const mutation = stageWireMutation(project, endpointA, endpointB, uiState.projectGeneration, {
      name: options.name ?? `${endpointLabel(project, endpointA)} to ${endpointLabel(project, endpointB)}`,
      color: options.color
    });
    return presentStagedMutation(mutation, { message: "Wire connected" });
  } catch (error) {
    clearPendingMutation();
    renderTransientLayer();
    showStatus(`Connection blocked: ${error.message ?? "the endpoints could not be committed"}. No changes were made.`, 6200);
    announceInteraction(`Error. ${error.message ?? "The endpoints could not be committed"}. No changes were made.`);
    return { committed: false, pending: false, blocked: true, project, mutation: null, error };
  }
}

function beginWireInteraction(event, resolution) {
  cancelPendingMutation("Previous staged connection canceled.");
  const target = resolution?.target;
  if (!target) return false;
  setTargetingResolution(resolution, {
    clientPoint: [event.clientX, event.clientY],
    pointerType: event.pointerType || "mouse",
    ambiguityAction: resolution.ambiguous ? { kind: "wire-start" } : null
  });
  if (resolution.ambiguous) {
    renderTransientLayer();
    showStatus("Multiple terminals are within the precision tie band; choose the exact contact in the precision HUD.", 0);
    return false;
  }
  if (target.invalidReason) {
    renderTransientLayer();
    showStatus(`Connection blocked: ${target.invalidReason} No changes were made.`, 6200);
    announceInteraction(`Error. ${target.invalidReason} No changes were made.`);
    return false;
  }
  wireInteraction = {
    pointerId: event.pointerId,
    pointerType: event.pointerType || "mouse",
    startEndpoint: target.endpoint,
    startPoint: benchPointFromEvent(event),
    startClientPoint: [event.clientX, event.clientY],
    currentPoint: target.svgPoint,
    targetEndpoint: null,
    targetResolution: null,
    invalidReason: null,
    pendingPointer: null,
    moved: false
  };
  benchSvg.setPointerCapture(event.pointerId);
  event.preventDefault();
  return true;
}

function updateWireInteraction(event) {
  if (!wireInteraction || event.pointerId !== wireInteraction.pointerId) return;
  const clientPoint = [event.clientX, event.clientY];
  const dx = clientPoint[0] - wireInteraction.startClientPoint[0];
  const dy = clientPoint[1] - wireInteraction.startClientPoint[1];
  if (!wireInteraction.moved && Math.hypot(dx, dy) < 3) return;
  wireInteraction.moved = true;
  wireInteraction.pendingPointer = {
    clientPoint,
    pointerType: event.pointerType || wireInteraction.pointerType,
    worldPoint: benchPointFromEvent(event)
  };
  schedulePointerFrame();
  event.preventDefault();
}

function finishWireInteraction(event) {
  if (!wireInteraction || event.pointerId !== wireInteraction.pointerId) return;
  flushPointerFrameNow();
  const interaction = wireInteraction;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  wireInteraction = null;
  uiState.wireDrag = null;
  if (!interaction.moved) {
    suppressNextBenchClick = true;
    handleResolvedTerminalClick(interaction.startEndpoint);
    return;
  }
  uiState.pendingEndpoint = null;
  suppressNextBenchClick = true;
  const targetResolution = interaction.targetResolution;
  if (!targetResolution?.target) {
    clearTargetingResolution();
    renderTransientLayer();
    showStatus("Wire was not connected: release on a real terminal or breadboard hole.", 5200);
    return;
  }
  if (targetResolution.ambiguous) {
    uiState.targeting.ambiguityAction = {
      kind: "wire-drop",
      startEndpoint: interaction.startEndpoint
    };
    renderTransientLayer();
    showStatus("Wire release is ambiguous; choose the exact contact in the precision HUD. No changes were made yet.", 0);
    return;
  }
  if (targetResolution.target.invalidReason) {
    renderTransientLayer();
    showStatus(`Connection blocked: ${targetResolution.target.invalidReason} No changes were made.`, 6200);
    return;
  }
  const project = currentProject();
  requestWireConnection(interaction.startEndpoint, targetResolution.target.endpoint, {
    name: `${endpointLabel(project, interaction.startEndpoint)} to ${endpointLabel(project, targetResolution.target.endpoint)}`
  });
}

function cancelWireInteraction(event) {
  if (!wireInteraction || event.pointerId !== wireInteraction.pointerId) return;
  if (benchSvg.hasPointerCapture(event.pointerId)) benchSvg.releasePointerCapture(event.pointerId);
  wireInteraction = null;
  uiState.wireDrag = null;
  uiState.pendingEndpoint = null;
  clearTargetingResolution();
  cancelPendingMutation("Pointer interaction canceled; no staged connection was committed.");
  renderTransientLayer();
  announceInteraction("Wire interaction canceled. No changes were made.");
}

function handleResolvedTerminalClick(endpointInput) {
  const project = currentProject();
  const resolved = resolveTerminal(project, endpointInput);
  if (!resolved.ok) {
    showStatus(`Connection blocked: ${resolved.error}`, 6200);
    announceInteraction(`Error. ${resolved.error}`);
    return;
  }
  const endpoint = resolved.endpoint;
  const isCurrentWireStart = project.mode === "wire"
    && uiState.pendingEndpoint?.componentId === endpoint.componentId
    && uiState.pendingEndpoint?.terminalId === endpoint.terminalId;
  if (isCurrentWireStart) {
    uiState.pendingEndpoint = null;
    renderWireStatus(project);
    renderTransientLayer();
    showStatus("Wire start cleared");
    announceInteraction("Wire start canceled.");
    return;
  }
  const projected = projectedTerminalResolver.resolveEndpoint(endpoint, project);
  const validatedTarget = candidateWithInteractionValidity(projected, uiState.pendingEndpoint);
  if (project.mode === "wire" && validatedTarget?.invalidReason) {
    uiState.targeting.resolution = {
      pointerType: "mouse",
      ...terminalPointerProfile("mouse"),
      target: validatedTarget,
      candidates: [validatedTarget],
      nearbyCandidates: [validatedTarget],
      ambiguous: false,
      ambiguityCount: 1
    };
    renderTransientLayer();
    showStatus(`Connection blocked: ${validatedTarget.invalidReason} No changes were made.`, 6200);
    announceInteraction(`Error. ${validatedTarget.invalidReason} No changes were made.`);
    return;
  }
  if (project.mode !== "wire") {
    commitSelection(selectComponent(project, endpoint.componentId));
    wireStatus.textContent = endpointLabel(project, endpoint);
    return;
  }
  if (!uiState.pendingEndpoint) {
    uiState.pendingEndpoint = endpoint;
    uiState.targeting.focusedEndpoint = endpoint;
    uiState.targeting.focusSource = "wire-start";
    uiState.targeting.lastClientPoint = null;
    renderWireStatus(project);
    renderTransientLayer();
    showStatus(`Selected ${endpointLabel(project, endpoint)} as wire start`);
    announceInteraction(`Wire started at ${endpointLabel(project, endpoint)}.`);
    return;
  }
  const first = uiState.pendingEndpoint;
  uiState.pendingEndpoint = null;
  requestWireConnection(first, endpoint, {
    name: `${endpointLabel(project, first)} to ${endpointLabel(project, endpoint)}`
  });
}

function cancelActivePointerInteraction() {
  if (wireInteraction) {
    const pointerId = wireInteraction.pointerId;
    if (benchSvg.hasPointerCapture(pointerId)) benchSvg.releasePointerCapture(pointerId);
    wireInteraction = null;
    uiState.wireDrag = null;
    uiState.pendingEndpoint = null;
    clearTargetingResolution();
    renderWireStatus(currentProject());
    renderTransientLayer();
    announceInteraction("Wire pointer interaction canceled. No changes were made.");
    return true;
  }
  if (pointerInteraction) {
    const pointerId = pointerInteraction.pointerId;
    if (benchSvg.hasPointerCapture(pointerId)) benchSvg.releasePointerCapture(pointerId);
    pointerInteraction = null;
    pendingPreviewProject = null;
    suppressNextBenchClick = true;
    if (previewAnimationFrame) {
      window.cancelAnimationFrame(previewAnimationFrame);
      previewAnimationFrame = 0;
    }
    renderWireStatus(currentProject());
    renderTransientLayer();
    announceInteraction("Component pointer interaction canceled. Transform, connections, generation, and history are unchanged.");
    return true;
  }
  if (benchPanInteraction) {
    const pointerId = benchPanInteraction.pointerId;
    if (benchSvg.hasPointerCapture(pointerId)) benchSvg.releasePointerCapture(pointerId);
    benchPanInteraction = null;
    renderBenchView();
    renderTransientLayer();
    announceInteraction("Bench pan canceled.");
    return true;
  }
  return false;
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

function updateComponentWithInsertionGuard(project, componentId, patch, message) {
  const transformed = updateComponent(project, componentId, patch);
  const mutation = stageInsertionMutation(project, transformed, componentId, uiState.projectGeneration, {
    operationKind: "place"
  });
  return presentStagedMutation(mutation, { message });
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
  updateComponentWithInsertionGuard(currentProject(), component.id, {
    name: componentNameInput.value.trim() || component.name,
    position: clampComponentPosition(component, definition, [x, y], scale, rotation),
    rotation,
    props: {
      ...component.props,
      scale,
      ...(engineeringOverrides ? { engineeringOverrides } : { engineeringOverrides: undefined })
    }
  }, `${component.name} updated`);
}

function rotateSelectedComponent(deltaDegrees) {
  const component = selectedComponentInstance();
  if (!component) return;
  const definition = catalog.getComponent(component.typeId);
  if (!definition) throw new Error(`Unknown component type: ${component.typeId}`);
  const rotation = normalizeComponentRotation(component.rotation + deltaDegrees);
  updateComponentWithInsertionGuard(currentProject(), component.id, {
    rotation,
    position: clampComponentPosition(component, definition, component.position, componentScale(component), rotation)
  }, `${component.name} rotated`);
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
  applyHydratedProject(saved?.project);
}

function applyHydratedProject(savedProject) {
  if (savedProject && !userEditedBeforeStorageHydration) {
    resetProject(savedProject, "Saved Circuit Lab project loaded", {
      userEdit: false,
      preserveBinding: true,
      preserveView: uiState.view.userAdjustedBeforeHydration
    });
    return "loaded";
  }
  if (savedProject && userEditedBeforeStorageHydration) {
    showStatus("Saved Circuit Lab project found; current edits were kept", 5200);
    return "preserved-user-edit";
  }
  showStatus("Starter Circuit Lab project loaded");
  return "starter";
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
  const staleCount = uiState.test.issues.filter((issue) => issue.code === "stale-direct-insertion").length;
  showStatus(staleCount
    ? `Circuit Lab JSON exported unchanged with ${staleCount} blocking stale direct insertion${staleCount === 1 ? "" : "s"}; use Re-seat or Disconnect before physical build.`
    : "Circuit Lab JSON export started", staleCount ? 7200 : 3600);
}

function reSeatStaleInsertion(issue) {
  if (!issue?.componentId) {
    showStatus("This legacy direct insertion has no valid source component; use Disconnect.", 6200);
    return;
  }
  const project = currentProject();
  const mutation = stageInsertionMutation(project, project, issue.componentId, uiState.projectGeneration, {
    operationKind: "re-seat",
    repairMode: true
  });
  presentStagedMutation(mutation, { message: "Direct insertion re-seated" });
}

function disconnectStaleInsertion(issue) {
  const project = currentProject();
  const mutation = stageDisconnectMutation(project, issue?.connectionIds ?? [], uiState.projectGeneration, {
    componentId: issue?.componentId ?? null
  });
  presentStagedMutation(mutation, { message: "Direct insertion disconnected" });
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

function focusTerminal(endpoint, options = {}) {
  const resolved = resolveTerminal(currentProject(), endpoint);
  if (!resolved.ok) throw new Error(resolved.error);
  const projected = projectedTerminalResolver.resolveEndpoint(resolved.endpoint, currentProject());
  if (!projected) throw new Error(`Unable to project terminal: ${resolved.endpoint.componentId}.${resolved.endpoint.terminalId}`);
  uiState.targeting.focusedEndpoint = resolved.endpoint;
  uiState.targeting.focusSource = options.source ?? "programmatic";
  uiState.targeting.lockedEndpointKey = projected.endpointKey;
  uiState.targeting.lastClientPoint = null;
  uiState.targeting.resolution = {
    pointerType: "mouse",
    ...terminalPointerProfile("mouse"),
    target: projected,
    candidates: [projected],
    nearbyCandidates: [projected],
    ambiguous: false,
    ambiguityCount: 1
  };
  benchSvg.dataset.focusedTerminal = projected.endpointKey;
  if (options.focusBench !== false) benchSvg.focus({ preventScroll: true });
  renderTransientLayer();
  wireStatus.textContent = endpointLabel(currentProject(), resolved.endpoint);
  return { ...resolved, projected };
}

function moveTerminalFocus(direction) {
  const bounds = benchSvg.getBoundingClientRect();
  const visibleRect = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
  const currentKey = terminalEndpointKey(
    uiState.targeting.focusedEndpoint
      ?? uiState.targeting.resolution?.target?.endpoint
      ?? uiState.pendingEndpoint
  );
  const next = nearestVisibleTerminalInDirection(
    projectedTerminalResolver.snapshot(currentProject()),
    currentKey,
    direction,
    visibleRect
  );
  if (!next) {
    announceInteraction("No visible terminal is available in that direction.");
    return null;
  }
  focusTerminal(next.endpoint, { source: "keyboard", focusBench: false });
  return next;
}

function choosePrecisionCandidate(endpointKey) {
  const resolution = uiState.targeting.resolution;
  const candidate = resolution?.candidates?.find((item) => item.endpointKey === endpointKey)
    ?? resolution?.nearbyCandidates?.find((item) => item.endpointKey === endpointKey);
  if (!candidate) return false;
  const action = uiState.targeting.ambiguityAction;
  uiState.targeting.lockedEndpointKey = candidate.endpointKey;
  uiState.targeting.ambiguityAction = null;
  uiState.targeting.resolution = {
    ...resolution,
    target: candidate,
    candidates: [candidate],
    ambiguous: false,
    ambiguityCount: 1
  };
  uiState.targeting.focusedEndpoint = candidate.endpoint;
  uiState.targeting.focusSource = "ambiguity-choice";
  renderTransientLayer();
  announceInteraction(`Confirmed target ${candidate.terminalAriaLabel}.`);
  if (candidate.invalidReason) {
    showStatus(`Connection blocked: ${candidate.invalidReason} No changes were made.`, 6200);
    return false;
  }
  if (action?.kind === "wire-drop" && action.startEndpoint) {
    const project = currentProject();
    requestWireConnection(action.startEndpoint, candidate.endpoint, {
      name: `${endpointLabel(project, action.startEndpoint)} to ${endpointLabel(project, candidate.endpoint)}`
    });
    return true;
  }
  if (action?.kind === "wire-start") {
    handleResolvedTerminalClick(candidate.endpoint);
    return true;
  }
  focusTerminal(candidate.endpoint, { source: "ambiguity-choice" });
  return true;
}

function framePrecisionPort() {
  const target = targetRecordForDisplay();
  if (!target) return;
  if (target.component && target.port) {
    const next = portCamera(target.component, target.port);
    uiState.view.center = next.center;
    setBenchZoom(next.zoom);
    return;
  }
  frameSelectionOrPort();
}

function addPrecisionZoom() {
  const target = targetRecordForDisplay();
  setBenchZoom(uiState.view.zoom * 1.5, { anchorPoint: target?.svgPoint });
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
    staticHostingMessage: "Circuit Lab's assistant is unavailable on GitHub Pages because it requires RoboStudio's local server proxy. Deterministic browser wiring tools, DRC, JSON, build-guide ZIP, and source-only exports remain available; no API key is exposed.",
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
        const next = addHardwareImmediate(componentTypeId, { name, position });
        return uiState.pendingMutation
          ? `${componentTypeId} is mechanically resolved but needs the visible electrical-hazard confirmation.`
          : `${selectedComponentInstance(next)?.name ?? componentTypeId} added.`;
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
        const mutation = stageInsertionMutation(project, updateComponent(project, componentId, { position: nextPosition }), componentId, uiState.projectGeneration, { operationKind: "place" });
        const result = presentStagedMutation(mutation, { message: `${componentId} moved` });
        return result.pending
          ? `${componentId} needs the visible electrical-hazard confirmation.`
          : result.blocked ? `${componentId} was not moved: ${mutation.mechanical.message}` : `${componentId} moved.`;
      },
      circuits_resize_component: ({ componentId, scale }) => {
        const project = currentProject();
        const component = project.components.find((item) => item.id === componentId);
        const definition = component ? catalog.getComponent(component.typeId) : null;
        if (!component || !definition) throw new Error(`Unknown component: ${componentId}`);
        const normalizedScale = normalizeComponentScale(scale);
        const result = updateComponentWithInsertionGuard(project, componentId, {
          position: clampComponentPosition(component, definition, component.position, normalizedScale),
          props: { ...component.props, scale: normalizedScale }
        }, `${componentId} resized`);
        return result.pending ? `${componentId} resize needs electrical-hazard confirmation.`
          : result.blocked ? `${componentId} was not resized.` : `${componentId} resized to ${Math.round(normalizedScale * 100)}%.`;
      },
      circuits_rotate_component: ({ componentId, rotationDegrees }) => {
        const project = currentProject();
        const component = project.components.find((item) => item.id === componentId);
        const definition = component ? catalog.getComponent(component.typeId) : null;
        if (!component || !definition) throw new Error(`Unknown component: ${componentId}`);
        const rotation = normalizeComponentRotation(rotationDegrees);
        const result = updateComponentWithInsertionGuard(project, componentId, {
          rotation,
          position: clampComponentPosition(component, definition, component.position, componentScale(component), rotation)
        }, `${componentId} rotated`);
        return result.pending ? `${componentId} rotation needs electrical-hazard confirmation.`
          : result.blocked ? `${componentId} was not rotated.` : `${componentId} rotated to ${rotation} degrees.`;
      },
      circuits_connect_terminals: ({ endpointA, endpointB, name }) => {
        const result = requestWireConnection(endpointA, endpointB, { name });
        return result.pending ? "The wire needs the visible electrical-hazard confirmation."
          : result.blocked ? "The wire was mechanically blocked." : "Wire connected.";
      },
      circuits_remove_component: ({ componentId }) => {
        commitProject(removeComponent(currentProject(), componentId), "Component removed");
        return `${componentId} removed.`;
      },
      circuits_remove_connection: ({ connectionId }) => {
        const project = currentProject();
        const connection = project.connections.find((item) => item.id === connectionId);
        if (connection?.kind === "direct-insertion") {
          const state = inspectDirectInsertionState(project).find((item) => item.connectionIds.includes(connectionId));
          const result = presentStagedMutation(stageDisconnectMutation(project, state?.connectionIds ?? [connectionId], uiState.projectGeneration, {
            componentId: state?.componentId ?? null
          }), { message: "Direct insertion disconnected" });
          return result.blocked ? `${connectionId} was not disconnected.` : `${connectionId} direct insertion disconnected.`;
        }
        commitProject(removeConnection(project, connectionId), "Wire removed");
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
  if (drawerMediaQuery.matches) {
    assistant.root.classList.add("is-collapsed");
    assistant.root.querySelector(".assistant-card__collapse")?.setAttribute("aria-expanded", "false");
  }
  return assistant;
}

function bindEvents() {
  mountShellCardToggles(document);
  syncDrawerLayout();
  hardwareDrawerTrigger?.addEventListener("click", () => (
    uiState.openDrawer === "hardware" ? closeOpenDrawer() : openDrawer("hardware", hardwareDrawerTrigger)
  ));
  workflowDrawerTrigger?.addEventListener("click", () => (
    uiState.openDrawer === "workflow" ? closeOpenDrawer() : openDrawer("workflow", workflowDrawerTrigger)
  ));
  document.querySelectorAll("[data-close-circuit-drawer]").forEach((button) => {
    button.addEventListener("click", () => closeOpenDrawer());
  });
  drawerMediaQuery.addEventListener?.("change", () => {
    if (!drawerMediaQuery.matches) {
      uiState.openDrawer = null;
      uiState.drawerTrigger = null;
    } else if (circuitAssistantHandle?.root) {
      circuitAssistantHandle.root.classList.add("is-collapsed");
      circuitAssistantHandle.root.querySelector(".assistant-card__collapse")?.setAttribute("aria-expanded", "false");
    }
    syncDrawerLayout();
  });
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
    clearPendingMutation();
    undoHistory(history);
    uiState.projectGeneration += 1;
    uiState.pendingEndpoint = null;
    uiState.wireDrag = null;
    uiState.placement = null;
    refreshDerived();
    render();
    showStatus("Undo complete");
  });
  redoButton.addEventListener("click", () => {
    noteUserEdit();
    clearPendingMutation();
    redoHistory(history);
    uiState.projectGeneration += 1;
    uiState.pendingEndpoint = null;
    uiState.wireDrag = null;
    uiState.placement = null;
    refreshDerived();
    render();
    showStatus("Redo complete");
  });
  exportJsonButton.addEventListener("click", exportProjectJson);
  downloadSourceButton.addEventListener("click", downloadSelectedSource);
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      uiState.activeTab = button.dataset.circuitTab;
      renderWorkflowTabs();
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = tabButtons.indexOf(button);
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? tabButtons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length;
      const next = tabButtons[nextIndex];
      uiState.activeTab = next.dataset.circuitTab;
      renderWorkflowTabs();
      next.focus();
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
      if (uiState.placement) cancelPlacement("Placement canceled by mode change.");
      const mode = button.dataset.circuitMode;
      if (mode === "test") uiState.activeTab = "test-results";
      commitProject(setProjectMode(currentProject(), mode), `${mode} mode`);
      if (mode === "test" && drawerMediaQuery.matches) openDrawer("workflow", button);
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
    beginPlacement(button.dataset.addHardware, { source: "hardware-card" });
    closeOpenDrawer({ restoreFocus: false });
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
    beginPlacement(item.dataset.hardwareItem, { source: "hardware-drag", nativeDrag: true });
  });
  hardwareList.addEventListener("dragend", () => {
    if (uiState.placement?.nativeDrag) cancelPlacement("Drag placement canceled; no component was added.");
  });
  componentList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-component-id]");
    if (!item) return;
    commitSelection(selectComponent(currentProject(), item.dataset.componentId));
  });
  wireList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-connection]");
    if (removeButton) {
      const project = currentProject();
      const connectionId = removeButton.dataset.removeConnection;
      const connection = project.connections.find((item) => item.id === connectionId);
      if (connection?.kind === "direct-insertion") {
        const state = inspectDirectInsertionState(project).find((item) => item.connectionIds.includes(connectionId));
        presentStagedMutation(stageDisconnectMutation(project, state?.connectionIds ?? [connectionId], uiState.projectGeneration, {
          componentId: state?.componentId ?? null
        }), { message: "Direct insertion disconnected" });
      } else {
        commitProject(removeConnection(project, connectionId), "Wire removed");
      }
      return;
    }
    const item = event.target.closest("[data-connection-id]");
    if (!item) return;
    commitSelection(selectConnection(currentProject(), item.dataset.connectionId));
  });
  testList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-issue-id]");
    if (!item) return;
    const issue = uiState.test.issues.find((candidate) => candidate.id === item.dataset.issueId);
    const staleAction = event.target.closest("[data-stale-action]");
    if (staleAction && issue?.code === "stale-direct-insertion") {
      if (staleAction.dataset.staleAction === "re-seat") reSeatStaleInsertion(issue);
      else disconnectStaleInsertion(issue);
      return;
    }
    uiState.selectedIssueId = uiState.selectedIssueId === item.dataset.issueId ? null : item.dataset.issueId;
    renderTest();
    renderBench();
    const selectedIssue = uiState.test.issues.find((candidate) => candidate.id === uiState.selectedIssueId);
    const [terminalRef] = selectedIssue?.targets?.terminalRefs ?? [];
    if (terminalRef) focusTerminal(terminalRef, { source: "validation", focusBench: false });
    else if (uiState.targeting.focusSource === "validation") {
      uiState.targeting.focusedEndpoint = null;
      uiState.targeting.focusSource = null;
      clearTargetingResolution();
      renderTransientLayer();
    }
  });
  confirmMutationButton?.addEventListener("click", () => {
    const mutation = uiState.pendingMutation;
    if (!mutation) return;
    commitResolvedMutation(mutation);
  });
  cancelMutationButton?.addEventListener("click", () => cancelPendingMutation());
  precisionHud?.addEventListener("click", (event) => {
    const candidate = event.target.closest("[data-precision-candidate]");
    if (candidate) {
      choosePrecisionCandidate(candidate.dataset.precisionCandidate);
      return;
    }
    const action = event.target.closest("[data-precision-action]")?.dataset.precisionAction;
    if (action === "frame-port") framePrecisionPort();
    if (action === "add-zoom") addPrecisionZoom();
  });
  benchSvg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const project = currentProject();
    if (uiState.placement) {
      updatePlacementAtPoint(benchPointFromEvent(event));
      renderTransientLayer();
      suppressNextBenchClick = true;
      commitPlacement();
      event.preventDefault();
      return;
    }
    if (project.mode === "wire") {
      const resolution = resolveTerminalAtClientPoint(
        [event.clientX, event.clientY],
        event.pointerType || "mouse"
      );
      if (resolution?.target) {
        suppressNextBenchClick = true;
        beginWireInteraction(event, resolution);
        return;
      }
    }
    const resizeHandle = event.target.closest("[data-resize-component-id]");
    if (resizeHandle) {
      beginComponentInteraction(event, resizeHandle.dataset.resizeComponentId, "resize");
      return;
    }
    if (event.target.closest("[data-terminal-component]") || event.target.closest("[data-connection-id]")) return;
    const component = event.target.closest("[data-component-id]");
    if (component && (project.mode === "select" || project.mode === "place")) {
      beginComponentInteraction(event, component.dataset.componentId, "move");
      return;
    }
    beginBenchPanInteraction(event);
  });
  benchSvg.addEventListener("pointermove", (event) => {
    cycle3Diagnostics.pointerEventCount += 1;
    updateWireInteraction(event);
    updateComponentInteraction(event);
    updateBenchPanInteraction(event);
    const project = currentProject();
    if (uiState.placement) schedulePlacementAtPoint(benchPointFromEvent(event));
    if (!wireInteraction && !pointerInteraction && !benchPanInteraction && (project.mode === "wire" || project.mode === "place")) {
      pendingTargetPointer = {
        clientPoint: [event.clientX, event.clientY],
        pointerType: event.pointerType || "mouse"
      };
      schedulePointerFrame();
    }
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
    cancelPendingMutation("Pointer interaction canceled; no staged connection was committed.");
  });
  benchSvg.addEventListener("pointerleave", () => {
    if (wireInteraction || pointerInteraction || benchPanInteraction || uiState.targeting.focusedEndpoint || uiState.pendingEndpoint) return;
    pendingTargetPointer = null;
    clearTargetingResolution();
    renderTransientLayer();
  });
  benchSvg.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    if (uiState.placement) {
      updatePlacementAtPoint(benchPointFromEvent(event));
      renderTransientLayer();
    }
  });
  benchSvg.addEventListener("drop", (event) => {
    event.preventDefault();
    const typeId = event.dataTransfer?.getData("application/x-robostudio-circuit-component") || event.dataTransfer?.getData("text/plain");
    if (!typeId || !catalog.getComponent(typeId)) return;
    if (!uiState.placement || uiState.placement.typeId !== typeId) beginPlacement(typeId, { source: "hardware-drop", nativeDrag: true });
    updatePlacementAtPoint(benchPointFromEvent(event));
    renderTransientLayer();
    commitPlacement();
  });
  benchSvg.addEventListener("contextmenu", (event) => {
    if (!uiState.placement) return;
    event.preventDefault();
    cancelPlacement();
  });
  benchSvg.addEventListener("click", (event) => {
    if (suppressNextBenchClick) {
      suppressNextBenchClick = false;
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
    cycle3Diagnostics.wheelEventCount += 1;
    const anchorPoint = benchPointFromEvent(event);
    const direction = event.deltaY < 0 ? BENCH_ZOOM_STEP : 1 / BENCH_ZOOM_STEP;
    setBenchZoom(uiState.view.zoom * direction, { anchorPoint });
  }, { passive: false });
  benchSvg.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      moveTerminalFocus(event.key);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && uiState.placement) {
      event.preventDefault();
      commitPlacement();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && uiState.targeting.focusedEndpoint) {
      event.preventDefault();
      handleResolvedTerminalClick(uiState.targeting.focusedEndpoint);
    }
  });
  zoomOutButton.addEventListener("click", () => setBenchZoom(uiState.view.zoom / BENCH_ZOOM_STEP));
  zoomInButton.addEventListener("click", () => setBenchZoom(uiState.view.zoom * BENCH_ZOOM_STEP));
  zoomResetButton.addEventListener("click", resetBenchZoom);
  overviewButton?.addEventListener("click", showOverview);
  frameButton?.addEventListener("click", frameSelectionOrPort);
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
  window.addEventListener("blur", () => {
    releaseAllMomentaryControlsAndRender();
    cancelPendingMutation("Staged connection canceled when the window lost focus.");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") cancelPendingMutation("Staged connection canceled when the page was hidden.");
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (cancelActivePointerInteraction()) {
        event.preventDefault();
        return;
      }
      if (uiState.targeting.ambiguityAction || uiState.targeting.resolution?.ambiguous) {
        clearTargetingResolution();
        renderTransientLayer();
        showStatus("Precision target choice canceled; no changes were made.");
        announceInteraction("Precision target choice canceled. No changes were made.");
        event.preventDefault();
        return;
      }
      if (cancelPendingMutation()) {
        event.preventDefault();
        return;
      }
      if (uiState.pendingEndpoint) {
        uiState.pendingEndpoint = null;
        uiState.wireDrag = null;
        renderWireStatus(currentProject());
        renderTransientLayer();
        showStatus("Wire start canceled");
        announceInteraction("Wire start canceled.");
        event.preventDefault();
        return;
      }
      if (cancelPlacement()) {
        event.preventDefault();
        return;
      }
      if (closeOpenDrawer()) {
        event.preventDefault();
        return;
      }
      releaseAllMomentaryControlsAndRender();
    }
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

  const invalidateProjectedLayout = (reason) => {
    projectedTerminalResolver.invalidate(reason);
    refreshTargetResolutionFromLastPoint();
    renderTransientLayer();
  };
  document.querySelector(".circuit-shell")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-toggle-shell-card]")) return;
    window.requestAnimationFrame(() => invalidateProjectedLayout("panel-layout-change"));
  });
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => invalidateProjectedLayout("viewport-or-panel-layout"));
    observer.observe(benchSvg);
    observer.observe(benchSvg.parentElement);
  }
  window.addEventListener("resize", () => invalidateProjectedLayout("viewport-resize"));
  window.addEventListener("scroll", (event) => {
    if (![document, document.documentElement, document.body].includes(event.target)) return;
    invalidateProjectedLayout("viewport-scroll");
  }, { passive: true, capture: true });
  window.visualViewport?.addEventListener("resize", () => invalidateProjectedLayout("visual-viewport-resize"));
}

function installCycle3Diagnostics() {
  ensureBenchLayers();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList" && record.target === benchSvg) {
        cycle3Diagnostics.fullBenchReplacementCount += 1;
      }
    }
  });
  observer.observe(benchSvg, { childList: true });
  window.__circuitLabCycle3 = Object.freeze({
    diagnostics: () => ({ ...cycle3Diagnostics }),
    resolverStats: () => projectedTerminalResolver.stats(),
    targetingState: () => ({
      lockedEndpointKey: uiState.targeting.lockedEndpointKey,
      resolutionEndpointKey: uiState.targeting.resolution?.target?.endpointKey ?? null,
      ambiguous: Boolean(uiState.targeting.resolution?.ambiguous)
    }),
    invalidateResolver: (reason = "browser-test") => projectedTerminalResolver.invalidate(reason),
    focusTerminal: (endpoint) => {
      const resolved = focusTerminal(endpoint, { source: "browser-instrumentation" });
      return {
        endpoint: resolved.endpoint,
        screenPoint: resolved.projected.screenPoint,
        svgPoint: resolved.projected.svgPoint,
        capacity: `${resolved.projected.capacityUsed}/${resolved.projected.capacity}`
      };
    },
    resolveAtClient: (clientPoint, pointerType = "mouse", startEndpoint = null) => {
      const result = resolveTerminalAtClientPoint(clientPoint, pointerType, startEndpoint);
      return result ? {
        target: result.target ? {
          endpoint: result.target.endpoint,
          endpointKey: result.target.endpointKey,
          invalidReason: result.target.invalidReason,
          capacityUsed: result.target.capacityUsed,
          capacity: result.target.capacity,
          distancePx: result.target.distancePx
        } : null,
        candidates: result.candidates.map((candidate) => candidate.endpointKey),
        ambiguityCount: result.ambiguityCount,
        ambiguous: result.ambiguous,
        radiusPx: result.radiusPx,
        tieBandPx: result.tieBandPx,
        hysteresisPx: result.hysteresisPx
      } : null;
    },
    serializedProject: () => serializeCircuitLabProject(currentProject())
  });
  window.__circuitLabCycle4 = Object.freeze({
    cameraState: () => ({
      zoom: uiState.view.zoom,
      center: [...uiState.view.center],
      viewBox: benchViewBoxFor(),
      userAdjusted: uiState.view.userAdjusted,
      userAdjustedBeforeHydration: uiState.view.userAdjustedBeforeHydration
    }),
    setCamera: ({ zoom, center, userAdjusted = true }) => {
      uiState.view.center = clampBenchViewCenter(center ?? uiState.view.center, zoom ?? uiState.view.zoom);
      setBenchZoom(zoom ?? uiState.view.zoom, { userAdjusted });
      return { zoom: uiState.view.zoom, center: [...uiState.view.center], viewBox: benchViewBoxFor() };
    },
    resetView: resetBenchZoom,
    overview: showOverview,
    frame: frameSelectionOrPort,
    terminalGeometry: (endpoint) => {
      const resolved = resolveTerminal(currentProject(), endpoint);
      if (!resolved.ok) return null;
      return {
        endpoint: resolved.endpoint,
        worldPosition: [...resolved.worldPosition],
        localPosition: [...resolved.terminal.position],
        visibleBoundsMm: { ...(resolved.terminal.visibleBoundsMm ?? {}) },
        componentScale: componentScale(resolved.component),
        componentRotation: normalizeComponentRotation(resolved.component.rotation),
        physicalPortId: resolved.terminal.physicalPortId ?? null
      };
    },
    project: () => JSON.parse(serializeCircuitLabProject(currentProject())),
    serializedProject: () => serializeCircuitLabProject(currentProject()),
    history: () => ({ ...historyStatus(history) }),
    generation: () => uiState.projectGeneration,
    placementState: () => uiState.placement ? {
      typeId: uiState.placement.typeId,
      componentId: uiState.placement.componentId,
      source: uiState.placement.source,
      status: placementStatus(uiState.placement.mutation),
      point: [...uiState.placement.point],
      exactEndpointPairs: uiState.placement.mutation?.exactEndpointPairs ?? []
    } : null,
    beginPlacement: (typeId, options = {}) => beginPlacement(typeId, options),
    movePlacement: (point) => {
      updatePlacementAtPoint(point);
      renderTransientLayer();
      return window.__circuitLabCycle4.placementState();
    },
    commitPlacement,
    cancelPlacement,
    beginHydrationGuardProbe: () => {
      storageHydrationFinished = false;
      userEditedBeforeStorageHydration = false;
      uiState.view.userAdjustedBeforeHydration = uiState.view.userAdjusted;
      return { storageHydrationFinished, userEditedBeforeStorageHydration };
    },
    finishHydrationGuardProbe: (project) => {
      storageHydrationFinished = true;
      const outcome = applyHydratedProject(normalizeProject(project));
      return {
        outcome,
        storageHydrationFinished,
        userEditedBeforeStorageHydration,
        placement: window.__circuitLabCycle4.placementState(),
        project: window.__circuitLabCycle4.project()
      };
    },
    drawerState: () => ({
      compact: drawerMediaQuery.matches,
      openDrawer: uiState.openDrawer,
      hardwareInert: Boolean(hardwareDrawer?.inert),
      workflowInert: Boolean(workflowDrawer?.inert)
    }),
    openDrawer,
    closeDrawer: closeOpenDrawer,
    wireHintDismissed: () => uiState.wireHintDismissed,
    simulateLateHydration: (project) => {
      storageHydrationFinished = false;
      uiState.view.userAdjustedBeforeHydration = uiState.view.userAdjusted;
      resetProject(normalizeProject(project), "Late hydration applied", {
        userEdit: false,
        preserveBinding: true,
        preserveView: uiState.view.userAdjustedBeforeHydration
      });
      storageHydrationFinished = true;
      return { camera: window.__circuitLabCycle4.cameraState(), project: window.__circuitLabCycle4.project() };
    },
    executeAssistantAction: (name, args) => {
      if (!circuitAssistantHandle?.adapter) throw new Error("Circuit assistant is not mounted yet.");
      return circuitAssistantHandle.adapter.executeAction(name, args);
    }
  });
}

async function start() {
  bindEvents();
  refreshDerived();
  render();
  installCycle3Diagnostics();
  try {
    await Promise.race([
      hydrateSavedProject(),
      timeoutAfter(2500, "Workspace storage is still opening; starter Circuit Lab project stays active.")
    ]);
  } catch (error) {
    showStatus(error.message ?? "Starter Circuit Lab project is ready", 5200);
  }
  circuitAssistantHandle = mountCircuitAssistant();
}

start().catch((error) => {
  console.error("Circuit Lab failed to start", error);
  resetProject(createCircuitLabProject(), "Circuit Lab loaded with starter project", { userEdit: false });
});
