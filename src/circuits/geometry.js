export const BENCH_WIDTH = 1050;
export const BENCH_HEIGHT = 650;
export const MIN_COMPONENT_SCALE = 0.55;
export const MAX_COMPONENT_SCALE = 1.9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numericScale(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 1;
}

export function componentScale(component) {
  return clamp(numericScale(component?.props?.scale), MIN_COMPONENT_SCALE, MAX_COMPONENT_SCALE);
}

export function normalizeComponentRotation(value) {
  const numeric = Number(value);
  const rounded = Number.isFinite(numeric) ? Math.round(numeric) : 0;
  return ((rounded % 360) + 360) % 360;
}

export function scaledDimensions(component, componentDefinition) {
  const scale = componentScale(component);
  const [width, height] = componentDefinition?.dimensions ?? [40, 24];
  return [width * scale, height * scale];
}

function rotatedLocalPoint(component, localPoint, scale = componentScale(component)) {
  const rotation = normalizeComponentRotation(component?.rotation);
  const radians = rotation * Math.PI / 180;
  const x = Number(localPoint?.[0] ?? 0) * scale;
  const y = Number(localPoint?.[1] ?? 0) * scale;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    x * cos - y * sin,
    x * sin + y * cos
  ];
}

export function componentWorldVector(component, localVector) {
  return rotatedLocalPoint(component, localVector, 1);
}

export function componentBounds(component, componentDefinition) {
  const scale = componentScale(component);
  const [baseWidth, baseHeight] = componentDefinition?.dimensions ?? [40, 24];
  const localBounds = componentDefinition?.clampBoundsMm ?? {
    x: -baseWidth / 2,
    y: -baseHeight / 2,
    width: baseWidth,
    height: baseHeight
  };
  const corners = [
    [localBounds.x, localBounds.y],
    [localBounds.x + localBounds.width, localBounds.y],
    [localBounds.x + localBounds.width, localBounds.y + localBounds.height],
    [localBounds.x, localBounds.y + localBounds.height]
  ].map((point) => {
    const rotated = rotatedLocalPoint(component, point, scale);
    return [
      component.position[0] + rotated[0],
      component.position[1] + rotated[1]
    ];
  });
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    right,
    top,
    bottom
  };
}

export function terminalWorldPosition(component, terminal) {
  const scale = componentScale(component);
  const rotated = rotatedLocalPoint(component, terminal.position, scale);
  return [
    component.position[0] + rotated[0],
    component.position[1] + rotated[1]
  ];
}

export function clampComponentPosition(component, componentDefinition, position, scale = componentScale(component), rotation = component?.rotation) {
  const centeredBounds = componentBounds({
    ...component,
    position: [0, 0],
    rotation,
    props: { ...(component?.props ?? {}), scale }
  }, componentDefinition);
  const halfWidth = Math.max(Math.abs(centeredBounds.left), Math.abs(centeredBounds.right));
  const halfHeight = Math.max(Math.abs(centeredBounds.top), Math.abs(centeredBounds.bottom));
  return [
    clamp(Number(position[0]), halfWidth + 6, BENCH_WIDTH - halfWidth - 6),
    clamp(Number(position[1]), halfHeight + 6, BENCH_HEIGHT - halfHeight - 6)
  ];
}

export function normalizeComponentScale(value) {
  return clamp(numericScale(value), MIN_COMPONENT_SCALE, MAX_COMPONENT_SCALE);
}
