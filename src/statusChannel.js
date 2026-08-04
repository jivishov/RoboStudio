// Shared page status surface.
//
// Every RoboStudio page had its own `showStatus`. The five copies had drifted
// into three shapes: write-and-hide (Assembly Studio, Component Builder),
// write-and-restore-a-summary (Circuit Lab, Electronics Studio), and
// write-and-leave (Robotics Workbench). This module keeps all three as
// configuration rather than collapsing them, because the visible behaviour of
// each page must not change.
//
// It also adds what none of the copies had: a screen-reader-only `aria-live`
// region that is independent of the visible element. Component Builder's
// `#part-status` carries `role="status"` but is toggled `hidden` between
// messages, and a hidden node is removed from the accessibility tree, so its
// announcements never reached assistive technology. Announcing through a
// separate always-rendered region fixes that, and clearing the region before
// writing makes a repeated identical message announce again. This follows the
// pattern Circuit Lab already used for `#circuit-live-region`.
//
// Pages that already own a dedicated live region pass `announce: false` so they
// do not announce the same event twice.

const SR_ONLY_STYLE = [
  "position:absolute",
  "width:1px",
  "height:1px",
  "margin:-1px",
  "padding:0",
  "overflow:hidden",
  "clip:rect(0 0 0 0)",
  "clip-path:inset(50%)",
  "white-space:nowrap",
  "border:0"
].join(";");

function createLiveRegion(id) {
  const existing = id ? document.getElementById(id) : null;
  if (existing) return existing;
  const region = document.createElement("div");
  if (id) region.id = id;
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("style", SR_ONLY_STYLE);
  document.body.append(region);
  return region;
}

/**
 * @param {object} options
 * @param {Element|null} options.element visible status surface
 * @param {number} [options.defaultTimeoutMs] 0 means the message is never cleared
 * @param {boolean} [options.reveal] unhide the visible element while a message shows
 * @param {() => void} [options.onIdle] runs when the timeout elapses; defaults to re-hiding
 * @param {boolean} [options.announce] mirror messages into a screen-reader-only region
 * @param {Element|null} [options.liveRegion] reuse an existing live region instead of creating one
 * @param {string} [options.liveRegionId] id for the created region
 * @param {boolean} [options.cancelPendingOnPersistentMessage] whether a message shown with
 *   `timeoutMs` of 0 also cancels an already-scheduled idle restore. Circuit Lab and
 *   Electronics Studio returned before clearing, so a pending restore still fired over a
 *   persistent message; they pass `false` to keep that behaviour.
 */
export function createStatusChannel(options = {}) {
  const element = options.element ?? null;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 0;
  const reveal = options.reveal === true;
  const announce = options.announce !== false;
  const cancelPendingOnPersistentMessage = options.cancelPendingOnPersistentMessage !== false;
  const onIdle = typeof options.onIdle === "function"
    ? options.onIdle
    : () => {
      if (reveal && element) element.hidden = true;
    };

  let timer = null;
  let liveRegion = options.liveRegion ?? null;

  function resolveLiveRegion() {
    if (!announce) return null;
    if (!liveRegion) liveRegion = createLiveRegion(options.liveRegionId);
    return liveRegion;
  }

  function announceMessage(message) {
    const region = resolveLiveRegion();
    if (!region || !message) return;
    // Clearing first makes an identical repeated message announce again.
    region.textContent = "";
    window.requestAnimationFrame(() => {
      region.textContent = String(message);
    });
  }

  function show(message, timeoutMs = defaultTimeoutMs) {
    if (element) {
      element.textContent = message;
      if (reveal) element.hidden = false;
    }
    announceMessage(message);
    if (!timeoutMs) {
      if (cancelPendingOnPersistentMessage) window.clearTimeout(timer);
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      onIdle();
    }, timeoutMs);
  }

  return {
    element,
    show,
    announce: announceMessage,
    get liveRegion() {
      return liveRegion;
    }
  };
}
