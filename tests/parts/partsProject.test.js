import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeneratedBodyMetadata,
  createPartProject,
  createSketchExtrudeBody,
  sanitizePartId,
  uniquePartId
} from "../../src/parts/contracts.js";
import {
  addBody,
  commitProject,
  createProjectHistory,
  duplicateBody,
  normalizePartProject,
  redoProject,
  undoProject,
  updateBody
} from "../../src/parts/projectState.js";
import { COMPILE_SIGNATURE_FIELDS, bodyCompileSignature } from "../../src/parts/compileCache.js";
import { createSpurGearBody } from "../../src/parts/gears.js";
import { parsePartProjectJson, serializePartProject } from "../../src/parts/serialization.js";
import { clearanceHoleDiameterMm } from "../../src/parts/standards/fasteners.js";
import { createGeneratedAssemblySnapshot, createGeneratedPartSnapshot } from "../../src/parts/snapshot.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import { validateBody } from "../../src/parts/validation.js";

test("creates PartProject defaults and stable ids", () => {
  const project = createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" });

  assert.equal(project.version, 1);
  assert.equal(project.units, "mm");
  assert.deepEqual(project.bodies, []);
  assert.equal(project.selectedBodyId, null);
  assert.equal(project.updatedAt, "2026-05-25T10:00:00.000Z");
  assert.equal(sanitizePartId("Servo Mount Plate.stl"), "servo_mount_plate");
  assert.equal(uniquePartId("body", new Set(["body", "body_2"])), "body_3");
});

test("normalizes bodies and keeps source contract server-independent", () => {
  const body = createSketchExtrudeBody({
    id: "Base Plate",
    name: "Base Plate",
    color: "not-a-color",
    transform: { position: ["1", "bad", 3], scale: [1, 0, 2] },
    sketch: createBodyFromTemplate("base_plate").sketch,
    extrudeDepthMm: "8"
  });

  const project = normalizePartProject({ bodies: [body], selectedBodyId: body.id });
  assert.equal(project.bodies[0].id, "base_plate");
  assert.equal(project.bodies[0].color, "#2563eb");
  assert.deepEqual(project.bodies[0].transform.position, [1, 0, 3]);
  assert.deepEqual(project.bodies[0].transform.scale, [1, 1, 2]);
  assert.equal(project.bodies[0].source.kind, "sketchExtrude");
});

test("updates, duplicates, and preserves undo redo history", () => {
  const history = createProjectHistory(createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" }));
  const first = addBody(history.current, createBodyFromTemplate("link_bar"), {
    updatedAt: "2026-05-25T10:01:00.000Z"
  });
  commitProject(history, first);

  const renamed = updateBody(history.current, history.current.selectedBodyId, (body) => {
    body.name = "Driven link";
    body.extrudeDepthMm = 7.5;
    return body;
  }, { updatedAt: "2026-05-25T10:02:00.000Z" });
  commitProject(history, renamed);

  assert.equal(history.current.bodies[0].name, "Driven link");
  assert.equal(history.current.bodies[0].extrudeDepthMm, 7.5);

  const duplicated = duplicateBody(history.current, history.current.selectedBodyId, {
    updatedAt: "2026-05-25T10:03:00.000Z"
  });
  commitProject(history, duplicated);
  assert.equal(history.current.bodies.length, 2);
  assert.equal(history.current.bodies[1].id, "link_bar_copy");
  assert.equal(history.current.selectedBodyId, "link_bar_copy");

  undoProject(history);
  assert.equal(history.current.bodies.length, 1);
  assert.equal(history.current.bodies[0].name, "Driven link");

  redoProject(history);
  assert.equal(history.current.bodies.length, 2);
});

test("serializes and parses PartProject JSON round trip", () => {
  const project = addBody(
    createPartProject({ updatedAt: "2026-05-25T10:00:00.000Z" }),
    createBodyFromTemplate("spacer_standoff"),
    { updatedAt: "2026-05-25T10:01:00.000Z" }
  );
  const serialized = serializePartProject(project);
  const parsed = parsePartProjectJson(serialized);

  assert.deepEqual(parsed, project);
  assert.throws(() => parsePartProjectJson("{nope"), /PartProject JSON is invalid/);
});

test("restore drops fields a newer build added instead of throwing", () => {
  // The autosave restore path reuses parsePartProjectJson, so a project written by a build
  // with extra project- and body-level fields has to load in an older build unchanged
  // except for those fields (meta_plan landmine two).
  const restored = parsePartProjectJson(JSON.stringify({
    version: 1,
    units: "mm",
    massProperties: { massG: 42 },
    bodies: [
      {
        id: "plate",
        name: "Plate",
        extrudeDepthMm: 4,
        materialId: "petg",
        processId: "cnc",
        holes: [{ standard: "M3" }],
        sketch: {
          outerProfile: { id: "outer", type: "rectangle", width: 40, height: 20, lockSize: true },
          cutProfiles: []
        }
      }
    ],
    selectedBodyId: "plate",
    updatedAt: "2026-07-27T12:00:00.000Z"
  }));

  assert.deepEqual(Object.keys(restored).sort(), ["bodies", "selectedBodyId", "units", "updatedAt", "version"]);
  assert.equal(restored.bodies.length, 1);
  assert.equal(restored.bodies[0].id, "plate");
  assert.equal(restored.bodies[0].extrudeDepthMm, 4);
  assert.equal(restored.bodies[0].sketch.outerProfile.width, 40);
  // Mass properties are derived output and are never a persisted project field, so a
  // build that wrote them loses them here rather than seeding a second source of truth.
  assert.equal(Object.hasOwn(restored, "massProperties"), false);
  // materialId is registered as of cycle 03 and processId as of cycle 06, so both
  // survive where an unregistered neighbour on the same body does not.
  assert.equal(restored.bodies[0].materialId, "petg");
  assert.equal(restored.bodies[0].processId, "cnc");
  assert.equal(Object.hasOwn(restored.bodies[0], "holes"), false);
  assert.equal(Object.hasOwn(restored.bodies[0].sketch.outerProfile, "lockSize"), false);
});

test("materialId is a registered persisted body field and mass properties are not", () => {
  const body = createBodyFromTemplate("base_plate");
  body.materialId = "petg";
  // Derived output a caller might have attached: the whitelist has to drop all of it.
  body.massProperties = { volumeMm3: 1234 };
  body.geometryProperties = { volumeMm3: 1234 };
  body.massG = 42;

  const project = normalizePartProject({ bodies: [body], selectedBodyId: body.id });
  const stored = project.bodies[0];

  assert.equal(stored.materialId, "petg");
  assert.equal(Object.hasOwn(stored, "massProperties"), false);
  assert.equal(Object.hasOwn(stored, "geometryProperties"), false);
  assert.equal(Object.hasOwn(stored, "massG"), false);

  // And it survives the save/restore path the autosave uses.
  const restored = parsePartProjectJson(serializePartProject(project));
  assert.equal(restored.bodies[0].materialId, "petg");
  assert.equal(JSON.stringify(restored).includes("volumeMm3"), false);

  // A body that never named a material still names one after normalizing, so the mass
  // display always has a density to apply.
  const untouched = normalizePartProject({ bodies: [createBodyFromTemplate("link_bar")] }).bodies[0];
  assert.equal(untouched.materialId, "pla");
});

test("processId is a registered persisted body field and round-trips through save and restore", () => {
  // Landmine two for cycle 06. `normalizePartBody` is a whitelist that every
  // mutation path runs, so a process selection absent from it would be dropped on
  // the next edit and the user would reopen an acrylic plate being judged as if it
  // were printed.
  const body = createBodyFromTemplate("base_plate");
  body.processId = "laser";

  const project = normalizePartProject({ bodies: [body], selectedBodyId: body.id });
  assert.equal(project.bodies[0].processId, "laser");

  const restored = parsePartProjectJson(serializePartProject(project));
  assert.equal(restored.bodies[0].processId, "laser");

  // It survives an unrelated mutation, which is the failure an unregistered field
  // actually shows up as: saved fine, gone after the next edit.
  const renamed = updateBody(restored, "base_plate", (draft) => {
    draft.name = "Renamed";
    return draft;
  });
  assert.equal(renamed.bodies[0].processId, "laser");

  // An unknown process falls back rather than persisting an id with no thresholds.
  const unknown = normalizePartProject({ bodies: [{ ...body, processId: "waterjet" }] });
  assert.equal(unknown.bodies[0].processId, "fdm");
  // And a body that never named one still names one, so no rule has to invent it.
  assert.equal(normalizePartProject({ bodies: [createBodyFromTemplate("link_bar")] }).bodies[0].processId, "fdm");
});

test("choosing a process saves the project without rebuilding a solid", () => {
  // The same property `materialId` has and for the same reason: manufacturability
  // is a report about geometry, never an input to it. `COMPILE_SIGNATURE_FIELDS`
  // is a whitelist, so this is a statement about what is *not* in it.
  assert.ok(!COMPILE_SIGNATURE_FIELDS.includes("processId"));

  const body = createBodyFromTemplate("base_plate");
  const printed = normalizePartProject({ bodies: [body] }).bodies[0];
  const cut = normalizePartProject({ bodies: [{ ...body, processId: "laser" }] }).bodies[0];

  assert.notEqual(printed.processId, cut.processId);
  assert.equal(bodyCompileSignature(printed, [printed]), bodyCompileSignature(cut, [cut]));
});

test("every cycle-07 gear field is registered and round-trips through save and restore", () => {
  // Landmine two, for the five fields this cycle adds. `normalizeSpurGearSpec` is the
  // whitelist `normalizePartBody` runs on every mutation path, so an unregistered gear
  // field saves fine and is gone after the next edit - which is why the rename below
  // matters more than the serialize round trip.
  const body = createSpurGearBody({
    id: "pinion",
    gear: {
      toothCount: 17,
      moduleMm: 1.5,
      pressureAngleDeg: 25,
      boreDiameterMm: 5,
      thicknessMm: 8,
      rackProfileId: "D",
      profileShiftCoefficient: 0.35,
      backlashMm: 0.08,
      rootFilletFactor: 0.42,
      helixAngleDeg: -18
    }
  });

  const project = normalizePartProject({ bodies: [body], selectedBodyId: body.id });
  const restored = parsePartProjectJson(serializePartProject(project));
  const renamed = updateBody(restored, "pinion", (draft) => {
    draft.name = "Renamed pinion";
    return draft;
  });

  for (const stage of [project, restored, renamed]) {
    const gear = stage.bodies[0].gear;
    assert.equal(gear.rackProfileId, "D");
    assert.equal(gear.profileShiftCoefficient, 0.35);
    assert.equal(gear.backlashMm, 0.08);
    assert.equal(gear.rootFilletFactor, 0.42);
    assert.equal(gear.helixAngleDeg, -18);
    // Thickness has two names and one source of truth: `normalizePartBody` derives
    // `extrudeDepthMm` from the gear, so the two can never disagree.
    assert.equal(stage.bodies[0].extrudeDepthMm, 8);
  }

  // `null` is a value here and not an absence: it means "follow the rack profile",
  // so it has to survive the round trip as null rather than being filled in.
  const followsRack = parsePartProjectJson(
    serializePartProject(normalizePartProject({ bodies: [createSpurGearBody({ id: "wheel" })] }))
  );
  assert.equal(followsRack.bodies[0].gear.rootFilletFactor, null);

  // An unknown rack profile falls back rather than persisting an id with no
  // coefficients, exactly as an unknown process id does.
  const unknownRack = normalizePartProject({
    bodies: [{ ...body, gear: { ...body.gear, rackProfileId: "Z" } }]
  });
  assert.equal(unknownRack.bodies[0].gear.rackProfileId, "A");

  // And an unregistered gear field is dropped, which is what makes this a whitelist.
  const extra = normalizePartProject({
    bodies: [{ ...body, gear: { ...body.gear, toothTipReliefMm: 0.1 } }]
  });
  assert.equal(extra.bodies[0].gear.toothTipReliefMm, undefined);
});

test("a gear field is a compile input, unlike a material or a process", () => {
  // `gear` is already a compile signature field, so the five new subfields are
  // covered by construction - but "covered by construction" is the kind of claim that
  // stops being true quietly, so it is asserted.
  assert.ok(COMPILE_SIGNATURE_FIELDS.includes("gear"));

  const body = normalizePartProject({ bodies: [createSpurGearBody({ id: "pinion" })] }).bodies[0];
  const baseline = bodyCompileSignature(body, [body]);

  for (const change of [
    { profileShiftCoefficient: 0.3 },
    { backlashMm: 0.1 },
    { rootFilletFactor: 0.2 },
    { helixAngleDeg: 15 },
    { rackProfileId: "D" }
  ]) {
    const edited = normalizePartProject({
      bodies: [{ ...body, gear: { ...body.gear, ...change } }]
    }).bodies[0];
    assert.notEqual(
      bodyCompileSignature(edited, [edited]),
      baseline,
      `${Object.keys(change)[0]} must invalidate the cached solid`
    );
  }
});

test("hole is a registered cut-profile field that round-trips through save and restore", () => {
  // Landmine two: `normalizeSketch` rebuilds every profile through
  // `createCircleProfile`, which is a fixed object literal, so an unregistered field
  // is silently dropped on the next mutation. This is the round-trip test that has to
  // ship in the same commit as the field.
  const body = createSketchExtrudeBody({
    id: "plate",
    name: "Plate",
    extrudeDepthMm: 6,
    sketch: {
      outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
      cutProfiles: [
        {
          id: "cb",
          type: "circle",
          x: 10,
          z: 5,
          radius: 99,
          hole: { standard: "ISO metric", size: "M3", fit: "close", style: "counterbore", process: "machined", fromFace: "bottom", lockSize: true },
          // Unregistered neighbours on the same profile, which must not survive.
          holeDepthMm: 3,
          dfmFindings: [{ code: "too-close" }]
        }
      ]
    }
  });

  const stored = normalizePartProject({ bodies: [body], selectedBodyId: body.id }).bodies[0];
  const cut = stored.sketch.cutProfiles[0];

  // The profile-level key set is asserted for the same reason the body-level one is:
  // a field on a persisted profile is a storage decision and must be a deliberate one.
  assert.deepEqual(Object.keys(cut).sort(), ["hole", "id", "radius", "type", "x", "z"]);
  assert.deepEqual(cut.hole, {
    standard: "ISO metric",
    size: "M3",
    fit: "close",
    style: "counterbore",
    process: "machined",
    fromFace: "bottom",
    lockSize: true
  });
  // The radius is derived from the standard, not stored independently, so the 99 mm
  // the caller passed is discarded rather than kept beside a contradictory label.
  assert.equal(cut.radius, clearanceHoleDiameterMm("M3", "close") / 2);

  const restored = parsePartProjectJson(serializePartProject(normalizePartProject({ bodies: [stored] })));
  assert.deepEqual(restored.bodies[0].sketch.cutProfiles[0].hole, cut.hole);
  assert.equal(restored.bodies[0].sketch.cutProfiles[0].radius, cut.radius);
});

test("a profile with no hole stays exactly what it is today", () => {
  // Cycle 08 retrofitted every template fastener hole to a standard, so `base_plate`
  // is no longer an example of a body with no `hole` anywhere. `wheel_hub_flange`'s
  // axle bore is: it is a shaft fit rather than a clearance hole and is registered as
  // a non-fastener feature, which makes it a stronger case than the old one - it
  // proves the normalizer does not invent a `hole` for a circle that deliberately
  // has none, on a body whose other cuts do.
  const project = normalizePartProject({ bodies: [createBodyFromTemplate("wheel_hub_flange")] });
  const bore = project.bodies[0].sketch.cutProfiles.find((profile) => profile.id === "center_bore");

  assert.ok(bore);
  assert.equal(Object.hasOwn(bore, "hole"), false);
  assert.deepEqual(Object.keys(bore).sort(), ["id", "radius", "type", "x", "z"]);
});

test("a hole on a non-circular profile is dropped, because only circles carry one", () => {
  // Stated rather than half-supported: a standards-derived slot width is defensible,
  // but a slot's length is not standardised and an obround pocket is undesigned, so a
  // hole on a slot resolves to nothing instead of to something arbitrary.
  const project = normalizePartProject({
    bodies: [
      createSketchExtrudeBody({
        id: "plate",
        name: "Plate",
        sketch: {
          outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
          cutProfiles: [
            { id: "slot", type: "roundedSlot", x: 0, z: 0, length: 20, width: 6, hole: { size: "M3" } },
            { id: "rect", type: "rectangle", x: 0, z: 12, width: 8, height: 4, hole: { size: "M3" } }
          ]
        }
      })
    ]
  });

  for (const profile of project.bodies[0].sketch.cutProfiles) {
    assert.equal(Object.hasOwn(profile, "hole"), false, `${profile.type} carries no hole`);
  }
});

test("an unresolvable hole survives normalization so the refusal is visible on reload", () => {
  const project = normalizePartProject({
    bodies: [
      createSketchExtrudeBody({
        id: "plate",
        name: "Plate",
        sketch: {
          outerProfile: { id: "outer", type: "rectangle", x: 0, z: 0, width: 60, height: 40 },
          cutProfiles: [{ id: "typo", type: "circle", x: 0, z: 0, radius: 4, hole: { size: "M3.5" } }]
        }
      })
    ]
  });
  const cut = project.bodies[0].sketch.cutProfiles[0];

  assert.equal(cut.hole.size, "M3.5");
  // A refusal changes no geometry: the author's radius is exactly what it was.
  assert.equal(cut.radius, 4);
});

test("preserves unsupported body source kinds for validation", () => {
  const project = normalizePartProject({
    bodies: [
      {
        id: "future_body",
        name: "Future body",
        source: { kind: "futureKernel" }
      }
    ],
    selectedBodyId: "future_body",
    updatedAt: "2026-05-25T10:00:00.000Z"
  });

  assert.equal(project.bodies[0].source.kind, "futureKernel");
  assert.ok(validateBody(project.bodies[0]).some((issue) => issue.code === "unsupported-body-source"));
});

test("creates generated body and assembly snapshot contract metadata", () => {
  const body = createBodyFromTemplate("base_plate");
  const metadata = createGeneratedBodyMetadata(body);
  const part = createGeneratedPartSnapshot(body, { triangles: 12, bounds: { size: [1, 2, 3] } });
  const snapshot = createGeneratedAssemblySnapshot({
    savedAt: "2026-05-25T10:00:00.000Z",
    glb: "binary",
    bodies: [body]
  });

  assert.deepEqual(metadata, {
    id: "base_plate",
    label: "Base plate",
    type: "generated",
    file: null,
    source: "part-studio"
  });
  assert.equal(part.triangles, 12);
  assert.deepEqual(part.bounds, { size: [1, 2, 3] });
  assert.equal(snapshot.savedAt, "2026-05-25T10:00:00.000Z");
  assert.equal(snapshot.glb, "binary");
  assert.equal(snapshot.parts[0].source, "part-studio");
  assert.equal(snapshot.layout, null);
});
