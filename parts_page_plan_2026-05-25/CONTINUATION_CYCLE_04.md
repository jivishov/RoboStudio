# Continuation Cycle 04 - STL Export And Assembly Handoff

## Project Path
`C:\Users\EmilJivishov\Projects\Robotic_arm_3D_Codex`

## Dated Plan Path
`C:\Users\EmilJivishov\Projects\Robotic_arm_3D_Codex\parts_page_plan_2026-05-25`

## Required Reading
- `AGENTS.md`
- `parts_page_plan_2026-05-25/meta_plan.md`
- `parts_page_plan_2026-05-25/_CYCLE_STATUS.json`
- `parts_page_plan_2026-05-25/_DEVELOPMENT_CYCLES.md`
- `parts_page_plan_2026-05-25/CONTINUATION_CYCLE_04.md`
- `src/main.js`
- `src/workspaceDb.js`
- `src/parts.js`
- `src/parts/` compile, preview, state, and snapshot modules
- Current `tests/parts/` files
- Current `tests/workspaceDb.test.js`

## Past Context And Preconditions
- Cycle 03 should be completed.
- Validated bodies should compile to visible 3D preview geometry.
- Generated compile results should include enough metadata for triangle count, bounds, and export.

## Current Objective
Implement STL export and generated assembly handoff. Generated bodies should be exportable and should open in Assembly Studio through a query-gated snapshot path without breaking normal sample-arm loading.

## Likely Files To Inspect Or Edit
- `src/parts.js`
- `src/parts/exporters.js`
- `src/parts/snapshot.js`
- `src/parts/previewScene.js`
- `src/main.js`
- `src/workspaceDb.js`
- `tests/parts/exporters.test.js`
- `tests/parts/snapshot.test.js`
- `tests/studio/partsHandoff.test.js`

## Implementation Tasks
1. Add STL export for the selected/generated body using `@jscad/stl-serializer`.
2. Add GLB export for visible generated bodies using Three.js GLTF export support.
3. Generate snapshot metadata with:
   - stable ID;
   - label;
   - `type: "generated"`;
   - `file: null`;
   - visible state;
   - triangle count;
   - bounds;
   - `matrixWorld`.
4. Write the existing `current-assembly` snapshot shape to the `snapshots` store.
5. Navigate to `/?fromParts=1` after successful handoff.
6. Update Assembly Studio to attempt snapshot load only when `fromParts=1`.
7. Preserve normal Assembly Studio visits: no query means load the sample arm as today.
8. On invalid/missing generated snapshot, fall back to sample arm and show a concise status message.
9. Confirm the Workbench can load the generated snapshot through its existing `physics.html` logic.
10. Add tests for export metadata and query-gated Assembly Studio load/fallback.

## Acceptance Criteria
- Selected generated parts can be exported as STL.
- Visible generated parts can be sent to Assembly Studio.
- `/?fromParts=1` loads generated parts in Assembly Studio.
- Normal `/` visits still load the sample arm.
- Assembly Studio can open Physics Workbench after a Part Studio handoff.
- No `RobotDesign` schema changes are made.
- No IndexedDB version bump is made.

## Future Context
Cycle 05 can add advanced mechanical operations after this V1 workflow is stable. Cycle 06 will run full browser QA and finalize documentation/status.

## Do Not Solve Yet
- Do not add revolve/lathe, patterns, gears, threads, sweep, or shell.
- Do not change Workbench `RobotDesign` semantics.
- Do not make Part Studio snapshots replace normal Assembly Studio startup.
- Do not add raw STL mesh physics.

## Verification Steps
- Run `npm test`.
- Run `npm run build`.
- Browser smoke-check:
  - create a generated part in `parts.html`;
  - export STL;
  - send to Assembly Studio;
  - confirm generated part appears;
  - open Physics Workbench;
  - confirm generated snapshot loads.
- Check browser console for page errors.

## Status Update Instructions
When complete, update `_CYCLE_STATUS.json`:
- set cycle `04` to `completed`;
- set `lastCompleted` to `"04"`;
- set `lastCompletedAt` to the current local timestamp;
- set `currentCycle` to `5`;
- set cycle `05` to `ready`.
