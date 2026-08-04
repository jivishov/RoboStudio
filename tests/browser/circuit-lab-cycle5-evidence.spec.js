import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const planDirectory = resolve(process.cwd(), "circuit_lab_physical_connection_fidelity_plan_2026-07-14");
const evidenceDirectory = resolve(planDirectory, "rendered-evidence", "cycle-05");
const cycle2EvidenceDirectory = resolve(planDirectory, "rendered-evidence", "cycle-02");

const viewports = [
  { name: "1440x900", width: 1440, height: 900, compact: false },
  { name: "1366x768", width: 1366, height: 768, compact: false },
  { name: "1024x768", width: 1024, height: 768, compact: true },
  { name: "768x1024", width: 768, height: 1024, compact: true }
];

async function collapseAssistant(page) {
  const assistant = page.locator(".assistant-card");
  if (await assistant.isVisible() && !(await assistant.evaluate((element) => element.classList.contains("is-collapsed")))) {
    await assistant.locator(".assistant-card__collapse").click();
  }
}

async function importProject(page, source, name) {
  const beforeGeneration = await page.evaluate(() => window.__circuitLabCycle4.generation());
  await page.setInputFiles("#circuit-lab-file-input", {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(source)
  });
  await expect.poll(() => page.evaluate(() => window.__circuitLabCycle4.generation())).toBeGreaterThan(beforeGeneration);
}

async function openTestResults(page) {
  const trigger = page.locator("#open-circuit-workflow-drawer");
  if (await trigger.isVisible() && await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.getByRole("tab", { name: "Test Results", exact: true }).click();
}

test("Cycle 5 captures final viewport, targeting, hazard, stale, custom, and font-fallback evidence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One deterministic final evidence set is sufficient.");
  await mkdir(evidenceDirectory, { recursive: true });
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  const evidence = [];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/circuits.html");
    await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));
    await expect(page.locator("html")).toHaveClass(/circuit-material-symbols-fallback/u);
    if (viewport.name === "1440x900") {
      await page.screenshot({ path: resolve(evidenceDirectory, "font-fallback-1440x900.png") });
    }
    await collapseAssistant(page);

    const bench = page.locator("#circuit-bench");
    const stage = page.locator(".circuit-stage");
    const benchBefore = await bench.boundingBox();
    const stageBefore = await stage.boundingBox();
    const viewBoxBefore = await bench.getAttribute("viewBox");
    if (!benchBefore || !stageBefore) throw new Error(`Bench was not visible at ${viewport.name}.`);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight
    }));
    expect(overflow.x).toBeLessThanOrEqual(1);
    expect(overflow.y).toBeLessThanOrEqual(1);
    expect(Math.abs(benchBefore.width - stageBefore.width)).toBeLessThanOrEqual(0.1);

    const layout = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector(".circuit-shell")).gridTemplateColumns,
      drawerTriggerVisible: getComputedStyle(document.querySelector("#open-circuit-hardware-drawer")).display,
      stageWidth: document.querySelector(".circuit-stage").getBoundingClientRect().width
    }));
    if (viewport.compact) {
      expect(layout.drawerTriggerVisible).not.toBe("none");
      expect(layout.stageWidth).toBeGreaterThanOrEqual(viewport.width - 1);
      await page.evaluate(() => {
        window.__cycle5EvidenceNodes = {
          components: document.querySelector("[data-bench-layer='components']"),
          arduino: document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']")
        };
      });
      await page.locator("#open-circuit-workflow-drawer").click();
      await expect(page.locator("#circuit-workflow-drawer")).toHaveClass(/is-open/u);
      expect(await bench.boundingBox()).toEqual(benchBefore);
      expect(await bench.getAttribute("viewBox")).toBe(viewBoxBefore);
      expect(await page.evaluate(() => (
        window.__cycle5EvidenceNodes.components === document.querySelector("[data-bench-layer='components']")
        && window.__cycle5EvidenceNodes.arduino === document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']")
      ))).toBe(true);
      await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}-workflow-drawer.png`) });
    } else {
      expect(layout.columns.split(" ")).toHaveLength(3);
      expect(layout.stageWidth).toBeGreaterThanOrEqual(560);
      await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}-three-column.png`) });
    }

    if (viewport.name === "1440x900") {
      await page.locator("[data-add-hardware='ultrasonic-hcsr04']").click();
      await expect(page.locator("#circuit-bench [data-placement-preview-bounds]")).toHaveCount(1);
      await expect(page.locator("#circuit-bench [data-placement-preview-component-id] .physical-port-housing")).toHaveCount(1);
      await page.screenshot({ path: resolve(evidenceDirectory, "placement-ghost-bounds-ports-1440x900.png") });
      await page.keyboard.press("Escape");
    }

    if (viewport.name === "1366x768") {
      await page.getByRole("button", { name: "Wire", exact: true }).click();
      const focused = await page.evaluate(() => window.__circuitLabCycle3.focusTerminal({ componentId: "arduino", terminalId: "D13" }));
      expect(focused.endpoint).toEqual({ componentId: "arduino", terminalId: "D13" });
      await expect(page.locator("#circuit-precision-hud")).toContainText("D13");
      await page.screenshot({ path: resolve(evidenceDirectory, "exact-target-d13-1366x768.png") });
    }

    evidence.push({ viewport, benchBefore, stageBefore, viewBoxBefore, overflow, layout });
  }

  const hazardousSource = await readFile(resolve(cycle2EvidenceDirectory, "hazardous-placement.json"), "utf8");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/circuits.html");
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));
  await collapseAssistant(page);
  await importProject(page, hazardousSource, "cycle-05-hazard.json");
  await page.evaluate(async () => window.__circuitLabCycle4.executeAssistantAction("circuits_move_component", {
    componentId: "cap",
    position: [500, 303.57]
  }));
  await expect(page.locator("#circuit-mutation-confirmation")).toBeVisible();
  await expect(page.locator("#circuit-mutation-confirmation")).toContainText("Place anyway");
  await expect(page.getByRole("button", { name: "Place anyway", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  const hazardDetailOverflow = await page.locator(".circuit-mutation-confirmation__scroll").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(hazardDetailOverflow.scrollHeight).toBeGreaterThan(hazardDetailOverflow.clientHeight);
  await page.screenshot({ path: resolve(evidenceDirectory, "hazardous-confirmation-1440x900.png") });

  const staleSource = await readFile(resolve(cycle2EvidenceDirectory, "stale-insertion.json"), "utf8");
  await page.goto("/circuits.html");
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));
  await collapseAssistant(page);
  await importProject(page, staleSource, "cycle-05-stale.json");
  await openTestResults(page);
  const staleIssue = page.locator("#circuit-test-list [data-issue-id]").filter({ hasText: "stale-direct-insertion" });
  await expect(staleIssue).toHaveCount(1);
  await expect(staleIssue.getByRole("button", { name: "Re-seat", exact: true })).toBeVisible();
  await expect(staleIssue.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDirectory, "stale-insertion-guidance-1440x900.png") });

  const missingCustom = JSON.stringify({
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    name: "Missing local custom component",
    mode: "test",
    components: [{ id: "missing", typeId: "custom:missing_part", name: "Missing imported part", position: [500, 325] }],
    connections: [],
    app: { kind: "robotics_starter", notes: "" }
  });
  await page.goto("/circuits.html");
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));
  await collapseAssistant(page);
  await importProject(page, missingCustom, "cycle-05-missing-custom.json");
  await openTestResults(page);
  await expect(page.getByText("local custom component library entry", { exact: false })).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDirectory, "missing-custom-placeholder-1440x900.png") });

  await writeFile(
    resolve(evidenceDirectory, "viewport-metrics.json"),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), evidence }, null, 2)}\n`,
    "utf8"
  );
});
