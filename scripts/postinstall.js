#!/usr/bin/env node
/**
 * Claude Voice Extension - Post-Install Setup
 *
 * This script runs after npm install to:
 * 1. Create config directory
 * 2. Set up default configuration (Piper TTS, Whisper STT)
 * 3. Install Claude Code hooks
 * 4. Install Piper TTS and download default voice
 * 5. Download whisper-small STT model
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { installHooks } = require('./install-hooks');

const CONFIG_DIR = path.join(os.homedir(), '.claude-voice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_CONFIG = path.join(__dirname, '..', 'config', 'default.json');
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

console.log('\n  Claude Voice Extension - Auto Setup\n');

// 1. Create config directory
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log('  [+] Created config directory:', CONFIG_DIR);
}

// 2. Copy default config if none exists
if (!fs.existsSync(CONFIG_FILE)) {
  if (fs.existsSync(DEFAULT_CONFIG)) {
    fs.copyFileSync(DEFAULT_CONFIG, CONFIG_FILE);
    console.log('  [+] Created default configuration');
  }
}

// 3. Configure with sensible defaults
try {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  // Set Piper TTS as default (free, local, high quality)
  config.tts = config.tts || {};
  config.tts.provider = 'piper';
  config.tts.piper = { voice: 'en_US-joe-medium', speaker: 0 };

  // Set sherpa-onnx with whisper-small as default STT
  config.stt = config.stt || {};
  config.stt.provider = 'sherpa-onnx';
  config.stt.sherpaOnnx = config.stt.sherpaOnnx || {};
  config.stt.sherpaOnnx.model = 'whisper-small';

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('  [+] Configured defaults: Piper TTS + Whisper STT');
} catch (err) {
  console.log('  [!] Could not update config:', err.message);
}

// 4. Install Claude Code hooks
try {
  const settingsFile = installHooks(HOOKS_DIR);
  console.log('  [+] Installed Claude Code hooks');
  console.log('      Settings:', settingsFile);
} catch (err) {
  console.log('  [!] Could not install hooks:', err.message);
}

// 5. Install Piper TTS and download default voice
const binPath = path.join(__dirname, '..', 'bin', 'claude-voice');
try {
  console.log('\n  Installing Piper TTS and downloading voice...');
  console.log('  (This may take a few minutes on first install)\n');
  execSync(`"${binPath}" voice download en_US-joe-medium`, {
    stdio: 'inherit',
    timeout: 300000  // 5 min timeout
  });
} catch (err) {
  console.log('  [!] Could not install Piper voice.');
  console.log('      Run manually: claude-voice voice download en_US-joe-medium');
}

// 6. Download whisper-small STT model
try {
  console.log('\n  Downloading whisper-small STT model...');
  console.log('  (This may take a few minutes)\n');
  execSync(`"${binPath}" model download whisper-small`, {
    stdio: 'inherit',
    timeout: 300000  // 5 min timeout
  });
} catch (err) {
  console.log('  [!] Could not download STT model.');
  console.log('      Run manually: claude-voice model download whisper-small');
}

// 7. Show platform info
const platform = os.platform();
console.log(`\n  Platform: ${platform}`);

if (platform === 'darwin') {
  console.log('  Audio: macOS native (afplay)');
} else if (platform === 'linux') {
  console.log('  Audio: Linux (aplay/paplay/ffplay)');
  console.log('  Note: Install xdotool for terminal injection: sudo apt install xdotool');
}

// 8. Show next steps
console.log('\n  Setup Complete!\n');
console.log('  The extension will auto-start when you launch Claude Code.');
console.log('  TTS and STT are ready to use.\n');
console.log('  Optional:');
console.log('  - Set PICOVOICE_ACCESS_KEY for wake word ("Jarvis")');
console.log('    Get a free key at: https://picovoice.ai/');
console.log('  - Run "claude-voice setup" to customize settings');
console.log('  - Run "claude-voice doctor" to diagnose issues\n');
