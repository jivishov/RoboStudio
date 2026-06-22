import { advancedCadRecipeNeedsBackend } from "./advancedCadRecipe.js";
import { compileBodyToMeshResult, serializeWorkerError } from "./cadWorkerCore.js";
import { ADVANCED_CAD_RECIPE_KIND } from "./contracts.js";

function bodyNeedsAdvancedBackend(body) {
  return body?.source?.kind === ADVANCED_CAD_RECIPE_KIND && advancedCadRecipeNeedsBackend(body.advancedCadRecipe);
}

function meshFromBackendResult(body, mesh) {
  const vertices = new Float32Array(mesh?.vertices ?? []);
  const normals = new Float32Array(mesh?.normals ?? []);
  return {
    bodyId: body.id,
    vertices,
    normals,
    triangleCount: Number(mesh?.triangleCount ?? vertices.length / 9),
    bounds: mesh?.bounds ?? {},
    warnings: []
  };
}

async function compileBodyWithAdvancedBackend(body) {
  const response = await fetch("/api/cad/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      body,
      includeMesh: true,
      includeStep: false,
      includeStl: false
    })
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = { ok: false, message: "Advanced CAD backend did not return JSON." };
  }
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.message ?? "Advanced CAD backend is unavailable.");
    error.code = result?.code ?? "advanced-cad-backend-unavailable";
    throw error;
  }
  return meshFromBackendResult(body, result.mesh);
}

async function compileBodies(requestId, bodies = []) {
  const results = [];
  const errors = [];
  const transfers = [];

  for (const body of bodies ?? []) {
    try {
      const result = bodyNeedsAdvancedBackend(body)
        ? await compileBodyWithAdvancedBackend(body)
        : compileBodyToMeshResult(body, bodies);
      transfers.push(result.vertices.buffer, result.normals.buffer);
      results.push(result);
    } catch (error) {
      errors.push(serializeWorkerError(error, body?.id ?? null));
    }
  }

  postWorkerMessage(
    { type: "compileBodiesResult", requestId, results, errors },
    transfers,
    (error) => ({
      type: "compileBodiesResult",
      requestId,
      results: [],
      errors: [serializeWorkerError(error)]
    })
  );
}

function postWorkerMessage(message, transfers = [], fallbackMessage) {
  try {
    self.postMessage(message, transfers);
    return;
  } catch (transferError) {
    if (!transfers.length) throw transferError;
  }

  try {
    self.postMessage(message);
    return;
  } catch (cloneError) {
    if (!fallbackMessage) throw cloneError;
    self.postMessage(fallbackMessage(cloneError));
  }
}

async function exportStl(requestId, body, bodies, options = {}) {
  try {
    const { serializeBodyToStl, stlFileNameForBody } = await import("./exporters.js");
    let stl = null;
    if (bodyNeedsAdvancedBackend(body)) {
      const response = await fetch("/api/cad/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          includeMesh: false,
          includeStep: false,
          includeStl: true
        })
      });
      let result = null;
      try {
        result = await response.json();
      } catch {
        result = { ok: false, message: "Advanced CAD backend did not return JSON." };
      }
      if (!response.ok || !result?.ok) {
        const error = new Error(result?.message ?? "Advanced CAD backend is unavailable.");
        error.code = result?.code ?? "advanced-cad-backend-unavailable";
        throw error;
      }
      stl = result.stl;
    } else {
      stl = serializeBodyToStl(body, { binary: false, bodies });
    }
    self.postMessage({
      type: "exportStlResult",
      requestId,
      bodyId: body.id,
      fileName: stlFileNameForBody(body),
      stl
    });
  } catch (error) {
    self.postMessage({ type: "exportStlError", requestId, error: serializeWorkerError(error, body?.id ?? null) });
  }
}

self.addEventListener("message", (event) => {
  const { type, requestId, bodies, body, options } = event.data ?? {};

  if (type === "compileBodies") {
    void compileBodies(requestId, bodies);
    return;
  }

  if (type === "exportStl") {
    void exportStl(requestId, body, bodies, options);
  }
});
