#!/usr/bin/env node
/**
 * Claude Voice Extension - Post-Install Setup
 *
 * This script runs after npm install to:
 * 1. Create config directory and set up default configuration
 * 2. Install Claude Code hooks
 * 3. Install Claude Code plugin
 * 4. Download keyword spotting model for wake word (19MB)
 * 5. Download STT model (whisper-small, ~488MB)
 * 6. Check platform-specific audio tools
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

// Check if Python 3 is available
function hasPython3() {
  for (const cmd of ['python3', 'python']) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });
      if (version.includes('Python 3')) return cmd;
    } catch {
      continue;
    }
  }
  return null;
}

// Check if openWakeWord Python package is installed
function checkOpenWakeWordInstalled(pythonCmd) {
  try {
    execSync(`${pythonCmd} -c "import openwakeword" 2>&1`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Try to install openWakeWord via pip (non-blocking)
function tryInstallOpenWakeWord(pythonCmd) {
  // Try multiple pip strategies for compatibility with Homebrew/system Python (PEP 668)
  const strategies = [
    `${pythonCmd} -m pip install openwakeword onnxruntime`,
    `${pythonCmd} -m pip install --user openwakeword onnxruntime`,
    `${pythonCmd} -m pip install --break-system-packages openwakeword onnxruntime`,
  ];

  console.log('  Installing openWakeWord via pip...');
  for (const cmd of strategies) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 120000 });
      console.log('  [✓] openWakeWord installed');
      return true;
    } catch {
      continue;
    }
  }

  console.log('  [!] Could not install openWakeWord automatically');
  console.log('      Install manually: pip install openwakeword');
  return false;
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

// Main async setup function
async function runSetup() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          Claude Voice Extension - Auto Setup               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let ttsProvider = platform === 'darwin' ? 'macOS Say' : 'espeak';
  let ttsProviderId = platform === 'darwin' ? 'macos-say' : 'espeak';

  // 1. Create config directory and set up configuration
  console.log('Step 1/7: Setting up configuration...');
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    console.log('  [✓] Created config directory');
  } else {
    console.log('  [✓] Config directory exists');
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    if (fs.existsSync(DEFAULT_CONFIG)) {
      fs.copyFileSync(DEFAULT_CONFIG, CONFIG_FILE);
      console.log('  [✓] Created default configuration');
    }
  } else {
    console.log('  [✓] Configuration file exists');
  }

  // Configure with platform-aware defaults (native TTS as initial fallback, piper attempted in step 5)
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    config.tts = config.tts || {};
    // Set native TTS as initial default; piper will override in step 5 if install succeeds
    config.tts.provider = ttsProviderId;
    config.stt = config.stt || {};
    config.stt.provider = 'sherpa-onnx';
    config.stt.sherpaOnnx = config.stt.sherpaOnnx || {};
    config.stt.sherpaOnnx.model = 'whisper-small';
    config.wakeWord = config.wakeWord || {};
    // Smart wake word provider: prefer openWakeWord if Python 3 is available
    const pythonCmd = hasPython3();
    if (pythonCmd) {
      config.wakeWord.provider = 'openwakeword';
    } else {
      config.wakeWord.provider = 'sherpa-onnx';
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    const wakeWordLabel = config.wakeWord.provider === 'openwakeword' ? 'openWakeWord' : 'Sherpa-ONNX KWS';
    console.log(`  [✓] Configured: ${ttsProvider} TTS + Sherpa-ONNX STT + ${wakeWordLabel} wake word`);
  } catch (err) {
    console.log('  [!] Could not update config:', err.message);
  }

  // 2. Install Claude Code hooks
  console.log('\nStep 2/7: Installing Claude Code hooks...');
  try {
    const settingsFile = installHooks(HOOKS_DIR);
    console.log('  [✓] Hooks installed');
    console.log('  [✓] Settings file:', settingsFile);
  } catch (err) {
    console.log('  [!] Could not install hooks:', err.message);
  }

  // 3. Install Claude Code plugin (skill)
  console.log('\nStep 3/7: Installing Claude Code plugin...');
  try {
    const pluginPath = installPlugin(path.join(__dirname, '..'));
    console.log('  [✓] Plugin installed');
    console.log('  [✓] Plugin path:', pluginPath);
  } catch (err) {
    console.log('  [!] Could not install plugin:', err.message);
  }

  // 4. Set up wake word detection
  console.log('\nStep 4/7: Setting up wake word detection...');

  // Re-read config to check which provider was selected
  let wakeWordProvider = 'sherpa-onnx';
  try {
    const currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    wakeWordProvider = currentConfig.wakeWord?.provider || 'sherpa-onnx';
  } catch { /* use default */ }

  if (wakeWordProvider === 'openwakeword') {
    // openWakeWord: install Python package if needed
    const pythonForWakeWord = hasPython3();
    if (pythonForWakeWord) {
      if (checkOpenWakeWordInstalled(pythonForWakeWord)) {
        console.log('  [✓] openWakeWord already installed');
      } else {
        const installed = tryInstallOpenWakeWord(pythonForWakeWord);
        if (!installed) {
          // Fall back to sherpa-onnx KWS
          console.log('  Falling back to Sherpa-ONNX KWS for wake word...');
          wakeWordProvider = 'sherpa-onnx';
          try {
            const fallbackConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            fallbackConfig.wakeWord.provider = 'sherpa-onnx';
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(fallbackConfig, null, 2));
          } catch { /* ignore */ }
        }
      }
    } else {
      // No Python - shouldn't happen since we check above, but handle gracefully
      console.log('  [!] Python 3 not available, falling back to Sherpa-ONNX KWS');
      wakeWordProvider = 'sherpa-onnx';
      try {
        const fallbackConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        fallbackConfig.wakeWord.provider = 'sherpa-onnx';
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(fallbackConfig, null, 2));
      } catch { /* ignore */ }
    }
  }

  if (wakeWordProvider === 'sherpa-onnx') {
    // Sherpa-ONNX KWS: download model (~19MB)
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

    // Suggest upgrade to openWakeWord
    console.log('  Tip: Install Python 3 + openwakeword for better wake word detection');
  }

  // Copy custom Picovoice .ppn keyword files to models dir
  try {
    const ppnSourceDir = path.join(__dirname, '..', 'models');
    if (fs.existsSync(ppnSourceDir)) {
      const ppnFiles = fs.readdirSync(ppnSourceDir).filter(f => f.endsWith('.ppn'));
      if (ppnFiles.length > 0) {
        if (!fs.existsSync(MODELS_DIR)) {
          fs.mkdirSync(MODELS_DIR, { recursive: true });
        }
        for (const ppn of ppnFiles) {
          const src = path.join(ppnSourceDir, ppn);
          const dest = path.join(MODELS_DIR, ppn);
          fs.copyFileSync(src, dest);
        }
        console.log(`  [✓] Copied ${ppnFiles.length} Picovoice keyword model(s): ${ppnFiles.join(', ')}`);
      }
    }
  } catch (err) {
    console.log('  [!] Could not copy Picovoice keyword models:', err.message);
  }

  // 5. Download STT model (whisper-small)
  console.log('\nStep 5/7: Downloading STT model...');
  try {
    const sttModelId = 'whisper-small';
    const sttModelFolder = 'sherpa-onnx-whisper-small';
    const sttModelUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2';
    const sttModelPath = path.join(MODELS_DIR, sttModelFolder);

    if (fs.existsSync(sttModelPath)) {
      console.log(`  [✓] STT model already installed: ${sttModelId}`);
    } else {
      if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
      }

      console.log(`  Model: Whisper Small (~950MB download, ~488MB extracted)`);
      await downloadAndExtract(sttModelUrl, MODELS_DIR, sttModelFolder, sttModelId);
      console.log(`  [✓] STT model installed: ${sttModelId}`);
    }
  } catch (err) {
    console.log('  [!] Could not download STT model:', err.message);
    console.log('      Run manually: claude-voice model download whisper-small');
  }

  // 6. Install Piper TTS voice for high-quality speech
  console.log('\nStep 6/7: Installing Piper TTS voice...');
  const pythonForPiper = hasPython3();
  if (pythonForPiper) {
    try {
      const piperDir = path.join(CONFIG_DIR, 'piper');
      const piperVenv = path.join(piperDir, 'venv');
      const piperBin = path.join(piperVenv, 'bin', 'piper');
      const voicesDir = path.join(CONFIG_DIR, 'voices');
      const voiceId = 'en_US-joe-medium';
      const voiceFile = path.join(voicesDir, `${voiceId}.onnx`);

      if (fs.existsSync(voiceFile)) {
        console.log(`  [✓] Piper voice already installed: ${voiceId}`);
        ttsProvider = 'Piper';
        ttsProviderId = 'piper';
      } else {
        // Install piper binary if needed
        if (!fs.existsSync(piperBin)) {
          if (!fs.existsSync(piperDir)) {
            fs.mkdirSync(piperDir, { recursive: true });
          }
          console.log(`  [1/3] Creating Python venv (${pythonForPiper})...`);
          execSync(`${pythonForPiper} -m venv "${piperVenv}"`, { stdio: 'pipe', timeout: 60000 });

          console.log('  [2/3] Installing piper-tts (this may take a minute)...');
          const pip = path.join(piperVenv, 'bin', 'pip');
          execSync(`"${pip}" install --quiet piper-tts pathvalidate`, { stdio: 'pipe', timeout: 180000 });
        } else {
          console.log('  [✓] Piper binary already installed');
        }

        // Download voice model
        console.log(`  [3/3] Downloading voice: ${voiceId} (~50MB)...`);
        if (!fs.existsSync(voicesDir)) {
          fs.mkdirSync(voicesDir, { recursive: true });
        }

        // Voice URL from HuggingFace
        const lang = 'en';
        const langCode = 'en_US';
        const voiceName = 'joe';
        const quality = 'medium';
        const baseUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
        const voicePath = `${lang}/${langCode}/${voiceName}/${quality}`;
        const onnxUrl = `${baseUrl}/${voicePath}/${voiceId}.onnx`;
        const jsonUrl = `${baseUrl}/${voicePath}/${voiceId}.onnx.json`;

        execSync(`curl -L -# -o "${voiceFile}" "${onnxUrl}"`, { stdio: 'inherit', timeout: 120000 });
        execSync(`curl -L -s -o "${voiceFile}.json" "${jsonUrl}"`, { stdio: 'pipe', timeout: 30000 });

        console.log(`  [✓] Piper voice installed: ${voiceId}`);
        ttsProvider = 'Piper';
        ttsProviderId = 'piper';
      }

      // Update config with piper
      try {
        const piperConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        piperConfig.tts.provider = 'piper';
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(piperConfig, null, 2));
      } catch { /* ignore */ }
    } catch (err) {
      console.log(`  [!] Piper installation failed: ${err.message}`);
      console.log(`  Falling back to ${ttsProvider} (native TTS)`);
      // Ensure config has native fallback
      try {
        const fallbackTtsConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        fallbackTtsConfig.tts.provider = ttsProviderId;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(fallbackTtsConfig, null, 2));
      } catch { /* ignore */ }
    }
  } else {
    console.log('  [!] Python 3 not found - Piper requires Python 3.9+');
    console.log(`  Using ${ttsProvider} (native TTS)`);
  }

  // 7. Check platform-specific audio tools
  console.log('\nStep 7/7: Checking audio tools...');

  if (platform === 'darwin') {
    console.log('  [✓] TTS: macOS Say (built-in)');
    console.log('  [✓] Audio playback: afplay (built-in)');
    if (checkCommand('rec')) {
      console.log('  [✓] Audio recording: sox installed');
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
        console.log('  [!] sox not found (needed for wake word). Install: brew install sox');
      }
    }
  } else if (platform === 'linux') {
    console.log('  Checking Linux dependencies...\n');

    if (checkCommand('espeak-ng') || checkCommand('espeak')) {
      console.log('  [✓] TTS: espeak available');
    } else {
      console.log('  [!] espeak not found. Install: sudo apt install espeak-ng');
    }

    if (checkCommand('arecord')) {
      console.log('  [✓] Audio recording: arecord installed');
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
      console.log('  [✓] Terminal injection: xdotool installed');
    } else {
      console.log('  [!] xdotool not found (needed for voice commands)');
      console.log('      Install: sudo apt install xdotool');
    }
  }

  // Fix sherpa-onnx native module rpath on macOS
  if (platform === 'darwin') {
    const sherpaNode = path.join(__dirname, '..', 'node_modules', 'sherpa-onnx-darwin-arm64', 'sherpa-onnx.node');
    if (fs.existsSync(sherpaNode)) {
      try {
        // Check if @loader_path rpath already exists
        const rpathOutput = execSync(`otool -l "${sherpaNode}" 2>/dev/null`, { encoding: 'utf-8' });
        if (!rpathOutput.includes('@loader_path')) {
          execSync(`install_name_tool -add_rpath @loader_path "${sherpaNode}" 2>/dev/null`);
          console.log('  [✓] Fixed sherpa-onnx native module rpath');
        }
      } catch {
        // Non-fatal: rpath fix is optional
      }
    }
  }

  // Validate installation
  console.log('\nValidating installation...');
  const installationIssues = [];

  // Check wake word setup based on provider
  if (wakeWordProvider === 'openwakeword') {
    const pyCmd = hasPython3();
    if (!pyCmd || !checkOpenWakeWordInstalled(pyCmd)) {
      installationIssues.push('openWakeWord not installed. Run: pip install openwakeword');
    }
  } else {
    const kwsModel = path.join(MODELS_DIR, 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01');
    if (!fs.existsSync(kwsModel)) {
      installationIssues.push('Wake word model not installed. Run: claude-voice model download kws-zipformer-gigaspeech');
    }
  }

  // Check STT model
  const whisperSmall = path.join(MODELS_DIR, 'sherpa-onnx-whisper-small');
  const whisperTiny = path.join(MODELS_DIR, 'sherpa-onnx-whisper-tiny');
  const whisperBase = path.join(MODELS_DIR, 'sherpa-onnx-whisper-base');
  if (!fs.existsSync(whisperSmall) && !fs.existsSync(whisperTiny) && !fs.existsSync(whisperBase)) {
    installationIssues.push('STT model not installed. Run: claude-voice model download whisper-small');
  } else {
    console.log('  [✓] STT model installed');
  }

  if (installationIssues.length > 0) {
    console.log('  [!] Some components need manual installation:\n');
    installationIssues.forEach(issue => console.log(`      - ${issue}`));
    console.log('');
  } else {
    console.log('  [✓] Essential components installed');
  }

  // Show platform info and completion
  console.log('\nFinalizing setup...');
  console.log(`  Platform: ${platform}`);

  if (platform === 'darwin') {
    console.log('  [✓] macOS: All features supported');
  } else if (platform === 'linux') {
    const missingDeps = [];
    if (!checkCommand('arecord')) missingDeps.push('alsa-utils');
    if (!checkCommand('espeak-ng') && !checkCommand('espeak')) missingDeps.push('espeak-ng');

    if (missingDeps.length === 0) {
      console.log('  [✓] Linux: All features supported');
    } else {
      console.log('  [!] Linux: Missing dependencies: ' + missingDeps.join(', '));
    }
  }

  // Show next steps
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Setup Complete!                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('  The extension will auto-start when you launch Claude Code.');
  const ttsLabel = ttsProviderId === 'piper' ? `${ttsProvider} (neural voice: en_US-joe-medium)` : `${ttsProvider} (native)`;
  console.log(`  TTS: ${ttsLabel}`);
  console.log('  STT: Sherpa-ONNX Whisper Small');
  const wakeWordName = wakeWordProvider === 'openwakeword' ? 'openWakeWord' : 'Sherpa-ONNX KWS';
  const wakeWordPhrase = wakeWordProvider === 'openwakeword' ? 'Hey Jarvis' : 'Jarvis';
  console.log(`  Wake Word: ${wakeWordName} - Say "${wakeWordPhrase}" to start speaking.\n`);
  console.log('  Upgrade voice quality:');
  console.log('  - Best quality:  claude-voice openai            (requires API key)');
  console.log('  - Customize:     claude-voice setup\n');
  console.log('  Troubleshoot:    claude-voice doctor\n');
}

// Run setup
runSetup().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
