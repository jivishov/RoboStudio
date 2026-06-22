# RoboStudio Source

RoboStudio is a Vite-based robotics CAD, electronics, and simulation workspace with five entry points:

- `index.html` / `src/main.js`: STL Assembly Studio.
- `parts.html` / `src/parts.js`: Robotic Component Builder.
- `physics.html` / `src/physics.js`: Robotics Design Workbench.
- `electronics.html` / `src/electronics.js`: Electronics Studio for ESP32-family circuit layout, DRC, and deterministic ESP-IDF source export.
- `circuits.html` / `src/circuits.js`: Circuit Lab for RoboStudio-native breadboard robotics wiring, deterministic test feedback, and source-only Arduino/ESP-IDF generation.

The Workbench includes a Lab mode for undergraduate-style robotics exercises. It evaluates course checkpoints, captures experiment runs, exports CSV/HTML/JSON lab evidence, and creates state-only `.robostudio.json` plus manifest-preflighted `.robostudio.zip` project packages. Project JSON can include Electronics Studio `CircuitDesign` state, but firmware build products and hardware flashing remain outside the browser workflow.

## Setup

```bash
npm install
npm run dev
```

The dev server binds to `127.0.0.1`. Open the URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Local Configuration

Create a local `.env` file from `.env.example` when you want assistant or cloud-library features.

- `OPENAI_API_KEY` enables the in-page assistant through the local Vite proxy.
- `ROBOSTUDIO_CAD_PYTHON` optionally points the local advanced CAD backend at a Python interpreter with `requirements-cad.txt` installed. This enables build123d-backed STEP export for advanced CAD recipe bodies during local dev/preview; static builds continue to use browser/JSCAD preview fallbacks.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` enable Supabase-backed part-library sync.
- `docs/supabase-part-library.sql` contains the table and row-level-security setup for Supabase.

The real `.env` file is intentionally ignored because it contains local secrets.

## Included Runtime Data

- `STL_files/` contains the sample robotic arm meshes and layout JSON used by the Assembly Studio and `npm run export:glb`.
- `six_axis_robot_arm_stl_kit/` contains the generated six-axis arm source, drawings, QA report, and STL output.
- `src/academic/` contains LabSpec, ExperimentRun, AssetManifest, and RoboStudioProject helpers used by Lab mode and project packaging.
- `src/electronics/` contains the CircuitDesign schema, ESP32-family catalog, pin resolver, design-rule checks, and ESP-IDF source generator used by Electronics Studio.
- `src/circuits/` contains the CircuitLabProject model, robotics hardware catalog, breadboard connectivity, deterministic test bench, and source generator used by Circuit Lab.
- `AGENTS.md` contains local LLM and project invariants used while working on this codebase.

## Useful Commands

```bash
npm test
npm run build
npm run export:glb
```

Large Three/Rapier chunks during `npm run build` are expected for this project.
