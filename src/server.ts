import express, { Request, Response, NextFunction } from 'express';
import { loadConfig, saveConfig, Config } from './config';
import { TTSManager } from './tts';
import { STTManager } from './stt';
import { IWakeWordDetector } from './wake-word';
import { safeErrorString } from './env';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Maximum sizes for request bodies
const MAX_JSON_SIZE = '1mb';
const MAX_AUDIO_SIZE = '50mb';
const MAX_TEXT_LENGTH = 10000;

// Timeout configuration
const TTS_TIMEOUT_MS = 60000; // 60 seconds for TTS
const STT_TIMEOUT_MS = 120000; // 120 seconds for STT (larger files take longer)

/**
 * Wraps a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute

// Simple in-memory rate limiter
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let clientData = rateLimitStore.get(clientIp);

  if (!clientData || now > clientData.resetTime) {
    clientData = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(clientIp, clientData);
  } else {
    clientData.count++;
  }

  // Clean up old entries periodically (every 100 requests)
  if (rateLimitStore.size > 100) {
    for (const [ip, data] of rateLimitStore.entries()) {
      if (now > data.resetTime) {
        rateLimitStore.delete(ip);
      }
    }
  }

  if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
    });
    return;
  }

  next();
}

/**
 * Middleware to restrict access to localhost only
 * This prevents remote access to the voice extension API
 */
function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || req.socket.remoteAddress || '';

  // Allow localhost connections (IPv4 and IPv6)
  const isLocalhost =
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1' ||
    clientIp === 'localhost';

  if (!isLocalhost) {
    res.status(403).json({ error: 'Access denied. This API is only available locally.' });
    return;
  }

  next();
}

const app = express();

// Trust proxy for correct IP detection (needed when behind reverse proxy)
app.set('trust proxy', 'loopback');

app.use(express.json({ limit: MAX_JSON_SIZE }));
app.use(express.raw({ type: 'audio/*', limit: MAX_AUDIO_SIZE }));
app.use(localhostOnly);
app.use(rateLimiter);

/**
 * Validate file path to prevent path traversal attacks
 * Only allows paths within temp directory or home directory
 */
function isValidAudioPath(audioPath: string): boolean {
  if (!audioPath || typeof audioPath !== 'string') {
    return false;
  }

  // Use path.resolve() to get absolute path and eliminate traversal sequences
  const resolvedPath = path.resolve(audioPath);
  const tempDir = path.resolve(os.tmpdir());
  const homeDir = path.resolve(os.homedir());

  // Path must be strictly within temp or home directory (with path separator to prevent prefix attacks)
  const isInTemp = resolvedPath === tempDir || resolvedPath.startsWith(tempDir + path.sep);
  const isInHome = resolvedPath === homeDir || resolvedPath.startsWith(homeDir + path.sep);

  if (!isInTemp && !isInHome) {
    return false;
  }

  // Double-check for any remaining traversal sequences (defense in depth)
  if (resolvedPath.includes('..')) {
    return false;
  }

  // Validate file extension
  const ext = path.extname(resolvedPath).toLowerCase();
  const validExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm'];
  if (!validExtensions.includes(ext)) {
    return false;
  }

  return true;
}

let ttsManager: TTSManager;
let sttManager: STTManager;
let wakeWordDetector: IWakeWordDetector | null = null;

export function initializeManagers(): void {
  const config = loadConfig();
  ttsManager = new TTSManager(config.tts);
  sttManager = new STTManager(config.stt);
}

export function setWakeWordDetector(detector: IWakeWordDetector): void {
  wakeWordDetector = detector;
}

// Health check
app.get('/status', (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json({
    status: 'running',
    tts: {
      provider: config.tts.provider,
      ready: ttsManager?.isReady() ?? false,
    },
    stt: {
      provider: config.stt.provider,
      ready: sttManager?.isReady() ?? false,
    },
    wakeWord: {
      enabled: config.wakeWord.enabled,
    },
  });
});

// Text-to-Speech endpoint
app.post('/tts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, priority } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "text" field' });
      return;
    }

    // Trim and validate text
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      res.status(400).json({ error: 'Text cannot be empty or whitespace only' });
      return;
    }

    // Validate text length
    if (trimmedText.length > MAX_TEXT_LENGTH) {
      res.status(400).json({ error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` });
      return;
    }

    await withTimeout(
      ttsManager.speak(trimmedText, priority === 'high'),
      TTS_TIMEOUT_MS,
      'TTS'
    );
    res.json({ success: true, message: 'Speech queued' });
  } catch (error) {
    next(error);
  }
});

// Speech-to-Text endpoint (accepts audio file)
app.post('/stt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let audioPath: string;
    let shouldCleanup = false;

    // Handle raw audio data
    if (Buffer.isBuffer(req.body)) {
      const tempDir = os.tmpdir();
      audioPath = path.join(tempDir, `stt-${Date.now()}.wav`);
      fs.writeFileSync(audioPath, req.body);
      shouldCleanup = true;
    } else if (req.body.audioPath) {
      // Handle file path - validate to prevent path traversal
      audioPath = req.body.audioPath;

      if (!isValidAudioPath(audioPath)) {
        res.status(400).json({ error: 'Invalid audio file path' });
        return;
      }

      // Verify file exists
      if (!fs.existsSync(audioPath)) {
        res.status(404).json({ error: 'Audio file not found' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Missing audio data or audioPath' });
      return;
    }

    const transcript = await withTimeout(
      sttManager.transcribe(audioPath),
      STT_TIMEOUT_MS,
      'STT'
    );

    if (shouldCleanup) {
      try {
        fs.unlinkSync(audioPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    res.json({ success: true, transcript });
  } catch (error) {
    next(error);
  }
});

// Stop current playback
app.post('/tts/stop', (_req: Request, res: Response) => {
  ttsManager.stop();
  res.json({ success: true, message: 'Playback stopped' });
});

// Trigger listening (manual wake word alternative)
app.post('/listen', (_req: Request, res: Response) => {
  if (!wakeWordDetector) {
    res.status(503).json({ error: 'Wake word detector not initialized' });
    return;
  }
  wakeWordDetector.triggerListening();
  res.json({ success: true, message: 'Listening started' });
});

// Get current configuration
app.get('/config', (_req: Request, res: Response) => {
  const config = loadConfig();
  // Remove sensitive data
  const safeConfig = { ...config };
  res.json(safeConfig);
});

// Update configuration
app.post('/config', (req: Request, res: Response) => {
  try {
    const updates = req.body as Partial<Config>;
    saveConfig(updates);

    // Reinitialize managers with new config
    initializeManagers();

    res.json({ success: true, message: 'Configuration updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Valid providers
const VALID_TTS_PROVIDERS = ['macos-say', 'openai', 'elevenlabs', 'piper', 'espeak', 'disabled'];
const VALID_STT_PROVIDERS = ['sherpa-onnx', 'whisper-local', 'openai', 'disabled'];

// Set TTS provider
app.post('/tts/provider', (req: Request, res: Response) => {
  const { provider } = req.body;

  if (!VALID_TTS_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Invalid provider. Valid options: ${VALID_TTS_PROVIDERS.join(', ')}` });
    return;
  }

  saveConfig({ tts: { ...loadConfig().tts, provider } });
  initializeManagers();

  res.json({ success: true, provider });
});

// Set STT provider
app.post('/stt/provider', (req: Request, res: Response) => {
  const { provider } = req.body;

  if (!VALID_STT_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Invalid provider. Valid options: ${VALID_STT_PROVIDERS.join(', ')}` });
    return;
  }

  saveConfig({ stt: { ...loadConfig().stt, provider } });
  initializeManagers();

  res.json({ success: true, provider });
});

// Error handling middleware - masks sensitive data in logs
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log error with masked sensitive data
  console.error('Server error:', safeErrorString(err));
  // Return generic error to client (don't leak internal details)
  res.status(500).json({ error: 'Internal server error' });
});

export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const config = loadConfig();

    initializeManagers();

    app.listen(config.server.port, config.server.host, () => {
      console.log(`Claude Voice Extension server running at http://${config.server.host}:${config.server.port}`);
      resolve();
    });
  });
}

export { app };
