const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../src/life/sparkles.js');

const { draw } = globalThis.CozySparkles;

function paint(env) {
  const rects = [];
  let fillStyle = '#000000';
  const ctx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(value) { fillStyle = value; },
    fillRect(x, y, w, h) {
      rects.push({ x, y, w, h, fillStyle });
    }
  };
  draw(ctx, env);
  return rects;
}

function mark(rects) {
  return rects.map(rect => rect.x + ',' + rect.y).sort().join('|');
}

function assertSpeck(rect) {
  assert.equal(rect.w, 1);
  assert.equal(rect.h, 1);
  assert.equal(Number.isInteger(rect.x), true);
  assert.equal(Number.isInteger(rect.y), true);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 144 && rect.y + rect.h <= 72);
  const onHull = rect.x >= 46 && rect.x <= 100 && rect.y >= 38 && rect.y <= 56;
  assert.equal(onHull, false);
  assert.ok(rect.y >= 40 && rect.y <= 68);
  const side = (rect.x >= 4 && rect.x <= 40) || (rect.x >= 108 && rect.x <= 138);
  const lower = rect.y >= 58 && rect.y <= 68;
  assert.ok(side || lower);
  assert.match(rect.fillStyle, /^#[0-9a-f]{6}$/);
}

test('sparkles stay at most five one-pixel specks inside the sea and off the hull', () => {
  let dayGold = 0;
  let nightGold = 0;
  for (const night of [false, true]) {
    for (const storm of [false, true]) {
      for (let seconds = 0; seconds < 9; seconds += 1) {
        const rects = paint({ seconds, night, storm, reducedMotion: false });
        assert.ok(rects.length <= 5);
        rects.forEach(assertSpeck);
        const colors = rects.map(rect => rect.fillStyle);
        if (storm) {
          assert.ok(colors.every(color => color === '#8a8494'));
          assert.equal(colors.includes('#fff6d2'), false);
          assert.equal(colors.includes('#efe6d4'), false);
        } else if (night) {
          assert.ok(colors.every(color => color === '#8d88a4' || color === '#efe6d4'));
          const rare = colors.filter(color => color === '#efe6d4').length;
          assert.ok(rare <= 1);
          nightGold += rare;
        } else {
          assert.ok(colors.every(color => color === '#d5b0a4' || color === '#fff6d2'));
          const rare = colors.filter(color => color === '#fff6d2').length;
          assert.ok(rare <= 1);
          dayGold += rare;
        }
      }
    }
  }
  assert.ok(dayGold >= 1);
  assert.ok(nightGold >= 1);
});

test('two different seconds can change which specks exist', () => {
  const early = paint({ seconds: 0, night: false, storm: false, reducedMotion: false });
  const later = paint({ seconds: 1, night: false, storm: false, reducedMotion: false });
  assert.notEqual(mark(early), mark(later));
  assert.ok(early.length <= 5 && later.length <= 5);
});

test('reduced motion is identical across two calls', () => {
  const still = { night: false, storm: false, reducedMotion: true };
  const first = paint({ ...still, seconds: 0 });
  const second = paint({ ...still, seconds: 5 });
  assert.deepEqual(first, second);
  assert.ok(first.length <= 5);
  first.forEach(assertSpeck);
  const again = paint({ ...still, seconds: 5 });
  assert.deepEqual(second, again);
});
