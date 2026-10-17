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
    const rects = record({ seconds, kind: 'idle', night: false, storm: false, reducedMotion: false });
    if (rects.length) {
      busy = seconds;
      break;
    }
  }
  assert.ok(busy != null);
  assert.deepEqual(record({ seconds: busy, kind: 'idle', night: true, storm: false, reducedMotion: false }), []);
  assert.deepEqual(record({ seconds: busy, kind: 'idle', night: false, storm: true, reducedMotion: false }), []);
  assert.deepEqual(record({ seconds: busy, kind: 'idle', night: true, storm: true, reducedMotion: true }), []);
});

test('working draws no gulls even when idle would show them', () => {
  let busy = null;
  for (let step = 0; step <= 720; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, kind: 'idle', night: false, storm: false, reducedMotion: false });
    if (rects.length) {
      busy = seconds;
      break;
    }
  }
  assert.ok(busy != null);
  assert.deepEqual(record({ seconds: busy, kind: 'working', night: false, storm: false, reducedMotion: false }), []);
  assert.deepEqual(record({ seconds: busy, kind: 'working', night: false, storm: false, reducedMotion: true }), []);
});

test('resting kinds keep up to two gulls in the open sky', () => {
  for (const kind of ['idle', 'paused', 'finished', 'waiting']) {
    let seen = 0;
    for (let seconds = 0; seconds < 400; seconds++) {
      const rects = record({ seconds, kind, night: false, storm: false, reducedMotion: false });
      assertSky(rects);
      if (rects.length) seen += 1;
    }
    assert.ok(seen > 0, `${kind} never showed a gull`);
  }
});

test('two nearby seconds can change the wing or the glide', () => {
  let previous = null;
  let previousAt = -1;
  let changed = false;
  for (let step = 0; step <= 600; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, kind: 'idle', night: false, storm: false, reducedMotion: false });
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

test('idle glide stays slower than about three pixels per half-second', () => {
  let previousX = null;
  let previousAt = null;
  let maxStep = 0;
  let samples = 0;
  for (let step = 0; step <= 900; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, kind: 'idle', night: false, storm: false, reducedMotion: false });
    const bodies = rects.filter(rect => rect[0] === BODY).map(rect => rect[1]).sort((a, b) => a - b);
    if (bodies.length !== 1) {
      previousX = null;
      previousAt = null;
      continue;
    }
    const x = bodies[0];
    if (previousX != null && previousAt != null && seconds - previousAt === 0.5) {
      const stepPx = x - previousX;
      // Only measure a continuous rightward glide of the same lone gull.
      if (stepPx >= 0 && stepPx <= 8) {
        samples += 1;
        if (stepPx > maxStep) maxStep = stepPx;
      } else {
        previousX = null;
        previousAt = null;
        continue;
      }
    }
    previousX = x;
    previousAt = seconds;
  }
  assert.ok(samples > 10);
  assert.ok(maxStep > 0);
  assert.ok(maxStep <= 3, `idle step ${maxStep}px was too brisk`);
});

test('reduced motion keeps wing frame 0 at fixed positions', () => {
  const first = record({ seconds: 4, kind: 'idle', night: false, storm: false, reducedMotion: true });
  const second = record({ seconds: 80.5, kind: 'idle', night: false, storm: false, reducedMotion: true });
  assert.deepEqual(first, second);
  assertSky(first);
  assert.ok(first.some(rect => rect[0] === WING));
  assert.ok(first.some(rect => rect[0] === SHADE));
  assert.equal(first.filter(rect => rect[0] === BODY).length, 2);
});

test('crossings stay occasional and inside the open upper sky', () => {
  let seen = 0;
  const samples = 400;
  for (let seconds = 0; seconds < samples; seconds++) {
    const rects = record({ seconds, kind: 'idle', night: false, storm: false, reducedMotion: false });
    assertSky(rects);
    if (rects.length) seen += 1;
  }
  assert.ok(seen > 0);
  // Idle keeps gulls present often enough to feel alive, without filling the sky.
  assert.ok(seen / samples < 0.55, `visible ${seen}/${samples}`);
});

test('a gull stays drawn while it crosses above the sun', () => {
  let crossed = false;
  for (let step = 0; step <= 900; step++) {
    const seconds = step / 2;
    const rects = record({ seconds, kind: 'idle', night: false, storm: false, reducedMotion: false });
    assertSky(rects);
    if (rects.some(([, x, , w]) => x + w > 104 && x < 130)) crossed = true;
  }
  assert.equal(crossed, true);
});
