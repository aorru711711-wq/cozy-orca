const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
process.env.TEMP = process.env.TMP = path.join(root, '.tmp', 'pack-build');
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
async function main() {
  const { packager } = await import('@electron/packager');
  const paths = await packager({
    // Versioned output preserves the previous portable app and its user data.
    dir: root, out: path.join(root, 'dist', `v${require('../package.json').version}`), name: 'Cozy Orca', executableName: 'Cozy Orca',
    platform: 'win32', arch: 'x64', overwrite: true, asar: false, prune: true,
    electronVersion: require('electron/package.json').version,
    download: { cacheRoot: process.env.ELECTRON_CACHE },
    ignore: [/^\/(?:\.cache|\.tmp|data|dist|artifacts|test|scripts)(?:\/|$)/, /^\/\.git(?:\/|$)/,
      /^\/src\/(?:verify\.cjs|preview\.html|preview\.js)$/, /^\/package-lock\.json$/,
      /^\/(?:HANDOFF|VOYAGE-CONTRACT)\.md$/, /^\/\.npmrc$/],
    win32metadata: { CompanyName: 'Cozy Orca', FileDescription: 'Cozy Orca Sailing Companion', ProductName: 'Cozy Orca' }
  });
  for (const folder of paths) {
    fs.copyFileSync(path.join(root, 'Launch Cozy Orca.cmd'), path.join(folder, 'Launch Cozy Orca.cmd'));
    fs.copyFileSync(path.join(root, 'README.md'), path.join(folder, 'README.md'));
  }
  console.log(`Portable folder: ${paths.join(', ')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
