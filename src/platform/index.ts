import { execSync } from 'child_process';
import * as os from 'os';

export type Platform = 'darwin' | 'linux' | 'unsupported';

export interface PlatformCapabilities {
  platform: Platform;
  nativeTTS: boolean;
  nativeTTSCommand: string;
  audioPlayer: string;
  terminalInjection: 'applescript' | 'xdotool' | 'ydotool' | 'none';
  defaultTerminal: string;
  supportsWakeWord: boolean;
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
    };
  }

  if (platform === 'linux') {
    // Determine terminal injection method
    let terminalInjection: 'xdotool' | 'ydotool' | 'none' = 'none';
    if (hasCommand('xdotool')) {
      terminalInjection = 'xdotool';
    } else if (hasCommand('ydotool')) {
      terminalInjection = 'ydotool';
    }

    // Determine audio player
    let audioPlayer = '';
    if (hasCommand('ffplay')) {
      audioPlayer = 'ffplay';
    } else if (hasCommand('aplay')) {
      audioPlayer = 'aplay';
    } else if (hasCommand('paplay')) {
      audioPlayer = 'paplay';
    }

    return {
      platform: 'linux',
      nativeTTS: hasCommand('espeak') || hasCommand('espeak-ng'),
      nativeTTSCommand: hasCommand('espeak-ng') ? 'espeak-ng' : 'espeak',
      audioPlayer,
      terminalInjection,
      defaultTerminal: process.env.TERM_PROGRAM || 'gnome-terminal',
      supportsWakeWord: true,
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
  };
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
    if (!caps.nativeTTS) {
      instructions.push('Install espeak for TTS: sudo apt install espeak');
    }
    if (caps.terminalInjection === 'none') {
      instructions.push('Install xdotool for terminal injection: sudo apt install xdotool');
    }
    if (!caps.audioPlayer) {
      instructions.push('Install ffmpeg for audio playback: sudo apt install ffmpeg');
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
