/**
 * Whether two gears in the project actually mesh, and how well.
 *
 * ## Why a pair is a report and not a persisted thing
 *
 * `PartProject` V1 has `bodies` and no relationships, and `AGENTS.md` pins that
 * shape at `version: 1`. A meshing pair could have been added as a persisted entity
 * with its own ids, its own normalizer, its own round-trip test and its own
 * referential-integrity problem when one of the two bodies is deleted - and it would
 * have bought nothing, because **every number below is a pure function of the two
 * gear specs**. There is no user intent to store: a pair is not a decision, it is an
 * observation about two decisions already stored.
 *
 * So this module is derived output, computed on demand, exactly like
 * `massProperties.js` and `dfm.js`. Which two bodies the user is currently comparing
 * is presentation state and lives in `src/parts.js` beside the other session-only UI
 * state, never in the project.
 *
 * ## What is measured
 *
 * Centre distance and transverse contact ratio, from the geometry the generator
 * builds rather than from nominal formulas:
 *
 * - The **operating pressure angle** follows from the profile shifts through
 *   `inv(a_w) = inv(a) + 2 (x1 + x2) tan(a) / (z1 + z2)`, which is the standard
 *   relation and the reason `inverseInvoluteAngle` exists. With no shift it returns
 *   the cut pressure angle and the centre distance is the reference one.
 * - The **length of action** is measured along the line of action between the two
 *   base tangency points: contact starts where the wheel's tip circle crosses the
 *   line and ends where the pinion's does. Dividing by the base pitch gives the
 *   transverse contact ratio, which must exceed 1 for the pair to transmit motion
 *   continuously - below 1 the teeth lose contact between engagements and the drive
 *   hammers.
 * - **Tip interference** is reported when a tip circle reaches past the *other*
 *   gear's base tangency point, because there is no involute beyond that point for
 *   it to touch. That is the condition undercut exists to relieve, so it is stated
 *   next to the contact ratio rather than folded into it.
 *
 * A pair whose modules or pressure angles differ is **refused with a reason**, not
 * approximated: two gears of different module do not mesh, and reporting a contact
 * ratio for them would be inventing a number for a mechanism that cannot exist.
 *
 * The module is DOM-free and JSCAD-free.
 */

import { createIssue } from "./issues.js";
import { normalizeSpurGearSpec, spurGearGeometry } from "./gears.js";
import { inverseInvoluteAngle, involuteAngle } from "./standards/gears.js";

const DEG = Math.PI / 180;
/** Below this two nominally equal dimensions are the same dimension. */
const MATCH_TOLERANCE_MM = 1e-9;
const MATCH_TOLERANCE_DEG = 1e-9;

export const GEAR_PAIR_MODULE_MISMATCH = "gear-pair-module-mismatch";
export const GEAR_PAIR_PRESSURE_ANGLE_MISMATCH = "gear-pair-pressure-angle-mismatch";
export const GEAR_PAIR_HELIX_MISMATCH = "gear-pair-helix-mismatch";
export const GEAR_PAIR_LOW_CONTACT_RATIO = "gear-pair-low-contact-ratio";
export const GEAR_PAIR_TIP_INTERFERENCE = "gear-pair-tip-interference";
export const GEAR_PAIR_NO_CLEARANCE = "gear-pair-no-tip-root-clearance";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Everything derivable about two gears run together.
 *
 * `ok` is false only when the two cannot mesh at all; a low contact ratio, tip
 * interference and zero clearance are reported through `issues` while the numbers
 * stay available, because a designer fixing a 0.9 contact ratio needs to see it move.
 */
export function spurGearPairReport(gearAInput, gearBInput, options = {}) {
  const path = options.path ?? "gearPair";
  const gearA = normalizeSpurGearSpec(gearAInput);
  const gearB = normalizeSpurGearSpec(gearBInput);
  const issues = [];

  const moduleMismatch = Math.abs(gearA.moduleMm - gearB.moduleMm) > MATCH_TOLERANCE_MM;
  const angleMismatch = Math.abs(gearA.pressureAngleDeg - gearB.pressureAngleDeg) > MATCH_TOLERANCE_DEG;

  if (moduleMismatch) {
    issues.push(
      createIssue(
        GEAR_PAIR_MODULE_MISMATCH,
        `These gears do not mesh: module ${gearA.moduleMm} against ${gearB.moduleMm}. Two gears must share a module, and no centre distance corrects that.`,
        `${path}.moduleMm`,
        "error",
        { moduleAMm: gearA.moduleMm, moduleBMm: gearB.moduleMm }
      )
    );
  }
  if (angleMismatch) {
    issues.push(
      createIssue(
        GEAR_PAIR_PRESSURE_ANGLE_MISMATCH,
        `These gears do not mesh: pressure angle ${gearA.pressureAngleDeg} against ${gearB.pressureAngleDeg} degrees. The flanks are involutes of different base circles and touch at a point rather than rolling.`,
        `${path}.pressureAngleDeg`,
        "error",
        { pressureAngleADeg: gearA.pressureAngleDeg, pressureAngleBDeg: gearB.pressureAngleDeg }
      )
    );
  }

  if (moduleMismatch || angleMismatch) {
    return { ok: false, issues, gearA, gearB };
  }

  const a = spurGearGeometry(gearA, options);
  const b = spurGearGeometry(gearB, options);
  const moduleMm = a.moduleMm;
  const pressureAngleDeg = a.pressureAngleDeg;
  const alpha = pressureAngleDeg * DEG;
  const toothSum = a.toothCount + b.toothCount;
  const shiftSum = a.profileShiftCoefficient + b.profileShiftCoefficient;

  const referenceCentreDistanceMm = (toothSum * moduleMm) / 2;
  // Zero shift sum leaves the operating pressure angle equal to the cut one and the
  // centre distance equal to the reference one, which is the property that keeps an
  // unshifted pair exactly nominal.
  const operatingInvolute = involuteAngle(alpha) + (2 * shiftSum * Math.tan(alpha)) / toothSum;
  const operatingAlpha = shiftSum === 0 ? alpha : inverseInvoluteAngle(operatingInvolute) ?? alpha;
  const centreDistanceMm = (referenceCentreDistanceMm * Math.cos(alpha)) / Math.cos(operatingAlpha);

  // The distance between the two base tangency points along the line of action, and
  // the reach of each tip circle from its own tangency point.
  const actionSpanMm = centreDistanceMm * Math.sin(operatingAlpha);
  const reachAMm = Math.sqrt(Math.max(0, a.tipRadiusMm ** 2 - a.baseRadiusMm ** 2));
  const reachBMm = Math.sqrt(Math.max(0, b.tipRadiusMm ** 2 - b.baseRadiusMm ** 2));
  const contactStartMm = clamp(actionSpanMm - reachBMm, 0, actionSpanMm);
  const contactEndMm = clamp(reachAMm, 0, actionSpanMm);
  const lengthOfActionMm = Math.max(0, contactEndMm - contactStartMm);
  const basePitchMm = Math.PI * moduleMm * Math.cos(alpha);
  // `null`, not `0`: with no base pitch there is no ratio to state, and a reported `0`
  // reads as a measured "never in contact" rather than "not measurable here". The issue
  // below still fires - a pair with no base pitch is at least as broken as a low ratio.
  const contactRatio = basePitchMm > 0 ? lengthOfActionMm / basePitchMm : null;

  const tipInterference = reachAMm > actionSpanMm + MATCH_TOLERANCE_MM || reachBMm > actionSpanMm + MATCH_TOLERANCE_MM;

  // A tip has to clear the other gear's root, or the pair binds before the flanks
  // ever touch. Measured against the root the generator actually cuts, which is not
  // the rack's root on a pointed-root tooth.
  const tipRootClearanceAMm = centreDistanceMm - a.tipRadiusMm - b.rootRadiusMm;
  const tipRootClearanceBMm = centreDistanceMm - b.tipRadiusMm - a.rootRadiusMm;
  const tipRootClearanceMm = Math.min(tipRootClearanceAMm, tipRootClearanceBMm);

  // Backlash is per gear by this page's convention - each gear's tooth is thinned by
  // its own `backlashMm` - so the pair's circumferential backlash is the sum.
  const circumferentialBacklashMm = a.backlashMm + b.backlashMm;

  // A helical pair meshes only in opposite hands, and the axial overlap adds to the
  // transverse contact ratio: the overlap ratio is the face width over the axial
  // pitch, and the axial pitch is the transverse pitch over tan(beta).
  const helicalPair = a.helical || b.helical;
  const helixOpposed = Math.abs(a.helixAngleDeg + b.helixAngleDeg) <= MATCH_TOLERANCE_DEG;
  const faceWidthMm = Math.min(a.thicknessMm, b.thicknessMm);
  const overlapRatio = helicalPair && helixOpposed
    ? (faceWidthMm * Math.abs(Math.tan(a.helixAngleDeg * DEG))) / (Math.PI * moduleMm)
    : 0;

  if (helicalPair && !helixOpposed) {
    issues.push(
      createIssue(
        GEAR_PAIR_HELIX_MISMATCH,
        `A helical pair meshes only in opposite hands and equal magnitude: ${gearA.helixAngleDeg} against ${gearB.helixAngleDeg} degrees. Give one the negative of the other.`,
        `${path}.helixAngleDeg`,
        "error",
        { helixAngleADeg: gearA.helixAngleDeg, helixAngleBDeg: gearB.helixAngleDeg }
      )
    );
  }

  if (contactRatio == null || contactRatio <= 1) {
    issues.push(
      createIssue(
        GEAR_PAIR_LOW_CONTACT_RATIO,
        contactRatio == null
          ? `The transverse contact ratio cannot be measured: the base pitch is ${basePitchMm}, so there is no path of contact to divide. Give the pair a positive module and a pressure angle under 90 degrees.`
          : `The transverse contact ratio is ${contactRatio.toFixed(3)}, so at times no tooth pair is in contact and the drive hammers. Raise the tooth counts, the addendum, or the pressure angle.`,
        `${path}.contactRatio`,
        "warning",
        { contactRatio, lengthOfActionMm, basePitchMm }
      )
    );
  }

  if (tipInterference) {
    issues.push(
      createIssue(
        GEAR_PAIR_TIP_INTERFERENCE,
        `A tip circle reaches past the other gear's base tangency point, where there is no involute to touch. The contact ratio below is measured over the usable path only. Positive profile shift or a shorter addendum relieves it.`,
        `${path}.tipInterference`,
        "warning",
        { actionSpanMm, reachAMm, reachBMm }
      )
    );
  }

  if (tipRootClearanceMm <= 0) {
    issues.push(
      createIssue(
        GEAR_PAIR_NO_CLEARANCE,
        `There is no bottom clearance at this centre distance: the closest tip and root are ${tipRootClearanceMm.toFixed(3)} mm apart. The pair binds before the flanks meet.`,
        `${path}.tipRootClearanceMm`,
        "error",
        { tipRootClearanceMm, centreDistanceMm }
      )
    );
  }

  return {
    ok: issues.every((entry) => entry.severity !== "error"),
    issues,
    gearA,
    gearB,
    moduleMm,
    pressureAngleDeg,
    toothCountA: a.toothCount,
    toothCountB: b.toothCount,
    /** Reduction as gear B turns per turn of gear A. */
    gearRatio: a.toothCount > 0 ? b.toothCount / a.toothCount : null,
    referenceCentreDistanceMm,
    centreDistanceMm,
    operatingPressureAngleDeg: operatingAlpha / DEG,
    profileShiftSum: shiftSum,
    basePitchMm,
    actionSpanMm,
    lengthOfActionMm,
    contactRatio,
    overlapRatio,
    // A sum with an absent term is absent, not the other term.
    totalContactRatio: contactRatio == null ? null : contactRatio + overlapRatio,
    tipInterference,
    tipRootClearanceMm,
    circumferentialBacklashMm,
    helical: helicalPair,
    helixOpposed
  };
}
