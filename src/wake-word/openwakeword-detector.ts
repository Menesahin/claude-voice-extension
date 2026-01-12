import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WakeWordConfig, RecordingConfig } from '../config';
import { getPlatformCapabilities } from '../platform';
import { playSound } from '../utils/audio';
import { calculateAmplitude } from '../utils/silence';

// Path to openWakeWord virtual environment
const OPENWAKEWORD_VENV = path.join(os.homedir(), '.claude-voice', 'openwakeword-venv');
const OPENWAKEWORD_PYTHON = path.join(OPENWAKEWORD_VENV, 'bin', 'python3');

/**
 * openWakeWord detector - free and open source wake word detection
 * Uses Python subprocess for inference via stdin/stdout IPC
 */
export class OpenWakeWordDetector extends EventEmitter {
  private config: WakeWordConfig;
  private recordingConfig: RecordingConfig;
  private pythonProcess: ChildProcess | null = null;
  private recordingProcess: ChildProcess | null = null;
  private isListening = false;
  private isRecordingCommand = false;
  private audioBuffer: Buffer[] = [];
  private silenceStartTime: number | null = null;
  private ready = false;

  constructor(config: WakeWordConfig, recordingConfig: RecordingConfig) {
    super();
    this.config = config;
    this.recordingConfig = recordingConfig;
  }

  async initialize(): Promise<void> {
    // Check if openWakeWord venv exists
    if (!fs.existsSync(OPENWAKEWORD_PYTHON)) {
      throw new Error(
        'openWakeWord not installed. Run: claude-voice model download openwakeword'
      );
    }

    // Get model and threshold from config
    const model = this.config.openwakeword?.model || 'hey_jarvis';
    const threshold = this.config.openwakeword?.threshold || 0.5;

    // Path to Python server script (from dist/wake-word/ -> python/)
    // In development: src/wake-word -> python (../../python)
    // In production: dist/wake-word -> python (../../python)
    let pythonScript = path.join(__dirname, '..', '..', 'python', 'openwakeword_server.py');

    // If not found, try one more level up (for npm global install)
    if (!fs.existsSync(pythonScript)) {
      pythonScript = path.join(__dirname, '..', '..', '..', 'python', 'openwakeword_server.py');
    }

    if (!fs.existsSync(pythonScript)) {
      throw new Error(`Python script not found: ${pythonScript}`);
    }

    // Start Python process
    this.pythonProcess = spawn(
      OPENWAKEWORD_PYTHON,
      [pythonScript, model, String(threshold)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Handle stderr
    this.pythonProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && this.config.openwakeword?.debug) {
        console.error('openWakeWord:', msg);
      }
    });

    // Wait for ready signal
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('openWakeWord initialization timeout'));
      }, 30000);

      const onData = (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const msg = JSON.parse(line);

            if (msg.status === 'ready') {
              clearTimeout(timeout);
              this.ready = true;
              console.log(`openWakeWord detector initialized (keyword: "${msg.model}")`);
              console.log('Wake word detection active. Say "Hey Jarvis" to start speaking.');

              // Now set up the ongoing data handler
              this.pythonProcess?.stdout?.removeListener('data', onData);
              this.pythonProcess?.stdout?.on('data', this.handlePythonOutput.bind(this));

              resolve();
              return;
            }

            if (msg.status === 'error') {
              clearTimeout(timeout);
              reject(new Error(msg.message));
              return;
            }
          } catch {
            // Not JSON, ignore
          }
        }
      };

      this.pythonProcess?.stdout?.on('data', onData);

      this.pythonProcess?.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.pythonProcess?.on('exit', (code) => {
        if (!this.ready) {
          clearTimeout(timeout);
          reject(new Error(`Python process exited with code ${code}`));
        }
      });
    });
  }

  private handlePythonOutput(data: Buffer): void {
    const lines = data.toString().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        if (msg.event === 'wakeword') {
          this.handleWakeWordDetection(msg.keyword, msg.score);
        } else if (msg.event === 'error') {
          console.error('openWakeWord error:', msg.message);
        } else if (msg.event === 'debug') {
          console.log(`openWakeWord: ${msg.frames} frames, max_score: ${msg.max_score}`);
        }
      } catch {
        // Not JSON, ignore
      }
    }
  }

  private handleWakeWordDetection(keyword: string, score: number): void {
    if (this.isRecordingCommand) {
      return;
    }

    console.log(`Wake word detected: "${keyword}" (score: ${score.toFixed(2)})`);

    if (this.config.playSound) {
      playSound('Ping');
    }

    this.emit('wakeword', 0);
    this.startCommandRecording();
  }

  async start(): Promise<void> {
    if (!this.ready || !this.pythonProcess) {
      console.warn('openWakeWord detector not initialized');
      return;
    }

    if (this.isListening) {
      return;
    }

    this.isListening = true;
    this.startAudioCapture();
    this.emit('started');
  }

  private startAudioCapture(): void {
    const caps = getPlatformCapabilities();
    const sampleRate = this.recordingConfig.sampleRate;

    // Use sox on macOS, arecord on Linux
    if (caps.platform === 'darwin') {
      try {
        execSync('which rec', { stdio: 'ignore' });
      } catch {
        console.error('');
        console.error('  Wake word detection requires sox for audio capture.');
        console.error('  Install it with: brew install sox');
        console.error('');
        return;
      }

      // Use 'rate' effect to ensure 16kHz output (macOS may not support native 16kHz)
      this.recordingProcess = spawn(
        'rec',
        [
          '-q',
          '-b', '16',
          '-e', 'signed-integer',
          '-c', '1',
          '-t', 'raw',
          '-',
          'rate', String(sampleRate),  // Resample to target rate
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } else if (caps.platform === 'linux') {
      try {
        execSync('which arecord', { stdio: 'ignore' });
      } catch {
        console.error('');
        console.error('  Wake word detection requires alsa-utils for audio capture.');
        console.error('  Install it with: sudo apt install alsa-utils');
        console.error('');
        return;
      }

      this.recordingProcess = spawn(
        'arecord',
        ['-q', '-f', 'S16_LE', '-c', '1', '-r', String(sampleRate), '-t', 'raw', '-'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } else {
      console.error('Audio capture not supported on this platform');
      return;
    }

    if (!this.recordingProcess.stdout) {
      console.error('Failed to start audio capture');
      return;
    }

    this.recordingProcess.stdout.on('data', (data: Buffer) => {
      if (!this.isListening || !this.pythonProcess) {
        return;
      }

      if (this.isRecordingCommand) {
        // Collecting audio for command transcription
        this.audioBuffer.push(data);
        this.checkSilenceAndFinish(data);
      } else {
        // Send audio to Python for wake word detection with backpressure handling
        try {
          const canWrite = this.pythonProcess.stdin?.write(data);
          if (canWrite === false && this.recordingProcess?.stdout) {
            // Pause recording until Python catches up
            this.recordingProcess.stdout.pause();
            this.pythonProcess.stdin?.once('drain', () => {
              this.recordingProcess?.stdout?.resume();
            });
          }
        } catch {
          // Python process may have died
        }
      }
    });

    this.recordingProcess.on('error', (err) => {
      console.error('Audio capture error:', err);
    });
  }

  private startCommandRecording(): void {
    if (this.isRecordingCommand) {
      return;
    }

    this.isRecordingCommand = true;
    this.audioBuffer = [];
    this.silenceStartTime = null;
    this.emit('listening');
  }

  private checkSilenceAndFinish(data: Buffer): void {
    const amplitude = calculateAmplitude(data);
    const silenceThreshold = this.recordingConfig.silenceThreshold;
    const silenceAmplitude = this.recordingConfig.silenceAmplitude || 500;

    if (amplitude < silenceAmplitude) {
      if (!this.silenceStartTime) {
        this.silenceStartTime = Date.now();
      } else if (Date.now() - this.silenceStartTime > silenceThreshold) {
        this.finishRecording();
        return;
      }
    } else {
      this.silenceStartTime = null;
    }

    // Max duration check
    const totalDuration =
      (this.audioBuffer.reduce((sum, b) => sum + b.length, 0) / 2 / this.recordingConfig.sampleRate) * 1000;
    if (totalDuration > this.recordingConfig.maxDuration) {
      this.finishRecording();
    }
  }

  private finishRecording(): void {
    this.isRecordingCommand = false;
    this.silenceStartTime = null;

    if (this.config.playSound) {
      playSound('Pop');
    }

    const audioBuffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    this.emit('command', audioBuffer);
  }

  stop(): void {
    this.isListening = false;
    this.isRecordingCommand = false;

    if (this.recordingProcess) {
      this.recordingProcess.kill();
      this.recordingProcess = null;
    }

    this.emit('stopped');
  }

  cleanup(): void {
    this.stop();

    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }

    this.ready = false;
  }
}

/**
 * Check if openWakeWord is installed
 */
export function isOpenWakeWordInstalled(): boolean {
  return fs.existsSync(OPENWAKEWORD_PYTHON);
}

/**
 * Install openWakeWord in a virtual environment
 */
export async function installOpenWakeWord(): Promise<void> {
  if (isOpenWakeWordInstalled()) {
    console.log('  [✓] openWakeWord already installed');
    return;
  }

  // Find Python 3.9+
  const pythonCandidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ];

  let python: string | null = null;

  for (const py of pythonCandidates) {
    try {
      const version = execSync(`${py} --version 2>&1`, { encoding: 'utf-8' });
      const match = version.match(/Python 3\.(\d+)/);
      if (match && parseInt(match[1], 10) >= 9) {
        python = py;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!python) {
    throw new Error('Python 3.9+ not found. Install Python 3.9 or later.');
  }

  console.log(`  [1/3] Found Python: ${python}`);

  // Create virtual environment
  const venvDir = OPENWAKEWORD_VENV;
  if (!fs.existsSync(path.dirname(venvDir))) {
    fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  }

  console.log('  [2/3] Creating Python virtual environment...');
  execSync(`${python} -m venv "${venvDir}"`, { stdio: 'pipe' });

  // Install openwakeword
  console.log('  [3/3] Installing openwakeword package (this may take a minute)...');
  const pip = path.join(venvDir, 'bin', 'pip');
  execSync(`"${pip}" install --quiet openwakeword`, { stdio: 'pipe', timeout: 300000 });

  console.log('  [✓] openWakeWord installed successfully');
}
