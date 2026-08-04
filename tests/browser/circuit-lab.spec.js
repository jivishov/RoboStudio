import { expect, test } from "@playwright/test";
import {
  addComponent,
  connectTerminals,
  createCircuitLabProject,
  normalizeProject,
  serializeCircuitLabProject,
  updateComponent
} from "../../src/circuits/model.js";
import { BENCH_HEIGHT, BENCH_WIDTH } from "../../src/circuits/geometry.js";
import { insertComponentIntoNearestTerminals } from "../../src/circuits/insertion.js";
import { catalog } from "../../src/circuits/catalog.js";
import { resolveTerminal } from "../../src/circuits/connectivity.js";

const consoleByPage = new WeakMap();
const SIX_SERVO_PROJECT_JSON = serializeCircuitLabProject(
  createCircuitLabProject({ templateId: "arduino_six_servo_order" })
);

function insertedCapacitorProjectJson() {
  let project = createCircuitLabProject();
  project = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  project = updateComponent(project, "cap", { position: [470, 388.57] });
  return serializeCircuitLabProject(insertComponentIntoNearestTerminals(project, "cap").project);
}

const INSERTED_CAPACITOR_PROJECT_JSON = insertedCapacitorProjectJson();

function emptyCircuitProject() {
  return normalizeProject({
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    name: "Cycle 2 browser test",
    components: [],
    connections: [],
    app: { kind: "cycle-2-browser" }
  });
}

function addCapacitorAt(project, targetEndpoint) {
  let next = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  const target = resolveTerminal(next, targetEndpoint);
  const source = catalog.getComponent("capacitor-electrolytic-470uf").terminals.find((terminal) => terminal.id === "pos");
  return updateComponent(next, "cap", {
    position: [target.worldPosition[0] - source.position[0], target.worldPosition[1] - source.position[1]]
  });
}

function safePlacementProjectJson() {
  let project = emptyCircuitProject();
  project = addComponent(project, "breadboard-bb400-400", { id: "bb", position: [500, 325] });
  return serializeCircuitLabProject(addCapacitorAt(project, { componentId: "bb", terminalId: "r15a" }));
}

function hazardousPlacementProjectJson() {
  let project = emptyCircuitProject();
  project = addComponent(project, "breadboard-bb400-400", { id: "bb", position: [500, 325] });
  project = addComponent(project, "supply-servo-6v", { id: "supply", position: [100, 100] });
  project = connectTerminals(project, { componentId: "supply", terminalId: "GND" }, { componentId: "bb", terminalId: "r15b" }, { id: "ground_row" });
  project = connectTerminals(project, { componentId: "supply", terminalId: "VPLUS" }, { componentId: "bb", terminalId: "r16b" }, { id: "power_row" });
  return serializeCircuitLabProject(addCapacitorAt(project, { componentId: "bb", terminalId: "r15a" }));
}

function mechanicallyBlockedPlacementProjectJson() {
  let project = emptyCircuitProject();
  project = addComponent(project, "led-red", { id: "led", position: [500, 300] });
  const ledTarget = resolveTerminal(project, { componentId: "led", terminalId: "anode" });
  let proposed = addComponent(project, "capacitor-electrolytic-470uf", { id: "cap" });
  const capPos = catalog.getComponent("capacitor-electrolytic-470uf").terminals.find((terminal) => terminal.id === "pos");
  proposed = updateComponent(proposed, "cap", { position: [ledTarget.worldPosition[0] - capPos.position[0], ledTarget.worldPosition[1] - capPos.position[1]] });
  return serializeCircuitLabProject(proposed);
}

function staleInsertionProjectJson() {
  const inserted = JSON.parse(INSERTED_CAPACITOR_PROJECT_JSON);
  const cap = inserted.components.find((component) => component.id === "cap");
  cap.position = [720, 420];
  return JSON.stringify(inserted);
}

const SAFE_PLACEMENT_PROJECT_JSON = safePlacementProjectJson();
const HAZARDOUS_PLACEMENT_PROJECT_JSON = hazardousPlacementProjectJson();
const MECHANICALLY_BLOCKED_PROJECT_JSON = mechanicallyBlockedPlacementProjectJson();
const STALE_INSERTION_PROJECT_JSON = staleInsertionProjectJson();

function manualWireProjectJson() {
  let project = emptyCircuitProject();
  project = addComponent(project, "breadboard-bb400-400", { id: "bb", position: [500, 325] });
  project = addComponent(project, "supply-servo-6v", { id: "supply", position: [140, 120] });
  return serializeCircuitLabProject(project);
}

const MANUAL_WIRE_PROJECT_JSON = manualWireProjectJson();

const SYNTHETIC_FZP = `
<module moduleId="localWidget">
  <title>Local Widget</title>
  <connector id="connector0" name="SIG" type="male">
    <gender>male</gender>
    <breadboardView><p terminalId="term0" /></breadboardView>
  </connector>
  <connector id="connector1" name="GND" type="male">
    <gender>male</gender>
    <breadboardView><p terminalId="term1" /></breadboardView>
  </connector>
</module>`;

const SYNTHETIC_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
  <rect id="body" x="0" y="0" width="20" height="10" fill="#64748b" />
  <circle id="term0" cx="5" cy="5" r="1" />
  <circle id="term1" cx="15" cy="5" r="1" />
</svg>`;

const VALID_BINDING = {
  kind: "MechatronicsBinding",
  version: 1,
  actuatorBindings: [
    {
      id: "base-servo-binding",
      jointId: "base",
      actuatorId: "base-servo",
      circuitComponentId: "servo_base",
      firmwareChannelIds: ["SERVO_BASE"],
      commandTransform: {
        scale: 1,
        offset: 0,
        invert: false
      }
    }
  ],
  sensorBindings: [],
  firmwareChannels: [
    {
      id: "SERVO_BASE",
      semanticRole: "joint.command.position",
      direction: "controller-to-device",
      signalType: "servo-pulse",
      valueType: "number",
      controllerTerminalRef: { componentId: "arduino", terminalId: "D8" },
      deviceTerminalRef: { componentId: "servo_base", terminalId: "signal" }
    }
  ]
};

function parseViewBox(value) {
  return String(value ?? "").trim().split(/\s+/).map(Number);
}

async function openDrawer(page, name) {
  const trigger = page.locator(name === "hardware" ? "#open-circuit-hardware-drawer" : "#open-circuit-workflow-drawer");
  if (!(await trigger.isVisible())) return;
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}

async function openWorkflowTab(page, name) {
  await openDrawer(page, "workflow");
  await page.getByRole("tab", { name, exact: true }).click();
}

async function selectComponentForInspector(page, componentId) {
  await openDrawer(page, "hardware");
  await page.locator(`#circuit-component-list [data-component-id='${componentId}']`).click();
  await openWorkflowTab(page, "Inspect");
}

async function editProjectName(page, value) {
  await openDrawer(page, "hardware");
  await page.locator("#circuit-lab-name").fill(value);
  await page.locator("#circuit-lab-name").press("Tab");
}

async function findEmptyBenchPoint(page) {
  return page.locator("#circuit-bench").evaluate((bench) => {
    const rect = bench.getBoundingClientRect();
    const blockedSelector = [
      "[data-component-id]",
      "[data-terminal-component]",
      "[data-connection-id]",
      "[data-fitting-connection-id]",
      "[data-resize-component-id]"
    ].join(",");
    const xRatios = [0.12, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.88];
    const yRatios = [0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88];
    for (const yRatio of yRatios) {
      for (const xRatio of xRatios) {
        const x = rect.left + rect.width * xRatio;
        const y = rect.top + rect.height * yRatio;
        const element = document.elementFromPoint(x, y);
        if (!element || !bench.contains(element) || element.closest(blockedSelector)) continue;
        return { x, y };
      }
    }
    return null;
  });
}

async function importCircuitProject(page, json, name) {
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));
  const beforeGeneration = await page.evaluate(() => window.__circuitLabCycle4.generation());
  const expected = JSON.parse(json);
  await page.setInputFiles("#circuit-lab-file-input", {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(json)
  });
  await expect.poll(() => page.evaluate(() => window.__circuitLabCycle4.generation())).toBeGreaterThan(beforeGeneration);
  await expect.poll(() => page.evaluate(() => {
    const project = window.__circuitLabCycle4.project();
    return {
      componentIds: project.components.map((component) => component.id).sort(),
      connectionIds: project.connections.map((connection) => connection.id).sort()
    };
  })).toEqual({
    componentIds: expected.components.map((component) => component.id).sort(),
    connectionIds: expected.connections.map((connection) => connection.id).sort()
  });
}

async function importHazardousPlacement(page, name = "hazardous-placement.json") {
  await importCircuitProject(page, HAZARDOUS_PLACEMENT_PROJECT_JSON, name);
}

async function stageHazardousPlacement(page) {
  await selectComponentForInspector(page, "cap");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#circuit-mutation-confirmation")).toBeVisible();
}

async function expectHazardBaseConnectionsUnchanged(page) {
  await expect.poll(() => page.locator("#circuit-wire-list [data-connection-id]").evaluateAll((items) => (
    items.map((item) => item.dataset.connectionId).sort()
  ))).toEqual(["ground_row", "power_row"]);
}

async function focusTerminalThroughResolver(page, endpoint) {
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle3));
  return page.evaluate((target) => window.__circuitLabCycle3.focusTerminal(target), endpoint);
}

async function overviewTerminalForPointer(page, endpoint) {
  await focusTerminalThroughResolver(page, endpoint);
  await page.locator("#circuit-view-overview").click();
  const projected = await focusTerminalThroughResolver(page, endpoint);
  const benchBox = await page.locator("#circuit-bench").boundingBox();
  if (!benchBox) throw new Error("Circuit bench is not visible for framed terminal interaction.");
  expect(projected.screenPoint[0]).toBeGreaterThanOrEqual(benchBox.x);
  expect(projected.screenPoint[0]).toBeLessThanOrEqual(benchBox.x + benchBox.width);
  expect(projected.screenPoint[1]).toBeGreaterThanOrEqual(benchBox.y);
  expect(projected.screenPoint[1]).toBeLessThanOrEqual(benchBox.y + benchBox.height);
  return projected;
}

async function activateTerminalByKeyboard(page, endpoint) {
  const projected = await focusTerminalThroughResolver(page, endpoint);
  await page.keyboard.press("Enter");
  return projected;
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  const consoleMessages = [];
  consoleByPage.set(page, consoleMessages);
  page.on("dialog", (dialog) => dialog.accept());
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleMessages.push(message.text());
  });
  page.on("pageerror", (error) => consoleMessages.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(consoleByPage.get(page) ?? []).toEqual([]);
});

test("Circuit Lab workflow tabs, DRC focus, binding, and build artifacts render", async ({ page }) => {
  await page.goto("/circuits.html");
  await expect(page).toHaveTitle("Circuit Lab");
  await expect(page.locator("#circuit-bench")).toBeVisible();
  await expect(page.locator(".bench-component")).toHaveCount(4);
  await expect(page.locator("#circuit-bench [data-visual-kind='photorealistic-svg-wrapper']")).toHaveCount(4);
  await expect(page.locator("#circuit-bench .photoreal-component-image")).toHaveCount(4);
  await expect(page.locator("#circuit-bench [data-physical-port-id]")).toHaveCount(6);
  await expect(page.locator("#circuit-bench [data-physical-port-id='servo-plug']")).toHaveCount(1);
  await expect(page.locator("#circuit-bench .bench-label").filter({ hasText: "approximate geometry" })).toHaveCount(1);
  await expect(page.locator("#circuit-bench .connection-fitting")).not.toHaveCount(0);
  await expect(page.locator("#circuit-bench [data-fitting-type='breadboard-wire']")).not.toHaveCount(0);
  await expect(page.locator("#circuit-bench [data-fitting-type='dupont-header']")).not.toHaveCount(0);
  await expect(page.locator("#circuit-bench [data-fitting-type='servo-plug']")).not.toHaveCount(0);
  await expect(page.locator("#circuit-bench [data-fitting-type='ferrule']")).not.toHaveCount(0);
  await openDrawer(page, "hardware");
  await expect(page.locator("[data-hardware-item='supply-servo-6v'] .hardware-geometry-class--approximate")).toContainText("approximate geometry");
  await openWorkflowTab(page, "Inspect");
  await expect(page.locator("[data-card-id='circuit-inspector-card']")).toBeVisible();

  await selectComponentForInspector(page, "supply");
  await expect(page.locator("#circuit-control-panel")).toContainText("Power");
  await expect(page.locator("#circuit-bench .power-switch--off")).toHaveCount(1);
  await page.locator("#circuit-control-panel [data-control-id='power']").selectOption("on");
  await expect(page.locator("#circuit-bench .power-switch--on")).toHaveCount(1);
  await page.locator("#circuit-control-panel [data-control-id='power']").selectOption("off");
  await expect(page.locator("#circuit-bench .power-switch--off")).toHaveCount(1);

  await selectComponentForInspector(page, "servo");
  await page.locator("#circuit-control-panel [data-control-id='previewAngleDeg']").evaluate((input) => {
    input.value = "135";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#circuit-bench .servo-horn-state[data-control-state='135']")).toHaveCount(1);

  await openWorkflowTab(page, "Test Results");
  await expect(page.locator("[data-card-id='circuit-test-card']")).toBeVisible();
  await expect(page.locator("[data-card-id='circuit-inspector-card']")).toBeHidden();
  await expect(page.locator("#circuit-test-summary")).toContainText("warning");

  await importCircuitProject(page, SIX_SERVO_PROJECT_JSON, "six-servo-circuit.json");
  await expect(page.locator(".bench-component")).toHaveCount(9);
  await expect(page.locator("#circuit-test-summary")).toContainText("2 errors");
  await page.locator("#circuit-test-list [data-issue-id]").first().click();
  await expect(page.locator("#circuit-test-list [data-issue-id].is-selected")).toHaveCount(1);
  await expect(page.locator(".bench-component.is-highlighted, .wire-path--highlight, .terminal-glyph.is-highlighted")).not.toHaveCount(0);

  await selectComponentForInspector(page, "servo_base");
  await page.locator("summary").filter({ hasText: "Engineering specifications" }).click();
  await page.locator("#circuit-engineering-typical-ma").fill("450");
  await page.locator("#circuit-engineering-peak-ma").fill("900");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("#circuit-status")).toContainText("updated");

  await openWorkflowTab(page, "Bind");
  await expect(page.locator("#circuit-binding-summary")).toContainText("absent");
  await page.locator("#circuit-binding-json").fill("{");
  await page.getByRole("button", { name: "Apply Binding" }).click();
  await expect(page.locator("#circuit-status")).toContainText("Mechatronics binding JSON is invalid");
  await page.locator("#circuit-binding-json").fill(JSON.stringify(VALID_BINDING, null, 2));
  await page.getByRole("button", { name: "Apply Binding" }).click();
  await expect(page.locator("#circuit-binding-summary")).toContainText("blocked");

  await openWorkflowTab(page, "Build");
  await expect(page.locator("#circuit-readiness-summary")).not.toHaveText("Pending");
  await expect(page.locator("#circuit-pin-map-table table")).toBeVisible();
  await expect(page.locator("#circuit-harness-table table")).toBeVisible();
  await expect(page.locator("#circuit-bom-table table")).toBeVisible();
  await expect(page.locator("#circuit-checklist-list .circuit-status-row")).not.toHaveCount(0);
  await page.locator("#circuit-source-file").selectOption("README.md");
  await expect(page.locator("#circuit-source-preview")).toContainText("not built, flashed, executed, or hardware-tested");
});

test("direct insertion renders one combined lead-side fitting per physical contact", async ({ page }) => {
  await page.goto("/circuits.html");
  await importCircuitProject(page, INSERTED_CAPACITOR_PROJECT_JSON, "inserted-capacitor.json");
  await expect(page.locator("#circuit-bench [data-fitting-combined='true']")).toHaveCount(2);
  await expect(page.locator("#circuit-bench [data-fitting-combined='true'][data-fitting-type='inserted-lead']")).toHaveCount(2);
  await expect(page.locator("#circuit-bench [data-fitting-combined='true'][data-fitting-endpoint^='breadboard:']")).toHaveCount(0);
});

test("Circuit Lab hardware filters expose and add robotics components", async ({ page }) => {
  await page.goto("/circuits.html");
  await openDrawer(page, "hardware");
  await expect(page.locator("#hardware-list")).toContainText("36 of 36 built-ins shown");
  await page.locator("[data-hardware-search]").fill("pca9685");
  await page.locator("[data-hardware-search]").press("Enter");
  await expect(page.locator("#hardware-list")).toContainText("PCA9685");
  await expect(page.locator("[data-add-hardware='driver-pca9685-servo']")).toBeVisible();

  await page.locator("[data-hardware-search]").fill("");
  await page.locator("[data-hardware-search]").press("Enter");
  await page.locator("[data-hardware-category]").selectOption("Driver");
  await expect(page.locator("#hardware-list")).toContainText("5 of 36 built-ins shown");
  await expect(page.locator("[data-clear-hardware-filters]")).toBeVisible();
  await expect(page.locator("#hardware-list")).toContainText("TB6612FNG");
  await expect(page.locator("#hardware-list")).toContainText("A4988");
  await page.locator("[data-clear-hardware-filters]").click();
  await expect(page.locator("#hardware-list")).toContainText("36 of 36 built-ins shown");
  await page.locator("[data-hardware-category]").selectOption("Driver");
  const stableComponents = page.locator("#circuit-bench [data-bench-layer='components'] > .bench-component");
  const initialStableCount = await stableComponents.count();
  await page.locator("[data-add-hardware='driver-pca9685-servo']").click();
  await expect(stableComponents).toHaveCount(initialStableCount);
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(1);
  expect((await page.evaluate(() => window.__circuitLabCycle4.project())).components).toHaveLength(initialStableCount);
  await page.locator("#circuit-bench").press("Enter");
  await expect(stableComponents).toHaveCount(initialStableCount + 1);
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(0);
  await expect(page.locator("#circuit-bench .photoreal-component-image")).toHaveCount(initialStableCount + 1);

  await openDrawer(page, "hardware");
  await page.locator("[data-add-hardware='driver-pca9685-servo']").click();
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(stableComponents).toHaveCount(initialStableCount + 1);
  expect((await page.evaluate(() => window.__circuitLabCycle4.project())).components).toHaveLength(initialStableCount + 1);
});

test("Circuit Lab wheel zooms and pans empty bench space without stealing component drag", async ({ page }) => {
  await page.goto("/circuits.html");
  const bench = page.locator("#circuit-bench");
  await expect(bench).toBeVisible();

  const wheelPoint = await findEmptyBenchPoint(page);
  expect(wheelPoint).not.toBeNull();
  if (!wheelPoint) throw new Error("No empty bench point was available for wheel zoom testing.");
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -320);
  const zoomedViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  expect(zoomedViewBox[2]).toBeLessThan(BENCH_WIDTH);
  expect(zoomedViewBox[3]).toBeLessThan(BENCH_HEIGHT);

  await page.mouse.wheel(0, 320);
  const wheeledOutViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  expect(wheeledOutViewBox[2]).toBeGreaterThan(zoomedViewBox[2]);
  expect(wheeledOutViewBox[3]).toBeGreaterThan(zoomedViewBox[3]);

  await page.locator("#circuit-zoom-in").click();
  const buttonZoomedViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  const startPoint = await findEmptyBenchPoint(page);
  expect(startPoint).not.toBeNull();
  if (!startPoint) throw new Error("No empty bench point was available for pan testing.");
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(startPoint.x - 140, startPoint.y - 90, { steps: 8 });
  await page.mouse.up();

  const pannedViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  expect(Math.abs(pannedViewBox[0] - buttonZoomedViewBox[0]) + Math.abs(pannedViewBox[1] - buttonZoomedViewBox[1])).toBeGreaterThan(1);
  expect(pannedViewBox[2]).toBeCloseTo(buttonZoomedViewBox[2], 3);
  expect(pannedViewBox[3]).toBeCloseTo(buttonZoomedViewBox[3], 3);

  await page.locator("#circuit-zoom-reset").click();
  const resetViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  const resetCamera = await page.evaluate(() => window.__circuitLabCycle4.cameraState());
  expect(resetCamera.zoom).toBe(1.5);
  resetViewBox.forEach((value, index) => expect(value).toBeCloseTo(resetCamera.viewBox[index], 3));
  expect(resetViewBox[2]).toBeCloseTo(BENCH_WIDTH / 1.5, 3);
  expect(resetViewBox[3]).toBeCloseTo(BENCH_HEIGHT / 1.5, 3);

  await page.locator("#circuit-view-overview").click();
  const beforeComponentDragViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  const beforeMoveState = await page.evaluate(() => ({
    project: window.__circuitLabCycle4.project(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  const arduino = page.locator("#circuit-bench .bench-component[data-component-id='arduino']");
  const componentArtwork = arduino.locator(".component-artwork");
  const beforeTransform = await componentArtwork.getAttribute("transform");
  const componentBox = await arduino.locator(".component-hitbox").boundingBox();
  expect(componentBox).not.toBeNull();
  if (!componentBox) throw new Error("Arduino component was not visible for drag testing.");
  const dragStartX = componentBox.x + componentBox.width * 0.24;
  const dragStartY = componentBox.y + componentBox.height * 0.5;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 46, dragStartY + 24, { steps: 6 });
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(1);
  await expect(page.locator("#circuit-bench [data-placement-preview-bounds]")).toHaveCount(1);
  await expect(page.locator("#circuit-bench [data-placement-status='safe']")).toHaveCount(1);
  await page.mouse.up();

  const afterTransform = await componentArtwork.getAttribute("transform");
  const afterComponentDragViewBox = parseViewBox(await bench.getAttribute("viewBox"));
  const afterMoveState = await page.evaluate(() => ({
    project: window.__circuitLabCycle4.project(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  expect(afterTransform).not.toBe(beforeTransform);
  expect(afterMoveState.generation).toBe(beforeMoveState.generation + 1);
  expect(afterMoveState.history.undoCount).toBe(beforeMoveState.history.undoCount + 1);
  expect(afterMoveState.history.redoCount).toBe(0);
  expect(afterMoveState.project.connections).toEqual(beforeMoveState.project.connections);
  expect(afterMoveState.project.components.filter((component) => component.id !== "arduino"))
    .toEqual(beforeMoveState.project.components.filter((component) => component.id !== "arduino"));
  expect(afterMoveState.project.components.find((component) => component.id === "arduino")?.position)
    .not.toEqual(beforeMoveState.project.components.find((component) => component.id === "arduino")?.position);
  expect(afterComponentDragViewBox[0]).toBeCloseTo(beforeComponentDragViewBox[0], 3);
  expect(afterComponentDragViewBox[1]).toBeCloseTo(beforeComponentDragViewBox[1], 3);
  expect(afterComponentDragViewBox[2]).toBeCloseTo(beforeComponentDragViewBox[2], 3);
  expect(afterComponentDragViewBox[3]).toBeCloseTo(beforeComponentDragViewBox[3], 3);
});

test("Circuit Lab imports a local Fritzing part into the custom library", async ({ page }) => {
  await page.goto("/circuits.html");
  await openDrawer(page, "hardware");
  await expect(page.locator("[data-import-fritzing]")).toHaveCount(1);

  await page.setInputFiles("#fritzing-fzp-input", {
    name: "local-widget.fzp",
    mimeType: "text/xml",
    buffer: Buffer.from(SYNTHETIC_FZP)
  });
  await page.setInputFiles("#fritzing-svg-input", {
    name: "local-widget.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(SYNTHETIC_SVG)
  });

  await expect(page.locator("#hardware-list")).toContainText("Local Widget");
  const stableComponents = page.locator("#circuit-bench [data-bench-layer='components'] > .bench-component");
  await page.locator("[data-add-hardware='custom:localwidget']").click();
  await expect(stableComponents).toHaveCount(4);
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(1);
  await page.locator("#circuit-bench").press("Enter");
  await expect(stableComponents).toHaveCount(5);
  await expect(page.locator("#circuit-bench .custom-component-svg")).toHaveCount(1);

  await openDrawer(page, "hardware");
  await page.locator("[data-delete-custom-component='custom:localwidget']").click();
  await expect(page.locator("#hardware-list")).toContainText("No local custom components imported.");
  await expect(page.locator("#circuit-bench .custom-component-svg")).toHaveCount(0);
});

test("Cycle 2 placement commits complete safe constellations and blocks mechanical mismatches", async ({ page }) => {
  await page.goto("/circuits.html");
  await openWorkflowTab(page, "Inspect");
  await importCircuitProject(page, SAFE_PLACEMENT_PROJECT_JSON, "safe-placement.json");
  await selectComponentForInspector(page, "cap");
  await page.getByRole("button", { name: "Apply", exact: true }).dispatchEvent("click");

  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(2);
  await expect(page.locator("#circuit-status")).toContainText("updated");

  await importCircuitProject(page, MECHANICALLY_BLOCKED_PROJECT_JSON, "mechanically-blocked-placement.json");
  await selectComponentForInspector(page, "cap");
  await page.getByRole("button", { name: "Apply", exact: true }).dispatchEvent("click");

  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(0);
  await expect(page.locator("#circuit-status")).toContainText("Connection blocked");
});

test("Cycle 2 electrical hazard confirmation is non-modal, cancellable, stale-safe, and unsuppressed", async ({ page }) => {
  await page.goto("/circuits.html");
  await importHazardousPlacement(page);
  await stageHazardousPlacement(page);

  const confirmation = page.locator("#circuit-mutation-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(page.locator("#circuit-mutation-confirmation-title")).toContainText("Electrical hazard");
  await expect(page.locator("#circuit-mutation-confirmation-endpoints")).toContainText("470 uF electrolytic capacitor.+");
  await expect(page.locator("#circuit-mutation-confirmation-endpoints")).toContainText("BB400 400-point breadboard.15a");
  await expect(page.locator("#circuit-mutation-confirmation-endpoints")).toContainText("BB400 400-point breadboard.16a");
  await expect(page.locator("#circuit-mutation-confirmation-hazards")).toContainText("polarity");
  await expect(page.locator("#confirm-circuit-mutation")).toHaveText("Place anyway");
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expectHazardBaseConnectionsUnchanged(page);

  await stageHazardousPlacement(page);
  await editProjectName(page, "Generation changed");
  await expect(confirmation).toBeHidden();
  await page.locator("#confirm-circuit-mutation").evaluate((button) => button.click());
  await expectHazardBaseConnectionsUnchanged(page);

  await stageHazardousPlacement(page);
  await page.getByRole("button", { name: "Place anyway", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(2);
  await openWorkflowTab(page, "Test Results");
  await expect(page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "capacitor-polarity-reversed" })).not.toHaveCount(0);
});

test("Cycle 2 pending confirmation clears on mode, project, undo-redo, reset, and import boundaries", async ({ page }) => {
  await page.goto("/circuits.html");
  await importHazardousPlacement(page, "confirmation-boundaries.json");

  for (const mode of ["Place", "Wire", "Test", "Select"]) {
    await stageHazardousPlacement(page);
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
    await expectHazardBaseConnectionsUnchanged(page);
  }

  await stageHazardousPlacement(page);
  await editProjectName(page, "Project boundary");
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expectHazardBaseConnectionsUnchanged(page);

  await stageHazardousPlacement(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expectHazardBaseConnectionsUnchanged(page);

  await stageHazardousPlacement(page);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expectHazardBaseConnectionsUnchanged(page);

  await stageHazardousPlacement(page);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(0);

  await importHazardousPlacement(page, "confirmation-import-base.json");
  await stageHazardousPlacement(page);
  await importCircuitProject(page, SAFE_PLACEMENT_PROJECT_JSON, "replacement-import.json");
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(0);
});

test("Cycle 2 manual wiring commits plausible wires, blocks occupied endpoints, and confirms new hazards", async ({ page }) => {
  await page.goto("/circuits.html");
  await importCircuitProject(page, MANUAL_WIRE_PROJECT_JSON, "manual-wires.json");
  await page.getByRole("button", { name: "Wire", exact: true }).click();

  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r1a" });
  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r2a" });
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);

  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r1a" });
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);
  await expect(page.locator("#circuit-status")).toContainText("Connection blocked");

  await activateTerminalByKeyboard(page, { componentId: "supply", terminalId: "VPLUS" });
  await activateTerminalByKeyboard(page, { componentId: "supply", terminalId: "GND" });
  await expect(page.locator("#circuit-mutation-confirmation")).toBeVisible();
  await expect(page.locator("#confirm-circuit-mutation")).toHaveText("Connect anyway");
  await expect(page.locator("#circuit-mutation-confirmation-hazards")).toContainText("short");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);

  await activateTerminalByKeyboard(page, { componentId: "supply", terminalId: "VPLUS" });
  await activateTerminalByKeyboard(page, { componentId: "supply", terminalId: "GND" });
  await page.getByRole("button", { name: "Connect anyway", exact: true }).click();
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(2);
  await openWorkflowTab(page, "Test Results");
  await expect(page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "power-ground-short" })).not.toHaveCount(0);
});

test("Cycle 3 keeps projected endpoint identity and stable bench nodes through pointer, wheel, pan, and layout changes", async ({ page }) => {
  await page.goto("/circuits.html");
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  const d13 = await focusTerminalThroughResolver(page, { componentId: "arduino", terminalId: "D13" });
  expect(d13.endpoint).toEqual({ componentId: "arduino", terminalId: "D13" });
  await expect(page.locator("#circuit-precision-hud")).toBeVisible();
  await expect(page.locator("#circuit-precision-hud")).toContainText("D13");
  await expect(page.locator("#circuit-precision-hud")).toContainText("female-controller-header");
  await expect(page.locator("#circuit-precision-hud")).toContainText("exact-model-verified");
  await expect(page.locator("#circuit-bench .terminal-acquisition-halo")).toHaveCount(1);
  await expect(page.locator("#circuit-bench .terminal-exact-crosshair")).toHaveCount(1);
  await expect(page.locator("[data-terminal-component='arduino'][data-terminal-id='D13'][data-connector-glyph='female-header']")).toHaveCount(1);
  expect(await page.locator("[data-bench-layer='terminals']").evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");

  const componentLayer = await page.locator("[data-bench-layer='components']").elementHandle();
  const wireLayer = await page.locator("[data-bench-layer='committed-wires']").elementHandle();
  const terminalLayer = await page.locator("[data-bench-layer='terminals']").elementHandle();
  const arduinoNode = await page.locator("#circuit-bench .bench-component[data-component-id='arduino']").elementHandle();
  const committedWireNode = await page.locator("#circuit-bench .wire-path").first().elementHandle();
  const d13Node = await page.locator("[data-terminal-component='arduino'][data-terminal-id='D13']").elementHandle();
  if (!componentLayer || !wireLayer || !terminalLayer || !arduinoNode || !committedWireNode || !d13Node) {
    throw new Error("Stable Cycle 3 layers or nodes were not available.");
  }
  const before = await page.evaluate(() => ({
    diagnostics: window.__circuitLabCycle3.diagnostics(),
    resolver: window.__circuitLabCycle3.resolverStats()
  }));

  await page.mouse.move(d13.screenPoint[0], d13.screenPoint[1]);
  await page.mouse.move(d13.screenPoint[0] + 18, d13.screenPoint[1] + 8, { steps: 8 });
  const emptyPoint = await findEmptyBenchPoint(page);
  expect(emptyPoint).not.toBeNull();
  if (!emptyPoint) throw new Error("No empty point was available for stable pan verification.");
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.wheel(0, -320);
  await page.mouse.down();
  await page.mouse.move(emptyPoint.x - 75, emptyPoint.y - 35, { steps: 5 });
  await page.mouse.up();
  await openDrawer(page, "hardware");
  await page.locator("[data-toggle-shell-card='circuit-project-card']").click();
  await page.waitForTimeout(50);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(120);

  const d13After = await focusTerminalThroughResolver(page, { componentId: "arduino", terminalId: "D13" });
  expect(d13After.endpoint).toEqual({ componentId: "arduino", terminalId: "D13" });
  expect(await componentLayer.evaluate((node) => node === document.querySelector("[data-bench-layer='components']"))).toBe(true);
  expect(await wireLayer.evaluate((node) => node === document.querySelector("[data-bench-layer='committed-wires']"))).toBe(true);
  expect(await terminalLayer.evaluate((node) => node === document.querySelector("[data-bench-layer='terminals']"))).toBe(true);
  expect(await arduinoNode.evaluate((node) => node === document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']"))).toBe(true);
  expect(await committedWireNode.evaluate((node) => node === document.querySelector("#circuit-bench .wire-path"))).toBe(true);
  expect(await d13Node.evaluate((node) => node === document.querySelector("[data-terminal-component='arduino'][data-terminal-id='D13']"))).toBe(true);
  expect(await page.locator("#circuit-bench").evaluate((bench) => document.activeElement === bench)).toBe(true);

  const after = await page.evaluate(() => ({
    diagnostics: window.__circuitLabCycle3.diagnostics(),
    resolver: window.__circuitLabCycle3.resolverStats(),
    serialized: window.__circuitLabCycle3.serializedProject()
  }));
  expect(after.diagnostics.fullBenchReplacementCount).toBe(before.diagnostics.fullBenchReplacementCount);
  expect(after.diagnostics.stableBenchRenderCount).toBe(before.diagnostics.stableBenchRenderCount);
  expect(after.diagnostics.pointerFrameCount).toBeGreaterThan(before.diagnostics.pointerFrameCount);
  expect(after.diagnostics.wheelEventCount).toBeGreaterThan(before.diagnostics.wheelEventCount);
  expect(after.resolver.rebuildCount).toBeGreaterThan(before.resolver.rebuildCount);
  expect(after.resolver.lastInvalidationReason).toMatch(/panel-layout-change|viewport/u);
  expect(after.resolver.anchorCount).toBe(437);
  expect(after.serialized).not.toMatch(/screenPoint|targeting|ambiguityAction|focusedEndpoint|historyStack/u);
});

test("Cycle 3 click-click cancellation keeps the exact start endpoint while true self-drop stays invalid", async ({ page }) => {
  await page.goto("/circuits.html");
  await importCircuitProject(page, MANUAL_WIRE_PROJECT_JSON, "cycle-3-click-cancel.json");
  await page.getByRole("button", { name: "Wire", exact: true }).click();

  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r20a" });
  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r20a" });
  await expect(page.locator("#circuit-status")).toContainText("Wire start cleared");
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(0);

  for (let index = 0; index < 4; index += 1) await page.locator("#circuit-zoom-in").evaluate((button) => button.click());
  const pointerStart = await focusTerminalThroughResolver(page, { componentId: "bb", terminalId: "r20a" });
  await page.mouse.click(pointerStart.screenPoint[0], pointerStart.screenPoint[1]);
  await expect(page.locator("#wire-status")).toContainText("20a");
  await page.mouse.click(pointerStart.screenPoint[0], pointerStart.screenPoint[1]);
  await expect(page.locator("#circuit-status")).toContainText("Wire start cleared");
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(0);

  const selfDropStart = await overviewTerminalForPointer(page, { componentId: "bb", terminalId: "r22a" });
  await page.mouse.move(selfDropStart.screenPoint[0], selfDropStart.screenPoint[1]);
  await page.mouse.down();
  await page.mouse.move(selfDropStart.screenPoint[0] + 18, selfDropStart.screenPoint[1] + 12, { steps: 3 });
  await page.mouse.move(selfDropStart.screenPoint[0], selfDropStart.screenPoint[1], { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#circuit-status")).toContainText("already the wire start");
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(0);
});

test("Cycle 3 preserves a nearer full target, exposes exact capacity, and catches blocked pointer commits", async ({ page }) => {
  await page.goto("/circuits.html");
  await importCircuitProject(page, MANUAL_WIRE_PROJECT_JSON, "cycle-3-full-target.json");
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r1a" });
  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r2a" });
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);

  for (let index = 0; index < 4; index += 1) await page.locator("#circuit-zoom-in").evaluate((button) => button.click());
  const fullTarget = await focusTerminalThroughResolver(page, { componentId: "bb", terminalId: "r1a" });
  const resolution = await page.evaluate(({ point }) => window.__circuitLabCycle3.resolveAtClient(point, "mouse"), {
    point: fullTarget.screenPoint
  });
  expect(resolution.target.endpointKey).toBe("bb:r1a");
  expect(resolution.target.invalidReason).toContain("full (1/1 attachments)");
  await page.locator("#circuit-bench").evaluate((bench, point) => {
    bench.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 31,
      pointerType: "mouse",
      clientX: point[0],
      clientY: point[1]
    }));
  }, fullTarget.screenPoint);
  await expect(page.locator("#circuit-status")).toContainText("Connection blocked");
  await expect(page.locator("#circuit-precision-hud")).toContainText("1/1");
  await expect(page.locator("#circuit-precision-hud")).toContainText("Cannot connect");
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);

  const dragStart = await overviewTerminalForPointer(page, { componentId: "bb", terminalId: "r20a" });
  const dragEnd = await focusTerminalThroughResolver(page, { componentId: "bb", terminalId: "r22a" });
  const benchBox = await page.locator("#circuit-bench").boundingBox();
  if (!benchBox) throw new Error("Circuit bench is not visible for pointer connection.");
  expect(dragEnd.screenPoint[0]).toBeGreaterThanOrEqual(benchBox.x);
  expect(dragEnd.screenPoint[0]).toBeLessThanOrEqual(benchBox.x + benchBox.width);
  expect(dragEnd.screenPoint[1]).toBeGreaterThanOrEqual(benchBox.y);
  expect(dragEnd.screenPoint[1]).toBeLessThanOrEqual(benchBox.y + benchBox.height);
  const replacementsBeforeDrag = await page.evaluate(() => window.__circuitLabCycle3.diagnostics().fullBenchReplacementCount);
  await page.mouse.move(dragStart.screenPoint[0], dragStart.screenPoint[1]);
  await page.mouse.down();
  await page.mouse.move(dragEnd.screenPoint[0], dragEnd.screenPoint[1], { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(2);
  expect(await page.evaluate(() => window.__circuitLabCycle3.diagnostics().fullBenchReplacementCount)).toBe(replacementsBeforeDrag);
});

test("Cycle 3 touch ambiguity exposes no more than four accessible candidates and exact-choice wiring", async ({ page }) => {
  await page.goto("/circuits.html");
  await importCircuitProject(page, MANUAL_WIRE_PROJECT_JSON, "cycle-3-touch-ambiguity.json");
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  const r15a = await focusTerminalThroughResolver(page, { componentId: "bb", terminalId: "r15a" });
  const touchResolution = await page.evaluate(({ point }) => window.__circuitLabCycle3.resolveAtClient(point, "touch"), {
    point: r15a.screenPoint
  });
  expect(touchResolution.ambiguityCount).toBeGreaterThan(4);
  await page.locator("#circuit-bench").evaluate((bench, point) => {
    bench.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 41,
      pointerType: "touch",
      clientX: point[0],
      clientY: point[1]
    }));
  }, r15a.screenPoint);
  await expect(page.locator("#circuit-precision-hud")).toBeVisible();
  await expect(page.locator("#circuit-precision-hud")).toContainText(/contacts are within the touch precision band/u);
  const chooserButtons = page.locator("#circuit-precision-hud [data-precision-candidate]");
  const candidateCount = await chooserButtons.count();
  expect(candidateCount).toBeGreaterThan(1);
  expect(candidateCount).toBeLessThanOrEqual(4);
  const firstButtonBox = await chooserButtons.first().boundingBox();
  expect(firstButtonBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(firstButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#circuit-precision-hud [data-precision-action='frame-port']")).toHaveCount(1);
  await expect(page.locator("#circuit-precision-hud [data-precision-action='add-zoom']")).toHaveCount(1);
  expect(await page.evaluate(() => window.__circuitLabCycle3.targetingState().lockedEndpointKey)).toBe("bb:r15a");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__circuitLabCycle3.targetingState())).toEqual({
    lockedEndpointKey: null,
    resolutionEndpointKey: null,
    ambiguous: false
  });
  await page.locator("#circuit-bench").evaluate((bench, point) => {
    bench.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 42,
      pointerType: "touch",
      clientX: point[0],
      clientY: point[1]
    }));
  }, r15a.screenPoint);
  const r15Choice = page.locator("#circuit-precision-hud [data-precision-candidate='bb:r15a']");
  await expect(r15Choice).toHaveCount(1);
  await r15Choice.click();
  await expect(page.locator("#wire-status")).toContainText("15a");

  await activateTerminalByKeyboard(page, { componentId: "bb", terminalId: "r16a" });
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
});

test("Cycle 2 stale direct insertions stay blocking until atomic Re-seat or Disconnect", async ({ page }) => {
  await page.goto("/circuits.html");
  await importCircuitProject(page, STALE_INSERTION_PROJECT_JSON, "stale-insertion.json");
  await openWorkflowTab(page, "Test Results");

  const staleIssue = page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "stale-direct-insertion" });
  await expect(staleIssue).not.toHaveCount(0);
  await expect(page.locator("#circuit-bench .wire-path--stale-insertion")).toHaveCount(2);
  await staleIssue.first().getByRole("button", { name: "Re-seat", exact: true }).click();
  await expect(page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "stale-direct-insertion" })).toHaveCount(0);
  await expect(page.locator("#circuit-bench .wire-path--stale-insertion")).toHaveCount(0);
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(2);

  await importCircuitProject(page, STALE_INSERTION_PROJECT_JSON, "stale-insertion-again.json");
  await page.getByRole("tab", { name: "Test Results" }).click();
  const reloadedStaleIssue = page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "stale-direct-insertion" });
  await expect(reloadedStaleIssue).not.toHaveCount(0);
  await reloadedStaleIssue.first().getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "stale-direct-insertion" })).toHaveCount(0);
  await expect(page.locator("#circuit-wire-list .circuit-item").filter({ hasText: "direct-insertion" })).toHaveCount(0);
});
