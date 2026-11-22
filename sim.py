"""Game logic for TER06 'The Trick Wall' (cell-based simulation of the rules in the description)."""
import random
from collections import deque
from maze_data import *

LEFT, RIGHT, FLOOR, LIFT = "LEFT", "RIGHT", "FLOOR", "LIFT"
ACTIONS = (LEFT, RIGHT, FLOOR, LIFT)
COLOURS = ("green", "red", "yellow", "blue")   # the one correct order

# Settings (the "open questions" of the description are settings, not facts)
DRIFT_P = 0.2          # chance per open side that a falling ball is jostled sideways in a floorless cell


class Maze:
    def __init__(self, roof_gates_work=False):
        self.roof_gates_work = roof_gates_work
        self.gates = {}                      # (col,row) -> {"floor": g, "L": g, "R": g}
        for g in GATES:
            slot = self.gates.setdefault((g["col"], g["row"]), {})
            if g["type"] == "floor":
                slot["floor"] = g
            else:
                if g["mount"] == "roof" and not roof_gates_work:
                    slot["dead_" + g["push"]] = g       # present but cannot reach a resting ball
                else:
                    slot[g["push"]] = g
        self.cp_set = set(CHECKPOINTS)
        self.holes = set(BOTTOM_HOLES)
        self.dot_set = set(DOTS)

    # ---- geometry -------------------------------------------------------
    def has_floor(self, c, r):
        return r == 0 or H_LINES[r][c] == "1"

    def wall_between(self, c, r, d):
        """wall between (c,r) and (c+d,r)"""
        k = c + 1 if d > 0 else c
        return V_LINES[k][r] == "1"

    def has_gate(self, c, r):
        s = self.gates.get((c, r), {})
        return any(k in s for k in ("floor", "L", "R", "dead_L", "dead_R"))

    # ---- movement -------------------------------------------------------
    # Cell-level physics. A ball only drops when there is no floor under it. A ball resting on a
    # level floor may "roll a little" (description, rule 3): we model this as a WOBBLE of one cell
    # to the left or right wherever there is no wall (the upper-bound rule behind the 250 reachable
    # cells). Gates only work on a ball that is in their cell when the button is pressed.
    ACTIONS_ALL = ("LEFT", "RIGHT", "FLOOR", "LIFT", "WOBBLE")

    def settle(self, c, r, path, drifts=2):
        """Ball arrives in (c,r). Returns [(prob, path, 'rest'|'hole')].
        In a cell with no floor the ball falls, but may be jostled one cell sideways (DRIFT_P per
        open side, at most `drifts` times) -- the free-sideways rule behind the 250 reachable cells."""
        if self.has_floor(c, r):
            return [(1.0, path, "hole" if (c, r) in self.holes else "rest")]
        outs = []
        sides = [d for d in (-1, 1) if drifts > 0 and not self.wall_between(c, r, d)]
        p_fall = 1.0 - DRIFT_P * len(sides)
        outs += [(p_fall * q, p2, t) for q, p2, t in self.settle(c, r - 1, path + [(c, r - 1, "fall")], drifts)]
        for d in sides:
            outs += [(DRIFT_P * q, p2, t) for q, p2, t in
                     self.settle(c + d, r, path + [(c + d, r, "drift")], drifts - 1)]
        return outs

    def release(self, cell):
        return self.settle(cell[0], cell[1], [(cell[0], cell[1], "start")])

    def wobble_options(self, cell):
        """Possible one-cell rolls from a resting cell: list of (dir, outcomes)."""
        c, r = cell
        out = []
        for d in (-1, 1):
            if not self.wall_between(c, r, d):
                out.append((d, self.settle(c + d, r, [(c, r, "start"), (c + d, r, "roll")])))
        return out

    def act(self, cell, action):
        """(gate, [(prob, path, terminal), ...]) for a button press with the ball in `cell`, or None."""
        c, r = cell
        slot = self.gates.get(cell, {})
        if action == "WOBBLE":
            opts = self.wobble_options(cell)
            if not opts:
                return None
            return None, [(q / len(opts), p, t) for _d, o in opts for q, p, t in o]
        if action == FLOOR and "floor" in slot:
            return slot["floor"], self.settle(c, r - 1, [(c, r, "start"), (c, r - 1, "fall")])
        if action in (LEFT, RIGHT):
            key = "L" if action == LEFT else "R"
            if key in slot:
                d = -1 if key == "L" else 1
                if self.wall_between(c, r, d):
                    return None
                return slot[key], self.settle(c + d, r, [(c, r, "start"), (c + d, r, "push")])
        return None


class Code:
    """Dot colours + real exit for one maze set-up."""
    def __init__(self, dot_cells, exit_cell):
        self.dot_cells = tuple(dot_cells)          # cells in order green, red, yellow, blue
        self.exit_cell = exit_cell
        self.colour_of = {cell: COLOURS[i] for i, cell in enumerate(self.dot_cells)}


def apply_touches(code, path, progress, cp):
    """Walk a path, updating (progress, checkpoint). Returns (progress, cp)."""
    for (c, r, _k) in path[1:]:
        cell = (c, r)
        if cell in CHECKPOINTS:
            cp = cell
        if cell in code.colour_of:
            idx = code.dot_cells.index(cell)
            if idx == progress:
                progress += 1
            elif idx > progress:
                progress = 0               # wrong order -> code resets
    return progress, cp


def solve(maze, code, max_states=400000):
    """BFS (best-case luck) over (cell, progress, cp). Returns shortest action list that can win, or None."""
    init = []
    for _pr, path, term in maze.release(ENTRY):
        prog, cp = apply_touches(code, path, 0, None)
        init.append((path[-1][:2], prog, cp))
    seen = {s: None for s in init}
    dq = deque(init)
    cache = {}
    n = 0
    while dq:
        st = dq.popleft()
        cell, prog, cp = st
        n += 1
        if n > max_states:
            return None
        for a in ACTIONS + ("WOBBLE",):
            if a == LIFT:
                key = ("lift", cp)
                if key not in cache:
                    cache[key] = (None, maze.release(cp or ENTRY))
                gate, outs = cache[key]
            else:
                key = (cell, a)
                if key not in cache:
                    cache[key] = maze.act(cell, a) or (None, [])
                gate, outs = cache[key]
            for _pr, path, term in outs:
                p2, cp2 = apply_touches(code, path, prog, cp)
                if term == "hole":
                    hole = path[-1][:2]
                    if hole == code.exit_cell and p2 == 4:
                        acts, s = [a], st
                        while seen[s] is not None:
                            s, pa = seen[s]
                            acts.append(pa)
                        return acts[::-1]
                    for _p2, path2, t2 in maze.release(cp2 or ENTRY):      # drain: lift back
                        p3, cp3 = apply_touches(code, path2, p2, cp2)
                        nst = (path2[-1][:2], p3, cp3)
                        if t2 == "rest" and nst not in seen:
                            seen[nst] = (st, a); dq.append(nst)
                    continue
                nst = (path[-1][:2], p2, cp2)
                if nst not in seen:
                    seen[nst] = (st, a)
                    dq.append(nst)
    return None


def reachable(maze):
    """Resting cells reachable (ignoring dots), plus checkpoints and holes touched."""
    seen, cps, holes = set(), set(), set()
    todo = []
    def take(outs):
        for _pr, path, term in outs:
            for (c, r, _k) in path:
                if (c, r) in CHECKPOINTS and (c, r) not in cps:
                    cps.add((c, r)); take(maze.release((c, r)))
            if term == "rest":
                todo.append(path[-1][:2])
            else:
                holes.add(path[-1][:2])
    take(maze.release(ENTRY))
    while todo:
        cell = todo.pop()
        if cell in seen:
            continue
        seen.add(cell)
        for a in (LEFT, RIGHT, FLOOR, "WOBBLE"):
            res = maze.act(cell, a)
            if res:
                take(res[1])
    return seen, cps, holes
