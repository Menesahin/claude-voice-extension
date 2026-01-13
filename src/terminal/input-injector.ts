import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check if running on Wayland
 */
function isWayland(): boolean {
  return process.env.XDG_SESSION_TYPE === 'wayland';
}

export interface InputInjectorOptions {
  /**
   * Target terminal application
   */
  terminal?: 'Terminal' | 'iTerm' | 'auto';

  /**
   * Whether to simulate pressing Enter after typing
   */
  pressEnter?: boolean;

  /**
   * Delay between characters in milliseconds (for slow typing effect)
   */
  typingDelay?: number;
}

/**
 * Check if a command exists in PATH
 */
function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Injects text into the terminal using AppleScript on macOS or xdotool on Linux.
 * This allows voice-transcribed text to be sent to Claude Code.
 */
export class TerminalInputInjector {
  private terminal: 'Terminal' | 'iTerm';

  constructor(options: InputInjectorOptions = {}) {
    if (options.terminal === 'auto' || !options.terminal) {
      // Auto-detect: prefer iTerm if running, otherwise Terminal
      this.terminal = 'Terminal';
    } else {
      this.terminal = options.terminal;
    }
  }

  /**
   * Types text into the active terminal window
   */
  async type(text: string, pressEnter = true): Promise<void> {
    if (process.platform === 'linux') {
      return this.typeLinux(text, pressEnter);
    }

    if (process.platform !== 'darwin') {
      throw new Error('Terminal input injection is only supported on macOS and Linux');
    }

    // Escape special characters for AppleScript
    const escapedText = this.escapeForAppleScript(text);

    const script = this.generateAppleScript(escapedText, pressEnter);

    try {
      await this.runAppleScript(script);
    } catch (error) {
      // Try the other terminal app
      const alternateTerminal = this.terminal === 'Terminal' ? 'iTerm' : 'Terminal';
      const alternateScript = this.generateAppleScript(escapedText, pressEnter, alternateTerminal);

      try {
        await this.runAppleScript(alternateScript);
      } catch {
        throw new Error(`Failed to inject text into terminal: ${error}`);
      }
    }
  }

  /**
   * Runs an AppleScript, handling multi-line scripts properly
   */
  private async runAppleScript(script: string): Promise<void> {
    // Split script into lines and use multiple -e arguments
    const lines = script.split('\n').filter(line => line.trim());
    const args = lines.map(line => `-e '${line.replace(/'/g, "'\\''")}'`).join(' ');
    await execAsync(`osascript ${args}`);
  }

  /**
   * Types text character by character with a delay (for visual effect)
   */
  async typeSlowly(text: string, delayMs = 50, pressEnter = true): Promise<void> {
    for (const char of text) {
      await this.type(char, false);
      await this.delay(delayMs);
    }

    if (pressEnter) {
      await this.pressKey('return');
    }
  }

  /**
   * Simulates pressing a key
   */
  async pressKey(key: string): Promise<void> {
    if (process.platform === 'linux') {
      // Use xdotool for Linux
      if (!hasCommand('xdotool')) {
        throw new Error('xdotool not found. Install with: sudo apt install xdotool');
      }
      await execAsync(`xdotool key ${key}`);
      return;
    }

    if (process.platform !== 'darwin') {
      throw new Error('Key press simulation is only supported on macOS and Linux');
    }

    const keyCode = this.getKeyCode(key);
    const script = `
      tell application "System Events"
        key code ${keyCode}
      end tell
    `;

    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  }

  private generateAppleScript(text: string, pressEnter: boolean, terminal?: string): string {
    const app = terminal || this.terminal;

    if (app === 'iTerm') {
      return `
        tell application "iTerm"
          tell current session of current window
            write text "${text}"${pressEnter ? '' : ' without newline'}
          end tell
        end tell
      `.replace(/\n/g, ' ');
    }

    // Default: Terminal.app
    // For Terminal, we use System Events to type
    // Note: keystroke and key code must be separate statements
    // Added delay before Enter to prevent race condition
    if (pressEnter) {
      return `tell application "Terminal" to activate
delay 0.1
tell application "System Events"
keystroke "${text}"
delay 0.15
key code 36
end tell`;
    }

    return `tell application "Terminal" to activate
delay 0.1
tell application "System Events"
keystroke "${text}"
end tell`;
  }

  /**
   * Types text into the active terminal on Linux (X11 or Wayland)
   */
  private async typeLinux(text: string, pressEnter: boolean): Promise<void> {
    if (isWayland()) {
      return this.typeWayland(text, pressEnter);
    }
    return this.typeX11(text, pressEnter);
  }

  /**
   * Types text on Wayland using dotool, ydotool, wtype, or clipboard fallback
   */
  private async typeWayland(text: string, pressEnter: boolean): Promise<void> {
    // 1. Try dotool first (simplest, no daemon required)
    if (hasCommand('dotool')) {
      try {
        return await this.typeDotool(text, pressEnter);
      } catch (error) {
        console.warn('dotool failed, trying ydotool...', error);
      }
    }

    // 2. Try ydotool (works on all Wayland compositors including GNOME)
    if (hasCommand('ydotool')) {
      try {
        return await this.typeYdotool(text, pressEnter);
      } catch (error) {
        console.warn('ydotool failed, trying wtype...', error);
      }
    }

    // 3. Try wtype (doesn't work on GNOME, but works on other compositors)
    if (hasCommand('wtype') && hasCommand('wl-copy')) {
      try {
        return await this.typeWtype(text, pressEnter);
      } catch (error) {
        console.warn('wtype failed, falling back to clipboard...', error);
      }
    }

    // 4. Fallback: Copy to clipboard and notify user
    await this.copyToClipboardWayland(text);
    console.log('\n📋 Text copied to clipboard. Press Ctrl+Shift+V to paste.\n');
  }

  /**
   * Types text using dotool (simplest method, no daemon required)
   */
  private async typeDotool(text: string, pressEnter: boolean): Promise<void> {
    // Build dotool commands
    // dotool reads commands from stdin: "type <text>" and "key <keyname>"
    let commands = `type ${text}`;
    if (pressEnter) {
      commands += '\nkey Return';
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('dotool', [], { stdio: ['pipe', 'ignore', 'pipe'] });
      proc.stdin.write(commands);
      proc.stdin.end();
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`dotool exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  /**
   * Types text using ydotool (works on all Wayland compositors)
   */
  private async typeYdotool(text: string, pressEnter: boolean): Promise<void> {
    // Escape special characters for shell
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    // ydotool type with delay for reliability
    await execAsync(`ydotool type --key-delay 5 -- "${escapedText}"`);

    if (pressEnter) {
      await this.delay(50);
      // Enter key: scancode 28
      await execAsync('ydotool key 28:1 28:0');
    }
  }

  /**
   * Types text using wtype (may not work on GNOME)
   */
  private async typeWtype(text: string, pressEnter: boolean): Promise<void> {
    // Copy text to clipboard
    await this.copyToClipboardWayland(text);
    await this.delay(50);

    // Paste with Ctrl+Shift+V
    await execAsync('wtype -M ctrl -M shift -k v -m shift -m ctrl');

    if (pressEnter) {
      await this.delay(50);
      await execAsync('wtype -k Return');
    }
  }

  /**
   * Copy text to Wayland clipboard
   */
  private async copyToClipboardWayland(text: string): Promise<void> {
    if (!hasCommand('wl-copy')) {
      throw new Error('wl-copy not found. Install with: sudo apt install wl-clipboard');
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('wl-copy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin.write(text);
      proc.stdin.end();
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`wl-copy failed with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  /**
   * Types text using xdotool on X11, with dotool fallback
   */
  private async typeX11(text: string, pressEnter: boolean): Promise<void> {
    // Try dotool first if xdotool not available
    if (!hasCommand('xdotool')) {
      if (hasCommand('dotool')) {
        return await this.typeDotool(text, pressEnter);
      }
      throw new Error(
        'xdotool not found. Install it with: sudo apt install xdotool\n' +
        'Or install dotool from: https://git.sr.ht/~geb/dotool'
      );
    }

    // Escape special characters for shell
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    try {
      // First, try to find and activate a terminal window
      const terminalPatterns = [
        'gnome-terminal',
        'konsole',
        'xfce4-terminal',
        'xterm',
        'terminator',
        'alacritty',
        'kitty',
        'tilix',
        'Terminal',
      ];

      let activated = false;
      for (const pattern of terminalPatterns) {
        try {
          await execAsync(`xdotool search --name "${pattern}" windowactivate --sync 2>/dev/null`);
          activated = true;
          break;
        } catch {
          continue;
        }
      }

      if (!activated) {
        try {
          await execAsync('xdotool getactivewindow');
        } catch {
          throw new Error('No terminal window found. Please focus your terminal window.');
        }
      }

      await this.delay(100);
      await execAsync(`xdotool type --clearmodifiers "${escapedText}"`);

      if (pressEnter) {
        await execAsync('xdotool key Return');
      }
    } catch (error) {
      throw new Error(`Failed to inject text via xdotool: ${error}`);
    }
  }

  private escapeForAppleScript(text: string): string {
    return text
      .replace(/\\/g, '\\\\') // Escape backslashes first
      .replace(/"/g, '\\"') // Escape double quotes
      .replace(/\n/g, '\\n') // Escape newlines
      .replace(/\r/g, '\\r') // Escape carriage returns
      .replace(/\t/g, '\\t'); // Escape tabs
  }

  private getKeyCode(key: string): number {
    const keyCodes: Record<string, number> = {
      return: 36,
      enter: 36,
      tab: 48,
      space: 49,
      delete: 51,
      escape: 53,
      command: 55,
      shift: 56,
      capslock: 57,
      option: 58,
      control: 59,
      fn: 63,
      f1: 122,
      f2: 120,
      f3: 99,
      f4: 118,
      f5: 96,
      f6: 97,
      f7: 98,
      f8: 100,
      f9: 101,
      f10: 109,
      f11: 103,
      f12: 111,
      home: 115,
      pageup: 116,
      forwarddelete: 117,
      end: 119,
      pagedown: 121,
      left: 123,
      right: 124,
      down: 125,
      up: 126,
    };

    return keyCodes[key.toLowerCase()] || 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if we're running inside a terminal
   */
  static isInTerminal(): boolean {
    return !!(process.stdout.isTTY && (process.env.TERM || process.env.TERM_PROGRAM));
  }

  /**
   * Detect the current terminal application
   */
  static detectTerminal(): 'Terminal' | 'iTerm' | 'unknown' {
    const termProgram = process.env.TERM_PROGRAM;

    if (termProgram === 'Apple_Terminal') {
      return 'Terminal';
    }

    if (termProgram === 'iTerm.app') {
      return 'iTerm';
    }

    return 'unknown';
  }
}

/**
 * Convenience function to send voice-transcribed text to Claude Code
 */
export async function sendToClaudeCode(text: string): Promise<void> {
  const injector = new TerminalInputInjector({ terminal: 'auto' });
  await injector.type(text, true);
}
