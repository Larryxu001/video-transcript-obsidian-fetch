// Test-only host double. Network responses are supplied by each scenario.
export const Platform = { isDesktop: false };
export class TFile { path: string; parent: { path: string }; constructor(path: string) { this.path = path; this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' }; } }
export class TFolder { path: string; constructor(path: string) { this.path = path; } }
export class MarkdownView { file: TFile | null = null; editor = { getValue: () => '', setValue: (text: string) => { this.editor.replaceSelection(text); }, getCursor: (_side: string) => ({ line: 0, ch: 0 }), posToOffset: (_pos: unknown) => 0, replaceSelection: (_text: string) => {} }; async save() {} }
export class Notice { constructor(_message: string, _timeout?: number) {} setMessage(_message: string) {} hide() {} }
export class PluginSettingTab { containerEl = { empty() {}, createEl() {} }; constructor(..._args: unknown[]) {}
  getSettingDefinitions(): Array<{ type?: string; items?: unknown[]; name?: string; desc?: string; render?: (row: Setting) => void }> { return []; }
  display() { for (const group of this.getSettingDefinitions()) for (const item of (group.items || [group]) as Array<{ name: string; desc?: string; render?: (row: Setting) => void }>) item.render?.(new Setting().setName(item.name).setDesc(item.desc || '')); }
  update() { this.display(); }
}
export class Modal {
  titleEl = { setText: (_text: string) => {} };
  contentEl = { createEl: (..._args: unknown[]) => ({ setText: (_text: string) => {} }), createDiv: (..._args: unknown[]) => ({ createEl: () => { throw new Error('A closed modal must not render a QR code.'); } }), empty: () => {} };
  constructor(..._args: unknown[]) {}
  open() {}
  close() {}
}
class Control {
  text = ''; disabled = false; inputEl = { type: '', min: '', max: '' }; selectEl = {};
  click: () => void = () => {};
  setButtonText(value: string) { this.text = value; return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  onClick(callback: () => void) { this.click = callback; return this; }
  setCta() { return this; }
  setValue(_value: unknown) { return this; }
  change: (value: any) => void = () => {};
  onChange(callback: (value: any) => void) { this.change = callback; return this; }
  addOption(..._args: unknown[]) { return this; }
}
export class Setting {
  static rows: Setting[] = [];
  controls: Control[] = [];
  name = ''; description = ''; buttons: Control[] = [];
  constructor(..._args: unknown[]) { Setting.rows.push(this); }
  setName(value: string) { this.name = value; return this; }
  setDesc(value: string) { this.description = value; return this; }
  setHeading() { return this; }
  addButton(callback: (button: Control) => void) { const c = new Control(); callback(c); this.buttons.push(c); return this; }
  addText(callback: (field: Control) => void) { const c = new Control(); callback(c); this.controls.push(c); return this; }
  addToggle(callback: (field: Control) => void) { const c = new Control(); callback(c); this.controls.push(c); return this; }
  addDropdown(callback: (field: Control) => void) { const c = new Control(); callback(c); this.controls.push(c); return this; }
}
export class Plugin {
  manifest = { version: 'test' };
  app: unknown;
  saved: unknown;
  data: unknown;
  commands: unknown[] = [];
  async loadData() { return this.data; }
  async saveData(data: unknown) { this.saved = data; }
  addSettingTab(_tab: unknown) {}
  addRibbonIcon(..._args: unknown[]) {}
  addCommand(command: unknown) { this.commands.push(command); }
  registerObsidianProtocolHandler(..._args: unknown[]) {}
}
export async function requestUrl(input: unknown): Promise<unknown> {
  return (globalThis as unknown as { requestFixture: (value: unknown) => Promise<unknown> }).requestFixture(input);
}
