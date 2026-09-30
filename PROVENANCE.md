# Implementation provenance

Started 2026-09-30 as a separate implementation of the user's video-to-note workflow.

## Boundary

- No source, test, stylesheet, image, built plugin, or platform module was copied from either sibling project into this directory.
- The implementation has its own domain model, request boundary, UI, renderer, MP4 parser, recognition pipeline, tests, package file, and lock file.
- Existing names of persisted settings and commands are retained only as an explicit interoperability contract. The migration reads settings in the plugin's own data file, not another plugin's file.
- The old implementation and its notices remain unchanged. This directory must be reviewed and exported separately before a new repository is submitted.
- The implementing assistant **had previously inspected legacy source** during the repository review and feature inventory. This is not a formally separated clean-room process, and no such certification is claimed. Newly written code and an absence of file copying do not by themselves establish eligibility under the directory's fork rules.

## Inputs used

1. User-requested behavior and an inventory of the old settings/UI. During the 3.0.1, 3.0.2, 3.0.5, 3.0.6 and 3.1.0 regression repairs, the legacy transport, login, YouTube, audio client and range-download modules were read to identify omitted protocol fields and fallback behavior. New code was written in the new implementation; old source and tests were not copied.
2. Protocol observations described in the project documentation (caption login gates, media range limits, and platform URL conventions). These are treated as hypotheses until independently tested.
3. Obsidian's public API declarations: https://github.com/obsidianmd/obsidian-api
4. MP4 byte-stream structure: https://www.w3.org/TR/mse-byte-stream-format-isobmff/
5. Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData and https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
6. Recognition request format: https://console.groq.com/docs/speech-to-text
7. Current YouTube client protocol constraints were cross-checked against https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py. No implementation was imported from that source.
8. Current directory policy: https://docs.obsidian.md/community-directory/developer-policies

YouTube and Bilibili integration uses non-public/stable platform interfaces. Client identifiers and response field names are protocol data, not a supported API contract. They require live validation and ongoing maintenance.

## Third-party code

`qrcode-generator` 2.0.4 is an explicitly declared MIT dependency used only to calculate QR modules. Its license notice is distributed with the release. Obsidian is an external host API; esbuild and TypeScript are development tools. All dependency versions and integrity hashes are in package-lock.json.

## Release review still required

Review source lineage and code similarity before describing the project as independent in a submission. Keep this disclosure accurate. Do not erase attribution from the retained inherited project, present a renamed fork as new code, or claim that an automated scan proves authorship. The current implementation is a candidate requiring review, not a guarantee of acceptance.

### 3.0.5 protocol references

- WBI parameter ordering, signing-key permutation and digest protocol were checked against https://github.com/pskdje/bilibili-API-collect/blob/main/docs/misc/sign/wbi.md. The small signing function was written for this implementation using Node crypto.
- Current web subtitle endpoint parameters and wire-field identifiers were checked against https://github.com/ccBilly-aipm/bilibili-ai-subtitle/blob/main/docs/FLOW_EN.md and its extractor request specification. A bounded wire reader was written locally; no third-party parser or extractor was imported.
- Original plugin source was executed only as a local diagnostic comparator. No original implementation was bundled into the new release.

## 3.1.0 review outcome

Source comparison, bundle boundaries and licensing notices were reviewed; see REVIEW.md for scope, findings and limitations. The separate repository exports only this implementation. No authorship certification or guarantee of community-directory acceptance is claimed.
