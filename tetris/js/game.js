import { LEVEL_SPEEDS, LINES_PER_LEVEL } from './constants.js';
import { Board } from './board.js';
import { Tetromino, TetrominoBag } from './tetromino.js';
import { Renderer } from './renderer.js';
import { InputHandler } from './input.js';

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.board = new Board();
        this.renderer = new Renderer(canvas);
        this.input = new InputHandler();
        this.bag = new TetrominoBag();

        this.currentPiece = null;
        this.score = 0;
        this.level = 0;
        this.lines = 0;

        this.state = 'idle'; // idle, playing, paused, gameOver
        this.lastDropTime = 0;
        this.animationFrameId = null;

        this.setupInputHandlers();
        this.updateUI();
    }

    setupInputHandlers() {
        this.input.onLeft(() => this.moveLeft());
        this.input.onRight(() => this.moveRight());
        this.input.onDown(() => this.softDrop());
        this.input.onRotateCW(() => this.rotate(true));
        this.input.onRotateCCW(() => this.rotate(false));
        this.input.onHardDrop(() => this.hardDrop());
        this.input.onPause(() => this.togglePause());
    }

    start() {
        if (this.state === 'playing') return;

        this.reset();
        this.state = 'playing';
        this.spawnPiece();
        this.lastDropTime = performance.now();
        this.gameLoop();
        this.hideOverlay();
    }

    reset() {
        this.board.reset();
        this.bag = new TetrominoBag();
        this.currentPiece = null;
        this.score = 0;
        this.level = 0;
        this.lines = 0;
        this.input.reset();
        this.updateUI();
    }

    togglePause() {
        if (this.state === 'playing') {
            this.pause();
        } else if (this.state === 'paused') {
            this.resume();
        }
    }

    pause() {
        if (this.state !== 'playing') return;

        this.state = 'paused';
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.showOverlay('PAUSED', 'Press P to resume');
    }

    resume() {
        if (this.state !== 'paused') return;

        this.state = 'playing';
        this.lastDropTime = performance.now();
        this.hideOverlay();
        this.gameLoop();
    }

    gameOver() {
        this.state = 'gameOver';
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.showOverlay('GAME OVER', `Score: ${this.score}<br>Press ENTER to restart`);

        // Add one-time enter key listener for restart
        const restartHandler = (e) => {
            if (e.code === 'Enter') {
                document.removeEventListener('keydown', restartHandler);
                this.start();
            }
        };
        document.addEventListener('keydown', restartHandler);
    }

    gameLoop() {
        if (this.state !== 'playing') return;

        const now = performance.now();
        const dropInterval = this.getDropInterval();

        if (now - this.lastDropTime >= dropInterval) {
            this.drop();
            this.lastDropTime = now;
        }

        this.render();
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    getDropInterval() {
        const speedIndex = Math.min(this.level, LEVEL_SPEEDS.length - 1);
        return LEVEL_SPEEDS[speedIndex];
    }

    spawnPiece() {
        const type = this.bag.getNext();
        this.currentPiece = new Tetromino(type);

        // Check if spawn position is valid
        if (!this.board.isValidPosition(this.currentPiece)) {
            this.gameOver();
        }
    }

    drop() {
        if (!this.currentPiece) return;

        if (this.board.isValidPosition(this.currentPiece, 0, 1)) {
            this.currentPiece.y++;
        } else {
            this.lockPiece();
        }
    }

    softDrop() {
        if (!this.currentPiece || this.state !== 'playing') return;

        if (this.board.isValidPosition(this.currentPiece, 0, 1)) {
            this.currentPiece.y++;
            this.score += 1; // Soft drop bonus
            this.updateUI();
        }
    }

    hardDrop() {
        if (!this.currentPiece || this.state !== 'playing') return;

        let dropDistance = 0;
        while (this.board.isValidPosition(this.currentPiece, 0, 1)) {
            this.currentPiece.y++;
            dropDistance++;
        }
        this.score += dropDistance * 2; // Hard drop bonus
        this.updateUI();
        this.lockPiece();
    }

    moveLeft() {
        if (!this.currentPiece || this.state !== 'playing') return;

        if (this.board.isValidPosition(this.currentPiece, -1, 0)) {
            this.currentPiece.x--;
        }
    }

    moveRight() {
        if (!this.currentPiece || this.state !== 'playing') return;

        if (this.board.isValidPosition(this.currentPiece, 1, 0)) {
            this.currentPiece.x++;
        }
    }

    rotate(clockwise = true) {
        if (!this.currentPiece || this.state !== 'playing') return;

        const result = this.board.tryRotate(this.currentPiece, clockwise);
        if (result.success) {
            this.currentPiece.rotate(clockwise);
            this.currentPiece.x += result.kickX;
            this.currentPiece.y += result.kickY;
        }
    }

    lockPiece() {
        this.board.placeTetromino(this.currentPiece);

        const clearResult = this.board.clearLines();
        if (clearResult.lines > 0) {
            this.lines += clearResult.lines;
            this.score += clearResult.score * (this.level + 1);
            this.level = Math.floor(this.lines / LINES_PER_LEVEL);
            this.updateUI();
        }

        if (this.board.isGameOver()) {
            this.gameOver();
        } else {
            this.spawnPiece();
        }
    }

    render() {
        const ghostY = this.currentPiece
            ? this.board.getGhostPosition(this.currentPiece)
            : null;
        this.renderer.render(this.board, this.currentPiece, ghostY);
    }

    updateUI() {
        const scoreEl = document.getElementById('score');
        const levelEl = document.getElementById('level');
        const linesEl = document.getElementById('lines');

        if (scoreEl) scoreEl.textContent = this.score;
        if (levelEl) levelEl.textContent = this.level;
        if (linesEl) linesEl.textContent = this.lines;
    }

    showOverlay(title, message) {
        const overlay = document.getElementById('overlay');
        const overlayTitle = document.getElementById('overlay-title');
        const overlayMessage = document.getElementById('overlay-message');

        if (overlay) {
            overlay.classList.remove('hidden');
            if (overlayTitle) overlayTitle.textContent = title;
            if (overlayMessage) overlayMessage.innerHTML = message;
        }
    }

    hideOverlay() {
        const overlay = document.getElementById('overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
}
