---
name: claude-voice
description: Use when user asks about voice commands, TTS, STT, wake word, speech, microphone, audio, jarvis, or claude-voice CLI commands
version: 1.1.1
---

# Claude Voice Extension

Voice interface for Claude Code - TTS (text-to-speech), STT (speech-to-text), and wake word detection.

## Quick Start

```bash
claude-voice start      # Start voice daemon
claude-voice stop       # Stop daemon
claude-voice status     # Check status
claude-voice setup      # Interactive setup
```

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

## Configuration Options

Config file: `~/.claude-voice/config.json`

### TTS Settings
```
tts.provider          # piper | macos-say | openai | elevenlabs | espeak | disabled
tts.autoSpeak         # true - auto-speak Claude responses
tts.maxSpeechLength   # 1500 - max chars to speak
tts.piper.voice       # en_US-joe-medium
tts.openai.voice      # nova | alloy | echo | fable | onyx | shimmer
tts.macos.voice       # Samantha
tts.macos.rate        # 200 (words per minute)
```

### STT Settings
```
stt.provider          # sherpa-onnx | openai | whisper-local | disabled
stt.language          # en (ISO code: en, tr, de, fr, es, etc.)
stt.sherpaOnnx.model  # whisper-tiny | whisper-base | whisper-small
```

### Wake Word Settings
```
wakeWord.enabled      # true
wakeWord.keyword      # jarvis
wakeWord.sensitivity  # 0.5 (0.0-1.0)
wakeWord.playSound    # true - play Ping/Pop sounds
```

### Voice Output Settings
```
voiceOutput.enabled        # true - TTS-friendly abstracts
voiceOutput.abstractMarker # <!-- TTS -->
voiceOutput.maxAbstractLength # 200
```

### Tool TTS Settings
```
toolTTS.enabled       # true - announce tool completions
toolTTS.mode          # summarize | completion
toolTTS.tools.*       # per-tool toggle (Read, Grep, Bash, Write, Edit, etc.)
```

## File Locations

| Path | Purpose |
|------|---------|
| `~/.claude-voice/config.json` | User configuration |
| `~/.claude-voice/.env` | API keys (OPENAI_API_KEY, ELEVENLABS_API_KEY) |
| `~/.claude-voice/models/` | STT models (Whisper ONNX) |
| `~/.claude-voice/voices/` | Piper TTS voices |
| `~/.claude-voice/daemon.log` | Daemon logs |

## Platform Support

| Feature | macOS | Linux |
|---------|-------|-------|
| TTS | say, piper, openai | espeak, piper, openai |
| STT | sherpa-onnx, openai | sherpa-onnx, openai |
| Wake word | sox (rec) | arecord |
| Terminal inject | AppleScript | xdotool (limited) |

## Common Tasks

**Enable voice responses:**
```bash
claude-voice config set tts.autoSpeak=true
claude-voice config set voiceOutput.enabled=true
```

**Change TTS provider:**
```bash
claude-voice config set tts.provider=openai
claude-voice config set tts.openai.voice=nova
```

**Change STT language:**
```bash
claude-voice config set stt.language=tr
```

**Download better STT model:**
```bash
claude-voice model download whisper-small
```
