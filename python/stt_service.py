#!/usr/bin/env python3
"""
Speech-to-Text service using OpenAI Whisper.
Can be run as a standalone script or as a Flask server.
"""

import argparse
import json
import sys
import os

def transcribe_audio(audio_path: str, model: str = "base", language: str = "en") -> dict:
    """Transcribe audio file using Whisper."""
    try:
        import whisper
    except ImportError:
        return {"error": "openai-whisper not installed. Run: pip install openai-whisper"}

    if not os.path.exists(audio_path):
        return {"error": f"Audio file not found: {audio_path}"}

    try:
        # Load model (cached after first load)
        model_instance = whisper.load_model(model)

        # Transcribe
        result = model_instance.transcribe(
            audio_path,
            language=language if language != "auto" else None,
            fp16=False  # Use FP32 for better compatibility
        )

        return {
            "transcript": result["text"].strip(),
            "language": result.get("language", language),
            "segments": result.get("segments", [])
        }
    except Exception as e:
        return {"error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Whisper STT Service")
    parser.add_argument("--audio", "-a", required=True, help="Path to audio file")
    parser.add_argument("--model", "-m", default="base",
                       choices=["tiny", "base", "small", "medium", "large"],
                       help="Whisper model size")
    parser.add_argument("--language", "-l", default="en",
                       help="Language code (e.g., 'en', 'es') or 'auto' for detection")

    args = parser.parse_args()

    result = transcribe_audio(args.audio, args.model, args.language)
    print(json.dumps(result))

    if "error" in result:
        sys.exit(1)

if __name__ == "__main__":
    main()
