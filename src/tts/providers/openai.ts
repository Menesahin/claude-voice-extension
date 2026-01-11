import OpenAI from 'openai';
import { TTSProvider } from '../index';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface OpenAITTSConfig {
  model: 'tts-1' | 'tts-1-hd';
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
}

export class OpenAITTSProvider implements TTSProvider {
  name = 'openai-tts';
  private config: OpenAITTSConfig;
  private client: OpenAI;
  private currentProcess: ChildProcess | null = null;
  private ready = false;

  constructor(config: OpenAITTSConfig) {
    this.config = config;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not set. OpenAI TTS will not work.');
      this.client = null as unknown as OpenAI;
      return;
    }

    this.client = new OpenAI({ apiKey });
    this.ready = true;
  }

  async speak(text: string): Promise<void> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Set OPENAI_API_KEY environment variable.');
    }

    // Generate speech
    const response = await this.client.audio.speech.create({
      model: this.config.model,
      voice: this.config.voice,
      input: text,
    });

    // Save to temporary file
    const tempFile = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempFile, buffer);

    // Play the audio file
    await this.playAudio(tempFile);

    // Cleanup
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  private playAudio(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use afplay on macOS, ffplay on Linux
      const player = process.platform === 'darwin' ? 'afplay' : 'ffplay';
      const args =
        process.platform === 'darwin' ? [filePath] : ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath];

      this.currentProcess = spawn(player, args);

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Audio player exited with code ${code}`));
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
    return this.ready;
  }
}
