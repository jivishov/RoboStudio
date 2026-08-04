import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import jscad from "@jscad/modeling";
import { ThreadUnavailableError, threadSolid, threadSummary } from "../../src/parts/threads.js";
import {
  THREAD_TOLERANCE_POSITIONS,
  UNSOURCED_THREAD_PITCHES,
  UNSOURCED_THREAD_TOLERANCES,
  describeThread,
  listThreadSizes,
  threadGeometry,
  threadPitchMm,
  threadUnavailableReason
} from "../../src/parts/standards/threads.js";
import { FASTENER_SIZES, getFastener } from "../../src/parts/standards/fasteners.js";

const { measureBoundingBox, measureVolume } = jscad.measurements;
const { booleans, primitives } = jscad;

const PARTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "parts");

/* ------------------------------------------------------------------ the table */

test("coarse pitches are read from fasteners.js rather than re-typed", () => {
  // The defect this forbids is two tables holding the same seven numbers, which is one
  // table that will eventually disagree with itself. Asserted by value at every size, so
  // a copy that starts correct and drifts fails here rather than in a gear box.
  for (const size of FASTENER_SIZES) {
    assert.equal(
      threadPitchMm(size, "coarse"),
      getFastener(size).pitchMm,
      `${size} coarse pitch must come from the fastener table`
    );
  }
  assert.deepEqual(listThreadSizes(), FASTENER_SIZES.slice());
});

/**
 * Comments stripped before scanning, and this is not a convenience.
 *
 * `threads.js`'s own doc comment says it contains no coefficient *like `0.6134`* - and a
 * bare `includes` on the file caught that sentence and failed, which is the first draft of
 * this test flagging a module for documenting the rule it obeys. A scanner that cannot
 * tell prose from code is the A3 failure in its cheerful direction: here it reported a
 * defect that was not there, and the same blindness would have let a real coefficient
 * inside a comment-shaped string pass.
 */
function codeWithoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
}

test("no coefficient of the basic profile is typed into a generator or a test", () => {
  // A4 in its sharpest form: 0.6134 is the classic hand-typed thread depth, and the whole
  // point of `standards/threads.js` is that the number is derived from H = P*sqrt(3)/2.
  // The scan covers the two modules that could plausibly hold one.
  for (const file of ["threads.js", join("standards", "threads.js")]) {
    const code = codeWithoutComments(readFileSync(join(PARTS_DIR, file), "utf8"));
    assert.doesNotMatch(code, /0\.6134/u, `${file} must not hard-code a thread depth coefficient`);
    assert.doesNotMatch(code, /0\.5413/u, `${file} must not hard-code a minor-diameter coefficient`);
  }

  // A3 negative control: the stripper must remove prose and keep code, or the check above
  // passes on a file where the coefficient is real.
  assert.doesNotMatch(codeWithoutComments("/** never 0.6134 */\nconst a = 1;"), /0\.6134/u);
  assert.match(codeWithoutComments("/** fine */\nconst depth = 0.6134 * pitch;"), /0\.6134/u);
  // And this test does not write one either, which is the half of the rule a scanner
  // cannot enforce on itself.
  const geometry = threadGeometry({ size: "M8", series: "coarse" });
  assert.equal(
    Number(geometry.fundamentalTriangleHeightMm.toFixed(6)),
    Number(((geometry.pitchMm * Math.sqrt(3)) / 2).toFixed(6))
  );
});

test("basic diameters are ISO 68-1 offsets of H from the major diameter", () => {
  const m8 = threadGeometry({ size: "M8", series: "coarse" });
  const h = m8.fundamentalTriangleHeightMm;
  assert.equal(m8.majorDiameterMm, 8);
  assert.equal(Number(m8.pitchDiameterMm.toFixed(9)), Number((8 - 2 * (3 / 8) * h).toFixed(9)));
  assert.equal(Number(m8.minorDiameterMm.toFixed(9)), Number((8 - 2 * (5 / 8) * h).toFixed(9)));
  assert.ok(m8.minorDiameterMm < m8.pitchDiameterMm && m8.pitchDiameterMm < m8.majorDiameterMm);
});

test("a tolerance position shifts every diameter, and 6g is smaller than 6H", () => {
  const basic = threadGeometry({ size: "M8", series: "coarse" });
  const external = threadGeometry({ size: "M8", series: "coarse", kind: "external", toleranceClass: "g" });
  const internal = threadGeometry({ size: "M8", series: "coarse", kind: "internal", toleranceClass: "H" });

  assert.equal(basic.fundamentalDeviationMm, 0, "h and H are the basic sizes by definition");
  assert.ok(external.fundamentalDeviationMm < 0, "an external position removes material from the bolt");
  assert.equal(internal.fundamentalDeviationMm, 0);
  // The whole reason a 6g bolt enters a 6H nut.
  assert.ok(external.majorDiameterMm < internal.majorDiameterMm);
  assert.ok(external.pitchDiameterMm < internal.pitchDiameterMm);
});

test("an unpublished size, series or position refuses by name and never interpolates", () => {
  assert.match(threadUnavailableReason({ size: "M2.2" }), /M2\.2/u);
  assert.match(threadUnavailableReason({ size: "M2.2" }), /Published sizes are/u);

  // M3 has a fine pitch here; M10 is not a fastener size at all.
  assert.equal(threadUnavailableReason({ size: "M3", series: "fine" }), null);
  assert.match(threadUnavailableReason({ size: "M8", series: "extraFine" }), /Thread series must be/u);
  assert.match(
    threadUnavailableReason({ size: "M8", kind: "external", toleranceClass: "H" }),
    /not published here for an external thread/u
  );
  assert.equal(threadGeometry({ size: "M8", series: "extraFine" }), null);
});

test("deliberately absent rows are recorded with a reason rather than omitted", () => {
  assert.ok(UNSOURCED_THREAD_PITCHES.length > 0);
  for (const entry of UNSOURCED_THREAD_PITCHES) {
    assert.ok(entry.reason.length > 40, `${entry.size} must say why the row is absent`);
  }
  for (const entry of UNSOURCED_THREAD_TOLERANCES) {
    assert.match(entry.reason, /grade|band/u);
  }
  // Positions are published; grades are not, and the designation must not imply one.
  assert.ok(THREAD_TOLERANCE_POSITIONS.includes("g"));
  const designation = describeThread(threadGeometry({ size: "M8", series: "coarse", toleranceClass: "g" }));
  assert.equal(designation, "M8x1.25 external - g");
  assert.doesNotMatch(designation, /6g/u, "a grade digit would state something this table cannot check");
});

/* ------------------------------------------------------------------ the geometry */

test("a thread is exactly as long as it was asked for, at any pitch", () => {
  // `extrudeHelical`'s axial span is turns*pitch + pitch, because the swept profile is
  // itself one pitch tall. The trim is what makes 10 mm mean 10 mm, and it must not
  // depend on the pitch the caller happened to ask for.
  for (const [size, series] of [["M8", "coarse"], ["M8", "fine"], ["M3", "coarse"]]) {
    const solid = threadSolid({ size, series, kind: "external", lengthMm: 10, axis: "z" });
    const [min, max] = measureBoundingBox(solid);
    assert.equal(Number((max[2] - min[2]).toFixed(6)), 10, `${size} ${series} must be 10 mm long`);
  }
});

test("a thread's volume sits between its core and its major cylinder", () => {
  // The only volume assertion that is a fact about a thread rather than about a
  // tessellation: more material than the tapping drill, less than the bar stock. A pinned
  // number here would be a pinned polygon count in disguise.
  const geometry = threadGeometry({ size: "M8", series: "coarse" });
  const lengthMm = 10;
  const solid = threadSolid({ size: "M8", series: "coarse", kind: "external", lengthMm, axis: "z" });
  const volume = measureVolume(solid);

  const core = Math.PI * (geometry.minorDiameterMm / 2) ** 2 * lengthMm;
  const stock = Math.PI * (geometry.majorDiameterMm / 2) ** 2 * lengthMm;
  assert.ok(volume > core, `${volume} should exceed the ${core} core`);
  assert.ok(volume < stock, `${volume} should be under the ${stock} bar stock`);
});

test("a thread unions with a shank and subtracts from a block", () => {
  // The measurement that moved threads out of the backend tier in the first place: a
  // thread is only useful attached to a body, so the booleans are the capability.
  const thread = threadSolid({ size: "M8", series: "coarse", kind: "external", lengthMm: 6, axis: "z" });
  const shank = primitives.cylinder({ radius: 3.3, height: 12 });
  const joined = booleans.union(shank, thread);
  assert.ok(measureVolume(joined) > measureVolume(shank));

  const internal = threadSolid({ size: "M8", series: "coarse", kind: "internal", toleranceClass: "H", lengthMm: 6 });
  const block = primitives.cuboid({ size: [20, 20, 10] });
  const tapped = booleans.subtract(block, internal);
  assert.ok(measureVolume(tapped) < measureVolume(block), "an internal thread must remove material");
});

test("the axis a thread names is the axis it lies on", () => {
  const lengthMm = 12;
  const extents = { x: 0, y: 1, z: 2 };
  for (const [axis, index] of Object.entries(extents)) {
    const [min, max] = measureBoundingBox(
      threadSolid({ size: "M6", series: "coarse", kind: "external", lengthMm, axis })
    );
    assert.equal(Number((max[index] - min[index]).toFixed(6)), lengthMm, `axis ${axis} must carry the length`);
  }
});

test("a refused combination throws rather than returning an approximate thread", () => {
  assert.throws(
    () => threadSolid({ size: "M2.2", series: "coarse", kind: "external", lengthMm: 5 }),
    (error) => {
      assert.ok(error instanceof ThreadUnavailableError);
      assert.equal(error.code, "thread-unavailable");
      assert.match(error.message, /M2\.2/u);
      return true;
    }
  );
  assert.throws(
    () => threadSolid({ size: "M8", series: "coarse", kind: "external", lengthMm: 0 }),
    /positive threaded length/u
  );
  assert.equal(threadSummary({ size: "M2.2" }), null);
});

test("tessellation follows the chord tolerance and no test pins a polygon count", () => {
  // `extrudeHelical` takes a fixed `segmentsPerRotation`, which is exactly the constant
  // AGENTS.md forbids, so it is derived from the tolerance against the major radius. The
  // observable consequence is monotonic: a looser tolerance may never produce *more*
  // polygons, and both must still be the same 10 mm of thread.
  const request = { size: "M8", series: "coarse", kind: "external", lengthMm: 10, axis: "z" };
  const fine = threadSolid({ ...request, toleranceMm: 0.005 });
  const coarse = threadSolid({ ...request, toleranceMm: 0.2 });

  const finePolygons = jscad.geometries.geom3.toPolygons(fine).length;
  const coarsePolygons = jscad.geometries.geom3.toPolygons(coarse).length;
  assert.ok(coarsePolygons <= finePolygons, "a looser tolerance must not need more facets");
  assert.ok(finePolygons > 0 && coarsePolygons > 0);

  for (const solid of [fine, coarse]) {
    const [min, max] = measureBoundingBox(solid);
    assert.equal(Number((max[2] - min[2]).toFixed(6)), 10);
  }
});

test("threads.js holds no segment-count constant of its own", () => {
  const source = readFileSync(join(PARTS_DIR, "threads.js"), "utf8");
  assert.match(source, /circleSegmentsForRadius/u, "the count must come from tessellation.js");
  assert.doesNotMatch(source, /segmentsPerRotation:\s*\d/u, "a literal segment count is the forbidden constant");
  assert.doesNotMatch(source, /CURVE_SEGMENTS/u);
});
