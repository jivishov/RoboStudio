import { normalizePartProject } from "./projectState.js";

export function serializePartProject(project) {
  return JSON.stringify(normalizePartProject(project), null, 2);
}

export function parsePartProjectJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`PartProject JSON is invalid: ${error.message}`);
  }

  return normalizePartProject(parsed);
}
