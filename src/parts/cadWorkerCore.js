import { PartCadCompileError, compilePartBodyToSolid } from "./cadCompile.js";
import { AdvancedCadBackendRequiredError } from "./advancedCadRecipe.js";
import { solidToMeshData } from "./meshConversion.js";

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

export function compileBodyToMeshResult(body, bodies) {
  const solid = compilePartBodyToSolid(body, { bodies });
  const meshData = solidToMeshData(solid);
  return {
    bodyId: body.id,
    ...meshData,
    warnings: []
  };
}

export function compileBodiesToMeshResults(bodies = []) {
  const results = [];
  const errors = [];
  const transfers = [];

  for (const body of bodies ?? []) {
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
