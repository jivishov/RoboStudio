/**
 * Watertightness of a compiled solid.
 *
 * This is an **export precondition**, not validation. `validateBody` refuses to
 * compile a body whose issue list is non-empty at any severity
 * (`cadCompile.js:171`), so a finding routed through it would block compile,
 * preview and handoff as well. A solid that is not closed is still a legal body
 * whose DXF and whose 2D mass properties are perfectly good; it is only the mesh
 * formats - STL and 3MF - that need a closed surface, and only the divergence
 * theorem that needs one to state a volume. So the finding travels with the
 * compile result as a warning, exactly like `connectivity.js`, and the export
 * path consults the report.
 *
 * Naive edge pairing is the obvious implementation and it is wrong here.
 *
 * A closed, consistently oriented surface has every directed edge `a -> b`
 * matched by exactly one `b -> a`. That holds for every sketch, revolve and gear
 * body this page compiles. It does **not** hold for `booleanOperation` bodies:
 * JSCAD's booleans split polygons against one another and leave T-junctions, so a
 * union of two plates comes back with 176 unpaired edges while enclosing a
 * perfectly closed volume. Blocking mesh export on that would condemn a whole
 * body kind for a defect that is not there.
 *
 * The fix is to resolve unpaired edges along their supporting line rather than
 * one at a time. Group the leftovers by the infinite line they lie on, project
 * each onto that line as a signed interval, and sweep. A T-junction is one long
 * `+1` interval covered by two short `-1` intervals, so it cancels; a missing
 * face leaves signed coverage that does not. That also catches the case a
 * surface-integral closure test misses - two opposite faces of a cube removed,
 * whose area vectors cancel exactly - because the leftover intervals sit on eight
 * different lines and none of them pair up.
 *
 * The module is DOM-free: it runs in the CAD worker and under `node:test`.
 */

import jscad from "@jscad/modeling";
import { createIssue } from "./issues.js";

const { geom3 } = jscad.geometries;

export const NON_WATERTIGHT_CODE = "non-watertight-solid";

/** Vertices closer than this in every axis are the same vertex. */
export const WELD_TOLERANCE_MM = 1e-6;

/** Collinear intervals shorter than this are not a gap worth reporting. */
export const SPAN_TOLERANCE_MM = 1e-6;

function weldKey(point, tolerance) {
  let key = "";
  for (let index = 0; index < 3; index += 1) {
    const value = Number(point[index]);
    const snapped = Math.round(value / tolerance) * tolerance;
    key += `${Math.abs(snapped) < tolerance ? 0 : snapped},`;
  }
  return key;
}

/**
 * Weld the solid's polygon vertices and collect its directed edges.
 *
 * Returns the welded points plus, for every undirected edge, how many times it
 * was walked in each direction. Zero-length edges are counted and skipped: they
 * are a tessellation artefact, not a leak.
 */
function collectDirectedEdges(polygons, tolerance) {
  const vertexIndices = new Map();
  const points = [];
  const edges = new Map();
  let polygonCount = 0;
  let degenerateEdgeCount = 0;

  const indexOf = (point) => {
    const key = weldKey(point, tolerance);
    let index = vertexIndices.get(key);
    if (index === undefined) {
      index = points.length;
      vertexIndices.set(key, index);
      points.push([Number(point[0]), Number(point[1]), Number(point[2])]);
    }
    return index;
  };

  for (const polygon of polygons) {
    const vertices = polygon?.vertices;
    if (!Array.isArray(vertices) || vertices.length < 3) continue;
    polygonCount += 1;

    const indices = vertices.map(indexOf);
    for (let position = 0; position < indices.length; position += 1) {
      const from = indices[position];
      const to = indices[(position + 1) % indices.length];
      if (from === to) {
        degenerateEdgeCount += 1;
        continue;
      }
      const forward = from < to;
      const key = forward ? `${from}:${to}` : `${to}:${from}`;
      const entry = edges.get(key);
      if (entry) {
        if (forward) entry.forward += 1;
        else entry.backward += 1;
      } else {
        edges.set(key, {
          low: forward ? from : to,
          high: forward ? to : from,
          forward: forward ? 1 : 0,
          backward: forward ? 0 : 1
        });
      }
    }
  }

  return { points, edges, polygonCount, degenerateEdgeCount };
}

/**
 * Directed edges left over once each `a -> b` has cancelled one `b -> a`.
 *
 * An empty result means the surface is closed and consistently oriented with no
 * T-junctions at all, which is the common case and needs no further work.
 */
function unpairedDirectedEdges(edges) {
  const leftovers = [];
  for (const entry of edges.values()) {
    const net = entry.forward - entry.backward;
    for (let count = 0; count < Math.abs(net); count += 1) {
      leftovers.push(net > 0 ? [entry.low, entry.high] : [entry.high, entry.low]);
    }
  }
  return leftovers;
}

function supportingLine(from, to) {
  const direction = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0)) return null;

  let unit = direction.map((value) => value / length);
  // Canonicalize the direction so `a -> b` and `b -> a` land on the same line.
  const leading = unit.findIndex((value) => Math.abs(value) > 1e-9);
  if (leading >= 0 && unit[leading] < 0) unit = unit.map((value) => -value);

  const along = from[0] * unit[0] + from[1] * unit[1] + from[2] * unit[2];
  // The foot of the perpendicular from the origin identifies the line uniquely
  // once the direction is canonical.
  const foot = [0, 1, 2].map((index) => from[index] - along * unit[index]);
  const quantize = (value) => {
    const snapped = Math.round(value / 1e-5) * 1e-5;
    return Math.abs(snapped) < 1e-5 ? 0 : snapped;
  };

  return {
    key: [...unit.map(quantize), ...foot.map(quantize)].join("|"),
    from: along,
    to: to[0] * unit[0] + to[1] * unit[1] + to[2] * unit[2]
  };
}

/**
 * Signed coverage sweep over each supporting line.
 *
 * Returns the number of spans whose signed coverage is non-zero. A T-junction
 * chain cancels to zero everywhere; a hole in the surface does not.
 */
function unmatchedSpanCount(points, leftovers, spanTolerance) {
  const lines = new Map();

  for (const [fromIndex, toIndex] of leftovers) {
    const line = supportingLine(points[fromIndex], points[toIndex]);
    if (!line) continue;
    const group = lines.get(line.key) ?? [];
    const sign = line.to > line.from ? 1 : -1;
    group.push({ start: Math.min(line.from, line.to), end: Math.max(line.from, line.to), sign });
    lines.set(line.key, group);
  }

  let unmatched = 0;
  for (const group of lines.values()) {
    const events = [];
    for (const span of group) {
      events.push({ at: span.start, delta: span.sign });
      events.push({ at: span.end, delta: -span.sign });
    }
    events.sort((a, b) => a.at - b.at);

    let coverage = 0;
    for (let index = 0; index < events.length; index += 1) {
      coverage += events[index].delta;
      const next = events[index + 1];
      if (!next) break;
      if (coverage !== 0 && next.at - events[index].at > spanTolerance) unmatched += 1;
    }
    // Coverage must return to zero at the far end of every line.
    if (coverage !== 0) unmatched += 1;
  }

  return unmatched;
}

/**
 * Edge-manifoldness report for a compiled solid.
 *
 * `watertight` is the only field the export path gates on. The rest is there so
 * the message can say how badly the surface is open rather than only that it is,
 * and so `tJunctionEdgeCount` records how much of the unpaired count was
 * explained rather than condemned.
 */
export function watertightReportFromPolygons(polygons = [], options = {}) {
  const tolerance = Number(options.weldToleranceMm ?? WELD_TOLERANCE_MM) || WELD_TOLERANCE_MM;
  const spanTolerance = Number(options.spanToleranceMm ?? SPAN_TOLERANCE_MM) || SPAN_TOLERANCE_MM;
  const { points, edges, polygonCount, degenerateEdgeCount } = collectDirectedEdges(polygons, tolerance);
  const leftovers = unpairedDirectedEdges(edges);
  const unmatchedEdgeCount = leftovers.length ? unmatchedSpanCount(points, leftovers, spanTolerance) : 0;

  return {
    watertight: polygonCount > 0 && unmatchedEdgeCount === 0,
    polygonCount,
    vertexCount: points.length,
    edgeCount: edges.size,
    unpairedDirectedEdgeCount: leftovers.length,
    // Unpaired edges that the collinear sweep accounted for. JSCAD's booleans
    // leave hundreds of these on a perfectly closed solid.
    tJunctionEdgeCount: Math.max(0, leftovers.length - unmatchedEdgeCount),
    unmatchedEdgeCount,
    degenerateEdgeCount
  };
}

/** Edge-manifoldness report for a compiled JSCAD solid. */
export function solidWatertightReport(solid, options = {}) {
  return watertightReportFromPolygons(geom3.toPolygons(solid), options);
}

/**
 * Edge-manifoldness report for a flat triangle buffer, nine floats per triangle.
 *
 * The build123d backend hands back a mesh and no solid, so this is the only route
 * available for that path - and it is the path whose mass properties would
 * otherwise trust a surface nothing on this thread ever built.
 */
export function triangleSoupWatertightReport(vertices, triangleCount = null, options = {}) {
  const buffer = vertices ?? [];
  const triangles = Number.isFinite(Number(triangleCount))
    ? Math.max(0, Math.floor(Number(triangleCount)))
    : Math.floor(buffer.length / 9);
  const polygons = [];

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 9;
    if (offset + 9 > buffer.length) break;
    polygons.push({
      vertices: [
        [buffer[offset], buffer[offset + 1], buffer[offset + 2]],
        [buffer[offset + 3], buffer[offset + 4], buffer[offset + 5]],
        [buffer[offset + 6], buffer[offset + 7], buffer[offset + 8]]
      ]
    });
  }

  return watertightReportFromPolygons(polygons, options);
}

/** Warning-severity issue for a report that failed, or `null` for one that passed. */
export function nonWatertightIssue(report, options = {}) {
  if (!report || report.watertight) return null;

  const detail = report.polygonCount
    ? `${report.unmatchedEdgeCount} edge${report.unmatchedEdgeCount === 1 ? "" : "s"} are unmatched`
    : "it has no surface polygons";

  return createIssue(
    NON_WATERTIGHT_CODE,
    `Body does not compile to a closed surface: ${detail}. STL and 3MF export and mesh volume need a closed surface.`,
    options.path ?? "body",
    "warning",
    {
      unmatchedEdgeCount: report.unmatchedEdgeCount,
      unpairedDirectedEdgeCount: report.unpairedDirectedEdgeCount,
      tJunctionEdgeCount: report.tJunctionEdgeCount,
      polygonCount: report.polygonCount
    }
  );
}

/**
 * The mesh-export gate.
 *
 * One function so STL, 3MF and any later mesh format refuse in the same words. It
 * throws rather than returning a verdict because every caller's only sane response
 * is to stop, and a returned `false` invites a caller to ignore it.
 *
 * A `null` or missing report means the check could not run, which is not proof of
 * closure, so it is refused too - the alternative is shipping an unprintable file
 * on the strength of an absent answer.
 */
export function assertMeshExportWatertight(body, report, formatLabel = "A mesh export") {
  const name = body?.name ?? body?.id ?? "This body";
  // A caller that only has the verdict - the main thread reads it off a compile
  // warning - passes the boolean, and gets the same refusal without an edge count
  // it does not have.
  const verdict = typeof report === "boolean" ? report : report?.watertight;

  if (verdict === true) return report;
  if (verdict !== false) {
    const error = new Error(`${formatLabel} needs a closed surface, and ${name} has not been checked.`);
    error.code = "watertight-unknown";
    throw error;
  }

  const detail = typeof report === "boolean"
    ? null
    : report.polygonCount
      ? `${report.unmatchedEdgeCount} unmatched edge${report.unmatchedEdgeCount === 1 ? "" : "s"}`
      : "no surface polygons";
  const error = new Error(
    `${name} does not compile to a closed surface${detail ? ` (${detail})` : ""}, so a ${formatLabel.toLowerCase()} would be unprintable.`
  );
  error.code = NON_WATERTIGHT_CODE;
  throw error;
}

/**
 * Returns a warning-severity issue when a solid is not closed, or `null`.
 *
 * Never throws: a solid the check cannot walk is reported as no finding rather
 * than failing the compile it is only annotating. That is the same rule
 * `detectDisconnectedSolid` follows, and it is why the export gate must treat a
 * missing report as "not proven open" rather than as proof of closure - the gate
 * recomputes the report itself over the solid it is about to serialize.
 *
 * `options.report` accepts a verdict the caller already has, so a compile walks
 * the edges once for the warning and the mass properties together.
 */
export function detectNonWatertightSolid(solid, options = {}) {
  if (!solid) return null;

  let report = options.report ?? null;
  if (!report) {
    try {
      report = solidWatertightReport(solid, options);
    } catch {
      return null;
    }
  }

  return nonWatertightIssue(report, options);
}
