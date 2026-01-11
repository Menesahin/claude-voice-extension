#!/bin/bash
#
# Simple Voice Input for Claude
# Records audio, transcribes with OpenAI Whisper, copies to clipboard
#

TEMP_FILE="/tmp/claude-voice-$$.wav"
DURATION=${1:-5}  # Default 5 seconds, or pass as argument

echo "╔════════════════════════════════════════╗"
echo "║       Claude Voice Input               ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check for OPENAI_API_KEY
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ OPENAI_API_KEY not set"
    exit 1
fi

# Check for ffmpeg (can install with: brew install ffmpeg)
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ ffmpeg not found. Install with: brew install ffmpeg"
    exit 1
fi

echo "🎤 Recording for ${DURATION} seconds..."
echo "   (Speak now!)"
echo ""

# Record using ffmpeg with macOS audio input
ffmpeg -f avfoundation -i ":0" -t "$DURATION" -ar 16000 -ac 1 -y "$TEMP_FILE" 2>/dev/null

if [ ! -f "$TEMP_FILE" ]; then
    echo "❌ Recording failed"
    exit 1
fi

echo "⏳ Transcribing with OpenAI Whisper..."

# Call OpenAI Whisper API
RESPONSE=$(curl -s https://api.openai.com/v1/audio/transcriptions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "file=@$TEMP_FILE" \
    -F "model=whisper-1")

# Extract text from response
TEXT=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('text', ''))" 2>/dev/null)

# Cleanup
rm -f "$TEMP_FILE"

if [ -z "$TEXT" ]; then
    echo "❌ No speech detected or transcription failed"
    echo "Response: $RESPONSE"
    exit 1
fi

echo ""
echo "📝 Transcript:"
echo "   \"$TEXT\""
echo ""

# Copy to clipboard
echo -n "$TEXT" | pbcopy
echo "✅ Copied to clipboard! Paste with Cmd+V in Claude"
