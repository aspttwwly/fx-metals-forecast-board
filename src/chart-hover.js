// Coordinates are CSS pixels relative to the chart's positioned wrapper.
export function hoverCardPosition({ pointerX, pointerY, guideX, left, top, width, height, cardWidth, cardHeight }) {
  const edge = 8, gap = 20;
  const minX = left + edge, maxX = Math.max(minX, left + width - cardWidth - edge);
  const right = Math.max(pointerX, guideX) + gap;
  const leftSide = Math.min(pointerX, guideX) - cardWidth - gap;
  const x = right <= maxX ? Math.max(minX, right)
    : leftSide >= minX ? leftSide
    : Math.max(minX, Math.min(maxX, guideX - cardWidth / 2));
  let y = top + edge;
  // Very narrow screens can lack space on either side: separate vertically.
  if (pointerX >= x - edge && pointerX <= x + cardWidth + edge
      && pointerY >= y - edge && pointerY <= y + cardHeight + edge) {
    const below = pointerY + gap;
    y = below + cardHeight <= top + height - edge ? below : pointerY - cardHeight - gap;
  }
  return { left: x, top: y };
}
