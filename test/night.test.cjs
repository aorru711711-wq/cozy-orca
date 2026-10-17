const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../src/life/night.js');
const { draw } = globalThis.CozyNight;

const AMBER = '#ffe2a5';
const PALE = '#fff1c9';
const STAR = '#efe6d4';
const FIREFLY = new Set([AMBER, PALE]);

function paint(env) {
  const rects = [];
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y, w, h) {
      if (x < 0 || y < 0 || w < 0 || h < 0 || x + w > 144 || y + h > 72) {
        throw new Error(`pixel outside the 144×72 grid: ${x},${y} ${w}×${h}`);
      }
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) {
        throw new Error(`non-integer pixel: ${x},${y} ${w}×${h}`);
      }
      const color = this.fillStyle;
      if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error(`color must be #rrggbb: ${color}`);
      rects.push({ x, y, w, h, color });
    }
  };
  draw(ctx, env);
  return rects;
}

function assertInside(rects) {
  for (const rect of rects) {
    assert.equal(rect.w, 1);
    assert.equal(rect.h, 1);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 144 && rect.y + rect.h <= 72);
  }
}

function tally(rects) {
  const fireflies = rects.filter(rect => FIREFLY.has(rect.color));
  const stars = rects.filter(rect => rect.color === STAR);
  const other = rects.filter(rect => !FIREFLY.has(rect.color) && rect.color !== STAR);
  return { fireflies, stars, other };
}

test('day and storm record nothing', () => {
  for (const seconds of [0, 0.2, 0.5, 12, 24.1, 48]) {
    assert.deepEqual(paint({ night: false, storm: false, seconds, reducedMotion: false }), []);
    assert.deepEqual(paint({ night: false, storm: true, seconds, reducedMotion: false }), []);
    assert.deepEqual(paint({ night: true, storm: true, seconds, reducedMotion: false }), []);
    assert.deepEqual(paint({ night: true, storm: true, seconds, reducedMotion: true }), []);
  }
});

test('a night frame has at most three fireflies and four star pixels', () => {
  let fewest = 3;
  let fullest = 0;
  const layouts = new Set();
  let sawStar = false;
  for (let step = 0; step <= 1600; step++) {
    const seconds = step / 20;
    const rects = paint({ night: true, storm: false, seconds, reducedMotion: false });
    assertInside(rects);
    const { fireflies, stars, other } = tally(rects);
    assert.equal(other.length, 0);
    assert.ok(fireflies.length <= 3);
    assert.ok(stars.length <= 4);
    assert.equal(rects.length, fireflies.length + stars.length);
    fewest = Math.min(fewest, fireflies.length);
    fullest = Math.max(fullest, fireflies.length);
    for (const fly of fireflies) {
      assert.ok(fly.x >= 8 && fly.x <= 100 && fly.y >= 16 && fly.y <= 32);
    }
    if (fireflies.length === 3) {
      layouts.add(fireflies.map(fly => `${fly.x},${fly.y}`).sort().join('|'));
    }
    if (stars.length === 0) continue;
    sawStar = true;
    assert.ok(stars.length === 3 || stars.length === 4);
    const ordered = stars.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(ordered[i].x, ordered[0].x + i);
      assert.equal(ordered[i].y, ordered[0].y + i);
    }
    for (const star of stars) {
      assert.ok(star.y >= 4 && star.y <= 16);
      assert.ok(star.x <= 103);
    }
  }
  assert.ok(fewest < 3);
  assert.equal(fullest, 3);
  assert.ok(sawStar);
  assert.ok(layouts.size > 1);
});

test('a shooting star lasts under a second and then stays gone for at least twenty seconds', () => {
  let runStart = null;
  let lastOn = null;
  let previousEnd = null;
  let gap = null;
  let bursts = 0;
  for (let step = 0; step <= 1400; step++) {
    const seconds = step / 20;
    const on = paint({ night: true, storm: false, seconds, reducedMotion: false })
      .some(rect => rect.color === STAR);
    if (on) {
      if (runStart == null) runStart = seconds;
      lastOn = seconds;
      continue;
    }
    if (runStart == null) continue;
    assert.ok(lastOn - runStart < 1);
    if (previousEnd != null) {
      const quiet = runStart - previousEnd;
      gap = gap == null ? quiet : Math.min(gap, quiet);
    }
    previousEnd = lastOn;
    bursts += 1;
    runStart = null;
  }
  assert.ok(bursts >= 2);
  assert.ok(gap >= 20);
});

test('reduced motion has no streak that moves between two calls', () => {
  const first = paint({ night: true, storm: false, seconds: 0.2, reducedMotion: true });
  const later = paint({ night: true, storm: false, seconds: 24.2, reducedMotion: true });
  assertInside(first);
  assertInside(later);
  assert.deepEqual(first, later);
  assert.equal(first.length, 3);
  assert.ok(first.every(rect => FIREFLY.has(rect.color) && rect.color !== STAR));
  assert.equal(first.filter(rect => rect.color === STAR).length, 0);
  assert.equal(later.filter(rect => rect.color === STAR).length, 0);
  const moved = paint({ night: true, storm: false, seconds: 40, reducedMotion: false })
    .filter(rect => FIREFLY.has(rect.color))
    .map(rect => `${rect.x},${rect.y}`)
    .sort();
  const held = first.map(rect => `${rect.x},${rect.y}`).sort();
  assert.notDeepEqual(moved, held);
});
