/* Occasional seagulls in the upper sky. Coordinates stay on the 144 × 72 grid.
   Night and storm draw nothing. There is no sound. */
(function (root) {
  const BODY = '#f4dfb7';
  const WING = '#d5bc9b';
  const SHADE = '#695060';
  // Mostly off the canvas. A bird is in the open sky for well under half the cycle.
  const ROUTE_START = -160;
  const ROUTE_SPAN = 480;
  const FLOCK = [
    { period: 120, offset: 0, altitude: 5 },
    { period: 180, offset: 100, altitude: 13 }
  ];

  function overlaps(x, y, w, h, left, top, width, height) {
    return x < left + width && x + w > left && y < top + height && y + h > top;
  }

  function stamp(ctx, x, y, w, h, color) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h)) return;
    if (w <= 0 || h <= 0) return;
    if (x < 0 || y < 0 || x + w > 144 || y + h > 72) return;
    if (y < 4 || y + h > 19) return;
    if (overlaps(x, y, w, h, 0, 0, 29, 13)) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function paintGull(ctx, x, y, frame) {
    if (frame === 0) {
      stamp(ctx, x + 1, y, 1, 1, WING);
      stamp(ctx, x + 5, y, 1, 1, WING);
      stamp(ctx, x + 2, y + 1, 2, 1, BODY);
      stamp(ctx, x, y + 2, 1, 1, SHADE);
      stamp(ctx, x + 6, y + 2, 1, 1, SHADE);
    } else {
      stamp(ctx, x + 2, y, 2, 1, BODY);
      stamp(ctx, x, y + 1, 2, 1, WING);
      stamp(ctx, x + 5, y + 1, 2, 1, WING);
      stamp(ctx, x + 2, y + 2, 1, 1, SHADE);
      stamp(ctx, x + 4, y + 2, 1, 1, SHADE);
    }
  }

  function inOpenSky(x, y) {
    return x >= 29 && y >= 4 && x + 7 <= 144 && y + 3 <= 19;
  }

  function wrapped(seconds, period) {
    let time = seconds % period;
    if (time < 0) time += period;
    return time;
  }

  function glideX(seconds, bird) {
    const time = wrapped(seconds + bird.offset, bird.period);
    return ROUTE_START + Math.floor(time / bird.period * ROUTE_SPAN);
  }

  function glideY(seconds, bird) {
    return bird.altitude + Math.round(Math.sin(seconds * 0.45));
  }

  function wingFrame(seconds) {
    const frame = Math.floor(seconds * 2) % 2;
    return frame < 0 ? frame + 2 : frame;
  }

  function draw(ctx, env) {
    if (!ctx || typeof ctx.fillRect !== 'function') throw new TypeError('CozyBirds.draw requires a 2D context');
    const source = env && typeof env === 'object' ? env : {};
    if (source.night === true || source.storm === true) return;
    if (source.reducedMotion === true) {
      paintGull(ctx, 36, 5, 0);
      paintGull(ctx, 70, 13, 0);
      return;
    }
    const seconds = Number.isFinite(source.seconds) ? source.seconds : 0;
    for (let i = 0; i < FLOCK.length; i++) {
      const bird = FLOCK[i];
      const x = glideX(seconds, bird);
      const y = glideY(seconds, bird);
      if (!inOpenSky(x, y)) continue;
      paintGull(ctx, x, y, wingFrame(seconds));
    }
  }

  root.CozyBirds = { draw };
})(typeof globalThis !== 'undefined' ? globalThis : this);
