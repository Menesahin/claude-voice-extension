/**
 * Audio utilities for wake word detection.
 * The main audio capture is now done via native tools (sox/arecord)
 * directly in the WakeWordDetector class.
 */

// Utility to save audio buffer to WAV file
export function saveToWav(
  audioBuffer: Buffer,
  outputPath: string,
  sampleRate: number,
  channels: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    import('fs').then((fs) => {
      // WAV header
      const header = Buffer.alloc(44);
      const dataSize = audioBuffer.length;
      const fileSize = dataSize + 36;

      // RIFF chunk descriptor
      header.write('RIFF', 0);
      header.writeUInt32LE(fileSize, 4);
      header.write('WAVE', 8);

      // fmt sub-chunk
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16); // Subchunk1Size
      header.writeUInt16LE(1, 20); // AudioFormat (PCM)
      header.writeUInt16LE(channels, 22); // NumChannels
      header.writeUInt32LE(sampleRate, 24); // SampleRate
      header.writeUInt32LE(sampleRate * channels * 2, 28); // ByteRate
      header.writeUInt16LE(channels * 2, 32); // BlockAlign
      header.writeUInt16LE(16, 34); // BitsPerSample

      // data sub-chunk
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);

      const wavBuffer = Buffer.concat([header, audioBuffer]);

      fs.writeFile(outputPath, wavBuffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
