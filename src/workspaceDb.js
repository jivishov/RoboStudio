export const WORKSPACE_DB_NAME = "stl-assembly-studio";
export const WORKSPACE_DB_VERSION = 2;
export const SNAPSHOT_STORE_NAME = "snapshots";
export const DESIGN_STORE_NAME = "robot-designs";
export const CURRENT_SNAPSHOT_KEY = "current-assembly";
export const CURRENT_DESIGN_KEY = "current-robot-design";

const REQUIRED_STORE_NAMES = Object.freeze([SNAPSHOT_STORE_NAME, DESIGN_STORE_NAME]);

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

function writeStoreValueToOpenDb(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

async function preserveCurrentSnapshot(db) {
  if (!storeExists(db, SNAPSHOT_STORE_NAME)) return null;
  try {
    return await readStoreValueFromOpenDb(db, SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

async function repairWorkspaceDb(malformedDb, indexedDb) {
  const preservedSnapshot = await preserveCurrentSnapshot(malformedDb);
  malformedDb.close();

  await deleteWorkspaceDb(indexedDb);
  const repairedDb = await openWorkspaceDbOnce(indexedDb);
  if (!hasRequiredStores(repairedDb)) {
    repairedDb.close();
    throw new Error("Workspace storage repair did not create the required stores.");
  }

  if (preservedSnapshot !== null) {
    await writeStoreValueToOpenDb(repairedDb, SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, preservedSnapshot);
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

export async function writeWorkspaceValue(storeName, key, value, options = {}) {
  const db = await openWorkspaceDb(options);
  try {
    await writeStoreValueToOpenDb(db, storeName, key, value);
  } finally {
    db.close();
  }
}
