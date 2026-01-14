import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { STTProvider } from '../index';

const MODELS_DIR = path.join(os.homedir(), '.claude-voice', 'models');

// Set up library path for sherpa-onnx native bindings
function setupLibraryPath(): void {
  const platform = os.platform();
  const arch = os.arch();

  let platformPackage = '';
  if (platform === 'darwin' && arch === 'arm64') {
    platformPackage = 'sherpa-onnx-darwin-arm64';
  } else if (platform === 'darwin' && arch === 'x64') {
    platformPackage = 'sherpa-onnx-darwin-x64';
  } else if (platform === 'linux' && arch === 'x64') {
    platformPackage = 'sherpa-onnx-linux-x64';
  } else if (platform === 'linux' && arch === 'arm64') {
    platformPackage = 'sherpa-onnx-linux-arm64';
  }

  if (platformPackage) {
    // Try to find the package in node_modules
    const possiblePaths = [
      path.join(__dirname, '..', '..', '..', 'node_modules', platformPackage),
      path.join(__dirname, '..', '..', 'node_modules', platformPackage),
      path.join(process.cwd(), 'node_modules', platformPackage),
    ];

    for (const libPath of possiblePaths) {
      if (fs.existsSync(libPath)) {
        const envVar = platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
        const current = process.env[envVar] || '';
        if (!current.includes(libPath)) {
          process.env[envVar] = libPath + (current ? ':' + current : '');
        }
        break;
      }
    }
  }
}

// Initialize library path
setupLibraryPath();

// Available models for download
// SHA256 hashes for integrity verification (null = skip verification for models without known hash)
export const SHERPA_MODELS = {
  'whisper-tiny': {
    name: 'Whisper Tiny (75MB)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
    folder: 'sherpa-onnx-whisper-tiny',
    languages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
    type: 'stt',
    sha256: null as string | null, // To be updated with actual hash
  },
  'whisper-base': {
    name: 'Whisper Base (142MB)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2',
    folder: 'sherpa-onnx-whisper-base',
    languages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
    type: 'stt',
    sha256: null as string | null,
  },
  'whisper-small': {
    name: 'Whisper Small (488MB)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2',
    folder: 'sherpa-onnx-whisper-small',
    languages: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko'],
    type: 'stt',
    sha256: null as string | null,
  },
  'kws-zipformer-gigaspeech': {
    name: 'Keyword Spotter English (19MB) - For wake word detection',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
    folder: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01',
    languages: ['en'],
    type: 'kws',
    sha256: null as string | null,
  },
};

/**
 * Calculate SHA256 hash of a file
 */
function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Verify file integrity using SHA256 hash
 */
async function verifyFileIntegrity(filePath: string, expectedHash: string | null): Promise<boolean> {
  if (!expectedHash) {
    console.warn('  [!] No checksum available for verification - skipping integrity check');
    return true; // Skip verification if no hash is provided
  }

  try {
    const actualHash = await calculateFileHash(filePath);
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      console.error(`  [!] Checksum mismatch!`);
      console.error(`      Expected: ${expectedHash}`);
      console.error(`      Actual:   ${actualHash}`);
      return false;
    }
    console.log('  [✓] Checksum verified');
    return true;
  } catch (error) {
    console.error('  [!] Failed to verify checksum:', error);
    return false;
  }
}

export interface SherpaOnnxConfig {
  model: keyof typeof SHERPA_MODELS;
  language: string;
}

export class SherpaOnnxProvider implements STTProvider {
  name = 'sherpa-onnx';
  private config: SherpaOnnxConfig;
  private recognizer: any = null;
  private ready = false;

  constructor(config: SherpaOnnxConfig) {
    this.config = config;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    const modelInfo = SHERPA_MODELS[this.config.model];
    if (!modelInfo) {
      console.error(`Unknown model: ${this.config.model}`);
      return;
    }

    const modelPath = path.join(MODELS_DIR, modelInfo.folder);

    if (!fs.existsSync(modelPath)) {
      console.warn(`Model not found: ${modelPath}`);
      console.warn(`Run: claude-voice model download ${this.config.model}`);
      return;
    }

    try {
      const { OfflineRecognizer } = require('sherpa-onnx-node/non-streaming-asr');

      // Model file naming: whisper-tiny -> tiny-encoder.onnx, etc.
      const modelPrefix = this.config.model.replace('whisper-', '');

      // Configure for whisper model
      this.recognizer = new OfflineRecognizer({
        modelConfig: {
          whisper: {
            encoder: path.join(modelPath, `${modelPrefix}-encoder.onnx`),
            decoder: path.join(modelPath, `${modelPrefix}-decoder.onnx`),
            language: this.config.language || 'en',
            task: 'transcribe',
          },
          tokens: path.join(modelPath, `${modelPrefix}-tokens.txt`),
          numThreads: 2,
          debug: false,
          provider: 'cpu',
        },
      });

      this.ready = true;
      console.log(`Sherpa-ONNX initialized with model: ${this.config.model}`);
    } catch (error) {
      console.error('Failed to initialize Sherpa-ONNX:', error);
    }
  }

  async transcribe(audioPath: string): Promise<string> {
    if (!this.ready || !this.recognizer) {
      throw new Error('Sherpa-ONNX not initialized. Download a model first.');
    }

    try {
      // Read WAV file
      const samples = await this.readWavFile(audioPath);

      // Create stream and process
      const stream = this.recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: 16000 });

      this.recognizer.decode(stream);
      const result = this.recognizer.getResult(stream);

      return result.text?.trim() || '';
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  private async readWavFile(filePath: string): Promise<Float32Array> {
    const buffer = fs.readFileSync(filePath);

    // Parse WAV header (skip first 44 bytes for standard WAV)
    const dataStart = 44;
    const samples = new Float32Array((buffer.length - dataStart) / 2);

    for (let i = 0; i < samples.length; i++) {
      const sample = buffer.readInt16LE(dataStart + i * 2);
      samples[i] = sample / 32768.0; // Normalize to [-1, 1]
    }

    return samples;
  }

  isReady(): boolean {
    return this.ready;
  }
}

/**
 * Download a Sherpa-ONNX model with integrity verification
 */
export async function downloadModel(modelId: keyof typeof SHERPA_MODELS): Promise<void> {
  const modelInfo = SHERPA_MODELS[modelId];
  if (!modelInfo) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const modelPath = path.join(MODELS_DIR, modelInfo.folder);

  if (fs.existsSync(modelPath)) {
    console.log(`  [✓] Model already installed: ${modelId}`);
    return;
  }

  // Create models directory with secure permissions
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true, mode: 0o700 });
  }

  console.log(`  Model: ${modelInfo.name}`);
  console.log(`  Languages: ${modelInfo.languages.slice(0, 5).join(', ')}...`);

  const { spawnSync } = require('child_process');
  const archivePath = path.join(MODELS_DIR, `${modelId}.tar.bz2`);

  try {
    // Download with curl using spawn (safer than execSync with string interpolation)
    console.log(`  [1/3] Downloading model...`);
    const downloadResult = spawnSync('curl', [
      '-L',
      '--progress-bar',
      '--fail', // Fail on HTTP errors
      '-o', archivePath,
      modelInfo.url
    ], {
      stdio: 'inherit',
      cwd: MODELS_DIR
    });

    if (downloadResult.status !== 0) {
      throw new Error('Download failed');
    }

    // Verify checksum if available
    console.log('  [2/3] Verifying integrity...');
    const isValid = await verifyFileIntegrity(archivePath, modelInfo.sha256);
    if (!isValid) {
      // Delete potentially corrupted file
      try { fs.unlinkSync(archivePath); } catch {}
      throw new Error('Checksum verification failed - file may be corrupted or tampered');
    }

    // Extract
    console.log('  [3/3] Extracting model files...');
    const extractResult = spawnSync('tar', ['-xjf', archivePath], {
      stdio: 'pipe',
      cwd: MODELS_DIR
    });

    if (extractResult.status !== 0) {
      throw new Error('Extraction failed');
    }

    // Cleanup archive
    fs.unlinkSync(archivePath);

    console.log(`  [✓] Model installed: ${modelId}`);
  } catch (error) {
    console.error('  [!] Download failed:', error);
    throw error;
  }
}

/**
 * List available and installed models
 */
export function listModels(): { id: string; name: string; installed: boolean; languages: string[] }[] {
  return Object.entries(SHERPA_MODELS).map(([id, info]) => ({
    id,
    name: info.name,
    installed: fs.existsSync(path.join(MODELS_DIR, info.folder)),
    languages: info.languages,
  }));
}
