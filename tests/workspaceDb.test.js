import assert from "node:assert/strict";
import test from "node:test";

import { readSavedRobotDesign, snapshotNewerThanDesign } from "../src/physics/persistence.js";
import {
  CURRENT_DESIGN_KEY,
  CURRENT_SNAPSHOT_KEY,
  deleteWorkspaceValue,
  DESIGN_STORE_NAME,
  openWorkspaceDb,
  PART_LIBRARY_STORE_NAME,
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
    if (this.completed) return;
    this.completed = true;
    this.emit("complete");
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
    queueMicrotask(() => {
      request.result = this.store.get(key);
      request.emit("success");
      this.transaction.complete();
    });
    return request;
  }

  put(value, key) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      this.store.set(key, value);
      request.result = key;
      request.emit("success");
      this.transaction.complete();
    });
    return request;
  }

  delete(key) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      this.store.delete(key);
      request.result = undefined;
      request.emit("success");
      this.transaction.complete();
    });
    return request;
  }

  openCursor() {
    const request = new FakeRequest();
    const entries = [...this.store.entries()];
    let index = 0;
    const advance = () => {
      if (index >= entries.length) {
        request.result = null;
        request.emit("success");
        this.transaction.complete();
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

  assert.equal(db.objectStoreNames.contains(SNAPSHOT_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(DESIGN_STORE_NAME), true);
  assert.equal(db.objectStoreNames.contains(PART_LIBRARY_STORE_NAME), true);
  assert.equal(indexedDb.deleteCount, 0);
  db.close();
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
  assert.equal(indexedDb.deleteCount, 0);
  db.close();
  assert.deepEqual(
    await readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, { indexedDb }),
    snapshot
  );
});

test("workspace opener repairs a malformed version-3 DB and preserves readable stores", async () => {
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
  assert.equal(indexedDb.deleteCount, 1);
  db.close();
  assert.deepEqual(
    await readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, { indexedDb }),
    snapshot
  );
  assert.deepEqual(await readAllWorkspaceValues(PART_LIBRARY_STORE_NAME, { indexedDb }), [libraryItem]);
});

test("workspace opener leaves a valid version-3 DB intact", async () => {
  const indexedDb = new FakeIndexedDB();
  const design = { version: 1, name: "Saved design" };
  const libraryItem = { version: 1, id: "saved_base", name: "Saved base" };
  indexedDb.seed(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, {
    [SNAPSHOT_STORE_NAME]: [[CURRENT_SNAPSHOT_KEY, { savedAt: "now" }]],
    [DESIGN_STORE_NAME]: [[CURRENT_DESIGN_KEY, design]],
    [PART_LIBRARY_STORE_NAME]: [[libraryItem.id, libraryItem]]
  });

  const db = await openWorkspaceDb({ indexedDb });

  assert.equal(indexedDb.deleteCount, 0);
  db.close();
  assert.deepEqual(await readSavedRobotDesign({ indexedDb }), design);
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
