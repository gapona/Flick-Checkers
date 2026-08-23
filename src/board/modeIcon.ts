import * as Phaser from 'phaser'
import { bakeTiles, PIT_COLOR, PIT_RIM_COLOR } from './boardView'
import { createBoardMetrics } from './layout'
import { boardSet } from '../game/skins'
import { hazardsFor } from '../game/hazards'
import { getRuleSet, type RulesId } from '../game/rules'
import { activeBoardSet } from '../game/wallet'
import type { BoardMetrics } from './layout'

/**
 * A mode card's board schema: a miniature of the board that rule set actually produces.
 *
 * **Because "the disc flies off" versus "the disc bounces back" cannot be said in one line of text,
 * and can be drawn in one picture.** That is the whole argument for the icon existing —
 * `PROMPT-UI.md`'s chunk 6 makes it explicitly, and it generalises past bumpers: pits are
 * equally invisible in prose and equally obvious as a diagram.
 *
 * Generated from `getRuleSet()` and `hazardsFor()` — the same data the round is built from — and
 * stamped by `boardView.ts`'s own `bakeTiles()`, exactly like the shop swatch. A hand-drawn icon
 * per mode would be four more assets that have to be remembered whenever a flag changes, and the
 * day one is forgotten the card advertises a rule the mode no longer has.
 */

export const MODE_ICON_SIZE = 64
/** Cells across the miniature. Fewer than the real 8, so a cell is 10.7px rather than 8px and the
 * chequer still reads as a chequer at card size. It does NOT govern how big a hazard comes out —
 * that geometry is computed against a real 8-cell board and scaled (see below), which is why this
 * comment used to claim credit for the pits' size and was wrong; {@link PIT_MIN_RADIUS} is what
 * actually decides it. */
const ICON_CELLS = 6

/** A bumper rim is drawn thick and bright, an ordinary rim thin and dim. The contrast IS the
 * information — a player comparing two cards should see the difference before reading either. */
const BUMPER_RIM = 0xffc23c
const BUMPER_WIDTH = 5
const PLAIN_RIM = 0x8a4a08
const PLAIN_WIDTH = 2

/**
 * **A pit needs its rim here even more than on the real board, and it shipped without one.**
 *
 * `PIT_COLOR` is near-black and a board set's dark tile is very nearly that (measured by
 * `verify:contrast`: the dark tile is Y≈0.02–0.03 across all seven sets) — so a pit that lands on a
 * dark square is a black square on a black square, i.e. nothing. The real board never had that
 * problem because `boardView.ts` strokes every pit with the lighter {@link PIT_RIM_COLOR}; the
 * miniature simply filled a dark square and stopped. Both colours are now imported from there rather
 * than restated, so the card cannot advertise a hazard in a colour the board does not use.
 */
const PIT_RIM_WIDTH = 2

/**
 * The floor on a pit's drawn radius, in icon pixels — and a deliberate departure from scale.
 *
 * At true proportion a pit is `0.34` of a cell on an 8-cell board, which at 64px comes to a radius
 * of **2.7px**: a five-pixel speck, which is what made this unreadable as much as the colour did.
 * That is also why the existing `Math.max(2, ...)` floor never did anything — it sat below the value
 * it was meant to protect.
 *
 * A schema is allowed to be out of scale; this file already is, drawing 6 cells where the board has
 * 8 for exactly the same legibility reason. What it is not allowed to be is out of TRUTH — the pits'
 * positions still come from `hazardsFor()` against a real board, so the card still says where they
 * are and how many there are.
 */
const PIT_MIN_RADIUS = 6

export function modeIconKey(rules: RulesId, board: string): string {
  return `mode-icon-${rules}-${board}`
}

export function ensureModeIcon(scene: Phaser.Scene, rules: RulesId): string {
  // Keyed on the equipped board set too: the icon is drawn in the player's own colours, so a card
  // shown after a skin change must not serve the previous set's miniature from cache.
  const board = activeBoardSet()
  const key = modeIconKey(rules, board)
  if (scene.textures.exists(key)) return key

  const set = boardSet(board)
  const rule = getRuleSet(rules)
  const tile = MODE_ICON_SIZE / ICON_CELLS
  const metrics: BoardMetrics = { size: ICON_CELLS, tile, boardW: MODE_ICON_SIZE, boardH: MODE_ICON_SIZE }

  // Hazard GEOMETRY is computed against a real board and then scaled down, rather than against the
  // miniature: `hazardsFor` places bands and pits as fractions of a full board, and asking it for a
  // 6-cell one would put them in the wrong place relative to what the mode actually plays like.
  const real = createBoardMetrics(8)
  const hazards = hazardsFor(rule, real)
  const shrink = MODE_ICON_SIZE / real.boardW

  const texture = scene.make.renderTexture({ width: MODE_ICON_SIZE, height: MODE_ICON_SIZE }, false).setOrigin(0, 0)
  bakeTiles(texture, metrics, set)

  for (const pit of hazards.pits) {
    // Squares rather than circles: `RenderTexture.fill()` writes rectangles only, and at this size a
    // disc and a square are the same handful of pixels anyway. Rim first, then the core inside it —
    // the same two-tone the board's own fill-then-stroke gives, in the only primitive available here.
    const r = Math.max(PIT_MIN_RADIUS, pit.r * shrink)
    const core = Math.max(1, r - PIT_RIM_WIDTH)
    const x = pit.x * shrink
    const y = pit.y * shrink
    texture.fill(PIT_RIM_COLOR, 1, x - r, y - r, r * 2, r * 2)
    texture.fill(PIT_COLOR, 1, x - core, y - core, core * 2, core * 2)
  }

  const rimColor = rule.bumperRim ? BUMPER_RIM : PLAIN_RIM
  const rimWidth = rule.bumperRim ? BUMPER_WIDTH : PLAIN_WIDTH
  texture.fill(rimColor, 1, 0, 0, MODE_ICON_SIZE, rimWidth)
  texture.fill(rimColor, 1, 0, MODE_ICON_SIZE - rimWidth, MODE_ICON_SIZE, rimWidth)
  texture.fill(rimColor, 1, 0, 0, rimWidth, MODE_ICON_SIZE)
  texture.fill(rimColor, 1, MODE_ICON_SIZE - rimWidth, 0, rimWidth, MODE_ICON_SIZE)

  // Phaser 4 buffers draw commands — flush before the texture is saved, the same gotcha the board
  // bake and the shop swatch both carry.
  texture.render()
  texture.saveTexture(key)
  return key
}
