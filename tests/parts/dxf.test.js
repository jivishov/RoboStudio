import assert from "node:assert/strict";
import test from "node:test";

import {
  CUT_LAYER,
  OUTER_LAYER,
  POCKET_NOT_IN_DXF_CODE,
  PartDxfExportError,
  bodyDxfPlan,
  dxfFileNameForBody,
  serializeBodyToDxf
} from "../../src/parts/exporters/dxf.js";
import { DFM_OVERLAPPING_CUTS, validateManufacturability } from "../../src/parts/dfm.js";
import { CLEARANCE_FITS, clearanceHoleDiameterMm, counterboreMm } from "../../src/parts/standards/fasteners.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { createCircularHole } from "../../src/parts/sketch.js";

/**
 * A real DXF reader, deliberately not a snapshot.
 *
 * The acceptance criterion for this cycle is that the DXF is asserted by parsing
 * the emitted text, because a snapshot proves only that the output has not
 * changed, not that it is a file a laser cutter would accept.
 */
function parseDxf(text) {
  const lines = text.split("\r\n");
  assert.equal(lines[lines.length - 1], "", "DXF should end with a line terminator");
  const pairs = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    pairs.push([Number(lines[index]), lines[index + 1]]);
  }

  const header = {};
  const layers = [];
  const entities = [];
  const sections = [];
  let section = null;
  let table = null;
  let current = null;
  let variable = null;

  const flush = () => {
    if (current) entities.push(current);
    current = null;
  };

  for (const [code, value] of pairs) {
    if (code === 0 && value === "SECTION") {
      flush();
      section = "pending";
      continue;
    }
    if (code === 2 && section === "pending") {
      section = value;
      sections.push(value);
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      flush();
      section = null;
      continue;
    }
    if (code === 0 && value === "EOF") {
      flush();
      sections.push("EOF");
      continue;
    }

    if (section === "HEADER") {
      if (code === 9) {
        variable = value;
        header[variable] = {};
        continue;
      }
      if (variable) header[variable][code] = value;
      continue;
    }

    if (section === "TABLES") {
      if (code === 0 && value === "TABLE") {
        table = "pending";
        continue;
      }
      if (code === 2 && table === "pending") {
        table = value;
        continue;
      }
      if (code === 0 && value === "ENDTAB") {
        table = null;
        continue;
      }
      if (table === "LAYER" && code === 0 && value === "LAYER") {
        layers.push({});
        continue;
      }
      if (table === "LAYER" && layers.length) layers[layers.length - 1][code] = value;
      continue;
    }

    if (section === "ENTITIES") {
      if (code === 0) {
        if (value === "VERTEX") {
          current.vertices.push({});
          current.pendingVertex = true;
          continue;
        }
        if (value === "SEQEND") {
          current.pendingVertex = false;
          continue;
        }
        flush();
        current = { type: value, vertices: [], pendingVertex: false };
        continue;
      }
      if (!current) continue;
      if (current.pendingVertex) current.vertices[current.vertices.length - 1][code] = value;
      else current[code] = value;
    }
  }

  return { header, layers, entities, sections };
}

const number = (value) => Number(value);

/** Start and end point of an entity, in the order the contour walks it. */
function entityEndpoints(entity) {
  if (entity.type === "LINE") {
    return [
      [number(entity[10]), number(entity[20])],
      [number(entity[11]), number(entity[21])]
    ];
  }
  if (entity.type === "ARC") {
    const cx = number(entity[10]);
    const cy = number(entity[20]);
    const radius = number(entity[40]);
    const start = (number(entity[50]) * Math.PI) / 180;
    const end = (number(entity[51]) * Math.PI) / 180;
    return [
      [cx + Math.cos(start) * radius, cy + Math.sin(start) * radius],
      [cx + Math.cos(end) * radius, cy + Math.sin(end) * radius]
    ];
  }
  return null;
}

/**
 * Whether the LINE and ARC entities on a layer form closed loops.
 *
 * Every endpoint of an open entity must coincide with exactly one other endpoint,
 * which is what "closed" means for a cut path. `CIRCLE` and closed `POLYLINE`
 * entities are closed by construction and are counted separately.
 */
function contourClosure(entities, layer, tolerance = 1e-6) {
  const onLayer = entities.filter((entity) => entity[8] === layer);
  const endpoints = [];
  let closedByConstruction = 0;

  for (const entity of onLayer) {
    if (entity.type === "CIRCLE") {
      closedByConstruction += 1;
      continue;
    }
    if (entity.type === "POLYLINE") {
      assert.equal(entity[70], "1", "a profile POLYLINE must carry the closed flag");
      closedByConstruction += 1;
      continue;
    }
    const ends = entityEndpoints(entity);
    if (ends) endpoints.push(...ends);
  }

  const unmatched = [];
  const used = new Set();
  for (let index = 0; index < endpoints.length; index += 1) {
    if (used.has(index)) continue;
    const partner = endpoints.findIndex(
      (point, other) =>
        other !== index &&
        !used.has(other) &&
        Math.abs(point[0] - endpoints[index][0]) <= tolerance &&
        Math.abs(point[1] - endpoints[index][1]) <= tolerance
    );
    if (partner === -1) {
      unmatched.push(endpoints[index]);
      continue;
    }
    used.add(index);
    used.add(partner);
  }

  return { closedByConstruction, openEndpoints: unmatched.length, entityCount: onLayer.length };
}

test("a base plate DXF is a valid R12 document declaring millimetres", () => {
  const parsed = parseDxf(serializeBodyToDxf(createBodyFromTemplate("base_plate")));

  assert.deepEqual(parsed.sections, ["HEADER", "TABLES", "ENTITIES", "EOF"]);
  assert.equal(parsed.header.$ACADVER[1], "AC1009");
  // 4 is millimetres and 1 is metric. Without both, a reader is free to decide a
  // 120 mm plate is 120 inches.
  assert.equal(parsed.header.$INSUNITS[70], "4");
  assert.equal(parsed.header.$MEASUREMENT[70], "1");
  assert.equal(dxfFileNameForBody(createBodyFromTemplate("base_plate")), "base_plate.dxf");
});

test("every layer an entity uses is declared in the LAYER table", () => {
  const parsed = parseDxf(serializeBodyToDxf(createBodyFromTemplate("base_plate")));
  const declared = new Set(parsed.layers.map((layer) => layer[2]));
  const used = new Set(parsed.entities.map((entity) => entity[8]));

  assert.ok(declared.has("0"), "layer 0 is always required");
  for (const layer of used) {
    assert.ok(declared.has(layer), `layer ${layer} is used by an entity but not declared`);
  }
  assert.deepEqual([...used].sort(), [CUT_LAYER, OUTER_LAYER]);
});

test("holes are CIRCLE entities, not tessellated polylines", () => {
  // This is the decision the whole module exists for: the compiled 2D region
  // approximates a small hole with about 32 segments, and a machine given that
  // polyline cuts a 32-sided hole.
  const parsed = parseDxf(serializeBodyToDxf(createBodyFromTemplate("base_plate")));
  const cuts = parsed.entities.filter((entity) => entity[8] === CUT_LAYER);

  assert.equal(cuts.length, 4);
  assert.ok(cuts.every((entity) => entity.type === "CIRCLE"));
  for (const entity of cuts) {
    // Cycle 08 retrofitted the plate's mount holes to M3 clearance, so the radius is
    // asserted through the fastener table rather than against the literal it used to
    // be. A DXF that writes 1.7 because somebody typed 1.7 twice proves nothing.
    assert.equal(Number(entity[40]), clearanceHoleDiameterMm("M3", "normal") / 2);
  }
  assert.equal(
    parsed.entities.filter((entity) => entity.type === "POLYLINE").length,
    0,
    "a rounded rectangle and four circles need no polyline at all"
  );
});

test("the outer profile and every hole are closed, and the extents match the sketch", () => {
  const body = createBodyFromTemplate("base_plate");
  const parsed = parseDxf(serializeBodyToDxf(body));

  const outer = contourClosure(parsed.entities, OUTER_LAYER);
  // A 4 mm rounded rectangle is four lines and four arcs; all eight endpoints pair.
  assert.equal(outer.entityCount, 8);
  assert.equal(outer.openEndpoints, 0);
  const cuts = contourClosure(parsed.entities, CUT_LAYER);
  assert.equal(cuts.closedByConstruction, 4);
  assert.equal(cuts.openEndpoints, 0);

  // Exactly, not to a tolerance: the analytic path has no tessellation error to
  // absorb, so a 120 by 80 plate is 120 by 80.
  assert.equal(Number(parsed.header.$EXTMIN[10]), -60);
  assert.equal(Number(parsed.header.$EXTMIN[20]), -40);
  assert.equal(Number(parsed.header.$EXTMAX[10]), 60);
  assert.equal(Number(parsed.header.$EXTMAX[20]), 40);

  const plan = bodyDxfPlan(body);
  assert.deepEqual(plan.extents, { min: [-60, -40], max: [60, 40] });
  assert.equal(plan.contourCount, 5);
  assert.equal(plan.materialThicknessMm, 6);
});

test("a rounded slot outer profile becomes two lines and two half arcs at nominal size", () => {
  const body = createBodyFromTemplate("link_bar");
  const parsed = parseDxf(serializeBodyToDxf(body));
  const outer = parsed.entities.filter((entity) => entity[8] === OUTER_LAYER);

  assert.equal(outer.filter((entity) => entity.type === "LINE").length, 2);
  const arcs = outer.filter((entity) => entity.type === "ARC");
  assert.equal(arcs.length, 2);
  // JSCAD's roundedSlot needs a 0.001 mm degeneracy clearance on its radius; a
  // true arc does not, so DXF states the nominal 12 mm and its extents are exact.
  for (const arc of arcs) {
    assert.equal(Number(arc[40]), 12);
  }
  assert.equal(contourClosure(parsed.entities, OUTER_LAYER).openEndpoints, 0);
  assert.equal(Number(parsed.header.$EXTMAX[10]) - Number(parsed.header.$EXTMIN[10]), 140);
  assert.equal(Number(parsed.header.$EXTMAX[20]) - Number(parsed.header.$EXTMIN[20]), 24);
});

test("a sharp rectangle becomes one closed four-vertex POLYLINE", () => {
  const body = normalizePartBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 3,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 20, cornerRadius: 0 },
      cutProfiles: []
    }
  });
  const parsed = parseDxf(serializeBodyToDxf(body));

  assert.equal(parsed.entities.length, 1);
  const [polyline] = parsed.entities;
  assert.equal(polyline.type, "POLYLINE");
  assert.equal(polyline[70], "1");
  assert.equal(polyline.vertices.length, 4);
  // The closing segment is implicit, so the first point must not be repeated.
  assert.deepEqual(
    polyline.vertices.map((vertex) => [Number(vertex[10]), Number(vertex[20])]),
    [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10]
    ]
  );
});

test("a polyline outer profile round-trips its points and closes", () => {
  const body = normalizePartBody({
    id: "gusset",
    name: "Gusset",
    extrudeDepthMm: 4,
    sketch: {
      outerProfile: {
        id: "outer",
        type: "polyline",
        points: [
          [0, 0],
          [50, 0],
          [50, 30],
          [20, 30]
        ],
        closed: true
      },
      cutProfiles: []
    }
  });
  const parsed = parseDxf(serializeBodyToDxf(body));
  const [polyline] = parsed.entities;

  assert.equal(polyline.type, "POLYLINE");
  assert.deepEqual(
    polyline.vertices.map((vertex) => [Number(vertex[10]), Number(vertex[20])]),
    [
      [0, 0],
      [50, 0],
      [50, 30],
      [20, 30]
    ]
  );
});

test("a uniform sketch-plane placement scale is applied to coordinates and radii", () => {
  const body = createBodyFromTemplate("base_plate");
  body.transform.scale = [2, 3, 2];
  const parsed = parseDxf(serializeBodyToDxf(body));

  assert.equal(Number(parsed.header.$EXTMAX[10]), 120);
  assert.equal(Number(parsed.header.$EXTMAX[20]), 80);
  for (const entity of parsed.entities.filter((item) => item[8] === CUT_LAYER)) {
    // The placement scale multiplies the standard's own radius; it does not replace it.
    assert.equal(Number(entity[40]), clearanceHoleDiameterMm("M3", "normal"));
  }

  const plan = bodyDxfPlan(body);
  assert.equal(plan.placementScale, 2);
  // The thickness is stated, never applied: DXF is a cut path and the extrusion is
  // the stock the shop has to have.
  assert.equal(plan.materialThicknessMm, 18);
});

test("a non-uniform sketch-plane scale is refused rather than exported at nominal size", () => {
  const body = createBodyFromTemplate("base_plate");
  body.transform.scale = [2, 1, 1.5];

  assert.throws(
    () => serializeBodyToDxf(body),
    (error) => {
      assert.ok(error instanceof PartDxfExportError);
      assert.equal(error.code, "dxf-export-unavailable");
      // The reason has to name both numbers, or the user cannot act on it.
      assert.match(error.message, /2 by 1\.5/);
      assert.match(error.message, /circle/);
      return true;
    }
  );
});

test("DXF runs validateBody itself, because it never compiles a solid", () => {
  // Every other export gets the gate for free from `compilePartBodyToSolid`. DXF
  // does not, and one-contour-per-profile is only sound because validation
  // guarantees each cut lies inside the outer profile.
  const body = createBodyFromTemplate("base_plate");
  body.sketch.cutProfiles.push(createCircularHole({ id: "escaped_hole", x: 400, z: 0, radius: 3 }));

  assert.throws(
    () => serializeBodyToDxf(body),
    (error) => {
      assert.ok(error instanceof PartDxfExportError);
      assert.equal(error.code, "dxf-export-invalid-body");
      assert.match(error.message, /inside the outer profile/u);
      return true;
    }
  );
});

test("a non-sketch body is refused with a reason instead of a silhouette guess", () => {
  const body = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" } });
  assert.throws(() => serializeBodyToDxf(body), /exact 2D sketch region/u);
});

test("an overlapping-cut body still exports, and this file no longer reports the overlap", () => {
  // Cycle 06's settlement of task 5. Intersecting contours are where the
  // consequence was first felt, but the finding is about the design rather than
  // about this file, so `dfm.js` owns it and this exporter has no second copy.
  // The file is still produced either way: the finding was never a gate.
  const body = normalizePartBody({
    id: "twin",
    name: "Twin hole plate",
    extrudeDepthMm: 4,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 30, cornerRadius: 0 },
      cutProfiles: [
        createCircularHole({ id: "hole_a", x: -2, z: 0, radius: 6 }),
        createCircularHole({ id: "hole_b", x: 2, z: 0, radius: 6 })
      ]
    }
  });
  const plan = bodyDxfPlan(body);
  assert.deepEqual(plan.warnings, [], "reported here as well as in the DFM panel would be twice");
  assert.ok(
    validateManufacturability(body).some((issue) => issue.code === DFM_OVERLAPPING_CUTS),
    "and it is still reported, once, by the engine that owns it"
  );

  const parsed = parseDxf(serializeBodyToDxf(body));
  assert.equal(parsed.entities.filter((entity) => entity.type === "CIRCLE").length, 2);

  // The base plate's four mount holes are nowhere near one another.
  assert.equal(bodyDxfPlan(createBodyFromTemplate("base_plate")).warnings.length, 0);
});

/** A 60 by 40 plate with one central circular cut, optionally carrying a hole spec. */
function plateWithCut(hole = null) {
  const cut = { id: "screw", type: "circle", x: 0, z: 0, radius: 4 };
  if (hole) cut.hole = hole;
  return normalizePartBody({
    id: "plate",
    name: "Standards plate",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40, cornerRadius: 0 },
      cutProfiles: [cut]
    }
  });
}

test("a standards hole emits an analytic CIRCLE at the table's diameter", () => {
  for (const fit of CLEARANCE_FITS) {
    const parsed = parseDxf(serializeBodyToDxf(plateWithCut({ size: "M3", fit })));
    const cuts = parsed.entities.filter((entity) => entity[8] === CUT_LAYER);

    assert.equal(cuts.length, 1);
    assert.equal(cuts[0].type, "CIRCLE", "still a CIRCLE, not a polyline");
    // Asserted against the table's accessor, so a wrong number in the table fails
    // here rather than being copied into the assertion alongside it.
    assert.equal(Number(cuts[0][40]) * 2, clearanceHoleDiameterMm("M3", fit));
  }
});

test("a counterbored hole emits only the pilot, and says the pocket is not in the file", () => {
  // The decision, stated: the counterbore is a milling operation with no 2D contour.
  // Emitting it as a second concentric circle would be worse than silence, because a
  // laser cutter would cut it straight through.
  const body = plateWithCut({ size: "M3", style: "counterbore" });
  const plan = bodyDxfPlan(body);
  const parsed = parseDxf(serializeBodyToDxf(body));
  const cuts = parsed.entities.filter((entity) => entity[8] === CUT_LAYER);

  assert.equal(cuts.length, 1, "one contour, not a pilot plus a counterbore");
  assert.equal(Number(cuts[0][40]) * 2, clearanceHoleDiameterMm("M3", "normal"));
  assert.notEqual(Number(cuts[0][40]) * 2, counterboreMm("M3", "fdm").diameterMm);

  assert.deepEqual(plan.pocketedHoleIds, ["screw"]);
  const warning = plan.warnings.find((issue) => issue.code === POCKET_NOT_IN_DXF_CODE);
  assert.equal(warning.severity, "warning");
  assert.equal(warning.pocketCount, 1);
  assert.match(warning.message, /screw/u);
  assert.match(warning.message, /counterbore/u);
  assert.match(warning.message, /milling/u);
});

test("a through or tapped standards hole needs no pocket warning", () => {
  for (const style of ["through", "tapped"]) {
    const plan = bodyDxfPlan(plateWithCut({ size: "M3", style }));
    assert.deepEqual(plan.pocketedHoleIds, []);
    assert.equal(plan.warnings.length, 0, `${style} has no pocket to warn about`);
  }
});

test("a standards hole scales with a uniform placement scale like any other circle", () => {
  const body = plateWithCut({ size: "M3" });
  body.transform.scale = [2, 1, 2];
  const cuts = parseDxf(serializeBodyToDxf(body)).entities.filter((entity) => entity[8] === CUT_LAYER);

  // Placement scale is a property of where the body sits, not of the fastener, so the
  // DXF bakes it exactly as it does for a free circle. The standard is the *source*
  // dimension; a scaled part is a different part.
  assert.equal(Number(cuts[0][40]) * 2, clearanceHoleDiameterMm("M3", "normal") * 2);
});
