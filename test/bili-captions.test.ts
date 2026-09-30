import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webSubtitleTracks } from '../src/bili-captions.ts';
import { signPlayerQuery } from '../src/bili-sign.ts';
function field(number: number, value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  assert.ok(bytes.length < 128);
  return new Uint8Array([number * 8 + 2, bytes.length, ...bytes]);
}
function payload(url = '//aisubtitle.hdslb.com/test'): ArrayBuffer {
  const track = new Uint8Array([...field(3, 'ai-zh'), ...field(4, 'Chinese'), ...field(5, url)]);
  return field(1, field(3, track)).buffer as ArrayBuffer;
}
test('web subtitle protobuf reads original language, name and URL', () => {
  assert.deepEqual(webSubtitleTracks(payload()), [{ language: 'ai-zh', name: 'Chinese', url: 'https://aisubtitle.hdslb.com/test' }]);
  assert.deepEqual(webSubtitleTracks(new Uint8Array([10, 0]).buffer), []);
});
test('web subtitle protobuf rejects malformed data and unrelated download hosts', () => {
  for (const bytes of [[10, 99], [10, 1, 0], [255], [9]]) assert.throws(() => webSubtitleTracks(new Uint8Array(bytes).buffer));
  assert.throws(() => webSubtitleTracks(payload('https://unrelated.test/subtitles')));
});
test('WBI canonicalizes parameter ordering and strips reserved value characters', () => {
  const image = 'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png';
  const sub = 'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png';
  const a = signPlayerQuery('cid=42124708898&bvid=BV1D3h46BEax', image, sub, 1702204169);
  assert.equal(a, signPlayerQuery('bvid=BV1D3h46BEax&cid=42124708898', image, sub, 1702204169));
  assert.match(a, /^bvid=BV1D3h46BEax&cid=42124708898&wts=1702204169&w_rid=[a-f0-9]{32}$/);
  assert.equal(signPlayerQuery('x=a!b', image, sub, 1), signPlayerQuery('x=ab', image, sub, 1));
  assert.throws(() => signPlayerQuery('cid=1', 'https://test/short.png', sub));
});
