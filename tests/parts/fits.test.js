import assert from "node:assert/strict";
import test from "node:test";

import {
  FIT_CLASSES,
  FIT_INVALID_NOMINAL,
  FIT_KINDS,
  FIT_SIZE_BANDS,
  FIT_SIZE_OUT_OF_RANGE,
  FIT_UNKNOWN_CLASS,
  FIT_UNSOURCED_CLASS,
  UNSOURCED_FIT_CLASS_IDS,
  fitBoreMm,
  fitSizeBandFor,
  getFitClass,
  itToleranceUm,
  listFitClasses,
  listFitGrades,
  resolveFit,
  unsourcedFitClassReason
} from "../../src/parts/standards/fits.js";

/* ------------------------------------------------------- the table's own rules */

test("every published class names two grades this table holds and one kind", () => {
  assert.ok(FIT_CLASSES.length >= 2, "a bearing seat needs a clearance class and a press class");
  const grades = new Set(listFitGrades().map((entry) => entry.grade));

  for (const entry of listFitClasses()) {
    assert.ok(grades.has(entry.holeGrade), `${entry.id} names hole grade ${entry.holeGrade}`);
    assert.ok(grades.has(entry.shaftGrade), `${entry.id} names shaft grade ${entry.shaftGrade}`);
    assert.ok(FIT_KINDS.includes(entry.kind), `${entry.id} kind ${entry.kind}`);
    assert.ok(entry.source.length > 20, `${entry.id} needs a re-checkable source`);
    assert.ok(entry.summary.length > 20, `${entry.id} needs a summary a reader can act on`);
  }

  // The acceptance criterion: H7/h6 and a press class at minimum, because a bearing
  // seat wants a clearance class in a printed block and an interference class in a
  // machined one.
  assert.ok(FIT_CLASSES.includes("H7/h6"));
  assert.ok(
    listFitClasses().some((entry) => entry.kind === "interference"),
    "a press class must ship, not only a clearance one"
  );
});

test("every deviation row spans exactly its IT grade, at every band", () => {
  // The closest thing to an independent read of the table. Each grade's two deviations
  // are quoted from ISO 286-2 rather than derived, so their difference is a fact that
  // has to come out right by itself: h6's span must be IT6 and H7's must be IT7. A
  // mistyped digit in any of the 28 rows fails here rather than in a bearing seat.
  for (const grade of listFitGrades()) {
    assert.equal(grade.deviations.length, FIT_SIZE_BANDS.length, `${grade.grade} row count`);
    for (const [index, band] of FIT_SIZE_BANDS.entries()) {
      const [upperUm, lowerUm] = grade.deviations[index];
      const mid = (band.overMm + band.uptoMm) / 2;
      assert.equal(
        upperUm - lowerUm,
        itToleranceUm(grade.itGrade, mid),
        `${grade.grade} over ${band.overMm} up to ${band.uptoMm} spans ${upperUm - lowerUm} um, not ${grade.itGrade}`
      );
    }
  }
});

test("the size bands are contiguous, ascending, and start where the read stopped", () => {
  for (const [index, band] of FIT_SIZE_BANDS.entries()) {
    assert.ok(band.uptoMm > band.overMm, `band ${index} is inverted`);
    if (index === 0) continue;
    assert.equal(band.overMm, FIT_SIZE_BANDS[index - 1].uptoMm, `band ${index} leaves a gap`);
  }
  // Bands are (over, upto], so a nominal exactly on a boundary belongs to the lower
  // band. Getting this backwards silently shifts every boundary size by one row.
  assert.equal(fitSizeBandFor(18).uptoMm, 18);
  assert.equal(fitSizeBandFor(18.0001).uptoMm, 30);
  assert.equal(fitSizeBandFor(3), null, "3 mm is the open end of the first band");
});

/* ---------------------------------------------------------------- the refusals */

test("a fit class the table does not hold refuses by name and lists what does exist", () => {
  const refused = resolveFit("H9/d9", 22);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, FIT_UNKNOWN_CLASS);
  assert.match(refused.reason, /H9\/d9/u);
  for (const id of FIT_CLASSES) assert.match(refused.reason, new RegExp(id.replace("/", "\\/"), "u"));
  assert.deepEqual(refused.provenance, [], "a refusal cites nothing");
  assert.equal(refused.hole, undefined, "a refusal carries no limits at all");
});

test("a class deliberately absent refuses differently, with the recorded reason", () => {
  // Same mechanism as `UNSOURCED_COMPONENTS`, and for the same reason: one is a typo
  // and the other is a decision somebody made and wrote down.
  assert.notEqual(FIT_UNKNOWN_CLASS, FIT_UNSOURCED_CLASS);
  assert.ok(UNSOURCED_FIT_CLASS_IDS.length > 0);

  for (const id of UNSOURCED_FIT_CLASS_IDS) {
    assert.equal(getFitClass(id), null, `${id} must not be an entry that happens to refuse`);
    assert.equal(FIT_CLASSES.includes(id), false);

    const refused = resolveFit(id, 22);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, FIT_UNSOURCED_CLASS);
    assert.match(refused.reason, new RegExp(id.replace("/", "\\/"), "u"), "the reason must name the class");
    assert.ok(refused.reason.length > 80, `${id} needs a reason a reader can act on`);
    assert.equal(unsourcedFitClassReason(id).length > 80, true);
  }
});

test("a nominal outside every published band refuses rather than scaling the nearest one", () => {
  // The interpolation refusal, stated at the boundary where it matters. An M2 boss at
  // 2 mm and a 150 mm bore are both outside the rows that were read, and a deviation
  // scaled from the 3-6 row is a fit nobody published.
  for (const nominalMm of [0.5, 2, 3, 120.5, 400]) {
    const refused = resolveFit("H7/h6", nominalMm);
    assert.equal(refused.ok, false, `${nominalMm} mm should refuse`);
    assert.equal(refused.code, FIT_SIZE_OUT_OF_RANGE);
    assert.match(refused.reason, /not scaled from the nearest band/u);
  }
  for (const nominalMm of [0, -22, Number.NaN, "big", null]) {
    assert.equal(resolveFit("H7/h6", nominalMm).code, FIT_INVALID_NOMINAL, String(nominalMm));
  }
  assert.equal(fitBoreMm("H7/h6", 200), null, "the accessor answers null where the resolution refuses");
});

test("no value is interpolated between two published rows", () => {
  // The property, not the implementation. Two nominals inside one band must produce
  // deviations that differ by exactly the difference in nominal - because the deviation
  // is a constant per band - and two nominals either side of a boundary must jump. A
  // table that smoothed across bands would fail the second half.
  const low = resolveFit("H7/h6", 19);
  const high = resolveFit("H7/h6", 29);
  assert.equal(low.hole.upperDeviationUm, high.hole.upperDeviationUm, "one band, one deviation");
  assert.equal(low.hole.maxMm - low.nominalMm, high.hole.maxMm - high.nominalMm);

  const acrossBoundary = resolveFit("H7/h6", 31);
  assert.notEqual(
    acrossBoundary.hole.upperDeviationUm,
    high.hole.upperDeviationUm,
    "a band boundary is a step, and smoothing it would be interpolation"
  );
});

/* ----------------------------------------------------------------- the numbers */

test("H7 over a 22 mm nominal is the published band, and the drawn bore sits in its middle", () => {
  const resolved = resolveFit("H7/h6", 22);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.band.overMm, 18);
  assert.equal(resolved.band.uptoMm, 30);

  // Asserted against the deviations the table quotes rather than against 22.021, so a
  // change to the row fails here instead of quietly agreeing with a stale literal.
  assert.equal(resolved.hole.lowerDeviationUm, 0, "H7's EI is zero by definition");
  assert.equal(resolved.hole.upperDeviationUm, itToleranceUm("IT7", 22));
  assert.equal(resolved.hole.minMm, 22);
  assert.equal(resolved.hole.maxMm, 22 + itToleranceUm("IT7", 22) / 1000);

  assert.equal(resolved.shaft.upperDeviationUm, 0, "h6's es is zero by definition");
  assert.equal(resolved.shaft.lowerDeviationUm, -itToleranceUm("IT6", 22));

  const bore = fitBoreMm("H7/h6", 22);
  assert.equal(bore.drawnDiameterMm, (resolved.hole.minMm + resolved.hole.maxMm) / 2);
  assert.equal(bore.minMm, resolved.hole.minMm);
  assert.equal(bore.maxMm, resolved.hole.maxMm);
  // The drawn diameter is labelled as the modelling choice it is and never called the
  // H7 diameter, so the min and max it came from are always beside it.
  assert.ok(bore.minMm < bore.drawnDiameterMm && bore.drawnDiameterMm < bore.maxMm);
});

test("every class's declared kind is the kind its own numbers produce, at every band", () => {
  // The strongest assertion in this file, and the one that earned its keep: it caught
  // `N7/h6` shipping as `kind: "interference"` when N7's upper deviation is smaller in
  // magnitude than IT6 at every band, so the class can finish with a few microns of
  // clearance. A declared kind that the rows contradict is a fit class lying about what
  // it does, which is worse than an absent class - somebody would have pressed a bearing
  // into it and wondered why the ring crept.
  //
  // Declared and derived are computed independently and compared, rather than the class
  // reporting one number twice. Both ends of each band are checked as well as the
  // middle, because a class can change character across a band and `fitCharacter` reads
  // one nominal at a time.
  for (const entry of listFitClasses()) {
    for (const band of FIT_SIZE_BANDS) {
      for (const nominalMm of [band.overMm + 0.001, (band.overMm + band.uptoMm) / 2, band.uptoMm]) {
        const resolved = resolveFit(entry.id, nominalMm);
        assert.equal(resolved.ok, true, `${entry.id} at ${nominalMm}`);
        assert.ok(
          resolved.clearanceMm.maxMm >= resolved.clearanceMm.minMm,
          `${entry.id} at ${nominalMm} has an inverted clearance range`
        );
        assert.equal(
          resolved.character,
          entry.kind,
          `${entry.id} at ${nominalMm} is declared ${entry.kind} but its range `
            + `${resolved.clearanceMm.minMm} to ${resolved.clearanceMm.maxMm} is a ${resolved.character} fit`
        );
      }
    }
  }

  // And all three families are represented, so the assertion above is not vacuous
  // through every class happening to be the same kind.
  assert.deepEqual(
    [...new Set(listFitClasses().map((entry) => entry.kind))].sort(),
    ["clearance", "interference", "transition"]
  );
});

test("H7/p6 reaches exactly zero clearance in four bands, and is still an interference fit", () => {
  // Pinned rather than left inside `fitCharacter`'s `<= 0`, because the boundary is the
  // interesting part. Where H7's ES equals p6's ei the loosest hole and the tightest
  // shaft are the same size, so a light press at 4 mm can come out line-to-line. That is
  // a property of ISO 286's own rows and not a rounding artefact, and a future author who
  // reads the `<= 0` as sloppiness has this test to explain it.
  // Selected on the micrometre deviations, which are integers, rather than on the
  // millimetre clearance, which is a float sum: `0.008 + 0.015 === 0.023` is not
  // something to build a filter on, and the equality of the two deviations is the actual
  // property anyway.
  const zeroBands = FIT_SIZE_BANDS
    .map((band) => (band.overMm + band.uptoMm) / 2)
    .filter((nominalMm) => {
      const resolved = resolveFit("H7/p6", nominalMm);
      return resolved.hole.upperDeviationUm === resolved.shaft.lowerDeviationUm;
    });
  assert.equal(zeroBands.length, 3, "the three smallest bands, where IT7 and p6's ei coincide");

  for (const nominalMm of zeroBands) {
    const resolved = resolveFit("H7/p6", nominalMm);
    assert.equal(resolved.character, "interference", "at worst line-to-line is not clearance");
    assert.ok(resolved.clearanceMm.minMm < 0, "and it still interferes at the other end");
    assert.ok(Math.abs(resolved.clearanceMm.maxMm) < 1e-9, "the zero itself, to float tolerance");
  }

  // Above them the class has real interference at both limits.
  assert.ok(resolveFit("H7/p6", 22).clearanceMm.maxMm < 0);
});

test("N7/h6 is a transition fit at every band, which is why it is not called a press", () => {
  // The finding above, pinned as a fact so it cannot be quietly relabelled. At 22 mm the
  // range runs from 0.028 mm of interference to 0.006 mm of clearance.
  for (const band of FIT_SIZE_BANDS) {
    const nominalMm = (band.overMm + band.uptoMm) / 2;
    const resolved = resolveFit("N7/h6", nominalMm);
    assert.equal(resolved.character, "transition", `N7/h6 at ${nominalMm}`);
    assert.ok(resolved.clearanceMm.maxMm > 0 && resolved.clearanceMm.minMm < 0);
  }
  assert.equal(getFitClass("N7/h6").kind, "transition");
  assert.doesNotMatch(getFitClass("N7/h6").label, /press/iu, "the label must not promise what the rows deny");
});

test("a bearing housing press is tighter than nominal and a locational clearance is not", () => {
  // The two seats a 608 could want, side by side, so the difference is visible as a
  // fact rather than as two separate assertions. N7 puts the bore below nominal so the
  // outer ring cannot creep; H7 puts it at or just above so it goes in by hand.
  const slip = fitBoreMm("H7/h6", 22);
  const press = fitBoreMm("N7/h6", 22);

  assert.ok(slip.minMm >= 22, "an H7 housing bore is never under nominal");
  assert.ok(press.maxMm < 22, "an N7 housing bore is always under nominal");
  assert.ok(press.drawnDiameterMm < slip.drawnDiameterMm);
  assert.equal(press.holeGrade, "N7");
  assert.equal(slip.holeGrade, "H7");
});

test("every resolution carries provenance for both grades and cites ISO 286-2", () => {
  for (const entry of listFitClasses()) {
    const resolved = resolveFit(entry.id, 22);
    assert.equal(resolved.provenance.length, 2, `${entry.id} must cite the hole and the shaft separately`);
    for (const item of resolved.provenance) {
      assert.ok(item.dimension, `${entry.id} has a provenance entry with no dimension`);
      assert.match(item.source, /ISO 286-2/u, `${entry.id}/${item.dimension}`);
      assert.match(item.source, /nominal band over 18 up to 30 mm/u, "the band is part of the citation");
      assert.equal(item.confidence, "verified", "every row here is read off the standard");
    }
    assert.notEqual(resolved.provenance[0].source, resolved.provenance[1].source);
  }
});

test("the class listing is metadata only and carries no geometry", () => {
  for (const entry of listFitClasses()) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["confidence", "holeGrade", "id", "kind", "label", "shaftGrade", "source", "summary"]
    );
  }
});
