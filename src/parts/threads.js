/**
 * Real ISO metric threads, generated in the browser.
 *
 * ## Why this is not in the build123d tier
 *
 * Cycle 10's plan of record put threads behind the local Python bridge, and left an
 * open question against it: `@jscad/modeling` exposes `extrusions.extrudeHelical`, so
 * threads might be browser-feasible after all, and the plan asked for that to be
 * settled by measurement before any thread geometry was committed to Python.
 *
 * It was, on the installed 2.13.0, and it holds. An ISO 68-1 profile for M8x1.25
 * sweeps to a closed solid; four turns span exactly `4 * 1.25 + 1.25 = 6.25 mm`
 * axially, which is right because the swept profile is itself one pitch tall;
 * `union` with a shank and `subtract` from a block both succeed. The booleans are the
 * part that mattered - a thread is only useful attached to a body - so threads are a
 * tier-two capability and ship to GitHub Pages like every other recipe operation.
 *
 * ## What this module does and does not own
 *
 * It owns the sweep. It authors **no dimension**: every diameter, flat and pitch
 * comes from `standards/threads.js` through `threadGeometry`, which in turn reads
 * `fasteners.js` for the coarse pitch rather than re-typing it. Nothing here contains
 * a coefficient like `0.6134`.
 *
 * ## Tessellation
 *
 * `extrudeHelical` takes a fixed `segmentsPerRotation`, which is precisely the
 * constant `AGENTS.md` forbids. It is therefore derived from the same chord tolerance
 * every other curve in this page uses, against the thread's major radius - the widest
 * facet on the part - exactly as cycle 07 derived involute sampling. No test may pin
 * the resulting polygon count.
 */

import jscad from "@jscad/modeling";
import { circleSegmentsForRadius } from "./tessellation.js";
import { threadGeometry, threadUnavailableReason } from "./standards/threads.js";

const { booleans, extrusions, primitives, transforms } = jscad;
const { intersect, union } = booleans;
const { extrudeHelical } = extrusions;
const { cylinder, polygon } = primitives;
const { rotateX, rotateY, translate } = transforms;

const TAU = Math.PI * 2;

/**
 * How far the trimming cylinder reaches past the major radius.
 *
 * It exists only to make the clip axial: the thread is trimmed to length by
 * intersecting with a cylinder taller than nothing and wider than everything, so the
 * radial boundary is never the clip's. One millimetre is arbitrary and safe because
 * the clip radius is never compared against anything.
 */
const CLIP_RADIAL_MARGIN_MM = 1;

export class ThreadUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ThreadUnavailableError";
    this.code = "thread-unavailable";
  }
}

/**
 * One turn of the ISO 68-1 profile, in the frame `extrudeHelical` expects: X is the
 * radius from the axis and Y is the axial offset.
 *
 * The profile spans a full pitch axially, from `-P/2` to `+P/2`, so consecutive turns
 * meet exactly at the minor radius and the swept rib closes against the core cylinder
 * with no sliver between them. The crest is flattened to ISO 68-1's `P/8`.
 *
 * The same profile serves both kinds. That is not a shortcut: the void of an internal
 * thread has the shape of the ridge of an external one, which is why the two mate at
 * all. What differs between them is the tolerance position, and that is applied to the
 * diameters in `standards/threads.js` before this ever runs.
 */
function threadTurnProfile(geometry) {
  const majorRadius = geometry.majorDiameterMm / 2;
  const minorRadius = geometry.minorDiameterMm / 2;
  const halfPitch = geometry.pitchMm / 2;
  const halfCrest = geometry.crestFlatMm / 2;

  return polygon({
    points: [
      [minorRadius, -halfPitch],
      [majorRadius, -halfCrest],
      [majorRadius, halfCrest],
      [minorRadius, halfPitch]
    ]
  });
}

function orientToAxis(solid, axis) {
  if (axis === "x") return rotateY(Math.PI / 2, solid);
  if (axis === "y") return rotateX(-Math.PI / 2, solid);
  return solid;
}

/**
 * The solid a thread operation contributes: a core cylinder at the minor diameter
 * with the helical rib swept onto it, trimmed to exactly `lengthMm`.
 *
 * The caller decides what to do with it. An external thread is added; an internal one
 * is subtracted, and subtracting this same solid from a block leaves a threaded hole
 * because the core is the tapping drill and the rib is the groove. One builder, two
 * modes, and the mating clearance comes from the tolerance position rather than from
 * a second shape.
 *
 * Trimming is an intersection with an over-wide cylinder rather than arithmetic on the
 * turn count, because `extrudeHelical`'s axial span is `turns * pitch + pitch` - the
 * swept profile is a pitch tall - and a caller who asked for 10 mm of thread should
 * get 10 mm rather than a number that depends on the pitch it was asked for.
 */
export function threadSolid(request = {}) {
  const reason = threadUnavailableReason(request);
  if (reason) throw new ThreadUnavailableError(reason);

  const geometry = threadGeometry(request);
  const lengthMm = Number(request.lengthMm);
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) {
    throw new ThreadUnavailableError("A thread needs a positive threaded length in millimetres.");
  }

  const majorRadius = geometry.majorDiameterMm / 2;
  const minorRadius = geometry.minorDiameterMm / 2;
  const segmentsPerRotation = circleSegmentsForRadius(majorRadius, {
    toleranceMm: request.toleranceMm
  });

  // One turn of headroom at each end, so the trim always cuts through full thread
  // rather than through the ramp at either end of the sweep.
  const turns = Math.ceil(lengthMm / geometry.pitchMm) + 2;
  const sweptLengthMm = turns * geometry.pitchMm;
  const rib = translate(
    [0, 0, -sweptLengthMm / 2],
    extrudeHelical(
      { angle: TAU * turns, pitch: geometry.pitchMm, segmentsPerRotation },
      threadTurnProfile(geometry)
    )
  );

  const core = cylinder({
    radius: minorRadius,
    height: sweptLengthMm + geometry.pitchMm,
    segments: circleSegmentsForRadius(minorRadius, { toleranceMm: request.toleranceMm })
  });

  const clip = cylinder({
    radius: majorRadius + CLIP_RADIAL_MARGIN_MM,
    height: lengthMm,
    segments: circleSegmentsForRadius(majorRadius + CLIP_RADIAL_MARGIN_MM, {
      toleranceMm: request.toleranceMm
    })
  });

  const trimmed = intersect(union(core, rib), clip);
  const oriented = orientToAxis(trimmed, request.axis ?? "z");
  const center = Array.isArray(request.center) ? request.center : [0, 0, 0];
  return translate(
    [Number(center[0]) || 0, Number(center[1]) || 0, Number(center[2]) || 0],
    oriented
  );
}

/**
 * What a thread operation will produce, without producing it.
 *
 * The inspector and the BOM both want the designation and the diameters, and neither
 * wants to pay for a helical sweep to get them. Returns `null` for a combination the
 * standards table refuses, so a caller can state the refusal rather than a shape.
 */
export function threadSummary(request = {}) {
  if (threadUnavailableReason(request)) return null;
  const geometry = threadGeometry(request);
  const lengthMm = Number(request.lengthMm);
  return {
    ...geometry,
    lengthMm: Number.isFinite(lengthMm) && lengthMm > 0 ? lengthMm : null,
    turns: Number.isFinite(lengthMm) && lengthMm > 0 ? lengthMm / geometry.pitchMm : null
  };
}
