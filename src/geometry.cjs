const dimensions = (scale) => ({ width: 144 * scale, height: 72 * scale });
function placeWindow(saved, scale, displays, primary) {
  const size = dimensions(scale);
  const candidate = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  const chosen = candidate && displays.find(({ workArea: a }) =>
    candidate.x >= a.x && candidate.y >= a.y &&
    candidate.x + size.width <= a.x + a.width && candidate.y + size.height <= a.y + a.height);
  if (chosen) return { x: Math.round(candidate.x), y: Math.round(candidate.y), ...size };
  const a = primary.workArea;
  return { x: Math.max(a.x, a.x + a.width - size.width - 16),
    y: Math.max(a.y, a.y + a.height - size.height - 16), ...size };
}
module.exports = { dimensions, placeWindow };
