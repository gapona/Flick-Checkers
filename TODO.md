# TODO / Backlog

`GAME-PLAN.md` §10's chunk list is complete. What is left is the work the plan itself defers to
people rather than to code, plus one piece of infrastructure worth lifting when it is next needed.

## 1. The calibration pass — the measurable half is DONE

**Status: the arithmetic is measured and acted on; the taste question is still a taste question.**
§11 asks for a play session to decide whether the friction feels right, and nothing here replaces
that. What this pass did was measure the thing the feeling stands on, which had never been measured,
and it found the recorded symptom to be **wrong**.

Run `npm run verify:feel`. It reports two numbers per branch, both with thresholds written into §11
before the first measurement:

| | what it is | allowance |
|---|---|---|
| **долёт** | the pull that just touches the nearest enemy from the opening rank | ≤ 0.60 |
| **наказание** | share of full-power shots over the bot's ±25° cone that cost the shooter its disc | < 50% |

**What this entry used to say, and why it was wrong.** "A full-power shot travels 11.5 cells across
an 8-cell board, so a straight full-strength shot usually posts your own disc off the far edge."
Measured: infantry loses the shooter on **23.8%** of full-power shots in the bot's own aiming cone
and takes an enemy on **81%**, because 81% of those shots CONNECT and a head-on contact between equal
masses leaves the shooter nearly stopped. The 11.57-cell figure describes a shot into empty board.

**What was actually wrong** was the other end of the gesture: `sqrt(6.2/11.57)` = 0.73 of the pull
bought nothing but arriving, so the bottom two thirds of a thumb's travel did nothing from the
opening. Fixed by `sim/types.ts`'s new `POWER_CURVE` (0.6, was an implicit 1), which moves долёт to
0.597 without touching наказание at all — full power is a fixed point of the curve. `MAX_SPEED_CELLS`
and `FRICTION_DECEL_CELLS` were both eliminated first, and provably: a full-power miss survives only
below 7.5 cells of reach, the draggiest branch reaches the enemy only above 8.5, and that window is
empty. `MAX_DRAG_CELLS` is untouched and is pure ergonomics — it cannot be measured from here.

**Still open, and only a person with a phone can close it**: whether the result feels right. Two
threshold failures are shipped deliberately and documented in §11 — tanks' долёт (a short reach IS
that branch's character, the same argument §4 already used to exempt stacked branches from its travel
threshold) and artillery's наказание at 53.6% (four discs set wide, so a third of the cone meets
nothing at all; a formation question, not a friction one).

## 1b. The first-move sensitivity — moved, and the blocker has a name now

**Status: measured again, at the shipped values, and improved.** The §11 pass above is also the
biggest thing to happen to this entry, because the curve turned out to interact with §3's skew
through exactly one branch.

Numbers at 400 rounds a side, tanks, first-shooter win rate: **64.0 ±2.4** on the old build,
**84.8 ±1.8** with the new curve and the old ×1.40 friction, **57.5 ±2.5** with the new curve and
×1.15. The mechanism is the useful part: tanks' full reach is 8.2 cells against the 6.08 they must
cross, so under the old curve the bot's middle powers could not reach AT ALL, a tanks round ran 12.2
shots of mutual flailing, and that flailing DILUTED whoever shot first. Make the middle powers land
and the dilution goes away with them.

The general lesson, which is what to carry forward: **a per-branch physics number is only valid
against the global mapping it was tuned under.** ×1.40 was correct and measured; it was stale the
instant `POWER_CURVE` moved.

What has NOT changed:

- The round-level skew is still high (66.6% at Hard on the old build; re-measure after this pass) and
  is still compensated by the loser-starts rubber band rather than by the mechanic.
- **Infantry is still the worst-skewed branch** and is still untouched. It is the obvious next
  candidate now that §11's calibration question no longer rides on its friction number specifically.
- **`splitImpulse` per branch** remains untried, and is still the one axis where mass does anything.

## 2. §11's third open question — should bumpers be the default?

**Note before anyone measures this:** `bumper` used to be unwinnable (bouncing rim, no sink, so no
disc could ever leave) and now ships with `pits` on. It is therefore a different mode from the one
§11 asked about — "bank off the walls" has become "bank into a hole", and rounds run about twice as
long. Any earlier intuition about it is intuition about a mode that could not be finished.

"Classic without bumpers is a game where half your shots lose your own disc. Check on live people
whether that puts them off; if so, bumpers become the default and classic becomes a mode."

Both boards exist and are one line apart (`game/rules.ts`'s `DEFAULT_RULES_ID`). Only players can
settle it.

## 3. The official Playables Test Suite

**Status: not run.** It is an external tool
(https://developers.google.com/youtube/gaming/playables/test_suite) that a human points at a served
build.

- Point it at **`npm run preview`**, never `npm run dev` — see CLAUDE.md "Build Guards & Asset
  Policy" for why a red "SDK loaded before any game code" from dev mode says nothing about the
  shipped artifact.
- `npm run bundle` produces `build/flick-checkers-<version>.zip`, which re-verifies the
  certification-critical script order and the absence of root-absolute paths before zipping.
- Expect the signed-in/signed-out save paths and the mute-state edge cases to be where anything
  surfaces: everything in `src/platform/` has only ever run against the SDK stubs.

## 4. Port the browser test suite from `../Checkers`

**Status: started — the harness and the first file are in.** `npm run test:platform` boots the built
bundle in a real Chrome and walks menu → mode → rival question → gallery → board, both seatings.
What prompted it was a shipped bug that every other check in the repo was blind to; it now fails on
demand if that fix is reverted. **What is still unported**: boot order, the pause hierarchy, save
round-trips, and `layout`/`input`/`camera`. Original note follows.

**Was: not started**, and the case for it is stronger now than when this was first written — the
platform layer is unchanged since the port, but there is a great deal more scene code above it.

`../Checkers` has a working suite: `tests/platform/*.test.ts`, plain `node:test` driving
`playwright-core` against a real `vite preview`. Every scenario in it is a bug that was actually hit,
and those bugs are all in *this* codebase because this codebase is that one's platform layer. Take
`harness.ts` first, then `boot`, `pause`, `save`, `layout`/`input`/`camera`.

Two harness gotchas already documented in CLAUDE.md ("Audio Layer") that the ported helpers must
keep: a dynamic `import()` from a test resolves to a DIFFERENT module instance than the one
`main.ts` initialised, and WebAudio's `mute`/`volume` are `AudioParam` automation, so a read-back in
the same tick can return the stale value.

## 5. Rename the sound cues (the rest of S10/S12b)

~~**The atlas.**~~ **Done, and this entry used to say otherwise.** `public/assets/atlas/game.webp`
is this game's own set — five frames (`icon-coin`, `rim-strip`, `rim-corner`, `particle-spark`,
`particle-shard`), 5.9 KB. No elliptical draughts pieces, no crowns. The discs were never going to
be atlas frames: they are recoloured per skin at runtime, and a baked colour sprite cannot take part
in that.

**What is still from draughts is the SOUND set**: `promote`, `capture`, `move` are used for
roles in THIS game with the mapping written down in `src/assets.ts`. Nothing is wrong at runtime — a cue
plays correctly under a misleading name — so this is tidying. It costs a `scripts/make-audio.mjs`
rename pass plus the `src/assets.ts` mapping, and needs `ffmpeg` with libvorbis on PATH, which is
the only reason it has not happened.

## 6. Tried and rejected: a material plate under the board

**Do not propose this again without reading this first.** The idea was to give the playing surface a
material — lacquer, felt, painted metal — as one 1024×1024 plate per skin, multiplied over the flat
square fills. The board bakes into a single `RenderTexture` at one fixed size, so the plate is
stamped exactly once and never tiles, which made it look like a free win.

Four plates were generated (SDXL, via `Remotion/src/scripts/gen_chapaev_skins.py::boardplates`) and
composited over the real board colours at the real on-screen sizes. The idea failed on its own
merits, three separate ways:

- **Multiply always darkens.** All three usable plates dropped the board's value by roughly a
  third, which undoes the palette in `boardView.ts` and would force a compensating change to the
  tile constants — i.e. the plate's main effect was the one thing two constants already do.
- **The good plate is invisible and the visible plates are bad.** The only genuine material (a fine
  even felt grain) is imperceptible at a 390px board; the two with texture big enough to see read as
  *dirt and wear on the playfield*, which is worse than no material at all.
- **Per-skin materials make the set look careless**, not varied: one flat, one grained, one cloudy.
  The skin already changes the board's colour, and that is the axis that was actually wanted.

If a material is ever wanted, the evidence points somewhere specific: a **single** fine grain shared
by every skin, generated by a seeded PRNG in `scripts/make-atlas.mjs` (so provenance stays
arithmetic and no asset ships), applied with a **value-neutral** operator — overlay/soft-light
around mid grey, or symmetric noise — never multiply.

## 7. Smaller things noticed and left

- **`bindPan` has no caller.** Kept because a board wider than 8×8 is the one thing that would bring
  the need for a pan gesture back. See CLAUDE.md "Input Actions".
- **The daily has no missed-day repair.** §7 mentions it as an existing mechanic worth carrying over;
  `daily/streak.ts`'s `recordDailyFailed` is deliberately a documented no-op rather than absent, so
  nobody adds a write there without noticing what it would allow.
- **`store/metadata.json` has no thumbnails.** `check-bundle` validates any that are declared; the
  images themselves are a submission asset nobody has made yet.

## 8. The art direction, past the part that is built

The board palette, the perimeter band and the four backgrounds are done. Four steps of the same
direction are not, and they are all code — no assets, nothing to generate. They are listed in the
order they should happen, because each one makes the next cheap:

1. ~~**Move the skin recolour into the runtime.**~~ **Done** — `src/game/skins.ts`, seven board sets
   and five disc sets, worn independently. `npm run sheet` renders the whole matrix.
2. ~~**Two slots instead of one.**~~ **Done** — `SaveState.skins.board` / `.pieces` are read apart,
   priced apart and equipped apart; shop item ids are namespaced so one `purchases` list can hold
   both wardrobes.
3. ~~**The swatch in the shop row.**~~ **Done** — `src/board/swatch.ts`, in the row's reserved
   column via `rowButton`'s new `setSlot()`. Generated from the live palettes and stamped by
   `boardView.ts`'s own `bakeTiles()`, so it cannot drift from the product.
4. ~~**Branch marks.**~~ **Done**, and twice: first as three strokes, then as constructed emblems
   chosen and measured at the 26px they actually occupy — crossed rifles, a horseshoe, a swept-wing
   aircraft, plus redrawn stack riders. SDXL was tried for these and **measured out**: 0 of 21
   renders produced the right object surviving the size gate, against 7 of 7 for constructed shapes.
   The evidence is in `Remotion/src/scripts/gen_chapaev_emblems.py`; do not re-run that experiment.
5. ~~**The shop does not scroll.**~~ **Done** — it uses `ui/scrollRegion.ts`'s
   `scrollableCameraRegion()`. It had to: ten rows at 72px plus gaps is 810px of list, which fits no
   phone, and the wardrobe split into boards and pieces put it past stacking's reach.

`ART-SOURCES.md` records what generated art may ship and on what terms; read it before adding any
image, and note that `check-bundle` now fails the build without a row.

**One finding worth keeping if more backgrounds are ever made**: the generator pipeline this set
came from guards `centerDetail`, on the rule that the middle of the plate must be the calmest part.
That rule is inherited from the draughts game and is *inverted here*. The board covers the middle;
what a portrait phone actually shows is the top and bottom bands — and those bands are exactly
where this game's HUD sits (coin badge and gear above, status and the consumable buttons below).
Judge a background on its bands, not its centre.

## The music bed's licence is named but not cleared

`public/assets/audio/music.ogg` is no longer the procedural chord bed — it is a Stable Audio track,
gain-matched to the bed it replaced and shipping under a row in `AUDIO-SOURCES.md` that names the
model and stops short of clearing it. Two things are open before submission, both in that file's own
note: **which Stability AI terms apply** (hosted service versus open weights — they are different
documents, and neither is the CreativeML Open RAIL++-M every image in this repo stands on), and the
**prompt and seed**, which were not recorded and cannot be recovered from the file. An unresolved
copyright claim on music is one of the most common Playables rejection reasons, and the build gate
cannot catch this one: `check-bundle.mjs` only checks that the filename appears in the registry.

`npm run audio -- --music` puts the generated bed back, in one command, if the answer comes back
wrong. Plain `npm run audio` no longer touches the file.
