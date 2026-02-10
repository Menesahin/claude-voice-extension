#!/usr/bin/env node
/**
 * Claude Voice Extension CLI
 *
 * Command-line interface for managing the voice extension.
 */

import { Command } from 'commander';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigPath,
  getConfigValue,
  setConfigValue,
  getConfigDir,
} from './config';
import { TTSManager } from './tts';
import { STTManager } from './stt';
import { loadEnvVars, checkApiKeys, getEnvFilePath } from './env';
import { getPlatformCapabilities, getInstallInstructions, getPlatformSummary, detectMissingTools } from './platform';
import { downloadModel, listModels, SHERPA_MODELS } from './stt/providers/sherpa-onnx';
import {
  downloadVoice,
  listVoices as listPiperVoices,
  removeVoice,
  PIPER_VOICES,
  isPiperInstalled,
} from './tts/providers/piper';
import {
  isOpenWakeWordInstalled,
  installOpenWakeWord,
  downloadOpenWakeWordModel,
  listOpenWakeWordModels,
  OPENWAKEWORD_MODELS,
} from './wake-word';

const API_URL = 'http://127.0.0.1:3456';
const PID_FILE = path.join(process.env.HOME || '~', '.claude-voice', 'daemon.pid');
const LOG_FILE = path.join(process.env.HOME || '~', '.claude-voice', 'daemon.log');

const program = new Command();

program.name('claude-voice').description('Voice interface extension for Claude Code').version('1.0.0');

// ============================================================================
// Helper Functions
// ============================================================================

function checkDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${API_URL}/status`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for daemon to be ready with polling and retries.
 * Better than fixed timeout - returns as soon as daemon is ready.
 */
async function waitForDaemon(maxWaitMs = 10000, intervalMs = 300): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (await checkDaemon()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function savePid(pid: number): void {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, String(pid));
}

function readPid(): number | null {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    return isNaN(pid) ? null : pid;
  }
  return null;
}

function deletePid(): void {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function findDaemonByPort(): number | null {
  try {
    // Use lsof to find process listening on port 3456
    const result = execSync('lsof -ti :3456 2>/dev/null', { encoding: 'utf-8' });
    const pid = parseInt(result.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Download required models/voices based on current configuration.
 * Returns true if all required models are ready, false if downloads failed.
 */
async function downloadRequiredModels(options?: { silent?: boolean }): Promise<boolean> {
  const config = loadConfig();
  const silent = options?.silent ?? false;
  let success = true;

  // Check Piper TTS voice
  if (config.tts.provider === 'piper') {
    const voiceId = config.tts.piper?.voice || 'en_US-joe-medium';
    const voices = listPiperVoices();
    const voice = voices.find((v) => v.id === voiceId);

    if (!voice?.installed) {
      if (!silent) console.log(`\nDownloading Piper voice: ${voiceId}...`);
      try {
        await downloadVoice(voiceId);
        if (!silent) console.log(`✓ Piper voice ready: ${voiceId}`);
      } catch (error) {
        console.error(`✗ Failed to download Piper voice: ${voiceId}`);
        if (!silent) console.error(error);
        success = false;
      }
    } else if (!silent) {
      console.log(`✓ Piper voice already installed: ${voiceId}`);
    }
  }

  // Check Sherpa-ONNX STT model
  if (config.stt.provider === 'sherpa-onnx') {
    const modelId = config.stt.sherpaOnnx?.model || 'whisper-small';
    const models = listModels();
    const model = models.find((m) => m.id === modelId);

    if (!model?.installed) {
      if (!silent) console.log(`\nDownloading STT model: ${modelId}...`);
      try {
        await downloadModel(modelId as keyof typeof SHERPA_MODELS);
        if (!silent) console.log(`✓ STT model ready: ${modelId}`);
      } catch (error) {
        console.error(`✗ Failed to download STT model: ${modelId}`);
        if (!silent) console.error(error);
        success = false;
      }
    } else if (!silent) {
      console.log(`✓ STT model already installed: ${modelId}`);
    }
  }

  return success;
}

function checkHooksInstalled(): boolean {
  const settingsFile = path.join(process.env.HOME || '~', '.claude', 'settings.json');
  if (!fs.existsSync(settingsFile)) return false;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return !!(
      settings.hooks?.SessionStart?.some((h: { hooks: { command: string }[] }) =>
        h.hooks?.some((hook) => hook.command?.includes('session-start.js'))
      ) &&
      settings.hooks?.Stop?.some((h: { hooks: { command: string }[] }) =>
        h.hooks?.some((hook) => hook.command?.includes('stop.js'))
      ) &&
      settings.hooks?.PostToolUse?.some((h: { hooks: { command: string }[] }) =>
        h.hooks?.some((hook) => hook.command?.includes('post-tool-use.js'))
      )
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Core Commands
// ============================================================================

program
  .command('start')
  .description('Start the voice extension daemon')
  .option('-f, --foreground', "Run in foreground (don't daemonize)")
  .action(async (options) => {
    // First-run check: ensure config and hooks are set up
    const configDir = path.join(process.env.HOME || '~', '.claude-voice');
    const configFile = path.join(configDir, 'config.json');
    const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.json');

    if (!fs.existsSync(configFile)) {
      console.log('First run detected. Setting up...');

      // Create config directory
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Copy default config
      if (fs.existsSync(defaultConfigPath)) {
        fs.copyFileSync(defaultConfigPath, configFile);
      }

      // Configure with platform-aware defaults (zero-config TTS)
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        config.tts = config.tts || {};
        config.tts.provider = process.platform === 'darwin' ? 'macos-say' : 'espeak';
        config.stt = config.stt || {};
        config.stt.provider = 'sherpa-onnx';
        config.stt.sherpaOnnx = config.stt.sherpaOnnx || {};
        config.stt.sherpaOnnx.model = 'whisper-tiny';
        config.wakeWord = config.wakeWord || {};
        // Smart wake word: prefer openWakeWord when available
        if (isOpenWakeWordInstalled()) {
          config.wakeWord.provider = 'openwakeword';
          config.wakeWord.openwakeword = config.wakeWord.openwakeword || { model: 'hey_jarvis', threshold: 0.5, debug: false };
        } else {
          config.wakeWord.provider = 'sherpa-onnx';
        }
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        const ttsName = process.platform === 'darwin' ? 'macOS Say' : 'espeak';
        const wwName = config.wakeWord.provider === 'openwakeword' ? 'openWakeWord' : 'Sherpa-ONNX KWS';
        console.log(`  [+] Configured defaults (${ttsName} TTS + Sherpa-ONNX STT + ${wwName} wake word)`);
      } catch {
        // Ignore config errors
      }
    }

    // Ensure hooks are installed
    if (!checkHooksInstalled()) {
      console.log('Installing Claude Code hooks...');
      installHooksHelper();
      console.log('  [+] Hooks installed');
    }

    // Load env vars
    loadEnvVars();

    // Validate providers and auto-download missing models
    try {
      const startConfig = loadConfig();

      // Check TTS provider (warn only, don't block)
      if (startConfig.tts.provider === 'piper' && !isPiperInstalled()) {
        const nativeFallback = process.platform === 'darwin' ? 'macos-say' : 'espeak';
        console.log(`\n  Warning: Piper TTS not installed.`);
        console.log(`  Fix: claude-voice local --download`);
        console.log(`  Or switch to native TTS: claude-voice config set tts.provider=${nativeFallback}\n`);
      } else if (startConfig.tts.provider === 'openai' && !process.env.OPENAI_API_KEY) {
        console.log('\n  Warning: OpenAI TTS requires OPENAI_API_KEY in ~/.claude-voice/.env\n');
      } else if (startConfig.tts.provider === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
        console.log('\n  Warning: ElevenLabs requires ELEVENLABS_API_KEY in ~/.claude-voice/.env\n');
      }

      // Auto-download STT model if missing (small models only)
      if (startConfig.stt.provider === 'sherpa-onnx') {
        const modelId = startConfig.stt.sherpaOnnx?.model || 'whisper-tiny';
        const models = listModels();
        const model = models.find((m) => m.id === modelId);
        if (!model?.installed) {
          console.log(`\n  STT model "${modelId}" not found. Downloading...`);
          try {
            await downloadRequiredModels();
            console.log('');
          } catch {
            console.log(`  Download failed. Voice commands will not work until model is installed.`);
            console.log(`  Run manually: claude-voice model download ${modelId}\n`);
          }
        }
      }

      // Check wake word provider readiness
      if (startConfig.wakeWord.enabled && startConfig.wakeWord.provider === 'openwakeword') {
        if (!isOpenWakeWordInstalled()) {
          console.log('\n  Wake word provider "openwakeword" not installed. Attempting install...');
          try {
            await installOpenWakeWord();
          } catch {
            console.log('  Could not install openWakeWord. Falling back to Sherpa-ONNX KWS.');
            console.log('  Install manually: pip install openwakeword\n');
            setConfigValue('wakeWord.provider', 'sherpa-onnx');
          }
        }
      }
    } catch {
      // Don't block startup for validation errors
    }

    const isRunning = await checkDaemon();

    if (isRunning) {
      // Daemon is running - ensure PID file exists
      if (!readPid()) {
        const orphanPid = findDaemonByPort();
        if (orphanPid) {
          savePid(orphanPid);
          console.log(`Daemon is already running (PID: ${orphanPid}).`);
        } else {
          console.log('Daemon is already running.');
        }
      } else {
        console.log('Daemon is already running.');
      }
      return;
    }

    // Check for orphan process on port before starting
    const orphanPid = findDaemonByPort();
    if (orphanPid) {
      console.log(`Found orphan daemon (PID: ${orphanPid}). Stopping it first...`);
      try {
        process.kill(orphanPid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        // Ignore
      }
    }

    const indexPath = path.join(__dirname, 'index.js');

    if (options.foreground) {
      // Run in foreground
      console.log('Starting daemon in foreground...');
      require('./index');
    } else {
      // Run as daemon
      console.log('Starting daemon...');

      // Ensure log directory exists
      const logDir = path.dirname(LOG_FILE);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logStream = fs.openSync(LOG_FILE, 'a');

      const child: ChildProcess = spawn('node', [indexPath], {
        detached: true,
        stdio: ['ignore', logStream, logStream],
        env: process.env,
      });

      if (child.pid) {
        savePid(child.pid);
        child.unref();

        // Wait for daemon to be ready (polling with retries)
        console.log('Waiting for daemon to be ready...');
        const ready = await waitForDaemon(10000); // Up to 10 seconds

        if (ready) {
          console.log('Daemon started successfully.');
          console.log(`PID: ${child.pid}`);
          console.log(`Logs: ${LOG_FILE}`);
        } else {
          console.error('Daemon failed to start. Check logs:');
          console.error(`  tail -f ${LOG_FILE}`);
          deletePid();
          process.exit(1);
        }
      }
    }
  });

program
  .command('stop')
  .description('Stop the voice extension daemon')
  .action(async () => {
    let pid = readPid();

    // If no PID file, try to find orphan daemon by port
    if (!pid) {
      pid = findDaemonByPort();
      if (pid) {
        console.log(`Found orphan daemon (PID: ${pid})`);
      }
    }

    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log('Daemon stopped.');
        deletePid();
      } catch {
        console.log('Daemon was not running.');
        deletePid();
      }
    } else {
      console.log('No daemon running.');
    }
  });

program
  .command('restart')
  .description('Restart the voice extension daemon')
  .action(async () => {
    // Try to stop by PID file first
    let pid = readPid();

    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log('Stopping daemon...');
        deletePid();
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        // Already stopped
        deletePid();
      }
    }

    // Also check for orphan daemon by port
    const orphanPid = findDaemonByPort();
    if (orphanPid) {
      console.log(`Found orphan daemon (PID: ${orphanPid}). Stopping it...`);
      try {
        process.kill(orphanPid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        // Ignore
      }
    }

    // Start again
    console.log('Starting daemon...');
    loadEnvVars();

    const indexPath = path.join(__dirname, 'index.js');
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logStream = fs.openSync(LOG_FILE, 'a');

    const child: ChildProcess = spawn('node', [indexPath], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: process.env,
    });

    if (child.pid) {
      savePid(child.pid);
      child.unref();

      // Wait for daemon to be ready (polling with retries)
      console.log('Waiting for daemon to be ready...');
      const ready = await waitForDaemon(10000);

      if (ready) {
        console.log('Daemon restarted successfully.');
        console.log(`PID: ${child.pid}`);
      } else {
        console.error('Daemon failed to start. Check logs:');
        console.error(`  tail -f ${LOG_FILE}`);
        deletePid();
        process.exit(1);
      }
    }
  });

program
  .command('status')
  .description('Check daemon status and show configuration')
  .action(async () => {
    const isRunning = await checkDaemon();
    const config = loadConfig();

    console.log('\n  Claude Voice Extension Status\n');
    console.log(`  Daemon: ${isRunning ? '\x1b[32mRunning\x1b[0m' : '\x1b[31mStopped\x1b[0m'}`);

    if (isRunning) {
      // Get detailed status from daemon
      const statusPromise = new Promise<void>((resolve) => {
        const req = http.get(`${API_URL}/status`, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const status = JSON.parse(data);
              console.log(`  TTS: ${status.tts.provider} (${status.tts.ready ? 'ready' : 'not ready'})`);
              console.log(`  STT: ${status.stt.provider} (${status.stt.ready ? 'ready' : 'not ready'})`);
              console.log(`  Wake Word: ${status.wakeWord.enabled ? 'enabled' : 'disabled'}`);
            } catch {
              // Ignore parse errors
            }
            resolve();
          });
        });
        req.on('error', () => resolve());
        req.setTimeout(2000, () => {
          req.destroy();
          resolve();
        });
      });
      await statusPromise;
    } else {
      console.log(`  TTS: ${config.tts.provider}`);
      console.log(`  STT: ${config.stt.provider}`);
      console.log(`  Wake Word: ${config.wakeWord.enabled ? 'enabled' : 'disabled'}`);
    }

    console.log(`  Hooks: ${checkHooksInstalled() ? 'installed' : 'not installed'}`);
    console.log(`  Config: ${getConfigPath()}`);
    console.log('');
  });

// ============================================================================
// Setup Command
// ============================================================================

program
  .command('setup')
  .description('Interactive setup wizard')
  .action(async () => {
    const inquirer = await import('inquirer');
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    console.log(chalk.bold.blue('\n  Claude Voice Extension Setup\n'));

    const config = loadConfig();
    const caps = getPlatformCapabilities();
    const nativeTTS = caps.platform === 'darwin' ? 'macos-say' : 'espeak';
    const nativeTTSLabel = caps.platform === 'darwin' ? 'macOS Say' : 'espeak';

    // Quick system check
    const { tools: missingTools, commands: installCommands } = detectMissingTools();
    if (missingTools.length > 0) {
      console.log(chalk.yellow(`  Missing tools: ${missingTools.join(', ')}`));
      installCommands.forEach(cmd => console.log(chalk.cyan(`    ${cmd}`)));
      console.log('');
    }

    // Main preset selection
    const mainChoice = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'preset',
        message: 'How would you like to set up Claude Voice?',
        choices: [
          {
            name: `Just Works (recommended) - ${nativeTTSLabel} TTS + local STT, no API keys`,
            value: 'native',
          },
          {
            name: 'Better Quality - Piper neural TTS + larger Whisper model',
            value: 'local',
          },
          {
            name: 'Cloud (Best Quality) - OpenAI TTS + STT (requires API key)',
            value: 'cloud',
          },
          {
            name: 'Custom - Configure each provider manually',
            value: 'custom',
          },
        ],
        default: 'native',
      },
    ]);

    if (mainChoice.preset === 'native') {
      // ── Preset: Just Works ──
      console.log(chalk.bold('\n  Preset: Just Works\n'));

      config.tts.provider = nativeTTS as 'macos-say' | 'espeak';
      config.tts.autoSpeak = true;
      config.stt.provider = 'sherpa-onnx';
      config.stt.sherpaOnnx = { model: 'whisper-tiny' };
      config.wakeWord.enabled = true;
      // Smart wake word: prefer openWakeWord when available
      if (isOpenWakeWordInstalled()) {
        config.wakeWord.provider = 'openwakeword';
        config.wakeWord.openwakeword = { model: 'hey_jarvis', threshold: 0.5, debug: false };
      } else {
        config.wakeWord.provider = 'sherpa-onnx';
      }
      if (!config.voiceOutput) {
        config.voiceOutput = { enabled: true, abstractMarker: '<!-- TTS -->', maxAbstractLength: 200, promptTemplate: null };
      }
      config.voiceOutput.enabled = true;
      config.notifications.enabled = true;

      const wakeWordLabel1 = config.wakeWord.provider === 'openwakeword' ? 'openWakeWord' : 'Sherpa-ONNX KWS';
      console.log(`  TTS: ${nativeTTSLabel} (instant, no downloads)`);
      console.log('  STT: Sherpa-ONNX whisper-tiny (75MB)');
      console.log(`  Wake Word: ${wakeWordLabel1}\n`);

      // Download whisper-tiny if needed
      const models = listModels();
      const tinyModel = models.find((m) => m.id === 'whisper-tiny');
      if (!tinyModel?.installed) {
        const dlAnswer = await inquirer.default.prompt([
          {
            type: 'confirm',
            name: 'download',
            message: 'Download whisper-tiny STT model now? (75MB, needed for voice commands)',
            default: true,
          },
        ]);
        if (dlAnswer.download) {
          const spinner = ora('Downloading whisper-tiny model (75MB)...').start();
          try {
            await downloadModel('whisper-tiny');
            spinner.succeed('STT model ready');
          } catch {
            spinner.fail('Download failed. Run later: claude-voice model download whisper-tiny');
          }
        }
      } else {
        console.log(chalk.green('  STT model already installed'));
      }
    } else if (mainChoice.preset === 'local') {
      // ── Preset: Better Quality ──
      console.log(chalk.bold('\n  Preset: Better Quality (Local)\n'));

      config.tts.provider = 'piper';
      config.tts.piper = { voice: 'en_US-joe-medium', speaker: 0 };
      config.tts.autoSpeak = true;
      config.stt.provider = 'sherpa-onnx';
      config.stt.sherpaOnnx = { model: 'whisper-small' };
      config.wakeWord.enabled = true;
      // Smart wake word: prefer openWakeWord when available
      if (isOpenWakeWordInstalled()) {
        config.wakeWord.provider = 'openwakeword';
        config.wakeWord.openwakeword = { model: 'hey_jarvis', threshold: 0.5, debug: false };
      } else {
        config.wakeWord.provider = 'sherpa-onnx';
      }
      if (!config.voiceOutput) {
        config.voiceOutput = { enabled: true, abstractMarker: '<!-- TTS -->', maxAbstractLength: 200, promptTemplate: null };
      }
      config.voiceOutput.enabled = true;
      config.notifications.enabled = true;

      const wakeWordLabel2 = config.wakeWord.provider === 'openwakeword' ? 'openWakeWord' : 'Sherpa-ONNX KWS';
      console.log('  TTS: Piper (high-quality neural voices)');
      console.log('  STT: Sherpa-ONNX whisper-small (488MB, best accuracy)');
      console.log(`  Wake Word: ${wakeWordLabel2}\n`);

      // Check Piper readiness
      if (!isPiperInstalled()) {
        console.log(chalk.yellow('  Piper TTS is not installed yet.'));
        console.log(chalk.cyan('  After setup, run: claude-voice local --download\n'));
      }

      // Download whisper-small if needed
      const models = listModels();
      const smallModel = models.find((m) => m.id === 'whisper-small');
      if (!smallModel?.installed) {
        const dlAnswer = await inquirer.default.prompt([
          {
            type: 'confirm',
            name: 'download',
            message: 'Download whisper-small STT model now? (488MB)',
            default: true,
          },
        ]);
        if (dlAnswer.download) {
          const spinner = ora('Downloading whisper-small model (488MB)...').start();
          try {
            await downloadModel('whisper-small');
            spinner.succeed('STT model ready');
          } catch {
            spinner.fail('Download failed. Run later: claude-voice model download whisper-small');
          }
        }
      } else {
        console.log(chalk.green('  STT model already installed'));
      }
    } else if (mainChoice.preset === 'cloud') {
      // ── Preset: Cloud ──
      console.log(chalk.bold('\n  Preset: Cloud (Best Quality)\n'));

      config.tts.provider = 'openai';
      config.tts.openai = { model: 'tts-1', voice: 'nova', speed: 1.0 };
      config.tts.autoSpeak = true;
      config.stt.provider = 'openai';
      config.wakeWord.enabled = true;
      // Smart wake word: prefer openWakeWord when available
      if (isOpenWakeWordInstalled()) {
        config.wakeWord.provider = 'openwakeword';
        config.wakeWord.openwakeword = { model: 'hey_jarvis', threshold: 0.5, debug: false };
      } else {
        config.wakeWord.provider = 'sherpa-onnx';
      }
      if (!config.voiceOutput) {
        config.voiceOutput = { enabled: true, abstractMarker: '<!-- TTS -->', maxAbstractLength: 200, promptTemplate: null };
      }
      config.voiceOutput.enabled = true;
      config.notifications.enabled = true;

      const wakeWordLabel3 = config.wakeWord.provider === 'openwakeword' ? 'openWakeWord' : 'Sherpa-ONNX KWS';
      console.log('  TTS: OpenAI (requires API key)');
      console.log('  STT: OpenAI Whisper API (requires API key)');
      console.log(`  Wake Word: ${wakeWordLabel3} (local)\n`);

      // Ask for API key
      loadEnvVars();
      const hasKey = !!process.env.OPENAI_API_KEY;
      if (!hasKey) {
        const apiKeyAnswer = await inquirer.default.prompt([
          {
            type: 'password',
            name: 'apiKey',
            message: 'Enter your OpenAI API key (or press Enter to skip):',
          },
        ]);

        if (apiKeyAnswer.apiKey) {
          const envPath = getEnvFilePath();
          const envDir = path.dirname(envPath);
          if (!fs.existsSync(envDir)) {
            fs.mkdirSync(envDir, { recursive: true });
          }
          // Append or create .env
          let envContent = '';
          if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
            if (!envContent.endsWith('\n')) envContent += '\n';
          }
          envContent += `OPENAI_API_KEY=${apiKeyAnswer.apiKey}\n`;
          fs.writeFileSync(envPath, envContent);
          console.log(chalk.green(`\n  API key saved to ${envPath}\n`));
        } else {
          console.log(chalk.yellow('\n  No API key provided. Set it later in ~/.claude-voice/.env\n'));
        }
      } else {
        console.log(chalk.green('  OpenAI API key already configured'));
      }
    } else {
      // ── Custom Setup ──
      console.log(chalk.bold('\n  Custom Setup\n'));

      const ttsChoices = [];
      if (caps.nativeTTS) {
        ttsChoices.push({
          name: `${caps.nativeTTSCommand} (built-in, instant)`,
          value: nativeTTS,
        });
      }
      ttsChoices.push(
        { name: 'Piper (local, high quality neural voices)', value: 'piper' },
        { name: 'OpenAI TTS (cloud, requires API key)', value: 'openai' },
        { name: 'ElevenLabs (cloud, requires API key)', value: 'elevenlabs' },
        { name: 'Disabled', value: 'disabled' }
      );

      const customAnswers = await inquirer.default.prompt([
        {
          type: 'list',
          name: 'ttsProvider',
          message: 'TTS Provider:',
          choices: ttsChoices,
          default: config.tts.provider,
        },
        {
          type: 'list',
          name: 'sttProvider',
          message: 'STT Provider:',
          choices: [
            { name: 'Sherpa-ONNX (local, offline)', value: 'sherpa-onnx' },
            { name: 'OpenAI Whisper API (cloud)', value: 'openai' },
            { name: 'Local Whisper (Python)', value: 'whisper-local' },
            { name: 'Disabled', value: 'disabled' },
          ],
          default: config.stt.provider,
        },
        {
          type: 'list',
          name: 'sttModel',
          message: 'Whisper model size:',
          choices: [
            { name: 'whisper-tiny (75MB, fast)', value: 'whisper-tiny' },
            { name: 'whisper-base (142MB, better)', value: 'whisper-base' },
            { name: 'whisper-small (488MB, best)', value: 'whisper-small' },
          ],
          default: config.stt.sherpaOnnx?.model || 'whisper-tiny',
          when: (answers: { sttProvider: string }) => answers.sttProvider === 'sherpa-onnx',
        },
        {
          type: 'input',
          name: 'language',
          message: 'Language code (en, tr, de, fr, es, etc.):',
          default: config.stt.language,
        },
        {
          type: 'confirm',
          name: 'wakeWord',
          message: 'Enable wake word detection?',
          default: config.wakeWord.enabled,
        },
        {
          type: 'list',
          name: 'wakeWordProvider',
          message: 'Wake word engine:',
          choices: [
            { name: 'openWakeWord (recommended, requires Python)', value: 'openwakeword' },
            { name: 'Sherpa-ONNX KWS (no Python needed, lower accuracy)', value: 'sherpa-onnx' },
            { name: 'Picovoice (best accuracy, requires API key)', value: 'picovoice' },
          ],
          default: isOpenWakeWordInstalled() ? 'openwakeword' : 'sherpa-onnx',
          when: (a: { wakeWord: boolean }) => a.wakeWord === true,
        },
      ]);

      const answers = customAnswers as Record<string, string | boolean>;
      config.tts.provider = answers.ttsProvider as typeof config.tts.provider;
      config.tts.autoSpeak = true;
      config.stt.provider = answers.sttProvider as typeof config.stt.provider;
      config.stt.language = answers.language as string;
      if (answers.sttModel) {
        config.stt.sherpaOnnx = { model: answers.sttModel as typeof config.stt.sherpaOnnx.model };
      }
      config.wakeWord.enabled = answers.wakeWord as boolean;
      if (answers.wakeWord && answers.wakeWordProvider) {
        config.wakeWord.provider = answers.wakeWordProvider as typeof config.wakeWord.provider;
        if (answers.wakeWordProvider === 'openwakeword') {
          config.wakeWord.openwakeword = { model: 'hey_jarvis', threshold: 0.5, debug: false };
        }
      } else {
        config.wakeWord.provider = 'sherpa-onnx';
      }
      if (!config.voiceOutput) {
        config.voiceOutput = { enabled: true, abstractMarker: '<!-- TTS -->', maxAbstractLength: 200, promptTemplate: null };
      }
      config.voiceOutput.enabled = true;
      config.notifications.enabled = true;
    }

    // If openWakeWord chosen but not installed, offer to install
    if (config.wakeWord.enabled && config.wakeWord.provider === 'openwakeword' && !isOpenWakeWordInstalled()) {
      const owwAnswer = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'install',
          message: 'openWakeWord not installed. Install now? (pip install openwakeword)',
          default: true,
        },
      ]);
      if (owwAnswer.install) {
        const owwSpinner = ora('Installing openWakeWord...').start();
        try {
          await installOpenWakeWord();
          owwSpinner.succeed('openWakeWord installed');
        } catch {
          owwSpinner.fail('Failed to install openWakeWord. Falling back to Sherpa-ONNX KWS.');
          config.wakeWord.provider = 'sherpa-onnx';
        }
      } else {
        console.log(chalk.yellow('  Falling back to Sherpa-ONNX KWS for wake word detection.'));
        config.wakeWord.provider = 'sherpa-onnx';
      }
    }

    // Install hooks if needed
    console.log('');
    if (!checkHooksInstalled()) {
      const hookSpinner = ora('Installing Claude Code hooks...').start();
      try {
        installHooksHelper();
        hookSpinner.succeed('Hooks installed');
      } catch (error) {
        hookSpinner.fail('Failed to install hooks');
        console.error(error);
      }
    } else {
      console.log(chalk.green('  Hooks already installed'));
    }

    // Save configuration
    const saveSpinner = ora('Saving configuration...').start();
    saveConfig(config);
    saveSpinner.succeed('Configuration saved');

    // Summary
    console.log(chalk.bold.green('\n  Setup Complete!\n'));
    console.log('  Your configuration:');
    console.log(`    TTS: ${config.tts.provider}`);
    console.log(`    STT: ${config.stt.provider}`);
    console.log(`    Wake Word: ${config.wakeWord.enabled ? config.wakeWord.provider : 'disabled'}`);

    console.log(chalk.bold('\n  Next Steps:\n'));
    console.log('    1. Start daemon:  claude-voice start');
    console.log('    2. Test TTS:      claude-voice test-tts "Hello world"');
    console.log('    3. Say "Jarvis" followed by your command\n');
  });

// ============================================================================
// Doctor Command
// ============================================================================

program
  .command('doctor')
  .description('Diagnose issues, check dependencies, and auto-fix')
  .action(async () => {
    const inquirer = await import('inquirer');
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    console.log(chalk.bold('\n  Claude Voice Extension - System Check\n'));

    const issues: { label: string; fix?: string; autoFix?: () => Promise<void> }[] = [];

    // Check Node.js version
    let spinner = ora('Checking Node.js version...').start();
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (major >= 18) {
      spinner.succeed(`Node.js: ${nodeVersion}`);
    } else {
      spinner.fail(`Node.js: ${nodeVersion} (requires >= 18.0.0)`);
      issues.push({ label: 'Node.js version too old', fix: 'Install Node.js 18+' });
    }

    // Check platform
    spinner = ora('Checking platform...').start();
    const caps = getPlatformCapabilities();
    if (caps.platform !== 'unsupported') {
      const displayInfo = caps.isWayland ? ' (Wayland)' : caps.platform === 'linux' ? ' (X11)' : '';
      spinner.succeed(`Platform: ${caps.platform}${displayInfo}`);
    } else {
      spinner.warn(`Platform: ${process.platform} (not fully supported)`);
    }

    // Check system tools (Linux and macOS)
    if (caps.platform === 'linux' || caps.platform === 'darwin') {
      spinner = ora('Checking system tools...').start();
      const { tools: missingTools, commands: installCommands } = detectMissingTools();
      if (missingTools.length === 0) {
        spinner.succeed('System tools: all installed');
      } else {
        spinner.warn(`System tools: missing ${missingTools.join(', ')}`);
        console.log(chalk.dim('    Install with:'));
        installCommands.forEach(cmd => console.log(chalk.dim(`      ${cmd}`)));
        issues.push({ label: `Missing tools: ${missingTools.join(', ')}`, fix: installCommands.join(' && ') });
      }
    }

    // Check native TTS
    spinner = ora('Checking native TTS...').start();
    if (caps.nativeTTS) {
      spinner.succeed(`Native TTS: ${caps.nativeTTSCommand}`);
    } else {
      spinner.warn('Native TTS: not available');
      if (caps.platform === 'linux') {
        issues.push({ label: 'espeak not installed', fix: 'sudo apt install espeak-ng' });
      }
    }

    // Check terminal injection
    spinner = ora('Checking terminal injection...').start();
    if (caps.terminalInjection !== 'none') {
      spinner.succeed(`Terminal injection: ${caps.terminalInjection}`);
    } else {
      if (caps.isWayland) {
        spinner.warn('Terminal injection: not available (install dotool or ydotool)');
      } else {
        spinner.warn('Terminal injection: not available (install xdotool)');
      }
    }

    // Check config
    spinner = ora('Checking configuration...').start();
    let config;
    try {
      config = loadConfig();
      spinner.succeed(`Configuration: ${getConfigPath()}`);
      console.log(chalk.dim(`    TTS: ${config.tts.provider} | STT: ${config.stt.provider} | Wake Word: ${config.wakeWord.enabled ? config.wakeWord.provider : 'disabled'}`));
    } catch (error) {
      spinner.fail('Configuration: invalid or missing');
      issues.push({ label: 'Config invalid', fix: 'claude-voice config reset' });
    }

    // Check hooks
    spinner = ora('Checking hooks...').start();
    if (checkHooksInstalled()) {
      spinner.succeed('Hooks: installed');
    } else {
      spinner.warn('Hooks: not installed');
      issues.push({
        label: 'Hooks not installed',
        fix: 'claude-voice hooks install',
        autoFix: async () => { installHooksHelper(); },
      });
    }

    // Check API keys
    spinner = ora('Checking API keys...').start();
    loadEnvVars();
    const apiKeys = checkApiKeys();
    spinner.succeed('API Keys:');
    for (const { key, configured, source } of apiKeys) {
      const status = configured ? chalk.green('configured') : chalk.yellow('not configured');
      console.log(`    ${key}: ${status} (${source})`);
    }

    // Check STT model
    if (config && config.stt.provider === 'sherpa-onnx') {
      spinner = ora('Checking STT model...').start();
      const modelId = config.stt.sherpaOnnx?.model || 'whisper-tiny';
      const models = listModels();
      const model = models.find((m) => m.id === modelId);
      if (model?.installed) {
        spinner.succeed(`STT model: ${modelId} (installed)`);
      } else {
        spinner.warn(`STT model: ${modelId} (not downloaded)`);
        issues.push({
          label: `STT model ${modelId} not downloaded`,
          fix: `claude-voice model download ${modelId}`,
          autoFix: async () => { await downloadModel(modelId as keyof typeof SHERPA_MODELS); },
        });
      }
    }

    // Check wake word provider
    if (config && config.wakeWord.enabled) {
      spinner = ora('Checking wake word...').start();

      if (config.wakeWord.provider === 'openwakeword') {
        if (isOpenWakeWordInstalled()) {
          spinner.succeed('Wake word: openWakeWord (installed)');
        } else {
          spinner.warn('Wake word: openWakeWord (not installed)');
          issues.push({
            label: 'openWakeWord Python package not installed',
            fix: 'pip install openwakeword',
            autoFix: async () => { await installOpenWakeWord(); },
          });
        }
      } else if (config.wakeWord.provider === 'sherpa-onnx') {
        const kwsPath = path.join(
          getConfigDir(),
          'models',
          'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
        );
        if (fs.existsSync(kwsPath)) {
          spinner.succeed('Wake word: Sherpa-ONNX KWS (installed)');
          console.log(chalk.dim('    Tip: Upgrade to openWakeWord for better accuracy: claude-voice openwakeword --install'));
        } else {
          spinner.warn('Wake word: Sherpa-ONNX KWS model not downloaded');
          issues.push({
            label: 'Wake word model not downloaded',
            fix: 'claude-voice model download kws-zipformer-gigaspeech',
          });
        }
      } else if (config.wakeWord.provider === 'picovoice') {
        if (config.wakeWord.picovoice?.accessKey) {
          spinner.succeed('Wake word: Picovoice (configured)');
        } else {
          spinner.warn('Wake word: Picovoice (access key missing)');
          issues.push({ label: 'Picovoice access key not configured', fix: 'Get free key at picovoice.ai' });
        }
      } else {
        spinner.info(`Wake word: ${config.wakeWord.provider}`);
      }
    }

    // Check TTS provider readiness
    if (config) {
      spinner = ora('Checking TTS provider...').start();
      if (config.tts.provider === 'piper') {
        if (isPiperInstalled()) {
          const voices = listPiperVoices();
          const voiceId = config.tts.piper?.voice || 'en_US-joe-medium';
          const voice = voices.find((v) => v.id === voiceId);
          if (voice?.installed) {
            spinner.succeed(`TTS: Piper (voice: ${voiceId})`);
          } else {
            spinner.warn(`TTS: Piper installed but voice ${voiceId} missing`);
            issues.push({
              label: `Piper voice ${voiceId} not downloaded`,
              fix: `claude-voice voice download ${voiceId}`,
              autoFix: async () => { await downloadVoice(voiceId); },
            });
          }
        } else {
          spinner.warn('TTS: Piper not installed');
          issues.push({
            label: 'Piper TTS not installed',
            fix: 'claude-voice local --download',
          });
        }
      } else if (config.tts.provider === 'openai') {
        if (process.env.OPENAI_API_KEY) {
          spinner.succeed('TTS: OpenAI (API key configured)');
        } else {
          spinner.warn('TTS: OpenAI (API key missing)');
          issues.push({ label: 'OpenAI API key not configured', fix: 'Add OPENAI_API_KEY to ~/.claude-voice/.env' });
        }
      } else if (config.tts.provider === 'elevenlabs') {
        if (process.env.ELEVENLABS_API_KEY) {
          spinner.succeed('TTS: ElevenLabs (API key configured)');
        } else {
          spinner.warn('TTS: ElevenLabs (API key missing)');
          issues.push({ label: 'ElevenLabs API key not configured', fix: 'Add ELEVENLABS_API_KEY to ~/.claude-voice/.env' });
        }
      } else if (config.tts.provider === 'macos-say') {
        if (process.platform === 'darwin') {
          spinner.succeed('TTS: macOS Say (built-in)');
        } else {
          spinner.warn('TTS: macOS Say (not available on Linux)');
          issues.push({
            label: 'macOS Say not available on Linux',
            fix: 'claude-voice config set tts.provider=espeak',
          });
        }
      } else if (config.tts.provider === 'espeak') {
        try {
          execSync('which espeak-ng 2>/dev/null || which espeak 2>/dev/null', { stdio: 'ignore' });
          spinner.succeed('TTS: espeak (installed)');
        } catch {
          spinner.warn('TTS: espeak (not installed)');
          issues.push({ label: 'espeak not installed', fix: 'sudo apt install espeak-ng' });
        }
      } else {
        spinner.succeed(`TTS: ${config.tts.provider}`);
      }
    }

    // Check daemon
    spinner = ora('Checking daemon...').start();
    const isRunning = await checkDaemon();
    if (isRunning) {
      spinner.succeed('Daemon: running');
    } else {
      spinner.info('Daemon: not running');
    }

    // Summary and auto-fix
    console.log('');
    if (issues.length === 0) {
      console.log(chalk.bold.green('  All checks passed! Claude Voice is ready to use.\n'));
    } else {
      console.log(chalk.bold.yellow(`  Found ${issues.length} issue${issues.length > 1 ? 's' : ''}:\n`));
      issues.forEach((issue, i) => {
        console.log(`    ${i + 1}. ${issue.label}`);
        if (issue.fix) {
          console.log(chalk.dim(`       Fix: ${issue.fix}`));
        }
      });

      // Offer auto-fix for issues that support it
      const fixableIssues = issues.filter((i) => i.autoFix);
      if (fixableIssues.length > 0) {
        console.log('');
        const fixAnswer = await inquirer.default.prompt([
          {
            type: 'confirm',
            name: 'autoFix',
            message: `Auto-fix ${fixableIssues.length} issue${fixableIssues.length > 1 ? 's' : ''} now?`,
            default: true,
          },
        ]);

        if (fixAnswer.autoFix) {
          for (const issue of fixableIssues) {
            const fixSpinner = ora(`Fixing: ${issue.label}...`).start();
            try {
              await issue.autoFix!();
              fixSpinner.succeed(`Fixed: ${issue.label}`);
            } catch (error) {
              fixSpinner.fail(`Failed: ${issue.label}`);
              if (issue.fix) {
                console.log(chalk.dim(`    Manual fix: ${issue.fix}`));
              }
            }
          }
          console.log(chalk.green('\n  Auto-fix complete! Run "claude-voice doctor" again to verify.\n'));
        }
      }
      console.log('');
    }
  });

// ============================================================================
// Hooks Commands
// ============================================================================

const hooksCommand = program.command('hooks').description('Manage Claude Code hooks');

// Import shared hooks module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hooksModule = require('../scripts/install-hooks');

function installHooksHelper(): void {
  const hooksDir = path.join(__dirname, '..', 'hooks');
  hooksModule.installHooks(hooksDir);
}

hooksCommand
  .command('install')
  .description('Install Claude Code hooks')
  .action(() => {
    installHooksHelper();
    console.log('Hooks installed successfully!');
    console.log(`Settings file: ${path.join(process.env.HOME || '~', '.claude', 'settings.json')}`);
  });

hooksCommand
  .command('uninstall')
  .description('Remove Claude Code hooks')
  .action(() => {
    if (hooksModule.uninstallHooks()) {
      console.log('Hooks uninstalled successfully!');
    } else {
      console.log('No hooks found to uninstall.');
    }
  });

hooksCommand
  .command('status')
  .description('Check hooks installation status')
  .action(() => {
    const settingsFile = path.join(process.env.HOME || '~', '.claude', 'settings.json');

    if (checkHooksInstalled()) {
      console.log('Status: Installed');
      console.log(`Settings: ${settingsFile}`);
    } else {
      console.log('Status: Not installed');
    }
  });

// Keep old commands for backward compatibility
program
  .command('install-hooks')
  .description('Install Claude Code hooks (alias for: hooks install)')
  .action(() => {
    installHooksHelper();
    console.log('Hooks installed successfully!');
  });

program
  .command('uninstall-hooks')
  .description('Remove Claude Code hooks (alias for: hooks uninstall)')
  .action(() => {
    const settingsFile = path.join(process.env.HOME || '~', '.claude', 'settings.json');

    if (!fs.existsSync(settingsFile)) {
      console.log('No settings file found.');
      return;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));

      if (settings.hooks) {
        delete settings.hooks.SessionStart;
        delete settings.hooks.Stop;
        delete settings.hooks.Notification;

        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        console.log('Hooks uninstalled successfully!');
      } else {
        console.log('No hooks found to uninstall.');
      }
    } catch (error) {
      console.error('Failed to uninstall hooks:', error);
    }
  });

// ============================================================================
// Plugin Commands
// ============================================================================

const pluginCommand = program.command('plugin').description('Manage Claude Code plugin');

// Import shared plugin module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginModule = require('../scripts/install-plugin');

pluginCommand
  .command('install')
  .description('Install Claude Code plugin (voice-control skill)')
  .action(() => {
    try {
      const pluginPath = pluginModule.installPlugin(path.join(__dirname, '..'));
      console.log('Plugin installed successfully!');
      console.log(`Plugin path: ${pluginPath}`);
    } catch (error) {
      console.error('Failed to install plugin:', error);
    }
  });

pluginCommand
  .command('uninstall')
  .description('Remove Claude Code plugin')
  .action(() => {
    if (pluginModule.uninstallPlugin()) {
      console.log('Plugin uninstalled successfully!');
    } else {
      console.log('No plugin found to uninstall.');
    }
  });

pluginCommand
  .command('status')
  .description('Check plugin installation status')
  .action(() => {
    const pluginPath = pluginModule.getPluginPath();

    if (pluginModule.isPluginInstalled()) {
      console.log('Status: Installed');
      console.log(`Path: ${pluginPath}`);
    } else {
      console.log('Status: Not installed');
      console.log('Run: claude-voice plugin install');
    }
  });

// ============================================================================
// Provider Preset Commands
// ============================================================================

program
  .command('openai')
  .description('Configure OpenAI for TTS and STT (cloud-based, high quality)')
  .option('--tts-only', 'Only configure TTS provider')
  .option('--stt-only', 'Only configure STT provider')
  .option('--voice <voice>', 'TTS voice (nova, alloy, echo, fable, onyx, shimmer)', 'nova')
  .action((options) => {
    if (!options.sttOnly) {
      setConfigValue('tts.provider', 'openai');
      setConfigValue('tts.openai.voice', options.voice);
      console.log(`✓ TTS provider set to: openai (voice: ${options.voice})`);
    }
    if (!options.ttsOnly) {
      setConfigValue('stt.provider', 'openai');
      console.log('✓ STT provider set to: openai');
    }
    console.log('\nNote: OPENAI_API_KEY required in ~/.claude-voice/.env');
    console.log("Run 'claude-voice restart' to apply changes.");
  });

program
  .command('local')
  .description('Configure local/offline providers (Piper TTS + Sherpa-ONNX STT)')
  .option('--tts-only', 'Only configure TTS provider')
  .option('--stt-only', 'Only configure STT provider')
  .option('--voice <voice>', 'Piper voice ID', 'en_US-joe-medium')
  .option('--download', 'Download required models after configuring')
  .action(async (options) => {
    if (!options.sttOnly) {
      setConfigValue('tts.provider', 'piper');
      setConfigValue('tts.piper.voice', options.voice);
      console.log(`✓ TTS provider set to: piper (voice: ${options.voice})`);
    }
    if (!options.ttsOnly) {
      setConfigValue('stt.provider', 'sherpa-onnx');
      console.log('✓ STT provider set to: sherpa-onnx');
    }

    if (options.download) {
      await downloadRequiredModels();
    } else {
      console.log("\nTip: Run 'claude-voice download-models' to download required models.");
    }
    console.log("Run 'claude-voice restart' to apply changes.");
  });

program
  .command('download-models')
  .description('Download required models/voices based on current configuration')
  .action(async () => {
    console.log('Checking required models for current configuration...');
    const success = await downloadRequiredModels();
    if (success) {
      console.log('\nAll required models are ready.');
    } else {
      console.error('\nSome models failed to download. Check errors above.');
      process.exit(1);
    }
  });

// ============================================================================
// Config Commands
// ============================================================================

program
  .command('config [action] [args...]')
  .description('View or modify configuration')
  .option('-p, --path', 'Show configuration file path')
  .action((action, args, options) => {
    if (options.path) {
      console.log(getConfigPath());
      return;
    }

    if (!action) {
      // Default: show full config
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    switch (action) {
      case 'get':
        if (args.length === 0) {
          console.error('Usage: claude-voice config get <key>');
          process.exit(1);
        }
        const getValue = getConfigValue(args[0]);
        console.log(JSON.stringify(getValue, null, 2));
        break;

      case 'set':
        if (args.length === 0) {
          console.error('Usage: claude-voice config set <key>=<value>');
          process.exit(1);
        }
        const [key, ...valueParts] = args[0].split('=');
        const value = valueParts.join('=');
        setConfigValue(key, value);
        console.log(`Set ${key} = ${value}`);
        break;

      case 'reset':
        resetConfig();
        console.log('Configuration reset to defaults.');
        break;

      case 'edit':
        const editor = process.env.EDITOR || 'nano';
        const configPath = getConfigPath();
        // Ensure config file exists
        if (!fs.existsSync(configPath)) {
          saveConfig(loadConfig());
        }
        execSync(`${editor} "${configPath}"`, { stdio: 'inherit' });
        break;

      default:
        console.error(`Unknown config action: ${action}`);
        console.error('Available actions: get, set, reset, edit');
        process.exit(1);
    }
  });

// ============================================================================
// Voice Output Commands
// ============================================================================

const outputCommand = program.command('output').description('Manage voice-friendly output formatting');

outputCommand
  .command('enable')
  .description('Enable voice-friendly output formatting')
  .action(() => {
    setConfigValue('voiceOutput.enabled', true);
    console.log('Voice output formatting enabled.');
    console.log('Claude will now structure responses with TTS-friendly abstracts.');
    console.log('Note: Restart your Claude Code session for changes to take effect.');
  });

outputCommand
  .command('disable')
  .description('Disable voice-friendly output formatting')
  .action(() => {
    setConfigValue('voiceOutput.enabled', false);
    console.log('Voice output formatting disabled.');
    console.log('Claude will use normal response formatting.');
    console.log('Note: Restart your Claude Code session for changes to take effect.');
  });

outputCommand
  .command('status')
  .description('Show voice output formatting status')
  .action(() => {
    const config = loadConfig();
    const enabled = config.voiceOutput?.enabled !== false;
    console.log(`\nVoice Output Formatting: ${enabled ? '\x1b[32menabled\x1b[0m' : '\x1b[31mdisabled\x1b[0m'}`);
    console.log(`Abstract Marker: ${config.voiceOutput?.abstractMarker || '<!-- TTS -->'}`);
    console.log(`Max Abstract Length: ${config.voiceOutput?.maxAbstractLength || 200} characters`);
    console.log(`Custom Template: ${config.voiceOutput?.promptTemplate ? 'yes' : 'using default'}`);
    console.log('');
  });

outputCommand
  .command('config')
  .description('Configure voice output settings')
  .option('-m, --marker <marker>', 'Set abstract marker (default: <!-- TTS -->)')
  .option('-l, --length <length>', 'Set max abstract length in characters')
  .action((options) => {
    if (options.marker) {
      setConfigValue('voiceOutput.abstractMarker', options.marker);
      console.log(`Abstract marker set to: ${options.marker}`);
    }
    if (options.length) {
      const length = parseInt(options.length, 10);
      if (isNaN(length) || length < 50) {
        console.error('Length must be a number >= 50');
        process.exit(1);
      }
      setConfigValue('voiceOutput.maxAbstractLength', length);
      console.log(`Max abstract length set to: ${length} characters`);
    }
    if (!options.marker && !options.length) {
      console.log('Usage: claude-voice output config --marker "<!-- TTS -->" --length 200');
    }
  });

// ============================================================================
// Test Commands
// ============================================================================

program
  .command('test-tts')
  .description('Test text-to-speech')
  .argument('[text]', 'Text to speak', 'Hello! I am Claude Voice Extension.')
  .action(async (text) => {
    loadEnvVars();
    const config = loadConfig();
    const ttsManager = new TTSManager(config.tts);

    console.log(`Testing TTS with provider: ${config.tts.provider}`);
    console.log(`Speaking: "${text}"`);

    try {
      await ttsManager.speak(text);
      console.log('TTS test completed.');
    } catch (error) {
      console.error('TTS test failed:', error);
    }
  });

program
  .command('test-stt')
  .description('Test speech-to-text')
  .argument('<audio-file>', 'Path to audio file')
  .action(async (audioFile) => {
    loadEnvVars();
    const config = loadConfig();
    const sttManager = new STTManager(config.stt);

    console.log(`Testing STT with provider: ${config.stt.provider}`);
    console.log(`Audio file: ${audioFile}`);

    try {
      const transcript = await sttManager.transcribe(audioFile);
      console.log(`Transcript: "${transcript}"`);
    } catch (error) {
      console.error('STT test failed:', error);
    }
  });

program
  .command('listen')
  .description('Start listening for voice command (no wake word needed)')
  .action(async () => {
    try {
      const response = await fetch('http://127.0.0.1:3456/listen', {
        method: 'POST',
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (data.success) {
        console.log('Listening... Speak your command.');
      } else {
        console.error('Error:', data.error);
      }
    } catch {
      console.error('Daemon not running. Start with: claude-voice start');
    }
  });

program
  .command('shh')
  .alias('shut-up')
  .description('Stop TTS playback immediately')
  .action(async () => {
    try {
      const response = await fetch('http://127.0.0.1:3456/tts/stop', {
        method: 'POST',
      });
      const data = (await response.json()) as { success?: boolean };
      if (data.success) {
        console.log('TTS stopped.');
      }
    } catch {
      console.error('Daemon not running.');
    }
  });

// ============================================================================
// Utility Commands
// ============================================================================

program
  .command('voices')
  .description('List available TTS voices')
  .option('-p, --provider <provider>', 'Filter by provider')
  .action(async (options) => {
    const caps = getPlatformCapabilities();

    if (!options.provider || options.provider === 'macos-say') {
      if (caps.platform === 'darwin') {
        console.log('\nmacOS Say Voices:');
        try {
          const output = execSync('say -v "?"', { encoding: 'utf-8' });
          const voices = output
            .split('\n')
            .filter((line) => line.trim())
            .slice(0, 20); // Show first 20
          voices.forEach((v) => console.log(`  ${v}`));
          if (output.split('\n').length > 20) {
            console.log('  ... (run "say -v ?" for full list)');
          }
        } catch {
          console.log('  Unable to list voices');
        }
      }
    }

    if (!options.provider || options.provider === 'openai') {
      console.log('\nOpenAI TTS Voices:');
      console.log('  alloy, echo, fable, onyx, nova, shimmer');
    }

    if (!options.provider || options.provider === 'elevenlabs') {
      console.log('\nElevenLabs Voices:');
      console.log('  Configure voice ID in config: tts.elevenlabs.voiceId');
      console.log('  Browse voices at: https://elevenlabs.io/voice-library');
    }

    console.log('');
  });

program
  .command('devices')
  .description('List available audio input devices')
  .action(async () => {
    console.log('\nAudio Input Devices:\n');

    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        // macOS: Use system_profiler to list audio devices
        const output = execSync('system_profiler SPAudioDataType 2>/dev/null', { encoding: 'utf-8' });
        const lines = output.split('\n');
        let deviceIndex = 0;

        for (const line of lines) {
          // Look for device names (indented lines with colons)
          if (line.includes('Input Source:') || line.includes('Default Input Device:')) {
            const match = line.match(/:\s*(.+)$/);
            if (match) {
              console.log(`  [${deviceIndex}] ${match[1].trim()}`);
              deviceIndex++;
            }
          }
        }

        if (deviceIndex === 0) {
          // Fallback: just show default device info
          console.log('  [0] Built-in Microphone (default)');
        }
      } else if (platform === 'linux') {
        // Linux: Use arecord -l
        const output = execSync('arecord -l 2>/dev/null', { encoding: 'utf-8' });
        const lines = output.split('\n').filter((l) => l.startsWith('card'));

        if (lines.length > 0) {
          lines.forEach((line, index) => {
            console.log(`  [${index}] ${line}`);
          });
        } else {
          console.log('  No audio input devices found.');
          console.log('  Make sure ALSA is installed: sudo apt install alsa-utils');
        }
      } else {
        console.log('  Device listing not supported on this platform.');
      }
    } catch {
      console.log('  Unable to list audio devices.');
      if (platform === 'linux') {
        console.log('  Install ALSA utils: sudo apt install alsa-utils');
      }
    }
    console.log('');
  });

program
  .command('logs')
  .description('View daemon logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Show last n lines', '50')
  .action((options) => {
    if (!fs.existsSync(LOG_FILE)) {
      console.log('No log file found.');
      return;
    }

    if (options.follow) {
      // Use tail -f
      const tail = spawn('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
      tail.on('error', () => {
        console.error('Unable to follow logs. Is tail available?');
      });
    } else {
      // Show last n lines
      try {
        const output = execSync(`tail -n ${options.lines} "${LOG_FILE}"`, { encoding: 'utf-8' });
        console.log(output);
      } catch {
        // Fallback: read entire file
        const content = fs.readFileSync(LOG_FILE, 'utf-8');
        const lines = content.split('\n').slice(-parseInt(options.lines, 10));
        console.log(lines.join('\n'));
      }
    }
  });

// ============================================================================
// Model Commands
// ============================================================================

const modelCommand = program.command('model').description('Manage STT models');

modelCommand
  .command('list')
  .description('List available and installed STT models')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    console.log(chalk.bold('\n  Available STT Models (Sherpa-ONNX)\n'));

    const models = listModels();

    for (const model of models) {
      const status = model.installed ? chalk.green('[installed]') : chalk.gray('[not installed]');
      console.log(`  ${status} ${model.id}`);
      console.log(`           ${model.name}`);
      console.log(`           Languages: ${model.languages.slice(0, 5).join(', ')}...`);
      console.log('');
    }

    console.log('  To download a model: claude-voice model download <model-id>');
    console.log('  To use a model: claude-voice config set stt.provider=sherpa-onnx');
    console.log('');
  });

modelCommand
  .command('download <model-id>')
  .description('Download an STT model')
  .action(async (modelId) => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    if (!SHERPA_MODELS[modelId as keyof typeof SHERPA_MODELS]) {
      console.error(chalk.red(`Unknown model: ${modelId}`));
      console.log('\nAvailable models:');
      Object.keys(SHERPA_MODELS).forEach((id) => console.log(`  - ${id}`));
      process.exit(1);
    }

    console.log(chalk.bold(`\n  Downloading ${modelId}...\n`));

    try {
      await downloadModel(modelId as keyof typeof SHERPA_MODELS);
      console.log(chalk.green('\n  Model downloaded successfully!'));
      console.log('\n  To use this model:');
      console.log('    claude-voice config set stt.provider=sherpa-onnx');
      console.log(`    claude-voice config set stt.sherpaOnnx.model=${modelId}`);
      console.log('');
    } catch (error) {
      console.error(chalk.red('\n  Download failed:'), error);
      process.exit(1);
    }
  });

modelCommand
  .command('remove <model-id>')
  .description('Remove an installed STT model')
  .action(async (modelId) => {
    const chalk = (await import('chalk')).default;
    const modelInfo = SHERPA_MODELS[modelId as keyof typeof SHERPA_MODELS];

    if (!modelInfo) {
      console.error(chalk.red(`Unknown model: ${modelId}`));
      process.exit(1);
    }

    const modelsDir = path.join(process.env.HOME || '~', '.claude-voice', 'models');
    const modelPath = path.join(modelsDir, modelInfo.folder);

    if (!fs.existsSync(modelPath)) {
      console.log(`Model not installed: ${modelId}`);
      return;
    }

    try {
      fs.rmSync(modelPath, { recursive: true, force: true });
      console.log(chalk.green(`Model removed: ${modelId}`));
    } catch (error) {
      console.error(chalk.red('Failed to remove model:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// Wake Word Commands (openWakeWord)
// ============================================================================

const wakeWordCommand = program.command('wakeword').description('Manage wake word detection');

wakeWordCommand
  .command('status')
  .description('Check wake word detection status')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const config = loadConfig();

    console.log(chalk.bold('\n  Wake Word Detection Status\n'));

    const enabled = config.wakeWord?.enabled !== false;
    const provider = config.wakeWord?.provider || 'sherpa-onnx';

    console.log(`  Enabled: ${enabled ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`  Provider: ${provider}`);
    console.log(`  Keyword: ${config.wakeWord?.keyword || 'jarvis'}`);

    if (provider === 'openwakeword') {
      const model = config.wakeWord?.openwakeword?.model || 'hey_jarvis';
      const threshold = config.wakeWord?.openwakeword?.threshold || 0.5;
      const installed = isOpenWakeWordInstalled();

      console.log(`\n  openWakeWord:`);
      console.log(`    Installed: ${installed ? chalk.green('yes') : chalk.yellow('no')}`);
      console.log(`    Model: ${model}`);
      console.log(`    Threshold: ${threshold}`);

      if (!installed) {
        console.log(chalk.yellow('\n  To install: claude-voice wakeword install'));
      }
    } else if (provider === 'picovoice') {
      const hasKey = !!(config.wakeWord?.picovoice?.accessKey || process.env.PICOVOICE_ACCESS_KEY);
      console.log(`\n  Picovoice:`);
      console.log(`    Access Key: ${hasKey ? chalk.green('configured') : chalk.yellow('not configured')}`);
    }

    console.log('');
  });

wakeWordCommand
  .command('install')
  .description('Install openWakeWord (Python package)')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    if (isOpenWakeWordInstalled()) {
      console.log(chalk.green('openWakeWord is already installed.'));
      return;
    }

    const spinner = ora('Installing openWakeWord...').start();

    try {
      await installOpenWakeWord();
      spinner.succeed('openWakeWord installed successfully!');
      console.log('\nTo use openWakeWord:');
      console.log('  claude-voice config set wakeWord.provider=openwakeword');
      console.log('  claude-voice restart');
    } catch (error) {
      spinner.fail('Failed to install openWakeWord');
      console.error(error);
      process.exit(1);
    }
  });

wakeWordCommand
  .command('models')
  .description('List available openWakeWord models')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    console.log(chalk.bold('\n  Available openWakeWord Models\n'));

    const models = listOpenWakeWordModels();

    for (const model of models) {
      console.log(`  ${chalk.cyan(model.id)}`);
      console.log(`    ${model.name}`);
      console.log(`    ${chalk.dim(model.description)}`);
      console.log('');
    }

    console.log('  To use a model:');
    console.log('    claude-voice config set wakeWord.provider=openwakeword');
    console.log('    claude-voice config set wakeWord.openwakeword.model=hey_jarvis');
    console.log('');
  });

wakeWordCommand
  .command('download <model-id>')
  .description('Pre-download an openWakeWord model')
  .action(async (modelId) => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    if (!OPENWAKEWORD_MODELS[modelId]) {
      console.error(chalk.red(`Unknown model: ${modelId}`));
      console.log('\nAvailable models:');
      Object.keys(OPENWAKEWORD_MODELS).forEach((id) => console.log(`  - ${id}`));
      process.exit(1);
    }

    if (!isOpenWakeWordInstalled()) {
      console.error(chalk.red('openWakeWord is not installed.'));
      console.log('Install it first: claude-voice wakeword install');
      process.exit(1);
    }

    const spinner = ora(`Downloading model: ${modelId}...`).start();

    try {
      await downloadOpenWakeWordModel(modelId);
      spinner.succeed(`Model ${modelId} downloaded successfully!`);
    } catch (error) {
      spinner.fail('Failed to download model');
      console.error(error);
      process.exit(1);
    }
  });

// Convenience command to switch to openWakeWord
program
  .command('openwakeword')
  .description('Configure openWakeWord for wake word detection (better accuracy)')
  .option('--model <model>', 'Wake word model (hey_jarvis, alexa, hey_mycroft)', 'hey_jarvis')
  .option('--threshold <threshold>', 'Detection threshold 0.0-1.0', '0.5')
  .option('--install', 'Install openWakeWord if not present')
  .action(async (options) => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    // Install if needed
    if (options.install && !isOpenWakeWordInstalled()) {
      const spinner = ora('Installing openWakeWord...').start();
      try {
        await installOpenWakeWord();
        spinner.succeed('openWakeWord installed');
      } catch (error) {
        spinner.fail('Failed to install openWakeWord');
        console.error(error);
        process.exit(1);
      }
    } else if (!isOpenWakeWordInstalled()) {
      console.warn(chalk.yellow('openWakeWord not installed. Run with --install flag.'));
    }

    // Configure
    setConfigValue('wakeWord.provider', 'openwakeword');
    setConfigValue('wakeWord.openwakeword.model', options.model);
    setConfigValue('wakeWord.openwakeword.threshold', parseFloat(options.threshold));

    console.log(chalk.green('\nopenWakeWord configured:'));
    console.log(`  Provider: openwakeword`);
    console.log(`  Model: ${options.model}`);
    console.log(`  Threshold: ${options.threshold}`);
    console.log('\nRun "claude-voice restart" to apply changes.');
  });

// ============================================================================
// Voice Commands (Piper TTS)
// ============================================================================

const voiceCommand = program.command('voice').description('Manage Piper TTS voices');

voiceCommand
  .command('list')
  .description('List available and installed Piper voices')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    console.log(chalk.bold('\n  Available Piper TTS Voices\n'));

    const voices = listPiperVoices();

    // Group by language
    const byLanguage: Record<string, typeof voices> = {};
    for (const voice of voices) {
      const lang = voice.language;
      if (!byLanguage[lang]) byLanguage[lang] = [];
      byLanguage[lang].push(voice);
    }

    for (const [lang, langVoices] of Object.entries(byLanguage)) {
      console.log(chalk.bold(`  ${lang}:`));
      for (const voice of langVoices) {
        const status = voice.installed ? chalk.green('[installed]') : chalk.gray('[available]');
        console.log(`    ${status} ${voice.id}`);
        console.log(`             ${voice.name}`);
      }
      console.log('');
    }

    console.log('  To download a voice: claude-voice voice download <voice-id>');
    console.log('  To use Piper: claude-voice config set tts.provider=piper');
    console.log('');
  });

voiceCommand
  .command('download <voice-id>')
  .description('Download a Piper TTS voice')
  .action(async (voiceId) => {
    const chalk = (await import('chalk')).default;

    console.log(chalk.bold(`\n  Downloading voice: ${voiceId}\n`));

    try {
      await downloadVoice(voiceId);
      console.log(chalk.green('\n  Voice downloaded successfully!'));
      console.log('\n  To use this voice:');
      console.log('    claude-voice config set tts.provider=piper');
      console.log(`    claude-voice config set tts.piper.voice=${voiceId}`);
      console.log('');
    } catch (error) {
      console.error(chalk.red('\n  Download failed:'), error);
      process.exit(1);
    }
  });

voiceCommand
  .command('remove <voice-id>')
  .description('Remove an installed Piper voice')
  .action(async (voiceId) => {
    const chalk = (await import('chalk')).default;

    try {
      removeVoice(voiceId);
      console.log(chalk.green(`Voice removed: ${voiceId}`));
    } catch (error) {
      console.error(chalk.red('Failed to remove voice:'), error);
      process.exit(1);
    }
  });

voiceCommand
  .command('status')
  .description('Check Piper TTS installation status')
  .action(async () => {
    const chalk = (await import('chalk')).default;

    console.log(chalk.bold('\n  Piper TTS Status\n'));

    const piperInstalled = isPiperInstalled();
    console.log(`  Piper Binary: ${piperInstalled ? chalk.green('installed') : chalk.yellow('not installed')}`);

    const voices = listPiperVoices();
    const installedVoices = voices.filter((v) => v.installed);
    console.log(`  Installed Voices: ${installedVoices.length}`);

    if (installedVoices.length > 0) {
      console.log('');
      for (const voice of installedVoices) {
        console.log(`    - ${voice.id} (${voice.language})`);
      }
    }

    const config = loadConfig();
    console.log(`\n  Current Provider: ${config.tts.provider}`);
    if (config.tts.provider === 'piper') {
      console.log(`  Current Voice: ${config.tts.piper?.voice || 'not set'}`);
    }

    console.log('');
  });

program.parse();
