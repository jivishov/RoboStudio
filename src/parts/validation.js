import { sanitizePartId } from "./contracts.js";
import {
  BOOLEAN_OPERATION_KIND,
  PART_BODY_SOURCE_KINDS,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND
} from "./contracts.js";
import { validateBooleanFeature, validateRevolveFeature } from "./featureOps.js";
import { validateSpurGearSpec } from "./gears.js";
import { CUT_PROFILE_TYPES, OUTER_PROFILE_TYPES, profileBounds, profileIsClosed } from "./sketch.js";

function issue(code, message, path, severity = "error") {
  return { code, message, path, severity };
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function positive(value) {
  return finite(value) && Number(value) > 0;
}

function validateStableId(value, path, issues) {
  if (!value || sanitizePartId(value) !== value) {
    issues.push(issue("unstable-id", "IDs must be lowercase, stable, and URL-safe.", path));
  }
}

function validateProfileDimensions(profile, path, issues) {
  if (profile.type === "circle") {
    if (!finite(profile.x) || !finite(profile.z) || !positive(profile.radius)) {
      issues.push(issue("invalid-profile-dimension", "Circle profiles need finite X/Z and a positive radius.", path));
    }
    return;
  }

  if (profile.type === "roundedSlot") {
    if (!finite(profile.x) || !finite(profile.z) || !positive(profile.length) || !positive(profile.width)) {
      issues.push(issue("invalid-profile-dimension", "Slot profiles need finite X/Z plus positive length and width.", path));
    }
    if (positive(profile.length) && positive(profile.width) && Number(profile.length) < Number(profile.width)) {
      issues.push(issue("invalid-slot-dimension", "Slot length must be greater than or equal to width.", path));
    }
    return;
  }

  if (profile.type === "polyline") {
    const points = Array.isArray(profile.points) ? profile.points : [];
    if (profile.closed !== true) {
      issues.push(issue("open-profile", "Polyline profiles must be closed.", path));
    }
    if (points.length < 3) {
      issues.push(issue("invalid-polyline", "Closed polylines need at least three points.", path));
    }
    for (const [index, point] of points.entries()) {
      if (!finite(point?.[0]) || !finite(point?.[1])) {
        issues.push(issue("invalid-profile-dimension", "Polyline points must use finite X/Z coordinates.", `${path}.points.${index}`));
      }
    }
    return;
  }

  if (!finite(profile.x) || !finite(profile.z) || !positive(profile.width) || !positive(profile.height)) {
    issues.push(issue("invalid-profile-dimension", "Rectangle profiles need finite X/Z plus positive width and height.", path));
  }
  if (profile.cornerRadius != null && (!finite(profile.cornerRadius) || Number(profile.cornerRadius) < 0)) {
    issues.push(issue("invalid-profile-dimension", "Rectangle corner radius cannot be negative.", path));
  }
}

function boundsContain(outer, inner) {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minZ >= outer.minZ &&
    inner.maxZ <= outer.maxZ
  );
}

function pointInPolyline(point, points) {
  let inside = false;
  const [x, z] = point;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, zi] = points[index];
    const [xj, zj] = points[previous];
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInRoundedSlot(point, profile) {
  const [x, z] = point;
  const radius = profile.width / 2;
  const halfStraight = Math.max(0, (profile.length - profile.width) / 2);
  const clampedX = Math.min(profile.x + halfStraight, Math.max(profile.x - halfStraight, x));
  return Math.hypot(x - clampedX, z - profile.z) <= radius + 1e-6;
}

function pointInProfile(point, profile) {
  if (!profileBounds(profile)) return false;

  if (profile.type === "circle") {
    return Math.hypot(point[0] - profile.x, point[1] - profile.z) <= profile.radius + 1e-6;
  }

  if (profile.type === "roundedSlot") {
    return pointInRoundedSlot(point, profile);
  }

  if (profile.type === "polyline") {
    return pointInPolyline(point, profile.points ?? []);
  }

  return boundsContain(profileBounds(profile), {
    minX: point[0],
    maxX: point[0],
    minZ: point[1],
    maxZ: point[1]
  });
}

function sampledCirclePoints(profile, count = 16) {
  return Array.from({ length: count }, (_item, index) => {
    const angle = (Math.PI * 2 * index) / count;
    return [profile.x + Math.cos(angle) * profile.radius, profile.z + Math.sin(angle) * profile.radius];
  });
}

function sampledRoundedSlotPoints(profile, count = 8) {
  const radius = profile.width / 2;
  const halfStraight = Math.max(0, (profile.length - profile.width) / 2);
  const left = profile.x - halfStraight;
  const right = profile.x + halfStraight;
  const points = [
    [left, profile.z - radius],
    [right, profile.z - radius],
    [right, profile.z + radius],
    [left, profile.z + radius]
  ];
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * index) / (count - 1);
    points.push([right + Math.cos(angle) * radius, profile.z + Math.sin(angle) * radius]);
  }
  for (let index = 0; index < count; index += 1) {
    const angle = Math.PI / 2 + (Math.PI * index) / (count - 1);
    points.push([left + Math.cos(angle) * radius, profile.z + Math.sin(angle) * radius]);
  }
  return points;
}

function sampledRectanglePoints(profile) {
  const bounds = profileBounds(profile);
  if (!bounds) return [];
  return [
    [bounds.minX, bounds.minZ],
    [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ],
    [bounds.minX, bounds.maxZ]
  ];
}

function sampledProfileBoundaryPoints(profile) {
  if (profile.type === "circle") return sampledCirclePoints(profile);
  if (profile.type === "roundedSlot") return sampledRoundedSlotPoints(profile);
  if (profile.type === "polyline") return profile.points ?? [];
  return sampledRectanglePoints(profile);
}

function profileContainsCut(outerProfile, cutProfile) {
  const outerBounds = profileBounds(outerProfile);
  const cutBounds = profileBounds(cutProfile);
  if (!outerBounds || !cutBounds || !boundsContain(outerBounds, cutBounds)) return false;
  return sampledProfileBoundaryPoints(cutProfile).every((point) => pointInProfile(point, outerProfile));
}

export function validateBody(body, options = {}) {
  const path = options.path ?? `bodies.${body?.id ?? "unknown"}`;
  const issues = [];
  const profileIds = new Set();
  const sourceKind = body?.source?.kind ?? SKETCH_EXTRUDE_KIND;

  validateStableId(body?.id, `${path}.id`, issues);
  if (!body?.name || !String(body.name).trim()) {
    issues.push(issue("missing-body-name", "Body name is required.", `${path}.name`));
  }
  if (!PART_BODY_SOURCE_KINDS.includes(sourceKind)) {
    issues.push(issue("unsupported-body-source", `Unsupported body source kind: ${sourceKind}.`, `${path}.source.kind`));
    return issues;
  }

  if (sourceKind === REVOLVE_KIND) {
    issues.push(...validateRevolveFeature(body?.revolve, `${path}.revolve`));
    return issues;
  }

  if (sourceKind === SPUR_GEAR_KIND) {
    issues.push(...validateSpurGearSpec(body?.gear, `${path}.gear`));
    return issues;
  }

  if (sourceKind === BOOLEAN_OPERATION_KIND) {
    issues.push(...validateBooleanFeature(body?.boolean, `${path}.boolean`, options.bodyIds ?? null, body?.id ?? null));
    return issues;
  }

  if (!positive(body?.extrudeDepthMm)) {
    issues.push(issue("invalid-extrude-depth", "Extrusion depth must be a positive millimeter value.", `${path}.extrudeDepthMm`));
  }

  const outerProfile = body?.sketch?.outerProfile;
  if (!outerProfile) {
    issues.push(issue("missing-outer-profile", "One closed outer profile is required.", `${path}.sketch.outerProfile`));
  } else {
    validateStableId(outerProfile.id, `${path}.sketch.outerProfile.id`, issues);
    if (profileIds.has(outerProfile.id)) {
      issues.push(issue("duplicate-profile-id", "Profile IDs must be unique within a body.", `${path}.sketch.outerProfile.id`));
    }
    profileIds.add(outerProfile.id);
    if (!OUTER_PROFILE_TYPES.includes(outerProfile.type)) {
      issues.push(issue("unsupported-profile", `Unsupported outer profile type: ${outerProfile.type}.`, `${path}.sketch.outerProfile.type`));
    }
    if (!profileIsClosed(outerProfile)) {
      issues.push(issue("open-outer-profile", "The outer profile must be closed.", `${path}.sketch.outerProfile`));
    }
    validateProfileDimensions(outerProfile, `${path}.sketch.outerProfile`, issues);
  }

  const cuts = Array.isArray(body?.sketch?.cutProfiles) ? body.sketch.cutProfiles : [];
  for (const [index, cutProfile] of cuts.entries()) {
    const cutPath = `${path}.sketch.cutProfiles.${index}`;
    validateStableId(cutProfile?.id, `${cutPath}.id`, issues);
    if (profileIds.has(cutProfile?.id)) {
      issues.push(issue("duplicate-profile-id", "Profile IDs must be unique within a body.", `${cutPath}.id`));
    }
    profileIds.add(cutProfile?.id);
    if (!CUT_PROFILE_TYPES.includes(cutProfile?.type)) {
      issues.push(issue("unsupported-profile", `Unsupported cut profile type: ${cutProfile?.type}.`, `${cutPath}.type`));
    }
    if (!profileIsClosed(cutProfile)) {
      issues.push(issue("open-cut-profile", "Cut profiles must be closed.", cutPath));
    }
    validateProfileDimensions(cutProfile, cutPath, issues);
    if (outerProfile && profileBounds(cutProfile) && !profileContainsCut(outerProfile, cutProfile)) {
      issues.push(issue("cut-outside-outer-profile", "Holes and cuts must stay inside the outer profile bounds.", cutPath));
    }
  }

  return issues;
}

export function validatePartProject(project) {
  const issues = [];
  if (project?.version !== 1) {
    issues.push(issue("unsupported-project-version", "PartProject version must be 1.", "version"));
  }
  if (project?.units !== "mm") {
    issues.push(issue("unsupported-units", "PartProject units must be millimeters.", "units"));
  }
  if (!Array.isArray(project?.bodies)) {
    issues.push(issue("invalid-bodies", "PartProject bodies must be an array.", "bodies"));
    return issues;
  }

  const bodyIds = new Set(project.bodies.map((body) => body?.id));
  for (const [index, body] of project.bodies.entries()) {
    validateStableId(body?.id, `bodies.${index}.id`, issues);
    if (project.bodies.findIndex((item) => item?.id === body?.id) !== index) {
      issues.push(issue("duplicate-body-id", "Body IDs must be unique.", `bodies.${index}.id`));
    }
    issues.push(...validateBody(body, { path: `bodies.${index}`, bodyIds }));
  }

  if (project.selectedBodyId && !bodyIds.has(project.selectedBodyId)) {
    issues.push(issue("invalid-selection", "Selected body must exist in the project.", "selectedBodyId"));
  }

  return issues;
}
