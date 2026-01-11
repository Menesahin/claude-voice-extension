import { SHAPES, COLORS, TETROMINO_TYPES, WALL_KICKS, COLS } from './constants.js';

export class Tetromino {
    constructor(type = null) {
        this.type = type || this.randomType();
        this.rotationState = 0;
        this.color = COLORS[this.type];
        this.shape = SHAPES[this.type][this.rotationState];

        // Starting position (centered at top)
        this.x = Math.floor((COLS - this.shape[0].length) / 2);
        this.y = 0;
    }

    randomType() {
        return TETROMINO_TYPES[Math.floor(Math.random() * TETROMINO_TYPES.length)];
    }

    getShape() {
        return SHAPES[this.type][this.rotationState];
    }

    getNextRotationState(clockwise = true) {
        if (clockwise) {
            return (this.rotationState + 1) % 4;
        } else {
            return (this.rotationState + 3) % 4;
        }
    }

    getRotatedShape(clockwise = true) {
        const nextState = this.getNextRotationState(clockwise);
        return SHAPES[this.type][nextState];
    }

    rotate(clockwise = true) {
        this.rotationState = this.getNextRotationState(clockwise);
        this.shape = this.getShape();
    }

    getWallKicks(clockwise = true) {
        const fromState = this.rotationState;
        const toState = this.getNextRotationState(clockwise);
        const kickKey = `${fromState}->${toState}`;

        if (this.type === 'I') {
            return WALL_KICKS.I[kickKey] || [[0, 0]];
        } else if (this.type === 'O') {
            return [[0, 0]]; // O piece doesn't need wall kicks
        } else {
            return WALL_KICKS.JLSTZ[kickKey] || [[0, 0]];
        }
    }

    clone() {
        const copy = new Tetromino(this.type);
        copy.rotationState = this.rotationState;
        copy.shape = this.getShape();
        copy.x = this.x;
        copy.y = this.y;
        return copy;
    }

    getBlocks() {
        const blocks = [];
        const shape = this.getShape();
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    blocks.push({
                        x: this.x + col,
                        y: this.y + row
                    });
                }
            }
        }
        return blocks;
    }
}

// 7-bag randomizer for fair piece distribution
export class TetrominoBag {
    constructor() {
        this.bag = [];
        this.refillBag();
    }

    refillBag() {
        this.bag = [...TETROMINO_TYPES];
        // Fisher-Yates shuffle
        for (let i = this.bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
    }

    getNext() {
        if (this.bag.length === 0) {
            this.refillBag();
        }
        return this.bag.pop();
    }

    peek() {
        if (this.bag.length === 0) {
            this.refillBag();
        }
        return this.bag[this.bag.length - 1];
    }
}
