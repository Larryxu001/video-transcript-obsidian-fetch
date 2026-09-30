import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import qrcode from 'qrcode-generator';
import { request, json, delay, object, text } from './http.ts';
import type { Transport } from './http.ts';

const loginHeaders = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/' };

export function sessionCookie(headers: Record<string, string>, callback = ''): string {
  const raw = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value).join('\n');
  let params = new URLSearchParams();
  try {
    const url = new URL(callback);
    if (url.protocol === 'https:' && (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))) params = url.searchParams;
  } catch { /* A callback is optional when headers contain the session. */ }
  const names = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];
  const cookies = names.flatMap(name => {
    const match = raw.match(new RegExp(`(?:^|[\\n,]\\s*)${name}=([^;\\r\\n,]+)`));
    const value = match?.[1] || params.get(name);
    return value && !/[;\r\n,]/.test(value) ? [`${name}=${value}`] : [];
  });
  if (!cookies.some(x => x.startsWith('SESSDATA='))) throw new Error('Login was confirmed but no session cookie was returned. Please try again.');
  return cookies.join('; ');
}

export class LoginModal extends Modal {
  private controller = new AbortController();
  private active = false;
  constructor(app: App, private transport: Transport, private save: (cookie: string) => Promise<void>, private finished: () => void) { super(app); }
  onOpen(): void {
    this.active = true;
    this.titleEl.setText('Sign in to Bilibili');
    this.contentEl.createEl('p', { text: 'Scan with the Bilibili app and confirm. The session is stored locally in this vault’s plugin settings.' });
    const target = this.contentEl.createDiv({ cls: 'vtf-next-qr' });
    const status = this.contentEl.createEl('p', { text: 'Loading QR code…' });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
    void this.login(target, status).catch((error: unknown) => {
      if (this.active) status.setText(`Login failed: ${error instanceof Error ? error.message : 'Request failed.'}`);
    });
  }
  private async login(target: HTMLElement, status: HTMLElement): Promise<void> {
    const signal = this.controller.signal;
    const start = json(await request(this.transport, signal, { headers: loginHeaders, url: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate' }));
    const data = object(start.data);
    if (start.code !== 0 || !text(data.url) || !text(data.qrcode_key)) throw new Error('QR code unavailable.');
    signal.throwIfAborted();
    const code = qrcode(0, 'M'); code.addData(text(data.url)); code.make();
    const size = code.getModuleCount();
    const canvas = target.createEl('canvas'); canvas.width = (size + 8) * 5; canvas.height = canvas.width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('QR code rendering unavailable.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#000';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (code.isDark(y, x)) context.fillRect((x + 4) * 5, (y + 4) * 5, 5, 5);
    status.setText('Waiting for your scan…');
    for (let count = 0; count < 90; count++) {
      await delay(2000, signal);
      const reply = await request(this.transport, signal, { headers: loginHeaders, url: `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(text(data.qrcode_key))}` });
      const response = json(reply);
      if (response.code !== 0) throw new Error('Login request rejected.');
      const state = Number(object(response.data).code);
      if (state === 0) {
        signal.throwIfAborted();
        await this.save(sessionCookie(reply.headers, text(object(response.data).url)));
        new Notice('Signed in to Bilibili.'); this.close(); return;
      }
      if (state === 86038) { status.setText('The code expired. Close this window and try again.'); return; }
      if (![86101, 86090].includes(state)) throw new Error(`Bilibili login rejected (code ${state}).`);
      status.setText(state === 86090 ? 'Confirm the login on your phone.' : 'Waiting for your scan…');
    }
    status.setText('Login timed out. Close this window and try again.');
  }
  onClose(): void { this.active = false; this.controller.abort(); this.contentEl.empty(); this.finished(); }
}

export async function readAccount(transport: Transport, cookie: string, signal: AbortSignal): Promise<{ signedIn: boolean; name: string; id: string }> {
  if (!cookie) return { signedIn: false, name: '', id: '' };
  const response = json(await request(transport, signal, { url: 'https://api.bilibili.com/x/web-interface/nav', headers: { 'User-Agent': 'VideoTranscriptFetch/3.0', Referer: 'https://www.bilibili.com/', Cookie: cookie } }));
  if (response.code === -101) return { signedIn: false, name: '', id: '' };
  if (response.code !== 0) throw new Error('Could not verify the saved Bilibili session.');
  const data = object(response.data);
  return { signedIn: data.isLogin === true, name: text(data.uname), id: text(data.mid) };
}
