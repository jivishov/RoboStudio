export const MEASUREMENT_ANCHOR_TYPES = Object.freeze([
  "pickedPoint",
  "partOrigin",
  "partBoundsCenter",
  "holeCenter",
  "slotCenter",
  "slotEndpoint",
  "featureEdge"
]);

export const SERVO_HORN_SPACING_PRESETS = Object.freeze([
  {
    id: "servo_horn_opposite_radial",
    label: "Servo horn opposite radial holes",
    targetDistanceMm: 24,
    note: "From the RoboStudio servo horn template: radial holes are 12 mm from center."
  },
  {
    id: "servo_horn_adjacent_radial",
    label: "Servo horn adjacent radial holes",
    targetDistanceMm: Number((12 * Math.SQRT2).toFixed(3)),
    note: "From the RoboStudio servo horn template: adjacent 90 degree radial holes."
  }
]);

const AXIS_PLANES = Object.freeze({
  xy: [0, 1],
  xz: [0, 2],
  yz: [1, 2]
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteVector(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: 3 }, (_item, index) => finiteNumber(source[index], fallback[index] ?? 0));
}

export function createMeasurementAnchor(options = {}) {
  const type = MEASUREMENT_ANCHOR_TYPES.includes(options.type) ? options.type : "pickedPoint";
  return {
    type,
    label: String(options.label ?? type),
    partId: options.partId ?? null,
    featureId: options.featureId ?? null,
    role: options.role ?? null,
    worldPosition: finiteVector(options.worldPosition ?? options.position),
    localPosition: Array.isArray(options.localPosition) ? finiteVector(options.localPosition) : null,
    edgeOffsetMm: Math.max(0, finiteNumber(options.edgeOffsetMm ?? options.radiusMm ?? 0)),
    confidence: Number.isFinite(Number(options.confidence)) ? Number(options.confidence) : null
  };
}

export function createFeatureAnchor(feature, options = {}) {
  if (!feature) return null;
  const role = options.role ?? "center";
  const center = finiteVector(options.worldPosition ?? feature.worldCenter ?? feature.center);
  const endpointIndex = options.endpointIndex === 1 ? 1 : 0;
  let worldPosition = center;
  let type = feature.type === "roundedSlot" ? "slotCenter" : "holeCenter";
  let edgeOffsetMm = feature.radiusMm ?? feature.widthMm / 2 ?? 0;

  if (feature.type === "roundedSlot" && role === "endpoint") {
    type = "slotEndpoint";
    const endpoints = feature.worldEndpoints ?? feature.endpoints ?? null;
    if (Array.isArray(endpoints?.[endpointIndex])) worldPosition = finiteVector(endpoints[endpointIndex]);
  } else if (role === "edge") {
    type = "featureEdge";
  }

  return createMeasurementAnchor({
    type,
    role,
    partId: feature.partId,
    featureId: feature.id,
    label: options.label ?? feature.label ?? feature.id,
    worldPosition,
    localPosition: feature.center,
    edgeOffsetMm,
    confidence: feature.confidence
  });
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function length(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function projectedDelta(delta, activePlane = "xz") {
  const axes = AXIS_PLANES[activePlane] ?? AXIS_PLANES.xz;
  return delta.map((value, index) => (axes.includes(index) ? value : 0));
}

export function measureAnchors(anchorA, anchorB, options = {}) {
  if (!anchorA || !anchorB) {
    return {
      ready: false,
      distanceMm: 0,
      projectedDistanceMm: 0,
      deltaMm: [0, 0, 0],
      edgeClearanceMm: null,
      centerToCenterMm: null
    };
  }

  const a = finiteVector(anchorA.worldPosition ?? anchorA.position);
  const b = finiteVector(anchorB.worldPosition ?? anchorB.position);
  const delta = subtract(b, a);
  const distance = length(delta);
  const projection = projectedDelta(delta, options.activePlane);
  const edgeOffsets = Math.max(0, finiteNumber(anchorA.edgeOffsetMm)) + Math.max(0, finiteNumber(anchorB.edgeOffsetMm));

  return {
    ready: true,
    distanceMm: distance,
    projectedDistanceMm: length(projection),
    deltaMm: delta,
    centerToCenterMm: distance,
    edgeClearanceMm: edgeOffsets > 0 ? distance - edgeOffsets : null,
    activePlane: options.activePlane ?? "xz"
  };
}

export function spacingAdjustmentForTarget(anchorA, anchorB, targetDistanceMm, options = {}) {
  const measurement = measureAnchors(anchorA, anchorB, options);
  const target = finiteNumber(targetDistanceMm, 0);
  if (!measurement.ready || target <= 0 || measurement.distanceMm <= 1e-9) {
    return {
      ok: false,
      reason: "A positive current and target distance are required.",
      measurement,
      moveA: [0, 0, 0],
      moveB: [0, 0, 0]
    };
  }

  const unit = measurement.deltaMm.map((value) => value / measurement.distanceMm);
  const deltaDistance = target - measurement.distanceMm;
  const symmetric = options.symmetric === true;
  const moveB = unit.map((value) => value * (symmetric ? deltaDistance / 2 : deltaDistance));
  const moveA = symmetric ? unit.map((value) => -value * (deltaDistance / 2)) : [0, 0, 0];

  return {
    ok: true,
    measurement,
    targetDistanceMm: target,
    deltaDistanceMm: deltaDistance,
    moveA,
    moveB
  };
}

export function formatMeasurement(value, digits = 2) {
  const number = finiteNumber(value, 0);
  return Number(number.toFixed(digits));
}
