export interface HttpReply { status: number; headers: Record<string, string>; bytes: ArrayBuffer }
export interface HttpRequest { url: string; method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer; timeout?: number; cache?: 'reload' }
export type Transport = (request: HttpRequest, signal: AbortSignal) => Promise<HttpReply>;
export function isRecognitionRequest(input: HttpRequest): boolean {
  const url = new URL(input.url);
  return input.method === 'POST' && ['api.groq.com', 'api.openai.com'].includes(url.hostname) && url.pathname.endsWith('/audio/transcriptions');
}
export function decode(reply: HttpReply): string { return new TextDecoder().decode(reply.bytes); }
export function checkedUrl(raw: string, domains: string[]): string {
  const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !domains.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`))) throw new Error('The platform returned an unexpected network address.');
  return url.href;
}
export class AccessPaused extends Error {}
export class RateLimited extends AccessPaused {
  retryAt: number;
  constructor(retryAt: number) { super(`The platform is rate limiting requests. Resume after ${new Date(retryAt).toLocaleTimeString()}. The queue is paused.`); this.retryAt = retryAt; }
}
export function retryDelay(value: string | undefined, attempt: number): number {
  if (value && /^\d+(?:\.\d+)?$/.test(value)) return Math.max(1000, Number(value) * 1000);
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 5000 * 2 ** attempt;
}
export async function request(transport: Transport, signal: AbortSignal, input: HttpRequest, retries = 2): Promise<HttpReply> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let reply: HttpReply;
    try { reply = await transport(input, signal); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof AccessPaused) throw error;
      if (attempt >= retries) throw new Error(`Network request to ${new URL(input.url).hostname} failed. ${isRecognitionRequest(input) ? 'A submitted recognition request may already have been billed; completed chunks are kept for retry.' : 'Check the connection and resume the import.'}`);
      await delay(600 * 2 ** attempt, signal);
      continue;
    }
    signal.throwIfAborted();
    if (reply.status >= 200 && reply.status < 300) return reply;
    if (reply.status === 429) {
      const wait = retryDelay(reply.headers['retry-after'], attempt);
      if (attempt >= retries || wait > 60000) throw new RateLimited(Date.now() + wait);
      await delay(wait, signal); continue;
    }
    if (attempt >= retries || ![500, 502, 503, 504].includes(reply.status)) throw new Error(`Request to ${new URL(input.url).hostname} failed (HTTP ${reply.status}).`);
    await delay(Math.min(15000, Number(reply.headers['retry-after']) * 1000 || 600 * 2 ** attempt), signal);
  }
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const clock = window;
    const stop = () => { clock.clearTimeout(timer); reject(new Error('Cancelled.')); };
    const timer = clock.setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export type PlatformJson = Record<string, unknown>;
export function object(value: unknown): PlatformJson {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as PlatformJson : {};
}
export function objects(value: unknown): PlatformJson[] { return Array.isArray(value) ? value.map(object) : []; }
export function text(value: unknown, fallback = ''): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
export function json(reply: HttpReply): PlatformJson {
  try {
    const result: unknown = JSON.parse(decode(reply));
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as PlatformJson;
  } catch { /* A login/challenge page is not a valid API response. */ }
  throw new Error('The platform returned an unreadable response. Try opening the video in your browser.');
}
export function embeddedObject(html: string, marker: string): PlatformJson | null {
  let offset = html.indexOf(marker);
  if (offset < 0) return null;
  offset = html.indexOf('{', offset + marker.length);
  if (offset < 0) return null;
  let depth = 0, quoted = false, slash = false;
  for (let i = offset; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (slash) slash = false; else if (c === '\\') slash = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(offset, i + 1)) as PlatformJson; } catch { return null; }
    }
  }
  return null;
}
