import { STTConfig } from '../config';
import { WhisperLocalProvider } from './providers/whisper-local';
import { OpenAISTTProvider } from './providers/openai';
import { SherpaOnnxProvider } from './providers/sherpa-onnx';

export interface STTProvider {
  name: string;
  transcribe(audioPath: string): Promise<string>;
  isReady(): boolean;
}

export class STTManager {
  private provider: STTProvider;

  constructor(config: STTConfig) {
    this.provider = this.createProvider(config);
  }

  private createProvider(config: STTConfig): STTProvider {
    switch (config.provider) {
      case 'sherpa-onnx':
        return new SherpaOnnxProvider({
          model: (config as any).sherpaOnnx?.model || 'whisper-tiny',
          language: config.language,
        });
      case 'whisper-local':
        return new WhisperLocalProvider({
          ...config.whisperLocal,
          language: config.language,
        });
      case 'openai':
        return new OpenAISTTProvider(config.openai);
      case 'disabled':
        // Return a dummy provider that always fails
        return {
          name: 'disabled',
          transcribe: async () => {
            throw new Error('STT is disabled');
          },
          isReady: () => false,
        };
      default:
        console.warn(`Unknown STT provider: ${config.provider}, falling back to whisper-local`);
        return new WhisperLocalProvider({
          ...config.whisperLocal,
          language: config.language,
        });
    }
  }

  async transcribe(audioPath: string): Promise<string> {
    return this.provider.transcribe(audioPath);
  }

  isReady(): boolean {
    return this.provider.isReady();
  }

  getProviderName(): string {
    return this.provider.name;
  }
}
