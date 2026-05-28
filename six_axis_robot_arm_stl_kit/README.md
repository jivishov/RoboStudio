# Original 6-Axis Robotic Arm STL Kit

This folder contains a standalone, procedurally generated 6-axis robotic arm kit. The geometry is original and generated from first-principles JSCAD solids.

The generator does not read, inspect, import, measure, trace, remix, compare against, or derive from any existing STL assets in this workspace.

## Generate

```powershell
npm run build
```

The command writes STL files to `stl/`, refreshes `manifest.json`, and writes `quality-report.json`.

## Drawings

After `npm run build`, the `drawings/` folder contains:

- `parts/*.svg`: one large technical drawing for each generated STL object.
- `part_sheet_01_04.svg` through `part_sheet_13_16.svg`: readable four-part sheets.
- `all_stl_objects.svg`: a large two-column contact sheet showing every part.
- `assembly_sketch.svg`: a clear full-arm assembly sketch with joint order and part groups.
- `assembly_steps.svg`: a step-by-step build sequence.
- `parts_index.html`: a browser-friendly index for reviewing all drawings.

Run `npm run draw:png` after `npm run build` to refresh PNG previews when Chrome is available locally.

## Design Targets

- Units: millimeters
- Hardware assumption: M3 fasteners
- M3 clearance holes: 3.2 mm
- Counterbores: 6.2 mm diameter by 3.2 mm deep
- Shaft-style joint bores: 8.35 mm, representing an 8 mm nominal shaft with 0.35 mm slip clearance
- Minimum wall target: 2.4 mm
- Approximate assembled reach: 450 mm

## Generated Parts

- J1 base yaw turntable
- J1 rotating column
- J2 shoulder yoke side plates
- J3 upper arm shells
- Elbow hub
- Forearm shells
- J4 wrist roll carrier
- J5 wrist pitch fork
- J6 tool roll flange
- Gripper adapter plate
- Cable channel cover
- Spacer set
- Axis alignment gauge

## Assembly Notes

1. Print parts flat where the manifest recommends `flat`.
2. Clean the 8.35 mm joint bores before fitting shafts or pins.
3. Use M3 fasteners with washers where plastic bears against rotating parts.
4. Assemble J1 through J6 in order, checking free rotation at each joint before adding the next module.
5. Route wiring through the rear cable channels and cover after all axes move freely.

This is a printable demonstration kit, not a certified load-bearing robot.
