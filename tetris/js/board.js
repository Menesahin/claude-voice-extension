import { COLS, ROWS, SCORE_TABLE } from './constants.js';

export class Board {
    constructor() {
        this.grid = this.createEmptyGrid();
    }

    createEmptyGrid() {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    }

    reset() {
        this.grid = this.createEmptyGrid();
    }

    getCell(x, y) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) {
            return undefined;
        }
        return this.grid[y][x];
    }

    setCell(x, y, color) {
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
            this.grid[y][x] = color;
        }
    }

    isValidPosition(tetromino, offsetX = 0, offsetY = 0) {
        const shape = tetromino.getShape();
        const newX = tetromino.x + offsetX;
        const newY = tetromino.y + offsetY;

        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const boardX = newX + col;
                    const boardY = newY + row;

                    // Check boundaries
                    if (boardX < 0 || boardX >= COLS || boardY >= ROWS) {
                        return false;
                    }

                    // Allow positions above the board (negative y)
                    if (boardY < 0) {
                        continue;
                    }

                    // Check collision with placed pieces
                    if (this.grid[boardY][boardX] !== null) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    isValidRotation(tetromino, clockwise = true) {
        const rotatedShape = tetromino.getRotatedShape(clockwise);
        const tempTetromino = tetromino.clone();
        tempTetromino.rotationState = tetromino.getNextRotationState(clockwise);
        tempTetromino.shape = rotatedShape;

        return this.isValidPosition(tempTetromino);
    }

    tryRotate(tetromino, clockwise = true) {
        const wallKicks = tetromino.getWallKicks(clockwise);
        const nextRotation = tetromino.getNextRotationState(clockwise);

        for (const [kickX, kickY] of wallKicks) {
            const tempTetromino = tetromino.clone();
            tempTetromino.rotationState = nextRotation;
            tempTetromino.shape = tempTetromino.getShape();
            tempTetromino.x += kickX;
            tempTetromino.y -= kickY; // Y is inverted in our coordinate system

            if (this.isValidPosition(tempTetromino)) {
                return { success: true, kickX, kickY: -kickY };
            }
        }
        return { success: false };
    }

    placeTetromino(tetromino) {
        const shape = tetromino.getShape();
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const boardX = tetromino.x + col;
                    const boardY = tetromino.y + row;
                    if (boardY >= 0) {
                        this.setCell(boardX, boardY, tetromino.color);
                    }
                }
            }
        }
    }

    clearLines() {
        let linesCleared = 0;
        const newGrid = [];

        // Check each row from bottom to top
        for (let row = ROWS - 1; row >= 0; row--) {
            const isComplete = this.grid[row].every(cell => cell !== null);
            if (!isComplete) {
                newGrid.unshift(this.grid[row]);
            } else {
                linesCleared++;
            }
        }

        // Add empty rows at the top
        while (newGrid.length < ROWS) {
            newGrid.unshift(Array(COLS).fill(null));
        }

        this.grid = newGrid;

        return {
            lines: linesCleared,
            score: SCORE_TABLE[linesCleared] || 0
        };
    }

    isGameOver() {
        // Game is over if any cell in the top row (or hidden rows above) is filled
        return this.grid[0].some(cell => cell !== null);
    }

    getGhostPosition(tetromino) {
        let ghostY = tetromino.y;
        const tempTetromino = tetromino.clone();

        while (this.isValidPosition(tempTetromino, 0, 1)) {
            tempTetromino.y++;
            ghostY++;
        }

        return ghostY;
    }
}
