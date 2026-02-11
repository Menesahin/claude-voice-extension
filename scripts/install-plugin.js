#!/usr/bin/env node
/**
 * Claude Voice Extension - Plugin Installation
 *
 * Installs the claude-voice plugin to ~/.claude/plugins/
 * This enables Claude Code to discover and use the voice-control skill.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_NAME = 'claude-voice';

/**
 * Install the Claude Code plugin
 * @param {string} sourceDir - Path to the package root directory
 */
function installPlugin(sourceDir) {
  const pluginsDir = path.join(os.homedir(), '.claude', 'plugins');
  const pluginDir = path.join(pluginsDir, PLUGIN_NAME);
  const manifestDir = path.join(pluginDir, '.claude-plugin');
  const voiceControlSkillDir = path.join(pluginDir, 'skills', 'voice-control');
  const listenSkillDir = path.join(pluginDir, 'skills', 'listen');

  // Create directories
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(voiceControlSkillDir, { recursive: true });
  fs.mkdirSync(listenSkillDir, { recursive: true });

  // Source paths
  const sourcePluginJson = path.join(sourceDir, 'plugin', 'plugin.json');
  const sourceVoiceControlSkill = path.join(sourceDir, 'plugin', 'skills', 'voice-control', 'SKILL.md');
  const sourceListenSkill = path.join(sourceDir, 'plugin', 'skills', 'listen', 'SKILL.md');

  // Destination paths
  const destPluginJson = path.join(manifestDir, 'plugin.json');
  const destVoiceControlSkill = path.join(voiceControlSkillDir, 'SKILL.md');
  const destListenSkill = path.join(listenSkillDir, 'SKILL.md');

  // Copy plugin.json
  if (fs.existsSync(sourcePluginJson)) {
    fs.copyFileSync(sourcePluginJson, destPluginJson);
  } else {
    // Create minimal manifest if source doesn't exist
    const manifest = {
      name: PLUGIN_NAME,
      version: '1.5.0',
      description: 'Voice interface for Claude Code - TTS, STT, wake word detection'
    };
    fs.writeFileSync(destPluginJson, JSON.stringify(manifest, null, 2));
  }

  // Copy skills to plugin dir (namespaced: /claude-voice:skill-name)
  if (fs.existsSync(sourceVoiceControlSkill)) {
    fs.copyFileSync(sourceVoiceControlSkill, destVoiceControlSkill);
  }
  if (fs.existsSync(sourceListenSkill)) {
    fs.copyFileSync(sourceListenSkill, destListenSkill);
  }

  // Also install listen skill to ~/.claude/skills/ for direct /listen invocation
  const globalSkillsDir = path.join(os.homedir(), '.claude', 'skills', 'listen');
  fs.mkdirSync(globalSkillsDir, { recursive: true });
  if (fs.existsSync(sourceListenSkill)) {
    fs.copyFileSync(sourceListenSkill, path.join(globalSkillsDir, 'SKILL.md'));
  }

  return pluginDir;
}

/**
 * Uninstall the Claude Code plugin
 */
function uninstallPlugin() {
  const pluginDir = path.join(os.homedir(), '.claude', 'plugins', PLUGIN_NAME);
  const globalListenSkill = path.join(os.homedir(), '.claude', 'skills', 'listen');
  let removed = false;

  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    removed = true;
  }

  if (fs.existsSync(globalListenSkill)) {
    fs.rmSync(globalListenSkill, { recursive: true, force: true });
    removed = true;
  }

  return removed;
}

/**
 * Check if the plugin is installed
 */
function isPluginInstalled() {
  const pluginDir = path.join(os.homedir(), '.claude', 'plugins', PLUGIN_NAME);
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

  return fs.existsSync(manifestPath);
}

/**
 * Get plugin installation path
 */
function getPluginPath() {
  return path.join(os.homedir(), '.claude', 'plugins', PLUGIN_NAME);
}

module.exports = {
  installPlugin,
  uninstallPlugin,
  isPluginInstalled,
  getPluginPath,
  PLUGIN_NAME
};
