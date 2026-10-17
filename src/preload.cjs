const { contextBridge, ipcRenderer } = require('electron');

const DISPLAY_FIELDS = [
  'kind', 'label', 'reason', 'needsInput', 'hasError', 'glowUntil', 'reducedMotion',
  'crewCount', 'sailingMs', 'completedCount', 'totalCount', 'remainingCount',
  'completionSerial', 'completionAt'
];

function presentDisplay(state) {
  const source = state && typeof state === 'object' ? state : {};
  const next = {};
  for (const key of DISPLAY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value == null) {
      if (key === 'totalCount' || key === 'remainingCount') next[key] = null;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') next[key] = value;
  }
  return next;
}

contextBridge.exposeInMainWorld('cozyOrca', {
  onDisplay(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(presentDisplay(state));
    ipcRenderer.on('display', listener);
    return () => ipcRenderer.removeListener('display', listener);
  },
  ready: () => ipcRenderer.send('display-ready'),
  menu: () => ipcRenderer.send('show-menu')
});
