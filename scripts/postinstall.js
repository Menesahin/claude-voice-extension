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
 * 6. Check platform-specific audio tools
 * 7. Finalize setup and show next steps
 *
 * Uses pure Node.js for downloads (no curl/bzip2 system dependencies)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
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

/**
 * Download and extract a .tar.bz2 file using pure Node.js
 * No system dependencies required (bzip2, curl, etc.)
 */
async function downloadAndExtract(url, destDir, expectedFolder, label) {
  // Lazy load dependencies (only available after npm install)
  let tar, unbzip2;
  try {
    tar = require('tar');
    unbzip2 = require('unbzip2-stream');
  } catch (err) {
    // Fallback to curl/tar if packages not available yet
    console.log(`  Using system tools for ${label}...`);
    return downloadAndExtractFallback(url, destDir, expectedFolder, label);
  }

  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl) => {
      https.get(requestUrl, (response) => {
        // Handle redirects (GitHub releases use them)
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          console.log(`  Redirecting...`);
          makeRequest(redirectUrl);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        // Get total size for progress
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        let lastPercent = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize) {
            const percent = Math.floor((downloaded / totalSize) * 100);
            if (percent >= lastPercent + 10) {
              process.stdout.write(`\r  Downloading: ${percent}%`);
              lastPercent = percent;
            }
          }
        });

        // Pipe: HTTP response -> unbzip2 -> tar extract
        response
          .pipe(unbzip2())
          .pipe(tar.extract({ cwd: destDir }))
          .on('finish', () => {
            console.log(`\r  Downloading: 100%`);
            const extractedPath = path.join(destDir, expectedFolder);
            if (fs.existsSync(extractedPath)) {
              resolve();
            } else {
              reject(new Error('Extraction failed - folder not found'));
            }
          })
          .on('error', (err) => {
            reject(new Error(`Extraction error: ${err.message}`));
          });
      }).on('error', (err) => {
        reject(new Error(`Download error: ${err.message}`));
      });
    };

    makeRequest(url);
  });
}

/**
 * Fallback: Use curl and tar if Node.js packages not available
 */
async function downloadAndExtractFallback(url, destDir, expectedFolder, label) {
  const archivePath = path.join(destDir, `${label}.tar.bz2`);

  try {
    execSync(`curl -L --progress-bar -o "${archivePath}" "${url}"`, {
      stdio: 'inherit',
      cwd: destDir
    });

    execSync(`tar -xjf "${archivePath}"`, {
      stdio: 'inherit',
      cwd: destDir
    });

    fs.unlinkSync(archivePath);

    const extractedPath = path.join(destDir, expectedFolder);
    if (!fs.existsSync(extractedPath)) {
      throw new Error('Extraction failed');
    }
  } catch (err) {
    throw new Error(`Fallback download failed: ${err.message}`);
  }
}

/**
 * Download a file using Node.js https (for simple files like .onnx)
 */
async function downloadFile(url, destPath, label) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl) => {
      https.get(requestUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          makeRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        let lastPercent = 0;

        const fileStream = fs.createWriteStream(destPath);

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize) {
            const percent = Math.floor((downloaded / totalSize) * 100);
            if (percent >= lastPercent + 10) {
              process.stdout.write(`\r  ${label}: ${percent}%`);
              lastPercent = percent;
            }
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          console.log(`\r  ${label}: 100%`);
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', reject);
    };

    makeRequest(url);
  });
}

// Main async setup function
async function runSetup() {
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
    config.tts = config.tts || {};
    config.tts.provider = 'piper';
    config.tts.piper = { voice: 'en_US-joe-medium', speaker: 0 };
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
    const voiceId = 'en_US-joe-medium';
    const onnxPath = path.join(VOICES_DIR, `${voiceId}.onnx`);
    const jsonPath = path.join(VOICES_DIR, `${voiceId}.onnx.json`);

    if (fs.existsSync(onnxPath) && fs.existsSync(jsonPath)) {
      console.log(`  [✓] Voice already installed: ${voiceId}`);
    } else {
      if (!fs.existsSync(VOICES_DIR)) {
        fs.mkdirSync(VOICES_DIR, { recursive: true });
      }

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
      await downloadFile(onnxUrl, onnxPath, 'Downloading voice model (~50MB)');
      await downloadFile(jsonUrl, jsonPath, 'Downloading voice config');
      console.log(`  [✓] Voice installed: ${voiceId}`);
    }

    // Install Piper TTS via pip if needed
    const PIPER_DIR = path.join(CONFIG_DIR, 'piper');
    const PIPER_VENV = path.join(PIPER_DIR, 'venv');
    const PIPER_BIN = path.join(PIPER_VENV, 'bin', 'piper');

    if (!fs.existsSync(PIPER_BIN)) {
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
        const installCmd = platform === 'darwin'
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
    const modelId = 'whisper-tiny';
    const modelFolder = 'sherpa-onnx-whisper-tiny';
    const modelUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2';
    const modelPath = path.join(MODELS_DIR, modelFolder);

    if (fs.existsSync(modelPath)) {
      console.log(`  [✓] Model already installed: ${modelId}`);
    } else {
      if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
      }

      console.log(`  Model: Whisper Tiny (75MB)`);
      await downloadAndExtract(modelUrl, MODELS_DIR, modelFolder, modelId);
      console.log(`  [✓] Model installed: ${modelId}`);
    }
  } catch (err) {
    console.log('  [!] Could not download STT model:', err.message);
    console.log('      Run manually: claude-voice model download whisper-tiny');
  }

  // 8. Download Sherpa-ONNX keyword spotting model for wake word
  console.log('\nStep 6/7: Downloading Sherpa-ONNX Wake Word model...');
  console.log('  (Sherpa-ONNX keyword spotting - ~19MB)\n');
  try {
    const kwsModelId = 'kws-zipformer-gigaspeech';
    const kwsModelFolder = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
    const kwsModelUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2';
    const kwsModelPath = path.join(MODELS_DIR, kwsModelFolder);

    if (fs.existsSync(kwsModelPath)) {
      console.log(`  [✓] Model already installed: ${kwsModelId}`);
    } else {
      if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
      }

      console.log(`  Model: Keyword Spotter English (19MB)`);
      await downloadAndExtract(kwsModelUrl, MODELS_DIR, kwsModelFolder, kwsModelId);
      console.log(`  [✓] Model installed: ${kwsModelId}`);
    }
  } catch (err) {
    console.log('  [!] Could not download wake word model:', err.message);
    console.log('      Run manually: claude-voice model download kws-zipformer-gigaspeech');
  }

  // 9. Check platform-specific audio tools
  console.log('\nStep 7/7: Checking audio tools...');

  if (platform === 'darwin') {
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
    console.log('  Checking Linux dependencies...\n');

    if (checkCommand('arecord')) {
      console.log('  [✓] alsa-utils installed (arecord)');
    } else {
      console.log('  [!] alsa-utils not found');
      console.log('      Install: sudo apt install alsa-utils');
    }

    if (checkCommand('aplay') || checkCommand('paplay') || checkCommand('ffplay')) {
      console.log('  [✓] Audio playback available');
    } else {
      console.log('  [!] No audio player found');
      console.log('      Install: sudo apt install alsa-utils');
    }

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
    if (!checkCommand('arecord')) missingDeps.push('alsa-utils');
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
}

// Run setup
runSetup().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
