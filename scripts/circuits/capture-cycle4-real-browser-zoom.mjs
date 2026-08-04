import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const evidenceCycle = process.env.ROBOSTUDIO_EVIDENCE_CYCLE ?? "cycle-04";
const evidenceDirectory = resolve(
  projectRoot,
  "circuit_lab_physical_connection_fidelity_plan_2026-07-14",
  "rendered-evidence",
  evidenceCycle
);
const port = Number(process.env.ROBOTSTUDIO_REAL_ZOOM_PORT ?? (4184 + process.pid % 200));
const remoteDebuggingPort = Number(process.env.ROBOTSTUDIO_REAL_ZOOM_DEBUG_PORT ?? (9334 + process.pid % 500));
const baseUrl = `http://127.0.0.1:${port}`;
const profileDirectory = join(tmpdir(), `robostudio-cycle4-real-zoom-${process.pid}`);

await mkdir(evidenceDirectory, { recursive: true });
await mkdir(profileDirectory, { recursive: true });

const viteProcess = spawn(process.execPath, [
  resolve(projectRoot, "node_modules", "vite", "bin", "vite.js"),
  "--host",
  "127.0.0.1",
  "--port",
  String(port)
], { cwd: projectRoot, stdio: "ignore" });

const chromiumProcess = spawn(chromium.executablePath(), [
  `--remote-debugging-port=${remoteDebuggingPort}`,
  `--user-data-dir=${profileDirectory}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-session-crashed-bubble",
  "--window-position=40,40",
  "--window-size=1440,900",
  "about:blank"
], { cwd: projectRoot, stdio: "ignore" });

let browser;
try {
  const waitForUrl = async (url, timeoutMs = 30_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
      } catch {
        // The local server or remote-debug endpoint is still starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
    throw new Error(`Timed out waiting for ${url}`);
  };

  await waitForUrl(`${baseUrl}/circuits.html`);
  await waitForUrl(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`);
  const context = browser.contexts()[0];
  await context.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  const page = context.pages()[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  const captureScreenshot = async (fileName) => {
    const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(resolve(evidenceDirectory, fileName), Buffer.from(result.data, "base64"));
  };
  await page.goto(`${baseUrl}/circuits.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__circuitLabCycle4));

  const metrics = () => page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    visualViewportScale: window.visualViewport?.scale ?? 1,
    compactDrawerMedia: window.matchMedia("(max-width: 1199.98px)").matches
  }));
  const beforeZoom = await metrics();

  const powershell = [
    "$shell = New-Object -ComObject WScript.Shell",
    `if (-not $shell.AppActivate('Circuit Lab')) { if (-not $shell.AppActivate(${chromiumProcess.pid})) { throw 'Unable to activate the Chromium window.' } }`,
    "Start-Sleep -Milliseconds 350",
    "$shell.SendKeys('^0')",
    "Start-Sleep -Milliseconds 250",
    "1..5 | ForEach-Object { $shell.SendKeys('^{+}'); Start-Sleep -Milliseconds 280 }"
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], { stdio: "inherit" });

  try {
    await page.waitForFunction((initialDpr) => window.devicePixelRatio >= initialDpr * 1.9, beforeZoom.devicePixelRatio, { timeout: 10_000 });
  } catch {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], { stdio: "inherit" });
    await page.waitForFunction((initialDpr) => window.devicePixelRatio >= initialDpr * 1.9, beforeZoom.devicePixelRatio, { timeout: 12_000 });
  }
  const afterZoom = await metrics();
  const zoomRatio = afterZoom.devicePixelRatio / beforeZoom.devicePixelRatio;
  const cssViewportRatio = beforeZoom.innerWidth / afterZoom.innerWidth;
  assert.ok(zoomRatio >= 1.95 && zoomRatio <= 2.05, `Expected real browser zoom ratio 2; received ${zoomRatio}.`);
  assert.ok(cssViewportRatio >= 1.9 && cssViewportRatio <= 2.1, `Expected CSS viewport ratio near 2; received ${cssViewportRatio}.`);
  assert.equal(afterZoom.visualViewportScale, 1, "Browser zoom must not be substituted with page scale.");
  assert.equal(afterZoom.compactDrawerMedia, true, "Real 200% browser zoom must activate compact drawer reflow.");
  await page.evaluate(() => {
    const assistant = document.querySelector(".assistant-card:not(.is-collapsed) .assistant-card__collapse");
    assistant?.click();
  });

  await page.evaluate(() => {
    window.__cycle4RealZoomNodes = {
      components: document.querySelector("[data-bench-layer='components']"),
      arduino: document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']")
    };
  });
  const benchBefore = await page.locator("#circuit-bench").boundingBox();
  const viewBoxBefore = await page.locator("#circuit-bench").getAttribute("viewBox");
  assert.ok(benchBefore, "Circuit bench must be visible at real 200% browser zoom.");
  const triggerHitTest = await page.locator("#open-circuit-hardware-drawer").evaluate((trigger) => {
    const bounds = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      hitId: hit?.id ?? null,
      hitIsTrigger: hit === trigger || Boolean(hit && trigger.contains(hit))
    };
  });
  await captureScreenshot("real-browser-zoom-200-before-drawer.png");
  assert.equal(triggerHitTest.hitIsTrigger, true, `Hardware drawer trigger is obscured at real 200% zoom: ${JSON.stringify(triggerHitTest)}.`);
  await page.locator("#open-circuit-hardware-drawer").evaluate((trigger) => trigger.click());
  await page.locator("#circuit-hardware-drawer.is-open").waitFor();
  const benchAfter = await page.locator("#circuit-bench").boundingBox();
  const viewBoxAfter = await page.locator("#circuit-bench").getAttribute("viewBox");
  const stableNodesPreserved = await page.evaluate(() => (
    window.__cycle4RealZoomNodes.components === document.querySelector("[data-bench-layer='components']")
    && window.__cycle4RealZoomNodes.arduino === document.querySelector("#circuit-bench .bench-component[data-component-id='arduino']")
  ));
  assert.deepEqual(benchAfter, benchBefore, "Opening a drawer at real 200% browser zoom must not resize the SVG.");
  assert.equal(viewBoxAfter, viewBoxBefore, "Opening a drawer at real 200% browser zoom must not change the viewBox.");
  assert.equal(stableNodesPreserved, true, "Opening a drawer at real 200% browser zoom must preserve stable bench nodes.");

  await captureScreenshot("real-browser-zoom-200-hardware-drawer.png");
  const evidence = {
    capturedAt: new Date().toISOString(),
    method: "Visible Chromium browser window; Windows WScript.Shell sent Ctrl+0 followed by five Ctrl+Plus browser-chrome shortcuts (100, 110, 125, 150, 175, 200).",
    prohibitedSubstitutesUsed: false,
    beforeZoom,
    afterZoom,
    zoomRatio,
    cssViewportRatio,
    drawer: {
      triggerHitTest,
      benchBefore,
      benchAfter,
      viewBoxBefore,
      viewBoxAfter,
      stableNodesPreserved
    }
  };
  await writeFile(resolve(evidenceDirectory, "real-browser-zoom-200.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (!chromiumProcess.killed) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(chromiumProcess.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      chromiumProcess.kill();
    }
  }
  await Promise.race([
    browser?.close().catch(() => {}),
    new Promise((resolveWait) => setTimeout(resolveWait, 2000))
  ]);
  if (!viteProcess.killed) viteProcess.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
}
