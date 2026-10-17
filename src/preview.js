/* global CozyScene */
function sailingLabel(status, crewCount, sailingMs, completed, total) {
  const minutes = Math.floor(Math.max(0, sailingMs) / 60000);
  const hours = Math.floor(minutes / 60);
  const duration = hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  const parts = [status, `${crewCount} crew`, duration];
  const done = Number.isFinite(completed) && completed >= 0 ? Math.floor(completed) : 0;
  if (Number.isInteger(total) && total > 0) parts.push(`✓${done}/${total}`);
  else parts.push(`✓${done}`);
  return parts.join(' · ');
}
function pillWord(state) {
  if (state.kind === 'disconnected') return 'Disconnected';
  if (state.kind === 'unavailable') return 'Unavailable';
  if (state.hasError) return 'Failed';
  if (state.kind === 'working') return 'Working';
  if (state.kind === 'waiting') return 'Waiting';
  if (state.kind === 'paused') return 'Paused';
  if (state.kind === 'finished') return 'Finished';
  if (state.kind === 'idle') return 'Idle';
  return 'Connecting';
}
function sailors(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sailor-${index + 1}`, name: `Sailor ${index + 1}`, task: '', state: 'working', startedAt: 0, failed: false
  }));
}
function voyage(fixture) {
  const crewCount = fixture.crewCount || 0;
  return {
    needsInput: false, crew: sailors(crewCount), sailingMs: 0, completedCount: null, totalCount: null,
    remainingCount: null, completionSerial: 0, completionAt: 0, hasError: false, reason: fixture.caption, ...fixture
  };
}
const states = [
  voyage({ fixture: 'crew-1', caption: '1 crew', kind: 'working', crewCount: 1, sailingMs: 360000,
    completedCount: 1, totalCount: 4, remainingCount: 3 }),
  voyage({ fixture: 'crew-3', caption: '3 crew', kind: 'working', crewCount: 3, sailingMs: 5040000,
    completedCount: 7, totalCount: 10, remainingCount: 3 }),
  voyage({ fixture: 'crew-8', caption: '8 crew', kind: 'working', crewCount: 8, sailingMs: 7500000,
    completedCount: 12, totalCount: 20, remainingCount: 8 }),
  voyage({ fixture: 'completion', caption: 'Completion while others work', kind: 'working', crewCount: 3,
    sailingMs: 5040000, completedCount: 8, totalCount: 10, remainingCount: 2, completionSerial: 8, completionAt: Date.now() }),
  voyage({ fixture: 'storm', caption: 'Error storm', kind: 'working', crewCount: 2, sailingMs: 1080000,
    completedCount: 3, totalCount: 8, remainingCount: 5, hasError: true, reason: 'An agent reported a failure.' }),
  voyage({ fixture: 'attention', caption: 'Needs input while sailing', kind: 'working', needsInput: true, crewCount: 2,
    sailingMs: 540000, completedCount: 5, totalCount: 11, remainingCount: 6, reason: 'Work continues, and Orca needs input.' }),
  voyage({ fixture: 'waiting', caption: 'Waiting flare', kind: 'waiting', needsInput: true, crewCount: 0, sailingMs: 2760000,
    completedCount: 4, totalCount: 9, remainingCount: 5, reason: 'Orca is waiting for input.' }),
  voyage({ fixture: 'unknown', caption: 'Unknown total', kind: 'working', crewCount: 1, sailingMs: 720000,
    completedCount: 7, totalCount: null, remainingCount: null, reason: 'Observed turns. The full task total is unknown.' }),
  voyage({ fixture: 'paused', caption: 'Paused', kind: 'paused', crewCount: 0, sailingMs: 5040000,
    completedCount: 7, totalCount: 10, remainingCount: 3 }),
  voyage({ fixture: 'idle', caption: 'Idle', kind: 'idle', crewCount: 0, sailingMs: 5040000,
    completedCount: 10, totalCount: 10, remainingCount: 0 }),
  voyage({ fixture: 'finished', caption: 'Finished', kind: 'finished', crewCount: 0, sailingMs: 5400000,
    completedCount: 10, totalCount: 10, remainingCount: 0, completionSerial: 10, completionAt: Date.now() }),
  voyage({ fixture: 'disconnected', caption: 'Disconnected', kind: 'disconnected',
    reason: 'Orca is not connected. Retrying automatically.' }),
  voyage({ fixture: 'unavailable', caption: 'Status unavailable', kind: 'unavailable',
    reason: 'Orca status request failed. Retrying automatically.' })
];
for (const state of states) {
  state.label = sailingLabel(pillWord(state), state.crewCount || 0, state.sailingMs || 0, state.completedCount, state.totalCount);
}
if (states.find(state => state.fixture === 'crew-3').label !== 'Working · 3 crew · 1h 24m · ✓7/10') {
  throw new Error('Exact voyage pill drifted');
}
if (states.find(state => state.fixture === 'unknown').label !== 'Working · 1 crew · 12m · ✓7') {
  throw new Error('Unknown total must stay a bare observed count');
}
for (const state of states) {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption'); caption.textContent = state.caption;
  const scene = document.createElement('div'); scene.className = 'scene';
  const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 72;
  CozyScene.draw(canvas.getContext('2d'), state, 1.5);
  const label = document.createElement('span');
  label.className = 'label'; label.textContent = state.label; label.title = state.reason || state.label;
  scene.append(canvas, label); figure.append(caption, scene); document.getElementById('states').append(figure);
}
