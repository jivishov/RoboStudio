# Robotic Part Studio Development Cycles

## Project Overview
- Project path: `C:\Users\EmilJivishov\Projects\Robotic_arm_3D_Codex`
- Plan path: `C:\Users\EmilJivishov\Projects\Robotic_arm_3D_Codex\parts_page_plan_2026-05-25`
- Goal: add a separate `parts.html` Robotic Part Studio for hobbyist-friendly robotic mechanical part creation.
- Plan date: `2026-05-25`

## Startup Protocol
A fresh session assigned "Cycle N" should:
1. Open `parts_page_plan_2026-05-25/CONTINUATION_CYCLE_NN.md`.
2. Read every file listed in that cycle's Required Reading section.
3. Execute only that cycle.
4. Avoid broad repo scanning unless a concrete failure requires it.
5. Preserve user changes and never revert unrelated work.

## Required Reading For Every Cycle
- `AGENTS.md`
- `package.json`
- `parts_page_plan_2026-05-25/meta_plan.md`
- `parts_page_plan_2026-05-25/_CYCLE_STATUS.json`
- `parts_page_plan_2026-05-25/_DEVELOPMENT_CYCLES.md`
- The current `parts_page_plan_2026-05-25/CONTINUATION_CYCLE_NN.md`

## Invariant Goals
- Preserve `index.html` / `src/main.js` as the STL Assembly Studio.
- Preserve `physics.html` / `src/physics.js` as the Robotics Design Workbench.
- Preserve `RobotDesign` as the Workbench source of truth.
- Keep generated Part Studio bodies as visual geometry, not robot kinematics or physics state.
- Do not bump IndexedDB DB version for V1.
- Keep dependencies unpinned unless the repo explicitly changes that policy.
- Preserve normal Assembly Studio sample-arm loading unless `/?fromParts=1` is present.
- Keep `npm test` and `npm run build` as required verification for implementation cycles.

## Dependency Map
- Cycle 01 -> Cycle 02 -> Cycle 03 -> Cycle 04 -> Cycle 06 delivers V1.
- Cycle 05 depends on Cycle 04 and should start only when V1 is stable.
- Cycle 06 depends on all completed implementation cycles and must close status accurately.

## Completion Protocol
At the end of each cycle:
1. Verify the cycle acceptance criteria.
2. Run the listed verification steps.
3. Update `parts_page_plan_2026-05-25/_CYCLE_STATUS.json`:
   - mark the completed cycle as `completed`;
   - set `lastCompleted`;
   - set `lastCompletedAt` to the current local timestamp;
   - set the next cycle status to `ready`;
   - increment `currentCycle` if another cycle remains.
4. Update `AGENTS.md` only when a durable invariant, architecture boundary, persistence contract, verification workflow, recurring gotcha, or stable user preference changes.
5. Report changed files, verification results, browser evidence when relevant, and remaining risks.

## Cycle Summaries
### Cycle 01 - Route Shell, Dependencies, And Contracts
Add the route shell, dependency declarations, Vite build entry, navigation, module skeletons, and written contracts for `PartProject` and generated snapshots. Do not build sketch UI or CAD compilation yet.

### Cycle 02 - Sketch State, Templates, And Editing UI
Implement project state, starter templates, sketch validation, JSON save/open, undo/redo, body list, and editable dimension controls. Do not add JSCAD compilation yet.

### Cycle 03 - JSCAD Worker, Extrusion, Holes, And Preview
Compile sketch profiles into extruded solids in a worker, subtract holes/cuts, convert solids to Three.js preview geometry, and surface compile errors.

### Cycle 04 - STL Export And Assembly Handoff
Add STL export, GLB snapshot export, generated metadata, `/?fromParts=1` Assembly Studio loading, normal fallback behavior, and Workbench compatibility.

### Cycle 05 - Mechanical Feature Expansion
Add optional advanced mechanical features after V1 is stable: explicit body booleans, linear/circular patterns, revolve/lathe, and a spur gear generator if practical.

### Cycle 06 - QA, Polish, Documentation, And Status Finalization
Run full browser QA across Part Studio, Assembly Studio, and Workbench. Capture screenshot evidence, check console errors, run `npm test` and `npm run build`, update docs/status, and close the plan.
