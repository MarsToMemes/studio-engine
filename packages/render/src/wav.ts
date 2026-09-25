/** Minimal 16-bit PCM WAV reading and writing (every FFmpeg build decodes to and encodes from it). */
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';

export interface Pcm {
  sampleRate: number;
  channels: number;
  /** Interleaved samples. */
  samples: Int16Array;
}

export function readWav(path: string): Pcm {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV file`);
  let off = 12;
  let sampleRate = 0;
  let channels = 0;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      if (b.readUInt16LE(off + 8) !== 1 || b.readUInt16LE(off + 22) !== 16) throw new Error(`${path}: only 16-bit PCM WAV is read`);
      channels = b.readUInt16LE(off + 10);
      sampleRate = b.readUInt32LE(off + 12);
    } else if (id === 'data') {
      // FFmpeg writes 0xFFFFFFFF when streaming; the data then runs to the end of the file.
      const end = size === 0xffffffff ? b.length : Math.min(b.length, off + 8 + size);
      const bytes = b.subarray(off + 8, end - ((end - off - 8) % 2));
      const copy = new Int16Array(bytes.length / 2);
      for (let i = 0; i < copy.length; i++) copy[i] = bytes.readInt16LE(i * 2);
      return { sampleRate, channels, samples: copy };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

/** Writes a WAV progressively: `write` blocks of interleaved float samples (clipped to 16 bits), then `close`. */
export function createWavWriter(path: string, sampleRate: number, channels: number) {
  const fd = openSync(path, 'w');
  let frames = 0;
  const header = (dataBytes: number) => {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + dataBytes, 4);
    h.write('WAVEfmt ', 8);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(channels, 22);
    h.writeUInt32LE(sampleRate, 24);
    h.writeUInt32LE(sampleRate * channels * 2, 28);
    h.writeUInt16LE(channels * 2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(dataBytes, 40);
    return h;
  };
  writeSync(fd, header(0));
  return {
    write(block: Float32Array) {
      const out = Buffer.alloc(block.length * 2);
      for (let i = 0; i < block.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(block[i]! * 32767))), i * 2);
      writeSync(fd, out);
      frames += block.length / channels;
    },
    close() {
      writeSync(fd, header(frames * channels * 2), 0, 44, 0);
      closeSync(fd);
    },
  };
}
