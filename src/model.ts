export type PlatformName = 'youtube' | 'bilibili';
export interface VideoRef { platform: PlatformName; id: string; part: number }
export interface Segment { start: number; end: number; text: string }
export interface Track { language: string; name: string; url: string }
export interface AudioSource { url: string; initEnd: number; indexStart: number; indexEnd: number; identity: string }
export interface Video {
  ref: VideoRef; title: string; channel: string; channelId: string;
  published: string; duration: number; views: number; description: string;
  tracks: Track[]; captionIssue?: string; loginRequired: boolean; isLive: boolean;
  isPrivate?: boolean; isUnlisted?: boolean;
  audio: (refresh?: boolean) => Promise<AudioSource[]>;
}
export const metadataFields = ['title', 'url', 'videoId', 'channel', 'channelId', 'duration', 'views', 'published', 'description', 'isLive', 'isPrivate', 'isUnlisted'] as const;
export type MetadataField = typeof metadataFields[number];
export interface Preferences {
  schema: 1; directory: string; savedDirectories: string[]; filename: string;
  createNote: boolean; includeUrl: boolean; channelTag: boolean;
  timestamps: boolean; timestampEvery: number; singleLine: boolean;
  languages: string; clipboard: boolean; duplicates: boolean; duplicateKey: string;
  fields: Record<MetadataField, { enabled: boolean; key: string }>;
  cookie: string; accountName: string; accountId: string; recognition: boolean; provider: 'groq' | 'openai';
  groqKey: string; openaiKey: string; model: string; spokenLanguage: string;
  chunkSeconds: number; concurrency: number;
}
export function defaults(): Preferences {
  return { schema: 1, directory: '', savedDirectories: [], filename: '{VideoName}',
    createNote: false, includeUrl: false, channelTag: false, timestamps: true,
    timestampEvery: 0, singleLine: false, languages: '', clipboard: true,
    duplicates: false, duplicateKey: 'url',
    fields: Object.fromEntries(metadataFields.map(key => [key, { enabled: true, key }])) as Preferences['fields'],
    cookie: '', accountName: '', accountId: '', recognition: false, provider: 'groq', groqKey: '', openaiKey: '', model: '',
    spokenLanguage: '', chunkSeconds: 300, concurrency: 2 };
}

// The mapping is a data-compatibility contract, not an import of the old implementation.
export function preferences(input: unknown): Preferences {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const next = defaults();
  const legacy: Record<string, string> = {
    directory: 'defaultDirectory', filename: 'defaultNoteName', createNote: 'createNewFile',
    includeUrl: 'includeVideoUrl', channelTag: 'tagWithChannelName', timestamps: 'includeTimestamps',
    timestampEvery: 'timestampFrequency', singleLine: 'singleLineTranscript', languages: 'preferredLanguage',
    clipboard: 'allowClipboardAccess', duplicates: 'checkForDuplicates', duplicateKey: 'duplicateCheckProperty',
    cookie: 'bilibiliCookie', recognition: 'asrEnabled', provider: 'asrProvider',
    groqKey: 'asrGroqKey', openaiKey: 'asrOpenaiKey', model: 'asrModel', spokenLanguage: 'asrLanguage',
    chunkSeconds: 'asrChunkSeconds', concurrency: 'asrConcurrency', fields: 'frontmatterFields',
  };
  const record = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    if (['fields', 'schema', 'savedDirectories'].includes(key)) continue;
    const candidate = value.schema === 1 ? value[key] : value[legacy[key] || key];
    if (typeof candidate === typeof record[key]) record[key] = candidate;
  }
  next.provider = next.provider === 'openai' ? 'openai' : 'groq';
  next.chunkSeconds = bounded(next.chunkSeconds, 60, 600, 300);
  next.concurrency = bounded(next.concurrency, 1, 3, 2);
  next.timestampEvery = bounded(next.timestampEvery, 0, 86400, 0);
  if (Array.isArray(value.savedDirectories)) next.savedDirectories = [...new Set(value.savedDirectories.filter((x): x is string => typeof x === 'string' && !!x.trim()))];
  const fields = value.schema === 1 ? value.fields : value.frontmatterFields;
  if (fields && typeof fields === 'object') {
    for (const key of metadataFields) {
      const field = (fields as Record<string, unknown>)[key];
      if (!field || typeof field !== 'object') continue;
      const item = field as Record<string, unknown>;
      next.fields[key] = { enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        key: typeof item.key === 'string' && item.key.trim() ? item.key.trim() : key };
    }
  }
  return next;
}
function bounded(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export function parseVideo(input: string): VideoRef {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return { platform: 'youtube', id: raw, part: 1 };
  if (/^BV[0-9A-Za-z]{10}$/.test(raw)) return { platform: 'bilibili', id: raw, part: 1 };
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Enter a YouTube or Bilibili video URL.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP video links are supported.');
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const id = host === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) return { platform: 'youtube', id, part: 1 };
  }
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
    const id = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];
    if (id) return { platform: 'bilibili', id, part: bounded(Number(url.searchParams.get('p') || 1), 1, 10000, 1) };
  }
  throw new Error('This is not a supported YouTube or Bilibili video link.');
}
export function watchUrl(ref: VideoRef, seconds?: number): string {
  const url = new URL(ref.platform === 'youtube' ? 'https://www.youtube.com/watch' : `https://www.bilibili.com/video/${ref.id}/`);
  if (ref.platform === 'youtube') url.searchParams.set('v', ref.id);
  else if (ref.part > 1) url.searchParams.set('p', String(ref.part));
  if (seconds !== undefined) url.searchParams.set('t', String(Math.max(0, Math.floor(seconds))));
  return url.href;
}
export function videoKey(ref: VideoRef): string { return `${ref.platform}:${ref.id}:${ref.part}`; }
export function chooseTrack(tracks: Track[], languages: string): Track | undefined {
  const usable = tracks.filter(t => t.url && t.language);
  const code = (track: Track) => track.language.toLowerCase().replace(/^ai-/, '');
  for (const language of languages.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
    const found = usable.find(t => code(t) === language) || usable.find(t => code(t).startsWith(`${language}-`));
    if (found) return found;
  }
  return usable[0];
}
