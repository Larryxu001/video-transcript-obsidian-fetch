import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';

async function host(nativeFails = false) {
  let nativeCalls = 0, hostCalls = 0;
  const output = await build({ entryPoints: ['src/transport.ts'], bundle: true, platform: 'browser', format: 'cjs', external: ['obsidian', 'node:https', 'node:crypto'], write: false });
  const module = { exports: {} as { obsidianTransport: (input: unknown, signal: AbortSignal) => Promise<{ status: number }> } };
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, Buffer, URL, setTimeout, clearTimeout, window: { setTimeout, clearTimeout },
    require: (name: string) => {
      if (name === 'obsidian') return { Platform: { isDesktop: true }, requestUrl: async () => { hostCalls++; return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0) }; } };
      if (name !== 'node:https') throw Error(`Unexpected module ${name}`);
      return { request: (_url: string, _options: unknown, callback: (res: EventEmitter) => void) => {
        nativeCalls++;
        const req = Object.assign(new EventEmitter(), { setTimeout() {}, write() {}, end() {
          if (nativeFails) { req.emit('error', Error('fixture failure')); return; }
          const res = Object.assign(new EventEmitter(), { headers: {}, statusCode: 200 });
          callback(res); res.emit('data', Buffer.from('{}')); res.emit('end');
        } });
        return req;
      } };
    },
  });
  return { transport: module.exports.obsidianTransport, counts: () => ({ nativeCalls, hostCalls }) };
}
test('desktop CommonJS plugin loader can request Bilibili without dynamic import support', async () => {
  const f = await host();
  assert.equal((await f.transport({ url: 'https://api.bilibili.com/x/player/v2' }, new AbortController().signal)).status, 200);
  assert.deepEqual(f.counts(), { nativeCalls: 1, hostCalls: 0 });
});
test('passport login uses the Obsidian network session instead of the native API workaround', async () => {
  const f = await host();
  await f.transport({ url: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate' }, new AbortController().signal);
  assert.deepEqual(f.counts(), { nativeCalls: 0, hostCalls: 1 });
});
test('native API connection failure falls back to the host network route', async () => {
  const f = await host(true);
  assert.equal((await f.transport({ url: 'https://api.bilibili.com/x/player/v2' }, new AbortController().signal)).status, 200);
  assert.deepEqual(f.counts(), { nativeCalls: 1, hostCalls: 1 });
});
