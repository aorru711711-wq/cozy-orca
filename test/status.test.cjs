const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, StatusTracker } = require('../src/status.cjs');
const NOW = 100000000;
function agent(state, extra = {}) { return { paneKey: 'boat', state, updatedAt: NOW, stateStartedAt: NOW - 1000, ...extra }; }
function payload(rows = [], extra = {}, workspaceExtra = {}) {
  return { ok: true, result: {
    worktrees: [{ worktreeId: 'repo::task', hostId: 'local', status: 'active', agents: rows, ...workspaceExtra }],
    hostScope: { hostIds: ['local'], omittedHostIds: [] }, totalCount: 1, truncated: false, ...extra
  } };
}
const snapshot = (rows, ...args) => aggregate(payload(rows, ...args), NOW);

test('work, permission, and mixed agents remain distinguishable', () => {
  assert.equal(snapshot([agent('working')]).label, 'Working');
  assert.equal(snapshot([agent('waiting')]).label, 'Needs input');
  assert.equal(snapshot([agent('blocked')]).label, 'Needs input');
  const mixed = snapshot([agent('working'), agent('waiting', { paneKey: 'second' })]);
  assert.equal(mixed.kind, 'working');
  assert.equal(mixed.label, 'Working · needs input');
  assert.equal(mixed.needsInput, true);
  assert.equal(snapshot([agent('working', { mainAgent: { state: 'waiting' } })]).needsInput, true);
});
test('startup done is idle; explicit interruption is paused, not success', () => {
  assert.equal(snapshot([agent('done')]).kind, 'idle');
  assert.equal(snapshot([agent('done', { interrupted: true })]).kind, 'paused');
  assert.equal(snapshot([agent('done', { mainAgent: { state: 'done', outcome: 'cancellation' } })]).kind, 'paused');
});
test('complete empty listing is idle and summary-only work still sails', () => {
  assert.equal(aggregate(payload([], { worktrees: [], totalCount: 0 }), NOW).kind, 'idle');
  assert.equal(snapshot([], {}, { status: 'working' }).kind, 'working');
  assert.equal(snapshot([], {}, { status: 'permission' }).kind, 'waiting');
});
test('all covered workspaces and hosts contribute to fleet status', () => {
  const data = payload([agent('done')]);
  data.result.hostScope.hostIds.push('remote');
  data.result.worktrees.push({ worktreeId: 'remote::task', hostId: 'remote', status: 'working', agents: [agent('working')] });
  data.result.totalCount = 2;
  assert.equal(aggregate(data, NOW).kind, 'working');
});
test('incomplete listings never become idle or completion', () => {
  for (const change of [
    { truncated: true }, { totalCount: 10 }, { hostScope: undefined },
    { hostScope: { hostIds: ['local'], omittedHostIds: ['remote'] } },
    { hostScope: { hostIds: [], omittedHostIds: [] } }, { worktrees: null }
  ]) assert.equal(snapshot([], change).kind, 'unavailable');
  assert.equal(snapshot([], {}, { unverifiableTerminalCount: 1 }).kind, 'unavailable');
  assert.equal(snapshot([], {}, { terminalVerdict: 'unverifiable' }).kind, 'unavailable');
});
test('a stale agent does not hide live work on the same fleet', () => {
  const fresh = agent('working', { paneKey: 'live', updatedAt: NOW });
  const stale = agent('working', { paneKey: 'stuck', updatedAt: NOW - 1800001 });
  const mixed = snapshot([fresh, stale]);
  assert.equal(mixed.kind, 'working');
  assert.equal(mixed.agents.length, 1);
  assert.equal(mixed.agents[0].state, 'working');

  const data = payload([agent('done')]);
  data.result.worktrees.push({
    worktreeId: 'repo::improve', hostId: 'local', status: 'working',
    agents: [agent('working', { paneKey: 'codex', updatedAt: NOW - 1800001 }), fresh]
  });
  data.result.totalCount = 2;
  const fleet = aggregate(data, NOW);
  assert.equal(fleet.kind, 'working');
  assert.equal(fleet.agents.filter(row => row.state === 'working').length, 1);
});
test('unknown, malformed, stale, and unconfirmed rows are unavailable', () => {
  for (const row of [agent('mystery'), agent('working', { updatedAt: NOW - 1800001 }),
    agent('working', { restoredUnconfirmed: true }), agent('done', { subagentObservation: 'unverifiable' }),
    agent('working', { updatedAt: undefined }), null]) {
    assert.equal(snapshot([row]).kind, 'unavailable');
  }
  for (const data of [null, {}, { ok: false }, { ok: true, result: 'invalid' }]) {
    assert.equal(aggregate(data, NOW).kind, 'unavailable');
  }
  assert.equal(snapshot([agent('working', { updatedAt: 1, structuredHostOwned: true })]).kind, 'working');
});
test('completion glows once for three seconds only after observed work', () => {
  const tracker = new StatusTracker();
  const done = snapshot([agent('done')]);
  assert.equal(tracker.update(done, NOW).kind, 'idle');
  tracker.update(snapshot([agent('working')]), NOW + 1);
  const finished = tracker.update(done, NOW + 2);
  assert.equal(finished.kind, 'finished');
  assert.equal(finished.glowUntil, NOW + 3002);
  assert.equal(tracker.update(done, NOW + 2000).glowUntil, finished.glowUntil);
  assert.equal(tracker.update(done, NOW + 3003).kind, 'idle');
});
test('waiting preserves an observed turn; cancellation suppresses the glow', () => {
  const tracker = new StatusTracker();
  tracker.update(snapshot([agent('working')]), NOW);
  tracker.update(snapshot([agent('waiting')]), NOW + 1);
  assert.equal(tracker.update(snapshot([agent('done')]), NOW + 2).kind, 'finished');
  tracker.update(snapshot([agent('working')]), NOW + 3);
  assert.equal(tracker.update(snapshot([agent('done', { interrupted: true })]), NOW + 4).kind, 'paused');
});
test('missing agents, reconnects, and partial data cannot announce completion', () => {
  for (const gap of [snapshot([]), { kind: 'disconnected', label: 'Disconnected', agents: [] }, snapshot([], { truncated: true })]) {
    const tracker = new StatusTracker();
    tracker.update(snapshot([agent('working')]), NOW);
    assert.notEqual(tracker.update(gap, NOW + 1).kind, 'finished');
    assert.equal(tracker.update(snapshot([agent('done')]), NOW + 2).kind, 'idle');
  }
});
test('one agent ending cannot announce completion while another still works', () => {
  const tracker = new StatusTracker();
  tracker.update(snapshot([agent('working'), agent('working', { paneKey: 'other' })]), NOW);
  assert.equal(tracker.update(snapshot([agent('done'), agent('working', { paneKey: 'other' })]), NOW + 1).kind, 'working');
  assert.equal(tracker.update(snapshot([agent('done'), agent('done', { paneKey: 'other' })]), NOW + 2).kind, 'finished');
});
test('sanitized rows keep ids and expose only name, task title, start, and explicit failure', () => {
  const named = snapshot([agent('working', {
    displayName: 'Ada', agentType: 'grok', taskTitle: 'Hull', prompt: 'do not leak', tool: 'bash',
  })]);
  assert.equal(named.agents[0].id, JSON.stringify(['local', 'repo::task', 'boat']));
  assert.equal(named.agents[0].name, 'Ada');
  assert.equal(named.agents[0].task, 'Hull');
  assert.equal(named.agents[0].startedAt, NOW - 1000);
  assert.equal(named.agents[0].failed, false);
  assert.equal(named.hasError, false);
  assert.equal(JSON.stringify(named).includes('do not leak'), false);
  assert.equal(JSON.stringify(named).includes('bash'), false);
  assert.equal(snapshot([agent('working', { agentType: 'grok' })]).agents[0].name, 'grok');
  assert.equal(snapshot([agent('working', { displayName: '   ', agentType: 'codex' })]).agents[0].name, 'codex');
  const plain = snapshot([agent('done')]);
  assert.equal(plain.agents[0].name, 'Agent');
  assert.equal(plain.agents[0].task, '');
  assert.equal(plain.hasError, false);
  assert.equal(snapshot([agent('mystery')]).hasError, false);
  assert.equal(aggregate(null, NOW).hasError, false);
});
test('explicit failure is recorded and is not a success glow', () => {
  const failed = snapshot([agent('done', { mainAgent: { state: 'done', outcome: 'failure' } })]);
  assert.equal(failed.kind, 'idle');
  assert.equal(failed.hasError, true);
  assert.equal(failed.agents[0].failed, true);
  assert.equal(failed.agents[0].paused, false);
  const cancelled = snapshot([agent('done', { mainAgent: { state: 'done', outcome: 'cancellation' } })]);
  assert.equal(cancelled.kind, 'paused');
  assert.equal(cancelled.hasError, false);
  assert.equal(cancelled.agents[0].failed, false);
  const tracker = new StatusTracker();
  tracker.update(snapshot([agent('working')]), NOW);
  const next = tracker.update(failed, NOW + 1);
  assert.notEqual(next.kind, 'finished');
  assert.equal(next.hasError, true);
  assert.equal(next.glowUntil, 0);
});
test('one failed agent blocks the success glow while another agent finishes', () => {
  const tracker = new StatusTracker();
  tracker.update(snapshot([agent('working'), agent('working', { paneKey: 'other' })]), NOW);
  const next = tracker.update(snapshot([
    agent('done', { mainAgent: { state: 'done', outcome: 'failure' } }),
    agent('done', { paneKey: 'other' }),
  ]), NOW + 1);
  assert.equal(next.hasError, true);
  assert.equal(next.kind, 'idle');
  assert.equal(next.glowUntil, 0);
});
module.exports = { payload, agent };
