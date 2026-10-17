const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the Pi extension listens for the events that drive the ship', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'extensions', 'pi-cozy-orca.ts'), 'utf8');
  for (const event of ['agent_start', 'agent_end', 'session_shutdown']) assert.match(source, new RegExp(`pi\.on\("${event}"`));
  assert.match(source, /source: "Pi"/);
});

test('a reported source names the agent row', () => {
  const { report, readAgents } = require('../src/claude-status.cjs');
  const file = path.join(require('node:os').tmpdir(), `cozy-src-${process.pid}.json`);
  report({ file, session: 'pi-1', source: 'Pi', state: 'working' });
  assert.equal(readAgents({ file })[0].name, 'Pi');
  fs.rmSync(file, { force: true });
});
