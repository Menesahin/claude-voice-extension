import { spawn, execSync, ChildProcess } from 'child_process';
import { TTSProvider } from '../index';

interface EspeakConfig {
  voice: string;
  speed: number;
  pitch: number;
}

export class EspeakProvider implements TTSProvider {
  name = 'espeak';
  private config: EspeakConfig;
  private currentProcess: ChildProcess | null = null;
  private command: string;

  constructor(config: EspeakConfig) {
    this.config = config;
    // Prefer espeak-ng over espeak
    this.command = this.hasCommand('espeak-ng') ? 'espeak-ng' : 'espeak';
  }

  async speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', this.config.voice,
        '-s', String(this.config.speed),
        '-p', String(this.config.pitch),
        text,
      ];

      this.currentProcess = spawn(this.command, args);

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${this.command} exited with code ${code}`));
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
    return this.hasCommand('espeak-ng') || this.hasCommand('espeak');
  }

  private hasCommand(cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
