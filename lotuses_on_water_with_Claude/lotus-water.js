/**
 * lotus-water.js — a WebGPU 3D background scene for a yoga website.
 *
 *  • A flowing stream: GPU ripple simulation (compute shader) advected by the
 *    current, with flow-mapped surface detail, refraction, Fresnel reflection
 *    and sun glitter.
 *  • A pebble riverbed and procedural boulders under the water, with animated
 *    caustics that are warped by the ripples.
 *  • Lotus flowers built from a small shape grammar (whorls of petals, sepals,
 *    seed pod, stamens). They fall from the sky, make ripples where they land,
 *    then drift away on the current. They are also reflected in the water.
 *
 * Usage:
 *   import { LotusWaterScene } from './lotus-water.js';
 *   const scene = new LotusWaterScene(canvas, { onFlyModeChange: on => {} });
 *   await scene.start();
 *
 * Controls: tap ALT to enter or leave fly mode. In fly mode, the mouse looks
 * around and WASD moves; Q/E move down/up and Shift moves faster. Esc also
 * leaves fly mode.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SIM_N = 256;          // ripple grid resolution
const SIM_SIZE = 64;        // world units covered by the ripple grid
const MAX_FLOWERS = 32;
const MAX_DROPS = 16;
const SUN_DIR = normalize3([0.32, 0.42, -1.0]);
const HDR_FORMAT = 'rgba16float';
const DEPTH_FORMAT = 'depth32float';

// ---------------------------------------------------------------------------
// Small math helpers (column-major matrices, WebGPU depth range 0..1)
// ---------------------------------------------------------------------------
function normalize3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = far / (near - far); m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}
function mat4LookAt(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function mat4Invert(a) {
  const o = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return o;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
function quatAxisAngle(ax, ay, az, angle) { const s = Math.sin(angle / 2); return [ax * s, ay * s, az * s, Math.cos(angle / 2)]; }
function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise on the CPU (used for terrain and rock shapes)
function hash3i(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (dx, dy, dz) => hash3i(xi + dx, yi + dy, zi + dz, seed);
  const x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * u;
  const x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * u;
  const x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * u;
  const x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}
function fbm3(x, y, z, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

/** The current: mostly +X with a gentle meander. Mirrors flowAt() in WGSL. */
function flowAt(x, z, speed) {
  return [speed * (1.0 + 0.3 * Math.sin(z * 0.11 + 0.7)), speed * 0.35 * Math.sin(x * 0.08 + z * 0.05 + 1.9)];
}

function bedHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = -2.4 + (fbm3(x * 0.055, 0.3, z * 0.055, 4, 7) - 0.5) * 2.6 + (fbm3(x * 0.3, 1.7, z * 0.3, 3, 11) - 0.5) * 0.35;
  h -= Math.max(0, r - 45) * 0.05;
  if (h > -1.3) h = -1.3 + (h + 1.3) * 0.3;
  return h;
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------
/** Grid whose spacing grows toward the edges: dense near the middle, reaches the horizon. */
function stretchedCoord(s, R) { return R * s * (0.2 + 0.8 * s * s); }

function buildGridIndices(seg) {
  const idx = new Uint32Array(seg * seg * 6);
  let k = 0;
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  return idx;
}

function buildWaterGrid(seg = 384, R = 400) {
  const pos = new Float32Array((seg + 1) * (seg + 1) * 2);
  let k = 0;
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
    pos[k++] = stretchedCoord(i / seg * 2 - 1, R);
    pos[k++] = stretchedCoord(j / seg * 2 - 1, R);
  }
  return { vertices: pos, indices: buildGridIndices(seg) };
}

function buildBedGrid(seg = 256, R = 400) {
  const data = new Float32Array((seg + 1) * (seg + 1) * 6);
  let k = 0;
  const e = 0.25;
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
    const x = stretchedCoord(i / seg * 2 - 1, R), z = stretchedCoord(j / seg * 2 - 1, R);
    const y = bedHeight(x, z);
    const dx = (bedHeight(x + e, z) - bedHeight(x - e, z)) / (2 * e);
    const dz = (bedHeight(x, z + e) - bedHeight(x, z - e)) / (2 * e);
    const n = normalize3([-dx, 1, -dz]);
    data[k++] = x; data[k++] = y; data[k++] = z;
    data[k++] = n[0]; data[k++] = n[1]; data[k++] = n[2];
  }
  return { vertices: data, indices: buildGridIndices(seg) };
}

function icosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(normalize3);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      let m = cache.get(key);
      if (m === undefined) { m = verts.length; verts.push(normalize3(mix3(verts[a], verts[b], 0.5))); cache.set(key, m); }
      return m;
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  return { verts, faces };
}

/** One boulder shape: a noise-displaced icosphere with a flattened base. */
export function buildRockMesh(seed) {
  const { verts, faces } = icosphere(3);
  const P = verts.map(v => {
    const n1 = fbm3(v[0] * 1.3 + seed * 3.1, v[1] * 1.3, v[2] * 1.3, 4, seed);
    const n2 = noise3(v[0] * 4.5, v[1] * 4.5 + seed, v[2] * 4.5, seed + 5);
    const n3 = noise3(v[0] * 9 + seed, v[1] * 9, v[2] * 9 - seed, seed + 9);
    const ridge = 1 - Math.abs(noise3(v[0] * 2.2, v[1] * 2.2 + seed * 1.7, v[2] * 2.2, seed + 3) * 2 - 1);
    const r = 1 + (n1 - 0.5) * 0.8 + (n2 - 0.5) * 0.16 + (n3 - 0.5) * 0.05 - ridge * ridge * 0.12;
    const p = [v[0] * r, v[1] * r, v[2] * r];
    if (p[1] < -0.25) p[1] = -0.25 + (p[1] + 0.25) * 0.25;
    return p;
  });
  const N = P.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    const fn = cross3(sub3(P[b], P[a]), sub3(P[c], P[a]));
    for (const i of [a, b, c]) { N[i][0] += fn[0]; N[i][1] += fn[1]; N[i][2] += fn[2]; }
  }
  const out = new Float32Array(P.length * 6);
  P.forEach((p, i) => {
    let n = normalize3(N[i]);
    if (dot3(n, verts[i]) < 0) n = [-n[0], -n[1], -n[2]];
    out.set([p[0], p[1], p[2], n[0], n[1], n[2]], i * 6);
  });
  return { vertices: out, indices: faces.flat() };
}

// ---- Lotus flower: shape grammar + parametric petals ----------------------
const LOTUS_STYLES = [
  { // classic pink lotus
    colors: { base: [0.95, 0.92, 0.78], mid: [0.96, 0.68, 0.79], tip: [0.86, 0.20, 0.45] },
    whorls: [
      { count: 8, length: 1.00, width: 0.46, open: 1.42, curl: 0.55, cup: 0.32, baseR: 0.14, y: 0.00 },
      { count: 8, length: 0.94, width: 0.44, open: 1.05, curl: 0.50, cup: 0.36, baseR: 0.12, y: 0.03 },
      { count: 7, length: 0.82, width: 0.40, open: 0.68, curl: 0.42, cup: 0.40, baseR: 0.10, y: 0.06 },
      { count: 5, length: 0.62, width: 0.34, open: 0.36, curl: 0.30, cup: 0.42, baseR: 0.08, y: 0.08 },
    ],
  },
  { // white lotus with a pink blush
    colors: { base: [0.95, 0.95, 0.86], mid: [0.97, 0.93, 0.92], tip: [0.95, 0.56, 0.68] },
    whorls: [
      { count: 9, length: 1.05, width: 0.40, open: 1.50, curl: 0.50, cup: 0.30, baseR: 0.14, y: 0.00 },
      { count: 9, length: 0.98, width: 0.40, open: 1.12, curl: 0.48, cup: 0.34, baseR: 0.12, y: 0.03 },
      { count: 6, length: 0.80, width: 0.38, open: 0.62, curl: 0.40, cup: 0.42, baseR: 0.10, y: 0.06 },
    ],
  },
  { // deep rose, more closed
    colors: { base: [0.95, 0.80, 0.74], mid: [0.90, 0.42, 0.62], tip: [0.70, 0.07, 0.30] },
    whorls: [
      { count: 7, length: 0.95, width: 0.48, open: 1.25, curl: 0.55, cup: 0.36, baseR: 0.13, y: 0.00 },
      { count: 7, length: 0.90, width: 0.46, open: 0.85, curl: 0.50, cup: 0.40, baseR: 0.11, y: 0.03 },
      { count: 6, length: 0.76, width: 0.40, open: 0.52, curl: 0.42, cup: 0.44, baseR: 0.09, y: 0.06 },
      { count: 4, length: 0.58, width: 0.34, open: 0.28, curl: 0.28, cup: 0.44, baseR: 0.07, y: 0.08 },
    ],
  },
];
const SEPAL_COLORS = { base: [0.30, 0.42, 0.16], mid: [0.42, 0.50, 0.22], tip: [0.62, 0.40, 0.36] };

/**
 * Shape grammar. Non-terminals expand into lists of symbols; terminals
 * (Petal, Pod, Seed, Stamen) are turned into geometry.
 *   Flower      → Sepals Whorl₀ … Whorlₙ Receptacle
 *   Sepals      → Petal⁴
 *   Whorlᵢ      → Petalⁿ (rotated by half a petal from the previous whorl)
 *   Receptacle  → Pod SeedRing SeedRing StamenRing StamenRing
 *   SeedRing    → Seedⁿ
 *   StamenRing  → Stamenⁿ
 */
function expandLotusGrammar(rng, style) {
  const J = a => (rng() * 2 - 1) * a;
  const ring = (n, phase, make) => Array.from({ length: n }, (_, i) => make(phase + i * Math.PI * 2 / n));
  const rules = {
    Flower: () => [
      ['Sepals', {}],
      ...style.whorls.map((w, i) => ['Whorl', { ...w, index: i }]),
      ['Receptacle', {}],
    ],
    Sepals: () => ring(4, rng() * Math.PI, az => ['Petal', {
      az, length: 0.55, width: 0.34, open: 1.62, curl: 0.15, cup: 0.25, baseR: 0.1, y: -0.02, colors: SEPAL_COLORS,
    }]),
    Whorl: w => ring(w.count, (w.index * Math.PI) / w.count + J(0.15), az => ['Petal', {
      az: az + J(0.07), length: w.length * (1 + J(0.07)), width: w.width * (1 + J(0.08)),
      open: w.open + J(0.08), curl: w.curl + J(0.06), cup: w.cup, baseR: w.baseR, y: w.y, colors: style.colors,
    }]),
    Receptacle: () => [
      ['Pod', {}],
      ['SeedRing', { count: 1, r: 0.0 }],
      ['SeedRing', { count: 7, r: 0.085 }],
      ['StamenRing', { count: 34, r: 0.14, length: 0.22 }],
      ['StamenRing', { count: 26, r: 0.11, length: 0.18 }],
    ],
    SeedRing: s => ring(s.count, rng(), az => ['Seed', { az, r: s.r }]),
    StamenRing: s => ring(s.count, rng(), az => ['Stamen', { az: az + J(0.05), r: s.r, length: s.length * (1 + J(0.15)), lean: 0.7 + J(0.18) }]),
  };
  const result = [];
  const stack = [['Flower', {}]];
  while (stack.length) {
    const [sym, params] = stack.pop();
    const rule = rules[sym];
    if (rule) { const prod = rule(params); for (let i = prod.length - 1; i >= 0; i--) stack.push(prod[i]); }
    else result.push([sym, params]);
  }
  return result;
}

const LOTUS_STRIDE = 11; // pos3 normal3 color3 uv2

/** Adds a parametric surface given as grid[i][j] = [x,y,z]. */
function addGrid(V, I, grid, colorFn, uvFn) {
  const nu = grid.length - 1, nv = grid[0].length - 1;
  const base = V.length / LOTUS_STRIDE;
  const normals = grid.map((row, i) => row.map((p, j) => {
    const pu = sub3(grid[Math.min(i + 1, nu)][j], grid[Math.max(i - 1, 0)][j]);
    const pv = sub3(grid[i][Math.min(j + 1, nv)], grid[i][Math.max(j - 1, 0)]);
    const n = cross3(pu, pv);
    const l = Math.hypot(n[0], n[1], n[2]);
    return l > 1e-9 ? [n[0] / l, n[1] / l, n[2] / l] : null;
  }));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    if (normals[i][j]) continue;
    const alt = (i > 0 && normals[i - 1][j]) || (i < nu && normals[i + 1][j]) || [0, 1, 0];
    normals[i][j] = alt;
  }
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv;
    const p = grid[i][j], n = normals[i][j], c = colorFn(u, v), t = uvFn(u, v);
    V.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], t[0], t[1]);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = base + i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
    I.push(a, c, b, b, c, d);
  }
}

function petalColor(c, u, v) {
  let col = mix3(c.base, c.mid, smooth(0.08, 0.55, u));
  col = mix3(col, c.tip, Math.pow(smooth(0.45, 1.0, u), 1.3));
  return mix3(col, c.tip, Math.pow(Math.abs(v), 4) * 0.25 * u);
}

function addPetal(V, I, P) {
  const nu = 14, nv = 8;
  const out = [Math.cos(P.az), 0, Math.sin(P.az)], tan = [-Math.sin(P.az), 0, Math.cos(P.az)];
  const du = P.length / nu;
  let cr = P.baseR, cy = P.y;
  const grid = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    if (i > 0) { const am = P.open - P.curl * (u - 0.5 / nu); cr += Math.sin(am) * du; cy += Math.cos(am) * du; }
    const ang = P.open - P.curl * u;
    const w = P.width * (Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.85) + 0.06 * (1 - u));
    const nOut = Math.cos(ang), nUp = -Math.sin(ang);   // petal's outer normal in the (outward, up) plane
    const row = [];
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      // cupping: the edges curl in toward the flower centre
      const cup = -P.cup * P.width * v * v * Math.sin(Math.PI * Math.min(u * 1.1, 1));
      const rib = 0.012 * (1 - Math.abs(v)) * Math.sin(Math.PI * u); // slight midrib ridge
      const r = cr + nOut * (cup + rib), y = cy + nUp * (cup + rib);
      const lat = v * w;
      row.push([out[0] * r + tan[0] * lat, y, out[2] * r + tan[2] * lat]);
    }
    grid.push(row);
  }
  addGrid(V, I, grid, (u, v) => petalColor(P.colors, u, v * 2 - 1), (u, v) => [u * 0.97, v * 2 - 1]);
}

function addLathe(V, I, profile, segs, center, colorFn) {
  const grid = profile.map(([r, y]) => {
    const row = [];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      row.push([center[0] + Math.cos(a) * r, center[1] + y, center[2] + Math.sin(a) * r]);
    }
    return row;
  });
  addGrid(V, I, grid, colorFn, () => [1, 0]);
}

function addPod(V, I) {
  const profile = [[0.05, 0.02], [0.085, 0.12], [0.13, 0.24], [0.165, 0.31], [0.17, 0.325], [0.14, 0.336], [0.07, 0.34], [0.0, 0.342]];
  addLathe(V, I, profile, 22, [0, 0, 0], u => (u < 0.5 ? mix3([0.45, 0.55, 0.16], [0.75, 0.72, 0.22], u * 2) : [0.92, 0.82, 0.30]));
}

function addSeed(V, I, P) {
  const c = [Math.cos(P.az) * P.r, 0.338, Math.sin(P.az) * P.r];
  addLathe(V, I, [[0.024, 0.0], [0.022, 0.008], [0.014, 0.014], [0.0, 0.016]], 8, c, () => [0.48, 0.52, 0.12]);
}

function addStamen(V, I, P) {
  const nu = 5;
  const out = [Math.cos(P.az), 0, Math.sin(P.az)], tan = [-Math.sin(P.az), 0, Math.cos(P.az)];
  let cr = P.r, cy = 0.06;
  const du = P.length / nu, hw = 0.008;
  const grid = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    if (i > 0) { const a = P.lean + 0.5 * u; cr += Math.sin(a) * du; cy += Math.cos(a) * du; }
    const w = u > 0.7 ? hw * 1.8 : hw; // anther is a little wider
    const row = [];
    for (let j = 0; j <= 1; j++) {
      const lat = (j * 2 - 1) * w;
      row.push([out[0] * cr + tan[0] * lat, cy, out[2] * cr + tan[2] * lat]);
    }
    grid.push(row);
  }
  addGrid(V, I, grid, u => (u > 0.7 ? [1.0, 0.62, 0.10] : [0.98, 0.80, 0.34]), () => [1, 0]);
}

/** Builds one lotus mesh variant. Returns interleaved vertices + indices. */
export function buildLotusMesh(seed, styleIndex = 0) {
  const rng = mulberry32(seed);
  const style = LOTUS_STYLES[styleIndex % LOTUS_STYLES.length];
  const V = [], I = [];
  for (const [sym, p] of expandLotusGrammar(rng, style)) {
    if (sym === 'Petal') addPetal(V, I, p);
    else if (sym === 'Pod') addPod(V, I, p);
    else if (sym === 'Seed') addSeed(V, I, p);
    else if (sym === 'Stamen') addStamen(V, I, p);
  }
  return { vertices: new Float32Array(V), indices: I };
}

// ---------------------------------------------------------------------------
// WGSL
// ---------------------------------------------------------------------------
const WGSL_COMMON = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  camPos: vec4f,      // xyz camera, w time
  sunDir: vec4f,
  sim: vec4f,         // x size, y N, z cell size
  screen: vec4f,      // w, h, 1/w, 1/h
  params: vec4f,      // x exposure, y flow speed, z fog density, w water level
  flowers: array<vec4f, 32>, // xyz position, w shadow radius
};
@group(0) @binding(0) var<uniform> F: Frame;

const PI: f32 = 3.14159265;
const ABSORB: vec3f = vec3f(0.46, 0.13, 0.10);
const SUN_COL: vec3f = vec3f(3.2, 2.75, 2.3);

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + vec2f(dot(q, q + 45.32));
  return fract(q.x * q.y);
}
fn hash22(p: vec2f) -> vec2f { return vec2f(hash21(p), hash21(p + vec2f(17.17, 31.7))); }
fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + vec3f(dot(q, q.zyx + 31.32));
  return fract((q.x + q.y) * q.z);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i++) {
    v += a * vnoise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i);
  let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));
  let x0 = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
  let x1 = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
  return mix(x0, x1, u.z);
}
fn fbm3(p: vec3f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    v += a * vnoise3(q);
    q = q * 2.02 + vec3f(3.1, 1.7, 5.3);
    a *= 0.5;
  }
  return v / 0.9375;
}

fn flowAt(p: vec2f) -> vec2f {
  let s = F.params.y;
  return s * vec2f(1.0 + 0.3 * sin(p.y * 0.11 + 0.7), 0.35 * sin(p.x * 0.08 + p.y * 0.05 + 1.9));
}

fn skyColor(d: vec3f, withSun: bool) -> vec3f {
  let L = F.sunDir.xyz;
  let y = clamp(d.y, 0.0, 1.0);
  let zen = vec3f(0.20, 0.36, 0.68);
  let hor = vec3f(0.98, 0.70, 0.58);
  var col = mix(hor, zen, pow(y, 0.4));
  let s = max(dot(d, L), 0.0);
  col += vec3f(1.0, 0.72, 0.48) * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.6);
  if (d.y > 0.0) {
    let uv = d.xz / (d.y + 0.12);
    let cl = smoothstep(0.48, 0.82, fbm(uv * 0.9 + vec2f(F.camPos.w * 0.008, 0.0)));
    let cloudCol = vec3f(1.0, 0.92, 0.88) * (0.85 + 0.5 * pow(s, 4.0));
    col = mix(col, cloudCol, cl * 0.5 * smoothstep(0.03, 0.3, d.y));
  }
  if (withSun) {
    col += vec3f(1.0, 0.9, 0.75) * smoothstep(0.9993, 0.9997, s) * 16.0;
  }
  return col;
}
fn horizonColor(dir: vec3f) -> vec3f {
  let d = normalize(vec3f(dir.x, 0.03, dir.z));
  let s = max(dot(d, F.sunDir.xyz), 0.0);
  return vec3f(0.98, 0.70, 0.58) * 0.97 + vec3f(1.0, 0.72, 0.48) * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.6);
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn toDisplay(c: vec3f) -> vec3f { return pow(aces(c * F.params.x), vec3f(1.0 / 2.2)); }

fn worleyEdge(p: vec2f, t: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let h = hash22(i + g);
      let o = 0.5 + 0.42 * sin(t * (0.5 + 0.5 * h) + 6.2831 * h);
      let d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}
fn caustic(p: vec2f, t: f32) -> f32 {
  let w = vec2f(vnoise(p * 0.6 + vec2f(t * 0.15, 0.0)), vnoise(p * 0.6 + vec2f(4.0, t * 0.13))) * 0.9;
  let a = worleyEdge(p + w, t);
  let b = worleyEdge(p * 1.37 + vec2f(5.2, 1.3) - w, t * 1.21);
  return pow(exp(-a * 7.0) + exp(-b * 8.0) * 0.75, 1.6) * 0.55;
}
`;

const WGSL_RIPPLE = /* wgsl */ `
@group(0) @binding(1) var<storage, read> ripple: array<vec2f>;
fn rippleCell(ix: i32, iy: i32) -> f32 {
  let n = i32(F.sim.y);
  if (ix < 0 || iy < 0 || ix >= n || iy >= n) { return 0.0; }
  return ripple[u32(iy * n + ix)].x;
}
fn rippleH(p: vec2f) -> f32 {
  let g = (p / F.sim.x + 0.5) * F.sim.y - 0.5;
  let i = floor(g);
  let f = g - i;
  let ix = i32(i.x);
  let iy = i32(i.y);
  let a = rippleCell(ix, iy);
  let b = rippleCell(ix + 1, iy);
  let c = rippleCell(ix, iy + 1);
  let d = rippleCell(ix + 1, iy + 1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn rippleGrad(p: vec2f) -> vec2f {
  let e = F.sim.z;
  return vec2f(rippleH(p + vec2f(e, 0.0)) - rippleH(p - vec2f(e, 0.0)),
               rippleH(p + vec2f(0.0, e)) - rippleH(p - vec2f(0.0, e))) / (2.0 * e);
}
`;

const WGSL_LIGHT = /* wgsl */ `
fn flowerShadow(p: vec3f) -> f32 {
  let L = F.sunDir.xyz;
  var s = 1.0;
  for (var k = 0; k < 32; k++) {
    let fl = F.flowers[k];
    if (fl.w <= 0.0) { continue; }
    let t = max(fl.y - p.y, 0.0) / max(L.y, 0.2);
    let q = p.xz + L.xz * t;
    let d = distance(q, fl.xz);
    let blur = fl.w * (0.7 + 0.08 * t);
    s *= 1.0 - 0.5 * (1.0 - smoothstep(fl.w * 0.2, blur, d));
  }
  return s;
}
fn underwaterLight(p: vec3f, n: vec3f) -> vec3f {
  let L = F.sunDir.xyz;
  let ly = max(L.y, 0.25);
  let depth = max(F.params.w - p.y, 0.0);
  let underwater = smoothstep(0.0, 0.25, depth);
  let sunT = exp(-ABSORB * depth / ly);
  let surf = p.xz + L.xz / ly * depth * 0.75;
  let warp = rippleGrad(surf) * 8.0;
  let t = F.camPos.w;
  let cz = caustic(surf * 0.85 + warp - vec2f(F.params.y * t * 0.35, 0.0), t);
  let caus = mix(1.0, 0.3 + cz * 2.4 * (1.0 + 0.8 * length(warp)), underwater);
  let diff = max(dot(n, L), 0.0);
  let sun = SUN_COL * sunT * diff * caus * flowerShadow(p);
  let amb = mix(vec3f(0.55, 0.62, 0.74), vec3f(0.16, 0.38, 0.42), underwater) * (0.35 + 0.25 * n.y);
  return sun + amb;
}
`;

const WGSL_FULLSCREEN_VS = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> FsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: FsOut;
  o.pos = vec4f(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}
`;

const WGSL_SKY = WGSL_COMMON + WGSL_FULLSCREEN_VS + /* wgsl */ `
@fragment fn fs(i: FsOut) -> @location(0) vec4f {
  let wp = F.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let dir = normalize(wp.xyz / wp.w - F.camPos.xyz);
  return vec4f(skyColor(dir, true), 9000.0);
}
`;

const WGSL_COMPOSITE = WGSL_COMMON + WGSL_FULLSCREEN_VS + /* wgsl */ `
@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@fragment fn fs(i: FsOut) -> @location(0) vec4f {
  let c = textureLoad(sceneTex, vec2i(i.pos.xy), 0);
  return vec4f(toDisplay(c.rgb), 1.0);
}
`;

const WGSL_SIM = WGSL_COMMON + /* wgsl */ `
struct Sim { drops: array<vec4f, 16>, info: vec4f }; // info: count, dt, damping, stiffness
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(3) var<uniform> S: Sim;

fn cellS(ix: i32, iy: i32) -> vec2f {
  let n = i32(F.sim.y);
  if (ix < 0 || iy < 0 || ix >= n || iy >= n) { return vec2f(0.0); }
  return src[u32(iy * n + ix)];
}
fn sampleS(g: vec2f) -> vec2f {
  let i = floor(g);
  let f = g - i;
  let ix = i32(i.x);
  let iy = i32(i.y);
  return mix(mix(cellS(ix, iy), cellS(ix + 1, iy), f.x), mix(cellS(ix, iy + 1), cellS(ix + 1, iy + 1), f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = u32(F.sim.y);
  if (id.x >= n || id.y >= n) { return; }
  let world = (vec2f(id.xy) + 0.5) * F.sim.z - 0.5 * F.sim.x;
  // semi-Lagrangian advection: ripples drift with the current
  let g = vec2f(id.xy) - flowAt(world) * S.info.y / F.sim.z;
  let c = sampleS(g);
  let avg = (sampleS(g + vec2f(-1.0, 0.0)).x + sampleS(g + vec2f(1.0, 0.0)).x +
             sampleS(g + vec2f(0.0, -1.0)).x + sampleS(g + vec2f(0.0, 1.0)).x) * 0.25;
  let v = (c.y + (avg - c.x) * S.info.w) * S.info.z;
  var h = (c.x + v) * 0.9995;
  let count = u32(S.info.x);
  for (var i = 0u; i < count; i++) {
    let d = S.drops[i];
    let dist = distance(world, d.xy);
    if (dist < d.z) { h -= d.w * (0.5 + 0.5 * cos(PI * dist / d.z)); }
  }
  let e = f32(min(min(id.x, id.y), min(n - 1u - id.x, n - 1u - id.y)));
  let fade = mix(0.95, 1.0, smoothstep(0.0, 12.0, e));
  dst[id.y * n + id.x] = vec2f(h, v) * fade;
}
`;

const WGSL_BED = WGSL_COMMON + WGSL_RIPPLE + WGSL_LIGHT + /* wgsl */ `
struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) nrm: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f) -> VOut {
  var o: VOut;
  o.world = p;
  o.nrm = n;
  o.pos = F.viewProj * vec4f(p, 1.0);
  return o;
}
fn pebbles(p: vec2f) -> vec4f {
  let i = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  var id = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = hash22(i + g) * 0.8 + 0.1;
      let d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; id = i + g; } else if (d < f2) { f2 = d; }
    }
  }
  let h = hash21(id * 1.37);
  var c = mix(vec3f(0.40, 0.34, 0.26), vec3f(0.56, 0.53, 0.48), h);
  c = mix(c, vec3f(0.26, 0.25, 0.24), step(0.8, hash21(id + vec2f(3.3, 7.1))));
  c = mix(c, vec3f(0.62, 0.50, 0.38), step(0.9, hash21(id + vec2f(9.1, 2.4))));
  return vec4f(c, smoothstep(0.0, 0.2, f2 - f1));
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = i.world;
  let n = normalize(i.nrm);
  let dist = distance(F.camPos.xyz, p);
  let detail = 1.0 - smoothstep(25.0, 70.0, dist);
  let pa = pebbles(p.xz * 2.6);
  let pb = pebbles(p.xz * 6.0 + vec2f(11.0, 4.0));
  var alb = mix(pa.rgb * (0.5 + 0.5 * pa.a), pb.rgb * (0.6 + 0.4 * pb.a), 0.35);
  alb = mix(vec3f(0.44, 0.40, 0.33), alb, detail);
  let sand = vec3f(0.62, 0.55, 0.42) * (0.9 + 0.2 * vnoise(p.xz * 9.0));
  alb = mix(alb, sand, smoothstep(0.45, 0.68, fbm(p.xz * 0.15)));
  alb *= 0.85 + 0.3 * fbm(p.xz * 0.6 + vec2f(4.0, 1.0));
  alb = mix(alb, vec3f(0.22, 0.30, 0.14), smoothstep(0.55, 0.8, fbm(p.xz * 0.35 + vec2f(9.0, 3.0))) * 0.5);
  return vec4f(alb * underwaterLight(p, n), dist);
}
`;

const WGSL_ROCK = WGSL_COMMON + WGSL_RIPPLE + WGSL_LIGHT + /* wgsl */ `
override MIRROR: f32 = 0.0;
struct VIn {
  @location(0) p: vec3f, @location(1) n: vec3f,
  @location(2) ipos: vec4f,   // xyz position, w rotation around Y
  @location(3) iscale: vec4f, // xyz scale, w seed
};
struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) nrm: vec3f, @location(2) obj: vec3f };
@vertex fn vs(v: VIn) -> VOut {
  let c = cos(v.ipos.w);
  let s = sin(v.ipos.w);
  let sp = v.p * v.iscale.xyz;
  var w = vec3f(c * sp.x + s * sp.z, sp.y, -s * sp.x + c * sp.z) + v.ipos.xyz;
  let sn = v.n / v.iscale.xyz;
  var o: VOut;
  o.world = w;
  o.nrm = normalize(vec3f(c * sn.x + s * sn.z, sn.y, -s * sn.x + c * sn.z));
  o.obj = v.p * 1.2 + vec3f(v.iscale.w * 13.0);
  if (MIRROR > 0.5) { w.y = 2.0 * F.params.w - w.y; }
  o.pos = F.viewProj * vec4f(w, 1.0);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (MIRROR > 0.5 && i.world.y < F.params.w) { discard; }
  let n = normalize(i.nrm);
  let q = i.obj;
  let nz = fbm3(q * 1.3);
  let speck = vnoise3(q * 7.0);
  var alb = mix(vec3f(0.28, 0.27, 0.25), vec3f(0.52, 0.47, 0.40), nz);
  alb = mix(alb, vec3f(0.20, 0.19, 0.18), smoothstep(0.62, 0.9, speck) * 0.6);
  alb = mix(alb, vec3f(0.60, 0.56, 0.50), smoothstep(0.8, 0.95, vnoise3(q * 2.5 + vec3f(7.0))) * 0.5);
  let under = step(i.world.y, F.params.w);
  let moss = smoothstep(0.3, 0.85, n.y) * smoothstep(0.42, 0.7, fbm3(q * 2.2 + vec3f(5.0)));
  alb = mix(alb, vec3f(0.15, 0.23, 0.08), moss * mix(0.35, 0.85, under));
  alb *= mix(1.0, 0.72, under);
  var col = alb * underwaterLight(i.world, n);
  let band = 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.22, abs(i.world.y - F.params.w - 0.06)));
  col *= band;
  if (under < 0.5) {
    let V = normalize(F.camPos.xyz - i.world);
    let H = normalize(F.sunDir.xyz + V);
    col += SUN_COL * pow(max(dot(n, H), 0.0), 24.0) * 0.04;
  }
  if (MIRROR > 0.5) { return vec4f(col, 1.0); }
  return vec4f(col, distance(F.camPos.xyz, i.world));
}
`;

const WGSL_WATER = WGSL_COMMON + WGSL_RIPPLE + /* wgsl */ `
@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var reflTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };
@vertex fn vs(@location(0) xz: vec2f) -> VOut {
  var o: VOut;
  let w = vec3f(xz.x, F.params.w + rippleH(xz), xz.y);
  o.world = w;
  o.pos = F.viewProj * vec4f(w, 1.0);
  return o;
}
fn detail(q: vec2f) -> f32 {
  return vnoise(q) * 0.5 + vnoise(q * 2.13 + vec2f(3.1, 1.7)) * 0.3 + vnoise(q * 4.37 + vec2f(7.3, 2.9)) * 0.15;
}
// Surface height: flow-mapped noise (two phases cross-faded) streaked along the current, plus a slow swell.
fn waveH(p: vec2f) -> f32 {
  let t = F.camPos.w;
  let fl = flowAt(p);
  let dir = normalize(fl + vec2f(1e-4, 0.0));
  let per = vec2f(-dir.y, dir.x);
  let cycle = 4.0;
  let ph0 = fract(t / cycle);
  let ph1 = fract(t / cycle + 0.5);
  let w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  let p0 = p - fl * ph0 * cycle;
  let p1 = p - fl * ph1 * cycle + vec2f(17.3, 9.1);
  let s = vec2f(0.6, 1.6);
  let q0 = vec2f(dot(p0, dir), dot(p0, per)) * s;
  let q1 = vec2f(dot(p1, dir), dot(p1, per)) * s;
  let d = detail(q0) * w0 + detail(q1) * (1.0 - w0);
  let sw = sin(dot(p, vec2f(0.21, 0.07)) - t * 0.9) * 0.6
         + sin(dot(p, vec2f(-0.05, 0.31)) - t * 0.7) * 0.4
         + sin(dot(p, vec2f(0.6, 0.45)) - t * 1.7) * 0.12;
  return d * 0.6 + sw * 0.22;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let cam = F.camPos.xyz;
  let toCam = cam - i.world;
  let dist = length(toCam);
  let V = toCam / dist;
  let p = i.world.xz;
  let e = 0.04;
  let h0 = waveH(p);
  let hx = waveH(p + vec2f(e, 0.0));
  let hz = waveH(p + vec2f(0.0, e));
  let amp = 0.1 / (1.0 + dist * 0.04);
  let g = vec2f(hx - h0, hz - h0) / e * amp + rippleGrad(p) * 5.0;
  let N = normalize(vec3f(-g.x, 1.0, -g.y));
  let L = F.sunDir.xyz;
  let uv = i.pos.xy * F.screen.zw;

  // Refraction of the riverbed (scene alpha holds distance to camera)
  let raw = textureSampleLevel(sceneTex, samp, uv, 0.0);
  let thick0 = max(raw.a - dist, 0.0);
  let offs = N.xz * 0.1 * clamp(thick0 * 0.35, 0.0, 1.0) / (1.0 + dist * 0.05);
  var sc = textureSampleLevel(sceneTex, samp, uv + offs, 0.0);
  if (sc.a < dist) { sc = raw; }
  let thick = max(sc.a - dist, 0.0);
  let trans = exp(-ABSORB * thick);
  let deep = vec3f(0.035, 0.15, 0.19) * (0.6 + 0.6 * max(L.y, 0.0));
  let refr = sc.rgb * trans + deep * (1.0 - trans);

  // Reflection: sky + mirrored flowers/rocks
  let R = reflect(-V, N);
  var refl = skyColor(vec3f(R.x, abs(R.y), R.z), false);
  let rs = textureSampleLevel(reflTex, samp, uv + N.xz * 0.04, 0.0);
  refl = mix(refl, rs.rgb, clamp(rs.a, 0.0, 1.0));
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  var col = mix(refr, refl, fres);
  let rl = max(dot(R, L), 0.0);
  col += SUN_COL * (pow(rl, 900.0) * 30.0 + pow(rl, 80.0) * 0.25) * (1.0 - clamp(rs.a, 0.0, 1.0));

  let fogAmt = 1.0 - exp(-dist * F.params.z);
  col = mix(col, horizonColor(-V), fogAmt);
  return vec4f(toDisplay(col), 1.0);
}
`;

const WGSL_LOTUS = WGSL_COMMON + /* wgsl */ `
override MIRROR: f32 = 0.0;
struct VIn {
  @location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f, @location(3) uv: vec2f,
  @location(4) ipos: vec4f,  // xyz position, w scale
  @location(5) irot: vec4f,  // quaternion
};
struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) nrm: vec3f, @location(2) col: vec3f, @location(3) uv: vec2f };
fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  var w = qrot(v.irot, v.p * v.ipos.w) + v.ipos.xyz;
  o.world = w;
  o.nrm = qrot(v.irot, v.n);
  o.col = v.c;
  o.uv = v.uv;
  if (MIRROR > 0.5) { w.y = 2.0 * F.params.w - w.y; }
  o.pos = F.viewProj * vec4f(w, 1.0);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (MIRROR > 0.5 && i.world.y < F.params.w) { discard; }
  var cam = F.camPos.xyz;
  if (MIRROR > 0.5) { cam.y = 2.0 * F.params.w - cam.y; }
  let V = normalize(cam - i.world);
  var n = normalize(i.nrm);
  if (dot(n, V) < 0.0) { n = -n; }
  let L = F.sunDir.xyz;
  var base = i.col;
  base *= 1.0 - 0.08 * pow(abs(cos(i.uv.y * 9.0)), 6.0) * step(i.uv.x, 0.98); // petal veins
  let diff = max(dot(n, L), 0.0);
  let back = max(dot(-n, L), 0.0);
  let skyAmb = mix(vec3f(0.42, 0.40, 0.38), vec3f(0.62, 0.70, 0.85), n.y * 0.5 + 0.5);
  let trans = SUN_COL * base * base * (back * 0.9 + pow(max(dot(-V, L), 0.0), 6.0) * 0.3);
  let H = normalize(L + V);
  let spec = pow(max(dot(n, H), 0.0), 40.0) * 0.06;
  var col = base * (SUN_COL * diff * 0.7 + skyAmb * 0.6) + trans + SUN_COL * spec;
  col *= mix(0.55, 1.0, smoothstep(0.0, 0.45, i.uv.x));
  if (i.world.y < F.params.w) { col *= vec3f(0.55, 0.78, 0.78); }
  if (MIRROR > 0.5) { return vec4f(col, 1.0); }
  let dist = distance(F.camPos.xyz, i.world);
  col = mix(col, horizonColor(i.world - F.camPos.xyz), 1.0 - exp(-dist * F.params.z));
  return vec4f(toDisplay(col), 1.0);
}
`;

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------
export class LotusWaterScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.pixelRatio]      max device pixel ratio (default 1.5)
   * @param {number} [options.flowSpeed]       current speed in units/s (default 0.6)
   * @param {number} [options.maxFlowers]      max flowers alive (default 26, cap 32)
   * @param {number} [options.spawnInterval]   average seconds between falling flowers (default 2.2)
   * @param {number} [options.exposure]        tone-mapping exposure (default 0.75)
   * @param {(flying:boolean)=>void} [options.onFlyModeChange]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.opts = {
      pixelRatio: 1.5, flowSpeed: 0.6, maxFlowers: 26, spawnInterval: 2.2, exposure: 0.75,
      onFlyModeChange: null, ...options,
    };
    this.opts.maxFlowers = Math.min(MAX_FLOWERS, this.opts.maxFlowers);
    this.running = false;
    this.ready = null;
    this.time = 0;
    this.lastNow = 0;
    this.simAcc = 0;
    this.pendingDrops = [];
    this.flowers = [];
    this.spawnTimer = 0.5;
    this.ambientDropTimer = 0.5;
    this.rocks = [];
    this.uniformData = new Float32Array(180);
    this.simDropData = new Float32Array(68);
    this.simNoneData = new Float32Array(68);
    this.lotusInstanceData = new Float32Array(MAX_FLOWERS * 8);
    this.size = [0, 0];
    // camera
    this.flying = false;
    this.manualCamera = false;
    this.cam = { pos: [0, 6, 16], yaw: 0, pitch: -0.3 };
    this.keys = new Set();
    this.pointerLocked = false;
    this._bindInput();
  }

  static isSupported() { return typeof navigator !== 'undefined' && !!navigator.gpu; }

  /** Starts rendering (initialises WebGPU on first call). */
  async start() {
    if (!this.ready) this.ready = this._init();
    await this.ready;
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    const loop = now => {
      if (!this.running) return;
      this._frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }

  dispose() {
    this.stop();
    this._unbindInput();
    if (this.device) this.device.destroy();
    this.device = null;
  }

  /** Returns to the slow automatic camera drift. */
  resetCamera() { this.manualCamera = false; this._setFlying(false); }

  get isFlying() { return this.flying; }

  // ------------------------------------------------------------------ init
  async _init() {
    if (!LotusWaterScene.isSupported()) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter found.');
    const device = await adapter.requestDevice();
    this.device = device;
    device.addEventListener('uncapturederror', e => console.error('[LotusWaterScene] WebGPU error:', e.error.message));
    device.lost.then(info => { if (info.reason !== 'destroyed') console.error('[LotusWaterScene] device lost:', info.message); });

    this.context = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });

    this._createResources();
    await this._createPipelines();
    this._createScene();
  }

  _buffer(data, usage) {
    const buf = this.device.createBuffer({ size: Math.ceil(data.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    const Ctor = data.constructor;
    new Ctor(buf.getMappedRange(0, data.byteLength)).set(data);
    buf.unmap();
    return buf;
  }

  _createResources() {
    const d = this.device;
    this.frameUBO = d.createBuffer({ size: this.uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.simDropUBO = d.createBuffer({ size: 272, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.simNoneUBO = d.createBuffer({ size: 272, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const rippleBytes = SIM_N * SIM_N * 8;
    this.rippleA = d.createBuffer({ size: rippleBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.rippleB = d.createBuffer({ size: rippleBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.lotusInstances = d.createBuffer({ size: this.lotusInstanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    const V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE;
    this.bgl0 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V | Fr, buffer: { type: 'read-only-storage' } },
    ] });
    this.bgl1 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 1, visibility: Fr, sampler: { type: 'filtering' } },
      { binding: 2, visibility: Fr, texture: { sampleType: 'float' } },
    ] });
    this.bglSim = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'uniform' } },
    ] });
    this.bg0 = d.createBindGroup({ layout: this.bgl0, entries: [
      { binding: 0, resource: { buffer: this.frameUBO } },
      { binding: 1, resource: { buffer: this.rippleA } },
    ] });
    const simBG = (src, dst, params) => d.createBindGroup({ layout: this.bglSim, entries: [
      { binding: 0, resource: { buffer: this.frameUBO } },
      { binding: 1, resource: { buffer: src } },
      { binding: 2, resource: { buffer: dst } },
      { binding: 3, resource: { buffer: params } },
    ] });
    this.simAB_drop = simBG(this.rippleA, this.rippleB, this.simDropUBO);
    this.simAB_none = simBG(this.rippleA, this.rippleB, this.simNoneUBO);
    this.simBA_none = simBG(this.rippleB, this.rippleA, this.simNoneUBO);
  }

  async _module(code, label) {
    const m = this.device.createShaderModule({ code, label });
    const info = await m.getCompilationInfo();
    for (const msg of info.messages) {
      const fn = msg.type === 'error' ? console.error : console.warn;
      fn(`[LotusWaterScene] ${label} ${msg.type} (${msg.lineNum}:${msg.linePos}): ${msg.message}`);
    }
    return m;
  }

  async _createPipelines() {
    const d = this.device;
    const [sky, composite, sim, bed, rock, water, lotus] = await Promise.all([
      this._module(WGSL_SKY, 'sky'), this._module(WGSL_COMPOSITE, 'composite'), this._module(WGSL_SIM, 'sim'),
      this._module(WGSL_BED, 'bed'), this._module(WGSL_ROCK, 'rock'), this._module(WGSL_WATER, 'water'),
      this._module(WGSL_LOTUS, 'lotus'),
    ]);
    const layoutA = d.createPipelineLayout({ bindGroupLayouts: [this.bgl0] });
    const layoutB = d.createPipelineLayout({ bindGroupLayouts: [this.bgl0, this.bgl1] });

    this.simPipeline = d.createComputePipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.bglSim] }),
      compute: { module: sim, entryPoint: 'main' },
    });

    const make = ({ module, layout, buffers = [], format, cull = 'none', depthWrite = true, depthCompare = 'less', constants }) =>
      d.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: 'vs', buffers, ...(constants ? { constants } : {}) },
        fragment: { module, entryPoint: 'fs', targets: [{ format }], ...(constants ? { constants } : {}) },
        primitive: { topology: 'triangle-list', cullMode: cull },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: depthWrite, depthCompare },
      });

    const posNrm = { arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ] };
    const rockInst = { arrayStride: 32, stepMode: 'instance', attributes: [
      { shaderLocation: 2, offset: 0, format: 'float32x4' },
      { shaderLocation: 3, offset: 16, format: 'float32x4' },
    ] };
    const lotusVert = { arrayStride: LOTUS_STRIDE * 4, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' },
      { shaderLocation: 3, offset: 36, format: 'float32x2' },
    ] };
    const lotusInst = { arrayStride: 32, stepMode: 'instance', attributes: [
      { shaderLocation: 4, offset: 0, format: 'float32x4' },
      { shaderLocation: 5, offset: 16, format: 'float32x4' },
    ] };

    this.pSky = make({ module: sky, layout: layoutA, format: HDR_FORMAT, depthWrite: false, depthCompare: 'always' });
    this.pBed = make({ module: bed, layout: layoutA, buffers: [posNrm], format: HDR_FORMAT, cull: 'none' });
    this.pRock = make({ module: rock, layout: layoutA, buffers: [posNrm, rockInst], format: HDR_FORMAT, constants: { MIRROR: 0 } });
    this.pRockMirror = make({ module: rock, layout: layoutA, buffers: [posNrm, rockInst], format: HDR_FORMAT, constants: { MIRROR: 1 } });
    this.pLotusMirror = make({ module: lotus, layout: layoutA, buffers: [lotusVert, lotusInst], format: HDR_FORMAT, constants: { MIRROR: 1 } });
    this.pComposite = make({ module: composite, layout: layoutB, format: this.format, depthWrite: false, depthCompare: 'always' });
    this.pWater = make({ module: water, layout: layoutB, buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }], format: this.format });
    this.pLotus = make({ module: lotus, layout: layoutA, buffers: [lotusVert, lotusInst], format: this.format, constants: { MIRROR: 0 } });
  }

  _createScene() {
    const d = this.device;
    const rng = mulberry32(1234);

    // water + riverbed
    const water = buildWaterGrid();
    this.waterVB = this._buffer(water.vertices, GPUBufferUsage.VERTEX);
    this.waterIB = this._buffer(water.indices, GPUBufferUsage.INDEX);
    this.waterCount = water.indices.length;
    const bed = buildBedGrid();
    this.bedVB = this._buffer(bed.vertices, GPUBufferUsage.VERTEX);
    this.bedIB = this._buffer(bed.indices, GPUBufferUsage.INDEX);
    this.bedCount = bed.indices.length;

    // rocks: 5 shape variants, instanced
    const variants = 5;
    const rockV = [], rockI = [];
    this.rockDraws = [];
    let vOff = 0;
    for (let s = 0; s < variants; s++) {
      const m = buildRockMesh(s * 7 + 3);
      this.rockDraws.push({ firstIndex: rockI.length, indexCount: m.indices.length, instances: [] });
      for (const i of m.indices) rockI.push(i + vOff);
      for (const f of m.vertices) rockV.push(f);
      vOff += m.vertices.length / 6;
    }
    const place = (x, z, sx, sy, sz, breach) => {
      const by = bedHeight(x, z);
      if (breach) sy = (0.45 - by) / 1.15;
      else if (by + sy * 1.3 > -0.35) sy = Math.max(0.2, (-0.35 - by) / 1.3);
      const variant = Math.floor(rng() * variants);
      this.rockDraws[variant].instances.push([x, by, z, rng() * Math.PI * 2, sx, sy, sz, rng() * 10]);
      if (breach) this.rocks.push({ x, z, r: Math.max(sx, sz) * 1.05 });
    };
    place(7, -5, 1.7, 0, 1.4, true);
    place(-10, 2, 1.3, 0, 1.6, true);
    place(18, -12, 1.5, 0, 1.2, true);
    for (let i = 0; i < 70; i++) {
      const far = i > 55;
      const x = (rng() * 2 - 1) * (far ? 70 : 34), z = (rng() * 2 - 1) * (far ? 60 : 30);
      const s = 0.35 + Math.pow(rng(), 2.5) * 2.2;
      place(x, z, s * (0.8 + rng() * 0.5), s * (0.45 + rng() * 0.4), s * (0.8 + rng() * 0.5), false);
    }
    // small pebble clusters around the big ones
    for (let i = 0; i < 50; i++) {
      const x = (rng() * 2 - 1) * 30, z = (rng() * 2 - 1) * 26, s = 0.15 + rng() * 0.25;
      place(x, z, s, s * 0.6, s * 1.2, false);
    }
    const inst = [];
    for (const dr of this.rockDraws) {
      dr.firstInstance = inst.length / 8;
      dr.instanceCount = dr.instances.length;
      for (const r of dr.instances) inst.push(...r);
    }
    this.rockVB = this._buffer(new Float32Array(rockV), GPUBufferUsage.VERTEX);
    this.rockIB = this._buffer(new Uint32Array(rockI), GPUBufferUsage.INDEX);
    this.rockInstVB = this._buffer(new Float32Array(inst), GPUBufferUsage.VERTEX);

    // lotus variants
    const lv = [], li = [];
    this.lotusDraws = [];
    let lOff = 0;
    for (let s = 0; s < LOTUS_STYLES.length; s++) {
      const m = buildLotusMesh(100 + s * 31, s);
      this.lotusDraws.push({ firstIndex: li.length, indexCount: m.indices.length });
      for (const i of m.indices) li.push(i + lOff);
      for (const f of m.vertices) lv.push(f);
      lOff += m.vertices.length / LOTUS_STRIDE;
    }
    this.lotusVB = this._buffer(new Float32Array(lv), GPUBufferUsage.VERTEX);
    this.lotusIB = this._buffer(new Uint32Array(li), GPUBufferUsage.INDEX);

    // a few flowers already drifting when the page opens
    for (let i = 0; i < 9; i++) this._spawnFlower(true);
    d.queue.writeBuffer(this.rippleA, 0, new Float32Array(SIM_N * SIM_N * 2));
  }

  _resizeIfNeeded() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.pixelRatio);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.size[0] && h === this.size[1] && this.hdrTex) return;
    this.size = [w, h];
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of [this.hdrTex, this.reflTex, this.depthTex, this.reflDepthTex]) t?.destroy();
    const tex = (format, usage) => this.device.createTexture({ size: [w, h], format, usage });
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    this.hdrTex = tex(HDR_FORMAT, RA | TB);
    this.reflTex = tex(HDR_FORMAT, RA | TB);
    this.depthTex = tex(DEPTH_FORMAT, RA);
    this.reflDepthTex = tex(DEPTH_FORMAT, RA);
    this.bg1 = this.device.createBindGroup({ layout: this.bgl1, entries: [
      { binding: 0, resource: this.hdrTex.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: this.reflTex.createView() },
    ] });
  }

  // ------------------------------------------------------------------ input
  _bindInput() {
    this._onKeyDown = e => {
      if (e.key === 'Alt') {
        e.preventDefault();
        if (!e.repeat) this._setFlying(!this.flying);
        return;
      }
      if (e.key === 'Escape' && this.flying) { this._setFlying(false); return; }
      if (this.flying) {
        this.keys.add(e.code);
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
      }
    };
    this._onKeyUp = e => { if (e.key === 'Alt') e.preventDefault(); this.keys.delete(e.code); };
    this._onMouseMove = e => {
      if (!this.flying) return;
      this.cam.yaw += e.movementX * 0.0025;
      this.cam.pitch = Math.max(-1.45, Math.min(1.45, this.cam.pitch - e.movementY * 0.0025));
    };
    this._onBlur = () => { this.keys.clear(); this._setFlying(false); };
    this._onLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked && !locked) this._setFlying(false);
      this.pointerLocked = locked;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  _unbindInput() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }

  _setFlying(on) {
    if (on === this.flying) return;
    this.flying = on;
    if (on) {
      if (!this.manualCamera) {
        // take over from the automatic camera without a jump
        const { eye, target } = this._autoCamera(this.time);
        const f = normalize3(sub3(target, eye));
        this.cam.pos = eye;
        this.cam.yaw = Math.atan2(f[0], -f[2]);
        this.cam.pitch = Math.asin(f[1]);
        this.manualCamera = true;
      }
      try {
        const r = this.canvas.requestPointerLock?.();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_) { /* mouse still works without pointer lock */ }
    } else {
      this.keys.clear();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    this.opts.onFlyModeChange?.(on);
  }

  _autoCamera(t) {
    return {
      eye: [Math.sin(t * 0.045) * 5, 6.2 + Math.sin(t * 0.07) * 0.7, 15 + Math.cos(t * 0.035) * 2.5],
      target: [Math.sin(t * 0.03) * 2.5, -0.5, -3],
    };
  }

  _updateCamera(dt) {
    if (!this.manualCamera) return this._autoCamera(this.time);
    const c = this.cam;
    const cp = Math.cos(c.pitch);
    const fwd = [Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp];
    const right = [Math.cos(c.yaw), 0, Math.sin(c.yaw)];
    if (this.flying) {
      const k = this.keys;
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 18 : 6) * dt;
      const mv = [0, 0, 0];
      const add = (v, s) => { mv[0] += v[0] * s; mv[1] += v[1] * s; mv[2] += v[2] * s; };
      if (k.has('KeyW')) add(fwd, 1);
      if (k.has('KeyS')) add(fwd, -1);
      if (k.has('KeyD')) add(right, 1);
      if (k.has('KeyA')) add(right, -1);
      if (k.has('KeyE') || k.has('Space')) mv[1] += 1;
      if (k.has('KeyQ')) mv[1] -= 1;
      const l = Math.hypot(mv[0], mv[1], mv[2]);
      if (l > 0) for (let i = 0; i < 3; i++) c.pos[i] += (mv[i] / l) * speed;
      c.pos[0] = Math.max(-150, Math.min(150, c.pos[0]));
      c.pos[2] = Math.max(-150, Math.min(150, c.pos[2]));
      c.pos[1] = Math.max(0.4, Math.min(60, c.pos[1]));
    }
    return { eye: c.pos.slice(), target: [c.pos[0] + fwd[0], c.pos[1] + fwd[1], c.pos[2] + fwd[2]] };
  }

  // ------------------------------------------------------------------ flowers
  _spawnFlower(floating) {
    const r = Math.random;
    const f = {
      variant: Math.floor(r() * LOTUS_STYLES.length),
      scale: 0.7 + r() * 0.4,
      x: floating ? -26 + r() * 46 : -24 + r() * 36,
      z: floating ? -18 + r() * 28 : -16 + r() * 26,
      y: floating ? 0 : 12 + r() * 8,
      vx: 0, vz: 0,
      vy: -(1.3 + r() * 0.7),
      yaw: r() * Math.PI * 2,
      spin: (r() - 0.5) * 2.5,
      phase: r() * 100,
      tiltX: 0, tiltZ: 0, tiltAmp: 0,
      state: floating ? 'float' : 'fall',
      age: floating ? r() * 30 : 0,
      landT: floating ? 10 : 0,
      appear: floating ? 1 : 0,
      fade: 1,
    };
    if (floating) [f.vx, f.vz] = flowAt(f.x, f.z, this.opts.flowSpeed);
    this.flowers.push(f);
  }

  _updateFlowers(dt) {
    const t = this.time, speed = this.opts.flowSpeed;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      if (this.flowers.length < this.opts.maxFlowers) this._spawnFlower(false);
      this.spawnTimer = this.opts.spawnInterval * (0.5 + Math.random());
    }
    this.ambientDropTimer -= dt;
    if (this.ambientDropTimer <= 0) {
      this.ambientDropTimer = 0.4 + Math.random() * 0.9;
      this._drop((Math.random() * 2 - 1) * 26, (Math.random() * 2 - 1) * 24, 0.3, 0.012);
    }

    for (const f of this.flowers) {
      f.age += dt;
      f.appear = Math.min(1, f.appear + dt * 0.8);
      if (f.state === 'fall') {
        f.y += f.vy * dt;
        f.x += (0.35 + Math.sin(t * 0.9 + f.phase) * 0.6) * dt;
        f.z += Math.cos(t * 0.7 + f.phase * 1.3) * 0.5 * dt;
        f.yaw += f.spin * dt;
        f.tiltX = 0.5 * Math.sin(t * 1.6 + f.phase);
        f.tiltZ = 0.5 * Math.cos(t * 1.25 + f.phase * 1.7);
        if (f.y <= 0) {
          f.y = 0; f.state = 'float'; f.landT = 0; f.tiltAmp = 0.45;
          f.vx = 0.35; f.vz = 0;
          this._drop(f.x, f.z, 0.9 * f.scale, 0.35 * f.scale);
        }
      } else {
        f.landT += dt;
        const [fx, fz] = flowAt(f.x, f.z, speed);
        const k = Math.min(1, dt * 0.8);
        f.vx += (fx * 0.9 - f.vx) * k;
        f.vz += (fz * 0.9 - f.vz) * k;
        f.x += f.vx * dt; f.z += f.vz * dt;
        f.spin *= Math.exp(-dt * 0.6);
        f.yaw += (f.spin * 0.5 + 0.06 * Math.sin(f.phase)) * dt;
        f.tiltAmp *= Math.exp(-dt * 2.2);
        f.tiltX = f.tiltAmp * Math.sin(f.landT * 5 + f.phase) + 0.035 * Math.sin(t * 1.3 + f.phase);
        f.tiltZ = f.tiltAmp * Math.cos(f.landT * 4.3 + f.phase) + 0.035 * Math.cos(t * 1.1 + f.phase);
        f.y = -0.14 * Math.exp(-f.landT * 3) * Math.cos(f.landT * 7) + 0.02 * Math.sin(t * 1.5 + f.phase) - 0.015;
        if (f.state === 'float' && (f.x > 28 || f.x < -45 || Math.abs(f.z) > 28 || f.age > 160)) f.state = 'fade';
        if (f.state === 'fade') f.fade -= dt * 0.4;
      }
    }
    // keep floating flowers from overlapping each other and the rocks above water
    const fl = this.flowers.filter(f => f.state !== 'fall');
    for (let i = 0; i < fl.length; i++) {
      const a = fl[i];
      for (let j = i + 1; j < fl.length; j++) {
        const b = fl[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1e-3;
        const min = (a.scale + b.scale) * 0.95;
        if (d < min) {
          const push = (min - d) * 0.5 * Math.min(1, dt * 4) / d;
          a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push;
        }
      }
      for (const r of this.rocks) {
        const dx = a.x - r.x, dz = a.z - r.z, d = Math.hypot(dx, dz) || 1e-3;
        const min = r.r + a.scale * 0.9;
        if (d < min) { a.x = r.x + dx / d * min; a.z = r.z + dz / d * min; a.vz += Math.sign(dz || 1) * 0.1; }
      }
    }
    this.flowers = this.flowers.filter(f => f.fade > 0);
  }

  _drop(x, z, radius, strength) {
    if (Math.abs(x) > SIM_SIZE / 2 - 2 || Math.abs(z) > SIM_SIZE / 2 - 2) return;
    this.pendingDrops.push([x, z, radius, strength]);
    if (this.pendingDrops.length > 64) this.pendingDrops.shift();
  }

  // ------------------------------------------------------------------ frame
  _frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.time += dt;
    this._resizeIfNeeded();
    this._updateFlowers(dt);
    const { eye, target } = this._updateCamera(dt);

    const d = this.device;
    const [w, h] = this.size;
    const proj = mat4Perspective((50 * Math.PI) / 180, w / h, 0.1, 1200);
    const viewProj = mat4Mul(proj, mat4LookAt(eye, target, [0, 1, 0]));
    const u = this.uniformData;
    u.set(viewProj, 0);
    u.set(mat4Invert(viewProj), 16);
    u.set([eye[0], eye[1], eye[2], this.time], 32);
    u.set([SUN_DIR[0], SUN_DIR[1], SUN_DIR[2], 1], 36);
    u.set([SIM_SIZE, SIM_N, SIM_SIZE / SIM_N, 0], 40);
    u.set([w, h, 1 / w, 1 / h], 44);
    u.set([this.opts.exposure, this.opts.flowSpeed, 0.0065, 0], 48);
    u.fill(0, 52);

    // flower instances (grouped by variant) + shadow casters
    const counts = this.lotusDraws.map(() => 0);
    for (const f of this.flowers) counts[f.variant]++;
    const starts = [];
    let acc = 0;
    for (let i = 0; i < counts.length; i++) { starts.push(acc); acc += counts[i]; }
    const cursor = starts.slice();
    this.flowers.forEach((f, i) => {
      const q = quatMul(quatMul(quatAxisAngle(1, 0, 0, f.tiltX), quatAxisAngle(0, 0, 1, f.tiltZ)), quatAxisAngle(0, 1, 0, f.yaw));
      const ap = f.appear * f.appear * (3 - 2 * f.appear);
      const s = f.scale * ap * Math.max(0, Math.min(1, f.fade));
      this.lotusInstanceData.set([f.x, f.y, f.z, s, q[0], q[1], q[2], q[3]], cursor[f.variant]++ * 8);
      if (i < MAX_FLOWERS) u.set([f.x, f.y, f.z, 0.85 * s], 52 + i * 4);
    });
    d.queue.writeBuffer(this.frameUBO, 0, u);
    if (this.flowers.length) d.queue.writeBuffer(this.lotusInstances, 0, this.lotusInstanceData, 0, this.flowers.length * 8);

    // ripple simulation: fixed 120 Hz, run as A→B→A pairs
    this.simAcc += dt;
    let pairs = 0;
    while (this.simAcc >= 1 / 60 && pairs < 3) { this.simAcc -= 1 / 60; pairs++; }
    if (pairs === 3) this.simAcc = 0;
    const enc = d.createCommandEncoder();
    if (pairs > 0) {
      const drops = this.pendingDrops.splice(0, MAX_DROPS);
      this.simDropData.fill(0);
      drops.forEach((dr, i) => this.simDropData.set(dr, i * 4));
      this.simDropData.set([drops.length, 1 / 120, 0.997, 0.06], 64);
      this.simNoneData.set([0, 1 / 120, 0.997, 0.06], 64);
      d.queue.writeBuffer(this.simDropUBO, 0, this.simDropData);
      d.queue.writeBuffer(this.simNoneUBO, 0, this.simNoneData);
      const cp = enc.beginComputePass();
      cp.setPipeline(this.simPipeline);
      const wg = Math.ceil(SIM_N / 8);
      for (let p = 0; p < pairs; p++) {
        cp.setBindGroup(0, p === 0 ? this.simAB_drop : this.simAB_none);
        cp.dispatchWorkgroups(wg, wg);
        cp.setBindGroup(0, this.simBA_none);
        cp.dispatchWorkgroups(wg, wg);
      }
      cp.end();
    }

    const drawRocks = pass => {
      pass.setVertexBuffer(0, this.rockVB);
      pass.setVertexBuffer(1, this.rockInstVB);
      pass.setIndexBuffer(this.rockIB, 'uint32');
      for (const r of this.rockDraws) if (r.instanceCount) pass.drawIndexed(r.indexCount, r.instanceCount, r.firstIndex, 0, r.firstInstance);
    };
    const drawLotus = pass => {
      pass.setVertexBuffer(0, this.lotusVB);
      pass.setVertexBuffer(1, this.lotusInstances);
      pass.setIndexBuffer(this.lotusIB, 'uint32');
      this.lotusDraws.forEach((l, i) => { if (counts[i]) pass.drawIndexed(l.indexCount, counts[i], l.firstIndex, 0, starts[i]); });
    };

    // 1) reflection pass: flowers and rock tops mirrored in the water plane
    let pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.reflTex.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.reflDepthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    pass.setBindGroup(0, this.bg0);
    pass.setPipeline(this.pRockMirror); drawRocks(pass);
    if (this.flowers.length) { pass.setPipeline(this.pLotusMirror); drawLotus(pass); }
    pass.end();

    // 2) underwater scene: sky, riverbed, rocks → HDR texture (alpha = distance)
    pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.hdrTex.createView(), clearValue: [0, 0, 0, 9000], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setBindGroup(0, this.bg0);
    pass.setPipeline(this.pSky); pass.draw(3);
    pass.setPipeline(this.pBed);
    pass.setVertexBuffer(0, this.bedVB); pass.setIndexBuffer(this.bedIB, 'uint32');
    pass.drawIndexed(this.bedCount);
    pass.setPipeline(this.pRock); drawRocks(pass);
    pass.end();

    // 3) final: composite, water surface, flowers → screen
    pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthTex.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    pass.setBindGroup(0, this.bg0);
    pass.setBindGroup(1, this.bg1);
    pass.setPipeline(this.pComposite); pass.draw(3);
    pass.setPipeline(this.pWater);
    pass.setVertexBuffer(0, this.waterVB); pass.setIndexBuffer(this.waterIB, 'uint32');
    pass.drawIndexed(this.waterCount);
    if (this.flowers.length) { pass.setPipeline(this.pLotus); drawLotus(pass); }
    pass.end();

    d.queue.submit([enc.finish()]);
  }
}

export default LotusWaterScene;
