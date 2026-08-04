import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { clearanceHoleDiameterMm } from "../../src/parts/standards/fasteners.js";

const { measureVolume } = jscad.measurements;
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

test("the assistant's custom-sketch whitelist registers hole too, so a standard is not silently dropped", () => {
  // This is a *second* circle-profile whitelist: the custom-sketch path never goes
  // through `sketch.js`. An assistant asked for "a plate with M3 clearance holes"
  // would otherwise have got free radii with no indication the standard was lost,
  // which is landmine two in a module the cycle plan did not name.
  const result = createCustomSketchBodyFromArgs({
    name: "Standards plate",
    extrudeDepthMm: 6,
    outerProfile: { type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
    cutProfiles: [{ type: "circle", x: 12, z: 0, radius: 99, hole: { size: "M3", style: "counterbore" } }]
  });

  assert.equal(result.accepted, true, JSON.stringify(result.validationIssues));
  const cut = result.body.sketch.cutProfiles[0];
  assert.equal(cut.radius, clearanceHoleDiameterMm("M3", "normal") / 2);
  assert.equal(cut.hole.style, "counterbore");
  assert.deepEqual(validateBody(result.body), []);
  // And the pocket reaches the compiled solid, so the standard is geometry and not a label.
  const plain = createCustomSketchBodyFromArgs({
    name: "Plain plate",
    extrudeDepthMm: 6,
    outerProfile: { type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
    cutProfiles: [{ type: "circle", x: 12, z: 0, radius: clearanceHoleDiameterMm("M3", "normal") / 2 }]
  });
  assert.ok(
    measureVolume(compilePartBodyToSolid(result.body)) < measureVolume(compilePartBodyToSolid(plain.body))
  );
});

test("a custom sketch refuses an unresolvable hole rather than persisting one", () => {
  const refused = createCustomSketchBodyFromArgs({
    name: "Bad plate",
    outerProfile: { type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
    cutProfiles: [{ type: "circle", x: 0, z: 0, radius: 3, hole: { size: "M2.5", style: "heatSetInsert" } }]
  });

  assert.equal(refused.accepted, false);
  const holeIssue = refused.validationIssues.find((item) => item.code === "unresolvable-hole-standard");
  assert.match(holeIssue.message, /M2\.5/u);

  const wrongType = createCustomSketchBodyFromArgs({
    name: "Slotted plate",
    outerProfile: { type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
    cutProfiles: [{ type: "roundedSlot", x: 0, z: 0, length: 20, width: 6, hole: { size: "M3" } }]
  });
  assert.equal(wrongType.accepted, false);
  assert.ok(wrongType.validationIssues.some((item) => item.code === "unsupported-hole-profile"));
});
