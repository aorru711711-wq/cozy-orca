const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configHome } = require('./platform.cjs');

const STATES = new Set(['working', 'needs_input', 'done', 'failed', 'idle']);
const STALE_MS = 30 * 60 * 1000;
const DONE_KEEP_MS = 60 * 1000;
const MAX_TASK = 160;
const MAX_SESSIONS = 20;

function statusFile(env = process.env, platform = process.platform, homedir = os.homedir()) {
  if (env.COZY_CLAUDE_STATUS) return env.COZY_CLAUDE_STATUS;
  return path.join(configHome(platform, env, homedir), 'cozy-orca', 'claude-status.json');
}
function defaultFile() {
  return statusFile();
}

function cleanTask(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TASK ? text.slice(0, MAX_TASK).trim() : text;
}

function readRaw(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)) return parsed;
  } catch { /* Missing or damaged files mean no Claude activity. */ }
  return { sessions: {} };
}

/** Record one session's state. Used by the MCP server. */
function report({ file = defaultFile(), session = 'claude-desktop', source, state, task, now = Date.now() }) {
  if (!STATES.has(state)) throw new Error(`state must be one of: ${[...STATES].join(', ')}`);
  const id = String(session).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64) || 'claude-desktop';
  const data = readRaw(file);
  const previous = data.sessions[id];
  if (state === 'idle') delete data.sessions[id];
  else {
    const same = previous && previous.state === state;
    data.sessions[id] = {
      state, task: cleanTask(task) || (previous ? previous.task : ''),
      source: cleanTask(source).slice(0, 32) || (previous && previous.source) || '',
      startedAt: same ? previous.startedAt : now, updatedAt: now
    };
  }
  const live = Object.entries(data.sessions).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_SESSIONS);
  data.sessions = Object.fromEntries(live);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return id;
}

/** Agent rows in the shape status.cjs produces, minus anything stale. */
function readAgents({ file = defaultFile(), now = Date.now() } = {}) {
  const agents = [];
  for (const [id, s] of Object.entries(readRaw(file).sessions)) {
    if (!s || !STATES.has(s.state) || !Number.isFinite(s.updatedAt) || !Number.isFinite(s.startedAt)) continue;
    const age = now - s.updatedAt;
    const finished = s.state === 'done' || s.state === 'failed';
    if (age > STALE_MS || (finished && age > DONE_KEEP_MS)) continue;
    agents.push({
      id: `claude:${id}`, name: (typeof s.source === 'string' && s.source) || 'Claude Desktop', task: typeof s.task === 'string' ? s.task : '',
      state: s.state === 'working' ? 'working' : s.state === 'needs_input' ? 'waiting' : 'done',
      paused: false, failed: s.state === 'failed', changedAt: s.startedAt, startedAt: s.startedAt
    });
  }
  return agents;
}

/** Fold Claude rows into an Orca snapshot so one ship follows both. */
function mergeSnapshot(base, agents) {
  if (!agents.length) return base;
  const bad = base.kind === 'unavailable' || base.kind === 'disconnected';
  const rows = bad ? agents : [...base.agents, ...agents];
  const working = rows.some(r => r.state === 'working');
  const waiting = rows.some(r => r.state === 'waiting' || r.state === 'blocked');
  const kind = working ? 'working' : waiting ? 'waiting' : 'idle';
  const names = [...new Set(agents.map(a => a.name))].join(', ');
  const label = working ? (waiting ? 'Working · needs input' : 'Working') : waiting ? 'Needs input' : 'Idle';
  return {
    ...base, kind, label, agents: rows, needsInput: waiting,
    hasError: rows.some(r => r.failed),
    reason: bad ? names : `${base.reason}; ${names}`
  };
}

module.exports = { defaultFile, statusFile, report, readAgents, mergeSnapshot, STATES };
