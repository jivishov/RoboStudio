import { compileBodiesToMeshResults, serializeWorkerError } from "./cadWorkerCore.js";

function compileBodies(requestId, bodies) {
  const { results, errors, transfers } = compileBodiesToMeshResults(bodies);
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
    const stl = serializeBodyToStl(body, { binary: false, bodies });
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
    compileBodies(requestId, bodies);
    return;
  }

  if (type === "exportStl") {
    void exportStl(requestId, body, bodies, options);
  }
});
