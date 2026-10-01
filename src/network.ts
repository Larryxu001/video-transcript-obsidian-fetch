import { AccessPaused, RateLimited, retryDelay, delay, decode } from './http.ts';
import type { HttpReply, Transport } from './http.ts';

export class YouTubeChallenge extends AccessPaused {
  constructor() { super('YouTube requires browser verification for this connection. The queue is paused. Open the video in your browser, resolve access, then resume.'); }
}
export function rejectChallenge(data: Record<string, unknown>): void {
  const status = data.playabilityStatus as { reason?: string } | undefined;
  if (/confirm.*(?:not a bot|不是机器人)|unusual traffic|automated queries|确认.*机器人/i.test(status?.reason || '')) throw new YouTubeChallenge();
}

// One metadata request at a time; audio keeps a separate, bounded lane.
export class NetworkSession {
  private cache = new Map<string, { reply: HttpReply; until: number }>();
  private active = [0, 0];
  private waiting: [Array<() => void>, Array<() => void>] = [[], []];
  private nextControl = 0;
  private paused = false;
  private cooldown = new Map<string, number>();
  private raw: Transport;
  private spacing: number;
  constructor(raw: Transport, spacing = 800) { this.raw = raw; this.spacing = spacing; }
  clear(): void { this.cache.clear(); }
  resume(): void { this.paused = false; }
  pause(): void { this.paused = true; this.clear(); }
  private async acquire(lane: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const limit = lane === 0 ? 1 : 4;
    if (this.active[lane] < limit) { this.active[lane]++; return; }
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { const index = this.waiting[lane].indexOf(ready); if (index >= 0) this.waiting[lane].splice(index, 1); reject(new Error('Cancelled.')); };
      this.waiting[lane].push(ready); signal.addEventListener('abort', abort, { once: true });
    });
  }
  transport: Transport = async (input, signal) => {
    const url = new URL(input.url);
    const youtube = url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com' || url.hostname.endsWith('.googlevideo.com');
    const media = !!input.headers?.Range;
    const platform = youtube || /(^|\.)(bilibili\.com|hdslb\.com|bilivideo\.com|bilivideo\.cn|biliapi\.net)$/.test(url.hostname);
    if (!platform || url.hostname === 'passport.bilibili.com') return this.raw(input, signal);
    const cacheable = !media && (youtube || /\/video\/|\/x\/web-interface\/(view|nav)|\/x\/player\//.test(url.pathname));
    const cacheUrl = new URL(input.url);
    if (url.hostname === 'api.bilibili.com' && url.pathname === '/x/player/wbi/v2') { cacheUrl.searchParams.delete('wts'); cacheUrl.searchParams.delete('w_rid'); }
    const key = JSON.stringify([cacheUrl.href, input.body, input.headers]);
    const lane = media ? 1 : 0;
    await this.acquire(lane, signal);
    try {
      signal.throwIfAborted();
      if (youtube && this.paused) throw new YouTubeChallenge();
      const service = youtube ? 'youtube' : 'bilibili';
      const until = this.cooldown.get(service) || 0;
      if (until - Date.now() > 60000) throw new RateLimited(until);
      await delay(Math.max(0, until - Date.now()), signal);
      const cached = this.cache.get(key);
      if (cacheable && input.cache !== 'reload' && cached && cached.until > Date.now()) return cached.reply;
      if (!media) { await delay(Math.max(0, this.nextControl - Date.now()), signal); this.nextControl = Date.now() + this.spacing; }
      const reply = await this.raw(input, signal);
      signal.throwIfAborted();
      if (reply.status === 429) this.cooldown.set(service, Date.now() + retryDelay(reply.headers['retry-after'], 0));
      let usable = reply.status >= 200 && reply.status < 300;
      if (!media) {
        const body = decode(reply);
        if (youtube && /\/sorry\//.test(body) && /captcha|unusual traffic/i.test(body)) { this.pause(); throw new YouTubeChallenge(); }
        try {
          const data = JSON.parse(body) as Record<string, unknown>;
          if (youtube) rejectChallenge(data);
          if (typeof data.code === 'number' && data.code !== 0) usable = false;
          if (data.playabilityStatus && (data.playabilityStatus as { status?: string }).status !== 'OK') usable = false;
        } catch (error) { if (error instanceof YouTubeChallenge) { this.pause(); throw error; } }
      }
      if (cacheable && usable && reply.bytes.byteLength > 0 && reply.bytes.byteLength <= 2 * 1024 * 1024) {
        const expiry = Number(url.searchParams.get('expire')) * 1000;
        const until = Math.min(Date.now() + 120000, expiry > 0 ? expiry - 30000 : Infinity);
        this.cache.set(key, { reply, until });
        while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      }
      return reply;
    } finally {
      const next = this.waiting[lane].shift(); if (next) next(); else this.active[lane]--;
    }
  };
}
