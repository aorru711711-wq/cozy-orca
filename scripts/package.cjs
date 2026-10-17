const path = require('node:path');
const fs = require('node:fs');
const { zipDirectory } = require('./zip-portable.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const allTargets = [
  ['win32', 'x64'],
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'x64'],
  ['linux', 'arm64']
];
const picked = process.env.COZY_PACKAGE_TARGETS
  ? new Set(process.env.COZY_PACKAGE_TARGETS.split(',').map(item => item.trim()).filter(Boolean))
  : null;
const targets = allTargets.filter(([platform, arch]) => !picked || picked.has(`${platform}-${arch}`));
const launchers = {
  win32: 'Launch Cozy Orca.cmd',
  darwin: 'Launch Cozy Orca.command',
  linux: 'launch-cozy-orca.sh'
};
process.env.TEMP = process.env.TMP = path.join(root, '.tmp', 'pack-build', String(process.pid));
process.env.ELECTRON_CACHE = path.join(root, '.cache', 'electron');
process.env.electron_config_cache = process.env.ELECTRON_CACHE;
fs.mkdirSync(process.env.TEMP, { recursive: true });
// Windows often denies renaming a freshly extracted Electron tree while a scanner
// holds default_app.asar. Copy into place instead of failing the portable build.
const renamePath = fs.promises.rename.bind(fs.promises);
fs.promises.rename = async function renameOrCopy(src, dest) {
  try {
    return await renamePath(src, dest);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EBUSY' && error.code !== 'EACCES') throw error;
    await fs.promises.cp(src, dest, { force: true, recursive: true, verbatimSymlinks: true });
    await fs.promises.rm(src, { force: true, recursive: true }).catch(() => {});
  }
};
function scannerLock(error, target) {
  return (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTEMPTY')
    && String(target).includes(`${path.sep}pack-build${path.sep}`);
}
for (const name of ['unlink', 'rm']) {
  const original = fs.promises[name].bind(fs.promises);
  fs.promises[name] = async function skipLocked(target, ...args) {
    try { return await original(target, ...args); }
    catch (error) { if (scannerLock(error, target)) return; throw error; }
  };
  const callback = fs[name].bind(fs);
  fs[name] = function skipLockedCallback(target, ...args) {
    const done = args.at(-1);
    if (typeof done !== 'function') return callback(target, ...args);
    return callback(target, ...args.slice(0, -1), error => {
      if (error && scannerLock(error, target)) return done();
      done(error);
    });
  };
}
async function main() {
  const { packager } = await import('@electron/packager');
  const out = path.join(root, 'dist', `v${version}`);
  const ignore = [/^\/(?:\.cache|\.tmp|data|dist|artifacts|test|scripts)(?:\/|$)/, /^\/\.git(?:\/|$)/,
    /^\/src\/(?:verify\.cjs|preview\.html|preview\.js)$/, /^\/package-lock\.json$/,
    /^\/(?:HANDOFF|VOYAGE-CONTRACT)\.md$/, /^\/\.npmrc$/,
    /^\/Launch Cozy Orca\.cmd$/, /^\/Launch Cozy Orca\.command$/, /^\/launch-cozy-orca\.sh$/];
  for (const [platform, arch] of targets) {
    const zipPath = path.join(root, 'dist', `Cozy-Orca-${version}-${platform}-${arch}.zip`);
    if (fs.existsSync(zipPath)) { console.log(`Zip exists, skipping: ${zipPath}`); continue; }
    const folders = await packager({
      // Versioned output preserves earlier portable apps and their user data.
      dir: root, out, name: 'Cozy Orca', executableName: 'Cozy Orca',
      platform, arch, overwrite: true, asar: false, prune: true,
      electronVersion: require('electron/package.json').version,
      download: { cacheRoot: process.env.ELECTRON_CACHE }, ignore,
      ...(platform === 'win32' ? { win32metadata: { CompanyName: 'Cozy Orca', FileDescription: 'Cozy Orca Sailing Companion', ProductName: 'Cozy Orca' } } : {}),
      ...(platform === 'darwin' ? { extendInfo: { LSUIElement: true } } : {})
    });
    if (!folders.length) {
      const message = `No portable folder for ${platform}-${arch}.`;
      if (platform === 'darwin' && process.platform === 'win32') {
        console.error(`${message} macOS packaging needs a Mac, or permission to create symlinks.`);
        continue;
      }
      throw new Error(message);
    }
    for (const folder of folders) {
      const launcher = launchers[platform];
      fs.copyFileSync(path.join(root, launcher), path.join(folder, launcher));
      fs.copyFileSync(path.join(root, 'README.md'), path.join(folder, 'README.md'));
      await zipDirectory(folder, zipPath);
      console.log(`Portable folder: ${folder}`);
      console.log(`Zip: ${zipPath}`);
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
