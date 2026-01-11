# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Run with ts-node (no build needed)
npm run lint           # ESLint on src/**/*.ts
npm test               # Jest tests
npm link               # Link globally after build for local testing
```

## Architecture Overview

Claude Voice Extension is a daemon-based voice interface for Claude Code providing TTS, STT, and wake word detection. It integrates via Claude Code's hooks system.

### System Layers

```
┌─────────────────────────────────────────────────────────────┐
│  CLI (src/cli.ts) - Commander-based, 50+ commands           │
├─────────────────────────────────────────────────────────────┤
│  Daemon Core (src/index.ts) - Orchestrates all services     │
├─────────────────────────────────────────────────────────────┤
│  HTTP Server (src/server.ts) - Express on :3456             │
├──────────────────────┬──────────────────────────────────────┤
│  TTSManager          │  STTManager          │ WakeWord      │
│  (src/tts/index.ts)  │  (src/stt/index.ts)  │ Detector      │
├──────────────────────┼──────────────────────┼───────────────┤
│  Providers:          │  Providers:          │ sherpa-onnx   │
│  - macos-say         │  - sherpa-onnx       │ KWS model     │
│  - openai            │  - whisper-local     │               │
│  - elevenlabs        │  - openai            │               │
│  - piper             │                      │               │
└──────────────────────┴──────────────────────┴───────────────┘
```

### Key Data Flows

**Voice Input**: Wake word detected → Record command → STT transcribe → AppleScript inject into terminal

**Voice Output**: Claude responds → stop.js hook → Extract abstract (before `<!-- TTS -->`) → Clean text → HTTP POST to /tts → TTSManager queues → Provider speaks

**Tool Announcements**: Tool executes → post-tool-use.js hook → Summarize result → POST to /tts

### Provider Pattern

Managers (TTSManager, STTManager) use factory pattern to instantiate providers based on config:

```typescript
// Both follow this interface pattern
interface Provider {
  name: string;
  speak(text: string): Promise<void>;  // or transcribe(audioPath): Promise<string>
  stop(): void;
  isReady(): boolean;
}
```

Providers are in `src/tts/providers/` and `src/stt/providers/`. Each handles its own dependencies (API keys, Python venvs, native commands).

### Hooks System (`hooks/`)

Hooks integrate with Claude Code via `~/.claude/settings.json`. They receive JSON on stdin, return JSON on stdout.

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start.js` | Session begins | Auto-start daemon, inject voice prompt |
| `stop.js` | Response complete | Extract text for TTS |
| `post-tool-use.js` | After tool runs | Announce tool completion |
| `notification.js` | Permission prompts | Voice alerts |

**Critical pattern**: All hooks catch errors and return empty `{}` to avoid breaking Claude Code sessions.

### Configuration (`src/config.ts`)

- User config: `~/.claude-voice/config.json`
- Defaults: `config/default.json`
- Deep merge strategy, in-memory caching
- Dot-notation access: `getConfigValue('tts.provider')`, `setConfigValue('stt.language', 'tr')`

Call `clearConfigCache()` to force reload after external config changes.

#### Config Structure

```
tts.provider          # piper | macos-say | openai | elevenlabs | espeak | disabled
tts.autoSpeak         # true - auto-speak Claude responses
tts.maxSpeechLength   # 1500 - max chars to speak
tts.skipCodeBlocks    # true - skip code in TTS
tts.piper.voice       # en_US-joe-medium
tts.openai.voice      # nova | alloy | echo | fable | onyx | shimmer
tts.macos.voice       # Samantha
tts.macos.rate        # 200 (words per minute)

stt.provider          # sherpa-onnx | openai | whisper-local | disabled
stt.language          # en (ISO code)
stt.sherpaOnnx.model  # whisper-tiny | whisper-base | whisper-small

wakeWord.enabled      # true
wakeWord.keyword      # jarvis
wakeWord.sensitivity  # 0.5 (0.0-1.0)
wakeWord.playSound    # true - play Ping/Pop sounds

voiceOutput.enabled        # false - TTS-friendly abstracts
voiceOutput.abstractMarker # <!-- TTS -->
voiceOutput.maxAbstractLength # 200

toolTTS.enabled       # false - announce tool completions
toolTTS.mode          # summarize | completion
toolTTS.tools.*       # per-tool toggle (Read, Grep, Bash, Write, Edit, etc.)

recording.sampleRate      # 16000
recording.silenceThreshold # 3500 (ms to detect end of speech)
recording.silenceAmplitude # 500 (amplitude threshold)
recording.maxDuration     # 30000 (max recording ms)

server.port           # 3456
server.host           # 127.0.0.1
debug                 # false
```

### Important File Locations

| Path | Purpose |
|------|---------|
| `~/.claude-voice/config.json` | User configuration |
| `~/.claude-voice/.env` | API keys (OPENAI_API_KEY, ELEVENLABS_API_KEY) |
| `~/.claude-voice/models/` | STT models (Whisper ONNX) |
| `~/.claude-voice/voices/` | Piper TTS voices |
| `~/.claude-voice/daemon.log` | Daemon logs |
| `~/.claude-voice/daemon.pid` | PID for daemon management |
| `~/.claude-voice/piper/` | Piper Python venv |

## Non-Obvious Design Decisions

1. **Daemon spawning**: CLI spawns daemon with `detached: true` + `child.unref()`. PID file enables stop/restart.

2. **Manager reinitialization**: Server reinitializes TTS/STT managers on config change via POST /config, allowing hot-swap without restart.

3. **Wake word encoding**: Keywords in `keywords.txt` use model-specific BPE tokenization. "jarvis" = `▁JA R VI S`. Cannot add arbitrary custom keywords.

4. **Silence detection**: Uses RMS amplitude + time threshold. Configurable via `recording.silenceThreshold` (ms) and `recording.silenceAmplitude`.

5. **Piper TTS**: Manages its own Python venv in `~/.claude-voice/piper/`. Downloads ONNX models from HuggingFace. Multi-speaker support via `speaker` index.

6. **Terminal injection**: macOS only via AppleScript. Includes 0.1s delays to prevent race conditions. Falls back between Terminal.app and iTerm.

7. **Tool summarizers** (post-tool-use.js): Custom logic per tool type - Bash detects git/npm commands, Grep counts matches, Read identifies file types by extension.

8. **TTS queue**: TTSManager has priority queue. `speak(text, priority=true)` clears queue and plays immediately.

## Platform Support

| Feature | macOS | Linux |
|---------|-------|-------|
| TTS | say, piper, openai | espeak, piper, openai |
| STT | sherpa-onnx, openai | sherpa-onnx, openai |
| Wake word | sox (rec) | arecord |
| Terminal inject | AppleScript | xdotool (limited) |
| Audio playback | afplay | ffplay, aplay, paplay |

## Key Dependencies

- `sherpa-onnx-node` + platform packages: Local STT and wake word
- `commander`: CLI framework
- `express`: HTTP API server
- `openai`: OpenAI SDK for TTS/STT
- Python 3.9+: Required for Piper TTS

## CLI Commands Reference

### Daemon Management
```bash
claude-voice start [-f]       # Start daemon (-f for foreground)
claude-voice stop             # Stop daemon
claude-voice restart          # Restart daemon
claude-voice status           # Check daemon status and providers
```

### Setup & Diagnostics
```bash
claude-voice setup            # Interactive setup wizard
claude-voice doctor           # Full system diagnostics
```

### Configuration
```bash
claude-voice config                    # View full configuration
claude-voice config get <key>          # Get value (e.g., tts.provider)
claude-voice config set <key>=<value>  # Set value (e.g., stt.language=tr)
claude-voice config reset              # Reset to defaults
claude-voice config edit               # Open in $EDITOR
```

### Hooks
```bash
claude-voice hooks install    # Install Claude Code hooks
claude-voice hooks uninstall  # Remove hooks
claude-voice hooks status     # Check hooks installation
```

### Plugin
```bash
claude-voice plugin install   # Install Claude Code plugin (skill)
claude-voice plugin uninstall # Remove plugin
claude-voice plugin status    # Check plugin installation
```

### Voice Output (TTS-friendly formatting)
```bash
claude-voice output enable    # Enable <!-- TTS --> abstract extraction
claude-voice output disable   # Disable voice output formatting
claude-voice output status    # Show current settings
claude-voice output config    # Configure (--length, --marker)
```

### STT Models (Sherpa-ONNX)
```bash
claude-voice model list              # List available/installed models
claude-voice model download <id>     # Download model (whisper-tiny/base/small)
claude-voice model remove <id>       # Remove installed model
```

### TTS Voices (Piper)
```bash
claude-voice voice list              # List available/installed voices
claude-voice voice download <id>     # Download voice
claude-voice voice remove <id>       # Remove installed voice
claude-voice voice status            # Show current voice info
```

### Testing
```bash
claude-voice test-tts [text]         # Test TTS with optional text
claude-voice test-stt <file>         # Test STT transcription
```

### Utilities
```bash
claude-voice voices           # List system TTS voices (macOS say)
claude-voice devices          # List audio input devices
claude-voice logs             # View daemon logs
claude-voice logs -f          # Follow logs (tail -f)
```
