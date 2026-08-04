import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDirectory = resolve(
  process.cwd(),
  "circuit_lab_physical_connection_fidelity_plan_2026-07-14",
  "rendered-evidence",
  "cycle-04"
);

const viewports = [
  { name: "1440x900", width: 1440, height: 900, compact: false },
  { name: "1366x768", width: 1366, height: 768, compact: false },
  { name: "1024x768", width: 1024, height: 768, compact: true },
  { name: "768x1024", width: 768, height: 1024, compact: true }
];

test("Cycle 4 viewport evidence preserves the bench-first shell and overlay drawer geometry", async ({ page }) => {
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
    const assistant = page.locator(".assistant-card");
    if (await assistant.isVisible() && !(await assistant.evaluate((element) => element.classList.contains("is-collapsed")))) {
      await assistant.locator(".assistant-card__collapse").click();
    }

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
      hardwareVisible: getComputedStyle(document.querySelector("#circuit-hardware-drawer")).visibility,
      workflowVisible: getComputedStyle(document.querySelector("#circuit-workflow-drawer")).visibility,
      drawerTriggerVisible: getComputedStyle(document.querySelector("#open-circuit-hardware-drawer")).display,
      stageWidth: document.querySelector(".circuit-stage").getBoundingClientRect().width
    }));
    if (viewport.compact) {
      expect(layout.drawerTriggerVisible).not.toBe("none");
      expect(layout.stageWidth).toBeGreaterThanOrEqual(viewport.width - 1);
      await page.evaluate(() => {
        window.__cycle4EvidenceNodes = {
          components: document.querySelector("[data-bench-layer='components']"),
          arduino: document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']")
        };
      });
      await page.locator("#open-circuit-workflow-drawer").click();
      await expect(page.locator("#circuit-workflow-drawer")).toHaveClass(/is-open/u);
      const benchAfter = await bench.boundingBox();
      expect(benchAfter).toEqual(benchBefore);
      expect(await bench.getAttribute("viewBox")).toBe(viewBoxBefore);
      expect(await page.evaluate(() => (
        window.__cycle4EvidenceNodes.components === document.querySelector("[data-bench-layer='components']")
        && window.__cycle4EvidenceNodes.arduino === document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']")
      ))).toBe(true);
      await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}-workflow-drawer.png`) });
      await page.evaluate(() => window.__circuitLabCycle4.closeDrawer());
    } else {
      expect(layout.columns.split(" ")).toHaveLength(3);
      expect(layout.stageWidth).toBeGreaterThanOrEqual(560);
      await page.screenshot({ path: resolve(evidenceDirectory, `${viewport.name}-three-column.png`) });
    }

    if (viewport.name === "1440x900") {
      await page.locator("[data-add-hardware='ultrasonic-hcsr04']").click();
      await expect(page.locator("#circuit-bench [data-placement-preview-bounds]")).toHaveCount(1);
      await expect(page.locator("#circuit-bench [data-placement-preview-component-id] .physical-port-housing")).toHaveCount(1);
      await page.screenshot({ path: resolve(evidenceDirectory, "1440x900-placement-ghost-bounds-ports.png") });
      await page.keyboard.press("Escape");
    }

    evidence.push({ viewport, benchBefore, stageBefore, viewBoxBefore, overflow, layout });
  }

  await writeFile(
    resolve(evidenceDirectory, "viewport-metrics.json"),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), evidence }, null, 2)}\n`,
    "utf8"
  );
});
