# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is, and what it is not yet

**Flick Checkers** for YouTube Playables — a flick game after the Soviet board game «Чапаев», which
is how `GAME-PLAN.md` still refers to the ancestor and is not a name the code or the player uses
(see "One name, and it is Flick Checkers"): eight discs a side on a square board, seen from
straight above, flicked with a slingshot drag until one side has nothing left on the board. The
design document is `GAME-PLAN.md` and it is the authority on every question of scope — read it
before adding anything, and read §10's chunk table before deciding where a change belongs.

It is **not** a fresh project. It is the `Phaser_Core` template with roughly half of a finished
draughts game (`../Checkers`) lifted into it — the half that was never about draughts: the platform
wrapper, the save/shop/economy layers, the UI kit, the board geometry, the asset generators. §1 of
the plan is the inventory of what came across, what was left behind (`rules/`, `bot/`, `session.ts`,
the isometric projection) and what gets rewritten.

**Every chunk of `GAME-PLAN.md` §10 is built.** S1 (the port), S2 (the solver), S3 (the disc
layer), S5 (aiming), S6 (the round), S7 (the bot), S8 (the branches of arms), S9 (the match, saved
and resumable), S10 (score, combos, energy-scaled sound), S11 (the daily puzzle with its
build-time solvability proof), S12 (board modifiers), S12b (branch art) and S13 (economy, shop,
metadata) — everything below describes real, working code. **A tutorial, a rules page and a guided
tour were added on top of the plan** — §10 names none of them, and the game shipped with no
explanation of itself at all; see "The Tutorial" and "The Guided Tour", which teach three different
kinds of thing and are documented separately for that reason.

**Two things the plan asks for that are NOT done, and cannot be done from here:**

1. **The calibration pass — the MEASURABLE half is now done; the taste half is not.** §11's first
   open question is whether the friction feels right, and only playing can answer that. What the
   feeling stands on is arithmetic, though, and `npm run verify:feel` now measures it: how hard you
   have to pull to reach the enemy at all, and what a full-power miss costs. See §11's two threshold
   sections and "Simulation" below.

   **The symptom this file used to record was wrong, and the correction matters more than the
   symptom.** It said a straight full-strength shot "usually posts your OWN disc off the far edge".
   Measured over the bot's own ±25° aiming cone, infantry loses the shooter on **23.8%** of
   full-power shots and takes an enemy on **81%** — because 81% of shots in that cone CONNECT, and a
   head-on contact between equal masses leaves the shooter nearly stopped. The 11.57-cell arithmetic
   describes a shot into empty board, which is not the shot anyone takes. Two knobs were eliminated
   on the strength of that: `MAX_SPEED_CELLS` and `FRICTION_DECEL_CELLS` both trade the two
   thresholds against each other and the window where both hold is provably empty (a miss survives
   only below 7.5 cells of reach; the draggiest branch reaches the enemy only above 8.5).

   The real defect was the opposite end of the gesture — the bottom two thirds of the pull did
   nothing from the opening rank — and it was fixed by `POWER_CURVE`, not by friction. What is still
   open is whether the RESULT feels right, which is still a question for a person with a phone.
2. **The official Playables Test Suite run** (§10's S13, and the deadline §11 sets). It is an
   external tool a human has to point at `npm run preview` — never at `npm run dev`, see "Build
   Guards & Asset Policy". `npm run bundle` produces the submission ZIP.

§11's third open question — whether a board with no bumpers is too punishing for new players, and
`bumper` should therefore be the default rather than a mode — also still needs live players.

## Commands

- `npm run dev` — start Vite dev server (http://localhost:8080, auto-opens browser)
- `npm run build` — typecheck (`tsc`, no emit), production bundle to `dist/`, then
  `scripts/check-bundle.mjs` (size/content guard — see "Build Guards & Asset Policy")
- `npm run bundle` — `npm run build`, then `scripts/make-bundle.mjs` zips `dist/` into
  `build/<app-id>-<version>.zip` for Playables submission
- `npm run preview` — serve the built `dist/` bundle locally. **Point the Playables Test
  Suite at this, never at `npm run dev`** — see "Build Guards & Asset Policy" for why dev
  mode's load order isn't representative of the shipped artifact.
- `npm run verify:sim` — plain-Node logic check for `src/sim/`: conservation, finite rest, no
  tunnelling at maximum speed, determinism, render cadence at 120/144/165Hz, the aim maths, and
  every trap of §2. The most important one in the repo — see "Simulation", "Rendering the Discs"
  and "Aiming".
- `npm run bench:sim` — times `runToRest()` on a 16-disc board. Not a test (a timing is not a
  pass/fail assertion, and it is not in `npm test`); run it after any solver change, and on a real
  device before S7 sizes the bot's search.
- `npm run verify:fit` — the same kind of check for `src/board/layout.ts`: the square-grid
  geometry, the board fit, and the HUD bands. See "Board Geometry".
- `npm run verify:scroll` — and for `src/ui/scrollMomentum.ts` — see "Scroll Patterns".
- `npm run verify:feel` — §11's calibration question, as two numbers per branch: the pull that just
  reaches the nearest enemy from the opening (**долёт**, allowance 0.60) and the share of full-power
  shots over the bot's own ±25° cone that cost the shooter its own disc (**наказание**, allowance
  50%). No bot, no randomness, seconds to run. `--curve`, `--max-speed`, `--friction` and
  `--branch-friction` override the physics from outside so both arms of an A/B come from ONE build.
  Two failures are expected and documented — tanks' долёт (short range IS that branch) and
  artillery's наказание (four discs set wide, so a third of the cone meets nothing). See §11.
- `npm run test:platform` also now runs `tests/platform/overlays.test.ts` — see its own note below.
- `npm run verify:content` — the cast as data: every opponent carries all eleven speech triggers
  with two-or-more distinct lines, names a voice profile the sprite actually has, and sits on a ladder
  whose numbers point the way its order claims; the unlock gate opens exactly one rung at a time;
  the speech director's two-tier cooldown and its per-trigger rotation behave; **every quirk a
  character states measurably changes what the search looks at**, compared against the same
  character with its quirks stripped; **no spoken line is long enough to wrap onto a third line**
  (the HUD reserves two, with the priced buttons directly under them — see "They talk"); and the
  BUILT `voice.json` carries exactly the markers `audio/voiceRegistry.ts` names, in both directions.
  Cheap — no solver, no browser — so it IS in `npm test`. See "The Opponents".
  the tiles stay a ruler (~2:1 light-to-dark), nothing on the board out-shines a disc, and the two
  sides survive greyscale. Cheap, so it IS in `npm test`. See "Skins".
- `npm run test:platform` — **the browser suite**: `node --test` driving `playwright-core` against a
  real Chrome, on the BUILT `dist/` served from a SUBPATH (never the dev server, never the domain
  root — a regression to root-absolute asset paths fails every test here instead of surviving to
  submission). It clicks what a player clicks: menu → mode → the rival question → the gallery → the
  board. **Run `npm run build` first**, and note what happens if you do not: a stale `dist/` makes
  the suite pass against code that is not the code under test, which is worse than not running it.
  That is also why it is NOT in `npm test` — that, and its dependence on a real Chrome being
  installed, which every other check in this repo is free of.

  **`tests/platform/layout.test.ts` is the second bug it exists for**, and it holds two invariants
  no unit test can express. **The canvas clear colour must never be visible**: `config.ts` clears to
  `backgroundTop` (`0x3d1160`) and no widget draws with it, so a pixel of exactly that colour is a
  hole in some scene's background — which is how a player found `Modes`, `Shop` and `UiStand` each
  painting their plate as `add.rectangle(0, 0, 4000, 4000).setOrigin(0.5)`, a magic square centred
  on the world origin that covers ±2000 and stops. It is checked at 2400x1200 and 1200x2200, and
  again after a live RESIZE, which is when this class of bug appears at all. **And nothing drawn may
  cross anything else or leave the viewport**, checked at five mobile shapes across the menu, the
  settings, the modes list, the rival question, the gallery, the board, the tutorial, the rules page,
  the daily and the shop. The daily joined that list late and had a shipped overlap to show for it —
  a screen nothing here opens is a screen nothing here checks. **375x664 — the SHORT portrait phone — is the fifth, and it was added after a bug it
  would not have caught**: every other portrait shape here is about 2.2:1, and at 1.77:1 the square
  board leaves a 152px band instead of 235. The board case therefore also asserts a real CLEARANCE
  (6px) between the two priced buttons and the bottom edge, because "inside the viewport" was not
  enough — they overhung by 0.9px, under this file's own 1px tolerance, while the guided tour's ring
  around one of them was visibly cut in half. Note what it
  deliberately does NOT compare: **hit areas**. `ensureMinHitArea` pads every tap target to 44px on
  purpose, so those boxes overlap their neighbours by design — the first version of this file
  reported 48 findings and every one of them was correct behaviour.

  **A button is measured by its PLATE, and it took a bug to get there.** `gameButton` draws its face
  with a `Graphics` (no `getBounds`, so it can never be emitted from the display list) and takes its
  taps through a zero-alpha `Rectangle` (skipped as an invisible hit proxy) — so walking the tree
  found only the LABEL, and a label reaches nowhere near its own button's left and right thirds.
  Anything overlapping a button THERE passed, which is how the mascot came to be drawn through the
  Daily button on three portrait shapes while every case in this file was green. `drawnBoxes` now
  scans each scene's own FIELDS for anything shaped like a `GameButton` — a plain object owning a
  container, so it exists nowhere Phaser can be asked about it — and emits that container at the
  button's real width and height. Negative-controlled: reverting the mascot fix now fails the
  ordinary `draws every menu without overlaps at 375x664`, where before it failed nothing.

  **The viewport lists are the mobile shapes, and 360x640 is the canonical 9:16.** Every case here
  runs it, alongside 320x700 (2.19:1), 375x664 (1.77:1), 390x844 (2.16:1) and the two landscapes.
  A sweep of twelve mobile shapes — the 9:16 family 320x568 / 360x640 / 375x667 / 405x720 / 414x736 /
  450x800 / 540x960 plus the tall and short ones — across every screen, in **both locales**, found
  nothing beyond the mascot; the four in the lists are the shapes that have each caught something.

  **It exists because of one bug and it reproduces that bug on demand.** The rival popup's answers
  both bailed out on a flag a queued `RESUME` had not cleared yet, so the game could not be started
  at all — and `tsc`, 80 unit tests, every `verify:*` and the bundle guard were all green, because
  not one of them boots a scene. Reverting the fix fails exactly the three cases that need to reach a
  board and leaves the other three passing, which is the failure signature to expect from anything
  added here. See `tests/platform/harness.ts`; the harness is lifted from `../Checkers`, which
  `TODO.md` item 4 had been recommending for months.

  **`tests/platform/tutorial.test.ts` is the wiring half of the tutorial**, and it covers what the
  node suite structurally cannot: whether the menu offers it, whether a solved lesson advances,
  whether the last one writes the save, and whether the rules page can be reached from the gear over
  a live match and come back to the same board. One of its cases fires a REAL drag through
  `bindDrag` -> `computeAim` -> the solver -> `settle`; the rest reach into the scene on purpose, so
  that every assertion in the file does not depend on the physics staying exactly as tuned.

  **`tests/platform/coach.test.ts` is the same job for the guided tour**, and the case it exists for
  is geometric: the explanation card must never be drawn over the control it is explaining, which is
  wrong only in landscape and only on some steps. It walks every step at three viewports, counting
  how many actually had a spotlight so the overlap check cannot pass on a tour that rings nothing.
  It is also the ONLY file here that seeds a save with no tour chapters seen — see "The Guided Tour".

  **`tests/platform/audio.test.ts` is the platform mute**, and it exists because of a rejection
  another game got: "game audio only activates after the YouTube mute button is turned on and off".
  Audibility here is a product of two user levels and a platform flag, and the music INSTANCE is
  destroyed and rebuilt across a platform pause — so there is more than one way to end up silent
  while the platform says sound is allowed, and one of them was real. It drives `game.events`
  directly, which is the same channel `platform/yt.ts` relays the real SDK callbacks onto.

  **`tests/platform/overlays.test.ts` guards the RENDER ORDER, and it exists because three screens
  had a dead gear button.** `SceneManager.render()` walks its scene array forward and `scene.launch()`
  never reorders it, so an overlay registered EARLIER in `config.ts` than the page that launches it is
  drawn underneath that page — `Settings` sits before `Shop`, `Tutorial` and `HowToPlay`, and
  `Confirm` sits before `Tutorial`. Each panel opened, paused its opener and drew itself behind an
  opaque background, so from the outside the gear did nothing and the screen was now frozen behind a
  dialog nobody could see. The assertion is the ORDER rather than a screenshot: a screenshot proves
  one panel is visible today, the order is the property that holds for the next overlay too.
  `layout.test.ts` already owns the pixels. The same file carries the other defects from that session
  — the aim camera left zoomed out, the round pill over the coin badge, the hot-seat status capsule
  off-centre, the tutorial's new Back button, and the daily's hint.
- `npm run test:gameplay` — `node --test` over `tests/gameplay/*.test.ts`: the turn matrix of §3 (a
  scenario per flag of `RuleSet`), §4's five branches including the stack threshold, the guided
  tour's chapter bookkeeping (`tour.test.ts` — what a save remembers and what `migrate` does with a
  corrupt list), and **every tutorial lesson played through the real solver** — the one defect a tutorial cannot ship
  with is a lesson whose goal is unreachable, and it is invisible to `tsc`, to the browser suite
  (which fires no shots) and to reading the file. See "Round Rules", "Branches of Arms" and
  "The Tutorial".
- `npm run verify:bot` — S7's acceptance criteria: 100 real rounds of Hard versus Easy, plus the
  8ms frame-budget measurement. **Not in `npm test`** — it is a minute or two of solid computation,
  and a suite nobody runs because it is slow protects nothing. Run it after touching the bot, the
  evaluation weights, or anything in the solver they depend on. See "The Bot".
- `npm run verify:daily` — S11's: generates 30 dates and independently re-proves each one solvable
  in a single shot, and not trivially so. Also **not in `npm test`**, and for the same reason (a few
  minutes). Run it after touching the daily generator, the solver, or the bot's candidate
  generation — all three can turn a proved puzzle unsolvable. See "The Daily Puzzle".
- `npm run verify:balance` — §3's first-move question, measured: 200 self-play matches per
  configuration through the real bot, the real solver and the real round rules, reporting how often
  the side that shoots first wins. **Every seed is played twice with the starter swapped** — without
  that it measures the seed rather than the first move. Also **not in `npm test`** (minutes per
  configuration). Run it after touching the turn rules, the formations or the bot. See "Round Rules"
  and `GAME-PLAN.md` §3 for what the numbers are actually for.
- `npm run verify:branches` — §4's question, measured: do the five branches of arms actually differ?
  Three travel figures on a deliberately oversized 24-cell board (so the edge never truncates the
  number), then real self-play per branch for the two guards — Hard must still beat Easy, and the
  first-move skew must not move. `--travel-only` is the instant half. Also **not in `npm test`**.
  See "Branches of Arms" and `GAME-PLAN.md` §4, which holds the thresholds and what the first
  run of this found.
- `npm run daily` — regenerates the committed puzzle catalogue (`public/assets/daily/puzzles.json`).
  Takes about five minutes for 60 days; the output is committed and a fresh clone never needs it.
- `npm test` — the four cheap `verify:*` checks (`sim`, `fit`, `contrast`, `scroll`) plus the
  gameplay suite. The three slow ones — `verify:bot`, `verify:daily`, `verify:balance` — are
  deliberately outside it.
- `npm run thumbs` — the portal's three store thumbnails (`tests/platform/thumbnails.ts` →
  `store/thumbnails/`), rendered from the BUILT `dist/` through the same harness the browser tests
  use, so what is photographed is the artefact rather than a dev server. The portal requires 1:1
  (min 512), 5:7 (540x756 recommended) and 16:9 (min 1280x720), and each frame is composed for its
  own shape: **the square is CLIPPED out of a portrait window**, because `computeBoardFit` binds the
  board to the shorter side and a 1:1 viewport therefore leaves `computeHudBands` an 8px strip to
  put the whole HUD in; the 5:7 is the menu, the one screen carrying the game's name; the 16:9 is the
  landscape match with its side panel. Two details are not decoration — the board shots wait for the
  opponent's line to STOP GROWING before firing (it types one character at a time, and the first run
  produced "Sergeant said to jus"), and they take the frame immediately after, because
  `SPEECH_HOLD_MS` hides it 2.6s later and a sleep long enough to be safe also misses it. Register
  what it writes in `store/metadata.json`'s `thumbnails`, which `check-bundle` then holds to
  existing.
- `npm run sheet:branches` — every branch emblem on every piece set at the size a disc is actually
  drawn (`scripts/render-branch-sheet.mjs` → `build/branch-sheet.png`). **Judge the 1x block only**;
  the 3x block exists to diagnose a failure, never to find one. It renders the same shape list the
  game rasterises (`src/board/emblems.ts`), so it cannot flatter the product — which `npm run sheet`
  could, and did: it draws discs BARE, and a gold rider on a gold disc shipped because of it.
- `npm run assets` — regenerates `public/assets/atlas/*` from `scripts/make-atlas.mjs`. Dev-only;
  the output is committed and a fresh clone never needs it. **It does NOT touch
  `public/assets/bg/*`**: the shipped backgrounds are external art (`ART-SOURCES.md`), and this is
  a command anyone would reasonably run just to refresh the atlas, so overwriting four shipped
  files with placeholder art had to stop being the default. `npm run assets -- --backgrounds`
  regenerates the procedural fallback set on purpose, and says out loud that it replaced them.
- `npm run audio` — the same for `public/assets/audio/*.ogg` via `scripts/make-audio.mjs`.
  Needs `ffmpeg` with libvorbis on PATH; fails loudly rather than shipping WAVs without it.
  **It regenerates the six one-shots and NOT the music bed**, which is an external track now
  (`AUDIO-SOURCES.md`) — same opt-in shape, and same near miss, as `npm run assets`'s backgrounds.
  `npm run audio -- --music` puts the procedural bed back over it and says out loud that it did.
- `npm run voice` — regenerates `public/assets/voice/voice.{ogg,json}`, the opponents' 49-syllable
  pseudo-voice sprite, from `scripts/make-voice.py`. **Python with numpy, plus the same ffmpeg.**
  Deterministic (every noise source is seeded from the marker name), so a rerun produces identical
  bytes rather than churning a binary; the output is committed and a fresh clone never needs it.
  See "The Opponents".

All of these run under plain `node` via `scripts/register-ts-loader.mjs`'s Node-native-TS +
extensionless-import loader hook — no bundler, no canvas, no browser. That is only possible
because the modules they cover import no Phaser, which is a rule those modules keep on
purpose (see "Board Geometry"). The `verify:*` scripts are hand-rolled assertion lists for
the three pure-logic risk modules; `test:gameplay` is a real `node:test` suite, because a
rule matrix wants named scenarios that keep running after the first failure.

There is no linter or formatter configured. There IS a browser-level suite now (`test:platform`,
above); what is still missing next to `../Checkers` is everything past the first file — boot order,
the pause hierarchy, save round-trips and hit-testing all remain unported.

The historical note this paragraph used to carry, kept because it came true: **no browser-level test
suite here yet** — `../Checkers` has a working one (`tests/platform/*.test.ts`, node:test driving
`playwright-core` against a real `vite preview`) covering boot order, the pause hierarchy,
save round-trips and hit-testing, and it is worth lifting the harness the first time a
platform-layer change needs a safety net. See `TODO.md`.

## Architecture

Phaser 4 game client bundled with Vite. `tsconfig.json` uses `noEmit: true` — TypeScript is only used for typechecking; Vite/esbuild does the actual transpilation. `tsconfig.json`'s `"types": ["vite/client"]` is what makes `import.meta.env.DEV` typecheck at all (`ImportMeta` has no `env` property without it) — needed for every `import.meta.env.DEV`-gated block in this codebase (see "Shop Layer" for the current example). `vite.config.ts` sets `build.target: 'es2022'` — required for the top-level `await` in `main.ts` (esbuild's default target predates it) — and `base: './'`, required because Playables does not host games at the domain root (see "Build Guards & Asset Policy" and "Known Issues Fixed").

- `src/main.ts` — entry point. Calls `initHealthMonitoring()` **first**, before anything else (see
  "Health Monitoring"), then `await waitForPlatformReady()`, `await` the save store's `init()`, `await
  initLocale()` (i18n/strings.ts — see "Localization"; must resolve before the first scene renders any
  `t()` string), then constructs `new Phaser.Game(GameConfig)`, then `bindPlatformEvents(game)`,
  `bindGameplayPause(game)`, `bindAutosave(game)`, and `initAudio(game)`. Between `initLocale()` and
  `new Phaser.Game(...)` it also `await`s `initDisplayFont(DISPLAY_FONT)` (`ui/font.ts` — same
  "before the first `create()`" reason as the locale), then runs three registrations that must all
  happen before any scene builds a widget: `applyGameTheme()` (`gameTheme.ts`), `setCatalog(CATALOG)`
  (`game/economy.ts`) and `setPressSound(...)` (every kit widget's click, from one place instead of
  ~15 call sites). Also sets three dev/debug hooks (not used by game code):
  `window.__game` (lets manual testing emit `YTEvents.PAUSE`/`RESUME`/`AUDIO_ENABLED_CHANGE` on
  `game.events` without a real `ytgame` SDK), `window.__getRecentErrors` (health.ts's ring buffer), and
  `window.__adGate` (adGate.ts's `showInterstitial`/`showRewarded`, bound to this page's real `game` and
  `yt.ts` state) — the latter two exist specifically because a raw dynamic `import()` from a test script
  gets its own disconnected module instance (see "Audio Layer"'s dual-module-instance gotcha), so this is
  the only reliable way to reach the live one. See "YouTube Playables Wrapper", "Save Layer", and "Audio
  Layer" below.
- `src/config.ts` — the single `Phaser.Types.Core.GameConfig` object (renderer type, scale mode,
  `activePointers`, registered scene list). Renderer is `Phaser.AUTO` (WebGL with Canvas fallback).
  **There is no `physics` block and one must never be added** — the file's own comment gives the
  three reasons (tunnelling at flick speeds, AABB separation where an elastic exchange along the
  line of centres is the whole mechanic, and determinism); see "Simulation" below.
- `src/scenes/` — one file per `Phaser.Scene`, wired together via `this.scene.start('SceneName')`, not imports of each other:
  - `Boot` → loads only what the `Preloader` screen itself needs; on the first `Phaser.Core.Events.POST_RENDER` calls `firstFrameReady()`; then starts `Preloader`.
  - `Preloader` → the loading screen, and **everything on it is computed, because it has to be**:
    this scene IS the load, so it can use only what costs nothing to have — the disc textures, which
    `board/discTextures.ts` draws at runtime rather than loading, and the display font, which
    `main.ts` awaits before the first scene exists. That is enough for the title lockup and a drift
    of discs. It loads the atlas, every skin background, the menu plate, the mascot, the sound set
    and the daily catalogue, then starts `MainMenu`. It used to be a white rectangle on a flat
    colour, which is the one screen a certification reviewer is guaranteed to see.
  - `MainMenu` → the title lockup, coin balance, a centred button stack and the mascot. Calls
    `gameReady()`. **It wears its own plate** (`MENU_BACKGROUND_KEY`), not the equipped board's —
    a picture composed to sit behind a board puts its interest exactly where a menu puts its
    buttons. The equipped skin still shows here, on the drifting discs and in the lockup, both of
    which read it live; `refreshFromSave()` therefore no longer touches the background.
    **New match goes to `Modes`, not into a round** — it used to start one under whichever rule set
    happened to be saved, which for a first-time player is a set they have never been shown the name
    of. Continue (present only when there is a saved match, and gold when it is) is the one button
    here that still starts a match outright.
  - `Game` → the gameplay scene: the world/UI camera split, the board, the discs, the aim gesture and
    the round. Read its own header comment before extending it.
  - `Settings` → overlay scene, built entirely from the `src/ui/theme.ts` widget kit
    (`roundedPanel` + `neonButton`) and `t()` strings — see "Audio Layer" below and "UI Kit" for
    the widgets themselves.
  - `Shop` → the same overlay pattern as `Settings`. Opened from `MainMenu` with the three themed
    sets only — see "Shop Layer" below.
  - **Two players on one device** — `GameData.twoPlayer`, reached from `Modes` through the rival
    question rather than through `Opponents`. **Almost none of it is new machinery**: `game/round.ts` was always
    side-agnostic and this scene's aim gate was written that way too (S6 played both sides from one
    seat; S7 replaced the opponent's half with the bot and nothing else), so the mode is `humanSide()`
    returning `round.turn` instead of the player's side. What is NOT free is everything the solo game
    hangs off the word "player": coins, `sendScore`, the ladder unlock, the run stats, both
    consumables and the entire cast are switched off through `isSolo()`. Paying any of them out would
    also make the economy farmable by beating yourself. The mode is stored on the saved match — a
    resumed hot-seat match must not grow a bot — and a record written before the field existed reads
    as solo, which `tests/gameplay/save.test.ts` pins down. **The board does not flip for player
    two**: the board game this one is after is one board with two people at opposite sides of it,
    and §2 chose the
    top-down projection precisely so a direction reads the same from anywhere.
  - **The landscape side panel** — `board/layout.ts`'s `computeSidePanel`, `ui/gamePanel.ts` and
    `ui/playerBlock.ts`, lifted from `../Checkers`' own `PROMPT-GAME-SIDEPANEL.md`. The thing worth
    taking from that brief is not the panel, it is **what gets centred**: centre the BOARD and stick a
    panel to the right edge and the layout has a hole in it the width of the panel; centre the GROUP
    and the margins come out equal. The board never gives up a pixel — it is bound by the viewport's
    shorter side either way — and when the leftover space is too narrow the panel is DROPPED rather
    than squeezed, falling back to `computeHudBands`' two strips (which portrait always uses).
    - **Four zones, not five**: the reference's move list is gone, because a round here is a
      sequence of flicks rather than notated moves. What takes the middle is the opponent's LINE.
    - **Whose turn it is is the lit BLOCK**, not a capsule somewhere else — and that is the second
      time a turn signal has moved in this game for that reason; see the perimeter "turn light" that
      was reported as scenery. The blocks also carry the disc counts and the balance, so the strip
      layout's capsule, pip counter and the top bar's badges are all switched off in panel mode. A
      number on screen twice in one frame is what the brief calls out by name, and it happened here.
    - **The reference's proportions do not transfer unchecked.** Its 0.26 width fraction fits two of
      ITS buttons in a row; two of this kit's `compact` buttons are wider, so at 1280 every pair split
      into its own row until the fraction became 0.29. Borrowing a layout's numbers without measuring
      them against your own furniture is how a copied design ends up subtly wrong everywhere.
    - The panel's four actions are the two consumables plus **Shop and Leave**. The shop is a nav
      DESTINATION here rather than an overlay, so that button leaves the board — safe only because
      `navTo` now carries RETURN data (`ui/chrome.ts`'s `NavEntry`) and pushes `{ resume: true }`.
      Without it the back button out of the shop would have started a fresh match over the saved one,
      silently. `tests/platform/panel.test.ts` marks the round and looks for the mark again.
  - `Modes` → a bottom-navigation destination (not an overlay): **step one of two**, picking a rule
    set (§3), each card carrying its set's win condition and a line of what it does. It is where
    `MainMenu`'s New match arrives. It does NOT start a match and it does not hold the cast any more
    — choosing a mode (or pressing the gold `primary` button pinned above the nav bar) raises
    `Opponents` over it, and the match starts from there. It never resumes; a saved match is
    Continue's job. Reachable both as a nav tab and as the New-match step, and identical in both,
    which is why the button is unconditional.
  - **The rival question** sits between them — `Modes.askRival()`, a `Confirm` with three answers:
    a character, the person next to you, or cancel. **Only the Start button raises it.** Tapping a
    mode card selects and nothing else: a card is a choice and the button is the act, so a player can
    read all four modes without a dialog appearing at the first one they touch. Before this, choosing
    a mode opened the cast directly, which made "who" a question with one possible answer and forced
    the two-player match to be reached by a second button that repeated the mode choice underneath
    it. Asking at the button puts both answers at the same fork and means the rule set is chosen
    exactly once whichever way the match goes. **This is what turned `Confirm` from a yes/no into a list of choices** — see its header;
    `Game`'s leave-match dialog expresses its old shape through `leaveConfirm()` and reads no worse.
  - `Opponents` → **step two**, an overlay over `Modes`: the eighteen characters (see "The Opponents"),
    scrolling, with the mode chosen in step one named in its subtitle and a gold button that starts
    the match. It used to be the bottom half of `Modes`' single scroll column, and that is the
    defect it fixes: two different questions stacked in one list, with the second one below the fold
    on every viewport the game targets — so the ladder, which is the whole reason the cast exists,
    was the half nobody scrolled to. Read its header before touching the clipping: the list scrolls
    through a camera viewport, and a camera OWNS its viewport's pixels rather than compositing over
    them, so the overlay's own plate is absent inside the list rectangle and the region camera
    carries `OVERLAY_PANEL_FILL` as its background to make up for it.
  - `MatchResult` → one overlay for the end of a round and the end of a match. See "The Match".
  - `DailyResult` → the same moment for §7's puzzle, and it did NOT exist: solving the daily played
    a sound and rewrote two lines in the HUD band, on the one screen in the game built around a
    once-a-day event. A separate scene rather than a third `scope` on `MatchResult` — see its header
    for why, and for the rule if a third result panel is ever wanted.
  - `Daily` → §7's one-shot puzzle. A separate scene from `Game` rather than a mode inside it,
    because almost nothing is shared: no opponent, no turn, no round, no match and no bot. What IS
    shared — the board, the disc layer, the aim gesture, the solver — is shared as modules, which is
    the whole reason those were written as modules.
  - `Tutorial` → six lessons on a live board, and `HowToPlay` → the reference everything else lives
    in. See "The Tutorial" for the split and for why it is two screens rather than one.
  - `Coach` → the guided tour: an overlay that dims a screen, rings one control at a time and taps it
    with a pointing hand. Two chapters, one over the menu and one over a board, and it knows about
    neither — the opener publishes the rectangles. See "The Guided Tour".

  New scenes must be added to the `scene: [...]` array in `src/config.ts` to be registered with
  Phaser, and a new *overlay* scene must also join `platform/lifecycle.ts`'s `OVERLAY_SCENES`.
- `src/board/` — the playing field. `layout.ts` is pure geometry (no Phaser); `boardView.ts` is the
  baked board and the single interactive layer; `discView.ts` is the disc sprites, driven from
  `src/sim/`; `discTextures.ts` generates their art at runtime from `emblems.ts`'s Phaser-free
  geometry (so `npm run sheet:branches` can draw the identical shapes under plain node — see
  "Skins"); `aimView.ts` draws the
  slingshot. See "Board Geometry", "Rendering the Discs" and "Aiming" below.
- `src/game/` — the game's own rules and economy as plain data, all Phaser-free: `rules.ts` (the
  `RuleSet` flag object of §3), `formations.ts` (where the discs start), `economy.ts` (catalog,
  payouts, which skin is in force), `wallet.ts` and `persistence.ts` (the two thin layers that feed
  those pure functions the live save and write the result back). See "Game Layer" below.
- `src/sim/` — the deterministic fixed-step disc solver (`types.ts`, `step.ts`, `shoot.ts`,
  `outcome.ts`, `aim.ts`), with no Phaser import, for the same reason `board/layout.ts` has none.
  See "Simulation" and "Aiming" below.
- `src/bot/` — the opponent: candidate generation, evaluation, difficulty-as-noise. Also Phaser-free.
  See "The Bot" below.
- `src/daily/` — §7's one-shot daily puzzle: the generator and its solvability proof, the committed
  catalogue reader, and the streak. Phaser-free. See "The Daily Puzzle" below.
- `src/assets.ts` — every asset key and atlas frame name, the one place the strings
  `scripts/make-atlas.mjs`/`make-audio.mjs` write and the strings the game reads may meet.
- `src/gameTheme.ts` — this game's palette and display font, as concrete values. Separate from
  `main.ts` because `config.ts`'s `backgroundColor` needs the same value at module-import time,
  before any `setTheme()` call could have run.
- `src/platform/yt.ts` — YouTube Playables SDK wrapper. See "YouTube Playables Wrapper" below.
- `src/platform/input.ts` — abstract input-action mapping (mouse/touch/keyboard → one callback per action).
  See "Input Actions" below.
- `src/platform/lifecycle.ts` — `bindGameplayPause(game)` freezes/unfreezes gameplay scenes on
  `YTEvents.PAUSE`/`RESUME`, arbitrating with `Settings`'/`Shop`'s own pause ownership. See "YouTube
  Playables Wrapper" below.
- `src/platform/health.ts` — global error capture with dedup and a ring buffer. See "Health Monitoring"
  below.
- `src/platform/adGate.ts` — the only allowed entry point for showing ads. See "Ad Gate" below.
- `src/ui/speechBubble.ts` — **the comic bubble both speakers use**: the picked opponent in
  `Opponents` and the mascot on the menu. One component rather than a copy per screen, because two
  copies of "fit a rounded plate around a growing line and hang a triangle off it" is two places for
  the radius, the tail and the ink to drift apart. Two rules:
  - **It owns the LOOK; the caller owns the PLACEMENT.** Where a bubble goes is a question about the
    screen it is on — beside a scrolling card, above a character standing in a corner — and no shared
    component can answer it. `size()` exists for the caller's half: the plate is derived from the
    text, so a caller deciding whether it fits above something has to be able to ask first.
  - **Redrawn per revealed character**, pumped from `speechLine`'s `onGlyph`. The plate is fitted to
    the text and the text grows as it types; a plate sized once for the finished line is a bubble
    that appears at full size around a single letter.
  - **The tail hangs off any of the FOUR edges** (`BubbleEdge`), and aims at a point rather than an
    x — `'bottom'` means the tail is on the plate's bottom, i.e. the bubble is above the speaker.
    Two sides were enough while the only bubble spoke upward; they stopped being enough the moment
    one had to move sideways to get out of the way of a button. `BUBBLE_TAIL` is exported for the
    same reason: **the tail's reach is part of the bubble's footprint**, and a caller that measures
    only the plate will place it wrong by seven pixels — which is exactly how the menu's bubble came
    to clear the button column by 4px on one phone and overlap it by 10px on another.
  Light plate, dark ink — the inverse of every other surface in the game. A bubble is a different
  KIND of object from a card or a panel, and inverting it is how a comic says so without a label.
- `src/ui/mascotView.ts` — the menu character, and the reason it is a component rather than an
  `add.image` call: **it moves.** A bob (a fraction of its drawn height, so it breathes by the same
  proportion at every size), a slow tilt on a period that never lines up with the bob, a blink, and a
  squash-and-pop when the player pokes it. Two rules to keep:
  - **The idle runs on the SCENE clock, never on tweens.** `Phaser.Time.Clock` stops with the scene;
    the TweenManager does not, so a tweened idle keeps breathing underneath a paused game and an open
    Settings panel. `react()` is the one motion allowed to be a tween — it is a 260ms one-shot the
    player triggered and it cannot outlive the press that started it.
  - **The blink is a second TEXTURE, derived from the first by arithmetic** — see `MASCOT_BLINK_KEY`
    and `ART-SOURCES.md`. A second SDXL render of "the same character with its eyes shut" is a
    different character.
  The poke is bound to the character itself rather than to a menu button because all three buttons
  leave the scene: a reaction bound to one of those plays to an empty screen.
  **Its bubble goes above the head where there is room and BESIDE it where there is not**
  (`MainMenu.drawMascotBubble`), and that fallback is not a nicety — a bubble must never cover a
  control, and the band between the hat and the lowest button is 104px on a 430x932 phone but 55px
  on a 360x780 and **34px on a 320x700, against a bubble 42px tall**. There is genuinely nowhere
  above the head to put it there, so clamping downward cannot help; the bubble goes right of the
  head instead, where the column has already ended. Two things that look optional and are not: the
  fit test counts the TAIL (see `BUBBLE_TAIL` above), and the sideways placement aims at the FACE
  (`MASCOT_FACE_FRACTION`), not at the sprite's top corner — the hat is the narrowest part of the
  picture, so a bubble level with it reaches across a hand's width of empty background and reads as
  belonging to nobody. Measured over every line x nine viewports from 320x700 to 1920x900: zero
  overlaps with any button, zero off-screen, worst clearance 8px (the margin itself).
  **And the CHARACTER itself keeps the same clearance, which took a second pass to arrive at**
  (`MainMenu.layoutMascot`, `MASCOT_BUTTON_GAP`). All that care went into the bubble while the sprite
  under it was drawn straight through the Daily button on every short portrait phone — measured, it
  crossed by 26px at 320x568, 23px at 360x640 and 25px at 375x664. The cause is the sizing rule:
  0.3 of the SHORTER side is the width on any phone taller than it is wide, so the character is the
  same 96-115px whether the band under the column is 170px or 70px. It is now capped against the
  lowest button and **the character is what gives way** — the same rule that drops the wordmark when
  the column will not fit, since a decoration must never be drawn over a control. Two halves of that
  are load-bearing: the cap applies only when the character actually stands UNDER the column (in
  landscape the stack is off to the right, and capping there would shrink a character nothing is near),
  and it is placed AFTER the stack has been laid out, because where it may stand depends on where the
  lowest button ended up. That reordering also fixed the bubble's own floor test, which had been
  reading the PREVIOUS pass's button positions. Below `MASCOT_MIN_SHRINK` of its wanted height the
  character is hidden rather than drawn as a smudge; no targeted viewport reaches that (the worst is
  0.66 at 320x568), and `tests/platform/layout.test.ts` asserts it does not.
- `src/game/mascotChat.ts` — **what it says when poked, and how fast it tires of it.** Pure policy
  and content, no Phaser, so `verify:content` exercises the escalation in plain Node.
  - **The joke is the ESCALATION, not the lines.** One pool answers the first poke well and the
    tenth badly — a character equally delighted to be prodded for the ninth time is a soundboard.
    Three tiers (amused, pointed, genuinely indignant), then it stops answering for a few seconds and
    comes back with one line about it.
  - **Nothing ever runs out.** Every poke gets a line — the tiers rotate modulo their own length, so
    a burst long enough to exhaust one comes round to its first again, and the sulk ANSWERS (`Hmph.`,
    `No.`) rather than falling silent. A silent poke is indistinguishable from a broken button, and
    it reads as a character that has run out of things to say rather than one that has decided to
    stop saying them. `verify:content` pokes it two hundred times without a pause and asserts not one
    of them comes back empty.
  - **It has its own voice**, `plummy`, added to `scripts/make-voice.py` for it — the eighth profile
    and the only one no opponent uses. It borrowed the marshal's `burble` at first, and a character
    that talks in another character's voice is a character the ear files as that other one.
  - **The bubble is anchored to its REST position, not to where the bob currently has it.** One that
    followed the breathing would want redrawing every frame — a `Graphics.clear()` and six draw calls
    at 60fps for a wobble of a few pixels — and at that amplitude the tail and the head read as
    connected anyway.
  - **No clock in the module.** A burst ends because the NEXT poke arrives late, not because time
    passed while nobody was looking — every transition happens on a poke, from a timestamp the caller
    passes in. Same shape as `daily/streak.ts`, and it is what makes the whole thing testable without
    faking a clock. (The check for it was wrong first: relative hops from the sulk's start overshot
    it. Absolute times measured from the poke that triggered the sulk.)
  - The lines are **English-only**, on the same line the opponents' barks are: what a player READS to
    make a choice goes through `t()`, flavour heard once while looking at a face does not.
- `src/ui/flyingDiscs.ts` / `src/ui/titleLockup.ts` — the menu and loading screens' own furniture,
  and both are CODE for reasons that are facts rather than taste. **The discs move**, and motion is
  the one thing about this game a still image cannot state; they also draw from the live
  `PieceSet`, so the menu wears the equipped wardrobe. **The title is localised** (`en`/`es`, parity
  enforced at compile time), so a baked wordmark would be an English-only wordmark — and diffusion
  models cannot set type anyway, which this project measured rather than assumed. Placement in the
  discs is stratified, not random: independent uniform samples clump, and discs on one plane share a
  speed so an even start stays even. They cover the FULL width — an earlier version confined them to
  two side bands so they could not compete with the buttons, which was wrong twice over: the buttons
  are opaque plates, so a disc behind one is invisible rather than competing, and the bands left a
  conspicuously dead middle, which the eye finds faster than it finds the pattern. See both files' headers.
- `src/ui/` — a themeable, palette-driven widget kit (buttons, rows, badges, panels, layout
  helpers, image previews, font loading). See "UI Kit" below. `scrollRegion.ts`/
  `scrollMomentum.ts` are a separate, self-contained pair for building a scrollable
  list/strip — see "Scroll Patterns" below.
- `src/i18n/` — the `t()`/`getLocale()` localization layer, `en`/`es`, with compile-time dictionary
  parity. See "Localization" below.
- `src/shop/` — the coin-balance + catalog mechanism behind the `Shop` scene. The catalog itself is
  this game's, in `game/economy.ts`. See "Shop Layer" below.
- `public/assets/` — static game assets, served at `/assets/...` and referenced via
  `this.load.setPath('assets')` in `Preloader`. **The atlas and the sound set are generated, not
  painted** (`npm run assets` / `npm run audio`) and both are committed. The atlas is this game's,
  not the draughts one it started as: fifteen frames (`icon-coin`, `icon-sound-on`/`-low`/`-off`,
  `icon-home`/`-shop`/`-modes`/`-gear`, `icon-retake`/`-power`, `icon-hand`, `rim-strip`,
  `rim-corner`, `particle-spark`, `particle-shard`) totalling 20.6 KB — the nine icons joined it when a phone drew
  the UI's emoji as tofu, see "UI Kit" — — the discs themselves are drawn at runtime
  by `board/discTextures.ts` and were never atlas frames. **The SOUND set still carries draughts cue
  names** (`promote`, `capture`, `move`), used for their roles in THIS game with the mapping written down
  in `src/assets.ts`; renaming them is a `make-audio.mjs` pass that needs `ffmpeg` on PATH, which is
  the only reason it has not happened.
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
  before `new Phaser.Game(...)`) — see "Localization" below. Every scene's copy now goes through
  `t()`; the one deliberate exception is the `⚙` gear glyph, which is not language. `index.html` is
  still `<html lang="en">`, a static attribute unrelated to in-game `t()` resolution.

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
  - **Never from a number large enough to look infinite.** Three full-page scenes drew their plate
    as `add.rectangle(0, 0, 4000, 4000).setOrigin(0.5)` and shipped: centred on the world origin
    that covers x and y in [-2000, +2000], so a window wider than 2000 CSS px ended in a hard
    vertical seam with the canvas clear colour beyond it — reported from a desktop, with the gear
    button sitting on the bare band. `ui/chrome.ts`'s `createPageBackground` is the fix and
    `tests/platform/layout.test.ts` is the guard. 4000 was a guess about how big a screen gets, and
    guesses about that expire.
  - **A minimum is not exempt from the space it was measured against**, which is the same mistake
    one level up. All three scrolling lists computed their height as `Math.max(80, bottom - top)`;
    in landscape, where the two bars eat half the screen, that granted the list pixels the screen
    did not have. Measured: the shop's list ran 38px past the nav bar at 740x360 and 8px past it at
    844x390 — and since a later camera OWNS its viewport's pixels (see "Scroll Patterns"), the bar's
    icons were ERASED rather than covered. `ui/scrollRegion.ts`'s `listHeightBetween` states the
    rule; when the space left is too small to use, the layout gives something up ABOVE the list
    (`Modes` drops its section heading, which the nav bar already says) rather than overrunning what
    is below it.
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
- **Game field vs. UI — two-camera split.** `Game` renders both the board (world space) and the HUD
  (screen space) in one scene, and the two need opposite behaviour under resize: UI must ignore the
  world zoom, board content must not. `cameras.main` is the WORLD camera — `setZoom(fit.zoom)` +
  `centerOn(boardW / 2, boardH / 2)` every `layout()`, from `board/layout.ts`'s `computeBoardFit`.
  A second `uiCamera` (`this.cameras.add(...)`, resized to the full viewport every `layout()`, zoom
  always `1`) renders the HUD at an identity screen-pixel mapping. **Contract**: board objects live
  in board-space coordinates (`0..boardW`, `0..boardH`) and screen/pixel coordinates are never valid
  for them; every new HUD object must be added to `uiCamera`'s set and `cameras.main.ignore()`-ed,
  every new board object the reverse. An object in NEITHER ignore list renders in BOTH — which looks
  like a ghost board floating over the HUD, and has actually been seen. When the disc layer lands in
  S3 its sprites come and go every round, so the split has to be re-applied on every rebuild, not
  once in `create()`. This is not theoretical: the draughts project shipped its gear button through
  the zoomed world camera and it rendered near mid-screen instead of the corner — a test that only
  reads `x`/`y` cannot catch it, since those are untouched by which camera draws them.
- `Boot` is not on this pattern — it has no visual content. `Preloader` **is** on it (fixed
  after initially shipping without it — a fixed 468px-wide bar overflowed a 390px viewport,
  the one scene a certification reviewer is guaranteed to see): `layout()` clamps the bar to
  `min(468, width - 80)` so it never touches the screen edges, called from `bindLayout()`
  inside `init()` rather than `create()` — `preload()`'s `'progress'` events fire between
  `init()` and `create()`, so the bar has to exist and already be laid out before that, not
  after. The fill bar uses origin `(0, 0.5)` (not the default `0.5, 0.5`) so growing its
  `.width` extends rightward from a fixed left edge instead of symmetrically from a center
  point — the pre-fix version had the same fixed-position "grow from center" issue.
- **Safe area**: `src/ui/safeArea.ts`'s `safeAreaTop(width, height)` is the top margin every screen's
  first row of HUD starts below — 24px, plus 30px more in portrait. A fixed budget rather than a
  reading of `env(safe-area-inset-top)`: inside a cross-origin iframe that value is frequently `0`
  even when the host IS overlapping content, so trusting it would leave exactly the devices it
  protects unprotected. Both `MainMenu` and `Game` use it for the gear and the coin badge.

## Board Geometry

`src/board/layout.ts` is the whole geometry of the game and imports **no Phaser** — that is what
lets `npm run verify:fit` cover it under plain `node`. Anything positional that can be expressed
without a `Phaser.Scene` belongs here rather than in a scene.

- **The projection is orthogonal, and that is a decision, not a default.** `GAME-PLAN.md` §2
  cancelled the isometry inherited from the draughts project, and the reasons are all about this
  game specifically: in a diamond the mapping from a screen drag to a board direction is non-linear
  across the field, and here that direction IS the player's entire skill; distance-to-edge — the
  quantity every shot is judged by — reads differently near and far for the same real distance; and
  a diamond fills about half its own bounding box. Do not reintroduce it. §2 does leave one
  cosmetic door open (a uniform 0.9 vertical squash of the RENDER only, never the simulation), and
  that is the whole of what is allowed.
- **Board space IS Phaser world space**, with no offset — so `camera.getWorldPoint()` feeds straight
  into `screenToGrid()` or into an aim vector, and the fit zoom is inverted by Phaser rather than by
  this module. It is also the space `src/sim/` will integrate in: simulation space and render space
  being the same space is the main prize for dropping the isometry.
- **The grid exists, but the game is continuous.** Discs sit wherever the last shot left them and are
  never snapped to a cell. The grid is a ruler: it is how the board is painted, how §4's formations
  are placed, and how §2's radius/speed numbers are quoted. `isDarkSquare()` has exactly one gameplay
  caller — the cavalry formation, which sets up on the dark squares of two rows.
- **The board always fits whole; there is no zoom floor and no pan.** A square board binds on the
  viewport's SHORTER side, which is 390px on the target phone in *both* orientations — so an 8×8
  board is a 46.75px tile either way. `verify:fit` asserts this on four viewports rather than leaving
  it as a claim in a comment, because two other things rest on it: with no pan gesture to
  disambiguate against, a one-finger drag can belong to aiming outright (§2's trap 4), and with the
  whole board visible, "how close is that disc to the edge" is answerable by looking.
- `computeHudBands()` returns the two leftover strips the HUD lives in, which swap with the
  orientation (bands above/below in portrait, left/right in landscape). Keeping the HUD strictly
  inside them matters more here than it did in draughts: the entire board is a drag surface, so a
  control overlapping it is a control an aim can start on top of. `verify:fit` checks the
  no-overlap property directly.

`src/board/boardView.ts` is the Phaser half: it bakes the 64 squares and the gold rim into ONE
`RenderTexture` (64 live objects would be 64 display-list entries per frame for content that never
changes — and the frames that saves are the frames the solver and the bot search will want), and owns
the single invisible `Zone` every pointer gesture arrives through. Two things to know before
extending it: the zone is grown to the whole visible world, not just the board's box, because an aim
drag pulled BACK past the rim is the same gesture and must not be dropped; and the baked gold rim is
decoration only — `game/rules.ts`'s `bumperRim` is a rule about what the simulation does at the
board's exact edge and has nothing to do with those pixels.

**The board's palette is inverted from a draughts board, deliberately.** In draughts the board is
the playfield — you count cells, a piece stands in the middle of one, and high square contrast
helps. Here, after the first shot no disc ever stands on a cell again: the grid stops being a
set of arrival squares and becomes a **ruler**, which only has to say how far. So the two tones are
dark and close together (`#2f7186` / `#20596d`, replacing the draughts pair `#7ed2de` / `#286a85`,
whose own two tones differed in luminance by more than either differed from a disc). Dark also gives
the discs their contrast back: gold and violet are both light against this, where against the old
pair only the violet was. This is the most-looked-at surface in the game — check any change to it
against BOTH disc colours at a 37px tile, not on a desktop.

**There was a perimeter "danger band" and it has been REMOVED — do not add it back.** It was 0.75 of
a cell of darkening around the edge with a warm `#ff6a3d` hairline along its inner boundary, meant to
answer "am I about to lose this disc" to peripheral vision. Three reasons it went, in the order that
matters: it marked a threshold **no rule uses** (a disc is lost when its centre crosses the edge, at
zero, not at 0.75 — the most precise-looking line on the board pointed at nothing); it was redundant
with the projection, since §2 chose the top-down view exactly so distance-to-edge reads correctly and
`board/layout.ts` fits the whole board on screen in both orientations; and only half of it was ever
visible — the darkening was `voidColor` at alpha 0.2 over an already dark board, i.e. imperceptible,
so the hairline had no gradient to be the edge OF and read as a stray debug rectangle floating over
the playing surface, which is how it was reported. The generalisable lesson: **an aid drawn at a
position the simulation does not recognise is misinformation with good intentions.** If edge
proximity ever needs help again it has to be drawn at zero, where the rim already is.
`scripts/render-skin-sheet.mjs` mirrored the band and was updated in the same pass — a contact sheet
that disagrees with the product is worse than none, and this file has drifted that way once before.

**The "turn light" is gone too, and it is the SECOND thing removed from the perimeter for saying
something else there.** It was a coloured band just inside the rim on the active side's own edge,
doing two jobs with one pixel: whose go it is, and — by going out during a simulation — that taps are
being ignored. It failed at the first, and how it failed is the lesson: **a band drawn along the
board's edge is read as a description of the EDGE, not as a statement about the turn.** Reported as
"the yellow strip at the bottom is not needed, it is obvious that this is the edge" — not a complaint
about the colour, but the signal arriving as scenery. Both jobs already had better homes: whose go it
is, `Game.refreshStatus()` says in words ("Your shot" / "Opponent's shot" / an animated "Thinking..."
while the bot searches), and that the board is busy, the moving discs say themselves — `beginAim`
refuses on `isMoving` regardless, so nothing ever depended on the light being drawn.
`BoardView.setTurnHighlight` and `Game.refreshBoardState`'s call to it are both gone; the latter now
only feeds the disc counter. Rule going forward: the perimeter means "the drop", and a new signal
that means anything else must not be drawn on it.

## Simulation

`src/sim/` is the disc solver — the project's single largest technical risk (`GAME-PLAN.md` §10),
and the one module where a shortcut is most expensive. **Nothing here may import Phaser.** That is
what lets `npm run verify:sim` cover it under plain `node`, and it is also what makes the bot (§6),
the daily puzzle's solvability proof (§7), replays and `node`-run tests fall out for free instead of
each being a project of its own.

- **`types.ts`** — the `Disc`, the `SimState`, the `SimConfig`, and every constant. Units are
  **board-space units**, the same space `board/layout.ts` defines and Phaser renders in: a disc's
  `x`/`y` goes straight onto a sprite with no conversion. Each tuning number is written twice, once
  in CELLS (the form the plan states it in and a human can reason about) and once derived — change
  the cell value, never the derived one.
- **`step.ts`** — one fixed step, plus the accumulator (`advance`) that bridges 240Hz to whatever the
  display runs at, plus `renderX`/`renderY` for the interpolation S3 draws with.
- **`shoot.ts`** — `applyImpulse(disc, angle, power)` and `runToRest(state, config, { shot })`.
- **`aim.ts`** — the slingshot maths and the aim preview. Pure, so the numbers that decide how the
  game feels are tunable in one place and checkable without a browser. See "Aiming".
- **`POWER_CURVE` (in `types.ts`, and it is 0.6 rather than 1)** — `speed = maxSpeed * power ** k`.
  At `k = 1` the pull maps linearly to SPEED and therefore quadratically to DISTANCE, which is what
  the game shipped with and what §11's calibration pass replaced. Measured on the opening rank, the
  near enemy is 6.2 cells away out of an 11.57-cell full reach, so `sqrt(6.2/11.57)` = **0.73 of the
  pull bought nothing but arriving** and everything below that landed in empty board. At 0.6 the same
  долёт is 0.597. **Full power is a fixed point of the curve**, which is the whole reason this knob
  was chosen over speed or friction: it moves that threshold without touching what a full-power miss
  costs. `reachOf` and `applyImpulse` MUST use the identical curve or the aim preview promises a
  distance the shot does not deliver — they both read it off `SimConfig`.
- **`outcome.ts`** — what one shot did. Records raw EVENTS, not conclusions, because four separate
  chunks read it for different things: §5's combo counter (how many enemies went off), §3's
  `mustTouchEnemy` (whether any enemy was touched at all, including after a bank off your own disc),
  §5's trick points (the ORDER of contacts), §9's audio (the ENERGY of each contact — an impact
  sound that does not scale with the hit is how physics stops being believable), and §8's stack
  splitting (the largest impulse a disc absorbed). None of that is recoverable from a final board.

**Not Arcade Physics**, and `config.ts` has no `physics` block for that reason. Three disqualifying
problems, not preferences: at 60Hz a full-power flick moves 0.3 cells per frame against a 0.4-cell
radius and steps clean through a contact, on exactly the shots the game is about; Arcade separates
along AABB axes where a carrom game needs an elastic exchange along the line of centres, which IS
the mechanic; and a solver that is a pure function of its state is what buys the determinism above.

Decisions worth not relitigating:

- **Friction is Coulomb** — a fixed amount of speed removed per second along the velocity vector,
  zeroed when it would overshoot. Never `v *= k`. Viscous drag approaches zero without reaching it,
  which on screen is a disc that crawls for seconds after the interesting part of the shot is over,
  and in code is a `runToRest()` with nothing to terminate on. Coulomb also puts distance and
  duration in closed form (`d = v²/2a`, `t = v/a`), which is what lets the drag length be calibrated
  against the board by arithmetic; `verify:sim` asserts the solver matches that closed form to under
  1%.
- **A colliding pair takes the LARGER restitution of the two** (Box2D's convention). §4 gives planes
  0.98 specifically so they ricochet unpredictably; averaging would let a heavy tank damp that
  defining property away on contact.
- **Overlap is corrected in full**, not partially. Partial correction exists to stop bodies jittering
  under a constant force pressing them together, and nothing on this board presses.
- **One collision pass per step**, in disc-id order. At 240Hz a contact chain propagates one link per
  step — a twenty-fourth of a 60Hz frame, imperceptible — and a fixed traversal order is what keeps
  runs byte-identical. Momentum is conserved regardless of order anyway, since every impulse is
  applied equal and opposite.
- **Order within a step is `integrate → bounds → collide → bounds`**, and both bounds passes are
  load-bearing. See `step.ts`'s header.

The traps §2 named, and how each is handled:

1. **A disc leaves in the same step its centre crosses the edge** — otherwise it spends the next step
   still colliding with live discs while out of play, which gets reported as "it cheated". Note the
   deliberate asymmetry: a falling disc leaves when its CENTRE crosses (so it is still in play with
   half of it hanging over nothing, which is the tense position the game is played for), while in
   `bumperRim` mode a disc turns when its EDGE reaches the wall. Its velocity is NOT zeroed on the
   way out — S3 throws the falling disc with it — but `isMoving()` ignores dead discs, so a shot is
   never held open by one.
2. **Stacks are ONE heavier disc** with a second sprite riding on it (`Disc.kind`), splitting above
   `Disc.splitImpulse` into two ordinary discs. True verticality is never to be attempted. See
   "Branches of Arms".
3. **The renderer interpolates** between the two steps around the frame (`renderX`/`renderY`), or a
   fast disc shimmers at 120Hz.

**Measured, so S7 does not have to guess** (§11, item 2): one `runToRest()` on a full 16-disc board
costs **~0.16ms** on desktop (~157 fixed steps). A 600-candidate Hard search is therefore ~95ms of
work — comfortably under §6's ~0.2s paper estimate, and ~50 candidates per 8ms frame slice. Re-run
`npm run bench:sim` after any solver change, and re-measure on a phone before S7 fixes the candidate
counts.

## Rendering the Discs

`src/board/discView.ts` is the only place the solver's numbers become pixels. It **reads `SimState`
and never writes to it** — the solver is the authority on where a disc is, and a view that could
nudge a position would put the bot and the daily-puzzle generator (which run the same solver with no
view attached) on a different board from the player.

- **Every drawn position goes through `renderX`/`renderY`.** The solver runs at a fixed 240Hz and the
  display does not, and that mismatch is §2's trap 3. `verify:sim`'s "render cadence" section
  measures it rather than asserting it in prose: at **144Hz** the raw solver position has a relative
  jerk of **0.40** and the interpolated one **0.0097**; at **165Hz**, **0.63** against **0.0080**.
  At exactly 120Hz both are smooth, because 240 divides by it evenly — which is precisely why the
  test also covers the rates real high-refresh screens actually run at, where an un-interpolated
  240Hz state falls apart. Anything that draws from the solver must interpolate.
- **`Game.update()` passes `alpha` while moving and `1` at rest**, and calls `resetStepper()` when
  the board stops. Without that, the leftover fraction of a step is kept forever and every disc is
  drawn a little short of where the solver says it is — a gap that matters because aiming, the bot
  and the save all read the solver.
- **The shadow is a separate sprite at its own offset.** On a sliding disc the difference is subtle;
  on one tumbling off the edge it is the whole effect, because the shadow has to stay behind on the
  surface and die away while the disc keeps going. A shadow baked into the disc sprite falls with
  it, and the disc reads as a sticker. This is why `sim/step.ts` does NOT zero the velocity of a
  disc it removes — the fall is thrown with it, so a disc blasted off flies and one that dribbled
  over the line tips.
- **Discs share one depth and are never depth-sorted per frame.** Dropping the isometry removed the
  overlap that made sorting necessary: two discs cannot stack. A disc mid-fall is the one exception
  and goes above everything.
- **Placeholder art, generated at runtime** (`discTextures.ts`): round discs with an offset radial
  ramp, a gloss, and a soft contact shadow, drawn to the atlas generator's own palette and light
  direction so it does not read as a different game from the background. Textures rather than
  `add.circle()` shapes specifically so that S12b's swap to real atlas frames is a change of texture
  key and nothing else.
- **Sprite lifecycle**: `draw()` creates a sprite for any disc that lacks one and hands any disc that
  has left the board to the fall tween, then fires `onSpritesChanged`. `Game` re-applies
  `uiCamera.ignore()` on that signal — `Camera.ignore()` sets a bit on the object rather than
  appending to a list, so re-applying everything is idempotent and free.

## Aiming

Press one of your own discs, pull back, release. `sim/aim.ts` is the maths (pure, Phaser-free),
`board/aimView.ts` the drawing, `platform/input.ts`'s `bindDrag` the gesture, and `Game`'s
`beginAim`/`updateAim`/`releaseAim` the four lines that join them.

- **A slingshot, not a real flick**, and §3's reasoning is worth keeping: a genuine flick — a fast
  swipe whose speed becomes the disc's — gives a spread of power the player does not control and,
  worse, cannot REPEAT. A slingshot is readable while it is being made, cancellable, and identical
  under a thumb and a mouse. §3 leaves the real flick as a settings option for people who want the
  board-game gesture; it is not built.
- **The disc travels AWAY from the finger.** Getting this backwards produces a game that is playable
  but feels inside-out, so it has a test of its own.
- **The pull is measured in BOARD units, not screen pixels** (`MAX_DRAG_CELLS = 2.5`). The drag
  therefore scales with the board and the same pull means the same shot on a 390px phone and a
  1280px desktop; a pixel threshold would make it a different game on each.
- **Cancel is not a special case.** Bring the finger back toward the disc and power falls under
  `MIN_POWER`, at which point releasing does nothing — one rule, visible for the whole time it
  applies, which is what makes it safe to start a gesture at all.
- **The camera pulls back while a gesture is being made**, because the board leaves nowhere to pull
  to. `computeBoardFit` binds the board to the viewport's SHORTER side with an 8px margin, and a
  pull needs `MAX_DRAG_CELLS` = 2.5 of them — so on that axis there is no room, and *every* viewport
  has such an axis. Measured as the share of full power a disc on the rim can reach pulling straight
  out: a 390×844 phone gets 100% vertically and **27% horizontally**, the same phone in landscape
  the reverse, a square desktop window **23% both ways**. `Game`'s `enterAimCamera` tweens
  `cameras.main` to `computeAimZoom()` on press and back on release, which restores 100% on both
  axes everywhere while leaving the board full size at rest. `verify:fit` checks both halves — that
  the resting fit really is starved (a guard for a bug that had stopped existing would guard
  nothing) and that the aim zoom fixes it.
  - **Zoom about the BOARD's centre, never about the pressed disc.** Pinning the disc under the
    finger is the intuitive choice and it cancels the whole effect: if the disc does not move, the
    gap between it and the screen edge does not grow either, while `MAX_DRAG` in screen px shrinks
    with the zoom. Measured, that version took a rim disc from 23% to 22% — it did nothing. Letting
    the disc walk away from the edge is the entire mechanism.
  - Nothing about the aim maths is camera-dependent: the pull is `pointer − disc` in WORLD space and
    the camera appears in neither term. The zoom only changes how much screen there is to drag
    across.
  - **The aim camera keeps the panel's shift, and forgetting it broke two things at once.**
    `applyCamera` centred on `boardW / 2 - centreShift / zoom` and `enterAimCamera` /
    `leaveAimCamera` centred on the bare `boardW / 2` — so pressing a disc slid the board sideways
    UNDER the side panel (the far rank's last disc was drawn beneath it, and it is a disc you may
    want to shoot at) and left the background plate, still placed at the shifted centre, 120 world
    units short of the viewport. That gap was bare canvas, measured at `#3d1160` down the whole left
    edge and reported from a desktop. `focusFor(zoom)` is now the single formula all three callers
    use: **the shift is screen px, so it is a different distance in world units at every zoom**,
    which is the entire reason it cannot be a constant.
  - **The plate covers the UNION of the resting and aim views, not just the wider one.** Covering the
    wider view is not enough once the camera also MOVES between the two zooms. The union is exact
    rather than generous: both edges of the visible rectangle are monotonic in `1 / zoom`, so every
    zoom the tween passes through lies inside the two endpoints' union.
  - **The background plate is sized on the AIM zoom, not the resting fit** (`applyCamera`). It is a
    world-space object, so the camera scales it too — and this zoom goes OUT, which means the world
    rectangle on screen is at its LARGEST exactly while a gesture is being made. Sized on the resting
    fit it covered the viewport at rest and then came up short the moment a disc was pressed: the
    plate's own edges appeared as a rectangle a little bigger than the board with the flat canvas
    clear colour around it, so starting to aim made the background visibly end. Cover-fit is centred
    either way, so covering the largest case over-covers the smallest for free. Anything else added
    to the world camera as a full-bleed backdrop has the same obligation.
- **The gate is the whole of §2's trap 4.** A press only becomes an aim if it landed on one of the
  player's own live discs (`discAt`, with `GRAB_SLOP` because a disc is under the 44px touch-target
  minimum on a phone) and the board is at rest. With no pan gesture to compete with — the board
  always fits — that is the only thing separating an aim from an idle tap.
- **The aim line stops at the first thing the shot meets, or where the shot runs out**, whichever
  is nearer. `firstContact` is a ray test, not a simulation: it runs on every pointer move for
  nothing, and is *structurally* incapable of reporting past the first contact. That limit is §5's
  and it is deliberate — a full predicted trajectory solves the shot for the player and turns a game
  of touch into a game of reading a line. `reachOf` is the closed-form `v²/2a` the Coulomb friction
  buys us, checked against a real solver run so the preview cannot promise something the shot then
  fails to do.
- **`bindDrag` refuses multi-touch rather than interpreting it**: a press while another pointer is
  down never starts, and a second finger mid-drag cancels. A fumbled two-finger press must not be
  read as whichever finger landed first.
- One sound: the flick on release. The impact and knock-off cues of §9 — whose whole point is that
  volume and pitch scale with collision energy — are S10's, and half-doing them with a draughts
  sample would be worse than silence.

**A footgun worth knowing before S6:** `Impact.a`/`.b` are the pair in the solver's traversal order,
NOT shooter and target. A shot fired by a high-id disc lands in `b`. Use `involves()` / `otherIn()`;
reading `.b` as "the one that got hit" is right half the time.

## Round Rules

`src/game/round.ts` owns whose turn it is, how many shots they owe, and when the round is over. It
reads the board but never touches it: the solver decides where discs are, this decides what that
means, and the two meet in exactly one call — `resolveShot(round, rules, state, metrics, outcome)`.

§3 lists the flags but says nothing about what happens when two fire on the same shot, and those
combinations are ordinary rather than rare. Every such choice is made once, in that file, and tested
in `tests/gameplay/round.test.ts`:

1. **A penalty beats an extra shot.** Lose one of your own and the turn ends even if you also
   knocked an enemy off — otherwise the penalty is toothless exactly when it should bite. (The
   extra shot itself is off in every shipped set — see `extraShotOnKnockout` under "Game Layer" —
   so this interaction only fires for the arcade mode the flag is kept for. It is still tested,
   which is what stops the flag rotting while nothing ships with it on.)
2. **Penalties do not stack.** Losing a disc AND touching no enemy is still two shots for the
   opponent, not four; a double penalty is a spiral a beginner cannot climb out of.
3. **Knocking your own last disc off loses**, even if the same shot cleared the opponent. Someone
   has to lose a mutual wipe-out and it should be whoever caused it.
4. **The last-hope strike is sticky, and it only ever pays the loser.** It is checked while a side is
   down to one disc on its own back rank — and that side usually then loses every disc, so a check
   made at the end of the round could never fire. But sticky means the flag outlives the position
   that set it: a side pinned to one disc that then came back and *won* still carried it, and
   `summarise()` handed the next round's opening shot to the round WINNER — the exact opposite of
   the rubber band the rule exists to be. Found by `verify:balance`, not by reading: it was worth
   4.5 points of match-level first-shooter skew at Hard on its own.
5. **A forfeited shot clock is not a penalty**, and gives up the whole turn rather than one shot of
   an award. §5 offers the timer as a tempo device; charging two shots on top would make a mode meant
   to feel fast feel unfair.

Two flags are only half this module's: `bumperRim` is a physics question and lives in `SimConfig`
(it is the one rule flag that crosses into the solver), and `advanceOnCleanWin` is *earned* here —
`summarise()` reports `cleanWin` — but **acted on in S8**, because moving a formation forward needs
the other formations to exist.

`Modes` and `Opponents` are what make the rule sets and the cast reachable; without them three of
the four sets in `game/rules.ts` and fifteen of the eighteen characters would be code nobody can run.
They are two steps of one decision — the mode, then who you play it against — and the second names
the first so the halves cannot come apart. Choosing is immediate and persisted, and `Game` reads
both in `create()`, so a change lands on the next round started from the menu and never mid-round.

## Branches of Arms

`src/game/formations.ts` is §4, and §4 is the cheapest content in the plan: the original game
already contains five branches, and each is **one arrangement plus one mass number and one friction
number**. Five perceptibly different rounds out of one board, one solver and no new screens.

| Branch | Discs a side | Mass | Friction | Shape |
|---|---|---|---|---|
| Infantry | 8 | 1.0 | ×1 | one rank — the baseline the others are felt against |
| Cavalry | 8 | 0.9 | ×0.85 | dark squares of two rows; runs further, knocked off more easily |
| Artillery | 4 stacks | 1.8 | ×1 | wide and heavy; punches through, slow to get going |
| Tanks | 4 stacks | 2.5 | ×1.15 | battering ram, and short-ranged — but see the note below |
| Planes | 8 | 0.7 | ×1, restitution 0.98 | sparse and three rows deep; ricochets everywhere |

**`mass` is very nearly inert, and the table above oversells it.** Measured by
`npm run verify:branches`, not reasoned about: artillery's mass 1.8 against infantry's 1.0 changes
how far a struck disc travels by **−1.1%**, and free travel by exactly 0.0%. The reason is
structural rather than a matter of the numbers being too close — an elastic exchange along the line
of centres depends on the mass RATIO, and a round is always played with the same branch on both
sides, so the ratio is 1 whatever the mass says. Mass comes alive in exactly one place: after a
stack splits, where 1.8 meets two of 0.9. Restitution is nearly as inert in its current range
(planes' 0.98 against 0.92 is worth +5.8%), and for the opposite reason — the range is bounded above
by 1, so a branch can only be made distinct by moving DOWN.

**`frictionScale` is the only knob with a measured effect**, which is why it is the only one that has
been retuned (cavalry 0.70, planes 0.82, tanks 1.15, infantry and artillery 1.0).

**The character survived the edit but with less room, and that is the cost worth knowing.** Tanks'
free run went 8.2 → 10.0 cells against infantry's 11.5, so they are still the shortest-ranged branch
in the game (−13% where they were −29%) and `verify:branches` still passes every separation
threshold — but a further cut here would start dissolving what §4 calls "short range".

**Tanks went 1.40 → 1.15 when §11 changed the power curve, and the pair is now load-bearing.**
×1.40 was measured and right under the OLD quadratic curve; the moment `POWER_CURVE` became 0.6 it
was a stale number, and staleness here is expensive — at 400 rounds a side, tanks' first-shooter skew
is 64.0 ±2.4 on the old build, **84.8 ±1.8** with the new curve and ×1.40, and **57.5 ±2.5** with the
new curve and ×1.15. The mechanism says why this branch and no other broke: tanks' full reach is 8.2
cells against the 6.08 they must cross, so under the old curve the bot's middle powers could not
reach at all and a tanks round ran 12.2 shots of mutual flailing that DILUTED whoever went first. Do
not move either number without re-measuring the other —
`npm run verify:branches --branch tanks --skew-only --rounds 400 --curve X` does both arms from one
build. Changing mass to
make a branch feel different is work that does nothing. §4 of the plan holds the full table.

Three things about that retune are worth not rediscovering:

- **Friction trades against the first-move skew of §3, and the trade is steep.** Slipperier is safe
  or better — planes 1.0 → 0.82 took the worst-skewed branch in the game from 76.3% to 64.0%, tanks
  1.30 → 1.40 took 71.0% to 64.0%. Draggier is dangerous: artillery 1.0 → 1.25 cost **+11.5 points**
  and was reverted, which is why artillery sits on infantry's exact friction on purpose.
- **Skew is NOT a smooth function of ANY physics parameter.** Tanks measure 71.0 at friction ×1.30,
  64.0 at ×1.40 and 79.8 at ×1.55; artillery measures 60.0 at restitution 0.92, 75.5 at 0.82 and
  66.3 at 0.75 — a middle value 9-15 points worse than both its neighbours. There is no gradient to
  follow on either knob, so interpolating a safe value between two measured points is not
  conservative, it is a guess. Measure every candidate at the exact value you intend to ship.
- **Lowering `restitution` was tried as a second axis and rejected**, with the numbers in §4. It
  delivers what it promises (both stacked branches went from driving 2 discs of a queue to 3, since
  a dead hit passes momentum forward instead of bouncing back) and costs +6.3 to +15.5 points of
  skew, because a less effective shot lengthens the round — tanks at 0.60 went to 21.3 shots a round
  from 12.2. Do not re-run this experiment; extend `splitImpulse` or the formations instead.
- **60 rounds is not enough for this question**, and the default `--rounds` is not the guard's
  sample size. At 60 the same three edits reported +13.3 / 0.0 / −21.7 where 400 rounds give −0.7 /
  +11.5 / −12.3 — no verdict survived. Use `--branch` + `--skew-only` + `--rounds 400` and read the
  error the harness prints on the difference.

**One working axis cannot separate five branches**, and `verify:branches` reports artillery as FAIL
for that reason rather than because anything is broken: the branch cannot satisfy the travel
threshold (needs ≥1.25) and the skew threshold (needs ≤1.10) at once. Artillery and tanks are
separated from the singles by `kind: 'stack'` instead — a stack absorbs a hard hit by splitting, so
they drive twice as many discs of a queue and carry them a third as far. That standing FAIL is
deliberate and documented in §4; do not "fix" it by moving artillery's friction.

**Two travel tests, and confusing them produced a wrong finding once.** `verify:branches` fires into
a queue of touching discs ALONG the shot (`pierce`, the penetration claim) and into a rank ACROSS it
(`spread`, how much of a formation one shot disturbs). Discs in a rank sit a cell apart and are 0.8
cells wide, so a head-on shot cannot reach a neighbour and `spread` reads 1/5 for every branch by
construction — reading that as "nothing penetrates" is reading the ruler.

**Stacks are one disc, never two bodies** (§2's trap 2, and this is not negotiable). A stack has more
mass, a second sprite riding on it, and a `splitImpulse`; take a hard enough hit and it becomes two
ordinary discs of half the mass, which never split again. One level, no vertical axis, ever.

- **The split conserves momentum exactly**: both halves inherit the parent's velocity unchanged
  (`2m·v` before, `m·v + m·v` after), so a stack can never manufacture the energy to fling its own
  pieces across the board. They are placed overlapping and the next step's positional correction —
  which adds no energy — pushes them apart, which is also what a stack bursting looks like.
- Splits are **collected during the collision pass and applied after it**. Appending to
  `state.discs` while iterating it is a different bug every time the array happens to grow, and the
  pass snapshots its length so a disc created this step cannot also collide in it.
- `SimState.nextId` exists for this and only this: a disc created mid-round needs an id that has
  never been used, because ids fix the solver's traversal order.
- The threshold is derived, not guessed — see `STACK_SPLIT_IMPULSE`. `verify:sim`'s neighbour test
  in `tests/gameplay/formations.test.ts` sweeps closing speeds and asserts stacks start breaking at a
  *middling* hit, which guards against a threshold so low everything shatters or so high the
  mechanic is invisible.

§4 describes artillery as "pairs plus a gun on top" and tanks as "a triangle of three plus one
above". Those describe how pieces are physically piled on a real board, which §2 refuses to model —
so a stack here is worth exactly two discs and both branches field four. A literal four-piece tank
would leave a side with two discs, which is not a round.

**Every branch is now recognisable by looking, which three of them were not.** `BranchProfile.mark`
prints a stencil on the disc's face, from military map symbology: a crossed pair for infantry, a
single diagonal for cavalry, a chevron for planes. Artillery and tanks carry `'none'` and that is
not a gap — a stack's rider already sits exactly where a mark would go and would hide it, so those
two were already distinguished. Between `top` and `mark`, every branch has something to be known by;
before this, infantry, cavalry and planes differed by a 5% radius, which is to say they did not.

The mark is **baked into the disc texture**, unlike the rider, which is a sprite. A rider has to be
a sprite because it splits away from its parent mid-round; a mark never moves relative to its disc,
and a sprite for it would be 16 more display-list entries on exactly the frames the solver and the
bot search want. It also has to be **worth its own contrast on both sides**: the gold ramp falls a
long way from `mid` to `deep` and the violet one much less, so the same formula printed a crisp mark
on one side of the board and a faint one on the other — `MARK_DEEPEN` pushes toward the contour to
close that gap proportionally, without reaching the near-black that reads as a hole punched through.

**`advanceOnCleanWin` is earned in `round.ts` and spent here**: `buildFormation`'s `advance` option
starts a side one row further up the board. That closes the last loose end from S6.

## The Opponents

`src/game/opponents.ts` is the cast: **eighteen characters, and they replaced Easy / Medium / Hard.**
A character is DATA — a search budget, a shake, an evaluation bias, a HABIT, a name, a description, a
portrait frame, a voice profile and its lines. There is no per-character code anywhere in the game
and there must not be one; if a character ever needs a branch somewhere else, the thing it needs is
a new knob in that file, not a special case in the other one.

**What varies, and what deliberately does not.** §6's rule survives where it matters: **the search
is exact at every rung, and noise is applied afterwards to the shot it already chose.** No character
is made weak by being given worse shots to pick from — an easy bot that aims at the right disc and
misses reads as a person misjudging, one that chooses badly reads as a machine playing badly, and
players tell the difference instantly.

A row varies on four axes:

- `candidates` — how many shots it looks at. **Strength, but ONLY when nothing else is capping it,
  and two things routinely do.** Measured with `npm run tournament`: the gunner at 4° of shake went
  38.5% → 37.0% → 35.5% as its budget went 360 → 520 → 700, because past some amount of shake the
  search is already choosing a better shot than the hand can deliver; and the sapper went
  45.5% → 40.5% → 39.5% over 460 → 640 → 820 — monotone, so not noise — because a character with a
  `targeting` preference spends surplus budget on more ANGLES rather than more targets, and its
  preference is deliberately the worse play, so a bigger budget buys a more thoroughly executed bad
  idea. Raising this number to make a character stronger works for the marshal and fails for both of
  those; check what is capping it before reaching for it.
- `angleSigma` / `powerSigma` — how badly its hand shakes on the shot it chose. Strength.
- `weights` — a partial override on `bot/evaluate.ts`'s vector: what it is trying to ACHIEVE. The
  quartermaster takes almost nothing off the board and leaves every disc of yours nearer an edge;
  the cavalry captain trades every time a trade is on offer.
- `quirks` — `bot/search.ts`'s {@link BotQuirks}: HOW IT PLAYS, as opposed to how well. **The same quirk can be
  worth wildly different amounts depending on which end of a range it removes**: `powers` without the
  TOP cost the five characters that carry it 13 points of win rate (0.83 enemy discs a shot against
  everyone else's 1.25), while `powers` without the MIDDLE — the schoolteacher's hole — costs almost
  nothing, because the search wants full power nine shots in ten. A quirk's stated shape says nothing
  about its price. Which powers
  it will use at all, how wide a fan it looks through, and whether it goes for your strays or the
  middle of your formation.

**The fourth axis is what makes eighteen characters worth having over a slider.** With noise and
weights alone, opponent five and opponent six differ in how often they fluff and in what they are
counting — neither of which a player can see, learn, or exploit. A habit is visible within a round
and can be played against, which is what makes a rematch a different game rather than the same game
at a different difficulty.

**The cast is not an army, and six of the rungs exist to say so.** It was twelve military men, which
is a narrower world than a game about a table played in taverns has any reason to depict — this is
a bar game, and the people who are good at it are whoever plays it most. So the ladder now runs
through a fishwife, a watchmaker, a schoolteacher, a ferryman, a partisan and a chess master
alongside the soldiers, and three rungs that were always written genderless in the first person —
the cook, the medic and the sniper — are women, which cost one pronoun in one English description
and three Spanish nouns, because a role is not a gender and the lines were never gendered to begin
with. **None of it is decoration**: every new rung carries a habit the search actually performs and
`verify:content` measures, and each was chosen to be one nobody else already had — the fishwife
takes only what is already falling and only at full force, the watchmaker plays the narrowest fan in
the game short of the sniper, the schoolteacher has a hole in the middle of her power range, the
ferryman drives at the middle of your formation 22% too hard, the partisan looks widest of anyone
and then hits, and the chess master spends nearly the marshal's budget without ever using force.

**A character cannot cheat, and there is nothing in the shape that could.** No row can see the board
differently, take two shots, or be handed a better solver. Every quirk either removes options from
the character or biases it toward a worse one; none can add anything. Once a player suspects the
opponent is cheating, every good shot it plays reads as cheating too.

**A habit that removes every option which WORKS is not a habit, it is a handicap wearing one — and
five characters shipped that way for months.** `quirks.powers` restricts which of `POWER_LEVELS` a
character may consider, and the cook, the watchmaker, the quartermaster, the sapper and the
chessmaster are all barred from full force. Under the power curve the game shipped with, their
strongest permitted shot travelled **4.4 to 5.7 cells against the 6.2 cells between the two opening
ranks** — so not one of them could touch an enemy disc from a starting position, ever, on any board.
They sit on rungs 3, 6, 7, 13 and 16, i.e. across the whole ladder, which is why the cast was
reported from live play as feeling uniform and feeble: *"боты ощущаются одинаково, слабовато бьют
даже более средние, просто удар не долетает их"*. §11's `POWER_CURVE` fixes four of them outright
and the cook needed `powerScale` 0.88 → 0.95 as well (tanks' own ×1.15 friction makes that the
tightest board).

**`verify:content` now measures it**, and the shape of the miss is the lesson: every existing check
asks whether a quirk CHANGES what the search looks at, which is the right question about a habit and
says nothing at all about whether the resulting shot can arrive. The new check does a ray test to the
nearest enemy on each branch's opening and compares it against the closed-form reach of the strongest
power that character is allowed. Cheap — no solver — so it stays in `npm test`.

**A stated habit that does not reach the board is a lie in the content file, and three more of them
shipped that way for an afternoon.** `targeting` was a silent no-op for any character whose budget
was large enough to reach every enemy anyway — with the shortlist widened to all of them, the sort
order decided nothing, and a `'deepest'` character's measured mean distance-to-edge came out
identical to the plain search's. `aimSpread` was a no-op for any character whose budget only
stretched to ONE angle per target, because a cone of one sample is the same cone at every width.
Both had confident comments claiming otherwise. Two fixes and one guard came out of it: a character
with a targeting preference no longer spends surplus budget on more targets (it buys angles
instead), the drummer's and the sniper's budgets are set by the size of fan their quirk needs rather
than by their strength, and **`verify:content` now measures every quirk against the same character
with its quirks stripped** — comparing against a fixed baseline character does not work, because the
obvious one (the sergeant) has a one-sample fan of its own and nothing can measure narrower than
zero.

**`npm run tournament` measures the ladder rather than asserting it, and the first run moved four
characters.** Every character plays 200 rounds against a fixed `BOT_LEVELS` reference — a yardstick
rather than a round robin, because round-robin scores are relative to the FIELD and go stale the
moment one character is retuned, while `BOT_LEVELS` are guaranteed not to move. Each seed is played
twice with the opening shot swapped (§3's first-move skew is worth ~62 points, far more than any two
adjacent rungs differ by) and the branch of arms rotates with the seed. A second half duels each rung
against its own neighbour, which tests the ladder's actual claim for 17 pairs instead of paying for
153. Its output is a decision for a person, like `tune-weights.mjs`, so it is not a `verify:*` and is
not in `npm test`.

**Read the Spearman correlation, not the individual rows.** Two adjacent rungs cannot be resolved at
any affordable sample size — 200 rounds carries ±3.5 points — and do not need to be. The first run
scored **0.860** with 9 inversions outside two combined standard errors. Five coefficient fixes came
out of it — the third power for the five characters barred from full force, then the watchmaker's
hand, the gunner's, the schoolteacher's and the sapper's — and it now scores **0.983** with 2, every
drift inside +/-2 and rungs 8 through 13 exactly in place.

**The diagnostic that actually pointed at the fix was `enemy/shot`, not the win rate.** Every
character measuring below its rung was removing 0.83 enemy discs a shot against everyone else's 1.25
and taking 11.8 shots to finish a round against 9.5 — one number, one cause, five characters. A win
rate says a character is misplaced; the rate of the thing it is trying to do says why.

**Three things the first tournament exposed and did not fix**, all still open:
- ~~`gunner` shakes at 4.0° on rung 11~~ — **fixed, and the fix produced the most useful negative
  result in this file.** 4.0° was a rung-4 hand on rung 11 and it measured three places low, so the
  obvious repair was to buy the strength back on the axis that leaves the character alone: its
  budget. **It does not work.** 360 → 520 → 700 candidates moved it 38.5% → 37.0% → 35.5%, i.e.
  nothing, with a downward lean. Past some amount of shake the search is already choosing a better
  shot than the hand can deliver and the extra candidates are spent on precision thrown away
  microseconds later — so **`candidates` and the sigmas are NOT interchangeable strength knobs**,
  though this file has always described both simply as "strength". 3.0° at the original 360 gives
  46.5% and rung 11 is where it now sits, exactly.
- ~~`schoolteacher` measures four places high~~ — fixed at 3.4°/0.11 (was 2.6/0.08), and the reason
  she was high is the quirk-price asymmetry above: her hole in the middle of the range is nearly free,
  so her hand was carrying a rung it should not have. ~~`sapper` three low~~ — fixed at 1.4°/0.035,
  the only one of its three axes that moved it at all.
- `sniper` — deliberately budget-light and aim-heavy — measures 76.0% against the marshal's 77.5%,
  i.e. **the top two rungs are one rung**, and `cook` still measures below the two characters written
  under her because her weights (`ownLoss: -8` against `knockout: 2`) decline the trades that win
  rounds — the one character whose placement is limited by what it is TRYING to do rather than by what
  it can do. Both are still open.
- **`verify:content`'s "the shake never rises as the ladder does" tests only the first character
  against the last.** Recruit's 10.0° beats marshal's 0.6° under any arrangement of the sixteen in
  between, so the check passes while the shake rises five times on angle and five on power. The label
  claims monotonicity and the body claims almost nothing; that is the same defect class as the three
  quirks that shipped as silent no-ops. It is left alone deliberately rather than quietly widened to
  fit the current data — a threshold invented after the measurement is a threshold fitted to it.

**Easy/Medium/Hard still exist as `BOT_LEVELS`, and nothing in `src/` reads them.** They are a
measurement reference: `verify:bot`, `verify:balance`, `verify:branches`, `tune-weights` and the
daily generator all want a fixed, named strength that does not move when a character is retuned. If
they read the cast, every recorded number in this repo would shift the day somebody adjusted the
sergeant. **Do not retune those three to match a character.**

**The ladder is fixed by character, not by measurement.** `verify:content` asserts that the numbers
point the way the order claims (the top considers the most, the bottom the fewest, the shake never
rises), and when a character lands far from where it should the fix is its coefficients — never its
position in the array. A raw recruit does not become better than a marshal by measuring well. Note
what is deliberately NOT asserted: monotonic budget across the whole list, because `sniper` looks at
less than `gunner` and beats it on aim, and that trade is what makes it a different character rather
than a stronger one. **A budget can also be set by a QUIRK rather than by a rung** — the drummer's 96
and the sniper's 260 are both the smallest number at which their `aimSpread` has a fan to act on,
which is a different reason from either of the two above and is written on both rows.

**Inserting a character mid-ladder re-locks a rung for an existing save**, because the gate reads
"did you beat the one before this" and the one before this has changed. That was accepted when the
cast went from eight to twelve and again when it went from twelve to eighteen — the game is
pre-submission, so there is nobody holding a save — and it is the reason to think twice about doing
it again after release. `currentOpponent()` clamps a
stored id to the strongest reachable character, so the failure mode is a demotion rather than a
broken save.

**The unlock gate opens exactly one rung.** The first three are free; every one after opens by
beating *the one before it*, read from `SaveState.defeated` — a LIST, because "did you beat the one
before this" is a question a count cannot answer. Filed on a **match** win and never a round win: a
round is one of five, and unlocking the next rung for taking a single round would let a player walk
the whole ladder without beating anybody. A locked character is shown dimmed with what unlocks it,
never hidden — the opposite of the shop's rule about unsellable rows, and for the opposite reason: a
shop row that can never be bought is noise, while a locked character IS the progression.

**The cast is picked in `scenes/Opponents.ts`, a popup over `Modes`** — step two of starting a
match, after the rule set. It carried on the bottom of `Modes`' one scroll column until the two were
split; see that scene's own header for why, and for the camera-viewport clipping a scrolling dialog
needs. `game/opponents.ts` is still the only place a character is DATA, and the picker reads it.

### The Dialogue Voice

Four layers, and the rule that separates them:

```
scripts/make-voice.py     synthesis     build time, deterministic, no game code
audio/voiceRegistry.ts    DATA + MATHS  no Phaser import, so verify:content can check it
audio/dialogueVoice.ts    the MANAGER   per-line state: when a syllable fires, and shaped how
audio/audio.ts            OUTPUT        the only module that touches game.sound
```

**It sounded like a bad recording from underwater, and the cause was a missing THIRD stage.**
Source-filter theory has three parts — a glottal source, a vocal tract of formant resonators, and the
RADIATION from the lips — and `make-voice.py` had two. Radiation is a differentiator: it adds +6 dB
per octave across the whole spectrum, and without it a formant bank hands back the source's own
−6 dB/oct slope narrowed to three peaks. Measured on the delivered clips: **99.5% of a voice's energy
below 500 Hz**, 0.1% above 1 kHz, mean spectral centroid 813 Hz and 90% rolloff 1774 Hz. The third
formant — 2240–2550 Hz, the band that carries a voice's definition — had no source energy to resonate
and was in the table doing nothing.

**No runtime filter could have fixed it**, which is worth knowing before reaching for one: there was
nothing above 1 kHz to boost. `radiate()` is one line applied after the formant bank, and it changes
the SLOPE rather than lifting an empty band. A second, smaller cause was fixed alongside it — the
glottal source summed exactly twelve harmonics, so at f0 = 129 Hz it was band-limited to 1542 Hz; the
count now comes from a frequency ceiling instead, and is still a cap rather than a raw saw because
alias noise is what makes a synthetic voice sound like a modem. After both: **centroid 2029 Hz,
rolloff 5107 Hz**, and 33–49% of each profile's energy above 2 kHz.

**`make-voice.py` checks its own brightness**, because nothing else can: `verify:content` reads the
sprite's marker table and cannot decode Ogg, so a voice that got muffled would pass every check in
the repository — one did. The generator measures the mean centroid and rolloff of what it just built
and refuses to write a set below the floor. **It measures the VOICED part of each clip, and
measuring the whole one was a hole rather than a detail**: `radiate` is a stage in the voiced path,
while a consonant is broadband noise that lifts a centroid by itself. Measured — a set built with
`radiate` deleted, carrying the over-loud consonants described below, still came out at 1594 Hz /
4098 Hz and sailed past the old 1400/3500 floor. The check was passing on hiss. On the voiced part
the two states are unmistakable, 1478 / 3186 with radiation against 717 / 1538 without.

### The consonants

**Most of a consonant is heard in the vowel AFTER it.** The formants start where the articulation
was — forward for a labial, back for a velar — and slide to the vowel's own place over 45ms; that
transition is the strongest cue in the syllable that a sound is articulated speech rather than a
filtered buzz. It was absent: measured on the delivered clips, F2 moved **61 Hz** across a vowel's
onset, i.e. every vowel started parked at its steady state. With a per-syllable F2 locus and an F1
rising from a near-closed 280 Hz, it moves **402 Hz** on average and up to 1289.

**A stop's silence is not a pause, it is the consonant.** The plosive was a decaying noise puff
butted straight against the vowel, under a comment claiming a silence that was not in the code —
which is a click, not a stop. It is now a 22ms closure, a 6ms release and the aspiration after it,
the last of which is turbulence through the tract the vowel is about to use. The release is also
*high* — it is air escaping a small gap, and the old one-pole lowpass at 2600 Hz was pointed the
wrong way.

**The balance was inverted, and an amplitude constant is what let it happen.** The consonants
carried fixed multipliers chosen when the vowel was raw formant output; `radiate` then arrived to
fix the underwater sound, and being a differentiator it cut the voiced amplitude hard while nothing
rebalanced against it. Measured on the delivered set: nasals **+16.3 dB ABOVE** the vowel and
fricatives **+9.9 dB above**, so on 24 of 56 clips the loudest thing in the voice was a hum or a
hiss and the voice was normalised down underneath it. `CONSONANT_DB` states each kind's level in dB
under the vowel it actually leads into, applied in one place. Measured after, decoded in the browser
rather than in numpy: fricative **−21.0 dB**, plosive **−18.7**, nasal **−8.2**, with the burst
peaking 11 dB under the vowel peak and the closure 24 dB down — all inside the ranges running speech
occupies.

**Consonant length is taken out of the vowel, never added to the clip.** Every total is identical to
the millisecond, because the clip length is load-bearing: it is what makes one syllable's tail
overlap the next (see MIN_MS/MAX_MS), so lengthening a consonant at the clip's expense would have
quietly undone the overlap the set was just retuned for.

**The generator is deterministic and the ENCODER was not.** The docstring claimed a rerun reproduced
identical bytes; measured, two runs over bit-identical input samples differed in exactly 24 bytes —
the 4-byte Ogg stream serial in each page header and the CRC that covers it. ffmpeg's
`-serial_offset` does not pin it (it is added to a random value, not used instead of one) and
`-fflags +bitexact` does not touch it. `pin_ogg_serial` rewrites the serial and repairs the page
CRCs afterwards, which makes the claim true — two runs now agree byte for byte.

**`make-audio.mjs` had the same defect and carries the same fix** (`pinOggSerial`), because it ships
its seven cues through the same encoder and its own header made the same claim. A deliberate second
copy rather than a missing import: the two generators are in different languages. The rewrite is
lossless and that is measured rather than assumed — re-serialising `music.ogg` leaves the decoded
PCM bit-identical (same MD5) and touches exactly **232 bytes across 29 pages**, which is 4 of serial
and 4 of CRC per page and nothing else.

**The phonemes are synthesised at BUILD time, not from an `OscillatorNode` per syllable.**
`make-voice.py` is the formant synthesiser — a glottal buzz through two two-pole resonators per
vowel, shaped noise bursts and clicks and nasal hums for the consonants — which is the
oscillator-and-filter chain a runtime version would build, run once instead of per syllable. Three
reasons it stays there: a node graph per syllable is real work on a phone and syllables arrive in
chains of five to ten; `AUDIO-SOURCES.md` can go on saying *self-generated* because there is no file
to trace, only arithmetic; and `audio.ts` stays the one module allowed to touch `game.sound`, which
is what keeps the platform mute, the SFX slider and the one-voice-at-a-time rule in a single place.

**The arithmetic lives in the REGISTRY, not the manager**, and that is not tidiness: the manager
reaches Phaser through `audio.ts`, so nothing in Node can import it. Anything that can be got wrong
silently — the pitch curve, the syllable spacing, the minimum-syllable floor — belongs where
`verify:content` can see it. Two of those have already shipped broken.

**Two axes per character, deliberately orthogonal.** `Opponent.voice` is the TIMBRE (which seven
syllables come out of the sprite) and is shared between characters; `Opponent.cadence` is HOW they
speak — base pitch, how far the pitch wanders per syllable, how often one lands, and whether the
chain waits for a vowel. Two characters on one timbre and two cadences do not sound alike, which is
what stops eighteen opponents needing eighteen syllable sets. Four cadences: `measured`, `grumpy` (deep
and sparing), `cute` (high, quick, widest wander) and `robotic` (almost no wander, fixed interval —
the absence of both IS the character). Measured on one sentence: grumpy 5 syllables at −475 cents,
cute 9 at +88, robotic spread 401 cents against measured's 686.

**The contour is declination plus a terminal EVENT.** Every phrase sags as it goes — 250 cents and
3.5 dB from first syllable to last, in every language and whatever the phrase means — and that runs
UNDER the stress pattern, so a stressed syllable late in a line is still quieter than a stressed one
at the start. On top of it the punctuation of the source string picks one of three endings: `?` lifts
its final syllable 300 cents and cancels the loudness sag (and forces that syllable to be stressed —
a rise landing on a syllable 8 dB down and darkened is a contour in the numbers and not in the ear);
`!` front-loads, with a higher, louder first syllable and a sharp drop at the end; `.` is the plain
declination. Measured, first → last syllable: statement −3.4 semitones at −11.5 dB, question +0.5 at
0 dB, exclamation −8.2 from an onset 220 cents above the others. Three profiles, not one.

**`MOODS.driftCents` is a MODIFIER on declination, not the fall itself**, and getting that wrong once
cost a working question: leaving the old absolute drifts in place double-counted, a calm statement
fell 510 cents instead of 250, and the `?` lift could not climb out of it — the question still ended
three semitones below where it started, which is a statement.

**Syllables land on VOWELS, not on every Nth character.** Past its due point the chain waits up to
`vowelSeek` characters for a vowel rather than firing on whatever consonant is under it — that is
where a mouth opens. `vowelSeek: 0` disables the hunt, and that metronome is most of what makes the
robotic cadence read as a machine. Measured: `measured` landed 7/7 on vowels, `robotic` 3/8.

**It shouted, and the cause was dynamics rather than tone.** Reported as "криковато"; measured, every
one of the 56 clips peaks at exactly 0.620, with an RMS spread of 5.5 dB across the whole set and 1.5
to 2.9 dB within one profile. Conversational speech puts 10 to 20 dB between a stressed syllable and
an unstressed one — at 2 dB every syllable is delivered at full voice, and a run of equally loud
syllables IS shouting. The spectrum was never the problem: mean centroid 813 Hz and 90% rolloff
1774 Hz is warm, not strident.

The fix is a **stress model** in `syllableShape`, at runtime rather than in the sprite: which
syllable is stressed depends on where it falls in the phrase, not on which clip came up, and baking
levels into the clips would put loudness back in storage and take away the ability to move a stress.
**Four things move together** on an unstressed syllable — 8 dB quieter, 90 cents lower, quicker
(`stress-timed` is exactly that), and DARKER. The fourth is the one that is easy to leave out and the
one that stops it sounding like the same tense syllable played at lower volume: lowering vocal effort
physically tilts the spectrum, so an unstressed syllable also takes a high shelf above 2 kHz, in
proportion to how far its gain dropped. Measured through the real filter over all 56 clips: **334 Hz**
between the stressed and unstressed spectral centroid, against ~0 before.

The shelf is a `BiquadFilterNode` inserted once into the voice's own chain in `audio.ts` — nothing in
Phaser's per-play config can tilt a spectrum. It reaches into Phaser's node graph, so every step is
feature-detected and a failure restores the original connection: a missing tilt is a syllable that is
merely quieter, which is what shipped for months, where a broken insert would be silence.

**The stress pattern comes from the line's own hash**, not a global cycle: two lines of the same
length get different rhythms and one line always gets its own, which is what makes it a voice rather
than a slot machine. Every draw a line makes — the stress gaps, the syllable spacing, the pitch
wander — comes from that one seeded stream, because seeding only the pattern was a half-truth: the
spacing still varied, so the same line came out five syllables one time and seven the next and the
pattern landed on different words. Measured after: **10.9 dB** between the loudest and quietest
syllable of a real line, at the master bus.

**The pattern distribution has a floor no seeding can beat.** With stress every 2–3 syllables the
possible patterns over the first N positions are the compositions of N into 2s and 3s — 4 at N=6,
7 at N=8, 12 at N=10 — and two different gap sequences collide on the same 8-window, so the
theoretical maximum share is 25% at N=6 and N=8 and 12.5% at N=10. Measured over the game's own 453
lines: 28%, 23.6%, 12.7%. The hash is uniform and reaches that ceiling; a target below 20% is only
available from ten syllables up, and the game's lines run two to nine.

**A very short line used to barely make a sound.** The chain steps in MILLISECONDS, which is right on
a long line and on `"No."` fired a SINGLE 150ms syllable — one blip is easy to miss altogether, and a
character whose reply you did not hear is a character with no voice, which is exactly how it was
reported. `syllableStepGlyphs` floors it at `MIN_SYLLABLES` by shortening the step for short lines
only; long lines keep the spacing their mood asked for.

**Syllables OVERLAP; they used to be separated by silence.** 140–150ms clips on a 215–290ms step
left 65–140ms of nothing at every boundary, which is what "blippy" means — a row of separate events
rather than an utterance. Three things had to change together: the clips are 262–282ms (longer than
the step, so a tail is still sounding when the next syllable starts), `audio.ts` keeps a POOL of
voice instances instead of one retained sound (one instance can only cut, never overlap), and the
next syllable is scheduled from its DUE point rather than from where the last one actually fired —
the vowel hunt can hold a syllable back up to three characters, and measuring from the fire point let
that delay stretch the following gap as well, paying for the hunt twice. Measured over 2017 real
syllable boundaries: silence at **17.2%** of them, down from 100%, mean overlap 96ms. One real line
now produces three audible bursts where it produced six.

**The pool size is measured, not picked.** Concurrency is the longest clip over the shortest step:
the shortest any cadence and mood can reach is two characters of the 42ms reveal, 84ms, and the
longest clip spans 3.36 of those, so the arithmetic bound is four. Driving all twelve cadence-by-mood
combinations through the real manager gave three. The pool is five — the bound plus one spare, which
is what absorbs a clip still ringing when the round-robin comes back to its slot. `stopVoice()` stops
EVERY slot, because the rule the single instance used to enforce for free is that a replaced line
must not go on talking over the one that replaced it.

**The phrase's duration is untouched by all of this.** It is set by the typewriter, and the earlier
"slower, please" was about that. The gaps BETWEEN syllables are a different knob, and conflating the
two is what produced blips: the fix removes the silence without changing how long a line takes to
say.

**`playLetterSound` is pumped by the typewriter, never by a timer.** `ui/speechLine.ts` calls it for
every character it reveals, passing the CHARACTER (the vowel hunt needs the letter, not an index) and
whether that character closes the sentence (so a rising or falling contour has something to arrive
on). An independent timer drifts against the reveal within a single line, and a fraction of a second
either way is the difference between a mouth moving and a mouth dubbed.

### They talk

Three modules, split the way the audio layer already is — policy, view, output:

- **`game/speech.ts`** decides WHEN and WHICH. At most one line per three shots, counted in SHOTS
  rather than seconds so the limit holds identically through the bot's fifth-of-a-second search and
  through a player who thinks for a minute. Three rather than a grid game's five, because a round
  here is about ten shots: at five a character would get two lines a round and half of them would
  be the hello. **A disc leaving the board gets a SHORTER cooldown, not an exemption**
  (`LOUD_COOLDOWN_SHOTS`, two shots). It used to bypass the limit outright, and in a branch where
  discs come off in twos that is a character commenting on literally every shot — the
  stream-of-text failure the limit exists to prevent, arriving through the door left open for it.
  What makes two shots affordable is that **the FACE is not rate-limited at all** (see below): the
  character visibly flinches every time, it simply does not always have something to say. Lines
  ROTATE rather than being drawn at random (with three alternatives a uniform pick repeats about a
  third of the time), per trigger, so hearing all three "I missed" lines does not use up the "I took
  one" ones.
- **`ui/speechLine.ts`** types the line in one character at a time. **Not a bubble**, and that is a
  decision rather than an economy: every pixel of this board is a drag surface for aiming, so a
  plate floating over it would sit on the one surface the player is about to gesture across. The
  line lives in the HUD band under the status. Note `stop()` versus `hide()` — Phaser's
  `DisplayList` destroys every game object on `SHUTDOWN` *before* a scene's own handler runs, so
  `setText()` from a shutdown path throws and takes the whole game down with it.
  **The row holds exactly TWO lines and nothing used to say so.** It is reserved rather than
  measured — which is right, since the priced buttons under it must not jump every time a character
  speaks — and that makes the overflow silent: a line that wraps to three is drawn over those two
  buttons, on every phone at once. Measured in a real browser, two lines hold up to **58**
  characters and **63** is three; both numbers are the same at 320x568 and at 430x932, because the
  wrap width and the font size both come off `uiScale`, so a CHARACTER budget is viewport-independent
  and can be enforced in plain Node. `verify:content` does, at 56, against a cast whose longest line
  is 47.
- **`audio/dialogueVoice.ts`** + **`audio/voiceRegistry.ts`** + `make-voice.py` are the pseudo-voice
  — gibberish speech in the Animal Crossing / Graveyard Keeper manner. **It plays wherever a
  character speaks**: the board, the opponent picker on a tap, and the menu mascot on a poke, the
  same policy in all three. See "The Dialogue Voice" for the layering, the contour and the two
  per-character axes. **The sync
  IS the illusion, and it is why the voice is PUMPED rather than timed** — an independent timer
  drifts against the reveal within one line, and a fraction of a second either way is the difference
  between a mouth moving and a mouth dubbed. So the line calls `glyph()` per revealed character and
  babble decides when that means a syllable. Three moods (`calm` falls, `triumph` holds its level,
  `alarm` rises fast and wide) carry what the words cannot: most players will not read a line
  mid-shot, and a character that says "you took my last disc" in the tone it says "I missed" has no
  reaction at all. Two numbers there are load-bearing and counter-intuitive — the pitch drift and
  the alarm rise both have to BEAT the ±138-cent per-syllable jitter to exist as a trend at all.

**`onPicked` is the twelfth trigger and the only one that fires OUTSIDE a match** — the player tapped
this character's card in `Opponents`, and it answers in its own voice. Separate from `onMatchStart`
rather than reusing it, because the two are different moments: `onMatchStart` is said to a board with
the discs already laid out, and this is said to somebody deciding whether to pick you. It is not
rate-limited, unlike everything `game/speech.ts` governs — that limit exists because a character
commenting on every shot becomes a stream of text over a board the player is trying to read, and this
is a deliberate tap on a face where the line IS the answer to it. **A LOCKED card answers too, with
its face**: `reactPortrait(alarm)`, because a tap that does nothing at all is indistinguishable from
a tap that missed, and this one has not missed.

**It speaks in a BUBBLE beside its own face** (`ui/speechBubble.ts`), and that is the second attempt.
The line first went in the note's row at the top of the panel, which was wrong twice over: it covered
a line of text that was still saying something useful, and a quip printed at the far end of the
dialog from the face that said it does not read as that face speaking. The bubble lives in the scroll
REGION rather than on the panel — it is positioned in list coordinates, scrolls with its card, and is
clipped by the same viewport the cards are. **Above the card, aligned to the portrait's own column,
tail pointing down at the face**: above, because the description sits to the RIGHT of the portrait
and a bubble anywhere over that column covers the thing the player is reading. It flips BELOW when
the card is too near the top of the list for one to fit above — the first card always, and any card
scrolled up to the edge.

**`Game.reactTo()` is the only place a trigger fires** during a match, reading the outcome that
already exists. A
character that spoke from the six places that could each notice something worth commenting on is a
character whose rate limit has six ways to be bypassed. The order of its tests is a priority: a shot
can be several things at once, and its own blunder outranks its own combo, because crowing about a
double while its own disc is still falling reads as not having noticed.

**`onPlayerBlunder` is the eleventh trigger and it was missing entirely**: you posting one of your
OWN discs off the board is the funniest thing that happens in this game, and the character used to
watch it in total silence. It is the mirror of `onOwnBlunder` and it is `triumph`, not `calm` — the
whole point is that it gloats. Tested after `onPlayerKnockout` for the same priority reason the
branch above it is ordered as it is: a shot that took one of ITS discs and cost you one of yours is,
from where it is standing, first of all a loss.

**The lines are English-only, and the names and descriptions are not.** `nameKey`/`descKey` go
through `t()` with `en`/`es` parity enforced at compile time; the ~240 spoken lines stay as raw
strings in the content file. That is a deliberate line: the names and descriptions are what a player
READS to choose, and the barks are flavour heard once. Translating them would be 480 more dictionary
entries carrying the parity guarantee, for text that is on screen for two seconds while the player
is looking at a disc.

### Portraits

`ui/portrait.ts`, one atlas, one frame per character, drawn wherever a character appears — the
picker, the result panel, **and the match HUD**, beside the status capsule. It was missing from the
last of those, which is the screen it matters on: the lines in the HUD arrived from nobody, and the
ladder the whole cast exists for was invisible during the only part of the game that advances it. Every
frame is the same 200×260 box with the figure at the bottom, so there is exactly one placement rule
and **no per-character offsets or sizes**: a portrait is positioned by one point (its feet) and
sized by one number (its height). Uniform scale only — two axes set independently re-stretch an
aspect ratio that is already correct. No circular mask: `setMask()` with a geometry mask is a silent
no-op under this renderer (see "Scroll Patterns").

**The face reacts — and it reacts to moments the character does not always speak at.**
`reactPortrait(scene, image, mood)` is a one-shot flinch (violet, a decaying shudder), gloat (gold, a
hop that grows) or nod (no tint), one per `BabbleMood`. The art is eight static renders with no
second frame per character, so the emotion lives in MOTION and TINT — which is the right trade
anyway, because movement is what catches the eye at the edge of the screen and a HUD portrait is
always at the edge of the screen. Two things about it are load-bearing:

- **It animates as an OFFSET from the anchor `placePortrait` records, re-read every frame.** The
  first version tweened `x`/`y`/`scale` directly and captured a "home" to settle back to;
  `Game.refreshStatus` re-lays the HUD out after every shot, which is exactly when a reaction fires,
  so the layout either killed the tween or left it settling the face onto an anchor the viewport no
  longer had. Reading the anchor per frame makes the two independent: layout owns where the face IS,
  the reaction owns how far it is currently displaced from there.
- **The running tween is tracked in a `WeakMap`, not killed with `killTweensOf(image)`.** The tween's
  target is the progress object — the image is only written from `onUpdate` — so a kill by image
  matched nothing and every reaction stacked on the last. The symptom was a portrait that never came
  back to rest.

**A portrait is drawn as large as its screen can pay for, and the bill is paid in TEXT WIDTH.** The
picker's column comes straight out of the description's, so a taller face wraps the copy onto more
lines and every card grows: on a 390px phone, 84 left 186px for the text and 112 leaves 166. 112 is
where the faces become recognisable rather than decorative, which is the whole reason the
cast is a cast; the cards are then set by the PORTRAIT rather than by the copy, which is also why
they all come out the same height. The HUD's own portrait grows UPWARD — `Game.layoutPortrait`
stands the figure's feet on the bottom of the reserved speech row — so a taller face reaches into the
empty part of the band instead of down into the consumable buttons.

**The picker draws a SLOT under each portrait, and it became necessary when they grew.** Every frame
is rendered on the card's own plum rather than cut to alpha, which is invisible while the two tones
match — and they stop matching the moment a card is selected, because a selected card is a lighter
plum. At 84 the mismatch was a thumbnail's worth of edge; at 112 it was a rectangle of the wrong
colour sitting on the card. Painting the slot in the frame's own tone makes it a framed picture:
deliberate at every size, and identical whether the card is selected or not.

They are SDXL renders, not computed — `Remotion/src/scripts/gen_chapaev_bots.py`, seeds in
`ART-SOURCES.md`, which also states why this is the widest exception in that file and where the line
still is. **A missing atlas degrades to a drawn stand-in** rather than breaking, and
`verify:content` says so out loud when it is in use; that fallback exists because the art is
generated in its own pass, and it should be deleted once nobody is waiting on a render.

## The Bot

`src/bot/` picks the opponent's shots. **No Phaser, and no minimax** — a carrom board has no move
list to branch over and nothing about an aim predicts its result, so the bot brute-forces candidate
shots through the same solver the player's shots go through (GAME-PLAN.md §6). That is only
affordable because the solver is a pure function over a cloneable state.

- **`levels.ts`** — the three difficulties, as three pairs of numbers. **Difficulty is not different
  logic, it is noise**: every level runs the same search and picks the same way, and what changes is
  how many shots it looks at and how badly its hand shakes on the one it chose. An easy bot that
  aims at the right disc and misses reads as a person misjudging; one made easy by choosing *worse*
  shots reads as a machine playing badly, and players tell the difference instantly.
- **`search.ts`** — candidate generation, the frame-sliced search, and the noise. The search is
  **exact at every level**; noise is applied afterwards, to the shot it already chose. It also owns
  `BotQuirks`, the cast's fourth axis — which powers a character will consider, how wide a cone it
  looks through, and which enemies it goes for. See "The Opponents" for why every one of them has
  to be measured rather than merely stated.
- **`evaluate.ts`** — §6's four weights (+3 knockout, −4 own loss, near an edge, +0.5 for closing),
  plus four the plan does not list and the bot is broken without: `decisive` (clearing the last enemy
  scores the same +3 as any other knockout, so without it the bot declines free wins on ties and
  walks into losses), `penalty` (a bot blind to a penalty trades a disc away for free; its
  `mustTouchEnemy` half is dormant now that no shipped set turns that flag on, its `ownOffIsPenalty`
  half fires in every set), and — added when §3 dropped `extraShotOnKnockout` — `wasted` (a shot
  touching no enemy used to cost nothing unless `mustTouchEnemy` was on; now it hands over the turn,
  so it is penalised unconditionally) and `expose` (how much closer the shot left the ENEMY's discs
  to the nearest edge, so driving a disc toward the rim without taking it counts as progress).
  `nearEdge` went −1 → −2.5 in the same pass: trading evenly is worse when the trade no longer also
  buys the turn.
  **The weights are chosen by playing them, not by arguing about them** —
  `scripts/tune-weights.mjs` (run directly, no npm script; it is a tuning tool whose output is a
  decision, not an assertion) sweeps candidate vectors against §6's fixed criterion, Hard beating
  Easy in 90+ of 100 rounds, every vector on the same seeds from both orientations. The shipped
  vector is `all-firm`. `npm run verify:bot` is what holds that decision in place afterwards.
- **`random.ts`** — the ONE place randomness enters the game. `src/sim/` may never touch
  `Math.random`; the bot must, because Gaussian noise is the whole difficulty model. It takes a
  seeded generator as an argument, so a tournament is replayable and a suspicious move can be
  reproduced from the seed the scene logs at boot.

**Candidate generation is where a bigger budget has to actually buy something**, and it is easy to
get wrong — this one was:

- Aim in a ±25° cone at the NEAREST few enemies, never evenly around the compass (fired uniformly,
  almost every candidate is a shot into empty board and the budget buys nothing).
- **The dead-on angle must always be sampled.** An even, evenly-spaced fan across the cone contains
  no zero — so raising the budget could make the bot stop considering the straight shot at an enemy,
  which is usually the best one. Sample counts are forced odd for exactly this reason. This was a
  real defect: it held Hard to 88/100 against Easy, under the 90 the plan requires; fixing it took
  Hard to 91.
- Samples cluster near the line (the cone parameter is squared): 3° off a straight line is a
  different shot, 22° off is much the same miss as 25° off.
- Over-long lists are trimmed by even STRIDE, never truncation — truncating keeps every candidate
  for the first few discs and none for the rest, so the bot would stop considering half its own
  pieces the moment the board got busy.

**Frame slicing** (§6): `search.step(budgetMs)` works until the budget is spent and reports whether
it is finished; `scenes/Game.ts` pumps it at 8ms a frame. Measured: a Hard search is ~504 candidates
over ~14 frames, ~100ms of work, worst slice 8.5ms — about a fifth of a second of "thinking", which
the move needs anyway to read as a decision rather than a twitch. The budget is milliseconds via
`performance.now()`, never a frame count, because the whole point is indifference to frame length.
Slicing changes only WHEN candidates are evaluated, never which or in what order, so a sliced search
and an unsliced one return the same shot — which is what lets the tests run it in one go.

**The absolute numbers drift between sessions, so A/B rather than compare against this file.** The
~0.16ms above was true when it was written; the same `bench:sim` on the same repo measured 0.22ms a
shot months later on a quiet machine. The way to answer "did my change slow the solver" is to run
both arms NOW — flipping `POWER_CURVE` back to 1 and re-running gave 0.242ms/shot against 0.221 with
it at 0.6, which settled the question in twenty seconds and could not have been settled by reading
this paragraph.

**Run any timing check on an idle machine, or it measures the other job.** `verify:bot` once
reported 147ms total and a 9.20ms worst slice — over §6's 8ms budget, and easy to pin on whichever
evaluation term had just been added. It was CPU contention from a `verify:balance` run in another
terminal; the same check on an idle machine gave 100ms and 8.26ms. This applies to `bench:sim` and
`verify:bot` alike, and it is the reason a regression here has to be reproduced before it is
believed.

## The Match

`src/game/match.ts` is best-of-five, one round per branch of arms. It sits directly on `round.ts`
and reads a `RoundSummary` — the round knows nothing about the match, and the match never looks at a
board. Five rounds is not arbitrary: it is exactly §4's five branches, so a match shows every one of
them once and nobody has to decide which to leave out. First to three ends it early rather than
playing out rounds that cannot change the result.

**The whole board is saved, not "which formation and who died".** Discs move, a match is saved
mid-round, and after a stack splits (§4) the board holds discs no formation ever placed — which
kills the derived-from-formation shortcut outright. `game/persistence.ts` writes match, round and
board as one record after every settled shot, so a reload loses at most the shot that was in the air.
It is written between shots and never during one: a board saved mid-flight would restore discs with
velocities the round has not accounted for, and the first frame after the reload would resolve a shot
the player never saw.

**`SaveState` v2 is the first real exercise of `migrate.ts`'s ladder.** A v1 payload simply lacks
`match` and `daily`, both of which normalise to "nothing to continue" — so v1 falls straight through
with no upgrade step and keeps its coins, skins, stats and settings. A saved match is also rejected
if its rule set differs from the one being started — the flags decide whether the turn passes and
whether the rim bounces, so resuming a board under a different set would silently change what the
player is allowed to do mid-match.

**A saved board with one side already wiped out starts the NEXT round rather than being adopted**,
and that is a fix, not a nicety. `finishRound` persists after `recordRound`, so what it writes is a
round that is OVER on a board that has just been cleared. `startRound` normally overwrites that a
moment later with the fresh board — but not if the player leaves from the result panel, or the tab
dies while it is up. Resuming that record put the player on a board with no opponent on it and a
round whose `winner` was still `null`: the HUD said "Your shot" forever with nothing to shoot at,
which is the "it froze after I won" symptom reached a completely different way. `Game.create`'s
resume branch asks `savedRoundIsOver(board)` and calls `startRound(match.first)` instead
(`tests/gameplay/save.test.ts` holds the predicate). Starting the next round
is the right recovery rather than dropping the match, because the SAVED match is already
post-`recordRound` — its `wins`, `roundIndex` and `first` describe the round that should come next,
so nothing is replayed and nothing is re-awarded. The test lives on the RESUME side, not the write
side, so it holds for every writer: `finishRound`, `leave()`, and `bindAutosave`'s `pagehide` flush.

`MatchResult` is one overlay for both the end of a round and the end of a match, because they are
the same moment from the player's point of view. Its callback runs AFTER the opener has been
resumed — firing it first would set up a round inside a paused scene, which then resumes into a board
it never drew.

- **After a match the player WON, the primary button is "next rival", not a rematch.** Winning is
  what unlocks the next rung (`game/opponents.ts`), so the panel announcing the win is the one
  moment the newly reachable character is worth pointing at, and a rematch is the rarer thing to
  want. It REPLACES the rematch rather than joining it as a third button: `MatchResult`'s own rule
  is exactly two exits, and a third one in a panel whose height is computed from its content is how
  a 390-tall landscape ends up with the round strip pushed off the bottom. Nothing is lost — the
  button opens the gallery, where the character just beaten is still listed.
- **And backing out of that gallery LEAVES.** `OpponentsData.onCancel` exists for this one caller.
  The gallery is opened over a board whose match is already over, so resuming it — which is what
  every other opener wants — strands the player on a screen that accepts no shot and has no result
  panel left to offer an exit. Same dead end the daily had before it got the shared top bar.

## The Board's HUD

**The portrait HUD block is FITTED to its band, not centred in it, and a short phone is why.**
`uiScale` reads the WIDTH — the right question for text and the wrong one for a stack of rows whose
room is whatever a square board left over vertically. Measured: the trailing band is 235px at
390x844 and 249 at 414x896, against a block (status capsule + reserved speech row + the two priced
buttons) that wants about 153. At **375x664** the band is 152.5 and at 360x640 it is 148 — so a
block merely centred in the band hung **0.9px** off the bottom of the screen with the two priced
buttons on it, under `layout.test.ts`'s own 1px tolerance, and the guided tour's ring around one of
those buttons — which stands 8px off whatever it rings — was cut in half. That is how it was
reported: a screenshot of the tour, not of the HUD.

Three things about the fix are worth keeping:

- **The scale is found by MEASURING each pass, not by one division.** A `Text`'s height quantises to
  whole lines, so the block does not shrink smoothly with the scale — the same finding as the side
  panel's button pairs, which came out a pixel over their own panel when the factor was computed in
  one shot. `measureTrailingStack` sizes the pieces and reports what they came to; `layoutHud` calls
  it up to three times.
- **`MIN_HUD_SHRINK` is a floor, and it means something.** 0.78 of `uiScale` is what 320x568 needs;
  below that the price on a consumable stops being readable, and a HUD nobody can read is worse than
  one that overhangs. A viewport that needs less than the floor is a band something has to LEAVE,
  not shrink into.
- **The block is centred where it fits and pushed off the bottom edge where it does not.** What is at
  the bottom of it is two tap targets; what is at the top is empty background. A tall phone is
  untouched — 390x844 lays out to the same pixel as before.

## Score, Combos and Feel

`src/game/scoring.ts` is §5, and §5's framing is the important part: **none of it affects who wins.**
Trick points are mastery on top of the rules; a player who ignores them plays the same game. The
moment a trick becomes the way to win, the rules have two masters.

- **Combos multiply.** Two knockouts in one shot score 400, not 200; three score 900. That curve is
  the whole reason a player lines a shot up through two discs instead of taking the safe one.
- **Three tricks**, all statements about the TRANSITION rather than about either board: a bank off
  your own disc before reaching an enemy (read from the impacts in order — which is why
  `outcome.ts` keeps them ordered), a shot taken with your last disc, and one that removed an enemy
  while leaving every one of your own in place.
- **The impact sound scales with collision energy** (§9's most emphatic instruction: a weak hit and a
  hard one sounding the same is where the physics stops being felt). Volume and pitch both ride the
  CLOSING SPEED rather than the impulse — impulse also scales with the masses involved, so a tank
  nudging something would be "loud" for the wrong reason. Contacts are sounded as they happen, one at
  a time, not replayed at the end.
- **A burst of sparks where a disc leaves the board**, tinted with the losing side's own ramp, so
  the loudest event in a round has something at the point of departure and says whose disc it was.
  Emitted as it happens (same drain-a-growing-list shape as the impact sounds, and for the same
  reason: three discs lost over four seconds should read as three losses, not one shower at the
  end), and half-sized for a pit, which swallows rather than throws. Two things it is easy to get
  wrong: it is **additive** — `particle-shard` carries the same thick dark contour every sprite here
  does, and at a fifth of a cell that contour is most of the shape, so normal blending reads as dirt
  scattered on the board — and it tints from the ramp's `mid`, because additive pushes `light`
  toward white on both sides and throws away the distinction the tint exists for.
- **Slow motion on the finishing shot** (§5): armed the moment the last enemy disc leaves, not when
  the board settles — the point is to watch it go over. It scales Phaser's clock AND the solver's own
  delta, which are separate: `advance()` is handed a delta directly, so slowing the tweens alone
  would stretch the falling-disc animation while the discs still on the board carried on at speed.
- The match total goes to `sendScore()` once, at the end of the match.

## The Daily Puzzle

`src/daily/` is §7: one board, one shot, clear it. This is the chunk that pays for the deterministic
solver more directly than anything else — the layout is generated from a date and then **proved**
solvable by running the same search the bot uses.

- **Generated ahead of time, not on a phone.** §7's generate-and-reject loop costs about four
  seconds of solver time per day. `npm run daily` does that work once and commits the catalogue;
  the game looks today's puzzle up. `npm run verify:daily` independently re-proves 30 days.
- **The reject rules are two-sided.** §7 gives the ceiling: if more than 15% of candidate shots solve
  it, the puzzle is trivial. It gives no floor, and it needs one — the first run of this generator
  happily produced a day whose only solution was one shot in five hundred, which reads as broken
  rather than hard. `MIN_SOLUTION_SHARE` is that floor and is **not** from the plan.
- **Targets cluster near the far edge.** Three targets strewn over open board cannot be cleared by
  one disc at all, and a generator asked for it simply runs out of attempts. A cluster makes the
  one-shot clear a matter of finding the line rather than of luck.
- **The catalogue wraps** past its last entry. A stale build degrades to repeating old puzzles rather
  than to having none, which is the failure worth designing for.
- **The menu button names the puzzle's DAY, and formats it in UTC** (`ui/format.ts`'s
  `formatDayKey`). It used to show the streak, which answers a question nobody is asking on the way
  past — what a player wants before tapping is whether today's puzzle is today's, and the streak has
  two homes already inside the daily itself. The UTC half is not pedantry: the day turns over at
  midnight UTC so two players in different zones are never on different puzzles, so anybody far
  enough east or west has a window every night where a locally-formatted label would name one day and
  the button would open another. The machine this was written on was inside that window — local 20
  August, UTC 19 — and the label correctly read the 19th.
- **The day turns over in UTC.** Two players in different time zones on different puzzles cannot
  discuss the day's puzzle, which is most of the point of having one.
- **It has the aim camera too**, and did not for a while. `enterAimCamera`/`leaveAimCamera` were
  written in `Game` and stayed there, because the daily is a separate scene and the apron got filed
  with the match machinery it sat next to. It is not a match feature — it belongs to the GESTURE,
  and the daily makes the same gesture on the same board. Without it a disc on the rim reached full
  power pulling one way and about a quarter of it pulling the other, which is the same drag meaning
  two different shots; on a ONE-SHOT puzzle that is the whole game. See "Aiming" for the measured
  numbers, which apply here unchanged.
- **It wears the shared top bar** (`ui/chrome.ts`), which is the only way off the screen. See "Known
  Issues Fixed": before that it had a bare gear and a `BACKSPACE` binding, and solving the puzzle
  turned the board inert, so a win was a dead end on any device without a keyboard.
- **It ends with a panel** (`scenes/DailyResult.ts`), raised 700ms after the solver rests so the
  discs still falling off the board are not covered by it. Solved, the hero number is the STREAK —
  §7's whole meta is the chain of days; missed, a streak says nothing about what just happened, so
  the hero is how many targets came off. Two exits either way, because one button is a trap: solved
  offers a match and the menu, missed offers a retry and the menu. Before it existed, a solve was
  `playSfx(SFX.win)` and two lines of text in the corner of the HUD.
- Streaks live in `daily/streak.ts` and take the date as an argument rather than reading a clock — a
  streak bug that only appears at midnight is a bug nobody ever reproduces. A lapsed streak is
  zeroed on READ, because the game is opened far more often than it is played.

## The Tutorial

`src/game/tutorial.ts` is the content — six lessons and twelve reference chapters, Phaser-free —
`scenes/Tutorial.ts` plays the lessons on a live board, and `scenes/HowToPlay.ts` renders the
reference. It exists because the game had no explanation of itself at all: a player who did not
already know the board game met a board, two ranks of discs and a HUD with two priced buttons on it, and
the question that prompted this was literally "what does that one do".

**The split is by KIND, and it is the decision worth keeping.** A board can teach the gesture, the
reach, the line stopping at the first contact, the cost of losing your own disc and the combo,
because all five are things a player DOES. It cannot teach the shop, the ladder, the branches of
arms or the payouts — there is no way to teach a coin balance by making somebody play it, and a
"lesson" that is a wall of text over a board is a worse page than a page. So the lessons do and the
reference reads, and neither pretends to be the other.

### The lessons

Six, one shot each except the last. **A lesson that lets you keep firing until something works
teaches persistence, not aim**; every one but `clear` resolves on ONE shot, so it is a question with
an answer rather than a sandbox. A failure is not a dead end — the hint states **the rule the failure just
demonstrated**, which is where lesson three does its actual teaching, and it stays up until the
player taps. **It used to go on a timer** (1100ms), which is long enough to watch a disc finish
falling and nowhere near long enough to READ two sentences, so the one line that explains the
mistake was gone before it had been taken in. No timer can be tuned out of that: the right pause is
however long this particular player needs. The prompt is part of the line (`tutRetry`), and the
board goes back on the pointer's RELEASE — `beginAim` refuses while the hint is up, so the tap that
dismisses it cannot also become a shot.

| # | id | teaches |
|---|---|---|
| 1 | `flick` | the gesture. The shortest shot in the file — under half power, so a tentative first pull works |
| 2 | `reach` | that the pull is a distance. Across the diagonal, ~0.83 of the drag |
| 3 | `keep` | that your own discs leave the same way. The enemy is OFF the shooter's axis, so the lazy full-power pull straight back misses and runs off the far edge |
| 4 | `around` | that the aim line stops at the first contact. Going round and banking off are both accepted |
| 5 | `combo` | that two in one shot is worth four times one |
| 6 | `clear` | what a round is. Unlimited shots; resets only when the player runs out of discs |

**`tests/gameplay/tutorial.test.ts` plays every lesson through the real solver** over a 72x10 fan of
angles and powers and asserts each is winnable — and, deliberately, that fewer than half of all
shots win it, because a lesson anything solves teaches nothing. It also asserts directly that lesson
three's lazy shot really does cost the shooter its disc: a lesson whose punchline no longer fires is
a lesson that has quietly become a different lesson. None of that is expressible anywhere else in
this repository.

**Nothing traps the player.** One button, always live: `Skip` before the goal is met and `Next`
after it, one handler for both, because both mean "I am done with this lesson". Reaching the end —
solved or skipped — writes `SaveState.tutorialDone`; **backing out through the top bar does not**,
because that is leaving rather than finishing.

**The aim camera is here too**, and for the reason `Daily`'s own note gives: it belongs to the
GESTURE, not to a match. Without it a disc on the rim reaches full power pulling one way and about a
quarter of it pulling the other, which on the screen whose entire job is teaching that drag is the
whole lesson broken.

**The lesson counter is in the coach block, not in the top bar's round slot.** Measured at 844x390,
"1 / 6" in that slot is drawn over the BOARD, a few pixels from a disc, and reads as a label on it.
`Game` never shows this because its landscape layout hands the badges to the side panel; the
tutorial has no panel. Same lesson as the perimeter turn light that was removed for being read as
scenery — **a signal drawn on the field is read as being about the field.**

### The reference

Twelve chapters, a heading and a few paragraphs each, in a scrolling list. **Two of them hold almost
no copy of their own**: the four rule sets and the five branches of arms are already written down for
the screens that pick them (`ruleName*`/`ruleWin*`/`ruleAbout*`, `formation*`), so `HelpChapter.source`
names a list and the scene reads `ALL_RULE_SETS` and `FORMATION_ORDER` directly. A help screen that
restated them would be a second copy free to drift — the exact failure `render-skin-sheet.mjs` was
caught in when its board disagreed with the product's.

**It is a full page, not an overlay, and that is what lets `Settings` reach it.** Settings is an
overlay over an arbitrary opener and cannot host a second overlay without two pause owners
arbitrating over one scene. As a nav destination it is reached with `navTo` instead, which the
settings panel drives **on its opener's behalf** — `navTo` records where "back" lands by reading the
scene it is given, so handing it the overlay would put `Settings` on the stack and send the back
button to a panel that no longer exists. It carries `{ resume: true }` when that opener is `Game`,
exactly as the side panel's shop button does, so a player who asks "what does this button do"
mid-match comes back to the same board rather than to a fresh match started silently over the saved
one.

### The three doors

- **The gear, on every screen including mid-match** → the reference. That is where "what does that
  button do" is actually asked, and the gear is the only control every screen carries.
- **The menu**, while `tutorialDone` is false AND there is nothing to continue → the lessons. Both
  halves of that condition are load-bearing: it is the first-run nudge, and it keeps the menu's
  column at three buttons, which matters because `MainMenu.layout` is already dropping the wordmark
  to fit short landscape screens.
- **The reference itself** offers the lessons — except while there is a match to come back to, since
  starting `Tutorial` would stop `Game` and, while the match survives (it is persisted after every
  settled shot), the nav stack's return entry would not. It also offers the **guided tour**, and that
  button IS unconditional — see "The Guided Tour" for why it can be, and why it leaves rather than
  opening anything itself.

**`Settings`' panel grew a row and a rule with it.** `PANEL_HEIGHT` is 404 and the panel is now
scaled on BOTH axes: `uiScale` reads the WIDTH, which is the right question for text on a phone and
the wrong one for a panel whose height is a fixed stack of rows. At 740x360 `uiScale` returns 1, the
404-unit panel is centred on 360px of screen, and its title lands a pixel above the top of the
viewport — `tests/platform/layout.test.ts` caught exactly that the moment the help button made the
stack taller. Redo the addition in `Settings.layout`'s comment before adding a fourth row.

**`SaveState.tutorialDone` is additive and versionless**, like `SavedMatch.twoPlayer` and
`bestCombo`: a save written before it existed lacks it and normalises to `false`, which is the truth
about it. A returning player is offered the tutorial once more, which is the right failure — the
alternative is inventing a history nobody recorded.

## What one playtest changed

A single session with a player who had never seen the game produced about twenty reports, and the
split between them is the useful part: **five were defects, and the rest were the game failing to say
things it already knew.** The defects are in "Known Issues Fixed". What the rest changed:

- **The tour points at the LESSONS**, second card, right after the hello. It deliberately did not —
  "a step explaining a button that disappears the moment it is used is wrong for every later visit" —
  and that argument is true of a button in general and false of this one, because the menu chapter
  only ever runs on a save that has not seen it, which is the same save on which `tutorialDone` is
  false and the button is on screen. The player walked all six cards, played a match, found the six
  lessons later by accident, and reported that there was no way into them from the guide.
- **The menu's own button says `tutorialPlay`, not `howToPlay`.** It starts the lessons while the same
  two words behind the gear open the reference page — two destinations under one name.
- **The tour and the tutorial both have a Back**, disabled on the first card rather than absent: the
  card's height is measured from its contents, and a control that appears at step two would move
  everything under it. In the tour that forced a decision about the answer row — see `Coach`'s own
  note on why three tokens are one row where the width pays and two where it does not, and why the
  tutorial's pair SHRINKS to its band rather than stacking (stacking fixed the width and broke the
  height: 294 units of block in a 360-tall landscape).
- **The Daily button shows the STREAK once today is solved**, and the date until then. The date
  answers "is this today's puzzle?", which is settled the moment it is solved and the button is
  disabled; the streak is then the thing that just changed. It showed the date in both states, and
  the report came from a player who had just been told "1 days in a row" on the result panel, pressed
  Menu, and found the number gone. The streak's two other homes are both INSIDE the daily.
- **The daily offers a direction after three misses** (`daily/puzzle.ts`'s `findSolution`, and
  `Daily`'s hint). A one-shot puzzle with an unlimited retry is a search, and a search with no
  feedback between attempts is flailing — "может оно как в сапере давало бы советы". It shows the
  DIRECTION and never the power: §8's rule is about things you buy, but its spirit is what stops this
  being a Solve button, and the pull is the half a player actually gets better at. Re-derived from the
  generator's own candidate list rather than shipped in the catalogue — ~8ms measured in a browser,
  against the four seconds the generator spends counting them all — so `puzzles.json` is unchanged and
  the hint cannot disagree with the proof, because it IS the proof stopped early.
- **The hot-seat capsule's border is the active side's own disc colour**, and the match tour's turn
  card says so (`coachTurnTwoBody`). "Player 2 shoots" is a true sentence that answers the wrong
  question: two people look at one board from opposite sides, §2 chose the top-down projection
  precisely so the board never flips, and nothing said which colour Player 2 owns. Asked outright —
  "как понять кто 1 игрок, а кто 2?" — alongside two more questions about the turn rules, which the
  same card now states.
- **The menu character has a pointing hand until it is poked once** (`SaveState.mascotPoked`). It
  bobs, tilts and blinks and was still reported as not looking pressable, which is the failure mode of
  every easter egg that is only an easter egg. Same `icon-hand` the tour taps controls with, so the
  vocabulary is already learned.
- **The aim ray's head is a filled triangle and the pull band ends in a ring.** The head was two open
  strokes meeting at a point — a V with a notch and two square caps for barbs, reported as an
  "обгрызаная стрелка" — and it changed shape with the power, because the strokes thickened while the
  head's length did not. The band simply stopped after its last dash, wherever that fell, so it read
  as running off the board and being cut rather than as reaching the thumb pulling it.
- **The rules page fades at whichever end still has copy beyond it.** A camera viewport is a hard
  clip, so a paragraph running past the bottom is sliced across the middle of a line of type directly
  above the two buttons. Banded rather than `fillGradientStyle`, which is WebGL-only in this build and
  would degrade to an opaque bar under the Canvas fallback.

**What was NOT changed, and why.** Three of the reports were about the turn rules — a knockout not
buying another shot, losing your own disc costing two, losing two at once still costing two — and all
three are the shipped rules working exactly as `game/round.ts` documents them. The fix for those is
saying them, not changing them.

## The Guided Tour

`scenes/Coach.ts` dims a screen, cuts a hole around one control, taps inside the hole with a pointing
hand and says what that control does. `game/tour.ts` holds which chapters exist and which this save
has been shown; `SaveState.tour` is the list. **Lifted from `../Checkers`' own `Coach`**, which is
where the design and most of the geometry come from — the third thing taken from that project after
the browser harness and the side panel, and the one that transferred with the fewest changes.

**It is a third teaching surface, not a replacement for either existing one**, and the split is by
what each can teach. The lessons (`scenes/Tutorial.ts`) put the player on a live board and make them
flick a disc, which is how the gesture, the reach and the cost of losing your own disc are taught and
the only way they can be. The reference (`scenes/HowToPlay.ts`) is for what a board cannot
demonstrate. Neither answers **"what is that button"** about a control the player is looking at right
now — the question that prompted the tutorial in the first place — because a lesson whose goal is
"press the shop" would be a lesson about pressing, and a paragraph about the shop is read on a screen
the shop is not on.

- **Two chapters, met where each is true.** `menu` opens on the first launch, `match` the first time
  a board does. One tour cannot work: the two things a new player needs are on two screens, so it
  would either sit them through the board half before they have a board, or explain a board from the
  menu. The save records the two separately, which is also what lets a third be added later without
  replaying the first two.
- **The hand DEMONSTRATES; the player never has to hit the target.** The obvious design is a real
  hole — let the tap through, watch for the expected action, advance on it — and it is the design
  that strands people: it needs an answer for every other tap, for the player who taps nothing, and
  for a control that is not where the tour thought it was, and its failure mode is a game that cannot
  be used at all. Here the scene underneath is PAUSED, the only two answers are Next and Skip, and
  the finger shows rather than demands.
- **The coach knows nothing about menus or boards.** The opener publishes `tourSteps(): CoachStep[]`
  — a screen RECTANGLE and two string keys per step — so one scene tours both, and a control that
  moved between orientations simply moves the hole. The rectangles are asked for at the moment the
  tour opens, never stored. `MainMenu` reads its own buttons plus `TopBar.parts()` and
  `NavBar.tabBounds(key)`, both added for this rather than letting a caller index into an `objects`
  array; `Game` converts the board out of world space itself, because its main camera is zoomed onto
  board space and only the camera knows the current fit.
- **A step whose target has no size is DROPPED**, which is why neither host needs a branch per
  layout. `Game` publishes the status capsule AND the panel's opponent block for the same "whose shot
  it is" step: the capsule is hidden in the panelled layout and the block in the strip one, so
  exactly one survives. Note the shape of that — **a zero rectangle, never `null`**, because `null` is
  a legitimate step ABOUT THE WHOLE SCREEN and would have added a second copy rather than removing
  one. The block's box is also gated on the panel EXISTING rather than on the block being visible: a
  `PlayerBlock` keeps whatever the last panelled layout put in its box, so a phone rotated out of
  landscape would otherwise report both.
- **A tour with no steps at all is still FILED AS SHOWN.** Each host re-checks `shouldRunTour` in its
  own `create()` and this scene resumes the opener as it leaves, so an unfiled empty tour reopens
  every time that screen is entered.
- **It does not use `ui/overlay.ts`.** That helper animates an entrance by zooming `cameras.main`,
  which is exactly wrong here: the hole has to stay registered with a control drawn by a scene that
  is not zooming. The two colours are shared (`SCRIM_COLOR`/`SCRIM_ALPHA` are exported for it) but the
  scrim is four `fillRect` bands around the hole rather than one rectangle with a hole in it —
  `Graphics` has no even-odd fill, and `destination-out` would need a render texture.
- **The card is placed in one of FOUR bands, and never on the spotlight.** Below or above, the
  roomier first, then beside. Two bands is right only on a phone held upright: in landscape a ringed
  control across the middle leaves no vertical band tall enough, so "the bigger band, clamped" draws
  the card over the ring it is explaining. When nothing fits at all the card gets NARROWER (floored at
  `CARD_MIN_WIDTH`) rather than moving onto the ring. `tests/platform/coach.test.ts` walks every step
  at three viewports and measures the two rectangles against each other; it is negative-controlled by
  counting how many steps had a spotlight at all, since the overlap check passes trivially on a tour
  that rings nothing.
- **The chapter is filed when the tour ENDS, by finishing or by skipping** — never when it opens. A
  player who closes the game halfway has not been shown the screen. Skip files it for the opposite
  reason: a tour somebody declined must not come back every launch.
- **"Show me around" is on the RULES PAGE, not in `Settings`.** Two reasons, and only the first is
  the one the sibling project gives: Settings is an overlay over a paused opener, so launching a
  second overlay from it would stack two dialogs over one frozen scene. The second is local — that
  panel is a fixed stack of rows at `PANEL_HEIGHT` 404, already scaled on both axes to survive a
  landscape phone, and a fourth row is paid for on the screen least able to afford it. The button
  forgets the chapters and LEAVES, and the host it lands on opens the tour in its own `create()`.

  **It lands on a screen that HAS a chapter, which a plain `navBack` did not.** Only `MainMenu` and
  `Game` ask `shouldRunTour`, and the gear that reaches the rules page is on EVERY screen — so a
  player who opened it from the modes list, the shop or the daily had the chapters cleared, the back
  button's ordinary destination, and no tour at all. Reported as "show me around does not take me to
  the menu". Mid-match it is still `navBack`, which restores `Game` with its `{ resume: true }`
  return data and brings the tour to the board; everywhere else it is `navMarkRoot` and a jump home.
  That is what makes it unconditional — neither branch can lose a saved match.
- **The tour's opening card takes `gameTitle`**, not a title key of its own — so the card and the
  wordmark behind it cannot drift apart, or disagree in Spanish. It held a second copy of the name
  for an afternoon, and that copy said the wrong one: see "One name, and it is Flick Checkers".
- **The ring is CLAMPED to the viewport.** A control can legitimately sit against an edge, and on a
  375x664 phone the two priced buttons did: the ring's 8px standoff went off the bottom and the
  spotlight read as a broken box rather than as a ring around a button. Clamping loses a line of ring
  on that side and keeps the shape closed. The underlying squeeze was a HUD bug and is fixed in its
  own right — see "The Board's HUD" — but a tour that rings whatever it is given must survive being
  given something at the edge.
- **The hand is an atlas frame** (`icon-hand`, 96px), white with the atlas's own dark contour so the
  game can tint it gold — a flat white one would be gold on gold against a spotlit button's lit face.
  A pointing index finger rather than a mouse cursor: this is played with a thumb on a phone. Its
  FINGERTIP is at (0.43, 0.02) of the frame, which is the sprite's origin — the tip has to land on the
  control, not the sprite's middle. Drawing it taught one thing worth keeping: `make-atlas.mjs`'s own
  `roundedRect` opens its own path, so three calls to it leave only the LAST shape in the buffer. The
  first render was a lone thumb with two creases floating beside it.
- **Every fixture in `tests/platform/` seeds both chapters as seen** (`DEFAULT_SAVE`), or the tour
  would open over all of them; `coach.test.ts` is the one file that seeds an empty list. Two harness
  changes came with it, both because `scene.isActive()` is FALSE for a paused scene: `open()` takes an
  `expectScene`, and `startMatch()` accepts a `Game` that is paused underneath the coach.

## Skins

`src/game/skins.ts` is every palette in the game, as data and with no Phaser. **TEN board sets × EIGHT disc sets, worn independently** — 80 combinations — `SaveState.skins` was always `{ board, pieces }` and until
this landed both fields were written with the same id and only one was ever read, so a skin changed
the background and nothing else.

- **Sets are recoloured from one authored ramp**, the same recipe `scripts/make-atlas.mjs` uses: hue
  replaced, saturation scaled. That is what guarantees every set is the same art under a different
  light — a set cannot end up flatter or glossier than its neighbours — and it makes adding one two
  numbers rather than fifteen hand-picked hexes.
- **The rule that keeps 35 combinations legible** is structural, not curated: boards stay dark and
  low-chroma, piece sets stay light and chromatic, and every disc keeps its thick dark contour.
  Nobody is going to eyeball 35 pairs each time a set is added, so the invariant has to hold by
  construction.
- **Three disc sets were added on a question rather than a plan**: whether `../Checkers` had more
  wardrobe worth borrowing. It does not — its skin is ONE slot with seven values, i.e. seven
  combinations against this game's 56 — so the work was adding here, not copying. `copper` is the
  first set where one side is chromatic and the other is not, `signal` is the dichromat-safe pair
  (blue against orange) and the only one where the PLAYER is cool, and `amethyst` was placed by
  measurement (below).
- **Three boards were added the same way, and the search that placed them is worth keeping.** Two
  were first put where they seemed to fit and both landed on an existing set (`moss` 4.1 from
  `emerald`, `slate` 5.0 from `frost`) — nudging them by hand then moved one onto a third. The fix
  was to stop guessing: map every board's light tile in Lab, sweep hue/saturation/lightness through
  the real `recolour`/`capLuminance` pipeline, and take the point with the largest distance to
  everything already there. `moss` came out of that sweep at hue 90.
  - **The free axis for boards is VALUE, not hue.** Nine of the original ten sat at the same
    lightness with only `ink` below them, so the catalogue is a thin shell in colour space — which is
    also why the boards' floor has to be lower than the discs': they are dark and low-chroma BY
    CONSTRUCTION and live in a much smaller volume.
  - **All ten boards wear their own plate.** `plum`, `moss` and `slate` borrowed crimson's, sand's
    and ink's while theirs were generated, and `BoardRecipe.fallbackBackground` is the mechanism
    that let them — it is still there for the eleventh board and is declared by nobody today. The
    three that shipped are worth one line each: `plum` is a COLD INDIGO rather than the theme plum,
    because `bg-default` already holds that hue at the set's highest chroma and a second one would
    have been a copy of it; `moss` fills the widest empty stretch of hue in the set (81 to 160);
    and `slate` — the board that contributes no colour at all — wears a deep petrol teal, the one
    hue this game owns and no plate wore, so the colour moves off the board into the room behind it.
  - **A board's identity is colour AND pattern, unlike a disc set's.** Measured colour-only, the
    SHIPPED pair `sunset`/`sand` reported as a duplicate at 6.9 — and it has never been confusable,
    because one is ruled brown and the other checkered olive. That said the metric was wrong, not the
    pair, so the floor drops to 5 when the two styles differ.
- **A set can duplicate another without sharing a number, and `verify:contrast` now measures it.**
  The eighth set was first authored as a pale player against a deep one; every field differed from
  `bone` and the IDEA did not, and it measured **4.5 Lab units** away on its nearer side where the
  tightest pre-existing pair sits at 16.5. Nothing in the recipe shows that. The new check compares
  every pair of sets by the NEARER of their two sides — a set matching another on one side already
  reads as it across a board — against a floor of 12, which is a RATCHET set to catch a duplicate
  rather than a threshold fitted to the current minimum.
- **A disc set cannot go dark, and the first attempt proved it.** `opponentLum: 0.74` failed the
  light tile of all seven boards at once (1.05:1 to 1.33:1 against a 1.35 floor). Boards are dark and
  pieces are light BY CONSTRUCTION, so a piece that goes deep goes into the board's own range and
  stops being a piece; the pair moved up bodily instead of being split further.
- **`npm run sheet` renders the whole matrix** (`scripts/render-skin-sheet.mjs` → `build/`). It
  imports the real palettes through the TS loader, so it cannot drift from the game. Use it — both
  palette bugs below were invisible in the recipe numbers and obvious on the sheet.
- **HSL lightness is not brightness, and a ceiling is not a target.** Two bugs, in that order.
  Scaling HSL `l` uniformly across seven hues left the green, olive, amber and wine boards visibly
  lighter than the teal and blue ones, because the eye is ~10× more sensitive to green than to blue.
  Normalising every board ONTO one measured luminance then made it worse: blue is intrinsically
  dark, so `ink` — the set whose whole identity is "nearly black" — came out pale cornflower.
  `capLuminance()` is the fix: no board may be *brighter* than the reference, and a set that lands
  darker is a set with a dark hue, not a defect. Note the residual, which is perceptual and not
  fixable in luminance: saturated colours look brighter than they measure, so `sat` is the knob for
  "this board feels too loud", not `lum`.
- **Board STYLE is the half of variety a hue cannot supply**: `checker`, `inset`, `ruled`, `dots`,
  all four expressible as axis-aligned rectangles so they cost one `RenderTexture.fill()` bake and
  no `Graphics`. `ruled` and `dots` do not paint the chequerboard at all — the dark squares still
  exist as geometry (`game/formations.ts`'s cavalry reads `isDarkSquare()`), those styles simply
  decline to show them, which is safe because the grid is never consulted after the pieces are placed.
- **Shop item ids are namespaced** (`board-emerald`, `pieces-ember`) and are NOT the set ids. Two
  slots can both hold a set called `default`, and one flat `SaveState.purchases` list cannot tell
  those apart. Once shipped, an item id is permanent — see "Shop Layer".
- **The shop previews what it sells** (`src/board/swatch.ts`): a board fragment with a disc a side,
  baked to a texture and shown in `rowButton`'s reserved third column via its new `setSlot()`. It is
  GENERATED, never painted — from the same `boardSet()`/`pieceSet()` the game draws from, and its
  tiles are stamped by `boardView.ts`'s own `bakeTiles()`, so the advert cannot disagree with the
  product. That is why `bakeTiles` takes its loop bounds from the texture's box rather than from
  `metrics.size`: the swatch calls it with a short wide strip.
  - A swatch is keyed on a (board, pieces) PAIR and the shop passes the equipped counterpart, so a
    board row previews against the discs you wear and vice versa. With two independent slots an item
    has no look on its own. `swatchFor` is therefore re-asked on every refresh, not cached per row.
  - `Shop` takes it as a TEXTURE KEY from a game-supplied `swatchFor(item, scene)` hook and knows
    nothing about skins — same layering as its existing `onSelect`/`rowState` hooks. The scene it
    passes is itself, not the opener: the opener is paused while the shop is up.
  - Built with `scene.make.renderTexture(..., false)` and **never destroyed**. `scene.add` would
    parent it to the shop's display list, and the shop is a `launch()`-ed overlay that is stopped on
    close — the texture would go with it while `textures.exists(key)` kept answering `true`, so the
    second visit would show ten blank rows.
  - `RenderTexture.render()` must be called BEFORE the `Image` it stamped is destroyed. Phaser 4
    buffers draw commands; destroying first makes the flush throw `Cannot read properties of
    undefined (reading 'sys')` from inside the renderer and takes the whole scene down. Third time
    this codebase has hit that gotcha — see also `bakeHazards` and the board bake.
- A board set wears its own background plate the moment one ships under its id, and its declared
  fallback until then (`resolveBackground`), so adding a plate is one line in `assets.ts`'s
  `SKIN_IDS` and nothing in `skins.ts` needs revisiting.

## The Particle Wardrobe

`game/skins.ts`'s `EFFECT_SET_IDS` is the THIRD slot, beside the board and the discs, and the
cheapest content in the game for the same reason §4 calls the branches of arms cheap: it is
arithmetic over assets that already exist. A set is five numbers and a choice of two atlas frames, so
nothing ships and `ART-SOURCES.md`'s provenance gate has nothing new to check.

**Three moments, and a set does not have to decorate all three.** Which ones it touches is itself how
two sets differ — `coins` is interested only in the moment a disc is lost, `embers` smoulders through
the whole shot, and the free `classic` covers one moment so that everything bought is visibly MORE
rather than merely different. A set that lit every moment identically would be the same set in a
different tint.

- **The knock-off burst** was the only one that existed; its count now comes from the set rather than
  a constant, because a `dust` puff and a `coins` payout are not the same number of things.
- **The contact flash** scales with the same energy the impact SOUND already does (§9: a weak hit and
  a hard one looking identical is where the physics stops being felt). It is tinted from NEITHER
  side: a contact involves two discs and the burst is drawn at the point between them, so it is about
  the collision. Whose disc it was is the knock-off burst's job.
- **The trail** is timed, never per frame — one puff per `update()` would be twice as dense at 144Hz
  as at 72Hz, the same class of mistake §2's trap 3 describes for drawing the raw solver position.
  **On record: this is the one effect with a case against it.** §8 forbids anything purchasable from
  answering "can you aim this", and a trail shows where a disc HAS been rather than where it will go,
  so it passes the letter. What it does do is make friction legible, and friction is half of what a
  player judges. It ships because it was asked for after that was said out loud, not because the
  objection was answered.

**The shop's third tab previews the particles, not a board.** An effect has no look as a
board-and-two-discs picture — that image is identical for all four sets — so `ensureEffectSwatchTexture`
scatters the set's own frames across the strip, from a FIXED table of offsets rather than
`Math.random()`, so a row looks the same on every visit.

**The slot is `SaveState.skins.effects`, optional, and needs no version bump** — same reasoning as
`SavedMatch.twoPlayer`: a save written before it existed lacks it and normalises to the free set,
which is the truth about it.

## Board Modifiers

§5's pits, as geometry in `game/hazards.ts` and one flag in `game/rules.ts`. Two rules govern them,
both from the plan:

1. **Never in the core set.** `classic` produces an empty hazard list, so "the classic board is
   untouched by any flag" is true by construction rather than by care.
2. **Symmetric.** Pits are four, mirrored about both axes; two would be symmetric about the halfway
   line only, so one flank would be more dangerous than the other.

**§5's OTHER modifier, the ice, was built and has been REMOVED — mode, geometry and solver support
alike.** It was two slick bands across the middle at friction ×0.3, and as a mode it earned nothing:
it changed how far a shot carried without changing what a shot was FOR, so the round played out the
same with one more variable the player could not aim with. `pits` survives because it changes *where
it is safe to leave a disc*, which is a decision rather than a modifier of one. What went with it:
`RULES_IDS`' `'ice'` and `ICE_RULES`, `RuleSet.iceZones`, `hazards.ts`'s `iceZones()`/
`ICE_FRICTION`, `Hazards.ice`/`BoardHazards.ice`, the `ruleNameIce`/`ruleAboutIce` strings in both
locales, the ice wash in `boardView.ts` and `modeIcon.ts`, and — the part worth naming — `SimConfig.ice`,
`IceZone` and `step.ts`'s per-disc zone test inside `integrate()`. **The solver no longer varies
friction by POSITION at all**; a disc's own `frictionScale` (its branch of arms) is the only friction
modifier left and is constant for the whole round, so anything that wants position-dependent friction
back is reintroducing a concept, not setting a flag. A save holding `rules: 'ice'` degrades through
`migrate.ts`'s existing `isRulesId` guard: the field falls back to `DEFAULT_RULES_ID` and a saved
match in that set is dropped as "nothing to continue", both already-documented paths — and now
asserted, alongside the other two retired ids, in `tests/gameplay/save.test.ts`.

**`bumper` ships with `pits` on, and that pairing is load-bearing rather than decorative.** A disc
leaves play only when its centre crosses the edge or enters a pit; a bouncing rim removes the first,
so with `pits` off there is no way to take a single disc off the board and the mode cannot be won by
anybody. It shipped that way. Measured on discovery: six rounds of Hard against Hard, **zero
finished**, all six ran to the shot ceiling, **zero discs removed** — against about ten shots and
~85 removals for every other set. `tests/gameplay/modes.test.ts` now plays every shipped set to a
winner and asserts the invariant directly, because the defect is a COMBINATION of two flags and the
existing suite tests flags one at a time, which is exactly why it went unseen.

A pit takes a disc on **exactly the same rule as the rim**: its centre going in. That is deliberate —
"how close is that disc to being lost" should be one question with one answer, whether the danger is
the edge or a hole in the middle.

Hazards are baked into the board texture with everything else. The `Graphics` used to stamp them is
flushed with `texture.render()` **before** it is destroyed: Phaser 4 buffers draw commands, so
destroying the source first leaves the command pointing at nothing and the hazards silently do not
appear. That is the same gotcha the board bake itself carries, and it bit here too.

## Game Layer

`src/game/` is this game's own rules, starting positions, round logic, match, scoring, hazards and
economy, all Phaser-free on purpose — the same testability argument as `board/layout.ts` and
`src/sim/`.

- **`round.ts`** — the turn machine. See "Round Rules" above.
- **`opponents.ts`** / **`speech.ts`** — the cast and when it talks. See "The Opponents".
- **`rules.ts`** — `RuleSet`, a flat object of flags (§3), and the **four** sets built from it:
  one core set (`classic`) plus three that are it with a single twist — `bumper`, `blitz`, `pits`.
  The shape is carried over from the draughts project's `rulesets.ts` because it earned it: every
  set runs the SAME code path reading different flags, so a variant is a row in a table rather than
  a branch in the round logic, and two sets differing by one flag are a ready-made test pair (S6's
  acceptance criterion is exactly that matrix).

  **`casual` and `classic` used to be two sets and are now one.** They differed by exactly two flags,
  which on a mode card reads as two nearly identical descriptions of the same game — a picker whose
  first two entries a player cannot tell apart is worse than a picker with one fewer entry. The
  survivor carries the LENIENT flags under the `classic` name, and that split is deliberate: merging
  is a change to the LIST, making the default harsher would be a change to the GAME, and only the
  first was asked for. So `mustTouchEnemy` and `advanceOnCleanWin` are both `false` in every shipped
  set now — the first because punishing a whiffed shot twice is how a beginner concludes the game
  dislikes them, the second because rewarding the round winner with ground snowballs a best-of-five.
  Both stay live flags, exercised ON and OFF in `tests/gameplay/round.test.ts`, so turning this into
  the board game's own set is two lines and nothing else. That is the lever for §11's calibration pass
  if the game reads as too soft on live players.

  **`duel` is now `blitz`, at five seconds a shot rather than eight.** Eight is enough time to line a
  shot up and hurry, which makes the clock a nag; five is not, which makes it the rule.

  **A rule-set id is NOT permanent the way a shop item id is.** Three have been retired now (`ice`,
  `casual`, `duel`) and the cost each time was nothing, because `migrate.ts`'s `isRulesId` guard
  already rejects an id this build lacks: the `rules` field falls back to `DEFAULT_RULES_ID` and a
  match saved under a departed set is dropped as "nothing to continue", with the wallet, the skins and
  the streak all untouched. `tests/gameplay/save.test.ts` asserts exactly that, by name, for all three.

  **`extraShotOnKnockout` is `false` in every shipped set** (§3): a knockout used to also buy the
  next turn, and `verify:balance` measured what that was worth — the side that shot first won 85% of
  rounds at Hard on runaway chains alone. Strict alternation took that to 2.3%. The flag stays in
  `RuleSet` for the arcade mode that may want it, is restated as `false` explicitly rather than
  inherited, and `tests/gameplay/round.test.ts` exercises it turned ON so a flag nothing ships with
  cannot quietly rot.
- **`economy.ts`** — the catalog, the payouts, and `equippedSkin()`. Pure functions over plain
  values (a balance, a purchase list, a saved id), never the store singleton. Note what the two
  consumables are NOT: the draughts project sold a hint and an undo, both of which answer the
  question the game is asking. Here the question is "can you aim this", and nothing purchasable may
  answer it — a retake returns a shot, a power shot raises the impulse ceiling, and where either
  goes is still entirely the player's thumb.
- **`formations.ts`** — where the discs start, and what they are made of. See "Branches of Arms".
- **`match.ts`** / **`scoring.ts`** / **`hazards.ts`** — see "The Match", "Score, Combos and Feel"
  and "Board Modifiers".
- **`wallet.ts`** / **`persistence.ts`** — the thin store-touching layers over the above. `wallet.ts`
  owns `coins`/`purchases`/`skins`, `persistence.ts` owns `rules`/`difficulty`/`stats`/`bestScore`.
  Nothing else in the codebase writes those fields.
- **The saved match is `SaveState` v2's addition** and the first real exercise of `migrate.ts`'s
  ladder — see "The Match" for why the whole board is stored rather than the formation plus a
  casualty list.

## UI Kit

`src/ui/theme.ts` is a themeable, palette-driven widget kit shared by every scene — buttons, rows,
badges, panels, progress bars, and full-bleed backgrounds all built from one visual language (a dark
fill, a crisp colored stroke, and — where noted — two wider/fainter strokes standing in for a glow, no
shader/Bloom postFX pass, so it works identically under the Canvas fallback). `Settings.ts` is the
reference consumer — read it alongside this section for the intended call pattern.

**A control inside a fixed-size panel must be TOLD its width, never assume one**, and this cost a
shipped bug. `ui/slider.ts`'s track was a fixed 240 design units; with a 64-unit mute button, a
14-unit gap and 20 units of panel padding a side, the row wanted 374 units inside `Settings`' 340-unit
panel — so the knob at 100% sat 14 units OUTSIDE the panel's right border, drawn over it, with the
`100%` readout inside the knob. Two fixed numbers in two files that have to agree by hand will not.
`Slider.layout(x, y, scale, rowWidth)` now takes the width it may occupy and guarantees nothing it
draws lies outside `x .. x + rowWidth` — the knob's radius included, since the knob is *centred* on
the end of the track and half of it hangs past. `Settings` passes `panelWidth - padding * 2` and
clamps `panelWidth` itself to `width - 32`, so a viewport narrower than `uiScale`'s 0.8 floor allows
costs a shorter track rather than a panel off both edges. Verified numerically at 320/390/420/768/1920
wide: the row sits symmetrically inside the panel with the padding as slack at every one.

**And `PANEL_HEIGHT` was 30 units short of its own contents**: title at 34 from the top, two rows as
tall as their 64-unit mute buttons, a 56-unit Close button 46 up from the bottom — inside 300 the
second row ended 2 units *inside* Close's top edge. 330 now, with the row centres chosen against that
arithmetic; check it before moving any of them.

- **`buttonWidth(size, scale)` / `buttonHeight(size, scale)`** (`ui/button.ts`) answer a size question
  from the TOKEN, for a caller that needs the answer in order to decide where to lay a button out.
  Reading `button.width`/`.height` first is the trap: a button only learns its scale inside
  `layout()`, so the getters return `* 1` on the first pass and the *previous* scale's value on every
  resize after. `ui/slider.ts` (placing a track beside its mute button) and `Modes` (reserving room for
  its start button) both need this; `MainMenu`'s button stack still reads `.height` off a built button
  and is wrong by one resize in exactly the same way, which nothing has noticed because every button
  in that stack shares one size.

- **Theming**: `getTheme()`/`setTheme(overrides)` hold one module-level `ThemeConfig` — `colors: {
  primary, secondary, accent, backgroundTop, backgroundBottom, surface }` plus a canonical `radius`.
  `DEFAULT_THEME` is the kit's own neon fallback, but **this game's palette is `src/gameTheme.ts`**,
  installed by `applyGameTheme()` in `main.ts` before any scene builds a widget (a factory reads the
  theme at *creation* time, not reactively — a widget already on screen won't retint later). Gold on
  deep plum: gold is the ONLY metal in the game, and its two slots are not interchangeable — `accent`
  is the bright coin gold reserved for currency/reward iconography, `primary` the warmer amber the
  loudest CTA is built from, kept a step apart in hue so "this is a reward" doesn't read the same as
  "this is a button". `secondary` is deliberately not a metal, which is what keeps gold meaning
  "important" rather than "interactive". `gameTheme.ts` is a separate module rather than an inline
  `setTheme()` call for one concrete reason: `config.ts`'s `backgroundColor` needs the same
  `backgroundTop` value, and `GameConfig` is evaluated at *import* time — before `main.ts`'s body
  runs — so reading `getTheme()` there would silently pick up the neon fallback. `index.html`'s `body`
  background is a third, hand-synced copy (HTML can't import a TS const); it is what shows before the
  canvas exists, so a stale value there reads as a flash on boot. `accent` is a convention, not an enforced rule:
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
- **An icon that is a GLYPH is an icon the device can decline to draw.** `gameButton` takes both
  `icon` (a character) and `iconFrame` (an atlas frame); prefer the frame for anything a player has
  to recognise. The settings mute buttons were the emoji U+1F507/1F508/1F50A and came back from a
  phone as two tofu boxes — and those two buttons carry no words, so nothing at all said whether
  sound or music was muted. They are `icon-sound-on/low/off`, drawn by `make-atlas.mjs`, which is
  what the coin in that same atlas had always been. The nav bar's three tabs and the
  gear followed for the same reason — they sit on the two bars a player looks at most — and being
  sprites bought something a glyph could not: **the active tab's icon now takes the same gold its
  label does**, because a sprite can be tinted and an emoji is whatever colour its font makes it.
  The two consumables followed last, and they
  are the reason `gameButton` now lays an icon BESIDE a label rather than instead of one: their
  buttons read "mark, then price", so the frame is sized off the label's font (not the button's box)
  and the pair is centred as one group. **`ShopItem.icon` is gone entirely** — nineteen catalogue
  rows set a glyph nothing ever drew, because the shop shows a generated swatch of the actual
  product instead of a symbol standing in for it; keeping a dead field full of emoji is an
  invitation to draw them one day. **The one glyph left in the UI is the top-up's `🎬`**, inside a
  translated string (`shopTopup`) rather than in a widget, where a tofu costs the symbol and not the
  meaning — the words and the number are the rest of the label.
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
  `getDisplayFontStack()` return it from then on; `neonText()` reads that getter internally. This game
  ships **Fredoka 600, latin subset only** (`gameTheme.ts`'s `DISPLAY_FONT`), awaited in `main.ts`
  before `new Phaser.Game(...)` — same timing reason as `initLocale()`: a Canvas/WebGL `Text` object
  does not retroactively repaint when a web font finishes loading async after it already drew with a
  fallback face. Local file, never a CDN `<link>`; provenance in `FONT-SOURCES.md`. Adding a locale
  outside the latin subset (Cyrillic, say) means adding the matching subset FILE and a registry row —
  not silently letting glyphs fall back, which in this style is visible immediately.
- **Click sound**: `setPressSound(play)` registers, once, the sound every widget in the kit plays on
  POINTER_DOWN — `main.ts` wires it to `playSfx(SFX.ui)`. Deliberately a callback, not a sound key:
  the kit stays unaware of `src/audio/`, of which cue is the click, and of whether the game has audio
  at all. It lives in one place rather than ~15 call sites because a button that clicks in one menu
  and not in another is the kind of inconsistency nobody files a bug about and everybody feels. A
  plain `Text` used as a button (the `⚙` gear in `MainMenu`/`Game`) is NOT a kit widget and is outside
  its reach — those call `playSfx` themselves.
- **`src/ui/format.ts`** / **`src/ui/fit.ts`** — trivial generic helpers with no theme/game coupling:
  `formatTime(elapsedSec)` (`"M:SS"`), `titleCase(id)` (`'retro-tech'` -> `'Retro Tech'`),
  `fitContain(sourceW, sourceH, maxW, maxH)` (largest non-distorting fit inside a box — `preview.ts`'s
  own `'contain'` branch is built on this), and `fitScale(naturalWidth, availableWidth, safety?)` — a
  shrink-to-fit factor that **never grows**. `uiScale` alone cannot keep a title on screen: it floors
  at 0.8 and knows nothing about how wide a particular string renders, so a longer translation on a
  narrow phone clips. `MainMenu` applies both to its title.

## Scroll Patterns

Two small, independent modules for building a scrollable list/strip (a card grid, a settings list, a
catalog longer than one screen, ...) — neither is wired into any shipped scene today (`Shop`'s own
catalog just stacks rows to fit, see its own section above), but both exist so a screen added later
doesn't have to rediscover the same WebGL gotcha or reinvent flick physics from scratch.

**Do not confuse `scrollMomentum.ts` with the game's own physics.** It is UI inertia for a scrolling
list — exponential decay with a soft edge stop, one axis, no collisions. The disc solver is
`src/sim/` (S2), it is a different problem with different constants, and neither should ever import
the other.

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
- **A later camera's viewport does not composite over the earlier one — it OWNS those pixels.**
  Anything `cameras.main` draws inside the region's rectangle is simply not there. Measured rather
  than reasoned: one `Graphics` object drawing two rectangles rendered red above the region's band
  and vanished inside it, at the same alpha, on the same camera, in the same frame. So a fixed
  overlay that has to sit ON the scrolling area — a scrollbar, a header, a fade — cannot live on the
  main camera. Put it in the REGION and cancel the camera's scroll (draw it at `scrollY + offset`),
  which is what `Shop`'s scrollbar does, or give it a third camera of its own. This is the same fact
  the popup note above depends on, stated from the side that bites.
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

## One name, and it is Flick Checkers

The game is **Flick Checkers**, everywhere a person can read it and everywhere the code can say it.
"Chapaev" is the name of the traditional game this one is descended from, and it now appears in this
repository only where it means exactly that: inside `GAME-PLAN.md`'s Russian prose, where the
ancestor is discussed as the ancestor. The two documents that carried it in their FILENAMES are
`GAME-PLAN.md` (was `CHAPAEV-PLAN.md`, the design authority) and `PROMPT-UI.md` (was
`PROMPT-UI-CHAPAEV.md`) — 76 citations across 55 files moved with them, which is the cost of
leaving a name in a filename and the reason not to put one there again. The remaining hits anywhere
are the sibling Remotion scripts' own filenames (`gen_chapaev_bots.py` and friends), which live in
another project and are cited because that is what they are called on disk.

- **No player-facing string has ever to be checked for this again**: every one goes through `t()`,
  and both dictionaries say Flick Checkers / Damas de Pulso through the single `gameTitle` key. The
  guided tour's opening card is the case that got it wrong — it carried its own `coachHelloTitle`
  reading "Chapaev", which is what the game is to the people building it and not what it is called
  to the person playing it. Anything that needs the game's name reads `gameTitle`; a second copy of
  a name is a second thing to translate and a second thing to get wrong.
- **`RuleSet` was `ChapaevRules`**, and the rename is the reason to state the rule at all. A type
  name is not player-facing and was not a bug — but it is what makes the working name feel official
  inside the codebase, and it read oddly beside `RulesId`/`getRuleSet`/`ALL_RULE_SETS`, which never
  carried it. `GAME-PLAN.md`'s three mentions of the old type were updated with it: a design doc
  naming an interface the code does not have is the same drift as a contact sheet disagreeing with
  the product.
- **Prose in comments says "this game" or "a round", not the old name.** Twenty of them did — "a
  Chapaev round is about ten shots", "the Chapaev disaster" — and every one reads at least as well
  without it, because the file it is in is already about this game and nothing else.

## Localization

`src/i18n/strings.ts` is a plain lookup-table `t(key, params?)` layer, not a library — `{name}`
substitution only, no plurals/ICU/locale-aware number formatting. The `en`/`es` dictionaries hold both
the generic UI keys and this game's own copy — menu, rule-set names and their one-line descriptions,
the branches of arms, match/result strings, and the economy. New strings extend these same two
objects, in the same commit for both locales — never a second, parallel `t()` mechanism.

**Any new user-visible string goes through `t()`.** The one deliberate exception in the codebase is
the `⚙` gear glyph, which is not language.

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
Concretely: `MainMenu`'s New game button is `'primary'` (pointer + `SPACE`/`ENTER`), its gear button is
`'openSettings'` (pointer + `ESC`); `Game`'s gear button is the same `'openSettings'`; `Settings`' two
toggles are `'toggleSound'`/`'toggleMusic'` (pointer + `S`/`M`) and its Close button is `'close'` (pointer +
`ESC`/`ENTER`). There is no "what kind of device is this" branch anywhere — mouse, touch (Phaser unifies
both into one Pointer API already), and keyboard all work at the same time, unconditionally.

The callback receives the `Phaser.Input.Pointer` when a pointer triggered it, and `undefined` when a
key did. Most callers ignore it; one that needs *where* the tap landed — the aim gate of S5, which
must decide whether the press started on one of the player's own live discs — reads it, and still
has to handle the keyboard case.

Three things `bindAction` cannot express, all also in `platform/input.ts` — a gesture is a stream
with a beginning, a middle and two different endings, and scenes still never touch raw pointer
events:

- `bindDrag(scene, action, target, handlers)` — a single-pointer press-drag-release. `onStart`
  returns a boolean and is **the gate**: return `false` and nothing else fires for that press, which
  is how the aim gesture asks "did this land on one of my own live discs". `onEnd` and `onCancel`
  are different endings on purpose — a cancelled aim must fire nothing. Multi-touch is refused
  rather than interpreted (see "Aiming"). This is what S5's slingshot is built on.
- `activePointerCount(scene)` — how many pointers are down right now. A tap handler that must not
  fire mid-gesture checks this rather than subscribing to raw input itself. `config.ts` sets
  `activePointers: 2` specifically so a stray second finger can be SEEN and ignored; with Phaser's
  default of one touch pointer, a two-finger fumble reports as a clean one-finger drag.
- `bindPan(scene, action, options, onPan)` — a continuous multi-pointer drag, reported as per-move
  deltas of the pointers' CENTROID in screen px, with the centroid reset (one move skipped) whenever
  the pointer count changes, since adding or lifting a finger moves it instantly. **Nothing uses it
  today and probably nothing will**: `board/layout.ts` fits the whole board in both orientations, so
  there is no pan gesture, which is exactly what lets the one-finger drag belong to aiming outright.
  It is kept because a board size past 8×8 is the one thing that would bring the need back.

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

- `types.ts` — the single `SaveState` shape (current version, **v4**), current
  `SAVE_SCHEMA_VERSION`, and `DEFAULT_SAVE_STATE`. The ladder so far: **v1** `{ v, bestScore, coins,
  purchases, settings, rules, difficulty, skins, stats }`; **v2** adds `match` and `daily`; **v3**
  turns the two sound FLAGS into levels; **v4** replaces `difficulty` with `opponent` and adds
  `defeated`. `tutorialDone` and `tour` then joined `v4` with NO bump — both additive, absent on
  every older save, normalising to `false` and to an empty list, which is the truth about such a
  save; same case as `bestCombo` and `skins.effects`, and see "The Tutorial" and "The Guided Tour".
  `tour` is a `string[]` rather than a union of chapter ids ON PURPOSE, and `migrate.ts` keeps
  whatever strings it finds: importing `game/tour.ts` here would drag the store into the import
  graph of every test that touches a payload, and an id this build does not know gates nothing. **The historic interfaces are kept rather than edited in place** — `SaveSettingsV1V2`
  and `SaveDifficulty` both exist for no other purpose than letting an upgrade step NAME what it is
  reading; deleting one leaves that function taking `unknown` and checking types it can no longer
  say. **v1 and not a continuation of the draughts
  project's v3** (`GAME-PLAN.md` §8): this is a different game with a different save directory on
  the platform, so no v3 payload can ever reach this build and pretending to migrate one would be
  ceremony. What did transfer is the machinery — the ladder, the per-field normalisation, `save.ts`'s
  guards — because the project's first schema bump needs all of it.
- `migrate.ts` — `migrate(raw: unknown): SaveState | null`, a `switch (raw.v)` ladder with **two
  deriving steps that now COMPOSE** (a v1 payload runs through both `upgradeV2ToV3` and
  `upgradeV3ToV4`), which is the property a ladder exists for and the thing to keep true when adding
  a third. A step is needed only when a field changes MEANING: `v1 -> v2` merely added fields that
  normalise to "nothing there" and falls straight through, while `v3 -> v4` has to map
  `difficulty` onto an `opponent` id or every returning player is silently put back on the weakest
  character. Its companion `defeated` cannot be derived at all — a v3 save has no record of who was
  beaten — so it starts empty rather than being invented from a difficulty setting, which is a real
  if small loss of progress and the honest option.
  Returns `null` for an unrecognised version; **individually** corrupt fields are
  defaulted one at a time rather than costing the whole save, so a player who somehow ends up with a
  NaN score does not also lose the skins they bought. `skins` is deliberately NOT validated against
  `SKIN_IDS` here — `game/economy.ts`'s `equippedSkin()` already refuses an unknown or unowned id at
  the point of use, and doing it in both places would mean a skin renamed in a future build silently
  wipes the field on load instead of degrading to `'default'`. **v1 -> v2 is the ladder's first real
  bump** and needed no upgrade step at all: a v1 payload lacks `match` and `daily`, both of which
  normalise to "nothing there", so the case falls straight through. A bump that must *derive* a field
  from old data gets an explicit `raw = upgradeV2ToV3(raw)` line above its fallthrough.
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

`src/shop/` is the mechanism; **this game's actual catalog lives in `src/game/economy.ts`** and is
registered once, unconditionally, from `main.ts` via `setCatalog(CATALOG)` (same "register a config
object once at boot" shape as `ui/theme.ts`'s `setTheme()`). The template's DEV-gated demo shop is
gone — `MainMenu`'s Themes button is a permanent, ungated entry point.

What is sold, and why it is split across two places:

- **Ten unlocks across two wardrobes** — six boards (`BOARD_ITEMS`) and four disc sets
  (`PIECE_ITEMS`), on top of the free `default`/`classic` pair. **The item id is NAMESPACED, not the
  bare skin id** (`board-emerald`, `pieces-ember`, built by `boardItemId()`/`pieceItemId()`): two
  slots can each hold a set called `default`, and one flat `SaveState.purchases` list cannot tell
  those apart otherwise. Namespaced or not, an item id is permanent once shipped — it lands in
  `SaveState.purchases` AND in `SaveState.skins`, so renaming one both orphans everyone who bought
  it and silently un-equips it.
- **Two consumables** (`RETAKE_ITEM`, `POWER_SHOT_ITEM`), bought from two buttons in the gameplay
  HUD and **not** rows in the `Shop` screen — both only mean anything with a live round in front of
  the player, and a retake that costs a trip to a menu mid-shot is a retake nobody uses. They are
  still catalog items so a price is written down in exactly one place, and `MainMenu` opens `Shop`
  with `items: SKIN_ITEMS` rather than the whole catalog — a row that debited coins from a menu with
  nothing to apply them to would be a pure coin sink.
  **Neither answers the question the game is asking.** §8's rule, and in a flick game that question
  is "can you aim this". A retake gives back the shot, not the skill (and is once per round, or a
  full purse becomes a licence to brute-force the board); a power shot raises the impulse ceiling for
  one shot and leaves where it goes entirely to the player's thumb. The draughts project's hint and
  undo both failed that test, which is why neither survived the port.
- `titleKey` is an i18n key looked up through `tOptional()`; it does not need a dictionary entry,
  since `Shop.ts` falls back to `titleCase(id)`. So a new item can ship before its translation.

`Shop.ts` takes three optional hooks beyond the template's `onPurchase`, and `MainMenu` uses all of
them: `items` (the subset above), `onSelect` (what tapping an ALREADY-OWNED unlock does — here,
equip the skin), and `rowState` (what such a row's accent label and dimming should say — here,
`equip` vs `equipped`, so the set already in force is the dimmed one, having nothing left to do).

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
- `scenes/Shop.ts` — a `scene.launch({ opener, onPurchase? })` overlay

  **The two wardrobes are two TABS, not one list** (`ui/segmented.ts`, lifted from `../Checkers`).
  Ten rows at 72px plus gaps is 810px, which fits no phone this game targets, so three of the ten
  were below the fold on the screen whose entire job is showing what is for sale — and running boards
  and discs together implied one choice where there are two independent slots. Two things about the
  split are load-bearing:
  - **A hidden row's button is DISABLED, not merely invisible.** Phaser keeps serving pointer events
    to invisible objects, so the six board rows would otherwise keep live Buy buttons underneath
    wherever the four disc rows are now drawn — a tap on `Ember` charging for `Emerald`.
  - **A hidden wardrobe does not repaint**, and that is deliberate rather than a gap. A swatch
    previews a PAIR, so changing the board changes what every disc row should be drawn against; those
    rows are rebuilt when their tab is opened, because a row nobody can see is not worth a render.
    The browser test asserts the visible consequence, not the internal one.

  **A shop reached from a match says so, and offers the way back** — a gold `Back to match` button
  beside the top-up, present only when `ui/chrome.ts`'s `navReturnsTo()` names `Game` AND a saved
  match actually exists. The back arrow in the corner already did the job and did not say it did,
  while three navigation tabs along the bottom said loudly that there were other places to be. The
  second half of the condition is not belt and braces: the nav bar switches tabs with a bare
  `scene.start`, so the stack is never popped by a wander through Shop -> Home -> Shop, and a match
  that ENDED in between would leave a stale entry pointing at `Game` — the button would then start a
  brand new match under the words "back to match".

  **One tap buys AND wears it** — there is no separate equip step, and `tests/platform/shop.test.ts`
  pins that down along with the trip back: the board is already wearing the new set by the time the
  player is standing on it again. Note for anyone writing more of those tests: the rows are drawn
  through the scroll region's own camera, so a row's WORLD position is not where it is on screen, and
  clicking the world position lands above the list. Undo the camera (`- scrollY + camera.y`) — this
  cost two red tests before it was spotted., same pause/resume pattern as
  `Settings` (see "Audio Layer" below) — and, like `Settings`, listed in `platform/lifecycle.ts`'s
  `OVERLAY_SCENES` so a real platform pause doesn't freeze its own Close button (see "YouTube Playables
  Wrapper"). Any new overlay scene a game adds needs the same registration. UI is entirely `ui/theme.ts` widgets: a `valueBadge('🪙',
  coins)` balance readout, one `rowButton` per catalog item (`SHOP_ROW_COLUMNS`, same
  fraction-of-row-width convention "UI Kit" describes for any row list), a `neonButton` "top up"
  action, and a `neonButton` Close. Rows dim (`setColor`) and their accent label flips
  (`setAccentText`, added to `RowButton` specifically to support this) between `t('buy')` and
  `t('owned')`/an unaffordable-but-still-visible state — see `refreshAllRows()`, called after both a
  purchase (this item's own state changed) and a top-up (every row's affordability may have
  changed). **It scrolls**, via "Scroll Patterns"' `scrollableCameraRegion()` — ten rows at 72px
  plus their gaps is 810px of list, which does not fit any phone, so stacking-to-fit stopped being
  an option the moment the wardrobe split in two. `layout()` re-bounds the region rather than
  re-positioning rows, and the standing RULE against reaching for `setMask()` to clip it instead
  applies here (a real, previously-hit bug, not a theoretical one).
  - **And it says so**, with a scrollbar. The scrolling itself had worked for a long time and
    *nothing indicated it*: on a 390×844 phone seven of the ten rows fit and the region camera cuts
    the seventh off cleanly at the nav bar, which reads as "the catalogue ends here". A shop whose
    last three items nobody knows about is a shop with seven items in it. The bar is drawn inside
    the region with the camera's scroll added back, for the reason "Scroll Patterns" gives — on the
    main camera it is invisible, not merely misplaced — and it is skipped entirely when everything
    fits, since a scrollbar that cannot move is furniture.
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
- Music is a single retained instance (`currentMusic`), played at a fixed `MUSIC_VOLUME` of `0.5`.
  Every cue is normalised the same way by `scripts/make-audio.mjs`, so the balance between the bed and
  the one-shots is made here, once, rather than baked into one asset. **That is also the constraint
  on replacing the bed**: the external track that now ships was gain-matched to −16.5 LUFS, measured
  off the procedural bed it replaced, precisely so this number and all six one-shot levels stayed
  calibrated. A track dropped in at its own mastered level would have arrived 2.1 LU hot and
  quietly re-balanced the entire game against its own sound effects. It is muted/unmuted in place via
  `.setMute()` whenever the platform or user flag changes, so an already-playing track reacts
  immediately. `playMusic()` and
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
  `.wav`/other audio-delivery formats — a generic extension check can't distinguish a "WAV
  master" from a normal delivered sound file by extension alone. That distinction is a
  provenance question, not a mechanical one, and it is enforced by the registry check below.
- **Provenance gates (these FAIL the build, they are not advice).** Every audio file
  (`.ogg`/`.wav`/`.mp3`/`.m4a`/`.webm`) shipped in `dist/` must have its basename appear
  somewhere in `AUDIO-SOURCES.md`, every font (`.woff2`/`.woff`/`.ttf`/`.otf`) in
  `FONT-SOURCES.md`, and every image (`.webp`/`.png`/`.jpg`/`.jpeg`/`.avif`/`.gif`/`.svg`)
  in `ART-SOURCES.md`. **Images joined that list late and the reason is worth keeping**: until
  the backgrounds became diffusion renders, every pixel in the repo was computed by
  `scripts/make-atlas.mjs`, so an image gate could only ever confirm what the generator already
  guaranteed. The moment ONE shipped image stopped being arithmetic the gate started earning its
  keep — and it covers all of them, not just the exception, since a gate that only checks the
  files someone already worried about checks nothing. The check is deliberately dumb — the registry is prose and it only asks
  that the filename is mentioned; it cannot tell a truthful row from a careless one. What it
  CAN do is make adding a file without thinking about its licence impossible to do silently,
  which is the actual failure mode. An unresolved copyright claim on a sound or a font is one
  of the most common Playables rejection reasons.
- **`store/metadata.json`**, when present, is validated here too (title ≤ 50 chars,
  description ≤ 150, genre from the portal's fixed list, every named thumbnail exists),
  because the portal rejects those at the END of the submission flow and a character count is
  the silliest possible reason to make that round trip twice. The file itself lands with S13;
  until then its absence is a log line, not a warning.
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
- **Asset provenance**: adding any audio file or font requires a row in `AUDIO-SOURCES.md` /
  `FONT-SOURCES.md` (repo root) **first** — file, source URL, license, date added. Only
  **CC0** or **self-generated** audio, and only **OFL / Apache-2.0 / CC0 / self-generated**
  fonts, are acceptable. The build gate above enforces that the row exists; this rule is what
  says it must be true. Both registries deliberately live at the repo root, not under
  `public/assets/`: they are internal process documents, not game assets, and `public/` is
  copied into `dist/` verbatim by Vite, so anything under it ships. `fonts/OFL.txt` is the one
  licence text that DOES ship next to its font on purpose — OFL §3 requires the licence to
  travel with the distributed font.
- **The generators are how provenance stays true.** Every sound in `public/assets/audio/` except
  the music bed, and every sprite in the atlas, is computed by `scripts/make-audio.mjs` /
  `make-atlas.mjs` from
  oscillators, seeded PRNGs and drawing commands — no sample pack, no recording, no
  downloaded art. That makes provenance a property of the repository rather than a promise in
  a registry row: there is no file to trace, only arithmetic. Both are deterministic (no
  `Date`/`Math.random`), so regenerating produces identical bytes and doesn't churn git — which for
  the two generators that emit Ogg needed a fix in the CONTAINER as well as in the arithmetic, since
  libvorbis stamps a random stream serial into every page. See `pinOggSerial` / `pin_ogg_serial`.
  Prefer extending a generator over adding a file.
- **The backgrounds are the one deliberate exception** — ten of them now, one per board set, and
  `ART-SOURCES.md` is where the terms are written down. They are SDXL renders (seeds recorded, so each is reproducible from
  `Remotion/src/scripts/gen_chapaev_skins.py` alone), because a blurred atmospheric plate is the
  one asset class where a generator is genuinely worse than a model — and the safest class to make
  an exception for, since nothing reads it and it carries no game state. Everything a player looks
  AT is still computed. `npm run assets` no longer writes backgrounds for this reason; see Commands.
- **Judge a background on its BANDS, not its centre.** The pipeline these came from guards
  `centerDetail` on the rule that the middle of the plate must be the calmest part — inherited from
  the draughts game and **inverted here**. The board covers the middle; what a portrait phone
  actually shows is the top and bottom strips, which is precisely where this game's HUD sits (coin
  badge and gear above, status and the consumable buttons below — `computeHudBands()`). A plate that
  passes `centerDetail` can still put a bright shaft directly behind the gear. Composite any
  candidate at 390×844 with the board silhouette in place before believing a metric about it.
  - **And the band guard was measuring the wrong COLUMNS.** It averages each band across the full
    1280px width; a portrait cover-fit keeps only the **central 26%** of them. `bg-plum`'s first
    attempt measured 44.2 to the guard — which therefore left it alone at strength 0 — and 66.2 in
    the strip a phone actually shows, with the brightest patch of all ten plates exactly where the
    gear button goes. The generator now gates the guard's own two targets on the portrait crop, and
    on BOTH bands: gating only the top was tried first and the replacement seed came back calm on
    top and 48.4 on the bottom, which is where the status line and the consumable buttons are. The
    composition had moved rather than calmed.
  - **A new plate is also measured against the CATALOGUE**, which nothing did before: each was
    judged on its own brief and never against the plates it was joining. `MIN_PLATE_DISTANCE` is
    12.0 Lab on the mean colour — the same floor `verify:contrast` uses between two disc sets — and
    it rejected four attempts across two skins. Both gates are ratchets: the seven plates that
    predate them are not re-posted to satisfy them, and `ART-SOURCES.md` names which miss what.

## Out of Scope and Why

Deliberately not built, so they don't get "discovered missing" and re-litigated later:

- **Save compression/chunking** — `SaveState` is a few hundred bytes serialized. `save.ts`'s 3 MiB size
  guard (see "Save Layer") exists for defense-in-depth, not because this project is anywhere near it;
  compressing or chunking a payload this small would add real complexity (a decode step on every load, a
  schema migration concern of its own) to defend against a risk that doesn't exist yet. Revisit when S9
  adds a saved match — a serialised board of 16 discs is still small, but it is the first field that
  grows with play rather than being fixed-size.
- **Telemetry/analytics** — Playables is an offline-only environment; its CSP blocks requests to external
  hosts, so a typical analytics SDK (or a custom event collector phoning home) literally cannot function
  here, not just "isn't needed yet." The only outbound signal is `health.ts`'s `logError()`/`logWarning()`
  pings to the platform's own health metrics (see "Health Monitoring").
- **`onLowMemory` handling** — not part of the `ytgame` SDK surface this project has integrated against
  (see PLAYABLES-SDK.md); there is nothing to hook up. Revisit if a future SDK version adds a memory-
  pressure callback and the game's asset footprint grows enough to make it relevant.

## Known Issues Fixed

- **The opponent's line grew UPWARD into the status capsule as it typed.** The line is revealed one
  character at a time, so its height goes from nothing to two lines DURING the reveal — and the
  `Text` was anchored by its centre and positioned from a height measured at `layout()` time, when
  the row is empty. A centred object grows in both directions, so the first line walked back up over
  the capsule while the row reserved for it below sat empty. Measured with the layout run on an
  empty row and a two-line quip then spoken, which is the real sequence: the line overlapped the
  plate by **4-5px at every width from 320 to 430**. Anchored by its TOP instead (`setOrigin(0.5,
  0)`, positioned at the row's top) it can only grow down, into the room set aside for it: the same
  measurement gives **+2 to +4px of clearance**. `SPEECH_ROW_HEIGHT` is now derived from the font
  rather than picked, because at 34 it was a line and a half against a row documented as holding
  two.
  **The first negative control did not reproduce it** — it re-laid out while a previous line was
  still on screen, so the "height at layout time" was already the height of a real line and the bug
  cancelled itself. A control for a bug about STALE state has to reproduce the staleness.
Bugs and gotchas hit and fixed while building the platform/save/audio layers — recorded so they don't get
silently reintroduced or re-debugged from scratch. Full detail lives in the section noted; this is the
index.

**Inherited, and every entry still applies.** These were paid for once in `Phaser_Core` and once more
in the draughts project, and the code that carries their fixes is the code this project is built out
of. A few name a scene or a value that has since changed shape (the gear button that rendered through
the wrong camera is now `Game`'s HUD over a board rather than over a logical 960×540 field); the
mechanism each one describes is unchanged.

App bugs:

- **The music never came back after "YouTube muted, tab backgrounded, tab returned, unmuted".**
  `YTEvents.PAUSE` DESTROYS the music instance (a stopped-but-kept sound leaks one per cycle) and
  `RESUME` rebuilds it only if it would be audible — which, while the platform mute is on, it would
  not. So the unmute that followed reached `applyMusicAudibility`, found no instance to unmute, and
  returned: the bed was gone for the rest of the session, and nothing in the game brought it back
  short of walking to the menu, which starts the track itself. The music FADER had the same hole —
  a resume at level 0 left nothing for a later raise to act on. `applyMusicAudibility` now starts
  the remembered track when the level rises and there is no instance (never during a platform pause,
  which includes an ad — `RESUME` owns that restart). **Found by auditing this game against another
  submission's rejection** ("game audio only activates after the YouTube mute button is turned on and
  off"), and measured before it was fixed rather than reasoned about. → `tests/platform/audio.test.ts`
- **Blitz had no visible clock in landscape, which is the whole of the mode.** The countdown is
  appended to the status capsule, and the side panel HIDES that capsule — it is what the two lit
  blocks replace (`layoutHud`'s `statusText.setVisible(!panelled)`). So the one number the mode is
  played on was on screen in portrait and nowhere on the web build, where every desktop gets the
  panel. It is in the ACTIVE block's own line now (`Game.shotClockSeconds`), gold under two seconds,
  and it asks the same questions `tickShotClock` does rather than restating them — a number frozen
  at 5 under an idle block would be worse than none. → `tests/platform/panel.test.ts`
- **The daily's hint button was drawn across the second line of its own status.** The button's y is
  `top + statusText.height + gap`, and `bindLayout` runs its first pass from `create()` — where that
  text is still EMPTY, because `reset()` is the line after it. So the button was placed against the
  height of an empty `Text`, one line too high, on every phone that never resizes after boot.
  Reported with a screenshot of it sitting over "Clear the board in one shot". `refreshStatus` now
  re-lays the scene out, the same fix as `Game`'s capsule drawn around the PREVIOUS status. The
  daily was ALSO the one screen `layout.test.ts` had never opened, which is why nothing caught it;
  it has a case now, with the hint forced visible, and it reproduces the overlap on demand.
- **The tutorial's lesson block climbed onto the board on short phones.** It was centred in the
  trailing band and clamped only against the top bar and the bottom edge — so on a 1.77:1 phone,
  where a square board leaves a 152px band against a block that wants ~170, the clamp pushed it up
  until the lesson title was drawn across the board's last two ranks. Reported with a screenshot:
  "должно быть внизу". The block is now FITTED to the band (`measureBlock`, up to three passes
  because a `Text`'s height quantises to whole lines) and its ceiling is the board's own bottom edge
  — the same shape as `Game.layoutHud`'s `measureTrailingStack`, and the same `MIN_HUD_SHRINK`-style
  floor. Negative-controlled: reverting the ceiling fails exactly 360x640 and 375x664 and leaves the
  other four shapes passing. → `tests/platform/layout.test.ts`

- **The guided tour's spotlight pointed at empty background.** The step rectangles are SCREEN
  coordinates read from the host, and `Coach` read them once in `create()`; `layout()` re-placed the
  card on every resize and never re-asked, so the hole stayed frozen where the control had been.
  Measured: opened at 900x700 and widened to 2000x1020, the hole sat at x=302 while its button had
  moved to x=860 — which is exactly the screenshot it was reported with. A phone rotating, or a
  Playables frame settling to its final size a beat after boot, is the same event. **All seven steps
  were verified on a fresh open at four viewports first, and every one was on target** — the steps
  were never wrong, the moment they were captured was. `refreshSteps()` re-asks at the top of every
  layout and keeps the player's place by step TITLE rather than by index, because re-reading can
  change the list (a step whose target has no size is dropped) and a resize must not move somebody to
  a different card. → `tests/platform/coach.test.ts`
- **The tour's answers took 42% of a phone's width and the card took 92%.** Measured on the built
  bundle at 360x640, against 8% and 23% on a desktop — reported from a phone as buttons out of all
  proportion, and the numbers agreed. Two things compounded: this is a fixed-token kit (`compact` is
  168 design units whatever its label says) and `uiScale` floors at 0.8, so the tokens stop shrinking
  while the screen does not; and the card was being WIDENED past `CARD_MAX_WIDTH` to fit three
  answers on one line, which a narrow screen cannot do anyway — so the widening bought nothing and
  the row stacked, costing a whole extra row of height (258px of a 640px screen). The answer row now
  shrinks to the card instead, one line at every size: the phone's button is 33% and its card 188px
  tall, and the desktop card is back inside its own reading width. Exact in one division, because
  every token is `SIZES[size].w * scale` with no text metric to quantise, and floored at
  `MIN_ANSWER_SCALE`; the hit areas are untouched, since `gameButton` floors every one at
  `MIN_TOUCH_TARGET`.
- **The gear did nothing on three screens, and the tutorial's Finish did nothing on a fourth.**
  One cause, and it is a property of Phaser rather than of any of the four: `SceneManager.render()`
  loops `this.scenes` in FORWARD array order — the order `config.ts` registers them in — and
  `scene.launch()` does not touch it. `Settings` is registered at index 9; `Shop`, `Confirm`,
  `Tutorial`, `HowToPlay` and `Coach` all come after. So opening the settings panel from the shop,
  the tutorial or the rules page started the scene, paused its opener and drew the panel UNDERNEATH
  the opaque page that had asked for it, and the tutorial's ending `Confirm` went the same way. The
  screen was then frozen behind an invisible dialog, which is the worst version of this: the button
  reads as dead AND the page stops responding. Reported three separate ways from a phone.
  **The fix is not a reordering of `config.ts`** — that repairs today's list and breaks silently the
  next time a screen is appended after an overlay, which is the natural place to append one. Each
  overlay raises itself instead, from `platform/lifecycle.ts`'s `raiseOverlay`, which lives beside
  the list of what an overlay IS so the two facts cannot drift. → `tests/platform/overlays.test.ts`
- **A swipe could shrink the board for the rest of the round.** Reported as "мне удалось как-то
  махнуть пальцем и поле уменьшилось". `enterAimCamera`/`leaveAimCamera` are tweens, and **a tween
  writes nothing at the moment it is created** — its first value lands on the next update. The leave
  guard asked `cameras.main.zoom === fit.zoom`, so a press and a second finger inside ONE input tick
  ran: press starts the zoom-out tween (camera has not moved yet), `bindDrag` cancels the gesture,
  `leaveAimCamera` reads an unmoved camera, concludes there is nothing to undo, and returns — leaving
  the zoom-out running with nothing to reverse it. `cameraTargetZoom` records the INTENT and the
  guard reads that. All three board scenes carried the identical code and all three are fixed.
  → "Aiming", `Game`/`Daily`/`Tutorial`
- **The round pill was drawn across the coin badge at a four-digit balance**, and the badge plate was
  a size behind its own number. Both readouts in `ui/chrome.ts`'s top bar are sized from their own
  content, and neither was re-placed when the content changed: `setCoins` wrote the text and left the
  plate at the width it was last drawn, while `setRound` wrote `1 / 5` into a `Text` that had been
  positioned while it was still EMPTY — centred as if zero pixels wide, then growing symmetrically
  out of that centre. Measured at 360px with 2325 coins: badge to x=167, `1 / 5` from x=163.
  Reported as "налазит". The pill now sits in the free span between the badge and the gear, and both
  setters re-place what they resize. Same defect class as the status capsule drawn around the
  PREVIOUS status. → "The Board's HUD"
- **The hot-seat status capsule sat 25px right of the board's centre line.** Two people at one board
  have no third face to look at, so `Game` hides the opponent portrait — "hidden rather than skipped,
  so the HUD's layout arithmetic is unchanged", said the comment, and that was the bug. The capsule
  is centred on what is LEFT of the band after the portrait's column, so reserving a column nothing
  occupies pushes it right and leaves a hole where the face would be. Reported as "не по центру",
  about the capsule — the board was centred throughout. `Game.portraitColumn()` returns 0 outside
  solo play and is now the single place that sum is written. → "The Opponents"
- **The menu mascot was drawn under the lowest button on every short portrait phone.** Reported from
  a device, not measured into existence: the sprite crossed the Daily button by 26px at 320x568, 24px
  at 360x640 and 25px at 375x664. It is sized at 0.3 of the viewport's SHORTER side, which on any
  phone taller than it is wide is the WIDTH — so the character is the same 96-115px whether the band
  under the button column is 170px or 70px, and the three shapes where the stack comes down to meet
  it were the three that broke. It now shrinks to clear the lowest button, on the rule that the
  decoration gives way rather than the control. **The general overlap check could not have caught
  it** — see `test:platform`'s note on button faces — so the mascot has a case of its own, negative-
  controlled: reverting the fix fails exactly the three short shapes and leaves the other three
  passing. → "Responsive Layout", `MainMenu.layoutMascot`, `tests/platform/layout.test.ts`
- **Starting an aim tore the background open on one side, and pushed the board under the panel.**
  The world camera's focus carries the side panel's shift, which is a SCREEN-px offset and therefore
  a different number of world units at every zoom — and the two aim-camera moves centred on the bare
  `boardW / 2` instead, dropping it. Measured at 1400x700: the camera sat at 256 while the plate sat
  at 407, so the plate started 120 world units inside the view and the left edge showed `#3d1160`,
  the canvas clear colour. `focusFor(zoom)` is now the one formula, and the plate covers the union
  of the two views rather than the wider one. The negative control reverts `enterAimCamera` alone
  and fails exactly the landscape case while portrait — which has no panel and therefore no shift —
  still passes. → "Aiming", `tests/platform/layout.test.ts`
- **The settings mute buttons rendered as tofu on a phone.** They were emoji in a `Text`
  (U+1F507/1F508/1F50A), so what the control MEANT depended on the device owning that codepoint —
  and being icon-only buttons, there was no word to fall back to: nothing said whether sound or
  music was muted, or which row was which. Now `icon-sound-on/low/off`, drawn in the atlas by
  `make-atlas.mjs` and swapped through `gameButton`'s new `iconFrame`. The same commit deleted
  `assets.ts`'s dead `FRAMES` table, whose own comment warned that "leaving two things called the
  same in one file is how the wrong one gets loaded" — which is precisely what happened while fixing
  this: the three new frames went into the dead table first and typechecking caught it.
  **The navigation and the gear went the same way afterwards** (`icon-home`/`-shop`/`-modes`/
  `-gear`), which also let a nav tab's icon carry its active state — it is tinted gold with its
  label now, which an emoji could never be. **Then the two consumables** (`icon-retake`,
  `icon-power`), which needed `gameButton` to hold an icon and a label at once. Two things the
  drawing itself taught, both from measuring rather than looking: the retake's first shape was a
  circular arrow, geometrically right and an unreadable blob at the ~20px it is actually drawn at —
  it is the glyph's own hooked-arrow shape now; and the ink of every icon is measured against the
  set, because this one filled a 48px box where its neighbour on the next button filled 64, which a
  player reads as two different sizes.
  → "UI Kit", `tests/platform/layout.test.ts`
- **The background stopped covering the screen past 2000px wide, and the canvas showed through.**
  Reported from a wide desktop window as a bright violet band down the right-hand side with the gear
  button on it. `Modes`, `Shop` and `UiStand` painted their plate as
  `add.rectangle(0, 0, 4000, 4000).setOrigin(0.5)` — centred on the WORLD ORIGIN, so it covers ±2000
  and no further, and what showed beyond it was `config.ts`'s clear colour, a much brighter plum
  than the plate. The negative control reproduces it exactly: 439,656px of clear colour starting at
  **x = 2000**. → "Responsive Layout", `ui/chrome.ts`'s `createPageBackground`,
  `tests/platform/layout.test.ts`
- **Every scrolling list overran what was below it in landscape**, and one of them erased it. The
  three lists computed their height as `Math.max(80, bottom - top)`, a floor that on a short screen
  hands out pixels the screen does not have: the shop's rows ran 38px past the nav bar at 740x360
  and 8px past it at 844x390, and because a later camera owns its viewport's pixels the nav bar's
  icons were not covered but ERASED; the modes list ran under its own Start button with the first
  card's third line printed beneath it. → `ui/scrollRegion.ts`'s `listHeightBetween`
- **The menu's own column did not fit a short landscape, in both directions at once.** The wordmark
  hung a fixed 170 above a stack centred in the free band — two independent placements, neither of
  which looks at the band's edges — so at 640x320 the logo sat 25px ABOVE the top of the screen while
  the Daily button sat 11px INSIDE the navigation bar. It is now solved as one column: the buttons
  shrink (their tap targets do not — `gameButton` floors every hit area at `MIN_TOUCH_TARGET`), and
  if it still does not fit, the LOGO goes, on the same rule that drops the modes heading — the row
  that carries no function leaves first. → `MainMenu.layout`
- **The board's side panel put a button off the top of the screen.** Its four actions split into two
  rows per pair when a pair does not fit the panel's width; at the panel's 280-unit minimum BOTH
  pairs split, and four rows of buttons are 291px of a 374px panel. The blocks give way first and
  they have a floor, so what gave next was the top of the panel: the retake button was drawn over
  the opponent's name at 844x390 and at **y = -6** at 740x360. Two rows is the budget, and a pair
  that does not fit is shrunk to fit it — **by iteration, not by one division**, because a button's
  width is text metrics plus padding and does not scale proportionally: the single-shot factor
  landed the pair at 262 against 261 of room, over by one pixel, and split into four rows again.
  → `Game.layoutPanel`

- **The artillery rider was gold on a gold disc, on three piece sets out of five.** Reported from the
  live game as "непонятно шото" with a screenshot. `METAL.mid` is `ffc23c` against the player ramp's
  `f5b52e` — the same colour twice — and `classic`, `ember` and `bone` all put the player near hue
  40; the only thing separating rider from disc was a 4px contour on a 128px texture, i.e. 1.2px once
  a disc is drawn at the 37px it occupies on a phone. **The reason it shipped is the interesting
  part**: `npm run sheet` is this project's instrument for exactly this class of bug and it draws
  discs BARE, because the emblems lived inside a Phaser module no node script could execute. Fixed by
  moving the geometry to `src/board/emblems.ts` (no Phaser), adding `npm run sheet:branches`, and
  giving every rider a cast shadow — which also says the true thing, that a rider is a separate piece
  sitting on top. → "Skins", `src/board/emblems.ts`
- **And the artillery rider did not read as a gun even once it was visible.** Three attempts before
  this one: a muzzle brake read as a hammer, the bar-on-a-block left after removing it read as an
  anvil, and a barrel between two wheels seen from above put barrel and trail on one vertical line
  and read as a plumb bob. The finding, which is worth more than the fix: **a gun from directly above
  has no silhouette** — everything that says "gun" (barrel length against its mount, the wheel beside
  it, the trail raking back) is what the top-down view collapses. The tank survives the same view
  because a turret from above genuinely IS a circle with a barrel. So artillery is drawn in profile,
  which the set can carry: the marks beside it are heraldic already (crossed rifles are the infantry
  insignia, not a rifle seen from above), so there was never a consistent projection to break.
- **Solving the daily puzzle produced no result panel at all.** A sound and two lines of HUD text, on
  the one screen whose entire purpose is a once-a-day moment — while a mere round of a match raises
  `MatchResult`. → "The Daily Puzzle", `scenes/DailyResult.ts`

- **The game froze after a win, every time but the first.** `MatchResult` is `launch()`-ed five
  times a match, and Phaser re-uses the scene INSTANCE — but `create()` never cleared `badges`,
  `badgesShown` or `strip`. The second panel's `overlay.panel.add()` loop therefore handed
  `Container.add` a `Graphics` Phaser had already destroyed on the previous `SHUTDOWN`, which throws
  `Cannot read properties of undefined (reading 'sys')` from inside `removeFromDisplayList`. The
  panel never appeared, and `Game` — paused on the line before `launch()` — stayed paused with
  nothing on screen able to resume it. Fix: reset all three at the top of `create()`. The general
  rule is worth more than the fix: **every field a scene's `create()` writes must be cleared by the
  next `create()`** — `Shop`, `UiStand`, `MainMenu` and `Modes` all already did this, and
  `MatchResult` was the one that did not.
- **A saved match resumed into a board with nothing left to shoot at.** Found by playing a match
  rather than by reading it. `finishRound` persists after `recordRound`, so the record it writes is
  a decided round on a just-cleared board; leaving from the round-result panel makes that the last
  save. `Continue` then restored a field with no opponent on it and a round whose `winner` was still
  `null` — "Your shot" forever, which is a freeze to whoever is holding the phone. Fix:
  `savedRoundIsOver()` in `game/persistence.ts`, asked on the resume side so it covers every writer,
  and the next round is started rather than the match dropped. → "The Match"
- **The status capsule was drawn around the PREVIOUS status.** `refreshStatus()` set the text and
  returned without re-laying the HUD out, so the plate stayed sized for whatever the line said last
  — and the status grows from one row to three as a round announces itself. Symmetrical about the
  band and therefore invisible, right up until the opponent's portrait took the column to its left
  and the overflow started running across a face. Fixed by calling `layoutHud()` after the `setText`,
  like the two branches above it already did. → "The Opponents"
- **The opponent's line was laid out into the consumable buttons.** In portrait orientation the HUD
  block was `status + gap + buttons`; the speech row was drawn under the status and counted by
  nobody, so a quip and the retake button occupied the same pixels. `SPEECH_ROW_HEIGHT` reserves it
  whether or not a line is up — reserved rather than measured, so the buttons do not jump down every
  time a character speaks.
- **The status capsule could be wider than the band it sits in.** It was never wrapped, and on a
  phone in landscape the band is ~235px: "Round 1/5 · Infantry" on one line made the block wider than
  the band, which pushed the portrait five pixels off the left edge of the screen. The status now
  wraps to what is left of its band after the portrait's column, and `speakerColumnX` clamps the
  block back inside — left last, so a block that genuinely does not fit keeps the FACE whole and
  lets the capsule overhang.
- **The voice's `gain` argument never reached the sound, and had not since the voice shipped.**
  `playVoiceMarker` assigned `voiceSound.volume` and then called `play(marker, { detune })`, which
  looks equivalent and is not: Phaser stores a config per MARKER and `play` applies it over the
  instance, so the assignment was immediately overwritten by whatever volume that marker was last
  played at — and since every play wrote the same config, the level froze at the first one. Measured:
  gain 0.25, 1 and 2 all came out at 0.6736. Everything riding on `gain` was silently inert: the
  per-syllable loudness wander, the `triumph`/`alarm` moods' +10%, and an exclamation being louder
  than a statement. Fix: the level goes in the play config. Measured after: 0.09 / 0.30 / 0.54 for
  gains 0.3 / 1 / 1.8, linear. → "The Dialogue Voice"
- **Type-only imports written as value imports broke every `node`-run script that reached the save
  layer.** `save/save.ts` and `save/store.ts` both did `import { DEFAULT_SAVE_STATE, SaveState }`;
  Node's native TS stripping turns that into a runtime lookup and dies with "does not provide an
  export named 'SaveState'". Nothing noticed because no `verify:*` script or test had ever imported
  the save layer — the regression test above was the first, and it failed on this before it could
  fail on anything else. Both are `import type` now.
- **`Daily` had no way out, and winning made it worse.** The screen carried a bare `⚙` and nothing
  else: the only exit was the `BACKSPACE` key, which a phone does not have. Solving the puzzle then
  disabled both remaining interactions — `beginAim` refuses once `done`, and the retry is gated on
  NOT having solved it — so a player who cleared the board was on a screen where every tap did
  nothing. Fix: `Daily` wears `ui/chrome.ts`'s shared top bar like every other screen, which brings
  a back button, the 44px floor on both icons, and the standard coin readout.
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

- **An overlay's "runs after the opener has been resumed" callback runs after the resume is
  REQUESTED, not after it has happened, and the difference is a real shipped bug.** Phaser QUEUES
  scene operations: `scene.resume(key)` schedules the resume for the manager's next pass, so a
  callback fired on the line after it still sees the opener paused and, critically, still sees any
  state that the opener's own `RESUME` handler is responsible for updating. `Modes.askRival()` was
  caught by exactly this — it raises a `Confirm`, sets a `leaving` guard, and clears that guard in a
  `RESUME` listener; both of the dialog's answers begin by checking the guard, so both bailed out on
  a departure that had already finished. The dialog closed and nothing happened, on every pick, and
  the match could not be started at all. **Anything a callback needs cleared must be cleared BY the
  callback**, not by a listener waiting on a queued event — see `Modes.afterRival()`. The ordering
  that `MatchResult`, `DailyResult` and `Confirm` all document is still worth keeping: it is enough
  for a callback that STARTS something, and not enough for one that reads a flag.

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
- **A hidden browser tab freezes the whole Phaser loop, and almost nothing says so.** `game.loop.running`
  stays `true`, the scene reports active/visible/unpaused, `setZoom()` and other immediate calls work,
  input events still fire and still resolve correctly — but `game.loop.frame` never advances, so
  tweens and camera effects register (`isPlaying()` true, `zoomEffect.destination` set) and then sit
  at `progress: 0` forever. Automated browser checks run in a tab that is usually hidden, so anything
  time-based looks broken there and is not: an entire "Phaser's camera effects don't tick in this
  build" diagnosis was made and retracted on this. Check `document.hidden` before believing an
  animation is broken, and drive the loop by hand — `game.loop.step(game.loop.time + dt)` in a
  loop — to test anything animated.

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
