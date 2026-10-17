const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLAUDE_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
const CODEX_EVENTS = ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd', 'Interrupt'];
const ANTIGRAVITY_FLAT = ['PreInvocation', 'PostInvocation', 'Stop'];
const ANTIGRAVITY_NESTED = ['PreToolUse', 'PostToolUse'];
const ANTIGRAVITY_PACK = 'cozy-orca-ship';

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function hookCommand(source, nodePath = process.execPath, scriptPath = path.join(__dirname, 'ship-hook.cjs'), event = '') {
  let command = `${quoteCmd(nodePath)} ${quoteCmd(scriptPath)} --source ${quoteCmd(source)}`;
  if (event) command += ` --event ${quoteCmd(event)}`;
  return command;
}

function isOurs(hook, source) {
  return Boolean(hook && typeof hook.command === 'string'
    && hook.command.includes('ship-hook.cjs')
    && hook.command.includes(`--source ${quoteCmd(source)}`));
}

function handler(command) {
  return { type: 'command', command, commandWindows: command, timeout: 10 };
}

function ensureEvent(groups, source, command) {
  const list = Array.isArray(groups) ? groups.map(group => ({ ...group, hooks: [...(group.hooks || [])] })) : [];
  for (const group of list) {
    const hook = (group.hooks || []).find(item => isOurs(item, source));
    if (hook) {
      Object.assign(hook, handler(command));
      return list;
    }
  }
  list.push({ matcher: '', hooks: [handler(command)] });
  return list;
}

function removeEvent(groups, source) {
  return (Array.isArray(groups) ? groups : []).map(group => ({
    ...group, hooks: (group.hooks || []).filter(hook => !isOurs(hook, source))
  })).filter(group => (group.hooks || []).length);
}

function ensureFlat(list, source, command) {
  const arr = Array.isArray(list) ? [...list] : [];
  const index = arr.findIndex(item => isOurs(item, source));
  const entry = { type: 'command', command, timeout: 10 };
  if (index >= 0) arr[index] = entry;
  else arr.push(entry);
  return arr;
}

function removeFlat(list, source) {
  return (Array.isArray(list) ? list : []).filter(item => !isOurs(item, source));
}

function ensureNested(list, source, command) {
  const groups = Array.isArray(list) ? list.map(group => ({ ...group, hooks: [...(group.hooks || [])] })) : [];
  for (const group of groups) {
    const hook = (group.hooks || []).find(item => isOurs(item, source));
    if (hook) {
      Object.assign(hook, { type: 'command', command, timeout: 10 });
      return groups;
    }
  }
  groups.push({ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] });
  return groups;
}

function removeNested(list, source) {
  return (Array.isArray(list) ? list : []).map(group => ({
    ...group, hooks: (group.hooks || []).filter(hook => !isOurs(hook, source))
  })).filter(group => (group.hooks || []).length);
}

function claudeSettingsFile(env = process.env, homedir = os.homedir()) {
  return env.CLAUDE_CODE_SETTINGS || path.join(homedir, '.claude', 'settings.json');
}

function codexHooksFile(env = process.env, homedir = os.homedir()) {
  return path.join(env.CODEX_HOME || path.join(homedir, '.codex'), 'hooks.json');
}

function antigravityHooksFile(env = process.env, homedir = os.homedir()) {
  return env.ANTIGRAVITY_HOOKS || path.join(homedir, '.gemini', 'config', 'hooks.json');
}

function antigravityMcpFile(env = process.env, homedir = os.homedir()) {
  return env.ANTIGRAVITY_MCP || path.join(homedir, '.gemini', 'config', 'mcp_config.json');
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  return {};
}

function writeJson(file, value) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) fs.copyFileSync(file, `${file}.bak`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function editHooks(config, source, events, command, remove) {
  const hooks = { ...(config.hooks || {}) };
  for (const event of events) {
    const next = remove ? removeEvent(hooks[event], source) : ensureEvent(hooks[event], source, command);
    if (next.length) hooks[event] = next;
    else delete hooks[event];
  }
  return { ...config, hooks };
}

function editAntigravityPack(config, source, remove, nodePath, scriptPath) {
  const next = { ...config };
  if (remove) {
    delete next[ANTIGRAVITY_PACK];
    return next;
  }
  const pack = { ...(config[ANTIGRAVITY_PACK] || {}) };
  for (const event of ANTIGRAVITY_FLAT) {
    const command = hookCommand(source, nodePath, scriptPath, event);
    pack[event] = ensureFlat(pack[event], source, command);
  }
  for (const event of ANTIGRAVITY_NESTED) {
    const command = hookCommand(source, nodePath, scriptPath, event);
    pack[event] = ensureNested(pack[event], source, command);
  }
  next[ANTIGRAVITY_PACK] = pack;
  return next;
}

function editMcp(config, name, entry, remove) {
  const mcpServers = { ...(config.mcpServers || {}) };
  if (remove) delete mcpServers[name];
  else mcpServers[name] = entry;
  return { ...config, mcpServers };
}

function installFile({ file, source, events, command, remove = false }) {
  writeJson(file, editHooks(readJson(file), source, events, command, remove));
  return file;
}

function installAntigravityHooks({ file, source = 'Antigravity', remove = false,
  nodePath = process.execPath, scriptPath = path.join(__dirname, 'ship-hook.cjs') }) {
  writeJson(file, editAntigravityPack(readJson(file), source, remove, nodePath, scriptPath));
  return file;
}

function installMcp({ file, name = 'cozy-orca-ship', command = process.execPath,
  args = [path.join(__dirname, '..', 'mcp', 'server.cjs')], env, remove = false }) {
  const entry = { command, args };
  if (env) entry.env = env;
  writeJson(file, editMcp(readJson(file), name, entry, remove));
  return file;
}

function targets(env = process.env, homedir = os.homedir()) {
  return [
    { source: 'Claude Code', file: claudeSettingsFile(env, homedir), events: CLAUDE_EVENTS, kind: 'hooks' },
    { source: 'Codex', file: codexHooksFile(env, homedir), events: CODEX_EVENTS, kind: 'hooks' },
    { source: 'Antigravity', file: antigravityHooksFile(env, homedir), kind: 'antigravity' },
    { source: 'Antigravity', file: antigravityMcpFile(env, homedir), kind: 'mcp',
      env: { COZY_SHIP_SOURCE: 'Antigravity' } }
  ];
}

module.exports = {
  quoteCmd, hookCommand, isOurs, ensureEvent, removeEvent, ensureFlat, removeFlat, ensureNested, removeNested,
  editHooks, editAntigravityPack, editMcp, installFile, installAntigravityHooks, installMcp, targets,
  claudeSettingsFile, codexHooksFile, antigravityHooksFile, antigravityMcpFile,
  CLAUDE_EVENTS, CODEX_EVENTS, ANTIGRAVITY_FLAT, ANTIGRAVITY_NESTED, ANTIGRAVITY_PACK
};
