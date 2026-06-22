export const WORKSPACE_DB_NAME = "stl-assembly-studio";
export const WORKSPACE_DB_VERSION = 4;
export const SNAPSHOT_STORE_NAME = "snapshots";
export const DESIGN_STORE_NAME = "robot-designs";
export const PART_LIBRARY_STORE_NAME = "part-library";
export const CIRCUIT_DESIGN_STORE_NAME = "circuit-designs";
export const CURRENT_SNAPSHOT_KEY = "current-assembly";
export const CURRENT_DESIGN_KEY = "current-robot-design";
export const CURRENT_CIRCUIT_DESIGN_KEY = "current-circuit-design";
export const CURRENT_CIRCUIT_LAB_PROJECT_KEY = "current-circuit-lab-project";
export const CURRENT_MECHATRONICS_BINDING_KEY = "current-mechatronics-binding";

const REQUIRED_STORE_NAMES = Object.freeze([
  SNAPSHOT_STORE_NAME,
  DESIGN_STORE_NAME,
  PART_LIBRARY_STORE_NAME,
  CIRCUIT_DESIGN_STORE_NAME
]);

export class WorkspaceDbRepairBlockedError extends Error {
  constructor() {
    super("Workspace storage repair is blocked. Close other tabs for this local app and reload.");
    this.name = "WorkspaceDbRepairBlockedError";
    this.userMessage = this.message;
  }
}

function indexedDbFromOptions(options = {}) {
  const indexedDb = options.indexedDb ?? globalThis.indexedDB;
  if (!indexedDb) {
    throw new Error("IndexedDB is not available in this browser.");
  }
  return indexedDb;
}

function storeExists(db, storeName) {
  return db.objectStoreNames?.contains?.(storeName) ?? Array.from(db.objectStoreNames ?? []).includes(storeName);
}

function hasRequiredStores(db) {
  return REQUIRED_STORE_NAMES.every((storeName) => storeExists(db, storeName));
}

function ensureRequiredStores(db) {
  for (const storeName of REQUIRED_STORE_NAMES) {
    if (!storeExists(db, storeName)) db.createObjectStore(storeName);
  }
}

function openWorkspaceDbOnce(indexedDb) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      ensureRequiredStores(request.result);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new WorkspaceDbRepairBlockedError()));
  });
}

function deleteWorkspaceDb(indexedDb) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.deleteDatabase(WORKSPACE_DB_NAME);
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new WorkspaceDbRepairBlockedError()));
  });
}

function readStoreValueFromOpenDb(db, storeName, key) {
  return new Promise((resolve, reject) => {
    let value = null;
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.addEventListener("success", () => {
      value = request.result ?? null;
    });
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => resolve(value));
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

function readStoreEntriesFromOpenDb(db, storeName) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).openCursor();
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) return;
      entries.push([cursor.key, cursor.value]);
      cursor.continue();
    });
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => resolve(entries));
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

function writeStoreValueToOpenDb(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

function deleteStoreValueFromOpenDb(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

function writeWorkspaceEntriesToOpenDb(db, entries) {
  return new Promise((resolve, reject) => {
    const storeNames = [...new Set(entries.map((entry) => entry.storeName))];
    const transaction = db.transaction(storeNames, "readwrite");
    for (const entry of entries) {
      const store = transaction.objectStore(entry.storeName);
      if (entry.delete === true) store.delete(entry.key);
      else store.put(entry.value, entry.key);
    }
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

async function preserveReadableStoreEntries(db) {
  const preserved = new Map();
  for (const storeName of REQUIRED_STORE_NAMES) {
    if (!storeExists(db, storeName)) continue;
    try {
      preserved.set(storeName, await readStoreEntriesFromOpenDb(db, storeName));
    } catch {
      preserved.set(storeName, []);
    }
  }
  return preserved;
}

async function repairWorkspaceDb(malformedDb, indexedDb) {
  const preservedEntries = await preserveReadableStoreEntries(malformedDb);
  malformedDb.close();

  await deleteWorkspaceDb(indexedDb);
  const repairedDb = await openWorkspaceDbOnce(indexedDb);
  if (!hasRequiredStores(repairedDb)) {
    repairedDb.close();
    throw new Error("Workspace storage repair did not create the required stores.");
  }

  for (const [storeName, entries] of preservedEntries.entries()) {
    if (!storeExists(repairedDb, storeName)) continue;
    for (const [key, value] of entries) {
      await writeStoreValueToOpenDb(repairedDb, storeName, key, value);
    }
  }

  return repairedDb;
}

export async function openWorkspaceDb(options = {}) {
  const indexedDb = indexedDbFromOptions(options);
  const db = await openWorkspaceDbOnce(indexedDb);
  if (hasRequiredStores(db)) return db;
  return repairWorkspaceDb(db, indexedDb);
}

export async function readWorkspaceValue(storeName, key, options = {}) {
  const db = await openWorkspaceDb(options);
  try {
    return await readStoreValueFromOpenDb(db, storeName, key);
  } finally {
    db.close();
  }
}

export async function readAllWorkspaceValues(storeName, options = {}) {
  const db = await openWorkspaceDb(options);
  try {
    return (await readStoreEntriesFromOpenDb(db, storeName)).map((entry) => entry[1]);
  } finally {
    db.close();
  }
}

export async function writeWorkspaceValue(storeName, key, value, options = {}) {
  const db = await openWorkspaceDb(options);
  try {
    await writeStoreValueToOpenDb(db, storeName, key, value);
  } finally {
    db.close();
  }
}

export async function deleteWorkspaceValue(storeName, key, options = {}) {
  const db = await openWorkspaceDb(options);
  try {
    await deleteStoreValueFromOpenDb(db, storeName, key);
  } finally {
    db.close();
  }
}

export async function writeWorkspaceBatch(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error("Workspace batch entries must be an array.");
  const normalizedEntries = entries.map((entry) => {
    if (!REQUIRED_STORE_NAMES.includes(entry?.storeName)) throw new Error(`Unknown workspace store: ${entry?.storeName}`);
    if (entry.key == null || String(entry.key) === "") throw new Error("Workspace batch entries need stable keys.");
    return {
      storeName: entry.storeName,
      key: String(entry.key),
      value: entry.value,
      delete: entry.delete === true
    };
  });
  if (!normalizedEntries.length) return;
  const db = await openWorkspaceDb(options);
  try {
    await writeWorkspaceEntriesToOpenDb(db, normalizedEntries);
  } finally {
    db.close();
  }
}
