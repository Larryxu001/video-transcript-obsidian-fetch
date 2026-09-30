import { Platform, requestUrl } from 'obsidian';
import { request as httpsRequest } from 'node:https';
import { isRecognitionRequest } from './http.ts';
import type { HttpRequest, HttpReply, Transport } from './http.ts';

async function nativeBilibili(input: HttpRequest, signal: AbortSignal): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(input.url, { method: input.method || 'GET', headers: input.headers, signal }, res => {
      const parts: Buffer[] = [];
      let length = 0;
      res.on('data', (data: Buffer) => {
        length += data.length;
        if (length > 16 * 1024 * 1024) req.destroy(new Error('Platform response exceeded the size limit.'));
        else parts.push(data);
      });
      res.on('error', reject);
      res.on('end', () => {
        const buffer = Buffer.concat(parts);
        const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join('\n') : String(v || '')]));
        resolve({ status: res.statusCode || 0, headers, bytes: Uint8Array.from(buffer).buffer });
      });
    });
    req.setTimeout(input.timeout || 25000, () => req.destroy(new Error('Platform request timed out.')));
    req.on('error', () => reject(new Error('Bilibili network request failed or was cancelled.')));
    if (input.body) req.write(typeof input.body === 'string' ? input.body : Buffer.from(input.body));
    req.end();
  });
}
export const obsidianTransport: Transport = async (input, signal) => {
  signal.throwIfAborted();
  const host = new URL(input.url).hostname;
  if (Platform.isDesktop && ['api.bilibili.com', 'www.bilibili.com'].includes(host)) {
    try {
      const reply = await nativeBilibili(input, signal);
      if (reply.status >= 200 && reply.status < 300) return reply;
    } catch { signal.throwIfAborted(); }
  }
  const clock = window;
  let timer: number | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      requestUrl({ url: input.url, method: input.method || 'GET', headers: input.headers, body: input.body, throw: false }),
      new Promise<never>((_, reject) => {
        timer = clock.setTimeout(() => reject(new Error(isRecognitionRequest(input) ? 'Recognition request timed out and may already have been billed. Saved progress will prevent an automatic replay.' : 'Network request timed out. Check the connection and resume.')), input.timeout || 30000);
        onAbort = () => reject(new Error('Cancelled. An in-flight request may still finish remotely.'));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    return { status: result.status, bytes: result.arrayBuffer, headers: Object.fromEntries(Object.entries(result.headers).map(([k, v]) => [k.toLowerCase(), v])) };
  } finally {
    clock.clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
};
