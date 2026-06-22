import assert from "node:assert/strict";
import test from "node:test";

import {
  FEATURE_DETECTION_STATES,
  classifyPointerGesture,
  isSpacingPairSupported,
  pickFeatureTarget
} from "../../src/studio/interaction.js";

test("classifies small pointer movement as click and larger movement as drag", () => {
  const start = { clientX: 10, clientY: 10, button: 0, pointerId: 1 };

  assert.equal(classifyPointerGesture(start, { clientX: 13, clientY: 12, button: 0, pointerId: 1 }).isClick, true);
  assert.equal(classifyPointerGesture(start, { clientX: 22, clientY: 10, button: 0, pointerId: 1 }).isClick, false);
  assert.equal(classifyPointerGesture(start, { clientX: 13, clientY: 12, button: 0, pointerId: 1 }, { dragging: true }).isClick, false);
});

test("picks the nearest visible fresh circular feature", () => {
  const features = [
    { partId: "plate", featureId: "hole_left", worldCenter: [0, 0, 0], visible: true },
    { partId: "plate", featureId: "hole_right", worldCenter: [20, 0, 0], visible: true }
  ];

  const result = pickFeatureTarget(features, [118, 100], {
    tolerancePx: 18,
    projectWorldPoint: ([x, y]) => ({ screen: [100 + x, 100 + y], visible: true })
  });

  assert.equal(result.featureId, "hole_right");
  assert.equal(result.role, "center");
});

test("distinguishes rounded slot endpoints from centerline", () => {
  const features = [
    {
      partId: "plate",
      featureId: "slot_1",
      type: "roundedSlot",
      worldCenter: [0, 0, 0],
      worldEndpoints: [
        [-10, 0, 0],
        [10, 0, 0]
      ],
      visible: true
    }
  ];
  const projectWorldPoint = ([x, y]) => ({ screen: [100 + x, 100 + y], visible: true });

  assert.equal(
    pickFeatureTarget(features, [90, 100], { tolerancePx: 18, projectWorldPoint }).role,
    "endpointA"
  );
  assert.equal(
    pickFeatureTarget(features, [105, 102], { tolerancePx: 18, projectWorldPoint }).role,
    "centerline"
  );
});

test("ignores hidden and stale feature targets", () => {
  const features = [
    { partId: "plate", featureId: "hidden", worldCenter: [0, 0, 0], visible: false },
    { partId: "plate", featureId: "stale", worldCenter: [0, 0, 0], stale: true },
    { partId: "plate", featureId: "ready", worldCenter: [20, 0, 0], visible: true }
  ];

  const result = pickFeatureTarget(features, [100, 100], {
    tolerancePx: 18,
    projectWorldPoint: ([x, y]) => ({ screen: [100 + x, 100 + y], visible: true })
  });

  assert.equal(result, null);
});

test("supports same imported-part feature spacing and cross-part spacing", () => {
  const a = { partId: "plate", featureId: "hole_a" };
  const b = { partId: "plate", featureId: "hole_b" };
  const cross = { partId: "servo" };

  assert.equal(
    isSpacingPairSupported(a, b, { isPartEditable: (partId) => partId === "plate" }),
    true
  );
  assert.equal(
    isSpacingPairSupported(a, b, { isPartEditable: () => false }),
    false
  );
  assert.equal(isSpacingPairSupported(a, cross), true);
  assert.equal(FEATURE_DETECTION_STATES.READY, "ready");
});
