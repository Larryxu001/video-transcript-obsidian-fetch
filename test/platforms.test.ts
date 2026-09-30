import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platforms } from '../src/platforms.ts';
import { checkedUrl, embeddedObject, request, delay } from '../src/http.ts';
import type { Transport, HttpReply } from '../src/http.ts';
import type { VideoRef } from '../src/model.ts';

export function reply(value: unknown, status = 200): HttpReply {
  return { status, headers: {}, bytes: new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer };
}
test('embedded JSON handles quoted braces without evaluating scripts', () => {
  assert.deepEqual(embeddedObject('window.value={"a":"}\\\"{","nested":{"x":2}}; dangerous()', 'window.value'), { a: '}"{', nested: { x: 2 } });
});
test('credentialed and unrelated caption URLs are rejected', () => {
  for (const url of ['https://secret@youtube.com/a', 'https://youtube.com.evil.test/a', 'http://youtube.com/a', 'https://youtube.com:8443/a']) assert.throws(() => checkedUrl(url, ['youtube.com']));
});
test('aborted operations do not issue HTTP requests', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(request(async () => { calls++; return reply({}); }, controller.signal, { url: 'https://youtube.com' })); assert.equal(calls, 0);
});
test('abort interrupts backoff promptly', async () => {
  const controller = new AbortController(); const waiting = delay(30000, controller.signal); controller.abort(); await assert.rejects(waiting, /Cancelled/);
});
test('Bilibili reuses page metadata, preserves parts, and sends cookies only to the API', async () => {
  const calls: { url: string; cookie?: string }[] = [];
  const transport: Transport = async input => {
    calls.push({ url: input.url, cookie: input.headers?.Cookie });
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__=' + JSON.stringify({ videoData: { cid: 1, title: 'Title', pages: [{ cid: 1 }, { cid: 2, duration: 10, part: 'Part two' }], owner: { name: 'Author' } } }));
    if (input.url.includes('/x/player/')) return reply({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/test' }] } } });
    return reply({ body: [{ from: 0, to: 3, content: '测试字幕' }] });
  };
  const platforms = new Platforms(transport, 'fixture-session', new AbortController().signal);
  const video = await platforms.load({ platform: 'bilibili', id: 'BV1234567890', part: 2 });
  const segments = await platforms.captions(video, video.tracks[0]);
  assert.equal(segments[0].text, '测试字幕'); assert.ok(calls.some(call => call.url.includes('cid=2') && call.cookie === 'fixture-session')); assert.equal(calls.at(-1)!.cookie, undefined);
});
test('empty advertised captions fail explicitly instead of looking absent', async () => {
  const platforms = new Platforms(async () => reply({ body: [] }), '', new AbortController().signal);
  await assert.rejects(platforms.captions({ ref: { platform: 'bilibili' } } as never, { language: 'zh', name: 'zh', url: 'https://aisubtitle.hdslb.com/test' }), /empty/);
});
test('YouTube captions come from the advertised track and JSON3 timestamps', async () => {
  const transport: Transport = async input => input.url.includes('timedtext') ? reply({ events: [{ tStartMs: 1200, dDurationMs: 900, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] }] }) : reply('var ytInitialPlayerResponse=' + JSON.stringify({ videoDetails: { title: 'Example', lengthSeconds: '60' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?id=abc' }] } } }));
  const platform = new Platforms(transport, '', new AbortController().signal);
  const video = await platform.load({ platform: 'youtube', id: 'abcdefghijk', part: 1 } as VideoRef);
  assert.deepEqual(await platform.captions(video, video.tracks[0]), [{ start: 1.2, end: 2.1, text: 'Hello world' }]);
});
test('Bilibili keeps HTTPS backups when its primary media URL uses a P2P port', async () => {
  const transport: Transport = async input => {
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__=' + JSON.stringify({ videoData: { cid: 1, title: 'Title' } }));
    if (input.url.includes('playurl')) return reply({ code: 0, data: { dash: { audio: [{ id: 30216, mimeType: 'audio/mp4', baseUrl: 'https://example.mcdn.bilivideo.cn:8082/audio', backupUrl: ['https://cdn.bilivideo.com/audio'], SegmentBase: { Initialization: '0-99', indexRange: '100-155' } }] } } });
    return reply({ code: 0, data: { subtitle: { subtitles: [] } } });
  };
  const platform = new Platforms(transport, '', new AbortController().signal);
  const video = await platform.load({ platform: 'bilibili', id: 'BV1234567890', part: 1 });
  const sources = await video.audio(); assert.equal(sources.length, 1); assert.equal(sources[0].url, 'https://cdn.bilivideo.com/audio');
});

test('YouTube supplies visitor context and prefers a working API caption over the blocked web URL', async () => {
  let sawVisitor = false;
  const transport: Transport = async input => {
    if (input.url.includes('/watch')) return reply('"VISITOR_DATA":"visitor-fixture"; var ytInitialPlayerResponse=' + JSON.stringify({ videoDetails: { title: 'Example' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?source=blocked-web' }] } } }));
    if (input.method === 'POST') {
      const body = JSON.parse(String(input.body));
      sawVisitor = body.context.client.visitorData === 'visitor-fixture' && input.headers?.['X-Goog-Visitor-Id'] === 'visitor-fixture' && input.headers?.['X-YouTube-Client-Name'] === '28';
      return reply({ videoDetails: { title: 'Example' }, playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?source=vr&signature=retain' }] } } });
    }
    assert.equal(new URL(input.url).searchParams.get('source'), 'vr');
    assert.equal(new URL(input.url).searchParams.has('fmt'), false);
    assert.match(input.headers!.Referer, /watch\?v=/);
    return reply({ events: [{ tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Recovered' }] }] });
  };
  const platform = new Platforms(transport, '', new AbortController().signal);
  const video = await platform.load({ platform: 'youtube', id: 'LHK4FRpc0eQ', part: 1 });
  assert.equal((await platform.captions(video, video.tracks[0]))[0].text, 'Recovered');
  assert.ok(sawVisitor);
});

test('YouTube tries another client when advertised captions are empty in every format', async () => {
  const transport: Transport = async input => {
    if (input.url.includes('/watch')) return reply('unavailable page');
    if (input.method === 'POST') {
      const client = JSON.parse(String(input.body)).context.client.clientName;
      return reply({ videoDetails: { title: 'Example' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: `https://www.youtube.com/api/timedtext?client=${client}` }] } } });
    }
    return new URL(input.url).searchParams.get('client') === 'ANDROID' ? reply({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Alternate client' }] }] }) : reply('');
  };
  const platform = new Platforms(transport, '', new AbortController().signal);
  const video = await platform.load({ platform: 'youtube', id: 'LHK4FRpc0eQ', part: 1 });
  assert.equal((await platform.captions(video, video.tracks[0]))[0].text, 'Alternate client');
});

test('Bilibili retains multiple audio qualities and their independent indexes for fallback', async () => {
  const transport: Transport = async input => {
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__=' + JSON.stringify({ videoData: { cid: 1, title: 'Title' } }));
    if (input.url.includes('playurl')) return reply({ code: 0, data: { dash: { audio: [
      { id: 2, bandwidth: 100, mimeType: 'audio/mp4', baseUrl: 'https://cdn.bilivideo.com/high', SegmentBase: { Initialization: '0-99', indexRange: '100-200' } },
      { id: 1, bandwidth: 50, mimeType: 'audio/mp4', baseUrl: 'https://cdn.bilivideo.com/low', SegmentBase: { Initialization: '0-79', indexRange: '80-180' } },
    ] } } });
    return reply({ code: 0, data: { subtitle: { subtitles: [] } } });
  };
  const platform = new Platforms(transport, '', new AbortController().signal);
  const video = await platform.load({ platform: 'bilibili', id: 'BV1234567890', part: 1 });
  const sources = await video.audio();
  assert.deepEqual(sources.map(s => [new URL(s.url).pathname, s.indexStart]), [['/low', 80], ['/high', 100]]);
});

test('Bilibili retains page captions when player APIs return empty lists', async () => {
  const transport: Transport = async input => {
    if (input.url.includes('/video/')) {
      assert.equal(input.headers?.Cookie, 'fixture');
      return reply('window.__INITIAL_STATE__=' + JSON.stringify({ videoData: { aid: 42, cid: 1, subtitle: { list: [{ lan: 'zh', subtitle_url: 'https://aisubtitle.hdslb.com/zh' }] } } }));
    }
    if (input.url.includes('/nav')) return reply({ code: 0, data: {} });
    assert.match(input.url, /bvid=BV1D3h46BEax/);
    return reply({ code: 0, data: { login_mid: 123, subtitle: { subtitles: [] } } });
  };
  const video = await new Platforms(transport, 'fixture', new AbortController().signal).load({ platform: 'bilibili', id: 'BV1D3h46BEax', part: 1 });
  assert.equal(video.tracks[0].language, 'zh');
});
test('Bilibili checks alternate subtitle endpoint before declaring no captions', async () => {
  const transport: Transport = async input => {
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__={"videoData":{"aid":42,"cid":1}}');
    return reply({ code: 0, data: { login_mid: 123, subtitle: { subtitles: input.url.includes('/wbi/') ? [{ lan: 'ai-zh', subtitle_url: 'https://aisubtitle.hdslb.com/zh' }] : [] } } });
  };
  const video = await new Platforms(transport, 'fixture', new AbortController().signal).load({ platform: 'bilibili', id: 'BV1D3h46BEax', part: 1 });
  assert.equal(video.tracks[0].language, 'ai-zh');
});
test('Bilibili does not equate a rejected session with a video having no subtitles', async () => {
  const transport: Transport = async input => input.url.includes('/video/') ? reply('window.__INITIAL_STATE__={"videoData":{"cid":1}}') : reply({ code: 0, data: { login_mid: 0, need_login_subtitle: true, subtitle: { subtitles: [] } } });
  const video = await new Platforms(transport, 'expired-fixture', new AbortController().signal).load({ platform: 'bilibili', id: 'BV1D3h46BEax', part: 1 });
  assert.equal(video.loginRequired, true);
});

test('YouTube reports the actual platform restriction rather than hiding it as missing metadata', async () => {
  const platform = new Platforms(async input => input.method === 'POST' ? reply({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' } }) : reply('var ytInitialPlayerResponse={"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you are not a bot"}}'), '', new AbortController().signal);
  await assert.rejects(platform.load({ platform: 'youtube', id: 'eUPPQVdPIbw', part: 1 }), /browser verification/);
});
test('YouTube can obtain video metadata from VISIONOS when other clients are rejected', async () => {
  const platform = new Platforms(async input => {
    if (!input.body) return reply('unavailable');
    const client = JSON.parse(String(input.body)).context.client;
    if (client.clientName === 'ANDROID') assert.equal(client.clientVersion, '21.26.364');
    if (client.clientName === 'IOS') assert.equal(client.clientVersion, '21.26.4');
    return client.clientName === 'VISIONOS' ? reply({ videoDetails: { title: 'Recovered metadata', lengthSeconds: '60' }, playabilityStatus: { status: 'OK' } }) : reply({ playabilityStatus: { status: 'ERROR' } });
  }, '', new AbortController().signal);
  assert.equal((await platform.load({ platform: 'youtube', id: 'eUPPQVdPIbw', part: 1 })).title, 'Recovered metadata');
});


test('Bilibili subtitle lookup uses the requested BVID even when numeric AID is present', async () => {
  const p = new Platforms(async input => {
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__={"videoData":{"aid":117318122280800,"cid":42124708898,"duration":281}}');
    if (input.url.includes('/nav')) return reply({ code: 0, data: {} });
    const url = new URL(input.url); assert.equal(url.searchParams.get('bvid'), 'BV1D3h46BEax'); assert.equal(url.searchParams.has('aid'), false);
    return reply({ code: 0, data: { login_mid: 123, subtitle: { subtitles: [] } } });
  }, 'fixture', new AbortController().signal);
  await p.load({ platform: 'bilibili', id: 'BV1D3h46BEax', part: 1 });
});
test('Bilibili does not import a mismatched subtitle timeline', async () => {
  const p = new Platforms(async () => reply({ body: [{ from: 1110, to: 1114, content: 'Wrong video' }] }), '', new AbortController().signal);
  await assert.rejects(p.captions({ ref: { platform: 'bilibili' }, duration: 281 } as never, { language: 'ai-zh', name: 'Chinese', url: 'https://aisubtitle.hdslb.com/test' }), /outside this video/);
});

test('Bilibili uses nav WBI keys for the actual player subtitle request', async () => {
  const queries: string[] = [];
  const p = new Platforms(async input => {
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__={"videoData":{"aid":42,"cid":1}}');
    if (input.url.includes('/nav')) return reply({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/0123456789abcdef0123456789abcdef.png', sub_url: 'https://i0.hdslb.com/fedcba9876543210fedcba9876543210.png' } } });
    queries.push(input.url);
    return reply({ code: 0, data: { login_mid: 123, subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://aisubtitle.hdslb.com/zh' }] } } });
  }, 'fixture', new AbortController().signal);
  await p.load({ platform: 'bilibili', id: 'BV1D3h46BEax', part: 1 });
  assert.equal(queries.length, 1);
  const url = new URL(queries[0]); assert.equal(url.pathname, '/x/player/wbi/v2');
  assert.equal(url.searchParams.get('bvid'), 'BV1D3h46BEax');
  assert.match(url.searchParams.get('w_rid')!, /^[a-f0-9]{32}$/); assert.ok(Number(url.searchParams.get('wts')) > 0);
});

test('an empty signed caption response uses current web metadata without querying legacy v2', async () => {
  const calls: string[] = [];
  const field = (id: number, value: string | number[]) => { const bytes = typeof value === 'string' ? [...new TextEncoder().encode(value)] : value; return [id * 8 + 2, bytes.length, ...bytes]; };
  const track = [...field(3, 'ai-zh'), ...field(4, 'Chinese'), ...field(5, '//aisubtitle.hdslb.com/current')];
  const p = new Platforms(async input => {
    calls.push(new URL(input.url).pathname);
    if (input.url.includes('/video/')) return reply('window.__INITIAL_STATE__={"videoData":{"aid":42,"cid":1}}');
    if (input.url.includes('/nav')) return reply({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/0123456789abcdef0123456789abcdef.png', sub_url: 'https://i0.hdslb.com/fedcba9876543210fedcba9876543210.png' } } });
    if (input.url.includes('/subtitle/web/view')) return { status: 200, headers: {}, bytes: new Uint8Array(field(1, field(3, track))).buffer };
    return reply({ code: 0, data: { login_mid: 123, subtitle: { subtitles: [] } } });
  }, 'fixture', new AbortController().signal);
  const video = await p.load({ platform: 'bilibili', id: 'BV1D3h46BEax', part: 1 });
  assert.equal(video.tracks[0].url, 'https://aisubtitle.hdslb.com/current');
  assert.ok(calls.includes('/x/v2/subtitle/web/view'));
  assert.ok(!calls.includes('/x/player/v2'));
});

test('YouTube preserves 2.0.1 lowercase visitor discovery and bounds audio probing to two sources', async () => {
  let audio = false; const clients: string[] = [];
  const platform = new Platforms(async input => {
    if (!input.body) return reply('"visitorData":"lowercase-visitor"');
    const client = JSON.parse(String(input.body)).context.client;
    assert.equal(client.visitorData, 'lowercase-visitor');
    assert.equal(input.headers?.['X-Goog-Visitor-Id'], 'lowercase-visitor');
    if (audio) clients.push(client.clientName);
    return reply({ videoDetails: { title: 'Fixture', lengthSeconds: '60' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en' }] } }, streamingData: { adaptiveFormats: [{ itag: 140, url: 'https://rr1.googlevideo.com/videoplayback', mimeType: 'audio/mp4', initRange: { end: '99' }, indexRange: { start: '100', end: '199' } }] } });
  }, '', new AbortController().signal);
  const video = await platform.load({ platform: 'youtube', id: 'eUPPQVdPIbw', part: 1 });
  audio = true;
  assert.equal((await video.audio()).length, 2);
  assert.deepEqual(clients, ['VISIONOS', 'IOS']);
});
test('YouTube retains the 2.0.1 embedded TV and mobile web audio fallbacks', async () => {
  for (const working of ['TVHTML5_SIMPLY_EMBEDDED_PLAYER', 'MWEB']) {
    let audio = false; let found = false;
    const platform = new Platforms(async input => {
      if (!input.body) return reply('"VISITOR_DATA":"fixture"');
      const body = JSON.parse(String(input.body)); const client = body.context.client;
      if (!audio) return reply({ videoDetails: { title: 'Fixture' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://youtube.com/api/timedtext?lang=en' }] } } });
      if (client.clientName !== working) return reply({ playabilityStatus: { status: 'UNPLAYABLE' } });
      found = true;
      if (working === 'MWEB') { assert.equal(input.headers?.['X-YouTube-Client-Name'], '2'); assert.match(input.headers!['User-Agent'], /Mobile/); }
      else { assert.equal(body.context.thirdParty.embedUrl, 'https://www.youtube.com/'); assert.match(input.headers!['User-Agent'], /SMART-TV/); }
      return reply({ streamingData: { adaptiveFormats: [{ itag: 140, url: 'https://rr1.googlevideo.com/videoplayback', mimeType: 'audio/mp4', initRange: { end: '99' }, indexRange: { start: '100', end: '199' } }] } });
    }, '', new AbortController().signal);
    const video = await platform.load({ platform: 'youtube', id: 'eUPPQVdPIbw', part: 1 }); audio = true;
    assert.equal((await video.audio()).length, 1); assert.ok(found);
  }
});

test('YouTube does not discard audio URLs when initRange and indexRange are omitted', async () => {
  const platform = new Platforms(async input => input.body ? reply({ videoDetails: { title: 'Fixture' }, streamingData: { adaptiveFormats: [{ itag: 139, mimeType: 'audio/mp4', url: 'https://r1.googlevideo.com/audio' }] } }) : reply(''), '', new AbortController().signal);
  const video = await platform.load({ platform: 'youtube', id: 'abcdefghijk', part: 1 });
  const sources = await video.audio();
  assert.equal(sources.length, 2); assert.equal(sources[0].indexStart, 0); assert.equal(sources[0].indexEnd, 16383);
});
