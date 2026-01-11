import express, { Request, Response, NextFunction } from 'express';
import { loadConfig, saveConfig, Config } from './config';
import { TTSManager } from './tts';
import { STTManager } from './stt';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'audio/*', limit: '50mb' }));

let ttsManager: TTSManager;
let sttManager: STTManager;

export function initializeManagers(): void {
  const config = loadConfig();
  ttsManager = new TTSManager(config.tts);
  sttManager = new STTManager(config.stt);
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
      // Handle file path
      audioPath = req.body.audioPath;
    } else {
      res.status(400).json({ error: 'Missing audio data or audioPath' });
      return;
    }

    const transcript = await sttManager.transcribe(audioPath);

    if (shouldCleanup) {
      fs.unlinkSync(audioPath);
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
