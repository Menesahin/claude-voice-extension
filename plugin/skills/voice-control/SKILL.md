---
name: claude-voice
description: Use when user asks about voice commands, TTS, STT, wake word, speech, microphone, audio, jarvis, or claude-voice CLI commands
version: 1.5.0
---

# Claude Voice Extension

Voice interface for Claude Code - TTS, STT, and wake word detection.

## Key Commands

```bash
claude-voice start / stop / restart / status   # Daemon management
claude-voice setup                             # Interactive setup wizard
claude-voice doctor                            # Diagnose issues
claude-voice listen                            # Listen for voice command (no wake word needed)
claude-voice openai                            # Use OpenAI TTS + STT (cloud)
claude-voice local --download                  # Use Piper TTS + Sherpa-ONNX STT (offline)
claude-voice openwakeword --install            # Better wake word detection
claude-voice config set <key>=<value>          # Change settings
claude-voice model list / download <id>        # STT models
claude-voice voice list / download <id>        # Piper TTS voices
claude-voice test-tts "Hello"                  # Test TTS
claude-voice logs -f                           # Follow daemon logs
```

## Configuration

Config file: `~/.claude-voice/config.json`

| Setting | Default | Options |
|---------|---------|---------|
| `tts.provider` | `macos-say` | macos-say, piper, openai, elevenlabs, espeak |
| `stt.provider` | `sherpa-onnx` | sherpa-onnx, openai, whisper-local |
| `stt.language` | `en` | Any ISO code (en, tr, de, fr, es...) |
| `wakeWord.provider` | `openwakeword` | openwakeword, sherpa-onnx, picovoice |
| `wakeWord.sensitivity` | `0.5` | 0.0 - 1.0 |
| `voiceOutput.enabled` | `false` | true/false |
| `toolTTS.enabled` | `false` | true/false |

## File Locations

- Config: `~/.claude-voice/config.json`
- API keys: `~/.claude-voice/.env`
- Models: `~/.claude-voice/models/`
- Logs: `~/.claude-voice/daemon.log`
