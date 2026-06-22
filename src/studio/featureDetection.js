const AXES = Object.freeze([
  { name: "x", index: 0, u: 1, v: 2 },
  { name: "y", index: 1, u: 0, v: 2 },
  { name: "z", index: 2, u: 0, v: 1 }
]);

const DEFAULT_TOLERANCE = 1e-4;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function keyForPoint(point, tolerance = DEFAULT_TOLERANCE) {
  return point.map((value) => Math.round(value / tolerance)).join(":");
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function normalize(vector) {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  return magnitude > 0 ? vector.map((value) => value / magnitude) : [0, 0, 0];
}

function triangleNormal(a, b, c) {
  return normalize(cross(subtract(b, a), subtract(c, a)));
}

function readTriangles(payload) {
  const positions = payload?.vertices ?? payload?.positions ?? payload?.position ?? payload?.attributes?.position?.array;
  if (!positions) return [];
  const index = payload?.indices ?? payload?.index ?? payload?.index?.array ?? null;
  const triangles = [];

  if (index?.length) {
    for (let offset = 0; offset < index.length; offset += 3) {
      triangles.push([0, 1, 2].map((item) => {
        const vertexIndex = Number(index[offset + item]) * 3;
        return [
          finiteNumber(positions[vertexIndex]),
          finiteNumber(positions[vertexIndex + 1]),
          finiteNumber(positions[vertexIndex + 2])
        ];
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

export function meshPayloadFromBufferGeometry(geometry) {
  return {
    vertices: Array.from(geometry?.attributes?.position?.array ?? []),
    indices: geometry?.index?.array ? Array.from(geometry.index.array) : null
  };
}

function boundsForTriangles(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) {
    for (const point of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  const size = min.map((value, axis) => max[axis] - value);
  const center = min.map((value, axis) => value + size[axis] / 2);
  return { min, max, size, center };
}

function buildFaceGraph(triangles, tolerance) {
  const faces = triangles.map((points, index) => ({
    index,
    points,
    normal: triangleNormal(points[0], points[1], points[2])
  }));
  const edgeMap = new Map();

  for (const face of faces) {
    for (const [aIndex, bIndex] of [[0, 1], [1, 2], [2, 0]]) {
      const a = face.points[aIndex];
      const b = face.points[bIndex];
      const aKey = keyForPoint(a, tolerance);
      const bKey = keyForPoint(b, tolerance);
      const edgeKey = [aKey, bKey].sort().join("|");
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, { aKey, bKey, a, b, faces: [] });
      }
      edgeMap.get(edgeKey).faces.push(face.index);
    }
  }

  return { faces, edges: [...edgeMap.values()] };
}

function connectedEdgeComponents(edges) {
  const edgeIndicesByVertex = new Map();
  edges.forEach((edge, index) => {
    for (const key of [edge.aKey, edge.bKey]) {
      if (!edgeIndicesByVertex.has(key)) edgeIndicesByVertex.set(key, []);
      edgeIndicesByVertex.get(key).push(index);
    }
  });

  const visited = new Set();
  const components = [];
  for (let index = 0; index < edges.length; index += 1) {
    if (visited.has(index)) continue;
    const queue = [index];
    visited.add(index);
    const component = [];
    while (queue.length) {
      const current = queue.shift();
      const edge = edges[current];
      component.push(edge);
      for (const key of [edge.aKey, edge.bKey]) {
        for (const next of edgeIndicesByVertex.get(key) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
    }
    components.push(component);
  }
  return components;
}

function connectedFaceComponents(edges, acceptedFaceIndices) {
  const accepted = new Set(acceptedFaceIndices);
  const adjacency = new Map();
  for (const faceIndex of accepted) adjacency.set(faceIndex, new Set());
  for (const edge of edges) {
    const faces = edge.faces.filter((faceIndex) => accepted.has(faceIndex));
    if (faces.length < 2) continue;
    for (const face of faces) {
      const neighbors = adjacency.get(face);
      for (const other of faces) {
        if (other !== face) neighbors.add(other);
      }
    }
  }

  const visited = new Set();
  const components = [];
  for (const faceIndex of accepted) {
    if (visited.has(faceIndex)) continue;
    const queue = [faceIndex];
    visited.add(faceIndex);
    const component = [];
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function uniquePointsFromEdges(edges) {
  const points = new Map();
  for (const edge of edges) {
    points.set(edge.aKey, edge.a);
    points.set(edge.bKey, edge.b);
  }
  return [...points.values()];
}

function uniquePointsFromFaces(faces) {
  const points = new Map();
  for (const face of faces) {
    for (const point of face.points) {
      points.set(keyForPoint(point), point);
    }
  }
  return [...points.values()];
}

function projectedBounds(points) {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const point of points) {
    min[0] = Math.min(min[0], point[0]);
    min[1] = Math.min(min[1], point[1]);
    max[0] = Math.max(max[0], point[0]);
    max[1] = Math.max(max[1], point[1]);
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1]] };
}

function solve3x3(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let item = column; item < 4; item += 1) a[column][item] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let item = column; item < 4; item += 1) a[row][item] -= factor * a[column][item];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function fitCircle(points) {
  let sx = 0;
  let sy = 0;
  let sx2 = 0;
  let sy2 = 0;
  let sxy = 0;
  let sxr = 0;
  let syr = 0;
  let sr = 0;
  for (const [x, y] of points) {
    const r = x * x + y * y;
    sx += x;
    sy += y;
    sx2 += x * x;
    sy2 += y * y;
    sxy += x * y;
    sxr += x * r;
    syr += y * r;
    sr += r;
  }
  const solution = solve3x3(
    [
      [sx2, sxy, sx],
      [sxy, sy2, sy],
      [sx, sy, points.length]
    ],
    [-sxr, -syr, -sr]
  );
  if (!solution) return null;
  const [d, e, f] = solution;
  const center = [-d / 2, -e / 2];
  const radius = Math.sqrt(Math.max(0, (d * d + e * e) / 4 - f));
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const rms = Math.sqrt(
    points.reduce((sum, point) => sum + (Math.hypot(point[0] - center[0], point[1] - center[1]) - radius) ** 2, 0) /
      points.length
  );
  return { center, radius, residual: rms / radius };
}

function fitSlot(points) {
  const center = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length
  ];
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const x = point[0] - center[0];
    const y = point[1] - center[1];
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const major = [Math.cos(angle), Math.sin(angle)];
  const minor = [-major[1], major[0]];
  const local = points.map((point) => {
    const x = point[0] - center[0];
    const y = point[1] - center[1];
    return [x * major[0] + y * major[1], x * minor[0] + y * minor[1]];
  });
  const bounds = projectedBounds(local);
  const length = Math.max(bounds.size[0], bounds.size[1]);
  const width = Math.min(bounds.size[0], bounds.size[1]);
  const radius = width / 2;
  if (!Number.isFinite(radius) || radius <= 0 || length <= width * 1.15) return null;
  const halfStraight = Math.max(0, length / 2 - radius);
  const rms = Math.sqrt(
    local.reduce((sum, point) => {
      const along = Math.max(-halfStraight, Math.min(halfStraight, point[0]));
      return sum + (Math.hypot(point[0] - along, point[1]) - radius) ** 2;
    }, 0) / local.length
  );
  return {
    center,
    length,
    width,
    angleDeg: (angle * 180) / Math.PI,
    residual: rms / radius
  };
}

function touchesOuterProjectedBounds(loopBounds, wholeBounds, tolerance) {
  return (
    Math.abs(loopBounds.min[0] - wholeBounds.min[0]) <= tolerance ||
    Math.abs(loopBounds.min[1] - wholeBounds.min[1]) <= tolerance ||
    Math.abs(loopBounds.max[0] - wholeBounds.max[0]) <= tolerance ||
    Math.abs(loopBounds.max[1] - wholeBounds.max[1]) <= tolerance
  );
}

function candidateFromComponent(points3d, axis, bounds) {
  if (points3d.length < 8) return null;
  const projected = points3d.map((point) => [point[axis.u], point[axis.v]]);
  const loopBounds = projectedBounds(projected);
  const wholeProjectedBounds = {
    min: [bounds.min[axis.u], bounds.min[axis.v]],
    max: [bounds.max[axis.u], bounds.max[axis.v]]
  };
  const tolerance = Math.max(bounds.size[axis.u], bounds.size[axis.v], 1) * 0.015;
  if (touchesOuterProjectedBounds(loopBounds, wholeProjectedBounds, tolerance)) return null;

  const circle = fitCircle(projected);
  const slot = fitSlot(projected);
  const centerAxis = bounds.center[axis.index];
  const depthMm = Math.max(bounds.size[axis.index], 0.001);

  if (slot && slot.residual <= 0.16 && slot.length >= slot.width * 1.35 && (!circle || slot.residual <= circle.residual * 2.5)) {
    const center = [0, 0, 0];
    center[axis.index] = centerAxis;
    center[axis.u] = slot.center[0];
    center[axis.v] = slot.center[1];
    return {
      type: "roundedSlot",
      axis: axis.name,
      center,
      lengthMm: slot.length,
      widthMm: slot.width,
      radiusMm: slot.width / 2,
      angleDeg: slot.angleDeg,
      depthMm,
      residual: slot.residual,
      confidence: Math.max(0.3, Math.min(0.96, 1 - slot.residual * 5)),
      pointCount: points3d.length
    };
  }

  if (circle && circle.residual <= 0.08) {
    const center = [0, 0, 0];
    center[axis.index] = centerAxis;
    center[axis.u] = circle.center[0];
    center[axis.v] = circle.center[1];
    return {
      type: "circularHole",
      axis: axis.name,
      center,
      radiusMm: circle.radius,
      depthMm,
      residual: circle.residual,
      confidence: Math.max(0.35, Math.min(0.99, 1 - circle.residual * 8)),
      pointCount: points3d.length
    };
  }

  if (slot && slot.residual <= 0.16) {
    const center = [0, 0, 0];
    center[axis.index] = centerAxis;
    center[axis.u] = slot.center[0];
    center[axis.v] = slot.center[1];
    return {
      type: "roundedSlot",
      axis: axis.name,
      center,
      lengthMm: slot.length,
      widthMm: slot.width,
      radiusMm: slot.width / 2,
      angleDeg: slot.angleDeg,
      depthMm,
      residual: slot.residual,
      confidence: Math.max(0.3, Math.min(0.96, 1 - slot.residual * 5)),
      pointCount: points3d.length
    };
  }

  return null;
}

function similarCandidate(a, b) {
  if (a.type !== b.type || a.axis !== b.axis) return false;
  const centerDistance = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
  const size = a.radiusMm ?? a.widthMm / 2 ?? 1;
  if (centerDistance > Math.max(0.75, size * 0.22)) return false;
  if (a.type === "circularHole") return Math.abs(a.radiusMm - b.radiusMm) <= Math.max(0.5, size * 0.18);
  return (
    Math.abs(a.widthMm - b.widthMm) <= Math.max(0.6, a.widthMm * 0.18) &&
    Math.abs(a.lengthMm - b.lengthMm) <= Math.max(1, a.lengthMm * 0.18)
  );
}

function mergedCandidates(candidates) {
  const merged = [];
  for (const candidate of candidates) {
    const existing = merged.find((item) => similarCandidate(item, candidate));
    if (!existing) {
      merged.push({ ...candidate, sourceLoops: 1 });
      continue;
    }
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    existing.pointCount += candidate.pointCount;
    existing.sourceLoops += 1;
  }
  return merged;
}

function slotContainsCapCircle(slot, circle) {
  if (slot.axis !== circle.axis || circle.type !== "circularHole" || slot.type !== "roundedSlot") return false;
  const axis = AXES.find((item) => item.name === slot.axis) ?? AXES[1];
  const delta = [circle.center[axis.u] - slot.center[axis.u], circle.center[axis.v] - slot.center[axis.v]];
  const angle = ((slot.angleDeg ?? 0) * Math.PI) / 180;
  const major = [Math.cos(angle), Math.sin(angle)];
  const minor = [-major[1], major[0]];
  const along = delta[0] * major[0] + delta[1] * major[1];
  const across = delta[0] * minor[0] + delta[1] * minor[1];
  const radius = slot.widthMm / 2;
  const halfStraight = Math.max(0, slot.lengthMm / 2 - radius);
  return (
    Math.abs(Math.abs(along) - halfStraight) <= Math.max(0.8, radius * 0.45) &&
    Math.abs(across) <= Math.max(0.8, radius * 0.45) &&
    Math.abs(circle.radiusMm - radius) <= Math.max(0.5, radius * 0.25)
  );
}

function removeSlotCapDuplicates(candidates) {
  const slots = candidates.filter((candidate) => candidate.type === "roundedSlot");
  if (!slots.length) return candidates;
  return candidates.filter((candidate) => !slots.some((slot) => slotContainsCapCircle(slot, candidate)));
}

function addFeatureMetadata(features, partId) {
  return features
    .sort((a, b) => b.confidence - a.confidence)
    .map((feature, index) => ({
      ...feature,
      id: `${feature.type === "roundedSlot" ? "slot" : "hole"}_${index + 1}`,
      label: `${feature.type === "roundedSlot" ? "Slot" : "Hole"} ${index + 1}`,
      partId: partId ?? null,
      original: {
        type: feature.type,
        axis: feature.axis,
        center: [...feature.center],
        radiusMm: feature.radiusMm,
        lengthMm: feature.lengthMm ?? null,
        widthMm: feature.widthMm ?? feature.radiusMm * 2,
        angleDeg: feature.angleDeg ?? 0,
        depthMm: feature.depthMm
      }
    }));
}

export function detectMeshFeatures(payload, options = {}) {
  const triangles = readTriangles(payload);
  if (!triangles.length) return [];
  const tolerance = finiteNumber(options.tolerance, DEFAULT_TOLERANCE);
  const bounds = boundsForTriangles(triangles);
  const { faces, edges } = buildFaceGraph(triangles, tolerance);
  const candidates = [];

  for (const axis of AXES) {
    const seamEdges = edges.filter((edge) => {
      if (edge.faces.length !== 2) return false;
      const [a, b] = edge.faces.map((index) => faces[index].normal);
      const aCap = Math.abs(a[axis.index]) > 0.82;
      const bCap = Math.abs(b[axis.index]) > 0.82;
      const aWall = Math.abs(a[axis.index]) < 0.38;
      const bWall = Math.abs(b[axis.index]) < 0.38;
      return (aCap && bWall) || (bCap && aWall);
    });

    for (const component of connectedEdgeComponents(seamEdges)) {
      const candidate = candidateFromComponent(uniquePointsFromEdges(component), axis, bounds);
      if (candidate) candidates.push(candidate);
    }

    const wallFaceIndices = faces
      .filter((face) => Math.abs(face.normal[axis.index]) < 0.24)
      .map((face) => face.index);
    for (const component of connectedFaceComponents(edges, wallFaceIndices)) {
      const componentFaces = component.map((faceIndex) => faces[faceIndex]);
      const candidate = candidateFromComponent(uniquePointsFromFaces(componentFaces), axis, bounds);
      if (candidate) candidates.push({ ...candidate, confidence: Math.min(0.98, candidate.confidence + 0.04) });
    }
  }

  return addFeatureMetadata(removeSlotCapDuplicates(mergedCandidates(candidates)), options.partId);
}
