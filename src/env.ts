import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.claude-voice');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

/**
 * Mask sensitive data (API keys) in strings for safe logging
 * Shows first 4 and last 4 characters only
 */
export function maskSensitiveData(text: string): string {
  if (!text) return text;

  // Pattern to match common API key formats
  const apiKeyPatterns = [
    /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI keys
    /[a-f0-9]{32}/gi,                  // ElevenLabs and similar hex keys
    /[A-Za-z0-9_-]{20,}/g,            // Generic long tokens
  ];

  let masked = text;
  for (const pattern of apiKeyPatterns) {
    masked = masked.replace(pattern, (match) => {
      if (match.length <= 8) return '****';
      return match.slice(0, 4) + '****' + match.slice(-4);
    });
  }

  return masked;
}

/**
 * Safely stringify an error for logging, masking any sensitive data
 */
export function safeErrorString(error: unknown): string {
  if (error instanceof Error) {
    return maskSensitiveData(error.message);
  }
  return maskSensitiveData(String(error));
}

export interface EnvVars {
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  PICOVOICE_ACCESS_KEY?: string;
}

/**
 * Load environment variables from:
 * 1. Process environment (highest priority)
 * 2. ~/.claude-voice/.env file
 */
export function loadEnvVars(): EnvVars {
  // Load from .env file if exists
  if (fs.existsSync(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Only set if not already in process.env
        if (!process.env[key]) {
          process.env[key] = value.replace(/^["']|["']$/g, '');
        }
      }
    }
  }

  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    PICOVOICE_ACCESS_KEY: process.env.PICOVOICE_ACCESS_KEY,
  };
}

/**
 * Save an API key to the .env file
 */
export function saveApiKey(key: keyof EnvVars, value: string): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  let content = '';
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, 'utf-8');
    // Remove existing key
    content = content
      .split('\n')
      .filter((line) => !line.startsWith(`${key}=`))
      .join('\n');
  }

  content = content.trim() + `\n${key}=${value}\n`;

  // Write with restrictive permissions (owner read/write only)
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });

  // Also set in current process
  process.env[key] = value;
}

/**
 * Remove an API key from the .env file
 */
export function removeApiKey(key: keyof EnvVars): void {
  if (!fs.existsSync(ENV_FILE)) {
    return;
  }

  const content = fs.readFileSync(ENV_FILE, 'utf-8');
  const newContent = content
    .split('\n')
    .filter((line) => !line.startsWith(`${key}=`))
    .join('\n');

  fs.writeFileSync(ENV_FILE, newContent.trim() + '\n', { mode: 0o600 });

  // Also remove from current process
  delete process.env[key];
}

/**
 * Check which API keys are configured
 */
export function checkApiKeys(): { key: keyof EnvVars; configured: boolean; source: string }[] {
  const env = loadEnvVars();
  const keys: (keyof EnvVars)[] = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'PICOVOICE_ACCESS_KEY'];

  return keys.map((key) => {
    const inEnv = !!process.env[key];
    const inFile = fs.existsSync(ENV_FILE) && fs.readFileSync(ENV_FILE, 'utf-8').includes(`${key}=`);

    return {
      key,
      configured: !!env[key],
      source: inEnv && !inFile ? 'environment' : inFile ? '.env file' : 'not configured',
    };
  });
}

/**
 * Get the .env file path
 */
export function getEnvFilePath(): string {
  return ENV_FILE;
}

/**
 * Validate an OpenAI API key by making a test request
 */
export async function validateOpenAIKey(apiKey?: string): Promise<boolean> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) return false;

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Validate an ElevenLabs API key by making a test request
 */
export async function validateElevenLabsKey(apiKey?: string): Promise<boolean> {
  const key = apiKey || process.env.ELEVENLABS_API_KEY;
  if (!key) return false;

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: {
        'xi-api-key': key,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
