// The registration poster, played on a real Nissl section. The output is written tile by tile: each tile's four
// corners map back into the misaligned source and only that footprint is read; tiles that miss the tissue become a
// constant background without reading anything. <canvas data-tiles data-src="section.webp" data-range="1.5,4.5">
(() => {
  'use strict';
  const canvas = document.querySelector('[data-tiles]');
  if (!canvas || !window.Story) return;
  const ctx = canvas.getContext('2d');
  const [b0, b1] = canvas.dataset.range.split(',').map(Number);
  const COLS = 9, ROWS = 11, SLOTS = 6;
  const ANGLE = (-16 * Math.PI) / 180;            // the simulated misalignment of the scan
  const SHIFT = [0.06, -0.04];                    // ... and its offset, as fractions of the section's size
  const BLUE = '140, 188, 255';
  const img = new Image();
  let tissue = null, progress = 0;

  img.onload = () => { tissue = measure(); draw(); };
  img.src = canvas.dataset.src;

  // which output tiles contain tissue (from the section's alpha)
  function measure() {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const a = g.getImageData(0, 0, c.width, c.height).data;
    const tw = c.width / COLS, th = c.height / ROWS, out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let q = 0; q < COLS; q++) {
        let n = 0;
        for (let y = Math.floor(r * th); y < Math.floor((r + 1) * th); y += 2) {
          for (let x = Math.floor(q * tw); x < Math.floor((q + 1) * tw); x += 2) if (a[(y * c.width + x) * 4 + 3] > 40) n++;
        }
        out.push(n > 6);
      }
    }
    return out;
  }

  // the page's rem in px: the stylesheet scales everything with it on large screens
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  function layout(W, H) {
    const sc = rem() / 16;
    const aspect = img.naturalWidth / img.naturalHeight, gap = Math.max(16, W * 0.025);
    if (W >= H * 0.9) {                           // side by side, right of the text column
      const big = Math.min(32, Math.max(16, Math.min(W / 90, H / 50)));            // the column's scale (--big in site.css)
      const x0 = Math.max(W * 0.44, Math.max(0, (W - 70 * big) / 2) + 31.25 * rem()), rw = W - x0 - gap;
      const pw = Math.min((rw - gap) / 2, H * 0.56 * aspect), ph = pw / aspect;
      const top = (H - ph) / 2 + 20 * sc;
      return { pw, ph, src: [x0 + (rw - 2 * pw - gap) / 2, top], out: [x0 + (rw - 2 * pw - gap) / 2 + pw + gap, top] };
    }
    const pw = Math.min((W - 3 * gap) / 2, H * 0.36 * aspect), ph = pw / aspect;   // phones: above the text
    const top = H * 0.17;
    return { pw, ph, src: [(W - 2 * pw - gap) / 2, top], out: [(W - 2 * pw - gap) / 2 + pw + gap, top] };
  }

  function label(text, x, y) {
    ctx.font = `500 ${(11 * rem() / 16).toFixed(1)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillStyle = '#a1a1a6';
    ctx.fillText(text, x, y);
  }

  function draw() {
    if (!tissue) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const L = layout(W, H), N = COLS * ROWS;
    const k = Math.min(N, Math.floor(progress * N + 1e-6));
    const s = L.pw / img.naturalWidth, tw = L.pw / COLS, th = L.ph / ROWS;
    const [sx, sy] = L.src, [ox, oy] = L.out;

    // where a point of the upright section lies in the misaligned source panel
    const cx = sx + L.pw / 2 + SHIFT[0] * L.pw, cy = sy + L.ph / 2 + SHIFT[1] * L.ph;
    const toSource = (u, v) => {
      const x = u - L.pw / 2, y = v - L.ph / 2;
      return [cx + x * Math.cos(ANGLE) - y * Math.sin(ANGLE), cy + x * Math.sin(ANGLE) + y * Math.cos(ANGLE)];
    };

    for (const [x, y] of [L.src, L.out]) {
      ctx.fillStyle = '#0c0c0f';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x - 0.5, y - 0.5, L.pw + 1, L.ph + 1, 10); ctx.fill(); ctx.stroke();
    }
    const sc = rem() / 16;
    label('SOURCE, AS SCANNED', sx, sy - 12 * sc);
    label('OUTPUT, TILE BY TILE', ox, oy - 12 * sc);

    // source: the section as it came off the scanner, rotated and shifted
    ctx.save();
    ctx.beginPath(); ctx.roundRect(sx, sy, L.pw, L.ph, 10); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(ANGLE);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, -L.pw / 2, -L.ph / 2, L.pw, L.ph);
    ctx.restore();

    // output: finished tiles; empty ones are written as a constant background
    let skipped = 0;
    for (let i = 0; i < k; i++) {
      const q = i % COLS, r = Math.floor(i / COLS);
      if (tissue[i]) {
        const iw = img.naturalWidth / COLS, ih = img.naturalHeight / ROWS;
        ctx.drawImage(img, q * iw, r * ih, iw, ih, ox + q * tw, oy + r * th, tw + 0.5, th + 0.5);
      } else {
        skipped++;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
        ctx.fillRect(ox + q * tw + 1, oy + r * th + 1, tw - 2, th - 2);
      }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    for (let q = 1; q < COLS; q++) { ctx.beginPath(); ctx.moveTo(ox + q * tw, oy); ctx.lineTo(ox + q * tw, oy + L.ph); ctx.stroke(); }
    for (let r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * th); ctx.lineTo(ox + L.pw, oy + r * th); ctx.stroke(); }

    // the tile being written, and its footprint in the source
    if (k < N && progress > 0) {
      const q = k % COLS, r = Math.floor(k / COLS);
      ctx.strokeStyle = `rgb(${BLUE})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + q * tw, oy + r * th, tw, th);
      const quad = [[q * tw, r * th], [(q + 1) * tw, r * th], [(q + 1) * tw, (r + 1) * th], [q * tw, (r + 1) * th]].map(([u, v]) => toSource(u, v));
      ctx.beginPath();
      quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = tissue[k] ? `rgba(${BLUE}, 0.22)` : 'rgba(255, 255, 255, 0.08)';
      ctx.fill(); ctx.stroke();
      // the bounded cache: a fixed set of slots, reused as tiles are read
      const y = sy + L.ph + 22 * sc;
      label('CACHE', sx, y + 9 * sc);
      for (let i = 0; i < SLOTS; i++) {
        const x = sx + (56 + i * 16) * sc;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, 11 * sc, 11 * sc);
        if (tissue[k] && i === k % SLOTS) { ctx.fillStyle = `rgb(${BLUE})`; ctx.fillRect(x, y, 11 * sc, 11 * sc); }
      }
    }
    label(`${k} / ${N} tiles · ${skipped} skipped`, ox, oy + L.ph + 31 * sc);
  }

  Story.onChange((b) => { progress = Math.max(0, Math.min(1, (b - b0) / (b1 - b0))); draw(); });
  addEventListener('resize', draw);
  if (document.fonts) document.fonts.ready.then(draw);
})();
