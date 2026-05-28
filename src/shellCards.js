const shellCardOpenState = new Map();

export function isShellCardOpen(id, defaultOpen = true) {
  if (!shellCardOpenState.has(id)) {
    shellCardOpenState.set(id, defaultOpen);
  }
  return shellCardOpenState.get(id);
}

export function setShellCardOpen(id, open) {
  shellCardOpenState.set(id, Boolean(open));
  return shellCardOpenState.get(id);
}

export function toggleShellCardState(id, defaultOpen = true) {
  return setShellCardOpen(id, !isShellCardOpen(id, defaultOpen));
}

export function resetShellCardState() {
  shellCardOpenState.clear();
}

export function applyShellCardState(card, open) {
  card.classList.toggle("is-collapsed", !open);
  const toggle = card.querySelector("[data-toggle-shell-card]");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
}

export function toggleShellCard(card) {
  const toggle = card.querySelector("[data-toggle-shell-card]");
  const id = toggle?.dataset.toggleShellCard ?? card.dataset.cardId;
  if (!id) return true;
  const nextOpen = toggleShellCardState(id);
  applyShellCardState(card, nextOpen);
  return nextOpen;
}

export function mountShellCardToggles(root = document) {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest("[data-toggle-shell-card]");
    if (!toggle || !root.contains(toggle)) return;
    const card = toggle.closest(".collapsible-card");
    if (!card) return;
    toggleShellCard(card);
  });
}
