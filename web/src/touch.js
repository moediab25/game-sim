// ===== shared touch-screen config + shape recogniser (used by both mazes) =====
const BUTTON_SYMBOLS = ["triangle", "circle", "square", "cross"];   // physical button positions: top, right, bottom, left
const RIDDLES = [                                                   // touch-screen riddles -> symbol to draw
  { text: "I have 3 sides and 3 vertices. Draw me.", shape: "triangle" },
  { text: "A warning sign and a pyramid's face share my outline. Three straight lines close me.", shape: "triangle" },
  { text: "No corners and no end. A wheel follows my outline.", shape: "circle" },
  { text: "Every point of me is the same distance from my centre. Draw me.", shape: "circle" },
  { text: "Four equal sides and four right angles.", shape: "square" },
  { text: "A window pane has my outline: four corners, all square.", shape: "square" },
  { text: "Two straight lines cross in my middle. X marks the spot.", shape: "cross" },
  { text: "I am the sign for 'add'. Draw me.", shape: "cross" },
];
const COMPASS_CYCLE = [3, 1, 2, 0];   // clockwise from the needle: FLIP (up), PUSH-RIGHT, DROP (down), PUSH-LEFT
const PEEK_SEC = 5, PEEKS_PER_RUN = 2, IDLE_SUBMIT = 1.2;           // touch screen timings (s)
const RECOG = { minDiag: 40, closeGap: 0.30, straightDev: 0.09, polyEps: 0.08, minTurnDeg: 35, circleRadial: 0.22 };

// ---- touch-screen shape recogniser (pure geometry, tolerant of hand-drawn strokes) ----
const _d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const _len = p => { let L = 0; for (let i = 1; i < p.length; i++) L += _d(p[i - 1], p[i]); return L; };
function _resample(p, n) {
  const L = _len(p), step = L / (n - 1), out = [p[0]]; let acc = 0, prev = p[0];
  for (let i = 1; i < p.length; i++) {
    let seg = _d(prev, p[i]);
    while (acc + seg >= step && seg > 0) { const t = (step - acc) / seg; prev = [prev[0] + t * (p[i][0] - prev[0]), prev[1] + t * (p[i][1] - prev[1])]; out.push(prev); seg = _d(prev, p[i]); acc = 0; }
    acc += seg; prev = p[i];
  }
  while (out.length < n) out.push(p[p.length - 1]);
  return out;
}
function _rdp(p, eps) {
  if (p.length < 3) return p.slice();
  const a = p[0], b = p[p.length - 1]; let md = -1, mi = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
    const dd = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (dd > md) { md = dd; mi = i; }
  }
  if (md > eps) { const l = _rdp(p.slice(0, mi + 1), eps), r = _rdp(p.slice(mi), eps); return l.slice(0, -1).concat(r); }
  return [a, b];
}
function _lineHit(a, b, c, d) {          // infinite-line intersection, returns [t,u] along ab and cd
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return [t, u];
}
// strokes: array of arrays of [x,y]. Returns {shape:"triangle"|"circle"|"square"|"cross"|null, why}
function _smooth(p, n = 40) {            // even spacing + light moving average, endpoints kept
  const r = _resample(p, n);
  return r.map((q, i) => (i === 0 || i === n - 1) ? q : [(r[i - 1][0] + q[0] + r[i + 1][0]) / 3, (r[i - 1][1] + q[1] + r[i + 1][1]) / 3]);
}
function _straightness(s) {              // max distance from the chord, relative to stroke length (0 = ruler straight)
  const a = s[0], b = s[s.length - 1], L = _d(a, b) || 1e-9; let m = 0;
  for (const q of s) m = Math.max(m, Math.abs((b[1] - a[1]) * q[0] - (b[0] - a[0]) * q[1] + b[0] * a[1] - b[1] * a[0]) / L);
  return m / (_len(s) || 1);
}
function classifyStrokes(strokes) {
  strokes = strokes.filter(s => s.length > 1 && _len(s) > 6).map(s => _smooth(s));
  const all = [].concat(...strokes);
  if (!all.length) return { shape: null, why: "nothing drawn" };
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (diag < RECOG.minDiag) return { shape: null, why: "too small" };
  if (strokes.length === 2) {            // cross: two straight strokes meeting near their middles
    const ok = strokes.every(s => _straightness(s) < RECOG.straightDev && _len(s) > 0.35 * diag);
    if (ok) {
      const [a, b] = [strokes[0], strokes[1]], h = _lineHit(a[0], a[a.length - 1], b[0], b[b.length - 1]);
      if (h && h[0] > 0.2 && h[0] < 0.8 && h[1] > 0.2 && h[1] < 0.8) {
        const v1 = [a[a.length - 1][0] - a[0][0], a[a.length - 1][1] - a[0][1]], v2 = [b[b.length - 1][0] - b[0][0], b[b.length - 1][1] - b[0][1]];
        const ang = Math.acos(Math.abs(v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2)));
        if (ang > 35 * Math.PI / 180) return { shape: "cross", why: "two crossing lines" };
      }
    }
    return { shape: null, why: "two strokes that do not form a cross" };
  }
  if (strokes.length > 2) return { shape: null, why: "too many strokes" };
  if (_d(all[0], all[all.length - 1]) > RECOG.closeGap * diag) return { shape: null, why: "shape is not closed" };
  let p = _resample(all, 72); p.push(p[0]);
  // find the corners: simplify, then drop vertices that barely turn
  let far = 0; p.forEach((q, i) => { if (_d(q, p[0]) > _d(p[far], p[0])) far = i; });      // split the loop so RDP has a real chord
  let v = _rdp(p.slice(0, far + 1), RECOG.polyEps * diag).slice(0, -1).concat(_rdp(p.slice(far), RECOG.polyEps * diag).slice(0, -1));
  const turn = i => { const a = v[(i + v.length - 1) % v.length], b = v[i], c = v[(i + 1) % v.length];
    let t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI; return Math.abs(t); };   // heading change, 0 = straight on
  let corners = v.filter((_, i) => turn(i) * 180 / Math.PI > RECOG.minTurnDeg);
  const cx_ = p.reduce((s, q) => s + q[0], 0) / p.length, cy_ = p.reduce((s, q) => s + q[1], 0) / p.length;
  const rs = p.map(q => Math.hypot(q[0] - cx_, q[1] - cy_)), mean = rs.reduce((a, b) => a + b) / rs.length;
  const radial = Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / rs.length) / mean;
  if (corners.length === 3) return { shape: "triangle", why: "3 corners" };
  if (corners.length === 4) return { shape: "square", why: "4 corners" };
  if (corners.length >= 5 && radial < RECOG.circleRadial) return { shape: "circle", why: "round, " + corners.length + " bends" };
  return { shape: null, why: `unclear (${corners.length} corners, radial ${radial.toFixed(2)})` };
}
// deterministic synthetic hand-drawn strokes for the load-time self-test
function _synth(shape, rnd, jitter) {
  const J = () => (rnd() - .5) * 2 * jitter, S = 100, off = [60 + rnd() * 30, 60 + rnd() * 30], rot = (rnd() - .5) * .3;
  const T = ([x, y]) => [off[0] + (x * Math.cos(rot) - y * Math.sin(rot)) + J(), off[1] + (x * Math.sin(rot) + y * Math.cos(rot)) + J()];
  const line = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * i / (n - 1), a[1] + (b[1] - a[1]) * i / (n - 1)]);
  const poly = (vs, start) => { const o = []; for (let i = 0; i < vs.length; i++) { const a = vs[(i + start) % vs.length], b = vs[(i + start + 1) % vs.length]; o.push(...line(a, b, 14).slice(0, -1)); } o.push(vs[start % vs.length]); return o.map(T); };
  const st = Math.floor(rnd() * 3);
  if (shape === "triangle") return [poly([[0, -S / 2], [S / 2, S / 2], [-S / 2, S / 2]], st)];
  if (shape === "square") return [poly([[-S / 2, -S / 2], [S / 2, -S / 2], [S / 2, S / 2], [-S / 2, S / 2]], st)];
  if (shape === "circle") { const a0 = rnd() * 6.28; return [Array.from({ length: 60 }, (_, i) => T([S / 2 * Math.cos(a0 + i / 58 * 6.28), S / 2 * Math.sin(a0 + i / 58 * 6.28)]))]; }
  return [line([-S / 2, 0], [S / 2, 0], 20).map(T), line([0, -S / 2], [0, S / 2], 20).map(T)];
}
function recogniserTest() {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let ok = 0, n = 0; const fails = [];
  for (const sh of BUTTON_SYMBOLS) for (let i = 0; i < 25; i++) { n++; const r = classifyStrokes(_synth(sh, rnd, 3)); if (r.shape === sh) ok++; else fails.push(sh + ":" + r.why); }
  return { ok, n, fails: fails.slice(0, 4) };
}

