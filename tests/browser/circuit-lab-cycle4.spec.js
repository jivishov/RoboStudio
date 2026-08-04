import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  addComponent,
  connectTerminals,
  createCircuitLabProject,
  normalizeProject,
  serializeCircuitLabProject,
  updateComponent
} from "../../src/circuits/model.js";
import { catalog } from "../../src/circuits/catalog.js";
import { resolveTerminal } from "../../src/circuits/connectivity.js";

const consoleByPage = new WeakMap();

function emptyProject(name = "Cycle 4 browser project") {
  return normalizeProject({
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    name,
    components: [],
    connections: [],
    mode: "select",
    app: { kind: "cycle-4-browser" }
  });
}

function breadboardOnlyProjectJson() {
  return serializeCircuitLabProject(addComponent(emptyProject("Keyboard-only wiring"), "breadboard-bb400-400", {
    id: "bb",
    position: [525, 325]
  }));
}

function capacitorPlacementFixtures() {
  let safeBase = addComponent(emptyProject("Safe placement"), "breadboard-bb400-400", {
    id: "bb",
    position: [525, 325]
  });
  const safeTarget = resolveTerminal(safeBase, { componentId: "bb", terminalId: "r15a" });
  const capacitor = catalog.getComponent("capacitor-electrolytic-470uf");
  const capacitorPositive = capacitor.terminals.find((terminal) => terminal.id === "pos");
  const safePoint = [
    safeTarget.worldPosition[0] - capacitorPositive.position[0],
    safeTarget.worldPosition[1] - capacitorPositive.position[1]
  ];

  let hazardousBase = safeBase;
  hazardousBase = addComponent(hazardousBase, "supply-servo-6v", { id: "supply", position: [110, 105] });
  hazardousBase = connectTerminals(hazardousBase, { componentId: "supply", terminalId: "GND" }, { componentId: "bb", terminalId: "r15b" }, { id: "ground_row" });
  hazardousBase = connectTerminals(hazardousBase, { componentId: "supply", terminalId: "VPLUS" }, { componentId: "bb", terminalId: "r16b" }, { id: "power_row" });

  let blockedBase = addComponent(emptyProject("Blocked placement"), "led-red", { id: "led", position: [525, 325] });
  const ledTarget = resolveTerminal(blockedBase, { componentId: "led", terminalId: "anode" });
  const blockedPoint = [
    ledTarget.worldPosition[0] - capacitorPositive.position[0],
    ledTarget.worldPosition[1] - capacitorPositive.position[1]
  ];
  return {
    safeBaseJson: serializeCircuitLabProject(safeBase),
    hazardousBaseJson: serializeCircuitLabProject(hazardousBase),
    blockedBaseJson: serializeCircuitLabProject(blockedBase),
    safePoint,
    blockedPoint
  };
}

const FIXTURES = capacitorPlacementFixtures();

async function waitForCycle4(page) {
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));
}

async function openDrawer(page, name) {
  const trigger = page.locator(name === "hardware" ? "#open-circuit-hardware-drawer" : "#open-circuit-workflow-drawer");
  if (!(await trigger.isVisible())) return;
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}

async function closeDrawer(page) {
  await page.evaluate(() => window.__circuitLabCycle4.closeDrawer());
}

async function openWorkflowTab(page, name) {
  await openDrawer(page, "workflow");
  await page.getByRole("tab", { name, exact: true }).click();
}

async function importProject(page, json, name = "cycle4-project.json") {
  const beforeGeneration = await page.evaluate(() => window.__circuitLabCycle4.generation());
  await page.setInputFiles("#circuit-lab-file-input", {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(json)
  });
  await expect.poll(() => page.evaluate(() => window.__circuitLabCycle4.generation())).toBeGreaterThan(beforeGeneration);
}

async function readSavedCircuitLabProject(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    // No explicit version: opening at a stale version throws VersionError, so this read
    // must follow whatever version the app's own opener has upgraded the database to.
    const openRequest = indexedDB.open("stl-assembly-studio");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const request = database.transaction("circuit-designs", "readonly")
        .objectStore("circuit-designs")
        .get("current-circuit-lab-project");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        database.close();
        resolve(request.result ?? null);
      };
    };
  }));
}

async function exportedProjectJson(page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Circuit Lab JSON", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Circuit Lab JSON download did not produce a local artifact.");
  return readFile(downloadPath, "utf8");
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  page.on("dialog", (dialog) => dialog.accept());
  const errors = [];
  consoleByPage.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/circuits.html");
  await waitForCycle4(page);
});

test.afterEach(async ({ page }) => {
  expect(consoleByPage.get(page) ?? []).toEqual([]);
});

test("Cycle 4 camera is presentation-only at 150 percent and preserves state across non-camera workflows", async ({ page }) => {
  const initial = await page.evaluate(() => window.__circuitLabCycle4.cameraState());
  expect(initial.zoom).toBe(1.5);
  await expect(page.locator("#circuit-zoom-level")).toHaveText("View 150%");
  const serializedBefore = await page.evaluate(() => window.__circuitLabCycle4.serializedProject());

  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 1, center: [470, 410], userAdjusted: false }));
  const bounds100 = await page.locator("#circuit-bench .bench-component[data-component-id='breadboard'] .component-artwork").boundingBox();
  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 1.5, center: [470, 410], userAdjusted: false }));
  const bounds150 = await page.locator("#circuit-bench .bench-component[data-component-id='breadboard'] .component-artwork").boundingBox();
  expect(bounds100).not.toBeNull();
  expect(bounds150).not.toBeNull();
  expect(bounds150.width / bounds100.width).toBeGreaterThanOrEqual(1.48);
  expect(bounds150.width / bounds100.width).toBeLessThanOrEqual(1.52);
  expect(bounds150.height / bounds100.height).toBeGreaterThanOrEqual(1.48);
  expect(bounds150.height / bounds100.height).toBeLessThanOrEqual(1.52);
  expect(await page.evaluate(() => window.__circuitLabCycle4.serializedProject())).toBe(serializedBefore);

  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 2.2, center: [470, 410] }));
  const cameraBeforeWorkflow = await page.evaluate(() => window.__circuitLabCycle4.cameraState());
  await openWorkflowTab(page, "Test Results");
  expect((await page.evaluate(() => window.__circuitLabCycle4.project())).mode).toBe("select");
  await closeDrawer(page);
  const cameraAfterWorkflow = await page.evaluate(() => window.__circuitLabCycle4.cameraState());
  expect(cameraAfterWorkflow.zoom).toBeCloseTo(cameraBeforeWorkflow.zoom, 6);
  expect(cameraAfterWorkflow.center).toEqual(cameraBeforeWorkflow.center);

  await openDrawer(page, "hardware");
  await page.locator("#circuit-component-list [data-component-id='arduino']").dispatchEvent("click");
  await closeDrawer(page);
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBeCloseTo(2.2, 6);
  await page.locator("#circuit-zoom-reset").click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBe(1.5);
  await page.locator("#circuit-view-frame").click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBeLessThanOrEqual(8);
  await page.locator("#circuit-view-overview").click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBeLessThanOrEqual(1.5);
});

test("Cycle 4 camera leaves physical scale, terminal geometry, insertion, IndexedDB, and export invariant", async ({ page }) => {
  await importProject(page, FIXTURES.safeBaseJson, "camera-invariants.json");
  await page.evaluate(({ point }) => {
    window.__circuitLabCycle4.beginPlacement("capacitor-electrolytic-470uf");
    window.__circuitLabCycle4.movePlacement(point);
    window.__circuitLabCycle4.cancelPlacement("Camera invariant setup canceled.", { announce: false });
  }, { point: FIXTURES.safePoint });

  const snapshotAt = async (zoom) => {
    await page.evaluate((value) => window.__circuitLabCycle4.setCamera({ zoom: value, center: [525, 325], userAdjusted: false }), zoom);
    const project = await page.evaluate(() => window.__circuitLabCycle4.project());
    const terminalGeometry = await page.evaluate(() => window.__circuitLabCycle4.terminalGeometry({ componentId: "bb", terminalId: "r15a" }));
    const insertion = await page.evaluate(({ point }) => {
      window.__circuitLabCycle4.beginPlacement("capacitor-electrolytic-470uf");
      const preview = window.__circuitLabCycle4.movePlacement(point);
      window.__circuitLabCycle4.cancelPlacement("Camera insertion probe canceled.", { announce: false });
      return {
        status: preview.status,
        exactEndpointPairs: preview.exactEndpointPairs
      };
    }, { point: FIXTURES.safePoint });
    const serialized = await page.evaluate(() => window.__circuitLabCycle4.serializedProject());
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    await expect(page.locator("#circuit-status")).toContainText("saved to browser storage");
    const indexedDbProject = await readSavedCircuitLabProject(page);
    const exported = await exportedProjectJson(page);
    return {
      propsScale: project.components.find((component) => component.id === "bb")?.props?.scale ?? 1,
      terminalGeometry,
      insertion,
      serialized,
      indexedDbProject,
      exported
    };
  };

  const at100 = await snapshotAt(1);
  const at150 = await snapshotAt(1.5);
  expect(at150).toEqual(at100);
});

test("Cycle 4 new, template, import, hydration, undo, and redo camera lifecycles obey the user-adjusted guard", async ({ page }) => {
  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 2.4, center: [640, 330] }));
  await importProject(page, FIXTURES.safeBaseJson, "explicit-import.json");
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBe(1.5);

  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 2.6, center: [610, 310] }));
  const guarded = await page.evaluate((project) => window.__circuitLabCycle4.simulateLateHydration(project), JSON.parse(FIXTURES.blockedBaseJson));
  expect(guarded.camera.zoom).toBeCloseTo(2.6, 6);
  expect(guarded.camera.center).toEqual([610, 310]);

  const preHydrationName = await page.evaluate(() => window.__circuitLabCycle4.project().name);
  const preHydrationPlacement = await page.evaluate((lateProject) => {
    window.__circuitLabCycle4.beginHydrationGuardProbe();
    window.__circuitLabCycle4.beginPlacement("motor-dc", { source: "pre-hydration-card" });
    return window.__circuitLabCycle4.finishHydrationGuardProbe(lateProject);
  }, JSON.parse(FIXTURES.safeBaseJson));
  expect(preHydrationPlacement.outcome).toBe("preserved-user-edit");
  expect(preHydrationPlacement.userEditedBeforeStorageHydration).toBe(true);
  expect(preHydrationPlacement.project.mode).toBe("place");
  expect(preHydrationPlacement.project.name).toBe(preHydrationName);
  expect(preHydrationPlacement.project.name).not.toBe("Safe placement");
  expect(preHydrationPlacement.placement?.typeId).toBe("motor-dc");
  await page.evaluate(() => window.__circuitLabCycle4.cancelPlacement());

  await page.getByRole("button", { name: "New project", exact: true }).click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBe(1.5);
  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 2.1, center: [500, 300] }));
  await openDrawer(page, "hardware");
  await page.locator("[data-starter-template]").first().click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBe(1.5);

  await page.evaluate(() => window.__circuitLabCycle4.setCamera({ zoom: 2.25, center: [500, 315] }));
  await page.evaluate(async () => {
    await window.__circuitLabCycle4.executeAssistantAction("circuits_add_hardware", {
      componentTypeId: "motor-dc",
      name: "Immediate assistant motor",
      position: [700, 180]
    });
  });
  expect(await page.evaluate(() => window.__circuitLabCycle4.placementState())).toBeNull();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBeCloseTo(2.25, 6);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBeCloseTo(2.25, 6);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await page.evaluate(() => window.__circuitLabCycle4.cameraState())).zoom).toBeCloseTo(2.25, 6);
});

test("Cycle 4 card, pointer, native-drop, cancel, block, hazard, and assistant placement share staged semantics", async ({ page }) => {
  const stableComponents = page.locator("#circuit-bench [data-bench-layer='components'] > .bench-component");
  const baseCount = await stableComponents.count();
  await openDrawer(page, "hardware");
  await page.locator("[data-add-hardware='ultrasonic-hcsr04']").click();
  if (await page.locator("#open-circuit-hardware-drawer").isVisible()) {
    await expect(page.locator("#open-circuit-hardware-drawer")).toHaveAttribute("aria-expanded", "false");
    expect((await page.evaluate(() => window.__circuitLabCycle4.drawerState())).openDrawer).toBeNull();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("circuit-bench");
  }
  await expect(page.getByRole("button", { name: "Place", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(1);
  await expect(page.locator("#circuit-bench [data-placement-preview-component-id] .physical-port-housing").first()).toBeVisible();
  await expect(page.locator("#circuit-bench [data-placement-preview-bounds]")).toHaveCount(1);
  await expect(page.locator("#circuit-bench [data-placement-status='safe']")).toHaveCount(1);
  expect(await stableComponents.count()).toBe(baseCount);
  const afterStart = await page.evaluate(() => ({
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history(),
    serialized: window.__circuitLabCycle4.serializedProject()
  }));
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__circuitLabCycle4.placementState())).toBeNull();
  expect(await page.evaluate(() => window.__circuitLabCycle4.generation())).toBe(afterStart.generation);
  expect(await page.evaluate(() => window.__circuitLabCycle4.history())).toEqual(afterStart.history);
  expect(await page.evaluate(() => window.__circuitLabCycle4.serializedProject())).toBe(afterStart.serialized);

  await openDrawer(page, "hardware");
  await page.locator("[data-add-hardware='ultrasonic-hcsr04']").click();
  const benchBox = await page.locator("#circuit-bench").boundingBox();
  if (!benchBox) throw new Error("Circuit bench is not visible.");
  const underlying = await page.locator("#circuit-bench .bench-component[data-component-id='breadboard']").boundingBox();
  if (!underlying) throw new Error("Underlying breadboard is not visible.");
  await page.mouse.click(underlying.x + underlying.width / 2, underlying.y + underlying.height / 2);
  await expect(stableComponents).toHaveCount(baseCount + 1);
  expect(await page.evaluate(() => window.__circuitLabCycle4.placementState())).toBeNull();
  const pointerCommit = await page.evaluate(() => ({
    project: window.__circuitLabCycle4.project(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  expect(pointerCommit.project.components).toHaveLength(baseCount + 1);
  expect(pointerCommit.project.components.find((component) => component.id === pointerCommit.project.selectedComponentId)?.typeId).toBe("ultrasonic-hcsr04");
  expect(pointerCommit.generation).toBe(afterStart.generation + 1);
  expect(pointerCommit.history.undoCount).toBe(afterStart.history.undoCount + 1);

  await openDrawer(page, "hardware");
  const nativeItem = page.locator("[data-hardware-item='motor-tt-gearmotor']");
  const dropPoint = { x: Math.floor(benchBox.x + benchBox.width * 0.78), y: Math.floor(benchBox.y + benchBox.height * 0.72) };
  const expectedWorld = await page.locator("#circuit-bench").evaluate((bench, point) => {
    const svgPoint = bench.createSVGPoint();
    svgPoint.x = point.x;
    svgPoint.y = point.y;
    const transformed = svgPoint.matrixTransform(bench.getScreenCTM().inverse());
    return [transformed.x, transformed.y];
  }, dropPoint);
  await nativeItem.evaluate((item, point) => {
    const data = new DataTransfer();
    item.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }));
    const bench = document.querySelector("#circuit-bench");
    bench.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data, clientX: point.x, clientY: point.y }));
    bench.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data, clientX: point.x, clientY: point.y }));
    item.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
  }, dropPoint);
  const dropped = await page.evaluate(() => window.__circuitLabCycle4.project().components.filter((item) => item.typeId === "motor-tt-gearmotor").at(-1));
  expect(dropped.position[0]).toBeCloseTo(expectedWorld[0], 0);
  expect(dropped.position[1]).toBeCloseTo(expectedWorld[1], 0);

  await importProject(page, FIXTURES.safeBaseJson, "safe-placement.json");
  const safeBefore = await page.evaluate(() => ({
    project: window.__circuitLabCycle4.project(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  const safe = await page.evaluate(({ point }) => {
    window.__circuitLabCycle4.beginPlacement("capacitor-electrolytic-470uf");
    return window.__circuitLabCycle4.movePlacement(point);
  }, { point: FIXTURES.safePoint });
  expect(safe.status.key).toBe("safe");
  expect(safe.exactEndpointPairs).toHaveLength(2);
  await expect(page.locator("#circuit-bench [data-placement-preview-bounds][data-placement-preview-shape='safe']")).toHaveCount(1);
  await expect(page.locator("#circuit-bench .placement-preview__match")).toHaveCount(safe.exactEndpointPairs.length);
  await expect(page.locator("#circuit-bench .placement-preview__contact")).toHaveCount(safe.exactEndpointPairs.length * 2);
  await page.evaluate(() => window.__circuitLabCycle4.commitPlacement());
  const safeAfter = await page.evaluate(() => ({
    project: window.__circuitLabCycle4.project(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  expect(safeAfter.project.components).toHaveLength(safeBefore.project.components.length + 1);
  expect(safeAfter.project.connections).toHaveLength(safeBefore.project.connections.length + safe.exactEndpointPairs.length);
  expect(safeAfter.generation).toBe(safeBefore.generation + 2);
  expect(safeAfter.history.undoCount).toBe(safeBefore.history.undoCount + 1);

  await importProject(page, FIXTURES.blockedBaseJson, "blocked-placement.json");
  const blockedCount = await stableComponents.count();
  const blocked = await page.evaluate(({ point }) => {
    window.__circuitLabCycle4.beginPlacement("capacitor-electrolytic-470uf");
    return window.__circuitLabCycle4.movePlacement(point);
  }, { point: FIXTURES.blockedPoint });
  expect(blocked.status.key).toBe("blocked");
  await page.evaluate(() => window.__circuitLabCycle4.commitPlacement());
  await expect(page.locator("#circuit-mutation-confirmation")).toBeHidden();
  await expect(stableComponents).toHaveCount(blockedCount);
  await page.keyboard.press("Escape");

  await importProject(page, FIXTURES.hazardousBaseJson, "hazardous-placement.json");
  const hazardBaseCount = await stableComponents.count();
  const hazardous = await page.evaluate(({ point }) => {
    window.__circuitLabCycle4.beginPlacement("capacitor-electrolytic-470uf");
    return window.__circuitLabCycle4.movePlacement(point);
  }, { point: FIXTURES.safePoint });
  expect(hazardous.status.key).toBe("hazard");
  expect(hazardous.exactEndpointPairs).toHaveLength(2);
  await expect(page.locator("#circuit-bench [data-placement-preview-bounds][data-placement-preview-shape='hazard']")).toHaveCount(1);
  await expect(page.locator("#circuit-bench .placement-preview__match")).toHaveCount(hazardous.exactEndpointPairs.length);
  await page.evaluate(() => window.__circuitLabCycle4.commitPlacement());
  await expect(page.locator("#circuit-mutation-confirmation")).toBeVisible();
  await expect(stableComponents).toHaveCount(hazardBaseCount);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(stableComponents).toHaveCount(hazardBaseCount);
  expect(await page.evaluate(() => window.__circuitLabCycle4.serializedProject())).not.toMatch(/"(?:placement|ghost|screenPoint|drawer|camera|viewBox)"\s*:/u);
});

test("Cycle 4 canceled existing movement preserves transform, insertion state, generation, and history", async ({ page }) => {
  const before = await page.evaluate(() => ({
    serialized: window.__circuitLabCycle4.serializedProject(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  const breadboard = page.locator("#circuit-bench .bench-component[data-component-id='breadboard']");
  const box = await breadboard.boundingBox();
  if (!box) throw new Error("Breadboard is not visible.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 38, box.y + box.height / 2 + 24, { steps: 5 });
  await expect(page.locator("#circuit-bench .bench-component--ghost")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    serialized: window.__circuitLabCycle4.serializedProject(),
    generation: window.__circuitLabCycle4.generation(),
    history: window.__circuitLabCycle4.history()
  }));
  expect(after).toEqual(before);
});

test("Cycle 4 overlay drawers, Test Results workflow, and accessibility semantics preserve the bench", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const bench = page.locator("#circuit-bench");
  const beforeBox = await bench.boundingBox();
  const beforeViewBox = await bench.getAttribute("viewBox");
  const componentLayer = await page.locator("[data-bench-layer='components']").elementHandle();
  const arduino = await page.locator("#circuit-bench .bench-component[data-component-id='arduino']").elementHandle();
  await openDrawer(page, "hardware");
  const afterHardwareBox = await bench.boundingBox();
  expect(afterHardwareBox).toEqual(beforeBox);
  expect(await bench.getAttribute("viewBox")).toBe(beforeViewBox);
  expect(await page.locator("#open-circuit-hardware-drawer").getAttribute("aria-expanded")).toBe("true");
  await openDrawer(page, "workflow");
  expect(await page.locator("#open-circuit-hardware-drawer").getAttribute("aria-expanded")).toBe("false");
  expect(await page.locator("#open-circuit-workflow-drawer").getAttribute("aria-expanded")).toBe("true");
  expect(await componentLayer.evaluate((node) => node === document.querySelector("[data-bench-layer='components']"))).toBe(true);
  expect(await arduino.evaluate((node) => node === document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']"))).toBe(true);
  expect(await bench.getAttribute("viewBox")).toBe(beforeViewBox);

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await page.getByRole("tab", { name: "Test Results" }).click();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "circuit-tab-test-results");
  expect((await page.evaluate(() => window.__circuitLabCycle4.project())).mode).toBe("select");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Test Results" })).toHaveAttribute("aria-selected", "true");
  expect((await page.evaluate(() => window.__circuitLabCycle4.project())).mode).toBe("test");

  await page.getByRole("button", { name: "Close Inspector and Workflow drawer" }).focus();
  await page.keyboard.press("Escape");
  expect(await page.locator("#open-circuit-workflow-drawer").getAttribute("aria-expanded")).toBe("false");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("open-circuit-workflow-drawer");
  const drawerState = await page.evaluate(() => window.__circuitLabCycle4.drawerState());
  expect(drawerState.hardwareInert).toBe(true);
  expect(drawerState.workflowInert).toBe(true);

  expect(await page.locator("[role='img'] button, [role='img'] [tabindex='0']").count()).toBe(0);
  expect(await page.locator("#circuit-bench [data-terminal-key][tabindex]").count()).toBe(0);
  await expect(bench).toHaveAttribute("aria-activedescendant", "circuit-active-terminal-proxy");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionDuration = await page.locator("#circuit-workflow-drawer").evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.00001);
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight - document.documentElement.clientHeight
  }));
  expect(overflow.width).toBeLessThanOrEqual(1);
  expect(overflow.height).toBeLessThanOrEqual(1);
});

test("Cycle 4 keyboard-only wiring uses aria-activedescendant, arrow navigation, Escape priority, and one polite region", async ({ page }) => {
  await importProject(page, breadboardOnlyProjectJson(), "keyboard-only.json");
  if ((await page.viewportSize())?.width < 1200) {
    const compactAssistantClearance = await page.evaluate(() => {
      const assistant = document.querySelector("#circuit-lab-app ~ .assistant-card.is-collapsed")?.getBoundingClientRect();
      const toolbar = document.querySelector(".circuit-mode-tabs")?.getBoundingClientRect();
      const app = document.querySelector("#circuit-lab-app")?.getBoundingClientRect();
      const wire = document.querySelector("[data-circuit-mode='wire']")?.getBoundingClientRect();
      const hit = wire ? document.elementFromPoint(wire.left + wire.width / 2, wire.top + wire.height / 2) : null;
      const intersects = (left, right) => Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top);
      return {
        assistant: assistant ? { left: assistant.left, top: assistant.top, right: assistant.right, bottom: assistant.bottom } : null,
        toolbar: toolbar ? { left: toolbar.left, top: toolbar.top, right: toolbar.right, bottom: toolbar.bottom } : null,
        intersectsToolbar: intersects(assistant, toolbar),
        clearsApplication: Boolean(assistant && app && assistant.top >= app.bottom),
        wireHitIsButton: Boolean(hit?.closest?.("[data-circuit-mode='wire']"))
      };
    });
    expect(compactAssistantClearance.assistant).not.toBeNull();
    expect(compactAssistantClearance.toolbar).not.toBeNull();
    expect(compactAssistantClearance.intersectsToolbar).toBe(false);
    expect(compactAssistantClearance.clearsApplication).toBe(true);
    expect(compactAssistantClearance.wireHitIsButton).toBe(true);
  }
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  await expect(page.locator("#wire-status")).toContainText("First Wire");
  const bench = page.locator("#circuit-bench");
  await bench.focus();
  await page.keyboard.press("ArrowRight");
  const firstKey = await page.locator("#circuit-active-terminal-proxy").getAttribute("data-endpoint-key");
  expect(firstKey).toBeTruthy();
  await page.keyboard.press("Enter");
  await expect(page.locator("#wire-status")).toContainText("Wire start");
  await page.keyboard.press("ArrowRight");
  const secondKey = await page.locator("#circuit-active-terminal-proxy").getAttribute("data-endpoint-key");
  expect(secondKey).not.toBe(firstKey);
  await page.keyboard.press("Space");
  await expect(page.locator("#circuit-wire-list [data-connection-id]")).toHaveCount(1);
  await expect(page.locator("#circuit-live-region")).toContainText("Wire connected");
  expect(await page.evaluate(() => window.__circuitLabCycle4.wireHintDismissed())).toBe(true);

  await page.setViewportSize({ width: 1024, height: 768 });
  await openDrawer(page, "hardware");
  await page.evaluate(() => window.__circuitLabCycle3.focusTerminal({ componentId: "bb", terminalId: "r20a" }));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator("#wire-status")).not.toContainText("Wire start");
  expect((await page.evaluate(() => window.__circuitLabCycle4.drawerState())).openDrawer).toBe("hardware");
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => window.__circuitLabCycle4.drawerState())).openDrawer).toBeNull();

  await bench.focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("circuit-bench");
  await expect(page.locator("#circuit-live-region")).toHaveAttribute("aria-live", "polite");
  expect(await page.locator("#circuit-lab-app #circuit-live-region").count()).toBe(1);
  const announcement = await page.locator("#circuit-live-region").textContent();
  await page.mouse.move(120, 160);
  await page.mouse.move(360, 260);
  expect(await page.locator("#circuit-live-region").textContent()).toBe(announcement);
});

test("Cycle 4 touch placement and ambiguity controls complete without mobile layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet-chromium", "Touch workflow is covered on the configured tablet profile.");
  const baseCount = await page.locator("#circuit-bench .bench-component").count();
  await openDrawer(page, "hardware");
  await page.locator("[data-add-hardware='motor-dc']").click();
  await expect(page.locator("#open-circuit-hardware-drawer")).toHaveAttribute("aria-expanded", "false");
  expect((await page.evaluate(() => window.__circuitLabCycle4.drawerState())).openDrawer).toBeNull();
  expect((await page.evaluate(() => window.__circuitLabCycle4.placementState())).typeId).toBe("motor-dc");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("circuit-bench");
  const benchBox = await page.locator("#circuit-bench").boundingBox();
  if (!benchBox) throw new Error("Circuit bench is not visible.");
  await page.touchscreen.tap(benchBox.x + benchBox.width * 0.68, benchBox.y + benchBox.height * 0.62);
  await expect(page.locator("#circuit-bench .bench-component")).toHaveCount(baseCount + 1);

  await importProject(page, breadboardOnlyProjectJson(), "touch-ambiguity.json");
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  const focused = await page.evaluate(() => window.__circuitLabCycle3.focusTerminal({ componentId: "bb", terminalId: "r15a" }));
  await page.locator("#circuit-bench").evaluate((bench, point) => {
    bench.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 94,
      pointerType: "touch",
      clientX: point[0],
      clientY: point[1]
    }));
  }, focused.screenPoint);
  const chooser = page.locator("#circuit-precision-hud [data-precision-candidate]");
  await expect(chooser).not.toHaveCount(0);
  const box = await chooser.first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await chooser.first().tap();
  await expect(page.locator("#wire-status")).toContainText("Wire start");
});
