/**
 * ISO 53 basic rack tooth profiles for cylindrical involute gears.
 *
 * ## Why this is a standards module and not a process profile
 *
 * `src/parts/process.js` holds shop practice: a minimum wall is a property of the
 * machine and a user is expected to change it. The numbers below are the opposite
 * kind of number. They are the coefficients of the **basic rack** that defines a
 * gear tooth in ISO 53, they are quoted, and a gear cut against a rack with a
 * dedendum of 1.3 instead of 1.25 will not mesh with the rest of the world. So they
 * live beside `standards/fasteners.js`, whose numbers are quoted from ISO and DIN,
 * and they obey the same rule `AGENTS.md` states for that table: **standards-derived
 * geometry is never interpolated**. `basicRackProfile` returns `null` for a profile
 * this table does not hold rather than blending two rows.
 *
 * The alternative - putting the coefficients inline in `gears.js` - was rejected
 * for the reason cycle 05 gives for `holes.js` authoring no numbers: a generator
 * that carries its own standard cannot be audited against the standard, and a test
 * that asserts against a literal copied out of the generator proves only that the
 * literal was typed twice.
 *
 * ## What the coefficients mean
 *
 * All are multiples of the module `m`, measured from the rack's datum (pitch) line.
 * The rack is the tool; the gear is its complement, so the rack's addendum cuts the
 * gear's **root** and vice versa:
 *
 * | Coefficient | Symbol | On the rack | On the gear |
 * |---|---|---|---|
 * | `addendumFactor` | h_aP*  | rack dedendum, clearing the gear tip | tip radius = r + m(h_aP* + x) |
 * | `dedendumFactor` | h_fP*  | rack addendum, cutting the gear root | root radius = r - m(h_fP* - x) |
 * | `filletRadiusFactor` | rho_fP* | rack tip corner radius | root fillet radius |
 *
 * ## Confidence, and the one honest gap
 *
 * ISO 53 defines the basic rack **at a 20 degree profile angle**. That is the whole
 * table: profiles A through D differ in dedendum and tip radius, never in the angle.
 * This page lets `pressureAngleDeg` run from 10 to 35 because a designer printing a
 * pair of gears may legitimately want a 14.5 degree or a 25 degree tooth, and the
 * involute geometry is exact at any of them - but at any angle other than 20 the
 * proportions below are a **generalisation of the standard rather than a quotation
 * from it**, and `basicRackDeviatesFromStandard` says so rather than letting the
 * page imply an ISO tooth it is not making. Nothing is interpolated in either case:
 * the same quoted coefficients are used, and the departure is reported.
 *
 * The module is DOM-free, JSCAD-free and dependency-free.
 */

/** The profile angle at which ISO 53 defines every rack below. */
export const ISO_53_PROFILE_ANGLE_DEG = 20;

/** Profile A is the general-purpose row and the one this page defaults to. */
export const DEFAULT_BASIC_RACK_PROFILE_ID = "A";

const BASIC_RACKS = Object.freeze({
  A: Object.freeze({
    id: "A",
    label: "ISO 53 profile A",
    addendumFactor: 1,
    dedendumFactor: 1.25,
    filletRadiusFactor: 0.38,
    note: "General purpose. The largest tip radius of the 1.25 dedendum rows, so the strongest root."
  }),
  B: Object.freeze({
    id: "B",
    label: "ISO 53 profile B",
    addendumFactor: 1,
    dedendumFactor: 1.25,
    filletRadiusFactor: 0.3,
    note: "Same depth as A with a smaller tip radius, for tools that cannot hold A's corner."
  }),
  C: Object.freeze({
    id: "C",
    label: "ISO 53 profile C",
    addendumFactor: 1,
    dedendumFactor: 1.25,
    filletRadiusFactor: 0.25,
    note: "Smallest tip radius of the 1.25 dedendum rows; the weakest root of the three."
  }),
  D: Object.freeze({
    id: "D",
    label: "ISO 53 profile D",
    addendumFactor: 1,
    dedendumFactor: 1.4,
    filletRadiusFactor: 0.39,
    note: "Deeper root for a ground or shaved tooth, where the finishing tool needs clearance."
  })
});

export const BASIC_RACK_PROFILE_IDS = Object.freeze(Object.keys(BASIC_RACKS));

/** Every rack this table holds, for a picker. */
export function listBasicRackProfiles() {
  return BASIC_RACK_PROFILE_IDS.map((id) => BASIC_RACKS[id]);
}

/**
 * The named rack, or `null` for a profile this table does not hold.
 *
 * Null rather than a fallback, exactly like `getFastener`: a caller that wanted
 * profile E has said something this build cannot honour, and quietly handing back
 * profile A would put a tooth in the part the design never asked for. The
 * normalizer in `gears.js` is where a stored unknown id falls back, and it says so.
 */
export function basicRackProfile(id) {
  return BASIC_RACKS[id] ?? null;
}

/** Normalizer for a persisted rack profile id. */
export function normalizeBasicRackProfileId(value) {
  return Object.prototype.hasOwnProperty.call(BASIC_RACKS, value) ? value : DEFAULT_BASIC_RACK_PROFILE_ID;
}

/**
 * The rack's proportions in millimetres for a given module.
 *
 * Returns `null` for an unheld profile or an unusable module rather than guessing.
 */
export function basicRackProportionsMm(moduleMm, profileId = DEFAULT_BASIC_RACK_PROFILE_ID) {
  const rack = basicRackProfile(profileId);
  const module = Number(moduleMm);
  if (!rack || !Number.isFinite(module) || module <= 0) return null;
  return {
    profileId: rack.id,
    moduleMm: module,
    addendumMm: rack.addendumFactor * module,
    dedendumMm: rack.dedendumFactor * module,
    filletRadiusMm: rack.filletRadiusFactor * module,
    /** Circular pitch: the tooth-to-tooth distance along the rack's datum line. */
    circularPitchMm: Math.PI * module,
    /** Working depth of the mesh, the sum of the two addenda. */
    workingDepthMm: 2 * rack.addendumFactor * module,
    /** Bottom clearance between one gear's tip and the other's root. */
    bottomClearanceMm: (rack.dedendumFactor - rack.addendumFactor) * module
  };
}

/**
 * Whether a tooth cut at this pressure angle is still an ISO 53 tooth.
 *
 * ISO 53 fixes the profile angle at 20 degrees, so this is `true` for every other
 * angle. It exists so the page can report the departure instead of implying a
 * standard it has stepped outside of.
 */
export function basicRackDeviatesFromStandard(pressureAngleDeg) {
  const angle = Number(pressureAngleDeg);
  if (!Number.isFinite(angle)) return true;
  return Math.abs(angle - ISO_53_PROFILE_ANGLE_DEG) > 1e-9;
}

/**
 * Smallest tooth count that a rack cuts without undercutting the involute.
 *
 * Closed form, from the generating rack rather than from a table. The rack's
 * straight flank ends where its tip radius takes over, at a depth below the datum
 * line of `h_fP* - rho_fP*(1 - sin a)`. The involute the rack generates reaches
 * down to the interference point at a depth of `(z/2) sin^2 a + x`, so the tooth is
 * undercut when the straight flank reaches deeper than that:
 *
 *     h_fP* - rho_fP*(1 - sin a) - x > (z / 2) sin^2 a
 *
 * Rearranged for z, this is the value returned. It is not rounded: the caller
 * decides whether 17.1 means "17 undercuts" or "18 is the first safe count", and
 * rounding here would hide which side of the line a 17-tooth gear falls on.
 *
 * Sanity, and the reason this is trusted: profile A at 20 degrees with no profile
 * shift gives 2(1.25 - 0.38 x 0.658) / sin^2 20 = 17.1, the classical minimum for a
 * 20 degree full-depth tooth. The fillet term is what makes that number come out
 * right; dropping it gives 21.4, which is the answer to a different question.
 */
export function undercutLimitToothCount(options = {}) {
  const rack = basicRackProfile(normalizeBasicRackProfileId(options.profileId));
  const pressureAngleDeg = Number(options.pressureAngleDeg ?? ISO_53_PROFILE_ANGLE_DEG);
  const profileShift = Number(options.profileShiftCoefficient ?? 0);
  const filletRadiusFactor = Number(
    options.filletRadiusFactor ?? rack?.filletRadiusFactor ?? 0
  );
  if (!rack || !Number.isFinite(pressureAngleDeg) || !Number.isFinite(profileShift)) return null;
  if (!Number.isFinite(filletRadiusFactor) || filletRadiusFactor < 0) return null;

  const alpha = (pressureAngleDeg * Math.PI) / 180;
  const sine = Math.sin(alpha);
  if (!(sine > 0)) return null;

  const straightFlankDepth = rack.dedendumFactor - filletRadiusFactor * (1 - sine);
  return (2 * (straightFlankDepth - profileShift)) / (sine * sine);
}

/**
 * Smallest profile shift coefficient that avoids undercut at this tooth count.
 *
 * The same inequality solved for `x` instead of `z`. Negative means the gear is
 * already clear of undercut with no shift at all, and the magnitude is how much
 * negative shift is available before it undercuts.
 */
export function undercutLimitProfileShift(options = {}) {
  const toothCount = Number(options.toothCount);
  const limit = undercutLimitToothCount({ ...options, profileShiftCoefficient: 0 });
  if (limit == null || !Number.isFinite(toothCount)) return null;
  const alpha = (Number(options.pressureAngleDeg ?? ISO_53_PROFILE_ANGLE_DEG) * Math.PI) / 180;
  const sine = Math.sin(alpha);
  // limit = 2 * straightFlankDepth / sin^2 a, so straightFlankDepth = limit sin^2 a / 2
  // and x_min = straightFlankDepth - (z / 2) sin^2 a.
  return ((limit - toothCount) * sine * sine) / 2;
}

/**
 * The involute function, inv(a) = tan(a) - a.
 *
 * Published in every gear reference as a table; it is exact in closed form and is
 * the one piece of gear trigonometry both the generator and the pair report need,
 * so it is defined once, here, beside the standard that uses it.
 */
export function involuteAngle(angleRad) {
  const angle = Number(angleRad);
  if (!Number.isFinite(angle)) return null;
  return Math.tan(angle) - angle;
}

/**
 * Inverse of `involuteAngle`: the pressure angle whose involute function is `value`.
 *
 * Newton's method on tan(a) - a - value, whose derivative is tan^2(a). There is no
 * closed form, and the operating pressure angle of a shifted pair is defined by
 * exactly this inversion, so a solver is unavoidable. It converges in a handful of
 * iterations over the whole usable range and returns `null` rather than a
 * half-converged number if it does not.
 */
export function inverseInvoluteAngle(value, options = {}) {
  const target = Number(value);
  if (!Number.isFinite(target) || target < 0) return null;
  if (target === 0) return 0;

  const tolerance = Number(options.toleranceRad ?? 1e-12);
  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 60));
  // Cube-root seed: inv(a) ~ a^3 / 3 for small a, which is a good start well past
  // the angles gears are cut at.
  let angle = Math.cbrt(3 * target);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const tangent = Math.tan(angle);
    const residual = tangent - angle - target;
    if (Math.abs(residual) <= tolerance) return angle;
    const derivative = tangent * tangent;
    if (!(derivative > 0)) return null;
    const next = angle - residual / derivative;
    // The involute function is only defined below a quarter turn, where tan blows up.
    angle = Math.min(Math.max(next, 1e-12), Math.PI / 2 - 1e-9);
  }

  return Math.abs(Math.tan(angle) - angle - target) <= 1e-9 ? angle : null;
}
