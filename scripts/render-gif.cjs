/* Renders animated GIFs of the scene with no dependencies.
   Usage: node scripts/render-gif.cjs out.gif scene[,scene...] [scale] [seconds per scene] */
const fs = require('node:fs');
const path = require('node:path');
['life/birds.js', 'life/sparkles.js', 'life/night.js', 'scene.js'].forEach(f => require(path.join(__dirname, '..', 'src', f)));
const scene = globalThis.CozyScene;
const FPS = 12;
const base = { kind: 'working', crewCount: 1, sailingMs: 0, completedCount: 1, remainingCount: 1 };
const SCENES = {
  day1: base,
  day3: { ...base, crewCount: 3, completedCount: 4, remainingCount: 3, sailingMs: 300000 },
  night8: { ...base, crewCount: 8, sailingMs: 500000, completedCount: 2 },
  idle2: { ...base, kind: 'idle', crewCount: 2, sailingMs: 100000 },
  storm5: { ...base, hasError: true, crewCount: 5 }
};

function frame(state, t) {
  const data = new Uint8Array(144 * 72 * 3);
  let style = '#000';
  let alpha = 1;
  const ctx = {
    set fillStyle(v) { style = v; }, get fillStyle() { return style; },
    set globalAlpha(v) { alpha = v; }, get globalAlpha() { return alpha; },
    fillRect(x, y, w, h) {
      const c = [1, 3, 5].map(i => parseInt(style.slice(i, i + 2), 16));
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        const k = (j * 144 + i) * 3;
        for (let n = 0; n < 3; n++) data[k + n] = Math.round(c[n] * alpha + data[k + n] * (1 - alpha));
      }
    }
  };
  scene.draw(ctx, state, t);
  return data;
}

// Median-cut palette over every pixel colour in every frame.
function buildPalette(frames) {
  const counts = new Map();
  for (const f of frames) for (let k = 0; k < f.length; k += 3) {
    const key = (f[k] << 16) | (f[k + 1] << 8) | f[k + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let boxes = [[...counts.entries()].map(([key, n]) => ({ r: key >> 16, g: (key >> 8) & 255, b: key & 255, n }))];
  while (boxes.length < 256) {
    let pick = -1;
    let widest = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const ch of ['r', 'g', 'b']) {
        const vals = box.map(p => p[ch]);
        const range = Math.max(...vals) - Math.min(...vals);
        if (range > widest) { widest = range; pick = i; }
      }
    });
    if (pick < 0) break;
    const box = boxes[pick];
    const ch = ['r', 'g', 'b'].map(c => [c, Math.max(...box.map(p => p[c])) - Math.min(...box.map(p => p[c]))]).sort((a, b) => b[1] - a[1])[0][0];
    box.sort((a, b) => a[ch] - b[ch]);
    const half = box.reduce((s, p) => s + p.n, 0) / 2;
    let run = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) { run += box[i].n; cut = i + 1; if (run >= half) break; }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(box => {
    const total = box.reduce((s, p) => s + p.n, 0);
    return ['r', 'g', 'b'].map(c => Math.round(box.reduce((s, p) => s + p[c] * p.n, 0) / total));
  });
}

function lzw(indices, minBits) {
  const out = [];
  let cur = 0;
  let bits = 0;
  const clear = 1 << minBits;
  const end = clear + 1;
  let size = minBits + 1;
  let next = end + 1;
  let dict = new Map();
  const put = code => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) { out.push(cur & 255); cur >>= 8; bits -= 8; }
  };
  put(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    put(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << size) && size < 12) size++;
    } else {
      put(clear);
      dict = new Map();
      size = minBits + 1;
      next = end + 1;
    }
    prefix = k;
  }
  put(prefix);
  put(end);
  if (bits > 0) out.push(cur & 255);
  return out;
}

function encode(frames, palette, scale, delayCs) {
  const W = 144 * scale;
  const H = 72 * scale;
  const lookup = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let hit = lookup.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    palette.forEach((p, i) => {
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    lookup.set(key, best);
    return best;
  };
  const bytes = [];
  const u16 = v => bytes.push(v & 255, v >> 8);
  bytes.push(...Buffer.from('GIF89a'));
  u16(W); u16(H);
  bytes.push(0xf7, 0, 0);
  for (let i = 0; i < 256; i++) bytes.push(...(palette[i] || [0, 0, 0]));
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  for (const f of frames) {
    const small = new Uint8Array(144 * 72);
    for (let p = 0; p < small.length; p++) small[p] = nearest(f[p * 3], f[p * 3 + 1], f[p * 3 + 2]);
    const px = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = small[((y / scale) | 0) * 144 + ((x / scale) | 0)];
    bytes.push(0x21, 0xf9, 4, 0, delayCs & 255, delayCs >> 8, 0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(W); u16(H); bytes.push(0, 8);
    const data = lzw(px, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

const [out, names = 'day1', scaleArg = '3', secondsArg = '4'] = process.argv.slice(2);
if (!out) throw new Error('usage: render-gif.cjs out.gif scene[,scene] [scale] [seconds]');
const frames = [];
for (const name of names.split(',')) {
  if (!SCENES[name]) throw new Error(`unknown scene ${name}`);
  for (let i = 0; i < Number(secondsArg) * FPS; i++) frames.push(frame(SCENES[name], i / FPS));
}
const palette = buildPalette(frames);
const gif = encode(frames, palette, Number(scaleArg), Math.round(100 / FPS));
fs.writeFileSync(out, gif);
console.log(`${out}: ${frames.length} frames, ${palette.length} colours, ${(gif.length / 1024).toFixed(0)} KB`);
