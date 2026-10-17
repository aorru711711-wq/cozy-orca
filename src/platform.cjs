const path = require('node:path');
const os = require('node:os');

function orcaExecutable(platform = process.platform) {
  return platform === 'win32' ? 'orca.exe' : 'orca';
}

/** Data folder for a packaged app. On macOS the executable lives inside the .app bundle. */
function packagedDataDir(execPath, platform = process.platform) {
  const root = platform === 'darwin'
    ? path.resolve(path.dirname(execPath), '..', '..', '..')
    : path.dirname(execPath);
  return path.join(root, 'data');
}

function configHome(platform = process.platform, env = process.env, homedir = os.homedir()) {
  if (platform === 'win32') return env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.join(homedir, '.config');
}

function claudeConfigFile(platform = process.platform, env = process.env, homedir = os.homedir()) {
  if (env.CLAUDE_DESKTOP_CONFIG) return env.CLAUDE_DESKTOP_CONFIG;
  return path.join(configHome(platform, env, homedir), 'Claude', 'claude_desktop_config.json');
}

module.exports = { orcaExecutable, packagedDataDir, configHome, claudeConfigFile };
