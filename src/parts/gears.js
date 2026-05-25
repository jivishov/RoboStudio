import jscad from "@jscad/modeling";
import {
  DEFAULT_BODY_COLOR,
  SPUR_GEAR_KIND,
  asFiniteNumber,
  asPositiveNumber,
  createDefaultTransform,
  uniquePartId
} from "./contracts.js";

const { booleans, extrusions, primitives } = jscad;
const { subtract } = booleans;
const { extrudeLinear } = extrusions;
const { circle, polygon } = primitives;

const CURVE_SEGMENTS = 64;
const MIN_TOOTH_COUNT = 6;
const MAX_TOOTH_COUNT = 120;
const SKETCH_TO_PART_PLANE_MATRIX = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
];

function issue(code, message, path, severity = "error") {
  return { code, message, path, severity };
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function positive(value) {
  return finite(value) && Number(value) > 0;
}

export function normalizeSpurGearSpec(value = {}) {
  const toothCount = Math.max(MIN_TOOTH_COUNT, Math.min(MAX_TOOTH_COUNT, Math.round(asPositiveNumber(value.toothCount, 24, 1))));
  const moduleMm = asPositiveNumber(value.moduleMm, 2, 0.01);
  const pressureAngleDeg = Math.max(10, Math.min(35, asFiniteNumber(value.pressureAngleDeg, 20)));
  const thicknessMm = asPositiveNumber(value.thicknessMm, 6, 0.1);
  const pitchDiameterMm = toothCount * moduleMm;
  const rootDiameterMm = Math.max(moduleMm, pitchDiameterMm - 2.5 * moduleMm);
  const boreDiameterMm = Math.max(0, asFiniteNumber(value.boreDiameterMm, Math.min(6, rootDiameterMm * 0.35)));

  return {
    toothCount,
    moduleMm,
    pressureAngleDeg,
    boreDiameterMm,
    thicknessMm
  };
}

export function createSpurGearBody(options = {}, existingIds = new Set()) {
  const gear = normalizeSpurGearSpec(options.gear ?? options);
  const id = uniquePartId(options.id ?? "spur_gear", existingIds, "spur_gear");

  return {
    id,
    name: String(options.name ?? `${gear.toothCount}T spur gear`),
    color: options.color ?? DEFAULT_BODY_COLOR,
    transform: createDefaultTransform(options.transform),
    source: { kind: SPUR_GEAR_KIND },
    sketch: { outerProfile: null, cutProfiles: [] },
    extrudeDepthMm: gear.thicknessMm,
    gear
  };
}

export function validateSpurGearSpec(gear, path = "gear") {
  const issues = [];
  if (!Number.isInteger(Number(gear?.toothCount)) || Number(gear.toothCount) < MIN_TOOTH_COUNT || Number(gear.toothCount) > MAX_TOOTH_COUNT) {
    issues.push(issue("invalid-gear-tooth-count", `Spur gear tooth count must be ${MIN_TOOTH_COUNT}-${MAX_TOOTH_COUNT}.`, `${path}.toothCount`));
  }
  if (!positive(gear?.moduleMm)) {
    issues.push(issue("invalid-gear-module", "Spur gear module must be a positive millimeter value.", `${path}.moduleMm`));
  }
  if (!finite(gear?.pressureAngleDeg) || Number(gear.pressureAngleDeg) < 10 || Number(gear.pressureAngleDeg) > 35) {
    issues.push(issue("invalid-gear-pressure-angle", "Pressure angle must stay between 10 and 35 degrees.", `${path}.pressureAngleDeg`));
  }
  if (!positive(gear?.thicknessMm)) {
    issues.push(issue("invalid-gear-thickness", "Spur gear thickness must be a positive millimeter value.", `${path}.thicknessMm`));
  }

  const boreDiameterMm = Number(gear?.boreDiameterMm);
  if (!finite(gear?.boreDiameterMm) || boreDiameterMm < 0) {
    issues.push(issue("invalid-gear-bore", "Bore diameter must be non-negative and smaller than the gear root diameter.", `${path}.boreDiameterMm`));
  } else if (positive(gear?.toothCount) && positive(gear?.moduleMm)) {
    const rootDiameterMm = Math.max(Number(gear.moduleMm), Number(gear.toothCount) * Number(gear.moduleMm) - 2.5 * Number(gear.moduleMm));
    if (boreDiameterMm >= rootDiameterMm * 0.82) {
      issues.push(issue("invalid-gear-bore", "Bore diameter must be non-negative and smaller than the gear root diameter.", `${path}.boreDiameterMm`));
    }
  }

  return issues;
}

export function createSpurGearProfilePoints(gearInput) {
  const gear = normalizeSpurGearSpec(gearInput);
  const pitchRadius = (gear.toothCount * gear.moduleMm) / 2;
  const rootRadius = Math.max(gear.moduleMm * 0.6, pitchRadius - 1.25 * gear.moduleMm);
  const outerRadius = pitchRadius + gear.moduleMm;
  const flankInset = 0.18;
  const points = [];

  for (let tooth = 0; tooth < gear.toothCount; tooth += 1) {
    const base = (Math.PI * 2 * tooth) / gear.toothCount;
    const step = (Math.PI * 2) / gear.toothCount;
    const angles = [
      base,
      base + step * (0.5 - flankInset),
      base + step * (0.5 + flankInset),
      base + step
    ];
    const radii = [rootRadius, outerRadius, outerRadius, rootRadius];
    for (let index = 0; index < angles.length; index += 1) {
      points.push([Math.cos(angles[index]) * radii[index], Math.sin(angles[index]) * radii[index]]);
    }
  }

  return points;
}

export function compileSpurGearBodyToSolid(body) {
  const gear = normalizeSpurGearSpec(body.gear);
  let gear2d = polygon({ points: createSpurGearProfilePoints(gear) });

  if (gear.boreDiameterMm > 0) {
    gear2d = subtract(
      gear2d,
      circle({ radius: gear.boreDiameterMm / 2, segments: CURVE_SEGMENTS })
    );
  }

  const centeredSolid = extrudeLinear({ height: gear.thicknessMm, repair: true }, gear2d);
  return jscad.transforms.transform(
    [
      ...SKETCH_TO_PART_PLANE_MATRIX.slice(0, 12),
      0, -gear.thicknessMm / 2, 0, 1
    ],
    centeredSolid
  );
}
