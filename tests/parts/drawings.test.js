import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bodyDrawingSheet } from "../../src/parts/drawings/sheet.js";
import { DIMENSION_DIAMETER, bodyDimensions, formatDimension, profileDimensions } from "../../src/parts/drawings/dimensions.js";
import { bodyHoleTable } from "../../src/parts/drawings/holeTable.js";
import { isometricFaces, meshExtents } from "../../src/parts/drawings/isometric.js";
import { DRAWING_DATUM, bodyOrthographicViews, taggedCuts } from "../../src/parts/drawings/views.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { normalizePartBody } from "../../src/parts/projectState.js";
import { describeHole } from "../../src/parts/holes.js";
import { clearanceHoleDiameterMm } from "../../src/parts/standards/fasteners.js";

const DRAWINGS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "parts", "drawings");

/**
 * Read attributes back out of the emitted SVG.
 *
 * ⚠ Parsed, never snapshotted. A snapshot of an SVG pins the renderer's formatting rather
 * than the drawing's correctness, and churns on every unrelated change - cycle 04's DXF
 * group-code parser is the pattern being copied, and for the same reason.
 */
function elementsWith(svg, attribute) {
  const found = [];
  const pattern = new RegExp(`<(\\w+)([^>]*\\b${attribute}="([^"]*)"[^>]*)>`, "gu");
  for (const match of svg.matchAll(pattern)) {
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w:-]+)="([^"]*)"/gu)) attrs[attr[1]] = attr[2];
    found.push({ tag: match[1], attrs, value: match[3] });
  }
  return found;
}

function plate() {
  return createBodyFromTemplate("base_plate");
}

/* ============================================================ views from the sketch */

test("a top view's extents match the sketch exactly, read out of the emitted SVG", () => {
  const body = plate();
  const outer = body.sketch.outerProfile;
  const svg = bodyDrawingSheet(body);

  const [top] = elementsWith(svg, "data-view").filter((element) => element.value === "top");
  assert.ok(top, "the sheet must carry a top view");
  // ⚠ Exactly, to float precision. A mesh-derived view could not do this: it would be a
  // 32-sided approximation of the rounded corners and would come out a few hundredths
  // narrow. The sketch says 60 x 40 and so does the drawing.
  assert.equal(Number(top.attrs["data-width-mm"]), Number(outer.width));
  assert.equal(Number(top.attrs["data-height-mm"]), Number(outer.height));
});

test("an M3 clearance hole dimensions 3.4, which is the proof views are sketch-derived", () => {
  const body = normalizePartBody({
    id: "m3_plate",
    name: "M3 plate",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [
        { id: "m3", type: "circle", x: 5, z: -5, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal" } }
      ]
    }
  });
  const svg = bodyDrawingSheet(body);
  const circle = elementsWith(svg, "data-diameter-mm").find((element) => element.attrs["data-entity"] === "m3");

  // A4: asserted through the accessor, never against a typed 3.4. A mesh-derived view
  // cannot produce this number at all.
  assert.equal(Number(circle.value), clearanceHoleDiameterMm("M3", "normal"));
  assert.notEqual(Number(circle.value), 3.39);
});

test("a circular cut is dimensioned as a diameter, never as a radius", () => {
  const body = normalizePartBody({
    id: "bore",
    name: "Bore",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [{ id: "hole", type: "circle", x: 0, z: 0, radius: 6 }]
    }
  });
  const [diameter] = profileDimensions(body.sketch.cutProfiles[0]).filter((entry) => entry.kind === DIMENSION_DIAMETER);
  assert.equal(diameter.valueMm, 12);
  assert.equal(diameter.prefix, "Ø");
  assert.equal(formatDimension(diameter), "Ø12");

  // And nothing anywhere labels a circular feature with an R.
  const rows = bodyDimensions(body).dimensions.filter((entry) => entry.profileId === "hole");
  for (const row of rows) assert.notEqual(row.prefix, "R", "a hole labelled R is drilled at twice the size");
});

test("the dimension table is per profile type, and a polyline gets no derived lengths", () => {
  const rectangle = profileDimensions({ id: "r", type: "rectangle", x: 0, z: 0, width: 30, height: 20, cornerRadius: 0 });
  assert.deepEqual(rectangle.map((entry) => entry.label), ["Width", "Height"]);
  assert.equal(rectangle.every((entry) => entry.nominal), true);

  const rounded = profileDimensions({ id: "r2", type: "rectangle", x: 0, z: 0, width: 30, height: 20, cornerRadius: 3 });
  assert.deepEqual(rounded.map((entry) => entry.label), ["Width", "Height", "Corner radius"]);

  const slot = profileDimensions({ id: "s", type: "roundedSlot", x: 0, z: 0, length: 20, width: 6 });
  assert.deepEqual(slot.map((entry) => entry.label), ["Length", "Width", "End radius"]);
  const endRadius = slot.find((entry) => entry.label === "End radius");
  assert.equal(endRadius.valueMm, 3);
  assert.equal(endRadius.derived, true, "half the width by construction, so it is a note rather than a dimension");

  const polyline = profileDimensions({ id: "p", type: "polyline", points: [[0, 0], [10, 0], [10, 8]] });
  assert.deepEqual(polyline.map((entry) => entry.label), ["Vertex 1", "Vertex 2", "Vertex 3"]);
  // ⚠ No lengths. A polyline's edges are implied by its vertices, and dimensioning both
  // over-constrains the drawing - which leaves a shop deciding which half to believe.
  assert.equal(polyline.some((entry) => entry.label.toLowerCase().includes("length")), false);
  for (const entry of polyline) assert.equal(entry.datum, DRAWING_DATUM.id);
});

test("a cut carries its position from the stated datum and an outer profile does not", () => {
  const cut = { id: "c", type: "circle", x: 12, z: -4, radius: 2 };
  const withPosition = profileDimensions(cut, { isCut: true });
  const position = withPosition.find((entry) => entry.label === "Position");
  assert.equal(position.uMm, 12);
  assert.equal(position.vMm, -4);
  assert.equal(position.datum, DRAWING_DATUM.id);

  // The outer profile is the datum's own frame, so positioning it would be circular.
  assert.equal(profileDimensions(cut).some((entry) => entry.label === "Position"), false);
  assert.match(DRAWING_DATUM.note, /sketch origin/u);
});

/* ============================================================ the hole table */

test("a cut with a resolved hole shows its designation in the table and its tag in the view", () => {
  const body = plate();
  const rows = bodyHoleTable(body);
  assert.ok(rows.length > 0);

  const tags = taggedCuts(body);
  assert.equal(tags[0].tag, "A", "tags read A, B, C down the sheet");

  for (const row of rows) {
    const profile = body.sketch.cutProfiles.find((item) => item.id === row.positions[0].profileId);
    // Read from `describeHole`, never rewritten here.
    assert.equal(row.designation, describeHole(profile.hole));
    assert.ok(row.pilotDiameterMm > 0);
    assert.equal(row.datum, DRAWING_DATUM.id);
  }

  const svg = bodyDrawingSheet(body);
  const tableRows = elementsWith(svg, "data-hole-row");
  assert.equal(tableRows.length, rows.length);
  assert.equal(
    tableRows.reduce((sum, element) => sum + Number(element.attrs["data-hole-quantity"]), 0),
    rows.reduce((sum, row) => sum + row.quantity, 0)
  );
});

test("identical holes group into one row with a count, and a refused hole gets none", () => {
  const body = normalizePartBody({
    id: "four_up",
    name: "Four up",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 60 },
      cutProfiles: [
        { id: "a", type: "circle", x: -20, z: -20, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal" } },
        { id: "b", type: "circle", x: 20, z: -20, radius: 1, hole: { standard: "ISO metric", size: "M3", fit: "normal" } },
        { id: "c", type: "circle", x: 0, z: 10, radius: 2, hole: { standard: "ISO metric", size: "M2.2", fit: "normal" } }
      ]
    }
  });

  const rows = bodyHoleTable(body);
  assert.equal(rows.length, 1, "two identical M3 holes are one row");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].positions.length, 2);
  // The refused M2.2 produced no derived geometry, so a row for it would put a fastener on
  // a drawing whose hole is whatever radius the author last typed.
  assert.equal(rows.some((row) => row.size === "M2.2"), false);
});

/* ============================================================ non-sketch bodies */

test("a non-sketch body gets an isometric, extents, and an explicit statement of the gap", () => {
  const gear = normalizePartBody({ id: "gear", name: "Gear", source: { kind: "spurGear" }, gear: { toothCount: 20, moduleMm: 2 } });
  const views = bodyOrthographicViews(gear);
  assert.equal(views.length, 3);
  for (const view of views) {
    assert.equal(view.available, false);
    // ⚠ Stated, with the reason - deliberately the same shape as
    // `dfm-source-kind-unchecked`. An honest gap beats an undimensioned view that reads as
    // a bug.
    assert.match(view.reason, /derived from the 2D sketch/u);
    assert.match(view.reason, /isometric/u, "and it must say what the reader does get instead");
  }

  const mesh = {
    vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 10]),
    triangleCount: 2,
    bounds: { size: [10, 10, 10] }
  };
  const svg = bodyDrawingSheet(gear, { mesh });
  const unavailable = elementsWith(svg, "data-available").filter((element) => element.value === "false");
  assert.equal(unavailable.length, 3);
  assert.match(svg, /derived from the 2D sketch/u);

  const iso = elementsWith(svg, "data-faces");
  assert.equal(Number(iso[0].value), 2, "and the isometric really drew the mesh it was given");
  assert.match(svg, /Extents/u);
});

test("mesh extents are labelled measured, so they cannot read as authored dimensions", () => {
  const extents = meshExtents({ size: [39.98, 6, 20.01] });
  assert.equal(extents.measured, true);
  assert.match(extents.note, /measured from the compiled mesh/u);
  assert.equal(meshExtents(null), null);
  assert.equal(meshExtents({ size: [1, 2] }), null);
});

/* ============================================================ the isometric */

test("the isometric depth-sorts and needs no solid", () => {
  const near = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const far = [50, 50, 50, 51, 50, 50, 50, 51, 50];
  const projected = isometricFaces(new Float32Array([...far, ...near]), 2);

  assert.equal(projected.faces.length, 2);
  // Back to front, so a renderer emits them in order and needs no z-buffer.
  assert.ok(projected.faces[0].depth < projected.faces[1].depth);
  assert.ok(projected.extents.widthMm > 0);
  for (const face of projected.faces) {
    assert.equal(face.points.length, 3);
    assert.ok(face.lightness >= 0 && face.lightness <= 100);
  }
  assert.deepEqual(isometricFaces(new Float32Array([]), 0), { faces: [], extents: null, triangleCount: 0 });
});

/* ============================================================ the sheet */

test("no line role is distinguished by colour alone", () => {
  // A drawing whose hidden lines vanish on a black-and-white printer is not a drawing, so
  // every role differs in dash pattern and weight as well as tint.
  const svg = bodyDrawingSheet(plate());
  const strokes = elementsWith(svg, "stroke-width");
  const widths = new Set(strokes.map((element) => element.attrs["stroke-width"]));
  assert.ok(widths.size >= 2, "weights must differ, not only colours");

  const source = readFileSync(join(DRAWINGS_DIR, "sheet.js"), "utf8");
  assert.match(source, /stroke-dasharray/u);
  // The three roles, each with its own pattern.
  assert.match(source, /hidden:\s*\{[^}]*dash:\s*"[^"]+"/u);
  assert.match(source, /centre:\s*\{[^}]*dash:\s*"[^"]+"/u);
  assert.match(source, /visible:\s*\{[^}]*dash:\s*""/u);
});

test("the sheet is A3 and its title block states that dimensions are nominal", () => {
  const svg = bodyDrawingSheet(plate(), { materialLabel: "PLA", processLabel: "FDM 3D printing" });
  assert.match(svg, /viewBox="0 0 420 297"/u);

  const fields = elementsWith(svg, "data-title-field").map((element) => element.value);
  assert.deepEqual(fields, ["Part", "Material", "Process", "Units", "Dimensions", "Datum"]);
  // ⚠ On the sheet itself, not only in a comment: a shop reading this needs to know it is
  // not looking at what a kerf or a nozzle will make of the drawing.
  assert.match(svg, /Nominal as drawn/u);
  assert.match(svg, /reported separately/u);
});

test("no drawings module imports a Node built-in", () => {
  // ⚠ A bare `includes("node:")`, deliberately. The DFM import ban's narrower half uses a
  // `from "./validation.js"` regex that a relative-path or dynamic import slips straight
  // past; that narrower form is the one not to copy.
  for (const file of readdirSync(DRAWINGS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(join(DRAWINGS_DIR, file), "utf8");
    assert.equal(source.includes("node:"), false, `${file} must not import a Node built-in`);
  }
});

test("views, dimensions and holeTable import no JSCAD", () => {
  // Four of the five stage-B modules being JSCAD-free is a consequence of deriving from
  // the sketch rather than a coincidence, and it is worth preserving: it keeps these tests
  // fast and the dependency surface honest.
  for (const file of ["views.js", "dimensions.js", "holeTable.js", "isometric.js"]) {
    const source = readFileSync(join(DRAWINGS_DIR, file), "utf8");
    assert.equal(source.includes("@jscad/modeling"), false, `${file} must not import JSCAD`);
  }
});

test("no drawings module imports draw-kit.mjs", () => {
  // It opens with `node:fs/promises`, `node:path` and `node:url` at module scope and
  // imports a generator. The maths is copied; the module is not reachable.
  for (const file of readdirSync(DRAWINGS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(join(DRAWINGS_DIR, file), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
    assert.equal(code.includes("draw-kit"), false, `${file} must not reach draw-kit.mjs`);
  }
});

test("the sheet hard-codes no palette of its own", () => {
  // `baseSvg` in the kit hard-codes `#f8fafc`, `#0f172a` and a dozen more, which is the
  // per-page palette duplication cycle 01 deleted. Every colour here is a token with a
  // fallback, so losing the palette loses the tint and nothing else.
  const source = readFileSync(join(DRAWINGS_DIR, "sheet.js"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
  for (const hex of code.match(/#[0-9a-f]{3,8}\b/giu) ?? []) {
    assert.match(
      code,
      new RegExp(`var\\(--rs-[\\w-]+,\\s*${hex}\\)`, "iu"),
      `${hex} must be a fallback inside a token reference, not a colour of its own`
    );
  }
  assert.match(code, /var\(--rs-text/u);
});

test("the three orthographic views share one scale and line up", () => {
  // ⚠ A regression test for a defect only a rendered sheet showed. The first draft fitted
  // each view to its own box, so a 120 mm-wide top view came out at 1.25x beside an 80 mm
  // right view at 0.75x. Three views of one part at three scales is not an orthographic
  // drawing - it is three pictures - and no assertion in this file could see it, because
  // every individual view was internally correct.
  const svg = bodyDrawingSheet(plate());
  const groups = elementsWith(svg, "data-scale");
  assert.equal(groups.length, 3);

  const scales = new Set(groups.map((element) => element.attrs["data-scale"]));
  assert.equal(scales.size, 1, "one scale for the set, so a dimension carries between views");

  // Third-angle alignment: the front view sits directly under the top view, and the right
  // view beside the front, which is what makes carrying a dimension with a straightedge
  // mean anything.
  const at = (id) => {
    const group = groups.find((element) => element.attrs["data-view"] === id);
    const [, x, y] = group.attrs.transform.match(/translate\(([-\d.]+) ([-\d.]+)\)/u);
    return { x: Number(x), y: Number(y) };
  };
  const top = at("top");
  const front = at("front");
  const right = at("right");
  assert.equal(top.x, front.x, "front is directly under top, sharing its horizontal extent");
  assert.equal(top.y, right.y, "right is directly beside top, sharing its vertical extent");
  assert.ok(front.y > top.y);
  assert.ok(right.x > top.x);

  // ⚠ And the block really fits the area it was given. The first arrangement computed its
  // width from the front view's *height* - the thickness - and so underestimated it by the
  // whole depth of the part; the right view ran 80 mm past its area and only missed the
  // isometric because the two happened to occupy different bands of the sheet.
  const widths = new Map(groups.map((element) => [element.attrs["data-view"], Number(element.attrs["data-width-mm"])]));
  const heights = new Map(groups.map((element) => [element.attrs["data-view"], Number(element.attrs["data-height-mm"])]));
  const scale = Number(groups[0].attrs["data-scale"]);
  const blockRight = right.x + widths.get("right") * scale;
  const blockBottom = front.y + heights.get("front") * scale;
  // The isometric's box starts at x = 198 mm on an A3 sheet; nothing may reach it.
  assert.ok(blockRight <= 198, `the view block ends at ${blockRight} mm and must clear the isometric`);
  assert.ok(blockBottom <= 297, "and must stay on the sheet");

  // The right view is a quarter turn of the front, not a second copy of it lying flat.
  assert.equal(Number(widths.get("right").toFixed(6)), Number(heights.get("front").toFixed(6)));
  assert.equal(Number(heights.get("right").toFixed(6)), Number(heights.get("top").toFixed(6)));
});

/* ============================================================ the sheet cannot lie by omission */

test("a dimension list too long for the sheet says how many it left off", () => {
  // ⚠ G1. This block took the first 18 lines and dropped the rest in silence: a plate
  // with fourteen holes has 31 dimensions, so thirteen vanished and nothing on the sheet
  // said so. `src/parts.js` caps the assistant's payload the same way and carries the
  // true total beside it, for the reason written there - a truncated list that reads as
  // complete is the same class of dishonesty as a fabricated zero. A drawing has no
  // second field to put a total in, so the count goes on the sheet.
  const cutProfiles = Array.from({ length: 14 }, (_item, index) => ({
    id: `h${index}`,
    type: "circle",
    x: -50 + index * 8,
    z: 0,
    radius: 1,
    hole: { standard: "ISO metric", size: "M3", fit: "normal" }
  }));
  const body = normalizePartBody({
    id: "many",
    name: "Many holes",
    extrudeDepthMm: 6,
    sketch: { outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 140, height: 40 }, cutProfiles }
  });

  const total = bodyDimensions(body).dimensions.length;
  assert.ok(total > 18, `this fixture needs to overflow the block, and holds ${total}`);

  const svg = bodyDrawingSheet(body);
  const [block] = elementsWith(svg, "data-dimension-omitted");
  assert.equal(Number(block.attrs["data-dimension-total"]), total, "the sheet states the true total");
  const omitted = Number(block.value);
  assert.ok(omitted > 0);

  // The last printed row is the count, not one more dimension, and it says the number.
  const rows = elementsWith(svg, "data-dimension-row");
  const lastLine = svg.match(/data-dimension-row="(\d+)">([^<]*)</gu).pop();
  assert.ok(
    lastLine.includes(`+${omitted} more dimension`),
    `the last row must count what was dropped, and reads ${JSON.stringify(lastLine)}`
  );
  assert.equal(rows.length + omitted - 1, total, "every dimension is either printed or counted");
});

test("a dimension list that fits prints every row and claims nothing was omitted", () => {
  // The other direction. Without it the count could be hard-wired and the test above
  // would still pass, which is the shape audit A3 exists to catch.
  const body = plate();
  const total = bodyDimensions(body).dimensions.length;
  assert.ok(total <= 18, `this fixture must fit, and holds ${total}`);

  const svg = bodyDrawingSheet(body);
  const [block] = elementsWith(svg, "data-dimension-omitted");
  assert.equal(Number(block.value), 0);
  assert.equal(Number(block.attrs["data-dimension-total"]), total);
  assert.equal(elementsWith(svg, "data-dimension-row").length, total, "all of them, with no count line stealing a slot");
  assert.doesNotMatch(svg, /more dimensions? not shown/u);
});

test("every tag the dimensions block prints can be found in the hole table", () => {
  // ⚠ F1, and the assertion whose absence let it ship. Every existing check was satisfied:
  // `taggedCuts` produced A, B, C, D, and the hole table's row count and quantity sum were
  // both correct. Nothing compared the tags rendered in ONE block against the tags
  // rendered in the OTHER, so the table printed only the first tag of each group and B, C
  // and D appeared on the sheet with nothing to look them up in.
  const svg = bodyDrawingSheet(plate());

  const dimensionTags = new Set(
    [...svg.matchAll(/data-dimension-row="\d+">([A-Z]) /gu)].map((match) => match[1])
  );
  const tableTags = new Set(
    elementsWith(svg, "data-hole-tags").flatMap((element) => element.value.split(",").map((tag) => tag.trim()))
  );

  assert.ok(dimensionTags.size > 1, "this fixture needs several tagged cuts to be worth asserting");
  const dangling = [...dimensionTags].filter((tag) => !tableTags.has(tag));
  assert.deepEqual(dangling, [], `these tags are printed but resolve to no hole-table row: ${dangling.join(", ")}`);
});

test("a grouped hole-table row names every hole it stands for", () => {
  // The other direction, and the one that keeps the fix honest: the row must account for
  // its own quantity. A row saying "x4" while naming one tag is the defect restated.
  const body = plate();
  const rows = bodyHoleTable(body);
  const svg = bodyDrawingSheet(body);

  for (const [index, element] of elementsWith(svg, "data-hole-tags").entries()) {
    const tags = element.value.split(",").map((tag) => tag.trim()).filter(Boolean);
    assert.equal(tags.length, rows[index].quantity, "one tag per hole the row groups");
    assert.equal(new Set(tags).size, tags.length, "and no tag repeated");
  }
});

test("a pocketed hole's note reaches the sheet, not just the row object", () => {
  // ⚠ G3. `describePocketNote` was unit-tested as a function and never asserted to appear
  // on the drawing, so making it return null for every row left the whole suite green.
  // It is the only thing telling a shop that a counterbore is milled and has no second
  // circle to cut, which is the contract cycle 05 established.
  const body = normalizePartBody({
    id: "cbore",
    name: "Counterbored",
    extrudeDepthMm: 12,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [
        { id: "cb", type: "circle", x: 0, z: 0, radius: 1, hole: { standard: "ISO metric", size: "M6", fit: "normal", style: "counterbore", fromFace: "top" } }
      ]
    }
  });

  const [row] = bodyHoleTable(body);
  assert.ok(row.pocket, "this fixture must really carry a pocket");
  const svg = bodyDrawingSheet(body);
  assert.match(svg, /counterbore/u, "the style must be named on the sheet");
  assert.match(svg, /no 2D contour/u, "and so must the reason it is not drawn as a second circle");

  // The other direction: a plain through hole carries no pocket note at all.
  assert.doesNotMatch(bodyDrawingSheet(plate()), /no 2D contour/u);
});

test("a cut with a resolved hole is annotated in the view, and the tag ties it to the table", () => {
  // ⚠ F1's second clause, and the one this review argued about. The check asks for the
  // designation "in the view"; conventional drafting balloons the TAG in the view and puts
  // the full designation in the table, so the view carries `A M3` - a tag to cross-refer
  // with and a size designation to read - and the table carries `A, B, C, D  x4  M3
  // through hole, normal fit`. Both halves of the check are met without printing a
  // sentence beside every hole.
  const body = plate();
  const svg = bodyDrawingSheet(body);

  const balloons = elementsWith(svg, "data-hole-balloon");
  const tags = taggedCuts(body);
  assert.equal(balloons.length, tags.length, "every resolved cut is annotated");

  for (const entry of tags) {
    const balloon = balloons.find((element) => element.attrs["data-entity"] === entry.profileId);
    assert.ok(balloon, `${entry.profileId} has no balloon in the view`);
    assert.equal(balloon.value, entry.tag);
  }

  // The balloons sit outside the scaled view group, or a small part would render
  // unreadable type. Their coordinates are sheet millimetres, not sketch millimetres.
  const [topGroup] = elementsWith(svg, "data-view").filter((element) => element.value === "top");
  assert.ok(topGroup.attrs.transform.includes("scale("), "the view group is scaled");
  assert.doesNotMatch(
    svg.slice(svg.indexOf("<g data-view=\"top\""), svg.indexOf("</g>", svg.indexOf("<g data-view=\"top\""))),
    /data-hole-balloon/u,
    "a balloon inside the scaled group would scale with the geometry"
  );

  // A cut with no resolved hole gets no balloon: there is nothing to designate.
  const plain = normalizePartBody({
    id: "plain", name: "Plain", extrudeDepthMm: 6,
    sketch: { outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 40, height: 40 },
      cutProfiles: [{ id: "decor", type: "circle", x: 0, z: 0, radius: 3 }] }
  });
  assert.equal(elementsWith(bodyDrawingSheet(plain), "data-hole-balloon").length, 0);
});
