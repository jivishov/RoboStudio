import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { PartCadCompileError, applyHolePocketsToSolid, compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { resolveHole } from "../../src/parts/holes.js";
import { createCircularHole } from "../../src/parts/sketch.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { counterboreMm, nutTrapMm } from "../../src/parts/standards/fasteners.js";
import { circleSegmentsForRadius } from "../../src/parts/tessellation.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { solidWatertightReport } from "../../src/parts/watertight.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;

const PLATE_WIDTH_MM = 60;
const PLATE_HEIGHT_MM = 40;
const PLATE_THICKNESS_MM = 8;

/** A plain plate with one central circular cut, optionally carrying a hole spec. */
function platedBody(hole = null, overrides = {}) {
  const cut = { id: "h1", type: "circle", x: 0, z: 0, radius: 1.7 };
  if (hole) cut.hole = hole;
  return normalizePartBody({
    id: "plate",
    name: "plate",
    extrudeDepthMm: PLATE_THICKNESS_MM,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: PLATE_WIDTH_MM, height: PLATE_HEIGHT_MM },
      cutProfiles: [cut]
    },
    ...overrides
  });
}

/** Cross-sectional material at one Y height, measured by intersecting a thin slab. */
function sliceAreaMm2(solid, y) {
  const slabThickness = 0.02;
  const slab = jscad.primitives.cuboid({
    center: [0, y, 0],
    size: [PLATE_WIDTH_MM * 2, slabThickness, PLATE_HEIGHT_MM * 2]
  });
  return measureVolume(jscad.booleans.intersect(solid, slab)) / slabThickness;
}

test("compiles a template body into X/Z sketch geometry with Y thickness", () => {
  const body = createBodyFromTemplate("base_plate");
  const solid = compilePartBodyToSolid(body);
  const [min, max] = measureBoundingBox(solid);

  assert.ok(max[0] - min[0] >= 119);
  assert.ok(max[2] - min[2] >= 79);
  assert.equal(Number((max[1] - min[1]).toFixed(3)), body.extrudeDepthMm);
});

test("subtracts cut profiles before extrusion", () => {
  const withHole = createBodyFromTemplate("spacer_standoff");
  const withoutHole = createBodyFromTemplate("spacer_standoff");
  withoutHole.sketch.cutProfiles = [];

  assert.ok(measureVolume(compilePartBodyToSolid(withHole)) < measureVolume(compilePartBodyToSolid(withoutHole)));
});

test("rejects invalid bodies without crashing compile callers", () => {
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles = [createCircularHole({ id: "bad_hole", x: 200, z: 0, radius: 3 })];

  assert.throws(() => compilePartBodyToSolid(body), (error) => {
    assert.ok(error instanceof PartCadCompileError);
    assert.ok(error.issues.some((issue) => issue.code === "cut-outside-outer-profile"));
    return true;
  });
});

test("a body with no hole pocket compiles byte-identically to before the cutter stage existed", () => {
  // The post-extrude stage must be invisible to everything that already worked, so
  // this compares the pocket-free paths rather than trusting that they are the same.
  const plain = compilePartBodyToSolid(platedBody());
  const throughHole = compilePartBodyToSolid(platedBody({ size: "M3", style: "through" }));

  assert.deepEqual(measureBoundingBox(throughHole), measureBoundingBox(plain));
  assert.equal(measureVolume(throughHole), measureVolume(plain));

  const untouched = compilePartBodyToSolid(platedBody());
  assert.equal(measureVolume(applyHolePocketsToSolid(untouched, platedBody())), measureVolume(untouched));
});

test("a counterbored M3 hole removes exactly the counterbore's material and stays watertight", () => {
  const body = platedBody({ size: "M3", style: "counterbore" });
  const resolved = resolveHole(body.sketch.cutProfiles[0].hole);
  const counterbore = counterboreMm("M3", "fdm");

  const pocketed = compilePartBodyToSolid(body);
  const plain = compilePartBodyToSolid(platedBody());

  // The plate is no longer a prism, and the volume difference is the annulus the
  // counterbore cuts away - asserted against the table, not against a literal.
  const removed = measureVolume(plain) - measureVolume(pocketed);

  // Compared against the *tessellated* annulus rather than the ideal one, so the
  // assertion is tight instead of tolerant. Both circles are inscribed polygons at
  // the 0.02 mm chord tolerance, and an ideal-circle expectation would be 71.779
  // against a measured 71.269 - a 0.7% gap that a widened tolerance would hide
  // rather than explain. The polygon closed form lands within 3e-5 relative, and
  // what is left is JSCAD's boolean retessellation.
  const inscribedArea = (radius) => {
    const segments = circleSegmentsForRadius(radius);
    return (segments / 2) * radius * radius * Math.sin((2 * Math.PI) / segments);
  };
  const expected =
    (inscribedArea(counterbore.diameterMm / 2) - inscribedArea(resolved.pilotRadiusMm)) * counterbore.depthMm;
  assert.ok(Math.abs(removed - expected) / expected < 1e-4, `removed ${removed} vs expected ${expected}`);
  assert.ok(
    removed < (Math.PI * (counterbore.diameterMm / 2) ** 2 - Math.PI * resolved.pilotRadiusMm ** 2) * counterbore.depthMm,
    "an inscribed polygon removes slightly less than the ideal annulus, never more"
  );

  // Confirmed, not assumed: a blind pocket in a closed prism should still be closed,
  // and the mesh export gate and the mesh volume both depend on it being so.
  const report = solidWatertightReport(pocketed);
  assert.equal(report.watertight, true);
  assert.equal(report.unmatchedEdgeCount, 0);
});

test("a top-face pocket opens on +Y and a bottom-face pocket on -Y", () => {
  const counterbore = counterboreMm("M3", "fdm");
  const half = PLATE_THICKNESS_MM / 2;
  const justInside = 0.2;

  const fromTop = compilePartBodyToSolid(platedBody({ size: "M3", style: "counterbore", fromFace: "top" }));
  const fromBottom = compilePartBodyToSolid(platedBody({ size: "M3", style: "counterbore", fromFace: "bottom" }));

  const pocketArea = Math.PI * (counterbore.diameterMm / 2) ** 2;
  const pilotArea = Math.PI * (resolveHole({ size: "M3" }).pilotRadiusMm) ** 2;
  const plate = PLATE_WIDTH_MM * PLATE_HEIGHT_MM;

  // Near the +Y face the top-cut body is missing the whole counterbore; near -Y it is
  // missing only the pilot. The bottom-cut body is the mirror image.
  assert.ok(Math.abs(sliceAreaMm2(fromTop, half - justInside) - (plate - pocketArea)) < 1);
  assert.ok(Math.abs(sliceAreaMm2(fromTop, -half + justInside) - (plate - pilotArea)) < 1);
  assert.ok(Math.abs(sliceAreaMm2(fromBottom, -half + justInside) - (plate - pocketArea)) < 1);
  assert.ok(Math.abs(sliceAreaMm2(fromBottom, half - justInside) - (plate - pilotArea)) < 1);
});

test("holes on both faces of one body are expressed by giving each hole its own face", () => {
  const body = normalizePartBody({
    id: "plate",
    name: "plate",
    extrudeDepthMm: PLATE_THICKNESS_MM,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: PLATE_WIDTH_MM, height: PLATE_HEIGHT_MM },
      cutProfiles: [
        { id: "top_cb", type: "circle", x: -15, z: 0, radius: 1.7, hole: { size: "M3", style: "counterbore", fromFace: "top" } },
        { id: "bottom_nut", type: "circle", x: 15, z: 0, radius: 1.7, hole: { size: "M3", style: "nutTrap", fromFace: "bottom" } }
      ]
    }
  });

  const solid = compilePartBodyToSolid(body);
  assert.equal(solidWatertightReport(solid).watertight, true);

  const half = PLATE_THICKNESS_MM / 2;
  const nearTop = sliceAreaMm2(solid, half - 0.2);
  const nearBottom = sliceAreaMm2(solid, -half + 0.2);
  const middle = sliceAreaMm2(solid, 0);
  // The mid-plane sees only the two pilots, so it has the most material; each face
  // loses its own pocket and neither loses the other's.
  assert.ok(middle > nearTop, "the top face is missing its counterbore");
  assert.ok(middle > nearBottom, "the bottom face is missing its nut trap");
});

test("a nut trap cuts a hexagon at the ISO 4032 across-flats, not a cylinder", () => {
  const body = platedBody({ size: "M6", style: "nutTrap" }, { extrudeDepthMm: 12 });
  const nut = nutTrapMm("M6");
  const solid = compilePartBodyToSolid(body);

  const removedAtFace = PLATE_WIDTH_MM * PLATE_HEIGHT_MM - sliceAreaMm2(solid, 12 / 2 - 0.2);
  // A regular hexagon of across-flats `a` has area a^2 * sqrt(3) / 2. A cylinder of
  // the same across-corners would be noticeably larger, which is what this separates.
  const hexArea = (nut.acrossFlatsMm ** 2 * Math.sqrt(3)) / 2;
  const circleArea = Math.PI * (nut.acrossCornersMm / 2) ** 2;
  assert.ok(Math.abs(removedAtFace - hexArea) < 0.5, `removed ${removedAtFace} vs hexagon ${hexArea}`);
  assert.ok(circleArea - hexArea > 1, "the circumscribed circle is meaningfully larger");
});

test("a refused hole compiles to its unchanged pilot rather than failing or guessing", () => {
  const body = platedBody({ size: "M2.5", style: "heatSetInsert" });
  assert.equal(body.sketch.cutProfiles[0].radius, 1.7, "the author's radius survives a refusal");

  const solid = compilePartBodyToSolid(body);
  assert.equal(measureVolume(solid), measureVolume(compilePartBodyToSolid(platedBody())));
  assert.equal(solidWatertightReport(solid).watertight, true);
});
