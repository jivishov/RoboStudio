import { applyFeatureEditToMesh, applyFeatureEditsToMesh } from "./featureEditing.js";
import { detectMeshFeatures } from "./featureDetection.js";

function transferablesForMesh(mesh) {
  return [mesh.vertices?.buffer, mesh.normals?.buffer].filter(Boolean);
}

self.addEventListener("message", (event) => {
  const { requestId, type, payload } = event.data ?? {};
  try {
    if (type === "detectFeatures") {
      self.postMessage({
        requestId,
        ok: true,
        type,
        features: detectMeshFeatures(payload.geometry, { partId: payload.partId })
      });
      return;
    }

    if (type === "applyFeatureEdit") {
      const mesh = applyFeatureEditToMesh(payload.geometry, payload.originalFeature, payload.editedFeature);
      self.postMessage({ requestId, ok: true, type, mesh }, transferablesForMesh(mesh));
      return;
    }

    if (type === "applyFeatureEdits") {
      const mesh = applyFeatureEditsToMesh(payload.geometry, payload.edits);
      self.postMessage({ requestId, ok: true, type, mesh }, transferablesForMesh(mesh));
      return;
    }

    throw new Error(`Unknown feature worker request: ${type}`);
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      type,
      error: {
        message: error?.message ?? "Feature worker failed."
      }
    });
  }
});
