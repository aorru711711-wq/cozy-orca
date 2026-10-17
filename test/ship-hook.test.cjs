const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decide, applyHook } = require('../src/ship-hook.cjs');
const { readAgents } = require('../src/claude-status.cjs');
const {
  editHooks, editAntigravityPack, editMcp, hookCommand, installFile, installAntigravityHooks, installMcp
} = require('../src/install-hooks.cjs');

test('hook events sail, wait, finish, fail, and clear', () => {
  assert.equal(decide({ hook_event_name: 'UserPromptSubmit', prompt: 'Fix the sail\nmore' }).state, 'working');
  assert.equal(decide({ hook_event_name: 'UserPromptSubmit', prompt: 'Fix the sail\nmore' }).task, 'Fix the sail');
  assert.equal(decide({ hook_event_name: 'PostToolUse' }).state, 'working');
  assert.equal(decide({ hook_event_name: 'PreInvocation' }).state, 'working');
  assert.equal(decide({ hook_event_name: 'PermissionRequest' }).state, 'needs_input');
  assert.equal(decide({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }).state, 'needs_input');
  assert.equal(decide({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), null);
  assert.equal(decide({ hook_event_name: 'Stop' }).state, 'done');
  assert.equal(decide({ hook_event_name: 'PostInvocation' }).state, 'done');
  assert.equal(decide({ hook_event_name: 'StopFailure' }).state, 'failed');
  assert.equal(decide({ hook_event_name: 'SessionEnd' }).state, 'idle');
  assert.equal(decide({ hook_event_name: 'Interrupt' }).state, 'idle');
  assert.equal(decide({ hook_event_name: 'SubagentStop' }), null);
});

test('a hook names its own crew member and keeps the task while it waits', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-hook-')), 'status.json');
  applyHook({ source: 'Claude Code', file, now: 1000, input: { hook_event_name: 'UserPromptSubmit', session_id: 'abc', prompt: 'Mend the hull' } });
  applyHook({ source: 'Codex', file, now: 2000, input: { hook_event_name: 'UserPromptSubmit', session_id: 'abc', prompt: 'Chart the tide' } });
  applyHook({ source: 'Antigravity', file, now: 2500, input: { hook_event_name: 'PreInvocation', session_id: 'run-1' } });
  applyHook({ source: 'Claude Code', file, now: 3000, input: { hook_event_name: 'PermissionRequest', session_id: 'abc' } });
  const rows = readAgents({ file, now: 4000 });
  const claude = rows.find(row => row.name === 'Claude Code');
  const codex = rows.find(row => row.name === 'Codex');
  const agy = rows.find(row => row.name === 'Antigravity');
  assert.equal(claude.state, 'waiting');
  assert.equal(claude.task, 'Mend the hull');
  assert.equal(codex.state, 'working');
  assert.equal(codex.task, 'Chart the tide');
  assert.equal(agy.state, 'working');
  assert.notEqual(claude.id, codex.id);
  assert.notEqual(claude.id, agy.id);
});

test('the hook command reports from stdin or --event', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-hook-')), 'status.json');
  const script = path.join(__dirname, '..', 'src', 'ship-hook.cjs');
  const stop = spawnSync(process.execPath, [script, '--source', 'Codex'], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'thr_1' }),
    encoding: 'utf8', env: { ...process.env, COZY_CLAUDE_STATUS: file }
  });
  assert.equal(stop.status, 0);
  assert.equal(stop.stdout, '');
  assert.equal(readAgents({ file })[0].name, 'Codex');
  assert.equal(readAgents({ file })[0].state, 'done');
  const agy = spawnSync(process.execPath, [script, '--source', 'Antigravity', '--event', 'PreInvocation'], {
    input: '', encoding: 'utf8', env: { ...process.env, COZY_CLAUDE_STATUS: file }
  });
  assert.equal(agy.status, 0);
  assert.ok(readAgents({ file }).some(row => row.name === 'Antigravity' && row.state === 'working'));
});

test('install adds Claude Code and Codex once and remove leaves other hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-install-'));
  const claude = path.join(root, 'settings.json');
  const codex = path.join(root, 'hooks.json');
  fs.writeFileSync(claude, JSON.stringify({ permissions: { allow: [] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } }));
  const command = hookCommand('Claude Code', 'node', 'ship-hook.cjs');
  installFile({ file: claude, source: 'Claude Code', events: ['Stop'], command });
  installFile({ file: claude, source: 'Claude Code', events: ['Stop'], command });
  installFile({ file: codex, source: 'Codex', events: ['Interrupt'], command: hookCommand('Codex', 'node', 'ship-hook.cjs') });
  const saved = JSON.parse(fs.readFileSync(claude, 'utf8'));
  assert.deepEqual(saved.permissions, { allow: [] });
  assert.equal(saved.hooks.Stop.length, 2);
  installFile({ file: claude, source: 'Claude Code', events: ['Stop'], command, remove: true });
  const removed = JSON.parse(fs.readFileSync(claude, 'utf8'));
  assert.deepEqual(removed.hooks.Stop, [{ hooks: [{ type: 'command', command: 'echo keep' }] }]);
  const edited = editHooks({ hooks: {} }, 'Codex', ['Stop'], hookCommand('Codex', 'node', 'ship-hook.cjs'), false);
  assert.equal(edited.hooks.Stop[0].hooks[0].command.includes('--source "Codex"'), true);
});

test('Antigravity install keeps orca-status and adds MCP', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-agy-'));
  const hooks = path.join(root, 'hooks.json');
  const mcp = path.join(root, 'mcp_config.json');
  fs.writeFileSync(hooks, JSON.stringify({
    'orca-status': { Stop: [{ type: 'command', command: 'orca-hook.cmd', timeout: 10 }] }
  }));
  fs.writeFileSync(mcp, '');
  installAntigravityHooks({ file: hooks, scriptPath: 'ship-hook.cjs', nodePath: 'node' });
  installAntigravityHooks({ file: hooks, scriptPath: 'ship-hook.cjs', nodePath: 'node' });
  installMcp({ file: mcp, command: 'node', args: ['server.cjs'], env: { COZY_SHIP_SOURCE: 'Antigravity' } });
  const saved = JSON.parse(fs.readFileSync(hooks, 'utf8'));
  assert.equal(saved['orca-status'].Stop[0].command, 'orca-hook.cmd');
  assert.equal(saved['cozy-orca-ship'].PreInvocation.length, 1);
  assert.ok(saved['cozy-orca-ship'].PreInvocation[0].command.includes('--event'));
  assert.ok(saved['cozy-orca-ship'].PreInvocation[0].command.includes('PreInvocation'));
  assert.equal(saved['cozy-orca-ship'].PreToolUse, undefined);
  const servers = JSON.parse(fs.readFileSync(mcp, 'utf8'));
  assert.equal(servers.mcpServers['cozy-orca-ship'].env.COZY_SHIP_SOURCE, 'Antigravity');
  installAntigravityHooks({ file: hooks, remove: true });
  installMcp({ file: mcp, remove: true });
  assert.equal(JSON.parse(fs.readFileSync(hooks, 'utf8'))['cozy-orca-ship'], undefined);
  assert.equal(JSON.parse(fs.readFileSync(mcp, 'utf8')).mcpServers['cozy-orca-ship'], undefined);
  assert.equal(editAntigravityPack({ 'orca-status': {} }, 'Antigravity', false, 'node', 'ship-hook.cjs')['orca-status'] !== undefined, true);
  assert.equal(editMcp({ mcpServers: { other: {} } }, 'cozy-orca-ship', { command: 'node' }, false).mcpServers.other !== undefined, true);
});
