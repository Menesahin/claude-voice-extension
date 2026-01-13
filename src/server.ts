import express, { Request, Response, NextFunction } from 'express';
import { loadConfig, saveConfig, Config } from './config';
import { TTSManager } from './tts';
import { STTManager } from './stt';
import { IWakeWordDetector } from './wake-word';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Maximum sizes for request bodies
const MAX_JSON_SIZE = '1mb';
const MAX_AUDIO_SIZE = '50mb';
const MAX_TEXT_LENGTH = 10000;

const app = express();
app.use(express.json({ limit: MAX_JSON_SIZE }));
app.use(express.raw({ type: 'audio/*', limit: MAX_AUDIO_SIZE }));

/**
 * Validate file path to prevent path traversal attacks
 * Only allows paths within temp directory or home directory
 */
function isValidAudioPath(audioPath: string): boolean {
  if (!audioPath || typeof audioPath !== 'string') {
    return false;
  }

  const normalizedPath = path.normalize(audioPath);
  const tempDir = os.tmpdir();
  const homeDir = os.homedir();

  // Path must be within temp or home directory
  const isInTemp = normalizedPath.startsWith(tempDir);
  const isInHome = normalizedPath.startsWith(homeDir);

  if (!isInTemp && !isInHome) {
    return false;
  }

  // Check for path traversal sequences
  if (normalizedPath.includes('..')) {
    return false;
  }

  // Validate file extension
  const ext = path.extname(normalizedPath).toLowerCase();
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

    // Validate text length
    if (text.length > MAX_TEXT_LENGTH) {
      res.status(400).json({ error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` });
      return;
    }

    await ttsManager.speak(text, priority === 'high');
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

    const transcript = await sttManager.transcribe(audioPath);

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

// Set TTS provider
app.post('/tts/provider', (req: Request, res: Response) => {
  const { provider } = req.body;

  if (!['macos-say', 'openai', 'elevenlabs'].includes(provider)) {
    res.status(400).json({ error: 'Invalid provider' });
    return;
  }

  saveConfig({ tts: { ...loadConfig().tts, provider } });
  initializeManagers();

  res.json({ success: true, provider });
});

// Set STT provider
app.post('/stt/provider', (req: Request, res: Response) => {
  const { provider } = req.body;

  if (!['whisper-local', 'openai'].includes(provider)) {
    res.status(400).json({ error: 'Invalid provider' });
    return;
  }

  saveConfig({ stt: { ...loadConfig().stt, provider } });
  initializeManagers();

  res.json({ success: true, provider });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
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
