const POINTER_PROFILES = Object.freeze({
  mouse: Object.freeze({ pointerType: "mouse", radiusPx: 12, tieBandPx: 2, hysteresisPx: 1 }),
  pen: Object.freeze({ pointerType: "pen", radiusPx: 18, tieBandPx: 3, hysteresisPx: 2 }),
  touch: Object.freeze({ pointerType: "touch", radiusPx: 22, tieBandPx: 6, hysteresisPx: 3 })
});

export const TERMINAL_POINTER_PROFILES = POINTER_PROFILES;

export function terminalEndpointKey(endpoint) {
  return endpoint ? `${endpoint.componentId}:${endpoint.terminalId}` : "";
}

export function terminalPointerProfile(pointerType = "mouse") {
  return POINTER_PROFILES[pointerType] ?? POINTER_PROFILES.mouse;
}

function finitePoint(point) {
  return Array.isArray(point)
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]));
}

function projectPoint(point, matrix) {
  const x = Number(point[0]);
  const y = Number(point[1]);
  return [
    x * Number(matrix.a) + y * Number(matrix.c) + Number(matrix.e),
    x * Number(matrix.b) + y * Number(matrix.d) + Number(matrix.f)
  ];
}

function projectedCandidate(anchor, screenPoint, distancePx) {
  return {
    ...anchor,
    screenPoint,
    distancePx
  };
}

function byDistanceThenIdentity(left, right) {
  const distanceDelta = left.distancePx - right.distancePx;
  if (Math.abs(distanceDelta) > 1e-9) return distanceDelta;
  return String(left.endpointKey).localeCompare(String(right.endpointKey), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

/**
 * Resolve one pointer position against already-projected terminal anchors.
 * Geometry is intentionally evaluated before validity: invalid/full anchors are
 * never filtered out and therefore cannot be replaced by a farther valid one.
 */
export function resolveProjectedTerminal(projectedAnchors, clientPoint, options = {}) {
  if (!finitePoint(clientPoint)) return null;
  const profile = terminalPointerProfile(options.pointerType);
  const radiusPx = Number(options.radiusPx ?? profile.radiusPx);
  const tieBandPx = Number(options.tieBandPx ?? profile.tieBandPx);
  const hysteresisPx = Number(options.hysteresisPx ?? profile.hysteresisPx);
  const hits = [];
  for (const anchor of projectedAnchors ?? []) {
    if (!finitePoint(anchor.screenPoint)) continue;
    const distancePx = Math.hypot(
      Number(clientPoint[0]) - Number(anchor.screenPoint[0]),
      Number(clientPoint[1]) - Number(anchor.screenPoint[1])
    );
    if (distancePx <= radiusPx) hits.push(projectedCandidate(anchor, anchor.screenPoint, distancePx));
  }
  hits.sort(byDistanceThenIdentity);
  if (!hits.length) {
    return {
      pointerType: profile.pointerType,
      radiusPx,
      tieBandPx,
      hysteresisPx,
      target: null,
      candidates: [],
      nearbyCandidates: [],
      ambiguous: false,
      ambiguityCount: 0
    };
  }

  const nearest = hits[0];
  const tieLimit = nearest.distancePx + tieBandPx + 1e-9;
  const candidates = hits.filter((candidate) => candidate.distancePx <= tieLimit);
  let target = nearest;
  const lockedEndpointKey = String(options.lockedEndpointKey ?? "");
  const locked = lockedEndpointKey
    ? hits.find((candidate) => candidate.endpointKey === lockedEndpointKey)
    : null;
  if (locked && locked.distancePx <= nearest.distancePx + hysteresisPx + 1e-9) target = locked;

  return {
    pointerType: profile.pointerType,
    radiusPx,
    tieBandPx,
    hysteresisPx,
    target,
    candidates,
    nearbyCandidates: hits,
    ambiguous: candidates.length > 1,
    ambiguityCount: candidates.length
  };
}

/**
 * A small bench-level cache. `collectAnchors()` returns exact SVG/user-space
 * anchor coordinates and immutable terminal metadata. One `getScreenCTM()`
 * projects the complete terminal set into CSS pixels when the cache is rebuilt.
 */
export function createProjectedTerminalResolver({ collectAnchors, getScreenCTM }) {
  if (typeof collectAnchors !== "function") throw new Error("collectAnchors must be a function.");
  if (typeof getScreenCTM !== "function") throw new Error("getScreenCTM must be a function.");

  let projectedAnchors = [];
  let projectedByEndpoint = new Map();
  let valid = false;
  let version = 0;
  let rebuildCount = 0;
  let lastInvalidationReason = "initial";

  function invalidate(reason = "geometry-change") {
    valid = false;
    lastInvalidationReason = String(reason);
    version += 1;
  }

  function rebuild(context) {
    const matrix = getScreenCTM(context);
    if (!matrix) {
      projectedAnchors = [];
      projectedByEndpoint = new Map();
      valid = true;
      rebuildCount += 1;
      return projectedAnchors;
    }
    const anchors = collectAnchors(context) ?? [];
    projectedAnchors = anchors
      .filter((anchor) => anchor?.endpointKey && finitePoint(anchor.svgPoint))
      .map((anchor) => ({
        ...anchor,
        screenPoint: projectPoint(anchor.svgPoint, matrix)
      }));
    projectedByEndpoint = new Map(projectedAnchors.map((anchor) => [anchor.endpointKey, anchor]));
    valid = true;
    rebuildCount += 1;
    return projectedAnchors;
  }

  function ensure(context) {
    return valid ? projectedAnchors : rebuild(context);
  }

  return Object.freeze({
    invalidate,
    rebuild,
    ensure,
    resolve(clientPoint, options = {}, context) {
      return resolveProjectedTerminal(ensure(context), clientPoint, options);
    },
    resolveEndpoint(endpoint, context) {
      ensure(context);
      return projectedByEndpoint.get(terminalEndpointKey(endpoint)) ?? null;
    },
    snapshot(context) {
      return [...ensure(context)];
    },
    stats() {
      return {
        valid,
        version,
        rebuildCount,
        anchorCount: projectedAnchors.length,
        lastInvalidationReason
      };
    }
  });
}
