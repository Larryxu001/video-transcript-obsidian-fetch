import { metadataFields, watchUrl } from './model.ts';
import type { Preferences, Segment, Video } from './model.ts';

export function safeName(text: string, maxBytes = 220): string {
  const printable = [...text.normalize('NFC')].map(char => char.codePointAt(0)! < 32 ? ' ' : char).join('');
  const clean = printable.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  let result = '';
  for (const char of clean) {
    if (new TextEncoder().encode(result + char).length > maxBytes) break;
    result += char;
  }
  result = result.replace(/[. ]+$/g, '');
  if (!result || /^\.+$/.test(result)) return 'Transcript';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? `_${result}` : result;
}
export function vaultPath(path: string): string {
  path = path.trim();
  if (path === '/') return ''; // Obsidian represents the vault root as '/'.
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..' || /[<>:"|?*]/.test(p) || [...p].some(char => char.codePointAt(0)! < 32))) throw new Error('Use a relative vault folder without dot segments or reserved characters.');
  if (/^[\\/]/.test(path)) throw new Error('Use a relative vault folder.');
  return parts.join('/');
}
export function expand(template: string, video: Video, now = new Date(), folder = false): string {
  const date = (value: Date) => ({ Year: String(value.getFullYear()), Month: String(value.getMonth() + 1).padStart(2, '0'), Day: String(value.getDate()).padStart(2, '0') });
  const today = date(now);
  const published = /^\d{4}-\d{2}-\d{2}/.test(video.published) ? video.published.slice(0, 10) : '';
  const values: Record<string, string> = { ...today, Date: `${today.Year}-${today.Month}-${today.Day}`,
    PublishDate: published, PublishYear: published.slice(0, 4), PublishMonth: published.slice(5, 7), PublishDay: published.slice(8, 10),
    VideoName: video.title, VideoId: video.ref.id, ChannelName: video.channel,
    Platform: video.ref.platform === 'youtube' ? 'YouTube' : 'Bilibili' };
  const result = template.replace(/\{(\w+)\}/g, (token, key: string) => key in values ? (values[key] ? safeName(values[key]) : '') : token);
  return folder ? vaultPath(result) : safeName(result);
}
function escaped(text: string): string {
  return text.replace(/[&<>]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x]!).replace(/([\\`*_{}[\]#!|])/g, '\\$1');
}
function timestamp(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
export function renderBody(video: Video, segments: Segment[], settings: Preferences): string {
  const lines: string[] = [];
  if (settings.includeUrl) lines.push(watchUrl(video.ref), '');
  if (settings.channelTag && video.channel) lines.push(`#${video.channel.normalize('NFC').replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^[-/]+|[-/]+$/g, '') || 'video'}`, '');
  let last = -Infinity;
  const transcript = segments.filter(s => s.text.trim()).map(s => {
    const show = settings.timestamps && s.start - last >= settings.timestampEvery;
    if (show) last = s.start;
    return `${show ? `[${timestamp(s.start)}](${watchUrl(video.ref, s.start)}) ` : ''}${escaped(s.text.trim().replace(/\s+/g, ' '))}`;
  });
  lines.push(transcript.join(settings.singleLine ? ' ' : '\n\n'));
  return lines.join('\n');
}
export function renderNote(video: Video, segments: Segment[], settings: Preferences): string {
  const metadata: Record<string, unknown> = { title: video.title, url: watchUrl(video.ref), videoId: video.ref.id,
    channel: video.channel, channelId: video.channelId, published: video.published, duration: video.duration,
    views: video.views, description: video.description, isLive: video.isLive, isPrivate: video.isPrivate, isUnlisted: video.isUnlisted };
  const keys = new Set<string>();
  const properties: string[] = [];
  for (const name of metadataFields) {
    const field = settings.fields[name];
    if (!field.enabled || metadata[name] === undefined) continue;
    if (keys.has(field.key)) throw new Error(`Two frontmatter fields use the same key: ${field.key}`);
    keys.add(field.key);
    properties.push(`${JSON.stringify(field.key)}: ${JSON.stringify(metadata[name])}`);
  }
  const embed = video.ref.platform === 'youtube' ? `![](${watchUrl(video.ref)})` : `<iframe src="https://player.bilibili.com/player.html?bvid=${video.ref.id}&page=${video.ref.part}&autoplay=0" allowfullscreen></iframe>`;
  return `${properties.length ? `---\n${properties.join('\n')}\n---\n\n` : ''}# ${escaped(video.title)}\n\n${embed}\n\n${renderBody(video, segments, settings)}\n`;
}
