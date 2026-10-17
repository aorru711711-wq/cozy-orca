const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { connect, parseOnly, agentJobs, installPi } = require('../src/connect.cjs');

test('parseOnly accepts aliases and rejects unknown agents', () => {
  assert.equal(parseOnly([]), null);
  assert.deepEqual([...parseOnly(['--only', 'claude,agy,pi'])].sort(), ['antigravity', 'claude-desktop', 'pi']);
  assert.throws(() => parseOnly(['--only', 'nope']), /Unknown agent/);
});

test('connect installs every agent into temp homes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-connect-'));
  const homedir = path.join(root, 'home');
  const env = {
    APPDATA: path.join(homedir, 'AppData', 'Roaming'),
    CLAUDE_CODE_SETTINGS: path.join(homedir, '.claude', 'settings.json'),
    CODEX_HOME: path.join(homedir, '.codex'),
    ANTIGRAVITY_HOOKS: path.join(homedir, '.gemini', 'config', 'hooks.json'),
    ANTIGRAVITY_MCP: path.join(homedir, '.gemini', 'config', 'mcp_config.json'),
    PI_CODING_AGENT_DIR: path.join(homedir, '.pi', 'agent')
  };
  fs.mkdirSync(path.join(homedir, '.gemini', 'config'), { recursive: true });
  fs.writeFileSync(env.ANTIGRAVITY_HOOKS, JSON.stringify({
    'orca-status': { Stop: [{ type: 'command', command: 'keep.cmd', timeout: 10 }] }
  }));
  fs.writeFileSync(env.ANTIGRAVITY_MCP, '');
  const lines = [];
  const result = connect({
    argv: [], env, homedir,
    log: line => lines.push(String(line)),
    error: line => lines.push(`ERR ${line}`)
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 6);
  assert.ok(fs.existsSync(path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json')));
  assert.ok(JSON.stringify(JSON.parse(fs.readFileSync(env.CLAUDE_CODE_SETTINGS, 'utf8'))).includes('ship-hook'));
  assert.ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME, 'hooks.json'), 'utf8'))).includes('ship-hook'));
  const agy = JSON.parse(fs.readFileSync(env.ANTIGRAVITY_HOOKS, 'utf8'));
  assert.equal(agy['orca-status'].Stop[0].command, 'keep.cmd');
  assert.ok(agy['cozy-orca-ship']);
  assert.equal(JSON.parse(fs.readFileSync(env.ANTIGRAVITY_MCP, 'utf8')).mcpServers['cozy-orca-ship'].env.COZY_SHIP_SOURCE, 'Antigravity');
  assert.ok(fs.existsSync(path.join(env.PI_CODING_AGENT_DIR, 'extensions', 'cozy-orca-ship.ts')));
  const removed = connect({
    argv: ['--remove', '--only', 'pi'], env, homedir,
    log: () => {}, error: () => {}
  });
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(path.join(env.PI_CODING_AGENT_DIR, 'extensions', 'cozy-orca-ship.ts')), false);
  assert.equal(agentJobs({ env, homedir, only: new Set(['codex']) }).length, 1);
  installPi({ file: path.join(root, 'copy.ts'), source: path.join(__dirname, '..', 'extensions', 'pi-cozy-orca.ts') });
  assert.ok(fs.existsSync(path.join(root, 'copy.ts')));
});
