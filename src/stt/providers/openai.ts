import OpenAI from 'openai';
import * as fs from 'fs';
import { STTProvider } from '../index';

interface OpenAISTTConfig {
  model: string;
}

export class OpenAISTTProvider implements STTProvider {
  name = 'openai-whisper';
  private config: OpenAISTTConfig;
  private client: OpenAI;
  private ready = false;

  constructor(config: OpenAISTTConfig) {
    this.config = config;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not set. OpenAI STT will not work.');
      this.client = null as unknown as OpenAI;
      return;
    }

    this.client = new OpenAI({ apiKey });
    this.ready = true;
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Set OPENAI_API_KEY environment variable.');
    }

    const audioFile = fs.createReadStream(audioPath);

    const response = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: this.config.model,
    });

    return response.text;
  }

  isReady(): boolean {
    return this.ready;
  }
}
