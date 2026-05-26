import {
  CURRENT_DESIGN_KEY,
  CURRENT_SNAPSHOT_KEY,
  DESIGN_STORE_NAME,
  openWorkspaceDb,
  readWorkspaceValue,
  SNAPSHOT_STORE_NAME,
  writeWorkspaceValue
} from "../workspaceDb.js";

export { openWorkspaceDb };

export async function readCurrentSnapshot(options) {
  return readWorkspaceValue(SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY, options);
}

export async function readSavedRobotDesign(options) {
  return readWorkspaceValue(DESIGN_STORE_NAME, CURRENT_DESIGN_KEY, options);
}

export async function saveRobotDesign(design, options) {
  await writeWorkspaceValue(
    DESIGN_STORE_NAME,
    CURRENT_DESIGN_KEY,
    {
      ...design,
      updatedAt: new Date().toISOString()
    },
    options
  );
}

export function snapshotNewerThanDesign(snapshot, design) {
  const snapshotTime = Date.parse(snapshot?.savedAt ?? "");
  const designTime = Date.parse(design?.updatedAt ?? "");
  return Number.isFinite(snapshotTime) && Number.isFinite(designTime) && snapshotTime > designTime;
}
