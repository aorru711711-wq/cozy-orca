const { execFile } = require('node:child_process');

const CANONICAL = new Set(['pending', 'working', 'completed', 'failed', 'cancelled']);
const UNFINISHED = new Set(['pending', 'working']);
const ID_TOKEN = /^[A-Za-z0-9_.:-]+$/;
const MAX_TITLE = 160;
const MAX_RUN_PAGES = 20;

// Orca task-update statuses are pending, ready, blocked, dispatched, completed, and failed.
// Cancellation is a failed task whose result text is exactly "cancelled".
const STATE_BY_STATUS = new Map([
  ['pending', 'pending'],
  ['ready', 'pending'],
  ['blocked', 'pending'],
  ['dispatched', 'working'],
  ['completed', 'completed'],
  ['failed', 'failed']
]);

function unknownTaskProgress() {
  return { known: false, items: [], runIds: [] };
}

function canonicalTaskState(status, result) {
  if (status === 'failed' && typeof result === 'string' && result.trim() === 'cancelled') return 'cancelled';
  return STATE_BY_STATUS.get(status) || null;
}

function parseJson(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

function cleanTitle(value) {
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE ? text.slice(0, MAX_TITLE).trim() : text;
}

function taskTitle(task) {
  if (task.task_title != null && typeof task.task_title !== 'string') return null;
  if (task.display_name != null && typeof task.display_name !== 'string') return null;
  const primary = typeof task.task_title === 'string' ? task.task_title : '';
  const secondary = typeof task.display_name === 'string' ? task.display_name : '';
  return cleanTitle(primary.trim() ? primary : secondary);
}

function parseRunList(payload) {
  if (!payload || payload.ok !== true || !payload.result || typeof payload.result !== 'object') return { ok: false };
  const { runs, nextCursor } = payload.result;
  if (!Array.isArray(runs)) return { ok: false };
  if (!(nextCursor == null || typeof nextCursor === 'string' || Number.isInteger(nextCursor))) return { ok: false };
  const parsed = [];
  const seen = new Set();
  for (const run of runs) {
    if (!run || typeof run.id !== 'string' || !ID_TOKEN.test(run.id) || seen.has(run.id)) return { ok: false };
    seen.add(run.id);
    if (run.legacy !== 0 && run.legacy !== 1 && run.legacy !== false && run.legacy !== true) return { ok: false };
    parsed.push({ id: run.id, legacy: run.legacy === 1 || run.legacy === true });
  }
  return { ok: true, runs: parsed, nextCursor: nextCursor == null || nextCursor === '' ? null : nextCursor };
}

function parseTaskList(payload, runId) {
  if (typeof runId !== 'string' || !payload || payload.ok !== true || !payload.result || typeof payload.result !== 'object') {
    return { ok: false };
  }
  const result = payload.result;
  if (result.legacyReadOnly === true) return { ok: true, legacy: true, tasks: [] };
  if (result.legacyReadOnly != null && result.legacyReadOnly !== false) return { ok: false };
  if (result.runId !== runId || !Array.isArray(result.tasks) || !Number.isInteger(result.count) || result.count !== result.tasks.length) {
    return { ok: false };
  }
  const tasks = [];
  const seen = new Map();
  for (const task of result.tasks) {
    if (!task || typeof task.id !== 'string' || !ID_TOKEN.test(task.id) || task.run_id !== runId) return { ok: false };
    const state = canonicalTaskState(task.status, task.result);
    if (!CANONICAL.has(state)) return { ok: false };
    const title = taskTitle(task);
    if (title == null) return { ok: false };
    const item = { id: task.id, runId, state, title };
    const previous = seen.get(task.id);
    if (previous) {
      if (previous.state !== item.state || previous.title !== item.title) return { ok: false };
      continue;
    }
    seen.set(task.id, item);
    tasks.push(item);
  }
  return { ok: true, legacy: false, tasks };
}

function buildInventory({ runs, listings, tracked }) {
  if (!Array.isArray(runs) || !Array.isArray(tracked) || !listings || typeof listings !== 'object') return { ok: false };
  const open = new Map();
  const seen = new Set();
  for (const run of runs) {
    if (!run || typeof run.id !== 'string' || seen.has(run.id)) return { ok: false };
    seen.add(run.id);
    if (run.legacy) continue;
    const listing = listings[run.id];
    if (!listing || listing.ok !== true) return { ok: false };
    if (listing.legacy) continue;
    if (!Array.isArray(listing.tasks)) return { ok: false };
    open.set(run.id, listing.tasks);
  }
  const nextTracked = [];
  const included = new Set();
  for (const id of tracked) {
    if (typeof id !== 'string' || included.has(id)) return { ok: false };
    if (!open.has(id)) continue;
    included.add(id);
    nextTracked.push(id);
  }
  for (const run of runs) {
    if (!open.has(run.id) || included.has(run.id)) continue;
    const unfinished = open.get(run.id).some(task => UNFINISHED.has(task.state));
    if (!unfinished) continue;
    included.add(run.id);
    nextTracked.push(run.id);
  }
  const items = [];
  const byId = new Map();
  for (const id of nextTracked) {
    for (const task of open.get(id)) {
      if (!task || !CANONICAL.has(task.state)) return { ok: false };
      const previous = byId.get(task.id);
      if (previous) {
        if (previous.state !== task.state || previous.title !== task.title || previous.runId !== task.runId) return { ok: false };
        continue;
      }
      byId.set(task.id, { id: task.id, runId: task.runId, state: task.state, title: task.title });
      items.push(byId.get(task.id));
    }
  }
  return { ok: true, tracked: nextTracked, progress: { known: true, items, runIds: nextTracked.slice() } };
}

class TaskSource {
  constructor({ executable, execute = execFile, timeout = 5000, maxBuffer = 16 * 1024 * 1024, maxRunPages = MAX_RUN_PAGES } = {}) {
    Object.assign(this, { executable, execute, timeout, maxBuffer, maxRunPages });
    this.tracked = [];
    this.child = null;
    this.pending = null;
    this.cancelExec = null;
    this.stopped = false;
    this.lastFailure = null;
  }

  commandOptions() {
    return {
      windowsHide: true, timeout: this.timeout, maxBuffer: this.maxBuffer,
      encoding: 'utf8', shell: false
    };
  }

  resume() { this.stopped = false; }

  stop() {
    this.stopped = true;
    const cancel = this.cancelExec;
    this.cancelExec = null;
    const child = this.child;
    this.child = null;
    if (cancel) cancel();
    if (typeof child?.kill === 'function') child.kill();
  }

  exec(args) {
    if (this.stopped) return Promise.resolve({ error: new Error('stopped'), stdout: '' });
    return new Promise(resolve => {
      let settled = false;
      let child = null;
      const finish = (error, stdout) => {
        if (settled) return;
        settled = true;
        this.cancelExec = null;
        if (this.child === child) this.child = null;
        resolve({ error: error || null, stdout: typeof stdout === 'string' ? stdout : '' });
      };
      this.cancelExec = () => finish(new Error('stopped'), '');
      try {
        child = this.execute(this.executable, args, this.commandOptions(), finish);
      } catch (error) {
        finish(error, '');
        return;
      }
      this.child = child;
    });
  }

  async listRuns() {
    const runs = [];
    const seenCursors = new Set();
    const seenIds = new Set();
    let cursor = null;
    for (let page = 0; page < this.maxRunPages; page++) {
      if (this.stopped) return null;
      const args = ['orchestration', 'run-list', '--json'];
      if (cursor != null) args.push('--cursor', String(cursor));
      const { error, stdout } = await this.exec(args);
      if (this.stopped || error) {
        this.lastFailure = 'run-list failed';
        return null;
      }
      const parsed = parseRunList(parseJson(stdout));
      if (!parsed.ok) {
        this.lastFailure = 'run-list unreadable';
        return null;
      }
      for (const run of parsed.runs) {
        if (seenIds.has(run.id)) {
          this.lastFailure = 'run-list repeated a run';
          return null;
        }
        seenIds.add(run.id);
        runs.push(run);
      }
      if (parsed.nextCursor == null) return runs;
      const key = String(parsed.nextCursor);
      if (seenCursors.has(key)) {
        this.lastFailure = 'run-list cursor repeated';
        return null;
      }
      seenCursors.add(key);
      cursor = parsed.nextCursor;
    }
    this.lastFailure = 'run-list did not end';
    return null;
  }

  async collectOnce() {
    if (this.stopped) return unknownTaskProgress();
    const runs = await this.listRuns();
    if (!runs) return unknownTaskProgress();
    const listings = {};
    for (const run of runs) {
      if (run.legacy) continue;
      if (this.stopped) return unknownTaskProgress();
      const { error, stdout } = await this.exec(['orchestration', 'task-list', '--run', run.id, '--json']);
      if (this.stopped || error) {
        this.lastFailure = 'task-list failed';
        return unknownTaskProgress();
      }
      const parsed = parseTaskList(parseJson(stdout), run.id);
      if (!parsed.ok) {
        this.lastFailure = 'task-list unreadable';
        return unknownTaskProgress();
      }
      listings[run.id] = parsed;
    }
    const built = buildInventory({ runs, listings, tracked: this.tracked });
    if (!built.ok || this.stopped) {
      if (!this.stopped) this.lastFailure = 'task inventory rejected';
      return unknownTaskProgress();
    }
    this.tracked = built.tracked;
    this.lastFailure = null;
    return built.progress;
  }

  collect() {
    if (this.pending) return this.pending;
    this.pending = this.collectOnce().finally(() => { this.pending = null; });
    return this.pending;
  }
}

module.exports = {
  TaskSource, unknownTaskProgress, canonicalTaskState, parseRunList, parseTaskList, buildInventory
};
