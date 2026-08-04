/**
 * Disconnected-solid detection.
 *
 * This is a **report, not a gate**. `validateBody` refuses to compile a body whose
 * issue list is non-empty at any severity (`cadCompile.js:171`), so a finding
 * routed through it would block compile, export and handoff. A body that happens
 * to be two separate lumps is still a legal body - a bolt circle whose holes have
 * eaten the web between them is a real design the user may want to see and export -
 * so the finding travels with the compile result as a warning and nothing else.
 *
 * `booleans.scission` divides a geom3 into its connected components, so the count
 * of returned pieces is the answer directly.
 */

import jscad from "@jscad/modeling";
import { createIssue } from "./issues.js";

const { scission } = jscad.booleans;

export const DISCONNECTED_SOLID_CODE = "disconnected-solid";

/** Number of connected components in a compiled solid; 1 for a single lump. */
export function countSolidComponents(solid) {
  const pieces = scission(solid);
  if (Array.isArray(pieces)) return pieces.length;
  return pieces ? 1 : 0;
}

/**
 * Returns a warning-severity issue when a solid is more than one lump, or `null`.
 *
 * Never throws: a body that cannot be scissioned is reported as no finding rather
 * than failing the compile it is only annotating.
 */
export function detectDisconnectedSolid(solid, options = {}) {
  if (!solid) return null;

  let partCount = 1;
  try {
    partCount = countSolidComponents(solid);
  } catch {
    return null;
  }

  if (!Number.isFinite(partCount) || partCount <= 1) return null;

  return createIssue(
    DISCONNECTED_SOLID_CODE,
    `Body compiles to ${partCount} separate solids. Check whether cuts have split it.`,
    options.path ?? "body",
    "warning",
    { partCount }
  );
}
