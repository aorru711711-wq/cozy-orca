const STATES = new Set(['working', 'waiting', 'blocked', 'done']);
const WORKSPACE_STATES = new Set(['active', 'working', 'permission', 'done', 'inactive']);
const STALE_MS = 30 * 60 * 1000;

const unavailable = (reason) => ({ kind: 'unavailable', label: 'Status unavailable', reason, agents: [], hasError: false });

function agentName(row) {
  if (typeof row.displayName === 'string' && row.displayName.trim()) return row.displayName;
  if (typeof row.agentType === 'string' && row.agentType.trim()) return row.agentType;
  return 'Agent';
}

/** Consume only explicit Orca state. Never infer work from terminal output or titles. */
function aggregate(payload, now = Date.now()) {
  if (!payload || payload.ok !== true || !payload.result) return unavailable('Invalid Orca response');
  const { worktrees, hostScope, truncated, totalCount } = payload.result;
  if (!Array.isArray(worktrees) || truncated !== false || !Number.isInteger(totalCount) || totalCount !== worktrees.length) {
    return unavailable('Incomplete workspace listing');
  }
  if (!hostScope || !Array.isArray(hostScope.hostIds) || !hostScope.hostIds.length ||
      !hostScope.hostIds.every(id => typeof id === 'string') ||
      !Array.isArray(hostScope.omittedHostIds) || hostScope.omittedHostIds.length) {
    return unavailable('Not all Orca hosts are covered');
  }
  const agents = [];
  const identities = new Set();
  let working = false;
  let waiting = false;
  let staleBlocked = false;
  for (const workspace of worktrees) {
    if (!workspace || typeof workspace.worktreeId !== 'string' || !Array.isArray(workspace.agents) ||
        !hostScope.hostIds.includes(workspace.hostId) || !WORKSPACE_STATES.has(workspace.status) ||
        workspace.terminalVerdict === 'unverifiable' || workspace.unverifiableTerminalCount > 0) {
      return unavailable('Unverifiable workspace');
    }
    // The workspace summary also covers work not represented by a rich agent row.
    const summaryWorking = workspace.status === 'working';
    const summaryWaiting = workspace.status === 'permission';
    const included = [];
    let skippedStale = false;
    for (const row of workspace.agents) {
      if (!row || !STATES.has(row.state) || typeof row.paneKey !== 'string' ||
          !Number.isFinite(row.updatedAt) || !Number.isFinite(row.stateStartedAt) ||
          row.restoredUnconfirmed || row.subagentObservation === 'unverifiable') {
        return unavailable('Unknown or unconfirmed agent state');
      }
      // A stale row is not evidence of completion. It must not blank fresher work.
      if (row.state !== 'done' && row.structuredHostOwned !== true && now - row.updatedAt > STALE_MS) {
        skippedStale = true;
        continue;
      }
      const id = JSON.stringify([workspace.hostId, workspace.worktreeId, row.paneKey]);
      if (identities.has(id)) return unavailable('Duplicate agent identity');
      identities.add(id);
      const paused = row.interrupted === true || ['cancellation', 'interruption'].includes(row.mainAgent?.outcome);
      if (row.mainAgent && !STATES.has(row.mainAgent.state)) return unavailable('Unknown main-agent state');
      if (row.mainAgent?.outcome === 'unconfirmed') return unavailable('Agent end is unconfirmed');
      const failed = row.mainAgent?.outcome === 'failure';
      included.push({
        id, state: row.state, paused, changedAt: row.stateStartedAt, failed,
        name: agentName(row),
        task: typeof row.taskTitle === 'string' ? row.taskTitle : '',
        startedAt: row.stateStartedAt,
      });
      waiting ||= row.state === 'waiting' || row.state === 'blocked';
      waiting ||= row.mainAgent?.state === 'waiting' || row.mainAgent?.state === 'blocked';
    }
    if (skippedStale && included.length === 0 && !summaryWorking && !summaryWaiting) {
      staleBlocked = true;
      continue;
    }
    working ||= summaryWorking || included.some(row => row.state === 'working');
    waiting ||= summaryWaiting;
    agents.push(...included);
  }
  if (staleBlocked && !working && !waiting) return unavailable('Agent status is stale');
  const latestDone = agents.filter(row => row.state === 'done').sort((a, b) => b.changedAt - a.changedAt)[0];
  const kind = working ? 'working' : waiting ? 'waiting' : latestDone?.paused ? 'paused' : 'idle';
  const label = working ? (waiting ? 'Working · needs input' : 'Working') :
    waiting ? 'Needs input' : kind === 'paused' ? 'Paused' : 'Idle';
  const hasError = agents.some(row => row.failed);
  return { kind, label, needsInput: waiting, agents, hasError, reason: `Orca hosts: ${hostScope.hostIds.join(', ')}` };
}

class StatusTracker {
  constructor() { this.active = new Set(); this.glowUntil = 0; }

  update(snapshot, now = Date.now()) {
    if (snapshot.kind === 'unavailable' || snapshot.kind === 'disconnected') {
      this.active.clear();
      this.glowUntil = 0;
      return { ...snapshot, glowUntil: 0 };
    }
    const rows = new Map(snapshot.agents.map(row => [row.id, row]));
    const explicitFailure = snapshot.hasError === true || snapshot.agents.some(row => row.failed === true);
    // A missing row is not evidence of completion.
    if ([...this.active].some(id => !rows.has(id))) this.active.clear();
    for (const row of snapshot.agents) if (row.state === 'working') this.active.add(row.id);
    if (snapshot.kind === 'working' || snapshot.kind === 'waiting') this.glowUntil = 0;
    else if (this.active.size) {
      if (!explicitFailure && [...this.active].every(id => {
        const row = rows.get(id);
        return row?.state === 'done' && !row.paused && row.failed !== true;
      })) this.glowUntil = now + 3000;
      this.active.clear();
    }
    // A reported failure must not wear the success glow, including one already armed.
    if (explicitFailure) this.glowUntil = 0;
    if (!explicitFailure && snapshot.kind === 'idle' && now < this.glowUntil) {
      return { ...snapshot, kind: 'finished', label: 'Finished', glowUntil: this.glowUntil };
    }
    return { ...snapshot, glowUntil: this.glowUntil };
  }
}

module.exports = { aggregate, StatusTracker };
