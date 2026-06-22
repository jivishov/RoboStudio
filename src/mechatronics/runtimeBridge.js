import { normalizeMechatronicsBinding } from "./model.js";
import { validateMechatronicsBinding } from "./validation.js";

function finiteValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function transformValue(value, transform = {}) {
  const numeric = finiteValue(value);
  if (numeric === null) return null;
  const scaled = numeric * (Number.isFinite(Number(transform.scale)) ? Number(transform.scale) : 1)
    + (Number.isFinite(Number(transform.offset)) ? Number(transform.offset) : 0);
  return transform.invert ? -scaled : scaled;
}

function clampJointValue(robotDesign, jointId, value) {
  const joint = robotDesign?.joints?.find((item) => item.id === jointId);
  if (!joint || !Number.isFinite(value)) return value;
  const minimum = Number.isFinite(Number(joint.min)) ? Number(joint.min) : value;
  const maximum = Number.isFinite(Number(joint.max)) ? Number(joint.max) : value;
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveFirmwareChannelCommand({ robotDesign, circuitLabProject, mechatronicsBinding, channelId, value } = {}) {
  const binding = normalizeMechatronicsBinding(mechatronicsBinding);
  const validation = validateMechatronicsBinding({ robotDesign, circuitLabProject, binding });
  if (!validation.ok) {
    return { ok: false, reason: "semantic-run-blocked", diagnostics: validation.diagnostics };
  }
  const channel = binding.firmwareChannels.find((item) => item.id === channelId);
  if (!channel) return { ok: false, reason: "missing-channel", diagnostics: [] };

  const actuatorBinding = binding.actuatorBindings.find((item) => item.firmwareChannelIds.includes(channel.id));
  if (actuatorBinding && channel.semanticRole.startsWith("joint.command.")) {
    const command = channel.semanticRole.split(".").at(-1);
    const transformedValue = transformValue(value, actuatorBinding.commandTransform);
    if (transformedValue === null) return { ok: false, reason: "invalid-value", diagnostics: [] };
    const commandValue = command === "position"
      ? clampJointValue(robotDesign, actuatorBinding.jointId, transformedValue)
      : transformedValue;
    return {
      ok: true,
      type: "joint-command",
      jointId: actuatorBinding.jointId,
      channelId: channel.id,
      command,
      value: commandValue
    };
  }

  const sensorBinding = binding.sensorBindings.find((item) => item.firmwareChannelIds.includes(channel.id));
  if (sensorBinding && channel.semanticRole.startsWith("sensor.")) {
    return {
      ok: true,
      type: "sensor-expectation",
      sensorId: sensorBinding.sensorId,
      channelId: channel.id,
      measurement: channel.semanticRole,
      expectedValue: finiteValue(value) ?? value
    };
  }

  return { ok: false, reason: "unbound-channel", diagnostics: [] };
}
