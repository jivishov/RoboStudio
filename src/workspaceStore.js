import {
  CIRCUIT_DESIGN_STORE_NAME,
  CURRENT_CIRCUIT_DESIGN_KEY,
  CURRENT_CIRCUIT_LAB_PROJECT_KEY,
  CURRENT_DESIGN_KEY,
  CURRENT_MECHATRONICS_BINDING_KEY,
  CURRENT_SNAPSHOT_KEY,
  deleteWorkspaceValue,
  DESIGN_STORE_NAME,
  PART_LIBRARY_STORE_NAME,
  readAllWorkspaceValues,
  readWorkspaceValue,
  SNAPSHOT_STORE_NAME,
  writeWorkspaceBatch,
  writeWorkspaceValue
} from "./workspaceDb.js";
import {
  CIRCUIT_LAB_KIND,
  CIRCUIT_LAB_UNITS,
  CIRCUIT_LAB_VERSION,
  normalizeProject as normalizeCircuitLabProject
} from "./circuits/model.js";
import {
  circuitCustomComponentStorageKey,
  isCircuitCustomComponentDefinition,
  normalizeCircuitCustomComponentDefinition
} from "./circuits/customComponents.js";
import { normalizeMechatronicsBinding } from "./mechatronics/model.js";

function normalizeWorkspaceCircuitLabProject(project) {
  if (project?.kind != null && project.kind !== CIRCUIT_LAB_KIND) {
    throw new Error("Circuit Lab workspace state must use kind CircuitLabProject.");
  }
  if (project?.version != null && Number(project.version) !== CIRCUIT_LAB_VERSION) {
    throw new Error("Circuit Lab workspace state must use version 1.");
  }
  if (project?.units != null && project.units !== CIRCUIT_LAB_UNITS) {
    throw new Error("Circuit Lab workspace state must use millimeters.");
  }
  return normalizeCircuitLabProject(project);
}

export class WorkspaceStore {
  constructor(options = {}) {
    this.options = options;
  }

  readCurrentAssemblySnapshot() {
    return readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, this.options);
  }

  writeCurrentAssemblySnapshot(snapshot) {
    return writeWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, snapshot, this.options);
  }

  readCurrentRobotDesign() {
    return readWorkspaceValue(DESIGN_STORE_NAME, CURRENT_DESIGN_KEY, this.options);
  }

  writeCurrentRobotDesign(design) {
    return writeWorkspaceValue(DESIGN_STORE_NAME, CURRENT_DESIGN_KEY, design, this.options);
  }

  readCurrentCircuitDesign() {
    return readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, this.options);
  }

  writeCurrentCircuitDesign(design) {
    return writeWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, design, this.options);
  }

  deleteCurrentCircuitDesign() {
    return deleteWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, this.options);
  }

  readCurrentCircuitLabProject() {
    return readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_LAB_PROJECT_KEY, this.options);
  }

  writeCurrentCircuitLabProject(project) {
    return writeWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_LAB_PROJECT_KEY, project, this.options);
  }

  deleteCurrentCircuitLabProject() {
    return deleteWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_LAB_PROJECT_KEY, this.options);
  }

  async listCircuitCustomComponents() {
    const values = await readAllWorkspaceValues(CIRCUIT_DESIGN_STORE_NAME, this.options);
    return values
      .filter((value) => isCircuitCustomComponentDefinition(value))
      .map((value) => normalizeCircuitCustomComponentDefinition(value));
  }

  writeCircuitCustomComponent(componentDefinition) {
    const normalized = normalizeCircuitCustomComponentDefinition(componentDefinition);
    return writeWorkspaceValue(
      CIRCUIT_DESIGN_STORE_NAME,
      circuitCustomComponentStorageKey(normalized.id),
      normalized,
      this.options
    );
  }

  deleteCircuitCustomComponent(componentId) {
    return deleteWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, circuitCustomComponentStorageKey(componentId), this.options);
  }

  readCurrentMechatronicsBinding() {
    return readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_MECHATRONICS_BINDING_KEY, this.options);
  }

  writeCurrentMechatronicsBinding(binding) {
    return writeWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_MECHATRONICS_BINDING_KEY, binding, this.options);
  }

  deleteCurrentMechatronicsBinding() {
    return deleteWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_MECHATRONICS_BINDING_KEY, this.options);
  }

  listPartLibraryItems() {
    return readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, this.options);
  }

  writePartLibraryItem(item) {
    if (!item?.id) throw new Error("Part library items need a stable id.");
    return writeWorkspaceValue(PART_LIBRARY_STORE_NAME, item.id, item, this.options);
  }

  deletePartLibraryItem(itemId) {
    return deleteWorkspaceValue(PART_LIBRARY_STORE_NAME, itemId, this.options);
  }

  async readWorkspace() {
    const [
      currentAssemblySnapshot,
      currentRobotDesign,
      currentCircuitDesign,
      currentCircuitLabProject,
      currentMechatronicsBinding,
      partLibraryItems
    ] = await Promise.all([
      this.readCurrentAssemblySnapshot(),
      this.readCurrentRobotDesign(),
      this.readCurrentCircuitDesign(),
      this.readCurrentCircuitLabProject(),
      this.readCurrentMechatronicsBinding(),
      this.listPartLibraryItems()
    ]);
    return {
      currentAssemblySnapshot,
      currentRobotDesign,
      currentCircuitDesign,
      currentCircuitLabProject,
      currentMechatronicsBinding,
      partLibraryItems
    };
  }

  restoreWorkspace(workspace = {}) {
    const currentCircuitLabProject = workspace.currentCircuitLabProject == null
      ? null
      : normalizeWorkspaceCircuitLabProject(workspace.currentCircuitLabProject);
    const currentMechatronicsBinding = workspace.currentMechatronicsBinding == null
      ? null
      : normalizeMechatronicsBinding(workspace.currentMechatronicsBinding);
    const entries = [
      {
        storeName: SNAPSHOT_STORE_NAME,
        key: CURRENT_SNAPSHOT_KEY,
        value: workspace.currentAssemblySnapshot,
        delete: workspace.currentAssemblySnapshot == null
      },
      {
        storeName: DESIGN_STORE_NAME,
        key: CURRENT_DESIGN_KEY,
        value: workspace.currentRobotDesign,
        delete: workspace.currentRobotDesign == null
      },
      {
        storeName: CIRCUIT_DESIGN_STORE_NAME,
        key: CURRENT_CIRCUIT_DESIGN_KEY,
        value: workspace.currentCircuitDesign,
        delete: workspace.currentCircuitDesign == null
      },
      {
        storeName: CIRCUIT_DESIGN_STORE_NAME,
        key: CURRENT_CIRCUIT_LAB_PROJECT_KEY,
        value: currentCircuitLabProject,
        delete: currentCircuitLabProject == null
      },
      {
        storeName: CIRCUIT_DESIGN_STORE_NAME,
        key: CURRENT_MECHATRONICS_BINDING_KEY,
        value: currentMechatronicsBinding,
        delete: currentMechatronicsBinding == null
      }
    ];
    for (const item of workspace.partLibraryItems ?? []) {
      if (!item?.id) throw new Error("Part library items need a stable id.");
      entries.push({
        storeName: PART_LIBRARY_STORE_NAME,
        key: item.id,
        value: item
      });
    }
    return writeWorkspaceBatch(entries, this.options);
  }
}

export function createWorkspaceStore(options = {}) {
  return new WorkspaceStore(options);
}
