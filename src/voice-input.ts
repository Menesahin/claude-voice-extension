#!/usr/bin/env node
/**
 * Voice Input - Record and transcribe speech with a keypress
 *
 * Usage: node voice-input.js
 * Press SPACE to start recording, SPACE again to stop and transcribe.
 */

import * as readline from 'readline';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from './config';
import { STTManager } from './stt';
import { sendToClaudeCode } from './terminal/input-injector';

const config = loadConfig();
const sttManager = new STTManager(config.stt);

let isRecording = false;
let recordProcess: ReturnType<typeof spawn> | null = null;
let tempFile: string = '';

async function startRecording(): Promise<void> {
  tempFile = path.join(os.tmpdir(), `voice-input-${Date.now()}.wav`);

  console.log('\n🎤 Recording... (press SPACE to stop)');

  // Use sox (rec) on macOS for recording
  recordProcess = spawn('rec', [
    '-r', '16000',      // Sample rate
    '-c', '1',          // Mono
    '-b', '16',         // 16-bit
    tempFile
  ], {
    stdio: ['ignore', 'ignore', 'ignore']
  });

  isRecording = true;
}

async function stopRecording(): Promise<string> {
  if (!recordProcess) return '';

  recordProcess.kill('SIGTERM');
  recordProcess = null;
  isRecording = false;

  console.log('⏳ Transcribing...');

  // Wait a moment for file to be written
  await new Promise(r => setTimeout(r, 500));

  try {
    const transcript = await sttManager.transcribe(tempFile);

    // Cleanup
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    return transcript;
  } catch (error) {
    console.error('Transcription error:', error);
    return '';
  }
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════╗');
  console.log('║       Claude Voice Input               ║');
  console.log('╠════════════════════════════════════════╣');
  console.log('║  SPACE  = Start/Stop recording         ║');
  console.log('║  ENTER  = Send to Claude               ║');
  console.log('║  Q      = Quit                         ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('\nPress SPACE to start recording...\n');

  // Set up raw mode for keypress detection
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  let lastTranscript = '';

  process.stdin.on('keypress', async (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      console.log('\nGoodbye!');
      process.exit(0);
    }

    if (key.name === 'space') {
      if (!isRecording) {
        await startRecording();
      } else {
        lastTranscript = await stopRecording();
        if (lastTranscript) {
          console.log(`\n📝 Transcript: "${lastTranscript}"`);
          console.log('\nPress ENTER to send to Claude, SPACE to re-record, or Q to quit');
        } else {
          console.log('\n❌ No speech detected. Press SPACE to try again.');
        }
      }
    }

    if (key.name === 'return' && lastTranscript) {
      console.log('\n📤 Sending to Claude...');
      await sendToClaudeCode(lastTranscript);
      console.log('✅ Sent! Switch to your Claude terminal.');
      lastTranscript = '';
      console.log('\nPress SPACE to record again...');
    }
  });
}

main().catch(console.error);
