// Game Constants
export const COLS = 10;
export const ROWS = 20;
export const BLOCK_SIZE = 30;
export const CANVAS_WIDTH = COLS * BLOCK_SIZE;
export const CANVAS_HEIGHT = ROWS * BLOCK_SIZE;

// Colors for each tetromino type
export const COLORS = {
    I: '#00f0f0', // Cyan
    O: '#f0f000', // Yellow
    T: '#a000f0', // Purple
    S: '#00f000', // Green
    Z: '#f00000', // Red
    J: '#0000f0', // Blue
    L: '#f0a000'  // Orange
};

// Tetromino shapes - each rotation state is a 2D array
// 1 represents a filled cell, 0 represents empty
export const SHAPES = {
    I: [
        [[0, 0, 0, 0],
         [1, 1, 1, 1],
         [0, 0, 0, 0],
         [0, 0, 0, 0]],
        [[0, 0, 1, 0],
         [0, 0, 1, 0],
         [0, 0, 1, 0],
         [0, 0, 1, 0]],
        [[0, 0, 0, 0],
         [0, 0, 0, 0],
         [1, 1, 1, 1],
         [0, 0, 0, 0]],
        [[0, 1, 0, 0],
         [0, 1, 0, 0],
         [0, 1, 0, 0],
         [0, 1, 0, 0]]
    ],
    O: [
        [[1, 1],
         [1, 1]],
        [[1, 1],
         [1, 1]],
        [[1, 1],
         [1, 1]],
        [[1, 1],
         [1, 1]]
    ],
    T: [
        [[0, 1, 0],
         [1, 1, 1],
         [0, 0, 0]],
        [[0, 1, 0],
         [0, 1, 1],
         [0, 1, 0]],
        [[0, 0, 0],
         [1, 1, 1],
         [0, 1, 0]],
        [[0, 1, 0],
         [1, 1, 0],
         [0, 1, 0]]
    ],
    S: [
        [[0, 1, 1],
         [1, 1, 0],
         [0, 0, 0]],
        [[0, 1, 0],
         [0, 1, 1],
         [0, 0, 1]],
        [[0, 0, 0],
         [0, 1, 1],
         [1, 1, 0]],
        [[1, 0, 0],
         [1, 1, 0],
         [0, 1, 0]]
    ],
    Z: [
        [[1, 1, 0],
         [0, 1, 1],
         [0, 0, 0]],
        [[0, 0, 1],
         [0, 1, 1],
         [0, 1, 0]],
        [[0, 0, 0],
         [1, 1, 0],
         [0, 1, 1]],
        [[0, 1, 0],
         [1, 1, 0],
         [1, 0, 0]]
    ],
    J: [
        [[1, 0, 0],
         [1, 1, 1],
         [0, 0, 0]],
        [[0, 1, 1],
         [0, 1, 0],
         [0, 1, 0]],
        [[0, 0, 0],
         [1, 1, 1],
         [0, 0, 1]],
        [[0, 1, 0],
         [0, 1, 0],
         [1, 1, 0]]
    ],
    L: [
        [[0, 0, 1],
         [1, 1, 1],
         [0, 0, 0]],
        [[0, 1, 0],
         [0, 1, 0],
         [0, 1, 1]],
        [[0, 0, 0],
         [1, 1, 1],
         [1, 0, 0]],
        [[1, 1, 0],
         [0, 1, 0],
         [0, 1, 0]]
    ]
};

// All tetromino types for random generation
export const TETROMINO_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// Scoring system (lines cleared -> points)
export const SCORE_TABLE = {
    1: 100,
    2: 300,
    3: 500,
    4: 800  // Tetris!
};

// Level speeds (milliseconds per drop) - gets faster each level
export const LEVEL_SPEEDS = [
    800,  // Level 0
    720,  // Level 1
    630,  // Level 2
    550,  // Level 3
    470,  // Level 4
    380,  // Level 5
    300,  // Level 6
    220,  // Level 7
    130,  // Level 8
    100,  // Level 9
    80,   // Level 10+
];

// Lines needed to advance to next level
export const LINES_PER_LEVEL = 10;

// Key codes for controls
export const KEYS = {
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    DOWN: 'ArrowDown',
    UP: 'ArrowUp',
    ROTATE_CW: 'KeyX',
    ROTATE_CCW: 'KeyZ',
    HARD_DROP: 'Space',
    PAUSE: 'KeyP'
};

// DAS (Delayed Auto Shift) settings
export const DAS_DELAY = 170;  // Initial delay before auto-repeat (ms)
export const DAS_INTERVAL = 50; // Interval between auto-repeats (ms)

// Wall kick data for SRS (Super Rotation System)
// Format: [test1, test2, test3, test4] where each test is [xOffset, yOffset]
export const WALL_KICKS = {
    // For J, L, S, T, Z pieces
    JLSTZ: {
        '0->1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '1->0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        '1->2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        '2->1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        '2->3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        '3->2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '3->0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        '0->3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
    },
    // For I piece
    I: {
        '0->1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        '1->0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        '1->2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
        '2->1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
        '2->3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        '3->2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        '3->0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
        '0->3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
    }
};
