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

      // Configure with defaults
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        config.tts = config.tts || {};
        config.tts.provider = 'piper';
        config.tts.piper = { voice: 'en_US-joe-medium', speaker: 0 };
        config.stt = config.stt || {};
        config.stt.provider = 'sherpa-onnx';
        config.stt.sherpaOnnx = config.stt.sherpaOnnx || {};
        config.stt.sherpaOnnx.model = 'whisper-small';
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        console.log('  [+] Configured defaults (Piper TTS + Whisper STT)');
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
  .description('Interactive first-run setup wizard')
  .action(async () => {
    // Dynamically import to avoid issues if not installed
    const inquirer = await import('inquirer');
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    console.log(chalk.bold.blue('\n  Welcome to Claude Voice Extension Setup!\n'));
    console.log('  This wizard will help you configure voice features for Claude Code.\n');

    const config = loadConfig();
    const caps = getPlatformCapabilities();

    // Step 0: System Requirements Check (Linux and macOS)
    if (caps.platform === 'linux' || caps.platform === 'darwin') {
      console.log(chalk.bold('  Step 0: System Requirements\n'));

      const { tools: missingTools, commands: installCommands } = detectMissingTools();

      if (missingTools.length === 0) {
        console.log(chalk.green('  ✓ All required system tools are installed\n'));
      } else {
        console.log(chalk.yellow(`  ⚠ Missing: ${missingTools.join(', ')}\n`));
        console.log('  Install with:');
        installCommands.forEach(cmd => console.log(chalk.cyan(`    ${cmd}`)));
        console.log('');

        if (caps.isWayland) {
          console.log(chalk.dim('  Note: Wayland detected. Terminal injection requires dotool or ydotool.\n'));
          console.log(chalk.dim('  dotool is recommended (simpler, no daemon needed).\n'));
        }
      }
    }

    // Step 1: Platform detection
    console.log(chalk.bold('  Step 1: Platform Detection\n'));
    console.log(`  Platform: ${caps.platform}${caps.isWayland ? ' (Wayland)' : caps.platform === 'linux' ? ' (X11)' : ''}`);
    console.log(`  Native TTS: ${caps.nativeTTS ? caps.nativeTTSCommand : 'not available'}`);
    console.log(`  Terminal Injection: ${caps.terminalInjection}\n`);

    const instructions = getInstallInstructions();
    if (instructions.length > 0 && caps.platform !== 'linux') {
      // Linux instructions are shown in Step 0
      console.log(chalk.yellow('  Missing dependencies:'));
      instructions.forEach((i) => console.log(`    - ${i}`));
      console.log('');
    }

    // Step 2: TTS Configuration
    console.log(chalk.bold('  Step 2: Text-to-Speech Configuration\n'));

    const ttsChoices = [];
    if (caps.nativeTTS) {
      ttsChoices.push({
        name: `${caps.nativeTTSCommand} (built-in, no API key)`,
        value: caps.platform === 'darwin' ? 'macos-say' : 'espeak',
      });
    }
    ttsChoices.push(
      { name: 'Piper TTS (free, local, high quality neural voices)', value: 'piper' },
      { name: 'OpenAI TTS (high quality, requires API key)', value: 'openai' },
      { name: 'ElevenLabs (premium voices, requires API key)', value: 'elevenlabs' },
      { name: 'Disabled', value: 'disabled' }
    );

    const ttsAnswers = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Which TTS provider would you like to use?',
        choices: ttsChoices,
        default: config.tts.provider,
      },
      {
        type: 'confirm',
        name: 'autoSpeak',
        message: "Automatically speak Claude's responses?",
        default: config.tts.autoSpeak,
      },
    ]);

    config.tts.provider = ttsAnswers.provider;
    config.tts.autoSpeak = ttsAnswers.autoSpeak;

    // Step 3: STT Configuration
    console.log(chalk.bold('\n  Step 3: Speech-to-Text Configuration\n'));

    const sttAnswers = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Which STT provider would you like to use?',
        choices: [
          { name: 'Sherpa-ONNX (FREE, embedded, offline)', value: 'sherpa-onnx' },
          { name: 'OpenAI Whisper API (fast, requires API key)', value: 'openai' },
          { name: 'Local Whisper (free, requires Python)', value: 'whisper-local' },
          { name: 'Disabled', value: 'disabled' },
        ],
        default: config.stt.provider,
      },
      {
        type: 'input',
        name: 'language',
        message: 'Default language code (e.g., en, tr, de):',
        default: config.stt.language,
      },
    ]);

    config.stt.provider = sttAnswers.provider;
    config.stt.language = sttAnswers.language;

    // Step 4: Wake Word
    console.log(chalk.bold('\n  Step 4: Wake Word Configuration\n'));

    const wakeWordAnswers = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enable wake word detection (say "Jarvis" to start speaking)?',
        default: config.wakeWord.enabled,
      },
      {
        type: 'confirm',
        name: 'playSound',
        message: 'Play sound when wake word is detected?',
        default: config.wakeWord.playSound,
        when: (answers: { enabled: boolean }) => answers.enabled,
      },
    ]);

    config.wakeWord.enabled = wakeWordAnswers.enabled;
    if ((wakeWordAnswers as { playSound?: boolean }).playSound !== undefined) {
      config.wakeWord.playSound = (wakeWordAnswers as { playSound?: boolean }).playSound!;
    }

    // Step 5: Voice Notifications
    console.log(chalk.bold('\n  Step 5: Voice Notifications\n'));

    const notifAnswers = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enable voice notifications (permission prompts, etc.)?',
        default: config.notifications.enabled,
      },
    ]);

    config.notifications.enabled = notifAnswers.enabled;

    // Step 6: Voice Output Formatting
    console.log(chalk.bold('\n  Step 6: Voice Output Formatting\n'));
    console.log('  This feature makes Claude structure responses with TTS-friendly summaries.');
    console.log('  Claude will add a spoken abstract at the start of each response.\n');

    const voiceOutputAnswers = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enable voice-friendly output formatting?',
        default: config.voiceOutput?.enabled !== false,
      },
    ]);

    if (!config.voiceOutput) {
      config.voiceOutput = {
        enabled: true,
        abstractMarker: '<!-- TTS -->',
        maxAbstractLength: 200,
        promptTemplate: null,
      };
    }
    config.voiceOutput.enabled = voiceOutputAnswers.enabled;

    // Step 7: Install hooks
    console.log(chalk.bold('\n  Step 7: Claude Code Integration\n'));

    const hooksInstalled = checkHooksInstalled();
    if (!hooksInstalled) {
      const hookAnswers = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'install',
          message: 'Install Claude Code hooks now?',
          default: true,
        },
      ]);

      if (hookAnswers.install) {
        const spinner = ora('Installing hooks...').start();
        try {
          installHooksHelper();
          spinner.succeed('Hooks installed successfully');
        } catch (error) {
          spinner.fail('Failed to install hooks');
          console.error(error);
        }
      }
    } else {
      console.log('  Hooks are already installed.\n');
    }

    // Save configuration
    const spinner = ora('Saving configuration...').start();
    saveConfig(config);
    spinner.succeed('Configuration saved');

    // Summary
    console.log(chalk.bold.green('\n  Setup Complete!\n'));
    console.log('  Your configuration:');
    console.log(`    TTS Provider: ${config.tts.provider}`);
    console.log(`    Auto-Speak: ${config.tts.autoSpeak ? 'enabled' : 'disabled'}`);
    console.log(`    STT Provider: ${config.stt.provider}`);
    console.log(`    Language: ${config.stt.language}`);
    console.log(`    Wake Word: ${config.wakeWord.enabled ? 'enabled' : 'disabled'}`);
    console.log(`    Notifications: ${config.notifications.enabled ? 'enabled' : 'disabled'}`);
    console.log(`    Voice Output: ${config.voiceOutput?.enabled ? 'enabled' : 'disabled'}`);

    console.log(chalk.bold('\n  Next Steps:\n'));
    console.log('    1. Start the daemon:  claude-voice start');
    console.log('    2. Test TTS:          claude-voice test-tts "Hello world"');
    console.log('    3. Check status:      claude-voice status\n');
  });

// ============================================================================
// Doctor Command
// ============================================================================

program
  .command('doctor')
  .description('Diagnose issues and check dependencies')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    console.log(chalk.bold('\n  Claude Voice Extension - System Check\n'));

    // Check Node.js version
    let spinner = ora('Checking Node.js version...').start();
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (major >= 18) {
      spinner.succeed(`Node.js: ${nodeVersion}`);
    } else {
      spinner.fail(`Node.js: ${nodeVersion} (requires >= 18.0.0)`);
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
      }
    }

    // Check native TTS
    spinner = ora('Checking native TTS...').start();
    if (caps.nativeTTS) {
      spinner.succeed(`Native TTS: ${caps.nativeTTSCommand}`);
    } else {
      spinner.warn('Native TTS: not available');
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
    try {
      const config = loadConfig();
      spinner.succeed(`Configuration: ${getConfigPath()}`);
    } catch (error) {
      spinner.fail('Configuration: invalid or missing');
    }

    // Check hooks
    spinner = ora('Checking hooks...').start();
    if (checkHooksInstalled()) {
      spinner.succeed('Hooks: installed');
    } else {
      spinner.warn('Hooks: not installed (run: claude-voice hooks install)');
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

    // Check daemon
    spinner = ora('Checking daemon...').start();
    const isRunning = await checkDaemon();
    if (isRunning) {
      spinner.succeed('Daemon: running');
    } else {
      spinner.info('Daemon: not running');
    }

    console.log('');
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
