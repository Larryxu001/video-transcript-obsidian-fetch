import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecognitionCache, recognize, joinChunks } from '../src/recognition.ts';
import { defaults } from '../src/model.ts';
import type { Video } from '../src/model.ts';
import type { Transport } from '../src/http.ts';
import { concat } from '../src/media.ts';

function box(type: string, length: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(length); new DataView(data.buffer).setUint32(0, length); data.set(new TextEncoder().encode(type), 4); return data;
}
function fixture() {
  const init = box('ftyp', 8), index = box('sidx', 56), fragments = concat([box('mdat', 12), box('mdat', 12)]);
  const view = new DataView(index.buffer); view.setUint32(16, 1000); view.setUint16(30, 2);
  for (let i = 0; i < 2; i++) { view.setUint32(32 + i * 12, 12); view.setUint32(36 + i * 12, 60000); }
  const bytes = concat([init, index, fragments]);
  const video: Video = { ref: { platform: 'bilibili', id: 'BV1234567890', part: 1 }, title: 'Fixture', channel: '', channelId: '', published: '', duration: 120, views: 0, description: '', tracks: [], loginRequired: false, isLive: false,
    audio: async () => [{ url: 'https://test.bilivideo.com/audio', initEnd: 7, indexStart: 8, indexEnd: 63, identity: 'fixture' }] };
  return { video, bytes };
}
test('disabled recognition never accesses audio or a paid service', async () => {
  let calls = 0; const { video } = fixture();
  await assert.rejects(recognize(video, defaults(), async () => { calls++; throw new Error(); }, new AbortController().signal, new RecognitionCache(), () => {}), /Enable/);
  assert.equal(calls, 0);
});
test('failed recognition is not replayed automatically; retry resumes successful chunks', async () => {
  const { video, bytes } = fixture(); const s = defaults(); s.recognition = true; s.groqKey = 'fixture'; s.chunkSeconds = 60; s.concurrency = 1;
  const cache = new RecognitionCache(); let uploads = 0, fail = true;
  const transport: Transport = async input => {
    if (input.method === 'POST') {
      uploads++;
      if (uploads === 2 && fail) return { status: 503, headers: {}, bytes: new ArrayBuffer(0) };
      return { status: 200, headers: {}, bytes: new TextEncoder().encode(JSON.stringify({ segments: [{ start: 0, end: 1, text: `chunk ${uploads}` }] })).buffer };
    }
    assert.equal(input.headers?.Referer, 'https://www.bilibili.com/');
    assert.equal(input.headers?.['User-Agent'], 'Mozilla/5.0');
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  };
  const decoder = async () => new Uint8Array(44);
  await assert.rejects(recognize(video, s, transport, new AbortController().signal, cache, () => {}, decoder), /HTTP 503/);
  assert.equal(uploads, 2); fail = false; await cache.approveRetry();
  const result = await recognize(video, s, transport, new AbortController().signal, cache, () => {}, decoder);
  assert.equal(uploads, 3); assert.equal(result[0].text, 'chunk 1'); assert.equal(result[1].start, 58);
  await recognize(video, s, transport, new AbortController().signal, cache, () => {}, decoder); assert.equal(uploads, 3);
});
test('cache isolates recognition language, model and chunk plan', () => {
  const cache = new RecognitionCache(), { video } = fixture(), s = defaults();
  const original = cache.forVideo(video, s); original.set(0, [{ start: 0, end: 1, text: 'one' }]);
  assert.equal(cache.forVideo(video, { ...s, spokenLanguage: 'zh' }).size, 0);
  assert.equal(cache.forVideo(video, { ...s, model: 'other' }).size, 0);
  assert.equal(cache.forVideo(video, { ...s, chunkSeconds: 120 }).size, 0);
});
test('overlap merging removes a repeated seam without deleting later repetitions', () => {
  assert.deepEqual(joinChunks([[{ start: 0, end: 5, text: 'Hello world' }], [{ start: 4, end: 8, text: 'world again' }, { start: 10, end: 12, text: 'world again' }]]).map(s => s.text), ['Hello world', 'again', 'world again']);
});
test('seam matching does not delete part of a different English word', () => {
  assert.deepEqual(joinChunks([[{ start: 0, end: 5, text: 'the' }], [{ start: 4, end: 6, text: 'hello' }]]).map(s => s.text), ['the', 'hello']);
});

test('YouTube range downloads remove player framing parameters and send byte Range headers', async () => {
  const { video, bytes } = fixture(); video.ref = { platform: 'youtube', id: 'abcdefghijk', part: 1 };
  video.audio = async () => [{ url: 'https://r1.googlevideo.com/videoplayback?signature=keep&ump=1&srfvp=1&range=0-99&rn=2&rbuf=3&sabr=1&alr=1&cmo=sensitive', initEnd: 7, indexStart: 8, indexEnd: 63, identity: 'VISIONOS:140' }];
  const s = defaults(); s.recognition = true; s.groqKey = 'fixture'; s.concurrency = 1;
  let downloads = 0;
  await recognize(video, s, async input => {
    if (input.method === 'POST') return { status: 200, headers: {}, bytes: new TextEncoder().encode('{"text":"Recognized"}').buffer };
    const url = new URL(input.url); assert.equal(url.search, '?signature=keep');
    assert.match(input.headers!['User-Agent'], /youtube/); downloads++;
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  }, new AbortController().signal, new RecognitionCache(), () => {}, async () => new Uint8Array(44));
  assert.ok(downloads >= 3);
});
test('audio failures retain the HTTP cause and never upload broken audio', async () => {
  const { video } = fixture(); const s = defaults(); s.recognition = true; s.groqKey = 'fixture';
  let uploads = 0;
  await assert.rejects(recognize(video, s, async input => { if (input.method === 'POST') uploads++; return { status: 403, headers: {}, bytes: new ArrayBuffer(0) }; }, new AbortController().signal, new RecognitionCache(), () => {}), /Audio chunk .*HTTP 403/);
  assert.equal(uploads, 0);
});

test('YouTube refreshes refused signed audio URLs without replaying paid recognition', async () => {
  const { video, bytes } = fixture(); video.ref = { platform: 'youtube', id: 'abcdefghijk', part: 1 };
  let discoveries = 0, uploads = 0;
  video.audio = async () => [{ url: `https://r1.googlevideo.com/audio?generation=${++discoveries}`, initEnd: 7, indexStart: 8, indexEnd: 63, identity: 'VISIONOS:139' }];
  const s = defaults(); s.recognition = true; s.groqKey = 'fixture'; s.concurrency = 1;
  await recognize(video, s, async input => {
    if (input.method === 'POST') { uploads++; return { status: 200, headers: {}, bytes: new TextEncoder().encode('{"text":"Recognized"}').buffer }; }
    if (new URL(input.url).searchParams.get('generation') === '1') return { status: 403, headers: {}, bytes: new ArrayBuffer(0) };
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  }, new AbortController().signal, new RecognitionCache(), () => {}, async () => new Uint8Array(44));
  assert.equal(discoveries, 2); assert.equal(uploads, 1);
});

test('final audio window uses the indexed end for rounded metadata, but rejects a real gap', async () => {
  for (const duration of [120.5, 123]) {
    const { video, bytes } = fixture(); video.duration = duration;
    const s = defaults(); s.recognition = true; s.groqKey = 'fixture'; s.concurrency = 1;
    let decodedDuration = 0, uploads = 0;
    const job = recognize(video, s, async input => {
      if (input.method === 'POST') { uploads++; return { status: 200, headers: {}, bytes: new TextEncoder().encode('{"text":"Recognized"}').buffer }; }
      const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
      return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
    }, new AbortController().signal, new RecognitionCache(), () => {}, async (_bytes, _offset, seconds) => { decodedDuration = seconds; return new Uint8Array(44); });
    if (duration === 120.5) { await job; assert.equal(decodedDuration, 120); assert.equal(uploads, 1); }
    else { await assert.rejects(job, /index does not cover/); assert.equal(uploads, 0); }
  }
});

test('recognition uses transcription only and preserves returned Chinese text without translation or summary', async () => {
  const { video, bytes } = fixture(); const s = defaults(); s.recognition = true; s.groqKey = 'fixture'; s.chunkSeconds = 60; s.concurrency = 3;
  let calls = 0;
  const result = await recognize(video, s, async input => {
    if (input.method === 'POST') {
      assert.equal(input.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
      const body = new TextDecoder().decode(input.body as ArrayBuffer);
      assert.doesNotMatch(body, /name="prompt"|translate|summarize/);
      calls++; assert.doesNotMatch(body, /name="language"/);
      return { status: 200, headers: {}, bytes: new TextEncoder().encode(JSON.stringify({ language: 'chinese', segments: [{ start: 0, end: 2, text: calls === 1 ? '保留中文原话。' : '不翻译，不总结。' }] })).buffer };
    }
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  }, new AbortController().signal, new RecognitionCache(), () => {}, async () => new Uint8Array(44));
  assert.deepEqual(result.map(s => s.text), ['保留中文原话。', '不翻译，不总结。']);
});

test('media downloads use bounded parallel ranges in byte order without probing healthy-source backups', async () => {
  const { video, bytes } = fixture();
  const head = bytes.slice(0, 64); const view = new DataView(head.buffer);
  view.setUint32(8 + 32, 800000); view.setUint32(8 + 44, 800000);
  const media = new Uint8Array(1600000); const mediaView = new DataView(media.buffer);
  for (const offset of [0, 800000]) { mediaView.setUint32(offset, 800000); media.set(new TextEncoder().encode('mdat'), offset + 4); media.fill(offset ? 2 : 1, offset + 8, offset + 800000); }
  const all = concat([head, media]);
  const primary = (await video.audio())[0];
  video.audio = async () => [primary, { ...primary, url: 'https://backup.bilivideo.com/audio' }];
  const s = defaults(); s.recognition = true; s.groqKey = 'fixture'; s.concurrency = 1;
  let active = 0, peak = 0, uploads = 0;
  await recognize(video, s, async input => {
    if (input.method === 'POST') { uploads++; return { status: 200, headers: {}, bytes: new TextEncoder().encode('{"text":"原文"}').buffer }; }
    assert.equal(input.url, primary.url);
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!; const start = Number(match[1]), end = Number(match[2]);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, start % 3 + 1)); active--;
    assert.ok(end - start < 400000);
    return { status: 206, headers: {}, bytes: all.slice(start, end + 1).buffer };
  }, new AbortController().signal, new RecognitionCache(), () => {}, async data => {
    assert.deepEqual(data, concat([head.slice(0, 8), media])); return new Uint8Array(44);
  });
  assert.equal(peak, 4); assert.equal(uploads, 1);
});

test('YouTube reads the MP4 header when its client omits explicit index boundaries', async () => {
  const { video, bytes } = fixture(); video.ref = { platform: 'youtube', id: 'abcdefghijk', part: 1 };
  const media = new Uint8Array(16384); media.set(bytes);
  video.audio = async () => [{ url: 'https://r1.googlevideo.com/audio', initEnd: 16383, indexStart: 0, indexEnd: 16383, identity: 'fixture' }];
  const s = defaults(); s.recognition = true; s.groqKey = 'fixture';
  let headerReads = 0, uploads = 0;
  const result = await recognize(video, s, async input => {
    if (input.method === 'POST') { uploads++; return { status: 200, headers: {}, bytes: new TextEncoder().encode('{"text":"原文"}').buffer }; }
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    if (Number(match[1]) === 0) headerReads++;
    return { status: 206, headers: {}, bytes: media.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  }, new AbortController().signal, new RecognitionCache(), () => {}, async (audio, offset, duration) => {
    assert.deepEqual(audio, bytes); assert.equal(offset, 0); assert.equal(duration, 120); return new Uint8Array(44);
  });
  assert.equal(headerReads, 1); assert.equal(uploads, 1); assert.equal(result[0].text, '原文');
});

test('restart restores completed speech without downloading or paying again', async () => {
  const { video } = fixture(), s = defaults(); s.recognition = true; s.groqKey = 'fixture';
  const cache = new RecognitionCache(); cache.forVideo(video, s).set(0, [{ start: 0, end: 120, text: '已经完成' }]);
  const restored = new RecognitionCache(); restored.restore(JSON.parse(JSON.stringify(cache.snapshot())));
  let calls = 0; video.audio = async () => { calls++; throw Error('must not discover'); };
  const result = await recognize(video, s, async () => { calls++; throw Error('must not upload'); }, new AbortController().signal, restored, () => {});
  assert.equal(result[0].text, '已经完成'); assert.equal(calls, 0);
});
test('an uncertain paid request survives restart and requires explicit retry approval', async () => {
  const { video } = fixture(), s = defaults(); s.recognition = true; s.groqKey = 'fixture';
  const cache = new RecognitionCache(); cache.forVideo(video, s); await cache.submitted(video, s, 0);
  const restored = new RecognitionCache(); restored.restore(cache.snapshot());
  let calls = 0; video.audio = async () => { calls++; throw Error('must not discover'); };
  await assert.rejects(recognize(video, s, async () => { calls++; throw Error('must not upload'); }, new AbortController().signal, restored, () => {}), /already have been billed/);
  assert.equal(calls, 0); await restored.approveRetry(); assert.doesNotThrow(() => restored.assertSafe(video, s));
});

test('failure to durably record a submission prevents the paid POST', async () => {
  const { video, bytes } = fixture(); const s = defaults(); s.recognition = true; s.groqKey = 'fixture';
  let uploads = 0;
  const cache = new RecognitionCache(async () => { throw Error('Checkpoint disk full'); });
  await assert.rejects(recognize(video, s, async input => {
    if (input.method === 'POST') { uploads++; throw Error('Must not submit'); }
    const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  }, new AbortController().signal, cache, () => {}, async () => new Uint8Array(44)), /Checkpoint disk full/);
  assert.equal(uploads, 0);
});

test('approved retry reuses already decoded audio without discovery or download', async () => {
  const { video, bytes } = fixture(); const s = defaults(); s.recognition = true; s.groqKey = 'fixture';
  let discovery = 0, downloads = 0, uploads = 0;
  const audio = video.audio; video.audio = async () => { discovery++; return audio(); };
  const cache = new RecognitionCache();
  const transport: Transport = async input => {
    if (input.method === 'POST') { uploads++; return uploads === 1 ? { status: 503, headers: {}, bytes: new ArrayBuffer(0) } : { status: 200, headers: {}, bytes: new TextEncoder().encode('{"text":"Recovered"}').buffer }; }
    downloads++; const match = input.headers!.Range.match(/bytes=(\d+)-(\d+)/)!;
    return { status: 206, headers: {}, bytes: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  };
  const run = () => recognize(video, s, transport, new AbortController().signal, cache, () => {}, async () => new Uint8Array(44));
  await assert.rejects(run()); const count = downloads;
  await cache.approveRetry(); await run();
  assert.equal(discovery, 1); assert.equal(downloads, count); assert.equal(uploads, 2);
});
