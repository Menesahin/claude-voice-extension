# Claude Voice Extension

[![npm version](https://img.shields.io/npm/v/claude-voice)](https://www.npmjs.com/package/claude-voice)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/claude-voice)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)]()

Voice interface for Claude Code CLI. Speak commands, hear responses.

<!-- Demo GIF placeholder - replace with actual recording -->
<!-- ![Demo](docs/demo.gif) -->

**Features:**

- Speaks Claude's responses aloud (Text-to-Speech)
- Transcribes your voice commands (Speech-to-Text)
- Hands-free with wake word detection ("Jarvis")
- Works offline with local providers - no API keys required
- Deep integration with Claude Code via hooks system

## Quick Start

```bash
npm install -g claude-voice
claude-voice setup
claude-voice start
```

Say **"Jarvis"** followed by your command, or press **Cmd+Shift+Space** (macOS) / **Ctrl+Shift+Space** (Linux).

## How It Works

```
You speak              Claude Voice            Claude Code
    |                       |                       |
    |--- "Jarvis..." -----> |                       |
    |    (wake word)        |--- transcribe ------> |
    |                       |      (STT)            |
    |                       |                       |
    |                       | <---- response ------ |
    | <-- speaks aloud ---- |                       |
    |        (TTS)          |                       |
```

**Claude Code Integration:**

| Hook | Purpose |
|------|---------|
| `session-start` | Auto-starts daemon when Claude Code launches |
| `stop` | Speaks responses when Claude finishes |
| `post-tool-use` | Announces tool completions (file reads, bash commands) |
| `notification` | Voice alerts for permission prompts |

## Providers

Choose local (free, offline) or cloud providers:

| Capability | Local (Free) | Cloud |
|------------|--------------|-------|
| Text-to-Speech | Piper, macOS Say, espeak | OpenAI TTS, ElevenLabs |
| Speech-to-Text | Sherpa-ONNX | OpenAI Whisper |
| Wake Word | Sherpa-ONNX | Picovoice Porcupine |

<details>
<summary><strong>TTS Providers</strong></summary>

### Piper (Default)

Local neural TTS with high-quality voices. No API key required.

```bash
claude-voice voice list                    # See available voices
claude-voice voice download en_US-amy-medium
claude-voice config set tts.provider=piper
```

### macOS Say

Built-in macOS speech synthesis.

```bash
claude-voice voices                        # List available voices
claude-voice config set tts.provider=macos-say
claude-voice config set tts.macos.voice=Samantha
```

### OpenAI TTS

High-quality neural voices. Requires `OPENAI_API_KEY`.

```bash
echo "OPENAI_API_KEY=sk-..." >> ~/.claude-voice/.env
claude-voice config set tts.provider=openai
claude-voice config set tts.openai.voice=nova
```

### ElevenLabs

Premium voice synthesis. Requires `ELEVENLABS_API_KEY`.

```bash
echo "ELEVENLABS_API_KEY=..." >> ~/.claude-voice/.env
claude-voice config set tts.provider=elevenlabs
```

</details>

<details>
<summary><strong>STT Providers</strong></summary>

### Sherpa-ONNX (Default)

Local Whisper models. No API key required. Supports 100+ languages.

```bash
claude-voice model list                    # Available models
claude-voice model download whisper-small  # Best accuracy (488MB)
claude-voice config set stt.provider=sherpa-onnx
claude-voice config set stt.language=en    # or: tr, de, fr, es, etc.
```

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| whisper-tiny | 75 MB | Fast | Good |
| whisper-base | 142 MB | Medium | Better |
| whisper-small | 488 MB | Slower | Best |

### OpenAI Whisper

Cloud transcription. Requires `OPENAI_API_KEY`.

```bash
claude-voice config set stt.provider=openai
```

</details>

<details>
<summary><strong>Wake Word Providers</strong></summary>

### Sherpa-ONNX (Default)

Local wake word detection. No API key required.

```bash
claude-voice config set wakeWord.provider=sherpa-onnx
claude-voice config set wakeWord.keyword=jarvis   # or: claude
```

### Picovoice Porcupine

High-accuracy wake word detection. Requires `PICOVOICE_ACCESS_KEY`.

1. Get a free access key at [Picovoice Console](https://console.picovoice.ai/)
2. Configure:

```bash
echo "PICOVOICE_ACCESS_KEY=..." >> ~/.claude-voice/.env
claude-voice config set wakeWord.provider=picovoice
claude-voice config set wakeWord.keyword=jarvis   # jarvis, computer, alexa, etc.
```

Built-in keywords: jarvis, computer, alexa, americano, blueberry, bumblebee, grapefruit, grasshopper, hey google, hey siri, ok google, picovoice, porcupine, terminator

</details>

## Configuration

Config file: `~/.claude-voice/config.json`

```bash
claude-voice config                        # View all settings
claude-voice config get tts.provider       # Get specific value
claude-voice config set tts.provider=openai # Set value
claude-voice config edit                   # Open in editor
claude-voice config reset                  # Reset to defaults
```

<details>
<summary><strong>TTS Options</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `tts.provider` | `piper` | piper, macos-say, openai, elevenlabs, espeak, disabled |
| `tts.autoSpeak` | `true` | Automatically speak Claude's responses |
| `tts.maxSpeechLength` | `5000` | Maximum characters to speak |
| `tts.skipCodeBlocks` | `true` | Skip code blocks when speaking |

</details>

<details>
<summary><strong>STT Options</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `stt.provider` | `sherpa-onnx` | sherpa-onnx, openai, whisper-local, disabled |
| `stt.language` | `en` | Language code (en, tr, de, fr, es, ja, zh, etc.) |

</details>

<details>
<summary><strong>Wake Word Options</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `wakeWord.enabled` | `true` | Enable wake word detection |
| `wakeWord.provider` | `sherpa-onnx` | sherpa-onnx or picovoice |
| `wakeWord.keyword` | `jarvis` | Wake word: jarvis, claude, computer, etc. |
| `wakeWord.sensitivity` | `0.5` | Detection sensitivity (0.0-1.0) |
| `wakeWord.playSound` | `true` | Play sound on detection |

</details>

<details>
<summary><strong>Voice Output Options</strong></summary>

When enabled, Claude formats responses with a spoken abstract before technical details.

| Option | Default | Description |
|--------|---------|-------------|
| `voiceOutput.enabled` | `false` | Enable TTS-friendly formatting |
| `voiceOutput.abstractMarker` | `<!-- TTS -->` | Marker separating spoken/technical content |
| `voiceOutput.maxAbstractLength` | `200` | Max characters for spoken abstract |

```bash
claude-voice output enable                 # Enable voice-friendly formatting
claude-voice output status                 # Check current status
```

</details>

<details>
<summary><strong>Tool Announcements</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `toolTTS.enabled` | `false` | Announce tool completions |
| `toolTTS.mode` | `summarize` | summarize or completion |
| `toolTTS.announceErrors` | `true` | Announce tool errors |

</details>

<details>
<summary><strong>Keyboard Shortcut</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `shortcut.enabled` | `false` | Enable keyboard shortcut |
| `shortcut.key` | `CommandOrControl+Shift+Space` | Key combination |

**Modifiers:** CommandOrControl, Command, Control, Shift, Alt

</details>

<details>
<summary><strong>Recording Options</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `recording.sampleRate` | `16000` | Audio sample rate (Hz) |
| `recording.silenceThreshold` | `2500` | Silence duration to stop (ms) |
| `recording.silenceAmplitude` | `500` | Amplitude threshold |
| `recording.maxDuration` | `60000` | Max recording length (ms) |

</details>

<details>
<summary><strong>Server Options</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `server.port` | `3456` | HTTP server port |
| `server.host` | `127.0.0.1` | Server host |

</details>

## CLI Commands

```bash
# Daemon Management
claude-voice start              # Start daemon
claude-voice stop               # Stop daemon
claude-voice restart            # Restart daemon
claude-voice status             # Check status

# Setup
claude-voice setup              # Interactive setup wizard
claude-voice doctor             # Diagnose issues

# Models & Voices
claude-voice model list         # List STT models
claude-voice model download <id>
claude-voice voice list         # List TTS voices
claude-voice voice download <id>

# Hooks
claude-voice hooks install      # Install Claude Code hooks
claude-voice hooks status       # Check installation

# Testing
claude-voice test-tts "Hello"   # Test text-to-speech
claude-voice test-stt file.wav  # Test speech-to-text

# Utilities
claude-voice logs               # View daemon logs
claude-voice logs -f            # Follow logs
claude-voice devices            # List audio devices
```

Run `claude-voice --help` for all 50+ commands.

## Platform Support

| Feature | macOS | Linux |
|---------|-------|-------|
| TTS | Piper, Say, OpenAI, ElevenLabs | Piper, espeak, OpenAI, ElevenLabs |
| STT | Sherpa-ONNX, OpenAI | Sherpa-ONNX, OpenAI |
| Wake Word | Sherpa-ONNX, Picovoice | Sherpa-ONNX, Picovoice |
| Keyboard Shortcut | Cmd+Shift+Space | Ctrl+Shift+Space |
| Terminal Injection | AppleScript | xdotool (X11), dotool (Wayland) |

**Requirements:**
- Node.js 18+
- Microphone access

## Troubleshooting

Run diagnostics:

```bash
claude-voice doctor
```

<details>
<summary><strong>Common Issues</strong></summary>

**Daemon won't start**
```bash
claude-voice logs              # Check logs
claude-voice start -f          # Run in foreground for debugging
```

**No audio output**
```bash
claude-voice test-tts "Hello"
claude-voice config get tts.provider
```

**Wake word not detecting**
- Check microphone permissions in System Preferences
- Run `claude-voice devices` to verify microphone
- Adjust sensitivity: `claude-voice config set wakeWord.sensitivity=0.7`

**Text not appearing in terminal**
- macOS: Allow Terminal in System Preferences > Privacy > Accessibility
- Run `claude-voice doctor` to check terminal injection status

</details>

## API Reference

<details>
<summary><strong>HTTP API (port 3456)</strong></summary>

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Daemon status and provider info |
| `/tts` | POST | Speak text `{"text": "...", "priority": false}` |
| `/tts/stop` | POST | Stop current playback |
| `/stt` | POST | Transcribe audio (multipart/form-data) |
| `/config` | GET | Get configuration |
| `/config` | POST | Update configuration |

</details>

## Contributing

Contributions are welcome.

```bash
git clone https://github.com/Menesahin/claude-voice-extension.git
cd claude-voice-extension
npm install
npm run dev
```

**Guidelines:**
- Run `npm run lint` before committing
- Add tests for new features
- Follow existing code patterns

## License

MIT License - see [LICENSE](LICENSE) for details.

---

[Documentation](https://github.com/Menesahin/claude-voice-extension#readme) |
[Issues](https://github.com/Menesahin/claude-voice-extension/issues) |
[Releases](https://github.com/Menesahin/claude-voice-extension/releases)
