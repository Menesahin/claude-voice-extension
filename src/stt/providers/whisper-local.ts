import { spawn } from 'child_process';
import * as path from 'path';
import { STTProvider } from '../index';

export interface WhisperLocalConfig {
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  device: 'cpu' | 'cuda';
  language?: string; // Optional, passed from parent config
}

export class WhisperLocalProvider implements STTProvider {
  name = 'whisper-local';
  private config: WhisperLocalConfig;
  private pythonServicePath: string;
  private ready = false;

  constructor(config: WhisperLocalConfig) {
    this.config = config;
    this.pythonServicePath = path.join(__dirname, '..', '..', '..', 'python', 'stt_service.py');

    // Check if Python and whisper are available
    this.checkDependencies();
  }

  private async checkDependencies(): Promise<void> {
    try {
      await this.runCommand('python3', ['--version']);
      // We'll assume whisper is installed if python3 is available
      // The actual check happens when we try to use it
      this.ready = true;
    } catch {
      console.warn('Python3 not found. Local Whisper STT will not work.');
      this.ready = false;
    }
  }

  private runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!this.ready) {
      throw new Error('Whisper local provider not ready. Ensure Python3 and openai-whisper are installed.');
    }

    try {
      // Call the Python STT service script
      const result = await this.runCommand('python3', [
        this.pythonServicePath,
        '--audio',
        audioPath,
        '--model',
        this.config.model,
        '--language',
        this.config.language || 'en',
      ]);

      // Parse the JSON result
      const response = JSON.parse(result.trim());
      if (response.error) {
        throw new Error(response.error);
      }

      return response.transcript || '';
    } catch (error) {
      // Fallback: try using whisper CLI directly
      return this.transcribeWithCLI(audioPath);
    }
  }

  private async transcribeWithCLI(audioPath: string): Promise<string> {
    const result = await this.runCommand('whisper', [
      audioPath,
      '--model',
      this.config.model,
      '--language',
      this.config.language || 'en',
      '--output_format',
      'txt',
      '--output_dir',
      '/tmp',
    ]);

    // The output file will be in /tmp with the same name as the audio file but .txt extension
    const outputPath = `/tmp/${path.basename(audioPath, path.extname(audioPath))}.txt`;

    try {
      const fs = await import('fs');
      const transcript = fs.readFileSync(outputPath, 'utf-8').trim();
      fs.unlinkSync(outputPath); // Cleanup
      return transcript;
    } catch {
      // If we can't read the file, try parsing stdout
      return result.trim();
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}
