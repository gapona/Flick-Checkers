import * as Phaser from 'phaser'
import { bakeTiles } from './boardView'
import { ATLAS_KEY } from '../assets'
import { discTextureKey, ensureDiscTextures } from './discTextures'
import { boardSet, pieceSet, type BoardSetId, type PieceSetId, effectSet, type EffectSetId} from '../game/skins'
import type { BoardMetrics } from './layout'

/**
 * The shop's product preview: a board fragment with one disc a side, baked to a texture.
 *
 * ## Why this exists at all
 *
 * A skin is a purely cosmetic purchase, so **seeing it IS the product**. The shop shipped as ten
 * rows of text and a price, which asks the player to buy a colour scheme sight unseen — the single
 * biggest thing wrong with the screen, and worse now than when it sold three bundles.
 *
 * ## Why it is generated and not painted
 *
 * The tempting alternative is one authored PNG per set. It is worse, and not by a little: an
 * authored preview is a SECOND asset that has to be kept in step with the palette by somebody
 * remembering to, and the day it stops matching is the day the shop starts lying about what it
 * sells. This is generated from {@link boardSet} and {@link pieceSet} — the exact functions the
 * board and the discs are drawn from — so the swatch cannot disagree with the product.
 *
 * It goes further than sharing the palette: the tiles are stamped by `boardView.ts`'s own
 * {@link bakeTiles}, and the discs are the very textures `discView.ts` puts on the board. There is
 * no second drawing of anything here, which is why {@link bakeTiles} takes its loop bounds from the
 * texture's box rather than from `metrics.size`.
 *
 * ## What it shows, and why both slots
 *
 * A swatch is keyed on a (board, pieces) PAIR, not on the item being sold, and the shop passes the
 * player's currently equipped counterpart. A board row therefore previews that board wearing the
 * discs the player actually owns and wears, and a disc row previews those discs on the board they
 * actually play on. That is the honest answer to "what do I get if I tap this" — with two
 * independent slots, an item alone does not have a look.
 */

/** Delivery size, in pixels. Sized to the shop's 52px row with room to breathe, and wide enough
 * that four cells of grid fit — fewer than that and `checker` stops being distinguishable from
 * `inset` at a glance, which would defeat the point. */
export const SWATCH_WIDTH = 96
export const SWATCH_HEIGHT = 40
/** One cell, in pixels. 24 gives 4 x 1.67 cells — non-integer on purpose, so the strip reads as a
 * piece cut out of a larger board rather than as a tiny complete one. Raised from 20 after looking
 * at it: the grid read fine either way, but the discs are the part a player is actually buying and
 * at cell 20 they came out as coloured dots. */
const SWATCH_CELL = 24

/** The gold rim, the one thing no skin ever recolours (`ui/theme.ts`'s "gold is the only metal"),
 * which is exactly what makes it the right frame for a preview: it is the constant the player is
 * comparing the variables against. */
const RIM = 0xffc23c
const RIM_WIDTH = 2

/** Bigger than the 0.4 a real disc occupies. A swatch is a product photo, not a diagram: the
 * proportions of the board matter less here than being able to see what colour the thing is. */
const DISC_RADIUS = SWATCH_CELL * 0.46

export function swatchKey(board: BoardSetId, pieces: PieceSetId): string {
  return `swatch-${board}-${pieces}`
}

/**
 * Bakes the swatch for one (board, pieces) pair, or returns immediately if it already exists.
 *
 * Cached in Phaser's texture manager by key, like the disc textures themselves: opening the shop
 * builds at most one texture per visible row, and reopening it builds none. Ten rows of a
 * 96x40 texture is about 150 KB of GPU memory in the worst case, which is not a budget worth
 * managing.
 */
export function ensureSwatchTexture(scene: Phaser.Scene, board: BoardSetId, pieces: PieceSetId): string {
  const key = swatchKey(board, pieces)
  if (scene.textures.exists(key)) return key

  const set = boardSet(board)
  const discs = pieceSet(pieces)
  // The disc textures are the real ones. If this pair's piece set has never been worn this
  // session they will not exist yet, which is the normal case for a shop row.
  ensureDiscTextures(scene, discs)

  // A hand-made metrics rather than `createBoardMetrics`: that helper builds a SQUARE board from a
  // cell count, and a swatch is a wide strip. Everything `bakeTiles` reads is here.
  const metrics: BoardMetrics = {
    size: Math.round(SWATCH_WIDTH / SWATCH_CELL),
    tile: SWATCH_CELL,
    boardW: SWATCH_WIDTH,
    boardH: SWATCH_HEIGHT,
  }

  /**
   * `make`, not `add`, and never destroyed.
   *
   * Two traps, both silent. `scene.add.renderTexture()` parents the object to the SHOP's display
   * list, and the shop is a `launch()`-ed overlay that is stopped on close — taking the texture
   * with it, while `textures.exists(key)` goes on answering `true`, so the second time the shop
   * opened every swatch would be blank. And destroying the object after `saveTexture()` is not
   * obviously safe either, since the saved entry and the object share one underlying GL texture.
   *
   * Unparented and kept alive avoids both: the entry lives in the global `TextureManager` for the
   * session, exactly like the disc textures it is built from.
   */
  const texture = scene.make.renderTexture({ width: SWATCH_WIDTH, height: SWATCH_HEIGHT }, false).setOrigin(0, 0)
  bakeTiles(texture, metrics, set)

  // No danger band: it is a rule about the edge of a REAL board, and a strip cut out of the middle
  // of one has no edges to warn about. Putting it here would advertise a feature of the board's
  // geometry as if it were a feature of the skin.
  texture.fill(RIM, 1, 0, 0, SWATCH_WIDTH, RIM_WIDTH)
  texture.fill(RIM, 1, 0, SWATCH_HEIGHT - RIM_WIDTH, SWATCH_WIDTH, RIM_WIDTH)

  drawDisc(scene, texture, discTextureKey('player', discs.id), SWATCH_WIDTH * 0.3)
  drawDisc(scene, texture, discTextureKey('opponent', discs.id), SWATCH_WIDTH * 0.7)

  // Phaser 4 buffers draw commands — the same flush `boardView.ts` needs, and for the same reason.
  texture.render()
  texture.saveTexture(key)
  return key
}

/**
 * Stamps one disc, scaled from its 128px source down to the swatch's cell.
 *
 * Through a throwaway `Image` because `RenderTexture.draw()` honours a game object's transform but
 * takes no scale of its own. The object is created and destroyed inside this call, so it is gone
 * long before the display list is next rendered and never appears on screen — the same
 * create-stamp-discard shape `bakeHazards` uses for its `Graphics`.
 */
function drawDisc(scene: Phaser.Scene, texture: Phaser.GameObjects.RenderTexture, key: string, x: number): void {
  // NOT hidden with setVisible(false): RenderTexture.draw() is not guaranteed to honour it, and a
  // hidden object that still stamps would be a silent no-op the day it does. Destroyed instead.
  const image = scene.add.image(0, 0, key)
  image.setScale((DISC_RADIUS * 2) / image.width)
  texture.draw(image, x, SWATCH_HEIGHT / 2)
  // Flushed BEFORE the Image is thrown away. Phaser 4 buffers draw commands, so destroying the
  // source first leaves the queued command pointing at a dead object — and it does not fail
  // quietly: the flush throws `Cannot read properties of undefined (reading 'sys')` from deep
  // inside the renderer, which took the shop down with it. Exactly the gotcha `bakeHazards` carries
  // for its `Graphics`, and the third time this codebase has hit it.
  texture.render()
  image.destroy()
}

/**
 * The same strip with a burst of the effect set thrown across it.
 *
 * An effect cannot be previewed by a board and two discs — that picture is identical for all four
 * sets. So the row's swatch draws the set's OWN particles, at its own scale and frames, in a fixed
 * scatter: `dust` is a soft grey cloud, `embers` a spray of small hot points, `coins` a handful of
 * gold. It is a still of a moving thing, which is the honest limit of a row 40px tall.
 *
 * The scatter is DETERMINISTIC — a fixed table of offsets rather than `Math.random()` — so the same
 * row looks the same on every visit and in every screenshot. A preview that reshuffled itself would
 * read as two different products on two visits.
 */
export function ensureEffectSwatchTexture(scene: Phaser.Scene, board: BoardSetId, pieces: PieceSetId, effect: EffectSetId): string {
  const key = `swatch-fx-${effect}-${board}-${pieces}`
  if (scene.textures.exists(key)) return key

  const base = ensureSwatchTexture(scene, board, pieces)
  const burst = effectSet(effect).knock
  const tint = pieceSet(pieces).player.mid

  const texture = scene.make.renderTexture({ width: SWATCH_WIDTH, height: SWATCH_HEIGHT }, false).setOrigin(0, 0)
  // Through an Image again: Phaser 4's RenderTexture has no `drawFrame`, and `draw()` honours a
  // game object's transform. Same create-stamp-discard shape as `drawDisc` above.
  const backdrop = scene.add.image(0, 0, base).setOrigin(0, 0)
  texture.draw(backdrop, 0, 0)
  texture.render()
  backdrop.destroy()

  // A fan thrown from the middle of the strip, leaning up and out the way a knock-off burst does.
  const SCATTER = [
    [-0.9, -0.55],
    [-0.5, -0.85],
    [-0.15, -0.35],
    [0.2, -0.75],
    [0.55, -0.45],
    [0.85, -0.8],
    [-0.7, 0.35],
    [0.35, 0.5],
    [0.75, 0.2],
  ]
  SCATTER.forEach(([dx, dy], i) => {
    const frame = burst.frames[i % burst.frames.length]
    const sprite = scene.add.image(0, 0, ATLAS_KEY, frame)
    sprite.setScale(burst.scale * (SWATCH_HEIGHT / 96))
    sprite.setTint(tint)
    // The alpha stands in for the fade a real particle does over its life: the ones furthest from
    // the centre are the oldest, so they are the faintest.
    sprite.setAlpha(1 - Math.min(0.75, Math.hypot(dx, dy) * 0.55))
    texture.draw(sprite, SWATCH_WIDTH / 2 + dx * SWATCH_WIDTH * 0.42, SWATCH_HEIGHT / 2 + dy * SWATCH_HEIGHT * 0.42)
    texture.render()
    sprite.destroy()
  })

  texture.render()
  texture.saveTexture(key)
  return key
}
