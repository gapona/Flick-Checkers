/**
 * Every palette in the game, as data.
 *
 * **No Phaser** — same rule as `game/rules.ts`, `game/economy.ts` and `src/sim/`. A skin is a
 * handful of numbers; the two modules that turn them into pixels (`board/discTextures.ts` and
 * `board/boardView.ts`) import from here and this file imports nothing back.
 *
 * ## Why the sets are recoloured rather than written out
 *
 * `scripts/make-atlas.mjs` builds its whole skinned sprite set by taking ONE authored ramp and
 * replacing its hue, keeping lightness and optionally scaling saturation. That is not a shortcut —
 * it is what guarantees every set is the same art under a different light, so a set cannot
 * accidentally be flatter, glossier or heavier than another. The same recipe runs here, at
 * runtime, which is the whole reason a skin can now change the DISCS and the BOARD and not just
 * the wallpaper behind them.
 *
 * Adding a set is therefore two or three numbers and a row, never a new set of hand-picked hexes.
 *
 * ## The rule that keeps 7 boards × 5 piece sets legible
 *
 * The two slots are independent (`SaveState.skins` is `{ board, pieces }`), so the player can
 * combine any board with any piece set — 35 combinations, and nobody is going to check them by
 * hand every time a set is added. Legibility is therefore made structural instead of curated:
 *
 * - **Boards stay dark and low-chroma.** They are a ruler, not a playfield (`board/boardView.ts`).
 * - **Piece sets stay light and chromatic**, and every disc keeps the thick dark contour.
 *
 * A light or saturated board would break that guarantee for every piece set at once, which is why
 * `lum` scales below sit at or under 1.05 and warm boards carry a deliberately low `sat`.
 * `scripts/render-skin-sheet.mjs` renders the whole matrix so the claim can be looked at rather
 * than believed — the draughts project caught its one real palette collision on a contact sheet,
 * not by reading numbers, and that lesson is why the sheet exists.
 */

import { ATLAS_FRAMES, DEFAULT_SKIN, isSkinId, type SkinId } from '../assets'

export interface Ramp {
  light: number
  mid: number
  deep: number
}

// -- colour maths ---------------------------------------------------------------------------

interface Hsl {
  h: number
  s: number
  l: number
}

function toHsl(rgb: number): Hsl {
  const r = ((rgb >> 16) & 0xff) / 255
  const g = ((rgb >> 8) & 0xff) / 255
  const b = (rgb & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

function fromHsl({ h, s, l }: Hsl): number {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  const to255 = (v: number): number => Math.max(0, Math.min(255, Math.round((v + m) * 255)))
  return (to255(r) << 16) | (to255(g) << 8) | to255(b)
}

/**
 * The atlas generator's recolour: hue replaced outright, lightness kept, saturation and lightness
 * optionally scaled.
 *
 * Hue is REPLACED rather than rotated. Rotating preserves the relative spacing inside a ramp, which
 * sounds better and is worse: the authored ramps already put their three stops at the same hue, so
 * rotation and replacement agree on them, while replacement also guarantees that two stops of a
 * recoloured ramp can never drift apart into a set that reads two-toned.
 */
export function recolour(rgb: number, hue: number, sat = 1, lum = 1): number {
  const hsl = toHsl(rgb)
  return fromHsl({
    h: hue,
    s: Math.max(0, Math.min(1, hsl.s * sat)),
    l: Math.max(0, Math.min(1, hsl.l * lum)),
  })
}

/**
 * Relative luminance, sRGB-decoded — the real perceived brightness, not HSL's `l`.
 *
 * **The two are not interchangeable and assuming they were is a bug this file already shipped
 * once.** HSL lightness is a coordinate, not a measurement: a green and a blue at the same `l`
 * differ in perceived brightness by more than two to one, because the eye is roughly ten times
 * more sensitive to green than to blue. Scaling `l` uniformly across seven hues therefore produced
 * a set where the green, olive, amber and wine boards read visibly lighter than the teal and blue
 * ones — breaking the one invariant this file's header promises — and it was invisible in the
 * recipe numbers, which all looked identically conservative. The contact sheet is what caught it.
 */
function luminance(rgb: number): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((rgb >> 16) & 0xff) + 0.7152 * channel((rgb >> 8) & 0xff) + 0.0722 * channel(rgb & 0xff)
}

/**
 * Darkens a colour until it measures at most `max`, keeping hue and saturation. Never lightens.
 *
 * **A ceiling, not a target, and the difference is the second bug this file has had here.** The
 * first fix normalised every board ONTO the default's luminance, which is worse than the problem:
 * blue is intrinsically dark, so forcing it up to a teal's brightness turned `ink` — the set whose
 * entire identity is "nearly black" — into pale cornflower, and pushed `crimson` to pink. Equal
 * luminance fights hue identity, because hues do not arrive equally bright and should not leave
 * that way.
 *
 * What the invariant actually needs is one-sided: no board may be BRIGHTER than the reference. A
 * set that lands darker is not a defect, it is a set with a dark hue, and `ink` leans on exactly
 * that.
 *
 * A bisection rather than a formula because the sRGB transfer curve is not analytically invertible
 * through an HSL round trip; 18 halvings land far inside an 8-bit channel step, and this runs a few
 * dozen times at boot.
 */
export function capLuminance(rgb: number, max: number): number {
  if (luminance(rgb) <= max) return rgb

  const hsl = toHsl(rgb)
  let lo = 0
  let hi = hsl.l
  let out = rgb
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    out = fromHsl({ h: hsl.h, s: hsl.s, l: mid })
    if (luminance(out) < max) lo = mid
    else hi = mid
  }
  return out
}

export function recolourRamp(ramp: Ramp, hue: number, sat = 1, lum = 1): Ramp {
  return {
    light: recolour(ramp.light, hue, sat, lum),
    mid: recolour(ramp.mid, hue, sat, lum),
    deep: recolour(ramp.deep, hue, sat, lum),
  }
}

// -- piece sets -----------------------------------------------------------------------------

/**
 * The two authored disc ramps every piece set is recoloured from — the same two
 * `scripts/make-atlas.mjs` opens with, duplicated here rather than imported because that file is a
 * dev-only `.mjs` with a `@napi-rs/canvas` dependency that must never reach the bundle. If a stop
 * changes there, change it here.
 */
const BASE_PLAYER: Ramp = { light: 0xffe6a0, mid: 0xf5b52e, deep: 0xb86a10 }
const BASE_OPPONENT: Ramp = { light: 0xe2b6ff, mid: 0x9b4dff, deep: 0x5a1c9c }

export const PIECE_SET_IDS = ['classic', 'ember', 'tide', 'bone', 'bloom', 'copper', 'signal', 'amethyst'] as const
export type PieceSetId = (typeof PIECE_SET_IDS)[number]
export const DEFAULT_PIECE_SET: PieceSetId = 'classic'

interface PieceRecipe {
  playerHue: number
  playerSat?: number
  /**
   * Scales the ramp's HSL lightness — the knob a set needs when its two sides must differ by VALUE
   * rather than by hue.
   *
   * Added by chunk 11's contrast pass, and `bone` is why: its comment claimed its sides were "told
   * apart by lightness alone" while the two recipes carried no lightness difference at all, so they
   * measured 1.02:1 apart and were one side in greyscale. A claim about brightness with no term for
   * brightness in it is a claim nothing was enforcing.
   */
  playerLum?: number
  opponentHue: number
  opponentSat?: number
  opponentLum?: number
}

/**
 * Five sets, and they are deliberately not five hue rotations of the same idea.
 *
 * `classic` is warm-vs-cool, `ember` warm-vs-warm, `tide` cool-vs-cool, `bloom` is the loud one,
 * and `bone` moves along the SATURATION axis instead of the hue one — its two sides are told apart
 * by lightness alone, which is also the set that proves the art survives without colour at all
 * (the same argument `frost` makes among the boards). A catalogue of five rotations would have
 * been five of the same product.
 */
const PIECE_RECIPES: Record<PieceSetId, PieceRecipe> = {
  classic: { playerHue: 40, opponentHue: 270 },
  ember: { playerHue: 32, opponentHue: 352 },
  // Hue 248 is intrinsically dark, so a saturated blue at the authored lightness measured the same
  // grey as a light tile and the whole set vanished on five of the seven boards. Lifted rather than
  // dropped: "boards dark, pieces light" is the invariant that keeps 35 combinations legible, and a
  // piece set that fixes itself by getting darker has moved to the board's side of it.
  tide: { playerHue: 186, playerSat: 0.85, opponentHue: 248, opponentSat: 0.72, opponentLum: 1.12 },
  bone: { playerHue: 40, playerSat: 0.18, playerLum: 1.26, opponentHue: 250, opponentSat: 0.22, opponentLum: 0.91 },
  bloom: { playerHue: 95, playerSat: 0.85, opponentHue: 322 },

  /**
   * **Asymmetric saturation: one side is metal, the other is stone.**
   *
   * Every set above gives both sides the same treatment — both chromatic, or both drained. This is
   * the first where one side carries colour and the other carries none, which reads as two different
   * MATERIALS on the board rather than two teams in different strips. It is also the least
   * hue-dependent pair in the set, so it is the one that survives a bad screen.
   */
  copper: { playerHue: 22, playerSat: 1.05, opponentHue: 208, opponentSat: 0.2, opponentLum: 1.12 },

  /**
   * **The pair chosen for eyes rather than for mood, and the only one where the PLAYER is cool.**
   *
   * Blue against orange is the standard dichromat-safe combination, and not one of the five sets
   * above is safe for one: `ember` is orange against red and `bloom` is green against magenta, which
   * are the two textbook confusions. The disc contour and `verify:contrast`'s greyscale check mean
   * no set is unplayable without colour — but "not unplayable" and "reads instantly" are different
   * claims, and this is the set that makes the second one.
   *
   * It also inverts the habit: gold is the player's base ramp, so every set but `tide` leaves them
   * warm. Here the player is the blue one.
   */
  signal: { playerHue: 205, playerSat: 0.95, playerLum: 1.06, opponentHue: 32, opponentSat: 1.0 },

  /**
   * **Placed by measurement rather than by mood — it is the pair furthest from the other seven.**
   *
   * The first attempt at an eighth set was a pale player against a deep one, and it duplicated
   * `bone`: 4.5 Lab units apart on the nearer side, where the tightest pre-existing pair in the
   * catalogue (`classic` and `ember`) sits at 16.5. Two sets built on the same idea is exactly what
   * this file's header says the five originals were arranged to avoid, and it is not visible in the
   * recipe numbers — the hues differed, the IDEA did not.
   *
   * So this one was chosen to maximise the minimum distance to everything already here: a violet
   * player against a lime opponent, on the two hue bands nothing else occupies. It is also the only
   * set where the player is the deeper, more saturated side and the opponent is the bright one,
   * which is every other pairing in the game turned round.
   *
   * The name is the one `../Checkers` gives its violet skin — the game this catalogue was compared
   * against when somebody asked whether it had more sets. It has seven combinations; this has 56.
   */
  amethyst: { playerHue: 288, playerSat: 0.9, opponentHue: 78, opponentSat: 0.95, opponentLum: 1.06 },
}

export interface PieceSet {
  id: PieceSetId
  player: Ramp
  opponent: Ramp
}

export function pieceSet(id: PieceSetId): PieceSet {
  const r = PIECE_RECIPES[id]
  return {
    id,
    player: recolourRamp(BASE_PLAYER, r.playerHue, r.playerSat ?? 1, r.playerLum ?? 1),
    opponent: recolourRamp(BASE_OPPONENT, r.opponentHue, r.opponentSat ?? 1, r.opponentLum ?? 1),
  }
}

export function isPieceSetId(value: string): value is PieceSetId {
  return (PIECE_SET_IDS as readonly string[]).includes(value)
}

// -- board sets -----------------------------------------------------------------------------

/**
 * How a board draws its grid, as opposed to what colour it is.
 *
 * This is the half of "more varied boards" that a hue cannot supply, and every option here is a
 * different answer to the same question — how loudly should a ruler speak?
 *
 * - `checker` — the alternating squares of the physical game. The loudest, and the default.
 * - `inset`   — the same alternation, but each cell inset inside a gutter, so the board reads as
 *               tiles laid on a base rather than as a painted surface.
 * - `ruled`   — one flat field with thin ruled lines on the cell boundaries. The quietest, and the
 *               most on-thesis: it says "here is the distance" and nothing else.
 * - `dots`    — one flat field with a small mark at each cell corner. Quieter still than `ruled`,
 *               and the only style with no continuous line for the eye to follow.
 *
 * `game/formations.ts`'s cavalry reads `isDarkSquare()` for its opening, so the dark squares still
 * EXIST in every style — `ruled` and `dots` simply do not paint them. That is a deliberate
 * asymmetry between the geometry and the art, and it is safe precisely because the grid is never
 * consulted again after the pieces are placed.
 */
export const BOARD_STYLES = ['checker', 'inset', 'ruled', 'dots'] as const
export type BoardStyle = (typeof BOARD_STYLES)[number]

export const BOARD_SET_IDS = ['default', 'emerald', 'sunset', 'frost', 'sand', 'ink', 'crimson', 'plum', 'moss', 'slate'] as const
export type BoardSetId = (typeof BOARD_SET_IDS)[number]
export const DEFAULT_BOARD_SET: BoardSetId = 'default'

/** The authored tile pair, at the petrol-teal the default set ships — see `board/boardView.ts` for
 * why it is dark and low-contrast rather than the bright draughts pair it replaced. */
/**
 * The authored tile pair — and it is a pair, not two colours: the dark one is DERIVED from the
 * light one at a 2:1 luminance ratio, which is the whole specification of this surface.
 *
 * **2:1 is a measurement, and it was 1.41:1 before chunk 11 measured it.** The tiles are a ruler:
 * they carry no rules, and their only job is to let the eye judge a distance and therefore a force.
 * Too close together and there is no ruler; too far apart and the board starts reading as a
 * draughts board, competing with the discs for the attention that aiming needs. The pair was
 * originally chosen for "dark and close together" and landed a long way under the ratio that makes
 * the grid do its job.
 *
 * The fix lowered the LIGHT tile as well as the dark one, which was not the obvious half. Holding
 * the light tile and dropping only the dark one reaches 2:1 too — but the light tile is the
 * brightest pixel the board can produce, and it was already close enough to a violet disc's mass
 * that `classic` and `tide` measured under 1.35:1 against it. One change, two invariants.
 */
const BASE_TILE_LIGHT = 0x2b677a
const BASE_TILE_DARK = 0x173741

interface BoardRecipe {
  hue: number
  /** Scales the authored saturation. Warm boards carry a low value on purpose: a saturated warm
   * board and the gold player discs are the one combination that cannot be made to read. */
  sat?: number
  /**
   * Scales the set's luminance CEILING, not its HSL lightness — see {@link luminance} and
   * {@link capLuminance} for why both halves of that matter. `1` means "no brighter than the
   * default board measures", which is what every set should have unless it is making a deliberate
   * statement; `ink` is the only set that does.
   */
  lum?: number
  style: BoardStyle
  /**
   * Which background plate to wear when this set has no plate of its own yet.
   *
   * `assets.ts`'s `SKIN_IDS` is the list of background files that actually SHIP, and a board set
   * whose id is in that list always wears its own — see {@link resolveBackground}. This field only
   * catches the gap while a new set's plate is still being generated, so adding the file and adding
   * its id to `SKIN_IDS` is the whole of switching a set over to its own scenery.
   *
   * **No set declares one today** — all ten wear their own plate. It is kept because it is the
   * documented path for the eleventh: the alternative, a board with no plate at all, silently
   * wears `default`'s and reads as a bug rather than as work in progress. The three that used to
   * declare one (`plum`→crimson, `moss`→sand, `slate`→ink) had it REMOVED when their plates
   * shipped rather than left inert, because a field naming a file the set no longer wears is a
   * comment that lies.
   */
  fallbackBackground?: SkinId
}

const BOARD_RECIPES: Record<BoardSetId, BoardRecipe> = {
  default: { hue: 195, style: 'checker' },
  emerald: { hue: 150, sat: 0.7, style: 'inset' },
  sunset: { hue: 28, sat: 0.55, style: 'ruled' },
  frost: { hue: 205, sat: 0.45, lum: 1.05, style: 'dots' },
  sand: { hue: 55, sat: 0.42, style: 'checker' },
  // The value-axis board, the way `frost` is the saturation-axis one: nearly black, and the only
  // set where the discs carry the entire image.
  ink: { hue: 235, sat: 0.45, lum: 0.55, style: 'ruled' },
  crimson: { hue: 348, sat: 0.5, style: 'inset' },

  /**
   * The violet band, which nothing occupied — and it is the game's OWN colour: `gameTheme.ts` builds
   * every panel, button and menu on deep plum, and until now the board was the one surface that
   * never wore it. The set where the board and the furniture around it are the same material.
   */
  // Its plate is a COLD INDIGO, not the theme plum, and that is the one deliberate mismatch
  // between a board and its scenery besides `default`'s. `bg-default` is already the game's plum
  // at Lab hue 313 and the most saturated plate in the set, so a second one would have shipped as
  // a copy of it — the generator measures that now and rejected two attempts for it. The loud
  // violet stays on the tiles, where the discs have to read against it; the room behind goes cold
  // and quiet (detail 0.16, the calmest plate in the game).
  plum: { hue: 285, sat: 0.52, style: 'dots' },

  /**
   * The yellow-green band, the other gap. `emerald` sits at 150 and reads as a cold green; this is
   * the warm one, and the two are far enough apart that a player asked to name them would not reach
   * for the same word.
   */
  moss: { hue: 90, sat: 0.7, style: 'checker' },

  /**
   * **The board that contributes no colour at all**, so every disc set reads against it at full
   * strength — the one to pick when the discs are the point.
   *
   * Distinct from `ink`, which is also quiet, and by a different axis: `ink` is nearly BLACK at a
   * normal saturation and this is nearly GREY at a normal lightness. Value against chroma. It is
   * also the only board where the two tiles are told apart by luminance alone, which makes it the
   * set that proves the grid still works as a ruler with no hue in it whatsoever.
   */
  // The plate behind it is a deep petrol teal — the one hue THIS GAME OWNS (the authored tile pair
  // is `#2b667a`) and which no plate wore, because `bg-default` declines it for the theme plum. A
  // board that contributes no colour and a room that does: the colour moves off the board rather
  // than out of the skin. The literal reading — graphite under graphite — was measured before any
  // GPU ran and lands ~9 Lab from `bg-ink` and ~8 from `bg-frost`, i.e. a third copy of the two
  // plates already doing quiet.
  slate: { hue: 215, sat: 0.06, lum: 0.5, style: 'ruled' },
}

export interface BoardSet {
  id: BoardSetId
  light: number
  dark: number
  style: BoardStyle
  /** The background plate this set wears — its own if one ships, otherwise its declared fallback. */
  background: SkinId
  /** The seam under `inset`'s tiles. Deliberately NOT {@link BoardSet.voidColor}: the band wants
   * something near black because it stands for the drop beyond the board, and grout that dark turns
   * `inset` into a heavy black grid drawn over the tiles rather than a seam between them. */
  grout: number
  /** What the perimeter band darkens toward — this set's own dark tile taken almost to black,
   * rather than one global plum. A green board fading into a purple void reads as a rendering bug,
   * and deriving it means a new set can never forget to set it. */
  voidColor: number
}

/** What the authored petrol-teal pair actually MEASURES — the CEILING every other set is held
 * under. Expressed as a measurement rather than as an HSL coordinate, because that is the only
 * form all seven hues can be compared in; see {@link capLuminance} for why it is a ceiling and not
 * a target. */
const MAX_LIGHT_Y = luminance(BASE_TILE_LIGHT)
const MAX_DARK_Y = luminance(BASE_TILE_DARK)

export function boardSet(id: BoardSetId): BoardSet {
  const r = BOARD_RECIPES[id]
  const sat = r.sat ?? 1
  const lum = r.lum ?? 1
  // Hue and saturation first, brightness second: recolouring changes how bright a colour measures,
  // so normalising before the hue is applied would normalise the wrong thing.
  const light = capLuminance(recolour(BASE_TILE_LIGHT, r.hue, sat), MAX_LIGHT_Y * lum)
  const dark = capLuminance(recolour(BASE_TILE_DARK, r.hue, sat), MAX_DARK_Y * lum)
  return {
    id,
    light,
    dark,
    style: r.style,
    background: resolveBackground(id, r),
    grout: capLuminance(recolour(BASE_TILE_DARK, r.hue, sat * 0.9), MAX_DARK_Y * lum * 0.5),
    voidColor: capLuminance(recolour(BASE_TILE_DARK, r.hue, sat * 0.8), MAX_DARK_Y * lum * 0.22),
  }
}

/** A board set wears its OWN plate the moment one ships under its id; until then, its declared
 * fallback. Resolved rather than stored so that shipping the plate is a one-line change in
 * `assets.ts` and nothing here needs revisiting. */
function resolveBackground(id: BoardSetId, r: BoardRecipe): SkinId {
  if (isSkinId(id)) return id
  return r.fallbackBackground ?? DEFAULT_SKIN
}

export function isBoardSetId(value: string): value is BoardSetId {
  return (BOARD_SET_IDS as readonly string[]).includes(value)
}

// -- the third wardrobe: what the board throws ----------------------------------------------------

/**
 * The particles, as data.
 *
 * The third slot, beside the board and the discs, and the cheapest content in the game for the same
 * reason §4 called the branches of arms cheap: it is arithmetic over assets that already exist.
 * Every set below is five numbers and a choice of two atlas frames — nothing ships, so
 * `ART-SOURCES.md`'s provenance gate has nothing new to check, and none of it can help anybody aim.
 *
 * **Three moments, and a set does not have to decorate all three.** Which ones it touches is itself
 * a way for two sets to differ: `coins` is only interested in the moment a disc is lost, `embers`
 * smoulders through the whole shot. A set that lit every moment identically would be the same set
 * with a different tint.
 */
export interface EffectBurst {
  /** Atlas frames thrown, picked per particle. */
  frames: readonly string[]
  count: number
  speed: { min: number; max: number }
  life: { min: number; max: number }
  scale: number
  /** Positive falls, negative floats. Board units per second squared. */
  gravityY: number
  /**
   * Additive blending.
   *
   * `particle-shard` carries the same thick dark contour every sprite in this game does, and at a
   * fifth of a cell that contour is most of the shape — under normal blending a shard burst reads as
   * dirt scattered on the board rather than as something thrown off. Additive drops the near-black
   * to nothing and leaves the lit core. A set that wants MASS rather than light (`dust`, `coins`)
   * turns it off deliberately and pays for it by using a frame with less contour in it.
   */
  additive: boolean
}

export interface EffectSet {
  id: EffectSetId
  /** A disc leaving the board — the loudest event in a round, and the only moment every set covers. */
  knock: EffectBurst
  /** Disc against disc, scaled by the closing speed the way the impact SOUND already is. */
  impact: EffectBurst | null
  /** Behind a moving disc, every `everyMs` of flight. */
  trail: (EffectBurst & { everyMs: number }) | null
}

export const EFFECT_SET_IDS = ['classic', 'dust', 'embers', 'coins'] as const
export type EffectSetId = (typeof EFFECT_SET_IDS)[number]
export const DEFAULT_EFFECT_SET: EffectSetId = 'classic'

const SPARK = ATLAS_FRAMES.sparkParticle
const SHARD = ATLAS_FRAMES.shardParticle
const COIN = ATLAS_FRAMES.coin

const EFFECT_SETS: Record<EffectSetId, Omit<EffectSet, 'id'>> = {
  /** What the game shipped with, unchanged, and it decorates one moment only — the free set is the
   * quiet one, so everything bought is visibly more rather than merely different. */
  classic: {
    knock: { frames: [SPARK, SHARD], count: 14, speed: { min: 60, max: 260 }, life: { min: 240, max: 560 }, scale: 0.5, gravityY: 0, additive: true },
    impact: null,
    trail: null,
  },

  /** Mass rather than light: a slow, heavy puff that falls. Normal blending, and the spark frame
   * rather than the shard because the shard's contour is what forced additive in the first place. */
  dust: {
    knock: { frames: [SPARK], count: 18, speed: { min: 30, max: 120 }, life: { min: 420, max: 900 }, scale: 0.75, gravityY: 90, additive: false },
    impact: { frames: [SPARK], count: 5, speed: { min: 20, max: 90 }, life: { min: 200, max: 420 }, scale: 0.4, gravityY: 60, additive: false },
    trail: { frames: [SPARK], count: 1, speed: { min: 0, max: 18 }, life: { min: 260, max: 420 }, scale: 0.28, gravityY: 20, additive: false, everyMs: 60 },
  },

  /** The one that FLOATS — negative gravity, long life, small and hot. The only set where the board
   * keeps glowing for a moment after the shot has finished. */
  embers: {
    knock: { frames: [SPARK], count: 22, speed: { min: 40, max: 170 }, life: { min: 600, max: 1200 }, scale: 0.34, gravityY: -55, additive: true },
    impact: { frames: [SPARK], count: 7, speed: { min: 40, max: 140 }, life: { min: 260, max: 520 }, scale: 0.3, gravityY: -40, additive: true },
    trail: { frames: [SPARK], count: 1, speed: { min: 0, max: 12 }, life: { min: 320, max: 560 }, scale: 0.2, gravityY: -30, additive: true, everyMs: 45 },
  },

  /**
   * Treasure: the coin frame, thrown in arcs that fall.
   *
   * Deliberately the set that touches ONE moment and nothing else. A coin at every contact would be
   * a currency animation on a board where coins are real money, and a coin trail behind every disc
   * would read as a payout rather than as a shot.
   */
  coins: {
    knock: { frames: [COIN], count: 10, speed: { min: 90, max: 240 }, life: { min: 500, max: 900 }, scale: 0.45, gravityY: 320, additive: false },
    impact: null,
    trail: null,
  },
}

export function effectSet(id: EffectSetId): EffectSet {
  return { id, ...EFFECT_SETS[id] }
}

export function isEffectSetId(value: string): value is EffectSetId {
  return (EFFECT_SET_IDS as readonly string[]).includes(value)
}
