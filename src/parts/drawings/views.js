/**
 * Orthographic views, derived from the sketch.
 *
 * ## Why not from the solid
 *
 * `extrusions.project` would give a silhouette and it takes a `geom3`, which **the main
 * thread never has**: `cadWorkerCore.js` converts the solid to a mesh, transfers the
 * vertex and normal buffers, and discards the solid inside the worker. Running it would
 * mean a new worker message and edits to `cadWorker.js`, `cadWorkerCore.js` and
 * `cadCompile.js` - the same wall cycle 04 hit, which is why `threeMf.js` welds vertices
 * from the mesh rather than re-serializing a solid.
 *
 * The resolution is better than the workaround. **A hole is a circle of its resolved
 * diameter, a rounded corner is an arc, and a dimension reads the number the designer
 * authored** rather than a measurement of a 32-sided approximation of it. A mesh-derived
 * view of an M3 clearance hole cannot produce 3.4; this one cannot produce anything else.
 *
 * That habit is worth stating because the mesh is right there, cached on the main thread,
 * and will look like the obvious source every time. It is not, and `dimensions.js`
 * inherits the same rule.
 *
 * ## Coordinates
 *
 * The sketch plane is X/Z with Y as thickness. A view emits **drawing** coordinates
 * `(u, v)` in millimetres with `v` increasing downward, which is SVG's convention, so a
 * renderer places a view with a translate and never with a flip nobody can see. The datum
 * is the **sketch origin** - the point every position in the project is already authored
 * against - and it is stated on every view rather than implied.
 *
 * ## No JSCAD, no DOM, no Node
 *
 * Asserted at source level by `tests/parts/drawings.test.js`. Four of the five stage-B
 * modules being JSCAD-free is a consequence of deriving from the sketch rather than a
 * coincidence, and it keeps these tests fast and the dependency surface honest.
 */

import { SKETCH_EXTRUDE_KIND } from "../contracts.js";
import { profileHoleResolution } from "../holes.js";

export const VIEW_TOP = "top";
export const VIEW_FRONT = "front";
export const VIEW_RIGHT = "right";
export const ORTHOGRAPHIC_VIEW_IDS = Object.freeze([VIEW_TOP, VIEW_FRONT, VIEW_RIGHT]);

/** The datum every position on a drawing is measured from. */
export const DRAWING_DATUM = Object.freeze({
  id: "sketch-origin",
  label: "Sketch origin",
  note: "Positions are measured from the sketch origin, which is where the project already authors them."
});

/** Line roles a renderer styles differently. Named, so no view invents a fourth. */
export const LINE_VISIBLE = "visible";
export const LINE_HIDDEN = "hidden";
export const LINE_CENTRE = "centre";

function bodyKind(body) {
  return body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
}

function extentsOf(entities) {
  const bounds = { minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity };
  const include = (u, v) => {
    bounds.minU = Math.min(bounds.minU, u);
    bounds.minV = Math.min(bounds.minV, v);
    bounds.maxU = Math.max(bounds.maxU, u);
    bounds.maxV = Math.max(bounds.maxV, v);
  };

  for (const entity of entities) {
    if (entity.kind === "circle") {
      include(entity.cu - entity.diameterMm / 2, entity.cv - entity.diameterMm / 2);
      include(entity.cu + entity.diameterMm / 2, entity.cv + entity.diameterMm / 2);
    } else if (entity.kind === "rect") {
      include(entity.cu - entity.widthMm / 2, entity.cv - entity.heightMm / 2);
      include(entity.cu + entity.widthMm / 2, entity.cv + entity.heightMm / 2);
    } else if (entity.kind === "slot") {
      include(entity.cu - entity.lengthMm / 2, entity.cv - entity.widthMm / 2);
      include(entity.cu + entity.lengthMm / 2, entity.cv + entity.widthMm / 2);
    } else if (entity.kind === "polyline") {
      for (const [u, v] of entity.points) include(u, v);
    } else if (entity.kind === "line") {
      include(entity.from[0], entity.from[1]);
      include(entity.to[0], entity.to[1]);
    }
  }
  if (!Number.isFinite(bounds.minU)) return { minU: 0, minV: 0, maxU: 0, maxV: 0, widthMm: 0, heightMm: 0 };
  return { ...bounds, widthMm: bounds.maxU - bounds.minU, heightMm: bounds.maxV - bounds.minV };
}

/**
 * One sketch profile as a view entity, in drawing coordinates.
 *
 * ⚠ A circle carries its **diameter**. A drawing dimensions a diameter, and carrying the
 * radius here would mean every consumer doubled it - which is one doubling away from a
 * drawing that says R3.4 where it means Ø3.4, and that is a hole drilled twice the size.
 */
function profileEntity(profile, role = LINE_VISIBLE) {
  const cu = Number(profile.x);
  const cv = -Number(profile.z);

  if (profile.type === "circle") {
    return { kind: "circle", id: profile.id, role, cu, cv, diameterMm: Number(profile.radius) * 2 };
  }
  if (profile.type === "rectangle") {
    return {
      kind: "rect",
      id: profile.id,
      role,
      cu,
      cv,
      widthMm: Number(profile.width),
      heightMm: Number(profile.height),
      cornerRadiusMm: Math.max(0, Number(profile.cornerRadius ?? 0))
    };
  }
  if (profile.type === "roundedSlot") {
    return {
      kind: "slot",
      id: profile.id,
      role,
      cu,
      cv,
      lengthMm: Number(profile.length),
      widthMm: Number(profile.width)
    };
  }
  if (profile.type === "polyline") {
    return {
      kind: "polyline",
      id: profile.id,
      role,
      closed: true,
      points: (profile.points ?? []).map((point) => [Number(point[0]), -Number(point[1])])
    };
  }
  return null;
}

/** The top view: the sketch itself, outer profile and every cut, exactly as drawn. */
function topView(body) {
  const entities = [];
  const outer = profileEntity(body.sketch.outerProfile);
  if (outer) entities.push(outer);
  for (const cut of body.sketch.cutProfiles ?? []) {
    const entity = profileEntity(cut);
    if (entity) entities.push(entity);
  }
  return { id: VIEW_TOP, label: "Top", available: true, reason: null, entities, extents: extentsOf(entities) };
}

/** How far a centre line reaches past the outline it marks. */
const CENTRE_LINE_OVERRUN_MM = 2;

/**
 * A projected view along one sketch axis.
 *
 * The outline is the sketch's own extent in that axis by the extrude depth, which is exact
 * - the body is a prism. Each cut contributes a **hidden** pair of lines at its own extent
 * and a **centre** line through it, which is what a section-free orthographic view of a
 * through feature actually shows. A blind pocket is deliberately not drawn: its depth is a
 * post-extrude cutter with no 2D contour, and inventing a hidden line at a guessed depth
 * would be a dimension nobody authored.
 *
 * ⚠ `thicknessOnU` decides which way the view lies on the paper, and it is what makes this
 * a **third-angle set** rather than three separate pictures. The front view puts the
 * sketch's `u` across the page and the thickness down it; the right view is the same
 * projection turned a quarter turn, thickness across and the sketch's `v` down - so it
 * sits beside the top view sharing its vertical extent while the front sits below it
 * sharing its horizontal one. Drawing both flat side by side, which the first version did,
 * looks tidy and means a reader cannot carry a dimension from one view to another.
 */
function projectedView(body, id, label, axis, thicknessOnU = false) {
  const top = topView(body);
  const depthMm = Number(body.extrudeDepthMm);
  const outer = top.extents;
  const acrossMin = axis === "u" ? outer.minU : outer.minV;
  const acrossMax = axis === "u" ? outer.maxU : outer.maxV;
  // One place decides the paper frame, so no branch below repeats the swap.
  const place = (across, through) => (thicknessOnU ? [through, across] : [across, through]);

  const entities = [
    {
      kind: "rect",
      id: `${id}_outline`,
      role: LINE_VISIBLE,
      cu: thicknessOnU ? depthMm / 2 : (acrossMin + acrossMax) / 2,
      cv: thicknessOnU ? (acrossMin + acrossMax) / 2 : depthMm / 2,
      widthMm: thicknessOnU ? depthMm : acrossMax - acrossMin,
      heightMm: thicknessOnU ? acrossMax - acrossMin : depthMm,
      cornerRadiusMm: 0
    }
  ];

  for (const cut of body.sketch.cutProfiles ?? []) {
    const entity = profileEntity(cut);
    if (!entity) continue;
    const span = entitySpan(entity, axis);
    if (!span) continue;
    // Two hidden lines through the full thickness: a through cut goes all the way, which is
    // the one thing a projected view of it can state without a section.
    for (const at of [span.min, span.max]) {
      entities.push({
        kind: "line",
        id: `${cut.id}_${at === span.min ? "a" : "b"}`,
        role: LINE_HIDDEN,
        from: place(at, 0),
        to: place(at, depthMm)
      });
    }
    entities.push({
      kind: "line",
      id: `${cut.id}_centre`,
      role: LINE_CENTRE,
      from: place((span.min + span.max) / 2, -CENTRE_LINE_OVERRUN_MM),
      to: place((span.min + span.max) / 2, depthMm + CENTRE_LINE_OVERRUN_MM)
    });
  }

  return { id, label, available: true, reason: null, entities, extents: extentsOf(entities) };
}

function entitySpan(entity, axis) {
  const bounds = extentsOf([entity]);
  return axis === "u" ? { min: bounds.minU, max: bounds.maxU } : { min: bounds.minV, max: bounds.maxV };
}

/**
 * Which cuts a drawing tags, in the order it tags them.
 *
 * Only cuts with a **resolved** hole get a tag, because a tag points at a hole table row
 * and a refused hole has no row - it produced no derived geometry either.
 */
export function taggedCuts(body) {
  const tags = [];
  for (const profile of body?.sketch?.cutProfiles ?? []) {
    const resolved = profileHoleResolution(profile);
    if (!resolved?.ok) continue;
    tags.push({ profileId: profile.id, tag: String.fromCharCode(65 + tags.length), resolved, profile });
  }
  return tags;
}

/**
 * Every orthographic view for a body, or one entry per view saying why there is none.
 *
 * ⚠ A non-sketch body gets **no dimensioned views**, stated explicitly and with the
 * reason - deliberately the same shape as `dfm-source-kind-unchecked`. It still gets an
 * isometric and its extents from `isometric.js`, because that path works from the triangle
 * soup the main thread already has. An honest gap beats an undimensioned view that reads
 * as a bug.
 */
export function bodyOrthographicViews(body) {
  const kind = bodyKind(body);
  if (kind !== SKETCH_EXTRUDE_KIND || !body?.sketch?.outerProfile) {
    const reason = kind !== SKETCH_EXTRUDE_KIND
      ? `Dimensioned views are derived from the 2D sketch, and a ${kind} body has none. `
        + "An isometric view and the overall extents are shown instead."
      : "This body has no outer profile, so there is no sketch to project.";
    return ORTHOGRAPHIC_VIEW_IDS.map((id) => ({
      id,
      label: id[0].toUpperCase() + id.slice(1),
      available: false,
      reason,
      entities: [],
      extents: null
    }));
  }

  return [
    topView(body),
    projectedView(body, VIEW_FRONT, "Front", "u"),
    projectedView(body, VIEW_RIGHT, "Right", "v", true)
  ];
}
