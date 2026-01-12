/**
 * Shared audio utilities for TTS and wake word detection
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { getPlatformCapabilities } from '../platform';

/**
 * Play a system sound (cross-platform)
 * @param soundName - Name of the sound (e.g., 'Ping', 'Pop' on macOS)
 */
export function playSound(soundName: string): void {
  const caps = getPlatformCapabilities();

  if (caps.platform === 'darwin') {
    const soundPath = `/System/Library/Sounds/${soundName}.aiff`;
    spawn('afplay', [soundPath], { stdio: 'ignore' });
  } else if (caps.platform === 'linux' && caps.audioPlayer) {
    const linuxSounds: Record<string, string> = {
      Ping: '/usr/share/sounds/freedesktop/stereo/message.oga',
      Pop: '/usr/share/sounds/freedesktop/stereo/complete.oga',
    };
    const soundPath = linuxSounds[soundName];
    if (soundPath) {
      spawn(caps.audioPlayer, [soundPath], { stdio: 'ignore' });
    }
  }
}

/**
 * Play an audio file using the platform's audio player
 * @param filePath - Path to the audio file
 * @returns Promise that resolves when playback completes
 */
export function playAudioFile(filePath: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const caps = getPlatformCapabilities();
    const platform = os.platform();
    const playerCmd = caps.audioPlayer || (platform === 'darwin' ? 'afplay' : 'aplay');

    const player = spawn(playerCmd, [filePath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    player.on('error', reject);
    resolve(player);
  });
}

/**
 * Play an audio file and wait for completion
 * @param filePath - Path to the audio file
 * @param cleanup - Optional cleanup function to call after playback
 * @returns Promise that resolves when playback completes
 */
export async function playAudioFileAndWait(
  filePath: string,
  cleanup?: () => void
): Promise<void> {
  const caps = getPlatformCapabilities();
  const platform = os.platform();
  const playerCmd = caps.audioPlayer || (platform === 'darwin' ? 'afplay' : 'aplay');

  return new Promise((resolve, reject) => {
    const player = spawn(playerCmd, [filePath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    player.on('close', (code) => {
      if (cleanup) {
        cleanup();
      }
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Audio playback failed with code ${code}`));
      }
    });

    player.on('error', (error) => {
      if (cleanup) {
        cleanup();
      }
      reject(error);
    });
  });
}

/**
 * Create a temporary file path for audio
 * @param prefix - Prefix for the temp file name
 * @param extension - File extension (default: 'wav')
 * @returns Full path to the temp file
 */
export function createTempAudioPath(prefix = 'audio', extension = 'wav'): string {
  return `${os.tmpdir()}/${prefix}-${Date.now()}.${extension}`;
}

/**
 * Safely delete a file, ignoring errors if file doesn't exist
 * @param filePath - Path to the file to delete
 */
export function safeDeleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Save audio buffer to WAV file
 * @param audioBuffer - Raw PCM audio buffer (Int16)
 * @param outputPath - Path to save the WAV file
 * @param sampleRate - Sample rate of the audio
 * @param channels - Number of audio channels
 */
export function saveToWav(
  audioBuffer: Buffer,
  outputPath: string,
  sampleRate: number,
  channels: number
): void {
  // WAV header (44 bytes)
  const header = Buffer.alloc(44);
  const dataSize = audioBuffer.length;
  const fileSize = dataSize + 36;

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(channels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate * channels * 2, 28); // ByteRate
  header.writeUInt16LE(channels * 2, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const wavBuffer = Buffer.concat([header, audioBuffer]);
  fs.writeFileSync(outputPath, wavBuffer);
}
