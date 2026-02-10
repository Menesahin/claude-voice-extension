# Claude Voice Extension

[![npm version](https://img.shields.io/npm/v/claude-voice)](https://www.npmjs.com/package/claude-voice)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-red.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)]()

Voice interface for Claude Code. Speak commands, hear responses.

```bash
npm install -g claude-voice
```

Say **"Hey Jarvis"** followed by your command. The extension auto-starts with Claude Code.

## How It Works

```
You speak → "Hey Jarvis..." → Wake word detected → STT transcribes → Claude Code receives
Claude responds → Hook captures → TTS speaks aloud → You hear the response
```

The extension integrates via Claude Code hooks: auto-start on session, speak responses, announce tool completions, and voice alerts for permission prompts.

## Providers

| | Local (Free) | Cloud |
|---|---|---|
| **TTS** | macOS Say, Piper, espeak | OpenAI, ElevenLabs |
| **STT** | Sherpa-ONNX Whisper | OpenAI Whisper |
| **Wake Word** | openWakeWord, Sherpa-ONNX | Picovoice |

**Quick presets:**

```bash
claude-voice setup              # Interactive setup wizard
claude-voice openai             # Cloud TTS + STT (requires API key)
claude-voice local --download   # Piper TTS + larger Whisper model (offline)
```

## Configuration

```bash
claude-voice config                         # View all
claude-voice config set tts.provider=openai # Set value
claude-voice config set stt.language=tr     # Change language
claude-voice config edit                    # Open in editor
```

Config file: `~/.claude-voice/config.json`

<details>
<summary><strong>All options</strong></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `tts.provider` | `macos-say` | macos-say, piper, openai, elevenlabs, espeak, disabled |
| `tts.autoSpeak` | `true` | Auto-speak Claude responses |
| `tts.maxSpeechLength` | `5000` | Max characters to speak |
| `stt.provider` | `sherpa-onnx` | sherpa-onnx, openai, whisper-local, disabled |
| `stt.language` | `en` | Language code (en, tr, de, fr, es, ja, zh...) |
| `wakeWord.enabled` | `true` | Enable wake word detection |
| `wakeWord.provider` | `openwakeword` | openwakeword, sherpa-onnx, picovoice |
| `wakeWord.sensitivity` | `0.5` | Detection sensitivity (0.0-1.0) |
| `voiceOutput.enabled` | `false` | TTS-friendly response formatting |
| `toolTTS.enabled` | `false` | Announce tool completions |
| `recording.silenceThreshold` | `3500` | Silence duration to stop recording (ms) |
| `recording.maxDuration` | `60000` | Max recording length (ms) |

</details>

## CLI Commands

```bash
# Daemon
claude-voice start / stop / restart / status

# Setup & Diagnostics
claude-voice setup                # Interactive wizard
claude-voice doctor               # Diagnose issues

# Models & Voices
claude-voice model list / download <id>     # STT models (whisper-tiny/base/small)
claude-voice voice list / download <id>     # Piper TTS voices

# Wake Word
claude-voice openwakeword --install         # Better wake word detection

# Testing
claude-voice test-tts "Hello"
claude-voice test-stt recording.wav

# Utilities
claude-voice logs -f              # Follow daemon logs
claude-voice devices              # List audio devices
```

## Platform Support

| | macOS | Linux |
|---|---|---|
| TTS | Say, Piper, OpenAI, ElevenLabs | espeak, Piper, OpenAI, ElevenLabs |
| STT | Sherpa-ONNX, OpenAI | Sherpa-ONNX, OpenAI |
| Wake Word | openWakeWord, Sherpa-ONNX, Picovoice | openWakeWord, Sherpa-ONNX, Picovoice |

**Requires:** Node.js 18+, microphone access. Python 3 recommended (for openWakeWord).

## Troubleshooting

```bash
claude-voice doctor               # Auto-diagnose and fix issues
claude-voice logs                 # Check daemon logs
claude-voice start -f             # Run in foreground for debugging
```

**Wake word not detecting?** Run `claude-voice openwakeword --install` for better accuracy.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) - Free for personal use, research, and education.

---

[Issues](https://github.com/Menesahin/claude-voice-extension/issues) | [Releases](https://github.com/Menesahin/claude-voice-extension/releases)
