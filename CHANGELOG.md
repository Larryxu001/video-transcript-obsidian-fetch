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
