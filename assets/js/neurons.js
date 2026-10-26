// neurons.js: the living background. Neurons with branching dendrites, joined by curved axons into one connected
// network. Signals circulate through it without stopping: each travels to the end of its axon, the neuron there
// lights up, and after a short synaptic pause the signal fires on along another connection, preferring neurons that
// have been quiet longest, so activity spreads evenly over the whole network. A neuron left quiet too long fires on
// its own. Now and then a signal
// branches into a short cascade, and neurons near the pointer send out signals of their own. The network is drawn
// once; only the signals and the paths they light redraw each frame.
(() => {
  'use strict';
  const holder = document.querySelector('[data-neurons]');
  if (!holder) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const base = document.createElement('canvas');
  const live = document.createElement('canvas');
  holder.append(base, live);
  const bx = base.getContext('2d');
  const lx = live.getContext('2d');

  const SPIKE = [255, 196, 140];                 // the travelling signal: warm, against the violet network
  let W = 0, H = 0, dpr = 1, S = 2, neurons = [], edges = [], signals = [], resident = 0, glow, glowV, glowB, running = false, last = 0;
  const BLEED = 12;                              // the layer is a little larger than the screen, so its slow float never shows an edge
  const pointer = { x: -1e4, y: -1e4, cx: -1e4, cy: -1e4, on: false };
  let drift = [0, 0], clock = 0;

  // a new network on every visit (fix one with ?seed=123); a resize keeps the visit's layout
  const SEED = Number(new URLSearchParams(location.search).get('seed')) || crypto.getRandomValues(new Uint32Array(1))[0];
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dendrite(x, y, angle, length, depth, rand, out, wiggle = 0.7) {
    const pts = [[x, y]];
    let a = angle, px = x, py = y;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * wiggle;
      px += Math.cos(a) * length / steps;
      py += Math.sin(a) * length / steps;
      pts.push([px, py]);
      if (depth < 2 && i === 2 && rand() < 0.55) {
        dendrite(px, py, a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5), length * 0.55, depth + 1, rand, out);
      }
    }
    out.push({ pts, w: (depth === 0 ? 1.1 : 0.7) * S });
  }

  function connect(n, m, rand) {
    const d = Math.hypot(m.x - n.x, m.y - n.y);
    const ux = (m.x - n.x) / d, uy = (m.y - n.y) / d;
    const sx = n.x + ux * n.r * 1.2, sy = n.y + uy * n.r * 1.2;
    const ex = m.x - ux * m.r * 1.2, ey = m.y - uy * m.r * 1.2;
    const bend = (rand() - 0.5) * 0.75 * d;
    const cx = (sx + ex) / 2 - uy * bend, cy = (sy + ey) / 2 + ux * bend;
    const pts = [], len = [0];
    for (let s = 0; s <= 32; s++) {
      const t = s / 32, it = 1 - t;
      pts.push([it * it * sx + 2 * it * t * cx + t * t * ex, it * it * sy + 2 * it * t * cy + t * t * ey]);
      if (s) len.push(len[s - 1] + Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]));
    }
    const e = { a: n, b: m, pts, len, total: len[len.length - 1], heat: 0 };
    edges.push(e);
    n.links.push(e);
    m.links.push(e);
  }

  function build() {
    W = holder.clientWidth; H = holder.clientHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [base, live]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    // size of a neuron: big enough to read as a cell, and growing with the page's rem on large screens
    const k = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
    S = (W >= 768 ? 2.1 : 1.6) * k;
    const rand = rng(SEED);
    // Laid out like a patch of cerebral cortex, following the anatomy literature:
    //  - layers: neuron density changes with depth below the pial surface. Layer 1 is nearly cell-free (mostly
    //    dendrites and axons), layers 2 to 6 are dense, and the white matter below holds almost no neurons;
    //  - minicolumns: neurons line up in loose radial strands, perpendicular to the surface;
    //  - cell types: pyramidal cells are the majority, with an apical dendrite pointing to the surface; inhibitory
    //    interneurons (roughly 20-30%) are smaller, with dendrites in all directions;
    //  - wiring: mostly local, the chance of a connection falling with distance, plus a few long-range axons.
    // Every visit draws a new fold, angle, column pattern and set of cells.
    const mx = W * 0.14, my = H * 0.14, FW = W + 2 * mx, FH = H + 2 * my;
    const count = Math.round(Math.max(26, Math.min(80, (FW * FH) / (23000 * k * k))));
    const spacing = Math.sqrt((FW * FH) / count);
    const gap = 28 * S;                                            // somas never overlap
    const ang = (rand() - 0.5) * 0.7 + (rand() < 0.5 ? 0 : Math.PI); // the surface runs roughly across the screen
    const tx = Math.cos(ang), ty = Math.sin(ang), nx = -ty, ny = tx;  // along the surface, and down into the cortex
    const thick = (1 + rand() * 0.45) * H;                           // cortical thickness on screen
    const folds = [0, 1].map(() => ({ A: (0.05 + rand() * 0.12) * H, k: (2 * Math.PI) / ((0.7 + rand() * 1.1) * W), p: rand() * 6.3 }));
    const fold = (u) => folds.reduce((s, f) => s + f.A * Math.sin(f.k * u + f.p), 0);
    const slope = (u) => folds.reduce((s, f) => s + f.A * f.k * Math.cos(f.k * u + f.p), 0);
    const edgeDepth = (-0.06 + rand() * 0.16) * H;                  // depth at the screen edge where the surface lies
    const reach = (Math.abs(nx) * W + Math.abs(ny) * H) / 2;
    const where = (x, y) => {                                        // position along the surface, and depth below it
      const u = (x - W / 2) * tx + (y - H / 2) * ty;
      return [u, (x - W / 2) * nx + (y - H / 2) * ny + reach + edgeDepth - fold(u)];
    };
    const PROFILE = [[-0.02, 0], [0, 0.04], [0.09, 0.07], [0.13, 0.9], [0.34, 0.95], [0.4, 1], [0.47, 0.62],
      [0.68, 0.6], [0.74, 0.85], [0.97, 0.8], [1.04, 0.04], [3, 0.03]];
    const density = (z) => {                                          // relative neuron density at depth z (0 = surface, 1 = white matter)
      if (z <= PROFILE[0][0]) return 0;
      for (let i = 1; i < PROFILE.length; i++) {
        if (z <= PROFILE[i][0]) {
          const [z0, d0] = PROFILE[i - 1], [z1, d1] = PROFILE[i];
          return d0 + ((d1 - d0) * (z - z0)) / (z1 - z0);
        }
      }
      return 0.03;
    };
    const colW = (34 + rand() * 18) * S, colPhase = rand() * colW;
    const columns = (u) => 0.45 + 0.55 * Math.cos((Math.PI * (u + colPhase)) / colW) ** 2;
    const pts = [];
    const free = (x, y) => pts.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 >= gap * gap);
    for (let tries = 0; pts.length < count && tries < count * 300; tries++) {
      const x = rand() * FW - mx, y = rand() * FH - my;
      const [u, d] = where(x, y), z = d / thick;
      if (rand() < density(z) * columns(u) && free(x, y)) pts.push({ x, y, u, z });
    }
    neurons = pts.map(({ x, y, u, z }) => {
      const s = slope(u);                                            // the surface's local normal, pointing up to it
      const len = Math.hypot(1, s);
      const up = Math.atan2(-(ny - s * ty) / len, -(nx - s * tx) / len);
      const pyramidal = z > 0.09 && z < 1.02 && rand() < (z > 0.4 && z < 0.47 ? 0.55 : 0.8);
      const big = pyramidal && z > 0.47 && z < 0.68;                // layer 5: the largest pyramids
      const n = { x, y, r: (pyramidal ? 2.1 + rand() * 1.7 : 1.6 + rand() * 1.1) * S * (big ? 1.3 : 1), flash: 0, cool: 0, links: [], dendrites: [], seen: -rand() * 6,
        bw: (2 * Math.PI) / (4 + rand() * 4), bp: rand() * 6.3, cw: (2 * Math.PI) / (9 + rand() * 7), cp: rand() * 6.3 };
      if (pyramidal) {
        const apical = Math.min(Math.max(z * thick * 0.8, 34 * S), (50 + rand() * 34) * S);
        dendrite(x, y, up + (rand() - 0.5) * 0.15, apical, 1, rand, n.dendrites, 0.18);
        const tip = n.dendrites[n.dendrites.length - 1].pts.at(-1);
        for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {      // the apical tuft
          dendrite(tip[0], tip[1], up + (rand() - 0.5) * 2.2, (8 + rand() * 10) * S, 2, rand, n.dendrites);
        }
        for (let i = 0, b = 3 + Math.floor(rand() * 3); i < b; i++) { // basal dendrites, spreading away from the surface
          dendrite(x, y, up + Math.PI + (i / (b - 1) - 0.5) * 2.6 + (rand() - 0.5) * 0.4, (11 + rand() * 18) * S, 0, rand, n.dendrites);
        }
      } else {
        for (let i = 0, b = 4 + Math.floor(rand() * 4); i < b; i++) {
          dendrite(x, y, (i / b) * Math.PI * 2 + rand() * 0.9, (9 + rand() * 18) * S, 0, rand, n.dendrites);
        }
      }
      return n;
    });
    // wiring: a minimum spanning tree keeps every neuron reachable; on top, nearby pairs connect with a probability
    // that falls off with distance, and a few neurons send a long axon further away
    edges = [];
    const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const linked = (p, q) => p.links.some((e) => e.a === q || e.b === q);
    const inTree = new Set([neurons[0]]);
    while (inTree.size < neurons.length) {
      let best = null, bd = Infinity;
      for (const p of inTree) for (const q of neurons) {
        if (inTree.has(q)) continue;
        const d = dist(p, q);
        if (d < bd) { bd = d; best = [p, q]; }
      }
      connect(best[0], best[1], rand);
      inTree.add(best[1]);
    }
    for (let i = 0; i < neurons.length; i++) {
      for (let j = i + 1; j < neurons.length; j++) {
        const p = neurons[i], q = neurons[j], d = dist(p, q);
        if (d < spacing * 1.8 && !linked(p, q) && rand() < 0.75 * Math.exp(-d / (0.45 * spacing))) connect(p, q, rand);
      }
    }
    for (const n of neurons) {
      if (rand() < 0.08) {
        const far = neurons.filter((m) => dist(n, m) > spacing * 1.6 && dist(n, m) < spacing * 3 && !linked(n, m));
        if (far.length) connect(n, far[Math.floor(rand() * far.length)], rand);
      }
    }
    for (const n of neurons) {                       // no dead ends or single-file chains: give sparse neurons a choice
      if (n.links.length > 2) continue;
      const near = neurons.filter((m) => m !== n && !linked(n, m) && dist(n, m) < spacing * 2.2).sort((p, q) => dist(n, p) - dist(n, q));
      if (near.length) connect(n, near[0], rand);
    }
    drawBase();
    seed();
  }

  function drawBase() {
    bx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bx.clearRect(0, 0, W, H);
    bx.lineCap = 'round';
    bx.lineJoin = 'round';
    bx.strokeStyle = 'rgba(160, 148, 255, 0.34)';
    for (const e of edges) {
      bx.lineWidth = 0.7 * S;
      bx.beginPath();
      bx.moveTo(e.pts[0][0], e.pts[0][1]);
      for (const p of e.pts) bx.lineTo(p[0], p[1]);
      bx.stroke();
      for (let i = 1; i < 5; i++) {                // the axon hillock: thick at the soma, thinning out
        bx.lineWidth = (1.5 - i * 0.22) * S;
        bx.beginPath(); bx.moveTo(e.pts[i - 1][0], e.pts[i - 1][1]); bx.lineTo(e.pts[i][0], e.pts[i][1]); bx.stroke();
      }
    }
    for (const n of neurons) {
      bx.strokeStyle = 'rgba(185, 168, 255, 0.36)';
      for (const d of n.dendrites) {
        for (let i = 1; i < d.pts.length; i++) {
          bx.lineWidth = d.w * (1 - i / d.pts.length) + 0.3;
          bx.beginPath();
          bx.moveTo(d.pts[i - 1][0], d.pts[i - 1][1]);
          bx.lineTo(d.pts[i][0], d.pts[i][1]);
          bx.stroke();
        }
      }
      const g = bx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
      g.addColorStop(0, 'rgba(185, 168, 255, 0.24)');
      g.addColorStop(1, 'rgba(185, 168, 255, 0)');
      bx.fillStyle = g;
      bx.beginPath(); bx.arc(n.x, n.y, n.r * 4, 0, Math.PI * 2); bx.fill();
      const body = bx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.3, 0, n.x, n.y, n.r);
      body.addColorStop(0, 'rgba(236, 230, 255, 0.95)');
      body.addColorStop(1, 'rgba(160, 142, 236, 0.85)');
      bx.fillStyle = body;
      bx.beginPath(); bx.arc(n.x, n.y, n.r, 0, Math.PI * 2); bx.fill();
      bx.fillStyle = 'rgba(88, 70, 170, 0.55)';      // nucleus
      bx.beginPath(); bx.arc(n.x + n.r * 0.1, n.y + n.r * 0.1, n.r * 0.38, 0, Math.PI * 2); bx.fill();
    }
  }

  // a soft glow sprite in one colour, drawn once
  function makeGlow(rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `rgba(${rgb}, 0.9)`);
    r.addColorStop(0.25, `rgba(${rgb}, 0.35)`);
    r.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  // ---------- signals ----------
  // a signal travels one axon at a time; `hops` is Infinity for the resident signals that keep the network alive
  function send(from, edge, hops, wait) {
    signals.push({ e: edge, fwd: edge.a === from, s: 0, wait, hops, speed: (85 + Math.random() * 65) * S });
  }

  // pick the next axon: not straight back unless it's the only way, and most likely towards the neighbour that has
  // waited longest for a signal. The chosen neighbour is claimed, so other signals look elsewhere.
  const other = (e, node) => (e.a === node ? e.b : e.a);
  function onward(node, came) {
    const options = node.links.filter((e) => e !== came);
    const pool = options.length ? options : node.links;
    const weights = pool.map((e) => (clock - other(e, node).seen + 0.3) ** 3);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
    other(pick, node).seen = clock;
    return pick;
  }

  function fire(n, hops) {                        // a neuron fires on its own (pointer, tap): short-lived signals
    n.flash = 1;
    n.seen = clock;
    n.visits = (n.visits || 0) + 1;
    if (signals.length > resident * 3) return;
    const first = onward(n, null);
    send(n, first, hops, 0);
    if (n.links.length > 1) send(n, onward(n, first), hops, 0);
  }

  function seed() {                               // the resident signals, spread over the network and over time
    signals = [];
    resident = Math.max(4, Math.round(neurons.length / 6));
    for (let i = 0; i < resident; i++) {
      const n = neurons[Math.floor((i + 0.5) * neurons.length / resident)];
      send(n, onward(n, null), Infinity, i * 0.45);
    }
  }

  function at(e, s, fwd) {                        // point at arc length s along an axon, in the direction of travel
    if (!fwd) s = e.total - s;
    let i = 1;
    while (i < e.len.length - 1 && e.len[i] < s) i++;
    const t = (s - e.len[i - 1]) / Math.max(1e-6, e.len[i] - e.len[i - 1]);
    const a = e.pts[i - 1], b = e.pts[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  let lastCheck = 0;
  function step(dt) {
    clock += dt;
    if (clock - lastCheck > 0.5) {                    // a neuron left quiet too long fires on its own
      lastCheck = clock;
      let quiet = null;
      for (const n of neurons) if (n.x > 0 && n.x < W && n.y > 0 && n.y < H && (!quiet || n.seen < quiet.seen)) quiet = n;
      if (quiet && clock - quiet.seen > 7) fire(quiet, 3 + Math.floor(Math.random() * 3));
    }
    for (const n of neurons) {
      n.flash = Math.max(0, n.flash - dt * 1.4);
      n.cool -= dt;
      if (pointer.on && n.cool <= 0 && Math.hypot(n.x - pointer.x, n.y - pointer.y) < 85 * S) {
        n.cool = 0.9;
        fire(n, 3 + Math.floor(Math.random() * 4));
      }
    }
    for (const e of edges) e.heat = Math.max(0, e.heat - dt * 0.7);
    const born = [];
    for (let i = signals.length - 1; i >= 0; i--) {
      const sg = signals[i];
      if (sg.wait > 0) { sg.wait -= dt; continue; }  // the synaptic pause before it fires on
      sg.s += sg.speed * dt;
      sg.e.heat = 1;
      if (sg.s < sg.e.total) continue;
      const node = sg.fwd ? sg.e.b : sg.e.a;
      node.flash = 1;
      node.seen = clock;
      node.visits = (node.visits || 0) + 1;
      if (--sg.hops <= 0) { signals.splice(i, 1); continue; }
      const next = onward(node, sg.e);
      sg.fwd = next.a === node; sg.e = next; sg.s = 0; sg.wait = 0.08 + Math.random() * 0.12;
      // now and then the neuron fires down a second axon too: a short cascade on top of the circulation
      if (Math.random() < 0.2 && signals.length + born.length < resident * 3 && node.links.length > 1) {
        const other = onward(node, next);
        if (other !== next) born.push([node, other]);
      }
    }
    for (const [node, e] of born) send(node, e, 2 + Math.floor(Math.random() * 4), 0.1);
  }

  function drawLive(t) {
    lx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lx.clearRect(0, 0, W, H);
    lx.lineCap = 'round';
    lx.lineJoin = 'round';
    // breathing, like calcium imaging: each neuron glows softly in and out on its own rhythm, drifting violet to blue
    const sec = t / 1000;
    for (const n of neurons) {
      const b = 0.5 + 0.5 * Math.sin(sec * n.bw + n.bp), c = 0.5 + 0.5 * Math.sin(sec * n.cw + n.cp);
      const a = 0.14 + 0.36 * b * b, s = n.r * 4 + 12 * S * b;
      lx.globalAlpha = a * (1 - c); lx.drawImage(glowV, n.x - s / 2, n.y - s / 2, s, s);
      lx.globalAlpha = a * c; lx.drawImage(glowB, n.x - s / 2, n.y - s / 2, s, s);
    }
    lx.globalAlpha = 1;
    // axons that just carried a signal stay faintly lit, so the paths of information show
    for (const e of edges) {
      if (e.heat <= 0.02) continue;
      lx.strokeStyle = `rgba(${SPIKE}, ${(0.22 * e.heat).toFixed(3)})`;
      lx.lineWidth = 0.9 * S;
      lx.beginPath();
      lx.moveTo(e.pts[0][0], e.pts[0][1]);
      for (const p of e.pts) lx.lineTo(p[0], p[1]);
      lx.stroke();
    }
    // pointer: faint links to the nearest neurons
    if (pointer.on) {
      const reach = 105 * S;
      for (const n of neurons) {
        const d = Math.hypot(n.x - pointer.x, n.y - pointer.y);
        if (d > reach) continue;
        lx.strokeStyle = `rgba(185, 168, 255, ${(0.32 * (1 - d / reach)).toFixed(3)})`;
        lx.lineWidth = 0.6 * S;
        lx.beginPath(); lx.moveTo(pointer.x, pointer.y); lx.lineTo(n.x, n.y); lx.stroke();
      }
    }
    // signals: a bright head with a fading lit stretch of axon behind it
    for (const sg of signals) {
      if (sg.wait > 0 && sg.s === 0) continue;
      const e = sg.e, tail = 26 * S;
      const s0 = Math.max(0, sg.s - tail), s1 = Math.min(sg.s, e.total);
      const parts = 8;
      for (let k = 0; k < parts; k++) {
        const a = at(e, s0 + (s1 - s0) * (k / parts), sg.fwd);
        const b = at(e, s0 + (s1 - s0) * ((k + 1) / parts), sg.fwd);
        lx.strokeStyle = `rgba(${SPIKE}, ${(0.8 * (k + 1) / parts).toFixed(3)})`;
        lx.lineWidth = 1.2 * S;
        lx.beginPath(); lx.moveTo(a[0], a[1]); lx.lineTo(b[0], b[1]); lx.stroke();
      }
      const [hx, hy] = at(e, s1, sg.fwd), gs = 15 * S;
      lx.drawImage(glow, hx - gs / 2, hy - gs / 2, gs, gs);
      lx.fillStyle = '#fff6ec';
      lx.beginPath(); lx.arc(hx, hy, 1.15 * S, 0, Math.PI * 2); lx.fill();
    }
    // a neuron that a signal just reached glows
    for (const n of neurons) {
      if (n.flash <= 0) continue;
      const s = (8 + 26 * n.flash) * S;
      lx.globalAlpha = n.flash;
      lx.drawImage(glow, n.x - s / 2, n.y - s / 2, s, s);
      lx.globalAlpha = 1;
    }
  }

  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    drift = [Math.sin(t * 0.00021) * 9, Math.cos(t * 0.00016) * 7];   // a slow float, a few pixels over half a minute
    holder.style.transform = `translate3d(${drift[0].toFixed(2)}px, ${drift[1].toFixed(2)}px, 0)`;
    pointer.x = pointer.cx + BLEED - drift[0];
    pointer.y = pointer.cy + BLEED - drift[1];
    step(dt);
    drawLive(t);
  }

  function start() {
    if (running || reduced.matches || document.hidden) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }
  function stop() { running = false; lx.clearRect(0, 0, live.width, live.height); }

  let lastW = 0, lastH = 0;
  function resize() {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 120) return;   // ignore mobile toolbar show/hide
    lastW = innerWidth; lastH = innerHeight;
    build();
  }

  glow = makeGlow(SPIKE);
  glowV = makeGlow([185, 168, 255]);
  glowB = makeGlow([140, 188, 255]);
  resize();
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { pointer.cx = e.clientX; pointer.cy = e.clientY; pointer.on = e.pointerType === 'mouse'; }, { passive: true });
  addEventListener('pointerdown', (e) => {                            // a tap or click fires the nearest neuron
    let best = null, bd = 1e9;
    const x = e.clientX + BLEED - drift[0], y = e.clientY + BLEED - drift[1];
    for (const n of neurons) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
    if (best && bd < 110 * S && running) fire(best, 6);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.on = false; });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduced.addEventListener('change', () => (reduced.matches ? stop() : start()));

  if (new URLSearchParams(location.search).has('debug')) {         // for testing: how evenly signals reach the neurons
    window.__neurons = () => neurons.filter((n) => n.x > BLEED && n.x < W - BLEED && n.y > BLEED && n.y < H - BLEED).map((n) => n.visits || 0);
  }

  // open with a burst from a neuron near the given spot (data-burst="x,y" as fractions of the screen)
  const burst = (holder.dataset.burst || '').split(',').map(Number);
  start();
  if (running && burst.length === 2) {
    setTimeout(() => {
      let best = neurons[0], bd = 1e9;
      for (const n of neurons) { const d = Math.hypot(n.x - burst[0] * W, n.y - burst[1] * H); if (d < bd) { bd = d; best = n; } }
      fire(best, 6);
    }, 500);
  }

  // dim the network behind reading sections: full strength in the first screen, quieter below it
  const dimAfter = parseFloat(holder.dataset.dimAfter || '0.7');
  const update = () => holder.classList.toggle('is-dim', scrollY > innerHeight * dimAfter);
  addEventListener('scroll', update, { passive: true });
  update();
})();
