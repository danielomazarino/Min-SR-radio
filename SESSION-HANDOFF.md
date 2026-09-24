# Min Radio — Fresh Chat Handoff (2026-09-24)

## Roles and fresh chats
- Start a new **Min Radio Tech Lead** chat for evidence gathering, API/source discovery, prioritization, test strategy, review, and user-facing status. Instructions: `.github/agents/min-radio-tech-lead.agent.md`.
- Start a new **Min Radio Coding Assistant** chat for one bounded implementation assigned by the lead/user. Instructions: `.github/agents/min-radio-coding-assistant.agent.md`.
- Either chat can start with `.github/prompts/min-radio-new-session.prompt.md` (`/Min Radio — Start Fresh Session`). Ask for a plain-English status first if not ready to implement.
- Repository rules and current queue: `README.md`, `ENHANCEMENTS.md`, `/memories/repo/discovery-rule.md`.
- This handoff is concise context only. Re-check Git/Actions/live assets and latest user evidence on return.

## Repository/deployment baseline before handoff commit
- Static vanilla JS/CSS/HTML PWA; GitHub Pages publishes `main` repository root (`/`), no backend.
- `main` and `origin/main` were both at `8f577b6` (`Fix episode seek and metadata repaint`). Working tree contained only a modified `ENHANCEMENTS.md` before the handoff files were created.
- Pages workflow 35934340021 succeeded for `8f577b6`; reported live assets: `app.40d8364e.js`, `styles.d80070f9.css`, SW cache `minradio-1021477e`.
- `8f577b6` added episode seek pointer handling, repaint/stale-state fixes for archived episode track metadata, tests and a tracked-root Pages build. User confirmed the podcast slider works on iPhone.
- Docs changed in this handoff contain new product-owner reports and correction of stale enhancement statuses. No runtime app code should change as part of the current request.

## Current evidence / open work (see ENHANCEMENTS.md for detail)
1. **Live player channel mismatch:** after P1→P2, tile/controls show P2/Nottur, expanded header may still say P1/Europapodden. Seen in Safari and installed PWA after restart.
2. **Program-skip metadata:** DVR slider/position moves to another program but old song and program title remain visible.
3. **P2 song metadata:** current artist/song absent in a user observation; a direct `rightnow` sample returned `song: null` at one instant. Do not infer it is always missing from SR; timestamp repeated API response against visible UI.
4. **Podcast track artwork:** track view intentionally has no iTunes image lookup; investigate track metadata→iTunes matching, preserve program-art fallback, test stale lookup guards. Verify live artwork across P2 and other channels too.
5. **P2 Musik fallback:** reported FLAC did not fall back to AAC 320 on corporate Wi-Fi with inadequate bandwidth. Not yet reproduced; verify platform candidate ladder, playback stall signals and intended adaptation policy.
6. **Tunnel buffering:** secondhand report: Min Radio stopped before train exited a long tunnel while SR’s official iOS app continued. No instrumentation; compare same device/channel/network before changing buffer/transport policy.
7. **Lock screen regression:** playback continuing when lock screen opens is expected. The user now reports tapping lock-screen player opens another installed PWA again; this was previously thought fixed but is OPEN regression. Reproduce and identify active MediaSession owner/build before changing code.
8. **Device verification:** iPhone confirms podcast seek; Android not tested. Actual episode audio time across track boundaries remains distinct from pointer UI success.

## Next engineering rule
Do not tackle all issues together. For each: first state a hypothesis, identify the smallest evidence-gathering test, then assign a bounded fix with acceptance tests. Keep unrelated current task paused. No deployment/commit unless explicitly requested.

## Handoff change status
This file and `.github/agents/*`, `.github/prompts/*`, and the latest `ENHANCEMENTS.md` edits are part of the pending handoff commit. Confirm the final commit/push with `git status -sb` and remote log after committing.
