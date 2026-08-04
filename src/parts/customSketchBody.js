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
import { createIssue as issue } from "./issues.js";
import { resolveHole } from "./holes.js";
import { CUT_PROFILE_TYPES, OUTER_PROFILE_TYPES, circleHoleFields } from "./sketch.js";
import { validateBody } from "./validation.js";

/**
 * A number, the caller's default for an omitted field, or the original value untouched.
 *
 * Deliberately not `asFiniteNumber` (`contracts.js`), which substitutes the fallback for
 * anything non-finite. This module builds a body that `validateBody` then judges, so a
 * garbage `radius: "wide"` has to survive coercion in order to be *reported*. Replacing
 * it with a plausible default here would hand the gate a valid body and lose the finding.
 * `undefined` alone means "field omitted", and only that takes the fallback.
 */
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
    // `hole` is registered here as well as in `createCircleProfile`, because this is a
    // second circle-profile whitelist: the assistant's custom-sketch path never goes
    // through `sketch.js`, so an assistant asked for "a plate with M3 clearance holes"
    // would otherwise get free radii and no indication that the standard was dropped.
    // The standards rule itself lives in `circleHoleFields`, so only the radius
    // default is local.
    const { hole, radius } = circleHoleFields(profile, finiteOrDefault(profile.radius, 10));
    const resolved = resolveHole(profile.hole);
    if (resolved && !resolved.ok) {
      // Refused loudly rather than persisted: the assistant sees the reason and can
      // correct itself, where a stored refusal only resurfaces later as a warning.
      issues.push(issue("unresolvable-hole-standard", resolved.reason, `${path}.hole`));
    }
    const circle = { id, type, x: finiteOrDefault(profile.x, 0), z: finiteOrDefault(profile.z, 0), radius };
    if (hole) circle.hole = hole;
    return circle;
  }

  if (profile.hole !== undefined) {
    issues.push(issue(
      "unsupported-hole-profile",
      `A fastener standard can only be attached to a circular cut profile, not to a ${type}.`,
      `${path}.hole`
    ));
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
