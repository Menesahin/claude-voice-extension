#!/usr/bin/env node
/**
 * Claude Code Hook: Notification
 *
 * This hook runs when Claude Code sends notifications.
 * It provides voice alerts for important events like permission prompts.
 * Respects user configuration for notifications.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_URL = 'http://127.0.0.1:3456';
const CONFIG_FILE = path.join(os.homedir(), '.claude-voice', 'config.json');

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
    notifications: {
      enabled: true,
      permissionPrompt: true,
      idlePrompt: true,
      customMessages: {
        permissionPrompt: 'Claude needs your permission.',
        idlePrompt: 'Claude is waiting for your input.'
      }
    }
  };
}

async function sendToTTS(text, priority = false) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ text, priority });

    const req = http.request(`${API_URL}/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data, 'utf8')
      },
      timeout: 3000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response);
        } catch {
          resolve({ success: false });
        }
      });
    });

    req.on('error', () => resolve({ success: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false });
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  const config = loadConfig();

  // Check if notifications are enabled
  if (!config.notifications || !config.notifications.enabled) {
    console.log(JSON.stringify({}));
    return;
  }

  // Read hook input from stdin with timeout
  let input = '';
  const stdinTimeout = setTimeout(() => {
    console.log(JSON.stringify({}));
    process.exit(0);
  }, 5000);

  try {
    for await (const chunk of process.stdin) {
      input += chunk;
    }
  } finally {
    clearTimeout(stdinTimeout);
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({}));
    return;
  }
  const { notification_type } = hookData;

  // Handle permission prompts
  if (notification_type === 'permission_prompt') {
    if (config.notifications.permissionPrompt !== false) {
      const message = config.notifications.customMessages?.permissionPrompt ||
                     'Claude needs your permission.';
      try {
        await sendToTTS(message, true); // priority = true (interrupt)
      } catch {
        // Silently fail
      }
    }
  }
  // Handle idle prompts
  else if (notification_type === 'idle_prompt') {
    if (config.notifications.idlePrompt !== false) {
      const message = config.notifications.customMessages?.idlePrompt ||
                     'Claude is waiting for your input.';
      try {
        await sendToTTS(message, false);
      } catch {
        // Silently fail
      }
    }
  }

  // Output empty response
  console.log(JSON.stringify({}));
}

main().catch(() => {
  console.log(JSON.stringify({}));
  process.exit(0); // Don't fail the hook
});
