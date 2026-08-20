/**
 * The contrast verdict of `PROMPT-UI-CHAPAEV.md`'s chunk 11, as arithmetic.
 *
 * Three claims are made about this game's colour, all of them load-bearing, and all of them the
 * kind that stay true for exactly as long as nobody adds a skin:
 *
 * 1. **The tiles are a ruler, not a picture.** Light against dark is about 2:1 — enough to read
 *    distance across, not enough to compete with a disc.
 * 2. **Nothing on the board is brighter than a disc.** A board that out-shines the pieces advances
 *    in front of them, and aiming is done by looking at pieces.
 * 3. **The two sides survive greyscale.** Gold and violet is a hue distinction, and a hue
 *    distinction is the one that colour-blind players and a greyscale screenshot both lose.
 *
 * A verdict written in prose covers the seven boards and five piece sets that exist on the day it
 * is written. This covers all 35 combinations every time it runs, and it runs in `npm test`.
 *
 * Measured in RELATIVE LUMINANCE, sRGB-decoded — the same function `game/skins.ts` uses and for the
 * same reason: HSL lightness is a coordinate, not a brightness, and this file's whole job is to
 * measure brightness.
 */
import { BOARD_SET_IDS, PIECE_SET_IDS, boardSet, pieceSet } from '../src/game/skins.ts'

let failures = 0
let checks = 0

function check(condition, message) {
  checks++
  if (!condition) {
    failures++
    console.error(`  FAIL  ${message}`)
  }
}

function luminance(rgb) {
  const channel = (v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((rgb >> 16) & 0xff) + 0.7152 * channel((rgb >> 8) & 0xff) + 0.0722 * channel(rgb & 0xff)
}

/** WCAG's ratio. Used here as a plain "how far apart are these two greys", not as an accessibility
 * grade — none of these pairs is text on a background. */
function ratio(a, b) {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05)
}

const f2 = (n) => n.toFixed(2)

// -- 1. the tiles are a ruler ------------------------------------------------------------------
//
// The target is ~2:1. The band is deliberately wide on the low side and tight on the high: a set
// that lands at 1.5 still reads as a grid, a set that lands at 3 has started to look like a
// draughts board, which is exactly the read chunk 11 is written against.
const TILE_RATIO_MIN = 1.35
const TILE_RATIO_MAX = 2.6

console.log('board tiles — light : dark')
for (const id of BOARD_SET_IDS) {
  const set = boardSet(id)
  const r = ratio(set.light, set.dark)
  console.log(`  ${id.padEnd(9)} ${f2(r)}:1   light Y=${f2(luminance(set.light))}  dark Y=${f2(luminance(set.dark))}  ${set.style}`)
  check(r >= TILE_RATIO_MIN && r <= TILE_RATIO_MAX, `${id}: tile contrast ${f2(r)}:1 is outside ${TILE_RATIO_MIN}–${TILE_RATIO_MAX}:1`)
}

// -- 2. the discs are the brightest thing on the board -----------------------------------------
//
// Compared against the LIGHT tile, which is the brightest pixel the board itself can produce, and
// against each side's `light` stop, which is the lit centre of a disc — the brightest pixel a disc
// can produce short of the gloss highlight painted over it.
console.log('\ndiscs over boards — is the lit disc brighter than the lightest tile?')
for (const boardId of BOARD_SET_IDS) {
  const board = boardSet(boardId)
  const tile = luminance(board.light)
  const worst = []
  for (const pieceId of PIECE_SET_IDS) {
    const pieces = pieceSet(pieceId)
    for (const [side, ramp] of [
      ['player', pieces.player],
      ['opponent', pieces.opponent],
    ]) {
      const disc = luminance(ramp.light)
      check(disc > tile, `${boardId} + ${pieceId}/${side}: lit disc Y=${f2(disc)} is not brighter than the light tile Y=${f2(tile)}`)
      worst.push({ label: `${pieceId}/${side}`, margin: disc - tile })
    }
  }
  worst.sort((a, b) => a.margin - b.margin)
  console.log(`  ${boardId.padEnd(9)} tile Y=${f2(tile)}   tightest: ${worst[0].label} +${f2(worst[0].margin)}`)
}

// -- 3. the two sides survive greyscale --------------------------------------------------------
//
// **This is the chunk's blocker test.** Gold against violet is a HUE distinction, and greyscale is
// where a hue distinction goes to die — as does a colour-blind player's read of it, which is the
// same failure with a bigger audience.
//
// The threshold is the one number here that is a judgement rather than a derivation. 1.3:1 is
// roughly where two flat greys stop being tellable apart side by side at a 37px tile, which is the
// size a disc actually occupies on the target phone. A set that lands under it is not "slightly
// worse", it is a set whose two sides are one side.
const SIDE_RATIO_MIN = 1.3

console.log('\nsides in greyscale — player : opponent, per ramp stop')
for (const id of PIECE_SET_IDS) {
  const set = pieceSet(id)
  const stops = ['light', 'mid', 'deep'].map((stop) => ({ stop, r: ratio(set.player[stop], set.opponent[stop]) }))
  const mid = stops.find((s) => s.stop === 'mid')
  console.log(`  ${id.padEnd(8)} ${stops.map((s) => `${s.stop} ${f2(s.r)}:1`).join('   ')}`)
  // Judged on `mid`, which is most of a disc's face: `light` is a small lit centre and `deep` a
  // thin contour, and a set could pass on either while its bulk was one grey.
  check(mid.r >= SIDE_RATIO_MIN, `${id}: the two sides are ${f2(mid.r)}:1 apart in greyscale at the mid stop, under ${SIDE_RATIO_MIN}:1`)
}

// -- 4. a disc is not the same grey as the board it stands on ----------------------------------
//
// Distinct from check 2, which only asks about the brightest pixel of each. A disc whose mid tone
// measures the same as the tile under it disappears in greyscale even though its lit centre is
// brighter — the eye reads the mass, not the highlight.
const DISC_TILE_RATIO_MIN = 1.35

console.log('\ndisc mass over tile — mid stop vs the tile it stands on')
for (const boardId of BOARD_SET_IDS) {
  const board = boardSet(boardId)
  let tightest = null
  for (const pieceId of PIECE_SET_IDS) {
    const pieces = pieceSet(pieceId)
    for (const [side, ramp] of [
      ['player', pieces.player],
      ['opponent', pieces.opponent],
    ]) {
      for (const [tileName, tile] of [
        ['light', board.light],
        ['dark', board.dark],
      ]) {
        const r = ratio(ramp.mid, tile)
        check(r >= DISC_TILE_RATIO_MIN, `${boardId}/${tileName} + ${pieceId}/${side}: disc mass is ${f2(r)}:1 against the tile, under ${DISC_TILE_RATIO_MIN}:1`)
        if (!tightest || r < tightest.r) tightest = { r, label: `${pieceId}/${side} on ${tileName}` }
      }
    }
  }
  console.log(`  ${boardId.padEnd(9)} tightest ${f2(tightest.r)}:1  (${tightest.label})`)
}

// -- 5. the edge is a cliff, and the descent to it is monotone ---------------------------------
//
// Chunk 11: "the edge of the board is the most important line on the screen ... it has to read as a
// drop." That is a statement about ORDER, not about any one colour: from the middle of the board
// outward, every step must be darker than the last — light tile, dark tile, perimeter band, rim,
// void. A single lighter step anywhere in that sequence advances, and an edge that advances reads
// as a wall you are safe against.
//
// It is checked because the rim failed it. Sampled off the real render, the old gold rim measured
// 0.60 against a light tile's 0.114 — the brightest thing on the playing surface was its deadliest
// line. `boardView.ts` now takes the rim from `voidColor`, and this is what keeps it there.
console.log('\nthe edge — light tile > dark tile > void tone')
for (const id of BOARD_SET_IDS) {
  const set = boardSet(id)
  const light = luminance(set.light)
  const dark = luminance(set.dark)
  const empty = luminance(set.voidColor)
  console.log(`  ${id.padEnd(9)} ${f2(light)} > ${f2(dark)} > ${f2(empty)}`)
  check(dark < light, `${id}: the dark tile (${f2(dark)}) is not darker than the light one (${f2(light)})`)
  check(empty < dark, `${id}: the void tone (${f2(empty)}) is not darker than the dark tile (${f2(dark)}) — the rim would advance`)
}

// -- are any two piece sets the same set? --------------------------------------------------------
//
// Everything above measures a set against the BOARD. Nothing measured a set against another SET, and
// an eighth one shipped for an afternoon that sat 4.5 Lab units from `bone` on its nearer side — the
// same idea (a pale player) wearing different numbers. That is invisible in the recipe, which is the
// point: the two differed in every field and agreed in the only thing a player sees.
//
// **The floor is a RATCHET, not a fitted threshold**, and the distinction matters given how this
// project sets thresholds. It is deliberately NOT "the current minimum minus epsilon", which would
// fail the first time somebody retuned `classic` or `ember` for reasons having nothing to do with
// duplication. It is low enough to catch a duplicate and no lower, and the catalogue's own tightest
// pair is printed beside it so the headroom is visible rather than assumed.
{
  const toLab = (rgb) => {
    const toLinear = (c) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const r = toLinear((rgb >> 16) & 255)
    const g = toLinear((rgb >> 8) & 255)
    const b = toLinear(rgb & 255)
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
  }
  const distance = (a, b) => {
    const [l1, a1, b1] = toLab(a)
    const [l2, a2, b2] = toLab(b)
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
  }
  // A set IS its PAIR, so two of them differ by the NEARER of their two sides — one that matches
  // another on a single side already reads as it across a board. Which two sides depends on what is
  // being swept, so the caller passes them in.
  const SET_FLOOR = 12
  /**
   * BOARDS get a lower floor than discs, and it is not a concession — it is the invariant.
   *
   * Boards are dark and low-chroma BY CONSTRUCTION (see `game/skins.ts`), so the whole catalogue
   * lives in a much smaller volume of colour space than the discs do and the same number would fail
   * sets that are perfectly tellable apart. What it still catches is the thing worth catching: two
   * boards nobody could name differently.
   */
  const BOARD_FLOOR = 8
  /**
   * ...and a lower one when the two carry different STYLES.
   *
   * **A board's identity is colour AND pattern, which a disc set's is not** — `checker`, `inset`,
   * `ruled` and `dots` are as visible across a room as a hue is, so two boards a few units apart in
   * colour are still two boards if one is ruled and the other is dotted. The shipped catalogue
   * relies on it: `sunset` and `sand` are 6.9 apart and have never been confusable, because one is
   * ruled brown and the other checkered olive. Measuring boards the way discs are measured reported
   * that pair as a duplicate, which says the metric was wrong rather than the pair.
   */
  const BOARD_FLOOR_MIXED_STYLE = 5

  const sweep = (label, entries, floorFor, sides) => {
    let tightest = { pair: '', d: Infinity, floor: 0 }
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const d = Math.min(...sides.map((side) => distance(side(entries[i]), side(entries[j]))))
        const floor = floorFor(entries[i], entries[j])
        if (d - floor < tightest.d - tightest.floor) tightest = { pair: `${entries[i].id} ~ ${entries[j].id}`, d, floor }
        check(d >= floor, `${label}: ${entries[i].id} and ${entries[j].id} are the same set — ${d.toFixed(1)} apart, floor ${floor}`)
      }
    }
    console.log(`  ${label}: tightest pair ${tightest.pair} at ${tightest.d.toFixed(1)} against its floor of ${tightest.floor}`)
  }

  sweep(
    'piece sets',
    PIECE_SET_IDS.map((id) => ({ id, ...pieceSet(id) })),
    () => SET_FLOOR,
    [(set) => set.player.mid, (set) => set.opponent.mid],
  )
  sweep(
    'board sets',
    BOARD_SET_IDS.map((id) => ({ id, ...boardSet(id) })),
    (a, b) => (a.style === b.style ? BOARD_FLOOR : BOARD_FLOOR_MIXED_STYLE),
    [(set) => set.light, (set) => set.dark],
  )
}

console.log('')
if (failures > 0) {
  console.error(`verify-contrast: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`${checks} checks passed`)
