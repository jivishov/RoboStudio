import assert from "node:assert/strict";
import test from "node:test";

import jscad from "@jscad/modeling";
import { compilePartBodyToSolid, compileSketchToGeom2 } from "../../src/parts/cadCompile.js";
import {
  EXACT_2D_METHOD,
  MESH_DIVERGENCE_METHOD,
  bodyGeometryProperties,
  outlinesMassProperties,
  scaleGeometryProperties,
  sketchExtrudeMassProperties,
  solidMassProperties,
  triangleSoupMassProperties
} from "../../src/parts/massProperties.js";
import { solidToMeshData } from "../../src/parts/meshConversion.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { massGramsForVolume } from "../../src/parts/materials.js";
import { createCircularHole, createRectangleProfile } from "../../src/parts/sketch.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { createRevolveBodyFromPreset } from "../../src/parts/featureOps.js";
import { createSpurGearBody } from "../../src/parts/gears.js";

const { measureArea, measureCenterOfMass, measureVolume } = jscad.measurements;
const { geom3 } = jscad.geometries;
const { cuboid } = jscad.primitives;

function plateBody(options = {}) {
  return {
    id: "plate",
    name: "Plate",
    source: { kind: "sketchExtrude" },
    transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    extrudeDepthMm: options.extrudeDepthMm ?? 5,
    sketch: {
      outerProfile: createRectangleProfile({ id: "outer", width: 40, height: 20, cornerRadius: 0 }),
      cutProfiles: options.cutProfiles ?? []
    }
  };
}

test("shoelace integral over outlines subtracts holes and finds the centroid", () => {
  // A 10 x 10 square wound counter-clockwise with a 2 x 2 clockwise hole at its centre.
  const outlines = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ],
    [
      [4, 4],
      [4, 6],
      [6, 6],
      [6, 4]
    ]
  ];

  const flat = outlinesMassProperties(outlines);
  assert.equal(flat.areaMm2, 96);
  assert.equal(Number(flat.perimeterMm.toFixed(6)), 48);
  assert.deepEqual(flat.centroid.map((value) => Number(value.toFixed(9))), [5, 5]);
  assert.deepEqual(flat.bounds, { min: [0, 0], max: [10, 10] });
});

test("an off-centre hole moves the centroid away from it", () => {
  const outlines = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ],
    [
      [1, 1],
      [1, 3],
      [3, 3],
      [3, 1]
    ]
  ];

  const flat = outlinesMassProperties(outlines);
  assert.equal(flat.areaMm2, 96);
  assert.ok(flat.centroid[0] > 5);
  assert.ok(flat.centroid[1] > 5);
});

test("exact 2D mass properties of a plain plate are closed form", () => {
  const properties = sketchExtrudeMassProperties(plateBody({ extrudeDepthMm: 5 }));

  assert.equal(properties.method, EXACT_2D_METHOD);
  assert.equal(Number(properties.crossSectionAreaMm2.toFixed(6)), 800);
  assert.equal(Number(properties.volumeMm3.toFixed(6)), 4000);
  // 2 faces of 800 plus a 120 mm perimeter over a 5 mm wall.
  assert.equal(Number(properties.surfaceAreaMm2.toFixed(6)), 2200);
  assert.deepEqual(properties.centroidMm.map((value) => Number(value.toFixed(9))), [0, 0, 0]);
  // Sketch plane is X/Z and Y is the extrusion, so a 40 x 20 profile 5 mm thick is
  // 40 in X, 5 in Y, 20 in Z.
  assert.deepEqual(properties.boundsMm.size.map((value) => Number(value.toFixed(6))), [40, 5, 20]);
});

test("the exact 2D path measures the region that is actually built, not an ideal one", () => {
  const body = plateBody({
    extrudeDepthMm: 5,
    cutProfiles: [createCircularHole({ id: "hole", x: 0, z: 0, radius: 5 })]
  });

  const exact = sketchExtrudeMassProperties(body);
  const mesh = solidMassProperties(compilePartBodyToSolid(body));
  const idealVolume = (800 - Math.PI * 25) * 5;

  // Stated tolerance, and which way each error points.
  //
  // "Exact" means exact over the compiled 2D region, which is what gets extruded,
  // previewed and exported - not exact over an ideal circle. The hole is an inscribed
  // polygon, so it removes slightly less material than a true circle would, and the
  // exact path reports that faithfully rather than quoting a number the user will not
  // get. At the tessellation this radius earns, that is under a tenth of a percent.
  assert.ok(exact.volumeMm3 > idealVolume);
  assert.ok((exact.volumeMm3 - idealVolume) / idealVolume < 0.001);

  // Against the mesh path the two share that same 2D region, so the only difference
  // left is triangulation of the walls and caps. The exact path is the reference
  // because it integrates the outline directly and treats the extrusion analytically.
  const relative = Math.abs(mesh.volumeMm3 - exact.volumeMm3) / exact.volumeMm3;
  assert.ok(relative < 1e-9, `mesh volume differs by ${relative}`);
  assert.equal(mesh.method, MESH_DIVERGENCE_METHOD);

  // The exact path also states things the mesh path cannot: profile area and perimeter.
  assert.ok(exact.perimeterMm > 120);
  assert.equal(mesh.perimeterMm, undefined);
});

// The meta plan's capability audit calls for this cross-check: JSCAD's own
// measurements are the independent second opinion on the exact 2D path.
for (const templateId of ["base_plate", "link_bar", "motor_face_mount", "electronics_tray"]) {
  test(`exact 2D mass properties agree with JSCAD measurements for ${templateId}`, () => {
    const body = createBodyFromTemplate(templateId);
    const exact = sketchExtrudeMassProperties(body);
    const geometry = compileSketchToGeom2(body.sketch);
    const measuredArea = Math.abs(measureArea(geometry));
    const measuredCenter = measureCenterOfMass(geometry);

    // Both integrate the same tessellated outline, so they agree to floating point
    // rather than to a modelling tolerance. A wider band would hide a real defect.
    assert.ok(
      Math.abs(exact.crossSectionAreaMm2 - measuredArea) <= Math.max(1e-6, measuredArea * 1e-9),
      `area ${exact.crossSectionAreaMm2} vs ${measuredArea}`
    );
    assert.ok(Math.abs(exact.centroidMm[0] - measuredCenter[0]) <= 1e-6);
    assert.ok(Math.abs(exact.centroidMm[2] - measuredCenter[1]) <= 1e-6);

    // And the extruded volume matches the solid JSCAD actually built, to the facet
    // error of the curves in the profile rather than to floating point.
    const solidVolume = measureVolume(compilePartBodyToSolid(body));
    const relative = Math.abs(exact.volumeMm3 - solidVolume) / solidVolume;
    assert.ok(relative < 0.005, `${templateId} volume differs by ${(relative * 100).toFixed(3)} percent`);
  });
}

test("divergence theorem volume matches JSCAD measureVolume on faceted kinds", () => {
  for (const body of [createRevolveBodyFromPreset("wheel"), createSpurGearBody({ gear: { toothCount: 18 } })]) {
    const solid = compilePartBodyToSolid(body);
    const properties = solidMassProperties(solid);
    const measured = measureVolume(solid);

    assert.equal(properties.method, MESH_DIVERGENCE_METHOD);
    assert.ok(
      Math.abs(properties.volumeMm3 - measured) <= Math.max(1e-6, measured * 1e-9),
      `${body.id}: ${properties.volumeMm3} vs ${measured}`
    );
    assert.ok(properties.surfaceAreaMm2 > 0);
    assert.equal(properties.centroidMm.length, 3);
  }
});

test("triangle soup properties match the solid they were converted from", () => {
  const body = createRevolveBodyFromPreset("pulley");
  const solid = compilePartBodyToSolid(body);
  const mesh = solidToMeshData(solid);
  const fromSolid = solidMassProperties(solid);
  const fromSoup = triangleSoupMassProperties(mesh.vertices, mesh.triangleCount);

  // Float32 round-tripping is the only difference, so the agreement is loose but tight.
  const relative = Math.abs(fromSoup.volumeMm3 - fromSolid.volumeMm3) / fromSolid.volumeMm3;
  assert.ok(relative < 1e-4, `soup volume differs by ${relative}`);
  assert.equal(fromSoup.triangleCount, mesh.triangleCount);
});

test("body geometry properties choose the exact path for sketches and the mesh path otherwise", () => {
  const plate = createBodyFromTemplate("base_plate");
  assert.equal(bodyGeometryProperties(plate, compilePartBodyToSolid(plate)).method, EXACT_2D_METHOD);

  const lathe = createRevolveBodyFromPreset("shaft");
  assert.equal(bodyGeometryProperties(lathe, compilePartBodyToSolid(lathe)).method, MESH_DIVERGENCE_METHOD);
});

test("a counterbored plate is not a prism, so the exact 2D path declines to state its volume", () => {
  const plain = normalizePartBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 8,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [{ id: "h1", type: "circle", x: 0, z: 0, radius: 1.7 }]
    }
  });
  const pocketed = normalizePartBody({
    ...plain,
    sketch: {
      ...plain.sketch,
      cutProfiles: [{ id: "h1", type: "circle", x: 0, z: 0, radius: 1.7, hole: { size: "M3", style: "counterbore" } }]
    }
  });

  // The closed form below the guard is "profile area times depth", and the pocket is
  // cut after extrusion, so the exact path would have reported the volume of the plate
  // the counterbore was cut from. It refuses instead.
  assert.equal(sketchExtrudeMassProperties(pocketed), null);
  assert.ok(sketchExtrudeMassProperties(plain), "an unpocketed plate still takes the exact path");

  const pocketedProperties = bodyGeometryProperties(pocketed, compilePartBodyToSolid(pocketed), { watertight: true });
  const plainProperties = bodyGeometryProperties(plain, compilePartBodyToSolid(plain));

  // The volume is stated by a path entitled to state it: the mesh, measured over the
  // solid that was actually built.
  assert.equal(pocketedProperties.method, MESH_DIVERGENCE_METHOD);
  assert.equal(plainProperties.method, EXACT_2D_METHOD);
  assert.equal(pocketedProperties.watertight, true);
  assert.ok(
    pocketedProperties.volumeMm3 < plainProperties.volumeMm3,
    `a counterbore removes material: ${pocketedProperties.volumeMm3} vs ${plainProperties.volumeMm3}`
  );
  // And specifically: it is not the prism's volume to within a rounding error.
  assert.ok(plainProperties.volumeMm3 - pocketedProperties.volumeMm3 > 50);
});

test("a pocket whose hole is refused leaves the exact 2D path in charge", () => {
  // The guard keys on resolvable pockets, not on the presence of a `hole`, so a hole
  // that produces no 3D geometry does not cost the body its exact measurement.
  const body = normalizePartBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 8,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [{ id: "h1", type: "circle", x: 0, z: 0, radius: 1.7, hole: { size: "M2.5", style: "heatSetInsert" } }]
    }
  });

  assert.equal(bodyGeometryProperties(body, compilePartBodyToSolid(body)).method, EXACT_2D_METHOD);
});

test("a non-watertight mesh reports a null volume instead of a fabricated one", () => {
  // Cycle 03 knowingly trusted the mesh to be closed here. The divergence theorem
  // over an open surface returns a number, and that number means nothing, so the
  // honest answer is no answer.
  const polygons = geom3.toPolygons(cuboid({ size: [10, 10, 10] }));
  const closed = geom3.create(polygons);
  const open = geom3.create(polygons.slice(0, 5));

  const good = solidMassProperties(closed);
  assert.equal(good.watertight, true);
  assert.equal(Number(good.volumeMm3.toFixed(6)), 1000);

  const bad = solidMassProperties(open);
  assert.equal(bad.watertight, false);
  assert.equal(bad.volumeMm3, null);
  // The centroid is divided by that volume, so it goes with it.
  assert.deepEqual(bad.centroidMm, [null, null, null]);
  assert.match(bad.volumeUnavailableReason, /not closed/u);
  // Area and bounds are properties of the surface and survive.
  assert.ok(bad.surfaceAreaMm2 > 0);
  assert.equal(bad.boundsMm.size[0], 10);
  assert.equal(bad.triangleCount, 10);

  // The caller can hand in a verdict it already has rather than paying twice.
  assert.equal(solidMassProperties(open, { watertight: true }).volumeMm3 != null, true);
  assert.equal(solidMassProperties(closed, { watertight: false }).volumeMm3, null);
});

test("the triangle-soup path is honest about closure too", () => {
  // The build123d backend hands back a mesh and no solid, so this is the only
  // measurement route available for it.
  const mesh = solidToMeshData(compilePartBodyToSolid(createRevolveBodyFromPreset("pulley")));
  assert.equal(triangleSoupMassProperties(mesh.vertices, mesh.triangleCount).watertight, true);

  const truncated = triangleSoupMassProperties(mesh.vertices.slice(0, mesh.vertices.length - 9), mesh.triangleCount - 1);
  assert.equal(truncated.volumeMm3, null);
  assert.equal(truncated.watertight, false);
  assert.ok(truncated.surfaceAreaMm2 > 0);
});

test("the exact 2D path does not vouch for a mesh it never looked at", () => {
  // A sketch body's volume comes from a closed 2D region, so it is stated whatever
  // the tessellated surface does - but this path never inspected that surface, so
  // it makes no watertight claim. The export gate reads the compile warning instead.
  const properties = bodyGeometryProperties(createBodyFromTemplate("base_plate"));
  assert.equal(properties.method, EXACT_2D_METHOD);
  assert.equal(properties.watertight, undefined);
  assert.equal(properties.volumeUnavailableReason, undefined);
  assert.ok(properties.volumeMm3 > 0);
});

test("a null volume survives placement scaling as null", () => {
  const open = geom3.create(geom3.toPolygons(cuboid({ size: [10, 10, 10] })).slice(0, 5));
  const scaled = scaleGeometryProperties(solidMassProperties(open), [2, 2, 2]);

  assert.equal(scaled.volumeMm3, null);
  assert.equal(scaled.watertight, false);
  assert.match(scaled.volumeUnavailableReason, /not closed/u);
  assert.equal(scaled.boundsMm.size[0], 20);
});

test("geometry properties carry no density and no material", () => {
  const properties = bodyGeometryProperties(createBodyFromTemplate("base_plate"));
  const keys = Object.keys(properties).join(" ").toLowerCase();
  assert.ok(!keys.includes("density"));
  assert.ok(!keys.includes("material"));
  assert.ok(!keys.includes("mass"));
});

test("an unmeasurable body reports null rather than a guess", () => {
  const empty = plateBody();
  empty.sketch.outerProfile = null;
  assert.equal(bodyGeometryProperties(empty, null), null);

  const zeroDepth = plateBody({ extrudeDepthMm: 0 });
  assert.equal(sketchExtrudeMassProperties(zeroDepth), null);
  assert.equal(triangleSoupMassProperties(new Float32Array(0), 0), null);
});

test("mass is geometry times density, applied outside this module", () => {
  const body = plateBody({ extrudeDepthMm: 5 });
  const properties = sketchExtrudeMassProperties(body);

  // 4000 mm3 is 4 cm3; PETG is 1.27 g/cm3.
  assert.equal(Number(massGramsForVolume(properties.volumeMm3, "petg").toFixed(6)), 5.08);
  assert.equal(Number(massGramsForVolume(properties.volumeMm3, "pla").toFixed(6)), 4.96);
  // An unknown material has no density to apply, so there is no number to state.
  assert.equal(massGramsForVolume(properties.volumeMm3, "unobtainium"), null);
});

test("placement scale is applied to the density-free result instead of recompiling", () => {
  const properties = sketchExtrudeMassProperties(plateBody({ extrudeDepthMm: 5 }));

  assert.deepEqual(scaleGeometryProperties(properties, [1, 1, 1]).volumeMm3, properties.volumeMm3);

  const doubled = scaleGeometryProperties(properties, [2, 2, 2]);
  assert.equal(Number(doubled.volumeMm3.toFixed(6)), Number((properties.volumeMm3 * 8).toFixed(6)));
  assert.equal(Number(doubled.surfaceAreaMm2.toFixed(6)), Number((properties.surfaceAreaMm2 * 4).toFixed(6)));
  assert.deepEqual(doubled.boundsMm.size.map((value) => Number(value.toFixed(6))), [80, 10, 40]);

  const thicker = scaleGeometryProperties(properties, [1, 3, 1]);
  assert.equal(Number(thicker.volumeMm3.toFixed(6)), Number((properties.volumeMm3 * 3).toFixed(6)));
  // The profile keeps its shape in the sketch plane, so an exact area is still available.
  assert.equal(Number(thicker.surfaceAreaMm2.toFixed(6)), Number((2 * 800 + 120 * 15).toFixed(6)));
});

test("a non-uniform scale of a faceted body reports no surface area rather than an approximation", () => {
  const solid = compilePartBodyToSolid(createRevolveBodyFromPreset("collar"));
  const scaled = scaleGeometryProperties(solidMassProperties(solid), [2, 1, 1]);

  assert.equal(scaled.surfaceAreaMm2, null);
  assert.ok(scaled.volumeMm3 > 0);
});
