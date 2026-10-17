const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { claudeConfigFile } = require('./platform.cjs');
const {
  hookCommand, installFile, installAntigravityHooks, installMcp, targets: hookTargets,
  CLAUDE_EVENTS, CODEX_EVENTS
} = require('./install-hooks.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHIP_HOOK = path.join(ROOT, 'src', 'ship-hook.cjs');
const MCP_SERVER = path.join(ROOT, 'mcp', 'server.cjs');
const PI_EXTENSION = path.join(ROOT, 'extensions', 'pi-cozy-orca.ts');

const AGENT_ALIASES = {
  all: null,
  orca: 'orca',
  'claude-desktop': 'claude-desktop',
  claude: 'claude-desktop',
  'claude-code': 'claude-code',
  codex: 'codex',
  antigravity: 'antigravity',
  agy: 'antigravity',
  pi: 'pi'
};

function parseOnly(argv) {
  const index = argv.indexOf('--only');
  if (index < 0) return null;
  const value = argv[index + 1] || '';
  const names = value.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  if (!names.length || names.includes('all')) return null;
  const selected = new Set();
  for (const name of names) {
    const alias = AGENT_ALIASES[name];
    if (!alias) throw new Error(`Unknown agent "${name}". Use: claude-desktop, claude-code, codex, antigravity, agy, pi`);
    if (alias !== 'orca') selected.add(alias);
  }
  return selected;
}

function piExtensionFile(env = process.env, homedir = os.homedir()) {
  const dir = path.join(env.PI_CODING_AGENT_DIR || path.join(homedir, '.pi', 'agent'), 'extensions');
  return path.join(dir, 'cozy-orca-ship.ts');
}

function installPi({ file = piExtensionFile(), remove = false, source = PI_EXTENSION } = {}) {
  if (remove) {
    fs.rmSync(file, { force: true });
    return file;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(source, file);
  return file;
}

function agentJobs({ env = process.env, homedir = os.homedir(), only = null,
  nodePath = process.execPath, shipHook = SHIP_HOOK, mcpServer = MCP_SERVER, piSource = PI_EXTENSION } = {}) {
  const jobs = [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'mcp',
      file: claudeConfigFile(process.platform, env, homedir),
      run({ remove }) {
        installMcp({
          file: this.file, remove, command: nodePath, args: [mcpServer],
          env: { COZY_SHIP_SOURCE: 'Claude Desktop' }
        });
      }
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'hooks',
      file: hookTargets(env, homedir).find(target => target.source === 'Claude Code').file,
      run({ remove }) {
        installFile({
          file: this.file, source: 'Claude Code', events: CLAUDE_EVENTS, remove,
          command: hookCommand('Claude Code', nodePath, shipHook)
        });
      }
    },
    {
      id: 'codex',
      label: 'Codex Desktop / CLI',
      kind: 'hooks',
      file: hookTargets(env, homedir).find(target => target.source === 'Codex').file,
      run({ remove }) {
        installFile({
          file: this.file, source: 'Codex', events: CODEX_EVENTS, remove,
          command: hookCommand('Codex', nodePath, shipHook)
        });
      }
    },
    {
      id: 'antigravity',
      label: 'Antigravity / agy hooks',
      kind: 'hooks',
      file: hookTargets(env, homedir).find(target => target.kind === 'antigravity').file,
      run({ remove }) {
        installAntigravityHooks({
          file: this.file, source: 'Antigravity', remove, nodePath, scriptPath: shipHook
        });
      }
    },
    {
      id: 'antigravity',
      label: 'Antigravity / agy MCP',
      kind: 'mcp',
      file: hookTargets(env, homedir).find(target => target.kind === 'mcp').file,
      run({ remove }) {
        installMcp({
          file: this.file, remove, command: nodePath, args: [mcpServer],
          env: { COZY_SHIP_SOURCE: 'Antigravity' }
        });
      }
    },
    {
      id: 'pi',
      label: 'Pi',
      kind: 'extension',
      file: piExtensionFile(env, homedir),
      run({ remove }) {
        installPi({ file: this.file, remove, source: piSource });
      }
    }
  ];
  if (!only) return jobs;
  return jobs.filter(job => only.has(job.id));
}

function connect({ argv = process.argv.slice(2), env = process.env, homedir = os.homedir(),
  log = console.log, error = console.error } = {}) {
  const remove = argv.includes('--remove');
  const print = argv.includes('--print');
  let only;
  try { only = parseOnly(argv); }
  catch (err) {
    error(err.message);
    return { ok: false, results: [] };
  }
  const jobs = agentJobs({ env, homedir, only });
  if (!jobs.length) {
    error('No agents selected.');
    return { ok: false, results: [] };
  }
  const results = [];
  let ok = true;
  for (const job of jobs) {
    if (print) {
      log(`${job.label} (${job.kind}): ${job.file}`);
      results.push({ ...job, status: 'print' });
      continue;
    }
    try {
      job.run({ remove });
      log(`${remove ? 'Removed' : 'Connected'} ${job.label} → ${job.file}`);
      results.push({ id: job.id, label: job.label, kind: job.kind, file: job.file, status: 'ok' });
    } catch (err) {
      ok = false;
      error(`Could not update ${job.label} (${job.file}): ${err.message}`);
      results.push({ id: job.id, label: job.label, kind: job.kind, file: job.file, status: 'error', message: err.message });
    }
  }
  if (!print) {
    if (remove) log('Restart the agents you disconnected, then keep using the Cozy Orca app.');
    else {
      log('');
      log('Next:');
      log('1. Restart Claude Desktop, Claude Code, Codex, Antigravity/agy, and Pi (or run /reload in Pi).');
      log('2. If Codex asks to trust the new hook, allow it.');
      log('3. Start the Cozy Orca app (npm start, or the portable launcher).');
      log('4. Orca fleet needs no connect step: run Orca, then the ship.');
    }
  }
  return { ok, results };
}

module.exports = {
  AGENT_ALIASES, parseOnly, piExtensionFile, installPi, agentJobs, connect, SHIP_HOOK, MCP_SERVER, PI_EXTENSION
};
