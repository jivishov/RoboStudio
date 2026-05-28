import assert from "node:assert/strict";
import test from "node:test";

import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import {
  createCustomSketchBodyFromArgs,
  replaceSketchBodyFromArgs
} from "../../src/parts/customSketchBody.js";
import { validateBody } from "../../src/parts/validation.js";

test("creates and compiles an accepted custom sketch body", () => {
  const result = createCustomSketchBodyFromArgs({
    name: "Triangular adapter",
    color: "#0ea5e9",
    extrudeDepthMm: 4,
    designIntent: "Three-point custom adapter plate with a central wire pass-through.",
    outerProfile: {
      type: "polyline",
      points: [
        [-42, -28],
        [42, -28],
        [0, 46]
      ],
      closed: true
    },
    cutProfiles: [
      { id: "wire_pass", type: "circle", x: 0, z: -2, radius: 5 }
    ]
  });

  assert.equal(result.accepted, true);
  assert.equal(result.body.id, "triangular_adapter");
  assert.equal(result.body.source.kind, "sketchExtrude");
  assert.equal(result.body.sketch.outerProfile.type, "polyline");
  assert.equal(result.body.sketch.cutProfiles[0].id, "wire_pass");
  assert.equal(result.body.designIntent, undefined);
  assert.equal(result.designIntent, "Three-point custom adapter plate with a central wire pass-through.");
  assert.equal(validateBody(result.body).length, 0);
  assert.ok(compilePartBodyToSolid(result.body));
});

test("custom sketch body generation keeps ids unique", () => {
  const result = createCustomSketchBodyFromArgs(
    {
      name: "Sensor bracket",
      extrudeDepthMm: 3,
      outerProfile: { type: "rectangle", width: 54, height: 32, cornerRadius: 2 }
    },
    { existingBodyIds: new Set(["sensor_bracket"]) }
  );

  assert.equal(result.accepted, true);
  assert.equal(result.body.id, "sensor_bracket_2");
});

test("custom sketch body generation rejects unsupported profiles", () => {
  const result = createCustomSketchBodyFromArgs({
    name: "Spline plate",
    extrudeDepthMm: 3,
    outerProfile: { type: "spline", points: [[0, 0], [10, 10], [20, 0]] }
  });

  assert.equal(result.accepted, false);
  assert.ok(result.validationIssues.some((issue) => issue.code === "unsupported-profile"));
});

test("custom sketch body generation rejects explicitly open polylines", () => {
  const result = createCustomSketchBodyFromArgs({
    name: "Open outline",
    extrudeDepthMm: 3,
    outerProfile: {
      type: "polyline",
      closed: false,
      points: [
        [-10, -10],
        [10, -10],
        [0, 10]
      ]
    }
  });

  assert.equal(result.accepted, false);
  assert.ok(result.validationIssues.some((issue) => issue.code === "open-outer-profile" || issue.code === "open-profile"));
});

test("custom sketch replacement preserves the body id and validates the new sketch", () => {
  const original = createCustomSketchBodyFromArgs({
    name: "Sensor bracket",
    extrudeDepthMm: 3,
    outerProfile: { type: "rectangle", width: 54, height: 32, cornerRadius: 2 }
  });
  const replacement = replaceSketchBodyFromArgs(original.body, {
    name: "Sensor bracket refined",
    extrudeDepthMm: 5,
    outerProfile: { type: "roundedSlot", length: 80, width: 22 },
    cutProfiles: [
      { id: "left_mount", type: "circle", x: -26, z: 0, radius: 3 },
      { id: "right_mount", type: "circle", x: 26, z: 0, radius: 3 }
    ]
  });

  assert.equal(replacement.accepted, true);
  assert.equal(replacement.body.id, original.body.id);
  assert.equal(replacement.body.name, "Sensor bracket refined");
  assert.equal(replacement.body.extrudeDepthMm, 5);
  assert.equal(replacement.body.sketch.cutProfiles.length, 2);
  assert.equal(validateBody(replacement.body).length, 0);
});
