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
import { createWakeWordDetector, IWakeWordDetector } from './wake-word';
import { STTManager } from './stt';
import { sendToClaudeCode } from './terminal/input-injector';
import { saveToWav } from './wake-word/recorder';
import * as path from 'path';
import * as os from 'os';

let wakeWordDetector: IWakeWordDetector | null = null;
let sttManager: STTManager | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let keyListener: any = null;
let isRecordingFromShortcut = false;

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

  // Initialize keyboard shortcut if enabled
  if (config.shortcut?.enabled) {
    await initializeShortcut(config);
  }

  console.log('Claude Voice Extension is ready!');
  console.log(`TTS Provider: ${config.tts.provider}`);
  console.log(`STT Provider: ${config.stt.provider}`);
  console.log(`Wake Word: ${config.wakeWord.enabled ? `enabled (${config.wakeWord.provider || 'sherpa-onnx'})` : 'disabled'}`);
  console.log(`Shortcut: ${config.shortcut?.enabled ? config.shortcut.key : 'disabled'}`);
}

async function initializeWakeWord(config: ReturnType<typeof loadConfig>): Promise<void> {
  try {
    wakeWordDetector = createWakeWordDetector(config.wakeWord, config.recording);

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

            // Check for stop command
            const lower = transcript.toLowerCase().trim();
            if (lower === 'stop talking' || lower === 'stop' || lower.includes('stop talking')) {
              console.log('Stop command detected - stopping TTS');
              try {
                await fetch('http://127.0.0.1:3456/tts/stop', { method: 'POST' });
              } catch (e) {
                console.error('Failed to stop TTS:', e);
              }
              return; // Don't send to terminal
            }

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

    const keyword = config.wakeWord.keyword.charAt(0).toUpperCase() + config.wakeWord.keyword.slice(1);
    console.log(`Wake word detection active. Say "${keyword}" to start speaking.`);
  } catch (error) {
    console.warn('Failed to initialize wake word detection:', error);
    console.warn('Voice input will be disabled. Run "claude-voice model download kws-zipformer-gigaspeech" to enable.');
  }
}

async function initializeShortcut(config: ReturnType<typeof loadConfig>): Promise<void> {
  try {
    // On Linux, check if X11 DISPLAY is available
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      console.warn('Keyboard shortcut disabled: No X11 DISPLAY found (Wayland not supported)');
      return;
    }

    // Dynamic import for node-global-key-listener
    const { GlobalKeyboardListener } = await import('node-global-key-listener');

    keyListener = new GlobalKeyboardListener();

    // Wait a bit for the listener to initialize (catches async X11 errors)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Parse the shortcut key configuration
    const shortcutKey = config.shortcut.key;
    const keys = shortcutKey.split('+').map((k) => k.trim().toUpperCase());

    // Map key names to expected format
    const needsMeta = keys.includes('COMMAND') || keys.includes('COMMANDORCONTROL') || keys.includes('META');
    const needsControl = keys.includes('CONTROL') || keys.includes('CTRL') || keys.includes('COMMANDORCONTROL');
    const needsShift = keys.includes('SHIFT');
    const needsAlt = keys.includes('ALT') || keys.includes('OPTION');

    // Find the main key (not a modifier)
    const mainKey = keys.find(
      (k) =>
        !['COMMAND', 'COMMANDORCONTROL', 'CONTROL', 'CTRL', 'SHIFT', 'ALT', 'OPTION', 'META'].includes(k)
    );

    if (!mainKey) {
      console.warn('Invalid shortcut configuration: no main key found');
      return;
    }

    let recordingTimeout: NodeJS.Timeout | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    keyListener.addListener((e: any) => {
      // Only trigger on key down
      if (e.state !== 'DOWN') return;

      // Check modifiers
      const platform = process.platform;
      const metaPressed = platform === 'darwin' ? e.metaKey : e.ctrlKey;
      const ctrlPressed = e.ctrlKey;
      const shiftPressed = e.shiftKey;
      const altPressed = e.altKey;

      // CommandOrControl maps to Meta on macOS, Ctrl on other platforms
      const commandOrControlPressed = platform === 'darwin' ? metaPressed : ctrlPressed;

      // Check if our shortcut matches
      const modifiersMatch =
        (needsMeta ? (platform === 'darwin' ? metaPressed : true) : true) &&
        (needsControl ? (platform === 'darwin' ? true : ctrlPressed) : true) &&
        (keys.includes('COMMANDORCONTROL') ? commandOrControlPressed : true) &&
        (needsShift ? shiftPressed : !shiftPressed) &&
        (needsAlt ? altPressed : !altPressed);

      const keyName = e.name?.toUpperCase() || '';
      const keyMatches = keyName === mainKey || keyName === mainKey.toLowerCase();

      if (modifiersMatch && keyMatches && !isRecordingFromShortcut) {
        console.log('Shortcut triggered! Starting voice recording...');
        isRecordingFromShortcut = true;

        // Play sound to indicate listening
        playShortcutSound('start');

        // Start recording (use wake word detector's recording if available, or create new)
        if (wakeWordDetector) {
          // Trigger recording through wake word detector
          wakeWordDetector.emit('wakeword', 0);
        } else {
          // Standalone recording via STT
          startStandaloneRecording(config);
        }

        // Auto-stop after max duration
        recordingTimeout = setTimeout(() => {
          if (isRecordingFromShortcut) {
            isRecordingFromShortcut = false;
            playShortcutSound('stop');
          }
        }, config.recording.maxDuration);
      }
    });

    console.log(`Keyboard shortcut registered: ${config.shortcut.key}`);
  } catch (error) {
    console.warn('Failed to initialize keyboard shortcut:', error);
    console.warn('Install node-global-key-listener for shortcut support.');
  }
}

function playShortcutSound(type: 'start' | 'stop'): void {
  const { spawn } = require('child_process');
  const platform = process.platform;

  if (platform === 'darwin') {
    const sound = type === 'start' ? 'Ping' : 'Pop';
    spawn('afplay', [`/System/Library/Sounds/${sound}.aiff`], { stdio: 'ignore' });
  } else if (platform === 'linux') {
    const sounds: Record<string, string> = {
      start: '/usr/share/sounds/freedesktop/stereo/message.oga',
      stop: '/usr/share/sounds/freedesktop/stereo/complete.oga',
    };
    // Try common audio players
    const players = ['paplay', 'aplay', 'ffplay'];
    for (const player of players) {
      try {
        spawn(player, [sounds[type]], { stdio: 'ignore' });
        break;
      } catch {
        continue;
      }
    }
  }
}

async function startStandaloneRecording(config: ReturnType<typeof loadConfig>): Promise<void> {
  const { spawn } = require('child_process');
  const fs = require('fs');

  const tempPath = path.join(os.tmpdir(), `voice-shortcut-${Date.now()}.wav`);
  const sampleRate = config.recording.sampleRate;
  const maxDuration = config.recording.maxDuration / 1000; // Convert to seconds

  // Record audio using sox/arecord
  const platform = process.platform;
  let recordProcess;

  if (platform === 'darwin') {
    recordProcess = spawn('rec', ['-q', '-r', String(sampleRate), '-c', '1', '-b', '16', tempPath, 'trim', '0', String(maxDuration)], {
      stdio: 'ignore',
    });
  } else {
    recordProcess = spawn('arecord', ['-q', '-f', 'S16_LE', '-c', '1', '-r', String(sampleRate), '-d', String(maxDuration), tempPath], {
      stdio: 'ignore',
    });
  }

  recordProcess.on('close', async () => {
    isRecordingFromShortcut = false;
    playShortcutSound('stop');

    if (fs.existsSync(tempPath) && sttManager) {
      try {
        const transcript = await sttManager.transcribe(tempPath);
        if (transcript && transcript.trim()) {
          console.log(`Transcribed: "${transcript}"`);
          await sendToClaudeCode(transcript);
        }
        fs.unlinkSync(tempPath);
      } catch (error) {
        console.error('Error transcribing:', error);
      }
    }
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');

  if (wakeWordDetector) {
    wakeWordDetector.cleanup();
  }

  if (keyListener) {
    try {
      keyListener.kill();
    } catch {
      // Ignore cleanup errors
    }
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (wakeWordDetector) {
    wakeWordDetector.cleanup();
  }

  if (keyListener) {
    try {
      keyListener.kill();
    } catch {
      // Ignore cleanup errors
    }
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
