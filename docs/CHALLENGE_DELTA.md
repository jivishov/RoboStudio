# WebMCP Challenge Delta

## Authoritative baseline

The WebMCP challenge implementation is based on RoboStudio `main` commit:

`d19e46c36bab44f46f7a412ae65f8e036bfa7567`

That was revalidated as the tip of `main` immediately before the challenge commit on September 3, 2026.
The older Circuit Lab files supplied as planning context were not copied over the live repository.

Pre-coding revalidation also found that live `main` had already advanced its workspace database contract to **IndexedDB version 5** with a `part-projects` store. The planning document and older attached `AGENTS.md` still described version 4. Per the plan's authoritative-main rule, this implementation preserves live version 5 and makes no WebMCP database/store change.

The baseline already contained the transaction-oriented Circuit Lab architecture used here, including:

- `CircuitLabProject` V1 in millimeters with stable component/terminal IDs.
- Physical occupancy and breadboard connectivity.
- `stageWireMutation`, `stageDisconnectMutation`, `stageInsertionMutation`, and `commitStagedMutation`.
- Candidate-project DRC and stale transaction checks.
- Visible electrical-hazard confirmation.
- Deterministic DRC, readiness, artifacts, source-only Arduino/ESP-IDF generation, and browser tests.
- GitHub Pages deployment through Vite.

The baseline commit message records 744 passing tests (1 skipped) and a successful Vite build at the time that baseline was published. This challenge implementation does not treat that historical result as a fresh verification; the challenge commit is verified again by the repository's Pages workflow (`npm ci`, `npm test`, `npm run build`). Browser/real-client WebMCP validation remains a separate gate because the existing Pages workflow does not execute `npm run test:browser`.

## Challenge-period additions

The implementation added a deliberately narrow Circuit Lab WebMCP vertical slice rather than exposing RoboStudio's full internal assistant catalog:

- Canonical Circuit Lab design revisions (`clp1-…`) that ignore UI-only state.
- Deterministic `servo-repair-v1` unsafe mission derived from the current starter circuit.
- Saved-workspace isolation for mission/benchmark URLs.
- Exactly seven public WebMCP tools:
  - `get_circuit_state`
  - `diagnose_circuit`
  - `show_circuit_issue`
  - `preview_connection`
  - `connect_terminals`
  - `remove_connection`
  - `get_build_evidence`
- Sequential imperative WebMCP registration with a shared abort lifecycle.
- Visible human consent for agent-destructive removal and reuse of the existing Circuit Lab electrical-hazard confirmation for hazardous connections.
- Session-only, bounded WebMCP activity instrumentation.
- An Agent tab integrated into the existing workflow drawer, without adding a permanent fourth column.
- Quick Model Benchmark v2 for this one mission, with graph-equivalent final-state scoring, process scoring, benchmark lock, conservative comparison labels, privacy-bounded local storage, and JSON/Markdown export.
- Deterministic Node tests plus a fake-`modelContext` browser test.
- Root MIT license for RoboStudio-owned code while preserving third-party licensing boundaries.

## Deliberately unchanged architecture

The implementation does **not** replace or fork the existing engineering authority. In particular:

- `src/circuits/transactions.js`, `testBench.js`, `connectivity.js`, `drcFingerprint.js`, `codegen.js`, and `workspaceDb.js` remain the authoritative mechanics/electrical paths.
- Because the challenge integration is layered onto the already-large live Circuit Lab page without replacing it, two narrow seams were added outside `src/circuits.js`: session-history change observation/bootstrap in `src/history.js`, and Circuit-Lab-only demo read isolation in `src/workspaceStore.js`. The latter activates only on `circuits.html` mission/benchmark URLs and does not change writes, stores, or portable project state.
- WebMCP writes are restaged and executed through the current live Circuit Lab interaction/transaction path.
- No remote MCP server, new provider backend, browser firmware compilation, flashing, serial access, SPICE claim, physical certification, or robot-control path was added.
- Benchmark records stay in `localStorage`; no IndexedDB schema/store changes were made for WebMCP.

## Evidence-claim boundary

Without a saved `MechatronicsBinding`, `get_build_evidence` reports the Arduino D9 relationship as **topology-derived** and reports `semanticPinMapStatus: "absent_binding"`. It does not call an empty semantic artifact pin map a generated pin map.

All generated firmware remains source-only. RoboStudio does not claim that the circuit was built, flashed, executed, physically tested, or certified.
