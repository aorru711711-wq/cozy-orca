const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen } = require('electron');
const { OrcaPoller } = require('./poller.cjs');
const { VoyageTracker } = require('./voyage.cjs');
const { placeWindow } = require('./geometry.cjs');

const ROOT = path.resolve(__dirname, '..');
const VERIFY = process.argv.includes('--verify');
const dataRoot = process.env.COZY_DATA_DIR || (app.isPackaged
  ? path.join(path.dirname(process.execPath), 'data') : path.join(ROOT, 'data'));
if (!/^E:[\\/]/i.test(dataRoot)) throw new Error('Cozy Orca stores its data on E:. Set COZY_DATA_DIR to an E: folder.');
const dataDir = VERIFY ? path.join(dataRoot, 'verification') : dataRoot;
fs.mkdirSync(dataDir, { recursive: true });
for (const name of ['userData', 'sessionData', 'logs', 'crashDumps', 'temp']) {
  const location = path.join(dataDir, name);
  fs.mkdirSync(location, { recursive: true });
  app.setPath(name, location);
}
app.commandLine.appendSwitch('disk-cache-dir', path.join(dataDir, 'cache'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
const settingsFile = path.join(dataDir, 'settings.json');
const voyageFile = path.join(dataDir, 'voyage.json');
const VOYAGE_SAVE_MS = 15000;
let settings = { scale: 2, reducedMotion: false, position: null };
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  settings = { scale: [2, 3, 4].includes(saved.scale) ? saved.scale : 2,
    reducedMotion: saved.reducedMotion === true, position: saved.position || null };
} catch { /* Missing or damaged settings fall back to safe defaults. */ }
let win, tray, poller, saveTimer, voyageTimer;
let voyageDirty = false;
let status = {
  kind: 'unavailable', label: 'Connecting', needsInput: false, hasError: false, glowUntil: 0,
  reason: 'Connecting to Orca', crewCount: 0, sailingMs: 0, completedCount: 0, totalCount: null,
  remainingCount: null, completionSerial: 0, completionAt: 0
};
let quitting = false;

function readVoyageState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(voyageFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed;
  } catch { return undefined; }
}
function loadVoyageTracker() {
  const saved = readVoyageState();
  try { return new VoyageTracker(saved); }
  catch (error) {
    console.error('Could not restore voyage:', error.message);
    return new VoyageTracker();
  }
}
const voyageTracker = loadVoyageTracker();
let lastSerialized = '';
try { lastSerialized = JSON.stringify(voyageTracker.serialize()); }
catch (error) { console.error('Could not read voyage state:', error.message); }
function restoredSailingMs() {
  try {
    const state = voyageTracker.serialize();
    if (state && Number.isFinite(state.sailingMs) && state.sailingMs >= 0) return state.sailingMs;
  } catch { /* The first poll fills sailing time. */ }
  return 0;
}
status.sailingMs = restoredSailingMs();

function persist() {
  try {
    fs.writeFileSync(`${settingsFile}.tmp`, JSON.stringify(settings, null, 2));
    fs.renameSync(`${settingsFile}.tmp`, settingsFile);
  } catch (error) { console.error('Could not save widget settings:', error.message); }
}
function persistVoyage() {
  let body;
  try {
    const state = voyageTracker.serialize();
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Voyage state is not a plain object');
    body = JSON.stringify(state, null, 2);
    fs.writeFileSync(`${voyageFile}.tmp`, body);
    fs.renameSync(`${voyageFile}.tmp`, voyageFile);
    voyageDirty = false;
    lastSerialized = JSON.stringify(state);
  } catch (error) {
    console.error('Could not save voyage:', error.message);
    if (!quitting && !voyageTimer) {
      voyageTimer = setTimeout(() => { voyageTimer = null; if (voyageDirty) persistVoyage(); }, VOYAGE_SAVE_MS);
    }
  }
}
function scheduleVoyageSave() {
  let body;
  try {
    const state = voyageTracker.serialize();
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    body = JSON.stringify(state);
  } catch (error) {
    console.error('Could not serialize voyage:', error.message);
    return;
  }
  if (body === lastSerialized) return;
  lastSerialized = body;
  voyageDirty = true;
  if (voyageTimer) return;
  voyageTimer = setTimeout(() => { voyageTimer = null; if (voyageDirty) persistVoyage(); }, VOYAGE_SAVE_MS);
}
function countOf(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
function totalOf(value) {
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}
function sanitizeDisplay(snapshot, reducedMotion) {
  // Agent prompts, tool inputs, task specs, and raw CLI responses never cross this boundary.
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const kinds = ['working', 'waiting', 'paused', 'idle', 'finished', 'disconnected', 'unavailable'];
  const kind = kinds.includes(source.kind) ? source.kind : 'unavailable';
  return {
    kind,
    label: typeof source.label === 'string' ? source.label.slice(0, 80) : 'Connecting',
    reason: typeof source.reason === 'string' ? source.reason.slice(0, 240) : '',
    needsInput: source.needsInput === true,
    hasError: source.hasError === true,
    glowUntil: Number.isFinite(source.glowUntil) ? source.glowUntil : 0,
    reducedMotion: reducedMotion === true,
    crewCount: countOf(source.crewCount),
    sailingMs: Number.isFinite(source.sailingMs) && source.sailingMs >= 0 ? source.sailingMs : 0,
    completedCount: countOf(source.completedCount),
    totalCount: totalOf(source.totalCount),
    remainingCount: totalOf(source.remainingCount),
    completionSerial: countOf(source.completionSerial),
    completionAt: Number.isFinite(source.completionAt) && source.completionAt > 0 ? source.completionAt : 0
  };
}
function applyVoyage(next) {
  const base = next && typeof next === 'object' ? next : {};
  let tracked = base;
  try {
    const updated = voyageTracker.update(base, Date.now());
    if (updated && typeof updated === 'object') tracked = updated;
  } catch (error) { console.error('Voyage update failed:', error.message); }
  status = tracked;
  if (!Number.isFinite(status.glowUntil)) status.glowUntil = Number.isFinite(base.glowUntil) ? base.glowUntil : 0;
  scheduleVoyageSave();
}
function sendDisplay() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('display', sanitizeDisplay(status, settings.reducedMotion));
  tray?.setToolTip(`Cozy Orca — ${typeof status.label === 'string' ? status.label : 'Cozy Orca'}`);
}
function position(reset = false) {
  const bounds = placeWindow(reset ? null : settings.position, settings.scale, screen.getAllDisplays(), screen.getPrimaryDisplay());
  win.setBounds(bounds);
  settings.position = { x: bounds.x, y: bounds.y };
  persist();
}
function show() { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); }
function menuTemplate() {
  return [
    { label: `Cozy Orca · ${status.label}`, enabled: false },
    { type: 'separator' },
    { label: win.isVisible() ? 'Hide companion' : 'Show companion', click: () => win.isVisible() ? win.hide() : show() },
    { label: 'Size', submenu: [2, 3, 4].map(scale => ({ label: `${scale}× · ${144 * scale} × ${72 * scale}`,
      type: 'radio', checked: settings.scale === scale, click() { settings.scale = scale; position(); } })) },
    { label: 'Reduced motion', type: 'checkbox', checked: settings.reducedMotion,
      click(item) { settings.reducedMotion = item.checked; persist(); sendDisplay(); } },
    { label: 'Reset to bottom-right', click: () => { position(true); show(); } },
    { type: 'separator' },
    { label: 'Reload', click() { app.relaunch(); app.quit(); } },
    { label: 'Quit Cozy Orca', click: () => app.quit() }
  ];
}
function popup() { Menu.buildFromTemplate(menuTemplate()).popup({ window: win }); }
function trayImage() {
  // Small original sailboat drawn directly as an RGBA tray bitmap.
  const pixels = Buffer.alloc(32 * 32 * 4);
  const rect = (x, y, w, h, rgb) => {
    for (let iy = y; iy < y + h; iy++) for (let ix = x; ix < x + w; ix++) {
      const offset = (iy * 32 + ix) * 4;
      pixels[offset] = rgb[2]; pixels[offset + 1] = rgb[1]; pixels[offset + 2] = rgb[0]; pixels[offset + 3] = 255;
    }
  };
  for (let y = 5; y < 22; y++) rect(15 - Math.floor((y - 5) * .6), y, Math.floor((y - 5) * .6) + 1, 1, [244, 223, 183]);
  rect(17, 4, 1, 22, [212, 161, 123]); rect(5, 25, 23, 2, [212, 161, 123]);
  rect(8, 27, 17, 2, [164, 116, 98]); rect(11, 30, 10, 1, [139, 129, 159]);
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 1 });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) show(); });
  app.whenReady().then(async () => {
    const bounds = placeWindow(settings.position, settings.scale, screen.getAllDisplays(), screen.getPrimaryDisplay());
    win = new BrowserWindow({ ...bounds, frame: false, thickFrame: false, roundedCorners: false,
      resizable: false, maximizable: false,
      fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      backgroundColor: '#302d47', autoHideMenuBar: true, title: 'Cozy Orca',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, devTools: VERIFY } });
    win.setMenu(null);
    // A borderless Windows drag region gets native non-client right-clicks,
    // rather than DOM contextmenu events. Without a thick frame Windows does
    // not consistently raise Electron's system-context-menu event.
    if (process.platform === 'win32') win.hookWindowMessage(0x00A5, () => popup()); // WM_NCRBUTTONUP
    else win.on('system-context-menu', event => { event.preventDefault(); popup(); });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    tray = new Tray(trayImage());
    tray.setToolTip('Cozy Orca — Connecting');
    tray.on('click', () => { if (win.isVisible()) win.hide(); else show(); });
    tray.on('right-click', popup);
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    win.on('move', () => {
      const { x, y } = win.getBounds();
      settings.position = { x, y };
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 250);
    });
    screen.on('display-removed', () => position());
    screen.on('display-metrics-changed', () => position());
    ipcMain.on('display-ready', event => { if (event.sender === win.webContents) sendDisplay(); });
    ipcMain.on('show-menu', event => { if (event.sender === win.webContents) popup(); });
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (VERIFY) {
      try { await require('./verify.cjs').verify({ app, win, screen, settings, dataDir, position, show, menuTemplate, sendDisplay }); }
      catch (error) { console.error(error); app.exit(1); }
      return;
    }
    show();
    poller = new OrcaPoller({ executable: process.env.COZY_ORCA_CLI || 'E:\\Applications\\Orca\\resources\\bin\\orca.exe',
      onStatus(next) { applyVoyage(next); sendDisplay(); } });
    poller.start();
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on('before-quit', () => {
  quitting = true;
  clearTimeout(saveTimer);
  clearTimeout(voyageTimer);
  voyageTimer = null;
  poller?.stop();
  persist();
  if (voyageDirty) persistVoyage();
  tray?.destroy();
});
app.on('window-all-closed', () => { if (quitting) app.quit(); });
