const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TaskSource, canonicalTaskState, parseTaskList, buildInventory } = require('../src/tasks.cjs');

const settle = async () => {
  for (let step = 0; step < 8; step++) await new Promise(resolve => setImmediate(resolve));
};

function scripted() {
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

function runList(runs, nextCursor = null) {
  return JSON.stringify({ ok: true, result: { runs, nextCursor } });
}
function taskRow(id, runId, status, title, extra = {}) {
  return {
    id, run_id: runId, status, task_title: title, display_name: title,
    spec: 'DO NOT PUBLISH SPEC', prompt: 'DO NOT PUBLISH PROMPT', ...extra
  };
}
function taskList(runId, rows, extra = {}) {
  return JSON.stringify({
    ok: true,
    result: { runId, legacyReadOnly: false, tasks: rows, count: rows.length, ...extra }
  });
}

test('canonical states hide specs, results, and prompts', () => {
  assert.equal(canonicalTaskState('pending'), 'pending');
  assert.equal(canonicalTaskState('ready'), 'pending');
  assert.equal(canonicalTaskState('blocked'), 'pending');
  assert.equal(canonicalTaskState('dispatched'), 'working');
  assert.equal(canonicalTaskState('completed', 'long private outcome'), 'completed');
  assert.equal(canonicalTaskState('failed', 'the agent stopped'), 'failed');
  assert.equal(canonicalTaskState('failed', ' cancelled '), 'cancelled');
  assert.equal(canonicalTaskState('completed', 'cancelled'), 'completed');
  assert.equal(canonicalTaskState('mystery'), null);
  const parsed = parseTaskList(JSON.parse(taskList('run_open', [
    taskRow('task_one', 'run_open', 'dispatched', 'Mend the sail', { result: { secret: 'outcome' } }),
    taskRow('task_two', 'run_open', 'failed', 'Hold the anchor', { result: 'cancelled' })
  ])), 'run_open');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.tasks, [
    { id: 'task_one', runId: 'run_open', state: 'working', title: 'Mend the sail' },
    { id: 'task_two', runId: 'run_open', state: 'cancelled', title: 'Hold the anchor' }
  ]);
  assert.equal(JSON.stringify(parsed.tasks).includes('DO NOT PUBLISH'), false);
  assert.equal(JSON.stringify(parsed.tasks).includes('outcome'), false);
});

test('duplicate ids collapse only when they agree', () => {
  const same = parseTaskList(JSON.parse(taskList('run_open', [
    taskRow('task_one', 'run_open', 'ready', 'Mend the sail'),
    taskRow('task_one', 'run_open', 'ready', 'Mend the sail')
  ])), 'run_open');
  assert.equal(same.tasks.length, 1);
  const conflict = parseTaskList(JSON.parse(taskList('run_open', [
    taskRow('task_one', 'run_open', 'ready', 'Mend the sail'),
    taskRow('task_one', 'run_open', 'dispatched', 'Mend the sail')
  ])), 'run_open');
  assert.equal(conflict.ok, false);
  const across = buildInventory({
    runs: [{ id: 'run_a', legacy: false }, { id: 'run_b', legacy: false }],
    listings: {
      run_a: { ok: true, tasks: [{ id: 'task_same', runId: 'run_a', state: 'working', title: 'One' }] },
      run_b: { ok: true, tasks: [{ id: 'task_same', runId: 'run_b', state: 'working', title: 'One' }] }
    },
    tracked: ['run_a', 'run_b']
  });
  assert.equal(across.ok, false);
});

test('partial, unknown, and mismatched listings are rejected', () => {
  assert.equal(parseTaskList(JSON.parse(taskList('run_open', [
    taskRow('task_one', 'run_open', 'ready', 'Mend the sail')
  ], { count: 2 })), 'run_open').ok, false);
  assert.equal(parseTaskList(JSON.parse(taskList('run_open', [
    taskRow('task_one', 'run_open', 'mystery', 'Mend the sail')
  ])), 'run_open').ok, false);
  assert.equal(parseTaskList(JSON.parse(taskList('run_other', [
    taskRow('task_one', 'run_open', 'ready', 'Mend the sail')
  ])), 'run_open').ok, false);
  assert.equal(parseTaskList({ ok: false, result: {} }, 'run_open').ok, false);
  const title = 'x'.repeat(180);
  const capped = parseTaskList(JSON.parse(taskList('run_open', [
    taskRow('task_one', 'run_open', 'pending', title)
  ])), 'run_open');
  assert.equal(capped.tasks[0].title.length, 160);
});

test('session tracks unfinished runs and keeps them after they finish', async () => {
  const io = scripted();
  const source = new TaskSource({ executable: 'orca.exe', execute: io.execute });
  const first = source.collect();
  const second = source.collect();
  assert.equal(first, second);
  assert.equal(io.calls.length, 1);
  assert.deepEqual(io.calls[0].args, ['orchestration', 'run-list', '--json']);
  assert.equal(io.calls[0].exe, 'orca.exe');
  assert.equal(io.calls[0].opts.windowsHide, true);
  assert.equal(io.calls[0].opts.shell, false);
  assert.equal(io.calls[0].opts.timeout, 5000);
  assert.equal(io.calls[0].opts.maxBuffer, 16 * 1024 * 1024);
  io.reply(null, runList([
    { id: 'run_legacy_local', legacy: 1 },
    { id: 'run_open', legacy: 0 },
    { id: 'run_done', legacy: 0 }
  ]));
  await settle();
  assert.deepEqual(io.calls[1].args, ['orchestration', 'task-list', '--run', 'run_open', '--json']);
  io.reply(null, taskList('run_open', [
    taskRow('task_live', 'run_open', 'dispatched', 'Mend the sail'),
    taskRow('task_old', 'run_open', 'completed', 'Coil the rope', { result: 'private result' })
  ]));
  await settle();
  assert.deepEqual(io.calls[2].args, ['orchestration', 'task-list', '--run', 'run_done', '--json']);
  io.reply(null, taskList('run_done', [taskRow('task_historic', 'run_done', 'completed', 'Old voyage')]));
  const progress = await first;
  assert.equal(progress.known, true);
  assert.deepEqual(progress.runIds, ['run_open']);
  assert.deepEqual(progress.items.map(item => item.id), ['task_live', 'task_old']);
  assert.equal(JSON.stringify(progress).includes('private result'), false);
  assert.equal(io.calls.some(call => call.args.includes('run_legacy_local')), false);

  const again = source.collect();
  await settle();
  io.reply(null, runList([
    { id: 'run_legacy_local', legacy: 1 },
    { id: 'run_open', legacy: 0 },
    { id: 'run_done', legacy: 0 }
  ]));
  await settle();
  io.reply(null, taskList('run_open', [
    taskRow('task_live', 'run_open', 'completed', 'Mend the sail'),
    taskRow('task_old', 'run_open', 'completed', 'Coil the rope')
  ]));
  await settle();
  io.reply(null, taskList('run_done', [taskRow('task_historic', 'run_done', 'completed', 'Old voyage')]));
  const retained = await again;
  assert.deepEqual(retained.runIds, ['run_open']);
  assert.deepEqual(retained.items.map(item => [item.id, item.state]), [
    ['task_live', 'completed'], ['task_old', 'completed']
  ]);
});

test('a failed refresh stays unknown and does not forget a tracked run', async () => {
  const io = scripted();
  const source = new TaskSource({ executable: 'orca.exe', execute: io.execute });
  const started = source.collect();
  io.reply(null, runList([{ id: 'run_open', legacy: 0 }]));
  await settle();
  io.reply(null, taskList('run_open', [taskRow('task_live', 'run_open', 'blocked', 'Wait for tide')]));
  const first = await started;
  assert.equal(first.items[0].state, 'pending');

  const failed = source.collect();
  await settle();
  io.reply(Object.assign(new Error('timed out'), { killed: true }), '');
  const unknown = await failed;
  assert.deepEqual(unknown, { known: false, items: [], runIds: [] });
  assert.equal(source.lastFailure, 'run-list failed');

  const recovered = source.collect();
  await settle();
  io.reply(null, runList([{ id: 'run_open', legacy: 0 }]));
  await settle();
  io.reply(null, taskList('run_open', [taskRow('task_live', 'run_open', 'completed', 'Wait for tide')]));
  const restored = await recovered;
  assert.deepEqual(restored.runIds, ['run_open']);
  assert.equal(restored.items[0].state, 'completed');
});

test('an unfinished sibling still publishes when a tracked run disappears', async () => {
  const io = scripted();
  const source = new TaskSource({ executable: 'orca.exe', execute: io.execute, maxRunPages: 2 });
  const started = source.collect();
  io.reply(null, runList([{ id: 'run_open', legacy: 0 }], 'next'));
  await settle();
  io.reply(null, runList([{ id: 'run_other', legacy: 0 }]));
  await settle();
  io.reply(null, taskList('run_open', [taskRow('task_live', 'run_open', 'pending', 'Mend the sail')]));
  await settle();
  io.reply(null, taskList('run_other', [taskRow('task_side', 'run_other', 'dispatched', 'Watch the buoy')]));
  const both = await started;
  assert.deepEqual(both.runIds, ['run_open', 'run_other']);
  assert.deepEqual(io.calls[1].args, ['orchestration', 'run-list', '--json', '--cursor', 'next']);

  const later = source.collect();
  await settle();
  io.reply(null, runList([{ id: 'run_other', legacy: 0 }]));
  await settle();
  io.reply(null, taskList('run_other', [taskRow('task_side', 'run_other', 'dispatched', 'Watch the buoy')]));
  const left = await later;
  assert.equal(left.known, true);
  assert.deepEqual(left.runIds, ['run_other']);
  assert.deepEqual(left.items.map(item => item.id), ['task_side']);
});

test('a repeated cursor or endless page list is not a total', async () => {
  const repeated = scripted();
  const source = new TaskSource({ executable: 'orca.exe', execute: repeated.execute });
  const pending = source.collect();
  repeated.reply(null, runList([{ id: 'run_open', legacy: 0 }], 'same'));
  await settle();
  repeated.reply(null, runList([], 'same'));
  assert.deepEqual(await pending, { known: false, items: [], runIds: [] });
  assert.equal(source.lastFailure, 'run-list cursor repeated');

  const endless = scripted();
  const capped = new TaskSource({ executable: 'orca.exe', execute: endless.execute, maxRunPages: 1 });
  const blocked = capped.collect();
  endless.reply(null, runList([{ id: 'run_open', legacy: 0 }], 'more'));
  assert.deepEqual(await blocked, { known: false, items: [], runIds: [] });
  assert.equal(capped.lastFailure, 'run-list did not end');
  assert.equal(endless.calls.length, 1);
});

test('preview and verify name the exact pill and the unknown total', () => {
  const preview = fs.readFileSync(path.join(__dirname, '../src/preview.js'), 'utf8');
  const verify = fs.readFileSync(path.join(__dirname, '../src/verify.cjs'), 'utf8');
  for (const source of [preview, verify]) {
    assert.match(source, /Working · 3 crew · 1h 24m · ✓7\/10/);
    assert.match(source, /Working · 1 crew · 12m · ✓7/);
    assert.doesNotMatch(source, /✓\d+\/0/);
    assert.equal(source.includes('DO NOT PUBLISH'), false);
  }
});
