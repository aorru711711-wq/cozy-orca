const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { orcaExecutable, packagedDataDir, configHome, claudeConfigFile } = require('../src/platform.cjs');
const { statusFile } = require('../src/claude-status.cjs');

test('Orca\'s program name has an extension only on Windows', () => {
  assert.equal(orcaExecutable('win32'), 'orca.exe');
  assert.equal(orcaExecutable('darwin'), 'orca');
  assert.equal(orcaExecutable('linux'), 'orca');
});

test('packaged data sits beside the app, outside a macOS bundle', () => {
  const root = path.resolve('portable');
  assert.equal(packagedDataDir(path.join(root, 'Cozy Orca.exe'), 'win32'), path.join(root, 'data'));
  assert.equal(packagedDataDir(path.join(root, 'Cozy Orca'), 'linux'), path.join(root, 'data'));
  const mac = path.join(root, 'Cozy Orca.app', 'Contents', 'MacOS', 'Cozy Orca');
  assert.equal(packagedDataDir(mac, 'darwin'), path.join(root, 'data'));
});

test('config and Claude Desktop paths follow each operating system', () => {
  const home = path.join('Users', 'ada');
  assert.equal(configHome('win32', { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, home),
    'C:\\Users\\ada\\AppData\\Roaming');
  assert.equal(configHome('darwin', {}, home), path.join(home, 'Library', 'Application Support'));
  assert.equal(configHome('linux', {}, home), path.join(home, '.config'));
  assert.equal(configHome('linux', { XDG_CONFIG_HOME: '/xdg' }, home), '/xdg');
  assert.equal(claudeConfigFile('darwin', {}, home),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  assert.equal(claudeConfigFile('linux', {}, home),
    path.join(home, '.config', 'Claude', 'claude_desktop_config.json'));
  assert.equal(statusFile({ COZY_CLAUDE_STATUS: '/tmp/ship.json' }, 'linux', home), '/tmp/ship.json');
  assert.equal(statusFile({}, 'darwin', home),
    path.join(home, 'Library', 'Application Support', 'cozy-orca', 'claude-status.json'));
});
