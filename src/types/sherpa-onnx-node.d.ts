declare module 'sherpa-onnx-node' {
  export interface KwsConfig {
    modelConfig: {
      transducer: {
        encoder: string;
        decoder: string;
        joiner: string;
      };
      tokens: string;
    };
    maxActivePaths?: number;
    numTrailingBlanks?: number;
    keywords: string;
    keywordsThreshold?: number;
  }

  export interface KwsStream {
    acceptWaveform(sampleRate: number, samples: Float32Array): void;
    free(): void;
  }

  export interface KwsResult {
    keyword: string;
  }

  export interface Kws {
    createStream(): KwsStream;
    isReady(stream: KwsStream): boolean;
    decode(stream: KwsStream): void;
    getResult(stream: KwsStream): KwsResult;
    reset(stream: KwsStream): void;
    free(): void;
  }

  export function createKws(config: KwsConfig): Kws;

  export interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }

  export function readWave(filename: string): Wave;
}
