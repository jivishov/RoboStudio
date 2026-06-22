import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";

import { solidToMeshData } from "../../src/parts/meshConversion.js";
import { applyFeatureEditToMesh, applyFeatureEditsToMesh } from "../../src/studio/featureEditing.js";
import { detectMeshFeatures } from "../../src/studio/featureDetection.js";

const { booleans, hulls, primitives, transforms } = jscad;
const { subtract } = booleans;
const { hull } = hulls;
const { cuboid, cylinder } = primitives;
const { rotateX, translate } = transforms;

function yCylinder(center, radius, height = 10) {
  return translate(center, rotateX(Math.PI / 2, cylinder({ radius, height, segments: 48 })));
}

function ySlot(center, length, width, height = 10) {
  const radius = width / 2;
  const halfStraight = length / 2 - radius;
  return hull(
    yCylinder([center[0] - halfStraight, center[1], center[2]], radius, height),
    yCylinder([center[0] + halfStraight, center[1], center[2]], radius, height)
  );
}

function twoHolePlate() {
  const plate = cuboid({ center: [0, 0, 0], size: [60, 6, 30] });
  return solidToMeshData(subtract(plate, yCylinder([-12, 0, 0], 2), yCylinder([12, 0, 0], 2)));
}

test("detects multiple circular through-holes in a plate-like STL mesh", () => {
  const mesh = twoHolePlate();
  const features = detectMeshFeatures({ vertices: mesh.vertices }, { partId: "plate" });

  assert.equal(features.length, 2);
  assert.ok(features.every((feature) => feature.type === "circularHole"));
  assert.deepEqual(features.map((feature) => Number(feature.center[0].toFixed(1))).sort((a, b) => a - b), [-12, 12]);
  assert.ok(features.every((feature) => feature.axis === "y"));
});

test("detects rounded slots in a plate-like STL mesh", () => {
  const plate = cuboid({ center: [0, 0, 0], size: [80, 6, 32] });
  const mesh = solidToMeshData(subtract(plate, ySlot([0, 0, 0], 24, 5)));
  const features = detectMeshFeatures({ vertices: mesh.vertices }, { partId: "plate" });

  assert.equal(features.length, 1);
  assert.equal(features[0].type, "roundedSlot");
  assert.equal(Number(features[0].lengthMm.toFixed(1)), 24);
  assert.equal(Number(features[0].widthMm.toFixed(1)), 5);
});

test("commits a hole spacing edit by replacing mesh vertices", () => {
  const mesh = twoHolePlate();
  const features = detectMeshFeatures({ vertices: mesh.vertices }, { partId: "plate" });
  const rightHole = features.find((feature) => feature.center[0] > 0);
  const edited = { ...rightHole, center: [14, 0, 0] };

  const result = applyFeatureEditToMesh({ vertices: mesh.vertices }, rightHole, edited);
  const nextFeatures = detectMeshFeatures({ vertices: result.vertices }, { partId: "plate" });
  const centers = nextFeatures.map((feature) => Number(feature.center[0].toFixed(1))).sort((a, b) => a - b);

  assert.equal(result.vertices.length, mesh.vertices.length);
  assert.deepEqual(centers, [-12, 14]);
});

test("commits a multi-feature hole edit as one mesh operation", () => {
  const mesh = twoHolePlate();
  const features = detectMeshFeatures({ vertices: mesh.vertices }, { partId: "plate" });
  const edits = features.map((feature) => ({
    originalFeature: feature,
    editedFeature: {
      ...feature,
      center: [feature.center[0] + 4, feature.center[1], feature.center[2]],
      radiusMm: 2.5,
      widthMm: 5
    }
  }));

  const result = applyFeatureEditsToMesh({ vertices: mesh.vertices }, edits);
  const nextFeatures = detectMeshFeatures({ vertices: result.vertices }, { partId: "plate" });
  const centers = nextFeatures.map((feature) => Number(feature.center[0].toFixed(1))).sort((a, b) => a - b);

  assert.equal(result.vertices.length, mesh.vertices.length);
  assert.deepEqual(centers, [-8, 16]);
  assert.ok(nextFeatures.every((feature) => Math.abs(feature.radiusMm - 2.5) < 0.25));
});
