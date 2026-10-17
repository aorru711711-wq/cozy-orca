const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { report, readAgents, mergeSnapshot } = require('../src/claude-status.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-')), 'status.json');

test('working then done is reported, then expires', () => {
  const file = tmp();
  report({ file, state: 'working', task: 'Write docs', now: 1000 });
  assert.equal(readAgents({ file, now: 2000 })[0].state, 'working');
  report({ file, state: 'done', now: 3000 });
  const [row] = readAgents({ file, now: 4000 });
  assert.equal(row.state, 'done');
  assert.equal(row.task, 'Write docs');
  assert.deepEqual(readAgents({ file, now: 3000 + 61000 }), []);
});

test('stale working rows are ignored and idle clears', () => {
  const file = tmp();
  report({ file, state: 'working', now: 0 });
  assert.deepEqual(readAgents({ file, now: 31 * 60 * 1000 }), []);
  report({ file, state: 'working', now: 5 });
  report({ file, state: 'idle', now: 6 });
  assert.deepEqual(readAgents({ file, now: 7 }), []);
});

test('rejects unknown state and survives damaged file', () => {
  const file = tmp();
  assert.throws(() => report({ file, state: 'dancing' }));
  fs.writeFileSync(file, '{nope');
  assert.deepEqual(readAgents({ file }), []);
});

test('merge replaces a disconnected Orca and adds to a healthy one', () => {
  const agents = [{ id: 'claude:a', state: 'working', failed: false, changedAt: 1 }];
  const down = mergeSnapshot({ kind: 'disconnected', label: 'Disconnected', agents: [], reason: 'x' }, agents);
  assert.equal(down.kind, 'working');
  const idle = mergeSnapshot({ kind: 'idle', label: 'Idle', agents: [], reason: 'Orca hosts: h' }, agents);
  assert.equal(idle.kind, 'working');
  assert.equal(mergeSnapshot({ kind: 'idle', agents: [] }, []).kind, 'idle');
});

test('MCP server answers initialize, tools/list and tools/call', () => {
  const file = tmp();
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ship_set_status', arguments: { state: 'needs_input' } } }
  ].map(m => JSON.stringify(m)).join('\n') + '\n';
  const out = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.cjs')], {
    input, encoding: 'utf8', env: { ...process.env, COZY_CLAUDE_STATUS: file }
  });
  const replies = out.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length, 3);
  assert.equal(replies[1].result.tools[0].name, 'ship_set_status');
  assert.equal(replies[2].result.isError, undefined);
  assert.equal(readAgents({ file })[0].state, 'waiting');
});
