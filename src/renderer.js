/* global CozyScene */
const canvas = document.getElementById('ocean');
const context = canvas.getContext('2d', { alpha: false });
const SAIL_INTERPOLATE_MS = 15000;
let display = { kind: 'unavailable', label: 'Connecting', reducedMotion: false, glowUntil: 0,
  needsInput: false, hasError: false, crewCount: 0, sailingMs: 0, completedCount: 0, totalCount: null,
  remainingCount: null, completionSerial: 0, completionAt: 0, reason: '' };
let sailingClock = { base: 0, at: 0, ticking: false };
let lastFrame = -Infinity;
const origin = performance.now();

function countOf(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
function normalizeDisplay(next) {
  const state = next && typeof next === 'object' ? next : {};
  const total = state.totalCount;
  const remaining = state.remainingCount;
  return {
    kind: typeof state.kind === 'string' ? state.kind : 'unavailable',
    label: typeof state.label === 'string' ? state.label : 'Connecting',
    reason: typeof state.reason === 'string' ? state.reason : '',
    needsInput: state.needsInput === true,
    hasError: state.hasError === true,
    glowUntil: Number.isFinite(state.glowUntil) ? state.glowUntil : 0,
    reducedMotion: state.reducedMotion === true,
    showText: state.showText !== false,
    crewCount: countOf(state.crewCount),
    sailingMs: Number.isFinite(state.sailingMs) && state.sailingMs >= 0 ? state.sailingMs : 0,
    completedCount: countOf(state.completedCount),
    totalCount: Number.isInteger(total) && total >= 0 ? total : null,
    remainingCount: Number.isInteger(remaining) && remaining >= 0 ? remaining : null,
    completionSerial: countOf(state.completionSerial),
    completionAt: Number.isFinite(state.completionAt) && state.completionAt > 0 ? state.completionAt : 0
  };
}
function statusWord(state) {
  if (state.kind === 'disconnected') return 'Disconnected';
  if (state.kind === 'unavailable') return /^connecting$/i.test(state.label || '') ? 'Connecting' : 'Unavailable';
  if (state.hasError) return 'Failed';
  if (state.kind === 'working') return 'Working';
  if (state.kind === 'waiting') return 'Waiting';
  if (state.kind === 'paused') return 'Paused';
  if (state.kind === 'finished') return 'Finished';
  if (state.kind === 'idle') return 'Idle';
  return 'Connecting';
}
function formatDuration(ms) {
  const minutesTotal = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
function formatProgress(state) {
  const done = countOf(state.completedCount);
  if (Number.isInteger(state.totalCount) && state.totalCount > 0) return `✓${done}/${state.totalCount}`;
  return `✓${done}`;
}
function pillText(state, sailingMs) {
  return `${statusWord(state)} · ${countOf(state.crewCount)} crew · ${formatDuration(sailingMs)} · ${formatProgress(state)}`;
}
function progressTooltip(state) {
  const done = countOf(state.completedCount);
  const parts = [];
  if (state.kind === 'disconnected') parts.push('Disconnected');
  else if (state.kind === 'unavailable') parts.push(/^connecting$/i.test(state.label || '') ? 'Connecting' : 'Status unavailable');
  if (state.needsInput) parts.push('Needs input');
  if (state.hasError) parts.push('Failed');
  if (Number.isInteger(state.totalCount) && state.totalCount > 0) parts.push(`${done} of ${state.totalCount} tasks`);
  else if (state.totalCount === 0) parts.push('No tasks listed');
  else parts.push(done === 1 ? '1 observed turn' : `${done} observed turns`);
  return parts.join(' · ');
}
function readSailing(now = Date.now()) {
  if (!sailingClock.ticking) return sailingClock.base;
  return sailingClock.base + Math.min(SAIL_INTERPOLATE_MS, Math.max(0, now - sailingClock.at));
}
function syncSailing(state, now = Date.now()) {
  const incoming = Number.isFinite(state.sailingMs) && state.sailingMs >= 0 ? state.sailingMs : 0;
  const ticking = state.kind === 'working';
  if (!ticking) {
    sailingClock = { base: incoming, at: now, ticking: false };
    return;
  }
  const shown = readSailing(now);
  const stalled = sailingClock.ticking && now - sailingClock.at >= SAIL_INTERPOLATE_MS;
  const base = !sailingClock.ticking || stalled ? incoming : Math.max(incoming, shown);
  sailingClock = { base, at: now, ticking: true };
}
function publish() {
  document.body.dataset.kind = display.kind;
  document.body.dataset.attention = String(Boolean(display.needsInput));
  document.body.dataset.error = String(Boolean(display.hasError));
  document.body.dataset.text = display.showText === false ? 'off' : 'on';
  const text = pillText(display, readSailing());
  const label = document.getElementById('label');
  if (label.textContent !== text) label.textContent = text;
  document.getElementById('status').title = progressTooltip(display);
}
function receive(next) {
  display = normalizeDisplay(next);
  syncSailing(display);
  document.getElementById('scene').title = display.reason || progressTooltip(display);
  publish();
  draw(performance.now());
}
function draw(timestamp) {
  if (display.kind === 'finished' && Date.now() >= display.glowUntil) {
    display = { ...display, kind: 'idle', label: 'Idle' };
  }
  if (sailingClock.ticking) display.sailingMs = readSailing();
  publish();
  CozyScene.draw(context, display, display.reducedMotion ? 0 : (timestamp - origin) / 1000);
}
function frame(timestamp) {
  if (!document.hidden && timestamp - lastFrame >= 1000 / 12) {
    draw(timestamp);
    lastFrame = timestamp;
  }
  requestAnimationFrame(frame);
}
document.getElementById('menu').addEventListener('click', () => window.cozyOrca.menu());
document.addEventListener('contextmenu', event => { event.preventDefault(); window.cozyOrca.menu(); });
window.cozyOrca.onDisplay(receive);
window.cozyOrca.ready();
requestAnimationFrame(frame);
