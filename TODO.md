# TODO / Backlog

Deferred work, captured here so it isn't lost or re-derived from scratch later. Not
started unless a status line says otherwise.

## Chunk 5.5 — Permanent test infrastructure for the platform layer

**Status:** not started. Everything below is a plan, not a report — nothing in this
section has been implemented yet. `npm run dev` / `npm run build` are the only commands
that currently work; there is no `npm run test:platform` yet.

**Why:** Chunks 3–5 (save layer, audio layer, responsive layout, input actions) were each
verified with one-off Playwright scripts written in the scratchpad, run once, then
deleted — real bugs were caught this way (e.g. `Settings`' backdrop never actually being
interactive, `Game`'s gear button rendering through the wrong camera), but none of those
checks persist in the repo. The next change to `src/platform`, `src/save`, `src/audio`, or
`src/ui` has no safety net and could silently reintroduce any of them. This chunk turns
the best of those throwaway scripts into a permanent, repeatable suite.

### 1. Install and configure

- Add `@playwright/test` as a devDependency.
- `playwright.config.ts`: `webServer` runs `npm run dev` (port 8080, `reuseExistingServer:
  true` so a dev server already running locally isn't killed/restarted), single project
  `chromium`, headless.

### 2. `tests/platform/*.spec.ts`

Port over scenarios **already exercised manually in this project's history** — do not
invent new coverage beyond what's listed:

- **`lifecycle.spec.ts`** — `firstFrameReady()` fires before `gameReady()` in console
  output (see CLAUDE.md "YouTube Playables Wrapper" for why order matters and how the
  wrapper queues `gameReady()` if it's requested first); no page errors on startup.
- **`save.spec.ts`** — save → reload → load round-trips the same state; empty string /
  corrupt JSON / unrecognized schema version each fall back to `DEFAULT_SAVE_STATE`
  without throwing (see CLAUDE.md "Save Layer" / `migrate.ts`); rapid mutations coalesce
  under the debounce (one write, not N); `store.flush()` writes immediately, bypassing the
  debounce.
- **`pause.spec.ts`** — pause hierarchy: open `Settings`, emit a simulated `yt-pause`,
  close `Settings` → opener stays paused (deferred-resume path, see CLAUDE.md "Audio
  Layer" / `isPlatformPaused()`) → emit `yt-resume` → opener resumes; music continues from
  the seek position it was at when paused, not from `0` (`pausedMusicSeek`).
- **`audio.spec.ts`** — a platform-level mute silences audio regardless of the user's
  sound/music flags, and does **not** get written to the save (`AUDIO_ENABLED_CHANGE`
  never calls `store.mutate()` — see CLAUDE.md "Audio Layer"); user-toggled sound/music
  flags do persist across a reload.
- **`layout.spec.ts`** — the 390×844 / 844×390 / 1280×720 triad on every scene: `Settings`'
  backdrop's visual size *and* input hit area both equal the current viewport after
  resize (not just at creation — see CLAUDE.md "Responsive Layout" gotchas #1/#2); all
  interactive elements keep a ≥44px hit area at every size; `Game`'s world camera zoom and
  center match `min(width/960, height/540)` / logical center at each size.
- **`input.spec.ts`** — restart a scene 3× then press its bound key once: exactly one
  `keydown-ESC` listener on `scene.input.keyboard` (not accumulated), callback fires
  exactly once. Real hit-test regression: compute the gear button's actual screen position
  via `getBounds()` + the canvas's `getBoundingClientRect()`, `mouse.click()` there and
  confirm it registers, plus a negative control (clicking screen-center, where the gear
  rendered under the pre-fix two-camera bug, must **not** trigger the action).

### 3. Shared helpers

Pull the patterns already discovered into `tests/helpers.ts` rather than repeating them
per spec file:

- Dynamic `import()` of an app module (e.g. `audio.ts`) from a test resolves to a
  *different* module instance than the one `main.ts` statically imports — call that
  instance's own `init(window.__game)` explicitly, or its calls silently no-op (see
  CLAUDE.md "Audio Layer" Vite dev-server gotcha).
- WebAudio's `mute`/`volume` are `AudioParam` automation — wait ~100–300ms after setting
  before asserting on the read-back value, or headless Chromium can return the stale one.

### 4. Wiring

- `package.json`: `"test:platform": "playwright test"`.
- CLAUDE.md: add a rule that changes under `src/platform`, `src/save`, `src/audio`, or
  `src/ui` require a `npm run test:platform` run before committing.

### 5. Explicitly out of scope for this chunk

- No CI config (GitHub Actions, etc.) — local-only for now.
- No visual/screenshot regression tests.
- No gameplay tests — `Game` has no real gameplay content yet (see CLAUDE.md "Responsive
  Layout" world/UI camera contract), nothing to test there beyond what `layout.spec.ts`
  and `input.spec.ts` already cover for its gear button.

### Acceptance criteria

- `npm run test:platform` — all green, stable across 3 consecutive runs (no flakiness).
- `npm run build` stays clean.
