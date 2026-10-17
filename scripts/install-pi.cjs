/* Copies the Cozy Orca extension into Pi's global extensions folder. `--remove` deletes it. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'), 'extensions');
const target = path.join(dir, 'cozy-orca-ship.ts');
if (process.argv.includes('--remove')) {
  fs.rmSync(target, { force: true });
  console.log(`Removed ${target}.`);
} else {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '..', 'extensions', 'pi-cozy-orca.ts'), target);
  console.log(`Installed ${target}. Restart Pi (or run /reload), then start the Cozy Orca app.`);
}
