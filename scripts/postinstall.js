#!/usr/bin/env node
/**
 * Claude Voice Extension - Post-Install Setup
 *
 * This script runs after npm install to:
 * 1. Create config directory and set up default configuration
 * 2. Install Claude Code hooks
 * 3. Install Piper TTS and download default voice
 * 4. Download whisper-tiny STT model
 * 5. Download keyword spotting model for wake word
 * 6. Install sox for audio capture (macOS via Homebrew)
 * 7. Finalize setup and show next steps
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { installHooks } = require('./install-hooks');
const { installPlugin } = require('./install-plugin');

const CONFIG_DIR = path.join(os.homedir(), '.claude-voice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_CONFIG = path.join(__dirname, '..', 'config', 'default.json');
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║          Claude Voice Extension - Auto Setup               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// 1. Create config directory
console.log('Step 1/8: Setting up configuration...');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log('  [✓] Created config directory');
} else {
  console.log('  [✓] Config directory exists');
}

// 2. Copy default config if none exists
if (!fs.existsSync(CONFIG_FILE)) {
  if (fs.existsSync(DEFAULT_CONFIG)) {
    fs.copyFileSync(DEFAULT_CONFIG, CONFIG_FILE);
    console.log('  [✓] Created default configuration');
  }
} else {
  console.log('  [✓] Configuration file exists');
}

// 3. Configure with sensible defaults
try {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  // Set Piper TTS as default (free, local, high quality)
  config.tts = config.tts || {};
  config.tts.provider = 'piper';
  config.tts.piper = { voice: 'en_US-joe-medium', speaker: 0 };

  // Set sherpa-onnx with whisper-tiny as default STT
  config.stt = config.stt || {};
  config.stt.provider = 'sherpa-onnx';
  config.stt.sherpaOnnx = config.stt.sherpaOnnx || {};
  config.stt.sherpaOnnx.model = 'whisper-tiny';

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('  [✓] Configured: Piper TTS + Whisper STT');
} catch (err) {
  console.log('  [!] Could not update config:', err.message);
}

// 4. Install Claude Code hooks
console.log('\nStep 2/8: Installing Claude Code hooks...');
try {
  const settingsFile = installHooks(HOOKS_DIR);
  console.log('  [✓] Hooks installed');
  console.log('  [✓] Settings file:', settingsFile);
} catch (err) {
  console.log('  [!] Could not install hooks:', err.message);
}

// 5. Install Claude Code plugin (skill)
console.log('\nStep 3/8: Installing Claude Code plugin...');
try {
  const pluginPath = installPlugin(path.join(__dirname, '..'));
  console.log('  [✓] Plugin installed');
  console.log('  [✓] Plugin path:', pluginPath);
} catch (err) {
  console.log('  [!] Could not install plugin:', err.message);
}

// 6. Install Piper TTS and download default voice
const binPath = path.join(__dirname, '..', 'bin', 'claude-voice');
console.log('\nStep 4/8: Installing Piper TTS engine...');
console.log('  (First-time install may take 1-2 minutes)\n');
try {
  execSync(`"${binPath}" voice download en_US-joe-medium`, {
    stdio: 'inherit',
    timeout: 300000  // 5 min timeout
  });
} catch (err) {
  console.log('  [!] Could not install Piper voice.');
  console.log('      Run manually: claude-voice voice download en_US-joe-medium');
}

// 7. Download whisper-tiny STT model
console.log('\nStep 5/8: Downloading Whisper STT model...');
console.log('  (This may take 2-3 minutes depending on connection)\n');
try {
  execSync(`"${binPath}" model download whisper-tiny`, {
    stdio: 'inherit',
    timeout: 300000  // 5 min timeout
  });
} catch (err) {
  console.log('  [!] Could not download STT model.');
  console.log('      Run manually: claude-voice model download whisper-tiny');
}

// 8. Download Sherpa-ONNX keyword spotting model for wake word
console.log('\nStep 6/7: Downloading Sherpa-ONNX Wake Word model...');
console.log('  (Sherpa-ONNX keyword spotting - ~19MB)\n');
try {
  execSync(`"${binPath}" model download kws-zipformer-gigaspeech`, {
    stdio: 'inherit',
    timeout: 300000  // 5 min timeout
  });
} catch (err) {
  console.log('  [!] Could not download wake word model.');
  console.log('      Run manually: claude-voice model download kws-zipformer-gigaspeech');
}

// 9. Install sox for audio capture (wake word)
console.log('\nStep 7/7: Installing audio capture tools...');
const platform = os.platform();

function checkCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (checkCommand('rec')) {
  console.log('  [✓] sox already installed');
} else {
  console.log('  [!] sox not found, attempting to install...');

  if (platform === 'darwin') {
    // macOS - try Homebrew
    if (checkCommand('brew')) {
      try {
        console.log('  Installing sox via Homebrew...');
        execSync('brew install sox', { stdio: 'inherit', timeout: 120000 });
        console.log('  [✓] sox installed via Homebrew');
      } catch (err) {
        console.log('  [!] Could not install sox automatically');
        console.log('      Run manually: brew install sox');
      }
    } else {
      console.log('  [!] Homebrew not found');
      console.log('      Install sox manually: brew install sox');
      console.log('      Or install Homebrew first: https://brew.sh');
    }
  } else if (platform === 'linux') {
    // Linux - requires sudo, so just show instructions
    console.log('  [!] Please install sox manually:');
    console.log('      Ubuntu/Debian: sudo apt install sox');
    console.log('      Fedora: sudo dnf install sox');
    console.log('      Arch: sudo pacman -S sox');
  }
}

// 10. Show platform info and completion
console.log('\nFinalizing setup...');
console.log(`  [✓] Platform: ${platform}`);

if (platform === 'darwin') {
  console.log('  [✓] Audio: macOS native (afplay)');
} else if (platform === 'linux') {
  console.log('  [✓] Audio: Linux (aplay/paplay/ffplay)');
  console.log('  [i] Note: Install xdotool for terminal injection: sudo apt install xdotool');
}

// 11. Show next steps
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                    Setup Complete!                         ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');
console.log('  The extension will auto-start when you launch Claude Code.');
console.log('  TTS, STT, and Wake Word are ready to use!\n');
console.log('  Say "Jarvis" to start speaking a command.\n');
console.log('  Commands:');
console.log('  - Run "claude-voice setup" to customize settings');
console.log('  - Run "claude-voice doctor" to diagnose issues');
console.log('  - Run "claude-voice status" to check status\n');
