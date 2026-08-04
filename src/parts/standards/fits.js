/**
 * ISO 286 limits and fits. All dimensions in millimetres unless a name says otherwise.
 *
 * ## Why this file exists
 *
 * Cycle 08 shipped `LOCATING_CLEARANCE_MM = 0.2` in `components.js` and said in its
 * own note that it was shop practice rather than a published fit, and that this cycle
 * owned replacing it. A 22.0 mm bearing race got a 22.2 mm bore - 0.1 mm of radial
 * room, chosen because it feels about right by hand. The published answer for a
 * stationary outer ring in a housing is H7, which for a 22 mm nominal is 22.000 to
 * 22.021: an order of magnitude tighter than the number that was shipped, and quoted
 * rather than felt.
 *
 * ## The same rules as `fasteners.js`
 *
 * Every value below is a fundamental deviation read from ISO 286-2 in micrometres for
 * one grade at one nominal size band. **Nothing is interpolated** - not between two
 * grades and not between two size bands. A nominal diameter outside the published
 * bands refuses by name, and a fit class this table does not hold refuses by name with
 * the reason it is absent, exactly as `UNSOURCED_COMPONENTS` does for components.
 *
 * The deviations are stored rather than derived from IT grades on purpose. Deriving
 * `h6` as `-IT6` is correct and deriving `p6` is not - `p`'s lower deviation is a
 * separate published series - so a file that derived one and tabulated the other would
 * invite the next author to derive the wrong one. Every row is a quotation. A test
 * cross-checks each pair's span against the IT grade it should equal, which is the
 * closest thing to an independent read of the table.
 *
 * ## Three classes ship, and a bore is one number
 *
 * A solid model needs a single diameter where the standard gives a band. This file
 * therefore publishes `minMm` and `maxMm` **and** a `drawnDiameterMm` at the middle of
 * the class's own two limits, labelled as the modelling choice it is. That is not
 * interpolation between published rows: it is the midpoint of one row, stated as such,
 * beside the two numbers it came from.
 *
 * ## What this file does not do
 *
 * It authors no printer compensation. An H7 bore is what the drawing says; what the
 * machine will produce is `processCompensationMm` in `process.js`, applied once in
 * `cadCompile.js`. Confusing the two is the defect this cycle exists to prevent, so
 * they do not live in the same module.
 *
 * The module is DOM-free and JSCAD-free and imports nothing, exactly like
 * `fasteners.js`.
 */

/** Refusal codes. Diagnostics on a resolution result, never `validateBody` issues. */
export const FIT_UNKNOWN_CLASS = "fit-unknown-class";
export const FIT_UNSOURCED_CLASS = "fit-unsourced-class";
export const FIT_SIZE_OUT_OF_RANGE = "fit-size-out-of-range";
export const FIT_INVALID_NOMINAL = "fit-invalid-nominal";

/**
 * ISO 286-1 nominal size bands, as `(overMm, uptoMm]`.
 *
 * The first band starts at 3 rather than 0 because the sub-3 mm bands are a different
 * set of rows that have not been read off the standard. That is a refusal, not a gap
 * to fill by extending the 3-6 row downwards.
 */
export const FIT_SIZE_BANDS = Object.freeze([
  Object.freeze({ overMm: 3, uptoMm: 6 }),
  Object.freeze({ overMm: 6, uptoMm: 10 }),
  Object.freeze({ overMm: 10, uptoMm: 18 }),
  Object.freeze({ overMm: 18, uptoMm: 30 }),
  Object.freeze({ overMm: 30, uptoMm: 50 }),
  Object.freeze({ overMm: 50, uptoMm: 80 }),
  Object.freeze({ overMm: 80, uptoMm: 120 })
]);

/**
 * IT grade tolerances in micrometres, one per band, in `FIT_SIZE_BANDS` order.
 *
 * Held only so a test can cross-check the deviation rows below: the span between a
 * grade's two deviations must equal its IT tolerance. Nothing derives a deviation from
 * these.
 */
const IT_GRADES_UM = Object.freeze({
  IT6: Object.freeze([8, 9, 11, 13, 16, 19, 22]),
  IT7: Object.freeze([12, 15, 18, 21, 25, 30, 35])
});

/**
 * Fundamental deviations in micrometres, one `[upper, lower]` pair per band.
 *
 * A hole's pair is `[ES, EI]` and a shaft's is `[es, ei]`; both are upper first, which
 * is how ISO 286-2 prints them.
 */
const HOLE_GRADES_UM = Object.freeze({
  H7: Object.freeze({
    grade: "H7",
    itGrade: "IT7",
    source: "ISO 286-2, hole H7: ES = +IT7, EI = 0",
    deviations: Object.freeze([
      Object.freeze([12, 0]),
      Object.freeze([15, 0]),
      Object.freeze([18, 0]),
      Object.freeze([21, 0]),
      Object.freeze([25, 0]),
      Object.freeze([30, 0]),
      Object.freeze([35, 0])
    ])
  }),
  N7: Object.freeze({
    grade: "N7",
    itGrade: "IT7",
    source: "ISO 286-2, hole N7 deviation series",
    deviations: Object.freeze([
      Object.freeze([-4, -16]),
      Object.freeze([-4, -19]),
      Object.freeze([-5, -23]),
      Object.freeze([-7, -28]),
      Object.freeze([-8, -33]),
      Object.freeze([-9, -39]),
      Object.freeze([-10, -45])
    ])
  })
});

const SHAFT_GRADES_UM = Object.freeze({
  h6: Object.freeze({
    grade: "h6",
    itGrade: "IT6",
    source: "ISO 286-2, shaft h6: es = 0, ei = -IT6",
    deviations: Object.freeze([
      Object.freeze([0, -8]),
      Object.freeze([0, -9]),
      Object.freeze([0, -11]),
      Object.freeze([0, -13]),
      Object.freeze([0, -16]),
      Object.freeze([0, -19]),
      Object.freeze([0, -22])
    ])
  }),
  p6: Object.freeze({
    grade: "p6",
    itGrade: "IT6",
    source: "ISO 286-2, shaft p6 deviation series",
    deviations: Object.freeze([
      Object.freeze([20, 12]),
      Object.freeze([24, 15]),
      Object.freeze([29, 18]),
      Object.freeze([35, 22]),
      Object.freeze([42, 26]),
      Object.freeze([51, 32]),
      Object.freeze([59, 37])
    ])
  })
});

/**
 * The fit classes this build holds.
 *
 * Three, and each earns its place: a bearing seat needs a clearance class and a press
 * class, and a housing for a rolling-bearing outer ring is a specific published
 * recommendation rather than either of the generic two.
 */
const FITS = Object.freeze({
  "H7/h6": Object.freeze({
    id: "H7/h6",
    holeGrade: "H7",
    shaftGrade: "h6",
    kind: "clearance",
    label: "H7/h6 locational clearance",
    summary: "The standard sliding fit. Assembles by hand, locates without rattling, and comes apart again.",
    confidence: "verified",
    source: "ISO 286-2 H7 and h6 deviations; H7/h6 is ISO 286-1's locational clearance pairing."
  }),
  "H7/p6": Object.freeze({
    id: "H7/p6",
    holeGrade: "H7",
    shaftGrade: "p6",
    kind: "interference",
    label: "H7/p6 locational interference",
    summary: "A light press. Needs an arbor press or a temperature difference, and it does not slip in service.",
    confidence: "verified",
    source: "ISO 286-2 H7 and p6 deviations; H7/p6 is ISO 286-1's locational interference pairing."
  }),
  "N7/h6": Object.freeze({
    id: "N7/h6",
    holeGrade: "N7",
    shaftGrade: "h6",
    // `transition` and not `interference`, which this table's own numbers settled
    // rather than a preference. N7's upper deviation is smaller in magnitude than IT6
    // at every band, so the loosest N7 hole is a few microns larger than the tightest
    // h6 shaft: at 22 mm the range runs from 0.028 mm of interference to 0.006 mm of
    // clearance. Calling it a press fit would have been a claim the rows contradict,
    // and a user asking for a press fit at 4 mm deserves to be told it can come out
    // line-to-line. `H7/p6` is the class that interferes at every band.
    kind: "transition",
    label: "N7/h6 bearing housing",
    summary:
      "A housing bore centred below the race it holds, for a rolling-bearing outer ring that must not creep. Mostly "
      + "interference, with a few microns of clearance possible at the loose end of the band.",
    confidence: "verified",
    source:
      "ISO 286-2 N7 and h6 deviations. N7 is the housing bore recommended for a rolling-bearing outer ring under "
      + "heavy or rotating load, where H7 would let the ring creep in its seat."
  })
});

/**
 * Fit classes deliberately absent, with the reason.
 *
 * Same mechanism and the same reasoning as `UNSOURCED_COMPONENTS`: a caller naming one
 * of these gets a sentence saying a decision was made, rather than "no such class",
 * which reads as an oversight and invites the next author to add a row by eye. Every
 * one of these is a real class in ISO 286 - what is missing is a read of its rows, and
 * a fit guessed one grade off is a part that either seizes or falls out.
 */
const UNSOURCED_FITS = Object.freeze({
  "H7/g6": Object.freeze({
    id: "H7/g6",
    label: "H7/g6 sliding fit",
    reason:
      "H7/g6 is a running fit for a shaft that turns in its bore, and the g6 deviation series has not been read off "
      + "ISO 286-2 here. A running fit one grade tight is a bearing that heats up, so it is not a class to derive "
      + "from the h6 row by shifting it."
  }),
  "H8/f7": Object.freeze({
    id: "H8/f7",
    label: "H8/f7 running fit",
    reason:
      "H8/f7 is the usual free running fit, and neither the H8 nor the f7 series is held here - this table holds one "
      + "hole grade at IT7 and one at N7. Adding a grade means adding its published rows, not widening an IT7 row."
  }),
  "H7/k6": Object.freeze({
    id: "H7/k6",
    label: "H7/k6 transition fit",
    reason:
      "A transition fit may come out with clearance or with interference depending where in the band each part lands, "
      + "which makes it the one class where reading the rows approximately changes the kind of fit and not just its "
      + "tightness. The k6 series has not been read off the standard."
  }),
  "H7/s6": Object.freeze({
    id: "H7/s6",
    label: "H7/s6 medium press",
    reason:
      "H7/s6 is a medium press needing heat or a hydraulic press to assemble, and the s6 series is not held here. A "
      + "press fit guessed too tight splits the housing on assembly, which is not a failure a preview would show."
  }),
  "H7/u6": Object.freeze({
    id: "H7/u6",
    label: "H7/u6 force fit",
    reason:
      "A force fit is a shrink-fit calculation as much as a tolerance one - it needs an interference figure checked "
      + "against the hoop stress the housing can carry - and neither the u6 series nor that check is here."
  })
});

export const FIT_CLASSES = Object.freeze(Object.keys(FITS));
export const UNSOURCED_FIT_CLASS_IDS = Object.freeze(Object.keys(UNSOURCED_FITS));
/**
 * ISO 286-1's three families.
 *
 * `transition` is not a hedge between the other two - it is the case where the band is
 * wide enough that the same class can come out either way depending where each part
 * lands, which is a different engineering fact from "it clears" or "it presses". A
 * class declares which family it belongs to and `resolveFit` reports the family the
 * numbers actually produce at that nominal; a test asserts they agree at every band,
 * so a declared kind cannot be aspirational.
 */
export const FIT_KINDS = Object.freeze(["clearance", "transition", "interference"]);

export function isFitClass(id) {
  return Object.prototype.hasOwnProperty.call(FITS, id);
}

/** Class metadata with no geometry, for a picker or a note. */
export function getFitClass(id) {
  const fit = FITS[id];
  if (!fit) return null;
  return {
    id: fit.id,
    holeGrade: fit.holeGrade,
    shaftGrade: fit.shaftGrade,
    kind: fit.kind,
    label: fit.label,
    summary: fit.summary,
    confidence: fit.confidence,
    source: fit.source
  };
}

export function listFitClasses() {
  return FIT_CLASSES.map((id) => getFitClass(id));
}

/** The recorded reason a class is absent, or null if it is not one of them. */
export function unsourcedFitClassReason(id) {
  return UNSOURCED_FITS[id]?.reason ?? null;
}

/** The index of the band holding this nominal, or -1. Bands are `(over, upto]`. */
function bandIndexFor(nominalMm) {
  return FIT_SIZE_BANDS.findIndex((band) => nominalMm > band.overMm && nominalMm <= band.uptoMm);
}

/** The band holding this nominal, or null. Exported so a caller can state the range. */
export function fitSizeBandFor(nominalMm) {
  const index = bandIndexFor(Number(nominalMm));
  return index === -1 ? null : FIT_SIZE_BANDS[index];
}

function limitsFrom(gradeEntry, bandIndex, nominalMm) {
  const [upperUm, lowerUm] = gradeEntry.deviations[bandIndex];
  return {
    grade: gradeEntry.grade,
    nominalMm,
    upperDeviationUm: upperUm,
    lowerDeviationUm: lowerUm,
    maxMm: nominalMm + upperUm / 1000,
    minMm: nominalMm + lowerUm / 1000,
    toleranceMm: (upperUm - lowerUm) / 1000,
    source: gradeEntry.source
  };
}

/**
 * Which family a computed clearance range belongs to.
 *
 * A range that never goes negative clears; one that never goes positive interferes;
 * anything straddling zero is a transition, including the boundary case where one limit
 * lands exactly on zero. `H7/p6` reaches exactly zero clearance at four of the seven
 * bands and is still an interference fit, because a fit that is at worst line-to-line
 * has not clearance in it - hence `<= 0` rather than `< 0` on that side.
 */
function fitCharacter(clearanceMinMm, clearanceMaxMm) {
  if (clearanceMinMm >= 0) return "clearance";
  if (clearanceMaxMm <= 0) return "interference";
  return "transition";
}

function refuse(id, nominalMm, code, reason) {
  return { ok: false, fitClass: id, nominalMm, code, reason, provenance: [] };
}

/**
 * Resolve a fit class at a nominal diameter, or refuse naming the combination.
 *
 * The result carries the hole's limits, the shaft's limits, the clearance range
 * between them - negative where the class interferes - and the provenance of both
 * grades. A refusal carries no limits at all, matching `holes.js`: a partial fit would
 * be worse than none, because a hole limit with no shaft limit beside it reads as a
 * complete answer.
 */
export function resolveFit(fitClassId, nominalMm) {
  const id = String(fitClassId ?? "");
  const nominal = Number(nominalMm);

  if (!isFitClass(id)) {
    const unsourced = unsourcedFitClassReason(id);
    if (unsourced) {
      return refuse(
        id,
        Number.isFinite(nominal) ? nominal : null,
        FIT_UNSOURCED_CLASS,
        `There is no ${id} fit here, and that is deliberate. ${unsourced}`
      );
    }
    return refuse(
      id,
      Number.isFinite(nominal) ? nominal : null,
      FIT_UNKNOWN_CLASS,
      `No fit class named "${id}" is published here. Available: ${FIT_CLASSES.join(", ")}.`
    );
  }

  if (!Number.isFinite(nominal) || nominal <= 0) {
    return refuse(id, null, FIT_INVALID_NOMINAL, `A ${id} fit needs a positive nominal diameter in millimetres.`);
  }

  const bandIndex = bandIndexFor(nominal);
  if (bandIndex === -1) {
    const first = FIT_SIZE_BANDS[0];
    const last = FIT_SIZE_BANDS[FIT_SIZE_BANDS.length - 1];
    return refuse(
      id,
      nominal,
      FIT_SIZE_OUT_OF_RANGE,
      `${id} is published here for nominal diameters over ${first.overMm} mm and up to ${last.uptoMm} mm, and `
        + `${nominal} mm is outside every band. The rows for that size have not been read off ISO 286-2, and a `
        + "deviation is not scaled from the nearest band."
    );
  }

  const fit = FITS[id];
  const band = FIT_SIZE_BANDS[bandIndex];
  const hole = limitsFrom(HOLE_GRADES_UM[fit.holeGrade], bandIndex, nominal);
  const shaft = limitsFrom(SHAFT_GRADES_UM[fit.shaftGrade], bandIndex, nominal);
  const clearanceMinMm = hole.minMm - shaft.maxMm;
  const clearanceMaxMm = hole.maxMm - shaft.minMm;

  return {
    ok: true,
    fitClass: id,
    entry: getFitClass(id),
    nominalMm: nominal,
    band,
    hole,
    shaft,
    // Negative where the class interferes, which is why this is one signed range
    // rather than a `clearance` field and an `interference` field: the same
    // subtraction answers both questions and two fields could disagree.
    clearanceMm: Object.freeze({ minMm: clearanceMinMm, maxMm: clearanceMaxMm }),
    // The family the numbers actually produce here, as opposed to the family the class
    // declares. They agree for every class this table holds and a test says so at every
    // band - but they are computed separately on purpose, because that agreement is the
    // thing worth checking. It is how `N7/h6` was caught being labelled a press fit.
    character: fitCharacter(clearanceMinMm, clearanceMaxMm),
    provenance: [
      { dimension: `${fit.holeGrade}Limits`, source: `${hole.source}, nominal band over ${band.overMm} up to ${band.uptoMm} mm`, confidence: "verified" },
      { dimension: `${fit.shaftGrade}Limits`, source: `${shaft.source}, nominal band over ${band.overMm} up to ${band.uptoMm} mm`, confidence: "verified" }
    ]
  };
}

/**
 * The one diameter to draw a bore at for a fit, with the band it came from.
 *
 * The midpoint of the hole's own two limits. A solid model holds one number where the
 * standard holds a range, and the midpoint is the only choice that does not favour one
 * limit - but it is a modelling decision rather than a published value, so it is
 * labelled `drawnDiameterMm` beside the `minMm` and `maxMm` it was derived from and
 * never called the H7 diameter. Null for anything `resolveFit` refuses; the caller
 * that needs the reason should call `resolveFit` directly.
 */
export function fitBoreMm(fitClassId, nominalMm) {
  const resolved = resolveFit(fitClassId, nominalMm);
  if (!resolved.ok) return null;
  const { hole } = resolved;
  return {
    fitClass: resolved.fitClass,
    holeGrade: hole.grade,
    nominalMm: resolved.nominalMm,
    drawnDiameterMm: (hole.minMm + hole.maxMm) / 2,
    minMm: hole.minMm,
    maxMm: hole.maxMm,
    toleranceMm: hole.toleranceMm,
    band: resolved.band,
    provenance: resolved.provenance
  };
}

/** The IT tolerance a grade's deviation span must equal, for the cross-check test. */
export function itToleranceUm(itGrade, nominalMm) {
  const bandIndex = bandIndexFor(Number(nominalMm));
  if (bandIndex === -1) return null;
  return IT_GRADES_UM[itGrade]?.[bandIndex] ?? null;
}

/** Every grade row this table holds, for a provenance walk. */
export function listFitGrades() {
  return [...Object.values(HOLE_GRADES_UM), ...Object.values(SHAFT_GRADES_UM)].map((entry) => ({
    grade: entry.grade,
    itGrade: entry.itGrade,
    source: entry.source,
    deviations: entry.deviations
  }));
}
