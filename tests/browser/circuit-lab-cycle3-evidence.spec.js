import { expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  "circuit_lab_physical_connection_fidelity_plan_2026-07-14",
  "rendered-evidence",
  "cycle-03"
);

async function focusTerminal(page, endpoint) {
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle3));
  return page.evaluate((target) => window.__circuitLabCycle3.focusTerminal(target), endpoint);
}

async function openDrawer(page, name) {
  const trigger = page.locator(name === "hardware" ? "#open-circuit-hardware-drawer" : "#open-circuit-workflow-drawer");
  if (!(await trigger.isVisible())) return;
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}

async function selectComponentForInspector(page, componentId) {
  await openDrawer(page, "hardware");
  await page.locator(`#circuit-component-list [data-component-id='${componentId}']`).click();
  await openDrawer(page, "workflow");
  await page.getByRole("tab", { name: "Inspect", exact: true }).click();
}

async function capture(page, name) {
  await expect(page.locator("#circuit-bench")).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage: false });
}

test("Cycle 3 rendered evidence across required laptop, desktop, tablet, and 200% equivalent viewports", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One deterministic evidence set is sufficient.");
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  await page.goto("/circuits.html");
  await page.addStyleTag({
    content: `
      .material-symbols-rounded {
        align-items: center !important;
        display: inline-flex !important;
        font-family: Arial, sans-serif !important;
        font-size: 0 !important;
        justify-content: center !important;
      }
      .material-symbols-rounded::before {
        border: 1.5px solid currentColor;
        border-radius: 3px;
        box-sizing: border-box;
        content: "";
        display: block;
        height: 0.875rem;
        width: 0.875rem;
      }
      .material-symbols-rounded.app-icon--page::before {
        border-radius: 50%;
        height: 1rem;
        width: 1rem;
      }
    `
  });
  await page.getByRole("button", { name: "Wire", exact: true }).click();

  await page.setViewportSize({ width: 1366, height: 768 });
  await focusTerminal(page, { componentId: "arduino", terminalId: "D13" });
  await expect(page.locator("#circuit-precision-hud")).toContainText("D13");
  await capture(page, "exact-focus-d13-1366x768.png");

  await page.setViewportSize({ width: 1024, height: 768 });
  const crowded = await focusTerminal(page, { componentId: "breadboard", terminalId: "r15a" });
  await page.locator("#circuit-bench").evaluate((bench, point) => {
    bench.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 73,
      pointerType: "touch",
      clientX: point[0],
      clientY: point[1]
    }));
  }, crowded.screenPoint);
  await expect(page.locator("#circuit-precision-hud [data-precision-candidate]")).not.toHaveCount(0);
  await expect(page.locator("#circuit-precision-hud")).toContainText(/contacts are within the touch precision band/u);
  await expect(page.locator("#circuit-precision-hud [data-precision-action='frame-port']")).toHaveCount(1);
  await capture(page, "touch-ambiguity-1024x768.png");

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await focusTerminal(page, { componentId: "breadboard", terminalId: "bp1" });
  await expect(page.locator("#circuit-precision-hud")).toContainText("1/1");
  await expect(page.locator("#circuit-precision-hud")).toContainText("Cannot connect");
  await capture(page, "full-capacity-nearest-1440x900.png");

  await page.setViewportSize({ width: 768, height: 1024 });
  await selectComponentForInspector(page, "arduino");
  await page.locator("#circuit-component-rotation").fill("90");
  await page.locator("#apply-circuit-component").click();
  await focusTerminal(page, { componentId: "arduino", terminalId: "D13" });
  await expect(page.locator("#circuit-precision-hud")).toContainText("D13");
  await capture(page, "rotated-d13-focus-768x1024.png");

  await page.setViewportSize({ width: 720, height: 450 });
  await focusTerminal(page, { componentId: "servo", terminalId: "signal" });
  await expect(page.locator("#circuit-precision-hud")).toContainText("signal");
  await page.locator("#circuit-bench").evaluate((bench) => bench.scrollIntoView({ block: "center", inline: "center" }));
  await capture(page, "precision-hud-200pct-equivalent-1440x900.png");

  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    benchLayers: [...document.querySelectorAll("#circuit-bench > [data-bench-layer]")].map((node) => node.getAttribute("data-bench-layer")),
    diagnostics: window.__circuitLabCycle3.diagnostics(),
    resolver: window.__circuitLabCycle3.resolverStats()
  }));
  expect(metrics.benchLayers).toEqual(["background", "committed-wires", "components", "terminals", "transient"]);
  expect(metrics.diagnostics.fullBenchReplacementCount).toBe(0);
  expect(metrics.resolver.anchorCount).toBe(437);
});
