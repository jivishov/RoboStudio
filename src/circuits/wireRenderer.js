export function shouldRenderExternalWire(connection) {
  return (connection?.kind ?? "wire") !== "direct-insertion";
}

export function wirePath(start, end) {
  const midX = (start[0] + end[0]) / 2;
  const lift = Math.abs(start[1] - end[1]) > 90 ? 0 : -24;
  return `M ${start[0]} ${start[1]} C ${midX} ${start[1] + lift}, ${midX} ${end[1] + lift}, ${end[0]} ${end[1]}`;
}

export function endpointFittingClass(resolvedTerminal) {
  const iface = resolvedTerminal?.terminal?.connectorInterface ?? "";
  if (iface.includes("breadboard") || iface.includes("controller")) return "wire-end--dupont";
  if (iface.includes("screw")) return "wire-end--ferrule";
  if (iface.includes("servo")) return "wire-end--servo";
  if (iface.includes("lug") || iface.includes("tab")) return "wire-end--solder";
  return "wire-end--dupont";
}
