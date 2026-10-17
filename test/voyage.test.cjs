const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, StatusTracker } = require('../src/status.cjs');
const { VoyageTracker, MAX_CONTINUOUS_MS } = require('../src/voyage.cjs');

const NOW = 100000000;

function sailor(id, state, extra = {}) {
  return {
    id, state, paused: false, failed: false, changedAt: 1, startedAt: 1,
    name: 'Agent', task: '', ...extra,
  };
}
function fleet(kind, agents, extra = {}) {
  const hasError = agents.some(row => row.failed);
  return { kind, label: kind, needsInput: false, agents, hasError, glowUntil: 0, ...extra };
}
function item(id, state) {
  return { id, runId: 'run-1', state, title: `Title ${id}` };
}
function progress(items, known = true) {
  return { known, items, runIds: ['run-1'] };
}
function orca(rows, workspaceExtra = {}) {
  return { ok: true, result: {
    worktrees: [{ worktreeId: 'repo::task', hostId: 'local', status: 'active', agents: rows, ...workspaceExtra }],
    hostScope: { hostIds: ['local'], omittedHostIds: [] }, totalCount: 1, truncated: false,
  } };
}
function raw(state, extra = {}) {
  return { paneKey: 'boat', state, updatedAt: NOW, stateStartedAt: NOW - 1000, ...extra };
}

test('crew rows follow the working agents and keep sanitized names', () => {
  const tracker = new VoyageTracker();
  const snap = tracker.update(fleet('working', [
    sailor('a', 'working', { name: 'Ada', task: 'Hull' }),
    sailor('b', 'working', { name: 'Bea', task: 'Sail' }),
    sailor('c', 'working', { name: 'Cy', task: 'Rig' }),
    sailor('d', 'waiting', { name: 'Dee' }),
    sailor('e', 'blocked', { name: 'Eve' }),
    sailor('f', 'done', { name: 'Fay' }),
  ]), 1000);
  assert.equal(snap.crewCount, 3);
  assert.deepEqual(snap.crew.map(row => row.name), ['Ada', 'Bea', 'Cy']);
  assert.deepEqual(snap.crew.map(row => row.task), ['Hull', 'Sail', 'Rig']);
  assert.equal(snap.totalCount, null);
  assert.equal(snap.remainingCount, null);
  assert.equal(snap.completedCount, 0);
  assert.equal(snap.completionSerial, 0);
  assert.equal(snap.completionAt, 0);
  assert.equal(snap.hasError, false);
});

test('aggregate output feeds live crew without prompt or tool text', () => {
  const tracker = new VoyageTracker();
  const working = aggregate(orca([
    raw('working', { displayName: 'Ada', taskTitle: 'Hull', prompt: 'SECRET', tool: 'bash' }),
    raw('waiting', { paneKey: 'second', agentType: 'grok', taskTitle: '' }),
  ]), NOW);
  const snap = tracker.update(working, NOW);
  assert.equal(snap.kind, 'working');
  assert.equal(snap.crewCount, 1);
  assert.equal(snap.crew[0].id, JSON.stringify(['local', 'repo::task', 'boat']));
  assert.equal(snap.crew[0].name, 'Ada');
  assert.equal(snap.crew[0].task, 'Hull');
  assert.equal(snap.crew[0].startedAt, NOW - 1000);
  assert.equal(JSON.stringify(snap.crew).includes('SECRET'), false);
  assert.equal(JSON.stringify(snap.agents).includes('bash'), false);
});

test('observed turns count once across polls, agents, and repeats', () => {
  const tracker = new VoyageTracker();
  const working = fleet('working', [
    sailor('a', 'working', { startedAt: 10 }),
    sailor('b', 'working', { startedAt: 11 }),
  ]);
  tracker.update(working, 1000);
  let snap = tracker.update(fleet('working', [
    sailor('a', 'done', { startedAt: 20 }),
    sailor('b', 'working', { startedAt: 11 }),
  ]), 2000);
  assert.equal(snap.completedCount, 1);
  assert.equal(snap.totalCount, null);
  assert.equal(snap.remainingCount, null);
  assert.equal(snap.completionSerial, 1);
  assert.equal(snap.completionAt, 2000);
  assert.equal(snap.crewCount, 1);
  snap = tracker.update(fleet('idle', [
    sailor('a', 'done', { startedAt: 20 }),
    sailor('b', 'done', { startedAt: 30 }),
  ]), 3000);
  assert.equal(snap.completedCount, 2);
  assert.equal(snap.completionSerial, 2);
  assert.equal(snap.completionAt, 3000);
  snap = tracker.update(fleet('idle', [
    sailor('a', 'done', { startedAt: 20 }),
    sailor('b', 'done', { startedAt: 30 }),
  ]), 4000);
  assert.equal(snap.completedCount, 2);
  assert.equal(snap.completionSerial, 2);
  assert.equal(snap.completionAt, 3000);
  tracker.update(fleet('working', [sailor('a', 'working', { startedAt: 40 })]), 5000);
  snap = tracker.update(fleet('idle', [sailor('a', 'done', { startedAt: 50 })]), 6000);
  assert.equal(snap.completedCount, 3);
  assert.equal(snap.completionSerial, 3);
});

test('waiting between work and done still counts one turn', () => {
  const tracker = new VoyageTracker();
  tracker.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })]), 1000);
  tracker.update(fleet('waiting', [sailor('a', 'waiting', { startedAt: 15 })]), 2000);
  const snap = tracker.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 3000);
  assert.equal(snap.completedCount, 1);
  assert.equal(snap.completionSerial, 1);
  const again = tracker.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 4000);
  assert.equal(again.completedCount, 1);
});

test('failed and cancelled turns are not completions', () => {
  const failed = new VoyageTracker();
  failed.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })]), 1000);
  const failure = failed.update(fleet('idle', [
    sailor('a', 'done', { startedAt: 20, failed: true }),
  ]), 2000);
  assert.equal(failure.completedCount, 0);
  assert.equal(failure.completionSerial, 0);
  assert.equal(failure.completionAt, 0);
  assert.equal(failure.hasError, true);
  assert.notEqual(failure.kind, 'finished');

  const cancelled = new VoyageTracker();
  cancelled.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })]), 1000);
  const pause = cancelled.update(fleet('paused', [
    sailor('a', 'done', { startedAt: 20, paused: true }),
  ]), 2000);
  assert.equal(pause.completedCount, 0);
  assert.equal(pause.completionSerial, 0);
  assert.equal(pause.hasError, false);

  const integrated = new VoyageTracker();
  const status = new StatusTracker();
  integrated.update(status.update(aggregate(orca([raw('working')]), NOW), NOW), NOW);
  const reported = integrated.update(status.update(aggregate(orca([
    raw('done', { mainAgent: { state: 'done', outcome: 'failure' } }),
  ]), NOW + 1), NOW + 1), NOW + 1);
  assert.equal(reported.hasError, true);
  assert.equal(reported.completedCount, 0);
  assert.notEqual(reported.kind, 'finished');
});

test('known task inventory counts each id once and leaves failed or cancelled work out', () => {
  const tracker = new VoyageTracker();
  const open = [
    item('done-1', 'pending'), item('done-2', 'working'),
    item('bad', 'failed'), item('skip', 'cancelled'), item('left', 'pending'),
  ];
  let snap = tracker.update(fleet('working', [], { taskProgress: progress(open) }), 1000);
  assert.equal(snap.completedCount, 0);
  assert.equal(snap.totalCount, 5);
  assert.equal(snap.remainingCount, 3);
  assert.equal(snap.completionSerial, 0);
  assert.equal(snap.completionAt, 0);
  assert.equal(snap.hasError, true);

  const doneTwice = [
    item('done-1', 'completed'), item('done-1', 'completed'),
    item('done-2', 'completed'), item('bad', 'failed'), item('skip', 'cancelled'), item('left', 'pending'),
  ];
  snap = tracker.update(fleet('working', [], { taskProgress: progress(doneTwice) }), 2000);
  assert.equal(snap.completedCount, 2);
  assert.equal(snap.totalCount, 5);
  assert.equal(snap.remainingCount, 1);
  assert.equal(snap.completionSerial, 2);
  assert.equal(snap.completionAt, 2000);
  snap = tracker.update(fleet('working', [], { taskProgress: progress(doneTwice) }), 3000);
  assert.equal(snap.completedCount, 2);
  assert.equal(snap.completionSerial, 2);
  assert.equal(snap.completionAt, 2000);
});

test('a real task list supplies the total and an unknown list does not invent one', () => {
  const tracker = new VoyageTracker();
  const items = [
    ...[1, 2, 3, 4, 5, 6, 7].map(n => item(`c${n}`, 'completed')),
    item('p', 'pending'), item('w', 'working'), item('f', 'failed'),
  ];
  const seeded = tracker.update(fleet('working', [], { taskProgress: progress(items) }), 1000);
  assert.equal(seeded.completedCount, 7);
  assert.equal(seeded.totalCount, 10);
  assert.equal(seeded.remainingCount, 2);
  assert.equal(seeded.hasError, true);
  assert.equal(seeded.completionSerial, 0);

  const unknown = new VoyageTracker();
  for (const taskProgress of [
    undefined,
    { known: false, items, runIds: ['run-1'] },
    { known: true, items: [{ id: 'x', runId: 'run-1', state: 'mystery', title: 'Nope' }], runIds: [] },
    { known: true, items: [item('x', 'completed'), { id: 'x', runId: 'run-1', state: 'failed', title: 'X' }] },
  ]) {
    const snap = unknown.update(fleet('idle', [], taskProgress ? { taskProgress } : {}), 1000);
    assert.equal(snap.totalCount, null);
    assert.equal(snap.remainingCount, null);
    assert.equal(snap.completedCount, 0);
    assert.equal(snap.completionSerial, 0);
  }
  const empty = unknown.update(fleet('idle', [], { taskProgress: progress([]) }), 2000);
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.completedCount, 0);
  assert.equal(empty.remainingCount, 0);
});

test('switching from observed turns to a task list does not double count', () => {
  const tracker = new VoyageTracker();
  tracker.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })]), 1000);
  const turn = tracker.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 2000);
  assert.equal(turn.completedCount, 1);
  assert.equal(turn.totalCount, null);
  assert.equal(turn.completionSerial, 1);
  const tasks = tracker.update(fleet('working', [sailor('a', 'done', { startedAt: 20 })], {
    taskProgress: progress([item('hull', 'completed'), item('sail', 'completed'), item('rig', 'pending')]),
  }), 3000);
  assert.equal(tasks.completedCount, 2);
  assert.equal(tasks.totalCount, 3);
  assert.equal(tasks.remainingCount, 1);
  assert.equal(tasks.completionSerial, 1);
  const back = tracker.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 4000);
  assert.equal(back.completedCount, 1);
  assert.equal(back.totalCount, null);
  assert.equal(back.completionSerial, 1);
});

test('reconnect does not award a second completion or invent one across the gap', () => {
  const tasks = new VoyageTracker();
  tasks.update(fleet('working', [], { taskProgress: progress([item('hull', 'pending')]) }), 1000);
  const done = tasks.update(fleet('working', [], { taskProgress: progress([item('hull', 'completed')]) }), 2000);
  assert.equal(done.completedCount, 1);
  assert.equal(done.completionSerial, 1);
  const dropped = tasks.update({ kind: 'disconnected', label: 'Disconnected', agents: [] }, 3000);
  assert.equal(dropped.completedCount, 0);
  assert.equal(dropped.totalCount, null);
  const again = tasks.update(fleet('working', [], { taskProgress: progress([item('hull', 'completed')]) }), 4000);
  assert.equal(again.completedCount, 1);
  assert.equal(again.completionSerial, 1);
  assert.equal(again.completionAt, 2000);

  const turns = new VoyageTracker();
  turns.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })]), 1000);
  assert.equal(turns.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 2000).completedCount, 1);
  turns.update({ kind: 'disconnected', label: 'Disconnected', agents: [] }, 3000);
  assert.equal(turns.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 4000).completedCount, 1);

  const missed = new VoyageTracker();
  missed.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })]), 1000);
  missed.update({ kind: 'unavailable', label: 'Status unavailable', agents: [], hasError: false }, 2000);
  const late = missed.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 3000);
  assert.equal(late.completedCount, 0);
  assert.equal(late.completionSerial, 0);
  assert.equal(late.hasError, false);
});

test('restart serialization keeps counters and does not replay or double count', () => {
  const tracker = new VoyageTracker();
  tracker.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })], {
    taskProgress: progress([item('hull', 'pending'), item('sail', 'pending')]),
  }), 1000);
  tracker.update(fleet('working', [sailor('a', 'working', { startedAt: 10 })], {
    taskProgress: progress([item('hull', 'completed'), item('sail', 'pending')]),
  }), 3000);
  const saved = tracker.serialize();
  assert.equal(saved.sailingMs, 2000);
  assert.deepEqual(saved.completedTaskIds, ['hull']);
  assert.equal(saved.completionSerial, 1);
  assert.equal(saved.completionAt, 3000);
  assert.equal(saved.taskBaselineEstablished, true);
  assert.equal(Object.hasOwn(saved, 'lastNow'), false);
  assert.equal(Object.hasOwn(saved, 'openTurns'), false);
  const restored = new VoyageTracker(JSON.parse(JSON.stringify(saved)));
  const same = restored.update(fleet('idle', [], {
    taskProgress: progress([item('hull', 'completed'), item('sail', 'pending')]),
  }), 9000000);
  assert.equal(same.completedCount, 1);
  assert.equal(same.totalCount, 2);
  assert.equal(same.remainingCount, 1);
  assert.equal(same.completionSerial, 1);
  assert.equal(same.completionAt, 3000);
  assert.equal(same.sailingMs, 2000);
  const added = restored.update(fleet('working', [], {
    taskProgress: progress([item('hull', 'completed'), item('sail', 'completed')]),
  }), 9002000);
  assert.equal(added.completedCount, 2);
  assert.equal(added.completionSerial, 2);
  assert.equal(added.completionAt, 9002000);
  assert.equal(added.sailingMs, 2000);
});

test('sailing time counts only continuous working intervals', () => {
  const tracker = new VoyageTracker();
  const working = () => fleet('working', [sailor('a', 'working', { startedAt: 10 })]);
  let snap = tracker.update(working(), 1000);
  assert.equal(snap.sailingMs, 0);
  snap = tracker.update(working(), 3000);
  assert.equal(snap.sailingMs, 2000);
  snap = tracker.update(fleet('waiting', [sailor('a', 'waiting', { startedAt: 15 })]), 5000);
  assert.equal(snap.sailingMs, 2000);
  snap = tracker.update(working(), 7000);
  assert.equal(snap.sailingMs, 2000);
  snap = tracker.update(working(), 9000);
  assert.equal(snap.sailingMs, 4000);
  snap = tracker.update({ kind: 'disconnected', label: 'Disconnected', agents: [] }, 11000);
  assert.equal(snap.sailingMs, 4000);
  snap = tracker.update(working(), 13000);
  assert.equal(snap.sailingMs, 4000);
  snap = tracker.update(working(), 15000);
  assert.equal(snap.sailingMs, 6000);
  snap = tracker.update(working(), 15000 + 10 * 60 * 1000);
  assert.equal(snap.sailingMs, 6000);
  snap = tracker.update(fleet('idle', [sailor('a', 'done', { startedAt: 20 })]), 15000 + 10 * 60 * 1000 + 2000);
  assert.equal(snap.sailingMs, 6000);
  snap = tracker.update({ kind: 'inactive', label: 'Inactive', agents: [], hasError: false }, 15000 + 10 * 60 * 1000 + 4000);
  assert.equal(snap.sailingMs, 6000);
  snap = tracker.update({ kind: 'unavailable', label: 'Status unavailable', agents: [], hasError: false }, 15000 + 10 * 60 * 1000 + 6000);
  assert.equal(snap.sailingMs, 6000);

  const edge = new VoyageTracker();
  edge.update(working(), 0);
  assert.equal(edge.update(working(), MAX_CONTINUOUS_MS).sailingMs, MAX_CONTINUOUS_MS);
  assert.equal(edge.update(working(), MAX_CONTINUOUS_MS + MAX_CONTINUOUS_MS + 1).sailingMs, MAX_CONTINUOUS_MS);

  const summary = new VoyageTracker();
  summary.update(fleet('working', []), 0);
  assert.equal(summary.update(fleet('working', []), 2000).sailingMs, 2000);
  assert.equal(summary.update(fleet('working', []), 2000).crewCount, 0);
});

test('restored sailing time ignores downtime and corrupt persisted state', () => {
  const tracker = new VoyageTracker();
  tracker.update(fleet('working', []), 1000);
  tracker.update(fleet('working', []), 4000);
  const saved = JSON.parse(JSON.stringify(tracker.serialize()));
  assert.equal(saved.sailingMs, 3000);
  const restored = new VoyageTracker(saved);
  assert.equal(restored.update(fleet('working', []), 900000).sailingMs, 3000);
  assert.equal(restored.update(fleet('working', []), 902000).sailingMs, 5000);

  const broken = new VoyageTracker({
    sailingMs: Number.NaN,
    completedTaskIds: [12, 'keep', ''],
    observedTurnIds: null,
    completionSerial: 1.5,
    completionAt: -4,
    taskBaselineEstablished: 'yes',
    lastNow: 1,
  });
  const snap = broken.update(fleet('idle', []), 100);
  assert.equal(snap.sailingMs, 0);
  assert.equal(snap.completionSerial, 0);
  assert.equal(snap.completionAt, 0);
  assert.equal(snap.completedCount, 0);
  assert.deepEqual(broken.serialize().completedTaskIds, ['keep']);
  assert.equal(broken.serialize().taskBaselineEstablished, false);
});

test('success glow still fires once and a task failure cannot look finished', () => {
  const status = new StatusTracker();
  const voyage = new VoyageTracker();
  const working = aggregate(orca([raw('working', { displayName: 'Ada' })]), NOW);
  voyage.update(status.update(working, NOW), NOW);
  const done = aggregate(orca([raw('done', { displayName: 'Ada', stateStartedAt: NOW })]), NOW + 1);
  const finished = voyage.update(status.update(done, NOW + 1), NOW + 1);
  assert.equal(finished.kind, 'finished');
  assert.equal(finished.label, 'Finished');
  assert.equal(finished.completedCount, 1);
  assert.equal(finished.glowUntil, NOW + 3001);

  const storm = new VoyageTracker();
  const flagged = storm.update({
    kind: 'finished', label: 'Finished', glowUntil: 999, hasError: false, agents: [],
    taskProgress: progress([item('hull', 'failed')]),
  }, 5000);
  assert.equal(flagged.hasError, true);
  assert.equal(flagged.kind, 'idle');
  assert.equal(flagged.glowUntil, 0);
  assert.equal(flagged.completedCount, 0);
  assert.equal(flagged.totalCount, 1);
});
