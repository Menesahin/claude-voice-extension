#!/bin/bash
#
# Simple Voice Input for Claude (no dependencies)
# Uses macOS QuickTime for recording
#

TEMP_FILE="/tmp/claude-voice-$$.m4a"
DURATION=${1:-5}

echo "╔════════════════════════════════════════╗"
echo "║       Claude Voice Input               ║"
echo "╚════════════════════════════════════════╝"
echo ""

if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ OPENAI_API_KEY not set"
    exit 1
fi

echo "🎤 Recording for ${DURATION} seconds... Speak now!"

# Use afrecord (built into macOS) or screencapture for audio
# Alternative: use say -i for interactive input
osascript -e "
    set tempFile to \"$TEMP_FILE\"
    set duration to $DURATION

    tell application \"QuickTime Player\"
        activate
        set newRecording to new audio recording
        delay 0.5
        start newRecording
        delay duration
        stop newRecording
        export document 1 in POSIX file tempFile using settings preset \"Audio Only\"
        close document 1 saving no
        quit
    end tell
" 2>/dev/null

# Wait for file
sleep 1

if [ ! -f "$TEMP_FILE" ]; then
    echo "❌ Recording failed. Trying alternative method..."

    # Fallback: Use afplay/arecord if available
    if command -v rec &> /dev/null; then
        rec -r 16000 -c 1 "$TEMP_FILE" trim 0 $DURATION 2>/dev/null
    else
        echo "❌ No recording tool available."
        echo "   Install ffmpeg: brew install ffmpeg"
        echo "   Or install sox: brew install sox"
        exit 1
    fi
fi

echo "⏳ Transcribing..."

# Call OpenAI Whisper API
RESPONSE=$(curl -s https://api.openai.com/v1/audio/transcriptions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "file=@$TEMP_FILE" \
    -F "model=whisper-1")

TEXT=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('text', ''))" 2>/dev/null)

rm -f "$TEMP_FILE"

if [ -z "$TEXT" ]; then
    echo "❌ Transcription failed"
    exit 1
fi

echo ""
echo "📝 \"$TEXT\""
echo ""
echo -n "$TEXT" | pbcopy
echo "✅ Copied to clipboard!"
