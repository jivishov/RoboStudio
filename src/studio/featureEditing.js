import jscad from "@jscad/modeling";
import { solidToMeshData } from "../parts/meshConversion.js";

const { booleans, geometries, hulls, modifiers, primitives, transforms } = jscad;
const { subtract, union } = booleans;
const { geom3 } = geometries;
const { hull } = hulls;
const { cylinder, polyhedron } = primitives;
const { retessellate, snap } = modifiers;
const { rotateX, rotateY, translate } = transforms;

const AXIS_VECTORS = Object.freeze({
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1]
});

const AXIS_PLANES = Object.freeze({
  x: { uIndex: 1, vIndex: 2, u: [0, 1, 0], v: [0, 0, 1] },
  y: { uIndex: 0, vIndex: 2, u: [1, 0, 0], v: [0, 0, 1] },
  z: { uIndex: 0, vIndex: 1, u: [1, 0, 0], v: [0, 1, 0] }
});

const POINT_TOLERANCE = 1e-5;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteVector(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: 3 }, (_item, index) => finiteNumber(source[index], fallback[index] ?? 0));
}

function add(a, b) {
  return a.map((value, index) => value + b[index]);
}

function scale(vector, scalar) {
  return vector.map((value) => value * scalar);
}

function readTriangles(payload) {
  const positions = payload?.vertices ?? payload?.positions ?? payload?.position ?? payload?.attributes?.position?.array;
  if (!positions) return [];
  const indices = payload?.indices ?? payload?.index ?? payload?.index?.array ?? null;
  const triangles = [];
  if (indices?.length) {
    for (let offset = 0; offset < indices.length; offset += 3) {
      triangles.push([0, 1, 2].map((item) => {
        const index = Number(indices[offset + item]) * 3;
        return [positions[index], positions[index + 1], positions[index + 2]].map(finiteNumber);
      }));
    }
    return triangles;
  }
  for (let offset = 0; offset < positions.length; offset += 9) {
    triangles.push([
      [positions[offset], positions[offset + 1], positions[offset + 2]].map(finiteNumber),
      [positions[offset + 3], positions[offset + 4], positions[offset + 5]].map(finiteNumber),
      [positions[offset + 6], positions[offset + 7], positions[offset + 8]].map(finiteNumber)
    ]);
  }
  return triangles;
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

function meshDataFromVertices(vertices, method) {
  const outputVertices = new Float32Array(vertices);
  const normals = new Float32Array(outputVertices.length);
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };

  for (let offset = 0; offset < outputVertices.length; offset += 9) {
    const triangle = [
      [outputVertices[offset], outputVertices[offset + 1], outputVertices[offset + 2]],
      [outputVertices[offset + 3], outputVertices[offset + 4], outputVertices[offset + 5]],
      [outputVertices[offset + 6], outputVertices[offset + 7], outputVertices[offset + 8]]
    ];
    const normal = triangleNormal(triangle[0], triangle[1], triangle[2]);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const target = offset + vertex * 3;
      normals[target] = normal[0];
      normals[target + 1] = normal[1];
      normals[target + 2] = normal[2];
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], triangle[vertex][axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], triangle[vertex][axis]);
      }
    }
  }

  const size = bounds.min.map((value, index) => bounds.max[index] - value);
  const center = bounds.min.map((value, index) => value + size[index] / 2);
  return {
    vertices: outputVertices,
    normals,
    triangleCount: outputVertices.length / 9,
    bounds: { min: bounds.min, max: bounds.max, size, center },
    method
  };
}

function pointKey(point) {
  return point.map((value) => Math.round(value / POINT_TOLERANCE)).join(":");
}

export function meshPayloadToSolid(payload) {
  const triangles = readTriangles(payload);
  if (!triangles.length) throw new Error("Mesh payload has no triangles.");
  const points = [];
  const faces = [];
  const pointIndexByKey = new Map();
  for (const triangle of triangles) {
    const face = triangle.map((point) => {
      const key = pointKey(point);
      if (!pointIndexByKey.has(key)) {
        pointIndexByKey.set(key, points.length);
        points.push(point);
      }
      return pointIndexByKey.get(key);
    });
    if (new Set(face).size === 3) faces.push(face);
  }
  return polyhedron({ points, faces, orientation: "outward" });
}

function profileFromFeature(feature) {
  const source = feature?.edited ?? feature;
  return {
    type: source.type ?? feature.type,
    axis: source.axis ?? feature.axis ?? "y",
    center: finiteVector(source.center ?? feature.center),
    radiusMm: Math.max(0.001, finiteNumber(source.radiusMm ?? source.widthMm / 2 ?? feature.radiusMm, 1)),
    widthMm: Math.max(0.001, finiteNumber(source.widthMm ?? source.radiusMm * 2 ?? feature.widthMm, 2)),
    lengthMm: Math.max(0.001, finiteNumber(source.lengthMm ?? feature.lengthMm ?? source.radiusMm * 2, 2)),
    angleDeg: finiteNumber(source.angleDeg ?? feature.angleDeg, 0),
    depthMm: Math.max(0.001, finiteNumber(source.depthMm ?? feature.depthMm, 1))
  };
}

function cutterCylinder(center, axisVector, radius, depth) {
  let solid = cylinder({ radius, height: depth, segments: 64 });
  if (Math.abs(axisVector[0]) > 0) solid = rotateY(Math.PI / 2, solid);
  if (Math.abs(axisVector[1]) > 0) solid = rotateX(Math.PI / 2, solid);
  return translate(center, solid);
}

export function cutterSolidForFeature(feature, options = {}) {
  const profile = profileFromFeature(feature);
  const axisVector = AXIS_VECTORS[profile.axis] ?? AXIS_VECTORS.y;
  const plane = AXIS_PLANES[profile.axis] ?? AXIS_PLANES.y;
  const depth = profile.depthMm + Math.max(2, profile.depthMm * 0.2, finiteNumber(options.marginMm, 0));

  if (profile.type !== "roundedSlot") {
    return cutterCylinder(profile.center, axisVector, profile.radiusMm, depth);
  }

  const radius = Math.max(0.001, profile.widthMm / 2);
  const halfStraight = Math.max(0, profile.lengthMm / 2 - radius);
  const angle = (profile.angleDeg * Math.PI) / 180;
  const direction = add(scale(plane.u, Math.cos(angle)), scale(plane.v, Math.sin(angle)));
  if (halfStraight <= 1e-6) return cutterCylinder(profile.center, axisVector, radius, depth);

  return hull(
    cutterCylinder(add(profile.center, scale(direction, -halfStraight)), axisVector, radius, depth),
    cutterCylinder(add(profile.center, scale(direction, halfStraight)), axisVector, radius, depth)
  );
}

function slotSignedDistance(point, profile) {
  const radius = Math.max(0.001, profile.widthMm / 2);
  const halfStraight = Math.max(0, profile.lengthMm / 2 - radius);
  const along = Math.max(-halfStraight, Math.min(halfStraight, point[0]));
  return Math.hypot(point[0] - along, point[1]) - radius;
}

function slotBoundaryPointForRay(ray, profile) {
  let low = 0;
  let high = profile.lengthMm / 2 + profile.widthMm;
  for (let index = 0; index < 32; index += 1) {
    const mid = (low + high) / 2;
    const point = [ray[0] * mid, ray[1] * mid];
    if (slotSignedDistance(point, profile) <= 0) low = mid;
    else high = mid;
  }
  return [ray[0] * low, ray[1] * low];
}

function profileBasis(profile) {
  const angle = ((profile.angleDeg ?? 0) * Math.PI) / 180;
  return {
    major: [Math.cos(angle), Math.sin(angle)],
    minor: [-Math.sin(angle), Math.cos(angle)]
  };
}

function localSlotPoint(point, profile) {
  const basis = profileBasis(profile);
  return [
    point[0] * basis.major[0] + point[1] * basis.major[1],
    point[0] * basis.minor[0] + point[1] * basis.minor[1]
  ];
}

function globalSlotPoint(point, profile) {
  const basis = profileBasis(profile);
  return [
    point[0] * basis.major[0] + point[1] * basis.minor[0],
    point[0] * basis.major[1] + point[1] * basis.minor[1]
  ];
}

function boundaryPointForProfile(profile, ray) {
  if (profile.type !== "roundedSlot") {
    return [ray[0] * profile.radiusMm, ray[1] * profile.radiusMm];
  }

  const basis = profileBasis(profile);
  const localRay = [
    ray[0] * basis.major[0] + ray[1] * basis.major[1],
    ray[0] * basis.minor[0] + ray[1] * basis.minor[1]
  ];
  const localLength = Math.hypot(localRay[0], localRay[1]) || 1;
  return globalSlotPoint(slotBoundaryPointForRay([localRay[0] / localLength, localRay[1] / localLength], profile), profile);
}

function boundaryDistance(point, profile) {
  if (profile.type !== "roundedSlot") return Math.abs(Math.hypot(point[0], point[1]) - profile.radiusMm);
  return Math.abs(slotSignedDistance(localSlotPoint(point, profile), profile));
}

export function deformFeatureInMesh(payload, originalFeature, editedFeature) {
  const original = profileFromFeature(originalFeature.original ?? originalFeature);
  const edited = profileFromFeature(editedFeature);
  const positions = payload?.vertices ?? payload?.positions ?? payload?.position ?? payload?.attributes?.position?.array;
  if (!positions?.length) throw new Error("Mesh payload has no vertices.");
  if (original.axis !== edited.axis) throw new Error("Feature axis changes are not supported by mesh deformation.");

  const plane = AXIS_PLANES[original.axis] ?? AXIS_PLANES.y;
  const axisIndex = original.axis === "x" ? 0 : original.axis === "z" ? 2 : 1;
  const tolerance = Math.max(0.12, original.radiusMm * 0.12, (original.widthMm ?? 0) * 0.06);
  const axisHalfDepth = original.depthMm / 2 + tolerance;
  const vertices = Array.from(positions, (value) => Number(value));
  let moved = 0;

  for (let offset = 0; offset < vertices.length; offset += 3) {
    const axisDelta = vertices[offset + axisIndex] - original.center[axisIndex];
    if (Math.abs(axisDelta) > axisHalfDepth) continue;

    const point = [
      vertices[offset + plane.uIndex] - original.center[plane.uIndex],
      vertices[offset + plane.vIndex] - original.center[plane.vIndex]
    ];
    if (boundaryDistance(point, original) > tolerance) continue;

    const angle = Math.atan2(point[1], point[0]);
    const ray = [Math.cos(angle), Math.sin(angle)];
    const boundary = boundaryPointForProfile(edited, ray);
    vertices[offset + plane.uIndex] = edited.center[plane.uIndex] + boundary[0];
    vertices[offset + plane.vIndex] = edited.center[plane.vIndex] + boundary[1];
    moved += 1;
  }

  if (!moved) throw new Error("No editable vertices were found for the selected feature.");
  return meshDataFromVertices(vertices, "mesh-deform");
}

export function applyFeatureEditToMesh(payload, originalFeature, editedFeature) {
  try {
    const sourceSolid = meshPayloadToSolid(payload);
    const oldCutter = cutterSolidForFeature(originalFeature.original ?? originalFeature);
    const newCutter = cutterSolidForFeature(editedFeature);
    const result = retessellate(snap(subtract(union(sourceSolid, oldCutter), newCutter)));
    geom3.validate(result);
    return { ...solidToMeshData(result), method: "csg" };
  } catch (_error) {
    return deformFeatureInMesh(payload, originalFeature, editedFeature);
  }
}

export function applyFeatureEditsToMesh(payload, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error("No feature edits were provided.");
  return edits.reduce((mesh, edit) => {
    if (!edit?.originalFeature || !edit?.editedFeature) throw new Error("Feature edit is missing source or target geometry.");
    return applyFeatureEditToMesh(mesh, edit.originalFeature, edit.editedFeature);
  }, payload);
}

export function featureWithMovedCenter(feature, delta) {
  const move = finiteVector(delta);
  return {
    ...feature,
    center: finiteVector(feature.center).map((value, index) => value + move[index])
  };
}
