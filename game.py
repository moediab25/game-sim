#!/usr/bin/env python3
"""TER06 "The Trick Wall" - playable simulation (pygame).

Steer the ball through the coloured dots  GREEN -> RED -> YELLOW -> BLUE  and out of the real exit.
You never touch the ball: press one of 4 buttons. Each button secretly does one of
PUSH LEFT / PUSH RIGHT / OPEN FLOOR / LIFT, and the mapping is reshuffled after every run.

Keys: 1-4 (or Q W E R / click) = buttons | H reveal mapping+exit | T fixed/shuffled mapping
      O wobble (ball rolling on level floors) off/normal/wild | P roof gates work (CAD fix) | N new run | Esc quit
"""
import math
import os
import random
import sys

import pygame

import sim
from maze_data import *
from sim import Maze, Code, LEFT, RIGHT, FLOOR, LIFT, COLOURS

# ---------------------------------------------------------------- code (dots + exit) ----------
# Chosen offline by search (see tools/pick_code.py): a set-up that is solvable with the physics rules.
DEFAULT_CODE = Code(
    [(2, 16), (14, 14), (11, 11), (17, 6)],   # green, red, yellow, blue  (overwritten by code_config.py)
    (10, 0))
try:
    import code_config
    DEFAULT_CODE = Code(code_config.DOT_CELLS, code_config.EXIT_CELL)
except ImportError:
    pass

COL_RGB = {"green": (60, 210, 90), "red": (235, 70, 70), "yellow": (240, 210, 60), "blue": (70, 140, 255)}
BTN_KEYS = [pygame.K_1, pygame.K_2, pygame.K_3, pygame.K_4]
BTN_ALT = [pygame.K_q, pygame.K_w, pygame.K_e, pygame.K_r]
BTN_NAMES = {LEFT: "PUSH LEFT", RIGHT: "PUSH RIGHT", FLOOR: "OPEN FLOOR", LIFT: "LIFT"}

WIN_W, WIN_H = 920, 840
S = 0.62                       # px per mm
BX, BY = 14, 14                # board origin (px) = plate top-left
PANEL_X = int(BX + 855 * S + 16)

FALL_T, MOVE_T = 0.11, 0.22    # seconds per cell leg
GATE_T, HOLD_T = 0.15, 0.30    # gate open time, hold time
WOBBLE_RATE = {0: None, 1: (2.0, 4.0), 2: (0.8, 1.8)}
WOBBLE_NAMES = {0: "off", 1: "normal", 2: "wild"}

BG = (22, 24, 30)
PLATE = (205, 170, 120)
WALL = (110, 70, 40)


def px(x, y):
    return BX + x * S, BY + (1300 - y) * S


def cell_floor_y(r):
    return Y0 + r * CELL_H


def ball_pos(c, r):
    return X0 + (c + 0.5) * CELL_W, cell_floor_y(r) + 7 + 2


# ---------------------------------------------------------------- gate geometry --------------
def gate_len(g):
    if g["type"] == "floor":
        return 28.75 if (g["col"] in (0, 19)) else 30.75
    if g["mount"] == "side":
        return 49.0 if g["col"] in (0, 19) else 51.0
    return 30.75


def gate_segment(g, theta):
    """(hinge, free_end) in mm for open angle theta (radians, 0..pi/2)."""
    c, r, L = g["col"], g["row"], gate_len(g)
    if g["type"] == "floor":
        hx, hy = X0 + c * CELL_W + 3, Y0 + r * CELL_H
        v = (math.cos(theta), -math.sin(theta))
    elif g["mount"] == "side":
        if g["push"] == "L":
            hx, hy = X0 + (c + 1) * CELL_W, Y0 + (r + 1) * CELL_H - 4.5
            v = (-math.sin(theta), -math.cos(theta))
        else:
            hx, hy = X0 + c * CELL_W, Y0 + (r + 1) * CELL_H - 4.5
            v = (math.sin(theta), -math.cos(theta))
    else:  # roof
        if g["push"] == "L":
            hx, hy = X0 + c * CELL_W + 4.5, Y0 + (r + 1) * CELL_H
            v = (math.cos(theta), -math.sin(theta))
        else:
            hx, hy = X0 + (c + 1) * CELL_W - 4.5, Y0 + (r + 1) * CELL_H
            v = (-math.cos(theta), -math.sin(theta))
    return (hx, hy), (hx + v[0] * L, hy + v[1] * L)


def gate_wall_segments(g):
    """The wall segment this gate replaces: ('h'|'v', k, idx)."""
    c, r = g["col"], g["row"]
    if g["type"] == "floor":
        return ("h", r, c)
    if g["mount"] == "roof":
        return ("h", r + 1, c)
    return ("v", c + 1 if g["push"] == "L" else c, r)


# ---------------------------------------------------------------- game state -----------------
class Game:
    def __init__(self, code=DEFAULT_CODE, seed=None):
        self.rng = random.Random(seed)
        self.code = code
        self.maze = Maze(roof_gates_work=False)
        self.fixed_map = False
        self.wobble = 1
        self.reveal = False
        self.stats = dict(runs=0, wins=0, presses=0, drains=0)
        self.log = []
        self.gate_anim = {}            # gate id -> {"t":0.., "state":..}
        self.new_run(first=True)

    # ---- helpers
    def say(self, text, colour=(230, 230, 230)):
        self.log.insert(0, (text, colour))
        del self.log[7:]

    def shuffle_map(self):
        acts = list(sim.ACTIONS)
        self.rng.shuffle(acts)
        self.button_map = acts

    def new_run(self, first=False):
        if not (self.fixed_map and not first and hasattr(self, "button_map")):
            self.shuffle_map()
        self.progress = 0
        self.cp = None
        self.run_presses = 0
        self.pressed_flash = [0.0] * 4
        self.stats["runs"] += 0 if first else 0
        self.queue = []                # waypoints still to travel: (c, r, kind)
        self.busy_until_done = False
        self.after = None              # callback after movement
        self.pending_gate = None
        self.cell = ENTRY
        self.collected = []
        self.entry_drop()
        self.say("New run - buttons reshuffled." if not self.fixed_map else "New run.", (150, 200, 255))

    def entry_drop(self):
        start = [(ENTRY[0], ENTRY[1] + 1)]
        outs = self.maze.settle(ENTRY[0], ENTRY[1] + 1, [(ENTRY[0], ENTRY[1] + 1, "start")])
        _, path, term = self.choose(outs)
        self.cell = (ENTRY[0], ENTRY[1] + 1)
        self.px, self.py = ball_pos(*self.cell)
        self.start_travel(path, term)

    def choose(self, outs):
        r = self.rng.random()
        acc = 0.0
        for o in outs:
            acc += o[0]
            if r <= acc:
                return o
        return outs[-1]

    # ---- movement
    def start_travel(self, path, term, gate=None):
        self.queue = [(c, r, k) for (c, r, k) in path[1:]]
        self.term = term
        self.leg = None
        self.leg_t = 0.0
        self.moving = True
        self.gate_wait = 0.0
        if gate is not None:
            self.gate_anim[gate["id"]] = dict(t=0.0, closing=False, hold=0.0)
            self.gate_wait = GATE_T * 0.8
        self.wobble_timer = self.next_wobble()

    def next_wobble(self):
        w = WOBBLE_RATE[self.wobble]
        return None if w is None else self.rng.uniform(*w)

    def touch(self, cell):
        if cell in CHECKPOINTS:
            if self.cp != cell:
                self.say(f"Checkpoint {CHECKPOINTS.index(cell) + 1} passed", (140, 220, 255))
            self.cp = cell
        if cell in self.code.colour_of:
            idx = self.code.dot_cells.index(cell)
            col = COLOURS[idx]
            if idx == self.progress:
                self.progress += 1
                self.collected.append(cell)
                self.say(f"{col.upper()} dot collected ({self.progress}/4)", COL_RGB[col])
            elif idx > self.progress:
                if self.progress:
                    self.say(f"{col.upper()} out of order - code reset!", (255, 140, 90))
                self.progress = 0
                self.collected = []

    def update(self, dt):
        for i in range(4):
            self.pressed_flash[i] = max(0.0, self.pressed_flash[i] - dt)
        # gates
        for gid, a in list(self.gate_anim.items()):
            if not a["closing"]:
                a["t"] = min(1.0, a["t"] + dt / GATE_T)
                if not self.moving and a["t"] >= 1.0:
                    a["hold"] += dt
                    if a["hold"] > HOLD_T * 0.3:
                        a["closing"] = True
            else:
                a["t"] -= dt / GATE_T
                if a["t"] <= 0:
                    del self.gate_anim[gid]
        if self.moving:
            self.gate_wait = max(0.0, self.gate_wait - dt)
            if self.gate_wait > 0:
                return
            if self.leg is None:
                if not self.queue:
                    self.arrive()
                    return
                c, r, k = self.queue.pop(0)
                tx, ty = ball_pos(c, r)
                self.leg = (self.px, self.py, tx, ty, FALL_T if k == "fall" else MOVE_T, (c, r))
                self.leg_t = 0.0
            x0, y0, x1, y1, T, cell = self.leg
            self.leg_t += dt
            u = min(1.0, self.leg_t / T)
            self.px, self.py = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
            if u >= 1.0:
                self.cell = cell
                self.touch(cell)
                self.leg = None
        else:
            # resting: wobble
            if self.wobble_timer is not None:
                self.wobble_timer -= dt
                if self.wobble_timer <= 0:
                    self.do_wobble()
                    if not self.moving:
                        self.wobble_timer = self.next_wobble()

    def arrive(self):
        self.moving = False
        self.px, self.py = ball_pos(*self.cell)
        if self.term == "hole":
            self.on_hole(self.cell)
        else:
            self.wobble_timer = self.next_wobble()

    def on_hole(self, cell):
        if cell == self.code.exit_cell:
            self.stats["runs"] += 1
            if self.progress == 4:
                self.stats["wins"] += 1
                self.say("EXIT! Code complete - YOU WIN!", (120, 255, 140))
            else:
                self.say("Out of the exit - but the code was incomplete.", (255, 150, 90))
            self.run_over = True
            self.new_run()
        else:
            self.stats["drains"] += 1
            self.say("Drain! Lift returns the ball to the last checkpoint.", (255, 120, 120))
            self.do_lift(auto=True)

    def do_wobble(self):
        opts = self.maze.wobble_options(self.cell)
        if not opts:
            self.wobble_timer = self.next_wobble()
            return
        d, outs = self.rng.choice(opts)
        _, path, term = self.choose(outs)
        self.start_travel(path, term)

    def do_lift(self, auto=False):
        target = self.cp or ENTRY
        outs = self.maze.release(target) if self.cp else self.maze.settle(
            ENTRY[0], ENTRY[1] + 1, [(ENTRY[0], ENTRY[1] + 1, "start")])
        start_cell = target if self.cp else (ENTRY[0], ENTRY[1] + 1)
        _, path, term = self.choose(outs)
        self.cell = start_cell
        self.px, self.py = ball_pos(*start_cell)
        if self.cp is None:
            self.progress = 0
            self.collected = []
        if not auto:
            self.say("Lift: ball carried back " + ("to the checkpoint." if self.cp else "to the start."),
                     (200, 200, 255))
        self.start_travel(path, term)

    # ---- player input
    def press(self, i):
        if self.moving:
            return
        self.stats["presses"] += 1
        self.pressed_flash[i] = 0.2
        act = self.button_map[i]
        if act == LIFT:
            self.do_lift()
            return
        res = self.maze.act(self.cell, act)
        if not res:
            self.say(f"Button {i + 1}: nothing happened.", (170, 170, 170))
            return
        gate, outs = res
        _, path, term = self.choose(outs)
        self.start_travel(path, term, gate=gate)
        self.say(f"Button {i + 1}: gate {gate['id']} moved!", (255, 230, 150))

    def toggle_roof(self):
        self.maze = Maze(roof_gates_work=not self.maze.roof_gates_work)
        self.say("Roof gates " + ("WORK (flaps lengthened)" if self.maze.roof_gates_work else "dead (as in CAD)"),
                 (200, 200, 255))


# ---------------------------------------------------------------- drawing ----------------------
def draw_board(surf, g, fonts):
    surf.fill(BG)
    pw, ph = 855 * S, 1300 * S
    pygame.draw.rect(surf, PLATE, (BX, BY, pw, ph), border_radius=4)
    # grid
    for k in range(COLS + 1):
        x, _ = px(X0 + k * CELL_W, 0)
        pygame.draw.line(surf, (190, 156, 110), (x, px(0, Y0 + ROWS * CELL_H)[1]), (x, px(0, Y0)[1]), 1)
    for k in range(ROWS + 1):
        _, y = px(0, Y0 + k * CELL_H)
        pygame.draw.line(surf, (190, 156, 110), (px(X0, 0)[0], y), (px(X0 + COLS * CELL_W, 0)[0], y), 1)

    # circles
    def ring(cx, cy, col, w=2, rad=14):
        x, y = px(*ball_centre(cx, cy))
        pygame.draw.circle(surf, col, (x, y), rad * S, w)
        return x, y

    def ball_centre(c, r):
        return X0 + (c + 0.5) * CELL_W, Y0 + (r + 0.5) * CELL_H

    code = g.code
    for cell in DOTS:
        if cell in code.colour_of:
            col = COL_RGB[code.colour_of[cell]]
            x, y = px(*ball_centre(*cell))
            done = cell in g.collected
            pygame.draw.circle(surf, col, (x, y), 14 * S + (2 if done else 0), 0 if done else 3)
            if not done:
                pygame.draw.circle(surf, tuple(int(v * .35 + 100) for v in col), (x, y), 14 * S - 3)
        else:
            ring(*cell, (150, 120, 85), 1)
    for i, cell in enumerate(CHECKPOINTS):
        x, y = ring(*cell, (60, 120, 170), 2, 11)
        pygame.draw.circle(surf, (60, 120, 170) if g.cp != cell else (120, 220, 255), (x, y), 3)
    ring(*ENTRY, (40, 40, 40), 3)
    f = fonts["s"].render("IN", True, (40, 40, 40))
    surf.blit(f, f.get_rect(center=px(*ball_centre(*ENTRY))))
    for cell in BOTTOM_HOLES:
        x, y = px(*ball_centre(*cell))
        pygame.draw.circle(surf, (15, 15, 18), (x, y), 14 * S)
        if g.reveal:
            col = (60, 255, 120) if cell == code.exit_cell else (255, 70, 70)
            pygame.draw.circle(surf, col, (x, y), 14 * S + 2, 2)

    # walls (skip segments that belong to gates)
    skip = {gate_wall_segments(gt) for gt in GATES}
    wt = max(2, int(4 * S))
    for k in range(ROWS + 1):
        for c in range(COLS):
            if H_LINES[k][c] == "1" and ("h", k, c) not in skip:
                a, b = px(X0 + c * CELL_W, Y0 + k * CELL_H), px(X0 + (c + 1) * CELL_W, Y0 + k * CELL_H)
                pygame.draw.line(surf, WALL, a, b, wt)
    for k in range(COLS + 1):
        for r in range(ROWS):
            if V_LINES[k][r] == "1" and ("v", k, r) not in skip:
                a, b = px(X0 + k * CELL_W, Y0 + r * CELL_H), px(X0 + k * CELL_W, Y0 + (r + 1) * CELL_H)
                pygame.draw.line(surf, WALL, a, b, wt)

    # gates
    for gt in GATES:
        a = g.gate_anim.get(gt["id"])
        theta = (a["t"] if a else 0.0) * math.pi / 2
        h, e = gate_segment(gt, theta)
        dead = gt["mount"] == "roof" and not g.maze.roof_gates_work
        colour = (255, 150, 30) if gt["type"] == "floor" else (60, 120, 255)
        if dead:
            colour = (120, 130, 170)
        pygame.draw.line(surf, colour, px(*h), px(*e), max(3, int(5 * S)))
        pygame.draw.circle(surf, (20, 20, 20), px(*h), 2)

    # ball
    pygame.draw.circle(surf, (40, 40, 45), (g.px + 1, g.py + 1), 6)
    pygame.draw.circle(surf, (190, 195, 205), (g.px, g.py), 6)
    pygame.draw.circle(surf, (245, 248, 255), (g.px - 2, g.py - 2), 2)


def draw_panel(surf, g, fonts):
    x = PANEL_X
    w = WIN_W - x - 12
    surf.blit(fonts["h"].render("THE TRICK WALL  TER06", True, (240, 240, 240)), (x, 14))
    surf.blit(fonts["s"].render("Steer: GREEN > RED > YELLOW > BLUE > exit", True, (170, 175, 190)), (x, 42))
    # code progress
    for i, colname in enumerate(COLOURS):
        cx = x + 22 + i * 52
        col = COL_RGB[colname]
        pygame.draw.circle(surf, col, (cx, 86), 16, 0 if i < g.progress else 3)
    # buttons
    surf.blit(fonts["m"].render("Buttons (what do they do?)", True, (220, 220, 230)), (x, 120))
    g.btn_rects = []
    for i in range(4):
        r = pygame.Rect(x, 150 + i * 62, w, 52)
        g.btn_rects.append(r)
        lit = g.pressed_flash[i] > 0
        pygame.draw.rect(surf, (90, 160, 255) if lit else (52, 58, 78), r, border_radius=8)
        pygame.draw.rect(surf, (120, 130, 160), r, 2, border_radius=8)
        label = f"[{i + 1}] BUTTON {i + 1}"
        if g.reveal:
            label += "  =  " + BTN_NAMES[g.button_map[i]]
        surf.blit(fonts["m"].render(label, True, (240, 240, 245)), (r.x + 12, r.y + 14))
    # stats
    y = 150 + 4 * 62 + 8
    st = g.stats
    lines = [f"Runs finished: {st['runs']}    Wins: {st['wins']}",
             f"Presses: {st['presses']}    Drains: {st['drains']}",
             f"Wobble [O]: {WOBBLE_NAMES[g.wobble]}   Roof gates [P]: {'work' if g.maze.roof_gates_work else 'dead'}",
             f"Mapping [T]: {'fixed' if g.fixed_map else 'reshuffled each run'}   Reveal [H]: {'on' if g.reveal else 'off'}"]
    for ln in lines:
        surf.blit(fonts["s"].render(ln, True, (170, 175, 190)), (x, y))
        y += 20
    y += 8
    surf.blit(fonts["m"].render("Log", True, (220, 220, 230)), (x, y))
    y += 26
    for text, col in g.log:
        surf.blit(fonts["s"].render(text[:44], True, col), (x, y))
        y += 20
    # legend
    y = WIN_H - 92
    for txt, col in (("orange = floor gate", (255, 150, 30)), ("blue = side push gate", (60, 120, 255)),
                     ("grey-blue = roof gate (cannot reach ball)", (120, 130, 170))):
        surf.blit(fonts["s"].render(txt, True, col), (x, y))
        y += 20
    surf.blit(fonts["s"].render("N new run   Esc quit", True, (140, 145, 160)), (x, y))


def main():
    pygame.init()
    screen = pygame.display.set_mode((WIN_W, WIN_H))
    pygame.display.set_caption("TER06 The Trick Wall")
    fonts = {"h": pygame.font.SysFont("dejavusans", 22, bold=True),
             "m": pygame.font.SysFont("dejavusans", 18),
             "s": pygame.font.SysFont("dejavusans", 13)}
    game = Game()
    clock = pygame.time.Clock()
    headless_frames = int(os.environ.get("TER06_FRAMES", "0"))
    frame = 0
    running = True
    while running:
        dt = min(clock.tick(60) / 1000.0, 0.05)
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                running = False
            elif ev.type == pygame.KEYDOWN:
                if ev.key == pygame.K_ESCAPE:
                    running = False
                elif ev.key in BTN_KEYS:
                    game.press(BTN_KEYS.index(ev.key))
                elif ev.key in BTN_ALT:
                    game.press(BTN_ALT.index(ev.key))
                elif ev.key == pygame.K_h:
                    game.reveal = not game.reveal
                elif ev.key == pygame.K_t:
                    game.fixed_map = not game.fixed_map
                elif ev.key == pygame.K_o:
                    game.wobble = (game.wobble + 1) % 3
                elif ev.key == pygame.K_p:
                    game.toggle_roof()
                elif ev.key == pygame.K_n:
                    game.new_run()
            elif ev.type == pygame.MOUSEBUTTONDOWN and ev.button == 1:
                for i, r in enumerate(getattr(game, "btn_rects", [])):
                    if r.collidepoint(ev.pos):
                        game.press(i)
        game.update(dt)
        draw_board(screen, game, fonts)
        draw_panel(screen, game, fonts)
        pygame.display.flip()
        frame += 1
        if headless_frames and frame >= headless_frames:
            if os.environ.get("TER06_SHOT"):
                pygame.image.save(screen, os.environ["TER06_SHOT"])
            running = False
    pygame.quit()


if __name__ == "__main__":
    main()
