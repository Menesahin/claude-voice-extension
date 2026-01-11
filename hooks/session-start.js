#!/usr/bin/env node
/**
 * Claude Code Hook: SessionStart
 *
 * This hook runs when a Claude Code session starts.
 * It verifies the voice extension daemon is running and starts it if needed.
 * Respects user configuration.
 */

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_URL = 'http://127.0.0.1:3456';
const CONFIG_FILE = path.join(os.homedir(), '.claude-voice', 'config.json');
const ENV_FILE = path.join(os.homedir(), '.claude-voice', '.env');
const LOG_FILE = path.join(os.homedir(), '.claude-voice', 'daemon.log');
const PID_FILE = path.join(os.homedir(), '.claude-voice', 'daemon.pid');
const USER_VOICE_PROMPT = path.join(os.homedir(), '.claude-voice', 'voice-prompt.md');
const DEFAULT_VOICE_PROMPT = path.join(__dirname, '..', 'config', 'voice-prompt.md');

// Load environment variables from .env file
function loadEnvVars() {
  try {
    if (fs.existsSync(ENV_FILE)) {
      const content = fs.readFileSync(ENV_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Z_]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          if (!process.env[key]) {
            process.env[key] = value.replace(/^["']|["']$/g, '');
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

// Load configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Use defaults
  }
  return {
    wakeWord: {
      enabled: true,
      keyword: 'jarvis'
    },
    voiceOutput: {
      enabled: true,
      abstractMarker: '<!-- TTS -->',
      maxAbstractLength: 200,
      promptTemplate: null
    }
  };
}

// Load voice prompt template for TTS-friendly output
function loadVoicePrompt(config) {
  try {
    let template;

    // Priority: config.promptTemplate > user file > default file
    if (config.voiceOutput?.promptTemplate) {
      template = config.voiceOutput.promptTemplate;
    } else if (fs.existsSync(USER_VOICE_PROMPT)) {
      template = fs.readFileSync(USER_VOICE_PROMPT, 'utf-8');
    } else if (fs.existsSync(DEFAULT_VOICE_PROMPT)) {
      template = fs.readFileSync(DEFAULT_VOICE_PROMPT, 'utf-8');
    } else {
      return null;
    }

    // Replace template variables
    const marker = config.voiceOutput?.abstractMarker || '<!-- TTS -->';
    const maxLength = config.voiceOutput?.maxAbstractLength || 200;

    return template
      .replace(/\{\{MARKER\}\}/g, marker)
      .replace(/\{\{MAX_LENGTH\}\}/g, String(maxLength));
  } catch {
    return null;
  }
}

async function checkDaemon() {
  return new Promise((resolve) => {
    const req = http.get(`${API_URL}/status`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          resolve(status.status === 'running');
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startDaemon() {
  const daemonPath = path.join(__dirname, '..', 'dist', 'index.js');

  // Ensure log directory exists
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logStream = fs.openSync(LOG_FILE, 'a');

  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    env: process.env
  });

  // Save PID file so `claude-voice stop` can find the process
  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid));
  }

  child.unref();

  // Wait for daemon to start
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await checkDaemon()) {
      return true;
    }
  }

  return false;
}

async function main() {
  // Load environment variables
  loadEnvVars();

  // Load configuration
  const config = loadConfig();

  // Read hook input from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  // Check if daemon is running
  const isRunning = await checkDaemon();

  let additionalContext = '';
  const wakeWordEnabled = config.wakeWord?.enabled !== false;
  const keyword = config.wakeWord?.keyword || 'jarvis';
  const capitalizedKeyword = keyword.charAt(0).toUpperCase() + keyword.slice(1);

  if (isRunning) {
    if (wakeWordEnabled) {
      additionalContext = `[Voice Extension] Voice interface active. Say "${capitalizedKeyword}" to start speaking.`;
    } else {
      additionalContext = '[Voice Extension] Voice interface active.';
    }
  } else {
    // Try to start the daemon
    const started = await startDaemon();
    if (started) {
      if (wakeWordEnabled) {
        additionalContext = `[Voice Extension] Voice interface started. Say "${capitalizedKeyword}" to start speaking.`;
      } else {
        additionalContext = '[Voice Extension] Voice interface started.';
      }
    } else {
      additionalContext = '[Voice Extension] Voice interface not available. Run: claude-voice start';
    }
  }

  // Inject voice output formatting instructions if enabled
  if (config.voiceOutput?.enabled !== false) {
    const voicePrompt = loadVoicePrompt(config);
    if (voicePrompt) {
      additionalContext += '\n\n' + voicePrompt;
    }
  }

  // Output hook response
  const response = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext
    }
  };

  console.log(JSON.stringify(response));
}

main().catch(() => {
  console.log(JSON.stringify({}));
  process.exit(0); // Don't fail the hook
});
