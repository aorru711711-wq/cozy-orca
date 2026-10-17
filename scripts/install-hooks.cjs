/* Installs ship hooks for Claude Code, Codex Desktop/CLI, and Antigravity/agy.
   Also adds the Cozy Orca MCP server to Antigravity. `--remove` deletes them. `--print` shows the paths. */
const path = require('node:path');
const {
  hookCommand, installFile, installAntigravityHooks, installMcp, targets
} = require('../src/install-hooks.cjs');

const remove = process.argv.includes('--remove');
const print = process.argv.includes('--print');
const script = path.join(__dirname, '..', 'src', 'ship-hook.cjs');
const mcpServer = path.join(__dirname, '..', 'mcp', 'server.cjs');

for (const target of targets()) {
  if (print) {
    console.log(`${target.source} (${target.kind}): ${target.file}`);
    continue;
  }
  try {
    if (target.kind === 'hooks') {
      installFile({ ...target, command: hookCommand(target.source, process.execPath, script), remove });
    } else if (target.kind === 'antigravity') {
      installAntigravityHooks({ file: target.file, source: target.source, remove, scriptPath: script });
    } else if (target.kind === 'mcp') {
      installMcp({
        file: target.file, remove,
        command: process.execPath, args: [mcpServer], env: target.env
      });
    }
    console.log(`${remove ? 'Removed' : 'Installed'} ${target.source} ${target.kind} in ${target.file}.`);
  } catch (error) {
    console.error(`Could not update ${target.file}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (!print) {
  console.log(remove
    ? 'Restart Claude Code, Codex, and Antigravity/agy so they drop the hooks.'
    : 'Restart Claude Code, Codex, and Antigravity/agy. If Codex asks you to trust the new hook, allow it. Then start the Cozy Orca app.');
}
