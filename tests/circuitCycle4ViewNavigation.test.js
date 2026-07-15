import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../src/circuits/catalog.js";
import { addComponent, createCircuitLabProject, normalizeProject } from "../src/circuits/model.js";
import {
  DEFAULT_VIEW_ZOOM,
  MAX_VIEW_ZOOM,
  clippedComponentCounts,
  componentCamera,
  defaultCameraForProject,
  overviewCameraForProject,
  viewBoxForCamera
} from "../src/circuits/workbenchView.js";
import { nearestVisibleTerminalInDirection } from "../src/circuits/spatialNavigation.js";

const getDefinition = (typeId) => catalog.getComponent(typeId);

test("default, overview, and frame camera policies keep presentation zoom separate from physical scale", () => {
  const project = createCircuitLabProject();
  const beforeScales = project.components.map((component) => component.props?.scale ?? null);
  const defaultView = defaultCameraForProject(project, getDefinition);
  assert.equal(defaultView.zoom, DEFAULT_VIEW_ZOOM);
  assert.deepEqual(project.components.map((component) => component.props?.scale ?? null), beforeScales);

  const overview = overviewCameraForProject(project, getDefinition);
  assert.ok(overview.zoom <= DEFAULT_VIEW_ZOOM);
  const component = project.components[0];
  const frame = componentCamera(component, getDefinition(component.typeId));
  assert.ok(frame.zoom <= MAX_VIEW_ZOOM);
  assert.ok(frame.zoom >= DEFAULT_VIEW_ZOOM);
  assert.deepEqual(project.components.map((item) => item.props?.scale ?? null), beforeScales);
});

test("directional clipping counts reflect the current view without mutating project state", () => {
  let project = normalizeProject({
    kind: "CircuitLabProject",
    version: 1,
    units: "mm",
    components: [],
    connections: [],
    app: { kind: "cycle4-view" }
  });
  project = addComponent(project, "led-red", { id: "left", position: [30, 325] });
  project = addComponent(project, "led-red", { id: "right", position: [1020, 325] });
  project = addComponent(project, "led-red", { id: "top", position: [525, 25] });
  project = addComponent(project, "led-red", { id: "bottom", position: [525, 625] });
  const serialized = JSON.stringify(project);
  const counts = clippedComponentCounts(project, getDefinition, viewBoxForCamera({ zoom: 1.5, center: [525, 325] }));
  assert.deepEqual(counts, { top: 1, right: 1, bottom: 1, left: 1 });
  assert.equal(JSON.stringify(project), serialized);
});

test("arrow navigation chooses the nearest visible terminal in the requested screen direction deterministically", () => {
  const anchors = [
    { endpointKey: "bb:center", screenPoint: [100, 100] },
    { endpointKey: "bb:right-near", screenPoint: [120, 102] },
    { endpointKey: "bb:right-far", screenPoint: [150, 100] },
    { endpointKey: "bb:down", screenPoint: [100, 125] },
    { endpointKey: "bb:left", screenPoint: [80, 100] },
    { endpointKey: "bb:outside", screenPoint: [300, 100] }
  ];
  const rect = { left: 0, top: 0, right: 200, bottom: 200 };
  assert.equal(nearestVisibleTerminalInDirection(anchors, "bb:center", "ArrowRight", rect).endpointKey, "bb:right-near");
  assert.equal(nearestVisibleTerminalInDirection(anchors, "bb:center", "ArrowDown", rect).endpointKey, "bb:down");
  assert.equal(nearestVisibleTerminalInDirection(anchors, "bb:center", "ArrowLeft", rect).endpointKey, "bb:left");
  assert.equal(nearestVisibleTerminalInDirection(anchors, "", "ArrowRight", rect).endpointKey, "bb:center");
});
