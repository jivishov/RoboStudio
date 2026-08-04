import { PartCadCompileError, compilePartBodyToSolid } from "./cadCompile.js";
import { AdvancedCadBackendRequiredError } from "./advancedCadRecipe.js";
import { detectDisconnectedSolid } from "./connectivity.js";
import { detectHolePocketBreakthrough, detectRefusedHoles } from "./holes.js";
import { bodyGeometryProperties } from "./massProperties.js";
import { solidToMeshData } from "./meshConversion.js";
import { detectNonWatertightSolid, solidWatertightReport } from "./watertight.js";

export function serializeWorkerError(error, bodyId = null) {
  const message = error?.message ? String(error.message) : String(error ?? "Unknown CAD worker error.");
  const cause = error?.cause ?? null;
  const code = error?.code ?? cause?.code ?? (error instanceof AdvancedCadBackendRequiredError || cause instanceof AdvancedCadBackendRequiredError
    ? "advanced-cad-backend-required"
    : error instanceof PartCadCompileError
      ? "cad-compile-error"
      : "worker-error");
  return {
    bodyId: error?.bodyId ?? bodyId,
    code,
    message,
    issues: error?.issues?.length ? error.issues : cause?.issues ?? []
  };
}

/**
 * Compile one body to a preview mesh plus its analysis.
 *
 * `geometryProperties` is deliberately **density-free**: the worker states volume,
 * area, centroid and bounds, and the main thread multiplies by a material density.
 * That is what lets a material change update the printed mass with no recompile.
 *
 * `warnings` carries findings that describe the geometry without condemning it -
 * disconnected solids and surfaces that are not closed. They must never reach
 * `validateBody`, which is a hard compile gate at any severity. A body whose
 * surface is open still compiles, still previews, still hands off and still
 * exports DXF; only the mesh formats and the mesh volume depend on closure, and
 * both consult the report rather than the gate.
 *
 * The watertight report is computed once here and handed to the mass properties,
 * so a compile walks the solid's edges a single time.
 */
export function compileBodyToMeshResult(body, bodies) {
  const solid = compilePartBodyToSolid(body, { bodies });
  const meshData = solidToMeshData(solid);
  const warnings = [];
  const disconnected = detectDisconnectedSolid(solid, { path: `bodies.${body.id}` });
  if (disconnected) warnings.push(disconnected);

  // Hole findings ride here for the same reason the watertight one does: a hole
  // whose standard cannot be resolved, or a pocket deeper than the plate, is a
  // statement about the design and not a reason to refuse to build it.
  const refusedHoles = detectRefusedHoles(body.sketch, { path: `bodies.${body.id}.sketch.cutProfiles` });
  if (refusedHoles) warnings.push(refusedHoles);
  const breakthrough = detectHolePocketBreakthrough(body, { path: `bodies.${body.id}.sketch.cutProfiles` });
  if (breakthrough) warnings.push(breakthrough);

  let watertight = null;
  try {
    watertight = solidWatertightReport(solid);
  } catch {
    // A solid the check cannot walk is not proof of a leak, so nothing is claimed.
  }
  const notWatertight = detectNonWatertightSolid(solid, { path: `bodies.${body.id}`, report: watertight });
  if (notWatertight) warnings.push(notWatertight);

  return {
    bodyId: body.id,
    ...meshData,
    geometryProperties: bodyGeometryProperties(body, solid, { watertight: watertight?.watertight }),
    warnings
  };
}

/**
 * Compile the requested bodies against the whole body list.
 *
 * `options.compileBodyIds` narrows what is compiled without narrowing what is
 * available: boolean bodies resolve their operands from `bodies` regardless of
 * which subset is being rebuilt (`AGENTS.md:38`). Omitting it compiles everything.
 */
export function compileBodiesToMeshResults(bodies = [], options = {}) {
  const requestedIds = options.compileBodyIds ? new Set(options.compileBodyIds) : null;
  const results = [];
  const errors = [];
  const transfers = [];

  for (const body of bodies ?? []) {
    if (requestedIds && !requestedIds.has(body?.id)) continue;
    try {
      const result = compileBodyToMeshResult(body, bodies);
      transfers.push(result.vertices.buffer, result.normals.buffer);
      results.push(result);
    } catch (error) {
      errors.push(serializeWorkerError(error, body?.id ?? null));
    }
  }

  return { results, errors, transfers };
}
