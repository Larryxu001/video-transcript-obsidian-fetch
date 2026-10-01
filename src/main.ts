import { NetworkSession, YouTubeChallenge } from './network.ts';
import { RateLimited } from './http.ts';
import { restoreProgress, publicSettings } from './progress.ts';
import type { ImportProgress } from './progress.ts';
import { CaptionUnavailable } from './captions.ts';
import { Plugin, MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import { defaults, preferences, parseVideo, videoKey, chooseTrack } from './model.ts';
import type { Preferences, Video, Segment } from './model.ts';
import { renderNote, renderBody, expand, vaultPath } from './note.ts';
import { Platforms } from './platforms.ts';
import { obsidianTransport } from './transport.ts';
import { RecognitionCache, recognize, UncertainRecognition } from './recognition.ts';
import { TranscriptSettings, ImportModal, ResultModal } from './ui.ts';
import type { ImportOptions } from './ui.ts';
import { LoginModal } from './login.ts';

export default class VideoTranscripts extends Plugin {
  settings: Preferences = defaults();
  private job?: AbortController;
  private cache = new RecognitionCache(() => this.persist());
  private network = new NetworkSession(obsidianTransport);
  private progress?: ImportProgress;
  private windows = new Set<ImportModal | LoginModal>();
  private writes: Promise<void> = Promise.resolve();
  private enabled = false;
  async onload(): Promise<void> {
    const data: unknown = await this.loadData();
    this.settings = preferences(data);
    if (data && typeof data === 'object') {
      this.progress = restoreProgress((data as Record<string, unknown>)._progress);
      this.cache.restore((data as Record<string, unknown>)._recognition);
    }
    this.enabled = true;
    if (this.progress) new Notice('A paused transcript import is saved. Use the resume command to continue.');
    this.addSettingTab(new TranscriptSettings(this.app, this));
    this.addRibbonIcon('closed-caption', 'Import video transcript', () => this.importWindow());
    this.addCommand({ id: 'fetch-youtube-transcript', name: 'Import video transcript', callback: () => this.importWindow() });
    this.addCommand({ id: 'fetch-youtube-transcript-from-clipboard', name: 'Import video transcripts from clipboard', callback: () => { void this.fromClipboard(); } });
    this.addCommand({ id: 'resume-import', name: 'Resume paused transcript import', callback: () => { void this.resume(); } });
    this.addCommand({ id: 'discard-import', name: 'Discard paused import', callback: () => this.discard() });
    this.addCommand({ id: 'cancel-import', name: 'Pause transcript import', callback: () => this.job?.abort() });
    this.registerObsidianProtocolHandler('yt-transcript', params => {
      const raw = params.url || params.v;
      if (!raw) { new Notice('The link needs a video URL.'); return; }
      void this.run({ ...this.options([raw]), directory: params.folder || this.settings.directory, createNote: !!params.folder || !this.app.workspace.getActiveViewOfType(MarkdownView) || this.settings.createNote });
    });
  }
  onunload(): void { this.enabled = false; this.job?.abort(); for (const window of this.windows) window.close(); this.network.clear(); }
  persist(): Promise<void> {
    const snapshot = structuredClone({ ...this.settings, _progress: this.progress, _recognition: this.cache.snapshot() });
    this.writes = this.writes.catch(() => {}).then(() => this.saveData(snapshot));
    return this.writes;
  }
  login(finished?: () => void): void {
    const modal = new LoginModal(this.app, obsidianTransport, async cookie => { this.settings.cookie = cookie; this.settings.accountName = ''; this.settings.accountId = ''; await this.persist(); finished?.(); }, () => this.windows.delete(modal));
    this.windows.add(modal); modal.open();
  }
  private options(urls: string[]): ImportOptions {
    return { urls, createNote: this.settings.createNote, directory: this.settings.directory, language: this.settings.languages, includeUrl: this.settings.includeUrl, channelTag: this.settings.channelTag };
  }
  private importWindow(): void {
    const modal = new ImportModal(this.app, this.settings, options => { void this.run(options); },
      async (url, signal) => {
        const platforms = new Platforms(this.network.transport, this.settings.cookie, signal); const ref = await platforms.resolve(url);
        const video = await platforms.load(ref);
        return video;
      }, () => this.windows.delete(modal));
    this.windows.add(modal); modal.open();
  }
  private async fromClipboard(): Promise<void> {
    if (!this.settings.clipboard) { new Notice('Clipboard access is disabled in settings.'); return; }
    try {
      const urls = (await navigator.clipboard.readText()).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!urls.length) throw new Error('The clipboard is empty.');
      await this.run(this.options(urls));
    } catch { new Notice('Could not read video links from the clipboard. Paste them into the import window.'); }
  }
  private duplicate(video: Video, settings: Preferences): TFile | undefined {
    return this.app.vault.getMarkdownFiles().find(file => {
      const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[settings.duplicateKey];
      return (Array.isArray(value) ? value : [value]).some(item => {
        if (typeof item !== 'string') return false;
        try { return videoKey(parseVideo(item)) === videoKey(video.ref); } catch { return false; }
      });
    });
  }
  private async create(video: Video, segments: Segment[], settings: Preferences, fallback: string, signal: AbortSignal): Promise<void> {
    const folder = settings.directory ? expand(settings.directory, video, new Date(), true) : vaultPath(fallback);
    const filename = expand(settings.filename || '{VideoName}', video);
    const content = renderNote(video, segments, settings);
    let path = '';
    for (const part of folder.split('/').filter(Boolean)) {
      path = path ? `${path}/${part}` : part;
      signal.throwIfAborted();
      const entry = this.app.vault.getAbstractFileByPath(path);
      if (entry && !(entry instanceof TFolder)) throw new Error('A file occupies the requested note folder.');
      if (!entry) await this.app.vault.createFolder(path);
    }
    const base = folder ? `${folder}/${filename}` : filename;
    for (let suffix = 0; suffix < 10000; suffix++) {
      signal.throwIfAborted();
      const target = `${base}${suffix ? ` (${suffix})` : ''}.md`;
      if (this.app.vault.getAbstractFileByPath(target)) continue;
      let file: TFile;
      if (this.progress) { this.progress.write = { key: videoKey(video.ref), path: target, content }; await this.persist(); }
      try { file = await this.app.vault.create(target, content); }
      catch (error) {
        const existing = this.app.vault.getAbstractFileByPath(target);
        if (!(existing instanceof TFile) || await this.app.vault.read(existing) !== content) throw error;
        file = existing;
      }
      if (this.progress) { this.progress.completed.push(videoKey(video.ref)); this.progress.write = undefined; await this.persist(); }
      // A saved note is a successful import even if opening a workspace leaf fails.
      try { await this.app.workspace.getLeaf(false).openFile(file); } catch { new Notice(`Saved ${file.path}. Open it from the file explorer.`); }
      return;
    }
    throw new Error('Too many notes already use this name.');
  }
  private async finishWrite(signal: AbortSignal): Promise<void> {
    const write = this.progress?.write;
    if (!write || !this.progress) return;
    signal.throwIfAborted();
    vaultPath(write.path);
    if (write.before !== undefined) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.file?.path !== write.path) throw new Error(`Open ${write.path} before resuming the saved insertion.`);
      const current = view.editor.getValue();
      if (current === write.before) view.editor.setValue(write.content);
      else if (current !== write.content) throw new Error('The target note changed. Saved insertion was not repeated; review the note before discarding this queue.');
      // Persist the editor's completed content before marking this item done.
      await view.save();
    } else {
      const file = this.app.vault.getAbstractFileByPath(write.path);
      if (!file) await this.app.vault.create(write.path, write.content);
      else if (!(file instanceof TFile) || await this.app.vault.read(file) !== write.content) throw new Error('The saved output path contains different content. Resolve the conflict before resuming.');
    }
    this.progress.completed.push(write.key); this.progress.write = undefined;
    await this.persist();
  }
  private async resume(): Promise<void> {
    if (!this.progress) { new Notice('No paused import is saved.'); return; }
    if ((this.progress.retryAt || 0) > Date.now()) { new Notice(`Wait until ${new Date(this.progress.retryAt!).toLocaleTimeString()} before resuming.`); return; }
    this.network.resume();
    await this.run(this.progress.options, true);
  }
  private discard(): void {
    if (this.job) { new Notice('Cancel the running import first.'); return; }
    new ResultModal(this.app, 'Discard saved progress?', 'This removes the saved queue and recognition checkpoints. Existing notes remain. Importing again may incur new recognition charges.', () => {
      this.progress = undefined; this.cache.clear(); this.network.clear();
      void this.persist().catch(() => new Notice('Could not remove saved progress.'));
    }, 'Discard progress').open();
  }
  private async run(options: ImportOptions, resuming = false): Promise<void> {
    if (!this.enabled) return;
    if (this.job) { new Notice('An import is already running. Wait or cancel the current import.'); return; }
    if (this.progress && !resuming) { new ResultModal(this.app, 'An import is paused', 'Resume the previous import first. To start a different video, open the command palette and choose Discard paused import.', () => { void this.resume(); }, 'Resume').open(); return; }
    const controller = new AbortController(); this.job = controller;
    const signal = controller.signal;
    const settings = preferences({ ...(this.progress?.settings || this.settings), recognition: this.settings.recognition, provider: this.settings.provider, model: this.settings.model, cookie: this.settings.cookie, groqKey: this.settings.groqKey, openaiKey: this.settings.openaiKey, directory: options.directory, includeUrl: options.includeUrl, channelTag: options.channelTag });
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const originalPath = this.progress?.targetPath || view?.file?.path;
    const fallback = this.progress?.fallback ?? view?.file?.parent?.path ?? '';
    const notice = new Notice('Preparing transcript import…', 0);
    const completed = new Set<string>(this.progress?.completed || []);
    let index = this.progress?.index || 0;
    try {
      if (options.urls.length > 100) throw new Error('Import at most 100 videos per batch.');
      if (options.createNote) vaultPath(settings.directory || fallback);
      if (!options.createNote && (!view || !originalPath)) throw new Error('Open a Markdown note or enable Create a new note.');
      this.progress ??= { options: structuredClone(options), index: 0, completed: [], fallback, targetPath: originalPath, settings: publicSettings(settings) };
      await this.persist();
      await this.finishWrite(signal);
      for (const key of this.progress.completed) completed.add(key);
      const platforms = new Platforms(this.network.transport, settings.cookie, signal);
      for (; index < options.urls.length; index++) {
        signal.throwIfAborted();
        notice.setMessage(`Reading video ${index + 1}/${options.urls.length}…`);
        const ref = await platforms.resolve(options.urls[index]);
        if (completed.has(videoKey(ref))) continue;
        const video = await platforms.load(ref);
        if (options.createNote && settings.duplicates) {
          const existing = this.duplicate(video, settings);
          if (existing) { new Notice(`Already imported: ${existing.path}`); completed.add(videoKey(ref)); continue; }
        }
        const track = chooseTrack(video.tracks, options.language);
        let segments: Segment[];
        if (track) {
          try { notice.setMessage(`Reading platform captions: ${track.name} (${track.language})…`); segments = await platforms.captions(video, track); }
          catch (error) {
            signal.throwIfAborted();
            if (error instanceof YouTubeChallenge || error instanceof RateLimited) throw error;
            if (!settings.recognition || (!(error instanceof CaptionUnavailable) && video.ref.platform !== 'bilibili')) throw error;
            notice.setMessage('Captions could not be read. Using your enabled speech recognition service…');
            segments = await recognize(video, settings, this.network.transport, signal, this.cache, text => notice.setMessage(text));
          }
        } else {
          if (video.captionIssue) {
            if (!settings.recognition) throw new Error(video.captionIssue);
            new Notice(`${video.captionIssue} Using your enabled speech recognition service.`, 10000);
          }
          segments = await recognize(video, settings, this.network.transport, signal, this.cache, text => notice.setMessage(text));
        }
        signal.throwIfAborted();
        if (options.createNote) await this.create(video, segments, settings, fallback, signal);
        else {
          if (!view || view.file?.path !== originalPath) throw new Error('The target note changed during import. Reopen the intended note and retry.');
          const before = view.editor.getValue();
          const from = view.editor.posToOffset(view.editor.getCursor('from')), to = view.editor.posToOffset(view.editor.getCursor('to'));
          this.progress.write = { key: videoKey(ref), path: originalPath!, before, content: before.slice(0, from) + renderBody(video, segments, settings) + before.slice(to) };
          await this.persist();
          await this.finishWrite(signal);
        }
        completed.add(videoKey(ref));
        this.progress.completed = [...completed]; this.progress.index = index + 1;
        await this.persist();
      }
      this.progress = undefined; await this.persist();
      new Notice(`Import complete: ${completed.size} video(s) handled.`);
    } catch (error) {
      if (error instanceof YouTubeChallenge) this.network.pause();
      if (this.progress) { this.progress.index = index; if (error instanceof RateLimited) this.progress.retryAt = error.retryAt; }
      try { await this.persist(); } catch { new Notice('Progress could not be saved. Check vault storage before restarting.'); }
      if (signal.aborted) new Notice('Import paused. Use the resume command to continue.');
      else {
        const message = error instanceof Error ? error.message : 'The import failed.';
        new ResultModal(this.app, 'Transcript import paused', message, () => {
          if (error instanceof UncertainRecognition) void this.cache.approveRetry().then(() => this.resume()).catch(() => new Notice('Could not save retry approval.'));
          else void this.resume();
        }, error instanceof UncertainRecognition ? 'Retry uncertain chunks (may charge again)' : 'Resume').open();
      }
    } finally { notice.hide(); if (this.job === controller) this.job = undefined; }
  }
}
