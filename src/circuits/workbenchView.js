import {
  BENCH_HEIGHT,
  BENCH_WIDTH,
  componentBounds,
  componentScale,
  normalizeComponentRotation
} from "./geometry.js";

export const DEFAULT_VIEW_ZOOM = 1.5;
export const MIN_VIEW_ZOOM = 0.65;
export const MAX_VIEW_ZOOM = 8;
export const FRAME_MARGIN_RATIO = 0.12;

export function normalizeViewZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_VIEW_ZOOM;
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, numeric));
}

export function clampViewCenter(center, zoom = DEFAULT_VIEW_ZOOM) {
  const normalizedZoom = normalizeViewZoom(zoom);
  const viewWidth = BENCH_WIDTH / normalizedZoom;
  const viewHeight = BENCH_HEIGHT / normalizedZoom;
  const halfWidth = Math.min(BENCH_WIDTH / 2, viewWidth / 2);
  const halfHeight = Math.min(BENCH_HEIGHT / 2, viewHeight / 2);
  return [
    Math.min(BENCH_WIDTH - halfWidth, Math.max(halfWidth, Number(center?.[0] ?? BENCH_WIDTH / 2))),
    Math.min(BENCH_HEIGHT - halfHeight, Math.max(halfHeight, Number(center?.[1] ?? BENCH_HEIGHT / 2)))
  ];
}

export function viewBoxForCamera(view = {}) {
  const zoom = normalizeViewZoom(view.zoom);
  const center = clampViewCenter(view.center, zoom);
  const width = BENCH_WIDTH / zoom;
  const height = BENCH_HEIGHT / zoom;
  return [center[0] - width / 2, center[1] - height / 2, width, height];
}

function unionBounds(boundsList) {
  if (!boundsList.length) return null;
  const left = Math.min(...boundsList.map((bounds) => bounds.left));
  const top = Math.min(...boundsList.map((bounds) => bounds.top));
  const right = Math.max(...boundsList.map((bounds) => bounds.right));
  const bottom = Math.max(...boundsList.map((bounds) => bounds.bottom));
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

export function populatedProjectBounds(project, getDefinition) {
  const bounds = [];
  for (const component of project?.components ?? []) {
    const definition = getDefinition(component.typeId);
    if (definition) bounds.push(componentBounds(component, definition));
  }
  return unionBounds(bounds);
}

function boundsCenter(bounds) {
  return bounds
    ? [(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2]
    : [BENCH_WIDTH / 2, BENCH_HEIGHT / 2];
}

export function defaultCameraForProject(project, getDefinition) {
  const bounds = populatedProjectBounds(project, getDefinition);
  return {
    zoom: DEFAULT_VIEW_ZOOM,
    center: clampViewCenter(boundsCenter(bounds), DEFAULT_VIEW_ZOOM)
  };
}

export function cameraForBounds(bounds, options = {}) {
  if (!bounds) return {
    zoom: normalizeViewZoom(options.maxZoom ?? DEFAULT_VIEW_ZOOM),
    center: clampViewCenter([BENCH_WIDTH / 2, BENCH_HEIGHT / 2], options.maxZoom ?? DEFAULT_VIEW_ZOOM)
  };
  const marginRatio = Math.max(0, Number(options.marginRatio ?? FRAME_MARGIN_RATIO));
  const paddedWidth = Math.max(1, Number(bounds.width) * (1 + marginRatio * 2));
  const paddedHeight = Math.max(1, Number(bounds.height) * (1 + marginRatio * 2));
  const fitZoom = Math.min(BENCH_WIDTH / paddedWidth, BENCH_HEIGHT / paddedHeight);
  const zoom = Math.min(normalizeViewZoom(options.maxZoom ?? MAX_VIEW_ZOOM), normalizeViewZoom(fitZoom));
  return { zoom, center: clampViewCenter(boundsCenter(bounds), zoom) };
}

export function overviewCameraForProject(project, getDefinition) {
  return cameraForBounds(populatedProjectBounds(project, getDefinition), {
    marginRatio: FRAME_MARGIN_RATIO,
    maxZoom: DEFAULT_VIEW_ZOOM
  });
}

export function componentCamera(component, definition) {
  return cameraForBounds(componentBounds(component, definition), {
    marginRatio: FRAME_MARGIN_RATIO,
    maxZoom: MAX_VIEW_ZOOM
  });
}

export function physicalPortWorldBounds(component, port) {
  if (!component || !port?.housingBoundsMm) return null;
  const bounds = port.housingBoundsMm;
  const scale = componentScale(component);
  const angle = normalizeComponentRotation(component.rotation) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height]
  ].map(([x, y]) => [
    component.position[0] + (x * cosine - y * sine) * scale,
    component.position[1] + (x * sine + y * cosine) * scale
  ]);
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return unionBounds([{
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys)
  }]);
}

export function portCamera(component, port) {
  return cameraForBounds(physicalPortWorldBounds(component, port), {
    marginRatio: FRAME_MARGIN_RATIO,
    maxZoom: MAX_VIEW_ZOOM
  });
}

export function clippedComponentCounts(project, getDefinition, viewBox) {
  const [left, top, width, height] = viewBox;
  const right = left + width;
  const bottom = top + height;
  const counts = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const component of project?.components ?? []) {
    const definition = getDefinition(component.typeId);
    if (!definition) continue;
    const bounds = componentBounds(component, definition);
    if (bounds.top < top - 1e-6) counts.top += 1;
    if (bounds.right > right + 1e-6) counts.right += 1;
    if (bounds.bottom > bottom + 1e-6) counts.bottom += 1;
    if (bounds.left < left - 1e-6) counts.left += 1;
  }
  return counts;
}
