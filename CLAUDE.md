# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server (http://localhost:8080, auto-opens browser)
- `npm run build` — typecheck (`tsc`, no emit), production bundle to `dist/`, then
  `scripts/check-bundle.mjs` (size/content guard — see "Build Guards & Asset Policy")
- `npm run bundle` — `npm run build`, then `scripts/make-bundle.mjs` zips `dist/` into
  `build/<app-id>-<version>.zip` for Playables submission
- `npm run preview` — serve the built `dist/` bundle locally. **Point the Playables Test
  Suite at this, never at `npm run dev`** — see "Build Guards & Asset Policy" for why dev
  mode's load order isn't representative of the shipped artifact.
- `npm run verify:scroll` — plain-Node logic check for `src/ui/scrollMomentum.ts` (via
  `scripts/register-ts-loader.mjs`'s Node-native-TS + extensionless-import loader hook, no
  bundler/browser involved) — see "Scroll Patterns".

There is no linter or formatter configured yet; `npm run verify:scroll` is the one logic
test that exists so far, covering `src/ui/scrollMomentum.ts` only.

## Architecture

Phaser 4 game client bundled with Vite. `tsconfig.json` uses `noEmit: true` — TypeScript is only used for typechecking; Vite/esbuild does the actual transpilation. `tsconfig.json`'s `"types": ["vite/client"]` is what makes `import.meta.env.DEV` typecheck at all (`ImportMeta` has no `env` property without it) — needed for every `import.meta.env.DEV`-gated block in this codebase (see "Shop Layer" for the current example). `vite.config.ts` sets `build.target: 'es2022'` — required for the top-level `await` in `main.ts` (esbuild's default target predates it) — and `base: './'`, required because Playables does not host games at the domain root (see "Build Guards & Asset Policy" and "Known Issues Fixed").

- `src/main.ts` — entry point. Calls `initHealthMonitoring()` **first**, before anything else (see
  "Health Monitoring"), then `await waitForPlatformReady()`, `await` the save store's `init()`, `await
  initLocale()` (i18n/strings.ts — see "Localization"; must resolve before the first scene renders any
  `t()` string), then constructs `new Phaser.Game(GameConfig)`, then `bindPlatformEvents(game)`,
  `bindGameplayPause(game)`, `bindAutosave(game)`, and `initAudio(game)`. A game that also wants a custom
  display font calls `ui/font.ts`'s `initDisplayFont({ family, url })` here too, before `new
  Phaser.Game(...)` for the same reason — see "UI Kit". Also sets three dev/debug hooks (not used by game code):
  `window.__game` (lets manual testing emit `YTEvents.PAUSE`/`RESUME`/`AUDIO_ENABLED_CHANGE` on
  `game.events` without a real `ytgame` SDK), `window.__getRecentErrors` (health.ts's ring buffer), and
  `window.__adGate` (adGate.ts's `showInterstitial`/`showRewarded`, bound to this page's real `game` and
  `yt.ts` state) — the latter two exist specifically because a raw dynamic `import()` from a test script
  gets its own disconnected module instance (see "Audio Layer"'s dual-module-instance gotcha), so this is
  the only reliable way to reach the live one. See "YouTube Playables Wrapper", "Save Layer", and "Audio
  Layer" below.
- `src/config.ts` — the single `Phaser.Types.Core.GameConfig` object (renderer type, resolution, scale mode, arcade physics, registered scene list). Renderer is `Phaser.AUTO` (WebGL with Canvas fallback).
- `src/scenes/` — one file per `Phaser.Scene`, wired together via `this.scene.start('SceneName')`, not imports of each other:
  - `Boot` → loads only what the `Preloader` screen itself needs; on the first `Phaser.Core.Events.POST_RENDER` calls `firstFrameReady()`; then starts `Preloader`.
  - `Preloader` → shows a progress bar (on the standard `layout()` pattern — see "Responsive Layout"),
    loads all real game assets here, then starts `MainMenu`.
  - `MainMenu` → builds the UI (a "start" text bound to the `'primary'` input action, plus a gear button
    bound to `'openSettings'` — see "Input Actions" below; not a scene-wide `once('pointerdown')`
    catch-all, which would also fire when the gear button is clicked), calls `gameReady()`, then waits for
    the `'primary'` action to start `Game`.
  - `Game` → the actual gameplay scene (currently just a gear button bound to `'openSettings'`;
    `create()`/`update()` otherwise empty stubs).
  - `Settings` → overlay scene, built entirely from the `src/ui/theme.ts` widget kit
    (`roundedPanel` + `neonButton`) and `t()` strings — see "Audio Layer" below and "UI Kit" for
    the widgets themselves.
  - `Shop` → the same overlay pattern as `Settings`, demoing `src/shop/`'s coin/catalog
    mechanism. Registered in `config.ts` like any other scene, but its only entry point in this
    template (`MainMenu`'s Shop button) is DEV-gated — see "Shop Layer" below.

  New scenes must be added to the `scene: [...]` array in `src/config.ts` to be registered with Phaser.
- `src/platform/yt.ts` — YouTube Playables SDK wrapper. See "YouTube Playables Wrapper" below.
- `src/platform/input.ts` — abstract input-action mapping (mouse/touch/keyboard → one callback per action).
  See "Input Actions" below.
- `src/platform/lifecycle.ts` — `bindGameplayPause(game)` freezes/unfreezes gameplay scenes on
  `YTEvents.PAUSE`/`RESUME`, arbitrating with `Settings`'/`Shop`'s own pause ownership. See "YouTube
  Playables Wrapper" below.
- `src/platform/health.ts` — global error capture with dedup and a ring buffer. See "Health Monitoring"
  below.
- `src/platform/adGate.ts` — the only allowed entry point for showing ads. See "Ad Gate" below.
- `src/ui/` — a themeable, palette-driven widget kit (buttons, rows, badges, panels, layout
  helpers, image previews, font loading). See "UI Kit" below. `scrollRegion.ts`/
  `scrollMomentum.ts` are a separate, self-contained pair for building a scrollable
  list/strip — see "Scroll Patterns" below.
- `src/i18n/` — the `t()`/`getLocale()` localization framework (generic keys only — a game adds
  its own strings on top). See "Localization" below.
- `src/shop/` — the coin-balance + catalog mechanism behind the `Shop` scene (no real product
  data — a game supplies its own catalog). See "Shop Layer" below.
- `public/assets/` — static game assets (images, audio, tilemaps), served at `/assets/...` and referenced via `this.load.setPath('assets')` in `Preloader`.
- `index.html` — loads the Playables SDK via a parser-blocking `<script src="https://www.youtube.com/game_api/v1">` tag, before the `type="module"` entry script, per certification requirements. That SDK `<script>` lives in `<head>`, not `<body>` — see "Build Guards & Asset Policy" for why the source file's body placement doesn't survive `vite build`. This file's `<script type="module" src="/src/main.ts">` is what dev mode actually serves; the production build rewrites it entirely (see `vite.config.ts`'s `inlineModuleLoader` plugin, also in "Build Guards & Asset Policy").

## Phaser 4 Skills

Official Phaser 4 skills are in `.claude/skills/` (28 skills covering every subsystem, pulled from
the `skills` folder of the [phaserjs/phaser](https://github.com/phaserjs/phaser) repo). Claude Code
auto-discovers them each session and should consult the relevant one before writing Phaser code —
no manual setup needed. To force a specific one, invoke it like a slash command, e.g.
`/scenes how do I pause the Game scene?` or `/audio-and-sound add background music to MainMenu`.

Key ones for this project: `scale-and-responsive` (portrait/landscape UI),
`input-keyboard-mouse-touch` (PC+mobile controls), `audio-and-sound`,
`scenes`, `loading-assets`, `v4-new-features`.

All 28: `actions-and-utilities`, `animations`, `audio-and-sound`, `cameras`, `curves-and-paths`,
`data-manager`, `events-system`, `filters-and-postfx`, `game-object-components`,
`game-setup-and-config`, `geometry-and-math`, `graphics-and-shapes`, `groups-and-containers`,
`input-keyboard-mouse-touch`, `loading-assets`, `particles`, `physics-arcade`, `physics-matter`,
`render-textures`, `scale-and-responsive`, `scenes`, `sprites-and-images`, `text-and-bitmaptext`,
`tilemaps`, `time-and-timers`, `tweens`, `v3-to-v4-migration`, `v4-new-features`.

To refresh from upstream: `git clone --depth 1 --filter=blob:none --sparse
https://github.com/phaserjs/phaser.git /tmp/phaser-skills && git -C /tmp/phaser-skills
sparse-checkout set skills && cp -r /tmp/phaser-skills/skills/* .claude/skills/`

See PLAYABLES-SDK.md for the full YouTube Playables SDK reference — consult it for all ytgame integration work.

## YouTube Playables Wrapper

`src/platform/yt.ts` is the only module allowed to touch the `ytgame` global — everything else
(scenes, future save/audio/ads code) imports primitives from it. Key behavior:

- `firstFrameReady()` (called from `Boot`) and `gameReady()` (called from `MainMenu.create()`) enforce
  their required call order internally: if `gameReady()` fires first (happens whenever `Preloader` has
  no real assets to load, since the whole Boot→Preloader→MainMenu chain then runs synchronously in one
  tick, before the first `POST_RENDER`), it's queued and only actually sent once `firstFrameReady()` has
  fired. Don't "fix" an apparent bad log order here without checking this queuing logic first.
- `waitForPlatformReady()` in `main.ts` (before `new Phaser.Game(...)`) races the SDK's readiness against
  a `2500ms` timeout, falling back to non-Playables mode with a `console.warn` instead of hanging forever.
  This only guards *after* JS starts running — if the SDK `<script>` tag in `index.html` (a parser-blocking
  classic script, required by the certification docs) stalls on the network before that, no JS-side
  timeout can help; this is a known, accepted limitation shared by the official
  `phaserjs/template-youtube-playables` reference, not something introduced here.

- **`isPlatformPaused()` means "some source in the platform-pause *class* is currently active," not
  specifically "YouTube itself paused the game."** It reflects whether `YTEvents.PAUSE` has fired without a
  matching `YTEvents.RESUME` yet, tracked by listening on `game.events` itself inside `bindPlatformEvents()`
  (registered unconditionally, even with no real SDK) rather than inside the raw `sdk.system.onPause`
  callback — so it stays correct under manually-emitted test events too. `adGate.ts` deliberately emits the
  same `YTEvents.PAUSE`/`RESUME` for ad display (see "Ad Gate"), so **while an ad is showing,
  `isPlatformPaused()` reads `true` too** — any code that reads this flag and assumes it means
  specifically "backgrounded in YouTube" will be misled during an ad. Used by `Settings.close()` (see
  "Audio Layer") to avoid resuming a scene out from under an active pause of either kind — which happens
  to be exactly the right behavior if Settings is somehow closed mid-ad (its resume correctly defers to
  the ad's own `RESUME`), but that correctness is incidental to `Settings.close()` predating `adGate.ts`,
  not something it was written to account for. Any *new* code with the same "is something else holding a
  pause on us" question should use this flag the same way; code that specifically needs to know "did
  YouTube itself pause us" (as opposed to an ad) doesn't have a way to ask that today.
- **`YTEvents.PAUSE`/`RESUME` actually freeze/unfreeze gameplay**, via `src/platform/lifecycle.ts`'s
  `bindGameplayPause(game)`. **Overlay-exclusion design, not a gameplay whitelist**: on `PAUSE`, it pauses
  *every currently active scene* (`game.scene.getScenes(true)`) except the ones listed in
  `OVERLAY_SCENES` (`'Settings'` and `'Shop'`) — not "pause `MainMenu`/`Game` specifically." This was
  originally a whitelist of exactly those two scene keys; inverted before the template freeze so a new
  gameplay scene added later is frozen by default without anyone needing to remember to register it —
  only new *overlay* scenes (menus/dialogs meant to stay interactive during a pause) need to be added to
  the exclusion list. A scene already paused because an overlay is open over it isn't in
  `getScenes(true)`'s result, so the loop correctly no-ops on it (nothing to do, already frozen). On
  `RESUME`, `scene.resume()` on whatever it paused, *unless* any `OVERLAY_SCENES` member is currently
  active, in which case that overlay's own `close()` owns the resume instead (its own
  `isPlatformPaused()` check already handles that correctly — untouched by this module; this check reads
  the `OVERLAY_SCENES` set itself, not one hardcoded scene key, so `Shop` needed no separate carve-out
  here beyond joining the set). Every `OVERLAY_SCENES` member is deliberately never paused this way: its
  Close button must stay clickable during a platform pause for that same deferred-resume path to ever
  run. Before this existed, `audio.ts` muted sound and `store.ts` flushed the save on `PAUSE`, but nothing
  ever called `scene.pause()` — `Game`'s `update()` loop kept running underneath a "paused" game the
  whole time. See "Known Issues Fixed".
- `sendScore(value)` rounds to the nearest integer before sending — the SDK rejects non-integer scores,
  and gameplay code (combo multipliers, etc.) can easily produce a float.
- **Localization**: `getLanguage()` feeds `i18n/strings.ts`'s `initLocale()` (called from `main.ts`,
  before `new Phaser.Game(...)`) — see "Localization" below. `index.html` is still `<html lang="en">`
  (a static attribute, unrelated to in-game `t()` string resolution) and `MainMenu`'s own start text is
  still a hardcoded English literal, not yet ported to `t()` — the localization *framework* is template
  scaffolding, wiring actual scene strings through it is a per-game task.

**Known testing gap:** verification so far is dev-mode only (Playwright against `npm run dev`, where
`ytgame` is either absent or loaded with `IN_PLAYABLES_ENV: false` — i.e. wrapper stub paths only). The
real Playables call ordering (signed-in/signed-out saves, ad flows, audio mute) is unverified. Run the
official Test Suite (https://developers.google.com/youtube/gaming/playables/test_suite, pointed at
`npm run dev`'s `http://localhost:8080`) right after the save/audio chunks land — not at the end — since
that's where signed-in/signed-out and mute-state edge cases are most likely to surface.

## Health Monitoring

`src/platform/health.ts`'s `initHealthMonitoring()` (called once from `main.ts`, **before**
`new Phaser.Game(...)` — so a synchronous throw during game construction itself is still caught) wires
`window.onerror`/`onunhandledrejection` into a local recorder:

- **Dedup by signature** (`message` + first stack *frame*, not literally the first line of `.stack` — for
  a standard V8 `Error`, that first line is just `"${name}: ${message}"`, which duplicates `message` and
  would give the signature no more discriminating power than `message` alone; the first real `"at ..."`
  frame is what actually distinguishes two errors that share a message but were thrown from different call
  sites). Each unique signature calls `logError()` **once per session**, not once per occurrence — the
  platform's health API is rate-limited, and a cascade of the same error firing every frame (e.g. from
  inside a scene's `update()`) must not burn through that budget reporting the same bug dozens of times.
- **Local ring buffer** of the last 20 errors (`getRecentErrors()`, read-only snapshot) for the dev console
  and future tests. Nothing here is ever sent anywhere except the single `logError()` ping per unique
  signature — Playables is an offline-only environment (its CSP blocks external network calls), so there's
  nowhere to send a detailed error payload even if this module wanted to.

## Ad Gate

**Rule: game code calls only `src/platform/adGate.ts`'s `showInterstitial(game)` /
`showRewarded(game, rewardId)` — never `yt.ts`'s `requestInterstitialAd()`/`requestRewardedAd()` directly.**
`adGate.ts` pauses gameplay for the ad's duration by emitting the *same* `YTEvents.PAUSE`/`RESUME` that a
real platform pause uses, rather than pausing scenes/muting audio/flushing the save itself — those already
happen via `lifecycle.ts`, `audio.ts`, and `store.ts`'s existing listeners on that channel, so calling
`requestInterstitialAd()` directly would show an ad with the game still fully running underneath it.

- The `RESUME` emit happens in a `finally`, so it runs regardless of whether the ad request
  resolved, rejected, or the SDK call threw — gameplay never stays stuck paused because an ad
  failed. `showRewarded()` returns the SDK's boolean (reward earned or not) unmodified; `adGate`
  only wraps the pause/resume lifecycle around the call, it never inspects the result.
- **Arbitration with a real platform pause arriving mid-ad** doesn't work the same way as
  `Settings.close()`'s `isPlatformPaused()` check, and deliberately isn't implemented that way:
  `adGate`'s own `PAUSE` emit right before requesting the ad already makes `isPlatformPaused()` read
  `true`, so checking it again in `finally` would *always* be true regardless of whether anything real
  happened, and gameplay would never resume after an ad. Instead, `adGate` snapshots
  `isPlatformPaused()` *before* its own emit (catches the ad being requested while already
  platform-paused) and separately watches for any *additional* `PAUSE` after its own (registered only
  after its emit completes, so it can't catch its own) — that can only be the real SDK relay from
  `bindPlatformEvents()`. If either is true when the ad settles, `adGate` skips its own `RESUME`: the
  platform is still genuinely suspended, and the eventual real `RESUME` will unfreeze things correctly
  via the same listeners everything else already uses. See the `isPlatformPaused()` bullet in "YouTube
  Playables Wrapper" for the broader consequence of sharing this channel: while an ad is showing, that
  flag reads `true` for *any* code checking it, not just `adGate`'s own logic.
- **The "extra PAUSE" listener is always unsubscribed** (`game.events.off(YTEvents.PAUSE, onExtraPause)`,
  unconditionally, first thing in `finally`, before the resume decision) — verified with 10 consecutive
  `showInterstitial()` calls leaving `game.events.listenerCount(YTEvents.PAUSE)` unchanged. Skipping this
  would leak one listener per ad shown, the same class of bug the `keydown-*` listener leak in
  `src/platform/input.ts` would have been without `bindAction`'s `SHUTDOWN`/`DESTROY` cleanup (see "Input
  Actions") — anything that does `game.events.on(...)` for a *temporary* purpose has to explicitly
  `.off()` it somewhere, since nothing does that automatically.

## Responsive Layout

The game uses `Phaser.Scale.RESIZE` (`src/config.ts`) so the canvas always fills its parent 1:1 at
whatever size the browser window is — from 9:16 portrait to 16:9 landscape and everything between —
instead of letterboxing the whole page to a fixed aspect ratio.

- **Rule: a new UI object's position is set in `layout()`, never via `setPosition`/coordinates in
  `create()`.** Any scene with on-screen UI creates its game objects once in `create()` (position
  doesn't matter yet — `add.text(0, 0, ...)`, not a real coordinate) and defines a
  `layout(width: number, height: number): void` method that does *all* positioning, sizing, and
  hit-area recalculation via `src/ui/anchors.ts` helpers (`anchorTopLeft`/`TopCenter`/`TopRight`/
  `CenterLeft`/`Center`/`CenterRight`/`BottomLeft`/`BottomCenter`/`BottomRight`). Each anchor helper
  reads the object's *current* viewport off `obj.scene.scale` itself, so `anchorTopRight(gearButton,
  20, 20)` stays correct after any resize without the caller re-deriving width/height. `MainMenu`,
  `Game`, and `Settings` all follow this pattern. **Why this matters more than it looks**: a
  positioning bug confined to `layout()` is invisible until the *next* resize/orientation change —
  it won't show up on first load if `create()` happened to leave things in a plausible spot. Two bugs
  of exactly this shape were caught only by testing an actual resize, not just initial render (below).
- `src/ui/layout.ts`'s `bindLayout(scene, layout)` calls `layout()` once immediately (using the
  scene's current scale) and again on every `Phaser.Scale.Events.RESIZE`, unbinding on scene
  `SHUTDOWN`/`DESTROY` so a stopped scene doesn't keep reacting.
- A full-bleed element (e.g. `Settings`'s dimming backdrop) isn't "anchored" in the corner/center
  sense — it's sized directly from `layout()`'s `width`/`height` params (`setSize(width, height)`),
  since it's meant to track the viewport exactly, not sit at a fixed offset from an edge.
- **Gotcha #1: `setInteractive()` on a 0x0 object silently creates no `.input` at all.** Phaser's
  default hit-area derivation (`setHitAreaFromTexture`) reads the object's current `width`/`height` and
  explicitly skips creating `.input` if either is `0` — so `rect(0,0,0,0).setInteractive()` (as `Settings`'s
  backdrop was, before `layout()` gives it a real size) leaves `.input === null`, not an `.input` with a
  zero-size hit area. `Settings` doesn't call `setInteractive()` on the backdrop in `create()` at all;
  `layout()` calls it there for the first time, once `setSize(width, height)` has already run.
- **Gotcha #2: resizing an already-interactive object does not resize its hit area.** Per Phaser's own
  `GameObject.setInteractive()` docs, calling `setInteractive()` again on an object that already has
  `.input` just re-enables it — it does **not** recompute the hit area from the object's new size.
  `setSize()`/`setFontSize()` on an already-interactive object silently leaves clicks testing against the
  *old* geometry. Fix: mutate `obj.input.hitArea` (a `Phaser.Geom.Rectangle` by default) directly via
  `.setTo(x, y, w, h)` inside `layout()`. Put together, both gotchas mean every interactive, resizable
  object's `layout()` needs an `if (!obj.input) { obj.setInteractive(...) } else { hitArea.setTo(...) }`
  branch — `Settings.layout()` does this inline for the backdrop, and `src/ui/uiScale.ts`'s
  `ensureMinHitArea()` does it for buttons/toggles (see below), which never hit gotcha #1 since text
  objects have nonzero size from the moment they're created.
- **Narrow-screen UI scale**: `src/ui/uiScale.ts`'s `uiScale(width)` returns a multiplier — `1` at/above
  a 400px-wide reference, floored at `0.8` below it — applied to font sizes (`setFontSize(BASE * uiScale(width))`)
  so text/buttons shrink gracefully instead of overflowing a narrow portrait screen, but never collapse
  below a readable floor. `ensureMinHitArea(obj, minSize = 44)` then pads that (possibly shrunk) object's
  hit area back out to at least 44 CSS px square, centered on its bounds — the visible glyph can be
  smaller than 44px, but the tap target never is. Call it every `layout()`, not just once — it internally
  branches on whether `.input` exists yet (create vs. resize) to work around the hit-area gotcha above.
- **Game field vs. UI — two-camera split.** `Game` renders both a fixed-logical-resolution game world
  and screen-space UI (currently just the gear button) in the same scene, which need opposite behavior
  under resize: UI must ignore zoom/pan, world content must not. `Game` splits this across two cameras:
  `cameras.main` is zoomed/`centerOn`-ed on a fixed logical resolution (`LOGICAL_WIDTH x LOGICAL_HEIGHT`,
  currently `960x540` — a placeholder until real gameplay picks a real value) every `layout()`, using
  `zoom = min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT)` so the whole logical area always fits
  without cropping (letterboxed on whichever axis has slack). A second `uiCamera` (`this.cameras.add(...)`,
  resized to the full viewport every `layout()`, zoom always `1`) renders UI at an identity screen-pixel
  mapping regardless of what the world camera is doing. `cameras.main.ignore(gearButton)` (set once, in
  `create()`) keeps the world camera from also drawing the UI at the wrong zoom/position. **Contract for
  future gameplay**: game objects live in logical coordinates (`0..LOGICAL_WIDTH`, `0..LOGICAL_HEIGHT`) —
  screen/pixel coordinates are never valid for them. Any new UI/HUD object must be added to `uiCamera`'s
  default render set and excluded from `cameras.main` (mirror the `ignore()` call above); any new world
  object is the reverse — left on `cameras.main` and excluded from `uiCamera` once `uiCamera` stops being
  empty of world content. `Game.layout()`'s zoom/`centerOn` block is currently unexercised (no real
  gameplay content yet) but is the required scaffold for whenever that content is added — don't recompute
  this from scratch, and don't skip it because the scene "looks empty."
- `Boot` is not on this pattern — it has no visual content. `Preloader` **is** on it (fixed
  after initially shipping without it — a fixed 468px-wide bar overflowed a 390px viewport,
  the one scene a certification reviewer is guaranteed to see): `layout()` clamps the bar to
  `min(468, width - 80)` so it never touches the screen edges, called from `bindLayout()`
  inside `init()` rather than `create()` — `preload()`'s `'progress'` events fire between
  `init()` and `create()`, so the bar has to exist and already be laid out before that, not
  after. The fill bar uses origin `(0, 0.5)` (not the default `0.5, 0.5`) so growing its
  `.width` extends rightward from a fixed left edge instead of symmetrically from a center
  point — the pre-fix version had the same fixed-position "grow from center" issue.

## UI Kit

`src/ui/theme.ts` is a themeable, palette-driven widget kit shared by every scene — buttons, rows,
badges, panels, progress bars, and full-bleed backgrounds all built from one visual language (a dark
fill, a crisp colored stroke, and — where noted — two wider/fainter strokes standing in for a glow, no
shader/Bloom postFX pass, so it works identically under the Canvas fallback). `Settings.ts` is the
reference consumer — read it alongside this section for the intended call pattern.

- **Theming**: `getTheme()`/`setTheme(overrides)` hold one module-level `ThemeConfig` — `colors: {
  primary, secondary, accent, backgroundTop, backgroundBottom, surface }` plus a canonical `radius`.
  `DEFAULT_THEME` ships with a usable neon palette so the template looks intentional out of the box, but
  nothing in `theme.ts` hardcodes those hex values into a function body — every factory either takes
  `color` as a required/optional param or falls back to a `getTheme().colors.*` read at *creation* time
  (not reactively — a widget already on screen won't retint if the theme changes later). A new game
  reskins the whole kit with one `setTheme({ colors: { primary: 0x..., ... } })` call, ideally in
  `main.ts` before any scene creates its first widget. `accent` is a convention, not an enforced rule:
  it's the palette slot meant for reward/currency iconography (`valueBadge()` defaults to it) — reusing
  it for plain UI chrome makes "does this color mean something" ambiguous everywhere else it's used.
- **Widgets** (`src/ui/theme.ts`): `neonButton(scene, text, color, fontSize?, options?)` — the base
  button, auto-sized to its label (read `.width`/`.height` off the returned `NeonButton` for the
  current solid-core footprint, e.g. to size a backdrop panel around it — these track any later
  `setText()`/`setFontSize()`/`setMinWidth()` call, they're not a one-time snapshot).
  `NeonButtonOptions.muted`/`.hoverColor` cover a secondary/de-emphasized variant and a "brightens on
  engage" variant respectively; `.noGlow` keeps the border at full alpha but drops just the glow halo
  (for sitting flush in a shared-height row next to non-glowing neighbors, where `muted`'s dimmer
  border would look wrong); `.gradientFill` (`{ top, bottom }`) swaps the usual flat-fill-plus-stroke
  for a top-to-bottom color fill plus a thin white rim, for the one loudest CTA on a screen that should
  read as filled/solid rather than outlined; `.textShadow` adds a drop-shadow behind the label, mainly
  useful paired with `.gradientFill` (a busy gradient can wash out a plain white label); `.fontFamily`
  overrides the label font (defaults to plain Arial like every other widget here) for a button that
  should use the game's own display font (`ui/font.ts`). `setMinWidth(width)` grows the button's core
  box past its own label-driven auto-size (never shrinks below it) — for a button that must visibly
  read as wider than some other element measured only at `layout()` time. `rowButton(scene, leftLabel, resultLabel,
  accentLabel, columns, initialColor, fontSize?)` — a full-width tappable row (list/settings-row shape),
  its three text columns positioned as **fractions of the row's own width** (`RowColumns`, a 4-tuple —
  column 2 is reserved, unrendered, for a caller's own object) so every row built from the same columns
  array lines up regardless of content length. `pillBadge(scene, icon, earned, max, color, fontSize?,
  suffix?)` — a compact `[icon current/max]` stat chip. `valueBadge(scene, icon, value, color?,
  fontSize?)` — a simpler `[icon value]` readout (a generalization of a "stars/currency total" badge —
  no earned/max distinction), defaults to `getTheme().colors.accent`. `roundedPanel(scene)` /
  `neonProgressBar(scene)` — stateless drawing helpers (`.draw(x, y, w, h, ...)` every call, no owned
  position) for modal panels and thin progress bars. `circleBackButton(scene, color?, size?)` — the
  circular back affordance; its `'←'` glyph carries a small measured offset
  (`ARROW_OFFSET_X/Y_FRACTION`) to correct for the glyph's own ink not being centered in its font
  metrics box — re-derive this by pixel-mass centroid, not by eye, if it's ever revisited.
  `neonText(scene, text, color, fontSize, originX?, originY?)` — a glow-halo header/title text (uses
  `ui/font.ts`'s `getDisplayFontStack()`) with a one-shot `.pulse()`. `createSceneBackground(scene,
  textureKey, gradientTop?, gradientBottom?, tint?)` — texture-if-loaded-else-gradient full-bleed
  background, "cover" fit. `scanlineOverlay(scene)` — an optional static (not shader) CRT-scanline
  texture tile; skip it entirely for a non-retro aesthetic. `toCssColor(color)` — `0xRRGGBB` ->
  `'#rrggbb'`, for `Text` styles.
- **The recurring Container-hit-area gotcha**: every interactive widget above (`neonButton`, `rowButton`,
  `circleBackButton`) hits the same non-obvious Phaser fact and fixes it the same way — `Container`'s
  `originX/Y` are hardcoded to `0.5`, so `container.setSize(w, h)` shifts `displayOriginX/Y` to `(w/2,
  h/2)`, and `pointWithinHitArea` unconditionally adds that offset to the local hit-test point before
  calling `hitAreaCallback`. A hitArea built in the natural `(-halfW..halfW)` frame therefore tests
  against a point already shifted by `(+halfW, +halfH)` — center clicks work by accident, only off-center
  taps expose it. Fix (see any of the three widgets' own `redraw()`): build the hitArea starting near
  `(0, 0)` instead of `(-halfW, -halfH)`. Any *new* interactive `Container`-based widget added to this
  file needs the same correction — it is not a one-off bug, it's a property of `Container` hit-testing
  itself.
- **Layout helpers** (`src/ui/anchors.ts`, `layout.ts`, `uiScale.ts`) are unchanged from the template's
  original responsive-layout system — see "Responsive Layout" above; the widget kit is built on top of
  them, not a replacement for them.
- **`src/ui/preview.ts`** — `makePreview(scene, imageKey, width, height, fit?)` /
  `setPreviewTexture(image, imageKey)` / `applyPreviewFit(image, width, height, fit?)`: whole-image
  contain/cover-fit preview helpers. Always pass through these (never a raw `add.image()`/`setTexture()`
  with no frame argument) for a whole-picture preview — they explicitly use Phaser's own `'__BASE'` frame
  name, which becomes load-bearing the moment a texture ever gets custom frames added to it elsewhere
  (a sprite-sheet slicer that repoints `firstFrame`, for instance) — a preview with no explicit frame
  after that silently renders a fragment, not the whole image. `'cover'` fit uses `Image.setCrop()`
  rather than a mask (this Phaser build errors on masking an `Image` directly under WebGL), with the crop
  origin always `(0, 0)` — a real Phaser rendering bug misplaces the visible region for a non-zero crop
  offset.
- **`src/ui/font.ts`** — `initDisplayFont({ family, url, weight? })` loads a font via the browser
  `FontFace` API (not a CDN `<link>`, which an offline-CSP platform like Playables would block) and makes
  `getDisplayFontStack()` return it from then on; `neonText()` reads that getter internally. **Ships with
  no font baked in** — `getDisplayFontStack()` defaults to a plain system-sans stack until a game calls
  `initDisplayFont()` with its own choice (font file under `public/assets/fonts/...`). Must be awaited
  before `new Phaser.Game(...)`, same timing reason as `initLocale()` — a Canvas/WebGL `Text` object does
  not retroactively repaint when a web font finishes loading async after it already drew with a fallback
  face.
- **`src/ui/format.ts`** / **`src/ui/fit.ts`** — trivial generic helpers with no theme/game coupling:
  `formatTime(elapsedSec)` (`"M:SS"`), `titleCase(id)` (`'retro-tech'` -> `'Retro Tech'`),
  `fitContain(sourceW, sourceH, maxW, maxH)` (largest non-distorting fit inside a box — `preview.ts`'s
  own `'contain'` branch is built on this).

## Scroll Patterns

Two small, independent modules for building a scrollable list/strip (a card grid, a settings list, a
catalog longer than one screen, ...) — neither is wired into any shipped scene today (`Shop`'s own
catalog still just stacks rows to fit, see its own section below), but both exist so a game adding
scrolling later doesn't have to rediscover the same WebGL gotcha or reinvent flick physics from
scratch.

- **RULE: never clip a scrollable region with `GameObject.setMask(geometryMask)` under this
  project's renderer.** `Phaser.AUTO` (`config.ts`) resolves to WebGL first, and `setMask()` with a
  `GeometryMask` is Canvas-renderer-only in this Phaser version — confirmed directly against
  `node_modules/phaser/src/gameobjects/components/Mask.js`'s own `setMask()`, which `console.warn`s
  and returns **without ever assigning `.mask`** under WebGL: a silent no-op, not a subtle
  degradation. The object then renders in full wherever its computed position places it, with zero
  clipping — content scrolled past its intended boundary escapes and renders on top of whatever sits
  above/below the scroll region instead of being cropped. This is a standing fact about the renderer,
  not a one-off bug — it was independently hit and fixed the same way in three separate
  scrollable/maskable UI regions across a real project built on this template (a scrolling catalog, a
  scrolling card grid, and an unrelated masked-shape spike) before being generalized into the helper
  below. `ui/preview.ts`'s own `'cover'`-fit note ("this Phaser build errors on masking an `Image`
  directly under WebGL") is the same underlying limitation showing up in a different widget.
- **`src/ui/scrollRegion.ts`'s `scrollableCameraRegion(scene, bounds)`** is the fix: a dedicated
  `Camera` whose *viewport* IS the clip rectangle. A camera's viewport is a hard, native clip boundary
  — nothing outside it can ever render there, no filter/mask machinery involved — and its own
  `scrollY`/`scrollX` does the panning, so scrolled content is positioned ONCE at its true unscrolled
  coordinates and never re-touched per scroll tick. Same "world/UI two-camera split + mutual
  `.ignore()` lists" shape `Game.ts` already uses for its own field/tray-vs-HUD split (see "Responsive
  Layout"): call `region.camera.ignore(everythingElse)` and `scene.cameras.main.ignore(scrollableObjects)`
  yourself — only the caller knows which of its own objects belong to which half, so the helper doesn't
  guess. Resize the clip rectangle from `layout()` via `setBounds()`. **A scene with its own in-scene
  popup that must render on top of the scrollable region needs a THIRD camera** (added after this one,
  full viewport, holding only the popup's objects) — a later-added camera always composites on top of
  an earlier one's output, so with only two cameras a scrolled-to region would draw over a centered
  popup wherever they overlap.
- **`src/ui/scrollMomentum.ts`** — pure, framework-agnostic (no Phaser import) flick-momentum physics:
  `pushDragSample()`/`computeReleaseVelocity()` (last 3 drag samples, not a single last-delta, which
  overreacts to one noisy final sample) and `stepMomentum()` (frame-rate-independent exponential decay
  + a soft ~100ms edge stop, no bounce/spring). A scene owns one `ScrollMomentumState` per scroll axis,
  feeds `pushDragSample()` from its `pointermove` handler using the pointer event's own real timestamp
  (not a scene/frame clock — see the module's own regression test for why: multiple raw events landing
  within one `update()` tick would otherwise share a single timestamp and corrupt the velocity
  computation in a way that depends on how the render rate lines up with the input rate), assigns
  `computeReleaseVelocity()`'s result to `state.velocity` on release, and calls `stepMomentum()` once
  per `update(time, delta)` tick while `state.velocity !== 0`. Verified via `npm run verify:scroll`
  (`scripts/verify-scroll-momentum.mjs`) — in particular that a 120Hz and a 60Hz tick rate decay the
  same fling to the same final position, not just the same velocity (a plain Euler position step gets
  the decay right but still over-travels at a coarser tick rate; the fix is the exact integral of the
  decaying velocity over each step, not `position + velocity * delta`).

## Localization

`src/i18n/strings.ts` is a plain lookup-table `t(key, params?)` layer, not a library — `{name}`
substitution only, no plurals/ICU/locale-aware number formatting. It ships as a **framework**, not a
finished dictionary: the `en`/`es` objects hold only generic, cross-scene keys (`settings`, `sound`,
`music`, `close`, `back`, `on`, `off` — what `Settings.ts` itself needs). A game adds its own domain
strings by extending these same two objects, in the same commit for both locales — never a second,
parallel `t()` mechanism.

- **Compile-time dictionary parity**: `StringKey = keyof typeof en`, and `es` is typed `Record<StringKey,
  string>` — TypeScript's excess/missing-property checks on that assignment force `es` to have exactly
  `en`'s key set. A key added to one dictionary but not the other is a **build error**, not a blank/wrong
  string discovered later in one language. Keep this property when extending both objects.
- `initLocale()` (awaited in `main.ts`, before `new Phaser.Game(...)`) resolves `getLanguage()`
  (`platform/yt.ts`) through `resolveLocale()`'s generic BCP-47 prefix match (`'es-MX'` -> `'es'`), falling
  back to `DEFAULT_LOCALE` (`'en'`) for anything unsupported. Must resolve before the first scene's
  `create()` — see `main.ts`'s own comment on why (an instant/asset-less `Preloader` can run
  Boot→Preloader→MainMenu synchronously in one tick).
- `getLocale()` reads the currently resolved locale; `t(key, params?)` never actually misses for a real
  `StringKey` (compile-time guarantee) — its `?? key` fallback is purely defensive for a typo'd dynamic
  key. `tOptional(key: string)` is for a dynamically-keyed lookup (a generated/content-driven display-name
  key) — returns `undefined` on a miss instead of the key string itself, so the caller can fall back to
  its own default.
- Adding a locale later is a new dictionary object (typed `Record<StringKey, string>`, so TS immediately
  flags any missing key) plus one entry in `strings.ts`'s `SUPPORTED_LOCALES` — `resolveLocale()`'s
  prefix-matching logic itself is already generic, not hardcoded to `en`/`es`.

## Input Actions

`src/platform/input.ts`'s `bindAction(scene, action, sources, callback)` is the only way scenes wire up
player input. **Rule: gameplay/UI code subscribes to actions, never to raw input events.** No scene calls
`.on('pointerdown', ...)` or `scene.input.keyboard.on('keydown-X', ...)` directly — every interactive
element goes through `bindAction`, which maps one named action (`'primary'`, `'openSettings'`,
`'toggleSound'`, `'toggleMusic'`, `'close'`) to as many input sources as make sense (a pointer target, a
list of keyboard keys, both at once) and fires a single callback regardless of which source triggered it.
Concretely: `MainMenu`'s start text is `'primary'` (pointer + `SPACE`/`ENTER`), its gear button is
`'openSettings'` (pointer + `ESC`); `Game`'s gear button is the same `'openSettings'`; `Settings`' two
toggles are `'toggleSound'`/`'toggleMusic'` (pointer + `S`/`M`) and its Close button is `'close'` (pointer +
`ESC`/`ENTER`). There is no "what kind of device is this" branch anywhere — mouse, touch (Phaser unifies
both into one Pointer API already), and keyboard all work at the same time, unconditionally.

- `sources.pointer` is a game object (or array) that must already be `.setInteractive()`'d — `bindAction`
  only attaches the `pointerdown` listener, it doesn't size the hit area. That's still
  `src/ui/uiScale.ts`'s `ensureMinHitArea()` job (see "Responsive Layout"), called every `layout()`.
  `bindAction` itself is called once, in `create()`, since attaching a listener isn't positioning — it
  doesn't need to re-run on resize the way `layout()` does.
- Every source `bindAction` wires up only fires while `scene.scene.isActive()` (i.e. the scene is
  running, not paused). Pointer sources don't strictly need this — whatever overlay paused the scene
  (e.g. `Settings`' backdrop) already physically blocks the click from reaching anything underneath — but
  keyboard sources do: Phaser does **not** suspend a paused scene's `input.keyboard` listeners, only its
  `update()`/render. Without the guard, pressing `ESC` to close `Settings` would also fire the paused
  opener's own `ESC`-bound `'openSettings'` handler underneath it (both scenes have live listeners on the
  same key at that moment). The guard is applied uniformly to both source kinds for one consistent rule
  rather than "pointer is safe, keyboard needs a special case."
- `MainMenu`'s `'primary'` action is guarded locally (a closure `started` flag inside `MainMenu.create()`)
  to fire at most once — starting the same scene twice mid-transition is unsafe. This is deliberately not
  a feature of `bindAction` itself (no built-in once/many mode); one-shot-vs-repeatable is caller policy,
  not something the generic action-binding layer should encode.

## Save Layer

`src/save/` sits on top of `src/platform/yt.ts`'s `loadData`/`saveData` primitives:

- `types.ts` — the single `SaveState` shape (current version, **v2**: `{ v, bestScore, coins,
  purchases, settings: { sound, music } }` — `coins`/`purchases` back the Shop layer, see "Shop
  Layer"), current `SAVE_SCHEMA_VERSION`, and `DEFAULT_SAVE_STATE`.
- `migrate.ts` — `migrate(raw: unknown): SaveState | null`, a `switch (raw.v)` ladder (`case 1` falls
  through to `case 2`'s `normalizeV2` — the v1 -> v2 bump added `coins`/`purchases`, both of which
  `normalizeV2`'s own `typeof`/`Array.isArray` checks already default when absent, so no separate
  `upgradeV1ToV2()` step was needed; the docstring shows the fallthrough shape for a future bump that
  *does* need one). Returns `null` for anything it doesn't recognize, including individually-corrupt
  fields (e.g. `bestScore` not a number falls back to the default rather than propagating garbage).
- `save.ts` — `load()`/`save(state)`, the only functions that touch `yt.ts`. `load()` never throws: empty
  string (no save yet / signed-out user), corrupt JSON, and unrecognized schema all resolve to
  `DEFAULT_SAVE_STATE` with a `console.warn`. `save()` checks `isWellFormed()` (feature-detected —
  `typeof json.isWellFormed === 'function'` — since this ES2024 runtime method isn't esbuild-polyfillable,
  and a build could get reused on a browser old enough to lack it) and a 3 MiB size guard (warns at 80%)
  before calling `saveData()` — both skip the write rather than throwing. Health signals here are split by
  fault: `loadData()`/`saveData()` rejecting calls `logError()` (an unexpected failure of the platform API
  itself), while the `isWellFormed()`/size-limit guards call `logWarning()` (a problem with data our own
  code produced, not the platform) — the empty-string (signed-out), corrupt-JSON, and unrecognized-schema
  branches call neither, since none of those are errors. Deliberately not deduped like `health.ts`'s
  window-error capture — the SDK's health API already rate-limits itself, and *how often* saves are
  failing is itself a useful signal here, not noise to collapse.
- `store.ts` — the single in-memory `SaveState` instance. Scenes call `store.mutate(s => { ... })` to
  change it (never construct their own `SaveState`); this schedules a save debounced to once per 2s.
  `store.flush()` saves immediately, bypassing the debounce. `bindAutosave(game)` calls it on both the
  platform's `YTEvents.PAUSE` (Playables) and the window's `pagehide` (everywhere else, including dev —
  `YTEvents.PAUSE` only ever fires inside YouTube, so without `pagehide` a tab closed mid-debounce-window
  would silently lose up to 2s of mutations; `pagehide` over `beforeunload` because the latter is
  unreliable on mobile). `store.init()` must run once, before the game/scenes start (done in `main.ts`),
  to populate the store from the persisted save.

`tsconfig.json`'s `target`/`lib` are `ES2024` specifically for `String.prototype.isWellFormed()`.

## Shop Layer

`src/shop/` is a mechanism, not a product — it ships a coin balance, a purchase-tracking
mechanism, and a demo scene; **no game ships with this template already has a catalog**. A game
wires up a real shop in three steps:

1. **Define a catalog** — an array of `ShopItem` (`shop/catalog.ts`: `{ id, priceCoins, titleKey,
   icon, kind: 'consumable' | 'unlock' }`) and register it with `setCatalog(items)` (same
   "register a config object once at boot" shape as `ui/theme.ts`'s `setTheme()`) — call it
   unconditionally, e.g. from `main.ts`, not behind a DEV gate. `id` is permanent once shipped: for
   an `'unlock'` item it's also the exact string stored in `SaveState.purchases`, so renaming it
   orphans anyone who already bought it (they'd fail `hasPurchased()` against the new id and could
   re-buy). `titleKey` is an i18n key (`i18n/strings.ts`'s `tOptional()`) — it does not need a
   dictionary entry; `Shop.ts` falls back to `titleCase(id)` (`ui/format.ts`) for any item with no
   translated title, so a catalog can ship before its strings are translated (never blank/wrong).
2. **Handle purchases**: `kind: 'consumable'` — pass an `onPurchase(item) => void` callback via
   `scene.launch('Shop', { opener: ..., onPurchase })`; `Shop.ts` debits the coins and calls it,
   the *game* decides what a consumable actually does (grant a hint, extend a timer, ...) — the
   shop layer has no opinion. `kind: 'unlock'` needs no callback at all: `Shop.ts` pushes `item.id`
   into `SaveState.purchases` itself and flips that row to an "Owned" state; check
   `shop/coins.ts`'s `hasPurchased(getState().purchases, itemId)` wherever the game needs to know
   whether a permanent unlock is active.
3. **Add a real entry point** — a permanent Shop button (any scene, via `neonButton`/`rowButton`),
   with no `import.meta.env.DEV` gate. `MainMenu`'s own Shop button in this template IS gated
   (`if (import.meta.env.DEV) { ... }`, mirroring the demo catalog seeded right above it in
   `MainMenu.ts`) specifically because the bare template has no real products to sell — so its
   *own* production build shouldn't show a shop at all. Both blocks are dead-code-eliminated out of
   `vite build`/`vite preview`/`npm run bundle` output the same way `import.meta.env.DEV`-gated code
   is eliminated elsewhere in this codebase (see `main.ts`'s dev/debug `window.__game` hooks for the
   same pattern) — a game deleting the `if` around its own copy of this button is enough, no build
   config to touch.

Mechanism pieces:

- `shop/coins.ts` — pure, store-agnostic functions over a plain `coins: number` (never the whole
  `SaveState` or the store singleton): `canAfford(coins, price)` (read-only query), `earnCoins(coins,
  amount)` (floored, never negative), `spendCoins(coins, price)` (returns the new balance, or `null`
  if `coins < price` — **never partially deducts**; there is no state between "declined, balance
  unchanged" and "spent, balance reduced by exactly `price`"), `hasPurchased(purchases, itemId)`.
- **Atomicity**: the actual "spend" a purchase performs is the whole read-check-write sequence
  inside ONE `store.mutate()` call (`Scenes/Shop.ts`'s `purchase()`) — `spendCoins()`'s own
  null-on-insufficient-funds return is what makes that safe to call unconditionally inside the
  mutator without a separate pre-check that could (in a future, more concurrent version of this
  layer) race against another mutation between the check and the deduction. JS itself is
  single-threaded so nothing can interleave *today*, but the one-function-one-mutate shape means
  that stays true even if this logic is ever called from more places.
- `scenes/Shop.ts` — a `scene.launch({ opener, onPurchase? })` overlay, same pause/resume pattern as
  `Settings` (see "Audio Layer" below) — and, like `Settings`, listed in `platform/lifecycle.ts`'s
  `OVERLAY_SCENES` so a real platform pause doesn't freeze its own Close button (see "YouTube Playables
  Wrapper"). Any new overlay scene a game adds needs the same registration. UI is entirely `ui/theme.ts` widgets: a `valueBadge('🪙',
  coins)` balance readout, one `rowButton` per catalog item (`SHOP_ROW_COLUMNS`, same
  fraction-of-row-width convention "UI Kit" describes for any row list), a `neonButton` "top up"
  action, and a `neonButton` Close. Rows dim (`setColor`) and their accent label flips
  (`setAccentText`, added to `RowButton` specifically to support this) between `t('buy')` and
  `t('owned')`/an unaffordable-but-still-visible state — see `refreshAllRows()`, called after both a
  purchase (this item's own state changed) and a top-up (every row's affordability may have
  changed). **Does not scroll** — rows just stack to fit the catalog. A catalog too long for one
  screen needs a real scrolling list, which this template does not wire up for `Shop` by default —
  see "Scroll Patterns" for the `scrollableCameraRegion()` helper to build one, and its own RULE
  against reaching for `setMask()` to clip the row list instead (a real, previously-hit bug, not a
  theoretical one).
- **Rewarded top-up**: the "🎬 +50 coins" button calls `platform/adGate.ts`'s `showRewarded(game,
  'coins-topup')` directly (same "game code calls only `adGate.ts`" rule as everywhere else — see
  "Ad Gate" — `Shop.ts` needs no extra pause/resume handling of its own, `adGate` already owns
  that). `'coins-topup'` is this template's one reserved rewardId string; a game adding its own
  rewarded flows should keep each rewardId a stable, explicit string constant the same way, not a
  computed/dynamic one — the SDK treats each rewardId as an independent ad placement.

## Audio Layer

`src/audio/audio.ts` is the only module allowed to touch `game.sound` — scenes call
`playSfx(key)`/`playMusic(key)`/`stopMusic()`/`setSound(on)`/`setMusic(on)`/`isSoundOn()`/`isMusicOn()`
instead. Two independent flags (`SaveState.settings.sound`/`.music`, via `src/save/store.ts`) each combine
with a platform mute (`isAudioEnabled()` at init, kept live via `YTEvents.AUDIO_ENABLED_CHANGE`):
`audible = platformAudioEnabled && userFlag`. The platform side of that is a transient runtime-only
override — the `AUDIO_ENABLED_CHANGE` handler recomputes audibility but never calls `store.mutate()`; only
`setSound()`/`setMusic()` (user-triggered) touch the save.

- SFX are gated at call time: `playSfx()` just doesn't call `soundManager.play()` when inaudible, since
  one-shots have no ongoing state to update later.
- Music is a single retained instance (`currentMusic`), muted/unmuted in place via `.setMute()` whenever
  the platform or user flag changes, so an already-playing track reacts immediately. `playMusic()` and
  `stopMusic()` call `.destroy()`, not `.stop()` — `.stop()` alone leaves a dead-but-not-removed instance
  in the manager's sound list, which leaked one per call on repeated PAUSE/RESUME cycles before this was
  caught in testing.
- `YTEvents.PAUSE` → `soundManager.mute = true` (blanket safety net) + capture `currentMusic.seek` into
  `pausedMusicSeek` + `stopMusic()`. `YTEvents.RESUME` → unmute the manager, then
  `playMusic(currentMusicKey, pausedMusicSeek)` if `effectiveMusic()` — continues the same track from
  where it left off (a fresh instance, since `stopMusic()` destroyed the old one, but seeked back in).
  `playMusic()`'s second argument is `seekSeconds` and defaults to `0`; only the PAUSE/RESUME path passes
  a non-zero value — a plain `playMusic(key)` call still always starts from the top.
- **Phaser 4 typing gap:** `Phaser.Sound.BaseSound`'s `.d.ts` omits `mute`/`setMute()`/`volume`/`loop` even
  though every concrete backend (WebAudio, HTML5, NoAudio) implements them identically (confirmed in
  `node_modules/phaser/src/sound/*`, and documented in the `audio-and-sound` skill) — `audio.ts` works
  around this with a local `MutableSound` interface extension + cast, not a cast to a specific backend class.

`src/scenes/Settings.ts` is a `scene.launch()` overlay (semi-transparent backdrop, Sound/Music toggles,
Close — built from `ui/theme.ts`'s `roundedPanel`/`neonButton`, see "UI Kit") launched with `{ opener:
<scene key> }` by the gear buttons in `MainMenu`/`Game`; opening it pauses
the opener (`scene.pause()`) and closing it resumes exactly that scene by key — this is uniform for both
scenes (not just `Game`) because an unpaused `MainMenu` would still receive the gear-button's own click via
its input plugin and could misfire other handlers underneath the overlay. A `scene.launch()`-ed overlay is
a fully independent scene with its own Input Plugin, so it receives input normally regardless of whether
the scene beneath it is paused (confirmed in testing, not just assumed).

**Two pause sources can overlap** — a user opening Settings (`scene.pause()`) and a platform-level
`YTEvents.PAUSE` (e.g. the YouTube tab backgrounding) firing while it's open. `Settings.close()` checks
`isPlatformPaused()` (see "YouTube Playables Wrapper") before resuming: if a platform pause is still
active, it defers the `scene.resume(opener)` call to a one-time `YTEvents.RESUME` listener instead of
firing it immediately — otherwise closing Settings would resume gameplay/audio the platform still
considers suspended (or, if it silently skipped resuming with no deferred handoff, the scene would stay
paused forever once the platform later resumes, since nothing else ever calls `scene.resume()` on it).

**Vite dev-server gotcha for testing:** a raw `await import('/src/audio/audio.ts')` from outside the app's
own module graph (e.g. a Playwright script) resolves to a *different* module instance than the one
`main.ts` statically imports and calls `init(game)` on — so `audio.playMusic()` etc. silently no-op
(`soundManager` is `null` in that instance) unless the test also calls `audio.init(window.__game)` itself.
`src/save/store.ts` tests don't hit this because they always call `store.init()` explicitly anyway. Also:
WebAudio's `mute`/`volume` are backed by real `AudioParam` automation (`gain.setValueAtTime(...)`) — reading
the value back synchronously in the same tick after setting it can return the stale value in headless
Chromium (no real audio render thread ticking); wait ~100–300ms before asserting on it in tests.

## Build Guards & Asset Policy

Final platform-layer chunk before running the official Playables Test Suite — a rejected
submission is expensive to iterate on, so these are mechanical guards, not just conventions.

- **`scripts/check-bundle.mjs`** runs automatically as the last step of `npm run build`
  (`tsc && vite build && node scripts/check-bundle.mjs`). It inspects `dist/` only —
  no network, no SDK — and always prints a top-10-largest-files table first, so if it does
  fail the culprit is immediately visible instead of requiring a manual `dist/` dig.
  Thresholds: warn (exit 0) past 10 MB total; fail (exit 1) past 25 MB total *or* on any
  single file over 25 MB. The 25 MB per-file number is a deliberate 5 MB margin under the
  platform's actual 30 MB-per-file limit (see PLAYABLES-SDK.md), not the platform limit
  itself — the guard is meant to trip before an actual submission would be rejected, not
  exactly at the boundary.
- The same script also fails on source-authoring file extensions anywhere in `dist/`
  (`.psd`, `.ai`, `.sketch`, `.fig`, `.xcf`, `.blend`, `.aep`). **Deliberately excludes**
  `.wav`/other audio-delivery formats — this project already ships
  `public/assets/audio/blip.wav` as a real runtime asset via `vite`'s `public/` copy, and a
  generic extension check can't distinguish a "WAV master" from a normal delivered sound
  file by extension alone. That distinction is a provenance question, not a mechanical
  one — enforced by the AUDIO-SOURCES.md rule below instead.
- **`vite.config.ts`'s `inlineModuleLoader` plugin** rewrites the entry point during
  `vite build` (`apply: 'build'` — dev serving is completely untouched) from Vite's default
  static `<script type="module" crossorigin src="...">` into a classic inline
  `<script>import("...")</script>`, and strips any `<link rel="modulepreload">` tags.
  **Why**: the Playables Test Suite's "SDK loaded before any game code" MUST check watches
  actual *network load order*, not DOM/script-tag order or JS execution order. A static
  `<script type="module" src="...">` is visible to the browser's *preload scanner*, which
  speculatively fetches it in parallel with — not after — the classic blocking SDK
  `<script>` tag preceding it in the document; a small local bundle can finish downloading
  before the SDK's network-round-trip-bound fetch does, failing the check even with
  perfectly correct tag order. A dynamic `import()` call is invisible to the preload
  scanner (it only scans HTML attributes, not JS source), so the entry chunk's fetch can't
  start until this classic script actually executes — which, positioned after the SDK's own
  classic script, can't happen before the SDK has already finished loading and running.
  Verified directly (not just reasoned about) against a real `vite preview` server with
  Playwright request-timing events: with the fix, the entry chunk's request doesn't even
  *start* until the SDK's request has fully finished; reverting to the old static tag as a
  negative control reproduced the exact bug — entry chunk request starts and finishes while
  the SDK request is still in flight.
- **`scripts/make-bundle.mjs`** (`npm run bundle` = `npm run build` then this) zips `dist/`
  into `build/<app-id>-<version>.zip` (`<app-id>` is `package.json`'s `name`, slugified;
  version is `package.json`'s `version`). Before zipping it re-verifies, on the actual
  built `dist/index.html` (not just the source `index.html`):
  - the file exists at the dist root,
  - **no static `<script type="module" src="...">`** and **no `<link rel="modulepreload">`**
    — both would reintroduce the preload-scanner race the `inlineModuleLoader` plugin above
    exists to prevent, if that plugin were ever removed or broken,
  - the Playables SDK `<script>` tag precedes the inline `<script>import(...)</script>`
    loader — the certification-critical ordering documented in PLAYABLES-SDK.md,
  - **no `src="/..."` or `href="/..."` root-absolute path** (excluding protocol-relative
    `//...`) anywhere in the HTML — Playables does not host games at the domain root, so a
    root-absolute asset path 404s there even though it works fine locally/at `vite preview`.

  All of these are re-checked here because building the ZIP is the last chance to catch a
  regression before submission, and this isn't paranoia — building this script is exactly
  what caught the SDK-script-order bug *and* the absolute-path bug documented in "Known
  Issues Fixed" below (the network-order bug above was instead found by reasoning about the
  Test Suite's actual failure mode, not caught after the fact). In each case the *source*
  files looked correct; `vite build` silently broke them in the shipped output.
  `archive.directory(DIST_DIR, false, filterFn)` puts `dist/`'s contents at the ZIP root
  instead of nesting them under a `dist/` folder (Playables requires `index.html` at the
  archive root) and `filterFn` drops `.gitkeep` files — harmless repo-scaffolding cruft
  (git can't track empty directories) with no purpose in a submission archive. `build/` is
  gitignored, same as `dist/`.
- **Certification testing must target `npm run preview` (or the built `dist/`), never
  `npm run dev`.** In dev mode, Vite manages its own module graph and injects its HMR
  client (`<script type="module" src="/@vite/client">`) ahead of everything else, including
  the SDK script — none of which resembles the shipped artifact's load order in any way,
  and `main.ts` is still served as a plain static `<script type="module" src="/src/main.ts">`
  (the `inlineModuleLoader` plugin's `apply: 'build'` means it never touches dev serving).
  A red "SDK loaded before any game code" (or similar network-order) result from pointing
  the Test Suite at `npm run dev` is **expected and not a real bug** — it says nothing about
  the actual submission artifact. Always run the Test Suite against `npm run preview`'s
  served `dist/` (or the unzipped submission ZIP) instead.
- **Audio provenance**: adding any audio file requires a row in `AUDIO-SOURCES.md` (repo
  root) first — file, source URL, license, date added — and only **CC0** or
  **self-generated** audio is acceptable, since an unresolved copyright claim on a sound is
  one of the most common Playables rejection reasons. This is a process rule, not (yet) a
  mechanical build gate — nothing currently fails `npm run build` for a missing registry
  row. `AUDIO-SOURCES.md` deliberately lives at the repo root, not under `public/assets/`:
  it's an internal process document, not a game asset, so it must never end up inside
  `dist/` or the submission ZIP — `public/` is copied into `dist/` verbatim by Vite, so
  anything under `public/assets/` ships; the repo root does not.
  `public/assets/audio/blip.wav` — the project's one existing audio file, predating this
  rule — has a registry row backfilled by directly inspecting its raw PCM samples (constant
  ~441 Hz tone, exact 20.00% peak amplitude, no external source referenced anywhere in the
  commit that added it): self-generated, not from a template or sample pack.

## Out of Scope and Why

Deliberately not built, so they don't get "discovered missing" and re-litigated later:

- **Save compression/chunking** — `SaveState` (`{ v, bestScore, settings: { sound, music } }`) is a few
  hundred bytes serialized. `save.ts`'s 3 MiB size guard (see "Save Layer") exists for defense-in-depth,
  not because this project is anywhere near it; compressing or chunking a payload this small would add
  real complexity (a decode step on every load, a schema migration concern of its own) to defend against a
  risk that doesn't exist yet. Revisit if `SaveState` ever grows to hold real per-level/per-item data.
- **Telemetry/analytics** — Playables is an offline-only environment; its CSP blocks requests to external
  hosts, so a typical analytics SDK (or a custom event collector phoning home) literally cannot function
  here, not just "isn't needed yet." The only outbound signal is `health.ts`'s `logError()`/`logWarning()`
  pings to the platform's own health metrics (see "Health Monitoring").
- **`onLowMemory` handling** — not part of the `ytgame` SDK surface this project has integrated against
  (see PLAYABLES-SDK.md); there is nothing to hook up. Revisit if a future SDK version adds a memory-
  pressure callback and the game's asset footprint grows enough to make it relevant.

## Known Issues Fixed

Bugs and gotchas hit and fixed while building the platform/save/audio layers — recorded so they don't get
silently reintroduced or re-debugged from scratch. Full detail lives in the section noted; this is the
index.

App bugs:

- `save.ts`'s `loadData()`/`saveData()` rejections and its `isWellFormed()`/size-limit guard
  rejections only ever reached `console.warn` — no signal reached the platform's own health
  metrics at all, so a spike in save failures in the field would have been invisible outside
  local dev logs. Fixed by adding `logError()` (platform API rejected) / `logWarning()` (our
  own guard rejected the payload) alongside the existing `console.warn` calls — see "Save
  Layer".
- **Certification blocker, found from the actual Playables Test Suite output, not by code
  review**: the Test Suite's "SDK loaded before any game code" MUST check was red even with
  the SDK `<script>` correctly preceding the module entry tag in `dist/index.html`. Root
  cause: the check watches actual network load order, not DOM/tag order — a static
  `<script type="module" src="...">` is visible to the browser's preload scanner, which
  fetches it in parallel with the classic blocking SDK script rather than after it, and a
  small local bundle can finish downloading before the SDK's real network round-trip does.
  Fix: `vite.config.ts`'s `inlineModuleLoader` plugin rewrites the entry into a classic
  inline `<script>import(...)</script>`, invisible to the preload scanner. → "Build Guards &
  Asset Policy"
- **Certification blocker, found by a full manual code review against SDK requirements,
  not caught by any automated chunk**: `vite build`'s default `base` emits root-absolute
  asset paths (`<script src="/assets/index-xxxx.js">`). Works locally (dev server and
  `vite preview` both serve from domain root) but Playables does not host games at the
  domain root — the shipped `dist/index.html` would 404 loading its own JS, i.e. a black
  screen on actual submission. Verified by serving a real build under an arbitrary
  non-root subpath: 404s with the default `base`, loads clean with `base: './'`. Fix:
  `vite.config.ts`'s `base: './'`, plus a `scripts/make-bundle.mjs` regression guard that
  fails on any `src="/"`/`href="/"` in the built `dist/index.html`. → "Build Guards & Asset
  Policy"
- **Certification blocker, same review**: `YTEvents.PAUSE` never actually paused gameplay
  — `audio.ts` muted sound and `store.ts` flushed the save, but nothing called
  `scene.pause()`, so `Game`'s `update()` loop (and input) kept running the entire time the
  platform considered the game "paused." Fix: `src/platform/lifecycle.ts`'s
  `bindGameplayPause()`. → "YouTube Playables Wrapper"
- `bindGameplayPause()` originally paused an explicit whitelist (`['MainMenu', 'Game']`) — correct today,
  but a silent trap for later: any new gameplay scene would need someone to remember to add it to that
  list, or platform pauses would quietly stop freezing it. Inverted to an overlay-*exclusion* list before
  the template freeze (pause everything active except `Settings`) so the safe behavior is the default. →
  "YouTube Playables Wrapper"
- The production `dist/index.html`'s script order was the reverse of the certification
  requirement: the *source* `index.html` had the SDK `<script>` before the `type="module"`
  entry script, both in `<body>` — but `vite build` hoists the entry module script into
  `<head>` (appended right before the closing head tag, regardless of its original
  position in source) while leaving any other `<body>` script where it was, so the built
  output ended up with the module script running *first*. Never manually verified against
  the actual built HTML until `scripts/make-bundle.mjs` (Chunk 6) checked it programmatically.
  → "Build Guards & Asset Policy" (fix: the SDK `<script>` now lives in `<head>` in source
  too, so Vite's append-to-head lands its own tag after it, not before)
- `gameReady()` could fire before `firstFrameReady()` — instant/asset-less `Preloader` runs the whole
  Boot→Preloader→MainMenu chain in one tick, before the first render. → "YouTube Playables Wrapper"
- Build failed on `main.ts`'s top-level `await` — esbuild's default target predates it; needed
  `vite.config.ts`'s `build.target: 'es2022'`.
- SDK `<script>` load could hang the game indefinitely with no fallback. → "YouTube Playables Wrapper"
  (`waitForPlatformReady()`'s timeout race — with a documented residual limit it can't fully close)
- Autosave never fired outside real Playables (`YTEvents.PAUSE` doesn't exist there) — a tab closed
  mid-debounce-window silently lost pending mutations. → "Save Layer" (`pagehide` fallback)
- MainMenu's scene-wide `once('pointerdown')` also fired on gear-button clicks, incorrectly starting
  `Game`. → fixed by attaching the listener to the "start" text object instead of the whole scene.
- Sound instances leaked across every PAUSE/RESUME cycle — `stopMusic()`/`playMusic()` used `.stop()`
  instead of `.destroy()`. → "Audio Layer"
- Music always restarted from `0` on RESUME instead of continuing where it left off. → "Audio Layer"
  (`pausedMusicSeek`, `playMusic()`'s `seekSeconds` param)
- `Settings.close()` could resume a scene out from under an active platform pause (or, if it just skipped
  resuming, leave it paused forever). → "Audio Layer" / "YouTube Playables Wrapper" (`isPlatformPaused()`
  + deferred resume on the next `YTEvents.RESUME`)
- `Settings`'s backdrop was originally created at `(0, 0, 0, 0)` with `setInteractive()` called
  immediately at that zero size — Phaser's `setInteractive()` skips creating `.input` entirely for a 0x0
  object, so the backdrop had no `.input` at all, then never gained one, and never actually swallowed a
  click at any real viewport size. → "Responsive Layout" (gotcha #1: `setInteractive()` deferred to
  `layout()`, after a real size exists)
- `Game`'s gear button rendered at the wrong screen position (near mid-screen instead of the corner)
  whenever the world camera's zoom/pan was non-identity — it was drawn through `cameras.main`, the same
  camera being zoomed/panned onto the fixed logical world. A test that only reads a game object's `x`/`y`
  properties can't catch this (those aren't touched by which camera renders them); it only showed up in an
  actual screenshot. → "Responsive Layout" (two-camera split: UI on a dedicated always-1:1 `uiCamera`,
  excluded from `cameras.main` via `.ignore()`)

Non-obvious platform facts (not bugs, but easy to get wrong again):

- `setInteractive()` on an object whose current `width`/`height` is `0` creates no `.input` at all (not
  an `.input` with a zero-size hit area) — the derivation explicitly guards on both being nonzero.
  → "Responsive Layout" (gotcha #1)
- Calling `setInteractive()` again on an object that already has `.input` only re-enables it — it does
  not recompute the hit area from the object's current size/position. Any object whose size changes after
  its first `setInteractive()` call (i.e. anything under `layout()`) must resize `obj.input.hitArea`
  directly. → "Responsive Layout" (gotcha #2)
- `GameObject.setMask(geometryMask)` silently does nothing under this project's WebGL renderer — no
  error, no exception, `.mask` just never gets assigned. → "Scroll Patterns" (RULE: use
  `scrollableCameraRegion()`'s dedicated-camera-viewport clip instead)

- `String.prototype.isWellFormed()` (ES2024) isn't universally available at runtime — feature-detected in
  `save.ts`, not called blindly; esbuild transpiles syntax, not missing runtime methods.
- `Phaser.Sound.BaseSound`'s `.d.ts` omits `mute`/`setMute()`/`seek`/`volume`/`loop` even though every
  concrete backend implements them identically. → "Audio Layer" (`MutableSound` interface extension)
- `src/platform/yt.ts` and `adGate.ts` use `import type * as Phaser from 'phaser'`, not a value import —
  both files only ever need `Phaser.Game` as a type annotation, never a runtime `Phaser.*` API call. A
  *value* `import * as Phaser from 'phaser'` executes the whole package at module-load time, and Phaser's
  own init code unconditionally reads `window` — harmless in a browser, but it means any Node-run script
  that transitively imports one of these two files (a future headless test/tooling script, say) would
  crash immediately outside a browser environment. Every other file under `src/ui/`/`src/scenes/` that
  calls real runtime Phaser APIs (`Phaser.Math.Clamp`, `Phaser.Geom.Rectangle`, `Phaser.Input.Events.*`,
  ...) keeps the ordinary value import — this is specific to platform-layer files that take `Phaser.Game`
  purely as a typed parameter.

Testing-only gotchas (not app bugs — see "Audio Layer" for both):

- A raw dynamic `import()` of an app module from an external test script is a *different* module instance
  than the one `main.ts` statically imports; singletons initialized only by `main.ts` (like `audio.ts`'s
  `soundManager`) need `init()` called again on that instance, or they silently no-op.
- WebAudio's `mute`/`volume` are `AudioParam` automation — reading them back synchronously in the same
  tick after setting them can return the stale value in headless Chromium; wait ~100–300ms before
  asserting on it.
