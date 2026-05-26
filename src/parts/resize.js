import {
  BOOLEAN_OPERATION_KIND,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND,
  asFiniteNumber,
  cloneJson,
  createDefaultTransform
} from "./contracts.js";
import { profileCenter, profileSize } from "./sketch.js";

const AXIS_COUNT = 3;
const MIN_SIZE_MM = 0.001;
const NON_UNIFORM_TOLERANCE = 0.001;

function positiveNumber(value, fallback = MIN_SIZE_MM) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveVector(value, fallback = [1, 1, 1]) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: AXIS_COUNT }, (_item, index) => positiveNumber(source[index], fallback[index] ?? 1));
}

function targetVector(value, currentSize) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: AXIS_COUNT }, (_item, index) => {
    const number = Number(source[index]);
    return Number.isFinite(number) && number > 0 ? number : positiveNumber(currentSize[index], MIN_SIZE_MM);
  });
}

function transformPoint(value, center, scale) {
  return center + (value - center) * scale;
}

function cloneProfile(profile) {
  return cloneJson(profile);
}

function profileCenterForResize(profile) {
  const [x, z] = profileCenter(profile);
  return [asFiniteNumber(x, 0), asFiniteNumber(z, 0)];
}

function moveProfileCenter(profile, x, z) {
  const copy = cloneProfile(profile);
  if (copy.type === "polyline") {
    const [currentX, currentZ] = profileCenterForResize(copy);
    const dx = x - currentX;
    const dz = z - currentZ;
    copy.points = (copy.points ?? []).map((point) => [
      asFiniteNumber(point?.[0], 0) + dx,
      asFiniteNumber(point?.[1], 0) + dz
    ]);
    return copy;
  }

  copy.x = x;
  copy.z = z;
  return copy;
}

function scaleProfileDimensions(profile, scaleX, scaleZ) {
  const copy = cloneProfile(profile);
  if (copy.type === "circle") {
    copy.radius = positiveNumber(copy.radius, 1) * Math.sqrt(Math.abs(scaleX * scaleZ));
    return copy;
  }
  if (copy.type === "roundedSlot") {
    copy.length = positiveNumber(copy.length, 1) * scaleX;
    copy.width = positiveNumber(copy.width, 1) * scaleZ;
    return copy;
  }
  if (copy.type === "polyline") return copy;

  copy.width = positiveNumber(copy.width, 1) * scaleX;
  copy.height = positiveNumber(copy.height, 1) * scaleZ;
  if (copy.cornerRadius != null) copy.cornerRadius = Math.max(0, asFiniteNumber(copy.cornerRadius, 0) * Math.min(scaleX, scaleZ));
  return copy;
}

function scaleProfileAround(profile, centerX, centerZ, scaleX, scaleZ, options = {}) {
  const copy = scaleProfileDimensions(profile, options.scaleDimensions === false ? 1 : scaleX, options.scaleDimensions === false ? 1 : scaleZ);

  if (copy.type === "polyline") {
    if (options.scaleDimensions === false) {
      const [currentX, currentZ] = profileCenterForResize(copy);
      return moveProfileCenter(copy, transformPoint(currentX, centerX, scaleX), transformPoint(currentZ, centerZ, scaleZ));
    }

    copy.points = (copy.points ?? []).map((point) => [
      transformPoint(asFiniteNumber(point?.[0], 0), centerX, scaleX),
      transformPoint(asFiniteNumber(point?.[1], 0), centerZ, scaleZ)
    ]);
    return copy;
  }

  copy.x = transformPoint(asFiniteNumber(copy.x, 0), centerX, scaleX);
  copy.z = transformPoint(asFiniteNumber(copy.z, 0), centerZ, scaleZ);
  return copy;
}

function profileSourceSize(profile) {
  const size = profileSize(profile);
  return [positiveNumber(size.width, 0), positiveNumber(size.height, 0)];
}

function revolveProfileBounds(revolve) {
  const points = Array.isArray(revolve?.profilePoints) ? revolve.profilePoints : [];
  const radii = points.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (!radii.length || !ys.length) return { diameter: 0, length: 0, centerY: 0 };
  const maxRadius = Math.max(...radii.map((value) => Math.abs(value)));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    diameter: maxRadius * 2,
    length: maxY - minY,
    centerY: minY + (maxY - minY) / 2
  };
}

function gearOutsideDiameter(gear) {
  const toothCount = Math.max(1, Math.round(positiveNumber(gear?.toothCount, 24)));
  return (toothCount + 2) * positiveNumber(gear?.moduleMm, 2);
}

function bodyScale(body) {
  return positiveVector(body?.transform?.scale, [1, 1, 1]);
}

function sourceKind(body) {
  return body?.source?.kind ?? SKETCH_EXTRUDE_KIND;
}

function sourceSizeForKind(body) {
  const kind = sourceKind(body);
  if (kind === REVOLVE_KIND) {
    const bounds = revolveProfileBounds(body.revolve);
    return [bounds.diameter, bounds.length, bounds.diameter];
  }
  if (kind === SPUR_GEAR_KIND) {
    const diameter = gearOutsideDiameter(body.gear);
    return [diameter, positiveNumber(body.gear?.thicknessMm ?? body.extrudeDepthMm, 0), diameter];
  }
  if (kind === BOOLEAN_OPERATION_KIND) return [0, 0, 0];

  const outer = body?.sketch?.outerProfile;
  if (!outer) return [0, positiveNumber(body?.extrudeDepthMm, 0), 0];
  const [width, height] = profileSourceSize(outer);
  return [width, positiveNumber(body?.extrudeDepthMm, 0), height];
}

function effectiveSizeFromSource(body, sourceSize = sourceSizeForKind(body)) {
  const scale = bodyScale(body);
  return sourceSize.map((value, index) => positiveNumber(value, 0) * scale[index]);
}

function setPlacementScaleToTarget(body, targetSizeMm, options = {}) {
  const next = cloneJson(body);
  next.transform = createDefaultTransform(next.transform);
  const currentSize = positiveVector(options.currentSizeMm, effectiveSizeFromSource(next));
  const targetSize = targetVector(targetSizeMm, currentSize);

  for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
    if (currentSize[axis] <= 0) throw new Error("Cannot resize a body with zero source bounds.");
    next.transform.scale[axis] = positiveNumber(next.transform.scale[axis], 1) * (targetSize[axis] / currentSize[axis]);
  }
  return next;
}

function resizeSketchBody(body, targetSizeMm, options = {}) {
  const next = cloneJson(body);
  next.transform = createDefaultTransform(next.transform);
  const scale = bodyScale(next);
  const currentSourceSize = sourceSizeForKind(next);
  const currentEffectiveSize = effectiveSizeFromSource(next, currentSourceSize);
  const targetSize = targetVector(targetSizeMm, currentEffectiveSize);
  const targetSourceSize = targetSize.map((value, index) => value / scale[index]);
  const outer = next.sketch?.outerProfile;
  if (!outer) return setPlacementScaleToTarget(next, targetSize, { currentSizeMm: currentEffectiveSize });

  if (outer.type === "circle") {
    const sourceDiameter = positiveNumber(currentSourceSize[0], 0);
    const targetDiameterX = targetSourceSize[0];
    const targetDiameterZ = targetSourceSize[2];
    const uniformCircleResize = Math.abs(targetDiameterX - targetDiameterZ) <= NON_UNIFORM_TOLERANCE;
    next.extrudeDepthMm = positiveNumber(targetSourceSize[1], next.extrudeDepthMm);
    if (uniformCircleResize && sourceDiameter > 0) {
      const radialScale = targetDiameterX / sourceDiameter;
      const [centerX, centerZ] = profileCenterForResize(outer);
      next.sketch.outerProfile = scaleProfileAround(outer, centerX, centerZ, radialScale, radialScale);
      next.sketch.cutProfiles = (next.sketch.cutProfiles ?? []).map((profile) =>
        scaleProfileAround(profile, centerX, centerZ, radialScale, radialScale, {
          scaleDimensions: options.keepCutSizes === false
        })
      );
      return next;
    }

    next.transform.scale[0] = targetSize[0] / positiveNumber(currentSourceSize[0], 1);
    next.transform.scale[2] = targetSize[2] / positiveNumber(currentSourceSize[2], 1);
    return next;
  }

  const scaleX = targetSourceSize[0] / positiveNumber(currentSourceSize[0], 1);
  const scaleZ = targetSourceSize[2] / positiveNumber(currentSourceSize[2], 1);
  const [centerX, centerZ] = profileCenterForResize(outer);
  next.extrudeDepthMm = positiveNumber(targetSourceSize[1], next.extrudeDepthMm);
  next.sketch.outerProfile = scaleProfileAround(outer, centerX, centerZ, scaleX, scaleZ);
  next.sketch.cutProfiles = (next.sketch.cutProfiles ?? []).map((profile) =>
    scaleProfileAround(profile, centerX, centerZ, scaleX, scaleZ, {
      scaleDimensions: options.keepCutSizes === false
    })
  );
  return next;
}

function resizeRevolveBody(body, targetSizeMm, options = {}) {
  const next = cloneJson(body);
  next.transform = createDefaultTransform(next.transform);
  const scale = bodyScale(next);
  const currentSourceSize = sourceSizeForKind(next);
  const currentEffectiveSize = effectiveSizeFromSource(next, currentSourceSize);
  const targetSize = targetVector(targetSizeMm, currentEffectiveSize);
  const targetSourceSize = targetSize.map((value, index) => value / scale[index]);
  const bounds = revolveProfileBounds(next.revolve);

  if (!bounds.diameter || !bounds.length) return setPlacementScaleToTarget(next, targetSize, { currentSizeMm: currentEffectiveSize });

  const radialTarget = (targetSourceSize[0] + targetSourceSize[2]) / 2;
  const radialScale = radialTarget / bounds.diameter;
  const lengthScale = targetSourceSize[1] / bounds.length;

  next.revolve.profilePoints = (next.revolve.profilePoints ?? []).map((point) => [
    asFiniteNumber(point?.[0], 0) * radialScale,
    transformPoint(asFiniteNumber(point?.[1], 0), bounds.centerY, lengthScale)
  ]);
  next.extrudeDepthMm = bounds.length * lengthScale;

  if (Math.abs(targetSourceSize[0] - targetSourceSize[2]) > NON_UNIFORM_TOLERANCE) {
    next.transform.scale[0] = targetSize[0] / positiveNumber(radialTarget, 1);
    next.transform.scale[2] = targetSize[2] / positiveNumber(radialTarget, 1);
  }

  return next;
}

function resizeSpurGearBody(body, targetSizeMm, options = {}) {
  const next = cloneJson(body);
  next.transform = createDefaultTransform(next.transform);
  const scale = bodyScale(next);
  const currentSourceSize = sourceSizeForKind(next);
  const currentEffectiveSize = effectiveSizeFromSource(next, currentSourceSize);
  const targetSize = targetVector(targetSizeMm, currentEffectiveSize);
  const targetSourceSize = targetSize.map((value, index) => value / scale[index]);
  const toothCount = Math.max(1, Math.round(positiveNumber(next.gear?.toothCount, 24)));
  const radialTarget = (targetSourceSize[0] + targetSourceSize[2]) / 2;

  next.gear.moduleMm = positiveNumber(radialTarget / (toothCount + 2), next.gear?.moduleMm ?? 2);
  next.gear.thicknessMm = positiveNumber(targetSourceSize[1], next.gear?.thicknessMm ?? next.extrudeDepthMm);
  next.extrudeDepthMm = next.gear.thicknessMm;

  if (Math.abs(targetSourceSize[0] - targetSourceSize[2]) > NON_UNIFORM_TOLERANCE) {
    next.transform.scale[0] = targetSize[0] / positiveNumber(radialTarget, 1);
    next.transform.scale[2] = targetSize[2] / positiveNumber(radialTarget, 1);
  }

  return next;
}

export function bodySourceSizeMm(body) {
  return sourceSizeForKind(body);
}

export function bodyEffectiveSizeMm(body, compileResult = null) {
  const sourceSize = Array.isArray(compileResult?.bounds?.size)
    ? compileResult.bounds.size.map((value) => positiveNumber(value, 0))
    : bodySourceSizeMm(body);
  return effectiveSizeFromSource(body, sourceSize);
}

export function targetSizeFromAxisEdit(currentSizeMm, axis, value, uniform = true) {
  const currentSize = positiveVector(currentSizeMm, [0, 0, 0]);
  const targetValue = Number(value);
  const editAxis = Number(axis);
  if (!Number.isInteger(editAxis) || editAxis < 0 || editAxis >= AXIS_COUNT) {
    throw new Error("Resize axis must be X, Y, or Z.");
  }
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    throw new Error("Target size must be a positive millimeter value.");
  }
  if (uniform) {
    if (currentSize[editAxis] <= 0) throw new Error("Cannot resize uniformly from a zero-size axis.");
    const factor = targetValue / currentSize[editAxis];
    return currentSize.map((size) => positiveNumber(size * factor, MIN_SIZE_MM));
  }

  const target = [...currentSize];
  target[editAxis] = targetValue;
  return target;
}

export function resizePartBodyToTargetSize(body, targetSizeMm, options = {}) {
  const kind = sourceKind(body);
  if (kind === REVOLVE_KIND) return resizeRevolveBody(body, targetSizeMm, options);
  if (kind === SPUR_GEAR_KIND) return resizeSpurGearBody(body, targetSizeMm, options);
  if (kind === BOOLEAN_OPERATION_KIND) return setPlacementScaleToTarget(body, targetSizeMm, options);
  return resizeSketchBody(body, targetSizeMm, options);
}
