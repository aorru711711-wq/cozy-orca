const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = path.join(root, '.tmp');
fs.mkdirSync(temp, { recursive: true });
// Electron's lazy downloader runs during require(), before the app child exists.
process.env.TEMP = process.env.TMP = temp;
process.env.electron_config_cache = path.join(root, '.cache', 'electron');
const child = spawn(require('electron'), [root, ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, TEMP: temp, TMP: temp, electron_config_cache: path.join(root, '.cache', 'electron'),
    COZY_DATA_DIR: path.join(root, 'data') }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
