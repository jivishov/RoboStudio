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

test("ordinary Circuit Lab registers component editing while challenge mission keeps the seven-tool benchmark surface", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 8 tools");
  await expect.poll(() => page.evaluate(() => window.__webmcpTools.map((tool) => tool.name))).toContain("edit_circuit_component");

  await page.goto("/circuits.html?mission=servo-repair-v1&benchmark=1");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 7 tools");
  await expect.poll(() => page.evaluate(() => window.__webmcpTools.length)).toBe(7);
  expect(await page.evaluate(() => window.__webmcpTools.some((tool) => tool.name === "edit_circuit_component"))).toBe(false);
});

test("component edit tool adds, moves, rotates, resizes, and removes an individual component", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 8 tools");

  let state = await callTool(page, "get_circuit_state");
  const added = await callTool(page, "edit_circuit_component", {
    expectedRevision: state.revision,
    operation: "add",
    componentTypeId: "led-red",
    name: "Agent LED",
    position: [640, 120]
  });
  expect(added.code).toBe("component_added");
  const componentId = added.data.componentId;
  expect(componentId).toBeTruthy();

  state = await callTool(page, "get_circuit_state");
  const moved = await callTool(page, "edit_circuit_component", {
    expectedRevision: state.revision,
    operation: "move",
    componentId,
    position: [620, 150]
  });
  expect(moved.code).toBe("component_moved");

  state = await callTool(page, "get_circuit_state");
  const rotated = await callTool(page, "edit_circuit_component", {
    expectedRevision: state.revision,
    operation: "rotate",
    componentId,
    rotationDegrees: 90
  });
  expect(rotated.code).toBe("component_rotated");

  state = await callTool(page, "get_circuit_state");
  const resized = await callTool(page, "edit_circuit_component", {
    expectedRevision: state.revision,
    operation: "resize",
    componentId,
    scale: 1.2
  });
  expect(resized.code).toBe("component_resized");

  state = await callTool(page, "get_circuit_state");
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain(componentId);
    await dialog.accept();
  });
  const removed = await callTool(page, "edit_circuit_component", {
    expectedRevision: state.revision,
    operation: "remove",
    componentId
  });
  expect(removed.code).toBe("component_removed");

  const finalState = await callTool(page, "get_circuit_state");
  expect(finalState.data.components.some((component) => component.id === componentId)).toBe(false);
});

test("component removal cancellation and stale revisions leave the circuit unchanged", async ({ page }) => {
  await installFakeWebMcp(page);
  await page.goto("/circuits.html");
  await expect(page.locator("#webmcp-status")).toHaveText("Ready - 8 tools");
  const state = await callTool(page, "get_circuit_state");

  page.once("dialog", (dialog) => dialog.dismiss());
  const cancelled = await callTool(page, "edit_circuit_component", {
    expectedRevision: state.revision,
    operation: "remove",
    componentId: "servo"
  });
  expect(cancelled.code).toBe("user_cancelled");
  expect((await callTool(page, "get_circuit_state")).revision).toBe(state.revision);

  const stale = await callTool(page, "edit_circuit_component", {
    expectedRevision: "clp1-0000000000000000",
    operation: "move",
    componentId: "servo",
    position: [200, 200]
  });
  expect(stale.code).toBe("stale_revision");
  expect((await callTool(page, "get_circuit_state")).revision).toBe(state.revision);
});
