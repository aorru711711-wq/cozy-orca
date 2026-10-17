const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../src/life/birds.js');

const BODY = '#f4dfb7';
const WING = '#d5bc9b';
const SHADE = '#695060';

function overlaps(x, y, w, h, left, top, width, height) {
  return x < left + width && x + w > left && y < top + height && y + h > top;
}

function record(env) {
  const rects = [];
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y, w, h) {
      rects.push([ctx.fillStyle, x, y, w, h]);
    }
  };
  globalThis.CozyBirds.draw(ctx, env);
  return rects;
}

function assertSky(rects) {
  assert.ok(rects.length <= 12);
  let bodies = 0;
  for (const [color, x, y, w, h] of rects) {
    assert.ok(color === BODY || color === WING || color === SHADE);
    assert.equal(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && Number.isInteger(h), true);
    assert.ok(w > 0 && h > 0);
    assert.ok(x >= 0 && y >= 0 && x + w <= 144 && y + h <= 72, `${x},${y} ${w}×${h}`);
    assert.ok(y >= 4 && y + h <= 19, `outside the sky band: ${y}`);
    assert.equal(overlaps(x, y, w, h, 0, 0, 29, 13), false);
    if (color === BODY) {
      bodies += 1;
      assert.equal(w, 2);
      assert.equal(h, 1);
    }
  }
  assert.ok(bodies <= 2);
}

test('night and storm record nothing, including while gulls would be crossing', () => {
  let busy = null;
  for (let step = 0; step <= 360; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, night: false, storm: false, reducedMotion: false });
    if (rects.length) {
      busy = seconds;
      break;
    }
  }
  assert.ok(busy != null);
  assert.deepEqual(record({ seconds: busy, night: true, storm: false, reducedMotion: false }), []);
  assert.deepEqual(record({ seconds: busy, night: false, storm: true, reducedMotion: false }), []);
  assert.deepEqual(record({ seconds: busy, night: true, storm: true, reducedMotion: true }), []);
});

test('two nearby seconds can change the wing or the glide', () => {
  let previous = null;
  let previousAt = -1;
  let changed = false;
  for (let step = 0; step <= 400; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, night: false, storm: false, reducedMotion: false });
    assertSky(rects);
    if (previous && previous.length && rects.length && JSON.stringify(previous) !== JSON.stringify(rects) && seconds - previousAt <= 1) {
      changed = true;
      break;
    }
    previous = rects;
    previousAt = seconds;
  }
  assert.equal(changed, true);
});

test('reduced motion keeps wing frame 0 at fixed positions', () => {
  const first = record({ seconds: 4, night: false, storm: false, reducedMotion: true });
  const second = record({ seconds: 80.5, night: false, storm: false, reducedMotion: true });
  assert.deepEqual(first, second);
  assertSky(first);
  assert.ok(first.some(rect => rect[0] === WING));
  assert.ok(first.some(rect => rect[0] === SHADE));
  assert.equal(first.filter(rect => rect[0] === BODY).length, 2);
});

test('crossings stay occasional and inside the open upper sky', () => {
  let seen = 0;
  const samples = 360;
  for (let seconds = 0; seconds < samples; seconds++) {
    const rects = record({ seconds, night: false, storm: false, reducedMotion: false });
    assertSky(rects);
    if (rects.length) seen += 1;
  }
  assert.ok(seen > 0);
  assert.ok(seen / samples < 0.4, `visible ${seen}/${samples}`);
});

test('a gull stays drawn while it crosses above the sun', () => {
  let crossed = false;
  for (let step = 0; step <= 720; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, night: false, storm: false, reducedMotion: false });
    assertSky(rects);
    if (rects.some(([, x, , w]) => x + w > 104 && x < 130)) crossed = true;
  }
  assert.equal(crossed, true);
});
