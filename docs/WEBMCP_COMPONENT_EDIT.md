# WebMCP Component Editing

Ordinary `circuits.html` exposes one supplemental WebMCP tool in addition to the seven-tool challenge surface:

`edit_circuit_component`

The challenge URLs keep the original seven-tool `servo-repair-v1` surface so existing benchmark runs remain comparable:

- `circuits.html?mission=servo-repair-v1`
- `circuits.html?mission=servo-repair-v1&benchmark=1`

## Operations

The tool accepts one explicit operation at a time:

- `add` — add a built-in Circuit Lab catalog component, with optional display name and position.
- `remove` — remove one component. A visible browser confirmation is required because attached wiring endpoints may also be removed.
- `move` — move one component to a new millimeter position.
- `rotate` — set one component's rotation in degrees.
- `resize` — set one component's physical scale within Circuit Lab's supported `0.55–1.9` range.

All writes require the current canonical `clp1-...` design revision. Stale revisions and unknown component/type IDs commit nothing. The handler revalidates operation-specific fields even when browser-side JSON Schema enforcement is absent.

Add/move/rotate/resize execute through the existing Circuit Lab page actions, which already route geometry changes through insertion-aware transaction logic. If an edit is mechanically resolved but creates or worsens an electrical hazard, the existing Circuit Lab confirmation UI remains the human decision point. A second component edit is rejected while any visible confirmation is pending.

The supplemental tool is intentionally not registered on benchmark/demo mission URLs. This preserves `servo-repair-v1` toolset version 1 and prevents old and new benchmark runs from being silently grouped under different agent affordances.
