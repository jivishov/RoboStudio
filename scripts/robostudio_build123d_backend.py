import base64
import json
import math
import sys
import tempfile
from pathlib import Path


def respond(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")))
    sys.stdout.flush()


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
    return tuple(finite_number(source[index] if index < len(source) else fallback[index], fallback[index]) for index in range(3))


def mode_for(build123d, value, fallback="add"):
    mode = value if value in {"add", "subtract", "intersect"} else fallback
    if mode == "subtract":
        return build123d.Mode.SUBTRACT
    if mode == "intersect":
        return build123d.Mode.INTERSECT
    return build123d.Mode.ADD


def cylinder_rotation(axis):
    if axis == "x":
        return (0, 90, 0)
    if axis == "y":
        return (90, 0, 0)
    return (0, 0, 0)


def add_box(build123d, operation):
    center = vector3(operation.get("center"))
    size = vector3(operation.get("size"), (10.0, 10.0, 10.0))
    with build123d.Locations(center):
        build123d.Box(
            positive_number(size[0], 10.0),
            positive_number(size[1], 10.0),
            positive_number(size[2], 10.0),
            mode=mode_for(build123d, operation.get("mode"), "add"),
        )


def add_cylinder(build123d, operation, subtract_default=False):
    center = vector3(operation.get("center"))
    radius = positive_number(operation.get("radius"), positive_number(operation.get("diameter"), 2.0) / 2.0)
    height = positive_number(operation.get("height"), positive_number(operation.get("depth"), 6.0))
    axis = operation.get("axis") if operation.get("axis") in {"x", "y", "z"} else "y"
    mode = build123d.Mode.SUBTRACT if subtract_default else mode_for(build123d, operation.get("mode"), "add")
    with build123d.Locations(center):
        build123d.Cylinder(
            radius=radius,
            height=height,
            rotation=cylinder_rotation(axis),
            mode=mode,
        )


def add_slot(build123d, operation):
    center = vector3(operation.get("center"))
    length = positive_number(operation.get("length"), 10.0)
    width = positive_number(operation.get("width"), 5.0)
    depth = positive_number(operation.get("depth"), positive_number(operation.get("height"), 6.0))
    angle = finite_number(operation.get("angleDeg"), 0.0)
    with build123d.BuildSketch(build123d.Plane.XZ.offset(center[1])) as sketch:
        with build123d.Locations((center[0], center[2])):
            build123d.SlotOverall(length, width, rotation=angle)
    build123d.extrude(sketch.sketch, amount=depth, both=True, mode=build123d.Mode.SUBTRACT)


def apply_finish(build123d, builder, operation):
    radius = positive_number(operation.get("radius"), 1.0)
    if operation.get("type") == "fillet":
        build123d.fillet(builder.edges(), radius)
    elif operation.get("type") == "chamfer":
        build123d.chamfer(builder.edges(), radius)
    elif operation.get("type") == "shell":
        build123d.offset(amount=-positive_number(operation.get("thicknessMm"), 1.0), mode=build123d.Mode.SUBTRACT)


def recipe_to_part(build123d, recipe):
    operations = recipe.get("operations") if isinstance(recipe.get("operations"), list) else []
    with build123d.BuildPart() as model:
        for operation in operations:
            op_type = operation.get("type")
            if op_type == "box":
                add_box(build123d, operation)
            elif op_type == "cylinder":
                add_cylinder(build123d, operation, False)
            elif op_type == "hole":
                add_cylinder(build123d, operation, True)
            elif op_type == "slot":
                add_slot(build123d, operation)
            elif op_type in {"fillet", "chamfer", "shell"}:
                apply_finish(build123d, model, operation)
            elif op_type in {"boolean", "pattern", "transform", "label"}:
                raise ValueError(f"Operation {op_type} is reserved but not implemented by the build123d bridge yet.")
            else:
                raise ValueError(f"Unsupported advanced CAD operation: {op_type}")
    return model.part


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


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        respond({"ok": False, "code": "invalid-json", "message": f"Invalid CAD backend JSON: {exc}"})
        return

    try:
        import build123d
    except Exception as exc:  # pragma: no cover - depends on local optional environment
        respond({
            "ok": False,
            "code": "advanced-cad-backend-unavailable",
            "message": f"build123d is not installed in the configured CAD Python environment: {exc}",
        })
        return

    body = payload.get("body") if isinstance(payload.get("body"), dict) else {}
    recipe = body.get("advancedCadRecipe") or payload.get("advancedCadRecipe") or {}
    include_step = bool(payload.get("includeStep", True))
    include_stl = bool(payload.get("includeStl", False))
    include_mesh = bool(payload.get("includeMesh", True))

    try:
        part = recipe_to_part(build123d, recipe)
        result = {"ok": True, "bodyId": body.get("id"), "warnings": []}
        with tempfile.TemporaryDirectory(prefix="robostudio-cad-") as tmp:
            root = Path(tmp)
            stl_text = None
            if include_step:
                step_path = root / "part.step"
                build123d.export_step(part, step_path)
                result["stepBase64"] = base64.b64encode(step_path.read_bytes()).decode("ascii")
            if include_stl or include_mesh:
                stl_path = root / "part.stl"
                build123d.export_stl(part, stl_path, ascii_format=True)
                stl_text = stl_path.read_text(encoding="utf-8", errors="replace")
                if include_stl:
                    result["stl"] = stl_text
            if include_mesh and stl_text:
                result["mesh"] = mesh_from_ascii_stl(stl_text)
        respond(result)
    except Exception as exc:
        respond({"ok": False, "code": "advanced-cad-compile-error", "message": str(exc)})


if __name__ == "__main__":
    main()
