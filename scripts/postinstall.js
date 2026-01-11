#!/usr/bin/env node
/**
 * Claude Voice Extension - Post-Install Setup
 *
 * This script runs after npm install to set up the extension.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.claude-voice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_CONFIG = path.join(__dirname, '..', 'config', 'default.json');

console.log('\n  Claude Voice Extension - Post-Install Setup\n');

// 1. Create config directory
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log('  Created config directory:', CONFIG_DIR);
}

// 2. Copy default config if none exists
if (!fs.existsSync(CONFIG_FILE)) {
  if (fs.existsSync(DEFAULT_CONFIG)) {
    fs.copyFileSync(DEFAULT_CONFIG, CONFIG_FILE);
    console.log('  Created default configuration');
  }
}

// 3. Detect platform and show relevant info
const platform = os.platform();
console.log(`\n  Platform: ${platform}`);

if (platform === 'darwin') {
  console.log('  TTS: macOS "say" command available (built-in)');
  console.log('  Terminal: AppleScript injection available');
} else if (platform === 'linux') {
  console.log('  TTS: Install espeak for local TTS: sudo apt install espeak');
  console.log('  Terminal: Install xdotool for input: sudo apt install xdotool');
}

// 4. Show optional dependencies
console.log('\n  Optional Features:');
console.log('  - Wake word detection: Requires PICOVOICE_ACCESS_KEY');
console.log('    Get a free key at: https://picovoice.ai/');
console.log('  - OpenAI TTS/STT: Requires OPENAI_API_KEY');
console.log('  - ElevenLabs TTS: Requires ELEVENLABS_API_KEY');

// 5. Next steps
console.log('\n  Next Steps:');
console.log('  1. Run interactive setup:  claude-voice setup');
console.log('  2. Or start directly:      claude-voice start');
console.log('  3. Check status:           claude-voice status');
console.log('  4. Diagnose issues:        claude-voice doctor');
console.log('');
