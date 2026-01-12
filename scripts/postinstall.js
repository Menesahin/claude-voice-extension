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
const MODELS_DIR = path.join(CONFIG_DIR, 'models');
const VOICES_DIR = path.join(CONFIG_DIR, 'voices');
const platform = os.platform();

// Helper function to check if a command exists
function checkCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║          Claude Voice Extension - Auto Setup               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// 1. Create config directory
console.log('Step 1/7: Setting up configuration...');
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
console.log('\nStep 2/7: Installing Claude Code hooks...');
try {
  const settingsFile = installHooks(HOOKS_DIR);
  console.log('  [✓] Hooks installed');
  console.log('  [✓] Settings file:', settingsFile);
} catch (err) {
  console.log('  [!] Could not install hooks:', err.message);
}

// 5. Install Claude Code plugin (skill)
console.log('\nStep 3/7: Installing Claude Code plugin...');
try {
  const pluginPath = installPlugin(path.join(__dirname, '..'));
  console.log('  [✓] Plugin installed');
  console.log('  [✓] Plugin path:', pluginPath);
} catch (err) {
  console.log('  [!] Could not install plugin:', err.message);
}

// 6. Install Piper TTS and download default voice
console.log('\nStep 4/7: Installing Piper TTS engine...');
console.log('  (First-time install may take 1-2 minutes)\n');
try {
  // Direct download without going through CLI
  const voiceId = 'en_US-joe-medium';
  const onnxPath = path.join(VOICES_DIR, `${voiceId}.onnx`);
  const jsonPath = path.join(VOICES_DIR, `${voiceId}.onnx.json`);

  if (fs.existsSync(onnxPath) && fs.existsSync(jsonPath)) {
    console.log(`  [✓] Voice already installed: ${voiceId}`);
  } else {
    // Create voices directory
    if (!fs.existsSync(VOICES_DIR)) {
      fs.mkdirSync(VOICES_DIR, { recursive: true });
    }

    // Get voice URLs from HuggingFace
    const parts = voiceId.split('-');
    const langCode = parts[0];
    const lang = langCode.split('_')[0];
    const voiceName = parts[1];
    const quality = parts[2];
    const baseUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
    const voicePath = `${lang}/${langCode}/${voiceName}/${quality}`;
    const onnxUrl = `${baseUrl}/${voicePath}/${voiceId}.onnx`;
    const jsonUrl = `${baseUrl}/${voicePath}/${voiceId}.onnx.json`;

    console.log(`  Voice: Joe (US English)`);
    console.log(`  [1/2] Downloading voice model (~50MB)...`);
    execSync(`curl -L --progress-bar -o "${onnxPath}" "${onnxUrl}"`, { stdio: 'inherit' });

    console.log(`  [2/2] Downloading voice config...`);
    execSync(`curl -sL -o "${jsonPath}" "${jsonUrl}"`, { stdio: 'inherit' });

    console.log(`  [✓] Voice installed: ${voiceId}`);
  }

  // Install Piper TTS via pip if needed
  const PIPER_DIR = path.join(CONFIG_DIR, 'piper');
  const PIPER_VENV = path.join(PIPER_DIR, 'venv');
  const PIPER_BIN = path.join(PIPER_VENV, 'bin', 'piper');

  if (!fs.existsSync(PIPER_BIN)) {
    // Find Python 3.9-3.13
    const pythonCandidates = [
      '/opt/homebrew/bin/python3.12', '/opt/homebrew/bin/python3.11', '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3.12', '/usr/local/bin/python3.11', '/usr/local/bin/python3',
      '/usr/bin/python3.12', '/usr/bin/python3.11', '/usr/bin/python3.10', '/usr/bin/python3.9', '/usr/bin/python3',
      'python3.12', 'python3.11', 'python3.10', 'python3'
    ];

    let python = null;
    for (const py of pythonCandidates) {
      try {
        const version = execSync(`${py} --version 2>&1`, { encoding: 'utf-8' });
        const match = version.match(/Python 3\.(\d+)/);
        if (match) {
          const minor = parseInt(match[1], 10);
          if (minor >= 9 && minor <= 13) {
            python = py;
            break;
          }
        }
      } catch {}
    }

    if (python) {
      console.log(`  [1/3] Found Python: ${python}`);
      if (!fs.existsSync(PIPER_DIR)) {
        fs.mkdirSync(PIPER_DIR, { recursive: true });
      }
      console.log('  [2/3] Creating Python virtual environment...');
      execSync(`${python} -m venv "${PIPER_VENV}"`, { stdio: 'pipe' });
      console.log('  [3/3] Installing piper-tts package...');
      const pip = path.join(PIPER_VENV, 'bin', 'pip');
      execSync(`"${pip}" install --quiet piper-tts`, { stdio: 'pipe' });
      console.log('  [✓] Piper TTS installed successfully');
    } else {
      const installCmd = os.platform() === 'darwin'
        ? 'brew install python@3.12'
        : 'sudo apt install python3.12 python3.12-venv';
      console.log(`  [!] Python 3.9-3.13 not found. Install with: ${installCmd}`);
    }
  } else {
    console.log('  [✓] Piper TTS already installed');
  }
} catch (err) {
  console.log('  [!] Could not install Piper voice:', err.message);
  console.log('      Run manually: claude-voice voice download en_US-joe-medium');
}

// 7. Download whisper-tiny STT model
console.log('\nStep 5/7: Downloading Whisper STT model...');
console.log('  (This may take 2-3 minutes depending on connection)\n');
try {
  // Direct download without going through CLI
  const modelId = 'whisper-tiny';
  const modelFolder = 'sherpa-onnx-whisper-tiny';
  const modelUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2';
  const modelPath = path.join(MODELS_DIR, modelFolder);

  if (fs.existsSync(modelPath)) {
    console.log(`  [✓] Model already installed: ${modelId}`);
  } else {
    // Create models directory
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    const archivePath = path.join(MODELS_DIR, `${modelId}.tar.bz2`);

    console.log(`  Model: Whisper Tiny (75MB)`);
    console.log(`  [1/2] Downloading model...`);
    execSync(`curl -L --progress-bar -o "${archivePath}" "${modelUrl}"`, {
      stdio: 'inherit',
      cwd: MODELS_DIR
    });

    console.log('  [2/2] Extracting model files...');

    // Check if bzip2 is available on Linux
    if (platform === 'linux' && !checkCommand('bzip2')) {
      console.log('  [!] bzip2 not found. Install: sudo apt install bzip2');
      throw new Error('bzip2 required for extraction');
    }

    execSync(`tar -xjf "${archivePath}"`, {
      stdio: 'inherit',
      cwd: MODELS_DIR
    });

    // Verify extraction succeeded
    if (!fs.existsSync(modelPath)) {
      throw new Error('Extraction failed - folder not created');
    }

    // Cleanup archive
    fs.unlinkSync(archivePath);
    console.log(`  [✓] Model installed: ${modelId}`);
  }
} catch (err) {
  console.log('  [!] Could not download STT model:', err.message);
  console.log('      On Linux, install bzip2: sudo apt install bzip2');
  console.log('      Then run: claude-voice model download whisper-tiny');
}

// 8. Download Sherpa-ONNX keyword spotting model for wake word
console.log('\nStep 6/7: Downloading Sherpa-ONNX Wake Word model...');
console.log('  (Sherpa-ONNX keyword spotting - ~19MB)\n');
try {
  // Direct download without going through CLI
  const kwsModelId = 'kws-zipformer-gigaspeech';
  const kwsModelFolder = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
  const kwsModelUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2';
  const kwsModelPath = path.join(MODELS_DIR, kwsModelFolder);

  if (fs.existsSync(kwsModelPath)) {
    console.log(`  [✓] Model already installed: ${kwsModelId}`);
  } else {
    // Create models directory
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    const archivePath = path.join(MODELS_DIR, `${kwsModelId}.tar.bz2`);

    console.log(`  Model: Keyword Spotter English (19MB)`);
    console.log(`  [1/2] Downloading model...`);
    execSync(`curl -L --progress-bar -o "${archivePath}" "${kwsModelUrl}"`, {
      stdio: 'inherit',
      cwd: MODELS_DIR
    });

    console.log('  [2/2] Extracting model files...');

    // Check if bzip2 is available on Linux
    if (platform === 'linux' && !checkCommand('bzip2')) {
      console.log('  [!] bzip2 not found. Install: sudo apt install bzip2');
      throw new Error('bzip2 required for extraction');
    }

    execSync(`tar -xjf "${archivePath}"`, {
      stdio: 'inherit',
      cwd: MODELS_DIR
    });

    // Verify extraction succeeded
    if (!fs.existsSync(kwsModelPath)) {
      throw new Error('Extraction failed - folder not created');
    }

    // Cleanup archive
    fs.unlinkSync(archivePath);
    console.log(`  [✓] Model installed: ${kwsModelId}`);
  }
} catch (err) {
  console.log('  [!] Could not download wake word model:', err.message);
  console.log('      On Linux, install bzip2: sudo apt install bzip2');
  console.log('      Then run: claude-voice model download kws-zipformer-gigaspeech');
}

// 9. Install platform-specific audio tools
console.log('\nStep 7/7: Checking audio tools...');

// Check bzip2 for model extraction (Linux)
if (platform === 'linux') {
  if (checkCommand('bzip2')) {
    console.log('  [✓] bzip2 installed (for model extraction)');
  } else {
    console.log('  [!] bzip2 not found (required for model extraction)');
    console.log('      Install: sudo apt install bzip2');
  }
}

if (platform === 'darwin') {
  // macOS - need sox for audio capture
  if (checkCommand('rec')) {
    console.log('  [✓] sox installed');
  } else {
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
      console.log('  [!] sox not found. Install with: brew install sox');
    }
  }
  console.log('  [✓] Audio playback: afplay (native)');
} else if (platform === 'linux') {
  // Linux - check all required tools
  console.log('  Checking Linux dependencies...\n');

  // Check sox for audio capture
  if (checkCommand('rec')) {
    console.log('  [✓] sox installed');
  } else {
    console.log('  [!] sox not found');
    console.log('      Install: sudo apt install sox');
  }

  // Check alsa-utils for arecord (alternative audio capture)
  if (checkCommand('arecord')) {
    console.log('  [✓] alsa-utils installed (arecord)');
  } else {
    console.log('  [!] alsa-utils not found');
    console.log('      Install: sudo apt install alsa-utils');
  }

  // Check audio playback
  if (checkCommand('aplay') || checkCommand('paplay') || checkCommand('ffplay')) {
    console.log('  [✓] Audio playback available');
  } else {
    console.log('  [!] No audio player found');
    console.log('      Install one: sudo apt install alsa-utils  OR  sudo apt install ffmpeg');
  }

  // Check xdotool for terminal injection
  if (checkCommand('xdotool')) {
    console.log('  [✓] xdotool installed (terminal injection)');
  } else {
    console.log('  [!] xdotool not found (required for voice commands)');
    console.log('      Install: sudo apt install xdotool');
  }
}

// 10. Show platform info and completion
console.log('\nFinalizing setup...');
console.log(`  Platform: ${platform}`);

if (platform === 'darwin') {
  console.log('  [✓] macOS: All features supported');
} else if (platform === 'linux') {
  const missingDeps = [];
  if (!checkCommand('rec') && !checkCommand('arecord')) missingDeps.push('sox or alsa-utils');
  if (!checkCommand('xdotool')) missingDeps.push('xdotool');

  if (missingDeps.length === 0) {
    console.log('  [✓] Linux: All features supported');
  } else {
    console.log('  [!] Linux: Missing dependencies: ' + missingDeps.join(', '));
  }
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
