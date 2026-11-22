"""Static maze data for TER06 'The Trick Wall' (from the game description)."""

COLS, ROWS = 20, 20
CELL_W, CELL_H = 39.75, 60.0
X0, Y0 = 30.0, 50.0

H_LINES = [
 "11111111111111111111", "00000100011001010001", "00000011000110101110",
 "00000010110011010001", "10000100101110010010", "00001011011010001001",
 "10010111010011000100", "00000000001101100011", "01111100100010100101",
 "01010010010101000010", "01001011100010110100", "00110111111101101011",
 "00000110010001000110", "01011110000001010010", "10010101001010101001",
 "01011001111101000110", "10100010100110100100", "01001000101100011011",
 "10001101011000100111", "00100111100110011110", "11111111111111111111"]
V_LINES = [
 "11111111111111111111", "00000011111100000001", "00000000000111101010",
 "00000001111010011101", "00001011000010101010", "00011110111000011100",
 "01100001000001111111", "00010011110010001100", "11111010100111011000",
 "01000111011010100100", "00110001110011010001", "11100110101110101011",
 "01011010011111000100", "10000001101000011110", "01010100000110101110",
 "00101011111110110000", "01010110110110111100", "10111011010001001101",
 "11011110101101100000", "00000100010010010000", "11111111111111111111"]

ENTRY = (9, 18)
CHECKPOINTS = [(6, 14), (13, 14), (5, 9), (12, 9), (10, 4), (8, 1)]
BOTTOM_HOLES = [(7, 0), (10, 0), (17, 0)]
DOTS = [(16, 17), (2, 16), (11, 16), (14, 14), (18, 12), (11, 11),
        (1, 9), (14, 7), (7, 6), (17, 6), (15, 3), (2, 1)]

# (id, type, mount, push, col, row)   type: floor | push ; mount: floor | side | roof
_G = """F1 floor floor - 10 18
F2 floor floor - 4 8
F3 floor floor - 5 6
F4 floor floor - 14 11
F5 floor floor - 8 11
F6 floor floor - 8 3
F7 floor floor - 2 11
F8 floor floor - 17 8
F9 floor floor - 19 7
F10 floor floor - 10 7
F11 floor floor - 6 13
F12 floor floor - 12 6
F13 floor floor - 16 2
F14 floor floor - 9 15
F15 floor floor - 6 2
F16 floor floor - 15 13
F17 floor floor - 6 16
F18 floor floor - 0 4
F19 floor floor - 12 3
F20 floor floor - 17 12
<21 push roof L 7 18
<22 push side L 8 17
>23 push roof R 7 14
<24 push side L 10 14
<25 push side L 13 12
<26 push side L 2 8
<27 push roof L 5 11
<28 push side L 10 11
<29 push side L 12 8
<30 push side L 17 10
>31 push roof R 6 5
>32 push side R 9 6
>33 push side R 13 7
>34 push side R 16 5
>35 push side R 0 0
<36 push roof L 5 0
<37 push side L 10 1
<38 push side L 14 2
<39 push side L 19 3"""

GATES = []
for _line in _G.splitlines():
    i, t, m, p, c, r = _line.split()
    GATES.append(dict(id=i, type=t, mount=m, push=None if p == "-" else p,
                      col=int(c), row=int(r)))
