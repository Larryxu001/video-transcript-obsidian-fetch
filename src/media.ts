export interface MediaPart { from: number; to: number; start: number; end: number }
export interface Window { start: number; end: number }
export function planWindows(duration: number, size: number): Window[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(size) || size < 10) throw new Error('Invalid audio duration or chunk length.');
  const windows: Window[] = [];
  for (let start = 0; start < duration; start += size) windows.push({ start: Math.max(0, start - (start ? 2 : 0)), end: Math.min(duration, start + size) });
  return windows;
}
export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export function readIndex(bytes: Uint8Array, absoluteOffset: number): MediaPart[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > bytes.length) throw new Error('Truncated MP4 index.');
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type !== 'sidx') { offset += size; continue; }
    const version = view.getUint8(offset + 8);
    if (version !== 0 && version !== 1) throw new Error('Unsupported MP4 index version.');
    const scale = view.getUint32(offset + 16);
    if (!scale) throw new Error('Invalid MP4 timescale.');
    const wide = version === 1;
    const earliest = wide ? Number(view.getBigUint64(offset + 20)) : view.getUint32(offset + 20);
    const delta = wide ? Number(view.getBigUint64(offset + 28)) : view.getUint32(offset + 24);
    let cursor = offset + (wide ? 36 : 28);
    const count = view.getUint16(cursor + 2);
    cursor += 4;
    if (cursor + count * 12 > offset + size) throw new Error('Truncated MP4 references.');
    let position = absoluteOffset + offset + size + delta, time = earliest / scale;
    const parts: MediaPart[] = [];
    for (let i = 0; i < count; i++, cursor += 12) {
      const reference = view.getUint32(cursor);
      if (reference & 0x80000000) throw new Error('Hierarchical MP4 indexes are unsupported.');
      const length = reference & 0x7fffffff, duration = view.getUint32(cursor + 4) / scale;
      if (!length || duration <= 0 || !Number.isSafeInteger(position + length)) throw new Error('Invalid MP4 reference.');
      parts.push({ from: position, to: position + length - 1, start: time, end: time + duration });
      position += length; time += duration;
    }
    if (!parts.length) throw new Error('MP4 index has no audio fragments.');
    return parts;
  }
  throw new Error('No MP4 segment index was found.');
}

// Decode a selected group at time zero; tfdt otherwise retains the video's clock.
export function rebaseFragments(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(input), view = new DataView(bytes.buffer);
  let base: bigint | undefined;
  const walk = (start: number, end: number) => {
    for (let at = start; at + 8 <= end;) {
      const size = view.getUint32(at);
      if (size < 8 || at + size > end) throw new Error('Invalid MP4 fragment.');
      const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
      if (type === 'moof' || type === 'traf') walk(at + 8, at + size);
      if (type === 'tfdt') {
        const wide = view.getUint8(at + 8) === 1;
        const clock = wide ? view.getBigUint64(at + 12) : BigInt(view.getUint32(at + 12));
        base ??= clock;
        if (clock < base) throw new Error('Audio fragment clock moved backwards.');
        if (wide) view.setBigUint64(at + 12, clock - base);
        else view.setUint32(at + 12, Number(clock - base));
      }
      at += size;
    }
  };
  walk(0, bytes.length);
  return bytes;
}
export function wav(samples: Float32Array, rate = 16000): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const label = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function multipart(audio: Uint8Array, fields: Record<string, string>, boundary: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [key, value] of Object.entries(fields)) chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`), audio, encoder.encode(`\r\n--${boundary}--\r\n`));
  return concat(chunks);
}
