#!/usr/bin/env python3
"""
Voice Input - Record and transcribe speech
Press ENTER to start recording, ENTER again to stop.
Uses OpenAI Whisper API for transcription.
"""

import os
import sys
import tempfile
import wave
import struct

def record_audio(filename, sample_rate=16000):
    """Record audio using PyAudio"""
    try:
        import pyaudio
    except ImportError:
        print("Installing pyaudio...")
        os.system("pip3 install pyaudio --quiet")
        import pyaudio

    CHUNK = 1024
    FORMAT = pyaudio.paInt16
    CHANNELS = 1

    p = pyaudio.PyAudio()

    stream = p.open(format=FORMAT,
                    channels=CHANNELS,
                    rate=sample_rate,
                    input=True,
                    frames_per_buffer=CHUNK)

    print("\n🎤 Recording... (press ENTER to stop)")

    frames = []

    # Record until Enter is pressed
    import select
    while True:
        data = stream.read(CHUNK, exception_on_overflow=False)
        frames.append(data)

        # Check for Enter key (non-blocking)
        if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
            sys.stdin.readline()
            break

    print("⏹️  Recording stopped.")

    stream.stop_stream()
    stream.close()
    p.terminate()

    # Save as WAV
    wf = wave.open(filename, 'wb')
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(p.get_sample_size(FORMAT))
    wf.setframerate(sample_rate)
    wf.writeframes(b''.join(frames))
    wf.close()

    return filename

def transcribe_openai(audio_path):
    """Transcribe using OpenAI Whisper API"""
    try:
        from openai import OpenAI
    except ImportError:
        print("Installing openai...")
        os.system("pip3 install openai --quiet")
        from openai import OpenAI

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("❌ OPENAI_API_KEY not set")
        return None

    client = OpenAI(api_key=api_key)

    with open(audio_path, 'rb') as audio_file:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file
        )

    return transcript.text

def transcribe_local(audio_path):
    """Transcribe using local Whisper"""
    try:
        import whisper
    except ImportError:
        print("Local whisper not available, using OpenAI API")
        return transcribe_openai(audio_path)

    model = whisper.load_model("base")
    result = model.transcribe(audio_path)
    return result["text"]

def main():
    print("╔════════════════════════════════════════╗")
    print("║       Claude Voice Input               ║")
    print("╠════════════════════════════════════════╣")
    print("║  Press ENTER to start recording        ║")
    print("║  Press ENTER again to stop & transcribe║")
    print("║  Type 'q' to quit                      ║")
    print("╚════════════════════════════════════════╝")

    use_openai = os.environ.get('OPENAI_API_KEY') is not None
    print(f"\nUsing: {'OpenAI Whisper API' if use_openai else 'Local Whisper'}")

    while True:
        print("\n" + "="*40)
        user_input = input("Press ENTER to record (or 'q' to quit): ").strip().lower()

        if user_input == 'q':
            print("Goodbye!")
            break

        # Record
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            temp_path = f.name

        try:
            record_audio(temp_path)

            print("⏳ Transcribing...")

            if use_openai:
                text = transcribe_openai(temp_path)
            else:
                text = transcribe_local(temp_path)

            if text:
                print(f"\n📝 Transcript: \"{text}\"")

                # Copy to clipboard on macOS
                try:
                    import subprocess
                    subprocess.run(['pbcopy'], input=text.encode(), check=True)
                    print("✅ Copied to clipboard! Paste with Cmd+V")
                except:
                    pass
            else:
                print("❌ No speech detected")

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

if __name__ == "__main__":
    main()
