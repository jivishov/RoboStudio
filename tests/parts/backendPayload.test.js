import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_PAYLOAD_VERSION,
  BackendPayloadError,
  FIDELITY_EXACT,
  FIDELITY_SAMPLED,
  exactBodyCompileRequest,
  exactBodyPayload,
  exactBodyUnavailableReason
} from "../../src/parts/backendPayload.js";
import { createAdvancedCadRecipeBodyFromArgs } from "../../src/parts/advancedCadRecipe.js";
import { createBooleanOperationBody, createRevolveBodyFromPreset } from "../../src/parts/featureOps.js";
import { createSpurGearBody } from "../../src/parts/gears.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { DEFAULT_CHORD_TOLERANCE_MM } from "../../src/parts/tessellation.js";
import { clearanceHoleDiameterMm } from "../../src/parts/standards/fasteners.js";

function plate() {
  return createBodyFromTemplate("base_plate");
}

test("every body kind has an exact payload, so STEP is no longer recipe-only", () => {
  const bodies = [
    plate(),
    createRevolveBodyFromPreset("spacer"),
    createSpurGearBody({ toothCount: 18, moduleMm: 1.5 }),
    createAdvancedCadRecipeBodyFromArgs({
      name: "Recipe",
      advancedCadRecipe: {
        version: 1,
        units: "mm",
        operations: [{ id: "base", type: "box", size: [10, 5, 10], center: [0, 0, 0] }]
      }
    }).body
  ];

  for (const body of bodies) {
    const payload = exactBodyPayload(body);
    assert.equal(payload.id, body.id);
    assert.ok(payload.kind, `${body.id} must declare its kind`);
    assert.ok([FIDELITY_EXACT, FIDELITY_SAMPLED].includes(payload.fidelity));
    assert.deepEqual(payload.scale, [1, 1, 1]);
    assert.equal(exactBodyUnavailableReason(body), null);
  }
});

test("a sketch payload carries profiles, not triangles, and the hole's own radius", () => {
  const payload = exactBodyPayload(plate());
  assert.equal(payload.kind, "sketchExtrude");
  assert.equal(payload.fidelity, FIDELITY_EXACT);
  assert.ok(payload.outerProfile.type);
  assert.ok(payload.cutProfiles.length > 0);
  // The point of a declarative payload: a circle stays a circle, so the bridge writes a
  // real BREP arc rather than a polygon of one.
  const circles = payload.cutProfiles.filter((profile) => profile.type === "circle");
  assert.ok(circles.length > 0);
  for (const circle of circles) assert.ok(circle.radiusMm > 0);

  // ⚠ The `hole` designation is deliberately absent. `createCircleProfile` already
  // derived the radius from the standard, so sending the designation as well would give
  // the bridge a second way to reach the same dimension - two numbers that must match.
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /"hole"/u);
  assert.doesNotMatch(serialized, /"standard"/u);
});

test("a resolved hole's radius reaches the bridge as the standard's number", () => {
  const body = normalizePartBody({
    id: "tapped",
    name: "Tapped",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [
        { id: "m3", type: "circle", x: 0, z: 0, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal" } }
      ]
    }
  });
  const [cut] = exactBodyPayload(body).cutProfiles;
  // A4: asserted through the accessor, never against a typed 3.4.
  assert.equal(cut.radiusMm * 2, clearanceHoleDiameterMm("M3", "normal"));
});

test("a blind pocket arrives as a shape and a depth, never as a fastener to re-resolve", () => {
  const body = normalizePartBody({
    id: "counterbored",
    name: "Counterbored",
    extrudeDepthMm: 8,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [
        {
          id: "cb",
          type: "circle",
          x: 0,
          z: 0,
          radius: 1,
          hole: { standard: "ISO metric", size: "M4", fit: "normal", style: "counterbore", fromFace: "top" }
        }
      ]
    }
  });
  const [pocket] = exactBodyPayload(body).pockets;
  assert.ok(pocket, "a counterbore must reach the bridge as a pocket");
  assert.equal(pocket.shape, "cylinder");
  assert.equal(pocket.fromFace, "top");
  assert.ok(pocket.depthMm > 0);
  assert.ok(pocket.diameterMm > 0);
  assert.equal(pocket.size, undefined);
  assert.equal(pocket.standard, undefined);
});

test("a spur gear declares itself sampled and says why", () => {
  const payload = exactBodyPayload(createSpurGearBody({ toothCount: 20, moduleMm: 2 }));
  assert.equal(payload.kind, "spurGear");
  // ⚠ Not exact, and it must not claim to be. Involute flanks are a point list at the
  // page's chord tolerance - the same curve the preview draws - and re-deriving them in
  // Python would be a second source of truth for the tooth form.
  assert.equal(payload.fidelity, FIDELITY_SAMPLED);
  assert.match(payload.fidelityNote, /chord tolerance/u);
  assert.ok(payload.profilePoints.length > 3);
  assert.ok(Number.isFinite(payload.twistSteps) && payload.twistSteps >= 1);
});

test("a revolve is exact, because a swept polygon is exact in OCCT", () => {
  const payload = exactBodyPayload(createRevolveBodyFromPreset("pulley"));
  assert.equal(payload.kind, "revolve");
  assert.equal(payload.fidelity, FIDELITY_EXACT);
  assert.ok(payload.profilePoints.length >= 3);
  assert.equal(payload.segments, undefined, "a segment count is a browser tessellation choice");
});

test("a boolean payload carries its whole operand closure, recursively", () => {
  const a = plate();
  const b = createSpurGearBody({ toothCount: 12, moduleMm: 1 });
  const boolean = createBooleanOperationBody("subtract", [a, b], { name: "Cut" }, new Set([a.id, b.id]));
  const outer = createBooleanOperationBody("union", [boolean, a], { name: "Outer" }, new Set([a.id, b.id, boolean.id]));

  const payload = exactBodyPayload(outer, { bodies: [a, b, boolean, outer] });
  assert.equal(payload.kind, "booleanOperation");
  assert.equal(payload.operands.length, 2);
  assert.equal(payload.operands[0].kind, "booleanOperation");
  assert.equal(payload.operands[0].operands.length, 2, "the closure is recursive, not one level deep");
  // A gear anywhere in the tree makes the whole thing sampled: a claim of exactness has
  // to be the weakest claim in the payload, not the strongest.
  assert.equal(payload.fidelity, FIDELITY_SAMPLED);
});

test("a missing operand refuses rather than exporting a solid that is not the body", () => {
  const a = plate();
  const b = createRevolveBodyFromPreset("collar");
  const boolean = createBooleanOperationBody("union", [a, b], { name: "Joined" }, new Set([a.id, b.id]));

  assert.throws(
    () => exactBodyPayload(boolean, { bodies: [a] }),
    (error) => {
      assert.ok(error instanceof BackendPayloadError);
      assert.equal(error.code, "backend-payload-missing-operand");
      assert.match(error.message, /whole body list/u);
      return true;
    }
  );
  assert.match(exactBodyUnavailableReason(boolean, { bodies: [a] }), /Boolean operand is missing/u);
  assert.equal(exactBodyUnavailableReason(boolean, { bodies: [a, b] }), null);
});

test("a body with nothing to write refuses for a reason about the body", () => {
  const empty = normalizePartBody({ id: "empty", name: "Empty", sketch: { outerProfile: null, cutProfiles: [] } });
  const reason = exactBodyUnavailableReason(empty);
  assert.match(reason, /no outer profile/u);
  assert.doesNotMatch(reason, /backend|bridge/u);
});

test("a thread reaches the bridge with its numbers, so Python holds no thread table", () => {
  const body = createAdvancedCadRecipeBodyFromArgs({
    name: "Stud",
    advancedCadRecipe: {
      version: 1,
      units: "mm",
      operations: [
        { id: "stud", type: "thread", threadSize: "M8", series: "coarse", threadKind: "external", length: 20, axis: "y" },
        { id: "round", type: "fillet", radius: 0.4 }
      ]
    }
  }).body;

  const payload = exactBodyPayload(body);
  const [thread] = payload.advancedCadRecipe.operations;
  assert.equal(thread.threadSize, "M8", "the designation still travels, because that is what was authored");
  assert.ok(thread.resolvedThread, "and so do the numbers it resolved to");
  assert.equal(thread.resolvedThread.pitchMm, 1.25);
  assert.equal(thread.resolvedThread.majorDiameterMm, 8);
  assert.ok(thread.resolvedThread.minorDiameterMm < thread.resolvedThread.majorDiameterMm);

  // ⚠ Derived output on a request, never persisted: the normalizer does not know the
  // field, so a round trip through the project drops it.
  assert.equal(normalizePartBody(body).advancedCadRecipe.operations[0].resolvedThread, undefined);
});

test("the request pins one tolerance for both kernels and asks for STEP alone by default", () => {
  const request = exactBodyCompileRequest(plate());
  assert.equal(request.payloadVersion, BACKEND_PAYLOAD_VERSION);
  assert.equal(request.units, "mm");
  // R8: before cycle 10 the bridge called `export_stl` with no tolerance, so the two
  // kernels faceted by unrelated rules on one preview surface.
  assert.equal(request.toleranceMm, DEFAULT_CHORD_TOLERANCE_MM);
  assert.equal(request.includeStep, true);
  assert.equal(request.includeStl, false);
  assert.equal(request.includeMesh, false, "the STEP path must never touch the ASCII STL");
  assert.equal(exactBodyCompileRequest(plate(), { toleranceMm: 0.005 }).toleranceMm, 0.005);
});

test("a scaled body exports at the size it was placed, not at nominal", () => {
  const scaled = normalizePartBody({ ...plate(), transform: { scale: [2, 1, 2] } });
  assert.deepEqual(exactBodyPayload(scaled).scale, [2, 1, 2]);
});
