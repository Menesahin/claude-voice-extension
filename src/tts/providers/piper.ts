import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TTSProvider } from '../index';

const PIPER_DIR = path.join(os.homedir(), '.claude-voice', 'piper');
const PIPER_VENV = path.join(PIPER_DIR, 'venv');
const PIPER_BIN = path.join(PIPER_VENV, 'bin', 'piper');
const VOICES_DIR = path.join(os.homedir(), '.claude-voice', 'voices');

// Voice catalog with popular voices
export const PIPER_VOICES: Record<
  string,
  { name: string; language: string; quality: string; sampleRate: number }
> = {
  'en_US-lessac-medium': {
    name: 'Lessac (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_US-lessac-high': {
    name: 'Lessac High Quality (US English)',
    language: 'en_US',
    quality: 'high',
    sampleRate: 22050,
  },
  'en_US-amy-medium': {
    name: 'Amy (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_US-ryan-medium': {
    name: 'Ryan (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_US-joe-medium': {
    name: 'Joe (US English)',
    language: 'en_US',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_GB-alba-medium': {
    name: 'Alba (UK English)',
    language: 'en_GB',
    quality: 'medium',
    sampleRate: 22050,
  },
  'en_GB-aru-medium': {
    name: 'Aru (UK English)',
    language: 'en_GB',
    quality: 'medium',
    sampleRate: 22050,
  },
  'de_DE-thorsten-medium': {
    name: 'Thorsten (German)',
    language: 'de_DE',
    quality: 'medium',
    sampleRate: 22050,
  },
  'fr_FR-siwis-medium': {
    name: 'Siwis (French)',
    language: 'fr_FR',
    quality: 'medium',
    sampleRate: 22050,
  },
  'es_ES-davefx-medium': {
    name: 'Davefx (Spanish)',
    language: 'es_ES',
    quality: 'medium',
    sampleRate: 22050,
  },
  'tr_TR-dfki-medium': {
    name: 'DFKI (Turkish)',
    language: 'tr_TR',
    quality: 'medium',
    sampleRate: 22050,
  },
};

export interface PiperConfig {
  voice: string;
  speaker?: number;
}

export class PiperProvider implements TTSProvider {
  name = 'piper';
  private config: PiperConfig;
  private currentProcess: ChildProcess | null = null;
  private ready = false;

  constructor(config: PiperConfig) {
    this.config = config;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Check if piper is installed
    if (!fs.existsSync(PIPER_BIN)) {
      console.warn('Piper not installed. Run: claude-voice voice download <voice-id>');
      console.warn('This will automatically install Piper via pip.');
      return;
    }

    // Check if voice exists
    const voicePath = path.join(VOICES_DIR, `${this.config.voice}.onnx`);
    if (!fs.existsSync(voicePath)) {
      console.warn(`Voice not found: ${this.config.voice}`);
      console.warn(`Run: claude-voice voice download ${this.config.voice}`);
      return;
    }

    this.ready = true;
    console.log(`Piper TTS initialized with voice: ${this.config.voice}`);
  }

  async speak(text: string): Promise<void> {
    if (!this.ready) {
      throw new Error('Piper not initialized. Download a voice first.');
    }

    const voicePath = path.join(VOICES_DIR, `${this.config.voice}.onnx`);
    const platform = os.platform();
    const tempFile = path.join(os.tmpdir(), `piper-${Date.now()}.wav`);

    // Build piper command
    const piperArgs = ['--model', voicePath, '--output_file', tempFile];

    if (this.config.speaker !== undefined) {
      piperArgs.push('--speaker', String(this.config.speaker));
    }

    return new Promise((resolve, reject) => {
      // Run piper to generate audio
      const piper = spawn(PIPER_BIN, piperArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Send text to piper
      if (piper.stdin) {
        piper.stdin.write(text);
        piper.stdin.end();
      }

      let errorOutput = '';
      if (piper.stderr) {
        piper.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      }

      piper.on('error', (error) => {
        reject(new Error(`Piper error: ${error.message}`));
      });

      piper.on('close', (code) => {
        if (code !== 0) {
          console.error('Piper stderr:', errorOutput);
          reject(new Error(`Piper failed with code ${code}`));
          return;
        }

        // Play the generated file
        const playerCmd = platform === 'darwin' ? 'afplay' : 'aplay';
        const player = spawn(playerCmd, [tempFile], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });

        this.currentProcess = player;

        player.on('close', (playerCode) => {
          this.currentProcess = null;
          // Clean up temp file
          try {
            fs.unlinkSync(tempFile);
          } catch {
            // Ignore cleanup errors
          }

          if (playerCode === 0 || playerCode === null) {
            resolve();
          } else {
            reject(new Error(`Audio playback failed with code ${playerCode}`));
          }
        });

        player.on('error', (error) => {
          this.currentProcess = null;
          try {
            fs.unlinkSync(tempFile);
          } catch {
            // Ignore cleanup errors
          }
          reject(error);
        });
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

/**
 * Check if Piper is installed via pip in venv
 */
export function isPiperInstalled(): boolean {
  return fs.existsSync(PIPER_BIN);
}

/**
 * Find Python 3.12 or compatible version
 */
function findPython(): string | null {
  const candidates = [
    '/opt/homebrew/bin/python3.12',
    '/usr/local/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/usr/local/bin/python3.11',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    'python3.12',
    'python3.11',
    'python3',
  ];

  for (const python of candidates) {
    try {
      const version = execSync(`${python} --version 2>&1`, { encoding: 'utf-8' });
      const match = version.match(/Python 3\.(\d+)/);
      if (match) {
        const minor = parseInt(match[1], 10);
        // piper-tts 1.3.0 requires Python 3.9-3.13
        if (minor >= 9 && minor <= 13) {
          return python;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

/**
 * Install Piper via pip in a virtual environment
 */
export async function installPiper(): Promise<void> {
  if (isPiperInstalled()) {
    console.log('Piper is already installed.');
    return;
  }

  const python = findPython();
  if (!python) {
    throw new Error(
      'Python 3.9-3.13 not found. Install with: brew install python@3.12'
    );
  }

  console.log(`Using Python: ${python}`);

  // Create piper directory
  if (!fs.existsSync(PIPER_DIR)) {
    fs.mkdirSync(PIPER_DIR, { recursive: true });
  }

  // Create virtual environment
  console.log('Creating virtual environment...');
  execSync(`${python} -m venv "${PIPER_VENV}"`, { stdio: 'inherit' });

  // Install piper-tts
  console.log('Installing piper-tts (this may take a minute)...');
  const pip = path.join(PIPER_VENV, 'bin', 'pip');
  execSync(`"${pip}" install piper-tts`, { stdio: 'inherit' });

  console.log('Piper installed successfully!');
}

/**
 * Get voice download URLs from HuggingFace
 */
function getVoiceUrls(voiceId: string): { onnx: string; json: string } {
  // Parse voice ID: en_US-lessac-medium -> en/en_US/lessac/medium/en_US-lessac-medium
  const parts = voiceId.split('-');
  if (parts.length < 3) {
    throw new Error(`Invalid voice ID format: ${voiceId}`);
  }

  const langCode = parts[0]; // en_US
  const lang = langCode.split('_')[0]; // en
  const voiceName = parts[1]; // lessac
  const quality = parts[2]; // medium

  const baseUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
  const voicePath = `${lang}/${langCode}/${voiceName}/${quality}`;

  return {
    onnx: `${baseUrl}/${voicePath}/${voiceId}.onnx`,
    json: `${baseUrl}/${voicePath}/${voiceId}.onnx.json`,
  };
}

/**
 * Download a Piper voice
 */
export async function downloadVoice(voiceId: string): Promise<void> {
  // First ensure Piper is installed
  if (!isPiperInstalled()) {
    console.log('Piper not installed. Installing...');
    await installPiper();
  }

  // Check if voice is in our catalog
  const voiceInfo = PIPER_VOICES[voiceId];
  if (!voiceInfo) {
    console.warn(`Voice "${voiceId}" not in catalog. Attempting download anyway...`);
  } else {
    console.log(`Downloading voice: ${voiceInfo.name}`);
  }

  // Create voices directory
  if (!fs.existsSync(VOICES_DIR)) {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
  }

  const onnxPath = path.join(VOICES_DIR, `${voiceId}.onnx`);
  const jsonPath = path.join(VOICES_DIR, `${voiceId}.onnx.json`);

  if (fs.existsSync(onnxPath) && fs.existsSync(jsonPath)) {
    console.log(`Voice already installed: ${voiceId}`);
    return;
  }

  const urls = getVoiceUrls(voiceId);

  try {
    // Download ONNX model
    console.log('Downloading model file...');
    execSync(`curl -L -o "${onnxPath}" "${urls.onnx}"`, { stdio: 'inherit' });

    // Download JSON config
    console.log('Downloading config file...');
    execSync(`curl -L -o "${jsonPath}" "${urls.json}"`, { stdio: 'inherit' });

    console.log(`\nVoice installed: ${voiceId}`);
    console.log('\nTo use this voice:');
    console.log(`  claude-voice config set tts.provider piper`);
    console.log(`  claude-voice config set tts.piper.voice ${voiceId}`);
  } catch (error) {
    // Cleanup partial downloads
    if (fs.existsSync(onnxPath)) fs.unlinkSync(onnxPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    console.error('Failed to download voice:', error);
    throw error;
  }
}

/**
 * Remove a Piper voice
 */
export function removeVoice(voiceId: string): void {
  const onnxPath = path.join(VOICES_DIR, `${voiceId}.onnx`);
  const jsonPath = path.join(VOICES_DIR, `${voiceId}.onnx.json`);

  let removed = false;

  if (fs.existsSync(onnxPath)) {
    fs.unlinkSync(onnxPath);
    removed = true;
  }

  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    removed = true;
  }

  if (removed) {
    console.log(`Voice removed: ${voiceId}`);
  } else {
    console.log(`Voice not found: ${voiceId}`);
  }
}

/**
 * List available and installed voices
 */
export function listVoices(): { id: string; name: string; language: string; installed: boolean }[] {
  const result = Object.entries(PIPER_VOICES).map(([id, info]) => {
    const onnxPath = path.join(VOICES_DIR, `${id}.onnx`);
    return {
      id,
      name: info.name,
      language: info.language,
      installed: fs.existsSync(onnxPath),
    };
  });

  // Also check for any installed voices not in our catalog
  if (fs.existsSync(VOICES_DIR)) {
    const files = fs.readdirSync(VOICES_DIR);
    const installedIds = files
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.replace('.onnx', ''));

    for (const id of installedIds) {
      if (!PIPER_VOICES[id]) {
        result.push({
          id,
          name: id,
          language: id.split('-')[0] || 'unknown',
          installed: true,
        });
      }
    }
  }

  return result;
}
