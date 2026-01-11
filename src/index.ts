#!/usr/bin/env node
/**
 * Claude Voice Extension
 *
 * Main entry point for the voice extension daemon.
 * Provides TTS/STT services and wake word detection for Claude Code.
 */

import { loadConfig } from './config';
import { loadEnvVars } from './env';
import { startServer } from './server';
import { WakeWordDetector } from './wake-word';
import { STTManager } from './stt';
import { sendToClaudeCode } from './terminal/input-injector';
import { saveToWav } from './wake-word/recorder';
import * as path from 'path';
import * as os from 'os';

let wakeWordDetector: WakeWordDetector | null = null;
let sttManager: STTManager | null = null;

async function startDaemon(): Promise<void> {
  // Load API keys from ~/.claude-voice/.env first
  loadEnvVars();

  const config = loadConfig();

  console.log('Starting Claude Voice Extension daemon...');

  // Start the HTTP API server
  await startServer();

  // Initialize STT manager for voice commands
  sttManager = new STTManager(config.stt);

  // Initialize wake word detection if enabled
  if (config.wakeWord.enabled) {
    await initializeWakeWord(config);
  }

  console.log('Claude Voice Extension is ready!');
  console.log(`TTS Provider: ${config.tts.provider}`);
  console.log(`STT Provider: ${config.stt.provider}`);
  console.log(`Wake Word: ${config.wakeWord.enabled ? 'enabled' : 'disabled'}`);
}

async function initializeWakeWord(config: ReturnType<typeof loadConfig>): Promise<void> {
  try {
    wakeWordDetector = new WakeWordDetector(config.wakeWord, config.recording);

    wakeWordDetector.on('wakeword', () => {
      console.log('Wake word detected! Listening for command...');
    });

    wakeWordDetector.on('listening', () => {
      // Play a sound or provide feedback that we're listening
      if (config.debug) {
        console.log('Recording command...');
      }
    });

    wakeWordDetector.on('command', async (audioBuffer: Buffer) => {
      try {
        // Save audio to temp file
        const tempPath = path.join(os.tmpdir(), `voice-command-${Date.now()}.wav`);
        await saveToWav(audioBuffer, tempPath, config.recording.sampleRate, config.recording.channels);

        // Transcribe
        if (sttManager) {
          const transcript = await sttManager.transcribe(tempPath);

          if (transcript && transcript.trim()) {
            console.log(`Transcribed: "${transcript}"`);

            // Send to Claude Code
            await sendToClaudeCode(transcript);
          }
        }

        // Cleanup
        const fs = await import('fs');
        fs.unlinkSync(tempPath);
      } catch (error) {
        console.error('Error processing voice command:', error);
      }
    });

    wakeWordDetector.on('error', (error) => {
      console.error('Wake word detector error:', error);
    });

    await wakeWordDetector.initialize();
    await wakeWordDetector.start();

    console.log('Wake word detection active. Say "Jarvis" to start speaking.');
  } catch (error) {
    console.warn('Failed to initialize wake word detection:', error);
    console.warn('Voice input will be disabled. Set PICOVOICE_ACCESS_KEY to enable.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');

  if (wakeWordDetector) {
    wakeWordDetector.cleanup();
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (wakeWordDetector) {
    wakeWordDetector.cleanup();
  }

  process.exit(0);
});

// Export for programmatic use
export { startDaemon };

// Run if called directly
if (require.main === module) {
  startDaemon().catch((error) => {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  });
}
