/**
 * What a drawing dimensions, per profile type.
 *
 * ## A table, not a solver
 *
 * Automatic dimension selection is an open problem for freeform geometry. It is not one
 * here, because **a profile in this page is already a dimension list**:
 * `createRectangleProfile({ width, height, cornerRadius })` carries exactly the three
 * dimensions a drawing of it would show. So this is a per-type table, and the table is
 * small.
 *
 * ## Nominal by contract
 *
 * A dimension is the number the designer authored, never a measurement of the compiled
 * mesh. That is what makes a drawing built now survive cycle 09's process compensation
 * **by construction rather than by luck**: the compiled solid stays nominal, the
 * compensated figures are a separate report, and a drawing that read the mesh would have
 * had to choose between them. It reads the sketch, so there is nothing to choose. Stated
 * here and in `AGENTS.md` so the boundary is on the record rather than rediscovered.
 *
 * ## Diameters, never radii
 *
 * A drawing dimensions a diameter. `views.js` already carries circles as diameters for the
 * same reason, and a test asserts no dimension of a circular feature is ever labelled `R`.
 */

import { DRAWING_DATUM, taggedCuts } from "./views.js";
import { SKETCH_EXTRUDE_KIND } from "../contracts.js";

/** Dimension kinds a renderer can draw. A fifth would need a renderer change, not a guess. */
export const DIMENSION_LINEAR = "linear";
export const DIMENSION_DIAMETER = "diameter";
export const DIMENSION_POSITION = "position";
/** A figure stated as text beside the view because it has no witness lines to hang on. */
export const DIMENSION_NOTE = "note";

function dimension(kind, label, valueMm, options = {}) {
  return {
    kind,
    label,
    valueMm: Number.isFinite(Number(valueMm)) ? Number(valueMm) : null,
    profileId: options.profileId ?? null,
    // Everything a drawing states is nominal. There is no second value here and there must
    // not be one: an as-made figure belongs to `bodyCompensationReport`, under its own
    // label, beside the nominal one.
    nominal: true,
    ...options
  };
}

/**
 * The dimensions one profile carries.
 *
 * `options.isCut` adds the position from the datum, because a cut's location is a
 * dimension and an outer profile's is not - the outer profile *is* the datum's frame.
 */
export function profileDimensions(profile, options = {}) {
  if (!profile) return [];
  const dimensions = [];
  const id = profile.id;

  if (profile.type === "rectangle") {
    dimensions.push(dimension(DIMENSION_LINEAR, "Width", profile.width, { profileId: id, axis: "u" }));
    dimensions.push(dimension(DIMENSION_LINEAR, "Height", profile.height, { profileId: id, axis: "v" }));
    // Only when it is non-zero: a drawing that states "R0" on every corner of every
    // rectangle is a drawing nobody reads.
    if (Number(profile.cornerRadius ?? 0) > 0) {
      dimensions.push(dimension(DIMENSION_NOTE, "Corner radius", profile.cornerRadius, { profileId: id, prefix: "R" }));
    }
  } else if (profile.type === "circle") {
    // ⚠ Diameter. Always. A circular cut labelled with its radius is a hole drilled at
    // twice the size by anyone who trusts the drawing.
    dimensions.push(dimension(DIMENSION_DIAMETER, "Diameter", Number(profile.radius) * 2, { profileId: id, prefix: "Ø" }));
  } else if (profile.type === "roundedSlot") {
    dimensions.push(dimension(DIMENSION_LINEAR, "Length", profile.length, { profileId: id, axis: "u" }));
    dimensions.push(dimension(DIMENSION_LINEAR, "Width", profile.width, { profileId: id, axis: "v" }));
    // Derived, and said so: the end radius is half the width by construction rather than a
    // number the author typed, so it is a note rather than a dimension with witness lines.
    dimensions.push(
      dimension(DIMENSION_NOTE, "End radius", Number(profile.width) / 2, { profileId: id, prefix: "R", derived: true })
    );
  } else if (profile.type === "polyline") {
    // ⚠ Vertex coordinates from the datum and **no derived lengths**. A polyline's edges
    // are implied by its vertices; dimensioning both would over-constrain the drawing, and
    // an over-constrained drawing is one a shop has to decide which half of to believe.
    (profile.points ?? []).forEach((point, index) => {
      dimensions.push(
        dimension(DIMENSION_POSITION, `Vertex ${index + 1}`, null, {
          profileId: id,
          uMm: Number(point[0]),
          vMm: Number(point[1]),
          datum: DRAWING_DATUM.id
        })
      );
    });
  }

  if (options.isCut) {
    dimensions.push(
      dimension(DIMENSION_POSITION, "Position", null, {
        profileId: id,
        uMm: Number(profile.x),
        vMm: Number(profile.z),
        datum: DRAWING_DATUM.id
      })
    );
  }
  return dimensions;
}

/**
 * Every dimension a body's drawing shows, plus the thickness.
 *
 * A tagged cut carries its tag, so a dimension and its hole-table row name the same
 * feature by the same letter.
 */
export function bodyDimensions(body) {
  const kind = body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
  if (kind !== SKETCH_EXTRUDE_KIND || !body?.sketch?.outerProfile) {
    return { available: false, reason: `A ${kind} body has no sketch to dimension.`, datum: DRAWING_DATUM, dimensions: [] };
  }

  const tagByProfileId = new Map(taggedCuts(body).map((entry) => [entry.profileId, entry.tag]));
  const dimensions = [
    ...profileDimensions(body.sketch.outerProfile),
    dimension(DIMENSION_LINEAR, "Thickness", body.extrudeDepthMm, { profileId: null, axis: "y" })
  ];

  for (const cut of body.sketch.cutProfiles ?? []) {
    for (const entry of profileDimensions(cut, { isCut: true })) {
      dimensions.push(tagByProfileId.has(cut.id) ? { ...entry, tag: tagByProfileId.get(cut.id) } : entry);
    }
  }

  return { available: true, reason: null, datum: DRAWING_DATUM, dimensions };
}

/** A dimension as the string a drawing prints. One place, so no view formats its own. */
export function formatDimension(entry) {
  if (entry.kind === DIMENSION_POSITION) {
    return `${entry.label} ${entry.uMm}, ${entry.vMm}`;
  }
  const prefix = entry.prefix ?? "";
  return entry.valueMm == null ? `${entry.label} -` : `${prefix}${Number(entry.valueMm.toFixed(3))}`;
}
