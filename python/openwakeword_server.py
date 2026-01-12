#!/usr/bin/env python3
"""
openWakeWord server for Claude Voice Extension.
Reads audio from stdin, outputs detections to stdout as JSON.

Usage:
    python openwakeword_server.py [model_name] [threshold]

Arguments:
    model_name: Wake word model to use (default: hey_jarvis)
    threshold: Detection threshold 0.0-1.0 (default: 0.5)
"""
import sys
import json
import os

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import numpy as np

try:
    from openwakeword.model import Model
    import openwakeword
except ImportError:
    print(json.dumps({"status": "error", "message": "openwakeword not installed"}), flush=True)
    sys.exit(1)

# Audio settings (must match Node.js - 16kHz 16-bit mono PCM)
SAMPLE_RATE = 16000
CHUNK_SIZE = 1280  # 80ms at 16kHz (1280 samples)

# Available pre-trained models
AVAILABLE_MODELS = [
    "alexa",
    "hey_jarvis",
    "hey_mycroft",
    "hey_rhasspy",
    "current_weather",
    "timers"
]

def main():
    # Parse arguments
    model_name = sys.argv[1] if len(sys.argv) > 1 else "hey_jarvis"
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5

    # Validate model name
    if model_name not in AVAILABLE_MODELS:
        print(json.dumps({
            "status": "error",
            "message": f"Unknown model: {model_name}. Available: {', '.join(AVAILABLE_MODELS)}"
        }), flush=True)
        sys.exit(1)

    try:
        # Download models if needed (first run only)
        openwakeword.utils.download_models()

        # Initialize model
        model = Model(wakeword_models=[model_name])

        # Signal ready
        print(json.dumps({
            "status": "ready",
            "model": model_name,
            "threshold": threshold,
            "chunk_size": CHUNK_SIZE
        }), flush=True)

    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}), flush=True)
        sys.exit(1)

    # Main detection loop with buffering for variable chunk sizes
    audio_buffer = b''
    frame_size = CHUNK_SIZE * 2  # 2560 bytes per frame
    frames_processed = 0
    max_score = 0.0

    while True:
        try:
            # Read whatever audio data is available (non-blocking style with larger reads)
            chunk = sys.stdin.buffer.read(4096)

            if not chunk:
                # EOF - stdin closed
                break

            # Add to buffer
            audio_buffer += chunk

            # Process all complete frames in buffer
            while len(audio_buffer) >= frame_size:
                # Extract one frame
                frame = audio_buffer[:frame_size]
                audio_buffer = audio_buffer[frame_size:]
                frames_processed += 1

                # Convert to numpy array and normalize to [-1, 1]
                audio = np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0

                # Run inference
                prediction = model.predict(audio)

                # Check for detection
                for name, scores in prediction.items():
                    # scores is an array, get the latest score
                    score = float(scores[-1]) if hasattr(scores, '__len__') else float(scores)

                    # Track max score for debugging
                    if score > max_score:
                        max_score = score

                    if score > threshold:
                        print(json.dumps({
                            "event": "wakeword",
                            "keyword": name,
                            "score": score
                        }), flush=True)

                        # Reset the model after detection to prevent repeated triggers
                        model.reset()
                        max_score = 0.0

                # Log max score every 50 frames (~4 seconds)
                if frames_processed % 50 == 0:
                    print(json.dumps({"event": "debug", "frames": frames_processed, "max_score": round(max_score, 3)}), flush=True)
                    max_score = 0.0  # Reset after logging

        except Exception as e:
            print(json.dumps({"event": "error", "message": str(e)}), flush=True)
            continue

if __name__ == "__main__":
    main()
