import { asFiniteNumber, asPositiveNumber, sanitizePartId, uniquePartId } from "./contracts.js";

export const OUTER_PROFILE_TYPES = Object.freeze(["rectangle", "circle", "roundedSlot", "polyline"]);
export const CUT_PROFILE_TYPES = Object.freeze(["circle", "roundedSlot", "rectangle", "polyline"]);

export function createRectangleProfile(options = {}) {
  const width = asPositiveNumber(options.width, 80);
  const height = asPositiveNumber(options.height, 50);
  return {
    id: sanitizePartId(options.id ?? "outer", "outer"),
    type: "rectangle",
    x: asFiniteNumber(options.x, 0),
    z: asFiniteNumber(options.z, 0),
    width,
    height,
    cornerRadius: Math.max(0, asFiniteNumber(options.cornerRadius, 0))
  };
}

export function createCircleProfile(options = {}) {
  return {
    id: sanitizePartId(options.id ?? "circle", "circle"),
    type: "circle",
    x: asFiniteNumber(options.x, 0),
    z: asFiniteNumber(options.z, 0),
    radius: asPositiveNumber(options.radius, 20)
  };
}

export function createRoundedSlotProfile(options = {}) {
  const width = asPositiveNumber(options.width, 20);
  return {
    id: sanitizePartId(options.id ?? "slot", "slot"),
    type: "roundedSlot",
    x: asFiniteNumber(options.x, 0),
    z: asFiniteNumber(options.z, 0),
    length: Math.max(asPositiveNumber(options.length, 80), width),
    width
  };
}

export function createPolylineProfile(options = {}) {
  const points = Array.isArray(options.points)
    ? options.points.map((point) => [asFiniteNumber(point?.[0], 0), asFiniteNumber(point?.[1], 0)])
    : [
        [-40, -25],
        [40, -25],
        [40, 25],
        [-40, 25]
      ];
  return {
    id: sanitizePartId(options.id ?? "polyline", "polyline"),
    type: "polyline",
    points,
    closed: options.closed !== false
  };
}

export function createCircularHole(options = {}) {
  return createCircleProfile({ id: options.id ?? "hole", radius: 4, ...options });
}

export function createSlottedHole(options = {}) {
  return createRoundedSlotProfile({ id: options.id ?? "slot_hole", length: 18, width: 6, ...options });
}

export function normalizeProfile(profile, options = {}) {
  const type = String(profile?.type ?? options.fallbackType ?? "rectangle");
  const existingIds = options.existingIds ?? new Set();
  const id = uniquePartId(profile?.id ?? options.fallbackId ?? type, existingIds, options.fallbackId ?? type);
  const source = { ...profile, id };

  if (type === "circle") return createCircleProfile(source);
  if (type === "roundedSlot") return createRoundedSlotProfile(source);
  if (type === "polyline") return createPolylineProfile(source);
  return createRectangleProfile(source);
}

export function profileBounds(profile) {
  if (!profile) return null;

  if (profile.type === "circle") {
    return {
      minX: profile.x - profile.radius,
      maxX: profile.x + profile.radius,
      minZ: profile.z - profile.radius,
      maxZ: profile.z + profile.radius
    };
  }

  if (profile.type === "roundedSlot") {
    return {
      minX: profile.x - profile.length / 2,
      maxX: profile.x + profile.length / 2,
      minZ: profile.z - profile.width / 2,
      maxZ: profile.z + profile.width / 2
    };
  }

  if (profile.type === "polyline") {
    const points = profile.points ?? [];
    const xs = points.map((point) => point[0]).filter(Number.isFinite);
    const zs = points.map((point) => point[1]).filter(Number.isFinite);
    if (!xs.length || !zs.length) return null;
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs)
    };
  }

  return {
    minX: profile.x - profile.width / 2,
    maxX: profile.x + profile.width / 2,
    minZ: profile.z - profile.height / 2,
    maxZ: profile.z + profile.height / 2
  };
}

export function profileCenter(profile) {
  const bounds = profileBounds(profile);
  if (!bounds) return [0, 0];
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
}

export function profileIsClosed(profile) {
  if (!profile) return false;
  if (profile.type === "polyline") return profile.closed === true && (profile.points?.length ?? 0) >= 3;
  return OUTER_PROFILE_TYPES.includes(profile.type) || CUT_PROFILE_TYPES.includes(profile.type);
}

export function profileSize(profile) {
  const bounds = profileBounds(profile);
  if (!bounds) return { width: 0, height: 0 };
  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxZ - bounds.minZ
  };
}

export function combinedProfileBounds(profiles) {
  const bounds = profiles.map(profileBounds).filter(Boolean);
  if (!bounds.length) {
    return { minX: -50, maxX: 50, minZ: -35, maxZ: 35 };
  }

  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    minZ: Math.min(...bounds.map((item) => item.minZ)),
    maxZ: Math.max(...bounds.map((item) => item.maxZ))
  };
}
