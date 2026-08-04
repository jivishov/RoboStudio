/**
 * The hole table: one row per distinct hole, tagged the way the views tag them.
 *
 * ## Why the designation is read rather than written
 *
 * `describeHole` already produces the human-readable designation for a resolved hole, and
 * it is the same sentence the inspector and the status line show. Writing a second one
 * here would be two descriptions of one thing, which is the defect class this programme
 * exists to remove - and the second would be the one nobody updates when a style is added.
 *
 * Every number in a row comes from the **resolved** hole, so an M3 clearance row states
 * 3.4 because `standards/fasteners.js` says so, not because a radius happened to be 1.7.
 *
 * ## A refused hole has no row
 *
 * It produced no derived geometry either. A row for it would put a fastener on a drawing
 * whose hole is whatever radius the author last typed - which is precisely the situation
 * `holes.js` refuses to paper over.
 */

import { describeHole } from "../holes.js";
import { DRAWING_DATUM, taggedCuts } from "./views.js";

/**
 * Rows for a body's drawing, grouped by identical hole, in tag order.
 *
 * Grouping is on the resolved designation **and** the pilot diameter rather than on the
 * spec alone, so two holes that describe the same but resolved differently - which cannot
 * happen today and would be a `holes.js` defect if it did - would show as two rows rather
 * than silently merging into one.
 */
export function bodyHoleTable(body) {
  const rows = new Map();
  for (const entry of taggedCuts(body)) {
    const { resolved, profile, tag } = entry;
    const designation = describeHole(resolved.spec);
    const key = `${designation}|${resolved.pilotDiameterMm}`;
    const existing = rows.get(key);
    const position = { uMm: Number(profile.x), vMm: Number(profile.z), profileId: profile.id, tag };

    if (existing) {
      existing.quantity += 1;
      existing.positions.push(position);
      continue;
    }
    rows.set(key, {
      // The first tag wins, so the letters read A, B, C down the table.
      tag,
      designation,
      size: resolved.spec.size,
      style: resolved.spec.style,
      fit: resolved.spec.fit,
      fromFace: resolved.spec.fromFace,
      pilotDiameterMm: resolved.pilotDiameterMm,
      // A blind feature has no 2D contour, so it is stated as a note rather than drawn.
      pocket: resolved.pocket
        ? { shape: resolved.pocket.shape, style: resolved.pocket.style, depthMm: resolved.pocket.depthMm }
        : null,
      // Carried through rather than dropped: a dimension the table holds but flags as
      // unverified against a published standard is emitted labelled, never laundered.
      unverifiedDimensions: resolved.unverifiedDimensions ?? [],
      quantity: 1,
      positions: [position],
      datum: DRAWING_DATUM.id
    });
  }
  return [...rows.values()];
}

/** The note a pocket row carries, or `null`. One sentence, in one place. */
export function describePocketNote(row) {
  if (!row.pocket) return null;
  return `${row.pocket.style} ${Number(row.pocket.depthMm.toFixed(3))} mm deep from the ${row.fromFace} face; `
    + "milled, so it has no 2D contour and is not drawn as a second circle.";
}
