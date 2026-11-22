// ===================== CONFIG (edit me) =====================
const CODE = ["red", "green", "black", "yellow"];          // correct dot order
const LAYOUT = [                                           // [downhill name, cells]  S1..S10 (k = 0..9)
  "DGSSSSSSSSDpSSGSSSS.",  // S1  L
  ".SSSSSSSSSgpqDSSSSGD",  // S2  R
  "DSGSSSSSSSSSDpSSSSf.",  // S3  L
  "..SSSSSSSSSSqDSSSSGD",  // S4  R
  "DGSSSSSDpSSSSSSSSSS.",  // S5  L
  ".SSGSSSgSqDSSSSSSSGD",  // S6  R
  "DSGSSSSSSDpSGSSSfSS.",  // S7  L
  "..SSSSSfSqDSSSSSSSGD",  // S8  R
  "DGSSSqSSSSSSDpSSSSS.",  // S9  L
  ".SSSSSSfSSSqDSSSSSXD",  // S10 R
];
const DOTS = [                                             // k = shelf index (S2 -> 1)
  { name: "red",    k: 1, c: 1, rgb: "#e53935" },
  { name: "green",  k: 3, c: 2, rgb: "#2e9e4f" },
  { name: "black",  k: 5, c: 4, rgb: "#111111" },
  { name: "yellow", k: 7, c: 2, rgb: "#f2c200" },
];
const CHECKPOINTS = [                                      // feed port side: L or R
  { k: 1, c: 1, side: "L" }, { k: 3, c: 2, side: "L" }, { k: 4, c: 18, side: "R" },
  { k: 6, c: 18, side: "R" }, { k: 8, c: 18, side: "R" }, { k: 9, c: 1, side: "L" },
];
const ENTRY = { k: 0, c: 18 };
// Actuator ids from the spec: [id, shelf S#, column, cell letter]
const ACT_TABLE = [
  ["G1",1,1,"G"],["G2",1,14,"G"],["G3",2,18,"G"],["G4",3,2,"G"],["G5",4,18,"G"],["G6",5,1,"G"],
  ["G7",6,3,"G"],["G8",6,18,"G"],["G9",7,2,"G"],["G10",7,12,"G"],["G11",8,18,"G"],["G12",9,1,"G"],
  ["P1",1,11,"p"],["P2",2,11,"p"],["P3",2,12,"q"],["P4",3,13,"p"],["P5",4,12,"q"],["P6",5,8,"p"],
  ["P7",6,9,"q"],["P8",7,10,"p"],["P9",8,9,"q"],["P10",9,5,"q"],["P11",9,13,"p"],["P12",10,11,"q"],
  ["F1",2,10,"g"],["F2",3,18,"f"],["F3",6,7,"g"],["F4",7,16,"f"],["F5",8,7,"f"],["F6",10,7,"f"],
];
// Player buttons: 4 action kinds, mapping reshuffled after every run
const KINDS = ["PUSH-LEFT", "PUSH-RIGHT", "DROP", "FLIP"];
const NCOL = 20, NSH = 10, PITCH = 39.75, SPITCH = 120, PW = 795, PH = 1200;
const SLOPE_DEG = 3, ACC = 9.81 * Math.sin(SLOPE_DEG * Math.PI / 180) * 5 / 7;   // m/s^2 (~0.37)
const ACT_WINDOW = 0.6, LIFT_DELAY = 4.0;
// ============================================================

const DIR = k => (k % 2 === 0 ? -1 : 1);                   // downhill direction
const cellCh = (k, c) => (k >= 0 && k < NSH && c >= 0 && c < NCOL ? LAYOUT[k][c] : null);
const isActuator = ch => "Gpqfg".includes(ch);
const kindOfCh = ch => ch === "p" ? 0 : ch === "q" ? 1 : ch === "G" ? 2 : (ch === "f" || ch === "g") ? 3 : -1;
const ACT_ID = {}; ACT_TABLE.forEach(a => ACT_ID[(a[1] - 1) + "," + a[2]] = a[0]);
// A button press fires the actuator of that kind at the ball's cell, else the downhill neighbour, else the uphill one.
function reachTarget(k, ci, kind) {
  const d = DIR(k);
  for (const cc of [ci, ci + d, ci - d]) { const ch = cellCh(k, cc); if (ch && isActuator(ch) && kindOfCh(ch) === kind) return cc; }
  return -1;
}
const dotAt = (k, c) => DOTS.findIndex(d => d.k === k && d.c === c);
const cpAt = (k, c) => CHECKPOINTS.findIndex(p => p.k === k && p.c === c);
const floorY = (k, x) => SPITCH * (k + 1) - 30 + (DIR(k) === -1 ? -1 : 1) * 20.85 * (2 * x / PW - 1);

// Resolve what happens to a ball that has ARRIVED in cell (k,c).  fire = actuator there is active.
// Returns {kind:"roll"|"fall"|"kick"|"throw"|"lost"|"exit", k, c}
function resolve(k, c, fire) {
  const ch = cellCh(k, c);
  if (ch === "D") return { kind: "lost" };
  if (ch === "X") return { kind: "exit", k, c };
  if (fire) {
    if (ch === "G") return { kind: "fall", k: k + 1, c };
    if (ch === "p" || ch === "q") {
      const d = ch === "p" ? -1 : 1;
      let t = c + 2 * d;
      if (cellCh(k, t) === null) return { kind: "lost" };         // thrown off the plate
      if (cellCh(k, t) === ".") t = c + d;                        // blocked by the dead cell: drops short
      if (cellCh(k, t) === ".") t = c;
      return { kind: "kick", k, c: t };
    }
    if (ch === "f" || ch === "g") {
      const d = ch === "f" ? -1 : 1, t = c + 2 * d;
      const tc = cellCh(k - 1, t);
      if (tc !== null && tc !== ".") return { kind: "throw", k: k - 1, c: t };
      // falls back on the same shelf: carries on rolling
    }
  }
  const n = c + DIR(k);
  if (cellCh(k, n) === null) return { kind: "lost" };
  return { kind: "roll", k, c: n };
}

// ---- discrete model used by the self-check and the solver ----
// state: {k,c,seq:[dot indices in first-hit order],cp}
function onArrive(st) {                                    // register dot / checkpoint in the cell
  const di = dotAt(st.k, st.c), pi = cpAt(st.k, st.c);
  let seq = st.seq, cp = st.cp;
  if (di >= 0 && !seq.includes(di)) seq = seq.concat([di]);
  if (pi >= 0) cp = pi;
  return { k: st.k, c: st.c, seq, cp };
}
const codeIdx = () => CODE.map(n => DOTS.findIndex(d => d.name === n));
const seqOk = seq => { const ci = codeIdx(); return seq.length === ci.length && seq.every((v, i) => v === ci[i]); };
const liftTarget = cp => (cp >= 0 ? { k: CHECKPOINTS[cp].k, c: CHECKPOINTS[cp].c } : ENTRY);

// Successors of a state: [{act:"none"|"fire", to:state|null, end:"lost"|"exit-wrong"|"win"|null}]
function successors(st) {
  const out = [];
  const ch = cellCh(st.k, st.c);
  const tryAct = fire => {
    const r = resolve(st.k, st.c, fire);
    if (r.kind === "lost") out.push({ act: fire ? "fire" : "none", end: "lost" });
    else if (r.kind === "exit") out.push({ act: fire ? "fire" : "none", end: seqOk(st.seq) ? "win" : "exit-wrong" });
    else out.push({ act: fire ? "fire" : "none", to: onArrive({ k: r.k, c: r.c, seq: st.seq, cp: st.cp }), kind: r.kind });
  };
  tryAct(false);
  if (isActuator(ch)) {
    const r = resolve(st.k, st.c, true), n = resolve(st.k, st.c, false);
    if (r.kind !== n.kind || r.k !== n.k || r.c !== n.c) tryAct(true);   // skip no-op fires (flipper falling back)
  }
  return out;
}
const skey = s => s.k + "," + s.c + "," + s.seq.join("") + "," + s.cp;

// Dijkstra on (fires, steps) over the full state graph (lost / wrong exit -> belt lift back to checkpoint)
function solve() {
  const start = onArrive({ ...ENTRY, seq: [], cp: -1 });
  const best = new Map([[skey(start), [0, 0]]]), prev = new Map();
  const pq = [[0, 0, start]];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  while (pq.length) {
    let bi = 0; for (let i = 1; i < pq.length; i++) if (less(pq[i], pq[bi])) bi = i;
    const [f, s, st] = pq.splice(bi, 1)[0];
    const b = best.get(skey(st)); if (b[0] !== f || b[1] !== s) continue;
    for (const e of successors(st)) {
      const nf = f + (e.act === "fire" ? 1 : 0), ns = s + 1;
      if (e.end === "win") {
        const path = [{ k: st.k, c: st.c, act: e.act }]; let key = skey(st);
        while (prev.has(key)) { const p = prev.get(key); path.unshift({ k: p.from.k, c: p.from.c, act: p.act, via: p.via }); key = skey(p.from); }
        return { fires: nf, steps: ns, path };
      }
      let to = e.to, via = e.kind;
      if (e.end) { const t = liftTarget(st.cp); to = onArrive({ ...t, seq: st.seq, cp: st.cp }); via = "lift"; }
      const key = skey(to), old = best.get(key);
      if (!old || nf < old[0] || (nf === old[0] && ns < old[1])) {
        best.set(key, [nf, ns]); prev.set(key, { from: st, act: e.act, via }); pq.push([nf, ns, to]);
      }
    }
  }
  return null;
}

// All simple paths entry -> exit within a single run (a lost ball simply ends the path)
function allPaths(limit = 200000) {
  const res = []; let count = 0;
  const seen = new Set();
  (function dfs(st, trail) {
    if (++count > limit) return;
    seen.add(st.k + "," + st.c);
    for (const e of successors(st)) {
      const step = { k: st.k, c: st.c, act: e.act };
      if (e.end === "win" || e.end === "exit-wrong") res.push({ trail: trail.concat([step]), seq: st.seq, ok: e.end === "win" });
      else if (e.end === "lost") { /* drain */ }
      else if (!seen.has(e.to.k + "," + e.to.c)) dfs(e.to, trail.concat([step]));
    }
    seen.delete(st.k + "," + st.c);
  })(onArrive({ ...ENTRY, seq: [], cp: -1 }), []);
  return res;
}


function selfCheck() {
  const log = [], ok = [];
  const bad = LAYOUT.filter(r => r.length !== NCOL);
  ok.push(!bad.length); log.push(`layout: ${LAYOUT.length} shelves, ${bad.length ? "BAD row length: " + bad : "all rows 20 chars"}`);
  // counts
  const cnt = {}; LAYOUT.join("").split("").forEach(ch => cnt[ch] = (cnt[ch] || 0) + 1);
  log.push(`counts: G=${cnt.G} push=${(cnt.p || 0) + (cnt.q || 0)} flippers=${(cnt.f || 0) + (cnt.g || 0)} drains=${cnt.D} exit=${cnt.X}`);
  // no-input
  const nonDrain = [], viaExit = [];
  for (let k = 0; k < NSH; k++) for (let c = 0; c < NCOL; c++) {
    const ch = cellCh(k, c); if (ch === "." || ch === "D") continue;
    let s = { k, c }, n = 0, end = "?";
    while (n++ < 100) { const r = resolve(s.k, s.c, false); if (r.kind === "lost") { end = "drain"; break; } if (r.kind === "exit") { end = "exit"; break; } s = r; }
    if (end === "exit") viaExit.push(`S${k + 1}c${c}`); else if (end !== "drain") nonDrain.push(`S${k + 1}c${c}`);
  }
  ok.push(nonDrain.length === 0);
  log.push(`no-input: entry ball -> ${(() => { let s = { ...ENTRY }, n = 0; for (;;) { const r = resolve(s.k, s.c, false); if (r.kind === "lost") return "drain at S" + (s.k + 1) + "c" + s.c; if (r.kind === "exit" || n++ > 50) return r.kind; s = r; } })()}; cells never ending in a drain or the exit: ${nonDrain.length}; cells on S10 uphill of X that reach the exit unaided: ${viaExit.length}`);
  // reachability of actuators / cells with all actions
  const seen = new Set(), q = [onArrive({ ...ENTRY, seq: [], cp: -1 })];
  const reach = new Set();
  while (q.length) { const s = q.pop(); const key = skey(s); if (seen.has(key)) continue; seen.add(key); reach.add(s.k + "," + s.c);
    for (const e of successors(s)) { if (e.to) q.push(e.to); else if (e.end === "lost" || e.end === "exit-wrong") { const t = liftTarget(s.cp); q.push(onArrive({ ...t, seq: s.seq, cp: s.cp })); } } }
  const unreach = [];
  for (let k = 0; k < NSH; k++) for (let c = 0; c < NCOL; c++) if (isActuator(cellCh(k, c)) && !reach.has(k + "," + c)) unreach.push(`S${k + 1}c${c}(${cellCh(k, c)})`);
  ok.push(unreach.length === 0); log.push(`actuators not reachable: ${unreach.length ? unreach.join(" ") : "none"}`);
  // routes
  const paths = allPaths(), good = paths.filter(p => p.ok), wrong = paths.filter(p => !p.ok);
  ok.push(good.length === 1, wrong.length === 5);
  log.push(`simple routes entry->exit: ${paths.length} (correct order: ${good.length} [expect 1], wrong order / missing dots: ${wrong.length} [expect 5])`);
  // actuator table vs layout
  const seenAct = new Set(), tBad = [];
  ACT_TABLE.forEach(([id, sh, c, ch]) => { if (cellCh(sh - 1, c) !== ch) tBad.push(id); seenAct.add((sh - 1) + "," + c); });
  let layoutActs = 0; for (let k = 0; k < NSH; k++) for (let c = 0; c < NCOL; c++) if (isActuator(cellCh(k, c))) { layoutActs++; if (!seenAct.has(k + "," + c)) tBad.push("S" + (k + 1) + "c" + c); }
  ok.push(tBad.length === 0 && layoutActs === ACT_TABLE.length && ACT_TABLE.length === 30);
  log.push(`actuator table: ${ACT_TABLE.length} ids (12 G + 12 P + 6 F) vs ${layoutActs} in the layout, mismatches: ${tBad.length ? tBad.join(" ") : "none"}`);
  const rt = recogniserTest(); ok.push(rt.ok === rt.n);
  log.push(`touch recogniser: ${rt.ok}/${rt.n} noisy synthetic drawings recognised${rt.fails.length ? " (misses: " + rt.fails.join("; ") + ")" : ""}`);
  log.push(`ball re-home: chute 0.5 s + belt/tube ${LIFT_DELAY} s = ${(LIFT_DELAY + 0.5).toFixed(1)} s (target <= 20 s): ${LIFT_DELAY + 0.5 <= 20 ? "ok" : "TOO SLOW"}`);
  ok.push(LIFT_DELAY + 0.5 <= 20);
  const sol = solve();
  log.push(sol ? `shortest winning run: ${sol.fires} actuations, ${sol.steps} cell steps` : "NO winning run found");
  ok.push(!!sol);
  return { ok: ok.every(Boolean), log, paths, sol };
}
