const TASK_STATES = new Set(['pending', 'working', 'completed', 'failed', 'cancelled']);
// A live poll is 2s plus a command of up to 5s. Longer gaps are sleep, downtime, or a dropped watch.
const MAX_CONTINUOUS_MS = 15000;

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function stringSet(value) {
  const set = new Set();
  if (!Array.isArray(value)) return set;
  for (const entry of value) if (typeof entry === 'string' && entry) set.add(entry);
  return set;
}

function readInventory(snapshot) {
  const progress = snapshot.taskProgress;
  if (!progress || progress.known !== true || !Array.isArray(progress.items)) return null;
  const states = new Map();
  for (const item of progress.items) {
    if (!item || typeof item.id !== 'string' || !item.id || !TASK_STATES.has(item.state)) return null;
    const prior = states.get(item.id);
    if (prior && prior !== item.state) return null;
    states.set(item.id, item.state);
  }
  return [...states.entries()].map(([id, state]) => ({ id, state }));
}

class VoyageTracker {
  constructor(persisted) {
    const state = persisted && typeof persisted === 'object' ? persisted : {};
    this.sailingMs = nonNegativeNumber(state.sailingMs);
    this.completedTaskIds = stringSet(state.completedTaskIds);
    this.observedTurnIds = stringSet(state.observedTurnIds);
    this.completionSerial = nonNegativeInt(state.completionSerial);
    this.completionAt = nonNegativeNumber(state.completionAt);
    this.taskBaselineEstablished = state.taskBaselineEstablished === true;
    this.lastNow = null;
    this.sailing = false;
    this.openTurns = new Map();
  }

  serialize() {
    return {
      version: 1,
      sailingMs: this.sailingMs,
      completedTaskIds: [...this.completedTaskIds].sort(),
      observedTurnIds: [...this.observedTurnIds].sort(),
      completionSerial: this.completionSerial,
      completionAt: this.completionAt,
      taskBaselineEstablished: this.taskBaselineEstablished,
    };
  }

  update(snapshot, now = Date.now()) {
    const current = snapshot && typeof snapshot === 'object' ? snapshot : { kind: 'unavailable', agents: [] };
    if (!Number.isFinite(now)) now = Date.now();
    const agents = Array.isArray(current.agents) ? current.agents : [];
    const gap = current.kind === 'unavailable' || current.kind === 'disconnected' || !Array.isArray(current.agents);
    const sailing = current.kind === 'working';
    if (this.lastNow != null && this.sailing && sailing) {
      const delta = now - this.lastNow;
      if (delta > 0 && delta <= MAX_CONTINUOUS_MS) this.sailingMs += delta;
    }
    this.lastNow = now;
    this.sailing = sailing && !gap;

    const inventory = gap ? null : readInventory(current);
    const turnKeys = this.observeTurns(agents, gap);
    let freshTurns = 0;
    for (const key of turnKeys) {
      if (this.observedTurnIds.has(key)) continue;
      this.observedTurnIds.add(key);
      freshTurns += 1;
    }

    let completedCount;
    let totalCount;
    let remainingCount;
    if (inventory) {
      const completedIds = inventory.filter(item => item.state === 'completed').map(item => item.id);
      // The first trustworthy list is a baseline. Only ids that appear after that are new completions.
      if (!this.taskBaselineEstablished) {
        for (const id of completedIds) this.completedTaskIds.add(id);
        this.taskBaselineEstablished = true;
      } else {
        let freshTasks = 0;
        for (const id of completedIds) {
          if (this.completedTaskIds.has(id)) continue;
          this.completedTaskIds.add(id);
          freshTasks += 1;
        }
        if (freshTasks > 0) {
          this.completionSerial += freshTasks;
          this.completionAt = now;
        }
      }
      completedCount = completedIds.length;
      totalCount = inventory.length;
      remainingCount = inventory.filter(item => item.state === 'pending' || item.state === 'working').length;
    } else {
      // Observed turns are the fallback. They must not add on top of a known task inventory.
      if (freshTurns > 0) {
        this.completionSerial += freshTurns;
        this.completionAt = now;
      }
      completedCount = this.observedTurnIds.size;
      totalCount = null;
      remainingCount = null;
    }

    const taskFailed = inventory ? inventory.some(item => item.state === 'failed') : false;
    const hasError = current.hasError === true || taskFailed || agents.some(row => row && row.failed === true);
    const crew = agents.filter(row => row && row.state === 'working');
    const result = {
      ...current,
      crew,
      crewCount: crew.length,
      sailingMs: this.sailingMs,
      completedCount,
      totalCount,
      remainingCount,
      completionSerial: this.completionSerial,
      completionAt: this.completionAt,
      hasError,
    };
    if (hasError && result.kind === 'finished') {
      result.kind = 'idle';
      result.label = 'Idle';
      result.glowUntil = 0;
    }
    return result;
  }

  observeTurns(agents, gap) {
    if (gap) {
      this.openTurns.clear();
      return [];
    }
    const present = new Set();
    const finished = [];
    for (const row of agents) {
      if (!row || typeof row.id !== 'string' || !row.id) continue;
      present.add(row.id);
      const startedAt = Number.isFinite(row.startedAt) ? row.startedAt : row.changedAt;
      const active = row.state === 'working' && row.paused !== true && row.failed !== true;
      const succeeded = row.state === 'done' && row.paused !== true && row.failed !== true;
      if (active && Number.isFinite(startedAt)) {
        const open = this.openTurns.get(row.id);
        if (!open || open.startedAt !== startedAt) this.openTurns.set(row.id, { startedAt });
      } else if (succeeded && this.openTurns.has(row.id)) {
        const open = this.openTurns.get(row.id);
        this.openTurns.delete(row.id);
        finished.push(`${row.id}\0${open.startedAt}`);
      } else if (row.failed === true || row.paused === true || row.state === 'done') {
        this.openTurns.delete(row.id);
      }
    }
    for (const id of [...this.openTurns.keys()]) if (!present.has(id)) this.openTurns.delete(id);
    return finished;
  }
}

module.exports = { VoyageTracker, MAX_CONTINUOUS_MS };
