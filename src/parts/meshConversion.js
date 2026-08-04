import jscad from "@jscad/modeling";

const { geom3 } = jscad.geometries;

// Exported so mass properties track bounds the same way the mesh path does rather
// than growing a second copy of the same three functions.
export function createBoundsTracker() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
}

export function includePoint(bounds, point) {
  for (let index = 0; index < 3; index += 1) {
    bounds.min[index] = Math.min(bounds.min[index], point[index]);
    bounds.max[index] = Math.max(bounds.max[index], point[index]);
  }
}

export function finalizeBounds(bounds) {
  if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0]
    };
  }

  const size = bounds.max.map((value, index) => value - bounds.min[index]);
  const center = bounds.min.map((value, index) => value + size[index] / 2);
  return { min: bounds.min, max: bounds.max, size, center };
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const normal = [
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return normal.map((value) => value / length);
}

function writeVertex(target, offset, point) {
  target[offset] = point[0];
  target[offset + 1] = point[1];
  target[offset + 2] = point[2];
}

export function solidToMeshData(solid) {
  const polygons = geom3.toPolygons(solid);
  const triangleCount = polygons.reduce(
    (count, polygon) => count + Math.max(0, polygon.vertices.length - 2),
    0
  );
  const vertices = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  const bounds = createBoundsTracker();
  let offset = 0;

  for (const polygon of polygons) {
    const sourceVertices = polygon.vertices;
    if (sourceVertices.length < 3) continue;

    for (let index = 1; index < sourceVertices.length - 1; index += 1) {
      const triangle = [sourceVertices[0], sourceVertices[index], sourceVertices[index + 1]];
      const normal = triangleNormal(triangle[0], triangle[1], triangle[2]);

      for (const point of triangle) {
        writeVertex(vertices, offset, point);
        writeVertex(normals, offset, normal);
        includePoint(bounds, point);
        offset += 3;
      }
    }
  }

  return {
    vertices,
    normals,
    triangleCount,
    bounds: finalizeBounds(bounds)
  };
}
