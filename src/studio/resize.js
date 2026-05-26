const AXIS_COUNT = 3;

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return number;
}

function positiveVector(value, fallback, label) {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: AXIS_COUNT }, (_item, index) =>
    positiveNumber(source[index], `${label}[${index}]`)
  );
}

function editedAxes(targetSize) {
  return Array.from({ length: AXIS_COUNT }, (_item, index) => {
    const number = Number(targetSize?.[index]);
    return Number.isFinite(number) && number > 0 ? index : null;
  }).filter((axis) => axis !== null);
}

export function scaleForTargetBounds(currentBoundsSize, currentScale, targetSize, options = {}) {
  const bounds = positiveVector(currentBoundsSize, [0, 0, 0], "currentBoundsSize");
  const scale = positiveVector(currentScale, [1, 1, 1], "currentScale");
  const axes = editedAxes(targetSize);
  if (!axes.length) throw new Error("Provide at least one positive target size.");

  if (options.uniform !== false) {
    const axis = Number.isInteger(options.axis) && axes.includes(options.axis) ? options.axis : axes[0];
    const factor = positiveNumber(targetSize[axis], `targetSize[${axis}]`) / bounds[axis];
    return scale.map((value) => value * factor);
  }

  const next = [...scale];
  for (const axis of axes) {
    next[axis] = scale[axis] * (positiveNumber(targetSize[axis], `targetSize[${axis}]`) / bounds[axis]);
  }
  return next;
}

