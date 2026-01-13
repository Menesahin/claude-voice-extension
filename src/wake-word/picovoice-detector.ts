import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { WakeWordConfig, RecordingConfig } from '../config';
import { getPlatformCapabilities } from '../platform';
import { playSound } from '../utils/audio';

// Built-in Porcupine keywords
const BUILTIN_KEYWORDS: Record<string, string> = {
  jarvis: 'JARVIS',
  alexa: 'ALEXA',
  computer: 'COMPUTER',
  'hey google': 'HEY_GOOGLE',
  'hey siri': 'HEY_SIRI',
  'ok google': 'OK_GOOGLE',
  picovoice: 'PICOVOICE',
  porcupine: 'PORCUPINE',
  bumblebee: 'BUMBLEBEE',
  terminator: 'TERMINATOR',
  blueberry: 'BLUEBERRY',
  grapefruit: 'GRAPEFRUIT',
  grasshopper: 'GRASSHOPPER',
  americano: 'AMERICANO',
};

export class PicovoiceDetector extends EventEmitter {
  private config: WakeWordConfig;
  private recordingConfig: RecordingConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private porcupine: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recorder: any = null;
  private isListening = false;
  private isRecordingCommand = false;
  private audioBuffer: Buffer[] = [];
  private silenceStartTime: number | null = null;
  private recordingProcess: ReturnType<typeof spawn> | null = null;

  constructor(wakeWordConfig: WakeWordConfig, recordingConfig: RecordingConfig) {
    super();
    this.config = wakeWordConfig;
    this.recordingConfig = recordingConfig;
  }

  async initialize(): Promise<void> {
    // Get access key from config or environment
    const accessKey = this.config.picovoice?.accessKey || process.env.PICOVOICE_ACCESS_KEY;

    if (!accessKey) {
      console.warn('Picovoice requires an access key.');
      console.warn('Get a free key at: https://console.picovoice.ai/');
      console.warn('Set it via: export PICOVOICE_ACCESS_KEY="your-key"');
      console.warn('Or in config: wakeWord.picovoice.accessKey');
      return;
    }

    try {
      // Dynamic import for picovoice
      const { Porcupine, BuiltinKeyword } = await import('@picovoice/porcupine-node');

      // Get keyword
      const keywordLower = this.config.keyword.toLowerCase();
      const builtinName = BUILTIN_KEYWORDS[keywordLower];

      if (!builtinName) {
        console.warn(`Keyword "${this.config.keyword}" is not a built-in Porcupine keyword.`);
        console.warn(`Available: ${Object.keys(BUILTIN_KEYWORDS).join(', ')}`);
        return;
      }

      // Get the built-in keyword enum value
      const keyword = BuiltinKeyword[builtinName as keyof typeof BuiltinKeyword];

      // Create Porcupine instance
      this.porcupine = new Porcupine(accessKey, [keyword], [this.config.sensitivity]);

      console.log(`Picovoice detector initialized (keyword: "${this.config.keyword}")`);
    } catch (error) {
      console.error('Failed to initialize Picovoice:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.porcupine) {
      console.warn('Picovoice detector not initialized');
      return;
    }

    if (this.isListening) {
      return;
    }

    this.isListening = true;

    // Try to use PvRecorder first, fall back to sox/arecord
    const usePvRecorder = await this.tryPvRecorder();
    if (!usePvRecorder) {
      this.startAudioCapture();
    }

    this.emit('started');
  }

  private async tryPvRecorder(): Promise<boolean> {
    try {
      const { PvRecorder } = await import('@picovoice/pvrecorder-node');

      this.recorder = new PvRecorder(this.porcupine.frameLength, -1);
      this.recorder.start();

      // Start reading frames
      this.readFrames();
      return true;
    } catch {
      console.log('PvRecorder not available, falling back to sox/arecord');
      return false;
    }
  }

  private async readFrames(): Promise<void> {
    if (!this.isListening || !this.recorder || !this.porcupine) {
      return;
    }

    try {
      const frame = await this.recorder.read();

      if (this.isRecordingCommand) {
        // Convert Int16Array to Buffer for command recording
        const buffer = Buffer.alloc(frame.length * 2);
        for (let i = 0; i < frame.length; i++) {
          buffer.writeInt16LE(frame[i], i * 2);
        }
        this.audioBuffer.push(buffer);
        this.checkSilenceAndFinishFromFrame(frame);
      } else {
        // Process for keyword detection
        const keywordIndex = this.porcupine.process(frame);

        if (keywordIndex >= 0) {
          console.log(`Wake word detected: "${this.config.keyword}"`);

          if (this.config.playSound) {
            playSound('Ping');
          }

          this.emit('wakeword', keywordIndex);
          this.startCommandRecording();
        }
      }

      // Continue reading
      if (this.isListening) {
        setImmediate(() => this.readFrames());
      }
    } catch (error) {
      if (this.isListening) {
        console.error('Error reading audio frame:', error);
      }
    }
  }

  private startAudioCapture(): void {
    const caps = getPlatformCapabilities();
    const sampleRate = this.recordingConfig.sampleRate;
    const { execSync } = require('child_process');

    if (caps.platform === 'darwin') {
      try {
        execSync('which rec', { stdio: 'ignore' });
      } catch {
        console.error('Wake word detection requires sox. Install: brew install sox');
        return;
      }

      this.recordingProcess = spawn(
        'rec',
        ['-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', String(sampleRate), '-'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } else if (caps.platform === 'linux') {
      try {
        execSync('which arecord', { stdio: 'ignore' });
      } catch {
        console.error('Wake word detection requires alsa-utils. Install: sudo apt install alsa-utils');
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

    let audioAccumulator: number[] = [];
    const frameLength = this.porcupine.frameLength;

    this.recordingProcess.stdout.on('data', (data: Buffer) => {
      if (!this.isListening || !this.porcupine) return;

      // Convert buffer to Int16 samples
      for (let i = 0; i < data.length; i += 2) {
        audioAccumulator.push(data.readInt16LE(i));
      }

      // Process complete frames
      while (audioAccumulator.length >= frameLength) {
        const frame = new Int16Array(audioAccumulator.splice(0, frameLength));

        if (this.isRecordingCommand) {
          const buffer = Buffer.alloc(frame.length * 2);
          for (let i = 0; i < frame.length; i++) {
            buffer.writeInt16LE(frame[i], i * 2);
          }
          this.audioBuffer.push(buffer);
          this.checkSilenceAndFinishFromFrame(frame);
        } else {
          const keywordIndex = this.porcupine.process(frame);

          if (keywordIndex >= 0) {
            console.log(`Wake word detected: "${this.config.keyword}"`);

            if (this.config.playSound) {
              playSound('Ping');
            }

            this.emit('wakeword', keywordIndex);
            this.startCommandRecording();
          }
        }
      }
    });

    this.recordingProcess.on('error', (err) => {
      console.error('Audio capture error:', err);
    });
  }

  private startCommandRecording(): void {
    if (this.isRecordingCommand) return;

    this.isRecordingCommand = true;
    this.audioBuffer = [];
    this.silenceStartTime = null;
    this.emit('listening');
  }

  private checkSilenceAndFinishFromFrame(frame: Int16Array): void {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += Math.abs(frame[i]);
    }
    const amplitude = sum / frame.length;

    const silenceAmplitude = this.recordingConfig.silenceAmplitude || 500;
    const silenceThreshold = this.recordingConfig.silenceThreshold;

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
    const totalSamples = this.audioBuffer.reduce((sum, b) => sum + b.length / 2, 0);
    const totalDuration = (totalSamples / this.recordingConfig.sampleRate) * 1000;
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

    if (this.recorder) {
      try {
        this.recorder.stop();
      } catch {
        // Ignore
      }
    }

    if (this.recordingProcess) {
      this.recordingProcess.kill();
      this.recordingProcess = null;
    }

    this.emit('stopped');
  }

  cleanup(): void {
    this.stop();

    if (this.recorder) {
      try {
        this.recorder.release();
      } catch {
        // Ignore
      }
      this.recorder = null;
    }

    if (this.porcupine) {
      try {
        this.porcupine.release();
      } catch {
        // Ignore
      }
      this.porcupine = null;
    }
  }

  triggerListening(): void {
    if (this.config.playSound) {
      playSound('Ping');
    }
    this.emit('wakeword', 0);
    this.startCommandRecording();
  }
}
