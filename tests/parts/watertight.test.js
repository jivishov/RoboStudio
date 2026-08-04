import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import {
  NON_WATERTIGHT_CODE,
  detectNonWatertightSolid,
  solidWatertightReport,
  triangleSoupWatertightReport
} from "../../src/parts/watertight.js";
import { compilePartBodyToSolid } from "../../src/parts/cadCompile.js";
import { createBodyFromTemplate, listPartTemplates } from "../../src/parts/templates.js";
import { createBooleanOperationBody, createRevolveBodyFromPreset } from "../../src/parts/featureOps.js";
import { createSpurGearBody } from "../../src/parts/gears.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { validateBody } from "../../src/parts/validation.js";
import { solidToMeshData } from "../../src/parts/meshConversion.js";

const { geom3 } = jscad.geometries;
const { cuboid } = jscad.primitives;

/** A cube with `dropped` faces removed, so it has a known number of holes. */
function cubeMissingFaces(dropped) {
  const polygons = geom3.toPolygons(cuboid({ size: [10, 10, 10] }));
  assert.equal(polygons.length, 6);
  return geom3.create(polygons.slice(0, polygons.length - dropped));
}

test("every starter template compiles to a closed surface", () => {
  for (const template of listPartTemplates()) {
    const solid = compilePartBodyToSolid(createBodyFromTemplate(template.id));
    const report = solidWatertightReport(solid);
    assert.equal(report.watertight, true, `${template.id} should be watertight`);
    assert.equal(report.unmatchedEdgeCount, 0);
    // A sketch extrusion shares every vertex exactly, so there is nothing for the
    // collinear pass to resolve. That is what makes the boolean case below
    // interesting rather than incidental.
    assert.equal(report.unpairedDirectedEdgeCount, 0);
  }
});

test("revolve and gear bodies are closed, including a partial revolve", () => {
  for (const angleDeg of [360, 180, 90]) {
    const preset = createRevolveBodyFromPreset("pulley");
    const body = normalizePartBody({ ...preset, revolve: { ...preset.revolve, angleDeg } });
    const report = solidWatertightReport(compilePartBodyToSolid(body));
    assert.equal(report.watertight, true, `a ${angleDeg} degree revolve should be capped closed`);
  }

  assert.equal(solidWatertightReport(compilePartBodyToSolid(normalizePartBody(createSpurGearBody()))).watertight, true);
});

test("a boolean union is closed despite hundreds of unpaired edges", () => {
  // The load-bearing test in this file. JSCAD's booleans split polygons against
  // one another and leave T-junctions, so naive edge pairing reports a large
  // number of "open" edges on a solid that encloses a perfectly closed volume.
  // A watertight gate built on naive pairing would have blocked mesh export for
  // every boolean body in the page.
  const plate = normalizePartBody(createBodyFromTemplate("base_plate", { existingIds: new Set() }));
  const mount = normalizePartBody(createBodyFromTemplate("servo_mount_plate", { existingIds: new Set(["base_plate"]) }));

  // The exact leftover counts are deliberately *not* pinned. Cycle 04's completion
  // doc recorded 176 / 384 / 208; the same three operations measure 144 / 352 / 208
  // today, because cycle 08's hole retrofit changed the templates being combined.
  // A literal here would have failed that cycle for a reason that has nothing to do
  // with watertightness, and `@jscad/modeling` floats on `latest` besides. What has
  // to hold is the property the module exists for, so the counts are reported in the
  // failure message rather than asserted: the sweep must find a large number of
  // leftovers and explain **every one** of them.
  for (const operation of ["union", "subtract", "intersect"]) {
    const bool = normalizePartBody(
      createBooleanOperationBody(operation, [plate, mount], {}, new Set([plate.id, mount.id]))
    );
    const solid = compilePartBodyToSolid(bool, { bodies: [plate, mount, bool] });
    const report = solidWatertightReport(solid);
    const seen = `${operation}: ${report.unpairedDirectedEdgeCount} unpaired, ${report.tJunctionEdgeCount} explained, ${report.unmatchedEdgeCount} unmatched`;

    // The negative control. Without this, "watertight: true" would pass just as
    // happily on a body that left nothing for the resolver to do, and the test
    // would stop exercising the code it is named after.
    assert.ok(report.unpairedDirectedEdgeCount > 100, `${seen} - naive pairing must be the thing that fails here`);
    assert.equal(report.tJunctionEdgeCount, report.unpairedDirectedEdgeCount, seen);
    assert.equal(report.unmatchedEdgeCount, 0, seen);
    assert.equal(report.watertight, true, `${seen} - ${operation} encloses a closed volume`);
  }
});

test("a cube missing one face is reported as open", () => {
  const report = solidWatertightReport(cubeMissingFaces(1));

  assert.equal(report.watertight, false);
  assert.equal(report.polygonCount, 5);
  // The four edges of the missing face have nothing to pair with, and nothing
  // collinear covers them.
  assert.equal(report.unpairedDirectedEdgeCount, 4);
  assert.equal(report.unmatchedEdgeCount, 4);
  assert.equal(report.tJunctionEdgeCount, 0);
});

test("a cube missing two opposite faces is reported as open", () => {
  // A surface-integral closure test would pass this one: the area vectors of two
  // opposite faces cancel exactly, so the summed normal is zero. The collinear
  // sweep does not, because the eight leftover edges sit on eight distinct lines.
  const report = solidWatertightReport(cubeMissingFaces(2));

  assert.equal(report.watertight, false);
  assert.equal(report.unmatchedEdgeCount, 8);

  let areaVectorMagnitude = 0;
  const sum = [0, 0, 0];
  for (const polygon of geom3.toPolygons(cubeMissingFaces(2))) {
    const [a, b, c] = polygon.vertices;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    sum[0] += (u[1] * v[2] - u[2] * v[1]) / 2;
    sum[1] += (u[2] * v[0] - u[0] * v[2]) / 2;
    sum[2] += (u[0] * v[1] - u[1] * v[0]) / 2;
  }
  areaVectorMagnitude = Math.hypot(...sum);
  assert.ok(areaVectorMagnitude < 1e-9, "the cheaper closure test really is fooled here");
});

test("the finding is a warning that never reaches validateBody", () => {
  const open = cubeMissingFaces(1);
  const issue = detectNonWatertightSolid(open, { path: "bodies.open_plate" });

  assert.equal(issue.code, NON_WATERTIGHT_CODE);
  assert.equal(issue.severity, "warning");
  assert.equal(issue.path, "bodies.open_plate");
  assert.equal(issue.unmatchedEdgeCount, 4);
  assert.match(issue.message, /closed surface/u);

  // A body that compiles is structurally sound whatever its surface does, so
  // `validateBody` stays empty. Anything pushed into it would block compile,
  // preview and handoff at any severity.
  const plate = createBodyFromTemplate("base_plate");
  assert.deepEqual(validateBody(plate), []);
  assert.equal(detectNonWatertightSolid(compilePartBodyToSolid(plate)), null);
});

test("a precomputed report is reused rather than recomputed", () => {
  // The compile path computes the report once and shares it with the mass
  // properties, so this overload has to be the one that decides.
  const closed = compilePartBodyToSolid(createBodyFromTemplate("base_plate"));
  const forced = detectNonWatertightSolid(closed, {
    report: { watertight: false, unmatchedEdgeCount: 7, unpairedDirectedEdgeCount: 7, tJunctionEdgeCount: 0, polygonCount: 3 }
  });

  assert.equal(forced.code, NON_WATERTIGHT_CODE);
  assert.equal(forced.unmatchedEdgeCount, 7);
  assert.equal(detectNonWatertightSolid(closed, { report: { watertight: true } }), null);
});

test("nothing is claimed about a solid the check cannot walk", () => {
  // Never throws: the report annotates a compile, so a failure to analyse must not
  // fail the compile. That also means the export gate cannot read a missing report
  // as proof of closure, which is why it recomputes over the solid it serializes.
  assert.equal(detectNonWatertightSolid(null), null);
  assert.equal(detectNonWatertightSolid({ not: "a solid" }), null);
});

test("an empty solid is not watertight, and says so", () => {
  const report = solidWatertightReport(geom3.create([]));
  assert.equal(report.watertight, false);
  assert.equal(report.polygonCount, 0);
  assert.match(detectNonWatertightSolid(geom3.create([])).message, /no surface polygons/u);
});

test("the triangle-soup report agrees with the solid report on the same body", () => {
  // The build123d backend hands back a mesh and no solid, so the soup path is the
  // only route available there and it must reach the same verdict.
  const solid = compilePartBodyToSolid(createBodyFromTemplate("electronics_tray"));
  const mesh = solidToMeshData(solid);

  const soup = triangleSoupWatertightReport(mesh.vertices, mesh.triangleCount);
  assert.equal(soup.watertight, true);
  // The mesh is float32 and the solid is float64, so the vertex count is allowed
  // to differ; the verdict is not.
  assert.equal(soup.unmatchedEdgeCount, 0);

  const truncated = triangleSoupWatertightReport(mesh.vertices.slice(0, mesh.vertices.length - 9), mesh.triangleCount - 1);
  assert.equal(truncated.watertight, false);
  assert.ok(truncated.unmatchedEdgeCount > 0);
});

test("a plate severed in two is two closed lumps, not an open surface", () => {
  // Disconnected and open are different findings. `connectivity.js` owns the first
  // and this module owns the second, and a severed plate must trip only one.
  const severed = normalizePartBody({
    id: "severed",
    name: "Severed plate",
    extrudeDepthMm: 4,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40, cornerRadius: 0 },
      cutProfiles: [{ id: "slot", type: "rectangle", x: 0, z: 0, width: 40, height: 6, cornerRadius: 0 }]
    }
  });

  const report = solidWatertightReport(compilePartBodyToSolid(severed));
  assert.equal(report.watertight, true);
  assert.equal(report.unmatchedEdgeCount, 0);
});
