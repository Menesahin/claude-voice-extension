import { execSync } from 'child_process';
import * as os from 'os';

export type Platform = 'darwin' | 'linux' | 'unsupported';

export interface PlatformCapabilities {
  platform: Platform;
  nativeTTS: boolean;
  nativeTTSCommand: string;
  audioPlayer: string;
  terminalInjection: 'applescript' | 'xdotool' | 'dotool' | 'ydotool' | 'wtype' | 'none';
  defaultTerminal: string;
  supportsWakeWord: boolean;
  isWayland: boolean;
}

export interface MissingToolsResult {
  tools: string[];
  commands: string[];
}

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  const platform = os.platform();
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

/**
 * Check if a command is available in PATH
 */
export function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if running on Wayland
 */
export function isWayland(): boolean {
  return process.env.XDG_SESSION_TYPE === 'wayland';
}

/**
 * Get platform-specific capabilities
 */
export function getPlatformCapabilities(): PlatformCapabilities {
  const platform = getPlatform();

  if (platform === 'darwin') {
    return {
      platform: 'darwin',
      nativeTTS: true,
      nativeTTSCommand: 'say',
      audioPlayer: 'afplay',
      terminalInjection: 'applescript',
      defaultTerminal: process.env.TERM_PROGRAM === 'iTerm.app' ? 'iTerm' : 'Terminal',
      supportsWakeWord: true,
      isWayland: false,
    };
  }

  if (platform === 'linux') {
    const wayland = isWayland();

    // Determine terminal injection method
    let terminalInjection: 'xdotool' | 'dotool' | 'ydotool' | 'wtype' | 'none' = 'none';
    if (wayland) {
      // Wayland: prefer dotool (simplest, no daemon), then ydotool
      if (hasCommand('dotool')) {
        terminalInjection = 'dotool';
      } else if (hasCommand('ydotool')) {
        terminalInjection = 'ydotool';
      } else if (hasCommand('wtype') && hasCommand('wl-copy')) {
        terminalInjection = 'wtype';  // May not work on GNOME
      }
    } else {
      // X11: prefer xdotool
      if (hasCommand('xdotool')) {
        terminalInjection = 'xdotool';
      } else if (hasCommand('dotool')) {
        terminalInjection = 'dotool';
      } else if (hasCommand('ydotool')) {
        terminalInjection = 'ydotool';
      }
    }

    // Determine audio player
    let audioPlayer = '';
    if (hasCommand('paplay')) {
      audioPlayer = 'paplay';
    } else if (hasCommand('aplay')) {
      audioPlayer = 'aplay';
    } else if (hasCommand('ffplay')) {
      audioPlayer = 'ffplay';
    }

    return {
      platform: 'linux',
      nativeTTS: hasCommand('espeak') || hasCommand('espeak-ng'),
      nativeTTSCommand: hasCommand('espeak-ng') ? 'espeak-ng' : 'espeak',
      audioPlayer,
      terminalInjection,
      defaultTerminal: process.env.TERM_PROGRAM || 'gnome-terminal',
      supportsWakeWord: true,
      isWayland: wayland,
    };
  }

  return {
    platform: 'unsupported',
    nativeTTS: false,
    nativeTTSCommand: '',
    audioPlayer: '',
    terminalInjection: 'none',
    defaultTerminal: '',
    supportsWakeWord: false,
    isWayland: false,
  };
}

/**
 * Find Python 3.9-3.13 for Piper TTS
 */
export function findCompatiblePython(): { found: boolean; version?: string; path?: string } {
  const candidates = [
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3.12',
    '/usr/local/bin/python3.11',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ];

  for (const python of candidates) {
    try {
      const version = execSync(`${python} --version 2>&1`, { encoding: 'utf-8' });
      const match = version.match(/Python 3\.(\d+)/);
      if (match) {
        const minor = parseInt(match[1], 10);
        if (minor >= 9 && minor <= 13) {
          return { found: true, version: `3.${minor}`, path: python };
        }
      }
    } catch {
      // Continue to next candidate
    }
  }
  return { found: false };
}

/**
 * Detect missing system tools required for full functionality
 */
export function detectMissingTools(): MissingToolsResult {
  const platform = getPlatform();
  const missing: string[] = [];
  const commands: string[] = [];

  if (platform === 'darwin') {
    // Python for Piper TTS
    const pythonInfo = findCompatiblePython();
    if (!pythonInfo.found) {
      missing.push('Python 3.9-3.13 (for Piper TTS)');
      commands.push('brew install python@3.12');
    }

    // sox for wake word recording
    if (!hasCommand('rec')) {
      missing.push('sox (for wake word)');
      commands.push('brew install sox');
    }
  }

  if (platform === 'linux') {
    // Audio recording
    if (!hasCommand('arecord')) {
      missing.push('arecord');
      commands.push('sudo apt install alsa-utils');
    }

    // Audio playback (at least one needed)
    if (!hasCommand('paplay') && !hasCommand('aplay') && !hasCommand('ffplay')) {
      missing.push('audio player (paplay/aplay/ffplay)');
      commands.push('sudo apt install pulseaudio-utils');
    }

    // Terminal injection
    const wayland = isWayland();
    if (wayland) {
      // dotool or ydotool needed for Wayland terminal injection
      if (!hasCommand('dotool') && !hasCommand('ydotool')) {
        missing.push('dotool or ydotool (for terminal injection)');
        commands.push('# Option 1: dotool (recommended - no daemon needed)');
        commands.push('sudo usermod -aG input $USER  # then logout/login');
        commands.push('# Install from: https://git.sr.ht/~geb/dotool');
        commands.push('# Option 2: ydotool');
        commands.push('# sudo apt install ydotool && systemctl --user enable --now ydotoold');
      }
      // wl-copy is needed for clipboard fallback
      if (!hasCommand('wl-copy')) {
        missing.push('wl-copy');
        commands.push('sudo apt install wl-clipboard');
      }
    } else {
      if (!hasCommand('xdotool') && !hasCommand('dotool')) {
        missing.push('xdotool');
        commands.push('sudo apt install xdotool');
      }
    }
  }

  // Deduplicate commands
  return { tools: missing, commands: [...new Set(commands)] };
}

/**
 * Get platform-specific installation instructions
 */
export function getInstallInstructions(): string[] {
  const platform = getPlatform();
  const caps = getPlatformCapabilities();
  const instructions: string[] = [];

  if (platform === 'darwin') {
    if (!caps.nativeTTS) {
      instructions.push('macOS should have native TTS - check system settings');
    }
  }

  if (platform === 'linux') {
    const { tools, commands } = detectMissingTools();
    if (tools.length > 0) {
      instructions.push(`Missing tools: ${tools.join(', ')}`);
      commands.forEach(cmd => instructions.push(cmd));
    }
  }

  if (platform === 'unsupported') {
    instructions.push('This platform is not fully supported. Some features may not work.');
  }

  return instructions;
}

/**
 * Check if the platform is supported
 */
export function isPlatformSupported(): boolean {
  return getPlatform() !== 'unsupported';
}

/**
 * Get a summary of platform status
 */
export function getPlatformSummary(): string {
  const caps = getPlatformCapabilities();
  const lines: string[] = [];

  lines.push(`Platform: ${caps.platform}`);
  lines.push(`Native TTS: ${caps.nativeTTS ? caps.nativeTTSCommand : 'not available'}`);
  lines.push(`Audio Player: ${caps.audioPlayer || 'not available'}`);
  lines.push(`Terminal Injection: ${caps.terminalInjection}`);
  lines.push(`Wake Word Support: ${caps.supportsWakeWord ? 'yes' : 'no'}`);

  return lines.join('\n');
}
