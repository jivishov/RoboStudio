/**
 * Spur and helical gear generation from the ISO 53 basic rack.
 *
 * ## What changed and why it mattered
 *
 * Until this module was rewritten, `pressureAngleDeg` was validated between 10 and
 * 35 degrees, stored, shown in the inspector, and used by nothing. The tooth was
 * four points in polar coordinates - root, tip, tip, root - with the tips placed at
 * a hard-coded `flankInset = 0.18` of the angular pitch. Two such gears do not roll
 * on one another, they cam: a 20-tooth and a 40-tooth of the same module do not mesh
 * at their nominal centre distance, because nothing in the shape knew what a
 * pressure angle is. Adjacent teeth also met at a single point at the root radius,
 * so there was no root land at all - the one place a gear tooth actually breaks.
 *
 * The flank is now a true involute of a base circle, and `pressureAngleDeg` is the
 * parameter that shapes it.
 *
 * ## The four radii, and where each comes from
 *
 * With module `m`, tooth count `z`, pressure angle `a`, profile shift `x`, and the
 * basic rack's coefficients from `standards/gears.js`:
 *
 * | Radius | Formula | Source |
 * |---|---|---|
 * | reference (pitch) `r`   | `z m / 2`               | the definition of the module: `p = pi m` around `2 pi r` |
 * | base `r_b`              | `r cos a`               | the circle the involute is unwound from; `pressureAngleDeg` enters here and nowhere else |
 * | tip `r_a`               | `r + m (h_aP* + x)`     | the rack's addendum, raised by the profile shift |
 * | root `r_f`              | `r - m (h_fP* - x)`     | the rack's dedendum, cut deeper by a negative shift |
 *
 * The tooth's angular half-width at radius `u` is the standard involute
 * thickness relation, and it is the whole of the flank:
 *
 *     psi(u) = s / (2 r) + inv(a) - inv(a_u),    cos(a_u) = r_b / u
 *
 * so the right flank sits at `-psi(u)` and the left at `+psi(u)`. Two properties
 * fall out of that and are asserted in the tests rather than assumed:
 *
 * - At `u = r` the half-width is `s / (2 r)`, so **the flank passes through the pitch
 *   circle at the reference tooth thickness** by construction.
 * - The unit tangent is `cos(a_u) e_r + sin(a_u) e_theta`, so **the tangent makes
 *   exactly `a_u` with the radial direction**, which at the pitch circle is the
 *   pressure angle. That is the property that makes the tooth mesh, and it is
 *   measured from the emitted points rather than recomputed from this comment.
 *
 * The reference tooth thickness carries the shift and the backlash:
 *
 *     s = m (pi / 2 + 2 x tan a) - j
 *
 * `backlashMm` is `j`: the circumferential backlash **this gear contributes**, taken
 * off its own tooth. A pair where both gears carry `j` therefore has `2 j` of
 * circumferential backlash, and `gearPair.js` reports the sum rather than assuming a
 * convention. Zero shift and zero backlash give `s = pi m / 2`, the nominal tooth.
 *
 * ## Below the base circle, and the root fillet
 *
 * An involute does not exist below its base circle, and for any gear with
 * `r_f < r_b` - which is every tooth count below 83 at 20 degrees - some of the
 * flank is below it. What a real rack cuts there is a trochoid. What this generator
 * emits is the involute's own tangent at the base circle, which is **exactly radial**
 * (`a_u = 0` there, so the tangent is `e_r`), continued inward as a straight radial
 * line. That is C1-continuous with the involute rather than a patch, it removes no
 * more material than the trochoid would, and none of it is load-bearing: contact
 * never reaches below the base circle. It is an approximation and is named as one -
 * the true trochoid, and with it a geometric rather than closed-form undercut, is
 * not in this cycle.
 *
 * The root fillet is a circular arc of radius `rho`, tangent to the root circle and
 * tangent to the flank, which is the shape a rack tip of radius `rho_fP` leaves.
 * Its centre sits `rho` from the flank along the outward normal and `r_f + rho` from
 * the gear axis; that pair of conditions is one monotone scalar equation in the
 * tangency radius, solved to machine precision by bisection. The involute is convex
 * toward the space - its centre of curvature is on the material side, at the base
 * circle, which is why `|P - R n| = r_b` - so this offset never folds back on itself
 * and there is no second constraint to check.
 *
 * `rho` is then clamped so the **root land survives**: the two fillets of adjacent
 * teeth must leave an arc of root circle between them. A gear whose fillets would
 * meet is reported through `rootFilletClampedMm` rather than silently drawn with a
 * self-intersecting root.
 *
 * ## Tessellation is a tolerance, not a count
 *
 * `AGENTS.md` requires curved 2D features to be tessellated adaptively from a chord
 * tolerance, and forbids the fixed segment-count constant cycle 03 removed
 * everywhere else. This module still had one. The tip land, the root land, the
 * fillets and the bore all now take their segment counts from
 * `circleSegmentsForRadius`, and the involute flank - which is not a circular arc
 * and so has no radius to hand that function - is sampled by **recursive
 * subdivision against the same tolerance**: a span is split while its midpoint lies
 * further from its chord than `toleranceMm`. A fixed sample count per flank would
 * have been the same constant in a different costume, which is why there is none.
 * The consequence is that the point count is a function of the tolerance and no test
 * may pin it - a test that greps this file for the old name says so.
 *
 * ## Helical teeth
 *
 * A helical gear is the transverse profile swept along a helix, which is exactly a
 * twisted linear extrusion. Over a face width `b`, a helix of angle `beta` at the
 * reference cylinder advances `b tan(beta)` of arc length, so the twist is
 *
 *     twist = b tan(beta) / r
 *
 * derived rather than fitted. `moduleMm` and `pressureAngleDeg` are the
 * **transverse** values - the plane the profile is drawn in - and the normal module
 * and normal pressure angle are reported as derived output, so a helix angle of zero
 * changes nothing about a spur gear.
 *
 * The bore is subtracted in 2D **before** the twist, which is correct rather than
 * convenient: a circle centred on the axis of rotation maps to itself under a
 * rotation about that axis, so a concentric bore is invariant under the twist and
 * comes out straight. A test measures the bore at both faces to keep that true.
 *
 * The module is DOM-free and runs under `node:test`.
 */

import jscad from "@jscad/modeling";
import {
  DEFAULT_BODY_COLOR,
  SPUR_GEAR_KIND,
  asFiniteNumber,
  asPositiveNumber,
  createDefaultTransform,
  isFiniteNumber as finite,
  isPositiveNumber as positive,
  uniquePartId
} from "./contracts.js";
import { createIssue as issue } from "./issues.js";
import {
  basicRackDeviatesFromStandard,
  basicRackProfile,
  inverseInvoluteAngle,
  involuteAngle,
  normalizeBasicRackProfileId,
  undercutLimitProfileShift,
  undercutLimitToothCount
} from "./standards/gears.js";
import { DEFAULT_CHORD_TOLERANCE_MM, circleSegmentsForRadius } from "./tessellation.js";

const { booleans, extrusions, primitives } = jscad;
const { subtract } = booleans;
const { extrudeLinear } = extrusions;
const { circle, polygon } = primitives;

const DEG = Math.PI / 180;

export const MIN_TOOTH_COUNT = 6;
export const MAX_TOOTH_COUNT = 120;
export const MIN_PRESSURE_ANGLE_DEG = 10;
export const MAX_PRESSURE_ANGLE_DEG = 35;
/** Beyond about +1 the tooth points and below -1 it is all undercut. */
export const MAX_ABS_PROFILE_SHIFT = 1;
/** Past 45 degrees a "helical gear" is a worm, which this page does not generate. */
export const MAX_ABS_HELIX_ANGLE_DEG = 45;

/**
 * Every field `normalizeSpurGearSpec` keeps.
 *
 * Landmine two from the meta plan: `normalizePartBody` rebuilds every body from a
 * fixed key set and runs on every mutation path, so a field absent from the
 * normalizer is not "unsaved", it is *saved and then gone after the next edit*.
 * Exported so a test can assert the whitelist is the whitelist rather than trusting
 * that this list and the function below agree.
 */
export const SPUR_GEAR_SPEC_FIELDS = Object.freeze([
  "toothCount",
  "moduleMm",
  "pressureAngleDeg",
  "boreDiameterMm",
  "thicknessMm",
  "rackProfileId",
  "profileShiftCoefficient",
  "backlashMm",
  "rootFilletFactor",
  "helixAngleDeg"
]);

/**
 * The root land may not vanish, so a fillet is clamped to leave this fraction of
 * the angular half-pitch as land. Two percent of the half-pitch on a 2 mm module
 * 24-tooth gear is 0.06 mm of arc: small enough not to reshape a nominal gear,
 * large enough that the polygon cannot close on itself.
 */
const MIN_ROOT_LAND_ANGLE_FRACTION = 0.02;
/**
 * A land narrower than this fraction of the angular half-pitch is no land.
 *
 * Load-bearing rather than defensive. A pointed tip and a pointed root are both
 * found by solving for the radius where a half-angle reaches a target, so the
 * half-angle at that radius comes back as some 1e-16 rather than as zero - and a bare
 * `> 0` then emits a land arc one point wide, whose single point is the one the next
 * span already supplies. The result is a duplicate vertex and a zero-length edge in
 * the extruded solid. Snapping the angle is what keeps the two cases genuinely
 * pointed instead of almost pointed.
 */
const LAND_ANGLE_EPSILON_FRACTION = 1e-9;
/** Recursion cap on the flank sampler: 4 spans times 2^9 is far past any tolerance. */
const MAX_FLANK_SUBDIVISION_DEPTH = 9;
/** Initial spans per flank, so a symmetric curve cannot hide from the midpoint test. */
const INITIAL_FLANK_SPANS = 4;
/** Twist resolution is a tolerance too, and this bounds the resulting step count. */
const MAX_TWIST_STEPS = 256;

const SKETCH_TO_PART_PLANE_MATRIX = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** A half-angle, with anything indistinguishable from zero snapped to zero. */
function snapLandAngle(angleRad, halfPitchAngleRad) {
  if (!(angleRad > halfPitchAngleRad * LAND_ANGLE_EPSILON_FRACTION)) return 0;
  return angleRad;
}

function rackFor(gear) {
  return basicRackProfile(normalizeBasicRackProfileId(gear?.rackProfileId));
}

/**
 * Root radius from the rack, needed by the normalizer before a full geometry pass
 * exists (the default bore is a fraction of it) and by validation.
 */
function rootRadiusFromSpec(toothCount, moduleMm, rackProfileId, profileShiftCoefficient) {
  const rack = basicRackProfile(normalizeBasicRackProfileId(rackProfileId));
  const pitchRadius = (Number(toothCount) * Number(moduleMm)) / 2;
  return pitchRadius - Number(moduleMm) * (rack.dedendumFactor - Number(profileShiftCoefficient));
}

export function normalizeSpurGearSpec(value = {}) {
  const toothCount = Math.max(
    MIN_TOOTH_COUNT,
    Math.min(MAX_TOOTH_COUNT, Math.round(asPositiveNumber(value.toothCount, 24, 1)))
  );
  const moduleMm = asPositiveNumber(value.moduleMm, 2, 0.01);
  const pressureAngleDeg = clamp(
    asFiniteNumber(value.pressureAngleDeg, 20),
    MIN_PRESSURE_ANGLE_DEG,
    MAX_PRESSURE_ANGLE_DEG
  );
  const thicknessMm = asPositiveNumber(value.thicknessMm, 6, 0.1);
  // An id this build has no coefficients for falls back rather than being kept, for
  // the reason `normalizeProcessId` does: every downstream reader must be able to
  // resolve it, and `basicRackProfile` deliberately returns null instead of guessing.
  const rackProfileId = normalizeBasicRackProfileId(value.rackProfileId);
  const profileShiftCoefficient = clamp(
    asFiniteNumber(value.profileShiftCoefficient, 0),
    -MAX_ABS_PROFILE_SHIFT,
    MAX_ABS_PROFILE_SHIFT
  );
  const backlashMm = Math.max(0, asFiniteNumber(value.backlashMm, 0));
  // `null` means "follow the rack profile", which is different from zero: zero is a
  // sharp root corner a real cutter cannot leave, and it is a legitimate thing to
  // ask for. Keeping the null rather than resolving it here means switching rack
  // profile still moves the fillet, instead of freezing whatever the old rack said.
  const rootFilletFactor = value.rootFilletFactor == null
    ? null
    : Math.max(0, asFiniteNumber(value.rootFilletFactor, 0));
  const helixAngleDeg = clamp(
    asFiniteNumber(value.helixAngleDeg, 0),
    -MAX_ABS_HELIX_ANGLE_DEG,
    MAX_ABS_HELIX_ANGLE_DEG
  );

  const rootRadiusMm = rootRadiusFromSpec(toothCount, moduleMm, rackProfileId, profileShiftCoefficient);
  const boreDiameterMm = Math.max(
    0,
    asFiniteNumber(value.boreDiameterMm, Math.min(6, Math.max(0, rootRadiusMm * 2) * 0.35))
  );

  return {
    toothCount,
    moduleMm,
    pressureAngleDeg,
    boreDiameterMm,
    thicknessMm,
    rackProfileId,
    profileShiftCoefficient,
    backlashMm,
    rootFilletFactor,
    helixAngleDeg
  };
}

export function createSpurGearBody(options = {}, existingIds = new Set()) {
  const gear = normalizeSpurGearSpec(options.gear ?? options);
  const id = uniquePartId(options.id ?? "spur_gear", existingIds, "spur_gear");

  return {
    id,
    name: String(options.name ?? `${gear.toothCount}T spur gear`),
    color: options.color ?? DEFAULT_BODY_COLOR,
    transform: createDefaultTransform(options.transform),
    source: { kind: SPUR_GEAR_KIND },
    sketch: { outerProfile: null, cutProfiles: [] },
    extrudeDepthMm: gear.thicknessMm,
    gear
  };
}

export function validateSpurGearSpec(gear, path = "gear") {
  const issues = [];
  if (!Number.isInteger(Number(gear?.toothCount)) || Number(gear.toothCount) < MIN_TOOTH_COUNT || Number(gear.toothCount) > MAX_TOOTH_COUNT) {
    issues.push(issue("invalid-gear-tooth-count", `Spur gear tooth count must be ${MIN_TOOTH_COUNT}-${MAX_TOOTH_COUNT}.`, `${path}.toothCount`));
  }
  if (!positive(gear?.moduleMm)) {
    issues.push(issue("invalid-gear-module", "Spur gear module must be a positive millimeter value.", `${path}.moduleMm`));
  }
  if (!finite(gear?.pressureAngleDeg) || Number(gear.pressureAngleDeg) < MIN_PRESSURE_ANGLE_DEG || Number(gear.pressureAngleDeg) > MAX_PRESSURE_ANGLE_DEG) {
    issues.push(issue("invalid-gear-pressure-angle", `Pressure angle must stay between ${MIN_PRESSURE_ANGLE_DEG} and ${MAX_PRESSURE_ANGLE_DEG} degrees.`, `${path}.pressureAngleDeg`));
  }
  if (!positive(gear?.thicknessMm)) {
    issues.push(issue("invalid-gear-thickness", "Spur gear thickness must be a positive millimeter value.", `${path}.thicknessMm`));
  }
  if (!finite(gear?.profileShiftCoefficient) || Math.abs(Number(gear.profileShiftCoefficient)) > MAX_ABS_PROFILE_SHIFT) {
    issues.push(issue("invalid-gear-profile-shift", `Profile shift coefficient must stay between -${MAX_ABS_PROFILE_SHIFT} and ${MAX_ABS_PROFILE_SHIFT}.`, `${path}.profileShiftCoefficient`));
  }
  if (!finite(gear?.backlashMm) || Number(gear.backlashMm) < 0) {
    issues.push(issue("invalid-gear-backlash", "Backlash must be a non-negative millimeter value.", `${path}.backlashMm`));
  }
  if (gear?.rootFilletFactor != null && (!finite(gear.rootFilletFactor) || Number(gear.rootFilletFactor) < 0)) {
    issues.push(issue("invalid-gear-root-fillet", "Root fillet factor must be null or a non-negative multiple of the module.", `${path}.rootFilletFactor`));
  }
  if (!finite(gear?.helixAngleDeg) || Math.abs(Number(gear.helixAngleDeg)) > MAX_ABS_HELIX_ANGLE_DEG) {
    issues.push(issue("invalid-gear-helix-angle", `Helix angle must stay between -${MAX_ABS_HELIX_ANGLE_DEG} and ${MAX_ABS_HELIX_ANGLE_DEG} degrees.`, `${path}.helixAngleDeg`));
  }

  // The tooth thickness at the reference circle is what backlash and a negative
  // shift eat into, and a non-positive one is not a thin tooth, it is no tooth.
  if (positive(gear?.moduleMm) && finite(gear?.pressureAngleDeg) && finite(gear?.profileShiftCoefficient) && finite(gear?.backlashMm)) {
    const thickness = referenceToothThicknessMm(gear);
    if (!(thickness > 0)) {
      issues.push(issue("invalid-gear-backlash", "Backlash and profile shift together leave no tooth thickness at the pitch circle.", `${path}.backlashMm`));
    }
  }

  const boreDiameterMm = Number(gear?.boreDiameterMm);
  if (!finite(gear?.boreDiameterMm) || boreDiameterMm < 0) {
    issues.push(issue("invalid-gear-bore", "Bore diameter must be non-negative and smaller than the gear root diameter.", `${path}.boreDiameterMm`));
  } else if (positive(gear?.toothCount) && positive(gear?.moduleMm)) {
    // The root diameter now carries the profile shift, so the bore is checked
    // against the root the generator will actually cut rather than against the
    // unshifted one.
    const rootDiameterMm = 2 * rootRadiusFromSpec(
      gear.toothCount,
      gear.moduleMm,
      gear.rackProfileId,
      asFiniteNumber(gear.profileShiftCoefficient, 0)
    );
    if (!(rootDiameterMm > 0)) {
      issues.push(issue("invalid-gear-root-radius", "Profile shift cuts the root circle to or past the gear axis.", `${path}.profileShiftCoefficient`));
    } else if (boreDiameterMm >= rootDiameterMm * 0.82) {
      issues.push(issue("invalid-gear-bore", "Bore diameter must be non-negative and smaller than the gear root diameter.", `${path}.boreDiameterMm`));
    }
  }

  return issues;
}

/** Tooth thickness at the reference circle: `m (pi/2 + 2 x tan a) - j`. */
function referenceToothThicknessMm(gear) {
  const moduleMm = Number(gear.moduleMm);
  const alpha = Number(gear.pressureAngleDeg) * DEG;
  const shift = asFiniteNumber(gear.profileShiftCoefficient, 0);
  const backlash = Math.max(0, asFiniteNumber(gear.backlashMm, 0));
  return moduleMm * (Math.PI / 2 + 2 * shift * Math.tan(alpha)) - backlash;
}

/* --------------------------------------------------------------- flank algebra */

/** Pressure angle at a radius. Zero at or inside the base circle. */
function pressureAngleAtRadius(radiusMm, baseRadiusMm) {
  if (!(radiusMm > baseRadiusMm)) return 0;
  return Math.acos(clamp(baseRadiusMm / radiusMm, -1, 1));
}

/**
 * The involute flank of one tooth, in a frame whose zero is the tooth centreline.
 *
 * `angleAt(u)` is the right flank; the left flank is its mirror. Inside the base
 * circle the angle is constant, which is the radial continuation described in the
 * module doc, and it is the involute's own tangent direction there rather than a
 * separate rule.
 */
function createFlank(baseRadiusMm, pitchAlpha, toothHalfAngleRad) {
  const involuteAtPitch = involuteAngle(pitchAlpha);
  return {
    baseRadiusMm,
    pressureAngleAt(radiusMm) {
      return pressureAngleAtRadius(radiusMm, baseRadiusMm);
    },
    /** Signed angular position of the right flank at this radius. */
    angleAt(radiusMm) {
      const alphaU = pressureAngleAtRadius(radiusMm, baseRadiusMm);
      return involuteAngle(alphaU) - involuteAtPitch - toothHalfAngleRad;
    },
    /** Half the tooth's angular width at this radius. */
    halfAngleAt(radiusMm) {
      return -this.angleAt(radiusMm);
    },
    /** Cartesian point on the right flank. */
    pointAt(radiusMm) {
      const angle = this.angleAt(radiusMm);
      return [radiusMm * Math.cos(angle), radiusMm * Math.sin(angle)];
    },
    /**
     * Outward (into the tooth space) unit normal at this radius, in the local
     * `(e_r, e_theta)` basis: `(sin a_u, -cos a_u)`.
     */
    normalAt(radiusMm) {
      const alphaU = pressureAngleAtRadius(radiusMm, baseRadiusMm);
      return [Math.sin(alphaU), -Math.cos(alphaU)];
    }
  };
}

/**
 * Radius at which the two flanks of one tooth meet, if they do.
 *
 * `psi(u) = 0` when `inv(a_u) = inv(a) + s / (2 r)`, so the crossing radius follows
 * from one inverse-involute solve. A tip radius beyond this is a pointed tooth, and
 * the generator clamps to it rather than emitting a self-crossing polygon.
 */
function flankCrossingRadiusMm(baseRadiusMm, pitchAlpha, toothHalfAngleRad) {
  return radiusAtHalfAngle(baseRadiusMm, involuteAngle(pitchAlpha) + toothHalfAngleRad);
}

/**
 * Radius at which one tooth's flank meets its neighbour's, if it does.
 *
 * The mirror image of the pointed-tooth case, and just as real: a tooth widens
 * going down, so at a high pressure angle and a high tooth count the two flanks
 * bounding a space converge **above** the root circle the rack asks for. A rack
 * cutting that gear removes everything below the meeting point, so the space is a
 * sharp V with its apex there and the nominal root circle is simply unreachable.
 * The generator clamps the root up to the apex rather than drawing a root land the
 * tooth form cannot have - a zero-width root land is the defect this cycle exists to
 * remove, so where geometry forces one it is **reported** through `rootPointed`
 * instead of shipped silently.
 *
 * `psi(u) = pi / z` when `inv(a_u) = inv(a) + s / (2 r) - pi / z`. A non-positive
 * right-hand side means the flanks never converge that far, and inside the base
 * circle the radial run keeps the space width constant, so there is no crossing.
 */
function spaceCrossingRadiusMm(baseRadiusMm, pitchAlpha, toothHalfAngleRad, halfPitchAngleRad) {
  const target = involuteAngle(pitchAlpha) + toothHalfAngleRad - halfPitchAngleRad;
  if (!(target > 0)) return null;
  return radiusAtHalfAngle(baseRadiusMm, target);
}

/** Radius whose involute function offset from the base circle is `target`. */
function radiusAtHalfAngle(baseRadiusMm, target) {
  const alpha = inverseInvoluteAngle(Math.max(0, target));
  if (alpha == null) return null;
  const cosine = Math.cos(alpha);
  if (!(cosine > 0)) return null;
  return baseRadiusMm / cosine;
}

/**
 * The root fillet: an arc of radius `rho` tangent to both the root circle and the
 * flank.
 *
 * The tangency radius `u` is where the offset centre `P(u) + rho n(u)` lands exactly
 * `r_f + rho` from the axis. In the local basis that centre is
 * `(u + rho sin a_u) e_r - rho cos a_u e_theta`, whose squared magnitude is
 * `u^2 + 2 u rho sin a_u + rho^2` - strictly increasing in `u`, and below the target
 * at `u = r_f` for every `rho > 0` because `sin a_u <= 1`. One bisection therefore
 * finds the unique tangency.
 */
function solveFilletTangency(flank, rootRadiusMm, tipRadiusMm, filletRadiusMm) {
  const target = rootRadiusMm + filletRadiusMm;
  const centreRadius = (u) => {
    const alphaU = flank.pressureAngleAt(u);
    const radial = u + filletRadiusMm * Math.sin(alphaU);
    const tangential = -filletRadiusMm * Math.cos(alphaU);
    return Math.hypot(radial, tangential);
  };

  if (!(centreRadius(tipRadiusMm) > target)) return null;

  let low = rootRadiusMm;
  let high = tipRadiusMm;
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const middle = (low + high) / 2;
    if (centreRadius(middle) < target) low = middle;
    else high = middle;
  }

  const tangencyRadiusMm = (low + high) / 2;
  const alphaU = flank.pressureAngleAt(tangencyRadiusMm);
  const flankAngle = flank.angleAt(tangencyRadiusMm);
  const radial = tangencyRadiusMm + filletRadiusMm * Math.sin(alphaU);
  const tangential = -filletRadiusMm * Math.cos(alphaU);
  return {
    tangencyRadiusMm,
    tangencyAngleRad: flankAngle,
    centreRadiusMm: Math.hypot(radial, tangential),
    centreAngleRad: flankAngle + Math.atan2(tangential, radial),
    /** Direction from the fillet centre to the flank tangency point. */
    flankBearingRad: flankAngle + Math.atan2(Math.cos(alphaU), -Math.sin(alphaU))
  };
}

/**
 * The fillet actually used, clamped so a root land survives between adjacent teeth.
 *
 * A fillet that swallows the land would close the space and emit a polygon that
 * crosses itself, which shows up downstream as a `null` mass rather than as a crash.
 * So the requested radius is reduced by bisection until the land clears the floor,
 * and both the request and the result are reported.
 */
function resolveRootFillet(flank, rootRadiusMm, tipRadiusMm, requestedMm, halfPitchAngleRad) {
  const minimumLandAngle = halfPitchAngleRad * MIN_ROOT_LAND_ANGLE_FRACTION;
  /** Tangency and the land it leaves, for one candidate radius. */
  const attempt = (filletRadiusMm) => {
    if (!(filletRadiusMm > 0)) {
      // No fillet: the flank runs into the root circle and the land is whatever the
      // flank's own foot leaves.
      return { tangency: null, landHalfAngleRad: halfPitchAngleRad - Math.abs(flank.angleAt(rootRadiusMm)) };
    }
    const tangency = solveFilletTangency(flank, rootRadiusMm, tipRadiusMm, filletRadiusMm);
    if (!tangency) return { tangency: null, landHalfAngleRad: -Infinity };
    return { tangency, landHalfAngleRad: halfPitchAngleRad - Math.abs(tangency.centreAngleRad) };
  };

  if (!(requestedMm > 0)) {
    return { requestedMm: Math.max(0, Number(requestedMm) || 0), filletRadiusMm: 0, clampedMm: null, ...attempt(0) };
  }

  const asked = attempt(requestedMm);
  if (asked.landHalfAngleRad >= minimumLandAngle) {
    return { requestedMm, filletRadiusMm: requestedMm, clampedMm: null, ...asked };
  }

  let low = 0;
  let high = requestedMm;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (attempt(middle).landHalfAngleRad >= minimumLandAngle) low = middle;
    else high = middle;
  }
  return { requestedMm, filletRadiusMm: low, clampedMm: low, ...attempt(low) };
}

/* ------------------------------------------------------------------- geometry */

/**
 * Every derived number the generator, the inspector, the DFM rules and the pair
 * report read, computed once from a normalized spec.
 *
 * This is the single source of truth for gear geometry. A caller that recomputes a
 * radius from `toothCount * moduleMm / 2` has created a second source, which is the
 * defect the old `resize.js` tip diameter was.
 */
export function spurGearGeometry(gearInput, options = {}) {
  const gear = normalizeSpurGearSpec(gearInput);
  const rack = rackFor(gear);
  const toleranceMm = Number(options.toleranceMm ?? DEFAULT_CHORD_TOLERANCE_MM);

  const moduleMm = gear.moduleMm;
  const toothCount = gear.toothCount;
  const pitchAlpha = gear.pressureAngleDeg * DEG;
  const shift = gear.profileShiftCoefficient;

  const pitchRadiusMm = (toothCount * moduleMm) / 2;
  const baseRadiusMm = pitchRadiusMm * Math.cos(pitchAlpha);
  const nominalTipRadiusMm = pitchRadiusMm + moduleMm * (rack.addendumFactor + shift);
  const nominalRootRadiusMm = pitchRadiusMm - moduleMm * (rack.dedendumFactor - shift);
  const toothThicknessMm = referenceToothThicknessMm(gear);
  const toothHalfAngleRad = toothThicknessMm / (2 * pitchRadiusMm);
  const halfPitchAngleRad = Math.PI / toothCount;

  const flank = createFlank(baseRadiusMm, pitchAlpha, toothHalfAngleRad);
  const crossingRadiusMm = flankCrossingRadiusMm(baseRadiusMm, pitchAlpha, toothHalfAngleRad);
  const tipPointed = crossingRadiusMm != null && nominalTipRadiusMm > crossingRadiusMm;
  const tipRadiusMm = tipPointed ? crossingRadiusMm : nominalTipRadiusMm;
  const rootCrossingRadiusMm = spaceCrossingRadiusMm(
    baseRadiusMm,
    pitchAlpha,
    toothHalfAngleRad,
    halfPitchAngleRad
  );
  const rootPointed = rootCrossingRadiusMm != null && nominalRootRadiusMm < rootCrossingRadiusMm;
  const rootRadiusMm = rootPointed ? rootCrossingRadiusMm : nominalRootRadiusMm;

  const requestedFilletMm = (gear.rootFilletFactor ?? rack.filletRadiusFactor) * moduleMm;
  const fillet = rootRadiusMm > 0
    ? resolveRootFillet(flank, rootRadiusMm, tipRadiusMm, requestedFilletMm, halfPitchAngleRad)
    : { requestedMm: requestedFilletMm, filletRadiusMm: 0, clampedMm: null, tangency: null, landHalfAngleRad: 0 };

  const tipHalfAngleRad = snapLandAngle(flank.halfAngleAt(tipRadiusMm), halfPitchAngleRad);
  const rootLandHalfAngleRad = snapLandAngle(fillet.landHalfAngleRad, halfPitchAngleRad);
  const rootLandWidthMm = 2 * rootLandHalfAngleRad * rootRadiusMm;
  const tipLandWidthMm = 2 * tipHalfAngleRad * tipRadiusMm;

  // A helix is a twist of the transverse profile: over the face width the reference
  // cylinder advances `b tan(beta)` of arc, which is `b tan(beta) / r` of angle.
  const helixAngleRad = gear.helixAngleDeg * DEG;
  const twistAngleRad = pitchRadiusMm > 0
    ? (gear.thicknessMm * Math.tan(helixAngleRad)) / pitchRadiusMm
    : 0;
  const twistSteps = twistStepsForTolerance(twistAngleRad, tipRadiusMm, toleranceMm);

  const undercutLimitTeeth = undercutLimitToothCount({
    profileId: gear.rackProfileId,
    pressureAngleDeg: gear.pressureAngleDeg,
    profileShiftCoefficient: shift,
    filletRadiusFactor: gear.rootFilletFactor ?? rack.filletRadiusFactor
  });
  const minimumProfileShift = undercutLimitProfileShift({
    profileId: gear.rackProfileId,
    pressureAngleDeg: gear.pressureAngleDeg,
    toothCount,
    filletRadiusFactor: gear.rootFilletFactor ?? rack.filletRadiusFactor
  });

  return {
    gear,
    rack,
    toleranceMm,
    moduleMm,
    toothCount,
    pressureAngleDeg: gear.pressureAngleDeg,
    profileShiftCoefficient: shift,
    backlashMm: gear.backlashMm,
    pitchRadiusMm,
    baseRadiusMm,
    /** The root the generator builds, raised to the flank apex on a pointed root. */
    rootRadiusMm,
    /** The root the rack asks for, before any pointed-root clamp. */
    nominalRootRadiusMm,
    /** The tip the generator builds, which is the crossing radius on a pointed tooth. */
    tipRadiusMm,
    /** The tip the rack asks for, before any pointed-tooth clamp. */
    nominalTipRadiusMm,
    referenceToothThicknessMm: toothThicknessMm,
    toothHalfAngleRad,
    circularPitchMm: Math.PI * moduleMm,
    basePitchMm: Math.PI * moduleMm * Math.cos(pitchAlpha),
    addendumMm: nominalTipRadiusMm - pitchRadiusMm,
    dedendumMm: pitchRadiusMm - rootRadiusMm,
    rootFilletRadiusMm: fillet.filletRadiusMm,
    requestedRootFilletRadiusMm: fillet.requestedMm,
    /** Non-null when the requested fillet had to shrink to keep a root land. */
    rootFilletClampedMm: fillet.clampedMm,
    rootLandWidthMm,
    tipLandWidthMm,
    tipPointed,
    /** True when the flanks converge above the rack's root circle, leaving a V. */
    rootPointed,
    flankCrossingRadiusMm: crossingRadiusMm,
    rootCrossingRadiusMm,
    /** True when part of the flank lies inside the base circle and is radial, not involute. */
    hasSubBaseFlank: rootRadiusMm < baseRadiusMm,
    // ISO 53 fixes the profile angle at 20 degrees; profiles A-D differ in dedendum
    // and tip radius and never in the angle. The involute is exact at any angle this
    // page allows, but at anything other than 20 the *proportions* are a
    // generalisation of the standard rather than a quotation from it.
    //
    // `standards/gears.js` has always been able to say so. It is reported here
    // because this object is the one channel every consumer already reads - the
    // inspector, `gearPair.js` and the DFM rules all take their gear facts from it -
    // and an honesty flag that no consumer can reach is not honesty. The same reason
    // `resolveHole` carries `unverifiedDimensions` rather than leaving the caller to
    // ask the fastener table a second question.
    rackDeviatesFromStandard: basicRackDeviatesFromStandard(gear.pressureAngleDeg),
    undercut: undercutLimitTeeth != null && toothCount < undercutLimitTeeth,
    undercutLimitToothCount: undercutLimitTeeth,
    minimumProfileShiftCoefficient: minimumProfileShift,
    helixAngleDeg: gear.helixAngleDeg,
    helical: Math.abs(gear.helixAngleDeg) > 0,
    twistAngleRad,
    twistSteps,
    // Transverse values are what this page stores and draws; the normal plane values
    // are what a hob or a tooth-thickness gauge works in, so they are stated rather
    // than left for the reader to derive.
    normalModuleMm: moduleMm * Math.cos(helixAngleRad),
    normalPressureAngleDeg: Math.atan(Math.tan(pitchAlpha) * Math.cos(helixAngleRad)) / DEG,
    boreDiameterMm: gear.boreDiameterMm,
    thicknessMm: gear.thicknessMm,
    halfPitchAngleRad,
    // The two land half-angles the emitter uses, snapped so a pointed form is
    // pointed. `toothPoints` reads these rather than recomputing them, so the
    // reported land width and the emitted polygon cannot disagree.
    tipHalfAngleRad,
    rootLandHalfAngleRad,
    flank,
    fillet
  };
}

/** Twist step count from the same chord tolerance the 2D features use. */
function twistStepsForTolerance(twistAngleRad, radiusMm, toleranceMm) {
  const twist = Math.abs(Number(twistAngleRad));
  if (!(twist > 0)) return 1;
  const radius = Number(radiusMm);
  const tolerance = Number(toleranceMm);
  if (!(radius > 0) || !(tolerance > 0)) return 1;
  // A facet spanning `d` radians at radius r deviates by r(1 - cos(d/2)) ~ r d^2 / 8,
  // so holding the chord tolerance needs d <= sqrt(8 t / r) - the same sagitta
  // relation `circleSegmentsForRadius` inverts for a circle.
  const maxStepRad = Math.sqrt((8 * tolerance) / radius);
  return Math.min(MAX_TWIST_STEPS, Math.max(1, Math.ceil(twist / maxStepRad)));
}

/* --------------------------------------------------------------- tessellation */

function chordDeviation(a, b, m) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (!(lengthSq > 0)) return Math.hypot(m[0] - a[0], m[1] - a[1]);
  const t = clamp(((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / lengthSq, 0, 1);
  return Math.hypot(m[0] - (a[0] + t * dx), m[1] - (a[1] + t * dy));
}

function subdivideSpan(pointAt, from, to, out, toleranceMm, depth) {
  const middle = (from + to) / 2;
  const start = pointAt(from);
  const end = pointAt(to);
  const mid = pointAt(middle);
  if (depth <= 0 || chordDeviation(start, end, mid) <= toleranceMm) return;
  subdivideSpan(pointAt, from, middle, out, toleranceMm, depth - 1);
  out.push(mid);
  subdivideSpan(pointAt, middle, to, out, toleranceMm, depth - 1);
}

/**
 * Points along a curve, spaced so no chord departs from it by more than the
 * tolerance. Includes the start and excludes the end, so spans concatenate without
 * duplicating a vertex.
 *
 * This is the involute's answer to `circleSegmentsForRadius`. It lives here rather
 * than in `tessellation.js` because it has exactly one caller; the moment a second
 * curved feature needs it, that is its home.
 */
function sampleCurve(pointAt, from, to, toleranceMm) {
  const points = [];
  const step = (to - from) / INITIAL_FLANK_SPANS;
  for (let index = 0; index < INITIAL_FLANK_SPANS; index += 1) {
    const spanStart = from + step * index;
    const spanEnd = index === INITIAL_FLANK_SPANS - 1 ? to : from + step * (index + 1);
    points.push(pointAt(spanStart));
    subdivideSpan(pointAt, spanStart, spanEnd, points, toleranceMm, MAX_FLANK_SUBDIVISION_DEPTH);
  }
  return points;
}

/**
 * Arc points at a radius, start included and end excluded, from the chord tolerance.
 *
 * `options.even` forces an even segment count, which puts a vertex exactly at the
 * arc's midpoint. For the tip and root lands - both symmetric about a tooth's
 * centreline - that is what makes the gear's outside and root diameters come out at
 * their nominal values instead of a chord's width under them. It is the same reason
 * `circleSegmentsForRadius` quantizes to a multiple of four: an inscribed polygon is
 * only the right size where it has a vertex.
 */
function sampleArc(centreX, centreY, radiusMm, fromAngleRad, toAngleRad, toleranceMm, options = {}) {
  const fullSegments = circleSegmentsForRadius(radiusMm, { toleranceMm });
  const sweep = toAngleRad - fromAngleRad;
  let count = Math.max(1, Math.ceil(Math.abs(sweep) / ((2 * Math.PI) / fullSegments)));
  if (options.even && count % 2 !== 0) count += 1;
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const angle = fromAngleRad + (sweep * index) / count;
    points.push([centreX + radiusMm * Math.cos(angle), centreY + radiusMm * Math.sin(angle)]);
  }
  return points;
}

/** The shortest signed sweep from one bearing to another. */
function shortestSweep(fromAngleRad, toAngleRad) {
  let delta = (toAngleRad - fromAngleRad) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function rotatePoints(points, angleRad) {
  if (!angleRad) return points;
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return points.map(([x, y]) => [x * cosine - y * sine, x * sine + y * cosine]);
}

/**
 * One tooth and the root land that follows it, in increasing angle, with the tooth
 * centred on zero.
 *
 * The boundary is built as one chain up the right-hand side - root fillet, then
 * flank, ending on the tip circle - and the left-hand side is that chain mirrored
 * and reversed. A gear tooth is symmetric about its centreline, so generating the
 * left flank independently would be the same arithmetic typed twice and would let
 * the two halves drift apart under a future edit.
 *
 * Every vertex is emitted exactly once, so concatenating `z` rotated copies closes
 * the profile with no duplicate points and no gaps.
 */
function toothPoints(geometry) {
  const { flank, rootRadiusMm, tipRadiusMm, baseRadiusMm, toleranceMm, fillet } = geometry;
  const halfPitch = geometry.halfPitchAngleRad;
  const flankStartRadiusMm = fillet.tangency ? fillet.tangency.tangencyRadiusMm : rootRadiusMm;
  const tipHalfAngle = geometry.tipHalfAngleRad;

  // --- the right-hand chain, from the root circle to the tip circle inclusive
  const rightChain = [];

  if (fillet.tangency && fillet.filletRadiusMm > 0) {
    const { centreRadiusMm, centreAngleRad, flankBearingRad } = fillet.tangency;
    const centreX = centreRadiusMm * Math.cos(centreAngleRad);
    const centreY = centreRadiusMm * Math.sin(centreAngleRad);
    // The root-circle tangency lies on the ray through the fillet centre, on the
    // near side of it to the axis, which is the bearing `centreAngleRad + pi`.
    const fromBearing = centreAngleRad + Math.PI;
    const sweep = shortestSweep(fromBearing, flankBearingRad);
    rightChain.push(
      ...sampleArc(centreX, centreY, fillet.filletRadiusMm, fromBearing, fromBearing + sweep, toleranceMm)
    );
  }

  // The radial run inside the base circle is straight, so it is emitted as one
  // segment: that puts a vertex exactly on the base circle, where the curvature
  // jumps, instead of leaving the sampler to discover the corner.
  if (flankStartRadiusMm < baseRadiusMm && baseRadiusMm < tipRadiusMm) {
    rightChain.push(flank.pointAt(flankStartRadiusMm));
    rightChain.push(...sampleCurve((u) => flank.pointAt(u), baseRadiusMm, tipRadiusMm, toleranceMm));
  } else {
    rightChain.push(...sampleCurve((u) => flank.pointAt(u), flankStartRadiusMm, tipRadiusMm, toleranceMm));
  }
  rightChain.push(flank.pointAt(tipRadiusMm));

  const points = [...rightChain];

  // --- tip land, strictly between the two flanks' tip points
  if (tipHalfAngle > 0) {
    // Even count: a vertex sits on the tooth centreline, so the outside diameter is
    // the nominal one rather than a chord's width under it.
    const land = sampleArc(0, 0, tipRadiusMm, -tipHalfAngle, tipHalfAngle, toleranceMm, { even: true });
    points.push(...land.slice(1));
  }

  // --- the left-hand chain: the right one mirrored about the centreline and
  // reversed. On a pointed tooth the two chains share their tip point, and on a
  // pointed root this tooth's last point is the next tooth's first, so the shared
  // vertex is dropped at one end or the other rather than emitted twice.
  const landHalfAngle = geometry.rootLandHalfAngleRad;
  const leftChain = rightChain.map(([x, y]) => [x, -y]).reverse();
  const leftFrom = tipHalfAngle > 0 ? 0 : 1;
  const leftTo = landHalfAngle > 0 ? leftChain.length : leftChain.length - 1;
  points.push(...leftChain.slice(leftFrom, Math.max(leftFrom, leftTo)));

  // --- root land, from this tooth's left fillet across to the next tooth's right
  // fillet. It is centred on the mid-space by symmetry, which is why its bounds are
  // the half-pitch plus and minus the land's own half-angle.
  if (landHalfAngle > 0) {
    const land = sampleArc(
      0,
      0,
      rootRadiusMm,
      halfPitch - landHalfAngle,
      halfPitch + landHalfAngle,
      toleranceMm,
      { even: true }
    );
    points.push(...land.slice(1));
  }

  return points;
}

/**
 * The closed 2D profile of the gear, one flat list of `[x, z]` points.
 *
 * The count is a function of the chord tolerance and of nothing else, so halving the
 * tolerance raises it. No test may pin it: that is what the deleted 96-point
 * assertion did, and it is why a fixed segment count was possible in the first place.
 */
export function createSpurGearProfilePoints(gearInput, options = {}) {
  // `options.geometry` lets the compile path reuse the single geometry pass it has
  // already made rather than repeating the fillet solve.
  const geometry = options.geometry ?? spurGearGeometry(gearInput, options);
  const tooth = toothPoints(geometry);
  const points = [];
  for (let tooth_index = 0; tooth_index < geometry.toothCount; tooth_index += 1) {
    points.push(...rotatePoints(tooth, (2 * Math.PI * tooth_index) / geometry.toothCount));
  }
  return points;
}

/** Outside diameter of the gear the generator actually builds. */
export function spurGearTipDiameterMm(gearInput) {
  return 2 * spurGearGeometry(gearInput).tipRadiusMm;
}

/**
 * Module that gives a target outside diameter, keeping every other parameter.
 *
 * Every radius in the profile is proportional to the module at fixed tooth count,
 * pressure angle and shift - including the pointed-tooth crossing radius, whose
 * defining equation is scale-free - so this is an exact inversion rather than an
 * approximation, and `resize.js` needs no gear arithmetic of its own.
 */
export function spurGearModuleForTipDiameterMm(gearInput, targetDiameterMm) {
  const gear = normalizeSpurGearSpec(gearInput);
  const currentDiameterMm = spurGearTipDiameterMm(gear);
  const target = Number(targetDiameterMm);
  if (!(currentDiameterMm > 0) || !Number.isFinite(target) || target <= 0) return gear.moduleMm;
  return (gear.moduleMm * target) / currentDiameterMm;
}

export function compileSpurGearBodyToSolid(body, options = {}) {
  const geometry = spurGearGeometry(body.gear, options);
  let gear2d = polygon({ points: createSpurGearProfilePoints(geometry.gear, { geometry }) });

  if (geometry.boreDiameterMm > 0) {
    const boreRadiusMm = geometry.boreDiameterMm / 2;
    gear2d = subtract(
      gear2d,
      circle({
        radius: boreRadiusMm,
        segments: circleSegmentsForRadius(boreRadiusMm, { toleranceMm: geometry.toleranceMm })
      })
    );
  }

  const centeredSolid = extrudeLinear(
    {
      height: geometry.thicknessMm,
      twistAngle: geometry.twistAngleRad,
      twistSteps: geometry.twistSteps,
      repair: true
    },
    gear2d
  );
  return jscad.transforms.transform(
    [
      ...SKETCH_TO_PART_PLANE_MATRIX.slice(0, 12),
      0, -geometry.thicknessMm / 2, 0, 1
    ],
    centeredSolid
  );
}
