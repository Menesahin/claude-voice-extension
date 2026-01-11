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
  const skillDir = path.join(pluginDir, 'skills', 'voice-control');

  // Create directories
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });

  // Source paths
  const sourcePluginJson = path.join(sourceDir, 'plugin', 'plugin.json');
  const sourceSkillMd = path.join(sourceDir, 'plugin', 'skills', 'voice-control', 'SKILL.md');

  // Destination paths
  const destPluginJson = path.join(manifestDir, 'plugin.json');
  const destSkillMd = path.join(skillDir, 'SKILL.md');

  // Copy plugin.json
  if (fs.existsSync(sourcePluginJson)) {
    fs.copyFileSync(sourcePluginJson, destPluginJson);
  } else {
    // Create minimal manifest if source doesn't exist
    const manifest = {
      name: PLUGIN_NAME,
      version: '1.1.1',
      description: 'Voice interface for Claude Code - TTS, STT, wake word detection'
    };
    fs.writeFileSync(destPluginJson, JSON.stringify(manifest, null, 2));
  }

  // Copy SKILL.md
  if (fs.existsSync(sourceSkillMd)) {
    fs.copyFileSync(sourceSkillMd, destSkillMd);
  }

  return pluginDir;
}

/**
 * Uninstall the Claude Code plugin
 */
function uninstallPlugin() {
  const pluginDir = path.join(os.homedir(), '.claude', 'plugins', PLUGIN_NAME);

  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    return true;
  }

  return false;
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
