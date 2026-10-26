// A scroll-scrubbed image sequence, the way Apple's product pages do it: pre-rendered frames drawn on a canvas,
// picked by the story's beat position. <canvas data-sequence="path/f{n}.webp" data-count="72" data-range="0.6,3.4">
// Optional data-after="a,b,f,o": after the story, between beat positions a and b, play back to frame f and fade the
// stage to opacity o, then hold there for the rest of the page.
(() => {
  'use strict';
  const canvas = document.querySelector('[data-sequence]');
  if (!canvas || !window.Story) return;
  const ctx = canvas.getContext('2d');
  const count = Number(canvas.dataset.count);
  const [b0, b1] = canvas.dataset.range.split(',').map(Number);
  const after = canvas.dataset.after && canvas.dataset.after.split(',').map(Number);
  const name = (i) => canvas.dataset.sequence.replace('{n}', String(i).padStart(3, '0'));
  const frames = new Array(count);
  let want = 0, shown = -1;

  function ready(i) { const f = frames[i]; return f && f.complete && f.naturalWidth > 0; }
  function nearest(i) {
    for (let d = 0; d < count; d++) {
      if (i - d >= 0 && ready(i - d)) return i - d;
      if (i + d < count && ready(i + d)) return i + d;
    }
    return -1;
  }

  function draw(force) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; force = true; }
    const j = nearest(want);
    if (j < 0 || (j === shown && !force)) return;
    shown = j;
    const img = frames[j];
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);        // cover the stage
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    canvas.classList.add('is-ready');
  }

  // load coarse to fine (every 16th frame, then every 8th, ...) so early scrubbing already has something to show
  function preload() {
    const order = [];
    for (let step = 16; step >= 1; step >>= 1) for (let i = 0; i < count; i += step) if (!order.includes(i)) order.push(i);
    let next = 0;
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => { if (Math.abs(i - want) <= Math.abs(shown - want)) draw(); pump(); };
      img.src = name(i);
      frames[i] = img;
    };
    for (let k = 0; k < 4; k++) pump();
  }

  const clamp = (x) => Math.max(0, Math.min(1, x));
  Story.onChange((b) => {
    let f = clamp((b - b0) / (b1 - b0)) * (count - 1);
    if (after) {
      const [a0, a1, back, dim] = after, u = clamp((b - a0) / (a1 - a0));
      f += (back - f) * u;
      canvas.parentElement.style.opacity = (1 + (dim - 1) * u).toFixed(3);
    }
    want = Math.round(f);
    draw();
  });
  addEventListener('resize', () => draw(true));
  preload();
})();
