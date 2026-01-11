# Claude Voice Extension

Voice interface extension for Claude Code - enables speech-to-text input, text-to-speech output, and wake word detection.

## Features

- **Voice Input (STT)**: Speak commands to Claude using wake word or push-to-talk
- **Voice Output (TTS)**: Claude's responses are spoken aloud
- **Voice-Friendly Formatting**: Claude structures responses with TTS-optimized abstracts
- **Wake Word**: Say "Jarvis" to start speaking a command
- **Voice Notifications**: Audio alerts for permission prompts and idle states
- **Multiple Providers**: Supports local and cloud-based speech services

## Quick Start

```bash
# Install globally
npm install -g claude-voice

# Run interactive setup
claude-voice setup

# Start the daemon
claude-voice start
```

## Installation

### Prerequisites

- Node.js 18+
- macOS (primary) or Linux
- Microphone access

### Install from npm

```bash
npm install -g claude-voice
```

### Install from source

```bash
git clone https://github.com/anthropics/claude-voice.git
cd claude-voice
npm install
npm run build
npm link
```

## Configuration

Configuration is stored in `~/.claude-voice/config.json`.

### Interactive Setup

```bash
claude-voice setup
```

### Using the CLI

```bash
# View full configuration
claude-voice config

# Get a specific value
claude-voice config get tts.provider

# Set a value
claude-voice config set tts.autoSpeak=false

# Reset to defaults
claude-voice config reset

# Edit in your editor
claude-voice config edit
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tts.provider` | string | `macos-say` | TTS provider: `macos-say`, `openai`, `elevenlabs`, `disabled` |
| `tts.autoSpeak` | boolean | `true` | Automatically speak Claude's responses |
| `tts.maxSpeechLength` | number | `500` | Maximum characters to speak |
| `tts.skipCodeBlocks` | boolean | `true` | Skip code blocks when speaking |
| `stt.provider` | string | `openai` | STT provider: `openai`, `whisper-local`, `disabled` |
| `stt.language` | string | `en` | Default language for transcription |
| `wakeWord.enabled` | boolean | `true` | Enable wake word detection |
| `wakeWord.keyword` | string | `jarvis` | Wake word keyword |
| `wakeWord.sensitivity` | number | `0.5` | Wake word sensitivity (0.0-1.0) |
| `wakeWord.playSound` | boolean | `true` | Play sound when wake word detected |
| `notifications.enabled` | boolean | `true` | Enable voice notifications |
| `notifications.permissionPrompt` | boolean | `true` | Speak permission prompts |
| `notifications.idlePrompt` | boolean | `true` | Speak idle prompts |
| `voiceOutput.enabled` | boolean | `true` | Enable TTS-friendly response formatting |
| `voiceOutput.abstractMarker` | string | `<!-- TTS -->` | Marker separating spoken/technical content |
| `voiceOutput.maxAbstractLength` | number | `200` | Max characters for spoken abstract |

## TTS Providers

### macOS Say (Default on macOS)
No API key required. Uses built-in macOS speech synthesis.

```bash
# List available voices
claude-voice voices

# Change voice
claude-voice config set tts.macos.voice=Alex

# Adjust speed (words per minute)
claude-voice config set tts.macos.rate=180
```

### OpenAI TTS
Requires `OPENAI_API_KEY`. High-quality neural voices.

```bash
# Set API key
export OPENAI_API_KEY="sk-..."

# Or save to .env file
echo "OPENAI_API_KEY=sk-..." >> ~/.claude-voice/.env

# Switch to OpenAI
claude-voice config set tts.provider=openai

# Choose voice (alloy, echo, fable, onyx, nova, shimmer)
claude-voice config set tts.openai.voice=nova
```

### ElevenLabs
Requires `ELEVENLABS_API_KEY`. Premium voice cloning.

```bash
export ELEVENLABS_API_KEY="..."
claude-voice config set tts.provider=elevenlabs
claude-voice config set tts.elevenlabs.voiceId=YOUR_VOICE_ID
```

## STT Providers

### Sherpa-ONNX (FREE - Recommended)
Embedded, offline speech recognition. No API key required!

```bash
# List available models
claude-voice model list

# Download a model (75-488MB)
claude-voice model download whisper-tiny

# Switch to Sherpa-ONNX
claude-voice config set stt.provider=sherpa-onnx

# Set language (supports 100+ languages including Turkish)
claude-voice config set stt.language=tr
```

Available models:
| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| `whisper-tiny` | 75 MB | Fast | Good |
| `whisper-base` | 142 MB | Medium | Better |
| `whisper-small` | 488 MB | Slower | Best |

### OpenAI Whisper API
Fast cloud transcription. Requires `OPENAI_API_KEY`.

```bash
claude-voice config set stt.provider=openai
```

### Local Whisper
Runs locally on your machine. Requires Python and whisper:

```bash
pip install openai-whisper
claude-voice config set stt.provider=whisper-local

# Choose model (tiny, base, small, medium, large)
claude-voice config set stt.whisperLocal.model=base
```

## Wake Word Detection

Wake word detection uses Picovoice Porcupine. Get a free API key at [picovoice.ai](https://picovoice.ai/).

```bash
# Set API key
export PICOVOICE_ACCESS_KEY="your-key"
# Or save to .env
echo "PICOVOICE_ACCESS_KEY=your-key" >> ~/.claude-voice/.env

# Enable wake word
claude-voice config set wakeWord.enabled=true

# Adjust sensitivity (0.0-1.0, higher = more sensitive)
claude-voice config set wakeWord.sensitivity=0.6
```

## Voice Output Formatting

When enabled, Claude structures responses with a TTS-friendly abstract at the beginning. This makes voice output more natural and conversational.

### How It Works

1. Claude adds a brief conversational summary before the `<!-- TTS -->` marker
2. Technical details (code, file paths, etc.) go after the marker
3. Only the abstract portion is spoken via TTS

**Example Claude Response:**
```
I found and fixed the authentication bug. The issue was a missing null check.

<!-- TTS -->

**Technical Details:**
Modified `auth.ts:45` to add proper null checking...
```

The TTS will only speak: *"I found and fixed the authentication bug. The issue was a missing null check."*

### Configuration

```bash
# Enable/disable voice output formatting
claude-voice output enable
claude-voice output disable

# Check current status
claude-voice output status

# Configure settings
claude-voice output config --length 300   # Max abstract length
claude-voice output config --marker "---" # Custom marker
```

### Custom Prompt Template

Create `~/.claude-voice/voice-prompt.md` to customize how Claude formats responses:

```bash
# Copy the default template
cp /path/to/claude-voice/config/voice-prompt.md ~/.claude-voice/

# Edit to your preferences
nano ~/.claude-voice/voice-prompt.md
```

Template variables:
- `{{MARKER}}` - Replaced with your configured marker
- `{{MAX_LENGTH}}` - Replaced with max abstract length

## CLI Reference

```
claude-voice <command>

Core Commands:
  start                 Start the daemon
  stop                  Stop the daemon
  restart               Restart the daemon
  status                Check status

Setup:
  setup                 Interactive setup wizard
  doctor                Diagnose issues

Configuration:
  config                View configuration
  config get <key>      Get a value
  config set <k>=<v>    Set a value
  config reset          Reset to defaults
  config edit           Edit in $EDITOR

Hooks:
  hooks install         Install Claude Code hooks
  hooks uninstall       Remove hooks
  hooks status          Check hooks status

Voice Output:
  output enable         Enable TTS-friendly formatting
  output disable        Disable TTS-friendly formatting
  output status         Show voice output settings
  output config         Configure voice output options

Testing:
  test-tts [text]       Test TTS
  test-stt <file>       Test STT

Models:
  model list            List available STT models
  model download <id>   Download a model
  model remove <id>     Remove an installed model

Utilities:
  voices                List TTS voices
  devices               List audio devices
  logs                  View logs
  logs -f               Follow logs
```

## Troubleshooting

### Run the doctor command

```bash
claude-voice doctor
```

This will check:
- Node.js version
- Platform support
- Native TTS availability
- Terminal injection support
- Configuration validity
- Hooks installation
- API keys
- Daemon status

### Common Issues

**Daemon won't start**
```bash
# Check logs
claude-voice logs

# Run in foreground for debugging
claude-voice start -f
```

**No audio output**
```bash
# Test TTS directly
claude-voice test-tts "Hello world"

# Check provider
claude-voice config get tts.provider
```

**Wake word not detecting**
- Ensure `PICOVOICE_ACCESS_KEY` is set
- Check microphone permissions in System Preferences
- Try `claude-voice devices` to see available microphones

**Text not appearing in terminal**
- On macOS: Allow Terminal in Accessibility settings
- Check `claude-voice doctor` for terminal injection status

## API Reference

The daemon exposes an HTTP API on port 3456:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Daemon status |
| `/tts` | POST | Speak text `{ "text": "...", "priority": false }` |
| `/stt` | POST | Transcribe audio (multipart/form-data) |
| `/config` | GET | Get configuration |
| `/config` | POST | Update configuration |
| `/tts/stop` | POST | Stop current playback |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI TTS and Whisper API |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS |
| `PICOVOICE_ACCESS_KEY` | Wake word detection |

Store in `~/.claude-voice/.env` or export in your shell.

## License

MIT License
