import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { WakeWordConfig, RecordingConfig } from '../config';
import { AudioRecorder } from './recorder';
import { getPlatformCapabilities } from '../platform';

// Play system sounds (cross-platform)
function playSound(soundName: string): void {
  const caps = getPlatformCapabilities();

  if (caps.platform === 'darwin') {
    const soundPath = `/System/Library/Sounds/${soundName}.aiff`;
    spawn('afplay', [soundPath], { stdio: 'ignore' });
  } else if (caps.platform === 'linux' && caps.audioPlayer) {
    // Try freedesktop sounds on Linux
    const linuxSounds: Record<string, string> = {
      'Ping': '/usr/share/sounds/freedesktop/stereo/message.oga',
      'Pop': '/usr/share/sounds/freedesktop/stereo/complete.oga',
    };
    const soundPath = linuxSounds[soundName];
    if (soundPath) {
      spawn(caps.audioPlayer, [soundPath], { stdio: 'ignore' });
    }
  }
  // Silently skip if no audio player available
}

// Porcupine types (will be dynamically imported)
interface PorcupineInstance {
  process(frame: Int16Array): number;
  release?(): void;  // v4.x uses release()
  delete?(): void;   // older versions use delete()
  frameLength: number;
  sampleRate: number;
}

interface PorcupineModule {
  create(accessKey: string, keywords: string[], sensitivities: number[]): Promise<PorcupineInstance>;
  BuiltinKeywords: Record<string, string>;
}

export class WakeWordDetector extends EventEmitter {
  private config: WakeWordConfig;
  private recordingConfig: RecordingConfig;
  private porcupine: PorcupineInstance | null = null;
  private recorder: AudioRecorder | null = null;
  private isListening = false;
  private isRecordingCommand = false;

  constructor(wakeWordConfig: WakeWordConfig, recordingConfig: RecordingConfig) {
    super();
    this.config = wakeWordConfig;
    this.recordingConfig = recordingConfig;
  }

  async initialize(): Promise<void> {
    const accessKey = process.env.PICOVOICE_ACCESS_KEY;

    if (!accessKey) {
      console.warn(
        'PICOVOICE_ACCESS_KEY not set. Wake word detection will be disabled.',
        'Get a free key at https://picovoice.ai/'
      );
      return;
    }

    try {
      // Dynamic import for Porcupine
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const porcupineModule = await import('@picovoice/porcupine-node') as any;
      const Porcupine = porcupineModule.Porcupine;
      const BuiltinKeyword = porcupineModule.BuiltinKeyword;

      // Use custom Jarvis wake word model
      const path = await import('path');
      const fs = await import('fs');

      const customModelPath = path.join(__dirname, '..', '..', 'models', 'jarvis.ppn');

      let keywords: string[];
      if (fs.existsSync(customModelPath)) {
        // Use custom Jarvis model
        keywords = [customModelPath];
        console.log('Using custom Jarvis wake word model');
      } else {
        // Fallback to built-in JARVIS
        keywords = [BuiltinKeyword.JARVIS];
        console.log('Using built-in Jarvis keyword');
      }

      // Porcupine uses constructor, not .create()
      this.porcupine = new Porcupine(accessKey, keywords, [this.config.sensitivity]);

      this.recorder = new AudioRecorder({
        sampleRate: this.porcupine!.sampleRate,
        frameLength: this.porcupine!.frameLength,
        channels: this.recordingConfig.channels,
      });

      console.log('Wake word detector initialized');
    } catch (error) {
      console.error('Failed to initialize Porcupine:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.porcupine || !this.recorder) {
      console.warn('Wake word detector not initialized');
      return;
    }

    if (this.isListening) {
      return;
    }

    this.isListening = true;

    this.recorder.on('frame', (frame: Int16Array) => {
      if (!this.isListening || !this.porcupine || this.isRecordingCommand) {
        return;
      }

      const keywordIndex = this.porcupine.process(frame);

      if (keywordIndex >= 0) {
        // Play "listening" sound
        playSound('Ping');
        this.emit('wakeword', keywordIndex);
        this.startCommandRecording();
      }
    });

    await this.recorder.start();
    this.emit('started');
  }

  private async startCommandRecording(): Promise<void> {
    if (!this.recorder || this.isRecordingCommand) {
      return;
    }

    this.isRecordingCommand = true;
    this.emit('listening');

    const audioChunks: Buffer[] = [];
    let silenceStart: number | null = null;
    const silenceThreshold = this.recordingConfig.silenceThreshold;
    const maxDuration = this.recordingConfig.maxDuration;
    const startTime = Date.now();

    const recordingHandler = (frame: Int16Array) => {
      // Convert Int16Array to Buffer
      const buffer = Buffer.from(frame.buffer);
      audioChunks.push(buffer);

      // Simple silence detection based on amplitude
      const amplitude = this.calculateAmplitude(frame);

      if (amplitude < 500) {
        // Low amplitude threshold
        if (!silenceStart) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart > silenceThreshold) {
          // End of speech detected
          this.finishRecording(audioChunks);
          this.recorder?.off('frame', recordingHandler);
          return;
        }
      } else {
        silenceStart = null;
      }

      // Max duration check
      if (Date.now() - startTime > maxDuration) {
        this.finishRecording(audioChunks);
        this.recorder?.off('frame', recordingHandler);
      }
    };

    this.recorder.on('frame', recordingHandler);
  }

  private calculateAmplitude(frame: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += Math.abs(frame[i]);
    }
    return sum / frame.length;
  }

  private finishRecording(chunks: Buffer[]): void {
    this.isRecordingCommand = false;

    // Play "done" sound
    playSound('Pop');

    const audioBuffer = Buffer.concat(chunks);
    this.emit('command', audioBuffer);
  }

  stop(): void {
    this.isListening = false;
    this.isRecordingCommand = false;

    if (this.recorder) {
      this.recorder.stop();
    }

    this.emit('stopped');
  }

  cleanup(): void {
    this.stop();

    if (this.porcupine) {
      // Porcupine v4.x uses release(), older versions use delete()
      if (typeof this.porcupine.release === 'function') {
        this.porcupine.release();
      } else if (typeof this.porcupine.delete === 'function') {
        this.porcupine.delete();
      }
      this.porcupine = null;
    }

    this.recorder = null;
  }
}
