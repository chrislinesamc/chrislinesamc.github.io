// DHARANI fetal brains, volume-rendered with WebGL2 and driven by scroll. Two choreographies (data-choreo):
//  'dharani' (project page): five brains grow from 14 to 24 weeks, following the beats that story.js reports;
//  'home' (home page): one brain (data-only) sits behind the name with a corner cut away, then turns, splits into
//    its sections and comes back together as the page scrolls; the steps are the page sections in data-steps;
//  'anchor', 'cstroke' (project pages): the ANCHOR brainstems and the C-Stroke brain, following story.js beats.
// Either way the position is a number where step k spans [k, k + 1).
(() => {
  'use strict';

  const canvas = document.getElementById('brain');
  if (!canvas) return;
  const choreo = canvas.dataset.choreo || 'dharani';
  const steps = canvas.dataset.steps ? [...document.querySelectorAll(canvas.dataset.steps)] : null;
  if (!steps && !window.Story) return;
  const hero = steps ? steps[0] : Story.element;
  const poster = document.querySelector('.stage-poster');

  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const reduced = window.Story ? Story.reduced : matchMedia('(prefers-reduced-motion: reduce)');
  const WORLD = 1 / 40;                       // mm -> world units
  const BASE = canvas.dataset.volumes;        // folder holding volumes.json
  const ONLY = canvas.dataset.only;           // load just this volume

  function position() {
    if (!steps) return Story.position();
    const mid = innerHeight * 0.5;
    let b = 0;
    for (let i = 0; i < steps.length; i++) {
      const r = steps[i].getBoundingClientRect();
      if (mid < r.top) break;
      if (mid <= r.bottom) { b = i + (mid - r.top) / r.height; break; }
      b = i + 1 + (mid - r.bottom) / innerHeight;
    }
    return reduced.matches ? Math.floor(b) + 0.5 : b;
  }

  // ---------- shaders ----------
  const VS = `#version 300 es
in vec2 aPos; out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uVolA, uVolB;
uniform sampler2D uLutA, uLutB;
uniform float uMix;            // 0 = brain A, 1 = brain B
uniform vec3 uHalf;            // apparent half size of the brain, world units
uniform vec3 uEye, uRight, uUp, uFwd;
uniform vec2 uLens;            // tan(fov/2) * aspect, tan(fov/2)
uniform vec2 uShift;           // where the brain centre sits on screen, in NDC
uniform float uExplode;        // 0 = solid, 1 = sections spread apart
uniform vec3 uAxis;            // the axis the sections are cut along: (0,0,1) front to back, (0,1,0) top to bottom
uniform float uGap;            // gap between sections when fully exploded, in section thicknesses
uniform float uGamma;          // contrast curve on the colour table: 1.8 deepens stains, 1.0 leaves it as is
uniform float uThin;           // fraction of each section's thickness kept
uniform float uCut;            // 0 = whole, 1 = the octant facing the camera removed
uniform vec3 uCutSign;
uniform float uStep;           // ray step, world units
uniform float uFade;
uniform vec3 uLight;           // light direction in texture space
in vec2 vNdc; out vec4 outColor;

const float N = 14.0;          // sections in the exploded view
const int MAX_STEPS = 720;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// world point -> texture coordinate of the assembled brain; false in a gap between sections or in the cutaway
bool mapPoint(vec3 p, float zx, out vec3 tc) {
  vec3 q = p / uHalf;
  float t = 2.0 / N;
  float g = uExplode * uGap * t;
  float P = t + g;
  float c0 = dot(q, uAxis);
  float rel = c0 + zx;
  float i = floor(rel / P);
  float local = rel - i * P;
  if (i < 0.0 || i >= N || local > uThin * t) return false;
  q += uAxis * ((-1.0 + i * t + local) - c0);
  vec3 c = vec3(1.0 - uCut);
  if (all(greaterThan(q * uCutSign, c))) return false;
  tc = q * 0.5 + 0.5;
  return true;
}

float density(vec3 tc) {
  float a = texture(uVolA, tc).r;
  if (uMix < 0.002) return a;
  float b = texture(uVolB, tc).r;
  return mix(a, b, uMix);
}

vec3 stain(float d) {
  vec3 a = texture(uLutA, vec2(d, 0.5)).rgb;
  if (uMix < 0.002) return a;
  return mix(a, texture(uLutB, vec2(d, 0.5)).rgb, uMix);
}

void main() {
  vec2 s = vNdc - uShift;
  vec3 dir = normalize(uFwd + s.x * uLens.x * uRight + s.y * uLens.y * uUp);
  float zx = 1.0 + (N - 1.0) * uExplode * uGap / N;    // stretch of the exploded stack along its axis
  vec3 box = uHalf * (vec3(1.0) + (zx - 1.0) * uAxis);
  vec3 inv = 1.0 / dir;
  vec3 t0 = (-box - uEye) * inv, t1 = (box - uEye) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z), tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tf <= max(tn, 0.0)) { outColor = vec4(0.0); return; }
  float t = max(tn, 0.0) + uStep * hash(gl_FragCoord.xy);
  vec4 acc = vec4(0.0);
  float boost = mix(1.0, 3.2, uExplode);
  for (int k = 0; k < MAX_STEPS; k++) {
    if (t > tf || acc.a > 0.975) break;
    vec3 tc;
    if (mapPoint(uEye + dir * t, zx, tc)) {
      float d = density(tc);
      float a = smoothstep(0.04, 0.7, d) * boost;
      if (a > 0.004) {
        a = 1.0 - pow(1.0 - min(a, 0.98), uStep * 120.0);
        float dl = density(clamp(tc + uLight * 0.012, 0.0, 1.0));
        float shade = clamp(0.95 + (d - dl) * 2.6, 0.5, 1.35);
        // deepen the stain: pale white matter recedes, the cell-dense layers glow violet
        vec3 col = pow(stain(d), vec3(uGamma)) * mix(0.5, 1.2, smoothstep(0.08, 0.55, d)) * shade * vec3(0.9, 0.88, 1.1);
        acc.rgb += (1.0 - acc.a) * a * col;
        acc.a += (1.0 - acc.a) * a;
      }
    }
    t += uStep;
  }
  outColor = acc * uFade;
}`;

  // ---------- choreography: tracks keyed by beat position (beat k is centred at k + 0.5) ----------
  const B = (i) => [2 + i + 0.25, i, 2 + i + 0.75, i];          // hold brain i while its caption is centred
  const CHOREO = {
    dharani: {
      brain:   pairs([0, 0, ...B(0), ...B(1), ...B(2), ...B(3), ...B(4), 99, 4]),
      explode: pairs([0, 1, 1.15, 1, 2.1, 0]),
      cut:     pairs([7.05, 0, 7.75, 1]),
      az:      pairs([0, -152, 1.2, -140, 2.2, -100, 7.0, -42, 9.2, -20]),
      el:      pairs([0, 20, 2.2, 16, 7.0, 22, 9.2, 18]),
      dist:    pairs([0, 4.6, 1.2, 4.3, 2.2, 3.7, 4.2, 4.6, 6.6, 5.8, 7.8, 5.3, 9.2, 5.6]),
      shift:   pairs([0, 0.46, 1.2, 0.42, 2.2, 0.36, 8.1, 0.36, 9.2, 0.5]),
      fade:    pairs([0, 1, 8.3, 1, 9.0, 0]),
    },
    // steps: 0 hero, 1 about, 2 why you might know me, 3 selected work, 4 SGBC, 5 papers, 6 timeline, 7 toolbox,
    // 8 contact. Cut open behind the name; the cut closes as it turns; it splits into sections through the work;
    // the sections drift through the record; they come back together for "Say hello". Dimmer behind reading text.
    home: {
      brain:   pairs([0, 0]),
      cut:     pairs([0, 1, 0.55, 1, 1.5, 0]),
      explode: pairs([0, 0, 2.6, 0, 3.8, 1, 6.0, 1, 7.5, 0]),
      az:      pairs([0, -38, 0.55, -38, 8.4, 322]),
      el:      pairs([0, 18, 3.6, 30, 6.2, 8, 8.4, 18]),
      dist:    pairs([0, 3.5, 0.55, 3.5, 1.6, 4.0, 3.8, 5.6, 6.0, 5.6, 8.3, 4.6]),
      // the way back to the middle for "Say hello" starts halfway through the timeline, so it has room to glide
      shift:   pairs([0, 0.36, 0.55, 0.36, 1.4, 0.62, 2.2, 0.55, 3.0, 0.45, 4.9, 0.45, 5.5, 0.62, 6.5, 0.62, 8.3, 0]),
      shiftY:  pairs([0, 0, 6.5, 0, 8.3, 0.36]),      // for "Say hello" it sits above the words
      fade:    pairs([0, 1, 0.6, 1, 1.3, 0.35, 1.8, 0.35, 2.4, 0.6, 3.1, 0.75, 4.9, 0.75, 5.4, 0.3, 6.6, 0.3, 8.2, 0.85]),
      poster:  pairs([0, 1, 0.6, 1, 1.3, 0]),           // the still shown without WebGL: the hero only
    },
    // ANCHOR: the 9-year-old brainstem carries the whole story, like FB74 on the home page. Beats: 0 intro (a corner
    // cut away), 1 serial sections (the cut closes, it splits into slabs, top to bottom as it was sectioned), 2-4 the
    // three ages (turning, coming back together), 5 structures (cut open again), 6 block face to cells, 7 explore.
    anchor: {
      brain:   pairs([0, 0]),
      cut:     pairs([0, 1, 0.6, 1, 1.3, 0, 5.05, 0, 5.75, 1]),
      explode: pairs([0, 0, 1.0, 0, 1.8, 1, 2.6, 1, 3.8, 0]),
      az:      pairs([0, -40, 0.6, -40, 4.9, 320, 5.75, 320, 7.2, 340]),
      el:      pairs([0, 16, 1.8, 24, 3.8, 10, 5.0, 16, 7.2, 14]),
      dist:    pairs([0, 5.0, 0.6, 5.0, 1.8, 7.6, 2.6, 7.6, 3.8, 5.2, 7.2, 5.4]),
      shift:   pairs([0, 0.4, 7.2, 0.4]),
      fade:    pairs([0, 1, 7.3, 1, 8.0, 0]),
    },
    // C-Stroke: one whole brain. Beats: 0 intro (upright, seen from the side, front to the left), 1 sections (it
    // splits apart), 2 stains, 3 back together and registered to MRI (turned three-quarters to the front), 4 injury
    // beyond the lesion (the front-top corner cut open), 5 the petabyte, 6 explore.
    cstroke: {
      brain:   pairs([0, 0]),
      explode: pairs([0, 0, 0.9, 0, 1.6, 1, 2.8, 1, 3.6, 0]),
      cut:     pairs([3.9, 0, 4.6, 1]),
      az:      pairs([0, 90, 0.6, 90, 1.6, 76, 2.8, 70, 3.6, 50, 4.6, 40, 6.4, 30]),
      el:      pairs([0, 10, 0.6, 10, 1.6, 16, 2.8, 16, 3.6, 22, 4.6, 20, 6.4, 16]),
      dist:    pairs([0, 4.4, 1.6, 7.4, 2.8, 7.4, 3.6, 4.6, 6.4, 4.8]),
      shift:   pairs([0, 0.42, 6.4, 0.4]),
      fade:    pairs([0, 1, 6.3, 1, 7.0, 0]),
    },
  };
  const TRACKS = CHOREO[choreo];
  // per page: the axis and gap of the split; the corner the cut removes, given as the camera pose it faces (without
  // one, the corner facing the camera when the cut starts opening; pinned, scrolling back reopens the same corner);
  // and the beats during which the age ticker shows
  const SETTINGS = {
    dharani: { axis: [0, 0, 1], gap: 1.7, gamma: 1.8, ticker: [1.9, 7.1] },
    home:    { axis: [0, 0, 1], gap: 1.7, gamma: 1.8, cutFrom: [-38, 18] },
    anchor:  { axis: [0, 1, 0], gap: 0.5, gamma: 1.0, cutFrom: [-40, 16], steps: 380, scale: 1 },   // finer: full-resolution volume
    cstroke: { axis: [0, 0, 1], gap: 0.8, gamma: 1.8, cutFrom: [40, 20] },
  }[choreo];
  const CUT_FROM = SETTINGS.cutFrom;
  const ticker = document.querySelector('.gw');
  const tickerItems = ticker ? [...ticker.querySelectorAll('[data-gw]')] : [];

  function pairs(a) { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; }
  const ease = (x) => x * x * (3 - 2 * x);
  function sample(track, x) {
    if (x <= track[0][0]) return track[0][1];
    for (let i = 1; i < track.length; i++) {
      if (x <= track[i][0]) {
        const [x0, y0] = track[i - 1], [x1, y1] = track[i];
        return y0 + (y1 - y0) * ease((x - x0) / (x1 - x0));
      }
    }
    return track[track.length - 1][1];
  }

  // ---------- WebGL ----------
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    root.classList.add('no-webgl');
    if (!poster) return;
    const update = () => { poster.style.opacity = sample(TRACKS.poster || TRACKS.fade, position()).toFixed(3); };
    addEventListener('scroll', update, { passive: true });
    update();
  };
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
  if (!gl || !('DecompressionStream' in window)) return fallback();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  if (/swiftshader|llvmpipe|software/i.test(renderer) && !params.has('force3d')) return fallback();

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn('brain: shader failed, using the still image', e);
    return fallback();
  }
  gl.useProgram(prog);
  const U = {};
  for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(prog, i).name;
    U[name] = gl.getUniformLocation(prog, name);
  }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(U.uVolA, 0); gl.uniform1i(U.uVolB, 1); gl.uniform1i(U.uLutA, 2); gl.uniform1i(U.uLutB, 3);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  // ---------- volumes ----------
  const brains = [];                              // {meta, vol, lut, half} in gestational order, filled as they load

  async function gunzip(url) {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;            // already decoded by the server
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function upload(meta, data) {
    const [u, v, w] = meta.dims;
    const vol = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, vol);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, u, v, w, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    const rgb = new Uint8Array(256 * 3);
    for (let i = 0; i < 768; i++) rgb[i] = parseInt(meta.lut.substr(i * 2, 2), 16);
    const lut = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, rgb);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    return { vol, lut };
  }

  // display size: each brain keeps its proportions; its largest dimension follows a smooth growth curve
  // between the youngest and the oldest brain, so specimen-to-specimen variation does not read as shrinking
  function halfSizes(list) {
    const maxd = list.map((m) => Math.max(...m.size_mm));
    if (list.length === 1) return [list[0].size_mm.map((x) => x * 0.5 * WORLD)];
    const g0 = list[0].gw, g1 = list[list.length - 1].gw;
    return list.map((m, i) => {
      const target = maxd[0] + (maxd[maxd.length - 1] - maxd[0]) * (m.gw - g0) / (g1 - g0);
      const s = target / maxd[i];
      return m.size_mm.map((x) => x * s * 0.5 * WORLD);
    });
  }

  // a set with display_mm: the largest volume is drawn at that size, the others in proportion
  function fitSizes(list, mm) {
    const s = mm / Math.max(...list.map((m) => Math.max(...m.size_mm)));
    return list.map((m) => m.size_mm.map((x) => x * s * 0.5 * WORLD));
  }

  async function load() {
    const index = await (await fetch(BASE + 'volumes.json')).json();
    const list = index.volumes.filter((v) => !ONLY || v.id === ONLY);
    const halves = index.display_mm ? fitSizes(list, index.display_mm) : halfSizes(list);
    list.forEach((meta, i) => { brains[i] = { meta, half: halves[i], tex: null }; });
    for (const b of brains) {                       // youngest first: the hero opens on it
      try {
        b.tex = upload(b.meta, await gunzip(BASE + b.meta.file));
        dirty = true;
        if (b === brains[0]) { root.classList.add('webgl-ready'); start(); }
      } catch (e) {
        console.warn('brain: could not load', b.meta.file, e);
        if (b === brains[0]) return fallback();
      }
    }
  }

  const loaded = (i) => { for (let k = i; k >= 0; k--) if (brains[k] && brains[k].tex) return k; return 0; };

  // ---------- frame ----------
  const fixedScale = parseFloat(params.get('scale'));       // ?scale=1 renders at full resolution (for stills)
  let scale = fixedScale || SETTINGS.scale || 0.75, dirty = true, last = {}, running = false, slowFrames = 0, prevT = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(innerWidth * dpr * scale));
    const h = Math.max(1, Math.round(innerHeight * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }

  function state(time) {
    const b = position();
    const portrait = innerWidth < innerHeight * 0.9;
    // a slow idle turn; on the home page only while the hero is in view, so reading below never keeps the GPU busy
    const idle = choreo === 'home' ? Math.max(0, 1 - b) : 1;
    const drift = reduced.matches ? 0 : Math.sin(time * 0.00012) * 6 * idle;
    const s = {};
    for (const k in TRACKS) s[k] = sample(TRACKS[k], b);
    s.az = Math.round((s.az + drift) * 20) / 20;     // 0.05 degree steps: the idle drift redraws a few times a second
    s.b = b;
    s.shiftX = portrait ? 0 : s.shift;
    s.shiftY = portrait ? 0.3 : TRACKS.shiftY ? sample(TRACKS.shiftY, b) : 0;
    s.dist *= portrait ? Math.max(1.15, 0.95 * innerHeight / innerWidth) : 1;
    s.visible = steps ? s.fade > 0.01 : hero.getBoundingClientRect().bottom > -innerHeight * 0.2;
    return s;
  }

  function draw(s) {
    const fi = Math.max(0, Math.min(brains.length - 1, s.brain));
    let ia = loaded(Math.floor(fi)), ib = loaded(Math.ceil(fi));
    const mix = ia === ib ? 0 : fi - Math.floor(fi);
    const A = brains[ia], Bb = brains[ib];
    const half = A.half.map((x, i) => x + (Bb.half[i] - x) * mix);

    const az = s.az * Math.PI / 180, el = s.el * Math.PI / 180;
    const eye = [s.dist * Math.cos(el) * Math.sin(az), s.dist * Math.sin(el), s.dist * Math.cos(el) * Math.cos(az)];
    const fwd = norm(eye.map((x) => -x));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const tanF = Math.tan(15 * Math.PI / 180);
    const facing = CUT_FROM ? orbit(CUT_FROM[0], CUT_FROM[1], 1) : eye;
    const cutSign = facing.map((x) => (x >= 0 ? 1 : -1));
    // keep the octant fixed once it starts opening, so it never jumps to another corner mid-cut
    if (s.cut > 0.001) { last.cutSign = last.cutSign || cutSign; } else { last.cutSign = null; }
    const light = norm([0.45, 0.8, 0.35]);
    const step = Math.max(...half) * 2 / (SETTINGS.steps || 200);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, A.tex.vol);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, Bb.tex.vol);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, A.tex.lut);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, Bb.tex.lut);
    gl.uniform1f(U.uMix, mix);
    gl.uniform3fv(U.uHalf, half);
    gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uRight, right); gl.uniform3fv(U.uUp, up); gl.uniform3fv(U.uFwd, fwd);
    gl.uniform2f(U.uLens, tanF * canvas.width / canvas.height, tanF);
    gl.uniform2f(U.uShift, s.shiftX, s.shiftY);
    gl.uniform1f(U.uExplode, s.explode);
    gl.uniform3fv(U.uAxis, SETTINGS.axis);
    gl.uniform1f(U.uGap, SETTINGS.gap);
    gl.uniform1f(U.uGamma, SETTINGS.gamma);
    gl.uniform1f(U.uThin, 1 - 0.78 * s.explode);
    gl.uniform1f(U.uCut, s.cut);
    gl.uniform3fv(U.uCutSign, last.cutSign || cutSign);
    gl.uniform1f(U.uStep, step);
    gl.uniform1f(U.uFade, s.fade);
    gl.uniform3fv(U.uLight, light);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // the drawn pose follows the scroll pose with a short glide, so a quick flick of the wheel never makes the brain jump
  const GLIDE = 0.3;                                  // seconds; none with reduced motion
  const SMOOTH = ['brain', 'explode', 'cut', 'az', 'el', 'dist', 'shiftX', 'shiftY', 'fade'];
  let pose = null, poseT = 0;
  function glide(s, time) {
    if (!pose || reduced.matches) { pose = { ...s }; poseT = time; return s; }
    const k = 1 - Math.exp(-Math.max(0, time - poseT) / 1000 / GLIDE);
    poseT = time;
    for (const f of SMOOTH) {
      const d = s[f] - pose[f];
      pose[f] = Math.abs(d) < (f === 'az' || f === 'el' ? 0.02 : 0.0005) ? s[f] : pose[f] + d * k;   // settle, then stop redrawing
    }
    const g = { ...s };
    for (const f of SMOOTH) g[f] = pose[f];
    if (steps) g.visible = g.fade > 0.01;
    return g;
  }

  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    resize();
    const s = glide(state(time), time);
    canvas.style.opacity = s.visible ? '' : '0';
    if (ticker) {
      ticker.classList.toggle('is-on', !!SETTINGS.ticker && s.b > SETTINGS.ticker[0] && s.b < SETTINGS.ticker[1]);
      const active = Math.round(Math.max(0, Math.min(tickerItems.length - 1, s.brain)));
      tickerItems.forEach((li, i) => li.classList.toggle('is-active', i === active));
    }
    if (!s.visible) return;
    const key = ['brain', 'explode', 'cut', 'az', 'el', 'dist', 'shiftX', 'shiftY', 'fade'].map((k) => s[k].toFixed(4)).join();
    if (key === last.key && !dirty) return;
    last.key = key;
    dirty = false;
    draw(s);
    // adaptive resolution: drop the internal scale when frames are slow, never below half
    if (!fixedScale && prevT && time - prevT > 28) { if (++slowFrames > 20 && scale > 0.5) { scale -= 0.1; slowFrames = 0; } } else slowFrames = 0;
    prevT = time;
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (brains[0] && brains[0].tex) { prevT = 0; start(); }
  });
  reduced.addEventListener('change', () => { dirty = true; });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; fallback(); });

  function orbit(azDeg, elDeg, d) {
    const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    return [d * Math.cos(el) * Math.sin(az), d * Math.sin(el), d * Math.cos(el) * Math.cos(az)];
  }
  function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  load().catch((e) => { console.warn('brain:', e); fallback(); });
})();
