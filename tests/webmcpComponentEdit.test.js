import assert from "node:assert/strict";
import test from "node:test";

import { circuitDesignRevision } from "../src/circuits/designRevision.js";
import { addComponent, createCircuitLabProject, normalizeProject, removeComponent, updateComponent } from "../src/circuits/model.js";
import { createActivityLog } from "../src/webmcp/activityLog.js";
import { COMPONENT_EDIT_TOOL_NAME, createCircuitComponentEditTool } from "../src/webmcp/componentEditTool.js";

function harness() {
  let project = createCircuitLabProject({ now: "2026-09-03T12:00:00.000Z" });
  const activityLog = createActivityLog();
  const executePageAction = async (name, args) => {
    if (name === "circuits_add_hardware") {
      project = addComponent(project, args.componentTypeId, { name: args.name, position: args.position, now: "2026-09-03T12:00:01.000Z" });
    } else if (name === "circuits_move_component") {
      project = updateComponent(project, args.componentId, { position: args.position }, { now: "2026-09-03T12:00:02.000Z" });
    } else if (name === "circuits_rotate_component") {
      project = updateComponent(project, args.componentId, { rotation: args.rotationDegrees }, { now: "2026-09-03T12:00:03.000Z" });
    } else if (name === "circuits_resize_component") {
      const component = project.components.find((item) => item.id === args.componentId);
      project = updateComponent(project, args.componentId, { props: { ...component.props, scale: args.scale } }, { now: "2026-09-03T12:00:04.000Z" });
    } else if (name === "circuits_remove_component") {
      project = removeComponent(project, args.componentId, { now: "2026-09-03T12:00:05.000Z" });
    } else {
      throw new Error(`Unexpected action ${name}`);
    }
    return { ok: true, message: "Action completed." };
  };
  return {
    runtime: {
      getProject: () => project,
      executePageAction,
      confirmRemoval: async () => true,
      activityLog,
      document: { querySelector: () => null }
    },
    getProject: () => normalizeProject(project),
    activityLog
  };
}

test("ordinary Circuit Lab component edit tool exposes one bounded write contract", () => {
  const tool = createCircuitComponentEditTool(harness().runtime);
  assert.equal(tool.name, COMPONENT_EDIT_TOOL_NAME);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.properties.operation.enum, ["add", "remove", "move", "rotate", "resize"]);
});

test("component edit tool adds, moves, rotates, resizes, and removes one component with revision chaining", async () => {
  const h = harness();
  const tool = createCircuitComponentEditTool(h.runtime);
  let revision = circuitDesignRevision(h.getProject());

  const added = await tool.execute({ expectedRevision: revision, operation: "add", componentTypeId: "led-red", name: "Agent LED", position: [640, 120] });
  assert.equal(added.code, "component_added");
  assert.ok(added.data.componentId);
  assert.equal(JSON.stringify(added).length <= 1500, true);
  const componentId = added.data.componentId;
  revision = added.revision;

  const moved = await tool.execute({ expectedRevision: revision, operation: "move", componentId, position: [620, 150] });
  assert.equal(moved.code, "component_moved");
  revision = moved.revision;

  const rotated = await tool.execute({ expectedRevision: revision, operation: "rotate", componentId, rotationDegrees: 90 });
  assert.equal(rotated.code, "component_rotated");
  revision = rotated.revision;

  const resized = await tool.execute({ expectedRevision: revision, operation: "resize", componentId, scale: 1.2 });
  assert.equal(resized.code, "component_resized");
  revision = resized.revision;

  const removed = await tool.execute({ expectedRevision: revision, operation: "remove", componentId });
  assert.equal(removed.code, "component_removed");
  assert.equal(h.getProject().components.some((item) => item.id === componentId), false);
  assert.equal(h.activityLog.all().some((event) => event.toolName === COMPONENT_EDIT_TOOL_NAME && event.code === "component_removed"), true);
});

test("component removal requires explicit human approval and stale revisions commit nothing", async () => {
  const h = harness();
  h.runtime.confirmRemoval = async () => false;
  const tool = createCircuitComponentEditTool(h.runtime);
  const revision = circuitDesignRevision(h.getProject());
  const cancelled = await tool.execute({ expectedRevision: revision, operation: "remove", componentId: "servo" });
  assert.equal(cancelled.code, "user_cancelled");
  assert.equal(circuitDesignRevision(h.getProject()), revision);
  assert.equal(h.getProject().components.some((item) => item.id === "servo"), true);

  const stale = await tool.execute({ expectedRevision: "clp1-0000000000000000", operation: "move", componentId: "servo", position: [200, 200] });
  assert.equal(stale.code, "stale_revision");
  assert.equal(circuitDesignRevision(h.getProject()), revision);
});

test("component edit handler revalidates operation-specific fields without relying on browser schema", async () => {
  const h = harness();
  const tool = createCircuitComponentEditTool(h.runtime);
  const revision = circuitDesignRevision(h.getProject());
  assert.equal((await tool.execute({ expectedRevision: revision, operation: "add", componentTypeId: "missing-part" })).code, "unknown_id");
  assert.equal((await tool.execute({ expectedRevision: revision, operation: "move", componentId: "servo", position: [1] })).code, "invalid_arguments");
  assert.equal((await tool.execute({ expectedRevision: revision, operation: "resize", componentId: "servo", scale: 4 })).code, "invalid_arguments");
  assert.equal((await tool.execute({ expectedRevision: revision, operation: "remove", componentId: "servo", position: [10, 10] })).code, "invalid_arguments");
});
