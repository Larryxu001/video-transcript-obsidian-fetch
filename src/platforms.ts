import { YouTubeChallenge, rejectChallenge } from './network.ts';
import { RateLimited } from './http.ts';
import { signPlayerQuery } from './bili-sign.ts';
import { webSubtitleTracks } from './bili-captions.ts';
import { parseCaptions, CaptionUnavailable } from './captions.ts';
import { parseVideo, watchUrl } from './model.ts';
import type { VideoRef, Video, Track, AudioSource, Segment } from './model.ts';
import { checkedUrl, request, json, decode, embeddedObject, delay, object, objects, text } from './http.ts';
import type { Transport, PlatformJson } from './http.ts';

const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const captionClients = [['ANDROID_VR', '1.71.26'], ['ANDROID', '21.26.364'], ['IOS', '21.26.4'], ['VISIONOS', '1.02'], ['WEB_EMBEDDED_PLAYER', '2.20260708.00.00'], ['TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0']];
function youtubeTracks(data: PlatformJson): Track[] {
  return objects(object(object(data.captions).playerCaptionsTracklistRenderer).captionTracks).filter(t => text(t.baseUrl) && text(t.languageCode)).map(t => ({ language: text(t.languageCode), name: text(object(t.name).simpleText || t.languageCode), url: checkedUrl(text(t.baseUrl), ['youtube.com']) }));
}

export class Platforms {
  private signingKeys?: Promise<{ image: string; sub: string }>;
  private visitors = new Map<string, string>();
  private captionPlayers = new Map<string, PlatformJson[]>();
  private transport: Transport;
  private cookie: string;
  private signal: AbortSignal;
  constructor(transport: Transport, cookie: string, signal: AbortSignal) {
    this.transport = transport; this.cookie = cookie; this.signal = signal;
  }
  async resolve(raw: string): Promise<VideoRef> {
    try { return parseVideo(raw); } catch (error) {
      let url: URL;
      try { url = new URL(raw.trim()); } catch { throw error; }
      if (!['b23.tv', 'www.b23.tv'].includes(url.hostname)) throw error;
      const html = decode(await request(this.transport, this.signal, { url: checkedUrl(url.href, ['b23.tv']) }));
      const link = html.match(/https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}(?:\?p=\d+)?/)?.[0];
      if (!link) throw new Error('Could not resolve the short link. Paste the full Bilibili video address.');
      return parseVideo(link);
    }
  }
  async load(ref: VideoRef): Promise<Video> { return ref.platform === 'youtube' ? this.youtube(ref) : this.bilibili(ref); }
  async biliApi(path: string, authenticated = true): Promise<PlatformJson> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { 'User-Agent': 'VideoTranscriptFetch/3.0', Referer: 'https://www.bilibili.com/' };
      if (authenticated && this.cookie) headers.Cookie = this.cookie;
      const body = json(await request(this.transport, this.signal, { url: `https://api.bilibili.com${path}`, headers }));
      if (body.code === 0) return object(body.data);
      if (Number(body.code) === -412 && attempt < 2) { await delay(700 * (attempt + 1), this.signal); continue; }
      throw new Error(`Bilibili rejected the request (code ${text(body.code, 'unknown')}). Open the video in a browser to check availability.`);
    }
  }
  private async bilibili(ref: VideoRef): Promise<Video> {
    let info: PlatformJson | null = null;
    try {
      const html = decode(await request(this.transport, this.signal, { url: watchUrl(ref), headers: { 'User-Agent': 'VideoTranscriptFetch/3.0', ...(this.cookie ? { Cookie: this.cookie } : {}) } }));
      info = object(embeddedObject(html, '__INITIAL_STATE__')?.videoData);
    } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    if (!info?.cid) info = await this.biliApi(`/x/web-interface/view?bvid=${ref.id}`, false);
    const pages = objects(info.pages);
    const page = pages[ref.part - 1];
    if (ref.part > 1 && !page) throw new Error('This Bilibili part does not exist.');
    const cid = Number(page?.cid || info.cid);
    if (!cid) throw new Error('Bilibili did not return an audio/video identifier.');
    const identity = `bvid=${ref.id}`;
    let details: PlatformJson = {};
    let listed: PlatformJson[] = ref.part === 1 ? objects(object(info.subtitle).list) : [];
    let receivedList = false, gated = false;
    let signedQuery = identity + `&cid=${cid}`;
    try {
      this.signingKeys ??= this.biliApi('/x/web-interface/nav').then(nav => {
        const keys = object(nav.wbi_img);
        return { image: text(keys.img_url), sub: text(keys.sub_url) };
      });
      const keys = await this.signingKeys;
      signedQuery = signPlayerQuery(signedQuery, keys.image, keys.sub);
    } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    // A failed or login-gated lookup must not be interpreted as an absent caption track.
    for (const endpoint of ['/x/player/wbi/v2', '/x/player/v2']) {
      try {
        const response = await this.biliApi(`${endpoint}?${signedQuery}`);
        const subtitle = object(response.subtitle);
        details = response;
        gated ||= !!response.need_login_subtitle || !!subtitle.need_login_subtitle;
        if (Array.isArray(subtitle.subtitles)) {
          receivedList = true;
          listed = [...objects(subtitle.subtitles), ...listed];
        }
        if (receivedList || listed.some(x => text(x.subtitle_url) && text(x.lan))) break;
      } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    }
    if (!listed.some(x => text(x.subtitle_url) && text(x.lan)) && Number(info.aid)) {
      try {
        const params = new URLSearchParams({ oid: String(cid), pid: String(info.aid), type: '1', cur_production_type: '0', playlist_switch: '0', preferred_language: 'ai-zh', context_ext: '{"video_type":1}' });
        const reply = await request(this.transport, this.signal, { url: `https://api.bilibili.com/x/v2/subtitle/web/view?${params}`, headers: { Referer: watchUrl(ref), 'User-Agent': browserAgent, Accept: 'application/octet-stream', ...(this.cookie ? { Cookie: this.cookie } : {}) } });
        const current = webSubtitleTracks(reply.bytes);
        listed.push(...current.map(track => ({ lan: track.language, lan_doc: track.name, subtitle_url: track.url })));
        receivedList = true;
      } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    }
    const tracks: Track[] = listed.filter(x => text(x.subtitle_url) && text(x.lan)).map(x => ({ language: text(x.lan), name: text(x.lan_doc || x.lan), url: checkedUrl(text(x.subtitle_url), ['hdslb.com', 'bilibili.com']) })).filter((track, i, all) => all.findIndex(x => x.url === track.url) === i);
    const loginRequired = !tracks.length && (!this.cookie || !Number(details.login_mid) || gated);
    const captionIssue = tracks.length ? undefined : !receivedList ? 'Bilibili subtitle queries failed after alternate endpoints.' : listed.length ? 'Bilibili returned no readable subtitle addresses.' : loginRequired ? 'Bilibili subtitle access requires a valid signed-in session. Verify the account in settings.' : undefined;
    return { ref, title: text(info.title, ref.id) + (ref.part > 1 ? ` - ${text(page.part, String(ref.part))}` : ''),
      channel: text(object(info.owner).name), channelId: text(object(info.owner).mid),
      published: Number(info.pubdate) ? new Date(Number(info.pubdate) * 1000).toISOString().slice(0, 10) : '',
      duration: Number(page?.duration || info.duration || 0), views: Number(object(info.stat).view || 0), description: text(info.desc),
      tracks, loginRequired, captionIssue, isLive: false,
      audio: async () => {
        const play = await this.biliApi(`/x/player/playurl?bvid=${ref.id}&cid=${cid}&fnval=16&fnver=0&fourk=0`);
        const streams = objects(object(play.dash).audio).filter(a => text(a.mimeType || a.mime_type).includes('mp4')).sort((a, b) => Number(a.bandwidth) - Number(b.bandwidth));
        const candidates: AudioSource[] = [];
        for (const stream of streams) {
          const segment = object(stream.SegmentBase || stream.segment_base);
          const init = text(segment.Initialization || segment.initialization).split('-').map(Number);
          const index = text(segment.indexRange || segment.index_range).split('-').map(Number);
          if (init.length !== 2 || index.length !== 2 || ![...init, ...index].every(Number.isFinite)) continue;
          const backup: unknown = stream.backupUrl || stream.backup_url;
          const addresses: unknown[] = [stream.baseUrl || stream.base_url, ...(Array.isArray(backup) ? backup as unknown[] : [])];
          for (const url of addresses) {
            try { candidates.push({ url: checkedUrl(text(url), ['bilivideo.com', 'bilivideo.cn', 'biliapi.net']), initEnd: init[1], indexStart: index[0], indexEnd: index[1], identity: `bili:${cid}:${text(stream.id)}` }); }
            catch { /* Some P2P addresses use nonstandard ports; the HTTPS CDN backups remain usable. */ }
          }
        }
        if (!candidates.length) throw new Error('Bilibili returned no supported HTTPS audio address.');
        return candidates;
      } };
  }
  private async player(id: string, client: string, version: string, refresh = false): Promise<PlatformJson> {
    return json(await request(this.transport, this.signal, {
      url: 'https://www.youtube.com/youtubei/v1/player', method: 'POST', ...(refresh ? { cache: 'reload' as const } : {}),
      headers: { 'Content-Type': 'application/json', 'User-Agent': client === 'ANDROID_VR' ? `com.google.android.apps.youtube.vr.oculus/${version} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip` : client === 'ANDROID' ? `com.google.android.youtube/${version} (Linux; U; Android 14) gzip` : client === 'IOS' ? `com.google.ios.youtube/${version} (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)` : client === 'MWEB' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' : client === 'TVHTML5_SIMPLY_EMBEDDED_PLAYER' ? 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1' : browserAgent,
        Origin: 'https://www.youtube.com', 'X-YouTube-Client-Name': ({ ANDROID_VR: '28', ANDROID: '3', IOS: '5', WEB: '1', WEB_EMBEDDED_PLAYER: '56', TVHTML5_SIMPLY_EMBEDDED_PLAYER: '85', MWEB: '2', VISIONOS: '101' } as Record<string, string>)[client],
        'X-YouTube-Client-Version': version, ...(this.visitors.get(id) ? { 'X-Goog-Visitor-Id': this.visitors.get(id)! } : {}) },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: client, clientVersion: version, hl: 'en', gl: 'US',
        ...(this.visitors.get(id) ? { visitorData: this.visitors.get(id) } : {}),
        ...(client === 'ANDROID_VR' ? { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' } : {}),
        ...(client === 'ANDROID' ? { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } : {}), ...(client === 'IOS' ? { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' } : {}),
        ...(client === 'VISIONOS' ? { deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471' } : {}) },
        ...(client.includes('EMBEDDED') ? { thirdParty: { embedUrl: 'https://www.youtube.com/' } } : {}) }, contentCheckOk: true, racyCheckOk: true }),
    }));
  }
  private async youtube(ref: VideoRef): Promise<Video> {
    let page = '';
    try { page = decode(await request(this.transport, this.signal, { url: watchUrl(ref), headers: { 'User-Agent': browserAgent, 'Accept-Language': 'en-US,en;q=0.9' } })); }
    catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    const visitor = page.match(/"(?:VISITOR_DATA|visitorData)"\s*:\s*"([^"\n]+)"/)?.[1];
    if (visitor) { try { this.visitors.set(ref.id, JSON.parse(`"${visitor}"`) as string); } catch { /* Ignore malformed visitor data. */ } }
    const webBody = embeddedObject(page, 'ytInitialPlayerResponse');
    if (webBody) rejectChallenge(webBody);
    const players: PlatformJson[] = [];
    for (const [client, version] of captionClients) {
      try {
        const candidate = await this.player(ref.id, client, version);
        rejectChallenge(candidate);
        if (candidate.videoDetails && (!object(candidate.playabilityStatus).status || object(candidate.playabilityStatus).status === 'OK')) {
          players.push(candidate);
          if (youtubeTracks(candidate).length) break;
        }
      } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    }
    if (webBody?.videoDetails) players.push(webBody);
    this.captionPlayers.set(ref.id, players);
    const body = players[0];
    if (!body) {
      throw new Error('Could not access this YouTube video. Check that it plays in your browser and that your connection is working, then resume the import.');
    }
    const detail = object(body.videoDetails);
    const micro = object(object(body.microformat || webBody?.microformat).playerMicroformatRenderer);
    const tracks = players.flatMap(youtubeTracks).filter((track, index, all) => all.findIndex(t => t.language === track.language) === index);
    return { ref, title: text(detail.title, ref.id), channel: text(detail.author), channelId: text(detail.channelId),
      published: text(micro.publishDate || micro.uploadDate).slice(0, 10), duration: Number(detail.lengthSeconds || 0), views: Number(detail.viewCount || 0),
      description: text(detail.shortDescription), tracks, loginRequired: false, isLive: !!object(micro.liveBroadcastDetails).isLiveNow,
      isPrivate: typeof detail.isPrivate === 'boolean' ? detail.isPrivate : undefined,
      isUnlisted: typeof micro?.isUnlisted === 'boolean' ? micro.isUnlisted : undefined,
      audio: async (refresh = false) => {
        const sources: AudioSource[] = [];
        for (const [client, version] of [['VISIONOS', '1.02'], ['IOS', '21.26.4'], ['ANDROID_VR', '1.71.26'], ['ANDROID', '21.26.364'], ['TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0'], ['MWEB', '2.20241202.07.00']]) {
          try {
            const response = await this.player(ref.id, client, version, refresh);
            rejectChallenge(response);
            const stream = objects(object(response.streamingData).adaptiveFormats).filter(f => text(f.url) && text(f.mimeType).startsWith('audio/mp4')).sort((a, b) => Number(a.bitrate) - Number(b.bitrate))[0];
            if (stream) sources.push({ url: checkedUrl(text(stream.url), ['googlevideo.com']), initEnd: stream.initRange && stream.indexRange ? Number(object(stream.initRange).end) : 16383, indexStart: stream.initRange && stream.indexRange ? Number(object(stream.indexRange).start) : 0, indexEnd: stream.initRange && stream.indexRange ? Number(object(stream.indexRange).end) : 16383, identity: `${client}:${text(stream.itag)}` });
            if (sources.length >= 2) break;
          } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
        }
        if (!sources.length) throw new Error('YouTube did not provide usable audio. Its streaming restrictions may have changed.');
        return sources;
      } };
  }
  async captions(video: Video, track: Track): Promise<Segment[]> {
    if (video.ref.platform === 'bilibili') {
      const url = checkedUrl(track.url, ['hdslb.com', 'bilibili.com']);
      const result = parseCaptions(decode(await request(this.transport, this.signal, { url, headers: { Referer: 'https://www.bilibili.com/' } })), false);
      if (!result.length) throw new CaptionUnavailable('The caption track was empty.');
      if (video.duration > 0 && result.at(-1)!.end > video.duration + 2) throw new CaptionUnavailable('Bilibili returned captions outside this video’s duration. The mismatched track was not imported.');
      return result;
    }
    const attempted = new Set<string>();
    const headers = { 'User-Agent': browserAgent, Referer: watchUrl(video.ref), 'Accept-Language': 'en-US,en;q=0.9' };
    const fetchTrack = async (source: Track): Promise<Segment[]> => {
      const base = checkedUrl(source.url, ['youtube.com']);
      // Preserve the signed URL first; changing fmt can invalidate some responses.
      for (const format of ['', 'json3', 'srv3', 'ttml']) {
        const url = new URL(base);
        if (format) url.searchParams.set('fmt', format);
        if (attempted.has(url.href)) continue;
        attempted.add(url.href);
        try {
          const result = parseCaptions(decode(await request(this.transport, this.signal, { url: url.href, headers }, 0)), true);
          if (result.length) return result;
        } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
      }
      return [];
    };
    const initial = [track, ...(this.captionPlayers.get(video.ref.id) || []).flatMap(youtubeTracks).filter(t => t.language === track.language)];
    for (const candidate of initial) { const result = await fetchTrack(candidate); if (result.length) return result; }
    // A playable player response does not prove its caption URL works. Refresh with other clients.
    for (const [client, version] of captionClients) {
      try {
        const body = await this.player(video.ref.id, client, version);
        rejectChallenge(body);
        for (const candidate of youtubeTracks(body).filter(t => t.language === track.language)) {
          const result = await fetchTrack(candidate); if (result.length) return result;
        }
      } catch (error) { this.signal.throwIfAborted(); if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error; }
    }
    const publicTrack = new URL('https://www.youtube.com/api/timedtext');
    publicTrack.searchParams.set('v', video.ref.id);
    publicTrack.searchParams.set('lang', track.language);
    if (new URL(track.url).searchParams.get('kind') === 'asr' || new URL(track.url).searchParams.get('caps') === 'asr') publicTrack.searchParams.set('caps', 'asr');
    const publicResult = await fetchTrack({ ...track, url: publicTrack.href });
    if (publicResult.length) return publicResult;
    throw new CaptionUnavailable('Could not read this video’s captions. Try again later or enable speech recognition in settings.');
  }
}
