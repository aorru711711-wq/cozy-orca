const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OrcaPoller } = require('../src/poller.cjs');

const settle = async () => {
  for (let step = 0; step < 8; step++) await new Promise(resolve => setImmediate(resolve));
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function queueExec() {
  const calls = [];
  const waiting = [];
  const execute = (exe, args, opts, cb) => {
    const entry = { exe, args, opts, cb, killed: false };
    calls.push(entry);
    waiting.push(entry);
    return { kill() { entry.killed = true; } };
  };
  return {
    calls, execute,
    reply(error, stdout) {
      const entry = waiting.shift();
      if (!entry) throw new Error('no command is waiting');
      entry.cb(error, stdout);
    }
  };
}

function fleet() {
  const now = Date.now();
  return JSON.stringify({ ok: true, result: {
    worktrees: [{
      worktreeId: 'repo::task', hostId: 'local', status: 'working',
      agents: [{ paneKey: 'boat', state: 'working', updatedAt: now, stateStartedAt: now - 1000,
        displayName: 'Sailor', taskTitle: 'Mend the sail' }]
    }],
    hostScope: { hostIds: ['local'], omittedHostIds: [] }, totalCount: 1, truncated: false
  } });
}
function runList() {
  return JSON.stringify({ ok: true, result: { runs: [{ id: 'run_open', legacy: 0 }], nextCursor: null } });
}
function taskList() {
  return JSON.stringify({ ok: true, result: {
    runId: 'run_open', legacyReadOnly: false, count: 1,
    tasks: [{ id: 'task_live', run_id: 'run_open', status: 'dispatched', task_title: 'Mend the sail',
      spec: 'DO NOT PUBLISH SPEC', result: 'DO NOT PUBLISH RESULT' }]
  } });
}

test('requests are serialized, bounded, hidden, and stopped without retries', async () => {
  let calls = 0, callback, options, args, killed = false;
  const statuses = [];
  const poller = new OrcaPoller({ executable: 'E:/orca.exe', interval: 5, onStatus: state => statuses.push(state),
    execute(_exe, argv, opts, cb) { calls++; callback = cb; options = opts; args = argv; return { kill() { killed = true; } }; } });
  poller.start(); poller.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.deepEqual(args, ['worktree', 'ps', '--json']);
  assert.equal(options.timeout, 5000); assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
  callback(null, 'invalid json');
  assert.equal(statuses[0].kind, 'unavailable');
  assert.equal(statuses[0].taskProgress.known, false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  poller.stop();
  assert.equal(killed, true);
  callback(null, '{}');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  assert.equal(statuses.length, 1);
});
test('missing Orca is disconnected; timeout is unavailable', () => {
  for (const [error, kind] of [[{ code: 'ENOENT' }, 'disconnected'], [{ killed: true }, 'unavailable']]) {
    let callback, received;
    const poller = new OrcaPoller({ executable: 'E:/missing.exe', onStatus: state => { received = state; },
      execute(_exe, _args, _options, cb) { callback = cb; return { kill() {} }; } });
    poller.start(); callback(error, ''); poller.stop();
    assert.equal(received.kind, kind);
  }
});
test('task-source failure keeps a valid working fleet and publishes an unknown total', async () => {
  const io = queueExec();
  const statuses = [];
  const poller = new OrcaPoller({ executable: 'E:/orca.exe', interval: 1000, taskInterval: 10000,
    onStatus: state => statuses.push(state), execute: io.execute });
  poller.start();
  assert.equal(io.calls.length, 1);
  io.reply(null, fleet());
  assert.equal(statuses[0].kind, 'working');
  assert.equal(statuses[0].agents.length, 1);
  assert.equal(statuses[0].taskProgress.known, false);
  assert.deepEqual(io.calls[1].args, ['orchestration', 'run-list', '--json']);
  assert.equal(io.calls[1].opts.timeout, 5000);
  assert.equal(io.calls[1].opts.windowsHide, true);
  assert.equal(io.calls[1].opts.shell, false);
  io.reply(Object.assign(new Error('timed out'), { killed: true }), '');
  await settle();
  assert.equal(statuses.at(-1).kind, 'working');
  assert.equal(statuses.at(-1).label, 'Working');
  assert.equal(statuses.at(-1).agents.length, 1);
  assert.deepEqual(statuses.at(-1).taskProgress, { known: false, items: [], runIds: [] });
  poller.stop();
});
test('task progress attaches after a serial inventory and refreshes on a 10 second cadence', async () => {
  let clock = 1000;
  const io = queueExec();
  const statuses = [];
  const poller = new OrcaPoller({
    executable: 'E:/Applications/Orca/resources/bin/orca.exe', interval: 20, taskInterval: 10000,
    now: () => clock, onStatus: state => statuses.push(state), execute: io.execute
  });
  poller.start();
  io.reply(null, fleet());
  await settle();
  io.reply(null, runList());
  await settle();
  io.reply(null, taskList());
  await settle();
  const ready = statuses.at(-1);
  assert.equal(ready.kind, 'working');
  assert.equal(ready.taskProgress.known, true);
  assert.deepEqual(ready.taskProgress.runIds, ['run_open']);
  assert.deepEqual(ready.taskProgress.items, [
    { id: 'task_live', runId: 'run_open', state: 'working', title: 'Mend the sail' }
  ]);
  assert.equal(JSON.stringify(ready.taskProgress).includes('DO NOT PUBLISH'), false);
  await wait(40);
  assert.deepEqual(io.calls.at(-1).args, ['worktree', 'ps', '--json']);
  const beforeIdleFleet = io.calls.length;
  io.reply(null, fleet());
  await settle();
  assert.equal(io.calls.length, beforeIdleFleet);
  await wait(40);
  assert.deepEqual(io.calls.at(-1).args, ['worktree', 'ps', '--json']);
  clock = 12000;
  io.reply(null, fleet());
  await settle();
  assert.deepEqual(io.calls.at(-1).args, ['orchestration', 'run-list', '--json']);
  assert.equal(io.calls.at(-1).exe, 'E:/Applications/Orca/resources/bin/orca.exe');
  poller.stop();
  const callsAtStop = io.calls.length;
  io.reply(null, runList());
  await wait(30);
  assert.equal(io.calls.length, callsAtStop);
});
