# 3.1.3

- Rename the display name to Video Caption Fetch, retaining the existing plugin ID and preferences.
- Correct repository links after the GitHub account rename and point the author URL to Larry Xu’s profile.
- Attest CI-built install files with GitHub build provenance; publish only main.js, manifest.json and styles.css.
- Clarify optional vault enumeration and clipboard behavior in the user guide.

# 3.1.2

- Organize settings with native Note properties and Advanced sub-pages.
- Use readable property labels, shorter descriptions and provider-specific key fields.
- Add user guide and issue links, remove the development diagnostic command and internal client lists from errors.
- Keep saved preferences, command IDs for existing workflows, and transcript behavior compatible.

# 3.1.1

- Add an explicit Save and apply button for speech recognition configuration, with validation and save-result feedback.
- Set the plugin author to Larry Xu.

- Resume paused imports using the current speech-recognition switch, provider, model and API keys, so correcting settings takes effect without discarding progress.

# Changelog

## 3.1.0

- Share short-lived metadata and caption responses across language discovery, import and diagnostics.
- Pace control requests, bound media concurrency and honor rate-limit cooldowns.
- Stop the YouTube client ladder on human-verification challenges.
- Persist the batch, completed recognition chunks and note-write recovery state across restarts.
- Require explicit approval before retrying a paid request with an uncertain result; reuse decoded audio within the session.
- Add searchable Obsidian settings and resolve lint findings without disabling rules.
- Retain signed Bilibili subtitle discovery, original-language transcription, QR login and the 2.0.1-compatible audio fallback/index behavior.

This release does not guarantee access to restricted videos or proxy nodes. It does not translate or summarize speech.
