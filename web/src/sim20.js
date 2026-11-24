// ===================== simulator (original 20x20 maze) =====================
const OX = 84, OY = 52;                   // world -> canvas offset (px); scale is 1; world y is flipped so row 0 is at the bottom
const LIFT_X0 = PW + 30, LIFT_X1 = PW + 70, LIFT_XC = PW + 50, LANE_R = PW + 13, LANE_TOP = -14, CHUTE_Y = PH + 16;
const RB = 8;                             // drawn ball radius (real ball is 7 mm)
const FALL_T = .11, MOVE_T = .22, GATE_T = .15, HOLD_T = .12;
const cxm = c => X0 + (c + .5) * CELL_W;
const fy = r => PH - (Y0 + r * CELL_H);                 // floor line of row r, screen y
const bpos = (c, r) => [cxm(c), fy(r) - 9];
const NAMES = { floor: "floor gate", L: "push left", R: "push right" };
const POS_NAMES = ["top", "right", "bottom", "left"];
const KIND_ICON = ["◀ push", "push ▶", "▼ drop", "▲ lift"];
const gname = g => g.type === "floor" ? NAMES.floor : NAMES[g.push];

const S = {
  state: "IDLE", ball: null, seq: [], prog: 0, cp: -1, actCount: 0, wasted: 0, time: 0, running: false,
  speed: 1, msg: "Press “Arm”.", msgKind: "", beltT: 0, route: null, showRoute: false, auto: null, hover: null, flash: {},
  map: [0, 1, 2, 3], needle: 0, runNo: 0, unl: [false, false, false, false], riddle: null,
  strokes: [], drawing: false, lastDraw: 0, peek: null, peeksLeft: PEEKS_PER_RUN, led: [0, 0, 0, 0], ledCol: ["", "", "", ""], btnHit: [0, 0, 0, 0],
  debug: false, skip: false, compass: false, sound: true, reveal: false, tsNote: "", cap1: "", finger: null, demo: false, aim: -1, gates: {}, forceQ: [], maze: new Maze(false), wobble: 1,
};
const WOB = { 0: null, 1: [2, 4], 2: [.8, 1.8] }, WOBN = ["off", "normal", "wild"];
let PLAN = [];

// ---- audio (buzzer) ----
let AC = null;
function tone(f, d, type = "square", delay = 0, vol = .05) {
  if (!S.sound) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = vol; o.connect(g); g.connect(AC.destination);
    const t = AC.currentTime + delay; o.start(t); g.gain.setTargetAtTime(0, t + d * .8, .02); o.stop(t + d + .1); } catch (e) {}
}
const buzzBad = () => { tone(160, .25, "sawtooth"); tone(120, .25, "sawtooth", .12); };
const chime = () => { tone(660, .12, "sine", 0, .08); tone(880, .12, "sine", .1, .08); tone(1320, .25, "sine", .2, .08); };
const tick = () => tone(520, .05, "square", 0, .03);

function log(t) { const el = document.getElementById("log"); const d = document.createElement("div"); d.textContent = `[${S.time.toFixed(1).padStart(5)}s] ${t}`; el.prepend(d); while (el.children.length > 60) el.lastChild.remove(); console.log("[TW20] " + t); }
function setMsg(t, kind) { S.msg = t; S.msgKind = kind || ""; }
function setState(s) { if (S.state !== s) { S.state = s; log("state -> " + s); } }
const dotRgb = n => DOTS.find(d => d.name === n).rgb;

// ---- the 4 buttons: PUSH-LEFT, PUSH-RIGHT, DROP, LIFT, reshuffled after every run ----
function reshuffle() {
  const prev = S.map.join();
  if (S.compass) { S.needle = Math.floor(Math.random() * 4); S.map = [0, 1, 2, 3].map(pos => COMPASS_CYCLE[(pos - S.needle + 4) % 4]); }
  else { let m; do { m = [0, 1, 2, 3]; for (let i = 3; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [m[i], m[j]] = [m[j], m[i]]; } } while (m.join() === prev); S.map = m; }
  log("button mapping reshuffled" + (S.compass ? " (compass needle " + POS_NAMES[S.needle] + ")" : ""));
}
const needleVisible = () => S.compass && (S.runNo === 0 || !!S.peek);

// ---- run / state machine ----
function resetRunData() { S.seq = []; S.prog = 0; S.cp = -1; S.gates = {}; S.actCount = 0; S.wasted = 0; S.time = 0; S.running = false; S.ball = null; S.auto = null; S.forceQ = []; }
function hardReset() {
  resetRunData(); S.unl = [false, false, false, false]; S.riddle = null; S.strokes = []; S.peek = null; S.runNo = 0; S.peeksLeft = PEEKS_PER_RUN;
  reshuffle(); setState("IDLE"); setMsg("Press “Arm”.", ""); $("bOut").disabled = true;
}
function arm() {
  resetRunData(); S.unl = [false, false, false, false]; S.strokes = []; S.peek = null; log("<- TER02_SOLVED received: prop armed");
  if (S.skip) { S.unl = [true, true, true, true]; toReady(); } else { setState("UNLOCK"); nextRiddle(); }
}
function nextRiddle() {
  const locked = [0, 1, 2, 3].filter(i => !S.unl[i]);
  if (!locked.length) { toReady(); return; }
  const btn = locked[Math.floor(Math.random() * locked.length)], pool = RIDDLES.filter(r => r.shape === BUTTON_SYMBOLS[btn]);
  S.riddle = Object.assign({ btn }, pool[Math.floor(Math.random() * pool.length)]); S.strokes = [];
  setMsg("Solve the riddle: draw the answer on the touch screen.", "");
}
function toReady() {
  setState("READY"); S.riddle = null; S.peeksLeft = PEEKS_PER_RUN; S.peek = { t: PEEK_SEC, free: true };
  setMsg("All symbols unlocked. Press “Drop ball” (or any button) to release the ball.", "win"); log("riddles solved, 4 symbols unlocked");
}
function releaseBall() {
  if (S.state !== "READY") { setMsg(S.state === "UNLOCK" ? "Unlock all four symbols first (or tick “Skip riddles”)." : "Press “Arm” first.", "bad"); buzzBad(); return false; }
  const keep = S.peeksLeft; resetRunData(); S.peeksLeft = keep; setState("RUN"); S.running = true; S.peek = null;
  const [x, y] = bpos(...ENTRY); S.ball = { mode: "air", t: 0, T: .35, x0: x, y0: y - 70, x1: x, y1: y, x, y: y - 70, land: ENTRY.slice(), peak: 0, c: ENTRY[0], r: ENTRY[1] };
  setMsg("Ball released at the entry (column 9, row 18).", ""); log("ball released at the entry"); return true;
}
function onWin() {
  setState("WIN"); S.runNo++; $("bOut").disabled = false; setMsg(`WIN! Code ${CODE.join(" > ")} in ${S.time.toFixed(1)} s, ${S.actCount} gate presses`, "win");
  chime(); outputCode(); reshuffle(); S.peeksLeft = PEEKS_PER_RUN; S.peek = null; S.auto = null;
}
function outputCode() { log(`-> TER06_SOLVED = 1, order = [${CODE.join(", ")}] (Modbus)`); }

// ---- touch screen ----
function submitDrawing() {
  if (S.state !== "UNLOCK" || !S.riddle || !S.strokes.length) return;
  const r = classifyStrokes(S.strokes);
  if (r.shape === S.riddle.shape) { S.unl[S.riddle.btn] = true; chime(); setMsg(`Correct: ${r.shape}. Button ${S.riddle.btn + 1} unlocked.`, "win"); log(`riddle solved: ${r.shape} -> button ${S.riddle.btn + 1}`); S.tsNote = ""; nextRiddle(); }
  else { buzzBad(); S.tsNote = r.shape ? `That looks like a ${r.shape}.` : `Not recognised (${r.why}).`; setMsg("Wrong drawing. " + S.tsNote + " Try again.", "bad"); log("drawing rejected: " + (r.shape || r.why)); S.strokes = []; }
}
function startPeek() {
  if (S.state !== "READY" && S.state !== "RUN") return;
  if (S.peeksLeft <= 0) { setMsg("No peeks left this run.", "bad"); buzzBad(); return; }
  S.peeksLeft--; S.peek = { t: PEEK_SEC, free: false }; log("peek used, " + S.peeksLeft + " left");
}

// ---- ball ----
function choose(outs) {
  if (S.forceQ.length) return S.forceQ.shift();           // assisted play: lucky rolls come from the solver's plan
  let r = Math.random(), a = 0; for (const o of outs) { a += o[0]; if (r <= a) return o; } return outs[outs.length - 1];
}
function reg(c, r) {                                      // ball passes over / lands on a cell
  const ci = cpIdx(c, r), di = dotIdx(c, r);
  if (ci >= 0 && S.cp !== ci) { S.cp = ci; setMsg(`Checkpoint CP${ci + 1} reached`, ""); log("checkpoint CP" + (ci + 1)); }
  if (di >= 0) {
    if (di === S.prog) { S.prog++; S.seq.push(di); S.flash[di] = 1; setMsg(`${DOTS[di].name.toUpperCase()} dot registered`, ""); log("dot " + DOTS[di].name); tick(); }
    else if (di > S.prog) { if (S.prog) { setMsg(`${DOTS[di].name.toUpperCase()} dot out of order: code reset`, "bad"); log("dot out of order: code reset"); buzzBad(); } S.prog = 0; S.seq = []; }
  }
}
function travel(o, gate) {
  const b = S.ball, [, path, term] = o;
  Object.assign(b, { mode: "trav", queue: path.slice(1).map(p => p.slice()), term, leg: null, gateWait: 0 });
  if (gate) { S.gates[gate.id] = { t: 0, closing: false, hold: 0 }; b.gateWait = GATE_T * .8; }
  b.wt = nextWob();
}
function nextWob() { const w = WOB[S.wobble]; return (w && !S.auto) ? w[0] + Math.random() * (w[1] - w[0]) : null; }
function place(c, r) { const [x, y] = bpos(c, r); S.ball = { mode: "rest", c, r, x, y, wt: nextWob() }; }
function startLost(why) { const b = S.ball; Object.assign(b, { mode: "lost", t: 0, y0: b.y, y1: CHUTE_Y, why }); }
function tubePath(x0) {
  const cell = S.cp >= 0 ? CPS[S.cp] : ENTRY, side = (S.cp >= 0 && cell[0] < 10) ? "L" : "R", yp = bpos(...cell)[1];
  const p = [[x0, CHUTE_Y], [LIFT_XC, CHUTE_Y], [LIFT_XC, 8]];
  if (side === "R") p.push([LANE_R, 8], [LANE_R, yp], [cxm(cell[0]), yp]); else p.push([LIFT_XC, LANE_TOP], [-26, LANE_TOP], [-26, yp], [cxm(cell[0]), yp]);
  return { pts: p, cell };
}
function plen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function pointAt(pts, u) { let d = u * plen(pts); for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d <= L) return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * d / L, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * d / L]; d -= L; } return pts[pts.length - 1]; }

function doWobble() {
  const b = S.ball, opts = S.maze.wobbleOptions([b.c, b.r]); if (!opts.length) { b.wt = nextWob(); return; }
  travel(choose(opts[Math.floor(Math.random() * opts.length)]));
}
function doLift(why) {                                    // lift button: the ball is carried back to the last checkpoint
  log("ball lifted back to " + (S.cp >= 0 ? "CP" + (S.cp + 1) : "the entry")); startLost(why || "lift");
}
// A physical button press. pos = 0 top, 1 right, 2 bottom, 3 left.
function pressButton(pos, src) {
  S.btnHit[pos] = S.demo ? .8 : .15;
  if (S.state === "READY") { releaseBall(); return; }
  if (S.state !== "RUN") { setLed(pos, "r"); buzzBad(); return; }
  const b = S.ball; if (!b || b.mode !== "rest") return;     // ball is moving: the press is ignored
  const kind = S.map[pos];
  if (kind === 3) { setLed(pos, "g"); S.actCount++; doLift("lift"); return; }
  const res = S.maze.act([b.c, b.r], ACTION_OF_KIND[kind]);
  if (!res) { S.wasted++; setLed(pos, "r"); buzzBad(); setMsg("Wasted press: no matching gate in the ball's cell.", "bad"); log(`button ${pos + 1} (${KINDS[kind]}): wasted at (${b.c}, ${b.r})`); return; }
  S.actCount++; setLed(pos, "g"); tick(); setMsg(`Button ${pos + 1}: gate ${res[0].id} moved`, ""); log(`fire ${res[0].id} at (${b.c}, ${b.r}) via button ${pos + 1} ${KINDS[kind]}`);
  travel(choose(res[1]), res[0]);
}
function setLed(pos, c) { S.led[pos] = .5; S.ledCol[pos] = c; }
// >>> Debug / replaceable: fire a specific gate directly (animates it; moves the ball only if the ball is in that cell). <<<
let requestFire = (g, src) => {
  S.gates[g.id] = { t: 0, closing: false, hold: 0 }; const b = S.ball;
  if (b && b.mode === "rest" && b.c === g.col && b.r === g.row) {
    const res = S.maze.act([b.c, b.r], g.type === "floor" ? "FLOOR" : g.push === "L" ? "LEFT" : "RIGHT");
    if (res) { S.actCount++; travel(choose(res[1]), res[0]); log(`fire ${g.id} via ${src}`); return; }
  }
  log(`fire ${g.id} via ${src}: no ball in that cell`);
};

function stepBall(dt) {
  const b = S.ball; if (!b) return;
  if (b.mode === "rest") { if (b.wt != null && S.state === "RUN") { b.wt -= dt; if (b.wt <= 0) { doWobble(); if (b.mode === "rest") b.wt = nextWob(); } } return; }
  if (b.mode === "trav") {
    b.gateWait = Math.max(0, b.gateWait - dt); if (b.gateWait > 0) return;
    if (!b.leg) {
      if (!b.queue.length) {
        const [c, r] = [b.c, b.r];
        if (b.term === "hole") {
          b.mode = "exit"; b.t = 0;
          if (eq([c, r], EXIT)) { if (S.prog === 4) { S.running = false; b.win = true; log("exit reached with the correct order"); } else { b.win = false; setMsg("Wrong code. Ball sent to the belt lift.", "bad"); log("exit reached, wrong code"); buzzBad(); } }
          else { b.win = false; setMsg("Ball lost down a drain", "bad"); log(`drain at column ${c}`); buzzBad(); }
          return;
        }
        place(c, r); return;
      }
      const [c, r, k] = b.queue.shift(), [tx, ty] = bpos(c, r);
      b.leg = { x0: b.x, y0: b.y, x1: tx, y1: ty, T: k === "fall" ? FALL_T : MOVE_T, c, r, t: 0 };
    }
    const L = b.leg; L.t += dt; const u = Math.min(1, L.t / L.T);
    b.x = L.x0 + (L.x1 - L.x0) * u; b.y = L.y0 + (L.y1 - L.y0) * u;
    if (u >= 1) { b.c = L.c; b.r = L.r; b.leg = null; reg(L.c, L.r); }
  } else if (b.mode === "air") {
    b.t += dt; const u = Math.min(1, b.t / b.T); b.x = b.x0 + (b.x1 - b.x0) * u; b.y = b.y0 + (b.y1 - b.y0) * u;
    if (u >= 1) { place(b.land[0], b.land[1]); }
  } else if (b.mode === "exit") {
    b.t += dt; b.y += 220 * dt;
    if (b.t > .45) { if (b.win) { S.ball = null; onWin(); } else startLost("drain"); }
  } else if (b.mode === "lost") {
    b.t += dt; const u = Math.min(1, b.t / .5); b.y = b.y0 + (b.y1 - b.y0) * u * u;
    if (u >= 1) { Object.assign(b, { mode: "lift", t: 0, T: LIFT_DELAY, path: tubePath(b.x) }); log("ball in the sump, belt lift running"); }
  } else if (b.mode === "lift") {
    b.t += dt; S.beltT += dt; const u = Math.min(1, b.t / b.T), p = pointAt(b.path.pts, u); b.x = p[0]; b.y = p[1];
    if (u >= 1) {
      const cell = b.path.cell; place(cell[0], cell[1]); S.ball.mode = "rest"; S.ball.wt = null;
      log("ball re-entered at " + (S.cp >= 0 ? "CP" + (S.cp + 1) : "the entry")); setMsg("Ball re-entered at " + (S.cp >= 0 ? "CP" + (S.cp + 1) : "the entry"), "");
      const [, path, term] = choose(S.maze.release(cell)); Object.assign(S.ball, { mode: "trav", queue: path.slice(1).map(p => p.slice()), term, leg: null, gateWait: 0, wt: null });
    }
  }
}

// ---- assisted auto-play: follow the solver's plan with the lucky rolls it needs ----
function autoDrive() {
  const A = S.auto, b = S.ball; if (!A || S.state !== "RUN" || !b || b.mode !== "rest") return;
  if (S.demo && A.hold && performance.now() < A.hold) return;           // demo: give the viewer time to read
  let st = A.steps[A.i]; if (!st) { S.auto = null; return; }
  if (st.cell[0] !== b.c || st.cell[1] !== b.r) {                 // out of step: re-plan from where the ball is
    const plan = solveFrom(S.maze, { c: b.c, r: b.r, prog: S.prog, cp: S.cp });
    if (!plan) { setMsg("Auto-play: no plan from here", "bad"); S.auto = null; return; }
    A.steps = plan; A.i = 0; st = plan[0]; A.ann = false; log("auto-play re-planned: " + plan.length + " steps");
  }
  const wait = st.act === "WOBBLE", kind = ["LEFT", "RIGHT", "FLOOR", "LIFT"].indexOf(st.act), pos = wait ? -1 : S.map.indexOf(kind);
  const g = wait ? null : (S.maze.slots[b.c + "," + b.r] || {})[st.act === "FLOOR" ? "floor" : st.act === "LEFT" ? "L" : "R"];
  if (S.demo && !A.ann) {                                           // announce first, act after a pause
    A.ann = true; A.hold = performance.now() + (wait ? 1100 : 1900); S.aim = pos;
    S.cap1 = wait ? `Step ${A.i + 1}/${A.steps.length}: no press needed. The ball is at col ${b.c}, row ${b.r} and rolls sideways by itself.`
      : `Step ${A.i + 1}/${A.steps.length}: ball is at col ${b.c}, row ${b.r}. PLAYER is about to press button ${pos + 1} [${BUTTON_SYMBOLS[pos]}] = ${KINDS[kind]}` + (g ? `, which moves gate ${g.id}.` : ", which lifts the ball back to the last checkpoint.");
    return;
  }
  A.ann = false; S.aim = -1;
  S.forceQ = [[1, st.path, st.term]]; if (st.lift) S.forceQ.push([1, st.lift.path, "rest"]);
  A.i++;
  if (wait) { if (!S.demo) S.cap1 = `Step ${A.i}/${A.steps.length}: no press. Waits while the ball rolls sideways by itself at col ${b.c}, row ${b.r}.`; doWobble(); }
  else {
    S.cap1 = `Step ${A.i}/${A.steps.length}: PRESSED button ${pos + 1} [${BUTTON_SYMBOLS[pos]}] = ${KINDS[kind]}. Ball at col ${b.c}, row ${b.r}` + (g ? `, so gate ${g.id} moves.` : ", so the ball is lifted back to the last checkpoint.") + (st.lift ? " The ball then drops down a drain." : "");
    log("PLAYER: " + S.cap1); pressButton(pos, "auto");
  }
}

function update(dt) {
  dt *= S.speed;
  for (const id in S.gates) { const a = S.gates[id];
    if (!a.closing) { a.t = Math.min(1, a.t + dt / GATE_T); const moving = S.ball && (S.ball.mode === "trav" && S.ball.gateWait > 0); if (a.t >= 1 && !moving) { a.hold += dt; if (a.hold > HOLD_T) a.closing = true; } }
    else { a.t -= dt / GATE_T; if (a.t <= 0) delete S.gates[id]; } }
  for (const k in S.flash) S.flash[k] = Math.max(0, S.flash[k] - dt * 1.2);
  for (let i = 0; i < 4; i++) { S.led[i] = Math.max(0, S.led[i] - dt); S.btnHit[i] = Math.max(0, S.btnHit[i] - dt); }
  if (S.running) S.time += dt;
  if (S.peek) { S.peek.t -= dt; if (S.peek.t <= 0) S.peek = null; }
  if (S.state === "UNLOCK" && S.strokes.length && !S.drawing && performance.now() - S.lastDraw > IDLE_SUBMIT * 1000) submitDrawing();
  let rem = dt; while (rem > 1e-9) { const h = Math.min(rem, .02); autoDrive(); stepBall(h); rem -= h; }
}

// ===================== drawing: plate =====================
const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
cv.width = OX + LIFT_X1 + 30; cv.height = OY + PH + 70;
const COL = { plate: "#1e2736", wall: "#cbd5e4", red: "#e5484d", green: "#31c46b", blue: "#4c8dff", orange: "#ff9b2f", cp: "#b78cff", txt: "#8ea0bb" };
const Py = y => PH - y;
function gateSeg(g, th) {                  // y-up mm geometry from the description
  const c = g.col, r = g.row, L = g.type === "floor" ? ((c === 0 || c === 19) ? 28.75 : 30.75) : g.mount === "side" ? ((c === 0 || c === 19) ? 49 : 51) : 30.75;
  const cs = Math.cos(th), sn = Math.sin(th); let hx, hy, v;
  if (g.type === "floor") { hx = X0 + c * CELL_W + 3; hy = Y0 + r * CELL_H; v = [cs, -sn]; }
  else if (g.mount === "side") { hy = Y0 + (r + 1) * CELL_H - 4.5; if (g.push === "L") { hx = X0 + (c + 1) * CELL_W; v = [-sn, -cs]; } else { hx = X0 + c * CELL_W; v = [sn, -cs]; } }
  else { hy = Y0 + (r + 1) * CELL_H; if (g.push === "L") { hx = X0 + c * CELL_W + 4.5; v = [cs, -sn]; } else { hx = X0 + (c + 1) * CELL_W - 4.5; v = [-cs, -sn]; } }
  return [[hx, hy], [hx + v[0] * L, hy + v[1] * L]];
}
const gateWall = g => g.type === "floor" ? "h" + g.row + "," + g.col : g.mount === "roof" ? "h" + (g.row + 1) + "," + g.col : "v" + (g.push === "L" ? g.col + 1 : g.col) + "," + g.row;
const SKIP = new Set(GATES.map(gateWall));
function ln(a, b, w, col) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], Py(a[1])); ctx.lineTo(b[0], Py(b[1])); ctx.stroke(); }
function circ(x, y, r, fill, stroke, w) { ctx.beginPath(); ctx.arc(x, Py(y), r, 0, 7); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(); } }
const cc = (c, r) => [X0 + (c + .5) * CELL_W, Y0 + (r + .5) * CELL_H];
const tubeActive = () => (S.ball && S.ball.mode === "lift") ? (S.cp >= 0 ? S.cp : -1) : -2;

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#151b26"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.translate(OX, OY);
  ctx.fillStyle = COL.plate; ctx.fillRect(0, 0, PW, PH); ctx.strokeStyle = "#3b475d"; ctx.lineWidth = 2; ctx.strokeRect(0, 0, PW, PH);
  // rulers: 20 columns on top, 20 rows on the left
  ctx.fillStyle = COL.txt; ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  for (let c = 0; c < COLS; c++) ctx.fillText(c, cxm(c), -30);
  ctx.textAlign = "right"; for (let r = 0; r < ROWS; r++) ctx.fillText(r, -8, Py(Y0 + (r + .5) * CELL_H) + 4);
  ctx.textAlign = "center"; ctx.fillText("col", -18, -30); ctx.fillText("row", -26, -14);
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let k = 0; k <= COLS; k++) { ctx.beginPath(); ctx.moveTo(X0 + k * CELL_W, Py(Y0)); ctx.lineTo(X0 + k * CELL_W, Py(Y0 + ROWS * CELL_H)); ctx.stroke(); }
  for (let k = 0; k <= ROWS; k++) { ctx.beginPath(); ctx.moveTo(X0, Py(Y0 + k * CELL_H)); ctx.lineTo(X0 + COLS * CELL_W, Py(Y0 + k * CELL_H)); ctx.stroke(); }
  drawTubes(); drawLift(); drawChute();
  // recesses: dots (coloured or decoy), checkpoints, entry, holes
  DECOYS.forEach(c => { const [x, y] = cc(...c); circ(x, y, 14, null, "#56627a", 1.5); });
  DOTS.forEach((d, i) => { const [x, y] = cc(d.c, d.r), done = S.seq.includes(i), fl = S.flash[i] || 0;
    if (done) circ(x, y, 16 + fl * 5, d.rgb, "#fff", 3); else circ(x, y, 14, d.rgb + "66", d.rgb, 4);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("D" + (i + 1), x, Py(y) + 28); });
  CPS.forEach((c, i) => { const [x, y] = cc(...c), on = S.cp === i; circ(x, y, 11, null, on ? "#e2cdff" : COL.cp, on ? 3 : 2); circ(x, y, 4, on ? "#e2cdff" : COL.cp);
    ctx.fillStyle = COL.cp; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("CP" + (i + 1), x, Py(y) - 18); });
  { const [x, y] = cc(...ENTRY); circ(x, y, 14, null, "#e7eaf0", 3); ctx.fillStyle = "#e7eaf0"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("IN", x, Py(y) + 4); }
  HOLES.forEach(c => { const [x, y] = cc(...c), ex = eq(c, EXIT); circ(x, y, 14, "#0b0d12"); circ(x, y, 17, null, ex ? "#3cff78" : "#e5484d", 2.5);
    ctx.fillStyle = ex ? "#3cff78" : "#e5484d"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center"; ctx.fillText(ex ? "EXIT" : "drain", x, Py(y) - 22); });
  // walls
  const w = 5; ctx.lineCap = "butt";
  for (let k = 0; k <= ROWS; k++) for (let c = 0; c < COLS; c++) if (H_LINES[k][c] === "1" && !SKIP.has("h" + k + "," + c)) ln([X0 + c * CELL_W, Y0 + k * CELL_H], [X0 + (c + 1) * CELL_W, Y0 + k * CELL_H], w, COL.wall);
  for (let k = 0; k <= COLS; k++) for (let r = 0; r < ROWS; r++) if (V_LINES[k][r] === "1" && !SKIP.has("v" + k + "," + r)) ln([X0 + k * CELL_W, Y0 + r * CELL_H], [X0 + k * CELL_W, Y0 + (r + 1) * CELL_H], w, COL.wall);
  // gates (closed = the wall they replace)
  for (const g of GATES) {
    const a = S.gates[g.id], th = (a ? a.t : 0) * Math.PI / 2, [h, e] = gateSeg(g, th), dead = g.mount === "roof" && !S.maze.roof;
    ln(h, e, 6, dead ? "#7882aa" : g.type === "floor" ? COL.orange : COL.blue); circ(h[0], h[1], 2.5, "#141414");
    if (S.debug || (S.hover && S.hover.id === g.id)) { ctx.fillStyle = "#e7eaf0"; ctx.font = "bold 8px system-ui"; ctx.textAlign = "center"; ctx.fillText(g.id, (h[0] + e[0]) / 2, Py((h[1] + e[1]) / 2) - 6); }
  }
  if (S.hover) { const g = S.hover, x = X0 + g.col * CELL_W, y = Y0 + g.row * CELL_H; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x, Py(y + CELL_H), CELL_W, CELL_H); }
  if (S.showRoute && S.route) drawRoute(S.route);
  drawBall();
}
function drawTubes() {
  const act = tubeActive();
  [-1, 0, 1, 2, 3, 4, 5].forEach(i => {
    const cell = i < 0 ? ENTRY : CPS[i], side = (i >= 0 && cell[0] < 10) ? "L" : "R", yp = bpos(...cell)[1];
    const pts = side === "R" ? [[LIFT_XC, 8], [LANE_R, 8], [LANE_R, yp], [PW, yp]] : [[LIFT_XC, 8], [LIFT_XC, LANE_TOP], [-26, LANE_TOP], [-26, yp], [0, yp]];
    ctx.strokeStyle = i === act ? "#ffd36a" : "rgba(130,150,190,.28)"; ctx.lineWidth = i === act ? 4 : 3; ctx.beginPath(); pts.forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    ctx.fillStyle = i < 0 ? "#e7eaf0" : COL.cp; ctx.fillRect(side === "L" ? -9 : PW + 1, yp - 5, 8, 10);
  });
  ctx.fillStyle = COL.txt; ctx.font = "10px system-ui"; ctx.textAlign = "left"; ctx.fillText("feed tubes + ports", 4, -42);
  ctx.setLineDash([3, 5]); ctx.strokeStyle = "rgba(229,72,77,.3)"; ctx.lineWidth = 2;
  HOLES.forEach(c => { const x = cxm(c[0]); ctx.beginPath(); ctx.moveTo(x, PH - 4); ctx.lineTo(x, PH + 4); ctx.stroke(); }); ctx.setLineDash([]);
}
function drawLift() {
  ctx.fillStyle = "#222c3d"; ctx.fillRect(LIFT_X0, -10, LIFT_X1 - LIFT_X0, PH + 50); ctx.strokeStyle = "#3d4a63"; ctx.lineWidth = 1; ctx.strokeRect(LIFT_X0, -10, LIFT_X1 - LIFT_X0, PH + 50);
  ctx.strokeStyle = "#566384"; ctx.lineWidth = 2; const off = (S.beltT * 40) % 40;
  for (let y = PH + 30 - off; y > -5; y -= 40) { ctx.beginPath(); ctx.moveTo(LIFT_X0 + 6, y + 8); ctx.lineTo(LIFT_XC, y); ctx.lineTo(LIFT_X1 - 6, y + 8); ctx.stroke(); }
  ctx.fillStyle = COL.txt; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.save(); ctx.translate(LIFT_XC + 4, PH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("BELT LIFT", 0, 0); ctx.restore();
  ctx.fillStyle = "#8d9bc2"; ctx.beginPath(); ctx.arc(LIFT_XC, 8, 8, 0, 7); ctx.fill(); ctx.font = "10px system-ui"; ctx.fillStyle = COL.txt; ctx.fillText("diverter servo", LIFT_XC, -22); ctx.fillText("sump", LIFT_XC, PH + 44);
}
function drawChute() { ctx.fillStyle = "#2b3447"; ctx.fillRect(0, PH + 6, LIFT_X0, 22); ctx.fillStyle = COL.txt; ctx.font = "11px system-ui"; ctx.textAlign = "left"; ctx.fillText("collector chute → sump (all bottom holes lead here)", 10, PH + 21); }
function drawBall() {
  const b = S.ball; if (!b) return; ctx.globalAlpha = (b.mode === "lost" || b.mode === "exit") ? .6 : 1;
  ctx.beginPath(); ctx.arc(b.x + 1.5, b.y + 1.5, RB, 0, 7); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fill();
  const g = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, RB); g.addColorStop(0, "#fff"); g.addColorStop(.5, "#b9c0cc"); g.addColorStop(1, "#6d7686");
  ctx.beginPath(); ctx.arc(b.x, b.y, RB, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.globalAlpha = 1;
}
function drawRoute(pts) {
  ctx.strokeStyle = "#4ff08a"; ctx.lineWidth = 3; ctx.globalAlpha = .85; ctx.setLineDash([7, 4]); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], Py(p[1])) : ctx.moveTo(p[0], Py(p[1]))); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
function planRoute() {                     // polyline of the planned ball path (world y-up)
  const pts = []; for (const st of PLAN) for (const p of st.path) { const [x, y] = bpos(p[0], p[1]); pts.push([x, PH - y]); }
  return pts;
}

// ===================== drawing: touch screen =====================
const tsv = document.getElementById("ts"), tc = tsv.getContext("2d");
function symbolPath(c, shape, x, y, s) {
  c.beginPath();
  if (shape === "triangle") { c.moveTo(x, y - s); c.lineTo(x + s, y + s * .85); c.lineTo(x - s, y + s * .85); c.closePath(); }
  else if (shape === "circle") c.arc(x, y, s, 0, 7); else if (shape === "square") c.rect(x - s * .85, y - s * .85, s * 1.7, s * 1.7);
  else { c.moveTo(x - s, y); c.lineTo(x + s, y); c.moveTo(x, y - s); c.lineTo(x, y + s); }
}
function wrap(c, text, x, y, w, lh) { const words = text.split(" "); let line = ""; for (const wd of words) { const t = line + wd + " "; if (c.measureText(t).width > w && line) { c.fillText(line, x, y); line = wd + " "; y += lh; } else line = t; } c.fillText(line, x, y); return y + lh; }
function drawTouch() { drawTouchInner(); const f = S.finger; if (f) { tc.save(); tc.fillStyle = "rgba(255,255,255,.28)"; tc.strokeStyle = "#fff"; tc.lineWidth = 3; tc.beginPath(); tc.arc(f.x, f.y, f.down ? 13 : 20, 0, 7); tc.fill(); tc.stroke(); tc.restore(); } }
function drawTouchInner() {
  const W = tsv.width, H = tsv.height; tc.setTransform(1, 0, 0, 1, 0, 0); tc.fillStyle = "#0f141c"; tc.fillRect(0, 0, W, H);
  tc.textAlign = "center"; tc.textBaseline = "alphabetic"; tc.lineCap = "round"; tc.lineJoin = "round";
  const head = (t, col) => { tc.fillStyle = col || "#8ea0bb"; tc.font = "bold 15px system-ui"; tc.fillText(t, W / 2, 24); };
  const slots = () => { for (let i = 0; i < 4; i++) { const x = 40 + i * 48, y = H - 30; tc.strokeStyle = S.unl[i] ? "#3fae6a" : "#3b475d"; tc.lineWidth = 2; tc.strokeRect(x - 18, y - 18, 36, 36);
    if (S.unl[i]) { tc.strokeStyle = "#e7eaf0"; tc.lineWidth = 3; symbolPath(tc, BUTTON_SYMBOLS[i], x, y, 10); tc.stroke(); } else { tc.fillStyle = "#3b475d"; tc.font = "bold 20px system-ui"; tc.fillText("?", x, y + 7); } } };
  if (S.peek && (S.state === "READY" || S.state === "RUN")) {
    head(`PEEK  ${S.peek.t.toFixed(1)} s`, "#ffd36a");
    const mx = W / 2, my = H / 2 + 6, dx = 130, dy = 86, P = [[mx, my - dy], [mx + dx, my], [mx, my + dy], [mx - dx, my]];
    for (let pos = 0; pos < 4; pos++) { const [x, y] = P[pos]; tc.fillStyle = "#1c2433"; tc.fillRect(x - 56, y - 30, 112, 60); tc.strokeStyle = "#e7eaf0"; tc.lineWidth = 3; symbolPath(tc, BUTTON_SYMBOLS[pos], x - 32, y, 12); tc.stroke();
      tc.fillStyle = "#e7eaf0"; tc.font = "bold 14px system-ui"; tc.fillText(KIND_ICON[S.map[pos]], x + 16, y + 5); }
    if (needleVisible()) { const [nx, ny] = P[S.needle]; tc.strokeStyle = "#ff6b6b"; tc.lineWidth = 4; tc.beginPath(); tc.moveTo(mx, my); tc.lineTo(mx + (nx - mx) * .5, my + (ny - my) * .5); tc.stroke(); tc.fillStyle = "#ff6b6b"; tc.beginPath(); tc.arc(mx, my, 5, 0, 7); tc.fill(); tc.font = "11px system-ui"; tc.fillText("needle: LIFT key", mx, my + 22); }
    return;
  }
  if (S.state === "IDLE") { head("TER-06  THE TRICK WALL"); tc.fillStyle = "#566384"; tc.font = "14px system-ui"; tc.fillText("Waiting for TER02_SOLVED ...", W / 2, H / 2); return; }
  if (S.state === "UNLOCK" && S.riddle) {
    head(`RIDDLE  (button symbol ${S.unl.filter(Boolean).length + 1} of 4)`); tc.fillStyle = "#e7eaf0"; tc.font = "17px system-ui"; wrap(tc, S.riddle.text, W / 2, 54, W - 50, 22);
    tc.strokeStyle = "#2b3446"; tc.lineWidth = 1; tc.setLineDash([5, 5]); tc.strokeRect(20, 100, W - 40, H - 160); tc.setLineDash([]); tc.strokeStyle = "#8fd0ff"; tc.lineWidth = 4;
    for (const st of S.strokes) { tc.beginPath(); st.forEach((p, i) => i ? tc.lineTo(p[0], p[1]) : tc.moveTo(p[0], p[1])); tc.stroke(); }
    if (!S.strokes.length) { tc.fillStyle = "#3b475d"; tc.font = "13px system-ui"; tc.fillText("draw here with a finger or the mouse", W / 2, H / 2 + 10); }
    if (S.tsNote) { tc.fillStyle = "#ff9a60"; tc.font = "13px system-ui"; tc.fillText(S.tsNote, W / 2, H - 56); }
    slots(); return;
  }
  if (S.state === "READY") { head("READY", "#6dff8c"); tc.fillStyle = "#e7eaf0"; tc.font = "17px system-ui"; tc.fillText("All four symbols unlocked", W / 2, H / 2 - 10); tc.fillStyle = "#8ea0bb"; tc.font = "14px system-ui"; tc.fillText("Release the ball to start the run", W / 2, H / 2 + 16); slots(); return; }
  if (S.state === "RUN") {
    head("RUN", "#8fd0ff"); tc.fillStyle = "#8ea0bb"; tc.font = "14px system-ui"; tc.fillText("Steer the ball with the 4 buttons", W / 2, 54);
    for (let i = 0; i < 4; i++) { tc.fillStyle = "#1c2433"; tc.fillRect(40 + i * 110, 90, 90, 80); tc.strokeStyle = "#e7eaf0"; tc.lineWidth = 3; symbolPath(tc, BUTTON_SYMBOLS[i], 85 + i * 110, 130, 18); tc.stroke(); }
    tc.fillStyle = "#566384"; tc.font = "13px system-ui"; tc.fillText(`dots: ${S.prog}/4   checkpoint: ${S.cp >= 0 ? "CP" + (S.cp + 1) : "none"}   peeks left: ${S.peeksLeft}`, W / 2, 220); return;
  }
  if (S.state === "WIN") {
    head("CODE UNLOCKED", "#6dff8c"); tc.fillStyle = "#e7eaf0"; tc.font = "15px system-ui"; tc.fillText("Colour order for the next puzzle:", W / 2, 62);
    CODE.forEach((n, i) => { const x = W / 2 + (i - 1.5) * 90; tc.fillStyle = dotRgb(n); tc.beginPath(); tc.arc(x, 130, 30, 0, 7); tc.fill(); tc.strokeStyle = "#fff"; tc.lineWidth = 2; tc.stroke(); tc.fillStyle = "#e7eaf0"; tc.font = "13px system-ui"; tc.fillText((i + 1) + ". " + n, x, 184); });
    tc.fillStyle = "#8ea0bb"; tc.font = "13px system-ui"; tc.fillText("TER06_SOLVED sent. Buttons reshuffled for the next player.", W / 2, 240);
  }
}
function tsPos(ev) { const r = tsv.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * tsv.width, (ev.clientY - r.top) / r.height * tsv.height]; }
tsv.addEventListener("pointerdown", ev => { if (S.state !== "UNLOCK") return; tsv.setPointerCapture(ev.pointerId); S.drawing = true; S.strokes.push([tsPos(ev)]); S.tsNote = ""; });
tsv.addEventListener("pointermove", ev => { if (!S.drawing) return; S.strokes[S.strokes.length - 1].push(tsPos(ev)); S.lastDraw = performance.now(); });
const endStroke = () => { if (S.drawing) { S.drawing = false; S.lastDraw = performance.now(); } };
tsv.addEventListener("pointerup", endStroke); tsv.addEventListener("pointercancel", endStroke);

// ===================== UI =====================
const $ = id => document.getElementById(id);
const chip = (rgb, ghost) => `<i class="chip" style="background:${rgb};${ghost ? "opacity:.3" : ""}"></i>`;
const symSvg = sh => `<svg viewBox="-14 -14 28 28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${
  sh === "triangle" ? '<path d="M0 -11 L11 9 L-11 9 Z"/>' : sh === "circle" ? '<circle r="10"/>' : sh === "square" ? '<rect x="-9" y="-9" width="18" height="18"/>' : '<path d="M-10 0H10M0 -10V10"/>'}</svg>`;
function buildPad() {
  for (let pos = 0; pos < 4; pos++) { const b = document.createElement("button"); b.className = "pb"; b.dataset.pos = pos; b.id = "pb" + pos; b.setAttribute("aria-label", "Button " + (pos + 1));
    b.innerHTML = `<span class="sym"></span><span class="led"></span><span class="no">${pos + 1}</span>`; b.onclick = () => pressButton(pos, "click"); $("pad").appendChild(b); }
}
function hud() {
  const b = S.ball; let pos = "-";
  if (b) pos = (b.c != null && b.r != null && b.mode !== "lift" && b.mode !== "lost") ? `col ${b.c}, row ${b.r}  (${b.mode})` : b.mode;
  $("hPos").textContent = pos; $("hState").textContent = S.state;
  $("hSeq").innerHTML = S.seq.length ? S.seq.map(i => chip(DOTS[i].rgb)).join("") : "<span style='color:var(--muted)'>none</span>";
  $("hCp").textContent = S.cp >= 0 ? `CP${S.cp + 1} (col ${CPS[S.cp][0]}, row ${CPS[S.cp][1]})` : "none (entry)";
  $("hTime").textContent = S.time.toFixed(1) + " s"; $("hAct").textContent = S.actCount; $("hWaste").textContent = S.wasted;
  $("hPeek").textContent = (S.state === "READY" || S.state === "RUN") ? `${S.peeksLeft} of ${PEEKS_PER_RUN}` : "-";
  $("hUnl").innerHTML = BUTTON_SYMBOLS.map((s, i) => `<span style="width:20px;height:20px;display:inline-block;opacity:${S.unl[i] ? 1 : .25}">${symSvg(s)}</span>`).join("");
  const m = $("msg"); m.textContent = S.msg; m.className = "msg " + S.msgKind; const un = S.state === "READY" || S.state === "RUN";
  for (let pos = 0; pos < 4; pos++) { const el = $("pb" + pos), led = el.querySelector(".led"), sym = el.querySelector(".sym");
    const html = S.unl[pos] ? symSvg(BUTTON_SYMBOLS[pos]) : "<span style='font-weight:700;opacity:.5'>?</span>"; if (sym.dataset.h !== html) { sym.innerHTML = html; sym.dataset.h = html; }
    led.className = "led " + (S.led[pos] > 0 ? S.ledCol[pos] : ""); el.classList.toggle("hit", S.btnHit[pos] > 0); el.classList.toggle("aim", S.aim === pos && S.btnHit[pos] <= 0); }
  $("bPeek").disabled = !un || S.peeksLeft <= 0; $("peeks").textContent = un ? `${S.peeksLeft} peek(s) left` : ""; $("padMid").textContent = needleVisible() ? "needle → " + POS_NAMES[S.needle] : "4 buttons";
  $("bOut").disabled = S.state !== "WIN";
  $("cap1").textContent = S.cap1 || "-"; $("cap2").textContent = S.msg; $("capState").textContent = S.state; $("capDots").textContent = S.prog + "/4"; $("capPress").textContent = S.actCount;
}
function renderSolution() {
  if (!PLAN.length) { $("sol").innerHTML = "<div class='no'>No winning plan found.</div>"; return; }
  const gates = PLAN.filter(s => s.act !== "WOBBLE" && s.act !== "LIFT").length, lifts = PLAN.filter(s => s.act === "LIFT").length;
  const kindOf = a => ["LEFT", "RIGHT", "FLOOR", "LIFT"].indexOf(a);
  $("sol").innerHTML = `<div style="display:block"><b>${PLAN.length} steps</b>: ${gates} gate presses, ${lifts} lifts, ${PLAN.length - gates - lifts} waits for a sideways roll. Presses use the CURRENT button mapping. A wait means “let the ball roll one cell by itself”, which takes luck on the real board; Play makes those rolls happen.</div>`
    + PLAN.map((s, i) => { const [c, r] = s.cell, n = `<span style="width:1.8em;color:var(--muted)">${i + 1}.</span>`;
      if (s.act === "WOBBLE") return `<div>${n}wait: ball rolls sideways at (${c}, ${r})</div>`;
      const pos = S.map.indexOf(kindOf(s.act)), g = (S.maze.slots[c + "," + r] || {})[s.act === "FLOOR" ? "floor" : s.act === "LEFT" ? "L" : "R"];
      return `<div>${n}button ${pos + 1} (${BUTTON_SYMBOLS[pos]}) = ${KINDS[kindOf(s.act)]} at (${c}, ${r})${g ? " " + g.id : ""}${s.lift ? " (drains, lift returns ball)" : ""}</div>`; }).join("");
}
function replan() { PLAN = solveFrom(S.maze) || []; S.route = PLAN.length ? planRoute() : null; renderSolution(); }
function canvasPos(ev) { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * cv.width - OX, (ev.clientY - r.top) / r.height * cv.height - OY]; }
function hitGate(wx, wy) {
  const x = wx, y = PH - wy; let best = null, bd = 1e9;
  for (const g of GATES) { const [h, e] = gateSeg(g, 0), mx = (h[0] + e[0]) / 2, my = (h[1] + e[1]) / 2, d = Math.hypot(x - mx, y - my); if (d < 30 && d < bd) { bd = d; best = g; } }
  return best;
}
cv.addEventListener("pointermove", ev => { if (!S.debug) { S.hover = null; return; } const p = canvasPos(ev); S.hover = hitGate(p[0], p[1]); cv.style.cursor = S.hover ? "pointer" : "default"; });
cv.addEventListener("pointerleave", () => { S.hover = null; });
cv.addEventListener("click", ev => { if (!S.debug) return; const p = canvasPos(ev), g = hitGate(p[0], p[1]); if (g) requestFire(g, "debug click"); });
addEventListener("keydown", ev => { if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
  const i = "1234".indexOf(ev.key); if (i >= 0) pressButton(i, "key"); else if (ev.code === "Space" && ev.target === document.body) { ev.preventDefault(); releaseBall(); } });
$("bArm").onclick = arm; $("bDrop").onclick = releaseBall; $("bReset").onclick = hardReset; $("bOut").onclick = outputCode;
$("bClear").onclick = () => { S.strokes = []; S.tsNote = ""; }; $("bPeek").onclick = startPeek;
$("bRoute").onclick = () => { S.showRoute = !S.showRoute; $("bRoute").classList.toggle("on", S.showRoute); };
$("bSolve").onclick = () => { replan(); S.showRoute = true; $("bRoute").classList.add("on"); log("auto-solve: " + PLAN.length + " steps"); };
$("bPlay").onclick = () => {
  if (S.state !== "READY") { resetRunData(); S.unl = [true, true, true, true]; setState("READY"); S.peek = null; }
  S.peeksLeft = PEEKS_PER_RUN; if (releaseBall()) { S.wobbleOff = true; S.auto = { steps: (PLAN.length ? PLAN : solveFrom(S.maze) || []).slice(), i: 0 }; setMsg("Auto-play: pressing the buttons from the plan (assisted rolls)", ""); log("auto-play started"); }
};
$("tDebug").onchange = e => { S.debug = e.target.checked; log("debug click-to-fire " + (S.debug ? "on" : "off")); };
$("tSkip").onchange = e => { S.skip = e.target.checked; };
$("tCompass").onchange = e => { S.compass = e.target.checked; reshuffle(); S.runNo = 0; renderSolution(); };
$("tSound").onchange = e => { S.sound = e.target.checked; };
$("tRoof").onchange = e => { S.maze = new Maze(e.target.checked); log("roof gates " + (S.maze.roof ? "work" : "dead")); replan(); };
$("bWob").onclick = () => { S.wobble = (S.wobble + 1) % 3; $("bWob").textContent = "Rolling: " + WOBN[S.wobble]; };
[0.5, 1, 2, 4].forEach(v => { const b = document.createElement("button"); b.textContent = v + "×"; b.onclick = () => { S.speed = v; [...$("speed").children].forEach(x => x.classList.toggle("on", x === b)); }; if (v === 1) b.classList.add("on"); $("speed").appendChild(b); });

// ---- scripted demo: a player solves the riddles, then plays the maze; captions say what is pressed ----
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (f, ms) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await sleep(60); };
function demoStrokes(shape) {
  const cx = 260, cy = 235, R = 58, lerp = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  const wob = (pts, k = 2) => pts.map((p, i) => [p[0] + Math.sin(i * 1.7) * k, p[1] + Math.cos(i * 1.3) * k]);
  if (shape === "triangle") { const v = [[cx, cy - R], [cx + R, cy + R * .85], [cx - R, cy + R * .85], [cx, cy - R]]; return [wob([].concat(lerp(v[0], v[1], 14), lerp(v[1], v[2], 14), lerp(v[2], v[3], 14), [v[3]]))]; }
  if (shape === "square") { const v = [[cx - R, cy - R], [cx + R, cy - R], [cx + R, cy + R], [cx - R, cy + R], [cx - R, cy - R]]; return [wob([].concat(lerp(v[0], v[1], 12), lerp(v[1], v[2], 12), lerp(v[2], v[3], 12), lerp(v[3], v[4], 12), [v[4]]))]; }
  if (shape === "circle") return [wob(Array.from({ length: 56 }, (_, i) => [cx + R * Math.cos(-1.57 + i / 54 * 6.283), cy + R * Math.sin(-1.57 + i / 54 * 6.283)]), 1.5)];
  return [wob(lerp([cx - R, cy], [cx + R, cy], 22).concat([[cx + R, cy]])), wob(lerp([cx, cy - R], [cx, cy + R], 22).concat([[cx, cy + R]]))];
}
async function drawWithFinger(shape) {
  for (const st of demoStrokes(shape)) {
    S.finger = { x: st[0][0], y: st[0][1] - 30, down: false }; await sleep(350);
    S.strokes.push([]); S.drawing = true; S.finger.down = true;
    for (const p of st) { S.strokes[S.strokes.length - 1].push(p); S.finger.x = p[0]; S.finger.y = p[1]; S.lastDraw = performance.now(); await sleep(22); }
    S.drawing = false; S.finger.down = false; S.lastDraw = performance.now(); await sleep(300);
  }
}
async function demo() {
  S.demo = true; document.body.classList.add("demo"); S.sound = false; S.speed = 1; hardReset(); window.__demoDone = false;
  S.cap1 = "The prop is idle. The touch screen waits for the previous puzzle to finish (TER02_SOLVED)."; await sleep(3000);
  S.cap1 = "Previous puzzle solved: the prop is armed. A riddle appears on the touch screen."; arm(); await sleep(2200);
  let n = 0;
  while (S.state === "UNLOCK" && S.riddle) {
    const rd = S.riddle; n++;
    S.cap1 = `Riddle ${n} of 4: “${rd.text}” The player draws a ${rd.shape.toUpperCase()} with a finger.`; await sleep(3200);
    await drawWithFinger(rd.shape);
    await waitFor(() => S.state !== "UNLOCK" || S.riddle !== rd, 7000); S.finger = null;
    S.cap1 = S.unl[rd.btn] ? `Drawing recognised. Button ${rd.btn + 1} (${rd.shape}) is unlocked.` : "Not recognised, the player tries again."; await sleep(1800);
  }
  S.cap1 = "All four symbols unlocked. The PEEK screen shows what each button does for 5 s: " + [0, 1, 2, 3].map(p => `${BUTTON_SYMBOLS[p]} = ${KINDS[S.map[p]]}`).join(", ") + "."; await sleep(6500);
  S.cap1 = "The player presses button 1 to release the ball. Four buttons, four hidden actions."; await sleep(2500);
  S.speed = 2; pressButton(0, "player");
  S.auto = { steps: (PLAN.length ? PLAN : solveFrom(S.maze) || []).slice(), i: 0 };
  await waitFor(() => S.state === "WIN", 400000);
  S.speed = 1; S.cap1 = `Code revealed on the touch screen: ${CODE.join(" > ")}. TER06_SOLVED is sent to the next puzzle. The button mapping reshuffles for the next player.`;
  await sleep(7000); window.__demoDone = true;
}

(function init() {
  const R = selfCheck(); buildPad(); reshuffle();
  console.log("[Trick Wall 20x20] self-test " + (R.ok ? "PASSED" : "FAILED") + "\n" + R.log.join("\n"));
  $("check").innerHTML = `<div class="${R.ok ? "ok" : "no"}"><b>${R.ok ? "All checks passed" : "A check failed"}</b></div>` + R.log.map(l => `<div style="display:block">${l}</div>`).join("");
  $("hCode").innerHTML = CODE.map(n => chip(dotRgb(n))).join(""); PLAN = R.sol || []; S.route = planRoute(); renderSolution();
  window.TW = { demo, S, selfCheck, solveFrom, pressButton, arm, releaseBall, hardReset, Maze };
})();
$("bDemo").onclick = demo;
let last = performance.now();
function frame(t) { const dt = Math.min(.05, (t - last) / 1000); last = t; update(dt); draw(); drawTouch(); hud(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
if (location.hash === "#demo") setTimeout(demo, 800);
