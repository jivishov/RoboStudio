import { advancedCadRecipeNeedsBackend } from "./advancedCadRecipe.js";
import { exactBodyCompileRequest } from "./backendPayload.js";
import { CAD_COMPILE_URL } from "./cadBackend.js";
import { compileBodyToMeshResult, serializeWorkerError } from "./cadWorkerCore.js";
import { ADVANCED_CAD_RECIPE_KIND } from "./contracts.js";
import { triangleSoupMassProperties } from "./massProperties.js";
import { nonWatertightIssue, triangleSoupWatertightReport } from "./watertight.js";

function bodyNeedsAdvancedBackend(body) {
  return body?.source?.kind === ADVANCED_CAD_RECIPE_KIND && advancedCadRecipeNeedsBackend(body.advancedCadRecipe);
}

function meshFromBackendResult(body, mesh) {
  const vertices = new Float32Array(mesh?.vertices ?? []);
  const normals = new Float32Array(mesh?.normals ?? []);
  const triangleCount = Number(mesh?.triangleCount ?? vertices.length / 9);
  // The backend's mesh was built somewhere this thread cannot inspect, so its
  // closure is checked here rather than assumed - the divergence theorem would
  // otherwise state a volume for an open surface.
  const watertight = triangleSoupWatertightReport(vertices, triangleCount);
  const notWatertight = nonWatertightIssue(watertight, { path: `bodies.${body.id}` });
  return {
    bodyId: body.id,
    vertices,
    normals,
    triangleCount,
    bounds: mesh?.bounds ?? {},
    // The backend hands back a mesh and no solid, so the triangle-soup path is the
    // only one available here. Still density-free, like every other compile path.
    geometryProperties: triangleSoupMassProperties(vertices, triangleCount, { watertight: watertight.watertight }),
    warnings: notWatertight ? [notWatertight] : []
  };
}

/**
 * One POST, one payload shape, one error convention.
 *
 * ⚠ This worker calls the bridge, which reads oddly beside the rule that export-only
 * dependencies stay out of `cadWorker.js`. That rule is about **bundled weight** - Vite
 * inlines a module worker's dynamic imports, so a serializer reachable from here runs at
 * worker startup - and a `fetch` carries none. `backendPayload.js` reaches only modules
 * `cadWorkerCore.js` already pulls in through `cadCompile.js`, so it adds no startup cost
 * either. What must never move here is the decision: the worker asks for a mesh it was
 * told to build and never decides that a backend exists.
 */
async function postCompileRequest(payload) {
  const response = await fetch(CAD_COMPILE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
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
  return result;
}

async function compileBodyWithAdvancedBackend(body, bodies) {
  const result = await postCompileRequest(
    exactBodyCompileRequest(body, { bodies, includeStep: false, includeStl: false, includeMesh: true })
  );
  return meshFromBackendResult(body, result.mesh);
}

async function compileBodies(requestId, bodies = [], compileBodyIds = null) {
  const results = [];
  const errors = [];
  const transfers = [];
  // Narrow what is rebuilt, never what is available: boolean operands are resolved
  // from the whole body list even when only one body is being recompiled.
  const requestedIds = compileBodyIds ? new Set(compileBodyIds) : null;

  for (const body of bodies ?? []) {
    if (requestedIds && !requestedIds.has(body?.id)) continue;
    try {
      const result = bodyNeedsAdvancedBackend(body)
        ? await compileBodyWithAdvancedBackend(body, bodies)
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

/**
 * ASCII STL for an advanced recipe body, which only the backend can compile.
 *
 * The backend returns text, so this route serves ASCII STL alone. Binary STL,
 * DXF and 3MF for a recipe body would need a solid on this thread, and the
 * export menu says so rather than offering a control that cannot work.
 */
async function backendAsciiStl(body, bodies) {
  const result = await postCompileRequest(
    exactBodyCompileRequest(body, { bodies, includeStep: false, includeStl: true, includeMesh: false })
  );
  return result.stl;
}

/**
 * Export one body to one format.
 *
 * One message type covers every browser-side format rather than four near-copies
 * of the same request and response pair. `exporters.js` is still dynamic-imported,
 * so the DXF, binary STL and 3MF writers and JSZip stay out of the preview
 * startup path (`AGENTS.md:48`).
 */
async function exportBody(requestId, body, bodies, formatId) {
  try {
    const { exportBodyToFormat, exportFileNameForBody, PartExportError } = await import("./exporters.js");
    const { EXPORT_FORMAT_ASCII_STL, exportFormat } = await import("./exportFormats.js");

    if (bodyNeedsAdvancedBackend(body)) {
      if (formatId !== EXPORT_FORMAT_ASCII_STL) {
        throw new PartExportError(
          `${exportFormat(formatId)?.label ?? formatId} export needs a browser-compiled solid, and this recipe body compiles only on the local CAD backend.`,
          "export-unavailable"
        );
      }
      self.postMessage({
        type: "exportBodyResult",
        requestId,
        bodyId: body.id,
        formatId,
        fileName: exportFileNameForBody(body, formatId),
        mimeType: exportFormat(formatId)?.mimeType ?? "model/stl",
        data: await backendAsciiStl(body, bodies),
        warnings: [],
        meta: {}
      });
      return;
    }

    const result = await exportBodyToFormat(body, formatId, { bodies });
    const transfers = result.data instanceof Uint8Array ? [result.data.buffer] : [];
    postWorkerMessage(
      {
        type: "exportBodyResult",
        requestId,
        bodyId: body.id,
        formatId: result.formatId,
        fileName: result.fileName,
        mimeType: result.mimeType,
        data: result.data,
        warnings: result.warnings,
        meta: result.meta
      },
      transfers,
      (error) => ({ type: "exportBodyError", requestId, error: serializeWorkerError(error, body?.id ?? null) })
    );
  } catch (error) {
    self.postMessage({ type: "exportBodyError", requestId, error: serializeWorkerError(error, body?.id ?? null) });
  }
}

self.addEventListener("message", (event) => {
  const { type, requestId, bodies, body, formatId, compileBodyIds } = event.data ?? {};

  if (type === "compileBodies") {
    void compileBodies(requestId, bodies, compileBodyIds ?? null);
    return;
  }

  if (type === "exportBody") {
    void exportBody(requestId, body, bodies, formatId);
  }
});
