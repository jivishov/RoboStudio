# Circuit Lab WebMCP

RoboStudio exposes a focused WebMCP surface for one proof-quality robotics circuit-repair mission. An external WebMCP-capable agent can inspect and propose changes, while RoboStudio remains the deterministic engineering authority and the user remains the only actor that can approve a pending destructive or hazardous operation.

## Demo URLs

- Mission: `https://jivishov.github.io/RoboStudio/circuits.html?mission=servo-repair-v1`
- Benchmark: `https://jivishov.github.io/RoboStudio/circuits.html?mission=servo-repair-v1&benchmark=1`

Ordinary `circuits.html` continues to work when WebMCP is unavailable.

## Fixed mission prompt

> Diagnose and repair this servo circuit. Preserve Arduino D9 as the servo signal. Use the external 6 V supply for servo power and establish a common ground with the Arduino. Explain the detected problems before modifying the circuit. After repair, rerun the circuit test and report remaining warnings and build evidence. Do not claim that RoboStudio compiled, flashed, physically tested, or certified the circuit.

## Mission construction and isolation

`servo-repair-v1` is generated from the current safe Arduino-servo starter rather than a duplicated static project. It deliberately removes the Arduino/common-ground path and safe servo power path, then adds an unsafe Arduino 5 V → servo power connection while preserving D9 signal and the external 6 V supply.

When a mission/benchmark query is active on `circuits.html`, Circuit Lab project, mechatronics binding, and RobotDesign workspace reads are isolated from the demo session through a narrowly scoped `WorkspaceStore` read seam. Mission load/reset does not persist to IndexedDB. A mission-only **Save as Current Project** requires a dedicated warning before invoking the normal save path.

## Seven public tools

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `get_circuit_state` | No | Compact project/component state, revision, occupancy, and a small set of free mission rail contacts. |
| `diagnose_circuit` | No | Bounded deterministic DRC with stable issue targets. |
| `show_circuit_issue` | UI only | Opens Test Results, selects the issue, and frames useful hardware. |
| `preview_connection` | No | Stages/evaluates an exact endpoint pair without modifying project/history/pending state. |
| `connect_terminals` | Yes | Restages an exact connection against the current revision and uses the live Circuit Lab transaction path. |
| `remove_connection` | Pending human consent | Resolves atomic direct-insertion groups and requires visible user confirmation before the live removal path runs. |
| `get_build_evidence` | No | Bounded readiness, source status, BOM/harness counts, topology assignments, semantic-pin-map status, and limitations. |

The public tool count is intentionally fixed at seven for this challenge slice.

## Revisions and stale writes

`src/circuits/designRevision.js` creates a canonical design snapshot containing component topology/geometry/control props and connection endpoint topology, while excluding selection, mode, display names, timestamps, colors, camera, tabs, and other UI-only state. A deterministic 64-bit FNV-1a hash is returned as `clp1-` plus 16 lowercase hexadecimal characters.

Every external source-changing request includes `expectedRevision`. A pending user decision blocks another WebMCP source write. A mismatched revision returns `stale_revision` without changing history. The existing transaction engine still performs its stricter generation/base-fingerprint/restaging checks when the page executes the operation.

## Consent

There is no WebMCP confirmation tool.

- Agent-requested removal is staged as `agent-destructive` and appears in the Agent tab with **Confirm removal** / **Cancel**.
- A proposed electrical hazard uses the existing Circuit Lab electrical-hazard confirmation UI.
- While a decision is pending, manual source-changing controls are blocked so the pending human decision cannot be silently replaced.
- Confirm actions re-check the canonical revision. A stale human confirmation cancels the staged UI action and commits nothing.
- Reads and nonmutating navigation remain available.

## Output and trust boundary

Tool schemas reject additional properties and bound stable IDs/revisions. Handlers revalidate IDs, current state, revision, pending state, endpoints, and transaction feasibility instead of trusting schema enforcement alone. Results are JSON-serializable and kept to a roughly 1.5K-character budget; user-controlled display strings are truncated.

WebMCP activity is session-only. It records tool/event type, result code, stable affected IDs, revision before/after, and duration. It does not record full prompts, conversations, raw tool results, project snapshots, provider IDs, secrets, file handles, or local paths.

## Build evidence semantics

A physical/topological controller assignment and a semantic firmware binding are different claims. With no `MechatronicsBinding`, a repaired mission can legitimately report:

```json
{
  "topologyAssignments": [
    {"deviceTerminal":"servo.signal","controllerTerminal":"arduino.D9","basis":"topology-derived"}
  ],
  "semanticPinMapStatus": "absent_binding",
  "semanticPinMap": []
}
```

The generated code path remains source-only. Nothing in WebMCP implies firmware compilation, flashing, execution, hardware verification, or physical safety certification.

## Quick Model Benchmark

The benchmark is a task-specific developer aid, not a general model leaderboard.

Versions:

- scenario: `servo-repair-v1`, v1
- toolset: v1
- rubric: v2
- storage: `localStorage["robostudio:webmcp-benchmark:v2"]`

A run is agent-only only when canonical source changes come from WebMCP execution or human confirmation. Camera/zoom/selection/issue viewing/confirmation do not invalidate it. During an active run, normal source-changing controls, keyboard wiring, binding edits, import paths, undo/redo, and persistent control changes are locked; canonical history attribution remains a defense-in-depth check.

Automatic final-state pass checks require zero DRC errors, the exact mission component set, Arduino as controller, D9 signal preserved, servo power connected to external VPLUS but not controller power, common servo/supply/Arduino ground, no pending confirmation, and agent-only attribution. Connectivity is graph-based, so equivalent breadboard contacts pass.

Automatic score: 70 correctness points + 30 process points. Process credit checks diagnosis before the first write, matching connection previews at the same revision, final diagnosis after the last source change, build evidence after the final diagnosis, and absence of invalid/stale/mechanically blocked calls.

Completed failures remain in pass-rate calculations. **Best observed on this mission** is allowed only when at least two configurations each have three or more completed agent-only runs under matching versions.

Stored records are schema-validated summaries capped at 30. Imported records are rebuilt from a fixed allowlist of fields so unexpected project/raw-output payloads are discarded.

## Tests

```bash
npm ci
npm test
npm run build
npm run test:browser
```

The browser test injects a fake imperative `document.modelContext` before page startup, verifies registration of all seven tools, completes the servo mission through tool execution plus visible user consent, checks saved-workspace isolation and stale destructive confirmation, exercises benchmark source locking/interruption, and checks the three challenge desktop viewports. The focused suite runs in the `WebMCP Browser Tests` GitHub Actions workflow. Real-client evaluation should use the fixed mission prompt and preserve failed/aborted runs.

## Limitations

- WebMCP is feature-detected; unsupported browsers show **Unsupported** and do not break ordinary Circuit Lab.
- The benchmark cannot independently discover/verify model identity, reasoning setting, or the external conversation; labels are manually entered.
- The benchmark is local observational data, not signed/tamper-proof evidence.
- No physical measurement replaces the catalog's generic engineering assumptions. Remaining `generic-rating-review` warnings must be treated as real review requirements.
