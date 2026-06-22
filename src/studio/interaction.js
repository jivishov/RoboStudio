export const FEATURE_DETECTION_STATES = Object.freeze({
  NOT_DETECTED: "notDetected",
  DETECTING: "detecting",
  READY: "ready",
  NONE_FOUND: "noneFound",
  STALE: "stale",
  ERROR: "error"
});

export const DEFAULT_CLICK_DRAG_TOLERANCE_PX = 5;
export const DEFAULT_FEATURE_PICK_TOLERANCE_PX = 18;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finitePoint(value, fallback = [0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [finiteNumber(source[0], fallback[0] ?? 0), finiteNumber(source[1], fallback[1] ?? 0)];
}

function finiteVector(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [finiteNumber(source[0], fallback[0] ?? 0), finiteNumber(source[1], fallback[1] ?? 0), finiteNumber(source[2], fallback[2] ?? 0)];
}

function distancePx(a, b) {
  const left = finitePoint(a);
  const right = finitePoint(b);
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function distanceMm(a, b) {
  const left = finiteVector(a);
  const right = finiteVector(b);
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function distanceToSegmentPx(point, start, end) {
  const p = finitePoint(point);
  const a = finitePoint(start);
  const b = finitePoint(end);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) return distancePx(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

export function classifyPointerGesture(start, end, options = {}) {
  if (!start || !end) return { isClick: false, distancePx: Infinity };
  const maxDistancePx = finiteNumber(options.maxDistancePx, DEFAULT_CLICK_DRAG_TOLERANCE_PX);
  const distance = distancePx([start.clientX, start.clientY], [end.clientX, end.clientY]);
  const sameButton = start.button == null || end.button == null || start.button === end.button;
  const primaryButton = start.button == null || start.button === 0;
  const samePointer = start.pointerId == null || end.pointerId == null || start.pointerId === end.pointerId;
  const isClick = sameButton && primaryButton && samePointer && options.dragging !== true && distance <= maxDistancePx;
  return { isClick, distancePx: distance };
}

function projectedPoint(projectWorldPoint, worldPosition) {
  if (typeof projectWorldPoint !== "function") return null;
  const projected = projectWorldPoint(finiteVector(worldPosition));
  if (!projected) return null;
  const screen = finitePoint(projected.screen ?? projected);
  return {
    screen,
    visible: projected.visible !== false
  };
}

function considerCandidate(best, candidate, tolerancePx, worldToleranceMm) {
  if (!candidate || candidate.visible === false) return best;
  const withinScreen = Number.isFinite(candidate.distancePx) && candidate.distancePx <= tolerancePx;
  const withinWorld = Number.isFinite(candidate.distanceMm) && candidate.distanceMm <= worldToleranceMm;
  if (!withinScreen && !withinWorld) return best;
  if (!best) return candidate;
  const candidateScore = Number.isFinite(candidate.distancePx) ? candidate.distancePx : tolerancePx + candidate.distanceMm;
  const bestScore = Number.isFinite(best.distancePx) ? best.distancePx : tolerancePx + best.distanceMm;
  return candidateScore < bestScore ? candidate : best;
}

export function pickFeatureTarget(features, pointer, options = {}) {
  const tolerancePx = finiteNumber(options.tolerancePx, DEFAULT_FEATURE_PICK_TOLERANCE_PX);
  const worldToleranceMm = finiteNumber(options.worldToleranceMm, 3);
  const projectWorldPoint = options.projectWorldPoint;
  const hitWorldPosition = Array.isArray(options.hitWorldPosition) ? finiteVector(options.hitWorldPosition) : null;
  const point = finitePoint(pointer);
  let best = null;

  for (const feature of features ?? []) {
    if (!feature || feature.visible === false || feature.stale === true || !feature.worldCenter) continue;
    const partId = feature.partId ?? null;
    const featureId = feature.featureId ?? feature.id ?? null;
    if (!partId || !featureId) continue;

    const centerProjection = projectedPoint(projectWorldPoint, feature.worldCenter);
    best = considerCandidate(
      best,
      {
        partId,
        featureId,
        role: "center",
        distancePx: centerProjection?.visible === false ? Infinity : centerProjection ? distancePx(point, centerProjection.screen) : Infinity,
        distanceMm: hitWorldPosition ? distanceMm(hitWorldPosition, feature.worldCenter) : Infinity,
        worldPosition: finiteVector(feature.worldCenter)
      },
      tolerancePx,
      worldToleranceMm
    );

    const endpoints = Array.isArray(feature.worldEndpoints) ? feature.worldEndpoints : [];
    for (const [index, endpoint] of endpoints.entries()) {
      const endpointProjection = projectedPoint(projectWorldPoint, endpoint);
      best = considerCandidate(
        best,
        {
          partId,
          featureId,
          role: index === 1 ? "endpointB" : "endpointA",
          endpointIndex: index === 1 ? 1 : 0,
          distancePx: endpointProjection?.visible === false ? Infinity : endpointProjection ? distancePx(point, endpointProjection.screen) : Infinity,
          distanceMm: hitWorldPosition ? distanceMm(hitWorldPosition, endpoint) : Infinity,
          worldPosition: finiteVector(endpoint)
        },
        tolerancePx,
        worldToleranceMm
      );
    }

    if (endpoints.length >= 2) {
      const startProjection = projectedPoint(projectWorldPoint, endpoints[0]);
      const endProjection = projectedPoint(projectWorldPoint, endpoints[1]);
      const visible = startProjection?.visible !== false && endProjection?.visible !== false;
      best = considerCandidate(
        best,
        {
          partId,
          featureId,
          role: "centerline",
          distancePx:
            visible && startProjection && endProjection
              ? distanceToSegmentPx(point, startProjection.screen, endProjection.screen)
              : Infinity,
          distanceMm: hitWorldPosition ? distanceMm(hitWorldPosition, feature.worldCenter) : Infinity,
          worldPosition: finiteVector(feature.worldCenter)
        },
        tolerancePx,
        worldToleranceMm
      );
    }
  }

  return best;
}

export function featureAnchorRole(target) {
  if (!target) return "center";
  if (target.role === "endpointA" || target.role === "endpointB") return "endpoint";
  if (target.role === "edge") return "edge";
  return "center";
}

export function featureAnchorLabel(partId, feature, target = {}) {
  const partLabel = partId ?? feature?.partId ?? "part";
  const featureLabel = feature?.label ?? feature?.id ?? "feature";
  if (target.role === "endpointA") return `${partLabel} ${featureLabel} endpoint A`;
  if (target.role === "endpointB") return `${partLabel} ${featureLabel} endpoint B`;
  if (target.role === "centerline") return `${partLabel} ${featureLabel} centerline`;
  return `${partLabel} ${featureLabel} center`;
}

export function isSpacingPairSupported(anchorA, anchorB, options = {}) {
  if (!anchorA || !anchorB) return false;
  if (!anchorA.partId || !anchorB.partId) return false;
  if (anchorA.featureId && anchorB.featureId && anchorA.partId === anchorB.partId) {
    return typeof options.isPartEditable === "function" ? options.isPartEditable(anchorA.partId) : true;
  }
  return anchorA.partId !== anchorB.partId;
}
