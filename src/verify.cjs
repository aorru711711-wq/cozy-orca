const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { aggregate } = require('./status.cjs');
const { TaskSource } = require('./tasks.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 120));

function sailingLabel(status, crewCount, sailingMs, completed, total) {
  const minutes = Math.floor(Math.max(0, sailingMs) / 60000);
  const hours = Math.floor(minutes / 60);
  const duration = hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  const parts = [status, `${crewCount} crew`, duration];
  const done = Number.isFinite(completed) && completed >= 0 ? Math.floor(completed) : 0;
  if (Number.isInteger(total) && total > 0) parts.push(`✓${done}/${total}`);
  else parts.push(`✓${done}`);
  return parts.join(' · ');
}
function pillWord(state) {
  if (state.kind === 'disconnected') return 'Disconnected';
  if (state.kind === 'unavailable') return 'Unavailable';
  if (state.hasError) return 'Failed';
  if (state.kind === 'working') return 'Working';
  if (state.kind === 'waiting') return 'Waiting';
  if (state.kind === 'paused') return 'Paused';
  if (state.kind === 'finished') return 'Finished';
  if (state.kind === 'idle') return 'Idle';
  return 'Connecting';
}
function sailors(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sailor-${index + 1}`, name: `Sailor ${index + 1}`, task: '', state: 'working', startedAt: 0, failed: false
  }));
}
function voyage(fixture) {
  const crewCount = fixture.crewCount || 0;
  return {
    needsInput: false, crew: sailors(crewCount), sailingMs: 0, completedCount: null, totalCount: null,
    remainingCount: null, completionSerial: 0, completionAt: 0, hasError: false, reason: fixture.caption, ...fixture
  };
}
function voyageFixtures() {
  const rows = [
    voyage({ fixture: 'crew-1', caption: '1 crew', kind: 'working', crewCount: 1, sailingMs: 360000,
      completedCount: 1, totalCount: 4, remainingCount: 3 }),
    voyage({ fixture: 'crew-3', caption: '3 crew', kind: 'working', crewCount: 3, sailingMs: 5040000,
      completedCount: 7, totalCount: 10, remainingCount: 3 }),
    voyage({ fixture: 'crew-8', caption: '8 crew', kind: 'working', crewCount: 8, sailingMs: 7500000,
      completedCount: 12, totalCount: 20, remainingCount: 8 }),
    voyage({ fixture: 'completion', caption: 'Completion while others work', kind: 'working', crewCount: 3,
      sailingMs: 5040000, completedCount: 8, totalCount: 10, remainingCount: 2, completionSerial: 8 }),
    voyage({ fixture: 'storm', caption: 'Error storm', kind: 'working', crewCount: 2, sailingMs: 1080000,
      completedCount: 3, totalCount: 8, remainingCount: 5, hasError: true, reason: 'An agent reported a failure.' }),
    voyage({ fixture: 'attention', caption: 'Needs input while sailing', kind: 'working', needsInput: true, crewCount: 2,
      sailingMs: 540000, completedCount: 5, totalCount: 11, remainingCount: 6, reason: 'Work continues, and Orca needs input.' }),
    voyage({ fixture: 'waiting', caption: 'Waiting flare', kind: 'waiting', needsInput: true, crewCount: 0, sailingMs: 2760000,
      completedCount: 4, totalCount: 9, remainingCount: 5, reason: 'Orca is waiting for input.' }),
    voyage({ fixture: 'unknown', caption: 'Unknown total', kind: 'working', crewCount: 1, sailingMs: 720000,
      completedCount: 7, totalCount: null, remainingCount: null, reason: 'Observed turns. The full task total is unknown.' }),
    voyage({ fixture: 'paused', caption: 'Paused', kind: 'paused', crewCount: 0, sailingMs: 5040000,
      completedCount: 7, totalCount: 10, remainingCount: 3 }),
    voyage({ fixture: 'idle', caption: 'Idle', kind: 'idle', crewCount: 0, sailingMs: 5040000,
      completedCount: 10, totalCount: 10, remainingCount: 0 }),
    voyage({ fixture: 'finished', caption: 'Finished', kind: 'finished', crewCount: 0, sailingMs: 5400000,
      completedCount: 10, totalCount: 10, remainingCount: 0, completionSerial: 10 }),
    voyage({ fixture: 'disconnected', caption: 'Disconnected', kind: 'disconnected',
      reason: 'Orca is not connected. Retrying automatically.' }),
    voyage({ fixture: 'unavailable', caption: 'Status unavailable', kind: 'unavailable',
      reason: 'Orca status request failed. Retrying automatically.' })
  ];
  for (const state of rows) {
    state.label = sailingLabel(pillWord(state), state.crewCount || 0, state.sailingMs || 0, state.completedCount, state.totalCount);
  }
  assert.equal(rows.find(state => state.fixture === 'crew-3').label, 'Working · 3 crew · 1h 24m · ✓7/10');
  assert.equal(rows.find(state => state.fixture === 'unknown').label, 'Working · 1 crew · 12m · ✓7');
  assert.equal(rows.find(state => state.fixture === 'storm').label, 'Failed · 2 crew · 18m · ✓3/8');
  assert.equal(rows.find(state => state.fixture === 'waiting').label, 'Waiting · 0 crew · 46m · ✓4/9');
  assert.equal(rows.find(state => state.fixture === 'disconnected').label, 'Disconnected · 0 crew · 0m · ✓0');
  assert.equal(rows.find(state => state.fixture === 'unknown').label.includes('/'), false);
  return rows;
}

async function verify({ app, win, screen, settings, dataDir, position, show, menuTemplate, sendDisplay }) {
  const output = path.resolve(__dirname, '..', 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  const report = { checks: [], dataDir, electron: process.versions.electron, platform: process.platform };
  const check = (name, fn) => { fn(); report.checks.push(name); };
  let gallery;
  try {
    show(); await tick();
    check('Frameless, always-on-top, taskbar-skipping overlay', () => {
      assert.equal(win.isAlwaysOnTop(), true); assert.equal(win.isResizable(), false);
      assert.equal(win.isVisible(), true); assert.equal(win.isMenuBarVisible(), false);
    });
    for (const scale of [2, 3, 4]) {
      settings.scale = scale; settings.position = null; position(); await tick();
      check(`Scale ${scale} has exact integer dimensions and taskbar clearance`, () => {
        // Windows may round the outer bounding box by one DIP at fractional DPI.
        // The content size must still be exact; never relax the art's integer scale.
        const b = win.getContentBounds(), area = screen.getPrimaryDisplay().workArea;
        assert.equal(b.width, 144 * scale); assert.equal(b.height, 72 * scale);
        assert.ok(Math.abs(b.y + b.height - (area.y + area.height - 16)) <= 1);
      });
    }
    settings.scale = 2; settings.position = { x: -99999, y: -99999 }; position();
    check('Off-screen coordinates recover to primary display', () => assert.ok(win.getBounds().x >= screen.getPrimaryDisplay().workArea.x));
    win.hide();
    check('Tray menu exposes show when hidden', () => assert.equal(menuTemplate()[2].label, 'Show companion'));
    show();
    check('Tray show restores the overlay', () => assert.equal(win.isVisible(), true));
    settings.reducedMotion = true; sendDisplay();
    const rendererErrors = [];
    win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') rendererErrors.push(details.message); });
    check('Renderer isolation is enabled', () => {
      const prefs = win.webContents.getLastWebPreferences();
      assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.sandbox, true);
    });
    assert.equal(await win.webContents.executeJavaScript('typeof require'), 'undefined');
    report.checks.push('Renderer has no Node require');
    const visualStates = voyageFixtures();
    const byFixture = Object.fromEntries(visualStates.map(state => [state.fixture, state]));
    assert.equal(byFixture['crew-1'].crewCount, 1);
    assert.equal(byFixture['crew-3'].crewCount, 3);
    assert.equal(byFixture['crew-8'].crew.length, 8);
    assert.equal(byFixture.completion.kind, 'working');
    assert.ok(byFixture.completion.completionSerial > 0 && byFixture.completion.crewCount > 0);
    assert.equal(byFixture.storm.hasError, true);
    assert.equal(byFixture.waiting.kind, 'waiting');
    assert.equal(byFixture.waiting.needsInput, true);
    assert.equal(byFixture.unknown.totalCount, null);
    for (let i = 0; i < visualStates.length; i++) {
      const state = {
        ...visualStates[i], reducedMotion: true, glowUntil: Date.now() + 60000,
        completionAt: visualStates[i].completionSerial ? Date.now() : 0
      };
      // The pill does not rewind sailing time during one continuous working stretch.
      // An idle beat starts a new stretch so each fixture shows its own duration.
      await win.webContents.executeJavaScript('receive({kind:"idle",sailingMs:0,completedCount:0,totalCount:null})');
      await win.webContents.executeJavaScript(`receive(${JSON.stringify(state)})`);
      await tick();
      fs.writeFileSync(path.join(output, `state-${i + 1}-${state.fixture}.png`), (await win.webContents.capturePage()).toPNG());
      assert.equal(await win.webContents.executeJavaScript("document.getElementById('label').textContent"), state.label);
      if (state.fixture === 'unknown') {
        assert.equal(await win.webContents.executeJavaScript("document.getElementById('scene').title"), state.reason);
      }
    }
    report.checks.push('Voyage fixtures render exact pills');
    const first = await win.webContents.executeJavaScript("CozyScene.draw(context, {kind:'working'}, 0); canvas.toDataURL()");
    const second = await win.webContents.executeJavaScript("CozyScene.draw(context, {kind:'working'}, 2); canvas.toDataURL()");
    assert.notEqual(first, second); report.checks.push('Working scene changes over time');
    const static1 = await win.webContents.executeJavaScript("CozyScene.draw(context, {kind:'working',reducedMotion:true}, 0); canvas.toDataURL()");
    const static2 = await win.webContents.executeJavaScript("CozyScene.draw(context, {kind:'working',reducedMotion:true}, 2); canvas.toDataURL()");
    assert.equal(static1, static2); report.checks.push('Reduced motion is static');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(canvas).imageRendering"), 'pixelated');
    report.checks.push('Canvas uses crisp pixel scaling');
    const cli = process.env.COZY_ORCA_CLI || require('./platform.cjs').orcaExecutable();
    const { stdout } = await promisify(execFile)(cli, ['worktree', 'ps', '--json'], { windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    const live = aggregate(JSON.parse(stdout));
    report.liveStatus = { kind: live.kind, label: live.label, reason: live.reason, agentCount: live.agents.length };
    assert.notEqual(live.kind, 'unavailable', live.reason);
    report.checks.push('Installed Orca CLI returns a supported live fleet snapshot');
    const tasks = new TaskSource({ executable: cli });
    const progress = await tasks.collect();
    assert.equal(progress.known, true, tasks.lastFailure || 'task inventory unverifiable');
    const seen = new Set();
    const stateCounts = { pending: 0, working: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const item of progress.items) {
      assert.deepEqual(Object.keys(item), ['id', 'runId', 'state', 'title']);
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.runId, 'string');
      assert.equal(typeof item.title, 'string');
      assert.ok(Object.hasOwn(stateCounts, item.state));
      assert.equal(seen.has(item.id), false);
      seen.add(item.id);
      stateCounts[item.state] += 1;
    }
    report.taskInventory = { known: true, runs: progress.runIds.length, items: progress.items.length, states: stateCounts };
    report.checks.push('Installed Orca CLI returns a supported task inventory');
    const rows = Math.ceil(visualStates.length / 2);
    gallery = new BrowserWindow({ width: 700, height: 160 + rows * 190, show: false, useContentSize: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await gallery.loadFile(path.join(__dirname, 'preview.html')); await tick();
    fs.writeFileSync(path.join(output, 'all-states.png'), (await gallery.webContents.capturePage()).toPNG());
    assert.deepEqual(rendererErrors, []); report.checks.push('No renderer console errors');
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { gallery?.destroy(); win.destroy(); app.quit(); }
}
module.exports = { verify };
