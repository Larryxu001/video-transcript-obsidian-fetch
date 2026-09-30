import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkSession, YouTubeChallenge } from '../src/network.ts';
import { RateLimited, request, retryDelay } from '../src/http.ts';
import { Platforms } from '../src/platforms.ts';
const signal = () => new AbortController().signal;
const reply = (data: unknown, status = 200) => ({ status, headers: {}, bytes: new TextEncoder().encode(JSON.stringify(data)).buffer });
test('metadata requests are serialized, paced, and a repeated request uses the cache', async () => {
  let active = 0, peak = 0; const times: number[] = [];
  const net = new NetworkSession(async () => { times.push(Date.now()); peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 10)); active--; return reply({ videoDetails: {} }); }, 30);
  const input = { url: 'https://www.youtube.com/youtubei/v1/player', method: 'POST', body: 'fixture' };
  await Promise.all([net.transport(input, signal()), net.transport(input, signal()), net.transport({ ...input, body: 'other' }, signal())]);
  assert.equal(times.length, 2); assert.equal(peak, 1); assert.ok(times[1] - times[0] >= 25);
  await net.transport({ ...input, cache: 'reload' }, signal()); assert.equal(times.length, 3);
});
test('audio downloads keep bounded parallelism and are never cached as metadata', async () => {
  let active = 0, peak = 0, calls = 0;
  const net = new NetworkSession(async () => { calls++; peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 10)); active--; return reply({}); }, 0);
  await Promise.all(Array.from({ length: 12 }, () => net.transport({ url: 'https://rr1.googlevideo.com/audio', headers: { Range: 'bytes=0-9' } }, signal())));
  assert.equal(calls, 12); assert.equal(peak, 4);
});
test('challenge stops the client ladder and holds subsequent YouTube requests until explicit resume', async () => {
  let calls = 0;
  const net = new NetworkSession(async () => { calls++; return reply({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }); }, 0);
  const platform = new Platforms(net.transport, '', signal());
  await assert.rejects(platform.load({ platform: 'youtube', id: 'abcdefghijk', part: 1 }), YouTubeChallenge);
  assert.equal(calls, 1);
  await assert.rejects(net.transport({ url: 'https://www.youtube.com/watch?v=another' }, signal()), YouTubeChallenge); assert.equal(calls, 1);
  net.resume(); await assert.rejects(net.transport({ url: 'https://www.youtube.com/watch?v=another' }, signal()), YouTubeChallenge); assert.equal(calls, 2);
});
test('a long Retry-After pauses immediately instead of ignoring the service cooldown', async () => {
  let calls = 0;
  await assert.rejects(request(async () => { calls++; return { ...reply({}, 429), headers: { 'retry-after': '120' } }; }, signal(), { url: 'https://www.youtube.com/watch?v=fixture' }), RateLimited);
  assert.equal(calls, 1); assert.equal(retryDelay('12', 0), 12000);
  assert.ok(retryDelay(new Date(Date.now() + 30000).toUTCString(), 0) > 28000);
});
test('cancelling a queued request releases its place without starting network work', async () => {
  let release!: () => void, calls = 0;
  const net = new NetworkSession(async () => { calls++; await new Promise<void>(r => { release = r; }); return reply({}); }, 0);
  const first = net.transport({ url: 'https://www.youtube.com/watch?v=first' }, signal());
  await new Promise(r => setTimeout(r, 5));
  const controller = new AbortController(); const queued = net.transport({ url: 'https://www.youtube.com/watch?v=second' }, controller.signal);
  controller.abort(); await assert.rejects(queued); release(); await first; assert.equal(calls, 1);
});

test('a short 429 cooldown is honored before one bounded retry', async () => {
  const times: number[] = [];
  const result = await request(async () => { times.push(Date.now()); return times.length === 1 ? { ...reply({}, 429), headers: { 'retry-after': '1' } } : reply({ ok: true }); }, signal(), { url: 'https://www.youtube.com/watch?v=fixture' }, 1);
  assert.equal(result.status, 200); assert.equal(times.length, 2); assert.ok(times[1] - times[0] >= 950);
});
