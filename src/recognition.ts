import { YouTubeChallenge } from './network.ts';
import type { Preferences, Segment, Video, AudioSource } from './model.ts';
import { videoKey } from './model.ts';
import { RateLimited, request, json, checkedUrl, object, objects, text } from './http.ts';
import type { Transport } from './http.ts';
import { planWindows, readIndex, concat, rebaseFragments, wav, multipart } from './media.ts';
import type { MediaPart, Window } from './media.ts';

export class UncertainRecognition extends Error {
  constructor() { super('A previous recognition request was submitted, but its result was not saved. It may already have been billed. Completed chunks are safe. Retry the uncertain chunk only if you accept a possible additional charge.'); }
}
export interface RecognitionRecord { key: string; chunks: Array<[number, Segment[]]>; pending: number[] }
export class RecognitionCache {
  private entries = new Map<string, Map<number, Segment[]>>();
  private pending = new Map<string, Set<number>>();
  private audio = new Map<string, Uint8Array<ArrayBuffer>>();
  private save: () => Promise<void>;
  constructor(save: () => Promise<void> = async () => {}) { this.save = save; }
  private key(video: Video, settings: Preferences): string {
    return JSON.stringify([videoKey(video.ref), video.duration, settings.provider, settings.model, settings.spokenLanguage, settings.chunkSeconds]);
  }
  forVideo(video: Video, settings: Preferences): Map<number, Segment[]> {
    const key = this.key(video, settings);
    let entry = this.entries.get(key);
    if (!entry) {
      while (this.entries.size >= 100) {
        const oldest = [...this.entries.keys()].find(candidate => !this.pending.get(candidate)?.size);
        if (!oldest) throw new Error('Too many uncertain recognition checkpoints. Resolve or discard saved progress first.');
        this.entries.delete(oldest); this.pending.delete(oldest);
      }
      entry = new Map(); this.entries.set(key, entry);
    }
    return entry;
  }
  snapshot(): RecognitionRecord[] {
    return [...this.entries].map(([key, chunks]) => ({ key, chunks: [...chunks], pending: [...(this.pending.get(key) || [])] }));
  }
  restore(records: unknown): void {
    if (!Array.isArray(records)) return;
    for (const raw of records.slice(0, 100) as unknown[]) {
      const record = object(raw);
      if (typeof record.key !== 'string' || !Array.isArray(record.chunks) || !Array.isArray(record.pending)) continue;
      const chunks = new Map<number, Segment[]>();
      for (const item of record.chunks as unknown[]) {
        if (!Array.isArray(item)) continue;
        const [index, values] = item as unknown[];
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || !Array.isArray(values)) continue;
        const segments = objects(values).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && typeof s.text === 'string').map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text) }));
        if (segments.length) chunks.set(index, segments);
      }
      this.entries.set(record.key, chunks);
      this.pending.set(record.key, new Set((record.pending as unknown[]).filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && !chunks.has(i))));
    }
  }

  assertSafe(video: Video, settings: Preferences): void {
    if (this.pending.get(this.key(video, settings))?.size) throw new UncertainRecognition();
  }
  async approveRetry(): Promise<void> { this.pending.clear(); await this.save(); }
  async submitted(video: Video, settings: Preferences, index: number): Promise<void> {
    const key = this.key(video, settings); const pending = this.pending.get(key) || new Set<number>();
    pending.add(index); this.pending.set(key, pending); await this.save();
  }
  async completed(video: Video, settings: Preferences, index: number, segments: Segment[]): Promise<void> {
    this.forVideo(video, settings).set(index, segments); this.pending.get(this.key(video, settings))?.delete(index);
    this.audio.delete(`${this.key(video, settings)}:${index}`); await this.save();
  }
  cachedAudio(video: Video, settings: Preferences, index: number): Uint8Array<ArrayBuffer> | undefined { return this.audio.get(`${this.key(video, settings)}:${index}`); }
  keepAudio(video: Video, settings: Preferences, index: number, bytes: Uint8Array<ArrayBuffer>): void {
    this.audio.set(`${this.key(video, settings)}:${index}`, bytes);
    let size = [...this.audio.values()].reduce((total, value) => total + value.length, 0);
    for (const [key, value] of this.audio) { if (size <= 64 * 1024 * 1024) break; this.audio.delete(key); size -= value.length; }
  }
  clear(): void { this.entries.clear(); this.pending.clear(); this.audio.clear(); }
}

export function joinChunks(chunks: Segment[][]): Segment[] {
  const result: Segment[] = [];
  for (const chunk of chunks) {
    const seamEnd = result.at(-1)?.end ?? -Infinity;
    for (const segment of chunk) {
      let text = segment.text.trim();
      const previous = result.at(-1);
      if (previous && segment.start < seamEnd + 0.25) {
        const tail = previous.text.slice(-200);
        // Match text only at the overlapping seam, preserving repetitions elsewhere.
        for (let count = Math.min(tail.length, text.length); count >= 2; count--) {
          const suffix = tail.slice(-count);
          const latinWordCut = /[a-z0-9]/i.test(suffix[0]) && /[a-z0-9]/i.test(tail[tail.length - count - 1] || '') || /[a-z0-9]/i.test(suffix.at(-1) || '') && /[a-z0-9]/i.test(text[count] || '');
          if (!latinWordCut && suffix.toLocaleLowerCase() === text.slice(0, count).toLocaleLowerCase()) { text = text.slice(count).trim(); break; }
        }
      }
      if (text) result.push({ ...segment, text });
    }
  }
  return result;
}

async function range(transport: Transport, signal: AbortSignal, source: AudioSource, from: number, to: number, alternatives: () => Promise<AudioSource[]> = async () => [], blocked = new Set<string>()): Promise<Uint8Array> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to - from > 32 * 1024 * 1024) throw new Error('Invalid audio byte range.');
  const chunks: Uint8Array[] = [];
  let cursor = from, failure: unknown;
  let backups: Promise<AudioSource[]> | undefined;
  let lastFailure = 'No available server.';
  async function piece(position: number): Promise<void> {
    const end = Math.min(to, position + 399999);
    let received = false;
    const candidates = [source];
    for (let i = 0; i < candidates.length; i++) {
      if (i === 0 && blocked.has(source.url)) candidates.push(...await (backups ??= alternatives()));
      const candidate = candidates[i];
      if (blocked.has(candidate.url)) continue;
      try {
        const url = new URL(checkedUrl(candidate.url, ['googlevideo.com', 'bilivideo.com', 'bilivideo.cn', 'biliapi.net']));
        if (url.hostname.endsWith('.googlevideo.com')) {
          for (const key of ['range', 'rn', 'rbuf', 'ump', 'srfvp', 'sabr', 'alr', 'cmo']) url.searchParams.delete(key);
        }
        const headers: Record<string, string> = { Range: `bytes=${position}-${end}` };
        if (url.hostname.endsWith('.googlevideo.com')) headers['User-Agent'] = 'com.google.android.apps.youtube.vr.oculus/1.71.26 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
        if (!url.hostname.endsWith('.googlevideo.com')) {
          headers.Referer = 'https://www.bilibili.com/';
          headers['User-Agent'] = 'Mozilla/5.0';
        }
        const reply = await request(transport, signal, { url: url.href, headers }, 0);
        const bytes = new Uint8Array(reply.bytes);
        if (bytes.length !== end - position + 1) throw new Error('The audio server did not honor the requested byte range.');
        chunks[Math.floor((position - from) / 400000)] = bytes; received = true; break;
      } catch (error) { signal.throwIfAborted(); if (error instanceof RateLimited || error instanceof YouTubeChallenge) throw error; lastFailure = error instanceof Error ? error.message : 'Download failed.'; blocked.add(candidate.url); if (i === 0) candidates.push(...await (backups ??= alternatives())); }
    }
    if (!received) throw new Error(`Audio download failed: ${lastFailure}`);
  }
  async function worker(): Promise<void> {
    while (!failure && cursor <= to) {
      const position = cursor; cursor += 400000;
      try { await piece(position); } catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, Math.ceil((to - from + 1) / 400000)) }, worker));
  if (failure) throw failure instanceof Error ? failure : new Error('Audio download failed.');
  return concat(chunks);
}
interface Prepared { source: AudioSource; init: Uint8Array; index: MediaPart[] }
export type DecodeAudio = (bytes: Uint8Array<ArrayBuffer>, offset: number, duration: number) => Promise<Uint8Array<ArrayBuffer>>;
export const decodeAudio: DecodeAudio = async (bytes, offset, duration) => {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(bytes.buffer);
    if (offset + duration > audio.duration + 0.5) throw new Error('Decoded audio was shorter than its index. No partial chunk was uploaded.');
    const output = new OfflineAudioContext(1, Math.ceil(duration * 16000), 16000);
    const source = output.createBufferSource(); source.buffer = audio; source.connect(output.destination);
    source.start(0, offset, duration);
    const rendered = await output.startRendering();
    return wav(rendered.getChannelData(0));
  } finally { await context.close(); }
};

export async function recognize(video: Video, settings: Preferences, transport: Transport, signal: AbortSignal, cache: RecognitionCache, progress: (text: string) => void, decoder: DecodeAudio = decodeAudio): Promise<Segment[]> {
  const key = settings.provider === 'groq' ? settings.groqKey : settings.openaiKey;
  if (!settings.recognition || !key.trim()) throw new Error('Enable speech recognition and configure its API key first.');
  if (video.isLive) throw new Error('Wait for the live stream to finish before transcribing its audio.');
  const windows = planWindows(video.duration, settings.chunkSeconds);
  const done = cache.forVideo(video, settings);
  if (done.size === windows.length) return joinChunks(windows.map((_, i) => done.get(i)!));
  cache.assertSafe(video, settings);
  let sources: AudioSource[] = [];
  let discovery: Promise<void> | undefined;
  let refresh: Promise<void> | undefined;
  const prepared = new Map<string, Promise<Prepared>>();
  const blocked = new Set<string>();
  async function prepare(source: AudioSource): Promise<Prepared> {
    let result = prepared.get(source.url);
    if (!result) {
      result = (async () => {
        // Some YouTube clients omit byte boundaries; discover sidx in the first 16KB.
        if (source.indexStart === 0) {
          const header = await range(transport, signal, source, 0, source.indexEnd);
          const index = readIndex(header, 0);
          if (index[0].from > header.length) throw new Error('Audio initialization exceeds the downloaded header.');
          return { source, init: header.slice(0, index[0].from), index };
        }
        return { source, init: await range(transport, signal, source, 0, source.initEnd), index: readIndex(await range(transport, signal, source, source.indexStart, source.indexEnd), source.indexStart) };
      })();
      prepared.set(source.url, result);
    }
    return result;
  }
  async function audio(window: Window, refreshes = 0): Promise<Uint8Array<ArrayBuffer>> {
    discovery ??= (async () => { progress('Locating audio streams…'); sources = await video.audio(); })();
    await discovery;
    let lastFailure = 'No usable source.';
    for (const source of sources) {
      if (blocked.has(source.url)) continue;
      try {
        const preparedSource = await prepare(source);
        const audioEnd = preparedSource.index.at(-1)!.end;
        // Platform metadata rounds duration to whole seconds; use the real audio end for the final window.
        const end = window.end === video.duration && window.end - audioEnd <= 1 ? Math.min(window.end, audioEnd) : window.end;
        const parts = preparedSource.index.filter(part => part.end > window.start && part.start < end);
        if (!parts.length || end <= window.start || parts[0].start > window.start + 0.1 || parts.at(-1)!.end < end - 0.1) throw new Error('Audio index does not cover this chunk.');
        const alternatives = async (): Promise<AudioSource[]> => {
          const compatible: AudioSource[] = [];
          for (const other of sources) {
            if (other === source || blocked.has(other.url)) continue;
            try {
              const candidate = await prepare(other);
              if (JSON.stringify(candidate.index) === JSON.stringify(preparedSource.index) && candidate.init.length === preparedSource.init.length && candidate.init.every((byte, i) => byte === preparedSource.init[i])) compatible.push(other);
            } catch (error) { signal.throwIfAborted(); if (error instanceof RateLimited || error instanceof YouTubeChallenge) throw error; blocked.add(other.url); }
          }
          return compatible;
        };
        const media = await range(transport, signal, source, parts[0].from, parts.at(-1)!.to, alternatives, blocked);
        progress(`Decoding audio: ${Math.floor(window.start)}–${Math.ceil(window.end)}s…`);
        return await decoder(concat([preparedSource.init, rebaseFragments(media)]), Math.max(0, window.start - parts[0].start), end - window.start);
      } catch (error) { signal.throwIfAborted(); if (error instanceof RateLimited || error instanceof YouTubeChallenge) throw error; lastFailure = error instanceof Error ? error.message : 'Audio decoding failed.'; blocked.add(source.url); }
    }
    if (video.ref.platform === 'youtube' && refreshes < 2 && /HTTP (403|429)|Network request|No usable source/.test(lastFailure)) {
      progress('Refreshing expired or refused audio streams…');
      refresh ??= video.audio(true).then(fresh => { sources = fresh; prepared.clear(); blocked.clear(); }).finally(() => { refresh = undefined; });
      await refresh;
      signal.throwIfAborted();
      return audio(window, refreshes + 1);
    }
    throw new Error(`Audio chunk ${Math.floor(window.start)}–${Math.ceil(window.end)}s failed: ${lastFailure} Completed chunks are retained for this session.`);
  }
  let cursor = 0, failure: unknown;
  async function worker(): Promise<void> {
    while (!failure) {
      const index = cursor++;
      if (index >= windows.length) return;
      if (done.has(index)) continue;
      try {
        signal.throwIfAborted();
        progress(`Downloading audio chunk ${index + 1}/${windows.length} (${done.size} complete)…`);
        const bytes = cache.cachedAudio(video, settings, index) || await audio(windows[index]);
        cache.keepAudio(video, settings, index, bytes);
        signal.throwIfAborted();
        if (failure) return;
        progress(`Uploading and recognizing chunk ${index + 1}/${windows.length} (${done.size} complete)…`);
        const boundary = `vtf-${crypto.randomUUID()}`;
        const fields: Record<string, string> = { model: settings.model.trim() || (settings.provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'), response_format: 'verbose_json', 'timestamp_granularities[]': 'segment' };
        if (settings.spokenLanguage && settings.spokenLanguage !== 'auto') fields.language = settings.spokenLanguage;
        const endpoint = settings.provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
        // Never silently replay paid POSTs after timeout or ambiguous failure.
        await cache.submitted(video, settings, index);
        const response = json(await request(transport, signal, { url: endpoint, method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: multipart(bytes, fields, boundary).buffer, timeout: 180000 }, 0));
        const window = windows[index];
        const segments: Segment[] = Array.isArray(response.segments) ? objects(response.segments).map(s => ({ start: window.start + Math.max(0, Number(s.start)), end: Math.min(window.end, window.start + Number(s.end)), text: text(s.text) })).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start && s.text.trim()) : text(response.text) ? [{ start: window.start, end: window.end, text: text(response.text) }] : [];
        if (!segments.length) throw new Error('Speech recognition returned no text for a chunk. Completed chunks are retained.');
        await cache.completed(video, settings, index, segments);
      } catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(settings.concurrency, windows.length) }, worker));
  if (failure) throw failure instanceof Error ? failure : new Error('Speech recognition failed.');
  signal.throwIfAborted();
  return joinChunks(windows.map((_, i) => done.get(i)!));
}
