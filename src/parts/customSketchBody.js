import {
  DEFAULT_BODY_COLOR,
  DEFAULT_EXTRUDE_DEPTH_MM,
  SKETCH_EXTRUDE_KIND,
  cloneJson,
  createDefaultTransform,
  createSketchExtrudeBody,
  sanitizePartId,
  uniquePartId
} from "./contracts.js";
import { CUT_PROFILE_TYPES, OUTER_PROFILE_TYPES } from "./sketch.js";
import { validateBody } from "./validation.js";

function issue(code, message, path, severity = "error") {
  return { code, message, path, severity };
}

function finiteOrDefault(value, fallback) {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function normalizeProfileId(profile, fallbackId, existingIds) {
  const cleanId = sanitizePartId(profile?.id ?? fallbackId, fallbackId);
  const id = uniquePartId(cleanId, existingIds, fallbackId);
  existingIds.add(id);
  return id;
}

function normalizePoint(point) {
  if (!Array.isArray(point)) return [point?.[0], point?.[1]];
  return [finiteOrDefault(point[0], 0), finiteOrDefault(point[1], 0)];
}

function normalizeCustomProfile(profile, options, issues) {
  const path = options.path;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    issues.push(issue("invalid-profile", "Profile must be an object.", path));
    return null;
  }

  const type = String(profile.type ?? "");
  if (!options.allowedTypes.includes(type)) {
    issues.push(issue("unsupported-profile", `Unsupported ${options.role} profile type: ${type || "missing"}.`, `${path}.type`));
    return null;
  }

  const id = normalizeProfileId(profile, options.fallbackId, options.existingIds);
  if (type === "circle") {
    return {
      id,
      type,
      x: finiteOrDefault(profile.x, 0),
      z: finiteOrDefault(profile.z, 0),
      radius: finiteOrDefault(profile.radius, 10)
    };
  }

  if (type === "roundedSlot") {
    return {
      id,
      type,
      x: finiteOrDefault(profile.x, 0),
      z: finiteOrDefault(profile.z, 0),
      length: finiteOrDefault(profile.length, 40),
      width: finiteOrDefault(profile.width, 10)
    };
  }

  if (type === "polyline") {
    return {
      id,
      type,
      points: Array.isArray(profile.points) ? profile.points.map(normalizePoint) : [],
      closed: profile.closed !== false
    };
  }

  return {
    id,
    type,
    x: finiteOrDefault(profile.x, 0),
    z: finiteOrDefault(profile.z, 0),
    width: finiteOrDefault(profile.width, 80),
    height: finiteOrDefault(profile.height, 50),
    cornerRadius: finiteOrDefault(profile.cornerRadius, 0)
  };
}

function normalizeSketchFromArgs(args = {}) {
  const issues = [];
  const profileIds = new Set();
  const outerProfile = normalizeCustomProfile(
    args.outerProfile,
    {
      role: "outer",
      path: "outerProfile",
      fallbackId: "outer",
      allowedTypes: OUTER_PROFILE_TYPES,
      existingIds: profileIds
    },
    issues
  );
  const cutProfiles = Array.isArray(args.cutProfiles)
    ? args.cutProfiles
        .map((profile, index) =>
          normalizeCustomProfile(
            profile,
            {
              role: "cut",
              path: `cutProfiles.${index}`,
              fallbackId: `cut_${index + 1}`,
              allowedTypes: CUT_PROFILE_TYPES,
              existingIds: profileIds
            },
            issues
          )
        )
        .filter(Boolean)
    : [];

  return {
    sketch: { outerProfile, cutProfiles },
    issues
  };
}

function designIntentFromArgs(args = {}) {
  return typeof args.designIntent === "string" ? args.designIntent.trim().slice(0, 800) : "";
}

function colorFromArgs(args = {}, fallback = DEFAULT_BODY_COLOR) {
  return typeof args.color === "string" && /^#[0-9a-f]{6}$/i.test(args.color) ? args.color : fallback;
}

function customSketchResult(body, initialIssues = [], designIntent = "") {
  const validationIssues = [...initialIssues, ...validateBody(body)];
  return {
    accepted: validationIssues.length === 0,
    body,
    validationIssues,
    designIntent
  };
}

export function createCustomSketchBodyFromArgs(args = {}, options = {}) {
  const { sketch, issues } = normalizeSketchFromArgs(args);
  const body = createSketchExtrudeBody(
    {
      name: args.name,
      color: colorFromArgs(args),
      transform: args.transform,
      source: { kind: SKETCH_EXTRUDE_KIND },
      sketch,
      extrudeDepthMm: finiteOrDefault(args.extrudeDepthMm, DEFAULT_EXTRUDE_DEPTH_MM)
    },
    options.existingBodyIds
  );
  return customSketchResult(body, issues, designIntentFromArgs(args));
}

export function replaceSketchBodyFromArgs(currentBody, args = {}) {
  const { sketch, issues } = normalizeSketchFromArgs(args);
  const body = {
    ...cloneJson(currentBody),
    name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : currentBody.name,
    color: colorFromArgs(args, currentBody.color),
    transform: createDefaultTransform(args.transform ?? currentBody.transform),
    source: { kind: SKETCH_EXTRUDE_KIND },
    sketch,
    extrudeDepthMm: finiteOrDefault(args.extrudeDepthMm, currentBody.extrudeDepthMm)
  };
  return customSketchResult(body, issues, designIntentFromArgs(args));
}
