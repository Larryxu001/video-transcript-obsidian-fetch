import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'vtf-next-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const stub = resolve('test/obsidian-stub.ts');
await build({ stdin: { contents: "export { default } from './src/main.ts'; export { LoginModal, sessionCookie, readAccount } from './src/login.ts'; export { TranscriptSettings } from './src/ui.ts'; export { Setting, TFile, TFolder, MarkdownView } from 'obsidian';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: join(directory, 'plugin.mjs'), alias: { obsidian: stub }, logLevel: 'silent' });
const { default: Plugin, TFile, TFolder, MarkdownView, LoginModal, sessionCookie, readAccount, TranscriptSettings, Setting } = await import(pathToFileURL(join(directory, 'plugin.mjs')).href);

function fixture() {
  const plugin = new Plugin();
  const files = new Map(); const contents = new Map<string, string>();
  const app = {
    vault: {
      read: async (file: { path: string }) => contents.get(file.path) || '',
      getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile),
      getAbstractFileByPath: (path: string) => files.get(path),
      createFolder: async (path: string) => { files.set(path, new TFolder(path)); },
      create: async (path: string, content: string) => { const file = new TFile(path); files.set(path, file); contents.set(path, content); return file; },
    },
    metadataCache: { getFileCache: (file: { path: string }) => ({ frontmatter: { url: contents.get(file.path)?.match(/"url": "([^"]+)"/)?.[1] } }) },
    workspace: { getActiveViewOfType: () => null as InstanceType<typeof MarkdownView> | null, getLeaf: () => ({ openFile: async (_file: unknown) => {} }) },
  };
  plugin.app = app;
  let captionReads = 0;
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = async (input: { url: string }) => {
    if (input.url.includes('timedtext')) captionReads++;
    const data = input.url.includes('timedtext') ? JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Original words' }] }] }) : 'var ytInitialPlayerResponse=' + JSON.stringify({ videoDetails: { title: 'Example', lengthSeconds: '1' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext' }] } } });
    return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(data).buffer };
  };
  return { plugin, files, contents, app, captionReads: () => captionReads };
}
const options = { urls: ['https://youtu.be/abcdefghijk'], createNote: true, directory: 'Videos/2026', language: '', includeUrl: false, channelTag: false };
test('actual plugin creates folders and exactly one Markdown note from legacy multi-format preferences', async () => {
  const f = fixture(); f.plugin.data = { fileFormats: ['markdown', 'pdf', 'srt'] }; await f.plugin.onload(); f.plugin.network.spacing = 0;
  await f.plugin.run(options);
  assert.deepEqual([...f.contents.keys()], ['Videos/2026/Example.md']); assert.match([...f.contents.values()][0], /Original words/); assert.equal(f.captionReads(), 1);
});
test('existing transcript is detected before fetching captions or creating notes', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; f.plugin.settings.duplicates = true;
  await f.plugin.run(options); await f.plugin.run(options);
  assert.equal(f.contents.size, 1); assert.equal(f.captionReads(), 1);
});
test('a repeated URL in one batch is handled once even with duplicate checking disabled', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; await f.plugin.run({ ...options, urls: [...options.urls, ...options.urls] });
  assert.equal(f.contents.size, 1); assert.equal(f.captionReads(), 1);
});
test('unrelated filename collisions preserve the existing file', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; f.files.set('Videos/2026/Example.md', new TFile('Videos/2026/Example.md')); f.contents.set('Videos/2026/Example.md', 'Keep this');
  await f.plugin.run(options);
  assert.equal(f.contents.get('Videos/2026/Example.md'), 'Keep this'); assert.ok(f.contents.has('Videos/2026/Example (1).md'));
});
test('insertion targets the active editor and does not create a file', async () => {
  const f = fixture(); const view = new MarkdownView(); view.file = new TFile('Current.md'); let inserted = '';
  view.editor.replaceSelection = (text: string) => { inserted = text; }; f.app.workspace.getActiveViewOfType = () => view;
  await f.plugin.onload(); f.plugin.network.spacing = 0; await f.plugin.run({ ...options, createNote: false });
  assert.match(inserted, /Original words/); assert.equal(f.contents.size, 0);
});
test('unloading aborts the running import and prevents note writes after its network response arrives', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0;
  let release: (value: unknown) => void = () => {};
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = () => new Promise(resolve => { release = resolve; });
  const work = f.plugin.run(options); f.plugin.onunload();
  release({ status: 200, headers: {}, arrayBuffer: new TextEncoder().encode('{}').buffer });
  await work; assert.equal(f.contents.size, 0);
});
test('an old retry callback cannot start a new job after the plugin is disabled', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; f.plugin.onunload(); await f.plugin.run(options); assert.equal(f.contents.size, 0); assert.equal(f.captionReads(), 0);
});
test('QR login uses Set-Cookie and keeps only recognized session fields', () => {
  const value = sessionCookie({ 'set-cookie': 'SESSDATA=fixture; Path=/; Secure\nbili_jct=csrf; Path=/\nother=discard; Path=/' });
  assert.equal(value, 'SESSDATA=fixture; bili_jct=csrf'); assert.throws(() => sessionCookie({}), /no session/);
});
test('closing a QR modal while its first request is pending prevents later rendering and polling', async () => {
  let release: (value: unknown) => void = () => {}; let requests = 0, saved = false;
  const modal = new LoginModal({}, async () => { requests++; return new Promise(resolve => { release = resolve; }); }, async () => { saved = true; }, () => {});
  modal.onOpen(); modal.onClose();
  release({ status: 200, headers: {}, bytes: new TextEncoder().encode(JSON.stringify({ code: 0, data: { url: 'https://example.com', qrcode_key: 'fixture' } })).buffer });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(requests, 1); assert.equal(saved, false);
});

test('QR login accepts case-insensitive headers and the trusted callback fallback', () => {
  assert.equal(sessionCookie({ 'Set-Cookie': 'SESSDATA=fixture; Path=/' }), 'SESSDATA=fixture');
  assert.equal(sessionCookie({}, 'https://passport.bilibili.com/callback?SESSDATA=fixture%252Cvalue&bili_jct=csrf'), 'SESSDATA=fixture%2Cvalue; bili_jct=csrf');
  assert.throws(() => sessionCookie({}, 'https://bilibili.com.evil.test/?SESSDATA=fixture'));
  assert.throws(() => sessionCookie({}, 'https://passport.bilibili.com/?SESSDATA=bad%0D%0Avalue'));
});

test('QR generation renders a code with browser login headers and stops polling on close', async () => {
  let requestCount = 0, darkSquares = 0;
  const modal = new LoginModal({}, async (input: { headers?: Record<string,string> }) => {
    requestCount++;
    assert.match(input.headers!['User-Agent'], /Mozilla/);
    assert.equal(input.headers!.Referer, 'https://www.bilibili.com/');
    return { status: 200, headers: {}, bytes: new TextEncoder().encode(JSON.stringify({ code: 0, data: { url: 'https://passport.bilibili.com/test?key=fixture', qrcode_key: 'fixture' } })).buffer };
  }, async () => {}, () => {});
  modal.contentEl.createDiv = () => ({ createEl: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => { darkSquares++; } }) }) });
  modal.onOpen();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(darkSquares > 100); modal.onClose();
  assert.equal(requestCount, 1);
});

test('new note from an active root note accepts Obsidian root parent slash', async () => {
  const f = fixture(); const view = new MarkdownView(); view.file = new TFile('Welcome.md'); view.file.parent.path = '/';
  f.app.workspace.getActiveViewOfType = () => view;
  await f.plugin.onload(); f.plugin.network.spacing = 0; await f.plugin.run({ ...options, directory: '' });
  assert.ok(f.contents.has('Example.md')); assert.equal(f.captionReads(), 1);
});
test('explicit root folder creates a root note', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; await f.plugin.run({ ...options, directory: '/' });
  assert.ok(f.contents.has('Example.md'));
});
test('invalid output folders fail before caption requests', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; await f.plugin.run({ ...options, directory: '/Users/somewhere' });
  assert.equal(f.captionReads(), 0); assert.equal(f.contents.size, 0);
});

test('Bilibili account verification returns identity and detects expired sessions', async () => {
  let calls = 0;
  const transport = async (input: { url: string; headers: Record<string, string> }) => {
    assert.equal(input.url, 'https://api.bilibili.com/x/web-interface/nav');
    assert.equal(input.headers.Cookie, 'fixture-session'); calls++;
    return { status: 200, headers: {}, bytes: new TextEncoder().encode(JSON.stringify(calls === 1 ? { code: 0, data: { isLogin: true, uname: 'Test account', mid: 123 } } : { code: -101 })).buffer };
  };
  assert.deepEqual(await readAccount(transport, 'fixture-session', new AbortController().signal), { signedIn: true, name: 'Test account', id: '123' });
  assert.deepEqual(await readAccount(transport, 'fixture-session', new AbortController().signal), { signedIn: false, name: '', id: '' });
});

test('settings show verified Bilibili identity and Signed in, and sign-out clears the record', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; f.plugin.settings.cookie = 'fixture-session';
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = async () => ({ status: 200, headers: {}, arrayBuffer: new TextEncoder().encode('{"code":0,"data":{"isLogin":true,"uname":"Test account","mid":123}}').buffer });
  const tab = new TranscriptSettings(f.app, f.plugin); tab.display();
  await new Promise(resolve => setTimeout(resolve, 10));
  const account = Setting.rows.findLast((row: { name: string }) => row.name === 'Account');
  assert.equal(account.buttons[0].text, 'Signed in'); assert.equal(account.buttons[0].disabled, true);
  assert.match(account.description, /Test account.*123/); assert.equal(f.plugin.settings.accountName, 'Test account');
  account.buttons[1].click();
  assert.equal(f.plugin.settings.cookie, ''); assert.equal(f.plugin.settings.accountName, '');
  const signedOut = Setting.rows.findLast((row: { name: string }) => row.name === 'Account');
  assert.equal(signedOut.buttons[0].text, 'Sign in with QR code'); tab.hide();
});

test('login-gated Bilibili captions finish discovery before enabled recognition discovers audio', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; f.plugin.settings.cookie = 'expired-fixture'; f.plugin.settings.recognition = true; f.plugin.settings.groqKey = 'fixture';
  let paidCalls = 0, audioCalls = 0; const queries: string[] = [];
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = async (input: { url: string }) => {
    if (input.url.includes('groq')) paidCalls++;
    if (input.url.includes('/x/player/')) queries.push(input.url);
    if (input.url.includes('playurl')) audioCalls++;
    const data = input.url.includes('/video/') ? 'window.__INITIAL_STATE__={"videoData":{"cid":1,"duration":60}}' : JSON.stringify({ code: 0, data: { login_mid: 0, need_login_subtitle: true, subtitle: { subtitles: [] } } });
    return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(data).buffer };
  };
  await f.plugin.run({ ...options, urls: ['https://www.bilibili.com/video/BV1D3h46BEax/'] });
  assert.equal(audioCalls, 1); assert.match(queries[0], /player\/wbi\/v2/); assert.equal(queries.length, 2); assert.match(queries[1], /playurl/); assert.equal(paidCalls, 0); assert.equal(f.contents.size, 0);
});
test('Chinese Bilibili platform captions produce Chinese notes without audio or recognition', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0; f.plugin.settings.cookie = 'fixture'; f.plugin.settings.recognition = true; f.plugin.settings.groqKey = 'fixture';
  let paidCalls = 0, audioCalls = 0;
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = async (input: { url: string }) => {
    if (input.url.includes('groq')) paidCalls++;
    if (input.url.includes('playurl')) audioCalls++;
    const data = input.url.includes('/video/') ? 'window.__INITIAL_STATE__={"videoData":{"cid":1,"title":"测试","duration":60}}' : input.url.includes('hdslb.com') ? JSON.stringify({ body: [{ from: 0, to: 2, content: input.url.endsWith('/zh') ? '这是原始中文逐字稿。' : 'English translation' }] }) : JSON.stringify({ code: 0, data: { login_mid: 123, subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://aisubtitle.hdslb.com/zh' }, { lan: 'ai-en', subtitle_url: 'https://aisubtitle.hdslb.com/en' }] } } });
    return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(data).buffer };
  };
  await f.plugin.run({ ...options, urls: ['https://www.bilibili.com/video/BV1D3h46BEax/'] });
  assert.equal(audioCalls, 0); assert.equal(paidCalls, 0); assert.equal(f.contents.size, 1);
  assert.match([...f.contents.values()][0], /这是原始中文逐字稿/); assert.doesNotMatch([...f.contents.values()][0], /English translation/);
});

for (const failure of ['query', 'read', 'login']) {
  for (const enabled of [false, true]) {
    test(`Bilibili ${failure} failure uses audio fallback only when recognition is enabled: ${enabled}`, async () => {
      const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0;
      f.plugin.settings.cookie = 'fixture'; f.plugin.settings.recognition = enabled; f.plugin.settings.groqKey = 'fixture';
      let audioCalls = 0, paidCalls = 0;
      (globalThis as unknown as { requestFixture: unknown }).requestFixture = async (input: { url: string }) => {
        if (input.url.includes('groq')) paidCalls++;
        if (input.url.includes('playurl')) audioCalls++;
        const data = input.url.includes('/video/') ? 'window.__INITIAL_STATE__={"videoData":{"cid":1,"duration":60}}'
          : input.url.includes('hdslb.com') ? JSON.stringify({ body: [] })
          : failure === 'query' && !input.url.includes('playurl') ? JSON.stringify({ code: -101 })
          : JSON.stringify({ code: 0, data: { login_mid: failure === 'login' ? 0 : 123, subtitle: { subtitles: failure === 'read' ? [{ lan: 'ai-zh', subtitle_url: 'https://aisubtitle.hdslb.com/zh' }] : [] } } });
        return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(data).buffer };
      };
      await f.plugin.run({ ...options, urls: ['https://www.bilibili.com/video/BV1D3h46BEax/'] });
      assert.equal(audioCalls, enabled ? 1 : 0);
      // No supported audio is supplied by this fixture; paid requests must not start.
      assert.equal(paidCalls, 0); assert.equal(f.contents.size, 0);
    });
  }
}

test('a paused batch survives plugin restart and skips the note already written', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0;
  const raw = (globalThis as unknown as { requestFixture: (input: { url: string }) => Promise<unknown> }).requestFixture;
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = async (input: { url: string }) => {
    if (input.url.includes('bbbbbbbbbbb')) return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode('var ytInitialPlayerResponse={"playabilityStatus":{"reason":"Sign in to confirm you are not a bot"}}').buffer };
    return raw(input);
  };
  await f.plugin.run({ ...options, urls: ['https://youtu.be/abcdefghijk', 'https://youtu.be/bbbbbbbbbbb'] });
  assert.equal(f.contents.size, 1);
  const saved = structuredClone(f.plugin.saved); f.plugin.onunload();
  const restored = new Plugin(); restored.app = f.app; restored.data = saved; await restored.onload(); restored.network.spacing = 0;
  let firstVideoReads = 0;
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = async (input: { url: string }) => { if (input.url.includes('abcdefghijk')) firstVideoReads++; return raw(input); };
  await restored.resume();
  assert.equal(firstVideoReads, 0); assert.equal(f.contents.size, 2); assert.equal(restored.saved._progress, undefined);
});
test('a saved note write intent is recovered without duplicate creation or platform requests', async () => {
  const f = fixture(); await f.plugin.onload(); f.plugin.network.spacing = 0;
  const path = 'Videos/2026/Existing.md', content = 'Already saved';
  f.files.set(path, new TFile(path)); f.contents.set(path, content);
  f.plugin.progress = { options, index: 0, completed: [], fallback: '', settings: f.plugin.settings, write: { key: 'youtube:abcdefghijk', path, content } };
  // Use the same canonical key as the production parser.
  f.plugin.progress.write.key = 'youtube:abcdefghijk:1';
  await f.plugin.persist();
  const restored = new Plugin(); restored.app = f.app; restored.data = structuredClone(f.plugin.saved); await restored.onload(); restored.network.spacing = 0;
  let requests = 0;
  (globalThis as unknown as { requestFixture: unknown }).requestFixture = () => { requests++; throw Error('Must recover without network'); };
  await restored.resume(); assert.equal(f.contents.size, 1); assert.equal(requests, 0);
});
test('checkpoint storage failure prevents a paid request from being sent', async () => {
  // The paid pipeline has its own durable pre-submit barrier, separately tested in recognition tests.
  const f = fixture(); await f.plugin.onload(); f.plugin.saveData = async () => { throw Error('Disk full'); };
  await f.plugin.run(options); assert.equal(f.contents.size, 0); assert.equal(f.captionReads(), 0);
});
