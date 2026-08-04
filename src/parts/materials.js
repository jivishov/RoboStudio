/**
 * Material reference data for mass properties, DFM, and BOM output.
 *
 * Densities are g/cm3 and are reliable. Strength and modulus figures are
 * advisory only: printed parts are strongly anisotropic and process-dependent,
 * so `tensileMpa` describes the XY direction and real Z strength is materially
 * lower (roughly 55 percent for PLA). Do not present these as design allowables.
 */

export const MATERIAL_PROCESSES = Object.freeze(["fdm", "laser", "cnc", "sheet"]);
export const DEFAULT_MATERIAL_ID = "pla";

function material(entry) {
  return Object.freeze({
    tensileMpa: null,
    modulusGpa: null,
    stockThicknessesMm: null,
    fdmProfile: null,
    note: "",
    ...entry,
    processes: Object.freeze([...entry.processes])
  });
}

const FDM_DEFAULT_PROFILE = Object.freeze({ minWallMm: 1.2, holeCompensationMm: 0.15 });

export const MATERIALS = Object.freeze([
  material({
    id: "pla",
    label: "PLA",
    densityGcm3: 1.24,
    tensileMpa: 55,
    modulusGpa: 3.5,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: FDM_DEFAULT_PROFILE,
    note: "Stiff and easy to print. Z strength is roughly 55 percent of XY."
  }),
  material({
    id: "petg",
    label: "PETG",
    densityGcm3: 1.27,
    tensileMpa: 50,
    modulusGpa: 2.1,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: FDM_DEFAULT_PROFILE,
    note: "Better layer adhesion and toughness than PLA."
  }),
  material({
    id: "abs",
    label: "ABS",
    densityGcm3: 1.04,
    tensileMpa: 40,
    modulusGpa: 2.0,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: FDM_DEFAULT_PROFILE,
    note: "Warps without an enclosure."
  }),
  material({
    id: "asa",
    label: "ASA",
    densityGcm3: 1.07,
    tensileMpa: 40,
    modulusGpa: 2.0,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: FDM_DEFAULT_PROFILE,
    note: "UV-stable ABS. Preferred for outdoor parts."
  }),
  material({
    id: "pa12",
    label: "Nylon PA12",
    densityGcm3: 1.01,
    tensileMpa: 45,
    modulusGpa: 1.5,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: Object.freeze({ minWallMm: 1.6, holeCompensationMm: 0.2 }),
    note: "Tough and hygroscopic. Dry before printing."
  }),
  material({
    id: "pa6cf",
    label: "Nylon carbon fibre",
    densityGcm3: 1.15,
    tensileMpa: 100,
    modulusGpa: 6.0,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: Object.freeze({ minWallMm: 1.6, holeCompensationMm: 0.2 }),
    note: "Stiffest common printed option. Abrasive; needs a hardened nozzle."
  }),
  material({
    id: "pc",
    label: "Polycarbonate",
    densityGcm3: 1.2,
    tensileMpa: 60,
    modulusGpa: 2.3,
    processes: ["fdm", "cnc"],
    laserSafe: false,
    fdmProfile: Object.freeze({ minWallMm: 1.6, holeCompensationMm: 0.15 }),
    note: "High temperature resistance. Never laser cut: releases chlorine-free but toxic fumes and chars badly."
  }),
  material({
    id: "tpu95a",
    label: "TPU 95A",
    densityGcm3: 1.21,
    processes: ["fdm"],
    laserSafe: false,
    fdmProfile: Object.freeze({ minWallMm: 1.6, holeCompensationMm: 0.25 }),
    note: "Flexible. Not stiffness-rated; strength figures do not apply."
  }),
  material({
    id: "al6061t6",
    label: "Aluminium 6061-T6",
    densityGcm3: 2.7,
    tensileMpa: 310,
    modulusGpa: 68.9,
    processes: ["cnc", "sheet"],
    laserSafe: true,
    stockThicknessesMm: Object.freeze([1, 1.5, 2, 3, 4, 5, 6]),
    note: "Yield is 276 MPa. Fibre laser or waterjet; not CO2."
  }),
  material({
    id: "steel_mild",
    label: "Mild steel",
    densityGcm3: 7.85,
    tensileMpa: 370,
    modulusGpa: 200,
    processes: ["cnc", "sheet"],
    laserSafe: true,
    stockThicknessesMm: Object.freeze([1, 1.5, 2, 3, 4, 5, 6]),
    note: "Yield is 250 MPa for S235 or 1018."
  }),
  material({
    id: "ss304",
    label: "Stainless 304",
    densityGcm3: 8.0,
    tensileMpa: 505,
    modulusGpa: 193,
    processes: ["cnc", "sheet"],
    laserSafe: true,
    stockThicknessesMm: Object.freeze([1, 1.5, 2, 3, 4]),
    note: "Yield is 215 MPa."
  }),
  material({
    id: "acrylic",
    label: "Cast acrylic",
    densityGcm3: 1.19,
    tensileMpa: 70,
    modulusGpa: 3.2,
    processes: ["laser", "cnc"],
    laserSafe: true,
    stockThicknessesMm: Object.freeze([2, 3, 4, 5, 6, 8, 10]),
    note: "Brittle. Cuts cleanly on CO2."
  }),
  material({
    id: "plywood_birch",
    label: "Birch plywood",
    densityGcm3: 0.68,
    processes: ["laser", "cnc"],
    laserSafe: true,
    stockThicknessesMm: Object.freeze([3, 4, 6, 9, 12]),
    note: "Strength is grain-direction dependent and not quoted."
  }),
  material({
    id: "pom",
    label: "Delrin POM",
    densityGcm3: 1.41,
    tensileMpa: 70,
    modulusGpa: 2.9,
    processes: ["cnc"],
    laserSafe: false,
    stockThicknessesMm: Object.freeze([2, 3, 4, 5, 6, 8, 10]),
    note: "Excellent bearing surface. Laser cutting releases formaldehyde."
  }),
  material({
    id: "pvc",
    label: "PVC",
    densityGcm3: 1.4,
    processes: ["cnc"],
    laserSafe: false,
    note: "Never laser cut. Chlorinated plastics release hydrogen chloride, which destroys the machine and is acutely harmful."
  })
]);

const MATERIALS_BY_ID = new Map(MATERIALS.map((entry) => [entry.id, entry]));

export function listMaterials(process = null) {
  if (!process) return MATERIALS;
  return MATERIALS.filter((entry) => entry.processes.includes(process));
}

/** Returns null for an unknown id rather than guessing a density. */
export function getMaterial(id) {
  return MATERIALS_BY_ID.get(id) ?? null;
}

/**
 * Normalizer for the persisted `PartBody.materialId`.
 *
 * An unknown or missing id falls back to the default rather than being kept, so a
 * body always names a material this build has a density for and the mass display
 * never has to interpolate one.
 */
export function normalizeMaterialId(value) {
  return MATERIALS_BY_ID.has(value) ? value : DEFAULT_MATERIAL_ID;
}

export function materialDensityGcm3(id) {
  return getMaterial(id)?.densityGcm3 ?? null;
}

/** Converts a volume in cubic millimetres to grams. 1 g/cm3 equals 0.001 g/mm3. */
export function massGramsForVolume(volumeMm3, materialId) {
  const density = materialDensityGcm3(materialId);
  if (density == null || !Number.isFinite(Number(volumeMm3))) return null;
  return (Number(volumeMm3) / 1000) * density;
}

export function isLaserSafe(materialId) {
  return getMaterial(materialId)?.laserSafe === true;
}

export function stockThicknessesMm(materialId) {
  return getMaterial(materialId)?.stockThicknessesMm ?? null;
}
