const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('../src/scene.js');
const { draw, palette, GLYPHS: SCENE_GLYPHS } = globalThis.CozyScene;

const DAY_MS = 900000;
const SPARK_MS = 1800;
const WAKE_STEP_MS = 30000;

function parse(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function createCanvas() {
  const data = new Uint8ClampedArray(144 * 72 * 4);
  let fillStyle = '#000000';
  let globalAlpha = 1;
  const ctx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(value) { fillStyle = value; },
    get globalAlpha() { return globalAlpha; },
    set globalAlpha(value) { globalAlpha = value; },
    fillRect(x, y, w, h) {
      if (x < 0 || y < 0 || w < 0 || h < 0 || x + w > 144 || y + h > 72) {
        throw new Error(`pixel outside the 144×72 grid: ${x},${y} ${w}×${h}`);
      }
      const [r, g, b] = parse(fillStyle);
      const alpha = globalAlpha;
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = x0 + (w | 0);
      const y1 = y0 + (h | 0);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const index = (yy * 144 + xx) * 4;
          data[index] = Math.round(r * alpha + data[index] * (1 - alpha));
          data[index + 1] = Math.round(g * alpha + data[index + 1] * (1 - alpha));
          data[index + 2] = Math.round(b * alpha + data[index + 2] * (1 - alpha));
          data[index + 3] = 255;
        }
      }
    },
    fillText() { throw new Error('scene must not draw text labels'); }
  };
  return {
    ctx,
    data,
    pixel(x, y) {
      const index = (y * 144 + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    },
    count(hex) {
      const [r, g, b] = parse(hex);
      let total = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] === r && data[index + 1] === g && data[index + 2] === b) total += 1;
      }
      return total;
    },
    signature() { return crypto.createHash('sha1').update(data).digest('hex'); },
    bounds(hex) {
      const [r, g, b] = parse(hex);
      let minX = 144;
      let minY = 72;
      let maxX = -1;
      let maxY = -1;
      let n = 0;
      for (let y = 0; y < 72; y++) {
        for (let x = 0; x < 144; x++) {
          const index = (y * 144 + x) * 4;
          if (data[index] !== r || data[index + 1] !== g || data[index + 2] !== b) continue;
          n += 1;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      return { minX, minY, maxX, maxY, n };
    }
  };
}
function paint(display, time = 0, now = null) {
  const canvas = createCanvas();
  const previous = Date.now;
  if (now != null) Date.now = () => now;
  try { draw(canvas.ctx, display, time); }
  finally { Date.now = previous; }
  return canvas;
}
function air(a, b) {
  const rawX = Math.max(a.minX - b.maxX, b.minX - a.maxX);
  const rawY = Math.max(a.minY - b.maxY, b.minY - a.maxY);
  if (rawX <= 0 && rawY <= 0) return 0;
  return Math.max(rawX, rawY) - 1;
}
function same(hex, pixel) {
  assert.deepEqual(pixel, parse(hex));
}
function expectGlyph(canvas, digit, x, y) {
  const rows = SCENE_GLYPHS[digit];
  assert.ok(rows, `missing glyph ${digit}`);
  for (let gy = 0; gy < rows.length; gy++) {
    for (let gx = 0; gx < rows[gy].length; gx++) {
      if (rows[gy][gx] !== '1') continue;
      same(palette.digit, canvas.pixel(x + gx, y + gy));
    }
  }
}

test('legacy callers still draw a moving working scene and a static reduced scene', () => {
  const resting = paint({ kind: 'working' }, 0);
  const later = paint({ kind: 'working' }, 2);
  assert.notEqual(resting.signature(), later.signature());
  const stillA = paint({ kind: 'working', reducedMotion: true }, 0);
  const stillB = paint({ kind: 'working', reducedMotion: true }, 2);
  assert.equal(stillA.signature(), stillB.signature());
  assert.equal(resting.count(palette.badge), 0);
  assert.equal(resting.count(palette.flag), 0);
  assert.equal(resting.count(palette.flare), 0);
  same('#b59bad', resting.pixel(0, 0));
  same('#252338', resting.pixel(143, 71));
  same('#80708e', resting.pixel(10, 4));
  same('#f8d6ad', resting.pixel(108, 28));
});

test('every voyage state draws inside the grid without labels', () => {
  const kinds = ['working', 'waiting', 'paused', 'idle', 'finished', 'disconnected', 'unavailable'];
  const extras = [
    {},
    { crewCount: 0, sailingMs: 0 },
    { crewCount: 1, needsInput: true },
    { crewCount: 3, sailingMs: 120000, completedCount: 2, remainingCount: 4 },
    { crewCount: 8, sailingMs: DAY_MS / 2, completedCount: 6, remainingCount: 6 },
    { crewCount: 12, completedCount: 10, remainingCount: 9, hasError: true },
    { hasError: true, kind: 'waiting', needsInput: true },
    { completionAt: 5000, completionSerial: 2, completedCount: 1, remainingCount: 1 },
    { totalCount: 10, completedCount: 7 },
    { totalCount: 10, remainingCount: 4 },
    { reducedMotion: true, crewCount: 8, sailingMs: 999999, completedCount: 7, remainingCount: 8 }
  ];
  for (const kind of kinds) {
    for (const extra of extras) {
      const canvas = paint({ kind, ...extra }, 1.7, 8000);
      assert.equal(canvas.count(palette.flag) > 0, extra.hasError === true);
    }
  }
  paint(undefined, 0);
  paint({ kind: 'working', crewCount: -3, completedCount: 1.2, hasError: 'true' }, 0);
});

test('one, three, and eight crew are distinct and the eight berths do not overlap', () => {
  const frames = [1, 3, 8].map(crewCount => paint({
    kind: 'working', crewCount, reducedMotion: true, sailingMs: 0
  }, 0));
  const signatures = frames.map(frame => frame.signature());
  assert.equal(new Set(signatures).size, 3);
  frames.forEach((frame, index) => {
    const crew = [1, 3, 8][index];
    assert.deepEqual(palette.hats.filter(hat => frame.count(hat) > 0), palette.hats.slice(0, crew));
  });
  const masts = frames.map(frame => frame.count(palette.mast));
  assert.ok(masts[0] < masts[1] && masts[1] < masts[2], `mast pixels ${masts.join(', ')}`);
  const boxes = palette.hats.map(hat => frames[2].bounds(hat));
  boxes.forEach(box => assert.ok(box.n > 0));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(air(boxes[i], boxes[j]) >= 1, `sailors ${i} and ${j} overlap`);
    }
  }
  expectGlyph(frames[0], 1, 11, 4);
  expectGlyph(frames[2], 8, 11, 4);
  const idle = [1, 8].map(crewCount => paint({ kind: 'idle', crewCount, reducedMotion: true }));
  assert.ok(idle[0].count(palette.mast) < idle[1].count(palette.mast));
});

test('crew past eight groups at the stern and the anchor badge keeps the exact count', () => {
  const eight = paint({ kind: 'working', crewCount: 8, reducedMotion: true });
  const twelve = paint({ kind: 'working', crewCount: 12, reducedMotion: true });
  assert.equal(eight.count(palette.groupHat), 0);
  assert.ok(twelve.count(palette.groupHat) > 0);
  assert.deepEqual(palette.hats.filter(hat => twelve.count(hat) > 0), palette.hats);
  const stern = eight.bounds(palette.hats[0]);
  const group = twelve.bounds(palette.groupHat);
  assert.ok(air(stern, group) <= 8);
  assert.ok(air(twelve.bounds(palette.hats[6]), group) > 8);
  expectGlyph(twelve, 1, 11, 4);
  expectGlyph(twelve, 2, 16, 4);
  assert.equal(paint({ kind: 'working', reducedMotion: true }).count(palette.badge), 0);
  assert.ok(paint({ kind: 'idle', crewCount: 0, reducedMotion: true }).count(palette.badge) > 0);
  expectGlyph(paint({ kind: 'idle', crewCount: 0, reducedMotion: true }), 0, 11, 4);
});

test('sailing time lengthens the wake and moves a quiet day-night clock', () => {
  const fresh = paint({ kind: 'working', sailingMs: 0, reducedMotion: true });
  const seasoned = paint({ kind: 'working', sailingMs: 22 * WAKE_STEP_MS, reducedMotion: true });
  assert.notDeepEqual(fresh.pixel(20, 52), parse(palette.wake));
  same(palette.wake, seasoned.pixel(20, 52));
  same(palette.clock, fresh.pixel(130, 2));
  same('#80708e', paint({ kind: 'working', reducedMotion: true }).pixel(130, 2));
  same('#f8d6ad', fresh.pixel(133, 6));
  const night = paint({ kind: 'working', sailingMs: DAY_MS / 2, reducedMotion: true });
  same(palette.nightSky, night.pixel(10, 4));
  same(palette.moon, night.pixel(108, 28));
  assert.notDeepEqual(night.pixel(133, 6), parse('#f8d6ad'));
  assert.equal(fresh.signature(), paint({ kind: 'working', sailingMs: 0, reducedMotion: true }, 5).signature());
});

test('crates, buoys, and exact counters distinguish progress without inventing an unknown total', () => {
  const none = paint({ kind: 'working', reducedMotion: true });
  const some = paint({ kind: 'working', completedCount: 3, remainingCount: 2, reducedMotion: true });
  const full = paint({ kind: 'working', completedCount: 6, remainingCount: 6, reducedMotion: true });
  const over = paint({ kind: 'working', completedCount: 10, remainingCount: 9, reducedMotion: true });
  assert.equal(none.count(palette.crate), 0);
  assert.equal(none.count(palette.buoy), 0);
  assert.ok(some.count(palette.crate) < full.count(palette.crate));
  assert.ok(some.count(palette.buoy) < full.count(palette.buoy));
  assert.equal(full.count(palette.crate), over.count(palette.crate));
  assert.equal(full.count(palette.buoy), over.count(palette.buoy));
  assert.equal(full.count(palette.digit), 0);
  assert.ok(over.count(palette.digit) > 0);
  // completed "10" is right-aligned to x=116 with step 5 → glyphs at 108 and 113
  expectGlyph(over, 1, 108, 56);
  expectGlyph(over, 0, 113, 56);
  expectGlyph(over, 9, 8, 26);
  const derived = paint({ kind: 'working', totalCount: 10, completedCount: 7, reducedMotion: true });
  const buoys = paint({ kind: 'working', remainingCount: 3, reducedMotion: true });
  assert.equal(derived.count(palette.buoy), buoys.count(palette.buoy));
  const fromRemaining = paint({ kind: 'idle', totalCount: 10, remainingCount: 4, reducedMotion: true });
  const chests = paint({ kind: 'idle', completedCount: 6, reducedMotion: true });
  assert.equal(fromRemaining.count(palette.crate), chests.count(palette.crate));
  assert.equal(paint({ kind: 'working', remainingCount: null, reducedMotion: true }).count(palette.buoy), 0);
});

test('explicit failure is a storm and a red flag; waiting is a steady flare; unknown stays apart', () => {
  const working = paint({ kind: 'working', reducedMotion: true });
  const waiting = paint({ kind: 'waiting', needsInput: true, reducedMotion: true }, 0);
  const waitingLater = paint({ kind: 'waiting', needsInput: true, reducedMotion: true }, 4);
  const failed = paint({ kind: 'working', hasError: true, reducedMotion: true });
  const idle = paint({ kind: 'idle', reducedMotion: true });
  const lost = paint({ kind: 'disconnected', reducedMotion: true });
  const unknown = paint({ kind: 'unavailable', reducedMotion: true });
  assert.equal(waiting.signature(), waitingLater.signature());
  assert.ok(waiting.count(palette.flare) > 0);
  assert.equal(waiting.count(palette.flag), 0);
  assert.equal(working.count(palette.flare), 0);
  assert.ok(failed.count(palette.flag) > 0);
  assert.equal(failed.count(palette.flare), 0);
  same(palette.stormSky, failed.pixel(10, 4));
  same('#80708e', working.pixel(10, 4));
  assert.notEqual(failed.signature(), waiting.signature());
  assert.notEqual(failed.signature(), working.signature());
  same('#c9a085', idle.pixel(83, 42));
  same('#8ea0b0', lost.pixel(83, 42));
  same('#5a5468', unknown.pixel(83, 42));
  assert.equal(lost.count(palette.flag), 0);
  assert.equal(unknown.count(palette.flag), 0);
  assert.equal(paint({ kind: 'working', hasError: 1, reducedMotion: true }).count(palette.flag), 0);
});

test('a completion sparkles once and a horizon buoy passes, including while work continues', () => {
  const start = 1_700_000_000_000;
  const display = {
    kind: 'working', completedCount: 1, remainingCount: 2,
    completionAt: start, completionSerial: 4, reducedMotion: false
  };
  const early = paint(display, 0, start);
  const mid = paint(display, 0.4, start + SPARK_MS / 2);
  assert.ok(early.count(palette.gold) > 0);
  assert.ok(mid.bounds(palette.gold).minY < early.bounds(palette.gold).minY);
  assert.ok(mid.bounds(palette.passing).minX > early.bounds(palette.passing).minX);
  const reducedA = paint({ ...display, reducedMotion: true }, 0, start + 100);
  const reducedB = paint({ ...display, reducedMotion: true }, 6, start + SPARK_MS - 50);
  assert.equal(reducedA.signature(), reducedB.signature());
  assert.ok(reducedA.count(palette.gold) > 0);
  const done = paint(display, 3, start + SPARK_MS + 1);
  assert.equal(done.count(palette.gold), 0);
  assert.equal(done.count(palette.passing), 0);
  const quiet = paint({ ...display, completionSerial: 0 }, 0, start);
  assert.equal(quiet.count(palette.gold), 0);
  const alongside = paint({ ...display, hasError: true }, 0, start + 200);
  assert.ok(alongside.count(palette.gold) > 0);
  assert.ok(alongside.count(palette.flag) > 0);
});

test('the sun lays a warm path on the near water', () => {
  const calm = paint({ kind: 'working', reducedMotion: true }, 0);
  same('#f8d6ad', calm.pixel(110, 37));
  same('#ffe2a5', calm.pixel(114, 38));
  const again = paint({ kind: 'working', reducedMotion: true }, 4);
  assert.deepEqual(calm.pixel(114, 38), again.pixel(114, 38));
  const night = paint({ kind: 'working', reducedMotion: true, sailingMs: 500000 }, 0);
  same('#efe6d4', night.pixel(114, 38));
  const storm = paint({ kind: 'working', hasError: true, reducedMotion: true }, 0);
  assert.notDeepEqual(storm.pixel(114, 38), parse('#ffe2a5'));
});

test('storm rain falls along a fixed lane and stays still when motion is reduced', () => {
  const storm = { kind: 'working', hasError: true };
  const first = paint(storm, 0);
  const next = paint(storm, 1 / 12);
  const skyTop = first.pixel(2, 5);
  const skyMid = first.pixel(2, 9);
  assert.deepEqual(skyTop, parse(palette.stormSky));
  assert.notDeepEqual(first.pixel(7, 5), skyTop);
  assert.deepEqual(next.pixel(7, 5), skyTop);
  assert.deepEqual(first.pixel(7, 9), skyMid);
  assert.notDeepEqual(next.pixel(7, 9), skyMid);
  const stillA = paint({ ...storm, reducedMotion: true }, 0);
  const stillB = paint({ ...storm, reducedMotion: true }, 3);
  assert.equal(stillA.signature(), stillB.signature());
  for (let step = 0; step < 48; step++) paint(storm, step / 12);
  assert.equal(first.count('#ffffff'), 0);
  assert.equal(first.count('#c5ced8'), 0);
});

test('percent glyph exists and is not Z-shaped', () => {
  const percent = SCENE_GLYPHS['%'];
  assert.ok(Array.isArray(percent));
  assert.deepEqual(percent, ['101', '001', '010', '100', '101']);
  const zShaped = ['111', '001', '010', '100', '111'];
  assert.notDeepEqual(percent, zShaped);
  assert.notDeepEqual(percent, SCENE_GLYPHS['2']);
  assert.equal(percent[0].length, 3);
  assert.equal(percent.length, 5);
});

test('progress badges stay readable for small and large voyage counts', () => {
  const small = paint({ kind: 'working', completedCount: 7, remainingCount: 7, reducedMotion: true });
  const large = paint({ kind: 'working', completedCount: 100, remainingCount: 99, reducedMotion: true });
  // single-digit completed "7" right-aligned to 116 → glyph at 113
  expectGlyph(small, 7, 113, 56);
  expectGlyph(small, 7, 8, 26);
  // "100" width 13, left at 103; "99" left-aligned at 8 with step 5
  expectGlyph(large, 1, 103, 56);
  expectGlyph(large, 0, 108, 56);
  expectGlyph(large, 0, 113, 56);
  expectGlyph(large, 9, 8, 26);
  expectGlyph(large, 9, 13, 26);
  const smallDone = small.bounds(palette.digit);
  const largeDone = large.bounds(palette.digit);
  assert.ok(smallDone.maxX <= 115);
  assert.ok(largeDone.maxX <= 115);
  assert.equal(smallDone.maxX, largeDone.maxX);
  const crewWide = paint({ kind: 'idle', crewCount: 100, reducedMotion: true });
  expectGlyph(crewWide, 1, 11, 4);
  expectGlyph(crewWide, 0, 16, 4);
  expectGlyph(crewWide, 0, 21, 4);
  const remainingBadge = { minX: 7, maxX: 8 + 8, minY: 25, maxY: 32 };
  const completedBadge = { minX: 102, maxX: 117, minY: 55, maxY: 62 };
  assert.ok(air(remainingBadge, completedBadge) > 40);
});

test('idle clouds drift slower than working clouds', () => {
  const sunlit = '#dcb1ad';
  const time = 80;
  const idle = paint({ kind: 'idle', sailingMs: 0 }, time).bounds(sunlit);
  const working = paint({ kind: 'working', sailingMs: 0 }, time).bounds(sunlit);
  const origin = paint({ kind: 'idle', sailingMs: 0 }, 0).bounds(sunlit);
  assert.ok(idle.n > 0 && working.n > 0 && origin.n > 0);
  assert.ok(idle.minX < origin.minX, 'idle clouds should have drifted');
  assert.ok(working.minX < idle.minX, `working ${working.minX} should travel farther left than idle ${idle.minX}`);
  const idleTravel = origin.minX - idle.minX;
  const workTravel = origin.minX - working.minX;
  assert.ok(idleTravel < workTravel * 0.6, `idle travel ${idleTravel} vs working ${workTravel}`);
});

test('storm still skips the high cloud while idle calm does not apply', () => {
  const sunlit = '#dcb1ad';
  const stormTone = '#6a6578';
  const calm = paint({ kind: 'idle', sailingMs: 0, hasError: false }, 0);
  const storm = paint({ kind: 'idle', sailingMs: 0, hasError: true }, 0);
  assert.ok(calm.count(sunlit) > 0);
  assert.equal(calm.count(stormTone), 0);
  assert.ok(storm.count(stormTone) > 0);
  assert.equal(storm.count(sunlit), 0);
});

