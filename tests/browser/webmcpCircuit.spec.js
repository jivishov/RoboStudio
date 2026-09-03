import { expect, test } from "@playwright/test";

async function installFakeWebMcp(page) {
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.addInitScript(() => {
    window.__webmcpTools = [];
    const listeners = new Set();
    const modelContext = {
      registerTool(tool, options = {}) {
        window.__webmcpTools.push(tool);
        options.signal?.addEventListener("abort", () => {
          window.__webmcpTools = window.__webmcpTools.filter((item) => item !== tool);
          for (const listener of listeners) listener(new Event("toolchange"));
        }, { once: true });
        return Promise.resolve();
      },
      getTools() { return Promise.resolve([...window.__webmcpTools]); },
      addEventListener(type, listener) { if (type === "toolchange") listeners.add(listener); },
      removeEventListener(type, listener) { if (type === "toolchange") listeners.delete(listener); }
    };
    window.__removeWebMcpTool = (name) => {
      window.__webmcpTools = window.__webmcpTools.filter((tool) => tool.name !== name);
      for (const listener of listeners) listener(new Event("toolchange"));
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
  });
}

async function callTool(page, name, input = {}) {
  return page.evaluate(async ({ name, input }) => {
    const tool = window.__webmcpTools.find((item) => item.name === name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    return tool.execute(input, { signal: new AbortController().signal });
  }, { name, input });
}

test("servo mission registers seven tools, isolates state, and completes through tools plus visible removal consent", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html?mission=servo-repair-v1");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 7 tools");
  await expect.poll(() => page.evaluate(() => window.__webmcpTools.length)).toBe(7);

  const initial = await callTool(page, "get_circuit_state");
  const diagnosed = await callTool(page, "diagnose_circuit", { maxIssues: 6 });
  expect(diagnosed.data.issues.map((issue) => issue.code)).toContain("servo-controller-power");
  expect(diagnosed.data.issues.map((issue) => issue.code)).toContain("missing-common-ground");
  const unsafeIssue = diagnosed.data.issues.find((issue) => issue.code === "servo-controller-power");
  await callTool(page, "show_circuit_issue", { issueId: unsafeIssue.id });
  expect((await callTool(page, "get_circuit_state")).revision).toBe(initial.revision);

  expect((await callTool(page, "remove_connection", { expectedRevision: initial.revision, connectionId: "unsafe_servo_power" })).code).toBe("pending_confirmation");
  await expect(page.locator("#webmcp-pending-card")).toBeVisible();
  await page.locator('[data-webmcp-pending-action="cancel"]').click();
  await expect(page.locator("#webmcp-pending-card")).toBeHidden();
  expect((await callTool(page, "get_circuit_state")).revision).toBe(initial.revision);

  expect((await callTool(page, "remove_connection", { expectedRevision: initial.revision, connectionId: "unsafe_servo_power" })).code).toBe("pending_confirmation");
  await page.locator('[data-webmcp-pending-action="confirm"]').click();
  await expect(page.locator("#webmcp-pending-card")).toBeHidden();

  const afterRemoval = await callTool(page, "get_circuit_state");
  const positive = afterRemoval.data.positiveContacts[0];
  const ground = afterRemoval.data.groundContacts[0];
  expect(positive).toBeTruthy();
  expect(ground).toBeTruthy();
  expect((await callTool(page, "preview_connection", { expectedRevision: afterRemoval.revision, endpointA: { componentId: "breadboard", terminalId: positive }, endpointB: { componentId: "servo", terminalId: "vplus" } })).code).toBe("preview_safe");
  expect((await callTool(page, "connect_terminals", { expectedRevision: afterRemoval.revision, endpointA: { componentId: "breadboard", terminalId: positive }, endpointB: { componentId: "servo", terminalId: "vplus" } })).code).toBe("committed");

  const afterPower = await callTool(page, "get_circuit_state");
  await callTool(page, "preview_connection", { expectedRevision: afterPower.revision, endpointA: { componentId: "arduino", terminalId: "GND" }, endpointB: { componentId: "breadboard", terminalId: ground } });
  expect((await callTool(page, "connect_terminals", { expectedRevision: afterPower.revision, endpointA: { componentId: "arduino", terminalId: "GND" }, endpointB: { componentId: "breadboard", terminalId: ground } })).code).toBe("committed");

  const finalDiagnosis = await callTool(page, "diagnose_circuit", { maxIssues: 6 });
  expect(finalDiagnosis.data.totals.errors).toBe(0);
  const evidence = await callTool(page, "get_build_evidence");
  expect(evidence.data.semanticPinMapStatus).toBe("absent_binding");
  expect(evidence.data.topologyAssignments).toContainEqual(expect.objectContaining({ deviceTerminal: "servo.signal", controllerTerminal: "arduino.D9" }));
});

test("benchmark lock disables manual project actions while preserving WebMCP and user confirmation", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html?mission=servo-repair-v1&benchmark=1");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 7 tools");
  await page.locator("#webmcp-model-label").fill("Test Model");
  await page.locator("#webmcp-config-label").fill("high reasoning");
  await page.locator('[data-webmcp-action="start-run"]').click();
  await expect(page.locator("#new-circuit-lab")).toBeDisabled();
  await expect(page.locator("#save-circuit-lab")).toBeDisabled();
  await expect(page.locator("#undo-circuit-lab")).toBeDisabled();
  await expect(page.locator("#apply-circuit-binding")).toBeDisabled();
  await expect(page.locator("#save-circuit-binding")).toBeDisabled();
  await expect(page.locator("#circuit-binding-json")).toHaveAttribute("readonly", "");
  await expect(page.locator('[data-webmcp-action="reset-mission"]')).toBeDisabled();
  await expect(page.locator("#webmcp-run-status")).toContainText("agent-only");
});

test("mission load and reset leave saved Circuit Lab, binding, and RobotDesign records untouched", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html");
  const seeded = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("stl-assembly-studio", 5); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const savedProject = { kind: "CircuitLabProject", version: 1, units: "mm", name: "Saved user project", components: [], connections: [] };
    const savedBinding = { kind: "MechatronicsBinding", version: 1, actuatorBindings: [], sensorBindings: [], firmwareChannels: [] };
    const savedRobot = { version: 1, units: "mm", name: "Saved robot" };
    await new Promise((resolve, reject) => { const tx = db.transaction(["circuit-designs", "robot-designs"], "readwrite"); tx.objectStore("circuit-designs").put(savedProject, "current-circuit-lab-project"); tx.objectStore("circuit-designs").put(savedBinding, "current-mechatronics-binding"); tx.objectStore("robot-designs").put(savedRobot, "current-robot-design"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
    return { savedProject, savedBinding, savedRobot };
  });
  await page.goto("/circuits.html?mission=servo-repair-v1");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 7 tools");
  const state = await callTool(page, "get_circuit_state");
  expect(state.data.mission).toEqual(expect.objectContaining({ id: "servo-repair-v1", isolated: true }));
  expect(state.data.components).toHaveLength(4);
  await expect(page.locator("#apply-circuit-binding")).toBeDisabled();
  await expect(page.locator("#save-circuit-binding")).toBeDisabled();
  await expect(page.locator("#circuit-binding-json")).toHaveAttribute("readonly", "");
  await page.locator('[data-webmcp-action="reset-mission"]').click();
  const persisted = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("stl-assembly-studio", 5); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = (store, key) => new Promise((resolve, reject) => { const tx = db.transaction(store, "readonly"); const request = tx.objectStore(store).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const values = { savedProject: await read("circuit-designs", "current-circuit-lab-project"), savedBinding: await read("circuit-designs", "current-mechatronics-binding"), savedRobot: await read("robot-designs", "current-robot-design") };
    db.close();
    return values;
  });
  expect(persisted).toEqual(seeded);
});

test("benchmark becomes interrupted when the registered seven-tool surface disappears", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html?mission=servo-repair-v1&benchmark=1");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 7 tools");
  await page.locator("#webmcp-model-label").fill("Test Model");
  await page.locator("#webmcp-config-label").fill("high reasoning");
  await page.locator('[data-webmcp-action="start-run"]').click();
  await page.evaluate(() => window.__removeWebMcpTool("diagnose_circuit"));
  await expect(page.locator("#webmcp-run-status")).toContainText("interrupted");
});

test("Agent drawer remains usable at the three challenge desktop viewports", async ({ page }) => {
  await installFakeWebMcp(page);
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1536, height: 864 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/circuits.html?mission=servo-repair-v1");
    await expect(page.locator("#circuit-agent-panel")).toBeVisible();
    const metrics = await page.evaluate(() => ({ bodyWidth: document.body.scrollWidth, viewportWidth: innerWidth, panelHeight: document.querySelector("#circuit-agent-panel")?.getBoundingClientRect().height ?? 0 }));
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
    expect(metrics.panelHeight).toBeGreaterThan(100);
  }
});

test("agent-destructive confirmation revalidates the staged transaction and commits nothing when stale", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html?mission=servo-repair-v1");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 7 tools");
  const state = await callTool(page, "get_circuit_state");
  const diagnosis = await callTool(page, "diagnose_circuit", { maxIssues: 6 });
  const issue = diagnosis.data.issues.find((item) => item.code === "servo-controller-power");
  expect((await callTool(page, "remove_connection", { expectedRevision: state.revision, connectionId: "unsafe_servo_power" })).code).toBe("pending_confirmation");
  await callTool(page, "show_circuit_issue", { issueId: issue.id });
  expect((await callTool(page, "get_circuit_state")).revision).toBe(state.revision);
  await page.locator("#circuit-tab-agent").click();
  await expect(page.locator("#webmcp-pending-card")).toBeVisible();
  await page.locator('[data-webmcp-pending-action="confirm"]').click();
  await expect(page.locator("#webmcp-pending-card")).toBeHidden();
  const after = await callTool(page, "get_circuit_state");
  expect(after.revision).toBe(state.revision);
  expect(after.data.connections.some((connection) => connection.id === "unsafe_servo_power")).toBe(true);
});
