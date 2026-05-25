export function clampAssistantPosition(position, viewport, card, margin = 10) {
  const width = Math.max(0, Number(viewport?.width) || 0);
  const height = Math.max(0, Number(viewport?.height) || 0);
  const cardWidth = Math.max(0, Number(card?.width) || 0);
  const cardHeight = Math.max(0, Number(card?.height) || 0);
  const maxX = Math.max(margin, width - cardWidth - margin);
  const maxY = Math.max(margin, height - cardHeight - margin);
  return {
    x: Math.min(Math.max(margin, Number(position?.x) || margin), maxX),
    y: Math.min(Math.max(margin, Number(position?.y) || margin), maxY)
  };
}

export function isAssistantDragBlocked(target) {
  return Boolean(
    target?.closest?.(
      "button, input, select, textarea, a, [data-assistant-no-drag], .assistant-card__confirmations, .assistant-card__form"
    )
  );
}
