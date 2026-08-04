import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MATERIAL_ID,
  MATERIALS,
  getMaterial,
  isLaserSafe,
  listMaterials,
  massGramsForVolume,
  materialDensityGcm3,
  normalizeMaterialId,
  stockThicknessesMm
} from "../../src/parts/materials.js";

test("every material carries a finite positive density and at least one process", () => {
  for (const entry of MATERIALS) {
    assert.ok(Number.isFinite(entry.densityGcm3) && entry.densityGcm3 > 0, `${entry.id} density`);
    assert.ok(entry.processes.length > 0, `${entry.id} processes`);
    assert.equal(typeof entry.laserSafe, "boolean", `${entry.id} laserSafe`);
  }
});

test("material ids are unique and the default resolves", () => {
  const ids = MATERIALS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(getMaterial(DEFAULT_MATERIAL_ID));
});

test("known densities match published values", () => {
  assert.equal(materialDensityGcm3("pla"), 1.24);
  assert.equal(materialDensityGcm3("petg"), 1.27);
  assert.equal(materialDensityGcm3("al6061t6"), 2.7);
  assert.equal(materialDensityGcm3("steel_mild"), 7.85);
});

test("unknown materials resolve to null rather than a guessed density", () => {
  assert.equal(getMaterial("unobtainium"), null);
  assert.equal(materialDensityGcm3("unobtainium"), null);
  assert.equal(massGramsForVolume(1000, "unobtainium"), null);
  assert.equal(stockThicknessesMm("unobtainium"), null);
});

test("mass converts cubic millimetres to grams", () => {
  // A 100 x 100 x 100 mm cube of PLA is 1000 cm3 at 1.24 g/cm3.
  assert.equal(massGramsForVolume(1_000_000, "pla"), 1240);
  // A 120 x 80 x 6 mm solid plate.
  assert.ok(Math.abs(massGramsForVolume(57_600, "pla") - 71.424) < 1e-9);
});

test("chlorinated and charring plastics are not laser safe", () => {
  assert.equal(isLaserSafe("pvc"), false);
  assert.equal(isLaserSafe("pc"), false);
  assert.equal(isLaserSafe("pom"), false);
  assert.equal(isLaserSafe("acrylic"), true);
  assert.equal(isLaserSafe("plywood_birch"), true);
});

test("listMaterials filters by process", () => {
  const laser = listMaterials("laser");
  assert.ok(laser.length > 0);
  assert.ok(laser.every((entry) => entry.processes.includes("laser")));
  assert.ok(!laser.some((entry) => entry.id === "pla"));
  assert.equal(listMaterials().length, MATERIALS.length);
});

test("sheet materials carry stock thicknesses and printed materials do not", () => {
  assert.ok(stockThicknessesMm("acrylic").includes(3));
  assert.ok(stockThicknessesMm("al6061t6").includes(2));
  assert.equal(stockThicknessesMm("pla"), null);
});

test("materialId normalizes to a material this build has a density for", () => {
  assert.equal(normalizeMaterialId("petg"), "petg");
  assert.equal(normalizeMaterialId("unobtainium"), DEFAULT_MATERIAL_ID);
  assert.equal(normalizeMaterialId(undefined), DEFAULT_MATERIAL_ID);
  assert.equal(normalizeMaterialId(null), DEFAULT_MATERIAL_ID);
  // Every id the normalizer can return has to have a density, or the mass display
  // would have nothing honest to show for a body it accepted.
  assert.ok(materialDensityGcm3(normalizeMaterialId("nope")) > 0);
});
