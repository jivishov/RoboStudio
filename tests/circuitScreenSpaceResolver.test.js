import test from "node:test";
import assert from "node:assert/strict";
import {
  TERMINAL_POINTER_PROFILES,
  createProjectedTerminalResolver,
  resolveProjectedTerminal,
  terminalPointerProfile
} from "../src/circuits/screenSpaceResolver.js";
import { catalog } from "../src/circuits/catalog.js";
import { terminalWorldPosition } from "../src/circuits/geometry.js";
import { createCircuitLabProject } from "../src/circuits/model.js";

function anchor(endpointKey, x, y, options = {}) {
  const [componentId, terminalId] = endpointKey.split(":");
  return {
    endpointKey,
    endpoint: { componentId, terminalId },
    svgPoint: [x, y],
    invalidReason: options.invalidReason ?? null,
    capacityUsed: options.capacityUsed ?? 0,
    capacity: options.capacity ?? 1
  };
}

test("device profiles expose the required CSS-pixel radii, tie bands, and hysteresis", () => {
  assert.deepEqual(terminalPointerProfile("mouse"), {
    pointerType: "mouse", radiusPx: 12, tieBandPx: 2, hysteresisPx: 1
  });
  assert.deepEqual(terminalPointerProfile("pen"), {
    pointerType: "pen", radiusPx: 18, tieBandPx: 3, hysteresisPx: 2
  });
  assert.deepEqual(terminalPointerProfile("touch"), {
    pointerType: "touch", radiusPx: 22, tieBandPx: 6, hysteresisPx: 3
  });
  assert.equal(TERMINAL_POINTER_PROFILES.unknown, undefined);
  assert.equal(terminalPointerProfile("unknown").pointerType, "mouse");
});

test("the nearest geometric hit remains selected even when it is invalid or full", () => {
  const projected = [
    { ...anchor("uno:GND3", 0, 0, { invalidReason: "full", capacityUsed: 1 }), screenPoint: [100, 100] },
    { ...anchor("uno:D13", 0, 0), screenPoint: [105, 100] }
  ];
  const result = resolveProjectedTerminal(projected, [101, 100], { pointerType: "mouse" });
  assert.equal(result.target.endpointKey, "uno:GND3");
  assert.equal(result.target.invalidReason, "full");
  assert.equal(result.nearbyCandidates[1].endpointKey, "uno:D13");
});

test("ties are deterministic and hysteresis preserves the prior lock inside the device band", () => {
  const projected = [
    { ...anchor("uno:D13", 0, 0), screenPoint: [100, 100] },
    { ...anchor("uno:GND3", 0, 0), screenPoint: [102, 100] },
    { ...anchor("uno:D12", 0, 0), screenPoint: [110, 100] }
  ];
  const tied = resolveProjectedTerminal(projected, [101, 100], { pointerType: "mouse" });
  assert.equal(tied.ambiguous, true);
  assert.deepEqual(tied.candidates.map((candidate) => candidate.endpointKey), ["uno:D13", "uno:GND3"]);

  const locked = resolveProjectedTerminal(projected, [100.6, 100], {
    pointerType: "mouse",
    lockedEndpointKey: "uno:GND3"
  });
  assert.equal(locked.target.endpointKey, "uno:GND3");

  const unlocked = resolveProjectedTerminal(projected, [99, 100], {
    pointerType: "mouse",
    lockedEndpointKey: "uno:GND3"
  });
  assert.equal(unlocked.target.endpointKey, "uno:D13");
});

test("the cache projects the full anchor set through one screen CTM and rebuilds only after invalidation", () => {
  let anchors = [anchor("uno:D13", 10, 20), anchor("uno:GND3", 20, 20)];
  let matrixReads = 0;
  const resolver = createProjectedTerminalResolver({
    collectAnchors: () => anchors,
    getScreenCTM: () => {
      matrixReads += 1;
      return { a: 2, b: 0, c: 0, d: 3, e: 5, f: 7 };
    }
  });

  const first = resolver.resolve([25, 67], { pointerType: "mouse" });
  assert.equal(first.target.endpointKey, "uno:D13");
  assert.deepEqual(first.target.screenPoint, [25, 67]);
  resolver.resolve([45, 67], { pointerType: "mouse" });
  resolver.resolveEndpoint({ componentId: "uno", terminalId: "D13" });
  assert.equal(matrixReads, 1);
  assert.equal(resolver.stats().anchorCount, 2);

  anchors = [...anchors, anchor("uno:D12", 30, 20)];
  resolver.invalidate("component-rotation");
  const after = resolver.resolve([65, 67], { pointerType: "pen" });
  assert.equal(after.target.endpointKey, "uno:D12");
  assert.equal(matrixReads, 2);
  assert.equal(resolver.stats().anchorCount, 3);
  assert.equal(resolver.stats().lastInvalidationReason, "component-rotation");
});

test("rotation and camera projection preserve exact endpoint identity", () => {
  const resolver = createProjectedTerminalResolver({
    collectAnchors: () => [
      anchor("rotated:signal", 50, 70),
      anchor("rotated:ground", 70, 50)
    ],
    getScreenCTM: () => ({ a: 0, b: 2, c: -2, d: 0, e: 300, f: 100 })
  });
  const signal = resolver.resolve([160, 200], { pointerType: "touch" });
  assert.equal(signal.target.endpointKey, "rotated:signal");
  const ground = resolver.resolve([200, 240], { pointerType: "touch" });
  assert.equal(ground.target.endpointKey, "rotated:ground");
});

test("exact centers retain their endpoint identity at every required camera scale and layout translation", () => {
  for (const zoom of [0.65, 1, 1.5, 2.6, 4, 8]) {
    for (const translation of [[0, 0], [180, 90], [36, 240]]) {
      const d13 = [10 * zoom + translation[0], 20 * zoom + translation[1]];
      const projected = [
        { ...anchor("uno:D13", 10, 20), screenPoint: d13 },
        { ...anchor("uno:GND3", 12.54, 20), screenPoint: [12.54 * zoom + translation[0], 20 * zoom + translation[1]] }
      ];
      const result = resolveProjectedTerminal(projected, d13, { pointerType: "mouse" });
      assert.equal(result.target.endpointKey, "uno:D13", `D13 remains exact at zoom ${zoom}`);
    }
  }
});

test("every noncoincident starter-bench terminal resolves to itself across required zooms and cardinal rotations", () => {
  const project = createCircuitLabProject();
  for (const rotation of [0, 90, 180, 270]) {
    const anchors = project.components.flatMap((component) => {
      const rotated = { ...component, rotation };
      const definition = catalog.getComponent(component.typeId);
      return definition.terminals.map((terminal) => anchor(
        `${component.id}:${terminal.id}`,
        ...terminalWorldPosition(rotated, terminal)
      ));
    });
    assert.equal(anchors.length, 437);
    const positionCounts = new Map();
    for (const item of anchors) {
      const positionKey = item.svgPoint.map((value) => Number(value).toFixed(9)).join(":");
      positionCounts.set(positionKey, (positionCounts.get(positionKey) ?? 0) + 1);
    }
    const uniqueAnchors = anchors.filter((item) => (
      positionCounts.get(item.svgPoint.map((value) => Number(value).toFixed(9)).join(":")) === 1
    ));
    for (const zoom of [0.65, 1, 1.5, 2.6, 4, 8]) {
      const projected = anchors.map((item) => ({
        ...item,
        screenPoint: [item.svgPoint[0] * zoom + 173, item.svgPoint[1] * zoom + 89]
      }));
      const projectedByKey = new Map(projected.map((item) => [item.endpointKey, item]));
      for (const item of uniqueAnchors) {
        const expected = projectedByKey.get(item.endpointKey);
        const result = resolveProjectedTerminal(projected, expected.screenPoint, { pointerType: "mouse" });
        assert.equal(result.target.endpointKey, item.endpointKey, `${item.endpointKey} at ${rotation}deg / ${zoom}x`);
      }
    }
  }
});
