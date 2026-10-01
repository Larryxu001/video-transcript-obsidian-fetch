import { readAccount } from './login.ts';
import { obsidianTransport } from './transport.ts';
import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin, SettingDefinitionItem, SettingDefinitionRender, SettingDefinitionGroup } from 'obsidian';
import { metadataFields } from './model.ts';
import type { Preferences, Video } from './model.ts';

export interface ImportOptions { urls: string[]; createNote: boolean; directory: string; language: string; includeUrl: boolean; channelTag: boolean }
export interface SettingsHost extends Plugin {
  settings: Preferences;
  persist(): Promise<void>;
  login(finished?: () => void): void;
}
export class TranscriptSettings extends PluginSettingTab {
  private accountCheck?: AbortController;
  private recognitionDraft?: Pick<Preferences, 'recognition' | 'provider' | 'groqKey' | 'openaiKey' | 'model'>;
  hide(): void { this.accountCheck?.abort(); this.recognitionDraft = undefined; }
  constructor(app: App, private host: SettingsHost) { super(app, host); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.host.settings;
    const save = () => { void this.host.persist().catch(() => new Notice('Could not save plugin settings.')); };
    const definitions: SettingDefinitionItem[] = [];
    let items: SettingDefinitionRender[] = [];
    const heading = (name: string) => { items = []; definitions.push({ type: 'group', heading: name, items }); };
    const row = (name: string, render: (setting: Setting) => void | (() => void), desc = '') => items.push({ name, desc, render });
    const text = (name: string, key: keyof Preferences, description = '', password = false) => {
      row(name, setting => { setting.addText(field => {
        field.setValue(typeof s[key] === 'string' ? s[key] : '').onChange(value => { (s as unknown as Record<string, unknown>)[key] = value; save(); });
        if (password) field.inputEl.type = 'password';
      }); }, description);
    };
    const toggle = (name: string, key: keyof Preferences, description = '') => row(name, setting => { setting.addToggle(field => field.setValue(Boolean(s[key])).onChange(value => { (s as unknown as Record<string, unknown>)[key] = value; save(); })); }, description);
    const number = (name: string, key: 'timestampEvery' | 'chunkSeconds' | 'concurrency', min: number, max: number, description = '') => row(name, setting => { setting.addText(field => {
      field.inputEl.type = 'number'; field.inputEl.min = String(min); field.inputEl.max = String(max);
      field.setValue(String(s[key])).onChange(value => { const n = Number(value); if (Number.isFinite(n) && n >= min && n <= max) { s[key] = Math.floor(n); save(); } });
    }); }, description);
    heading('Notes');
    text('Default folder', 'directory', 'Folder inside your vault, such as Videos. Leave blank to use the current note’s folder.');
    text('Note name', 'filename', 'Use {VideoName} for the video title. More naming options are explained in the guide.');
    toggle('Create a new note', 'createNote', 'Save each video as a separate note. When off, insert into the open note.');
    for (const directory of s.savedDirectories) row(directory, setting => { setting
      .addButton(button => button.setButtonText('Use').onClick(() => { s.directory = directory; save(); this.update(); }))
      .addButton(button => button.setButtonText('Remove').onClick(() => { s.savedDirectories = s.savedDirectories.filter(x => x !== directory); save(); this.update(); })); });
    let shortcut = '';
    row('Save a folder shortcut', setting => { setting.addText(field => field.onChange(value => { shortcut = value.trim(); }))
      .addButton(button => button.setButtonText('Save').onClick(() => { if (shortcut && !s.savedDirectories.includes(shortcut)) { s.savedDirectories.push(shortcut); save(); this.update(); } })); });
    heading('Transcript');
    text('Preferred caption languages', 'languages', 'Language codes in priority order, such as zh,en. Leave blank for automatic selection. This does not translate the transcript.');
    toggle('Include video link', 'includeUrl'); toggle('Tag with channel name', 'channelTag');
    toggle('Show timestamps', 'timestamps'); number('Timestamp interval', 'timestampEvery', 0, 86400, 'Minimum seconds between timestamps. Set 0 to keep every caption timestamp.');
    toggle('Continuous paragraph', 'singleLine', 'Join captions into a paragraph instead of putting each caption on its own line.');
    toggle('Allow clipboard access', 'clipboard', 'Only read when opening the import window or invoking the clipboard command.');
    toggle('Skip previously imported videos', 'duplicates', 'Check existing note properties before creating another note for the same video.'); text('Duplicate property', 'duplicateKey', 'Use the name of an enabled property containing the video URL or ID.');
    heading('Note properties');
    const labels = ['Video title', 'Video link', 'Video ID', 'Channel name', 'Channel ID', 'Duration', 'View count', 'Publish date', 'Description', 'Live stream', 'Private video', 'Unlisted video'];
    for (const [index, name] of metadataFields.entries()) row(labels[index], setting => { setting
      .addToggle(field => field.setValue(s.fields[name].enabled).onChange(value => { s.fields[name].enabled = value; save(); }))
      .addText(field => field.setValue(s.fields[name].key).onChange(value => { if (value.trim()) { s.fields[name].key = value.trim(); save(); } })); }, 'Include this property in new notes. The text field sets its property name.');
    heading('Bilibili');
    row('Account', account => {
      this.accountCheck?.abort();
    let loginButton: import('obsidian').ButtonComponent;
    account.addButton(button => { loginButton = button; button.setButtonText(s.cookie ? 'Checking…' : 'Sign in with QR code').setDisabled(!!s.cookie).onClick(() => this.host.login(() => this.update())); })
      .addButton(button => button.setButtonText('Sign out').setDisabled(!s.cookie).onClick(() => { this.accountCheck?.abort(); s.cookie = ''; s.accountName = ''; s.accountId = ''; save(); this.update(); }));
    if (!s.cookie) account.setDesc('Sign in to access captions that require a Bilibili account.');
    else {
      account.setDesc(s.accountName ? `Saved account: ${s.accountName} (UID ${s.accountId}). Checking session…` : 'Checking the saved session with Bilibili…');
      const cookie = s.cookie;
      const controller = new AbortController(); this.accountCheck = controller;
      void readAccount(obsidianTransport, cookie, controller.signal).then(result => {
        if (controller.signal.aborted || s.cookie !== cookie) return;
        s.accountName = result.name; s.accountId = result.id; save();
        account.setDesc(result.signedIn ? `${result.name || 'Bilibili account'} · UID ${result.id}` : 'The saved session has expired. Sign in again.');
        loginButton.setButtonText(result.signedIn ? 'Signed in' : 'Sign in with QR code').setDisabled(result.signedIn);
      }).catch(() => {
        if (controller.signal.aborted || s.cookie !== cookie) return;
        account.setDesc('A session is saved, but its status could not be verified. Reopen settings to retry, or sign in again.');
        loginButton.setButtonText('Sign in with QR code').setDisabled(false);
      });
    }
      return () => this.accountCheck?.abort();
    });
    heading('Speech recognition');
    const draft = this.recognitionDraft ??= { recognition: s.recognition, provider: s.provider, groqKey: s.groqKey, openaiKey: s.openaiKey, model: s.model };
    row('Enable speech recognition', setting => { setting.addToggle(field => field.setValue(draft.recognition).onChange(value => { draft.recognition = value; })); }, 'When captions cannot be retrieved, send audio to your chosen service for transcription. Charges may apply. Save and apply to confirm.');
    row('Provider', setting => { setting.addDropdown(field => field.addOption('groq', 'Groq').addOption('openai', 'OpenAI').setValue(draft.provider).onChange(value => { draft.provider = value === 'openai' ? 'openai' : 'groq'; this.update(); })); });
    for (const [name, key, description] of [
      ['Groq API key', 'groqKey', 'Saved locally without encryption; may sync with your vault. Keep this key private.'],
      ['OpenAI API key', 'openaiKey', 'Saved locally without encryption; may sync with your vault. Keep this key private.'],
      ['Model', 'model', 'Leave blank for whisper-large-v3-turbo (Groq) or whisper-1 (OpenAI).'],
    ] as const) {
      row(name, setting => { setting.addText(field => {
      field.setValue(draft[key]).onChange(value => { draft[key] = value; });
      if (key !== 'model') field.inputEl.type = 'password';
    }); }, description);
      items[items.length - 1].visible = () => key === 'model' || key === (draft.provider === 'groq' ? 'groqKey' : 'openaiKey');
    }
    row('Save recognition settings', setting => { setting.addButton(button => button.setButtonText('Save and apply').setCta().onClick(async () => {
      const next = { ...draft, groqKey: draft.groqKey.trim(), openaiKey: draft.openaiKey.trim(), model: draft.model.trim() };
      if (next.recognition && !(next.provider === 'groq' ? next.groqKey : next.openaiKey)) {
        setting.setDesc('Enter an API key for the selected provider before saving.'); return;
      }
      const previous = { recognition: s.recognition, provider: s.provider, groqKey: s.groqKey, openaiKey: s.openaiKey, model: s.model };
      button.setDisabled(true);
      Object.assign(s, next);
      try {
        await this.host.persist();
        setting.setDesc('Saved. You can import a video or resume a paused import. Saving does not test the API key.');
        new Notice('Speech recognition settings saved.');
      } catch {
        Object.assign(s, previous);
        setting.setDesc('Could not save. Previous settings remain active; try again.');
        new Notice('Could not save recognition settings.');
      } finally { button.setDisabled(false); }
    })); }, 'Confirm the switch, provider, API keys and model here. Saving does not call a recognition service.');
    text('Spoken source language', 'spokenLanguage', 'The language spoken in the audio, never an output or translation language. Use zh for Chinese, en for English, or leave blank for automatic detection.');
    number('Audio segment length', 'chunkSeconds', 60, 600, 'Seconds per recognition request (60–600). Recommended: 300.'); number('Parallel recognition requests', 'concurrency', 1, 3, 'Requests sent at once (1–3). Recommended: 2. Reduce this if the service limits requests.');
    const groups = definitions as SettingDefinitionGroup[];
    const advancedNames = new Set(['Save a folder shortcut', ...s.savedDirectories, 'Duplicate property', 'Spoken source language', 'Audio segment length', 'Parallel recognition requests']);
    const advanced: SettingDefinitionItem[] = [];
    for (const group of groups) {
      const moved = (group.items || []).filter(item => advancedNames.has(item.name));
      group.items = (group.items || []).filter(item => !advancedNames.has(item.name));
      if (moved.length) advanced.push({ type: 'group', heading: group.heading, items: moved });
    }
    const properties = groups.find(group => group.heading === 'Note properties')!;
    definitions.splice(definitions.indexOf(properties), 1);
    definitions.push({ type: 'page', name: 'Note properties', desc: 'Choose which video details to save and customize their property names.', items: [properties] });
    definitions.push({ type: 'page', name: 'Advanced', desc: 'Folder shortcuts, duplicate matching and recognition performance.', items: advanced });
    heading('Help');
    row('User guide', setting => { setting.addButton(button => button.setButtonText('Open guide').onClick(() => window.open('https://github.com/jackiexu001/video-transcript-obsidian-fetch#readme'))); }, 'Setup, naming templates, privacy and troubleshooting.');
    row('Report a problem', setting => { setting.addButton(button => button.setButtonText('Report issue').onClick(() => window.open('https://github.com/jackiexu001/video-transcript-obsidian-fetch/issues'))); }, 'Include the plugin version and error message. Never share API keys or account cookies.');
    row('Video Transcript Fetch', () => {}, `Version ${this.host.manifest.version} · Larry Xu`);
    return definitions;
  }
}

export class ImportModal extends Modal {
  private closed = false;
  private discovery?: AbortController;
  constructor(app: App, private settings: Preferences, private submit: (options: ImportOptions) => void,
    private inspect: (url: string, signal: AbortSignal) => Promise<Video>, private finished: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Import video transcripts');
    const el = this.contentEl;
    let createNote = this.settings.createNote, folder = this.settings.directory, language = this.settings.languages;
    let includeUrl = this.settings.includeUrl, channelTag = this.settings.channelTag;
    const input = el.createEl('textarea', { cls: 'vtf-next-urls', attr: { placeholder: 'YouTube or Bilibili links, one per line', rows: '4' } });
    let languageControl: HTMLSelectElement;
    new Setting(el).setName('Caption language').addDropdown(field => { languageControl = field.selectEl; field.addOption('', 'Use preferred languages').onChange(value => { language = value || this.settings.languages; }); });
    const status = el.createEl('p');
    new Setting(el).setName('Available languages').addButton(button => button.setButtonText('Load languages').onClick(() => {
      this.discovery?.abort(); this.discovery = new AbortController();
      const controller = this.discovery;
      status.setText('Loading…');
      void this.inspect(input.value.split('\n')[0].trim(), controller.signal).then(video => {
        if (this.closed || controller.signal.aborted) return;
        languageControl.replaceChildren();
        const first = languageControl.createEl('option'); first.value = ''; first.textContent = 'Use preferred languages'; languageControl.appendChild(first);
        for (const track of video.tracks) { const option = languageControl.createEl('option'); option.value = track.language; option.textContent = track.name; languageControl.appendChild(option); }
        status.setText(video.tracks.length ? `${video.tracks.length} caption tracks available.` : video.loginRequired ? 'Bilibili sign-in is needed for captions.' : 'No caption tracks listed.');
      }).catch(() => { if (!this.closed && !controller.signal.aborted) status.setText('Could not load languages. You can still try importing the video.'); });
    }));
    new Setting(el).setName('Create a new note').addToggle(field => field.setValue(createNote).onChange(value => { createNote = value; }));
    let folderInput: HTMLInputElement;
    new Setting(el).setName('Folder').addText(field => { folderInput = field.inputEl; field.setValue(folder).onChange(value => { folder = value; }); });
    if (this.settings.savedDirectories.length) new Setting(el).setName('Saved folders').addDropdown(field => { field.addOption('', 'Choose a shortcut'); for (const path of this.settings.savedDirectories) field.addOption(path, path); field.onChange(value => { if (value) { folder = value; folderInput.value = value; } }); });
    new Setting(el).setName('Include video link').addToggle(field => field.setValue(includeUrl).onChange(value => { includeUrl = value; }));
    new Setting(el).setName('Tag with channel name').addToggle(field => field.setValue(channelTag).onChange(value => { channelTag = value; }));
    new Setting(el).addButton(button => button.setButtonText('Import').setCta().onClick(() => {
      const urls = input.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!urls.length) { status.setText('Enter at least one video link.'); return; }
      this.close(); this.submit({ urls, createNote, directory: folder, language, includeUrl, channelTag });
    }));
    if (this.settings.clipboard) void navigator.clipboard.readText().then(text => { if (!this.closed && !input.value && /(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv)/i.test(text)) input.value = text.trim(); }).catch(() => { /* Clipboard permission is optional. */ });
  }
  onClose(): void { this.closed = true; this.discovery?.abort(); this.contentEl.empty(); this.finished(); }
}

export class ResultModal extends Modal {
  constructor(app: App, private title: string, private message: string, private retry?: () => void, private retryLabel = 'Retry') { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.title); this.contentEl.createEl('p', { text: this.message });
    const row = new Setting(this.contentEl);
    if (this.retry) row.addButton(button => button.setButtonText(this.retryLabel).onClick(() => { this.close(); this.retry?.(); }));
    row.addButton(button => button.setButtonText('Close').onClick(() => this.close()));
  }
}
