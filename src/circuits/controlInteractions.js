export function createControlInteractionState() {
  return {
    controlPresses: Object.create(null),
    activeMomentaryControl: null
  };
}

function controlSet(state, componentId, create = false) {
  if (!state?.controlPresses || !componentId) return null;
  let controls = state.controlPresses[componentId];
  if (!controls && create) {
    controls = new Set();
    state.controlPresses[componentId] = controls;
  }
  return controls ?? null;
}

export function isMomentaryControlActive(state, componentId, controlId) {
  return Boolean(controlSet(state, componentId)?.has(controlId));
}

export function pressMomentaryControl(state, componentId, controlId) {
  const controls = controlSet(state, componentId, true);
  if (!controls || controls.has(controlId)) return false;
  controls.add(controlId);
  state.activeMomentaryControl = { componentId, controlId };
  return true;
}

export function releaseMomentaryControl(state, componentId, controlId) {
  const controls = controlSet(state, componentId);
  if (!controls?.has(controlId)) return false;
  controls.delete(controlId);
  if (!controls.size) delete state.controlPresses[componentId];
  const active = state.activeMomentaryControl;
  if (active?.componentId === componentId && active?.controlId === controlId) {
    state.activeMomentaryControl = null;
  }
  return true;
}

export function releaseActiveMomentaryControl(state) {
  const active = state?.activeMomentaryControl;
  if (!active) return false;
  return releaseMomentaryControl(state, active.componentId, active.controlId);
}

export function releaseAllMomentaryControls(state) {
  if (!state?.controlPresses || !Object.keys(state.controlPresses).length) return false;
  state.controlPresses = Object.create(null);
  state.activeMomentaryControl = null;
  return true;
}
