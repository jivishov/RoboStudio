# Robotic Part Studio Meta Plan

## Summary
Build a separate `parts.html` Robotic Part Studio for hobbyist-friendly robotic mechanical part creation. The first usable release focuses on sketching simple 2D profiles, adding holes and cutouts, extruding those sketches into 3D solids, previewing the result, exporting STL, and sending generated parts into the existing Assembly Studio.

This plan intentionally stages CAD capability. Cycles 01 through 04 deliver a practical V1. Cycle 05 expands mechanical features only after V1 is stable. Cycle 06 closes the work with browser QA, screenshots, documentation/status updates, and final verification.

## Current State
- `index.html` and `src/main.js` implement the STL Assembly Studio.
- `physics.html` and `src/physics.js` implement the Robotics Design Workbench.
- Reusable workbench logic lives under `src/physics/`.
- No `parts.html` page exists yet.
- The existing Assembly Studio to Workbench handoff writes a `current-assembly` snapshot in IndexedDB, then opens `physics.html`.
- Workspace IndexedDB uses DB version `2` with `snapshots` and `robot-designs` stores.
- `RobotDesign` is the Workbench source of truth; STL and GLB geometry are visual inputs only.
- Project verification commands are `npm test` and `npm run build`.

## Refined Priority Order
1. Establish the new route, dependency, state, and handoff contracts before UI-heavy work.
2. Build deterministic sketch state, validation, templates, and project save/open before CAD compilation.
3. Add worker-based JSCAD compilation, extrusion, holes/cuts, and 3D preview.
4. Finish STL export and Assembly Studio handoff so generated parts join the existing workflow.
5. Add optional mechanical feature expansion only after V1 is stable.
6. Complete browser QA, screenshots, documentation/status updates, and final verification.

## Implementation Changes
### Part Studio Route And Shell
- Add `parts.html` as a Vite build entry.
- Add `src/parts.js`, `src/parts.css`, and focused modules under `src/parts/`.
- Add an Assembly Studio topbar button or link labeled `Parts`.
- Add a Part Studio link back to Assembly Studio.
- Add unpinned dependencies: `@jscad/modeling: "latest"` and `@jscad/stl-serializer: "latest"`.

### V1 Sketch And Editing
- Support a hobbyist CAD layout:
  - left panel: templates and body list;
  - center: 2D sketch surface and 3D preview;
  - right panel: dimensions, extrusion depth, holes/cuts, transform, color, and metadata.
- Support v1 sketch tools:
  - rectangle;
  - circle;
  - rounded slot;
  - closed polyline;
  - circular hole;
  - slotted hole;
  - snap grid;
  - undo/redo;
  - duplicate/delete body.
- Use X/Z as the sketch plane and Y as extrusion thickness.
- Use millimeters everywhere.

### Templates
- Provide editable starter templates:
  - base plate;
  - link bar;
  - servo mount plate;
  - L bracket;
  - U bracket;
  - spacer/standoff;
  - axle/shaft;
  - gripper finger.

### CAD Compilation
- Use a Vite Web Worker for JSCAD compilation so sketch edits do not block the UI.
- Validate one closed outer profile plus zero or more closed cut profiles.
- Convert the sketch into JSCAD 2D geometry.
- Use `extrudeLinear` for thickness.
- Subtract holes and cutouts.
- Convert resulting `geom3` polygons into Three.js buffer geometry for preview.
- Surface compile and validation errors in the UI, not only in the console.

### Export And Handoff
- Export selected/generated bodies as STL using `@jscad/stl-serializer`.
- Export visible generated bodies to GLB for snapshot handoff.
- Write the existing `current-assembly` snapshot shape when sending to Assembly Studio.
- Navigate to `/?fromParts=1` after writing the snapshot.
- Update Assembly Studio to load the generated snapshot only when `fromParts=1`.
- Preserve normal Assembly Studio visits: they should continue to load the sample arm unless explicitly opened from Part Studio.
- Preserve Workbench compatibility by keeping generated bodies as visual parts that the existing Workbench can turn into manually riggable links.

### Mechanical Feature Expansion
- Add explicit boolean union/subtract/intersect body operations.
- Add linear and circular patterns for repeated holes, ribs, vents, and bolt patterns.
- Add revolve/lathe bodies for shafts, pulleys, bushings, wheels, collars, knobs, and spacers.
- Add a spur gear generator if JSCAD proves reliable for the selected profile complexity.
- Keep threads, sweep, shell, and imported STL editing out of Cycle 05 unless V1 is complete and stable.

## Public APIs / Interfaces / State
### `PartProject` V1 JSON
```json
{
  "version": 1,
  "units": "mm",
  "bodies": [],
  "selectedBodyId": null,
  "updatedAt": "ISO-8601 timestamp"
}
```

Each body stores:
```json
{
  "id": "body_id",
  "name": "Body name",
  "color": "#2563eb",
  "transform": {
    "position": [0, 0, 0],
    "quaternion": [0, 0, 0, 1],
    "scale": [1, 1, 1]
  },
  "source": {
    "kind": "sketchExtrude"
  },
  "sketch": {
    "outerProfile": {},
    "cutProfiles": []
  },
  "extrudeDepthMm": 6
}
```

### Generated Body Metadata
Generated Three.js meshes must carry stable metadata:
```json
{
  "id": "body_id",
  "label": "Body name",
  "type": "generated",
  "file": null,
  "source": "part-studio"
}
```

### Generated Assembly Snapshot
The handoff snapshot uses the existing `current-assembly` shape:
```json
{
  "savedAt": "ISO-8601 timestamp",
  "glb": "ArrayBuffer",
  "parts": [
    {
      "id": "body_id",
      "label": "Body name",
      "type": "generated",
      "file": null,
      "visible": true,
      "triangles": 0,
      "bounds": {},
      "matrixWorld": []
    }
  ],
  "layout": null
}
```

### Assembly Studio Query Contract
- `/?fromParts=1` means Assembly Studio should attempt to read `current-assembly` and load generated parts.
- Missing or invalid generated snapshots must fall back to the sample arm and show a concise status message.
- Normal `/` visits must not be affected by stale generated snapshots.

## Test Plan
- Unit-test `PartProject` creation, normalization, serialization, and round trip.
- Unit-test template generation for all V1 templates.
- Unit-test sketch validation for valid profiles, open profiles, invalid holes, duplicate IDs, and unsupported shapes.
- Unit-test generated snapshot metadata.
- Unit-test Assembly Studio query-gated generated snapshot loading and normal sample fallback.
- Run `npm test` after cycles that change source or test files.
- Run `npm run build` after implementation cycles.
- Browser QA:
  - create a servo plate;
  - add holes;
  - extrude it;
  - verify 3D preview;
  - export STL;
  - send to Assembly Studio;
  - confirm generated parts appear;
  - open Physics Workbench;
  - confirm generated assembly loads without console errors.

## Acceptance Criteria
- `parts.html` exists and is included in the Vite build.
- Users can create at least one useful robotic part from a template and from a basic sketch.
- Users can add holes/cutouts and set extrusion depth in millimeters.
- Users can preview generated 3D solids.
- Users can export STL.
- Users can send generated parts into Assembly Studio through `/?fromParts=1`.
- Normal Assembly Studio and Workbench behavior remains intact.
- `npm test` passes.
- `npm run build` passes.
- Browser QA evidence exists for the full Part Studio to Assembly Studio to Workbench flow.

## Assumptions
- Plan date and folder name are `2026-05-25`.
- V1 prioritizes hobbyist ease of use over full CAD completeness.
- Extrusion covers many flat robotics parts, including plates, brackets, links, fingers, mounts, and flat spur gears.
- Complex mechanical parts require staged operations beyond plain extrusion: booleans, patterns, revolve, gear generation, threads, sweep, shell, and constraints.
- Imported STL modification is out of scope for V1; imported STL/GLB may be added later as reference geometry.
- No `RobotDesign` schema changes are needed for this plan.
- Do not bump IndexedDB version for V1.
- Keep dependencies unpinned unless the repo explicitly changes that policy.
