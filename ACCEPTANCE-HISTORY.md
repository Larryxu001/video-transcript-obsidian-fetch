# Rewrite acceptance

Scope: preserve the existing working transcript workflow. Removed LLM/PDF/SRT remnants are not features to reintroduce. The browser extension remains unchanged.

## Automated acceptance

| Behavior | Implementation / evidence |
| --- | --- |
| Legacy settings import | Typed, allowlisted migration; credentials and core preferences preserved; obsolete formats excluded |
| Platform and part identity | YouTube URL variants, Bilibili BV IDs and part numbers; strict hostname checking |
| Captions | Platform metadata, language selection, JSON3 / XML / srv3 / TTML captions, alternate YouTube clients; unreadable captions use recognition only if explicitly enabled |
| Bilibili account | QR rendering and sequential cancellable polling; locally saved cookie and sign-out |
| Notes | Insert into active editor or create Markdown; safe filenames; folder/date templates; embedded video; timestamp links |
| Properties | Per-field enable/rename; quoted YAML values; duplicate-property detection |
| Duplicate handling | Vault lookup before caption fetch; per-batch deduplication; collision suffix without overwriting |
| Speech recognition | Indexed byte-range audio, PCM WAV conversion, overlaps, provider selection and explicit opt-in |
| Retry | No automatic paid POST replay; reuse completed chunks; language/model/plan-specific cache |
| Lifecycle | Cancel command and unload abort prevent subsequent note writes; QR polling stops on close |
| Plugin integration | Actual plugin entry point tested with a simulated host; no live vault modified |

`npm test` and `npm run build` are required. Individual passing fixtures do not imply all rows are live-verified.

Latest local checks (2026-09-30): 91/91 tests passed; TypeScript and production build passed; official ESLint configuration reported 0 errors and 20 warnings. Warnings concern declarative settings/search, window timer/style guidance, and brand casing. They remain visible and are not suppressed. Development install assets are in `release/3.0.5/` (ignored build output).

Historical 3.0.0 evidence (does not validate 3.0.1): a second build in a fresh temporary directory, installed exclusively from this package-lock.json, passed the same 51 tests, lint (0 errors / 18 warnings), type check, and packaging. Its `main.js` SHA-256 exactly matched the workspace build: `c88c40285612a9bf7e5bb23ea8d97488abb88f9b547b2b7d5a24bf7df39c9318`. The original 135 tracked repository files were separately rehashed and remain unchanged.

## Live evidence — 2026-09-30

- Public Bilibili video BV1xx411c7mD: new metadata reader returned title and duration (2055 seconds). No login or paid service used.
- Audio-source discovery exposed a real compatibility issue: P2P primary URLs can use port 8082. The implementation now skips unsupported addresses and keeps HTTPS CDN backups instead of rejecting the entire stream.
- CDN probe required a Bilibili Referer. With it, the new parser consumed a 4976-byte HTTP 206 index containing 412 fragments, totaling 2055.638 seconds against the 2055-second video metadata. Media requests now include that Referer without a session cookie.
- YouTube LHK4FRpc0eQ: the repaired Platforms implementation, using a curl transport through the existing system proxy, returned the correct title and 232 caption segments (8395 characters). No login or paid recognition was used. Direct CLI connections time out because they do not inherit the macOS proxy. This proves the real platform protocol path, not Obsidian requestUrl end to end.
- Bilibili BV1FnhC6qEck: public metadata succeeded; the signed-out player response returned no caption tracks. Signed-in validation awaits explicit user authorization and QR confirmation.
- Native browser DOMParser tests passed classic XML, srv3 millisecond timing, TTML clock timing/line breaks, and rejection of HTML challenge pages.
- Production-style CommonJS host tests passed native Bilibili module loading, passport routing through requestUrl, and fallback after native connection failure. The old dynamic import was not compatible with this host fixture.
- Real media decode: took an 86529-byte indexed MP4 slice covering 59.981–69.989 seconds. The new decoder ran in the in-app browser and produced exactly 80000 samples at 16000 Hz (5 seconds, 160044 WAV bytes), without playback or upload. This verifies one Bilibili media fixture, not every platform/codec.
- QR account login, actual Obsidian rendering, paid recognition, and mobile runtime have not yet been validated end to end. The installed Obsidian CLI is disabled; the isolated-profile launch did not expose a test-vault window, so no changes were made in the personal vault.

## 3.0.2 regression repair

- Fixed Obsidian's root folder path `/` being rejected after transcript retrieval. Root notes and explicit root destinations are covered; invalid absolute paths fail before caption or paid requests.
- Bilibili settings verify the saved session via `/x/web-interface/nav`, store/display nickname and UID, show a disabled Signed in button for a valid session, and clear identity on sign-out. Expired sessions prompt sign-in. UI and API behavior are covered with host fixtures; no live account was accessed in this repair.
- YouTube audio: corrected VISIONOS 1.02 and device context, added Android fallback, removed player framing/query parameters before byte-range requests, and supplied a media User-Agent. This follows protocol behavior observed in the legacy modules, without importing their implementation.
- Public video LHK4FRpc0eQ yielded VISIONOS and IOS audio candidates. VISIONOS supplied 1888163 bytes covering 0–309.522 seconds. The actual browser decoder produced exactly 300 seconds of mono 16 kHz WAV (9600044 bytes). No paid service was called. The exact no-caption video supplied later is verified below.
- Complete-pipeline testing also reproduced a later-chunk HTTP 403 after the first chunk succeeded. Audio discovery now refreshes refused/expired YouTube URLs at most twice per chunk, without replaying paid requests or dropping already recognized chunks. Recovery is covered by a regression test.
- A subsequent run of the actual `recognize` pipeline downloaded both windows for LHK4FRpc0eQ: 0–300 and 298–505 seconds. The provider boundary was replaced with two synthetic responses (zero real provider calls). The browser then decoded the captured inputs using the production decoder: 300 seconds / 9600044 WAV bytes and 207 seconds / 6624044 WAV bytes, both passed. This verifies download, assembly, offset and decode, not real speech recognition or paid speech recognition.
- Exact YouTube regression eUPPQVdPIbw (848 seconds, no caption tracks): the production audio pipeline downloaded all three windows with a mocked provider boundary. Actual browser decoding passed 300, 302 and 250 seconds (overlap included), with byte sizes 9600044, 9664044 and 8000044. No real provider requests were made.
- Bilibili BV1Mdhf6ZEuy exposed two additional issues: CDN requests require a suitable User-Agent, and the final indexed audio end is 628.564 seconds while metadata rounds to 629. Requests now include the media header, all supported audio qualities/backups are retained, and only the final sub-second rounding difference is trimmed to the actual audio end. Regression tests preserve rejection for larger missing intervals.
- Exact Bilibili regression BV1Mdhf6ZEuy: the production audio pipeline downloaded all three windows. Native browser decoding passed 300, 302 and 30.5641723356 seconds, producing WAV sizes 9600044, 9664044 and 978098 bytes. Three simulated provider responses were used; zero paid requests. Signed-in caption access and real provider transcription remain unverified.
- Final 3.0.2 main.js SHA-256: `2781768d2a751ab4276cd08aa935ced3c2ab03603b0242bf5f81594d3b778287`.
- Download/decode errors now retain the failing chunk time and underlying error, including HTTP status, instead of collapsing every failure into one generic message.

## 3.0.3 subtitle priority and original-language repair

- Public API verification for BV1D3h46BEax returned `need_login_subtitle=true` and `login_mid=0`; that is restricted subtitle access, not evidence of a subtitle-free video. Version 3.0.3 stopped these imports. Version 3.0.4 supersedes that restriction: after platform subtitle attempts fail, enabled recognition is allowed as fallback, with a failure reason shown.
- Subtitle discovery preserves page tracks, uses the numeric aid when available, and checks the alternate player endpoint before considering an authenticated empty list to mean absent captions. The existing session is sent to the video page as well as the API, never to subtitle CDNs.
- Removed implicit English-first caption selection. Explicit preferences still select existing platform tracks; no translation track is synthesized or requested.
- Read-only inspection of the installed plugin's non-secret preferences showed empty preferred-caption and source-language settings, Groq, and its default model. No API key or Cookie was displayed or used. This rules out an explicit English preference but does not prove the exact cause of the reported English output.
- Recognition requests remain on `/audio/transcriptions`, with no translation/summarization prompt. The working ASR behavior was left unchanged after authenticated testing identified selectable platform English captions as a concrete cause. No speculative language guessing or output rewriting was added.
- Regression tests cover Chinese platform captions with zero paid requests, login-gated captions with zero audio/paid requests, alternate endpoint/page caption recovery, original-order selection, and use of the transcription endpoint with returned Chinese content preserved.
- After explicit authorization, the saved Bilibili session was verified as valid using the production native transport. BV1D3h46BEax returned both ai-zh and ai-en among its available platform tracks in one response; the old English preference would select ai-en. The repaired selection fetched ai-zh (173 segments / 1458 Han characters in that run) with zero provider calls. Another response returned only ai-zh with 278 segments; these platform results are snapshots, not fixed test fixtures. Cookie values and provider keys were never displayed, exported, or sent outside their intended service. No paid recognition was performed. Authenticated follow-up checks also fetched ai-zh for BV1Mdhf6ZEuy (285 segments / 2608 Han characters); BV1FnhC6qEck returned a verified empty track list. These checks used only Bilibili requests.

## Release gates

- [ ] Independent-source review and directory-policy assessment completed. See PROVENANCE.md.
- [ ] Full test, type-check, official lint, and deterministic release build pass.
- [ ] Fresh-vault desktop installation verified; existing settings upgrade tested using disposable fixtures.
- [ ] Bilibili signed-in captions and QR session expiry/cancellation verified with user participation.
- [ ] YouTube captions and no-caption audio verified from a working network.
- [ ] Actual fragmented audio decodes to the intended duration without padding or dropped speech.
- [ ] One explicitly authorized recognition run per provider, including interruption and resume, verified.
- [ ] Target platforms validated. Current candidate manifest is desktop-only; full mobile parity is still outstanding.
- [ ] Standalone repository prepared with root metadata, license, workflow, and release assets.
- [ ] Documentation and screenshots describe the tested behavior; official review errors resolved.

Do not replace the installed legacy plugin, claim full feature parity, or publish this candidate while these gates remain unresolved.

## 3.0.4 fallback correction

- Preserves platform-caption priority and original-language selection. Login restrictions, exhausted subtitle queries, and unreadable tracks now permit enabled recognition fallback. Disabled recognition does not discover or upload audio after these failures.
- Regression tests verify query/read/login failures with recognition on and off, and Chinese caption success without audio/provider calls. Fallback tests stop at mocked audio discovery; recognition pipeline tests use a mocked provider. No live paid recognition was performed.

## 3.0.5 live host regression investigation

- Tests ran through Obsidian CLI in a temporary in-memory plugin using the real Obsidian `requestUrl` and Web Audio APIs. The installed 3.0.4 plugin, vault settings and notes were not modified.
- YouTube `eUPPQVdPIbw` and `LHK4FRpc0eQ`: reproduced login/bot verification failures. The original `obsidian-plugin/src/youtube.ts` also failed both in the same host. Old Android/iOS versions returned HTTP 400; current versions still encountered the verification gate. New code preserves actual rejection reasons and includes VISIONOS metadata fallback. **Live YouTube acceptance is still blocked**, not passed.
- Bilibili unsigned legacy queries intermittently supplied unrelated subtitle timelines. Merely changing AID to BVID did not resolve this. WBI signing plus stopping legacy lookup after a successful signed empty response produced consistent target tracks in the final checks.
- Final authenticated production-path results: BV1D3h46BEax: ai-zh, 173 cues, 1,458 Han characters, final cue 280.78s / video 281s; BV1Mdhf6ZEuy: ai-zh, 285 cues, 2,608 Han characters, final cue 628.4s / video 629s; BV1FnhC6qEck: signed/current metadata both empty, duration 654s. No provider was called during these checks.
- New Protobuf web metadata endpoint is supported for additional discovery. Its `subtitle.bilibili.com` download host failed DNS/connection checks in this environment; this path is not claimed to work end to end here. Signed JSON track URLs worked. No unverified hostname rewriting was added.
- Audio regression: previous code serialized 400KB requests and inspected every backup before downloading. Downloads now use four bounded workers, preserving byte order, and discover compatible backups only on failure. First 300s of BV1FnhC6qEck: 3.0.4 1,683ms / 13 requests / peak 1; working code 766ms / 9 requests / peak 4. Real Obsidian decoding included, paid provider mocked. Network cache/order can influence these one-run numbers.
- Download, decode and upload/recognition now have separate progress messages. Recognition service latency and actual recognition content require a separately authorized live provider check; do not infer them from mocked responses.
- Unit regressions cover parallel ordering, lazy backup access, WBI query parameters, Protobuf parsing, incorrect subtitle timing, current YouTube client fallback and preserved restriction messages. 91 tests pass; TypeScript/build and lint are checked before packaging.

- Full BV1FnhC6qEck 654-second audio path passed in the real host: 18 media requests, 5,443,663 bytes, three decoded WAV chunks, 1,905ms measured total before real-provider work (mocked responses only). Default two chunk workers allowed peak eight media requests (four per worker). This verifies download/decode coverage, not real transcription accuracy or speed.

### Authorized real Groq acceptance (same session)

After the user explicitly authorized one Bilibili sample's single recognition flow, BV1FnhC6qEck was processed in the actual Obsidian host with the configured Groq key retained only in memory. No key was printed or copied into files. The 654-second video used the default three overlapping chunks and two workers. All three provider calls returned HTTP 200, each submitted once; no failed request replay or second recognition run occurred.

- Full elapsed time: 25,991ms including metadata, download, real Web Audio decode, upload and real provider responses.
- Provider round trips: 18,577ms, 18,622ms, 3,388ms (first two overlap).
- Result: 350 segments, 3,435 characters, 3,160 Han characters; first timestamp 0, last 653.559998s. Output is Chinese rather than English translation; no summarization or translation endpoint was called. This validates one sample, not universal transcription accuracy.
- Review artifact: `/private/tmp/vtf-asr-acceptance-BV1FnhC6qEck.md`. No vault note or installed plugin was changed.
- Final YouTube retry through production code still received explicit bot-verification rejections for both supplied samples. This remains unresolved; changing client versions alone is not a complete fix, and a fixed proxy node is not a plugin requirement.


## 3.0.6 comparison with the original 2.0.1

The reference is the actual `obsidian-plugin/manifest.json` version 2.0.1 and its source, not a reconstructed older algorithm. The original directory was not modified.

Concrete parity omissions corrected:
- Accept both `VISITOR_DATA` and `visitorData` watch-page fields.
- Retain embedded-TV and mobile-web audio fallback clients and their protocol headers. Stop discovery after two usable sources, as the original does, instead of querying every client after success.
- Restore the full VR media User-Agent and Android OS metadata.
- Do not discard MP4 audio URLs solely because the player omits init/index boundaries. Read the first 16KB and discover the sidx index, matching the original behavior. A regression verifies initialization/media assembly and that the header is fetched once. Explicit boundaries remain preferred when supplied.

Current-host comparison directly imported `fetchPlayerData` from the original 2.0.1 and `Platforms` from the working implementation into a temporary Obsidian plugin. LHK4FRpc0eQ and eUPPQVdPIbw both failed in both versions: original reports login required; working code reports bot verification, with embedded-TV reporting unsupported client. No account cookies, paid recognition, installed-plugin edits or vault writes were involved. Thus the code corrections pass fixture tests, but live YouTube acceptance still fails. Rate limiting is a hypothesis, not an established diagnosis.

The experimental yt-dlp/ffmpeg browser-session path was removed from production source and settings. Terminal metadata succeeded once, then failed on repeat with a browser-cookie decryption warning; the Obsidian subprocess also failed. No complete subtitle/audio download was verified through that experiment. It is not part of this candidate and does not impose new installed-tool dependencies.

Validation: 95 automated tests pass, TypeScript passes, lint has zero errors and 20 existing warnings. This candidate is not a claim of full YouTube recovery and must not replace the installed plugin automatically. The previous authorized Bilibili real-recognition result remains a historical sample; it was not repeated or billed again in this round.
