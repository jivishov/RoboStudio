const PATH_SEPARATOR_PATTERN = /[\\/]/;
const DRIVE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

export const ASSET_MANIFEST_VERSION = 1;

function basename(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.split(/[\\/]/).filter(Boolean).at(-1) ?? text;
}

function isPathLike(value) {
  const text = String(value ?? "");
  return DRIVE_PATH_PATTERN.test(text) || PATH_SEPARATOR_PATTERN.test(text);
}

function safeAssetId(value, fallback = "asset") {
  const clean = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function addWarning(warnings, code, message, assetId = null) {
  warnings.push({ code, message, assetId });
}

function createAssetRecord(input, warnings) {
  const originalFile = input.fileName ?? null;
  const fileName = basename(originalFile);
  if (originalFile && fileName !== originalFile && isPathLike(originalFile)) {
    addWarning(
      warnings,
      "asset-path-normalized",
      `${input.displayName ?? input.id} used a path-like file reference; only ${fileName} is portable.`,
      input.id
    );
  }
  return {
    version: ASSET_MANIFEST_VERSION,
    id: input.id,
    sourceKind: input.sourceKind,
    displayName: input.displayName ?? input.id,
    fileName,
    availability: input.availability,
    requiredFor: [...new Set(input.requiredFor ?? ["visual"])],
    ownerRefs: [...new Set(input.ownerRefs ?? [])],
    notes: input.notes ?? ""
  };
}

function sourceKindForPart(part, snapshotHasGlb) {
  if (part?.source === "part-studio" || part?.type === "generated") return "generatedPart";
  if (part?.file) return "meshFile";
  if (snapshotHasGlb) return "glbSnapshot";
  return "unknownMesh";
}

function availabilityForPart(part, snapshotHasGlb) {
  if (part?.source === "part-studio" || part?.type === "generated") {
    return part?.file ? "available" : "generated";
  }
  if (part?.file) return "available";
  if (snapshotHasGlb) return "retained";
  return "missing";
}

export function createAssetManifest(input = {}) {
  const warnings = [];
  const snapshot = input.snapshot ?? input.currentAssemblySnapshot ?? null;
  const snapshotHasGlb = Boolean(snapshot?.glb);
  const partRecords = Array.isArray(input.partRecords) ? input.partRecords : snapshot?.parts ?? [];
  const robotDesign = input.robotDesign ?? input.currentRobotDesign ?? null;
  const recordsById = new Map();

  if (snapshotHasGlb) {
    recordsById.set(
      "snapshot_glb",
      createAssetRecord(
        {
          id: "snapshot_glb",
          sourceKind: "glbSnapshot",
          displayName: "Current assembly GLB snapshot",
          fileName: null,
          availability: "retained",
          requiredFor: ["visual", "project-bundle"],
          ownerRefs: ["workspace.currentAssemblySnapshot"],
          notes: "Retained in IndexedDB for local rendering; JSON export stores metadata only."
        },
        warnings
      )
    );
  }

  for (const part of partRecords ?? []) {
    if (!part?.id) continue;
    const id = `part_${safeAssetId(part.id)}`;
    const ownerRefs = [`part:${part.id}`];
    const linked = robotDesign?.links?.filter((link) => link.partIds?.includes(part.id)) ?? [];
    for (const link of linked) ownerRefs.push(`link:${link.id}`);
    const record = createAssetRecord(
      {
        id,
        sourceKind: sourceKindForPart(part, snapshotHasGlb),
        displayName: part.name ?? part.label ?? part.id,
        fileName: part.file ?? null,
        availability: availabilityForPart(part, snapshotHasGlb),
        requiredFor: linked.length ? ["visual", "urdf"] : ["visual"],
        ownerRefs,
        notes: part.file
          ? "Mesh filename is portable only when the matching asset is available beside the export."
          : snapshotHasGlb
            ? "Part geometry is represented by the retained GLB snapshot."
            : "No portable mesh asset is available for this visual part."
      },
      warnings
    );
    recordsById.set(id, record);
    if (record.availability === "missing") {
      addWarning(warnings, "asset-missing", `${record.displayName} has no retained or generated mesh asset.`, record.id);
    }
  }

  for (const item of input.partLibraryItems ?? []) {
    if (!item?.id) continue;
    const id = `library_${safeAssetId(item.id)}`;
    recordsById.set(
      id,
      createAssetRecord(
        {
          id,
          sourceKind: "partLibrarySource",
          displayName: item.name ?? item.id,
          fileName: null,
          availability: "generated",
          requiredFor: ["part-library"],
          ownerRefs: [`library:${item.id}`],
          notes: "Saved library item stores normalized source bodies and can be regenerated."
        },
        warnings
      )
    );
  }

  return {
    version: ASSET_MANIFEST_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    assets: [...recordsById.values()],
    warnings
  };
}

export function manifestSummary(manifest) {
  const assets = manifest?.assets ?? [];
  const byAvailability = {};
  for (const asset of assets) {
    byAvailability[asset.availability] = (byAvailability[asset.availability] ?? 0) + 1;
  }
  return {
    assetCount: assets.length,
    warnings: manifest?.warnings?.length ?? 0,
    byAvailability
  };
}

export function preflightAssetBundle(manifest) {
  const issues = [];
  for (const asset of manifest?.assets ?? []) {
    const isRequiredVisual = asset.requiredFor?.some((item) => item === "visual" || item === "urdf");
    if (isRequiredVisual && asset.availability === "missing") {
      issues.push({
        level: "risk",
        code: "bundle-missing-asset",
        assetId: asset.id,
        message: `${asset.displayName} is required but has no portable asset.`
      });
    }
    if (asset.requiredFor?.includes("urdf") && !asset.fileName && asset.sourceKind !== "generatedPart") {
      issues.push({
        level: "warn",
        code: "bundle-urdf-visual-metadata",
        assetId: asset.id,
        message: `${asset.displayName} can render locally but has no standalone URDF mesh filename.`
      });
    }
  }
  for (const warning of manifest?.warnings ?? []) {
    issues.push({ level: "warn", ...warning });
  }
  return issues;
}
