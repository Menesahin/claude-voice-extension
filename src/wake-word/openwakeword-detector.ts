import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WakeWordConfig, RecordingConfig } from '../config';
import { getPlatformCapabilities } from '../platform';
import { playSound } from '../utils/audio';
import { calculateAmplitude } from '../utils/silence';

// Available openWakeWord models
export const OPENWAKEWORD_MODELS: Record<
  string,
  { name: string; description: string; url?: string }
> = {
  hey_jarvis: {
    name: 'Hey Jarvis',
    description: 'Wake word: "Hey Jarvis" - high accuracy model trained on 200K+ samples',
  },
  alexa: {
    name: 'Alexa',
    description: 'Wake word: "Alexa"',
  },
  hey_mycroft: {
    name: 'Hey Mycroft',
    description: 'Wake word: "Hey Mycroft"',
  },
  hey_rhasspy: {
    name: 'Hey Rhasspy',
    description: 'Wake word: "Hey Rhasspy"',
  },
};

/**
 * openWakeWord-based wake word detector
 *
 * Uses a Python subprocess to run openWakeWord detection.
 * Offers better accuracy than sherpa-onnx KWS and has a purpose-trained "hey jarvis" model.
 */
export class OpenWakeWordDetector extends EventEmitter {
  private config: WakeWordConfig;
  private recordingConfig: RecordingConfig;
  private pythonProcess: ChildProcess | null = null;
  private audioProcess: ChildProcess | null = null;
  private isListening = false;
  private isRecordingCommand = false;
  private audioBuffer: Buffer[] = [];
  private silenceStartTime: number | null = null;
  private isReady = false;
  private isPaused = false;

  constructor(wakeWordConfig: WakeWordConfig, recordingConfig: RecordingConfig) {
    super();
    this.config = wakeWordConfig;
    this.recordingConfig = recordingConfig;
  }

  async initialize(): Promise<void> {
    // Check if Python is available
    const pythonCmd = this.getPythonCommand();
    if (!pythonCmd) {
      console.error('Python 3 is required for openWakeWord detection.');
      console.error('Install Python 3.9+ and pip install openwakeword');
      return;
    }

    // Check if openwakeword is installed
    if (!this.checkOpenWakeWordInstalled(pythonCmd)) {
      console.warn('openWakeWord not installed.');
      console.warn('Install it with: pip install openwakeword');
      console.warn('Or run: claude-voice model download openwakeword');
      return;
    }

    const model = this.config.openwakeword?.model || 'hey_jarvis';
    const threshold = this.config.openwakeword?.threshold || 0.65;

    console.log(`openWakeWord detector initialized (model: "${model}", threshold: ${threshold})`);
    this.isReady = true;
  }

  private getPythonCommand(): string | null {
    // Try python3 first, then python
    for (const cmd of ['python3', 'python']) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });
        if (version.includes('Python 3')) {
          return cmd;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private checkOpenWakeWordInstalled(pythonCmd: string): boolean {
    try {
      execSync(`${pythonCmd} -c "import openwakeword" 2>&1`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (!this.isReady) {
      console.warn('openWakeWord detector not initialized');
      return;
    }

    if (this.isListening) {
      return;
    }

    this.isListening = true;

    // Start the Python detector process
    await this.startPythonDetector();

    this.emit('started');
  }

  private async startPythonDetector(): Promise<void> {
    const pythonCmd = this.getPythonCommand();
    if (!pythonCmd) {
      console.error('Python not found');
      return;
    }

    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'openwakeword-detector.py');

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      console.error(`openWakeWord script not found: ${scriptPath}`);
      return;
    }

    const model = this.config.openwakeword?.model || 'hey_jarvis';
    const threshold = this.config.openwakeword?.threshold || 0.65;
    const vadThreshold = this.config.openwakeword?.vadThreshold ?? 0.3;
    const debug = this.config.openwakeword?.debug || false;
    const modelsDir = path.join(os.homedir(), '.claude-voice', 'models', 'openwakeword');

    const args = [
      scriptPath,
      '--model',
      model,
      '--threshold',
      String(threshold),
      '--vad-threshold',
      String(vadThreshold),
      '--models-dir',
      modelsDir,
    ];

    if (debug) {
      args.push('--debug');
    }

    // Spawn Python process
    this.pythonProcess = spawn(pythonCmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle Python stdout (JSON events)
    let buffer = '';
    this.pythonProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();

      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);
          this.handlePythonEvent(event);
        } catch {
          if (debug) {
            console.log(`openWakeWord output: ${line}`);
          }
        }
      }
    });

    // Handle Python stderr
    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('Model not found in cache')) {
        console.error(`openWakeWord error: ${msg}`);
      }
    });

    this.pythonProcess.on('error', (err) => {
      console.error('Failed to start openWakeWord:', err);
    });

    this.pythonProcess.on('exit', (code) => {
      if (this.isListening && code !== 0) {
        console.error(`openWakeWord exited with code ${code}`);
      }
    });

    // Start audio capture and pipe to Python
    await this.startAudioCapture();
  }

  private handlePythonEvent(event: {
    status?: string;
    detected?: boolean;
    model?: string;
    score?: number;
    error?: string;
    debug?: string;
  }): void {
    if (event.error) {
      console.error(`openWakeWord error: ${event.error}`);
      return;
    }

    if (event.debug) {
      console.log(`openWakeWord debug: ${event.debug}`);
      return;
    }

    if (event.status === 'ready') {
      console.log(`openWakeWord ready (model: ${event.model})`);
      return;
    }

    if (event.detected) {
      console.log(`Wake word detected: "${event.model}" (score: ${event.score?.toFixed(2)})`);

      // Play "listening" sound
      if (this.config.playSound) {
        playSound('Ping');
      }

      // Start recording the command
      this.emit('wakeword', 0);
      this.startCommandRecording();
    }
  }

  private async startAudioCapture(): Promise<void> {
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

      this.audioProcess = spawn(
        'rec',
        [
          '-q',
          '-t',
          'raw',
          '-b',
          '16',
          '-e',
          'signed-integer',
          '-c',
          '1',
          '-r',
          String(sampleRate),
          '-',
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

      this.audioProcess = spawn(
        'arecord',
        ['-q', '-f', 'S16_LE', '-c', '1', '-r', String(sampleRate), '-t', 'raw', '-'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } else {
      console.error('Audio capture not supported on this platform');
      return;
    }

    if (!this.audioProcess.stdout) {
      console.error('Failed to start audio capture');
      return;
    }

    // Pipe audio to Python process and also handle command recording
    this.audioProcess.stdout.on('data', (data: Buffer) => {
      if (!this.isListening || this.isPaused) return;

      if (this.isRecordingCommand) {
        // Collecting audio for command transcription
        this.audioBuffer.push(data);
        this.checkSilenceAndFinish(data);
      } else {
        // Pipe to Python for wake word detection
        if (this.pythonProcess?.stdin?.writable) {
          this.pythonProcess.stdin.write(data);
        }
      }
    });

    this.audioProcess.on('error', (err) => {
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
        // End of speech detected
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

    // Play "done" sound
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

    if (this.audioProcess) {
      this.audioProcess.kill();
      this.audioProcess = null;
    }

    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }

    this.emit('stopped');
  }

  cleanup(): void {
    this.stop();
  }

  triggerListening(): void {
    if (this.config.playSound) {
      playSound('Ping');
    }
    this.emit('wakeword', 0);
    this.startCommandRecording();
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }
}

/**
 * Check if openWakeWord is installed
 */
export function isOpenWakeWordInstalled(): boolean {
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} -c "import openwakeword" 2>&1`, { stdio: 'ignore' });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Install openWakeWord via pip
 */
export async function installOpenWakeWord(): Promise<void> {
  const pythonCmd = ['python3', 'python'].find((cmd) => {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });
      return version.includes('Python 3');
    } catch {
      return false;
    }
  });

  if (!pythonCmd) {
    throw new Error('Python 3 is required. Please install Python 3.9+');
  }

  console.log('Installing openWakeWord...');
  // Try multiple pip strategies for compatibility with Homebrew/system Python (PEP 668)
  const strategies = [
    `${pythonCmd} -m pip install openwakeword onnxruntime`,
    `${pythonCmd} -m pip install --user openwakeword onnxruntime`,
    `${pythonCmd} -m pip install --break-system-packages openwakeword onnxruntime`,
  ];
  let installed = false;
  for (const cmd of strategies) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 120000 });
      installed = true;
      break;
    } catch {
      continue;
    }
  }
  if (!installed) {
    throw new Error('pip install failed. Try manually: pip install openwakeword');
  }
  console.log('openWakeWord installed successfully!');
}

/**
 * Download openWakeWord model
 * Note: openWakeWord automatically downloads models on first use,
 * but this function can pre-download them.
 */
export async function downloadOpenWakeWordModel(modelId: string): Promise<void> {
  const modelInfo = OPENWAKEWORD_MODELS[modelId];
  if (!modelInfo) {
    throw new Error(`Unknown model: ${modelId}. Available: ${Object.keys(OPENWAKEWORD_MODELS).join(', ')}`);
  }

  const pythonCmd = ['python3', 'python'].find((cmd) => {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });
      return version.includes('Python 3');
    } catch {
      return false;
    }
  });

  if (!pythonCmd) {
    throw new Error('Python 3 is required');
  }

  // Pre-load the model to trigger download
  console.log(`Downloading openWakeWord model: ${modelId}...`);
  const script = `
import openwakeword
from openwakeword.model import Model
model = Model(wakeword_models=["${modelId}"], inference_framework="onnx")
print("Model loaded successfully!")
`;

  execSync(`${pythonCmd} -c '${script}'`, { stdio: 'inherit' });
  console.log(`Model ${modelId} is ready!`);
}

/**
 * List available openWakeWord models
 */
export function listOpenWakeWordModels(): Array<{
  id: string;
  name: string;
  description: string;
}> {
  return Object.entries(OPENWAKEWORD_MODELS).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.description,
  }));
}
