import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, preferences, parseVideo, watchUrl, videoKey, chooseTrack } from '../src/model.ts';
import { safeName, vaultPath, expand, renderNote, renderBody } from '../src/note.ts';
import type { Video } from '../src/model.ts';

export const video: Video = { ref: { platform: 'bilibili', id: 'BV1234567890', part: 2 }, title: '测试视频', channel: 'Example/channel', channelId: '42', published: '2026-09-18', duration: 125, views: 100, description: 'A description', tracks: [], loginRequired: false, isLive: false, audio: async () => [] };
test('new defaults do not authorize paid recognition', () => assert.equal(defaults().recognition, false));
test('legacy migration preserves credentials, folder preferences, and speech settings without obsolete functionality', () => {
  const s = preferences({ asrGroqKey: 'fixture-key', bilibiliCookie: 'fixture-cookie', defaultDirectory: 'Archive/{Year}', asrEnabled: true, fileFormats: ['pdf', 'srt'], customProviders: [{ apiKey: 'unused' }] });
  assert.equal(s.groqKey, 'fixture-key'); assert.equal(s.cookie, 'fixture-cookie'); assert.equal(s.directory, 'Archive/{Year}'); assert.equal(s.recognition, true);
  assert.equal('fileFormats' in s, false); assert.equal('customProviders' in s, false);
});
test('migration rejects invalid settings types and bounds audio settings', () => {
  const s = preferences({ schema: 1, recognition: 'true', chunkSeconds: Infinity, concurrency: 100, timestampEvery: -1, savedDirectories: ['A', 3, 'A'] });
  assert.equal(s.recognition, false); assert.equal(s.chunkSeconds, 300); assert.equal(s.concurrency, 3); assert.equal(s.timestampEvery, 0); assert.deepEqual(s.savedDirectories, ['A']);
});
test('settings instances do not share editable property objects', () => {
  const a = defaults(), b = defaults(); a.fields.url.key = 'changed'; assert.equal(b.fields.url.key, 'url');
});
for (const input of ['abcdefghijk', 'https://youtu.be/abcdefghijk?t=5', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://m.youtube.com/shorts/abcdefghijk', 'https://youtube.com/embed/abcdefghijk']) {
  test(`YouTube URL: ${input}`, () => assert.equal(parseVideo(input).id, 'abcdefghijk'));
}
for (const input of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'javascript:abcdefghijk', 'file:///abcdefghijk', 'https://bilibili.com.evil.test/video/BV1234567890']) {
  test(`reject unrelated origin: ${input}`, () => assert.throws(() => parseVideo(input)));
}
test('Bilibili part number is preserved in identity and timestamp links', () => {
  const ref = parseVideo('https://www.bilibili.com/video/BV1234567890/?p=3');
  assert.equal(ref.part, 3); assert.match(watchUrl(ref, 125), /p=3&t=125$/); assert.notEqual(videoKey(ref), videoKey({ ...ref, part: 1 }));
});
test('language selection skips broken tracks and respects preference order', () => {
  const tracks = [{ language: 'zh', name: 'Chinese', url: '' }, { language: 'en', name: 'English', url: 'a' }, { language: 'zh-CN', name: 'Chinese', url: 'b' }];
  assert.equal(chooseTrack(tracks, 'ja,zh,en')?.url, 'b');
});
test('Bilibili AI language prefixes participate in preferred-language matching', () => {
  assert.equal(chooseTrack([{ language: 'en', name: 'English', url: 'a' }, { language: 'ai-zh', name: 'Chinese', url: 'b' }], 'zh')?.url, 'b');
});
test('filenames honor UTF-8 byte length and Windows device names', () => {
  const result = safeName('讲解😀'.repeat(100));
  assert.ok(new TextEncoder().encode(result).length <= 220); assert.equal(result.includes('\ufffd'), false); assert.equal(safeName('CON'), '_CON');
});
test('folder paths reject traversal and absolute paths', () => {
  for (const path of ['../private', 'Notes/../private', '/tmp/a', 'C:\\private', 'Notes/./file']) assert.throws(() => vaultPath(path));
  assert.equal(vaultPath('Notes\\Videos'), 'Notes/Videos');
});
test('folder templates distinguish import date and publication date without injecting folders', () => {
  const result = expand('{Platform}/{ChannelName}/{PublishDate}/{Date}', video, new Date(2026, 8, 30), true);
  assert.equal(result, 'Bilibili/Example channel/2026-09-18/2026-09-30');
});
test('frontmatter strings cannot inject additional YAML properties', () => {
  const note = renderNote({ ...video, title: 'A\nadmin: true' }, [{ start: 0, end: 1, text: '<script>alert(1)</script> [evil](javascript:a)' }], defaults());
  assert.match(note, /"title": "A\\nadmin: true"/); assert.equal(note.includes('<script>'), false); assert.match(note, /page=2&autoplay=0/);
});
test('disabled and renamed metadata fields are reflected in the note', () => {
  const s = defaults(); s.fields.description.enabled = false; s.fields.url.key = 'source';
  const note = renderNote(video, [], s); assert.match(note, /"source":/); assert.doesNotMatch(note, /"description":/);
});
test('duplicate metadata keys produce an actionable failure', () => {
  const s = defaults(); s.fields.title.key = 'url'; assert.throws(() => renderNote(video, [], s), /same key/);
});
test('timestamp spacing and single-line formatting preserve every segment', () => {
  const s = defaults(); s.timestampEvery = 30; s.singleLine = true;
  const body = renderBody(video, [{ start: 0, end: 5, text: 'first' }, { start: 10, end: 15, text: 'second' }, { start: 31, end: 40, text: 'third' }], s);
  assert.equal((body.match(/https:/g) || []).length, 2); assert.match(body, /first second/); assert.equal(body.includes('\n'), false);
});

test('automatic caption selection preserves platform order instead of preferring English', () => {
  const tracks = [{ language: 'ai-zh', name: '中文', url: 'https://example.com/zh' }, { language: 'ai-en', name: 'English', url: 'https://example.com/en' }];
  assert.equal(chooseTrack(tracks, '')?.language, 'ai-zh');
  assert.equal(chooseTrack(tracks, 'en')?.language, 'ai-en');
});
