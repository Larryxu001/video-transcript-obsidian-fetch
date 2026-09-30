import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWindows, readIndex, concat, rebaseFragments, wav, multipart } from '../src/media.ts';

export function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(8 + payload.length); new DataView(result.buffer).setUint32(0, result.length);
  result.set(new TextEncoder().encode(type), 4); result.set(payload, 8); return result;
}
export function indexFixture(sizes = [100, 200], seconds = 60): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(24 + sizes.length * 12), view = new DataView(body.buffer);
  view.setUint32(8, 1000); view.setUint16(22, sizes.length);
  sizes.forEach((size, i) => { view.setUint32(24 + i * 12, size); view.setUint32(28 + i * 12, seconds * 1000); });
  return box('sidx', body);
}
test('audio plan overlaps boundaries without padding beyond video end', () => {
  assert.deepEqual(planWindows(601, 300), [{ start: 0, end: 300 }, { start: 298, end: 600 }, { start: 598, end: 601 }]);
  assert.throws(() => planWindows(NaN, 300)); assert.throws(() => planWindows(10, 0));
});
test('MP4 index maps offsets including the index location and size', () => {
  const bytes = indexFixture(); const parts = readIndex(bytes, 1000);
  assert.deepEqual(parts, [{ from: 1056, to: 1155, start: 0, end: 60 }, { from: 1156, to: 1355, start: 60, end: 120 }]);
});
test('MP4 parser refuses truncated and nested indexes', () => {
  const bytes = indexFixture(); assert.throws(() => readIndex(bytes.subarray(0, bytes.length - 1), 0));
  new DataView(bytes.buffer).setUint32(32, 0x80000001); assert.throws(() => readIndex(bytes, 0), /Hierarchical/);
});
test('fragment rebasing preserves the distance between decode timestamps', () => {
  const fragment = (clock: number) => { const data = new Uint8Array(8); new DataView(data.buffer).setUint32(4, clock); return box('moof', box('traf', box('tfdt', data))); };
  const input = concat([fragment(90000), fragment(150000)]), output = rebaseFragments(input);
  assert.equal(new DataView(output.buffer).getUint32(28), 0); assert.equal(new DataView(output.buffer).getUint32(60), 60000);
  assert.equal(new DataView(input.buffer).getUint32(28), 90000);
});
test('WAV header declares exactly the submitted sample count', () => {
  const audio = wav(new Float32Array([-2, 0, 2])); const view = new DataView(audio.buffer);
  assert.equal(audio.length, 50); assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(48, true), 32767);
});
test('multipart framing keeps binary audio intact', () => {
  const bytes = multipart(new Uint8Array([0, 255, 10]), { model: 'test' }, 'boundary');
  assert.match(new TextDecoder().decode(bytes), /name="model"\r\n\r\ntest\r\n/);
  assert.equal(bytes.includes(255), true); assert.ok(new TextDecoder().decode(bytes).endsWith('--boundary--\r\n'));
});
