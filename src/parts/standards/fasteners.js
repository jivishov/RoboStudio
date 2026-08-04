/**
 * ISO metric fastener and hole reference data. All dimensions in millimetres.
 *
 * Sources and confidence:
 * - Clearance holes are ISO 273 / EN 20273 (fine, medium, coarse), surfaced here
 *   as close, normal, and loose. High confidence.
 * - Tap drill is nominal minus pitch. High confidence.
 * - Socket head cap screw head diameter and height are ISO 4762. High confidence.
 * - Hex nut across-flats and thickness are ISO 4032; across-corners is derived
 *   exactly as acrossFlats / cos(30 degrees). High confidence.
 * - Plain washer outer diameter and thickness are ISO 7089. High confidence.
 * - Countersink head diameter is ISO 7046, which is 90 degrees included for
 *   metric. The 82 degree figure is ANSI and does not apply here. ISO 10642
 *   flat socket head is a different and larger series and is deliberately not
 *   published in this table.
 * - Machined counterbore diameter is quoted from DIN 974-1 row 1 and is FLAGGED
 *   as needing a standard lookup before it is relied upon for machined parts.
 *   The printed counterbore is derived as head diameter plus 0.7, matching the
 *   convention in six_axis_robot_arm_stl_kit.
 *
 * Every accessor returns null for a size or feature this table does not hold.
 * Do not interpolate: a wrong hole is worse than an absent one.
 */

export const FASTENER_SIZES = Object.freeze(["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"]);
export const CLEARANCE_FITS = Object.freeze(["close", "normal", "loose"]);
export const COUNTERSINK_INCLUDED_ANGLE_DEG = 90;

/** Printed counterbores are cut tighter than the machined standard. */
const FDM_COUNTERBORE_ALLOWANCE_MM = 0.7;
const ACROSS_CORNERS_FACTOR = 1 / Math.cos(Math.PI / 6);

const FASTENERS = Object.freeze({
  M2: {
    nominalMm: 2,
    pitchMm: 0.4,
    clearanceMm: { close: 2.2, normal: 2.4, loose: 2.6 },
    tapDrillMm: 1.6,
    headDiameterMm: 3.8,
    headHeightMm: 2.0,
    counterboreDiameterMm: 4.4,
    counterboreDepthMm: 2.4,
    countersinkHeadDiameterMm: 3.8,
    nutAcrossFlatsMm: 4.0,
    nutThicknessMm: 1.6,
    washerOuterDiameterMm: 5.0,
    washerThicknessMm: 0.3
  },
  "M2.5": {
    nominalMm: 2.5,
    pitchMm: 0.45,
    clearanceMm: { close: 2.7, normal: 2.9, loose: 3.1 },
    tapDrillMm: 2.05,
    headDiameterMm: 4.5,
    headHeightMm: 2.5,
    counterboreDiameterMm: 5.0,
    counterboreDepthMm: 2.9,
    countersinkHeadDiameterMm: 4.7,
    nutAcrossFlatsMm: 5.0,
    nutThicknessMm: 2.0,
    washerOuterDiameterMm: 6.0,
    washerThicknessMm: 0.5
  },
  M3: {
    nominalMm: 3,
    pitchMm: 0.5,
    clearanceMm: { close: 3.2, normal: 3.4, loose: 3.6 },
    tapDrillMm: 2.5,
    headDiameterMm: 5.5,
    headHeightMm: 3.0,
    counterboreDiameterMm: 6.5,
    counterboreDepthMm: 3.4,
    countersinkHeadDiameterMm: 5.6,
    nutAcrossFlatsMm: 5.5,
    nutThicknessMm: 2.4,
    washerOuterDiameterMm: 7.0,
    washerThicknessMm: 0.5
  },
  M4: {
    nominalMm: 4,
    pitchMm: 0.7,
    clearanceMm: { close: 4.3, normal: 4.5, loose: 4.8 },
    tapDrillMm: 3.3,
    headDiameterMm: 7.0,
    headHeightMm: 4.0,
    counterboreDiameterMm: 8.0,
    counterboreDepthMm: 4.4,
    countersinkHeadDiameterMm: 7.5,
    nutAcrossFlatsMm: 7.0,
    nutThicknessMm: 3.2,
    washerOuterDiameterMm: 9.0,
    washerThicknessMm: 0.8
  },
  M5: {
    nominalMm: 5,
    pitchMm: 0.8,
    clearanceMm: { close: 5.3, normal: 5.5, loose: 5.8 },
    tapDrillMm: 4.2,
    headDiameterMm: 8.5,
    headHeightMm: 5.0,
    counterboreDiameterMm: 10.0,
    counterboreDepthMm: 5.4,
    countersinkHeadDiameterMm: 9.2,
    nutAcrossFlatsMm: 8.0,
    nutThicknessMm: 4.7,
    washerOuterDiameterMm: 10.0,
    washerThicknessMm: 1.0
  },
  M6: {
    nominalMm: 6,
    pitchMm: 1.0,
    clearanceMm: { close: 6.4, normal: 6.6, loose: 7.0 },
    tapDrillMm: 5.0,
    headDiameterMm: 10.0,
    headHeightMm: 6.0,
    counterboreDiameterMm: 11.0,
    counterboreDepthMm: 6.4,
    countersinkHeadDiameterMm: 11.0,
    nutAcrossFlatsMm: 10.0,
    nutThicknessMm: 5.2,
    washerOuterDiameterMm: 12.0,
    washerThicknessMm: 1.6
  },
  M8: {
    nominalMm: 8,
    pitchMm: 1.25,
    clearanceMm: { close: 8.4, normal: 9.0, loose: 10.0 },
    tapDrillMm: 6.8,
    headDiameterMm: 13.0,
    headHeightMm: 8.0,
    counterboreDiameterMm: 15.0,
    counterboreDepthMm: 8.4,
    countersinkHeadDiameterMm: 14.5,
    nutAcrossFlatsMm: 13.0,
    nutThicknessMm: 6.8,
    washerOuterDiameterMm: 16.0,
    washerThicknessMm: 1.6
  }
});

/**
 * Heat-set inserts are vendor specifications, not a standard. Only sizes that
 * have been verified against a published Ruthex datasheet appear here; the
 * remaining sizes resolve to null on purpose.
 */
const HEAT_SET_INSERTS = Object.freeze({
  M2: { vendor: "ruthex", outerDiameterMm: 3.6, lengthMm: 4.0, boreDiameterMm: 3.2, boreDepthMm: 4.2 },
  M3: { vendor: "ruthex", outerDiameterMm: 4.6, lengthMm: 5.7, boreDiameterMm: 4.0, boreDepthMm: 5.8 },
  M4: { vendor: "ruthex", outerDiameterMm: 5.6, lengthMm: 8.1, boreDiameterMm: 5.0, boreDepthMm: 8.2 }
});

export function isFastenerSize(size) {
  return Object.prototype.hasOwnProperty.call(FASTENERS, size);
}

export function getFastener(size) {
  return FASTENERS[size] ?? null;
}

export function clearanceHoleDiameterMm(size, fit = "normal") {
  const entry = getFastener(size);
  if (!entry || !CLEARANCE_FITS.includes(fit)) return null;
  return entry.clearanceMm[fit];
}

export function tapDrillDiameterMm(size) {
  return getFastener(size)?.tapDrillMm ?? null;
}

/**
 * `process` selects between the DIN 974-1 machined counterbore and the tighter
 * printed one. Depth is the screw head height plus the standard allowance.
 */
export function counterboreMm(size, process = "fdm") {
  const entry = getFastener(size);
  if (!entry) return null;
  const diameterMm = process === "fdm"
    ? entry.headDiameterMm + FDM_COUNTERBORE_ALLOWANCE_MM
    : entry.counterboreDiameterMm;
  return { diameterMm, depthMm: entry.counterboreDepthMm };
}

export function countersinkMm(size) {
  const entry = getFastener(size);
  if (!entry) return null;
  return {
    headDiameterMm: entry.countersinkHeadDiameterMm,
    includedAngleDeg: COUNTERSINK_INCLUDED_ANGLE_DEG
  };
}

export function nutTrapMm(size) {
  const entry = getFastener(size);
  if (!entry) return null;
  return {
    acrossFlatsMm: entry.nutAcrossFlatsMm,
    acrossCornersMm: entry.nutAcrossFlatsMm * ACROSS_CORNERS_FACTOR,
    thicknessMm: entry.nutThicknessMm
  };
}

/** Null for any size without a verified vendor datasheet. */
export function heatSetInsertMm(size) {
  return HEAT_SET_INSERTS[size] ?? null;
}

export function washerMm(size) {
  const entry = getFastener(size);
  if (!entry) return null;
  return { outerDiameterMm: entry.washerOuterDiameterMm, thicknessMm: entry.washerThicknessMm };
}

/**
 * Common practice, not a standard: keep a fastener centre at least 1.5 nominal
 * diameters from an edge. Labelled as practice so callers can weaken it.
 */
export function minEdgeDistanceMm(size) {
  const entry = getFastener(size);
  return entry ? entry.nominalMm * 1.5 : null;
}

/**
 * Boss outer diameter that leaves `minWallMm` of material around a bore.
 *
 * The finite check is spelled out rather than borrowed from `contracts.js`'s
 * `isFiniteNumber` because this directory imports nothing from outside itself - the
 * standards tables are reference data that depend on no page logic, and that
 * independence is worth more than one deduplicated guard. (`components.js` imports
 * `fits.js`, which is one reference table quoting another; nothing here reaches out of
 * `standards/`.) Unlike every other accessor here, this one computes rather than
 * looks up, so the guard is on the caller's number, not on a missing table row.
 */
export function bossOuterDiameterMm(boreDiameterMm, minWallMm = 1.6) {
  if (!Number.isFinite(Number(boreDiameterMm))) return null;
  return Number(boreDiameterMm) + 2 * minWallMm;
}
