export const SKETCH_MOUSE_RESIZE_MIN_MM = 1;

export function sketchResizeAxes(handle) {
  const value = String(handle ?? "");
  return {
    x: value.includes("e") || value.includes("w"),
    z: value.includes("n") || value.includes("s")
  };
}

export function targetSizeFromSketchResize(point, drag, options = {}) {
  const minSizeMm = options.minSizeMm ?? SKETCH_MOUSE_RESIZE_MIN_MM;
  const target = [...drag.startSize];
  const axes = sketchResizeAxes(drag.handle);

  if (axes.x) {
    target[0] = Math.max(minSizeMm, Math.abs(Number(point.x) - drag.centerX) * 2);
  }
  if (axes.z) {
    target[2] = Math.max(minSizeMm, Math.abs(Number(point.z) - drag.centerZ) * 2);
  }

  if (options.uniform && (axes.x || axes.z)) {
    const factorX = axes.x ? target[0] / Math.max(drag.startSize[0], minSizeMm) : 0;
    const factorZ = axes.z ? target[2] / Math.max(drag.startSize[2], minSizeMm) : 0;
    const factor = axes.x && axes.z ? Math.max(factorX, factorZ) : (axes.x ? factorX : factorZ);
    target[0] = Math.max(minSizeMm, drag.startSize[0] * factor);
    target[2] = Math.max(minSizeMm, drag.startSize[2] * factor);
  }

  return target;
}

