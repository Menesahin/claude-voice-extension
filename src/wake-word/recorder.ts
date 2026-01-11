import { EventEmitter } from 'events';

interface RecorderConfig {
  sampleRate: number;
  frameLength: number;
  channels: number;
}

// PvRecorder types
interface PvRecorderInstance {
  start(): void;
  stop(): void;
  read(): Int16Array;
  delete(): void;
}

interface PvRecorderModule {
  create(deviceIndex: number, frameLength: number): PvRecorderInstance;
  getAvailableDevices(): string[];
}

export class AudioRecorder extends EventEmitter {
  private config: RecorderConfig;
  private recorder: PvRecorderInstance | null = null;
  private isRunning = false;
  private readInterval: NodeJS.Timeout | null = null;

  constructor(config: RecorderConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      // Dynamic import for PvRecorder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pvRecorderModule = await import('@picovoice/pvrecorder-node') as any;
      const PvRecorder = pvRecorderModule.PvRecorder;

      // Use default audio device (index -1)
      this.recorder = new PvRecorder(this.config.frameLength, -1);
      this.recorder!.start();
      this.isRunning = true;

      // Read frames continuously using readSync
      this.readInterval = setInterval(() => {
        if (this.recorder && this.isRunning) {
          try {
            // Use readSync() for synchronous reading in interval
            const frame = (this.recorder as any).readSync();
            this.emit('frame', frame);
          } catch (error) {
            this.emit('error', error);
          }
        }
      }, (this.config.frameLength / this.config.sampleRate) * 1000);

      this.emit('started');
    } catch (error) {
      console.error('Failed to start audio recorder:', error);
      throw error;
    }
  }

  stop(): void {
    this.isRunning = false;

    if (this.readInterval) {
      clearInterval(this.readInterval);
      this.readInterval = null;
    }

    if (this.recorder) {
      try {
        this.recorder.stop();
        this.recorder.delete();
      } catch {
        // Ignore cleanup errors
      }
      this.recorder = null;
    }

    this.emit('stopped');
  }

  static async listDevices(): Promise<string[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pvRecorderModule = await import('@picovoice/pvrecorder-node') as any;
      return pvRecorderModule.PvRecorder.getAvailableDevices();
    } catch {
      return [];
    }
  }
}

// Utility to save audio buffer to WAV file
export function saveToWav(
  audioBuffer: Buffer,
  outputPath: string,
  sampleRate: number,
  channels: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    import('fs').then((fs) => {
      // WAV header
      const header = Buffer.alloc(44);
      const dataSize = audioBuffer.length;
      const fileSize = dataSize + 36;

      // RIFF chunk descriptor
      header.write('RIFF', 0);
      header.writeUInt32LE(fileSize, 4);
      header.write('WAVE', 8);

      // fmt sub-chunk
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16); // Subchunk1Size
      header.writeUInt16LE(1, 20); // AudioFormat (PCM)
      header.writeUInt16LE(channels, 22); // NumChannels
      header.writeUInt32LE(sampleRate, 24); // SampleRate
      header.writeUInt32LE(sampleRate * channels * 2, 28); // ByteRate
      header.writeUInt16LE(channels * 2, 32); // BlockAlign
      header.writeUInt16LE(16, 34); // BitsPerSample

      // data sub-chunk
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);

      const wavBuffer = Buffer.concat([header, audioBuffer]);

      fs.writeFile(outputPath, wavBuffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
