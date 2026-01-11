#!/usr/bin/env python3
"""
Voice Input for Claude - Simple and Reliable
Records audio, transcribes with OpenAI Whisper, copies to clipboard.

Usage: python3 listen.py [seconds]
Default: 5 seconds recording
"""

import os
import sys
import subprocess
import tempfile
import json
import urllib.request

def record_with_sounddevice(filename, duration, sample_rate=16000):
    """Record using sounddevice (pip install sounddevice soundfile)"""
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        return False

    print(f"🎤 Recording for {duration} seconds... Speak now!")

    audio = sd.rec(int(duration * sample_rate), samplerate=sample_rate, channels=1, dtype='int16')
    sd.wait()

    sf.write(filename, audio, sample_rate)
    return True

def record_with_pyaudio(filename, duration, sample_rate=16000):
    """Record using PyAudio"""
    try:
        import pyaudio
        import wave
    except ImportError:
        return False

    CHUNK = 1024
    FORMAT = pyaudio.paInt16
    CHANNELS = 1

    p = pyaudio.PyAudio()
    stream = p.open(format=FORMAT, channels=CHANNELS, rate=sample_rate,
                    input=True, frames_per_buffer=CHUNK)

    print(f"🎤 Recording for {duration} seconds... Speak now!")

    frames = []
    for _ in range(0, int(sample_rate / CHUNK * duration)):
        data = stream.read(CHUNK, exception_on_overflow=False)
        frames.append(data)

    stream.stop_stream()
    stream.close()
    p.terminate()

    wf = wave.open(filename, 'wb')
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(p.get_sample_size(FORMAT))
    wf.setframerate(sample_rate)
    wf.writeframes(b''.join(frames))
    wf.close()
    return True

def transcribe_openai(audio_path):
    """Transcribe using OpenAI Whisper API with curl"""
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("❌ OPENAI_API_KEY not set")
        return None

    result = subprocess.run([
        'curl', '-s',
        'https://api.openai.com/v1/audio/transcriptions',
        '-H', f'Authorization: Bearer {api_key}',
        '-F', f'file=@{audio_path}',
        '-F', 'model=whisper-1'
    ], capture_output=True, text=True)

    try:
        response = json.loads(result.stdout)
        return response.get('text', '')
    except:
        print(f"❌ API Error: {result.stdout}")
        return None

def copy_to_clipboard(text):
    """Copy text to macOS clipboard"""
    subprocess.run(['pbcopy'], input=text.encode(), check=True)

def type_to_terminal(text):
    """Auto-type text into the active terminal using AppleScript"""
    # Escape special characters for AppleScript
    escaped = text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')

    script = f'''
    tell application "System Events"
        keystroke "{escaped}"
        key code 36
    end tell
    '''

    subprocess.run(['osascript', '-e', script], check=True)

def main():
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 5

    print("╔════════════════════════════════════════╗")
    print("║       Claude Voice Input               ║")
    print("╚════════════════════════════════════════╝")
    print("")

    # Check API key
    if not os.environ.get('OPENAI_API_KEY'):
        print("❌ OPENAI_API_KEY not set")
        print("   Run: export OPENAI_API_KEY='your-key'")
        sys.exit(1)

    # Create temp file
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        temp_path = f.name

    try:
        # Try recording methods
        recorded = record_with_sounddevice(temp_path, duration)

        if not recorded:
            recorded = record_with_pyaudio(temp_path, duration)

        if not recorded:
            print("❌ No recording library available.")
            print("   Install: pip3 install sounddevice soundfile")
            sys.exit(1)

        print("⏳ Transcribing with OpenAI Whisper...")

        text = transcribe_openai(temp_path)

        if text:
            print(f"\n📝 \"{text}\"\n")

            # Auto-type to terminal
            try:
                type_to_terminal(text)
                print("✅ Typed into terminal!")
            except:
                # Fallback to clipboard
                copy_to_clipboard(text)
                print("✅ Copied to clipboard! Paste with Cmd+V")
        else:
            print("❌ No speech detected")

    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)

if __name__ == "__main__":
    main()
