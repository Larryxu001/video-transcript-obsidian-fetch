# Acceptance evidence — 3.1.2

## Automated and build validation

- 113 tests pass locally, including real plugin orchestration with a simulated vault, caption parsing, source validation, range assembly, language preservation, legacy settings migration, account UI, serial/paced metadata, four-request media concurrency, cache reuse, forced URL refresh, short/long rate-limit waits and immediate challenge pause.
- New durability cases verify restart resume without replaying completed notes/chunks, note-write intent recovery, prevention of provider POST when checkpoint persistence fails, explicit approval of uncertain paid requests, and reuse of decoded audio after an approved retry.
- TypeScript passes. Official ESLint rules run with `--max-warnings 0`: no errors or warnings. Brand/acronym spelling is configured, not suppressed.
- Linux/Windows CI and published artifacts must be verified against the final commit before release publication. See the repository Actions page for the final result.

## Current settings checks (3.1.2)

- Real Obsidian controls rendered 37 rows across the main page and two declared sub-pages; exactly one password field was visible for the selected provider. Save and apply was present. This checks host control rendering, not a full visual/navigation acceptance of every page.
- Regression tests cover changed recognition settings on resume (including restart), explicit save, persistence failure rollback, missing provider key validation, sub-page organization and provider-specific visibility.
- No real recognition service was called and no user settings or notes were modified.

## Previous real Obsidian host checks (3.1.0)

The release implementation was loaded as a temporary in-memory diagnostic plugin inside the user's macOS Obsidian. It did not replace the installed plugin or edit user notes/settings.

- New settings definitions rendered **35 real Obsidian Setting rows** successfully. The prior attempt to call an unattached settings tab's display directly produced no rows; the row-render check used the actual host Setting API instead.
- YouTube LHK4FRpc0eQ: **232 English caption segments**, 3 initial network requests, about **4.86 seconds**. Repeating metadata lookup through another Platforms instance sharing the same session produced **zero additional requests**.
- YouTube eUPPQVdPIbw: no platform captions, duration **848 seconds**. Full audio download and real Web Audio decoding reached **three mocked provider submissions**, 25 platform/media requests, about **18.90 seconds**. This verifies extraction/decoding coverage, not real speech-recognition content; **no Groq/OpenAI request was sent**.
- These results followed the user's proxy-node change. Earlier anonymous requests through another node were challenged. The plugin does not promise all nodes or videos remain accessible.
- Current installed 3.0.6 Bilibili settings contain **no saved Cookie**. Account check reports signed out; signed subtitle queries explicitly report login required. An alternate subtitle host could not be reached. The old session file is no longer present. Current signed-in acceptance therefore requires the user to sign in again; no credential was fabricated or copied from a different account.
- Earlier authenticated Bilibili validation and one authorized real Groq run remain historical evidence in ACCEPTANCE-HISTORY.md. They were not rerun or billed in this round. Windows/Linux desktop UI and a real OpenAI paid request were not exercised.

## Submission readiness and limits

- Source/bundle/license review: completed within the scope in REVIEW.md, with provenance limitations disclosed.
- Fresh settings and legacy migration: automated fixtures pass. A new physical vault installation remains a user acceptance step; the personal vault has not been overwritten.
- Accounts: QR/login parsing, cancellation, session expiry and account UI have fixture coverage. The user’s latest 3.1.1 screenshot shows Signed in; a fresh live subtitle import was not rerun for 3.1.2.
- Community review/approval: not yet performed. No source comparison or test suite guarantees eligibility or universal platform access.

The release can be reviewed as a submission candidate. The remaining live checks above must not be represented as completed.
