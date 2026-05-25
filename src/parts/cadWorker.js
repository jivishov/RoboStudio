import { PartCadCompileError, compilePartBodyToSolid } from "./cadCompile.js";
import { serializeBodyToStl, stlFileNameForBody } from "./exporters.js";
import { solidToMeshData } from "./meshConversion.js";

function serializeError(error, bodyId = null) {
  return {
    bodyId: error.bodyId ?? bodyId,
    code: error instanceof PartCadCompileError ? "cad-compile-error" : "worker-error",
    message: error.message,
    issues: error.issues ?? []
  };
}

function compileBody(body, bodies) {
  const solid = compilePartBodyToSolid(body, { bodies });
  const meshData = solidToMeshData(solid);
  return {
    bodyId: body.id,
    ...meshData,
    warnings: []
  };
}

function compileBodies(requestId, bodies) {
  const results = [];
  const errors = [];
  const transfers = [];

  for (const body of bodies ?? []) {
    try {
      const result = compileBody(body, bodies);
      transfers.push(result.vertices.buffer, result.normals.buffer);
      results.push(result);
    } catch (error) {
      errors.push(serializeError(error, body?.id ?? null));
    }
  }

  self.postMessage({ type: "compileBodiesResult", requestId, results, errors }, transfers);
}

function exportStl(requestId, body, bodies, options = {}) {
  try {
    const stl = serializeBodyToStl(body, { binary: false, bodies });
    self.postMessage({
      type: "exportStlResult",
      requestId,
      bodyId: body.id,
      fileName: stlFileNameForBody(body),
      stl
    });
  } catch (error) {
    self.postMessage({ type: "exportStlError", requestId, error: serializeError(error, body?.id ?? null) });
  }
}

self.addEventListener("message", (event) => {
  const { type, requestId, bodies, body, options } = event.data ?? {};

  if (type === "compileBodies") {
    compileBodies(requestId, bodies);
    return;
  }

  if (type === "exportStl") {
    exportStl(requestId, body, bodies, options);
  }
});
