const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { modeFor, zipDirectory } = require('../scripts/zip-portable.cjs');

test('executable bits follow the file, not the operating system that zips it', () => {
  assert.equal(modeFor('Cozy Orca-linux-x64/Cozy Orca', 'file') & 0o777, 0o755);
  assert.equal(modeFor('Cozy Orca-darwin-arm64/Launch Cozy Orca.command', 'file') & 0o777, 0o755);
  assert.equal(modeFor('Cozy Orca-linux-x64/launch-cozy-orca.sh', 'file') & 0o777, 0o755);
  assert.equal(modeFor('app/Cozy Orca.app/Contents/MacOS/Cozy Orca', 'file') & 0o777, 0o755);
  assert.equal(modeFor('app/README.md', 'file') & 0o777, 0o644);
  assert.equal(modeFor('app/Launch Cozy Orca.cmd', 'file') & 0o777, 0o644);
});

test('a portable zip records unix modes and skips data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-zip-'));
  const folder = path.join(root, 'Cozy Orca-linux-x64');
  fs.mkdirSync(path.join(folder, 'data'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'data', 'secret.json'), '{}');
  fs.writeFileSync(path.join(folder, 'Cozy Orca'), 'elf');
  fs.writeFileSync(path.join(folder, 'README.md'), 'hi');
  const zip = path.join(root, 'out.zip');
  await zipDirectory(folder, zip);
  const buf = fs.readFileSync(zip);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 8);
  let p = buf.readUInt32LE(eocd + 16);
  const modes = {};
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    modes[name] = buf.readUInt32LE(p + 38) >>> 16;
    p += 46 + nameLen + extra + comment;
  }
  assert.equal(modes['Cozy Orca-linux-x64/Cozy Orca'] & 0o777, 0o755);
  assert.equal(modes['Cozy Orca-linux-x64/README.md'] & 0o777, 0o644);
  assert.equal(Object.keys(modes).some(name => name.includes('secret')), false);
  fs.rmSync(root, { recursive: true, force: true });
});
