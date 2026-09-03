# RoboStudio

RoboStudio is a browser robotics engineering workspace that combines mechanical assembly, component creation, robot modeling, electronics, and a deterministic breadboard Circuit Lab. For the WebMCP Challenge, Circuit Lab adds an external-agent repair mission where the agent proposes exact changes, RoboStudio verifies them, and the user controls destructive/hazardous confirmation.

## WebMCP Challenge demo

- **Live servo-repair mission:** https://jivishov.github.io/RoboStudio/circuits.html?mission=servo-repair-v1
- **Quick Model Benchmark:** https://jivishov.github.io/RoboStudio/circuits.html?mission=servo-repair-v1&benchmark=1
- **Architecture, safety, benchmark, and test details:** [`docs/WEBMCP.md`](docs/WEBMCP.md)
- **Challenge-period implementation delta and baseline:** [`docs/CHALLENGE_DELTA.md`](docs/CHALLENGE_DELTA.md)

### Fixed prompt

> Diagnose and repair this servo circuit. Preserve Arduino D9 as the servo signal. Use the external 6 V supply for servo power and establish a common ground with the Arduino. Explain the detected problems before modifying the circuit. After repair, rerun the circuit test and report remaining warnings and build evidence. Do not claim that RoboStudio compiled, flashed, physically tested, or certified the circuit.

### Curated WebMCP surface

| Tool | Role |
| --- | --- |
| `get_circuit_state` | Read compact state, canonical revision, occupancy, and useful free rail contacts. |
| `diagnose_circuit` | Run bounded deterministic Circuit Lab DRC. |
| `show_circuit_issue` | Focus/highlight a current issue in the existing UI. |
| `preview_connection` | Evaluate an exact endpoint pair without mutation. |
| `connect_terminals` | Restage and execute through the live transaction path; hazardous changes stop for human confirmation. |
| `remove_connection` | Stage a removal and require visible human confirmation. |
| `get_build_evidence` | Return bounded readiness/evidence while distinguishing topology from semantic binding. |

WebMCP is feature-detected. No OpenAI/provider API key is required for the external WebMCP mission itself, and ordinary Circuit Lab remains usable when `document.modelContext` is unavailable.

### Quick Model Benchmark status

The repository ships the versioned benchmark mechanism but does **not** hard-code or fabricate benchmark winners. Real runs are recorded locally by the evaluator, including completed failures and aborted/interrupted runs. Comparison labels stay provisional/limited until the required run counts exist; **Best observed on this mission** is shown only when at least two configurations each have three or more comparable completed agent-only runs.

Results apply only to this RoboStudio scenario, toolset, rubric, client, manually entered model label, and configuration. They are not a general ranking of intelligence or engineering competence.

## Workspace pages

- `index.html` / `src/main.js`: STL Assembly Studio.
- `parts.html` / `src/parts.js`: Robotic Component Builder.
- `physics.html` / `src/physics.js`: Robotics Design Workbench.
- `electronics.html` / `src/electronics.js`: Electronics Studio for ESP32-family circuit layout, DRC, and deterministic ESP-IDF source export.
- `circuits.html` / `src/circuits.js`: Circuit Lab for breadboard robotics wiring, deterministic electrical/mechanical checks, and source-only Arduino/ESP-IDF generation.

The Workbench includes Lab mode for undergraduate-style robotics exercises and state-only project packaging. Circuit Lab and Electronics Studio remain separate sources of truth.

## Setup

```bash
npm install
npm run dev
```

The dev server binds to `127.0.0.1`. Open the URL printed by Vite, normally `http://127.0.0.1:5173/`.

## Local configuration

Create `.env` from `.env.example` only for optional local features:

- `OPENAI_API_KEY` enables the existing in-page assistant through the local Vite proxy. It is unrelated to the external WebMCP mission.
- `ROBOSTUDIO_CAD_PYTHON` optionally points advanced local CAD/STEP export at a Python interpreter with `requirements-cad.txt` installed.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` enable Supabase-backed part-library sync.

The real `.env` is ignored.

## Included runtime data

- `STL_files/` contains the sample robotic-arm meshes and layout JSON used by Assembly Studio and `npm run export:glb`.
- `six_axis_robot_arm_stl_kit/` contains the generated six-axis arm source, drawings, QA report, and STL output.
- `src/academic/` contains LabSpec, ExperimentRun, AssetManifest, and RoboStudioProject helpers.
- `src/electronics/` contains the CircuitDesign schema, ESP32-family catalog, deterministic DRC, pin resolver, and source generator.
- `src/circuits/` contains CircuitLabProject, the robotics hardware catalog, physical occupancy, breadboard connectivity, transactions, deterministic test bench, and source generator.
- `docs/supabase-part-library.sql` contains the optional Supabase part-library table and row-level-security setup.

## Verification

```bash
npm ci
npm test
npm run build
npm run test:browser
```

The GitHub Pages workflow runs `npm ci`, `npm test`, and `npm run build` on `main`. A separate `WebMCP Browser Tests` workflow installs Chromium and runs the focused fake-`modelContext` suite with `playwright.webmcp.config.js`. Large Three/Rapier chunk warnings are expected.

### Clean-profile WebMCP smoke test

1. Open the live mission in a WebMCP-capable client/profile with WebMCP enabled.
2. Confirm the **Agent** tab says `Ready - 7 tools`.
3. Copy and send the fixed prompt to the external agent.
4. Confirm that the initial diagnosis reports the unsafe controller-powered servo and missing common ground before mutation.
5. Approve the visible agent-requested removal only after reviewing it.
6. Confirm the agent previews each new connection before connecting it.
7. Verify final DRC has zero errors, D9 remains the servo signal, build evidence says the D9 assignment is topology-derived when no binding exists, and the source-only disclaimer remains visible in tool evidence.
8. Use the benchmark URL for labeled repeated runs; preserve failures/aborts rather than curating only successes.

## Safety and evidence boundary

Circuit Lab performs deterministic browser-side DRC and lightweight electrical/mechanical checks. It is **not** SPICE, a firmware builder, flashing/serial software, hardware execution, physical measurement, or certification. Generated firmware is source-only. Generic catalog ratings and `generic-rating-review` warnings still require real-world engineering review before powering hardware.

## Runtime data and licensing

- `src/circuits/` contains Circuit Lab model, catalog, occupancy, transactions, DRC, connectivity, artifacts, and source generation.
- `src/webmcp/` contains challenge-specific registration, tools, activity, UI integration, and benchmark logic.
- `src/academic/` contains LabSpec, ExperimentRun, AssetManifest, and project packaging.
- `src/electronics/` contains CircuitDesign, catalog, DRC, resolver, and source generation.
- RoboStudio-owned code is available under the root [`LICENSE`](LICENSE).
- Third-party asset/code licenses and provenance remain in [`LICENSES/`](LICENSES/) and [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md).
