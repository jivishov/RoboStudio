/**
 * ISO metric screw thread reference data. All dimensions in millimetres.
 *
 * ## Why this file exists
 *
 * Cycle 10's plan put threads in the build123d tier on the assumption that a real
 * thread needs OCCT. It does not: `@jscad/modeling` 2.13.0 ships
 * `extrusions.extrudeHelical`, it sweeps an ISO 68-1 profile correctly, and both
 * `union` with a shank and `subtract` from a block succeed - which is the test that
 * matters, because a thread is only useful attached to a body. Threads are therefore
 * tier two and ship to GitHub Pages, and the generator that consumes this table is
 * `src/parts/threads.js` on the main thread.
 *
 * That leaves the numbers, and the numbers are a standards table rather than a
 * generator's business. A thread depth typed into a generator as `0.6134 * pitch` is
 * the same defect class as `base_plate`'s hard-coded `radius: 3.2` that cycle 08
 * removed: a figure that means "ISO says so" living somewhere nothing can check it.
 *
 * ## The same rules as `fasteners.js` and `fits.js`
 *
 * - **Nothing is interpolated.** A size or a pitch series this table does not hold
 *   refuses **by name**, and a tolerance class it does not hold refuses with the
 *   reason it is absent, exactly as `UNSOURCED_FITS` and `UNSOURCED_COMPONENTS` do.
 * - **Coarse pitches are not re-typed here.** `fasteners.js` already publishes
 *   `pitchMm` per size and that is the coarse ISO 261 pitch; this module reads it.
 *   Two tables holding the same seven numbers is one table that will eventually
 *   disagree with itself.
 * - **Derived figures are derived once, from the published basic profile**, and every
 *   accessor returns the coefficient it used so a caller can show its work.
 *
 * ## Sources
 *
 * - Coarse pitches: ISO 261 first choice, read through `fasteners.js`. High confidence.
 * - Fine pitches: ISO 261. The rows below are the fine pitches this project has
 *   verified; the ones it has not are in `UNSOURCED_THREAD_PITCHES` with the reason.
 * - Basic profile: ISO 68-1. The fundamental triangle height is `H = P * sqrt(3) / 2`
 *   exactly, and the basic diameters are offsets of `H` from the major diameter:
 *   pitch diameter is `d - 2 * (3/8) H`, and the basic minor diameter is
 *   `d - 2 * (5/8) H`. These are the standard's own construction, not a fit to
 *   tabulated values, which is why they are computed rather than quoted - the same
 *   licence `fasteners.js` takes for across-corners and tap drill.
 * - Fundamental deviations: ISO 965-1 publishes them as formulas in the pitch, and
 *   those formulas are quoted below. Tolerance **grades** (Td2, TD1 and friends) are
 *   tabulated rather than formulaic and are **not** published here - see
 *   `UNSOURCED_THREAD_TOLERANCES`. A modelled thread needs a position, not a band.
 */

import { FASTENER_SIZES, getFastener, isFastenerSize } from "./fasteners.js";

export const THREAD_SERIES = Object.freeze(["coarse", "fine"]);
export const THREAD_KINDS = Object.freeze(["external", "internal"]);

/**
 * ISO 68-1's fundamental triangle: an equilateral triangle of pitch `P`, so its
 * height is `P * sqrt(3) / 2`. Every other basic diameter below is an offset of a
 * simple fraction of this from the major diameter, which is why no accessor here
 * contains a decimal coefficient of its own.
 */
const FUNDAMENTAL_TRIANGLE_FACTOR = Math.sqrt(3) / 2;

/** ISO 68-1 offsets from the major diameter, in units of `H`, doubled for a diameter. */
const PITCH_DIAMETER_OFFSET_H = 3 / 8;
const BASIC_MINOR_DIAMETER_OFFSET_H = 5 / 8;

/** ISO 68-1 flat widths at the crest and the root of the basic profile, in units of `P`. */
const CREST_FLAT_PITCH_FRACTION = 1 / 8;
const ROOT_FLAT_PITCH_FRACTION = 1 / 4;

/**
 * ISO 261 fine pitches, one row per size this project has checked.
 *
 * A size with no row has no fine series here and refuses by name. That is not a
 * claim that ISO 261 publishes none - see `UNSOURCED_THREAD_PITCHES`.
 */
const FINE_PITCHES_MM = Object.freeze({
  M2: 0.25,
  "M2.5": 0.35,
  M3: 0.35,
  M4: 0.5,
  M5: 0.5,
  M6: 0.75,
  M8: 1.0
});

/**
 * Pitches ISO 261 publishes that this table deliberately does not hold.
 *
 * Recorded rather than omitted, so asking for one refuses as a known gap instead of
 * reading as an oversight, exactly as `UNSOURCED_FITS` does for a fit class.
 */
export const UNSOURCED_THREAD_PITCHES = Object.freeze([
  Object.freeze({
    size: "M8",
    pitchMm: 0.8,
    reason:
      "ISO 261 lists a second fine pitch for M8 beside 1.0. The row has not been read off the "
      + "published table in this project, and a second fine series would also need a way to ask "
      + "for it by pitch rather than by series name."
  })
]);

/**
 * ISO 965-1 fundamental deviations, quoted as the standard's own formulas.
 *
 * The standard defines the deviation of each tolerance position as a function of the
 * pitch in micrometres, so the formula is the published figure and tabulating its
 * output at seven pitches would be a copy of it that could drift. `es` is negative for
 * an external position (material removed from the bolt) and `EI` positive for an
 * internal one (material removed from the nut); `h` and `H` are zero by definition and
 * are the basic sizes.
 */
const DEVIATION_MICRONS = Object.freeze({
  e: Object.freeze({ kind: "external", formula: (pitchMm) => -(50 + 11 * pitchMm) }),
  f: Object.freeze({ kind: "external", formula: (pitchMm) => -(30 + 11 * pitchMm) }),
  g: Object.freeze({ kind: "external", formula: (pitchMm) => -(15 + 11 * pitchMm) }),
  h: Object.freeze({ kind: "external", formula: () => 0 }),
  G: Object.freeze({ kind: "internal", formula: (pitchMm) => 15 + 11 * pitchMm }),
  H: Object.freeze({ kind: "internal", formula: () => 0 })
});

export const THREAD_TOLERANCE_POSITIONS = Object.freeze(Object.keys(DEVIATION_MICRONS));

export const UNSOURCED_THREAD_TOLERANCES = Object.freeze([
  Object.freeze({
    what: "tolerance grades",
    reason:
      "ISO 965-1 tabulates the grade widths (Td2, TD1, TD2, Td) rather than giving them as "
      + "formulas, and this project has not read those tables. A solid model needs one diameter, "
      + "so it needs the position - which decides where the thread sits - and not the band width, "
      + "which decides how much it may vary. A caller wanting a band must add the rows, not "
      + "estimate them from the position."
  })
]);

function positionFor(toleranceClass, kind) {
  const position = String(toleranceClass ?? "").trim();
  const entry = DEVIATION_MICRONS[position];
  if (!entry) return null;
  return entry.kind === kind ? { position, ...entry } : null;
}

/**
 * Height of ISO 68-1's fundamental triangle for a pitch, `H = P * sqrt(3) / 2`.
 *
 * Not `contracts.js`'s `isFiniteNumber` or `asFiniteNumber`, for two separate reasons.
 * The first is the one `fasteners.js` gives for `bossOuterDiameterMm`: `standards/`
 * imports nothing outside itself, because reference data must not depend on page logic,
 * and that independence is worth more than one deduplicated guard. The second is the
 * contract: `asFiniteNumber` substitutes a fallback and this returns `null`, because a
 * triangle height computed from an unusable pitch is a fabricated dimension and every
 * diameter below is an offset of it.
 */
export function fundamentalTriangleHeightMm(pitchMm) {
  const pitch = Number(pitchMm);
  if (!Number.isFinite(pitch) || pitch <= 0) return null;
  return pitch * FUNDAMENTAL_TRIANGLE_FACTOR;
}

/** Every size this table can produce a thread for; the fastener table decides. */
export function listThreadSizes() {
  return FASTENER_SIZES.slice();
}

export function isThreadSize(size) {
  return isFastenerSize(size);
}

/**
 * The pitch for a size and series, or `null` with no guess.
 *
 * The coarse branch reads `fasteners.js` rather than holding a second copy of the
 * same seven numbers.
 */
export function threadPitchMm(size, series = "coarse") {
  if (!isThreadSize(size)) return null;
  if (series === "coarse") return getFastener(size)?.pitchMm ?? null;
  if (series === "fine") return FINE_PITCHES_MM[size] ?? null;
  return null;
}

/**
 * Why a size, series or class was refused, as a sentence naming the combination.
 *
 * Separate from `threadGeometry` so a caller can ask before it builds, and so the
 * refusal reads the same wherever it surfaces - the rule `holes.js` established over
 * `fasteners.js`.
 */
export function threadUnavailableReason(request = {}) {
  const { size, series = "coarse", kind = "external", toleranceClass } = request;
  if (!isThreadSize(size)) {
    return `ISO metric thread data is not published here for ${size ?? "an unnamed size"}. `
      + `Published sizes are ${FASTENER_SIZES.join(", ")}.`;
  }
  if (!THREAD_SERIES.includes(series)) {
    return `Thread series must be one of ${THREAD_SERIES.join(", ")}, not ${series}.`;
  }
  if (!THREAD_KINDS.includes(kind)) {
    return `Thread kind must be one of ${THREAD_KINDS.join(", ")}, not ${kind}.`;
  }
  if (threadPitchMm(size, series) === null) {
    const unsourced = UNSOURCED_THREAD_PITCHES.find((entry) => entry.size === size);
    return `No ${series} pitch is published here for ${size}.`
      + (unsourced ? ` ${unsourced.reason}` : "");
  }
  if (toleranceClass != null && !positionFor(toleranceClass, kind)) {
    return `Tolerance position ${toleranceClass} is not published here for an ${kind} thread. `
      + `Published positions are ${THREAD_TOLERANCE_POSITIONS.filter((item) => DEVIATION_MICRONS[item].kind === kind).join(", ")}.`;
  }
  return null;
}

/**
 * The diameters and profile flats for one thread, or `null` for a combination the
 * table does not hold.
 *
 * `toleranceClass` is a **position letter** - `g`, `h`, `e`, `f` for an external
 * thread, `H` or `G` for an internal one - and it shifts every diameter by the same
 * fundamental deviation, which is what makes a `6g` bolt fit a `6H` nut. Omitting it
 * gives the basic profile, which is `h`/`H`.
 *
 * Every returned figure carries the coefficient it was built from, so a caller
 * showing its work never has to re-derive one.
 */
export function threadGeometry(request = {}) {
  const { size, series = "coarse", kind = "external" } = request;
  if (threadUnavailableReason(request)) return null;

  const pitchMm = threadPitchMm(size, series);
  const nominalMm = getFastener(size).nominalMm;
  const triangleHeightMm = fundamentalTriangleHeightMm(pitchMm);
  const toleranceClass = request.toleranceClass ?? (kind === "external" ? "h" : "H");
  const position = positionFor(toleranceClass, kind);
  // Micrometres in the standard, millimetres everywhere in this project.
  const deviationMm = position.formula(pitchMm) / 1000;

  const majorDiameterMm = nominalMm + deviationMm;
  const pitchDiameterMm = majorDiameterMm - 2 * PITCH_DIAMETER_OFFSET_H * triangleHeightMm;
  const minorDiameterMm = majorDiameterMm - 2 * BASIC_MINOR_DIAMETER_OFFSET_H * triangleHeightMm;

  return {
    size,
    series,
    kind,
    toleranceClass,
    pitchMm,
    nominalMm,
    fundamentalTriangleHeightMm: triangleHeightMm,
    fundamentalDeviationMm: deviationMm,
    majorDiameterMm,
    pitchDiameterMm,
    minorDiameterMm,
    crestFlatMm: pitchMm * CREST_FLAT_PITCH_FRACTION,
    rootFlatMm: pitchMm * ROOT_FLAT_PITCH_FRACTION,
    source: "ISO 68-1 basic profile; ISO 261 pitch; ISO 965-1 fundamental deviation",
    confidence: "high"
  };
}

/**
 * A one-line designation, the way a drawing writes it: `M8x1.25 - 6g`.
 *
 * The grade digit is deliberately absent, because this table publishes positions and
 * not grades (`UNSOURCED_THREAD_TOLERANCES`). Writing `6g` here would state a grade
 * nothing in this project can check.
 */
export function describeThread(geometry) {
  if (!geometry) return null;
  return `${geometry.size}x${geometry.pitchMm} ${geometry.kind} - ${geometry.toleranceClass}`;
}
