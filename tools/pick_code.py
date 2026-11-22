"""Search for solvable dot colours + exit and write code_config.py.  Usage: python tools/pick_code.py [seconds]"""
import os, random, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sim import *

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 60
maze, rng, best = Maze(False), random.Random(), (0, None, None)
t = time.time()
while time.time() - t < secs:
    dots, ex = rng.sample(DOTS, 4), rng.choice(BOTTOM_HOLES)
    sol = solve(maze, Code(dots, ex), max_states=60000)
    if sol and len(sol) > best[0]:
        best = (len(sol), dots, ex)
        print("solvable, shortest", len(sol), "actions:", dots, ex)
if best[1]:
    path = os.path.join(os.path.dirname(__file__), "..", "code_config.py")
    open(path, "w").write(f"DOT_CELLS = {best[1]}\nEXIT_CELL = {best[2]}\n")
    print("wrote", os.path.abspath(path))
