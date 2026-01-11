import { spawn, ChildProcess } from 'child_process';
import { TTSProvider } from '../index';

interface MacOSSayConfig {
  voice: string;
  rate: number;
}

export class MacOSSayProvider implements TTSProvider {
  name = 'macos-say';
  private config: MacOSSayConfig;
  private currentProcess: ChildProcess | null = null;

  constructor(config: MacOSSayConfig) {
    this.config = config;
  }

  async speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean text for shell safety
      const cleanText = text.replace(/"/g, '\\"');

      const args = ['-v', this.config.voice, '-r', String(this.config.rate), cleanText];

      this.currentProcess = spawn('say', args);

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`say command exited with code ${code}`));
        }
      });

      this.currentProcess.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  isReady(): boolean {
    // macOS say is always available on macOS
    return process.platform === 'darwin';
  }
}

// List available voices on macOS
export async function listVoices(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn('say', ['-v', '?']);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const voices = output
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const match = line.match(/^(\S+)/);
            return match ? match[1] : '';
          })
          .filter((v) => v);
        resolve(voices);
      } else {
        reject(new Error('Failed to list voices'));
      }
    });
  });
}
