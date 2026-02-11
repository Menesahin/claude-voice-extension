#!/usr/bin/env python3
"""
openWakeWord Detection Script

Accepts raw PCM audio via stdin (16kHz, mono, 16-bit signed integer),
processes it with openWakeWord, and outputs JSON detection events to stdout.

Usage:
    rec -q -t raw -b 16 -e signed-integer -c 1 -r 16000 - | \
        python openwakeword-detector.py --model hey_jarvis --threshold 0.5
"""

import sys
import json
import argparse
import numpy as np
from pathlib import Path

# Chunk size in samples (80ms at 16kHz = 1280 samples)
CHUNK_SIZE = 1280


def main():
    parser = argparse.ArgumentParser(description='openWakeWord detector')
    parser.add_argument('--model', type=str, default='hey_jarvis',
                        help='Wake word model name (default: hey_jarvis)')
    parser.add_argument('--threshold', type=float, default=0.65,
                        help='Detection threshold 0.0-1.0 (default: 0.65)')
    parser.add_argument('--vad-threshold', type=float, default=0.3,
                        help='VAD threshold 0.0-1.0 to filter non-speech audio (default: 0.3, 0=disabled)')
    parser.add_argument('--debug', action='store_true',
                        help='Enable debug output')
    parser.add_argument('--models-dir', type=str, default=None,
                        help='Custom models directory')
    args = parser.parse_args()

    # Import openwakeword (deferred to allow pip install check)
    try:
        import openwakeword
        from openwakeword.model import Model
    except ImportError:
        print(json.dumps({
            "error": "openwakeword not installed",
            "install": "pip install openwakeword"
        }), flush=True)
        sys.exit(1)

    # Determine models directory
    if args.models_dir:
        models_dir = Path(args.models_dir)
    else:
        models_dir = Path.home() / '.claude-voice' / 'models' / 'openwakeword'

    # Check for custom model path
    custom_model_path = models_dir / f"{args.model}.onnx"

    # Determine inference framework: prefer onnx (works on macOS ARM64),
    # fall back to tflite if onnxruntime not available
    inference_fw = 'onnx'
    try:
        import onnxruntime
    except ImportError:
        inference_fw = 'tflite'

    # Check if Speex noise suppression is available (Linux only)
    enable_speex = False
    if sys.platform == 'linux':
        try:
            import importlib
            if importlib.util.find_spec('speexdsp_ns'):
                enable_speex = True
        except Exception:
            pass

    # Build common model kwargs
    model_kwargs = {
        'inference_framework': inference_fw,
    }
    if args.vad_threshold > 0:
        model_kwargs['vad_threshold'] = args.vad_threshold
    if enable_speex:
        model_kwargs['enable_speex_noise_suppression'] = True

    # Initialize model
    try:
        if custom_model_path.exists():
            # Use custom downloaded model
            if args.debug:
                print(json.dumps({"debug": f"Loading custom model: {custom_model_path} ({inference_fw}, vad={args.vad_threshold})"}), flush=True)
            oww_model = Model(wakeword_models=[str(custom_model_path)], **model_kwargs)
        else:
            # Use built-in model (downloads automatically if needed)
            if args.debug:
                print(json.dumps({"debug": f"Loading built-in model: {args.model} ({inference_fw}, vad={args.vad_threshold})"}), flush=True)
            oww_model = Model(wakeword_models=[args.model], **model_kwargs)

        # Signal ready
        features = []
        if args.vad_threshold > 0:
            features.append(f"vad={args.vad_threshold}")
        if enable_speex:
            features.append("speex_ns")
        print(json.dumps({"status": "ready", "model": args.model, "threshold": args.threshold, "features": features}), flush=True)
    except Exception as e:
        print(json.dumps({"error": f"Failed to load model: {str(e)}"}), flush=True)
        sys.exit(1)

    # Read raw PCM audio from stdin and process
    buffer = b''
    bytes_per_chunk = CHUNK_SIZE * 2  # 2 bytes per sample (16-bit)

    while True:
        try:
            # Read audio data from stdin
            data = sys.stdin.buffer.read(bytes_per_chunk)
            if not data:
                break

            buffer += data

            # Process complete chunks
            while len(buffer) >= bytes_per_chunk:
                chunk = buffer[:bytes_per_chunk]
                buffer = buffer[bytes_per_chunk:]

                # Convert bytes to numpy array (int16 -> float32 normalized)
                audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

                # Run prediction
                prediction = oww_model.predict(audio)

                # Check for detections
                for model_name, score in prediction.items():
                    if args.debug and score > 0.1:
                        print(json.dumps({"debug": f"{model_name}: {score:.3f}"}), flush=True)

                    if score >= args.threshold:
                        print(json.dumps({
                            "detected": True,
                            "model": model_name,
                            "score": float(score)
                        }), flush=True)

                        # Reset model state after detection to prevent repeated triggers
                        oww_model.reset()

        except KeyboardInterrupt:
            break
        except Exception as e:
            if args.debug:
                print(json.dumps({"error": str(e)}), flush=True)
            continue

    print(json.dumps({"status": "stopped"}), flush=True)


if __name__ == '__main__':
    main()
