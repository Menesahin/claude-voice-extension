import axios from 'axios';
import { TTSProvider } from '../index';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ElevenLabsConfig {
  voiceId: string;
  modelId: string;
}

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsProvider implements TTSProvider {
  name = 'elevenlabs';
  private config: ElevenLabsConfig;
  private apiKey: string | undefined;
  private currentProcess: ChildProcess | null = null;
  private ready = false;

  constructor(config: ElevenLabsConfig) {
    this.config = config;
    this.apiKey = process.env.ELEVENLABS_API_KEY;

    if (!this.apiKey) {
      console.warn('ELEVENLABS_API_KEY not set. ElevenLabs TTS will not work.');
      return;
    }

    if (!config.voiceId) {
      console.warn('ElevenLabs voiceId not configured.');
      return;
    }

    this.ready = true;
  }

  async speak(text: string): Promise<void> {
    if (!this.apiKey || !this.config.voiceId) {
      throw new Error('ElevenLabs not configured. Set ELEVENLABS_API_KEY and voiceId.');
    }

    const url = `${ELEVENLABS_API_URL}/text-to-speech/${this.config.voiceId}`;

    const response = await axios.post(
      url,
      {
        text,
        model_id: this.config.modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        responseType: 'arraybuffer',
      }
    );

    // Save to temporary file
    const tempFile = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
    fs.writeFileSync(tempFile, Buffer.from(response.data));

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

// Get available voices from ElevenLabs
export async function listVoices(apiKey: string): Promise<{ voice_id: string; name: string }[]> {
  const response = await axios.get(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  return response.data.voices.map((v: { voice_id: string; name: string }) => ({
    voice_id: v.voice_id,
    name: v.name,
  }));
}
