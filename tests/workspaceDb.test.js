import assert from "node:assert/strict";
import test from "node:test";

import { buildFritzingCustomComponentDefinition } from "../src/circuits/customComponents.js";
import { readSavedRobotDesign, snapshotNewerThanDesign } from "../src/physics/persistence.js";
import { createWorkspaceStore } from "../src/workspaceStore.js";
import {
  CIRCUIT_DESIGN_STORE_NAME,
  CURRENT_CIRCUIT_DESIGN_KEY,
  CURRENT_CIRCUIT_LAB_PROJECT_KEY,
  CURRENT_DESIGN_KEY,
  CURRENT_MECHATRONICS_BINDING_KEY,
  CURRENT_PART_PROJECT_KEY,
  CURRENT_SNAPSHOT_KEY,
  deleteWorkspaceValue,
  DESIGN_STORE_NAME,
  openWorkspaceDb,
  PART_LIBRARY_STORE_NAME,
  PART_PROJECT_STORE_NAME,
  readAllWorkspaceValues,
  readWorkspaceValue,
  SNAPSHOT_STORE_NAME,
  writeWorkspaceValue,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION
} from "../src/workspaceDb.js";

class FakeRequest {
  constructor() {
    this.error = null;
    this.result = undefined;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this });
    }
  }
}

class FakeStoreNameList {
  constructor(record) {
    this.record = record;
  }

  contains(storeName) {
    return this.record.stores.has(storeName);
  }

  [Symbol.iterator]() {
    return this.record.stores.keys();
  }
}

class FakeTransaction {
  constructor(record, storeNames) {
    this.record = record;
    this.storeNames = new Set(storeNames);
    this.error = null;
    this.listeners = new Map();
    this.completed = false;
    this.pendingOperations = 0;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this });
    }
  }

  complete() {
    if (this.completed || this.pendingOperations > 0) return;
    this.completed = true;
    this.emit("complete");
  }

  beginOperation() {
    this.pendingOperations += 1;
  }

  finishOperation() {
    this.pendingOperations = Math.max(0, this.pendingOperations - 1);
    this.complete();
  }

  objectStore(storeName) {
    if (!this.storeNames.has(storeName) || !this.record.stores.has(storeName)) {
      const error = new Error(`Object store ${storeName} was not found.`);
      error.name = "NotFoundError";
      throw error;
    }
    return new FakeObjectStore(this, this.record.stores.get(storeName));
  }
}

class FakeObjectStore {
  constructor(transaction, store) {
    this.transaction = transaction;
    this.store = store;
  }

  get(key) {
    const request = new FakeRequest();
    this.transaction.beginOperation();
    queueMicrotask(() => {
      request.result = this.store.get(key);
      request.emit("success");
      this.transaction.finishOperation();
    });
    return request;
  }

  put(value, key) {
    const request = new FakeRequest();
    this.transaction.beginOperation();
    queueMicrotask(() => {
      this.store.set(key, value);
      request.result = key;
      request.emit("success");
      this.transaction.finishOperation();
    });
    return request;
  }

  delete(key) {
    const request = new FakeRequest();
    this.transaction.beginOperation();
    queueMicrotask(() => {
      this.store.delete(key);
      request.result = undefined;
      request.emit("success");
      this.transaction.finishOperation();
    });
    return request;
  }

  openCursor() {
    const request = new FakeRequest();
    this.transaction.beginOperation();
    const entries = [...this.store.entries()];
    let index = 0;
    const advance = () => {
      if (index >= entries.length) {
        request.result = null;
        request.emit("success");
        this.transaction.finishOperation();
        return;
      }
      const [key, value] = entries[index];
      index += 1;
      request.result = {
        key,
        value,
        continue: () => queueMicrotask(advance)
      };
      request.emit("success");
    };
    queueMicrotask(advance);
    return request;
  }
}

class FakeDatabase {
  constructor(record) {
    this.record = record;
    this.closed = false;
  }

  get objectStoreNames() {
    return new FakeStoreNameList(this.record);
  }

  createObjectStore(storeName) {
    this.record.stores.set(storeName, new Map());
    return new FakeObjectStore(null, this.record.stores.get(storeName));
  }

  transaction(storeNames, _mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      if (!this.record.stores.has(name)) {
        const error = new Error(`Object store ${name} was not found.`);
        error.name = "NotFoundError";
        throw error;
      }
    }
    return new FakeTransaction(this.record, names);
  }

  close() {
    this.closed = true;
  }
}

class FakeIndexedDB {
  constructor() {
    this.records = new Map();
    this.deleteCount = 0;
    this.blockDeletes = false;
  }

  seed(name, version, stores) {
    this.records.set(name, {
      version,
      stores: new Map(
        Object.entries(stores).map(([storeName, entries]) => [storeName, new Map(entries)])
      )
    });
  }

  open(name, version) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      let record = this.records.get(name);
      const needsUpgrade = !record || record.version < version;
      if (!record) {
        record = { version, stores: new Map() };
        this.records.set(name, record);
      } else if (record.version < version) {
        record.version = version;
      }
      request.result = new FakeDatabase(record);
      if (needsUpgrade) request.emit("upgradeneeded");
      request.emit("success");
    });
    return request;
  }

  deleteDatabase(name) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      if (this.blockDeletes) {
        request.emit("blocked");
        return;
      }
      this.deleteCount += 1;
      this.records.delete(name);
      request.emit("success");
    });
    return request;
  }
}

test("workspace opener creates all required stores for a fresh DB", async () => {
  const indexedDb = new FakeIndexedDB();

  const db = await openWorkspaceDb({ indexedDb });

  assert.deepEqual([...db.objectStoreNames].sort(), [
    CIRCUIT_DESIGN_STORE_NAME,
    DESIGN_STORE_NAME,
    PART_LIBRARY_STORE_NAME,
    PART_PROJECT_STORE_NAME,
    SNAPSHOT_STORE_NAME
  ].sort());
  assert.equal(db.objectStoreNames.contains(SNAPSHOT_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(DESIGN_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(PART_LIBRARY_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(CIRCUIT_DESIGN_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(PART_PROJECT_STORE_NAME), true);
  assert.equal(indexedDb.deleteCount, 0);
  db.close();
});

test("workspace DB version is 5", () => {
  assert.equal(WORKSPACE_DB_VERSION, 5);
});

test("a version-4 DB upgrades to 5 with part-projects added and every prior entry readable", async () => {
  const indexedDb = new FakeIndexedDB();
  const snapshot = { savedAt: "2026-07-27T09:00:00.000Z", glb: "binary", parts: [{ id: "base" }] };
  const design = { version: 1, name: "Version four design" };
  const circuitDesign = { version: 1, units: "mm", name: "Version four circuit" };
  const circuitLabProject = { kind: "CircuitLabProject", version: 1, units: "mm", name: "Version four lab" };
  const binding = { kind: "MechatronicsBinding", version: 1, actuatorBindings: [] };
  const firstLibraryItem = { version: 1, id: "saved_base", name: "Saved base" };
  const secondLibraryItem = { version: 1, id: "saved_link", name: "Saved link" };
  indexedDb.seed(WORKSPACE_DB_NAME, 4, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, snapshot]],
    [DESIGN_STORE_NAME]: [[CURRENT_DESIGN_KEY, design]],
    [PART_LIBRARY_STORE_NAME]: [
      [firstLibraryItem.id, firstLibraryItem],
      [secondLibraryItem.id, secondLibraryItem]
    ],
    [CIRCUIT_DESIGN_STORE_NAME]: [
      [CURRENT_CIRCUIT_DESIGN_KEY, circuitDesign],
      [CURRENT_CIRCUIT_LAB_PROJECT_KEY, circuitLabProject],
      [CURRENT_MECHATRONICS_BINDING_KEY, binding]
    ]
  });

  const db = await openWorkspaceDb({ indexedDb });

  assert.equal(db.objectStoreNames.contains(PART_PROJECT_STORE_NAME), true);
  // An upgrade must never take the destructive repair path, which is what would lose data.
  assert.equal(indexedDb.deleteCount, 0);
  assert.equal(indexedDb.records.get(WORKSPACE_DB_NAME).version, 5);
  db.close();

  assert.deepEqual(await readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, { indexedDb }), snapshot);
  assert.deepEqual(await readWorkspaceValue(DESIGN_STORE_NAME, CURRENT_DESIGN_KEY, { indexedDb }), design);
  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, { indexedDb }), circuitDesign);
  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_LAB_PROJECT_KEY, { indexedDb }), circuitLabProject);
  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_MECHATRONICS_BINDING_KEY, { indexedDb }), binding);
  assert.deepEqual(await readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, { indexedDb }), [firstLibraryItem, secondLibraryItem]);
  assert.equal(await readWorkspaceValue(PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY, { indexedDb }), null);
});

test("workspace repair recreates part-projects and preserves a saved part project", async () => {
  const indexedDb = new FakeIndexedDB();
  const savedProject = { version: 1, units: "mm", bodies: [], selectedBodyId: null, updatedAt: "2026-07-27T10:00:00.000Z" };
  // A version-5 DB missing circuit-designs is malformed and must be repaired, not upgraded.
  indexedDb.seed(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, { savedAt: "now" }]],
    [PART_PROJECT_STORE_NAME]: [[CURRENT_PART_PROJECT_KEY, savedProject]]
  });

  const db = await openWorkspaceDb({ indexedDb });

  assert.equal(db.objectStoreNames.contains(PART_PROJECT_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(CIRCUIT_DESIGN_STORE_NAME), true);
  assert.equal(indexedDb.deleteCount, 1);
  db.close();
  assert.deepEqual(
    await readWorkspaceValue(PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY, { indexedDb }),
    savedProject
  );
});

test("workspace opener upgrades a version-2 DB and preserves the current snapshot", async () => {
  const indexedDb = new FakeIndexedDB();
  const snapshot = { savedAt: "2026-05-22T14:00:00.000Z", glb: "binary", parts: [{ id: "base" }] };
  indexedDb.seed(WORKSPACE_DB_NAME, 2, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, snapshot]]
  });

  const db = await openWorkspaceDb({ indexedDb });

  assert.equal(db.objectStoreNames.contains(SNAPSHOT_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(DESIGN_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(PART_LIBRARY_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(CIRCUIT_DESIGN_STORE_NAME), true);
  assert.equal(indexedDb.deleteCount, 0);
  db.close();
  assert.deepEqual(
    await readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, { indexedDb }),
    snapshot
  );
});

test("workspace opener repairs a malformed current DB and preserves readable stores", async () => {
  const indexedDb = new FakeIndexedDB();
  const snapshot = { savedAt: "2026-05-22T14:00:00.000Z", glb: "binary", parts: [{ id: "base" }] };
  const libraryItem = { version: 1, id: "saved_base", name: "Saved base" };
  indexedDb.seed(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, snapshot]],
    [PART_LIBRARY_STORE_NAME]: [[libraryItem.id, libraryItem]]
  });

  const db = await openWorkspaceDb({ indexedDb });

  assert.equal(db.objectStoreNames.contains(SNAPSHOT_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(DESIGN_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(PART_LIBRARY_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(CIRCUIT_DESIGN_STORE_NAME), true);
  assert.equal(indexedDb.deleteCount, 1);
  db.close();
  assert.deepEqual(
    await readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, { indexedDb }),
    snapshot
  );
  assert.deepEqual(await readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, { indexedDb }), [libraryItem]);
});

test("workspace opener leaves a valid current DB intact", async () => {
  const indexedDb = new FakeIndexedDB();
  const design = { version: 1, name: "Saved design" };
  const circuitDesign = { version: 1, units: "mm", name: "Saved circuit" };
  const libraryItem = { version: 1, id: "saved_base", name: "Saved base" };
  indexedDb.seed(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, { savedAt: "now" }]],
    [DESIGN_STORE_NAME]: [[CURRENT_DESIGN_KEY, design]],
    [PART_LIBRARY_STORE_NAME]: [[libraryItem.id, libraryItem]],
    [CIRCUIT_DESIGN_STORE_NAME]: [[CURRENT_CIRCUIT_DESIGN_KEY, circuitDesign]],
    [PART_PROJECT_STORE_NAME]: []
  });

  const db = await openWorkspaceDb({ indexedDb });

  assert.equal(indexedDb.deleteCount, 0);
  db.close();
  assert.deepEqual(await readSavedRobotDesign({ indexedDb }), design);
  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, { indexedDb }), circuitDesign);
  assert.deepEqual(await readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, { indexedDb }), [libraryItem]);
});

test("workspace read-all and delete helpers manage library entries", async () => {
  const indexedDb = new FakeIndexedDB();
  const first = { id: "first", name: "First" };
  const second = { id: "second", name: "Second" };

  await writeWorkspaceValue(PART_LIBRARY_STORE_NAME, first.id, first, { indexedDb });
  await writeWorkspaceValue(PART_LIBRARY_STORE_NAME, second.id, second, { indexedDb });
  assert.deepEqual(await readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, { indexedDb }), [first, second]);

  await deleteWorkspaceValue(PART_LIBRARY_STORE_NAME, first.id, { indexedDb });
  assert.deepEqual(await readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, { indexedDb }), [second]);
});

test("WorkspaceStore wraps current workspace and part library operations", async () => {
  const indexedDb = new FakeIndexedDB();
  const store = createWorkspaceStore({ indexedDb });
  const snapshot = { savedAt: "2026-05-30T12:00:00.000Z", parts: [{ id: "base" }] };
  const design = { version: 1, name: "Academic design" };
  const circuitDesign = { version: 1, units: "mm", name: "Electronics design" };
  const circuitLabProject = { kind: "CircuitLabProject", version: 1, units: "mm", name: "Circuit Lab design" };
  const mechatronicsBinding = { kind: "MechatronicsBinding", version: 1, units: "mm", channels: [] };
  const libraryItem = { version: 1, id: "saved_link", name: "Saved link" };

  await store.writeCurrentAssemblySnapshot(snapshot);
  await store.writeCurrentRobotDesign(design);
  await store.writeCurrentCircuitDesign(circuitDesign);
  await store.writeCurrentCircuitLabProject(circuitLabProject);
  await store.writeCurrentMechatronicsBinding(mechatronicsBinding);
  await store.writePartLibraryItem(libraryItem);

  assert.deepEqual(await store.readWorkspace(), {
    currentAssemblySnapshot: snapshot,
    currentRobotDesign: design,
    currentCircuitDesign: circuitDesign,
    currentCircuitLabProject: circuitLabProject,
    currentMechatronicsBinding: mechatronicsBinding,
    partLibraryItems: [libraryItem]
  });

  await store.deletePartLibraryItem(libraryItem.id);
  assert.deepEqual(await store.listPartLibraryItems(), []);
});

test("WorkspaceStore round trips the current part project and keeps it out of the package", async () => {
  const indexedDb = new FakeIndexedDB();
  const store = createWorkspaceStore({ indexedDb });
  const project = {
    version: 1,
    units: "mm",
    bodies: [{ id: "base_plate", name: "Base plate", extrudeDepthMm: 4 }],
    selectedBodyId: "base_plate",
    updatedAt: "2026-07-27T11:00:00.000Z"
  };

  await store.writeCurrentPartProject(project);

  const saved = await store.readCurrentPartProject();
  assert.equal(saved.version, 1);
  assert.equal(saved.units, "mm");
  assert.equal(saved.bodies.length, 1);
  assert.equal(saved.bodies[0].id, "base_plate");
  assert.equal(saved.selectedBodyId, "base_plate");
  assert.equal(saved.updatedAt, "2026-07-27T11:00:00.000Z");

  const workspace = await store.readWorkspace();
  assert.equal(Object.hasOwn(workspace, "currentPartProject"), false);

  await store.deleteCurrentPartProject();
  assert.equal(await store.readCurrentPartProject(), null);
});

test("WorkspaceStore strips history stacks and unknown fields from the saved part project", async () => {
  const indexedDb = new FakeIndexedDB();
  const store = createWorkspaceStore({ indexedDb });

  await store.writeCurrentPartProject({
    version: 1,
    units: "mm",
    bodies: [{ id: "plate", name: "Plate", futureField: "from a newer build" }],
    selectedBodyId: "plate",
    updatedAt: "2026-07-27T11:30:00.000Z",
    undoStack: [{ bodies: [] }],
    redoStack: [{ bodies: [] }],
    history: { undoStack: [], redoStack: [] }
  });

  // Inspect the persisted record rather than trusting the writer.
  const saved = await readWorkspaceValue(PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY, { indexedDb });
  assert.deepEqual(Object.keys(saved).sort(), ["bodies", "selectedBodyId", "units", "updatedAt", "version"]);
  const serialized = JSON.stringify(saved);
  assert.equal(serialized.includes("undoStack"), false);
  assert.equal(serialized.includes("redoStack"), false);
  assert.equal(serialized.includes("futureField"), false);
});

test("WorkspaceStore keeps Circuit Lab custom components local-only", async () => {
  const indexedDb = new FakeIndexedDB();
  const store = createWorkspaceStore({ indexedDb });
  const customDefinition = buildFritzingCustomComponentDefinition({
    fzpText: `
      <module moduleId="localWidget">
        <title>Local Widget</title>
        <connector id="connector0" name="SIG" type="male">
          <gender>male</gender>
          <breadboardView><p terminalId="term0" /></breadboardView>
        </connector>
      </module>
    `,
    svgText: `<svg viewBox="0 0 10 10"><circle id="term0" cx="5" cy="5" r="1" /></svg>`,
    physicalWidthMm: 10,
    physicalHeightMm: 10,
    licenseAccepted: true,
    now: "2026-06-19T12:00:00.000Z"
  });

  await store.writeCircuitCustomComponent(customDefinition);

  const customComponents = await store.listCircuitCustomComponents();
  assert.equal(customComponents.length, 1);
  assert.equal(customComponents[0].id, "custom:localwidget");
  assert.equal(customComponents[0].visual.sanitizedSvg.includes("<svg"), true);
  const workspace = await store.readWorkspace();
  assert.equal(Object.hasOwn(workspace, "circuitCustomComponents"), false);

  await store.deleteCircuitCustomComponent(customDefinition.id);
  assert.deepEqual(await store.listCircuitCustomComponents(), []);
});

test("circuit workspace keys round trip and clear independently", async () => {
  const indexedDb = new FakeIndexedDB();
  const store = createWorkspaceStore({ indexedDb });
  const circuitDesign = { version: 1, units: "mm", name: "Electronics Studio design" };
  const circuitLabProject = { kind: "CircuitLabProject", version: 1, units: "mm", name: "Circuit Lab project" };
  const mechatronicsBinding = { kind: "MechatronicsBinding", version: 1, units: "mm", channels: [{ id: "servo_base" }] };

  await store.writeCurrentCircuitDesign(circuitDesign);
  await store.writeCurrentCircuitLabProject(circuitLabProject);
  await store.writeCurrentMechatronicsBinding(mechatronicsBinding);

  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_DESIGN_KEY, { indexedDb }), circuitDesign);
  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_CIRCUIT_LAB_PROJECT_KEY, { indexedDb }), circuitLabProject);
  assert.deepEqual(await readWorkspaceValue(CIRCUIT_DESIGN_STORE_NAME, CURRENT_MECHATRONICS_BINDING_KEY, { indexedDb }), mechatronicsBinding);

  await store.deleteCurrentCircuitLabProject();
  assert.deepEqual(await store.readCurrentCircuitDesign(), circuitDesign);
  assert.equal(await store.readCurrentCircuitLabProject(), null);
  assert.deepEqual(await store.readCurrentMechatronicsBinding(), mechatronicsBinding);

  await store.deleteCurrentCircuitDesign();
  assert.equal(await store.readCurrentCircuitDesign(), null);
  assert.equal(await store.readCurrentCircuitLabProject(), null);
  assert.deepEqual(await store.readCurrentMechatronicsBinding(), mechatronicsBinding);

  await store.deleteCurrentMechatronicsBinding();
  assert.equal(await store.readCurrentCircuitDesign(), null);
  assert.equal(await store.readCurrentCircuitLabProject(), null);
  assert.equal(await store.readCurrentMechatronicsBinding(), null);
});

test("WorkspaceStore restores explicit workspace fields as a validated batch", async () => {
  const indexedDb = new FakeIndexedDB();
  const store = createWorkspaceStore({ indexedDb });
  const originalCircuit = { version: 1, units: "mm", name: "Original circuit" };
  await store.writeCurrentCircuitDesign(originalCircuit);

  await assert.rejects(
    async () => store.restoreWorkspace({
      currentCircuitDesign: { version: 1, units: "mm", name: "Should not write" },
      partLibraryItems: [{ name: "Missing id" }]
    }),
    /stable id/
  );
  assert.deepEqual(await store.readCurrentCircuitDesign(), originalCircuit);

  const originalCircuitLab = { kind: "CircuitLabProject", version: 1, units: "mm", name: "Original lab", components: [], connections: [] };
  await store.writeCurrentCircuitLabProject(originalCircuitLab);
  await assert.rejects(
    async () => store.restoreWorkspace({
      currentCircuitDesign: { version: 1, units: "mm", name: "Should not write" },
      currentCircuitLabProject: { kind: "CircuitLabProject", version: 2, units: "mm", name: "Bad lab" }
    }),
    /version 1/
  );
  assert.equal((await store.readCurrentCircuitDesign()).name, "Original circuit");
  assert.equal((await store.readCurrentCircuitLabProject()).name, "Original lab");

  const workspace = {
    currentAssemblySnapshot: { savedAt: "now" },
    currentRobotDesign: { version: 1, name: "Robot" },
    currentCircuitDesign: { version: 1, units: "mm", name: "Electronics" },
    currentCircuitLabProject: { kind: "CircuitLabProject", version: 1, units: "mm", name: "Circuit Lab" },
    currentMechatronicsBinding: { kind: "MechatronicsBinding", version: 1, actuatorBindings: [] },
    partLibraryItems: [{ id: "saved_link", name: "Saved link" }]
  };
  await store.restoreWorkspace(workspace);

  const restored = await store.readWorkspace();
  assert.deepEqual(restored.currentAssemblySnapshot, workspace.currentAssemblySnapshot);
  assert.deepEqual(restored.currentRobotDesign, workspace.currentRobotDesign);
  assert.deepEqual(restored.currentCircuitDesign, workspace.currentCircuitDesign);
  assert.equal(restored.currentCircuitLabProject.kind, "CircuitLabProject");
  assert.equal(restored.currentCircuitLabProject.version, 1);
  assert.equal(restored.currentCircuitLabProject.units, "mm");
  assert.equal(restored.currentCircuitLabProject.name, "Circuit Lab");
  assert.equal(restored.currentMechatronicsBinding.kind, "MechatronicsBinding");
  assert.equal(restored.currentMechatronicsBinding.version, 1);
  assert.deepEqual(restored.partLibraryItems, [{ id: "saved_link", name: "Saved link" }]);
});

test("missing saved robot design returns null", async () => {
  const indexedDb = new FakeIndexedDB();

  assert.equal(await readSavedRobotDesign({ indexedDb }), null);
});

test("detects assembly snapshots newer than saved robot designs", () => {
  assert.equal(
    snapshotNewerThanDesign(
      { savedAt: "2026-05-25T12:30:00.000Z" },
      { updatedAt: "2026-05-25T12:00:00.000Z" }
    ),
    true
  );
  assert.equal(
    snapshotNewerThanDesign(
      { savedAt: "2026-05-25T11:30:00.000Z" },
      { updatedAt: "2026-05-25T12:00:00.000Z" }
    ),
    false
  );
  assert.equal(snapshotNewerThanDesign({ savedAt: "bad" }, { updatedAt: "2026-05-25T12:00:00.000Z" }), false);
});

test("blocked workspace repair gives a close-other-tabs error", async () => {
  const indexedDb = new FakeIndexedDB();
  indexedDb.blockDeletes = true;
  indexedDb.seed(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, { savedAt: "now" }]]
  });

  await assert.rejects(
    openWorkspaceDb({ indexedDb }),
    /Close other tabs for this local app and reload/
  );
});
