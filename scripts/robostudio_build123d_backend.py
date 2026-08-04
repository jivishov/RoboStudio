"""The local build123d bridge: one declarative payload in, STEP/STL/mesh out.

## What changed in cycle 10

Before it, this script read ``payload["body"]["advancedCadRecipe"]`` and nothing else, so
four of the five Component Builder body kinds had no representation it accepted and the
export menu said so.  It also *reserved* four operation types - ``boolean``, ``pattern``,
``transform``, ``label`` - refusing them here while the browser refused the same four by
telling the user to install this backend.  The page named a remedy that would refuse.

Cycle 10 removed the straddle from both ends:

* The browser implements ``boolean``, ``pattern``, ``transform`` and ``thread``; ``label``
  is gone from the type list entirely, because no kernel here can emboss text and a type
  nothing can build is not a type.
* This bridge implements **every** type the browser does, plus the three only it can do -
  ``fillet``, ``chamfer``, ``shell`` - because a recipe carrying a fillet arrives here
  whole, patterns and threads and all.

The invariant that keeps the two lists honest is asserted from the JavaScript side:
``tests/parts/backendParity.test.js`` reads ``DISPATCHED_OPERATION_TYPES`` below and
requires it to equal ``ADVANCED_CAD_OPERATION_TYPES``.  A list in Python cannot be shared
with one in JavaScript, but the *direction* of truth can be, and that is the direction.

## Numbers arrive resolved

Nothing here consults a standards table, and that is deliberate rather than incidental.
build123d ships ``IsoThread`` and it would answer from its own tables, so an M8 built here
could differ by microns from the M8 in the preview with nothing to say why.  Threads
therefore arrive with ``resolvedThread`` - the diameters, pitch and flats
``src/parts/standards/threads.js`` produced - and this file builds from those numbers.
The same rule covers hole pockets, which arrive as shapes and depths rather than as
fastener designations to re-resolve.

## Tessellation

``export_stl`` receives the caller's ``toleranceMm``, which is
``DEFAULT_CHORD_TOLERANCE_MM`` from ``src/parts/tessellation.js``.  Before cycle 10 it was
called with no tolerance at all, so a mesh previewed from here was faceted by build123d's
default while the same body previewed from the browser was faceted by that constant - two
unrelated faceting rules on one preview surface.

## Verification status

⚠ The paths below that need a real build123d install have **not** been executed in the
environment this was written in, which has no build123d.  The JavaScript half, the payload
shapes and the dispatch coverage are all under test; the OCCT calls are not.  Treat a
first local run as the verification step and expect the failure mode to be a clean
``advanced-cad-compile-error`` naming the call that did not exist.
"""

import base64
import json
import math
import os
import sys
import tempfile
from pathlib import Path

PAYLOAD_VERSION = 1

# Every advanced-CAD operation this bridge dispatches. Read by the JavaScript parity test
# and required to equal `ADVANCED_CAD_OPERATION_TYPES`; keep it a plain literal so that
# test can parse it without running Python.
DISPATCHED_OPERATION_TYPES = [
    "box",
    "cylinder",
    "hole",
    "slot",
    "thread",
    "boolean",
    "pattern",
    "transform",
    "fillet",
    "chamfer",
    "shell",
]

# Every exact-body kind this bridge builds. Same contract, against `contracts.js`.
DISPATCHED_BODY_KINDS = [
    "sketchExtrude",
    "revolve",
    "spurGear",
    "booleanOperation",
    "advancedCadRecipe",
]

# Which world axis each named face looks along, as (axis letter, sign).
#
# The page's convention is that Y is the extrusion axis and X/Z are the sketch plane, so
# `top` is +Y and `front` is -Z. It is stated here and in `ADVANCED_CAD_EDGE_FACES` on the
# JavaScript side, and those two statements have to agree by reading rather than by test:
# an edge selector's meaning is not observable from a volume.
FACE_AXES = {
    "top": ("Y", 1),
    "bottom": ("Y", -1),
    "right": ("X", 1),
    "left": ("X", -1),
    "back": ("Z", 1),
    "front": ("Z", -1),
}


class BridgeError(Exception):
    """A refusal with a sentence, distinct from an OCCT failure."""


# The real stdout, saved before OCCT is allowed anywhere near file descriptor 1.
# `None` until `main` redirects; `respond` falls back to ordinary stdout so the helper
# stays usable from a REPL or a test that calls it directly.
_RESPONSE_FD = None


def respond(payload):
    """Write the one JSON document this bridge speaks, on the real stdout.

    ⚠ It goes through the saved descriptor rather than `sys.stdout`, because during a
    compile descriptor 1 is pointed at a scratch buffer. See `main`.
    """
    text = json.dumps(payload, separators=(",", ":"))
    if _RESPONSE_FD is None:
        sys.stdout.write(text)
        sys.stdout.flush()
        return
    os.write(_RESPONSE_FD, text.encode("utf-8"))


def finite_number(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def positive_number(value, fallback=1.0):
    number = finite_number(value, fallback)
    return number if number > 0 else fallback


def vector3(value, fallback=(0.0, 0.0, 0.0)):
    source = value if isinstance(value, list) else []
    return tuple(
        finite_number(source[index] if index < len(source) else fallback[index], fallback[index])
        for index in range(3)
    )


def points2d(value):
    source = value if isinstance(value, list) else []
    return [(finite_number(point[0]), finite_number(point[1])) for point in source if isinstance(point, list) and len(point) >= 2]


# ------------------------------------------------------------------ placement helpers


def axis_rotation(axis):
    """Send a Z-built primitive onto the operation's axis.

    Mirrors `orientZSolidToAxis` in `advancedCadRecipe.js`, which is what makes the two
    kernels agree about which way a hole points. A cylinder is symmetric about its own
    centre, so the sign of the quarter turn is immaterial and only the plane matters.
    """
    if axis == "x":
        return (0, 90, 0)
    if axis == "z":
        return (0, 0, 0)
    return (-90, 0, 0)


def placed(bd, solid, center=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0)):
    return bd.Pos(*center) * bd.Rot(*rotation) * solid


def combine(current, solid, mode):
    """Apply one operation's mode, with the same first-operation rule as the browser."""
    if current is None:
        if mode == "subtract":
            raise BridgeError("The first advanced CAD operation must add base geometry before subtractive features.")
        return solid
    if mode == "subtract":
        return current - solid
    if mode == "intersect":
        return current & solid
    return current + solid


def reduce_with(operation, solids):
    if not solids:
        raise BridgeError(f"A {operation} operation was given no geometry to combine.")
    result = solids[0]
    for solid in solids[1:]:
        if operation == "subtract":
            result = result - solid
        elif operation == "intersect":
            result = result & solid
        else:
            result = result + solid
    return result


# ------------------------------------------------------------------ recipe operations


def build_box(bd, operation):
    size = vector3(operation.get("size"), (10.0, 10.0, 10.0))
    return placed(
        bd,
        bd.Box(positive_number(size[0], 10.0), positive_number(size[1], 10.0), positive_number(size[2], 10.0)),
        vector3(operation.get("center")),
    )


def build_cylinder(bd, operation):
    radius = positive_number(operation.get("radius"), positive_number(operation.get("diameter"), 2.0) / 2.0)
    height = positive_number(operation.get("height"), positive_number(operation.get("depth"), 6.0))
    axis = operation.get("axis") if operation.get("axis") in {"x", "y", "z"} else "y"
    return placed(bd, bd.Cylinder(radius=radius, height=height), vector3(operation.get("center")), axis_rotation(axis))


def build_slot(bd, operation):
    """A rounded slot: length along X, width along Z, depth along Y.

    ⚠ The pre-cycle-10 version extruded `amount=depth, both=True`, which is **twice** the
    depth the recipe asked for. It never showed, because a slot is always subtractive and
    a cutter that reaches too far through a plate removes the same material - but a slot
    in a thicker body would have cut through it. The browser's slot is exactly `depth`, so
    this is `depth / 2` in each direction.
    """
    center = vector3(operation.get("center"))
    length = positive_number(operation.get("length"), 10.0)
    width = positive_number(operation.get("width"), 5.0)
    depth = positive_number(operation.get("depth"), positive_number(operation.get("height"), 6.0))
    angle = finite_number(operation.get("angleDeg"), 0.0)
    with bd.BuildPart() as builder:
        with bd.BuildSketch(bd.Plane.XZ):
            with bd.Locations((center[0], center[2])):
                bd.SlotOverall(length, width, rotation=angle)
        bd.extrude(amount=depth / 2.0, both=True)
    # ⚠ Placed by translating the solid rather than by `Plane.XZ.offset(center[1])`.
    # `Plane.XZ`'s normal is **-Y**, so offsetting by `+c` puts the sketch at `y = -c` -
    # a sign inversion that the pre-cycle-10 version carried and that no test could see,
    # because a symmetric plate is the same shape reflected.
    return bd.Pos(0, center[1], 0) * builder.part


def build_thread(bd, operation):
    """A helical rib on its core, swept from the profile the standards table resolved.

    Not `IsoThread`, deliberately: it would derive the minor diameter from its own tables
    and this project already has one. `resolvedThread` carries every figure - major,
    minor, pitch, crest flat - from `src/parts/standards/threads.js`, and the profile
    below is `threads.js`'s `threadTurnProfile` in the same frame, so the two kernels
    sweep the same shape.
    """
    resolved = operation.get("resolvedThread")
    if not isinstance(resolved, dict):
        raise BridgeError(
            f"Thread operation {operation.get('id')} arrived without resolvedThread. "
            "The bridge holds no thread table and must not invent one."
        )

    pitch = positive_number(resolved.get("pitchMm"), 0.0)
    major_radius = positive_number(resolved.get("majorDiameterMm"), 0.0) / 2.0
    minor_radius = positive_number(resolved.get("minorDiameterMm"), 0.0) / 2.0
    crest_flat = positive_number(resolved.get("crestFlatMm"), 0.0)
    length = positive_number(operation.get("length"), 0.0)
    if not (pitch > 0 and major_radius > minor_radius > 0 and length > 0):
        raise BridgeError(f"Thread operation {operation.get('id')} carries no usable resolved geometry.")

    # One turn of headroom at each end, so the trim always cuts through full thread rather
    # than through the ramp at either end of the sweep. Same arithmetic as `threads.js`.
    turns = math.ceil(length / pitch) + 2
    swept = turns * pitch
    half_pitch = pitch / 2.0
    half_crest = crest_flat / 2.0

    with bd.BuildPart() as rib:
        with bd.BuildLine():
            bd.Helix(pitch=pitch, height=swept, radius=minor_radius)
        with bd.BuildSketch(bd.Plane.XZ):
            with bd.Locations((minor_radius, 0)):
                bd.Polygon(
                    (0.0, -half_pitch),
                    (major_radius - minor_radius, -half_crest),
                    (major_radius - minor_radius, half_crest),
                    (0.0, half_pitch),
                    align=None,
                )
        bd.sweep(is_frenet=True)

    core = bd.Cylinder(radius=minor_radius, height=swept + pitch)
    clip = bd.Cylinder(radius=major_radius + 1.0, height=length)
    solid = (core + bd.Pos(0, 0, -swept / 2.0) * rib.part) & clip

    axis = operation.get("axis") if operation.get("axis") in {"x", "y", "z"} else "z"
    return placed(bd, solid, vector3(operation.get("center")), axis_rotation(axis) if axis != "z" else (0, 0, 0))


def patterned_solids(bd, operation, targets):
    """A pattern's copies on a rectangular grid, index [0,0,0] included.

    Included rather than skipped for the reason `patternedSolids` in the browser gives:
    the original is usually already in the accumulation so unioning it again changes
    nothing, but a pattern of an unapplied cutter would otherwise be short by one, and
    that is the harder mistake to see.
    """
    repeat = operation.get("repeat") if isinstance(operation.get("repeat"), list) else [1, 1, 1]
    spacing = vector3(operation.get("spacing"))
    counts = [max(1, int(finite_number(repeat[index] if index < len(repeat) else 1, 1))) for index in range(3)]
    copies = []
    for ix in range(counts[0]):
        for iy in range(counts[1]):
            for iz in range(counts[2]):
                offset = (ix * spacing[0], iy * spacing[1], iz * spacing[2])
                for target in targets:
                    copies.append(bd.Pos(*offset) * target)
    return copies


def apply_transform(bd, solid, operation):
    """A rotation about one axis through `center`, then a translation.

    The same composition order as `applyOperationTransform` in the browser, which is what
    makes a recipe that rotates about a feature centre land in the same place twice.
    """
    center = vector3(operation.get("center"))
    angle = finite_number(operation.get("angleDeg"), 0.0)
    result = solid
    if angle:
        axis = operation.get("axis") if operation.get("axis") in {"x", "y", "z"} else "y"
        rotation = {"x": (angle, 0, 0), "y": (0, angle, 0), "z": (0, 0, angle)}[axis]
        result = bd.Pos(*center) * bd.Rot(*rotation) * bd.Pos(*[-value for value in center]) * result
    vector = vector3(operation.get("vector"))
    if any(value != 0 for value in vector):
        result = bd.Pos(*vector) * result
    return result


# ------------------------------------------------------------------ edge selection


def select_edges(bd, part, selector):
    """The edges a fillet or chamfer is aimed at, or a refusal.

    ⚠ A selector that names no edge **refuses**. Filleting nothing would be silently
    wrong: the user asked for a rounded edge, did not get one, and a faceted preview
    cannot show the difference.
    """
    kind = (selector or {}).get("kind", "all")
    edges = part.edges()

    if kind == "axis":
        axis_name = (selector.get("axis") or "z").upper()
        edges = edges.filter_by(getattr(bd.Axis, axis_name))
    elif kind == "face":
        face_name = selector.get("face") or "top"
        if face_name not in FACE_AXES:
            raise BridgeError(f"Unknown edge selector face: {face_name}.")
        axis_name, sign = FACE_AXES[face_name]
        faces = part.faces().sort_by(getattr(bd.Axis, axis_name))
        edges = (faces[-1] if sign > 0 else faces[0]).edges()

    minimum = selector.get("minLengthMm") if selector else None
    maximum = selector.get("maxLengthMm") if selector else None
    if minimum is not None:
        edges = edges.filter_by(lambda edge: edge.length >= finite_number(minimum, 0.0))
    if maximum is not None:
        edges = edges.filter_by(lambda edge: edge.length <= finite_number(maximum, math.inf))

    if len(edges) == 0:
        raise BridgeError(
            f"Edge selector {json.dumps(selector or {'kind': 'all'})} matched no edge on this part. "
            "A fillet that is asked for and not applied is invisible in a faceted preview, so this refuses."
        )
    return edges


def apply_finish(bd, part, operation):
    """Fillet, chamfer or shell one part and return the result.

    ⚠ The pre-cycle-10 version took the *builder* and its `shell` branch never read it - a
    signature that lied about what its branches used, which is how the next edge-selection
    change lands in the wrong branch. It takes and returns the part now, so every branch
    reads its argument and the caller can see the reassignment.
    """
    op_type = operation.get("type")
    if op_type == "shell":
        return bd.offset(part, amount=-positive_number(operation.get("thicknessMm"), 1.0))

    radius = positive_number(operation.get("radius"), 1.0)
    edges = select_edges(bd, part, operation.get("edgeSelector") or {"kind": "all"})
    if op_type == "fillet":
        return bd.fillet(edges, radius)
    return bd.chamfer(edges, radius)


# ------------------------------------------------------------------ recipe assembly


def recipe_to_part(bd, recipe):
    operations = recipe.get("operations") if isinstance(recipe.get("operations"), list) else []
    solids_by_id = {}
    part = None

    def targets_of(operation):
        return [solids_by_id[target] for target in (operation.get("targetIds") or []) if target in solids_by_id]

    for operation in operations:
        op_type = operation.get("type")
        mode = operation.get("mode") if operation.get("mode") in {"add", "subtract", "intersect"} else "add"

        if op_type in {"fillet", "chamfer", "shell"}:
            if part is None:
                raise BridgeError(f"A {op_type} operation needs geometry to work on.")
            part = apply_finish(bd, part, operation)
            continue

        if op_type == "boolean":
            combined = reduce_with(operation.get("operation") or "union", targets_of(operation))
            solids_by_id[operation.get("id")] = combined
            part = combine(part, combined, mode)
            continue

        if op_type == "pattern":
            combined = reduce_with("union", patterned_solids(bd, operation, targets_of(operation)))
            solids_by_id[operation.get("id")] = combined
            part = combine(part, combined, mode)
            continue

        if op_type == "transform":
            targets = targets_of(operation)
            if not targets:
                if part is None:
                    raise BridgeError("A transform operation needs geometry to move.")
                part = apply_transform(bd, part, operation)
                continue
            moved = reduce_with("union", [apply_transform(bd, target, operation) for target in targets])
            solids_by_id[operation.get("id")] = moved
            part = combine(part, moved, mode)
            continue

        if op_type == "box":
            solid = build_box(bd, operation)
        elif op_type in {"cylinder", "hole"}:
            solid = build_cylinder(bd, operation)
        elif op_type == "slot":
            solid = build_slot(bd, operation)
        elif op_type == "thread":
            solid = build_thread(bd, operation)
        else:
            raise BridgeError(f"Unsupported advanced CAD operation: {op_type}")

        solids_by_id[operation.get("id")] = solid
        part = combine(part, solid, "subtract" if op_type in {"hole", "slot"} else mode)

    if part is None:
        raise BridgeError("Advanced CAD recipe did not produce a solid.")
    return part


# ------------------------------------------------------------------ exact body kinds


def profile_sketch_shape(bd, profile):
    """One sketch profile as a build123d 2D object, at its authored position.

    Exact by construction for all four types: a circle is a circle rather than a polygon
    of it, which is the whole reason a payload of profiles beats a payload of triangles.
    """
    kind = profile.get("type")
    x = finite_number(profile.get("x"))
    z = finite_number(profile.get("z"))

    if kind == "circle":
        with bd.Locations((x, z)):
            return bd.Circle(positive_number(profile.get("radiusMm"), 1.0))
    if kind == "roundedSlot":
        with bd.Locations((x, z)):
            return bd.SlotOverall(
                positive_number(profile.get("lengthMm"), 1.0),
                positive_number(profile.get("widthMm"), 1.0),
            )
    if kind == "rectangle":
        corner = max(0.0, finite_number(profile.get("cornerRadiusMm"), 0.0))
        width = positive_number(profile.get("widthMm"), 1.0)
        height = positive_number(profile.get("heightMm"), 1.0)
        with bd.Locations((x, z)):
            if corner > 0:
                return bd.RectangleRounded(width, height, min(corner, min(width, height) / 2.0 - 1e-3))
            return bd.Rectangle(width, height)
    if kind == "polyline":
        points = points2d(profile.get("points"))
        if len(points) < 3:
            raise BridgeError("A polyline profile needs at least three points.")
        return bd.Polygon(*points, align=None)

    raise BridgeError(f"No exact payload exists for profile type {kind}.")


def pocket_cutter(bd, pocket, half_depth):
    """A blind pocket cutter, placed against the face its hole names.

    Mirrors `pocketCutterCanonical` and `placePocketCutter` in `cadCompile.js`, including
    the 0.01 mm overcut, which exists only so a cutter's end cap is never coplanar with
    the face it cuts through - the place CSG kernels produce zero-area artefacts. It
    removes no extra material, so the pocket depth stays exactly what the standard says.
    """
    overcut = 0.01
    depth = abs(finite_number(pocket.get("depthMm")))
    height = depth + overcut
    from_top = pocket.get("fromFace") != "bottom"
    shape = pocket.get("shape")

    if shape == "cone":
        top_radius = abs(finite_number(pocket.get("topDiameterMm"))) / 2.0
        bottom_radius = abs(finite_number(pocket.get("bottomDiameterMm"))) / 2.0
        taper = (top_radius - bottom_radius) / depth if depth else 0.0
        cutter = bd.Cone(
            bottom_radius=bottom_radius,
            top_radius=top_radius + overcut * taper,
            height=height,
        )
    elif shape == "hexPrism":
        # A hexagon inscribed in the across-corners radius, so the flats fall out exactly.
        radius = abs(finite_number(pocket.get("acrossCornersMm"))) / 2.0
        with bd.BuildPart() as prism:
            with bd.BuildSketch():
                bd.RegularPolygon(radius=radius, side_count=6)
            bd.extrude(amount=height)
        cutter = bd.Pos(0, 0, -height / 2.0) * prism.part
    else:
        radius = abs(finite_number(pocket.get("diameterMm"))) / 2.0
        cutter = bd.Cylinder(radius=radius, height=height)

    # Canonical frame: mouth at local Z = 0, material removed for Z in [-depth, +overcut].
    cutter = bd.Pos(0, 0, (overcut - depth) / 2.0) * cutter
    rotation = (-90, 0, 0) if from_top else (90, 0, 0)
    y = half_depth if from_top else -half_depth
    return bd.Pos(finite_number(pocket.get("x")), y, finite_number(pocket.get("z"))) * bd.Rot(*rotation) * cutter


def sketch_extrude_part(bd, payload):
    depth = positive_number(payload.get("extrudeDepthMm"), 1.0)
    with bd.BuildPart() as builder:
        with bd.BuildSketch(bd.Plane.XZ):
            profile_sketch_shape(bd, payload.get("outerProfile") or {})
        bd.extrude(amount=depth / 2.0, both=True)
    part = builder.part

    # Cuts are extruded and subtracted as solids rather than mode-subtracted inside the
    # sketch. Both routes give the same region for the sketches this page validates -
    # `validateBody` already refuses a cut that leaves the outer profile - and the solid
    # route keeps each cut a separate shape, which is what the pocket stage below needs.
    for cut in payload.get("cutProfiles") or []:
        with bd.BuildPart() as cutter:
            with bd.BuildSketch(bd.Plane.XZ):
                profile_sketch_shape(bd, cut)
            bd.extrude(amount=depth, both=True)
        part = part - cutter.part

    for pocket in payload.get("pockets") or []:
        part = part - pocket_cutter(bd, pocket, depth / 2.0)
    return part


def revolve_part(bd, payload):
    """A surface of revolution about Y, which is where the browser's revolve axis lands.

    ⚠ A partial revolve may start at a different angle than the browser's, because
    `extrudeRotate` and OCCT do not agree on where zero is. The solid is the same shape
    about the same axis; only its rotation about that axis can differ. Stated rather than
    silently corrected, because correcting it would need a measurement nobody has made.
    """
    points = points2d(payload.get("profilePoints"))
    if len(points) < 3:
        raise BridgeError("A revolve profile needs at least three points.")
    angle = finite_number(payload.get("angleDeg"), 360.0)
    with bd.BuildPart() as builder:
        with bd.BuildSketch(bd.Plane.XY):
            bd.Polygon(*points, align=None)
        bd.revolve(axis=bd.Axis.Y, revolution_arc=min(360.0, abs(angle)))
    return builder.part


def spur_gear_part(bd, payload):
    """The gear's transverse profile, extruded along Y and twisted if it is helical.

    The profile arrives sampled - involute flanks are a point list at the page's chord
    tolerance, and the payload says so through `fidelity` - but everything else is exact.
    A helical gear has no twist-extrude in OCCT, so it is lofted over the **same**
    `twistSteps` sections the browser uses, which keeps the two approximations identical
    rather than letting each kernel pick its own.
    """
    points = points2d(payload.get("profilePoints"))
    if len(points) < 3:
        raise BridgeError("A spur gear profile needs at least three points.")
    thickness = positive_number(payload.get("thicknessMm"), 1.0)
    bore = max(0.0, finite_number(payload.get("boreDiameterMm")))
    twist = finite_number(payload.get("twistAngleRad"), 0.0)
    steps = max(1, int(finite_number(payload.get("twistSteps"), 1.0)))

    def section(y, angle_deg):
        # Negated, because `Plane.XZ`'s normal is -Y. See the note in `build_slot`.
        with bd.BuildSketch(bd.Plane.XZ.offset(-y)) as sketch:
            bd.Polygon(*points, align=None, rotation=angle_deg)
            if bore > 0:
                bd.Circle(bore / 2.0, mode=bd.Mode.SUBTRACT)
        return sketch.sketch

    if twist == 0.0:
        # ⚠ The algebra call, not `BuildPart` + `add` + `extrude`. On a gear's outline -
        # 480 sampled points with a bore - the builder path returned **87 solids** with
        # self-intersecting wires, `is_valid` false, **zero volume**, and 38 faces OCCT
        # then refused to mesh. The sketch going in is perfect either way: its area is the
        # profile's shoelace value to the last digit. Only the extrude differed.
        #
        # This produces one valid solid, no untriangulated face, and a volume equal to
        # `area * thickness` exactly. `ShapeFix_Shape` does **not** repair the builder's
        # output (38 bad faces to 36, still invalid), so this is the fix rather than
        # healing after the fact.
        return bd.extrude(section(0.0, 0.0), amount=thickness / 2.0, both=True)

    with bd.BuildPart() as builder:
        for index in range(steps + 1):
            fraction = index / steps
            bd.add(section(-thickness / 2.0 + fraction * thickness, math.degrees(twist) * fraction))
        bd.loft()
    return builder.part


def boolean_part(bd, payload, tolerance_mm):
    operands = [exact_body_to_part(bd, operand, tolerance_mm) for operand in payload.get("operands") or []]
    if not operands:
        raise BridgeError("A boolean body needs at least one operand to export.")
    return reduce_with(payload.get("operation") or "union", operands)


def apply_scale(bd, part, scale):
    """Bake the body's placement scale, as `compileBodyToStlSolid` does on the other side.

    A body the user has scaled must not export at nominal size silently, which is the same
    rule DXF follows.
    """
    if all(abs(value - 1.0) < 1e-12 for value in scale):
        return part
    return bd.scale(part, by=scale)


def exact_body_to_part(bd, payload, tolerance_mm):
    kind = payload.get("kind")
    if kind == "advancedCadRecipe":
        part = recipe_to_part(bd, payload.get("advancedCadRecipe") or {})
    elif kind == "sketchExtrude":
        part = sketch_extrude_part(bd, payload)
    elif kind == "revolve":
        part = revolve_part(bd, payload)
    elif kind == "spurGear":
        part = spur_gear_part(bd, payload)
    elif kind == "booleanOperation":
        part = boolean_part(bd, payload, tolerance_mm)
    else:
        raise BridgeError(f"No exact payload handler for body kind {kind}.")
    return apply_scale(bd, part, vector3(payload.get("scale"), (1.0, 1.0, 1.0)))


# ------------------------------------------------------------------ mesh readback


def triangle_normal(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    normal = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    length = math.sqrt(sum(item * item for item in normal)) or 1.0
    return tuple(item / length for item in normal)


def mesh_from_ascii_stl(source):
    points = []
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped.startswith("vertex "):
            continue
        parts = stripped.split()
        if len(parts) == 4:
            points.append(tuple(finite_number(item) for item in parts[1:4]))

    vertices = []
    normals = []
    mins = [math.inf, math.inf, math.inf]
    maxs = [-math.inf, -math.inf, -math.inf]
    for index in range(0, len(points) - 2, 3):
        tri = points[index : index + 3]
        normal = triangle_normal(tri[0], tri[1], tri[2])
        for point in tri:
            vertices.extend(point)
            normals.extend(normal)
            for axis in range(3):
                mins[axis] = min(mins[axis], point[axis])
                maxs[axis] = max(maxs[axis], point[axis])

    if not vertices:
        mins = [0.0, 0.0, 0.0]
        maxs = [0.0, 0.0, 0.0]
    size = [maxs[index] - mins[index] for index in range(3)]
    center = [mins[index] + size[index] / 2.0 for index in range(3)]
    return {
        "vertices": vertices,
        "normals": normals,
        "triangleCount": len(vertices) // 9,
        "bounds": {"min": mins, "max": maxs, "size": size, "center": center},
    }


def export_stl_text(bd, part, path, tolerance_mm):
    """ASCII STL at the caller's chord tolerance.

    Passed explicitly, and this is the point: before cycle 10 no tolerance was given, so
    this mesh and the browser's were faceted by two unrelated rules on one preview
    surface. The keyword is guarded because build123d has renamed it across releases and
    a bridge that crashes on an optional argument is worse than one that falls back to the
    default and says nothing changed.
    """
    try:
        bd.export_stl(part, path, ascii_format=True, tolerance=tolerance_mm)
        return True
    except TypeError:
        bd.export_stl(part, path, ascii_format=True)
        return False


# ------------------------------------------------------------------ entry point


def build_response():
    """Do the work and RETURN the payload. Never writes to stdout."""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        return {"ok": False, "code": "invalid-json", "message": f"Invalid CAD backend JSON: {exc}"}

    try:
        import build123d
    except Exception as exc:  # pragma: no cover - depends on local optional environment
        return {
            "ok": False,
            "code": "advanced-cad-backend-unavailable",
            "message": f"build123d is not installed in the configured CAD Python environment: {exc}",
        }

    exact_body = payload.get("exactBody") if isinstance(payload.get("exactBody"), dict) else None
    if not exact_body:
        return {
            "ok": False,
            "code": "advanced-cad-compile-error",
            "message": (
                "This bridge takes one exactBody payload, built by src/parts/backendPayload.js. "
                "The pre-cycle-10 shape, which carried a whole PartBody and read only its recipe, "
                "is gone: it had no representation for four of the five body kinds."
            ),
        }

    version = payload.get("payloadVersion")
    if version is not None and int(finite_number(version, PAYLOAD_VERSION)) != PAYLOAD_VERSION:
        return {
            "ok": False,
            "code": "advanced-cad-compile-error",
            "message": f"Unsupported exact payload version {version}; this bridge speaks version {PAYLOAD_VERSION}.",
        }

    tolerance_mm = positive_number(payload.get("toleranceMm"), 0.02)
    include_step = bool(payload.get("includeStep", True))
    include_stl = bool(payload.get("includeStl", False))
    include_mesh = bool(payload.get("includeMesh", False))

    try:
        part = exact_body_to_part(build123d, exact_body, tolerance_mm)
        result = {
            "ok": True,
            "bodyId": exact_body.get("id"),
            # Carried back so a caller can state what it received rather than assume.
            # A spur gear's flanks are sampled and the payload said so on the way in.
            "fidelity": exact_body.get("fidelity"),
            "warnings": [],
        }
        with tempfile.TemporaryDirectory(prefix="robostudio-cad-") as tmp:
            root = Path(tmp)
            stl_text = None
            if include_step:
                step_path = root / "part.step"
                build123d.export_step(part, step_path)
                result["stepBase64"] = base64.b64encode(step_path.read_bytes()).decode("ascii")
            if include_stl or include_mesh:
                stl_path = root / "part.stl"
                if not export_stl_text(build123d, part, stl_path, tolerance_mm):
                    result["warnings"].append({
                        "code": "advanced-cad-default-tessellation",
                        "message": (
                            "This build123d release did not accept a mesh tolerance, so the preview mesh "
                            "is faceted by its default rather than by the page's chord tolerance."
                        ),
                    })
                stl_text = stl_path.read_text(encoding="utf-8", errors="replace")
                if include_stl:
                    result["stl"] = stl_text
            if include_mesh and stl_text:
                result["mesh"] = mesh_from_ascii_stl(stl_text)
        return result
    except BridgeError as exc:
        return {"ok": False, "code": "advanced-cad-compile-error", "message": str(exc)}
    except Exception as exc:
        return {"ok": False, "code": "advanced-cad-compile-error", "message": str(exc)}


def main():
    """Run the bridge with descriptor 1 pointed away from the wire.

    ⚠ **OCCT writes to stdout from C++, underneath Python, and this protocol is "one JSON
    document on stdout".** A tessellation that skips a degenerate face prints

        Warning: 37 faces have been skipped due to null triangulation

    ahead of the JSON, and the caller's ``JSON.parse`` then throws on the ``W``. The caller
    reported that as ``Advanced CAD backend exited with code 0`` - a compile that had in
    fact succeeded, described by an exit code that was fine. Neither side was wrong on its
    own terms; the channel was shared.

    So descriptor 1 is redirected into a scratch buffer for the whole run and the response
    goes out on a saved duplicate. ``sys.stdout`` is *not* enough on its own: it would
    catch Python's prints and miss the C++ ones, which are the only ones that occur.

    What OCCT said is **kept, not discarded**. Suppressing it would trade a corrupted
    channel for a silent one, and that 37-face warning is a true statement about the gear
    it was building. It comes back as an ``advanced-cad-native-output`` warning.
    """
    global _RESPONSE_FD

    sys.stdout.flush()
    _RESPONSE_FD = os.dup(1)
    native = tempfile.TemporaryFile()
    os.dup2(native.fileno(), 1)

    try:
        payload = build_response()
    finally:
        sys.stdout.flush()
        os.dup2(_RESPONSE_FD, 1)
        native.seek(0)
        chatter = native.read().decode("utf-8", errors="replace").strip()
        native.close()

    if chatter and isinstance(payload, dict):
        payload.setdefault("warnings", []).append({
            "code": "advanced-cad-native-output",
            "message": f"The CAD kernel wrote to stdout while building: {chatter}",
        })

    respond(payload)


if __name__ == "__main__":
    main()
