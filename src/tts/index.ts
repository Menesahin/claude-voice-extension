import { TTSConfig } from '../config';
import { MacOSSayProvider } from './providers/macos-say';
import { OpenAITTSProvider } from './providers/openai';
import { ElevenLabsProvider } from './providers/elevenlabs';
import { PiperProvider } from './providers/piper';

export interface TTSProvider {
  name: string;
  speak(text: string): Promise<void>;
  stop(): void;
  isReady(): boolean;
}

export class TTSManager {
  private provider: TTSProvider;
  private queue: { text: string; priority: boolean }[] = [];
  private isPlaying = false;

  constructor(config: TTSConfig) {
    this.provider = this.createProvider(config);
  }

  private createProvider(config: TTSConfig): TTSProvider {
    switch (config.provider) {
      case 'macos-say':
        return new MacOSSayProvider(config.macos);
      case 'openai':
        return new OpenAITTSProvider(config.openai);
      case 'elevenlabs':
        return new ElevenLabsProvider(config.elevenlabs);
      case 'piper':
        return new PiperProvider(config.piper);
      default:
        console.warn(`Unknown TTS provider: ${config.provider}, falling back to macos-say`);
        return new MacOSSayProvider(config.macos);
    }
  }

  async speak(text: string, priority = false): Promise<void> {
    if (priority) {
      // High priority: stop current playback and insert at front
      this.stop();
      this.queue.unshift({ text, priority });
    } else {
      this.queue.push({ text, priority });
    }

    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0) {
      return;
    }

    this.isPlaying = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        try {
          await this.provider.speak(item.text);
        } catch (error) {
          console.error('TTS error:', error);
        }
      }
    }

    this.isPlaying = false;
  }

  stop(): void {
    this.queue = [];
    this.provider.stop();
    this.isPlaying = false;
  }

  isReady(): boolean {
    return this.provider.isReady();
  }

  getProviderName(): string {
    return this.provider.name;
  }
}
