# Video Transcript Fetch

Import YouTube and Bilibili transcripts into Obsidian notes. Read platform captions first, then optionally transcribe unavailable captions with Groq or OpenAI. Preserve the original speech: no automatic translation or summarization.

Desktop only · Obsidian 1.13.0+ · MIT · Community directory submission candidate

## Use

1. Install the plugin and open **Settings → Video Transcript Fetch**.
2. For Bilibili captions that require an account, choose **Sign in with QR code**, scan in the Bilibili app and confirm. A successful account check shows **Signed in**, your name and UID.
3. Run **Import video transcript** from the command palette or ribbon. Paste one URL per line (up to 100 per batch).
4. Keep **Create a new note** enabled for separate files, or disable it to insert at the selection in the active Markdown note. Folder templates, filename templates, timestamps, metadata fields and language preferences are configurable.
5. To transcribe when captions are unavailable, enable **Speech recognition**, select a provider and enter your own API key. Leave the spoken language blank for automatic detection, or use `zh`, `en`, etc. This is the input speech language, not a translation target.

Use **Load languages** to select an existing platform track. The plugin never asks a platform to generate a translation. Default selection preserves the platform's track order rather than forcing English.

## Pause, resume and costs

- Videos run sequentially. Metadata requests share one lane with an 800 ms minimum interval; audio ranges use a separate lane of at most four requests. Default recognition concurrency is two chunks.
- Successful metadata/caption responses are reused for up to two minutes in the current plugin session (up to 32 responses, at most 2 MB each). Expiring signed caption URLs expire sooner. Refused audio addresses can be refreshed.
- HTTP 429 honors `Retry-After` (seconds or an HTTP date). Short waits have bounded retries; long/exhausted cooldowns pause the queue. YouTube bot verification stops the client ladder and pauses the batch immediately.
- Use **Cancel transcript import** to pause. **Resume paused transcript import** continues the saved queue, including after an Obsidian restart. Completed videos and saved recognition chunks are not submitted again.
- A paid request is checkpointed **before** submission. If its result is unknown, the plugin requires **Retry uncertain chunks (may charge again)** before resubmitting. No client can guarantee that a provider did not charge for a response lost in transit.
- Decoded, unfinished audio is reused within the session up to a 64 MB memory bound. It is not stored on disk; after restart, unfinished audio may need downloading again. Successful recognition text survives restart. Up to 100 video/configuration checkpoints are retained; older completed entries may be evicted.
- Use **Discard saved import progress** to clear the queue and checkpoints explicitly. Existing notes remain. A later import can incur new recognition charges.

A node/IP change may restore access, but is not an automatic plugin feature. If YouTube requests verification, open the video in your browser, resolve access, then resume. Private, deleted, geographically restricted, account-gated and live videos may remain unavailable. Platform APIs are undocumented and can change; universal availability is not promised.

## Install before directory approval

Download `main.js`, `manifest.json`, and `styles.css` from the [release](https://github.com/jackiexu001/video-transcript-fetch/releases). Put all three in:

```text
<Vault>/.obsidian/plugins/video-transcript-fetch/
```

Reload Obsidian and enable **Video Transcript Fetch**. Use a disposable vault first. A ZIP is provided for convenience; extract its files rather than placing the ZIP in the plugin folder.

When upgrading, replace only these three files **in the existing plugin directory**. Keep its `data.json`; it contains your settings, Bilibili session and progress. Creating a separate version-named directory without moving settings loses the visible login state. Do not enable two copies with the same plugin ID. Legacy settings from the previous video-transcript implementation are migrated when its data file is retained.

The browser extension is separate and is not needed by this plugin. The compatible `obsidian://yt-transcript?url=ENCODED_URL&folder=ENCODED_FOLDER` command remains available.

## Network, privacy and accounts

| Service | Purpose | Data sent |
| --- | --- | --- |
| YouTube / googlevideo.com | Video metadata, captions and audio | Video identifier and media requests; no browser cookies are read |
| Bilibili / b23.tv / hdslb.com / bilivideo.com / bilivideo.cn / biliapi.net | Metadata, captions, short links and audio | Video identifier; Bilibili session only to intended Bilibili API/page hosts |
| passport.bilibili.com | Optional QR login | QR session polling |
| api.groq.com / api.openai.com | Optional speech recognition | Selected audio chunks and the selected provider's API key |

There is no project server, analytics, advertising, telemetry, vault upload, external executable, dependency installer, or access to files outside the vault. Speech recognition is off by default; full audio recognition requires an external account and may incur provider charges. Bilibili account access is optional but often needed for captions.

Settings, API keys and the Bilibili session are stored **unencrypted** in the vault's plugin `data.json` and may be synced or backed up with it. The same file stores paused URLs, completed recognition text and temporary note-write recovery content. An unfinished insertion can temporarily retain the target note's before/after text for safe recovery. This data is not sent to any service. Discard progress removes recovery data/checkpoints; sign out removes the Bilibili session. Cancelling cannot retract a request already sent to a provider.

For issues, include plugin/Obsidian version, platform, a public video URL and the visible error. **Do not attach `data.json`, API keys, cookies or signed media URLs.**

## 中文说明

优先抓取平台字幕，失败后才使用已启用的语音识别；只转写原话，不翻译、不总结。批量导入按顺序进行，遇到 YouTube 人机验证会暂停。使用命令面板的 **Resume paused transcript import** 恢复；已完成的视频和识别分片不会重复处理。识别结果不明的请求必须确认可能再次计费后才会重发。

升级时保留原插件目录里的 `data.json`，否则登录和进度不会出现在新目录中。请勿把该文件发到 GitHub。

## Development and review

```sh
npm ci
npm test
npm run lint
npm run package
```

Node.js 22.18+ is required for development. CI validates on Linux and Windows; live host evidence is macOS only. See [ACCEPTANCE.md](ACCEPTANCE.md) for exact evidence, [REVIEW.md](REVIEW.md) for the source/security review, and [PROVENANCE.md](PROVENANCE.md) for implementation history. Tests and similarity checks are not proof of directory eligibility. Obsidian makes the final publication decision.

Application code is MIT licensed. The bundled QR library's MIT attribution is retained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). No legacy plugin bundle is included.
