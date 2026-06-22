import {
  DEFAULT_BODY_COLOR,
  DEFAULT_EXTRUDE_DEPTH_MM,
  ADVANCED_CAD_RECIPE_KIND,
  BOOLEAN_OPERATION_KIND,
  PART_PROJECT_VERSION,
  PART_UNITS,
  REVOLVE_KIND,
  SKETCH_EXTRUDE_KIND,
  SPUR_GEAR_KIND,
  asFiniteNumber,
  asPositiveNumber,
  cloneJson,
  createDefaultTransform,
  createPartProject,
  normalizeBodySource,
  timestampNow,
  uniquePartId
} from "./contracts.js";
import { normalizeBooleanFeature, normalizeRevolveFeature, revolveLengthMm } from "./featureOps.js";
import { normalizeSpurGearSpec } from "./gears.js";
import { normalizeAdvancedCadRecipe } from "./advancedCadRecipe.js";
import { normalizeProfile } from "./sketch.js";

const HISTORY_LIMIT = 60;

function normalizeColor(value) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_BODY_COLOR;
}

function normalizeSketch(sketch = {}) {
  const profileIds = new Set();
  const outerProfile = sketch.outerProfile
    ? normalizeProfile(sketch.outerProfile, { fallbackId: "outer", existingIds: profileIds })
    : null;
  if (outerProfile) profileIds.add(outerProfile.id);

  const cutProfiles = Array.isArray(sketch.cutProfiles)
    ? sketch.cutProfiles.map((profile, index) => {
        const normalized = normalizeProfile(profile, {
          fallbackId: `cut_${index + 1}`,
          fallbackType: "circle",
          existingIds: profileIds
        });
        profileIds.add(normalized.id);
        return normalized;
      })
    : [];

  return { outerProfile, cutProfiles };
}

export function normalizePartBody(body = {}, existingIds = new Set()) {
  const id = uniquePartId(body.id ?? body.name ?? "body", existingIds, "body");
  const source = normalizeBodySource(body.source);
  const normalized = {
    id,
    name: String(body.name ?? id).trim() || id,
    color: normalizeColor(body.color),
    transform: createDefaultTransform(body.transform),
    source,
    sketch: normalizeSketch(body.sketch),
    extrudeDepthMm: asPositiveNumber(body.extrudeDepthMm, DEFAULT_EXTRUDE_DEPTH_MM)
  };

  if (source.kind === REVOLVE_KIND) {
    normalized.revolve = normalizeRevolveFeature(body.revolve);
    normalized.extrudeDepthMm = revolveLengthMm(normalized.revolve);
  }

  if (source.kind === SPUR_GEAR_KIND) {
    normalized.gear = normalizeSpurGearSpec(body.gear);
    normalized.extrudeDepthMm = normalized.gear.thicknessMm;
  }

  if (source.kind === BOOLEAN_OPERATION_KIND) {
    normalized.boolean = normalizeBooleanFeature(body.boolean);
  }

  if (source.kind === ADVANCED_CAD_RECIPE_KIND) {
    normalized.advancedCadRecipe = normalizeAdvancedCadRecipe(body.advancedCadRecipe);
  }

  if (source.kind !== SKETCH_EXTRUDE_KIND) {
    normalized.sketch = { outerProfile: null, cutProfiles: [] };
  }

  return normalized;
}

export function normalizePartProject(project = {}) {
  const usedIds = new Set();
  const bodies = Array.isArray(project.bodies)
    ? project.bodies.map((body) => {
        const normalized = normalizePartBody(body, usedIds);
        usedIds.add(normalized.id);
        return normalized;
      })
    : [];
  const selectedBodyId = bodies.some((body) => body.id === project.selectedBodyId)
    ? project.selectedBodyId
    : bodies[0]?.id ?? null;

  return createPartProject({
    bodies,
    selectedBodyId,
    updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : timestampNow()
  });
}

function touchProject(project, updatedAt = timestampNow()) {
  return normalizePartProject({ ...project, updatedAt });
}

export function selectedBody(project) {
  const normalized = normalizePartProject(project);
  return normalized.bodies.find((body) => body.id === normalized.selectedBodyId) ?? null;
}

export function addBody(project, body, options = {}) {
  const normalized = normalizePartProject(project);
  const usedIds = new Set(normalized.bodies.map((item) => item.id));
  const nextBody = normalizePartBody(body, usedIds);
  return touchProject(
    {
      ...normalized,
      bodies: [...normalized.bodies, nextBody],
      selectedBodyId: nextBody.id
    },
    options.updatedAt
  );
}

export function selectBody(project, bodyId, options = {}) {
  const normalized = normalizePartProject(project);
  const selectedBodyId = normalized.bodies.some((body) => body.id === bodyId)
    ? bodyId
    : normalized.selectedBodyId;
  return touchProject({ ...normalized, selectedBodyId }, options.updatedAt);
}

export function updateBody(project, bodyId, updater, options = {}) {
  const normalized = normalizePartProject(project);
  const bodies = normalized.bodies.map((body) => {
    if (body.id !== bodyId) return body;
    const draft = cloneJson(body);
    const updated = updater(draft) ?? draft;
    return updated;
  });
  return touchProject({ ...normalized, bodies }, options.updatedAt);
}

export function duplicateBody(project, bodyId, options = {}) {
  const normalized = normalizePartProject(project);
  const body = normalized.bodies.find((item) => item.id === bodyId);
  if (!body) return normalized;

  const usedIds = new Set(normalized.bodies.map((item) => item.id));
  const duplicate = cloneJson(body);
  duplicate.id = uniquePartId(`${body.id}_copy`, usedIds, "body");
  duplicate.name = `${body.name} copy`;
  duplicate.transform.position[0] = asFiniteNumber(duplicate.transform.position[0], 0) + 12;

  return touchProject(
    {
      ...normalized,
      bodies: [...normalized.bodies, duplicate],
      selectedBodyId: duplicate.id
    },
    options.updatedAt
  );
}

export function deleteBody(project, bodyId, options = {}) {
  const normalized = normalizePartProject(project);
  const bodies = normalized.bodies.filter((body) => body.id !== bodyId);
  const selectedBodyId =
    normalized.selectedBodyId === bodyId ? bodies[0]?.id ?? null : normalized.selectedBodyId;

  return touchProject({ ...normalized, bodies, selectedBodyId }, options.updatedAt);
}

export function createProjectHistory(initialProject = createPartProject(), options = {}) {
  return {
    current: normalizePartProject(initialProject),
    undoStack: [],
    redoStack: [],
    limit: options.limit ?? HISTORY_LIMIT
  };
}

export function resetProjectHistory(history, project = createPartProject()) {
  history.current = normalizePartProject(project);
  history.undoStack = [];
  history.redoStack = [];
  return history.current;
}

export function commitProject(history, nextProject) {
  const normalized = normalizePartProject(nextProject);
  if (JSON.stringify(normalized) === JSON.stringify(history.current)) return history.current;

  history.undoStack.push(history.current);
  if (history.undoStack.length > history.limit) history.undoStack.shift();
  history.current = normalized;
  history.redoStack = [];
  return history.current;
}

export function undoProject(history) {
  if (!history.undoStack.length) return history.current;
  history.redoStack.push(history.current);
  history.current = history.undoStack.pop();
  return history.current;
}

export function redoProject(history) {
  if (!history.redoStack.length) return history.current;
  history.undoStack.push(history.current);
  history.current = history.redoStack.pop();
  return history.current;
}

export function projectSummary(project) {
  const normalized = normalizePartProject(project);
  return {
    version: PART_PROJECT_VERSION,
    units: PART_UNITS,
    bodyCount: normalized.bodies.length,
    selectedBodyId: normalized.selectedBodyId,
    updatedAt: normalized.updatedAt
  };
}
