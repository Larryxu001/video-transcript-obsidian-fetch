# Release review — 3.1.2

## Scope and provenance

Reviewed the new source, tests, bundling, dependency lock and previous 2.0.1 implementation for functional parity and source overlap. No legacy modules are imported, bundled or published. The new domain model, rendering, transport, parsing and recognition code are separate implementations. This is not a clean-room certification: the implementer read and ran legacy source during debugging.

A token-sequence comparison against every legacy TypeScript module found the longest contiguous matches in public User-Agent/protocol strings (52–53 tokens). Other inspected matches were ordinary API syntax, standard PCM conversion or public iframe URL templates. No inherited implementation block was identified in this review. This check is limited to the inspected local legacy source and cannot prove originality, license clearance or eligibility under the directory's fork policy. The implementation history is disclosed in PROVENANCE.md; the directory reviewer remains the authority on acceptance.

The only bundled third-party runtime library is MIT-licensed qrcode-generator 2.0.4. Its notice is preserved in the bundle banner and release assets. Obsidian is external; build/test tools are development dependencies. The original repository and its notices remain intact.

## Correctness and security review

- Only HTTPS addresses on intended platform domains are accepted for returned captions/media. Network destination checks reject credentials, unexpected ports and lookalike suffixes.
- Bilibili credentials are restricted to intended API/page hosts. No browser session extraction or system executables ship.
- Network responses are rendered as text or escaped Markdown. There is no remote script execution, eval or remote dependency update.
- Recognition uses transcription endpoints only. Keys are neither logged nor placed in recovery snapshots separate from settings.
- Queue metadata is serialized before note/paid-request side effects. Recovery compares target content before replaying a note write and stops on conflict. Completed recognition is persisted before proceeding.
- A pending paid request without a saved result requires explicit user retry approval. Cancellation and process loss cannot guarantee provider-side cancellation; documentation states this limitation.
- Audio bytes remain in bounded memory. Recovery text remains within the plugin data file and is documented because it may be synced with the vault.
- Cancellation prevents queued work, rendering and further writes. Network helpers remove timers/listeners; QR polling and account checks stop when their UI closes.
- Lint rules remain enabled. Brand/acronym casing is configured explicitly, rather than suppressing the sentence-case rule. Settings use the official declarative/searchable API.

## Publication boundary

Release preparation is complete only after tests, lint, build and published CI pass. Real macOS evidence and remaining platform/environment limits are listed in ACCEPTANCE.md. Windows CI does not constitute a Windows desktop runtime test; mobile is explicitly unsupported. No automatic installation into the personal vault or directory submission is performed by a build.

## 3.1.2 release-facing review

- Native settings groups and declarative sub-pages keep common controls visible and advanced configuration searchable. Stored preference keys and existing command IDs are retained; the development-only diagnostic command is removed.
- User-facing property labels no longer expose internal camelCase names. Technical field names remain editable only where they define actual note properties.
- Provider-specific key visibility preserves both saved keys. Explicit save validates the selected provider and restores active values if persistence fails. Saving makes no paid request.
- Internal client-attempt lists are removed from YouTube failures; actionable network/access guidance and typed challenge/rate-limit behavior remain.
- Source scan found no console logging, debugger statements, eval, innerHTML writes, personal machine paths, TODO or FIXME markers in shipped source. Test fixtures and provenance records remain in the repository; they are not bundled as product UI.
- Build/type checks, zero-warning lint and 113 tests pass locally. CI for this uncommitted candidate, clean-vault visual acceptance and directory review are still outstanding. This review is not a promise of approval or universal video availability.
