# TER06 "The Trick Wall" - Python simulation

Playable pygame version of the maze board described in `TER06_Game_Description_ALL.md`.

    pip install -r requirements.txt
    python3 game.py

**Goal:** steer the steel ball through the dots GREEN -> RED -> YELLOW -> BLUE, then out of the real exit
(bottom row). You can't touch the ball; press buttons **1-4** (or Q W E R / click). Each button secretly does
PUSH LEFT / PUSH RIGHT / OPEN FLOOR / LIFT at the ball's current cell, and the mapping is reshuffled after every run.
Wrong moves send the ball to a drain; the lift returns it to the last checkpoint (or the start).

Keys: `H` reveal mapping + exit, `T` fixed mapping (practice), `O` wobble off/normal/wild,
`P` roof gates work, `N` new run, `Esc` quit.

## Files
- `maze_data.py` - walls, gates (all 39), checkpoints, holes, dot recesses from the description.
- `sim.py` - rules + a BFS solver that proves a code/exit set-up is winnable.
- `code_config.py` - dot colours and real exit (open questions 2-4). `python3 tools/pick_code.py` picks a new set.
- `game.py` - the game and rendering.

## Choices made for the "open questions"
- **Dots / exit:** 4 of the 12 recesses are coloured (others are decoys); exit is one of the 3 bottom holes (others are drains).
- **Roof push gates** (<21 >23 <27 >31 <36): dead by default because the CAD flap can't reach a resting ball. `P` makes them work.
- **Rolling / drift:** the CAD's 250 reachable cells assume sideways movement wherever there is no wall, so a resting
  ball slowly wobbles one cell sideways, and a falling ball can be jostled sideways (`DRIFT_P` in `sim.py`).
- **Gate speed:** SG90-like ~0.15 s to open; gates close again after the ball passes.
- **Wrong colour order** resets the code; collecting the right dot while passing a checkpoint is kept after a lift.
