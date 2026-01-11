#!/usr/bin/env node
/**
 * Claude Voice Extension - Hooks Installation
 *
 * Shared module for installing Claude Code hooks.
 * Used by both postinstall.js and cli.ts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Install Claude Code hooks to ~/.claude/settings.json
 * @param {string} hooksDir - Path to the hooks directory
 */
function installHooks(hooksDir) {
  const claudeSettingsDir = path.join(os.homedir(), '.claude');
  const settingsFile = path.join(claudeSettingsDir, 'settings.json');

  // Ensure directory exists
  if (!fs.existsSync(claudeSettingsDir)) {
    fs.mkdirSync(claudeSettingsDir, { recursive: true });
  }

  // Load existing settings or create new
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch {
      // Start fresh if corrupted
    }
  }

  // Define hooks
  const hooks = {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${path.join(hooksDir, 'session-start.js')}"`,
            timeout: 10,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${path.join(hooksDir, 'stop.js')}"`,
            timeout: 10,
          },
        ],
      },
    ],
    Notification: [
      {
        matcher: 'permission_prompt|idle_prompt',
        hooks: [
          {
            type: 'command',
            command: `node "${path.join(hooksDir, 'notification.js')}"`,
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${path.join(hooksDir, 'post-tool-use.js')}"`,
            timeout: 5,
          },
        ],
      },
    ],
  };

  // Merge hooks
  settings.hooks = {
    ...(settings.hooks || {}),
    ...hooks,
  };

  // Save settings
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

  return settingsFile;
}

/**
 * Uninstall Claude Code hooks from ~/.claude/settings.json
 */
function uninstallHooks() {
  const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');

  if (!fs.existsSync(settingsFile)) {
    return false;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));

    if (settings.hooks) {
      delete settings.hooks.SessionStart;
      delete settings.hooks.Stop;
      delete settings.hooks.Notification;
      delete settings.hooks.PostToolUse;

      // Remove hooks object if empty
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Check if hooks are installed
 */
function areHooksInstalled() {
  const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');

  if (!fs.existsSync(settingsFile)) {
    return false;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return !!(settings.hooks && settings.hooks.SessionStart);
  } catch {
    return false;
  }
}

module.exports = { installHooks, uninstallHooks, areHooksInstalled };
