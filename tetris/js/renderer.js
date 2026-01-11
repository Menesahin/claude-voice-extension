import { COLS, ROWS, BLOCK_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;
    }

    clear() {
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    drawGrid() {
        this.ctx.strokeStyle = '#2d2d44';
        this.ctx.lineWidth = 1;

        // Vertical lines
        for (let x = 0; x <= COLS; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * BLOCK_SIZE, 0);
            this.ctx.lineTo(x * BLOCK_SIZE, CANVAS_HEIGHT);
            this.ctx.stroke();
        }

        // Horizontal lines
        for (let y = 0; y <= ROWS; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * BLOCK_SIZE);
            this.ctx.lineTo(CANVAS_WIDTH, y * BLOCK_SIZE);
            this.ctx.stroke();
        }
    }

    drawBlock(x, y, color, alpha = 1) {
        if (y < 0) return; // Don't draw blocks above the visible area

        const padding = 1;
        this.ctx.globalAlpha = alpha;

        // Main block color
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
            x * BLOCK_SIZE + padding,
            y * BLOCK_SIZE + padding,
            BLOCK_SIZE - padding * 2,
            BLOCK_SIZE - padding * 2
        );

        // Highlight (top-left)
        this.ctx.fillStyle = this.lightenColor(color, 30);
        this.ctx.fillRect(
            x * BLOCK_SIZE + padding,
            y * BLOCK_SIZE + padding,
            BLOCK_SIZE - padding * 2,
            4
        );
        this.ctx.fillRect(
            x * BLOCK_SIZE + padding,
            y * BLOCK_SIZE + padding,
            4,
            BLOCK_SIZE - padding * 2
        );

        // Shadow (bottom-right)
        this.ctx.fillStyle = this.darkenColor(color, 30);
        this.ctx.fillRect(
            x * BLOCK_SIZE + padding,
            y * BLOCK_SIZE + BLOCK_SIZE - padding - 4,
            BLOCK_SIZE - padding * 2,
            4
        );
        this.ctx.fillRect(
            x * BLOCK_SIZE + BLOCK_SIZE - padding - 4,
            y * BLOCK_SIZE + padding,
            4,
            BLOCK_SIZE - padding * 2
        );

        this.ctx.globalAlpha = 1;
    }

    drawBoard(board) {
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const cell = board.grid[row][col];
                if (cell) {
                    this.drawBlock(col, row, cell);
                }
            }
        }
    }

    drawTetromino(tetromino) {
        const shape = tetromino.getShape();
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    this.drawBlock(
                        tetromino.x + col,
                        tetromino.y + row,
                        tetromino.color
                    );
                }
            }
        }
    }

    drawGhost(tetromino, ghostY) {
        const shape = tetromino.getShape();
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    this.drawGhostBlock(
                        tetromino.x + col,
                        ghostY + row,
                        tetromino.color
                    );
                }
            }
        }
    }

    drawGhostBlock(x, y, color) {
        if (y < 0) return;

        const padding = 1;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 0.3;
        this.ctx.strokeRect(
            x * BLOCK_SIZE + padding + 1,
            y * BLOCK_SIZE + padding + 1,
            BLOCK_SIZE - padding * 2 - 2,
            BLOCK_SIZE - padding * 2 - 2
        );
        this.ctx.globalAlpha = 1;
    }

    lightenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
    }

    darkenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, (num >> 16) - amt);
        const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
        const B = Math.max(0, (num & 0x0000FF) - amt);
        return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
    }

    render(board, currentTetromino, ghostY = null) {
        this.clear();
        this.drawGrid();
        this.drawBoard(board);

        if (currentTetromino) {
            if (ghostY !== null && ghostY !== currentTetromino.y) {
                this.drawGhost(currentTetromino, ghostY);
            }
            this.drawTetromino(currentTetromino);
        }
    }
}
