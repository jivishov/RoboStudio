import { expect, test } from "@playwright/test";
import { createCircuitLabProject } from "../../src/circuits/model.js";
import { normalizeMechatronicsBinding } from "../../src/mechatronics/model.js";
import { createRobotDesign } from "../../src/physics/model.js";
import {
  CIRCUIT_DESIGN_STORE_NAME,
  CURRENT_CIRCUIT_LAB_PROJECT_KEY,
  CURRENT_DESIGN_KEY,
  CURRENT_MECHATRONICS_BINDING_KEY,
  CURRENT_SNAPSHOT_KEY,
  DESIGN_STORE_NAME,
  REQUIRED_STORE_NAMES,
  SNAPSHOT_STORE_NAME,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION
} from "../../src/workspaceDb.js";

const consoleByPage = new WeakMap();

const SAMPLE_PART_IDS = [
  "base",
  "inferred_support_front",
  "inferred_support_back",
  "inferred_support_left",
  "inferred_support_right",
  "waist",
  "inferred_turntable_pin",
  "lower_arm",
  "inferred_shoulder_axle",
  "upper_arm",
  "inferred_elbow_axle",
  "wrist_yoke",
  "inferred_wrist_axle",
  "inferred_gripper_mount_axle",
  "gripper_base",
  "gear_left",
  "gear_right",
  "gripper_finger_left",
  "gripper_finger_right",
  "grip_link_left_lower",
  "grip_link_left_upper",
  "grip_link_right_lower",
  "grip_link_right_upper",
  "inferred_left_gear_axle",
  "inferred_right_gear_axle"
];

function samplePartRecords() {
  return SAMPLE_PART_IDS.map((id, index) => {
    const x = (index % 5) * 45;
    const y = Math.floor(index / 5) * 18;
    return {
      id,
      name: id,
      type: "assembly",
      file: null,
      visible: true,
      triangles: 12,
      bounds: {
        min: [x - 10, y - 10, -10],
        max: [x + 10, y + 10, 10],
        center: [x, y, 0],
        size: [20, 20, 20]
      }
    };
  });
}

// The workbench only consumes a saved RobotDesign when the handoff also carries assembly
// geometry, so the fixture ships a minimal but valid glTF binary instead of relying on the
// gitignored STL_files sample kit being present locally.
function minimalGlbBytes() {
  const json = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] });
  const jsonBytes = new TextEncoder().encode(json);
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const chunkLength = jsonBytes.length + padding;
  const buffer = new ArrayBuffer(20 + chunkLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, chunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(buffer);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.length);
  return Array.from(bytes);
}

function assemblyHandoffSnapshot() {
  return {
    savedAt: "2026-06-24T12:00:00.000Z",
    glbBytes: minimalGlbBytes(),
    parts: samplePartRecords(),
    layout: null
  };
}

function semanticReadyRobotDesign() {
  const design = createRobotDesign(samplePartRecords(), { sample: true });
  design.joints = design.joints.map((joint) => (
    joint.id === "shoulder" ? { ...joint, actuatorId: "servo_20kg" } : { ...joint, actuatorId: null }
  ));
  design.sensors = [];
  return design;
}

const READY_CIRCUIT = createCircuitLabProject();
const READY_BINDING = normalizeMechatronicsBinding({
  actuatorBindings: [
    {
      id: "shoulder_servo_binding",
      jointId: "shoulder",
      actuatorId: "servo_20kg",
      circuitComponentId: "servo",
      firmwareChannelIds: ["servo_signal"],
      commandTransform: { scale: 1, offset: 0 }
    }
  ],
  firmwareChannels: [
    {
      id: "servo_signal",
      semanticRole: "joint.command.position",
      direction: "controller-to-device",
      signalType: "servo-pulse",
      valueType: "number",
      controllerTerminalRef: { componentId: "arduino", terminalId: "D9" },
      deviceTerminalRef: { componentId: "servo", terminalId: "signal" }
    }
  ]
});

async function seedWorkspace(page, entries = []) {
  await page.goto("/__workspace-seed.html");
  await page.evaluate(async ({ constants, entries: seededEntries }) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(constants.WORKSPACE_DB_NAME);
      request.addEventListener("success", resolve);
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () => reject(new Error("IndexedDB delete was blocked.")));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(constants.WORKSPACE_DB_NAME, constants.WORKSPACE_DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        for (const storeName of constants.storeNames) {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(constants.storeNames, "readwrite");
      for (const entry of seededEntries) {
        const { glbBytes, ...rest } = entry.value ?? {};
        const value = glbBytes ? { ...rest, glb: new Uint8Array(glbBytes).buffer } : entry.value;
        transaction.objectStore(entry.storeName).put(value, entry.key);
      }
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
    db.close();
  }, {
    constants: {
      WORKSPACE_DB_NAME,
      WORKSPACE_DB_VERSION,
      // Seeding must create the full current store set. A database at the current version
      // with a store missing is malformed, and the app repairs it destructively on open.
      storeNames: REQUIRED_STORE_NAMES
    },
    entries
  });
}

async function activateWorkbenchMode(page, name) {
  const button = page.getByRole("navigation", { name: "Workbench modes" }).getByRole("button", { name });
  await button.dispatchEvent("click");
  await expect(button).toHaveClass(/is-active/u);
}

async function waitForWorkbenchReady(page) {
  await expect(page.locator(".summary-strip__item--source strong")).toHaveText(/^(Manual|Pre-rigged)$/u, { timeout: 120_000 });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/__workspace-seed.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Workspace seed</title>"
  }));
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  const consoleMessages = [];
  consoleByPage.set(page, consoleMessages);
  page.on("console", (message) => {
    if (message.type() === "error") consoleMessages.push(message.text());
  });
  page.on("pageerror", (error) => consoleMessages.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(consoleByPage.get(page) ?? []).toEqual([]);
});

test("Workbench direct entry ignores stale assembly snapshots", async ({ page }) => {
  await seedWorkspace(page, [
    {
      storeName: SNAPSHOT_STORE_NAME,
      key: CURRENT_SNAPSHOT_KEY,
      value: {
        savedAt: "2026-06-24T12:00:00.000Z",
        glb: new ArrayBuffer(8),
        parts: samplePartRecords(),
        layout: null
      }
    }
  ]);

  await page.goto("/physics.html");
  await waitForWorkbenchReady(page);

  await expect(page.locator("#assembly-source")).toHaveText("Manual workspace");
  await expect(page.locator("#assembly-name")).toHaveText("No assembly snapshot");
  await expect(page.locator("#metrics-grid div").filter({ hasText: "Assembly parts" }).locator("dd")).toHaveText("0");
});

test("Workbench simulate controls expose hold motors and remain clickable above assistant", async ({ page }) => {
  await page.goto("/physics.html");
  await expect(page).toHaveTitle("Robotics Design Workbench");
  await waitForWorkbenchReady(page);

  await activateWorkbenchMode(page, "Simulate");
  await expect(page.locator("#mode-controls")).toContainText("Motors");
  await expect(page.locator("#mode-controls")).toContainText("Hold pose");
  await expect(page.locator("#mode-controls")).toContainText("Motors are proxy-simulation controls");

  const stepButton = page.locator("#sim-step");
  await expect(stepButton).toHaveCount(1);
  const hitTest = await stepButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      buttonOwnsPoint: topElement === button || button.contains(topElement),
      coveredByAssistant: Boolean(topElement?.closest?.(".assistant-card")),
      topElement: {
        id: topElement?.id ?? "",
        tagName: topElement?.tagName ?? "",
        className: String(topElement?.className ?? "")
      }
    };
  });
  expect(hitTest).toMatchObject({
    buttonOwnsPoint: true,
    coveredByAssistant: false
  });

  await stepButton.click();
});

test("Workbench shows mechatronics readiness and applies a semantic channel", async ({ page }) => {
  await page.goto("/physics.html");
  await expect(page).toHaveTitle("Robotics Design Workbench");
  await waitForWorkbenchReady(page);
  await expect(page.locator("#design-summary")).toContainText("Circuit");
  await expect(page.locator("#design-summary")).toContainText("Absent");

  await seedWorkspace(page, [
    { storeName: SNAPSHOT_STORE_NAME, key: CURRENT_SNAPSHOT_KEY, value: assemblyHandoffSnapshot() },
    { storeName: DESIGN_STORE_NAME, key: CURRENT_DESIGN_KEY, value: semanticReadyRobotDesign() },
    { storeName: CIRCUIT_DESIGN_STORE_NAME, key: CURRENT_CIRCUIT_LAB_PROJECT_KEY, value: READY_CIRCUIT },
    { storeName: CIRCUIT_DESIGN_STORE_NAME, key: CURRENT_MECHATRONICS_BINDING_KEY, value: READY_BINDING }
  ]);
  await page.goto("/physics.html?fromAssembly=1");
  await waitForWorkbenchReady(page);
  await expect(page.locator("#design-summary")).toContainText("Ready");

  await activateWorkbenchMode(page, "Audit");
  await expect(page.locator("[data-card-id='audit-mechatronics']")).toContainText("Mechatronics readiness");
  await expect(page.locator("[data-card-id='audit-mechatronics']")).toContainText("Semantic control availability");
  await expect(page.locator("[data-card-id='audit-mechatronics']")).toContainText("Available");
  await expect(page.locator("#apply-semantic-channel")).toBeEnabled();

  await page.locator("#semantic-channel-value").fill("25");
  await page.locator("#apply-semantic-channel").click();
  await expect(page.locator("[data-card-id='audit-semantic-channel']")).toContainText("Shoulder");
  await expect(page.locator("[data-card-id='audit-semantic-channel']")).toContainText("Simulation was invalidated");

  await activateWorkbenchMode(page, "Lab");
  await expect(page.locator("#mode-controls h2")).toHaveText("Lab Mode");
  await expect(page.locator("#mode-controls")).toContainText("Electronics Studio design");
  await expect(page.locator("#mode-controls")).toContainText("Circuit Lab project");
  await expect(page.locator("#mode-controls")).toContainText("Mechatronics binding");
});
