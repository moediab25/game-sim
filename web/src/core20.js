// ===================== CONFIG: original 20x20 maze (edit me) =====================
const CODE = ["red", "green", "black", "yellow"];          // correct dot order
// Dot recesses: the first 4 (in CODE order) are the coloured dots, the rest are decoys.
const DOTS = [
  { name: "red",    c: 14, r: 7,  rgb: "#e53935" },
  { name: "green",  c: 18, r: 12, rgb: "#2e9e4f" },
  { name: "black",  c: 17, r: 6,  rgb: "#111111" },
  { name: "yellow", c: 15, r: 3,  rgb: "#f2c200" },
];
const DECOYS = [[16, 17], [2, 16], [11, 16], [14, 14], [11, 11], [1, 9], [7, 6], [2, 1]];
const EXIT = [10, 0];                                       // real exit; the other two bottom holes are drains
const HOLES = [[7, 0], [10, 0], [17, 0]];
const CPS = [[6, 14], [13, 14], [5, 9], [12, 9], [10, 4], [8, 1]];
const ENTRY = [9, 18];
// Plate from the SolidWorks drawing: 819 mm wide; maze area 795 x 1200 mm (20 x 20 cells of 39.75 x 60 mm)
const COLS = 20, ROWS = 20, CELL_W = 39.75, CELL_H = 60, X0 = 12, Y0 = 34.5, PW = 819, PH = 1269;
const DRIFT_P = 0.2;            // chance per open side that a falling ball is jostled sideways in a floorless cell
const ACT_WINDOW = 0.45, LIFT_DELAY = 4.0;
const H_LINES = ["11111111111111111111","01110100011001010001","00101011000110101110","01000010110011010001","10100100101110010010","01101011011010001001","10010111010011000100","00000000001101100011","01111100100010100101","01010010010101000010","01001011100010110100","00110111111101101011","00000110010001000110","01011110000001010010","10010101001010101001","01011001111101000110","10100010100110100100","01001000101100011011","10001101011000100111","00100111100110011110","11111111111111111111"];
const V_LINES = ["11111111111111111111","01100011111100000001","01011110000111101010","00100001111010011101","01101011000010101010","00011110111000011100","01100001000001111111","00010011110010001100","11111010100111011000","01000111011010100100","00110001110011010001","11100110101110101011","01011010011111000100","10000001101000011110","01010100000110101110","00101011111110110000","01010110110110111100","10111011010001001101","11011110101101100000","00000100010010010000","11111111111111111111"];
// id, type (f floor / p push), mount (f floor / s side / r roof), push dir, col, row
const GATE_SRC = `F1 f f - 10 18|F2 f f - 4 8|F3 f f - 5 6|F4 f f - 14 11|F5 f f - 8 11|F6 f f - 8 3|F7 f f - 2 11|F8 f f - 17 8|F9 f f - 19 7|F10 f f - 10 7|F11 f f - 6 13|F12 f f - 12 6|F13 f f - 16 2|F14 f f - 9 15|F15 f f - 6 2|F16 f f - 15 13|F17 f f - 6 16|F18 f f - 0 4|F19 f f - 12 3|F20 f f - 17 12|<21 p r L 7 18|<22 p s L 8 17|>23 p r R 7 14|<24 p s L 10 14|<25 p s L 13 12|<26 p s L 2 8|<27 p r L 5 11|<28 p s L 10 11|<29 p s L 12 8|<30 p s L 17 10|>31 p r R 6 5|>32 p s R 9 6|>33 p s R 13 7|>34 p s R 16 5|>35 p s R 0 0|<36 p r L 5 0|<37 p s L 10 1|<38 p s L 14 2|<39 p s L 19 3`;
const GATES = GATE_SRC.split("|").map(s => { const [id, t, m, p, c, r] = s.split(" ");
  return { id, type: t === "f" ? "floor" : "push", mount: m === "f" ? "floor" : m === "s" ? "side" : "roof", push: p === "-" ? null : p, col: +c, row: +r }; });
// Player buttons: the four hidden actions of the original brief
const KINDS = ["PUSH-LEFT", "PUSH-RIGHT", "DROP", "LIFT"];
const ACTION_OF_KIND = ["LEFT", "RIGHT", "FLOOR", "LIFT"];
// ================================================================================

const key = (c, r) => c + "," + r;
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
const inList = (l, c) => l.some(x => eq(x, c));
const dotIdx = (c, r) => DOTS.findIndex(d => d.c === c && d.r === r);
const cpIdx = (c, r) => CPS.findIndex(p => p[0] === c && p[1] === r);
const GATE_AT = {}; GATES.forEach(g => (GATE_AT[key(g.col, g.row)] = GATE_AT[key(g.col, g.row)] || []).push(g));

class Maze {
  constructor(roofWorks) {
    this.roof = roofWorks; this.slots = {};
    for (const g of GATES) {
      const s = this.slots[key(g.col, g.row)] = this.slots[key(g.col, g.row)] || {};
      if (g.type === "floor") s.floor = g; else if (g.mount === "roof" && !roofWorks) s["dead" + g.push] = g; else s[g.push] = g;
    }
  }
  hasFloor(c, r) { return r === 0 || H_LINES[r][c] === "1"; }
  wall(c, r, d) { return V_LINES[d > 0 ? c + 1 : c][r] === "1"; }
  // Ball arrives in (c,r): fall until a floor holds it. In a floorless cell it may be jostled sideways.
  // Returns [[prob, path, "rest"|"hole"], ...]; path = [[c,r,kind], ...] with the first entry "start".
  settle(c, r, path, drifts = 2, p0 = DRIFT_P) {
    if (this.hasFloor(c, r)) return [[1, path, inList(HOLES, [c, r]) ? "hole" : "rest"]];
    const sides = drifts > 0 ? [-1, 1].filter(d => !this.wall(c, r, d)) : [], out = [], pf = 1 - p0 * sides.length;
    for (const o of this.settle(c, r - 1, path.concat([[c, r - 1, "fall"]]), drifts, p0)) out.push([pf * o[0], o[1], o[2]]);
    for (const d of sides) for (const o of this.settle(c + d, r, path.concat([[c + d, r, "drift"]]), drifts - 1, p0)) out.push([p0 * o[0], o[1], o[2]]);
    return out;
  }
  release(cell) { return this.settle(cell[0], cell[1], [[cell[0], cell[1], "start"]]); }
  wobbleOptions(cell) {                   // a resting ball may roll one cell sideways where there is no wall
    const [c, r] = cell, o = [];
    for (const d of [-1, 1]) if (!this.wall(c, r, d)) o.push(this.settle(c + d, r, [[c, r, "start"], [c + d, r, "roll"]]));
    return o;
  }
  // Button action at the ball's cell. action: LEFT | RIGHT | FLOOR | WOBBLE. Returns [gate|null, outcomes] or null.
  act(cell, action) {
    const [c, r] = cell, s = this.slots[key(c, r)] || {};
    if (action === "WOBBLE") { const o = this.wobbleOptions(cell); return o.length ? [null, [].concat(...o.map(x => x.map(y => [y[0] / o.length, y[1], y[2]])))] : null; }
    if (action === "FLOOR" && s.floor) return [s.floor, this.settle(c, r - 1, [[c, r, "start"], [c, r - 1, "fall"]])];
    if (action === "LEFT" || action === "RIGHT") {
      const k = action === "LEFT" ? "L" : "R", d = action === "LEFT" ? -1 : 1;
      if (s[k] && !this.wall(c, r, d)) return [s[k], this.settle(c + d, r, [[c, r, "start"], [c + d, r, "push"]])];
    }
    return null;
  }
}

// ---- code / progress bookkeeping: dots must be hit in CODE order; a later dot too early resets the code ----
function touchCell(st, c, r) {            // st = {prog, cp}
  let { prog, cp } = st; const ci = cpIdx(c, r), di = dotIdx(c, r);
  if (ci >= 0) cp = ci;
  if (di >= 0) { if (di === prog) prog++; else if (di > prog) prog = 0; }
  return { prog, cp };
}
function applyPath(st, path) { for (let i = 1; i < path.length; i++) st = touchCell(st, path[i][0], path[i][1]); return st; }
const CP_CELL = cp => cp >= 0 ? CPS[cp] : ENTRY;
const skey = s => s.c + "," + s.r + "," + s.prog + "," + s.cp;

// BFS over (cell, progress, last checkpoint). Assumes lucky rolls: every random outcome is a possible edge.
// Returns the shortest list of steps: {act, cell, path, term, lift?:{path}} or null.  `from` lets the caller re-plan mid-run.
function solveFrom(maze, from) {
  const start = from || (() => { const o = maze.release(ENTRY)[0], st = applyPath({ prog: 0, cp: -1 }, o[1]); const e = o[1][o[1].length - 1]; return { c: e[0], r: e[1], prog: st.prog, cp: st.cp }; })();
  const seen = new Map([[skey(start), null]]), q = [start], cache = new Map();
  const edges = st => {
    const out = [];
    for (const act of ["LEFT", "RIGHT", "FLOOR", "LIFT", "WOBBLE"]) {
      let outs;
      if (act === "LIFT") { outs = maze.release(CP_CELL(st.cp)); }
      else { const ck = st.c + "," + st.r + act; if (!cache.has(ck)) cache.set(ck, maze.act([st.c, st.r], act)); const r = cache.get(ck); if (!r) continue; outs = r[1]; }
      for (const [, path, term] of outs) out.push({ act, path, term });
    }
    return out;
  };
  for (let qi = 0; qi < q.length; qi++) {
    const st = q[qi];
    for (const e of edges(st)) {
      let p = applyPath({ prog: st.prog, cp: st.cp }, e.path); const end = e.path[e.path.length - 1], step = { act: e.act, cell: [st.c, st.r], path: e.path, term: e.term };
      if (e.term === "hole") {
        if (eq([end[0], end[1]], EXIT) && p.prog === 4) {
          const acts = [step]; let k = skey(st); while (seen.get(k)) { const pv = seen.get(k); acts.push(pv.step); k = pv.from; }
          return acts.reverse();
        }
        // drain: the belt lift returns the ball to the last checkpoint
        for (const [, p2, t2] of maze.release(CP_CELL(p.cp))) {
          if (t2 !== "rest") continue; const pp = applyPath(p, p2), e2 = p2[p2.length - 1], ns = { c: e2[0], r: e2[1], prog: pp.prog, cp: pp.cp }, nk = skey(ns);
          if (!seen.has(nk)) { seen.set(nk, { from: skey(st), step: Object.assign({ lift: { path: p2 } }, step) }); q.push(ns); }
        }
        continue;
      }
      const ns = { c: end[0], r: end[1], prog: p.prog, cp: p.cp }, nk = skey(ns);
      if (!seen.has(nk)) { seen.set(nk, { from: skey(st), step }); q.push(ns); }
    }
  }
  return null;
}
const solve = () => solveFrom(new Maze(false));

function selfCheck() {
  const log = [], ok = [], m = new Maze(false);
  const dimOk = H_LINES.length === 21 && V_LINES.length === 21 && H_LINES.every(r => r.length === 20) && V_LINES.every(r => r.length === 20);
  ok.push(dimOk); log.push(`layout: ${H_LINES.length} horizontal and ${V_LINES.length} vertical wall lines, ${dimOk ? "all 20 long" : "BAD LENGTH"}`);
  const nf = GATES.filter(g => g.type === "floor").length, np = GATES.length - nf;
  ok.push(nf === 20 && np === 19); log.push(`gates: ${nf} floor + ${np} push = ${GATES.length} (${GATES.filter(g => g.mount === "roof").length} roof push gates are dead unless "Roof gates work")`);
  const bad = GATES.filter(g => { const w = g.type === "floor" ? H_LINES[g.row][g.col] === "1" : g.mount === "roof" ? H_LINES[g.row + 1][g.col] === "1" : V_LINES[g.push === "L" ? g.col + 1 : g.col][g.row] === "1"; return !w; });
  ok.push(bad.length === 0); log.push(`every gate replaces a wall segment: ${bad.length ? "NOT for " + bad.map(g => g.id) : "yes"}`);
  // reachability by rolls (all random outcomes allowed) and by gate presses
  const seen = new Set(), todo = []; const cps = new Set(), holes = new Set();
  const take = outs => { for (const [, path, term] of outs) { for (const [c, r] of path) { const ci = cpIdx(c, r); if (ci >= 0 && !cps.has(ci)) { cps.add(ci); take(m.release(CPS[ci])); } }
    if (term === "rest") todo.push(path[path.length - 1].slice(0, 2)); else holes.add(path[path.length - 1][0] + "," + path[path.length - 1][1]); } };
  take(m.release(ENTRY));
  while (todo.length) { const c = todo.pop(), k = key(...c); if (seen.has(k)) continue; seen.add(k); for (const a of ["LEFT", "RIGHT", "FLOOR", "WOBBLE"]) { const r = m.act(c, a); if (r) take(r[1]); } }
  const gReach = GATES.filter(g => seen.has(key(g.col, g.row))).length;
  log.push(`reachable resting cells: ${seen.size}; checkpoints reached: ${cps.size}/6; bottom holes reached: ${[...holes].join(" ")}; gates in reachable cells: ${gReach}/39 (non-roof: ${GATES.filter(g => g.mount !== "roof" && seen.has(key(g.col, g.row))).length}/${GATES.filter(g => g.mount !== "roof").length})`);
  ok.push(cps.size === 6 && holes.has(EXIT.join(",")));
  // with no button press the ball never wins: only wobbles and lifts, no gate fired
  const st0 = { c: ENTRY[0], r: ENTRY[1] }, rolled = new Set([key(st0.c, st0.r)]), q2 = [st0]; let canWin = false;
  while (q2.length) { const c = q2.pop(); const r = m.act([c.c, c.r], "WOBBLE"); if (!r) continue; for (const [, path, term] of r[1]) { const e = path[path.length - 1]; if (term === "hole") { if (eq([e[0], e[1]], EXIT)) canWin = true; } else if (!rolled.has(key(e[0], e[1]))) { rolled.add(key(e[0], e[1])); q2.push({ c: e[0], r: e[1] }); } } }
  ok.push(!canWin); log.push(`no button presses: ball can drift over ${rolled.size} cells but ${canWin ? "REACHES the exit (bad)" : "never reaches the exit"}`);
  const t0 = performance.now(), sol = solve(), dt = performance.now() - t0;
  ok.push(!!sol);
  if (sol) { const g = sol.filter(s => s.act !== "WOBBLE" && s.act !== "LIFT").length; log.push(`shortest winning plan: ${sol.length} steps (${g} gate presses, ${sol.filter(s => s.act === "LIFT").length} lifts, ${sol.filter(s => s.act === "WOBBLE").length} wait-for-roll steps), solved in ${dt.toFixed(0)} ms`); }
  else log.push("NO winning plan found");
  const rt = recogniserTest(); ok.push(rt.ok === rt.n);
  log.push(`touch recogniser: ${rt.ok}/${rt.n} noisy synthetic drawings recognised${rt.fails.length ? " (misses: " + rt.fails.join("; ") + ")" : ""}`);
  ok.push(LIFT_DELAY + 0.5 <= 20); log.push(`ball re-home: chute 0.5 s + belt/tube ${LIFT_DELAY} s = ${(LIFT_DELAY + 0.5).toFixed(1)} s (target <= 20 s)`);
  return { ok: ok.every(Boolean), log, sol };
}
