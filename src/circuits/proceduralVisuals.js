export function fallbackVisualNotice(componentDef) {
  if (!componentDef) return "Unknown component rendered with fallback visual.";
  if (componentDef.id === "driver-l298n") {
    return "L298N is shown as a simplified six-terminal channel abstraction.";
  }
  return `${componentDef.name} uses a RoboStudio procedural fallback visual.`;
}
