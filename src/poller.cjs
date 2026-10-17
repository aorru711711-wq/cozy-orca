const { execFile } = require('node:child_process');
const { aggregate, StatusTracker } = require('./status.cjs');
const { TaskSource, unknownTaskProgress } = require('./tasks.cjs');

function cloneProgress(progress) {
  const source = progress || unknownTaskProgress();
  return {
    known: source.known === true,
    items: (source.items || []).map(item => ({ id: item.id, runId: item.runId, state: item.state, title: item.title })),
    runIds: [...(source.runIds || [])]
  };
}

class OrcaPoller {
  constructor({
    executable, onStatus, execute = execFile, interval = 2000, timeout = 5000,
    taskInterval = 10000, now = Date.now, maxBuffer = 16 * 1024 * 1024
  }) {
    Object.assign(this, { executable, onStatus, execute, interval, timeout, taskInterval, now, maxBuffer });
    this.tracker = new StatusTracker();
    this.stopped = true;
    this.child = null;
    this.timer = null;
    this.lastTaskAt = -Infinity;
    this.taskProgress = unknownTaskProgress();
    this.lastRaw = null;
    this.tasks = new TaskSource({
      executable, timeout, maxBuffer,
      execute: (file, args, opts, cb) => this.spawn(file, args, opts, cb)
    });
  }

  spawn(file, args, opts, cb) {
    const child = this.execute(file, args, opts, (error, stdout) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      cb(error, stdout);
    });
    this.child = child;
    return child;
  }

  start() { if (!this.stopped) return; this.stopped = false; this.tasks.resume(); this.poll(); }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.tasks.stop();
    const child = this.child;
    this.child = null;
    if (typeof child?.kill === 'function') child.kill();
  }

  poll() {
    if (this.stopped || this.child) return;
    this.spawn(this.executable, ['worktree', 'ps', '--json'], {
      windowsHide: true, timeout: this.timeout, maxBuffer: this.maxBuffer,
      encoding: 'utf8', shell: false
    }, (error, stdout) => {
      if (this.stopped) return;
      const snapshot = this.readFleet(error, stdout);
      snapshot.taskProgress = cloneProgress(this.taskProgress);
      this.lastRaw = snapshot;
      this.onStatus(this.tracker.update(snapshot));
      this.schedule();
    });
  }

  readFleet(error, stdout) {
    if (error) {
      const absent = error.code === 'ENOENT' || /not.running|connection.refused|runtime.unavailable|ECONNREFUSED/i.test(String(stdout || ''));
      return {
        kind: absent ? 'disconnected' : 'unavailable',
        label: absent ? 'Disconnected' : 'Status unavailable', agents: [],
        reason: absent ? 'Orca is not connected. Retrying automatically.' : 'Orca status request failed. Retrying automatically.'
      };
    }
    try { return aggregate(JSON.parse(stdout)); }
    catch { return { kind: 'unavailable', label: 'Status unavailable', agents: [], reason: 'Invalid Orca JSON' }; }
  }

  schedule() {
    if (this.stopped) return;
    if (this.now() - this.lastTaskAt >= this.taskInterval) {
      this.refreshTasks();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), this.interval);
  }

  refreshTasks() {
    this.tasks.collect().then(progress => {
      if (this.stopped) return;
      this.lastTaskAt = this.now();
      this.taskProgress = progress;
      if (this.lastRaw) {
        const snapshot = { ...this.lastRaw, taskProgress: cloneProgress(progress) };
        this.lastRaw = snapshot;
        this.onStatus(this.tracker.update(snapshot));
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.poll(), this.interval);
    });
  }
}

module.exports = { OrcaPoller };
