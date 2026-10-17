const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placeWindow } = require('../src/geometry.cjs');
const primary = { workArea: { x: 0, y: 0, width: 2560, height: 1390 } };
const left = { workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
test('starts 16 DIPs inside the usable screen, above the taskbar', () => {
  assert.deepEqual(placeWindow(null, 2, [primary], primary), { x: 2256, y: 1230, width: 288, height: 144 });
});
test('restores positions on negative-coordinate monitors', () => {
  assert.equal(placeWindow({ x: -1000, y: 500 }, 3, [primary, left], primary).x, -1000);
});
test('removed displays and enlarged windows return fully onto the screen', () => {
  assert.equal(placeWindow({ x: -1000, y: 500 }, 2, [primary], primary).x, 2256);
  const enlarged = placeWindow({ x: 2256, y: 1230 }, 4, [primary], primary);
  assert.deepEqual(enlarged, { x: 1968, y: 1086, width: 576, height: 288 });
});
test('corrupt or nonnumeric positions fall back to bottom-right', () => {
  assert.equal(placeWindow({ x: '20', y: NaN }, 2, [primary], primary).x, 2256);
});
