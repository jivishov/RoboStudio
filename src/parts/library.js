import {
  BOOLEAN_OPERATION_KIND,
  cloneJson,
  createPartProject,
  sanitizePartId,
  timestampNow,
  uniquePartId
} from "./contracts.js";
import { normalizePartProject } from "./projectState.js";
import { validatePartProject } from "./validation.js";

export const PART_LIBRARY_ITEM_VERSION = 1;
export const PART_LIBRARY_BUNDLE_VERSION = 1;

function stableId(value, path) {
  const id = String(value ?? "").trim();
  if (!id || sanitizePartId(id) !== id) {
    throw new Error(`${path} must be a stable lowercase id.`);
  }
  return id;
}

function nonEmptyName(value, fallback = "Library part") {
  const name = String(value ?? "").trim();
  return name || fallback;
}

function dateString(value) {
  return typeof value === "string" && value ? value : timestampNow();
}

function bodyMapFor(project) {
  return new Map((project.bodies ?? []).map((body) => [body.id, body]));
}

function validateLibraryProject(bodies, primaryBodyId) {
  const project = createPartProject({
    bodies,
    selectedBodyId: primaryBodyId,
    updatedAt: timestampNow()
  });
  const issues = validatePartProject(project);
  if (issues.length) {
    throw new Error(`Part library item is invalid: ${issues[0].message}`);
  }
}

export function collectPartLibraryBodyIds(projectInput, primaryBodyId) {
  const project = normalizePartProject(projectInput);
  const bodiesById = bodyMapFor(project);
  const selectedId = primaryBodyId ?? project.selectedBodyId;
  if (!selectedId || !bodiesById.has(selectedId)) {
    throw new Error("Select a valid body before saving to the library.");
  }

  const visiting = new Set();
  const visited = new Set();
  const orderedIds = [];

  function visit(bodyId) {
    if (!bodiesById.has(bodyId)) {
      throw new Error(`Cannot save a boolean body with a missing operand: ${bodyId}.`);
    }
    if (visiting.has(bodyId)) {
      throw new Error("Cannot save a boolean body with cyclic operand references.");
    }
    if (visited.has(bodyId)) return;

    visiting.add(bodyId);
    const body = bodiesById.get(bodyId);
    if (body.source?.kind === BOOLEAN_OPERATION_KIND) {
      for (const operandId of body.boolean?.operandBodyIds ?? []) visit(operandId);
    }
    visiting.delete(bodyId);
    visited.add(bodyId);
    orderedIds.push(bodyId);
  }

  visit(selectedId);
  return orderedIds;
}

export function createPartLibraryItem(projectInput, primaryBodyId, options = {}) {
  const project = normalizePartProject(projectInput);
  const selectedId = primaryBodyId ?? project.selectedBodyId;
  const bodyIds = collectPartLibraryBodyIds(project, selectedId);
  const bodiesById = bodyMapFor(project);
  const bodies = bodyIds.map((bodyId) => cloneJson(bodiesById.get(bodyId)));
  const primaryBody = bodiesById.get(selectedId);
  validateLibraryProject(bodies, selectedId);

  const existingIds = options.existingIds ?? new Set();
  const now = options.updatedAt ?? timestampNow();
  const name = nonEmptyName(options.name, primaryBody.name);
  const id = uniquePartId(options.id ?? name, existingIds, "library_part");

  return {
    version: PART_LIBRARY_ITEM_VERSION,
    id,
    name,
    primaryBodyId: selectedId,
    bodies,
    createdAt: options.createdAt ?? now,
    updatedAt: now
  };
}

export function normalizePartLibraryItem(input = {}) {
  if (input?.version !== PART_LIBRARY_ITEM_VERSION) {
    throw new Error("Part library item version must be 1.");
  }
  const id = stableId(input.id, "Part library item id");
  const primaryBodyId = stableId(input.primaryBodyId, "Part library primary body id");
  if (!Array.isArray(input.bodies) || !input.bodies.length) {
    throw new Error("Part library item needs at least one body.");
  }

  const project = normalizePartProject({
    bodies: input.bodies,
    selectedBodyId: primaryBodyId,
    updatedAt: input.updatedAt
  });
  if (!project.bodies.some((body) => body.id === primaryBodyId)) {
    throw new Error("Part library primary body must exist in the saved bodies.");
  }
  validateLibraryProject(project.bodies, primaryBodyId);

  return {
    version: PART_LIBRARY_ITEM_VERSION,
    id,
    name: nonEmptyName(input.name, project.bodies.find((body) => body.id === primaryBodyId)?.name),
    primaryBodyId,
    bodies: project.bodies,
    createdAt: dateString(input.createdAt),
    updatedAt: dateString(input.updatedAt)
  };
}

export function partLibraryItemSummary(itemInput) {
  const item = normalizePartLibraryItem(itemInput);
  const primaryBody = item.bodies.find((body) => body.id === item.primaryBodyId) ?? item.bodies[0];
  return {
    id: item.id,
    name: item.name,
    primaryBodyId: item.primaryBodyId,
    bodyCount: item.bodies.length,
    sourceKind: primaryBody?.source?.kind ?? "unknown",
    updatedAt: item.updatedAt
  };
}

export function addPartLibraryItemToProject(projectInput, itemInput, options = {}) {
  const project = normalizePartProject(projectInput);
  const item = normalizePartLibraryItem(itemInput);
  const usedIds = new Set(project.bodies.map((body) => body.id));
  const idMap = new Map();

  for (const body of item.bodies) {
    const nextId = uniquePartId(body.id, usedIds, "body");
    usedIds.add(nextId);
    idMap.set(body.id, nextId);
  }

  const addedBodies = item.bodies.map((body) => {
    const nextBody = cloneJson(body);
    nextBody.id = idMap.get(body.id);
    if (nextBody.source?.kind === BOOLEAN_OPERATION_KIND) {
      nextBody.boolean = {
        ...nextBody.boolean,
        operandBodyIds: (nextBody.boolean?.operandBodyIds ?? []).map((bodyId) => idMap.get(bodyId) ?? bodyId)
      };
    }
    return nextBody;
  });
  const primaryBodyId = idMap.get(item.primaryBodyId);
  const nextProject = normalizePartProject({
    ...project,
    bodies: [...project.bodies, ...addedBodies],
    selectedBodyId: primaryBodyId,
    updatedAt: options.updatedAt ?? timestampNow()
  });
  const issues = validatePartProject(nextProject);
  if (issues.length) {
    throw new Error(`Library part could not be added: ${issues[0].message}`);
  }

  return {
    project: nextProject,
    primaryBodyId,
    addedBodyIds: addedBodies.map((body) => body.id)
  };
}

export function normalizePartLibraryBundle(input = {}) {
  if (input?.version !== PART_LIBRARY_BUNDLE_VERSION) {
    throw new Error("Part library bundle version must be 1.");
  }
  if (!Array.isArray(input.items)) {
    throw new Error("Part library bundle needs an items array.");
  }
  const itemsById = new Map();
  for (const rawItem of input.items) {
    const item = normalizePartLibraryItem(rawItem);
    itemsById.set(item.id, item);
  }
  return {
    version: PART_LIBRARY_BUNDLE_VERSION,
    exportedAt: dateString(input.exportedAt),
    items: [...itemsById.values()]
  };
}

export function serializePartLibraryBundle(items = [], options = {}) {
  const bundle = {
    version: PART_LIBRARY_BUNDLE_VERSION,
    exportedAt: options.exportedAt ?? timestampNow(),
    items: items.map((item) => normalizePartLibraryItem(item))
  };
  return JSON.stringify(bundle, null, 2);
}

export function parsePartLibraryBundleJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Part library JSON is invalid: ${error.message}`);
  }
  return normalizePartLibraryBundle(parsed);
}

export function mergePartLibraryItems(existingItems = [], importedItems = []) {
  const itemsById = new Map();
  for (const item of existingItems) {
    const normalized = normalizePartLibraryItem(item);
    itemsById.set(normalized.id, normalized);
  }
  for (const item of importedItems) {
    const normalized = normalizePartLibraryItem(item);
    itemsById.set(normalized.id, normalized);
  }
  return [...itemsById.values()];
}
