import { readAccount } from './login.ts';
import { obsidianTransport } from './transport.ts';
import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin, SettingDefinitionItem, SettingDefinitionRender } from 'obsidian';
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
  hide(): void { this.accountCheck?.abort(); }
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
    const number = (name: string, key: 'timestampEvery' | 'chunkSeconds' | 'concurrency', min: number, max: number) => row(name, setting => { setting.addText(field => {
      field.inputEl.type = 'number'; field.inputEl.min = String(min); field.inputEl.max = String(max);
      field.setValue(String(s[key])).onChange(value => { const n = Number(value); if (Number.isFinite(n) && n >= min && n <= max) { s[key] = Math.floor(n); save(); } });
    }); });
    heading('Notes');
    text('Default folder', 'directory', 'Leave blank to use the active note’s folder. Supports {Platform}, {ChannelName}, {Year}/{Month}/{Day}, {Date}, and {PublishYear}/{PublishMonth}/{PublishDay}/{PublishDate}.');
    text('Note name', 'filename', 'Supports {VideoName}, {VideoId}, {ChannelName}, {Platform}, and date placeholders.');
    toggle('Create a new note', 'createNote');
    for (const directory of s.savedDirectories) row(directory, setting => { setting
      .addButton(button => button.setButtonText('Use').onClick(() => { s.directory = directory; save(); this.update(); }))
      .addButton(button => button.setButtonText('Remove').onClick(() => { s.savedDirectories = s.savedDirectories.filter(x => x !== directory); save(); this.update(); })); });
    let shortcut = '';
    row('Save a folder shortcut', setting => { setting.addText(field => field.onChange(value => { shortcut = value.trim(); }))
      .addButton(button => button.setButtonText('Save').onClick(() => { if (shortcut && !s.savedDirectories.includes(shortcut)) { s.savedDirectories.push(shortcut); save(); this.update(); } })); });
    heading('Transcript');
    text('Preferred caption languages', 'languages', 'Select existing platform tracks only; no translation is requested. Leave blank to keep the platform’s first available track.');
    toggle('Include video link', 'includeUrl'); toggle('Tag with channel name', 'channelTag');
    toggle('Show timestamps', 'timestamps'); number('Timestamp spacing in seconds', 'timestampEvery', 0, 86400);
    toggle('Single line transcript', 'singleLine');
    toggle('Allow clipboard access', 'clipboard', 'Only read when opening the import window or invoking the clipboard command.');
    toggle('Prevent duplicate notes', 'duplicates'); text('Duplicate property', 'duplicateKey', 'Use the name of an enabled property containing the video URL or ID.');
    heading('Note properties');
    for (const name of metadataFields) row(name, setting => { setting
      .addToggle(field => field.setValue(s.fields[name].enabled).onChange(value => { s.fields[name].enabled = value; save(); }))
      .addText(field => field.setValue(s.fields[name].key).onChange(value => { if (value.trim()) { s.fields[name].key = value.trim(); save(); } })); });
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
    toggle('Enable speech recognition', 'recognition', 'Transcribe original speech when no usable captions are available. Platform captions are tried first; failed subtitle access also falls back to recognition. This may incur charges. Disabled by default.');
    row('Provider', setting => { setting.addDropdown(field => field.addOption('groq', 'Groq').addOption('openai', 'OpenAI').setValue(s.provider).onChange(value => { s.provider = value === 'openai' ? 'openai' : 'groq'; save(); })); });
    text('Groq API key', 'groqKey', 'Stored in this vault’s plugin data.json, without encryption.', true);
    text('OpenAI API key', 'openaiKey', 'Stored in this vault’s plugin data.json, without encryption.', true);
    text('Model', 'model', 'Leave blank for whisper-large-v3-turbo (Groq) or whisper-1 (OpenAI).');
    text('Spoken source language', 'spokenLanguage', 'The language spoken in the audio, never an output or translation language. Use zh for Chinese, en for English, or leave blank for automatic detection.');
    number('Chunk length in seconds', 'chunkSeconds', 60, 600); number('Concurrent chunks', 'concurrency', 1, 3);
    row('Import progress', () => {}, `Version ${this.host.manifest.version}. Paused queues and completed recognition survive restarts. Use the resume or discard progress commands.`);
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
    new Setting(el).setName('Transcript language').addDropdown(field => { languageControl = field.selectEl; field.addOption('', 'Use preferred languages').onChange(value => { language = value || this.settings.languages; }); });
    const status = el.createEl('p');
    new Setting(el).setName('Available caption languages').addButton(button => button.setButtonText('Load languages').onClick(() => {
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
