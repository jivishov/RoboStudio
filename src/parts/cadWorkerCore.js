import { PartCadCompileError, compilePartBodyToSolid } from "./cadCompile.js";
import { solidToMeshData } from "./meshConversion.js";

export function serializeWorkerError(error, bodyId = null) {
  const message = error?.message ? String(error.message) : String(error ?? "Unknown CAD worker error.");
  return {
    bodyId: error?.bodyId ?? bodyId,
    code: error instanceof PartCadCompileError ? "cad-compile-error" : "worker-error",
    message,
    issues: error?.issues ?? []
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
