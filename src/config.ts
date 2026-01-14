import * as fs from 'fs';
import * as path from 'path';

// TTS Configuration
export interface TTSConfig {
  provider: 'macos-say' | 'openai' | 'elevenlabs' | 'espeak' | 'piper' | 'disabled';
  autoSpeak: boolean;
  maxSpeechLength: number;
  skipCodeBlocks: boolean;
  macos: {
    voice: string;
    rate: number;
  };
  openai: {
    model: 'tts-1' | 'tts-1-hd';
    voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    speed: number;
  };
  elevenlabs: {
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
  };
  espeak: {
    voice: string;
    speed: number;
    pitch: number;
  };
  piper: {
    voice: string;
    speaker?: number;
  };
}

// STT Configuration
export interface STTConfig {
  provider: 'sherpa-onnx' | 'whisper-local' | 'openai' | 'disabled';
  language: string;
  sherpaOnnx: {
    model: 'whisper-tiny' | 'whisper-base' | 'whisper-small';
  };
  whisperLocal: {
    model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
    device: 'cpu' | 'cuda';
  };
  openai: {
    model: string;
  };
}

// Wake Word Configuration
export interface WakeWordConfig {
  enabled: boolean;
  provider: 'sherpa-onnx' | 'picovoice' | 'openwakeword';
  keyword: string;
  sensitivity: number;
  playSound: boolean;
  keywords: Record<string, string | string[]>;
  picovoice?: {
    accessKey?: string;
  };
  openwakeword?: {
    model?: string;
    threshold?: number;
    debug?: boolean;
  };
}

// Notifications Configuration
export interface NotificationsConfig {
  enabled: boolean;
  permissionPrompt: boolean;
  idlePrompt: boolean;
  errors: boolean;
  customMessages: {
    permissionPrompt: string;
    idlePrompt: string;
  };
}

// Voice Output Configuration (TTS-friendly abstracts)
export interface VoiceOutputConfig {
  enabled: boolean;
  abstractMarker: string;
  maxAbstractLength: number;
  promptTemplate: string | null;
}

// Tool TTS Configuration
export interface ToolTTSConfig {
  enabled: boolean;
  mode: 'completion' | 'summarize';
  tools: {
    Read: boolean;
    Grep: boolean;
    Glob: boolean;
    Bash: boolean;
    Write: boolean;
    Edit: boolean;
    MultiEdit: boolean;
    WebFetch: boolean;
    WebSearch: boolean;
    Task: boolean;
    default: boolean;
  };
  customMessages: {
    completion: string;
    error: string;
  };
  announceErrors: boolean;
  maxSummaryLength: number;
}

// Terminal Configuration
export interface TerminalConfig {
  injectionMethod: 'applescript' | 'xdotool' | 'ydotool' | 'auto';
  targetTerminal: 'Terminal' | 'iTerm' | 'auto';
  pressEnterAfterInput: boolean;
}

// Recording Configuration
export interface RecordingConfig {
  sampleRate: number;
  channels: number;
  silenceThreshold: number;
  silenceAmplitude: number;
  maxDuration: number;
  audioDevice?: number;
}

// Server Configuration
export interface ServerConfig {
  port: number;
  host: string;
}

// Shortcut Configuration
export interface ShortcutConfig {
  enabled: boolean;
  key: string;
  description?: string;
}

// Main Configuration Interface
export interface Config {
  version: number;
  tts: TTSConfig;
  stt: STTConfig;
  wakeWord: WakeWordConfig;
  notifications: NotificationsConfig;
  voiceOutput: VoiceOutputConfig;
  toolTTS: ToolTTSConfig;
  shortcut: ShortcutConfig;
  terminal: TerminalConfig;
  recording: RecordingConfig;
  server: ServerConfig;
  debug: boolean;
  logFile?: string;
}

const CONFIG_DIR = path.join(process.env.HOME || '~', '.claude-voice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENV_FILE = path.join(CONFIG_DIR, '.env');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'default.json');

let cachedConfig: Config | null = null;

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getDefaultConfig(): Config {
  const defaultConfigPath = fs.existsSync(DEFAULT_CONFIG_PATH)
    ? DEFAULT_CONFIG_PATH
    : path.join(__dirname, '..', '..', 'config', 'default.json');

  return JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
}

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const defaultConfig = getDefaultConfig();

  if (!fs.existsSync(CONFIG_FILE)) {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    cachedConfig = deepMerge(defaultConfig, userConfig) as Config;
    return cachedConfig;
  } catch (error) {
    console.warn('Failed to load user config, using defaults:', error);
    cachedConfig = defaultConfig;
    return cachedConfig;
  }
}

/**
 * Atomically write a file using temp file + rename pattern
 * This prevents corruption if the process crashes during write
 */
function atomicWriteFileSync(filePath: string, content: string, options?: fs.WriteFileOptions): void {
  const tempPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tempPath, content, options);
    fs.renameSync(tempPath, filePath); // Atomic on POSIX systems
  } catch (error) {
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export function saveConfig(config: Partial<Config>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  const currentConfig = loadConfig();
  const newConfig = deepMerge(currentConfig, config);

  // Use atomic write to prevent corruption
  atomicWriteFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
  cachedConfig = newConfig;
}

export function resetConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
  cachedConfig = null;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getEnvPath(): string {
  return ENV_FILE;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get a nested config value by dot-notation path
 * e.g., getConfigValue('tts.provider') returns 'macos-say'
 */
export function getConfigValue(keyPath: string): unknown {
  const config = loadConfig();
  const keys = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = config;

  for (const key of keys) {
    if (value === undefined || value === null) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

/**
 * Set a nested config value by dot-notation path
 * e.g., setConfigValue('tts.provider', 'openai')
 */
export function setConfigValue(keyPath: string, value: unknown): void {
  const config = loadConfig();
  const keys = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = config;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined) {
      current[key] = {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1];

  // Try to parse value as JSON for objects/arrays/booleans/numbers
  if (typeof value === 'string') {
    if (value === 'true') {
      current[lastKey] = true;
    } else if (value === 'false') {
      current[lastKey] = false;
    } else if (!isNaN(Number(value)) && value.trim() !== '') {
      current[lastKey] = Number(value);
    } else {
      current[lastKey] = value;
    }
  } else {
    current[lastKey] = value;
  }

  saveConfig(config);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }

  return result;
}
