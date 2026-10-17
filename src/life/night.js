/* Night-only fireflies and a rare shooting star. 144×72 integer pixels. No sound. */
(function (root) {
  const AMBER = '#ffe2a5';
  const PALE = '#fff1c9';
  const STAR = '#efe6d4';
  const FIREFLIES = [
    { x: 24, y: 20, color: AMBER, phase: 0.4 },
    { x: 52, y: 28, color: PALE, phase: 2.2 },
    { x: 86, y: 22, color: AMBER, phase: 4.0 }
  ];
  const STAR_PERIOD = 24;
  const STAR_DURATION = 0.7;

  function mod(value, period) {
    const wrapped = value % period;
    return wrapped < 0 ? wrapped + period : wrapped;
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function pixel(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }

  function drawFireflies(ctx, seconds, reduced) {
    for (let i = 0; i < FIREFLIES.length; i++) {
      const fly = FIREFLIES[i];
      if (reduced) {
        pixel(ctx, fly.x, fly.y, fly.color);
        continue;
      }
      // Mostly lit, with a short dark beat so the blink stays soft.
      if (mod(seconds * 0.35 + i * 0.8, 1) >= 0.72) continue;
      const x = clamp(fly.x + Math.round(Math.sin(seconds * 0.07 + fly.phase) * 8), 8, 100);
      const y = clamp(fly.y + Math.round(Math.cos(seconds * 0.05 + fly.phase) * 4), 16, 32);
      pixel(ctx, x, y, fly.color);
    }
  }

  function drawShootingStar(ctx, seconds) {
    const phase = mod(seconds, STAR_PERIOD);
    if (phase >= STAR_DURATION) return;
    const burst = Math.floor((seconds - phase) / STAR_PERIOD);
    const mix = Math.abs(burst);
    const length = 3 + (mix % 2);
    const shift = Math.min(3, Math.floor(phase / STAR_DURATION * 4));
    const startX = 4 + (mix * 7) % 90;
    const startY = 4 + (mix * 3) % 7;
    for (let i = 0; i < length; i++) {
      pixel(ctx, startX + shift + i, startY + shift + i, STAR);
    }
  }

  function draw(ctx, env) {
    if (!ctx || typeof ctx.fillRect !== 'function') return;
    const source = env && typeof env === 'object' ? env : {};
    if (source.night !== true || source.storm === true) return;
    const seconds = Number.isFinite(source.seconds) ? source.seconds : 0;
    const reduced = source.reducedMotion === true;
    drawFireflies(ctx, seconds, reduced);
    if (!reduced) drawShootingStar(ctx, seconds);
  }

  root.CozyNight = { draw };
})(typeof globalThis !== 'undefined' ? globalThis : this);
