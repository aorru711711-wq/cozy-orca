/* Five one-pixel sparkles on open water. They twinkle by being absent. No sound. */
(function (root) {
  const specks = [
    { x: 12, y: 43, rare: false },
    { x: 33, y: 50, rare: false },
    { x: 114, y: 45, rare: false },
    { x: 131, y: 53, rare: false },
    { x: 70, y: 64, rare: true }
  ];

  function colorFor(speck, env) {
    if (env.storm === true) return '#8a8494';
    if (env.night === true) return speck.rare ? '#efe6d4' : '#8d88a4';
    return speck.rare ? '#fff6d2' : '#d5b0a4';
  }

  function visible(index, env) {
    if (env.reducedMotion === true) return index % 2 === 0;
    const seconds = Number.isFinite(env.seconds) ? env.seconds : 0;
    const frame = Math.floor(seconds);
    return (frame + index * 2) % 3 !== 0;
  }

  function draw(ctx, env) {
    const view = env && typeof env === 'object' ? env : {};
    for (let i = 0; i < specks.length; i++) {
      if (!visible(i, view)) continue;
      const speck = specks[i];
      ctx.fillStyle = colorFor(speck, view);
      ctx.fillRect(speck.x, speck.y, 1, 1);
    }
  }

  root.CozySparkles = { draw };
})(typeof globalThis !== 'undefined' ? globalThis : this);
