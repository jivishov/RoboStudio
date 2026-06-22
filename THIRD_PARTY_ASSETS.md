# Third-Party Visual Assets

Circuit Lab production visuals use source-backed provenance records in `src/circuits/generated/visualProvenance.js`.

## Policy

- No Fritzing graphic is approved for the production bundle.
- Wokwi Elements visual references are pinned to `wokwi/wokwi-elements` tag `v1.9.2`, commit `3c8178e`.
- Runtime Circuit Lab project state must not serialize SVG, PNG, source paths, source revisions, provenance ids, Fritzing ids, Wokwi pin names, local paths, hashes, or vendor file handles.
- Imported visuals must have `approvalStatus: "approved"` before they can enter `src/circuits/visualCatalog.js`.
- RoboStudio-owned visuals are factual, educational drawings created for this project; they must not copy retailer, marketplace, manufacturer, forum, or Fritzing artwork.

## Current Sources

| Source | License | Status | Scope |
| --- | --- | --- | --- |
| RoboStudio original visuals | Project license | Approved | BB400-style breadboard, servo, fixed supply, capacitor, DC motor, potentiometer, L298N fallback |
| Wokwi Elements v1.9.2 (`3c8178e`) | MIT | Approved pinned source reference; no generated production visual is checked in yet | Arduino Uno R3, ESP32 DevKit V1, LED, resistor, pushbutton, HC-SR04, slide switch |
| Fritzing parts graphics | CC-BY-SA-3.0 | Blocked | Development-only future importer tests may use synthetic fixtures only |

## Runtime Boundary

Visual provenance exists in application source and documentation only. It is not part of `CircuitLabProject`, `.robostudio.json`, `.robostudio.zip`, build-guide ZIPs, generated source, DRC output, or assistant action arguments.
