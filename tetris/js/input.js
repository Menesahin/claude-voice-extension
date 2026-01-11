import { KEYS, DAS_DELAY, DAS_INTERVAL } from './constants.js';

export class InputHandler {
    constructor() {
        this.keys = {};
        this.callbacks = {};
        this.dasTimers = {};
        this.dasActive = {};

        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }

    handleKeyDown(e) {
        const key = e.code;

        // Prevent default for game keys
        if (Object.values(KEYS).includes(key)) {
            e.preventDefault();
        }

        // If key is already pressed, ignore (handled by DAS)
        if (this.keys[key]) {
            return;
        }

        this.keys[key] = true;

        // Execute callback immediately
        if (this.callbacks[key]) {
            this.callbacks[key]();
        }

        // Start DAS for movement keys
        if (key === KEYS.LEFT || key === KEYS.RIGHT || key === KEYS.DOWN) {
            this.startDAS(key);
        }
    }

    handleKeyUp(e) {
        const key = e.code;
        this.keys[key] = false;
        this.stopDAS(key);
    }

    startDAS(key) {
        // Clear any existing timer
        this.stopDAS(key);

        // Start DAS after initial delay
        this.dasTimers[key] = setTimeout(() => {
            this.dasActive[key] = true;
            this.runDAS(key);
        }, DAS_DELAY);
    }

    runDAS(key) {
        if (!this.keys[key] || !this.dasActive[key]) {
            return;
        }

        if (this.callbacks[key]) {
            this.callbacks[key]();
        }

        // Continue DAS at interval
        this.dasTimers[key] = setTimeout(() => this.runDAS(key), DAS_INTERVAL);
    }

    stopDAS(key) {
        if (this.dasTimers[key]) {
            clearTimeout(this.dasTimers[key]);
            this.dasTimers[key] = null;
        }
        this.dasActive[key] = false;
    }

    on(key, callback) {
        this.callbacks[key] = callback;
    }

    onLeft(callback) {
        this.on(KEYS.LEFT, callback);
    }

    onRight(callback) {
        this.on(KEYS.RIGHT, callback);
    }

    onDown(callback) {
        this.on(KEYS.DOWN, callback);
    }

    onRotateCW(callback) {
        this.on(KEYS.UP, callback);
        this.on(KEYS.ROTATE_CW, callback);
    }

    onRotateCCW(callback) {
        this.on(KEYS.ROTATE_CCW, callback);
    }

    onHardDrop(callback) {
        this.on(KEYS.HARD_DROP, callback);
    }

    onPause(callback) {
        this.on(KEYS.PAUSE, callback);
    }

    isPressed(key) {
        return !!this.keys[key];
    }

    reset() {
        // Clear all DAS timers
        Object.keys(this.dasTimers).forEach(key => this.stopDAS(key));
        this.keys = {};
    }
}
